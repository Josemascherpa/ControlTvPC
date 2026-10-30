# Cine TV — la app para la tele (APK)

El **Cine**, el mismo de la notebook, pero como una app de Android que se instala en el televisor.
Está preparada para **Android TV**, **Google TV** (Chromecast, Google TV Streamer), **Fire TV** y **TV boxes con Android** que acepten instalar APK. La compatibilidad final depende del
WebView y los códecs del equipo; todavía requiere pruebas en televisores físicos.
Un Chromecast clásico sin Google TV no permite instalar este APK. Samsung Tizen, LG webOS
y Roku tampoco ejecutan APKs; pueden usar un dispositivo Android TV conectado por HDMI.

```
televisor: app Cine TV (WebView con el Cine adentro)
              ├─ se maneja con el mando del televisor (flechas + OK)
              └─ abre el puerto 8001 y se hace pasar por una Samsung
                        ▲
celular: app ControlTv ──WiFi──┘  (la elige como "Cine TV (<modelo>)")
```

El celular **no necesita cambios**: el televisor le habla igual que una Samsung, así que la app
ControlTv lo encuentra, le da la llave y lo maneja como a cualquier otra tele.

## Instalar

El APK se compila una vez (ver [Compilar](#compilar)) y queda en `CineTV-<versión>.apk`.
Para pasarlo al televisor, cualquiera de estas:

- **Por ADB** (lo más rápido si tenés la tele en la misma red con depuración activada):
  `adb connect <ip-del-tele>:5555` y después `adb install -r CineTV-1.1.apk`.
- **Por USB:** copiá el APK a un pendrive, lo enchufás en la tele y lo abrís con un explorador
  de archivos (en Android TV/Google TV: *Archivos* o *FX File Explorer*).
- **En Fire TV / TV boxes:** con la app *Downloader* (o el navegador) bajás el APK desde donde lo
  hayas subido, o usás *Enviar archivos a Fire TV*.
- Si el televisor avisa que no acepta "apps de origen desconocido", se habilita en
  *Ajustes → Seguridad → Instalar apps desconocidas* para el explorador o la app con la que abrís el APK.

Después aparece **Cine TV** en la fila de apps del televisor.

## Teléfonos y tablets

La versión 1.1 detecta el tipo de dispositivo. En televisores mantiene la interfaz para mando y
orientación horizontal; en teléfonos y tablets táctiles respeta la orientación del dispositivo,
permite deslizar el catálogo y las filas con el dedo y usa el teclado del sistema para buscar.
El APK desactiva el zoom por pellizco. Los controles del reproductor mantienen su forma circular
y las opciones se distribuyen en varias líneas cuando falta ancho.

## Descargar desde el televisor con Downloader

Downloader no aloja el archivo: descarga el APK desde una dirección web.
Para tener un enlace público, podés adjuntar `CineTV-1.1.apk` a una release de este repositorio:

1. En GitHub abrí **Releases → Draft a new release**.
2. Elegí la rama `android-tv` (debe estar subida), creá una etiqueta como `cinetv-v1.1`
   y adjuntá el APK en la sección de archivos de la release.
3. Publicá la release y copiá el enlace del archivo adjunto, que termina en `.apk`.
4. En la TV abrí **Downloader by AFTVnews**, pegá ese enlace y descargá el archivo.
5. Habilitá la instalación de apps desconocidas para Downloader si Android lo solicita e instalá.

El repositorio/release debe ser público para descargar sin iniciar sesión. El código corto de
Downloader es opcional: se obtiene después de tener el enlace público del APK.
También podés transferir el archivo desde el celular o por USB sin publicarlo.

Esta documentación no implica que la rama o el APK ya estén publicados.

## Usar

| Botón del mando | Qué hace |
|---|---|
| Flechas / OK | Moverse por el catálogo, la ficha y el reproductor |
| Atrás | Cierra el video → la ficha → la búsqueda; en el catálogo sale de la app |
| Menú | Vuelve al principio del catálogo |
| Play/Pausa | Play/pausa del video |
| Volumen | El volumen del televisor (el del sistema) |

El **celular** (app ControlTv) hace lo mismo y un poco más, porque para la tele esto es una Samsung:

- Flechas, OK, Atrás, Inicio/Menú, Pausa, Volumen y Silencio.
- **Escribir en la TV:** el texto cae en el buscador del Cine (y el teclado de la pantalla se
  maneja con las flechas).
- **Buscar** (pestaña Internet): busca el título dentro del Cine, no abre el navegador.
- **Pestaña Mouse:** touchpad con una flecha propia en la pantalla; tocar = clic.
- **Prender/Apagar:** apaga la imagen (pantalla en negro) y cualquier botón la vuelve a prender.
  El televisor en sí no se apaga: eso lo hace su propio control.

## Qué hace y qué no

- **Sí:** catálogo, búsqueda, fichas, series, anime, en vivo, reproductor con subtítulos/audio/calidad
  y lo que ya se vio (todo lo del Cine, igual que en la notebook).
- **No:** no prende ni apaga el televisor (Android no deja a una app hacerlo), no cambia de entrada
  HDMI ni instala otras apps. El botón de encendido del celular apaga la *imagen*.
- **Requiere:** Android 7.0 o más nuevo y un **WebView** actualizado (el Cine usa JavaScript moderno).
  En televisores con Play Store se actualiza solo; en los que no lo tienen, si la app queda en negro,
  hay que actualizar *Android System WebView* o usar otro televisor.
- El televisor y el celular tienen que estar en **la misma red WiFi** (el router no debe tener
  "aislamiento de clientes" activado).

## Compilar

Desde la raíz del repo:

```powershell
npm run build:typescript   # compila el Cine (una vez, o cuando cambie el Cine)
powershell -ExecutionPolicy Bypass -File android/compilar-apk.ps1
```

`compilar-apk.ps1` compila el Cine si hace falta, busca el JDK (usa `JAVA_HOME` o el de Android
Studio), compila con Gradle y deja el APK en la raíz del repo. Con `-Debug` genera la versión de
prueba (no firmada con la llave del repo).

A mano, si preferís Android Studio: abrí la carpeta `android/` como proyecto y *Build → Build APK(s)`.
El APK queda en `android/app/build/outputs/apk/release/app-release.apk`.

### Firma

El APK se firma con una llave fija que está en `android/keystore/cinetv.jks` (contraseña `cinetv`).
Es a propósito: así las próximas versiones se instalan **encima** de la que ya está en la tele, sin
desinstalar. Si publicás el repo, cambiá esa llave por una tuya.

## Cómo está hecho

Java puro sobre el framework de Android: sin AndroidX, sin Compose, sin librerías de terceros. Eso
lo deja en ~1 MB y lo hace instalar y andar en televisores viejos.

```
android/app/src/main/java/ar/com/josemascherpa/cinetv/
  CineTvApp.java            crea y conecta todo (el servidor vive acá, no en la Activity)
  MainActivity.java         el WebView con el Cine + las teclas del mando
  screen/Screen.java        lo que el control le puede pedir a la pantalla
  remote/RemoteCommand.java la orden ya traducida (tecla, texto, puntero…)
  remote/RemoteHandler.java ejecuta la orden contra Screen y el volumen
  remote/TvVolume.java      volumen del televisor
  server/TvServer.java      HTTP + WebSocket en el puerto 8001 (y sirve los archivos del Cine)
  server/SamsungProtocol.java  el "idioma Samsung" (igual que el de la notebook)
  server/PhoneLedger.java   la llave de cada celular (SharedPreferences)
  server/Assets.java        los archivos del Cine, desde los assets del APK
  server/Net.java           la IP del televisor en la red de la casa
web/tv/bridge.ts            el puente que el servidor le inyecta al Cine (teclas, texto, puntero)
```

- Los archivos del Cine (`ui/`) viajan **adentro del APK** (son assets) y se sirven en
  `http://127.0.0.1:8001/`: así la página tiene origen propio y funcionan los módulos, IndexedDB y
  `fetch` (con `file://` no andarían).
- El servidor mete en `index.html`, antes del código del Cine, dos scripts: `js/web/inject.js`
  (los avisos y la barrita de volumen, los mismos de la notebook) y `js/web/tv/bridge.js`
  (las funciones que usa la app de la tele).
- Las teclas del mando se traducen a eventos de teclado que el Cine ya entiende
  (`ArrowUp`, `Enter`, `Escape`…), y **OK sobre un botón hace el clic** (un evento sintético no lo
  hace solo).
- El puerto 8001 es el de las Samsung: la app del celular prueba primero ese (y después Google TV,
  ADB, etc.), así que el televisor aparece como una tele Samsung y gana el control con texto y mouse.

## Problemas comunes

- **El celular no la encuentra:** estar en la misma WiFi; revisar que el router no aísle clientes;
  el puerto 8001 tiene que estar libre (si otra app lo usa, el Cine igual abre, pero el celular no la
  ve). En *Ajustes → Apps → Cine TV → Forzar detención* y volver a abrir.
- **Queda en negro:** WebView viejo (actualizarlo) o sin internet.
- **El video no arranca:** el servidor de esa película puede estar caído; probá con *Servidor* o
  *Probar otro servidor*, igual que en la notebook.
- **La tele la cierra sola:** Android cierra apps en segundo plano. Al abrirla de nuevo vuelve todo;
  si estás en el inicio del televisor, abrí Cine TV con el mando. Android puede bloquear que
  el celular abra una app en segundo plano; no se garantiza el control si el sistema cerró su proceso.
