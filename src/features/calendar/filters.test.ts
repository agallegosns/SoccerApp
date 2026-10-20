import { describe, expect, it } from 'vitest';

import type { Match } from '../../data/types.ts';
import { DEFAULT_FILTERS, filterMatches, groupByDate } from './filters.ts';

function m(id: string, date: string, time: string | null, home: string, away: string, extra: Partial<Match> = {}): Match {
  return { id, leagueId: 'l', competition: 'L', round: 'Jornada 1', date, time, timeKind: 'league-local', home, away, realScore: null, ...extra };
}

const list: Match[] = [
  m('1', '2026-10-18', '21:00', 'Real Madrid CF', 'FC Barcelona', { realScore: { home: 2, away: 1 } }),
  m('2', '2026-10-20', '18:00', 'Atlético de Madrid', 'Sevilla FC'),
  m('3', '2026-10-20', null, 'Valencia CF', 'Getafe CF'),
  m('4', '2026-10-25', '16:15', 'Girona FC', 'Real Betis'),
];
const today = '2026-10-20';

describe('filterMatches', () => {
  it('por defecto muestra desde hoy en orden ascendente, con los partidos sin hora al final del día', () => {
    expect(filterMatches(list, DEFAULT_FILTERS, today).map((x) => x.id)).toEqual(['2', '3', '4']);
  });
  it('«jugados» va del más reciente al más antiguo', () => {
    expect(filterMatches(list, { ...DEFAULT_FILTERS, scope: 'played' }, today).map((x) => x.id)).toEqual(['1']);
  });
  it('«todos» incluye todo', () => {
    expect(filterMatches(list, { ...DEFAULT_FILTERS, scope: 'all' }, today)).toHaveLength(4);
  });
  it('busca por equipo ignorando mayúsculas y acentos', () => {
    expect(filterMatches(list, { ...DEFAULT_FILTERS, scope: 'all', query: 'atletico' }, today).map((x) => x.id)).toEqual(['2']);
  });
  it('filtra por rango de fechas inclusivo', () => {
    const f = { ...DEFAULT_FILTERS, scope: 'all' as const, from: '2026-10-20', to: '2026-10-20' };
    expect(filterMatches(list, f, today).map((x) => x.id)).toEqual(['2', '3']);
  });
  it('usa la fecha convertida para horarios UTC', () => {
    const utc = m('5', '2026-10-20', '23:30', 'A', 'B', { timeKind: 'utc' });
    expect(filterMatches([utc], { ...DEFAULT_FILTERS, scope: 'all', from: '2026-10-21' }, today, 'Asia/Tokyo')).toHaveLength(1);
    expect(filterMatches([utc], { ...DEFAULT_FILTERS, scope: 'all', from: '2026-10-21' }, today, 'UTC')).toHaveLength(0);
  });
});

describe('groupByDate', () => {
  it('agrupa partidos consecutivos del mismo día', () => {
    const groups = groupByDate(filterMatches(list, DEFAULT_FILTERS, today));
    expect(groups.map((g) => [g.date, g.matches.length])).toEqual([['2026-10-20', 2], ['2026-10-25', 1]]);
  });
});
