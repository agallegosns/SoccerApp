import { describe, expect, it } from 'vitest';

import { simulate, simulateArena } from '../../engine/index.ts';
import { soundCues } from './cues.ts';
import { SAMPLE_RATE, buildAudio } from './synth.ts';

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
    expect(peak).toBeLessThanOrEqual(0.9);
  });
  it('suena más fuerte durante un gol que en un instante sin sucesos', () => {
    const track = buildAudio(sim, style);
    const goal = soundCues(sim, style).find((c) => c.kind === 'goal');
    expect(goal).toBeDefined();
    const g = rms(track.samples, (goal?.t ?? 0) + 0.3, (goal?.t ?? 0) + 1.3);
    expect(g).toBeGreaterThan(0.05);
  });
});
