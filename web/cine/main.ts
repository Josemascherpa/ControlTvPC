import type Hls from 'hls.js';
import { asRecord, asString } from '../../shared/json.js';
import { FramexLibrary, hasSpanishAudio } from './library.js';
import { CATEGORIES, SECTIONS, categoryShelves, sectionShelves, shelfParams, type Category, type SectionId, type Shelf } from './sections.js';
import { BrowserStore } from './store.js';
import { tmdbAccess } from './tmdb.js';
import { Translator } from './translator.js';

declare global {
  interface Window { Hls?: typeof Hls }
}

// El Cine: la única app de la tele (estilo Chromecast). Catálogo de la API de FrameX, ficha del
// título y reproductor HLS/MP4. Todo se maneja con flechas y OK del control, y también con el
// touchpad (hover + clic). No usa iframes ni carga las webs de los proveedores: sólo las fuentes
// que entrega la API. Es autónoma: sólo necesita internet (la notebook no le resuelve nada), así
// la misma app puede llevarse a otro tele.

type Row = { readonly name: string; readonly items: readonly Contracts.LibraryTitle[] };
type Type = 'movie' | 'tv';

interface ProgressEntry {
  readonly key: string;
  readonly id: string;
  readonly type: Type;
  readonly title: string;
  readonly poster: string;
  readonly season: number;
  readonly episode: number;
  readonly name: string;
  readonly t: number;
  readonly d: number;
  readonly at: number;
}

interface PlayContext {
  readonly item: Contracts.LibraryTitle;
  readonly season: number;
  readonly episode: number;
  readonly name: string;
  readonly next: PlayContext | null;
}

const STORE_KEY = 'cine:progress:v1';
const MAX_HISTORY = 60;
const HIDE_CONTROLS_MS = 3500;

// El tipo se elige en cada uso (video, input, botón…); el id ya garantiza que exista.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta #${id}`);
  return node as T;
}

const searchForm = byId<HTMLFormElement>('searchForm');
const search = byId<HTMLInputElement>('search');
const searchPanel = byId<HTMLElement>('searchPanel');
const searchSpinner = byId<HTMLElement>('searchSpinner');
const keyboard = byId<HTMLElement>('keyboard');
const rail = byId<HTMLElement>('rail');
const railItems = byId<HTMLElement>('railItems');
const livePanel = byId<HTMLElement>('live');
const liveFrame = byId<HTMLIFrameElement>('liveFrame');
const liveName = byId<HTMLElement>('liveName');
const liveLoading = byId<HTMLElement>('liveLoading');
const hero = byId<HTMLElement>('hero');
const heroImages = [byId<HTMLImageElement>('heroImage'), byId<HTMLImageElement>('heroImageNext')] as const;
const heroCopy = byId<HTMLElement>('heroCopy');
const heroEyebrow = byId<HTMLElement>('heroEyebrow');
const rowsScroll = byId<HTMLElement>('rowsScroll');
const rowsViewport = byId<HTMLElement>('rowsViewport');
const heroTitle = byId<HTMLElement>('heroTitle');
const heroMeta = byId<HTMLElement>('heroMeta');
const heroOverview = byId<HTMLElement>('heroOverview');
const heroPlay = byId<HTMLButtonElement>('heroPlay');
const heroInfo = byId<HTMLButtonElement>('heroInfo');
const heroActions = byId<HTMLElement>('heroActions');
const legalPanel = byId<HTMLElement>('legal');
const legalClose = byId<HTMLButtonElement>('legalClose');
const rowsEl = byId<HTMLElement>('rows');
const catalogEl = byId<HTMLElement>('catalog');
const statusEl = byId<HTMLElement>('status');
const detailPanel = byId<HTMLElement>('details');
const detailImage = byId<HTMLImageElement>('detailImage');
const detailBody = byId<HTMLElement>('detailBody');
const detailClose = byId<HTMLButtonElement>('detailClose');
const detailKind = byId<HTMLElement>('detailKind');
const detailTitle = byId<HTMLElement>('detailTitle');
const detailMeta = byId<HTMLElement>('detailMeta');
const detailLanguage = byId<HTMLElement>('detailLanguage');
const detailOverview = byId<HTMLElement>('detailOverview');
const detailCast = byId<HTMLElement>('detailCast');
const detailPlay = byId<HTMLButtonElement>('detailPlay');
const detailServers = byId<HTMLButtonElement>('detailServers');
const detailStatus = byId<HTMLElement>('detailStatus');
const serversEl = byId<HTMLElement>('servers');
const seasonBar = byId<HTMLElement>('seasonBar');
const episodesEl = byId<HTMLElement>('episodes');
const relatedEl = byId<HTMLElement>('related');
const relatedTrack = byId<HTMLElement>('relatedTrack');
const player = byId<HTMLElement>('player');
const video = byId<HTMLVideoElement>('video');
const playerTop = byId<HTMLElement>('playerTop');
const playerBack = byId<HTMLButtonElement>('playerBack');
const playingTitle = byId<HTMLElement>('playingTitle');
const playingMeta = byId<HTMLElement>('playingMeta');
const playerControls = byId<HTMLElement>('playerControls');
const progressFill = byId<HTMLElement>('progressFill');
const rewind = byId<HTMLButtonElement>('rewind');
const toggle = byId<HTMLButtonElement>('toggle');
const forward = byId<HTMLButtonElement>('forward');
const timeEl = byId<HTMLElement>('time');
const subtitlesBtn = byId<HTMLButtonElement>('subtitlesBtn');
const audioBtn = byId<HTMLButtonElement>('audioBtn');
const nextBtn = byId<HTMLButtonElement>('nextBtn');
const playerStatus = byId<HTMLElement>('playerStatus');
const qualityBtn = byId<HTMLButtonElement>('qualityBtn');
const serverBtn = byId<HTMLButtonElement>('serverBtn');
const playerMenu = byId<HTMLElement>('playerMenu');
const playerMenuTitle = byId<HTMLElement>('playerMenuTitle');
const playerMenuList = byId<HTMLElement>('playerMenuList');
const retryBtn = byId<HTMLButtonElement>('retryBtn');

let catalogRows: readonly Row[] = [];
let catalogHero: Contracts.LibraryHero | null = null;
let searchMode = false;
let currentSection: SectionId = 'inicio';
let currentCategory: Category | undefined = CATEGORIES[0];
let legalTrigger: HTMLElement | null = null;
let catalogToken = 0;
let detailToken = 0;
let currentItem: Contracts.LibraryTitle | null = null;
let currentDetails: Contracts.LibraryDetails | null = null;
let currentSeason = 1;
let currentEpisodes: readonly Contracts.LibraryEpisode[] = [];
let providersCache: readonly Contracts.LibraryProvider[] | null = null;
let detailTrigger: HTMLElement | null = null;
let navRows: HTMLElement[][] = [];
let detailRows: HTMLElement[][] = [];
/** Qué título muestra cada tarjeta (para el destacado de arriba). */
const cardItems = new WeakMap<HTMLElement, Contracts.LibraryTitle>();
/** En qué elemento quedó cada fila: al volver a ella, se vuelve ahí (como Google TV). */
const rowMemory = new WeakMap<Element, number>();
let activeRow: Element | null = null;
let searchTimer = 0;
let searchAbort: AbortController | null = null;
const SEARCH_DELAY_MS = 450;

let hls: Hls | null = null;
let loadingHls: Promise<typeof Hls> | null = null;
let playToken = 0;
let playerContext: PlayContext | null = null;
let triedProviders: string[] = [];
let returnToDetails = false;
let resumeAt: number | null = null;
let currentSubtitles: readonly Contracts.LibrarySubtitle[] = [];
/** La fuente que se está viendo, las otras de ese servidor (otras calidades) y el servidor. */
let currentSource: Contracts.LibrarySource | null = null;
let currentSources: readonly Contracts.LibrarySource[] = [];
let currentProvider = '';
let subtitleIndex = -1;
let hideTimer = 0;
let lastPointerShow = 0;
let lastSaveAt = 0;
let lastFallbackAt = 0;

// ---------- Utilidades ----------

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo cargar. Probá de nuevo.';
}

// ---------- Barra de actividad ----------
// Mientras haya algo cargando (búsqueda, ficha, fuente de video), una barra finita arriba. Aparece
// recién a los 150 ms: lo que carga rápido no hace parpadear nada.
let busyCount = 0;
let busyTimer = 0;
function busy(delta: 1 | -1): void {
  busyCount = Math.max(0, busyCount + delta);
  clearTimeout(busyTimer);
  if (busyCount > 0) busyTimer = window.setTimeout(() => { document.body.classList.add('is-busy'); }, 150);
  else document.body.classList.remove('is-busy');
}

/**
 * El catálogo lo consulta la propia app, directo a internet: no depende de la notebook. Lo ya visto
 * (catálogo, fichas, búsquedas y traducciones) queda guardado en el navegador: se muestra al
 * instante y se actualiza por detrás sólo si cambió. Las imágenes las guarda la caché del navegador
 * (TMDB las entrega en WebP y con vencimiento largo).
 */
const library = readTmdbKey().then((tmdb) => new FramexLibrary(
  undefined, new Translator(new BrowserStore('traducciones')), new BrowserStore('catalogo'), true, tmdb,
));

/**
 * La clave de TMDB de la persona, en ui/ajustes.json ({"tmdb": "…"}; no se sube a git). Sin ese
 * archivo el Cine anda igual, con el catálogo de FrameX (sin Anime ni filtros por idioma o plataforma).
 */
async function readTmdbKey(): Promise<ReturnType<typeof tmdbAccess>> {
  try {
    const response = await fetch('ajustes.json', { cache: 'no-cache' });
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    return tmdbAccess(asString(asRecord(raw)['tmdb']));
  } catch {
    return null;
  }
}

async function api(op: string, params: Record<string, string> = {}, cancel?: AbortSignal, quiet = false): Promise<Contracts.LibraryReply> {
  if (!quiet) busy(1);
  try {
    const result = await abortable((await library).query(new URLSearchParams({ op, ...params })), cancel);
    if (result.error) throw new Error(result.error);
    return result;
  } finally {
    if (!quiet) busy(-1);
  }
}

/** Una búsqueda vieja (se siguió escribiendo) se descarta apenas se cancela, sin esperar su respuesta. */
function abortable<T>(task: Promise<T>, cancel: AbortSignal | undefined): Promise<T> {
  if (!cancel) return task;
  if (cancel.aborted) return Promise.reject(new DOMException('Cancelada', 'AbortError'));
  return Promise.race([task, new Promise<never>((_, reject) => {
    cancel.addEventListener('abort', () => { reject(new DOMException('Cancelada', 'AbortError')); }, { once: true });
  })]);
}

/** Un texto de estado; con `loading`, un círculo girando delante (algo se está cargando). */
function showStatus(element: HTMLElement, text: string, loading = false): void {
  element.textContent = text;
  element.classList.toggle('loading', loading && text !== '');
}

/** La imagen grande (destacado y ficha): TMDB w1280, nítida en la tele (la de las tarjetas es w780). */
function large(url: string): string {
  return url.replace('/t/p/w780/', '/t/p/w1280/');
}

function metaText(item: Contracts.LibraryTitle, genres: readonly string[] = []): string {
  return [item.year, item.rating ? `${item.rating} ★` : '', item.type === 'tv' ? 'Serie' : 'Película', ...genres]
    .filter((part) => part !== '').join('  ·  ');
}

