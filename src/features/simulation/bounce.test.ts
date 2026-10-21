import { describe, expect, it } from 'vitest';

import { WALL, pointOnRoute, routeBetween } from './bounce.ts';

const A = { u: -0.5, v: 0.3 };
const B = { u: 0.4, v: -0.2 };

describe('rutas con rebote', () => {
  it('sin rebotes (o tramo corto) la ruta es recta', () => {
    expect(routeBetween(A, B, 1, 'off').bounceAt).toBeNull();
    expect(routeBetween(A, { u: -0.45, v: 0.3 }, 1, 'high').bounceAt).toBeNull();
  });

  it('es determinista: misma semilla, misma ruta', () => {
    expect(routeBetween(A, B, 42, 'high')).toEqual(routeBetween(A, B, 42, 'high'));
  });

  it('con rebote toca la pared, cumple la ley de reflexión y respeta los extremos', () => {
    let bounced = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const r = routeBetween(A, B, seed, 'high');
      expect(r.pts[0]).toEqual(A);
      expect(r.pts.at(-1)).toEqual(B);
      if (r.bounceAt === null) continue;
      bounced += 1;
      const p = r.pts[1];
      if (p === undefined) throw new Error('falta el punto de rebote');
      expect(Math.hypot(p.u, p.v)).toBeCloseTo(WALL, 6);
      const l1 = Math.hypot(p.u - A.u, p.v - A.v);
      const l2 = Math.hypot(B.u - p.u, B.v - p.v);
      expect(r.bounceAt).toBeCloseTo(l1 / (l1 + l2), 9);
      // Ángulo de entrada = ángulo de salida respecto a la normal (radial).
      const n = { u: p.u / WALL, v: p.v / WALL };
      const din = { u: (p.u - A.u) / l1, v: (p.v - A.v) / l1 };
      const dout = { u: (B.u - p.u) / l2, v: (B.v - p.v) / l2 };
      const k = 2 * (din.u * n.u + din.v * n.v);
      expect(Math.hypot(dout.u - (din.u - k * n.u), dout.v - (din.v - k * n.v))).toBeLessThan(0.05);
      // Toda la ruta queda dentro del aro.
      for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const q = pointOnRoute(r, f);
        expect(Math.hypot(q.u, q.v)).toBeLessThanOrEqual(WALL + 1e-6);
      }
    }
    expect(bounced).toBeGreaterThan(30);
  });

  it('no rebota justo en las bocas de las porterías', () => {
    for (let seed = 1; seed <= 80; seed += 1) {
      const p = routeBetween({ u: 0.1, v: 0.4 }, { u: -0.2, v: 0.5 }, seed, 'high').pts[1];
      if (p === undefined) continue;
      const theta = Math.atan2(p.v, p.u);
      expect(Math.abs(Math.cos(theta)) < 0.3 && Math.abs(Math.sin(theta)) > 0.7).toBe(false);
    }
  });

  it('recorrido: empieza y acaba en los extremos y avanza de forma continua', () => {
    const r = routeBetween(A, B, 7, 'high');
    expect(pointOnRoute(r, 0)).toEqual(A);
    const end = pointOnRoute(r, 1);
    expect(end.u).toBeCloseTo(B.u, 9);
    expect(end.v).toBeCloseTo(B.v, 9);
    let prev = pointOnRoute(r, 0);
    for (let f = 0.01; f <= 1; f += 0.01) {
      const q = pointOnRoute(r, f);
      expect(Math.hypot(q.u - prev.u, q.v - prev.v)).toBeLessThan(r.length * 0.03);
      prev = q;
    }
  });

  it('con efecto, el pase hace un arco suave con los mismos extremos y dentro del aro', () => {
    const r = routeBetween(A, B, 3, 'off', 0.12);
    expect(r.bounceAt).toBeNull();
    expect(r.pts.length).toBeGreaterThan(10);
    expect(r.pts[0]).toEqual(A);
    expect(r.pts.at(-1)).toEqual(B);
    expect(r.length).toBeGreaterThan(Math.hypot(B.u - A.u, B.v - A.v));
    for (const p of r.pts) expect(Math.hypot(p.u, p.v)).toBeLessThanOrEqual(WALL + 1e-9);
    // Las dos semillas de distinta paridad lo curvan hacia lados opuestos.
    const other = routeBetween(A, B, 4, 'off', 0.12);
    const mid = (route: typeof r): number => (route.pts[12]?.u ?? 0) * (B.v - A.v) - (route.pts[12]?.v ?? 0) * (B.u - A.u);
    expect(Math.sign(mid(r))).not.toBe(Math.sign(mid(other)));
  });
});
