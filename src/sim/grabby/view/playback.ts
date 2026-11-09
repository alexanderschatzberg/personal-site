// Playback rate maths. Time runs over [0, span], where span is the run's tLast (the last
// event, or the hidden safety cap tEndGyr if the run went that far). At 1× a run crosses it in BASE_SECONDS.
export const SPEEDS = [1, 4, 16] as const;
export const BASE_SECONDS = 60;
/** Fraction of the span moved by one ←/→ key press. */
export const STEP_FRACTION = 0.01;

/** The playable span of a run: tLast, capped by the safety cap (tEnd if tLast is unusable). */
export function span(r: { tLast: number; params: { tEndGyr: number } }): number {
  const tEnd = r.params.tEndGyr;
  return Number.isFinite(r.tLast) ? Math.min(tEnd, Math.max(0, r.tLast)) : tEnd;
}

export function rateGyrPerSecond(tSpan: number, speedIndex: number): number {
  return (tSpan / BASE_SECONDS) * SPEEDS[speedIndex % SPEEDS.length];
}

/** Advance t by dtSeconds of wall time. Returns the new time, clamped to tSpan. */
export function advance(t: number, dtSeconds: number, tSpan: number, speedIndex: number): number {
  return Math.min(tSpan, t + Math.max(0, dtSeconds) * rateGyrPerSecond(tSpan, speedIndex));
}

export function nextSpeed(speedIndex: number): number {
  return (speedIndex + 1) % SPEEDS.length;
}

export function step(t: number, dir: -1 | 1, tSpan: number): number {
  return Math.min(tSpan, Math.max(0, t + dir * tSpan * STEP_FRACTION));
}

/** Readout text once time reaches the end of the run, else null. */
export function endStatus(t: number, tLast: number, tEnd: number): string | null {
  if (t < Math.min(tLast, tEnd)) return null;
  return tLast >= tEnd ? 'ended · cap reached' : 'ended · no more galaxies in reach';
}
