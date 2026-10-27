import { existsSync, writeFileSync } from 'fs';
import type { AppCategory, BackBehavior, TvApp } from '../../domain/apps';
import type { AppCatalog } from '../../domain/ports';
import { belongsTo } from '../../domain/urls';
import { asArray, asString, isRecord, readJsonFile } from './json';

const LIBRARY_APP = app('cinema', 'Cine ControlTV', 'movies', 'http://127.0.0.1:8001/cinema.html', '127.0.0.1', '#77e8ce', '#101820');

/** YouTube muestra su versión para TV (manejable con flechas) sólo si cree que es una Smart TV. */
const TV_USER_AGENT =
  'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36';

const CATEGORIES: readonly AppCategory[] = ['platforms', 'movies', 'live', 'music', 'video', 'web'];

const DEFAULT_APPS: readonly TvApp[] = [
  LIBRARY_APP,
  // Música
  app('spotify', 'Spotify', 'music', 'https://open.spotify.com', 'spotify.com', '#1ed760', '#121212'),
  // Videos
  app('youtube', 'YouTube', 'video', 'https://www.youtube.com/tv', 'youtube.com', '#ff0033', '#141414', 'escape', TV_USER_AGENT),
  app('twitch', 'Twitch', 'video', 'https://www.twitch.tv', 'twitch.tv', '#9146ff', '#18181b'),
  app('kick', 'Kick', 'video', 'https://kick.com', 'kick.com', '#53fc18', '#101411'),
  // Internet
  app('google', 'Internet', 'web', 'https://www.google.com', 'google.com', '#4285f4', '#1a1c24'),
];

/** Las que aparecen en el inicio hasta que la persona elija las suyas. */
const DEFAULT_HOME: readonly string[] = ['cinema', 'youtube', 'spotify', 'twitch', 'kick'];
const RETIRED = new Set(['netflix', 'disney', 'prime', 'max', 'paramount', 'framex', 'cinehax', 'cinemaos', 'streamflix', 'pluto', 'ytmusic']);

function app(
  id: string, name: string, category: AppCategory, url: string, domain: string, color: string, background: string,
  back: BackBehavior = 'history', userAgent: string | null = null,
): TvApp {
  return { id, name, category, url, domain, color, background, back, userAgent };
}

/**
 * La biblioteca de apps. Por defecto las de arriba; si existe apps.json (en %LOCALAPPDATA%\ControlTvPC)
 * se usan esas, así se pueden cambiar sin tocar el programa.
 */
export class AppCatalogFile implements AppCatalog {
  private apps: readonly TvApp[] = [];

  constructor(private readonly customFile: string, exampleFile: string) {
    if (!existsSync(customFile)) writeFileSync(exampleFile, JSON.stringify(DEFAULT_APPS, null, 2));
    this.reload();
  }

  list(): readonly TvApp[] {
    return this.apps;
  }

  find(id: string): TvApp | undefined {
    return this.apps.find((a) => a.id === id);
  }

  defaultHome(): readonly string[] {
    return DEFAULT_HOME.filter((id) => this.find(id));
  }

  /** La app de esa dirección. Si hay varias (youtube.com y music.youtube.com) gana la más específica. */
  forUrl(url: string): TvApp | undefined {
    return this.apps
      .filter((a) => belongsTo(url, a.domain))
      .sort((a, b) => b.domain.length - a.domain.length)[0];
  }

  reload(): void {
    const custom = asArray(readJsonFile(this.customFile)).filter(isRecord).map((raw): TvApp | null => {
      const id = asString(raw['id']);
      const url = asString(raw['url']);
      if (!id || !url) return null;
      const category = CATEGORIES.find((c) => c === raw['category']) ?? 'web';
      return {
        id,
        name: asString(raw['name'], id),
        category,
        url,
        domain: asString(raw['domain']),
        color: asString(raw['color'], '#ffffff'),
        background: asString(raw['background'] ?? raw['bg'], '#15171f'),
        back: raw['back'] === 'escape' ? 'escape' : 'history',
        userAgent: typeof raw['userAgent'] === 'string' ? raw['userAgent'] : null,
      };
    }).filter((a): a is TvApp => a !== null);
    const active = custom.filter((item) => !RETIRED.has(item.id) && item.category !== 'platforms');
    this.apps = [LIBRARY_APP, ...active.filter((item) => item.id !== LIBRARY_APP.id),
      ...DEFAULT_APPS.filter((item) => item.id !== LIBRARY_APP.id && !active.some((existing) => existing.id === item.id))];
  }
}
