import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

/** Carpeta del programa (donde están ui/, native/, runtime/). dist/config → raíz. */
export const ROOT = resolve(__dirname, '..', '..');

const DATA = join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'ControlTvPC');

/** Lo que guarda la app, fuera de la carpeta del programa. */
export const PATHS = {
  data: DATA,
  settings: join(DATA, 'config.json'),
  customApps: join(DATA, 'apps.json'),
  appsExample: join(DATA, 'apps.ejemplo.json'),
  homeCache: join(DATA, 'cache', 'inicio.json'),
  backgrounds: join(DATA, 'cache', 'fondos'),
  icons: join(DATA, 'cache', 'iconos'),
  edgeProfile: join(DATA, 'edge-perfil'),
  logs: join(DATA, 'logs'),
  ui: join(ROOT, 'ui'),
  bundledIcons: join(ROOT, 'ui', 'app-icons'),
  injectScript: join(ROOT, 'ui', 'js', 'inject.js'),
  nativeScripts: join(ROOT, 'native'),
} as const;

for (const dir of [PATHS.data, PATHS.backgrounds, PATHS.icons, PATHS.logs]) mkdirSync(dir, { recursive: true });

export const PORTS = {
  /** La app del celular busca las Samsung en este puerto: respondemos ahí "en Samsung". */
  server: 8001,
  /** DevTools de Edge (sólo escucha en 127.0.0.1). */
  devtools: 9333,
} as const;

export const HOME_URL = `http://127.0.0.1:${PORTS.server}/`;
