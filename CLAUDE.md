# futbol-sim — reglas permanentes

Aplicación web en el cliente que muestra un calendario de partidos **reales**, genera simulaciones 2D
**ficticias** de un partido seleccionado y las exporta como MP4 vertical 9:16 (1080×1920) para TikTok.
La publicación en TikTok es manual. Idioma de la interfaz y de la documentación: español.

## Reglas
- **Coste 0 €.** Sin backend, sin cuentas, sin servicios de pago. Todo ocurre en el navegador.
- **No simular funcionalidades.** Calendario, simulación, vídeo y descargas deben funcionar de verdad.
  Si algo no se puede implementar o verificar, se dice y se anota en `TASKS.md`.
- **Datos reales ≠ resultados ficticios.** Los partidos (equipos, fechas, resultados reales) vienen de un
  `MatchProvider`. Las simulaciones son inventadas: la **interfaz** lo indica siempre con la etiqueta
  **«Simulación ficticia»** y los metadatos del MP4 y el `LEEME.txt` del ZIP también. **Por decisión expresa del usuario, el vídeo en sí NO lleva ese rótulo**: su cabecera muestra
  la competición, fase y jornada. Nunca se presentan como predicción.
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
- `src/features/{calendar,simulation,export,videos,stats}`: funcionalidades de la interfaz. `src/app/route.ts`: rutas por hash (`#/`, `#/videos`, `#/videos/ID`, `#/estadisticas`).
- `src/ui`: componentes y estilos compartidos. `src/app`: composición de la aplicación. `src/test`: utilidades de prueba.

## Estado
Las seis fases están hechas (ver `TASKS.md` para lo probado y lo pendiente de verificar). Lo no verificado más importante: la **codificación H.264 en un
navegador real** (el Chromium del sandbox no tiene codificador H.264; se verificó con VP9 y el empaquetado H.264 aparte), el uso del calendario real desde un navegador
con red y los importadores de football-data.org / fixturedownload.com con archivos reales.

## Decisiones de la interfaz (a petición del usuario)
- **Nada se desplaza en horizontal**, en ninguna pantalla: las ligas van en rejilla y los grupos de opciones (`.segmented`, `.tabs`) pasan a otra fila en vez de cortarse. Lo vigila `e2e/layout.spec.ts`
  (320–1280 px, cada elemento visible). Los contenedores `display: grid` usan `grid-template-columns: minmax(0, 1fr)` para no ensancharse con su contenido.
- **Menú** Calendario · Vídeos · Estadísticas (`AppNav`, barra inferior en móvil). **La ficha de vídeo guarda parámetros, no el MP4** (`VideoRecord`): el motor es determinista y el archivo se regenera idéntico.
  Si cambias el motor de forma que la misma semilla dé otro resultado, las fichas antiguas avisan (`engine-changed`).
- **Publicar**: descripción y 5 hashtags por plataforma (`src/features/videos/publish.ts`) y hora recomendada sacada de las métricas reales o, si no hay datos, franja orientativa marcada como tal. Nunca se promete viralidad.
- **Estadísticas = datos reales introducidos por el usuario** (manual o CSV), guardados en localStorage. No se simulan ni se inventan. La actualización automática (cada 30 min) usa un **Worker propio de Cloudflare**, opcional y gratuito (decisión expresa del usuario; única excepción a «sin backend»): `cloudflare/stats-worker.ts` → `npm run build:worker` genera el `.js` que se pega en Cloudflare. 🟡 Sin probar contra las APIs reales (ver docs/ESTADISTICAS-AUTOMATICAS.md).
- **Móvil primero**: la app se usa sobre todo en el móvil. Cabecera `sticky` con `env(safe-area-inset-*)`, tarjetas largas plegables (`Collapsible`), diálogos como hoja inferior con cabecera y botones fijos.
- Confirmaciones con `ConfirmDialog` (nunca `window.confirm`).

## Comandos
- `npm run dev` · `npm run build` · `npm run preview`
- `npm run ci` → typecheck + lint + test + build (obligatorio antes de commit; incluye `src/test/rules.test.ts`, que vigila emojis, colores fuera de `tokens.css`, `any` y `catch {}`)
- `npm run test:e2e` → Playwright, proyectos: `chromium-desktop` (incluye accesibilidad con axe), `chromium-subpath` y `chromium-export-vp9` (exportación real, lenta)
- `npm run verify:export` · `npm run bench` → verificación con ffprobe y medición de rendimiento/memoria (necesitan Chromium y ffmpeg)
- El despliegue (`.github/workflows/deploy.yml`) se lanza al fusionar en `claude/blissful-davinci-1xqg19` (decisión del usuario, para no hacerlo a mano) y también a mano; no fusionar ni publicar sin avisar al usuario.
