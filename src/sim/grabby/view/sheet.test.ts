import { describe, expect, it } from 'vitest';
import { cycleSnap, snapAfterDrag, snapHeights, stepSnap } from './sheet';

describe('bottom sheet snaps', () => {
  it('heights: handle only, about 50dvh, about 90dvh, never above the space available', () => {
    expect(snapHeights(800, 44, 760)).toEqual({ collapsed: 44, half: 400, full: 720 });
    expect(snapHeights(800, 44, 600)).toEqual({ collapsed: 44, half: 400, full: 600 });
    expect(snapHeights(800, 44, 300)).toEqual({ collapsed: 44, half: 300, full: 300 });
  });

  it('tap (handle or [≡]) cycles collapsed → half → full → collapsed', () => {
    expect(cycleSnap('collapsed')).toBe('half');
    expect(cycleSnap('half')).toBe('full');
    expect(cycleSnap('full')).toBe('collapsed');
  });

  it('keys step up and down and stop at the ends', () => {
    expect(stepSnap('collapsed', 1)).toBe('half');
    expect(stepSnap('half', 1)).toBe('full');
    expect(stepSnap('full', 1)).toBe('full');
    expect(stepSnap('full', -1)).toBe('half');
    expect(stepSnap('collapsed', -1)).toBe('collapsed');
  });

  const hs = { collapsed: 44, half: 400, full: 720 };
  it('a slow drag lands on the nearest snap', () => {
    expect(snapAfterDrag(100, 0, hs)).toBe('collapsed');
    expect(snapAfterDrag(300, 0, hs)).toBe('half');
    expect(snapAfterDrag(600, 0, hs)).toBe('full');
    expect(snapAfterDrag(2000, 0, hs)).toBe('full');
  });

  it('a flick goes one snap further in its direction (velocity > 0 = growing)', () => {
    expect(snapAfterDrag(420, 1, hs)).toBe('full');
    expect(snapAfterDrag(380, -1, hs)).toBe('collapsed');
    expect(snapAfterDrag(100, 1, hs)).toBe('half');
    expect(snapAfterDrag(700, 1, hs)).toBe('full');
    expect(snapAfterDrag(60, -1, hs)).toBe('collapsed');
  });
});
