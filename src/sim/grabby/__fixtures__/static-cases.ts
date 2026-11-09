// Cases for the H0 = 0 snapshot (criterion 14). static-h0.json holds the round-1 engine's
// output for each, hashed. It was generated from the round-1 engine (commit 9830c99, before
// cosmology existed) by running digest() over these cases; do not regenerate it from a later
// engine, or the test stops comparing against the pre-change behaviour.

import { createHash } from 'node:crypto';
import type { Params, SimResult } from '../types';

export const STATIC_CASES: Record<string, Partial<Params>> = {
  defaults_5eed: { H0: 0, seed: '5eed' },
  defaults_a: { H0: 0, seed: 'a' },
  defaults_b: { H0: 0, seed: 'b' },
  busy_torus_x: {
    H0: 0, geometry: 'torus', galaxies: 1500, sizeGly: 60, pLife: 1e-20, tEndGyr: 120,
    temperMean: 0.8, seed: 'x',
  },
  busy_sphere_y: {
    H0: 0, geometry: 'sphere', galaxies: 1500, sizeGly: 60, pLife: 1e-20, tEndGyr: 120, seed: 'y',
  },
  busy_3d_frontier_z: {
    H0: 0, dim: 3, galaxies: 2000, sizeGly: 40, pLife: 1e-20, tEndGyr: 120, temperMean: 1,
    mightModel: 'frontier', frontierRadiusGly: 8, seed: 'z',
  },
  busy_flat_log_w: {
    H0: 0, galaxies: 1500, sizeGly: 60, pLife: 1e-20, tEndGyr: 120, temperMean: 1,
    temperSpread: 0, mightModel: 'log', seed: 'w',
  },
  frontier_whole_v: {
    H0: 0, galaxies: 1500, sizeGly: 10, pLife: 1e-21, tEndGyr: 60, temperMean: 1,
    mightModel: 'frontier', frontierRadiusGly: 100, seed: 'v',
  },
  frontier_sphere_u: {
    H0: 0, geometry: 'sphere', galaxies: 1500, sizeGly: 60, pLife: 1e-20, tEndGyr: 120,
    temperMean: 1, mightModel: 'frontier', frontierRadiusGly: 12, seed: 'u',
  },
};

export interface Digest {
  events: string;
  log: string;
  civs: string;
  nEvents: number;
  nLog: number;
  nCivs: number;
}

const sha = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

export function digest(r: SimResult): Digest {
  return {
    events: sha(r.events),
    log: sha(r.log),
    civs: sha(r.civs),
    nEvents: r.events.length,
    nLog: r.log.length,
    nCivs: r.civs.length,
  };
}
