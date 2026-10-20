# Despliegue en GitHub Pages (preparado, sin desplegar)

La aplicación es 100 % estática (sin backend): `npm run build` genera `dist/` y basta con servirlo desde cualquier hosting estático.

> **Estado:** desplegado una vez (ejecución manual del workflow, ver `TASKS.md`); URL esperada <https://agallegosns.github.io/SoccerApp/>. El workflow `.github/workflows/deploy.yml` sólo se ejecuta a mano (`workflow_dispatch`). Hasta que lo lances
> tú desde la pestaña *Actions*, no se publica nada.

## Subruta (`base`)
GitHub Pages sirve el proyecto en `https://<usuario>.github.io/<repositorio>/`, así que los recursos deben pedirse bajo esa subruta.
Vite lo resuelve con la variable de entorno `VITE_BASE` (por defecto `/`):

```bash
VITE_BASE=/SoccerApp/ npm run build      # dist/ listo para servir bajo /SoccerApp/
VITE_BASE=/SoccerApp/ npx vite preview   # comprobarlo en local
```

Se usa en: el JS/CSS y el favicon (los reescribe Vite), el trozo diferido del estudio y el Excel de la Champions
(`public/data/…`, se pide con `import.meta.env.BASE_URL`). Lo verifica la prueba e2e `e2e/subpath.spec.ts` (proyecto Playwright
`chromium-subpath`), que compila con `/SoccerApp/` y comprueba que no hay 404 ni errores de consola.

## Pasos para publicarlo cuando quieras
1. En el repositorio de GitHub: **Settings → Pages → Build and deployment → Source = GitHub Actions**.
2. Pestaña **Actions → «Deploy a GitHub Pages» → Run workflow** (rama que quieras publicar).
3. El workflow ejecuta `npm ci` y `npm run ci` (con `VITE_BASE=/<nombre-del-repositorio>/`), sube `dist/` y lo publica. La URL aparece en el resumen.

## Requisitos del navegador del usuario
- Calendario, simulación y vista previa: cualquier navegador moderno.
- **Exportar vídeo:** WebCodecs con codificación H.264 (Chrome, Edge o Safari recientes). Si no hay soporte, la propia app lo explica y desactiva
  los botones de exportar. Es una función del navegador del usuario: no depende del hosting.
- Todo ocurre en el navegador; no se sube ningún dato a ningún servidor (los calendarios importados y la caché se guardan en `localStorage`).

## Dominio propio / otros hostings
Para un dominio raíz (Netlify, Cloudflare Pages, un dominio propio en Pages…) compila sin `VITE_BASE` (se usa `/`).
