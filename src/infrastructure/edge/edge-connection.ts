import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import type { Logger } from '../../domain/ports';
import type { GpuChoice } from '../../domain/settings';
import { Signal } from '../../domain/signal';
import { AD_BLOCK_PATTERNS } from './ad-block';
import { CdpClient } from './cdp-client';
import type { CdpMethod, CdpParams, CdpResult, TargetInfo } from './cdp-protocol';
import { applyEdgePreferences, LANGUAGE_FLAGS } from './edge-preferences';

export interface EdgeOptions {
  readonly port: number;
  readonly profileDir: string;
  readonly homeUrl: string;
  readonly injectScript: string;
  readonly headless: boolean;
  /** Con qué placa de video dibujar (se lee cada vez que se abre Edge). */
  readonly gpu: () => GpuChoice;
}

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env['LOCALAPPDATA'] ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
];

/** Si Edge se cierra, cuánto esperar antes de reabrirlo, y cada cuánto revisar por las dudas. */
const REOPEN_DELAY_MS = 1500;
const SAFETY_CHECK_MS = 15_000;
/** Cada cuánto se revisa que la ventana siga a pantalla completa (es una consulta instantánea). */
const FULLSCREEN_CHECK_MS = 2000;
/** Cuánto esperar después de abrir para revisar la GPU (si se cae, Edge reintenta 3 veces en ~3 s). */
const GPU_CHECK_DELAY_MS = 8000;

/**
 * Dibujar todo con la placa de video. Ojo: NO usar --force_high_performance_gpu: con el driver de
 * NVIDIA de esta notebook (2015) el proceso de GPU de Edge se cae al arrancar y Edge termina
 * dibujando por software (todo a pocos cuadros). La Intel HD con Direct3D 11 anda perfecto, y el
 * HDMI sale por ella igual.
 */
const GPU_FLAGS: readonly string[] = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy'];
/**
 * La GeForce: con el driver de NVIDIA de esta notebook sólo arranca sin la composición directa de
 * Windows (con ella el proceso de GPU se cae). Medido: 60 cuadros igual que la Intel, pero con un
 * cuadro más de demora (copia cada imagen a la Intel, que es la que sale por el HDMI).
 */
const DEDICATED_GPU_FLAGS: readonly string[] = ['--force_high_performance_gpu', '--disable-direct-composition'];

/**
 * La conexión con la ventana de Edge que hace de tele: la abre a pantalla completa, se engancha a
 * la pestaña principal y la mantiene viva. Las otras clases de edge/ mandan sus comandos por acá.
 */
export class EdgeConnection {
  /** La pestaña cambió de dirección (navegación, link). */
  readonly urlChanged = new Signal<string>();
  /** Una página quiso abrir otra ventana (target="_blank"): en una tele va en la misma. */
  readonly popupRequested = new Signal<string>();
  /** Se conectó (o reconectó) a una página nueva: quien guarda estado de la página lo reinicia. */
  readonly attached = new Signal<void>();
  /** El proceso principal de Edge (para saber cuándo su ventana está al frente). */
  readonly browserProcess = new Signal<number>();
  /** Los procesos que dibujan la tele (principal y de video), para darles prioridad. */
  readonly renderProcesses = new Signal<readonly number[]>();

  private client: CdpClient | null = null;
  private sessionId: string | null = null;
  private targetId: string | null = null;
  private starting: Promise<void> | null = null;
  private suspended = false;
  /** Si la GPU falló con las opciones de rendimiento, Edge se reabre sin ellas (las de fábrica). */
  private gpuSafeMode = false;
  private defaultUserAgent = '';
  private readonly inject: string;

  constructor(private readonly options: EdgeOptions, private readonly log: Logger) {
    this.inject = readFileSync(options.injectScript, 'utf8');
  }

  get userAgent(): string {
    return this.defaultUserAgent;
  }

  /** Arranca el vigilante: si Edge se cierra o se cuelga, lo vuelve a abrir. */
  start(): void {
    setInterval(() => {
      if (!this.suspended && !this.isReady) this.ensureSoon();
    }, SAFETY_CHECK_MS).unref();
    // La tele siempre a pantalla completa: si por cualquier motivo sale, vuelve sola.
    setInterval(() => void this.keepFullscreen(), FULLSCREEN_CHECK_MS).unref();
    this.ensureSoon();
  }

