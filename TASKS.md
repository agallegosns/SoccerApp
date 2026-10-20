# TASKS

Leyenda: ✅ hecho y probado · 🟡 hecho, pendiente de verificar · ⬜ por hacer.

## Fase 1 — Entorno y base del proyecto
- ✅ Inspección del entorno (Node 22.22, npm 10.9, ffmpeg/ffprobe con libx264, Chromium 141 + Playwright 1.56.1).
- ✅ Scaffold Vite + React + TS estricto, ESLint (typescript-eslint `strictTypeChecked`), Vitest, Playwright.
- ✅ Dependencias con versión exacta y `package-lock.json`.
- ✅ Tokens de diseño en un único CSS y test de contraste AA de los pares de color.
- ✅ `npm run ci` en verde; humo e2e (`e2e/smoke.spec.ts`) pasa en Chromium.
- ✅ CLAUDE.md, ARCHITECTURE.md, README.md, TASKS.md.
- 🟡 Workflow de GitHub Actions (`.github/workflows/ci.yml`): escrito pero no ejecutado (no hay push a `main` ni PR).

## Fase 2 — Interfaz, calendario real y selección
- ✅ `MatchProvider` + `MatchService` (caché en memoria 10 min + `localStorage`; si falla la red se muestra la última copia con aviso).
- ✅ Proveedor openfootball: LaLiga, Premier League, Bundesliga, Serie A y Ligue 1 **2026-27**. Parser JSON probado con los
  archivos reales completos (380/380/306/380/306 partidos, ids únicos) y con fixtures reales en tests.
- ✅ Champions League **2025-26** (temporada anterior, finalizada) desde `europe-champions-league` (Football.TXT): 189 partidos,
  coincide con la cabecera del archivo; maneja el cambio de año, prórroga y penaltis.
- ✅ Reintentos con espera creciente (1 + 2 reintentos; 4xx no se reintenta, salvo 429), cancelación y errores tipados (`DataError`).
- ✅ UI: pestañas de competición, buscador (sin acentos ni mayúsculas), «Próximos/Jugados/Todos», rango de fechas, agrupación
  por día, paginación («Mostrar más»), estados de carga/error/vacío, panel de partido seleccionado, responsive (probado a 375 px
  sin scroll horizontal y con zonas táctiles ≥ 44 px) y aviso permanente de zona horaria.
- ✅ Los resultados reales se muestran como «Real 2–1», separados de lo ficticio.
- ✅ Importar calendario (JSON/TXT) con autodetección de formato y almacenamiento solo en el navegador.
- ✅ 66 tests unitarios + 15 e2e (en la Fase 2) (Playwright, Chromium) en verde: carga, filtros, selección, error + reintento, copia en caché
  sin red, importación, archivo inválido, móvil.
- ✅ **Champions League 2026-27** (fase de liga, 144 partidos, 8 jornadas, 36 equipos, 8/09/2026–27/01/2027) incluida en la app
  desde el Excel aportado por el usuario (`public/data/champions-league-2026-27.xlsx`). Ninguna fuente libre accesible la publica
  (openfootball llega a 2025-26; el resto está bloqueado desde el sandbox). Verificado con el archivo real: 144 ids únicos y cada
  equipo juega 8 partidos. **Faltan las eliminatorias** (octavos, etc.): se añadirán cuando haya calendario (sustituir el Excel).
- ✅ Lector de `.xlsx` propio (`src/data/xlsx.ts`, sobre `fflate`, sin dependencias nuevas): primera hoja, strings compartidas/inline,
  fechas como serie de Excel o texto, cabeceras en español/inglés. Probado con el Excel real y con .xlsx sintéticos.
- ✅ **Europa League 2026-27 y Conference League 2026-27 preparadas**: aparecen como pestañas «a la espera»; al importar su Excel
  (mismas columnas que el de la Champions: Jornada, Fecha, Hora, Equipo Local, Equipo Visitante), JSON o TXT, la pestaña se rellena
  sin duplicarse y persiste. Orden fijo: LaLiga, Champions, Europa League, Conference League y el resto.
- 🟡 **Pendiente del usuario:** los Excel de la Europa League y la Conference League 2026-27 (y, cuando existan, las eliminatorias
  de la Champions). Probado el flujo con el Excel de la Champions subido como si fuera la Europa League.
