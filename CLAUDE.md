# ControlTvPC — notas para trabajar en este proyecto

La notebook (pantalla rota, conectada por HDMI a un tele LG webOS) hace de tele: muestra a pantalla
completa **el Cine** (la única app) y se maneja desde la app Android **ControlTv**
(`C:\Users\user\Desktop\ControlTv`).

## Reglas que no se negocian

- **No modificar la app del celular.** Esta app se adapta a ella: imita una Samsung (puerto 8001,
  `/api/v2/`, `samsung.remote.control`). Leer su código para entender el protocolo está bien; cambiarlo, no.
- TypeScript estricto, **nada de `any`**, SOLID / Clean Architecture (`domain` → `application` →
  `infrastructure`, todo se conecta en `src/app.ts`). `npm run check` (tsc + eslint) tiene que pasar.
- **Nada de código duplicado** entre el Cine y el servicio: lo común va en `shared/` (lo compilan los dos).
- Siempre pantalla completa y al frente.
- Navegador: **Edge** (no Brave). Interfaz limpia tipo Google TV / tvOS, animaciones lindas pero no repetitivas.
- No cambiar configuraciones del sistema (resolución, planes de energía, seguridad, red) por cuenta
  propia: dar instrucciones o scripts (`optimizacion/`) para que los corra la persona.
- Mientras se trabaja, correr el servicio con `CONTROLTV_TEST=1` (no bloquea el mouse ni tapa la pantalla).
- **Sin inicio, menú ni otras apps** (se sacaron en oct. 2026 por decisión del usuario, igual que
  Netflix, Disney+, etc.). No reincorporarlos. Es para uso personal (varios teles de la casa).

## Arquitectura: el Cine es autónomo

```
ui/                 ← EL CINE: la app completa (index.html, cine.css, js/, fonts/, vendor/hls.js).
web/cine/           ← su código: main.ts (pantalla), library.ts (API de FrameX), translator.ts, store.ts
shared/json.ts      ← validadores de datos (los usan el Cine y el servicio)
web/inject.ts       ← lo que la notebook le agrega al Cine: cursor oculto, avisos y barra de volumen
src/                ← el servicio de la notebook (Node): control del celular, Edge, volumen, encendido, energía
```

- **El Cine sólo necesita internet.** Consulta la API de FrameX, el traductor y TMDB directo desde la
  página (todas aceptan CORS, medido una por una) y guarda lo suyo en el navegador (IndexedDB). El
  servicio de la notebook sólo le sirve los archivos de `ui/`: así la misma carpeta se puede llevar
  a otro tele (por ejemplo, adentro de una app de Android TV). Por ahora sólo existe la versión de notebook.
- Rutas relativas en `ui/index.html` (sin `/` adelante): la app tiene que andar desde cualquier carpeta.
- El servicio le habla al Cine por funciones en `window` (ver `shared/contracts.d.ts`):
  `__controlTvBack`, `__controlTvHome`, `__controlTvSearch`, `__controlTvPrepareText`,
  `__controlTvTogglePlayback`. El Cine las define pero no depende de ellas.
- Control remoto: **Inicio y Menú** vuelven al principio del catálogo sin recargar; **Atrás** cierra
  reproductor → ficha → búsqueda → vuelve al principio. "Buscar" del celular busca en el Cine; otras
  direcciones que mande el celular no se abren. Si algo llevara a otra página, se vuelve al Cine.
- Compilación: `tsc -p tsconfig.json` → `dist/src`, `dist/shared` (entrada `dist/src/main.js`);
  `tsc -p web/tsconfig.json` → `ui/js/web`, `ui/js/shared`; `build:vendor` copia hls.js a `ui/vendor`.
- Tests: `node --test tests/*.test.cjs`. Los del Cine importan los mismos módulos que carga la app
  (`ui/js/web/cine/*.js`). `cinema.test.cjs` abre un Edge aparte y contesta la API de FrameX con
  datos de prueba en su formato real (`Fetch.requestPaused`): nada sale a internet.
- El acceso directo del escritorio (`ControlTv.vbs`) usa `POST /api/show` si ya estaba corriendo.

