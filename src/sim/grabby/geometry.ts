// Distances, a uniform bucket grid, the k-nearest-neighbour graph and radius counts.
// Flat/torus live in [0, size)^dim. The sphere is the surface of radius size/(2π) centred at
// the origin; it is bucketed by 3d position and ranked by chord distance.

import type { Dim, Geometry } from './types';

export interface Graph {
  /** CSR: neighbours of i are adj[start[i] .. start[i+1]). */
  start: Int32Array;
  adj: Int32Array;
  /** Distance (under the geometry's metric) for each adj entry. */
  w: Float64Array;
}

export class Space {
  readonly n: number;
  /** Sphere radius (0 unless geometry is 'sphere'). */
  readonly R: number;
  /** Largest possible distance between two points under the metric. */
  readonly maxDist: number;
  private readonly torus: boolean;
  private readonly sphere: boolean;
  private readonly origin: number;
  private readonly cw: number;
  private readonly G: [number, number, number];
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  private readonly cellOf: Int32Array;
  private readonly stamp: Int32Array;
  private stampId = 0;

  constructor(
    readonly pos: Float32Array,
    readonly dim: Dim,
    readonly geometry: Geometry,
    readonly size: number,
  ) {
    const n = (this.n = pos.length / 3);
    this.torus = geometry === 'torus';
    this.sphere = geometry === 'sphere';
    this.R = this.sphere ? size / (2 * Math.PI) : 0;
    this.maxDist = this.sphere
      ? Math.PI * this.R
      : this.torus
        ? (size / 2) * Math.sqrt(dim)
        : size * Math.sqrt(dim);

    // Grid sizing: about two points per cell on average.
    const L = this.sphere ? 2 * this.R : size;
    this.origin = this.sphere ? -this.R : 0;
    const measure = this.sphere ? 4 * Math.PI * this.R * this.R : Math.pow(size, dim);
    const target = Math.pow((2 * measure) / Math.max(1, n), 1 / dim);
    const box3 = this.sphere || dim === 3;
    const cap = box3 ? 100 : 1024;
    const g = Math.max(1, Math.min(cap, Math.floor(L / target)));
    this.G = [g, g, box3 ? g : 1];
    this.cw = L / g;

    const cells = this.G[0] * this.G[1] * this.G[2];
    const counts = new Int32Array(cells + 1);
    this.cellOf = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.cellIndexOfPoint(i);
      this.cellOf[i] = c;
      counts[c + 1]++;
    }
    for (let c = 0; c < cells; c++) counts[c + 1] += counts[c];
    this.cellStart = counts;
    this.cellItems = new Int32Array(n);
    const fill = counts.slice(0, cells);
    for (let i = 0; i < n; i++) this.cellItems[fill[this.cellOf[i]]++] = i;
    this.stamp = new Int32Array(cells);
  }

  private axisCell(v: number, a: number): number {
    const c = Math.floor((v - this.origin) / this.cw);
    return c < 0 ? 0 : c >= this.G[a] ? this.G[a] - 1 : c;
  }

  private cellIndexOfPoint(i: number): number {
    const p = this.pos;
    const x = this.axisCell(p[3 * i], 0);
    const y = this.axisCell(p[3 * i + 1], 1);
    const z = this.G[2] === 1 ? 0 : this.axisCell(p[3 * i + 2], 2);
    return (z * this.G[1] + y) * this.G[0] + x;
  }

  /** Distance under the metric: Euclidean, minimum-image (torus) or great-circle (sphere). */
  dist(i: number, j: number): number {
    const p = this.pos;
    const ax = p[3 * i], ay = p[3 * i + 1], az = p[3 * i + 2];
    const bx = p[3 * j], by = p[3 * j + 1], bz = p[3 * j + 2];
    if (this.sphere) {
      const cx = ay * bz - az * by;
      const cy = az * bx - ax * bz;
      const cz = ax * by - ay * bx;
      const cross = Math.sqrt(cx * cx + cy * cy + cz * cz);
      const dot = ax * bx + ay * by + az * bz;
      return this.R * Math.atan2(cross, dot);
    }
    return Math.sqrt(this.rank2(i, j));
  }

  /** Squared ranking distance: squared metric distance, or squared chord on the sphere. */
  private rank2(i: number, j: number): number {
    const p = this.pos;
    let dx = Math.abs(p[3 * i] - p[3 * j]);
    let dy = Math.abs(p[3 * i + 1] - p[3 * j + 1]);
    let dz = Math.abs(p[3 * i + 2] - p[3 * j + 2]);
    if (this.torus) {
      const s = this.size;
      if (dx > s / 2) dx = s - dx;
      if (dy > s / 2) dy = s - dy;
      if (dz > s / 2) dz = s - dz;
    }
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Visit every cell whose Chebyshev offset from (cx,cy,cz) lies in [rMin, rMax], once each.
   * Torus offsets wrap; flat/sphere offsets outside the grid are skipped.
   */
  private visitCells(
    cx: number, cy: number, cz: number, rMin: number, rMax: number,
    fn: (cell: number) => void,
  ): void {
    const [gx, gy, gz] = this.G;
    const id = ++this.stampId;
    const zr = gz === 1 ? 0 : rMax;
    for (let dz = -zr; dz <= zr; dz++) {
      let z = cz + dz;
      if (this.torus) z = ((z % gz) + gz) % gz;
      else if (z < 0 || z >= gz) continue;
      for (let dy = -rMax; dy <= rMax; dy++) {
        let y = cy + dy;
        if (this.torus) y = ((y % gy) + gy) % gy;
        else if (y < 0 || y >= gy) continue;
        const ady = Math.max(Math.abs(dz), Math.abs(dy));
        for (let dx = -rMax; dx <= rMax; dx++) {
          if (Math.max(ady, Math.abs(dx)) < rMin) continue;
          let x = cx + dx;
          if (this.torus) x = ((x % gx) + gx) % gx;
          else if (x < 0 || x >= gx) continue;
          const cell = (z * gy + y) * gx + x;
          if (this.stamp[cell] === id) continue;
          this.stamp[cell] = id;
          fn(cell);
        }
      }
    }
  }

  private cellCoords(i: number): [number, number, number] {
    const c = this.cellOf[i];
    const [gx, gy] = this.G;
    return [c % gx, Math.floor(c / gx) % gy, Math.floor(c / (gx * gy))];
  }

  /** k-nearest-neighbour graph under the metric, symmetrised. */
  neighbours(kWanted: number): Graph {
    const n = this.n;
    const k = Math.max(0, Math.min(kWanted, n - 1));
    const knn = new Int32Array(n * k);
    const seen = new Int32Array(n);
    const bestD = new Float64Array(k);
    const bestI = new Int32Array(k);
    const maxG = Math.max(this.G[0], this.G[1], this.G[2]);
    const rLimit = this.torus ? Math.ceil(maxG / 2) + 1 : maxG;
    const items = this.cellItems;
    const starts = this.cellStart;

    for (let i = 0; i < n; i++) {
      let found = 0;
      const [cx, cy, cz] = this.cellCoords(i);
      // Ring r covers Chebyshev offset r. A point outside rings 0..r is at least r·cw away.
      // Cell stamps are fresh per ring, so torus wrap can revisit an earlier ring's cell;
      // the per-point `seen` stamp handles that.
      const tag = i + 1;
      for (let r = 0; r <= rLimit; r++) {
        this.visitCells(cx, cy, cz, r, r, (cell) => {
          for (let q = starts[cell]; q < starts[cell + 1]; q++) {
            const j = items[q];
            if (j === i || seen[j] === tag) continue;
            seen[j] = tag;
            const d = this.rank2(i, j);
            if (found < k) {
              let p = found++;
              while (p > 0 && bestD[p - 1] > d) {
                bestD[p] = bestD[p - 1];
                bestI[p] = bestI[p - 1];
                p--;
              }
              bestD[p] = d;
              bestI[p] = j;
            } else if (k > 0 && d < bestD[k - 1]) {
              let p = k - 1;
              while (p > 0 && bestD[p - 1] > d) {
                bestD[p] = bestD[p - 1];
                bestI[p] = bestI[p - 1];
                p--;
              }
              bestD[p] = d;
              bestI[p] = j;
            }
          }
        });
        const reach = r * this.cw;
        if (found === k && bestD[k - 1] <= reach * reach) break;
      }
      for (let m = 0; m < k; m++) knn[i * k + m] = bestI[m];
    }

    // Symmetrise: i→j for every j in knn(i), and j→i.
    const deg = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      deg[i + 1] += k;
      for (let m = 0; m < k; m++) deg[knn[i * k + m] + 1]++;
    }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    const raw = new Int32Array(deg[n]);
    const fill = deg.slice(0, n);
    for (let i = 0; i < n; i++) {
      for (let m = 0; m < k; m++) {
        const j = knn[i * k + m];
        raw[fill[i]++] = j;
        raw[fill[j]++] = i;
      }
    }
    const start = new Int32Array(n + 1);
    const adj = new Int32Array(raw.length);
    let w = 0;
    for (let i = 0; i < n; i++) {
      const seg = raw.subarray(deg[i], deg[i + 1]).sort();
      start[i] = w;
      for (let q = 0; q < seg.length; q++) {
        if (q > 0 && seg[q] === seg[q - 1]) continue;
        adj[w++] = seg[q];
      }
    }
    start[n] = w;
    const adjOut = adj.slice(0, w);
    const dist = new Float64Array(w);
    for (let i = 0; i < n; i++) {
      for (let q = start[i]; q < start[i + 1]; q++) dist[q] = this.dist(i, adjOut[q]);
    }
    return { start, adj: adjOut, w: dist };
  }

  /**
   * Index of the stored point nearest to (x, y, z) under the ranking metric (Euclidean,
   * minimum-image on the torus, chord on the sphere, which ranks like great-circle distance).
   * The query must lie in the domain: [0, size]^dim, or on the sphere surface. -1 if empty.
   */
  nearestTo(x: number, y: number, z: number): number {
    if (this.n === 0) return -1;
    const cx = this.axisCell(x, 0);
    const cy = this.axisCell(y, 1);
    const cz = this.G[2] === 1 ? 0 : this.axisCell(z, 2);
    const maxG = Math.max(this.G[0], this.G[1], this.G[2]);
    const rLimit = this.torus ? Math.ceil(maxG / 2) + 1 : maxG;
    const p = this.pos;
    const s = this.size;
    const items = this.cellItems;
    const starts = this.cellStart;
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= rLimit; r++) {
      this.visitCells(cx, cy, cz, r, r, (cell) => {
        for (let q = starts[cell]; q < starts[cell + 1]; q++) {
          const j = items[q];
          let dx = Math.abs(x - p[3 * j]);
          let dy = Math.abs(y - p[3 * j + 1]);
          let dz = Math.abs(z - p[3 * j + 2]);
          if (this.torus) {
            if (dx > s / 2) dx = s - dx;
            if (dy > s / 2) dy = s - dy;
            if (dz > s / 2) dz = s - dz;
          }
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD || (d === bestD && j < best)) {
            bestD = d;
            best = j;
          }
        }
      });
      // Every point outside rings 0..r is at least r·cw away.
      const reach = r * this.cw;
      if (best >= 0 && bestD <= reach * reach) break;
    }
    return best;
  }

  /** Number of galaxies j with owner[j] === civ and dist(g, j) <= radius (g included). */
  countWithin(g: number, radius: number, owner: Int32Array, civ: number): number {
    let search = radius;
    if (this.sphere) {
      const ang = Math.min(Math.PI, radius / this.R);
      search = 2 * this.R * Math.sin(ang / 2);
    }
    const [cx, cy, cz] = this.cellCoords(g);
    const maxG = Math.max(this.G[0], this.G[1], this.G[2]);
    const rr = Math.min(maxG, Math.ceil(search / this.cw));
    const items = this.cellItems;
    const starts = this.cellStart;
    let count = 0;
    this.visitCells(cx, cy, cz, 0, rr, (cell) => {
      for (let q = starts[cell]; q < starts[cell + 1]; q++) {
        const j = items[q];
        if (owner[j] !== civ) continue;
        if (this.dist(g, j) <= radius) count++;
      }
    });
    return count;
  }
}
