import { expect, test } from '@playwright/test';

import { readFileSync } from 'node:fs';

import { mockOpenFootball } from './helpers.ts';

const championsXlsx = readFileSync(new URL('../public/data/champions-league-2026-27.xlsx', import.meta.url));

test.describe('calendario real', () => {
  test('carga LaLiga 2026-27 con partidos próximos agrupados por día', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Calendario de partidos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'LaLiga 2026-27' })).toHaveAttribute('aria-pressed', 'true');
    const count = page.getByTestId('count');
    await expect(count).toContainText('partidos de 380');
    // El 20/10/2026 ya hay jornadas jugadas: «Próximos» muestra menos que el total.
    const text = (await count.textContent()) ?? '';
    const shown = Number(/^(\d+)/.exec(text)?.[1]);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(380);
  });

  test('«Jugados» muestra resultados reales etiquetados como tal', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Jugados' }).click();
    const first = page.locator('.match').first();
    await expect(first).toBeVisible();
    await expect(page.getByText(/^Real \d–\d$/).first()).toBeVisible();
  });

  test('el buscador filtra por equipo sin importar acentos ni mayúsculas', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Todos' }).click();
    await page.getByPlaceholder('Buscar equipo o jornada').fill('alaves');
    const cards = page.locator('.match');
    await expect(cards.first()).toContainText('Alavés');
    const n = await cards.count();
    expect(n).toBeGreaterThan(20);
    for (const text of await cards.allTextContents()) expect(text).toContain('Alavés');
  });

  test('el filtro de fechas limita el rango (inclusive)', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Todos' }).click();
    await page.getByLabel('Desde').fill('2026-08-15');
    await page.getByLabel('Hasta').fill('2026-08-15');
    await expect(page.locator('.day')).toHaveCount(1);
    await expect(page.locator('.day__title')).toHaveText(/sábado, 15 de agosto de 2026/i);
  });

  test('seleccionar un partido lo muestra en el panel y se puede quitar', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    const card = page.locator('.match').first();
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    const panel = page.getByTestId('selected-match');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('LaLiga 2026-27');
    await expect(panel).toContainText('ficticia');
    await page.getByRole('button', { name: 'Quitar selección' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('Champions League 2025-26 se carga (temporada anterior) y muestra la final con penaltis', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Champions League 2025-26' }).click();
    // Todos los partidos son anteriores a hoy: «Próximos» está vacío y ofrece ver todos.
    await expect(page.getByText('No hay partidos con estos filtros.')).toBeVisible();
    await page.getByRole('button', { name: 'Ver todos los partidos' }).click();
    await expect(page.getByTestId('count')).toContainText('189 partidos');
    await page.getByPlaceholder('Buscar equipo o jornada').fill('Arsenal');
    const final = page.locator('.match', { hasText: 'Fase final · Final' });
    await expect(final).toContainText('Paris Saint-Germain FC');
    await expect(final).toContainText('Real 1–1');
    await final.click();
    await expect(page.getByTestId('selected-match')).toContainText('penaltis 4-3');
  });

  test('si la fuente falla se reintenta, se informa y «Reintentar» recupera los datos', async ({ page }) => {
    const mocks = await mockOpenFootball(page);
    mocks.failEn1 = 500;
    await page.goto('/');
    await page.getByRole('button', { name: 'Premier League 2026-27' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'No se pudo cargar el calendario' });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    const url = [...mocks.hits.keys()].find((u) => u.includes('en.1.json')) ?? '';
    expect(mocks.hits.get(url)).toBe(3); // 1 intento + 2 reintentos
    mocks.failEn1 = null;
    await alert.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.getByTestId('count')).toContainText('partidos');
    await expect(alert).toHaveCount(0);
  });

  test('sin red pero con datos guardados antes: muestra la copia y lo avisa', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await expect(page.getByTestId('count')).toContainText('partidos');
    // Recarga con la fuente caída: la memoria está vacía, así que debe salir de localStorage.
    await page.unroute('**/openfootball/football.json/master/2026-27/es.1.json');
    await page.route('**/openfootball/football.json/master/2026-27/es.1.json', (route) => route.abort('failed'));
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'mostrando la copia guardada' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('count')).toContainText('partidos de 380');
  });

  test('importa un calendario de football-data.org y convierte las horas UTC a tu zona', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Importar calendario' }).click();
    const data = {
      competition: { name: 'UEFA Champions League' },
      matches: [
        { utcDate: '2026-10-21T19:00:00Z', stage: 'LEAGUE_STAGE', matchday: 3, homeTeam: { name: 'Real Madrid CF' }, awayTeam: { name: 'Juventus FC' }, score: { fullTime: { home: null, away: null } } },
        { utcDate: '2026-10-22T16:45:00Z', stage: 'LEAGUE_STAGE', matchday: 3, homeTeam: { name: 'Arsenal FC' }, awayTeam: { name: 'PSV' }, score: { fullTime: { home: null, away: null } } },
      ],
    };
    await page.getByLabel('Nombre').fill('Copa de prueba');
    await page.getByTestId('import-file').setInputFiles({ name: 'cl.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.getByRole('button', { name: 'Importar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copa de prueba 2026-27', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.match')).toHaveCount(2);
    await expect(page.locator('.match').first()).toContainText('tu hora');
    // Persiste tras recargar.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Copa de prueba 2026-27', exact: true })).toBeVisible();
  });

  test('rechaza con un mensaje claro un archivo que no es un calendario', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Importar calendario' }).click();
    await page.getByLabel('Nombre').fill('Prueba');
    await page.getByTestId('import-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hola":1}') });
    await page.getByRole('button', { name: 'Importar', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Formato JSON no reconocido');
  });
});

