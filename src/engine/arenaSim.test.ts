import { describe, expect, it } from 'vitest';

import { DISC_R, MOUTH_HALF, possessionOf, sampleAt, simulateArena } from './arenaSim.ts';
import { frameAt, scoreAt } from './animate.ts';
import type { SimulationInput } from './types.ts';

const input = (seed: number, pace: SimulationInput['pace'] = 'fast'): SimulationInput => ({ seed, home: 'Real Madrid', away: 'FC Barcelona', score: null, pace });
const seeds = Array.from({ length: 24 }, (_, i) => i * 101 + 7);

describe('Arena: simulación física libre', () => {
  it('es determinista por semilla y distinta entre semillas', () => {
    const a = simulateArena(input(3));
    const b = simulateArena(input(3));
    expect(a.script).toEqual(b.script);
    expect(Array.from(a.arena?.data ?? [])).toEqual(Array.from(b.arena?.data ?? []));
    expect(simulateArena(input(4)).arena?.data).not.toEqual(a.arena?.data);
  });

  it('el marcador sale del juego: coincide con los goles de los sucesos y con el del fotograma final; no se puede fijar', () => {
    for (const seed of seeds) {
      const sim = simulateArena({ ...input(seed), score: { home: 9, away: 9 } });
      const goals = sim.script.events.filter((e) => e.type === 'goal');
      expect(sim.script.score).toEqual({ home: goals.filter((g) => g.side === 'home').length, away: goals.filter((g) => g.side === 'away').length });
      expect(scoreAt(sim.script.events, sim.script.duration)).toEqual(sim.script.score);
      expect(sim.frame(sim.script.duration).score).toEqual(sim.script.score);
      expect(sim.script.scoreWasFixed).toBe(false);
    }
  });

  it('hay variedad de marcadores (no siempre el mismo) y goles en la mayoría de partidos', () => {
    const totals = seeds.map((s) => {
      const { score } = simulateArena(input(s)).script;
      return score.home + score.away;
    });
    expect(new Set(totals).size).toBeGreaterThanOrEqual(3);
    expect(totals.filter((t) => t > 0).length).toBeGreaterThan(seeds.length * 0.6);
    expect(Math.max(...totals)).toBeLessThanOrEqual(12);
  });

  it('escudos y balón permanecen dentro del aro; los escudos nunca se solapan durante el juego', () => {
    for (const seed of seeds.slice(0, 8)) {
      const sim = simulateArena(input(seed));
      if (sim.arena === undefined) throw new Error('sin pista');
      for (let t = 0; t <= sim.script.duration; t += 1 / 30) {
        const s = sampleAt(sim.arena, t);
        expect(Math.hypot(s.home.u, s.home.v)).toBeLessThanOrEqual(1);
        expect(Math.hypot(s.away.u, s.away.v)).toBeLessThanOrEqual(1);
        expect(Math.hypot(s.ball.u, s.ball.v)).toBeLessThanOrEqual(1 + 0.25); // sólo pasa de 1 dentro de la red de una portería
        const sep = Math.hypot(s.home.u - s.away.u, s.home.v - s.away.v);
        expect(sep).toBeGreaterThan(DISC_R * 1.9);
      }
    }
  });

  it('el movimiento es continuo: nada se teletransporta durante el juego', () => {
    for (const seed of seeds.slice(0, 6)) {
      const sim = simulateArena(input(seed));
      if (sim.arena === undefined) throw new Error('sin pista');
      let prev = sampleAt(sim.arena, 1.2);
      for (let t = 1.2 + 1 / 60; t < sim.script.duration - 2.4; t += 1 / 60) {
        const phase = frameAt(sim.script, t).phase;
        const s = sampleAt(sim.arena, t);
        if (phase !== 'halftime' && s.ball.alpha > 0.99 && prev.ball.alpha > 0.99) {
          expect(Math.hypot(s.ball.u - prev.ball.u, s.ball.v - prev.ball.v)).toBeLessThan(0.12); // < 7 u/s
        }
        if (phase !== 'halftime') {
          expect(Math.hypot(s.home.u - prev.home.u, s.home.v - prev.home.v)).toBeLessThan(0.08);
          expect(Math.hypot(s.away.u - prev.away.u, s.away.v - prev.away.v)).toBeLessThan(0.08);
        }
        prev = s;
      }
    }
  });

  it('hay choques con la pared y toques, y cada gol entra por la boca de una portería', () => {
    let walls = 0;
    let touches = 0;
    for (const seed of seeds.slice(0, 8)) {
      const sim = simulateArena(input(seed));
      walls += sim.arena?.wallHits.length ?? 0;
      touches += sim.arena?.touches.length ?? 0;
    }
    expect(walls).toBeGreaterThan(40);
    expect(touches).toBeGreaterThan(80);
    expect(MOUTH_HALF).toBeGreaterThan(DISC_R * 0.5);
  });

  it('tiros y paradas coherentes: a puerta nunca supera a tiros y los goles cuentan como tiros', () => {
    for (const seed of seeds) {
      const { stats, score } = simulateArena(input(seed)).script;
      expect(stats.home.shots).toBeGreaterThanOrEqual(score.home);
      expect(stats.away.shots).toBeGreaterThanOrEqual(score.away);
      expect(stats.home.onTarget).toBeGreaterThanOrEqual(score.home);
    }
  });

  it('el ritmo normal dura más que el rápido y el reloj va de 0 a más de 90', () => {
    const fast = simulateArena(input(5, 'fast')).script;
    const normal = simulateArena(input(5, 'normal')).script;
    expect(normal.duration).toBeGreaterThan(fast.duration);
    expect(fast.events.at(-1)?.clock).toBe('FIN');
    expect(fast.events[0]?.type).toBe('kickoff');
  });

  it('la posesión es continua y suma como mucho 1', () => {
    const sim = simulateArena(input(9));
    if (sim.arena === undefined) throw new Error('sin pista');
    for (let t = 0; t < sim.script.duration; t += 0.5) {
      const p = possessionOf(sim.arena, t);
      expect(p.home + p.away).toBeLessThanOrEqual(1.0001);
    }
  });

  it('el nivel de rebotes cambia la física (choques más fuertes con «high»)', () => {
    const power = (level: 'off' | 'high'): number => {
      const hits = seeds.slice(0, 6).flatMap((s) => simulateArena(input(s), level).arena?.wallHits ?? []);
      return hits.reduce((n, h) => n + h.power, 0) / Math.max(1, hits.length);
    };
    expect(power('high')).toBeGreaterThan(power('off'));
  });

  it('rechaza semillas no enteras', () => {
    expect(() => simulateArena({ ...input(1), seed: 1.5 })).toThrow(RangeError);
  });
});
