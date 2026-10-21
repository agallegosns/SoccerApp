import { BALL_R, DISC_R as DISC_R_UNIT, GATE_DEPTH, MOUTH_HALF, gateAngle, possessionOf, sampleAt, type ArenaTrack } from '../../engine/arenaSim.ts';
import type { Simulation } from '../../engine/index.ts';
import type { Side } from '../../engine/geometry.ts';

/** Geometría del estilo «Arena»: el aro en el lienzo del vídeo. La física vive en `engine/arenaSim.ts` (círculo de radio 1). */
export const ARENA = { cx: 540, cy: 1060, radius: 420 } as const;
export { GATE_DEPTH, MOUTH_HALF };

/** Radio del escudo y del balón en la pantalla (px). */
export const DISC_R = DISC_R_UNIT * ARENA.radius;
export const BALL_PX = BALL_R * ARENA.radius;

export interface Unit {
  readonly u: number;
  readonly v: number;
}

export const toScreen = (p: Unit): { x: number; y: number } => ({ x: ARENA.cx + p.u * ARENA.radius, y: ARENA.cy + p.v * ARENA.radius });

/** Las porterías giran alrededor del aro (la «cámara» no gira). */
export function cameraAngle(sim: Simulation, t: number): number {
  return gateAngle(sim.script.seed, t);
}

function trackOf(sim: Simulation): ArenaTrack {
  if (sim.arena === undefined) throw new Error('La simulación no es del estilo Arena (falta la pista física)');
  return sim.arena;
}

/** Balón dibujado: posición en pantalla, opacidad (aparece tras un saque) y rodadura acumulada (px). */
export function ballState(sim: Simulation, t: number): { x: number; y: number; alpha: number; roll: number } {
  const s = sampleAt(trackOf(sim), t);
  const p = toScreen(s.ball);
  return { ...p, alpha: s.ball.alpha, roll: s.roll * ARENA.radius };
}

export function discPositions(sim: Simulation, t: number): Record<Side, { x: number; y: number }> {
  const s = sampleAt(trackOf(sim), t);
  return { home: toScreen(s.home), away: toScreen(s.away) };
}

export function possession(sim: Simulation, t: number): { home: number; away: number } {
  return possessionOf(trackOf(sim), t);
}

export const touchEvents = (sim: Simulation): ArenaTrack['touches'] => trackOf(sim).touches;
export const wallEvents = (sim: Simulation): ArenaTrack['wallHits'] => trackOf(sim).wallHits;
