import { readFileSync, renameSync, writeFileSync } from 'fs';
import { parseJson } from '../../../shared/json';

// Los validadores viven en shared/ (los usa también el Cine); acá sólo lo que toca archivos.
export * from '../../../shared/json';

export function readJsonFile(file: string): unknown {
  try {
    return parseJson(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Escribe a un temporal y lo renombra: si se corta la luz, el archivo no queda a medias. */
export function writeJsonFile(file: string, value: unknown): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}
