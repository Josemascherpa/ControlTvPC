import { createSocket } from 'dgram';
import type { Logger, NetworkInfo, PhysicalTv, SettingsStore } from '../../domain/ports';
import { Signal } from '../../domain/signal';
import type { LgTvClient } from '../lg/lg-tv-client';
import { answersPing, HdmiTvLocator, macFromArp } from './hdmi-tv-locator';

/** Puertos donde las placas de red escuchan el "paquete mágico" de Wake-on-LAN. */
const WAKE_PORTS = [9, 7] as const;
/** Cada cuánto se vuelve a buscar el tele del HDMI (por si se cambió de tele o de IP). */
const LOCATE_EVERY_MS = 30 * 60_000;
/** Para no buscarlo de nuevo cada vez que se conecta un celular. */
const LOCATE_MIN_GAP_MS = 2 * 60_000;
/** Cada cuánto se revisa si un tele que no es LG se prendió (contesta el ping). */
const PING_EVERY_MS = 20_000;
/** Después de despertarlo: cada cuánto se revisa si ya prendió, y hasta cuándo. */
const WAKE_CHECK_EVERY_MS = 2000;
const WAKE_CHECK_FOR_MS = 45_000;

/**
 * Prender y apagar el tele de verdad (el que está conectado por HDMI), sea de la marca que sea:
 *   - se averigua solo cuál es y su MAC (ver HdmiTvLocator), y se le pasa la MAC al celular;
 *   - prender: el "paquete mágico" (Wake-on-LAN) a su MAC, que la placa de red escucha apagada;
 *   - apagar: en los LG se lo pide por su protocolo (SSAP); en otras marcas no hay una forma común,
 *     así que la notebook corta la imagen y el tele se apaga solo por falta de señal;
 *   - cuando el tele aparece prendido (con el celular, con su control o desde acá) se avisa, para
 *     traer la tele al frente. En los LG se sabe por su conexión; en los demás, porque contesta.
 */
export class HdmiTvPower implements PhysicalTv {
  readonly turnedOn = new Signal<void>();
  private on = false;
  private lastLocate = 0;
  private locating = false;
  private wakeCheck = false;
  private readonly locator = new HdmiTvLocator();

  constructor(
    private readonly lg: LgTvClient,
    /** Conecta con el LG en la IP conocida (sin buscarlo por toda la red). */
    private readonly connectLg: () => Promise<void>,
    private readonly settings: SettingsStore,
    private readonly network: NetworkInfo,
    private readonly log: Logger,
  ) {
    lg.statusChanged.subscribe((status) => {
      if (status === 'connected') {
        void this.learnLgMac();
        this.setOn(true);
      } else if (status === 'disconnected' && this.isLg) {
        this.setOn(false);
      }
    });
  }

  get mac(): string | null {
    return this.settings.get('tvMac');
  }

  get name(): string | null {
    return this.settings.get('tvName');
  }

  get isOn(): boolean {
    return this.on;
  }

  /** Empieza: busca el tele del HDMI y vigila si se prende. */
  start(): void {
    void this.locate();
    setInterval(() => void this.locate(), LOCATE_EVERY_MS).unref();
    setInterval(() => void this.pingCheck(), PING_EVERY_MS).unref();
  }

  /** Vuelve a buscarlo pronto (ej. se conectó un celular), sin repetir si se buscó hace poco. */
  locateSoon(): void {
    if (Date.now() - this.lastLocate > LOCATE_MIN_GAP_MS) void this.locate();
  }

  async checkOn(): Promise<boolean> {
    if (this.lg.isConnected) return true;
    if (this.isLg) {
      // En los LG la respuesta segura es su protocolo (apagado puede seguir contestando el ping).
      await this.connectLg().catch(() => undefined);
      return this.lg.isConnected;
    }
    const ip = this.settings.get('tvIp');
    this.setOn(ip ? await answersPing(ip) : false);
    return this.on;
  }

