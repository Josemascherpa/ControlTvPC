import type { VolumeControl } from '../../domain/ports';
import type { LineChannel } from './input-host';

/** Cuánto sube o baja por cada toque, en %. */
const STEP = 4;

/**
 * Volumen del sonido que la notebook manda al tele por el HDMI (la salida de audio de Windows),
 * cambiado por la API de audio de Windows: no aparece el cartel de volumen de Windows.
 * El trabajo lo hace el ayudante nativo (órdenes "vol …"), que contesta "nivel,silencio" (ej. "45,0").
 */
export class HdmiVolume implements VolumeControl {
  private state: Contracts.VolumeState | null = null;

  constructor(private readonly worker: LineChannel) {}

  readonly showsOwnIndicator = false;

  get current(): Contracts.VolumeState | null {
    return this.state;
  }

  read(): Promise<Contracts.VolumeState | null> {
    return this.send('get');
  }

  up(): Promise<Contracts.VolumeState | null> {
    return this.send(`up ${STEP}`);
  }

  down(): Promise<Contracts.VolumeState | null> {
    return this.send(`down ${STEP}`);
  }

  toggleMute(): Promise<Contracts.VolumeState | null> {
    return this.send('mute');
  }

  private async send(command: string): Promise<Contracts.VolumeState | null> {
    const line = await this.worker.request(`vol ${command}`);
    const match = line === null ? null : /^(\d+),([01])$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      this.state = { level: Number(match[1]), muted: match[2] === '1' };
    }
    return this.state;
  }
}
