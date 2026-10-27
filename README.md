# ControlTv PC 📺

Convierte la notebook enchufada por HDMI al tele en una **Smart TV** que se maneja con la app
**ControlTv** del celular, sin cambiarle nada a la app.

## Cómo funciona

```
celular (app ControlTv) ──WiFi──> notebook: servicio ControlTv PC (puerto 8001)
                                    ├─ Edge a pantalla completa: el inicio y las apps
                                    ├─ Windows: cursor, clic, play/pausa, apagar la pantalla
                                    └─ volumen del sonido que sale por el HDMI
notebook ──HDMI──> tele (sólo imagen y sonido: la notebook no le habla al tele)
```

- **La app del celular la ve como una tele Samsung llamada "Notebook TV".** La notebook habla el
  mismo idioma que una Samsung (el que la app ya conoce): botones, texto, abrir páginas y el
  touchpad de la pestaña *Mouse*. Por eso no hizo falta tocar la app.
- **Volumen:** los botones de volumen del celular suben y bajan el sonido que la notebook manda
  al tele por el HDMI, con una barrita propia en pantalla. Dejá el volumen del tele fijo en un
  nivel cómodo (por ejemplo 50) y manejá todo desde el celular.
- El inicio muestra hora, clima, dólar, noticias y una foto de fondo que cambia sola. Si nadie lo
  usa por 3 minutos pasa a **modo ambiente** (reloj grande).
- **Mouse:** la tele tiene su propia flecha, que sólo mueve el touchpad del celular. El cursor de
  Windows queda invisible y el touchpad/mouse físico de la notebook se bloquea mientras la tele está
  en pantalla (vuelve a andar al elegir *Salir al escritorio* o si la app se cierra).
- **Siempre abierta:** arranca sola al prender la notebook, se reabre si se cierra, y si el
  celular se conecta con la tele cerrada o la pantalla apagada, se abre sola.
- **Siempre a pantalla completa y al frente:** no se puede sacar con Alt+Tab, minimizar ni abriendo
  otro programa: vuelve sola. La única salida es *Ajustes → Salir al escritorio* (desde el celular
  con Menú, o con el teclado en el engranaje). Para volver: conectar el celular o el acceso directo.
  Emergencia: Ctrl+Alt+Supr siempre funciona.

## Botones del celular

| Botón | Qué hace |
|---|---|
| Flechas / OK | Saltar entre botones y links (como Chromecast) en el inicio y en cualquier página. Si no hay nada hacia ese lado, la página se desplaza |
| Atrás | Vuelve a la página anterior; si no hay, al inicio. En YouTube es su propio "atrás" |
| Inicio | Vuelve al inicio |
| Menú | Abre los Ajustes |
| Volumen / Silencio | Volumen del sonido que sale por el HDMI al tele (con barrita en pantalla) |
| Prender/Apagar | Apaga la imagen (el tele queda sin señal y el video se corta). Cualquier botón la vuelve a prender |
| Pausa | Play/pausa de lo que esté sonando (YouTube, Cine, Spotify…) |
| Canal + / − | Subir / bajar la página |
| Pestaña Mouse | Touchpad: mueve la flecha propia de la tele; tocar = clic; dos dedos = ruedita (sube/baja lo que está debajo). La flecha se esconde sola a los 5 segundos o al usar las flechas |
| Pestaña Internet | Buscar en Google/YouTube y abrir páginas. YouTube se abre en su versión para TV |


## Instalar

1. Clic derecho en `instalar.ps1` → **Ejecutar con PowerShell**.
   Baja Node.js portátil (queda en `runtime/`), instala las librerías, crea el acceso directo
   **ControlTv** en el escritorio y lo agrega al inicio de Windows.
2. La primera vez que arranca, Windows pregunta por el **Firewall**: elegí *Permitir acceso*
   (tildá también *redes públicas*, porque el WiFi de la casa está marcado como público). Sin esto
   el celular no encuentra la notebook. Otra opción: en Windows, *Configuración > Red > WiFi >
   tu red > Perfil de red: Privado*.
3. En el celular: abrí ControlTv, buscá TVs y elegí **Notebook TV**.

Para sacarlo del inicio automático: `desinstalar.ps1`.

## Recomendaciones para que vaya fluido

- **Resolución:** **1920×1080 a 60 Hz** (así está configurada). En 4096×2160 el HDMI sólo llegaba a
  29 Hz y todo iba a los tirones. La **escala** (150 %) no cambia el rendimiento: medido igual en
  100 %, 125 % y 150 % (60 cuadros por segundo; se dibujan los mismos píxeles). El 150 % deja letras
  y botones de buen tamaño para ver desde el sillón.
