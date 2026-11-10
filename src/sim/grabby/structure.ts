// Large-scale structure: a Voronoi kinematic model of the cosmic web (van de Weygaert & Icke
// 1989; van de Weygaert 1991). Nuclei (void centres) are scattered with mean spacing
// webScaleGly. Each galaxy starts uniform and moves:
//   1. radially away from its nearest nucleus, towards the wall of its Voronoi cell (the
//      bisector with a neighbouring nucleus): a wall in 3d, an edge in 2d and on the sphere;
//   2. then within that wall, away from the wall's centre, towards where a third cell meets it:
//      a filament in 3d, a node (vertex) in 2d and on the sphere.
// Both moves are fractions of the full path set by clumpiness, so 0 leaves the uniform draw
// untouched and 1 packs galaxies close to the web (never exactly onto it, so no two coincide).
//
// The nuclei come from their own RNG stream (seed + "/web"), so the main stream (positions,
// then civ draws) is consumed identically at every clumpiness.
//
// Geometry: flat clamps to the box (the box faces bound the cells); torus works in minimum-
// image coordinates around each galaxy and wraps the result; the sphere uses 3d chords. On
// the sphere every bisector plane of two nuclei passes through the centre, so the 3d Voronoi
// cells are cones and projecting radially back onto the surface keeps a point on the same
// spherical wall or node (chord distance ranks like great-circle distance).

import { Space } from './geometry';
import { makeRng } from './rng';
import type { Params } from './types';

/** Fraction of the way to the wall (step 1) and to the filament/node (step 2) at clumpiness 1. */
const WALL_PULL = 0.9;
const NODE_PULL = 0.75;
/** Each web cell keeps at least this many galaxies on average (caps the nucleus count). */
const MIN_GALAXIES_PER_CELL = 8;

function dimOf(p: Params): number {
  return p.geometry === 'sphere' ? 2 : p.dim;
}

/** Area (2d, sphere) or volume (3d) of the domain the nuclei are scattered over. */
function webMeasure(p: Params): number {
  return p.geometry === 'sphere' ? 4 * Math.PI * (p.sizeGly / (2 * Math.PI)) ** 2 : Math.pow(p.sizeGly, p.dim);
}

/** Number of nuclei: domain measure / webScale^dim, at least 3^dim (so torus cells stay well
 *  under half the box) and at most galaxies / MIN_GALAXIES_PER_CELL. */
export function nucleusCount(p: Params): number {
  const d = dimOf(p);
  const ideal = Math.round(webMeasure(p) / Math.pow(p.webScaleGly, d));
  const lo = Math.pow(3, d);
  const hi = Math.max(lo, Math.floor(p.galaxies / MIN_GALAXIES_PER_CELL));
  return Math.min(hi, Math.max(lo, ideal));
}

/** The mean nucleus spacing the run actually uses, (measure / nucleusCount)^(1/dim). Differs
 *  from webScaleGly when the count is clamped (too few galaxies, or a small universe). */
export function effectiveWebScaleGly(p: Params): number {
  return Math.pow(webMeasure(p) / nucleusCount(p), 1 / dimOf(p));
}

/** Web nuclei (void centres), xyz per nucleus, from the web's own RNG stream. */
export function webNuclei(p: Params): Float32Array {
  const rng = makeRng(`${p.seed}/web`);
  const k = nucleusCount(p);
  const out = new Float32Array(3 * k);
  if (p.geometry === 'sphere') {
    const R = p.sizeGly / (2 * Math.PI);
    for (let i = 0; i < k; i++) {
      const z = 2 * rng() - 1;
      const phi = 2 * Math.PI * rng();
      const rho = Math.sqrt(Math.max(0, 1 - z * z));
      out[3 * i] = R * rho * Math.cos(phi);
      out[3 * i + 1] = R * rho * Math.sin(phi);
      out[3 * i + 2] = R * z;
    }
  } else {
    for (let i = 0; i < k; i++) {
      out[3 * i] = rng() * p.sizeGly;
      out[3 * i + 1] = rng() * p.sizeGly;
      out[3 * i + 2] = p.dim === 3 ? rng() * p.sizeGly : 0;
    }
  }
  return out;
}

