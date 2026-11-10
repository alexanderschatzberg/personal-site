// How the galaxies' dots look for a given count. Display constants only; pure.
// Small runs: fewer, bigger, opaque dots (3·√(4000/n) CSS px, between 1.5 and 4).
// Large runs: from DOTS_TAPER_FROM to DOTS_FULL_FROM galaxies the smallest size and the opacity
// fall log-linearly, so dense filaments add up to brighter lines instead of a solid blob.

/** Galaxies at which the taper starts (below this: the original look). */
export const DOTS_TAPER_FROM = 50000;
/** Galaxies at which the taper ends (and stays). */
export const DOTS_FULL_FROM = 1e6;
/** Largest dot, CSS px (tiny runs). */
export const DOT_MAX_PX = 4;
/** Smallest dot below the taper, and at its end, CSS px. */
export const DOT_MIN_PX = 1.5;
export const DOT_MIN_PX_FULL = 1;
/** Opacity at the end of the taper: dark theme (dots glow on black) and light theme (pale dots
 *  on a light page wash out sooner, so they stay more opaque). */
export const DOT_OPACITY_DARK_FULL = 0.55;
export const DOT_OPACITY_LIGHT_FULL = 0.7;
/** Dark theme from this many galaxies: additive blending, so overlapping dots brighten. */
export const ADDITIVE_FROM = 200000;

export interface DotStyle {
  /** CSS px (three multiplies by the pixel ratio). */
  size: number;
  opacity: number;
  additive: boolean;
}

export function dotStyle(count: number, dark: boolean): DotStyle {
  const n = Number.isFinite(count) ? Math.max(1, count) : 1;
  // 0 at the taper start, 1 at its end.
  const u = Math.min(1, Math.max(0, Math.log(n / DOTS_TAPER_FROM) / Math.log(DOTS_FULL_FROM / DOTS_TAPER_FROM)));
  const floor = DOT_MIN_PX_FULL + (DOT_MIN_PX - DOT_MIN_PX_FULL) * (1 - u);
  const size = Math.max(floor, Math.min(DOT_MAX_PX, 3 * Math.sqrt(4000 / n)));
  const full = dark ? DOT_OPACITY_DARK_FULL : DOT_OPACITY_LIGHT_FULL;
  const opacity = full + (1 - full) * (1 - u);
  return { size, opacity, additive: dark && n >= ADDITIVE_FROM };
}
