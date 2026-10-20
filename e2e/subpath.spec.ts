import { expect, test } from '@playwright/test';

import { mockOpenFootball } from './helpers.ts';

/**
 * La app servida bajo una subruta (VITE_BASE=/SoccerApp/, como en GitHub Pages): los recursos propios (JS, CSS, favicon, el Excel de la
 * Champions y el trozo diferido del estudio) deben cargarse desde la subruta, sin errores 404.
 */
test('funciona bajo una subruta: recursos, Excel de la Champions y estudio diferido', async ({ page }) => {
  const failed: string[] = [];
  const errors: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && new URL(r.url()).hostname === '127.0.0.1') failed.push(`${String(r.status())} ${r.url()}`);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await mockOpenFootball(page);
  await page.goto('./');
  await expect(page.locator('.match').first()).toBeVisible();

  // El Excel incluido (public/data) se pide bajo la subruta.
  await page.getByRole('button', { name: 'Champions League 2026-27', exact: true }).click();
  await page.getByRole('button', { name: 'Todos' }).click();
  await expect(page.getByTestId('count')).toContainText('144 partidos');

  // El estudio se carga de forma diferida (otro chunk) desde la subruta.
  await page.locator('.match').first().click();
  const chunk = page.waitForResponse((r) => /SimulationStudio-.*\.js$/.test(r.url()));
  await page.getByTestId('open-studio').click();
  expect((await chunk).url()).toContain('/SoccerApp/assets/');
  await expect(page.getByTestId('preview-canvas')).toBeVisible();

  const favicon = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel=icon]')?.href ?? '';
    const res = await fetch(href);
    return { href, ok: res.ok };
  });
  expect(favicon.href).toContain('/SoccerApp/favicon.svg');
  expect(favicon.ok).toBe(true);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});
