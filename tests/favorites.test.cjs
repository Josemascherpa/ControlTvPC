const { test } = require('node:test');
const assert = require('node:assert/strict');
// Los favoritos corren en el Cine: se prueba el mismo módulo que carga la app.
let favorites;
let isFavorite;
let toggleFavorite;
test.before(async () => { ({ favorites, isFavorite, toggleFavorite } = await import('../ui/js/web/cine/favorites.js')); });

function memory() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    data,
  };
}

const movie = { id: '603', type: 'movie', title: 'Matrix', poster: 'https://img/p.jpg', backdrop: '', year: '1999', rating: '8.2', overview: 'Neo.' };
const series = { id: '1399', type: 'tv', title: 'Juego de tronos', poster: '', backdrop: '', year: '2011', rating: '8.4', overview: '' };

test('favoritos: agrega, quita y persiste el título completo', () => {
  const storage = memory();
  assert.equal(toggleFavorite(movie, storage), true);
  assert.equal(isFavorite(movie, storage), true);
  assert.deepEqual(favorites(storage), [movie]);
  assert.equal(toggleFavorite(movie, storage), false);
  assert.equal(isFavorite(movie, storage), false);
  assert.deepEqual(favorites(storage), []);
});

test('favoritos: el último agregado va primero y no se repite', () => {
  const storage = memory();
  toggleFavorite(movie, storage);
  toggleFavorite(series, storage);
  assert.deepEqual(favorites(storage).map((item) => item.id), ['1399', '603']);
  toggleFavorite(movie, storage);
  toggleFavorite(movie, storage);
  assert.deepEqual(favorites(storage).map((item) => item.id), ['603', '1399']);
});

test('favoritos: descarta datos rotos y no rompe si el navegador no deja guardar', () => {
  const storage = memory();
  storage.setItem('cine:favorites:v1', JSON.stringify([null, { id: 3 }, { id: '1', type: 'person', title: 'x' }, { id: '2', type: 'movie', title: 'Buena' }]));
  assert.deepEqual(favorites(storage).map((item) => item.title), ['Buena']);
  const blocked = { getItem: () => null, setItem: () => { throw new Error('sin espacio'); } };
  assert.equal(toggleFavorite(movie, blocked), true);
});
