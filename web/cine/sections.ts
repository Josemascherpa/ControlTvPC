// Las secciones del menú (Películas, Series, Anime, En vivo, Categorías) y las filas de cada una. Son sólo
// datos: cada fila es una consulta al catálogo ("shelf") que la librería resuelve con TMDB (si hay
// clave) o con el discover de FrameX (sin clave, sólo tipo y género). Los ids son los géneros,
// cadenas y plataformas de TMDB.

export type SectionId = 'inicio' | 'favoritos' | 'peliculas' | 'series' | 'anime' | 'latino' | 'envivo' | 'categorias';

export interface Shelf {
  readonly name: string;
  readonly type: 'movie' | 'tv';
  /** Géneros de TMDB; varios = tiene que tener todos ("16,10759": anime de acción). */
  readonly genres?: string;
  readonly sort?: 'popular' | 'top' | 'recent';
  readonly trending?: boolean;
  /** Idioma original ("es", "ja"). Sólo con TMDB. */
  readonly language?: string;
  /** País de origen ("AR"). Sólo con TMDB. */
  readonly country?: string;
  /** Cadena de TV o plataforma que produce la serie (Netflix, HBO…). Sólo con TMDB. */
  readonly network?: number;
  /** Plataforma donde se ve la película en Argentina. Sólo con TMDB. */
  readonly provider?: number;
}

export interface Section {
  readonly id: SectionId;
  readonly label: string;
}

export const SECTIONS: readonly Section[] = [
  { id: 'inicio', label: 'Inicio' },
  { id: 'favoritos', label: 'Favoritos' },
  { id: 'peliculas', label: 'Películas' },
  { id: 'series', label: 'Series' },
  { id: 'anime', label: 'Anime' },
  { id: 'latino', label: 'Latinoamérica' },
  { id: 'envivo', label: 'En vivo' },
  { id: 'categorias', label: 'Categorías' },
];

/** Una categoría: el mismo género tiene id distinto en películas y en series (o no existe). */
export interface Category {
  readonly name: string;
  readonly movie?: string;
  readonly tv?: string;
}

export const CATEGORIES: readonly Category[] = [
  { name: 'Acción', movie: '28', tv: '10759' },
  { name: 'Drama', movie: '18', tv: '18' },
  { name: 'Policiales', movie: '80', tv: '80' },
  { name: 'Comedia', movie: '35', tv: '35' },
  { name: 'Suspenso', movie: '53', tv: '9648' },
  { name: 'Terror', movie: '27' },
  { name: 'Ciencia ficción', movie: '878', tv: '10765' },
  { name: 'Fantasía', movie: '14', tv: '10765' },
  { name: 'Romance', movie: '10749' },
  { name: 'Misterio', movie: '9648', tv: '9648' },
  { name: 'Animación', movie: '16', tv: '16' },
  { name: 'Familia', movie: '10751', tv: '10751' },
  { name: 'Infantiles', tv: '10762' },
  { name: 'Documentales', movie: '99', tv: '99' },
  { name: 'Bélicas', movie: '10752', tv: '10768' },
  { name: 'Historia', movie: '36' },
  { name: 'Western', movie: '37', tv: '37' },
  { name: 'Reality', tv: '10764' },
  { name: 'Telenovelas', tv: '10766' },
];

const MOVIES: readonly Shelf[] = [
  { name: 'Tendencias', type: 'movie', trending: true },
  { name: 'Estrenos', type: 'movie', sort: 'recent' },
  { name: 'Las más votadas', type: 'movie', sort: 'top' },
  { name: 'Acción', type: 'movie', genres: '28' },
  { name: 'Drama', type: 'movie', genres: '18' },
  { name: 'Policiales', type: 'movie', genres: '80' },
  { name: 'Comedia', type: 'movie', genres: '35' },
  { name: 'Cine argentino', type: 'movie', country: 'AR' },
  { name: 'Habladas en español', type: 'movie', language: 'es' },
  { name: 'Suspenso', type: 'movie', genres: '53' },
  { name: 'Terror', type: 'movie', genres: '27' },
  { name: 'Ciencia ficción', type: 'movie', genres: '878' },
  { name: 'En Netflix', type: 'movie', provider: 8 },
  { name: 'En Disney+', type: 'movie', provider: 337 },
  { name: 'En Prime Video', type: 'movie', provider: 119 },
  { name: 'En Max', type: 'movie', provider: 1899 },
  { name: 'Romance', type: 'movie', genres: '10749' },
  { name: 'Animación', type: 'movie', genres: '16' },
  { name: 'Familia', type: 'movie', genres: '10751' },
  { name: 'Documentales', type: 'movie', genres: '99' },
];

