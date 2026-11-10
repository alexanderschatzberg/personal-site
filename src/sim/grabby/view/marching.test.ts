import { describe, expect, it } from 'vitest';
import { cubeTriangles, extract, Mesh } from './marching';
import { fullField, type Field } from './shellfield';

/** A full (whole-grid) field filled from f(i, j, k). */
function fieldOf(G: number, periodic: boolean, f: (i: number, j: number, k: number) => number): Field {
  const fld = fullField(G, periodic);
  for (let k = 0; k < G; k++) for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) fld.data[(k * G + j) * G + i] = f(i, j, k);
  return fld;
}

/** Undirected triangle edges (vertices keyed by their exact coordinates) → how many triangles use each. */
function edgeUse(pos: Float32Array): Map<string, number> {
  const key = (v: number) => `${pos[3 * v]},${pos[3 * v + 1]},${pos[3 * v + 2]}`;
  const use = new Map<string, number>();
  for (let t = 0; t < pos.length / 9; t++)
    for (let e = 0; e < 3; e++) {
      const a = key(3 * t + e), b = key(3 * t + ((e + 1) % 3));
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      use.set(k, (use.get(k) ?? 0) + 1);
    }
  return use;
}

function area(pos: Float32Array): number {
  let s = 0;
  for (let t = 0; t < pos.length / 9; t++) {
    const o = 9 * t;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return s;
}

describe('marching cubes table', () => {
  it('empty and full cubes make no triangles; every triangle vertex lies on a cut edge', () => {
    expect(cubeTriangles(0)).toEqual([]);
    expect(cubeTriangles(255)).toEqual([]);
    const ends = [
      [0, 1], [2, 3], [4, 5], [6, 7],
      [0, 2], [1, 3], [4, 6], [5, 7],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (let c = 1; c < 255; c++) {
      const tris = cubeTriangles(c);
      expect(tris.length % 3).toBe(0);
      expect(tris.length).toBeGreaterThan(0);
      for (const e of tris) {
        const [a, b] = ends[e];
        expect(((c >> a) & 1) !== ((c >> b) & 1)).toBe(true);
      }
    }
  });
});

describe('marching cubes on an analytic sphere (criterion 54)', () => {
  const G = 40, h = 0.5, r = 6, rho = 9;
  const c = [9.65, 10.05, 9.85]; // off the lattice so vertices are not degenerate
  // Field zero at the borders: 1 − d/ρ clamped at 0 reaches 0 at d = ρ = 18 cells, inside the grid.
  const fld = fieldOf(G, false, (i, j, k) => Math.max(0, 1 - Math.hypot(i * h - c[0], j * h - c[1], k * h - c[2]) / rho));
  const iso = 1 - r / rho;
  const mesh = new Mesh();
  extract(fld, iso, h, 0, mesh);
  const { positions: pos, normals: nrm } = mesh.take();

  it('is watertight: every edge is shared by exactly two triangles', () => {
    expect(pos.length).toBeGreaterThan(0);
    const use = edgeUse(pos);
    for (const n of use.values()) expect(n).toBe(2);
  });

  it('has area within 5% of 4πr²', () => {
    const want = 4 * Math.PI * r * r;
    expect(Math.abs(area(pos) - want) / want).toBeLessThan(0.05);
  });

  it('puts vertices on the sphere and gives outward unit normals from the gradient', () => {
    for (let v = 0; v < pos.length / 3; v++) {
      const dx = pos[3 * v] - c[0], dy = pos[3 * v + 1] - c[1], dz = pos[3 * v + 2] - c[2];
      const d = Math.hypot(dx, dy, dz);
      expect(Math.abs(d - r)).toBeLessThan(h);
      const n = [nrm[3 * v], nrm[3 * v + 1], nrm[3 * v + 2]];
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 4);
      expect((n[0] * dx + n[1] * dy + n[2] * dz) / d).toBeGreaterThan(0.95);
    }
  });
});

describe('marching cubes on the periodic grid (3-torus)', () => {
  const G = 24, h = 1, L = G * h, r = 5;
  const wrap = (d: number) => d - L * Math.round(d / L);
  // A blob centred just inside the corner (0, 0, 0): it crosses all six faces of the cube.
  const c = [0.4, 0.7, 0.3];
  const fld = fieldOf(G, true, (i, j, k) => Math.max(0, 1 - Math.hypot(wrap(i - c[0]), wrap(j - c[1]), wrap(k - c[2])) / 9));
  const mesh = new Mesh();
  extract(fld, 1 - r / 9, h, 0, mesh);
  const { positions: pos } = mesh.take();

  it('keeps every vertex inside the cube [0, L]³ (cut at the faces)', () => {
    expect(pos.length).toBeGreaterThan(0);
    for (const x of pos) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(L);
    }
  });

  it('a blob at a corner produces surface on every face it crosses (both sides of each)', () => {
    for (let a = 0; a < 3; a++)
      for (const face of [0, L]) {
        let near = 0;
        for (let v = 0; v < pos.length / 3; v++) if (Math.abs(pos[3 * v + a] - face) <= h) near++;
        expect(near, `axis ${a} face ${face}`).toBeGreaterThan(0);
      }
  });

  it('is closed except where it is cut: every open edge lies on a cube face', () => {
    const use = edgeUse(pos);
    let open = 0;
    for (const [k, n] of use) {
      expect(n).toBeLessThanOrEqual(2);
      if (n === 2) continue;
      open++;
      const [p, q] = k.split('|').map((s) => s.split(',').map(Number));
      const onFace = [0, 1, 2].some((a) => (p[a] === 0 && q[a] === 0) || (p[a] === L && q[a] === L));
      expect(onFace, k).toBe(true);
    }
    expect(open).toBeGreaterThan(0);
  });

  it('matches the same blob away from the faces in area (cutting loses nothing)', () => {
    const inner = fieldOf(G, true, (i, j, k) => Math.max(0, 1 - Math.hypot(wrap(i - c[0] - 12), wrap(j - c[1] - 12), wrap(k - c[2] - 12)) / 9));
    const m2 = new Mesh();
    extract(inner, 1 - r / 9, h, 0, m2);
    const a1 = area(pos), a2 = area(m2.take().positions);
    expect(Math.abs(a1 - a2) / a2).toBeLessThan(0.01);
  });
});
