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
- ✅ Despliegue preparado: `VITE_BASE`, prueba e2e bajo `/SoccerApp/` (recursos, Excel de la Champions y trozo diferido sin 404), workflow de Pages automático al fusionar en la rama por defecto (y manual); pendiente de verificar en GitHub.
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

## Ajustes: fluidez, descanso y cabecera (a petición del usuario)
- ✅ **Más fluido**: balón y discos con movimiento suavizado en el tiempo (`smoothBall`, `smoothDiscPositions`, ventana ±0,12 s). Aceleración del balón p95 12,5 → 4,3 px/fotograma²; salto máximo del disco 38 px; test unitario.
  🟡 Pendiente de verificar a ojo en un vídeo exportado (no se puede juzgar la sensación de fluidez con métricas).
- ✅ **Descanso sin estadísticas**: sólo «DESCANSO» (con el marcador); el final conserva las estadísticas.
- ✅ **Sin rótulo «Simulación ficticia» en el vídeo**: la cabecera muestra «competición · fase · jornada». ⚠ Decisión del usuario que cambia una regla del proyecto (CLAUDE.md actualizado): la interfaz, los metadatos del MP4 y el LEEME del ZIP siguen indicándolo.
  Ojo: TikTok puede exigir marcar el contenido generado/ficticio al publicarlo.

## Ajuste: balón que rueda (a petición del usuario)
- ✅ Trayectoria del balón más suave (ventana ±0,2 s, pesos triangulares; aceleración p95 3,6 px/fotograma²) y dibujo del balón que **gira según la distancia recorrida** y su dirección. Test unitario del giro.
- 🟡 Pendiente de verificar a ojo en un vídeo exportado; **no desplegado** (hay que pedir un redespliegue).

## Ajustes: balón libre, tarjeta verde y selector de ligas (a petición del usuario)
- ✅ **Balón «por libre»**: se adelanta y se desvía mientras lo conducen; el disco lo persigue (visual). Test unitario (dentro del aro, ≥ 10 % de fotogramas «libres», aceleración < 60).
  🟡 Interpretación mía de «que la pelota vaya por libre»: si querías otra cosa (rebotes en el aro, balón suelto sin dueño…), dímelo. Pendiente de verificar a ojo en un vídeo exportado.
- ✅ **Tarjeta verde al descargar**: probado con exportación real (VP9) → descarga → calendario con `Descargado` y tras recargar; test unitario del almacén y de la tarjeta.
  La selección de partido pasa a azul para distinguirla. Se marca al descargar (suelto, desde el lote o ZIP), no al exportar.
- ✅ **Selector de ligas para móvil**: tarjetas grandes con insignia y (entonces) scroll horizontal — *sustituido por una rejilla sin desplazamiento, ver «Menú, estadísticas y ficha de vídeo»*; fechas plegables; avisos compactos; axe y zonas táctiles ≥ 44 px siguen en verde. 🟡 Pendiente de verlo en un móvil real.
- 🟡 **Sin desplegar**: hay que pedir un redespliegue.
- ✅ Corregido el texto del panel de exportación (decía que el vídeo lleva «Simulación ficticia»).

## Ajustes finales (a petición del usuario)
- ✅ **Actualización automática**: `version.json` por compilación + comprobación al abrir/volver/reconectar/cada 5 min + recarga sola (espera si hay exportación en curso, sin bucles). Probado: tests unitarios (5) y e2e (se recarga una sola vez con versión nueva; no se recarga con la misma).
  🟡 Pendiente de verificar en el móvil real y en la web publicada (desde el sandbox no se abre github.io): la primera vez hay que abrir la versión que ya incluye el actualizador; las siguientes se actualizan solas. Sin service worker: no hay modo sin conexión.
