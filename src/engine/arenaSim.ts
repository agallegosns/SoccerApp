import { clockLabel, frameAt } from './animate.ts';
import { FORMATION_IDS, FORMATIONS } from './formations.ts';
import { clamp, type Side } from './geometry.ts';
import type { Simulation } from './index.ts';
import { Rng, hashString } from './rng.ts';
import { teamStyles } from './style.ts';
import type { ClockSegment, EventType, MatchScript, Phase, ResolvedTeam, ScriptEvent, SimulationInput, TeamStats } from './types.ts';

/**
 * Simulación FÍSICA del estilo «Arena». No hay guion: dos escudos (con una IA sencilla que persigue el balón y lo golpea hacia la portería
 * en la que marcan, con errores y tirones aleatorios) y un balón se mueven dentro de un aro con las leyes de la física (inercia, rozamiento,
 * choques elásticos con la pared y entre sí). Las dos porterías giran alrededor del aro. **Los goles, tiros y paradas salen del propio
 * movimiento**: nadie decide el marcador. Todo es determinista por semilla (mismo partido ⇒ mismo resultado), se precalcula con paso fijo y
 * es una función pura del tiempo, así que se puede saltar a cualquier instante del vídeo.
 *
 * Unidades: círculo de radio 1 (u a la derecha, v hacia abajo), segundos.
 */
export const BALL_R = 0.06;
export const DISC_R = 0.162;
/** Semiancho de la boca de cada portería y su profundidad. */
export const MOUTH_HALF = 0.2;
export const GATE_DEPTH = 0.2;

/** Elasticidad de la pared (nivel «Rebotes» del vídeo): cuánto del impulso conserva el balón al chocar. */
export type BounceLevel = 'off' | 'low' | 'normal' | 'high';
const WALL_E: Readonly<Record<BounceLevel, number>> = { off: 0.3, low: 0.6, normal: 0.85, high: 0.98 };
const FRICTION: Readonly<Record<BounceLevel, number>> = { off: 1.1, low: 0.8, normal: 0.55, high: 0.3 };

const DT = 1 / 240;
const STORE_EVERY = 2;
export const TRACK_STEP = DT * STORE_EVERY;
const STRIDE = 9;

const DISC_MAX_R = 1 - DISC_R * 0.55;
const BALL_MAX_SPEED = 5;
const DISC_SPEED = 2.1;
const DISC_SPRINT = 2.7;
const DISC_ACCEL = 12;
const DISC_MASS = 6;
const BALL_MASS = 1;
/** Tras un gol el juego se detiene lo que dura el cartel de gol (`frameAt`: 2,2 s × timeScale, mínimo 1,5 s) más un respiro: el cartel desaparece antes de que se vuelva a jugar. */
const BANNER_SCALE = { fast: 0.7, normal: 1 } as const;
const bannerSeconds = (scale: number): number => Math.max(1.5, 2.2 * scale);

/** Ángulo de las porterías en el instante `t`: giran de forma continua, con un balanceo que depende de la semilla. */
export function gateAngle(seed: number, t: number): number {
  const phase = ((seed >>> 0) % 628) / 100;
  return 0.5 * t + 0.4 * Math.sin(0.6 * t + phase);
}

/** Vector unitario hacia la portería «de arriba» (la otra es la opuesta) en el instante `t`. */
export function topGateDir(seed: number, t: number): { u: number; v: number } {
  const a = gateAngle(seed, t);
  return { u: Math.sin(a), v: -Math.cos(a) };
}

/** Portería en la que marca cada equipo: en la 1.ª parte el local marca en la de arriba; en la 2.ª se cambian. */
export const scoresAtTop = (side: Side, half: 1 | 2): boolean => (side === 'home') === (half === 1);

export interface Touch {
  readonly t: number;
  readonly side: Side;
  readonly u: number;
  readonly v: number;
  /** Dirección del balón al salir (unitaria) y fuerza 0–1. */
  readonly du: number;
  readonly dv: number;
  readonly power: number;
}

export interface WallHit {
  readonly t: number;
  readonly u: number;
  readonly v: number;
  readonly power: number;
}

export interface ArenaTrack {
  readonly seed: number;
  readonly step: number;
  /** Por muestra: balón (u, v, opacidad), escudo local (u, v), escudo visitante (u, v), rodadura acumulada y último que tocó (0 local, 1 visitante, −1 nadie). */
  readonly data: Float32Array;
  readonly touches: readonly Touch[];
  readonly wallHits: readonly WallHit[];
  readonly summary: { readonly touches: Readonly<Record<Side, number>> };
}

