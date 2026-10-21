import { ballAt } from '../../engine/animate.ts';
import { PITCH_L, PITCH_W, clamp, goalLineY, lerp, smoothstep, type Side } from '../../engine/geometry.ts';
import type { FrameState } from '../../engine/index.ts';
import type { BallSegment } from '../../engine/types.ts';
import { discsAt, simulateDiscs, type DiscContact, type DiscTrack } from './discPhysics.ts';
import { pointOnRoute, routeBetween, type BounceLevel, type Route } from './bounce.ts';
import { FRICTION, PROFILE_STEPS, buildProfile, heightAt, progressAt, type Profile } from './physics.ts';

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

// ---- Escudos (uno por equipo) ----------------------------------------------------------------------------------------------------

/** Radio del escudo en la pantalla (px) y del balón. */
export const DISC_R = 68;
export const BALL_PX = BALL_R * ARENA.radius * 1.15;
/** Separación mínima entre los centros de los dos escudos (px): nunca se amontonan. */
export const DISC_MIN_DISTANCE = DISC_R * 3.1;

/** Separa los dos escudos y los mantiene dentro del aro (se repite porque el aro puede deshacer parte de la separación). */
export function relaxDiscs(input: Record<Side, { x: number; y: number }>): Record<Side, { x: number; y: number }> {
  const out = { home: { ...input.home }, away: { ...input.away } };
  const separate = (): void => {
    const dx = out.away.x - out.home.x;
    const dy = out.away.y - out.home.y;
    const d = Math.hypot(dx, dy);
    if (d >= DISC_MIN_DISTANCE) return;
    const ux = d < 1e-3 ? 0 : dx / d;
    const uy = d < 1e-3 ? 1 : dy / d;
    const push = (DISC_MIN_DISTANCE - d) / 2;
    out.home = { x: out.home.x - ux * push, y: out.home.y - uy * push };
    out.away = { x: out.away.x + ux * push, y: out.away.y + uy * push };
  };
  const keepInside = (): void => {
    const maxR = ARENA.radius - DISC_R * 0.35;
    for (const side of ['home', 'away'] as const) {
      const p = out[side];
      const dx = p.x - ARENA.cx;
      const dy = p.y - ARENA.cy;
      const r = Math.hypot(dx, dy);
      if (r > maxR) out[side] = { x: ARENA.cx + (dx / r) * maxR, y: ARENA.cy + (dy / r) * maxR };
    }
  };
  for (let i = 0; i < 6; i += 1) {
    separate();
    keepInside();
  }
  separate();
  return out;
}

/**
 * Posición en pantalla de los dos escudos. Cada uno se construye **relativo al balón**, siempre en la dirección de su propia portería:
 * el que **tiene la posesión** va justo detrás del balón (lo conduce por el borde) y el que **defiende** se queda más lejos, entre el balón y
 * su portería, marcando, con un vaivén lateral. Se mezclan con el peso de posesión continuo (sin saltos al cambiar el balón de equipo).
 * Como los dos vectores apuntan a porterías opuestas, los escudos quedan a ambos lados del balón: nunca amontonados ni tapándolo.
 */
