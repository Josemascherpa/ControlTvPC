import type { MediaLibrary } from '../../domain/media-library';
import { asArray, asNullableNumber, asRecord, asString } from '../storage/json';

// Catálogo propio. La API pública de FrameX entrega metadatos (TMDB) y, por título, la lista de
// servidores con una fuente HLS o MP4. Nunca se ejecuta JavaScript de terceros ni se reenvían URLs
// arbitrarias: todo lo que sale de acá ya está validado.
const ORIGIN = 'https://api.framextv.xyz';
const MAX_BYTES = 3 * 1024 * 1024;
const SUBTITLE_BYTES = 512 * 1024;
const CACHE_LIMIT = 48;
const MAX_PENDING = 4;
const HOME_TTL = 5 * 60_000;
const DETAIL_TTL = 10 * 60_000;
const SEARCH_TTL = 2 * 60_000;
const PROVIDER_TTL = 60_000;
const RAIL_ITEMS = 20;
const SEARCH_ITEMS = 24;
/** Los servidores que primero se prueban al pedir "Reproducir" (el resto queda para elegir a mano). */
const PROVIDER_PREFERENCE = [
  'royal_champion', 'titan', 'super_barbarian', 'little_prince', 'archer_queen',
  'battle_copter', 'executioner', 'giant', 'bowler', 'root_rider',
] as const;
const RAILS = [
  ['trending_movies', 'Tendencias'], ['popular_movies', 'Películas populares'],
  ['popular_tv', 'Series populares'], ['new_releases', 'Estrenos'],
  ['action_movies', 'Acción'], ['comedy_movies', 'Comedia'],
  ['scifi_movies', 'Ciencia ficción'], ['thriller_movies', 'Suspenso'],
] as const;
const ID = /^\d{1,12}$/;
const PROVIDER_ID = /^[a-z_]{1,40}$/;
const SUBTITLE_HOST = /(^|\.)strem\.io$/;
const NETWORK_ERROR = 'La fuente no respondió. Revisá la conexión y reintentá.';

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

function providerIds(value: unknown): string[] {
  return asArray(value).flatMap((item) => (PROVIDER_ID.test(asString(item)) ? [asString(item)] : []));
}

/** Adaptador de la API usada por la web pública de FrameX. */
export class FramexLibrary implements MediaLibrary {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<Contracts.LibraryReply>>();

  constructor(private readonly request: typeof fetch = fetch) {}

  async query(params: URLSearchParams): Promise<Contracts.LibraryReply> {
    const op = params.get('op') ?? 'home';
    if (op === 'resolve') return this.resolve(params);
    if (op === 'stream') {
      const plan = this.streamPlan(params);
      if (!isStreamPlan(plan)) return plan;
      return this.stream(plan, plan.provider).catch(() => rejected(NETWORK_ERROR));
    }
    const plan = this.plan(op, params);
    if (!isPlanned(plan)) return plan;
    return this.cached(`${ORIGIN}${plan.path}?${plan.query.toString()}`, plan.ttl, () => this.load(plan));
  }