export interface ArenaSample {
  readonly ball: { readonly u: number; readonly v: number; readonly alpha: number };
  readonly home: { readonly u: number; readonly v: number };
  readonly away: { readonly u: number; readonly v: number };
  readonly roll: number;
  readonly touch: -1 | 0 | 1;
}

/** Muestra de la pista en `t` (interpolación lineal). */
export function sampleAt(track: ArenaTrack, t: number): ArenaSample {
  const n = track.data.length / STRIDE;
  const f = clamp(t / track.step, 0, n - 1.001);
  const i = Math.floor(f);
  const w = f - i;
  const g = (k: number): number => track.data[i * STRIDE + k] ?? 0;
  const g2 = (k: number): number => track.data[(i + 1) * STRIDE + k] ?? 0;
  const l = (k: number): number => g(k) + (g2(k) - g(k)) * w;
  const touch = g(8);
  return {
    ball: { u: l(0), v: l(1), alpha: l(2) },
    home: { u: l(3), v: l(4) },
    away: { u: l(5), v: l(6) },
    roll: l(7),
    touch: touch < -0.5 ? -1 : touch > 0.5 ? 1 : 0,
  };
}

/** Peso de posesión continuo (quién ha tocado el balón en el último instante). */
export function possessionOf(track: ArenaTrack, t: number): { home: number; away: number } {
  let home = 0;
  let away = 0;
  const N = 10;
  for (let k = 0; k < N; k += 1) {
    const s = sampleAt(track, Math.max(0, t - k * 0.08));
    if (s.touch === 0) home += 1;
    else if (s.touch === 1) away += 1;
  }
  return { home: home / N, away: away / N };
}

interface Vec2 {
  u: number;
  v: number;
}

interface Disc {
  p: Vec2;
  vel: Vec2;
  side: Side;
  /** Siguiente cambio de «tirón» aleatorio, y el tirón actual. */
  wanderAt: number;
  wander: Vec2;
  /** Error: hasta `until` el escudo va a un punto cualquiera en lugar de al balón. */
  mistakeUntil: number;
  mistake: Vec2;
  nextMistake: number;
}

const len = (a: Vec2): number => Math.hypot(a.u, a.v);

function plan(pace: SimulationInput['pace']): { intro: number; half: number; halftime: number; outro: number } {
  return pace === 'normal' ? { intro: 2.2, half: 20, halftime: 2.4, outro: 3.6 } : { intro: 1, half: 10.6, halftime: 1.4, outro: 2.4 };
}

const other = (side: Side): Side => (side === 'home' ? 'away' : 'home');

interface DraftEvent {
  t: number;
  type: EventType;
  side: Side | null;
  text: string;
}

