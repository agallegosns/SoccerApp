import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { mockOpenFootball } from './helpers.ts';
import { seedPublication, seedStorage, seedVideo } from './seed.ts';

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations.map((v) => `${v.id} (${v.impact ?? '?'}): ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

test.describe('accesibilidad de las secciones nuevas (axe, WCAG AA)', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test.beforeEach(async ({ page }) => {
    await mockOpenFootball(page);
    await seedStorage(page, { videos: [seedVideo(11), seedVideo(12)], stats: [seedPublication] });
  });

  test('menú y lista de vídeos', async ({ page }) => {
    await page.goto('/#/videos');
    await expect(page.getByTestId('videos-list')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test('programado, aviso de publicación, selección y ventana de sincronización', async ({ page }) => {
    await page.goto('/#/videos');
    await page.getByTestId('open-video').first().click();
    await page.getByTestId('schedule-open').click();
    await page.getByTestId('schedule-input').fill('2020-01-01T10:00');
    expect(await violations(page), 'diálogo de programar').toEqual([]);
    await page.getByTestId('schedule-save').click();
    await expect(page.getByTestId('due-item')).toBeVisible();
    expect(await violations(page), 'ficha pendiente de confirmar + aviso').toEqual([]);
    await page.getByRole('link', { name: 'Vídeos', exact: true }).first().click();
    await page.getByTestId('select-mode').click();
    await page.getByTestId('select-all').click();
    expect(await violations(page), 'lista en modo selección con chip').toEqual([]);
    await page.getByTestId('sync-open').click();
    expect(await violations(page), 'ventana de sincronización').toEqual([]);
  });

  test('ficha de vídeo, todas las pestañas', async ({ page }) => {
    await page.goto('/#/videos');
    await page.getByTestId('open-video').first().click();
    for (const tab of ['summary', 'events', 'stats', 'publish']) {
      await page.getByTestId(`vd-tab-${tab}`).click();
      expect(await violations(page), `pestaña ${tab}`).toEqual([]);
    }
  });

  test('estadísticas, todas las pestañas y los formularios', async ({ page }) => {
    await page.goto('/#/estadisticas');
    for (const tab of ['summary', 'list', 'data']) {
      await page.getByTestId(`stats-tab-${tab}`).click();
      expect(await violations(page), `pestaña ${tab}`).toEqual([]);
    }
    await page.getByTestId('add-publication').click();
    await expect(page.getByRole('dialog', { name: 'Añadir publicación' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.getByTestId('stats-tab-list').click();
    await page.getByTestId('new-measurement').click();
    await expect(page.getByRole('dialog', { name: 'Nueva medición' })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test('estadísticas vacías y vídeos vacíos', async ({ page }) => {
    await page.addInitScript(() => { localStorage.clear(); });
    await page.goto('/#/estadisticas');
    await expect(page.getByTestId('stats-empty')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
});
