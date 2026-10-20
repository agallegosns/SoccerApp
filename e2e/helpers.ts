import { readFileSync } from 'node:fs';
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
