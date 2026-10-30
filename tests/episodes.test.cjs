const { test } = require('node:test');
const assert = require('node:assert/strict');
let nextEpisode;
test.before(async () => { ({ nextEpisode } = await import('../ui/js/web/cine/episodes.js')); });

const seasons = [
  { number: 1, episodes: 10 },
  { number: 2, episodes: 8 },
  { number: 3, episodes: 6 },
];

test('siguiente capítulo: dentro de la misma temporada, con su nombre', () => {
  const loaded = [
    { season: 1, episode: 1, name: 'Piloto' },
    { season: 1, episode: 2, name: 'El segundo' },
  ];
  assert.deepEqual(nextEpisode({ season: 1, episode: 1 }, seasons, loaded), { season: 1, episode: 2, name: 'El segundo' });
  assert.deepEqual(nextEpisode({ season: 1, episode: 2 }, seasons, loaded), { season: 1, episode: 3, name: '' });
});

test('siguiente capítulo: si era el último de la temporada, pasa al primero de la siguiente', () => {
  assert.deepEqual(nextEpisode({ season: 1, episode: 10 }, seasons), { season: 2, episode: 1, name: '' });
  assert.deepEqual(nextEpisode({ season: 2, episode: 8 }, seasons), { season: 3, episode: 1, name: '' });
});

test('siguiente capítulo: en la última temporada no hay siguiente', () => {
  assert.equal(nextEpisode({ season: 3, episode: 6 }, seasons), null);
});

test('siguiente capítulo: salta temporadas vacías y no cuenta los especiales', () => {
  const withGap = [
    { number: 0, episodes: 2 },
    { number: 1, episodes: 3 },
    { number: 2, episodes: 0 },
    { number: 4, episodes: 5 },
  ];
  assert.deepEqual(nextEpisode({ season: 1, episode: 3 }, withGap), { season: 4, episode: 1, name: '' });
});

test('siguiente capítulo: sin ficha, usa los capítulos cargados', () => {
  const loaded = [
    { season: 1, episode: 1, name: 'Uno' },
    { season: 1, episode: 2, name: 'Dos' },
  ];
  assert.deepEqual(nextEpisode({ season: 1, episode: 1 }, [], loaded), { season: 1, episode: 2, name: 'Dos' });
  assert.equal(nextEpisode({ season: 1, episode: 2 }, [], loaded), null);
});
