// Reglas sobre direcciones web, en TypeScript puro (fáciles de probar).

/**
 * Lo que se buscó, si la dirección es una búsqueda de Google (lo que manda el botón "Buscar" del
 * celular: https://www.google.com/search?q=...). null si es otra dirección.
 */
export function googleSearchQuery(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/^(www\.)?google\.[a-z.]+$/.test(parsed.hostname) || parsed.pathname !== '/search') return null;
    const query = (parsed.searchParams.get('q') ?? '').trim();
    return query || null;
  } catch {
    return null;
  }
}
