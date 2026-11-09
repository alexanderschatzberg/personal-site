// Round 2: cosmic expansion in the engine, the run ending when nothing more is reachable,
// edges/scale/tToday in the SimResult, and the frontier worst case.

import { describe, expect, it } from 'vitest';
import staticFixture from './__fixtures__/static-h0.json';
import { STATIC_CASES, digest } from './__fixtures__/static-cases';
import { makeCosmology } from './cosmology';
import { simulate } from './engine';
import { Space } from './geometry';
import { DEFAULTS, SCALE_SAMPLES, TODAY_GYR } from './types';
import type { Params, SimResult } from './types';

const SEEDS = [DEFAULTS.seed, 'a', 'b', 'c', 'd', 'e'];

function spaceOf(r: SimResult): Space {
  return new Space(r.positions, r.params.dim, r.params.geometry, r.params.sizeGly);
}

function lastEventTime(r: SimResult): number {
  let t = 0;
  for (const e of r.events) t = Math.max(t, e.t);
  for (const e of r.log) t = Math.max(t, e.t);
  return t;
}

describe('H0 = 0 matches the round-1 engine (criterion 14)', () => {
  const fixture = staticFixture as Record<string, ReturnType<typeof digest>>;
  for (const [name, params] of Object.entries(STATIC_CASES)) {
    it(name, () => {
      const r = simulate(params);
      expect(r.params.H0).toBe(0);
      expect(digest(r)).toEqual(fixture[name]);
    });
  }
});

