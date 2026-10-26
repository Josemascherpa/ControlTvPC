import { randomInt, timingSafeEqual } from 'crypto';
import type { SettingsStore } from '../domain/ports';

/**
 * Qué celulares pueden manejar la tele. Igual que una Samsung: la primera vez el celular recibe
 * una "llave" (token) que guarda y manda las próximas veces. Si se bloquean los nuevos, sólo entran
 * los que ya tienen llave.
 */
export class PhoneAccess {
  constructor(private readonly settings: SettingsStore) {}

  get pairedCount(): number {
    return this.settings.get('phones').length;
  }

  get allowNew(): boolean {
    return this.settings.get('allowNewPhones');
  }

  /** Devuelve la llave con la que entra el celular, o null si no lo dejamos entrar. */
  admit(token: string | null, name: string): string | null {
    if (token !== null && this.isKnown(token)) return token;
    if (!this.allowNew) return null;
    const fresh = String(randomInt(10_000_000, 99_999_999));
    this.settings.set('phones', [...this.settings.get('phones'), { token: fresh, name, createdAt: new Date().toISOString() }]);
    return fresh;
  }

  toggleAllowNew(): void {
    this.settings.set('allowNewPhones', !this.allowNew);
  }

  forgetAll(): void {
    this.settings.set('phones', []);
  }

  private isKnown(token: string): boolean {
    const given = Buffer.from(token);
    return this.settings.get('phones').some((phone) => {
      const saved = Buffer.from(phone.token);
      // Comparación en tiempo constante: no deja adivinar la llave midiendo cuánto tarda.
      return saved.length === given.length && timingSafeEqual(saved, given);
    });
  }
}
