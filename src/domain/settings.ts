// Lo que se puede configurar. Se guarda en disco (ver infrastructure/storage).

export interface PairedPhone {
  readonly token: string;
  readonly name: string;
  readonly createdAt: string;
}

/** Con qué placa dibuja Edge: la Intel (sale directo por el HDMI) o la GeForce (copia cada cuadro a la Intel). */
export type GpuChoice = 'integrated' | 'dedicated';

export interface Settings {
  /** Nombre que ve el celular al buscar TVs. */
  readonly name: string;
  readonly phones: readonly PairedPhone[];
  /** Si es false, sólo entran los celulares que ya se conectaron alguna vez. */
  readonly allowNewPhones: boolean;
  readonly pointerSpeed: number;
  /** Horas sin usar nada (y sin nada reproduciéndose) hasta apagar la imagen. 0 = nunca. */
  readonly autoOffHours: number;
  /** Cambiar solo entre los planes de energía "Máximo" (en uso) y "Ahorro" (sin uso). */
  readonly autoPowerPlans: boolean;
  /** Minutos sin uso (y sin nada reproduciéndose) hasta pasar al plan de ahorro. */
  readonly idleMinutes: number;
  /** IP del tele en el WiFi (para manejarle el volumen). null = buscarlo. */
  readonly tvIp: string | null;
  /** El permiso que dio el tele la primera vez ("¿Permitir?"), para no volver a pedirlo. */
  readonly tvClientKey: string | null;
  /** MAC del tele del HDMI (para prenderlo por la red; también se le pasa al celular). */
  readonly tvMac: string | null;
  /** Marca del tele del HDMI en minúsculas (ej. "lg"), según su EDID. */
  readonly tvBrand: string | null;
  /** Nombre del tele del HDMI en la red (ej. "[LG] webOS TV UJ6580"). */
  readonly tvName: string | null;
  /** La placa de video con la que dibuja la tele (se cambia en config.json; Edge se reabre al reiniciar). */
  readonly gpu: GpuChoice;
}

export const DEFAULT_SETTINGS: Settings = {
  name: 'Notebook TV',
  phones: [],
  allowNewPhones: true,
  pointerSpeed: 1,
  autoOffHours: 4,
  autoPowerPlans: true,
  idleMinutes: 10,
  tvIp: null,
  tvClientKey: null,
  tvMac: null,
  tvBrand: null,
  tvName: null,
  gpu: 'integrated',
};