function clock(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function runtimeText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h${rest > 0 ? ` ${rest} min` : ''}` : `${rest} min`;
}

/** Mismo criterio que el servicio: códigos ("es", "spa") y nombres ("Spanish", "Castellano"). */
function isSpanish(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return false;
  if (/^(es|spa)([-_]|$)/.test(text)) return true;
  return /(^|[^a-z])(español|espanol|castellano|spanish|latino|latina)([^a-z]|$)/.test(text);
}

function subtitleLabel(value: string): string {
  return value.replace(/^spanish/i, 'Español');
}

/**
 * Elegir un elemento con el control: se lo enfoca sin saltos de página, la fila se desliza suave
 * hasta que se vea, la fila activa se ilumina, se recuerda la columna y el destacado de arriba
 * muestra la tarjeta elegida.
 */
function focusElement(node: HTMLElement | null): void {
  if (!node) return;
  node.focus({ preventScroll: true });
  revealInTrack(node);
  const row = node.closest('.row, .related, .seasons, .chips, .actions, .rail-items, .key-row, .controls-row, .menu-list, .legal-body');
  if (!rail.contains(node) && catalogEl.contains(node)) lastContentFocus = node;
  if (row !== activeRow) {
    activeRow?.classList.remove('is-active');
    // La fila que se deja vuelve sola (con un desliz) a su inicio: al pasar de nuevo se ve prolija.
    const leftTrack = activeRow?.querySelector<HTMLElement>(':scope > .track');
    if (leftTrack) leftTrack.style.transform = '';
    row?.classList.add('is-active');
    activeRow = row;
  }
  const parent = node.parentElement;
  if (parent) rowMemory.set(parent, [...parent.children].indexOf(node));
  if (detailPanel.hidden && player.hidden) {
    if (rowsEl.contains(node)) hydrateAround(node);
    revealRow(node);
    spotlightFor(node);
  } else if (!detailPanel.hidden && detailBody.contains(node)) {
    revealInDetails(node);
  }
}

/**
 * Dentro de una fila horizontal. En el catálogo, como Netflix o Google TV en la tele: la tarjeta
 * elegida queda siempre en el primer lugar y es la fila entera la que se desliza (con la placa de
 * video, siempre la misma animación). En la ficha, las filas chicas se desplazan lo justo.
 */
function revealInTrack(node: HTMLElement): void {
  const track = node.parentElement;
  if (!track) return;
  if (track.classList.contains('track')) {
    const first = track.firstElementChild;
    const last = track.lastElementChild;
    if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) return;
    // Hasta el final de la fila, sin dejar un hueco vacío a la derecha.
    const max = Math.max(0, last.offsetLeft + last.offsetWidth - first.offsetLeft + 80 - track.clientWidth);
    const shift = Math.min(max, node.offsetLeft - first.offsetLeft);
    track.style.transform = shift > 0 ? `translate3d(${String(-shift)}px, 0, 0)` : '';
    return;
  }
  if (track.scrollWidth <= track.clientWidth) return;
  const box = track.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  const margin = Math.min(rect.width * 1.2, 190);
  if (rect.left < box.left + margin) track.scrollBy({ left: rect.left - box.left - margin, behavior: 'smooth' });
  else if (rect.right > box.right - margin) track.scrollBy({ left: rect.right - box.right + margin, behavior: 'smooth' });
}

/**
 * Las filas del catálogo. Recorriéndolas, el destacado queda compacto (sin sus botones) y se ven
 * dos filas enteras: la elegida (arriba) y la siguiente; se desliza la lista entera. En el destacado
 * o el buscador, la lista vuelve al principio (o baja lo justo para no tapar los botones).
 */
function revealRow(node: HTMLElement): void {
  const row = node.closest<HTMLElement>('.row');
  if (!row) {
    if (rowsViewport.contains(node) || rail.contains(node)) return;
    const gap = heroGap();
    rowsScroll.style.transform = gap > 0 ? `translate3d(0, ${String(gap)}px, 0)` : '';
    return;
  }
  const offset = row.offsetTop - rowsScroll.offsetTop;
  rowsScroll.style.transform = offset > 0 ? `translate3d(0, ${String(-offset)}px, 0)` : '';
}

/** Cuánto tiene que bajar la lista para no tapar los botones del destacado (Reproducir, Más información). */
function heroGap(): number {
  if (hero.hidden || searchMode) return 0;
  const bottom = heroCopy.offsetTop + heroActions.offsetTop + heroActions.offsetHeight;
  return Math.max(0, bottom + 18 - rowsViewport.offsetTop);
}

/** En la ficha: lo elegido a la vista dentro de la ficha (desliz suave). */
function revealInDetails(node: HTMLElement): void {
  const box = detailBody.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  if (rect.top < box.top + 80) detailBody.scrollBy({ top: rect.top - box.top - 80, behavior: 'smooth' });
  else if (rect.bottom > box.bottom - 60) detailBody.scrollBy({ top: rect.bottom - box.bottom + 60, behavior: 'smooth' });
}

// ---------- Destacado de arriba (como Google TV) ----------

let heroFront: 0 | 1 = 0;
let heroShown = '';
let spotlightTimer = 0;
let heroTextTimer = 0;

/**
 * Muestra un título en el destacado, en dos tiempos: el texto anterior se esfuma y el nuevo entra
 * con un desliz (antes cambiaba de golpe y se sentía seco). La imagen cambia con un fundido.
 */
function showSpotlight(item: Contracts.LibraryTitle, preview: boolean): void {
  const key = `${item.type}:${item.id}:${String(preview)}`;
  if (key === heroShown) return;
  heroShown = key;
  // Los botones se esconden o aparecen junto con el movimiento de las filas, sin esperar al texto.
  heroCopy.classList.toggle('is-preview', preview);
  heroCopy.classList.add('is-changing');
  clearTimeout(heroTextTimer);
  heroTextTimer = window.setTimeout(() => {
    heroEyebrow.textContent = preview ? (item.type === 'tv' ? 'Serie' : 'Película') : 'Destacado';
    heroTitle.textContent = item.title;
    heroMeta.textContent = metaText(item);
    heroOverview.textContent = translatedOverviews.get(item.overview) ?? item.overview;
    heroCopy.classList.remove('is-changing');
  }, 140);
  // La imagen (y la sinopsis en español) esperan a que el control se quede quieto un instante:
  // recorriendo rápido no se bajan ni decodifican imágenes ni se traducen textos de más.
  clearTimeout(spotlightTimer);
  spotlightTimer = window.setTimeout(() => {
    void swapHeroImage(large(item.backdrop) || item.poster);
    void spanishOverview(item, key);
  }, 220);
}

/** Sinopsis traducidas (las pide el destacado; el servicio las guarda para siempre). */
const translatedOverviews = new Map<string, string>();

async function spanishOverview(item: Contracts.LibraryTitle, key: string): Promise<void> {
  const original = item.overview;
  if (!original) return;
  let spanish = translatedOverviews.get(original);
  if (spanish === undefined) {
    try {
      spanish = (await api('translate', { text: original }, undefined, true)).translated ?? original;
    } catch {
      return; // sin traducción: queda la original
    }
    translatedOverviews.set(original, spanish);
  }
  if (heroShown === key && spanish !== original) heroOverview.textContent = spanish;
}

async function swapHeroImage(src: string): Promise<void> {
  const front = heroImages[heroFront];
  const url = src ? new URL(src, location.href).href : '';
  if (!url || front.src === url) return;
  const next = heroFront === 0 ? 1 : 0;
  const incoming = heroImages[next];
  incoming.src = url;
  try {
    await incoming.decode(); // se decodifica antes del fundido: el cambio no traba un cuadro
  } catch {
    return;
  }
  if (incoming.src !== url) return; // mientras tanto se eligió otra
  incoming.classList.add('is-shown');
  front.classList.remove('is-shown');
  heroFront = next;
}

/** Al elegir una tarjeta, el destacado la muestra; en la barra de arriba o el destacado, vuelve el destacado. */
function spotlightFor(node: HTMLElement): void {
  if (hero.hidden) return;
  const item = cardItems.get(node);
  if (item) showSpotlight(item, true);
  else if (catalogHero && node.classList.contains('genre-tile')) showSpotlight(catalogHero, true);
  else if (catalogHero && (node === heroPlay || node === heroInfo)) showSpotlight(catalogHero, false);
}

function setStatus(text: string, loading = false): void {
  showStatus(statusEl, text, loading);
}

function toast(text: string): void {
  const overlay = window.__controlTv;
  if (overlay) overlay.toast({ text, icon: 'ℹ' });
  else if (!player.hidden) playerStatus.textContent = text;
}

// ---------- Historial (continuar viendo) ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function progressKey(type: Type, id: string, season: number, episode: number): string {
  return type === 'tv' ? `${type}:${id}:${season}:${episode}` : `${type}:${id}`;
}

function readStore(): ProgressEntry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item): ProgressEntry[] => {
      if (!isRecord(item)) return [];
      const type = item['type'];
      const id = item['id'];
      const title = item['title'];
      const t = numberValue(item['t']);
      const at = numberValue(item['at']);
      if ((type !== 'movie' && type !== 'tv') || typeof id !== 'string' || typeof title !== 'string' || t === null || at === null) return [];
      const season = numberValue(item['season']) ?? 0;
      const episode = numberValue(item['episode']) ?? 0;
      return [{
        key: progressKey(type, id, season, episode),
        id,
        type,
        title,
        poster: typeof item['poster'] === 'string' ? item['poster'] : '',
        season,
        episode,
        name: typeof item['name'] === 'string' ? item['name'] : '',
        t,
        d: numberValue(item['d']) ?? 0,
        at,
      }];
    }).slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function writeStore(entries: readonly ProgressEntry[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // Sin espacio o almacenamiento bloqueado: seguir mirando es más importante que el historial.
  }
}

function savedTime(key: string): number | null {
  const entry = readStore().find((item) => item.key === key);
  if (!entry || entry.t < 10) return null;
  if (entry.d > 0 && entry.t >= entry.d - 20) return null;
  return entry.t;
}

function saveProgress(entry: Omit<ProgressEntry, 'key' | 'at'>): void {
  const key = progressKey(entry.type, entry.id, entry.season, entry.episode);
  const entries = readStore().filter((item) => item.key !== key);
  if (entry.d > 0 && entry.t / entry.d < 0.95 && entry.t >= 5) {
    entries.unshift({ ...entry, key, at: Date.now() });
  }
  writeStore(entries);
}

function saveCurrentProgress(): void {
  const context = playerContext;
  if (!context || player.hidden) return;
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  saveProgress({
    id: context.item.id, type: context.item.type, title: context.item.title, poster: context.item.poster,
    season: context.season, episode: context.episode, name: context.name, t: video.currentTime, d: duration,
  });
}

function recentProgress(): ProgressEntry[] {
  return readStore()
    .filter((entry) => entry.t >= 15 && (entry.d === 0 || entry.t / entry.d < 0.95))
    .sort((a, b) => b.at - a.at)
    .slice(0, 8);
}

function entryTitle(entry: ProgressEntry): Contracts.LibraryTitle {
  return { id: entry.id, type: entry.type, title: entry.title, poster: entry.poster, backdrop: '', year: '', rating: '', overview: '' };
}

// ---------- Catálogo ----------

// Como FlashList (React Native), adaptado a la tele:
//  - Reciclado: cada tarjeta se crea UNA vez y se reusa entre catálogo y búsquedas (mismo título =
//    mismo nodo, con su imagen ya decodificada). Escribir en el buscador no rearma cientos de nodos.
//  - Distancia de dibujo: sólo se bajan y decodifican las imágenes cerca del foco (la fila elegida y
//    las dos de abajo, unas tarjetas por delante). Medido antes: decodificar en plena animación
//    trababa cuadros; así llegan decodificadas antes de entrar en pantalla, y las lejanas no gastan.
const DRAW_AHEAD = 10;
const ROWS_AHEAD = 2;
const POOL_LIMIT = 400;
const cardPool = new Map<string, HTMLButtonElement>();
/** Tarjetas ya puestas en la lista que se está armando (un mismo título en dos filas = dos nodos). */
let placed = new Set<HTMLButtonElement>();

function cardFor(item: Contracts.LibraryTitle): HTMLButtonElement {
  const key = `${item.type}:${item.id}`;
  const reused = cardPool.get(key);
  const known = reused ? cardItems.get(reused) : undefined;
  if (reused && !placed.has(reused) && known?.poster === item.poster && known.title === item.title) {
    reused.classList.remove('pressed');
    placed.add(reused);
    return reused;
  }
  const card = makeCard(item);
  if (!reused || placed.has(reused)) {
    if (cardPool.size >= POOL_LIMIT) cardPool.delete(cardPool.keys().next().value ?? '');
    cardPool.set(key, card);
  }
  placed.add(card);
  return card;
}

function hydrateCard(card: Element): void {
  const poster = card.querySelector<HTMLImageElement>('img.poster[data-src]');
  const src = poster?.dataset['src'];
  if (!poster || !src) return;
  delete poster.dataset['src'];
  poster.src = src;
}

/** Baja las imágenes alrededor de lo elegido (o del principio de la lista). */
function hydrateAround(node: HTMLElement | null): void {
  const rows = [...rowsEl.querySelectorAll<HTMLElement>(':scope > .row:not(.skeleton)')];
  const current = node?.closest<HTMLElement>('.row') ?? null;
  const index = current ? Math.max(0, rows.indexOf(current)) : 0;
  const column = current && node?.parentElement ? Math.max(0, [...node.parentElement.children].indexOf(node)) : 0;
  for (let r = Math.max(0, index - 1); r <= Math.min(rows.length - 1, index + ROWS_AHEAD); r++) {
    const cards = rows[r]?.querySelector(':scope > .track')?.children;
    if (!cards) continue;
    const upTo = Math.min(cards.length, (r === index ? column : 0) + DRAW_AHEAD);
    for (let c = 0; c < upTo; c++) {
      const card = cards[c];
      if (card) hydrateCard(card);
    }
  }
}

function makeCard(item: Contracts.LibraryTitle, progress?: ProgressEntry): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  card.setAttribute('aria-label', `${item.title}${item.year ? ` (${item.year})` : ''}`);
  const wrap = document.createElement('span');
  wrap.className = 'poster-wrap';
  const poster = document.createElement('img');
  poster.className = 'poster';
  // Tarjeta apaisada con la imagen de fondo del título (la misma del destacado: se baja una sola vez).
  poster.width = 204;
  poster.height = 115;
  // La imagen se pide recién cuando está cerca del foco (hydrateAround), con tiempo de sobra para
  // decodificarse antes de que la fila se deslice hasta ella.
  poster.loading = 'eager';
  poster.decoding = 'async';
  poster.alt = '';
  // Mientras llega la imagen, un brillo de carga; cuando llega, aparece con un fundido. Sin imagen
  // (o si falla), el nombre sobre un fondo, en vez de un hueco.
  const shimmer = document.createElement('span');
  shimmer.className = 'shimmer';
  const ready = (): void => {
    poster.classList.add('loaded');
    wrap.classList.add('is-ready');
    setTimeout(() => { shimmer.remove(); }, 450);
  };
  const fallback = (): void => {
    const label = document.createElement('span');
    label.className = 'poster-fallback';
    label.textContent = item.title;
    wrap.append(label);
    wrap.classList.add('is-ready');
    shimmer.remove();
  };
  poster.addEventListener('load', ready, { once: true });
  poster.addEventListener('error', fallback, { once: true });
  wrap.append(shimmer, poster);
  const art = item.backdrop || item.poster;
  if (art) {
    poster.dataset['src'] = art;
  } else {
    fallback();
  }
  if (progress && progress.d > 0) {
    const bar = document.createElement('span');
    bar.className = 'watch';
    const fill = document.createElement('i');
    fill.style.transform = `scaleX(${Math.min(1, Math.max(0, progress.t / progress.d))})`;
    bar.append(fill);
    wrap.append(bar);
  }
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = item.title;
  card.append(wrap, name);
  cardItems.set(card, item);
  card.addEventListener('click', () => {
    void openDetails(item, progress ? { autoplay: true, resume: progress } : {});
  });
  return card;
}

function appendRow(name: string, cards: readonly HTMLElement[], order = rowsEl.children.length): void {
  if (!cards.length) return;
  const section = document.createElement('section');
  section.className = 'row';
  section.style.setProperty('--i', String(order)); // entrada escalonada
  const heading = document.createElement('h2');
  heading.textContent = name;
  const track = document.createElement('div');
  track.className = 'track';
  track.append(...cards);
  section.append(heading, track);
  rowsEl.append(section);
}

function renderHome(): void {
  rowsEl.replaceChildren();
  placed = new Set();
  const recent = recentProgress();
  if (recent.length) appendRow('Continuar viendo', recent.map((entry) => makeCard(entryTitle(entry), entry)));
  for (const row of catalogRows) appendRow(row.name, row.items.map((item) => cardFor(item)));
  hydrateAround(null);
  const uniqueCount = new Set(catalogRows.flatMap((row) => row.items).map((item) => `${item.type}:${item.id}`)).size;
  setStatus(uniqueCount ? `${uniqueCount} títulos · Audio o subtítulos en español` : 'No hay títulos para mostrar.');
  resetRows();
  rebuildNav();
  if (!rail.contains(document.activeElement)) focusInitial();
}

// ---------- Secciones del menú (Películas, Series, Anime, Categorías) ----------

/** Íconos del menú (trazos de 24×24). */
const ICONS: Readonly<Record<string, string>> = {
  buscar: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.5 15.5l5 5',
  inicio: 'M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z',
  peliculas: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4',
  series: 'M3 7.5h18v12H3zM8 3l4 4.5L16 3',
  anime: 'M12 3.5l2.5 5.4 5.9.7-4.4 4 1.2 5.9L12 16.6l-5.2 2.9 1.2-5.9-4.4-4 5.9-.7z',
  envivo: 'M12 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4',
  categorias: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  legal: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 11v6M12 7.5v.5',
};

function railButton(id: string, label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-item';
  button.dataset['section'] = id;
  button.setAttribute('aria-label', label);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[id] ?? '');
  svg.append(path);
  const text = document.createElement('span');
  text.className = 'rail-label';
  text.textContent = label;
  button.append(svg, text);
  // Elegir una opción cierra el menú: el foco pasa al contenido (como en las apps de las teles).
  button.addEventListener('click', () => {
    if (document.activeElement instanceof HTMLElement && rail.contains(document.activeElement)) document.activeElement.blur();
    action();
  });
  railItems.append(button);
  return button;
}

const searchButton = railButton('buscar', 'Buscar', () => { openSearch(); });
const menuButtons = SECTIONS.map((section) => railButton(section.id, section.label, () => { void openSection(section.id); }));
const legalBtn = railButton('legal', 'Legal - DMCA', () => { openLegal(); });
legalBtn.id = 'legalBtn';
legalBtn.classList.add('legal-btn');
const railButtons = [searchButton, ...menuButtons, legalBtn];
/** Lo último elegido fuera del menú: al salir del menú hacia la derecha se vuelve ahí. */
let lastContentFocus: HTMLElement | null = null;

/** Flecha izquierda desde el borde: se abre el menú, parado en la sección actual. */
function enterRail(): void {
  const current = searchMode ? searchButton : railButtons.find((button) => button.classList.contains('is-current') && button !== searchButton);
  focusElement(current ?? menuButtons[0] ?? null);
}

function leaveRail(): void {
  const back = lastContentFocus;
  if (back?.isConnected && back.offsetParent !== null) focusElement(back);
  else focusInitial();
}

function handleRailKey(event: KeyboardEvent): void {
  const index = railButtons.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    const next = railButtons[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) focusElement(next);
    else if (document.activeElement instanceof HTMLElement) bump(document.activeElement, event.key === 'ArrowDown' ? 'down' : 'up');
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    leaveRail();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    leaveRail();
  }
}

function markSection(id: SectionId): void {
  currentSection = id;
  for (const button of railButtons) button.classList.toggle('is-current', button.dataset['section'] === id);
  closeSearchPanel();
}

/** Empieza a armar otra lista: cancela la búsqueda en curso y lo que se estaba cargando. */
function beginCatalog(section: SectionId): number {
  clearTimeout(searchTimer);
  searchAbort?.abort();
  searchAbort = null;
  searchSpinner.hidden = true;
  searchMode = false;
  if (document.activeElement !== search) search.value = '';
  markSection(section);
  return ++catalogToken;
}

async function openSection(id: SectionId): Promise<void> {
  if (!player.hidden) stopPlayer();
  if (!detailPanel.hidden) closeDetails();
  if (id === 'inicio') {
    await loadHome();
    return;
  }
  const token = beginCatalog(id);
  rowsEl.replaceChildren();
  resetRows();
  if (id === 'envivo') {
    await loadLive(token);
    return;
  }
  if (id === 'categorias') {
    renderCategoryTiles();
    if (currentCategory) await loadShelves(categoryShelves(currentCategory), token);
    return;
  }
  const shelves = sectionShelves(id, (await library).hasTmdb);
  if (token !== catalogToken) return;
  if (!shelves.length) {
    rebuildNav();
    setStatus('Para ver Anime hace falta la clave gratuita de TMDB (ver el README: "Más títulos con TMDB").');
    focusInitial();
    return;
  }
  await loadShelves(shelves, token);
}

/** Las categorías (Drama, Policiales…): una fila de géneros; al elegir uno, abajo salen sus títulos. */
function renderCategoryTiles(): void {
  const tiles = CATEGORIES.map((category) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `card genre-tile${category === currentCategory ? ' is-current' : ''}`;
    const face = document.createElement('span');
    face.className = 'poster-wrap';
    face.textContent = category.name;
    tile.append(face);
    tile.addEventListener('click', () => {
      if (category === currentCategory && rowsEl.children.length > 1) return;
      currentCategory = category;
      for (const other of tiles) other.classList.toggle('is-current', other === tile);
      void loadShelves(categoryShelves(category), beginCatalog('categorias'));
    });
    return tile;
  });
  appendRow('Categorías', tiles);
  rebuildNav();
  if (!rail.contains(document.activeElement)) focusElement(tiles.find((tile) => tile.classList.contains('is-current')) ?? null);
}

/**
 * Las filas de una sección, de a tres consultas a la vez: cada fila aparece apenas llega (lo
 * guardado de la vez anterior, al instante). Lo que ya está arriba (los géneros) se conserva.
 */
async function loadShelves(shelves: readonly Shelf[], token: number): Promise<void> {
  for (const row of rowsEl.querySelectorAll(':scope > .row:not(:has(.genre-tile))')) row.remove();
  placed = new Set();
  appendSkeleton(2);
  setStatus('Cargando…', true);
  busy(1);
  let count = 0;
  try {
    for (let start = 0; start < shelves.length; start += 3) {
      const batch = shelves.slice(start, start + 3);
      const replies = await Promise.all(batch.map((shelf) => api('shelf', shelfParams(shelf), undefined, true).catch(() => null)));
      if (token !== catalogToken) return;
      for (const skeleton of rowsEl.querySelectorAll(':scope > .row.skeleton')) skeleton.remove();
      batch.forEach((shelf, index) => {
        const items = replies[index]?.items ?? [];
        const first = items[0];
        if (!first) return;
        if (count === 0) showSectionHero(first);
        count++;
        appendRow(shelf.name, items.map((item) => cardFor(item)), index);
      });
      rebuildNav();
      const focused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      hydrateAround(focused && rowsEl.contains(focused) ? focused : null);
      if (focused) revealRow(focused);
      else focusInitial();
    }
  } finally {
    busy(-1);
  }
  if (token !== catalogToken) return;
  for (const skeleton of rowsEl.querySelectorAll(':scope > .row.skeleton')) skeleton.remove();
  setStatus(count ? 'Audio o subtítulos en español' : 'No se pudo cargar esta sección. Revisá la conexión y probá de nuevo.');
}

/** El destacado de una sección: su primer título (si no se está recorriendo una fila). */
function showSectionHero(item: Contracts.LibraryTitle): void {
  catalogHero = { ...item, genres: [] };
  hero.hidden = false;
  catalogEl.classList.remove('no-hero');
  heroPlay.disabled = false;
  heroInfo.disabled = false;
  // Recorriendo títulos, el destacado muestra el elegido; sobre los géneros, la categoría nueva.
  const active = document.activeElement;
  const onTile = active instanceof HTMLElement && active.classList.contains('genre-tile');
  const browsing = active instanceof HTMLElement && rowsEl.contains(active) && !onTile;
  if (!browsing) {
    heroShown = '';
    showSpotlight(catalogHero, onTile);
  }
}

// ---------- En vivo (zlive.st) ----------

const LIVE_GROUPS = ['Deportes', 'Fórmula 1', 'Noticias', 'Entretenimiento', 'Infantiles', 'Otros canales'] as const;
let liveTrigger: HTMLElement | null = null;
let liveTimer = 0;

/** Los canales: primero los que están en español, después por tema. */
async function loadLive(token: number): Promise<void> {
  hero.hidden = true;
  catalogEl.classList.add('no-hero');
  catalogHero = null;
  appendSkeleton(2);
  setStatus('Buscando canales en vivo…', true);
  try {
    const channels = (await api('live')).channels ?? [];
    if (token !== catalogToken) return;
    rowsEl.replaceChildren();
    const groups: [string, readonly Contracts.LibraryChannel[]][] = [
      ['En español', channels.filter((channel) => channel.spanish)],
      ...LIVE_GROUPS.map((group): [string, readonly Contracts.LibraryChannel[]] => [group, channels.filter((channel) => !channel.spanish && channel.category === group)]),
    ];
    groups.forEach(([name, list], index) => { appendRow(name, list.map(channelCard), index); });
    setStatus(`${String(channels.length)} canales en vivo (zlive.st) · Atrás sale del canal`);
    resetRows();
    rebuildNav();
    if (!rail.contains(document.activeElement)) focusInitial();
  } catch (error) {
    if (token !== catalogToken) return;
    rowsEl.replaceChildren();
    setStatus(errorText(error));
  }
}

function channelCard(channel: Contracts.LibraryChannel): HTMLButtonElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card channel-tile';
  card.setAttribute('aria-label', `${channel.name}, en vivo`);
  const face = document.createElement('span');
  face.className = 'poster-wrap';
  const badge = document.createElement('span');
  badge.className = 'live-badge';
  badge.textContent = 'EN VIVO';
  const name = document.createElement('span');
  name.textContent = channel.name;
  const detail = document.createElement('small');
  detail.textContent = [channel.category, channel.region, channel.quality].filter((part) => part !== '').join(' · ');
  face.append(badge, name, detail);
  card.append(face);
  card.addEventListener('click', () => { openLive(channel); });
  return card;
}

/** El canal con el reproductor de zlive, en un marco aislado (sin ventanas nuevas ni salir del Cine). */
function openLive(channel: Contracts.LibraryChannel): void {
  liveTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  liveName.textContent = channel.name;
  livePanel.hidden = false;
  livePanel.classList.remove('idle');
  liveLoading.hidden = false;
  busy(1);
  let loaded = false;
  const ready = (): void => {
    if (loaded) return;
    loaded = true;
    busy(-1);
    liveLoading.hidden = true;
  };
  liveFrame.onload = (): void => { window.setTimeout(ready, 1500); };
  window.setTimeout(ready, 12_000);
  liveFrame.src = channel.url;
  clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => { livePanel.classList.add('idle'); }, 5000);
}

function closeLive(): void {
  if (livePanel.hidden) return;
  clearTimeout(liveTimer);
  liveFrame.onload = null;
  liveFrame.src = 'about:blank';
  livePanel.hidden = true;
  if (!liveLoading.hidden) busy(-1);
  liveLoading.hidden = true;
  focusElement(liveTrigger?.isConnected ? liveTrigger : null);
}

/** En el canal sólo cuenta Atrás; cualquier otra tecla vuelve a mostrar el nombre un rato. */
function handleLiveKey(event: KeyboardEvent): void {
  event.preventDefault();
  if (event.key === 'Escape') {
    closeLive();
    return;
  }
  livePanel.classList.remove('idle');
  clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => { livePanel.classList.add('idle'); }, 4000);
}

// ---------- Legal ----------

function openLegal(): void {
  legalTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  legalPanel.hidden = false;
  focusElement(legalClose);
}

function closeLegal(): void {
  if (legalPanel.hidden) return;
  legalPanel.hidden = true;
  focusElement(legalTrigger?.isConnected && !rail.contains(legalTrigger) ? legalTrigger : null);
  if (!legalTrigger?.isConnected || rail.contains(legalTrigger)) leaveRail();
}

/**
 * Resultados de búsqueda: películas y series en filas separadas (más fácil de recorrer con el
 * control). Si se está escribiendo, el foco se queda en el buscador.
 */
function renderResults(items: readonly Contracts.LibraryTitle[], query: string, approximate: string | null): void {
  rowsEl.replaceChildren();
  placed = new Set();
  const movies = items.filter((item) => item.type === 'movie');
  const series = items.filter((item) => item.type === 'tv');
  const both = movies.length > 0 && series.length > 0;
  const fallback = `Resultados para “${approximate ?? query}”`;
  // Primero la fila del mejor resultado (el servicio ya los ordenó): "breaking bad" → la serie, no un corto.
  const rows: [string, readonly Contracts.LibraryTitle[]][] = [[both ? 'Películas' : fallback, movies], [both ? 'Series' : fallback, series]];
  if (items[0]?.type === 'tv') rows.reverse();
  for (const [name, list] of rows) appendRow(name, list.map((item) => cardFor(item)));
  hydrateAround(null);
  setStatus(!items.length ? `No se encontraron títulos para “${query}”.`
    : approximate ? `Nada exacto para “${query}”: resultados parecidos a “${approximate}”.`
      : `${items.length} resultados para “${query}” · Se reproduce en español.`);
  resetRows();
  rebuildNav();
  // Se sigue escribiendo: el foco se queda en el teclado (o en el buscador).
  if (document.activeElement !== search && !keyboard.contains(document.activeElement)) focusInitial();
}

/** Mientras carga el catálogo: filas "esqueleto" con brillo de carga, en vez de una pantalla vacía. */
function renderSkeleton(): void {
  if (rowsEl.children.length === 0) appendSkeleton(3);
}

function appendSkeleton(count: number): void {
  for (let row = 0; row < count; row++) {
    const section = document.createElement('section');
    section.className = 'row skeleton';
    section.style.setProperty('--i', String(row));
    const heading = document.createElement('h2');
    const bar = document.createElement('span');
    bar.className = 'bar';
    heading.append(bar);
    const track = document.createElement('div');
    track.className = 'track';
    for (let card = 0; card < 9; card++) {
      const placeholder = document.createElement('span');
      placeholder.className = 'card';
      const wrap = document.createElement('span');
      wrap.className = 'poster-wrap';
      const shimmer = document.createElement('span');
      shimmer.className = 'shimmer';
      wrap.append(shimmer);
      placeholder.append(wrap);
      track.append(placeholder);
    }
    section.append(heading, track);
    rowsEl.append(section);
  }
}

/** Lista nueva: vuelve al principio y sin fila activa. */
function resetRows(): void {
  rowsEl.classList.remove('is-loading');
  rowsScroll.style.transform = '';
  activeRow?.classList.remove('is-active');
  activeRow = null;
}

function renderHero(item: Contracts.LibraryHero): void {
  catalogHero = item;
  hero.hidden = false;
  heroPlay.disabled = false;
  heroInfo.disabled = false;
  heroShown = '';
  showSpotlight(item, false);
}

async function loadHome(): Promise<void> {
  const fromSection = currentSection !== 'inicio';
  const token = beginCatalog('inicio');
  if (fromSection) rowsEl.replaceChildren();
  catalogHero = null;
  setStatus('Cargando catálogo…', true);
  renderSkeleton();
  try {
    const reply = await api('home');
    if (token !== catalogToken) return;
    catalogRows = (reply.rows ?? []).filter((row) => row.items.length > 0);
    if (reply.hero) renderHero(reply.hero);
    else { hero.hidden = true; catalogHero = null; }
    catalogEl.classList.toggle('no-hero', hero.hidden);
    renderHome();
  } catch (error) {
    if (token !== catalogToken) return;
    setStatus(errorText(error));
  }
}

async function runSearch(query: string): Promise<void> {
  clearTimeout(searchTimer);
  searchAbort?.abort(); // una búsqueda vieja (se siguió escribiendo) no pisa a la nueva
  const abort = new AbortController();
  searchAbort = abort;
  const token = ++catalogToken;
  searchMode = true;
  setStatus(`Buscando “${query}”…`, true);
  searchSpinner.hidden = false;
  // Lo que había se atenúa mientras busca (no desaparece de golpe); si no había nada, esqueletos.
  if (rowsEl.children.length > 0) rowsEl.classList.add('is-loading');
  else renderSkeleton();
  try {
    const reply = await api('search', { q: query }, abort.signal);
    if (token !== catalogToken) return;
    renderResults(reply.items ?? [], query, reply.approximate ?? null);
  } catch (error) {
    if (token !== catalogToken || abort.signal.aborted) return;
    rowsEl.classList.remove('is-loading');
    setStatus(errorText(error));
  } finally {
    if (token === catalogToken) searchSpinner.hidden = true;
  }
}

/** Mientras se escribe (teclado del celular o de la notebook): busca solo, al dejar de escribir. */
function searchWhileTyping(): void {
  clearTimeout(searchTimer);
  const query = search.value.trim();
  if (query.length < 2) {
    if (searchMode) {
      ++catalogToken;
      searchAbort?.abort();
      searchSpinner.hidden = true;
      rowsEl.replaceChildren();
      rebuildNav();
      setStatus(SEARCH_HINT);
    }
    return;
  }
  searchTimer = window.setTimeout(() => { void runSearch(query); }, SEARCH_DELAY_MS);
}

const SEARCH_HINT = 'Escribí con el teclado de la pantalla o con el del celular ("Escribir en la TV").';

// ---------- Buscador con teclado en pantalla ----------
// Como en Netflix o YouTube en la tele: un teclado que se maneja con las flechas. El del celular
// ("Escribir en la TV") sigue andando: escribe en el mismo buscador.

const KEY_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjklñ', 'zxcvbnm'] as const;

function buildKeyboard(): void {
  KEY_ROWS.forEach((letters, index) => {
    const row = document.createElement('div');
    row.className = 'key-row';
    const key = (label: string, edit: (text: string) => string, wide = false): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `key${wide ? ' wide' : ''}`;
      button.textContent = label;
      button.addEventListener('click', () => {
        search.value = edit(search.value).slice(0, 80);
        searchWhileTyping();
      });
      row.append(button);
    };
    for (const letter of letters) key(letter, (text) => text + letter);
    if (index === KEY_ROWS.length - 1) {
      key('Espacio', (text) => (text && !text.endsWith(' ') ? `${text} ` : text), true);
      key('⌫ Borrar', (text) => text.slice(0, -1), true);
      key('Borrar todo', () => '', true);
    }
    keyboard.append(row);
  });
}
buildKeyboard();

/** El buscador: arriba lo escrito y el teclado; abajo, los resultados. */
function openSearch(): void {
  if (!player.hidden) stopPlayer();
  if (!detailPanel.hidden) closeDetails();
  closeLegal();
  if (!searchMode) {
    clearTimeout(searchTimer);
    searchAbort?.abort();
    ++catalogToken;
    searchMode = true;
    for (const button of railButtons) button.classList.toggle('is-current', button === searchButton);
    searchPanel.hidden = false;
    catalogEl.classList.add('searching', 'no-hero');
    hero.hidden = true;
    rowsEl.replaceChildren();
    resetRows();
    setStatus(search.value.trim().length >= 2 ? '' : SEARCH_HINT);
    if (search.value.trim().length >= 2) void runSearch(search.value.trim());
  }
  rebuildNav();
  focusElement(keyboard.querySelector<HTMLElement>('.key'));
}

function closeSearchPanel(): void {
  searchPanel.hidden = true;
  catalogEl.classList.remove('searching');
}

function rebuildNav(): void {
  navRows = [];
  if (searchMode) {
    navRows.push([search]);
    for (const row of keyboard.querySelectorAll<HTMLElement>('.key-row')) navRows.push([...row.querySelectorAll<HTMLElement>('.key')]);
  } else if (!hero.hidden && !heroActions.hidden) navRows.push([heroPlay, heroInfo]);
  for (const track of rowsEl.querySelectorAll<HTMLElement>('.track')) {
    const cards = [...track.querySelectorAll<HTMLElement>('.card')];
    if (cards.length) navRows.push(cards);
  }
}

function focusInitial(): void {
  const firstTrack = rowsEl.querySelector<HTMLElement>('.track .card');
  // En el buscador, al teclado; en el catálogo, al destacado (o a la primera tarjeta).
  const firstKey = keyboard.querySelector<HTMLElement>('.key');
  focusElement(searchMode ? firstKey : !hero.hidden && !heroActions.hidden ? heroPlay : firstTrack ?? firstKey);
}

function positionIn(rows: readonly HTMLElement[][], node: HTMLElement | null): { row: number; col: number } | null {
  if (!node) return null;
  for (let row = 0; row < rows.length; row++) {
    const col = rows[row]?.indexOf(node) ?? -1;
    if (col >= 0) return { row, col };
  }
  return null;
}

function moveIn(rows: readonly HTMLElement[][], direction: 'up' | 'down' | 'left' | 'right'): void {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const position = positionIn(rows, active);
  if (!position) {
    const first = rows[0]?.[0] ?? null;
    focusElement(first);
    return;
  }
  if (direction === 'left' || direction === 'right') {
    const row = rows[position.row] ?? [];
    const next = row[position.col + (direction === 'right' ? 1 : -1)];
    if (next) focusElement(next);
    // Desde el borde izquierdo del catálogo se abre el menú.
    else if (direction === 'left' && rows === navRows) enterRail();
    // Al final de una fila del catálogo, a la derecha se vuelve al principio (la fila se desliza de vuelta).
    else if (direction === 'right' && active && isCatalogRow(row) && row.length > 1) focusElement(row[0] ?? null);
    else if (active) bump(active, direction);
    return;
  }
  const target = rows[position.row + (direction === 'down' ? 1 : -1)];
  if (!target?.length || !active) {
    if (active) bump(active, direction);
    return;
  }
  focusElement(entryPoint(target, active));
}

/** Una fila de tarjetas del catálogo (las que se deslizan enteras). */
function isCatalogRow(row: readonly HTMLElement[]): boolean {
  return row[0]?.parentElement?.classList.contains('track') === true;
}

/**
 * Al entrar a una fila. En el catálogo, como en las plataformas de los Chromecast: desde el
 * principio de la fila. En el resto (botones, la ficha): donde se había quedado o lo más cercano.
 */
function entryPoint(target: readonly HTMLElement[], from: HTMLElement): HTMLElement {
  // Al menú o a los géneros se entra por lo que está elegido (la sección o categoría actual).
  const current = target.find((node) => node.classList.contains('is-current'));
  if (current) return current;
  if (isCatalogRow(target)) return target[0] as HTMLElement;
  const container = target[0]?.parentElement;
  const remembered = container ? rowMemory.get(container) : undefined;
  const saved = remembered === undefined ? undefined : container?.children[remembered];
  if (saved instanceof HTMLElement && target.includes(saved)) return saved;
  const box = from.getBoundingClientRect();
  const x = box.left + box.width / 2;
  let best = target[0] as HTMLElement;
  let distance = Infinity;
  for (const node of target) {
    const rect = node.getBoundingClientRect();
    const gap = Math.abs(rect.left + rect.width / 2 - x);
    if (gap < distance) {
      distance = gap;
      best = node;
    }
  }
  return best;
}

/** No hay nada hacia ese lado: un pequeño rebote avisa (en vez de no hacer nada). */
function bump(node: HTMLElement, direction: 'up' | 'down' | 'left' | 'right'): void {
  const dx = direction === 'left' ? -6 : direction === 'right' ? 6 : 0;
  const dy = direction === 'up' ? -5 : direction === 'down' ? 5 : 0;
  node.animate([{ translate: '0 0' }, { translate: `${String(dx)}px ${String(dy)}px` }, { translate: '0 0' }],
    { duration: 220, easing: 'cubic-bezier(.3,1.35,.5,1)' });
}

// ---------- Ficha ----------

/** Año, puntaje, tipo, duración o temporadas y géneros, como etiquetas. */
function renderMeta(item: Contracts.LibraryTitle, genres: readonly string[], runtime: number | null, seasons = 0): void {
  const chip = (text: string, kind = ''): HTMLElement => {
    const span = document.createElement('span');
    span.className = `meta-chip${kind ? ` ${kind}` : ''}`;
    span.textContent = text;
    return span;
  };
  const chips = [
    ...(item.rating ? [chip(`★ ${item.rating}`, 'rating')] : []),
    ...(item.year ? [chip(item.year)] : []),
    chip(item.type === 'tv' ? 'Serie' : 'Película', 'kind'),
    ...(runtime && runtime > 0 ? [chip(runtimeText(runtime))] : []),
    ...(seasons > 0 ? [chip(seasons === 1 ? '1 temporada' : `${String(seasons)} temporadas`)] : []),
    ...genres.slice(0, 4).map((genre) => chip(genre, 'genre')),
  ];
  detailMeta.replaceChildren(...chips);
}

function renderSeasons(details: Contracts.LibraryDetails): void {
  seasonBar.replaceChildren();
  if (details.seasons.length === 0) {
    seasonBar.hidden = true;
    return;
  }
  seasonBar.hidden = false;
  for (const season of details.seasons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `season${season.number === currentSeason ? ' is-active' : ''}`;
    button.textContent = season.number === 0 ? 'Especiales' : `Temporada ${season.number}`;
    button.title = season.name;
    button.setAttribute('aria-pressed', String(season.number === currentSeason));
    button.addEventListener('click', () => {
      if (season.number === currentSeason) return;
      currentSeason = season.number;
      for (const chip of seasonBar.querySelectorAll<HTMLElement>('.season')) {
        chip.classList.toggle('is-active', chip === button);
        chip.setAttribute('aria-pressed', String(chip === button));
      }
      void loadSeason(season.number, detailToken);
    });
    seasonBar.append(button);
  }
}

async function loadSeason(season: number, token: number): Promise<void> {
  const item = currentItem;
  if (!item || item.type !== 'tv' || !currentDetails) return;
  currentSeason = season;
  episodesEl.replaceChildren();
  // Episodios cargando: tres renglones "esqueleto" con brillo (no son elegibles con el control).
  for (let index = 0; index < 3; index++) {
    const placeholder = document.createElement('div');
    placeholder.className = 'episode skeleton';
    const shimmer = document.createElement('span');
    shimmer.className = 'shimmer';
    placeholder.append(shimmer);
    episodesEl.append(placeholder);
  }
  rebuildDetailRows();
  try {
    const reply = await api('season', { id: item.id, type: 'tv', season: String(season) });
    if (token !== detailToken) return;
    currentEpisodes = reply.episodes ?? [];
    renderEpisodes();
  } catch (error) {
    if (token !== detailToken) return;
    currentEpisodes = [];
    episodesEl.replaceChildren();
    const message = document.createElement('p');
    message.className = 'status';
    message.textContent = errorText(error);
    episodesEl.append(message);
    rebuildDetailRows();
  }
}

function renderEpisodes(): void {
  episodesEl.replaceChildren();
  const item = currentItem;
  if (!item) return;
  for (const episode of currentEpisodes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'episode';
    const still = document.createElement('img');
    still.alt = '';
    still.loading = 'lazy';
    still.decoding = 'async';
    still.width = 132;
    still.height = 74;
    if (episode.still) still.src = episode.still;
    const body = document.createElement('span');
    body.className = 'ep-body';
    const title = document.createElement('span');
    title.className = 'ep-title';
    title.textContent = `T${episode.season} E${episode.episode} · ${episode.name}`;
    const overview = document.createElement('span');
    overview.className = 'ep-overview';
    overview.textContent = episode.overview;
    body.append(title, overview);
    button.append(still, body);
    button.addEventListener('click', () => {
      void startPlayback(item, episode.season, episode.episode, episode.name);
    });
    episodesEl.append(button);
  }
  rebuildDetailRows();
}

function rebuildDetailRows(): void {
  detailRows = [];
  const actions = [detailClose, detailPlay, detailServers].filter((button) => !button.disabled);
  detailRows.push(actions);
  if (!serversEl.hidden) {
    const chips = [...serversEl.querySelectorAll<HTMLElement>('.server')];
    if (chips.length) detailRows.push(chips);
  }
  if (!seasonBar.hidden) {
    const chips = [...seasonBar.querySelectorAll<HTMLElement>('.season')];
    if (chips.length) detailRows.push(chips);
  }
  for (const episode of episodesEl.querySelectorAll<HTMLElement>('.episode:not(.skeleton)')) detailRows.push([episode]);
  if (!relatedEl.hidden) {
    const cards = [...relatedTrack.querySelectorAll<HTMLElement>('.card')];
    if (cards.length) detailRows.push(cards);
  }
}

function renderRelated(items: readonly Contracts.LibraryTitle[]): void {
  relatedTrack.replaceChildren();
  relatedEl.hidden = items.length === 0;
  for (const item of items) {
    const card = makeCard(item);
    hydrateCard(card); // la ficha muestra pocos: se bajan de una
    relatedTrack.append(card);
  }
  rebuildDetailRows();
}

function renderServers(providers: readonly Contracts.LibraryProvider[]): void {
  serversEl.replaceChildren();
  serversEl.hidden = false;
  for (const provider of providers) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'server';
    const name = document.createElement('b');
    name.textContent = provider.name;
    const tagline = document.createElement('span');
    tagline.textContent = provider.tagline;
    button.append(name, tagline);
    button.addEventListener('click', () => {
      const item = currentItem;
      if (!item) return;
      void startPlayback(item, item.type === 'tv' ? currentSeason : 0, item.type === 'tv' ? 1 : 0, '', { provider: provider.id });
    });
    serversEl.append(button);
  }
  rebuildDetailRows();
}

async function toggleServers(): Promise<void> {
  if (!currentItem) return;
  if (!serversEl.hidden) {
    serversEl.hidden = true;
    rebuildDetailRows();
    focusElement(detailServers);
    return;
  }
  serversEl.hidden = false;
  serversEl.replaceChildren();
  showStatus(detailStatus, 'Consultando servidores…', true);
  try {
    const providers = providersCache ?? (await api('providers')).providers ?? [];
    providersCache = providers;
    showStatus(detailStatus, '');
    renderServers(providers);
    focusElement(serversEl.querySelector('button'));
  } catch (error) {
    serversEl.hidden = true;
    detailStatus.textContent = errorText(error);
    rebuildDetailRows();
  }
}

async function openDetails(
  item: Contracts.LibraryTitle,
  options: { autoplay?: boolean; resume?: ProgressEntry } = {},
): Promise<void> {
  const token = ++detailToken;
  playToken++;
  currentItem = item;
  currentDetails = null;
  currentEpisodes = [];
  currentSeason = options.resume?.season ?? 1;
  detailTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  detailPanel.hidden = false;
  document.body.classList.add('sheet-open');
  detailKind.textContent = item.type === 'tv' ? 'Serie' : 'Película';
  detailTitle.textContent = item.title;
  renderMeta(item, [], null);
  detailBody.classList.add('is-loading');
  detailLanguage.textContent = 'Se reproducirá con audio o subtítulos en español.';
  detailOverview.textContent = item.overview;
  detailCast.textContent = '';
  showStatus(detailStatus, 'Cargando ficha…', true);
  detailPlay.disabled = true;
  detailPlay.replaceChildren();
  const icon = document.createElement('span');
  icon.className = 'ico';
  icon.textContent = '▶';
  detailPlay.append(icon, document.createTextNode('Reproducir'));
  serversEl.hidden = true;
  serversEl.replaceChildren();
  seasonBar.hidden = true;
  seasonBar.replaceChildren();
  episodesEl.replaceChildren();
  relatedEl.hidden = true;
  relatedTrack.replaceChildren();
  detailBody.scrollTop = 0;
  const image = large(item.backdrop) || item.poster;
  if (image) {
    detailImage.src = image;
    detailImage.hidden = false;
  } else {
    detailImage.removeAttribute('src');
    detailImage.hidden = true;
  }
  detailPanel.classList.add('is-open');
  focusElement(detailClose);
  try {
    const reply = await api('details', { id: item.id, type: item.type });
    if (token !== detailToken) return;
    const details = reply.details;
    if (details) {
      currentDetails = details;
      renderMeta(details, details.genres, details.runtime, details.seasons.filter((season) => season.number > 0).length);
      detailLanguage.textContent = details.originalLanguage === 'es'
        ? 'Audio original en español.'
        : 'Se reproducirá con audio o subtítulos en español.';
      detailOverview.textContent = details.overview || item.overview;
      detailCast.textContent = details.cast.length
        ? `Reparto: ${details.cast.slice(0, 6).map((person) => person.name).join(', ')}`
        : '';
      const firstSeason = details.seasons.find((season) => season.number > 0)?.number ?? details.seasons[0]?.number ?? 1;
      currentSeason = options.resume?.season ?? firstSeason;
      renderSeasons(details);
      renderRelated(details.related ?? []);
      if (item.type === 'tv') await loadSeason(currentSeason, token);
    }
    if (token !== detailToken) return;
    showStatus(detailStatus, '');
    detailBody.classList.remove('is-loading');
    detailPlay.disabled = false;
    rebuildDetailRows();
    if (!options.autoplay) prefetchSource(item, item.type === 'tv' ? currentSeason : 0, item.type === 'tv' ? (options.resume?.episode ?? 1) : 0);
    if (options.autoplay) {
      const season = item.type === 'tv' ? currentSeason : 0;
      const episode = item.type === 'tv' ? (options.resume?.episode ?? 1) : 0;
      const name = options.resume?.name ?? '';
      void startPlayback(item, season, episode, name);
      return;
    }
    if (document.activeElement === detailClose) focusElement(detailPlay);
  } catch (error) {
    if (token !== detailToken) return;
    showStatus(detailStatus, errorText(error));
    detailBody.classList.remove('is-loading');
    detailPlay.disabled = false;
    rebuildDetailRows();
    if (document.activeElement === detailClose) focusElement(detailPlay);
    if (options.autoplay) {
      const season = item.type === 'tv' ? currentSeason : 0;
      const episode = item.type === 'tv' ? (options.resume?.episode ?? 1) : 0;
      void startPlayback(item, season, episode, options.resume?.name ?? '');
    }
  }
}

/**
 * Mientras se lee la ficha, el servicio ya busca la fuente de video (y la guarda un rato): al
 * apretar "Reproducir" está lista. Si falla no importa: "Reproducir" la vuelve a buscar.
 */
function prefetchSource(item: Contracts.LibraryTitle, season: number, episode: number): void {
  const params: Record<string, string> = { id: item.id, type: item.type };
  if (item.type === 'tv') {
    params['season'] = String(season);
    params['episode'] = String(episode);
  }
  void api('resolve', params).catch(() => undefined);
}

function closeDetails(): void {
  if (detailPanel.hidden) return;
  detailToken++;
  playToken++;
  detailPanel.hidden = true;
  detailPanel.classList.remove('is-open');
  document.body.classList.remove('sheet-open');
  const trigger = detailTrigger;
  detailTrigger = null;
  if (trigger?.isConnected) focusElement(trigger);
  else focusInitial();
}

// ---------- Reproductor ----------

function loadHls(): Promise<typeof Hls> {
  if (window.Hls) return Promise.resolve(window.Hls);
  loadingHls ??= new Promise<typeof Hls>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/hls.js'; // parte de la app (se copia al compilar)
    script.onload = () => {
      if (window.Hls) resolve(window.Hls);
      else {
        loadingHls = null;
        reject(new Error('No se pudo cargar el reproductor HLS.'));
      }
    };
    script.onerror = () => {
      script.remove();
      loadingHls = null;
      reject(new Error('No se pudo cargar el reproductor HLS.'));
    };
    document.head.append(script);
  });
  return loadingHls;
}

function releaseVideo(): void {
  if (hls) {
    hls.destroy();
    hls = null;
  }
  for (const track of [...video.querySelectorAll('track')]) track.remove();
  video.pause();
  video.removeAttribute('src');
  video.load();
  currentSubtitles = [];
  subtitleIndex = -1;
  watchCues(null);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
}

function applySubtitleMode(): void {
  let selected: TextTrack | null = null;
  for (let index = 0; index < video.textTracks.length; index++) {
    const track = video.textTracks[index];
    if (!track) continue;
    // 'hidden': la pista se carga y avisa cada frase, pero la dibuja la app (tamaño y altura a gusto).
    track.mode = index === subtitleIndex ? 'hidden' : 'disabled';
    if (index === subtitleIndex) selected = track;
  }
  if (subtitleIndex >= 0) loadSubtitle(subtitleIndex);
  watchCues(selected);
}

// ---------- Subtítulos dibujados por la app ----------
// Los de Edge salen pegados al borde de abajo y grandes, sin forma de moverlos. Acá se dibujan en
// una capa propia: tamaño y altura se eligen desde el reproductor y quedan guardados.

const SUBTITLE_SIZES = [['Chico', 2.8], ['Mediano', 3.4], ['Grande', 4.1], ['Muy grande', 4.9]] as const;
/** Distancia desde el borde de abajo de la pantalla (vh). */
const SUBTITLE_HEIGHTS = [['Baja', 7], ['Media', 14], ['Alta', 22], ['Muy alta', 30]] as const;
const SUBTITLE_STORE = 'cine:subtitles:v1';
const subtitleBox = byId<HTMLDivElement>('subtitleBox');
const subtitleSizeBtn = byId<HTMLButtonElement>('subtitleSizeBtn');
const subtitleHeightBtn = byId<HTMLButtonElement>('subtitleHeightBtn');
const subtitleStyle = readSubtitleStyle();
let cueTrack: TextTrack | null = null;
let sampleTimer = 0;

function readSubtitleStyle(): { size: number; height: number } {
  const fallback = { size: 1, height: 2 }; // mediano y alto
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SUBTITLE_STORE) ?? 'null');
    if (!isRecord(saved)) return fallback;
    const size = numberValue(saved['size']);
    const height = numberValue(saved['height']);
    return {
      size: size !== null && size >= 0 && size < SUBTITLE_SIZES.length ? Math.floor(size) : fallback.size,
      height: height !== null && height >= 0 && height < SUBTITLE_HEIGHTS.length ? Math.floor(height) : fallback.height,
    };
  } catch {
    return fallback;
  }
}

function applySubtitleStyle(): void {
  const [sizeName, size] = SUBTITLE_SIZES[subtitleStyle.size] ?? SUBTITLE_SIZES[1];
  const [heightName, height] = SUBTITLE_HEIGHTS[subtitleStyle.height] ?? SUBTITLE_HEIGHTS[2];
  player.style.setProperty('--sub-size', `${String(size)}vh`);
  player.style.setProperty('--sub-bottom', `${String(height)}vh`);
  subtitleSizeBtn.textContent = `Tamaño: ${sizeName}`;
  subtitleHeightBtn.textContent = `Altura: ${heightName}`;
}

function changeSubtitleStyle(kind: 'size' | 'height'): void {
  const count = kind === 'size' ? SUBTITLE_SIZES.length : SUBTITLE_HEIGHTS.length;
  subtitleStyle[kind] = (subtitleStyle[kind] + 1) % count;
  try { localStorage.setItem(SUBTITLE_STORE, JSON.stringify(subtitleStyle)); } catch { /* sin guardar: vale para esta vez */ }
  applySubtitleStyle();
  // Sin una frase en pantalla, se muestra un ejemplo para ver cómo queda.
  if (!subtitleBox.querySelector('.cue:not(.sample)')) {
    const sample = document.createElement('span');
    sample.className = 'cue sample';
    sample.textContent = 'Así se van a ver los subtítulos';
    subtitleBox.replaceChildren(sample);
    clearTimeout(sampleTimer);
    sampleTimer = window.setTimeout(renderCues, 2500);
  }
}

function watchCues(track: TextTrack | null): void {
  cueTrack?.removeEventListener('cuechange', renderCues);
  cueTrack = track;
  cueTrack?.addEventListener('cuechange', renderCues);
  renderCues();
}

function renderCues(): void {
  const cues = cueTrack?.activeCues;
  const lines: HTMLElement[] = [];
  for (let index = 0; cues && index < cues.length; index++) {
    const cue = cues[index];
    if (!(cue instanceof VTTCue)) continue;
    const line = document.createElement('span');
    line.className = 'cue';
    line.append(cue.getCueAsHTML()); // cursivas y saltos de línea del subtítulo, como texto (nunca HTML suelto)
    lines.push(line);
  }
  subtitleBox.replaceChildren(...lines);
}

/**
 * Los subtítulos de la fuente (la biblioteca sólo deja los que están en español, primero los latinos).
 * Se activa el primero, salvo que el audio ya sea en español (ahí quedan para el botón Subtítulos).
 * Cada pista se baja recién cuando se elige (ver loadSubtitle).
 */
function addTracks(source: Contracts.LibrarySource): void {
  for (const track of [...video.querySelectorAll('track')]) track.remove();
  const spanishAudio = isSpanish(source.audio ?? '') || (source.audioTracks ?? []).some((track) => isSpanish(track.lang) || isSpanish(track.label));
  const preferred = currentSubtitles.length > 0 && !spanishAudio ? 0 : -1;
  currentSubtitles.forEach((subtitle) => {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = subtitle.label || subtitle.lang.toUpperCase();
    track.srclang = subtitle.lang;
    video.append(track);
  });
  subtitleIndex = preferred;
  window.setTimeout(applySubtitleMode, 0);
}

/** Subtítulos ya bajados (dirección original → copia WebVTT en memoria). */
const subtitleFiles = new Map<string, Promise<string | null>>();

/**
 * Baja el subtítulo elegido (muchos vienen en SRT: la biblioteca los pasa a WebVTT) y se lo da al
 * video desde la memoria. Así no hace falta ningún servidor intermedio.
 */
function loadSubtitle(index: number): void {
  const subtitle = currentSubtitles[index];
  const element = video.querySelectorAll('track')[index];
  if (!subtitle || !element || element.src) return;
  let file = subtitleFiles.get(subtitle.url);
  if (!file) {
    file = library.then((source) => source.subtitle(subtitle.url))
      .then((text) => (text ? URL.createObjectURL(new Blob([text], { type: 'text/vtt' })) : null))
      .catch(() => null);
    subtitleFiles.set(subtitle.url, file);
  }
  void file.then((url) => {
    if (url && element.isConnected) element.src = url;
    else if (!url && element.isConnected && index === subtitleIndex) toast('No se pudieron cargar esos subtítulos.');
  });
}

function playVideo(): void {
  if (player.hidden) return;
  void video.play().catch(() => {
    playerStatus.textContent = 'Presioná OK para comenzar.';
    showControls();
    focusElement(toggle);
  });
}

/** Si el HLS trae varias pistas, arranca en español (el servicio ya descartó las fuentes sin español). */
function selectSpanishAudio(engine: Hls, source: Contracts.LibrarySource): void {
  const tracks = engine.audioTracks;
  if (!tracks.length) return;
  const wanted = (source.audioTracks ?? []).find((track) => isSpanish(track.lang) || isSpanish(track.label));
  const index = tracks.findIndex((track) => {
    const lang = typeof track.lang === 'string' ? track.lang : '';
    const name = typeof track.name === 'string' ? track.name : '';
    if (wanted) {
      if (wanted.lang !== '' && lang.toLowerCase() === wanted.lang.toLowerCase()) return true;
      if (wanted.label !== '' && name.toLowerCase() === wanted.label.toLowerCase()) return true;
    }
    return isSpanish(lang) || isSpanish(name);
  });
  const selected = tracks[index];
  if (selected) {
    engine.audioTrack = index;
    return;
  }
  // Algunos manifiestos no traen idioma en las pistas: usar el orden que anunció la API.
  const wantedIndex = wanted ? (source.audioTracks ?? []).indexOf(wanted) : -1;
  if (wantedIndex >= 0 && wantedIndex < tracks.length) engine.audioTrack = wantedIndex;
}

async function startVideo(source: Contracts.LibrarySource, subtitles: readonly Contracts.LibrarySubtitle[], token: number): Promise<void> {
  releaseVideo();
  closeMenu();
  currentSubtitles = subtitles;
  currentSource = source;
  playerStatus.textContent = 'Cargando video…';
  player.classList.remove('idle');
  playerTop.hidden = false;
  playerControls.hidden = false;
  if (source.type === 'hls' && !video.canPlayType('application/vnd.apple.mpegurl')) {
    const Engine = await loadHls();
    if (token !== playToken) return;
    const engine = new Engine({
      enableWorker: true, maxBufferLength: 20, maxMaxBufferLength: 40,
      maxBufferSize: 24 * 1024 * 1024, backBufferLength: 10, capLevelToPlayerSize: true,
    });
    hls = engine;
    engine.on(Engine.Events.MANIFEST_PARSED, () => {
      const compatible = engine.levels
        .map((level, index) => ({ level, index }))
        .filter(({ level }) => (level.height || 0) <= 1080 && (!level.videoCodec || /^avc/i.test(level.videoCodec)));
      if (compatible.length) engine.autoLevelCapping = compatible[compatible.length - 1]?.index ?? -1;
      selectSpanishAudio(engine, source);
      addTracks(source);
      playVideo();
    });
    engine.on(Engine.Events.AUDIO_TRACKS_UPDATED, () => { selectSpanishAudio(engine, source); });
    engine.on(Engine.Events.ERROR, (_event, data) => {
      if (data.fatal && token === playToken) void tryNextServer(token);
    });
    engine.loadSource(source.url);
    engine.attachMedia(video);
  } else {
    video.src = source.url;
    addTracks(source);
    playVideo();
  }
}

function nextContext(item: Contracts.LibraryTitle, season: number, episode: number): PlayContext | null {
  if (item.type !== 'tv') return null;
  const index = currentEpisodes.findIndex((entry) => entry.season === season && entry.episode === episode);
  const next = index >= 0 ? currentEpisodes[index + 1] : undefined;
  return next
    ? { item, season: next.season, episode: next.episode, name: next.name, next: null }
    : null;
}

/** Lo que se muestra en el reproductor: confirma si va con audio o con subtítulos en español. */
function sourceLanguage(source: Contracts.LibrarySource): string {
  const audio = source.audio ?? '';
  const tracks = source.audioTracks ?? [];
  const spanishAudio = audio !== ''
    ? isSpanish(audio)
    : tracks.some((track) => isSpanish(track.lang) || isSpanish(track.label));
  return spanishAudio ? 'Audio en español' : 'Subtítulos en español';
}

interface PlayOptions {
  /** Un servidor elegido a mano. */
  readonly provider?: string;
  /** Sólo un servidor con audio en español (no alcanza con subtítulos). */
  readonly needAudio?: boolean;
  /** Retomar en este segundo (cambio de servidor a mitad de la película). */
  readonly resumeFrom?: number;
}

async function startPlayback(
  item: Contracts.LibraryTitle, season: number, episode: number, name: string, options: PlayOptions = {},
): Promise<void> {
  const provider = options.provider;
  const token = ++playToken;
  const fromDetails = !detailPanel.hidden;
  // Si ya había una ficha abierta (o se viene de "siguiente episodio"), Atrás vuelve a ella.
  returnToDetails = fromDetails || currentDetails !== null;
  triedProviders = provider ? [provider] : [];
  playerContext = { item, season, episode, name, next: nextContext(item, season, episode) };
  const key = progressKey(item.type, item.id, season, episode);
  resumeAt = options.resumeFrom !== undefined && options.resumeFrom > 5 ? options.resumeFrom : savedTime(key);
  const previous = currentProvider;
  nextBtn.hidden = !playerContext.next;
  nextBtn.textContent = playerContext.next?.name ? `Siguiente: ${playerContext.next.name}` : 'Siguiente episodio';
  releaseVideo();
  const searching = options.needAudio ? 'Buscando un servidor con audio en español…'
    : provider ? 'Conectando con el servidor elegido…' : 'Buscando servidor con audio o subtítulos en español…';
  if (fromDetails) {
    showStatus(detailStatus, searching, true);
    detailPlay.disabled = true;
  } else {
    playerStatus.textContent = searching;
    retryBtn.hidden = true;
  }
  const params: Record<string, string> = { id: item.id, type: item.type };
  if (item.type === 'tv') {
    params['season'] = String(season);
    params['episode'] = String(episode);
  }
  if (provider) params['provider'] = provider;
  if (options.needAudio) {
    params['need'] = 'audio';
    if (previous) params['exclude'] = previous;
  }
  try {
    const reply = provider ? await api('stream', params) : await api('resolve', params);
    if (token !== playToken) return;
    const source = reply.sources?.[0];
    if (!source) throw new Error('Ese servidor no entregó una fuente compatible.');
    if (reply.provider) triedProviders.push(reply.provider);
    currentProvider = reply.provider ?? provider ?? '';
    currentSources = reply.sources ?? [];
    if (fromDetails) {
      detailPlay.disabled = false;
      showStatus(detailStatus, '');
      detailPanel.hidden = true;
      document.body.classList.remove('sheet-open');
    }
    player.hidden = false;
    document.body.classList.add('playing');
    playerTop.hidden = false;
    playerControls.hidden = false;
    player.classList.remove('idle');
    playingTitle.textContent = item.title;
    const line = item.type === 'tv' ? `T${season} E${episode}${name ? ` · ${name}` : ''}` : metaText(item);
    playingMeta.textContent = [line, source.quality, sourceLanguage(source)].filter((part) => part !== '').join(' · ');
    playerStatus.textContent = 'Cargando video…';
    retryBtn.hidden = true;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.title,
        artist: 'Cine ControlTV',
        album: item.year,
        artwork: item.poster ? [{ src: item.poster }] : [],
      });
    }
    await startVideo(source, reply.subtitles ?? [], token);
  } catch (error) {
    if (token !== playToken) return;
    releaseVideo();
    detailPlay.disabled = false;
    if (fromDetails) {
      // No se entra al reproductor para mostrar un error: se queda en la ficha.
      player.hidden = true;
      document.body.classList.remove('playing');
      showStatus(detailStatus, errorText(error));
      focusElement(detailPlay);
    } else {
      playerStatus.textContent = errorText(error);
      retryBtn.hidden = false;
      focusElement(retryBtn);
    }
  }
}

async function tryNextServer(token: number): Promise<void> {
  if (token !== playToken || player.hidden || !playerContext) return;
  if (performance.now() - lastFallbackAt < 1200) return;
  lastFallbackAt = performance.now();
  // Si el servidor falló a mitad de la película, el siguiente retoma en el mismo minuto.
  if (Number.isFinite(video.currentTime) && video.currentTime > 5) resumeAt = video.currentTime;
  releaseVideo();
  if (triedProviders.length >= 5) {
    playerStatus.textContent = 'Ningún servidor de este título entregó una fuente compatible.';
    retryBtn.hidden = true;
    return;
  }
  playerStatus.textContent = 'Probando otro servidor…';
  retryBtn.hidden = true;
  const context = playerContext;
  const params: Record<string, string> = { id: context.item.id, type: context.item.type, exclude: triedProviders.join(',') };
  if (context.item.type === 'tv') {
    params['season'] = String(context.season);
    params['episode'] = String(context.episode);
  }
  try {
    const reply = await api('resolve', params);
    if (token !== playToken) return;
    const source = reply.sources?.[0];
    if (!source) throw new Error('No quedan servidores compatibles.');
    if (reply.provider) triedProviders.push(reply.provider);
    currentProvider = reply.provider ?? '';
    currentSources = reply.sources ?? [];
    await startVideo(source, reply.subtitles ?? [], token);
  } catch (error) {
    if (token !== playToken) return;
    playerStatus.textContent = errorText(error);
    retryBtn.hidden = false;
  }
}

function showControls(): void {
  player.classList.remove('idle');
  clearTimeout(hideTimer);
  if (!video.paused) hideTimer = window.setTimeout(hideControls, HIDE_CONTROLS_MS);
}

function hideControls(): void {
  if (video.paused || !playerMenu.hidden) return;
  player.classList.add('idle');
  if (document.activeElement instanceof HTMLElement && playerControls.contains(document.activeElement)) {
    video.focus({ preventScroll: true });
  }
}

function togglePlayback(): void {
  if (video.paused) void video.play().catch(() => undefined);
  else video.pause();
  showControls();
}

function seek(seconds: number): void {
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
  const target = Math.max(0, video.currentTime + seconds);
  video.currentTime = duration ? Math.min(duration - 1, target) : target;
  updateProgress();
  showControls();
  // Aviso corto en el centro ("+10 s"), que se va solo.
  const flash = document.createElement('div');
  flash.className = 'seek-flash';
  flash.textContent = `${seconds > 0 ? '+' : '−'}${String(Math.abs(seconds))} s`;
  player.querySelector('.seek-flash')?.remove();
  player.append(flash);
  // También por tiempo: si la animación no corre (Windows sin efectos visuales), el aviso quedaba clavado.
  flash.addEventListener('animationend', () => { flash.remove(); });
  window.setTimeout(() => { flash.remove(); }, 800);
}

function updateProgress(): void {
  const duration = video.duration;
  const ratio = Number.isFinite(duration) && duration > 0 ? video.currentTime / duration : 0;
  progressFill.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`;
  timeEl.textContent = `${clock(video.currentTime)} / ${Number.isFinite(duration) && duration > 0 ? clock(duration) : 'En vivo'}`;
}

