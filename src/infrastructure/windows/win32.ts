import { load, struct, type IKoffiLib } from 'koffi';

// Llamadas directas a Windows con koffi (trae binarios ya compilados: no hace falta Visual Studio).
// koffi no conoce los tipos de cada función, así que acá se los ponemos a mano, una sola vez.

type Win32Fn<T extends (...args: never[]) => unknown> = T;

function bind<T extends (...args: never[]) => unknown>(lib: IKoffiLib, signature: string): Win32Fn<T> {
  return lib.func(signature) as unknown as T;
}

const user32 = load('user32.dll');

/** Cuándo fue el último toque de teclado/mouse (milisegundos desde que arrancó Windows). */
export interface LastInputInfo {
  cbSize: number;
  dwTime: number;
}
struct('LASTINPUTINFO', { cbSize: 'uint32', dwTime: 'uint32' });
const kernel32 = load('kernel32.dll');

export const win32 = {
  setProcessDpiAware: bind<() => number>(user32, 'int __stdcall SetProcessDPIAware()'),
  getSystemMetrics: bind<(index: number) => number>(user32, 'int __stdcall GetSystemMetrics(int nIndex)'),
  setCursorPos: bind<(x: number, y: number) => number>(user32, 'int __stdcall SetCursorPos(int x, int y)'),
  mouseEvent: bind<(flags: number, dx: number, dy: number, data: number, extra: number) => void>(
    user32, 'void __stdcall mouse_event(uint32_t dwFlags, int32_t dx, int32_t dy, int32_t dwData, uintptr_t dwExtraInfo)'),
  keybdEvent: bind<(vk: number, scan: number, flags: number, extra: number) => void>(
    user32, 'void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'),
  postMessage: bind<(hwnd: number, msg: number, wParam: number, lParam: number) => number>(
    user32, 'int __stdcall PostMessageW(intptr_t hWnd, uint32_t Msg, uintptr_t wParam, intptr_t lParam)'),
  setThreadExecutionState: bind<(flags: number) => number>(kernel32, 'uint32_t __stdcall SetThreadExecutionState(uint32_t esFlags)'),
  getLastInputInfo: bind<(info: LastInputInfo) => boolean>(user32, 'bool __stdcall GetLastInputInfo(_Inout_ LASTINPUTINFO *plii)'),
  getTickCount: bind<() => number>(kernel32, 'uint32_t __stdcall GetTickCount()'),
} as const;

// Sin esto Windows nos "miente" las coordenadas cuando la pantalla tiene escala (la tele está al 300%).
win32.setProcessDpiAware();

export const SM = { CXSCREEN: 0, CYSCREEN: 1 } as const;
export const MOUSEEVENTF = { MOVE: 0x1 } as const;
export const KEYEVENTF = { EXTENDEDKEY: 0x1, KEYUP: 0x2 } as const;
export const VK = { MEDIA_PLAY_PAUSE: 0xb3 } as const;
export const ES = { CONTINUOUS: 0x80000000, SYSTEM_REQUIRED: 0x1, DISPLAY_REQUIRED: 0x2 } as const;
