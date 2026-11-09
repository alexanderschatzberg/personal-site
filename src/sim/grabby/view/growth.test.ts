import { describe, expect, it } from 'vitest';
import { displayScale, physicalPerRendered, scaleAt } from './growth';

describe('growth display', () => {
  it('s(a) = a up to today, 1 + ln a after, 1 with no expansion', () => {
    expect(displayScale(0, 67.7)).toBe(0);
    expect(displayScale(0.42, 67.7)).toBe(0.42);
    expect(displayScale(1, 67.7)).toBe(1);
    expect(displayScale(Math.E, 67.7)).toBeCloseTo(2);
    expect(displayScale(100, 67.7)).toBeCloseTo(1 + Math.log(100));
    expect(displayScale(0.3, 0)).toBe(1);
    expect(displayScale(7, 0)).toBe(1);
  });

  it('s is continuous and increasing through a = 1', () => {
    expect(displayScale(1 + 1e-9, 70)).toBeCloseTo(1, 8);
    let prev = -1;
    for (let a = 0; a < 50; a += 0.01) {
      const s = displayScale(a, 70);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it('interpolates the scale samples linearly over [0, tEnd]', () => {
    const scale = new Float32Array([0, 0.5, 1, 3]); // samples at t = 0, 10, 20, 30
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
    expect(scaleAt(new Float32Array(0), 30, 5)).toBe(1);
    expect(scaleAt(new Float32Array([2]), 30, 5)).toBe(2);
  });

  it('converts rendered length to physical Gly: a / s', () => {
    expect(physicalPerRendered(0.42, 0.42)).toBe(1);
    expect(physicalPerRendered(0, 0)).toBe(1); // a ≤ 1: rendered = physical
    expect(physicalPerRendered(Math.E, 2)).toBeCloseTo(Math.E / 2);
    expect(physicalPerRendered(1, 1)).toBe(1);
  });

  it('stays finite when scale samples overflow to Infinity', () => {
    const scale = new Float32Array([1, Infinity, Infinity]);
    const a = scaleAt(scale, 20, 15);
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBeGreaterThan(1e38);
    expect(Number.isFinite(scaleAt(scale, 20, 5))).toBe(true);
    for (const x of [Infinity, NaN]) {
      const s = displayScale(x, 70);
      expect(Number.isFinite(s)).toBe(true);
      expect(Number.isFinite(physicalPerRendered(x, s))).toBe(true);
    }
    expect(displayScale(Infinity, 70)).toBeGreaterThan(1 + Math.log(1e38));
  });
});
