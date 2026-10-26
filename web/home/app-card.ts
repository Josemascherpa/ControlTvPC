import { el } from './dom.js';
import { focusable } from './focus.js';

/** Para saber qué app es una tarjeta (lo usan el menú de la app y el modo "mover"). */
export const APP_ID = 'appId';

/** Se sube cuando cambian los íconos que vienen con la app, para no ver los viejos guardados en caché. */
const ICON_VERSION = 2;

export interface AppCardOptions {
  /** Muestra la marquita de "está en el inicio" (en la biblioteca). */
  readonly pinned?: boolean;
  /** Orden de entrada en la animación inicial. */
  readonly index?: number;
}

/** Tarjeta de una app: ícono grande al centro sobre su color, y el nombre abajo. */
export function createAppCard(app: Contracts.AppTile, onOpen: (tile: HTMLElement) => void, options: AppCardOptions = {}): HTMLElement {
  const tile = el('div', 'app-tile');
  tile.style.setProperty('--tile-bg', app.background);
  tile.style.setProperty('--tile-color', app.color);
  const icon = new Image();
  icon.alt = '';
  icon.decoding = 'async';
  icon.addEventListener('error', () => { icon.replaceWith(el('span', 'letter', app.name.charAt(0))); });
  icon.src = `/icon/${encodeURIComponent(app.id)}.png?v=${String(ICON_VERSION)}`;
  tile.append(icon);
  if (options.pinned) tile.append(el('span', 'pin'));
  const card = el('div', 'app');
  card.dataset[APP_ID] = app.id;
  card.style.setProperty('--i', String(options.index ?? 0));
  card.append(tile, el('div', 'app-name', app.name));
  return focusable(card, () => { onOpen(tile); });
}

/** La tarjeta "Todas las apps" que cierra la fila del inicio. */
export function createLibraryCard(onOpen: () => void, index: number): HTMLElement {
  const tile = el('div', 'app-tile library-tile');
  tile.innerHTML = '<svg viewBox="0 0 24 24" width="38%" height="38%" fill="currentColor">'
    + '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/>'
    + '<rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>';
  const card = el('div', 'app');
  card.style.setProperty('--i', String(index));
  card.append(tile, el('div', 'app-name', 'Todas las apps'));
  return focusable(card, onOpen);
}
