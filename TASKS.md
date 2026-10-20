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

## Hallazgos del entorno (relevantes para fases siguientes)
- openfootball 2026-27 responde 200 con CORS abierto para `es.1`, `en.1`, `de.1`, `it.1`, `fr.1`.
  Algunos partidos ya traen resultado real (`score`) y otros no traen hora (`time`).
- **Champions League:** no existe 2026-27 en openfootball. Solo `europe-champions-league/2025-26/cl.txt`
  (temporada anterior, finalizada, formato Football.TXT, CORS abierto). Decisión pendiente en la Fase 2.
- **El Chromium del sandbox NO codifica H.264** (`VideoEncoder.isConfigSupported` → `false` para todos los
  `avc1.*`); sí codifica VP9 (`vp09.00.40.08`), AV1 y VP8, tanto en headless-shell como en Chromium completo.
  Estrategia de verificación en la Fase 4: ver `ARCHITECTURE.md` → «Verificación del export».
- ESPN, TheSportsDB y football-data.org no son accesibles desde el sandbox: no se dependerá de ellos.

## Fase 2 — Interfaz, calendario real y selección ⬜
## Fase 3 — Motor de simulación 2D y vista previa ⬜
## Fase 4 — Renderizado y exportación MP4 vertical ⬜
## Fase 5 — Lotes, descargas y errores ⬜
## Fase 6 — e2e, optimización, documentación y despliegue (preparado, sin desplegar) ⬜
