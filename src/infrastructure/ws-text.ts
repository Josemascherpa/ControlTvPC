import type WebSocket from 'ws';

/** Un mensaje de WebSocket como texto (la librería lo puede entregar en varios formatos binarios). */
export function wsText(data: WebSocket.RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
