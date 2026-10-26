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
- **Intel vs GeForce** (medido en el inicio y en las páginas de las apps): las dos dan 60 FPS en el
  inicio, pero la GeForce suma **un cuadro de demora** (copia cada imagen a la Intel, que es la del
  HDMI) y en páginas pesadas presenta menos cuadros completos. Por eso la Intel es la de fábrica; la
  GeForce queda como opción en Ajustes → Placa de video.
- En el inicio: sólo animar `transform`/`opacity`; **nada de `mask-image`, `backdrop-filter` ni filtros**
  sobre zonas que se desplazan (la máscara del inicio sumaba un cuadro de demora); sin animaciones
  infinitas; `contain` en tarjetas.
- Páginas externas (inject.ts, "modo liviano"): mientras se desplaza se ignora el puntero (los "hover"
  de cientos de tarjetas costaban caro) y se pausan las animaciones infinitas decorativas. En cinehax
  (8.000+ elementos) bajó ~38 % los cuadros perdidos. El límite ahí es el procesador (recalcular capas).
- YouTube: forzar H.264 (h264ify en inject.ts) — VP9/AV1 no se decodifican por hardware en esta Intel.
- Fondos: Bing en 4K reducidos a 1080p (más nítidos) y decodificados antes del fundido (`img.decode()`).
- Íconos: SVG en `ui/app-icons/` (nítidos a cualquier tamaño). Subir `ICON_VERSION` al cambiarlos.

## Tele del HDMI

`src/infrastructure/tv/`: identifica el tele por el EDID del HDMI, lo encuentra en el WiFi por SSDP/DLNA
y saca su MAC de la tabla ARP (cualquier marca). La MAC se le pasa al celular en `/api/v2/` (`wifiMac`)
y `PowerState` dice `standby` si está apagado. El botón de encendido del celular prende (Wake-on-LAN) o
apaga (LG por SSAP; otras marcas: se corta la imagen). Si el tele se prende, la tele se abre sola.
En el LG hay que activar "Encender vía Wi-Fi" (Configuración → General → Mobile TV On).
