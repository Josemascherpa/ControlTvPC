// Node test runner: prueba contratos de comportamiento sin tocar el escritorio ni cuentas reales.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ScreenCommandQueue } = require('../dist/src/application/screen-command-queue');
const { EdgeScreen } = require('../dist/src/infrastructure/edge/edge-screen');
const { Signal } = require('../dist/src/domain/signal');
const tick = () => new Promise(resolve => setImmediate(resolve));
const quiet = { info() {}, warn() {} };
const fakeEdge = (page) => ({ urlChanged: new Signal(), popupRequested: new Signal(), isReady: true, ensure: async () => {}, bringToFront: async () => {}, page });

test('Atrás: si el Cine no tiene nada abierto, recibe Escape real (no hay historial)', async () => {
  const calls = [];
  const edge = fakeEdge(async (method, params) => {
    calls.push([method, params]);
    return { result: { value: false } };
  });
  const screen = new EdgeScreen(edge, 'http://127.0.0.1:8001/', quiet);
  await screen.back();
  assert.ok(calls[0][1].expression.includes('__controlTvBack'), 'Primero le pregunta al Cine');
  assert.deepEqual(calls.filter(([m]) => m === 'Input.dispatchKeyEvent').map(([, p]) => [p.type, p.key]), [['rawKeyDown', 'Escape'], ['keyUp', 'Escape']]);
});

test('Atrás: si el Cine cerró algo (ficha, video), no se manda nada más', async () => {
  const calls = [];
  const screen = new EdgeScreen(fakeEdge(async (method) => { calls.push(method); return { result: { value: true } }; }), 'http://127.0.0.1:8001/', quiet);
  await screen.back();
  assert.deepEqual(calls, ['Runtime.evaluate']);
});

test('texto sin campo confirmado no se envía al navegador', async () => {
  const calls = [];
  const screen = new EdgeScreen(fakeEdge(async (method) => { calls.push(method); return { result: { value: false } }; }), '', quiet);
  await screen.insertText('texto de prueba');
  assert.deepEqual(calls, ['Runtime.evaluate']);
});

test('Inicio: el Cine vuelve al principio sin recargar; si no contesta, se recarga', async () => {
  for (const answers of [true, false]) {
    const calls = [];
    const screen = new EdgeScreen(fakeEdge(async (method, params) => { calls.push([method, params]); return { result: { value: answers } }; }), 'http://127.0.0.1:8001/', quiet);
    await screen.goHome();
    assert.ok(calls[0][1].expression.includes('__controlTvHome'));
    assert.deepEqual(calls.filter(([m]) => m === 'Page.navigate').map(([, p]) => p.url), answers ? [] : ['http://127.0.0.1:8001/']);
  }
});

test('sólo el Cine: si algo lleva a otra página, se vuelve al Cine', async () => {
  const calls = [];
  const edge = fakeEdge(async (method, params) => { calls.push([method, params]); return {}; });
  new EdgeScreen(edge, 'http://127.0.0.1:8001/', quiet);
  edge.urlChanged.emit('http://127.0.0.1:8001/');
  edge.urlChanged.emit('https://publicidad.example/');
  await tick();
  assert.deepEqual(calls.map(([m, p]) => [m, p.url]), [['Page.navigate', 'http://127.0.0.1:8001/']]);
});

test('búsqueda del celular: se busca en el Cine; otras direcciones no se abren', async () => {
  const calls = [];
  const screen = new EdgeScreen(fakeEdge(async (method, params) => { calls.push([method, params]); return { result: { value: true } }; }), 'http://127.0.0.1:8001/', quiet);
  await screen.openUrl('https://www.google.com/search?q=el%20padrino');
  const searched = calls.find(([m, p]) => m === 'Runtime.evaluate' && String(p?.expression).includes('__controlTvSearch'));
  assert.ok(searched?.[1].expression.includes('"el padrino"'), 'Le pasa lo buscado al Cine (como texto, sin código)');
  calls.length = 0;
  await screen.openUrl('https://www.youtube.com/watch?v=abc');
  assert.deepEqual(calls, [], 'Ni navega ni evalúa nada');
});

test('flecha ambigua seguida de Enter y texto conserva el orden de llegada', async () => {
  const { RemoteCommandHandler } = require('../dist/src/application/remote-command-handler');
  const calls = [];
  let release;
  const screen = {
    pressKey: async key => {
      calls.push(key);
      if (key === 'DOWN') await new Promise(resolve => { release = resolve; });
    },
    insertText: async text => { calls.push(text); },
  };
  const pointer = { inUse: true, hide() { this.inUse = false; }, scroll() {} };
  const handler = new RemoteCommandHandler(screen, pointer, {}, { isOn: true, touch() {} }, {});
  await handler.handle({ kind: 'key', key: 'DOWN' });
  const enter = handler.handle({ kind: 'key', key: 'OK' });
  const text = handler.handle({ kind: 'text', text: 'hola' });
  await tick();
  release();
  await Promise.all([enter, text]);
  assert.deepEqual(calls, ['DOWN', 'ENTER', 'hola']);
});

test('botones Inicio y Menú del celular: los dos vuelven al principio del Cine', async () => {
  const { RemoteCommandHandler } = require('../dist/src/application/remote-command-handler');
  let homes = 0;
  const screen = { goHome: async () => { homes++; } };
  const handler = new RemoteCommandHandler(screen, { inUse: false, hide() {} }, {}, { isOn: true, touch() {} }, {});
  await handler.handle({ kind: 'key', key: 'HOME' });
  await handler.handle({ kind: 'key', key: 'MENU' });
  assert.equal(homes, 2);
});