export function discScreenPositions(
  frame: Pick<FrameState, 'ball' | 'half' | 'possession' | 't'>,
  ballOverride?: { x: number; y: number },
): Record<Side, { x: number; y: number }> {
  const angle = cameraAngle(frame.t);
  // Los discos siguen al balón, pero no pegados al aro: con el balón en la red (borde del círculo) se anclan algo más adentro,
  // y así la separación y el límite del aro no se pelean entre sí (sin saltos).
  const rawBall = ballOverride ?? fieldToScreen(frame.ball.x, frame.ball.y, frame.t);
  const bx = rawBall.x - ARENA.cx;
  const by = rawBall.y - ARENA.cy;
  const br = Math.hypot(bx, by);
  const anchorR = ARENA.radius * 0.72;
  const ball = br > anchorR ? { x: ARENA.cx + (bx / br) * anchorR, y: ARENA.cy + (by / br) * anchorR } : rawBall;
  const gap = DISC_R + BALL_PX + 6;
  const out: Record<Side, { x: number; y: number }> = { home: ball, away: ball };
  for (const side of ['home', 'away'] as const) {
    // Referencia fuera del campo, detrás de la portería que defiende este equipo (arriba o abajo del círculo, antes de girar la cámara):
    // así la dirección «hacia su portería» es estable incluso cuando el balón está dentro de la red.
    const topGoal = PITCH_L - goalLineY(side, frame.half) === 0;
    const ref = toScreen(rotate({ u: 0, v: topGoal ? -1.8 : 1.8 }, angle));
    const dx = ref.x - ball.x;
    const dy = ref.y - ball.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const toRing = dist - ARENA.radius * 0.8; // lo que falta hasta la portería (aprox.)
    const defDist = Math.min(clamp(0.6 * toRing + 120, 200, 340), Math.max(toRing, gap));
    const sway = 46 * Math.sin(frame.t * 0.9 + (side === 'home' ? 0 : 2.4));
    const defender = { x: ball.x + ux * defDist - uy * sway, y: ball.y + uy * defDist + ux * sway };
    const carrier = { x: ball.x + ux * gap, y: ball.y + uy * gap };
    const w = clamp(frame.possession[side], 0, 1);
    out[side] = { x: lerp(defender.x, carrier.x, w), y: lerp(defender.y, carrier.y, w) };
  }
  return relaxDiscs(out);
}

interface BallSource {
  readonly script: Parameters<typeof ballAt>[0];
}

// ---- Balón con física -----------------------------------------------------------------------------------------------------------

/** Efecto (curvatura) de cada tipo de tramo, como fracción de su longitud. */
const CURVE: Readonly<Record<BallSegment['kind'], number>> = { idle: 0, reset: 0, carry: 0, pass: 0.1, cross: 0.18, shot: 0.07, retrieve: 0.06 };

interface Motion {
  readonly route: Route;
  readonly profile: Profile;
}

const motionCache = new WeakMap<BallSegment, Map<BounceLevel, Motion>>();

function segmentSeed(seg: BallSegment): number {
  return Math.round(seg.t0 * 1000) + Math.round(seg.t1 * 777) * 31;
}

function motionOf(seg: BallSegment, level: BounceLevel): Motion {
  let byLevel = motionCache.get(seg);
  if (byLevel === undefined) {
    byLevel = new Map();
    motionCache.set(seg, byLevel);
  }
  let motion = byLevel.get(level);
  if (motion === undefined) {
    const a = fieldToUnit(seg.from.x, seg.from.y);
    const b = fieldToUnit(seg.to.x, seg.to.y);
    // Los tiros a puerta y los tramos a la red no rebotan en la pared; los demás pueden hacer una banda.
    const canBounce = seg.kind === 'pass' || seg.kind === 'cross' || seg.kind === 'carry' || seg.kind === 'retrieve';
    const route = routeBetween(a, b, segmentSeed(seg), canBounce ? level : 'off', CURVE[seg.kind]);
    motion = { route, profile: buildProfile(route.length, seg.t1 - seg.t0, FRICTION[seg.kind], route.bounceAt) };
    byLevel.set(level, motion);
  }
  return motion;
}

/** Progreso (0–1) del recorrido del tramo en el instante `t`: golpe inicial, fricción y pérdida de velocidad en el choque con la pared. */
function progressOf(seg: BallSegment, motion: Motion, t: number): number {
  const span = seg.t1 - seg.t0;
  return progressAt(motion.profile, span <= 0 ? 1 : (t - seg.t0) / span);
}

/** Balón en coordenadas del círculo (sin giro de cámara) y su altura `z` (parábola, caída y botes). Oculto durante los reinicios. */
export function ballUnit(sim: BallSource, t: number, level: BounceLevel): { u: number; v: number; z: number; visible: boolean } {
  const state = ballAt(sim.script, t);
  const seg = state.seg;
  if (seg === null) {
    const p = fieldToUnit(state.x, state.y);
    return { u: p.u, v: p.v, z: 0, visible: state.visible };
  }
  const motion = motionOf(seg, level);
  const span = seg.t1 - seg.t0;
  const tau = span <= 0 ? 1 : clamp((t - seg.t0) / span, 0, 1);
  const p = pointOnRoute(motion.route, progressOf(seg, motion, t));
  return { u: p.u, v: p.v, z: heightAt(seg.arc, tau), visible: state.visible };
}