- 🟡 Horas del Excel: no declaran zona horaria; se muestran tal cual (probablemente hora peninsular/CET, sin confirmar).
- 🟡 Importadores de football-data.org (v4) y fixturedownload.com: construidos según la documentación y probados solo con datos de
  ejemplo escritos a mano. **Pendiente de verificar con un archivo real descargado.**
- 🟡 La petición real desde el navegador a raw.githubusercontent.com no se ha podido ejecutar en el sandbox (el navegador no
  usa el proxy). Verificado: cabecera `access-control-allow-origin: *` con `curl` y parseo de los archivos reales. En e2e se sirven
  los mismos archivos reales vía `page.route`. **Pendiente de verificar en un navegador con red.**
- 🟡 Horas de la Champions 2025-26: el archivo no declara zona horaria; se muestran tal cual (como en el resto de openfootball).
- ⬜ Selector de fechas: el formato (mm/dd/aaaa) lo decide el navegador según su idioma; no se puede forzar desde la página.

## Hallazgos del entorno (relevantes para fases siguientes)
- openfootball 2026-27 responde 200 con CORS abierto para `es.1`, `en.1`, `de.1`, `it.1`, `fr.1`.
  Algunos partidos ya traen resultado real (`score`) y otros no traen hora (`time`).
- **Champions League:** no existe 2026-27 en openfootball (ni en `football.json`, ni en `europe-champions-league`, ni en
  `champions-league`). Solo `europe-champions-league/2025-26/cl.txt`. Resuelto en la Fase 2: ver arriba.
- **El Chromium del sandbox NO codifica H.264** (`VideoEncoder.isConfigSupported` → `false` para todos los
  `avc1.*`); sí codifica VP9 (`vp09.00.40.08`), AV1 y VP8, tanto en headless-shell como en Chromium completo.
  Estrategia de verificación en la Fase 4: ver `ARCHITECTURE.md` → «Verificación del export».
- ESPN, TheSportsDB y football-data.org no son accesibles desde el sandbox: no se dependerá de ellos.

## Fase 3 — Motor de simulación 2D y vista previa
- ✅ Motor determinista por semilla (`src/engine`): guion de eventos + animación de 22 jugadores con 5 formaciones, balón con
  pases/conducciones/centros/tiros, paradas, postes, bloqueos, faltas, córners, goles con celebración, descanso y final.
- ✅ Coherencia marcador/goles verificada con marcadores fijos (0–0, 1–0, 0–3, 2–2, 5–4, 9–9) y aleatorios (200 semillas).
- ✅ 36 tests del motor (determinismo, coherencia, eventos ordenados, fases contiguas, minutos, continuidad < 36 m/s, robustez).
- ✅ Render Canvas 2D 1080×1920 con **dos estilos**: *Arena* (por defecto; formato viral de la grabación de referencia, más pulido:
  escudos genéricos, resplandor, estelas, partículas, sacudida en goles, estadísticas en vivo) y *Táctico* (22 jugadores). Vista
  previa con reproducción, pausa, posición y sucesos clicables.
- ✅ Geometría de la arena verificada: los 100 goles de 25 simulaciones entran por la boca de la portería; el balón no sale del aro.
- ✅ Estadísticas acumuladas (`statsAt`) coherentes con las del guion; la tarjeta de descanso muestra las del momento.
- 🟡 **Audio:** la referencia lleva música/efectos. El vídeo exportado irá **sin audio** (sin música con derechos y sin codificador de
  audio verificado en el sandbox); TikTok permite añadir sonido al publicar.
- 🟡 Se usan **escudos genéricos** (no los reales de la referencia, que son marcas protegidas).
- ✅ 8 e2e del estudio (misma semilla ⇒ misma simulación, marcador fijado, píxel de la etiqueta ficticia en 7 momentos del vídeo,
  semilla inválida, móvil).
- ✅ Inspección visual de fotogramas reales (intro, juego, córner, descanso con estadísticas, final).
- 🟡 La estética del vídeo (tamaño de jugadores, ritmo) está validada solo a ojo en capturas; pendiente de ver en un móvil real.
- 🟡 Reproducción en tiempo real a 60 fps no medida (solo en Chromium headless del sandbox).
## Fase 4 — Renderizado y exportación MP4 vertical
- ✅ Exportador real (`exportVideo`): render fotograma a fotograma + WebCodecs + mediabunny → MP4 1080×1920, 30 fps, fastStart.
- ✅ **Verificado con ffprobe** (`npm run verify:export`, 13/13): MP4 con VP9 de un partido 2–1 (51,8 s): `1080×1920`, `30/1`, 1555 fotogramas
  (= esperados), duración 51,83 s vs 51,81 s, `ftyp,moov,mdat`, decodifica sin errores; fotogramas extraídos del MP4 coinciden con la
  vista previa. Tardó 76 s en el sandbox (VP9 por software) y pesó 35,2 MB.
