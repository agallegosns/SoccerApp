import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { mockOpenFootball } from './helpers.ts';
import { seedPublication, seedStorage, seedVideo } from './seed.ts';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

/** Número como lo escribe la app (es-ES: los de cuatro cifras van sin separador de miles). */
const n = (v: number): string => new Intl.NumberFormat('es-ES').format(v);

async function open(page: Page, hash = '', seeded = true): Promise<void> {
  await mockOpenFootball(page);
  if (seeded) await seedStorage(page, { videos: [seedVideo(11), seedVideo(12)] });
  await page.goto(`/${hash}`);
}

test.describe('menú principal', () => {
  test('tres secciones, la actual marcada y el botón «atrás» del navegador funciona', async ({ page }) => {
    await open(page, '', false);
    const nav = page.getByRole('navigation', { name: 'Secciones' });
    await expect(nav.getByRole('link')).toHaveText([/Calendario/, /Vídeos/, /Estadísticas/]);
    await expect(page.getByTestId('nav-calendar')).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('nav-videos').click();
    await expect(page.getByTestId('videos-empty')).toBeVisible();
    await expect(page.getByTestId('nav-videos')).toHaveAttribute('aria-current', 'page');
    await page.getByTestId('nav-stats').click();
    await expect(page.getByTestId('stats-empty')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('videos-empty')).toBeVisible();
    await page.getByTestId('nav-calendar').click();
    await expect(page.getByRole('heading', { name: 'Calendario de partidos' })).toBeVisible();
  });

  test('abrir una URL con la sección en el hash carga esa sección', async ({ page }) => {
    await open(page, '#/estadisticas', false);
    await expect(page.getByTestId('stats-view')).toBeVisible();
  });

  test('el estudio se cierra al cambiar de sección', async ({ page }) => {
    await open(page, '', false);
    await page.locator('.match').first().click();
    await page.getByTestId('open-studio').click();
    await expect(page.getByTestId('preview-canvas')).toBeVisible();
    await page.getByTestId('nav-videos').click();
    await expect(page.getByTestId('videos-empty')).toBeVisible();
    await page.getByTestId('nav-calendar').click();
    await expect(page.getByRole('heading', { name: 'Calendario de partidos' })).toBeVisible();
  });
});

