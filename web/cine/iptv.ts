import { asString } from '../../shared/json.js';

// Canales de TV abierta de Latinoamérica y España. El listado público de iptv-org (GitHub Pages)
// junta los enlaces de los canales que sus dueños publican para verse por internet; acá sólo se
// leen los datos y se valida cada enlace (HTTPS, HLS o MP4). A diferencia de zlive, estas señales
// se reproducen con el reproductor de la app (hls.js), sin iframe.
//
// Todas las listas por país aceptan pedidos desde una página (CORS: *, medido) y pesan pocos KB.

export interface IptvCountry {
  readonly code: string;
  readonly name: string;
  /** La lista del país trae canales en varios idiomas: se queda sólo con los que suenan en español. */
  readonly spanishOnly?: boolean;
}

/**
 * Países hispanohablantes con lista propia en iptv-org, en orden de interés para la casa. Los
 * primeros se muestran como fila aparte; el resto se junta en "Resto de Latinoamérica".
 */
export const IPTV_COUNTRIES: readonly IptvCountry[] = [
  { code: 'ar', name: 'Argentina' },
  { code: 'mx', name: 'México' },
  { code: 'es', name: 'España' },
  { code: 'co', name: 'Colombia' },
  { code: 'cl', name: 'Chile' },
  { code: 'pe', name: 'Perú' },
  { code: 've', name: 'Venezuela' },
  { code: 'uy', name: 'Uruguay' },
  { code: 'ec', name: 'Ecuador' },
  { code: 'bo', name: 'Bolivia' },
  { code: 'py', name: 'Paraguay' },
  { code: 'do', name: 'República Dominicana' },
  { code: 'gt', name: 'Guatemala' },
  { code: 'cr', name: 'Costa Rica' },
  { code: 'hn', name: 'Honduras' },
  { code: 'sv', name: 'El Salvador' },
  { code: 'ni', name: 'Nicaragua' },
  { code: 'pa', name: 'Panamá' },
  { code: 'cu', name: 'Cuba' },
  { code: 'pr', name: 'Puerto Rico' },
  // Estados Unidos tiene cientos de canales (la mayoría en inglés): sólo se toman los hispanos.
  { code: 'us', name: 'Estados Unidos (español)', spanishOnly: true },
];

export const IPTV_BASE = 'https://iptv-org.github.io/iptv/countries';
export const IPTV_PLAYLIST = (code: string): string => `${IPTV_BASE}/${code}.m3u`;
/** Canales por país: con más, la fila tarda en formarse y hay muchos enlaces caídos. */
const PER_COUNTRY = 24;

/** Los grupos de iptv-org vienen en inglés: se muestran en español. */
const GROUPS: Readonly<Record<string, string>> = {
  general: 'General', news: 'Noticias', sports: 'Deportes', kids: 'Infantiles',
  movies: 'Películas', series: 'Series', music: 'Música', culture: 'Cultural',
  religious: 'Religioso', education: 'Educación', entertainment: 'Entretenimiento',
  documentary: 'Documentales', family: 'Familia', lifestyle: 'Estilo de vida',
  weather: 'Clima', travel: 'Viajes', cooking: 'Cocina', shop: 'Compras',
  auto: 'Autos', business: 'Negocios', comedy: 'Comedia', science: 'Ciencia',
};