  /** Si la ventana no está a pantalla completa, la pone. */
  private async keepFullscreen(): Promise<void> {
    if (this.suspended || !this.isReady || !this.targetId) return;
    try {
      const { windowId } = await this.browser('Browser.getWindowForTarget', { targetId: this.targetId });
      const { bounds } = await this.browser('Browser.getWindowBounds', { windowId });
      if (bounds.windowState === 'fullscreen') return;
      if (bounds.windowState === 'minimized') {
        await this.browser('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      }
      await this.browser('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
    } catch {
      // Edge se está cerrando o reabriendo: se revisa de nuevo en el próximo intento.
    }
  }

  get isReady(): boolean {
    return this.client?.isOpen === true && this.sessionId !== null;
  }

  /** Abre Edge si hace falta y espera a que esté listo. */
  ensure(): Promise<void> {
    this.suspended = false;
    if (this.isReady) return Promise.resolve();
    this.starting ??= this.connect().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Cierra Edge y lo vuelve a abrir (toma las opciones nuevas, ej. la placa de video). */
  async restart(): Promise<void> {
    this.gpuSafeMode = false;
    const client = this.client;
    if (!client) return this.ensure();
    const closed = new Promise<void>((resolve) => { client.onClose(resolve); });
    await client.send('Browser.close', {}).catch(() => undefined);
    await closed;
    // Al cerrarse se reabre solo (ver connect); esperamos a que esté de nuevo.
    await sleep(REOPEN_DELAY_MS + 500);
    await this.ensure();
  }

  /** Cierra Edge y no lo reabre hasta que alguien llame a ensure(). */
  async closeWindow(): Promise<void> {
    this.suspended = true;
    await this.client?.send('Browser.close', {}).catch(() => undefined);
  }

  /** Comando a la pestaña principal. */
  page<M extends CdpMethod>(method: M, params: CdpParams<M>): Promise<CdpResult<M>> {
    if (!this.client || !this.sessionId) return Promise.reject(new Error('Edge no está conectado'));
    return this.client.send(method, params, this.sessionId);
  }

  /** Comando al navegador (ventanas, pestañas). */
  browser<M extends CdpMethod>(method: M, params: CdpParams<M>): Promise<CdpResult<M>> {
    if (!this.client) return Promise.reject(new Error('Edge no está conectado'));
    return this.client.send(method, params);
  }

  /** Pone la ventana a pantalla completa y al frente. */
  async bringToFront(): Promise<void> {
    if (!this.targetId) return;
    const { windowId } = await this.browser('Browser.getWindowForTarget', { targetId: this.targetId });
    const { bounds } = await this.browser('Browser.getWindowBounds', { windowId });
    if (bounds.windowState === 'minimized') {
      await this.browser('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    }
    if (bounds.windowState !== 'fullscreen') {
      await this.browser('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
    }
    await this.page('Page.bringToFront', {});
  }

  private ensureSoon(): void {
    this.ensure().catch((error: unknown) => {
      this.log.warn('No se pudo abrir Edge:', error);
    });
  }

  private async connect(): Promise<void> {
    let version = await CdpClient.probe(this.options.port);
    if (!version) {
      this.launch();
      for (let i = 0; i < 60 && !version; i++) {
        await sleep(250);
        version = await CdpClient.probe(this.options.port);
      }
      if (!version) throw new Error('Edge no respondió');
    }
    this.defaultUserAgent = version.userAgent.replace('HeadlessChrome', 'Chrome');

    const client = await CdpClient.connect(version.webSocketDebuggerUrl);
    this.client = client;
    client.onClose(() => {
      if (this.client !== client) return;
      this.client = null;
      this.sessionId = null;
      this.log.info('Edge se cerró');
      if (!this.suspended) setTimeout(() => { this.ensureSoon(); }, REOPEN_DELAY_MS);
    });
    client.on('Target.targetCreated', ({ targetInfo }) => { this.onTarget(targetInfo); });
    client.on('Target.targetInfoChanged', ({ targetInfo }) => { this.onTarget(targetInfo); });
    client.on('Target.targetDestroyed', ({ targetId }) => {
      if (targetId === this.targetId) this.sessionId = null;
    });
    // Un pedido a una red de publicidad quedó frenado: se cancela (la página sigue como si no existiera).
    client.on('Fetch.requestPaused', ({ requestId }, sessionId) => {
      client.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, sessionId ?? undefined).catch(() => undefined);
    });
    await client.send('Target.setDiscoverTargets', { discover: true });

    const { targetInfos } = await client.send('Target.getTargets', {});
    const pages = targetInfos.filter((t) => t.type === 'page');
    const page = pages.find((t) => t.url.startsWith(this.options.homeUrl)) ?? pages[0];
    const targetId = page?.targetId ?? (await client.send('Target.createTarget', { url: this.options.homeUrl })).targetId;
    await this.attach(targetId);
    if (!page?.url.startsWith(this.options.homeUrl)) await this.page('Page.navigate', { url: this.options.homeUrl });
    const { processInfo } = await client.send('SystemInfo.getProcessInfo', {});
    const browser = processInfo.find((p) => p.type === 'browser');
    if (browser) this.browserProcess.emit(browser.id);
    this.renderProcesses.emit(processInfo.filter((p) => p.type === 'browser' || p.type === 'GPU').map((p) => p.id));
    // Al abrir (o reconectar) queda siempre a pantalla completa.
    await this.keepFullscreen();
    this.log.info('Edge listo');
    if (!this.options.headless) setTimeout(() => void this.checkGpu(client), GPU_CHECK_DELAY_MS).unref();
  }

  /**
   * Revisa que Edge esté dibujando con la placa de video. Si el proceso de GPU se cayó y quedó
   * dibujando por software (lento), se reabre en modo seguro (sin las opciones de rendimiento).
   */
  private async checkGpu(client: CdpClient): Promise<void> {
    if (this.client !== client) return;
    const { gpu } = await client.send('SystemInfo.getInfo', {}).catch(() => ({ gpu: null }));
    if (!gpu) return;
    const compositing = gpu.featureStatus['gpu_compositing'] ?? '';
    const renderer = gpu.auxAttributes['glRenderer'];
    if (!compositing.startsWith('disabled')) {
      this.log.info('Placa de video en uso:', typeof renderer === 'string' ? renderer : compositing);
      return;
    }
    if (this.gpuSafeMode) {
      this.log.warn('Edge dibuja sin placa de video (por software): va a andar más lento');
      return;
    }
    this.log.warn('La placa de video falló en Edge: se reabre en modo seguro');
    this.gpuSafeMode = true;
    await client.send('Browser.close', {}).catch(() => undefined); // al cerrarse, se reabre solo
  }

  private async attach(targetId: string): Promise<void> {
    if (!this.client) return;
    const { sessionId } = await this.client.send('Target.attachToTarget', { targetId, flatten: true });
    this.targetId = targetId;
    this.sessionId = sessionId;
    await this.page('Page.enable', {});
    // Bloqueador de anuncios: Edge frena los pedidos a redes de publicidad y acá se cancelan.
    await this.page('Fetch.enable', { patterns: AD_BLOCK_PATTERNS });
    // inject.js corre en cada página que se abra: navegación con flechas, avisos y volumen.
    await this.page('Page.addScriptToEvaluateOnNewDocument', { source: this.inject });
    await this.page('Runtime.evaluate', { expression: this.inject }).catch(() => undefined);
    this.attached.emit();
  }

  private onTarget(info: TargetInfo): void {
    if (info.targetId === this.targetId) {
      this.urlChanged.emit(info.url);
      return;
    }
    // Una ventana nueva abierta por una página: la cerramos siempre; si se abre o no en la tele lo
    // decide la pantalla (las de propaganda se descartan).
    if (info.type !== 'page' || !info.openerId || !info.url || info.url === 'about:blank') return;
    this.client?.send('Target.closeTarget', { targetId: info.targetId }).catch(() => undefined);
    this.popupRequested.emit(info.url);
  }

  private launch(): void {
    const exe = BROWSERS.find((path) => existsSync(path));
    if (!exe) throw new Error('No se encontró Microsoft Edge ni Google Chrome');
    const { port, profileDir, homeUrl, headless } = this.options;
    // Antes de abrir: traducción automática al español e idioma preferido (Edge los lee al arrancar).
    try {
      applyEdgePreferences(profileDir);
    } catch (error: unknown) {
      this.log.warn('No se pudieron guardar las preferencias de Edge:', error);
    }
    const args = [
      ...LANGUAGE_FLAGS,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      `--app=${homeUrl}`,
      '--start-fullscreen',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-crash-restore-bubble',
      '--disable-session-crashed-bubble',
      '--autoplay-policy=no-user-gesture-required',
      '--overscroll-history-navigation=0',
      '--disable-renderer-backgrounding',
      ...(this.gpuSafeMode ? [] : GPU_FLAGS),
      ...(!this.gpuSafeMode && this.options.gpu() === 'dedicated' ? DEDICATED_GPU_FLAGS : []),
      '--disable-features=msEdgeSidebarV2,msHubApps,msUndersideButton,msEdgeShoppingUI',
      ...(headless ? ['--headless=new', '--window-size=1366,720'] : []),
    ];
    this.log.info('Abriendo', basename(exe));
    spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