// ---------- Opciones del reproductor ----------
// Subtítulos, audio, calidad y servidor: un panel con la lista (como en Netflix), en vez de ir
// pasando de a una opción a ciegas.

interface MenuOption {
  readonly label: string;
  readonly detail?: string;
  readonly selected?: boolean;
  /** Una acción (buscar otro servidor) y no una opción para marcar. */
  readonly action?: boolean;
  readonly run: () => void;
}

let menuTrigger: HTMLElement | null = null;

function openMenu(title: string, options: readonly MenuOption[], note = ''): void {
  menuTrigger = document.activeElement instanceof HTMLElement && playerControls.contains(document.activeElement) ? document.activeElement : toggle;
  playerMenuTitle.textContent = title;
  playerMenuList.replaceChildren();
  if (note) {
    const text = document.createElement('p');
    text.className = 'menu-note';
    text.textContent = note;
    playerMenuList.append(text);
  }
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `menu-option${option.selected ? ' is-selected' : ''}${option.action ? ' action' : ''}`;
    button.setAttribute('role', option.action ? 'menuitem' : 'menuitemradio');
    if (!option.action) button.setAttribute('aria-checked', String(option.selected === true));
    const label = document.createElement('span');
    label.textContent = option.label;
    if (option.detail) {
      const detail = document.createElement('small');
      detail.textContent = option.detail;
      label.append(detail);
    }
    button.append(label);
    button.addEventListener('click', () => {
      closeMenu();
      option.run();
    });
    playerMenuList.append(button);
  }
  playerMenu.hidden = false;
  showControls();
  clearTimeout(hideTimer);
  const buttons = [...playerMenuList.querySelectorAll<HTMLElement>('.menu-option')];
  focusElement(buttons.find((button) => button.classList.contains('is-selected')) ?? buttons[0] ?? null);
}

