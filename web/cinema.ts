import type Hls from 'hls.js';

declare global {
  interface Window { Hls?: typeof Hls }
}

// Pantalla de cine propia (Chromecast): catálogo de la API de FrameX, ficha del título y reproductor
// HLS/MP4. Todo se maneja con flechas y OK del control, y también con el touchpad (hover + clic).
// No usa iframes ni carga las webs de los proveedores: sólo las fuentes que entrega la API.

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

const brand = byId<HTMLAnchorElement>('brand');
const searchForm = byId<HTMLFormElement>('searchForm');
const search = byId<HTMLInputElement>('search');
const searchGo = byId<HTMLButtonElement>('searchGo');
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
const retryBtn = byId<HTMLButtonElement>('retryBtn');

let catalogRows: readonly Row[] = [];
let catalogHero: Contracts.LibraryHero | null = null;
let searchMode = false;
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
 * Imágenes del catálogo a través del servicio: las guarda en el disco en WebP y Edge las guarda
 * para siempre (misma dirección = misma imagen). Así no se vuelve a bajar nada que ya se vio.
 */
function imageUrl(src: string): string {
  return src.startsWith('https://image.tmdb.org/') ? `/img?u=${encodeURIComponent(src)}` : src;
}

/**
 * Fichas y temporadas ya vistas, en memoria: volver a abrir una es instantáneo y sin consultas.
 * (El servicio además las guarda en el disco y las actualiza por detrás si cambian.)
 */
const MEMO_OPS = new Set(['details', 'season']);
const MEMO_LIMIT = 80;
const memo = new Map<string, Contracts.LibraryReply>();

async function api(op: string, params: Record<string, string> = {}, cancel?: AbortSignal, quiet = false): Promise<Contracts.LibraryReply> {
  const query = new URLSearchParams({ op, ...params });
  const memoKey = MEMO_OPS.has(op) ? query.toString() : '';
  const remembered = memoKey ? memo.get(memoKey) : undefined;
  if (remembered) return remembered;
  const reply = await request(query, cancel, quiet);
  if (memoKey) {
    if (memo.size >= MEMO_LIMIT) memo.delete(memo.keys().next().value ?? '');
    memo.set(memoKey, reply);
  }
  return reply;
}

