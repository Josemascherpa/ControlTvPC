import { createHash, randomUUID } from 'crypto';
import { hostname } from 'os';
import type { RemoteCommand, RemoteKey } from '../../domain/remote';
import { asRecord, asString, isRecord, parseJson } from '../storage/json';

// La app ControlTv del celular sabe manejar teles Samsung. La notebook habla ese mismo idioma,
// así la app la encuentra y la maneja sin ningún cambio. Este archivo es el "traductor":
// lo que llega en Samsung se convierte en un RemoteCommand propio, y nada más sabe de Samsung.

export const SAMSUNG_REMOTE_PATH = '/api/v2/channels/samsung.remote.control';
export const SAMSUNG_INFO_PATHS: readonly string[] = ['/api/v2/', '/api/v2'];

const KEYS: Readonly<Record<string, RemoteKey>> = {
  KEY_POWER: 'POWER', KEY_POWEROFF: 'POWER', KEY_HOME: 'HOME', KEY_RETURN: 'BACK', KEY_MENU: 'MENU',
  KEY_UP: 'UP', KEY_DOWN: 'DOWN', KEY_LEFT: 'LEFT', KEY_RIGHT: 'RIGHT', KEY_ENTER: 'OK',
  KEY_VOLUP: 'VOLUME_UP', KEY_VOLDOWN: 'VOLUME_DOWN', KEY_MUTE: 'MUTE',
  KEY_CHUP: 'CHANNEL_UP', KEY_CHDOWN: 'CHANNEL_DOWN', KEY_PLAY: 'PLAY_PAUSE', KEY_PAUSE: 'PLAY_PAUSE',
};

const DEVICE_ID = `uuid:${createHash('md5').update(hostname()).digest('hex')}`;

/** Traduce un mensaje del celular. Devuelve null si no es algo que sepamos hacer. */
export function parseSamsungMessage(text: string): RemoteCommand | null {
  const message = parseJson(text);
  if (!isRecord(message)) return null;
  const method = message['method'];
  const params = asRecord(message['params']);

  if (method === 'ms.remote.control') {
    switch (params['TypeOfRemote']) {
      case 'SendRemoteKey': {
        const key = KEYS[asString(params['DataOfCmd'])];
        return key ? { kind: 'key', key } : null;
      }
      case 'SendInputString':
        // El texto viene en Base64.
        return { kind: 'text', text: Buffer.from(asString(params['Cmd']), 'base64').toString('utf8') };
      case 'ProcessMouseDevice': {
        // El touchpad de la pestaña "Mouse": Move (cuánto se movió el dedo) y LeftClick.
        if (params['Cmd'] === 'LeftClick') return { kind: 'pointerClick' };
        const position = asRecord(params['Position']);
        const dx = position['x'];
        const dy = position['y'];
        return params['Cmd'] === 'Move' && typeof dx === 'number' && typeof dy === 'number' ? { kind: 'pointerMove', dx, dy } : null;
      }
      default:
        return null;
    }
  }
  // "Abrir página" y las búsquedas: la app pide abrir el navegador de la Samsung con una dirección.
  if (method === 'ms.channel.emit' && params['event'] === 'ed.apps.launch') {
    const url = asString(asRecord(params['data'])['metaTag']);
    return url ? { kind: 'openUrl', url } : null;
  }
  return null;
}

/** La app manda su nombre en Base64 (ej. "ControlTv"). */
export function decodeClientName(base64: string | null): string {
  const name = Buffer.from(base64 ?? '', 'base64').toString('utf8').trim().slice(0, 40);
  return name || 'Celular';
}

export const samsungMessages = {
  connected: (token: string): string =>
    JSON.stringify({ event: 'ms.channel.connect', data: { id: randomUUID(), token, clients: [] } }),
  unauthorized: (): string => JSON.stringify({ event: 'ms.channel.unauthorized' }),
};

/** El tele del HDMI, para que el celular lo pueda prender (su MAC) y sepa si está en espera. */
export interface HdmiTvInfo {
  readonly mac: string | null;
  readonly standby: boolean;
}

/**
 * Lo que contesta una Samsung en /api/v2/. La app del celular usa device.name; guarda wifiMac para
 * prender el tele por la red (Wake-on-LAN): le pasamos la MAC del tele conectado por HDMI. Y si
 * PowerState es "standby", al prender manda el botón de encendido (que acá prende el tele).
 */
export function samsungDeviceInfo(name: string, ip: string, port: number, tv: HdmiTvInfo): Readonly<Record<string, unknown>> {
  return {
    controltv: true, // para reconocernos a nosotros mismos (ver main.ts)
    id: DEVICE_ID,
    name,
    type: 'Samsung SmartTV',
    version: '2.0.25',
    remote: '1.0',
    uri: `http://${ip}:${port}/api/v2/`,
    isSupport: '{"remote_available":"true","remote_fourDirections":"true","remote_touchPad":"true","remote_voiceControl":"false"}',
    device: {
      id: DEVICE_ID, name, type: 'Samsung SmartTV', modelName: 'ControlTv PC', ip,
      networkType: 'wireless', TokenAuthSupport: 'true', PowerState: tv.standby ? 'standby' : 'on', OS: 'Tizen',
      ...(tv.mac ? { wifiMac: tv.mac } : {}),
    },
  };
}
