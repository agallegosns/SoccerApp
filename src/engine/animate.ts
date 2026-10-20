import { FORMATIONS, type Slot } from './formations.ts';
import { PITCH_L, PITCH_W, attackDir, clamp, dist, lerp, lerpVec, smoothstep, toAbs, toFrame, type Side, type Vec } from './geometry.ts';
import type { Actor, BallSegment, ClockSegment, FrameState, MatchScript, Phase, PlayerFrame, ResolvedTeam, ScriptEvent, TeamStats } from './types.ts';

export const PLAYERS_PER_TEAM = 11;

export const sideOf = (player: number): Side => (player < PLAYERS_PER_TEAM ? 'home' : 'away');
export const slotOf = (player: number): number => player % PLAYERS_PER_TEAM;

function slotFor(team: ResolvedTeam, slotIndex: number): Slot {
  const slot = FORMATIONS[team.formation][slotIndex];
  if (slot === undefined) throw new Error(`Puesto inexistente: ${team.formation}[${String(slotIndex)}]`);
  return slot;
}

/**
 * Posición «de forma» de un jugador: su puesto en la formación desplazado según el balón, la posesión
 * y un movimiento de reposo determinista. No depende del azar: es función pura de (t, balón).
 */
export function shapePos(
  team: ResolvedTeam,
  slotIndex: number,
  half: 1 | 2,
  ball: Vec,
  /** Peso de posesión del equipo: 0 = defiende, 1 = tiene el balón (continuo en el tiempo). */
  possession: number,
  t: number,
  jitter: number,
): Vec {
  const slot = slotFor(team, slotIndex);
  const side = team.side;
  const bf = toFrame(side, half, ball);
  let l: number;
  let d: number;
  if (slot.role === 'GK') {
    d = 0.025 + 0.06 * bf.d;
    l = 0.5 + (bf.l - 0.5) * 0.22;
  } else {
    d = clamp(0.05 + slot.d * 0.8 + (bf.d - 0.5) * 0.3 + (-0.03 + 0.06 * possession), 0.04, 0.96);
    l = clamp(slot.l + (bf.l - 0.5) * 0.14, 0.03, 0.97);
  }
  let pos = toAbs(side, half, l, d);
  if (slot.role !== 'GK' && possession < 1) {
    const r = dist(pos, ball);
    const radius = 16;
    if (r < radius) {
      const pull = 0.35 * (1 - r / radius) * (1 - possession);
      pos = { x: pos.x + (ball.x - pos.x) * pull, y: pos.y + (ball.y - pos.y) * pull };
    }
  }
  const amp = slot.role === 'GK' ? 0.4 : 0.9;
  return {
    x: clamp(pos.x + amp * Math.sin(2 * Math.PI * (0.31 * t + jitter)), 0.5, PITCH_W - 0.5),
    y: clamp(pos.y + amp * Math.cos(2 * Math.PI * (0.27 * t + 1.7 * jitter)), 0.5, PITCH_L - 0.5),
  };
}

const POSSESSION_BLEND_SECONDS = 0.8;

const phaseValue = (phase: Phase, side: Side): number => (phase.side === null ? 0.4 : phase.side === side ? 1 : 0);

/** Peso de posesión de `side` en t: cambia suavemente al empezar cada fase para evitar saltos de los jugadores. */
export function possessionWeight(script: MatchScript, side: Side, t: number): number {
  const i = findIndex(script.phases, t);
  const cur = script.phases[i];
  if (cur === undefined) return 0.4;
  const prev = script.phases[i - 1];
  const value = phaseValue(cur, side);
  if (prev === undefined) return value;
  return lerp(phaseValue(prev, side), value, smoothstep((t - cur.t0) / (POSSESSION_BLEND_SECONDS * script.timeScale)));
}

/** Parte (1 o 2) en el instante t. */
export const halfAt = (script: MatchScript, t: number): 1 | 2 => (t < script.halftimeMid ? 1 : 2);

