// Node test runner: prueba contratos de comportamiento sin tocar el escritorio ni cuentas reales.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ScreenCommandQueue } = require('../dist/application/screen-command-queue');
const { EdgeScreen } = require('../dist/infrastructure/edge/edge-screen');
const { Signal } = require('../dist/domain/signal');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('panel abierto recibe Escape real y no navegación por historial', async () => {
  const calls = [];
  const edge = { urlChanged: new Signal(), popupRequested: new Signal(), page: async (method, params) => {
    calls.push([method, params]);
    return { result: { value: 'escape' } };
  } };
  const screen = new EdgeScreen(edge, { forUrl: () => undefined }, 'http://127.0.0.1:8001/', {});
  edge.urlChanged.emit('https://example.com/');
  await screen.back();
  assert.equal(calls.some(([m]) => m === 'Page.getNavigationHistory'), false);
  assert.deepEqual(calls.filter(([m]) => m === 'Input.dispatchKeyEvent').map(([,p]) => [p.type,p.key]), [['rawKeyDown','Escape'],['keyUp','Escape']]);
});

test('texto sin campo confirmado no se envía al navegador', async () => {
  const calls = [];
  const edge = { urlChanged: new Signal(), popupRequested: new Signal(), ensure: async () => {}, page: async (method) => {
    calls.push(method); return { result: { value: false } };
  } };
  const screen = new EdgeScreen(edge, {}, '', {});
  await screen.insertText('texto de prueba');
  assert.deepEqual(calls, ['Runtime.evaluate']);
});

test('fallo al cambiar identidad impide navegar con la identidad de otra plataforma', async () => {
  const calls = [];
  const edge = { urlChanged: new Signal(), popupRequested: new Signal(), ensure: async () => {}, page: async (method) => {
    calls.push(method); throw new Error('conexión interrumpida');
  } };
  const screen = new EdgeScreen(edge, {}, '', {});
  await assert.rejects(screen.openApp({ url: 'https://example.com/browse', userAgent: null }), /interrumpida/);
  assert.deepEqual(calls, ['Network.setUserAgentOverride']);
});

test('flecha ambigua seguida de Enter y texto conserva el orden de llegada', async () => {
  const { RemoteCommandHandler } = require('../dist/application/remote-command-handler');
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
  const handler = new RemoteCommandHandler(screen, pointer, {}, { isOn: true, touch() {} }, {}, {});
  await handler.handle({ kind: 'key', key: 'DOWN' });
  const enter = handler.handle({ kind: 'key', key: 'OK' });
  const text = handler.handle({ kind: 'text', text: 'hola' });
  await tick();
  release();
  await Promise.all([enter, text]);
  assert.deepEqual(calls, ['DOWN', 'ENTER', 'hola']);
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

test('Atrás restablece identidad ANTES de navegar desde YouTube TV a otra app', async () => {
  const calls = [];
  const edge = {
    urlChanged: new Signal(), popupRequested: new Signal(),
    page: async (method, params) => {
      calls.push([method, params]);
      if (method === 'Runtime.evaluate') return { result: { value: false } };
      if (method === 'Page.getNavigationHistory') return { currentIndex: 1, entries: [{ id: 8, url: 'https://example.com/browse' }] };
      return {};
    },
  };
  const screen = new EdgeScreen(edge, { forUrl: () => undefined }, 'http://127.0.0.1:8001/', { info() {}, warn() {} });
  edge.urlChanged.emit('https://www.youtube.com/tv');
  await screen.back();
  assert.deepEqual(calls.slice(-2), [
    ['Network.setUserAgentOverride', { userAgent: '' }],
    ['Page.navigateToHistoryEntry', { entryId: 8 }],
  ]);
});

test('reposo: actividad mientras se consulta el video no termina en ahorro', async () => {
  const { IdlePowerService } = require('../dist/application/idle-power-service');
  let release;
  const activations = [];
  const service = new IdlePowerService(
    { activate: async mode => { activations.push(mode); } },
    { msSinceInput: () => 999999, isMediaPlaying: () => new Promise(resolve => { release = resolve; }) },
    { isOn: true }, { get: () => 1 }, { info() {}, warn() {} },
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
  const { InputHost } = require('../dist/infrastructure/windows/input-host');
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

test('reconexión CDP conserva la plataforma y libera el socket anterior', async () => {
  const { EdgeConnection } = require('../dist/infrastructure/edge/edge-connection');
  const { CdpClient } = require('../dist/infrastructure/edge/cdp-client');
  const calls = [];
  const originalProbe = CdpClient.probe;
  const originalConnect = CdpClient.connect;
  const client = {
    isOpen: true, on() {}, onClose() {},
    send: async (method, params) => {
      calls.push([method, params]);
      if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'movie', type: 'page', url: 'https://example.com/watch/123' }] };
      if (method === 'Target.attachToTarget') return { sessionId: 'session' };
      if (method === 'SystemInfo.getProcessInfo') return { processInfo: [] };
      if (method === 'Browser.getWindowBounds') return { bounds: { windowState: 'fullscreen' } };
      return {};
    },
  };
  CdpClient.probe = async () => ({ userAgent: 'Edge', webSocketDebuggerUrl: 'unused' });
  CdpClient.connect = async () => client;
  try {
    const edge = new EdgeConnection({ injectScript: require('node:path').join(__dirname, '../ui/js/inject.js'), port: 0, homeUrl: 'http://127.0.0.1:8001/', headless: true }, { info() {}, warn() {} });
    let closed = false;
    let url;
    edge.client = { close() { closed = true; } };
    edge.urlChanged.subscribe(value => { url = value; });
    await edge.ensure();
    assert.equal(closed, true);
    assert.equal(url, 'https://example.com/watch/123');
    assert.equal(calls.some(([method]) => method === 'Page.navigate'), false);
  } finally {
    CdpClient.probe = originalProbe;
    CdpClient.connect = originalConnect;
  }
});