export interface BounceEvent {
  readonly t: number;
  readonly u: number;
  readonly v: number;
}

/** Un golpeo del balón: instante, punto (círculo), dirección de salida y fuerza (0–1, según la velocidad inicial). */
export interface KickEvent {
  readonly t: number;
  readonly u: number;
  readonly v: number;
  readonly du: number;
  readonly dv: number;
  readonly power: number;
}

interface Events {
  readonly bounces: readonly BounceEvent[];
  readonly kicks: readonly KickEvent[];
}

const eventCache = new WeakMap<object, Map<BounceLevel, Events>>();

function eventsOf(sim: BallSource, level: BounceLevel): Events {
  let byLevel = eventCache.get(sim.script);
  if (byLevel === undefined) {
    byLevel = new Map();
    eventCache.set(sim.script, byLevel);
  }
  let events = byLevel.get(level);
  if (events === undefined) {
    const bounces: BounceEvent[] = [];
    const kicks: KickEvent[] = [];
    for (const seg of sim.script.ball) {
      if (seg.kind === 'idle' || seg.kind === 'reset') continue;
      const { route, profile } = motionOf(seg, level);
      const span = seg.t1 - seg.t0;
      const hit = route.pts[1];
      if (route.bounceAt !== null && route.pts.length === 3 && hit !== undefined) {
        // Instante del choque: primer momento en que el progreso alcanza la fracción de la pared.
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 30; i += 1) {
          const mid = (lo + hi) / 2;
          if (progressAt(profile, mid) < route.bounceAt) lo = mid;
          else hi = mid;
        }
        bounces.push({ t: seg.t0 + ((lo + hi) / 2) * span, u: hit.u, v: hit.v });
      }
      // Golpeo: sólo si el balón sale con fuerza (los tramos casi quietos no cuentan).
      const first = route.pts[0];
      const next = route.pts[1];
      if (first === undefined || next === undefined || span <= 0) continue;
      const speed = (((profile[1] ?? 0) - (profile[0] ?? 0)) * PROFILE_STEPS * route.length) / span; // unidades del círculo por segundo
      const len = Math.hypot(next.u - first.u, next.v - first.v) || 1;
      if (speed < 0.5) continue;
      kicks.push({ t: seg.t0, u: first.u, v: first.v, du: (next.u - first.u) / len, dv: (next.v - first.v) / len, power: clamp(speed / 3, 0, 1) });
    }
    events = { bounces, kicks };
    byLevel.set(level, events);
  }
  return events;
}

/** Instantes y puntos de la pared en los que el balón rebota (para dibujar el destello del aro). */
export function bounceEvents(sim: BallSource, level: BounceLevel): readonly BounceEvent[] {
  return eventsOf(sim, level).bounces;
}

/** Golpeos del balón (pases, centros, tiros): para el destello del impacto y para que el escudo «lo golpee». */
export function kickEvents(sim: BallSource, level: BounceLevel): readonly KickEvent[] {
  return eventsOf(sim, level).kicks;
}

/** Balón dibujado: en pantalla (con el giro de cámara) y con su altura `z`. Oculto durante los reinicios. */
export function ballState(sim: BallSource, t: number, level: BounceLevel = 'normal'): { x: number; y: number; z: number; visible: boolean } {
  const b = ballUnit(sim, t, level);
  const p = toScreen(rotate(b, cameraAngle(t)));
  return { ...p, z: b.z, visible: b.visible };
}

export function ballScreen(sim: BallSource, t: number, level: BounceLevel = 'normal'): { x: number; y: number; visible: boolean } {
  const b = ballState(sim, t, level);
  return { x: b.x, y: b.y, visible: b.visible };
}

const ROLL_STEP = 1 / 60;
const rollCache = new WeakMap<object, Map<BounceLevel, Float32Array>>();

