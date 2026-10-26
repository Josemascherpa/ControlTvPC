import { byId } from './dom.js';

/**
 * Desplazamiento vertical del inicio, como tvOS: arriba se ve el reloj con la primera fila; al bajar
 * a las otras filas, todo sube suave (el reloj se va) y la fila elegida queda arriba. Abajo, un
 * aviso "Más categorías" mientras queden filas sin ver.
 */
export class HomeScroller {
  private readonly scroll = byId('home-scroll');
  private readonly more = byId('more-down');
  private shift = 0;

  ensureVisible(element: HTMLElement | null): void {
    const row = element?.closest<HTMLElement>('.row');
    const rows = [...this.scroll.querySelectorAll<HTMLElement>('.row')];
    const index = row ? rows.indexOf(row) : -1;
    // La barra de arriba o la primera fila: se ve el reloj.
    if (!row || index <= 0) this.set(0);
    // Sin tope abajo: la fila elegida siempre queda arriba (así no se asoman pedazos de la fila anterior).
    else this.set(Math.max(0, this.offsetOf(row, 'top') - this.viewportHeight() * 0.04));
    this.refresh();
  }

  /** Muestra u oculta "Más categorías" (después de moverse o de que cambien las filas). */
  refresh(): void {
    const rows = this.scroll.querySelectorAll<HTMLElement>('.row');
    const last = rows[rows.length - 1];
    const hidden = last ? this.offsetOf(last, 'bottom') - this.shift > this.viewportHeight() + 4 : false;
    this.more.classList.toggle('on', hidden);
  }

  /** Posición de un borde de la fila dentro de la lista (sin contar el desplazamiento ni animaciones). */
  private offsetOf(row: HTMLElement, edge: 'top' | 'bottom'): number {
    return row.getBoundingClientRect()[edge] - this.scroll.getBoundingClientRect().top;
  }

  private viewportHeight(): number {
    return this.scroll.parentElement?.clientHeight ?? 0;
  }

  private set(shift: number): void {
    if (Math.abs(shift - this.shift) < 1) return;
    this.shift = shift;
    this.scroll.style.transform = shift > 0 ? `translate3d(0, ${String(-shift)}px, 0)` : '';
    document.body.classList.toggle('home-scrolled', shift > 0);
  }
}
