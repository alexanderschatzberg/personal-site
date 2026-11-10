// Marching cubes over a Field window (pure). The triangle table is generated here rather than
// typed in: for each of the 256 corner sign patterns, the cut edges are joined face by face into
// closed loops, which are fanned into triangles. On an ambiguous face (two diagonal corners
// inside) the inside corners are always kept apart; the rule depends only on the face's own four
// corners, so two cells sharing a face always agree and the surface is watertight.
//
// Vertices sit on cell edges by linear interpolation; normals are the interpolated field gradient
// (central differences), pointing out of the inside (field > iso). On a periodic grid each cell's
// position is taken from its grid index in [0, G), so a surface that crosses a face of the cube is
// cut there and shows on both sides.
import type { Axis, Field } from './shellfield';

/** Corner c of a cell is at (c & 1, (c >> 1) & 1, (c >> 2) & 1). */
const CORNER = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => [c & 1, (c >> 1) & 1, (c >> 2) & 1]);
/** Edges as (lower corner, upper corner); the axis is the one bit they differ in. */
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
/** Faces as 4 corners in cyclic order. */
const FACES = [
  [0, 2, 6, 4], [1, 3, 7, 5],
  [0, 1, 5, 4], [2, 3, 7, 6],
  [0, 1, 3, 2], [4, 5, 7, 6],
];

/** The axis (0 x, 1 y, 2 z) each edge runs along. */
const EDGE_AXIS = EDGES.map(([p, q]) => [1, 2, 4].indexOf(p ^ q));

function edgeOf(a: number, b: number): number {
  return EDGES.findIndex(([p, q]) => (p === a && q === b) || (p === b && q === a));
}

/** Triangles (edge indices, 3 per triangle) for corner sign pattern cfg (bit c set = corner c inside). */
export function cubeTriangles(cfg: number): number[] {
  const inside = (c: number) => ((cfg >> c) & 1) === 1;
  const nb: number[][] = Array.from({ length: 12 }, () => []);
  const link = (e: number, f: number) => {
    nb[e].push(f);
    nb[f].push(e);
  };
  for (const q of FACES) {
    const e = [0, 1, 2, 3].map((i) => edgeOf(q[i], q[(i + 1) % 4]));
    const cut = [0, 1, 2, 3].filter((i) => inside(q[i]) !== inside(q[(i + 1) % 4]));
    if (cut.length === 2) link(e[cut[0]], e[cut[1]]);
    else if (cut.length === 4) {
      // Diagonal: cut off each inside corner q[i] by joining its two edges e[i − 1] and e[i].
      for (let i = 0; i < 4; i++) if (inside(q[i])) link(e[(i + 3) % 4], e[i]);
    }
  }
  const out: number[] = [];
  const seen = new Array(12).fill(false);
  for (let s = 0; s < 12; s++) {
    if (seen[s] || nb[s].length === 0) continue;
    const loop: number[] = [];
    let prev = -1, cur = s;
    do {
      loop.push(cur);
      seen[cur] = true;
      const next = nb[cur][0] !== prev ? nb[cur][0] : nb[cur][1];
      prev = cur;
      cur = next;
    } while (cur !== s);
    for (let i = 1; i + 1 < loop.length; i++) out.push(loop[0], loop[i], loop[i + 1]);
  }
  return out;
}

/** The table, flattened: triangles of cfg are TRI[TRI_START[cfg] .. TRI_START[cfg + 1]). */
const TRI_START = new Int32Array(257);
const TRI: Int8Array = (() => {
  const all: number[] = [];
  for (let c = 0; c < 256; c++) {
    TRI_START[c] = all.length;
    all.push(...cubeTriangles(c));
  }
  TRI_START[256] = all.length;
  return Int8Array.from(all);
})();

/** Growable triangle soup: xyz positions and normals, 3 vertices per triangle. */
export class Mesh {
  private pos = new Float32Array(3 * 4096);
  private nrm = new Float32Array(3 * 4096);
  /** Per vertex: the grid edge it lies on (see extract), so equal keys = the same vertex. */
  private key = new Int32Array(4096);
  count = 0; // floats written

  push(x: number, y: number, z: number, nx: number, ny: number, nz: number, key = -1) {
    if (this.count + 3 > this.pos.length) {
      const p = new Float32Array(this.pos.length * 2), n = new Float32Array(this.pos.length * 2), k = new Int32Array(this.key.length * 2);
      p.set(this.pos);
      n.set(this.nrm);
      k.set(this.key);
      this.pos = p;
      this.nrm = n;
      this.key = k;
    }
    const i = this.count;
    this.key[i / 3] = key;
    this.pos[i] = x;
    this.pos[i + 1] = y;
    this.pos[i + 2] = z;
    this.nrm[i] = nx;
    this.nrm[i + 1] = ny;
    this.nrm[i + 2] = nz;
    this.count += 3;
  }

  /** The vertex keys written so far (a view, valid until the next push or take). */
  keys(): Int32Array {
    return this.key.subarray(0, this.count / 3);
  }

