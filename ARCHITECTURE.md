# Arquitectura de futbol-sim

> Estado: las seis fases completadas. Las secciones marcadas **(planificado)** describen el diseño objetivo y todavía no están implementadas.

## Principios
1. Todo en el cliente, coste 0 €: sin backend ni cuentas.
2. Datos reales (partidos) y resultados ficticios (simulaciones) están separados en tipos, módulos y UI.
3. El motor (`src/engine`) es puro y determinista; la UI y el render lo consumen, nunca al revés.
4. La misma función de dibujo sirve para la vista previa y para la exportación.

## Estructura
```
src/
  app/                 composición de la aplicación (App, rutas/estado global)
  ui/                  tokens.css, base.css y componentes compartidos
  features/
    calendar/          lista de partidos, filtros, buscador, selección
    simulation/        vista previa, controles de semilla/marcador
    export/            exportación MP4, cola de lotes, descargas/ZIP
  data/                MatchProvider y proveedores (openfootball, …)
  engine/              guion de eventos + animación de jugadores/balón (sin React)
  test/                utilidades compartidas de pruebas
e2e/                   pruebas Playwright
```

## Calendario real (implementado en Fase 2)
- `MatchProvider` (`src/data/types.ts`): `listLeagues()` y `loadMatches(leagueId, {signal})`. La UI solo conoce esta
  interfaz y `MatchService`. Para añadir football-data.org (clave gratuita) se implementa otro `MatchProvider` y se registra en
  `createServices()` (`src/data/registry.ts`) sin tocar la UI; la clave se pediría al usuario y se guardaría solo en su
  navegador, nunca en el repositorio. **No está activado** (no hay clave y el sandbox no puede alcanzarlo).
- `MatchService`: caché en memoria (10 min) y `localStorage` (clave `futbol-sim:v1:<ligaId>`); si la red falla devuelve la última
  copia con `stale: true`. La cancelación (`aborted`) nunca cae a la caché.
- `fetchTextWithRetry`: 1 intento + 2 reintentos con espera 600 ms · 2ⁿ; reintenta red, 5xx y 429; no reintenta 404/4xx.
- **openfootball** (`src/data/openfootball.ts`):
  `https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/{es,en,de,it,fr}.1.json` (JSON) y
  `https://raw.githubusercontent.com/openfootball/europe-champions-league/master/2025-26/cl.txt` (Football.TXT).
  Sin clave y con `access-control-allow-origin: *`.
- **Horarios:** openfootball publica `date`/`time` en **hora local de la competición, sin zona**. Se guardan con
  `timeKind: 'league-local'` y se muestran tal cual (la UI lo avisa). Muchos partidos no traen hora (p. ej. 260 de 380 en
  Serie A): se muestran como «Hora por confirmar». Las fuentes en UTC (importadas) usan `timeKind: 'utc'` y se convierten a la
  zona del usuario con `Intl` (`kickoffOf`).
- **Resultados reales** (`realScore`) vienen de la fuente para partidos ya jugados; son datos, no simulaciones.
- **Champions League 2026-27:** ninguna fuente libre alcanzable la publica. Va incluida como archivo estático
  (`public/data/champions-league-2026-27.xlsx`, aportado por el usuario) mediante `BundledProvider`, que lo descarga con reintentos
  y lo convierte con el lector de `.xlsx` (`src/data/xlsx.ts`: zip con `fflate` + XML por expresiones regulares, sin DOM, usable en
  tests de Node). Solo contiene la fase de liga; para añadir eliminatorias basta sustituir el archivo.
- **Importación por el usuario** (`ImportedProvider`): `.xlsx` (columnas Jornada/Fecha/Hora/Equipo Local/Equipo Visitante, en
  cualquier orden, español o inglés), openfootball JSON, Football.TXT, football-data.org v4 y fixturedownload.com, autodetectados
  en `parseImportedCalendar`. Se guarda en `localStorage` (`futbol-sim:v1:imported-calendars`), solo en su navegador.
- **Competiciones «preparadas»** (`AWAITED_COMPETITIONS` en `src/data/imported.ts`): Europa League y Conference League 2026-27.
  Existen como ligas con `awaitingImport: true` (la UI no intenta cargarlas y ofrece importar); su id es el mismo que producirá
  la importación (`imported:<nombre>:<temporada>`), de modo que importar las rellena sin duplicados. Añadir otra competición
  preparada es añadir una línea a esa lista.
- Orden de pestañas (`MatchService.listLeagues`): LaLiga, Champions, Europa League, Conference League y el resto.
- Datos de prueba reales en `src/data/__fixtures__` (muestras) y `e2e/fixtures` (archivos completos).

