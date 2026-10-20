# futbol-sim

Aplicación web (100 % cliente, coste 0 €) que:

1. muestra un **calendario de partidos reales**,
2. permite elegir un partido,
3. genera **simulaciones 2D ficticias** (campo, jugadores, balón, ocasiones, goles, marcador),
4. exporta cada simulación como **MP4 vertical 9:16 (1080×1920)** listo para TikTok,
5. permite descargar los vídeos (la publicación en TikTok es manual).

> Todas las simulaciones y vídeos llevan la etiqueta visible **«Simulación ficticia»**. No son predicciones.

## Estado
Fase 3 de 6 completada: base del proyecto, calendario real y motor de simulación 2D con vista previa (estilo «Arena» como los vídeos virales, o estilo táctico con 22 jugadores) (LaLiga, Premier, Bundesliga, Serie A, Ligue 1 2026-27 y Champions League 2025-26) con filtros, buscador y selección de partido. Consulta [TASKS.md](TASKS.md) para ver qué funciona (probado) y qué
está pendiente, y [ARCHITECTURE.md](ARCHITECTURE.md) para el diseño.

## Requisitos
- Node.js ≥ 22 y npm ≥ 10.
- Para exportar vídeo: un navegador con WebCodecs y codificación H.264 (Chrome, Edge o Safari recientes).

## Uso
```bash
npm ci            # instala las dependencias exactas
npm run dev       # servidor de desarrollo
npm run ci        # typecheck + lint + tests + build
npm run test:e2e  # pruebas e2e con Playwright (Chromium)
```

### Competiciones 2026-27
- **LaLiga**: datos de openfootball (sin clave).
- **Champions League**: fase de liga incluida desde el Excel aportado (`public/data/champions-league-2026-27.xlsx`).
- **Europa League y Conference League**: preparadas. Pulsa su pestaña → *Importar calendario* y sube un Excel con las columnas
  `Jornada · Fecha · Hora · Equipo Local · Equipo Visitante` (como el de la Champions), o un JSON/TXT. Se guarda solo en tu navegador.

Las reglas del proyecto están en [CLAUDE.md](CLAUDE.md).
