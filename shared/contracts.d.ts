// Contratos compartidos entre el servicio de la notebook (Node) y lo que corre en Edge (el Cine + inject).
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
  /** Un canal en vivo (zlive.st): se mira con su reproductor, en un marco aislado. */
  interface LibraryChannel {
    readonly id: string;
    readonly name: string;
    /** "Deportes", "Infantiles", "Noticias"… (ya en español). */
    readonly category: string;
    readonly region: string;
    readonly quality: string;
    /** En español (por nombre o país). */
    readonly spanish: boolean;
    /** Siempre https://zlive.st/embed/…: no se abre ninguna otra dirección. */
    readonly url: string;
  }
  /** Lo que responde /api/library. Sólo viene el campo de la operación pedida. */
  interface LibraryReply {
    readonly channels?: readonly LibraryChannel[];
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
    /** Búsqueda sin resultados exactos: se muestran los de una búsqueda parecida (ej. "avengrs" → "aveng"). */
    readonly approximate?: string;
    /** Respuesta de op=translate: el texto en español. */
    readonly translated?: string;
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

  /** Lo que el script que se mete en la página (inject) le ofrece al servicio para dibujar arriba de todo. */
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
  /** Búsqueda que manda el celular: el Cine busca ahí mismo. */
  __controlTvSearch?: (query: string) => boolean;
  /** Botón Inicio del control: el Cine vuelve al principio del catálogo. */
  __controlTvHome?: () => boolean;
}
