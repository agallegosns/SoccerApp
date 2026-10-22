import { describe, expect, it } from 'vitest';

import { simulate, simulateArena } from '../../engine/index.ts';
import { MIN_GAP, MIN_POWER, soundCues, thin, type Cue } from './cues.ts';
import { PEAK_CEILING, SAMPLE_RATE, TARGET_RMS, buildAudio } from './synth.ts';

const input = { seed: 7, home: 'Local', away: 'Visitante', score: { home: 2, away: 1 } } as const;

const rms = (s: Float32Array, t0: number, t1: number): number => {
  let acc = 0;
  const a = Math.floor(t0 * SAMPLE_RATE);
  const b = Math.floor(t1 * SAMPLE_RATE);
  for (let i = a; i < b; i += 1) acc += (s[i] ?? 0) ** 2;
  return Math.sqrt(acc / Math.max(1, b - a));
};

describe.each([['tactical', () => simulate(input)], ['arena', () => simulateArena(input)]] as const)('sonido (%s)', (style, make) => {
  const sim = make();

  it('sólo hay toques del balón y pitidos: ni sonido de gol, ni público, ni paradas', () => {
    const cues = soundCues(sim, style);
    expect(new Set(cues.map((c) => c.kind))).toEqual(new Set(['kick', 'wall', 'whistle'].filter((k) => cues.some((c) => c.kind === k))));
    expect(cues.some((c) => c.kind === 'whistle' && c.blasts === 3)).toBe(true);
    expect(cues.some((c) => c.kind === 'kick')).toBe(true);
    for (const c of cues) expect(['kick', 'wall', 'whistle']).toContain(c.kind);
  });

  it('en un gol no suena nada especial: sin pista por encima del nivel de un golpe ni de un pitido', () => {
    const track = buildAudio(sim, style);
    const cues = soundCues(sim, style);
    const goals = sim.script.events.filter((e) => e.type === 'goal');
    expect(goals.length).toBeGreaterThan(0);
    const level = (t0: number, t1: number): number => {
      let best = 0;
      for (let t = t0; t < t1; t += 0.01) best = Math.max(best, rms(track.samples, t, t + 0.02));
      return best;
    };
    const maxSound = Math.max(...cues.map((c) => level(c.t, c.t + (c.kind === 'whistle' ? 0.3 : 0.06))));
    for (const g of goals) {
      // Entre 0,4 y 1,6 s después del gol sólo puede sonar lo que ya sonaba por otros motivos (un toque o un pitido), nunca un rugido sostenido.
      const nearby = cues.filter((c) => c.t > g.t + 0.3 && c.t < g.t + 1.7);
      const quiet = (t: number): boolean => nearby.every((c) => Math.abs(c.t - t) > (c.kind === 'whistle' ? 1.1 : 0.2));
      for (let t = g.t + 0.4; t < g.t + 1.6; t += 0.1) if (quiet(t)) expect(level(t, t + 0.1)).toBeLessThan(maxSound * 0.05);
    }
  });

  it('es determinista, finito y no pasa de –2 dBFS (sin recortes)', () => {
    const a = buildAudio(sim, style);
    const b = buildAudio(sim, style);
    expect(a.samples.length).toBe(Math.ceil(sim.script.duration * SAMPLE_RATE));
    expect(Buffer.from(a.samples.buffer).equals(Buffer.from(b.samples.buffer))).toBe(true);
    let peak = 0;
    let finite = true;
    for (const v of a.samples) {
      if (!Number.isFinite(v)) finite = false;
      peak = Math.max(peak, Math.abs(v));
    }
    expect(finite).toBe(true);
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(PEAK_CEILING + 1e-4);
  });

  it('volumen medio cómodo y sin graves que el altavoz del móvil no oye', () => {
    const { samples } = buildAudio(sim, style);
    // Volumen medio de lo que suena (sin contar los silencios entre toques).
    let acc = 0;
    let n = 0;
    for (const v of samples) {
      if (Math.abs(v) > 0.004) {
        acc += v * v;
        n += 1;
      }
    }
    const active = Math.sqrt(acc / Math.max(1, n));
    expect(active).toBeGreaterThan(TARGET_RMS * 0.6);
    expect(active).toBeLessThan(TARGET_RMS * 1.15);
    const a = 1 - Math.exp((-2 * Math.PI * 150) / SAMPLE_RATE);
    let y = 0;
    let low = 0;
    let all = 0;
    for (const v of samples) {
      y += a * (v - y);
      low += y * y;
      all += v * v;
    }
    expect(low / all).toBeLessThan(0.12);
  });

  it('cada pitido y cada toque se oye con claridad (sobresale del silencio de alrededor)', () => {
    const track = buildAudio(sim, style);
    const peakNear = (c: Cue, len: number): number => {
      let best = 0;
      for (let t = c.t; t < c.t + len; t += 0.01) best = Math.max(best, rms(track.samples, t, t + 0.02));
      return best;
    };
    const cues = soundCues(sim, style);
    // Todos por encima de –24 dBFS (con 20 ms de ventana) y los pitidos por encima de –16 dBFS.
    for (const c of cues.filter((x) => x.kind === 'whistle' && x.t > 0.3)) expect(peakNear(c, 0.3)).toBeGreaterThan(0.158);
    const hits = cues.filter((x) => (x.kind === 'kick' || x.kind === 'wall') && x.t > 0.3).map((c) => peakNear(c, 0.05)).sort((p, q) => p - q);
    expect(hits.length).toBeGreaterThan(3);
    expect(hits[Math.floor(hits.length * 0.1)] ?? 0).toBeGreaterThan(0.063); // el 90 % de los toques supera –24 dBFS
    expect(hits[Math.floor(hits.length / 2)] ?? 0).toBeGreaterThan(0.158); // y la mitad supera –16 dBFS
  });

  it('los pitidos siguen el patrón del árbitro: 1 al empezar, 2 en el descanso y 3 al final', () => {
    const cues = soundCues(sim, style);
    const whistles = cues.filter((c): c is Extract<Cue, { kind: 'whistle' }> => c.kind === 'whistle');
    const at = (type: string): number => sim.script.events.find((e) => e.type === type)?.t ?? -1;
    expect(whistles.find((w) => Math.abs(w.t - at('kickoff')) < 1e-6)?.blasts).toBe(1);
    expect(whistles.find((w) => Math.abs(w.t - at('halftime')) < 1e-6)?.blasts).toBe(2);
    expect(whistles.find((w) => Math.abs(w.t - at('fulltime')) < 1e-6)?.blasts).toBe(3);
  });

  it('se genera en bien menos de 3 s (también en un móvil)', () => {
    const t0 = performance.now();
    buildAudio(sim, style);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('golpes y rebotes sin «ametralladora»', () => {
  it('thin() quita los golpes flojos y deja el más fuerte de cada racha pegada', () => {
    const raw: Cue[] = [
      { t: 1, kind: 'kick', power: 0.5 },
      { t: 1.05, kind: 'kick', power: 0.9 }, // pegado al anterior y más fuerte: sustituye
      { t: 1.07, kind: 'kick', power: 0.4 }, // pegado y más flojo: se descarta
      { t: 1.5, kind: 'kick', power: MIN_POWER - 0.01 }, // casi un roce: no suena
      { t: 2, kind: 'wall', power: 0.8 },
      { t: 2.05, kind: 'kick', power: 0.8 }, // otro tipo: no se mezcla con los de la pared
      { t: 3, kind: 'whistle', blasts: 1 },
    ];
    const out = thin(raw);
    expect(out.filter((c) => c.kind === 'kick')).toEqual([{ t: 1.05, kind: 'kick', power: 0.9 }, { t: 2.05, kind: 'kick', power: 0.8 }]);
    expect(out.filter((c) => c.kind === 'wall')).toHaveLength(1);
    expect(out.filter((c) => c.kind === 'whistle')).toHaveLength(1);
  });

  it.each([['tactical', () => simulate(input)], ['arena', () => simulateArena(input)]] as const)('en %s hay separación mínima entre golpes del mismo tipo', (style, make) => {
    const cues = soundCues(make(), style);
    for (const kind of ['kick', 'wall'] as const) {
      const ts = cues.filter((c) => c.kind === kind).map((c) => c.t);
      for (let i = 1; i < ts.length; i += 1) expect((ts[i] ?? 0) - (ts[i - 1] ?? 0)).toBeGreaterThanOrEqual(MIN_GAP[kind] - 1e-9);
    }
  });
});
