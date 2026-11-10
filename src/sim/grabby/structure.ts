// Large-scale structure: the Zel'dovich approximation (Zel'dovich 1970), truncated as in Coles,
// Melott & Shandarin (1993) by smoothing the initial spectrum.
//
//   1. A Gaussian random density field δ on a periodic grid, with power spectrum
//      P(k) ∝ kⁿ·exp(−(kR)²). n = SPECTRAL_INDEX; R comes from webScaleGly (see smoothingRadius).
//      The white noise comes from its own RNG stream (seed + "/web"), so the main stream
//      (positions, then civ draws) is consumed identically at every clumpiness.
//   2. The displacement ψ = −∇φ with ∇²φ = δ, so ∇·ψ = −δ: matter flows out of underdense
//      regions and converges on overdense ones. Both steps use a hand-written radix-2 FFT.
//   3. Each galaxy, drawn uniformly at q, moves to x = q + D·ψ(q), ψ interpolated linearly
//      (bilinear in 2d, trilinear in 3d). D = clumpiness · GROWTH / σ_δ, where σ_δ is the rms of
//      the linear density field, so D·σ_δ (the linear density contrast "today") does not depend
//      on the grid, the seed or the spectrum's amplitude. Past D·σ_δ ≈ 1 the flows cross and
//      galaxies pile up in pancakes, filaments and knots, leaving voids nearly empty.
//
// Geometry: flat and torus both wrap (the field is periodic, so the box edges do not show and
// nothing is clamped against them). The sphere samples a 3d periodic field in a box enclosing
// it, takes the tangential part of ψ and moves each galaxy along its great circle.
// clumpiness 0 returns before touching anything, so positions stay exactly uniform.

import { makeRng } from './rng';
import type { Params } from './types';

/** Spectral index n of the initial power spectrum P(k) ∝ kⁿ·exp(−(kR)²). Chosen from renders
 *  (round 6): n = −1 and 0 put much of the power in modes far larger than the web scale, so the
 *  voids come out several web scales across with tangled multistream sheets; n = +1 concentrates
 *  it near the web scale and gives a cellular web of thin filaments meeting at knots. */
export const SPECTRAL_INDEX = 1;
/** Linear density contrast D·σ_δ at clumpiness 1. First shell-crossing is at about 1. Past it
 *  the Zel'dovich web sharpens until about 2.2 (measured: void fraction and count-in-cells
 *  variance peak there), then the multistream sheets swell and the voids refill, so clumpiness 1
 *  sits just below that peak and every step up in clumpiness strengthens the web. The default
 *  (0.7) gives D·σ_δ ≈ 1.5: past shell-crossing, voids at roughly 1/(1 + 1.5)² ≈ 1/6 of the mean
 *  density. */
export const GROWTH = 2.1;
/** Each web cell (a region webScale across) holds at least this many galaxies on average. */
const MIN_GALAXIES_PER_CELL = 8;
/** The web scale spans at least this many grid cells, so the grid resolves it. */
const MIN_GRID_CELLS = 4;
/** The universe holds at least this many web cells along each axis. */
const MIN_CELLS_ACROSS = 3;

function dimOf(p: Params): number {
  return p.geometry === 'sphere' ? 2 : p.dim;
}

/** Area (2d, sphere) or volume (3d) of the domain. */
function webMeasure(p: Params): number {
  return p.geometry === 'sphere' ? 4 * Math.PI * (p.sizeGly / (2 * Math.PI)) ** 2 : Math.pow(p.sizeGly, p.dim);
}

/** Points per side of the periodic grid: 512² in 2d; 64³ or 128³ (above 262,144 galaxies) in 3d
 *  and on the sphere. */
export function gridSize(p: Params): number {
  if (p.geometry !== 'sphere' && p.dim === 2) return 512;
  return p.galaxies > 262144 ? 128 : 64;
}

/** Side of the periodic box the field lives in: the universe (flat, torus), or for the sphere a
 *  box enclosing it with a margin of two web scales, so a galaxy does not feel its antipode. */
function boxSide(p: Params, scale: number): number {
  return p.geometry === 'sphere' ? p.sizeGly / Math.PI + 2 * scale : p.sizeGly;
}

