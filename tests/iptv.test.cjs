const { test } = require('node:test');
const assert = require('node:assert/strict');
// El lector de listas de iptv-org corre en el Cine: se prueba el mismo módulo que carga la app.
let iptvChannels;
let IPTV_COUNTRIES;
test.before(async () => { ({ iptvChannels, IPTV_COUNTRIES } = await import('../ui/js/web/cine/iptv.js')); });
const ar = { code: 'ar', name: 'Argentina' };

test('iptv: lee nombre, logo, grupo y calidad; arma una tarjeta válida', () => {
  const channels = iptvChannels([
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="eltrece.ar" tvg-logo="https://cdn.example/eltrece.png" group-title="General",El Trece HD',
    'https://cdn.example/eltrece.m3u8?token=1',
    '#EXTINF:-1 group-title="News",Noticias 24 FHD',
    'https://cdn.example/noticias/index.m3u8',
  ].join('\n'), ar);
  assert.equal(channels.length, 2);
  assert.deepEqual(channels.map((channel) => channel.name), ['El Trece', 'Noticias 24']);
  assert.equal(channels[0].category, 'General');
  assert.equal(channels[0].quality, 'HD');
  assert.equal(channels[0].source, 'iptv');
  assert.equal(channels[0].country, 'ar');
  assert.equal(channels[0].region, 'Argentina');
  assert.equal(channels[0].logo, 'https://cdn.example/eltrece.png');
  assert.match(channels[0].id, /^iptv:ar:[a-z0-9]+$/);
  assert.equal(channels[1].category, 'Noticias');
  assert.equal(channels[1].quality, 'FHD');
});

test('iptv: descarta HTTP, enlaces que no son HLS/MP4, repetidos, rotos y de prueba', () => {
  const channels = iptvChannels([
    '#EXTM3U',
    '#EXTINF:-1,Canal inseguro',
    'http://cdn.example/a.m3u8',
    '#EXTINF:-1,Canal DASH',
    'https://cdn.example/a.mpd',
    '#EXTINF:-1,Canal con página',
    'https://cdn.example/canal',
    '#EXTINF:-1,Canal roto [broken]',
    'https://cdn.example/b.m3u8',
    '#EXTINF:-1,Canal de prueba',
    'https://cdn.example/test.m3u8',
    '#EXTINF:-1,Canal bueno',
    'https://cdn.example/good.m3u8',
    '#EXTINF:-1,Canal bueno repetido',
    'https://cdn.example/good.m3u8',
  ].join('\n'), ar);
  assert.deepEqual(channels.map((channel) => channel.name), ['Canal bueno']);
});

test('iptv: en EE. UU. sólo entran los canales en español', () => {
  const us = { code: 'us', name: 'Estados Unidos (español)', spanishOnly: true };
  const channels = iptvChannels([
    '#EXTM3U',
    '#EXTINF:-1,Telemundo 51',
    'https://cdn.example/telemundo.m3u8',
    '#EXTINF:-1,CNN USA',
    'https://cdn.example/cnn-us.m3u8',
    '#EXTINF:-1,Univision',
    'https://cdn.example/univision.m3u8',
    '#EXTINF:-1,TUDN',
    'https://cdn.example/tudn.m3u8',
  ].join('\n'), us);
  assert.deepEqual(channels.map((channel) => channel.name), ['Telemundo 51', 'Univision', 'TUDN']);
});

test('iptv: los países hispanohablantes tienen lista y no se repiten', () => {
  assert.ok(IPTV_COUNTRIES.length >= 15);
  assert.equal(new Set(IPTV_COUNTRIES.map((country) => country.code)).size, IPTV_COUNTRIES.length);
  assert.ok(IPTV_COUNTRIES.every((country) => /^[a-z]{2}$/.test(country.code) && country.name));
});
