import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { basename, extname, join, normalize } from 'path';
import type { Duplex } from 'stream';
import type WebSocket from 'ws';
import { WebSocketServer } from 'ws';
import type { PhoneHandshake, RemoteCommand } from '../../domain/remote';
import type { Logger, UiPublisher } from '../../domain/ports';
import {
  decodeClientName, parseSamsungMessage, SAMSUNG_INFO_PATHS, SAMSUNG_REMOTE_PATH, samsungDeviceInfo, samsungMessages,
  type HdmiTvInfo,
} from './samsung-protocol';
import { parseUiCommand } from './ui-messages';
import { wsText } from '../ws-text';

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json',
  '.woff2': 'font/woff2', '.webp': 'image/webp', '.ico': 'image/x-icon',
};
const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PING_MS = 15_000;

/** Lo que el servidor necesita del resto de la app (inyectado desde app.ts). */
/** Quien decide qué celulares entran (el servidor sólo guarda la sesión y la devuelve al cerrar). */
export interface PhoneGateway<S extends { readonly token: string }> {
  connect(handshake: PhoneHandshake): S | null;
  disconnect(session: S): void;
}

export interface TvServerDeps<S extends { readonly token: string }> {
  readonly port: number;
  readonly uiDir: string;
  readonly backgroundsDir: string;
  readonly deviceName: () => string;
  readonly localAddress: () => string | null;
  readonly hdmiTv: () => HdmiTvInfo;
  readonly phones: PhoneGateway<S>;
  readonly onRemoteCommand: (command: RemoteCommand) => Promise<void>;
  readonly onUiCommand: (command: Contracts.UiToServer) => Promise<void>;
  readonly uiState: () => Contracts.UiState;
  readonly home: () => Contracts.HomeSnapshot;
  readonly apps: () => readonly Contracts.AppTile[];
  readonly library?: (params: URLSearchParams) => Promise<Contracts.LibraryReply>;
  /** Trae un archivo de subtítulos (VTT) para el reproductor propio, sin depender de CORS. */
  readonly subtitle?: (url: string) => Promise<string | null>;
  /** Imagen del catálogo guardada en el disco (sólo de TMDB). */
  readonly image?: (url: string) => Promise<{ readonly file: string; readonly type: string } | null>;
  readonly hlsScript?: string;
  readonly iconPath: (appId: string) => Promise<string | null>;
  readonly log: Logger;
}

type AliveSocket = WebSocket & { alive?: boolean };

type Reply =
  | { readonly kind: 'json'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'file'; readonly file: string; readonly cache: string }
  | { readonly kind: 'text'; readonly status: number; readonly type: string; readonly body: string; readonly cache: string; readonly etag?: string };

const json = (status: number, body: unknown): Reply => ({ kind: 'json', status, body });
const fileReply = (file: string, cache: string): Reply => ({ kind: 'file', file, cache });
const textReply = (body: string, type: string, cache: string): Reply => ({ kind: 'text', status: 200, type, body, cache });
/** JSON con huella: si Edge ya tiene esa misma respuesta, se contesta 304 (sin cuerpo) y la reusa. */
const etagged = (body: unknown): Reply => {
  const text = JSON.stringify(body);
  const etag = `"${createHash('sha1').update(text).digest('base64url').slice(0, 16)}"`;
  return { kind: 'text', status: 200, type: 'application/json; charset=utf-8', body: text, cache: 'no-cache', etag };
};

/**
 * Servidor de la notebook. Para la red (el celular) habla como una Samsung; para la propia
 * notebook sirve la pantalla de inicio, sus datos y un canal de avisos en vivo (/ui).
 */