const SERIES: readonly Shelf[] = [
  { name: 'Tendencias', type: 'tv', trending: true },
  { name: 'Recientes', type: 'tv', sort: 'recent' },
  { name: 'Las más votadas', type: 'tv', sort: 'top' },
  { name: 'Drama', type: 'tv', genres: '18' },
  { name: 'Policiales', type: 'tv', genres: '80' },
  { name: 'Comedia', type: 'tv', genres: '35' },
  { name: 'Series argentinas', type: 'tv', country: 'AR' },
  { name: 'Habladas en español', type: 'tv', language: 'es' },
  { name: 'Netflix', type: 'tv', network: 213 },
  { name: 'HBO', type: 'tv', network: 49 },
  { name: 'Disney+', type: 'tv', network: 2739 },
  { name: 'Prime Video', type: 'tv', network: 1024 },
  { name: 'Apple TV+', type: 'tv', network: 2552 },
  { name: 'Acción y aventura', type: 'tv', genres: '10759' },
  { name: 'Ciencia ficción y fantasía', type: 'tv', genres: '10765' },
  { name: 'Misterio', type: 'tv', genres: '9648' },
  { name: 'Animación', type: 'tv', genres: '16' },
  { name: 'Documentales', type: 'tv', genres: '99' },
  { name: 'Reality', type: 'tv', genres: '10764' },
  { name: 'Infantiles', type: 'tv', genres: '10762' },
];

// Anime = animación japonesa: sin el idioma original no se puede separar de los dibujos de
// cualquier otro lado, así que esta sección necesita TMDB.
const ANIME: readonly Shelf[] = [
  { name: 'Series de anime populares', type: 'tv', genres: '16', language: 'ja' },
  { name: 'Películas de anime', type: 'movie', genres: '16', language: 'ja' },
  { name: 'Las más votadas', type: 'tv', genres: '16', language: 'ja', sort: 'top' },
  { name: 'Recientes', type: 'tv', genres: '16', language: 'ja', sort: 'recent' },
  { name: 'Acción y aventura', type: 'tv', genres: '16,10759', language: 'ja' },
  { name: 'Fantasía y ciencia ficción', type: 'tv', genres: '16,10765', language: 'ja' },
  { name: 'Comedia', type: 'tv', genres: '16,35', language: 'ja' },
  { name: 'Drama', type: 'tv', genres: '16,18', language: 'ja' },
  { name: 'Películas de anime más votadas', type: 'movie', genres: '16', language: 'ja', sort: 'top' },
];

/** Los países hispanohablantes de América (TMDB acepta varios con "|": cualquiera de ellos). */
const LATAM = 'AR|MX|CO|CL|PE|VE|UY|EC|BO|PY|DO|GT|CR|HN|SV|NI|PA|CU|PR';

