import { el } from './dom.js';

// Códigos de clima de Open-Meteo (WMO) → texto en castellano y qué ícono dibujar.

export type WeatherKind = 'clear' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm';

const TABLE: readonly (readonly [readonly number[], string, WeatherKind])[] = [
  [[0], 'Despejado', 'clear'],
  [[1], 'Mayormente despejado', 'partly'],
  [[2], 'Parcialmente nublado', 'partly'],
  [[3], 'Nublado', 'cloud'],
  [[45, 48], 'Niebla', 'fog'],
  [[51, 53, 55, 56, 57], 'Llovizna', 'rain'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'Lluvia', 'rain'],
  [[71, 73, 75, 77, 85, 86], 'Nieve', 'snow'],
  [[95, 96, 99], 'Tormenta', 'storm'],
];

export function describeWeather(code: number): { readonly text: string; readonly kind: WeatherKind } {
  const row = TABLE.find(([codes]) => codes.includes(code));
  return row ? { text: row[1], kind: row[2] } : { text: '', kind: 'cloud' };
}

const CLOUD = '<path d="M17.5 19H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.6 11 4 4 0 0 1 17.5 19Z" fill="#e8edf5"/>';
const SVG: Readonly<Record<WeatherKind | 'moon' | 'partlyNight', string>> = {
  clear: '<g class="wi-spin"><circle cx="12" cy="12" r="5" fill="#ffd34d"/><g stroke="#ffd34d" stroke-width="2" stroke-linecap="round"><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></g></g>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" fill="#dfe6f5"/>',
  partly: '<circle cx="9" cy="8" r="4" fill="#ffd34d"/><g stroke="#ffd34d" stroke-width="1.8" stroke-linecap="round"><path d="M9 1.5v1.3M2.5 8h1.3M4.4 3.4l.9.9M13.6 3.4l-.9.9"/></g><path class="wi-drift" d="M18 21H9a4.5 4.5 0 1 1 1-8.9 5.5 5.5 0 0 1 10.4 1.9A3.5 3.5 0 0 1 18 21Z" fill="#e8edf5"/>',
  partlyNight: '<path d="M14 9.5A5.5 5.5 0 1 1 7 2.6a4.5 4.5 0 0 0 7 6.9Z" fill="#dfe6f5"/><path class="wi-drift" d="M18 21H9a4.5 4.5 0 1 1 1-8.9 5.5 5.5 0 0 1 10.4 1.9A3.5 3.5 0 0 1 18 21Z" fill="#c9d2e3"/>',
  cloud: `<g class="wi-drift">${CLOUD}</g>`,
  fog: `${CLOUD}<g stroke="#b9c3d6" stroke-width="1.8" stroke-linecap="round"><path d="M5 21.5h14M8 23.2h9"/></g>`,
  rain: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.6 7 4 4 0 0 1 17.5 15Z" fill="#dfe6f2"/><g class="wi-rain" stroke="#59b4ff" stroke-width="2" stroke-linecap="round"><path d="M8 18l-1 3M12.5 18l-1 3M17 18l-1 3"/></g>',
  snow: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.6 7 4 4 0 0 1 17.5 15Z" fill="#e8edf5"/><g class="wi-rain" fill="#ffffff"><circle cx="8" cy="19" r="1.3"/><circle cx="12.5" cy="21" r="1.3"/><circle cx="17" cy="19" r="1.3"/></g>',
  storm: '<path d="M17.5 14H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.6 6 4 4 0 0 1 17.5 14Z" fill="#c4ccdb"/><path class="wi-flash" d="M12.5 13l-3 5.5h3l-1.5 5 5-7h-3l1.5-3.5Z" fill="#ffd34d"/>',
};

/** Ícono de clima dibujado (SVG propio, liviano y nítido a cualquier tamaño). */
export function weatherIcon(kind: WeatherKind, isDay = true): HTMLSpanElement {
  const name = kind === 'clear' && !isDay ? 'moon' : kind === 'partly' && !isDay ? 'partlyNight' : kind;
  const span = el('span', 'wi');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%">${SVG[name]}</svg>`;
  return span;
}

export const degrees = (value: number): string => `${Math.round(value)}°`;
