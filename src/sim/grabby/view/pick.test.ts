import { describe, expect, it } from 'vitest';
import { DEPTH_PX, isTap, nearestOnScreen, PICK_RADIUS_PX, pickOwned, projectForPick, torusBlocks } from './pick';
import { donutRadii, embedPositions } from './donut';

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

describe('donut self-occlusion (a torus is not convex)', () => {
  // The renderer's setup: side L, occluder tube 0.985 r, the group tilted about x towards
  // edge-on, a 40° perspective camera on +z at the default fit distance (square viewport).
  const L = 93;
  const { R, r } = donutRadii(L);
  const tilt = -1.4;
  const fov = 40;
  const D = ((R + r) * 1.3) / Math.tan(((fov / 2) * Math.PI) / 180);
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const rect = { left: 0, top: 0, width: 400, height: 400 };
  // flat-torus coords: x runs round the hole (u = 2πx/L), y round the tube (v = 2πy/L)
  const farInner = [L / 4, L / 2, 0]; // u = π/2 (far half), v = π: inner wall, faces the camera
  const nearTop = [(3 * L) / 4, L / 4, 0]; // u = 3π/2 (near half), v = π/2: top of the near tube
  const nearOuter = [(3 * L) / 4, 0, 0]; // u = 3π/2, v = 0: outer wall of the near tube

  // The drawing's transform: user zoom × display scale k, a pan T, then the tilt. The camera sits
  // at T + (0, 0, k D), so the view is the same at any k and T.
  function setup(k: number, T: number[]) {
    const model = [k, 0, 0, 0, 0, k * c, k * s, 0, 0, -k * s, k * c, 0, T[0], T[1], T[2], 1];
    const cam = [T[0], T[1], T[2] + k * D];
    const f = 1 / Math.tan(((fov / 2) * Math.PI) / 180), near = 0.001, far = 1e5;
    const A = -(far + near) / (far - near), B = (-2 * far * near) / (far - near);
    // projection × translate(−cam), column-major
    const viewProj = [f, 0, 0, 0, 0, f, 0, 0, 0, 0, A, -1, -f * cam[0], -f * cam[1], -A * cam[2] + B, cam[2]];
    return { model, cam, viewProj, f };
  }

  for (const [k, T] of [
    [1, [0, 0, 0]],
    [0.013, [4, -3, 7]],
  ] as [number, number[]][]) {
    it(`rejects a camera-facing inner-wall point hidden behind the near tube; keeps near-tube points (k ${k})`, () => {
      const { model, cam, viewProj, f } = setup(k, T);
      const { world, normals } = embedPositions(new Float32Array([...farInner, ...nearTop, ...nearOuter]), L);
      // the far inner-wall point passes the back-face test, so only an occlusion test can hide it
      const p = [world[0], c * world[1] - s * world[2], s * world[1] + c * world[2]];
      const n = [normals[0], c * normals[1] - s * normals[2], s * normals[1] + c * normals[2]];
      expect(n[0] * (0 - p[0]) + n[1] * (0 - p[1]) + n[2] * (D - p[2])).toBeGreaterThan(0);

      const xy = new Float32Array(6), depth = new Float32Array(3);
      projectForPick(world, { kind: 'normals', normals, torus: { R, r: 0.985 * r } }, model, viewProj, cam, rect, xy, depth);
      expect(Number.isNaN(xy[0])).toBe(true);
      expect(Number.isFinite(xy[2])).toBe(true);
      expect(Number.isFinite(xy[4])).toBe(true);
      // a tap right where the hidden owned galaxy projects does not open it
      const tapX = 200 + (200 * f * p[0]) / (D - p[2]), tapY = 200 - (200 * f * p[1]) / (D - p[2]);
      expect(pickOwned(xy, depth, new Int32Array([0, -1, -1]), tapX, tapY, PICK_RADIUS_PX)).toBe(-1);
      // without the occluder (back-face test only) it would have been picked
      projectForPick(world, { kind: 'normals', normals }, model, viewProj, cam, rect, xy, depth);
      expect(pickOwned(xy, depth, new Int32Array([0, -1, -1]), tapX, tapY, PICK_RADIUS_PX)).toBe(0);
    });
  }

  it('torusBlocks agrees with a fine brute-force march over the whole donut', () => {
    const rho = 0.985 * r;
    const inside = (x: number, y: number, z: number) => (Math.hypot(x, y) - R) ** 2 + z * z < rho * rho;
    // camera in the donut's local frame (inverse rotation of (0, 0, D))
    const cam = [0, s * D, c * D];
    let disagree = 0, blocked = 0, total = 0;
    for (let i = 0; i < 60; i++)
      for (let j = 0; j < 60; j++) {
        const u = (2 * Math.PI * i) / 60, v = (2 * Math.PI * j) / 60;
        const P = [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)];
        let brute = false;
        for (let k = 1; k < 4000 && !brute; k++) {
          const t = k / 4000;
          brute = inside(P[0] + (cam[0] - P[0]) * t, P[1] + (cam[1] - P[1]) * t, P[2] + (cam[2] - P[2]) * t);
        }
        const fast = torusBlocks(P, cam, R, rho);
        total++;
        if (brute) blocked++;
        if (brute !== fast) disagree++;
      }
    expect(blocked).toBeGreaterThan(total / 2); // back-facing (about half) plus self-occluded
    expect(disagree).toBe(0);
  });
});
