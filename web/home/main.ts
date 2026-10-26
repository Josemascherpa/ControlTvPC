// Pantalla de inicio de la tele. Conecta las piezas (cada una en su archivo) y reparte las teclas.
// Se maneja con las flechas y OK (que manda el celular como teclas reales), Atrás (Escape), Menú
// (opciones de la app elegida) y con el cursor propio: pasar por encima elige, clic abre.

import { AmbientMode } from './ambient.js';
import { APP_ID } from './app-card.js';
import { AppMenu, type MenuOption } from './app-menu.js';
import { AppsLibrary } from './apps-library.js';
import { BackgroundRotator } from './backgrounds.js';
import { Clock } from './clock.js';
import { api, ServiceConnection } from './connection.js';
import { byId } from './dom.js';
import { FocusEngine, focusable, scrollIntoTrack, type Direction, type FocusLayer } from './focus.js';
import { HomeScroller } from './home-scroller.js';
import { AppLauncher } from './launcher.js';
import { HomeRows } from './rows.js';
import { SettingsPanel } from './settings-panel.js';
import { StatusBar } from './status-bar.js';

const HOME_REFRESH_MS = 5 * 60_000;
const INTRO_KEY = 'ctv-intro-shown';
const WHEEL_STEP = 100; // cuánto hay que girar la ruedita (o deslizar) para pasar a la tarjeta siguiente
const ARROWS: Readonly<Record<string, Direction>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

const service = new ServiceConnection();
let state: Contracts.UiState | null = null;
let apps: readonly Contracts.AppTile[] = [];
let homeIds: readonly string[] = [];
/** La app que se está cambiando de lugar en el inicio (modo "mover"), o null. */
let moving: string | null = null;

// ---------- Piezas ----------
const focus = new FocusEngine();
const launcher = new AppLauncher((id) => { service.send({ type: 'open', id }); });
const launch = (app: Contracts.AppTile, tile: HTMLElement): void => { void launcher.launch(app, tile); };
const rows = new HomeRows(launch, () => { openLibrary(); }, (url) => { service.send({ type: 'openUrl', url }); });
const library = new AppsLibrary(launch);
const menu = new AppMenu();
const settings = new SettingsPanel((command) => { service.send(command); }, () => { closeSettings(); });
const status = new StatusBar();
const backgrounds = new BackgroundRotator();
const ambient = new AmbientMode(() => !settings.isOpen && !library.isOpen && !menu.isOpen && moving === null);
const clock = new Clock();
const scroller = new HomeScroller();

/** El inicio: fila de arriba (ajustes), tus apps, y "Hoy". */
const homeLayer: FocusLayer = {
  name: 'home',
  rows: () => [
    [...document.querySelectorAll<HTMLElement>('.chips .focusable')],
    ...[...document.querySelectorAll<HTMLElement>('#apps-rows .track')].map((track) => [...track.querySelectorAll<HTMLElement>('.focusable')]),
    [...document.querySelectorAll<HTMLElement>('#info .focusable')],
  ],
};

/** Después de moverse: la fila elegida a la vista (inicio o biblioteca, según dónde se esté). */
function keepInView(): void {
  if (focus.layerName === 'home') scroller.ensureVisible(focus.focused);
  else if (focus.layerName === 'library') library.ensureVisible(focus.focused);
}

focusable(byId('btn-settings'), () => { openSettings(); });
// "Más categorías" (con el cursor): baja a la fila siguiente.
byId('more-down').addEventListener('click', () => {
  focus.move('down');
  keepInView();
});

// ---------- Abrir y cerrar capas ----------
function openSettings(): void {
  if (!state) return;
  settings.open(state);
  focus.push(settings);
}

function closeSettings(): void {
  settings.close();
  focus.pop();
}

function openLibrary(): void {
  library.open(apps, homeIds);
  focus.push(library);
  library.ensureVisible(focus.focused);
}

function closeLibrary(): void {
  library.close();
  focus.pop();
}

function closeMenu(): void {
  menu.close();
  focus.pop();
}

// ---------- Elegir qué apps van en el inicio ----------
function saveHome(ids: readonly string[]): void {
  homeIds = ids;
  rows.renderApps(apps, homeIds, moving);
  library.refresh(apps, homeIds);
  service.send({ type: 'setHomeApps', ids });
}

