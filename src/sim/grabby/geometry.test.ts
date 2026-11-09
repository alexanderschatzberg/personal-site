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

describe('nearestTo (round 4: nearest web nucleus of an arbitrary point)', () => {
  it('matches brute force on flat, torus and sphere in 2d and 3d', () => {
    const cases = [
      { dim: 2 as const, geometry: 'flat' as const },
      { dim: 2 as const, geometry: 'torus' as const },
      { dim: 3 as const, geometry: 'flat' as const },
      { dim: 3 as const, geometry: 'torus' as const },
      { dim: 2 as const, geometry: 'sphere' as const },
    ];
    for (const { dim, geometry } of cases) {
      const size = 50;
      const rng = makeRng(`near-${dim}-${geometry}`);
      const R = size / (2 * Math.PI);
      const point = (): [number, number, number] => {
        if (geometry === 'sphere') {
          const z = 2 * rng() - 1;
          const phi = 2 * Math.PI * rng();
          const rho = Math.sqrt(1 - z * z);
          return [R * rho * Math.cos(phi), R * rho * Math.sin(phi), R * z];
        }
        return [rng() * size, rng() * size, dim === 3 ? rng() * size : 0];
      };
      const m = 300;
      const pos = new Float32Array(3 * m);
      for (let i = 0; i < m; i++) pos.set(point(), 3 * i);
      const space = new Space(pos, dim, geometry, size);
      const d2 = (q: number[], j: number) => {
        let s = 0;
        for (let k = 0; k < 3; k++) {
          let d = Math.abs(q[k] - pos[3 * j + k]);
          if (geometry === 'torus' && d > size / 2) d = size - d;
          s += d * d;
        }
        return s;
      };
      for (let t = 0; t < 400; t++) {
        const q = point();
        let best = 0;
        for (let j = 1; j < m; j++) if (d2(q, j) < d2(q, best)) best = j;
        expect(d2(q, space.nearestTo(q[0], q[1], q[2]))).toBe(d2(q, best));
      }
    }
  });
});

describe('neighbour graph is connected (round 4: clustered galaxies)', () => {
  /** Component count of a CSR graph. */
  const components = (g: { start: Int32Array; adj: Int32Array }, n: number) => {
    const seen = new Uint8Array(n);
    let count = 0;
    for (let s = 0; s < n; s++) {
      if (seen[s]) continue;
      count++;
      const stack = [s];
      seen[s] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        for (let q = g.start[i]; q < g.start[i + 1]; q++) {
          const j = g.adj[q];
          if (!seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    return count;
  };

  it('bridges isolated clumps with their shortest links, keeping every kNN edge', () => {
    for (const geometry of ['flat', 'torus'] as const) {
      for (const dim of [2, 3] as const) {
        // Four tight clumps of 30 points, far apart: the 8-NN graph alone has 4 components.
        const rng = makeRng(`clumps-${geometry}-${dim}`);
        const centres = [[10, 10, 10], [80, 15, 40], [20, 70, 70], [75, 80, 20]];
        const pos = new Float32Array(3 * 120);
        for (let i = 0; i < 120; i++) {
          const c = centres[i % 4];
          for (let k = 0; k < 3; k++) pos[3 * i + k] = k < dim ? c[k] + rng() * 2 : 0;
        }
        const space = new Space(pos, dim, geometry, 100);
        const g = space.neighbours(8);
        expect(components(g, 120)).toBe(1);
        // Exactly 3 bridges were added on top of the symmetrised kNN pairs.
        const knnPairs = new Set<number>();
        for (let i = 0; i < 120; i++) {
          const d = Array.from({ length: 120 }, (_, j) => j)
            .filter((j) => j !== i)
            .sort((a, b) => space.dist(i, a) - space.dist(i, b) || a - b)
            .slice(0, 8);
          for (const j of d) knnPairs.add(Math.min(i, j) * 120 + Math.max(i, j));
        }
        const pairs = new Set<number>();
        for (let i = 0; i < 120; i++) {
          for (let q = g.start[i]; q < g.start[i + 1]; q++) {
            const j = g.adj[q];
            pairs.add(Math.min(i, j) * 120 + Math.max(i, j));
          }
        }
        for (const key of knnPairs) expect(pairs.has(key)).toBe(true);
        expect(pairs.size - knnPairs.size).toBe(3);
      }
    }
  });

  it('uniform points that are already connected get no extra edges', () => {
    const rng = makeRng('uniform-connected');
    const pos = new Float32Array(3 * 2000);
    for (let i = 0; i < 2000; i++) {
      pos[3 * i] = rng() * 50;
      pos[3 * i + 1] = rng() * 50;
    }
    const space = new Space(pos, 2, 'flat', 50);
    const g = space.neighbours(8);
    expect(components(g, 2000)).toBe(1);
    // every edge of i is one of i's 8 nearest, or i is one of the other end's 8 nearest
    const nearest = (i: number) => {
      const best: [number, number][] = [];
      for (let j = 0; j < 2000; j++) if (j !== i) best.push([space.dist(i, j), j]);
      best.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      return new Set(best.slice(0, 8).map((b) => b[1]));
    };
    for (let i = 0; i < 200; i++) {
      const ni = nearest(i);
      for (let q = g.start[i]; q < g.start[i + 1]; q++) {
        const j = g.adj[q];
        expect(ni.has(j) || nearest(j).has(i)).toBe(true);
      }
    }
  });
});
