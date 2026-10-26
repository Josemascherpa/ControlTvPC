import { execFile } from 'child_process';
import { createSocket } from 'dgram';

// Averigua qué tele está conectado por HDMI y dónde está en el WiFi, sea de la marca que sea:
//   1. el EDID del HDMI dice la marca y el modelo del tele (ej. "GSM" = LG, "LG TV");
//   2. por SSDP/DLNA casi todos los teles del WiFi dicen su marca y modelo; se elige el que coincide;
//   3. su MAC sale de la tabla ARP de Windows (ya la tiene porque recién le hablamos).

/** El tele encontrado en el WiFi. */
export interface LocatedTv {
  readonly ip: string;
  readonly mac: string;
  /** Marca en minúsculas (ej. "lg", "samsung"). */
  readonly brand: string;
  /** Nombre que muestra el tele (ej. "[LG] webOS TV UJ6580"). */
  readonly name: string;
}

/** Lo que dice el HDMI del tele conectado. */
interface HdmiDisplay {
  readonly maker: string;
  readonly name: string;
}

interface SsdpDevice {
  readonly ip: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly friendlyName: string;
  readonly deviceType: string;
}

/** Códigos de fabricante del EDID (PNP ID) → marca. */
const PNP_BRANDS: Readonly<Record<string, string>> = {
  GSM: 'lg', LGE: 'lg', SAM: 'samsung', SEC: 'samsung', SNY: 'sony', PHL: 'philips', TPV: 'philips',
  TCL: 'tcl', HEC: 'hisense', HIS: 'hisense', HSN: 'hisense', SKW: 'skyworth', SKY: 'skyworth',
  TOS: 'toshiba', TSB: 'toshiba', MEI: 'panasonic', PAN: 'panasonic', SHP: 'sharp', VIZ: 'vizio',
  XMI: 'xiaomi', MST: 'tcl', RCA: 'rca', NOB: 'noblex', BGH: 'bgh', HAI: 'haier', JVC: 'jvc',
};

/** Tecnologías de salida del EDID que son un equipo externo (HDMI, DVI, DisplayPort…), no la pantalla de la notebook. */
const EXTERNAL_OUTPUTS = new Set([4, 5, 10, 11, 12, 13]);

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_WAIT_MS = 3000;
const MAC_PATTERN = /([0-9a-f]{2}[-:]){5}[0-9a-f]{2}/i;

export class HdmiTvLocator {
  /** Busca el tele del HDMI en el WiFi. null si no se lo encuentra (apagado, otra red, sin DLNA). */
  async locate(localIp: string): Promise<LocatedTv | null> {
    const display = await readHdmiDisplay();
    if (!display) return null;
    const brand = PNP_BRANDS[display.maker.toUpperCase()] ?? display.name.split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!brand) return null;
    const devices = (await discoverSsdp(localIp)).filter((d) => d.ip !== localIp);
    const best = pickTv(devices, brand, display.name);
    if (!best) return null;
    const mac = await macFromArp(best.ip);
    if (!mac) return null;
    return { ip: best.ip, mac, brand, name: best.friendlyName || best.model || display.name };
  }
}

/** El equipo que más se parece al tele del HDMI (misma marca; mejor si es un reproductor/tele). */
function pickTv(devices: readonly SsdpDevice[], brand: string, hdmiName: string): SsdpDevice | null {
  let best: SsdpDevice | null = null;
  let bestScore = 0;
  const wanted = hdmiName.toLowerCase();
  for (const device of devices) {
    const text = `${device.manufacturer} ${device.model} ${device.friendlyName}`.toLowerCase();
    if (!new RegExp(`\\b${brand}\\b`).test(text)) continue;
    let score = 2;
    if (wanted && text.includes(wanted)) score += 1;
    if (/mediarenderer|dial|tv/i.test(device.deviceType) || /\btv\b/.test(text)) score += 1;
    if (score > bestScore) {
      best = device;
      bestScore = score;
    }
  }
  return best;
}