function closeMenu(): void {
  if (playerMenu.hidden) return;
  playerMenu.hidden = true;
  if (!player.hidden) {
    focusElement(menuTrigger?.isConnected ? menuTrigger : toggle);
    showControls();
  }
}

function handleMenuKey(event: KeyboardEvent): void {
  const buttons = [...playerMenuList.querySelectorAll<HTMLElement>('.menu-option')];
  const index = buttons.indexOf(document.activeElement as HTMLElement);
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) {
      focusElement(next);
      next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (document.activeElement instanceof HTMLElement) bump(document.activeElement, event.key === 'ArrowDown' ? 'down' : 'up');
  } else if (event.key === 'Escape' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    closeMenu();
  }
}

const LANGUAGES: Readonly<Record<string, string>> = {
  en: 'Inglés', ja: 'Japonés', ko: 'Coreano', fr: 'Francés', it: 'Italiano', de: 'Alemán', pt: 'Portugués',
  zh: 'Chino', ru: 'Ruso', hi: 'Hindi', tr: 'Turco', ar: 'Árabe',
};

function languageName(code: string, name: string, index: number): string {
  if (isSpanish(code) || isSpanish(name)) return name && !/^spa|^es$/i.test(name) ? `Español (${name})` : 'Español';
  return LANGUAGES[code.slice(0, 2).toLowerCase()] ?? (name || `Pista ${String(index + 1)}`);
}

