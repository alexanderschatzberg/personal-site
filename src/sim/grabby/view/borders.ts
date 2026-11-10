// Borders between civs, and between a civ and unclaimed space, drawn on the neighbour graph.
// Every edge (i, j) has two slots: slot 2k is drawn for i's owner, 2k + 1 for j's owner. A slot
// is active when the edge's ends have different owners and its own side is owned. Active
// slots are packed at the front of `active` so the GPU draw range is just `activeCount`.
import type { Params } from '../types';

export type Space = Pick<Params, 'dim' | 'geometry' | 'sizeGly'>;

/** Segment length as a fraction of the edge length. */
export const SEGMENT_FRACTION = 0.6;
/** How far the segment sits from the edge midpoint toward its owner, as a fraction of the edge. */
export const OWNER_OFFSET = 0.1;
/** Lift above the sphere surface so borders are not hidden by the occluder. */
const SPHERE_LIFT = 1.004;

/** CSR index: the edges incident to galaxy g are list[offsets[g] .. offsets[g+1]). */
export function incidence(edges: Uint32Array, n: number) {
  const offsets = new Uint32Array(n + 1);
  for (let k = 0; k < edges.length; k++) offsets[edges[k] + 1]++;
  for (let g = 0; g < n; g++) offsets[g + 1] += offsets[g];
  const fill = offsets.slice(0, n);
  const list = new Uint32Array(edges.length);
  for (let k = 0; k < edges.length; k++) list[fill[edges[k]]++] = k >> 1;
  return { offsets, list };
}

/** The civ a slot is drawn for, or -1 if the slot draws nothing. */
export function slotOwner(edges: Uint32Array, owner: ArrayLike<number>, slot: number): number {
  const e = slot >> 1;
  const oi = owner[edges[2 * e]], oj = owner[edges[2 * e + 1]];
  if (oi === oj) return -1;
  return slot & 1 ? oj : oi;
}

/** Starting length of the packed (per draw index) arrays; they double as borders appear. */
const PACKED_START = 1024;

/**
 * Memory: one Int32 per slot (`index`) plus the incidence index (one Uint32 per edge end), about
 * 16 bytes per edge. Everything else is per active slot and grows on demand, since only edges
 * on a border are ever active.
 */
export class BorderSet {
  /** The pairs that can carry a border (SimResult.edges without its bridges). */
  readonly edges: Uint32Array;
  /** Slot → its index in `active`, or -1. */
  readonly index: Int32Array;
  activeCount = 0;
  dirtyCount = 0;
  /** Packed active slots; active[0 .. activeCount). */
  private _active = new Int32Array(PACKED_START);
  /** Civ drawn at each draw index (same order as `active`). */
  private _civ = new Int32Array(PACKED_START);
  /** Draw indices whose slot or colour changed in the last sync (may include ≥ activeCount). */
  private _dirty = new Int32Array(PACKED_START);
  /** Per draw index: the sync epoch it was last marked dirty in. */
  private dirtyMark = new Uint32Array(PACKED_START);
  private inc: { offsets: Uint32Array; list: Uint32Array };
  private epoch = 0;

  /** `edges` as in SimResult; its last `nBridges` pairs are bridges and never get a border, so
   *  the set keeps only the pairs before them. */
  constructor(edges: Uint32Array, n: number, nBridges = 0) {
    this.edges = edges.subarray(0, edges.length - 2 * Math.max(0, Math.min(nBridges, edges.length >> 1)));
    this.index = new Int32Array(this.edges.length).fill(-1);
    this.inc = incidence(this.edges, n);
  }

  get active(): Int32Array {
    return this._active;
  }
  get civ(): Int32Array {
    return this._civ;
  }
  get dirty(): Int32Array {
    return this._dirty;
  }

  /** Bytes held by this set's arrays (not counting `edges`). */
  get byteLength(): number {
    return [this.index, this._active, this._civ, this._dirty, this.dirtyMark, this.inc.offsets, this.inc.list].reduce((s, a) => s + a.byteLength, 0);
  }

  /** Bring the slots up to date. With `galaxies`, only edges touching the first `count` of them.
   *  An edge reached from both of its ends is simply updated twice; the second time is a no-op. */
  sync(owner: ArrayLike<number>, galaxies?: ArrayLike<number>, count = galaxies?.length ?? 0) {
    this.dirtyCount = 0;
    this.epoch++;
    if (!galaxies) {
      for (let e = 0; e < this.edges.length >> 1; e++) this.updateEdge(e, owner);
      return;
    }
    const { offsets, list } = this.inc;
    for (let k = 0; k < count; k++) {
      const g = galaxies[k];
      for (let p = offsets[g]; p < offsets[g + 1]; p++) this.updateEdge(list[p], owner);
    }
  }

