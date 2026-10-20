import { clockLabel, PLAYERS_PER_TEAM, shapePos, sideOf, slotOf } from './animate.ts';
import { FORMATION_IDS, FORMATIONS, type Role } from './formations.ts';
import { CENTER, GOAL_HALF_WIDTH, PITCH_L, PITCH_W, attackDir, clamp, dist, goalLineY, toAbs, type Side, type Vec } from './geometry.ts';
import { Rng, hashString } from './rng.ts';
import { teamStyles } from './style.ts';
import type {
  Actor, BallKind, BallSegment, ClockSegment, EventType, MatchScript, Outcome, Phase, PhaseKind, ResolvedTeam, Score, ScriptEvent,
  SimulationInput, TeamStats,
} from './types.ts';

const INTRO_SECONDS = 2.2;
/** Tiempo del descanso hasta que todo se asienta (el cambio de campo ocurre justo después, con la pantalla cubierta). */
const HALFTIME_SETTLE_SECONDS = 1.4;
const HALFTIME_RESET_SECONDS = 1.0;
const OUTRO_SECONDS = 3.6;
const CELEBRATION_SECONDS = 2.1;
export const MAX_GOALS_PER_TEAM = 9;

const other = (side: Side): Side => (side === 'home' ? 'away' : 'home');
const global = (side: Side, slot: number): number => (side === 'home' ? 0 : PLAYERS_PER_TEAM) + slot;

type MomentKind = Outcome | 'foul';
interface Moment {
  readonly side: Side;
  readonly kind: MomentKind;
}

interface DraftEvent {
  readonly t: number;
  readonly type: EventType;
  readonly side: Side | null;
  readonly shirt: number | null;
  readonly text: string;
}

export function validateInput(input: SimulationInput): void {
  if (!Number.isInteger(input.seed)) throw new RangeError('La semilla debe ser un número entero');
  if (input.score !== null) {
    for (const g of [input.score.home, input.score.away]) {
      if (!Number.isInteger(g) || g < 0 || g > MAX_GOALS_PER_TEAM) {
        throw new RangeError(`El marcador debe ser un entero entre 0 y ${String(MAX_GOALS_PER_TEAM)}`);
      }
    }
  }
}

function poisson(rng: Rng, mean: number, cap: number): number {
  const limit = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng.float();
  } while (p > limit);
  return Math.min(k - 1, cap);
}

function limitFrom(from: Vec, target: Vec, max: number): Vec {
  const d = dist(from, target);
  return d <= max ? target : { x: from.x + ((target.x - from.x) * max) / d, y: from.y + ((target.y - from.y) * max) / d };
}

const inField = (p: Vec): Vec => ({ x: clamp(p.x, 0.5, PITCH_W - 0.5), y: clamp(p.y, 0.5, PITCH_L - 0.5) });
const passDuration = (a: Vec, b: Vec): number => clamp(dist(a, b) / 24, 0.35, 1.2);
/** Duración de la rampa para que un jugador cubra `from→to` sin superar ~16 m/s de velocidad media (el pico de smoothstep es ×1,5). */
const rampFor = (from: Vec, to: Vec): number => clamp((dist(from, to) * 1.5) / 14, 0.5, 3.2);
const RAMP_OUT = 1.4;
/** Tras celebrar, los jugadores vuelven desde lejos: rampa de salida larga para no superar la velocidad máxima. */
const CELEBRATION_RAMP_OUT = 3;

class Builder {
  t = 0;
  ball: Vec = CENTER;
  half: 1 | 2 = 1;
  /** Equipo cuyo portero tiene el balón en las manos (tras una parada). */
  gkHeld: Side | null = null;
  /** Instante hasta el que cada jugador sigue (casi) bajo el efecto de un actor; se evita reutilizarlo para no provocar saltos. */
  private readonly busyUntil = new Map<number, number>();
  readonly segments: BallSegment[] = [];
  readonly actors: Actor[] = [];
  readonly phases: Phase[] = [];
  readonly events: DraftEvent[] = [];
  readonly counters: Record<Side, { shots: number; onTarget: number; corners: number; fouls: number }> = {
    home: { shots: 0, onTarget: 0, corners: 0, fouls: 0 },
    away: { shots: 0, onTarget: 0, corners: 0, fouls: 0 },
  };