export function simulateArena(input: SimulationInput, bounce: BounceLevel = 'normal'): Simulation {
  if (!Number.isInteger(input.seed)) throw new RangeError('La semilla debe ser un número entero');
  const rng = new Rng((input.seed ^ hashString(`${input.home}|${input.away}`) ^ 0xa17e4a) >>> 0);
  const styles = teamStyles(input.home, input.away);
  const formation = FORMATION_IDS[0] ?? '4-4-2';
  const resolve = (side: Side, name: string): ResolvedTeam => {
    const slots = FORMATIONS[formation];
    return { side, name, formation, style: styles[side], numbers: slots.map((_, i) => i + 1), roles: slots.map((s) => s.role) };
  };
  const teams = { home: resolve('home', input.home), away: resolve('away', input.away) };

  // ---- Línea de tiempo ----
  const pl = plan(input.pace ?? 'fast');
  const h1 = { start: pl.intro, end: pl.intro + pl.half };
  const h2 = { start: h1.end + pl.halftime, end: h1.end + pl.halftime + pl.half };
  const duration = h2.end + pl.outro;
  const halftimeMid = h1.end + pl.halftime / 2;
  const halfOf = (t: number): 1 | 2 | null => (t >= h1.start && t < h1.end ? 1 : t >= h2.start && t < h2.end ? 2 : null);

  // Ventanas de «sprint»: un equipo recibe un impulso de velocidad durante un par de segundos.
  const sprints: { t0: number; t1: number; side: Side }[] = [];
  const phases: Phase[] = [{ kind: 'intro', side: null, t0: 0, t1: pl.intro }];
  for (const [start, end] of [[h1.start, h1.end], [h2.start, h2.end]] as const) {
    let t = start;
    while (t < end - 0.05) {
      const gap = Math.min(rng.float(1.1, 2.6), end - t);
      phases.push({ kind: 'possession', side: null, t0: t, t1: t + gap });
      t += gap;
      if (t >= end - 0.6) {
        const last = phases.at(-1);
        if (last !== undefined) phases[phases.length - 1] = { ...last, t1: end };
        break;
      }
      const dur = Math.min(rng.float(1.4, 2.2), end - t);
      const side: Side = rng.chance(0.5) ? 'home' : 'away';
      phases.push({ kind: 'attack', side, t0: t, t1: t + dur });
      sprints.push({ t0: t, t1: t + dur, side });
      t += dur;
    }
    if (end === h1.end) phases.push({ kind: 'halftime', side: null, t0: h1.end, t1: h2.start });
  }
  phases.push({ kind: 'fulltime', side: null, t0: h2.end, t1: duration });
  const sprintSide = (t: number): Side | null => sprints.find((s) => t >= s.t0 && t < s.t1)?.side ?? null;

  // ---- Estado físico ----
  const kickoffDiscs = (): [Vec2, Vec2] => {
    const a = rng.float(0, Math.PI * 2);
    return [{ u: Math.cos(a) * 0.55, v: Math.sin(a) * 0.55 }, { u: -Math.cos(a) * 0.55, v: -Math.sin(a) * 0.55 }];
  };
  const [p0, p1] = kickoffDiscs();
  const mk = (side: Side, p: Vec2): Disc => ({ p: { ...p }, vel: { u: 0, v: 0 }, side, wanderAt: 0, wander: { u: 0, v: 0 }, mistakeUntil: -1, mistake: { u: 0, v: 0 }, nextMistake: rng.float(0.6, 1.6) });
  const discs: [Disc, Disc] = [mk('home', p0), mk('away', p1)];
  const ball = { p: { u: 0, v: 0 }, vel: { u: 0, v: 0 }, alpha: 1 };
  let scoredAt = -1; // inicio de la celebración tras un gol
  let scoredGate: { top: boolean; lat: number } | null = null;
  let lastTouch: -1 | 0 | 1 = -1;
  let roll = 0;
  let pendingShot: { side: Side; t: number } | null = null;
  let lastShot: Record<Side, number> = { home: -9, away: -9 };
  const lastDiscTouch: [number, number] = [-9, -9];
  let stall = 0;

  const touches: Touch[] = [];
  const wallHits: WallHit[] = [];
  const draft: DraftEvent[] = [];
  const touchCount: Record<Side, number> = { home: 0, away: 0 };
  const goals: Record<Side, number> = { home: 0, away: 0 };
  const celebration = bannerSeconds(BANNER_SCALE[input.pace ?? 'fast']) + 0.2;
  const wallE = WALL_E[bounce];
  const friction = FRICTION[bounce];

  const nSteps = Math.ceil(duration / DT) + 1;
  const nSamples = Math.floor(nSteps / STORE_EVERY) + 2;
  const data = new Float32Array(nSamples * STRIDE);

  const respawnBall = (): void => {
    const spots: Vec2[] = [{ u: 0, v: 0 }];
    for (let k = 0; k < 12; k += 1) spots.push({ u: Math.cos(k * 0.52) * 0.3, v: Math.sin(k * 0.52) * 0.3 });
    const free = spots.find((s) => discs.every((d) => Math.hypot(d.p.u - s.u, d.p.v - s.v) > DISC_R + BALL_R + 0.08)) ?? { u: 0, v: 0 };
    ball.p = { ...free };
    const a = rng.float(0, Math.PI * 2);
    ball.vel = { u: Math.cos(a) * 0.5, v: Math.sin(a) * 0.5 };
    ball.alpha = 0;
    scoredAt = -1;
    scoredGate = null;
    lastTouch = -1;
    pendingShot = null;
  };

  const emit = (t: number, type: EventType, side: Side | null, text: string): void => {
    draft.push({ t, type, side, text });
  };

  /** ¿El balón, con su velocidad actual, entra por la boca de la portería en la que marca `side`? (aproximación recta; la portería gira poco). */
  const aimsAtGoal = (side: Side, half: 1 | 2, t: number): boolean => {
    const speed = len(ball.vel);
    if (speed < 1.1) return false;
    const gTop = topGateDir(input.seed, t);
    const sign = scoresAtTop(side, half) ? 1 : -1;
    const g = { u: gTop.u * sign, v: gTop.v * sign };
    const tangent = { u: -g.v, v: g.u };
    const dirU = ball.vel.u / speed;
    const dirV = ball.vel.v / speed;
    const toward = dirU * g.u + dirV * g.v;
    if (toward < 0.25) return false;
    const along = ball.p.u * g.u + ball.p.v * g.v;
    const reach = (1 - along) / toward;
    const hit = { u: ball.p.u + dirU * reach, v: ball.p.v + dirV * reach };
    const lat = hit.u * tangent.u + hit.v * tangent.v;
    return Math.abs(lat) < MOUTH_HALF + 0.12 && reach < 2.2;
  };

  const clampDisc = (d: Disc): void => {
    const r = len(d.p);
    if (r > DISC_MAX_R) {
      const nx = d.p.u / r;
      const ny = d.p.v / r;
      d.p = { u: nx * DISC_MAX_R, v: ny * DISC_MAX_R };
      const vn = d.vel.u * nx + d.vel.v * ny;
      if (vn > 0) d.vel = { u: d.vel.u - 1.5 * vn * nx, v: d.vel.v - 1.5 * vn * ny };
    }
  };

  for (let s = 0; s < nSteps; s += 1) {
    const t = s * DT;
    const half = halfOf(t);
    if (s > 0 && t >= halftimeMid && t - DT < halftimeMid) {
      // Saque inicial de la 2.ª parte (queda tapado por la tarjeta del descanso).
      const [a, b] = kickoffDiscs();
      discs[0].p = { ...a };
      discs[1].p = { ...b };
      discs[0].vel = { u: 0, v: 0 };
      discs[1].vel = { u: 0, v: 0 };
      respawnBall();
      ball.alpha = 1;
      ball.vel = { u: 0, v: 0 };
      if (scoredAt >= 0) scoredAt = -1;
    }
    if (half !== null) {
      const gTop = topGateDir(input.seed, t);
      // --- Celebración tras un gol: el balón queda dentro de la red y la portería lo lleva consigo ---
      if (scoredAt >= 0 && scoredGate !== null) {
        const sign = scoredGate.top ? 1 : -1;
        const tangent = { u: -gTop.v, v: gTop.u };
        ball.p = { u: sign * gTop.u * (1 + GATE_DEPTH * 0.55) + tangent.u * scoredGate.lat, v: sign * gTop.v * (1 + GATE_DEPTH * 0.55) + tangent.v * scoredGate.lat };
        ball.vel = { u: 0, v: 0 };
        const since = t - scoredAt;
        ball.alpha = since > celebration - 0.3 ? 0 : 1;
        if (since >= celebration) respawnBall();
      }
      // --- Escudos: IA + física ---
      for (const d of discs) {
        const sprint = sprintSide(t) === d.side;
        const gs = scoresAtTop(d.side, half) ? 1 : -1;
        const goalDir = { u: gTop.u * gs, v: gTop.v * gs };
        const goalPoint = { u: goalDir.u * 1.15, v: goalDir.v * 1.15 };
        const live = scoredAt < 0 && ball.alpha > 0.5;
        const predicted = { u: ball.p.u + ball.vel.u * 0.16, v: ball.p.v + ball.vel.v * 0.16 };
        let target: Vec2;
        let drive = false;
        if (live) {
          let toGoal = { u: goalPoint.u - predicted.u, v: goalPoint.v - predicted.v };
          const tl = len(toGoal) || 1;
          toGoal = { u: toGoal.u / tl, v: toGoal.v / tl };
          const rel = { u: d.p.u - predicted.u, v: d.p.v - predicted.v };
          const standoff = DISC_R + BALL_R + 0.03;
          const behindAmount = rel.u * toGoal.u + rel.v * toGoal.v;
          if (behindAmount > -0.05) {
            // Está delante o al lado del balón: rodea por su lado hasta ponerse detrás.
            const side = Math.sign(toGoal.u * rel.v - toGoal.v * rel.u) || 1;
            const perp = { u: -toGoal.v * side, v: toGoal.u * side };
            target = { u: predicted.u - toGoal.u * 0.28 + perp.u * (standoff + 0.12), v: predicted.v - toGoal.v * 0.28 + perp.v * (standoff + 0.12) };
          } else {
            const strike = { u: predicted.u - toGoal.u * standoff, v: predicted.v - toGoal.v * standoff };
            const gap = Math.hypot(strike.u - d.p.u, strike.v - d.p.v);
            if (gap < 0.22) {
              target = { u: predicted.u + toGoal.u * 0.4, v: predicted.v + toGoal.v * 0.4 };
              drive = true;
            } else target = strike;
          }
        } else {
          target = { u: 0, v: 0 };
        }
        // Errores y tirones aleatorios: lo que hace que no sea previsible.
        if (t >= d.nextMistake) {
          if (rng.chance(0.28)) {
            d.mistakeUntil = t + rng.float(0.25, 0.6);
            const a = rng.float(0, Math.PI * 2);
            const r = rng.float(0.2, 0.75);
            d.mistake = { u: Math.cos(a) * r, v: Math.sin(a) * r };
          }
          d.nextMistake = t + rng.float(0.7, 1.7);
        }
        if (t < d.mistakeUntil) target = d.mistake;
        if (t >= d.wanderAt) {
          const a = rng.float(0, Math.PI * 2);
          const m = rng.float(0, 2.2);
          d.wander = { u: Math.cos(a) * m, v: Math.sin(a) * m };
          d.wanderAt = t + rng.float(0.25, 0.6);
        }
        const kp = 22;
        const kd = 6.5;
        let au = kp * (target.u - d.p.u) - kd * d.vel.u + d.wander.u;
        let av = kp * (target.v - d.p.v) - kd * d.vel.v + d.wander.v;
        const amax = DISC_ACCEL * (drive ? 1.4 : 1) * (sprint ? 1.25 : 1);
        const al = Math.hypot(au, av);
        if (al > amax) {
          au = (au / al) * amax;
          av = (av / al) * amax;
        }
        d.vel = { u: d.vel.u + au * DT, v: d.vel.v + av * DT };
        const vmax = (sprint ? DISC_SPRINT : DISC_SPEED) * (drive ? 1.15 : 1);
        const vl = len(d.vel);
        if (vl > vmax) d.vel = { u: (d.vel.u / vl) * vmax, v: (d.vel.v / vl) * vmax };
        d.p = { u: d.p.u + d.vel.u * DT, v: d.p.v + d.vel.v * DT };
        clampDisc(d);
      }
      // Choque entre escudos.
      {
        const [a, b] = discs;
        const dx = b.p.u - a.p.u;
        const dy = b.p.v - a.p.v;
        const d = Math.hypot(dx, dy);
        const min = DISC_R * 2;
        if (d < min) {
          const nx = d < 1e-6 ? 1 : dx / d;
          const ny = d < 1e-6 ? 0 : dy / d;
          const push = (min - d) / 2;
          a.p = { u: a.p.u - nx * push, v: a.p.v - ny * push };
          b.p = { u: b.p.u + nx * push, v: b.p.v + ny * push };
          const closing = (a.vel.u - b.vel.u) * nx + (a.vel.v - b.vel.v) * ny;
          if (closing > 0) {
            const j = ((1 + 0.75) * closing) / 2;
            a.vel = { u: a.vel.u - j * nx, v: a.vel.v - j * ny };
            b.vel = { u: b.vel.u + j * nx, v: b.vel.v + j * ny };
          }
          clampDisc(a);
          clampDisc(b);
        }
      }
      // --- Balón ---
      if (scoredAt < 0) {
        ball.alpha = Math.min(1, ball.alpha + DT * 4);
        const damp = Math.max(0, 1 - friction * DT);
        ball.vel = { u: ball.vel.u * damp, v: ball.vel.v * damp };
        const sp = len(ball.vel);
        if (sp > BALL_MAX_SPEED) ball.vel = { u: (ball.vel.u / sp) * BALL_MAX_SPEED, v: (ball.vel.v / sp) * BALL_MAX_SPEED };
        const before = { ...ball.p };
        ball.p = { u: ball.p.u + ball.vel.u * DT, v: ball.p.v + ball.vel.v * DT };
        for (let iter = 0; iter < 2; iter += 1) {
          // Choque con los escudos.
          for (const [k, d] of discs.entries()) {
            const dx = ball.p.u - d.p.u;
            const dy = ball.p.v - d.p.v;
            const dist = Math.hypot(dx, dy);
            const min = DISC_R + BALL_R;
            if (dist >= min) continue;
            const nx = dist < 1e-6 ? 1 : dx / dist;
            const ny = dist < 1e-6 ? 0 : dy / dist;
            ball.p = { u: d.p.u + nx * min, v: d.p.v + ny * min };
            const vrel = (ball.vel.u - d.vel.u) * nx + (ball.vel.v - d.vel.v) * ny;
            if (vrel >= 0) continue;
            const e = 0.9;
            const j = (-(1 + e) * vrel) / (1 / BALL_MASS + 1 / DISC_MASS);
            // Golpeo extra: el escudo «chuta» en la dirección en la que corre.
            const kick = 0.6 + 0.35 * Math.min(1, len(d.vel) / DISC_SPEED);
            ball.vel = { u: ball.vel.u + (j / BALL_MASS) * nx + nx * kick, v: ball.vel.v + (j / BALL_MASS) * ny + ny * kick };
            d.vel = { u: d.vel.u - (j / DISC_MASS) * nx, v: d.vel.v - (j / DISC_MASS) * ny };
            lastTouch = k === 0 ? 0 : 1;
            if (t - (lastDiscTouch[k] ?? -9) > 0.12 && -vrel > 0.15) {
              lastDiscTouch[k] = t;
              const side = d.side;
              touchCount[side] += 1;
              const out = len(ball.vel) || 1;
              touches.push({ t, side, u: ball.p.u - nx * BALL_R, v: ball.p.v - ny * BALL_R, du: ball.vel.u / out, dv: ball.vel.v / out, power: clamp(out / 3, 0, 1) });
              const teamName = teams[side].style.short;
              // ¿Parada? El rival había tirado a puerta y este escudo lo desvía.
              if (pendingShot !== null && pendingShot.side !== side && t - pendingShot.t < 1.4) {
                emit(t, 'save', side, `Parada de ${teamName}`);
                pendingShot = null;
              } else if (aimsAtGoal(side, half, t) && t - lastShot[side] > 1) {
                lastShot = { ...lastShot, [side]: t };
                pendingShot = { side, t };
                emit(t, 'shot', side, `Disparo de ${teamName}`);
              }
            }
          }
          // Pared del aro y portería.
          const tangent = { u: -gTop.v, v: gTop.u };
          const r = len(ball.p);
          const alongTop = ball.p.u * gTop.u + ball.p.v * gTop.v;
          const lat = ball.p.u * tangent.u + ball.p.v * tangent.v;
          const inMouth = Math.abs(lat) < MOUTH_HALF - BALL_R * 0.5 && Math.abs(alongTop) > 0.8 * r;
          if (inMouth) {
            const top = alongTop > 0;
            const sign = top ? 1 : -1;
            const along = alongTop * sign;
            if (along > 1 + BALL_R * 0.5 && scoredAt < 0) {
              const scorer: Side = scoresAtTop('home', half) === top ? 'home' : 'away';
              goals[scorer] += 1;
              scoredAt = t;
              scoredGate = { top, lat };
              if (t - lastShot[scorer] > 1.4) emit(t - 0.001, 'shot', scorer, `Disparo de ${teams[scorer].style.short}`);
              emit(t, 'goal', scorer, `¡Gol de ${teams[scorer].style.short}!`);
              pendingShot = null;
              lastShot = { ...lastShot, [scorer]: t };
              break;
            }
            // Paredes laterales y fondo de la red.
            if (r > 1 - BALL_R) {
              const maxLat = MOUTH_HALF - BALL_R * 0.5;
              if (Math.abs(lat) > maxLat) {
                const sl = Math.sign(lat);
                const vl = ball.vel.u * tangent.u + ball.vel.v * tangent.v;
                if (vl * sl > 0) ball.vel = { u: ball.vel.u - (1 + 0.5) * vl * tangent.u, v: ball.vel.v - (1 + 0.5) * vl * tangent.v };
              }
            }
          } else if (r > 1 - BALL_R) {
            const nx = ball.p.u / r;
            const ny = ball.p.v / r;
            ball.p = { u: nx * (1 - BALL_R), v: ny * (1 - BALL_R) };
            const vn = ball.vel.u * nx + ball.vel.v * ny;
            if (vn > 0) {
              ball.vel = { u: ball.vel.u - (1 + wallE) * vn * nx, v: ball.vel.v - (1 + wallE) * vn * ny };
              if (vn > 0.35) wallHits.push({ t, u: nx, v: ny, power: clamp(vn / 3, 0, 1) });
            }
          }
        }
        // Antibloqueo: si el balón queda clavado contra la pared entre los escudos, sale rebotado hacia dentro (como un balón que escapa).
        if (len(ball.vel) < 0.3 && len(ball.p) > 0.7) stall += DT;
        else stall = 0;
        if (stall > 0.55) {
          const r = len(ball.p) || 1;
          const side = rng.chance(0.5) ? 1 : -1;
          ball.vel = { u: (-ball.p.u / r) * 1.9 + (-ball.p.v / r) * side * 0.9, v: (-ball.p.v / r) * 1.9 + (ball.p.u / r) * side * 0.9 };
          stall = 0;
        }
        roll += Math.hypot(ball.p.u - before.u, ball.p.v - before.v);
      }
    }
    if (s % STORE_EVERY === 0) {
      const o = (s / STORE_EVERY) * STRIDE;
      data[o] = ball.p.u;
      data[o + 1] = ball.p.v;
      data[o + 2] = half === null && t < h1.start ? 1 : ball.alpha;
      data[o + 3] = discs[0].p.u;
      data[o + 4] = discs[0].p.v;
      data[o + 5] = discs[1].p.u;
      data[o + 6] = discs[1].p.v;
      data[o + 7] = roll;
      data[o + 8] = lastTouch;
    }
  }

  // ---- Guion derivado (sucesos, reloj, marcador): lo mismo que usa el resto de la aplicación ----
  const stoppage1 = rng.int(1, 3);
  const stoppage2 = rng.int(2, 5);
  const clock: ClockSegment[] = [
    { half: 1, t0: h1.start, t1: h1.end, m0: 0, m1: 45 + stoppage1 },
    { half: 2, t0: h2.start, t1: h2.end, m0: 45, m1: 90 + stoppage2 },
  ];
  const score = { home: goals.home, away: goals.away };
  const scoreBefore = (t: number): string => {
    let h = 0;
    let a = 0;
    for (const e of draft) {
      if (e.t > t || e.type !== 'goal') continue;
      if (e.side === 'home') h += 1;
      else a += 1;
    }
    return `${String(h)}–${String(a)}`;
  };
  const all: DraftEvent[] = ([
    { t: h1.start, type: 'kickoff', side: null, text: 'Saque inicial' },
    ...draft.filter((e) => halfOf(e.t) !== null),
    { t: halftimeMid, type: 'halftime', side: null, text: 'Descanso' },
    { t: duration - pl.outro + 0.2, type: 'fulltime', side: null, text: 'Final del partido' },
  ] satisfies DraftEvent[]).sort((x, y) => x.t - y.t);
  const events: ScriptEvent[] = all.map((e) => {
    const c = clockLabel(clock, e.t);
    const base = { t: e.t, type: e.type, side: e.side, shirt: null } as const;
    if (e.type === 'halftime') return { ...base, minute: c.minute, clock: 'DESCANSO', text: `Descanso: ${scoreBefore(e.t)}` };
    if (e.type === 'fulltime') return { ...base, minute: c.minute, clock: 'FIN', text: `Final: ${String(score.home)}–${String(score.away)}` };
    return { ...base, minute: c.minute, clock: c.label, text: e.text };
  });
  const countOf = (side: Side): TeamStats => ({
    shots: events.filter((e) => e.type === 'shot' && e.side === side).length,
    onTarget: events.filter((e) => (e.type === 'goal' && e.side === side) || (e.type === 'save' && e.side === other(side))).length,
    corners: 0,
    fouls: 0,
  });
  const script: MatchScript = {
    seed: input.seed,
    teams,
    score,
    scoreWasFixed: false,
    pace: input.pace ?? 'fast',
    timeScale: BANNER_SCALE[input.pace ?? 'fast'],
    duration,
    halftimeMid,
    phases,
    events,
    ball: [],
    actors: [],
    clock,
    stats: { home: countOf('home'), away: countOf('away') },
    jitter: Array.from({ length: 22 }, () => 0),
  };
  const arena: ArenaTrack = { seed: input.seed, step: TRACK_STEP, data, touches, wallHits, summary: { touches: touchCount } };
  return { input, script, frame: (t) => frameAt(script, t), arena };
}