- **Placa de video:** la **Intel HD 4400** (la que está cableada al HDMI). Medido: con ella YouTube
  1080p60 se decodifica por hardware sin perder cuadros; con la GeForce 840M Edge pierde la
  decodificación por hardware (2–12 % de cuadros perdidos) y suma un cuadro de demora. La GeForce
  sólo gana en gráficos 3D, que estas apps no usan. Se puede probar en Ajustes → Placa de video.
- **Plan de energía "Máximo":** tiene el mínimo del procesador en 100 %. En una notebook vieja eso
  la calienta siempre y, si se recalienta, baja sola su velocidad. Con el mínimo en 5–10 % el turbo
  sube igual al instante cuando hace falta (ver `optimizacion/LEEME.md`).
- En *Opciones de energía*, que al **cerrar la tapa** no haga nada (la app ya evita que se suspenda).
- La sesión de YouTube, Spotify, etc. queda guardada: se inicia una sola vez (con el touchpad).
- **Cine ControlTV** no necesita cuenta: usa el catálogo público de FrameX y reproduce las fuentes
  HLS/MP4 que entrega su API. Si un servidor no responde, prueba con otro automáticamente.

## Personalizar

Todo vive en `%LOCALAPPDATA%\ControlTvPC`:

- `config.json`: nombre de la tele, ciudad del clima (`"location": {"city": "Santa Fe", "lat": -31.6, "lon": -60.7}`),
  velocidad del cursor (`pointerSpeed`), minutos para el modo ambiente, horas para apagarse solo.
- `apps.json`: las apps del inicio (copiá `apps.ejemplo.json` y editala).
- `logs\servicio.log`: qué pasó, por si algo falla.

## Cómo está hecho

TypeScript estricto (sin `any`, validado con `tsc --strict` y ESLint `strictTypeChecked`), con
**Clean Architecture** y principios **SOLID**, igual que la app Android. Las dependencias apuntan
siempre hacia adentro: `infrastructure` → `application` → `domain`.

```
shared/contracts.d.ts     tipos compartidos entre el servicio y la pantalla (estado, mensajes, datos del inicio)
src/
  domain/                 el corazón, TypeScript puro (sin Node, sin Windows)
    ports.ts              interfaces de todo lo externo: TvScreen, PointerSurface, VolumeControl, InputLock…
    remote.ts             botones y comandos del control remoto (RemoteCommand)
    apps.ts, settings.ts  modelos
  application/            casos de uso, sólo dependen de los puertos
    remote-command-handler          ejecuta lo que pide el celular
    pointer-service                 cursor propio: aceleración y un movimiento por cuadro
    volume-service                  volumen + barrita en pantalla
    power-service                   apagar/prender la imagen, apagado automático
    phone-access / phone-sessions   qué celulares entran y cuáles están conectados
    ui-state / ui-command-handler   estado y pedidos de la pantalla de inicio
  infrastructure/         implementaciones concretas de los puertos
    edge/                 Edge por DevTools (protocolo tipado): pantalla, cursor, dibujos encima
    windows/              Win32 (koffi), volumen HDMI, bloqueo del mouse, red
    http/                 servidor + traductor del protocolo Samsung (lo único que sabe de Samsung)
    home/                 clima, dólar, noticias, fondos, íconos (una clase por fuente)
    media/                catálogo de Cine ControlTV (API de FrameX, validada y con caché)
    storage/              configuración y apps en JSON, validando todo lo que se lee
  app.ts                  raíz de composición: el único lugar que crea las clases concretas
  main.ts                 vigilante: evita abrirla dos veces y la reinicia si se cae
web/                      la pantalla (TypeScript para el navegador)
  inject.ts               va dentro de cada página: cursor propio, navegación tipo Chromecast, avisos
  cinema.ts               Cine ControlTV: filas, ficha, buscador y reproductor HLS/MP4
  home/                   inicio: foco con flechas, filas, reloj, fondos, ambiente, ajustes, animaciones
native/input-host.ps1     el único ayudante nativo (C#): cursor, modo tele (mouse bloqueado y siempre al frente) y volumen
ui/                       HTML, CSS e íconos; ui/js/ es lo compilado de web/
assets/icon.ico           ícono de los accesos directos
```

Comandos (con el Node de `runtime/`):

```
npm run build    # compila el servicio y la pantalla
npm run check    # chequeo de tipos + ESLint (nada de any)
```