const EXTINF = /^#EXTINF:-?\d+(?:\s+(.*))?,(.*)$/;
const ATTRIBUTE = /([\w-]+)="([^"]*)"/g;
const STREAM = /\.(?:m3u8|mp4)(?=$|[?#])/i;
const QUALITY = /\b(4K|UHD|FHD|HD|SD)\b/i;
/** Nombres de canales hispanos de EE. UU. (para no llenar la fila con los de habla inglesa). */
const SPANISH_NAME = /telemundo|univision|unim[aá]s|estrellatv|estrella tv|mega tv|wapa|tudn|galavisi[oó]n|pasiones|cinelatino|cine latino|nuestra visi[oó]n|telexitos|universo|cnn en espa[nñ]ol|espn deportes|fox deportes|vix|multimedios|milenio|azteca|latino|espa[nñ]ol|spanish|canal 22|ntn24|telesur|rt en espa[nñ]ol|noticias ya|buenavisi[oó]n|color visi[oó]n|sur peru|cable noticias/i;

function clean(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Un nombre estable para un enlace (la misma señal conserva su tarjeta entre visitas). */
function hash(value: string): string {
  let result = 5381;
  for (let index = 0; index < value.length; index++) result = ((result << 5) + result + value.charCodeAt(index)) | 0;
  return (result >>> 0).toString(36);
}

function attributes(raw: string): Readonly<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const key = match[1] ?? '';
    const value = match[2] ?? '';
    if (key) found[key.toLowerCase()] = value;
  }
  return found;
}

/** Un enlace reproducible por la app: HTTPS, sin credenciales y con extensión HLS o MP4. */
function streamUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (!STREAM.test(`${url.pathname}${url.search}`)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function logoUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function categoryOf(group: string): string {
  const key = group.trim().toLowerCase();
  return GROUPS[key] ?? (group.trim() ? clean(group, 30) : 'General');
}

/**
 * El listado M3U de un país, ya validado: canales con nombre, enlace HTTPS y categoría en español.
 * Se descartan los enlaces repetidos, los que no son HLS/MP4 y los avisos de iptv-org.
 */
export function iptvChannels(raw: string, country: IptvCountry): Contracts.LibraryChannel[] {
  const lines = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const channels: Contracts.LibraryChannel[] = [];
  const seen = new Set<string>();
  let current: { name: string; group: string; logo: string } | null = null;
  for (const line of lines) {
    const text = line.trim();
    if (text.startsWith('#EXTINF:')) {
      const match = EXTINF.exec(text);
      if (!match) continue;
      const info = attributes(match[1] ?? '');
      const name = clean(match[2] ?? '', 80);
      if (!name) continue;
      current = { name, group: info['group-title'] ?? '', logo: logoUrl(info['tvg-logo'] ?? '') };
      continue;
    }
    if (text.startsWith('#')) continue;
    if (!current) continue;
    const { name, group, logo } = current;
    current = null;
    // Los nombres marcados por iptv-org como no disponibles o de prueba no se muestran.
    if (/\[(?:not 24\/7|geo-blocked|offline|dead|broken)\]|\b(?:test|prueba)\b/i.test(name)) continue;
    if (country.spanishOnly && !SPANISH_NAME.test(name)) continue;
    const url = streamUrl(text);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const quality = QUALITY.exec(name)?.[1]?.toUpperCase() ?? '';
    const cleanName = name
      .replace(/\s*\((?:4K|UHD|FHD|HD|SD)\)\s*$/i, '')
      .replace(/\s*\[(?:4K|UHD|FHD|HD|SD)\]\s*$/i, '')
      .replace(/\s+(?:4K|UHD|FHD|HD|SD)\s*$/i, '')
      .trim();
    channels.push({
      id: `iptv:${country.code}:${hash(url)}`,
      name: cleanName || name,
      category: categoryOf(group),
      region: country.name,
      quality: quality === 'UHD' ? '4K' : quality,
      spanish: true,
      url,
      source: 'iptv',
      logo,
      country: country.code,
    });
    if (channels.length >= PER_COUNTRY) break;
  }
  return channels;
}

/** El país de un canal de iptv-org (para armar las filas), o null si no es de esta fuente. */
export function iptvCountryOf(channel: Contracts.LibraryChannel): IptvCountry | null {
  if (channel.source !== 'iptv') return null;
  const code = asString(channel.country);
  return IPTV_COUNTRIES.find((country) => country.code === code) ?? null;
}
