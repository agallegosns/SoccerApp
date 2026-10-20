import { PITCH_L, PITCH_W, clamp, smoothstep } from '../../engine/geometry.ts';

/** Geometría del estilo «Arena»: el campo se proyecta en un círculo con una portería arriba y otra abajo que giran con la cámara. */
export const ARENA = { cx: 540, cy: 1060, radius: 420 } as const;

/** Semiancho de la boca de portería en unidades del círculo (radio = 1). */
export const MOUTH_HALF = 0.11;
/** Profundidad de la portería (unidades del círculo). */
export const GATE_DEPTH = 0.2;
/** Radio del balón (unidades). */
export const BALL_R = 0.055;

/** Radio máximo permitido a un punto: dentro de la arena, salvo en la boca de la portería, que se abre hacia fuera. */
export function maxRadius(u: number): number {
  const open = smoothstep((MOUTH_HALF + 0.05 - Math.abs(u)) / 0.05);
  return 1 - BALL_R + (GATE_DEPTH + BALL_R) * open;
}

export interface Unit {
  readonly u: number;
  readonly v: number;
}

/**
 * Campo (metros) → círculo unidad (u a la derecha, v hacia abajo). Mapa cuadrado→disco con ejes conservados; lo que queda
 * fuera de la línea de gol (la red) se prolonga hacia fuera, de modo que un gol entra por la boca de la portería.
 * El resultado se limita al radio permitido: el balón no sale de la arena salvo por la portería.
 */
export function fieldToUnit(x: number, y: number): Unit {
  const nx = (x - PITCH_W / 2) / (PITCH_W / 2);
  const ny = (y - PITCH_L / 2) / (PITCH_L / 2);
  const cx = clamp(nx, -1, 1);
  const cy = clamp(ny, -1, 1);
  let u = cx * Math.sqrt(1 - (cy * cy) / 2) * 1.25;
  let v = cy * Math.sqrt(1 - (cx * cx) / 2);
  v += (ny - cy) * 9;
  u += (nx - cx) * 4;
  const r = Math.hypot(u, v);
  const limit = maxRadius(u);
  if (r > limit) {
    u = (u / r) * limit;
    v = (v / r) * limit;
  }
  return { u, v };
}

/** Giro de la cámara: las porterías (y todo el escenario) dan vueltas lentas, como en los vídeos virales de arena. */
export function cameraAngle(t: number): number {
  return 0.3 * t + 0.35 * Math.sin(t * 0.45);
}

export function rotate(p: Unit, angle: number): Unit {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { u: p.u * c - p.v * s, v: p.u * s + p.v * c };
}

export function toScreen(p: Unit): { x: number; y: number } {
  return { x: ARENA.cx + p.u * ARENA.radius, y: ARENA.cy + p.v * ARENA.radius };
}

/** Campo → pantalla con el giro de cámara en el instante `t`. */
export function fieldToScreen(x: number, y: number, t: number): { x: number; y: number } {
  return toScreen(rotate(fieldToUnit(x, y), cameraAngle(t)));
}
