const { test } = require('node:test');
const assert = require('node:assert/strict');
let tmdbLanguage;
test.before(async () => { ({ tmdbLanguage } = await import('../ui/js/web/cine/tmdb.js')); });

test('idioma de TMDB: latino por defecto y acepta castellano y variantes', () => {
  assert.equal(tmdbLanguage(undefined), 'es-MX');
  assert.equal(tmdbLanguage(''), 'es-MX');
  assert.equal(tmdbLanguage('es-MX'), 'es-MX');
  assert.equal(tmdbLanguage('es-ES'), 'es-ES');
  assert.equal(tmdbLanguage('es-AR'), 'es-AR');
  assert.equal(tmdbLanguage('es-CO'), 'es-CO');
  assert.equal(tmdbLanguage('es-419'), 'es-419');
  assert.equal(tmdbLanguage('en-US'), 'es-MX');
  assert.equal(tmdbLanguage('es-mx'), 'es-MX');
  assert.equal(tmdbLanguage('   es-CL  '), 'es-CL');
});
