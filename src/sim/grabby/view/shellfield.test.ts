import { describe, expect, it } from 'vitest';
import { axisWindow, blur, buildField, fullField, gaussianKernel, gridSize, KERNEL_RADIUS, SIGMA_CELLS, splat } from './shellfield';

const sum = (a: Float32Array) => a.reduce((s, x) => s + x, 0);

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('grid size by galaxy count', () => {
  it('is 48 at the 3d default of 100k, 32 at the fewest galaxies and 64 at the most, never decreasing', () => {
    expect(gridSize(100000)).toBe(48);
    expect(gridSize(500)).toBe(32);
    expect(gridSize(1000000)).toBe(64);
    let last = 0;
    for (const n of [500, 2000, 10000, 30000, 60000, 100000, 200000, 400000, 1000000]) {
      const g = gridSize(n);
      expect(g).toBeGreaterThanOrEqual(Math.max(32, last));
      expect(g).toBeLessThanOrEqual(64);
      last = g;
    }
  });
});

describe('gaussian kernel', () => {
  it('is normalised and symmetric, σ ≈ 1–1.5 cells', () => {
    expect(SIGMA_CELLS).toBeGreaterThanOrEqual(1);
    expect(SIGMA_CELLS).toBeLessThanOrEqual(1.5);
    const k = gaussianKernel(SIGMA_CELLS, KERNEL_RADIUS);
    expect(k.length).toBe(2 * KERNEL_RADIUS + 1);
    expect(sum(k)).toBeCloseTo(1, 6);
    for (let i = 0; i < k.length; i++) expect(k[i]).toBeCloseTo(k[k.length - 1 - i], 7);
  });
});

describe('periodic splat and blur (criterion 54)', () => {
  const G = 16;

  it('cloud-in-cell splat conserves mass and wraps at the upper face', () => {
    const f = fullField(G, true);
    // u = G − 0.25 on x: 0.75 from point G−1, 0.25 from point G ≡ 0, so 0.25 to G−1 and 0.75 wraps
    // to 0. y, z on the lattice.
    splat(f, Float64Array.from([G - 0.25, 3, 5]), 1);
    expect(f.data[(5 * G + 3) * G + (G - 1)]).toBeCloseTo(0.25, 6);
    expect(f.data[(5 * G + 3) * G + 0]).toBeCloseTo(0.75, 6);
    expect(sum(f.data)).toBeCloseTo(1, 6);
    const rand = rng(3);
    const g = fullField(G, true);
    const n = 500;
    const coords = Float64Array.from({ length: 3 * n }, () => rand() * G);
    splat(g, coords, n);
    expect(sum(g.data)).toBeCloseTo(n, 2);
  });

  it('blur conserves mass and spreads a spike at a face equally to both sides (wraps)', () => {
    const f = fullField(G, true);
    f.data[(2 * G + 7) * G + 0] = 1; // x = 0, at the face
    blur(f, gaussianKernel(SIGMA_CELLS, KERNEL_RADIUS));
    expect(sum(f.data)).toBeCloseTo(1, 5);
    const at = (i: number, j: number, k: number) => f.data[(k * G + j) * G + i];
    for (const d of [1, 2, 3]) {
      expect(at(G - d, 7, 2)).toBeCloseTo(at(d, 7, 2), 7);
      expect(at(G - d, 7, 2)).toBeGreaterThan(0);
      expect(at(0, 7, (2 - d + G) % G)).toBeCloseTo(at(0, 7, 2 + d), 7); // z wraps from 2 down past 0
    }
    // Lots of random mass: blur keeps the total.
    const rand = rng(9);
    const g = fullField(G, true);
    for (let i = 0; i < g.data.length; i++) g.data[i] = rand() < 0.1 ? rand() : 0;
    const before = sum(g.data);
    blur(g, gaussianKernel(SIGMA_CELLS, KERNEL_RADIUS));
    expect(sum(g.data)).toBeCloseTo(before, 2);
  });
});

describe('field windows', () => {
  it('periodic: a cluster across the face gets a window that wraps around it, padded on both sides', () => {
    const G = 32, pad = 5;
    const occ = new Uint8Array(G);
    for (const i of [G - 2, G - 1, 0, 1]) occ[i] = 1;
    const w = axisWindow(occ, G, pad, true)!;
    expect(w.wrap).toBe(false);
    expect(w.m).toBe(4 + 2 * pad);
    expect(w.o).toBe(G - 2 - pad);
    // Spread out: the whole axis, wrapping.
    occ.fill(0);
    for (const i of [0, 8, 16, 24]) occ[i] = 1;
    expect(axisWindow(occ, G, pad, true)).toEqual({ o: 0, m: G, wrap: true });
    expect(axisWindow(new Uint8Array(G), G, pad, true)).toBeNull();
  });

  it('flat: clipped to the grid, never wraps', () => {
    const occ = new Uint8Array(20);
    occ[3] = occ[9] = 1;
    expect(axisWindow(occ, 20, 5, false)).toEqual({ o: 0, m: 15, wrap: false });
  });

  for (const periodic of [true, false])
    it(`the windowed field equals the whole-grid field (${periodic ? 'periodic' : 'flat'})`, () => {
      const G = 24;
      const rand = rng(periodic ? 5 : 6);
      const n = 300;
      const coords = new Float64Array(3 * n);
      // A clump straddling the x = 0 face (periodic) or in the middle (flat).
      for (let i = 0; i < n; i++) {
        const x = periodic ? (G + rand() * 6 - 3) % G : 8 + rand() * 6;
        coords.set([x, 9 + rand() * 5, 6 + rand() * 4], 3 * i);
      }
      const k = gaussianKernel(SIGMA_CELLS, KERNEL_RADIUS);
      const full = fullField(G, periodic);
      splat(full, coords, n);
      blur(full, k);
      const win = buildField(coords, n, G, periodic, k)!;
      expect(win.data.length).toBeLessThan(full.data.length);
      const [ax, ay, az] = win.ax;
      const inWin = new Uint8Array(G ** 3);
      for (let c = 0; c < az.m; c++)
        for (let b = 0; b < ay.m; b++)
          for (let a = 0; a < ax.m; a++) {
            const gi = (ax.o + a) % G, gj = (ay.o + b) % G, gk = (az.o + c) % G;
            const g = (gk * G + gj) * G + gi;
            inWin[g] = 1;
            expect(win.data[(c * ay.m + b) * ax.m + a]).toBeCloseTo(full.data[g], 5);
          }
      for (let g = 0; g < G ** 3; g++) if (!inWin[g]) expect(full.data[g]).toBeLessThan(1e-6);
    });
});