/** Distancia (px) que ha rodado el balón desde el inicio (en el círculo, sin contar el giro de cámara): gira su dibujo como si rodase. */
export function ballRoll(sim: BallSource, t: number, level: BounceLevel = 'normal'): number {
  let byLevel = rollCache.get(sim.script);
  if (byLevel === undefined) {
    byLevel = new Map();
    rollCache.set(sim.script, byLevel);
  }
  let table = byLevel.get(level);
  if (table === undefined) {
    const n = Math.ceil(sim.script.duration / ROLL_STEP) + 2;
    table = new Float32Array(n);
    let prev: { u: number; v: number } | null = null;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const b = ballUnit(sim, Math.min(i * ROLL_STEP, sim.script.duration), level);
      // En el aire (z > 0) no rueda: el dibujo sólo gira con la distancia recorrida por el suelo.
      const p = b.visible ? b : null;
      if (p !== null && prev !== null) sum += Math.hypot(p.u - prev.u, p.v - prev.v) * ARENA.radius * (b.z > 0.15 ? 0.35 : 1);
      prev = p;
      table[i] = sum;
    }
    byLevel.set(level, table);
  }
  const f = clamp(t / ROLL_STEP, 0, table.length - 2);
  const i = Math.floor(f);
  return lerp(table[i] ?? 0, table[i + 1] ?? 0, f - i);
}

// ---- Escudos que persiguen al balón --------------------------------------------------------------------------------------------------

/** Instantes (relativos) que se promedian para suavizar el movimiento de los escudos: ±0,12 s. */
const SMOOTH_OFFSETS = [-0.12, -0.08, -0.04, 0, 0.04, 0.08, 0.12] as const;
/** Los escudos «persiguen» al balón: van detrás de donde estuvo hace este tiempo (s). */
export const DISC_CHASE_DELAY = 0.3;

interface FrameSource extends BallSource {
  frame(t: number): FrameState;
}

type Discs = Record<Side, { x: number; y: number }>;
const PAUSES: ReadonlySet<string> = new Set(['intro', 'halftime', 'fulltime']);
const discCache = new Map<string, Discs>();

/** El escudo que golpea el balón se lanza hacia él justo antes del golpeo (contacto en ese instante) y se retira después. */
const LUNGE_BEFORE = 0.2;
const LUNGE_AFTER = 0.3;
const LUNGE_REACH = 170;

function applyKickContact(sim: FrameSource, t: number, level: BounceLevel, discs: Discs): Discs {
  let out = discs;
  // Cada golpeo cercano en el tiempo aporta su propio empujón (continuo con su peso), así dos golpeos seguidos no producen saltos.
  for (const kick of kickEvents(sim, level)) {
    const dt = t - kick.t;
    if (dt < -LUNGE_BEFORE || dt > LUNGE_AFTER) continue;
    const w = dt <= 0 ? smoothstep(1 + dt / LUNGE_BEFORE) : 1 - smoothstep(dt / LUNGE_AFTER);
    if (w <= 0) continue;
    const frame = sim.frame(kick.t);
    const side: Side = frame.possession.home >= frame.possession.away ? 'home' : 'away';
    const reach = (DISC_R + BALL_PX) / ARENA.radius;
    const contact = toScreen(rotate({ u: kick.u - kick.du * reach, v: kick.v - kick.dv * reach }, cameraAngle(t)));
    const cur = out[side];
    const otherDisc = out[side === 'home' ? 'away' : 'home'];
    // Si el punto de contacto queda demasiado cerca del otro escudo, el lanzamiento se atenúa (en vez de empujar a nadie de golpe).
    const clearance = Math.hypot(contact.x - otherDisc.x, contact.y - otherDisc.y);
    const fit = smoothstep((clearance - DISC_MIN_DISTANCE * 0.8) / (DISC_MIN_DISTANCE * 0.3));
    const wf = w * fit;
    // El lanzamiento recorre como mucho LUNGE_REACH px (golpeo rápido pero sin teletransportes).
    const gx = contact.x - cur.x;
    const gy = contact.y - cur.y;
    const gl = Math.hypot(gx, gy) || 1;
    const shrink = Math.min(1, LUNGE_REACH / gl);
    let blended = { x: cur.x + gx * shrink * wf * 0.85, y: cur.y + gy * shrink * wf * 0.85 };
    // Seguridad: nunca se amontonan ni se tapan (sólo se aparta el que golpea).
    const dx = blended.x - otherDisc.x;
    const dy = blended.y - otherDisc.y;
    const d = Math.hypot(dx, dy);
    if (d < DISC_MIN_DISTANCE) {
      const ux = d < 1e-3 ? 0 : dx / d;
      const uy = d < 1e-3 ? 1 : dy / d;
      blended = { x: otherDisc.x + ux * DISC_MIN_DISTANCE, y: otherDisc.y + uy * DISC_MIN_DISTANCE };
    }
    const r = Math.hypot(blended.x - ARENA.cx, blended.y - ARENA.cy);
    const maxR = ARENA.radius - DISC_R * 0.35;
    if (r > maxR) blended = { x: ARENA.cx + ((blended.x - ARENA.cx) / r) * maxR, y: ARENA.cy + ((blended.y - ARENA.cy) / r) * maxR };
    out = { ...out, [side]: blended };
  }
  return out;
}

