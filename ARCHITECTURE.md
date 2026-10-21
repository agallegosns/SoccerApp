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
  defiende ese lado; cambian al descanso) que giran alrededor del aro; cada equipo es un escudo con inercia que persigue el balón y lo
  golpea; HUD con escudos, marcador, reloj y etiqueta «SPRINT» durante las ráfagas de velocidad; estela del balón y del escudo en sprint;
  partículas, onda expansiva y sacudida de cámara en los goles; etiquetas «¡PARADA!»; barras de estadísticas en vivo (`statsAt`) y último
  suceso. **La Arena es una simulación física libre** (ver «Física libre de la Arena»): el marcador sale del juego. Los escudos son
  **genéricos** (`crest.ts`: patrón según el nombre + colores + abreviatura; no hay logos protegidos). El suelo y el halo se cachean en una capa.
- **Táctico** — `render.ts`. Campo vertical con los 22 jugadores, balón, líneas del campo y marcador.
- Ambos: 1080×1920, píldora ámbar arriba con la competición, fase y jornada («Champions League 2026-27 · Fase de liga · Jornada 3»; en todos los fotogramas, comprobada por píxel en e2e).
  **El vídeo no lleva el rótulo «Simulación ficticia»** (decisión del usuario); la interfaz, los metadatos del MP4 y el LEEME del ZIP sí lo indican. Tarjetas de intro/descanso/final:
  el descanso es sólo «DESCANSO» (sin estadísticas, para no dar un punto de fuga); el final muestra estadísticas acumuladas hasta ese
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
  (función monótona lineal por tramos): jugadas ×0,75 como máximo, comprimidas (hasta ×0,26) para que el total sea ≈ 26 s; intro 1 s; descanso 1,4 s; final 2,4 s; las rampas de los jugadores con el mismo factor (`timeScale`). Sucesos, orden, minutos de reloj, marcador y
  estadísticas son idénticos (probado); `timeScale` acorta el banner de gol (≥ 1,5 s) y el rótulo del último suceso (≥ 1,8 s) y la mezcla de posesión. Duración medida (40 semillas): 26,0 s de 0-0 a 4-3; 6-5 (11 goles) 29–35 s.
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
- **Subruta/despliegue**: `VITE_BASE` + prueba e2e (`chromium-subpath`); workflow de Pages automático al fusionar en la rama por defecto (y manual) (ver `docs/DESPLIEGUE.md`).

## Calidad
- TypeScript estricto + `noUncheckedIndexedAccess`; ESLint `strictTypeChecked`; sin `any`, sin `catch {}` vacío.
- `src/engine` no puede importar React (regla `no-restricted-imports`).
- Tokens de diseño únicos en `src/ui/tokens.css`; contraste AA comprobado por tests.
- `npm run ci` = typecheck + lint + tests + build.