  async turnOn(): Promise<void> {
    const mac = this.mac;
    if (!mac) {
      this.log.warn('No se puede prender el tele: todavía no se sabe su MAC');
      return;
    }
    this.log.info(`Prendiendo el tele (Wake-on-LAN a ${mac})`);
    await this.sendMagicPacket(mac);
    this.checkWhileTurningOn();
  }

  async turnOff(): Promise<boolean> {
    if (!this.lg.isConnected) return false;
    this.log.info('Apagando el tele');
    await this.lg.turnOff();
    return true;
  }

  private get isLg(): boolean {
    const brand = this.settings.get('tvBrand');
    return brand === 'lg' || (brand === null && this.settings.get('tvClientKey') !== null);
  }

  private setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on) this.turnedOn.emit();
  }

  private async locate(): Promise<void> {
    const local = this.network.localAddress();
    if (this.locating || !local) return;
    this.locating = true;
    this.lastLocate = Date.now();
    try {
      const tv = await this.locator.locate(local);
      if (!tv) return;
      if (tv.mac !== this.mac || tv.ip !== this.settings.get('tvIp')) this.log.info(`Tele del HDMI: ${tv.name} (${tv.ip}, MAC ${tv.mac})`);
      this.settings.set('tvIp', tv.ip);
      this.settings.set('tvMac', tv.mac);
      this.settings.set('tvBrand', tv.brand);
      this.settings.set('tvName', tv.name);
    } catch (error: unknown) {
      this.log.warn('No se pudo buscar el tele del HDMI:', error);
    } finally {
      this.locating = false;
    }
  }

  /** Al conectarse el LG ya se sabe su IP: su MAC sale de la tabla ARP (por si no se encontró por DLNA). */
  private async learnLgMac(): Promise<void> {
    const ip = this.settings.get('tvIp');
    const mac = ip ? await macFromArp(ip) : null;
    if (!mac || mac === this.mac) return;
    this.settings.set('tvMac', mac);
    this.settings.set('tvBrand', 'lg');
    this.log.info('MAC del tele guardada:', mac);
  }

  /** Los teles que no son LG: si vuelven a contestar es que los prendieron. */
  private async pingCheck(): Promise<void> {
    const ip = this.settings.get('tvIp');
    if (this.isLg || !ip || this.wakeCheck) return;
    this.setOn(await answersPing(ip));
  }

  /** Lo manda a toda la red y a su IP, varias veces (es un envío suelto: si se pierde uno, llega otro). */
  private async sendMagicPacket(mac: string): Promise<void> {
    const bytes = Buffer.from(mac.split(/[-:]/).map((part) => Number.parseInt(part, 16)));
    const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
    const local = this.network.localAddress();
    const tvIp = this.settings.get('tvIp');
    const targets = [...new Set(['255.255.255.255', ...(local ? [local.replace(/\.\d+$/, '.255')] : []), ...(tvIp ? [tvIp] : [])])];
    const socket = createSocket('udp4');
    try {
      await new Promise<void>((resolve) => { socket.bind(0, local ?? undefined, resolve); });
      socket.setBroadcast(true);
      for (let round = 0; round < 3; round++) {
        await Promise.all(targets.flatMap((target) => WAKE_PORTS.map((port) => new Promise<void>((resolve) => {
          socket.send(packet, port, target, () => { resolve(); });
        }))));
        await sleep(300);
      }
    } finally {
      socket.close();
    }
  }

  /** Mientras prende, se revisa seguido: así la tele aparece apenas el tele está listo. */
  private checkWhileTurningOn(): void {
    if (this.wakeCheck) return;
    this.wakeCheck = true;
    const until = Date.now() + WAKE_CHECK_FOR_MS;
    const tick = async (): Promise<void> => {
      if (this.on || Date.now() > until) {
        this.wakeCheck = false;
        return;
      }
      await this.checkOn().catch(() => false);
      setTimeout(() => void tick(), WAKE_CHECK_EVERY_MS).unref();
    };
    void tick();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
