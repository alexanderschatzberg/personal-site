// Translucent territory shells for 3d (pure; the shell worker and the renderer use these). One
// smooth surface per civ around its galaxies: density field (shellfield.ts) → marching cubes
// (marching.ts). Plus the latest-wins job queue and the shell-hit pick.
import { extract, Mesh } from './marching';
import { buildField, type Field, gaussianKernel, gridSpec, KERNEL_RADIUS, SIGMA_CELLS } from './shellfield';

/**
 * Iso level as a fraction of oneGalaxyLevel(): below one lone galaxy's own peak, so a lone owned
 * galaxy still gets a small bubble, while round a dense territory (≈ 1 galaxy per cell) the shell
 * sits where the blurred edge has fallen to this level, ≈ 2σ (≈ 2.7 cells) outside it.
 */
export const ISO_FRACTION = 0.5;

export const KERNEL = gaussianKernel(SIGMA_CELLS, KERNEL_RADIUS);

/**
 * The mean blurred peak density of one galaxy (galaxies per grid point): the highest value its
 * cloud-in-cell splat reaches after the blur, averaged over where in its cell the galaxy sits.
 * The splat and the blur are separable, so this is the cube of the 1d mean.
 */
export function oneGalaxyLevel(k: Float32Array = KERNEL): number {
  const S = 256;
  let mean = 0;
  for (let s = 0; s < S; s++) {
    const f = (s + 0.5) / S;
    let best = 0;
    // Mass 1 − f at point 0 and f at point 1; blurred value at point i is (1 − f)k[i] + f·k[i − 1].
    for (let i = 0; i <= k.length; i++) best = Math.max(best, (1 - f) * (k[i] ?? 0) + f * (k[i - 1] ?? 0));
    mean += best / S;
  }
  return mean ** 3;
}

export function isoLevel(): number {
  return ISO_FRACTION * oneGalaxyLevel(KERNEL);
}

export interface ShellOptions {
  /** Box side, Gly. */
  L: number;
  /** Grid points per side (gridSize). */
  G: number;
  /** 3-torus: the field and the surface wrap. */
  periodic: boolean;
}

export interface CivShell {
  civ: number;
  /** Triangle soup in the galaxies' own (comoving) coordinates, 9 floats per triangle. */
  positions: Float32Array;
  normals: Float32Array;
  /** Mean vertex. */
  centroid: [number, number, number];
  /** Connected pieces of the surface (a torus shell cut by a face falls apart into several),
   *  each with its mean vertex and vertex count, largest first. Back-to-front sorting uses these
   *  (shellSortKey), not the overall mean, which for a cut shell lands between its pieces. */
  pieces: { centroid: [number, number, number]; weight: number }[];
}

/**
 * Sort key for drawing shells back to front: squared distance from `cam` (in the galaxies' own
 * coordinates) to the nearest piece's centroid. A shell with pieces on both sides of the cube is
 * drawn as near as its nearest piece, since that is the piece seen through the fewest other
 * shells, where a wrong order shows most; its far piece, behind most of them, gets the error.
 */
export function shellSortKey(s: Pick<CivShell, 'pieces' | 'centroid'>, cam: ArrayLike<number>): number {
  const list = s.pieces.length ? s.pieces : [{ centroid: s.centroid, weight: 1 }];
  let best = Infinity;
  for (const { centroid: c } of list) best = Math.min(best, (c[0] - cam[0]) ** 2 + (c[1] - cam[1]) ** 2 + (c[2] - cam[2]) ** 2);
  return best;
}

