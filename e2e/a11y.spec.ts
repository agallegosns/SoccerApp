import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { mockOpenFootball } from './helpers.ts';

/** Reglas WCAG 2.x A y AA (incluye contraste de color). */
async function violations(page: Page, include?: string): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (include !== undefined) builder = builder.include(include);
  const results = await builder.analyze();
  return results.violations.map((v) => `${v.id} (${v.impact ?? '?'}): ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

test.describe('accesibilidad (axe, WCAG AA)', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('calendario', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await expect(page.locator('.match').first()).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test('calendario con un partido seleccionado', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await page.locator('.match').first().click();
    await expect(page.getByTestId('selected-match')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test('diálogo de importación', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Importar calendario' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('.help summary').click();
    expect(await violations(page)).toEqual([]);
  });

  test('estudio de simulación (estilo Arena y Táctico)', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await page.locator('.match').first().click();
    await page.getByTestId('open-studio').click();
    await expect(page.getByTestId('preview-canvas')).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.getByTestId('style-tactical').click();
    expect(await violations(page)).toEqual([]);
  });

  test('estudio con marcador fijado', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await page.locator('.match').first().click();
    await page.getByTestId('open-studio').click();
    await page.getByTestId('style-tactical').click();
    await page.getByTestId('fix-score').click();
    expect(await violations(page)).toEqual([]);
  });

  test('móvil: calendario y estudio', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await mockOpenFootball(page);
    await page.goto('/');
    await expect(page.locator('.match').first()).toBeVisible();
    expect(await violations(page)).toEqual([]);
    await page.locator('.match').first().click();
    await page.getByTestId('open-studio').click();
    await expect(page.getByTestId('preview-canvas')).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
});