  private updateEdge(e: number, owner: ArrayLike<number>) {
    for (let slot = 2 * e; slot <= 2 * e + 1; slot++) {
      const want = slotOwner(this.edges, owner, slot);
      const at = this.index[slot];
      if (want < 0) {
        if (at >= 0) this.remove(slot);
      } else if (at < 0) {
        if (this.activeCount === this._active.length) this.grow();
        const k = this.activeCount++;
        this.index[slot] = k;
        this._active[k] = slot;
        this._civ[k] = want;
        this.markDirty(k);
      } else if (this._civ[at] !== want) {
        this._civ[at] = want;
        this.markDirty(at);
      }
    }
  }

  private remove(slot: number) {
    const k = this.index[slot];
    const last = --this.activeCount;
    const moved = this._active[last];
    this._active[k] = moved;
    this._civ[k] = this._civ[last];
    this.index[moved] = k;
    this.index[slot] = -1;
    if (k !== last) this.markDirty(k);
  }

  private markDirty(k: number) {
    if (this.dirtyMark[k] === this.epoch) return;
    this.dirtyMark[k] = this.epoch;
    this._dirty[this.dirtyCount++] = k;
  }

  /** Double the packed arrays (keeping their contents). */
  private grow() {
    const cap = Math.min(this.index.length, 2 * this._active.length);
    const bigger = <T extends Int32Array | Uint32Array>(a: T): T => {
      const b = new (a.constructor as new (n: number) => T)(cap);
      b.set(a);
      return b;
    };
    this._active = bigger(this._active);
    this._civ = bigger(this._civ);
    this._dirty = bigger(this._dirty);
    this.dirtyMark = bigger(this.dirtyMark);
  }
}

/**
 * Where a slot's border sits, in the same (uncentred, comoving) coordinates as `positions`:
 * out = [cx, cy, cz, dx, dy, dz, len], with d the unit edge direction from the owner's galaxy
 * toward the other one and len the edge length. On a torus the edge is the minimum image, so
 * a wrapping edge is drawn next to the owner's galaxy instead of across the map.
 */
export function slotFrame(positions: ArrayLike<number>, edges: Uint32Array, slot: number, space: Space, out: Float64Array | Float32Array) {
  const e = slot >> 1;
  const own = edges[2 * e + (slot & 1)], other = edges[2 * e + 1 - (slot & 1)];
  const L = space.sizeGly;
  const torus = space.geometry === 'torus';
  const axes = space.dim === 3 ? 3 : 2;
  let len2 = 0;
  const a = [0, 0, 0], d = [0, 0, 0];
  for (let x = 0; x < 3; x++) {
    a[x] = positions[3 * own + x];
    let v = positions[3 * other + x] - a[x];
    if (torus && x < axes) v -= L * Math.round(v / L);
    d[x] = v;
    len2 += v * v;
  }
  const len = Math.sqrt(len2);
  if (len > 0) for (let x = 0; x < 3; x++) d[x] /= len;
  else d[0] = 1;
  const along = len * (0.5 - OWNER_OFFSET);
  for (let x = 0; x < 3; x++) out[x] = a[x] + d[x] * along;
  if (space.geometry === 'sphere') {
    const R = Math.hypot(a[0], a[1], a[2]);
    const r = Math.hypot(out[0], out[1], out[2]) || 1;
    for (let x = 0; x < 3; x++) out[x] *= (R * SPHERE_LIFT) / r;
  }
  out[3] = d[0];
  out[4] = d[1];
  out[5] = d[2];
  out[6] = len;
}

/** Line segment endpoints [x0,y0,z0, x1,y1,z1] for a frame: perpendicular to the edge, in the
 *  plane for 2d and tangent to the surface on the sphere. */
export function slotSegment(frame: ArrayLike<number>, space: Space, out: Float64Array | Float32Array) {
  const [cx, cy, cz, dx, dy, dz, len] = [frame[0], frame[1], frame[2], frame[3], frame[4], frame[5], frame[6]];
  let px: number, py: number, pz: number;
  if (space.geometry === 'sphere') {
    // c × d: perpendicular to both the radial direction and the edge.
    px = cy * dz - cz * dy;
    py = cz * dx - cx * dz;
    pz = cx * dy - cy * dx;
  } else {
    px = -dy;
    py = dx;
    pz = 0;
  }
  const pl = Math.hypot(px, py, pz) || 1;
  const h = (SEGMENT_FRACTION * len) / 2 / pl;
  out[0] = cx - px * h;
  out[1] = cy - py * h;
  out[2] = cz - pz * h;
  out[3] = cx + px * h;
  out[4] = cy + py * h;
  out[5] = cz + pz * h;
}
