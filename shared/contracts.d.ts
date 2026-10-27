// Contratos compartidos entre el servicio (Node) y lo que corre en Edge (inicio + inject).
// Es un archivo de declaraciones global (sin import/export) para que también lo pueda usar el
// script que se mete en cada página, que no puede ser un módulo.

declare namespace Contracts {
  /** Un título del catálogo (película o serie). Los textos ya vienen recortados y sin HTML. */
  interface LibraryTitle {
    readonly id: string;
    readonly title: string;
    readonly type: 'movie' | 'tv';
    readonly poster: string;
    readonly backdrop: string;
    readonly year: string;
    readonly rating: string;
    readonly overview: string;
  }
  /** El título grande de arriba del catálogo. */
  interface LibraryHero extends LibraryTitle {
    readonly genres: readonly string[];
  }
  interface LibraryCast {
    readonly name: string;
    readonly character: string;
  }
  /** Una temporada de una serie (number 0 = especiales). */
  interface LibrarySeason {
    readonly number: number;
    readonly name: string;
    readonly episodes: number;
  }
  interface LibraryDetails extends LibraryHero {
    readonly runtime: number | null;
    readonly cast: readonly LibraryCast[];
    readonly seasons: readonly LibrarySeason[];
    /** Idioma original del título (código TMDB: "es", "en"…). */
    readonly originalLanguage?: string;
    /** Títulos parecidos, para seguir explorando desde la ficha. */
    readonly related?: readonly LibraryTitle[];
  }
  interface LibraryEpisode {
    readonly season: number;
    readonly episode: number;
    readonly name: string;
    readonly overview: string;
    readonly still: string;
    readonly rating: string;
  }
  /** Un servidor de reproducción que ofrece la fuente. */
  interface LibraryProvider {
    readonly id: string;
    readonly name: string;
    readonly tagline: string;
  }
  /** Una pista de audio que anuncia el servidor. */
  interface LibraryAudioTrack {
    readonly lang: string;
    readonly label: string;
  }
  /** Una fuente reproducible: HLS (.m3u8) o MP4 directo. Nunca iframes ni scripts. */
  interface LibrarySource {
    readonly url: string;
    readonly type: 'hls' | 'mp4';
    readonly quality: string;
    readonly server: string;
    /** Idioma de esta variante, si el servidor las separa ("es", "en"…). */
    readonly audio?: string;
    /** Pistas incluidas en la misma fuente (HLS multi-audio). */
    readonly audioTracks?: readonly LibraryAudioTrack[];
  }
  interface LibrarySubtitle {
    readonly url: string;
    readonly label: string;
    readonly lang: string;
  }
  /** Lo que responde /api/library. Sólo viene el campo de la operación pedida. */
  interface LibraryReply {
    readonly hero?: LibraryHero;
    readonly rows?: readonly { readonly name: string; readonly items: readonly LibraryTitle[] }[];
    readonly items?: readonly LibraryTitle[];
    readonly details?: LibraryDetails;
    readonly episodes?: readonly LibraryEpisode[];
    readonly providers?: readonly LibraryProvider[];
    readonly sources?: readonly LibrarySource[];
    readonly subtitles?: readonly LibrarySubtitle[];
    readonly provider?: string;
    readonly alternates?: readonly string[];
    readonly error?: string;
  }
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
  __controlTvTogglePlayback?: () => boolean;
  __controlTv?: Contracts.Overlay;
  /** Botón Atrás: si el sitio tiene algo abierto encima (una ficha), lo cierra y devuelve true. */
  __controlTvBack?: () => boolean | 'escape';
  /** Confirma foco editable o enfoca un único buscador visible; no recibe ni guarda el texto. */
  __controlTvPrepareText?: () => boolean | Promise<boolean>;
}
