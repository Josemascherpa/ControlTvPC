import type { EdgeConnection } from './edge-connection';

/** ¿Hay un video o música reproduciéndose en la página que está abierta en la tele? */
export class EdgeMedia {
  constructor(private readonly edge: EdgeConnection) {}

  async isPlaying(): Promise<boolean> {
    if (!this.edge.isReady) return false;
    try {
      const { result } = await this.edge.page('Runtime.evaluate', {
        expression: "[...document.querySelectorAll('video, audio')].some((m) => !m.paused && !m.ended && m.readyState > 2)"
          + " || (navigator.mediaSession && navigator.mediaSession.playbackState === 'playing')",
        returnByValue: true,
      });
      return result.value === true;
    } catch {
      return false; // si Edge no contesta, no bloqueamos el ahorro por eso
    }
  }
}