## Motor de simulación (implementado en Fase 3, `src/engine`)
Puro y sin dependencias de React (ESLint lo impide). Entrada: `SimulationInput { seed, home, away, score | null }`.
- **Determinismo:** `mulberry32(seed ^ hash(local|visitante))`. Misma entrada ⇒ mismo guion y mismos fotogramas (probado por
  igualdad de JSON). Cada semilla cambia formaciones, marcador (si es aleatorio), qué equipo ataca, resultado de cada jugada,
  jugadores implicados y minutos. Mezclar los nombres hace que la misma semilla difiera entre partidos.
- **Guion (`generateScript`)**: línea de tiempo en segundos de vídeo: `intro → 1.ª parte → descanso → 2.ª parte → final`.
  Cada parte es una secuencia de *momentos*: ataque (con resultado `goal | saved | miss | post | blocked`), falta o córner (tras
  un bloqueo). Cada ataque incluye su fase de posesión (circulación del balón) y su remate. Marcador: o fijado por el usuario (0–9
  por equipo) o `Poisson(1,45 | 1,15)` sembrado. **Coherencia:** hay exactamente `score.home + score.away` ataques con resultado
  `goal` (cada uno con su evento `goal` del equipo correcto); cada equipo acaba con ≥ 2 disparos aunque no marque; los goles se
  reparten entre partes (46 % / 54 %) y a lo largo de ellas; los minutos salen del reloj, que mapea linealmente cada parte a
  0–45+x y 45–90+y (x ∈ 1–3, y ∈ 2–5), con etiquetas «45+2'», «90+3'».
- **Eventos** (`ScriptEvent`): `kickoff, shot, goal, save, miss, post, block, foul, corner, halftime, fulltime`, ordenados por
  tiempo, con minuto, etiqueta de reloj, equipo, dorsal y texto en español.
- **Animación (`frameAt(script, t)`)**: función pura de `t` (permite pausar, retroceder y renderizar fotograma a fotograma).
  Balón: segmentos con parábola. Jugadores: posición «de forma» (puesto de la formación 4-3-3, 4-4-2, 4-2-3-1, 3-5-2 o 3-4-3,
  desplazado según el balón, un peso de posesión continuo y movimiento de reposo) mezclada con *actores* (jugadores que reciben,
  conducen, corren o se lanzan) mediante rampas suaves; las rampas se dimensionan por distancia (la mayoría de jugadores < 36 m/s y ninguno > 55 m/s). Los
  equipos cambian de campo en la 2.ª parte (el salto queda oculto bajo la tarjeta de descanso).
- Qué es **ficticio**: todo lo que sale del motor. Los dorsales y colores son genéricos (los colores se derivan del nombre del
  equipo; no hay escudos ni equipaciones reales).
- Duración del vídeo: ~35–65 s con 0–3 goles; crece con los goles (hasta ~100 s con 9–9).
- Tests (`src/engine/engine.test.ts`): PRNG, estilos, formaciones, determinismo, coherencia marcador/goles (incluidos 0–0 y 9–9),
  eventos ordenados, fases contiguas, minutos plausibles, continuidad de la animación (balón < 60 m/s, jugadores < 55 m/s (sin teletransportes)) y
  robustez con marcadores extremos.

## Render (implementado en Fase 3) y exportación (planificado)
Dos estilos de vídeo sobre **la misma simulación** (`src/features/simulation/renderers.ts`, `drawVideoFrame(ctx, sim, t, meta, style)`):
- **Arena (por defecto, formato viral de TikTok)** — `renderArena.ts`. Un círculo con dos porterías enfrentadas (color del equipo que
  defiende ese lado; cambian al descanso) que giran con la cámara (`cameraAngle`, ≈ 0,3 rad/s); cada equipo es un escudo que se sitúa
  entre el centro de su equipo y el balón (más cerca del balón con posesión) y *conduce* el balón por su borde; HUD con escudos,
  marcador, reloj y etiqueta «SPRINT» durante los ataques; estela del balón y del escudo en sprint; partículas, onda expansiva y
  sacudida de cámara en los goles; etiquetas «¡PARADA!», «¡AL PALO!», «FUERA», «BLOQUEO», «FALTA», «CÓRNER»; barras de
  estadísticas en vivo (`statsAt`) y último suceso. La geometría (`arena.ts`) proyecta el campo en el círculo (mapa cuadrado→disco),
  prolonga la red hacia fuera para que **todo gol entre por la boca de la portería** (probado en 100 goles) y mantiene el balón
  dentro del aro salvo por las bocas. Los escudos son **genéricos** (`crest.ts`: patrón según el nombre + colores + abreviatura; no
  hay logos protegidos). El suelo y el halo se cachean en una capa; lo que depende del giro se dibuja por fotograma.
