import { lookup, type LookupAddress } from 'dns';
import { Agent, fetch as undiciFetch, type RequestInit as UndiciInit } from 'undici';

// Conexiones a la API del catálogo. Medido en esta red: el DNS de api.framextv.xyz tarda ~830 ms y
// abrir una conexión nueva hasta varios segundos (su servidor atiende lento las conexiones nuevas y
// los pedidos simultáneos); con la conexión ya abierta, cada pedido tarda ~300 ms. Node, por defecto,
// no guarda el DNS y cierra las conexiones a los 4 s sin uso: cada búsqueda pagaba todo de nuevo.
//
// Acá: conexiones que quedan abiertas 60 s, DNS guardado 10 min, sólo IPv4 y pocos pedidos a la vez.

const DNS_TTL_MS = 10 * 60_000;
const dnsCache = new Map<string, { readonly until: number; readonly addresses: LookupAddress[] }>();

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** Igual que dns.lookup, pero recuerda la respuesta un rato. */
function cachedLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback): void {
  const reply = (addresses: LookupAddress[]): void => {
    const first = addresses[0];
    if (options.all) callback(null, addresses);
    else if (first) callback(null, first.address, first.family);
    else callback(Object.assign(new Error(`Sin dirección para ${hostname}`), { code: 'ENOTFOUND' }), '', 4);
  };
  const hit = dnsCache.get(hostname);
  if (hit && hit.until > Date.now()) {
    reply(hit.addresses);
    return;
  }
  // Sólo IPv4: medido en esta red, el IPv6 abre conexiones en 7 s o se traba más de 15 s, mientras
  // que por IPv4 abren en 50–100 ms siempre. Si un sitio no tuviera IPv4, se usa lo que haya.
  lookup(hostname, { all: true, family: 4 }, (error, addresses) => {
    if (error || addresses.length === 0) {
      lookup(hostname, { all: true }, (fallbackError, any) => {
        if (fallbackError) callback(fallbackError, '', 4);
        else {
          dnsCache.set(hostname, { until: Date.now() + DNS_TTL_MS, addresses: any });
          reply(any);
        }
      });
      return;
    }
    dnsCache.set(hostname, { until: Date.now() + DNS_TTL_MS, addresses });
    reply(addresses);
  });
}

const agent = new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 10 * 60_000,
  connections: 4, // pocos a la vez: el servidor de la API atiende mal muchos pedidos simultáneos
  connect: { lookup: cachedLookup, timeout: 10_000 },
});

/** fetch con el pool de conexiones de arriba (mismo uso que el fetch de siempre). */
export const pooledFetch: typeof fetch = (input, init) =>
  undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as UndiciInit | undefined), dispatcher: agent }) as unknown as Promise<Response>;
