import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

/** Carpeta del programa (donde están ui/, native/, runtime/). dist/src/config → raíz. */
export const ROOT = resolve(__dirname, '..', '..', '..');

const DATA = join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'ControlTvPC');

/** Lo que guarda el servicio, fuera de la carpeta del programa (lo del Cine lo guarda el navegador). */
export const PATHS = {
  data: DATA,
  settings: join(DATA, 'config.json'),
  edgeProfile: join(DATA, 'edge-perfil'),
  logs: join(DATA, 'logs'),
  /** El Cine: la app completa (se puede llevar tal cual a otro lado). */
  ui: join(ROOT, 'ui'),
  injectScript: join(ROOT, 'ui', 'js', 'web', 'inject.js'),
  nativeScripts: join(ROOT, 'native'),
} as const;

for (const dir of [PATHS.data, PATHS.logs]) mkdirSync(dir, { recursive: true });

export const PORTS = {
  /** La app del celular busca las Samsung en este puerto: respondemos ahí "en Samsung". */
  server: 8001,
  /** DevTools de Edge (sólo escucha en 127.0.0.1). */
  devtools: 9333,
} as const;

export const HOME_URL = `http://127.0.0.1:${PORTS.server}/`;
