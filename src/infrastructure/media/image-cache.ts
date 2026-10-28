import { createHash } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { access, readdir, rename, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { pooledFetch } from './http-pool';

// Pósters e imágenes del catálogo, guardados en el SSD. Medido: Edge tardaba ~0,9 s por imagen
// (la red IPv6 de la casa); desde acá salen por IPv4 con conexiones reusadas, en WebP (TMDB lo
// entrega si se lo pide: ~30 % menos que el JPG) y la segunda vez directo del disco (~2 ms).

const ALLOWED = /^https:\/\/image\.tmdb\.org\/t\/p\/(w\d+|original)\/[\w.-]+\.(jpe?g|png|webp)$/i;
const CONCURRENCY = 6;
const TIMEOUT_MS = 10_000;
/** Tope del disco: al arrancar, si hay más, se borran las más viejas. */
const MAX_FILES = 6000;

export interface CachedImage {
  readonly file: string;
  readonly type: string;
}

export class ImageCache {
  private readonly inflight = new Map<string, Promise<CachedImage | null>>();
  private readonly queue: (() => void)[] = [];
  private running = 0;

  constructor(private readonly dir: string, private readonly request: typeof fetch = pooledFetch) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    void this.prune();
  }

  /** La imagen guardada (o la baja y la guarda). null si la dirección no es de TMDB o no se pudo. */
  get(url: string): Promise<CachedImage | null> {
    if (!ALLOWED.test(url)) return Promise.resolve(null);
    const name = createHash('sha1').update(url).digest('hex');
    let pending = this.inflight.get(name);
    if (!pending) {
      pending = this.fromDisk(name)
        .then((hit) => hit ?? this.limited(() => this.download(url, name)))
        .catch(() => null)
        .finally(() => this.inflight.delete(name));
      this.inflight.set(name, pending);
    }
    return pending;
  }

  private async fromDisk(name: string): Promise<CachedImage | null> {
    for (const [ext, type] of TYPES) {
      const file = join(this.dir, name + ext);
      if (await access(file).then(() => true, () => false)) return { file, type };
    }
    return null;
  }

  private async download(url: string, name: string): Promise<CachedImage | null> {
    const response = await this.request(url, {
      headers: { accept: 'image/webp,image/*;q=0.8' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    const ext = TYPES.find(([, known]) => known === type)?.[0];
    if (!ext) return null;
    const file = join(this.dir, name + ext);
    // Se escribe aparte y se renombra: nunca queda a medias una imagen que después se sirva rota.
    const partial = `${file}.part`;
    await writeFile(partial, Buffer.from(await response.arrayBuffer()));
    await rename(partial, file);
    return { file, type };
  }

  private limited<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        this.running++;
        task().then(resolve, (error: unknown) => { reject(error instanceof Error ? error : new Error(String(error))); }).finally(() => {
          this.running--;
          this.queue.shift()?.();
        });
      };
      if (this.running < CONCURRENCY) run();
      else this.queue.push(run);
    });
  }

  private async prune(): Promise<void> {
    try {
      const names = await readdir(this.dir);
      if (names.length <= MAX_FILES) return;
      const files = await Promise.all(names.map(async (name) => {
        const file = join(this.dir, name);
        return { file, at: (await stat(file)).mtimeMs };
      }));
      files.sort((a, b) => a.at - b.at);
      for (const { file } of files.slice(0, files.length - MAX_FILES)) await unlink(file).catch(() => undefined);
    } catch {
      // limpiar es opcional
    }
  }
}

const TYPES: readonly (readonly [string, string])[] = [
  ['.webp', 'image/webp'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
];
