// Translucent territory shells for 3d (pure; the shell worker and the renderer use these). One
// smooth surface per civ around its galaxies: density field (shellfield.ts) → marching cubes
// (marching.ts). Plus the latest-wins job queue and the shell-hit pick.
import { extract, Mesh } from './marching';
import { buildField, gaussianKernel, gridSpec, KERNEL_RADIUS, SIGMA_CELLS } from './shellfield';

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
  /** Mean vertex, for back-to-front sorting. */
  centroid: [number, number, number];
}

/** Builds every civ's shell for an owner snapshot. Holds the positions (as grid coordinates) and scratch. */
export class ShellBuilder {
  readonly h: number;
  readonly margin: number;
  readonly iso = isoLevel();
  private coords: Float64Array;
  private gather: Float64Array;
  private field: Float32Array;
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
    this.field = new Float32Array(G * G * G);
  }

  /** One shell per civ in [0, civCount) that holds at least one galaxy, by civ id. */
  build(owner: Int32Array, civCount: number): CivShell[] {
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
    const out: CivShell[] = [];
    const { G, periodic } = this.opts;
    for (let c = 0; c < civCount; c++) {
      const count = start[c + 1] - start[c];
      if (count === 0) continue;
      const f = buildField(g.subarray(3 * start[c], 3 * start[c + 1]), count, G, periodic, KERNEL, this.field);
      if (!f) continue;
      extract(f, this.iso, this.h, this.margin, this.mesh);
      const { positions, normals } = this.mesh.take();
      if (positions.length === 0) continue;
      const centroid: [number, number, number] = [0, 0, 0];
      for (let v = 0; v < positions.length; v += 3) for (let a = 0; a < 3; a++) centroid[a] += positions[v + a];
      for (let a = 0; a < 3; a++) centroid[a] /= positions.length / 3;
      out.push({ civ: c, positions, normals, centroid });
    }
    return out;
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
  /** Distance from the camera (any unit, only compared). */
  distance: number;
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

/** Display: shell opacity face-on and at grazing angles (fresnel rim), the rim's falloff power,
 *  and the crossfade time for a new shell. */
export const SHELL_FACE_OPACITY = 0.12;
export const SHELL_RIM_OPACITY = 0.5;
export const SHELL_RIM_POWER = 2.5;
export const SHELL_FADE_MS = 150;
