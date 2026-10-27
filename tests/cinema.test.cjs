const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { readFileSync, existsSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { CdpClient } = require('../dist/infrastructure/edge/cdp-client');
const root = resolve(__dirname, '..');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

test('Cine propio: catálogo con flechas, ficha, reproducción real y liberación al salir', { timeout: 90000 }, async (t) => {
  let videoBytes = Buffer.alloc(0);
  const movie = { id: '1', type: 'movie', title: 'Muestra de prueba', poster: '', backdrop: '', year: '2026', rating: '7.5', overview: 'Video generado localmente.', genres: ['Prueba'], runtime: 90, cast: [], seasons: [] };
  const tv = { id: '2', type: 'tv', title: 'Serie de prueba', poster: '', backdrop: '', year: '2025', rating: '8.0', overview: 'Serie de prueba.', genres: ['Drama'], runtime: null, cast: [{ name: 'Ana', character: 'Marta' }], seasons: [{ number: 1, name: 'Season 1', episodes: 1 }] };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/library') {
      const op = url.searchParams.get('op');
      let body;
      if (op === 'home') body = { hero: movie, rows: [{ name: 'Pruebas', items: [movie, tv] }] };
      else if (op === 'search') body = { items: [{ ...movie, title: 'Resultado de búsqueda' }] };
      else if (op === 'details') body = { details: url.searchParams.get('id') === '2' ? tv : movie };
      else if (op === 'season') body = { episodes: [{ season: 1, episode: 1, name: 'Piloto', overview: 'El comienzo.', still: '', rating: '8.0' }] };
      else if (op === 'providers') body = { providers: [{ id: 'test', name: 'Servidor de prueba', tagline: 'Local' }] };
      else body = { provider: 'test', sources: [{ url: '/video.webm', type: 'mp4', quality: 'Muestra local', server: 'Local' }], subtitles: [], alternates: [] };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
      return;
    }
    if (url.pathname === '/video.webm') {
      res.setHeader('Content-Type', 'video/webm');
      res.end(videoBytes);
      return;
    }
    const files = {
      '/cinema.html': ['ui/cinema.html', 'text/html'], '/cinema.css': ['ui/cinema.css', 'text/css'],
      '/js/cinema.js': ['ui/js/cinema.js', 'text/javascript'], '/fonts/inter.woff2': ['ui/fonts/inter.woff2', 'font/woff2'],
      '/app-icons/cinema.svg': ['ui/app-icons/cinema.svg', 'image/svg+xml'],
    };
    const file = files[url.pathname];
    if (!file) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', file[1]);
    res.end(readFileSync(join(root, file[0])));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  assert.ok(exe);
  const port = 19446;
  assert.equal(await CdpClient.probe(port), null);
  const profile = join(root, 'work', `cinema-test-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const child = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--window-size=1366,768', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let client;
  t.after(async () => { if (client) { await client.send('Browser.close', {}).catch(() => {}); client.close(); } else child.kill(); });
  let version;
  for (let i = 0; i < 80 && !version; i++) { await delay(200); version = await CdpClient.probe(port); }
  assert.ok(version, 'Edge inició');
  client = await CdpClient.connect(version.webSocketDebuggerUrl);
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => client.send(method, params, sessionId);
  const evaluate = async (expression) => {
    const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(value.exceptionDetails, undefined, JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  const until = async (expression) => {
    for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await delay(50); }
    assert.fail(`Tiempo agotado: ${expression}`);
  };
  const key = async (key, vk) => {
    await send('Input.dispatchKeyEvent', { type: key === 'Enter' ? 'keyDown' : 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, ...(key === 'Enter' ? { text: '\r' } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk });
  };
  // Video local de un lienzo; no usa películas, cuentas ni servidores externos.
  videoBytes = Buffer.from(await evaluate(`new Promise(resolve=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const context=canvas.getContext('2d'); const stream=canvas.captureStream(10);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});const chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());
      resolve(btoa(String.fromCharCode(...bytes)));
    };recorder.start();let frame=0;const timer=setInterval(()=>{context.fillStyle=frame%2?'red':'blue';context.fillRect(0,0,320,180);if(++frame===12){clearInterval(timer);recorder.stop();}},100);
  })`), 'base64');
  await send('Page.navigate', { url: `${origin}/cinema.html` });
  await until('document.querySelectorAll(".card").length===2');
  assert.equal(await evaluate('document.getElementById("hero").hidden'), false);
  assert.equal(await evaluate('document.activeElement.id'), 'heroPlay', 'Empieza en Reproducir');
  await key('ArrowDown', 40);
  assert.equal(await evaluate('document.activeElement.classList.contains("card")'), true, 'Baja a la primera fila');
  await key('Enter', 13);
  await until('!document.getElementById("details").hidden');
  await until('!document.getElementById("detailPlay").disabled && document.activeElement.id==="detailPlay"');
  await key('Enter', 13);
  await until('!document.getElementById("player").hidden');
  await until('document.getElementById("video").currentTime>0');
  const frames = await evaluate('document.getElementById("video").getVideoPlaybackQuality().totalVideoFrames');
  assert.ok(frames > 0, 'Video realmente decodificado');
  assert.equal(await evaluate('window.__controlTvBack()'), true);
  assert.equal(await evaluate('document.getElementById("player").hidden'), true);
  assert.equal(await evaluate('document.getElementById("details").hidden'), false, 'Vuelve a la ficha');
  assert.equal(await evaluate('window.__controlTvBack()'), true);
  assert.equal(await evaluate('document.getElementById("details").hidden'), true);
  assert.equal(await evaluate('document.activeElement.classList.contains("card")'), true, 'Restaura el foco del catálogo');

  assert.equal(await evaluate('window.__controlTvPrepareText()'), true);
  assert.equal(await evaluate('document.activeElement.id'), 'search');
  await send('Input.insertText', { text: 'prueba' });
  await key('Enter', 13);
  await until('document.querySelector(".card .name")?.textContent==="Resultado de búsqueda"');
  assert.match(await evaluate('document.getElementById("status").textContent'), /1 resultados/);
  assert.equal(await evaluate('window.__controlTvBack()'), true);
  await until('document.querySelectorAll(".card").length===2');

  await key('ArrowDown', 40);
  await key('ArrowRight', 39);
  await key('Enter', 13);
  await until('!document.getElementById("seasonBar").hidden');
  await until('document.querySelectorAll(".episode").length===1');
  assert.equal(await evaluate('document.activeElement.id'), 'detailPlay');
  await key('ArrowDown', 40); // acciones -> temporadas
  await key('ArrowDown', 40); // temporadas -> primer episodio
  assert.equal(await evaluate('document.activeElement.classList.contains("episode")'), true);
  await key('Enter', 13);
  await until('!document.getElementById("player").hidden && document.getElementById("video").currentTime>0');
  assert.match(await evaluate('document.getElementById("playingMeta").textContent'), /T1 E1/);
  await evaluate('window.__controlTvBack()');
  assert.equal(await evaluate('document.getElementById("player").hidden'), true);
  console.log('Cine propio: catálogo, ficha, serie y reproducción local. Cuadros:', frames);
});
