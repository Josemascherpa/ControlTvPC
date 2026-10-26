import { byId } from './dom.js';

function imageById(id: string): HTMLImageElement {
  const found = byId(id);
  if (!(found instanceof HTMLImageElement)) throw new Error(`#${id} tiene que ser un <img>`);
  return found;
}

const ROTATE_MS = 50_000;

/**
 * Fotos de fondo que cambian solas con un fundido suave. Dos capas que se turnan: la nueva foto
 * se carga y decodifica entera antes de aparecer, así nunca se ve "a medio cargar".
 */
export class BackgroundRotator {
  private readonly layers = [imageById('bg-a'), imageById('bg-b')] as const;
  private readonly caption = byId('caption');
  private front: 0 | 1 = 0;
  private index = 0;
  private list: readonly Contracts.Background[] = [];
  private timer = 0;

  update(list: readonly Contracts.Background[]): void {
    const firstTime = this.list.length === 0 && list.length > 0;
    this.list = list;
    if (!firstTime) return;
    this.index = Math.floor(Math.random() * list.length);
    this.show();
    this.timer = window.setInterval(() => {
      this.index = (this.index + 1) % this.list.length;
      this.show();
    }, ROTATE_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private show(): void {
    const background = this.list[this.index];
    if (!background) return;
    const next = this.front === 0 ? 1 : 0;
    const incoming = this.layers[next];
    const outgoing = this.layers[this.front];
    incoming.src = `/bg/${encodeURIComponent(background.file)}`;
    // decode(): la foto (en 4K) se decodifica entera fuera de pantalla antes del fundido, así el
    // cambio nunca traba un cuadro.
    void incoming.decode().then(() => {
      incoming.classList.add('on');
      outgoing.classList.remove('on');
      this.front = next;
      this.caption.textContent = background.caption + (background.credit ? `  ·  © ${background.credit}` : '');
    }, () => undefined);
  }
}
