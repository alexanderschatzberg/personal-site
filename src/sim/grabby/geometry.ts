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
  /** The bridges added to connect the kNN graph, as flat pairs (i, j), in the order found. Each
   *  joins two components of the kNN graph plus the earlier bridges, so none is a kNN pair. */
  bridges: Int32Array;
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

  /**
   * Lower bound on the squared gap, along one axis, between coordinate v and any point stored
   * in cell index c (of g along that axis): minimum-image on the torus, and open-ended for the
   * edge cells of a flat or sphere grid (those also hold clamped points). The small slack
   * absorbs rounding in the cell assignment, so it never exceeds the true gap.
   */
  private gap2(v: number, c: number, g: number): number {
    const cw = this.cw;
    const lo = this.origin + c * cw, hi = lo + cw;
    let gap: number;
    if (this.torus) {
      gap = Math.max(0, lo - v, v - hi);
      gap = Math.min(gap, Math.max(0, this.size - Math.max(Math.abs(v - lo), Math.abs(v - hi))));
    } else {
      gap = Math.max(0, c === 0 ? 0 : lo - v, c === g - 1 ? 0 : v - hi);
    }
    gap -= 1e-6 * cw;
    return gap > 0 ? gap * gap : 0;
  }

  private cellCoords(i: number): [number, number, number] {
    const c = this.cellOf[i];
    const [gx, gy] = this.G;
    return [c % gx, Math.floor(c / gx) % gy, Math.floor(c / (gx * gy))];
  }

  /**
   * k-nearest-neighbour graph under the metric, symmetrised, plus the fewest shortest bridges
   * that make it connected. Clustered positions (the cosmic web) can split the plain kNN graph
   * into islands that no front could ever leave; each bridge is the shortest link between two
   * components (Borůvka), so a uniform field, whose kNN graph is already connected, is
   * unchanged.
   */
  neighbours(kWanted: number, report?: (stage: 'neighbours' | 'bridges' | 'graph', frac: number) => void): Graph {
    const n = this.n;
    const k = Math.max(0, Math.min(kWanted, n - 1));
    const knn = new Int32Array(n * k);
    const bestD = new Float64Array(k);
    const bestI = new Int32Array(k);
    // A kd-tree adapts to clustering (the cosmic web packs some grid cells with hundreds of
    // points and leaves others empty), so it beats the uniform grid there. Exact: the k nearest
    // by (squared ranking distance, then index), so the result does not depend on query order;
    // queries go in tree order for cache locality.
    const tree = new KdTree(this.pos, n);
    const size = this.torus ? this.size : 0;
    const order = tree.order;
    for (let q = 0; q < n; q++) {
      if (report && (q & 16383) === 0) report('neighbours', q / n);
      const i = order[q];
      tree.knn(i, k, size, bestD, bestI);
      for (let m = 0; m < k; m++) knn[i * k + m] = bestI[m];
    }

    report?.('bridges', 0);
    const bridges = this.bridges(knn, k, tree, report);
    report?.('graph', 0);

    // Symmetrise: i→j for every j in knn(i), and j→i; bridges both ways.
    const deg = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      deg[i + 1] += k;
      for (let m = 0; m < k; m++) deg[knn[i * k + m] + 1]++;
    }
    for (let b = 0; b < bridges.length; b++) deg[bridges[b] + 1]++;
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
    for (let b = 0; b < bridges.length; b += 2) {
      const i = bridges[b], j = bridges[b + 1];
      raw[fill[i]++] = j;
      raw[fill[j]++] = i;
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
    return { start, adj: adjOut, w: dist, bridges: Int32Array.from(bridges) };
  }

  /**
   * Borůvka on top of the kNN graph: while it has more than one component, link each
   * component to its nearest point outside it. Returns the added pairs (i, j) flat.
   */
  private bridges(knn: Int32Array, k: number, tree: KdTree, report?: (stage: 'bridges', frac: number) => void): number[] {
    const n = this.n;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    let comps = n;
    const union = (a: number, b: number): boolean => {
      const ra = find(a), rb = find(b);
      if (ra === rb) return false;
      if (ra < rb) parent[rb] = ra;
      else parent[ra] = rb;
      comps--;
      return true;
    };
    for (let i = 0; i < n; i++) for (let m = 0; m < k; m++) union(i, knn[i * k + m]);
    const out: number[] = [];
    if (comps <= 1) return out;

    // Each round needs, for every component, its closest pair (i inside, j outside), ties
    // broken by the pair's indices. A grid ring scan from every point costs O(n · gap²/cell²)
    // once clumps are far apart compared with the cell size, so search a kd-tree instead: a
    // subtree whose points all share the query's component is skipped whole, and a subtree
    // farther than the component's best so far is skipped too. The search is exact, so the
    // result does not depend on the order of the queries.
    const label = new Int32Array(n);
    const bestD = new Float64Array(n);
    const bestI = new Int32Array(n);
    const bestJ = new Int32Array(n);
    const comps0 = comps;
    while (comps > 1) {
      report?.('bridges', 1 - (comps - 1) / (comps0 - 1));
      for (let i = 0; i < n; i++) label[i] = find(i);
      tree.labelNodes(label);
      bestD.fill(Infinity);
      for (let i = 0; i < n; i++) {
        const c = label[i];
        tree.nearestForeign(i, c, label, this.torus ? this.size : 0, bestD, bestI, bestJ, (a, b) =>
          this.rank2(a, b),
        );
      }
      for (let c = 0; c < n; c++) {
        if (label[c] !== c || bestD[c] === Infinity) continue;
        if (union(bestI[c], bestJ[c])) out.push(bestI[c], bestJ[c]);
      }
    }
    return out;
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

/**
 * A kd-tree over the points (leaves of up to LEAF points, split at the median of the widest
 * axis) for Borůvka's nearest-other-component search. Node ids are in preorder, so a node's
 * left child is id + 1 and children always have larger ids than their parent.
 */
const LEAF = 8;

class KdTree {
  /** Point indices, grouped so each node owns idx[lo[node] .. hi[node]). */
  private readonly idx: Int32Array;
  private readonly lo: Int32Array;
  private readonly hi: Int32Array;
  private readonly right: Int32Array; // -1 for a leaf
  /** Bounding box per node: min xyz then max xyz. */
  private readonly box: Float64Array;
  /** Component shared by every point in the node, or -1 if they differ. */
  private readonly lab: Int32Array;
  /** Parent of each node (-1 for the root), and the leaf holding each point. */
  private readonly parent: Int32Array;
  private readonly leafOf: Int32Array;
  private nodes = 0;
  private stackN = new Int32Array(64);
  private stackD = new Float64Array(64);

  constructor(private readonly pos: Float32Array, n: number) {
    this.idx = new Int32Array(n);
    for (let i = 0; i < n; i++) this.idx[i] = i;
    const cap = Math.max(1, 2 * Math.ceil(n / (LEAF / 2)) + 1);
    this.lo = new Int32Array(cap);
    this.hi = new Int32Array(cap);
    this.right = new Int32Array(cap);
    this.box = new Float64Array(6 * cap);
    this.lab = new Int32Array(cap);
    this.parent = new Int32Array(cap).fill(-1);
    this.leafOf = new Int32Array(n);
    if (n > 0) this.build(0, n);
  }

  private build(a: number, b: number): number {
    const node = this.nodes++;
    const pos = this.pos, idx = this.idx, box = this.box;
    this.lo[node] = a;
    this.hi[node] = b;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let q = a; q < b; q++) {
      const j = 3 * idx[q];
      const x = pos[j], y = pos[j + 1], z = pos[j + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const o = 6 * node;
    box[o] = x0; box[o + 1] = y0; box[o + 2] = z0;
    box[o + 3] = x1; box[o + 4] = y1; box[o + 5] = z1;
    if (b - a <= LEAF) {
      this.right[node] = -1;
      for (let q = a; q < b; q++) this.leafOf[idx[q]] = node;
      return node;
    }
    const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const mid = (a + b) >> 1;
    this.select(a, b - 1, mid, axis);
    this.parent[this.build(a, mid)] = node;
    const r = this.build(mid, b);
    this.parent[r] = node;
    this.right[node] = r;
    return node;
  }

  /** Quickselect: reorder idx[l..r] so idx[k] holds the k-th smallest along axis. */
  private select(l: number, r: number, k: number, axis: number): void {
    const idx = this.idx, pos = this.pos;
    while (r > l) {
      const pivot = pos[3 * idx[(l + r) >> 1] + axis];
      let i = l, j = r;
      while (i <= j) {
        while (pos[3 * idx[i] + axis] < pivot) i++;
        while (pos[3 * idx[j] + axis] > pivot) j--;
        if (i <= j) {
          const t = idx[i];
          idx[i] = idx[j];
          idx[j] = t;
          i++;
          j--;
        }
      }
      if (k <= j) r = j;
      else if (k >= i) l = i;
      else return;
    }
  }

  /** Point indices in tree order (leaf by leaf). */
  get order(): Int32Array {
    return this.idx;
  }

  /**
   * The k points nearest to point i (excluding i) by squared ranking distance (Euclidean or
   * minimum-image when size > 0; chord on the sphere), ties by the lower index, into bestD /
   * bestI in that order. Returns how many were found (k unless there are fewer other points).
   */
  knn(i: number, k: number, size: number, bestD: Float64Array, bestI: Int32Array): number {
    if (k === 0 || this.nodes === 0) return 0;
    const pos = this.pos;
    const px = pos[3 * i], py = pos[3 * i + 1], pz = pos[3 * i + 2];
    // Bottom-up: the query's own leaf first (a tight bound at once), then at each ancestor the
    // sibling subtree, unless it is entirely farther than the k-th best.
    let node = this.leafOf[i];
    let found = this.scanLeaf(node, i, px, py, pz, k, size, bestD, bestI, 0);
    while (node > 0) {
      const p = this.parent[node];
      const sib = node === p + 1 ? this.right[p] : p + 1;
      const lb = this.lowerBound(px, py, pz, sib, size);
      if (found < k || lb <= bestD[k - 1]) found = this.search(sib, lb, i, px, py, pz, k, size, bestD, bestI, found);
      node = p;
    }
    return found;
  }

  /** Offer the points of one leaf to the k-best list (sorted by distance, then index). */
  private scanLeaf(
    node: number, i: number, px: number, py: number, pz: number, k: number, size: number,
    bestD: Float64Array, bestI: Int32Array, found: number,
  ): number {
    const pos = this.pos, idx = this.idx, half = size / 2;
    for (let q = this.lo[node]; q < this.hi[node]; q++) {
      const j = idx[q];
      if (j === i) continue;
      let dx = Math.abs(px - pos[3 * j]);
      let dy = Math.abs(py - pos[3 * j + 1]);
      let dz = Math.abs(pz - pos[3 * j + 2]);
      if (size > 0) {
        if (dx > half) dx = size - dx;
        if (dy > half) dy = size - dy;
        if (dz > half) dz = size - dz;
      }
      const d = dx * dx + dy * dy + dz * dz;
      let p: number;
      if (found < k) p = found++;
      else if (d < bestD[k - 1] || (d === bestD[k - 1] && j < bestI[k - 1])) p = k - 1;
      else continue;
      while (p > 0 && (bestD[p - 1] > d || (bestD[p - 1] === d && bestI[p - 1] > j))) {
        bestD[p] = bestD[p - 1];
        bestI[p] = bestI[p - 1];
        p--;
      }
      bestD[p] = d;
      bestI[p] = j;
    }
    return found;
  }

  /** Search the subtree under root (lower bound lb0) for the k-best list. */
  private search(
    root: number, lb0: number, i: number, px: number, py: number, pz: number, k: number, size: number,
    bestD: Float64Array, bestI: Int32Array, found: number,
  ): number {
    let sn = this.stackN, sd = this.stackD;
    let sp = 0;
    sn[sp] = root;
    sd[sp++] = lb0;
    while (sp > 0) {
      const node = sn[--sp];
      if (found === k && sd[sp] > bestD[k - 1]) continue;
      const r = this.right[node];
      if (r < 0) {
        found = this.scanLeaf(node, i, px, py, pz, k, size, bestD, bestI, found);
        continue;
      }
      if (sp + 2 > sn.length) {
        const nn = new Int32Array(sn.length * 2);
        nn.set(sn);
        const nd = new Float64Array(sd.length * 2);
        nd.set(sd);
        this.stackN = sn = nn;
        this.stackD = sd = nd;
      }
      const l = node + 1;
      const dL = this.lowerBound(px, py, pz, l, size);
      const dR = this.lowerBound(px, py, pz, r, size);
      const full = found === k;
      // Push the farther child first so the nearer one is searched first.
      if (dL <= dR) {
        if (!full || dR <= bestD[k - 1]) { sn[sp] = r; sd[sp++] = dR; }
        if (!full || dL <= bestD[k - 1]) { sn[sp] = l; sd[sp++] = dL; }
      } else {
        if (!full || dL <= bestD[k - 1]) { sn[sp] = l; sd[sp++] = dL; }
        if (!full || dR <= bestD[k - 1]) { sn[sp] = r; sd[sp++] = dR; }
      }
    }
    return found;
  }

  /** Recompute each node's shared component (children have larger ids, so go backwards). */
  labelNodes(label: Int32Array): void {
    const idx = this.idx;
    for (let node = this.nodes - 1; node >= 0; node--) {
      const r = this.right[node];
      if (r < 0) {
        let c = label[idx[this.lo[node]]];
        for (let q = this.lo[node] + 1; q < this.hi[node] && c >= 0; q++) {
          if (label[idx[q]] !== c) c = -1;
        }
        this.lab[node] = c;
      } else {
        const a = this.lab[node + 1];
        this.lab[node] = a >= 0 && a === this.lab[r] ? a : -1;
      }
    }
  }

  /** Lower bound on the squared ranking distance from point i to anything in node. Never
   *  above the rank2 of any point inside (rounding is monotonic; the slack covers the rest). */
  private lowerBound(px: number, py: number, pz: number, node: number, size: number): number {
    const box = this.box, o = 6 * node;
    let dx = Math.max(0, box[o] - px, px - box[o + 3]);
    let dy = Math.max(0, box[o + 1] - py, py - box[o + 4]);
    let dz = Math.max(0, box[o + 2] - pz, pz - box[o + 5]);
    if (size > 0) {
      dx = Math.min(dx, Math.max(0, size - Math.max(Math.abs(px - box[o]), Math.abs(px - box[o + 3]))));
      dy = Math.min(dy, Math.max(0, size - Math.max(Math.abs(py - box[o + 1]), Math.abs(py - box[o + 4]))));
      dz = Math.min(dz, Math.max(0, size - Math.max(Math.abs(pz - box[o + 2]), Math.abs(pz - box[o + 5]))));
    }
    return (dx * dx + dy * dy + dz * dz) * (1 - 1e-9);
  }

  /**
   * Offer every pair (i, j) with label[j] !== c that could beat component c's best (bestD[c],
   * then the lower index, then the higher) to that best. `size` > 0 means a torus of that side.
   */
  nearestForeign(
    i: number, c: number, label: Int32Array, size: number,
    bestD: Float64Array, bestI: Int32Array, bestJ: Int32Array,
    rank2: (a: number, b: number) => number,
  ): void {
    if (this.nodes === 0 || this.lab[0] === c) return;
    const pos = this.pos, idx = this.idx;
    const px = pos[3 * i], py = pos[3 * i + 1], pz = pos[3 * i + 2];
    let sn = this.stackN, sd = this.stackD;
    let sp = 0;
    sn[sp] = 0;
    sd[sp++] = this.lowerBound(px, py, pz, 0, size);
    while (sp > 0) {
      const node = sn[--sp];
      if (sd[sp] > bestD[c]) continue;
      const r = this.right[node];
      if (r < 0) {
        for (let q = this.lo[node]; q < this.hi[node]; q++) {
          const j = idx[q];
          if (label[j] === c) continue;
          const d = rank2(i, j);
          if (d > bestD[c]) continue;
          const lo = Math.min(i, j), hi = Math.max(i, j);
          const blo = Math.min(bestI[c], bestJ[c]), bhi = Math.max(bestI[c], bestJ[c]);
          // ties broken by the pair's indices, so the result is deterministic
          if (d < bestD[c] || (d === bestD[c] && (lo < blo || (lo === blo && hi < bhi)))) {
            bestD[c] = d;
            bestI[c] = i;
            bestJ[c] = j;
          }
        }
        continue;
      }
      if (sp + 2 > sn.length) {
        const nn = new Int32Array(sn.length * 2);
        nn.set(sn);
        const nd = new Float64Array(sd.length * 2);
        nd.set(sd);
        this.stackN = sn = nn;
        this.stackD = sd = nd;
      }
      const l = node + 1;
      const okL = this.lab[l] !== c, okR = this.lab[r] !== c;
      const dL = okL ? this.lowerBound(px, py, pz, l, size) : Infinity;
      const dR = okR ? this.lowerBound(px, py, pz, r, size) : Infinity;
      // Push the farther child first so the nearer one is searched first.
      if (dL <= dR) {
        if (okR && dR <= bestD[c]) { sn[sp] = r; sd[sp++] = dR; }
        if (okL && dL <= bestD[c]) { sn[sp] = l; sd[sp++] = dL; }
      } else {
        if (okL && dL <= bestD[c]) { sn[sp] = l; sd[sp++] = dL; }
        if (okR && dR <= bestD[c]) { sn[sp] = r; sd[sp++] = dR; }
      }
    }
  }
}
