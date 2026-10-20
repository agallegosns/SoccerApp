import { describe, expect, it } from 'vitest';

import { frameAt, scoreAt, statsAt } from './animate.ts';
import { FORMATIONS } from './formations.ts';
import { PITCH_L, PITCH_W, dist } from './geometry.ts';
import { simulate } from './index.ts';
import { Rng, mulberry32 } from './rng.ts';
import { generateScript } from './script.ts';
import { abbreviation, shortName, teamStyles } from './style.ts';
import type { MatchScript, Score, SimulationInput } from './types.ts';

// Las pruebas del motor usan el ritmo `normal` (el original); el ritmo rápido se prueba aparte, con los mismos sucesos.
const base = (seed: number, score: Score | null = null): SimulationInput => ({ seed, home: 'Real Madrid', away: 'FC Barcelona', score, pace: 'normal' });
const seeds = Array.from({ length: 60 }, (_, i) => i * 7919 + 3);

describe('PRNG', () => {
  it('mulberry32 es determinista y está en [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBeGreaterThan(990);
  });
  it('semillas distintas dan secuencias distintas', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it('int/pick/weighted/shuffle respetan rangos y no pierden elementos', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 500; i += 1) {
      const n = rng.int(3, 6);
      expect(n >= 3 && n <= 6).toBe(true);
    }
    expect(rng.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(rng.weighted([['a', 0], ['b', 1]])).toBe('b');
    expect(() => rng.pick([])).toThrow();
  });
});

