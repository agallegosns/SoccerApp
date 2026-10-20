# futbol-sim

Aplicación web (100 % cliente, coste 0 €) que:

1. muestra un **calendario de partidos reales**,
2. permite elegir un partido,
3. genera **simulaciones 2D ficticias** (campo, jugadores, balón, ocasiones, goles, marcador),
4. exporta cada simulación como **MP4 vertical 9:16 (1080×1920)** listo para TikTok,
5. permite descargar los vídeos (la publicación en TikTok es manual).

> Todas las simulaciones y vídeos llevan la etiqueta visible **«Simulación ficticia»**. No son predicciones.

## Estado
Fase 1 de 6 completada: base del proyecto. Consulta [TASKS.md](TASKS.md) para ver qué funciona (probado) y qué
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

Las reglas del proyecto están en [CLAUDE.md](CLAUDE.md).
