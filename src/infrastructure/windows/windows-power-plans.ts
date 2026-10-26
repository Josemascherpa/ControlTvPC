import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PowerMode, PowerPlans } from '../../domain/ports';

const run = promisify(execFile);

/**
 * Qué plan usar para cada modo, en orden de preferencia (se usa el primero que exista):
 *   1. los que crea optimizacion/plan-energia.ps1 ("ControlTv Máximo" / "ControlTv Ahorro");
 *   2. los que ya tenía la notebook ("MAXIMO rendimiento" / "SERVIDOR bajo consumo").
 */
const CANDIDATES: Readonly<Record<PowerMode, readonly string[]>> = {
  performance: ['c07c7c07-a11a-4b0b-9c0c-0000c7a7e001', '1a1a1a1a-0000-4000-8000-00000000aa01'],
  saver: ['c07c7c07-a11a-4b0b-9c0c-0000c7a7e002', '1a1a1a1a-0000-4000-8000-00000000aa02'],
};

/** Cambia el plan de energía activo con powercfg (no necesita permisos de administrador). */
export class WindowsPowerPlans implements PowerPlans {
  private resolved: Readonly<Record<PowerMode, string>> | null = null;

  async available(): Promise<boolean> {
    const { stdout } = await run('powercfg', ['/list'], { windowsHide: true });
    const performance = CANDIDATES.performance.find((guid) => stdout.includes(guid));
    const saver = CANDIDATES.saver.find((guid) => stdout.includes(guid));
    this.resolved = performance && saver ? { performance, saver } : null;
    return this.resolved !== null;
  }

  async activate(mode: PowerMode): Promise<void> {
    if (!this.resolved && !(await this.available())) throw new Error('no están los planes de energía');
    const plan = this.resolved?.[mode];
    if (plan) await run('powercfg', ['/setactive', plan], { windowsHide: true });
  }
}
