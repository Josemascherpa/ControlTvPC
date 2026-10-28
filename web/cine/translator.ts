import { asArray, asString } from '../../shared/json.js';
import type { KeyValueStore } from './store.js';

// Las sinopsis del catálogo vienen en inglés (la API no acepta idioma). Se traducen al español con
// el traductor público de Google (medido: ~0,2–0,5 s cada una) y cada traducción queda guardada en el
// navegador: cada sinopsis se traduce UNA sola vez, para siempre.

interface Endpoint {
  readonly name: string;
  readonly url: (text: string) => string;
  readonly parse: (body: unknown) => string;
}
const query = (params: Record<string, string>): string => new URLSearchParams(params).toString();
/** Dos traductores de Google con límites aparte: si uno contesta 429, sigue el otro. */
const ENDPOINTS: readonly Endpoint[] = [
  {
    // Respuesta: [["texto traducido","en"]] (o ["texto traducido"]).
    name: 'dict',
    url: (q) => `https://clients5.google.com/translate_a/t?${query({ client: 'dict-chrome-ex', sl: 'auto', tl: 'es', q })}`,
    parse: (body) => {
      const first = asArray(body)[0];
      return (typeof first === 'string' ? first : asString(asArray(first)[0])).trim();
    },
  },
  {
    // Respuesta: [[["frase traducida","frase original",…],…],…]: se unen las frases traducidas.
    name: 'gtx',
    url: (q) => `https://translate.googleapis.com/translate_a/single?${query({ client: 'gtx', sl: 'auto', tl: 'es', dt: 't', q })}`,
    parse: (body) => asArray(asArray(body)[0]).map((part) => asString(asArray(part)[0])).join('').trim(),
  },
];
/** Un traductor que limitó descansa esto antes de volver a probarlo. */
const BLOCKED_MS = 15 * 60_000;
/** Traducciones guardadas como mucho (las más viejas se borran). */
const MAX_ENTRIES = 20_000;
const MAX_TEXT = 1800;
/** Pocas a la vez: el traductor público limita si se le piden muchas juntas. */
const CONCURRENCY = 2;
/** Traducciones en segundo plano encoladas como mucho (catálogo y búsqueda). */
const WARM_LIMIT = 24;
const TIMEOUT_MS = 6000;

export class Translator {
  private readonly memory = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<string>>();
  private readonly queue: (() => void)[] = [];
  private readonly blockedUntil = new Map<string, number>();
  private running = 0;
  /** Las traducciones guardadas, cargadas una vez al abrir. */
  private readonly loaded: Promise<void>;

  constructor(private readonly store: KeyValueStore, private readonly request: typeof fetch = (input, init) => fetch(input, init)) {
    this.loaded = store.entries().then((entries) => {
      for (const [key, value] of entries) if (typeof value === 'string') this.memory.set(key, value);
      if (entries.length > MAX_ENTRIES) void store.trim(MAX_ENTRIES);
    }, () => undefined);
  }

  /** Espera a tener cargadas las traducciones guardadas. */
  ready(): Promise<void> {
    return this.loaded;
  }

  /** La traducción ya guardada, o null (sin esperar a la red). */
  known(text: string): string | null {
    return text ? this.memory.get(text.trim().slice(0, MAX_TEXT)) ?? null : null;
  }

  /**
   * Traduce (o devuelve la guardada). Si el traductor no contesta, el texto original. `urgent`: lo
   * que la pantalla está esperando (la ficha abierta) pasa delante de lo que se traduce de fondo.
   */
  async translate(text: string, urgent = false): Promise<string> {
    const clean = text.trim().slice(0, MAX_TEXT);
    if (!clean || looksSpanish(clean)) return text;
    await this.loaded;
    const saved = this.memory.get(clean);
    if (saved) return saved;
    if (!this.available) return text;
    let pending = this.inflight.get(clean);
    if (!pending) {
      pending = this.limited(() => this.fetchTranslation(clean), urgent)
        .then((translated) => {
          if (translated && translated !== clean) this.remember(clean, translated);
          return translated || text;
        }, () => text)
        .finally(() => this.inflight.delete(clean));
      this.inflight.set(clean, pending);
    }
    return pending;
  }

  /** Traduce sin esperar el resultado (para ir llenando la memoria en segundo plano). */
  warm(texts: readonly string[]): void {
    // Pocas por vez (medido: pedir ~160 juntas hace que Google conteste 429 un buen rato).
    const missing = texts.filter((text) => text && !this.known(text) && !this.inflight.has(text.trim().slice(0, MAX_TEXT)));
    for (const text of missing.slice(0, Math.max(0, WARM_LIMIT - this.queue.length))) void this.translate(text);
  }

  /** Prueba los traductores en orden; el que limita (429) descansa un rato y no demora a nadie. */
  private async fetchTranslation(text: string): Promise<string> {
    for (const endpoint of ENDPOINTS) {
      if ((this.blockedUntil.get(endpoint.name) ?? 0) > Date.now()) continue;
      const response = await this.request(endpoint.url(text), { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status === 429) {
        this.blockedUntil.set(endpoint.name, Date.now() + BLOCKED_MS);
        continue;
      }
      if (!response.ok) throw new Error(`traductor ${String(response.status)}`);
      const translated = endpoint.parse(await response.json());
      if (translated) return translated;
    }
    throw new Error('traductores ocupados');
  }

  /** Todos los traductores limitando: se contesta el original al instante en vez de esperar. */
  private get available(): boolean {
    const now = Date.now();
    return ENDPOINTS.some((endpoint) => (this.blockedUntil.get(endpoint.name) ?? 0) <= now);
  }

  private limited<T>(task: () => Promise<T>, urgent: boolean): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        this.running++;
        task().then(resolve, (error: unknown) => { reject(error instanceof Error ? error : new Error(String(error))); }).finally(() => {
          this.running--;
          this.queue.shift()?.();
        });
      };
      if (this.running < CONCURRENCY) run();
      else if (urgent) this.queue.unshift(run);
      else this.queue.push(run);
    });
  }

  private remember(text: string, value: string): void {
    this.memory.set(text, value);
    void this.store.set(text, value).catch(() => undefined);
  }
}

/** Ya está en español (ej. películas latinas): no hace falta traducir. */
function looksSpanish(text: string): boolean {
  const words = text.toLowerCase().match(/[a-záéíóúñ]+/g) ?? [];
  if (words.length < 6) return false;
  const spanish = words.filter((word) => /^(el|la|los|las|de|del|que|una?|por|para|con|su|sus|es|en|y|se|lo|al|como|pero|más)$/.test(word)).length;
  return spanish / words.length > 0.18;
}