// Latinoamérica y España: cine y series por país, telenovelas y todo lo hablado en español. Sólo
// TMDB sabe filtrar por país de origen; sin clave, esta sección se omite (como Anime).
const LATINO: readonly Shelf[] = [
  { name: 'Cine latinoamericano', type: 'movie', country: LATAM },
  { name: 'Películas en español', type: 'movie', language: 'es' },
  { name: 'Cine argentino', type: 'movie', country: 'AR' },
  { name: 'Cine mexicano', type: 'movie', country: 'MX' },
  { name: 'Cine español', type: 'movie', country: 'ES' },
  { name: 'Cine colombiano', type: 'movie', country: 'CO' },
  { name: 'Cine chileno', type: 'movie', country: 'CL' },
  { name: 'Cine peruano', type: 'movie', country: 'PE' },
  { name: 'Cine venezolano', type: 'movie', country: 'VE' },
  { name: 'Cine uruguayo', type: 'movie', country: 'UY' },
  { name: 'Cine ecuatoriano', type: 'movie', country: 'EC' },
  { name: 'Cine cubano', type: 'movie', country: 'CU' },
  { name: 'Cine dominicano', type: 'movie', country: 'DO' },
  { name: 'Comedias latinas', type: 'movie', country: LATAM, genres: '35' },
  { name: 'Terror latino', type: 'movie', country: LATAM, genres: '27' },
  { name: 'Series latinoamericanas', type: 'tv', country: LATAM },
  { name: 'Series en español', type: 'tv', language: 'es' },
  { name: 'Series argentinas', type: 'tv', country: 'AR' },
  { name: 'Series mexicanas', type: 'tv', country: 'MX' },
  { name: 'Series españolas', type: 'tv', country: 'ES' },
  { name: 'Series colombianas', type: 'tv', country: 'CO' },
  { name: 'Series chilenas', type: 'tv', country: 'CL' },
  { name: 'Series latinas de comedia', type: 'tv', country: LATAM, genres: '35' },
  { name: 'Telenovelas', type: 'tv', genres: '10766' },
  { name: 'Telenovelas mexicanas', type: 'tv', genres: '10766', country: 'MX' },
  { name: 'Telenovelas argentinas', type: 'tv', genres: '10766', country: 'AR' },
  { name: 'Telenovelas colombianas', type: 'tv', genres: '10766', country: 'CO' },
  { name: 'Telenovelas más votadas', type: 'tv', genres: '10766', sort: 'top' },
];

/** Lo que sólo sabe filtrar TMDB (FrameX sólo filtra por tipo y género). */
export function needsTmdb(shelf: Shelf): boolean {
  return shelf.language !== undefined || shelf.country !== undefined || shelf.network !== undefined || shelf.provider !== undefined;
}

/** Las filas de una sección, sin las que no se pueden armar sin TMDB. */
export function sectionShelves(id: SectionId, tmdb: boolean): readonly Shelf[] {
  const all = id === 'peliculas' ? MOVIES : id === 'series' ? SERIES : id === 'anime' ? ANIME : id === 'latino' ? LATINO : [];
  return all.filter((shelf) => tmdb || !needsTmdb(shelf));
}

/** Las filas de una categoría: películas y series de ese género, populares y más votadas. */
export function categoryShelves(category: Category): readonly Shelf[] {
  return [
    ...(category.movie ? [{ name: `${category.name}: películas`, type: 'movie' as const, genres: category.movie }] : []),
    ...(category.tv ? [{ name: `${category.name}: series`, type: 'tv' as const, genres: category.tv }] : []),
    ...(category.movie ? [{ name: 'Películas más votadas', type: 'movie' as const, genres: category.movie, sort: 'top' as const }] : []),
    ...(category.tv ? [{ name: 'Series más votadas', type: 'tv' as const, genres: category.tv, sort: 'top' as const }] : []),
    ...(category.movie ? [{ name: 'Películas recientes', type: 'movie' as const, genres: category.movie, sort: 'recent' as const }] : []),
  ];
}

/** La consulta como parámetros para la librería (op=shelf). */
export function shelfParams(shelf: Shelf): Record<string, string> {
  const params: Record<string, string> = { type: shelf.type };
  if (shelf.genres) params['genres'] = shelf.genres;
  if (shelf.sort) params['sort'] = shelf.sort;
  if (shelf.trending) params['trending'] = '1';
  if (shelf.language) params['language'] = shelf.language;
  if (shelf.country) params['country'] = shelf.country;
  if (shelf.network !== undefined) params['network'] = String(shelf.network);
  if (shelf.provider !== undefined) params['provider'] = String(shelf.provider);
  return params;
}
