// Lo que la app de Android TV le agrega al Cine: las teclas del mando (y del celular), el texto y
// el puntero del celular, y los avisos. El servidor de la tele lo mete en index.html ANTES que el
// código del Cine, así cuando el Cine arranca ya está todo definido.
//
// El Cine no lo necesita para funcionar: es sólo para cuando corre adentro del APK. Por eso se
// escribe como un script común (no un módulo), igual que web/inject.ts.

(() => {
  interface KeyInfo {
    readonly key: string;
    readonly code: string;
  }

  interface Bridge {
    key(name: string): boolean;
    text(value: string): boolean;
    search(query: string): boolean;
    back(): boolean | 'escape';
    home(): boolean;
    togglePlayback(): boolean;
    pause(): void;
    cursorMove(dx: number, dy: number): void;
    cursorClick(): void;
    volume(level: number, muted: boolean): void;
    toast(message: string, icon: string): void;
  }

  interface WindowWithBridge extends Window {
    __cineTv?: Bridge;
    CineTvDevice?: { playback(active: boolean): void };
  }

  // Sólo el APK configura su viewport: el zoom del navegador de escritorio no cambia.
  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute('content', 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no');
  if (new URLSearchParams(location.search).get('touch') === '1') {
    document.documentElement.classList.add('touch-ui');
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'touch.css';
    document.head.append(style);
  }

  let closeDrawer: (() => boolean) | undefined;
  document.addEventListener('DOMContentLoaded', () => {
    const rail = document.getElementById('rail');
    const catalog = document.getElementById('catalog');
    const scrim = document.querySelector<HTMLElement>('.rail-scrim');
    const touch = document.documentElement.classList.contains('touch-ui');
    let drawerOpen = false;
    let toggle: HTMLButtonElement | undefined;
    const setDrawer = (open: boolean, restoreFocus = false): void => {
      drawerOpen = open;
      document.documentElement.classList.toggle('drawer-open', open);
      toggle?.setAttribute('aria-expanded', String(open));
      if (rail) rail.inert = !open;
      if (catalog) catalog.inert = open;
      if (scrim) scrim.hidden = !open;
      if (restoreFocus) toggle?.focus();
    };
    if (touch && rail && scrim) {
      const header = document.createElement('header');
      header.className = 'touch-header';
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'drawer-toggle icon-btn';
      toggle.textContent = '☰';
      toggle.setAttribute('aria-label', 'Abrir menú');
      toggle.setAttribute('aria-controls', 'rail');
      const title = document.createElement('span');
      title.textContent = 'Cine';
      header.append(toggle, title);
      document.body.append(header);
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'drawer-close icon-btn';
      dismiss.textContent = '×';
      dismiss.setAttribute('aria-label', 'Cerrar menú');
      rail.prepend(dismiss);
      toggle.addEventListener('click', () => { setDrawer(true); dismiss.focus(); });
      dismiss.addEventListener('click', () => { setDrawer(false, true); });
      scrim.addEventListener('click', () => { setDrawer(false, true); });
      rail.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('.menu-item')) setDrawer(false);
      }, true);
      closeDrawer = () => {
        if (!drawerOpen) return false;
        setDrawer(false, true);
        return true;
      };
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && closeDrawer?.()) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
      setDrawer(false);
    }
    let playing: boolean | undefined;
    const panels = ['player', 'live', 'details', 'legal'].map((id) => document.getElementById(id));
    const syncPanels = (): void => {
      const active = panels.slice(0, 2).some((panel) => panel !== null && !panel.hidden);
      if (playing !== active) {
        playing = active;
        (window as WindowWithBridge).CineTvDevice?.playback(active);
      }
      document.documentElement.classList.toggle('overlay-open', panels.some((panel) => panel !== null && !panel.hidden));
      if (active && drawerOpen) setDrawer(false);
    };
    const observer = new MutationObserver(syncPanels);
    for (const panel of panels) if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    syncPanels();
  });

  const host = window as WindowWithBridge;
  if (host.__cineTv !== undefined) return;

  const KEYS: Readonly<Record<string, KeyInfo>> = {
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp' },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown' },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft' },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight' },
    Enter: { key: 'Enter', code: 'Enter' },
    Escape: { key: 'Escape', code: 'Escape' },
    PageUp: { key: 'PageUp', code: 'PageUp' },
    PageDown: { key: 'PageDown', code: 'PageDown' },
  };

  const focusTarget = (): HTMLElement =>
    document.activeElement instanceof HTMLElement ? document.activeElement : document.body;

  /** Enter sobre un botón: el navegador lo apretaría solo, pero un evento "de mentira" no. */
  const activate = (target: HTMLElement): void => {
    if (target.matches('button, a, [role="button"]')) {
      target.click();
      return;
    }
    if (target instanceof HTMLInputElement) {
      const form = target.closest('form');
      if (form === null) return;
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  };

  /** Manda una tecla como si la hubiera apretado el mando de la tele. */
  const key = (name: string): boolean => {
    const info = KEYS[name];
    if (info === undefined) return false;
    const target = focusTarget();
    const accepted = target.dispatchEvent(new KeyboardEvent('keydown', {
      key: info.key, code: info.code, bubbles: true, cancelable: true, composed: true,
    }));
    target.dispatchEvent(new KeyboardEvent('keyup', {
      key: info.key, code: info.code, bubbles: true, cancelable: true, composed: true,
    }));
    if (info.key === 'Enter' && accepted) activate(target);
    return true;
  };

  const write = (value: string): boolean => {
    const element = document.activeElement;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    element.setRangeText(value, start, end, 'end');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };

  /** El texto que escribe el celular ("Escribir en la TV") va al buscador del Cine. */
  const text = (value: string): boolean => {
    const prepare = window.__controlTvPrepareText;
    if (prepare === undefined) return write(value);
    const ready = prepare();
    if (ready === false) return false;
    if (ready === true) {
      write(value);
      return true;
    }
    void ready.then((ok) => {
      if (ok) write(value);
    });
    return true;
  };

  const search = (query: string): boolean => {
    const run = window.__controlTvSearch;
    return run === undefined ? false : run(query);
  };

  const back = (): boolean | 'escape' => {
    if (closeDrawer?.()) return true;
    const goBack = window.__controlTvBack;
    return goBack === undefined ? false : goBack();
  };

  const home = (): boolean => {
    const goHome = window.__controlTvHome;
    return goHome === undefined ? false : goHome();
  };

  const togglePlayback = (): boolean => {
    const toggle = window.__controlTvTogglePlayback;
    return toggle === undefined ? false : toggle();
  };

  const pause = (): void => {
    const videos = document.getElementsByTagName('video');
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      if (video !== undefined && !video.paused) video.pause();
    }
  };

  // ---------- Puntero del celular ----------

  let cursor: HTMLDivElement | null = null;
  let cursorX = 0;
  let cursorY = 0;

  const ensureCursor = (): HTMLDivElement => {
    if (cursor !== null && cursor.isConnected) return cursor;
    cursorX = window.innerWidth / 2;
    cursorY = window.innerHeight / 2;

    const element = document.createElement('div');
    element.id = 'ctv-pointer';
    element.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483646;'
      + 'filter:drop-shadow(0 2px 6px rgba(0,0,0,.55));';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '30');
    svg.setAttribute('height', '30');
    svg.setAttribute('viewBox', '0 0 24 24');
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrow.setAttribute('d', 'M5 2l14 11-6.2.9 3.6 6.4-2.6 1.5-3.6-6.4L5 20z');
    arrow.setAttribute('fill', '#fff');
    arrow.setAttribute('stroke', '#111');
    arrow.setAttribute('stroke-width', '1.1');
    svg.appendChild(arrow);
    element.appendChild(svg);
    document.body.appendChild(element);

    cursor = element;
    return element;
  };

  const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), Math.max(max, 0));

  const cursorMove = (dx: number, dy: number): void => {
    const element = ensureCursor();
    cursorX = clamp(cursorX + dx, window.innerWidth - 1);
    cursorY = clamp(cursorY + dy, window.innerHeight - 1);
    element.style.transform = `translate(${cursorX}px,${cursorY}px)`;
  };

  const cursorClick = (): void => {
    ensureCursor();
    const hit = document.elementFromPoint(cursorX, cursorY);
    if (hit instanceof HTMLElement) hit.click();
  };

  // ---------- Avisos y volumen (los dibuja web/inject.ts) ----------

  const overlay = (): Contracts.Overlay | undefined => window.__controlTv;

  const volume = (level: number, muted: boolean): void => {
    const target = overlay();
    if (target !== undefined) target.volume({ level, muted });
  };

  const toast = (message: string, icon: string): void => {
    const target = overlay();
    if (target !== undefined) target.toast({ text: message, icon });
  };

  host.__cineTv = {
    key, text, search, back, home, togglePlayback, pause, cursorMove, cursorClick, volume, toast,
  };
})();
