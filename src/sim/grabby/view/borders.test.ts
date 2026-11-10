import { describe, expect, it } from 'vitest';
import { BorderSet, incidence, slotFrame, slotOwner, slotSegment, SEGMENT_FRACTION, type Space } from './borders';

const u32 = (...a: number[]) => Uint32Array.from(a);
const i32 = (...a: number[]) => Int32Array.from(a);

/** Active (slot → civ) pairs, as a sorted list, for comparing states. */
function activePairs(b: BorderSet, owner: Int32Array) {
  const out: string[] = [];
  for (let k = 0; k < b.activeCount; k++) {
    const slot = b.active[k];
    out.push(`${slot}:${slotOwner(b.edges, owner, slot)}`);
  }
  return out.sort();
}

describe('border selection', () => {
  // 0 - 1 - 2 - 3, plus 0 - 2
  const edges = u32(0, 1, 1, 2, 2, 3, 0, 2);

  it('indexes the edges incident to each galaxy', () => {
    const { offsets, list } = incidence(edges, 4);
    const of = (g: number) => Array.from(list.slice(offsets[g], offsets[g + 1])).sort();
    expect(of(0)).toEqual([0, 3]);
    expect(of(1)).toEqual([0, 1]);
    expect(of(2)).toEqual([1, 2, 3]);
    expect(of(3)).toEqual([2]);
  });

  it('draws one segment per owned side of every edge whose ends differ', () => {
    const owner = i32(0, 0, 1, -1);
    const b = new BorderSet(edges, 4);
    b.sync(owner);
    // edge0 (0,1): same owner → none. edge1 (1,2): 0|1 → both sides. edge2 (2,3): 1|nobody → side 0
    // only. edge3 (0,2): 0|1 → both sides. Slot = 2·edge + side.
    expect(activePairs(b, owner)).toEqual(['2:0', '3:1', '4:1', '6:0', '7:1'].sort());
    expect(slotOwner(edges, owner, 5)).toBe(-1); // the unowned side draws nothing
  });

  it('nothing owned or all one civ → no borders', () => {
    const b = new BorderSet(edges, 4);
    b.sync(i32(-1, -1, -1, -1));
    expect(b.activeCount).toBe(0);
    b.sync(i32(2, 2, 2, 2));
    expect(b.activeCount).toBe(0);
  });

  it('an incremental sync over the changed galaxies equals a full rebuild', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const n = 60;
    const e: number[] = [];
    for (let i = 0; i < n; i++) for (const d of [1, 2, 7]) if (i + d < n) e.push(i, i + d);
    const E = Uint32Array.from(e);
    const owner = new Int32Array(n).fill(-1);
    const inc = new BorderSet(E, n);
    inc.sync(owner);
    for (let round = 0; round < 200; round++) {
      const changed = Int32Array.from({ length: 1 + Math.floor(rand() * 4) }, () => Math.floor(rand() * n));
      for (const g of changed) owner[g] = Math.floor(rand() * 4) - 1;
      inc.sync(owner, changed, changed.length);
      const fresh = new BorderSet(E, n);
      fresh.sync(owner);
      expect(activePairs(inc, owner)).toEqual(activePairs(fresh, owner));
      // packed: every active slot knows its index
      for (let k = 0; k < inc.activeCount; k++) expect(inc.index[inc.active[k]]).toBe(k);
    }
  });

  it('reports which draw indices need rewriting after a sync', () => {
    const owner = i32(0, 0, 1, -1);
    const b = new BorderSet(edges, 4);
    b.sync(owner);
    owner[3] = 1; // edge2 (2,3) now 1|1 → its slot leaves; a later slot may move into its place
    b.sync(owner, i32(3), 1);
    for (let k = 0; k < b.dirtyCount; k++) expect(b.dirty[k]).toBeLessThan(b.activeCount + 1);
    const moved = Array.from(b.dirty.slice(0, b.dirtyCount));
    // whatever now sits at a rewritten index must be among the active slots
    expect(moved.filter((k) => k < b.activeCount).every((k) => b.active[k] >= 0)).toBe(true);
    expect(activePairs(b, owner)).toEqual(['2:0', '3:1', '6:0', '7:1'].sort());
  });
});

