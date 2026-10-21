import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

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

  // Tras descargar, la tarjeta del partido se pinta de verde en el calendario (y se recuerda al recargar).
  await page.getByRole('button', { name: 'Volver al calendario' }).click();
  await expect(page.locator('.match--downloaded')).toHaveCount(1);
  await expect(page.locator('.match--downloaded')).toContainText('Hecho');
  await page.reload();
  await expect(page.locator('.match--downloaded')).toHaveCount(1);
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

test.describe('lotes', () => {
  test('cancelar todo, reintentar, quitar y ver una semilla en la vista previa', async ({ page }) => {
    await openStudio(page);
    await page.getByTestId('batch-count').fill('3');
    await page.getByTestId('batch-generate').click();
    const jobs = page.getByTestId('batch-job');
    await expect(jobs).toHaveCount(3);
    await expect(jobs.first()).toHaveAttribute('data-status', 'running');
    await expect(jobs.first().locator('progress')).toBeVisible();
    // Sólo uno a la vez.
    await expect(page.locator('[data-testid=batch-job][data-status=running]')).toHaveCount(1);
    // La primera semilla del lote es la actual.
    await expect(jobs.first()).toContainText('Semilla 2024');
    await page.getByTestId('batch-cancel').click();
    await expect(page.locator('[data-testid=batch-job][data-status=cancelled]')).toHaveCount(3);
    await expect(page.getByTestId('batch-retry-all')).toBeVisible();
    // Reintentar uno: vuelve a correr y se cancela otra vez.
    await jobs.nth(1).getByTestId('job-retry').click();
    await expect(jobs.nth(1)).toHaveAttribute('data-status', 'running');
    await jobs.nth(1).getByTestId('job-remove').click(); // «Cancelar» (en curso) = quita y aborta
    await expect(jobs).toHaveCount(2);
    // «Ver en la vista previa» cambia la semilla del estudio.
    const seedOfSecond = (await jobs.nth(1).textContent())?.match(/Semilla (\d+)/)?.[1] ?? '';
    await jobs.nth(1).getByTestId('job-view').click();
    await expect(page.getByTestId('seed-input')).toHaveValue(seedOfSecond);
    await page.getByTestId('batch-clear').click();
    await expect(jobs).toHaveCount(0);
  });

  test('genera 2 vídeos distintos, los descarga uno a uno y en ZIP, y los valida con ffprobe', async ({ page }) => {
    await openStudio(page);
    await page.getByTestId('batch-count').fill('2');
    await page.getByTestId('batch-generate').click();
    const jobs = page.getByTestId('batch-job');
    await expect(jobs).toHaveCount(2);
    await expect(page.locator('[data-testid=batch-job][data-status=done]')).toHaveCount(2, { timeout: 330_000 });
    await expect(page.getByTestId('batch-summary')).toContainText('2 de 2 listos');

    // Las dos semillas son distintas y los nombres de archivo también.
    const names = await jobs.locator('.job__file').allTextContents();
    expect(new Set(names).size).toBe(2);
    expect(names.every((n) => /_vs_.*\.mp4$/.test(n))).toBe(true);

    const dir = join(process.cwd(), 'e2e', 'artifacts');
    mkdirSync(dir, { recursive: true });

    // Descarga individual.
    const [single] = await Promise.all([page.waitForEvent('download'), jobs.first().getByTestId('job-download').click()]);
    expect(single.suggestedFilename()).toBe(names[0]);
    const singleFile = join(dir, `lote-${single.suggestedFilename()}`);
    await single.saveAs(singleFile);

    // ZIP con todo.
    const [zipDownload] = await Promise.all([page.waitForEvent('download'), page.getByTestId('batch-zip').click()]);
    expect(zipDownload.suggestedFilename()).toMatch(/^[a-z0-9._-]+_2-videos\.zip$/);
    const zipFile = join(dir, zipDownload.suggestedFilename());
    await zipDownload.saveAs(zipFile);
    const entries = unzipSync(new Uint8Array(readFileSync(zipFile)));
    expect(Object.keys(entries).sort()).toEqual(['LEEME.txt', ...names].sort());
    expect(strFromU8(entries['LEEME.txt'] ?? new Uint8Array())).toContain('SIMULACIONES FICTICIAS');
    const [a, b] = names;
    expect(entries[a ?? '']?.length).toBeGreaterThan(500_000);
    expect(entries[b ?? '']).not.toEqual(entries[a ?? '']); // simulaciones distintas ⇒ vídeos distintos
    // El MP4 suelto y el del ZIP son idénticos y válidos.
    expect(Buffer.from(entries[a ?? ''] ?? new Uint8Array()).equals(readFileSync(singleFile))).toBe(true);
    for (const n of names) {
      const extracted = join(dir, `zip-${n}`);
      writeFileSync(extracted, entries[n] ?? new Uint8Array());
      const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate', '-of', 'json', extracted], { encoding: 'utf8' })) as {
        streams: { codec_name: string; width: number; height: number; r_frame_rate: string }[];
      };
      expect(info.streams[0]).toMatchObject({ codec_name: 'vp9', width: 1080, height: 1920, r_frame_rate: '30/1' });
    }
    await page.getByTestId('batch-clear').click();
  });
});
