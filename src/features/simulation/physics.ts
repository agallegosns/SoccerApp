import type { BallKind } from '../../engine/types.ts';

/**
 * Física del balón dibujado en la arena. El guion fija de dónde a dónde va el balón y cuánto tarda (así los goles, las paradas y el marcador
 * siguen siendo coherentes); aquí se decide **cómo** se mueve en ese tiempo, con leyes físicas sencillas:
 *  - el golpeo le da de golpe su velocidad máxima (aceleración instantánea al ser golpeado);
 *  - después rueda y **pierde velocidad por la fricción** (decaimiento exponencial, dv/dt = −k·v);
 *  - al chocar con la pared del aro **rebota** (reflexión) y **pierde parte de la velocidad** (coeficiente de restitución);
 *  - un pase elevado sigue una parábola, **cae** y **rebota** en el suelo con altura cada vez menor.
 * La velocidad inicial se calcula para que el balón llegue exactamente a su destino a la hora que dice el guion.
 */

/** Fricción (1/s) según el tipo de tramo: el tiro casi no frena; el balón que rueda suelto frena mucho. */
export const FRICTION: Readonly<Record<BallKind, number>> = {
  idle: 0,
  reset: 0,
  carry: 2,
  pass: 1.3,
  cross: 0.55,
  shot: 0.2,
  retrieve: 1.6,
};

/** Fracción de la velocidad que se conserva al chocar con la pared. */
export const WALL_KEEP = 0.8;
/** Restitución vertical del balón al botar (cada bote alcanza RESTITUTION² de la altura anterior). */
export const RESTITUTION = 0.55;

export const PROFILE_STEPS = 64;

/** Fracción de la distancia recorrida (0–1) en cada instante del tramo (`PROFILE_STEPS + 1` muestras uniformes en el tiempo). */
export type Profile = Float32Array;

/** Distancia recorrida a los `t` s de un golpeo con velocidad `v0` y fricción `k` (forma cerrada), con pérdida de velocidad al llegar a `wallDist`. */
function distance(t: number, v0: number, k: number, wallDist: number | null): number {
  const free = (time: number, v: number): number => (k <= 1e-9 ? v * time : (v * (1 - Math.exp(-k * time))) / k);
  if (wallDist === null) return free(t, v0);
  // Instante en que llega a la pared (si llega): s(tw) = wallDist.
  const ratio = k <= 1e-9 ? 0 : (k * wallDist) / v0;
  if (ratio >= 1) return free(t, v0); // se para antes de la pared
  const tw = k <= 1e-9 ? wallDist / v0 : -Math.log(1 - ratio) / k;
  if (t <= tw) return free(t, v0);
  return wallDist + free(t - tw, v0 * Math.exp(-k * tw) * WALL_KEEP);
}

/**
 * Perfil de avance del balón: velocidad inicial `v0` (la del golpeo) tal que tras `duration` s con fricción `k` ha recorrido justo `length`.
 * Si choca con la pared (`wallAt` = fracción del recorrido), pierde `1 − WALL_KEEP` de su velocidad en el choque.
 */
export function buildProfile(length: number, duration: number, k: number, wallAt: number | null): Profile {
  const out: Profile = new Float32Array(PROFILE_STEPS + 1);
  const linear = length <= 1e-9 || duration <= 1e-9 || (k <= 1e-9 && wallAt === null);
  if (linear) {
    for (let i = 0; i <= PROFILE_STEPS; i += 1) out[i] = i / PROFILE_STEPS;
    return out;
  }
  const wallDist = wallAt === null ? null : wallAt * length;
  // Búsqueda binaria de v0 (la distancia crece con v0).
  let lo = length / duration;
  let hi = (length / duration) * 60;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (distance(duration, mid, k, wallDist) < length) lo = mid;
    else hi = mid;
  }
  const v0 = (lo + hi) / 2;
  for (let i = 0; i <= PROFILE_STEPS; i += 1) out[i] = Math.min(1, distance((i / PROFILE_STEPS) * duration, v0, k, wallDist) / length);
  out[PROFILE_STEPS] = 1;
  return out;
}

/** Progreso (0–1) del recorrido en el instante `tau` (0–1) del tramo. */
export function progressAt(profile: Profile, tau: number): number {
  const f = Math.min(Math.max(tau, 0), 1) * PROFILE_STEPS;
  const i = Math.min(Math.floor(f), PROFILE_STEPS - 1);
  const a = profile[i] ?? 0;
  const b = profile[i + 1] ?? 1;
  return a + (b - a) * (f - i);
}

/** Altura del balón (unidades de `arc`) en el instante `tau` (0–1): parábola hasta caer y botes cada vez más bajos. */
export function heightAt(arc: number, tau: number): number {
  if (arc <= 0) return 0;
  const land = arc >= 1 ? 0.7 : 0.88;
  const t = Math.min(Math.max(tau, 0), 1);
  if (t <= land) {
    const u = t / land;
    return arc * 4 * u * (1 - u);
  }
  let start = land;
  let dur = land * RESTITUTION;
  let peak = arc * RESTITUTION * RESTITUTION;
  for (let i = 0; i < 6 && start < 1; i += 1) {
    if (t <= start + dur) {
      const u = (t - start) / dur;
      return peak * 4 * u * (1 - u);
    }
    start += dur;
    dur *= RESTITUTION;
    peak *= RESTITUTION * RESTITUTION;
  }
  return 0;
}
