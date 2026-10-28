import { asArray, asNullableNumber, asRecord, asString } from '../../shared/json.js';
import type { KeyValueStore } from './store.js';
import { tmdbResults, tmdbShelf, type ShelfQuery, type TmdbAccess } from './tmdb.js';
import type { Translator } from './translator.js';

/** Espera una traducción como mucho un rato: si tarda, se usa el texto original (no se demora la ficha). */
function capped(task: Promise<string>, fallback: string, ms = 2500): Promise<string> {
  return Promise.race([task, new Promise<string>((resolve) => { setTimeout(() => { resolve(fallback); }, ms); })]);
}

// Catálogo propio. La API pública de FrameX entrega metadatos (TMDB) y, por título, la lista de
// servidores con una fuente HLS o MP4. Nunca se ejecuta JavaScript de terceros ni se reenvían URLs
// arbitrarias: todo lo que sale de acá ya está validado.
//
// Corre adentro del Cine (en el navegador) y consulta internet directo: no depende de la notebook,
// así la misma app sirve en cualquier tele con internet. Todas estas APIs aceptan pedidos desde una
// página (CORS), medido una por una.
const ORIGIN = 'https://api.framextv.xyz';
const MAX_BYTES = 3 * 1024 * 1024;
const SUBTITLE_BYTES = 512 * 1024;
const CACHE_LIMIT = 150;
/** Catálogo, fichas y búsquedas guardados en el navegador como mucho (los más viejos se borran). */
const STORE_LIMIT = 400;
const MAX_PENDING = 6;
const HOME_TTL = 5 * 60_000;
const DETAIL_TTL = 10 * 60_000;
const SEARCH_TTL = 2 * 60_000;
/** Las filas del menú (Películas, Series, Anime, Categorías) cambian poco: media hora. */
const SHELF_TTL = 30 * 60_000;
const PROVIDER_TTL = 60_000;
/** Una fuente encontrada sirve un rato (sus enlaces vencen): volver a "Reproducir" es instantáneo. */
const STREAM_TTL = 15 * 60_000;
/** Cada cuánto se suma el siguiente servidor si el anterior todavía no contestó. */
const STAGGER_MS = 1200;
/** Conexión "tibia": un pedido liviano cada tanto mientras se usa el Cine, y hasta cuándo. */
const WARM_EVERY_MS = 45_000;
const WARM_FOR_MS = 10 * 60_000;
const RAIL_ITEMS = 20;
const SEARCH_ITEMS = 40;
/** La búsqueda tiene que contestar rápido: si la primera vez la API no responde en esto, se reintenta una vez. */
const SEARCH_TIMEOUT = 9000;
/** Los servidores que primero se prueban al pedir "Reproducir" (el resto queda para elegir a mano). */
const PROVIDER_PREFERENCE = [
  'royal_champion', 'titan', 'super_dragon', 'super_barbarian', 'little_prince', 'archer_queen',
  'battle_copter', 'executioner', 'giant', 'bowler', 'root_rider',
] as const;
const RAILS = [
  ['trending_movies', 'Tendencias'], ['popular_movies', 'Películas populares'],
  ['popular_tv', 'Series populares'], ['new_releases', 'Estrenos'],
  ['action_movies', 'Acción'], ['comedy_movies', 'Comedia'],
  ['scifi_movies', 'Ciencia ficción'], ['thriller_movies', 'Suspenso'],
] as const;
/** Los géneros de TMDB (vienen en inglés): fijos, se traducen sin consultar a nadie. */
const GENRES_ES: Readonly<Record<string, string>> = {
  'Action': 'Acción', 'Adventure': 'Aventura', 'Animation': 'Animación', 'Comedy': 'Comedia', 'Crime': 'Crimen',
  'Documentary': 'Documental', 'Drama': 'Drama', 'Family': 'Familia', 'Fantasy': 'Fantasía', 'History': 'Historia',
  'Horror': 'Terror', 'Music': 'Música', 'Mystery': 'Misterio', 'Romance': 'Romance', 'Science Fiction': 'Ciencia ficción',
  'TV Movie': 'Película de TV', 'Thriller': 'Suspenso', 'War': 'Bélica', 'Western': 'Western',
  'Action & Adventure': 'Acción y aventura', 'Kids': 'Infantil', 'News': 'Noticias', 'Reality': 'Reality',
  'Sci-Fi & Fantasy': 'Ciencia ficción y fantasía', 'Soap': 'Telenovela', 'Talk': 'Entrevistas', 'War & Politics': 'Bélica y política',
};
const ID = /^\d{1,12}$/;
const GENRE_LIST = /^\d{1,6}(,\d{1,6}){0,3}$/;
const PROVIDER_ID = /^[a-z_]{1,40}$/;
const SUBTITLE_HOST = /(^|\.)(strem\.io|vdrk\.site|opensubtitles\.org|opensubtitles\.com)$/;
const NETWORK_ERROR = 'La fuente no respondió. Revisá la conexión y reintentá.';
const SPANISH_ONLY_ERROR = 'Este título no tiene audio ni subtítulos en español en los servidores disponibles.';

