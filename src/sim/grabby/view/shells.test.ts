import { describe, expect, it } from 'vitest';
import { gaussianKernel, gridSpec, KERNEL_RADIUS, SIGMA_CELLS } from './shellfield';
import { choosePick, ISO_FRACTION, isoLevel, LatestWins, oneGalaxyLevel, pickShellHit, ShellBuilder, type CivShell, type ShellHit } from './shells';

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n random galaxies in [0, L)³; owner by octant (0..3 for x/y halves, z ignored), a few unclaimed. */
function fixture(n: number, L: number, seed: number) {
  const rand = rng(seed);
  const positions = Float32Array.from({ length: 3 * n }, () => rand() * L);
  const owner = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1];
    owner[i] = rand() < 0.1 ? -1 : (x < L / 2 ? 0 : 1) + (y < L / 2 ? 0 : 2);
  }
  return { positions, owner };
}

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

const tris = (s: CivShell[]) => s.map((c) => [c.civ, c.positions.length / 9]);

describe('iso level', () => {
  it('is a fixed fraction of the mean blurred peak density of one galaxy', () => {
    const k = gaussianKernel(SIGMA_CELLS, KERNEL_RADIUS);
    const one = oneGalaxyLevel(k);
    // Between a galaxy at a cell corner (all mass on one point: k0³) and one at a cell centre (mass split 8 ways).
    const k0 = k[KERNEL_RADIUS], half = (k[KERNEL_RADIUS] + k[KERNEL_RADIUS + 1]) / 2;
    expect(one).toBeLessThan(k0 ** 3);
    expect(one).toBeGreaterThan(half ** 3);
    expect(ISO_FRACTION).toBeGreaterThan(0);
    expect(ISO_FRACTION).toBeLessThan(1);
    expect(isoLevel()).toBeCloseTo(ISO_FRACTION * one, 12);
  });

  it('a lone galaxy gets a small closed shell around it', () => {
    const L = 48;
    const b = new ShellBuilder(Float32Array.from([20.3, 21.7, 19.1]), { L, G: 48, periodic: false });
    const [s] = b.build(Int32Array.from([0]), 1);
    expect(s.civ).toBe(0);
    expect(s.positions.length).toBeGreaterThan(0);
    for (const n of edgeUse(s.positions).values()) expect(n).toBe(2);
    for (let v = 0; v < s.positions.length / 3; v++) {
      const d = Math.hypot(s.positions[3 * v] - 20.3, s.positions[3 * v + 1] - 21.7, s.positions[3 * v + 2] - 19.1);
      expect(d).toBeLessThan(3 * (L / 48));
    }
  });
});

describe('shell builder', () => {
  const L = 100;
  const { positions, owner } = fixture(6000, L, 11);

  it('a deterministic fixture: the same owner snapshot gives identical triangle counts (criterion 54)', () => {
    const a = new ShellBuilder(positions, { L, G: 32, periodic: false }).build(owner, 4);
    const b1 = new ShellBuilder(positions, { L, G: 32, periodic: false });
    b1.build(Int32Array.from(owner, (o) => (o + 1) % 4), 4); // a different snapshot in between
    const b = b1.build(owner, 4);
    expect(tris(a)).toEqual(tris(b));
    expect(a.length).toBe(4);
    for (const [, n] of tris(a)) expect(n).toBeGreaterThan(0);
    for (let i = 0; i < a.length; i++) expect(Array.from(b[i].positions)).toEqual(Array.from(a[i].positions));
  });

  it('flat: every civ shell is watertight and hugs its galaxies', () => {
    const shells = new ShellBuilder(positions, { L, G: 32, periodic: false }).build(owner, 4);
    const h = gridSpec(L, 32, false).h;
    for (const s of shells) {
      for (const n of edgeUse(s.positions).values()) expect(n).toBe(2);
      // Every shell vertex is within a few cells of one of the civ's galaxies.
      const own: number[] = [];
      for (let i = 0; i < owner.length; i++) if (owner[i] === s.civ) own.push(i);
      for (let v = 0; v < s.positions.length / 3; v += 7) {
        let best = Infinity;
        for (const i of own) best = Math.min(best, Math.hypot(positions[3 * i] - s.positions[3 * v], positions[3 * i + 1] - s.positions[3 * v + 1], positions[3 * i + 2] - s.positions[3 * v + 2]));
        // A dense edge's shell sits ≈ 2σ ≈ 2.7 cells outside it (see ISO_FRACTION).
        expect(best).toBeLessThan(4 * h);
      }
      // Centroid: the mean vertex, for back-to-front sorting.
      const c = [0, 0, 0];
      for (let v = 0; v < s.positions.length / 3; v++) for (let a = 0; a < 3; a++) c[a] += s.positions[3 * v + a] / (s.positions.length / 3);
      for (let a = 0; a < 3; a++) expect(s.centroid[a]).toBeCloseTo(c[a], 2);
    }
  });

  it('skips civs that hold nothing and unclaimed galaxies', () => {
    const one = Int32Array.from(owner, (o) => (o === 2 ? 2 : -1));
    const shells = new ShellBuilder(positions, { L, G: 32, periodic: false }).build(one, 7);
    expect(shells.map((s) => s.civ)).toEqual([2]);
    expect(new ShellBuilder(positions, { L, G: 32, periodic: false }).build(new Int32Array(owner.length).fill(-1), 4)).toEqual([]);
  });

  it('torus: a territory across a face shows on both sides, inside the cube', () => {
    // Civ 0 owns the galaxies within 15 of the x = 0 face (on either side), nothing else.
    const across = Int32Array.from({ length: owner.length }, (_, i) => (positions[3 * i] < 15 || positions[3 * i] > L - 15 ? 0 : -1));
    const [s] = new ShellBuilder(positions, { L, G: 32, periodic: true }).build(across, 1);
    let lo = 0, hi = 0;
    for (let v = 0; v < s.positions.length / 3; v++) {
      const x = s.positions[3 * v];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(L);
      if (x < L / 4) lo++;
      if (x > (3 * L) / 4) hi++;
    }
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(0);
  });
});