- ✅ Empaquetado H.264 de mediabunny verificado (fotogramas de la app → libx264 → remux): `h264/avc1 High`, `yuv420p`, 1080×1920, 30 fps.
- ✅ Soporte de códec detectado con `canEncodeVideo`: en el sandbox muestra el error claro con navegadores recomendados y desactiva el botón.
- ✅ Errores de memoria/códec/cancelación tipados y probados; nombres de archivo `liga_local_vs_visitante_fecha_semilla.mp4`.
- ✅ e2e (proyecto VP9): exportar → progreso → `<video>` reproducible (1080×1920) → descarga validada con ffprobe; cancelar y reintentar.
- 🟡 **Pendiente de verificar: la codificación H.264 en un navegador real** (Chrome/Edge/Safari). El Chromium del sandbox no tiene
  codificador H.264; el código es el mismo que en VP9 salvo el códec (`avc`), pero no se ha ejecutado.
- 🟡 Sin audio en el vídeo (ver Fase 3). Rendimiento de la exportación en móviles no medido.
## Fase 5 — Lotes, descargas y errores
- ✅ Cola secuencial `BatchQueue` (progreso, cancelación, reintento, pausa por memoria, liberación de resultados) con 9 tests unitarios
  (generador falso controlado: orden y no-concurrencia, fallo aislado, cancelar/reintentar, pausa/reanudar, quitar en curso, nombres únicos).
- ✅ ZIP en streaming (`fflate`) con `LEEME.txt`; test: contenido, bytes idénticos, nombres únicos, archivo vacío.
- ✅ `BatchPanel`: generar N (1–10) vídeos con semillas distintas, estado y progreso por vídeo, descargar uno / ZIP, cancelar todo, reintentar
  fallidos, quitar (libera memoria), «ver en la vista previa» y aviso de memoria en uso.
- ✅ e2e reales (compilación VP9, ~4 min): lote de 2 vídeos **distintos** → descarga individual + ZIP → el MP4 suelto y el del ZIP son idénticos,
  el ZIP trae `LEEME.txt` + 2 MP4 y ffprobe confirma VP9, 1080×1920, 30 fps; cancelar todo / reintentar / quitar en curso.
- ✅ Con el navegador sin H.264 (sandbox) el lote lo explica y desactiva «Generar».
- 🟡 La pausa por falta de memoria está probada con el generador falso (RangeError), **no con una falta de memoria real** del navegador.
- 🟡 El ZIP de un lote grande (10 × ~35 MB) no se ha medido en memoria; el tope de 10 vídeos es una estimación prudente.
## Fase 6 — e2e, optimización, documentación y despliegue (preparado, sin desplegar)
- ✅ e2e Playwright: calendario, filtros, errores y caché, importación, estudio, estilos, exportación real, lotes con ZIP, accesibilidad (axe) y subruta.
- ✅ Accesibilidad con axe (WCAG A/AA): 6 escenarios sin violaciones; axe encontró y se corrigió un fallo real (nombre accesible de los partidos, WCAG 2.5.3).
- ✅ Reglas del proyecto como tests (`rules.test.ts`): detectó un `rgb()` suelto fuera de `tokens.css` (corregido con `--color-overlay`).
- ✅ Optimización medida: JS inicial 533 → 274 kB (carga diferida del estudio); dibujado Arena 40 → 19 ms; exportación de 52 s de vídeo 76 → 41 s en el sandbox.
- ✅ Memoria: sin fugas (heap tras GC 18,0 MB → 18,1 MB tras dos exportaciones; pico +38 MB).
- ✅ Despliegue preparado: `VITE_BASE`, prueba e2e bajo `/SoccerApp/` (recursos, Excel de la Champions y trozo diferido sin 404), workflow de Pages **solo manual**.
- ✅ Documentación: README con capturas, ARCHITECTURE, TASKS, CLAUDE, `docs/DESPLIEGUE.md` y `docs/football-data-org.md`.
- ✅ **Desplegado en GitHub Pages** (a petición del usuario): el workflow «Deploy a GitHub Pages» (ejecución 1, rama `claude/blissful-davinci-1xqg19`, commit `1faca99`) terminó con éxito: `npm ci`, `npm run ci`, subida del artefacto y `deploy-pages`. URL esperada: https://agallegosns.github.io/SoccerApp/
- 🟡 **Pendiente de verificar: la web publicada.** Desde el sandbox no se puede acceder a `github.io`, así que no se ha abierto la URL; sí se verificó antes la compilación bajo `/SoccerApp/` con la prueba e2e de subruta. Comprobar en un navegador: que carga el calendario, que aparece la Champions 2026-27 (Excel bajo la subruta) y que el estudio se abre.
- 🟡 Los workflows de GitHub Actions (`ci.yml` con job e2e, `deploy.yml`) están escritos pero **no se han podido ejecutar** aquí.
- 🟡 **H.264 real**: no verificado en un navegador con codificador H.264 (ver Fase 4). Recomendado antes de publicar: abrir la app en Chrome/Edge/Safari, exportar un vídeo y
  comprobarlo con `ffprobe` (códec `h264`, 1080×1920, 30 fps).
