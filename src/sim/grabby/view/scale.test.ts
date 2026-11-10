// A quick check on real engine output (20k galaxies): incremental border syncs over a played
// timeline match a fresh rebuild, and the pick grid matches the brute-force pick.
import { describe, expect, it } from 'vitest';
import { simulate } from '../engine';
import { createTimeline } from '../timeline';
import { BorderSet, slotOwner } from './borders';
import { PICK_RADIUS_PX, pickOwned, pickOwnedNear, ScreenGrid } from './pick';

describe('view on a 20k run', () => {
  it('playback border syncs equal a rebuild; grid pick equals brute force', () => {
    const r = simulate({ galaxies: 20000, seed: 'scale' });
    const n = r.positions.length / 3;
    const tl = createTimeline(r);
    const b = new BorderSet(r.edges, n);
    b.sync(tl.owner);
    const steps = 300;
    for (let f = 1; f <= steps; f++) {
      tl.seek((r.tLast * f) / steps);
      b.sync(tl.owner, tl.changed, tl.changedCount);
    }
    const fresh = new BorderSet(r.edges, n);
    fresh.sync(tl.owner);
    const pairs = (s: BorderSet) => Array.from({ length: s.activeCount }, (_, k) => `${s.active[k]}:${s.civ[k]}`).sort();
    expect(b.activeCount).toBeGreaterThan(0);
    expect(pairs(b)).toEqual(pairs(fresh));
    for (let k = 0; k < b.activeCount; k++) expect(b.civ[k]).toBe(slotOwner(r.edges, tl.owner, b.active[k]));

    // 2d flat, top-down: screen = positions scaled into an 800 px square
    const L = r.params.sizeGly;
    const xy = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
      xy[2 * i] = (r.positions[3 * i] / L) * 800;
      xy[2 * i + 1] = 800 - (r.positions[3 * i + 1] / L) * 800;
    }
    const grid = new ScreenGrid(xy);
    tl.seek(r.tLast / 2);
    for (let q = 0; q < 400; q++) {
      const x = (q * 37) % 800, y = (q * 101) % 800;
      expect(pickOwnedNear(grid, xy, null, tl.owner, x, y, PICK_RADIUS_PX)).toBe(pickOwned(xy, null, tl.owner, x, y, PICK_RADIUS_PX));
    }
  });
});
