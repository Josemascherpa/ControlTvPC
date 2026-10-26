import WebSocket from 'ws';
import { asRecord, asString, isRecord, parseJson } from '../storage/json';
import { wsText } from '../ws-text';
import type { BrowserVersion, CdpEvent, CdpEvents, CdpMethod, CdpParams, CdpResult } from './cdp-protocol';

const CALL_TIMEOUT_MS = 10_000;

interface PendingCall {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Cliente del DevTools Protocol: un WebSocket con mensajes JSON {id, method, params}.
 * Con él manejamos Edge desde Node (navegar, teclas, mouse, scripts). Tipado con cdp-protocol.ts.
 */
export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly listeners = new Map<string, Set<(params: unknown, sessionId: string | null) => void>>();
  private readonly closeListeners = new Set<() => void>();

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (data: WebSocket.RawData) => {
      this.onMessage(wsText(data));
    });
    ws.on('close', () => {
      this.handleClose();
    });
    ws.on('error', () => {
      // el "close" que viene después ya avisa
    });
  }

  static connect(url: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
      ws.once('open', () => {
        resolve(new CdpClient(ws));
      });
      ws.once('error', reject);
    });
  }

  /** Pregunta por HTTP si hay un Edge escuchando en ese puerto. */
  static async probe(port: number): Promise<BrowserVersion | null> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return null;
      const body = asRecord(await res.json());
      const url = asString(body['webSocketDebuggerUrl']);
      return url ? { webSocketDebuggerUrl: url, userAgent: asString(body['User-Agent']) } : null;
    } catch {
      return null;
    }
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  /** Manda un comando y espera la respuesta. sessionId elige la pestaña (sin él, va al navegador). */
  send<M extends CdpMethod>(method: M, params: CdpParams<M>, sessionId?: string): Promise<CdpResult<M>> {
    if (!this.isOpen) return Promise.reject(new Error('Edge no está conectado'));
    const id = this.nextId++;
    return new Promise<CdpResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Edge no contestó: ${method}`));
      }, CALL_TIMEOUT_MS);
      // La respuesta llega como JSON: confiamos en que Edge cumple su propio protocolo.
      this.pending.set(id, { resolve: (result) => { resolve(result as CdpResult<M>); }, reject, timer });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  on<E extends CdpEvent>(event: E, listener: (params: CdpEvents[E], sessionId: string | null) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (params: unknown, sessionId: string | null) => void);
  }

  onClose(listener: () => void): void {
    this.closeListeners.add(listener);
  }

  close(): void {
    this.ws.close();
  }

  private handleClose(): void {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error('Edge se cerró'));
    }
    this.pending.clear();
    for (const listener of this.closeListeners) listener();
  }

  private onMessage(text: string): void {
    const message = parseJson(text);
    if (!isRecord(message)) return;
    const id = message['id'];
    if (typeof id === 'number') {
      const call = this.pending.get(id);
      if (!call) return;
      this.pending.delete(id);
      clearTimeout(call.timer);
      const error = message['error'];
      if (isRecord(error)) call.reject(new Error(asString(error['message'], 'error de Edge')));
      else call.resolve(message['result'] ?? {});
      return;
    }
    const method = message['method'];
    if (typeof method !== 'string') return;
    const sessionId = typeof message['sessionId'] === 'string' ? message['sessionId'] : null;
    for (const listener of this.listeners.get(method) ?? []) listener(message['params'] ?? {}, sessionId);
  }
}
