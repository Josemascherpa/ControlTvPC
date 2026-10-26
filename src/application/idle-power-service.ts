import type { ActivityProbe, Logger, PowerMode, PowerPlans, SettingsStore } from '../domain/ports';
import type { PowerService } from './power-service';

/** Cada cuánto se mira si hubo actividad (es una consulta instantánea a Windows). */
const CHECK_MS = 5000;
/** Un toque de teclado/mouse más reciente que esto despierta el plan Máximo. */
const RECENT_INPUT_MS = CHECK_MS + 1000;

/**
 * Cambia solo el plan de energía, como pidió la persona:
 *   - mientras se usa (celular, teclado, mouse, o algo reproduciéndose) → plan Máximo;
 *   - tras un rato sin uso, o con la imagen apagada → plan Ahorro;
 *   - apenas se vuelve a usar → Máximo otra vez, al instante.
 * Si los planes no existen (no se corrió optimizacion/plan-energia.bat), no hace nada.
 */
export class IdlePowerService {
  private mode: PowerMode | null = null;
  private lastActivity = Date.now();
  private switching: Promise<void> = Promise.resolve();

  constructor(
    private readonly plans: PowerPlans,
    private readonly probe: ActivityProbe,
    private readonly power: PowerService,
    private readonly settings: SettingsStore,
    private readonly log: Logger,
  ) {}

  async start(): Promise<void> {
    if (!this.settings.get('autoPowerPlans')) return;
    if (!(await this.plans.available())) {
      this.log.info('Planes de energía de ControlTv no instalados: corré optimizacion/plan-energia.bat');
      return;
    }
    this.switchTo('performance');
    // Cualquier pedido del celular o del inicio: Máximo enseguida.
    this.power.activity.subscribe(() => {
      this.lastActivity = Date.now();
      this.switchTo('performance');
    });
    // Imagen apagada: no hace falta esperar, la tele no se está usando.
    this.power.changed.subscribe((on) => {
      if (!on) this.switchTo('saver');
    });
    setInterval(() => void this.check(), CHECK_MS).unref();
  }

  private async check(): Promise<void> {
    const sinceInput = this.probe.msSinceInput();
    if (sinceInput < RECENT_INPUT_MS) this.lastActivity = Math.max(this.lastActivity, Date.now() - sinceInput);

    if (this.mode === 'saver') {
      // Alguien tocó el teclado/mouse (o la imagen se volvió a prender): de vuelta al máximo.
      if (this.power.isOn && sinceInput < RECENT_INPUT_MS) this.switchTo('performance');
      return;
    }
    if (!this.power.isOn) {
      this.switchTo('saver');
      return;
    }
    const idleMs = this.settings.get('idleMinutes') * 60_000;
    if (Date.now() - this.lastActivity < idleMs) return;
    // Mirando una película nadie toca nada: si hay algo reproduciéndose, sigue "en uso".
    if (await this.probe.isMediaPlaying()) {
      this.lastActivity = Date.now();
      return;
    }
    this.switchTo('saver');
  }

  private switchTo(mode: PowerMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.switching = this.switching
      .then(() => this.plans.activate(mode))
      .then(() => {
        this.log.info(mode === 'performance' ? 'Plan de energía: Máximo (en uso)' : 'Plan de energía: Ahorro (sin uso)');
      })
      .catch((error: unknown) => {
        this.mode = null; // que lo vuelva a intentar en la próxima revisión
        this.log.warn('No se pudo cambiar el plan de energía:', error);
      });
  }
}
