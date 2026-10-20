# Arquitectura de futbol-sim

> Estado: Fase 3. Las secciones marcadas **(planificado)** describen el diseño objetivo y todavía no están implementadas.

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
- `src/features/simulation/render.ts`: `drawFrame(ctx, sim, t, meta)` dibuja un fotograma 1080×1920 en Canvas 2D (campo vertical,
  marcador, cronómetro, banner de gol, tarjetas de intro/descanso/final y la etiqueta «SIMULACIÓN FICTICIA» arriba y un pie
  «Simulación ficticia · Resultado inventado, no es una predicción»). La misma función sirve para la vista previa y para la
  exportación. El campo se cachea en una capa fuera de pantalla. Los colores del vídeo viven en `theme.ts` (no son tokens de la UI).
- Zonas seguras de TikTok: el contenido clave está entre y≈150 y y≈1700 (la interfaz de TikTok cubre la parte superior y la
  inferior).
- Estudio (`SimulationStudio`): vista previa con reproducir/pausar/posición, semilla, marcador aleatorio o fijado y lista de
  sucesos (al pulsar uno salta a ese momento). Respeta `prefers-reduced-motion` (no reproduce solo).
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
