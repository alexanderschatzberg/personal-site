import { describe, expect, it } from 'vitest';
import { isTap, nearestOnScreen, PICK_RADIUS_PX } from './pick';

describe('picking', () => {
  // screen positions (x, y) per galaxy; NaN = not visible (behind the camera or the globe)
  const xy = new Float32Array([10, 10, 100, 100, 105, 103, NaN, NaN, 300, 40]);

  it('picks the nearest visible galaxy within the radius', () => {
    expect(PICK_RADIUS_PX).toBe(24);
    expect(nearestOnScreen(xy, 104, 104, 24)).toBe(2);
    expect(nearestOnScreen(xy, 99, 99, 24)).toBe(1);
    expect(nearestOnScreen(xy, 290, 50, 24)).toBe(4);
  });

  it('returns -1 when nothing is within the radius', () => {
    expect(nearestOnScreen(xy, 200, 200, 24)).toBe(-1);
    expect(nearestOnScreen(xy, 10, 35, 24)).toBe(-1);
    expect(nearestOnScreen(xy, 10, 34, 24)).toBe(0);
    expect(nearestOnScreen(new Float32Array(0), 0, 0, 24)).toBe(-1);
  });

  it('a tap barely moves and is short; a drag is not a tap', () => {
    expect(isTap(2, 3, 150)).toBe(true);
    expect(isTap(12, 0, 150)).toBe(false);
    expect(isTap(0, 0, 900)).toBe(false);
  });
});
