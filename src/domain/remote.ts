// Lo que el control remoto (la app del celular) le puede pedir a la tele, ya traducido de su
// protocolo a algo propio. El resto de la app no sabe que el celular habla "en Samsung".

export const REMOTE_KEYS = [
  'POWER', 'HOME', 'BACK', 'MENU',
  'UP', 'DOWN', 'LEFT', 'RIGHT', 'OK',
  'VOLUME_UP', 'VOLUME_DOWN', 'MUTE',
  'CHANNEL_UP', 'CHANNEL_DOWN',
  'PLAY_PAUSE',
] as const;

export type RemoteKey = (typeof REMOTE_KEYS)[number];

/** Un pedido del control remoto. "kind" dice cuál es; el resto son sus datos. */
export type RemoteCommand =
  | { readonly kind: 'key'; readonly key: RemoteKey }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'openUrl'; readonly url: string }
  | { readonly kind: 'pointerMove'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'pointerClick' };

/** Un celular que se está conectando. */
export interface PhoneHandshake {
  readonly name: string;
  readonly address: string;
  readonly token: string | null;
}
