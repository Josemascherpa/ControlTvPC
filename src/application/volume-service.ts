import type { Overlay, VolumeControl } from '../domain/ports';
import { Signal } from '../domain/signal';

export type VolumeAction = 'up' | 'down' | 'mute';

/** Cambia el volumen (el sonido que sale por el HDMI) y muestra la barrita arriba de todo. */
export class VolumeService {
  readonly changed = new Signal<Contracts.VolumeState>();

  constructor(
    private readonly volume: VolumeControl,
    private readonly overlay: Overlay,
  ) {}

  get current(): Contracts.VolumeState | null {
    return this.volume.current;
  }

  async refresh(): Promise<void> {
    const state = await this.volume.read();
    if (state) this.changed.emit(state);
  }

  async apply(action: VolumeAction): Promise<void> {
    const state = await this.run(action);
    if (!state) return;
    if (!this.volume.showsOwnIndicator) this.overlay.showVolume(state);
    this.changed.emit(state);
  }

  private run(action: VolumeAction): Promise<Contracts.VolumeState | null> {
    switch (action) {
      case 'up': return this.volume.up();
      case 'down': return this.volume.down();
      case 'mute': return this.volume.toggleMute();
    }
  }
}