  /** Copies of what was written (exact length), and start over. */
  take(): { positions: Float32Array; normals: Float32Array } {
    const out = { positions: this.pos.slice(0, this.count), normals: this.nrm.slice(0, this.count) };
    this.count = 0;
    return out;
  }
}

/** Local index i on an axis of length m, wrapped if the axis wraps, else −1 outside. */
function at(i: number, m: number, wrap: boolean): number {
  if (i >= 0 && i < m) return i;
  if (!wrap) return -1;
  return i < 0 ? i + m : i - m;
}

/**
 * Append the iso-surface (field = iso, inside = field > iso) of f to mesh. Grid point g on an axis
 * is drawn at (g − margin)·h. Returns the number of triangles added. Each vertex's key is its
 * grid edge, ((z·(G+1) + y)·(G+1) + x)·3 + axis for the edge's lower end (x, y, z) ∈ [0, G]³ as
 * drawn, so on a periodic grid the two sides of a cut get different keys.
 */
export function extract(f: Field, iso: number, h: number, margin: number, mesh: Mesh): number {
  const { data, G, periodic } = f;
  const [ax, ay, az] = f.ax;
  const mx = ax.m, my = ay.m, mz = az.m;
  const sy = mx, sz = mx * my;
  const cells = (a: Axis) => (a.wrap ? a.m : a.m - 1);
  const cx = cells(ax), cy = cells(ay), cz = cells(az);
  const gIndex = (a: Axis, i: number) => (periodic ? (a.o + i) % G : a.o + i);
  const val = (i: number, j: number, k: number) => {
    const a = at(i, mx, ax.wrap), b = at(j, my, ay.wrap), c = at(k, mz, az.wrap);
    return a < 0 || b < 0 || c < 0 ? 0 : data[c * sz + b * sy + a];
  };
  const v = new Float64Array(8);
  const li = [0, 0], lj = [0, 0], lk = [0, 0];
  const grad = new Float64Array(6);
  const before = mesh.count;
  const G1 = G + 1;
  for (let c = 0; c < cz; c++) {
    lk[0] = c;
    lk[1] = c + 1 === mz ? 0 : c + 1;
    const gz = gIndex(az, c) - margin;
    for (let b = 0; b < cy; b++) {
      lj[0] = b;
      lj[1] = b + 1 === my ? 0 : b + 1;
      const gy = gIndex(ay, b) - margin;
      const r00 = lk[0] * sz + lj[0] * sy, r10 = lk[0] * sz + lj[1] * sy, r01 = lk[1] * sz + lj[0] * sy, r11 = lk[1] * sz + lj[1] * sy;
      for (let a = 0; a < cx; a++) {
        const a0 = a, a1 = a + 1 === mx ? 0 : a + 1;
        v[0] = data[r00 + a0];
        v[1] = data[r00 + a1];
        v[2] = data[r10 + a0];
        v[3] = data[r10 + a1];
        v[4] = data[r01 + a0];
        v[5] = data[r01 + a1];
        v[6] = data[r11 + a0];
        v[7] = data[r11 + a1];
        let cfg = 0;
        for (let q = 0; q < 8; q++) if (v[q] > iso) cfg |= 1 << q;
        if (cfg === 0 || cfg === 255) continue;
        li[0] = a0;
        li[1] = a1;
        const gx = gIndex(ax, a) - margin;
        const kBase = ((gz + margin) * G1 + gy + margin) * G1 + gx + margin;
        for (let t = TRI_START[cfg]; t < TRI_START[cfg + 1]; t++) {
          const [p, q] = EDGES[TRI[t]];
          const s = (iso - v[p]) / (v[q] - v[p]);
          const P = CORNER[p], Q = CORNER[q];
          // Position: lower corner + s along the edge's axis (integer parts first, so a vertex
          // shared with the neighbouring cell gets the very same floats).
          const x = (gx + P[0] + (Q[0] - P[0]) * s) * h;
          const y = (gy + P[1] + (Q[1] - P[1]) * s) * h;
          const z = (gz + P[2] + (Q[2] - P[2]) * s) * h;
          // Gradient at both ends (local indices; neighbours via val so windows and wraps apply).
          for (let e = 0; e < 2; e++) {
            const C = e ? Q : P;
            const i = li[C[0]], j = lj[C[1]], k = lk[C[2]];
            grad[3 * e] = val(i + 1, j, k) - val(i - 1, j, k);
            grad[3 * e + 1] = val(i, j + 1, k) - val(i, j - 1, k);
            grad[3 * e + 2] = val(i, j, k + 1) - val(i, j, k - 1);
          }
          let nx = -(grad[0] + (grad[3] - grad[0]) * s), ny = -(grad[1] + (grad[4] - grad[1]) * s), nz = -(grad[2] + (grad[5] - grad[2]) * s);
          const len = Math.hypot(nx, ny, nz);
          if (len > 0) {
            nx /= len;
            ny /= len;
            nz /= len;
          } else nz = 1;
          mesh.push(x, y, z, nx, ny, nz, 3 * (kBase + (P[2] * G1 + P[1]) * G1 + P[0]) + EDGE_AXIS[TRI[t]]);
        }
      }
    }
  }
  return (mesh.count - before) / 9;
}