interface Planned {
  readonly path: string;
  readonly query: URLSearchParams;
  readonly ttl: number;
}
interface StreamPlan extends Planned {
  readonly provider: string;
}
interface Rejected {
  readonly error: string;
}
interface CacheEntry {
  readonly until: number;
  readonly value: Contracts.LibraryReply;
}

/** Una fuente candidata, ya validada, con lo que hace falta para decidir si sirve en español. */
interface CandidateSource {
  readonly url: string;
  readonly type: 'hls' | 'mp4';
  readonly quality: string;
  readonly server: string;
  readonly audio: string;
  readonly audioTracks: readonly Contracts.LibraryAudioTrack[];
}

const rejected = (error: string): Rejected => ({ error });
const isPlanned = (value: Planned | Rejected): value is Planned => 'path' in value;
const isStreamPlan = (value: StreamPlan | Rejected): value is StreamPlan => 'provider' in value;

function safeUrl(value: unknown, protocols: readonly string[]): string {
  try {
    const url = new URL(asString(value));
    return protocols.includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

/** Miniatura del tamaño justo: las tarjetas no necesitan la imagen de 500 px (menos bytes y memoria). */
function image(value: unknown, size: 'w342' | 'w780'): string {
  const url = safeUrl(value, ['https:']);
  if (!url || url.includes('placeholder.com')) return '';
  return url.replace(/\/(w\d+|original)\//, `/${size}/`);
}

function clean(value: unknown, max: number): string {
  return asString(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function rating(value: unknown): string {
  const text = typeof value === 'number' ? value.toFixed(1) : asString(value);
  return /^\d{1,2}(\.\d)?$/.test(text) ? text : '';
}

/**
 * ¿Ese código o etiqueta es español/castellano? Se aceptan las dos formas: "es"/"spa" y los nombres
 * ("Spanish", "Español", "Castellano", "Latino"). No confundir con "Estonian" (et).
 */
function isSpanish(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return false;
  if (/^(es|spa)([-_]|$)/.test(text)) return true;
  return /(^|[^a-z])(español|espanol|castellano|spanish|latino|latina)([^a-z]|$)/.test(text);
}

/** "Subtitles • Spanish (2)" → "Spanish (2)"; si no hay etiqueta útil, "Español". */
function subtitleLabel(value: string): string {
  return value.replace(/^subtitles?\s*[•·-]\s*/i, '').trim() || 'Español';
}

/** Para Argentina: primero las variantes latinas, después las de España. */
function latinRank(subtitle: Contracts.LibrarySubtitle): number {
  return /latino|latina|\(la\)|\bla\b/i.test(`${subtitle.label} ${subtitle.url}`) ? 0 : 1;
}

function idOf(value: unknown): string {
  const id = typeof value === 'number' ? String(value) : asString(value);
  return ID.test(id) ? id : '';
}

function unique<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

const SRT_TIME = /(\d{1,2}:\d{2}:\d{2}),(\d{3})/g;

/**
 * SRT → WebVTT: encabezado y tiempos con punto ("00:01:09,069" → "00:01:09.069"). Si no parece un
 * SRT (no tiene ninguna línea de tiempos), null.
 */
function srtToVtt(text: string): string | null {
  const body = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!/^\d+\n\d{1,2}:\d{2}:\d{2},\d{3} --> /m.test(body)) return null;
  return `WEBVTT\n\n${body.replace(SRT_TIME, '$1.$2')}\n`;
}

/** Para comparar textos: minúsculas, sin tildes ni signos ("Rápidos & Furiosos" → "rapidos furiosos"). */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
}

/**
 * Orden de los resultados: primero lo que coincide con lo escrito (igual, empieza igual, tiene todas
 * las palabras), después el orden de relevancia de la API; los que no tienen póster van al final.
 */
function rankSearch(items: readonly Contracts.LibraryTitle[], text: string): Contracts.LibraryTitle[] {
  // Los artículos del principio no cuentan: "matrix" es igual a "The Matrix", "padrino" a "El Padrino".
  const core = (value: string): string => fold(value).replace(/^(the|a|an|el|la|los|las|un|una) /, '');
  const query = core(text);
  // Sin espacios ni guiones para comparar: "spiderman" es igual a "Spider-Man".
  const compactQuery = query.replace(/ /g, '');
  const words = query.split(' ').filter((word) => word.length > 1);
  const score = (item: Contracts.LibraryTitle, index: number): number => {
    const title = core(item.title);
    const compact = title.replace(/ /g, '');
    const match = compact === compactQuery ? 3
      : compact.startsWith(compactQuery) ? 2
        : words.length > 0 && words.every((word) => new RegExp(`(^| )${word}`).test(title)) ? 1 : 0;
    // Entre los que coinciden igual ("Matrix", "Matrix", "Matrix"), primero el de mejor puntaje
    // (suele ser el que se busca: la de 1999 y no un documental).
    return match * 100 + (Number(item.rating) || 0) * 2 + (item.poster ? 0 : -500) - index;
  };
  return items.map((item, index) => ({ item, value: score(item, index) }))
    .sort((a, b) => b.value - a.value).map(({ item }) => item);
}

/** Si una búsqueda no trae nada (error de tipeo), una versión más corta: "avengrs" → "aveng". */
function looserQuery(text: string): string | null {
  const words = text.split(' ');
  const last = words[words.length - 1] ?? '';
  if (last.length < 5) return null;
  words[words.length - 1] = last.slice(0, Math.ceil(last.length * 0.7));
  return words.join(' ');
}

function providerIds(value: unknown): string[] {
  return asArray(value).flatMap((item) => (PROVIDER_ID.test(asString(item)) ? [asString(item)] : []));
}

/** Adaptador de la API usada por la web pública de FrameX. */
export class FramexLibrary {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<Contracts.LibraryReply>>();
  /** Fuentes ya encontradas (por título/episodio), para reproducir al instante. */
  private readonly resolved = new Map<string, CacheEntry>();
  private readonly resolving = new Map<string, Promise<Contracts.LibraryReply>>();

  private lastUse = 0;
  private warmTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly request: typeof fetch = (input, init) => fetch(input, init),
    private readonly translator: Translator | null = null,
    /** Donde queda el catálogo entre usos (null: sólo en memoria). */
    private readonly store: KeyValueStore | null = null,
    /** Mantener abierta la conexión con la API mientras se usa (en las pruebas, no). */
    private readonly warm = false,
    /** La API oficial de TMDB, si la persona puso su clave (si no, las filas salen de FrameX). */
    private readonly tmdb: TmdbAccess | null = null,
  ) {
    void store?.trim(STORE_LIMIT).catch(() => undefined);
  }

  /**
   * Las sinopsis en español. Ficha y episodios esperan la traducción (como mucho un rato; después
   * salen de la memoria al instante). En catálogo y búsqueda se usan las ya traducidas y el resto se
   * traduce en segundo plano, sin demorar la respuesta.
   */
  private async inSpanish(reply: Contracts.LibraryReply, op: string): Promise<Contracts.LibraryReply> {
    const translator = this.translator;
    if (!translator || reply.error) return reply;
    const swap = <T extends Contracts.LibraryTitle>(item: T): T => {
      const spanish = translator.known(item.overview);
      return spanish ? { ...item, overview: spanish } : item;
    };
    if (op === 'home' || op === 'search' || op === 'shelf') {
      translator.warm([
        ...(reply.hero ? [reply.hero.overview] : []),
        ...(reply.rows ?? []).flatMap((row) => row.items.map((item) => item.overview)),
        ...(reply.items ?? []).map((item) => item.overview),
      ]);
      return {
        ...reply,
        ...(reply.hero ? { hero: swap(reply.hero) } : {}),
        ...(reply.rows ? { rows: reply.rows.map((row) => ({ ...row, items: row.items.map(swap) })) } : {}),
        ...(reply.items ? { items: reply.items.map(swap) } : {}),
      };
    }
    if (op === 'details' && reply.details) {
      const overview = await capped(translator.translate(reply.details.overview, true), reply.details.overview);
      return { ...reply, details: { ...reply.details, overview, related: (reply.details.related ?? []).map(swap) } };
    }
    if (op === 'season' && reply.episodes) {
      const episodes = reply.episodes;
      const overviews = await Promise.all(episodes.map((episode) => capped(translator.translate(episode.overview, true), episode.overview)));
      return { ...reply, episodes: episodes.map((episode, index) => ({ ...episode, overview: overviews[index] ?? episode.overview })) };
    }
    return reply;
  }

  /**
   * Mientras se usa el Cine (pedidos en los últimos 10 min), la conexión con la API se mantiene
   * abierta con un pedido liviano cada 45 s: la próxima búsqueda o "Reproducir" no espera a abrirla.
   */
  private keepWarm(): void {
    this.lastUse = Date.now();
    if (this.warmTimer) return;
    this.warmTimer = setInterval(() => {
      if (Date.now() - this.lastUse > WARM_FOR_MS) {
        if (this.warmTimer) clearInterval(this.warmTimer);
        this.warmTimer = null;
        return;
      }
      // Directo a la red (sin la memoria de 60 s): si no, a veces no sale ningún pedido y la conexión se cierra.
      void this.json(`${ORIGIN}/api/providers`, 8000).then((raw) => {
        this.remember(`${ORIGIN}/api/providers`, PROVIDER_TTL, this.providers(asRecord(raw)));
      }, () => undefined);
    }, WARM_EVERY_MS);
  }

  async query(params: URLSearchParams): Promise<Contracts.LibraryReply> {
    if (this.warm) this.keepWarm();
    const op = params.get('op') ?? 'home';
    if (op === 'resolve') return this.resolve(params);
    if (op === 'stream') {
      const plan = this.streamPlan(params);
      if (!isStreamPlan(plan)) return plan;
      return this.stream(plan, plan.provider).catch(() => rejected(NETWORK_ERROR));
    }
    if (op === 'search') return this.inSpanish(await this.search(params), op);
    // Las filas de TMDB ya vienen en español; las de FrameX se traducen como el catálogo.
    if (op === 'shelf') return this.tmdb ? this.shelf(params) : this.inSpanish(await this.shelf(params), op);
    if (op === 'translate') {
      const text = (params.get('text') ?? '').trim().slice(0, 1800);
      if (!text) return rejected('No hay texto para traducir.');
      return { translated: this.translator ? await this.translator.translate(text, true) : text };
    }
    const plan = this.plan(op, params);
    if (!isPlanned(plan)) return plan;
    return this.inSpanish(await this.cached(`${ORIGIN}${plan.path}?${plan.query.toString()}`, plan.ttl, () => this.load(plan)), op);
  }

  /**
   * Búsqueda: "Batman", "batman" y "BATMAN" (o con y sin tildes) son la misma (una sola consulta y
   * caché). Trae dos páginas a la vez (40 resultados), las ordena por coincidencia con lo escrito y,
   * si no hay nada, prueba una versión más corta por si hubo un error de tipeo.
   */
  private search(params: URLSearchParams): Promise<Contracts.LibraryReply> {
    const text = (params.get('q') ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!text) return Promise.resolve(rejected('Escribí algo para buscar.'));
    return this.cached(`search:${fold(text)}`, SEARCH_TTL, async () => {
      const exact = await this.searchPages(text);
      if (exact.length > 0) return { items: rankSearch(exact, text).slice(0, SEARCH_ITEMS) };
      const looser = looserQuery(text);
      if (!looser) return { items: [] };
      const near = await this.searchPages(looser);
      return near.length > 0 ? { items: rankSearch(near, looser).slice(0, SEARCH_ITEMS), approximate: looser } : { items: [] };
    });
  }

  /** ¿Hay clave de TMDB? (Anime, plataformas e idioma original sólo se pueden armar con TMDB). */
  get hasTmdb(): boolean {
    return this.tmdb !== null;
  }

  /**
   * Una fila del menú (op=shelf): con TMDB, en español y con todos los filtros; sin TMDB, el
   * "discover" de FrameX, que sólo filtra por tipo y género. Queda guardada como el catálogo.
   */
  private shelf(params: URLSearchParams): Promise<Contracts.LibraryReply> {
    const type = params.get('type');
    const sort = params.get('sort') ?? 'popular';
    const value = (key: string, pattern: RegExp): string | null => {
      const text = params.get(key) ?? '';
      return text === '' || pattern.test(text) ? text : null;
    };
    const genres = value('genres', GENRE_LIST);
    const language = value('language', /^[a-z]{2}$/);
    const country = value('country', /^[A-Z]{2}$/);
    const network = value('network', /^\d{1,7}$/);
    const provider = value('provider', /^\d{1,7}$/);
    if ((type !== 'movie' && type !== 'tv') || (sort !== 'popular' && sort !== 'top' && sort !== 'recent')
      || genres === null || language === null || country === null || network === null || provider === null) {
      return Promise.resolve(rejected('Fila no válida.'));
    }
    const shelf: ShelfQuery = { type, sort, genres, language, country, network, provider, trending: params.get('trending') === '1' };
    const tmdb = this.tmdb;
    if (!tmdb && (language || country || network || provider)) return Promise.resolve(rejected('Esta fila necesita TMDB.'));
    const key = `shelf:${tmdb ? 'tmdb' : 'framex'}:${JSON.stringify(shelf)}`;
    return this.cached(key, SHELF_TTL, async () => {
      if (tmdb) {
        const { path, query } = tmdbShelf(shelf, new Date().toISOString().slice(0, 10));
        const raw = await this.json(tmdb.url(path, query), 20_000, tmdb.headers);
        return { items: this.titles(tmdbResults(raw, type), RAIL_ITEMS) };
      }
      // FrameX: tendencias propias; "más votadas" por cantidad de votos (por puntaje salen títulos
      // con un solo voto) y "recientes" del año en curso.
      if (shelf.trending) {
        const raw = asRecord(await this.json(`${ORIGIN}/api/trending?${new URLSearchParams({ type }).toString()}`));
        return { items: this.titles(raw['results'], RAIL_ITEMS) };
      }
      const query = new URLSearchParams({ type, page: '1' });
      if (genres) query.set('genre', genres);
      if (sort === 'top') query.set('sort', 'vote_count.desc');
      if (sort === 'recent') query.set('year', String(new Date().getFullYear()));
      const raw = asRecord(await this.json(`${ORIGIN}/api/discover?${query.toString()}`));
      return { items: this.titles(raw['results'], RAIL_ITEMS) };
    });
  }

  /** Las dos primeras páginas de resultados (la primera con un reintento si la API no contesta). */
  private async searchPages(text: string): Promise<Contracts.LibraryTitle[]> {
    const page = (number: number): Promise<Readonly<Record<string, unknown>>> => this.json(
      `${ORIGIN}/api/search?${new URLSearchParams({ q: text, type: 'multi', page: String(number) }).toString()}`, SEARCH_TIMEOUT,
    ).then(asRecord);
    const first = await page(1).catch(() => page(1));
    const pages = asNullableNumber(first['totalPages']) ?? 1;
    const second = pages > 1 ? await page(2).catch(() => ({})) : {};
    // La API a veces repite títulos entre una página y la otra: se quitan los repetidos.
    return unique([...this.titles(first['results'], 100), ...this.titles(asRecord(second)['results'], 100)],
      (title) => `${title.type}:${title.id}`);
  }

  /**
   * Trae un subtítulo como WebVTT (el reproductor lo carga desde la memoria). Sólo de los hosts de
   * subtítulos que ya usa la API, por HTTPS.
   */
  async subtitle(value: string): Promise<string | null> {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password || !SUBTITLE_HOST.test(url.hostname)) return null;
    const response = await this.request(url.href, {
      signal: AbortSignal.timeout(10_000), redirect: 'error', headers: { Accept: 'text/vtt,text/plain;q=0.9' },
    });
    if (!response.ok || !response.body) return null;
    const text = await this.readText(response.body, SUBTITLE_BYTES);
    if (/^\uFEFF?WEBVTT/.test(text)) return text;
    // Muchos subt\u00EDtulos (los de series, de strem.io) vienen en SRT: el navegador s\u00F3lo entiende
    // WebVTT. Se convierten (antes se rechazaban y la serie quedaba sin subt\u00EDtulos).
    return srtToVtt(text);
  }

  // ---------- Rutas ----------

  private plan(op: string, params: URLSearchParams): Planned | Rejected {
    if (op === 'home') return { path: '/api/home', query: new URLSearchParams(), ttl: HOME_TTL };
    if (op === 'providers') return { path: '/api/providers', query: new URLSearchParams(), ttl: PROVIDER_TTL };
    if (op === 'details' || op === 'season') {
      const id = params.get('id') ?? '';
      const type = params.get('type') ?? '';
      if (!ID.test(id) || (type !== 'movie' && type !== 'tv')) return rejected('Título no válido.');
      const query = new URLSearchParams({ id, type });
      if (op === 'season') {
        if (type !== 'tv') return rejected('Sólo las series tienen temporadas.');
        const season = params.get('season') ?? '';
        if (!/^\d{1,4}$/.test(season)) return rejected('Temporada no válida.');
        query.set('season', season);
      }
      return { path: `/api/${op}`, query, ttl: DETAIL_TTL };
    }
    return rejected('Operación no válida.');
  }

  private streamPlan(params: URLSearchParams): StreamPlan | Rejected {
    const id = params.get('id') ?? '';
    const type = params.get('type') ?? '';
    const provider = params.get('provider') ?? '';
    if (!ID.test(id) || (type !== 'movie' && type !== 'tv') || !PROVIDER_ID.test(provider)) {
      return rejected('Servidor o título no válido.');
    }
    return { path: '/api/stream', query: this.streamQuery(params, provider), ttl: 0, provider };
  }

  private streamQuery(params: URLSearchParams, provider: string): URLSearchParams {
    const type = params.get('type') ?? '';
    const query = new URLSearchParams({ id: params.get('id') ?? '', type, provider });
    if (type === 'tv') {
      query.set('season', params.get('season') ?? '1');
      query.set('episode', params.get('episode') ?? '1');
    }
    return query;
  }

  // ---------- Caché y red ----------

  private async cached(
    key: string, ttl: number, load: () => Promise<Contracts.LibraryReply>,
  ): Promise<Contracts.LibraryReply> {
    const hit = this.cache.get(key) ?? await this.stored(key);
    if (hit && hit.until > Date.now()) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.value;
    }
    const existing = this.pending.get(key);
    // Vencido pero guardado (catálogo, fichas, búsquedas): se contesta YA con lo guardado y se
    // actualiza por detrás; si cambió, la próxima vez ya sale lo nuevo ("stale-while-revalidate").
    if (hit && ttl > 0) {
      if (!existing && this.pending.size < MAX_PENDING) void this.refresh(key, ttl, load);
      return hit.value;
    }
    if (existing) return existing;
    if (this.pending.size >= MAX_PENDING) return rejected('Hay varias consultas en curso. Probá de nuevo en unos segundos.');
    return this.refresh(key, ttl, load);
  }

  private refresh(key: string, ttl: number, load: () => Promise<Contracts.LibraryReply>): Promise<Contracts.LibraryReply> {
    const task = load().then((value) => {
      if (!value.error) this.remember(key, ttl, value);
      return value;
    }).catch((): Contracts.LibraryReply => rejected(NETWORK_ERROR))
      .finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  private remember(key: string, ttl: number, value: Contracts.LibraryReply): void {
    this.cache.delete(key);
    if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value ?? '');
    this.cache.set(key, { value, until: Date.now() + ttl });
    if (ttl > 0) void this.store?.set(key, value).catch(() => undefined);
  }

  /** Lo guardado en el navegador de la vez anterior: se muestra y se actualiza por detrás. */
  private async stored(key: string): Promise<CacheEntry | undefined> {
    if (!this.store) return undefined;
    try {
      const value = await this.store.get(key);
      if (!value || typeof value !== 'object') return undefined;
      const entry = { until: 0, value: value as Contracts.LibraryReply };
      this.cache.set(key, entry);
      return entry;
    } catch {
      return undefined;
    }
  }

  private async load(plan: Planned): Promise<Contracts.LibraryReply> {
    const raw = asRecord(await this.json(`${ORIGIN}${plan.path}?${plan.query.toString()}`));
    if (raw['success'] === false) return rejected('La fuente no tiene disponible ese contenido.');
    if (plan.path === '/api/home') return this.home(raw);
    if (plan.path === '/api/details') return this.details(raw);
    if (plan.path === '/api/season') return this.episodes(raw);
    if (plan.path === '/api/providers') return this.providers(raw);
    return rejected('Operación no válida.');
  }

  private async json(url: string, timeout = 20_000, headers: Readonly<Record<string, string>> = {}): Promise<unknown> {
    const response = await this.request(url, {
      signal: AbortSignal.timeout(timeout), redirect: 'error', headers: { Accept: 'application/json', ...headers },
    });
    if (!response.ok || !response.body) throw new Error('Fuente no disponible');
    const text = await this.readText(response.body, MAX_BYTES);
    return JSON.parse(text) as unknown;
  }

  private async readText(body: ReadableStream<Uint8Array>, limit: number): Promise<string> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const packet: unknown = await reader.read();
        const result = asRecord(packet);
        if (result['done'] === true) break;
        const value = result['value'];
        if (!(value instanceof Uint8Array)) throw new Error('Respuesta incompatible');
        size += value.length;
        if (size > limit) throw new Error('Respuesta demasiado grande');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const decoder = new TextDecoder();
    return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
  }

  // ---------- Armado de la respuesta ----------

  private home(raw: Readonly<Record<string, unknown>>): Contracts.LibraryReply {
    const hero = this.title(asRecord(raw['hero']), 600);
    const rails = asRecord(raw['rails']);
    const rows = RAILS.map(([id, name]) => ({ name, items: this.titles(asRecord(rails[id])['results'], RAIL_ITEMS) }))
      .filter((row) => row.items.length > 0);
    if (!rows.length) return rejected('El catálogo vino vacío. Reintentá en unos minutos.');
    return { ...(hero ? { hero: { ...hero, overview: hero.overview, genres: [] } } : {}), rows };
  }

  private details(raw: Readonly<Record<string, unknown>>): Contracts.LibraryReply {
    const base = this.title(raw, 1800);
    if (!base) return rejected('No se encontraron datos de ese título.');
    const seasons = asArray(raw['seasons']).flatMap((item) => {
      const season = asRecord(item);
      const number = asNullableNumber(season['season_number']);
      if (number === null || !Number.isInteger(number) || number < 0 || number > 999) return [];
      const episodes = asNullableNumber(season['episode_count']) ?? 0;
      return [{ number, name: clean(season['name'], 80) || `Temporada ${number}`, episodes: Math.max(0, episodes) }];
    });
    const uniqueSeasons = unique(seasons, (season) => String(season.number))
      .sort((a, b) => (a.number === 0 ? 1 : b.number === 0 ? -1 : a.number - b.number));
    const cast = asArray(raw['cast']).slice(0, 8).flatMap((item) => {
      const person = asRecord(item);
      const name = clean(person['name'], 80);
      return name ? [{ name, character: clean(person['character'], 80) }] : [];
    });
    const genres = unique(asArray(raw['genres']).map((genre) => clean(genre, 40)).filter(Boolean)
      .map((genre) => GENRES_ES[genre] ?? genre), (genre) => genre);
    const related = unique(asArray(raw['similar']).flatMap((item) => {
      const title = this.title(asRecord(item), 0);
      return title ? [title] : [];
    }), (title) => `${title.type}:${title.id}`).slice(0, 12);
    return {
      details: {
        ...base,
        genres: genres.slice(0, 5),
        runtime: asNullableNumber(raw['runtime']),
        originalLanguage: clean(raw['original_language'], 8).toLowerCase(),
        cast,
        seasons: uniqueSeasons,
        related,
      },
    };
  }

  private episodes(raw: Readonly<Record<string, unknown>>): Contracts.LibraryReply {
    const seasonNumber = asNullableNumber(raw['season_number']);
    const season = seasonNumber !== null && seasonNumber >= 0 ? seasonNumber : 0;
    const episodes = asArray(raw['episodes']).flatMap((item) => {
      const episode = asRecord(item);
      const number = asNullableNumber(episode['episode_number']);
      if (number === null || !Number.isInteger(number) || number < 0 || number > 9999) return [];
      return [{
        season,
        episode: number,
        name: clean(episode['name'], 160) || `Episodio ${number}`,
        overview: clean(episode['overview'], 700),
        still: image(episode['still'], 'w342'),
        rating: rating(episode['vote_average']),
      }];
    }).sort((a, b) => a.episode - b.episode);
    return { episodes };
  }

  private providers(raw: Readonly<Record<string, unknown>>): Contracts.LibraryReply {
    const rank = (id: string): number => {
      const index = PROVIDER_PREFERENCE.indexOf(id as (typeof PROVIDER_PREFERENCE)[number]);
      return index < 0 ? PROVIDER_PREFERENCE.length : index;
    };
    const providers = asArray(raw['providers']).flatMap((item) => {
      const provider = asRecord(item);
      const id = asString(provider['id']);
      if (provider['status'] !== 'available' || provider['clientOnly'] === true || !PROVIDER_ID.test(id)) return [];
      return [{ id, name: clean(provider['name'], 60) || id, tagline: clean(provider['tagline'], 80) }];
    }).sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
    return { providers };
  }

  private async stream(plan: Planned, provider: string): Promise<Contracts.LibraryReply> {
    const raw = asRecord(await this.json(`${ORIGIN}${plan.path}?${plan.query.toString()}`));
    const subtitles = unique(asArray(raw['subtitles']).flatMap((item) => {
      const subtitle = asRecord(item);
      const url = safeUrl(subtitle['url'], ['https:']);
      const host = url ? new URL(url).hostname : '';
      if (!url || !SUBTITLE_HOST.test(host)) return [];
      const lang = clean(subtitle['lang'], 20).toLowerCase();
      const label = clean(subtitle['label'], 80);
      if (!isSpanish(lang) && !isSpanish(label)) return [];
      return [{ url, label: subtitleLabel(label), lang }];
    }), (subtitle) => subtitle.url).sort((a, b) => latinRank(a) - latinRank(b));
    // El idioma original sólo hace falta cuando no hay subtítulos en español y la fuente no anuncia
    // sus pistas de audio (se consulta una vez y queda en la caché de la ficha).
    const original = subtitles.length > 0 ? '' : await this.originalLanguage(plan.query.get('id') ?? '', plan.query.get('type') ?? '');
    const collected = unique(asArray(raw['sources']).flatMap((item): CandidateSource[] => {
      const source = asRecord(item);
      const url = safeUrl(source['url'], ['https:', 'http:']);
      const rawType = source['type'];
      if (!url) return [];
      let type: 'hls' | 'mp4';
      if (rawType === 'hls') type = 'hls';
      else if (rawType === 'mp4') type = 'mp4';
      else return [];
      const audioTracks = asArray(source['audioTracks']).flatMap((track): Contracts.LibraryAudioTrack[] => {
        const record = asRecord(track);
        const lang = clean(record['language'] ?? record['lang'], 20).toLowerCase();
        const label = clean(record['label'], 40);
        return lang !== '' || label !== '' ? [{ lang, label }] : [];
      });
      return [{
        url, type,
        quality: clean(source['quality'], 20) || 'Auto',
        server: clean(source['server'], 80) || provider,
        audio: clean(source['audio'], 20).toLowerCase(),
        audioTracks,
      }];
    }), (source) => source.url);
    // Sólo se aceptan fuentes que puedan verse en español: pista de audio española, subtítulos en
    // español, o título original en español sin datos de audio que lo contradigan.
    const sources = collected.filter((source) => {
      const spanishAudio = source.audio !== ''
        ? isSpanish(source.audio)
        : source.audioTracks.some((track) => isSpanish(track.lang) || isSpanish(track.label));
      const hasAudioInfo = source.audio !== '' || source.audioTracks.length > 0;
      return spanishAudio || subtitles.length > 0 || (!hasAudioInfo && isSpanish(original));
    });
    const alternates = unique(providerIds(raw['alternates']).filter((id) => id !== provider), (id) => id);
    if (collected.length > 0 && sources.length === 0) {
      return { provider: asString(raw['provider'], provider), sources: [], subtitles, alternates, error: SPANISH_ONLY_ERROR };
    }
    return { provider: asString(raw['provider'], provider), sources, subtitles, alternates };
  }

  /** Idioma original del título, para aceptar audio original español cuando no hay metadatos de pista. */
  private async originalLanguage(id: string, type: string): Promise<string> {
    const plan = this.plan('details', new URLSearchParams({ id, type }));
    if (!isPlanned(plan)) return '';
    const reply = await this.cached(`${ORIGIN}${plan.path}?${plan.query.toString()}`, plan.ttl, () => this.load(plan));
    return reply.details?.originalLanguage ?? '';
  }

  /**
   * "Reproducir": prueba los primeros servidores en paralelo y devuelve el primero (por preferencia)
   * que entregue una fuente. Así no hay que elegir servidor a mano ni esperar de a uno.
   */
  private async resolve(params: URLSearchParams): Promise<Contracts.LibraryReply> {
    const id = params.get('id') ?? '';
    const type = params.get('type') ?? '';
    if (!ID.test(id) || (type !== 'movie' && type !== 'tv')) return rejected('Título no válido.');
    if (type === 'tv') {
      for (const key of ['season', 'episode']) {
        if (!/^\d{1,4}$/.test(params.get(key) ?? '')) return rejected('Temporada o episodio no válido.');
      }
    }
    const exclude = new Set((params.get('exclude') ?? '').split(',').filter((value) => PROVIDER_ID.test(value)));
    const list = await this.cached(`${ORIGIN}/api/providers`, PROVIDER_TTL, async () => {
      return this.providers(asRecord(await this.json(`${ORIGIN}/api/providers`)));
    });
    if (list.error) return list;
    const available = list.providers ?? [];
    if (!available.length) return rejected('No hay servidores disponibles ahora.');
    const candidates = available.filter((provider) => !exclude.has(provider.id)).slice(0, 5);
    if (!candidates.length) return rejected('No quedan más servidores para probar.');
    // Lo mismo pedido hace poco (o pedido por adelantado al abrir la ficha): al instante.
    const key = `${this.streamQuery(params, '').toString()}|${[...exclude].sort().join(',')}`;
    const hit = this.resolved.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    let pending = this.resolving.get(key);
    if (!pending) {
      pending = this.firstWorkingServer(params, candidates, available).finally(() => this.resolving.delete(key));
      this.resolving.set(key, pending);
    }
    const value = await pending;
    if (!value.error) this.resolved.set(key, { until: Date.now() + STREAM_TTL, value });
    if (this.resolved.size > CACHE_LIMIT) this.resolved.delete(this.resolved.keys().next().value ?? '');
    return value;
  }

  /**
   * El primer servidor (en orden de preferencia) que entregue una fuente en español. Se consultan de
   * a uno, escalonados: el preferido arranca solo y, si no contestó en un rato, se suma el siguiente.
   * El que contesta primero gana; los que todavía no arrancaron ya no se consultan. Antes se
   * consultaban 5 a la vez y se esperaba a todos (medido: 10,8 s para una película).
   */
  private firstWorkingServer(
    params: URLSearchParams, candidates: readonly Contracts.LibraryProvider[], available: readonly Contracts.LibraryProvider[],
  ): Promise<Contracts.LibraryReply> {
    return new Promise((done) => {
      let finished = false;
      let pendingCount = candidates.length;
      const failures: (Contracts.LibraryReply | null)[] = [];
      const timers: ReturnType<typeof setTimeout>[] = [];
      const finish = (reply: Contracts.LibraryReply): void => {
        if (finished) return;
        finished = true;
        for (const timer of timers) clearTimeout(timer);
        done(reply);
      };
      candidates.forEach((provider, index) => {
        timers.push(setTimeout(() => {
          if (finished) return;
          void this.stream({ path: '/api/stream', query: this.streamQuery(params, provider.id), ttl: 0 }, provider.id)
            .catch((): Contracts.LibraryReply | null => null)
            .then((result) => {
              if (result && (result.sources?.length ?? 0) > 0) {
                const others = available.filter((other) => other.id !== result.provider).map((other) => other.id);
                finish({ ...result, alternates: unique(others, (value) => value) });
                return;
              }
              failures.push(result);
              pendingCount--;
              if (pendingCount > 0) return;
              const blockedByLanguage = failures.some((failure) => failure?.error === SPANISH_ONLY_ERROR);
              finish(rejected(blockedByLanguage ? SPANISH_ONLY_ERROR : 'Ningún servidor entregó una fuente compatible. Probá otro título.'));
            });
        }, index * STAGGER_MS));
      });
    });
  }

  private title(raw: Readonly<Record<string, unknown>>, overviewLength: number): Contracts.LibraryTitle | null {
    const id = idOf(raw['id']);
    const type = raw['type'];
    const title = clean(raw['title'], 200);
    if (!id || (type !== 'movie' && type !== 'tv') || !title) return null;
    return {
      id,
      type,
      title,
      poster: image(raw['poster'] ?? raw['image'], 'w342'),
      backdrop: image(raw['backdrop'], 'w780'),
      year: clean(raw['year'], 4),
      rating: rating(raw['rating']),
      overview: clean(raw['overview'], overviewLength),
    };
  }

  private titles(value: unknown, limit: number): readonly Contracts.LibraryTitle[] {
    return unique(asArray(value).flatMap((item) => {
      // Sinopsis corta: el destacado del Cine la muestra al elegir la tarjeta (dos líneas alcanzan).
      const title = this.title(asRecord(item), 240);
      return title ? [title] : [];
    }), (title) => `${title.type}:${title.id}`).slice(0, limit);
  }
}
