import type { Logger, PageKey, TvScreen } from '../../domain/ports';
import { googleSearchQuery } from '../../domain/urls';
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
 * La tele hecha con Edge: una sola página, el Cine. Lo que pide el control (Atrás, Inicio, buscar)
 * se lo pregunta al Cine por sus funciones `window.__controlTv…`; no hay otras apps ni historial.
 */
export class EdgeScreen implements TvScreen {
  constructor(
    private readonly edge: EdgeConnection,
    private readonly homeUrl: string,
    private readonly log: Logger,
  ) {
    edge.urlChanged.subscribe((url) => {
      // Sólo el Cine: si algo llevara a otra página (un enlace, un error), se vuelve a él.
      if (!url.startsWith(homeUrl) && !url.startsWith('about:')) {
        this.log.info('Página ajena, se vuelve al Cine:', url.slice(0, 80));
        void this.reload().catch(() => undefined);
      }
    });
    edge.popupRequested.subscribe((url) => {
      this.log.info('Ventana emergente bloqueada:', url.slice(0, 80));
    });
  }

  async show(): Promise<void> {
    await this.edge.ensure();
    await this.edge.bringToFront();
  }

  /** Al principio del catálogo, sin recargar (se conserva lo cargado). Si el Cine no contesta, se recarga. */
  async goHome(): Promise<void> {
    await this.edge.ensure();
    if (!(await this.ask('window.__controlTvHome?.() === true'))) await this.reload();
  }

  async openUrl(rawUrl: string): Promise<void> {
    // "Buscar" en el celular manda una búsqueda de Google: se busca en el Cine.
    const query = googleSearchQuery(rawUrl);
    if (!query) {
      this.log.info('Dirección del celular ignorada (sólo se usa el Cine):', rawUrl.slice(0, 80));
      return;
    }
    await this.edge.ensure();
    await this.ask(`window.__controlTvSearch?.(${JSON.stringify(query)}) === true`);
    await this.edge.bringToFront();
  }

  /** "Atrás": el Cine cierra lo que tenga abierto (reproductor, ficha, búsqueda). */
  async back(): Promise<void> {
    if (await this.ask('document.fullscreenElement ? (document.exitFullscreen(), true) : window.__controlTvBack?.() === true')) return;
    await this.pressKey('ESCAPE');
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
    // El Cine pone el foco en su buscador; si no puede (hay un video o una ficha), no se escribe nada.
    if (!(await this.ask('window.__controlTvPrepareText?.() === true'))) return;
    await this.edge.page('Input.insertText', { text });
  }

  closeToDesktop(): Promise<void> {
    return this.edge.closeWindow();
  }

  togglePlayback(): Promise<boolean> {
    return this.ask('window.__controlTvTogglePlayback?.() === true');
  }

  restart(): Promise<void> {
    return this.edge.restart();
  }

  private async reload(): Promise<void> {
    await this.edge.page('Page.navigate', { url: this.homeUrl });
  }

  /** Evalúa una expresión en el Cine; true sólo si contestó true. */
  private async ask(expression: string): Promise<boolean> {
    if (!this.edge.isReady) return false;
    try {
      const { result } = await this.edge.page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return result.value === true;
    } catch {
      return false;
    }
  }
}