describe('galaxy or shell: which a tap opens (round 7 review, finding 2)', () => {
  // Civ 0 owns galaxies 0 (x = 10) and 1 (x = 20); civ 1 owns 2 (x = 60) and 3 (x = 70); 4 is unclaimed.
  const positions = Float32Array.from([10, 50, 50, 20, 50, 50, 60, 50, 50, 70, 50, 50, 61, 50, 50]);
  const owner = Int32Array.from([0, 0, 1, 1, -1]);
  const L = 100;
  const hit = (civ: number, depth: number, x: number): ShellHit => ({ distance: depth, depth, civ, point: [x, 50, 50] });
  const pick = (g: number, gDepth: number, hits: ShellHit[], own = owner) => choosePick(g, gDepth, hits, positions, own, L, false);

  it('a galaxy in front of every other civ shell wins over the shells behind it', () => {
    // Tapped civ-1 galaxy 2 at depth 3; civ 0's shell is hit behind it (depth 5, 8).
    expect(pick(2, 3, [hit(0, 8, 12), hit(0, 5, 19)])).toBe(2);
  });

  it("a galaxy behind another civ's shell loses to the front-most shell hit (that civ, galaxy nearest the hit)", () => {
    // Civ-1 galaxy 2 at depth 5, seen through civ 0's shell hit at depth 2 (point x = 19 → galaxy 1).
    expect(pick(2, 5, [hit(1, 4, 58), hit(0, 2, 19)])).toBe(1);
  });

  it("its own civ's shell in front never hides a galaxy (every galaxy sits inside its own shell)", () => {
    expect(pick(2, 5, [hit(1, 2, 75), hit(1, 9, 50)])).toBe(2);
    // ... but another civ's shell in front of that still does.
    expect(pick(2, 5, [hit(1, 3, 75), hit(0, 1, 11)])).toBe(0);
  });

  it('a shell hit level with the galaxy (within a small depth epsilon) does not hide it', () => {
    expect(pick(2, 5, [hit(0, 5 * (1 - 1e-5), 19)])).toBe(2);
    expect(pick(2, 5, [hit(0, 4.9, 19)])).toBe(1);
  });

  it('no galaxy in range → the front-most shell hit; no shell hit → the galaxy; neither → -1', () => {
    expect(pick(-1, NaN, [hit(1, 4, 68), hit(0, 2, 19)])).toBe(1);
    expect(pick(3, 7, [])).toBe(3);
    expect(pick(-1, NaN, [])).toBe(-1);
  });

  it('a hiding shell whose civ holds nothing any more falls back to the galaxy', () => {
    const gone = Int32Array.from([-1, -1, 1, 1, -1]);
    expect(pick(2, 5, [hit(0, 2, 19)], gone)).toBe(2);
  });
});

