import { expect, test, type Browser, type Page } from '@playwright/test';

import { handleRequest, type Env, type KV } from '../cloudflare/stats-worker.ts';
import { mockOpenFootball } from './helpers.ts';
import { seedStorage, seedVideo } from './seed.ts';

test.use({ contextOptions: { reducedMotion: 'reduce' } });

const WORKER = 'https://sync.example.workers.dev';
const KEY = 'clave-de-prueba-'.padEnd(32, 'x');

class MemoryKV implements KV {
  readonly data = new Map<string, string>();
  get(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }
  put(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

/** El Worker REAL de Cloudflare (mismo código) con un KV en memoria, atendiendo las peticiones del navegador. */
async function serveWorker(page: Page, kv: KV, counter: { posts: number }): Promise<void> {
  const env: Env = { STATS: kv, STATS_KEY: KEY };
  await page.route(`${WORKER}/**`, async (route) => {
    const req = route.request();
    const body = req.postData();
    if (req.method() === 'POST') counter.posts += 1;
    const res = await handleRequest(new Request(req.url(), { method: req.method(), headers: req.headers(), ...(body === null ? {} : { body }) }), env);
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers.entries()), body: await res.text() });
  });
}

async function newDevice(browser: Browser, kv: KV, counter: { posts: number }, seed: boolean): Promise<Page> {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await mockOpenFootball(page);
  await serveWorker(page, kv, counter);
  if (seed) await seedStorage(page, { videos: [seedVideo(11), seedVideo(12)] });
  await page.goto('/#/videos');
  return page;
}

async function connect(page: Page): Promise<void> {
  await page.getByTestId('sync-open').click();
  await page.getByTestId('sync-url').fill(WORKER);
  await page.getByTestId('sync-key').fill(KEY);
  await page.getByTestId('sync-connect').click();
  await expect(page.getByTestId('sync-summary')).toContainText('Última sincronización');
  await page.getByRole('button', { name: 'Cerrar' }).click();
}

async function syncNow(page: Page): Promise<void> {
  await page.getByTestId('sync-open').click();
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('sync-summary')).toContainText('Última sincronización');
  await page.getByRole('button', { name: 'Cerrar' }).click();
}

test.describe('sincronización móvil ⇄ ordenador (dos navegadores, Worker real, KV en memoria)', () => {
  test('los vídeos, borrados y marcas viajan de un dispositivo al otro', async ({ browser }) => {
    const kv = new MemoryKV();
    const counter = { posts: 0 };
    const phone = await newDevice(browser, kv, counter, true);
    const pc = await newDevice(browser, kv, counter, false);
    await expect(phone.getByTestId('video-card')).toHaveCount(2);
    await expect(pc.getByTestId('videos-empty')).toBeVisible();

    // Sin conexión no se hace ninguna petición al Worker.
    expect(counter.posts).toBe(0);

    await connect(phone);
    await connect(pc);
    // El ordenador recibe los dos vídeos del móvil.
    await expect(pc.getByTestId('video-card')).toHaveCount(2);

    // Se borra uno en el ordenador y se marca el otro como publicado en el móvil.
    await pc.getByTestId('delete-video').first().click();
    await pc.getByTestId('confirm-ok').click();
    await expect(pc.getByTestId('video-card')).toHaveCount(1);
    await syncNow(pc);

    await phone.getByTestId('open-video').first().click();
    await phone.getByTestId('toggle-published').click();
    await expect(phone.getByTestId('published-date')).toBeVisible();
    await syncNow(phone);
    // El móvil ya no tiene el que se borró en el ordenador (si era el abierto, la ficha avisa de que no existe).
    await phone.goto('/#/videos');
    await expect(phone.getByTestId('video-card')).toHaveCount(1);

    await syncNow(pc);
    await expect(pc.getByTestId('video-card')).toHaveCount(1);
    await expect(pc.getByTestId('chip-published')).toHaveCount(1);
    // Y el estado es el mismo en los dos tras recargar.
    await pc.reload();
    await expect(pc.getByTestId('chip-published')).toHaveCount(1);
  });

  test('una clave equivocada muestra un error claro y no pierde nada', async ({ browser }) => {
    const kv = new MemoryKV();
    const phone = await newDevice(browser, kv, { posts: 0 }, true);
    await phone.getByTestId('sync-open').click();
    await phone.getByTestId('sync-url').fill(WORKER);
    await phone.getByTestId('sync-key').fill('otra-clave-distinta-'.padEnd(32, 'y'));
    await phone.getByTestId('sync-connect').click();
    await expect(phone.getByTestId('sync-error-msg')).toContainText('rechazó la clave');
    await phone.getByRole('button', { name: 'Cerrar' }).click();
    await expect(phone.getByTestId('video-card')).toHaveCount(2);
    // Una clave demasiado corta ni se intenta.
    await phone.getByTestId('sync-open').click();
    await phone.getByTestId('sync-disconnect').click();
    await phone.getByTestId('confirm-ok').click();
    await phone.getByTestId('sync-url').fill(WORKER);
    await phone.getByTestId('sync-key').fill('corta');
    await phone.getByTestId('sync-connect').click();
    await expect(phone.getByTestId('sync-problem')).toContainText('24 caracteres');
  });
});
