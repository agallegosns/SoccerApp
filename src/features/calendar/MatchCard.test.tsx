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
  it('sin descarga no es verde ni dice «Descargado»', () => {
    const html = renderToStaticMarkup(<MatchCard match={match} selected={false} downloaded={false} onSelect={() => undefined} />);
    expect(html).not.toContain('match--downloaded');
    expect(html).not.toContain('Descargado');
  });

  it('con descarga es verde y lo dice con texto (no sólo con color)', () => {
    const html = renderToStaticMarkup(<MatchCard match={match} selected={false} downloaded onSelect={() => undefined} />);
    expect(html).toContain('match--downloaded');
    expect(html).toContain('Descargado');
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