/** Opciones de una app (botón Menú del celular sobre una app). */
function openAppMenu(appId: string): void {
  const app = apps.find((a) => a.id === appId);
  if (!app) return;
  const onHome = homeIds.includes(appId);
  const open = (): void => {
    closeMenu();
    service.send({ type: 'open', id: appId });
  };
  const options: MenuOption[] = [{ label: 'Abrir', run: open }];
  if (onHome && focus.layerName === 'home') {
    options.push({ label: 'Mover', run: () => { closeMenu(); startMoving(appId); } });
  }
  options.push(onHome
    ? { label: 'Quitar del inicio', run: () => { closeMenu(); saveHome(homeIds.filter((id) => id !== appId)); focus.render(); } }
    : { label: 'Agregar al inicio', run: () => { closeMenu(); saveHome([...homeIds, appId]); focus.render(); } });
  options.push({ label: 'Cancelar', run: () => { closeMenu(); } });
  menu.open(app.name, options);
  focus.push(menu);
}

/** Modo "mover": izquierda/derecha cambian la app de lugar; OK o Atrás terminan. */
function startMoving(appId: string): void {
  moving = appId;
  rows.renderApps(apps, homeIds, moving);
  focusHomeApp(appId);
}

/** Cambia la app de lugar dentro de su categoría (con la de al lado de la misma categoría). */
function moveApp(direction: -1 | 1): void {
  if (moving === null) return;
  const id = moving;
  const category = apps.find((a) => a.id === id)?.category;
  const sameCategory = homeIds.filter((other) => apps.find((a) => a.id === other)?.category === category);
  const neighbor = sameCategory[sameCategory.indexOf(id) + direction];
  if (neighbor === undefined) return;
  homeIds = homeIds.map((other) => (other === id ? neighbor : other === neighbor ? id : other));
  rows.renderApps(apps, homeIds, moving);
  focusHomeApp(id);
}

function stopMoving(): void {
  if (moving === null) return;
  const id = moving;
  moving = null;
  saveHome(homeIds);
  focusHomeApp(id);
}

function focusHomeApp(appId: string): void {
  const card = document.querySelector<HTMLElement>(`#apps-rows [data-app-id="${CSS.escape(appId)}"]`);
  if (!card) return;
  focus.pointAt(card);
  scrollIntoTrack(card);
  scroller.ensureVisible(card);
}

// ---------- Teclas (las del celular llegan como teclas reales) ----------
function back(): void {
  if (moving !== null) stopMoving();
  else if (menu.isOpen) closeMenu();
  else if (settings.isOpen) closeSettings();
  else if (library.isOpen) closeLibrary();
  else {
    focus.goTo(1, 0); // "Atrás" en el inicio vuelve a la primera app (y arriba de todo)
    keepInView();
  }
}

addEventListener('keydown', (event) => {
  if (ambient.wake()) {
    event.preventDefault();
    return;
  }
  const direction = ARROWS[event.key];
  if (moving !== null && direction) {
    if (direction === 'left' || direction === 'right') moveApp(direction === 'left' ? -1 : 1);
  } else if (direction) {
    focus.move(direction);
    keepInView();
  } else if (event.key === 'Enter') {
    if (moving !== null) stopMoving();
    else focus.activate();
  } else if (event.key === 'Escape' || event.key === 'Backspace') {
    back();
  } else {
    return;
  }
  event.preventDefault();
});

// Botón Menú del celular: opciones de la app elegida; si no hay una app elegida, los ajustes.
service.onMenu(() => {
  ambient.wake();
  const appId = focus.focused?.dataset[APP_ID];
  if (moving !== null) stopMoving();
  else if (menu.isOpen) closeMenu();
  else if (appId && (focus.layerName === 'home' || focus.layerName === 'library')) openAppMenu(appId);
  else if (settings.isOpen) closeSettings();
  else openSettings();
});