const EPS = 1e-12;

/**
 * Move uniform positions (in place) onto the cosmic web. clumpiness 0 is a no-op.
 * Deterministic for given params and positions.
 */
export function applyCosmicWeb(positions: Float32Array, p: Params, report?: (frac: number) => void): void {
  const c = p.clumpiness;
  if (!(c > 0)) return;
  const n = positions.length / 3;
  const nuc = webNuclei(p);
  const K = nuc.length / 3;
  const torus = p.geometry === 'torus';
  const sphere = p.geometry === 'sphere';
  const flat = p.geometry === 'flat';
  const size = p.sizeGly;
  const R = size / (2 * Math.PI);
  const dims = sphere ? 3 : p.dim;

  // Candidate Voronoi neighbours of each nucleus: its symmetrised k nearest nuclei. Delaunay
  // degree averages 6 in 2d and ~15.5 in 3d, so these lists almost always contain them all.
  const nucSpace = new Space(nuc, p.dim, p.geometry, size);
  const graph = nucSpace.neighbours(Math.min(K - 1, p.dim === 3 ? 26 : 14));

  const s1 = WALL_PULL * c;
  const s2 = NODE_PULL * c;

  const x = [0, 0, 0];
  const c1 = [0, 0, 0];
  const cj = [0, 0, 0];
  const u = [0, 0, 0];
  const q1 = [0, 0, 0];
  const q2 = [0, 0, 0];
  const m = [0, 0, 0];
  const w = [0, 0, 0];
  const nrm = [0, 0, 0];
  const out = [0, 0, 0];

  /** out ← nucleus j, as the image nearest to x on the torus. */
  const image = (j: number, o: number[]) => {
    for (let k = 0; k < 3; k++) {
      let v = nuc[3 * j + k];
      if (torus) {
        const d = v - x[k];
        if (d > size / 2) v -= size;
        else if (d < -size / 2) v += size;
      }
      o[k] = v;
    }
  };

  /** Distance along ray o + t·dir (t >= 0) to the box faces (flat only). */
  const boxExit = (o: number[], dir: number[]): number => {
    let t = Infinity;
    for (let k = 0; k < p.dim; k++) {
      if (dir[k] > EPS) t = Math.min(t, (size - o[k]) / dir[k]);
      else if (dir[k] < -EPS) t = Math.min(t, -o[k] / dir[k]);
    }
    return t;
  };

  const goal = [0, 0, 0];
  /** out ← x + t·s1·(goal − x), put back in the domain. False if degenerate (sphere centre). */
  const place = (t: number): boolean => {
    for (let k = 0; k < 3; k++) out[k] = x[k] + t * s1 * (goal[k] - x[k]);
    if (sphere) {
      const r = Math.hypot(out[0], out[1], out[2]);
      if (r < EPS) return false;
      for (let k = 0; k < 3; k++) out[k] *= R / r;
      return true;
    }
    for (let k = 0; k < p.dim; k++) {
      let v = out[k];
      if (torus) {
        v = ((v % size) + size) % size;
        if (Math.fround(v) >= size) v = 0;
      } else {
        v = Math.min(size, Math.max(0, v));
      }
      out[k] = v;
    }
    return true;
  };

  for (let i = 0; i < n; i++) {
    if (report && (i & 16383) === 0) report(i / n);
    for (let k = 0; k < 3; k++) x[k] = positions[3 * i + k];
    const j1 = nucSpace.nearestTo(x[0], x[1], x[2]);
    image(j1, c1);

    // Step 1: ray from c1 through x to the first bisector plane with another nucleus.
    let len = 0;
    for (let k = 0; k < 3; k++) {
      u[k] = x[k] - c1[k];
      len += u[k] * u[k];
    }
    len = Math.sqrt(len);
    if (len < EPS) continue;
    for (let k = 0; k < 3; k++) u[k] /= len;
    let lam = Infinity;
    let j2 = -1;
    for (let e = graph.start[j1]; e < graph.start[j1 + 1]; e++) {
      const j = graph.adj[e];
      image(j, cj);
      let un = 0, nn = 0;
      for (let k = 0; k < 3; k++) {
        const d = cj[k] - c1[k];
        un += u[k] * d;
        nn += d * d;
      }
      if (un <= EPS) continue;
      const t = nn / 2 / un;
      if (t < lam) {
        lam = t;
        j2 = j;
      }
    }
    if (flat) {
      const tb = boxExit(c1, u);
      if (tb < lam) {
        lam = tb;
        j2 = -1;
      }
    }
    if (!Number.isFinite(lam)) continue;
    lam = Math.max(lam, len);
    for (let k = 0; k < 3; k++) {
      q1[k] = c1[k] + lam * u[k];
      q2[k] = q1[k];
    }

    // Step 2: within the wall between c1 and c2, from its centre (the midpoint) through q1
    // to the first bisector plane with a third nucleus.
    if (j2 >= 0) {
      image(j2, cj);
      let nn = 0;
      for (let k = 0; k < 3; k++) {
        m[k] = (c1[k] + cj[k]) / 2;
        nrm[k] = cj[k] - c1[k];
        nn += nrm[k] * nrm[k];
      }
      // w = q1 − m, projected into the wall plane (removes rounding drift).
      let wn = 0;
      for (let k = 0; k < 3; k++) {
        w[k] = q1[k] - m[k];
        wn += w[k] * nrm[k];
      }
      let mu0 = 0;
      for (let k = 0; k < 3; k++) {
        w[k] -= (wn / nn) * nrm[k];
        mu0 += w[k] * w[k];
      }
      mu0 = Math.sqrt(mu0);
      if (mu0 > EPS) {
        for (let k = 0; k < 3; k++) w[k] /= mu0;
        let mu = Infinity;
        for (let e = graph.start[j1]; e < graph.start[j1 + 1]; e++) {
          const j = graph.adj[e];
          if (j === j2) continue;
          image(j, cj);
          let wd = 0, num = 0;
          for (let k = 0; k < 3; k++) {
            const d = cj[k] - c1[k];
            wd += w[k] * d;
            num += ((c1[k] + cj[k]) / 2 - m[k]) * d;
          }
          if (wd <= EPS) continue;
          const t = num / wd;
          if (t < mu) mu = t;
        }
        if (flat) mu = Math.min(mu, boxExit(m, w));
        if (Number.isFinite(mu)) {
          mu = Math.max(mu, mu0);
          for (let k = 0; k < 3; k++) q2[k] = m[k] + mu * w[k];
        }
      }
    }

    // Final: x moves by fraction s1 towards q1 + s2·(q2 − q1).
    for (let k = 0; k < 3; k++) goal[k] = x[k];
    for (let k = 0; k < dims; k++) goal[k] = q1[k] + s2 * (q2[k] - q1[k]);
    if (!place(1)) continue;
    // Safety net: the candidate neighbour lists can miss a Voronoi neighbour (or, on a small
    // torus, a second image of one), letting the point cross into another cell. The cell is
    // convex and x is inside it, so bisect back along the path to the wall actually crossed.
    if (nucSpace.nearestTo(out[0], out[1], out[2]) !== j1) {
      let lo = 0, hi = 1;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        place(mid);
        if (nucSpace.nearestTo(out[0], out[1], out[2]) === j1) lo = mid;
        else hi = mid;
      }
      if (!place(lo)) continue;
    }
    for (let k = 0; k < 3; k++) positions[3 * i + k] = out[k];
  }
}