test('pantalla lenta: acota flechas y respeta Enter y cambios de dirección', async () => {
  const queue = new ScreenCommandQueue();
  let release;
  const calls = [];
  const first = queue.run(() => new Promise(resolve => { release = resolve; }));
  const jobs = Array.from({ length: 1000 }, () => queue.run(async () => { calls.push('DOWN'); }, 'DOWN'));
  jobs.push(queue.run(async () => { calls.push('ENTER'); }));
  jobs.push(queue.run(async () => { calls.push('UP'); }, 'UP'));
  release();
  await Promise.all([first, ...jobs]);
  assert.deepEqual(calls, ['DOWN', 'ENTER', 'UP']);
});

test('una orden fallida no bloquea las siguientes y la cola tiene límite', async () => {
  const queue = new ScreenCommandQueue();
  await assert.rejects(queue.run(async () => { throw new Error('offline'); }), /offline/);
  let release;
  const busy = queue.run(() => new Promise(resolve => { release = resolve; }));
  const jobs = Array.from({ length: 32 }, () => queue.run(async () => {}));
  await assert.rejects(queue.run(async () => {}), /demasiadas/);
  release();
  await Promise.all([busy, ...jobs]);
});

test('apagado automático: no corta la imagen si se está viendo algo', async () => {
  const { PowerService } = require('../dist/src/application/power-service');
  let playing = true;
  let goneHome = 0;
  const display = { keepAwake() {}, turnOff() {}, turnOn() {} };
  const service = new PowerService(display, { goHome: async () => { goneHome++; } }, { lock() {} }, { get: () => 1 }, quiet, { isPlaying: async () => playing });
  service.lastActivity = 0;
  await service.checkAutoOff();
  assert.equal(service.isOn, true, 'Con un video en curso sigue prendida');
  playing = false;
  await service.checkAutoOff();
  assert.equal(service.isOn, false);
  assert.equal(goneHome, 1, 'Al apagar, el Cine corta el video y vuelve al principio');
});

test('reposo: actividad mientras se consulta el video no termina en ahorro', async () => {
  const { IdlePowerService } = require('../dist/src/application/idle-power-service');
  let release;
  const activations = [];
  const service = new IdlePowerService(
    { activate: async mode => { activations.push(mode); } },
    { msSinceInput: () => 999999, isMediaPlaying: () => new Promise(resolve => { release = resolve; }) },
    { isOn: true }, { get: () => 1 }, quiet,
  );
  service.lastActivity = 0;
  const check = service.check();
  service.lastActivity = Date.now();
  release(false);
  await check;
  await tick();
  assert.deepEqual(activations, []);
});

test('puntero: movimiento acumulado precede al clic, sin duplicarse en drain', () => {
  const { InputHost } = require('../dist/src/infrastructure/windows/input-host');
  const { EventEmitter } = require('node:events');
  const stdin = new EventEmitter();
  const commands = [];
  stdin.writableNeedDrain = true;
  stdin.write = text => { commands.push(text); return true; };
  const host = new InputHost('', { warn() {} });
  host.process = { stdin };
  host.move(3, 4);
  host.move(5, 6);
  host.send('click');
  for (let i = 0; i < 20; i++) { host.move(1, 0); host.send('hide'); }
  assert.equal(stdin.listenerCount('drain'), 1, 'Sólo una espera de drain aunque se intercalen clics');
  stdin.emit('drain');
  assert.deepEqual(commands.slice(0, 2), ['move 8.00 10.00\n', 'click\n']);
  assert.equal(commands.length, 42);
});

test('reconexión CDP conserva la página y libera el socket anterior', async () => {
  const { EdgeConnection } = require('../dist/src/infrastructure/edge/edge-connection');
  const { CdpClient } = require('../dist/src/infrastructure/edge/cdp-client');
  const calls = [];
  const originalProbe = CdpClient.probe;
  const originalConnect = CdpClient.connect;
  const client = {
    isOpen: true, on() {}, onClose() {},
    send: async (method, params) => {
      calls.push([method, params]);
      if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'cine', type: 'page', url: 'http://127.0.0.1:8001/#reproduciendo' }] };
      if (method === 'Target.attachToTarget') return { sessionId: 'session' };
      if (method === 'SystemInfo.getProcessInfo') return { processInfo: [] };
      if (method === 'Browser.getWindowBounds') return { bounds: { windowState: 'fullscreen' } };
      return {};
    },
  };
  CdpClient.probe = async () => ({ userAgent: 'Edge', webSocketDebuggerUrl: 'unused' });
  CdpClient.connect = async () => client;
  try {
    const edge = new EdgeConnection({ injectScript: require('node:path').join(__dirname, '../ui/js/web/inject.js'), port: 0, homeUrl: 'http://127.0.0.1:8001/', headless: true }, quiet);
    let closed = false;
    let url;
    edge.client = { close() { closed = true; } };
    edge.urlChanged.subscribe(value => { url = value; });
    await edge.ensure();
    assert.equal(closed, true);
    assert.equal(url, 'http://127.0.0.1:8001/#reproduciendo');
    assert.equal(calls.some(([method]) => method === 'Page.navigate'), false, 'Reconectar no recarga el Cine (no corta la película)');
  } finally {
    CdpClient.probe = originalProbe;
    CdpClient.connect = originalConnect;
  }
});
