# ControlTvPC: segunda etapa de mejoras

> **Documento histórico.** Las plataformas de suscripción que se mencionan acá se retiraron esa misma
> tarde; el estado vigente está en `CINE-2026-10-27.md`.

27 de octubre de 2026. Cambios locales en la carpeta ControlTvPC del escritorio. Esta etapa continúa las mejoras anteriores y mantiene intacta la app Android.

## Implementado

- Navegación común dentro de diálogos, menús y listas desplegables accesibles. No se seleccionan controles del catálogo que están detrás del panel.
- Atrás cierra un panel mediante su botón explícito o el botón que lo desplegó. Recupera el foco del disparador cuando existe. Si no reconoce un cierre, envía Escape real mediante Edge, sin retroceder por el historial detrás del panel.
- Texto del celular: conserva un campo editable enfocado o enfoca un único buscador visible. Si hay varios buscadores o ninguno, muestra una indicación y no envía texto a ciegas. No abre automáticamente buscadores ocultos. Conserva la entrada cuando el foco está en un iframe.
- Carruseles: se consideran elementos hasta una pantalla fuera del borde horizontal; la selección puede desplazarlos a la vista. La geometría prioriza elementos de la misma fila o columna.
- Netflix: el foco actual del sitio se tiene en cuenta; un panel comienza por su primera fila de controles.
- Menos animación de pintura al cambiar el resaltado genérico: se quitó la animación de sombra y contorno.
- Si falla el cambio de identidad del navegador, se cancela la navegación en vez de abrir la siguiente plataforma con una identidad que podría ser incorrecta.
- Compilación TypeScript separada del auxiliar nativo. Las pruebas ya no intentan sobrescribir el ejecutable nativo que está abierto.

## Alcance de las plataformas

Los comportamientos comunes se probaron en fixtures interceptados para Disney+, Prime Video, HBO Max, Paramount+, Pluto TV, Twitch, Spotify, YouTube Music, Cinehax, FrameX, CinemaOS y StreamFlix. También se mantuvieron las pruebas simuladas de Netflix y YouTube TV.

Esto comprueba los contratos HTML/ARIA y las ramas por dominio. **No equivale a probar las páginas reales de esas plataformas ni sus cuentas, selectores actuales, DRM o reproducción.** No se agregaron adaptadores específicos inventados para cada servicio. Interfaces con HTML sin semántica accesible, componentes cerrados o reproductores en iframes pueden seguir necesitando el touchpad o una adaptación específica.

La aplicación continúa siendo una interfaz de TV sobre Edge, con el protocolo Samsung que ya entiende ControlTv Android. No se convirtió en receptor Google Cast ni en las aplicaciones oficiales de Chromecast.

## Validación y límites

TypeScript, ESLint y las once pruebas automáticas pasaron. Las pruebas de navegador corrieron en un Edge headless separado, sin utilizar cookies ni sesiones del usuario. La suite cubre orden del control, colas, texto, identidad, reconexión, reposo, puntero, menús, carruseles y foco.

También se reutiliza la lista de paneles, invalidándola cuando cambia el DOM. Últimas tres rondas sintéticas (30 flechas, 1.500 botones): antes 374,7 / 255,1 / 345,1 ms; después 235,2 / 251,9 / 339,1 ms. Hay variación entre rondas; no son mediciones de latencia del celular ni de FPS.

La medición sintética continúa confirmando una sola búsqueda completa de candidatos en una tanda estable de 30 flechas, frente a 30 en el código original. No se midieron FPS reales de Netflix ni decodificación de video autenticado en esta etapa. No hay base para prometer 60 FPS en todas las plataformas.

El control de la ventana real había sido detenido por la herramienta de Windows por no poder identificar la URL. Esta etapa se limitó al código y a pruebas aisladas; no se intentó eludir ese bloqueo.

## Aplicar los cambios

El código queda compilado en la carpeta del escritorio. Una instancia del servicio que ya estuviera abierta conserva el código anterior en memoria. Para cargar todo, hay que reiniciar el servicio y Edge. Reiniciar Windows y abrir el acceso directo habitual es una forma sencilla de hacerlo; no hace falta reinstalar ni borrar perfiles.

Para repetir las comprobaciones, en PowerShell dentro de ControlTvPC:

```powershell
$env:PATH = "$PWD\runtime\node;$env:PATH"
$env:CONTROLTV_TEST = '1'
npm.cmd run check
npm.cmd test
```

`npm.cmd run build` sigue incluyendo el auxiliar nativo: debe ejecutarse con ese auxiliar cerrado. `npm.cmd test` compila TypeScript y ejecuta pruebas sin reemplazarlo.
