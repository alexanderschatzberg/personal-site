import { describe, expect, it } from 'vitest';
import { makeRng } from './rng';
import { Space } from './geometry';

describe('rng', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = makeRng('abc');
    const b = makeRng('abc');
    const c = makeRng('abd');
    const xa = Array.from({ length: 5 }, () => a());
    const xb = Array.from({ length: 5 }, () => b());
    const xc = Array.from({ length: 5 }, () => c());
    expect(xa).toEqual(xb);
    expect(xa).not.toEqual(xc);
    for (const x of xa) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('distance', () => {
  it('torus wraps each axis at size (minimum image)', () => {
    const pos = new Float32Array([1, 1, 0, 99, 99, 0]);
    const torus = new Space(pos, 2, 'torus', 100);
    expect(torus.dist(0, 1)).toBeCloseTo(Math.SQRT2 * 2, 4);
    const flat = new Space(pos, 2, 'flat', 100);
    expect(flat.dist(0, 1)).toBeCloseTo(Math.SQRT2 * 98, 3);
  });

  it('torus wraps in 3d too', () => {
    const pos = new Float32Array([5, 50, 1, 5, 50, 99]);
    const torus = new Space(pos, 3, 'torus', 100);
    expect(torus.dist(0, 1)).toBeCloseTo(2, 4);
  });

  it('sphere uses great-circle distance R·angle', () => {
    const size = 2 * Math.PI * 10; // circumference → R = 10
    const R = 10;
    // north pole, a point on the equator, and the south pole
    const pos = new Float32Array([0, 0, R, R, 0, 0, 0, 0, -R]);
    const s = new Space(pos, 2, 'sphere', size);
    expect(s.dist(0, 1)).toBeCloseTo((R * Math.PI) / 2, 4);
    expect(s.dist(0, 2)).toBeCloseTo(R * Math.PI, 4);
  });
});

describe('neighbour graph', () => {
  it('links each node to at least its k nearest (brute force check), symmetrised', () => {
    const rng = makeRng('knn');
    const n = 400;
    const size = 50;
    for (const geometry of ['flat', 'torus'] as const) {
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[3 * i] = rng() * size;
        pos[3 * i + 1] = rng() * size;
      }
      const s = new Space(pos, 2, geometry, size);
      const g = s.neighbours(8);
      for (let i = 0; i < n; i++) {
        const others = [];
        for (let j = 0; j < n; j++) if (j !== i) others.push(s.dist(i, j));
        others.sort((x, y) => x - y);
        const kth = others[7];
        const mine = new Set(Array.from(g.adj.subarray(g.start[i], g.start[i + 1])));
        for (let j = 0; j < n; j++) {
          if (j !== i && s.dist(i, j) < kth - 1e-9) expect(mine.has(j)).toBe(true);
        }
        for (const j of mine) {
          const back = Array.from(g.adj.subarray(g.start[j], g.start[j + 1]));
          expect(back).toContain(i);
        }
      }
    }
  });

  it('counts own galaxies within a radius', () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 3, 0, 0, 99.5, 0, 0]);
    const s = new Space(pos, 2, 'torus', 100);
    const owner = new Int32Array([7, 7, 7, 7]);
    // within 1.5 of galaxy 0: itself, galaxy 1 and (wrapped) galaxy 3
    expect(s.countWithin(0, 1.5, owner, 7)).toBe(3);
  });
});