- ✅ **Marca manual «hecho»**: círculo en cada tarjeta (zona táctil 44 px) que marca/desmarca; se recuerda al recargar; test e2e. Etiqueta «Hecho» (antes «Descargado») porque cubre descargados y marcados a mano.
- ✅ **Quitados los avisos tras el filtro de fechas** (zona horaria, nota de la liga). Se conserva el aviso de «sin conexión: copia guardada». 🟡 Consecuencia: la app ya no explica en pantalla que las horas de openfootball/Excel no llevan zona horaria (sigue en el README).
- ✅ **Quitado el banner flotante «Selecciona un partido»**; el panel inferior sólo sale al elegir uno.
- ✅ **Instalable en el móvil**: manifest + iconos (🟡 no verificado en un móvil real; sin service worker puede que Chrome ofrezca «Añadir a pantalla de inicio» en vez de «Instalar»).
- 🟡 **Sin desplegar**: hay que pedir un redespliegue.

## Balón con rebotes y personalización (a petición del usuario, tomando como modelo el vídeo de referencia)
- ✅ **El balón rebota en las paredes** del aro en el estilo Arena (ley de reflexión, destello en la pared, chispas) y los escudos lo persiguen. Probado: reflexión exacta en cada rebote, balón dentro del aro, cada tramo empieza y acaba donde dice el guion
  (los sucesos y el marcador no cambian), sin teletransportes, determinista. Revisado a ojo en una secuencia de capturas de la vista previa.
  🟡 Diferencias con el vídeo de referencia: allí los escudos también rebotan y se chocan con el balón; aquí los escudos lo persiguen con retraso pero no rebotan en la pared. Con ritmo rápido y tramos cortos hay 7–15 rebotes por vídeo; «Muchos» sólo añade los tramos más cortos.
- ✅ **Personalización del vídeo**: 4 paletas, nivel de rebotes, estadísticas/último suceso/estela, texto gancho, marca de agua y texto del gol; se guardan en el navegador y valen para vista previa, exportación y lotes. Tests unitarios (validación) y e2e (cambian el vídeo, persisten, se restauran).
  🟡 Otras opciones posibles que no he añadido: velocidad del giro de la cámara, tamaño del balón o de los escudos, música/sonido .
- 🟡 Pendiente de verificar a ojo en un vídeo exportado (exportación real VP9 probada con ffprobe) y **sin desplegar** (hay que pedir un redespliegue).

## Física del balón (a petición del usuario)
- ✅ El balón se mueve con física: **acelera al ser golpeado** (velocidad máxima en el golpeo), **rueda y pierde velocidad por fricción** (decaimiento exponencial), **gira** con la distancia recorrida, **rebota en la pared** (reflexión + pérdida de velocidad + destello), traza **arcos con efecto** en pases/centros/tiros y, en los pases elevados, **cae y bota** con altura decreciente (sombra que se achica con la altura). El escudo que golpea se lanza al balón y se ve la onda del impacto.
  Probado (36 tests del módulo): fricción monótona, aceleración en el golpeo, conservación de extremos y horas del guion, reflexión, botes con restitución, altura ≥ 0, sin teletransportes; e2e y exportación real VP9 en verde.
- 🟡 **Límites honestos**: la física está *ajustada* al guion (llega donde y cuando dice), no es un simulador libre; los escudos no rebotan en la pared ni chocan con el balón de forma calculada (es un gesto de golpeo). Revisado a ojo sólo en capturas de la vista previa: pendiente de ver un vídeo exportado en movimiento.
- 🟡 **Sin desplegar** (hay que pedir un redespliegue).

