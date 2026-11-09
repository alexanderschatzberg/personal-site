// Playback rate maths. At 1× a run crosses [0, tEnd] in BASE_SECONDS of wall time.
export const SPEEDS = [1, 4, 16] as const;
export const BASE_SECONDS = 60;
/** Fraction of tEnd moved by one ←/→ key press. */
export const STEP_FRACTION = 0.01;

export function rateGyrPerSecond(tEnd: number, speedIndex: number): number {
  return (tEnd / BASE_SECONDS) * SPEEDS[speedIndex % SPEEDS.length];
}

/** Advance t by dtSeconds of wall time. Returns the new time, clamped to tEnd. */
export function advance(t: number, dtSeconds: number, tEnd: number, speedIndex: number): number {
  return Math.min(tEnd, t + Math.max(0, dtSeconds) * rateGyrPerSecond(tEnd, speedIndex));
}

export function nextSpeed(speedIndex: number): number {
  return (speedIndex + 1) % SPEEDS.length;
}

export function step(t: number, dir: -1 | 1, tEnd: number): number {
  return Math.min(tEnd, Math.max(0, t + dir * tEnd * STEP_FRACTION));
}
