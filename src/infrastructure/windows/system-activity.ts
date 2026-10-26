import type { ActivityProbe } from '../../domain/ports';
import { win32 } from './win32';

/**
 * ¿Se está usando la notebook? Junta dos fuentes:
 *   - Windows: cuánto pasó desde el último toque de teclado o mouse (incluye el cursor del celular,
 *     que mueve el mouse de Windows).
 *   - La tele: si hay algo reproduciéndose (lo pregunta [mediaPlaying], que mira la página abierta).
 */
export class SystemActivity implements ActivityProbe {
  constructor(private readonly mediaPlaying: () => Promise<boolean>) {}

  msSinceInput(): number {
    const info = { cbSize: 8, dwTime: 0 };
    if (!win32.getLastInputInfo(info)) return 0;
    // Los contadores de Windows dan la vuelta cada ~49 días: ">>> 0" hace bien la resta igual.
    return (win32.getTickCount() - info.dwTime) >>> 0;
  }

  isMediaPlaying(): Promise<boolean> {
    return this.mediaPlaying();
  }
}
