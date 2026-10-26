import { constants, setPriority } from 'os';
import type { Logger } from '../../domain/ports';

/**
 * Sube un poco la prioridad de los procesos que dibujan la tele (Edge y su proceso de video), así
 * no se traban si Windows hace algo en segundo plano (actualizaciones, antivirus…).
 * "Por encima de lo normal", no "tiempo real": no le quita lugar a Windows.
 */
export function boostProcesses(pids: readonly number[], log: Logger): void {
  for (const pid of pids) {
    try {
      setPriority(pid, constants.priority.PRIORITY_ABOVE_NORMAL);
    } catch (error: unknown) {
      log.warn(`No se pudo subir la prioridad del proceso ${String(pid)}:`, error);
    }
  }
}
