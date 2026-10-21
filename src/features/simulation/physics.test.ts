import { describe, expect, it } from 'vitest';

import { PROFILE_STEPS, RESTITUTION, WALL_KEEP, buildProfile, heightAt, progressAt } from './physics.ts';

const speedAt = (p: Float32Array, i: number): number => ((p[i + 1] ?? 0) - (p[i] ?? 0)) * PROFILE_STEPS; // fracción de la distancia por «tramo completo»

describe('perfil de velocidad del balón (golpe + fricción)', () => {
  it('empieza en 0, acaba en 1 y nunca retrocede', () => {
    for (const k of [0, 0.2, 1.3, 2]) {
      const p = buildProfile(0.8, 0.6, k, null);
      expect(p[0]).toBe(0);
      expect(p[PROFILE_STEPS]).toBe(1);
      for (let i = 1; i <= PROFILE_STEPS; i += 1) expect(p[i] ?? 0).toBeGreaterThanOrEqual((p[i - 1] ?? 0) - 1e-6);
    }
  });

  it('sin fricción va a velocidad constante', () => {
    const p = buildProfile(1, 1, 0, null);
    expect(progressAt(p, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('con fricción sale a su velocidad máxima (golpe) y frena de forma continua', () => {
    const p = buildProfile(1, 0.8, 1.3, null);
    const speeds = Array.from({ length: PROFILE_STEPS }, (_, i) => speedAt(p, i));
    for (let i = 1; i < speeds.length - 1; i += 1) expect(speeds[i] ?? 0).toBeLessThanOrEqual((speeds[i - 1] ?? 0) + 1e-3); // nunca acelera rodando
    expect(speeds[0] ?? 0).toBeGreaterThan(1.3); // más rápido que la media (1)
    expect(speeds[PROFILE_STEPS - 1] ?? 9).toBeLessThan(0.7);
    // Decaimiento exponencial: la razón entre velocidades de instantes equiespaciados es constante.
    const r1 = (speeds[16] ?? 0) / (speeds[8] ?? 1);
    const r2 = (speeds[32] ?? 0) / (speeds[24] ?? 1);
    expect(Math.abs(r1 - r2)).toBeLessThan(0.02);
  });

  it('a más fricción, mayor velocidad inicial para llegar al mismo sitio a la misma hora', () => {
    expect(speedAt(buildProfile(1, 0.8, 2, null), 0)).toBeGreaterThan(speedAt(buildProfile(1, 0.8, 0.3, null), 0));
  });

  it('al chocar con la pared pierde velocidad (y sigue llegando a su destino)', () => {
    const without = buildProfile(1, 0.8, 0.5, null);
    const withWall = buildProfile(1, 0.8, 0.5, 0.5);
    expect(withWall[PROFILE_STEPS]).toBe(1);
    // Justo después del choque va más despacio que antes del choque en la ruta sin pared.
    const iWall = withWall.findIndex((v) => v >= 0.5);
    const before = speedAt(withWall, Math.max(0, iWall - 2));
    const after = speedAt(withWall, Math.min(PROFILE_STEPS - 1, iWall + 2));
    expect(after / before).toBeLessThan(WALL_KEEP + 0.1);
    expect(speedAt(withWall, 0)).toBeGreaterThan(speedAt(without, 0)); // para compensar el choque, sale más fuerte
  });
});

describe('altura del balón (parábola, caída y botes)', () => {
  it('nunca es negativa, sube hasta la altura del pase y cae al suelo', () => {
    for (const arc of [0.4, 2.6, 4.5]) {
      let peak = 0;
      for (let tau = 0; tau <= 1; tau += 0.005) {
        const z = heightAt(arc, tau);
        expect(z).toBeGreaterThanOrEqual(0);
        peak = Math.max(peak, z);
      }
      expect(peak).toBeCloseTo(arc, 1);
    }
    expect(heightAt(0, 0.5)).toBe(0);
    expect(heightAt(2.6, 0)).toBeCloseTo(0, 9);
    expect(heightAt(2.6, 0.7)).toBeCloseTo(0, 6); // toca el suelo al caer
  });

  it('tras caer rebota y cada bote es más bajo (restitución)', () => {
    const arc = 2.6;
    const first = heightAt(arc, 0.7 + 0.7 * RESTITUTION * 0.5);
    expect(first).toBeCloseTo(arc * RESTITUTION * RESTITUTION, 1);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(arc);
  });
});
