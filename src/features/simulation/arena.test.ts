import { describe, expect, it } from 'vitest';

import { ballAt, frameAt } from '../../engine/animate.ts';
import { PITCH_L, PITCH_W } from '../../engine/geometry.ts';
import { simulate } from '../../engine/index.ts';
import { generateScript } from '../../engine/script.ts';
import { ARENA, BALL_R, DISC_R, MOUTH_HALF, ballRoll, ballState, ballUnit, bounceEvents, cameraAngle, discScreenPositions, kickEvents, smoothDiscPositions, fieldToScreen, fieldToUnit, maxRadius, rotate, toScreen } from './arena.ts';
import { WALL } from './bounce.ts';
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

describe('discos de los equipos', () => {
  it('no se quedan pegados, caben en el aro y no dan saltos entre fotogramas', () => {
    const seps: number[] = [];
    let maxJump = 0;
    for (const seed of [1, 2, 3, 2024]) {
      const script = generateScript({ seed, home: 'Real Madrid', away: 'RB Leipzig', score: { home: seed % 3, away: 1 } });
      let prev: ReturnType<typeof discScreenPositions> | null = null;
      for (let t = 0; t <= script.duration; t += 1 / 30) {
        const frame = frameAt(script, t);
        if (frame.phase === 'intro' || frame.phase === 'halftime' || frame.phase === 'fulltime') {
          prev = null;
          continue;
        }
        const d = discScreenPositions(frame);
        seps.push(Math.hypot(d.home.x - d.away.x, d.home.y - d.away.y));
        for (const side of ['home', 'away'] as const) {
          expect(Math.hypot(d[side].x - ARENA.cx, d[side].y - ARENA.cy)).toBeLessThanOrEqual(ARENA.radius);
          if (prev !== null) maxJump = Math.max(maxJump, Math.hypot(d[side].x - prev[side].x, d[side].y - prev[side].y));
        }
        prev = d;
      }
    }
    seps.sort((a, b) => a - b);
    expect(seps[0] ?? 0).toBeGreaterThanOrEqual(DISC_R * 3);
    expect(seps[Math.floor(seps.length / 2)] ?? 0).toBeGreaterThan(DISC_R * 4.5);
    expect(maxJump).toBeLessThan(80);
  });
});