test.describe('competiciones 2026-27: LaLiga, Champions, Europa League y Conference League', () => {
  test('el orden de pestañas es LaLiga, Champions, Europa League y Conference League', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    const names = await page.locator('.leagues .league:not(.league--import) .league__text').allInnerTexts();
    expect(names.slice(0, 4).map((n) => n.replace(/\s+/g, ' '))).toEqual([
      'LaLiga 2026-27',
      'Champions League 2026-27',
      'Europa League 2026-27',
      'Conference League 2026-27',
    ]);
  });

  test('Champions League 2026-27 sale del Excel incluido: 144 partidos reales de la fase de liga', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Champions League 2026-27', exact: true }).click();
    await page.getByRole('button', { name: 'Todos' }).click();
    await expect(page.getByTestId('count')).toContainText('144 partidos');
    const first = page.locator('.match').first();
    await expect(first).toContainText('AEK');
    await expect(first).toContainText('LASK');
    await expect(first).toContainText('18:45');
    await expect(first).toContainText('Fase de liga · Jornada 1');
    await expect(page.locator('.day__title').first()).toHaveText(/martes, 8 de septiembre de 2026/i);
    await first.click();
    await expect(page.getByTestId('selected-match')).toContainText('Champions League 2026-27');
  });

  test('Europa League y Conference League están preparadas y se rellenan al importar su Excel', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Europa League 2026-27', exact: true }).click();
    await expect(page.getByTestId('awaiting')).toContainText('preparada pero aún no tiene calendario');
    await page.getByRole('button', { name: 'Importar calendario de Europa League' }).click();
    await expect(page.getByLabel('Nombre')).toHaveValue('Europa League');
    await expect(page.getByLabel('Temporada')).toHaveValue('2026-27');
    await page.getByTestId('import-file').setInputFiles({
      name: 'Europa_League.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: championsXlsx,
    });
    await page.getByRole('button', { name: 'Importar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('awaiting')).toHaveCount(0);
    await page.getByRole('button', { name: 'Todos' }).click();
    await expect(page.getByTestId('count')).toContainText('144 partidos');
    // Conference sigue esperando su archivo; Europa ya no está duplicada.
    await expect(page.getByRole('button', { name: 'Europa League 2026-27', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Conference League 2026-27', exact: true }).click();
    await expect(page.getByTestId('awaiting')).toBeVisible();
    // Persiste tras recargar.
    await page.reload();
    await page.getByRole('button', { name: 'Europa League 2026-27', exact: true }).click();
    await expect(page.getByTestId('awaiting')).toHaveCount(0);
    await expect(page.locator('.match').first()).toBeVisible();
  });
});

test.describe('móvil', () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true });

  test('sin scroll horizontal y con zonas táctiles ≥ 44 px', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await expect(page.locator('.match').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const small = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('button, input:not([type=hidden]), summary, a[href]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 43.5 || r.width < 43.5) bad.push(`${el.tagName} "${el.textContent.trim().slice(0, 30)}" ${String(Math.round(r.width))}x${String(Math.round(r.height))}`);
      }
      return bad;
    });
    expect(small).toEqual([]);
  });
});

test.describe('ajustes del calendario', () => {
  test('sin avisos tras el filtro de fechas, sin banner flotante y con marca manual de «hecho»', async ({ page }) => {
    await mockOpenFootball(page);
    await page.goto('/');
    await expect(page.locator('.match').first()).toBeVisible();
    await expect(page.locator('.notice')).toHaveCount(0);
    await expect(page.getByText('Selecciona un partido')).toHaveCount(0);
    await expect(page.locator('.calendar__side')).toHaveCount(0);

    const first = page.locator('.match-wrap').first();
    await expect(first.locator('.match--downloaded')).toHaveCount(0);
    await first.getByRole('button', { name: /como hecho$/ }).click();
    await expect(first.locator('.match--downloaded')).toHaveCount(1);
    await expect(first).toContainText('Hecho');
    await page.reload();
    await expect(page.locator('.match--downloaded')).toHaveCount(1);
    await page.locator('.match-wrap').first().getByRole('button', { name: /como hecho$/ }).click(); // desmarcar
    await expect(page.locator('.match--downloaded')).toHaveCount(0);

    await page.locator('.match').first().click();
    await expect(page.getByTestId('selected-match')).toBeVisible();
  });

  test('se actualiza sola cuando el servidor publica una versión nueva', async ({ page }) => {
    await mockOpenFootball(page);
    await page.route('**/version.json*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'version-nueva-de-prueba' }) }));
    const loads: string[] = [];
    page.on('load', () => { loads.push(page.url()); });
    await page.goto('/');
    await expect.poll(() => loads.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2); // se recargó sola
    await page.waitForTimeout(1500);
    expect(loads.length).toBe(2); // y sólo una vez (no entra en bucle)
  });

  test('con la misma versión no se recarga', async ({ page }) => {
    await mockOpenFootball(page);
    const loads: string[] = [];
    page.on('load', () => { loads.push(page.url()); });
    await page.goto('/');
    await page.waitForTimeout(2500);
    expect(loads.length).toBe(1);
  });
});
