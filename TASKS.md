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
- ✅ 35 tests del motor (determinismo, coherencia, eventos ordenados, fases contiguas, minutos, continuidad < 36 m/s, robustez).
- ✅ Render Canvas 2D 1080×1920 (`drawFrame`) y vista previa con reproducción, pausa, posición y sucesos clicables.
- ✅ 8 e2e del estudio (misma semilla ⇒ misma simulación, marcador fijado, píxel de la etiqueta ficticia en 7 momentos del vídeo,
  semilla inválida, móvil).
- ✅ Inspección visual de fotogramas reales (intro, juego, córner, descanso con estadísticas, final).
- 🟡 La estética del vídeo (tamaño de jugadores, ritmo) está validada solo a ojo en capturas; pendiente de ver en un móvil real.
- 🟡 Reproducción en tiempo real a 60 fps no medida (solo en Chromium headless del sandbox).
## Fase 4 — Renderizado y exportación MP4 vertical ⬜
## Fase 5 — Lotes, descargas y errores ⬜
## Fase 6 — e2e, optimización, documentación y despliegue (preparado, sin desplegar) ⬜
