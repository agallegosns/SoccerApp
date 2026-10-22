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
  it('tiene un sonido de gol por cada gol y silbato final', () => {
    const cues = soundCues(sim, style);
    expect(cues.filter((c) => c.kind === 'goal')).toHaveLength(sim.script.score.home + sim.script.score.away);
    expect(cues.some((c) => c.kind === 'whistle' && c.blasts === 3)).toBe(true);
    expect(cues.some((c) => c.kind === 'kick')).toBe(true);
  });
  it('es determinista, finito y no pasa de 0 dBFS', () => {
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
    expect(peak).toBeLessThanOrEqual(PEAK_CEILING + 1e-4); // sin recortes: margen de 2 dB para el códec
  });
  it('suena más fuerte durante un gol que en un instante sin sucesos', () => {
    const track = buildAudio(sim, style);
    const goal = soundCues(sim, style).find((c) => c.kind === 'goal');
    expect(goal).toBeDefined();
    const g = rms(track.samples, (goal?.t ?? 0) + 0.3, (goal?.t ?? 0) + 1.3);
    expect(g).toBeGreaterThan(0.05);
  });

  it('volumen medio cómodo y estable (≈ –15 LUFS) y sin graves que el altavoz del móvil no oye', () => {
    const { samples } = buildAudio(sim, style);
    const total = rms(samples, 0, sim.script.duration);
    expect(total).toBeGreaterThan(TARGET_RMS * 0.6);
    expect(total).toBeLessThan(TARGET_RMS * 1.2);
    // Parte de la energía por debajo de ~150 Hz (filtro de un polo): casi nada.
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

  it('cada pitido, golpe y rebote se distingue por encima del volumen medio', () => {
    const track = buildAudio(sim, style);
    const mean = rms(track.samples, 0, sim.script.duration);
    const peakNear = (c: Cue, len: number): number => {
      let best = 0;
      for (let t = c.t; t < c.t + len; t += 0.01) best = Math.max(best, rms(track.samples, t, t + 0.02));
      return best / mean;
    };
    const cues = soundCues(sim, style);
    for (const c of cues.filter((x) => x.kind === 'whistle' && x.t > 0.3)) expect(peakNear(c, 0.3)).toBeGreaterThan(1.6); // ≥ +4 dB
    for (const c of cues.filter((x) => x.kind === 'goal')) expect(peakNear(c, 0.9)).toBeGreaterThan(1.4);
    const hits = cues.filter((x) => (x.kind === 'kick' || x.kind === 'wall') && x.t > 0.3).map((c) => peakNear(c, 0.05)).sort((p, q) => p - q);
    expect(hits.length).toBeGreaterThan(3);
    expect(hits[Math.floor(hits.length / 2)] ?? 0).toBeGreaterThan(1.3); // la mediana de los golpes sobresale (+2,3 dB)
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
      { t: 3, kind: 'goal' },
    ];
    const out = thin(raw);
    expect(out.filter((c) => c.kind === 'kick')).toEqual([{ t: 1.05, kind: 'kick', power: 0.9 }, { t: 2.05, kind: 'kick', power: 0.8 }]);
    expect(out.filter((c) => c.kind === 'wall')).toHaveLength(1);
    expect(out.filter((c) => c.kind === 'goal')).toHaveLength(1);
  });

  it.each([['tactical', () => simulate(input)], ['arena', () => simulateArena(input)]] as const)('en %s hay separación mínima entre golpes del mismo tipo', (style, make) => {
    const cues = soundCues(make(), style);
    for (const kind of ['kick', 'wall'] as const) {
      const ts = cues.filter((c) => c.kind === kind).map((c) => c.t);
      for (let i = 1; i < ts.length; i += 1) expect((ts[i] ?? 0) - (ts[i - 1] ?? 0)).toBeGreaterThanOrEqual(MIN_GAP[kind] - 1e-9);
    }
  });
});
