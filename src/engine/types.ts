import type { FormationId, Role } from './formations.ts';
import type { Side, Vec } from './geometry.ts';
import type { TeamStyle } from './style.ts';

export type { Side, Vec } from './geometry.ts';
export type { FormationId, Role } from './formations.ts';
export type { TeamStyle } from './style.ts';

export interface Score {
  readonly home: number;
  readonly away: number;
}

export interface SimulationInput {
  /** Semilla entera: determina TODO (marcador si es aleatorio, formaciones, jugadas, minutos). */
  readonly seed: number;
  readonly home: string;
  readonly away: string;
  /** Marcador fijado por el usuario (0–9 cada equipo) o `null` para que lo decida la semilla. */
  readonly score: Score | null;
}

export interface ResolvedTeam {
  readonly side: Side;
  readonly name: string;
  readonly formation: FormationId;
  readonly style: TeamStyle;
  /** Dorsal de cada puesto (índice = puesto de la formación). */
  readonly numbers: readonly number[];
  readonly roles: readonly Role[];
}

export type BallKind = 'idle' | 'carry' | 'pass' | 'cross' | 'shot' | 'retrieve' | 'reset';

export interface BallSegment {
  readonly t0: number;
  readonly t1: number;
  readonly from: Vec;
  readonly to: Vec;
  /** Altura máxima (m) de la parábola del balón en el tramo. */
  readonly arc: number;
  readonly kind: BallKind;
}

/** Un jugador (índice global 0–10 local, 11–21 visitante) que se mueve hacia/desde el balón en [t0, t1]. */
export interface Actor {
  readonly player: number;
  readonly t0: number;
  readonly t1: number;
  readonly from: Vec;
  readonly to: Vec;
  readonly rampIn: number;
  readonly rampOut: number;
  /** `true` si lleva el balón durante [t0, t1]. */
  readonly holds: boolean;
}

export type Outcome = 'goal' | 'saved' | 'miss' | 'post' | 'blocked';
export type PhaseKind = 'intro' | 'possession' | 'attack' | 'corner' | 'foul' | 'celebration' | 'halftime' | 'fulltime';

export interface Phase {
  readonly kind: PhaseKind;
  readonly side: Side | null;
  readonly t0: number;
  readonly t1: number;
  readonly outcome?: Outcome;
}

export type EventType = 'kickoff' | 'shot' | 'goal' | 'save' | 'miss' | 'post' | 'block' | 'foul' | 'corner' | 'halftime' | 'fulltime';

export interface ScriptEvent {
  /** Segundos de vídeo. */
  readonly t: number;
  /** Minuto de partido (con decimales; >45 en la 1ª parte o >90 en la 2ª es tiempo añadido). */
  readonly minute: number;
  /** «34'», «45+2'», «90+3'». */
  readonly clock: string;
  readonly type: EventType;
  readonly side: Side | null;
  /** Dorsal protagonista, si lo hay. */
  readonly shirt: number | null;
  readonly text: string;
}

export interface ClockSegment {
  readonly half: 1 | 2;
  readonly t0: number;
  readonly t1: number;
  /** Minuto inicial y final de la parte (final = 45+añadido o 90+añadido). */
  readonly m0: number;
  readonly m1: number;
}

export interface TeamStats {
  readonly shots: number;
  readonly onTarget: number;
  readonly corners: number;
  readonly fouls: number;
}

export interface MatchScript {
  readonly seed: number;
  readonly teams: { readonly home: ResolvedTeam; readonly away: ResolvedTeam };
  /** Marcador final de la simulación (ficticio). */
  readonly score: Score;
  readonly scoreWasFixed: boolean;
  /** Duración total del vídeo en segundos. */
  readonly duration: number;
  /** Instante (s) en que cambian de campo (punto medio del descanso, con la pantalla cubierta). */
  readonly halftimeMid: number;
  readonly phases: readonly Phase[];
  readonly events: readonly ScriptEvent[];
  readonly ball: readonly BallSegment[];
  readonly actors: readonly Actor[];
  readonly clock: readonly ClockSegment[];
  readonly stats: { readonly home: TeamStats; readonly away: TeamStats };
  /** Fase aleatoria [0,1) de cada jugador para el movimiento de reposo. */
  readonly jitter: readonly number[];
}

export interface PlayerFrame {
  readonly index: number;
  readonly side: Side;
  readonly number: number;
  readonly role: Role;
  readonly x: number;
  readonly y: number;
  readonly hasBall: boolean;
}

export interface FrameState {
  readonly t: number;
  readonly phase: PhaseKind;
  /** Progreso 0–1 dentro de la fase actual. */
  readonly phaseProgress: number;
  readonly half: 1 | 2;
  readonly players: readonly PlayerFrame[];
  readonly ball: { readonly x: number; readonly y: number; readonly z: number; readonly visible: boolean };
  readonly score: Score;
  /** «34'», «45+2'», «DESCANSO», «FIN». */
  readonly clock: string;
  readonly goalBanner: { readonly side: Side; readonly shirt: number | null; readonly clock: string; readonly progress: number } | null;
  readonly ticker: { readonly clock: string; readonly text: string } | null;
  /** Peso de posesión continuo de cada equipo (0 defiende, 1 tiene el balón). */
  readonly possession: { readonly home: number; readonly away: number };
  /** Línea del pase en vuelo (para dibujarla), si la hay. */
  readonly passLine: { readonly from: Vec; readonly to: Vec; readonly progress: number } | null;
}
