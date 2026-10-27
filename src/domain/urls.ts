// Reglas sobre direcciones web, en TypeScript puro (fáciles de probar).

/**
 * YouTube: las búsquedas y videos "normales" que manda el celular se pasan a la versión para TV,
 * que se maneja cómoda con las flechas.
 */
export function toTvUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  // Sólo YouTube común (no YouTube Music, que tiene su propia app).
  if (!/^(www\.|m\.)?youtube\.com$/.test(parsed.hostname) || parsed.pathname.startsWith('/tv')) return url;
  const query = parsed.searchParams.get('search_query');
  if (query) return `https://www.youtube.com/tv#/search?q=${encodeURIComponent(query)}`;
  const video = parsed.searchParams.get('v');
  if (video) return `https://www.youtube.com/tv#/watch?v=${encodeURIComponent(video)}`;
  return 'https://www.youtube.com/tv';
}

/**
 * El "sitio" de una dirección: el dominio registrado, sin subdominios
 * (www.youtube.com → youtube.com; player.ejemplo.com.ar → ejemplo.com.ar).
 */
export function siteOf(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return '';
  }
  const parts = host.split('.');
  // Dominios con dos partes al final, como .com.ar o .co.uk: el sitio tiene tres partes.
  const twoPartEnding = parts.length >= 3 && (parts.at(-2) ?? '').length <= 3 && (parts.at(-1) ?? '').length === 2;
  return parts.slice(twoPartEnding ? -3 : -2).join('.');
}

/** true si las dos direcciones son del mismo sitio. */
export function sameSite(a: string, b: string): boolean {
  const site = siteOf(a);
  return site !== '' && site === siteOf(b);
}

/** true si la dirección es de ese dominio o de un subdominio (www.youtube.com → youtube.com). */
export function belongsTo(url: string, domain: string): boolean {
  if (!domain) return false;
  try {
    const host = new URL(url).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}
