// Se ejecuta adentro de CADA página que abre la tele (inicio, YouTube, Spotify…). Es un script
// (no un módulo) porque se inyecta con DevTools: todo va adentro de una función para no ensuciar
// la página. Sólo usa createElement/textContent (nada de innerHTML): YouTube y otras lo bloquean.
//
//   - El cursor de Windows queda invisible: la flecha la dibuja el ayudante nativo (input-host),
//     que la mueve fluida por encima de todo. Acá sólo sabemos si se está usando (para el foco).
//   - Navegación tipo Chromecast: las flechas saltan al botón/link más cercano en esa dirección.
//   - Avisos ("Celular conectado") y la barra de volumen, arriba de todo.

(() => {
  if (window.__controlTv !== undefined) return;

  // ---------- Video más liviano en YouTube ----------
  // Las placas de video de esta notebook (Intel HD 4400 y GeForce 840M) decodifican H.264 por
  // hardware, pero no VP9 ni AV1 (lo que YouTube elige por defecto): esos los hace el procesador y
  // se pierden cuadros (medido: 5–22 % en 1080p60). Si el navegador "dice" que no los soporta,
  // YouTube manda H.264 (lo mismo que la extensión h264ify). YouTube pregunta de tres formas:
  // MediaSource.isTypeSupported, canPlayType y mediaCapabilities.decodingInfo: se responden las tres.
  // Corre también en los iframes: los videos de YouTube metidos en otras páginas son
  // "youtube.com/embed" o "youtube-nocookie.com"; sin esto venían en AV1 (medido: 7 % de cuadros
  // perdidos, picos de 80 % con dos a la vez).
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) {
    const heavyCodec = /vp0?9|vp8|av01/i;
    for (const name of ['MediaSource', 'ManagedMediaSource'] as const) {
      const source = (window as unknown as Partial<Record<typeof name, typeof MediaSource>>)[name];
      if (!source) continue;
      const supported = source.isTypeSupported.bind(source);
      source.isTypeSupported = (type: string): boolean => !heavyCodec.test(type) && supported(type);
    }
    const capabilities = navigator.mediaCapabilities as MediaCapabilities | undefined;
    if (capabilities) {
      const decodingInfo = capabilities.decodingInfo.bind(capabilities);
      capabilities.decodingInfo = (config: MediaDecodingConfiguration): Promise<MediaCapabilitiesDecodingInfo> => {
        if (!heavyCodec.test(config.video?.contentType ?? '')) return decodingInfo(config);
        return Promise.resolve({ supported: false, smooth: false, powerEfficient: false, configuration: config } as MediaCapabilitiesDecodingInfo);
      };
    }
    type CanPlay = (this: HTMLMediaElement, type: string) => CanPlayTypeResult;
    const canPlay = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'canPlayType')?.value as CanPlay | undefined;
    if (canPlay) {
      HTMLMediaElement.prototype.canPlayType = function (this: HTMLMediaElement, type: string): CanPlayTypeResult {
        return heavyCodec.test(type) ? '' : canPlay.call(this, type);
      };
    }
  }

  // Todo lo demás (navegación, avisos, volumen) es sólo para la página principal, no para sus iframes.
  if (window.top !== window) return;

  const HOME_ORIGIN = 'http://127.0.0.1:8001';
  const CURSOR_HIDE_MS = 4000;
  const EASE = 'cubic-bezier(.2,.8,.2,1)';

  const css = `
    html, html * { cursor: none !important; }
    [data-ctv-focus] { outline: .5vh solid #2f80ff !important; outline-offset: .3vh !important;
      box-shadow: 0 0 0 1.1vh rgba(47,128,255,.28) !important; border-radius: .6vh;
      }
    #ctv-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: 'Segoe UI', system-ui, sans-serif; }
    #ctv-layer .ctv-toast { position: absolute; right: 2.2vw; bottom: 3vh; display: flex; align-items: center; gap: 1vw;
      padding: 1.6vh 2vw; border-radius: 999px; background: rgba(18,18,24,.92); color: #fff; font-size: 2.6vh; font-weight: 600;
      box-shadow: 0 1vh 4vh rgba(0,0,0,.45); transform: translateY(2vh) scale(.96); opacity: 0;
      transition: transform .4s ${EASE}, opacity .35s; }
    #ctv-layer .ctv-toast.ctv-show { transform: none; opacity: 1; }
    #ctv-layer .ctv-vol { position: absolute; left: 50%; top: 4vh; display: flex; align-items: center; gap: 1.4vw; padding: 1.6vh 2.2vw;
      border-radius: 999px; background: rgba(18,18,24,.92); color: #fff; font-size: 2.8vh; font-weight: 700;
      transform: translate(-50%, -3vh) scale(.94); opacity: 0; transition: transform .3s ${EASE}, opacity .25s;
      box-shadow: 0 1vh 4vh rgba(0,0,0,.45); }
    #ctv-layer .ctv-vol.ctv-show { transform: translate(-50%, 0); opacity: 1; }
    #ctv-layer .ctv-bar { width: 22vw; height: 1vh; border-radius: 1vh; background: rgba(255,255,255,.2); overflow: hidden; }
    #ctv-layer .ctv-fill { height: 100%; width: 100%; background: #fff; border-radius: 1vh; transform-origin: left;
      transition: transform .18s ${EASE}; }
    #ctv-layer .ctv-num { min-width: 3.2vw; text-align: right; font-variant-numeric: tabular-nums; }
    [data-ctv-scrolling] body, [data-ctv-scrolling] body * { pointer-events: none !important; }
    [data-ctv-focus="tv"] { outline: .45vh solid #fff !important; outline-offset: .35vh !important; box-shadow: 0 1.2vh 3vh rgba(0,0,0,.6) !important;
      transform: scale(1.06); transition: transform .18s ${EASE}, outline-offset .18s ${EASE}; z-index: 5; position: relative;
      border-radius: .6vh; animation: none; }
  `;

  // Hoja de estilos "construida" desde JS: no la frena la política de seguridad (CSP) de las páginas.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const adopt = (): void => {
    if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  };
  adopt();
  setInterval(adopt, 3000); // algunas páginas reemplazan la lista y se llevan la nuestra

  // Este script corre tan temprano que a veces la página todavía no tiene <html>: esperamos a que exista.
  const withRoot = (fn: (root: HTMLElement) => void): void => {
    const root = document.documentElement as HTMLElement | null;
    if (root) {
      fn(root);
      return;
    }
    const observer = new MutationObserver(() => {
      const ready = document.documentElement as HTMLElement | null;
      if (!ready) return;
      observer.disconnect();
      fn(ready);
    });
    observer.observe(document, { childList: true });
  };

  // ---------- ¿Se está usando el cursor? ----------
  // Aparece cuando se usa el touchpad; al usar las flechas (o tras unos segundos quieto) se esconde
  // y se vuelve a navegar entre botones, como en Chromecast.
  let idleTimer = 0;
  const hideCursor = (): void => {
    clearTimeout(idleTimer);
    withRoot((root) => { root.setAttribute('data-ctv-idle', ''); });
  };
  const showCursor = (): void => {
    withRoot((root) => { root.removeAttribute('data-ctv-idle'); });
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(hideCursor, CURSOR_HIDE_MS);
  };
  // Chrome manda movimientos "de mentira" cuando la página se mueve debajo del cursor quieto:
  // sólo cuenta si de verdad cambió de lugar.
  let lastX = -1;
  let lastY = -1;
  addEventListener('mousemove', (event) => {
    if (event.screenX === lastX && event.screenY === lastY) return;
    lastX = event.screenX;
    lastY = event.screenY;
    showCursor();
  }, { capture: true, passive: true });
  addEventListener('keydown', hideCursor, { capture: true, passive: true });
  hideCursor();

  // ---------- Navegación tipo Chromecast ----------
  // Escuchamos al final (sin "capture"): si la página ya usó la flecha (YouTube TV, un reproductor),
  // no hacemos nada. Si no hay nada hacia ese lado, la página se desplaza como siempre.
  const FOCUSABLE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), '
    + '[role=button], [role=link], [role=menuitem], [role=tab], [role=option], [contenteditable=true]';
  const DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  };

  const isEditable = (el: Element | null): boolean =>
    el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  /** Su lugar en pantalla, si es un blanco posible (con tamaño y a menos de una pantalla de distancia). */
  const nearRect = (el: Element): DOMRect | null => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    if (r.bottom < -innerHeight || r.top > innerHeight * 2 || r.right < -innerWidth || r.left > innerWidth * 2) return null;
    return r;
  };
  /** Revisar el estilo es lo caro: se hace sólo con los pocos mejores candidatos, no con todos. */
  const isShown = (el: Element): boolean => {
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.opacity !== '0' && !el.closest('[aria-hidden=true], [inert], [aria-disabled=true]')
      && !el.matches(':disabled');
  };
  // Cacheamos pertenencia, nunca geometría: scroll, zoom y animaciones cambian las posiciones.
  // Las páginas SPA invalidan la lista con sus mutaciones; el resaltado propio no la invalida.
  let focusables: readonly HTMLElement[] | null = null;
  let overlays: readonly HTMLElement[] | null = null;
  const focusObserver = new MutationObserver((records) => {
    if (!records.some((r) => r.type === 'attributes'
      || [...r.addedNodes, ...r.removedNodes].some((node) => node instanceof Element))) return;
    focusables = null;
    overlays = null;
  });
  withRoot((root) => {
    focusObserver.observe(root, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['tabindex', 'href', 'role', 'disabled', 'type', 'contenteditable', 'aria-modal', 'open'],
    });
  });
  const candidatesFor = (root: Document | HTMLElement): readonly HTMLElement[] => {
    if (root !== document) return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
    focusables ??= [...document.querySelectorAll<HTMLElement>(FOCUSABLE)];
    return focusables;
  };
  // Una flecha mantenida apretada repite muy rápido: no se procesa más de una por cuadro de pantalla.
  const REPEAT_GAP_MS = 45;
  let lastMove = 0;

  let marked: HTMLElement | null = null;
  const focusElement = (el: HTMLElement): void => {
    // role=button no vuelve enfocable a un div. Darle foco real permite escribir/activar después.
    if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  };
  const mark = (el: HTMLElement): void => {
    marked?.removeAttribute('data-ctv-focus');
    marked = el;
    el.setAttribute('data-ctv-focus', '');
    focusElement(el);
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };
  addEventListener('mousedown', () => {
    marked?.removeAttribute('data-ctv-focus');
    marked = null;
  }, { capture: true, passive: true });

  const visible = (el: HTMLElement): boolean => {
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && isShown(el);
  };

  const OVERLAYS = '[role=dialog], dialog[open], [aria-modal=true], [role=menu], [role=listbox]';
  const activeOverlay = (): HTMLElement | null => {
    const active = document.activeElement?.closest<HTMLElement>(OVERLAYS);
    if (active && visible(active)) return active;
    // Los paneles anidados suelen agregarse al final. El último visible conserva el foco.
    overlays ??= [...document.querySelectorAll<HTMLElement>(OVERLAYS)];
    for (let i = overlays.length - 1; i >= 0; i--) {
      const panel = overlays[i];
      if (panel && visible(panel)) return panel;
    }
    return null;
  };

  // Texto del celular: nunca elegir un campo de contraseña/email por adivinación.
  // Mantener el campo que el usuario enfocó, o elegir un único buscador inequívoco.
  window.__controlTvPrepareText = (): boolean | Promise<boolean> => {
    // El foco del usuario puede estar dentro de un iframe de otro origen.
    // Input.insertText ya se dirige al frame enfocado; no robarlo para otro buscador.
    if (document.activeElement instanceof HTMLIFrameElement) return true;
    const writable = (el: Element | null): el is HTMLElement => el instanceof HTMLElement
      && (el.isContentEditable || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement
        && /^(text|search|email|password|url|tel|number)$/.test(el.type)))
      && !el.matches(':disabled, [readonly]') && visible(el);
    if (writable(document.activeElement)) return true;
    const scope = activeOverlay() ?? document;
    const searches = [...scope.querySelectorAll<HTMLElement>('input[type=search], [role=searchbox], [role=search] input')]
      .filter(writable);
    if (searches.length === 1 && searches[0]) {
      focusElement(searches[0]);
      return document.activeElement === searches[0];
    }
    toast({ text: 'Seleccioná el buscador o campo de texto antes de escribir', icon: '⌨' });
    return false;
  };

  addEventListener('keydown', (event) => {
    const dir = DIRECTIONS[event.key];
    if (!dir || event.defaultPrevented || location.origin === HOME_ORIGIN) return;
    if (event.repeat && performance.now() - lastMove < REPEAT_GAP_MS) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    // Adentro de un campo de texto, izquierda/derecha mueven el cursor del texto.
    if (isEditable(active)) return;
    const dialog = activeOverlay();
    const fullscreen = document.fullscreenElement;
    if (!dialog && (active instanceof HTMLVideoElement || fullscreen instanceof HTMLVideoElement || fullscreen?.querySelector('video'))) return;
    if (!dialog && /^(www\.)?youtube\.com$/.test(location.hostname)
      && (location.pathname.startsWith('/tv') || location.pathname.startsWith('/watch'))) return;

    // Primero sólo se leen posiciones (barato y todas juntas, sin cambiar nada en el medio).
    const from = active && active !== document.body && (!dialog || dialog.contains(active)) ? nearRect(active) : null;
    const [dirX, dirY] = dir;
    const ox = from ? from.left + from.width / 2 : innerWidth / 2;
    const oy = from ? from.top + from.height / 2 : dirY > 0 ? 0 : innerHeight;
    const candidates: { el: HTMLElement; score: number }[] = [];
    for (const el of candidatesFor(dialog ?? document)) {
      if (el === active || (el instanceof HTMLButtonElement && el.disabled)) continue;
      const r = nearRect(el);
      if (!r) continue;
      const dx = r.left + r.width / 2 - ox;
      const dy = r.top + r.height / 2 - oy;
      const along = dx * dirX + dy * dirY; // cuánto avanza en la dirección pedida
      if (along <= 2) continue;
      // Priorizar la misma fila/columna cuando sus bordes se solapan. Así una tarjeta
      // ancha no hace saltar a la fila inferior sólo por tener su centro más cerca.
      const aligned = !from || (dirX !== 0
        ? r.top < from.bottom && r.bottom > from.top
        : r.left < from.right && r.right > from.left);
      candidates.push({ el, score: along + (Math.abs(dx * dirY) + Math.abs(dy * dirX)) * 2.5
        + (aligned ? 0 : Math.max(innerWidth, innerHeight)) });
    }
    // Después, del más cercano al más lejano, el primero que de verdad se ve.
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates.find((c) => isShown(c.el))?.el;
    if (!best) return;
    event.preventDefault();
    lastMove = performance.now();
    mark(best);
  });

  // El botón Atrás del control: primero cierra lo que el sitio tenga abierto (un menú, una ficha).
  window.__controlTvBack = (): boolean | 'escape' => {
    const panel = activeOverlay();
    if (panel) {
      const trigger = [...document.querySelectorAll<HTMLElement>('[aria-expanded=true][aria-controls]')]
        .find((el) => el.getAttribute('aria-controls')?.split(/\s+/).includes(panel.id) && visible(el));
      const close = [...panel.querySelectorAll<HTMLElement>('button[aria-label="Close" i], button[aria-label="Cerrar" i], [role=button][aria-label="Close" i], [role=button][aria-label="Cerrar" i]')].find(visible);
      if (trigger || close) {
        (trigger ?? close)?.click();
        if (trigger?.isConnected) mark(trigger);
        return true;
      }
      // Un diálogo sin cierre conocido recibe Escape, sin saltar a otra página por detrás.
      return 'escape';
    }
    if (isEditable(document.activeElement) && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
      return true;
    }
    return false;
  };

  addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.defaultPrevented || isEditable(document.activeElement)) return;
    if (!marked?.isConnected || document.activeElement !== marked || !visible(marked)) return;
    // Los controles HTML nativos ya generan click con Enter. Los roles ARIA no lo hacen.
    if (marked.matches('button, a[href], input, summary, select, textarea')) return;
    if (!marked.matches('[role=button], [role=link], [role=menuitem], [role=tab], [role=option]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    marked.click();
  }, { capture: true });

  // ---------- Capa de dibujo (arriba de todo) ----------

  const layer = (): HTMLElement => {
    let el = document.getElementById('ctv-layer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ctv-layer';
    }
    // Si hay un video a pantalla completa, la capa tiene que ir adentro de él para verse.
    const host = document.fullscreenElement ?? document.body;
    if (el.parentNode !== host) host.appendChild(el);
    return el;
  };

  const box = (cls: string, children: readonly Node[] = []): HTMLDivElement => {
    const el = document.createElement('div');
    el.className = cls;
    el.append(...children);
    return el;
  };

  const label = (cls: string, value: string): HTMLSpanElement => {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = value;
    return el;
  };

  const nextFrame = (fn: () => void): void => {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  };

  function toast({ text, icon }: Contracts.Toast): void {
    const el = box('ctv-toast', [label('ctv-icon', icon), label('', text)]);
    layer().appendChild(el);
    nextFrame(() => { el.classList.add('ctv-show'); });
    setTimeout(() => {
      el.classList.remove('ctv-show');
      setTimeout(() => { el.remove(); }, 450);
    }, 3500);
  }

  let volumeBox: HTMLDivElement | null = null;
  let volumeIcon: HTMLSpanElement | null = null;
  let volumeFill: HTMLDivElement | null = null;
  let volumeNumber: HTMLSpanElement | null = null;
  let volumeTimer = 0;
  function volume({ level, muted }: Contracts.VolumeState): void {
    if (!volumeBox?.isConnected || !volumeIcon || !volumeFill || !volumeNumber) {
      volumeIcon = label('ctv-icon', '');
      volumeFill = box('ctv-fill');
      volumeNumber = label('ctv-num', '');
      volumeBox = box('ctv-vol', [volumeIcon, box('ctv-bar', [volumeFill]), volumeNumber]);
      layer().appendChild(volumeBox);
    } else {
      layer();
    }
    volumeIcon.textContent = muted || level === 0 ? '🔇' : level < 35 ? '🔈' : level < 70 ? '🔉' : '🔊';
    volumeFill.style.transform = `scaleX(${muted ? 0 : level / 100})`;
    volumeNumber.textContent = muted ? 'Silencio' : String(level);
    const shown = volumeBox;
    nextFrame(() => { shown.classList.add('ctv-show'); });
    clearTimeout(volumeTimer);
    volumeTimer = window.setTimeout(() => { shown.classList.remove('ctv-show'); }, 2200);
  }

  const overlay: Contracts.Overlay = { toast, volume };
  window.__controlTv = overlay;
})();
