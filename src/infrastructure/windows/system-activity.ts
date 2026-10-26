import type { ActivityProbe } from '../../domain/ports';
import { win32 } from './win32';

/**
 * ¿Se está usando la notebook? Junta varias fuentes:
 *   - Windows: cuánto pasó desde el último toque de teclado o mouse (incluye el cursor del celular,
 *     que mueve el mouse de Windows).
 *   - La tele: si hay algo reproduciéndose. Se pregunta de dos formas: a la página ([mediaPlaying]) y
 *     a Windows, si está sonando algo ([audioPeak]). Lo segundo detecta también los reproductores
 *     metidos en iframes de otro sitio (las páginas de películas), que la página no deja ver.
 */
/** Por encima de esto hay sonido de verdad (no el ruido de fondo de la placa). */
const AUDIBLE_PEAK = 0.002;
/** Cuántas veces se mide el sonido (una escena en silencio no tiene que cortar la película). */
const AUDIO_SAMPLES = 4;
const AUDIO_SAMPLE_GAP_MS = 250;

export class SystemActivity implements ActivityProbe {
  constructor(
    private readonly mediaPlaying: () => Promise<boolean>,
    private readonly audioPeak: () => Promise<number | null>,
  ) {}

  msSinceInput(): number {
    const info = { cbSize: 8, dwTime: 0 };
    if (!win32.getLastInputInfo(info)) return 0;
    // Los contadores de Windows dan la vuelta cada ~49 días: ">>> 0" hace bien la resta igual.
    return (win32.getTickCount() - info.dwTime) >>> 0;
  }

  async isMediaPlaying(): Promise<boolean> {
    if (await this.mediaPlaying()) return true;
    for (let i = 0; i < AUDIO_SAMPLES; i++) {
      const peak = await this.audioPeak();
      // Si no se puede saber, se asume que sí: mejor no pasar a ahorro en medio de una película.
      if (peak === null || peak > AUDIBLE_PEAK) return true;
      await new Promise((resolve) => setTimeout(resolve, AUDIO_SAMPLE_GAP_MS));
    }
    return false;
  }
}
