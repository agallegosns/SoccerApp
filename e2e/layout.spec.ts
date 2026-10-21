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
      // En el móvil la lista de competiciones está plegada: se despliega y todas caben sin desplazar.
      const toggle = page.locator('.league-current');
      if (await toggle.isVisible()) {
        await toggle.click();
        await expectNoHorizontalOverflow(page, 'calendario con competiciones desplegadas');
      }
      for (const card of await page.locator('.leagues .league').all()) {
        const box = await card.boundingBox();
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
      }

      await page.locator('.match').first().click();
      await page.getByTestId('open-studio').click();
      await expect(page.getByTestId('preview-canvas')).toBeVisible();
      await expectNoHorizontalOverflow(page, 'estudio');
      // En el móvil las secciones del estudio vienen plegadas: se abren todas para comprobar también su contenido.
      const closed = page.locator('.collapsible__toggle[aria-expanded="false"]');
      while ((await closed.count()) > 0) await closed.first().click();
      await expectNoHorizontalOverflow(page, 'estudio con todas las secciones abiertas');
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

test.describe('diseño móvil', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('el diálogo de publicación deja siempre a la vista el título y los botones (360×640)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await mockOpenFootball(page);
    await page.goto('/#/estadisticas');
    await page.getByRole('button', { name: /Añadir publicación/ }).first().click();
    const dialog = page.locator('dialog[open][data-testid="publication-dialog"]');
    await expect(dialog).toBeVisible();
    for (const target of [dialog.getByRole('heading', { name: 'Añadir publicación' }), dialog.getByTestId('pub-save')]) {
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.y ?? -1)).toBeGreaterThanOrEqual(0);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(640);
    }
    // El formulario se desplaza dentro del diálogo: el último contador es alcanzable.
    await dialog.getByTestId('counter-reach').scrollIntoViewIfNeeded();
    await expect(dialog.getByTestId('counter-reach')).toBeVisible();
  });

  test('las pestañas caben en una sola fila y la cabecera se queda fija', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockOpenFootball(page);
    await seedStorage(page, { stats: [seedPublication] });
    await page.goto('/#/estadisticas');
    const tabs = page.locator('.tabs [role="tab"]');
    await expect(tabs.first()).toBeVisible();
    const ys = await tabs.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(ys).size).toBe(1);
    await page.evaluate(() => { window.scrollTo(0, 400); });
    const top = await page.locator('.app__header').evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBe(0);
  });

  test('en el móvil el estudio muestra abiertos sólo parámetros y exportación; el resto se despliega al pulsar', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await mockOpenFootball(page);
    await page.goto('/');
    await page.locator('.match').first().click();
    await page.getByTestId('open-studio').click();
    await expect(page.getByTestId('preview-canvas')).toBeVisible();
    const options = page.getByTestId('options-panel');
    await expect(options.locator('.collapsible__toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('theme-neon')).toBeHidden();
    await expect(page.getByRole('button', { name: /Exportar MP4/ })).toBeAttached();
    await options.locator('.collapsible__toggle').click();
    await expect(page.getByTestId('theme-neon')).toBeVisible();
  });
});