  constructor(
    private readonly rng: Rng,
    private readonly teams: { home: ResolvedTeam; away: ResolvedTeam },
    private readonly jitter: readonly number[],
  ) {}

  // ---- primitivas de línea de tiempo -------------------------------------------------------------------------

  private shape(side: Side, slot: number, possessing: boolean): Vec {
    return shapePos(this.teams[side], slot, this.half, this.ball, possessing ? 1 : 0, this.t, this.jitter[global(side, slot)] ?? 0);
  }

  private shirt(side: Side, slot: number): number {
    return this.teams[side].numbers[slot] ?? slot + 1;
  }

  idle(duration: number): void {
    this.move(this.ball, duration, 'idle');
  }

  move(to: Vec, duration: number, kind: BallKind, arc = 0): void {
    if (duration <= 0) {
      this.ball = to;
      return;
    }
    this.segments.push({ t0: this.t, t1: this.t + duration, from: this.ball, to, arc, kind });
    this.t += duration;
    this.ball = to;
  }

  /** El jugador conduce el balón de `from` a `to` durante `duration` (el balón va con él). */
  private mark(player: number, t1: number, rampOut: number): void {
    this.busyUntil.set(player, Math.max(this.busyUntil.get(player) ?? 0, t1 + 0.8 * rampOut));
  }

  private isFree(side: Side, slot: number): boolean {
    return (this.busyUntil.get(global(side, slot)) ?? 0) <= this.t + 0.5;
  }

  /** Rampa de salida por defecto: la necesaria para volver desde `to` a su posición de forma sin pasar de ~14 m/s medios. */
  private rampOutFrom(player: number, to: Vec): number {
    const home = this.shape(sideOf(player), slotOf(player), false);
    return clamp((dist(to, home) * 1.5) / 14, RAMP_OUT, 3.2);
  }

  carry(player: number, from: Vec, to: Vec, duration: number, rampIn = 0.6, rampOut = this.rampOutFrom(player, to)): void {
    this.mark(player, this.t + duration, rampOut);
    this.actors.push({ player, t0: this.t, t1: this.t + duration, from, to, rampIn, rampOut, holds: true });
    this.segments.push({ t0: this.t, t1: this.t + duration, from, to, arc: 0, kind: 'carry' });
    this.t += duration;
    this.ball = to;
  }

  run(player: number, t0: number, t1: number, from: Vec, to: Vec, rampIn = 0.5, rampOut = this.rampOutFrom(player, to)): void {
    this.mark(player, t1, rampOut);
    this.actors.push({ player, t0, t1, from, to, rampIn, rampOut, holds: false });
  }

  /** Carrera que termina en `arriveAt` a ~11 m/s (empieza antes si la distancia es larga). */
  runTo(player: number, arriveAt: number, from: Vec, to: Vec, minDuration = 0.35): void {
    const duration = Math.max(minDuration, dist(from, to) / 11);
    this.run(player, arriveAt - duration, arriveAt, from, to, 0.3);
  }

  private emit(type: EventType, side: Side | null, shirt: number | null, text: string): void {
    this.events.push({ t: this.t, type, side, shirt, text });
  }

  private phase(kind: PhaseKind, side: Side | null, t0: number, outcome?: Outcome): void {
    this.phases.push(outcome === undefined ? { kind, side, t0, t1: this.t } : { kind, side, t0, t1: this.t, outcome });
  }

  private nearest(side: Side, to: Vec, possessing: boolean, exclude: readonly number[] = [], only?: readonly Role[], ignoreBusy = false): number {
    const formation = FORMATIONS[this.teams[side].formation];
    let best = -1;
    let bestDist = Infinity;
    for (let slot = 1; slot < PLAYERS_PER_TEAM; slot += 1) {
      const role = formation[slot]?.role;
      if (exclude.includes(slot) || role === undefined) continue;
      if (!ignoreBusy && !this.isFree(side, slot)) continue;
      if (only !== undefined && !only.includes(role)) continue;
      const d = dist(this.shape(side, slot, possessing), to);
      if (d < bestDist) {
        bestDist = d;
        best = slot;
      }
    }
    if (best >= 0) return best;
    if (!ignoreBusy) return this.nearest(side, to, possessing, exclude, only, true);
    return only === undefined ? 1 : this.nearest(side, to, possessing, exclude, undefined, true);
  }

