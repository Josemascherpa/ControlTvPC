const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { readFileSync, existsSync, mkdirSync } = require('node:fs');
const { join, normalize, resolve, extname } = require('node:path');
const { CdpClient } = require('../dist/src/infrastructure/edge/cdp-client');
const root = resolve(__dirname, '..');
const ui = join(root, 'ui');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };

// El Cine consulta internet por su cuenta: la prueba sirve la app tal cual (la carpeta ui/) y Edge
// contesta los pedidos a la API de FrameX con datos de prueba en el formato real de la API (así se
// prueba también cómo la app los interpreta). Nada sale a internet.
const movie = { id: 1, type: 'movie', title: 'Muestra de prueba', poster: '', backdrop: '', year: '2026', rating: 7.5, overview: 'Video generado localmente.' };
const series = { id: 2, type: 'tv', title: 'Serie de prueba', poster: '', backdrop: '', year: '2025', rating: 8, overview: 'Serie de prueba.' };
function framex(url, videoUrl) {
  const path = url.pathname;
  if (path === '/api/home') return { success: true, hero: movie, rails: { trending_movies: { results: [movie, series] } } };
  if (path === '/api/search') return { success: true, totalPages: 1, results: [{ ...movie, title: 'Resultado de búsqueda' }] };
  if (path === '/api/details') {
    return url.searchParams.get('id') === '2'
      ? { ...series, success: true, genres: ['Drama'], cast: [{ name: 'Ana', character: 'Marta' }], seasons: [{ season_number: 1, name: 'Season 1', episode_count: 1 }], original_language: 'es' }
      : { ...movie, success: true, genres: ['Action'], runtime: 90, original_language: 'es' };
  }
  if (path === '/api/season') return { success: true, season_number: 1, episodes: [{ episode_number: 1, name: 'Piloto', overview: 'El comienzo.', still: '', vote_average: 8 }] };
  if (path === '/api/discover' || path === '/api/trending') return { success: true, results: [{ ...movie, id: 3, title: 'Película de la sección' }] };
  if (path === '/api/providers') return { providers: [{ id: 'test', name: 'Servidor de prueba', tagline: 'Local', status: 'available' }] };
  if (path === '/api/stream') return { success: true, provider: 'test', sources: [{ url: videoUrl, type: 'mp4', quality: 'Muestra local', server: 'Local', audio: 'es' }], subtitles: [], alternates: [] };
  return null;
}