- **Táctico** — `render.ts`. Campo vertical con los 22 jugadores, balón, líneas del campo y marcador.
- Ambos: 1080×1920, etiqueta «SIMULACIÓN FICTICIA» arriba (en todos los fotogramas, comprobado por píxel en e2e) y pie «Simulación
  ficticia · Resultado inventado, no es una predicción», tarjetas de intro/descanso/final (con estadísticas acumuladas hasta ese
  instante), banner de gol y zonas seguras de TikTok (el contenido clave está entre y≈150 y y≈1700). Los colores del vídeo viven en
  `theme.ts` (no son tokens de la UI).
- Referencia visual: grabación aportada por el usuario (arena circular con porterías giratorias, escudos, marcador y «SPRINT»). El
  vídeo de referencia usa logos reales y música con derechos; aquí se usan escudos genéricos y **no se genera audio** (ver TASKS).
- Estudio (`SimulationStudio`): selector de estilo, vista previa con reproducir/pausar/posición, semilla, marcador aleatorio o fijado y
  lista de sucesos (al pulsar uno salta a ese momento). Respeta `prefers-reduced-motion` (no reproduce solo).

## Exportación MP4 (implementado en Fase 4, `src/features/export`)
- `exportVideo()`: renderiza **fotograma a fotograma** (no en tiempo real) con `drawVideoFrame` (la misma función que la vista previa) sobre
  un `OffscreenCanvas` 1080×1920 y lo codifica con WebCodecs a través de `mediabunny` (`CanvasSource` → `Output` con `Mp4OutputFormat`
  `fastStart: 'in-memory'`, o sea `moov` al principio del archivo, mejor para subirlo a TikTok). 30 fps, ~6 Mbps VBR, fotograma clave cada
  2 s, sin pérdida de fotogramas (`latencyMode: 'quality'`). Metadatos: título y «Simulación ficticia».
- **Códec del producto: H.264 (`avc`)**. `checkExportSupport()` comprueba `VideoEncoder` y `canEncodeVideo(avc, 1080×1920, 30 fps)`; si no hay
  soporte lanza `ExportError` con el mensaje «Este navegador no puede codificar vídeo H.264 a 1080×1920. Usa Chrome, Edge o Safari
  recientes.» y el botón de exportar queda desactivado. Nunca se finge una exportación.
- Errores tipados (`ExportError`): `unsupported-browser`, `codec-unsupported`, `out-of-memory` (RangeError/cuota → «cierra otras pestañas…»),
  `cancelled` (AbortSignal, libera el codificador) y `encode-failed`.
- Progreso por fotograma (+ tiempo restante estimado), cancelación y reintento en `ExportPanel`; el resultado se muestra en un `<video>`
  y se descarga con nombre `liga_local_vs_visitante_fecha_semilla.mp4` (`exportFileName`: minúsculas, sin acentos, ø/æ/ß transliterados).
- Memoria: el MP4 se arma en memoria (≈ 35 MB para 52 s a 6 Mbps) y el `ImageBitmap`/frames no se acumulan (cada fotograma se codifica y
  se descarta; `CanvasSource.add` aplica contrapresión).
- **Verificación (`npm run verify:export`, `scripts/verify-export.ts`)**: el Chromium del sandbox **no codifica H.264** pero sí VP9. Se
  ejecuta el exportador real en Chromium con VP9 en MP4 y se valida con ffprobe/ffmpeg (contenedor, códec, 1080×1920, 30 fps, nº de
  fotogramas, duración, fastStart y decodificación sin errores). Para H.264 se comprueba el empaquetado: fotogramas de la app →
  `libx264` → desmux con mediabunny → remux con la misma configuración del exportador → ffprobe (`h264/avc1 High`, 1080×1920,
  `yuv420p`, 30 fps, `moov` primero). **Lo que no se puede probar en el sandbox es el codificador H.264 del navegador del usuario.**
- `VITE_EXPORT_CODEC` (sólo al compilar) cambia el códec para probar la interfaz en navegadores sin H.264; el producto compila con
  `avc`. Playwright tiene un proyecto `chromium-export-vp9` que compila con VP9 y ejecuta el flujo completo (progreso, cancelar, vídeo
  reproducible, descarga validada con ffprobe).

## Lotes, descargas y errores (implementado en Fase 5)
- `BatchQueue<T>` (`batchQueue.ts`, sin React ni navegador; el generador se inyecta): cola **secuencial** (un vídeo cada vez) con estados
  `pending/running/done/error/cancelled`, progreso por trabajo, `cancel()` (aborta el vídeo en curso y marca las pendientes), `retry(id)` y
  `retryFailed()`, `remove(id)`/`clear()` (liberan el resultado), `resume()` y `snapshot()` estable para `useSyncExternalStore`. Cada trabajo
  lleva sus parámetros (`data`: estilo, marcador fijado, partido), fijados al añadirlo.
