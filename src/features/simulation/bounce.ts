import type { Unit } from './arena.ts';

/**
 * Rebotes del balón en el aro del estilo Arena. El guion dice de dónde a dónde va el balón en cada tramo; aquí se decide, de forma
 * determinista, si ese viaje hace una banda en la pared (ley de reflexión: ángulo de entrada = ángulo de salida) en lugar de ir en línea recta.
 * Sólo es la trayectoria dibujada: los instantes, los sucesos y el marcador no cambian.
 */
export type BounceLevel = 'off' | 'low' | 'normal' | 'high';

export const BOUNCE_LEVELS: readonly { value: BounceLevel; label: string }[] = [
  { value: 'off', label: 'Sin rebotes' },
  { value: 'low', label: 'Pocos' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Muchos' },
];

/** Probabilidad de que un tramo rebote y longitud mínima (unidades del círculo) para que valga la pena. */
const LEVELS: Readonly<Record<BounceLevel, { chance: number; minLength: number }>> = {
  off: { chance: 0, minLength: Infinity },
  low: { chance: 0.5, minLength: 0.4 },
  normal: { chance: 0.85, minLength: 0.2 },
  high: { chance: 1, minLength: 0.08 },
};

/** Radio (unidades) al que el balón toca la pared. */
export const WALL = 0.94;

export interface Route {
  readonly pts: readonly Unit[];
  /** Longitud acumulada hasta cada punto. */
  readonly cum: readonly number[];
  readonly length: number;
  /** Fracción del recorrido en la que toca la pared, o `null` si va en línea recta. */
  readonly bounceAt: number | null;
}

const dist = (a: Unit, b: Unit): number => Math.hypot(b.u - a.u, b.v - a.v);

function straight(a: Unit, b: Unit): Route {
  const length = dist(a, b);
  return { pts: [a, b], cum: [0, length], length, bounceAt: null };
}

/** Error de la ley de reflexión para una banda en el punto P de la pared (0 = rebote perfecto). */
function reflectionError(a: Unit, b: Unit, theta: number): number {
  const p = { u: WALL * Math.cos(theta), v: WALL * Math.sin(theta) };
  const n = { u: Math.cos(theta), v: Math.sin(theta) };
  const l1 = dist(a, p) || 1e-9;
  const l2 = dist(p, b) || 1e-9;
  const d1 = { u: (p.u - a.u) / l1, v: (p.v - a.v) / l1 };
  const d2 = { u: (b.u - p.u) / l2, v: (b.v - p.v) / l2 };
  const k = 2 * (d1.u * n.u + d1.v * n.v);
  return Math.hypot(d2.u - (d1.u - k * n.u), d2.v - (d1.v - k * n.v));
}

/** Evita rebotar justo en las bocas de las porterías (arriba y abajo del círculo, antes de girar la cámara). */
const inGate = (theta: number): boolean => Math.abs(Math.cos(theta)) < 0.3 && Math.abs(Math.sin(theta)) > 0.7;

function candidates(a: Unit, b: Unit): number[] {
  const n = 720;
  const err: number[] = [];
  for (let i = 0; i < n; i += 1) err.push(reflectionError(a, b, (i / n) * 2 * Math.PI));
  const found: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = err[(i + n - 1) % n] ?? 1;
    const cur = err[i] ?? 1;
    const next = err[(i + 1) % n] ?? 1;
    if (cur >= prev || cur > next || cur > 0.15) continue;
    // Refinado por búsqueda ternaria entre los dos vecinos.
    let lo = ((i - 1) / n) * 2 * Math.PI;
    let hi = ((i + 1) / n) * 2 * Math.PI;
    for (let k = 0; k < 24; k += 1) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (reflectionError(a, b, m1) < reflectionError(a, b, m2)) hi = m2;
      else lo = m1;
    }
    const theta = (lo + hi) / 2;
    if (reflectionError(a, b, theta) < 0.03 && !inGate(theta)) found.push(theta);
  }
  return found;
}

/** Ruta del balón entre dos puntos: recta o con una banda en la pared, según el nivel y la semilla (determinista). */
export function routeBetween(a: Unit, b: Unit, seed: number, level: BounceLevel): Route {
  const cfg = LEVELS[level];
  const direct = dist(a, b);
  if (level === 'off' || direct < cfg.minLength) return straight(a, b);
  // «Dado» determinista del tramo (0–1) y otro para elegir entre las bandas posibles.
  const roll = ((Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0) % 10000) / 10000;
  if (roll >= cfg.chance) return straight(a, b);
  const options = candidates(a, b)
    .map((theta) => {
      const p = { u: WALL * Math.cos(theta), v: WALL * Math.sin(theta) };
      return { p, length: dist(a, p) + dist(p, b) };
    })
    .filter((o) => o.length <= direct * 2.6 + 0.6);
  if (options.length === 0) return straight(a, b);
  options.sort((x, y) => x.length - y.length);
  const pick = options[Math.floor((((Math.imul(seed, 40503) >>> 0) % 1000) / 1000) * options.length)] ?? options[0];
  if (pick === undefined) return straight(a, b);
  const l1 = dist(a, pick.p);
  return { pts: [a, pick.p, b], cum: [0, l1, pick.length], length: pick.length, bounceAt: l1 / pick.length };
}

/** Punto de la ruta tras recorrer la fracción `f` (0–1) de su longitud. */
export function pointOnRoute(route: Route, f: number): Unit {
  const target = Math.min(Math.max(f, 0), 1) * route.length;
  for (let i = 1; i < route.pts.length; i += 1) {
    const c1 = route.cum[i] ?? 0;
    if (target <= c1 || i === route.pts.length - 1) {
      const c0 = route.cum[i - 1] ?? 0;
      const a = route.pts[i - 1];
      const b = route.pts[i];
      if (a === undefined || b === undefined) break;
      const k = c1 - c0 <= 1e-9 ? 1 : (target - c0) / (c1 - c0);
      return { u: a.u + (b.u - a.u) * k, v: a.v + (b.v - a.v) * k };
    }
  }
  return route.pts[route.pts.length - 1] ?? { u: 0, v: 0 };
}

/** El balón rueda y frena: ligera deceleración en pases y conducciones (los tiros salen a velocidad constante). */
const EASE = 1.35;
export const easeOut = (s: number): number => 1 - (1 - Math.min(Math.max(s, 0), 1)) ** EASE;
export const easeOutInverse = (f: number): number => 1 - (1 - Math.min(Math.max(f, 0), 1)) ** (1 / EASE);
