import { describe, expect, it } from 'vitest';
import { embedPositions } from './donut';
import { DEPTH_PX, isTap, nearestOnScreen, PICK_RADIUS_PX, pickOwned, projectForPick } from './pick';

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

describe('pick an owned galaxy (a region)', () => {
  it('2d: ignores unclaimed galaxies, even nearer ones', () => {
    const xy = new Float32Array([100, 100, 110, 100, 300, 300]);
    const owner = new Int32Array([-1, 3, -1]);
    expect(pickOwned(xy, null, owner, 101, 100, PICK_RADIUS_PX)).toBe(1);
  });

  it('2d: nothing owned within ~24 px picks nothing', () => {
    const xy = new Float32Array([100, 100, 130, 100]);
    expect(pickOwned(xy, null, new Int32Array([-1, 0]), 100, 100, PICK_RADIUS_PX)).toBe(-1);
    expect(pickOwned(xy, null, new Int32Array([-1, -1]), 100, 100, PICK_RADIUS_PX)).toBe(-1);
  });

  it('2d: the nearest owned on screen wins', () => {
    const xy = new Float32Array([100, 100, 105, 100, 112, 100]);
    expect(pickOwned(xy, null, new Int32Array([0, 1, 2]), 111, 100, PICK_RADIUS_PX)).toBe(2);
  });

  it('3d: among owned galaxies within a few px, the one closest to the camera wins', () => {
    // 0 is nearest on screen but far away in depth; 1 is DEPTH_PX − 1 further on screen and in front
    const xy = new Float32Array([200, 200, 200 + DEPTH_PX - 1, 200, 200 + DEPTH_PX + 8, 200]);
    const depth = new Float32Array([0.9, 0.2, 0.1]);
    const owner = new Int32Array([0, 1, 2]);
    expect(pickOwned(xy, depth, owner, 200, 200, PICK_RADIUS_PX)).toBe(1);
    // beyond the few px, screen distance decides even though 2 is in front
    expect(pickOwned(xy, depth, new Int32Array([0, -1, 2]), 200, 200, PICK_RADIUS_PX)).toBe(0);
    // an unclaimed galaxy in front never wins
    expect(pickOwned(xy, depth, new Int32Array([0, -1, -1]), 200, 200, PICK_RADIUS_PX)).toBe(0);
  });

  it('projects with the same transform as the drawing and hides the far side of the donut', () => {
    // Identity view-projection: ndc = (x, y), depth = z. Content scaled by 0.01 (user zoom × d(t)).
    const L = 70;
    const { world, normals } = embedPositions(new Float32Array([10, L / 4, 0, 10, (3 * L) / 4, 0]), L); // top, bottom
    const model = [0.01, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 1];
    const viewProj = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]; // camera looks down −z from +z
    const rect = { left: 0, top: 0, width: 200, height: 200 };
    const xy = new Float32Array(4), depth = new Float32Array(2);
    projectForPick(world, { kind: 'normals', normals }, model, viewProj, [0, 0, 100], rect, xy, depth);
    // top and bottom of the tube share a screen point; only the top is visible
    expect(Number.isFinite(xy[0])).toBe(true);
    expect(Number.isNaN(xy[2])).toBe(true);
    const sx = xy[0], sy = xy[1];
    expect(sx).toBeCloseTo(100 + 100 * 0.01 * world[0], 3);
    expect(sy).toBeCloseTo(100 - 100 * 0.01 * world[1], 3);
    expect(pickOwned(xy, depth, new Int32Array([0, 1]), sx, sy, PICK_RADIUS_PX)).toBe(0);
    expect(pickOwned(xy, depth, new Int32Array([-1, 1]), sx, sy, PICK_RADIUS_PX)).toBe(-1);
  });

  it('hides the far side of the globe and points off screen', () => {
    const world = new Float32Array([0, 0, 0.5, 0, 0, -0.5, 5, 0, 0]);
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const xy = new Float32Array(6), depth = new Float32Array(3);
    projectForPick(world, { kind: 'sphere' }, id, id, [0, 0, 10], { left: 0, top: 0, width: 100, height: 100 }, xy, depth);
    expect(Number.isFinite(xy[0])).toBe(true);
    expect(Number.isNaN(xy[2])).toBe(true);
    projectForPick(world, { kind: 'none' }, id, id, [0, 0, 10], { left: 0, top: 0, width: 100, height: 100 }, xy, depth);
    expect(Number.isFinite(xy[2])).toBe(true); // no surface: the back point is not hidden
    expect(Number.isNaN(xy[4])).toBe(true); // x = 5 is off screen
  });
});
