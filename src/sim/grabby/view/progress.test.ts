import { describe, expect, it } from 'vitest';
import { PROGRESS_MIN_MS, progressText, throttleProgress } from './progress';

describe('worker progress', () => {
  it('posts at most once per PROGRESS_MIN_MS (≤ 10 per second)', () => {
    expect(PROGRESS_MIN_MS).toBeGreaterThanOrEqual(100);
    let now = 0;
    const sent: [string, number][] = [];
    const on = throttleProgress((s, f) => sent.push([s, f]), () => now);
    on('grid', 0); // the first one always goes out
    now = 50;
    on('grid', 0.1); // too soon: dropped
    now = PROGRESS_MIN_MS;
    on('knn', 0.2);
    now = PROGRESS_MIN_MS + 1;
    on('knn', 0.3);
    expect(sent).toEqual([['grid', 0], ['knn', 0.2]]);
  });

  it('a burst of a million calls over one second posts about ten', () => {
    let now = 0;
    let count = 0;
    const on = throttleProgress(() => count++, () => now);
    for (let i = 0; i < 1e6; i++) {
      now = i / 1000; // ms: 0 .. 1000
      on('x', i / 1e6);
    }
    expect(count).toBeLessThanOrEqual(11);
    expect(count).toBeGreaterThanOrEqual(9);
  });

  it('formats a percentage, with the stage when there is one', () => {
    expect(progressText('', 0.4)).toBe('[simulating… 40%]');
    expect(progressText('battles', 0.4)).toBe('[simulating… battles 40%]');
    expect(progressText('battles', 0.996)).toBe('[simulating… battles 99%]'); // never shows 100% early
    expect(progressText('battles', 1)).toBe('[simulating… battles 100%]');
    expect(progressText('kNN', NaN)).toBe('[simulating… kNN]');
    expect(progressText('', NaN)).toBe('[simulating…]');
    expect(progressText('x', -1)).toBe('[simulating… x 0%]');
    expect(progressText('x', 7)).toBe('[simulating… x 100%]');
  });
});