describe('SimResult cosmology fields', () => {
  it('scale and tToday follow the cosmology; static when H0 = 0', () => {
    const r = simulate({});
    const c = makeCosmology(DEFAULTS.H0, DEFAULTS.omegaLambda, DEFAULTS.tEndGyr);
    expect(r.scale).toBeInstanceOf(Float64Array);
    expect(r.scale.length).toBe(SCALE_SAMPLES);
    // Round 4: sampled over [0, tLast], not [0, tEnd].
    expect(r.tLast).toBeGreaterThan(0);
    expect(r.tLast).toBeLessThan(r.params.tEndGyr);
    for (let i = 0; i < SCALE_SAMPLES; i++) {
      expect(r.scale[i]).toBe(c.a((i * r.tLast) / (SCALE_SAMPLES - 1)));
    }
    expect(r.scale[SCALE_SAMPLES - 1]).toBe(c.a(r.tLast));
    expect(r.tToday).toBe(c.tToday);
    expect(Math.abs(r.tToday! - 13.8)).toBeLessThanOrEqual(0.1);

    const s = simulate({ H0: 0 });
    expect(s.tToday).toBe(TODAY_GYR);
    expect(Array.from(s.scale).every((x) => x === 1)).toBe(true);

    // No civ ever arises: tLast = 0 and every sample is a(0).
    const empty = simulate({ pLife: 1e-30, galaxies: 500 });
    expect(empty.civs.length).toBe(0);
    expect(empty.tLast).toBe(0);
    expect(empty.scale.length).toBe(SCALE_SAMPLES);
    expect(Array.from(empty.scale).every((x) => x === c.a(0))).toBe(true);
  });

  it('edges are the symmetrised kNN graph, i < j, each pair once', () => {
    const cases: Partial<Params>[] = [
      { galaxies: 800, seed: 'e1' },
      { galaxies: 800, geometry: 'torus', seed: 'e2' },
      { galaxies: 800, geometry: 'sphere', seed: 'e3' },
      { galaxies: 800, dim: 3, seed: 'e4' },
      { galaxies: 800, dim: 3, geometry: 'torus', seed: 'e5' },
    ];
    for (const p of cases) {
      const r = simulate(p);
      expect(r.edges).toBeInstanceOf(Uint32Array);
      expect(r.edges.length % 2).toBe(0);
      const seen = new Set<number>();
      const n = r.params.galaxies;
      for (let k = 0; k < r.edges.length; k += 2) {
        const i = r.edges[k], j = r.edges[k + 1];
        expect(i).toBeLessThan(j);
        expect(j).toBeLessThan(n);
        const key = i * n + j;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      // Independently: every i → kNN(i) pair, symmetrised.
      const g = spaceOf(r).neighbours(r.params.dim === 3 ? 12 : 8);
      const want = new Set<number>();
      for (let i = 0; i < n; i++) {
        for (let q = g.start[i]; q < g.start[i + 1]; q++) {
          const j = g.adj[q];
          want.add(Math.min(i, j) * n + Math.max(i, j));
        }
      }
      expect(seen.size).toBe(want.size);
      for (const key of want) expect(seen.has(key)).toBe(true);
      // every galaxy has at least k neighbours
      const deg = new Int32Array(n);
      for (const v of r.edges) deg[v]++;
      expect(Math.min(...deg)).toBeGreaterThanOrEqual(r.params.dim === 3 ? 12 : 8);
    }
  });
});

describe('fronts in an expanding universe (criterion 16)', () => {
  it('every takeover lands at η(t) = η(t_send) + d/v from a neighbour the civ held', () => {
    // Early civs (low hardSteps, short lifetime) so fronts actually spread before a(t) runs
    // away; with the defaults civs arise after ~100 Gyr and no front reaches a neighbour.
    const early = { galaxies: 1500, sizeGly: 60, pLife: 1e-20, hardSteps: 2, tEndGyr: 60 };
    for (const p of [
      { ...early, seed: 'b' },
      { ...early, seed: 'a', geometry: 'sphere' as const },
      { ...early, seed: 'c', geometry: 'torus' as const, temperMean: 1 },
      { ...early, seed: 'd', dim: 3 as const, galaxies: 2000, sizeGly: 30 },
    ]) {
      const r = simulate(p);
      const c = makeCosmology(r.params.H0, r.params.omegaLambda, r.params.tEndGyr);
      const space = spaceOf(r);
      const nb: number[][] = Array.from({ length: r.params.galaxies }, () => []);
      for (let k = 0; k < r.edges.length; k += 2) {
        nb[r.edges[k]].push(r.edges[k + 1]);
        nb[r.edges[k + 1]].push(r.edges[k]);
      }
      // take times of galaxy g by civ A, in order
      const takes = new Map<number, number[]>();
      let checked = 0;
      for (const e of r.events) {
        if (e.kind !== 'arise') {
          const v = r.civs[e.owner].speed;
          const eta = c.eta(e.t);
          let ok = false;
          for (const s of nb[e.galaxy]) {
            for (const ts of takes.get(e.owner * r.params.galaxies + s) ?? []) {
              const want = c.eta(ts) + space.dist(s, e.galaxy) / v;
              if (Math.abs(eta - want) <= 1e-9 * Math.max(1, want)) ok = true;
            }
          }
          expect(ok).toBe(true);
          checked++;
        }
        const key = e.owner * r.params.galaxies + e.galaxy;
        if (!takes.has(key)) takes.set(key, []);
        takes.get(key)!.push(e.t);
      }
      expect(checked).toBeGreaterThan(100);
    }
  });

  it('nothing beyond a civ’s event horizon is ever reached, though it would be without expansion', () => {
    const p: Partial<Params> = {
      galaxies: 4000,
      sizeGly: 500,
      pLife: 5e-23,
      hardSteps: 2,
      tEndGyr: 1000,
      temperMean: 0,
      temperSpread: 0,
      seed: 'horizon',
    };
    const lam = makeCosmology(DEFAULTS.H0, DEFAULTS.omegaLambda, 1000);
    // farthest comoving distance from its origin that each civ ever took
    const reach = (r: SimResult) => {
      const space = spaceOf(r);
      const far = new Float64Array(r.civs.length);
      for (const e of r.events) {
        far[e.owner] = Math.max(far[e.owner], space.dist(r.civs[e.owner].origin, e.galaxy));
      }
      return far;
    };
    const horizon = (civ: SimResult['civs'][number]) =>
      civ.speed * (lam.etaInf - lam.eta(civ.t0));

    const expanding = simulate(p);
    expect(expanding.civs.length).toBeGreaterThan(0);
    const far = reach(expanding);
    expanding.civs.forEach((civ, i) => {
      expect(far[i]).toBeLessThanOrEqual(horizon(civ) * (1 + 1e-9));
    });

    // The same galaxies and civ origins without expansion: fronts go far beyond those horizons.
    const still = simulate({ ...p, H0: 0 });
    const farStill = reach(still);
    const beyond = still.civs.filter((civ, i) => farStill[i] > horizon(civ));
    expect(beyond.length).toBeGreaterThan(0);
  });
});

describe('the run ends when nothing more can be reached', () => {
  it('with expansion and the defaults, tLast < tEnd and is the last event’s time', () => {
    const report: Record<string, { civs: number; tLast: number }> = {};
    for (const seed of SEEDS) {
      const r = simulate({ seed });
      report[seed] = { civs: r.civs.length, tLast: r.tLast };
      expect(r.tLast).toBeLessThan(r.params.tEndGyr);
      expect(r.tLast).toBe(lastEventTime(r));
    }
    console.log('defaults with expansion (civs, tLast):', JSON.stringify(report));
  });

  it('a tiny static universe claimed early ends at its last event', () => {
    for (const temperMean of [0, 1]) {
      const r = simulate({
        H0: 0,
        galaxies: 500,
        sizeGly: 10,
        pLife: 1e-22,
        hardSteps: 0,
        tEndGyr: 1000,
        temperMean,
        seed: 'tiny',
      });
      const owner = new Int32Array(r.params.galaxies).fill(-1);
      for (const e of r.events) owner[e.galaxy] = e.owner;
      expect(owner.every((o) => o >= 0)).toBe(true);
      expect(r.tLast).toBe(lastEventTime(r));
      expect(r.tLast).toBeLessThan(r.params.tEndGyr / 2);
    }
  });

  it('a static universe whose fronts are still moving at the end runs to tEnd', () => {
    const r = simulate({ H0: 0, sizeGly: 500, galaxies: 4000, pLife: 1e-24, tEndGyr: 20, hardSteps: 0, seed: 'run' });
    expect(r.civs.length).toBeGreaterThan(0);
    expect(r.tLast).toBe(r.params.tEndGyr);
  });
});

describe('round 4: the run ends at the last event; tEndGyr is only a safety cap (criterion 27)', () => {
  it('static, with the default web: every galaxy is settled, well before the cap', () => {
    const report: Record<string, { civs: number; tLast: number }> = {};
    for (const seed of SEEDS) {
      const r = simulate({ H0: 0, seed });
      expect(r.params.clumpiness).toBe(DEFAULTS.clumpiness);
      expect(r.civs.length).toBeGreaterThan(0);
      const owner = new Int32Array(r.params.galaxies).fill(-1);
      for (const e of r.events) owner[e.galaxy] = e.owner;
      expect(owner.every((o) => o >= 0)).toBe(true);
      expect(r.tLast).toBe(lastEventTime(r));
      expect(r.tLast).toBeLessThan(r.params.tEndGyr);
      report[seed] = { civs: r.civs.length, tLast: r.tLast };
    }
    console.log('static defaults (civs, tLast):', JSON.stringify(report));
  });

  it('raising the cap changes nothing when the run ended on its own', () => {
    for (const seed of ['a', 'b']) {
      for (const extra of [{ H0: 0 }, { H0: 0, dim: 3 as const, galaxies: 3000, sizeGly: 50 }]) {
        const r = simulate({ ...extra, seed });
        const big = simulate({ ...extra, seed, tEndGyr: 10000 });
        expect(r.tLast).toBeLessThan(r.params.tEndGyr);
        expect(big.events).toEqual(r.events);
        expect(big.log).toEqual(r.log);
        expect(big.tLast).toBe(r.tLast);
      }
    }
  });

  it('with expansion the neighbour graph is connected at the defaults, so only the horizon stops fronts', () => {
    for (const p of [{}, { geometry: 'sphere' as const }, { geometry: 'torus' as const }, { clumpiness: 1 }]) {
      const r = simulate({ ...p, pLife: 1e-30 });
      const n = r.params.galaxies;
      const parent = Int32Array.from({ length: n }, (_, i) => i);
      const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
      let comps = n;
      for (let k = 0; k < r.edges.length; k += 2) {
        const a = find(r.edges[k]), b = find(r.edges[k + 1]);
        if (a !== b) {
          parent[a] = b;
          comps--;
        }
      }
      expect(comps).toBe(1);
    }
  });

  it('50k galaxies in 2d with the default web finishes in under ~3 s', () => {
    const t0 = performance.now();
    const r = simulate({ galaxies: 50000 });
    const ms = performance.now() - t0;
    console.log(`50k 2d (clumpiness ${r.params.clumpiness}): ${ms.toFixed(0)} ms, ${r.civs.length} civs`);
    expect(ms).toBeLessThan(3000);
  }, 20000);
});

describe('frontier performance', () => {
  // The plan's worst case, plus hardSteps 0 so civs arise early and fight tens of thousands of
  // battles (the plan's case on its own arises late and fights few). Without the whole-universe
  // shortcut each frontier battle scans every galaxy, and the hardSteps 0 case takes minutes.
  const worst = {
    dim: 3 as const,
    galaxies: 50000,
    sizeGly: 10,
    frontierRadiusGly: 100,
    pLife: 1e-10,
    mightModel: 'frontier' as const,
  };
  for (const extra of [{}, { hardSteps: 0 }, { hardSteps: 0, H0: 0 }]) {
    it(`worst case ${JSON.stringify(extra)} in under 10 s`, () => {
      const t0 = performance.now();
      const r = simulate({ ...worst, ...extra });
      const ms = performance.now() - t0;
      console.log(
        `frontier worst case ${JSON.stringify(extra)}: ${ms.toFixed(0)} ms, ${r.civs.length} civs, ` +
          `${r.events.length} events, ${r.log.length} log`,
      );
      expect(ms).toBeLessThan(10000);
    }, 60000);
  }
});

describe('the life window (round 2b)', () => {
  it('origins arise inside [0, min(lifeWindowGyr, tEndGyr)]', () => {
    for (const [lifeWindowGyr, tEndGyr] of [[20, 200], [5, 200], [300, 100]]) {
      const r = simulate({ H0: 0, lifeWindowGyr, tEndGyr, galaxies: 1500, pLife: 1e-20, seed: 'lw' });
      expect(r.civs.length).toBeGreaterThan(0);
      for (const c of r.civs) expect(c.t0).toBeLessThanOrEqual(Math.min(lifeWindowGyr, tEndGyr));
    }
  });

  it('with the defaults (expansion on), civs spread beyond their origin on most seeds', () => {
    const report: Record<string, { civs: number; colonize: number; conquer: number; tLast: number }> = {};
    let spread = 0;
    for (const seed of SEEDS) {
      const r = simulate({ seed });
      const colonize = r.events.filter((e) => e.kind === 'colonize').length;
      const conquer = r.events.filter((e) => e.kind === 'conquer').length;
      report[seed] = { civs: r.civs.length, colonize, conquer, tLast: r.tLast };
      if (colonize + conquer > 0) spread++;
    }
    console.log('life window, defaults (civs, colonize, conquer, tLast):', JSON.stringify(report));
    expect(spread).toBeGreaterThanOrEqual(4);
  });
});