## Menú, estadísticas y ficha de vídeo (a petición del usuario)
- ✅ **Sin desplazamiento lateral**: ligas en rejilla; `.segmented`/`.tabs` pasan a otra fila; contenedores `minmax(0, 1fr)`. Test e2e `layout.spec.ts`: 5 anchos (320, 360, 390, 768, 1280 px) × calendario, estudio, lista de vídeos, ficha (4 pestañas), estadísticas (3 pestañas) y el diálogo; comprueba página y cada elemento visible. Encontró un fallo real del diálogo a 320/360 px (arreglado).
- ✅ **Rebotes («Sin rebotes / Pocos / Normal / Muchos»)**: la causa era visual — el grupo de botones tenía `overflow: hidden` y en pantallas estrechas se cortaba, así que no se podían ver ni pulsar todas las opciones. Ahora pasan a otra fila; el e2e comprueba que los cuatro botones se ven enteros y miden ≥ 44 px a todos los anchos.
  La lógica de rebotes (`bounce.ts`, 6 tests) ya funcionaba y no se ha tocado. 🟡 Si lo que querías decir es otra cosa (que el balón no «se desplaza» distinto según el nivel), dímelo: con ritmo rápido y tramos cortos hay 7–15 rebotes por vídeo y «Muchos» sólo añade los tramos más cortos.
- ✅ **Menú** Calendario · Vídeos · Estadísticas (barra inferior en móvil, cabecera en escritorio), rutas por hash, «atrás» del navegador, URL directa a una sección o ficha. Tests e2e (`library.spec.ts`).
- ✅ **Biblioteca de vídeos y ficha**: la ficha se crea al exportar (suelto o en lote), guarda parámetros (no el MP4) y permite volver a descargar un MP4 idéntico. Probado con exportación **real** (VP9) → ficha → descarga desde la ficha → ffprobe (`library-export.spec.ts`), búsqueda/filtros, pestañas, jugadas que saltan en el reproductor, anterior/siguiente, copiar descripción, eliminar con confirmación, ficha inexistente. 7 tests unitarios del modelo y del almacén.
  🟡 En un navegador sin H.264 (como el Chromium del sandbox) el botón «Descargar MP4» de la ficha queda desactivado con el aviso correspondiente (probado); la descarga H.264 real sigue pendiente de verificar en un navegador real, igual que en el estudio.
- ✅ **Estadísticas manuales y CSV**: alta/edición/borrado de publicaciones, nuevas mediciones, totales, interacción, evolución (SVG con tabla alternativa), ranking, filtro por plataforma, importar/exportar CSV con informe de errores por línea, sin duplicados al reimportar. 14 tests unitarios + e2e. Accesibilidad (axe, WCAG AA) en todas las pantallas nuevas.
- ✅ **Conexión automática con TikTok e Instagram (cada 30 min)**: Worker de Cloudflare (`cloudflare/stats-worker.ts`, 10 tests con APIs simuladas) + cliente (`sync.ts`, tests unitarios y e2e con un Worker simulado). Guía paso a paso: `docs/ESTADISTICAS-AUTOMATICAS.md`.
  🟡 **Pendiente de verificar con las APIs reales** (no hay credenciales aquí) y el despliegue del Worker/cron en Cloudflare; el usuario debe crear las apps de Meta y TikTok (TikTok puede exigir revisión). Instagram/TikTok no dan todos los contadores (TikTok: sin guardados ni alcance).
- ✅ **Rediseño pensado para el móvil**: cabecera fija con zona segura (no se «come» bajo la muesca), competiciones plegadas en un botón, filtros en una fila, diálogos tipo hoja con botones siempre visibles, estudio con secciones plegables, lista de vídeos compacta, acciones de la ficha a ancho completo, hoja del partido sobre la barra inferior. Tests e2e en `layout.spec.ts`.
  🟡 Aún sin ver en un móvil real (solo emulación Chromium).
- 🟡 El importador CSV reconoce cabeceras en español e inglés habituales, pero **no está probado con una exportación real de TikTok Studio ni de Instagram** (no se pudo obtener ninguna); si su formato difiere, habría que añadir alias.
- 🟡 Pendiente de ver en un móvil real (barra inferior, teclado en los formularios) y **sin desplegar** (hay que pedir un redespliegue).

