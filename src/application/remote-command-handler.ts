import type { RemoteCommand, RemoteKey } from '../domain/remote';
import type { MediaKeys, TvScreen, UiPublisher } from '../domain/ports';
import type { PointerService, ScrollDirection } from './pointer-service';
import type { PowerService } from './power-service';
import type { VolumeService } from './volume-service';

/**
 * Con el touchpad en uso, las flechas que manda la app al deslizar con dos dedos son scroll
 * (vertical hoy; horizontal queda listo para cuando la app lo mande).
 */
const SCROLL_KEYS: Partial<Readonly<Record<RemoteKey, ScrollDirection>>> = { UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' };

/** Ejecuta lo que pide el control remoto. No sabe nada del protocolo del celular ni de Edge. */
export class RemoteCommandHandler {
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
      case 'text': return this.screen.insertText(command.text);
      case 'openUrl': return this.screen.openUrl(command.url);
      case 'pointerMove':
        this.pointer.move(command.dx, command.dy);
        return;
      case 'pointerClick':
        this.pointer.click();
        return;
    }
  }

  private async pressKey(key: RemoteKey): Promise<void> {
    const scroll = SCROLL_KEYS[key];
    if (scroll && this.pointer.inUse) {
      this.pointer.scroll(scroll);
      return;
    }
    this.pointer.hide();
    switch (key) {
      case 'UP': case 'DOWN': case 'LEFT': case 'RIGHT': return this.screen.pressKey(key);
      case 'OK': return this.screen.pressKey('ENTER');
      case 'BACK': return this.screen.back();
      case 'HOME': return this.screen.atHome ? this.screen.pressKey('ESCAPE') : this.screen.goHome();
      case 'MENU':
        if (!this.screen.atHome) await this.screen.goHome();
        this.ui.publish({ type: 'menu' });
        return;
      case 'CHANNEL_UP': return this.screen.pressKey('PAGE_UP');
      case 'CHANNEL_DOWN': return this.screen.pressKey('PAGE_DOWN');
      case 'PLAY_PAUSE':
        this.media.playPause();
        return;
      case 'VOLUME_UP': return this.volume.apply('up');
      case 'VOLUME_DOWN': return this.volume.apply('down');
      case 'MUTE': return this.volume.apply('mute');
      case 'POWER': return this.power.toggle();
    }
  }
}
