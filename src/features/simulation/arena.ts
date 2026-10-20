import { ballAt } from '../../engine/animate.ts';
import { PITCH_L, PITCH_W, clamp, goalLineY, lerp, smoothstep, type Side } from '../../engine/geometry.ts';
import type { FrameState } from '../../engine/index.ts';

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

/**
 * Posición en pantalla de los dos escudos. Cada uno se construye **relativo al balón**, siempre en la dirección de su propia portería:
 * el que **tiene la posesión** va justo detrás del balón (lo conduce por el borde) y el que **defiende** se queda más lejos, entre el balón y
 * su portería, marcando, con un vaivén lateral. Se mezclan con el peso de posesión continuo (sin saltos al cambiar el balón de equipo).
 * Como los dos vectores apuntan a porterías opuestas, los escudos quedan a ambos lados del balón: nunca amontonados ni tapándolo.
 */
export function discScreenPositions(frame: Pick<FrameState, 'ball' | 'half' | 'possession' | 't'>): Record<Side, { x: number; y: number }> {
  const angle = cameraAngle(frame.t);
  // Los discos siguen al balón, pero no pegados al aro: con el balón en la red (borde del círculo) se anclan algo más adentro,
  // y así la separación y el límite del aro no se pelean entre sí (sin saltos).
  const rawBall = fieldToScreen(frame.ball.x, frame.ball.y, frame.t);
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
  // El aro puede deshacer parte de la separación: se relajan las dos restricciones unas veces.
  for (let i = 0; i < 6; i += 1) {
    separate();
    keepInside();
  }
  separate();
  return out;
}

/** Instantes (relativos) que se promedian para suavizar el movimiento: ±0,12 s, ~7 fotogramas a 30 fps. */
const SMOOTH_OFFSETS = [-0.12, -0.08, -0.04, 0, 0.04, 0.08, 0.12] as const;

/** Ventana del balón: ±0,2 s (11 muestras, pesos triangulares). */
const BALL_WINDOW = 0.2;
const BALL_OFFSETS = Array.from({ length: 11 }, (_, i) => -BALL_WINDOW + i * 0.04);

interface BallSource {
  readonly script: Parameters<typeof ballAt>[0];
}

/**
 * Balón suavizado en coordenadas de campo: media de la trayectoria en una ventana corta. Quita los «tirones» de los cambios de pase
 * (velocidad constante por tramos) sin mover el instante de los sucesos. No cruza los reinicios (el balón oculto) para no arrastrarlo.
 */
export function smoothBall(sim: BallSource, t: number): { x: number; y: number; z: number; visible: boolean } {
  const centre = ballAt(sim.script, t);
  if (!centre.visible) return centre;
  let x = 0;
  let y = 0;
  let z = 0;
  let total = 0;
  for (const d of BALL_OFFSETS) {
    const b = ballAt(sim.script, clamp(t + d, 0, sim.script.duration));
    // Un instante con el balón oculto (reinicio) se sustituye por el del centro, así no hay saltos al entrar o salir de él.
    const use = b.visible ? b : centre;
    const w = 1 - Math.abs(d) / (BALL_WINDOW + 0.04); // pesos triangulares: el balón acelera y frena con suavidad
    x += use.x * w;
    y += use.y * w;
    z += use.z * w;
    total += w;
  }
  return { x: x / total, y: y / total, z: z / total, visible: true };
}

/** Frecuencia (Hz) a la que el balón «se escapa» del jugador que lo conduce y éste lo recoge. */
const DRIBBLE_HZ = 1.1;
/** Ventana (s) para la dirección de avance: ancha, para que el balón no se desvíe a tirones cuando el rumbo cambia. */
const HEADING_SPAN = 0.3;

/**
 * Posición en pantalla del balón que se dibuja: el balón suavizado más un movimiento «por libre» mientras un equipo lo conduce
 * (el balón se adelanta al disco y se desvía a los lados, y el disco lo persigue), para que no parezca pegado al escudo.
 * Es un efecto sólo visual: no cambia los sucesos ni el marcador. Los pases y tiros ya viajan solos y no se tocan.
 */
