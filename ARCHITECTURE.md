# Arquitectura de futbol-sim

> Estado: Fase 1. Las secciones marcadas **(planificado)** describen el diseño objetivo y todavía no están implementadas.

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

## Calendario real (planificado)
- Interfaz `MatchProvider` (`src/data`): `listLeagues()` y `listMatches(leagueId, season)`; la UI solo conoce esta
  interfaz. Añadir football-data.org (clave gratuita) consistirá en implementar el proveedor y registrarlo, sin
  tocar la UI. La clave nunca se versionará; se documentará su configuración y no se activará sin ella.
- Proveedor activo: **openfootball** (`football.json`):
  `https://raw.githubusercontent.com/openfootball/football.json/master/<temporada>/<liga>.json`
  con `es.1`, `en.1`, `de.1`, `it.1`, `fr.1`. Sin clave y con CORS abierto (verificado en Fase 1 para 2026-27).
- **Horarios:** openfootball publica `date` (`YYYY-MM-DD`) y `time` (`HH:mm`) en **hora local de la liga, sin zona
  horaria**. La app no los convierte: los muestra tal cual y lo indica en la interfaz. Hay partidos sin `time`.
- Algunos partidos ya jugados incluyen `score.ft` (resultado real). Se muestra como dato real, distinto del
  marcador de una simulación.
- Fallos de red: reintento con espera creciente y caché (memoria + `localStorage`) para mostrar datos previos.

## Motor de simulación (planificado)
- PRNG determinista `mulberry32(semilla)`. Misma semilla + mismos parámetros ⇒ misma simulación; semillas
  distintas ⇒ simulaciones distintas del mismo partido.
- Fase 1: **guion** de eventos (posesiones, ocasiones, paradas, faltas, goles) coherente con el marcador
  (fijado por el usuario o aleatorio), minutos plausibles y ordenados.
- Fase 2: **animación** de 22 jugadores con formaciones y roles, balón (pases, conducciones, tiros),
  marcador y cronómetro, derivada del guion.

## Render y exportación (planificado)
- Canvas 2D a 1080×1920, campo vertical, marcador, cronómetro, banner de gol y etiqueta «Simulación ficticia».
- Exportación: `VideoEncoder` (WebCodecs, H.264 `avc1`) + `mediabunny` para muxear a MP4, 30 fps, frame a frame
  (no en tiempo real). Si `VideoEncoder.isConfigSupported` falla para H.264 se muestra un error claro
  recomendando Chrome/Edge/Safari recientes; nunca se simula una exportación.
- **Verificación del export:** el Chromium del sandbox no incluye el codificador H.264 (VP9/AV1/VP8 sí). El
  exportador recibe el códec como parámetro (H.264 por defecto en producción). La prueba en sandbox ejecuta el
  mismo pipeline con VP9 en contenedor MP4 y valida con `ffprobe` (1080×1920, fps, duración); además se valida
  el empaquetado H.264 codificando los mismos frames con `ffmpeg`/`libx264`. Ver `TASKS.md` para el estado real.

## Calidad
- TypeScript estricto + `noUncheckedIndexedAccess`; ESLint `strictTypeChecked`; sin `any`, sin `catch {}` vacío.
- `src/engine` no puede importar React (regla `no-restricted-imports`).
- Tokens de diseño únicos en `src/ui/tokens.css`; contraste AA comprobado por tests.
- `npm run ci` = typecheck + lint + tests + build.
