import { spawn, type ChildProcessByStdio } from 'child_process';
import { join } from 'path';
import { createInterface } from 'readline';
import type { Readable, Writable } from 'stream';
import type { InputLock, Logger, PointerSurface } from '../../domain/ports';
import { SM, win32 } from './win32';

/** Ancho de referencia (en píxeles) para el que está calibrada la velocidad del cursor. */
const REFERENCE_WIDTH = 1366;

type Helper = ChildProcessByStdio<Writable, Readable, null>;

/** Un canal que contesta una línea por pedido (lo usa el volumen). */
export interface LineChannel {
  request(command: string): Promise<string | null>;
}

/**
 * El ÚNICO ayudante nativo, native/input-host.ps1 (C#), en un solo proceso para gastar menos memoria:
 *   - dibuja la flecha del cursor como una ventana transparente de Windows (fluida, aparte de Edge),
 *     mueve el cursor real y hace los clics;
 *   - "modo tele": bloquea el mouse físico y mantiene la tele siempre al frente;
 *   - cambia el volumen del sonido que sale por el HDMI (única orden que contesta).
 * Queda abierto y recibe órdenes por línea; si se cae, se reabre solo y recupera lo que sabía.
 */
export class InputHost implements LineChannel {
  private process: Helper | null = null;
  private locked = false;
  private tvPid = 0;
  private readonly waiting: ((line: string | null) => void)[] = [];

  constructor(private readonly scriptsDir: string, private readonly log: Logger) {}

  send(command: string): void {
    this.ensure().stdin.write(`${command}\n`);
  }

  /** Manda una orden que tiene respuesta (las de volumen) y espera esa línea. */
  request(command: string): Promise<string | null> {
    const helper = this.ensure();
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      helper.stdin.write(`${command}\n`);
    });
  }

  /** El proceso de Edge que hace de tele: el bloqueo sólo actúa con su ventana al frente. */
  setTvProcess(pid: number): void {
    this.tvPid = pid;
    this.send(`tvpid ${String(pid)}`);
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    this.send(locked ? 'lock' : 'unlock');
  }

  private ensure(): Helper {
    if (this.process) return this.process;
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(this.scriptsDir, 'input-host.ps1')], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      this.waiting.shift()?.(line);
    });
    child.on('exit', () => {
      if (this.process !== child) return;
      this.process = null;
      for (const resolve of this.waiting.splice(0)) resolve(null);
      this.log.warn('El ayudante nativo se cerró; se reabre en el próximo uso');
    });
    child.stdin.on('error', () => {
      // si se cerró justo mientras escribíamos, el "exit" ya lo maneja
    });
    this.process = child;
    // Si se reabrió, recupera lo que sabía: cuál es la ventana de la tele y si estaba bloqueado.
    if (this.tvPid !== 0) child.stdin.write(`tvpid ${String(this.tvPid)}\n`);
    if (this.locked) child.stdin.write('lock\n');
    return child;
  }
}

/** El cursor propio (puerto PointerSurface) hecho con el ayudante nativo. */
export class NativePointer implements PointerSurface {
  private readonly scale = win32.getSystemMetrics(SM.CXSCREEN) / REFERENCE_WIDTH;

  constructor(private readonly host: InputHost) {}

  moveBy(dx: number, dy: number): Promise<void> {
    this.host.send(`move ${(dx * this.scale).toFixed(2)} ${(dy * this.scale).toFixed(2)}`);
    return Promise.resolve();
  }

  click(): Promise<void> {
    this.host.send('click');
    return Promise.resolve();
  }

  /** El ayudante reparte el desplazamiento en pasitos, cuadro a cuadro (scroll suave). */
  wheel(deltaY: number, deltaX: number): Promise<void> {
    this.host.send(`wheel ${deltaY.toFixed(1)} ${deltaX.toFixed(1)}`);
    return Promise.resolve();
  }

  hide(): void {
    this.host.send('hide');
  }
}

/**
 * Modo tele (puerto InputLock): mouse físico bloqueado y la tele siempre al frente.
 * [enabled] = false es el "modo prueba" (para trabajar en la notebook sin que la tele la tape).
 */
export class NativeInputLock implements InputLock {
  constructor(private readonly host: InputHost, private readonly log: Logger, private readonly enabled: boolean) {}

  lock(): void {
    if (!this.enabled) return;
    this.host.setLocked(true);
    this.log.info('Modo tele: mouse bloqueado y la tele siempre al frente');
  }

  unlock(): void {
    this.host.setLocked(false);
    this.log.info('Escritorio: mouse liberado y la tele ya no se fuerza al frente');
  }
}
