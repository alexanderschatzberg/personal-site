// TEMP stub so the page can run before the real timeline lands. Replaced at merge.
import type { SimResult, Timeline } from './types';

export function createTimeline(r: SimResult): Timeline {
  const n = r.positions.length / 3, ev = r.events;
  const owner = new Int32Array(n).fill(-1), held = new Int32Array(r.civs.length), changed = new Int32Array(n);
  let t = 0, i = 0, claimed = 0, alive = 0, changedCount = 0;
  const mark = new Uint8Array(n);
  const set = (g: number, from: number, to: number) => {
    if (from >= 0 && --held[from] === 0) alive--;
    if (to >= 0 && held[to]++ === 0) alive++;
    if (from < 0 && to >= 0) claimed++;
    if (from >= 0 && to < 0) claimed--;
    owner[g] = to;
    if (!mark[g]) { mark[g] = 1; changed[changedCount++] = g; }
  };
  return {
    get t() { return t; },
    seek(to: number) {
      for (let k = 0; k < changedCount; k++) mark[changed[k]] = 0;
      changedCount = 0;
      t = Math.min(Math.max(to, 0), r.params.tEndGyr);
      while (i < ev.length && ev[i].t <= t) { set(ev[i].galaxy, ev[i].prev, ev[i].owner); i++; }
      while (i > 0 && ev[i - 1].t > t) { i--; set(ev[i].galaxy, ev[i].owner, ev[i].prev); }
    },
    owner, held, changed,
    get claimed() { return claimed; },
    get alive() { return alive; },
    get changedCount() { return changedCount; },
  };
}
