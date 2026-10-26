import { byId, el, wait } from './dom.js';

const EXPAND_MS = 420;

/**
 * Animación al abrir una app: desde la tarjeta elegida crece un círculo del color de la app que
 * cubre la pantalla, con su ícono y nombre en el medio. Recién ahí se pide abrir la app.
 */
export class AppLauncher {
  private readonly stage = byId('launch');
  private busy = false;

  constructor(private readonly open: (appId: string) => void) {}

  async launch(app: Contracts.AppTile, tile: HTMLElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const rect = tile.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Radio necesario para cubrir toda la pantalla desde ese punto.
    const radius = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));

    const circle = el('div', 'launch-circle');
    circle.style.background = app.background;
    circle.style.left = `${cx - radius}px`;
    circle.style.top = `${cy - radius}px`;
    circle.style.width = `${radius * 2}px`;
    circle.style.height = `${radius * 2}px`;
    const icon = tile.querySelector('img')?.cloneNode(true);
    const badge = el('div', 'launch-badge');
    if (icon instanceof HTMLImageElement) badge.append(icon);
    badge.append(el('div', 'launch-name', app.name));
    badge.style.setProperty('--accent', app.color);

    this.stage.replaceChildren(circle, badge);
    this.stage.hidden = false;
    document.body.classList.add('launching');
    // Forzar el cálculo del estado inicial hace que la animación arranque ya, sin esperar cuadros.
    void this.stage.offsetWidth;
    this.stage.classList.add('go');
    await wait(EXPAND_MS);
    this.open(app.id);
    // Si por algún motivo la app no abre, a los segundos volvemos a mostrar el inicio.
    await wait(4000);
    this.reset();
  }

  reset(): void {
    this.stage.classList.remove('go');
    this.stage.hidden = true;
    this.stage.replaceChildren();
    document.body.classList.remove('launching');
    this.busy = false;
  }
}
