import { describe, expect, it } from 'vitest';

import { ballAt } from '../../engine/animate.ts';
import { PITCH_L, PITCH_W } from '../../engine/geometry.ts';
import { generateScript } from '../../engine/script.ts';
import { ARENA, BALL_R, MOUTH_HALF, cameraAngle, fieldToScreen, fieldToUnit, maxRadius, rotate, toScreen } from './arena.ts';
import { crestPattern } from './crest.ts';

describe('geometría de la arena', () => {
  it('el centro del campo es el centro de la arena', () => {
    const c = fieldToUnit(PITCH_W / 2, PITCH_L / 2);
    expect(c.u).toBeCloseTo(0, 9);
    expect(c.v).toBeCloseTo(0, 9);
    const s = toScreen(c);
    expect(s.x).toBeCloseTo(ARENA.cx, 6);
    expect(s.y).toBeCloseTo(ARENA.cy, 6);
  });

  it('cualquier punto del campo queda dentro del aro (salvo la boca de la portería)', () => {
    for (let x = 0; x <= PITCH_W; x += 2) {
      for (let y = 0; y <= PITCH_L; y += 3) {
        const p = fieldToUnit(x, y);
        expect(Math.hypot(p.u, p.v)).toBeLessThanOrEqual(maxRadius(p.u) + 1e-9);
      }
    }
  });

  it('un tiro a gol (hacia la red entre los palos) cruza la boca de la portería hacia fuera del aro', () => {
    for (const lineY of [0, PITCH_L]) {
      const dir = lineY === 0 ? -1 : 1;
      for (const dx of [-3.3, -1, 0, 1.4, 3.3]) {
        const p = fieldToUnit(PITCH_W / 2 + dx, lineY + dir * 1.1);
        expect(Math.abs(p.u)).toBeLessThan(MOUTH_HALF);
        expect(Math.hypot(p.u, p.v)).toBeGreaterThan(1);
      }
    }
  });

  it('un tiro desviado fuera de los palos se queda dentro del aro', () => {
    for (const lineY of [0, PITCH_L]) {
      const dir = lineY === 0 ? -1 : 1;
      for (const dx of [-12, -8, 8, 12]) {
        const p = fieldToUnit(PITCH_W / 2 + dx, lineY + dir * 2.5);
        expect(Math.hypot(p.u, p.v)).toBeLessThanOrEqual(1 - BALL_R + 1e-6);
      }
    }
  });

  it('la proyección es continua (sin saltos al recorrer el campo)', () => {
    const at = (i: number): { x: number; y: number } => ({ x: (i / 4000) * PITCH_W, y: PITCH_L / 2 + Math.sin(i / 120) * 60 });
    let prev = fieldToUnit(at(0).x, at(0).y);
    let worst = 0;
    for (let i = 1; i <= 4000; i += 1) {
      const { x, y } = at(i);
      const p = fieldToUnit(x, y);
      worst = Math.max(worst, Math.hypot(p.u - prev.u, p.v - prev.v));
      prev = p;
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('rotar y volver da el mismo punto, y la cámara gira despacio (< 1 rad/s)', () => {
    const p = { u: 0.3, v: -0.4 };
    const back = rotate(rotate(p, 1.234), -1.234);
    expect(back.u).toBeCloseTo(p.u, 9);
    expect(back.v).toBeCloseTo(p.v, 9);
    for (let t = 0; t < 90; t += 0.1) expect(Math.abs(cameraAngle(t + 0.01) - cameraAngle(t)) / 0.01).toBeLessThan(1);
  });

  it('en todos los goles de la simulación el balón está dentro de la portería (en ambas partes)', () => {
    let goals = 0;
    for (let seed = 1; seed <= 25; seed += 1) {
      const s = generateScript({ seed, home: 'Real Madrid', away: 'FC Barcelona', score: { home: 2, away: 2 } });
      for (const e of s.events.filter((x) => x.type === 'goal')) {
        const b = ballAt(s, e.t);
        const p = fieldToUnit(b.x, b.y);
        expect(Math.abs(p.u)).toBeLessThan(MOUTH_HALF + 0.01);
        expect(Math.hypot(p.u, p.v)).toBeGreaterThan(1);
        const screen = fieldToScreen(b.x, b.y, e.t);
        expect(Math.hypot(screen.x - ARENA.cx, screen.y - ARENA.cy)).toBeGreaterThan(ARENA.radius);
        goals += 1;
      }
    }
    expect(goals).toBe(100);
  });
});

describe('escudos genéricos', () => {
  it('el patrón es estable por nombre y hay variedad entre equipos', () => {
    expect(crestPattern('Real Madrid')).toBe(crestPattern('Real Madrid'));
    const names = ['Real Madrid', 'FC Barcelona', 'Sevilla FC', 'Valencia CF', 'Athletic Club', 'Villarreal CF', 'Getafe CF', 'Girona FC'];
    expect(new Set(names.map(crestPattern)).size).toBeGreaterThan(2);
  });
});
