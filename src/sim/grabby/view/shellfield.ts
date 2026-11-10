// Density fields for the 3d territory shells (pure; runs in the shell worker). One civ at a time:
// its galaxies are splatted cloud-in-cell onto a cubic grid of G points per side, then blurred by
// a separable Gaussian. The field is kept only on a window (a box of grid points) that covers the
// civ's galaxies plus the blur's reach plus one zero layer, so a small territory costs little.
//
// Grids. 3-torus: G points per side at x = i·h, h = L / G, periodic (splat and blur wrap). Flat:
// G points at x = (i − GRID_MARGIN)·h, h = L / (G − 1 − 2·GRID_MARGIN), so the box [0, L] sits
// inside the grid with GRID_MARGIN points to spare on each side and every surface closes.

/** Blur σ in grid cells. */
export const SIGMA_CELLS = 1.25;
/** Blur reach in cells (≈ 3σ); the kernel has 2R + 1 taps. */
export const KERNEL_RADIUS = 4;
/** Flat grids: points outside the box on each side (blur reach + CIC spread + a zero layer). */
export const GRID_MARGIN = KERNEL_RADIUS + 2;
export const MIN_GRID = 32;
export const MAX_GRID = 64;

/**
 * Grid points per side for n galaxies: cbrt(n) rounded to a multiple of 8, clamped to [32, 64]
 * (about one galaxy per cell). 100k → 48, ≤ ~43k → 32, ≥ ~166k → 64.
 */
export function gridSize(n: number): number {
  const g = 8 * Math.round(Math.cbrt(Math.max(0, n)) / 8);
  return Math.min(MAX_GRID, Math.max(MIN_GRID, g));
}

/** Cell size and offset: grid coordinate u = x / h + margin. */
export function gridSpec(L: number, G: number, periodic: boolean): { h: number; margin: number } {
  return periodic ? { h: L / G, margin: 0 } : { h: L / (G - 1 - 2 * GRID_MARGIN), margin: GRID_MARGIN };
}

/** Normalised Gaussian taps k[0 .. 2R]. */
export function gaussianKernel(sigma: number, R: number): Float32Array {
  const k = new Float64Array(2 * R + 1);
  let s = 0;
  for (let i = -R; i <= R; i++) s += k[i + R] = Math.exp(-(i * i) / (2 * sigma * sigma));
  return Float32Array.from(k, (v) => v / s);
}

/** One axis of a window: grid points o, o+1, … o+m−1 (mod G on a periodic grid). wrap = the
 *  window is the whole periodic axis, so its last point neighbours its first. */
export interface Axis {
  o: number;
  m: number;
  wrap: boolean;
}

/** Field values on a window of a G³ grid, x fastest: data[(c·my + b)·mx + a] is grid point
 *  (o_x + a, o_y + b, o_z + c). Outside the window the field is 0. */
export interface Field {
  G: number;
  periodic: boolean;
  ax: [Axis, Axis, Axis];
  data: Float32Array;
}

/** The whole grid as one window. */
export function fullField(G: number, periodic: boolean): Field {
  const a = (): Axis => ({ o: 0, m: G, wrap: periodic });
  return { G, periodic, ax: [a(), a(), a()], data: new Float32Array(G * G * G) };
}

/**
 * The window along one axis for the occupied grid points occ[0 .. G), padded by `pad` points on
 * each side, or null if nothing is occupied. Periodic: the shortest arc covering every occupied
 * point (the complement of the longest empty run, which may wrap); the whole axis if the padded
 * arc would reach round. Flat: [min − pad, max + pad] clipped to the grid.
 */
export function axisWindow(occ: Uint8Array, G: number, pad: number, periodic: boolean): Axis | null {
  let lo = -1, hi = -1;
  for (let i = 0; i < G; i++)
    if (occ[i]) {
      if (lo < 0) lo = i;
      hi = i;
    }
  if (lo < 0) return null;
  if (!periodic) {
    const o = Math.max(0, lo - pad);
    return { o, m: Math.min(G - 1, hi + pad) - o + 1, wrap: false };
  }
  // Longest empty run, circularly. Start scanning just after an occupied point.
  let bestLen = 0, bestEnd = lo; // the run ends just before bestEnd (an occupied point)
  let run = 0;
  for (let s = 1; s <= G; s++) {
    const i = (lo + s) % G;
    if (occ[i]) {
      if (run > bestLen) {
        bestLen = run;
        bestEnd = i;
      }
      run = 0;
    } else run++;
  }
  const m = G - bestLen + 2 * pad;
  if (m >= G) return { o: 0, m: G, wrap: true };
  return { o: (((bestEnd - pad) % G) + G) % G, m, wrap: false };
}

/** Local window index of grid index g on this axis, or −1 if outside. */
function local(ax: Axis, g: number, G: number, periodic: boolean): number {
  const d = periodic ? (((g - ax.o) % G) + G) % G : g - ax.o;
  return d >= 0 && d < ax.m ? d : -1;
}