/**
 * Builds every civ's shell for an owner snapshot. Holds the positions (as grid coordinates) and scratch.
 *
 * Neighbours share one wall. Pass 1 builds each civ's windowed density f_c and folds it into
 * global G³ arrays: the largest value at each grid point, whose it is, and the second largest.
 * Pass 2 rewrites each civ's window as g_c = min(f_c − iso, f_c − other_c), where other_c is the
 * largest density of any other civ there, and extracts g_c = 0. So g_c > 0 exactly where c's
 * density is above the iso level and above every other civ's: the grid points of different civs'
 * insides are disjoint. Where two territories touch (both densities above iso) g_c = f_c − f_o
 * and g_o = f_o − f_c are exact negatives on the same grid values, so marching cubes puts both
 * shells' vertices on the very same floats, with opposite normals. Each shell is still the
 * closed, outward-facing surface of its own region, so the shared wall is drawn twice, once in
 * each civ's colour (see SHARED_WALL_DRAWN_TWICE).
 */
export class ShellBuilder {
  readonly h: number;
  readonly margin: number;
  readonly iso = isoLevel();
  private coords: Float64Array;
  private gather: Float64Array;
  /** Per civ: its window's data buffer, reused between builds. */
  private bufs: Float32Array[] = [];
  private top1: Float32Array;
  private top2: Float32Array;
  private arg: Int32Array;
  private mesh = new Mesh();
  private n: number;

  constructor(positions: Float32Array, readonly opts: ShellOptions) {
    const { L, G, periodic } = opts;
    const { h, margin } = gridSpec(L, G, periodic);
    this.h = h;
    this.margin = margin;
    this.n = Math.floor(positions.length / 3);
    this.coords = new Float64Array(3 * this.n);
    for (let i = 0; i < 3 * this.n; i++) {
      let x = positions[i];
      if (periodic) x = ((x % L) + L) % L;
      this.coords[i] = x / h + margin;
    }
    this.gather = new Float64Array(3 * this.n);
    this.top1 = new Float32Array(G * G * G);
    this.top2 = new Float32Array(G * G * G);
    this.arg = new Int32Array(G * G * G);
  }

  /** Vertex key → union-find slot (−1 = unseen), and the union-find parents. Scratch. */
  private slot = new Int32Array(0);
  private parent = new Int32Array(0);

