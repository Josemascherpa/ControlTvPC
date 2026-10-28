import type { DisplayPower, InputLock, Logger, MediaActivity, PhysicalTv, SettingsStore, TvScreen } from '../domain/ports';
import { Signal } from '../domain/signal';

const HOUR_MS = 3_600_000;

/**
 * "Prender/apagar" la tele. Si se conoce el tele del HDMI ([PhysicalTv], con su MAC), el botón de
 * encendido del celular lo prende y lo apaga de verdad; si no, apagar es cortar la imagen del HDMI
 * (el tele queda sin señal y muchos se apagan solos al rato). Cuando el tele se prende (con lo que
 * sea), la tele aparece al frente. Además, como un tele de verdad, se apaga sola si nadie la usa
 * por varias horas y no se está viendo nada.
 */
export class PowerService {
  readonly changed = new Signal<boolean>();
  /** Alguien usó la tele (celular, inicio). */
  readonly activity = new Signal<void>();
  private on = true;
  private lastActivity = Date.now();

  constructor(
    private readonly display: DisplayPower,
    private readonly screen: TvScreen,
    private readonly inputLock: InputLock,
    private readonly settings: SettingsStore,
    private readonly log: Logger,
    private readonly media: MediaActivity,
    private readonly tv: PhysicalTv | null = null,
  ) {
    display.keepAwake(true);
    tv?.turnedOn.subscribe(() => {
      this.log.info('El tele se prendió: la tele al frente');
      void this.wake();
    });
    setInterval(() => void this.checkAutoOff(), 60_000).unref();
  }

  get isOn(): boolean {
    return this.on;
  }

  /** Alguien usó la tele: reinicia la cuenta del apagado automático. */
  touch(): void {
    this.lastActivity = Date.now();
    this.activity.emit();
  }

  async toggle(): Promise<void> {
    const tv = this.tv;
    if (!tv?.mac) {
      if (this.on) await this.turnOff();
      else await this.wake();
      return;
    }
    if (!(await tv.checkOn())) {
      await tv.turnOn();
      await this.wake();
    } else if (!this.on) {
      await this.wake(); // el tele estaba prendido sin imagen: vuelve la imagen
    } else {
      await this.turnOff();
      await tv.turnOff(); // si no se puede por la red, queda sin señal y se apaga solo
    }
  }

  async turnOff(): Promise<void> {
    if (!this.on) return;
    this.log.info('Apagando la imagen');
    this.on = false;
    await this.screen.goHome(); // corta el video que se estaba viendo
    this.display.turnOff();
    this.display.keepAwake(false); // la pantalla se puede apagar; la notebook sigue despierta
    this.changed.emit(false);
  }

  /** Prende la imagen (si estaba apagada), trae la tele al frente y toma el control del mouse. */
  async wake(): Promise<void> {
    this.touch();
    this.inputLock.lock();
    if (!this.on) {
      this.on = true;
      this.display.keepAwake(true);
      this.display.turnOn();
      this.changed.emit(true);
    }
    await this.screen.show();
  }

  private async checkAutoOff(): Promise<void> {
    const hours = this.settings.get('autoOffHours');
    if (hours > 0 && this.on && Date.now() - this.lastActivity > hours * HOUR_MS && !(await this.media.isPlaying())) {
      await this.turnOff();
    }
  }
}