/**
 * The web scale the run actually uses: webScaleGly clamped so that a web cell (scale^dim) holds
 * at least 8 galaxies, spans at least 4 grid cells, and fits at least 3 times along each side
 * of the universe ((measure / 3^dim)^(1/dim)). Differs from webScaleGly only when clamped.
 */
export function effectiveWebScaleGly(p: Params): number {
  const d = dimOf(p);
  const measure = webMeasure(p);
  const hi = Math.pow(measure / Math.pow(MIN_CELLS_ACROSS, d), 1 / d);
  const byGalaxies = Math.pow((measure * MIN_GALAXIES_PER_CELL) / Math.max(1, p.galaxies), 1 / d);
  // The sphere's box depends on the scale; size it for the set scale (a small margin either way).
  const byGrid = (MIN_GRID_CELLS * boxSide(p, Math.min(hi, p.webScaleGly))) / gridSize(p);
  const lo = Math.max(byGalaxies, byGrid);
  return Math.min(hi, Math.max(lo, p.webScaleGly));
}

/** Smoothing radius R for a web scale λ: the wavelength 2π/k at which the density variance per
 *  log k, k^d·P(k), peaks is λ, i.e. k_peak = √((n + d)/2) / R = 2π/λ. */
export function smoothingRadius(scale: number, d: number): number {
  return (scale * Math.sqrt((SPECTRAL_INDEX + d) / 2)) / (2 * Math.PI);
}

// ---------------------------------------------------------------------------------------------
// FFT: iterative radix-2, in place on separate real/imaginary arrays, along every axis of an
// N^d grid (index x + N·y + N²·z). Unnormalised; `inverse` uses e^{+i…} and does not divide.

class Fft {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;
  private readonly lr: Float64Array;
  private readonly li: Float64Array;

  constructor(readonly n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.lr = new Float64Array(n);
    this.li = new Float64Array(n);
  }

  /** One line in the scratch arrays. */
  private line(inverse: boolean): void {
    const n = this.n, re = this.lr, im = this.li, rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    const sgn = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step], wi = sgn * this.sin[k * step];
          const a = s + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }

  /** Transform an N^d grid along every axis. */
  grid(re: Float64Array, im: Float64Array, d: number, inverse: boolean): void {
    const n = this.n;
    const lines = Math.pow(n, d - 1);
    for (let axis = 0; axis < d; axis++) {
      const stride = Math.pow(n, axis);
      for (let l = 0; l < lines; l++) {
        // Line l: the coordinates below the axis vary fastest, then those above it.
        const base = (l % stride) + Math.floor(l / stride) * stride * n;
        for (let i = 0, q = base; i < n; i++, q += stride) {
          this.lr[i] = re[q];
          this.li[i] = im[q];
        }
        this.line(inverse);
        for (let i = 0, q = base; i < n; i++, q += stride) {
          re[q] = this.lr[i];
          im[q] = this.li[i];
        }
      }
    }
  }
}

/** Radix-2 FFT of one complex sequence (exported for tests). Unnormalised both ways. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  new Fft(re.length).grid(re, im, 1, inverse);
}

// ---------------------------------------------------------------------------------------------

/** The displacement field ψ on the periodic grid, normalised by the linear density rms. */
export interface WebField {
  /** Grid points per side, grid dimension (3 for the sphere), box side and box origin. */
  n: number;
  d: number;
  L: number;
  origin: number;
  /** ψ / σ_δ at the grid points, one array per axis (d of them). Point j sits at origin + j·L/n. */
  psi: Float32Array[];
  /** rms of the linear density field δ = −∇·ψ on the grid, before normalising. */
  sigma: number;
}