## Hardware (todo tiene que andar fluido acá, sin tildarse)

| Pieza | Detalle |
|---|---|
| CPU | Intel Core i7-4510U (Haswell, 2 núcleos / 4 hilos, 2 GHz, bajo consumo) |
| GPU integrada | Intel HD 4400 — **es la que está cableada al HDMI** (Optimus) |
| GPU dedicada | NVIDIA GeForce 840M, 2 GB, driver de 2015 (10.18.13.5362) |
| RAM | 8 GB (2 × 4 GB DDR3-1600) |
| Disco | SSD Lexar NQ100 240 GB |
| Salida | HDMI a LG webOS UJ6580, **1920×1080 a 60 Hz** (Windows al 150 % → las páginas ven 1280×720) |

## Rendimiento: lo que se midió (no repetir los errores)

Se mide abriendo un Edge aparte con `--remote-debugging-port` y contando cuadros (traza
`PipelineReporter` y `requestAnimationFrame`). **Medir antes y después de cada optimización**, con varias rondas.

- **Nunca** lanzar Edge con `--force_high_performance_gpu` solo: con el driver viejo de NVIDIA el proceso
  de GPU se cae y Edge queda **dibujando por software**. Con la GeForce sólo arranca si además va
  `--disable-direct-composition` (`GPU_FLAGS` / `DEDICATED_GPU_FLAGS` en `edge-connection.ts`).
  `checkGpu()` revisa que haya aceleración y, si no, reabre en modo seguro. Log: "Placa de video en uso: …".
- **El HDMI está cableado a la Intel** (Optimus; verificado). No se puede pasar el HDMI a la GeForce.
- **Intel vs GeForce**, medido: con la Intel, video H.264 1080p60 por hardware (D3D11) y 0 % de cuadros
  perdidos; con la GeForce, Edge pierde la decodificación por hardware (2–12 % perdidos) y suma un cuadro
  de demora (copia a la Intel). Sólo gana en 3D puro. Queda la Intel; la GeForce se elige en
  `config.json` (`"gpu": "dedicated"`) y toma efecto al reabrir Edge.
- **Resolución:** 1920×1080 a 60 Hz; la escala de Windows no cambia el rendimiento (medido). En 4K el HDMI iba a 29 Hz.
- **Plan de ahorro durante las pruebas:** sin actividad, la app pasa al plan de bajo consumo (~750 MHz)
  y todo da la mitad de FPS. Antes de medir, generar uso.
- **Ayudante nativo:** `native/input-host.cs` es la única fuente; `npm run build` lo compila a
  `input-host.exe` (arranca en ~0,3 s contra ~2,5 s del `.ps1`, que queda de respaldo).
- Al medir con .NET (`Process.StandardInput`), la primera línea lleva un BOM invisible: parece que el
  ayudante "pierde" la primera orden, pero desde Node no pasa. Probar siempre desde Node.
- **Nunca `Runtime.enable`** al medir páginas de terceros: algunos sitios lo detectan y se van a `about:blank`.
- **Flechas en modo mouse:** la app manda el scroll de dos dedos como 3 flechas iguales en pocos ms;
  una flecha del control llega sola. En modo mouse se espera 80 ms: ráfaga = scroll, sola = navega.
- Prueba de uso real (oct. 2026): WiFi al celular promedio 91 ms, picos de 548 ms (lo más lento del recorrido).
- Vigilancia de Edge: además de cierres, detecta cuelgues (pregunta cada 10 s; 3 faltas → reabre,
  como mucho una vez cada 2 min).
- "Hay algo reproduciéndose" (para no pasar a ahorro ni apagar la imagen) mira el `<video>` del Cine y
  si Windows está sacando sonido (orden `peak` del ayudante nativo).

## Cine (catálogo propio, API de FrameX)

`web/cine/library.ts` habla con la API pública que usa la web de FrameX (`https://api.framextv.xyz`):
`home`, `search`, `details`, `season`, `providers` y `stream`. No se carga la web del proveedor ni se
ejecuta su JavaScript: sólo se validan los datos y las fuentes.

