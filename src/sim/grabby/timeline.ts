// Replays a SimResult's OwnershipEvents forwards and backwards from a cursor.

import type { SimResult, Timeline } from './types';

export function createTimeline(r: SimResult): Timeline {
  const events = r.events;
  const n = r.params.galaxies;
  const tEnd = r.params.tEndGyr;
  const owner = new Int32Array(n).fill(-1);
  const held = new Int32Array(r.civs.length);
  const changed = new Int32Array(n);
  const mark = new Int32Array(n);
  let markId = 0;
  let changedCount = 0;
  let cursor = 0; // events[0 .. cursor) are applied
  let t = 0;
  let claimed = 0;
  let alive = 0;

  const set = (g: number, from: number, to: number) => {
    owner[g] = to;
    if (from >= 0) {
      if (--held[from] === 0) alive--;
    } else claimed++;
    if (to >= 0) {
      if (held[to]++ === 0) alive++;
    } else claimed--;
    if (mark[g] !== markId) {
      mark[g] = markId;
      changed[changedCount++] = g;
    }
  };

  return {
    get t() {
      return t;
    },
    get claimed() {
      return claimed;
    },
    get alive() {
      return alive;
    },
    get changedCount() {
      return changedCount;
    },
    owner,
    held,
    changed,
    seek(target: number) {
      const to = Number.isFinite(target) ? Math.min(tEnd, Math.max(0, target)) : t;
      markId++;
      changedCount = 0;
      while (cursor < events.length && events[cursor].t <= to) {
        const e = events[cursor++];
        set(e.galaxy, e.prev, e.owner);
      }
      while (cursor > 0 && events[cursor - 1].t > to) {
        const e = events[--cursor];
        set(e.galaxy, e.owner, e.prev);
      }
      t = to;
    },
  };
}
