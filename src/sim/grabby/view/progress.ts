// Progress of a long run, posted from the worker and shown in the status line. Pure.

/** Smallest gap between two progress posts from the worker (so at most 10 per second). */
export const PROGRESS_MIN_MS = 100;

export type OnProgress = (stage: string, frac: number) => void;

/** Wraps `post` so it fires at most once per PROGRESS_MIN_MS; calls in between are dropped. */
export function throttleProgress(post: OnProgress, now: () => number = () => performance.now()): OnProgress {
  let last = -Infinity;
  return (stage, frac) => {
    const t = now();
    if (t - last < PROGRESS_MIN_MS) return;
    last = t;
    post(stage, frac);
  };
}

/** Status text: `[simulating… stage 40%]`. The percentage rounds down and is left out when
 *  frac is not a number; an empty stage is left out. */
export function progressText(stage: string, frac: number): string {
  const parts = ['simulating…'];
  if (stage) parts.push(stage);
  if (Number.isFinite(frac)) parts.push(`${Math.floor(Math.min(1, Math.max(0, frac)) * 100)}%`);
  return `[${parts.join(' ')}]`;
}
