import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { buildXlsx } from '../test/xlsxBuilder.ts';
import { BundledProvider } from './bundled.ts';
import { MatchCache, type KeyValueStore } from './cache.ts';
import { ImportedProvider } from './imported.ts';
import { parseImportedCalendar } from './parsers.ts';
import { MatchService } from './registry.ts';
import { OpenFootballProvider } from './openfootball.ts';
import { DataError } from './types.ts';
import { readXlsx } from './xlsx.ts';

const ctx = { leagueId: 't:x', competition: 'Test 2026-27' };
const championsBytes = (): Uint8Array =>
  new Uint8Array(readFileSync(new URL('../../public/data/champions-league-2026-27.xlsx', import.meta.url)));

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('Excel real de la Champions League 2026-27 (aportado por el usuario)', () => {
  const { format, matches } = parseImportedCalendar(championsBytes(), { ...ctx, roundPrefix: 'Fase de liga' });

  it('se detecta como xlsx y trae los 144 partidos de la fase de liga con ids únicos', () => {
    expect(format).toBe('xlsx');
    expect(matches).toHaveLength(144);
    expect(new Set(matches.map((m) => m.id)).size).toBe(144);
  });
  it('8 jornadas de 18 partidos y 36 equipos distintos; cada equipo juega 8 veces', () => {
    for (let j = 1; j <= 8; j += 1) {
      expect(matches.filter((m) => m.round === `Fase de liga · Jornada ${String(j)}`)).toHaveLength(18);
    }
    const games = new Map<string, number>();
    for (const m of matches) for (const t of [m.home, m.away]) games.set(t, (games.get(t) ?? 0) + 1);
    expect(games.size).toBe(36);
    expect([...games.values()].every((n) => n === 8)).toBe(true);
  });
  it('fechas y horas correctas (8/9/2026 → 27/1/2027; 18:45 y 21:00) y primer partido AEK–LASK', () => {
    expect(matches[0]).toMatchObject({ date: '2026-09-08', time: '18:45', home: 'AEK', away: 'LASK', realScore: null, timeKind: 'league-local' });
    expect(matches.at(-1)?.date).toBe('2027-01-27');
    expect(new Set(matches.map((m) => m.time))).toEqual(new Set(['18:45', '21:00']));
  });
  it('limpia espacios no separables de los nombres', () => {
    expect(matches.some((m) => m.away === 'Slovan Bratislava' || m.home === 'Slovan Bratislava')).toBe(true);
    expect(matches.every((m) => m.home === m.home.trim() && !m.home.includes(' ') && !m.away.includes(' '))).toBe(true);
  });
});

describe('lector de .xlsx', () => {
  const header = ['Jornada', 'Fecha', 'Hora', 'Equipo Local', null, 'Equipo Visitante'];

  it('lee fechas/horas de Excel (serie numérica) con strings compartidas', () => {
    // 46273 = 2026-09-08; 0.78125 = 18:45
    const bytes = buildXlsx([header, [1, 46273, 0.78125, 'Real Madrid', null, 'Inter & Co']], { sharedStrings: true });
    const [m] = parseImportedCalendar(bytes, ctx).matches;
    expect(m).toMatchObject({ date: '2026-09-08', time: '18:45', home: 'Real Madrid', away: 'Inter & Co', round: 'Jornada 1' });
  });
  it('admite fechas y horas como texto y filas sin hora', () => {
    const bytes = buildXlsx([['Título del archivo'], header, [2, '15/10/2026', '21:00', 'A', null, 'B'], [2, '2026-10-16', null, 'C', null, 'D']]);
    const matches = parseImportedCalendar(bytes, ctx).matches;
    expect(matches.map((m) => [m.date, m.time, m.home])).toEqual([['2026-10-15', '21:00', 'A'], ['2026-10-16', null, 'C']]);
  });
  it('acepta cabeceras en inglés y columnas en otro orden', () => {
    const bytes = buildXlsx([['Home', 'Away', 'Date', 'Time', 'Matchday'], ['X', 'Y', '2026-11-01', '20:00', 3]]);
    expect(parseImportedCalendar(bytes, ctx).matches[0]).toMatchObject({ home: 'X', away: 'Y', time: '20:00', round: 'Jornada 3' });
  });
  it('ignora filas incompletas y falla con claridad si no hay partidos o cabeceras', () => {
    expect(() => parseImportedCalendar(buildXlsx([header, [1, 46273, null, 'Solo local', null, null]]), ctx)).toThrow(/ningún partido/);
    expect(() => parseImportedCalendar(buildXlsx([['a', 'b'], [1, 2]]), ctx)).toThrow(/cabeceras/);
  });
  it('rechaza archivos que no son .xlsx', () => {
    expect(() => readXlsx(new TextEncoder().encode('esto no es un zip'))).toThrow(DataError);
  });
});

describe('Champions League 2026-27 incluida en la app (BundledProvider)', () => {
  it('descarga el Excel, lo convierte y reintenta si falla', async () => {
    const bytes = championsBytes();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('red'))
      .mockImplementation(() => Promise.resolve(new Response(bytes.slice().buffer, { status: 200 })));
    const provider = new BundledProvider('/base/', { fetchImpl, sleep: () => Promise.resolve() });
    const league = provider.listLeagues()[0];
    expect(league?.id).toBe('bundled:champions-league:2026-27');
    const matches = await provider.loadMatches(league?.id ?? '');
    expect(matches).toHaveLength(144);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/base/data/champions-league-2026-27.xlsx');
    expect(matches[0]?.round).toBe('Fase de liga · Jornada 1');
  });
});

describe('competiciones preparadas: Europa League y Conference League 2026-27', () => {
  it('aparecen como ranuras a la espera de importación', () => {
    const slots = new ImportedProvider(memoryStore()).listLeagues();
    expect(slots.map((l) => [l.name, l.season, l.awaitingImport])).toEqual([
      ['Europa League', '2026-27', true],
      ['Conference League', '2026-27', true],
    ]);
  });
  it('al importar su Excel la ranura se convierte en calendario real (sin duplicados)', async () => {
    const store = memoryStore();
    const provider = new ImportedProvider(store);
    const league = provider.importCalendar({ name: 'Europa League', season: '2026-27', content: championsBytes() });
    expect(league.id).toBe(provider.listLeagues().find((l) => l.name === 'Europa League')?.id);
    const names = provider.listLeagues().map((l) => `${l.name}:${String(l.awaitingImport === true)}`);
    expect(names).toEqual(['Europa League:false', 'Conference League:true']);
    expect((await new ImportedProvider(store).loadMatches(league.id)).length).toBe(144);
  });
  it('MatchService ordena LaLiga, Champions, Europa, Conference y el resto; y no intenta cargar una ranura vacía', async () => {
    const imported = new ImportedProvider(memoryStore());
    const service = new MatchService([new OpenFootballProvider(), new BundledProvider(), imported], new MatchCache(memoryStore()));
    expect(service.listLeagues().map((l) => `${l.name} ${l.season}`)).toEqual([
      'LaLiga 2026-27',
      'Champions League 2026-27',
      'Europa League 2026-27',
      'Conference League 2026-27',
      'Premier League 2026-27',
      'Bundesliga 2026-27',
      'Serie A 2026-27',
      'Ligue 1 2026-27',
      'Champions League 2025-26',
    ]);
    await expect(service.load('imported:europa-league:2026-27')).rejects.toMatchObject({ kind: 'not-found' });
  });
});
