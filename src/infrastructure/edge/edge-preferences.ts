import { mkdirSync } from 'fs';
import { join } from 'path';
import { asRecord, readJsonFile, writeJsonFile } from '../storage/json';

/** Idiomas que se traducen solos al español (sin el cartel de "¿Traducir esta página?"). */
const AUTO_TRANSLATE_FROM: readonly string[] = ['en', 'pt', 'fr', 'it', 'de', 'ja', 'ko', 'ru', 'zh-CN', 'zh-TW', 'tr', 'pl', 'nl'];
const LANGUAGES = 'es-AR,es,en';

/**
 * Ajustes del perfil de Edge de la tele, escritos ANTES de abrirlo (Edge los lee al arrancar):
 *   - traducción automática al español de las páginas en otros idiomas, sin preguntar;
 *   - español de Argentina como idioma preferido (los sitios que lo tienen se muestran en español).
 * Sólo toca el perfil propio de la tele, nunca el Edge que usa la persona.
 */
export function applyEdgePreferences(profileDir: string): void {
  const dir = join(profileDir, 'Default');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'Preferences');
  const prefs = asRecord(readJsonFile(file));
  const toSpanish = Object.fromEntries(AUTO_TRANSLATE_FROM.map((lang) => [lang, 'es']));
  writeJsonFile(file, {
    ...prefs,
    translate: { ...asRecord(prefs['translate']), enabled: true },
    // Nombre nuevo y viejo de la misma preferencia (según la versión del navegador).
    translate_allowlists: { ...asRecord(prefs['translate_allowlists']), ...toSpanish },
    translate_whitelists: { ...asRecord(prefs['translate_whitelists']), ...toSpanish },
    translate_recent_target: 'es',
    intl: { ...asRecord(prefs['intl']), accept_languages: LANGUAGES, selected_languages: LANGUAGES },
  });
}

/** Opciones de arranque para que Edge y las páginas usen español. */
export const LANGUAGE_FLAGS: readonly string[] = ['--lang=es-AR', `--accept-lang=${LANGUAGES}`];
