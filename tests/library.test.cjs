const { test, before } = require('node:test');
const assert = require('node:assert/strict');
// La biblioteca es del Cine (corre en el navegador): se prueba el mismo módulo que carga la app.
let FramexLibrary;
before(async () => { ({ FramexLibrary } = await import('../ui/js/web/cine/library.js')); });
const query = (value) => new URLSearchParams(value);
const tmdb = (size, file) => `https://image.tmdb.org/t/p/${size}/${file}.jpg`;
const details = (originalLanguage) => Response.json({
  success: true, id: '1', type: 'movie', title: 'Título', year: '2026', rating: '7.5',
  poster: tmdb('w500', 'poster'), backdrop: tmdb('w1280', 'backdrop'), overview: 'Sinopsis',
  original_language: originalLanguage,
});

/** Biblioteca con una respuesta fija de /api/stream y ficha con ese idioma original. */
function streamCase(payload, originalLanguage = 'en') {
  let requested = 0;
  const library = new FramexLibrary(async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/details') return details(originalLanguage);
    if (path === '/api/stream') { requested++; return Response.json(payload); }
    throw new Error(`pedido inesperado: ${path}`);
  });
  return { library, requested: () => requested };
}

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
  assert.equal(first.rows[0].items[0].overview.length, 240, 'Las tarjetas traen una sinopsis corta (para el destacado), no la completa');
  assert.equal(first.rows[0].items[0].poster, tmdb('w342', 'poster'), 'Pide la portada chica');
  assert.equal(first.rows[0].items[1].poster, '', 'Descarta esquemas inseguros');
  assert.equal(first.rows[0].items[1].backdrop, tmdb('w780', 'backdrop'));
  assert.equal(first.hero.backdrop, '', 'Descarta las imágenes de relleno');
  assert.equal(first.hero.genres.length, 0, 'La portada no inventa géneros');
  await library.query(query({ op: 'home' }));
  assert.equal(count, 1, 'El catálogo se cachea');
});

