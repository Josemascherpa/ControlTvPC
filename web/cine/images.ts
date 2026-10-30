/** Sólo TMDB ofrece estas variantes: otras URLs conservan exactamente su ruta. */
export function tmdbSize(url: string, size: 'w300' | 'w342' | 'w780' | 'w1280'): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'image.tmdb.org') return url;
    parsed.pathname = parsed.pathname.replace(/^\/t\/p\/(?:w\d+|original)\//, `/t/p/${size}/`);
    return parsed.href;
  } catch {
    return url;
  }
}
