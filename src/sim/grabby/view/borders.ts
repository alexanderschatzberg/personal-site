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

export class BorderSet {
  /** Packed active slots; active[0 .. activeCount). */
  readonly active: Int32Array;
  /** Slot → its index in `active`, or -1. */
  readonly index: Int32Array;
  activeCount = 0;
  /** Draw indices whose slot or colour changed in the last sync (may include ≥ activeCount). */
  readonly dirty: Int32Array;
  dirtyCount = 0;
  /** Civ each slot is currently drawn for. */
  readonly shown: Int32Array;
  private inc: { offsets: Uint32Array; list: Uint32Array };
  private edgeMark: Uint32Array;
  private dirtyMark: Uint32Array;
  private epoch = 0;

  constructor(readonly edges: Uint32Array, n: number) {
    const slots = edges.length;
    this.active = new Int32Array(slots);
    this.index = new Int32Array(slots).fill(-1);
    this.shown = new Int32Array(slots).fill(-1);
    this.dirty = new Int32Array(slots);
    this.dirtyMark = new Uint32Array(slots);
    this.edgeMark = new Uint32Array(slots >> 1);
    this.inc = incidence(edges, n);
  }

  /** Bring the slots up to date. With `galaxies`, only edges touching the first `count` of them. */
  sync(owner: ArrayLike<number>, galaxies?: ArrayLike<number>, count = galaxies?.length ?? 0) {
    this.dirtyCount = 0;
    this.epoch++;
    if (!galaxies) {
      for (let e = 0; e < this.edgeMark.length; e++) this.updateEdge(e, owner);
      return;
    }
    const { offsets, list } = this.inc;
    for (let k = 0; k < count; k++) {
      const g = galaxies[k];
      for (let p = offsets[g]; p < offsets[g + 1]; p++) {
        const e = list[p];
        if (this.edgeMark[e] === this.epoch) continue;
        this.edgeMark[e] = this.epoch;
        this.updateEdge(e, owner);
      }
    }
  }

  private updateEdge(e: number, owner: ArrayLike<number>) {
    for (let slot = 2 * e; slot <= 2 * e + 1; slot++) {
      const want = slotOwner(this.edges, owner, slot);
      const at = this.index[slot];
      if (want < 0) {
        if (at >= 0) this.remove(slot);
      } else if (at < 0) {
        this.index[slot] = this.activeCount;
        this.active[this.activeCount] = slot;
        this.markDirty(this.activeCount++);
      } else if (this.shown[slot] !== want) this.markDirty(at);
      this.shown[slot] = want;
    }
  }

  private remove(slot: number) {
    const k = this.index[slot];
    const last = --this.activeCount;
    const moved = this.active[last];
    this.active[k] = moved;
    this.index[moved] = k;
    this.index[slot] = -1;
    if (k !== last) this.markDirty(k);
  }

  private markDirty(k: number) {
    if (this.dirtyMark[k] === this.epoch) return;
    this.dirtyMark[k] = this.epoch;
    this.dirty[this.dirtyCount++] = k;
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
