import type { DisplayPower, MediaKeys } from '../../domain/ports';
import { ES, KEYEVENTF, MOUSEEVENTF, VK, win32 } from './win32';

const HWND_BROADCAST = 0xffff;
const WM_SYSCOMMAND = 0x0112;
const SC_MONITORPOWER = 0xf170;
const MONITOR_OFF = 2;

/** La imagen que sale por el HDMI y que la notebook no se suspenda. */
export class WindowsDisplay implements DisplayPower {
  turnOff(): void {
    win32.postMessage(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, MONITOR_OFF);
  }

  /** Un movimiento mínimo del mouse (ida y vuelta) despierta la pantalla. */
  turnOn(): void {
    win32.mouseEvent(MOUSEEVENTF.MOVE, 1, 0, 0, 0);
    win32.mouseEvent(MOUSEEVENTF.MOVE, -1, 0, 0, 0);
  }

  /** Mientras este proceso viva, Windows no suspende la notebook (y si display=true, tampoco apaga la imagen). */
  keepAwake(display: boolean): void {
    win32.setThreadExecutionState(ES.CONTINUOUS | ES.SYSTEM_REQUIRED | (display ? ES.DISPLAY_REQUIRED : 0));
  }
}

/** La tecla multimedia la toma la pestaña que está sonando (YouTube, Netflix, Spotify…). */
export class WindowsMediaKeys implements MediaKeys {
  playPause(): void {
    win32.keybdEvent(VK.MEDIA_PLAY_PAUSE, 0, KEYEVENTF.EXTENDEDKEY, 0);
    win32.keybdEvent(VK.MEDIA_PLAY_PAUSE, 0, KEYEVENTF.EXTENDEDKEY | KEYEVENTF.KEYUP, 0);
  }
}
