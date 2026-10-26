import type { HomeData, Logger, SettingsStore } from '../../domain/ports';
import type { Location } from '../../domain/settings';
import { asArray, asBoolean, asNumber, asRecord, asString, isRecord, readJsonFile, writeJsonFile } from '../storage/json';
import type { BingBackgrounds } from './bing-backgrounds';
import type { DetectedLocation, DolarApiProvider, GoogleNewsProvider, IpLocationProvider, OpenMeteoProvider } from './providers';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface HomeCache {
  readonly snapshot: Contracts.HomeSnapshot;
  readonly location: (DetectedLocation & { readonly at: number }) | null;
}

export interface HomeProviders {
  readonly location: IpLocationProvider;
  readonly weather: OpenMeteoProvider;
  readonly dollar: DolarApiProvider;
  readonly news: GoogleNewsProvider;
  readonly backgrounds: BingBackgrounds;
}

/**
 * Junta los datos del inicio, los refresca cada tanto (cada fuente a su ritmo) y los guarda en
 * disco: si no hay internet se muestra lo último que se bajó.
 */
export class HomeDataService implements HomeData {
  private cache: HomeCache;

  constructor(
    private readonly providers: HomeProviders,
    private readonly settings: SettingsStore,
    private readonly cacheFile: string,
    private readonly log: Logger,
  ) {
    this.cache = parseCache(readJsonFile(cacheFile));
  }

  snapshot(): Contracts.HomeSnapshot {
    return this.cache.snapshot;
  }

  start(): void {
    this.every(15, 'clima', async () => {
      const location = await this.location();
      return { weather: await this.providers.weather.fetch(location) };
    });
    this.every(20, 'dólar', async () => {
      const location = await this.location().catch(() => null);
      // Sólo tiene sentido en Argentina.
      if (location && 'country' in location && location.country !== 'AR') return { dollar: [] };
      return { dollar: await this.providers.dollar.fetch() };
    });
    this.every(6 * 60, 'fondos', async () => ({
      backgrounds: await this.providers.backgrounds.refresh(this.cache.snapshot.backgrounds),
    }));
  }

  private every(minutes: number, name: string, load: () => Promise<Partial<Contracts.HomeSnapshot>>): void {
    const run = (): void => {
      load()
        .then((part) => {
          this.cache = { ...this.cache, snapshot: { ...this.cache.snapshot, ...part } };
          writeJsonFile(this.cacheFile, this.cache);
        })
        .catch((error: unknown) => {
          this.log.warn(`Inicio (${name}):`, error);
        });
    };
    run();
    setInterval(run, minutes * MINUTE).unref();
  }

  private async location(): Promise<Location | DetectedLocation> {
    const fixed = this.settings.get('location');
    if (fixed) return fixed;
    const saved = this.cache.location;
    if (saved && Date.now() - saved.at < DAY) return saved;
    const detected = await this.providers.location.fetch();
    this.cache = { ...this.cache, location: { ...detected, at: Date.now() } };
    return detected;
  }
}

/** Lee el caché guardado, validando cada parte (si algo está roto, se descarta esa parte). */
function parseCache(raw: unknown): HomeCache {
  const data = asRecord(raw);
  const snap = asRecord(data['snapshot']);
  const loc = data['location'];
  return {
    snapshot: {
      weather: parseWeather(snap['weather']),
      dollar: asArray(snap['dollar']).filter(isRecord).map((r) => ({
        name: asString(r['name']),
        buy: typeof r['buy'] === 'number' ? r['buy'] : null,
        sell: typeof r['sell'] === 'number' ? r['sell'] : null,
      })),
      news: asArray(snap['news']).filter(isRecord).map((n) => ({
        title: asString(n['title']), source: asString(n['source']), url: asString(n['url']),
      })),
      backgrounds: asArray(snap['backgrounds']).filter(isRecord).map((b) => ({
        file: asString(b['file']), caption: asString(b['caption']), credit: asString(b['credit']),
      })).filter((b) => b.file !== ''),
    },
    location: isRecord(loc) && typeof loc['lat'] === 'number' && typeof loc['lon'] === 'number'
      ? { city: asString(loc['city']), country: asString(loc['country']), lat: loc['lat'], lon: loc['lon'], at: asNumber(loc['at']) }
      : null,
  };
}

function parseWeather(raw: unknown): Contracts.Weather | null {
  if (!isRecord(raw) || !isRecord(raw['now'])) return null;
  const now = raw['now'];
  return {
    city: asString(raw['city']),
    now: {
      temp: asNumber(now['temp']), feels: asNumber(now['feels']), humidity: asNumber(now['humidity']),
      wind: asNumber(now['wind']), code: asNumber(now['code']), isDay: asBoolean(now['isDay'], true),
    },
    days: asArray(raw['days']).filter(isRecord).map((d) => ({
      date: asString(d['date']), code: asNumber(d['code']), max: asNumber(d['max']), min: asNumber(d['min']), rain: asNumber(d['rain']),
    })),
  };
}
