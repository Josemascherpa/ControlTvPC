// Lo que la notebook le agrega al Cine (se inyecta con DevTools, por eso es un script y no un
// módulo). El Cine no lo necesita para funcionar: es sólo para cuando corre en la notebook.
//
//   - El cursor de Windows queda invisible: la flecha la dibuja el ayudante nativo (input-host),
//     que la mueve fluida por encima de todo.
//   - Avisos ("Celular conectado") y la barra de volumen del tele, arriba de todo.
// Sólo usa createElement/textContent (nada de innerHTML).

(() => {
  if (window.__controlTv !== undefined || window.top !== window) return;

  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const css = `
    html, html * { cursor: none !important; }
    #ctv-layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: Inter, 'Segoe UI', system-ui, sans-serif; }
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
  `;
  // Hoja de estilos "construida" desde JS: no depende de que la página ya tenga <head>.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

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
