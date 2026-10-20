import { expect, test } from '@playwright/test';

test('la aplicación arranca, está en español y muestra la etiqueta ficticia', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByText('futbol-sim').first()).toBeVisible();
  await expect(page.getByText('Simulación ficticia').first()).toBeVisible();
  expect(errors).toEqual([]);
});
