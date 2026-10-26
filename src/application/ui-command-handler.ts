import type { AppCatalog, InputLock, SettingsStore, TvScreen } from '../domain/ports';
import type { PhoneAccess } from './phone-access';
import type { PowerService } from './power-service';
import type { UiStateService } from './ui-state';

/** Lo que pide la pantalla de inicio (abrir una app, ajustes…). */
export class UiCommandHandler {
  constructor(
    private readonly screen: TvScreen,
    private readonly apps: AppCatalog,
    private readonly access: PhoneAccess,
    private readonly power: PowerService,
    private readonly inputLock: InputLock,
    private readonly state: UiStateService,
    private readonly settings: SettingsStore,
  ) {}

  async handle(command: Contracts.UiToServer): Promise<void> {
    this.power.touch();
    switch (command.type) {
      case 'open': {
        const app = this.apps.find(command.id);
        if (app) await this.screen.openApp(app);
        return;
      }
      case 'openUrl': return this.screen.openUrl(command.url);
      case 'show': return this.power.wake();
      case 'forgetPhones':
        this.access.forgetAll();
        this.state.publishSoon();
        return;
      case 'toggleNewPhones':
        this.access.toggleAllowNew();
        this.state.publishSoon();
        return;
      case 'reloadApps':
        this.apps.reload();
        this.state.publishSoon();
        return;
      case 'setHomeApps': {
        // Sólo apps que existen, sin repetir, en el orden pedido.
        const ids = [...new Set(command.ids)].filter((id) => this.apps.find(id) !== undefined);
        this.settings.set('homeApps', ids);
        this.state.publishSoon();
        return;
      }
      case 'toggleGpu':
        this.settings.set('gpu', this.settings.get('gpu') === 'integrated' ? 'dedicated' : 'integrated');
        this.state.publishSoon();
        return this.screen.restart();
      case 'screenOff': return this.power.turnOff();
      case 'quit':
        this.inputLock.unlock(); // en el escritorio de Windows el mouse vuelve a andar
        return this.screen.closeToDesktop();
    }
  }
}