function findIndex(items: readonly { readonly t0: number }[], t: number): number {
  let lo = 0;
  let hi = items.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((items[mid]?.t0 ?? Infinity) <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function ballAt(script: MatchScript, t: number): { x: number; y: number; z: number; visible: boolean; seg: BallSegment | null } {
  const seg = script.ball[findIndex(script.ball, t)];
  if (seg === undefined) return { x: PITCH_W / 2, y: PITCH_L / 2, z: 0, visible: true, seg: null };
  const span = seg.t1 - seg.t0;
  const s = span <= 0 ? 1 : clamp((t - seg.t0) / span, 0, 1);
  const p = lerpVec(seg.from, seg.to, s);
  return { x: p.x, y: p.y, z: seg.arc * 4 * s * (1 - s), visible: seg.kind !== 'reset', seg };
}

export function actorTarget(actor: Actor, t: number): { pos: Vec; weight: number } | null {
  if (t < actor.t0 - actor.rampIn || t > actor.t1 + actor.rampOut) return null;
  if (t < actor.t0) return { pos: actor.from, weight: smoothstep((t - (actor.t0 - actor.rampIn)) / actor.rampIn) };
  if (t <= actor.t1) {
    const span = actor.t1 - actor.t0;
    return { pos: lerpVec(actor.from, actor.to, span <= 0 ? 1 : (t - actor.t0) / span), weight: 1 };
  }
  return { pos: actor.to, weight: 1 - smoothstep((t - actor.t1) / actor.rampOut) };
}

export function phaseAt(script: MatchScript, t: number): Phase {
  const phase = script.phases[findIndex(script.phases, t)];
  if (phase === undefined) throw new Error('El guion no tiene fases');
  return phase;
}

export function clockLabel(clock: readonly ClockSegment[], t: number): { minute: number; label: string } {
  const first = clock[0];
  const second = clock[1];
  if (first === undefined || second === undefined) return { minute: 0, label: "0'" };
  const seg = t < first.t0 ? null : t <= first.t1 ? first : t < second.t0 ? null : second;
  if (seg === null) {
    if (t < first.t0) return { minute: 0, label: "0'" };
    return t < second.t0 ? { minute: first.m1, label: 'DESCANSO' } : { minute: second.m1, label: 'FIN' };
  }
  const p = clamp((t - seg.t0) / (seg.t1 - seg.t0), 0, 1);
  const minute = lerp(seg.m0, seg.m1, p);
  const limit = seg.half === 1 ? 45 : 90;
  const whole = Math.floor(minute);
  const label = whole > limit ? `${String(limit)}+${String(whole - limit)}'` : `${String(Math.max(whole, seg.half === 1 ? 0 : 45))}'`;
  return { minute, label };
}

/** Marcador en el instante t: goles cuyo evento ya ha ocurrido. */
export function scoreAt(events: readonly ScriptEvent[], t: number): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === 'goal') {
      if (e.side === 'home') home += 1;
      else if (e.side === 'away') away += 1;
    }
  }
  return { home, away };
}

/** Estadísticas acumuladas hasta el instante t (cuenta los sucesos ya ocurridos). */
export function statsAt(events: readonly ScriptEvent[], t: number): { home: TeamStats; away: TeamStats } {
  const acc = {
    home: { shots: 0, onTarget: 0, corners: 0, fouls: 0 },
    away: { shots: 0, onTarget: 0, corners: 0, fouls: 0 },
  };
  for (const e of events) {
    if (e.t > t) break;
    if (e.side === null) continue;
    const other = e.side === 'home' ? 'away' : 'home';
    if (e.type === 'shot') acc[e.side].shots += 1;
    else if (e.type === 'goal') acc[e.side].onTarget += 1;
    else if (e.type === 'save') acc[other].onTarget += 1;
    else if (e.type === 'corner') acc[e.side].corners += 1;
    else if (e.type === 'foul') acc[e.side].fouls += 1;
  }
  return acc;
}

const GOAL_BANNER_SECONDS = 2.2;
const TICKER_SECONDS = 3;
/** Con el ritmo rápido el banner de gol y el rótulo duran menos, pero nunca menos de lo que se tarda en leerlos. */
const scaled = (seconds: number, scale: number, min: number): number => Math.max(min, seconds * scale);

