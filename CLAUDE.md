# ControlTvPC — notas para trabajar en este proyecto

App de escritorio que convierte la notebook (pantalla rota, conectada por HDMI a un tele LG webOS) en un
"sistema de TV" a pantalla completa, manejado desde la app Android **ControlTv** (`C:\Users\user\Desktop\ControlTv`).

## Reglas que no se negocian

- **No modificar la app del celular.** Esta app se adapta a ella: imita una Samsung (puerto 8001,
  `/api/v2/`, `samsung.remote.control`). Leer su código para entender el protocolo está bien; cambiarlo, no.
- TypeScript estricto, **nada de `any`**, SOLID / Clean Architecture (`domain` → `application` →
  `infrastructure`, todo se conecta en `src/app.ts`). `npm run check` (tsc + eslint) tiene que pasar.
- Siempre pantalla completa y al frente; la única salida es Ajustes → "Salir al escritorio".
- Navegador: **Edge** (no Brave). Interfaz limpia tipo Apple/tvOS, animaciones lindas pero no repetitivas.
- No cambiar configuraciones del sistema (resolución, planes de energía, seguridad) por cuenta propia:
  dar instrucciones o scripts (`optimizacion/`) para que los corra la persona.
- Mientras se trabaja, correr el servicio con `CONTROLTV_TEST=1` (no bloquea el mouse ni tapa la pantalla).

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

Herramientas de medición en el historial de la sesión: se abre Edge aparte con `--remote-debugging-port`
y se cuentan los cuadros con una traza (`PipelineReporter`: completos / parciales / perdidos) y con
`requestAnimationFrame`. **Medir antes y después de cada optimización**, con varias rondas (hay variación).

- **Nunca** lanzar Edge con `--force_high_performance_gpu` solo: con el driver viejo de NVIDIA el proceso
  de GPU se cae 3 veces al arrancar y Edge queda **dibujando por software** (todo lento). Con la GeForce
  sólo arranca si además va `--disable-direct-composition` (ver `GPU_FLAGS` / `DEDICATED_GPU_FLAGS` en
  `src/infrastructure/edge/edge-connection.ts`). Al abrir, `checkGpu()` revisa que haya aceleración y, si
  no, reabre en modo seguro. Ver en el log: "Placa de video en uso: …".
- **El HDMI está cableado a la Intel** (Lenovo con Optimus; verificado: la GeForce no tiene ninguna
  pantalla conectada). No se puede "conectar el HDMI a la GeForce" por software.
- **Intel vs GeForce**, medido:
  | Prueba | Intel HD 4400 | GeForce 840M |
  |---|---|---|
  | Inicio con flechas | 60 FPS, 1 cuadro de demora | 60 FPS, 2 cuadros de demora (copia a la Intel) |
  | Página pesada (cinehax) | más cuadros completos | menos cuadros completos, más perdidos |
  | Gráficos 3D puros (WebGL) | ~22 FPS | **~42 FPS** |
  | **YouTube 1080p60** | **H.264 por hardware (D3D11), 0 % perdidos** | H.264 por procesador (FFmpeg), 2–12 % perdidos |
  Con la GeForce, Edge pierde la decodificación de video por hardware. La Intel es la de fábrica;
  la GeForce queda como opción en Ajustes → Placa de video.
- **Resolución:** 1920×1080 a 60 Hz. La escala de Windows (100/125/150 %) **no cambia el rendimiento**
  (medido igual: mismos píxeles). Se deja 150 % por legibilidad. En 4096×2160 el HDMI iba a 29 Hz.
- **Plan de ahorro durante las pruebas:** si se mide sin actividad del celular, la app pasa al plan
  de bajo consumo (procesador a ~750 MHz) y todo da la mitad de FPS. Antes de medir, generar uso.
- **Video en iframes:** las páginas de películas reproducen en iframes de otro sitio, que la página
  principal no ve. Para no pasar a ahorro en medio de una película, "hay algo reproduciéndose" también
  mira si Windows está sacando sonido (orden `peak` del ayudante nativo).