test('biblioteca: ficha de serie con temporadas ordenadas, reparto, idioma y episodios', async () => {
  const library = new FramexLibrary(async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/details') {
      return Response.json({
        success: true, id: '9', type: 'tv', title: 'Serie', year: '2020', rating: '8.1',
        poster: tmdb('w500', 'poster'), backdrop: tmdb('w1280', 'backdrop'), overview: 'Sinopsis',
        original_language: 'es', genres: ['Drama', 'Drama', '  '],
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
  const detailsReply = (await library.query(query({ op: 'details', id: '9', type: 'tv' }))).details;
  assert.equal(detailsReply.originalLanguage, 'es');
  assert.deepEqual(detailsReply.seasons.map((season) => season.number), [1, 2, 0], 'Especiales al final');
  assert.deepEqual(detailsReply.genres, ['Drama']);
  assert.deepEqual(detailsReply.cast, [{ name: 'Ana', character: 'Marta' }, { name: 'Beto', character: '' }]);
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

test('biblioteca: sólo fuentes que se puedan ver en español', async () => {
  const english = {
    success: true, provider: 'test', alternates: [], subtitles: [],
    sources: [{ url: 'https://video.test/en.m3u8', type: 'hls', audioTracks: [{ language: 'eng', label: 'English' }] }],
  };
  const blocked = await streamCase(english).library.query(query({ op: 'stream', id: '1', type: 'movie', provider: 'test' }));
  assert.equal(blocked.sources.length, 0);
  assert.match(blocked.error, /español/);

  const multi = {
    success: true, provider: 'test', alternates: [],
    sources: [{
      url: 'https://video.test/multi.m3u8', type: 'hls',
      audioTracks: [{ language: 'en', label: 'English' }, { language: 'es', label: 'Spanish' }],
    }],
    subtitles: [
      { url: 'https://cache.vdrk.site/v1/vtt/movie/1/English.vtt', label: 'Subtitles • English', lang: 'en' },
      { url: 'https://cache.vdrk.site/v1/vtt/movie/1/Spanish.vtt', label: 'Subtitles • Spanish', lang: 'es' },
    ],
  };
  const accepted = await streamCase(multi).library.query(query({ op: 'stream', id: '1', type: 'movie', provider: 'test' }));
  assert.equal(accepted.sources.length, 1, 'Acepta la fuente multi-audio');
  assert.equal(accepted.sources[0].audioTracks.length, 2);
  assert.equal(accepted.subtitles.length, 1, 'Sólo deja subtítulos en español');
  assert.equal(accepted.subtitles[0].label, 'Spanish');

  const variants = {
    success: true, provider: 'test', alternates: [], subtitles: [],
    sources: [
      { url: 'https://video.test/en.m3u8', type: 'hls', audio: 'en' },
      { url: 'https://video.test/es.m3u8', type: 'hls', audio: 'es' },
    ],
  };
  const spanish = await streamCase(variants).library.query(query({ op: 'stream', id: '1', type: 'movie', provider: 'test' }));
  assert.deepEqual(spanish.sources.map((source) => source.url), ['https://video.test/es.m3u8']);

  const unknown = { success: true, provider: 'test', alternates: [], subtitles: [], sources: [{ url: 'https://video.test/x.m3u8', type: 'hls' }] };
  const noOriginal = await streamCase(unknown, 'en').library.query(query({ op: 'stream', id: '1', type: 'movie', provider: 'test' }));
  assert.equal(noOriginal.sources.length, 0);
  const originalSpanish = await streamCase(unknown, 'es').library.query(query({ op: 'stream', id: '1', type: 'movie', provider: 'test' }));
  assert.equal(originalSpanish.sources.length, 1, 'Acepta audio original español');
});

test('biblioteca: subtítulos sólo desde hosts permitidos, por HTTPS y con cabecera WEBVTT', async () => {
  const fetched = [];
  const library = new FramexLibrary(async (url) => {
    fetched.push(String(url));
    return new Response('WEBVTT\n\n00:00.000 --> 00:01.000\nHola', { status: 200 });
  });
  assert.match(await library.subtitle('https://cache.vdrk.site/v1/vtt/movie/1/Spanish.vtt'), /^WEBVTT/);
  assert.match(await library.subtitle('https://subs5.strem.io/es/file'), /^WEBVTT/);
  assert.equal(await library.subtitle('https://evil.test/sub.vtt'), null);
  assert.equal(await library.subtitle('http://cache.vdrk.site/es'), null);
  assert.equal(fetched.length, 2);
  const broken = new FramexLibrary(async () => new Response('1\n00:00:01,000 --> 00:00:02,000\nHola'));
  assert.equal(await broken.subtitle('https://cache.vdrk.site/es/file'), 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHola\n', 'El SRT (series de strem.io) se convierte a WebVTT, que es lo que entiende el navegador');
  const junk = new FramexLibrary(async () => new Response('<html>no es un subtítulo</html>'));
  assert.equal(await junk.subtitle('https://cache.vdrk.site/es/file'), null, 'Lo que no es VTT ni SRT no se reenvía');
});

test('biblioteca: "Reproducir" prueba servidores en paralelo y sólo acepta los que tienen español', async () => {
  const requests = [];
  const spanishSubtitles = [{ url: 'https://cache.vdrk.site/v1/vtt/movie/1/Spanish.vtt', label: 'Subtitles • Spanish', lang: 'es' }];
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
      ? { success: true, provider, sources: [{ url: `https://video.test/${provider}.m3u8`, type: 'hls' }], subtitles: spanishSubtitles }
      : { success: false });
  });
  const reply = await library.query(query({ op: 'resolve', id: '1', type: 'movie' }));
  assert.equal(reply.provider, 'titan');
  assert.deepEqual(reply.alternates, ['royal_champion', 'giant']);
  assert.equal(requests.filter((request) => request.startsWith('/api/providers')).length, 1);
  const next = await library.query(query({ op: 'resolve', id: '1', type: 'movie', exclude: 'royal_champion,titan' }));
  assert.equal(next.provider, 'giant');
  assert.equal(requests.filter((request) => request.startsWith('/api/providers')).length, 1, 'La lista de servidores se cachea');
});

test('biblioteca: si ningún servidor tiene español, lo informa y no reproduce en otro idioma', async () => {
  const library = new FramexLibrary(async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/providers') return Response.json({ providers: [{ id: 'titan', name: 'Titan', status: 'available' }] });
    if (path === '/api/details') return details('en');
    return Response.json({
      success: true, provider: 'titan', subtitles: [], alternates: [],
      sources: [{ url: 'https://video.test/en.m3u8', type: 'hls', audioTracks: [{ language: 'eng', label: 'English' }] }],
    });
  });
  const reply = await library.query(query({ op: 'resolve', id: '1', type: 'movie' }));
  assert.match(reply.error, /español/);
});

test('búsqueda: mayúsculas y tildes comparten caché, dos páginas, coincidencias primero y sin póster al final', async () => {
  const pages = [];
  const result = (id, title, poster = true) => ({ id, type: id > 50 ? 'tv' : 'movie', title, year: '2020', rating: '7',
    poster: poster ? tmdb('w500', `p${id}`) : '', backdrop: '', overview: '' });
  const library = new FramexLibrary(async (url) => {
    const params = new URL(url).searchParams;
    pages.push(`${params.get('q')}#${params.get('page')}`);
    if (params.get('page') === '1') {
      return Response.json({ success: true, totalPages: 2, results: [
        result(1, 'Batman y Robin'), result(2, 'Otra cosa sin póster', false), result(3, 'Lego Batman'), result(51, 'Batman'),
      ] });
    }
    return Response.json({ success: true, totalPages: 2, results: [result(4, 'Batman: El regreso'), result(1, 'Batman y Robin')] });
  });
  const reply = await library.query(query({ op: 'search', q: '  Batman ' }));
  assert.deepEqual(pages, ['Batman#1', 'Batman#2'], 'Trae las dos primeras páginas');
  assert.deepEqual(reply.items.map((item) => item.title),
    ['Batman', 'Batman y Robin', 'Batman: El regreso', 'Lego Batman', 'Otra cosa sin póster'],
    'Igual primero, después los que empiezan igual, el resto, y sin póster al final (sin repetidos)');
  await library.query(query({ op: 'search', q: 'BÁTMAN' }));
  await library.query(query({ op: 'search', q: 'batman' }));
  assert.equal(pages.length, 2, 'Mayúsculas y tildes no repiten la consulta');
});

test('búsqueda: con un error de tipeo prueba una versión más corta y lo avisa; se recupera de un corte', async () => {
  const asked = [];
  let failFirst = true;
  const library = new FramexLibrary(async (url) => {
    const q = new URL(url).searchParams.get('q');
    asked.push(q);
    if (q === 'avengrs' && failFirst) { failFirst = false; throw new Error('corte'); }
    if (q === 'aveng') return Response.json({ success: true, totalPages: 1, results: [{ id: 9, type: 'movie', title: 'Avengers', poster: tmdb('w500', 'a') }] });
    return Response.json({ success: true, totalPages: 1, results: [] });
  });
  const reply = await library.query(query({ op: 'search', q: 'avengrs' }));
  assert.deepEqual(asked, ['avengrs', 'avengrs', 'aveng'], 'Reintenta una vez tras el corte y después busca algo parecido');
  assert.equal(reply.approximate, 'aveng');
  assert.deepEqual(reply.items.map((item) => item.title), ['Avengers']);
  assert.ok((await library.query(query({ op: 'search', q: '   ' }))).error, 'Vacío: no consulta');
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

test('filas del menú: sin clave de TMDB usa FrameX (tipo y género) y rechaza lo que sólo sabe TMDB', async () => {
  const urls = [];
  const library = new FramexLibrary(async (url) => {
    urls.push(url);
    return Response.json({ results: [{ id: '7', type: 'movie', title: 'Policial', year: '2020', rating: '7', backdrop: tmdb('w1280', 'b'), overview: 'x' }] });
  });
  const reply = await library.query(query({ op: 'shelf', type: 'movie', genres: '80', sort: 'top' }));
  assert.deepEqual(reply.items.map((item) => item.title), ['Policial']);
  assert.match(urls[0], /\/api\/discover\?type=movie&page=1&genre=80&sort=vote_count\.desc$/);
  await library.query(query({ op: 'shelf', type: 'tv', trending: '1' }));
  assert.match(urls[1], /\/api\/trending\?type=tv$/);
  assert.ok((await library.query(query({ op: 'shelf', type: 'tv', genres: '16', language: 'ja' }))).error, 'Anime necesita TMDB');
  assert.ok((await library.query(query({ op: 'shelf', type: 'tv', genres: '1;drop' }))).error);
  assert.equal(urls.length, 2);
});

test('filas del menú: con TMDB, en español, con filtros y la clave sólo hacia TMDB', async () => {
  const { tmdbAccess } = await import('../ui/js/web/cine/tmdb.js');
  assert.equal(tmdbAccess('cualquier cosa'), null);
  const requests = [];
  const library = new FramexLibrary(async (url, init) => {
    requests.push({ url, headers: init.headers });
    return Response.json({ results: [{ id: 30, name: 'Anime de prueba', first_air_date: '2024-04-01', vote_average: 8.4, backdrop_path: '/fondo.jpg', poster_path: '/poster.jpg', overview: 'Sinopsis en español' }] });
  }, null, null, false, tmdbAccess('0123456789abcdef0123456789abcdef'));
  const reply = await library.query(query({ op: 'shelf', type: 'tv', genres: '16', language: 'ja' }));
  assert.deepEqual(reply.items, [{
    id: '30', type: 'tv', title: 'Anime de prueba', poster: 'https://image.tmdb.org/t/p/w342/poster.jpg',
    backdrop: 'https://image.tmdb.org/t/p/w780/fondo.jpg', year: '2024', rating: '8.4', overview: 'Sinopsis en español',
  }]);
  const url = new URL(requests[0].url);
  assert.equal(url.origin + url.pathname, 'https://api.themoviedb.org/3/discover/tv');
  assert.equal(url.searchParams.get('language'), 'es-MX');
  assert.equal(url.searchParams.get('with_genres'), '16');
  assert.equal(url.searchParams.get('with_original_language'), 'ja');
  // Con el token v4 la clave va en la cabecera, no en la dirección.
  const bearer = new FramexLibrary(async (u, init) => { requests.push({ url: u, headers: init.headers }); return Response.json({ results: [] }); },
    null, null, false, tmdbAccess('eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.firma'));
  await bearer.query(query({ op: 'shelf', type: 'movie', provider: '8' }));
  assert.equal(requests[1].headers.Authorization, 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.firma');
  assert.doesNotMatch(requests[1].url, /eyJ/);
  assert.match(requests[1].url, /with_watch_providers=8&watch_region=AR/);
});

test('filas del menú: un título en otro alfabeto (anime sin nombre en español) se muestra en letras latinas', async () => {
  const { tmdbAccess } = await import('../ui/js/web/cine/tmdb.js');
  const languages = [];
  const library = new FramexLibrary(async (url) => {
    const language = new URL(url).searchParams.get('language');
    languages.push(language);
    const spanish = language === 'es-MX';
    if (new URL(url).searchParams.get('with_genres') === '18') return Response.json({ results: [{ id: 9, title: 'Drama', backdrop_path: '/d.jpg' }] });
    return Response.json({ results: [
      { id: 1, name: spanish ? 'ちびまる子ちゃん' : 'Chibi Maruko-chan', backdrop_path: '/a.jpg' },
      { id: 2, name: spanish ? 'Los diarios de la boticaria' : 'The Apothecary Diaries', backdrop_path: '/b.jpg' },
      { id: 3, name: spanish ? '名探偵コナン' : '名探偵コナン', backdrop_path: '/c.jpg' },
    ] });
  }, null, null, false, tmdbAccess('0123456789abcdef0123456789abcdef'));
  const reply = await library.query(query({ op: 'shelf', type: 'tv', genres: '16', language: 'ja' }));
  assert.deepEqual(reply.items.map((item) => item.title), ['Chibi Maruko-chan', 'Los diarios de la boticaria', '名探偵コナン']);
  assert.deepEqual(languages, ['es-MX', 'en-US']);
  // Si todos se leen en letras latinas, no hace falta el segundo pedido.
  await library.query(query({ op: 'shelf', type: 'movie', genres: '18' }));
  assert.deepEqual(languages, ['es-MX', 'en-US', 'es-MX']);
});
