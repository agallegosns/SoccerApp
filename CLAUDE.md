# futbol-sim — reglas permanentes

Aplicación web en el cliente que muestra un calendario de partidos **reales**, genera simulaciones 2D
**ficticias** de un partido seleccionado y las exporta como MP4 vertical 9:16 (1080×1920) para TikTok.
La publicación en TikTok es manual. Idioma de la interfaz y de la documentación: español.

## Reglas
- **Coste 0 €.** Sin backend, sin cuentas, sin servicios de pago. Todo ocurre en el navegador.
- **No simular funcionalidades.** Calendario, simulación, vídeo y descargas deben funcionar de verdad.
  Si algo no se puede implementar o verificar, se dice y se anota en `TASKS.md`.
- **Datos reales ≠ resultados ficticios.** Los partidos (equipos, fechas, resultados reales) vienen de un
  `MatchProvider`. Las simulaciones son inventadas: cada simulación y cada vídeo llevan la etiqueta visible
  **«Simulación ficticia»**. Nunca se presentan como predicción.
- **TypeScript estricto.** Prohibidos `any`, `@ts-ignore`/`@ts-expect-error` sin justificación y `catch {}`
  vacíos (lo comprueba ESLint). Los errores se tipan, se muestran al usuario o se registran.
- **UI:** iconos SVG con `lucide-react`, nunca emojis como iconos. Todos los tokens de diseño viven en
  `src/ui/tokens.css`. Zonas táctiles ≥ 44 px (`--tap`), contraste WCAG AA (verificado en
  `src/test/contrast.test.ts`), respetar `prefers-reduced-motion`.
- **Dependencias:** versiones exactas en `package.json` (`.npmrc` con `save-exact=true`) y `package-lock.json`
  versionado. Playwright se fija a la versión que coincide con el Chromium del sandbox (`1.56.1`).
- **Nunca declarar algo como funcionando sin probarlo.** Lo no verificado se marca en `TASKS.md` como
  «pendiente de verificar».
- **Documentación viva:** mantener `README.md`, `TASKS.md` y `ARCHITECTURE.md` al día con cada cambio.
- **CI antes de cada commit:** `npm run ci` (typecheck + lint + tests + build) en verde. Un commit por fase,
  con mensaje claro.
- **Git:** comprobar la finalidad de cualquier archivo existente antes de tocarlo. Solo se hace push a la
  rama de la sesión. No publicar ni desplegar sin avisar al usuario.
- **Alcance:** este repositorio es independiente; no tocar ningún otro.

## Arquitectura (resumen; detalle en `ARCHITECTURE.md`)
- Vite + React + TypeScript, Vitest (unitarias), Playwright (e2e, Chromium de `/opt/pw-browsers`;
  **no** ejecutar `playwright install`).
- `src/engine`: motor de simulación puro, determinista por semilla, **sin dependencias de React** (ESLint lo impide).
- `src/data`: proveedores de partidos (`MatchProvider`). La UI no conoce el origen de los datos.
- `src/features/{calendar,simulation,export}`: funcionalidades de la interfaz.
- `src/ui`: componentes y estilos compartidos. `src/app`: composición de la aplicación. `src/test`: utilidades de prueba.

## Comandos
- `npm run dev` · `npm run build` · `npm run preview`
- `npm run ci` → typecheck + lint + test + build (obligatorio antes de commit)
- `npm run test:e2e` → Playwright (construye y sirve `dist`)
