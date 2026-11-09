import { describe, expect, it } from 'vitest';
import { makeCosmology } from './cosmology';
import { DEFAULTS, KMS_MPC_TO_PER_GYR, SCALE_SAMPLES, TODAY_GYR } from './types';

describe('cosmology', () => {
  it('the defaults put today at 13.8 ± 0.1 Gyr, where a = 1', () => {
    const c = makeCosmology(DEFAULTS.H0, DEFAULTS.omegaLambda, DEFAULTS.tEndGyr);
    console.log('tToday for defaults:', c.tToday);
    expect(c.tToday).not.toBeNull();
    expect(Math.abs(c.tToday! - 13.8)).toBeLessThanOrEqual(0.1);
    expect(c.a(c.tToday!)).toBeCloseTo(1, 9);
  });

  it('matter only (ΩΛ = 0): a = (1.5Ht)^(2/3), today = 2/(3H), η = 3t^(1/3)/(1.5H)^(2/3)', () => {
    const H = 70 * KMS_MPC_TO_PER_GYR;
    const c = makeCosmology(70, 0, 100);
    expect(c.tToday).toBeCloseTo(2 / (3 * H), 9);
    expect(c.a(5)).toBeCloseTo(Math.pow(1.5 * H * 5, 2 / 3), 12);
    for (const t of [0.001, 0.5, 5, 40, 100]) {
      const exact = (3 * Math.cbrt(t)) / Math.pow(1.5 * H, 2 / 3);
      expect(Math.abs(c.eta(t) - exact) / exact).toBeLessThan(1e-6);
    }
  });

  it('tToday is null when a = 1 falls after the lifetime', () => {
    expect(makeCosmology(20, 0.69, 20).tToday).toBeNull();
  });

  it('H0 = 0 is static: a ≡ 1, η(t) = t exactly, today = TODAY_GYR', () => {
    const c = makeCosmology(0, 0.69, 200);
    expect(c.isStatic).toBe(true);
    expect(c.tToday).toBe(TODAY_GYR);
    for (const t of [0, 0.1, 13.8, 123.456789, 200]) {
      expect(c.a(t)).toBe(1);
      expect(c.eta(t)).toBe(t);
      expect(c.etaInv(t)).toBe(t);
    }
    expect(c.scale.length).toBe(SCALE_SAMPLES);
    expect(Array.from(c.scale).every((x) => x === 1)).toBe(true);
  });

  it('η is strictly increasing and etaInv inverts it', () => {
    for (const [H0, oL, tEnd] of [
      [67.7, 0.69, 200],
      [150, 0.99, 1000],
      [10, 0, 20],
      [67.7, 0.3, 50],
    ]) {
      const c = makeCosmology(H0, oL, tEnd);
      let prev = -Infinity;
      for (let i = 0; i <= 5000; i++) {
        const t = (tEnd * i) / 5000;
        const e = c.eta(t);
        // Once a(t) is astronomically large, dη/dt = 1/a is below the float resolution of η
        // and η is flat in floating point; until then it must strictly increase.
        if (c.a(t) < 1e6) expect(e).toBeGreaterThan(prev);
        else expect(e).toBeGreaterThanOrEqual(prev);
        prev = e;
        // t → η → t is ill-conditioned by a factor a(t) (dt/dη = a); check it where a is modest.
        if (c.a(t) <= 1e3) {
          expect(Math.abs(c.etaInv(e) - t)).toBeLessThanOrEqual(1e-9 * Math.max(1, t));
        }
        // η → t → η is well conditioned everywhere.
        const e2 = (c.etaEnd * i) / 5000;
        expect(Math.abs(c.eta(c.etaInv(e2)) - e2)).toBeLessThanOrEqual(1e-12 * Math.max(1, e2));
      }
      expect(c.eta(0)).toBe(0);
      expect(c.etaEnd).toBe(c.eta(tEnd));
      expect(c.etaInf).toBeGreaterThanOrEqual(c.etaEnd);
    }
  });

  it('η matches a direct integral of 1/a for the defaults', () => {
    const c = makeCosmology(DEFAULTS.H0, DEFAULTS.omegaLambda, DEFAULTS.tEndGyr);
    // Brute force from 1 Gyr to 13.8 Gyr with a fine midpoint rule (1/a is smooth there).
    const m = 200000;
    let sum = 0;
    for (let i = 0; i < m; i++) sum += 1 / c.a(1 + ((i + 0.5) * 12.8) / m);
    sum *= 12.8 / m;
    expect(c.eta(13.8) - c.eta(1)).toBeCloseTo(sum, 6);
  });

  it('scale samples a(t) evenly over [0, tEnd] and grows', () => {
    const c = makeCosmology(DEFAULTS.H0, DEFAULTS.omegaLambda, 200);
    expect(c.scale.length).toBe(SCALE_SAMPLES);
    expect(c.scale[0]).toBe(0);
    const i = 300;
    expect(c.scale[i]).toBeCloseTo(c.a((i * 200) / (SCALE_SAMPLES - 1)), 3);
    for (let k = 1; k < SCALE_SAMPLES; k++) expect(c.scale[k]).toBeGreaterThan(c.scale[k - 1]);
  });

  it('the event horizon is finite with dark energy and infinite without', () => {
    const lam = makeCosmology(DEFAULTS.H0, DEFAULTS.omegaLambda, 200);
    // comoving event horizon today for Planck-like parameters is about 16–17 Gly
    const horizonToday = lam.etaInf - lam.eta(lam.tToday!);
    console.log('comoving event horizon today (Gly):', horizonToday);
    expect(horizonToday).toBeGreaterThan(15);
    expect(horizonToday).toBeLessThan(18);
    expect(makeCosmology(67.7, 0, 200).etaInf).toBe(Infinity);
    expect(makeCosmology(0, 0.69, 200).etaInf).toBe(Infinity);
  });

  it('round 4: the table over the 5000 Gyr default cap (and the 10000 max) stays accurate near today', () => {
    // The default tEndGyr went from 200 to 5000. η is tabulated on t = tEnd·s³, so a longer
    // cap spreads the nodes thinner; check it against the 200 Gyr table (much finer there).
    const fine = makeCosmology(DEFAULTS.H0, DEFAULTS.omegaLambda, 200);
    for (const tEnd of [DEFAULTS.tEndGyr, 10000]) {
      const c = makeCosmology(DEFAULTS.H0, DEFAULTS.omegaLambda, tEnd);
      expect(Math.abs(c.tToday! - 13.8)).toBeLessThanOrEqual(0.1);
      expect(c.a(c.tToday!)).toBeCloseTo(1, 9);
      let worst = 0;
      for (const t of [0.01, 0.5, 1, 5, 10, 13.8, 20, 50, 100, 150, 200]) {
        worst = Math.max(worst, Math.abs(c.eta(t) - fine.eta(t)) / fine.eta(t));
      }
      console.log(`tEnd ${tEnd}: worst relative η error vs the 200 Gyr table on [0.01, 200]:`, worst);
      expect(worst).toBeLessThan(1e-8);
      // η(∞) is the same universe whatever the cap; the horizon today is unchanged.
      expect(Math.abs(c.etaInf - fine.etaInf) / fine.etaInf).toBeLessThan(1e-9);
      const horizon = c.etaInf - c.eta(c.tToday!);
      const horizonFine = fine.etaInf - fine.eta(fine.tToday!);
      expect(Math.abs(horizon - horizonFine)).toBeLessThan(1e-6);
      expect(Number.isFinite(c.etaInf)).toBe(true);
    }
  });

  it('round 4: a(t) past double range at the top of the ranges keeps η finite and monotonic', () => {
    // H0 = 150, ΩΛ = 0.99, tEnd = 10000: sinh overflows and a(t) = Infinity late on.
    const c = makeCosmology(150, 0.99, 10000);
    expect(c.a(10000)).toBe(Infinity);
    expect(Number.isFinite(c.etaEnd)).toBe(true);
    expect(Number.isFinite(c.etaInf)).toBe(true);
    expect(c.etaInf).toBeGreaterThanOrEqual(c.etaEnd);
    let prev = -Infinity;
    for (let i = 0; i <= 2000; i++) {
      const e = c.eta((10000 * i) / 2000);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
  });

  it('stores true a(t) in double precision at the top of the parameter ranges', () => {
    // H0 = 150, ΩΛ = 0.99, tEnd = 1000: a(t) passes Float32's max (3.4e38) long before tEnd
    // but stays finite in double; samples must not be clamped.
    const c = makeCosmology(150, 0.99, 1000);
    expect(c.scale).toBeInstanceOf(Float64Array);
    expect(c.a(1000)).toBeGreaterThan(3.5e38);
    expect(Number.isFinite(c.a(1000))).toBe(true);
    for (const v of c.scale) expect(Number.isFinite(v)).toBe(true);
    expect(c.scale[c.scale.length - 1]).toBe(c.a(1000));
  });
});
