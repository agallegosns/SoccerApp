import { describe, expect, it } from 'vitest';
import type { Match } from '../../data/types.ts';
import type { Publication } from '../stats/model.ts';
import { MIN_POSTS_TOTAL, analyseBestSlot, descriptionFor, hashtagsFor, recommendTime } from './publish.ts';
import type { VideoRecord } from './model.ts';

const match: Match = { id: 'm1', leagueId: 'l', competition: 'La Liga 2026-27', round: 'Jornada 10', date: '2026-11-01', time: '21:00', timeKind: 'league-local', home: 'FC Barcelona', away: 'Real Madrid', realScore: null };
const record = { match, score: { home: 2, away: 1 } } as unknown as VideoRecord;

function pub(i: number, hour: number, views: number, withHour = true): Publication {
  const iso = new Date(2026, 9, 1 + (i % 20), hour, 0, 0).toISOString();
  return { id: `p${String(i)}`, platform: 'tiktok', url: `https://www.tiktok.com/@a/video/${String(i)}`, title: 't', publishedAt: iso.slice(0, 10), ...(withHour ? { publishedAtIso: iso } : {}), videoId: null, measurements: [{ date: '2026-10-30', views, likes: 0, comments: 0, shares: 0, saves: 0, reach: null }] };
}

describe('hashtags y descripción', () => {
  it('cinco hashtags únicos por plataforma, con equipos y competición', () => {
    for (const platform of ['tiktok', 'instagram'] as const) {
      const tags = hashtagsFor(match, platform);
      expect(tags).toHaveLength(5);
      expect(new Set(tags.map((t) => t.toLowerCase())).size).toBe(5);
      expect(tags).toContain('#FCBarcelona');
      expect(tags).toContain('#RealMadrid');
    }
  });
  it('la descripción es «Local vs Visitante» con iconos y los 5 hashtags, sin marcador, y es determinista', () => {
    const a = descriptionFor(record, 'tiktok');
    expect(a).toBe(descriptionFor(record, 'tiktok'));
    const [title, blank, tags] = a.split('\n');
    expect(title).toContain('FC Barcelona vs Real Madrid');
    expect(title).toMatch(/\p{Extended_Pictographic}/u);
    expect(blank).toBe('');
    expect(tags?.split(' ')).toHaveLength(5);
    expect(a).not.toMatch(/2–1|ficticia|predicci/);
    expect(descriptionFor(record, 'tiktok', 0)).not.toBe(descriptionFor(record, 'tiktok', 1));
  });
});

describe('hora recomendada', () => {
  it('sin datos suficientes es orientativa (franja previa al partido) y lo dice', () => {
    const r = recommendTime(match, [], 'tiktok');
    expect(r.kind).toBe('orientative');
    expect(r.headline).toContain('19:00–20:30');
    expect(r.detail).toContain('no garantiza');
  });
  it('sin hora de partido ni datos no inventa nada', () => {
    expect(recommendTime({ ...match, time: null }, [], 'tiktok').headline).toBe('Sin recomendación todavía');
  });
  it('con datos suficientes elige la franja con mayor mediana y exige muestra mínima', () => {
    const few = Array.from({ length: MIN_POSTS_TOTAL - 1 }, (_, i) => pub(i, 20, 100));
    expect(analyseBestSlot(few)).toBeNull();
    const many = [...Array.from({ length: 4 }, (_, i) => pub(i, 20, 5000)), ...Array.from({ length: 4 }, (_, i) => pub(i + 10, 9, 300))];
    const best = analyseBestSlot(many);
    expect(best?.slot.id).toBe('evening');
    expect(recommendTime(match, many, 'tiktok').kind).toBe('data');
  });
  it('ignora publicaciones sin hora o demasiado recientes', () => {
    const recent = Array.from({ length: 10 }, (_, i) => ({ ...pub(i, 20, 100), publishedAtIso: '2026-10-30T10:00:00.000Z' }));
    expect(analyseBestSlot(recent)).toBeNull();
    const noHour = Array.from({ length: 10 }, (_, i) => pub(i, 20, 100, false));
    expect(analyseBestSlot(noHour)).toBeNull();
  });
});
