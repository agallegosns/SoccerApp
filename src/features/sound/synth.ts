import type { Simulation } from '../../engine/index.ts';
import type { VideoStyle } from '../simulation/renderers.ts';
import { soundCues, type Cue } from './cues.ts';

export const SAMPLE_RATE = 44_100;

/** Pista de audio mono (-1…1) lista para reproducir o codificar. */
export interface AudioTrack {
  readonly sampleRate: number;
  readonly samples: Float32Array<ArrayBuffer>;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Escribe `fn(tSegundos)` en el búfer desde `start` durante `len` segundos. */
function paint(buf: Float32Array, start: number, len: number, fn: (t: number) => number): void {
  const i0 = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const i1 = Math.min(buf.length, Math.floor((start + len) * SAMPLE_RATE));
  for (let i = i0; i < i1; i += 1) buf[i] = (buf[i] ?? 0) + fn(i / SAMPLE_RATE - start);
}

/** Ruido filtrado paso bajo (un polo) con envolvente: base del público, golpes y silbidos de aire. */
function noiseBurst(buf: Float32Array, rand: () => number, start: number, len: number, cutoff: number, env: (t: number) => number): void {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
  let y = 0;
  paint(buf, start, len, (t) => {
    y += a * ((rand() * 2 - 1) - y);
    return y * env(t);
  });
}

function kick(buf: Float32Array, rand: () => number, t: number, power: number): void {
  const p = 0.35 + 0.65 * clamp01(power);
  let phase = 0;
  paint(buf, t, 0.14, (x) => {
    phase += (2 * Math.PI * (55 + 110 * Math.exp(-x * 40))) / SAMPLE_RATE;
    return Math.sin(phase) * Math.exp(-x * 30) * 0.9 * p;
  });
  noiseBurst(buf, rand, t, 0.04, 3200, (x) => Math.exp(-x * 120) * 2.2 * p);
}

function wall(buf: Float32Array, rand: () => number, t: number, power: number): void {
  const p = 0.3 + 0.7 * clamp01(power);
  let phase = 0;
  paint(buf, t, 0.12, (x) => {
    phase += (2 * Math.PI * (420 + 380 * Math.exp(-x * 60))) / SAMPLE_RATE;
    return Math.sin(phase) * Math.exp(-x * 45) * 0.55 * p;
  });
  noiseBurst(buf, rand, t, 0.03, 6000, (x) => Math.exp(-x * 150) * 1.4 * p);
}

function whistleBlast(buf: Float32Array, t: number, len: number): void {
  let phase = 0;
  paint(buf, t, len, (x) => {
    const trill = 0.65 + 0.35 * Math.sin(2 * Math.PI * 26 * x);
    const env = Math.min(1, x / 0.015) * Math.min(1, (len - x) / 0.04);
    phase += (2 * Math.PI * (2850 + 60 * Math.sin(2 * Math.PI * 5 * x))) / SAMPLE_RATE;
    return (Math.sin(phase) * 0.5 + Math.sin(phase * 2) * 0.12) * trill * env * 0.5;
  });
}

function whistle(buf: Float32Array, t: number, blasts: 1 | 2 | 3): void {
  if (blasts === 1) whistleBlast(buf, t, 0.45);
  else if (blasts === 2) { whistleBlast(buf, t, 0.35); whistleBlast(buf, t + 0.5, 0.7); }
  else { whistleBlast(buf, t, 0.3); whistleBlast(buf, t + 0.42, 0.3); whistleBlast(buf, t + 0.84, 0.9); }
}

function crowd(buf: Float32Array, rand: () => number, t: number, len: number, peak: number, attack: number, cutoff: number): void {
  noiseBurst(buf, rand, t, len, cutoff, (x) => {
    const up = clamp01(x / attack);
    const down = Math.exp(-Math.max(0, x - attack) * (3.2 / len) * 1.6);
    return up * up * down * peak;
  });
}

function bell(buf: Float32Array, t: number, f: number, gain: number): void {
  paint(buf, t, 1.2, (x) => (Math.sin(2 * Math.PI * f * x) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * x)) * Math.exp(-x * 4.5) * gain);
}

