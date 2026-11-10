import { describe, expect, it } from 'vitest';
import { PICK_RADIUS_PX, pickOwned, pickOwnedNear, projectForPick, ScreenGrid, torusVisible } from './pick';
import { donutRadii, embedPositions } from './donut';

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('screen-space pick grid', () => {
  it('near() lists, in ascending order, every visible point within the radius (and skips NaN)', () => {
    const rand = rng(1);
    const n = 4000;
    const xy = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
      const hidden = rand() < 0.1;
      xy[2 * i] = hidden ? NaN : 1000 * rand();
      xy[2 * i + 1] = hidden ? NaN : 600 * rand();
    }
    const grid = new ScreenGrid(xy);
    for (let k = 0; k < 200; k++) {
      const x = 1100 * rand() - 50, y = 700 * rand() - 50;
      const got = Array.from(grid.near(x, y, PICK_RADIUS_PX));
      for (let j = 1; j < got.length; j++) expect(got[j]).toBeGreaterThan(got[j - 1]);
      for (const i of got) expect(Number.isFinite(xy[2 * i])).toBe(true);
      const set = new Set(got);
      for (let i = 0; i < n; i++)
        if (Math.hypot(xy[2 * i] - x, xy[2 * i + 1] - y) <= PICK_RADIUS_PX) expect(set.has(i)).toBe(true);
    }
  });

  it('handles nothing visible and a single point', () => {
    expect(Array.from(new ScreenGrid(new Float32Array([NaN, NaN])).near(0, 0, 24))).toEqual([]);
    expect(Array.from(new ScreenGrid(new Float32Array(0)).near(0, 0, 24))).toEqual([]);
    const one = new ScreenGrid(new Float32Array([5, 5]));
    expect(Array.from(one.near(10, 10, 24))).toEqual([0]);
    expect(Array.from(one.near(500, 500, 24))).toEqual([]);
  });

  for (const withDepth of [false, true]) {
    it(`pickOwnedNear equals the brute-force pickOwned (${withDepth ? '3d, depth ties' : '2d'})`, () => {
      const rand = rng(withDepth ? 7 : 3);
      const n = 6000;
      const xy = new Float32Array(2 * n), depth = new Float32Array(n), owner = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        const hidden = rand() < 0.05;
        // clustered so many points share a tap's neighbourhood
        const cx = 100 + 200 * Math.floor(rand() * 4), cy = 100 + 200 * Math.floor(rand() * 3);
        xy[2 * i] = hidden ? NaN : cx + 60 * (rand() - 0.5);
        xy[2 * i + 1] = hidden ? NaN : cy + 60 * (rand() - 0.5);
        depth[i] = Math.round(rand() * 20) / 20; // coarse: plenty of exact ties
        owner[i] = rand() < 0.3 ? -1 : Math.floor(rand() * 5);
      }
      const grid = new ScreenGrid(xy);
      const d = withDepth ? depth : null;
      let hits = 0;
      for (let k = 0; k < 2000; k++) {
        const x = 900 * rand(), y = 700 * rand();
        const brute = pickOwned(xy, d, owner, x, y, PICK_RADIUS_PX);
        expect(pickOwnedNear(grid, xy, d, owner, x, y, PICK_RADIUS_PX)).toBe(brute);
        if (brute >= 0) hits++;
      }
      expect(hits).toBeGreaterThan(200);
    });
  }

  it('a lazy visibility test equals hiding those points up front', () => {
    const rand = rng(11);
    const n = 3000;
    const xy = new Float32Array(2 * n), depth = new Float32Array(n), owner = new Int32Array(n);
    const hidden = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      xy[2 * i] = 300 * rand();
      xy[2 * i + 1] = 300 * rand();
      depth[i] = rand();
      owner[i] = rand() < 0.2 ? -1 : 1;
      hidden[i] = rand() < 0.3 ? 1 : 0;
    }
    const masked = xy.slice();
    for (let i = 0; i < n; i++) if (hidden[i]) masked[2 * i] = masked[2 * i + 1] = NaN;
    const grid = new ScreenGrid(xy);
    let asked = 0;
    const visible = (i: number) => (asked++, !hidden[i]);
    for (let k = 0; k < 500; k++) {
      const x = 300 * rand(), y = 300 * rand();
      expect(pickOwnedNear(grid, xy, depth, owner, x, y, PICK_RADIUS_PX, visible)).toBe(pickOwned(masked, depth, owner, x, y, PICK_RADIUS_PX));
    }
    expect(asked / 500).toBeLessThan(n / 4); // only nearby candidates are tested, not every point
  });

  it('donut: projecting without the torus and testing it lazily picks the same as projecting with it', () => {
    const L = 93;
    const { R, r } = donutRadii(L);
    const tilt = -1.4, fov = 40, k = 0.37, T = [3, -2, 5];
    const c = Math.cos(tilt), s = Math.sin(tilt);
    const D = ((R + r) * 1.3) / Math.tan(((fov / 2) * Math.PI) / 180);
    const model = [k, 0, 0, 0, 0, k * c, k * s, 0, 0, -k * s, k * c, 0, T[0], T[1], T[2], 1];
    const cam = [T[0], T[1], T[2] + k * D];
    const f = 1 / Math.tan(((fov / 2) * Math.PI) / 180), near = 0.001, far = 1e5;
    const A = -(far + near) / (far - near), B = (-2 * far * near) / (far - near);
    const viewProj = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, A, -1, -f * cam[0], -f * cam[1], -A * cam[2] + B, cam[2]];
    const rect = { left: 10, top: 20, width: 400, height: 400 };

    const rand = rng(5);
    const n = 3000;
    const flat = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      flat[3 * i] = L * rand();
      flat[3 * i + 1] = L * rand();
    }
    const { world, normals } = embedPositions(flat, L);
    const torus = { R, r: 0.985 * r };
    const xyA = new Float32Array(2 * n), dA = new Float32Array(n);
    projectForPick(world, { kind: 'normals', normals, torus }, model, viewProj, cam, rect, xyA, dA);
    const xyB = new Float32Array(2 * n), dB = new Float32Array(n);
    projectForPick(world, { kind: 'normals', normals }, model, viewProj, cam, rect, xyB, dB);
    const grid = new ScreenGrid(xyB);
    const visible = torusVisible(world, model, cam, torus);
    const owner = new Int32Array(n).map(() => (rand() < 0.2 ? -1 : 2));
    let hits = 0, hiddenByTorus = 0;
    for (let i = 0; i < n; i++) if (Number.isFinite(xyB[2 * i]) && !Number.isFinite(xyA[2 * i])) hiddenByTorus++;
    expect(hiddenByTorus).toBeGreaterThan(0); // the case under test happens
    for (let q = 0; q < 1500; q++) {
      // half the taps right on a (possibly hidden) galaxy, half anywhere
      const i = Math.floor(rand() * n);
      const onPoint = q % 2 === 0 && Number.isFinite(xyB[2 * i]);
      const x = onPoint ? xyB[2 * i] + 3 : rect.left + 400 * rand(), y = onPoint ? xyB[2 * i + 1] - 2 : rect.top + 400 * rand();
      const brute = pickOwned(xyA, dA, owner, x, y, PICK_RADIUS_PX);
      expect(pickOwnedNear(grid, xyB, dB, owner, x, y, PICK_RADIUS_PX, visible)).toBe(brute);
      if (brute >= 0) hits++;
    }
    expect(hits).toBeGreaterThan(300);
  });
});
