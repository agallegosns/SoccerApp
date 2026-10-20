import type { Actor, BallSegment, ClockSegment, MatchScript, Pace, Phase, ScriptEvent } from './types.ts';

/**
 * Factor de tiempo del ritmo rápido sobre las fases de juego. Las fases de intro, descanso y final no se comprimen tanto
 * (hay que poder leer las tarjetas), pero sí se acortan: así el gancho de los primeros segundos llega antes.
 */
export const FAST_PLAY_SCALE = 0.6;
const FAST_FIXED_SECONDS: Readonly<Record<string, number>> = { intro: 1.3, halftime: 1.9, fulltime: 2.8 };

/** Duración (s) que tendrá cada fase con el ritmo dado. */
function newDuration(phase: Phase, pace: Pace): number {
  const old = phase.t1 - phase.t0;
  if (pace === 'normal') return old;
  return FAST_FIXED_SECONDS[phase.kind] ?? old * FAST_PLAY_SCALE;
}

/**
 * Cambia el ritmo de un guion ya generado deformando el tiempo por tramos (función monótona lineal por fases). Los sucesos, su orden,
 * el marcador, los minutos de reloj y las jugadas son exactamente los mismos: sólo cambian los instantes en que ocurren. Así la misma
 * semilla da el mismo partido en ambos ritmos.
 */
export function retime(script: MatchScript, pace: Pace): MatchScript {
  if (pace === 'normal') return { ...script, pace, timeScale: 1 };
  const knots = script.phases.map((p) => ({ oldStart: p.t0, oldEnd: p.t1, newStart: 0, newEnd: 0 }));
  let cursor = 0;
  script.phases.forEach((p, i) => {
    const knot = knots[i];
    if (knot === undefined) return;
    knot.newStart = cursor;
    cursor += newDuration(p, pace);
    knot.newEnd = cursor;
  });
  const warp = (t: number): number => {
    const knot = knots.find((k) => t <= k.oldEnd + 1e-9) ?? knots.at(-1);
    if (knot === undefined) return t;
    const span = knot.oldEnd - knot.oldStart;
    const p = span <= 0 ? 1 : (t - knot.oldStart) / span;
    return knot.newStart + p * (knot.newEnd - knot.newStart);
  };
  const k = FAST_PLAY_SCALE;
  const phases: Phase[] = script.phases.map((p) => ({ ...p, t0: warp(p.t0), t1: warp(p.t1) }));
  const ball: BallSegment[] = script.ball.map((s) => ({ ...s, t0: warp(s.t0), t1: warp(s.t1) }));
  const actors: Actor[] = script.actors
    .map((a) => ({ ...a, t0: warp(a.t0), t1: warp(a.t1), rampIn: a.rampIn * k, rampOut: a.rampOut * k }))
    .sort((x, y) => x.t0 - x.rampIn - (y.t0 - y.rampIn));
  const events: ScriptEvent[] = script.events.map((e) => ({ ...e, t: warp(e.t) }));
  const clock: ClockSegment[] = script.clock.map((c) => ({ ...c, t0: warp(c.t0), t1: warp(c.t1) }));
  return { ...script, pace, timeScale: k, duration: cursor, halftimeMid: warp(script.halftimeMid), phases, ball, actors, events, clock };
}
