// Modo ambiente: si nadie usa el inicio por unos minutos, se esconde todo y queda un reloj grande
// sobre la foto (como los teles). La primera tecla sólo "despierta" la pantalla.

export class AmbientMode {
  private timer = 0;
  private minutes = 3;
  private wokeAt = 0;

  constructor(private readonly canEnter: () => boolean) {}

  setMinutes(minutes: number): void {
    this.minutes = minutes;
    this.reset();
  }

  get active(): boolean {
    return document.body.classList.contains('ambient');
  }

  /** Hubo actividad. Devuelve true si estaba en modo ambiente (esa tecla no debe hacer nada más). */
  wake(): boolean {
    const was = this.active;
    if (was) {
      document.body.classList.remove('ambient');
      this.wokeAt = Date.now();
    }
    this.reset();
    return was || Date.now() - this.wokeAt < 50;
  }

  private reset(): void {
    clearTimeout(this.timer);
    if (this.minutes > 0) this.timer = window.setTimeout(() => { this.enter(); }, this.minutes * 60_000);
  }

  private enter(): void {
    if (this.canEnter()) document.body.classList.add('ambient');
    else this.reset();
  }
}
