import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readdir, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { asArray, asString, isRecord } from '../storage/json';
import { getBytes, getJson } from './http';

const MAX_BACKGROUNDS = 16;

/** Menos que esto no es una foto 4K de verdad (Bing a veces responde con una imagen de "no disponible"). */
const MIN_UHD_BYTES = 300_000;

/** El tamaño de la pantalla de la tele, en píxeles reales. */
export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

async function downloadBest(base: string): Promise<Buffer> {
  const uhd = await getBytes(`https://www.bing.com${base}_UHD.jpg`).catch(() => null);
  return uhd && uhd.length >= MIN_UHD_BYTES ? uhd : getBytes(`https://www.bing.com${base}_1920x1080.jpg`);
}

/**
 * Fotos de fondo: las portadas de Bing (cambian todos los días). Se bajan una sola vez en 4K y se
 * achican UNA vez al tamaño exacto de la pantalla con un escalado de alta calidad (resize-image.ps1):
 * más nítidas que las de 1080p que da Bing (muy comprimidas), y Edge carga y dibuja la cuarta parte
 * de píxeles que con la 4K (menos memoria y cambios de foto más livianos). Las viejas se borran.
 */
export class BingBackgrounds {
  constructor(
    private readonly dir: string,
    private readonly resizeScript: string,
    private readonly screen: ScreenSize,
  ) {}

  async refresh(previous: readonly Contracts.Background[]): Promise<readonly Contracts.Background[]> {
    const pages = await Promise.all([0, 7].map((idx) =>
      getJson(`https://www.bing.com/HPImageArchive.aspx?format=js&idx=${idx}&n=8&mkt=es-AR`).catch(() => null)));
    const images = pages.flatMap((page) => (isRecord(page) ? asArray(page['images']).filter(isRecord) : []));
    const known = new Map(previous.map((b) => [b.file, b]));
    const result: Contracts.Background[] = [];
    const size = `${String(this.screen.width)}x${String(this.screen.height)}`;

    for (const image of images) {
      if (result.length >= MAX_BACKGROUNDS) break;
      const base = asString(image['urlbase']);
      if (!base) continue;
      const file = `${createHash('md5').update(base).digest('hex').slice(0, 12)}-${size}.jpg`;
      if (result.some((b) => b.file === file)) continue;
      const target = join(this.dir, file);
      if (!existsSync(target)) {
        try {
          await this.saveScaled(await downloadBest(base), target);
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

  /** Guarda la foto achicada a la pantalla; si no se puede achicar, la original (anda igual). */
  private async saveScaled(bytes: Buffer, target: string): Promise<void> {
    const original = `${target}.original`;
    await writeFile(original, bytes);
    const scaled = await new Promise<boolean>((resolve) => {
      execFile('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.resizeScript,
        '-In', original, '-Out', target, '-Width', String(this.screen.width), '-Height', String(this.screen.height),
      ], { windowsHide: true, timeout: 60_000 }, (error) => { resolve(!error && existsSync(target)); });
    });
    if (scaled) await rm(original, { force: true });
    else await rename(original, target);
  }
}