/** Add `count` unit masses at grid coordinates coords[3i .. 3i+2] with cloud-in-cell weights. */
export function splat(f: Field, coords: ArrayLike<number>, count: number) {
  const { G, periodic, data } = f;
  const [ax, ay, az] = f.ax;
  const mx = ax.m, my = ay.m;
  const ix = [0, 0], iy = [0, 0], iz = [0, 0], wx = [0, 0], wy = [0, 0], wz = [0, 0];
  const corner = (u: number, axis: Axis, idx: number[], w: number[]) => {
    const i0 = Math.floor(u), t = u - i0;
    let i1 = i0 + 1;
    let j0 = i0;
    if (periodic) {
      j0 = ((i0 % G) + G) % G;
      i1 = (j0 + 1) % G;
    }
    idx[0] = local(axis, j0, G, periodic);
    idx[1] = local(axis, i1, G, periodic);
    w[0] = 1 - t;
    w[1] = t;
  };
  for (let n = 0; n < count; n++) {
    corner(coords[3 * n], ax, ix, wx);
    corner(coords[3 * n + 1], ay, iy, wy);
    corner(coords[3 * n + 2], az, iz, wz);
    for (let c = 0; c < 2; c++) {
      if (iz[c] < 0) continue;
      for (let b = 0; b < 2; b++) {
        if (iy[b] < 0) continue;
        const row = (iz[c] * my + iy[b]) * mx, wzy = wz[c] * wy[b];
        for (let a = 0; a < 2; a++) if (ix[a] >= 0) data[row + ix[a]] += wzy * wx[a];
      }
    }
  }
}

let lineBuf = new Float32Array(0);

/** Separable Gaussian blur in place. Wrapping axes wrap; elsewhere the field is 0 beyond the window. */
export function blur(f: Field, k: Float32Array) {
  const [ax, ay, az] = f.ax;
  const dims = [ax.m, ay.m, az.m];
  const strides = [1, ax.m, ax.m * ay.m];
  for (let a = 0; a < 3; a++) blurAxis(f.data, dims, strides, a, f.ax[a].wrap, k);
}

function blurAxis(data: Float32Array, dims: number[], strides: number[], axis: number, wrap: boolean, k: Float32Array) {
  const R = (k.length - 1) >> 1;
  const m = dims[axis], st = strides[axis];
  if (lineBuf.length < m + 2 * R) lineBuf = new Float32Array(m + 2 * R);
  const line = lineBuf;
  // The two other axes, iterated to visit every line along `axis`.
  const o1 = axis === 0 ? 1 : 0, o2 = axis === 2 ? 1 : 2;
  const n1 = dims[o1], s1 = strides[o1], n2 = dims[o2], s2 = strides[o2];
  for (let j2 = 0; j2 < n2; j2++)
    for (let j1 = 0; j1 < n1; j1++) {
      const base = j1 * s1 + j2 * s2;
      let any = false;
      for (let i = 0, p = base; i < m; i++, p += st) {
        const v = data[p];
        line[i + R] = v;
        if (v !== 0) any = true;
      }
      if (!any) continue; // an empty line stays empty
      for (let i = 0; i < R; i++) {
        line[i] = wrap ? line[m + i] : 0;
        line[m + R + i] = wrap ? line[R + i] : 0;
      }
      for (let i = 0, p = base; i < m; i++, p += st) {
        let s = 0;
        for (let t = 0; t <= 2 * R; t++) s += k[t] * line[i + t];
        data[p] = s;
      }
    }
}

/** Occupancy scratch, reused. */
let occBuf: Uint8Array[] = [];

/**
 * Splat `count` galaxies at grid coordinates `coords` and blur them, on the smallest window that
 * holds the whole blurred field plus a zero layer (padded KERNEL_RADIUS + 1 points beyond the
 * CIC footprint). `into`, if big enough, is reused for the data. Null when count is 0.
 */
export function buildField(coords: ArrayLike<number>, count: number, G: number, periodic: boolean, k: Float32Array, into?: Float32Array): Field | null {
  if (count === 0) return null;
  if (occBuf.length !== 3 || occBuf[0].length !== G) occBuf = [new Uint8Array(G), new Uint8Array(G), new Uint8Array(G)];
  for (const o of occBuf) o.fill(0);
  for (let n = 0; n < count; n++)
    for (let a = 0; a < 3; a++) {
      const i0 = Math.floor(coords[3 * n + a]);
      const occ = occBuf[a];
      if (periodic) {
        const j = ((i0 % G) + G) % G;
        occ[j] = occ[(j + 1) % G] = 1;
      } else {
        if (i0 >= 0 && i0 < G) occ[i0] = 1;
        if (i0 + 1 >= 0 && i0 + 1 < G) occ[i0 + 1] = 1;
      }
    }
  const R = (k.length - 1) >> 1;
  const ax = occBuf.map((o) => axisWindow(o, G, R + 1, periodic)) as [Axis, Axis, Axis];
  if (ax.some((a) => !a)) return null;
  const size = ax[0].m * ax[1].m * ax[2].m;
  const data = into && into.length >= size ? into.subarray(0, size) : new Float32Array(size);
  data.fill(0);
  const f: Field = { G, periodic, ax, data };
  splat(f, coords, count);
  blur(f, k);
  return f;
}