/** ¿Se está viendo con audio en español? (Si no, va con subtítulos.) */
function spanishAudioNow(): boolean {
  if (hls && hls.audioTracks.length > 0) {
    const track = hls.audioTracks[hls.audioTrack];
    if (track && (isSpanish(track.lang ?? '') || isSpanish(track.name))) return true;
  }
  return currentSource !== null && hasSpanishAudio(currentSource);
}

function audioServerOption(): MenuOption {
  return { label: 'Buscar servidor con audio en español', detail: 'Retoma en el mismo minuto', action: true, run: () => { switchServer(undefined, true); } };
}

function setSubtitle(index: number): void {
  subtitleIndex = index;
  applySubtitleMode();
  const subtitle = currentSubtitles[index];
  toast(index < 0 ? 'Subtítulos desactivados' : `Subtítulos: ${subtitle ? subtitleLabel(subtitle.label) : ''}`);
}

function subtitlesMenu(): void {
  const options: MenuOption[] = [
    { label: 'Desactivados', selected: subtitleIndex < 0, run: () => { setSubtitle(-1); } },
    ...currentSubtitles.map((subtitle, index): MenuOption => ({
      label: subtitleLabel(subtitle.label),
      detail: latinSubtitle(subtitle) ? 'Latinoamérica' : 'Español',
      selected: index === subtitleIndex,
      run: () => { setSubtitle(index); },
    })),
  ];
  if (!currentSubtitles.length) options.push({ label: 'Probar otro servidor', detail: 'Retoma en el mismo minuto', action: true, run: () => { switchServer(); } });
  openMenu('Subtítulos', options, currentSubtitles.length ? '' : 'Este título no tiene subtítulos en español en esta fuente.');
}

