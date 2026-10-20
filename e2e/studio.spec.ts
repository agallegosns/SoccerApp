import { expect, test, type Page } from '@playwright/test';

import { mockOpenFootball, solidPng } from './helpers.ts';

async function openStudio(page: Page): Promise<void> {
  await mockOpenFootball(page);
  await page.goto('/');
  await page.locator('.match').first().click();
  await page.getByTestId('open-studio').click();
  await expect(page.getByRole('button', { name: 'Volver al calendario' })).toBeVisible();
}

async function setSeed(page: Page, seed: string): Promise<void> {
  await page.getByTestId('seed-input').fill(seed);
}

async function seekTo(page: Page, t: number): Promise<void> {
  await page.getByTestId('scrubber').evaluate((el: HTMLInputElement, value) => {
    // Hace falta el setter nativo para que React detecte el cambio (un `el.value = …` directo no dispara onChange).
    // eslint-disable-next-line @typescript-eslint/unbound-method -- se invoca enseguida con `.call(el, …)`
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, t);
}

/** Color RGB del píxel (x, y) del canvas 1080×1920. */
async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  return page.getByTestId('preview-canvas').evaluate((c: HTMLCanvasElement, [px, py]) => {
    const data = c.getContext('2d')?.getImageData(px ?? 0, py ?? 0, 1, 1).data;
    return [data?.[0] ?? -1, data?.[1] ?? -1, data?.[2] ?? -1] as [number, number, number];
  }, [x, y]);
}

async function canvasHash(page: Page): Promise<string> {
  return page.getByTestId('preview-canvas').evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data ?? new Uint8ClampedArray();
    let h = 2166136261;
    for (let i = 0; i < data.length; i += 97) h = Math.imul(h ^ (data[i] ?? 0), 16777619);
    return String(h >>> 0);
  });
}

