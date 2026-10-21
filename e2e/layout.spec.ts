import { expect, test, type Page } from '@playwright/test';

import { mockOpenFootball } from './helpers.ts';
import { seedPublication, seedStorage, seedVideo } from './seed.ts';

const WIDTHS = [320, 360, 390, 768, 1280];

/** Nada puede sobresalir de la pantalla: ni la página ni ningún elemento visible. */
async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const result = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const page = document.documentElement.scrollWidth - vw;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((el) => {
        if (el.closest('.visually-hidden') !== null) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.right > vw + 1 || r.left < -1);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className} [${String(Math.round(el.getBoundingClientRect().left))}..${String(Math.round(el.getBoundingClientRect().right))}] vw=${String(vw)}`);
    return { page, offenders };
  });
  expect(result.page, `${label}: la página se desplaza en horizontal`).toBeLessThanOrEqual(0);
  expect(result.offenders, `${label}: elementos que sobresalen`).toEqual([]);
}

test.describe('sin desplazamiento lateral en ninguna pantalla', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  for (const width of WIDTHS) {
    test(`ancho ${String(width)} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await mockOpenFootball(page);
      await seedStorage(page, { videos: [seedVideo(11), seedVideo(12)], stats: [seedPublication] });

      await page.goto('/');
      await expect(page.locator('.match').first()).toBeVisible();
      await expectNoHorizontalOverflow(page, 'calendario');
      // Todas las ligas están a la vista (no hay tira que desplazar).
      for (const card of await page.locator('.leagues .league').all()) {
        const box = await card.boundingBox();
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
      }

      await page.locator('.match').first().click();
      await page.getByTestId('open-studio').click();
      await expect(page.getByTestId('preview-canvas')).toBeVisible();
      await expectNoHorizontalOverflow(page, 'estudio');
      // Los cuatro niveles de rebotes se ven enteros y se pueden pulsar.
      for (const level of ['off', 'low', 'normal', 'high']) {
        const button = page.getByTestId(`bounce-${level}`);
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox();
        expect(box?.x ?? -1, `rebotes ${level}`).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0), `rebotes ${level}`).toBeLessThanOrEqual(width + 1);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(43);
      }

      await page.getByTestId('nav-videos').click();
      await expect(page.getByTestId('videos-list')).toBeVisible();
      await expectNoHorizontalOverflow(page, 'lista de vídeos');

      await page.getByTestId('open-video').first().click();
      await expect(page.getByTestId('video-detail')).toBeVisible();
      for (const tab of ['summary', 'events', 'stats', 'publish']) {
        await page.getByTestId(`vd-tab-${tab}`).click();
        await expectNoHorizontalOverflow(page, `ficha · ${tab}`);
      }

      await page.getByTestId('nav-stats').click();
      await expect(page.getByTestId('stats-view')).toBeVisible();
      for (const tab of ['summary', 'list', 'data']) {
        await page.getByTestId(`stats-tab-${tab}`).click();
        await expectNoHorizontalOverflow(page, `estadísticas · ${tab}`);
      }
      await page.getByTestId('add-publication').click();
      await expect(page.getByRole('dialog', { name: 'Añadir publicación' })).toBeVisible();
      await expectNoHorizontalOverflow(page, 'diálogo de publicación');
    });
  }
});
