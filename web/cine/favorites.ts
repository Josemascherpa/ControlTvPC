// Favoritos: películas, series y anime que la persona guarda desde la ficha. Se guardan en el propio
// navegador (localStorage), con lo justo para dibujar la tarjeta y abrir la ficha sin volver a pedir
// nada: tipo, id, título, imagen, año, puntaje y sinopsis. Sobreviven a reiniciar el Cine.

const FAVORITES_KEY = 'cine:favorites:v1';
/** Tope: más que esto no entra en una fila y sólo ocupa lugar. */
const MAX_FAVORITES = 120;

/** Lo mínimo de Storage que se usa (en las pruebas se pasa uno falso). */
export interface FavoriteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Un favorito guardado, ya validado (si el navegador tenía basura, se descarta). */
function favoriteOf(value: unknown): Contracts.LibraryTitle | null {
  if (!isRecord(value)) return null;
  const type = value['type'];
  const id = clean(value['id'], 40);
  const title = clean(value['title'], 160);
  if ((type !== 'movie' && type !== 'tv') || !id || !title) return null;
  return {
    id,
    type,
    title,
    poster: clean(value['poster'], 500),
    backdrop: clean(value['backdrop'], 500),
    year: clean(value['year'], 4),
    rating: clean(value['rating'], 4),
    overview: clean(value['overview'], 2000),
  };
}

/** Todos los favoritos, primero el último que se agregó. */
export function favorites(storage: FavoriteStorage = localStorage): Contracts.LibraryTitle[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(FAVORITES_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item): Contracts.LibraryTitle[] => {
      const favorite = favoriteOf(item);
      return favorite ? [favorite] : [];
    }).slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

/** ¿Ese título ya está en favoritos? */
export function isFavorite(item: Pick<Contracts.LibraryTitle, 'id' | 'type'>, storage: FavoriteStorage = localStorage): boolean {
  return favorites(storage).some((favorite) => favorite.id === item.id && favorite.type === item.type);
}

/**
 * Agrega o quita un favorito. Devuelve `true` si quedó guardado y `false` si se quitó. No falla si
 * el navegador no deja guardar: en ese caso el favorito vale para esta vez.
 */
export function toggleFavorite(item: Contracts.LibraryTitle, storage: FavoriteStorage = localStorage): boolean {
  const current = favorites(storage);
  const exists = current.some((favorite) => favorite.id === item.id && favorite.type === item.type);
  const next = exists
    ? current.filter((favorite) => !(favorite.id === item.id && favorite.type === item.type))
    : [{ ...(favoriteOf(item) ?? item) }, ...current].slice(0, MAX_FAVORITES);
  try {
    storage.setItem(FAVORITES_KEY, JSON.stringify(next));
  } catch {
    // Sin espacio o almacenamiento bloqueado: se sigue usando lo que hay en memoria.
  }
  return !exists;
}
