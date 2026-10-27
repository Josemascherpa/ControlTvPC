import type { RemoteCommand, RemoteKey } from '../domain/remote';
import type { MediaKeys, PageKey, TvScreen, UiPublisher } from '../domain/ports';
import type { PointerService, ScrollDirection } from './pointer-service';
import type { PowerService } from './power-service';
import type { VolumeService } from './volume-service';
import { ScreenCommandQueue } from './screen-command-queue';

/**
 * El scroll de dos dedos del touchpad: la app lo manda como 3 flechas iguales seguidas (llegan en
 * pocos milisegundos). Una flecha del control (modo teclado) llega sola.
 */
const SCROLL_KEYS: Partial<Readonly<Record<RemoteKey, ScrollDirection>>> = { UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' };
/** Cuánto se espera, sólo en modo mouse, a ver si una flecha viene en ráfaga (scroll) o sola (navegación). */
const BURST_WINDOW_MS = 80;
/** En modo teclado, una flecha igual a la anterior que llega antes de esto es parte de la misma ráfaga. */
const KEYBOARD_BURST_MS = 40;

/** Una flecha recibida en modo mouse, esperando a ver si llegan más iguales. */
interface PendingArrow {
  readonly key: RemoteKey;
  readonly direction: ScrollDirection;
  count: number;
  readonly timer: NodeJS.Timeout;
}

/** Ejecuta lo que pide el control remoto. No sabe nada del protocolo del celular ni de Edge. */
export class RemoteCommandHandler {
  private pendingArrow: PendingArrow | null = null;
  private lastArrow: { readonly key: RemoteKey; readonly at: number } | null = null;
  private readonly screenCommands = new ScreenCommandQueue();

  constructor(
    private readonly screen: TvScreen,
    private readonly pointer: PointerService,
    private readonly volume: VolumeService,
    private readonly power: PowerService,
    private readonly media: MediaKeys,
    private readonly ui: UiPublisher,
  ) {}

  async handle(command: RemoteCommand): Promise<void> {
    this.power.touch();
    // Con la imagen apagada, cualquier botón la prende (y no hace nada más).
    if (!this.power.isOn && !(command.kind === 'key' && command.key === 'POWER')) {
      await this.power.wake();
      return;
    }
    switch (command.kind) {
      case 'key': return this.pressKey(command.key);
      case 'text':
        this.flushBeforeNext();
        return this.screenCommands.run(() => this.screen.insertText(command.text));
      case 'openUrl':
        this.flushBeforeNext();
        return this.screenCommands.run(() => this.screen.openUrl(command.url));
      case 'pointerMove':
        this.pointer.move(command.dx, command.dy);
        return;
      case 'pointerClick':
        this.pointer.click();
        return;
    }
  }

  private async pressKey(key: RemoteKey): Promise<void> {
    const direction = SCROLL_KEYS[key];
    // En modo mouse una flecha es ambigua: se espera un instante para ver si es una ráfaga (scroll).
    if (direction && this.pointer.inUse) {
      if (this.pendingArrow?.key === key) {
        this.pendingArrow.count++;
        return;
      }
      this.flushBeforeNext();
      this.pendingArrow = { key, direction, count: 1, timer: setTimeout(() => {
        void this.flushArrow().catch(() => undefined); // desconexión: la siguiente orden vuelve a intentar
      }, BURST_WINDOW_MS) };
      return;
    }
    this.flushBeforeNext(); // encola la flecha antes de la nueva orden, sin ceder el turno
    // Modo teclado: flechas iguales pegadas (el deslizar del celular manda varias en pocos ms) cuentan
    // como UNA. Si no, cada una salta una fila y la página se atrasa (medido en Netflix: ráfagas de 17
    // flechas en 2 s y hasta 200 ms de demora por tecla).
    if (direction) {
      const now = Date.now();
      const previous = this.lastArrow;
      this.lastArrow = { key, at: now };
      if (previous?.key === key && now - previous.at < KEYBOARD_BURST_MS) return;
    }
    this.pointer.hide();
    switch (key) {
      case 'UP': case 'DOWN': case 'LEFT': case 'RIGHT': return this.screenCommands.run(() => this.screen.pressKey(key), key);
      case 'OK': return this.screenCommands.run(() => this.screen.pressKey('ENTER'));
      case 'BACK': return this.screenCommands.run(() => this.screen.back());
      case 'HOME': return this.screenCommands.run(() => this.screen.atHome ? this.screen.pressKey('ESCAPE') : this.screen.goHome());
      case 'MENU':
        return this.screenCommands.run(async () => {
          if (!this.screen.atHome) await this.screen.goHome();
          this.ui.publish({ type: 'menu' });
        });
      case 'CHANNEL_UP': return this.screenCommands.run(() => this.screen.pressKey('PAGE_UP'));
      case 'CHANNEL_DOWN': return this.screenCommands.run(() => this.screen.pressKey('PAGE_DOWN'));
      case 'PLAY_PAUSE':
        return this.screenCommands.run(async () => {
          if (!(await this.screen.togglePlayback?.())) this.media.playPause();
        });
      case 'VOLUME_UP': return this.volume.apply('up');
      case 'VOLUME_DOWN': return this.volume.apply('down');
      case 'MUTE': return this.volume.apply('mute');
      case 'POWER': return this.power.toggle();
    }
  }

  /**
   * Resuelve la flecha que esperaba: si llegaron varias iguales era el scroll de dos dedos (cada una
   * desplaza); si llegó sola era el control en modo teclado: termina el modo mouse y navega.
   */
  private async flushArrow(): Promise<void> {
    const pending = this.pendingArrow;
    if (!pending) return;
    this.pendingArrow = null;
    clearTimeout(pending.timer);
    if (pending.count > 1) {
      for (let i = 0; i < pending.count; i++) this.pointer.scroll(pending.direction);
      return;
    }
    this.pointer.hide();
    await this.screenCommands.run(() => this.screen.pressKey(pending.key as PageKey), pending.key);
  }

  private flushBeforeNext(): void {
    // flushArrow encola sincrónicamente. Esperar su respuesta acá permitiría que otra
    // orden entrante se adelante al Enter/texto que está detrás de esa flecha.
    void this.flushArrow().catch(() => undefined);
  }
}
