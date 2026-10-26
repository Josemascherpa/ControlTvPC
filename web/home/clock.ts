import { byId, capitalize } from './dom.js';

const TIME = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
const DATE = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Reloj, fecha y saludo. Cuando cambia el minuto, los números cambian con una animación suave. */
export class Clock {
  private readonly clock = byId('clock');
  private readonly ambientClock = byId('amb-clock');
  private readonly date = byId('date');
  private readonly ambientDate = byId('amb-date');
  private readonly greeting = byId('greeting');
  private shown = '';

  start(): void {
    this.tick();
    // Sólo hace falta revisar cuando empieza el próximo minuto.
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    setTimeout(() => {
      this.tick();
      setInterval(() => { this.tick(); }, 60_000);
    }, msToNextMinute + 50);
  }

  private tick(): void {
    const now = new Date();
    const time = TIME.format(now);
    if (time === this.shown) return;
    this.shown = time;
    for (const target of [this.clock, this.ambientClock]) {
      target.textContent = time;
      target.classList.remove('tick');
      void target.offsetWidth; // reinicia la animación
      target.classList.add('tick');
    }
    const date = capitalize(DATE.format(now));
    this.date.textContent = date;
    this.ambientDate.textContent = date;
    const hour = now.getHours();
    this.greeting.textContent = hour >= 6 && hour < 12 ? 'Buen día' : hour >= 12 && hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  }
}
