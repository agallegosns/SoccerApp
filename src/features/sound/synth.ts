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
const smooth = (x: number): number => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

/** Filtro bicuadrático (fórmulas RBJ): paso banda, bajo o alto. */
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;

  constructor(type: 'band' | 'low' | 'high', freq: number, q: number) {
    const w = (2 * Math.PI * Math.min(freq, SAMPLE_RATE * 0.45)) / SAMPLE_RATE;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    if (type === 'band') {
      this.b0 = alpha / a0;
      this.b1 = 0;
      this.b2 = -alpha / a0;
    } else if (type === 'low') {
      this.b0 = (1 - cos) / 2 / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = (1 - cos) / 2 / a0;
    } else {
      this.b0 = (1 + cos) / 2 / a0;
      this.b1 = -(1 + cos) / a0;
      this.b2 = (1 + cos) / 2 / a0;
    }
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Suma `fn(tSegundos)` al búfer desde `start` durante `len` segundos. */
function paint(buf: Float32Array, start: number, len: number, fn: (t: number) => number): void {
  const i0 = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const i1 = Math.min(buf.length, Math.floor((start + len) * SAMPLE_RATE));
  for (let i = i0; i < i1; i += 1) buf[i] = (buf[i] ?? 0) + fn(i / SAMPLE_RATE - start);
}

/** Ruido blanco pasado por filtros (en serie) con envolvente. */
function noise(buf: Float32Array, rand: () => number, start: number, len: number, filters: readonly Biquad[], env: (t: number) => number): void {
  paint(buf, start, len, (t) => {
    let v = rand() * 2 - 1;
    for (const f of filters) v = f.process(v);
    return v * env(t);
  });
}

// ---- Sonidos sueltos. Diseñados para altavoces de móvil: casi nada por debajo de 150 Hz (no se oiría) y mucho «chasquido» en medios/agudos. ----

/** Golpe de balón: «toc» corto de cuero (240→140 Hz), cuerpo (~520 Hz) y chasquido (2–3 kHz). */
function kick(buf: Float32Array, rand: () => number, t: number, power: number): void {
  // Cada golpe es un poco distinto (volumen y tono ±8 %): si no, una racha suena a la misma muestra repetida.
  const p = (0.3 + 0.7 * clamp01(power) ** 1.4) * (0.92 + 0.16 * rand());
  const pitch = 0.92 + 0.16 * rand();
  let phase = 0;
  paint(buf, t, 0.16, (x) => {
    phase += (2 * Math.PI * pitch * (140 + 100 * Math.exp(-x * 60))) / SAMPLE_RATE;
    return Math.sin(phase) * Math.exp(-x * 36) * 0.55 * p;
  });
  paint(buf, t, 0.09, (x) => Math.sin(2 * Math.PI * 520 * pitch * x) * Math.exp(-x * 70) * 0.34 * p);
  noise(buf, rand, t, 0.05, [new Biquad('band', 2400, 1.1)], (x) => Math.exp(-x * 120) * 1.6 * p);
}

/** Balón contra la pared: «tonk» seco y agudo (≈ 900 Hz) con un chasquido, claramente distinto del golpe de balón. */
function wall(buf: Float32Array, rand: () => number, t: number, power: number): void {
  const p = (0.35 + 0.65 * clamp01(power) ** 1.3) * (0.92 + 0.16 * rand());
  const pitch = 0.9 + 0.2 * rand();
  let phase = 0;
  paint(buf, t, 0.14, (x) => {
    phase += (2 * Math.PI * pitch * (760 + 220 * Math.exp(-x * 50))) / SAMPLE_RATE;
    return (Math.sin(phase) + 0.35 * Math.sin(2.4 * phase)) * Math.exp(-x * 42) * 0.38 * p;
  });
  noise(buf, rand, t, 0.04, [new Biquad('band', 4200, 1.2)], (x) => Math.exp(-x * 200) * 1.1 * p);
}

/** Un soplido de silbato de árbitro (pito de bolita): tono de ≈ 2,9 kHz con trino, un poco de aire y un armónico. */
function whistleBlast(buf: Float32Array, rand: () => number, t: number, len: number): void {
  let phase = 0;
  const breath = new Biquad('band', 3600, 2.5);
  paint(buf, t, len, (x) => {
    const trill = 0.78 + 0.22 * Math.sin(2 * Math.PI * 27 * x);
    const env = smooth(x / 0.012) * smooth((len - x) / 0.05);
    phase += (2 * Math.PI * (2900 + 70 * Math.sin(2 * Math.PI * 4.5 * x))) / SAMPLE_RATE;
    const tone = Math.sin(phase) + 0.16 * Math.sin(2 * phase) + 0.07 * Math.sin(3 * phase);
    return (tone * 0.62 + breath.process(rand() * 2 - 1) * 0.5) * trill * env;
  });
}

/** Inicio / falta: un pitido. Descanso: uno corto y uno largo. Final: dos cortos y uno largo (como el árbitro). */
function whistle(buf: Float32Array, rand: () => number, t: number, blasts: 1 | 2 | 3): void {
  if (blasts === 1) whistleBlast(buf, rand, t, 0.5);
  else if (blasts === 2) { whistleBlast(buf, rand, t, 0.3); whistleBlast(buf, rand, t + 0.42, 0.75); }
  else { whistleBlast(buf, rand, t, 0.26); whistleBlast(buf, rand, t + 0.38, 0.26); whistleBlast(buf, rand, t + 0.76, 0.95); }
}

/** Rugido del público: ruido con dos resonancias vocales (~600 Hz y ~1,6 kHz) que sube de golpe y se apaga poco a poco. */
function crowd(buf: Float32Array, rand: () => number, t: number, len: number, peak: number, attack: number): void {
  const a = new Biquad('band', 600, 0.7);
  const b = new Biquad('band', 1600, 0.8);
  const top = new Biquad('low', 4200, 0.7);
  paint(buf, t, len, (x) => {
    const n = rand() * 2 - 1;
    const v = top.process(a.process(n) * 0.9 + b.process(n) * 0.7);
    const rise = smooth(x / attack);
    const fall = Math.exp(-Math.max(0, x - attack) * (3.4 / len) * 1.4);
    return v * rise * fall * peak;
  });
}

/** Campanilla de gol: dos notas (la y mi, una quinta) con sus parciales no armónicos. */
function bell(buf: Float32Array, t: number, f: number, gain: number): void {
  paint(buf, t, 1.4, (x) => (Math.sin(2 * Math.PI * f * x) + 0.45 * Math.sin(2 * Math.PI * f * 2.76 * x) + 0.2 * Math.sin(2 * Math.PI * f * 5.4 * x)) * Math.exp(-x * 3.6) * gain);
}

function apply(buf: Float32Array, rand: () => number, c: Cue): void {
  switch (c.kind) {
    case 'kick': kick(buf, rand, c.t, c.power); break;
    case 'wall': wall(buf, rand, c.t, c.power); break;
    case 'whistle': whistle(buf, rand, c.t, c.blasts); break;
    case 'goal':
      crowd(buf, rand, c.t, 3.2, 0.7, 0.3);
      bell(buf, c.t + 0.02, 880, 0.2);
      bell(buf, c.t + 0.16, 1318.5, 0.16);
      break;
    case 'save':
      noise(buf, rand, c.t, 0.08, [new Biquad('band', 1000, 0.9)], (x) => Math.exp(-x * 50) * 1.2);
      crowd(buf, rand, c.t + 0.05, 1.1, 0.3, 0.2);
      break;
    case 'post':
      paint(buf, c.t, 0.8, (x) => (Math.sin(2 * Math.PI * 1250 * x) + 0.6 * Math.sin(2 * Math.PI * 3100 * x)) * Math.exp(-x * 9) * 0.2);
      crowd(buf, rand, c.t + 0.05, 1.3, 0.38, 0.15);
      break;
    case 'miss': crowd(buf, rand, c.t, 1.0, 0.9, 0.25); break;
    case 'whoosh': noise(buf, rand, Math.max(0, c.t - 0.2), 0.3, [new Biquad('band', 1500, 0.8)], (x) => Math.sin(Math.PI * clamp01(x / 0.3)) * 0.35); break;
  }
}

/** Compresor suave (umbral, relación 2,2:1, ataque 4 ms, relajación 160 ms): los goles no se comen a los golpes de balón. */
function compress(buf: Float32Array, threshold: number, ratio: number): void {
  const attack = Math.exp(-1 / (0.004 * SAMPLE_RATE));
  const release = Math.exp(-1 / (0.16 * SAMPLE_RATE));
  let env = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const x = buf[i] ?? 0;
    const level = Math.abs(x);
    env = level > env ? attack * env + (1 - attack) * level : release * env + (1 - release) * level;
    const gain = env > threshold ? (threshold + (env - threshold) / ratio) / env : 1;
    buf[i] = x * gain;
  }
}

