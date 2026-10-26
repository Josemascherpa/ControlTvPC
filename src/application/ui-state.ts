import type { AppCatalog, NetworkInfo, SettingsStore, UiPublisher } from '../domain/ports';
import type { PhoneAccess } from './phone-access';
import type { PhoneSessions } from './phone-sessions';
import type { VolumeService } from './volume-service';

/** Arma el estado que muestra la pantalla de inicio y se lo manda cada vez que algo cambia. */
export class UiStateService {
  private scheduled = false;

  constructor(
    private readonly settings: SettingsStore,
    private readonly network: NetworkInfo,
    private readonly access: PhoneAccess,
    private readonly sessions: PhoneSessions,
    private readonly volume: VolumeService,
    private readonly publisher: UiPublisher,
    private readonly apps: AppCatalog,
  ) {
    sessions.changed.subscribe(() => {
      this.publishSoon();
    });
    volume.changed.subscribe(() => {
      this.publishSoon();
    });
  }

  current(): Contracts.UiState {
    return {
      name: this.settings.get('name'),
      ip: this.network.localAddress(),
      phones: this.sessions.names,
      pairedCount: this.access.pairedCount,
      allowNewPhones: this.access.allowNew,
      volume: this.volume.current,
      ambientMinutes: this.settings.get('ambientMinutes'),
      homeApps: this.homeApps(),
      gpu: this.settings.get('gpu'),
      tv: this.tv(),
    };
  }

  private tv(): Contracts.UiState['tv'] {
    const mac = this.settings.get('tvMac');
    return mac ? { name: this.settings.get('tvName') ?? 'Tele', mac } : null;
  }

  /** Las apps del inicio que eligió la persona (las que ya no existen se descartan). */
  private homeApps(): readonly string[] {
    const chosen = this.settings.get('homeApps') ?? this.apps.defaultHome();
    return chosen.filter((id) => this.apps.find(id) !== undefined);
  }

  /** Si cambian varias cosas juntas (ej. volumen apretado rápido), se manda un solo aviso. */
  publishSoon(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.publisher.publish({ type: 'state', state: this.current() });
    });
  }
}
