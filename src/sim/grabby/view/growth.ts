// How the universe's growth is shown. Rendered positions are physical (comoving × a(t)), and the
// camera's auto-zoom divides by max(a, 1): before today the universe visibly grows from a dense
// start, after today the map holds still while the scale bar and the a readout keep the true values.
// Net effect on the drawing: comoving × d(t), with d(t) = min(a(t), 1).

/** Guard: an overflowed (Infinity) or NaN sample is read as the largest finite double. */
const finite = (v: number) => (v < Number.MAX_VALUE ? v : Number.MAX_VALUE);

/** Scale factor at time t from samples evenly spaced over [0, tEnd]. Missing → 1. */
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

/** a(t) of a run: SimResult.scale is sampled over [0, tLast]. */
export function runScaleAt(r: { scale?: ArrayLike<number>; tLast: number }, t: number): number {
  return scaleAt(r.scale, r.tLast, t);
}

/** Effective display scale d(t) = min(a, 1); 1 with no expansion (H0 = 0). */
export function displayScale(a: number, H0: number): number {
  if (H0 === 0) return 1;
  const x = finite(a);
  return x <= 1 ? Math.max(0, x) : 1;
}

/** Physical Gly per rendered (comoving × d) world unit: a / d. Equal to 1 while a ≤ 1. */
export function physicalPerRendered(a: number, s: number): number {
  const x = finite(a);
  return x <= 1 || !(s > 0) || !Number.isFinite(s) ? 1 : x / s;
}

/** The a(t) readout: 2 significant digits below 0.01, 2 decimals up to 1e6, then exponent
 *  notation like 1.00e66 (toFixed would print a long exponent string from 1e21 up). */
export function formatA(a: number): string {
  if (a > 0 && a < 0.01) return a.toPrecision(2);
  if (Math.abs(a) < 1e6) return a.toFixed(2);
  return a.toExponential(2).replace('e+', 'e');
}
