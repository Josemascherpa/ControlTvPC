const {test}=require('node:test');
const assert=require('node:assert/strict');
test('imágenes: variantes TMDB sin alterar rutas de otros proveedores',async()=>{
  const {tmdbSize}=await import('../ui/js/web/cine/images.js');
  assert.equal(tmdbSize('https://image.tmdb.org/t/p/w780/poster.jpg','w300'),'https://image.tmdb.org/t/p/w300/poster.jpg');
  assert.equal(tmdbSize('https://image.tmdb.org/t/p/original/backdrop.webp','w780'),'https://image.tmdb.org/t/p/w780/backdrop.webp');
  assert.equal(tmdbSize('https://other.example/w780/poster.jpg','w300'),'https://other.example/w780/poster.jpg');
  assert.equal(tmdbSize('https://image.tmdb.org.evil.example/t/p/w780/poster.jpg','w300'),'https://image.tmdb.org.evil.example/t/p/w780/poster.jpg');
  assert.equal(tmdbSize('','w300'),'');
});
