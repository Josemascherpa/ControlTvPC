// Las "aplicaciones" del inicio: páginas que se abren a pantalla completa.

/** Qué hace "Atrás" adentro de la app: volver a la página anterior o mandarle Escape (apps para TV). */
export type BackBehavior = 'history' | 'escape';

/** Categorías de la biblioteca de apps. */
export type AppCategory = Contracts.AppCategory;

export interface TvApp {
  readonly id: string;
  readonly name: string;
  readonly category: AppCategory;
  readonly url: string;
  /** Para reconocer a qué app pertenece una dirección (ej. "netflix.com"). */
  readonly domain: string;
  readonly color: string;
  readonly background: string;
  readonly back: BackBehavior;
  /** Con qué navegador "dice ser" (YouTube muestra su versión para TV sólo a las Smart TV). */
  readonly userAgent: string | null;
}

/** Cualquier página que no es una de las apps conocidas. */
export const WEB_APP: TvApp = {
  id: 'web',
  name: 'Internet',
  category: 'web',
  url: '',
  domain: '',
  color: '#4285f4',
  background: '#ffffff',
  back: 'history',
  userAgent: null,
};
