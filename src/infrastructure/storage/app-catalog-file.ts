import { existsSync, writeFileSync } from 'fs';
import type { AppCategory, BackBehavior, TvApp } from '../../domain/apps';
import type { AppCatalog } from '../../domain/ports';
import { belongsTo } from '../../domain/urls';
import { asArray, asString, isRecord, readJsonFile } from './json';

/** YouTube muestra su versión para TV (manejable con flechas) sólo si cree que es una Smart TV. */
const TV_USER_AGENT =
  'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36';

const CATEGORIES: readonly AppCategory[] = ['platforms', 'movies', 'live', 'music', 'video', 'web'];

const DEFAULT_APPS: readonly TvApp[] = [
  // Plataformas
  app('netflix', 'Netflix', 'platforms', 'https://www.netflix.com/browse', 'netflix.com', '#e50914', '#000000'),
  app('disney', 'Disney+', 'platforms', 'https://www.disneyplus.com', 'disneyplus.com', '#113ccf', '#040714'),
  app('prime', 'Prime Video', 'platforms', 'https://www.primevideo.com', 'primevideo.com', '#1a98ff', '#0f171e'),
  app('max', 'HBO Max', 'platforms', 'https://play.hbomax.com', 'hbomax.com', '#ffffff', '#000a2e'),
  app('paramount', 'Paramount+', 'platforms', 'https://www.paramountplus.com', 'paramountplus.com', '#0064ff', '#000a1f'),
  // Películas y series online
  app('framex', 'FrameX TV', 'movies', 'https://framextv.cc', 'framextv.cc', '#ffffff', '#09090b'),
  app('cinehax', 'Cinehax', 'movies', 'https://cinehax.com', 'cinehax.com', '#ffffff', '#11131a'),
  app('cinemaos', 'CinemaOS', 'movies', 'https://cinemaos.live', 'cinemaos.live', '#ffffff', '#16161d'),
  // TV en vivo
  app('streamflix', 'StreamFlix', 'live', 'https://streamflix.com.ar', 'streamflix.com.ar', '#ff0000', '#000000'),
  app('pluto', 'Pluto TV', 'live', 'https://pluto.tv/latam/live-tv', 'pluto.tv', '#fff200', '#000000'),
  // Música
  app('spotify', 'Spotify', 'music', 'https://open.spotify.com', 'spotify.com', '#1ed760', '#121212'),
  app('ytmusic', 'YouTube Music', 'music', 'https://music.youtube.com', 'music.youtube.com', '#ff0033', '#0f0f0f'),
  // Videos
  app('youtube', 'YouTube', 'video', 'https://www.youtube.com/tv', 'youtube.com', '#ff0033', '#141414', 'escape', TV_USER_AGENT),
  app('twitch', 'Twitch', 'video', 'https://www.twitch.tv', 'twitch.tv', '#9146ff', '#18181b'),
  // Internet
  app('google', 'Internet', 'web', 'https://www.google.com', 'google.com', '#4285f4', '#1a1c24'),
];

/** Las que aparecen en el inicio hasta que la persona elija las suyas. */
const DEFAULT_HOME: readonly string[] = ['netflix', 'disney', 'prime', 'max', 'framex', 'cinehax', 'cinemaos', 'streamflix', 'pluto', 'spotify', 'ytmusic', 'youtube'];

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
    this.apps = custom.length > 0 ? custom : DEFAULT_APPS;
  }
}
