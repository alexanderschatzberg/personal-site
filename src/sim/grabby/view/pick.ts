// Tap-to-pick helpers. Pure: projection to the screen (with the drawing's own transform) and the
// choice of galaxy. A click opens a region, so only owned galaxies are ever picked.
/** Largest screen distance (CSS px) from a tap to the galaxy it picks. */
export const PICK_RADIUS_PX = 24;
/** In 3d, owned galaxies within this many px of the nearest one compete on depth. */
export const DEPTH_PX = 4;
/** A pointer that moves less than this (CSS px) and lifts within TAP_MS is a tap, not a drag. */
export const TAP_PX = 8;
export const TAP_MS = 500;

/** Index of the nearest (x, y) pair within max px, or -1. NaN pairs are skipped (not visible). */
export function nearestOnScreen(xy: Float32Array, x: number, y: number, max: number): number {
  let best = -1;
  let bestD = max * max;
  for (let i = 0; i < xy.length / 2; i++) {
    const dx = xy[2 * i] - x, dy = xy[2 * i + 1] - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function isTap(dx: number, dy: number, ms: number): boolean {
  return dx * dx + dy * dy < TAP_PX * TAP_PX && ms < TAP_MS;
}

/**
 * The owned galaxy a tap at (x, y) opens, or -1. Among owned galaxies within max px (NaN = hidden),
 * the nearest on screen; with `depth` (3d: smaller = closer to the camera), the closest to the
 * camera among those within DEPTH_PX of that nearest distance.
 */
export function pickOwned(xy: ArrayLike<number>, depth: ArrayLike<number> | null, owner: ArrayLike<number>, x: number, y: number, max: number): number {
  const n = Math.min(owner.length, xy.length / 2);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    if (owner[i] < 0) continue;
    const d = Math.hypot(xy[2 * i] - x, xy[2 * i + 1] - y);
    if (d <= max && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0 || !depth) return best;
  const window = bestD + DEPTH_PX;
  for (let i = 0; i < n; i++) {
    if (owner[i] < 0 || i === best) continue;
    const d = Math.hypot(xy[2 * i] - x, xy[2 * i + 1] - y);
    if (d <= window && d <= max && depth[i] < depth[best]) best = i;
  }
  return best;
}

/** Which side of a surface is hidden: none, a sphere centred on the world origin, or per-point
 *  outward normals (local space, e.g. the donut). `torus` (local space: centred on the origin,
 *  axis along z, major radius R, tube radius r) is an occluder that can also hide camera-facing
 *  points, since a torus is not convex: e.g. the far inner wall behind the near tube. */
export type Facing =
  | { kind: 'none' }
  | { kind: 'sphere' }
  | { kind: 'normals'; normals: ArrayLike<number>; torus?: { R: number; r: number } };

/** Signed distance from (x, y, z) to the torus (axis z, radii R, r): negative inside. */
function torusSdf(x: number, y: number, z: number, R: number, r: number): number {
  return Math.hypot(Math.hypot(x, y) - R, z) - r;
}

/**
 * Whether the solid torus (axis z, radii R, r; same space as p and cam) lies on the segment from
 * point p to the camera, i.e. hides p. Sphere tracing from p: each step is the distance to the
 * surface (it cannot cross it), but at least MIN_STEP × r, so a step that lands inside is a hit.
 * Grazing chords thinner than that step can be missed; nothing that hides a dot is that thin.
 */
export function torusBlocks(p: ArrayLike<number>, cam: ArrayLike<number>, R: number, r: number): boolean {
  const dx = cam[0] - p[0], dy = cam[1] - p[1], dz = cam[2] - p[2];
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 0)) return false;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  const minStep = MIN_STEP * r;
  let t = 0;
  for (let k = 0; k < MAX_STEPS; k++) {
    const d = torusSdf(p[0] + ux * t, p[1] + uy * t, p[2] + uz * t, R, r);
    if (d < 0) return true;
    t += Math.max(d, minStep);
    if (t >= len) return false;
  }
  return false;
}
const MIN_STEP = 1e-3;
const MAX_STEPS = 20000;

/** The camera position in a model's local space (model: column-major affine, invertible). */
function toLocal(m: ArrayLike<number>, cam: ArrayLike<number>): [number, number, number] {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const x = cam[0] - m[12], y = cam[1] - m[13], z = cam[2] - m[14];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    (A * x + (c * h - b * i) * y + (b * f - c * e) * z) / det,
    (B * x + (a * i - c * g) * y + (c * d - a * f) * z) / det,
    (C * x + (b * g - a * h) * y + (a * e - b * d) * z) / det,
  ];
}

/**
 * Screen position (CSS px, viewport) and NDC depth of every point, written to xy / depth. Hidden
 * points (far side of the surface, behind an occluding torus, behind the camera, off screen) get NaN. `model` maps local
 * positions to world; `viewProj` is projection × view; both column-major (three's .elements).
 */
export function projectForPick(
  local: ArrayLike<number>,
  facing: Facing,
  model: ArrayLike<number>,
  viewProj: ArrayLike<number>,
  cam: ArrayLike<number>,
  rect: { left: number; top: number; width: number; height: number },
  xy: Float32Array,
  depth: Float32Array,
) {
  const m = model, v = viewProj;
  const n = Math.floor(local.length / 3);
  const torus = facing.kind === 'normals' ? facing.torus : undefined;
  const camLocal = torus ? toLocal(m, cam) : null;
  const pl = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    xy[2 * i] = xy[2 * i + 1] = depth[i] = NaN;
    const x = local[3 * i], y = local[3 * i + 1], z = local[3 * i + 2];
    const px = m[0] * x + m[4] * y + m[8] * z + m[12];
    const py = m[1] * x + m[5] * y + m[9] * z + m[13];
    const pz = m[2] * x + m[6] * y + m[10] * z + m[14];
    if (facing.kind !== 'none') {
      let nx = px, ny = py, nz = pz; // sphere: the outward normal is the position itself
      if (facing.kind === 'normals') {
        const a = facing.normals[3 * i], b = facing.normals[3 * i + 1], c = facing.normals[3 * i + 2];
        nx = m[0] * a + m[4] * b + m[8] * c;
        ny = m[1] * a + m[5] * b + m[9] * c;
        nz = m[2] * a + m[6] * b + m[10] * c;
      }
      if (nx * (cam[0] - px) + ny * (cam[1] - py) + nz * (cam[2] - pz) <= 0) continue;
    }
    if (torus && camLocal) {
      pl[0] = x;
      pl[1] = y;
      pl[2] = z;
      if (torusBlocks(pl, camLocal, torus.R, torus.r)) continue;
    }
    const w = v[3] * px + v[7] * py + v[11] * pz + v[15];
    if (!(w > 0)) continue;
    const ndcX = (v[0] * px + v[4] * py + v[8] * pz + v[12]) / w;
    const ndcY = (v[1] * px + v[5] * py + v[9] * pz + v[13]) / w;
    if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) continue;
    xy[2 * i] = rect.left + ((ndcX + 1) / 2) * rect.width;
    xy[2 * i + 1] = rect.top + ((1 - ndcY) / 2) * rect.height;
    depth[i] = (v[2] * px + v[6] * py + v[10] * pz + v[14]) / w;
  }
}
