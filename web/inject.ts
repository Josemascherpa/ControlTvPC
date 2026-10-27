// Se ejecuta adentro de CADA página que abre la tele (inicio, YouTube, Netflix…). Es un script
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
  // Corre también en los iframes: los videos de YouTube metidos en otras páginas (StreamFlix, sitios de
  // películas) son "youtube.com/embed" o "youtube-nocookie.com"; sin esto venían en AV1 (medido: 7 %
  // de cuadros perdidos, picos de 80 % con dos a la vez).
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
      animation: ctv-focus-in .22s ${EASE}; }
    @keyframes ctv-focus-in { from { outline-offset: 1.2vh; box-shadow: 0 0 0 0 rgba(47,128,255,0); } }
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
    if (r.bottom < -innerHeight || r.top > innerHeight * 2 || r.right < 0 || r.left > innerWidth) return null;
    return r;
  };
  /** Revisar el estilo es lo caro: se hace sólo con los pocos mejores candidatos, no con todos. */
  const isShown = (el: Element): boolean => {
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.opacity !== '0' && !el.closest('[aria-hidden=true], [inert]');
  };
  // Una flecha mantenida apretada repite muy rápido: no se procesa más de una por cuadro de pantalla.
  const REPEAT_GAP_MS = 45;
  let lastMove = 0;

  let marked: HTMLElement | null = null;
  const mark = (el: HTMLElement): void => {
    marked?.removeAttribute('data-ctv-focus');
    marked = el;
    el.setAttribute('data-ctv-focus', '');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };
  addEventListener('mousedown', () => {
    marked?.removeAttribute('data-ctv-focus');
    marked = null;
  }, { capture: true, passive: true });

  addEventListener('keydown', (event) => {
    const dir = DIRECTIONS[event.key];
    if (!dir || event.defaultPrevented || location.origin === HOME_ORIGIN) return;
    const [dirX, dirY] = dir;
    const active = document.activeElement;
    // Adentro de un campo de texto, izquierda/derecha mueven el cursor del texto.
    if (isEditable(active) && dirX !== 0) return;

    if (event.repeat && performance.now() - lastMove < REPEAT_GAP_MS) {
      event.preventDefault();
      return;
    }

    // Primero sólo se leen posiciones (barato y todas juntas, sin cambiar nada en el medio).
    const from = active && active !== document.body ? nearRect(active) : null;
    const ox = from ? from.left + from.width / 2 : innerWidth / 2;
    const oy = from ? from.top + from.height / 2 : dirY > 0 ? 0 : innerHeight;
    const candidates: { el: HTMLElement; score: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (el === active || (el instanceof HTMLButtonElement && el.disabled)) continue;
      const r = nearRect(el);
      if (!r) continue;
      const dx = r.left + r.width / 2 - ox;
      const dy = r.top + r.height / 2 - oy;
      const along = dx * dirX + dy * dirY; // cuánto avanza en la dirección pedida
      if (along <= 2) continue;
      candidates.push({ el, score: along + (Math.abs(dx * dirY) + Math.abs(dy * dirX)) * 2.5 }); // penaliza desviarse
    }
    // Después, del más cercano al más lejano, el primero que de verdad se ve.
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates.find((c) => isShown(c.el))?.el;
    if (!best) return;
    event.preventDefault();
    lastMove = performance.now();
    mark(best);
  });

  // ---------- Páginas más livianas (sin cambiar cómo se ven) ----------
  // Medido en páginas de películas pesadas (miles de elementos): cada cuadro se iba en redibujar y
  // recalcular las capas de toda la página. Dos causas que no se ven pero cuestan muchísimo:
  if (location.origin !== HOME_ORIGIN) {
    //   1. Al desplazarse, el contenido pasa por debajo del cursor y dispara los efectos "hover" de
    //      cientos de tarjetas. Mientras se desplaza, la página ignora el cursor (técnica clásica).
    let scrollTimer = 0;
    const scrolling = (): void => {
      const root = document.documentElement as HTMLElement | null;
      if (!root) return;
      if (!root.hasAttribute('data-ctv-scrolling')) root.setAttribute('data-ctv-scrolling', '');
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => { root.removeAttribute('data-ctv-scrolling'); }, 180);
    };
    addEventListener('wheel', scrolling, { capture: true, passive: true });
    addEventListener('scroll', scrolling, { capture: true, passive: true });

    //   2. Animaciones decorativas que no terminan nunca (puntitos que titilan, "pings", marquesinas):
    //      obligan a redibujar en cada cuadro. Se pausan; las de carga (spinners, barras) siguen.
    const KEEP_RUNNING = /spin|load|rotat|progress|buffer|skeleton|shimmer|pulse/i;
    const calm = (): void => {
      for (const animation of document.getAnimations()) {
        if (!(animation instanceof CSSAnimation) || animation.playState !== 'running') continue;
        if (animation.effect?.getTiming().iterations !== Infinity || KEEP_RUNNING.test(animation.animationName)) continue;
        animation.pause();
      }
    };
    addEventListener('load', calm);
    setInterval(calm, 4000);

  }

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
