export type Side = 'home' | 'away';
export interface Vec {
  readonly x: number;
  readonly y: number;
}

/** Campo en metros. x: ancho (0–68); y: largo (0–105). Vista vertical: y=0 es la portería de arriba. */
export const PITCH_W = 68;
export const PITCH_L = 105;
export const GOAL_HALF_WIDTH = 3.66;
export const CENTER: Vec = { x: PITCH_W / 2, y: PITCH_L / 2 };

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpVec = (a: Vec, b: Vec, t: number): Vec => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const smoothstep = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Sentido de ataque en el eje y: −1 hacia y=0 (arriba), +1 hacia y=105 (abajo). Los equipos cambian de campo en la 2ª parte. */
export function attackDir(side: Side, half: 1 | 2): -1 | 1 {
  return (side === 'home') === (half === 1) ? -1 : 1;
}

/** Coordenada y de la línea de la portería que ataca `side`. */
export function goalLineY(side: Side, half: 1 | 2): number {
  return attackDir(side, half) < 0 ? 0 : PITCH_L;
}

/**
 * Coordenadas «de equipo» → campo. `l` ∈ [0,1] lateral (0 = su izquierda), `d` ∈ [0,1] profundidad
 * (0 = su portería, 1 = la portería rival).
 */
export function toAbs(side: Side, half: 1 | 2, l: number, d: number): Vec {
  return attackDir(side, half) < 0
    ? { x: l * PITCH_W, y: PITCH_L * (1 - d) }
    : { x: (1 - l) * PITCH_W, y: PITCH_L * d };
}

export function toFrame(side: Side, half: 1 | 2, p: Vec): { l: number; d: number } {
  return attackDir(side, half) < 0
    ? { l: p.x / PITCH_W, d: 1 - p.y / PITCH_L }
    : { l: 1 - p.x / PITCH_W, d: p.y / PITCH_L };
}
