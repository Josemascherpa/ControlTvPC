import { readFile } from 'fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { extname, join, normalize } from 'path';
import type { Duplex } from 'stream';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import type { PhoneHandshake, RemoteCommand } from '../../domain/remote';
import type { Logger } from '../../domain/ports';
import {
  decodeClientName, parseSamsungMessage, SAMSUNG_INFO_PATHS, SAMSUNG_REMOTE_PATH, samsungDeviceInfo, samsungMessages,
  type HdmiTvInfo,
} from './samsung-protocol';
import { wsText } from '../ws-text';

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json',
  '.woff2': 'font/woff2', '.webp': 'image/webp', '.ico': 'image/x-icon',
};
const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PING_MS = 15_000;

/** Quien decide qué celulares entran (el servidor sólo guarda la sesión y la devuelve al cerrar). */
export interface PhoneGateway<S extends { readonly token: string }> {
  connect(handshake: PhoneHandshake): S | null;
  disconnect(session: S): void;
}

/** Lo que el servidor necesita del resto de la app (inyectado desde app.ts). */
export interface TvServerDeps<S extends { readonly token: string }> {
  readonly port: number;
  /** La carpeta del Cine (la app completa: html, css, js, fuentes, hls.js). */
  readonly uiDir: string;
  readonly deviceName: () => string;
  readonly localAddress: () => string | null;
  readonly hdmiTv: () => HdmiTvInfo;
  readonly phones: PhoneGateway<S>;
  readonly onRemoteCommand: (command: RemoteCommand) => Promise<void>;
  /** El acceso directo del escritorio pide ver la tele (ControlTv ya estaba corriendo). */
  readonly onShow: () => Promise<void>;
  readonly log: Logger;
}

type AliveSocket = WebSocket & { alive?: boolean };

type Reply =
  | { readonly kind: 'json'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'file'; readonly file: string; readonly cache: string };

const json = (status: number, body: unknown): Reply => ({ kind: 'json', status, body });
const fileReply = (file: string, cache: string): Reply => ({ kind: 'file', file, cache });

/**
 * Servidor de la notebook. Para la red (el celular) habla como una Samsung; para la propia notebook
 * sirve los archivos del Cine (la app no le pide nada más: consulta internet por su cuenta).
 */
export class TvServer<S extends { readonly token: string }> {
  private readonly http: Server;
  private readonly remoteWss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  constructor(private readonly deps: TvServerDeps<S>) {
    this.http = createServer((req, res) => {
      this.route(req, res).catch((error: unknown) => {
        deps.log.warn('HTTP:', error);
        send(res, 500, { error: 'error interno' });
      });
    });
    this.http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      this.upgrade(req, socket, head);
    });
    this.remoteWss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.onRemote(ws, req);
    });
    // Si un celular desaparece sin cerrar (se fue del WiFi), el ping lo detecta.
    setInterval(() => {
      for (const ws of this.remoteWss.clients as Set<AliveSocket>) {
        if (ws.alive === false) ws.terminate();
        else {
          ws.alive = false;
          ws.ping();
        }
      }
    }, PING_MS).unref();
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.deps.port, '0.0.0.0', () => {
        this.deps.log.info(`Servidor escuchando en el puerto ${this.deps.port}`);
        resolve();
      });
    });
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = this.resolve(req);
    if (reply.kind === 'json') send(res, reply.status, reply.body);
    else await serveFile(res, reply.file, reply.cache);
  }

  /** Decide qué contestar. Separado de cómo se manda, así cada ruta es una línea clara. */
  private resolve(req: IncomingMessage): Reply {
    const { pathname } = new URL(req.url ?? '/', 'http://x');
    const d = this.deps;
    if (SAMSUNG_INFO_PATHS.includes(pathname)) {
      return json(200, samsungDeviceInfo(d.deviceName(), d.localAddress() ?? '127.0.0.1', d.port, d.hdmiTv()));
    }
    if (!isLocal(req)) return json(403, { error: 'sólo desde la notebook' });
    if (pathname === '/api/show' && req.method === 'POST') {
      d.onShow().catch((error: unknown) => { d.log.warn('Mostrar la tele:', error); });
      return json(200, { ok: true });
    }
    const file = normalize(join(d.uiDir, pathname === '/' ? 'index.html' : pathname.slice(1)));
    return file.startsWith(d.uiDir) ? fileReply(file, 'no-cache') : json(403, { error: 'no' });
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const { pathname } = new URL(req.url ?? '/', 'http://x');
    if (pathname === SAMSUNG_REMOTE_PATH) {
      this.remoteWss.handleUpgrade(req, socket, head, (ws) => this.remoteWss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  }

  private onRemote(ws: AliveSocket, req: IncomingMessage): void {
    const query = new URL(req.url ?? '/', 'http://x').searchParams;
    const session = this.deps.phones.connect({
      name: decodeClientName(query.get('name')),
      address: (req.socket.remoteAddress ?? '').replace('::ffff:', ''),
      token: query.get('token'),
    });
    if (!session) {
      ws.send(samsungMessages.unauthorized());
      ws.close();
      return;
    }
    ws.alive = true;
    ws.on('pong', () => {
      ws.alive = true;
    });
    ws.send(samsungMessages.connected(session.token));
    ws.on('message', (data: WebSocket.RawData) => {
      const command = parseSamsungMessage(wsText(data));
      if (!command) return;
      this.deps.onRemoteCommand(command).catch((error: unknown) => {
        this.deps.log.warn('Celular:', error);
      });
    });
    ws.on('close', () => {
      this.deps.phones.disconnect(session);
    });
  }
}

function isLocal(req: IncomingMessage): boolean {
  return LOCAL_ADDRESSES.has(req.socket.remoteAddress ?? '');
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(body));
}

async function serveFile(res: ServerResponse, file: string, cache: string): Promise<void> {
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  } catch {
    send(res, 404, { error: 'no existe' });
  }
}
