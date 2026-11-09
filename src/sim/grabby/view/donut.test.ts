import { describe, expect, it } from 'vitest';
import { DONUT_LIFT, donutRadii, donutSegment, embedDonut, embedPositions, facesCamera } from './donut';

const L = 70;
const { R, r } = donutRadii(L);
/** Distance from p to the tube's centre circle (radius R in the xy plane). */
const tubeDist = (p: ArrayLike<number>) => Math.hypot(Math.hypot(p[0], p[1]) - R, p[2]);

describe('donut embedding', () => {
  it('R ≈ 2.5 r, and the donut spans the same width as the flat square', () => {
    expect(R / r).toBeCloseTo(2.5, 12);
    expect(2 * (R + r)).toBeCloseTo(L, 12);
  });

  it('maps u = x/size and v = y/size to angles on the surface', () => {
    const p = new Float64Array(3), n = new Float64Array(3);
    embedDonut(0, 0, L, R, r, 1, p, n);
    expect([...p].map((v) => +v.toFixed(9))).toEqual([R + r, 0, 0]); // outer equator
    embedDonut(0, L / 2, L, R, r, 1, p, n);
    expect(p[0]).toBeCloseTo(R - r, 9); // inner equator
    embedDonut(0, L / 4, L, R, r, 1, p, n);
    expect(p[2]).toBeCloseTo(r, 9); // top of the tube
    expect(n[2]).toBeCloseTo(1, 9);
    embedDonut(L / 4, 0, L, R, r, 1, p, n);
    expect(p[1]).toBeCloseTo(R + r, 9); // a quarter turn round the hole
  });

  it('wraps like the flat torus: x and x + size land on the same point', () => {
    const a = new Float64Array(3), b = new Float64Array(3), n = new Float64Array(3);
    for (const [x, y] of [[3, 5], [69.9, 0.1], [35, 52]]) {
      embedDonut(x, y, L, R, r, 1, a, n);
      embedDonut(x + L, y - L, L, R, r, 1, b, n);
      for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k], 9);
    }
  });

  it('every point is on the surface with a unit outward normal', () => {
    const pos = new Float32Array([1, 2, 0, 30, 40, 0, 69, 69, 0, 0, 35, 0]);
    const { world, normals } = embedPositions(pos, L);
    for (let i = 0; i < 4; i++) {
      const p = world.subarray(3 * i, 3 * i + 3), n = normals.subarray(3 * i, 3 * i + 3);
      expect(tubeDist(p)).toBeCloseTo(r, 4);
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5);
      // the normal points away from the tube's centre circle
      const ring = Math.hypot(p[0], p[1]);
      const c = [(p[0] / ring) * R, (p[1] / ring) * R, 0];
      expect(n[0] * (p[0] - c[0]) + n[1] * (p[1] - c[1]) + n[2] * (p[2] - c[2])).toBeGreaterThan(0);
    }
  });

  it('only the near side faces a camera above the donut', () => {
    const p = new Float64Array(3), n = new Float64Array(3);
    const cam = [0, 0, 5 * L];
    embedDonut(10, L / 4, L, R, r, 1, p, n); // top
    expect(facesCamera(p, n, cam)).toBe(true);
    embedDonut(10, (3 * L) / 4, L, R, r, 1, p, n); // bottom, right under it
    expect(facesCamera(p, n, cam)).toBe(false);
  });

  it('a border segment (flat torus coords, may cross the seam) sits on the surface', () => {
    const out = new Float64Array(6);
    for (const seg of [[10, 10, 0, 12, 11, 0], [69.5, 3, 0, 70.5, 4, 0], [-0.5, 34, 0, 0.5, 36, 0]]) {
      donutSegment(seg, L, R, r, out);
      const a = out.subarray(0, 3), b = out.subarray(3, 6);
      expect(tubeDist(a)).toBeCloseTo(r * DONUT_LIFT, 6);
      expect(tubeDist(b)).toBeCloseTo(r * DONUT_LIFT, 6);
      // short: never drawn across the donut. The embedding stretches lengths by at most
      // 2π (R + r) / size (round the outer equator).
      const flat = Math.hypot(seg[3] - seg[0], seg[4] - seg[1]);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThanOrEqual((flat * 2 * Math.PI * (R + r)) / L + 1e-9);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      expect(Math.abs(tubeDist(mid) - r)).toBeLessThan(0.1 * r);
    }
  });
});
