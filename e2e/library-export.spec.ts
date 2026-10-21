import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { mockOpenFootball } from './helpers.ts';

/**
 * Flujo completo con exportación REAL (compilación VP9): exportar en el estudio crea la ficha en «Vídeos», y desde la ficha se
 * vuelve a generar y descargar un MP4 válido (ffprobe).
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });

test('exportar crea la ficha; la ficha vuelve a generar el mismo vídeo y lo descarga', async ({ page }) => {
  await mockOpenFootball(page);
  await page.goto('/');
  await page.locator('.match').first().click();
  await page.getByTestId('open-studio').click();
  await page.getByTestId('seed-input').fill('2024');
  const score = ((await page.getByTestId('sim-score').innerText()).match(/\d+–\d+/) ?? [''])[0];
  expect(score).toMatch(/^\d+–\d+$/);
  const expectedSeconds = Number(await page.getByTestId('scrubber').getAttribute('max'));

  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 300_000 });

  // El menú cuenta el vídeo y la lista lo muestra.
  await expect(page.getByTestId('nav-videos')).toContainText('1');
  await page.getByTestId('nav-videos').click();
  await expect(page.getByTestId('video-card')).toHaveCount(1);
  await expect(page.getByTestId('video-card')).toContainText(score);
  await expect(page.getByTestId('video-card')).toContainText('semilla 2024');
  await page.getByTestId('open-video').click();
  await expect(page.getByTestId('video-detail')).toContainText('salió de la física');

  // Re-descarga desde la ficha.
  await expect(page.getByTestId('detail-download')).toBeEnabled();
  const downloadPromise = page.waitForEvent('download', { timeout: 300_000 });
  await page.getByTestId('detail-download').click();
  await expect(page.getByTestId('detail-progress')).toBeVisible();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/_vs_.*_2024\.mp4$/);
  const dir = join(process.cwd(), 'e2e', 'artifacts');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `ficha-${download.suggestedFilename()}`);
  await download.saveAs(file);
  expect(statSync(file).size).toBeGreaterThan(500_000);
  const info = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' }),
  ) as { streams: { codec_name: string; width: number; height: number }[]; format: { duration: string } };
  expect(info.streams[0]).toMatchObject({ codec_name: 'vp9', width: 1080, height: 1920 });
  expect(Math.abs(Number(info.format.duration) - expectedSeconds)).toBeLessThan(0.1);
  await expect(page.getByText(`Descarga lista: `)).toBeVisible();

  // La ficha sigue siendo una sola (no se duplica al volver a exportar) y el vídeo cuenta como descargado.
  await page.getByRole('link', { name: 'Vídeos', exact: true }).first().click();
  await expect(page.getByTestId('video-card')).toHaveCount(1);
  await expect(page.getByTestId('video-card')).toContainText('Descargado');

  // Recargar conserva la ficha.
  await page.reload();
  await expect(page.getByTestId('video-card')).toHaveCount(1);
});
