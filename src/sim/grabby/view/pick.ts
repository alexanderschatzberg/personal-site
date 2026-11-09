// Tap-to-pick helpers. Pure; the renderer projects galaxies to screen space.
/** Largest screen distance (CSS px) from a tap to the galaxy it picks. */
export const PICK_RADIUS_PX = 24;
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
