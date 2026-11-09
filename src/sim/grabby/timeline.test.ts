import { describe, expect, it } from 'vitest';
import { simulate } from './engine';
import { createTimeline } from './timeline';
import type { SimResult, Timeline } from './types';

const r: SimResult = simulate({
  galaxies: 1500,
  sizeGly: 60,
  pLife: 1e-20,
  tEndGyr: 120,
  temperMean: 0.8,
  seed: 'tl',
});

function sum(a: Int32Array): number {
  let s = 0;
  for (const x of a) s += x;
  return s;
}

/** Recompute everything from scratch to check the incremental counters. */
function check(tl: Timeline): void {
  expect(sum(tl.held)).toBe(tl.claimed);
  let claimed = 0;
  const held = new Int32Array(r.civs.length);
  for (const o of tl.owner) {
    if (o >= 0) {
      claimed++;
      held[o]++;
    }
  }
  expect(tl.claimed).toBe(claimed);
  expect(Array.from(tl.held)).toEqual(Array.from(held));
  expect(tl.alive).toBe(Array.from(held).filter((h) => h > 0).length);
}

describe('timeline', () => {
  it('starts at t = 0 with nobody owning anything', () => {
    const tl = createTimeline(r);
    expect(tl.t).toBe(0);
    expect(tl.owner.length).toBe(r.params.galaxies);
    expect(tl.owner.every((o) => o === -1)).toBe(true);
    expect(tl.held.length).toBe(r.civs.length);
    expect(tl.claimed).toBe(0);
    expect(tl.alive).toBe(0);
  });

  it('seek to t, then 0, then t matches a fresh timeline seeking to t', () => {
    expect(r.events.some((e) => e.kind === 'conquer')).toBe(true);
    const tMid = r.events[Math.floor(r.events.length * 0.7)].t;
    const a = createTimeline(r);
    a.seek(tMid);
    check(a);
    const firstPass = Array.from(a.owner);
    expect(a.claimed).toBeGreaterThan(0);
    a.seek(0);
    check(a);
    expect(a.claimed).toBe(0);
    a.seek(tMid);
    check(a);
    const fresh = createTimeline(r);
    fresh.seek(tMid);
    expect(Array.from(a.owner)).toEqual(Array.from(fresh.owner));
    expect(Array.from(a.owner)).toEqual(firstPass);
    expect(Array.from(a.held)).toEqual(Array.from(fresh.held));
    expect(a.alive).toBe(fresh.alive);
  });

  it('applies exactly the events with e.t <= t and clamps t', () => {
    const tl = createTimeline(r);
    const e = r.events[100];
    tl.seek(e.t);
    const expected = new Int32Array(r.params.galaxies).fill(-1);
    for (const x of r.events) if (x.t <= e.t) expected[x.galaxy] = x.owner;
    expect(Array.from(tl.owner)).toEqual(Array.from(expected));
    tl.seek(1e9);
    expect(tl.t).toBe(r.params.tEndGyr);
    check(tl);
    tl.seek(-5);
    expect(tl.t).toBe(0);
    check(tl);
  });

  it('reports the galaxies that changed in the last seek, each once', () => {
    const tl = createTimeline(r);
    const t1 = r.events[200].t;
    tl.seek(t1);
    const before = Array.from(tl.owner);
    const t2 = r.events[400].t;
    tl.seek(t2);
    const changed = Array.from(tl.changed.subarray(0, tl.changedCount));
    expect(new Set(changed).size).toBe(changed.length);
    const diff = before.map((o, g) => (o !== tl.owner[g] ? g : -1)).filter((g) => g >= 0);
    for (const g of diff) expect(changed).toContain(g);
    // stepping back reports the same galaxies
    tl.seek(t1);
    const back = Array.from(tl.changed.subarray(0, tl.changedCount));
    for (const g of diff) expect(back).toContain(g);
    expect(Array.from(tl.owner)).toEqual(before);
  });
});
