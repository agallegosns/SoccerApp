# Sincronizar móvil y ordenador

Lo que haces en un dispositivo (fichas de vídeo, «publicado», «programado», descargas, estadísticas, calendarios importados y escudos) aparece en los demás.
Usa **tu Worker de Cloudflare gratuito** (el mismo de las estadísticas: misma dirección y misma clave). No hay cuentas ni servicios nuevos.

Los **vídeos MP4 no viajan**: la ficha guarda los parámetros y cada dispositivo vuelve a generar el mismo vídeo idéntico.

## Puesta en marcha (una sola vez)

1. **Actualiza el Worker.** En Cloudflare → *Workers & Pages* → tu Worker (`futbol-stats`) → *Edit code*, borra todo y pega el contenido de `cloudflare/stats-worker.js` (versión nueva, con `/sync`). Pulsa *Deploy*. No hace falta crear nada más: usa el mismo KV (`STATS`) y los mismos secretos (`STATS_KEY`, `ALLOWED_ORIGIN`).
2. **En cada dispositivo** (móvil y ordenador): abre la app → icono de nube de la cabecera → pega la **dirección del Worker** (`https://futbol-stats….workers.dev`) y la **clave** (`STATS_KEY`) → *Conectar y sincronizar*. Si ya conectaste las estadísticas en ese dispositivo, el botón *Usar la conexión de Estadísticas* rellena los dos campos.
3. Listo. El primer dispositivo sube todo lo que tiene; los demás lo reciben y suben lo suyo.

## Cómo se comporta

- **Cuándo sincroniza:** al abrir la app, cada minuto mientras está a la vista, al volver a ella, al recuperar internet y unos 4 segundos después de cada cambio. **Solo con la app abierta**: no hay un servidor que despierte a un dispositivo cerrado; cuando lo abres, se pone al día.
- **Cada elemento por separado:** si cambias cosas distintas en cada dispositivo, se suman. Si cambias **lo mismo** en los dos, gana el cambio más reciente. Las **mediciones de estadísticas** de una misma publicación se unen en vez de pisarse.
- **Borrar** una ficha, una marca o una publicación en un dispositivo la borra en los demás. Si luego la vuelves a crear, vuelve a aparecer.
- **Reloj mal puesto:** la app compensa la diferencia con la hora del servidor, así que un móvil con la hora desfasada no pisa cambios ajenos.
- **Calendarios importados y escudos:** se copian, pero se ven al recargar la app (el aviso lo indica).
- **No se sincroniza:** los vídeos MP4 ya descargados, las opciones visuales del estudio y la liga elegida en el calendario (son preferencias de cada dispositivo).

## Límites y privacidad

- Los datos viven en **tu** Cloudflare KV y solo se leen con tu clave. Quien tenga la clave puede leerlos y escribirlos: no la compartas.
- Plan gratuito de KV: 1.000 escrituras al día. Solo se escribe cuando hay cambios, así que sobra con diferencia. Cada elemento admite hasta 2 MB y el conjunto 20 MB.
- 🟡 Dos dispositivos que sincronicen en el mismo instante exacto podrían, muy raramente, pisarse un cambio (KV no es transaccional); el cambio se corrige al volver a editar el elemento. Se ha probado con dos navegadores reales y el Worker real con un KV en memoria, **no** con Cloudflare ni con un iPhone.
- **Dejar de sincronizar** en un dispositivo lo desconecta; no borra nada ni en él ni en el servidor.

## Errores frecuentes

| Mensaje | Qué hacer |
|---|---|
| «Tu Worker aún no tiene la sincronización» | Pega la versión nueva de `stats-worker.js` (paso 1). |
| «El Worker rechazó la clave» | Debe ser exactamente el secreto `STATS_KEY` del Worker. |
| «No se pudo conectar con el Worker» | Revisa la dirección (`https://…`) y que `ALLOWED_ORIGIN` sea `https://agallegosns.github.io`. |
