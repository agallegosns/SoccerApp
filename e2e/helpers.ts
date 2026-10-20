import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import type { Page, Route } from '@playwright/test';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** Hoy "congelado" para que «Próximos» sea determinista. */
export const TODAY = new Date('2026-10-20T12:00:00');

export interface Mocks {
  /** Cuántas peticiones se han hecho a cada URL. */
  readonly hits: Map<string, number>;
  /** Si no es null, las peticiones a en.1 fallan con este estado (o abortan si es 0). */
  failEn1: number | null;
}

/** Sirve los datos reales de openfootball desde archivos locales (sin depender de la red). */
export async function mockOpenFootball(page: Page): Promise<Mocks> {
  const mocks: Mocks = { hits: new Map(), failEn1: null };
  const serve = (name: string, contentType: string) => async (route: Route) => {
    const url = route.request().url();
    mocks.hits.set(url, (mocks.hits.get(url) ?? 0) + 1);
    await route.fulfill({
      status: 200,
      contentType,
      headers: { 'access-control-allow-origin': '*' },
      body: fixture(name),
    });
  };
  await page.clock.setFixedTime(TODAY);
  await page.route('**/openfootball/football.json/master/2026-27/es.1.json', serve('es.1.json', 'application/json'));
  await page.route('**/openfootball/football.json/master/2026-27/en.1.json', async (route) => {
    const url = route.request().url();
    mocks.hits.set(url, (mocks.hits.get(url) ?? 0) + 1);
    if (mocks.failEn1 === 0) return route.abort('failed');
    if (mocks.failEn1 !== null) return route.fulfill({ status: mocks.failEn1, body: 'error' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: fixture('en.1.json'),
    });
  });
  await page.route(
    '**/openfootball/europe-champions-league/master/2025-26/cl.txt',
    serve('cl-2025-26.txt', 'text/plain; charset=utf-8'),
  );
  // Otras ligas: no usadas en estas pruebas; se rechazan para detectar peticiones inesperadas.
  await page.route(/football\.json\/master\/2026-27\/(de|it|fr)\.1\.json/, (route) => route.abort('failed'));
  return mocks;
}

/** PNG sólido (r, g, b) de `size`×`size` píxeles, generado sin dependencias (para probar la subida de escudos). */
export function solidPng(r: number, g: number, b: number, size = 64): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