## Arena más fluida, descripciones y hora recomendada
- ✅ Escudos con física (`discPhysics.ts`): inercia (muelle amortiguado), empujones deterministas por semilla, rebotes contra la pared del aro y entre sí; función pura del tiempo (tabla precalculada). Probado en `arena.test.ts`.
- ✅ Gancho superior del vídeo en caja con márgenes laterales (96 px) y hasta 2 líneas.
- ✅ Pestaña «Publicar»: descripción «Local vs Visitante» (4 versiones, rotables) + 5 hashtags por plataforma (`publish.ts`). La viralidad de un hashtag NO se puede medir: lo dice la interfaz.
- ✅ Hora recomendada: con ≥ 8 publicaciones (≥ 3 días de antigüedad, hora conocida) y ≥ 3 en la franja, mediana de visualizaciones por franja; si no, franja orientativa (2 h antes del partido) marcada como orientativa. Sin hora de partido ni datos: «Sin recomendación todavía».
- 🟡 La hora de cada publicación llega del Worker (`publishedAtIso`): hay que volver a pegar `cloudflare/stats-worker.js` en Cloudflare. Sin probar contra las APIs reales.
- 🟡 Pendiente de verificar: sensación de fluidez en un móvil real (no se ha recibido el vídeo de referencia).

## Arena con física libre (como los vídeos virales)
- ✅ `src/engine/arenaSim.ts`: simulación física determinista por semilla. Dos escudos con IA sencilla (persiguen el balón y lo golpean hacia la portería en la que marcan, con errores y tirones aleatorios, ráfagas de «sprint»), balón con rozamiento y choques elásticos con la pared y entre sí, porterías que giran. **Goles, tiros y paradas salen del juego**; el marcador no se puede fijar en la Arena (decisión del usuario). Probado en `arenaSim.test.ts` (determinismo, marcador = goles, continuidad, dentro del aro, variedad de marcadores…).
- ✅ El nivel «Rebotes» del vídeo es ahora la elasticidad de la pared (afecta a la física, no sólo al dibujo).
- ✅ Estadísticas de la Arena: sólo tiros y a puerta (córners y faltas no existen en esta física, no se muestran).
- ⚠ Las fichas creadas antes de este cambio avisan («versión anterior del simulador»): la misma semilla da ahora otro partido.
- 🟡 Pendiente de verificar: la sensación de movimiento en un móvil real (solo se han revisado fotogramas y métricas).
- ✅ Vídeos: botón «Marcar como publicado» en la ficha (a mano, con fecha), chip «Publicado» y filtro en la lista (`published.ts`). Es solo orden: no se conecta con TikTok/Instagram.
- ✅ Cartel de gol más pequeño; el juego se detiene mientras dura (el balón queda en la red) y se oculta el rótulo inferior repetido. Descripciones: solo «⚽ Local vs Visitante ⚽» + 5 hashtags, sin marcador.


## Programado, aviso de publicación y borrado (2026-10-21)
- ✅ **Estado «Programado»** (`features/videos/scheduled.ts`, `ScheduleDialog.tsx`): en la ficha, «Programar» / «Cambiar hora» guarda la fecha y hora a la que el usuario lo programó a mano en TikTok/Instagram (localStorage `scheduled-videos`). La app NO programa nada en las plataformas. Chip «Programado · fecha · hora» en la ficha y en la lista; filtro «Solo programados».
- ✅ **Aviso «¿Se ha publicado?»** (`DuePrompt.tsx`): al llegar la hora, la app pregunta; «Sí, ya está publicado» → pasa a «Publicado» (y deja de ser programado); «Todavía no» lo oculta 10 min; «Cambiar hora» abre la ficha. 🟡 Solo funciona con la app abierta: no hay servidor que envíe notificaciones push con la app cerrada. Opcional: «Activar aviso» pide permiso de notificaciones del navegador (en iPhone solo con la app instalada en la pantalla de inicio; sin probar en un iPhone real).
- ✅ **Eliminar desde Vídeos**: botón «Eliminar» en cada tarjeta y modo «Seleccionar» para borrar varias; siempre con confirmación; también limpia sus marcas de publicado/programado.
- ✅ **Desplazamiento lateral**: causa probable en iPhone = campos con letra menor de 16 px (Safari amplía la página al tocarlos y deja la pantalla desplazable). Todos los campos usan ≥16 px; `html/body` con `overflow-x: clip`; `e2e/layout.spec.ts` ahora falla si algún campo visible es menor de 16 px. 🟡 No se ha podido comprobar en un iPhone real.


