import type { Logger, PointerSurface, SettingsStore } from '../domain/ports';

/** Mientras se use el touchpad (y este rato después), las flechas son scroll en vez de navegación. */
const ACTIVE_MS = 4000;
/** Cuánto desplaza cada flecha del scroll de dos dedos (la app manda 3 por paso: 3 × 40 = 1 "clic" de ruedita). */
const SCROLL_PER_ARROW = 40;

/** Curva de aceleración: despacio = preciso, rápido = cruza la pantalla. Suave, sin escalones. */
const BASE_GAIN = 0.6;
const EXTRA_GAIN = 2.2;
const ACCEL_SPEED = 28;

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

/**
 * El cursor propio de la tele, manejado por el touchpad del celular. Cada movimiento se manda
 * enseguida: el suavizado (para que se vea fluido aunque el WiFi entregue a ráfagas) lo hace el
 * ayudante nativo, sincronizado con la pantalla.
 */
export class PointerService {
  private lastUse = 0;

  constructor(
    private readonly surface: PointerSurface,
    private readonly settings: SettingsStore,
    private readonly log: Logger,
  ) {}

  get inUse(): boolean {
    return Date.now() - this.lastUse < ACTIVE_MS;
  }

  /** [dx] y [dy]: lo que se movió el dedo en el celular (la app manda píxeles ×1.5). */
  move(dx: number, dy: number): void {
    this.lastUse = Date.now();
    const speed = Math.hypot(dx, dy);
    const gain = this.settings.get('pointerSpeed') * (BASE_GAIN + EXTRA_GAIN * (1 - Math.exp(-speed / ACCEL_SPEED)));
    this.run(this.surface.moveBy(dx * gain, dy * gain));
  }

  click(): void {
    this.lastUse = Date.now();
    this.run(this.surface.click());
  }

  scroll(direction: ScrollDirection): void {
    this.lastUse = Date.now();
    const dy = direction === 'down' ? SCROLL_PER_ARROW : direction === 'up' ? -SCROLL_PER_ARROW : 0;
    const dx = direction === 'right' ? SCROLL_PER_ARROW : direction === 'left' ? -SCROLL_PER_ARROW : 0;
    this.run(this.surface.wheel(dy, dx));
  }

  /** Se volvió a navegar con flechas: la flecha se esconde enseguida. */
  hide(): void {
    if (!this.inUse) return;
    this.lastUse = 0;
    this.surface.hide();
  }

  private run(action: Promise<void>): void {
    action.catch((error: unknown) => {
      this.log.warn('Cursor:', error);
    });
  }
}
