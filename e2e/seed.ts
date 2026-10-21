import type { Page } from '@playwright/test';

import { simulateArena } from '../src/engine/index.ts';

const PREFIX = 'futbol-sim:v1:';

export const SEED_MATCH = {
  id: 'prueba-1',
  leagueId: 'es.1',
  competition: 'LaLiga 2026-27',
  round: 'Jornada 8',
  date: '2026-10-24',
  time: '12:30',
  timeKind: 'league-local',
  home: 'Athletic Club',
  away: 'Valencia CF',
  realScore: null,
} as const;

/** Ficha de prueba con el marcador REAL de la simulación de esa semilla (si no coincidiera, la ficha avisaría de que el simulador cambió). */
export const seedVideo = (seed: number) => ({
  match: SEED_MATCH,
  seed,
  style: 'arena',
  pace: 'fast',
  fixedScore: null,
  score: simulateArena({ seed, home: SEED_MATCH.home, away: SEED_MATCH.away, score: null, pace: 'fast' }, 'normal').script.score,
  options: { theme: 'noche', bounce: 'normal', showStats: true, showTicker: true, ballTrail: true, hook: '', watermark: '', goalText: '¡GOL!' },
  fileName: `laliga-2026-27_athletic-club_vs_valencia-cf_2026-10-24_${String(seed)}.mp4`,
  bytes: 2_500_000,
  durationSeconds: 26,
  createdAt: Date.parse('2026-10-20T10:00:00Z') + seed,
});

export const seedPublication = {
  platform: 'tiktok',
  url: 'https://www.tiktok.com/@ejemplo/video/111',
  title: 'Athletic vs Valencia (simulación)',
  publishedAt: '2026-10-10',
  videoId: null,
  measurements: [
    { date: '2026-10-11', views: 1200, likes: 85, comments: 6, shares: 9, saves: 14, reach: null },
    { date: '2026-10-14', views: 5400, likes: 310, comments: 22, shares: 41, saves: 60, reach: null },
  ],
};

/** Deja datos en el navegador antes de que cargue la página (sólo la primera vez, para que sobrevivan a recargas sin pisar cambios). */
export async function seedStorage(page: Page, data: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ([prefix, entries]) => {
      for (const [key, value] of Object.entries(entries)) {
        if (localStorage.getItem(prefix + key) === null) localStorage.setItem(prefix + key, JSON.stringify(value));
      }
    },
    [PREFIX, data] as const,
  );
}
