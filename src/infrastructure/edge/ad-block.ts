// Bloqueador de anuncios propio: Edge corta (antes de que se descarguen) los pedidos a las redes de
// publicidad y ventanas emergentes más comunes. Funciona con la intercepción de DevTools ("Fetch"):
// sólo se detienen los pedidos que coinciden con esta lista, el resto ni se toca (no gasta nada).
// No bloquea los anuncios de YouTube (vienen del mismo servidor que los videos).

const AD_DOMAINS: readonly string[] = [
  // Google y grandes redes
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com',
  'google-analytics.com', 'googletagservices.com', 'amazon-adsystem.com', 'ads.yahoo.com', 'advertising.com',
  // Intercambios de publicidad
  'adnxs.com', 'criteo.com', 'criteo.net', 'pubmatic.com', 'rubiconproject.com', 'openx.net', 'adsrvr.org',
  'casalemedia.com', 'indexww.com', 'bidswitch.net', 'smartadserver.com', 'adform.net', 'yieldmo.com',
  'sharethrough.com', '33across.com', 'teads.tv', 'media.net', 'zedo.com', 'adroll.com', 'quantserve.com',
  'scorecardresearch.com', 'moatads.com', 'adcolony.com', 'taboola.com', 'outbrain.com', 'mgid.com', 'revcontent.com',
  // Redes de ventanas emergentes y anuncios agresivos (las que usan los sitios de películas online)
  'popads.net', 'popcash.net', 'propellerads.com', 'adsterra.com', 'highperformanceformat.com',
  'profitabledisplaynetwork.com', 'exoclick.com', 'juicyads.com', 'trafficjunky.net', 'hilltopads.net',
  'onclickads.net', 'clickadu.com', 'realsrv.com', 'tsyndicate.com', 'a-ads.com', 'coinzilla.io', 'bitmedia.io',
  'adsco.re', 'acint.net', 'dtscout.com', 'histats.com', 'popmyads.com', 'adcash.com', 'ad-maven.com',
  'richpartners.co', 'pushame.com', 'notix.io', 'onesignal.com',
];

/** Los patrones para Fetch.enable: cualquier dirección de esos dominios o sus subdominios. */
export const AD_BLOCK_PATTERNS: readonly { readonly urlPattern: string }[] = AD_DOMAINS.flatMap((domain) => [
  { urlPattern: `*://${domain}/*` },
  { urlPattern: `*://*.${domain}/*` },
]);