## Física libre de la Arena (a petición del usuario)
`src/engine/arenaSim.ts` (puro, sin React; `simulateArena(input, bounce)`). Imita los vídeos virales de «arena»: nadie fija el resultado.
- **Mundo**: círculo de radio 1. Paso fijo de 1/240 s, precalculado y guardado cada 1/120 s en `ArenaTrack` (`sampleAt(track, t)` interpola): el estado es una **función pura del tiempo** (se puede saltar a cualquier instante) y **determinista por semilla + nombres**. Cuesta ≈ 15 ms por partido.
- **Balón**: rozamiento (según el nivel «Rebotes»), choque elástico con la pared (elasticidad 0,3 / 0,6 / 0,85 / 0,98 según el nivel) y con los escudos (masa 6:1 más un golpeo extra según la velocidad del escudo). Antibloqueo: si queda clavado contra la pared sale rebotado.
- **Escudos**: aceleración y velocidad máximas; IA sencilla: ir detrás del balón (con predicción de 0,16 s) y empujarlo hacia la portería en la que marcan (rodeándolo si están delante); cada ~1 s pueden **equivocarse** y tienen **tirones aleatorios**; ráfagas de «sprint» por equipo (`phases` de tipo `attack`). Chocan entre sí y con la pared.
- **Porterías**: giran (`gateAngle(seed, t)`), boca de 0,4 de ancho y 0,2 de fondo; en la 1.ª parte el local marca en la de arriba y se cambian en la 2.ª. **Gol** = el centro del balón cruza la línea de gol por la boca; el balón se queda en la red 1,15 s y sale un nuevo saque.
- **Sucesos reales**: `shot` (un toque cuyo trayecto apunta a la boca), `save` (el rival desvía ese tiro en 1,4 s) y `goal`; más saque, descanso y final. Con ellos se construye un `MatchScript` normal (reloj en dos partes, fases, estadísticas), así que el marcador del fotograma, el banner de gol, el rótulo y la ficha funcionan igual que en Táctico. Los córners y las faltas **no existen** en esta física y no se muestran en la Arena.
- **Integración**: `simulateFor(style, input, bounce)` elige entre `simulateArena` y el guion (`simulate`). `Simulation.arena` lleva la pista física. La Arena ignora el marcador fijado. El nivel de rebotes forma parte de las opciones del vídeo (y por tanto de la ficha).
- Medido (24 semillas, ritmo rápido de 26 s): ≈ 2,7 goles por partido (0–5), ≈ 7 tiros, ≈ 3,6 paradas, ≈ 37 choques con la pared y ≈ 42 toques.
**Límites**: la IA es sencilla; la portería gira mientras el balón viaja (la comprobación de «apunta a puerta» es una recta); no hay comprobación de la sensación de fluidez en un móvil real.

## Menú, rutas y biblioteca de vídeos (a petición del usuario)
- **Rutas por hash** (`src/app/route.ts`): `#/` calendario, `#/videos`, `#/videos/<id>`, `#/estadisticas`. Funciona en cualquier alojamiento (también con subruta), el botón «atrás» navega y una ficha se puede abrir en otra pestaña.
  El estudio sigue siendo un estado de `App` ligado a la sección en la que se abrió; al cambiar de sección se cierra. Vídeos y Estadísticas se cargan en trozos aparte (`React.lazy`), igual que el estudio.
- **`AppNav`**: barra inferior fija en móvil (con `safe-area-inset-bottom`) y pestañas en la cabecera en pantallas ≥ 48 rem; la sección actual lleva `aria-current="page"` y «Vídeos» muestra cuántas fichas hay.
- **Biblioteca** (`src/features/videos`): `VideoRecord` = partido + parámetros (semilla, estilo, ritmo, marcador fijado, opciones de personalización) + marcador ficticio, nombre de archivo, tamaño, duración y fecha. **No guarda el MP4** (decenas de MB, no cabe en
  localStorage): como el motor es determinista, «Descargar MP4» desde la ficha lo regenera idéntico con `exportVideo`. El `id` es un hash de los parámetros, así que volver a exportar lo mismo actualiza la ficha en lugar de duplicarla.
  Se crea en `ExportPanel` (al terminar) y en `BatchPanel` (por cada vídeo del lote) mediante `recordExport`. Se guarda en `localStorage` (`futbol-sim:v1:videos`, máx. 200) y se valida al leer (`toVideoRecords`).
  Límite conocido: si cambias el motor y la misma semilla da otro marcador, la ficha lo detecta y avisa (`engine-changed`); pasó con las fichas de Arena anteriores a la física libre.
- **Ficha** (`VideoDetail`): reproductor (`SimulationPreview`, la misma vista que el estudio) + pestañas *Resumen / Jugadas / Rendimiento / Publicar*, anterior/siguiente entre vídeos del mismo partido, migas de pan, abrir en el estudio con los mismos parámetros y eliminar con confirmación.
- **Sin desplazamiento lateral**: las ligas son una rejilla (`auto-fill`), `.segmented` y `.tabs` son rejillas `auto-fit` que pasan a otra fila, y los contenedores en rejilla usan `minmax(0, 1fr)`. Antes, «Sin rebotes / Pocos / Normal / Muchos» quedaba cortado (`overflow: hidden`) en pantallas estrechas.

