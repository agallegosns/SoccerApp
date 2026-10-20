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
- ✅ 53 tests unitarios + 12 e2e (Playwright, Chromium) en verde: carga, filtros, selección, error + reintento, copia en caché
  sin red, importación, archivo inválido, móvil.
- 🟡 **Champions League 2026-27: NO disponible en ninguna fuente libre accesible** (openfootball solo llega a 2025-26;
  Wikipedia, football-data.org, ESPN, TheSportsDB y fixturedownload.com están bloqueadas desde el sandbox). Se ha resuelto con
  «Importar calendario»: el usuario aporta el archivo (instrucciones en la propia ventana). **Pendiente del usuario**: conseguir el archivo.
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

## Fase 3 — Motor de simulación 2D y vista previa ⬜
## Fase 4 — Renderizado y exportación MP4 vertical ⬜
## Fase 5 — Lotes, descargas y errores ⬜
## Fase 6 — e2e, optimización, documentación y despliegue (preparado, sin desplegar) ⬜
