// Criterion 53: one shell job at the 3d default (100k galaxies, ~20 civs, G = 48) takes ≤ 50 ms
// in Node. Uses a real engine run, at the sampled time with the most civs alive. Timing is the
// minimum of RUNS jobs, so one slowed by a parallel test file doesn't fail it.
import { describe, expect, it } from 'vitest';
import { simulate } from '../engine';
import { createTimeline } from '../timeline';
import { DEFAULT_GALAXIES_3D, type Geometry } from '../types';
import { gridSize } from './shellfield';
import { ShellBuilder } from './shells';

const RUNS = 5;

describe('shell job speed (criterion 53)', () => {
  for (const geometry of ['flat', 'torus'] as Geometry[])
    it(`3d ${geometry} 100k: one job ≤ 50 ms (min of ${RUNS})`, () => {
      const r = simulate({ dim: 3, geometry, galaxies: DEFAULT_GALAXIES_3D });
      const tl = createTimeline(r);
      let bestT = 0, bestAlive = -1;
      for (let s = 1; s <= 40; s++) {
        const t = (r.tLast * s) / 40;
        tl.seek(t);
        if (tl.alive > bestAlive) {
          bestAlive = tl.alive;
          bestT = t;
        }
      }
      tl.seek(bestT);
      const G = gridSize(DEFAULT_GALAXIES_3D);
      expect(G).toBe(48);
      const b = new ShellBuilder(r.positions, { L: r.params.sizeGly, G, periodic: geometry === 'torus' });
      const all: number[] = [];
      let tris = 0, shells = 0;
      for (let i = 0; i < RUNS; i++) {
        const t0 = performance.now();
        const out = b.build(tl.owner, r.civs.length);
        all.push(performance.now() - t0);
        tris = out.reduce((s, c) => s + c.positions.length / 9, 0);
        shells = out.length;
      }
      const ms = Math.min(...all);
      console.log(
        `shell job 3d ${geometry} 100k G=${G} at t=${bestT.toFixed(1)} Gyr: ${tl.alive} civs alive, ${shells} shells, ${tris} triangles; min ${ms.toFixed(1)} ms of [${all.map((x) => x.toFixed(1)).join(', ')}]`,
      );
      expect(shells).toBe(tl.alive);
      expect(ms).toBeLessThanOrEqual(50);
    }, 120000);
});