  /** Connected pieces of a triangle soup whose vertices carry grid-edge keys (see extract). */
  private pieces(positions: Float32Array, keys: Int32Array): CivShell['pieces'] {
    const G1 = this.opts.G + 1;
    if (this.slot.length < 3 * G1 * G1 * G1) this.slot = new Int32Array(3 * G1 * G1 * G1).fill(-1);
    const nv = keys.length;
    if (this.parent.length < nv) this.parent = new Int32Array(nv);
    const { slot, parent } = this;
    // One union-find node per distinct key; id[v] is vertex v's node.
    const id = new Int32Array(nv);
    let nodes = 0;
    for (let v = 0; v < nv; v++) {
      let s = slot[keys[v]];
      if (s < 0) {
        s = slot[keys[v]] = nodes;
        parent[nodes] = nodes;
        nodes++;
      }
      id[v] = s;
    }
    const find = (x: number) => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]];
      return x;
    };
    for (let v = 0; v < nv; v += 3) {
      const a = find(id[v]);
      for (let e = 1; e < 3; e++) {
        const b = find(id[v + e]);
        if (a !== b) parent[b] = a;
      }
    }
    for (let v = 0; v < nv; v++) slot[keys[v]] = -1;
    const byRoot = new Map<number, { centroid: [number, number, number]; weight: number }>();
    for (let v = 0; v < nv; v++) {
      const r = find(id[v]);
      let p = byRoot.get(r);
      if (!p) byRoot.set(r, (p = { centroid: [0, 0, 0], weight: 0 }));
      for (let a = 0; a < 3; a++) p.centroid[a] += positions[3 * v + a];
      p.weight++;
    }
    const out = [...byRoot.values()];
    for (const p of out) for (let a = 0; a < 3; a++) p.centroid[a] /= p.weight;
    return out.sort((a, b) => b.weight - a.weight);
  }

  /**
   * One shell per civ in [0, civCount) that holds at least one galaxy, by civ id. `inspect`, if
   * given, sees each civ's field and level just before extraction (inside = field > level).
   */
  build(owner: Int32Array, civCount: number, inspect?: (civ: number, field: Field, level: number) => void): CivShell[] {
    const n = Math.min(this.n, owner.length);
    const start = new Int32Array(civCount + 1);
    for (let i = 0; i < n; i++) {
      const o = owner[i];
      if (o >= 0 && o < civCount) start[o + 1]++;
    }
    for (let c = 0; c < civCount; c++) start[c + 1] += start[c];
    const fill = start.slice(0, civCount);
    const g = this.gather, xyz = this.coords;
    for (let i = 0; i < n; i++) {
      const o = owner[i];
      if (o < 0 || o >= civCount) continue;
      const k = 3 * fill[o]++;
      g[k] = xyz[3 * i];
      g[k + 1] = xyz[3 * i + 1];
      g[k + 2] = xyz[3 * i + 2];
    }
    const { G, periodic } = this.opts;
    // Pass 1: every civ's field, folded into the global largest / its owner / second largest.
    const { top1, top2, arg } = this;
    top1.fill(0);
    top2.fill(0);
    arg.fill(-1);
    const fields: (Field | null)[] = [];
    for (let c = 0; c < civCount; c++) {
      const count = start[c + 1] - start[c];
      const f = count === 0 ? null : buildField(g.subarray(3 * start[c], 3 * start[c + 1]), count, G, periodic, KERNEL, this.bufs[c]);
      fields.push(f);
      if (!f) continue;
      if (!this.bufs[c] || this.bufs[c].length < f.data.length) this.bufs[c] = f.data;
      visit(f, (i, gi) => {
        const v = f.data[i];
        if (v > top1[gi]) {
          top2[gi] = top1[gi];
          top1[gi] = v;
          arg[gi] = c;
        } else if (v > top2[gi]) top2[gi] = v;
      });
    }
    // Pass 2: g_c = min(f_c − iso, f_c − other_c), extracted at 0.
    const out: CivShell[] = [];
    const iso = this.iso;
    for (let c = 0; c < civCount; c++) {
      const f = fields[c];
      if (!f) continue;
      const d = f.data;
      visit(f, (i, gi) => {
        const v = d[i];
        const other = arg[gi] === c ? top2[gi] : top1[gi];
        d[i] = Math.min(v - iso, v - other);
      });
      inspect?.(c, f, 0);
      extract(f, 0, this.h, this.margin, this.mesh);
      const keys = this.mesh.keys();
      const { positions, normals } = this.mesh.take();
      if (positions.length === 0) continue;
      const centroid: [number, number, number] = [0, 0, 0];
      for (let v = 0; v < positions.length; v += 3) for (let a = 0; a < 3; a++) centroid[a] += positions[v + a];
      for (let a = 0; a < 3; a++) centroid[a] /= positions.length / 3;
      out.push({ civ: c, positions, normals, centroid, pieces: this.pieces(positions, keys) });
    }
    return out;
  }
}

/** Shared walls are drawn twice, once in each civ's colour: each civ keeps one closed mesh. */
export const SHARED_WALL_DRAWN_TWICE = true;

/** Calls each(i, gi) for every point of a field's window: i its index in f.data, gi its index
 *  in the global G³ grid (x fastest). */
function visit(f: Field, each: (i: number, gi: number) => void) {
  const { G, periodic } = f;
  const [ax, ay, az] = f.ax;
  const gx = new Int32Array(ax.m);
  for (let a = 0; a < ax.m; a++) gx[a] = periodic ? (ax.o + a) % G : ax.o + a;
  let i = 0;
  for (let k = 0; k < az.m; k++) {
    const gz = periodic ? (az.o + k) % G : az.o + k;
    for (let j = 0; j < ay.m; j++) {
      const gy = periodic ? (ay.o + j) % G : ay.o + j;
      const row = (gz * G + gy) * G;
      for (let a = 0; a < ax.m; a++, i++) each(i, row + gx[a]);
    }
  }
}

/**
 * Latest wins: at most one job runs; while it does, a newer job replaces the waiting one (the
 * older is dropped, never run). submit() returns the job to start now, or undefined if it must
 * wait; finish() (the running job is done) returns the next job to start, if any.
 */