test.describe('biblioteca de vídeos y ficha', () => {
  test('lista, búsqueda y filtros', async ({ page }) => {
    await open(page, '#/videos');
    await expect(page.getByTestId('video-card')).toHaveCount(2);
    await expect(page.getByTestId('videos-count')).toHaveText('2 vídeos');
    await page.getByTestId('videos-search').fill('11');
    await expect(page.getByTestId('video-card')).toHaveCount(1);
    await expect(page.getByTestId('videos-count')).toHaveText('1 de 2 vídeos');
    await page.getByTestId('videos-search').fill('zzz');
    await expect(page.getByTestId('videos-none')).toBeVisible();
    await page.getByTestId('videos-search').fill('');
    await page.getByTestId('videos-downloaded').selectOption('yes');
    await expect(page.getByTestId('videos-none')).toBeVisible();
  });

  test('la ficha muestra el resumen, las jugadas saltan en el reproductor y hay navegación entre vídeos del partido', async ({ page }) => {
    await open(page, '#/videos');
    await page.getByTestId('open-video').first().click();
    const detail = page.getByTestId('video-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('heading', { level: 1 })).toContainText('Athletic Club');
    await expect(detail.getByText('Simulación ficticia').first()).toBeVisible();
    await expect(detail.getByText('Semilla', { exact: true })).toBeVisible();
    await expect(page.getByTestId('video-prev')).toBeDisabled();
    await expect(page.getByTestId('video-next')).toBeEnabled();

    await page.getByTestId('vd-tab-events').click();
    const first = page.getByTestId('vd-events').getByRole('button').first();
    await expect(first).toBeVisible();
    const before = await page.getByTestId('scrubber').inputValue();
    await page.getByTestId('vd-events').getByRole('button').nth(3).click();
    await expect.poll(() => page.getByTestId('scrubber').inputValue()).not.toBe(before);

    await page.getByTestId('video-next').click();
    await expect(page.getByTestId('video-prev')).toBeEnabled();
    await expect(page.getByTestId('video-next')).toBeDisabled();
  });

  test('marcar un vídeo como publicado a mano: se ve en la ficha y en la lista, se filtra y se recuerda al recargar', async ({ page }) => {
    await open(page, '#/videos');
    await expect(page.getByTestId('video-card')).toHaveCount(2);
    await page.getByTestId('open-video').first().click();
    await expect(page.getByTestId('toggle-published')).toContainText('Marcar como publicado');
    await page.getByTestId('toggle-published').click();
    await expect(page.getByTestId('published-date')).toBeVisible();
    await expect(page.getByTestId('toggle-published')).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByTestId('published-date')).toBeVisible();
    await page.getByRole('link', { name: 'Vídeos', exact: true }).first().click();
    await expect(page.getByTestId('chip-published')).toHaveCount(1);
    await page.getByTestId('videos-published').selectOption('yes');
    await expect(page.getByTestId('video-card')).toHaveCount(1);
    await page.getByTestId('videos-published').selectOption('no');
    await expect(page.getByTestId('video-card')).toHaveCount(1);
    await expect(page.getByTestId('chip-published')).toHaveCount(0);
    await page.getByTestId('videos-published').selectOption('yes');
    await page.getByTestId('open-video').click();
    await page.getByTestId('toggle-published').click();
    await expect(page.getByTestId('published-date')).toHaveCount(0);
  });

  test('programar un vídeo: se ve «Programado» en la ficha y la lista; al llegar la hora pregunta y al confirmar pasa a «Publicado»', async ({ page }) => {
    await open(page, '#/videos');
    await page.getByTestId('open-video').first().click();
    await page.getByTestId('schedule-open').click();
    // Hora futura: queda «Programado», no «Pendiente de confirmar».
    await page.getByTestId('schedule-input').fill('2099-10-21T19:00');
    await page.getByTestId('schedule-save').click();
    await expect(page.getByTestId('scheduled-chip')).toContainText('Programado');
    await expect(page.getByTestId('scheduled-chip')).toContainText('19:00');
    await expect(page.getByTestId('due-prompt')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('scheduled-chip')).toContainText('19:00');
    await page.getByRole('link', { name: 'Vídeos', exact: true }).first().click();
    await expect(page.getByTestId('chip-scheduled')).toHaveCount(1);
    await page.getByTestId('videos-published').selectOption('scheduled');
    await expect(page.getByTestId('video-card')).toHaveCount(1);
    await page.getByTestId('videos-published').selectOption('all');

    // Se cambia la hora a una ya pasada: aparece el aviso y la ficha pide confirmar.
    await page.getByTestId('open-video').first().click();
    await page.getByTestId('schedule-open').click();
    await page.getByTestId('schedule-input').fill('2020-01-01T10:00');
    await page.getByTestId('schedule-save').click();
    await expect(page.getByTestId('scheduled-chip')).toContainText('Pendiente de confirmar');
    await expect(page.getByTestId('due-item')).toHaveCount(1);
    await expect(page.getByTestId('due-item')).toContainText('¿Se ha publicado');
    // «Todavía no» lo oculta un rato.
    await page.getByTestId('due-later').click();
    await expect(page.getByTestId('due-item')).toHaveCount(0);
    await page.reload();
    await page.getByTestId('due-yes').click();
    await expect(page.getByTestId('due-item')).toHaveCount(0);
    await expect(page.getByTestId('published-date')).toBeVisible();
    await expect(page.getByTestId('scheduled-chip')).toHaveCount(0);
  });

  test('eliminar desde la lista de vídeos: uno a uno y varios seleccionados, con confirmación', async ({ page }) => {
    await open(page, '#/videos');
    await expect(page.getByTestId('video-card')).toHaveCount(2);
    // Cancelar no borra nada.
    await page.getByTestId('delete-video').first().click();
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('video-card')).toHaveCount(2);
    // Eliminar uno.
    await page.getByTestId('delete-video').first().click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('video-card')).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId('video-card')).toHaveCount(1);
    // Selección múltiple sobre el que queda.
    await page.getByTestId('select-mode').click();
    await expect(page.getByTestId('delete-selected')).toBeDisabled();
    await page.getByTestId('select-all').click();
    await expect(page.getByTestId('delete-selected')).toContainText('(1)');
    await page.getByTestId('delete-selected').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('videos-empty')).toBeVisible();
  });

  test('«Publicar» da una descripción copiable con la etiqueta ficticia', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, '#/videos');
    await page.getByTestId('open-video').first().click();
    await page.getByTestId('vd-tab-publish').click();
    const caption = page.getByTestId('caption');
    await expect(caption).toHaveValue(/ vs /);
    await expect(caption).toHaveValue(/#AthleticClub/);
    await expect(caption).not.toHaveValue(/ficticia|predicción/);
    await expect(page.getByTestId('time-reco')).toContainText('Hora recomendada');
    await page.getByTestId('next-variant').click();
    await page.getByTestId('copy-caption').click();
    await expect(page.getByText('Descripción copiada.')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Athletic Club vs Valencia CF');
  });

  test('añadir una publicación desde la ficha la deja enlazada y visible en «Rendimiento» y en Estadísticas', async ({ page }) => {
    await open(page, '#/videos');
    await page.getByTestId('open-video').first().click();
    await page.getByTestId('vd-tab-stats').click();
    await page.getByTestId('detail-add-publication').click();
    await expect(page.getByTestId('pub-title')).toHaveValue(/Athletic Club vs Valencia CF/);
    await page.getByTestId('pub-url').fill('https://www.tiktok.com/@ejemplo/video/999');
    await page.getByTestId('counter-views').fill('4200');
    await page.getByTestId('counter-likes').fill('300');
    await page.getByTestId('pub-save').click();
    await expect(page.getByTestId('publication-dialog')).toBeHidden();
    await expect(page.getByTestId('vd-performance')).toContainText(n(4200));
    await page.getByTestId('nav-stats').click();
    await expect(page.getByTestId('stats-tiles')).toContainText(n(4200));
    // La lista de vídeos muestra la plataforma.
    await page.getByTestId('nav-videos').click();
    await expect(page.getByTestId('videos-list')).toContainText('TikTok');
  });

  test('eliminar una ficha pide confirmación y la quita de la lista', async ({ page }) => {
    await open(page, '#/videos');
    await page.getByTestId('open-video').first().click();
    await page.getByTestId('detail-delete').click();
    await page.getByTestId('confirm-cancel').click();
    await expect(page.getByTestId('video-detail')).toBeVisible();
    await page.getByTestId('detail-delete').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('video-card')).toHaveCount(1);
  });

  test('una ficha que no existe lo explica y permite volver', async ({ page }) => {
    await open(page, '#/videos/no-existe');
    await expect(page.getByTestId('video-missing')).toBeVisible();
    await page.getByRole('link', { name: 'Volver a Vídeos' }).click();
    await expect(page.getByTestId('videos-view')).toBeVisible();
  });

  test('«Abrir en el estudio» recupera la semilla y vuelve a la ficha', async ({ page }) => {
    await open(page, '#/videos');
    await page.getByTestId('open-video').first().click();
    await page.getByTestId('detail-studio').click();
    await expect(page.getByTestId('preview-canvas')).toBeVisible();
    const seeds = await page.getByTestId('seed-input').inputValue();
    expect(['11', '12']).toContain(seeds);
    await page.getByRole('button', { name: 'Volver a la ficha del vídeo' }).click();
    await expect(page.getByTestId('video-detail')).toBeVisible();
  });
});