/** Estado completo de la escena en el instante t (función pura; permite avanzar, retroceder y renderizar frame a frame). */
export function frameAt(script: MatchScript, rawT: number): FrameState {
  const t = clamp(rawT, 0, script.duration);
  const half = halfAt(script, t);
  const phase = phaseAt(script, t);
  const ball = ballAt(script, t);
  const ballPos: Vec = { x: ball.x, y: ball.y };
  const phaseProgress = phase.t1 > phase.t0 ? clamp((t - phase.t0) / (phase.t1 - phase.t0), 0, 1) : 1;

  const positions: Vec[] = [];
  const holding = new Set<number>();
  for (const team of [script.teams.home, script.teams.away]) {
    for (let i = 0; i < PLAYERS_PER_TEAM; i += 1) {
      const index = (team.side === 'home' ? 0 : PLAYERS_PER_TEAM) + i;
      const possession = possessionWeight(script, team.side, t);
      positions[index] = shapePos(team, i, half, ballPos, possession, t, script.jitter[index] ?? 0);
    }
  }
  // Los actores se componen en orden (cada uno mezcla con peso continuo), así no hay saltos si se solapan.
  for (const actor of script.actors) {
    if (actor.t0 - actor.rampIn > t) break;
    // Tras el cambio de campo ya no cuentan los actores de la primera parte (el salto queda oculto bajo la tarjeta de descanso).
    if (actor.t1 <= script.halftimeMid && t > script.halftimeMid) continue;
    const target = actorTarget(actor, t);
    const current = positions[actor.player];
    if (target === null || current === undefined) continue;
    positions[actor.player] = lerpVec(current, target.pos, target.weight);
    if (actor.holds && t >= actor.t0 && t <= actor.t1) holding.add(actor.player);
  }

  const players: PlayerFrame[] = [];
  for (const team of [script.teams.home, script.teams.away]) {
    for (let i = 0; i < PLAYERS_PER_TEAM; i += 1) {
      const index = (team.side === 'home' ? 0 : PLAYERS_PER_TEAM) + i;
      const pos = positions[index] ?? { x: PITCH_W / 2, y: PITCH_L / 2 };
      players.push({
        index,
        side: team.side,
        number: team.numbers[i] ?? i + 1,
        role: team.roles[i] ?? 'CM',
        x: clamp(pos.x, 0, PITCH_W),
        y: clamp(pos.y, 0, PITCH_L),
        hasBall: holding.has(index),
      });
    }
  }

  // Marcador, banner de gol y rótulo del último suceso.
  let goalBanner: FrameState['goalBanner'] = null;
  let ticker: FrameState['ticker'] = null;
  let home = 0;
  let away = 0;
  for (const e of script.events) {
    if (e.t > t) break;
    if (e.type === 'goal') {
      if (e.side === 'home') home += 1;
      else away += 1;
      const progress = (t - e.t) / scaled(GOAL_BANNER_SECONDS, script.timeScale, 1.5);
      if (progress <= 1 && e.side !== null) goalBanner = { side: e.side, shirt: e.shirt, clock: e.clock, progress };
    }
    if (t - e.t <= scaled(TICKER_SECONDS, script.timeScale, 1.8) && e.type !== 'kickoff' && e.type !== 'halftime' && e.type !== 'fulltime') ticker = { clock: e.clock, text: e.text };
  }

  let passLine: FrameState['passLine'] = null;
  if (ball.seg !== null && (ball.seg.kind === 'pass' || ball.seg.kind === 'cross')) {
    const span = ball.seg.t1 - ball.seg.t0;
    passLine = { from: ball.seg.from, to: ball.seg.to, progress: span <= 0 ? 1 : (t - ball.seg.t0) / span };
  }

  return {
    t,
    phase: phase.kind,
    phaseProgress,
    half,
    players,
    ball: { x: ball.x, y: ball.y, z: ball.z, visible: ball.visible },
    score: { home, away },
    clock: clockLabel(script.clock, t).label,
    goalBanner,
    ticker,
    possession: { home: possessionWeight(script, 'home', t), away: possessionWeight(script, 'away', t) },
    passLine,
  };
}

export { attackDir };
