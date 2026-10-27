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
const heroImage = byId<HTMLImageElement>('heroImage');
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
let lastColumn = 0;

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

async function api(op: string, params: Record<string, string> = {}): Promise<Contracts.LibraryReply> {
  const query = new URLSearchParams({ op, ...params });
  const response = await fetch(`/api/library?${query.toString()}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('No se pudo consultar el catálogo.');
  const result = (await response.json()) as Contracts.LibraryReply;
  if (result.error) throw new Error(result.error);
  return result;
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

function focusElement(node: HTMLElement | null): void {
  if (!node) return;
  node.focus({ preventScroll: true });
  node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
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
  poster.loading = 'lazy';
  poster.decoding = 'async';
  poster.alt = '';
  if (item.poster) poster.src = item.poster;
  wrap.append(poster);
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
  card.addEventListener('click', () => {
    void openDetails(item, progress ? { autoplay: true, resume: progress } : {});
  });
  return card;
}

function appendRow(name: string, cards: readonly HTMLElement[]): void {
  if (!cards.length) return;
  const section = document.createElement('section');
  section.className = 'row';
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
  const recent = recentProgress();
  if (recent.length) appendRow('Continuar viendo', recent.map((entry) => makeCard(entryTitle(entry), entry)));
  for (const row of catalogRows) appendRow(row.name, row.items.map((item) => makeCard(item)));
  const uniqueCount = new Set(catalogRows.flatMap((row) => row.items).map((item) => `${item.type}:${item.id}`)).size;
  setStatus(uniqueCount ? `${uniqueCount} títulos · Audio o subtítulos en español · Catálogo FrameX` : 'No hay títulos para mostrar.');
  window.scrollTo(0, 0);
  rebuildNav();
  focusInitial();
}

function renderResults(items: readonly Contracts.LibraryTitle[], query: string): void {
  rowsEl.replaceChildren();
  appendRow(`Resultados para “${query}”`, items.map((item) => makeCard(item)));
  setStatus(items.length ? `${items.length} resultados · Se reproduce en español.` : `No se encontraron títulos para “${query}”.`);
  window.scrollTo(0, 0);
  rebuildNav();
  focusInitial();
}

function renderHero(item: Contracts.LibraryHero): void {
  catalogHero = item;
  hero.hidden = false;
  heroTitle.textContent = item.title;
  heroMeta.textContent = metaText(item);
  heroOverview.textContent = item.overview;
  heroPlay.disabled = false;
  heroInfo.disabled = false;
  const image = item.backdrop || item.poster;
  if (image) {
    heroImage.src = image;
    heroImage.hidden = false;
  } else {
    heroImage.removeAttribute('src');
    heroImage.hidden = true;
  }
}

async function loadHome(): Promise<void> {
  const token = ++catalogToken;
  searchMode = false;
  search.value = '';
  catalogHero = null;
  setStatus('Cargando catálogo…');
  try {
    const reply = await api('home');
    if (token !== catalogToken) return;
    catalogRows = (reply.rows ?? []).filter((row) => row.items.length > 0);
    if (reply.hero) renderHero(reply.hero);
    else { hero.hidden = true; catalogHero = null; }
    catalogEl.classList.remove('no-hero');
    renderHome();
  } catch (error) {
    if (token !== catalogToken) return;
    setStatus(errorText(error));
  }
}

async function runSearch(query: string): Promise<void> {
  const token = ++catalogToken;
  searchMode = true;
  setStatus('Buscando…');
  try {
    const reply = await api('search', { q: query });
    if (token !== catalogToken) return;
    hero.hidden = true;
    catalogHero = null;
    catalogEl.classList.add('no-hero');
    renderResults(reply.items ?? [], query);
  } catch (error) {
    if (token !== catalogToken) return;
    setStatus(errorText(error));
  }
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
  focusElement(!hero.hidden ? heroPlay : firstTrack ?? search);
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
    const row = rows[position.row];
    if (!row) return;
    const col = Math.min(Math.max(position.col + (direction === 'right' ? 1 : -1), 0), row.length - 1);
    const next = row[col];
    if (next) {
      lastColumn = col;
      focusElement(next);
    }
    return;
  }
  const row = Math.min(Math.max(position.row + (direction === 'down' ? 1 : -1), 0), rows.length - 1);
  const target = rows[row];
  if (!target?.length) return;
  const col = Math.min(Math.max(lastColumn, 0), target.length - 1);
  const next = target[col];
  if (next) focusElement(next);
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
  const loading = document.createElement('p');
  loading.className = 'status';
  loading.textContent = 'Cargando episodios…';
  episodesEl.append(loading);
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
  for (const episode of episodesEl.querySelectorAll<HTMLElement>('.episode')) detailRows.push([episode]);
  if (!relatedEl.hidden) {
    const cards = [...relatedTrack.querySelectorAll<HTMLElement>('.card')];
    if (cards.length) detailRows.push(cards);
  }
}

function renderRelated(items: readonly Contracts.LibraryTitle[]): void {
  relatedTrack.replaceChildren();
  relatedEl.hidden = items.length === 0;
  for (const item of items) relatedTrack.append(makeCard(item));
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

function addTracks(): void {
  for (const track of [...video.querySelectorAll('track')]) track.remove();
  const preferred = currentSubtitles.findIndex((subtitle) => subtitle.lang.startsWith('es'));
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
      addTracks();
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
    addTracks();
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

window.__controlTvBack = (): boolean => back();
window.__controlTvTogglePlayback = (): boolean => {
  if (player.hidden) return false;
  togglePlayback();
  return true;
};
window.__controlTvPrepareText = (): boolean => {
  if (!player.hidden || !detailPanel.hidden) return false;
  search.focus();
  search.select();
  return true;
};

void loadHome();