function latinSubtitle(subtitle: Contracts.LibrarySubtitle): boolean {
  return /latino|latina|\(la\)|\bla\b/i.test(`${subtitle.label} ${subtitle.url}`);
}

function audioMenu(): void {
  const engine = hls;
  const spanish = spanishAudioNow();
  const options: MenuOption[] = engine && engine.audioTracks.length > 0
    ? engine.audioTracks.map((track, index): MenuOption => ({
      label: languageName(track.lang ?? '', track.name, index),
      selected: index === engine.audioTrack,
      run: () => {
        engine.audioTrack = index;
        toast(`Audio: ${languageName(track.lang ?? '', track.name, index)}`);
      },
    }))
    : [{ label: spanish ? 'Español' : 'Idioma original', detail: 'La única pista de esta fuente', selected: true, run: () => undefined }];
  if (!spanish) options.push(audioServerOption());
  openMenu('Audio', options, spanish ? '' : 'Esta fuente está en el idioma original, con subtítulos en español.');
}

function qualityMenu(): void {
  const engine = hls;
  if (engine && engine.levels.length > 0) {
    // Una opción por resolución (la de más calidad de cada una), sólo las que la notebook decodifica bien.
    const byHeight = new Map<number, { readonly index: number; readonly bitrate: number }>();
    engine.levels.forEach((level, index) => {
      const height = level.height || 0;
      if (height > 1080 || (level.videoCodec && !/^avc/i.test(level.videoCodec))) return;
      const known = byHeight.get(height);
      if (!known || level.bitrate > known.bitrate) byHeight.set(height, { index, bitrate: level.bitrate });
    });
    const levels = [...byHeight].sort((a, b) => b[0] - a[0]);
    const playing = engine.levels[engine.currentLevel]?.height ?? 0;
    openMenu('Calidad', [
      {
        label: 'Automática', detail: playing ? `Ahora: ${String(playing)}p · según la conexión` : 'Según la conexión',
        selected: engine.autoLevelEnabled, run: () => { engine.currentLevel = -1; toast('Calidad automática'); },
      },
      ...levels.map(([height, level]): MenuOption => ({
        label: height ? `${String(height)}p${height >= 1080 ? ' (Full HD)' : height >= 720 ? ' (HD)' : ''}` : 'Única',
        detail: level.bitrate ? `${(level.bitrate / 1_000_000).toFixed(1)} Mbps` : '',
        selected: !engine.autoLevelEnabled && engine.currentLevel === level.index,
        run: () => { engine.currentLevel = level.index; toast(`Calidad: ${String(height)}p`); },
      })),
    ], levels.length < 2 ? 'Este servidor entrega una sola calidad.' : '');
    return;
  }
  const sources = currentSources;
  if (sources.length > 1) {
    // Si todas dicen lo mismo ("Auto"), se numeran: son copias en distintos servidores.
    const same = new Set(sources.map((source) => source.quality)).size === 1;
    openMenu('Calidad', sources.map((source, index): MenuOption => ({
      label: same ? `Opción ${String(index + 1)} · ${source.quality}` : source.quality, detail: source.server, selected: source === currentSource,
      run: () => { switchSource(source); },
    })));
    return;
  }
  openMenu('Calidad', [{ label: 'Probar otro servidor', detail: 'Retoma en el mismo minuto', action: true, run: () => { switchServer(); } }],
    `Este servidor entrega una sola calidad (${currentSource?.quality ?? 'automática'}).`);
}

