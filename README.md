# ControlTv PC 📺

La notebook enchufada por HDMI al tele se convierte en una tele con **el Cine**: un catálogo de
películas y series en español, que se maneja con la app **ControlTv** del celular (sin cambiarle
nada a la app).

## Cómo funciona

```
celular (app ControlTv) ──WiFi──> notebook: servicio ControlTv PC (puerto 8001)
                                    ├─ Edge a pantalla completa con el Cine
                                    ├─ Windows: cursor, clic, play/pausa, apagar la pantalla, planes de energía
                                    └─ volumen y encendido del tele
el Cine ──internet──> catálogo (FrameX), traductor y fuentes de video (no depende de la notebook)
notebook ──HDMI──> tele
```

- **El Cine es la única app** y es autónomo: consulta internet por su cuenta y guarda lo que ya se
  vio (catálogo, fichas, traducciones) en el propio navegador. Por eso la misma app se va a poder
  llevar a otros teles de la casa más adelante.
- **La app del celular la ve como una tele Samsung llamada "Notebook TV".** La notebook habla el
  mismo idioma que una Samsung: botones, texto, búsquedas y el touchpad de la pestaña *Mouse*.
- **Volumen:** los botones de volumen del celular manejan el volumen del tele LG por WiFi (o, si no
  lo encuentra, el sonido que sale por el HDMI), con una barrita propia en pantalla.
- **Mouse:** la tele tiene su propia flecha, que sólo mueve el touchpad del celular. El cursor de
  Windows queda invisible y el touchpad/mouse físico de la notebook se bloquea mientras la tele está en pantalla.
- **Siempre abierta y al frente:** arranca sola al prender la notebook, se reabre si se cierra o se
  cuelga, y vuelve a pantalla completa sola. Emergencia: Ctrl+Alt+Supr siempre funciona.
- **Energía:** plan "Máximo" sólo mientras se usa (o mientras se está viendo algo); sin uso pasa al
  de ahorro. Si nadie la usa por varias horas y no se está viendo nada, apaga la imagen.

## Botones del celular

| Botón | Qué hace |
|---|---|
| Flechas / OK | Moverse por el catálogo, la ficha y el reproductor |
| Atrás | Cierra el video → la ficha → la búsqueda; en el catálogo vuelve al principio |
| Inicio / Menú | Vuelve al principio del catálogo (cierra lo que esté abierto) |
| Buscar (pestaña Internet) | Busca en el Cine |
| Volumen / Silencio | Volumen del tele (con barrita en pantalla) |
| Prender/Apagar | Prende o apaga el tele (o corta la imagen). Cualquier botón la vuelve a prender |
| Pausa | Play/pausa del video |
| Pestaña Mouse | Touchpad: mueve la flecha propia de la tele; tocar = clic; dos dedos = ruedita |

En el reproductor, con los controles a la vista: subtítulos, **tamaño y altura de los subtítulos**
(quedan guardados), audio y siguiente episodio.

## Instalar

1. Clic derecho en `instalar.ps1` → **Ejecutar con PowerShell**.
   Baja Node.js portátil (queda en `runtime/`), instala las librerías, crea el acceso directo
   **ControlTv** en el escritorio y lo agrega al inicio de Windows.
2. La primera vez que arranca, Windows pregunta por el **Firewall**: elegí *Permitir acceso*
   (tildá también *redes públicas*, porque el WiFi de la casa está marcado como público).
3. En el celular: abrí ControlTv, buscá TVs y elegí **Notebook TV**.

Para sacarlo del inicio automático: `desinstalar.ps1`.

## Recomendaciones para que vaya fluido

- **Red:** el IPv6 de la casa anda mal (conexiones de varios segundos). Corré una vez, como
  administrador, `optimizacion/preferir-ipv4.ps1`: Windows usa IPv4 primero (sin desactivar IPv6).
- **Resolución:** 1920×1080 a 60 Hz (en 4K el HDMI sólo llegaba a 29 Hz). La escala (150 %) no cambia el rendimiento.
- **Placa de video:** la **Intel HD 4400** (la que está cableada al HDMI): decodifica el video por
  hardware sin perder cuadros. La GeForce se puede probar con `"gpu": "dedicated"` en `config.json`.
- **Plan de energía:** ver `optimizacion/LEEME.md`.
- En *Opciones de energía*, que al **cerrar la tapa** no haga nada (la app ya evita que se suspenda).
- El Cine no necesita cuenta: usa el catálogo público de FrameX y sólo reproduce con **audio o
  subtítulos en español**. Si un servidor no responde, prueba con otro automáticamente.

## Personalizar

Todo lo del servicio vive en `%LOCALAPPDATA%\ControlTvPC`:

- `config.json`: nombre de la tele, velocidad del cursor (`pointerSpeed`), horas para apagarse solo
  (`autoOffHours`), placa de video (`gpu`).
- `logs\servicio.log`: qué pasó, por si algo falla.

## Cómo está hecho

TypeScript estricto (sin `any`, `tsc --strict` y ESLint `strictTypeChecked`), **Clean Architecture**
y **SOLID**. Las dependencias apuntan siempre hacia adentro: `infrastructure` → `application` → `domain`.

```
ui/                       EL CINE: la app completa (html, css, fuentes, js compilado, hls.js)
web/
  cine/main.ts            pantalla: destacado, filas, ficha, buscador, reproductor y subtítulos
  cine/library.ts         API de FrameX: catálogo, búsqueda, servidores en español, subtítulos
  cine/translator.ts      sinopsis en español (una vez por texto)
  cine/store.ts           lo guardado en el navegador (IndexedDB)
  inject.ts               lo que agrega la notebook: cursor oculto, avisos y barra de volumen
shared/
  json.ts                 validadores de datos (los usan el Cine y el servicio, sin duplicar)
  contracts.d.ts          tipos compartidos
src/                      el servicio de la notebook
  domain/                 TypeScript puro: puertos (TvScreen, VolumeControl, InputLock…), botones, configuración
  application/            casos de uso: control remoto, cursor, volumen, encendido, energía, celulares
  infrastructure/         Edge (DevTools), Windows (koffi), tele LG, servidor + protocolo Samsung, configuración
  app.ts                  raíz de composición: el único lugar que crea las clases concretas
  main.ts                 vigilante: evita abrirla dos veces y la reinicia si se cae
native/input-host.cs      el ayudante nativo (C#): cursor, modo tele y volumen
```

Comandos (con el Node de `runtime/`):

```
npm run build    # compila el servicio, el Cine y el ayudante nativo
npm run check    # chequeo de tipos + ESLint (nada de any)
npm test         # compila y corre las pruebas
```
