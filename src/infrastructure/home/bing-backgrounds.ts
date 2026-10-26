import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { asArray, asString, isRecord } from '../storage/json';
import { getBytes, getJson } from './http';

const MAX_BACKGROUNDS = 16;

/** Menos que esto no es una foto 4K de verdad (Bing a veces responde con una imagen de "no disponible"). */
const MIN_UHD_BYTES = 300_000;

async function downloadBest(base: string): Promise<Buffer> {
  const uhd = await getBytes(`https://www.bing.com${base}_UHD.jpg`).catch(() => null);
  return uhd && uhd.length >= MIN_UHD_BYTES ? uhd : getBytes(`https://www.bing.com${base}_1920x1080.jpg`);
}

/**
 * Fotos de fondo: las portadas de Bing (cambian todos los días). Se bajan una sola vez a disco
 * en 4K (UHD): reducidas a la pantalla Full HD se ven mucho más nítidas que las de 1920×1080 de
 * Bing, que vienen muy comprimidas. Si no hay versión 4K, la de 1920×1080. Las viejas se borran.
 */
export class BingBackgrounds {
  constructor(private readonly dir: string) {}

  async refresh(previous: readonly Contracts.Background[]): Promise<readonly Contracts.Background[]> {
    const pages = await Promise.all([0, 7].map((idx) =>
      getJson(`https://www.bing.com/HPImageArchive.aspx?format=js&idx=${idx}&n=8&mkt=es-AR`).catch(() => null)));
    const images = pages.flatMap((page) => (isRecord(page) ? asArray(page['images']).filter(isRecord) : []));
    const known = new Map(previous.map((b) => [b.file, b]));
    const result: Contracts.Background[] = [];

    for (const image of images) {
      if (result.length >= MAX_BACKGROUNDS) break;
      const base = asString(image['urlbase']);
      if (!base) continue;
      const file = `${createHash('md5').update(base).digest('hex').slice(0, 12)}-uhd.jpg`;
      if (result.some((b) => b.file === file)) continue;
      const target = join(this.dir, file);
      if (!existsSync(target)) {
        try {
          await writeFile(target, await downloadBest(base));
        } catch {
          continue; // una foto que no baja no es un problema: seguimos con las demás
        }
      }
      const copyright = asString(image['copyright']);
      result.push(known.get(file) ?? {
        file,
        caption: copyright.replace(/\s*\(©.*\)\s*$/, ''),
        credit: /\(©\s*([^)]*)\)/.exec(copyright)?.[1] ?? '',
      });
    }

    if (result.length > 0) {
      const keep = new Set(result.map((b) => b.file));
      for (const file of await readdir(this.dir)) {
        if (!keep.has(file)) await rm(join(this.dir, file), { force: true });
      }
    }
    return result.length > 0 ? result : previous;
  }
}
