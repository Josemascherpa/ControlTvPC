/** Pedidos a internet con tiempo límite. Devuelven unknown: quien los usa valida lo que llega. */

const TIMEOUT_MS = 10_000;

export async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'ControlTvPC/2.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

export async function getText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

export async function getBytes(url: string, timeoutMs = 30_000): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
