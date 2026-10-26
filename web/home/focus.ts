// Selección con flechas, como el menú de un tele. Cada pantalla (inicio, biblioteca de apps, menú
// de una app, ajustes) es una "capa" con filas de elementos: izquierda/derecha se mueven dentro de
// la fila, arriba/abajo cambian de fila (yendo al elemento más cercano en horizontal).
// Las capas se apilan: al cerrar una (Atrás) se vuelve exactamente a donde se estaba.
// Cada elemento registra qué hacer al apretar OK: el motor no sabe qué hace cada uno.

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface FocusLayer {
  readonly name: string;
  /** Las filas de elementos elegibles, de arriba a abajo (se piden cada vez: pueden cambiar). */
  rows(): readonly (readonly HTMLElement[])[];
}

interface Position {
  readonly layer: FocusLayer;
  row: number;
  col: number;
}

const actions = new WeakMap<HTMLElement, () => void>();

/** Marca un elemento como elegible y dice qué hace al apretar OK (o al hacer clic). */
export function focusable(element: HTMLElement, action: () => void): HTMLElement {
  element.classList.add('focusable');
  actions.set(element, action);
  return element;
}

export class FocusEngine {
  private readonly stack: Position[] = [];
  private current: HTMLElement | null = null;

  /** El elemento elegido ahora (o null). */
  get focused(): HTMLElement | null {
    return this.current;
  }

  get layerName(): string {
    return this.top()?.layer.name ?? '';
  }

  /** Abre una capa encima (ej. la biblioteca) empezando en esa fila/columna. */
  push(layer: FocusLayer, row = 0, col = 0): void {
    this.stack.push({ layer, row, col });
    this.render();
  }

  /** Cierra la capa de arriba y vuelve a donde se estaba. */
  pop(): void {
    if (this.stack.length > 1) this.stack.pop();
    this.render();
  }

  goTo(row: number, col: number): void {
    const top = this.top();
    if (!top) return;
    top.row = row;
    top.col = col;
    this.render();
  }

  move(direction: Direction): void {
    const top = this.top();
    if (!top) return;
    const rows = top.layer.rows();
    if (direction === 'left' || direction === 'right') {
      top.col += direction === 'left' ? -1 : 1;
      this.render();
      return;
    }
    // Saltea filas vacías y elige el elemento más cercano en horizontal al que estaba elegido.
    const step = direction === 'up' ? -1 : 1;
    let row = top.row + step;
    while (row >= 0 && row < rows.length && (rows[row]?.length ?? 0) === 0) row += step;
    const target = rows[row];
    if (!target) return;
    top.row = row;
    top.col = this.current ? nearestByX(target, centerX(this.current)) : 0;
    this.render();
  }

  activate(): void {
    if (this.current) actions.get(this.current)?.();
  }

  /** El cursor pasó por encima de un elemento: lo elegimos (sin mover la fila). */
  pointAt(element: HTMLElement): void {
    const top = this.top();
    if (!top) return;
    const rows = top.layer.rows();
    for (let r = 0; r < rows.length; r++) {
      const c = rows[r]?.indexOf(element) ?? -1;
      if (c < 0) continue;
      top.row = r;
      top.col = c;
      this.highlight(element, false);
      return;
    }
  }

  /** Clic con el cursor. */
  click(element: HTMLElement): void {
    this.pointAt(element);
    actions.get(element)?.();
  }

  /** Vuelve a dibujar el foco (ej. después de que cambian los elementos de una fila). */
  render(): void {
    const top = this.top();
    if (!top) return;
    const rows = top.layer.rows();
    if (rows.length === 0) return;
    top.row = clamp(top.row, 0, rows.length - 1);
    // Si la fila todavía está vacía (ej. las apps no llegaron), se espera: no se cambia de fila.
    const items = rows[top.row] ?? [];
    if (items.length === 0) return;
    top.col = clamp(top.col, 0, items.length - 1);
    const target = items[top.col];
    if (target) this.highlight(target, true);
  }

  private top(): Position | undefined {
    return this.stack[this.stack.length - 1];
  }

  private highlight(target: HTMLElement, scroll: boolean): void {
    if (this.current !== target) {
      this.current?.classList.remove('focused');
      target.classList.add('focused');
      this.current = target;
    }
    if (scroll) scrollIntoTrack(target);
  }
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function centerX(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  return rect.left + rect.width / 2;
}

function nearestByX(items: readonly HTMLElement[], x: number): number {
  let best = 0;
  let bestDistance = Infinity;
  items.forEach((item, i) => {
    const distance = Math.abs(centerX(item) - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  });
  return best;
}

/**
 * Corre la fila sólo lo necesario para que lo elegido quede entero a la vista, con un margen para
 * que se vea que hay más (como en los teles). Después actualiza las flechas de "hay más".
 */
export function scrollIntoTrack(target: HTMLElement): void {
  const track = target.parentElement;
  if (!track?.classList.contains('track')) return;
  const visible = track.parentElement?.clientWidth ?? 0;
  const margin = Math.min(visible * 0.12, target.offsetWidth * 0.9); // deja asomar la siguiente
  let shift = Number(track.dataset['shift'] ?? '0');
  const left = target.offsetLeft - track.offsetLeft;
  const right = left + target.offsetWidth;
  if (left - shift < margin) shift = left - margin;
  if (right - shift > visible - margin) shift = right - visible + margin;
  shift = clamp(shift, 0, Math.max(0, track.scrollWidth - visible));
  track.dataset['shift'] = String(shift);
  track.style.transform = `translate3d(${String(-shift)}px, 0, 0)`;
  updateTrackArrows(track);
}

/** Muestra la flecha de cada lado sólo si hay tarjetas escondidas de ese lado. */
export function updateTrackArrows(track: HTMLElement): void {
  const row = track.parentElement;
  if (!row) return;
  const shift = Number(track.dataset['shift'] ?? '0');
  const hiddenRight = track.scrollWidth - shift - row.clientWidth;
  row.classList.toggle('more-left', shift > 4);
  row.classList.toggle('more-right', hiddenRight > 4);
}
