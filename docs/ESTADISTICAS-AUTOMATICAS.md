# Estadísticas automáticas de TikTok e Instagram (cada 30 minutos)

Coste: **0 €**. Hace falta una cuenta gratuita de Cloudflare y una app de desarrollador en cada plataforma.

## Cómo funciona

```
Instagram API ─┐
               ├─►  Worker de Cloudflare (cron cada 30 min, guarda una «instantánea» en KV)  ◄──  la app lee GET /stats
TikTok API ────┘
```

- Las APIs de Instagram y TikTok exigen un inicio de sesión (OAuth) con una clave secreta. Esa clave **no puede estar en la app** (se vería en el navegador), por eso existe el Worker.
- El Worker (`cloudflare/stats-worker.js`, generado desde `cloudflare/stats-worker.ts`) recoge las **20 publicaciones más recientes** de cada plataforma, guarda el resultado y renueva los tokens solo.
- La app lo lee al abrirse, cada 30 minutos mientras está abierta y al volver a la pestaña. **Una medición por día** (la última del día gana), así que el gráfico muestra la evolución diaria.
- Lo que una API no da (guardados y alcance en TikTok) **no se inventa**: se conserva lo que hubiera escrito a mano o queda a 0.

## Qué datos llegan

| | Vistas | Me gusta | Comentarios | Compartidos | Guardados | Alcance |
|---|---|---|---|---|---|---|
| Instagram (Reels y publicaciones) | sí | sí | sí | sí | sí | sí |
| TikTok | sí | sí | sí | sí | no | no |

Instagram puede tardar hasta 48 h en consolidar cifras. Las publicaciones se emparejan por su **enlace**: si ya tenías una escrita a mano con el mismo enlace, se actualiza en vez de duplicarse (un enlace corto `vm.tiktok.com` no coincide con el enlace completo: bórrala y deja la automática).

## 1. Publicar el Worker (Cloudflare, gratis)

1. Crea una cuenta en <https://dash.cloudflare.com> (plan gratuito).
2. **Workers & Pages → Create → Create Worker.** Nómbralo, por ejemplo, `futbol-stats`, y pulsa *Deploy*.
3. **Edit code**: borra lo que haya, pega todo el contenido de `cloudflare/stats-worker.js` y pulsa *Deploy*.
4. **Storage & Databases → KV → Create namespace** (nombre `futbol-stats`).
5. En el Worker: **Settings → Bindings → Add → KV namespace**. Nombre de variable: **`STATS`**; elige el namespace del paso anterior.
6. **Settings → Triggers → Cron Triggers → Add**: `*/30 * * * *`.
7. **Settings → Variables and Secrets → Add** (tipo *Secret* para las claves):

| Nombre | Valor |
|---|---|
| `STATS_KEY` | una clave inventada de **24 caracteres o más** (será la «clave de lectura» de la app) |
| `ALLOWED_ORIGIN` | `https://agallegosns.github.io` (texto normal, no secreto) |

Anota la dirección del Worker (`https://futbol-stats.TU-USUARIO.workers.dev`).

## 2. Instagram

Requisitos: cuenta de Instagram **profesional** (Empresa o Creador). Usa la «API de Instagram con inicio de sesión de Instagram» (permisos `instagram_business_basic` e `instagram_business_manage_insights`).

1. En <https://developers.facebook.com> crea una app (tipo *Empresa*) y añade el producto **Instagram → API setup with Instagram login**.
2. Añade tu cuenta como probador/rol de la app y, en ese mismo panel, genera un **token de acceso** de tu cuenta con los dos permisos anteriores.
3. En el Worker añade el secreto **`IG_TOKEN`** con ese token. El Worker lo **renueva solo cada semana** (los tokens duran 60 días) y guarda el nuevo en KV.

## 3. TikTok

1. En <https://developers.tiktok.com> crea una app y añade los productos **Login Kit** y **Display API** con los permisos `user.info.basic` y `video.list`.
2. En *Redirect URI* pon `https://futbol-stats.TU-USUARIO.workers.dev/tiktok/callback` (tu dirección real, con `/tiktok/callback`).
3. En el Worker añade los secretos **`TIKTOK_CLIENT_KEY`** y **`TIKTOK_CLIENT_SECRET`** (los da TikTok).
4. Abre una sola vez en el navegador: `https://futbol-stats.TU-USUARIO.workers.dev/tiktok/login?key=TU_STATS_KEY`, inicia sesión con tu cuenta de TikTok y acepta. El Worker guarda los tokens y los renueva solo (el de renovación dura 365 días; pasado ese tiempo hay que repetir este paso).
5. Si TikTok tiene la app en modo de pruebas, añade tu cuenta como usuario de prueba. **Publicar la app para otros usuarios exige una revisión de TikTok**; para ver solo tu propia cuenta puede bastar el modo de pruebas.

## 4. Conectar la app

1. En la app: **Estadísticas → Conexión**.
2. Pega la dirección del Worker y la `STATS_KEY` → **Conectar**.
3. El panel muestra cuándo recogió datos el Worker y el estado de cada cuenta («Conectada», «Falta autorizar la cuenta»…).

La primera recogida ocurre en los siguientes 30 minutos; para no esperar, pulsa **Actualizar ahora** tras autorizar o llama a `POST /refresh` con `Authorization: Bearer TU_STATS_KEY` (máximo una vez por minuto).

## Límites del plan gratuito y de seguridad

- Cloudflare gratuito permite 50 peticiones por ejecución: por eso se consultan las 20 publicaciones más recientes de cada plataforma (se puede bajar con la variable `MAX_ITEMS`, máximo 25).
- La `STATS_KEY` solo da **lectura** de tus estadísticas públicas de publicación; se guarda en el navegador. Si crees que se ha filtrado, cámbiala en el Worker y en la app.
- El código del Worker no lleva ninguna clave: todo va como secreto.

## Verificado y pendiente de verificar

- ✅ Probado con respuestas simuladas de las APIs: recogida, paginación, renovación de tokens (también el cambio de `refresh_token` de TikTok), fallos parciales (se conserva lo último bueno), claves, CORS y el flujo `/tiktok/login` → `/tiktok/callback` (`cloudflare/stats-worker.test.ts`, 10 pruebas). La app: validación, fusión sin duplicados, errores en español y conexión/desconexión (`sync.test.ts` + e2e con un Worker simulado).
- 🟡 **No probado contra las APIs reales de Instagram ni de TikTok** (no hay credenciales en este entorno). Los nombres de campos y métricas siguen la documentación oficial consultada en octubre de 2026; los pasos de los paneles de Meta y TikTok pueden haber cambiado de sitio.
- 🟡 No probado el despliegue en Cloudflare ni el cron real.

**Hora de publicación:** el Worker envía también `publishedAtIso` (instante exacto). Si ya lo tenías desplegado, vuelve a pegar `cloudflare/stats-worker.js` en Cloudflare para que la app pueda recomendar una franja horaria con tus datos.
