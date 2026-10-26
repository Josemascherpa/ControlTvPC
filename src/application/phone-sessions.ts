import type { PhoneHandshake } from '../domain/remote';
import type { Logger, Overlay } from '../domain/ports';
import { Signal } from '../domain/signal';
import type { PhoneAccess } from './phone-access';
import type { PowerService } from './power-service';

export interface PhoneSession {
  readonly name: string;
  readonly token: string;
}

/** Los celulares conectados ahora. Al conectarse uno, la tele se prende y se trae al frente. */
export class PhoneSessions {
  readonly changed = new Signal<void>();
  private readonly sessions = new Set<PhoneSession>();

  constructor(
    private readonly access: PhoneAccess,
    private readonly power: PowerService,
    private readonly overlay: Overlay,
    private readonly log: Logger,
  ) {}

  get names(): readonly string[] {
    return [...this.sessions].map((session) => session.name);
  }

  /** Devuelve la sesión, o null si el celular no puede entrar. */
  connect(handshake: PhoneHandshake): PhoneSession | null {
    // La app del celular siempre se presenta como "ControlTv": mostramos su IP para distinguirlos.
    const name = handshake.name === 'ControlTv' ? `Celular (${handshake.address})` : handshake.name;
    const token = this.access.admit(handshake.token, name);
    if (token === null) {
      this.log.info('Celular rechazado (están bloqueados los nuevos):', handshake.address);
      this.overlay.toast('Un celular nuevo quiso conectarse. Para permitirlo, andá a Ajustes', '🔒');
      return null;
    }
    const session: PhoneSession = { name, token };
    this.sessions.add(session);
    this.log.info('Celular conectado:', name);
    // Si la tele estaba cerrada o con la imagen apagada, se abre sola al conectar el celular.
    this.power.wake()
      .then(() => {
        this.overlay.toast('Celular conectado', '📱');
      })
      .catch((error: unknown) => {
        this.log.warn('No se pudo mostrar la tele:', error);
      });
    this.changed.emit();
    return session;
  }

  disconnect(session: PhoneSession): void {
    if (this.sessions.delete(session)) this.changed.emit();
  }
}
