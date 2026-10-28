// Punto de entrada. Hace de "vigilante":
//   - Si ControlTv ya está corriendo, sólo le pide que muestre la tele y termina (así el acceso
//     directo del escritorio sirve para volver a abrirla).
//   - Si no, arranca la app (app.js) en un proceso aparte y la reinicia si alguna vez se cae.

import { fork } from 'child_process';
import { join } from 'path';
import { PORTS } from './config/paths';
import { asRecord } from './infrastructure/storage/json';

const MAX_WAIT_MS = 30_000;
const QUICK_CRASH_MS = 30_000;

async function alreadyRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORTS.server}/api/v2/`, { signal: AbortSignal.timeout(1500) });
    return asRecord(await res.json())['controltv'] === true;
  } catch {
    return false;
  }
}

async function askToShow(): Promise<void> {
  await fetch(`http://127.0.0.1:${PORTS.server}/api/show`, { method: 'POST', signal: AbortSignal.timeout(3000) })
    .catch(() => undefined);
}

function supervise(): void {
  let restarts = 0;
  const start = (): void => {
    const startedAt = Date.now();
    const child = fork(join(__dirname, 'app.js'), [], { stdio: 'inherit' });
    child.on('exit', (code) => {
      // Si se cae enseguida varias veces, esperamos cada vez más para no girar en falso.
      restarts = Date.now() - startedAt < QUICK_CRASH_MS ? restarts + 1 : 0;
      const wait = Math.min(MAX_WAIT_MS, 1000 * 2 ** restarts);
      console.log(`La app terminó (código ${String(code)}); se reinicia en ${wait / 1000}s`);
      setTimeout(start, wait);
    });
  };
  start();
}

void (async (): Promise<void> => {
  if (await alreadyRunning()) {
    await askToShow();
    process.exit(0);
  }
  supervise();
})();
