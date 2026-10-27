import type { EdgeConnection } from './edge-connection';

/** ¿Hay un video o música reproduciéndose en la página que está abierta en la tele? */
export class EdgeMedia {
  constructor(private readonly edge: EdgeConnection) {}

  async isPlaying(): Promise<boolean> {
    if (!this.edge.isReady) return false; // Edge cerrado: no hay nada reproduciéndose en la tele
    try {
      const { result } = await this.edge.page('Runtime.evaluate', {
        // Buffering también cuenta: bajar la CPU mientras carga agrava el problema.
        expression: "[...document.querySelectorAll('video, audio')].some((m) => !m.paused && !m.ended)"
          + " || (navigator.mediaSession && navigator.mediaSession.playbackState === 'playing')",
        returnByValue: true,
      });
      return result.value === true;
    } catch {
      return true; // si Edge no contesta, no se sabe: mejor no pasar a ahorro en medio de un video
    }
  }
}
