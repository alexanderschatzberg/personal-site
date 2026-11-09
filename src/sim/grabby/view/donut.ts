// The 2d torus drawn as a donut. The simulation metric stays the flat torus (minimum image);
// only drawing, borders and picking go through this embedding. u = x/size and v = y/size are
// the two angles: u runs round the hole, v round the tube. The donut lies in the xy plane,
// centred on the origin, with its axis along z.

/** Tube radius over major radius: R = 2.5 r. */
export const DONUT_RATIO = 2.5;
/** Lift of the borders off the surface so they are not hidden by the occluder. */
export const DONUT_LIFT = 1.004;

/** Major radius R and tube radius r for a torus of side `size`, sized so the donut is as wide
 *  as the flat square (2 (R + r) = size). */
export function donutRadii(size: number): { R: number; r: number } {
  const r = size / (2 * (DONUT_RATIO + 1));
  return { R: DONUT_RATIO * r, r };
}

/**
 * Surface point for flat-torus coordinates (x, y) of side `size`, `lift` × r off the tube's
 * centre circle, written to p; the outward unit normal is written to n.
 */
export function embedDonut(x: number, y: number, size: number, R: number, r: number, lift: number, p: Float64Array | Float32Array, n: Float64Array | Float32Array) {
  const u = (2 * Math.PI * x) / size, v = (2 * Math.PI * y) / size;
  const cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
  const ring = R + r * lift * cv;
  p[0] = ring * cu;
  p[1] = ring * su;
  p[2] = r * lift * sv;
  n[0] = cv * cu;
  n[1] = cv * su;
  n[2] = sv;
}

/** Donut positions and outward normals for comoving positions (z ignored), xyz per galaxy. */
export function embedPositions(positions: ArrayLike<number>, size: number): { world: Float32Array; normals: Float32Array } {
  const { R, r } = donutRadii(size);
  const count = Math.floor(positions.length / 3);
  const world = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const p = new Float64Array(3), n = new Float64Array(3);
  for (let i = 0; i < count; i++) {
    embedDonut(positions[3 * i], positions[3 * i + 1], size, R, r, 1, p, n);
    world.set(p, 3 * i);
    normals.set(n, 3 * i);
  }
  return { world, normals };
}

/** A point is on the near side when the camera is outside its tangent plane: n · (cam − p) > 0. */
export function facesCamera(p: ArrayLike<number>, n: ArrayLike<number>, cam: ArrayLike<number>): boolean {
  return n[0] * (cam[0] - p[0]) + n[1] * (cam[1] - p[1]) + n[2] * (cam[2] - p[2]) > 0;
}

const scratchN = new Float64Array(3);
const scratchP = new Float64Array(3);

/** Map a flat-torus border segment [x0,y0,z0, x1,y1,z1] onto the donut, just above the surface. */
export function donutSegment(seg: ArrayLike<number>, size: number, R: number, r: number, out: Float64Array | Float32Array) {
  for (let e = 0; e < 2; e++) {
    embedDonut(seg[3 * e], seg[3 * e + 1], size, R, r, DONUT_LIFT, scratchP, scratchN);
    out[3 * e] = scratchP[0];
    out[3 * e + 1] = scratchP[1];
    out[3 * e + 2] = scratchP[2];
  }
}