describe('shared walls (round 7 review, finding 1)', () => {
  // Two dense blobs, civ 0 round (30, 50, 50) and civ 1 round (52, 50, 50): close enough that
  // their independent shells would overlap by several cells.
  const L = 100, G = 48;
  const rand = rng(5);
  const pts: number[] = [], own: number[] = [];
  for (const [c, cx] of [[0, 30], [1, 52]])
    for (let i = 0; i < 1500; i++) {
      // Uniform in a ball of radius 12.
      let x, y, z;
      do [x, y, z] = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1];
      while (x * x + y * y + z * z > 1);
      pts.push(cx + 12 * x, 50 + 12 * y, 50 + 12 * z);
      own.push(c);
    }
  const positions = Float32Array.from(pts), owner = Int32Array.from(own);

  for (const periodic of [false, true])
    it(`${periodic ? 'torus' : 'flat'}: the two shells meet in one wall (identical vertices, opposite normals), both stay watertight`, () => {
      const [a, b] = new ShellBuilder(positions, { L, G, periodic }).build(owner, 2);
      expect([a.civ, b.civ]).toEqual([0, 1]);
      for (const s of [a, b]) for (const n of edgeUse(s.positions).values()) expect(n).toBe(2);
      const key = (p: Float32Array, v: number) => `${p[3 * v]},${p[3 * v + 1]},${p[3 * v + 2]}`;
      const inA = new Map<string, number>();
      for (let v = 0; v < a.positions.length / 3; v++) inA.set(key(a.positions, v), v);
      let shared = 0, opposite = 0;
      const xs: number[] = [];
      for (let v = 0; v < b.positions.length / 3; v++) {
        const w = inA.get(key(b.positions, v));
        if (w === undefined) continue;
        shared++;
        xs.push(b.positions[3 * v]);
        const dot = a.normals[3 * w] * b.normals[3 * v] + a.normals[3 * w + 1] * b.normals[3 * v + 1] + a.normals[3 * w + 2] * b.normals[3 * v + 2];
        if (dot < -0.9) opposite++;
      }
      // The wall is a disc round x ≈ 41 (half way), a good part of each shell, and nothing of
      // either shell pokes through it into the other's side.
      expect(shared).toBeGreaterThan(0.05 * (b.positions.length / 3));
      expect(opposite).toBeGreaterThan(0.95 * shared);
      for (const x of xs) expect(Math.abs(x - 41)).toBeLessThan(3);
      let aPast = 0, bPast = 0;
      for (let v = 0; v < a.positions.length / 3; v++) if (a.positions[3 * v] > 41 + 3) aPast++;
      for (let v = 0; v < b.positions.length / 3; v++) if (b.positions[3 * v] < 41 - 3) bPast++;
      expect(aPast).toBe(0);
      expect(bPast).toBe(0);
    });
});

describe('latest-wins job queue (criterion 50)', () => {
  it('sends at once when idle, keeps only the newest while busy, and drops stale snapshots', () => {
    const q = new LatestWins<string>();
    expect(q.submit('a')).toBe('a');
    expect(q.submit('b')).toBeUndefined();
    expect(q.submit('c')).toBeUndefined();
    expect(q.dropped).toBe(1); // b never ran
    expect(q.finish()).toBe('c'); // a done → c goes out
    expect(q.submit('d')).toBeUndefined();
    expect(q.finish()).toBe('d');
    expect(q.finish()).toBeUndefined(); // d done, nothing pending → idle
    expect(q.submit('e')).toBe('e');
    q.reset();
    expect(q.submit('f')).toBe('f');
  });
});

describe('shell pick (criterion 52)', () => {
  // Galaxies: 0, 1 owned by civ 0 at x = 10, 20; 2, 3 owned by civ 1 at x = 60, 70; 4 unclaimed at x = 61.
  const positions = Float32Array.from([10, 50, 50, 20, 50, 50, 60, 50, 50, 70, 50, 50, 61, 50, 50]);
  const owner = Int32Array.from([0, 0, 1, 1, -1]);
  const L = 100;

  it('prefers the front-most shell hit, whatever order the hits come in', () => {
    const hits = [
      { distance: 9, depth: 9, civ: 0, point: [19, 50, 50] },
      { distance: 4, depth: 4, civ: 1, point: [62, 50, 50] },
    ];
    expect(pickShellHit(hits, positions, owner, L, false)).toBe(2); // civ 1, nearest owned to 62 (not the unclaimed 61)
    expect(pickShellHit([hits[1], hits[0]], positions, owner, L, false)).toBe(2);
    expect(pickShellHit([{ ...hits[0], distance: 1 }, hits[1]], positions, owner, L, false)).toBe(1);
  });

  it('skips a hit whose civ no longer holds anything; no hit → -1', () => {
    const gone = Int32Array.from([0, 0, -1, -1, -1]);
    expect(pickShellHit([{ distance: 1, depth: 1, civ: 1, point: [62, 50, 50] }, { distance: 3, depth: 3, civ: 0, point: [12, 50, 50] }], positions, gone, L, false)).toBe(0);
    expect(pickShellHit([], positions, owner, L, false)).toBe(-1);
    expect(pickShellHit([{ distance: 1, depth: 1, civ: 1, point: [62, 50, 50] }], positions, gone, L, false)).toBe(-1);
  });

  it('torus: nearest by the wrapped distance', () => {
    // Hit at x = 99 on civ 0: galaxy 0 (x = 10) is 11 away across the face, galaxy 1 (x = 20) 21.
    expect(pickShellHit([{ distance: 1, depth: 1, civ: 0, point: [99, 50, 50] }], positions, owner, L, true)).toBe(0);
    // Hit at x = 95 on civ 1: 70 is 25 away, 60 is 35 away; flat or wrapped.
    expect(pickShellHit([{ distance: 1, depth: 1, civ: 1, point: [95, 50, 50] }], positions, owner, L, true)).toBe(3);
  });
});