describe('estilos de equipo', () => {
  it('abreviaturas y nombres cortos', () => {
    expect(abbreviation('Real Madrid CF')).toBe('RMA');
    expect(abbreviation('FC Barcelona')).toBe('BAR');
    expect(abbreviation('Atlético Madrid')).toBe('AMA');
    expect(shortName('Real Betis Balompié')).toBe('Real Betis Balompié');
    expect(shortName('FC Barcelona')).toBe('Barcelona');
  });
  it('los colores de local y visitante son distintos y el estilo es estable', () => {
    const a = teamStyles('Real Madrid', 'FC Barcelona');
    expect(a.home.primary).not.toBe(a.away.primary);
    expect(a).toEqual(teamStyles('Real Madrid', 'FC Barcelona'));
    expect(a.home.keeper).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('formaciones', () => {
  it('todas tienen 11 puestos, 1 portero y puestos dentro del campo', () => {
    for (const slots of Object.values(FORMATIONS)) {
      expect(slots).toHaveLength(11);
      expect(slots.filter((s) => s.role === 'GK')).toHaveLength(1);
      expect(slots.every((s) => s.l >= 0 && s.l <= 1 && s.d >= 0 && s.d <= 1)).toBe(true);
    }
  });
});

describe('determinismo por semilla', () => {
  it('misma entrada ⇒ mismo guion y mismos fotogramas', () => {
    const a = generateScript(base(1234));
    const b = generateScript(base(1234));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const t of [0, 3.3, 10.1, 25, a.duration]) expect(frameAt(a, t)).toEqual(frameAt(b, t));
  });
  it('semillas distintas ⇒ simulaciones distintas del mismo partido (mismo marcador fijado)', () => {
    const signatures = new Set(
      seeds.slice(0, 30).map((seed) => {
        const s = generateScript(base(seed, { home: 2, away: 1 }));
        return s.events.map((e) => `${e.type}${e.side ?? ''}${e.minute.toFixed(1)}`).join('|');
      }),
    );
    expect(signatures.size).toBe(30);
  });
  it('el mismo marcador con semillas distintas cambia minutos, equipos que atacan y formaciones', () => {
    const scripts = seeds.slice(0, 20).map((seed) => generateScript(base(seed, { home: 1, away: 1 })));
    expect(new Set(scripts.map((s) => s.teams.home.formation)).size).toBeGreaterThan(1);
    expect(new Set(scripts.map((s) => s.events.find((e) => e.type === 'goal')?.minute.toFixed(0))).size).toBeGreaterThan(5);
  });
  it('la misma semilla en otro partido da otra simulación', () => {
    const a = generateScript({ seed: 5, home: 'A', away: 'B', score: { home: 1, away: 0 } });
    const b = generateScript({ seed: 5, home: 'C', away: 'D', score: { home: 1, away: 0 } });
    expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(b.events));
  });
});

describe('coherencia entre marcador y guion', () => {
  const scores: Score[] = [{ home: 0, away: 0 }, { home: 1, away: 0 }, { home: 0, away: 3 }, { home: 2, away: 2 }, { home: 5, away: 4 }, { home: 9, away: 9 }];

  it.each(scores)('marcador fijado %o: exactamente esos goles, de cada equipo, en todas las semillas', (score) => {
    for (const seed of seeds.slice(0, 25)) {
      const s = generateScript(base(seed, score));
      const goals = s.events.filter((e) => e.type === 'goal');
      expect(goals.filter((e) => e.side === 'home')).toHaveLength(score.home);
      expect(goals.filter((e) => e.side === 'away')).toHaveLength(score.away);
      expect(s.score).toEqual(score);
      expect(s.scoreWasFixed).toBe(true);
      expect(frameAt(s, s.duration).score).toEqual(score);
    }
  });

  it('marcador aleatorio: lo decide la semilla, es coherente con los goles y su media es plausible', () => {
    let total = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const s = generateScript(base(seed));
      const goals = s.events.filter((e) => e.type === 'goal');
      expect(goals.length).toBe(s.score.home + s.score.away);
      expect(s.scoreWasFixed).toBe(false);
      total += goals.length;
    }
    const mean = total / 200;
    expect(mean).toBeGreaterThan(1.8);
    expect(mean).toBeLessThan(3.6);
  });

  it('cada gol ocurre dentro de una fase de ataque con resultado «gol» del mismo equipo', () => {
    for (const seed of seeds.slice(0, 20)) {
      const s = generateScript(base(seed, { home: 3, away: 2 }));
      for (const g of s.events.filter((e) => e.type === 'goal')) {
        const phase = s.phases.find((p) => p.kind === 'attack' && g.t >= p.t0 - 1e-9 && g.t <= p.t1 + 1e-9);
        expect(phase?.outcome).toBe('goal');
        expect(phase?.side).toBe(g.side);
      }
      expect(s.phases.filter((p) => p.outcome === 'goal')).toHaveLength(5);
    }
  });

  it('el marcador del fotograma sólo cambia en los goles y en orden', () => {
    const s = generateScript(base(99, { home: 2, away: 3 }));
    let prev = { home: 0, away: 0 };
    for (let t = 0; t <= s.duration; t += 0.05) {
      const now = frameAt(s, t).score;
      expect(now).toEqual(scoreAt(s.events, t));
      expect(now.home >= prev.home && now.away >= prev.away && now.home + now.away - prev.home - prev.away <= 1).toBe(true);
      prev = now;
    }
  });

  it('un equipo que no marca igualmente tiene ocasiones (≥ 2 disparos) y los dos equipos acaban con disparos', () => {
    for (const seed of seeds) {
      const s = generateScript(base(seed, { home: 0, away: 0 }));
      expect(s.stats.home.shots).toBeGreaterThanOrEqual(2);
      expect(s.stats.away.shots).toBeGreaterThanOrEqual(2);
      expect(s.events.some((e) => e.type === 'goal')).toBe(false);
    }
  });

  it('los disparos a puerta incluyen todos los goles', () => {
    const s = generateScript(base(31, { home: 4, away: 1 }));
    expect(s.stats.home.onTarget).toBeGreaterThanOrEqual(4);
    expect(s.stats.home.shots).toBeGreaterThanOrEqual(s.stats.home.onTarget);
  });

  it('las estadísticas acumuladas crecen con el tiempo y al final coinciden con las del guion', () => {
    for (const seed of seeds.slice(0, 15)) {
      const s = generateScript(base(seed, { home: 2, away: 1 }));
      expect(statsAt(s.events, s.duration)).toEqual(s.stats);
      let prev = statsAt(s.events, 0);
      for (let t = 0; t <= s.duration; t += 1) {
        const now = statsAt(s.events, t);
        for (const side of ['home', 'away'] as const) {
          for (const key of ['shots', 'onTarget', 'corners', 'fouls'] as const) expect(now[side][key]).toBeGreaterThanOrEqual(prev[side][key]);
        }
        prev = now;
      }
    }
  });

  it('rechaza entradas inválidas', () => {
    expect(() => generateScript(base(1.5))).toThrow(RangeError);
    expect(() => generateScript(base(1, { home: 10, away: 0 }))).toThrow(RangeError);
    expect(() => generateScript(base(1, { home: -1, away: 0 }))).toThrow(RangeError);
    expect(() => generateScript(base(1, { home: 0.5, away: 0 }))).toThrow(RangeError);
  });
});

describe('eventos ordenados y minutos plausibles', () => {
  const scripts: MatchScript[] = seeds.slice(0, 30).map((seed, i) => generateScript(base(seed, { home: i % 5, away: (i * 2) % 4 })));

  it('los eventos están ordenados por tiempo y, dentro de cada parte, por minuto; todos dentro de la duración', () => {
    for (const s of scripts) {
      for (let i = 1; i < s.events.length; i += 1) {
        const a = s.events[i - 1];
        const b = s.events[i];
        expect(b === undefined || a === undefined || b.t >= a.t).toBe(true);
      }
      // El descanso pertenece a la primera parte.
      for (const part of [s.events.filter((e) => e.t <= s.halftimeMid), s.events.filter((e) => e.t > s.halftimeMid)]) {
        for (let i = 1; i < part.length; i += 1) expect(part[i]?.minute ?? 0).toBeGreaterThanOrEqual((part[i - 1]?.minute ?? 0) - 1e-9);
      }
      expect(s.events.every((e) => e.t >= 0 && e.t <= s.duration)).toBe(true);
    }
  });

  it('empieza con saque inicial, hay descanso entre las dos partes y termina con el final', () => {
    for (const s of scripts) {
      const types = s.events.map((e) => e.type);
      expect(types.filter((x) => x === 'kickoff')).toHaveLength(2);
      expect(types.filter((x) => x === 'halftime')).toHaveLength(1);
      expect(types.at(-1)).toBe('fulltime');
      const ht = s.events.find((e) => e.type === 'halftime');
      const second = s.events.filter((e) => e.type === 'kickoff')[1];
      expect(ht !== undefined && second !== undefined && ht.t < second.t).toBe(true);
    }
  });

  it('los minutos de los goles están entre 1 y 100 y la etiqueta usa el formato 45+n / 90+n', () => {
    for (const s of scripts) {
      for (const g of s.events.filter((e) => e.type === 'goal')) {
        expect(g.minute).toBeGreaterThan(1);
        expect(g.minute).toBeLessThan(100);
        expect(g.clock).toMatch(/^(\d{1,2}|45\+\d|90\+\d)'$/);
      }
    }
  });

  it('los goles están repartidos a lo largo del partido (no concentrados en un minuto)', () => {
    const minutes = Array.from({ length: 80 }, (_, i) => generateScript(base(i + 1000, { home: 1, away: 0 })).events.find((e) => e.type === 'goal')?.minute ?? 0);
    const mean = minutes.reduce((a, b) => a + b, 0) / minutes.length;
    expect(mean).toBeGreaterThan(30);
    expect(mean).toBeLessThan(65);
    expect(Math.min(...minutes)).toBeLessThan(20);
    expect(Math.max(...minutes)).toBeGreaterThan(70);
  });

  it('las fases son contiguas y cubren todo el vídeo', () => {
    for (const s of scripts) {
      expect(s.phases[0]?.t0).toBe(0);
      expect(s.phases[0]?.kind).toBe('intro');
      expect(s.phases.at(-1)?.kind).toBe('fulltime');
      for (let i = 1; i < s.phases.length; i += 1) {
        expect(s.phases[i]?.t0).toBeCloseTo(s.phases[i - 1]?.t1 ?? NaN, 9);
      }
      expect(s.phases.at(-1)?.t1).toBeCloseTo(s.duration, 9);
    }
  });

  it('la duración del vídeo es razonable para TikTok (30–100 s con hasta 6 goles)', () => {
    for (const s of scripts) {
      expect(s.duration).toBeGreaterThan(30);
      expect(s.duration).toBeLessThan(100);
    }
  });
});

describe('animación', () => {
  const s = generateScript(base(2024, { home: 2, away: 1 }));

  it('en cada fotograma hay 22 jugadores distintos dentro del campo y un balón finito', () => {
    for (let t = 0; t <= s.duration; t += 0.37) {
      const f = frameAt(s, t);
      expect(f.players).toHaveLength(22);
      expect(new Set(f.players.map((p) => p.index)).size).toBe(22);
      expect(f.players.filter((p) => p.side === 'home')).toHaveLength(11);
      expect(f.players.every((p) => p.x >= 0 && p.x <= PITCH_W && p.y >= 0 && p.y <= PITCH_L)).toBe(true);
      expect(Number.isFinite(f.ball.x) && Number.isFinite(f.ball.y) && Number.isFinite(f.ball.z)).toBe(true);
    }
  });

  it('el movimiento es continuo en varias semillas: sin saltos de balón ni de jugadores salvo el cambio de campo', () => {
    const dt = 1 / 30;
    for (const seed of [2024, 7, 99, 31337]) {
      const sc = generateScript(base(seed, { home: 2, away: 1 }));
      let prev = frameAt(sc, 0);
      let maxBall = 0;
      let maxPlayer = 0;
      for (let t = dt; t <= sc.duration; t += dt) {
        const f = frameAt(sc, t);
        const inSwap = Math.abs(t - sc.halftimeMid) <= 0.2;
        const resetting = !f.ball.visible || !prev.ball.visible;
        if (!inSwap) {
          for (let i = 0; i < 22; i += 1) {
            const a = prev.players[i];
            const b = f.players[i];
            if (a !== undefined && b !== undefined) maxPlayer = Math.max(maxPlayer, dist(a, b));
          }
          if (!resetting) maxBall = Math.max(maxBall, dist(prev.ball, f.ball));
        }
        prev = f;
      }
      expect(maxBall * 30).toBeLessThan(60); // < 60 m/s
      expect(maxPlayer * 30).toBeLessThan(55); // < 55 m/s: sin teletransportes (el vídeo va a ~2,3× el tiempo real)
    }
  });

  it('robustez: sin NaN y sin teletransportes con marcadores extremos y muchas semillas', () => {
    const cases: Score[] = [{ home: 0, away: 0 }, { home: 9, away: 0 }, { home: 4, away: 4 }, { home: 0, away: 7 }, { home: 1, away: 2 }, { home: 3, away: 0 }];
    let worstPlayer = 0;
    let nonFinite = 0;
    let wrongFinal = 0;
    for (const [i, score] of cases.entries()) {
      for (const seed of [i * 101 + 11, i * 977 + 5]) {
        const sc = generateScript(base(seed, score));
        let prev = frameAt(sc, 0);
        for (let t = 1 / 30; t <= sc.duration; t += 1 / 30) {
          const f = frameAt(sc, t);
          const inSwap = Math.abs(t - sc.halftimeMid) <= 0.2;
          for (let k = 0; k < 22; k += 1) {
            const a = prev.players[k];
            const b = f.players[k];
            if (a === undefined || b === undefined || !Number.isFinite(b.x) || !Number.isFinite(b.y)) nonFinite += 1;
            else if (!inSwap) worstPlayer = Math.max(worstPlayer, dist(a, b) * 30);
          }
          prev = f;
        }
        if (prev.score.home !== score.home || prev.score.away !== score.away) wrongFinal += 1;
      }
    }
    expect(nonFinite).toBe(0);
    expect(wrongFinal).toBe(0);
    expect(worstPlayer).toBeLessThan(55);
  }, 60_000);

  it('el balón llega a la portería en los goles', () => {
    for (const g of s.events.filter((e) => e.type === 'goal')) {
      const f = frameAt(s, g.t);
      expect(f.ball.y < 1.5 || f.ball.y > PITCH_L - 1.5).toBe(true);
      expect(Math.abs(f.ball.x - PITCH_W / 2)).toBeLessThan(3.7);
    }
  });

  it('mientras el balón es conducido hay exactamente un poseedor destacado y está junto al balón', () => {
    let checked = 0;
    for (const seg of s.ball.filter((x) => x.kind === 'carry' && x.t1 - x.t0 > 0.1)) {
      for (let t = seg.t0 + 0.03; t < seg.t1 - 0.03; t += 0.05) {
        const f = frameAt(s, t);
        const holders = f.players.filter((p) => p.hasBall);
        expect(holders).toHaveLength(1);
        expect(dist(holders[0] ?? { x: 999, y: 999 }, f.ball)).toBeLessThan(0.5);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('los equipos cambian de campo en la segunda parte', () => {
    const early = frameAt(s, 1);
    const late = frameAt(s, s.halftimeMid + 0.5);
    const meanY = (f: typeof early, side: 'home' | 'away'): number => {
      const ps = f.players.filter((p) => p.side === side && p.role !== 'GK');
      return ps.reduce((a, p) => a + p.y, 0) / ps.length;
    };
    expect(meanY(early, 'home') > 52.5).toBe(true); // el local defiende abajo y ataca arriba
    expect(meanY(late, 'home') < 52.5).toBe(true);
  });

  it('simulate() expone el guion y frame(t)', () => {
    const sim = simulate(base(5));
    expect(sim.frame(1).t).toBe(1);
    expect(sim.frame(-5).t).toBe(0);
    expect(sim.frame(1e9).t).toBe(sim.script.duration);
  });
});

describe('ritmo rápido (por defecto)', () => {
  const input = (seed: number, score: Score | null, pace?: 'fast' | 'normal'): SimulationInput => ({
    seed,
    home: 'Real Madrid',
    away: 'FC Barcelona',
    score,
    ...(pace === undefined ? {} : { pace }),
  });

  it('el ritmo por defecto es rápido', () => {
    expect(generateScript(input(1, null)).pace).toBe('fast');
    expect(generateScript(input(1, null)).timeScale).toBeLessThan(1);
    expect(generateScript(input(1, null, 'normal')).timeScale).toBe(1);
  });

  it('mismos sucesos, marcador, minutos y orden que el ritmo normal: sólo cambian los instantes', () => {
    for (const seed of seeds.slice(0, 15)) {
      const score = { home: seed % 4, away: seed % 3 };
      const fast = generateScript(input(seed, score, 'fast'));
      const slow = generateScript(input(seed, score, 'normal'));
      const key = (e: { type: string; side: string | null; shirt: number | null; text: string; clock: string; minute: number }): string =>
        `${e.type}|${e.side ?? ''}|${String(e.shirt)}|${e.text}|${e.clock}|${e.minute.toFixed(6)}`;
      expect(fast.events.map(key)).toEqual(slow.events.map(key));
      expect(fast.score).toEqual(slow.score);
      expect(fast.phases.map((p) => `${p.kind}${p.side ?? ''}${p.outcome ?? ''}`)).toEqual(slow.phases.map((p) => `${p.kind}${p.side ?? ''}${p.outcome ?? ''}`));
      expect(fast.stats).toEqual(slow.stats);
    }
  });

  it('dura bastante menos (≤ 70 %), con intro corta y sigue siendo coherente: fases contiguas, eventos ordenados y goles exactos', () => {
    for (const seed of seeds.slice(0, 20)) {
      const score = { home: seed % 4, away: (seed * 3) % 3 };
      const fast = generateScript(input(seed, score, 'fast'));
      const slow = generateScript(input(seed, score, 'normal'));
      expect(fast.duration).toBeLessThan(slow.duration * 0.7);
      expect(fast.phases[0]?.kind).toBe('intro');
      expect(fast.phases[0]?.t1).toBeLessThan(1.5);
      expect(fast.phases[0]?.t0).toBe(0);
      for (let i = 1; i < fast.phases.length; i += 1) expect(fast.phases[i]?.t0).toBeCloseTo(fast.phases[i - 1]?.t1 ?? NaN, 9);
      expect(fast.phases.at(-1)?.t1).toBeCloseTo(fast.duration, 9);
      for (let i = 1; i < fast.events.length; i += 1) expect(fast.events[i]?.t ?? 0).toBeGreaterThanOrEqual(fast.events[i - 1]?.t ?? 0);
      const goals = fast.events.filter((e) => e.type === 'goal');
      expect(goals.filter((e) => e.side === 'home')).toHaveLength(score.home);
      expect(goals.filter((e) => e.side === 'away')).toHaveLength(score.away);
      expect(frameAt(fast, fast.duration).score).toEqual(score);
    }
  });

  it('un partido típico (0–3 goles) dura entre 18 y 45 s: pensado para que se vea entero', () => {
    for (const seed of seeds.slice(0, 30)) {
      const s = generateScript(input(seed, { home: seed % 2, away: (seed >> 1) % 2 }, 'fast'));
      expect(s.duration).toBeGreaterThan(18);
      expect(s.duration).toBeLessThan(45);
    }
  });

  it('la animación sigue siendo continua (sin teletransportes) aunque todo vaya más deprisa', () => {
    for (const seed of [2024, 7, 99]) {
      const sc = generateScript(input(seed, { home: 2, away: 1 }, 'fast'));
      let prev = frameAt(sc, 0);
      let worstPlayer = 0;
      let worstBall = 0;
      let bad = 0;
      for (let t = 1 / 30; t <= sc.duration; t += 1 / 30) {
        const f = frameAt(sc, t);
        const inSwap = Math.abs(t - sc.halftimeMid) <= 0.2;
        for (let k = 0; k < 22; k += 1) {
          const a = prev.players[k];
          const b = f.players[k];
          if (a === undefined || b === undefined || !Number.isFinite(b.x) || !Number.isFinite(b.y)) bad += 1;
          else if (!inSwap) worstPlayer = Math.max(worstPlayer, dist(a, b) * 30);
        }
        if (f.ball.visible && prev.ball.visible) worstBall = Math.max(worstBall, dist(prev.ball, f.ball) * 30);
        prev = f;
      }
      expect(bad).toBe(0);
      expect(worstPlayer).toBeLessThan(110); // ≈ 55 m/s del ritmo normal ÷ 0,6 (con margen)
      expect(worstBall).toBeLessThan(130);
    }
  });

  it('el banner de gol dura lo bastante para leerse aunque el ritmo sea rápido', () => {
    const s = generateScript(input(31, { home: 1, away: 0 }, 'fast'));
    const goal = s.events.find((e) => e.type === 'goal');
    expect(goal).toBeDefined();
    const t = goal?.t ?? 0;
    expect(frameAt(s, t + 1.2).goalBanner).not.toBeNull();
    expect(frameAt(s, t + 2.5).goalBanner).toBeNull();
  });
});
