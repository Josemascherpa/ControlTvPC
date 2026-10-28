import type { SettingsStore } from '../../domain/ports';
import { DEFAULT_SETTINGS, type PairedPhone, type Settings } from '../../domain/settings';
import { asArray, asBoolean, asNumber, asRecord, asString, isRecord, readJsonFile, writeJsonFile } from './json';

const asNullableString = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** Configuración guardada en config.json. Lo que falte o esté roto toma el valor por defecto. */
export class SettingsFile implements SettingsStore {
  private values: Settings;

  constructor(private readonly file: string) {
    this.values = parseSettings(readJsonFile(file));
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.values[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.values = { ...this.values, [key]: value };
    writeJsonFile(this.file, this.values);
  }
}

function parseSettings(raw: unknown): Settings {
  const data = asRecord(raw);
  const d = DEFAULT_SETTINGS;
  // Antes los celulares se guardaban como "devices" con "created": se siguen leyendo.
  const phones = asArray(data['phones'] ?? data['devices']).filter(isRecord).map((p): PairedPhone => ({
    token: asString(p['token']),
    name: asString(p['name'], 'Celular'),
    createdAt: asString(p['createdAt'] ?? p['created']),
  })).filter((p) => p.token !== '');
  return {
    name: asString(data['name'], d.name),
    phones,
    allowNewPhones: asBoolean(data['allowNewPhones'], d.allowNewPhones),
    pointerSpeed: asNumber(data['pointerSpeed'], d.pointerSpeed),
    autoOffHours: asNumber(data['autoOffHours'], d.autoOffHours),
    autoPowerPlans: asBoolean(data['autoPowerPlans'], d.autoPowerPlans),
    idleMinutes: asNumber(data['idleMinutes'], d.idleMinutes),
    tvIp: asNullableString(data['tvIp']),
    tvClientKey: asNullableString(data['tvClientKey']),
    tvMac: asNullableString(data['tvMac']),
    tvBrand: asNullableString(data['tvBrand']),
    tvName: asNullableString(data['tvName']),
    gpu: data['gpu'] === 'dedicated' ? 'dedicated' : 'integrated',
  };
}