  private pickSlot(side: Side, weights: Partial<Record<Role, number>>, exclude: readonly number[], fallback = 0.15): number {
    const formation = FORMATIONS[this.teams[side].formation];
    const items: (readonly [number, number])[] = [];
    for (let slot = 1; slot < PLAYERS_PER_TEAM; slot += 1) {
      const role = formation[slot]?.role;
      if (role === undefined || exclude.includes(slot)) continue;
      items.push([slot, (weights[role] ?? fallback) * (this.isFree(side, slot) ? 1 : 0.001) + 1e-9]);
    }
    return this.rng.weighted(items);
  }

  /** Primer poseedor de una jugada: el portero (si acaba de parar) o el jugador más cercano al balón. */
  private startHolder(side: Side): { slot: number; pos: Vec } {
    if (this.gkHeld === side) {
      this.gkHeld = null;
      return { slot: 0, pos: this.ball };
    }
    this.gkHeld = null;
    const slot = this.nearest(side, this.ball, true);
    const pos = this.shape(side, slot, true);
    this.move(pos, clamp(dist(this.ball, pos) / 18, 0.3, 1.4), 'retrieve', 0.4);
    return { slot, pos };
  }

  private forward(from: Vec, side: Side, meters: number, lateral: number): Vec {
    return inField({ x: from.x + lateral, y: from.y + attackDir(side, this.half) * meters });
  }

  // ---- jugadas ------------------------------------------------------------------------------------------------

  private attack(side: Side, outcome: Outcome): void {
    const rng = this.rng;
    const half = this.half;
    const phaseStart = this.t;
    const formation = FORMATIONS[this.teams[side].formation];

    const first = this.startHolder(side);
    const used: number[] = [first.slot];
    let holderEnd = this.forward(first.pos, side, rng.float(1, 2.5), rng.float(-1, 1));
    this.carry(global(side, first.slot), first.pos, holderEnd, rng.float(0.35, 0.5));

    const step = (stageD: number, weights: Partial<Record<Role, number>>): void => {
      const slot = this.pickSlot(side, weights, [used.at(-1) ?? first.slot]);
      used.push(slot);
      const slotDef = formation[slot];
      const target = toAbs(side, half, clamp((slotDef?.l ?? 0.5) + rng.float(-0.1, 0.1), 0.08, 0.92), stageD + rng.float(-0.04, 0.04));
      const sh = this.shape(side, slot, true);
      const enter = limitFrom(sh, target, 10);
      this.move(enter, passDuration(this.ball, enter), 'pass', rng.float(0.3, 0.9));
      holderEnd = this.forward(enter, side, rng.float(1, 3), rng.float(-1.5, 1.5));
      this.carry(global(side, slot), enter, holderEnd, rng.float(0.28, 0.42), rampFor(sh, enter));
    };

    const nPoss = rng.chance(0.6) ? 1 : 2;
    for (let i = 0; i < nPoss; i += 1) {
      step(0.32 + (0.22 * (i + 1)) / (nPoss + 1), { CB: 1, LB: 1.2, RB: 1.2, DM: 2, CM: 2, LWB: 1, RWB: 1, LM: 1.2, RM: 1.2 });
    }
    const possEnd = this.t;
    this.phase('possession', side, phaseStart);

    if (rng.chance(0.4)) step(0.64 + rng.float(0, 0.1), { AM: 3, LW: 2, RW: 2, LM: 2, RM: 2, CM: 1.5, ST: 0.6, LWB: 1, RWB: 1 });

    // Rematador: entra al área y recibe el último pase.
    const finisher = this.pickSlot(side, { ST: 5, LW: 2, RW: 2, AM: 2, CM: 1, LM: 1, RM: 1 }, [used.at(-1) ?? first.slot], 0);
    const boxTarget = toAbs(side, half, rng.float(0.32, 0.68), rng.float(0.83, 0.9));
    const finisherShape = this.shape(side, finisher, true);
    const boxPos = limitFrom(finisherShape, boxTarget, 14);
    const wide = holderEnd.x < PITCH_W * 0.25 || holderEnd.x > PITCH_W * 0.75;
    this.move(boxPos, wide ? clamp(dist(this.ball, boxPos) / 20, 0.6, 1.2) : passDuration(this.ball, boxPos), wide ? 'cross' : 'pass', wide ? 2.6 : 0.5);
    const shooterPos = this.forward(boxPos, side, 0.8, 0);
    const shooter = global(side, finisher);
    this.carry(shooter, boxPos, shooterPos, 0.35, rampFor(finisherShape, boxPos));
    this.phase('attack', side, possEnd, outcome);
    // El inicio real de la fase de ataque es possEnd; el cierre se ajusta al terminar el tiro.
    const attackIndex = this.phases.length - 1;

    const lastEnd = this.shoot(side, finisher, shooterPos, outcome);
    const attackPhase = this.phases[attackIndex];
    if (attackPhase !== undefined) this.phases[attackIndex] = { ...attackPhase, t1: this.t };
    if (outcome === 'goal') this.celebrate(side, shooter, lastEnd);
    if (outcome === 'blocked') this.corner(side);
  }

