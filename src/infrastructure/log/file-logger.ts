import { appendFile, renameSync, statSync } from 'fs';
import { join } from 'path';
import type { Logger } from '../../domain/ports';

const MAX_BYTES = 2 * 1024 * 1024;

/** Escribe a la consola y a logs/servicio.log (se rota a los 2 MB). Escribe sin bloquear. */
export class FileLogger implements Logger {
  private readonly file: string;

  constructor(dir: string) {
    this.file = join(dir, 'servicio.log');
    this.rotate();
  }

  info(...parts: readonly unknown[]): void {
    this.write('INFO', parts);
  }

  warn(...parts: readonly unknown[]): void {
    this.write('WARN', parts);
  }

  error(...parts: readonly unknown[]): void {
    this.write('ERROR', parts);
  }

  private write(level: string, parts: readonly unknown[]): void {
    const text = parts.map((part) => (part instanceof Error ? (part.stack ?? part.message) : String(part))).join(' ');
    const line = `${new Date().toISOString()} ${level} ${text}`;
    console.log(line);
    appendFile(this.file, `${line}\n`, () => {
      // si no se puede escribir el log, no frenamos la app por eso
    });
  }

  private rotate(): void {
    try {
      if (statSync(this.file).size > MAX_BYTES) renameSync(this.file, `${this.file}.1`);
    } catch {
      // todavía no existe
    }
  }
}
