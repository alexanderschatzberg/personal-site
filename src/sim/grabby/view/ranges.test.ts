import { describe, expect, it } from 'vitest';
import { updateRanges } from './ranges';

const idx = (...a: number[]) => Int32Array.from(a);

describe('colour upload ranges', () => {
  it('coalesces contiguous and duplicate galaxies, in float units', () => {
    // galaxies 3,4,5 and 9 (unsorted, with a duplicate), 3 floats each, of 100 galaxies
    expect(updateRanges(idx(9, 4, 3, 5, 4), 5, 100, 3)).toEqual([
      { start: 9, count: 9 },
      { start: 27, count: 3 },
    ]);
  });

  it('only reads the first `count` entries', () => {
    expect(updateRanges(idx(1, 50, 60), 1, 100, 3)).toEqual([{ start: 3, count: 3 }]);
  });

  it('nothing changed → no ranges', () => {
    expect(updateRanges(idx(), 0, 100, 3)).toEqual([]);
  });

  it('falls back to a full upload (null) above 25% changed', () => {
    const many = Int32Array.from({ length: 26 }, (_, i) => i * 2);
    expect(updateRanges(many, 26, 100, 3)).toBeNull();
    expect(updateRanges(many, 25, 100, 3)).not.toBeNull();
  });
});
