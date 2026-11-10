import { describe, expect, it } from 'vitest';
import { simulate } from './engine';
import { DEFAULTS, RANGES } from './types';
import type { Params, SimResult } from './types';

/** Many civs in a small universe so contact and war are common. */
const BUSY: Partial<Params> = {
  galaxies: 1500,
  sizeGly: 60,
  pLife: 1e-20,
  tEndGyr: 120,
};

function conquests(r: SimResult): number {
  return r.events.filter((e) => e.kind === 'conquer').length;
}

describe('simulate', () => {
  it('is deterministic for a seed, and a different seed differs', () => {
    const a = simulate({ ...BUSY, seed: 'one' });
    const b = simulate({ ...BUSY, seed: 'one' });
    const c = simulate({ ...BUSY, seed: 'two' });
    expect(a.positions).toEqual(b.positions);
    expect(a.civs).toEqual(b.civs);
    expect(a.events).toEqual(b.events);
    expect(a.log).toEqual(b.log);
    expect(a.tLast).toBe(b.tLast);
    expect(c.positions).not.toEqual(a.positions);
    expect(c.events).not.toEqual(a.events);
  });

  it('clamps params to RANGES, merges over DEFAULTS and swaps inverted ranges', () => {
    const r = simulate({
      galaxies: 10,
      sizeGly: 1e6,
      pLife: 1,
      speedMin: 0.9,
      speedMax: 0.2,
      mightMin: 50,
      mightMax: 3,
      defenderBonus: 0,
      tEndGyr: 20,
      dim: 3,
      geometry: 'sphere',
    });
    const p = r.params;
    expect(p.galaxies).toBe(RANGES.galaxies[0]);
    expect(p.sizeGly).toBe(RANGES.sizeGly[1]);
    expect(p.pLife).toBe(RANGES.pLife[1]);
    expect(p.defenderBonus).toBe(RANGES.defenderBonus[0]);
    expect([p.speedMin, p.speedMax]).toEqual([0.2, 0.9]);
    expect([p.mightMin, p.mightMax]).toEqual([3, 50]);
    expect(p.geometry).toBe('flat');
    expect(p.hardSteps).toBe(DEFAULTS.hardSteps);
    expect(p.seed).toBe(DEFAULTS.seed);
    expect(r.positions.length).toBe(3 * RANGES.galaxies[0]);
    for (const c of r.civs) {
      expect(c.speed).toBeGreaterThanOrEqual(0.2);
      expect(c.speed).toBeLessThanOrEqual(0.9);
      expect(c.baseMight).toBeGreaterThanOrEqual(3);
      expect(c.baseMight).toBeLessThanOrEqual(50);
    }
  });

  it('places sphere galaxies on the surface of radius size/(2π)', () => {
    const r = simulate({ geometry: 'sphere', galaxies: 600, sizeGly: 100 });
    const R = 100 / (2 * Math.PI);
    for (let i = 0; i < 600; i++) {
      const [x, y, z] = [r.positions[3 * i], r.positions[3 * i + 1], r.positions[3 * i + 2]];
      expect(Math.hypot(x, y, z)).toBeCloseTo(R, 3);
    }
  });

  it('events are sorted by t, have prev set and every civ arises on an unowned galaxy', () => {
    for (const seed of ['a', 'b', 'c']) {
      for (const geometry of ['flat', 'torus', 'sphere'] as const) {
        const r = simulate({ ...BUSY, geometry, seed });
        expect(r.civs.length).toBeGreaterThan(1);
        const owner = new Int32Array(r.params.galaxies).fill(-1);
        const arisen = new Set<number>();
        let t = -Infinity;
        for (const e of r.events) {
          expect(e.t).toBeGreaterThanOrEqual(t);
          t = e.t;
          expect(e.prev).toBe(owner[e.galaxy]);
          if (e.kind === 'arise') {
            expect(e.prev).toBe(-1);
            expect(arisen.has(e.owner)).toBe(false);
            arisen.add(e.owner);
            expect(r.civs[e.owner].origin).toBe(e.galaxy);
            expect(r.civs[e.owner].t0).toBe(e.t);
          }
          owner[e.galaxy] = e.owner;
        }
        expect(arisen.size).toBe(r.civs.length);
        // ids are assigned in order of arising
        const ariseOrder = r.events.filter((e) => e.kind === 'arise').map((e) => e.owner);
        expect(ariseOrder).toEqual(r.civs.map((c) => c.id));
        const logT = r.log.map((e) => e.t);
        expect(logT).toEqual([...logT].sort((x, y) => x - y));
      }
    }
  });

  it('temperament 0 for everyone means no conquests', () => {
    let wars = 0;
    for (const seed of ['a', 'b', 'c']) {
      const peaceful = simulate({ ...BUSY, seed, temperMean: 0, temperSpread: 0 });
      expect(peaceful.log.some((e) => e.kind === 'meet')).toBe(true);
      expect(conquests(peaceful)).toBe(0);
      expect(peaceful.log.some((e) => e.kind === 'war' || e.kind === 'conquer')).toBe(false);
      wars += conquests(simulate({ ...BUSY, seed, temperMean: 1, temperSpread: 0 }));
    }
    // the same setup with warlike civs does conquer, so the check above means something
    expect(wars).toBeGreaterThan(0);
  });

  it('defenderBonus 5 makes conquests rarer than bonus 1 at equal might', () => {
    let weak = 0;
    let strong = 0;
    for (const seed of ['a', 'b', 'c', 'd']) {
      const base = {
        ...BUSY,
        seed,
        temperMean: 1,
        temperSpread: 0,
        mightMin: 5,
        mightMax: 5,
        mightModel: 'log' as const,
      };
      weak += conquests(simulate({ ...base, defenderBonus: 1 }));
      strong += conquests(simulate({ ...base, defenderBonus: 5 }));
    }
    expect(weak).toBeGreaterThan(0);
    expect(strong).toBeLessThan(weak);
  });

  it('runs every might model in 2d and 3d', () => {
    for (const mightModel of ['power', 'log', 'frontier'] as const) {
      for (const dim of [2, 3] as const) {
        const r = simulate({ ...BUSY, mightModel, dim, temperMean: 1, seed: 'm' });
        expect(r.civs.length).toBeGreaterThan(0);
        expect(r.tLast).toBeLessThanOrEqual(r.params.tEndGyr);
      }
    }
  });

  it('logs only the first conquest of each other civ and extinction when a civ is wiped out', () => {
    const r = simulate({ ...BUSY, seed: 'x', temperMean: 1, temperSpread: 0 });
    const pairs = r.log.filter((e) => e.kind === 'conquer').map((e) => `${e.civ}>${e.other}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    const held = new Int32Array(r.civs.length);
    const extinctAt = new Map<number, number>();
    for (const e of r.events) {
      held[e.owner]++;
      if (e.prev >= 0) {
        held[e.prev]--;
        if (held[e.prev] === 0) extinctAt.set(e.prev, e.t);
      }
    }
    const logged = r.log.filter((e) => e.kind === 'extinct');
    expect(logged.map((e) => e.civ).sort()).toEqual([...extinctAt.keys()].sort());
  });

  it('the defaults give a handful to a few dozen civs', () => {
    const counts: Record<string, number> = {};
    for (const seed of [DEFAULTS.seed, 'a', 'b', 'c', 'd', 'e']) {
      counts[seed] = simulate({ seed }).civs.length;
    }
    console.log('default civ counts per seed:', JSON.stringify(counts));
    for (const c of Object.values(counts)) {
      expect(c).toBeGreaterThanOrEqual(3);
      expect(c).toBeLessThanOrEqual(80);
    }
  }, 120000);

  it('50k galaxies in 3d finishes in under ~3 s', () => {
    const t0 = performance.now();
    const r = simulate({ dim: 3, galaxies: 50000 });
    const ms = performance.now() - t0;
    console.log(
      `50k 3d: ${ms.toFixed(0)} ms, ${r.civs.length} civs, ${r.events.length} ownership events`,
    );
    expect(ms).toBeLessThan(3000);
  }, 20000);
});
