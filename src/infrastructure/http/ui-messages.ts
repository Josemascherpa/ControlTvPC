import { asRecord, asString, parseJson } from '../storage/json';

/** Valida lo que manda la pantalla de inicio. Devuelve null si no es un pedido conocido. */
export function parseUiCommand(text: string): Contracts.UiToServer | null {
  const data = asRecord(parseJson(text));
  switch (data['type']) {
    case 'open': {
      const id = asString(data['id']);
      return id ? { type: 'open', id } : null;
    }
    case 'openUrl': {
      const url = asString(data['url']);
      return /^https?:\/\//.test(url) ? { type: 'openUrl', url } : null;
    }
    case 'show': return { type: 'show' };
    case 'forgetPhones': return { type: 'forgetPhones' };
    case 'toggleNewPhones': return { type: 'toggleNewPhones' };
    case 'reloadApps': return { type: 'reloadApps' };
    case 'screenOff': return { type: 'screenOff' };
    case 'quit': return { type: 'quit' };
    case 'setHomeApps': {
      const raw = data['ids'];
      const ids = Array.isArray(raw) ? (raw as readonly unknown[]).filter((id): id is string => typeof id === 'string').slice(0, 60) : [];
      return { type: 'setHomeApps', ids };
    }
    default: return null;
  }
}
