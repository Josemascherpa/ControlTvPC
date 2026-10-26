import { connect as tcpConnect } from 'net';
import WebSocket from 'ws';
import type { Logger, SettingsStore } from '../../domain/ports';
import { Signal } from '../../domain/signal';
import { asNumber, asRecord, asString, isRecord, parseJson } from '../storage/json';
import { wsText } from '../ws-text';

// El tele LG (webOS) por WiFi, con su protocolo "SSAP" sobre WebSocket (puertos 3001/3000): el
// mismo que usa la app ControlTv del celular con las LG. Acá se usa sólo para el volumen.
// La primera vez el tele muestra "¿Permitir?" y devuelve una llave (client-key) que se guarda.

const PORTS = [3001, 3000] as const;
const PAIRING_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const REGISTER_ID = 'register_0';
const VOLUME_SUBSCRIPTION_ID = 'volume_sub';
const PERMISSIONS = ['CONTROL_AUDIO', 'READ_INSTALLED_APPS', 'CONTROL_POWER'] as const;

export type LgStatus = 'disconnected' | 'searching' | 'waiting-accept' | 'connected';

interface Pending {
  readonly resolve: (payload: Readonly<Record<string, unknown>>) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export class LgTvClient {
  readonly statusChanged = new Signal<LgStatus>();
  /** El tele avisa cada vez que cambia su volumen (también si lo cambian con su propio control). */
  readonly volumeChanged = new Signal<Contracts.VolumeState>();

  private ws: WebSocket | null = null;
  private status: LgStatus = 'disconnected';
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private registered: ((ok: boolean) => void) | null = null;
  private volume: Contracts.VolumeState | null = null;

  constructor(private readonly settings: SettingsStore, private readonly log: Logger) {}

  get isConnected(): boolean {
    return this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  get currentVolume(): Contracts.VolumeState | null {
    return this.volume;
  }

  /** Se conecta al tele en esa IP y se registra (la primera vez espera el "¿Permitir?"). */
  async connect(ip: string): Promise<void> {
    this.ws = await openSocket(ip);
    const ws = this.ws;
    ws.on('message', (data: WebSocket.RawData) => {
      this.onMessage(wsText(data));
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('disconnected');
    });
    ws.on('error', () => {
      // el "close" que viene después ya avisa
    });

    const accepted = new Promise<boolean>((resolve) => {
      this.registered = resolve;
      setTimeout(() => { resolve(false); }, PAIRING_TIMEOUT_MS).unref();
    });
    ws.send(JSON.stringify(this.registerMessage()));
    if (!(await accepted)) {
      ws.close();
      throw new Error('el tele no aceptó el permiso');
    }
    this.setStatus('connected');
    this.log.info('Tele LG conectado en', ip);
    ws.send(JSON.stringify({ type: 'subscribe', id: VOLUME_SUBSCRIPTION_ID, uri: 'ssap://audio/getVolume' }));
  }

  async volumeUp(): Promise<void> {
    await this.request('ssap://audio/volumeUp');
  }

  async volumeDown(): Promise<void> {
    await this.request('ssap://audio/volumeDown');
  }

  async setMute(mute: boolean): Promise<void> {
    await this.request('ssap://audio/setMute', { mute });
  }

  /** Apaga el tele (permiso CONTROL_POWER). */
  async turnOff(): Promise<void> {
    await this.request('ssap://system/turnOff');
  }

  async readVolume(): Promise<Contracts.VolumeState | null> {
    this.updateVolume(await this.request('ssap://audio/getVolume'));
    return this.volume;
  }

  setStatus(status: LgStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusChanged.emit(status);
  }

  private registerMessage(): Readonly<Record<string, unknown>> {
    const key = this.settings.get('tvClientKey');
    return {
      type: 'register',
      id: REGISTER_ID,
      payload: {
        forcePairing: false,
        pairingType: 'PROMPT',
        manifest: { manifestVersion: 1, appVersion: '1.0', permissions: PERMISSIONS },
        ...(key ? { 'client-key': key } : {}),
      },
    };
  }

  private request(uri: string, payload?: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>> {
    const ws = this.ws;
    if (!this.isConnected || !ws) return Promise.reject(new Error('el tele no está conectado'));
    const id = `req_${String(this.nextId++)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('el tele no contestó'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify(payload ? { type: 'request', id, uri, payload } : { type: 'request', id, uri }));
    });
  }

  private onMessage(text: string): void {
    const message = parseJson(text);
    if (!isRecord(message)) return;
    const id = asString(message['id']);
    const type = asString(message['type']);
    const payload = asRecord(message['payload']);

    if (id === REGISTER_ID) {
      if (type === 'registered') {
        const key = asString(payload['client-key']);
        if (key) this.settings.set('tvClientKey', key);
        this.registered?.(true);
      } else if (type === 'response' && payload['pairingType'] === 'PROMPT') {
        this.setStatus('waiting-accept'); // el tele está mostrando "¿Permitir?"
      } else if (type === 'error') {
        this.registered?.(false);
      }
      return;
    }
    if (id === VOLUME_SUBSCRIPTION_ID) {
      this.updateVolume(payload);
      return;
    }
    const call = this.pending.get(id);
    if (!call) return;
    this.pending.delete(id);
    clearTimeout(call.timer);
    if (type === 'error') call.reject(new Error(asString(message['error'], 'error del tele')));
    else call.resolve(payload);
  }

  // Los webOS viejos mandan {volume, muted}; los nuevos {volumeStatus: {volume, muteStatus}}.
  private updateVolume(payload: Readonly<Record<string, unknown>>): void {
    const status = isRecord(payload['volumeStatus']) ? payload['volumeStatus'] : payload;
    if (typeof status['volume'] !== 'number') return;
    const muted = status['muteStatus'] ?? status['muted'] ?? payload['mute'];
    this.volume = { level: asNumber(status['volume']), muted: muted === true };
    this.volumeChanged.emit(this.volume);
  }
}

/** Abre el WebSocket del tele: primero el seguro (3001), si no el común (3000). */
async function openSocket(ip: string): Promise<WebSocket> {
  const tryOpen = (url: string): Promise<WebSocket> => new Promise((resolve, reject) => {
    // Los teles usan certificados propios (autofirmados): sólo hablamos con la red local.
    const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 4000 });
    ws.once('open', () => { resolve(ws); });
    ws.once('error', reject);
  });
  try {
    return await tryOpen(`wss://${ip}:3001`);
  } catch {
    return tryOpen(`ws://${ip}:3000`);
  }
}

/** true si en esa IP responde alguno de los puertos del LG. */
export async function looksLikeLg(ip: string): Promise<boolean> {
  for (const port of PORTS) if (await isPortOpen(ip, port)) return true;
  return false;
}

function isPortOpen(ip: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tcpConnect({ host: ip, port });
    const done = (open: boolean): void => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => { done(false); });
    socket.once('connect', () => { done(true); });
    socket.once('error', () => { done(false); });
  });
}

/** Recorre la red (x.x.x.1 … x.x.x.254) buscando un LG. Devuelve su IP o null. */
export async function findLgTv(localIp: string): Promise<string | null> {
  const prefix = localIp.split('.').slice(0, 3).join('.');
  const queue = Array.from({ length: 254 }, (_, i) => `${prefix}.${String(i + 1)}`).filter((ip) => ip !== localIp);
  let found: string | null = null;
  const worker = async (): Promise<void> => {
    for (let ip = queue.shift(); ip !== undefined && found === null; ip = queue.shift()) {
      if (await looksLikeLg(ip)) found = ip;
    }
  };
  await Promise.all(Array.from({ length: 48 }, worker));
  return found;
}
