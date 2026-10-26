import { byId, el } from './dom.js';
import { focusable, type FocusLayer } from './focus.js';

export interface MenuOption {
  readonly label: string;
  readonly run: () => void;
}

/**
 * Las opciones de una app (como mantener apretado en un tele): abrir, mover, agregar o quitar del
 * inicio. Aparece con el botón Menú del celular sobre una app; Atrás la cierra.
 */
export class AppMenu implements FocusLayer {
  readonly name = 'menu';
  private readonly root = byId('app-menu');
  private readonly title = byId('app-menu-title');
  private readonly list = byId('app-menu-list');

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(title: string, options: readonly MenuOption[]): void {
    this.title.textContent = title;
    this.list.replaceChildren(...options.map((option, i) => {
      const button = el('button', 'menu-item', option.label);
      button.style.setProperty('--i', String(i));
      return focusable(button, option.run);
    }));
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  rows(): readonly (readonly HTMLElement[])[] {
    return [...this.list.querySelectorAll<HTMLElement>('.focusable')].map((item) => [item]);
  }
}