test('Cine autónomo: catálogo con flechas, ficha, serie y reproducción real, consultando la API por su cuenta', { timeout: 90000 }, async (t) => {
  let videoBytes = Buffer.alloc(0);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/video.webm') {
      res.setHeader('Content-Type', 'video/webm');
      res.end(videoBytes);
      return;
    }
    // Sin la clave de TMDB de la persona (si la tiene): la prueba no sale a internet.
    if (url.pathname === '/ajustes.json') { res.statusCode = 404; res.end(); return; }
    const file = normalize(join(ui, url.pathname === '/' ? 'index.html' : url.pathname.slice(1)));
    if (!file.startsWith(ui) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
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
  const apiCalls = [];
  // Internet de mentira: FrameX contesta con datos de prueba; el traductor, sin respuesta (queda el texto original).
  client.on('Fetch.requestPaused', ({ requestId, request }) => {
    const url = new URL(request.url);
    const body = url.hostname === 'api.framextv.xyz' ? framex(url, `${origin}/video.webm`) : null;
    if (url.hostname === 'api.framextv.xyz') apiCalls.push(url.pathname);
    if (!body) { void send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {}); return; }
    void send('Fetch.fulfillRequest', {
      requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: Buffer.from(JSON.stringify(body)).toString('base64'),
    }).catch(() => {});
  });
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.framextv.xyz/*' }, { urlPattern: 'https://clients5.google.com/*' }, { urlPattern: 'https://translate.googleapis.com/*' }] });
  const evaluate = async (expression) => {
    const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(value.exceptionDetails, undefined, JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  const until = async (expression) => {
    for (let i = 0; i < 160; i++) { if (await evaluate(expression)) return; await delay(50); }
    const status = await evaluate('document.getElementById("status")?.textContent ?? document.title');
    assert.fail(`Tiempo agotado: ${expression} · estado: ${status} · pedidos a la API: ${apiCalls.join(', ') || 'ninguno'}`);
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
  await send('Page.navigate', { url: `${origin}/` });
  await until('document.querySelectorAll(".card").length===2');
  assert.ok(apiCalls.includes('/api/home'), 'La app pidió el catálogo directo a la API');
  assert.equal(await evaluate('document.getElementById("hero").hidden'), false);
  assert.equal(await evaluate('document.activeElement.id'), 'heroPlay', 'Empieza en Reproducir');
  await key('ArrowDown', 40);
  assert.equal(await evaluate('document.activeElement.classList.contains("card")'), true, 'Baja a la primera fila');
  await key('Enter', 13);
  await until('!document.getElementById("details").hidden');
  await until('!document.getElementById("detailPlay").disabled && document.activeElement.id==="detailPlay"');
  assert.match(await evaluate('document.getElementById("detailMeta").textContent'), /Acción/, 'Géneros en español');
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

  // Buscador: el teclado de la pantalla escribe en el mismo campo que el celular.
  await evaluate('document.querySelector(\'.menu-item[data-section="buscar"]\').click()');
  assert.equal(await evaluate('document.activeElement.className'), 'key', 'Se abre parado en el teclado');
  await key('Enter', 13); // "1"
  assert.equal(await evaluate('document.getElementById("search").value'), '1');
  await evaluate('[...document.querySelectorAll(".key")].find((k) => k.textContent === "Borrar todo").click()');
  assert.equal(await evaluate('window.__controlTvPrepareText()'), true);
  assert.equal(await evaluate('document.activeElement.id'), 'search');
  await send('Input.insertText', { text: 'prueba' });
  await key('Enter', 13);
  await until('document.querySelector(".card .name")?.textContent==="Resultado de búsqueda"');
  assert.match(await evaluate('document.getElementById("status").textContent'), /1 resultados/);
  assert.equal(await evaluate('window.__controlTvBack()'), true);
  await until('document.querySelectorAll(".card").length===2');

  // Botón Inicio: cierra lo abierto y vuelve al principio, sin recargar la app.
  await evaluate('window.__ctvSameDocument = true');
  await key('ArrowDown', 40);
  await key('Enter', 13);
  await until('!document.getElementById("details").hidden');
  assert.equal(await evaluate('window.__controlTvHome()'), true);
  assert.equal(await evaluate('document.getElementById("details").hidden && window.__ctvSameDocument === true'), true);
  assert.equal(await evaluate('document.activeElement.id'), 'heroPlay');

  await key('ArrowDown', 40);
  await key('ArrowRight', 39);
  await key('Enter', 13);
  await until('!document.getElementById("seasonBar").hidden');
  await until('document.querySelectorAll(".episode:not(.skeleton)").length===1');
  assert.equal(await evaluate('document.activeElement.id'), 'detailPlay');
  await key('ArrowDown', 40); // acciones -> temporadas
  await key('ArrowDown', 40); // temporadas -> primer episodio
  assert.equal(await evaluate('document.activeElement.classList.contains("episode")'), true);
  await key('Enter', 13);
  await until('!document.getElementById("player").hidden && document.getElementById("video").currentTime>0');
  assert.match(await evaluate('document.getElementById("playingMeta").textContent'), /T1 E1/);
  await evaluate('window.__controlTvBack()');
  assert.equal(await evaluate('document.getElementById("player").hidden'), true);

  assert.equal(await evaluate('window.__controlTvBack()'), true); // cierra la ficha de la serie
  // Menú de la izquierda: flecha izquierda desde el borde lo abre; Películas arma sus filas (sin clave
  // de TMDB, con FrameX) y el foco pasa al contenido.
  assert.equal(await evaluate('window.__controlTvHome()'), true);
  assert.equal(await evaluate('document.activeElement.id'), 'heroPlay');
  await key('ArrowLeft', 37);
  assert.equal(await evaluate('document.activeElement.dataset.section'), 'inicio', 'El menú se abre en la sección actual');
  await key('ArrowDown', 40);
  assert.equal(await evaluate('document.activeElement.dataset.section'), 'peliculas');
  await key('Enter', 13);
  await until('document.querySelectorAll(".row:not(.skeleton)").length > 3');
  assert.equal(await evaluate('document.getElementById("rail").contains(document.activeElement)'), false, 'Elegir cierra el menú');
  assert.ok(apiCalls.includes('/api/discover') && apiCalls.includes('/api/trending'));
  assert.equal(await evaluate('document.querySelector(".row h2").textContent'), 'Tendencias');
  // Aviso legal: se abre desde el menú y Atrás lo cierra.
  await evaluate('document.getElementById("legalBtn").click()');
  assert.match(await evaluate('document.getElementById("legal").textContent'), /no aloja ningún archivo/);
  assert.equal(await evaluate('window.__controlTvBack()'), true);
  assert.equal(await evaluate('document.getElementById("legal").hidden'), true);
  // Inicio vuelve al catálogo principal.
  assert.equal(await evaluate('window.__controlTvHome()'), true);
  await until('document.querySelectorAll(".card").length===2 && document.activeElement.id==="heroPlay"');

  // Lo visto queda guardado en el navegador: al recargar, el catálogo sale sin esperar a la API.
  apiCalls.length = 0;
  await send('Page.navigate', { url: `${origin}/` });
  await until('document.querySelectorAll(".card").length===2');
  console.log('Cine autónomo: catálogo, ficha, serie y reproducción local. Cuadros:', frames, '· pedidos a la API al recargar:', apiCalls.length);
});
