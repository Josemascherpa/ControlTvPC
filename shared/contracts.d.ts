// Contratos compartidos entre el servicio (Node) y lo que corre en Edge (inicio + inject).
// Es un archivo de declaraciones global (sin import/export) para que también lo pueda usar el
// script que se mete en cada página, que no puede ser un módulo.

declare namespace Contracts {
  interface VolumeState {
    readonly level: number;
    readonly muted: boolean;
  }

  interface Toast {
    readonly text: string;
    readonly icon: string;
  }

  /** Categorías de la biblioteca de apps (en el orden en que se muestran). */
  type AppCategory = 'platforms' | 'movies' | 'live' | 'music' | 'video' | 'web';

  /** Lo que cada app del inicio necesita para dibujarse. */
  interface AppTile {
    readonly id: string;
    readonly name: string;
    readonly category: AppCategory;
    readonly color: string;
    readonly background: string;
  }

  interface WeatherNow {
    readonly temp: number;
    readonly feels: number;
    readonly humidity: number;
    readonly wind: number;
    readonly code: number;
    readonly isDay: boolean;
  }

  interface WeatherDay {
    readonly date: string;
    readonly code: number;
    readonly max: number;
    readonly min: number;
    readonly rain: number;
  }

  interface Weather {
    readonly city: string;
    readonly now: WeatherNow;
    readonly days: readonly WeatherDay[];
  }

  interface DollarRate {
    readonly name: string;
    readonly buy: number | null;
    readonly sell: number | null;
  }

  interface NewsItem {
    readonly title: string;
    readonly source: string;
    readonly url: string;
  }

  interface Background {
    readonly file: string;
    readonly caption: string;
    readonly credit: string;
  }

  interface HomeSnapshot {
    readonly weather: Weather | null;
    readonly dollar: readonly DollarRate[];
    readonly news: readonly NewsItem[];
    readonly backgrounds: readonly Background[];
  }

  interface UiState {
    readonly name: string;
    readonly ip: string | null;
    readonly phones: readonly string[];
    readonly pairedCount: number;
    readonly allowNewPhones: boolean;
    readonly volume: VolumeState | null;
    readonly ambientMinutes: number;
    /** Las apps que se muestran en el inicio, en el orden elegido. */
    readonly homeApps: readonly string[];
    /** La placa de video con la que dibuja la tele. */
    readonly gpu: 'integrated' | 'dedicated';
    /** El tele conectado por HDMI, si se lo encontró en el WiFi. */
    readonly tv: { readonly name: string; readonly mac: string } | null;
  }

  /** Mensajes del servicio a la pantalla de inicio. */
  type ServerToUi =
    | { readonly type: 'state'; readonly state: UiState }
    | { readonly type: 'menu' };

  /** Pedidos de la pantalla de inicio al servicio. */
  type UiToServer =
    | { readonly type: 'open'; readonly id: string }
    | { readonly type: 'openUrl'; readonly url: string }
    | { readonly type: 'show' }
    | { readonly type: 'forgetPhones' }
    | { readonly type: 'toggleNewPhones' }
    | { readonly type: 'reloadApps' }
    | { readonly type: 'screenOff' }
    | { readonly type: 'quit' }
    /** Cambia la placa de video (Intel / GeForce): Edge se reabre. */
    | { readonly type: 'toggleGpu' }
    /** Guarda qué apps van en el inicio y en qué orden. */
    | { readonly type: 'setHomeApps'; readonly ids: readonly string[] };

  /** Lo que el script de cada página (inject) le ofrece al servicio para dibujar arriba de todo. */
  interface Overlay {
    toast(toast: Toast): void;
    volume(volume: VolumeState): void;
  }
}

interface Window {
  __controlTv?: Contracts.Overlay;
  /** Botón Atrás: si el sitio tiene algo abierto encima (una ficha), lo cierra y devuelve true. */
  __controlTvBack?: () => boolean;
}