async function serverMenu(): Promise<void> {
  playerStatus.textContent = 'Cargando servidores…';
  let providers: readonly Contracts.LibraryProvider[] = [];
  try {
    providers = providersCache ?? (await api('providers')).providers ?? [];
    providersCache = providers;
  } catch {
    // Sin la lista: igual se ofrece probar otro automáticamente.
  }
  if (playerStatus.textContent === 'Cargando servidores…') playerStatus.textContent = '';
  if (player.hidden) return;
  openMenu('Servidor', [
    { label: 'Probar otro automáticamente', detail: 'Con audio o subtítulos en español', action: true, run: () => { switchServer(); } },
    ...(spanishAudioNow() ? [] : [audioServerOption()]),
    ...providers.map((provider): MenuOption => ({
      label: provider.name, detail: provider.id === currentProvider ? 'En uso' : provider.tagline,
      selected: provider.id === currentProvider, run: () => { if (provider.id !== currentProvider) switchServer(provider.id); },
    })),
  ]);
}

/** Otra calidad del mismo servidor (fuentes MP4): retoma en el mismo segundo. */
function switchSource(source: Contracts.LibrarySource): void {
  if (source === currentSource) return;
  resumeAt = video.currentTime;
  void startVideo(source, currentSubtitles, playToken);
}