describe('border geometry', () => {
  const frame = new Float64Array(7);
  const seg = new Float64Array(6);

  it('2d: perpendicular to the edge, ~0.6 × its length, offset toward the owner', () => {
    const pos = Float32Array.from([0, 0, 0, 4, 0, 0]);
    const space: Space = { dim: 2, geometry: 'flat', sizeGly: 10 };
    slotFrame(pos, u32(0, 1), 0, space, frame); // galaxy 0's side
    expect(frame[0]).toBeLessThan(2); // centre between owner and midpoint
    expect(frame[0]).toBeGreaterThan(1);
    slotSegment(frame, space, seg);
    expect(seg[0]).toBeCloseTo(seg[3]); // vertical: perpendicular to the x-axis edge
    expect(Math.abs(seg[1] - seg[4])).toBeCloseTo(SEGMENT_FRACTION * 4);
    slotFrame(pos, u32(0, 1), 1, space, frame); // galaxy 1's side sits nearer galaxy 1
    expect(frame[0]).toBeGreaterThan(2);
  });

  it('torus: a wrapping edge draws near each owner, never across the map', () => {
    const L = 10;
    const pos = Float32Array.from([0.5, 5, 0, 9.5, 5, 0]);
    const space: Space = { dim: 2, geometry: 'torus', sizeGly: L };
    for (const side of [0, 1]) {
      slotFrame(pos, u32(0, 1), side, space, frame);
      slotSegment(frame, space, seg);
      const ownX = side === 0 ? 0.5 : 9.5;
      expect(Math.abs(seg[0] - ownX), `side ${side}`).toBeLessThan(1);
      expect(Math.abs(seg[3] - ownX), `side ${side}`).toBeLessThan(1);
      expect(Math.abs(seg[0] - seg[3])).toBeLessThan(1e-9);
      expect(frame[6]).toBeCloseTo(1); // the min-image edge length, not 9
    }
  });

  it('torus wraps in 3d as well', () => {
    const pos = Float32Array.from([5, 5, 0.2, 5, 5, 9.8]);
    slotFrame(pos, u32(0, 1), 0, { dim: 3, geometry: 'torus', sizeGly: 10 }, frame);
    expect(frame[6]).toBeCloseTo(0.4, 5);
    expect(frame[5]).toBeCloseTo(-1); // direction points down through the wrap
  });

  it('sphere: the segment is tangent to the surface, at the surface', () => {
    const R = 3;
    const a = [R, 0, 0], b = [R * Math.cos(0.2), R * Math.sin(0.2), 0];
    const pos = Float32Array.from([...a, ...b]);
    const space: Space = { dim: 2, geometry: 'sphere', sizeGly: 2 * Math.PI * R };
    slotFrame(pos, u32(0, 1), 0, space, frame);
    expect(Math.hypot(frame[0], frame[1], frame[2])).toBeCloseTo(R, 1);
    slotSegment(frame, space, seg);
    const dir = [seg[3] - seg[0], seg[4] - seg[1], seg[5] - seg[2]];
    const radial = [frame[0], frame[1], frame[2]];
    const dot = dir[0] * radial[0] + dir[1] * radial[1] + dir[2] * radial[2];
    expect(Math.abs(dot) / (Math.hypot(...dir) * R)).toBeLessThan(1e-6);
    // perpendicular to the edge too
    const ed = dir[0] * frame[3] + dir[1] * frame[4] + dir[2] * frame[5];
    expect(Math.abs(ed)).toBeLessThan(1e-6);
  });
});

describe('border set at scale', () => {
  it('costs about 16 bytes per edge (index + incidence) while few borders are active', () => {
    const n = 200000;
    const e = new Uint32Array(2 * 3 * n);
    let m = 0;
    for (let i = 0; i < n; i++)
      for (const d of [1, 17, 401]) {
        e[m++] = i;
        e[m++] = (i + d) % n;
      }
    const E = e.length / 2;
    const b = new BorderSet(e, n);
    const owner = new Int32Array(n).fill(-1);
    for (let g = 0; g < 500; g++) owner[g] = 1;
    b.sync(owner);
    expect(b.activeCount).toBeGreaterThan(0);
    expect(b.byteLength).toBeLessThanOrEqual(16 * E + 4 * (n + 1) + (1 << 16));
  });

  it('civ[k] is the civ drawn at draw index k, after any mix of syncs', () => {
    let seed = 3;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const n = 300;
    const e: number[] = [];
    for (let i = 0; i < n; i++) for (const d of [1, 5, 31]) if (i + d < n) e.push(i, i + d);
    const E = Uint32Array.from(e);
    const owner = new Int32Array(n).fill(-1);
    const b = new BorderSet(E, n);
    b.sync(owner);
    for (let round = 0; round < 300; round++) {
      // sometimes a big change, so the packed arrays have to grow
      const count = round % 50 === 0 ? n : 1 + Math.floor(rand() * 6);
      const changed = Int32Array.from({ length: count }, () => Math.floor(rand() * n));
      for (const g of changed) owner[g] = Math.floor(rand() * 5) - 1;
      b.sync(owner, changed, changed.length);
      for (let k = 0; k < b.activeCount; k++) expect(b.civ[k]).toBe(slotOwner(E, owner, b.active[k]));
    }
  });
});