/** Limitador con anticipación (3 ms): nunca pasa de `ceiling`, sin recortes ni distorsión audibles. */
function limit(buf: Float32Array, ceiling: number): void {
  const look = Math.floor(0.003 * SAMPLE_RATE);
  const release = Math.exp(-1 / (0.05 * SAMPLE_RATE));
  const n = buf.length;
  const need = new Float32Array(n);
  for (let i = 0; i < n; i += 1) need[i] = Math.min(1, ceiling / Math.max(Math.abs(buf[i] ?? 0), 1e-9));
  // Mínimo móvil de la ganancia necesaria en la ventana [i − look, i + look] (cola doble monótona: O(n)).
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let next = 0;
  let g = 1;
  for (let i = 0; i < n; i += 1) {
    const upTo = Math.min(n - 1, i + look);
    while (next <= upTo) {
      while (tail > head && (need[queue[tail - 1] ?? 0] ?? 1) >= (need[next] ?? 1)) tail -= 1;
      queue[tail] = next;
      tail += 1;
      next += 1;
    }
    while ((queue[head] ?? 0) < i - look) head += 1;
    const m = need[queue[head] ?? i] ?? 1;
    g = m < g ? m : release * g + (1 - release) * m;
    buf[i] = (buf[i] ?? 0) * Math.min(g, need[i] ?? 1);
  }
}

