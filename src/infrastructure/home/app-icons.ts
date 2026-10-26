import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import type { AppCatalog } from '../../domain/ports';
import { getBytes } from './http';

/** Formatos de los íconos que vienen con la app (ui/app-icons/<id>.<formato>). */
const BUNDLED_FORMATS: readonly string[] = ['svg', 'png', 'webp', 'jpg'];

/**
 * Íconos de las apps. Primero los que vienen con la app (logos oficiales, nítidos); si una app no
 * tiene, se baja una vez del servicio de íconos de Google y queda en disco.
 */
export class AppIcons {
  private readonly downloading = new Map<string, Promise<string | null>>();

  constructor(private readonly dir: string, private readonly bundledDir: string, private readonly apps: AppCatalog) {}

  /** Devuelve la ruta del ícono, o null si la app no existe o no se pudo bajar. */
  pathFor(appId: string): Promise<string | null> {
    const app = this.apps.find(appId);
    if (!app?.domain) return Promise.resolve(null);
    const bundled = BUNDLED_FORMATS.map((format) => join(this.bundledDir, `${app.id}.${format}`)).find((path) => existsSync(path));
    if (bundled) return Promise.resolve(bundled);
    const file = join(this.dir, `${app.id}.png`);
    if (existsSync(file)) return Promise.resolve(file);
    // Si se pide dos veces mientras baja, comparten la misma descarga.
    let pending = this.downloading.get(app.id);
    if (!pending) {
      pending = getBytes(`https://www.google.com/s2/favicons?domain=${app.domain}&sz=256`, 8000)
        .then(async (bytes) => {
          await writeFile(file, bytes);
          return file;
        })
        .catch(() => null)
        .finally(() => this.downloading.delete(app.id));
      this.downloading.set(app.id, pending);
    }
    return pending;
  }
}
