import { byId, el } from './dom.js';
import { focusable, type FocusLayer } from './focus.js';

interface SettingsItem {
  readonly title: string;
  readonly subtitle: string;
  readonly run?: () => void;
}

/** El panel de Ajustes, que entra desde la derecha. */
export class SettingsPanel implements FocusLayer {
  readonly name = 'settings';
  private readonly panel = byId('settings');
  private readonly list = byId('settings-list');

  constructor(
    private readonly send: (command: Contracts.UiToServer) => void,
    private readonly onClose: () => void,
  ) {}

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(state: Contracts.UiState): void {
    this.render(state);
    this.panel.hidden = false;
  }

  close(): void {
    this.panel.hidden = true;
  }

  /** Redibuja si está abierto (ej. cambió la cantidad de celulares). */
  refresh(state: Contracts.UiState): void {
    if (this.isOpen) this.render(state);
  }

  /** Una opción por fila (lista vertical). */
  rows(): readonly (readonly HTMLElement[])[] {
    return [...this.list.querySelectorAll<HTMLElement>('.focusable')].map((item) => [item]);
  }

  private render(state: Contracts.UiState): void {
    this.list.replaceChildren(...this.items(state).map((item, i) => {
      const row = el('button', item.run ? 'item' : 'item info');
      row.style.setProperty('--i', String(i));
      row.append(el('span', 't', item.title), el('span', 's', item.subtitle));
      return item.run ? focusable(row, item.run) : row;
    }));
  }

  private items(state: Contracts.UiState): readonly SettingsItem[] {
    return [
      { title: state.name, subtitle: `Dirección en el WiFi: ${state.ip ?? 'sin red'}` },
      state.tv
        ? { title: `Tele: ${state.tv.name}`, subtitle: `MAC ${state.tv.mac} · el celular la usa para prenderlo y apagarlo` }
        : { title: 'Tele: buscándolo en el WiFi…', subtitle: 'Para prenderlo desde el celular tiene que estar en el mismo WiFi' },
      {
        title: state.allowNewPhones ? 'Celulares nuevos: permitidos' : 'Celulares nuevos: bloqueados',
        subtitle: state.allowNewPhones
          ? 'Cualquier celular del WiFi con ControlTv puede conectarse. Elegí para bloquear'
          : 'Sólo entran los que ya se conectaron antes. Elegí para permitir',
        run: () => { this.send({ type: 'toggleNewPhones' }); },
      },
      {
        title: 'Olvidar celulares',
        subtitle: `${state.pairedCount} conectado(s) alguna vez`,
        run: () => { this.send({ type: 'forgetPhones' }); },
      },
      {
        title: state.gpu === 'integrated' ? 'Placa de video: Intel HD (recomendada)' : 'Placa de video: GeForce 840M',
        subtitle: state.gpu === 'integrated'
          ? 'La que sale directo por el HDMI: la respuesta más rápida. Elegí para usar la GeForce'
          : 'Dibuja la GeForce y copia cada imagen a la Intel (un poco más de demora). Elegí para volver a la Intel',
        run: () => { this.send({ type: 'toggleGpu' }); },
      },
      {
        title: 'Apagar la imagen',
        subtitle: 'Se prende de nuevo con cualquier botón del celular',
        run: () => { this.send({ type: 'screenOff' }); },
      },
      {
        title: 'Recargar inicio',
        subtitle: 'Vuelve a leer las apps y los datos',
        run: () => {
          this.send({ type: 'reloadApps' });
          setTimeout(() => { location.reload(); }, 300);
        },
      },
      {
        title: 'Salir al escritorio',
        subtitle: 'El mouse de la notebook vuelve a andar. Se abre sola al conectar el celular',
        run: () => { this.send({ type: 'quit' }); },
      },
      { title: 'Cerrar ajustes', subtitle: '', run: this.onClose },
    ];
  }
}
