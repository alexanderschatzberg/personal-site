import { describe, expect, it } from 'vitest';
import { makeCosmology } from '../cosmology';
import { fmt } from './fields';
import { displayScale, formatA, physicalPerRendered, runScaleAt, scaleAt } from './growth';

describe('growth display', () => {
  it('d(t) = min(a, 1): grows to today, then the map holds still; 1 with no expansion', () => {
    expect(displayScale(0, 67.7)).toBe(0);
    expect(displayScale(0.42, 67.7)).toBe(0.42);
    expect(displayScale(1, 67.7)).toBe(1);
    expect(displayScale(Math.E, 67.7)).toBe(1);
    expect(displayScale(100, 67.7)).toBe(1);
    expect(displayScale(1e300, 67.7)).toBe(1);
    expect(displayScale(Infinity, 67.7)).toBe(1);
    expect(displayScale(0.3, 0)).toBe(1);
  });

  it('the scale bar reads true physical length: a / d(t) per rendered unit', () => {
    expect(physicalPerRendered(Math.E, displayScale(Math.E, 70))).toBeCloseTo(Math.E);
    expect(physicalPerRendered(100, displayScale(100, 70))).toBeCloseTo(100);
    expect(physicalPerRendered(0.5, displayScale(0.5, 70))).toBe(1);
  });

  it('reads a(t) from the run: samples span [0, tLast], not [0, tEndGyr]', () => {
    const r = { scale: new Float64Array([0, 0.5, 1, 3]), tLast: 30, params: { tEndGyr: 5000 } };
    expect(runScaleAt(r, 0)).toBe(0);
    expect(runScaleAt(r, 15)).toBeCloseTo(0.75);
    expect(runScaleAt(r, 30)).toBeCloseTo(3);
    expect(runScaleAt(r, 40)).toBeCloseTo(3);
    expect(runScaleAt({ ...r, tLast: 0 }, 5)).toBe(0);
  });

  it('d is continuous and non-decreasing through a = 1', () => {
    expect(displayScale(1 + 1e-9, 70)).toBeCloseTo(1, 8);
    let prev = -1;
    for (let a = 0; a < 50; a += 0.01) {
      const s = displayScale(a, 70);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('interpolates the scale samples linearly over [0, tEnd]', () => {
    const scale = new Float64Array([0, 0.5, 1, 3]); // samples at t = 0, 10, 20, 30
    expect(scaleAt(scale, 30, 0)).toBe(0);
    expect(scaleAt(scale, 30, 5)).toBeCloseTo(0.25);
    expect(scaleAt(scale, 30, 20)).toBeCloseTo(1);
    expect(scaleAt(scale, 30, 25)).toBeCloseTo(2);
    expect(scaleAt(scale, 30, 30)).toBeCloseTo(3);
    expect(scaleAt(scale, 30, 99)).toBeCloseTo(3);
    expect(scaleAt(scale, 30, -1)).toBe(0);
  });

  it('treats a missing or empty scale as a ≡ 1', () => {
    expect(scaleAt(undefined, 30, 5)).toBe(1);
    expect(scaleAt(new Float64Array(0), 30, 5)).toBe(1);
    expect(scaleAt(new Float64Array([2]), 30, 5)).toBe(2);
  });

  it('converts rendered length to physical Gly: a / s', () => {
    expect(physicalPerRendered(0.42, 0.42)).toBe(1);
    expect(physicalPerRendered(0, 0)).toBe(1); // a ≤ 1: rendered = physical
    expect(physicalPerRendered(Math.E, 2)).toBeCloseTo(Math.E / 2);
    expect(physicalPerRendered(1, 1)).toBe(1);
  });

  it('stays finite when scale samples overflow to Infinity', () => {
    const scale = new Float64Array([1, Infinity, Infinity]);
    const a = scaleAt(scale, 20, 15);
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBeGreaterThan(1e38);
    expect(Number.isFinite(scaleAt(scale, 20, 5))).toBe(true);
    for (const x of [Infinity, NaN]) {
      const s = displayScale(x, 70);
      expect(Number.isFinite(s)).toBe(true);
      expect(Number.isFinite(physicalPerRendered(x, s))).toBe(true);
    }
    expect(physicalPerRendered(Infinity, displayScale(Infinity, 70))).toBeGreaterThan(1e38);
  });

  it('the true a(t) and scale bar keep growing to the end when a passes Float32 max (H0 = 150, ΩΛ = 0.99, tEnd = 1000)', () => {
    const tEnd = 1000;
    const c = makeCosmology(150, 0.99, tEnd);
    let prev = -Infinity;
    for (let i = 0; i < c.scale.length; i++) {
      const t = (i * tEnd) / (c.scale.length - 1);
      const a = scaleAt(c.scale, tEnd, t);
      const perRendered = physicalPerRendered(a, displayScale(a, 150));
      expect(a).toBeGreaterThan(prev);
      expect(Number.isFinite(perRendered)).toBe(true);
      prev = a;
    }
    const aEnd = c.a(tEnd);
    expect(aEnd).toBeGreaterThan(1e60);
    expect(scaleAt(c.scale, tEnd, tEnd) / aEnd).toBeCloseTo(1, 12);
    expect(physicalPerRendered(aEnd, displayScale(aEnd, 150)) / aEnd).toBeCloseTo(1, 12);
  });

  it('formats the a readout compactly for tiny, ordinary and huge values', () => {
    expect(formatA(0.005)).toBe('0.0050');
    expect(formatA(0.42)).toBe('0.42');
    expect(formatA(1)).toBe('1.00');
    expect(formatA(12345.678)).toBe('12345.68');
    expect(formatA(1.0e66)).toBe('1.00e66');
    expect(formatA(2.9999999e38)).toBe('3.00e38');
    expect(formatA(0)).toBe('0.00');
  });

  it('scale-bar Gly at a ≈ 1e66 is a finite, compact label', () => {
    const c = makeCosmology(150, 0.99, 1000);
    const a = scaleAt(c.scale, 1000, 1000);
    const perRendered = physicalPerRendered(a, displayScale(a, 150));
    expect(perRendered).toBeGreaterThan(1e60);
    expect(Number.isFinite(perRendered)).toBe(true);
    expect(fmt(Number((6.5e64).toPrecision(2)))).toBe('6.5e64');
  });
});
