const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FramexLibrary } = require('../dist/infrastructure/media/framex-library');
const query = (value) => new URLSearchParams(value);
const tmdb = (size, file) => `https://image.tmdb.org/t/p/${size}/${file}.jpg`;

test('biblioteca: valida parámetros antes de hacer pedidos y no permite URLs arbitrarias', async () => {
  let count = 0;
  const library = new FramexLibrary(async () => { count++; return Response.json({}); });
  for (const params of [
    { op: 'proxy', url: 'http://localhost' },
    { op: 'stream', id: '../private', type: 'movie' },
    { op: 'stream', id: '1', type: 'movie', provider: 'x&url=y' },
    { op: 'season', id: '1', type: 'tv', season: 'NaN' },
    { op: 'details', id: '1', type: 'person' },
    { op: 'resolve', id: '1', type: 'person' },
  ]) {
    assert.ok((await library.query(query(params))).error, JSON.stringify(params));
  }
  assert.equal(count, 0);
});

test('biblioteca: catálogo con portada, filas limitadas, imágenes al tamaño justo y caché', async () => {
  let count = 0;
  const items = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1, type: 'movie', title: `Título ${index}`, year: '2026', rating: '7.1',
    poster: index % 2 ? 'javascript:alert(1)' : tmdb('w500', 'poster'),
    backdrop: index % 3 ? tmdb('w1280', 'backdrop') : 'https://via.placeholder.com/500x750',
    overview: 'x'.repeat(500),
  }));
  const library = new FramexLibrary(async (url) => {
    count++;
    assert.equal(new URL(url).origin, 'https://api.framextv.xyz');
    return Response.json({
      success: true,
      hero: { ...items[0], genres: ['Acción'] },
      rails: { trending_movies: { results: items }, popular_tv: { results: [] }, comedy_movies: { results: items.slice(0, 3) } },
    });
  });
  const [first, second] = await Promise.all([library.query(query({ op: 'home' })), library.query(query({ op: 'home' }))]);
  assert.equal(count, 1, 'Dos pedidos iguales se unifican');
  assert.deepEqual(first, second);
  assert.equal(first.rows.length, 2);
  assert.equal(first.rows[0].items.length, 20);
  assert.equal(first.rows[0].items[0].overview, '', 'Las tarjetas no cargan la sinopsis completa');
  assert.equal(first.rows[0].items[0].poster, tmdb('w342', 'poster'), 'Pide la portada chica');
  assert.equal(first.rows[0].items[1].poster, '', 'Descarta esquemas inseguros');
  assert.equal(first.rows[0].items[1].backdrop, tmdb('w780', 'backdrop'));
  assert.equal(first.hero.backdrop, '', 'Descarta las imágenes de relleno');
  assert.equal(first.hero.genres.length, 0, 'La portada no inventa géneros');
  await library.query(query({ op: 'home' }));
  assert.equal(count, 1, 'El catálogo se cachea');
});

test('biblioteca: ficha de serie con temporadas ordenadas, reparto y episodios', async () => {
  const library = new FramexLibrary(async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/details') {
      return Response.json({
        success: true, id: '9', type: 'tv', title: 'Serie', year: '2020', rating: '8.1',
        poster: tmdb('w500', 'poster'), backdrop: tmdb('w1280', 'backdrop'), overview: 'Sinopsis',
        genres: ['Drama', 'Drama', '  '],
        seasons: [
          { season_number: 2, name: 'Season 2', episode_count: 10 },
          { season_number: 0, name: 'Specials', episode_count: 2 },
          { season_number: 1, name: 'Season 1', episode_count: 8 },
        ],
        cast: [{ name: 'Ana', character: 'Marta' }, { name: 'Beto' }],
      });
    }
    if (path === '/api/season') {
      return Response.json({
        success: true, season_number: 1,
        episodes: [
          { episode_number: 2, name: 'Dos', overview: 'b', still: tmdb('w300', 'still'), vote_average: 7.8 },
          { episode_number: 1, name: 'Uno', overview: 'a' },
        ],
      });
    }
    return Response.json({});
  });
  const details = (await library.query(query({ op: 'details', id: '9', type: 'tv' }))).details;
  assert.deepEqual(details.seasons.map((season) => season.number), [1, 2, 0], 'Especiales al final');
  assert.deepEqual(details.genres, ['Drama']);
  assert.deepEqual(details.cast, [{ name: 'Ana', character: 'Marta' }, { name: 'Beto', character: '' }]);
  const episodes = (await library.query(query({ op: 'season', id: '9', type: 'tv', season: '1' }))).episodes;
  assert.deepEqual(episodes.map((episode) => episode.episode), [1, 2], 'Episodios en orden');
  assert.equal(episodes[1].still, tmdb('w342', 'still'));
  assert.equal(episodes[1].rating, '7.8');
  assert.equal(episodes[0].season, 1);
});