  /** Ejecuta el disparo; devuelve la posición del rematador al disparar. */
  private shoot(side: Side, slot: number, from: Vec, outcome: Outcome): Vec {
    const rng = this.rng;
    const half = this.half;
    const defSide = other(side);
    const dir = attackDir(side, half);
    const lineY = goalLineY(side, half);
    const inward = -dir;
    const goalCx = PITCH_W / 2;
    const gk = global(defSide, 0);
    const gkNow = this.shape(defSide, 0, false);
    const short = this.teams[side].style.short;
    const shirt = this.shirt(side, slot);
    const tShot = this.t;
    this.counters[side].shots += 1;
    this.emit('shot', side, shirt, `Disparo de ${short} (nº ${String(shirt)})`);

    const flight = (to: Vec, speed: number): number => clamp(dist(from, to) / speed, 0.4, 1.1);
    // El rematador se queda en su sitio hasta el impacto (así enlaza sin saltos con la celebración).
    const hold = (impactAt: number): void => {
      this.run(global(side, slot), tShot, impactAt, from, from, 0.01, RAMP_OUT);
    };

    switch (outcome) {
      case 'goal': {
        const s = rng.chance(0.5) ? -1 : 1;
        const target = { x: goalCx + s * rng.float(2.2, 3.3), y: lineY + dir * 1.1 };
        const d = flight(target, 34);
        this.run(gk, tShot, tShot + d, gkNow, { x: goalCx - s * rng.float(1.5, 2.8), y: lineY + inward * 0.8 }, 0.12, 0.9);
        this.move(target, d, 'shot', rng.float(0.2, 1));
        hold(this.t);
        this.counters[side].onTarget += 1;
        this.emit('goal', side, shirt, `¡Gol de ${short}! (nº ${String(shirt)})`);
        break;
      }
      case 'saved': {
        const target = { x: goalCx + rng.float(-2.8, 2.8), y: lineY + inward * 0.9 };
        const d = flight(target, 34);
        this.run(gk, tShot, tShot + d, gkNow, target, 0.12, 0.9);
        this.move(target, d, 'shot', rng.float(0.2, 0.8));
        hold(this.t);
        this.counters[side].onTarget += 1;
        const gkShirt = this.shirt(defSide, 0);
        this.emit('save', defSide, gkShirt, `Parada del portero de ${this.teams[defSide].style.short}`);
        this.carry(gk, target, { x: target.x, y: target.y + inward * 0.3 }, 0.6, 0.12, 0.8);
        this.gkHeld = defSide;
        break;
      }
      case 'miss': {
        const over = rng.chance(0.4);
        const sx = rng.chance(0.5) ? -1 : 1;
        const target = over
          ? { x: goalCx + rng.float(-3, 3), y: lineY + dir * 2.5 }
          : { x: goalCx + sx * (6.5 + rng.float(0, 6)), y: lineY + dir * rng.float(1.5, 3) };
        const d = flight(target, 34);
        this.run(gk, tShot, tShot + d, gkNow, { x: goalCx + (target.x - goalCx) * 0.25, y: gkNow.y }, 0.15, 0.9);
        this.move(target, d, 'shot', over ? 4.5 : 0.6);
        hold(this.t);
        this.emit('miss', side, shirt, `Disparo fuera de ${short}`);
        break;
      }
      case 'post': {
        const px = goalCx + (rng.chance(0.5) ? -1 : 1) * GOAL_HALF_WIDTH;
        const target = { x: px, y: lineY };
        const d = flight(target, 34);
        this.run(gk, tShot, tShot + d, gkNow, { x: goalCx + (px - goalCx) * 0.7, y: lineY + inward * 0.8 }, 0.12, 0.9);
        this.move(target, d, 'shot', 0.4);
        hold(this.t);
        this.emit('post', side, shirt, `¡Al palo! (${short})`);
        this.move({ x: clamp(goalCx + (px - goalCx) * rng.float(1.8, 3), 1, PITCH_W - 1), y: lineY + inward * rng.float(5, 9) }, 0.5, 'shot', 0.3);
        break;
      }
      case 'blocked': {
        const len = rng.float(4.5, 6.5);
        const toGoal = { x: goalCx - from.x, y: lineY - from.y };
        const norm = Math.hypot(toGoal.x, toGoal.y) || 1;
        const block = { x: from.x + (toGoal.x / norm) * len, y: from.y + (toGoal.y / norm) * len };
        const blocker = this.nearest(defSide, block, false);
        const d = 0.25;
        this.runTo(global(defSide, blocker), tShot + d, this.shape(defSide, blocker, false), block);
        this.move(block, d, 'shot', 0.2);
        hold(this.t);
        this.emit('block', defSide, this.shirt(defSide, blocker), `Disparo bloqueado (${short})`);
        this.move({ x: rng.chance(0.5) ? 0.8 : PITCH_W - 0.8, y: lineY + inward * 0.8 }, 0.7, 'pass', 0.6);
        break;
      }
    }
    return from;
  }

