// Ayudas chicas para armar la pantalla sin repetir código.

/** Busca un elemento por id. Si falta, es un error del HTML: mejor enterarse enseguida. */
export function byId(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Falta el elemento #${id} en index.html`);
  return found;
}

/** Crea un elemento con clase y texto opcionales. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Espera dos cuadros: así el navegador "ve" el estado inicial antes de animar al final. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