describe('movimiento (escudos y balón con rebotes)', () => {
  const sim = simulate({ seed: 2024, home: 'Real Madrid', away: 'RB Leipzig', score: { home: 2, away: 1 } });
  const inGame = (t: number): boolean => !['intro', 'halftime', 'fulltime'].includes(sim.frame(t).phase);

  it('los escudos persiguen al balón sin saltos ni tirones', () => {
    let jump = 0;
    let acc = 0;
    const pts: { x: number; y: number }[] = [];
    for (let t = 0; t < sim.script.duration; t += 1 / 30) {
      if (!inGame(t)) {
        pts.length = 0;
        continue;
      }
      pts.push(smoothDiscPositions(sim, t).home);
      if (pts.length > 3) pts.shift();
      const [a, b, c] = pts;
      if (a === undefined || b === undefined || c === undefined) continue;
      jump = Math.max(jump, Math.hypot(c.x - b.x, c.y - b.y));
      acc = Math.max(acc, Math.hypot(c.x - 2 * b.x + a.x, c.y - 2 * b.y + a.y));
    }
    expect(jump).toBeLessThan(100); // el golpeo lanza al escudo hacia el balón: rápido pero sin teletransportes
    expect(acc).toBeLessThan(60);
  });

  it('el balón dibujado no se teletransporta (salvo en los reinicios, cuando está oculto)', () => {
    let maxStep = 0;
    let prev: { x: number; y: number } | null = null;
    for (let t = 0; t < sim.script.duration; t += 1 / 30) {
      const b = ballState(sim, t, 'high');
      if (!b.visible || !inGame(t)) {
        prev = null;
        continue;
      }
      if (prev !== null) maxStep = Math.max(maxStep, Math.hypot(b.x - prev.x, b.y - prev.y));
      prev = b;
    }
    expect(maxStep).toBeLessThan(260);
  });

  it('hay rebotes en la pared y cumplen la ley de reflexión (ángulo de entrada = de salida)', () => {
    const events = bounceEvents(sim, 'high');
    expect(events.length).toBeGreaterThan(3);
    for (const e of events) {
      const at = ballUnit(sim, e.t, 'high');
      expect(Math.hypot(at.u, at.v)).toBeCloseTo(WALL, 1); // toca la pared
      const dt = 0.01;
      const before = ballUnit(sim, e.t - dt, 'high');
      const after = ballUnit(sim, e.t + dt, 'high');
      const vin = { u: at.u - before.u, v: at.v - before.v };
      const vout = { u: after.u - at.u, v: after.v - at.v };
      const n = { u: at.u / Math.hypot(at.u, at.v), v: at.v / Math.hypot(at.u, at.v) };
      // La componente tangencial se conserva y la normal se invierte.
      const tin = vin.u * -n.v + vin.v * n.u;
      const tout = vout.u * -n.v + vout.v * n.u;
      expect(Math.abs(tin - tout)).toBeLessThan(0.02);
      expect(vin.u * n.u + vin.v * n.v).toBeGreaterThan(0);
      expect(vout.u * n.u + vout.v * n.v).toBeLessThan(0);
    }
  });

  it('con «sin rebotes» no hay ninguno y con más nivel hay más', () => {
    expect(bounceEvents(sim, 'off')).toHaveLength(0);
    expect(bounceEvents(sim, 'high').length).toBeGreaterThanOrEqual(bounceEvents(sim, 'normal').length);
    expect(bounceEvents(sim, 'normal').length).toBeGreaterThanOrEqual(bounceEvents(sim, 'low').length);
  });

  it('los rebotes no cambian los instantes: al empezar y acabar cada tramo el balón está donde dice el guion', () => {
    for (const seg of sim.script.ball) {
      if (seg.kind === 'reset' || seg.t1 - seg.t0 < 0.05) continue;
      const start = ballUnit(sim, seg.t0 + 1e-6, 'high');
      const end = ballUnit(sim, seg.t1 - 1e-6, 'high');
      const a = fieldToUnit(seg.from.x, seg.from.y);
      const b = fieldToUnit(seg.to.x, seg.to.y);
      expect(Math.hypot(start.u - a.u, start.v - a.v)).toBeLessThan(0.02);
      expect(Math.hypot(end.u - b.u, end.v - b.v)).toBeLessThan(0.02);
    }
  });

  it('la distancia rodada nunca decrece y es continua', () => {
    let prev = 0;
    let maxStep = 0;
    for (let t = 0; t <= sim.script.duration; t += 1 / 30) {
      const r = ballRoll(sim, t, 'high');
      expect(r).toBeGreaterThanOrEqual(prev - 1e-6);
      maxStep = Math.max(maxStep, r - prev);
      prev = r;
    }
    expect(prev).toBeGreaterThan(2000);
    expect(maxStep).toBeLessThan(260);
  });

  const speedAt = (t: number, level: 'off' | 'normal' | 'high' = 'off'): number => {
    const a = ballUnit(sim, t - 0.01, level);
    const b = ballUnit(sim, t + 0.01, level);
    return (Math.hypot(b.u - a.u, b.v - a.v) / 0.02) * ARENA.radius; // px/s
  };

  it('el golpeo acelera el balón de golpe y después la fricción lo va frenando (en línea, sin pared)', () => {
    let checked = 0;
    for (const seg of sim.script.ball) {
      if (seg.kind !== 'pass' && seg.kind !== 'cross') continue;
      if (seg.t1 - seg.t0 < 0.35) continue;
      const start = speedAt(seg.t0 + 0.03);
      const middle = speedAt((seg.t0 + seg.t1) / 2);
      const end = speedAt(seg.t1 - 0.04);
      expect(start).toBeGreaterThan(middle * 0.98);
      expect(middle).toBeGreaterThan(end * 0.98);
      expect(start).toBeGreaterThan(end * 1.15); // frena de verdad
      checked += 1;
    }
    expect(checked).toBeGreaterThan(5);
    expect(kickEvents(sim, 'off').length).toBeGreaterThan(5);
  });

  it('el pase elevado sube, cae al suelo y bota (altura nunca negativa)', () => {
    const crosses = sim.script.ball.filter((seg) => seg.kind === 'cross' && seg.t1 - seg.t0 > 0.3);
    expect(crosses.length).toBeGreaterThan(0);
    for (const seg of crosses) {
      let peak = 0;
      let landed = false;
      let rebounded = false;
      for (let tau = 0.01; tau < 1; tau += 0.01) {
        const z = ballUnit(sim, seg.t0 + tau * (seg.t1 - seg.t0), 'normal').z;
        expect(z).toBeGreaterThanOrEqual(0);
        peak = Math.max(peak, z);
        if (tau > 0.68 && tau < 0.72 && z < 0.15) landed = true;
        if (landed && tau > 0.8 && z > 0.1) rebounded = true;
      }
      expect(peak).toBeGreaterThan(seg.arc * 0.9);
      expect(landed).toBe(true);
      expect(rebounded).toBe(true);
    }
  });
});