  private celebrate(side: Side, scorer: number, from: Vec): void {
    const t0 = this.t;
    const dir = attackDir(side, this.half);
    const runTo = { x: from.x < PITCH_W / 2 ? 3 : PITCH_W - 3, y: goalLineY(side, this.half) - dir * 7 };
    this.run(scorer, t0, t0 + 1.5, from, runTo, 0.01, CELEBRATION_RAMP_OUT);
    const scorerSlot = scorer % PLAYERS_PER_TEAM;
    const mates = [this.nearest(side, runTo, true, [scorerSlot])];
    mates.push(this.nearest(side, runTo, true, [scorerSlot, ...mates]));
    mates.forEach((slot, i) => {
      const sh = this.shape(side, slot, true);
      const to = limitFrom(sh, { x: runTo.x + (i === 0 ? -3 : 2.5), y: runTo.y + (i === 0 ? 2 : -2.5) }, 10);
      this.run(global(side, slot), t0 + 0.1, t0 + 1.7, sh, to, rampFor(sh, to), CELEBRATION_RAMP_OUT);
    });
    this.idle(CELEBRATION_SECONDS - 1.3);
    this.move(CENTER, 1.3, 'reset');
    this.phase('celebration', side, t0);
    this.gkHeld = null;
  }

  private corner(side: Side): void {
    const rng = this.rng;
    const half = this.half;
    const defSide = other(side);
    const t0 = this.t;
    const dir = attackDir(side, half);
    const flag = { x: this.ball.x < PITCH_W / 2 ? 0.8 : PITCH_W - 0.8, y: goalLineY(side, half) - dir * 0.8 };
    this.move(flag, 0.3, 'retrieve');
    const taker = this.nearest(side, flag, true, [], ['LW', 'RW', 'LM', 'RM', 'LWB', 'RWB', 'AM', 'CM']);
    this.carry(global(side, taker), flag, flag, 0.9, rampFor(this.shape(side, taker, true), flag));
    this.counters[side].corners += 1;
    this.emit('corner', side, this.shirt(side, taker), `Saque de esquina para ${this.teams[side].style.short}`);
    const target = toAbs(side, half, rng.float(0.38, 0.62), 0.9);
    const header = this.nearest(side, target, true, [taker], ['ST', 'CB', 'AM', 'CM']);
    const defender = this.nearest(defSide, target, false);
    this.runTo(global(side, header), this.t + 1.0, this.shape(side, header, true), target, 1.0);
    this.runTo(global(defSide, defender), this.t + 1.0, this.shape(defSide, defender, false), { x: target.x + 1.2, y: target.y }, 1.0);
    this.move(target, 1.0, 'cross', 3.8);
    this.move(toAbs(side, half, rng.float(0.2, 0.8), 0.66), 0.7, 'pass', 2);
    this.phase('corner', side, t0);
  }