- **Catálogo:** 8 filas de 20 títulos + destacado. Tarjetas apaisadas con el backdrop `w780` (la misma
  imagen del destacado: se baja una vez); episodios `w342`. TMDB entrega WebP por `Accept`.
- **Caché** (`store.ts`, IndexedDB, base `cine`): catálogo, fichas y búsquedas con stale-while-revalidate
  (lo guardado se muestra al instante y se actualiza por detrás; tope 400 registros) y traducciones
  (tope 20.000). Las imágenes las guarda la caché HTTP del navegador.
- **Servidores:** se muestran sólo los `available` que no son `clientOnly`. "Reproducir" los prueba
  escalonados cada 1,2 s (gana el primero que sirve); la fuente queda 15 min y se prebusca al abrir la
  ficha. Si falla, el reproductor pide otro con `exclude`. No fijar ids de servidores en el código.
- **Sólo español:** una fuente se descarta si anuncia audio no español y no tiene subtítulos en español;
  sin datos de audio, sólo si el título es originalmente español. Si ningún servidor cumple, la ficha lo dice.
- **Subtítulos:** sólo de `strem.io`, `vdrk.site` y OpenSubtitles, por HTTPS; los SRT se pasan a WebVTT.
  Se bajan recién al elegirlos y se le dan al `<video>` desde la memoria (blob). Los dibuja la app
  (pista `hidden` + `cuechange` → `#subtitleBox`, `getCueAsHTML`, nunca innerHTML); tamaño y altura
  desde el reproductor (`localStorage` `cine:subtitles:v1`).
- **Sinopsis en español:** `translator.ts` (Google `dict-chrome-ex`, con `gtx` de respaldo), una vez
  por texto. Con muchos pedidos juntos Google contesta 429 un rato: el que limita descansa 15 min, la
  ficha pasa delante del fondo (`urgent`) y el fondo encola como mucho 24. Géneros: tabla fija.
- **Búsqueda:** dos páginas, sin repetidos, ordenada por coincidencia (exacta > empieza con > todas las
  palabras), sin póster al final; con un error de tipeo prueba una palabra más corta (`approximate`).
- **Listas estilo FlashList:** tarjetas recicladas (`cardPool`) y distancia de dibujo (`hydrateAround`:
  imágenes de la fila elegida, la de arriba y las dos de abajo, 10 por delante).
- **Movimiento:** sólo `transform`/`opacity`. La fila elegida deja asomar la mitad de la anterior y la
  siguiente asoma abajo (bordes esfumados con `mask-image` en el contenedor, no en las filas). No poner
  `content-visibility` en filas o tarjetas: recorta el agrandado del foco. Toda curva `var(--x)` tiene
  que estar definida en `:root`: si no, el navegador descarta la transición entera (pasó con `--glide`).
- **Reproductor:** búfer acotado (20/40 s, 24 MB), techo 1080p y preferencia AVC, `-10/+10`, audio,
  siguiente episodio, progreso en `localStorage` (`cine:progress:v1`, "Continuar viendo"). Sin iframes.
- **Red de la casa:** el IPv6 está roto (conexiones de 7 s o cortes de más de 15 s; IPv4 50–100 ms).
  Como ahora todo lo pide Edge, conviene `optimizacion/preferir-ipv4.ps1` (como administrador, lo corre la persona).
- **Límites:** la API es pública pero no oficial y los servidores pueden caerse o cambiar. Sin cuentas ni DRM.

## Tele del HDMI

`src/infrastructure/tv/`: identifica el tele por el EDID del HDMI, lo encuentra en el WiFi por SSDP/DLNA
y saca su MAC de la tabla ARP (cualquier marca). La MAC se le pasa al celular en `/api/v2/` (`wifiMac`)
y `PowerState` dice `standby` si está apagado. El botón de encendido del celular prende (Wake-on-LAN) o
apaga (LG por SSAP; otras marcas: se corta la imagen). Si el tele se prende, la tele se abre sola.
En el LG hay que activar "Encender vía Wi-Fi" (Configuración → General → Mobile TV On).
