import type { TvApp } from '../../domain/apps';
import { WEB_APP } from '../../domain/apps';
import type { AppCatalog, Logger, PageKey, TvScreen } from '../../domain/ports';
import { sameSite, toTvUrl } from '../../domain/urls';
import type { KeyEventParams } from './cdp-protocol';
import type { EdgeConnection } from './edge-connection';

interface KeyDefinition {
  readonly key: string;
  readonly code: string;
  readonly vk: number;
  readonly text?: string;
}

// Cada tecla como la entiende una página web: nombre, código y número de tecla de Windows.
const KEYS: Readonly<Record<PageKey, KeyDefinition>> = {
  UP: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  DOWN: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  LEFT: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  RIGHT: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ENTER: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  ESCAPE: { key: 'Escape', code: 'Escape', vk: 27 },
  PAGE_UP: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PAGE_DOWN: { key: 'PageDown', code: 'PageDown', vk: 34 },
};

/**
 * La tele hecha con Edge: el inicio es una página local y cada app se abre en la misma ventana.
 * Sabe en qué app está para que "Atrás" haga lo correcto en cada una.
 */
export class EdgeScreen implements TvScreen {
  private current: TvApp | null = null; // null = estamos en el inicio
  private pageUrl = '';

  constructor(
    private readonly edge: EdgeConnection,
    private readonly apps: AppCatalog,
    private readonly homeUrl: string,
    private readonly log: Logger,
  ) {
    edge.urlChanged.subscribe((url) => {
      this.pageUrl = url;
      this.syncApp(url);
    });
    edge.popupRequested.subscribe((url) => {
      // Una ventana nueva sólo se abre si es del mismo sitio o de una app conocida: las de otros
      // sitios casi siempre son propaganda (típico en las páginas de películas online).
      if (!sameSite(url, this.pageUrl) && !this.apps.forUrl(url)) {
        this.log.info('Ventana emergente bloqueada:', new URL(url).hostname);
        return;
      }
      this.openUrl(url).catch((error: unknown) => {
        this.log.warn('No se pudo abrir la ventana nueva:', error);
      });
    });
  }

  get atHome(): boolean {
    return this.current === null;
  }

  async show(): Promise<void> {
    await this.edge.ensure();
    await this.edge.bringToFront();
  }

  async goHome(): Promise<void> {
    await this.edge.ensure();
    await this.setUserAgent(null);
    await this.edge.page('Page.navigate', { url: this.homeUrl });
    this.current = null;
  }

  async openApp(app: TvApp): Promise<void> {
    await this.navigate(app.url, app, app.userAgent);
  }

  async openUrl(rawUrl: string): Promise<void> {
    const url = toTvUrl(rawUrl);
    const app = this.apps.forUrl(url);
    // El "disfraz" de Smart TV sólo para la dirección principal de la app (ej. youtube.com/tv).
    const userAgent = app && url.startsWith(app.url.split('#')[0] ?? app.url) ? app.userAgent : null;
    await this.navigate(url, app ?? WEB_APP, userAgent);
  }

  /** "Atrás": cierra lo abierto, vuelve a la página anterior o, si no hay, al inicio. */
  async back(): Promise<void> {
    if (this.atHome) return this.pressKey('ESCAPE'); // el inicio cierra el panel que esté abierto
    // Primero lo que esté encima: video a pantalla completa, o la ficha abierta del sitio (modo TV).
    const { result } = await this.edge.page('Runtime.evaluate', {
      expression: 'document.fullscreenElement ? (document.exitFullscreen(), true) : (window.__controlTvBack ? window.__controlTvBack() : false)',
      returnByValue: true,
    });
    if (result.value === true) return undefined;
    if (this.current?.back === 'escape') return this.pressKey('ESCAPE');

    const { currentIndex, entries } = await this.edge.page('Page.getNavigationHistory', {});
    const previous = entries[currentIndex - 1];
    if (previous && !previous.url.startsWith(this.homeUrl) && !previous.url.startsWith('about:')) {
      await this.edge.page('Page.navigateToHistoryEntry', { entryId: previous.id });
      return undefined;
    }
    return this.goHome();
  }

  async pressKey(name: PageKey): Promise<void> {
    const k = KEYS[name];
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk };
    const down: KeyEventParams = k.text === undefined ? { type: 'rawKeyDown', ...base } : { type: 'keyDown', text: k.text, ...base };
    // Se mandan juntas (el orden lo garantiza la conexión): no esperamos la respuesta del medio.
    await Promise.all([
      this.edge.page('Input.dispatchKeyEvent', down),
      this.edge.page('Input.dispatchKeyEvent', { type: 'keyUp', ...base }),
    ]);
  }

  async insertText(text: string): Promise<void> {
    await this.edge.ensure();
    await this.edge.page('Input.insertText', { text });
  }

  closeToDesktop(): Promise<void> {
    return this.edge.closeWindow();
  }

  restart(): Promise<void> {
    return this.edge.restart();
  }

  private async navigate(url: string, app: TvApp, userAgent: string | null): Promise<void> {
    await this.edge.ensure();
    await this.setUserAgent(userAgent);
    await this.edge.page('Page.navigate', { url });
    this.current = app;
    await this.edge.bringToFront();
  }

  /**
   * El "disfraz" de Smart TV (YouTube) o ninguno. Para volver a lo normal se QUITA el disfraz (texto
   * vacío): si en cambio se pone el texto normal, Edge deja de mandar sus datos de identificación
   * (marca, plataforma, versiones) y los sitios ven un dispositivo distinto. Medido: Netflix cerraba
   * la sesión por eso cada vez que se volvía a entrar.
   */
  private async setUserAgent(userAgent: string | null): Promise<void> {
    await this.edge.page('Network.setUserAgentOverride', { userAgent: userAgent ?? '' }).catch(() => undefined);
  }

  // Si la persona navega con el cursor a otra página, actualizamos en qué app estamos.
  private syncApp(url: string): void {
    if (url.startsWith(this.homeUrl)) this.current = null;
    else if (!url.startsWith('about:')) this.current = this.apps.forUrl(url) ?? WEB_APP;
  }
}
