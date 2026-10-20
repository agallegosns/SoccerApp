import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Match } from '../../data/types.ts';
import { leagueBadge } from './leagueBadge.ts';
import { MatchCard } from './MatchCard.tsx';

const match: Match = {
  id: 'm1', leagueId: 'l', competition: 'LaLiga 2026-27', round: 'Jornada 3', date: '2026-10-01', time: '20:00', timeKind: 'league-local',
  home: 'Real Madrid', away: 'FC Barcelona', realScore: null,
};

describe('tarjeta de partido', () => {
  it('sin marcar no es verde ni dice «Hecho»', () => {
    const html = renderToStaticMarkup(<MatchCard match={match} selected={false} done={false} onSelect={() => undefined} onToggleDone={() => undefined} />);
    expect(html).not.toContain('match--downloaded');
    expect(html).not.toContain('Hecho');
  });

  it('hecho es verde y lo dice con texto (no sólo con color)', () => {
    const html = renderToStaticMarkup(<MatchCard match={match} selected={false} done onSelect={() => undefined} onToggleDone={() => undefined} />);
    expect(html).toContain('match--downloaded');
    expect(html).toContain('Hecho');
  });
});

describe('marca manual', () => {
  it('tiene su propio botón con nombre accesible y estado', () => {
    const html = renderToStaticMarkup(<MatchCard match={match} selected={false} done onSelect={() => undefined} onToggleDone={() => undefined} />);
    expect(html).toContain('aria-label="Marcar Real Madrid contra FC Barcelona como hecho"');
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="Marcar/);
  });
});

describe('insignia de competición', () => {
  it.each([
    ['LaLiga', 'LL'],
    ['Champions League', 'UCL'],
    ['Europa League', 'UEL'],
    ['Conference League', 'UECL'],
    ['Premier League', 'PL'],
    ['Copa de prueba', 'CDP'],
  ])('%s → %s', (name, badge) => {
    expect(leagueBadge(name)).toBe(badge);
  });
});
