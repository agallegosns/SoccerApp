import type { Actor, BallSegment, ClockSegment, MatchScript, Pace, Phase, ScriptEvent } from './types.ts';

/**
 * Factor de tiempo del ritmo rápido sobre las fases de juego. Las fases de intro, descanso y final no se comprimen tanto
 * (hay que poder leer las tarjetas), pero sí se acortan: así el gancho de los primeros segundos llega antes.
 */
export const FAST_PLAY_SCALE = 0.75;
/** Con muchos goles el juego se comprime más para que el vídeo rápido ronde los 26 s (límite pedido: 20-30 s). */
export const FAST_MAX_SECONDS = 26;
export const FAST_MIN_SCALE = 0.26;
const FAST_FIXED_SECONDS: Readonly<Record<string, number>> = { intro: 1, halftime: 1.4, fulltime: 2.4 };

/** Factor de tiempo del juego en ritmo rápido para este guion (entre FAST_MIN_SCALE y FAST_PLAY_SCALE). */
function fastScale(script: MatchScript): number {
  let fixed = 0;
  let play = 0;
  for (const p of script.phases) {
    const fixedSeconds = FAST_FIXED_SECONDS[p.kind];
    if (fixedSeconds === undefined) play += p.t1 - p.t0;
    else fixed += fixedSeconds;
  }
  if (play <= 0) return FAST_PLAY_SCALE;
  return Math.min(FAST_PLAY_SCALE, Math.max(FAST_MIN_SCALE, (FAST_MAX_SECONDS - fixed) / play));
}

/** Duración (s) que tendrá cada fase con el ritmo dado. */
function newDuration(phase: Phase, scale: number): number {
  return FAST_FIXED_SECONDS[phase.kind] ?? (phase.t1 - phase.t0) * scale;
}

/**
 * Cambia el ritmo de un guion ya generado deformando el tiempo por tramos (función monótona lineal por fases). Los sucesos, su orden,
 * el marcador, los minutos de reloj y las jugadas son exactamente los mismos: sólo cambian los instantes en que ocurren. Así la misma
 * semilla da el mismo partido en ambos ritmos.
 */
export function retime(script: MatchScript, pace: Pace): MatchScript {
  if (pace === 'normal') return { ...script, pace, timeScale: 1 };
  const k = fastScale(script);
  const knots = script.phases.map((p) => ({ oldStart: p.t0, oldEnd: p.t1, newStart: 0, newEnd: 0 }));
  let cursor = 0;
  script.phases.forEach((p, i) => {
    const knot = knots[i];
    if (knot === undefined) return;
    knot.newStart = cursor;
    cursor += newDuration(p, k);
    knot.newEnd = cursor;
  });
  const warp = (t: number): number => {
    const knot = knots.find((k) => t <= k.oldEnd + 1e-9) ?? knots.at(-1);
    if (knot === undefined) return t;
    const span = knot.oldEnd - knot.oldStart;
    const p = span <= 0 ? 1 : (t - knot.oldStart) / span;
    return knot.newStart + p * (knot.newEnd - knot.newStart);
  };
  const phases: Phase[] = script.phases.map((p) => ({ ...p, t0: warp(p.t0), t1: warp(p.t1) }));
  const ball: BallSegment[] = script.ball.map((s) => ({ ...s, t0: warp(s.t0), t1: warp(s.t1) }));
  const actors: Actor[] = script.actors
    .map((a) => ({ ...a, t0: warp(a.t0), t1: warp(a.t1), rampIn: a.rampIn * k, rampOut: a.rampOut * k }))
    .sort((x, y) => x.t0 - x.rampIn - (y.t0 - y.rampIn));
  const events: ScriptEvent[] = script.events.map((e) => ({ ...e, t: warp(e.t) }));
  const clock: ClockSegment[] = script.clock.map((c) => ({ ...c, t0: warp(c.t0), t1: warp(c.t1) }));
  return { ...script, pace, timeScale: k, duration: cursor, halftimeMid: warp(script.halftimeMid), phases, ball, actors, events, clock };
}
