import { asArray, asRecord, asString } from '../../shared/json.js';

// Canales en vivo de zlive.st. Su API pública es un listado (embed/manifest.json, con CORS) de
// canales con el enlace a su reproductor para insertar ("embed"). El video viene protegido (tickets
// y enlaces firmados): no se saca de ahí, se usa su reproductor tal cual, en un marco aislado que no
// puede abrir ventanas ni salir del Cine.

export const LIVE_MANIFEST = 'https://zlive.st/embed/manifest.json';
const EMBED = 'https://zlive.st/embed/';
const SLUG = /^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/;

const CATEGORIES: Readonly<Record<string, string>> = {
  sports: 'Deportes', football: 'Deportes', f1: 'Fórmula 1', kids: 'Infantiles',
  entertainment: 'Entretenimiento', news: 'Noticias',
};

/** En español: por el nombre (Deportes, Movistar, LA 1, Telefe…) o por el país. */
function isSpanishChannel(name: string, region: string, flag: string): boolean {
  return /espa[nñ]ol|deportes|movistar|spain|españa|latino|m[eé]xico|argentin|\bla 1\b|telemundo|univision|unimas|tudn|boing|tyc|telefe|eltrece|canal 13|caracol|\brcn\b|azteca|las estrellas|galavisi[oó]n|pasiones|wapa|rcn novelas|espn deportes/i.test(name)
    || /^(es|mx|ar|co|cl|pe|uy|ve)$/i.test(flag) || /^(spain|mexico|argentina)$/i.test(region);
}

function categoryOf(name: string, sport: string): string {
  if (/news|noticias|cnn|bloomberg|cnbc|sky news|euronews/i.test(name)) return 'Noticias';
  return CATEGORIES[sport.trim().toLowerCase()] ?? 'Otros canales';
}

/** El listado de zlive, validado: sólo canales al aire con enlace a su propio reproductor. */
export function liveChannels(raw: unknown): Contracts.LibraryChannel[] {
  const seen = new Set<string>();
  return asArray(asRecord(raw)['channels']).flatMap((item) => {
    const channel = asRecord(item);
    const id = asString(channel['id']);
    const name = asString(channel['name']).replace(/\s+/g, ' ').trim().slice(0, 80);
    // Los que el propio listado marca como rotos o de prueba no se muestran.
    if (!SLUG.test(id) || !name || channel['live'] === false || seen.has(id) || /\[broken\]|\btest\b/i.test(name)) return [];
    if (asString(channel['url']) !== `${EMBED}${id}`) return [];
    seen.add(id);
    const region = asString(channel['region']).slice(0, 30);
    return [{
      id, name, region,
      category: categoryOf(name, asString(channel['sport'])),
      quality: asString(channel['quality']).slice(0, 10),
      spanish: isSpanishChannel(name, region, asString(channel['flag'])),
      url: `${EMBED}${id}`,
      source: 'zlive',
    }];
  });
}