- 🟡 El rendimiento en móviles reales y el tiempo de exportación con H.264 por hardware no se han medido.
- 🟡 Sin audio; escudos genéricos; Europa League/Conference League sin datos hasta que se aporten los Excel; faltan las eliminatorias de la Champions 2026-27.

## Mejoras posteriores a petición del usuario: ritmo rápido y escudos
- ✅ **Ritmo rápido por defecto** (`pace: 'fast'`): partido típico 18–45 s (probado en 30 semillas) frente a 35–65 s; selector «Ritmo rápido/normal» en el estudio y en los lotes.
  Mismos sucesos, minutos y marcador que el ritmo normal (probado); animación continua sin teletransportes (< 110 m/s de pico, ≈ 55 m/s del normal ÷ 0,6); banner de gol legible.
- ✅ **Escudos por equipo**: subida de PNG/JPG/WebP (validación de tipo, tamaño y archivo corrupto con mensajes claros), reducción a 256 px, persistencia en `localStorage`,
  visibles en HUD y discos (Arena) y en la cabecera (Táctico), en la vista previa y en la exportación. Probado en e2e por píxel; axe sin violaciones con el panel nuevo.
- 🟡 **Escudos oficiales: no incluidos** (marcas registradas; el brief original pedía escudos genéricos). Cada usuario sube los suyos bajo su responsabilidad.
- 🟡 Los escudos se guardan por navegador (no se comparten entre dispositivos). El ritmo rápido aumenta la velocidad aparente de jugadores y balón: valorar a ojo si se prefiere un factor
  distinto de 0,6 (`FAST_PLAY_SCALE` en `src/engine/pace.ts`).
- ✅ **Redesplegado** (a petición del usuario): ejecución 2 del workflow de Pages con el commit `aa9dd45` (ritmo rápido y escudos), `build` y `deploy` correctos.
- 🟡 Pendiente de verificar en un navegador: que la web publicada muestre el ritmo rápido y el panel de escudos (desde el sandbox no se puede abrir `github.io`).

## Ajustes: vídeo de 20–30 s y discos separados (Arena)
- ✅ **Duración del ritmo rápido 20–30 s** (a petición del usuario): `FAST_MAX_SECONDS` 26; el juego se comprime (×0,75 como máximo, ×0,26 como mínimo) hasta que el total sea ≈ 26 s;
  intro 1 s, descanso 1,4 s, final 2,4 s. Medido en 40 semillas: 26,0 s exactos de 0-0 a 4-3; con 6-5 (11 goles) 29–35 s (límite: por debajo de ×0,26 el juego sería ilegible). Test unitario 20–30 s. Sustituye las cifras anteriores (18–45 s).
- ✅ **Discos de equipo ya no se quedan pegados** (`discScreenPositions` en `arena.ts`): el que defiende se coloca entre el balón y su portería (con vaivén), el que tiene la posesión se acerca al balón;
  separación mínima 211 px (antes 139 px = siempre tocándose; mediana 417 px) y, con el balón en la red, el disco se ancla al 72 % del radio para evitar saltos (máx. 42 px/fotograma, antes 243 px). Test unitario añadido.
- 🟡 Pendiente de verificar a ojo en el vídeo exportado; **redesplegado** a petición del usuario (ejecución 3 del workflow de Pages, commit `53b32ae`, `build` y `deploy` correctos); pendiente de verificar en el navegador que la web publicada muestre los discos separados y el vídeo de ~26 s (desde el sandbox no se puede abrir `github.io`).
