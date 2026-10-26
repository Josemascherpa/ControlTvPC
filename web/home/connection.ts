// Conexión en vivo con el servicio (ws://…/ui) y pedidos de datos. Se reconecta sola.

type Listener<T> = (value: T) => void;

export class ServiceConnection {
  private socket: WebSocket | null = null;
  private readonly stateListeners = new Set<Listener<Contracts.UiState>>();
  private readonly menuListeners = new Set<Listener<void>>();

  connect(): void {
    const socket = new WebSocket(`ws://${location.host}/ui`);
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      // Viene de nuestro propio servicio, que arma estos mensajes con el mismo contrato.
      const message = JSON.parse(event.data) as Contracts.ServerToUi;
      if (message.type === 'state') for (const fn of this.stateListeners) fn(message.state);
      else for (const fn of this.menuListeners) fn();
    });
    socket.addEventListener('close', () => {
      setTimeout(() => { this.connect(); }, 1500);
    });
    this.socket = socket;
  }

  onState(listener: Listener<Contracts.UiState>): void {
    this.stateListeners.add(listener);
  }

  onMenu(listener: Listener<void>): void {
    this.menuListeners.add(listener);
  }

  send(command: Contracts.UiToServer): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(command));
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return (await res.json()) as T; // lo arma nuestro servicio con el mismo contrato
}

export const api = {
  home: (): Promise<Contracts.HomeSnapshot> => getJson('/api/home'),
  apps: (): Promise<readonly Contracts.AppTile[]> => getJson('/api/apps'),
};