  private foul(committer: Side): void {
    const rng = this.rng;
    const half = this.half;
    const fouled = other(committer);
    const t0 = this.t;
    const first = this.startHolder(fouled);
    const target = toAbs(fouled, half, rng.float(0.2, 0.8), rng.float(0.42, 0.66));
    const end = limitFrom(first.pos, target, 12);
    const tHold = this.t;
    const defender = this.nearest(committer, end, false);
    this.runTo(global(committer, defender), tHold + 1.1, this.shape(committer, defender, false), this.forward(end, fouled, 0.9, 0), 1.1);
    this.carry(global(fouled, first.slot), first.pos, end, 1.1, 0.6, 0.9);
    this.counters[committer].fouls += 1;
    this.emit('foul', committer, this.shirt(committer, defender), `Falta de ${this.teams[committer].style.short}`);
    this.idle(0.6);
    const taker = this.nearest(fouled, end, true, [first.slot]);
    this.carry(global(fouled, taker), end, end, 0.25, rampFor(this.shape(fouled, taker, true), end));
    const receiver = this.pickSlot(fouled, { CM: 2, DM: 1, AM: 2, LW: 1.5, RW: 1.5, LM: 1.5, RM: 1.5, ST: 1, CB: 0.5 }, [first.slot, taker]);
    const recTarget = toAbs(fouled, half, rng.float(0.15, 0.85), clamp(rng.float(0.55, 0.75), 0, 1));
    const receiverShape = this.shape(fouled, receiver, true);
    const enter = limitFrom(receiverShape, recTarget, 12);
    this.move(enter, passDuration(this.ball, enter), 'pass', 1.2);
    this.carry(global(fouled, receiver), enter, this.forward(enter, fouled, 1.5, 0), 0.4, rampFor(receiverShape, enter));
    this.phase('foul', fouled, t0);
  }

  // ---- orquestación ------------------------------------------------------------------------------------------

  playMoment(moment: Moment): void {
    if (moment.kind === 'foul') this.foul(moment.side);
    else this.attack(moment.side, moment.kind);
  }

  playHalf(half: 1 | 2, moments: readonly Moment[]): { start: number; end: number } {
    this.half = half;
    this.emit('kickoff', null, null, half === 1 ? 'Comienza el partido' : 'Comienza la segunda parte');
    const start = this.t;
    for (const moment of moments) this.playMoment(moment);
    return { start, end: this.t };
  }

  intro(): void {
    this.idle(INTRO_SECONDS);
    this.phase('intro', null, 0);
  }

  halftime(): number {
    const t0 = this.t;
    this.idle(HALFTIME_SETTLE_SECONDS);
    const mid = this.t;
    this.half = 2;
    this.gkHeld = null; // el balón vuelve al centro: nadie lo tiene en las manos
    this.move(CENTER, HALFTIME_RESET_SECONDS, 'reset');
    this.phase('halftime', null, t0);
    return mid;
  }

  fulltime(): void {
    const t0 = this.t;
    this.idle(OUTRO_SECONDS);
    this.phase('fulltime', null, t0);
  }
}

function planMoments(rng: Rng, score: Score): { first: Moment[]; second: Moment[] } {
  const goals: { half: 1 | 2; moment: Moment }[] = [];
  for (const side of ['home', 'away'] as const) {
    for (let i = 0; i < score[side]; i += 1) goals.push({ half: rng.chance(0.46) ? 1 : 2, moment: { side, kind: 'goal' } });
  }
  const share = clamp(0.5 + 0.06 * (score.home - score.away) + rng.float(-0.1, 0.1), 0.28, 0.72);
  const make = (half: 1 | 2): Moment[] => {
    const own = goals.filter((g) => g.half === half).map((g) => g.moment);
    const total = Math.max(3, own.length + 1);
    const rest: Moment[] = [];
    for (let i = own.length; i < total; i += 1) {
      const kind = rng.weighted<MomentKind>([['saved', 0.3], ['miss', 0.24], ['blocked', 0.12], ['post', 0.06], ['foul', 0.24]]);
      rest.push({ side: rng.chance(share) ? 'home' : 'away', kind });
    }
    return rng.shuffle([...own, ...rest]);
  };
  const first = make(1);
  const second = make(2);
  // Coherencia: cada equipo acaba con al menos dos disparos (los goles cuentan) aunque no marque.
  const all = [...first, ...second];
  const isChance = (m: Moment): boolean => m.kind !== 'goal' && m.kind !== 'foul';
  const chances = (side: Side): number => all.filter((m) => m.side === side && isChance(m)).length;
  const needed = (side: Side): number => Math.max(0, 2 - score[side]);
  for (const side of ['home', 'away'] as const) {
    while (chances(side) < needed(side)) {
      const candidates = all.filter((m) => m.kind !== 'goal' && !(m.side === side && isChance(m)) && !(isChance(m) && chances(m.side) <= needed(m.side)));
      const target = candidates.find((m) => m.kind === 'foul') ?? candidates[0];
      if (target === undefined) break;
      const replacement: Moment = { side, kind: rng.pick<MomentKind>(['saved', 'miss', 'saved']) };
      const list = first.includes(target) ? first : second;
      const at = list.indexOf(target);
      list[at] = replacement;
      all[all.indexOf(target)] = replacement;
    }
  }
  return { first, second };
}

