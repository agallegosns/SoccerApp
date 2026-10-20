import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { MatchCache, type KeyValueStore } from './cache.ts';
import { formatDateEs, kickoffOf, slug, todayLocal } from './dates.ts';
import { fetchTextWithRetry } from './fetchWithRetry.ts';
import { ImportedProvider } from './imported.ts';
import { MatchService } from './registry.ts';
import {
  parseFixtureDownload,
  parseFootballDataOrg,
  parseFootballTxt,
  parseImportedCalendar,
  parseOpenFootballJson,
} from './parsers.ts';
import { DataError, type League, type Match, type MatchProvider } from './types.ts';

const read = (name: string): string => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const ctx = { leagueId: 'test:liga', competition: 'Liga de prueba' };

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('dates', () => {
  it('todayLocal formatea YYYY-MM-DD', () => {
    expect(todayLocal(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
  });
  it('formatDateEs escribe la fecha en español', () => {
    expect(formatDateEs('2026-08-15')).toBe('sábado, 15 de agosto de 2026');
  });
  it('slug elimina acentos y símbolos', () => {
    expect(slug('Atlético de Madrid, FC!')).toBe('atletico-de-madrid-fc');
  });
  it('league-local no se convierte', () => {
    expect(kickoffOf({ date: '2026-08-15', time: '19:30', timeKind: 'league-local' }, 'Asia/Tokyo')).toEqual({
      date: '2026-08-15',
      time: '19:30',
      converted: false,
    });
  });
  it('utc se convierte a la zona dada, incluso cambiando de día', () => {
    expect(kickoffOf({ date: '2026-09-08', time: '19:00', timeKind: 'utc' }, 'Europe/Madrid')).toEqual({
      date: '2026-09-08',
      time: '21:00',
      converted: true,
    });
    expect(kickoffOf({ date: '2026-09-08', time: '23:30', timeKind: 'utc' }, 'Asia/Tokyo').date).toBe('2026-09-09');
  });
});

describe('openfootball JSON (datos reales de 2026-27)', () => {
  const matches = parseOpenFootballJson(JSON.parse(read('es1.sample.json')) as unknown, ctx);

  it('lee todos los partidos con id único', () => {
    expect(matches).toHaveLength(12);
    expect(new Set(matches.map((m) => m.id)).size).toBe(12);
  });
  it('lee resultados reales cuando existen y null cuando no', () => {
    expect(matches.find((m) => m.home === 'Deportivo Alavés')?.realScore).toEqual({ home: 3, away: 0 });
    expect(matches.filter((m) => m.realScore === null).length).toBeGreaterThan(0);
  });
  it('admite partidos sin hora', () => {
    expect(matches.some((m) => m.time === null)).toBe(true);
  });
  it('rechaza formatos inválidos', () => {
    expect(() => parseOpenFootballJson({ foo: 1 }, ctx)).toThrow(DataError);
    expect(() => parseOpenFootballJson({ matches: [] }, ctx)).toThrow(DataError);
  });
});

describe('Football.TXT de la Champions League 2025-26 (datos reales)', () => {
  const matches = parseFootballTxt(read('cl-2025-26.sample.txt'), { leagueId: 'cl', competition: 'Champions League' });

  it('lee los partidos y hereda la hora dentro del día', () => {
    const first = matches[0];
    expect(first?.date).toBe('2025-09-16');
    expect(first?.home).toBe('Athletic Club');
    expect(first?.away).toBe('Arsenal FC');
    expect(first?.time).toBe('18:45');
    expect(first?.realScore).toEqual({ home: 0, away: 2 });
    const psv = matches.find((m) => m.home === 'PSV');
    expect(psv?.time).toBe('18:45');
    const juve = matches.find((m) => m.home === 'Juventus FC' && m.date === '2025-09-16');
    expect(juve?.time).toBe('21:00');
  });
  it('avanza el año al pasar de diciembre a enero/febrero', () => {
    expect(matches.find((m) => m.home === 'Club Atlético de Madrid' && m.away === 'Club Brugge KV')?.date).toBe('2026-02-24');
  });
  it('interpreta prórroga y penaltis', () => {
    expect(matches.find((m) => m.home === 'Juventus FC' && m.date === '2026-02-25')?.realScore).toEqual({
      home: 3,
      away: 2,
      note: 'Tras prórroga',
    });
    expect(matches.find((m) => m.home === 'Paris Saint-Germain FC' && m.away === 'Arsenal FC')?.realScore).toEqual({
      home: 1,
      away: 1,
      note: 'Tras prórroga; penaltis 4-3',
    });
  });
  it('quita el código de país y traduce las rondas', () => {
    expect(matches.every((m) => !/\([A-Z]{3}\)/.test(m.home + m.away))).toBe(true);
    expect(matches.some((m) => m.round === 'Fase de liga · Jornada 1')).toBe(true);
    expect(matches.some((m) => m.round === 'Fase final · Final')).toBe(true);
  });
  it('lee partidos sin marcador como no jugados', () => {
    const text = '= X\n▪ League, Matchday 1\n  Tue Sep 8 2026\n    21:00  Real Madrid CF (ESP)    v FC Barcelona (ESP)\n';
    const [m] = parseFootballTxt(text, ctx);
    expect(m?.away).toBe('FC Barcelona');
    expect(m?.realScore).toBeNull();
  });
});

describe('formatos importables (construidos según la documentación; pendiente de probar con archivos reales)', () => {
  const fd = {
    competition: { name: 'UEFA Champions League' },
    matches: [
      {
        utcDate: '2026-09-15T19:00:00Z',
        stage: 'LEAGUE_STAGE',
        matchday: 1,
        homeTeam: { name: 'Real Madrid CF' },
        awayTeam: { name: 'FC Barcelona' },
        score: { fullTime: { home: null, away: null } },
      },
      {
        utcDate: '2026-09-15T21:00:00Z',
        stage: 'LEAGUE_STAGE',
        matchday: 1,
        homeTeam: { name: 'Arsenal FC' },
        awayTeam: { name: 'Bayern München' },
        score: { fullTime: { home: 2, away: 1 } },
      },
      { utcDate: '2027-05-30T19:00:00Z', stage: 'FINAL', homeTeam: { name: null }, awayTeam: { name: null } },
    ],
  };
  const fx = [
    { MatchNumber: 1, RoundNumber: 1, DateUtc: '2026-09-15 19:00:00Z', HomeTeam: 'Real Madrid', AwayTeam: 'Barcelona', HomeTeamScore: null, AwayTeamScore: null },
    { MatchNumber: 2, RoundNumber: 1, DateUtc: '2026-09-15 21:00:00Z', HomeTeam: 'Arsenal', AwayTeam: 'Bayern', HomeTeamScore: 3, AwayTeamScore: 3 },
  ];

  it('football-data.org: UTC, jornada traducida, ignora eliminatorias sin equipos', () => {
    const m = parseFootballDataOrg(fd, ctx);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ date: '2026-09-15', time: '19:00', timeKind: 'utc', round: 'Fase de liga · Jornada 1', realScore: null });
    expect(m[1]?.realScore).toEqual({ home: 2, away: 1 });
  });
  it('fixturedownload: UTC y marcadores', () => {
    const m = parseFixtureDownload(fx, ctx);
    expect(m).toHaveLength(2);
    expect(m[1]).toMatchObject({ time: '21:00', timeKind: 'utc', realScore: { home: 3, away: 3 } });
  });
  it('autodetecta el formato', () => {
    expect(parseImportedCalendar(JSON.stringify(fd), ctx).format).toBe('football-data-org');
    expect(parseImportedCalendar(JSON.stringify(fx), ctx).format).toBe('fixturedownload');
    expect(parseImportedCalendar(read('es1.sample.json'), ctx).format).toBe('openfootball-json');
    expect(parseImportedCalendar(read('cl-2025-26.sample.txt'), ctx).format).toBe('football-txt');
  });
  it('da errores claros', () => {
    expect(() => parseImportedCalendar('', ctx)).toThrow(/vacío/);
    expect(() => parseImportedCalendar('{no json', ctx)).toThrow(/JSON válido/);
    expect(() => parseImportedCalendar('{"a":1}', ctx)).toThrow(DataError);
  });
});

