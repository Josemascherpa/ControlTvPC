// Qué capítulo sigue después de uno dado, dentro de una serie. Salta de temporada sola: si era el
// último de la T1, el siguiente es el primero de la T2 (y así). Es lógica pura para poder probarla.

export interface SeasonInfo {
  readonly number: number;
  readonly episodes: number;
}

export interface EpisodeInfo {
  readonly season: number;
  readonly episode: number;
  readonly name: string;
}

export interface NextEpisode {
  readonly season: number;
  readonly episode: number;
  /** Vacío si la temporada siguiente todavía no se cargó (la ficha igual muestra T y E). */
  readonly name: string;
}

/**
 * El siguiente capítulo de `current`, usando la lista de temporadas de la ficha (con cuántos
 * capítulos tiene cada una) y los capítulos ya cargados (para el nombre). Devuelve null si era el
 * último capítulo de la última temporada.
 */
export function nextEpisode(
  current: { readonly season: number; readonly episode: number },
  seasons: readonly SeasonInfo[],
  loaded: readonly EpisodeInfo[] = [],
): NextEpisode | null {
  const inSeason = loaded.filter((entry) => entry.season === current.season);
  const fromInfo = seasons.find((season) => season.number === current.season)?.episodes ?? 0;
  const total = fromInfo > 0 ? fromInfo : inSeason.reduce((max, entry) => Math.max(max, entry.episode), 0);

  // Todavía quedan capítulos en esta temporada.
  if (total > 0 && current.episode < total) {
    const next = inSeason.find((entry) => entry.episode === current.episode + 1);
    return { season: current.season, episode: current.episode + 1, name: next?.name ?? '' };
  }

  // Era el último: pasa al primer capítulo de la temporada siguiente (sin contar especiales).
  const ordered = seasons.filter((season) => season.number > 0).slice().sort((a, b) => a.number - b.number);
  const index = ordered.findIndex((season) => season.number === current.season);
  if (index >= 0) {
    const following = ordered.slice(index + 1).find((season) => season.episodes > 0);
    if (following) {
      const first = loaded.find((entry) => entry.season === following.number && entry.episode === 1);
      return { season: following.number, episode: 1, name: first?.name ?? '' };
    }
  }

  // Sin la lista de temporadas (o con datos incompletos): lo que haya en los capítulos cargados.
  if (total === 0) {
    const next = loaded.find((entry) => entry.season === current.season && entry.episode === current.episode + 1)
      ?? loaded.find((entry) => entry.season === current.season + 1 && entry.episode === 1);
    if (next) return { season: next.season, episode: next.episode, name: next.name };
  }
  return null;
}
