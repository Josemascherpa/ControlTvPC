# Cine TV 1.3: layout y rendimiento

Se compara la versión 1.2 con 1.3 usando ocho filas de veinte títulos, tres recorridos de tres segundos por resolución y el mismo fixture local. Edge headless, sin tráfico real ni películas; imágenes SVG de prueba con las dimensiones de las variantes TMDB. Estas medidas no representan FPS ni memoria RSS del BGH B5522US6A.

| Ventana CSS | Trabajo del navegador por recorrido (media) | Píxeles de miniaturas con src al terminar |
|---|---:|---:|
| 960 × 540 | 1986 → 538 ms | 28,420,860 → 1,723,800 |
| 1280 × 720 | 2311 → 749 ms | 28,420,860 → 1,723,800 |
| 1920 × 1080 | 2293 → 503 ms | 28,420,860 → 1,723,800 |

El trabajo de hilo principal disminuyó entre 68 y 78 %. El presupuesto de píxeles de miniaturas se redujo cerca del 94 % (28,4 a 1,72 megapíxeles). Es una aproximación al costo de imágenes referenciadas, no una lectura de memoria del proceso. La mejora de FPS final requiere volver a probar en el televisor físico.

## Cambios

- El catálogo usa Flex: la altura real del encabezado coloca las filas 12 px debajo, y se compacta al seleccionar tarjetas.
- Se mantiene el DOM de navegación para no perder foco, pero se excluyen del layout/pintado los tracks lejanos con una fila contenedora de altura estable. No se usa content-visibility, que recortaba el foco.
- Sólo cuatro filas como máximo se renderizan cerca de la selección. Las tarjetas lejanas conservan su espacio pero se ocultan y liberan su src. Los bytes pueden seguir en caché HTTP.
- Los nodos reciclados fuera del catálogo liberan las imágenes y se vuelven a hidratar al entrar.
- Las tarjetas solicitan backdrops w300; el fondo usa w780 o w1280 según el viewport. Sólo se reescriben URLs del host de TMDB. Se conserva el formato que entregue el origen, incluido WebP; no se convierte JPEG por cambiar su extensión.
- Se reducen sombras animadas, máscaras y el zoom del fondo; se mantienen transiciones cortas de foco y desplazamiento.

## Validación

- `npm run check` y `npm test`: 38 pruebas.
- `node tests/tv-performance.cjs perf-optimized`: tres rondas a 960×540, 1280×720, 1920×1080 y 3840×2160. Verifica dos filas completas, ventana de render y conservación del foco.
- APK instalado en emulador Android: WebView con layout TV 960×540, navegación por las ocho filas de ida y vuelta; filas a 158,7 px al seleccionar una tarjeta, 24 imágenes referenciadas al volver.
- Android Lint y compilación release.

El benchmark sirve para comparar cambios; no garantiza 60 FPS en hardware físico. El modelo de TV fue informado por el usuario; no se tiene acceso remoto al BGH.
