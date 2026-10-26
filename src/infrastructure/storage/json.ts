import { readFileSync, renameSync, writeFileSync } from 'fs';

// Todo lo que llega de afuera (archivos, internet, el celular) entra como "unknown" y se valida
// con estas funciones antes de usarlo. Así un dato roto nunca rompe la app.

export type JsonRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? (value as readonly unknown[]) : [];
}

export function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

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
