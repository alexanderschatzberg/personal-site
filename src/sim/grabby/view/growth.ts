// How the universe's growth is shown. Real a(t) spans tiny → huge, so the view shows true
// size up to today (a ≤ 1) and grows only logarithmically after that.

/** Largest finite Float32: an overflowed (Infinity) or NaN sample is read as this. */
const F32_MAX = 3.4028234663852886e38;
const finite = (v: number) => (v < F32_MAX ? v : F32_MAX);

/** Scale factor at time t from SimResult.scale (evenly spaced over [0, tEnd]). Missing → 1. */
export function scaleAt(scale: ArrayLike<number> | undefined, tEnd: number, t: number): number {
  const n = scale?.length ?? 0;
  if (!scale || n === 0) return 1;
  if (n === 1 || !(tEnd > 0)) return finite(scale[0]);
  const x = (Math.min(tEnd, Math.max(0, t)) / tEnd) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  const lo = finite(scale[i]), hi = finite(scale[i + 1]);
  return lo + (hi - lo) * f;
}

/** Displayed scale s(a): a when a ≤ 1, 1 + ln a when a > 1, and 1 with no expansion (H0 = 0). */
export function displayScale(a: number, H0: number): number {
  if (H0 === 0) return 1;
  const x = finite(a); // only ln a is shown, so Infinity / NaN → the Float32 max is plenty
  return x <= 1 ? Math.max(0, x) : 1 + Math.log(x);
}

/** Physical Gly per rendered (comoving × s) world unit: a / s. Equal to 1 while a ≤ 1. */
export function physicalPerRendered(a: number, s: number): number {
  const x = finite(a);
  return x <= 1 || !(s > 0) || !Number.isFinite(s) ? 1 : x / s;
}
