const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, existsSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');
const { FramexLibrary } = require('../dist/infrastructure/media/framex-library');
const { ImageCache } = require('../dist/infrastructure/media/image-cache');
const { Translator } = require('../dist/infrastructure/media/translator');

const temp = () => mkdtempSync(join(tmpdir(), 'controltv-'));
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const details = (title) => Response.json({ success: true, id: '1', type: 'movie', title, year: '2026', rating: '7', overview: '' });

test('catálogo en disco: al arrancar contesta lo guardado al instante y lo actualiza por detrás', async () => {
  const store = join(temp(), 'catalogo.json');
  const first = new FramexLibrary(async () => details('Viejo'), null, store);
  assert.equal((await first.query(new URLSearchParams({ op: 'details', id: '1', type: 'movie' }))).details.title, 'Viejo');
  await wait(3300); // se guarda con una pequeña demora
  assert.ok(existsSync(store));

  let calls = 0;
  const second = new FramexLibrary(async () => { calls++; await wait(50); return details('Nuevo'); }, null, store);
  const params = new URLSearchParams({ op: 'details', id: '1', type: 'movie' });
  assert.equal((await second.query(params)).details.title, 'Viejo', 'lo guardado, sin esperar a la red');
  await wait(120);
  assert.equal(calls, 1);
  assert.equal((await second.query(params)).details.title, 'Nuevo', 'la actualización ya quedó');
});

test('imágenes: sólo de TMDB, en WebP, una sola descarga y después del disco', async () => {
  let calls = 0;
  const images = new ImageCache(temp(), async (url, init) => {
    calls++;
    assert.match(init.headers.accept, /image\/webp/);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } });
  });
  const url = 'https://image.tmdb.org/t/p/w342/poster.jpg';
  const [a, b] = await Promise.all([images.get(url), images.get(url)]);
  assert.equal(a.type, 'image/webp');
  assert.equal(a.file, b.file);
  assert.ok(a.file.endsWith('.webp'));
  assert.equal((await images.get(url)).file, a.file);
  assert.equal(calls, 1);
  assert.equal(await images.get('http://localhost/secreto.jpg'), null);
  assert.equal(await images.get('https://image.tmdb.org/t/p/w342/../x.jpg'), null);
  assert.equal(calls, 1);
});

test('traductor: traduce una sola vez, recuerda en disco y si falla deja el original', async () => {
  const file = join(temp(), 'traducciones.json');
  let calls = 0;
  const translator = new Translator(file, async () => { calls++; return Response.json([['Una película', 'en']]); });
  assert.equal(await translator.translate('A movie'), 'Una película');
  assert.equal(await translator.translate('A movie'), 'Una película');
  assert.equal(translator.known('A movie'), 'Una película');
  assert.equal(calls, 1);
  await wait(4300);
  assert.equal(new Translator(file, async () => { throw new Error('no'); }).known('A movie'), 'Una película');

  const broken = new Translator(join(temp(), 'x.json'), async () => { throw new Error('sin red'); });
  assert.equal(await broken.translate('Another movie'), 'Another movie');
});

test('traductor: si uno limita (429) usa el otro, y con los dos limitando no hace esperar', async () => {
  const hosts = [];
  let limitAll = false;
  const translator = new Translator(join(temp(), 't.json'), async (url) => {
    const host = new URL(url).hostname;
    hosts.push(host);
    if (limitAll || host === 'clients5.google.com') return new Response('Sorry', { status: 429 });
    return Response.json([[['Hola mundo', 'Hello world']]]);
  });
  assert.equal(await translator.translate('Hello world'), 'Hola mundo');
  assert.deepEqual(hosts, ['clients5.google.com', 'translate.googleapis.com']);
  limitAll = true;
  assert.equal(await translator.translate('Second text'), 'Second text');
  const before = hosts.length;
  assert.equal(await translator.translate('Third text'), 'Third text');
  assert.equal(hosts.length, before, 'los dos en pausa: ni se pregunta');
});