/** Standard normals from the web stream, two per Box–Muller pair. */
function fillNormals(out: Float64Array, seed: string): void {
  const rng = makeRng(`${seed}/web`);
  for (let i = 0; i < out.length; i += 2) {
    const u1 = 1 - rng();
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    out[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < out.length) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
}

/** Build the field for a run (deterministic for the params that matter: geometry, dim, size,
 *  web scale, galaxy count and seed). */
export function webField(p: Params, report?: (frac: number) => void): WebField {
  const sphere = p.geometry === 'sphere';
  const d = sphere ? 3 : p.dim;
  const n = gridSize(p);
  const scale = effectiveWebScaleGly(p);
  const L = boxSide(p, scale);
  const origin = sphere ? -L / 2 : 0;
  const R = smoothingRadius(scale, dimOf(p));
  const total = Math.pow(n, d);

  const re = new Float64Array(total);
  const im = new Float64Array(total);
  fillNormals(re, p.seed);
  const fftN = new Fft(n);
  report?.(0.1);
  fftN.grid(re, im, d, false);
  report?.(0.35);

  // δ_k = noise_k · √P(k); then ψ_k = i k δ_k / k². Nyquist planes are zeroed so ψ stays real.
  const kf = (2 * Math.PI) / L;
  const half = n / 2;
  const wave = (j: number) => (j < half ? j : j - n) * kf;
  const zr = new Float64Array(d === 3 ? total : 0);
  const zi = new Float64Array(d === 3 ? total : 0);
  let var2 = 0;
  for (let q = 0; q < total; q++) {
    const jx = q % n, jy = Math.floor(q / n) % n, jz = d === 3 ? Math.floor(q / (n * n)) : 0;
    if (q === 0 || jx === half || jy === half || jz === half) {
      re[q] = 0;
      im[q] = 0;
      continue;
    }
    const kx = wave(jx), ky = wave(jy), kz = d === 3 ? wave(jz) : 0;
    const k2 = kx * kx + ky * ky + kz * kz;
    const amp = Math.sqrt(Math.pow(k2, SPECTRAL_INDEX / 2) * Math.exp(-k2 * R * R));
    const dr = re[q] * amp, di = im[q] * amp;
    var2 += dr * dr + di * di;
    // C = ψx + i·ψy, with ψx = i·kx·δ/k², ψy = i·ky·δ/k².
    re[q] = (-kx * di - ky * dr) / k2;
    im[q] = (kx * dr - ky * di) / k2;
    if (d === 3) {
      zr[q] = (-kz * di) / k2;
      zi[q] = (kz * dr) / k2;
    }
  }
  // Parseval: mean of δ(x)² over the grid = Σ|δ_k|² / N^(2d).
  const sigma = Math.sqrt(var2) / total;
  report?.(0.45);
  fftN.grid(re, im, d, true);
  report?.(d === 3 ? 0.7 : 0.95);
  if (d === 3) fftN.grid(zr, zi, d, true);
  report?.(0.95);

  const norm = sigma > 0 ? 1 / (total * sigma) : 0;
  const px = new Float32Array(total), py = new Float32Array(total);
  for (let q = 0; q < total; q++) {
    px[q] = re[q] * norm;
    py[q] = im[q] * norm;
  }
  const psi: Float32Array[] = [px, py];
  if (d === 3) {
    const pz = new Float32Array(total);
    for (let q = 0; q < total; q++) pz[q] = zr[q] * norm;
    psi.push(pz);
  }
  report?.(1);
  return { n, d, L, origin, psi, sigma };
}

/** ψ/σ_δ at (x, y, z), linearly interpolated with periodic wrap, into out. */
export function samplePsi(f: WebField, x: number, y: number, z: number, out: number[]): void {
  const { n, d, L, origin, psi } = f;
  const s = n / L;
  let gx = (x - origin) * s, gy = (y - origin) * s;
  gx -= n * Math.floor(gx / n);
  gy -= n * Math.floor(gy / n);
  const ix = Math.min(n - 1, Math.floor(gx)), iy = Math.min(n - 1, Math.floor(gy));
  const fx = gx - ix, fy = gy - iy;
  const ix1 = ix + 1 === n ? 0 : ix + 1, iy1 = iy + 1 === n ? 0 : iy + 1;
  if (d === 2) {
    const a = iy * n, b = iy1 * n;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    for (let c = 0; c < 2; c++) {
      const g = psi[c];
      out[c] = g[a + ix] * w00 + g[a + ix1] * w10 + g[b + ix] * w01 + g[b + ix1] * w11;
    }
    out[2] = 0;
    return;
  }
  let gz = (z - origin) * s;
  gz -= n * Math.floor(gz / n);
  const iz = Math.min(n - 1, Math.floor(gz)), fz = gz - iz;
  const iz1 = iz + 1 === n ? 0 : iz + 1;
  const nn = n * n;
  const c00 = iz * nn + iy * n, c10 = iz * nn + iy1 * n, c01 = iz1 * nn + iy * n, c11 = iz1 * nn + iy1 * n;
  const w000 = (1 - fx) * (1 - fy) * (1 - fz), w100 = fx * (1 - fy) * (1 - fz);
  const w010 = (1 - fx) * fy * (1 - fz), w110 = fx * fy * (1 - fz);
  const w001 = (1 - fx) * (1 - fy) * fz, w101 = fx * (1 - fy) * fz;
  const w011 = (1 - fx) * fy * fz, w111 = fx * fy * fz;
  for (let c = 0; c < 3; c++) {
    const g = psi[c];
    out[c] =
      g[c00 + ix] * w000 + g[c00 + ix1] * w100 + g[c10 + ix] * w010 + g[c10 + ix1] * w110 +
      g[c01 + ix] * w001 + g[c01 + ix1] * w101 + g[c11 + ix] * w011 + g[c11 + ix1] * w111;
  }
}

/** The growth factor D·σ_δ for a clumpiness (linear: 0 → uniform, 1 → GROWTH). */
export function growth(clumpiness: number): number {
  return GROWTH * clumpiness;
}

/** Put v in [0, size): the torus and the (periodic) flat box. */
function wrap(v: number, size: number): number {
  v -= size * Math.floor(v / size);
  return Math.fround(v) >= size || v < 0 ? 0 : v;
}

/**
 * Move uniform positions (in place) onto the cosmic web. clumpiness 0 is a no-op.
 * Deterministic for given params and positions.
 */
export function applyCosmicWeb(positions: Float32Array, p: Params, report?: (frac: number) => void): void {
  const c = p.clumpiness;
  if (!(c > 0)) return;
  const n = positions.length / 3;
  const f = webField(p, report && ((x) => report(0.5 * x)));
  const g = growth(c);
  const size = p.sizeGly;
  const psi = [0, 0, 0];

  if (p.geometry === 'sphere') {
    const R = size / (2 * Math.PI);
    // σ_δ is the 3d field's; the surface sees the tangential part, a little weaker (variance
    // 8/15), which renders close to the plane's look at the same clumpiness.
    const D = g;
    for (let i = 0; i < n; i++) {
      if (report && (i & 16383) === 0) report(0.5 + (0.5 * i) / n);
      const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
      const r = Math.hypot(x, y, z);
      if (!(r > 0)) continue;
      const ux = x / r, uy = y / r, uz = z / r;
      samplePsi(f, x, y, z, psi);
      const radial = psi[0] * ux + psi[1] * uy + psi[2] * uz;
      const tx = D * (psi[0] - radial * ux), ty = D * (psi[1] - radial * uy), tz = D * (psi[2] - radial * uz);
      const t = Math.hypot(tx, ty, tz);
      if (!(t > 0)) continue;
      // Along the great circle through the galaxy in direction t, by arc length t.
      const ang = t / R, cs = Math.cos(ang), sn = (R * Math.sin(ang)) / t;
      let ox = R * ux * cs + tx * sn;
      let oy = R * uy * cs + ty * sn;
      let oz = R * uz * cs + tz * sn;
      const o = Math.hypot(ox, oy, oz);
      ox *= R / o;
      oy *= R / o;
      oz *= R / o;
      positions[3 * i] = ox;
      positions[3 * i + 1] = oy;
      positions[3 * i + 2] = oz;
    }
    return;
  }

  const three = p.dim === 3;
  for (let i = 0; i < n; i++) {
    if (report && (i & 16383) === 0) report(0.5 + (0.5 * i) / n);
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    samplePsi(f, x, y, z, psi);
    positions[3 * i] = wrap(x + g * psi[0], size);
    positions[3 * i + 1] = wrap(y + g * psi[1], size);
    if (three) positions[3 * i + 2] = wrap(z + g * psi[2], size);
  }
}