## Sincronización móvil ⇄ ordenador (2026-10-21)
- ✅ `src/features/sync/` (`core.ts` fusión por elemento con marca de tiempo y lápidas, `engine.ts`, `collections.ts`, `deviceSync.ts`, `SyncDialog.tsx`) + `POST /sync` en `cloudflare/stats-worker.ts`. Sincroniza fichas de vídeo, publicado, programado, descargado, estadísticas, calendarios importados y escudos. Guía: `docs/SINCRONIZACION.md`.
- ✅ Probado: 7 pruebas del motor con dos dispositivos contra el Worker real (altas, borrados, conflictos, reloj desfasado, estadísticas fusionadas, sin escrituras inútiles, errores) + 4 del Worker + e2e con dos navegadores (`e2e/device-sync.spec.ts`), accesibilidad y diseño estrecho de la ventana.
- 🟡 Pendiente de verificar: con el Worker desplegado en Cloudflare de verdad y desde un iPhone. El usuario debe volver a pegar `cloudflare/stats-worker.js` en Cloudflare.
- Límites conocidos: solo sincroniza con la app abierta (sin push); dos dispositivos escribiendo en el mismo instante podrían pisarse (KV no es transaccional); los calendarios importados y escudos nuevos se ven al recargar.

## Sonido y subida con .bat (2026-10-22)
- ✅ `src/features/sound` (`cues.ts` sucesos→sonidos, `synth.ts` síntesis determinista) + pista de audio en el MP4 (`exportVideo.ts`, AAC u Opus según soporte) + botón de sonido en la vista previa + opción «Sonido» (por defecto sí). Tests unitarios; `verify:export` comprueba la pista de audio (verificado en el Chromium del sandbox: Opus en MP4, duración igual al vídeo, picos en los goles).
- 🟡 Pendiente de verificar: AAC real en Chrome/Safari de usuario, y cómo suena en el móvil (el volumen/mezcla se ajusta a oído).
- ✅ `subir-a-github.bat` (comprobaciones de seguridad, commit, push, abre el PR). 🟡 No se pudo ejecutar aquí (Linux): pendiente de verificar en Windows.

## Sonido revisado (2026-10-22, a petición del usuario: «no se escucha bien»)
- **Qué estaba mal (medido):** volumen medio −12 / −10 LUFS con picos de +2 dBFS (la pista se pasaba y el códec la recortaba); el rugido del gol era 5× más fuerte que todo lo demás y tapaba golpes y pitidos; los golpes de balón eran graves de 55–165 Hz que el altavoz del móvil no reproduce;
  hasta 46 golpes y 39 rebotes en 26 s, muchos a menos de 0,1 s unos de otros y con la misma fuerza (efecto «ametralladora»).
- ✅ **Rehecho** (`src/features/sound`): golpe de balón en medios con chasquido (240→140 Hz + 520 Hz + 2–3 kHz), rebote en la pared como «tonk» seco (≈ 900 Hz), pitidos de árbitro con trino y aire (inicio 1, descanso 2, final 3), rugido del público con resonancias vocales, campanilla de gol más suave y ambiente más bajo; cada golpe varía un poco de volumen y tono.
  Golpes/rebotes: se quitan los que son casi roces y los pegados a otro más fuerte (`thin`, separación mínima 0,14 s / 0,12 s). Master: filtro de graves, compresor suave 2,2:1, volumen medio fijo y limitador con anticipación (pico ≤ −2 dBFS).
