import { describe, expect, it } from 'vitest';
import { advance, BASE_SECONDS, endStatus, nextSpeed, rateGyrPerSecond, SPEEDS, span, step } from './playback';

describe('playback', () => {
  it('1× crosses the span in BASE_SECONDS; faster speeds scale it', () => {
    expect(rateGyrPerSecond(120, 0) * BASE_SECONDS).toBeCloseTo(120);
    SPEEDS.forEach((s, i) => expect(rateGyrPerSecond(120, i)).toBeCloseTo((120 / BASE_SECONDS) * s));
  });

  it('advance moves forwards only and clamps at the end of the span', () => {
    expect(advance(10, 1, 120, 0)).toBeCloseTo(12);
    expect(advance(10, -5, 120, 0)).toBe(10);
    expect(advance(119, 100, 120, 2)).toBe(120);
  });

  it('speed cycles and steps clamp to [0, span]', () => {
    expect(nextSpeed(SPEEDS.length - 1)).toBe(0);
    expect(step(0, -1, 100)).toBe(0);
    expect(step(100, 1, 100)).toBe(100);
    expect(step(50, 1, 100)).toBeCloseTo(51);
  });

  it('the span is tLast, capped by the safety cap tEndGyr', () => {
    expect(span({ tLast: 42, params: { tEndGyr: 200 } })).toBe(42);
    expect(span({ tLast: 200, params: { tEndGyr: 200 } })).toBe(200);
    expect(span({ tLast: 250, params: { tEndGyr: 200 } })).toBe(200);
    expect(span({ tLast: Number.NaN, params: { tEndGyr: 200 } })).toBe(200);
  });

  it('reports why the run ended, only once the end is reached', () => {
    expect(endStatus(10, 42, 200)).toBeNull();
    expect(endStatus(42, 42, 200)).toBe('ended · no more galaxies in reach');
    expect(endStatus(200, 200, 200)).toBe('ended · cap reached');
  });
});