/** Otro servidor (uno elegido, o el siguiente que tenga español): retoma en el mismo minuto. */
function switchServer(provider?: string, needAudio = false): void {
  const context = playerContext;
  if (!context) return;
  saveCurrentProgress();
  const at = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  if (!provider && !needAudio) {
    if (currentProvider && !triedProviders.includes(currentProvider)) triedProviders.push(currentProvider);
    void tryNextServer(playToken);
    return;
  }
  void startPlayback(context.item, context.season, context.episode, context.name, { provider, needAudio, resumeFrom: at });
}

function stopPlayer(): void {
  playToken++;
  closeMenu();
  saveCurrentProgress();
  releaseVideo();
  player.hidden = true;
  playerTop.hidden = true;
  playerControls.hidden = true;
  player.classList.remove('idle');
  document.body.classList.remove('playing');
  playerStatus.textContent = '';
  retryBtn.hidden = true;
  const context = playerContext;
  playerContext = null;
  clearTimeout(hideTimer);
  if (returnToDetails && context) {
    detailPanel.hidden = false;
    document.body.classList.add('sheet-open');
    rebuildDetailRows();
    focusElement(detailPlay);
    return;
  }
  closeDetails();
  focusInitial();
}

// ---------- Teclado y control ----------

function handleCatalogKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    back();
    return;
  }
  if (rail.contains(document.activeElement)) {
    handleRailKey(event);
    return;
  }
  if (document.activeElement === search) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusInitial();
    } else if (event.key === 'ArrowLeft' && search.selectionStart === 0) {
      event.preventDefault();
      enterRail();
    }
    return;
  }
  const direction = event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down'
    : event.key === 'ArrowLeft' ? 'left' : event.key === 'ArrowRight' ? 'right' : null;
  if (!direction) return;
  event.preventDefault();
  moveIn(navRows, direction);
}

function handleDetailsKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDetails();
    return;
  }
  const direction = event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down'
    : event.key === 'ArrowLeft' ? 'left' : event.key === 'ArrowRight' ? 'right' : null;
  if (!direction) return;
  event.preventDefault();
  moveIn(detailRows, direction);
}

/** El aviso legal tiene un solo botón (Volver): las flechas no lo dejan. */
function handleLegalKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLegal();
  } else if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    focusElement(legalClose);
  }
}

function handlePlayerKey(event: KeyboardEvent): void {
  if (!playerMenu.hidden) {
    handleMenuKey(event);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    stopPlayer();
    return;
  }
  const idle = player.classList.contains('idle');
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    showControls();
    focusElement(toggle);
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    hideControls();
    return;
  }
  if (idle) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seek(event.key === 'ArrowLeft' ? -10 : 10);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      togglePlayback();
    }
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const order = [rewind, toggle, forward, subtitlesBtn, audioBtn, qualityBtn, serverBtn, subtitleSizeBtn, subtitleHeightBtn];
    if (!nextBtn.hidden) order.push(nextBtn);
    const index = order.indexOf(document.activeElement as HTMLButtonElement);
    const next = order[Math.min(Math.max((index < 0 ? 1 : index) + (event.key === 'ArrowRight' ? 1 : -1), 0), order.length - 1)];
    if (next) focusElement(next);
    return;
  }
  if ((event.key === 'Enter' || event.key === ' ') && !(document.activeElement instanceof HTMLButtonElement)) {
    event.preventDefault();
    togglePlayback();
  }
}

function back(): boolean {
  if (!player.hidden) {
    if (!playerMenu.hidden) closeMenu();
    else stopPlayer();
    return true;
  }
  if (!livePanel.hidden) {
    closeLive();
    return true;
  }
  if (rail.contains(document.activeElement)) {
    leaveRail();
    return true;
  }
  if (!legalPanel.hidden) {
    closeLegal();
    return true;
  }
  if (!detailPanel.hidden) {
    closeDetails();
    return true;
  }
  if (searchMode) {
    void loadHome();
    return true;
  }
  // Ya en el catálogo: vuelve al principio de la sección y después a Inicio (el Cine es la única
  // app, no hay a dónde salir).
  const first = rowsEl.querySelector('.track .card');
  if (document.activeElement !== (!hero.hidden && !heroActions.hidden ? heroPlay : first)) {
    focusInitial();
    return true;
  }
  if (currentSection !== 'inicio') {
    void loadHome();
    return true;
  }
  return false;
}

/** Al principio del catálogo, cierre lo que esté abierto (botón Inicio o el logo "Cine"). */
function goToStart(): void {
  if (!player.hidden) stopPlayer();
  if (!detailPanel.hidden) closeDetails();
  closeLegal();
  closeLive();
  // El botón Inicio lleva al destacado aunque el foco estuviera en el menú.
  if (rail.contains(document.activeElement) && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (searchMode || currentSection !== 'inicio') void loadHome();
  else focusInitial();
}

addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  // OK sobre una tarjeta o botón: se "hunde" un instante (se nota que el control respondió).
  const target = event.target;
  if (event.key === 'Enter' && target instanceof HTMLElement && target.matches('button, a')) {
    target.classList.add('pressed');
    setTimeout(() => { target.classList.remove('pressed'); }, 140);
  }
  if (!player.hidden) handlePlayerKey(event);
  else if (!livePanel.hidden) handleLiveKey(event);
  else if (!legalPanel.hidden) handleLegalKey(event);
  else if (!detailPanel.hidden) handleDetailsKey(event);
  else handleCatalogKey(event);
}, { capture: false });

// ---------- Eventos de la interfaz ----------

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = search.value.trim();
  if (query) void runSearch(query);
  else focusElement(keyboard.querySelector<HTMLElement>('.key'));
});

search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    search.blur();
    focusInitial();
  }
});
// Busca mientras se escribe (también con el texto que manda el teclado del celular).
search.addEventListener('input', searchWhileTyping);

// Deslizar con dos dedos (touchpad del celular) o la ruedita sobre el catálogo: recorre las filas.
let wheelPending = 0;
let wheelSideways = 0;
rowsViewport.addEventListener('wheel', (event) => {
  event.preventDefault();
  // Hacia los costados: recorre la fila (las filas se deslizan solas, no tienen barra propia).
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    wheelSideways += event.deltaX;
    while (Math.abs(wheelSideways) >= 100) {
      moveIn(navRows, wheelSideways > 0 ? 'right' : 'left');
      wheelSideways -= Math.sign(wheelSideways) * 100;
    }
    return;
  }
  wheelPending += event.deltaY;
  while (Math.abs(wheelPending) >= 100) {
    moveIn(navRows, wheelPending > 0 ? 'down' : 'up');
    wheelPending -= Math.sign(wheelPending) * 100;
  }
}, { passive: false });

heroPlay.addEventListener('click', () => {
  const item = catalogHero;
  if (item) void openDetails(item, { autoplay: true });
});
heroInfo.addEventListener('click', () => {
  const item = catalogHero;
  if (item) void openDetails(item);
});
detailClose.addEventListener('click', closeDetails);
legalBtn.addEventListener('click', openLegal);
legalClose.addEventListener('click', closeLegal);
detailPlay.addEventListener('click', () => {
  const item = currentItem;
  if (!item) return;
  void startPlayback(item, item.type === 'tv' ? currentSeason : 0, item.type === 'tv' ? 1 : 0, '');
});
detailServers.addEventListener('click', () => { void toggleServers(); });
playerBack.addEventListener('click', stopPlayer);
rewind.addEventListener('click', () => { seek(-10); });
forward.addEventListener('click', () => { seek(10); });
toggle.addEventListener('click', togglePlayback);
subtitlesBtn.addEventListener('click', subtitlesMenu);
qualityBtn.addEventListener('click', qualityMenu);
serverBtn.addEventListener('click', () => { void serverMenu(); });
subtitleSizeBtn.addEventListener('click', () => { changeSubtitleStyle('size'); });
subtitleHeightBtn.addEventListener('click', () => { changeSubtitleStyle('height'); });
applySubtitleStyle();
audioBtn.addEventListener('click', audioMenu);
nextBtn.addEventListener('click', () => {
  const next = playerContext?.next;
  if (next) void startPlayback(next.item, next.season, next.episode, next.name);
});
retryBtn.addEventListener('click', () => { void tryNextServer(playToken); });

player.addEventListener('pointermove', () => {
  const now = performance.now();
  if (now - lastPointerShow < 200) return;
  lastPointerShow = now;
  showControls();
}, { passive: true });

video.addEventListener('playing', () => {
  // La librería de video (hls.js) puede apagar las pistas de texto al arrancar: se vuelven a aplicar.
  applySubtitleMode();
  playerStatus.textContent = '';
  toggle.textContent = '❚❚';
  showControls();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
});
video.addEventListener('pause', () => {
  toggle.textContent = '▶';
  showControls();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
});
video.addEventListener('waiting', () => {
  if (video.currentTime > 0) playerStatus.textContent = 'Cargando…';
  showControls();
});
video.addEventListener('loadedmetadata', () => {
  if (resumeAt !== null && Number.isFinite(video.duration) && resumeAt < video.duration - 10) {
    video.currentTime = resumeAt;
  }
  resumeAt = null;
  updateProgress();
});
video.addEventListener('timeupdate', () => {
  updateProgress();
  if (Date.now() - lastSaveAt > 5000) {
    lastSaveAt = Date.now();
    saveCurrentProgress();
  }
});
video.addEventListener('ended', () => {
  const context = playerContext;
  if (context && video.duration > 0) {
    saveProgress({
      id: context.item.id, type: context.item.type, title: context.item.title, poster: context.item.poster,
      season: context.season, episode: context.episode, name: context.name, t: video.duration, d: video.duration,
    });
  }
  playerStatus.textContent = playerContext?.next ? 'Terminó el episodio.' : 'Fin de la reproducción.';
  showControls();
});
video.addEventListener('error', () => {
  if (player.hidden || hls || !video.currentSrc) return;
  void tryNextServer(playToken);
});

addEventListener('pagehide', () => {
  saveCurrentProgress();
  releaseVideo();
});

if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('play', () => { if (!player.hidden) void video.play().catch(() => undefined); });
    navigator.mediaSession.setActionHandler('pause', () => { video.pause(); });
    navigator.mediaSession.setActionHandler('seekbackward', () => { if (!player.hidden) seek(-10); });
    navigator.mediaSession.setActionHandler('seekforward', () => { if (!player.hidden) seek(10); });
    navigator.mediaSession.setActionHandler('stop', () => { if (!player.hidden) stopPlayer(); });
  } catch {
    // Algunos navegadores no admiten todos los atajos; el resto del reproductor sigue igual.
  }
}

// "Reproducir" deshabilitado = se está preparando (ficha cargando, buscando la fuente): un círculo
// girando en el botón. Sigue solo al estado del botón, esté donde esté el código que lo cambia.
const playSpinner = document.createElement('span');
playSpinner.className = 'spinner';
playSpinner.setAttribute('aria-hidden', 'true');
new MutationObserver(() => {
  const loading = detailPlay.disabled;
  detailPlay.classList.toggle('is-loading', loading);
  if (loading && !playSpinner.isConnected) detailPlay.prepend(playSpinner);
  else if (!loading) playSpinner.remove();
}).observe(detailPlay, { attributes: true, attributeFilter: ['disabled'] });

// Reproductor: el círculo de carga en el centro mientras busca servidor o el video está cargando.
const playerSpinner = byId<HTMLElement>('playerSpinner');
new MutationObserver(() => {
  playerSpinner.hidden = !/Buscando|Cargando|Probando|Conectando|Cambiando/i.test(playerStatus.textContent ?? '');
}).observe(playerStatus, { childList: true, characterData: true, subtree: true });

window.__controlTvBack = (): boolean => back();
window.__controlTvTogglePlayback = (): boolean => {
  if (player.hidden) return false;
  togglePlayback();
  return true;
};
/** Buscar desde el celular ("Buscar" en su pantalla de búsqueda): busca acá, sin salir del Cine. */
window.__controlTvSearch = (query: string): boolean => {
  const text = query.trim().slice(0, 80);
  if (!text) return false;
  if (!player.hidden) stopPlayer();
  closeDetails();
  closeLive();
  search.value = text;
  openSearch();
  void runSearch(text);
  return true;
};
/** El celular va a escribir ("Escribir en la TV"): se abre el buscador con el campo listo. */
window.__controlTvPrepareText = (): boolean => {
  if (!player.hidden || !livePanel.hidden) return false;
  if (!searchMode) openSearch();
  search.focus();
  search.select();
  return true;
};
/** Botón Inicio del control: vuelve al principio del catálogo (sin recargar la app). */
window.__controlTvHome = (): boolean => {
  goToStart();
  return true;
};
void loadHome();