- **Ayudante nativo:** `native/input-host.cs` es la única fuente; `npm run build` lo compila a
  `input-host.exe` (arranca en ~0,3 s contra ~2,5 s del `.ps1`, que queda de respaldo).
- **Probado y descartado** (no repetir sin medir de nuevo): `content-visibility: auto` automático en
  páginas externas (no mejoró y trabó una página); `Network.setBlockedURLs` para el bloqueador (sólo
  anda con `Network.enable`, que manda a Node un aviso por cada pedido: peor que `Fetch` con patrones);
  `--force-gpu-mem-available-mb` y caché de disco grande (sin diferencia medible).
- Al medir con .NET (`Process.StandardInput`), la primera línea lleva un BOM invisible: parece que el
  ayudante "pierde" la primera orden, pero desde Node no pasa. Probar siempre desde Node.
- En el inicio: sólo animar `transform`/`opacity`; **nada de `mask-image`, `backdrop-filter` ni filtros**
  sobre zonas que se desplazan (la máscara del inicio sumaba un cuadro de demora); sin animaciones
  infinitas; `contain` en tarjetas.
- Páginas externas (inject.ts, "modo liviano"): mientras se desplaza se ignora el puntero (los "hover"
  de cientos de tarjetas costaban caro) y se pausan las animaciones infinitas decorativas. En cinehax
  (8.000+ elementos) bajó ~38 % los cuadros perdidos. El límite ahí es el procesador (recalcular capas).
- YouTube: forzar H.264 (h264ify en inject.ts, responde `MediaSource.isTypeSupported`, `canPlayType` y
  `mediaCapabilities.decodingInfo`) — VP9/AV1 no se decodifican por hardware en ninguna de las dos
  placas. Verificado con el dominio `Media` de DevTools: decodificador `D3D11VideoDecoder`, `hw=true`.
- **Versiones web para TV** (probado presentándose como Samsung/Tizen y LG/webOS, oct. 2026): sólo
  **YouTube** tiene una (`youtube.com/tv`, ~215 elementos contra ~3.000 de la web normal; ya se usa).
  Pluto, Twitch, Prime, Netflix y Disney+ muestran la misma página; `tv.spotify.com` no existe;
  Spotify con identificación de LG muestra la versión para celular ("Abrir aplicación") y YouTube
  Music con la de tele dice "navegador obsoleto". No vale la pena cambiarles la identificación.
- Al abrir una app, la orden sale a los 140 ms (antes esperaba los 420 ms de la animación).
- Navegación con flechas en páginas externas: primero sólo posiciones, el estilo se revisa sólo en los
  mejores candidatos; repeticiones de una flecha mantenida, como mucho una cada 45 ms.
- Fondos: se bajan en 4K y se achican UNA vez a la pantalla (`native/resize-image.ps1`): 1920×1080 de
  ~330 KB, más nítidos que el 1080p de Bing y con la cuarta parte de memoria que la 4K.
- Vigilancia de Edge: además de cierres, detecta cuelgues (pregunta cada 10 s; 3 faltas → reabre,
  como mucho una vez cada 2 min). Las revisiones de pantalla completa no se enciman.
- Fondos: Bing en 4K reducidos a 1080p (más nítidos) y decodificados antes del fundido (`img.decode()`).
- Íconos: SVG en `ui/app-icons/` (nítidos a cualquier tamaño). Subir `ICON_VERSION` al cambiarlos.

## Tele del HDMI

`src/infrastructure/tv/`: identifica el tele por el EDID del HDMI, lo encuentra en el WiFi por SSDP/DLNA
y saca su MAC de la tabla ARP (cualquier marca). La MAC se le pasa al celular en `/api/v2/` (`wifiMac`)
y `PowerState` dice `standby` si está apagado. El botón de encendido del celular prende (Wake-on-LAN) o
apaga (LG por SSAP; otras marcas: se corta la imagen). Si el tele se prende, la tele se abre sola.
En el LG hay que activar "Encender vía Wi-Fi" (Configuración → General → Mobile TV On).