test('biblioteca: servidores disponibles, sin los que ejecutan código ajeno, en orden de preferencia', async () => {
  const library = new FramexLibrary(async () => Response.json({
    providers: [
      { id: 'unknown', name: 'Zeta', status: 'available' },
      { id: 'titan', name: 'Titan', status: 'available' },
      { id: 'royal_champion', name: 'Royal', status: 'available', tagline: 'HLS directo' },
      { id: 'down', name: 'Caído', status: 'down' },
      { id: 'client', name: 'Navegador', status: 'available', clientOnly: true },
    ],
  }));
  const providers = (await library.query(query({ op: 'providers' }))).providers;
  assert.deepEqual(providers.map((provider) => provider.id), ['royal_champion', 'titan', 'unknown']);
  assert.equal(providers[0].tagline, 'HLS directo');
});

test('biblioteca: sólo fuentes HLS/MP4, subtítulos del host permitido y alternativas válidas', async () => {
  let count = 0;
  const library = new FramexLibrary(async () => {
    count++;
    return Response.json({
      success: true, provider: 'titan',
      sources: [
        { url: 'https://video.test/a.m3u8', type: 'hls', quality: '1080p', server: 'Titan' },
        { url: 'https://video.test/a.m3u8', type: 'hls', quality: '1080p' },
        { url: 'https://video.test/embed', type: 'iframe' },
        { url: 'javascript:alert(1)', type: 'mp4' },
        { url: 'http://video.test/b.mp4', type: 'mp4', quality: '720p' },
      ],
      subtitles: [
        { url: 'https://subs5.strem.io/en/file', label: 'English', lang: 'en' },
        { url: 'https://subs5.strem.io/es/file', label: 'Español', lang: 'es' },
        { url: 'https://evil.test/es/file', label: 'Malo', lang: 'es' },
      ],
      alternates: ['royal_champion', 'titan', 'id inválido'],
    });
  });
  const params = query({ op: 'stream', id: '1', type: 'movie', provider: 'titan' });
  const reply = await library.query(params);
  assert.equal(reply.sources.length, 2);
  assert.equal(reply.sources[1].type, 'mp4');
  assert.equal(reply.subtitles.length, 2);
  assert.equal(reply.subtitles[0].lang, 'es', 'El español primero');
  assert.deepEqual(reply.alternates, ['royal_champion']);
  await library.query(params);
  assert.equal(count, 2, 'Las fuentes pueden vencer: no se cachean');
});

test('biblioteca: "Reproducir" prueba servidores en paralelo y recuerda la lista', async () => {
  const requests = [];
  const library = new FramexLibrary(async (url) => {
    const parsed = new URL(url);
    requests.push(`${parsed.pathname}?${parsed.searchParams.get('provider') ?? ''}`);
    if (parsed.pathname === '/api/providers') {
      return Response.json({
        providers: [
          { id: 'royal_champion', name: 'Royal', status: 'available' },
          { id: 'titan', name: 'Titan', status: 'available' },
          { id: 'giant', name: 'Giant', status: 'available' },
        ],
      });
    }
    const provider = parsed.searchParams.get('provider');
    return Response.json(provider === 'titan' || provider === 'giant'
      ? { success: true, provider, sources: [{ url: `https://video.test/${provider}.m3u8`, type: 'hls' }], subtitles: [] }
      : { success: false });
  });
  const reply = await library.query(query({ op: 'resolve', id: '1', type: 'movie' }));
  assert.equal(reply.provider, 'titan');
  assert.deepEqual(reply.alternates, ['royal_champion', 'giant']);
  const afterFirst = requests.filter((request) => request.startsWith('/api/providers')).length;
  assert.equal(afterFirst, 1);
  const next = await library.query(query({ op: 'resolve', id: '1', type: 'movie', exclude: 'royal_champion,titan' }));
  assert.equal(next.provider, 'giant');
  assert.equal(requests.filter((request) => request.startsWith('/api/providers')).length, 1, 'La lista de servidores se cachea');
});

test('biblioteca: subtítulos sólo desde strem.io, por HTTPS y con cabecera WEBVTT', async () => {
  const fetched = [];
  const library = new FramexLibrary(async (url) => {
    fetched.push(String(url));
    return new Response('WEBVTT\n\n00:00.000 --> 00:01.000\nHola', { status: 200 });
  });
  assert.match(await library.subtitle('https://subs5.strem.io/es/file'), /^WEBVTT/);
  assert.equal(await library.subtitle('https://evil.test/sub.vtt'), null);
  assert.equal(await library.subtitle('http://subs5.strem.io/es'), null);
  assert.equal(fetched.length, 1);
  const broken = new FramexLibrary(async () => new Response('1\n00:00:01,000 --> 00:00:02,000\nHola'));
  assert.equal(await broken.subtitle('https://subs5.strem.io/es/file'), null, 'No reenvía SRT como si fuera VTT');
});

test('biblioteca: limita respuesta, se recupera de errores de red y no cachea fallos', async () => {
  let count = 0;
  const library = new FramexLibrary(async () => {
    count++;
    if (count === 1) throw new Error('offline');
    if (count === 2) return new Response('x'.repeat(3 * 1024 * 1024));
    return Response.json({ providers: [] });
  });
  assert.ok((await library.query(query({ op: 'providers' }))).error);
  assert.ok((await library.query(query({ op: 'providers' }))).error);
  assert.deepEqual((await library.query(query({ op: 'providers' }))).providers, []);
});
