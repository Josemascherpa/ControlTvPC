import type { Location } from '../../domain/settings';
import { asArray, asBoolean, asNullableNumber, asNumber, asRecord, asString, isRecord } from '../storage/json';
import { getJson, getText } from './http';

// Cada fuente de datos del inicio en su propia clase, todas con la misma forma (fácil de sumar más).

export interface DetectedLocation extends Location {
  readonly country: string;
}

/** Dónde está la notebook, según su IP (ipwho.is, gratis y sin clave). */
export class IpLocationProvider {
  async fetch(): Promise<DetectedLocation> {
    const data = asRecord(await getJson('https://ipwho.is/'));
    if (!asBoolean(data['success'])) throw new Error('sin ubicación');
    return {
      city: asString(data['city']),
      country: asString(data['country_code']),
      lat: asNumber(data['latitude']),
      lon: asNumber(data['longitude']),
    };
  }
}

/** Clima actual y de los próximos días (Open-Meteo, gratis y sin clave). */
export class OpenMeteoProvider {
  async fetch(location: Location): Promise<Contracts.Weather> {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${location.lat}&longitude=${location.lon}`
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
      + '&timezone=auto&forecast_days=6';
    const data = asRecord(await getJson(url));
    const current = asRecord(data['current']);
    const daily = asRecord(data['daily']);
    const column = (name: string): readonly unknown[] => asArray(daily[name]);
    return {
      city: location.city,
      now: {
        temp: asNumber(current['temperature_2m']),
        feels: asNumber(current['apparent_temperature']),
        humidity: asNumber(current['relative_humidity_2m']),
        wind: asNumber(current['wind_speed_10m']),
        code: asNumber(current['weather_code']),
        isDay: asNumber(current['is_day']) === 1,
      },
      days: column('time').map((date, i) => ({
        date: asString(date),
        code: asNumber(column('weather_code')[i]),
        max: asNumber(column('temperature_2m_max')[i]),
        min: asNumber(column('temperature_2m_min')[i]),
        rain: asNumber(column('precipitation_probability_max')[i]),
      })),
    };
  }
}

/** Cotización del dólar en Argentina (DolarApi, gratis y sin clave). */
export class DolarApiProvider {
  private static readonly WANTED: readonly (readonly [string, string])[] = [['oficial', 'Oficial'], ['blue', 'Blue'], ['bolsa', 'MEP']];

  async fetch(): Promise<readonly Contracts.DollarRate[]> {
    const list = asArray(await getJson('https://dolarapi.com/v1/dolares')).filter(isRecord);
    return DolarApiProvider.WANTED.flatMap(([casa, name]) => {
      const rate = list.find((d) => d['casa'] === casa);
      return rate ? [{ name, buy: asNullableNumber(rate['compra']), sell: asNullableNumber(rate['venta']) }] : [];
    });
  }
}

/** Titulares de Google Noticias Argentina (RSS). */
export class GoogleNewsProvider {
  async fetch(): Promise<readonly Contracts.NewsItem[]> {
    const xml = await getText('https://news.google.com/rss?hl=es-419&gl=AR&ceid=AR:es-419');
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12).map(([, item = '']) => {
      const tag = (name: string): string => decodeXml(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(item)?.[1] ?? '');
      const source = tag('source');
      let title = tag('title');
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      return { title, source, url: tag('link') };
    }).filter((n) => n.title !== '');
  }
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .trim();
}
