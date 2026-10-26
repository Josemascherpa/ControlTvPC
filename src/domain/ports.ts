// "Puertos": lo que la lógica necesita del mundo exterior, sin decir cómo se hace.
// Las implementaciones viven en infrastructure/ (Edge, Windows, archivos, internet) y se conectan
// en app.ts. Así la lógica se puede probar con versiones falsas y cambiar una pieza no rompe el resto.
// Interfaces chicas y específicas (la "I" de SOLID).

import type { TvApp } from './apps';
import type { Settings } from './settings';
import type { Signal } from './signal';

/** Teclas que se le pueden mandar a la página abierta. */
export type PageKey = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'ENTER' | 'ESCAPE' | 'PAGE_UP' | 'PAGE_DOWN';

/** La pantalla de la tele: el inicio y las apps. */
export interface TvScreen {
  readonly atHome: boolean;
  /** Se asegura de que esté abierta y al frente (la abre si se había cerrado). */
  show(): Promise<void>;
  goHome(): Promise<void>;
  openApp(app: TvApp): Promise<void>;
  openUrl(url: string): Promise<void>;
  back(): Promise<void>;
  pressKey(key: PageKey): Promise<void>;
  insertText(text: string): Promise<void>;
  /** Cierra la tele y deja el escritorio de Windows. */
  closeToDesktop(): Promise<void>;
  /** Cierra y vuelve a abrir el navegador (ej. para cambiar de placa de video). */
  restart(): Promise<void>;
}

/** El cursor propio de la tele. Movimientos en píxeles de una pantalla de referencia de 1366 de ancho. */
export interface PointerSurface {
  moveBy(dx: number, dy: number): Promise<void>;
  click(): Promise<void>;
  /** Desplazamiento suave. Positivo = bajar / ir a la derecha (120 = un clic de ruedita). */
  wheel(deltaY: number, deltaX: number): Promise<void>;
  /** Esconde la flecha (se está navegando con las flechas del control). */
  hide(): void;
}

/** Cosas dibujadas arriba de lo que se esté viendo. */
export interface Overlay {
  toast(text: string, icon: string): void;
  showVolume(volume: Contracts.VolumeState): void;
}

/** El volumen de lo que se escucha en el tele. */
export interface VolumeControl {
  readonly current: Contracts.VolumeState | null;
  /** true si el tele ya muestra su propia barra de volumen (entonces no dibujamos la nuestra). */
  readonly showsOwnIndicator: boolean;
  read(): Promise<Contracts.VolumeState | null>;
  up(): Promise<Contracts.VolumeState | null>;
  down(): Promise<Contracts.VolumeState | null>;
  toggleMute(): Promise<Contracts.VolumeState | null>;
}

/** El tele de verdad (el que está conectado por HDMI), manejado por la red. */
export interface PhysicalTv {
  /** Su MAC, para despertarlo por la red y pasársela al celular (null = todavía no se sabe). */
  readonly mac: string | null;
  /** Su nombre (ej. "[LG] webOS TV UJ6580"). */
  readonly name: string | null;
  /** Lo último que se sabe: prendido o no. */
  readonly isOn: boolean;
  /** Se prendió (con el celular, con su control o desde acá). */
  readonly turnedOn: Signal<void>;
  /** Pregunta ahora si está prendido. */
  checkOn(): Promise<boolean>;
  turnOn(): Promise<void>;
  /** false si este tele no se puede apagar por la red (ahí sólo se corta la imagen). */
  turnOff(): Promise<boolean>;
}

/** Prender/apagar la imagen y que la notebook no se duerma. */
export interface DisplayPower {
  turnOff(): void;
  turnOn(): void;
  keepAwake(display: boolean): void;
}

/** Qué plan de energía usar: todo al máximo (se está usando) o ahorro (sin uso). */
export type PowerMode = 'performance' | 'saver';

/** Los planes de energía de Windows que creó optimizacion/plan-energia.ps1. */
export interface PowerPlans {
  /** true si existen los dos planes (si no, no se cambia nada). */
  available(): Promise<boolean>;
  activate(mode: PowerMode): Promise<void>;
}

/** Señales de que alguien está usando la notebook, aparte de los pedidos del celular. */
export interface ActivityProbe {
  /** Cuánto pasó desde el último toque de teclado o mouse (incluido el cursor del celular). */
  msSinceInput(): number;
  /** Si hay un video o música reproduciéndose en la tele. */
  isMediaPlaying(): Promise<boolean>;
}

export interface MediaKeys {
  playPause(): void;
}

/**
 * Modo tele: bloquea el mouse/touchpad físico y mantiene la tele siempre al frente (no se puede
 * sacar con Alt+Tab ni minimizar). unlock() es "Salir al escritorio".
 */
export interface InputLock {
  lock(): void;
  unlock(): void;
}

export interface SettingsStore {
  get<K extends keyof Settings>(key: K): Settings[K];
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
}

export interface AppCatalog {
  list(): readonly TvApp[];
  find(id: string): TvApp | undefined;
  /** Las apps que van en el inicio si la persona todavía no eligió. */
  defaultHome(): readonly string[];
  /** La app a la que pertenece una dirección, si es de alguna. */
  forUrl(url: string): TvApp | undefined;
  reload(): void;
}

export interface NetworkInfo {
  /** La IP de la notebook en el WiFi de la casa, o null si no hay red. */
  localAddress(): string | null;
}

export interface HomeData {
  snapshot(): Contracts.HomeSnapshot;
}

/** Avisos en vivo a la pantalla de inicio. */
export interface UiPublisher {
  publish(message: Contracts.ServerToUi): void;
}

export interface Logger {
  info(...parts: readonly unknown[]): void;
  warn(...parts: readonly unknown[]): void;
  error(...parts: readonly unknown[]): void;
}