- Un fallo no detiene a los demás. **Sin memoria** (`out-of-memory`) la cola se **pausa** conservando las pendientes: el usuario descarga o quita
  vídeos terminados y pulsa «Reanudar». Tope de 10 vídeos por lote (≈ 35 MB cada uno hasta que se descarga o se quita).
- Nombres de archivo `liga_local_vs_visitante_fecha_semilla.mp4`, únicos dentro del lote (`-2`, `-3`…). El primer vídeo del lote usa la semilla
  actual y el resto semillas aleatorias distintas.
- Descargas: individual (enlace temporal con `Blob`) y **ZIP** (`buildZip`, `fflate` en streaming con `ZipPassThrough`, sin compresión porque el MP4
  ya está comprimido; cada vídeo se lee por trozos). Incluye `LEEME.txt` («SIMULACIONES FICTICIAS…») y el nombre es `…_N-videos.zip`.
- Gestión de errores del producto: red del calendario (reintentos + caché), códec no soportado (mensaje con navegadores recomendados y botones
  desactivados), memoria insuficiente (pausa de la cola / mensaje), cancelación (libera el codificador) y fallos del ZIP (mensaje + reintento).

## Ritmo y escudos propios
- **Ritmo** (`src/engine/pace.ts`, `SimulationInput.pace`, por defecto `fast`): el guion se genera siempre al ritmo normal y `retime()` deforma el tiempo por fases
  (función monótona lineal por tramos): jugadas ×0,6; intro 1,3 s; descanso 1,9 s; final 2,8 s; las rampas de los jugadores ×0,6. Sucesos, orden, minutos de reloj, marcador y
  estadísticas son idénticos (probado); `timeScale` acorta el banner de gol (≥ 1,5 s) y el rótulo del último suceso (≥ 1,8 s) y la mezcla de posesión. Un partido típico: 20–40 s.
- **Escudos subidos** (`crestStore.ts`, `useTeamCrests.ts`, `CrestsPanel.tsx`): validación (PNG/JPG/WebP ≤ 3 MB), reducción a 256×256 con `createImageBitmap`, almacenamiento en
  `localStorage` (`futbol-sim:v1:crest:<equipo>`) y registro en memoria de `ImageBitmap` que lee `drawCrest` (sprite cacheado con la versión del escudo). Sin imagen se usa el escudo
  genérico. Lo usan ambos estilos, la vista previa, la exportación y los lotes; cambiar un escudo reinicia la exportación mostrada.

## Rendimiento, memoria y accesibilidad (Fase 6)
- **Carga**: el estudio (motor, render, exportador, mediabunny y fflate) se carga de forma diferida (`React.lazy`): JS inicial 533 kB → 274 kB (160 → 88 kB gzip);
  el calendario no paga el coste del motor ni del exportador.
- **Dibujado** (medido con `npm run bench`, rasterización forzada, Chromium sin GPU): Arena ≈ 19 ms/fotograma de media (p95 25 ms), Táctico ≈ 7 ms; `simulate()` 5 ms y
  `frame()` 0,02 ms. Optimizaciones: una sola capa estática (fondo + halo + suelo), resplandores acotados al cuadrado que los contiene y escudos precalculados como
  sprites (40 → 19 ms).
- **Exportación**: 1555 fotogramas (52 s de vídeo) en ≈ 41 s (≈ 37 fps) con VP9 por software en el sandbox; con H.264 por hardware en un móvil/PC debería ser más
  rápido (no medido). **Memoria**: el montón de JS sube ≈ 38 MB mientras codifica y vuelve a ≈ 18 MB tras el GC, igual tras la 2.ª exportación (no hay fugas). El MP4 final
  (≈ 35 MB) se arma en un `ArrayBuffer` fuera del montón de JS.
- **Accesibilidad**: axe-core (WCAG 2.x A/AA, incluido contraste) en e2e: calendario, calendario con selección, diálogo de importación, estudio (Arena y Táctico) y móvil sin
  violaciones; tokens con contraste AA comprobado en unitarias. Los nombres accesibles se derivan del contenido visible (WCAG 2.5.3).
- **Reglas del proyecto como tests** (`src/test/rules.test.ts`): sin emojis, colores sólo en `tokens.css`, sin `any`/`@ts-ignore`/`catch {}` vacíos, iconos SVG con
  `aria-hidden` y zonas táctiles con `--tap`.
- **Subruta/despliegue**: `VITE_BASE` + prueba e2e (`chromium-subpath`); workflow de Pages sólo manual (ver `docs/DESPLIEGUE.md`).

## Calidad
- TypeScript estricto + `noUncheckedIndexedAccess`; ESLint `strictTypeChecked`; sin `any`, sin `catch {}` vacío.
- `src/engine` no puede importar React (regla `no-restricted-imports`).
- Tokens de diseño únicos en `src/ui/tokens.css`; contraste AA comprobado por tests.
- `npm run ci` = typecheck + lint + tests + build.