  /**
   * Trae subtítulos por el servidor local: el reproductor no depende de CORS ni de dominios ajenos.
   * Sólo se aceptan los hosts de subtítulos que ya usa la API.
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
    return /^\uFEFF?WEBVTT/.test(text) ? text : null;
  }

  // ---------- Rutas ----------

  private plan(op: string, params: URLSearchParams): Planned | Rejected {
    if (op === 'home') return { path: '/api/home', query: new URLSearchParams(), ttl: HOME_TTL };
    if (op === 'providers') return { path: '/api/providers', query: new URLSearchParams(), ttl: PROVIDER_TTL };
    if (op === 'search') {
      const text = (params.get('q') ?? '').trim().slice(0, 120);
      if (!text) return rejected('Escribí algo para buscar.');
      const query = new URLSearchParams({ q: text, type: 'multi', page: '1' });
      return { path: '/api/search', query, ttl: SEARCH_TTL };
    }
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
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.value;
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= MAX_PENDING) return rejected('Hay varias consultas en curso. Probá de nuevo en unos segundos.');
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
  }

  private async load(plan: Planned): Promise<Contracts.LibraryReply> {
    const raw = asRecord(await this.json(`${ORIGIN}${plan.path}?${plan.query.toString()}`));
    if (raw['success'] === false) return rejected('La fuente no tiene disponible ese contenido.');
    if (plan.path === '/api/home') return this.home(raw);
    if (plan.path === '/api/search') return { items: this.titles(raw['results'], SEARCH_ITEMS) };
    if (plan.path === '/api/details') return this.details(raw);
    if (plan.path === '/api/season') return this.episodes(raw);
    if (plan.path === '/api/providers') return this.providers(raw);
    return rejected('Operación no válida.');
  }

  private async json(url: string): Promise<unknown> {
    const response = await this.request(url, {
      signal: AbortSignal.timeout(20_000), redirect: 'error', headers: { Accept: 'application/json' },
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
    return Buffer.concat(chunks).toString('utf8');
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
    const genres = unique(asArray(raw['genres']).map((genre) => clean(genre, 40)).filter(Boolean), (genre) => genre);
    const related = unique(asArray(raw['similar']).flatMap((item) => {
      const title = this.title(asRecord(item), 0);
      return title ? [title] : [];
    }), (title) => `${title.type}:${title.id}`).slice(0, 12);
    return {
      details: {
        ...base,
        genres: genres.slice(0, 5),
        runtime: asNullableNumber(raw['runtime']),
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
    const sources = unique(asArray(raw['sources']).flatMap((item) => {
      const source = asRecord(item);
      const url = safeUrl(source['url'], ['https:', 'http:']);
      const rawType = source['type'];
      if (!url) return [];
      let type: 'hls' | 'mp4';
      if (rawType === 'hls') type = 'hls';
      else if (rawType === 'mp4') type = 'mp4';
      else return [];
      return [{ url, type, quality: clean(source['quality'], 20) || 'Auto', server: clean(source['server'], 80) || provider }];
    }), (source) => source.url);
    const subtitles = unique(asArray(raw['subtitles']).flatMap((item) => {
      const subtitle = asRecord(item);
      const url = safeUrl(subtitle['url'], ['https:']);
      const host = url ? new URL(url).hostname : '';
      if (!url || !SUBTITLE_HOST.test(host)) return [];
      return [{ url, label: clean(subtitle['label'], 80), lang: clean(subtitle['lang'], 20).toLowerCase() }];
    }), (subtitle) => subtitle.url).sort((a, b) => Number(b.lang.startsWith('es')) - Number(a.lang.startsWith('es')));
    return {
      provider: asString(raw['provider'], provider),
      sources,
      subtitles,
      alternates: unique(providerIds(raw['alternates']).filter((id) => id !== provider), (id) => id),
    };
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
    const candidates = available.filter((provider) => !exclude.has(provider.id)).slice(0, 4);
    if (!candidates.length) return rejected('No quedan más servidores para probar.');
    const results = await Promise.all(candidates.map(async (provider): Promise<Contracts.LibraryReply | null> => {
      try {
        return await this.stream({ path: '/api/stream', query: this.streamQuery(params, provider.id), ttl: 0 }, provider.id);
      } catch {
        return null;
      }
    }));
    for (const result of results) {
      if (result && (result.sources?.length ?? 0) > 0) {
        const others = available.filter((provider) => provider.id !== result.provider).map((provider) => provider.id);
        return { ...result, alternates: unique(others, (value) => value) };
      }
    }
    return rejected('Ningún servidor entregó una fuente compatible. Probá otro título.');
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
      const title = this.title(asRecord(item), 0);
      return title ? [title] : [];
    }), (title) => `${title.type}:${title.id}`).slice(0, limit);
  }
}
