import { spawn, type ChildProcessByStdio } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import type { Readable, Writable } from 'stream';
import type { InputLock, Logger, PointerSurface } from '../../domain/ports';
import { SM, win32 } from './win32';

/** Ancho de referencia (en píxeles) para el que está calibrada la velocidad del cursor. */
const REFERENCE_WIDTH = 1366;
/** Si el ayudante no contesta una pregunta en este tiempo, se sigue sin la respuesta. */
const REQUEST_TIMEOUT_MS = 3000;

/** Una pregunta esperando su línea de respuesta (las respuestas llegan en el mismo orden). */
interface Waiting {
  resolve: (line: string | null) => void;
  /** Ya se respondió (por tiempo vencido): la línea que llegue tarde se descarta en su lugar. */
  done: boolean;
}

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
  private readonly waiting: Waiting[] = [];
  /** Movimiento del puntero acumulado mientras el canal está lleno (se suman, no se encolan). */
  private pendingMove: { dx: number; dy: number } | null = null;

  constructor(private readonly scriptsDir: string, private readonly log: Logger) {}

  send(command: string): void {
    this.ensure().stdin.write(`${command}\n`);
  }

  /**
   * Movimiento relativo del puntero. Si el ayudante se atrasa (canal lleno), los movimientos se
   * suman y se mandan juntos cuando se libera: nunca se acumula una cola de movimientos viejos.
   */
  move(dx: number, dy: number): void {
    const helper = this.ensure();
    if (this.pendingMove) {
      this.pendingMove.dx += dx;
      this.pendingMove.dy += dy;
      return;
    }
    if (helper.stdin.writableNeedDrain) {
      this.pendingMove = { dx, dy };
      helper.stdin.once('drain', () => {
        const move = this.pendingMove;
        this.pendingMove = null;
        if (move) this.move(move.dx, move.dy);
      });
      return;
    }
    helper.stdin.write(`move ${dx.toFixed(2)} ${dy.toFixed(2)}\n`);
  }

  /** Manda una orden que tiene respuesta (volumen, nivel de sonido) y espera esa línea (con tiempo máximo). */
  request(command: string): Promise<string | null> {
    const helper = this.ensure();
    return new Promise((resolve) => {
      const entry: Waiting = { resolve, done: false };
      this.waiting.push(entry);
      setTimeout(() => {
        if (entry.done) return;
        entry.done = true;
        resolve(null);
      }, REQUEST_TIMEOUT_MS).unref();
      helper.stdin.write(`${command}\n`);
    });
  }

  /** El nivel de lo que está sonando ahora (0 a 1), o null si no se pudo leer. */
  async audioPeak(): Promise<number | null> {
    const line = await this.request('peak');
    const value = line === null ? NaN : Number.parseFloat(line);
    return Number.isFinite(value) && value >= 0 ? value : null;
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
    // Lo normal: el .exe compilado una vez (build-native.ps1), que arranca en ~0,3 s. Si no está, el
    // .ps1 compila el mismo código al vuelo (~2,5 s).
    const exe = join(this.scriptsDir, 'input-host.exe');
    const [command, args] = existsSync(exe)
      ? [exe, []]
      : ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(this.scriptsDir, 'input-host.ps1')]];
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    createInterface({ input: child.stdout }).on('line', (line) => {
      const entry = this.waiting.shift();
      if (entry && !entry.done) {
        entry.done = true;
        entry.resolve(line);
      }
    });
    child.on('exit', () => {
      if (this.process !== child) return;
      this.process = null;
      for (const entry of this.waiting.splice(0)) if (!entry.done) entry.resolve(null);
      this.pendingMove = null;
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
    this.host.move(dx * this.scale, dy * this.scale);
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
