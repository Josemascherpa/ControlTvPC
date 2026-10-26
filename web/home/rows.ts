import { createAppCard, createLibraryCard } from './app-card.js';
import { CATEGORIES } from './categories.js';
import { byId, el } from './dom.js';
import { focusable, updateTrackArrows } from './focus.js';
import { degrees, describeWeather, weatherIcon } from './weather.js';

const SHORT_DAY = new Intl.DateTimeFormat('es-AR', { weekday: 'short' });
const money = (value: number | null): string => (value === null ? '—' : `$${Math.round(value).toLocaleString('es-AR')}`);

/** Una fila con título, tarjetas y las flechas de "hay más". */
export function createRow(title: string, cards: readonly HTMLElement[]): HTMLElement {
  const track = el('div', 'track');
  track.append(...cards);
  const row = el('div', 'row');
  row.append(el('h2', '', title), track, el('span', 'row-arrow left'), el('span', 'row-arrow right'));
  return row;
}

/**
 * Las filas del inicio: tus apps divididas por categoría ("Todas las apps" al final de la primera)
 * y "Hoy" (clima y dólar).
 */
export class HomeRows {
  private readonly appsRows = byId('apps-rows');
  private readonly infoTrack = byId('info');

  constructor(
    private readonly onLaunch: (app: Contracts.AppTile, tile: HTMLElement) => void,
    private readonly onOpenLibrary: () => void,
    private readonly onOpenUrl: (url: string) => void,
  ) {}

  /** Las apps elegidas, por categoría y en su orden. [moving] = la que se está cambiando de lugar. */
  renderApps(apps: readonly Contracts.AppTile[], homeIds: readonly string[], moving: string | null = null): void {
    const chosen = homeIds.flatMap((id) => apps.filter((a) => a.id === id));
    const rows = CATEGORIES.flatMap(([category, title]) => {
      const inCategory = chosen.filter((app) => app.category === category);
      if (inCategory.length === 0) return [];
      const cards = inCategory.map((app, i) => {
        const card = createAppCard(app, (tile) => { this.onLaunch(app, tile); }, { index: i });
        if (app.id === moving) card.classList.add('moving');
        return card;
      });
      return [{ title, cards }];
    });
    // "Todas las apps" va al final de la primera fila (o sola, si todavía no hay ninguna elegida).
    const first = rows[0];
    if (first) first.cards.push(createLibraryCard(this.onOpenLibrary, first.cards.length));
    else rows.push({ title: 'Apps', cards: [createLibraryCard(this.onOpenLibrary, 0)] });
    this.appsRows.replaceChildren(...rows.map(({ title, cards }) => createRow(title, cards)));
    for (const track of this.appsRows.querySelectorAll<HTMLElement>('.track')) updateTrackArrows(track);
  }

  /** "Hoy": el clima de la semana y el dólar (sin noticias: el inicio queda más limpio). */
  renderInfo(home: Contracts.HomeSnapshot): void {
    const cards: HTMLElement[] = [];
    if (home.weather) cards.push(this.weatherCard(home.weather));
    if (home.dollar.length > 0) cards.push(this.dollarCard(home.dollar));
    cards.forEach((card, i) => { card.style.setProperty('--i', String(i)); });
    this.infoTrack.replaceChildren(...cards);
    updateTrackArrows(this.infoTrack);
  }

  private weatherCard(weather: Contracts.Weather): HTMLElement {
    const info = describeWeather(weather.now.code);
    const temp = el('div', 'wtemp');
    temp.append(weatherIcon(info.kind, weather.now.isDay), el('span', '', degrees(weather.now.temp)));
    const now = el('div', 'wnow');
    now.append(el('div', 'label', 'Clima'), temp, el('div', 'wdesc', `Sensación ${degrees(weather.now.feels)} · Humedad ${weather.now.humidity}%`));
    const days = el('div', 'wdays');
    for (const day of weather.days.slice(1, 6)) {
      const column = el('div', 'wday');
      column.append(
        el('span', 'd', SHORT_DAY.format(new Date(`${day.date}T12:00`)).replace('.', '')),
        weatherIcon(describeWeather(day.code).kind),
        el('span', '', degrees(day.max)),
        el('span', 'lo', degrees(day.min)),
      );
      days.append(column);
    }
    const card = el('div', 'card weather-card');
    card.append(now, days);
    return focusable(card, () => { this.onOpenUrl(`https://www.google.com/search?q=${encodeURIComponent(`clima ${weather.city}`)}`); });
  }

  private dollarCard(rates: readonly Contracts.DollarRate[]): HTMLElement {
    const grid = el('div', 'rates');
    grid.append(el('span', 'h'), el('span', 'h', 'Compra'), el('span', 'h', 'Venta'));
    for (const rate of rates.slice(0, 3)) grid.append(el('span', 'n', rate.name), el('span', 'v', money(rate.buy)), el('span', 'v', money(rate.sell)));
    const card = el('div', 'card dollar-card');
    card.append(el('div', 'label', 'Dólar hoy'), grid);
    return focusable(card, () => { this.onOpenUrl('https://dolarhoy.com'); });
  }
}