/** Nivel de pico máximo de la pista (–2 dBFS: deja margen para el códec y los picos entre muestras). */
export const PEAK_CEILING = 0.8;
/** Nivel medio objetivo de la pista (RMS –18 dBFS ≈ –15 LUFS, un volumen cómodo en TikTok y Instagram sin pasarse). */
export const TARGET_RMS = 0.12;

/**
 * Banda sonora procedural y determinista (misma simulación → mismas muestras): golpes de balón, rebotes en la pared, silbatos,
 * rugido del público en los goles y ambiente de grada. Todo sintetizado aquí; no usa grabaciones con derechos.
 * Mezcla pensada para el móvil: sin graves que el altavoz no reproduce, compresión suave, volumen medio fijo y limitador.
 */
export function buildAudio(sim: Simulation, style: VideoStyle): AudioTrack {
  const duration = sim.script.duration;
  const buf = new Float32Array(Math.ceil(duration * SAMPLE_RATE));
  const rand = rng(sim.script.seed ^ 0x5f3759df);
  const cues = soundCues(sim, style);

  // Ambiente de grada: murmullo suave que sube un poco antes de las ocasiones.
  const bumps = cues.filter((c) => c.kind === 'whoosh' || c.kind === 'goal' || c.kind === 'save' || c.kind === 'post');
  const lo = new Biquad('band', 500, 0.5);
  const hi = new Biquad('low', 2200, 0.7);
  for (let i = 0; i < buf.length; i += 1) {
    const t = i / SAMPLE_RATE;
    let level = 0.035 + 0.01 * Math.sin(t * 0.7);
    for (const b of bumps) {
      const d = t - b.t;
      if (d > -1.8 && d < 1.2) level += 0.04 * Math.exp(-((d + 0.3) ** 2) / 0.6);
    }
    buf[i] = hi.process(lo.process(rand() * 2 - 1)) * level;
  }

  for (const c of cues) apply(buf, rand, c);

  // Master: quita lo grave (el altavoz del móvil no lo oye y ensucia), comprime, fija el volumen medio y limita.
  const hp1 = new Biquad('high', 110, 0.7);
  const hp2 = new Biquad('high', 110, 0.7);
  for (let i = 0; i < buf.length; i += 1) buf[i] = hp2.process(hp1.process(buf[i] ?? 0));
  compress(buf, 0.3, 2.2);

  let acc = 0;
  let n = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = buf[i] ?? 0;
    if (Math.abs(v) > 0.004) {
      acc += v * v;
      n += 1;
    }
  }
  const rms = n > 0 ? Math.sqrt(acc / n) : 0;
  const gain = rms > 0 ? Math.min(TARGET_RMS / rms, 16) : 1;
  for (let i = 0; i < buf.length; i += 1) buf[i] = (buf[i] ?? 0) * gain;
  limit(buf, PEAK_CEILING);

  const fadeIn = Math.floor(0.004 * SAMPLE_RATE);
  const fadeOut = Math.floor(0.25 * SAMPLE_RATE);
  for (let i = 0; i < buf.length; i += 1) buf[i] = (buf[i] ?? 0) * Math.min(1, i / fadeIn, (buf.length - i) / fadeOut);
  return { sampleRate: SAMPLE_RATE, samples: buf };
}
