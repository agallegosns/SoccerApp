import { clamp } from '../../engine/geometry.ts';

/**
 * Física de los escudos del estilo Arena. Cada escudo es un cuerpo con inercia atraído por su posición «objetivo» (la coreografía:
 * seguir al balón) mediante un muelle amortiguado, al que se suman empujones aleatorios pero **deterministas** (semilla) para que el
 * movimiento no sea previsible. Rebotan contra la pared del aro y entre sí. Se precalcula con paso fijo, de modo que la posición en
 * cualquier instante es una función pura del tiempo (se puede saltar a cualquier punto del vídeo y se obtiene siempre lo mismo).
 */
export interface Vec {
  readonly x: number;
  readonly y: number;
}

export interface DiscPhysicsConfig {
  readonly seed: number;
  readonly duration: number;
  /** Centro y radio útil del aro (px, hasta donde puede llegar el centro del escudo). */
  readonly centre: Vec;
  readonly maxRadius: number;
  /** Separación mínima entre centros (px). */
  readonly minDistance: number;
  /** Objetivo de cada escudo en el instante `t`. */
  readonly targetAt: (t: number) => readonly [Vec, Vec];
}

export interface DiscContact {
  readonly t: number;
  readonly kind: 'wall' | 'disc';
}

export interface DiscTrack {
  readonly step: number;
  /** x0, y0, x1, y1 por paso. */
  readonly data: Float32Array;
  readonly contacts: readonly DiscContact[];
}

export const PHYS_STEP = 1 / 120;
const TARGET_STEP = 1 / 60;
/** Frecuencia propia (rad/s) y amortiguación del muelle: <1 deja un ligero rebasamiento, que da sensación de inercia. */
const OMEGA = 8;
const ZETA = 0.5;
const MAX_SPEED = 1800;
const WALL_RESTITUTION = 0.75;
const DISC_RESTITUTION = 0.9;
const IMPULSE_MIN = 650;
const IMPULSE_MAX = 1150;
/** Un salto del objetivo mayor que esto en un paso es un corte (pausa, reinicio), no movimiento: el escudo se recoloca. */
const SNAP = 150;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  next: number;
}

export function simulateDiscs(cfg: DiscPhysicsConfig): DiscTrack {
  const rng = mulberry32((cfg.seed ^ 0x5bd1e995) >>> 0);
  const nT = Math.ceil(cfg.duration / TARGET_STEP) + 2;
  const targets: [Vec, Vec][] = [];
  for (let i = 0; i < nT; i += 1) targets.push([...cfg.targetAt(Math.min(i * TARGET_STEP, cfg.duration))] as [Vec, Vec]);
  const targetNow = (t: number, k: 0 | 1): Vec => {
    const f = clamp(t / TARGET_STEP, 0, nT - 1.001);
    const i = Math.floor(f);
    const a = targets[i]?.[k] ?? { x: cfg.centre.x, y: cfg.centre.y };
    const b = targets[i + 1]?.[k] ?? a;
    const w = f - i;
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
  };
  const cut = (t: number): boolean => {
    const i = Math.floor(clamp(t / TARGET_STEP, 0, nT - 2));
    return [0, 1].some((k) => {
      const a = targets[i]?.[k];
      const b = targets[i + 1]?.[k];
      return a !== undefined && b !== undefined && Math.hypot(b.x - a.x, b.y - a.y) > SNAP;
    });
  };

  const n = Math.ceil(cfg.duration / PHYS_STEP) + 2;
  const data = new Float32Array(n * 4);
  const contacts: DiscContact[] = [];
  const t0 = targetNow(0, 0);
  const t1 = targetNow(0, 1);
  const bodies: [Body, Body] = [
    { x: t0.x, y: t0.y, vx: 0, vy: 0, next: 0.5 + rng() },
    { x: t1.x, y: t1.y, vx: 0, vy: 0, next: 0.8 + rng() },
  ];
  const wall = (b: Body, t: number): void => {
    const dx = b.x - cfg.centre.x;
    const dy = b.y - cfg.centre.y;
    const r = Math.hypot(dx, dy);
    if (r <= cfg.maxRadius) return;
    const nx = dx / r;
    const ny = dy / r;
    b.x = cfg.centre.x + nx * cfg.maxRadius;
    b.y = cfg.centre.y + ny * cfg.maxRadius;
    const vn = b.vx * nx + b.vy * ny;
    if (vn > 0) {
      b.vx -= (1 + WALL_RESTITUTION) * vn * nx;
      b.vy -= (1 + WALL_RESTITUTION) * vn * ny;
      if (vn > 120) contacts.push({ t, kind: 'wall' });
    }
  };

  for (let s = 0; s < n; s += 1) {
    const t = s * PHYS_STEP;
    const snap = cut(t);
    for (const [k, b] of bodies.entries()) {
      const tg = targetNow(t, k as 0 | 1);
      if (snap) {
        b.x = tg.x;
        b.y = tg.y;
        b.vx = 0;
        b.vy = 0;
      }
      if (t >= b.next) {
        const ang = rng() * Math.PI * 2;
        const mag = IMPULSE_MIN + rng() * (IMPULSE_MAX - IMPULSE_MIN);
        b.vx += Math.cos(ang) * mag;
        b.vy += Math.sin(ang) * mag;
        b.next = t + 0.9 + rng() * 1.5;
      }
      b.vx += (OMEGA * OMEGA * (tg.x - b.x) - 2 * ZETA * OMEGA * b.vx) * PHYS_STEP;
      b.vy += (OMEGA * OMEGA * (tg.y - b.y) - 2 * ZETA * OMEGA * b.vy) * PHYS_STEP;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > MAX_SPEED) {
        b.vx *= MAX_SPEED / sp;
        b.vy *= MAX_SPEED / sp;
      }
      b.x += b.vx * PHYS_STEP;
      b.y += b.vy * PHYS_STEP;
    }
    for (let pass = 0; pass < 3; pass += 1) {
      const [a, b] = bodies;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < cfg.minDistance) {
        const ux = d < 1e-3 ? 0 : dx / d;
        const uy = d < 1e-3 ? 1 : dy / d;
        const push = (cfg.minDistance - d) / 2;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        const closing = (a.vx - b.vx) * ux + (a.vy - b.vy) * uy;
        if (closing > 0) {
          const j = ((1 + DISC_RESTITUTION) * closing) / 2;
          a.vx -= j * ux;
          a.vy -= j * uy;
          b.vx += j * ux;
          b.vy += j * uy;
          if (closing > 120 && pass === 0) contacts.push({ t, kind: 'disc' });
        }
      }
      wall(a, t);
      wall(b, t);
    }
    data[s * 4] = bodies[0].x;
    data[s * 4 + 1] = bodies[0].y;
    data[s * 4 + 2] = bodies[1].x;
    data[s * 4 + 3] = bodies[1].y;
  }
  return { step: PHYS_STEP, data, contacts };
}

/** Posición de los dos escudos en `t` (interpolación lineal de la tabla). */
export function discsAt(track: DiscTrack, t: number): [Vec, Vec] {
  const n = track.data.length / 4;
  const f = clamp(t / track.step, 0, n - 1.001);
  const i = Math.floor(f);
  const w = f - i;
  const g = (idx: number): number => track.data[idx] ?? 0;
  const lerp = (o: number): number => g(i * 4 + o) + (g((i + 1) * 4 + o) - g(i * 4 + o)) * w;
  return [
    { x: lerp(0), y: lerp(1) },
    { x: lerp(2), y: lerp(3) },
  ];
}
