import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { mockOpenFootball } from './helpers.ts';

/**
 * Flujo completo de exportación en la interfaz, sobre la compilación con VP9 (el Chromium del sandbox no codifica H.264).
 * Los MP4 resultantes se validan con ffprobe.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });

async function openStudio(page: Page): Promise<void> {
  await mockOpenFootball(page);
  await page.goto('/');
  await page.locator('.match').first().click();
  await page.getByTestId('open-studio').click();
  await page.getByTestId('seed-input').fill('2024');
}

test('exporta un MP4 vertical real: progreso, vídeo reproducible y descarga validada con ffprobe', async ({ page }) => {
  await openStudio(page);
  await page.getByTestId('fix-score').click();
  await page.getByTestId('score-home').fill('1');
  await page.getByTestId('score-away').fill('0');
  const expectedSeconds = Number(await page.getByTestId('scrubber').getAttribute('max'));

  await expect(page.getByTestId('export-button')).toBeEnabled();
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-progress')).toBeVisible();
  await expect(page.getByTestId('export-progress')).toContainText('Codificando fotograma');

  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 300_000 });
  await expect(page.getByTestId('export-result')).toContainText(/_vs_.*_2024\.mp4/);
  await expect(page.getByTestId('export-result')).toContainText('1080×1920');

  // El navegador puede reproducir el archivo exportado.
  const video = page.getByTestId('export-video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(1);
  const dims = await video.evaluate((v: HTMLVideoElement) => ({ w: v.videoWidth, h: v.videoHeight, d: v.duration }));
  expect(dims.w).toBe(1080);
  expect(dims.h).toBe(1920);
  expect(Math.abs(dims.d - expectedSeconds)).toBeLessThan(0.2);

  // Descarga real y validación externa.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-link').click()]);
  expect(download.suggestedFilename()).toMatch(/^[a-z0-9._-]+_vs_[a-z0-9._-]+_\d{4}-\d{2}-\d{2}_2024\.mp4$/);
  const dir = join(process.cwd(), 'e2e', 'artifacts');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, download.suggestedFilename());
  await download.saveAs(file);
  expect(statSync(file).size).toBeGreaterThan(500_000);
  const info = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_frames:format=duration', '-of', 'json', file], { encoding: 'utf8' }),
  ) as { streams: { codec_name: string; width: number; height: number; r_frame_rate: string; nb_read_frames: string }[]; format: { duration: string } };
  expect(info.streams[0]).toMatchObject({ codec_name: 'vp9', width: 1080, height: 1920, r_frame_rate: '30/1' });
  expect(Number(info.streams[0]?.nb_read_frames)).toBe(Math.ceil(expectedSeconds * 30));
  expect(Math.abs(Number(info.format.duration) - expectedSeconds)).toBeLessThan(0.1);
});

test('se puede cancelar una exportación en curso y volver a intentarlo', async ({ page }) => {
  await openStudio(page);
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-progress')).toContainText('Codificando fotograma');
  await page.getByTestId('export-cancel').click();
  await expect(page.getByTestId('export-error')).toContainText('Exportación cancelada');
  await expect(page.getByTestId('export-result')).toHaveCount(0);
  await expect(page.getByTestId('export-button')).toBeEnabled();
  await page.getByTestId('export-button').click();
  await expect(page.getByTestId('export-progress')).toBeVisible();
  await page.getByTestId('export-cancel').click();
  await expect(page.getByTestId('export-error')).toContainText('cancelada');
});