export class TvServer<S extends { readonly token: string }> implements UiPublisher {
  private readonly http: Server;
  private readonly remoteWss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  private readonly uiWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

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
    this.uiWss.on('connection', (ws: WebSocket) => {
      this.onUi(ws);
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

  publish(message: Contracts.ServerToUi): void {
    const text = JSON.stringify(message);
    for (const ws of this.uiWss.clients) if (ws.readyState === ws.OPEN) ws.send(text);
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reply = await this.resolve(req);
    if (reply.kind === 'json') send(res, reply.status, reply.body);
    else if (reply.kind === 'text') {
      if (reply.etag && req.headers['if-none-match'] === reply.etag) {
        res.writeHead(304, { ETag: reply.etag, 'Cache-Control': reply.cache });
        res.end();
        return;
      }
      res.writeHead(reply.status, { 'Content-Type': reply.type, 'Cache-Control': reply.cache, ...(reply.etag ? { ETag: reply.etag } : {}) });
      res.end(reply.body);
    } else await serveFile(res, reply.file, reply.cache);
  }

  /** Decide qué contestar. Separado de cómo se manda, así cada ruta es una línea clara. */
  private async resolve(req: IncomingMessage): Promise<Reply> {
    const { pathname } = new URL(req.url ?? '/', 'http://x');
    const d = this.deps;
    if (SAMSUNG_INFO_PATHS.includes(pathname)) {
      return json(200, samsungDeviceInfo(d.deviceName(), d.localAddress() ?? '127.0.0.1', d.port, d.hdmiTv()));
    }
    if (!isLocal(req)) return json(403, { error: 'sólo desde la notebook' });
    if (pathname === '/api/library' && d.library) return etagged(await d.library(new URL(req.url ?? '/', 'http://x').searchParams));
    if (pathname === '/img' && d.image) {
      const image = await d.image(new URL(req.url ?? '/', 'http://x').searchParams.get('u') ?? '');
      // La misma dirección es siempre la misma imagen: Edge la guarda para siempre y no vuelve a pedirla.
      return image ? fileReply(image.file, 'public, max-age=31536000, immutable') : json(404, { error: 'sin imagen' });
    }
    if (pathname === '/api/subtitle' && d.subtitle) {
      const url = new URL(req.url ?? '/', 'http://x').searchParams.get('url') ?? '';
      const vtt = url ? await d.subtitle(url) : null;
      return vtt ? textReply(vtt, 'text/vtt; charset=utf-8', 'max-age=3600') : json(404, { error: 'sin subtítulos' });
    }
    if (pathname === '/vendor/hls.js' && d.hlsScript) return fileReply(d.hlsScript, 'no-cache');
    if (pathname === '/api/home') return json(200, d.home());
    if (pathname === '/api/apps') return json(200, d.apps());
    if (pathname === '/api/state') return json(200, d.uiState());
    if (pathname.startsWith('/bg/')) return fileReply(join(d.backgroundsDir, basename(pathname)), 'max-age=86400');
    if (pathname.startsWith('/icon/')) {
      const icon = await d.iconPath(basename(pathname, '.png'));
      return icon ? fileReply(icon, 'max-age=86400') : json(404, { error: 'sin ícono' });
    }
    const file = normalize(join(d.uiDir, pathname === '/' ? 'index.html' : pathname.slice(1)));
    return file.startsWith(d.uiDir) ? fileReply(file, 'no-cache') : json(403, { error: 'no' });
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const { pathname } = new URL(req.url ?? '/', 'http://x');
    if (pathname === SAMSUNG_REMOTE_PATH) {
      this.remoteWss.handleUpgrade(req, socket, head, (ws) => this.remoteWss.emit('connection', ws, req));
    } else if (pathname === '/ui' && isLocal(req)) {
      this.uiWss.handleUpgrade(req, socket, head, (ws) => this.uiWss.emit('connection', ws, req));
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

  private onUi(ws: WebSocket): void {
    ws.send(JSON.stringify({ type: 'state', state: this.deps.uiState() } satisfies Contracts.ServerToUi));
    ws.on('message', (data: WebSocket.RawData) => {
      const command = parseUiCommand(wsText(data));
      if (!command) return;
      this.deps.onUiCommand(command).catch((error: unknown) => {
        this.deps.log.warn('Inicio:', error);
      });
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
