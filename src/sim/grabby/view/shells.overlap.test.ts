// Round 7 review, finding 1: neighbouring territories share one wall instead of interpenetrating.
// Measured on the 3d default run at tLast (where territories touch), two ways:
//  - geometric, flat only: ray parity against the output meshes themselves (each flat shell is a
//    closed surface), so it knows nothing about how the builder works;
//  - field, flat and torus: the builder's `inspect` hook hands over the very field and level each
//    shell is extracted from; inside = field > level (cut torus meshes aren't closed, so ray parity
//    can't be used there).
// Two metrics each: sample points (one per grid cell) inside two or more shells, as a share of
// points inside at least one; owned galaxies inside another civ's shell, as a share of owned.
import { describe, expect, it } from 'vitest';
import { simulate } from '../engine';
import { createTimeline } from '../timeline';
import { DEFAULT_GALAXIES_3D, type Geometry } from '../types';
import { gridSpec, gridSize, type Field } from './shellfield';
import { ShellBuilder, type CivShell } from './shells';

/**
 * Independent shells (before the fix): flat 13 % doubly covered / 20 % foreign galaxies, torus
 * 8 % / 12 %. Shared walls: the insides are disjoint on the grid, so doubly covered sample points
 * can only come from marching cubes' in-cell interpolation: measured 0, allowed 0.1 %. A foreign
 * galaxy is one sitting where a neighbour's blurred density beats its own civ's, i.e. within the
 * blur's reach of a contact front, so the smooth wall passes just behind it: measured ≈ 0.5 %
 * (every one within MAX_FOREIGN_DEPTH cells of the wall), allowed 1 %.
 */
const MAX_DOUBLE = 0.001;
const MAX_FOREIGN = 0.01;
const MAX_FOREIGN_DEPTH = 2;

const runs = new Map<Geometry, ReturnType<typeof setup>>();
function setup(geometry: Geometry) {
  const r = simulate({ dim: 3, geometry, galaxies: DEFAULT_GALAXIES_3D });
  const tl = createTimeline(r);
  tl.seek(r.tLast);
  const L = r.params.sizeGly, G = gridSize(DEFAULT_GALAXIES_3D), periodic = geometry === 'torus';
  const fields: { civ: number; f: Field; level: number }[] = [];
  const b = new ShellBuilder(r.positions, { L, G, periodic });
  const shells = b.build(tl.owner, r.civs.length, (civ, f, level) => fields.push({ civ, f: { ...f, data: f.data.slice() }, level }));
  return { r, owner: tl.owner.slice(), L, G, periodic, shells, fields, ...gridSpec(L, G, periodic) };
}
const run = (g: Geometry) => runs.get(g) ?? (runs.set(g, setup(g)), runs.get(g)!);

/** Field value at grid coordinate u (trilinear; 0 outside the window). */
function sample(f: Field, u: number[]): number {
  const { G, periodic, data } = f;
  const i0 = u.map(Math.floor), t = u.map((x, a) => x - i0[a]);
  let s = 0;
  for (let c = 0; c < 8; c++) {
    const loc: number[] = [];
    let w = 1;
    for (let a = 0; a < 3; a++) {
      const bit = (c >> a) & 1;
      w *= bit ? t[a] : 1 - t[a];
      const g = i0[a] + bit;
      const ax = f.ax[a];
      const d = periodic ? (((g - ax.o) % G) + G) % G : g - ax.o;
      loc.push(d >= 0 && d < ax.m ? d : -1);
    }
    if (w === 0 || loc.some((x) => x < 0)) continue;
    s += w * data[(loc[2] * f.ax[1].m + loc[1]) * f.ax[0].m + loc[0]];
  }
  return s;
}

/** Point-in-closed-mesh by +x ray parity, triangles bucketed by (y, z) cell. */
class Solid {
  private bins = new Map<number, number[]>();
  constructor(private pos: Float32Array, private cell: number) {
    for (let t = 0; t < pos.length / 9; t++) {
      let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let v = 0; v < 3; v++) {
        const y = pos[9 * t + 3 * v + 1], z = pos[9 * t + 3 * v + 2];
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j++)
        for (let k = Math.floor(z0 / cell); k <= Math.floor(z1 / cell); k++) {
          const key = j * 100003 + k;
          const list = this.bins.get(key);
          if (list) list.push(t);
          else this.bins.set(key, [t]);
        }
    }
  }
  contains(x: number, y: number, z: number): boolean {
    const list = this.bins.get(Math.floor(y / this.cell) * 100003 + Math.floor(z / this.cell));
    if (!list) return false;
    const p = this.pos;
    let n = 0;
    for (const t of list) {
      const ay = p[9 * t + 1], az = p[9 * t + 2], by = p[9 * t + 4], bz = p[9 * t + 5], cy = p[9 * t + 7], cz = p[9 * t + 8];
      const area = (by - ay) * (cz - az) - (cy - ay) * (bz - az);
      if (area === 0) continue;
      const w0 = ((by - y) * (cz - z) - (cy - y) * (bz - z)) / area;
      const w1 = ((cy - y) * (az - z) - (ay - y) * (cz - z)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      if (w0 * p[9 * t] + w1 * p[9 * t + 3] + w2 * p[9 * t + 6] > x) n++;
    }
    return (n & 1) === 1;
  }
}

