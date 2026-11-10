// Criterion 53: one shell job at the 3d default (100k galaxies, ~20 civs, G = 48) takes ≤ 50 ms
// in Node. Uses a real engine run, timed at TIMES evenly spaced times up to tLast (territories
// grow and touch late, so late snapshots are the costly ones), and the worst of those must be
// ≤ 50 ms. Each time is the minimum of RUNS jobs, so one slowed by a parallel test file doesn't
// fail it. Also reported, not asserted (the job runs off the main thread): full coverage, every
// galaxy owned by its nearest civ origin, far beyond what a default run reaches.
import { describe, expect, it } from 'vitest';
import { simulate } from '../engine';
import { createTimeline } from '../timeline';
import { DEFAULT_GALAXIES_3D, type Geometry } from '../types';
import { gridSize } from './shellfield';
import { ShellBuilder } from './shells';

const RUNS = 3;
const TIMES = 10;

function time(b: ShellBuilder, owner: Int32Array, civCount: number) {
  const all: number[] = [];
  let tris = 0, shells = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    const out = b.build(owner, civCount);
    all.push(performance.now() - t0);
    tris = out.reduce((s, c) => s + c.positions.length / 9, 0);
    shells = out.length;
  }
  return { ms: Math.min(...all), all, tris, shells };
}

describe('shell job speed (criterion 53)', () => {
  for (const geometry of ['flat', 'torus'] as Geometry[])
    it(`3d ${geometry} 100k: every sampled time up to tLast ≤ 50 ms (min of ${RUNS}); full coverage reported`, () => {
      const r = simulate({ dim: 3, geometry, galaxies: DEFAULT_GALAXIES_3D });
      const tl = createTimeline(r);
      const G = gridSize(DEFAULT_GALAXIES_3D);
      expect(G).toBe(48);
      const L = r.params.sizeGly, periodic = geometry === 'torus';
      const b = new ShellBuilder(r.positions, { L, G, periodic });
      let worst = { ms: -1, t: 0, tris: 0, shells: 0, claimed: 0 };
      for (let s = 1; s <= TIMES; s++) {
        const t = (r.tLast * s) / TIMES;
        tl.seek(t);
        const m = time(b, tl.owner, r.civs.length);
        expect(m.shells).toBe(tl.alive);
        const claimed = tl.owner.reduce((k, o) => k + (o >= 0 ? 1 : 0), 0);
        if (m.ms > worst.ms) worst = { ms: m.ms, t, tris: m.tris, shells: m.shells, claimed };
      }
      // Full coverage: every galaxy owned by the nearest origin (wrapped on the torus).
      const n = r.positions.length / 3;
      const full = new Int32Array(n);
      const d1 = (d: number) => (periodic ? d - L * Math.round(d / L) : d);
      for (let i = 0; i < n; i++) {
        let best = Infinity;
        for (const c of r.civs) {
          const o = c.origin;
          const d = d1(r.positions[3 * i] - r.positions[3 * o]) ** 2 + d1(r.positions[3 * i + 1] - r.positions[3 * o + 1]) ** 2 + d1(r.positions[3 * i + 2] - r.positions[3 * o + 2]) ** 2;
          if (d < best) {
            best = d;
            full[i] = c.id;
          }
        }
      }
      const f = time(b, full, r.civs.length);
      process.stdout.write(
        `[perf] shell job 3d ${geometry} 100k G=${G}: worst sampled time t=${worst.t.toFixed(1)} Gyr (${worst.claimed} owned, ${worst.shells} shells, ${worst.tris} triangles) ` +
          `min ${worst.ms.toFixed(1)} ms; full coverage (${n} owned, ${f.shells} shells, ${f.tris} triangles) min ${f.ms.toFixed(1)} ms of [${f.all.map((x) => x.toFixed(1)).join(', ')}]\n`,
      );
      expect(worst.ms).toBeLessThanOrEqual(50);
    }, 300000);
});
