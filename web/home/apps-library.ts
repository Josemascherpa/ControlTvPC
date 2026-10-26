import { createAppCard } from './app-card.js';
import { CATEGORIES } from './categories.js';
import { byId, el } from './dom.js';
import { updateTrackArrows, type FocusLayer } from './focus.js';

/**
 * "Todas las apps": la biblioteca completa, ordenada por categorías (una fila por categoría).
 * OK abre la app; Menú abre las opciones para agregarla o quitarla del inicio.
 */
export class AppsLibrary implements FocusLayer {
  readonly name = 'library';
  private readonly root = byId('library');
  private readonly sections = byId('library-sections');
  private shift = 0;

  constructor(private readonly onLaunch: (app: Contracts.AppTile, tile: HTMLElement) => void) {}

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(apps: readonly Contracts.AppTile[], homeIds: readonly string[]): void {
    this.render(apps, homeIds);
    this.root.hidden = false;
    this.shift = 0;
    this.sections.style.transform = '';
  }

  close(): void {
    this.root.hidden = true;
  }

  /** Redibuja si está abierta (ej. se agregó una app al inicio: aparece la marquita). */
  refresh(apps: readonly Contracts.AppTile[], homeIds: readonly string[]): void {
    if (this.isOpen) this.render(apps, homeIds);
  }

  rows(): readonly (readonly HTMLElement[])[] {
    return [...this.sections.querySelectorAll<HTMLElement>('.track')].map((track) => [...track.querySelectorAll<HTMLElement>('.focusable')]);
  }

  /** Desplaza la lista hacia arriba/abajo para que la fila elegida quede entera a la vista. */
  ensureVisible(element: HTMLElement | null): void {
    const row = element?.closest<HTMLElement>('.lib-row');
    if (!row) return;
    const viewport = this.sections.parentElement?.clientHeight ?? 0;
    const breathing = 32; // margen para que la tarjeta agrandada y su nombre entren enteros
    const top = row.offsetTop - breathing;
    const bottom = row.offsetTop + row.offsetHeight + breathing;
    if (top - this.shift < 0) this.shift = top;
    if (bottom - this.shift > viewport) this.shift = bottom - viewport;
    this.sections.style.transform = `translate3d(0, ${String(-this.shift)}px, 0)`;
  }

  private render(apps: readonly Contracts.AppTile[], homeIds: readonly string[]): void {
    const rows = CATEGORIES.flatMap(([category, title]) => {
      const inCategory = apps.filter((app) => app.category === category);
      if (inCategory.length === 0) return [];
      const track = el('div', 'track');
      track.append(...inCategory.map((app, i) =>
        createAppCard(app, (tile) => { this.onLaunch(app, tile); }, { pinned: homeIds.includes(app.id), index: i })));
      const row = el('div', 'row lib-row');
      row.append(el('h2', '', title), track, el('span', 'row-arrow left'), el('span', 'row-arrow right'));
      return [row];
    });
    this.sections.replaceChildren(...rows);
    for (const track of this.sections.querySelectorAll<HTMLElement>('.track')) updateTrackArrows(track);
  }
}