/** Lee del EDID qué hay conectado por HDMI (con PowerShell: las clases de WMI de los monitores). */
function readHdmiDisplay(): Promise<HdmiDisplay | null> {
  const script = [
    '$c = Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorConnectionParams -ErrorAction SilentlyContinue',
    'Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue | ForEach-Object {',
    '  $m = $_; $p = $c | Where-Object { $_.InstanceName -eq $m.InstanceName } | Select-Object -First 1',
    '  [pscustomobject]@{ maker = -join ($m.ManufacturerName | Where-Object { $_ } | ForEach-Object { [char]$_ });',
    '    name = -join ($m.UserFriendlyName | Where-Object { $_ } | ForEach-Object { [char]$_ }); tech = [int64]$p.VideoOutputTechnology; active = [bool]$m.Active }',
    '} | ConvertTo-Json -Compress',
  ].join('\n');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15_000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(pickExternalDisplay(stdout));
    });
  });
}

function pickExternalDisplay(json: string): HdmiDisplay | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const displays = list.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Readonly<Record<string, unknown>>;
    const maker = typeof record['maker'] === 'string' ? record['maker'] : '';
    const name = typeof record['name'] === 'string' ? record['name'] : '';
    const tech = typeof record['tech'] === 'number' ? record['tech'] : -1;
    return maker ? [{ maker, name, external: EXTERNAL_OUTPUTS.has(tech), active: record['active'] === true }] : [];
  });
  const chosen = displays.find((d) => d.external && d.active) ?? displays.find((d) => d.external);
  return chosen ? { maker: chosen.maker, name: chosen.name } : null;
}

/** Pregunta por SSDP quién hay en la red y lee la descripción (marca, modelo) de cada equipo. */
async function discoverSsdp(localIp: string): Promise<readonly SsdpDevice[]> {
  const locations = new Map<string, string>();
  const socket = createSocket('udp4');
  socket.on('message', (message, remote) => {
    const location = /^location:\s*(.+)$/im.exec(message.toString())?.[1]?.trim();
    if (location && !locations.has(location)) locations.set(location, remote.address);
  });
  try {
    // Atado a la placa del WiFi: si no, la pregunta puede salir por otra (virtual) y nadie contesta.
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, localIp, () => { resolve(); });
    });
    socket.setMulticastInterface(localIp);
    const query = ['M-SEARCH * HTTP/1.1', `HOST: ${SSDP_ADDRESS}:1900`, 'MAN: "ssdp:discover"', 'MX: 2', 'ST: ssdp:all', '', ''].join('\r\n');
    socket.send(query, 1900, SSDP_ADDRESS);
    setTimeout(() => { socket.send(query, 1900, SSDP_ADDRESS); }, 400);
    await new Promise((resolve) => setTimeout(resolve, SSDP_WAIT_MS));
  } catch {
    return [];
  } finally {
    socket.close();
  }
  const devices = await Promise.all([...locations].map(([location, ip]) => describe(location, ip)));
  return devices.filter((d): d is SsdpDevice => d !== null);
}

async function describe(location: string, ip: string): Promise<SsdpDevice | null> {
  try {
    const response = await fetch(location, { signal: AbortSignal.timeout(3000) });
    const xml = await response.text();
    const tag = (name: string): string => new RegExp(`<${name}>([^<]*)</${name}>`, 'i').exec(xml)?.[1]?.trim() ?? '';
    return { ip, manufacturer: tag('manufacturer'), model: tag('modelName'), friendlyName: tag('friendlyName'), deviceType: tag('deviceType') };
  } catch {
    return null;
  }
}

/** La MAC de esa IP según la tabla ARP de Windows, como AA:BB:CC:DD:EE:FF. */
export function macFromArp(ip: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('arp', ['-a', ip], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const line = stdout.split(/\r?\n/).find((l) => l.trim().startsWith(`${ip} `));
      const found = line ? MAC_PATTERN.exec(line)?.[0] : undefined;
      resolve(found ? found.replace(/-/g, ':').toUpperCase() : null);
    });
  });
}

/** true si el equipo contesta un ping (para los teles que no tienen otro protocolo). */
export function answersPing(ip: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ping', ['-n', '1', '-w', '800', ip], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
      resolve(!error && /TTL=/i.test(stdout));
    });
  });
}