/** Objetivo de los escudos (coreografía): persiguen al balón dibujado (con retraso) y se suavizan en el tiempo, sin saltos. */
export function targetDiscPositions(sim: FrameSource, t: number, level: BounceLevel = 'normal'): Discs {
  const key = `${String(sim.script.seed)}|${sim.script.teams.home.name}|${sim.script.teams.away.name}|${sim.script.pace}|${JSON.stringify(sim.script.score)}|${sim.script.duration.toFixed(3)}|${level}|${t.toFixed(4)}`;
  const hit = discCache.get(key);
  if (hit !== undefined) return hit;
  const centre = sim.frame(t);
  const acc: Discs = { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } };
  let n = 0;
  for (const d of SMOOTH_OFFSETS) {
    const ts = clamp(t - DISC_CHASE_DELAY + d, 0, sim.script.duration);
    const sample = sim.frame(ts);
    // Una pausa (intro, descanso, final) distinta a la del instante actual no se mezcla: se usa el instante actual.
    const paused = sample.phase !== centre.phase && (PAUSES.has(sample.phase) || PAUSES.has(centre.phase));
    const f = paused ? centre : sample;
    const ball = ballScreen(sim, paused ? t : ts, level);
    const p = discScreenPositions(f, ball.visible ? ball : undefined);
    for (const side of ['home', 'away'] as const) {
      acc[side].x += p[side].x;
      acc[side].y += p[side].y;
    }
    n += 1;
  }
  const out: Discs = { home: { x: acc.home.x / n, y: acc.home.y / n }, away: { x: acc.away.x / n, y: acc.away.y / n } };
  if (discCache.size > 64) discCache.clear();
  discCache.set(key, out);
  return out;
}

const trackCache = new WeakMap<object, Map<BounceLevel, DiscTrack>>();

function trackOf(sim: FrameSource, level: BounceLevel): DiscTrack {
  let byLevel = trackCache.get(sim.script);
  if (byLevel === undefined) {
    byLevel = new Map();
    trackCache.set(sim.script, byLevel);
  }
  let track = byLevel.get(level);
  if (track === undefined) {
    track = simulateDiscs({
      seed: sim.script.seed,
      duration: sim.script.duration,
      centre: { x: ARENA.cx, y: ARENA.cy },
      maxRadius: ARENA.radius - DISC_R * 0.35,
      minDistance: DISC_MIN_DISTANCE,
      targetAt: (t) => {
        const d = targetDiscPositions(sim, t, level);
        return [d.home, d.away];
      },
    });
    byLevel.set(level, track);
  }
  return track;
}

/** Contactos de los escudos con la pared o entre sí (para destellos y pruebas). */
export function discContacts(sim: FrameSource, level: BounceLevel = 'normal'): readonly DiscContact[] {
  return trackOf(sim, level).contacts;
}

/**
 * Posición de los escudos: cuerpos con inercia que siguen la coreografía, con empujones deterministas y rebotes contra la pared y entre sí
 * (ver `discPhysics.ts`); encima, el escudo que golpea el balón se lanza hacia él justo en el golpeo.
 */
export function smoothDiscPositions(sim: FrameSource, t: number, level: BounceLevel = 'normal'): Discs {
  const [home, away] = discsAt(trackOf(sim, level), clamp(t, 0, sim.script.duration));
  return applyKickContact(sim, t, level, { home, away });
}