function apply(buf: Float32Array, rand: () => number, c: Cue): void {
  switch (c.kind) {
    case 'kick': kick(buf, rand, c.t, c.power); break;
    case 'wall': wall(buf, rand, c.t, c.power); break;
    case 'whistle': whistle(buf, c.t, c.blasts); break;
    case 'goal':
      crowd(buf, rand, c.t, 3.4, 5.2, 0.35, 2600);
      crowd(buf, rand, c.t, 3.4, 2.2, 0.5, 900);
      bell(buf, c.t, 880, 0.3);
      bell(buf, c.t + 0.12, 1318, 0.24);
      break;
    case 'save':
      noiseBurst(buf, rand, c.t, 0.09, 1800, (x) => Math.exp(-x * 45) * 2.6);
      crowd(buf, rand, c.t, 1.2, 1.4, 0.2, 1500);
      break;
    case 'post': {
      paint(buf, c.t, 0.8, (x) => (Math.sin(2 * Math.PI * 1250 * x) + 0.6 * Math.sin(2 * Math.PI * 3100 * x)) * Math.exp(-x * 9) * 0.35);
      crowd(buf, rand, c.t, 1.4, 1.8, 0.15, 1800);
      break;
    }
    case 'miss': crowd(buf, rand, c.t, 1.1, 1.3, 0.25, 1100); break;
    case 'whoosh': noiseBurst(buf, rand, Math.max(0, c.t - 0.18), 0.3, 2400, (x) => Math.sin(Math.PI * clamp01(x / 0.3)) * 0.9); break;
  }
}

/**
 * Banda sonora procedural y determinista (misma simulación → mismas muestras): golpes de balón, rebotes en la pared, silbatos,
 * rugido del público en los goles y ambiente de grada. Todo sintetizado aquí; no usa grabaciones con derechos.
 */
export function buildAudio(sim: Simulation, style: VideoStyle): AudioTrack {
  const duration = sim.script.duration;
  const buf = new Float32Array(Math.ceil(duration * SAMPLE_RATE));
  const rand = rng(sim.script.seed ^ 0x5f3759df);
  const cues = soundCues(sim, style);

  // Ambiente de grada: murmullo constante que sube un poco antes de las ocasiones.
  const ambience = new Float32Array(buf.length);
  noiseBurst(ambience, rand, 0, duration, 700, () => 0.55);
  const bumps = cues.filter((c) => c.kind === 'whoosh' || c.kind === 'goal' || c.kind === 'save' || c.kind === 'post');
  const ENV_HZ = 50;
  const env = new Float32Array(Math.ceil(duration * ENV_HZ) + 2);
  for (let k = 0; k < env.length; k += 1) {
    const t = k / ENV_HZ;
    let level = 0.28 + 0.1 * Math.sin(t * 0.7);
    for (const b of bumps) {
      const d = t - b.t;
      if (d > -1.8 && d < 1.2) level += 0.35 * Math.exp(-((d + 0.3) ** 2) / 0.6);
    }
    env[k] = level;
  }
  for (let i = 0; i < ambience.length; i += 1) {
    const f = (i / SAMPLE_RATE) * ENV_HZ;
    const k = Math.floor(f);
    const a = env[k] ?? 0;
    buf[i] = (ambience[i] ?? 0) * (a + ((env[k + 1] ?? a) - a) * (f - k));
  }

  for (const c of cues) apply(buf, rand, c);

  // Limitador suave y normalización a –1 dBFS aprox., con fundido final.
  let peak = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = Math.tanh(buf[i] ?? 0);
    buf[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const gain = peak > 0 ? 0.89 / peak : 1;
  const fade = Math.floor(0.25 * SAMPLE_RATE);
  for (let i = 0; i < buf.length; i += 1) {
    const tail = Math.min(1, (buf.length - i) / fade);
    buf[i] = (buf[i] ?? 0) * gain * tail;
  }
  return { sampleRate: SAMPLE_RATE, samples: buf };
}
