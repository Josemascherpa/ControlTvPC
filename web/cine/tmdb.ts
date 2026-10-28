import { asArray, asNullableNumber, asRecord, asString } from '../../shared/json.js';

// La API oficial de TMDB (themoviedb.org), para las filas del menú: entrega títulos y sinopsis en
// español y sabe filtrar por idioma original, país, cadena y plataforma (FrameX no). Necesita una
// clave gratuita de la persona (ajustes.json); sin clave, el Cine usa FrameX para lo que puede.
// Los ids son los mismos que usa FrameX: cualquier título de TMDB se abre y se reproduce igual.

const API = 'https://api.themoviedb.org/3';
const IMAGES = 'https://image.tmdb.org/t/p';

export interface TmdbAccess {
  url(path: string, query: URLSearchParams): string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Acepta las dos credenciales que da TMDB: la "API Key" (v3) o el "token de lectura" (v4). */
export function tmdbAccess(value: string): TmdbAccess | null {
  const key = value.trim();
  if (/^[0-9a-f]{32}$/i.test(key)) {
    return {
      url: (path, query) => {
        const params = new URLSearchParams(query);
        params.set('api_key', key);
        return `${API}${path}?${params.toString()}`;
      },
      headers: {},
    };
  }
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) {
    return { url: (path, query) => `${API}${path}?${query.toString()}`, headers: { Authorization: `Bearer ${key}` } };
  }
  return null;
}

/** Una fila del catálogo, ya validada por la librería. */
export interface ShelfQuery {
  readonly type: 'movie' | 'tv';
  readonly genres: string;
  readonly sort: 'popular' | 'top' | 'recent';
  readonly trending: boolean;
  readonly language: string;
  readonly country: string;
  readonly network: string;
  readonly provider: string;
}

/** La consulta de TMDB para una fila: tendencias o "discover" con filtros, en español de Latinoamérica. */
export function tmdbShelf(shelf: ShelfQuery, today: string): { readonly path: string; readonly query: URLSearchParams } {
  const query = new URLSearchParams({ language: 'es-MX', include_adult: 'false', page: '1' });
  if (shelf.trending) return { path: `/trending/${shelf.type}/week`, query };
  const date = shelf.type === 'movie' ? 'primary_release_date' : 'first_air_date';
  // Con un mínimo de votos: sin eso, "las más votadas" son títulos con un solo voto de 10.
  if (shelf.sort === 'top') {
    query.set('sort_by', 'vote_average.desc');
    query.set('vote_count.gte', shelf.language || shelf.country ? '150' : '600');
  } else if (shelf.sort === 'recent') {
    query.set('sort_by', `${date}.desc`);
    query.set(`${date}.lte`, today);
    query.set('vote_count.gte', '25');
  } else {
    query.set('sort_by', 'popularity.desc');
    query.set('vote_count.gte', '20');
  }
  if (shelf.genres) query.set('with_genres', shelf.genres);
  if (shelf.language) query.set('with_original_language', shelf.language);
  if (shelf.country) query.set('with_origin_country', shelf.country);
  if (shelf.network) query.set('with_networks', shelf.network);
  if (shelf.provider) {
    query.set('with_watch_providers', shelf.provider);
    query.set('watch_region', 'AR');
  }
  return { path: `/discover/${shelf.type}`, query };
}

/** ¿Se lee con letras latinas? (Sin japonés, coreano, chino, cirílico… Números y signos dan igual.) */
export function isLatin(text: string): boolean {
  return !/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(text);
}

/**
 * Algunos títulos (muchos animes) no tienen nombre en español en TMDB y llegan en su idioma original
 * ("ちびまる子ちゃん"): se reemplazan por el nombre en inglés, que suele estar en letras latinas
 * ("Chibi Maruko-chan"). Si tampoco hay, queda el original.
 */
export function withLatinTitles(
  results: readonly Readonly<Record<string, unknown>>[], english: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  const names = new Map(english.map((item) => [item['id'], asString(item['title'])]));
  return results.map((item) => {
    const title = asString(item['title']);
    const other = names.get(item['id']) ?? '';
    return !isLatin(title) && other && isLatin(other) ? { ...item, title: other } : item;
  });
}

/**
 * Los resultados de TMDB con la forma de los de FrameX (la librería los valida igual, con el mismo
 * código): id, tipo, título, imágenes completas, año, puntaje y sinopsis.
 */
export function tmdbResults(raw: unknown, type: 'movie' | 'tv'): readonly Readonly<Record<string, unknown>>[] {
  return asArray(asRecord(raw)['results']).map((item) => {
    const record = asRecord(item);
    const image = (key: string, size: string): string => {
      const path = asString(record[key]);
      return /^\/[\w.-]+$/.test(path) ? `${IMAGES}/${size}${path}` : '';
    };
    return {
      id: asNullableNumber(record['id']) ?? '',
      type,
      title: asString(record[type === 'movie' ? 'title' : 'name']),
      poster: image('poster_path', 'w342'),
      backdrop: image('backdrop_path', 'w780'),
      year: asString(record[type === 'movie' ? 'release_date' : 'first_air_date']).slice(0, 4),
      rating: asNullableNumber(record['vote_average']) ?? '',
      overview: asString(record['overview']),
    };
  });
}