describe('fetchTextWithRetry', () => {
  const noSleep = (): Promise<void> => Promise.resolve();
  const ok = (body: string): Response => new Response(body, { status: 200 });

  it('reintenta tras un fallo de red y acaba devolviendo el cuerpo', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('red caída')).mockResolvedValueOnce(ok('hola'));
    await expect(fetchTextWithRetry('https://x', { fetchImpl, sleep: noSleep })).resolves.toBe('hola');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('reintenta en 5xx, con espera creciente', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(ok('ok'));
    await expect(fetchTextWithRetry('https://x', { fetchImpl, sleep, baseDelayMs: 100 })).resolves.toBe('ok');
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });
  it('no reintenta un 404 y lo clasifica', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    await expect(fetchTextWithRetry('https://x', { fetchImpl, sleep: noSleep })).rejects.toMatchObject({ kind: 'not-found' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('agota los reintentos y devuelve un error de red', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('red caída'));
    await expect(fetchTextWithRetry('https://x', { fetchImpl, sleep: noSleep, retries: 2 })).rejects.toMatchObject({ kind: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('respeta la cancelación', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(fetchTextWithRetry('https://x', { fetchImpl, signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('MatchService: caché y degradación', () => {
  const league: League = { id: 'p:l', providerId: 'p', name: 'L', country: 'C', season: '2026-27', timeNote: '' };
  const sample: Match = {
    id: 'a', leagueId: 'p:l', competition: 'L', round: 'R', date: '2026-10-01', time: '20:00', timeKind: 'league-local', home: 'A', away: 'B', realScore: null,
  };
  function provider(load: MatchProvider['loadMatches']): MatchProvider {
    return { id: 'p', label: 'P', listLeagues: () => [league], loadMatches: load };
  }

  it('usa la caché en memoria mientras es reciente', async () => {
    const load = vi.fn(() => Promise.resolve([sample]));
    const service = new MatchService([provider(load)], new MatchCache(memoryStore()));
    await service.load('p:l');
    const again = await service.load('p:l');
    expect(load).toHaveBeenCalledTimes(1);
    expect(again.stale).toBe(false);
  });
  it('si la red falla muestra la copia guardada y lo indica', async () => {
    const store = memoryStore();
    let t = 0;
    const cache = new MatchCache(store, () => t);
    const good = new MatchService([provider(() => Promise.resolve([sample]))], cache);
    await good.load('p:l');
    t = 60 * 60 * 1000;
    const failing = new MatchService([provider(() => Promise.reject(new DataError('network', 'sin red')))], new MatchCache(store, () => t));
    const result = await failing.load('p:l');
    expect(result.stale).toBe(true);
    expect(result.matches).toEqual([sample]);
  });
  it('sin copia guardada propaga el error', async () => {
    const service = new MatchService([provider(() => Promise.reject(new DataError('network', 'sin red')))], new MatchCache(memoryStore()));
    await expect(service.load('p:l')).rejects.toMatchObject({ kind: 'network' });
  });
  it('la cancelación no cae en la caché', async () => {
    const store = memoryStore();
    const cache = new MatchCache(store);
    cache.set('p:l', [sample]);
    const service = new MatchService([provider(() => Promise.reject(new DataError('aborted', 'x')))], cache);
    await expect(service.load('p:l', { force: true })).rejects.toMatchObject({ kind: 'aborted' });
  });
  it('una caché corrupta se ignora', () => {
    const store = memoryStore();
    store.setItem('futbol-sim:v1:p:l', '{no json');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(new MatchCache(store).getStale('p:l')).toBeNull();
  });
});

/** Calendarios realmente importados (sin las ranuras «preparadas» a la espera de archivo). */
const importedOnly = (p: ImportedProvider): string[] => p.listLeagues().filter((l) => l.awaitingImport !== true).map((l) => l.id);

describe('ImportedProvider', () => {
  it('importa, persiste y recarga un calendario', async () => {
    const store = memoryStore();
    const provider = new ImportedProvider(store);
    const league = provider.importCalendar({ name: 'Champions League', season: '2026-27', content: read('es1.sample.json') });
    expect(league.id).toBe('imported:champions-league:2026-27');
    const reloaded = new ImportedProvider(store);
    expect(importedOnly(reloaded)).toEqual([league.id]);
    expect((await reloaded.loadMatches(league.id)).length).toBe(12);
    reloaded.removeCalendar(league.id);
    expect(importedOnly(new ImportedProvider(store))).toEqual([]);
  });
  it('no cambia el estado si el archivo no vale', () => {
    const provider = new ImportedProvider(memoryStore());
    expect(() => provider.importCalendar({ name: 'X', season: '1', content: '{"a":1}' })).toThrow(DataError);
    expect(importedOnly(provider)).toEqual([]);
  });
  it('avisa si el almacenamiento está lleno y no guarda a medias', () => {
    const full: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => undefined };
    const provider = new ImportedProvider(full);
    expect(() => provider.importCalendar({ name: 'X', season: '1', content: read('es1.sample.json') })).toThrow(/almacenamiento/i);
    expect(importedOnly(provider)).toEqual([]);
  });
});