- ✅ **Medido** (ffmpeg `ebur128` y `astats`, sobre la pista y sobre el MP4 exportado con Opus): −15,6 LUFS (Arena) / −14,0 LUFS (Táctico), pico real −1,4/−1,5 dBFS (antes +2,1), sin recortes; pitidos ≈ +9 dB y goles ≈ +5 dB sobre el nivel medio; mediana de golpes ≈ +5 dB. El espectrograma muestra golpes separados y pitidos nítidos a 2,9 kHz.
  Tests nuevos (17 en el módulo): volumen medio, pico, graves, que pitidos/golpes/goles sobresalgan, patrón 1-2-3 de pitidos, separación mínima y `thin`.
- 🟡 **Pendiente de verificar a oído** en tu móvil: yo no puedo escuchar; todo lo anterior son mediciones. Si algo sigue sin gustarte (volumen de los golpes, el rugido del gol, el tono del pitido…) dime qué y lo ajusto: son constantes en `synth.ts`.

### Sonido, segunda revisión (2026-10-22): «el gol suena a estruendo y el pitido tiene que ser mejor»
- **Causa del estruendo:** el rugido del gol era ruido blanco filtrado de 3,2 s (una masa de ruido continuo). Reemplazado por capas que se distinguen: **aplauso** de palmadas sueltas (densidad que sube y baja), **coro de voces «aaah»** (6 voces desafinadas con vibrato y resonancias vocales) y **campanilla** más suave. «Ooh» de lamento en paradas, palos y ocasiones falladas.
  Medido: el nivel sostenido del gol queda ≈ −6 dB **por debajo** del nivel medio de la pista (antes ≈ +5 dB por encima) y el arranque ≈ +3 dB; el espectrograma muestra bandas vocales y granos en vez de un muro de ruido.
- **Pitido rehecho:** silbato de dos cámaras (≈ 2,85 y 3,55 kHz que baten), trino de bolita a 32 Hz, golpe de aire al arrancar y ligero ascenso de tono. Sigue siendo ≈ +10 dB sobre el nivel medio.
- **Calidad general:** reverberación de estadio suave (Schroeder, 35 %) para dar cuerpo y espacio, ambiente más bajo y volumen medio fijado a −15,7 LUFS (Arena) / −14,6 LUFS (Táctico), pico real −1,5 dBFS (sin recortes). Generar la pista tarda ≈ 0,4 s.
- Tests: 19 en el módulo (incluyen «el gol no es un estruendo»: por debajo de los pitidos, cola ≤ 0,9× el nivel medio, y nivel que varía como granos).
- 🟡 Sigue sin poder comprobarse **a oído** (no puedo escuchar): todo son mediciones. Se adjunta una muestra para escucharla sin abrir la app.

### Sonido, tercera revisión (2026-10-22): sólo toques del balón y pitidos
- A petición del usuario («el gol sigue sin oírse bien; elimina el sonido del gol y deja sólo los toques del balón y los pitidos»): **eliminados** el sonido de gol (aplauso, coro de voces y campanilla), el «ooh» de paradas/palos/ocasiones falladas, el «whoosh» de los disparos, el ambiente de grada y la reverberación. Queda lo que ya sonaba bien por separado: toques de balón (`kick`), choques con la pared (`wall`) y pitidos del árbitro (`whistle`).
  Se borró el código de público (`applause`, `voices`, `bell`, `reverb`) y los tipos de cue `goal/save/post/miss/whoosh`.
- Medido (Arena, ventana de 20 ms): pitidos ≈ −13 dBFS, toques de balón ≈ −13 dBFS (mediana) y choques con la pared ≈ −16 dBFS: todo bien equilibrado; −15,4 LUFS (Arena) / −13,9 LUFS (Táctico) con pico real −1,5 dBFS (sin recortes). El espectrograma sólo muestra golpes secos y los pitidos (2,85 y 3,55 kHz) con silencio entre medias.
- Tests: 17 en el módulo (incluye «en un gol no suena nada especial» y que cada toque/pitido supere –24/–16 dBFS).
- 🟡 Sigue sin poder comprobarse a oído desde aquí. Si más adelante quieres de vuelta algún sonido de ambiente o de gol, se puede reañadir como opción (apagada por defecto).