export class LatestWins<T> {
  private running = false;
  private pending: T | undefined;
  private hasPending = false;
  /** Jobs replaced before they ran. */
  dropped = 0;

  submit(job: T): T | undefined {
    if (!this.running) {
      this.running = true;
      return job;
    }
    if (this.hasPending) this.dropped++;
    this.pending = job;
    this.hasPending = true;
    return undefined;
  }

  finish(): T | undefined {
    if (!this.hasPending) {
      this.running = false;
      return undefined;
    }
    const job = this.pending as T;
    this.pending = undefined;
    this.hasPending = false;
    return job;
  }

  /** Forget everything (a new run, or the worker was replaced). */
  reset() {
    this.running = false;
    this.pending = undefined;
    this.hasPending = false;
  }
}

export interface ShellHit {
  /** Distance from the camera along the ray (any unit, only compared). */
  distance: number;
  /** Camera-space depth of the hit point (world units along the view axis), for choosePick. */
  depth: number;
  civ: number;
  /** Hit point in the galaxies' own coordinates. */
  point: ArrayLike<number>;
}

/**
 * The galaxy a tap opens from its shell hits, or −1: take the front-most hit whose civ still holds
 * a galaxy, and return that civ's owned galaxy nearest the hit point (wrapped distance on a torus
 * of side L). Unclaimed galaxies are never returned.
 */
export function pickShellHit(hits: ShellHit[], positions: ArrayLike<number>, owner: ArrayLike<number>, L: number, periodic: boolean): number {
  const order = [...hits].sort((a, b) => a.distance - b.distance);
  const n = Math.min(owner.length, Math.floor(positions.length / 3));
  const d1 = (d: number) => (periodic ? d - L * Math.round(d / L) : d);
  for (const hit of order) {
    let best = -1, bestD = Infinity;
    const p = hit.point;
    for (let i = 0; i < n; i++) {
      if (owner[i] !== hit.civ || hit.civ < 0) continue;
      const dx = d1(positions[3 * i] - p[0]), dy = d1(positions[3 * i + 1] - p[1]), dz = d1(positions[3 * i + 2] - p[2]);
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** A shell hit counts as in front of a galaxy only if nearer the camera by more than this
 *  fraction of the galaxy's depth. */
export const PICK_DEPTH_EPS = 1e-3;

/**
 * What a 3d tap opens, from the galaxy pick (`galaxy`, an owned galaxy within the pick radius on
 * screen, or −1, at camera-space depth `galaxyDepth`) and the shell hits under the tap (depth in
 * the same units). The galaxy wins unless another civ's shell surface lies in front of it (nearer
 * by more than PICK_DEPTH_EPS·galaxyDepth): then the front-most shell hit wins (pickShellHit: its
 * civ's owned galaxy nearest the hit point). Hits on the galaxy's own civ never hide it, since
 * every owned galaxy sits inside its own closed shell; counting them would mean a tapped galaxy
 * could never win. If the shells give nothing (no hit, or the civs hold nothing any more) the
 * galaxy pick stands.
 */
export function choosePick(galaxy: number, galaxyDepth: number, hits: ShellHit[], positions: ArrayLike<number>, owner: ArrayLike<number>, L: number, periodic: boolean): number {
  if (galaxy >= 0) {
    const civ = owner[galaxy];
    const front = galaxyDepth - PICK_DEPTH_EPS * Math.abs(galaxyDepth);
    if (!hits.some((h) => h.civ !== civ && h.depth < front)) return galaxy;
  }
  const s = pickShellHit(hits, positions, owner, L, periodic);
  return s >= 0 ? s : galaxy;
}

/** Display: shell opacity face-on and at grazing angles (fresnel rim), the rim's falloff power,
 *  and the crossfade time for a new shell. */
export const SHELL_FACE_OPACITY = 0.12;
export const SHELL_RIM_OPACITY = 0.5;
export const SHELL_RIM_POWER = 2.5;
export const SHELL_FADE_MS = 150;
