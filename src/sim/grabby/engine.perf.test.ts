// Round 5 (criteria 35, 36): engine speed and memory at up to a million galaxies.
// These runs are slow by nature (seconds each), so the vitest timeouts are generous; the
// assertions are the plan's thresholds, measured in Node.

import { describe, expect, it } from 'vitest';
import { simulate, simulateWithProgress } from './engine';
import type { Params } from './types';

function timed(p: Partial<Params>): { ms: number; civs: number } {
  const t0 = performance.now();
  const r = simulate(p);
  const ms = performance.now() - t0;
  return { ms, civs: r.civs.length };
}

describe('engine speed at scale (criterion 35)', () => {
  const cases: [string, Partial<Params>, number][] = [
    ['2d 500k', { galaxies: 500000 }, 6000],
    ['2d 1M', { galaxies: 1000000 }, 15000],
    ['3d 1M', { dim: 3, galaxies: 1000000 }, 15000],
    ['sphere 500k', { geometry: 'sphere', galaxies: 500000 }, 8000],
  ];
  for (const [name, p, limit] of cases) {
    it(`${name} with the defaults finishes in ≤ ${limit / 1000} s`, () => {
      const { ms, civs } = timed(p);
      console.log(`${name}: ${ms.toFixed(0)} ms, ${civs} civs`);
      expect(ms).toBeLessThanOrEqual(limit);
    }, 600000);
  }
});

describe('progress reporting', () => {
  it('simulateWithProgress reports stages in order with fractions in [0, 1], ending at done', () => {
    const calls: [string, number][] = [];
    const r = simulateWithProgress({ galaxies: 20000 }, (stage, frac) => calls.push([stage, frac]));
    expect(calls.length).toBeGreaterThan(3);
    for (const [, f] of calls) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    expect(calls[calls.length - 1]).toEqual(['done', 1]);
    // Overall fraction never goes backwards.
    for (let i = 1; i < calls.length; i++) expect(calls[i][1]).toBeGreaterThanOrEqual(calls[i - 1][1]);
    // Same result as simulate.
    const s = simulate({ galaxies: 20000 });
    expect(r.events).toEqual(s.events);
    expect(r.edges).toEqual(s.edges);
  });
});
