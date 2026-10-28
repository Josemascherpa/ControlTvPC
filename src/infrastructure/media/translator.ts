import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import { asArray, asRecord, asString } from '../storage/json';
import { pooledFetch } from './http-pool';

// Las sinopsis del catálogo vienen en inglés (la API no acepta idioma). Se traducen al español con
// el traductor público de Google (medido: ~0,5 s cada una) y cada traducción se guarda en el disco:
// cada sinopsis se traduce UNA sola vez, para siempre.

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
const MAX_ENTRIES = 20_000;
const MAX_TEXT = 1800;
/** Pocas a la vez: el traductor público limita si se le piden muchas juntas. */
const CONCURRENCY = 2;
/** Traducciones en segundo plano encoladas como mucho (catálogo y búsqueda). */
const WARM_LIMIT = 24;
const TIMEOUT_MS = 6000;
const SAVE_DELAY_MS = 4000;

const keyOf = (text: string): string => createHash('sha1').update(text).digest('base64url').slice(0, 20);

export class Translator {
  private readonly memory = new Map<string, string>();
  private readonly inflight = new Map<string, Promise<string>>();
  private readonly queue: (() => void)[] = [];
  private readonly blockedUntil = new Map<string, number>();
  private running = 0;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string, private readonly request: typeof fetch = pooledFetch) {
    try {
      if (existsSync(file)) {
        const saved = asRecord(JSON.parse(readFileSync(file, 'utf8')) as unknown);
        for (const [key, value] of Object.entries(saved)) if (typeof value === 'string') this.memory.set(key, value);
      }
    } catch {
      // un archivo roto no impide traducir: se vuelve a armar
    }
  }

  /** La traducción ya guardada, o null (sin esperar a la red). */
  known(text: string): string | null {
    return text ? this.memory.get(keyOf(text)) ?? null : null;
  }

  /**
   * Traduce (o devuelve la guardada). Si el traductor no contesta, el texto original. `urgent`: lo
   * que la pantalla está esperando (la ficha abierta) pasa delante de lo que se traduce de fondo.
   */
  translate(text: string, urgent = false): Promise<string> {
    const clean = text.trim().slice(0, MAX_TEXT);
    if (!clean || looksSpanish(clean)) return Promise.resolve(text);
    const key = keyOf(clean);
    const saved = this.memory.get(key);
    if (saved) return Promise.resolve(saved);
    if (!this.available) return Promise.resolve(text);
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.limited(() => this.fetchTranslation(clean), urgent)
        .then((translated) => {
          if (translated && translated !== clean) this.remember(key, translated);
          return translated || text;
        }, () => text)
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  /** Traduce sin esperar el resultado (para ir llenando la memoria en segundo plano). */
  warm(texts: readonly string[]): void {
    // Pocas por vez (medido: pedir ~160 juntas hace que Google conteste 429 un buen rato).
    const missing = texts.filter((text) => text && !this.known(text) && !this.inflight.has(keyOf(text.trim().slice(0, MAX_TEXT))));
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

  private remember(key: string, value: string): void {
    if (this.memory.size >= MAX_ENTRIES) this.memory.delete(this.memory.keys().next().value ?? '');
    this.memory.set(key, value);
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void writeFile(this.file, JSON.stringify(Object.fromEntries(this.memory))).catch(() => undefined);
    }, SAVE_DELAY_MS);
    this.saveTimer.unref();
  }
}

/** Ya está en español (ej. películas latinas): no hace falta traducir. */
function looksSpanish(text: string): boolean {
  const words = text.toLowerCase().match(/[a-záéíóúñ]+/g) ?? [];
  if (words.length < 6) return false;
  const spanish = words.filter((word) => /^(el|la|los|las|de|del|que|una?|por|para|con|su|sus|es|en|y|se|lo|al|como|pero|más)$/.test(word)).length;
  return spanish / words.length > 0.18;
}
