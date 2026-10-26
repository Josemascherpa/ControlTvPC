import type { Logger, NetworkInfo, Overlay, SettingsStore, VolumeControl } from '../../domain/ports';
import type { HdmiVolume } from '../windows/hdmi-volume';
import { findLgTv, looksLikeLg, type LgTvClient } from './lg-tv-client';

/** Cada cuánto se reintenta encontrar/conectar el tele si no está. */
const RETRY_MS = 30_000;

/**
 * El volumen de lo que se escucha en el tele:
 *   - si el tele LG está en el WiFi → su volumen de verdad (se mueve su número y su propia barra);
 *   - si no (todavía) → el nivel del sonido que sale por el HDMI, para que los botones nunca
 *     queden muertos. Mientras tanto lo sigue buscando y, apenas aparece, se pasa al tele.
 */
export class LgTvVolume implements VolumeControl {
  private connecting = false;

  constructor(
    private readonly tv: LgTvClient,
    private readonly hdmi: HdmiVolume,
    private readonly settings: SettingsStore,
    private readonly network: NetworkInfo,
    overlay: Overlay,
    private readonly log: Logger,
  ) {
    tv.statusChanged.subscribe((status) => {
      if (status === 'waiting-accept') overlay.toast('Aceptá el mensaje que apareció en el tele con su control', '📺');
      if (status === 'connected') overlay.toast('Listo: el volumen del celular maneja el del tele', '📺');
    });
  }

  get showsOwnIndicator(): boolean {
    return this.tv.isConnected;
  }

  get current(): Contracts.VolumeState | null {
    return this.tv.isConnected ? this.tv.currentVolume : this.hdmi.current;
  }

  /** Empieza a buscar el tele y lo mantiene conectado (reintenta solo). */
  start(): void {
    void this.tryConnect();
    setInterval(() => {
      if (!this.tv.isConnected) void this.tryConnect();
    }, RETRY_MS).unref();
  }

  /** Conecta ya con el tele en la IP conocida, sin buscarlo por toda la red (ej. mientras prende). */
  connectKnown(): Promise<void> {
    return this.tryConnect(false);
  }

  read(): Promise<Contracts.VolumeState | null> {
    return this.tv.isConnected ? this.tv.readVolume() : this.hdmi.read();
  }

  up(): Promise<Contracts.VolumeState | null> {
    return this.onTv(() => this.tv.volumeUp(), () => this.hdmi.up());
  }

  down(): Promise<Contracts.VolumeState | null> {
    return this.onTv(() => this.tv.volumeDown(), () => this.hdmi.down());
  }

  toggleMute(): Promise<Contracts.VolumeState | null> {
    return this.onTv(() => this.tv.setMute(!(this.tv.currentVolume?.muted ?? false)), () => this.hdmi.toggleMute());
  }

  private async onTv(onTv: () => Promise<void>, onHdmi: () => Promise<Contracts.VolumeState | null>): Promise<Contracts.VolumeState | null> {
    if (!this.tv.isConnected) {
      void this.tryConnect();
      return onHdmi();
    }
    try {
      await onTv();
      return await this.tv.readVolume();
    } catch (error: unknown) {
      this.log.warn('Volumen del tele:', error);
      return onHdmi();
    }
  }

  private async tryConnect(scan = true): Promise<void> {
    if (this.connecting || this.tv.isConnected) return;
    this.connecting = true;
    try {
      let ip = this.settings.get('tvIp');
      if (!ip || !(await looksLikeLg(ip))) {
        // Si el tele del HDMI es de otra marca, no se busca un LG (podría ser otro tele de la casa).
        const brand = this.settings.get('tvBrand');
        if (!scan || (brand !== null && brand !== 'lg')) return;
        const local = this.network.localAddress();
        this.tv.setStatus('searching');
        ip = local ? await findLgTv(local) : null;
        if (!ip) {
          this.tv.setStatus('disconnected');
          return;
        }
        this.settings.set('tvIp', ip);
      }
      await this.tv.connect(ip);
      await this.tv.readVolume().catch(() => null);
    } catch (error: unknown) {
      this.tv.setStatus('disconnected');
      this.log.info('Tele LG:', error instanceof Error ? error.message : String(error));
    } finally {
      this.connecting = false;
    }
  }
}