/** Genera el guion completo (ocasiones, paradas, faltas, goles, posesiones) para una semilla. Determinista. */
export function generateScript(input: SimulationInput): MatchScript {
  validateInput(input);
  const rng = new Rng((input.seed ^ hashString(`${input.home}|${input.away}`)) >>> 0);
  const fixed = input.score !== null;
  const score: Score = input.score ?? { home: poisson(rng, 1.45, 6), away: poisson(rng, 1.15, 6) };
  const styles = teamStyles(input.home, input.away);
  const resolve = (side: Side, name: string): ResolvedTeam => {
    const formation = rng.pick(FORMATION_IDS);
    const slots = FORMATIONS[formation];
    return { side, name, formation, style: styles[side], numbers: slots.map((_, i) => i + 1), roles: slots.map((s) => s.role) };
  };
  const teams = { home: resolve('home', input.home), away: resolve('away', input.away) };
  const jitter = Array.from({ length: PLAYERS_PER_TEAM * 2 }, () => rng.float());
  const { first, second } = planMoments(rng, score);

  const b = new Builder(rng, teams, jitter);
  b.intro();
  const h1 = b.playHalf(1, first);
  const htMid = b.halftime();
  const h2 = b.playHalf(2, second);
  b.fulltime();

  const stoppage1 = rng.int(1, 3);
  const stoppage2 = rng.int(2, 5);
  const clock: ClockSegment[] = [
    { half: 1, t0: h1.start, t1: h1.end, m0: 0, m1: 45 + stoppage1 },
    { half: 2, t0: h2.start, t1: h2.end, m0: 45, m1: 90 + stoppage2 },
  ];

  const duration = b.t;
  const labelled = (e: DraftEvent): ScriptEvent => {
    const c = clockLabel(clock, e.t);
    if (e.type === 'halftime') return { ...e, minute: c.minute, clock: 'DESCANSO' };
    if (e.type === 'fulltime') return { ...e, minute: c.minute, clock: 'FIN' };
    return { ...e, minute: c.minute, clock: c.label };
  };
  const extra: DraftEvent[] = [
    { t: htMid, type: 'halftime', side: null, shirt: null, text: 'Descanso' },
    { t: duration - OUTRO_SECONDS + 0.2, type: 'fulltime', side: null, shirt: null, text: 'Final del partido' },
  ];
  const draft: DraftEvent[] = [...b.events, ...extra].sort((x, y) => x.t - y.t);
  const events = draft.map(labelled).map((e) =>
    e.type === 'halftime' ? { ...e, text: `Descanso: ${String(scoreBefore(draft, e.t).home)}–${String(scoreBefore(draft, e.t).away)}` } : e.type === 'fulltime' ? { ...e, text: `Final: ${String(score.home)}–${String(score.away)}` } : e,
  );

  const stats = (side: Side): TeamStats => ({ ...b.counters[side] });
  return {
    seed: input.seed,
    teams,
    score,
    scoreWasFixed: fixed,
    duration,
    halftimeMid: htMid,
    phases: b.phases,
    events,
    ball: b.segments,
    actors: [...b.actors].sort((x, y) => x.t0 - x.rampIn - (y.t0 - y.rampIn)),
    clock,
    stats: { home: stats('home'), away: stats('away') },
    jitter,
  };
}

function scoreBefore(events: readonly DraftEvent[], t: number): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === 'goal') {
      if (e.side === 'home') home += 1;
      else away += 1;
    }
  }
  return { home, away };
}