test.describe('estudio de simulación', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('abre el estudio con el partido elegido, etiqueta «Simulación ficticia» y vuelve al calendario', async ({ page }) => {
    await openStudio(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('vs');
    await expect(page.getByText('Simulación ficticia').first()).toBeVisible();
    await expect(page.getByTestId('preview-canvas')).toHaveAttribute('width', '1080');
    await expect(page.getByTestId('preview-canvas')).toHaveAttribute('height', '1920');
    await page.getByRole('button', { name: 'Volver al calendario' }).click();
    await expect(page.getByRole('heading', { name: 'Calendario de partidos' })).toBeVisible();
  });

  test('la misma semilla da la misma simulación; otra semilla da otra', async ({ page }) => {
    await openStudio(page);
    await setSeed(page, '12345');
    const events = (): Promise<string | null> => page.getByTestId('events').textContent();
    const first = await events();
    const firstScore = await page.getByTestId('sim-score').textContent();
    expect(first?.length).toBeGreaterThan(50);
    await setSeed(page, '999');
    await expect.poll(events).not.toBe(first);
    await setSeed(page, '12345');
    await expect.poll(events).toBe(first);
    await expect(page.getByTestId('sim-score')).toHaveText(firstScore ?? '');
  });

  test('hay dos estilos de vídeo (Arena por defecto y Táctico) y ambos dibujan la etiqueta ficticia', async ({ page }) => {
    await openStudio(page);
    await expect(page.getByTestId('style-arena')).toHaveAttribute('aria-pressed', 'true');
    await setSeed(page, '2024');
    await seekTo(page, 14);
    const arena = await canvasHash(page);
    const [r, g, b] = await pixel(page, 540, 175);
    expect(r).toBeGreaterThan(220);
    expect(b).toBeLessThan(80);
    expect(g).toBeGreaterThan(150);
    await page.getByTestId('style-tactical').click();
    await expect(page.getByTestId('style-tactical')).toHaveAttribute('aria-pressed', 'true');
    await seekTo(page, 14);
    expect(await canvasHash(page)).not.toBe(arena);
    const [r2, g2, b2] = await pixel(page, 540, 175);
    expect(r2).toBeGreaterThan(220);
    expect(g2).toBeGreaterThan(150);
    expect(b2).toBeLessThan(80);
  });

  test('el ritmo rápido es el de por defecto: dura bastante menos que el normal con los mismos sucesos', async ({ page }) => {
    await openStudio(page);
    await setSeed(page, '2024');
    await expect(page.getByTestId('pace-fast')).toHaveAttribute('aria-pressed', 'true');
    const fastEvents = await page.getByTestId('events').locator('.event__text').allTextContents();
    const fastClocks = await page.getByTestId('events').locator('.event__clock').allTextContents();
    const fastScore = await page.getByTestId('sim-score').textContent();
    const fastDuration = Number(await page.getByTestId('scrubber').getAttribute('max'));
    expect(fastDuration).toBeLessThan(45);
    await page.getByTestId('pace-normal').click();
    await expect(page.getByTestId('pace-normal')).toHaveAttribute('aria-pressed', 'true');
    const slowDuration = Number(await page.getByTestId('scrubber').getAttribute('max'));
    expect(slowDuration).toBeGreaterThan(fastDuration * 1.4);
    expect(await page.getByTestId('events').locator('.event__text').allTextContents()).toEqual(fastEvents);
    expect(await page.getByTestId('events').locator('.event__clock').allTextContents()).toEqual(fastClocks);
    expect(await page.getByTestId('sim-score').textContent()).toBe(fastScore);
  });

  test('escudos: se sube uno por equipo, se ve en ambos estilos, persiste y se puede quitar', async ({ page }) => {
    await openStudio(page);
    await setSeed(page, '2024');
    await expect(page.getByTestId('crests-panel')).toContainText('Escudo genérico');
    const generic = await pixel(page, 175, 352);
    await page.getByTestId('crest-file-home').setInputFiles({ name: 'rojo.png', mimeType: 'image/png', buffer: solidPng(220, 20, 20) });
    await expect(page.getByTestId('crests-panel')).toContainText('Escudo subido por ti');
    await seekTo(page, 0.4);
    const arena = await pixel(page, 175, 352); // centro del escudo local en el estilo Arena
    expect(arena[0]).toBeGreaterThan(170);
    expect(arena[1]).toBeLessThan(90);
    expect(arena).not.toEqual(generic);
    await page.getByTestId('style-tactical').click();
    await seekTo(page, 0.4);
    const tactical = await pixel(page, 190, 330);
    expect(tactical[0]).toBeGreaterThan(170);
    expect(tactical[1]).toBeLessThan(90);
    await page.getByTestId('style-arena').click();
    // El escudo del otro equipo sigue siendo el genérico.
    await expect(page.getByTestId('crests-panel')).toContainText('Escudo genérico');
    // Persiste al volver a abrir el estudio.
    await page.reload();
    await page.locator('.match').first().click();
    await page.getByTestId('open-studio').click();
    await expect(page.getByTestId('crests-panel')).toContainText('Escudo subido por ti');
    await page.getByTestId('crest-remove-home').click();
    await expect(page.getByTestId('crests-panel')).not.toContainText('Escudo subido por ti');
  });

  test('escudos: un archivo que no es una imagen válida se rechaza con un mensaje claro', async ({ page }) => {
    await openStudio(page);
    await page.getByTestId('crest-file-home').setInputFiles({ name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect(page.getByTestId('crest-error')).toContainText('PNG, JPG o WebP');
    await page.getByTestId('crest-file-home').setInputFiles({ name: 'falso.png', mimeType: 'image/png', buffer: Buffer.from('esto no es un png') });
    await expect(page.getByTestId('crest-error')).toContainText('No se pudo leer la imagen');
    await page.getByTestId('crest-file-away').setInputFiles({ name: 'enorme.png', mimeType: 'image/png', buffer: Buffer.alloc(3_100_000, 1) });
    await expect(page.getByTestId('crest-error')).toContainText('pesa demasiado');
  });

  test('el marcador fijado se respeta: mismos goles en los sucesos y en el marcador', async ({ page }) => {
    await openStudio(page);
    await page.getByTestId('fix-score').click();
    await page.getByTestId('score-home').fill('3');
    await page.getByTestId('score-away').fill('2');
    await expect(page.getByTestId('sim-score')).toContainText('3–2');
    await expect(page.locator('.event--goal')).toHaveCount(5);
    for (const seed of ['1', '2', '3']) {
      await setSeed(page, seed);
      await expect(page.getByTestId('sim-score')).toContainText('3–2');
      await expect(page.locator('.event--goal')).toHaveCount(5);
    }
    await page.getByTestId('score-home').fill('0');
    await page.getByTestId('score-away').fill('0');
    await expect(page.locator('.event--goal')).toHaveCount(0);
  });

  test('el marcador aleatorio depende de la semilla y concuerda con los goles', async ({ page }) => {
    await openStudio(page);
    for (const seed of ['7', '8', '9', '10']) {
      await setSeed(page, seed);
      const text = await page.getByTestId('sim-score').innerText();
      const [, h, a] = /(\d+)–(\d+)/.exec(text) ?? [];
      await expect(page.locator('.event--goal')).toHaveCount(Number(h) + Number(a));
    }
  });

  test('la vista previa se dibuja de verdad: etiqueta ficticia visible en todos los momentos y fotogramas distintos', async ({ page }) => {
    await openStudio(page);
    await setSeed(page, '2024');
    await page.getByTestId('fix-score').click();
    await page.getByTestId('score-home').fill('2');
    await page.getByTestId('score-away').fill('1');
    const duration = Number(await page.getByTestId('scrubber').getAttribute('max'));
    expect(duration).toBeGreaterThan(15);
    const hashes = new Set<string>();
    for (const t of [0.5, 4, 8, 12, duration / 2, duration - 4, duration - 0.5]) {
      await seekTo(page, t);
      const [r, g, b] = await pixel(page, 540, 175); // píldora ámbar «SIMULACIÓN FICTICIA»
      expect(r).toBeGreaterThan(220);
      expect(g).toBeGreaterThan(150);
      expect(b).toBeLessThan(80);
      hashes.add(await canvasHash(page));
    }
    expect(hashes.size).toBeGreaterThanOrEqual(6);
  });

  test('pulsar un suceso salta al momento y reproducir/pausar funciona', async ({ page }) => {
    await openStudio(page);
    await setSeed(page, '2024');
    await page.locator('.event').first().click();
    const t = Number(await page.getByTestId('scrubber').inputValue());
    expect(t).toBeGreaterThan(1);
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('play-toggle')).toHaveAttribute('aria-label', 'Pausar');
    await page.waitForTimeout(600);
    expect(Number(await page.getByTestId('scrubber').inputValue())).toBeGreaterThan(t);
    await page.getByTestId('play-toggle').click();
    await expect(page.getByTestId('play-toggle')).toHaveAttribute('aria-label', 'Reproducir');
  });

  test('exportar: sin H.264 el navegador lo explica con claridad; con H.264 exporta de verdad', async ({ page }) => {
    await openStudio(page);
    const h264 = await page.evaluate(
      async () =>
        typeof VideoEncoder !== 'undefined' &&
        (await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1080, height: 1920, bitrate: 6_000_000, framerate: 30 })).supported,
    );
    if (!h264) {
      await expect(page.getByTestId('batch-unsupported')).toContainText('Chrome, Edge o Safari recientes');
      await expect(page.getByTestId('batch-generate')).toBeDisabled();
      await expect(page.getByTestId('export-unsupported')).toContainText('H.264');
      await expect(page.getByTestId('export-unsupported')).toContainText('Chrome, Edge o Safari recientes');
      await expect(page.getByTestId('export-button')).toBeDisabled();
    } else {
      await expect(page.getByTestId('export-button')).toBeEnabled();
      await page.getByTestId('export-button').click();
      await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 300_000 });
      await expect(page.getByTestId('download-link')).toHaveAttribute('download', /\.mp4$/);
    }
  });

  test('una semilla no válida muestra un aviso y no rompe la simulación', async ({ page }) => {
    await openStudio(page);
    await setSeed(page, 'abc');
    await expect(page.getByRole('alert').filter({ hasText: 'entero' })).toBeVisible();
    await expect(page.getByTestId('preview-canvas')).toBeVisible();
  });

  test('el estudio es usable en móvil sin scroll horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await openStudio(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByTestId('preview-canvas').boundingBox();
    expect(box?.width).toBeGreaterThan(280);
    expect(Math.abs((box?.height ?? 0) / (box?.width ?? 1) - 16 / 9)).toBeLessThan(0.02);
  });
});
