import { byId, el } from './dom.js';
import { degrees, describeWeather, weatherIcon } from './weather.js';

/** Los "chips" de arriba (clima, volumen, celular), el resumen del día y el aviso de bienvenida. */
export class StatusBar {
  private readonly weatherChip = byId('chip-weather');
  private readonly volumeChip = byId('chip-volume');
  private readonly phoneChip = byId('chip-phone');
  private readonly summary = byId('summary');
  private readonly ambientWeather = byId('amb-weather');
  private readonly onboarding = byId('onboarding');
  private readonly onboardingName = byId('onb-name');
  private lastVolume = '';

  showState(state: Contracts.UiState): void {
    const volumeText = state.volume ? (state.volume.muted ? 'Silencio' : String(state.volume.level)) : '';
    if (volumeText !== this.lastVolume) {
      this.lastVolume = volumeText;
      this.volumeChip.replaceChildren(...(state.volume
        ? [lineIcon(state.volume.muted ? SPEAKER_MUTED : SPEAKER), el('span', 'num', volumeText)]
        : []));
      bump(this.volumeChip);
    }

    // Con un celular conectado: punto verde y "Conectado". Sin ninguno: la dirección para encontrarla.
    this.phoneChip.replaceChildren(...(state.phones.length > 0
      ? [el('span', 'dot'), el('span', '', state.phones.length > 1 ? `${String(state.phones.length)} celulares` : 'Conectado')]
      : [lineIcon(PHONE), el('span', 'dim', state.ip ?? 'Sin red')]));

    this.onboarding.hidden = state.pairedCount > 0;
    this.onboardingName.textContent = state.name;
  }

  showWeather(weather: Contracts.Weather | null): void {
    if (!weather) return;
    const info = describeWeather(weather.now.code);
    this.weatherChip.replaceChildren(weatherIcon(info.kind, weather.now.isDay), el('span', '', degrees(weather.now.temp)), el('span', 'dim', weather.city));
    this.ambientWeather.replaceChildren(weatherIcon(info.kind, weather.now.isDay), el('span', '', `${degrees(weather.now.temp)} · ${info.text}`));
    const today = weather.days[0];
    this.summary.textContent = `${weather.city ? `${weather.city} · ` : ''}${info.text}, ${degrees(weather.now.temp)}`
      + (today ? `. Hoy entre ${degrees(today.min)} y ${degrees(today.max)}` : '')
      + (today && today.rain >= 40 ? `, ${today.rain}% de probabilidad de lluvia.` : '.');
  }
}

// Íconos de línea finos (en vez de emoji): se ven nítidos y sobrios a cualquier tamaño.
const SPEAKER = '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>';
const SPEAKER_MUTED = '<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>';
const PHONE = '<rect x="7" y="3" width="10" height="18" rx="2.4"/><path d="M11 17.5h2"/>';

function lineIcon(paths: string): HTMLSpanElement {
  const span = el('span', 'wi');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  return span;
}

/** Un "saltito" corto para que se note que algo cambió. */
function bump(target: HTMLElement): void {
  target.classList.remove('bump');
  void target.offsetWidth;
  target.classList.add('bump');
}