## Estadísticas (TikTok / Instagram)
**Implementado (sin backend, coste 0 €)** — `src/features/stats`:
- Modelo: `Publication` (plataforma, enlace, título, fecha, vídeo enlazado opcional) con `Measurement[]` (una «foto» acumulada por fecha: vistas, me gusta, comentarios, compartidos, guardados, alcance opcional). Totales = suma de la última medición de cada publicación;
  evolución = para cada fecha, la última medición conocida de cada publicación; interacción = (me gusta + comentarios + compartidos + guardados) / vistas.
- Entrada de datos: formulario (valida enlace según plataforma, fechas y enteros ≥ 0) y **CSV** (`csv.ts`: separador coma/`;`/tab, BOM, comillas, cabeceras en español o inglés, fechas AAAA-MM-DD o DD/MM/AAAA, errores por línea sin perder las filas buenas). La identidad de una publicación es plataforma + enlace normalizado,
  así que importar el mismo archivo dos veces no duplica y las mediciones se fusionan por fecha. Exportar produce el mismo formato.
- Persistencia: `localStorage` (`futbol-sim:v1:stats`, máx. 500 publicaciones). Sólo existe en este navegador: hay que exportar el CSV para tener copia.

**Conexión automática (opcional, Worker propio; ver `docs/ESTADISTICAS-AUTOMATICAS.md`).** Implementada en `cloudflare/stats-worker.ts` (cron cada 30 min → instantánea en KV → `GET /stats`) y `src/features/stats/sync.ts` (la app la lee al abrir, cada 30 min y al volver a la pestaña; valida la respuesta, fusiona por enlace sin duplicar, una medición por día; lo que la API no da es `null` y se conserva lo anterior). 🟡 Sin probar contra las APIs reales. Lo investigado en la documentación oficial (octubre de 2026):
- *Instagram* — API de Instagram (Graph API) con «Instagram Login» o «Facebook Login»: por Reel da `views`, `reach`, `likes`, `comments`, `shares`, `saved` y `ig_reels_avg_watch_time`. Requiere cuenta **profesional**, una app en Meta for Developers y permisos de estadísticas
  (`instagram_business_basic` + `instagram_business_manage_insights`, o `instagram_basic` + `instagram_manage_insights` + `pages_read_engagement`). Datos con hasta 48 h de retraso.
- *TikTok* — API Display (`video.list`, scopes `user.info.basic` + `video.list`): por vídeo `view_count`, `like_count`, `comment_count`, `share_count`. Requiere app aprobada en TikTok for Developers. Access token de 24 h, refresh token de 365 días. No da guardados ni alcance.
- Ambas usan OAuth con un **secreto de cliente** que no puede ir en el navegador. Solución adoptada: un **Cloudflare Worker gratuito** (como el que usa otro proyecto del usuario) con `/auth/<plataforma>/start`, `/auth/<plataforma>/callback` y `/api/<plataforma>/media`; los secretos
  como *secrets* del Worker, los tokens cifrados en KV, el refresco de tokens en el Worker, y la app sólo recibe las métricas y las guarda como `Measurement` del día. Pasos previos que sólo puede hacer el usuario: crear la app en Meta y en TikTok, pedir el acceso a esas APIs y (si la plataforma lo exige) pasar su revisión.
  🟡 No he podido verificar cuánto tarda ni qué exige cada revisión: pendiente.
- Sin Worker conectado, la app sigue pidiendo los números a mano o por CSV y lo dice en la pantalla («Estadísticas manuales»). El Worker es la **única pieza fuera del navegador** y es opcional, gratuita y propia (decisión del usuario).
