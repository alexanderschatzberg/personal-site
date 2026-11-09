// Round 4, criterion 30: cosmic web from a Voronoi kinematic model.

import { describe, expect, it } from 'vitest';
import { simulate, normalizeParams } from './engine';
import { Space } from './geometry';
import { makeRng } from './rng';
import { applyCosmicWeb, webNuclei } from './structure';
import type { Params } from './types';

type Case = { name: string; p: Partial<Params> };

const CASES: Case[] = [
  { name: 'flat 2d', p: { dim: 2, geometry: 'flat' } },
  { name: 'torus 2d', p: { dim: 2, geometry: 'torus' } },
  { name: 'sphere', p: { dim: 2, geometry: 'sphere' } },
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

/** Sorted distances from galaxy i to every nucleus (brute force). */
function nucleusDists(p: Params, pos: Float32Array, i: number, nuc: Float32Array): number[] {
  const out: number[] = [];
  for (let j = 0; j < nuc.length / 3; j++) out.push(Math.sqrt(d2(p, pos, i, nuc, j)));
  return out.sort((x, y) => x - y);
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

describe('cosmic web (criterion 30)', () => {
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
      const a = simulate({ ...p, clumpiness: 0.7, seed: 'w1' });
      const b = simulate({ ...p, clumpiness: 0.7, seed: 'w1' });
      const c = simulate({ ...p, clumpiness: 0.7, seed: 'w2' });
      expect(b.positions).toEqual(a.positions);
      expect(c.positions).not.toEqual(a.positions);
      expect(webNuclei(a.params)).toEqual(webNuclei(b.params));
    }
  });

  it('keeps every galaxy in the domain: clamped box, wrapped torus, on the sphere, z = 0 in 2d', () => {
    for (const { name, p: base } of CASES) {
      for (const clumpiness of [0.3, 0.7, 1]) {
        const r = simulate({ ...base, clumpiness, seed: 'dom' });
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
              if (p.geometry === 'torus') expect(v).toBeLessThan(p.sizeGly);
              else expect(v).toBeLessThanOrEqual(p.sizeGly);
            }
            if (p.dim === 2) expect(z).toBe(0);
          }
        }
      }
    }
  });

  it('places nuclei with mean spacing webScaleGly', () => {
    const p2 = normalizeParams({ sizeGly: 93, webScaleGly: 12 });
    expect(webNuclei(p2).length / 3).toBe(Math.round((93 / 12) ** 2));
    const p3 = normalizeParams({ dim: 3, sizeGly: 60, webScaleGly: 15, galaxies: 8000 });
    expect(webNuclei(p3).length / 3).toBe(Math.round((60 / 15) ** 3));
    const ps = normalizeParams({ geometry: 'sphere', sizeGly: 93, webScaleGly: 12 });
    const R = 93 / (2 * Math.PI);
    expect(webNuclei(ps).length / 3).toBe(Math.round((4 * Math.PI * R * R) / 144));
  });

  it('moves galaxies away from their nucleus towards walls/edges, then filaments/nodes, staying in their cell', () => {
    const report: Record<string, string> = {};
    for (const { name, p: base } of CASES) {
      const gap: number[] = [];
      const gap3: number[] = [];
      for (const clumpiness of [0, 0.5, 1]) {
        const p = normalizeParams({ ...base, clumpiness, seed: 'walls' });
        const u = uniform(p);
        const pos = uniform(p);
        applyCosmicWeb(pos, p);
        const nuc = webNuclei(p);
        let sumGap = 0, sumGap3 = 0, sameCell = 0;
        const m = 1500;
        for (let i = 0; i < m; i++) {
          const before = nucleusDists(p, u, i, nuc);
          const after = nucleusDists(p, pos, i, nuc);
          // relative distance to the nearest wall (d2 − d1) and filament/node (d3 − d1)
          sumGap += (after[1] - after[0]) / p.webScaleGly;
          sumGap3 += (after[2] - after[0]) / p.webScaleGly;
          // nearest nucleus unchanged
          let nb = 0, na = 0;
          for (let j = 1; j < nuc.length / 3; j++) {
            if (d2(p, u, i, nuc, j) < d2(p, u, i, nuc, nb)) nb = j;
            if (d2(p, pos, i, nuc, j) < d2(p, pos, i, nuc, na)) na = j;
          }
          if (nb === na || Math.abs(after[1] - after[0]) < 1e-3) sameCell++;
          void before;
        }
        gap.push(sumGap / m);
        gap3.push(sumGap3 / m);
        expect(sameCell / m, name).toBeGreaterThanOrEqual(0.99);
      }
      report[name] = `wall gap ${gap.map((g) => g.toFixed(4)).join(' > ')}; node/filament gap ${gap3
        .map((g) => g.toFixed(4))
        .join(' > ')}`;
      expect(gap[1]).toBeLessThan(gap[0]);
      expect(gap[2]).toBeLessThan(gap[1]);
      expect(gap3[1]).toBeLessThan(gap3[0]);
      expect(gap3[2]).toBeLessThan(gap3[1]);
    }
    console.log('mean (d2 − d1)/webScale and (d3 − d1)/webScale at clumpiness 0, 0.5, 1:', JSON.stringify(report, null, 1));
  });

  it('clustering is stronger than uniform and rises with clumpiness (count-in-cells VMR, nearest-neighbour distance)', () => {
    const report: Record<string, { vmr: string; meanNN: string }> = {};
    for (const { name, p: base } of CASES) {
      const vmr: number[] = [];
      const nn: number[] = [];
      for (const clumpiness of [0, 0.5, 1]) {
        const r = simulate({ ...base, clumpiness, seed: 'clu', pLife: 1e-30 });
        vmr.push(countInCellsVMR(r.params, r.positions));
        nn.push(meanNN(r.params, r.positions));
      }
      report[name] = {
        vmr: vmr.map((v) => v.toFixed(3)).join(' < '),
        meanNN: nn.map((v) => v.toFixed(4)).join(' > '),
      };
      expect(vmr[1]).toBeGreaterThan(vmr[0]);
      expect(vmr[2]).toBeGreaterThan(vmr[1]);
      expect(nn[1]).toBeLessThan(nn[0]);
      expect(nn[2]).toBeLessThan(nn[1]);
    }
    console.log('clustering at clumpiness 0, 0.5, 1:', JSON.stringify(report, null, 1));
  });
});
