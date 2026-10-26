import { networkInterfaces } from 'os';
import type { NetworkInfo } from '../../domain/ports';

/** La IP de la notebook en el WiFi de la casa (ignora Tailscale, VPNs y adaptadores virtuales). */
export class OsNetwork implements NetworkInfo {
  localAddress(): string | null {
    for (const [name, list] of Object.entries(networkInterfaces())) {
      if (/tailscale|vethernet|virtual|vmware|loopback/i.test(name)) continue;
      const v4 = (list ?? []).find((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));
      if (v4 && !v4.address.startsWith('100.')) return v4.address;
    }
    return null;
  }
}
