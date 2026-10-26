import type { Overlay } from '../../domain/ports';
import type { EdgeConnection } from './edge-connection';

type OverlayCall = { [K in keyof Contracts.Overlay]: { fn: K; arg: Parameters<Contracts.Overlay[K]>[0] } }[keyof Contracts.Overlay];

/**
 * Lo que se dibuja arriba de cualquier página (avisos y volumen). Lo dibuja inject.js
 * adentro de la página; acá sólo se le pide. No se espera la respuesta: es instantáneo y si una
 * página no lo tiene (ej. una página de error) simplemente no se ve.
 */
export class EdgeOverlay implements Overlay {
  constructor(private readonly edge: EdgeConnection) {}

  toast(text: string, icon: string): void {
    this.call({ fn: 'toast', arg: { text, icon } });
  }

  showVolume(volume: Contracts.VolumeState): void {
    this.call({ fn: 'volume', arg: volume });
  }

  private call({ fn, arg }: OverlayCall): void {
    if (!this.edge.isReady) return;
    const expression = `window.__controlTv && window.__controlTv.${fn}(${JSON.stringify(arg)})`;
    this.edge.page('Runtime.evaluate', { expression }).catch(() => undefined);
  }
}