// ---------- Cursor propio: pasar por encima elige, clic abre ----------
// Sólo cuenta si el cursor está a la vista (si se está navegando con flechas, está escondido).
const cursorVisible = (): boolean => !document.documentElement.hasAttribute('data-ctv-idle');
addEventListener('mousemove', (event) => {
  if (!cursorVisible() || !(event.target instanceof Element)) return;
  ambient.wake();
  const target = event.target.closest<HTMLElement>('.focusable');
  if (target) focus.pointAt(target);
});
addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  // Las flechas de las filas: pasan a la tarjeta siguiente/anterior de esa fila.
  const arrow = event.target.closest<HTMLElement>('.row-arrow');
  if (arrow) {
    stepRow(arrow.closest<HTMLElement>('.row'), arrow.classList.contains('left') ? 'left' : 'right');
    return;
  }
  const target = event.target.closest<HTMLElement>('.focusable');
  if (target) focus.click(target);
});

// Ruedita / deslizar con dos dedos sobre una fila: recorre la fila hacia los costados.
let wheelPending = 0;
// Ruedita / deslizar con dos dedos (touchpad del celular):
//   - para arriba/abajo → cambia de fila (y la pantalla se desplaza, en el inicio y en la biblioteca);
//   - para los costados → recorre la fila que está debajo del cursor.
let wheelVertical = 0;
addEventListener('wheel', (event) => {
  if (!(event.target instanceof Element)) return;
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    const row = event.target.closest<HTMLElement>('.row');
    if (!row) return;
    wheelPending += event.deltaX;
    while (Math.abs(wheelPending) >= WHEEL_STEP) {
      stepRow(row, wheelPending > 0 ? 'right' : 'left');
      wheelPending -= Math.sign(wheelPending) * WHEEL_STEP;
    }
    return;
  }
  wheelVertical += event.deltaY;
  while (Math.abs(wheelVertical) >= WHEEL_STEP) {
    focus.move(wheelVertical > 0 ? 'down' : 'up');
    keepInView();
    wheelVertical -= Math.sign(wheelVertical) * WHEEL_STEP;
  }
}, { passive: true });

/** Pasa a la tarjeta de al lado en esa fila (eligiendo primero algo de la fila si hace falta). */
function stepRow(row: HTMLElement | null, direction: 'left' | 'right'): void {
  if (!row) return;
  const focused = focus.focused;
  if (!focused || !row.contains(focused)) {
    const first = row.querySelector<HTMLElement>('.focusable');
    if (first) focus.pointAt(first);
  }
  focus.move(direction);
  keepInView();
}

// ---------- Datos ----------
service.onState((next) => {
  state = next;
  status.showState(next);
  settings.refresh(next);
  ambient.setMinutes(next.ambientMinutes);
  // Las apps del inicio: si cambiaron (y no se está moviendo una), se redibuja la fila.
  if (moving === null && next.homeApps.join() !== homeIds.join()) {
    homeIds = next.homeApps;
    rows.renderApps(apps, homeIds);
    library.refresh(apps, homeIds);
    focus.render();
    scroller.refresh();
  }
});

async function loadHome(): Promise<void> {
  const home = await api.home();
  status.showWeather(home.weather);
  rows.renderInfo(home);
  backgrounds.update(home.backgrounds);
  focus.render();
  scroller.refresh();
}

async function boot(): Promise<void> {
  clock.start();
  focus.push(homeLayer, 1, 0);
  service.connect();
  const [catalog] = await Promise.all([api.apps(), loadHome().catch(() => undefined)]);
  apps = catalog;
  rows.renderApps(apps, homeIds);
  focus.render();
  scroller.refresh();
  addEventListener('resize', () => { scroller.refresh(); });
  // Entrada escalonada sólo la primera vez: al volver de una app el inicio aparece al instante.
  if (sessionStorage.getItem(INTRO_KEY) === null) {
    sessionStorage.setItem(INTRO_KEY, '1');
    document.body.classList.add('intro');
    setTimeout(() => { document.body.classList.remove('intro'); }, 2000);
  }
  document.body.classList.add('ready');
  setInterval(() => { void loadHome().catch(() => undefined); }, HOME_REFRESH_MS);
}

// Al volver al inicio desde una app (botón Atrás del navegador), Edge puede mostrar la página
// guardada: dejamos el lanzador listo para la próxima.
addEventListener('pageshow', () => { launcher.reset(); });

void boot();
