// Los comandos y eventos del "Chrome DevTools Protocol" que usamos, con sus tipos exactos.
// Así cada llamada a Edge está chequeada por el compilador (nombre, parámetros y respuesta).

type Empty = Record<string, never>;

export interface TargetInfo {
  readonly targetId: string;
  readonly type: string;
  readonly url: string;
  readonly openerId?: string;
}

export type WindowState = 'normal' | 'minimized' | 'maximized' | 'fullscreen';

export interface KeyEventParams {
  readonly type: 'keyDown' | 'rawKeyDown' | 'keyUp';
  readonly key: string;
  readonly code: string;
  readonly windowsVirtualKeyCode: number;
  readonly nativeVirtualKeyCode: number;
  readonly text?: string;
}

export interface CdpCommands {
  'Target.setDiscoverTargets': { params: { discover: boolean }; result: Empty };
  'Target.getTargets': { params: Empty; result: { targetInfos: readonly TargetInfo[] } };
  'Target.createTarget': { params: { url: string }; result: { targetId: string } };
  'Target.attachToTarget': { params: { targetId: string; flatten: true }; result: { sessionId: string } };
  'Target.closeTarget': { params: { targetId: string }; result: { success: boolean } };
  'Browser.getWindowForTarget': { params: { targetId: string }; result: { windowId: number } };
  'Browser.getWindowBounds': { params: { windowId: number }; result: { bounds: { windowState: WindowState } } };
  'Browser.setWindowBounds': { params: { windowId: number; bounds: { windowState: WindowState } }; result: Empty };
  'Browser.close': { params: Empty; result: Empty };
  'SystemInfo.getProcessInfo': { params: Empty; result: { processInfo: readonly { type: string; id: number }[] } };
  'SystemInfo.getInfo': {
    params: Empty;
    result: { gpu: { featureStatus: Readonly<Record<string, string>>; auxAttributes: Readonly<Record<string, unknown>> } };
  };
  'Page.enable': { params: Empty; result: Empty };
  'Page.addScriptToEvaluateOnNewDocument': { params: { source: string }; result: { identifier: string } };
  'Page.navigate': { params: { url: string }; result: { frameId: string } };
  'Page.bringToFront': { params: Empty; result: Empty };
  'Runtime.evaluate': {
    params: { expression: string; returnByValue?: boolean; awaitPromise?: boolean };
    result: { result: { type: string; value?: unknown } };
  };
  'Input.dispatchKeyEvent': { params: KeyEventParams; result: Empty };
  'Input.insertText': { params: { text: string }; result: Empty };
}

export interface CdpEvents {
  'Target.targetCreated': { targetInfo: TargetInfo };
  'Target.targetInfoChanged': { targetInfo: TargetInfo };
  'Target.targetDestroyed': { targetId: string };
}

export type CdpMethod = keyof CdpCommands;
export type CdpParams<M extends CdpMethod> = CdpCommands[M]['params'];
export type CdpResult<M extends CdpMethod> = CdpCommands[M]['result'];
export type CdpEvent = keyof CdpEvents;

/** Lo que contesta Edge en http://127.0.0.1:PUERTO/json/version. */
export interface BrowserVersion {
  readonly webSocketDebuggerUrl: string;
  readonly userAgent: string;
}