async function request(query: URLSearchParams, cancel: AbortSignal | undefined, quiet: boolean): Promise<Contracts.LibraryReply> {
  const timeout = AbortSignal.timeout(30_000);
  const signal = cancel ? AbortSignal.any([cancel, timeout]) : timeout;
  if (!quiet) busy(1);
  try {
    const response = await fetch(`/api/library?${query.toString()}`, { signal });
    if (!response.ok) throw new Error('No se pudo consultar el catálogo.');
    const result = (await response.json()) as Contracts.LibraryReply;
    if (result.error) throw new Error(result.error);
    return result;
  } finally {
    if (!quiet) busy(-1);
  }
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
  const previous = document.activeElement;
  node.focus({ preventScroll: true });
  if (previous !== node && node.classList.contains('card')) {
    node.classList.remove('just-focused');
    void node.offsetWidth; // reinicia la animación del borde
    node.classList.add('just-focused');
  }
  revealInTrack(node);
  const row = node.closest('.row, .related, .seasons, .chips, .actions, #topbar, .controls-row');
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

/** Las filas del catálogo: la fila elegida sube hasta arriba de la lista (se desliza la lista entera). */
function revealRow(node: HTMLElement): void {
  const row = node.closest<HTMLElement>('.row');
  if (!row) {
    if (rowsViewport.contains(node)) return;
    rowsScroll.style.transform = ''; // barra de arriba o destacado: la lista vuelve al principio
    return;
  }
  const offset = row.offsetTop - rowsScroll.offsetTop;
  rowsScroll.style.transform = offset > 0 ? `translate3d(0, ${String(-offset)}px, 0)` : '';
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

/** Muestra un título en el destacado. El texto cambia enseguida; la imagen, con un fundido. */
function showSpotlight(item: Contracts.LibraryTitle, preview: boolean): void {
  const key = `${item.type}:${item.id}:${String(preview)}`;
  if (key === heroShown) return;
  heroShown = key;
  heroCopy.classList.add('is-changing');
  requestAnimationFrame(() => {
    heroEyebrow.textContent = preview ? (item.type === 'tv' ? 'Serie' : 'Película') : 'Destacado';
    heroTitle.textContent = item.title;
    heroMeta.textContent = metaText(item);
    heroOverview.textContent = translatedOverviews.get(item.overview) ?? item.overview;
    heroCopy.classList.toggle('is-preview', preview);
    heroCopy.classList.remove('is-changing');
  });
  // La imagen (y la sinopsis en español) esperan a que el control se quede quieto un instante:
  // recorriendo rápido no se bajan ni decodifican imágenes ni se traducen textos de más.
  clearTimeout(spotlightTimer);
  spotlightTimer = window.setTimeout(() => {
    void swapHeroImage(item.backdrop || item.poster);
    void spanishOverview(item, key);
  }, 180);
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
  const url = src ? new URL(imageUrl(src), location.href).href : '';
  if (!url || front.src === url) return;
  const next = heroFront === 0 ? 1 : 0;
  const incoming = heroImages[next];
  incoming.src = url;
  try {
    await incoming.decode(); // se decodifica antes del fundido: el cambio no traba un cuadro
  } catch {
    return;
  }
  if (incoming.src !== src) return; // mientras tanto se eligió otra
  incoming.classList.add('is-shown');
  front.classList.remove('is-shown');
  heroFront = next;
}

/** Al elegir una tarjeta, el destacado la muestra; en la barra de arriba o el destacado, vuelve el destacado. */
function spotlightFor(node: HTMLElement): void {
  if (hero.hidden) return;
  const item = cardItems.get(node);
  if (item) showSpotlight(item, true);
  else if (catalogHero && (node === heroPlay || node === heroInfo || node.closest('#topbar'))) showSpotlight(catalogHero, false);
}

function setStatus(text: string): void {
  statusEl.textContent = text;
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
const DRAW_AHEAD = 14;
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
    reused.classList.remove('just-focused', 'pressed');
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
  poster.width = 148;
  poster.height = 222;
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
  if (item.poster) {
    poster.dataset['src'] = imageUrl(item.poster);
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

function appendRow(name: string, cards: readonly HTMLElement[]): void {
  if (!cards.length) return;
  const section = document.createElement('section');
  section.className = 'row';
  section.style.setProperty('--i', String(rowsEl.children.length)); // entrada escalonada
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
  setStatus(uniqueCount ? `${uniqueCount} títulos · Audio o subtítulos en español · Catálogo FrameX` : 'No hay títulos para mostrar.');
  resetRows();
  rebuildNav();
  focusInitial();
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
  if (document.activeElement !== search) focusInitial();
}

/** Mientras carga el catálogo: filas "esqueleto" con brillo de carga, en vez de una pantalla vacía. */
function renderSkeleton(): void {
  if (rowsEl.children.length > 0) return;
  for (let row = 0; row < 3; row++) {
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
  clearTimeout(searchTimer);
  searchAbort?.abort();
  searchAbort = null;
  searchForm.classList.remove('is-busy');
  const token = ++catalogToken;
  searchMode = false;
  if (document.activeElement !== search) search.value = '';
  catalogHero = null;
  setStatus('Cargando catálogo…');
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
  setStatus(`Buscando “${query}”…`);
  searchForm.classList.add('is-busy');
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
    if (token === catalogToken) searchForm.classList.remove('is-busy');
  }
}

/** Mientras se escribe (teclado del celular o de la notebook): busca solo, al dejar de escribir. */
function searchWhileTyping(): void {
  clearTimeout(searchTimer);
  const query = search.value.trim();
  if (query.length < 2) {
    if (!query && searchMode) searchTimer = window.setTimeout(() => { void loadHome(); }, SEARCH_DELAY_MS);
    return;
  }
  searchTimer = window.setTimeout(() => { void runSearch(query); }, SEARCH_DELAY_MS);
}

function rebuildNav(): void {
  navRows = [[brand, search, searchGo]];
  if (!hero.hidden) navRows.push([heroPlay, heroInfo]);
  for (const track of rowsEl.querySelectorAll<HTMLElement>('.track')) {
    const cards = [...track.querySelectorAll<HTMLElement>('.card')];
    if (cards.length) navRows.push(cards);
  }
}

function focusInitial(): void {
  const firstTrack = rowsEl.querySelector<HTMLElement>('.track .card');
  // En una búsqueda, directo al primer resultado; en el catálogo, al destacado.
  focusElement(searchMode ? firstTrack ?? search : !hero.hidden ? heroPlay : firstTrack ?? search);
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
    if (episode.still) still.src = imageUrl(episode.still);
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
      void startPlayback(item, item.type === 'tv' ? currentSeason : 0, item.type === 'tv' ? 1 : 0, '', provider.id);
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
  detailStatus.textContent = 'Consultando servidores…';
  try {
    const providers = providersCache ?? (await api('providers')).providers ?? [];
    providersCache = providers;
    detailStatus.textContent = '';
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
  detailMeta.textContent = metaText(item);
  detailLanguage.textContent = 'Se reproducirá con audio o subtítulos en español.';
  detailOverview.textContent = item.overview;
  detailCast.textContent = '';
  detailStatus.textContent = 'Cargando ficha…';
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
  const image = item.backdrop || item.poster;
  if (image) {
    detailImage.src = imageUrl(image);
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
      detailMeta.textContent = metaText(details, details.genres);
      detailLanguage.textContent = details.originalLanguage === 'es'
        ? 'Audio original en español.'
        : 'Se reproducirá con audio o subtítulos en español.';
      detailOverview.textContent = details.overview || item.overview;
      detailCast.textContent = details.cast.length
        ? details.cast.map((person) => (person.character ? `${person.name} (${person.character})` : person.name)).join(' · ')
        : '';
      if (details.runtime && details.runtime > 0) {
        detailMeta.textContent = `${detailMeta.textContent}  ·  ${runtimeText(details.runtime)}`;
      }
      const firstSeason = details.seasons.find((season) => season.number > 0)?.number ?? details.seasons[0]?.number ?? 1;
      currentSeason = options.resume?.season ?? firstSeason;
      renderSeasons(details);
      renderRelated(details.related ?? []);
      if (item.type === 'tv') await loadSeason(currentSeason, token);
    }
    if (token !== detailToken) return;
    detailStatus.textContent = '';
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
    detailStatus.textContent = errorText(error);
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
    script.src = '/vendor/hls.js';
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
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
}

function applySubtitleMode(): void {
  for (let index = 0; index < video.textTracks.length; index++) {
    const track = video.textTracks[index];
    if (track) track.mode = index === subtitleIndex ? 'showing' : 'disabled';
  }
}

/**
 * Los subtítulos de la fuente (el servicio sólo manda los que están en español, primero los latinos).
 * Se activa el primero, salvo que el audio ya sea en español (ahí quedan para el botón Subtítulos).
 * Antes se buscaba el idioma "es…" y, si venía como "spanish" o "spa", no se mostraba ninguno.
 */
function addTracks(source: Contracts.LibrarySource): void {
  for (const track of [...video.querySelectorAll('track')]) track.remove();
  const spanishAudio = isSpanish(source.audio ?? '') || (source.audioTracks ?? []).some((track) => isSpanish(track.lang) || isSpanish(track.label));
  const preferred = currentSubtitles.length > 0 && !spanishAudio ? 0 : -1;
  currentSubtitles.forEach((subtitle, index) => {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = subtitle.label || subtitle.lang.toUpperCase();
    track.srclang = subtitle.lang;
    track.src = `/api/subtitle?url=${encodeURIComponent(subtitle.url)}`;
    if (index === preferred) track.default = true;
    video.append(track);
  });
  subtitleIndex = preferred;
  window.setTimeout(applySubtitleMode, 0);
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
  currentSubtitles = subtitles;
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

async function startPlayback(
  item: Contracts.LibraryTitle, season: number, episode: number, name: string, provider?: string,
): Promise<void> {
  const token = ++playToken;
  const fromDetails = !detailPanel.hidden;
  // Si ya había una ficha abierta (o se viene de "siguiente episodio"), Atrás vuelve a ella.
  returnToDetails = fromDetails || currentDetails !== null;
  triedProviders = provider ? [provider] : [];
  playerContext = { item, season, episode, name, next: nextContext(item, season, episode) };
  const key = progressKey(item.type, item.id, season, episode);
  resumeAt = savedTime(key);
  nextBtn.hidden = !playerContext.next;
  nextBtn.textContent = playerContext.next?.name ? `Siguiente: ${playerContext.next.name}` : 'Siguiente episodio';
  releaseVideo();
  if (fromDetails) {
    detailStatus.textContent = 'Buscando servidor con audio o subtítulos en español…';
    detailPlay.disabled = true;
  } else {
    playerStatus.textContent = 'Buscando servidor…';
    retryBtn.hidden = true;
  }
  const params: Record<string, string> = { id: item.id, type: item.type };
  if (item.type === 'tv') {
    params['season'] = String(season);
    params['episode'] = String(episode);
  }
  if (provider) params['provider'] = provider;
  try {
    const reply = provider ? await api('stream', params) : await api('resolve', params);
    if (token !== playToken) return;
    const source = reply.sources?.[0];
    if (!source) throw new Error('Ese servidor no entregó una fuente compatible.');
    if (reply.provider) triedProviders.push(reply.provider);
    if (fromDetails) {
      detailPlay.disabled = false;
      detailStatus.textContent = '';
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
      detailStatus.textContent = errorText(error);
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
  if (video.paused) return;
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
  flash.addEventListener('animationend', () => { flash.remove(); });
}

function updateProgress(): void {
  const duration = video.duration;
  const ratio = Number.isFinite(duration) && duration > 0 ? video.currentTime / duration : 0;
  progressFill.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`;
  timeEl.textContent = `${clock(video.currentTime)} / ${Number.isFinite(duration) && duration > 0 ? clock(duration) : 'En vivo'}`;
}

function cycleSubtitles(): void {
  if (!currentSubtitles.length) {
    toast('Esta fuente no ofrece subtítulos.');
    return;
  }
  subtitleIndex += 1;
  if (subtitleIndex >= currentSubtitles.length) subtitleIndex = -1;
  applySubtitleMode();
  const subtitle = subtitleIndex >= 0 ? currentSubtitles[subtitleIndex] : undefined;
  toast(subtitleIndex < 0 ? 'Subtítulos desactivados' : `Subtítulos: ${subtitle ? subtitleLabel(subtitle.label) : ''}`);
}

function cycleAudio(): void {
  if (!hls || hls.audioTracks.length < 2) {
    toast('Esta fuente no tiene otras pistas de audio.');
    return;
  }
  hls.audioTrack = (hls.audioTrack + 1) % hls.audioTracks.length;
  const track = hls.audioTracks[hls.audioTrack];
  const label = track ? (isSpanish(track.lang ?? '') || isSpanish(track.name) ? 'Español' : track.name) : '';
  toast(`Audio: ${label || `pista ${hls.audioTrack + 1}`}`);
}

function stopPlayer(): void {
  playToken++;
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
  if (document.activeElement === search) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusInitial();
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

function handlePlayerKey(event: KeyboardEvent): void {
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
    const order = [rewind, toggle, forward, subtitlesBtn, audioBtn];
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
    stopPlayer();
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
  location.assign('/');
  return true;
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
  else if (!detailPanel.hidden) handleDetailsKey(event);
  else handleCatalogKey(event);
}, { capture: false });

// ---------- Eventos de la interfaz ----------

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = search.value.trim();
  if (query) void runSearch(query);
  else void loadHome();
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
subtitlesBtn.addEventListener('click', cycleSubtitles);
audioBtn.addEventListener('click', cycleAudio);
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
  playerSpinner.hidden = !/Buscando|Cargando|Probando|Conectando/i.test(playerStatus.textContent ?? '');
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
  search.value = text;
  void runSearch(text);
  return true;
};
window.__controlTvPrepareText = (): boolean => {
  if (!player.hidden || !detailPanel.hidden) return false;
  search.focus();
  search.select();
  return true;
};

void loadHome();