/** Sample points: one per grid cell, off the lattice so no ray grazes a vertex. */
function lattice(L: number, G: number, h: number, margin: number, periodic: boolean, each: (x: number, y: number, z: number) => void) {
  const off = [0.3183, 0.4472, 0.1732];
  const m = periodic ? G : G - 1;
  for (let k = 0; k < m; k++)
    for (let j = 0; j < m; j++)
      for (let i = 0; i < m; i++) {
        const p = [i, j, k].map((g, a) => (g + off[a] - margin) * h);
        if (p.every((x) => x >= -2 * h && x <= L + 2 * h)) each(p[0], p[1], p[2]);
      }
}

function report(label: string, one: number, two: number, foreign: number, owned: number) {
  const d = two / Math.max(1, one), f = foreign / Math.max(1, owned);
  process.stdout.write(`[overlap] ${label}: ${two}/${one} sample points in ≥ 2 shells (${(100 * d).toFixed(2)} %); ${foreign}/${owned} owned galaxies inside another civ's shell (${(100 * f).toFixed(2)} %)\n`);
  return { d, f };
}

describe('neighbouring shells share one wall (round 7 review, finding 1)', () => {
  it(`flat, geometric (ray parity on the meshes): < ${100 * MAX_DOUBLE} % doubly covered, < ${100 * MAX_FOREIGN} % foreign galaxies`, () => {
    const { r, owner, L, G, h, margin, shells } = run('flat');
    const solids = shells.map((s: CivShell) => ({ civ: s.civ, solid: new Solid(s.positions, h), box: bbox(s.positions) }));
    const inside = (x: number, y: number, z: number, skip = -1) => solids.filter((s) => s.civ !== skip && inBox(s.box, x, y, z) && s.solid.contains(x, y, z));
    let one = 0, two = 0;
    lattice(L, G, h, margin, false, (x, y, z) => {
      const c = inside(x, y, z).length;
      if (c >= 1) one++;
      if (c >= 2) two++;
    });
    let foreign = 0, owned = 0, deepest = 0;
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] < 0) continue;
      owned++;
      const x = r.positions[3 * i], y = r.positions[3 * i + 1], z = r.positions[3 * i + 2];
      const hit = inside(x, y, z, owner[i]);
      if (!hit.length) continue;
      foreign++;
      // How far inside the other shell: distance to its nearest vertex, in cells.
      const p = shells.find((s) => s.civ === hit[0].civ)!.positions;
      let best = Infinity;
      for (let v = 0; v < p.length; v += 3) best = Math.min(best, Math.hypot(p[v] - x, p[v + 1] - y, p[v + 2] - z));
      deepest = Math.max(deepest, best / h);
    }
    process.stdout.write(`[overlap] flat geometric: deepest foreign galaxy ${deepest.toFixed(2)} cells inside the other shell\n`);
    expect(deepest).toBeLessThan(MAX_FOREIGN_DEPTH);
    const { d, f } = report('flat geometric', one, two, foreign, owned);
    expect(one).toBeGreaterThan(1000);
    expect(d).toBeLessThan(MAX_DOUBLE);
    expect(f).toBeLessThan(MAX_FOREIGN);
  }, 300000);

  for (const geometry of ['flat', 'torus'] as Geometry[])
    it(`${geometry}, field (what each shell is extracted from): < ${100 * MAX_DOUBLE} % doubly covered, < ${100 * MAX_FOREIGN} % foreign galaxies`, () => {
      const { r, owner, L, G, h, margin, periodic, fields } = run(geometry);
      expect(fields.length).toBeGreaterThan(10);
      const toGrid = (x: number) => (periodic ? (((x % L) + L) % L) / h : x / h + margin);
      let one = 0, two = 0;
      lattice(L, G, h, margin, periodic, (x, y, z) => {
        const u = [toGrid(x), toGrid(y), toGrid(z)];
        let c = 0;
        for (const { f, level } of fields) if (sample(f, u) > level) c++;
        if (c >= 1) one++;
        if (c >= 2) two++;
      });
      let foreign = 0, owned = 0;
      for (let i = 0; i < owner.length; i++) {
        if (owner[i] < 0) continue;
        owned++;
        const u = [0, 1, 2].map((a) => toGrid(r.positions[3 * i + a]));
        if (fields.some(({ civ, f, level }) => civ !== owner[i] && sample(f, u) > level)) foreign++;
      }
      const { d, f } = report(`${geometry} field`, one, two, foreign, owned);
      expect(one).toBeGreaterThan(1000);
      expect(d).toBeLessThan(MAX_DOUBLE);
      expect(f).toBeLessThan(MAX_FOREIGN);
    }, 300000);
});

function bbox(p: Float32Array) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let a = 0; a < 3; a++) {
      b[a] = Math.min(b[a], p[i + a]);
      b[3 + a] = Math.max(b[3 + a], p[i + a]);
    }
  return b;
}
const inBox = (b: number[], x: number, y: number, z: number) => x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5];