export function ballScreen(sim: BallSource, t: number): { x: number; y: number; visible: boolean } {
  const base = smoothBall(sim, t);
  const p = fieldToScreen(base.x, base.y, t);
  if (!base.visible) return { ...p, visible: false };
  let carry = 0;
  for (const d of BALL_OFFSETS) {
    const seg = ballAt(sim.script, clamp(t + d, 0, sim.script.duration)).seg;
    if (seg?.kind === 'carry') carry += 1;
  }
  const w = smoothstep(carry / BALL_OFFSETS.length);
  if (w <= 0) return { ...p, visible: true };
  const a = smoothBall(sim, t - HEADING_SPAN);
  const b = smoothBall(sim, t + HEADING_SPAN);
  const pa = fieldToScreen(a.x, a.y, t - HEADING_SPAN);
  const pb = fieldToScreen(b.x, b.y, t + HEADING_SPAN);
  const hx = pb.x - pa.x;
  const hy = pb.y - pa.y;
  const len = Math.hypot(hx, hy);
  if (len < 1e-3) return { ...p, visible: true };
  const ux = hx / len;
  const uy = hy / len;
  const moving = smoothstep(len / 90); // casi parado: sin desvío (la dirección sería inestable)
  const kick = Math.sin(Math.PI * t * DRIBBLE_HZ) ** 2;
  const lead = w * moving * (24 + 84 * kick);
  const side = w * moving * 30 * Math.sin(2 * Math.PI * 0.6 * t + 1.3);
  let x = p.x + ux * lead - uy * side;
  let y = p.y + uy * lead + ux * side;
  const dx = x - ARENA.cx;
  const dy = y - ARENA.cy;
  const r = Math.hypot(dx, dy);
  const limit = ARENA.radius * 0.92;
  if (r > limit) {
    x = ARENA.cx + (dx / r) * limit;
    y = ARENA.cy + (dy / r) * limit;
  }
  return { x, y, visible: true };
}

const ROLL_STEP = 1 / 60;
const rollCache = new WeakMap<object, Float32Array>();

/** Distancia (px de pantalla) que ha rodado el balón desde el inicio: sirve para girar su dibujo como si rodase de verdad. */
export function ballRoll(sim: BallSource, t: number): number {
  let table = rollCache.get(sim.script);
  if (table === undefined) {
    const n = Math.ceil(sim.script.duration / ROLL_STEP) + 2;
    table = new Float32Array(n);
    let prev: { x: number; y: number } | null = null;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const tt = Math.min(i * ROLL_STEP, sim.script.duration);
      const b = ballScreen(sim, tt);
      const p = b.visible ? b : null;
      if (p !== null && prev !== null) sum += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
      table[i] = sum;
    }
    rollCache.set(sim.script, table);
  }
  const f = clamp(t / ROLL_STEP, 0, table.length - 2);
  const i = Math.floor(f);
  return lerp(table[i] ?? 0, table[i + 1] ?? 0, f - i);
}

interface FrameSource extends BallSource {
  frame(t: number): FrameState;
}

const PAUSES: ReadonlySet<string> = new Set(['intro', 'halftime', 'fulltime']);
type Discs = Record<Side, { x: number; y: number }>;
const discCache = new Map<string, Discs>();

/** Posición de los discos suavizada en el tiempo (media de `discScreenPositions` en una ventana corta): movimiento fluido y sin saltos. */
export function smoothDiscPositions(sim: FrameSource, t: number): Discs {
  const key = `${String(sim.script.seed)}|${sim.script.teams.home.name}|${sim.script.teams.away.name}|${sim.script.pace}|${JSON.stringify(sim.script.score)}|${sim.script.duration.toFixed(3)}|${t.toFixed(4)}`;
  const hit = discCache.get(key);
  if (hit !== undefined) return hit;
  const centre = sim.frame(t);
  const acc: Discs = { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } };
  let n = 0;
  for (const d of SMOOTH_OFFSETS) {
    const f = d === 0 ? centre : sim.frame(clamp(t + d, 0, sim.script.duration));
    // Un instante de una pausa (intro, descanso, final) distinta a la del centro se sustituye por el del centro: no se promedia con ella.
    const p = discScreenPositions(f.phase !== centre.phase && (PAUSES.has(f.phase) || PAUSES.has(centre.phase)) ? centre : f);
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
