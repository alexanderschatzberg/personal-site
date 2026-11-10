import { describe, expect, it } from 'vitest';
import { ADDITIVE_FROM, DOTS_FULL_FROM, DOTS_TAPER_FROM, dotStyle } from './dots';

describe('dot size and opacity by count', () => {
  it('small runs keep the old look: 3·√(4000/n) px in [1.5, 4], opaque, normal blending', () => {
    for (const n of [500, 2000, 4000, 8000, 20000, DOTS_TAPER_FROM]) {
      for (const dark of [false, true]) {
        const d = dotStyle(n, dark);
        expect(d.size).toBeCloseTo(Math.max(1.5, Math.min(4, 3 * Math.sqrt(4000 / n))), 10);
        expect(d.opacity).toBe(1);
        expect(d.additive).toBe(false);
      }
    }
  });

  it('above the taper start, dots get smaller and more translucent, never increasing', () => {
    for (const dark of [false, true]) {
      let prev = dotStyle(DOTS_TAPER_FROM, dark);
      for (let n = DOTS_TAPER_FROM; n <= 1e6; n = Math.round(n * 1.2)) {
        const d = dotStyle(n, dark);
        expect(d.size).toBeLessThanOrEqual(prev.size);
        expect(d.opacity).toBeLessThanOrEqual(prev.opacity);
        prev = d;
      }
    }
  });

  it('at 1M: 1 px dots, 0.55 opacity in dark, 0.7 in light; the curve stops there', () => {
    expect(DOTS_FULL_FROM).toBe(1e6);
    expect(dotStyle(1e6, true)).toEqual({ size: 1, opacity: 0.55, additive: true });
    expect(dotStyle(1e6, false)).toEqual({ size: 1, opacity: 0.7, additive: false });
    expect(dotStyle(5e6, true)).toEqual(dotStyle(1e6, true));
    const mid = dotStyle(200000, false);
    expect(mid.size).toBeGreaterThan(1);
    expect(mid.size).toBeLessThan(1.5);
    expect(mid.opacity).toBeGreaterThan(0.7);
    expect(mid.opacity).toBeLessThan(1);
  });

  it('additive blending only in dark mode, from ADDITIVE_FROM galaxies', () => {
    expect(dotStyle(ADDITIVE_FROM - 1, true).additive).toBe(false);
    expect(dotStyle(ADDITIVE_FROM, true).additive).toBe(true);
    expect(dotStyle(ADDITIVE_FROM, false).additive).toBe(false);
  });

  it('a 0 or bad count is treated as one galaxy', () => {
    expect(dotStyle(0, false)).toEqual(dotStyle(1, false));
    expect(dotStyle(NaN, false).size).toBe(4);
  });
});