test.describe('estadísticas', () => {
  test('alta de publicación, nueva medición, evolución y borrado', async ({ page }) => {
    await open(page, '#/estadisticas', false);
    await expect(page.getByTestId('stats-empty')).toBeVisible();
    await page.getByTestId('add-publication').click();
    await page.getByTestId('pub-title').fill('Prueba de alta');
    await page.getByTestId('pub-date').fill('2026-10-10');
    await page.getByTestId('measure-date').fill('2026-10-11');
    await page.getByTestId('counter-views').fill('1000');
    await page.getByTestId('counter-likes').fill('100');
    await page.getByTestId('pub-save').click();
    await expect(page.getByTestId('stats-tiles')).toContainText(n(1000));
    await expect(page.getByTestId('stats-tiles')).toContainText('10,0 %');
    await expect(page.getByText('Hacen falta mediciones de al menos dos fechas')).toBeVisible();

    await page.getByTestId('stats-tab-list').click();
    await page.getByTestId('new-measurement').click();
    await page.getByTestId('measure-date').fill('2026-10-15');
    await page.getByTestId('counter-views').fill('3000');
    await page.getByTestId('measure-save').click();
    await expect(page.getByTestId('publication')).toContainText(n(3000));

    await page.getByTestId('stats-tab-summary').click();
    await expect(page.getByRole('img', { name: /Evolución de las vistas totales/ })).toBeVisible();

    await page.getByTestId('stats-tab-list').click();
    await page.getByTestId('delete-publication').click();
    await page.getByTestId('confirm-ok').click();
    await page.getByTestId('stats-tab-summary').click();
    await expect(page.getByTestId('stats-empty')).toBeVisible();
  });

  test('valida el formulario: título, enlace de otra plataforma, fecha de la medición y números', async ({ page }) => {
    await open(page, '#/estadisticas', false);
    await page.getByTestId('add-publication').click();
    await page.getByTestId('pub-save').click();
    await expect(page.getByTestId('pub-error')).toContainText('título');
    await page.getByTestId('pub-title').fill('X');
    await page.getByTestId('pub-url').fill('https://www.instagram.com/reel/abc/');
    await page.getByTestId('pub-save').click();
    await expect(page.getByTestId('pub-error')).toContainText('no parece de TikTok');
    await page.getByTestId('pub-url').fill('');
    await page.getByTestId('pub-save').click();
    await expect(page.getByTestId('pub-error')).toContainText('Vistas');
    await page.getByTestId('counter-views').fill('-4');
    await page.getByTestId('pub-save').click();
    await expect(page.getByTestId('pub-error')).toContainText('número entero');
    await page.getByTestId('pub-date').fill('2026-10-12');
    await page.getByTestId('measure-date').fill('2026-10-11');
    await page.getByTestId('counter-views').fill('5');
    await page.getByTestId('pub-save').click();
    await expect(page.getByTestId('pub-error')).toContainText('anterior');
  });

  test('importa un CSV (con errores informados), no duplica al repetirlo y lo exporta', async ({ page }) => {
    await open(page, '#/estadisticas', false);
    await page.getByTestId('stats-tab-data').click();
    const csv = [
      'plataforma;url;titulo;publicado;fecha_medicion;vistas;likes',
      'tiktok;https://www.tiktok.com/@ejemplo/video/1;Uno;10/10/2026;11/10/2026;"1.200";80',
      'tiktok;https://www.tiktok.com/@ejemplo/video/1;Uno;10/10/2026;14/10/2026;5400;300',
      'youtube;;Mal;2026-10-10;2026-10-11;5;1',
    ].join('\n');
    const file = { name: 'stats.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) };
    await page.getByTestId('stats-file').setInputFiles(file);
    const report = page.getByTestId('stats-report');
    await expect(report).toContainText('2 filas importadas');
    await expect(report).toContainText('Línea 4');
    await expect(report).toContainText('tiktok');
    await page.getByTestId('stats-file').setInputFiles(file);
    await page.getByTestId('stats-tab-list').click();
    await expect(page.getByTestId('publication')).toHaveCount(1);
    await expect(page.getByTestId('publication')).toContainText(n(5400));
    await page.getByTestId('stats-tab-data').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('stats-export').click()]);
    expect(download.suggestedFilename()).toBe('estadisticas-futbol-sim.csv');
    const path = await download.path();
    const text = readFileSync(path, 'utf8');
    expect(text.split('\n')[0]).toContain('plataforma,url,titulo');
    expect(text).toContain('2026-10-14');
  });

  test('los datos sobreviven a recargar y el filtro por plataforma funciona', async ({ page }) => {
    await mockOpenFootball(page);
    await seedStorage(page, { stats: [seedPublication, { ...seedPublication, platform: 'instagram', url: 'https://www.instagram.com/reel/abc/', title: 'Reel', measurements: [{ date: '2026-10-12', views: 100, likes: 5, comments: 0, shares: 0, saves: 0, reach: null }] }] });
    await page.goto('/#/estadisticas');
    await expect(page.getByTestId('stats-tiles')).toContainText(n(5500));
    await page.getByTestId('platform-instagram').click();
    await expect(page.getByTestId('stats-tiles')).toContainText('100');
    await expect(page.getByTestId('stats-tiles')).not.toContainText(n(5500));
    await page.reload();
    await page.getByTestId('platform-tiktok').click();
    await expect(page.getByTestId('stats-tiles')).toContainText(n(5400));
  });

  test('sin conexión configurada avisa de que los números son manuales y ofrece activarla', async ({ page }) => {
    await open(page, '#/estadisticas', false);
    await expect(page.getByTestId('sync-strip')).toContainText('manuales');
    await page.getByTestId('sync-setup').click();
    await expect(page.getByTestId('stats-connection')).toContainText('Actualización automática');
    await expect(page.getByTestId('sync-status')).toHaveCount(0);
  });

  test.describe('actualización automática con el Worker', () => {
    const WORKER = 'https://stats.example.workers.dev';
    const KEY = 'clave-de-lectura-de-prueba-1234567890';
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
    const snapshot = {
      version: 1,
      updatedAt: new Date().toISOString(),
      sources: { instagram: { state: 'ok', message: null }, tiktok: { state: 'sin-autorizar', message: 'TikTok aún no está autorizado' } },
      items: [
        { platform: 'instagram', url: 'https://www.instagram.com/reel/ZZZ/', title: 'Reel desde la API', publishedAt: '2026-10-19', views: 4321, likes: 200, comments: 12, shares: 30, saves: 55, reach: 3000 },
      ],
    };

    async function mockWorker(page: Page, status = 200): Promise<{ auth: string[] }> {
      const seen: { auth: string[] } = { auth: [] };
      await page.route(`${WORKER}/**`, async (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        seen.auth.push(route.request().headers()['authorization'] ?? '');
        return route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(status === 200 ? snapshot : { error: 'x' }) });
      });
      return seen;
    }

    test('conecta, trae las publicaciones reales, muestra el estado de cada cuenta y se puede desconectar', async ({ page }) => {
      const seen = await mockWorker(page);
      await open(page, '#/estadisticas', false);
      await page.getByTestId('sync-setup').click();
      await page.getByTestId('sync-url').fill(WORKER);
      await page.getByTestId('sync-key').fill(KEY);
      await page.getByTestId('sync-save').click();
      await expect(page.getByTestId('sync-status')).toContainText('Instagram: Conectada');
      await expect(page.getByTestId('sync-status')).toContainText('TikTok: Falta autorizar la cuenta');
      expect(seen.auth[0]).toBe(`Bearer ${KEY}`);
      await page.getByTestId('stats-tab-summary').click();
      await expect(page.getByTestId('stats-tiles')).toContainText(n(4321));
      await expect(page.getByTestId('sync-strip')).toContainText('Actualización automática activa');
      // Sobrevive a una recarga: la app vuelve a leer sola al abrirse.
      await page.reload();
      await expect(page.getByTestId('sync-strip')).toContainText('Actualización automática activa');
      await page.getByTestId('stats-tab-data').click();
      await page.getByTestId('sync-disconnect').click();
      await expect(page.getByTestId('sync-strip')).toContainText('manuales');
    });

    test('si el Worker rechaza la clave lo explica y no toca los datos', async ({ page }) => {
      await mockWorker(page, 401);
      await open(page, '#/estadisticas', false);
      await page.getByTestId('sync-setup').click();
      await page.getByTestId('sync-url').fill(WORKER);
      await page.getByTestId('sync-key').fill(KEY);
      await page.getByTestId('sync-save').click();
      await expect(page.getByTestId('sync-error')).toContainText('rechazó la clave');
      await expect(page.getByTestId('sync-strip')).toContainText('No se pudo actualizar');
    });

    test('valida la dirección y la clave antes de guardar nada', async ({ page }) => {
      await open(page, '#/estadisticas', false);
      await page.getByTestId('sync-setup').click();
      await page.getByTestId('sync-url').fill('http://inseguro.example.com');
      await page.getByTestId('sync-key').fill(KEY);
      await page.getByTestId('sync-save').click();
      await expect(page.getByTestId('sync-form-error')).toContainText('https://');
      await page.getByTestId('sync-url').fill(WORKER);
      await page.getByTestId('sync-key').fill('corta');
      await page.getByTestId('sync-save').click();
      await expect(page.getByTestId('sync-form-error')).toContainText('24 caracteres');
    });
  });
});

test('en este navegador (sin H.264) la ficha avisa y no finge la descarga', async ({ page }) => {
  await open(page, '#/videos');
  await page.getByTestId('open-video').first().click();
  await expect(page.getByTestId('detail-download')).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText(/navegador|códec|H\.264/i);
});
