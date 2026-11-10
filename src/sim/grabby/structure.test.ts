// Round 6, criterion 40: cosmic web from the Zel'dovich approximation (replaces the round-4
// Voronoi model and its tests; see docs/pm/grabby-aliens/plan.md).

import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { simulate, normalizeParams } from './engine';
import { Space } from './geometry';
import { makeRng } from './rng';
import * as structure from './structure';
import { applyCosmicWeb, effectiveWebScaleGly } from './structure';
import { DEFAULTS, type Params } from './types';

/** Measurements go here as well as the console (vitest may swallow console output). */
function record(name: string, value: unknown): void {
  const dir = process.env.GRABBY_MEASURE_DIR;
  console.log(name, JSON.stringify(value));
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${name}.json`, JSON.stringify(value, null, 1));
}

type Case = { name: string; p: Partial<Params> };

// The 2d cases pin 4000 galaxies, the default when these tests were written (round 4); the
// round-5 default of 200k makes the per-galaxy checks below take minutes.
const CASES: Case[] = [
  { name: 'flat 2d', p: { dim: 2, geometry: 'flat', galaxies: 4000 } },
  { name: 'torus 2d', p: { dim: 2, geometry: 'torus', galaxies: 4000 } },
  { name: 'sphere', p: { dim: 2, geometry: 'sphere', galaxies: 4000 } },
  { name: 'flat 3d', p: { dim: 3, geometry: 'flat', galaxies: 8000, sizeGly: 60, webScaleGly: 15 } },
  { name: 'torus 3d', p: { dim: 3, geometry: 'torus', galaxies: 8000, sizeGly: 60, webScaleGly: 15 } },
];

/** The engine's uniform position draw, written out independently. */
function uniform(p: Params): Float32Array {
  const rng = makeRng(p.seed);
  const n = p.galaxies;
  const pos = new Float32Array(3 * n);
  if (p.geometry === 'sphere') {
    const R = p.sizeGly / (2 * Math.PI);
    for (let i = 0; i < n; i++) {
      const z = 2 * rng() - 1;
      const phi = 2 * Math.PI * rng();
      const rho = Math.sqrt(Math.max(0, 1 - z * z));
      pos[3 * i] = R * rho * Math.cos(phi);
      pos[3 * i + 1] = R * rho * Math.sin(phi);
      pos[3 * i + 2] = R * z;
    }
  } else {
    for (let i = 0; i < n; i++) {
      pos[3 * i] = rng() * p.sizeGly;
      pos[3 * i + 1] = rng() * p.sizeGly;
      pos[3 * i + 2] = p.dim === 3 ? rng() * p.sizeGly : 0;
    }
  }
  return pos;
}

/** Squared ranking distance between point a (in A) and point b (in B). */
function d2(p: Params, A: Float32Array, a: number, B: Float32Array, b: number): number {
  let s = 0;
  for (let k = 0; k < 3; k++) {
    let d = Math.abs(A[3 * a + k] - B[3 * b + k]);
    if (p.geometry === 'torus' && d > p.sizeGly / 2) d = p.sizeGly - d;
    s += d * d;
  }
  return s;
}

/** Mean nearest-neighbour distance (galaxy to galaxy) under the metric. */
function meanNN(p: Params, pos: Float32Array): number {
  const space = new Space(pos, p.dim, p.geometry, p.sizeGly);
  const g = space.neighbours(1);
  let sum = 0;
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let q = g.start[i]; q < g.start[i + 1]; q++) best = Math.min(best, g.w[q]);
    sum += best;
  }
  return sum / n;
}

/** Count-in-cells variance / mean (1 for a Poisson field, larger when clustered). */
function countInCellsVMR(p: Params, pos: Float32Array): number {
  const n = pos.length / 3;
  const box3 = p.dim === 3 || p.geometry === 'sphere';
  const lo = p.geometry === 'sphere' ? -p.sizeGly / (2 * Math.PI) : 0;
  const L = p.geometry === 'sphere' ? (2 * p.sizeGly) / (2 * Math.PI) : p.sizeGly;
  const m = box3 ? 8 : 16;
  const counts = new Float64Array(box3 ? m * m * m : m * m);
  const ax = (v: number) => Math.min(m - 1, Math.max(0, Math.floor(((v - lo) / L) * m)));
  for (let i = 0; i < n; i++) {
    const x = ax(pos[3 * i]), y = ax(pos[3 * i + 1]), z = box3 ? ax(pos[3 * i + 2]) : 0;
    counts[(z * m + y) * m + x]++;
  }
  // On the sphere most cubes miss the surface: use only cells the uniform field occupies.
  const used = p.geometry === 'sphere' ? sphereCells(p, m, ax) : null;
  let k = 0, sum = 0, sum2 = 0;
  for (let c = 0; c < counts.length; c++) {
    if (used && !used.has(c)) continue;
    k++;
    sum += counts[c];
    sum2 += counts[c] * counts[c];
  }
  const mean = sum / k;
  return (sum2 / k - mean * mean) / mean;
}

function sphereCells(p: Params, m: number, ax: (v: number) => number): Set<number> {
  const u = uniform({ ...p, galaxies: 200000, seed: 'cells' });
  const s = new Set<number>();
  for (let i = 0; i < u.length / 3; i++) {
    s.add((ax(u[3 * i + 2]) * m + ax(u[3 * i + 1])) * m + ax(u[3 * i]));
  }
  return s;
}

/** Share of fine 2d/3d grid cells (about 4 galaxies each when uniform) holding no galaxy. */
function voidFraction(p: Params, pos: Float32Array): number {
  const n = pos.length / 3, d = p.dim, L = p.sizeGly;
  const m = Math.round(Math.pow(n / 4, 1 / d));
  const cells = new Uint8Array(Math.pow(m, d));
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let k = d - 1; k >= 0; k--) c = c * m + Math.min(m - 1, Math.floor((pos[3 * i + k] / L) * m));
    cells[c] = 1;
  }
  let empty = 0;
  for (const v of cells) if (!v) empty++;
  return empty / cells.length;
}

/** Galaxy density in the outer strip (5% of the side) over that of the interior (2d). */
function edgeStripRatio(p: Params, pos: Float32Array): number {
  const L = p.sizeGly, b = 0.05 * L, n = pos.length / 3;
  let strip = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1];
    if (x < b || y < b || x > L - b || y > L - b) strip++;
  }
  const innerArea = (1 - 0.1) ** 2;
  return strip / (1 - innerArea) / ((n - strip) / innerArea);
}

describe('cosmic web: Zel\'dovich approximation (criterion 40)', () => {
  it('clumpiness 0 is exactly the uniform draw, and leaves positions untouched', () => {
    for (const { p: base } of CASES) {
      const p = normalizeParams({ ...base, clumpiness: 0, seed: 'u0' });
      const r = simulate(p);
      expect(r.positions).toEqual(uniform(p));
      const pos = uniform(p);
      applyCosmicWeb(pos, p);
      expect(pos).toEqual(uniform(p));
    }
  });

  it('the RNG stream after positions is the same at any clumpiness (civ draws unchanged)', () => {
    // Civ candidates are drawn right after positions; with no fronts reaching each other
    // (tiny speed, short cap) every candidate arises, so the civs list is the candidate list.
    const base = { galaxies: 2000, sizeGly: 500, pLife: 1e-21, speedMin: 0.01, speedMax: 0.01, H0: 0, tEndGyr: 20, seed: 'rs' };
    const a = simulate({ ...base, clumpiness: 0 });
    const b = simulate({ ...base, clumpiness: 0.8 });
    expect(a.civs.length).toBeGreaterThan(3);
    expect(b.civs).toEqual(a.civs);
    expect(b.positions).not.toEqual(a.positions);
  });

  it('is deterministic, and the seed changes the web', () => {
    for (const { p } of CASES) {
      const a = simulate({ ...p, clumpiness: 0.7, seed: 'w1', pLife: 1e-30 });
      const b = simulate({ ...p, clumpiness: 0.7, seed: 'w1', pLife: 1e-30 });
      const c = simulate({ ...p, clumpiness: 0.7, seed: 'w2', pLife: 1e-30 });
      expect(b.positions).toEqual(a.positions);
      expect(c.positions).not.toEqual(a.positions);
    }
  });

  it('keeps every galaxy in the domain: wrapped box (flat and torus) in [0, size), on the sphere, z = 0 in 2d', () => {
    for (const { name, p: base } of CASES) {
      for (const clumpiness of [0.3, 0.7, 1]) {
        const r = simulate({ ...base, clumpiness, seed: 'dom', pLife: 1e-30 });
        const p = r.params;
        const R = p.sizeGly / (2 * Math.PI);
        for (let i = 0; i < p.galaxies; i++) {
          const x = r.positions[3 * i], y = r.positions[3 * i + 1], z = r.positions[3 * i + 2];
          expect(Number.isFinite(x + y + z), name).toBe(true);
          if (p.geometry === 'sphere') {
            expect(Math.abs(Math.hypot(x, y, z) - R) / R).toBeLessThan(1e-5);
          } else {
            for (const v of p.dim === 3 ? [x, y, z] : [x, y]) {
              expect(v).toBeGreaterThanOrEqual(0);
              expect(v).toBeLessThan(p.sizeGly);
            }
            if (p.dim === 2) expect(z).toBe(0);
          }
        }
      }
    }
  });

  it('void fraction (empty fine cells) rises with clumpiness and is far above uniform at the defaults', () => {
    const report: Record<string, number[]> = {};
    for (const [name, base] of [
      ['flat 2d', { galaxies: 50000 }],
      ['torus 2d', { geometry: 'torus', galaxies: 50000 }],
      ['flat 3d', { dim: 3, galaxies: 100000 }],
    ] as [string, Partial<Params>][]) {
      const vf = [0, 0.3, DEFAULTS.clumpiness, 1].map((clumpiness) => {
        const p = normalizeParams({ ...base, clumpiness, seed: 'void' });
        const pos = uniform(p);
        applyCosmicWeb(pos, p);
        return voidFraction(p, pos);
      });
      report[name] = vf.map((v) => +v.toFixed(4));
      // Poisson with mean 4 per cell: e^-4 ≈ 0.018 empty.
      expect(vf[0]).toBeLessThan(0.03);
      for (let k = 1; k < vf.length; k++) expect(vf[k], `${name} step ${k}`).toBeGreaterThan(vf[k - 1]);
      expect(vf[2], name).toBeGreaterThan(0.15);
      expect(vf[2], name).toBeGreaterThan(8 * vf[0]);
    }
    record('void-fraction', { clumpiness: [0, 0.3, DEFAULTS.clumpiness, 1], ...report });
  });

  it('clustering is stronger than uniform and rises with clumpiness (count-in-cells VMR, nearest-neighbour distance)', () => {
    const report: Record<string, { vmr: string; meanNN: string }> = {};
    for (const { name, p: base } of CASES) {
      const vmr: number[] = [];
      const nn: number[] = [];
      for (const clumpiness of [0, 0.3, 0.7, 1]) {
        const r = simulate({ ...base, clumpiness, seed: 'clu', pLife: 1e-30 });
        vmr.push(countInCellsVMR(r.params, r.positions));
        nn.push(meanNN(r.params, r.positions));
      }
      report[name] = {
        vmr: vmr.map((v) => v.toFixed(3)).join(' < '),
        meanNN: nn.map((v) => v.toFixed(4)).join(' > '),
      };
      for (let k = 1; k < vmr.length; k++) {
        expect(vmr[k], `${name} vmr ${k}`).toBeGreaterThan(vmr[k - 1]);
        expect(nn[k], `${name} nn ${k}`).toBeLessThan(nn[k - 1]);
      }
      expect(vmr[2], name).toBeGreaterThan(3);
    }
    record('clustering', report);
  });

  it('no pile-up at the flat box edges: the outer strip is within ±20% of the interior density', () => {
    const ratios: number[] = [];
    let strip = 0, all = 0;
    for (const seed of ['e1', 'e2', 'e3', 'e4']) {
      const p = normalizeParams({ seed });
      const pos = uniform(p);
      applyCosmicWeb(pos, p);
      ratios.push(edgeStripRatio(p, pos));
      strip += ratios[ratios.length - 1];
      all++;
    }
    const mean = strip / all;
    record('edge-strip', { perSeed: ratios.map((r) => +r.toFixed(3)), mean: +mean.toFixed(3) });
    expect(mean).toBeGreaterThan(0.8);
    expect(mean).toBeLessThan(1.2);
    for (const r of ratios) expect(Math.abs(r - 1)).toBeLessThan(0.35);
  });

  it('is continuous across the wrap: flat and torus, 2d and 3d', () => {
    for (const base of [
      { geometry: 'torus' as const },
      { geometry: 'flat' as const },
      { geometry: 'torus' as const, dim: 3 as const, galaxies: 8000 },
      { geometry: 'flat' as const, dim: 3 as const, galaxies: 8000 },
    ]) {
      const p = normalizeParams({ ...base, clumpiness: 1, seed: 'wrap' });
      const L = p.sizeGly, eps = 1e-3, m = 200;
      const axes = p.dim;
      for (let axis = 0; axis < axes; axis++) {
        const pos = new Float32Array(6 * m);
        const rng = makeRng('wrap-q');
        for (let i = 0; i < m; i++) {
          for (let k = 0; k < 3; k++) {
            const v = k < axes ? rng() * L : 0;
            pos[6 * i + k] = v;
            pos[6 * i + 3 + k] = v;
          }
          pos[6 * i + axis] = eps;
          pos[6 * i + 3 + axis] = L - eps;
        }
        applyCosmicWeb(pos, p);
        let worst = 0;
        for (let i = 0; i < m; i++) {
          let s = 0;
          for (let k = 0; k < 3; k++) {
            let d = Math.abs(pos[6 * i + k] - pos[6 * i + 3 + k]);
            if (d > L / 2) d = L - d;
            s += d * d;
          }
          worst = Math.max(worst, Math.sqrt(s));
        }
        expect(worst, `${JSON.stringify(base)} axis ${axis}`).toBeLessThan(0.05);
      }
    }
  });

  it('galaxies move by x = q + D·ψ(q), with D linear in clumpiness', () => {
    for (const { name, p: base } of CASES) {
      if (base.geometry === 'sphere') continue; // the sphere moves along great circles instead
      const at = (clumpiness: number) => {
        const p = normalizeParams({ ...base, clumpiness, seed: 'lin' });
        const pos = uniform(p);
        applyCosmicWeb(pos, p);
        return { p, pos };
      };
      const q = uniform(normalizeParams({ ...base, seed: 'lin' }));
      const a = at(0.1), b = at(0.2);
      const L = a.p.sizeGly;
      let checked = 0;
      for (let i = 0; i < q.length / 3; i++) {
        for (let k = 0; k < a.p.dim; k++) {
          const da = a.pos[3 * i + k] - q[3 * i + k], db = b.pos[3 * i + k] - q[3 * i + k];
          const wa = da - L * Math.round(da / L), wb = db - L * Math.round(db / L);
          // float32 positions: compare to within a few ulps of the coordinate
          expect(Math.abs(wb - 2 * wa), name).toBeLessThan(2e-5 * L);
          if (Math.abs(wa) > 1e-3) checked++;
        }
      }
      expect(checked, name).toBeGreaterThan(q.length / 3);
    }
  });
});

describe('the field and its FFT', () => {
  it('the radix-2 FFT matches a direct DFT, and inverse(forward(x)) = N·x', () => {
    const n = 64;
    const rng = makeRng('fft');
    const re = Float64Array.from({ length: n }, () => rng() - 0.5);
    const im = Float64Array.from({ length: n }, () => rng() - 0.5);
    const r0 = re.slice(), i0 = im.slice();
    structure.fft(re, im);
    for (let k = 0; k < n; k++) {
      let sr = 0, si = 0;
      for (let j = 0; j < n; j++) {
        const a = (-2 * Math.PI * j * k) / n;
        sr += r0[j] * Math.cos(a) - i0[j] * Math.sin(a);
        si += r0[j] * Math.sin(a) + i0[j] * Math.cos(a);
      }
      expect(re[k]).toBeCloseTo(sr, 10);
      expect(im[k]).toBeCloseTo(si, 10);
    }
    structure.fft(re, im, true);
    for (let j = 0; j < n; j++) {
      expect(re[j] / n).toBeCloseTo(r0[j], 12);
      expect(im[j] / n).toBeCloseTo(i0[j], 12);
    }
  });

  it('ψ is a gradient flow that converges where δ > 0: curl-free, and the divergence matches −δ', () => {
    // On the grid, central differences of ψ/σ: curl ≈ 0 and mean (∇·ψ)² ≈ 1 (= σ_δ² / σ_δ²).
    // A large web scale keeps the field smooth on the grid, so the differences are accurate.
    for (const base of [{ galaxies: 4000 }, { dim: 3 as const, galaxies: 8000 }]) {
      const p = normalizeParams({ ...base, webScaleGly: 30 });
      const f = structure.webField(p);
      const { n, L, psi, d } = f;
      const h = L / n;
      const at = (c: number, x: number, y: number, z: number) =>
        psi[c][(((z + n) % n) * n + ((y + n) % n)) * n + ((x + n) % n)];
      let div2 = 0, curl2 = 0, grad2 = 0, count = 0;
      const step = d === 3 ? 3 : 7;
      for (let z = 0; z < (d === 3 ? n : 1); z += step) {
        for (let y = 0; y < n; y += step) {
          for (let x = 0; x < n; x += step) {
            const dxx = (at(0, x + 1, y, z) - at(0, x - 1, y, z)) / (2 * h);
            const dyy = (at(1, x, y + 1, z) - at(1, x, y - 1, z)) / (2 * h);
            const dxy = (at(0, x, y + 1, z) - at(0, x, y - 1, z)) / (2 * h);
            const dyx = (at(1, x + 1, y, z) - at(1, x - 1, y, z)) / (2 * h);
            const dzz = d === 3 ? (at(2, x, y, z + 1) - at(2, x, y, z - 1)) / (2 * h) : 0;
            div2 += (dxx + dyy + dzz) ** 2;
            curl2 += (dxy - dyx) ** 2;
            grad2 += dxy ** 2 + dyx ** 2;
            count++;
          }
        }
      }
      // finite differences on a smooth field: the divergence variance is close to 1
      expect(div2 / count).toBeGreaterThan(0.8);
      expect(div2 / count).toBeLessThan(1.05);
      expect(curl2).toBeLessThan(1e-3 * grad2);
    }
  });

  it('the displacement scale follows webScaleGly (rms ψ/σ_δ ∝ R)', () => {
    const rms = (webScaleGly: number) => {
      const f = structure.webField(normalizeParams({ webScaleGly, galaxies: 50000 }));
      let s = 0;
      for (const g of f.psi) for (let q = 0; q < g.length; q++) s += g[q] * g[q];
      return Math.sqrt(s / f.psi[0].length);
    };
    const a = rms(8), b = rms(16);
    expect(b / a).toBeGreaterThan(1.7);
    expect(b / a).toBeLessThan(2.3);
  });

  it('grid size: 512² in 2d; 64³ in 3d and on the sphere, 128³ above 262,144 galaxies', () => {
    expect(structure.gridSize(normalizeParams({}))).toBe(512);
    expect(structure.gridSize(normalizeParams({ galaxies: 1000000 }))).toBe(512);
    expect(structure.gridSize(normalizeParams({ dim: 3 }))).toBe(64);
    expect(structure.gridSize(normalizeParams({ geometry: 'sphere' }))).toBe(64);
    expect(structure.gridSize(normalizeParams({ dim: 3, galaxies: 262145 }))).toBe(128);
  });
});

describe('effective web scale (clamped to [≥ 8 galaxies and ≥ 4 grid cells per web scale, ≤ a third of the universe])', () => {
  const P = (o: Partial<Params>): Params => ({ ...DEFAULTS, ...o });

  it('2d flat, size 93, 4000 galaxies: web scale 2 is floored to 8 galaxies per web cell, ≈ 4.2 Gly', () => {
    const p = P({ dim: 2, geometry: 'flat', sizeGly: 93, galaxies: 4000, webScaleGly: 2 });
    expect(effectiveWebScaleGly(p)).toBeCloseTo(93 / Math.sqrt(500), 9);
    expect((p.galaxies * effectiveWebScaleGly(p) ** 2) / 93 ** 2).toBeCloseTo(8, 9);
    expect(effectiveWebScaleGly(p).toFixed(1)).toBe('4.2');
  });

  it('2d flat, size 93: web scale 100 is capped at a third of the side, 31 Gly', () => {
    const p = P({ dim: 2, geometry: 'flat', sizeGly: 93, galaxies: 4000, webScaleGly: 100 });
    expect(effectiveWebScaleGly(p)).toBeCloseTo(31, 9);
  });

  it('unclamped: exactly the set value (defaults, every geometry)', () => {
    for (const c of CASES) {
      const p = normalizeParams(c.p);
      expect(effectiveWebScaleGly(p), c.name).toBe(p.webScaleGly);
    }
  });

  it('3d: the 64³ grid floors the scale at 4 grid cells; the sphere is capped by its area', () => {
    const cube = P({ dim: 3, geometry: 'torus', sizeGly: 93, galaxies: 200000, webScaleGly: 2 });
    expect(effectiveWebScaleGly(cube)).toBeCloseTo((4 * 93) / 64, 9);
    const sphere = P({ dim: 2, geometry: 'sphere', sizeGly: 93, galaxies: 500, webScaleGly: 100 });
    const Rs = 93 / (2 * Math.PI);
    expect((4 * Math.PI * Rs * Rs) / effectiveWebScaleGly(sphere) ** 2).toBeCloseTo(9, 6);
  });
});
