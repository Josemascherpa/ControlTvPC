const { test, before } = require('node:test');
const assert = require('node:assert/strict');

// Caché del Cine: lo guardado en el navegador (acá, la versión en memoria con la misma interfaz que IndexedDB).
let FramexLibrary;
let Translator;
let MemoryStore;
before(async () => {
  ({ FramexLibrary } = await import('../ui/js/web/cine/library.js'));
  ({ Translator } = await import('../ui/js/web/cine/translator.js'));
  ({ MemoryStore } = await import('../ui/js/web/cine/store.js'));
});

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const details = (title) => Response.json({ success: true, id: '1', type: 'movie', title, year: '2026', rating: '7', overview: '' });
const params = () => new URLSearchParams({ op: 'details', id: '1', type: 'movie' });

test('catálogo guardado: al volver a abrir contesta lo guardado al instante y lo actualiza por detrás', async () => {
  const store = new MemoryStore();
  const first = new FramexLibrary(async () => details('Viejo'), null, store);
  assert.equal((await first.query(params())).details.title, 'Viejo');
  assert.equal((await store.entries()).length, 1, 'Quedó guardado');

  let calls = 0;
  const second = new FramexLibrary(async () => { calls++; await wait(50); return details('Nuevo'); }, null, store);
  assert.equal((await second.query(params())).details.title, 'Viejo', 'Lo guardado, sin esperar a la red');
  await wait(120);
  assert.equal(calls, 1, 'Se actualizó por detrás una sola vez');
  assert.equal((await second.query(params())).details.title, 'Nuevo', 'La actualización ya quedó');
});

test('guardado acotado: se borran los registros más viejos', async () => {
  const store = new MemoryStore();
  for (let i = 0; i < 5; i++) await store.set(`k${i}`, i);
  await store.trim(2);
  assert.deepEqual((await store.entries()).map(([key]) => key), ['k3', 'k4']);
});

test('traductor: traduce una sola vez, lo guarda y si falla deja el original', async () => {
  const store = new MemoryStore();
  let calls = 0;
  const translator = new Translator(store, async () => { calls++; return Response.json([['Una película', 'en']]); });
  assert.equal(await translator.translate('A movie'), 'Una película');
  assert.equal(await translator.translate('A movie'), 'Una película');
  assert.equal(translator.known('A movie'), 'Una película');
  assert.equal(calls, 1);
  const reopened = new Translator(store, async () => { throw new Error('no'); });
  await reopened.ready();
  assert.equal(reopened.known('A movie'), 'Una película', 'La traducción quedó guardada');

  const broken = new Translator(new MemoryStore(), async () => { throw new Error('sin red'); });
  assert.equal(await broken.translate('Another movie'), 'Another movie');
});

test('traductor: si uno limita (429) usa el otro, y con los dos limitando no hace esperar', async () => {
  const hosts = [];
  let limitAll = false;
  const translator = new Translator(new MemoryStore(), async (url) => {
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
  assert.equal(hosts.length, before, 'Los dos en pausa: ni se pregunta');
});

test('sinopsis en español: la ficha espera la traducción; el catálogo usa las ya hechas', async () => {
  const store = new MemoryStore();
  const translator = new Translator(store, async () => Response.json([['Un ladrón roba sueños.', 'en']]));
  const raw = { success: true, id: '1', type: 'movie', title: 'Origen', overview: 'A thief steals dreams.' };
  const library = new FramexLibrary(async () => Response.json(raw), translator, null);
  assert.equal((await library.query(params())).details.overview, 'Un ladrón roba sueños.');
});

test('subtítulos: reutiliza el texto validado entre instancias sin volver a descargar',async()=>{
 const store=new MemoryStore();let requests=0;
 const request=async()=>{requests++;return new Response('WEBVTT\n\n00:00.000 --> 00:01.000\nHola')};
 const first=new FramexLibrary(request,null,store);
 const url='https://subs5.strem.io/es/cached.vtt';
 const text=await first.subtitle(url);
 assert.match(text,/^WEBVTT/);
 const reopened=new FramexLibrary(request,null,store);
 assert.equal(await reopened.subtitle(url),text);
 assert.equal(requests,1);
 assert.equal(await reopened.subtitle('https://evil.example/sub.vtt'),null);
});

test('servidor utilizable no espera indefinidamente subtítulos externos',async()=>{
 const library=new FramexLibrary(async(input)=>{
  const path=new URL(input).pathname;
  if(path==='/api/subtitles')return new Promise(()=>{});
  if(path==='/api/stream')return Response.json({success:true,sources:[{url:'https://video.example/movie.mp4',type:'mp4',audio:'es'}]});
  return Response.json({});
 },null,null);
 const result=await Promise.race([
  library.query(new URLSearchParams({op:'stream',id:'1',type:'movie',provider:'test'})),
  new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('El subtítulo bloqueó la fuente')),1500);timer.unref()}),
 ]);
 assert.equal(result.sources[0].audio,'es');
});
