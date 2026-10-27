const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { readFileSync, existsSync, mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { CdpClient } = require('../dist/infrastructure/edge/cdp-client');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const root = resolve(__dirname, '..');

test('Edge aislado: foco, activación, diálogo, texto y navegación sin secuestrar reproductores', { timeout: 90000 }, async (t) => {
  const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  assert.ok(exe, 'Requiere Microsoft Edge instalado');
  const port = 19444;
  assert.equal(await CdpClient.probe(port), null, 'El puerto de prueba debe estar libre');
  const profile = join(root, 'work', `browser-test-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const child = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1366,768', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let client;
  t.after(async () => {
    if (client) {
      await client.send('Browser.close', {}).catch(() => {});
      client.close();
    } else child.kill();
  });
  let version;
  for (let n = 0; n < 80 && !version; n++) { await delay(200); version = await CdpClient.probe(port); }
  assert.ok(version, 'Edge inició');
  client = await CdpClient.connect(version.webSocketDebuggerUrl);
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => client.send(method, params, sessionId);
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(response.exceptionDetails, undefined, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  let html = '';
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  client.on('Fetch.requestPaused', ({ requestId }, sid) => {
    void client.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from(html).toString('base64') }, sid).catch(() => {});
  });
  const script = readFileSync(join(root, 'ui/js/inject.js'), 'utf8');
  let sequence = 0;
  const load = async (body, url = 'https://fixture.invalid/', source = script) => {
    const marker = `fixture-${++sequence}`;
    html = `<!doctype html><html><head><title>${marker}</title><style>body{margin:0}button,[role=button],a,input{display:inline-block;width:100px;height:50px;margin:20px}</style></head><body>${body}</body></html>`;
    await send('Page.navigate', { url: `${url}${url.includes('?') ? '&' : '?'}test=${sequence}` });
    for (let n = 0; n < 100; n++) {
      if (await evaluate(`document.title === ${JSON.stringify(marker)} && document.readyState === 'complete'`)) break;
      await delay(20);
    }
    assert.equal(await evaluate('document.title'), marker);
    await evaluate(source);
  };
  const key = async (key, vk) => {
    await send('Input.dispatchKeyEvent', { type: key === 'Enter' ? 'keyDown' : 'rawKeyDown', key, code: key, windowsVirtualKeyCode: vk, ...(key === 'Enter' ? { text: '\r' } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk });
  };
  await load('<div role="button" id="custom" onclick="window.clicked=(window.clicked||0)+1">Seleccionar</div>');
  await key('ArrowDown', 40);
  assert.equal(await evaluate('document.activeElement.id'), 'custom');
  await key('Enter', 13);
  assert.equal(await evaluate('window.clicked'), 1, 'Botón ARIA se activa exactamente una vez');

  await load('<button id="native" onclick="window.clicked=(window.clicked||0)+1">Nativo</button>');
  await key('ArrowDown', 40); await key('Enter', 13);
  assert.equal(await evaluate('window.clicked'), 1, 'Botón HTML no recibe doble clic');

  // Una SPA reemplaza los controles: el cache tiene que incorporar el DOM nuevo.
  await evaluate(`document.body.replaceChildren(Object.assign(document.createElement('button'), {id:'replacement',textContent:'Nuevo'}))`);
  await key('ArrowDown', 40);
  assert.equal(await evaluate('document.activeElement.id'), 'replacement');

  await load('<button disabled>Deshabilitado</button><button aria-hidden="true">Oculto</button><button id="enabled">Habilitado</button>');
  await key('ArrowDown', 40);
  assert.equal(await evaluate('document.activeElement.id'), 'enabled');

  await load('<input id="text"><button>Otro</button>');
  await evaluate('document.querySelector("input").focus()');
  await key('ArrowDown', 40);
  assert.equal(await evaluate('document.activeElement.id'), 'text');

  await load('<button id="outside">Exterior</button><div role="dialog"><button id="inside">Interior</button></div>');
  await evaluate('document.getElementById("outside").focus()');
  await key('ArrowDown', 40);
  assert.equal(await evaluate('document.activeElement.id'), 'inside');

  await load('<input type="search" id="search"><button>Otro</button>');
  assert.equal(await evaluate('window.__controlTvPrepareText()'), true);
  assert.equal(await evaluate('document.activeElement.id'), 'search');
  await load('<input type="password" id="password"><input type="email" id="email">');
  assert.equal(await evaluate('window.__controlTvPrepareText()'), false, 'No elegir campos sensibles sin foco');
  await evaluate('document.getElementById("password").focus()');
  assert.equal(await evaluate('window.__controlTvPrepareText()'), true, 'Respetar campo elegido por el usuario');
  await load('<input type="search"><input type="search">');
  assert.equal(await evaluate('window.__controlTvPrepareText()'), false, 'Dos buscadores son ambiguos');

  // Mismos contratos accesibles en todos los hosts (fixtures, no certificación del sitio real).
  for (const host of ['twitch.tv', 'kick.com', 'open.spotify.com', 'youtube.com', 'example.com']) {
    await load('<button id="trigger" aria-expanded="true" aria-controls="options" onclick="document.getElementById(\'options\').remove();this.setAttribute(\'aria-expanded\',\'false\')">Menú</button><div role="menu" id="options"><button id="item">Subtítulos</button></div>', `https://${host}/`);
    await key('ArrowDown', 40);
    assert.equal(await evaluate('document.activeElement.id'), 'item', `Foco dentro del menú: ${host}`);
    assert.equal(await evaluate('window.__controlTvBack()'), true);
    assert.equal(await evaluate('document.activeElement.id'), 'trigger', `Foco vuelve al disparador: ${host}`);
    assert.equal(await evaluate('document.getElementById("options") === null'), true);
  }
  await load('<dialog open><button>Acción</button></dialog>');
  assert.equal(await evaluate('window.__controlTvBack()'), 'escape', 'Solicita Escape real para panel sin botón de cierre');

  await load('<div style="display:flex;overflow:auto;width:180px"><button id="first" style="flex-shrink:0">Uno</button><button id="next" style="flex-shrink:0">Dos</button></div>');
  await evaluate('document.getElementById("first").focus()');
  await key('ArrowRight', 39);
  assert.equal(await evaluate('document.activeElement.id'), 'next', 'Carrusel con desplazamiento horizontal');

  for (const url of ['https://www.youtube.com/tv', 'https://www.youtube.com/watch?v=1']) {
    await load('<button id="control">Control del reproductor</button>', url);
    await key('ArrowDown', 40);
    assert.equal(await evaluate('document.querySelector("[data-ctv-focus]") === null'), true, `No secuestrar teclas: ${url}`);
  }

  // Comparación reproducible del trabajo DOM en una página estable, sin cuentas ni red externa.
  const fixture = Array.from({ length: 1500 }, (_, i) => `<button id="b${i}">${i}</button>`).join('');
  await load(fixture);
  const sample = await evaluate(`(() => {
    let queries=0; const original=document.querySelectorAll.bind(document);
    document.querySelectorAll=function(selector){if(selector.startsWith('a[href]')) queries++;return original(selector)};
    const start=performance.now();
    for(let i=0;i<30;i++) dispatchEvent(new KeyboardEvent('keydown',{key:i%2?'ArrowRight':'ArrowLeft',bubbles:true,cancelable:true}));
    return {ms:performance.now()-start,queries};
  })()`);
  assert.ok(sample.queries <= 1, 'Lista de candidatos reutilizada en DOM estable');
  console.log('Navegación, 1500 botones / 30 flechas:', JSON.stringify(sample));
});
