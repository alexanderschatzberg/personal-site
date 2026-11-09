// Bottom-sheet snap logic for the portrait phone layout. Pure; the page measures and animates.
export type Snap = 'collapsed' | 'half' | 'full';
export const SNAPS: readonly Snap[] = ['collapsed', 'half', 'full'];
export interface SnapHeights {
  collapsed: number;
  half: number;
  full: number;
}
/** Release speed (px/ms) above which a drag counts as a flick. */
export const FLICK = 0.5;

/** Sheet heights in px: handle only, ~50dvh and ~90dvh, each capped to the space available. */
export function snapHeights(vh: number, handle: number, avail: number): SnapHeights {
  const cap = (h: number) => Math.max(handle, Math.min(avail, Math.round(h)));
  return { collapsed: handle, half: cap(vh * 0.5), full: cap(vh * 0.9) };
}

export function stepSnap(s: Snap, dir: -1 | 1): Snap {
  const i = SNAPS.indexOf(s) + dir;
  return SNAPS[Math.max(0, Math.min(SNAPS.length - 1, i))];
}

export function cycleSnap(s: Snap): Snap {
  return SNAPS[(SNAPS.indexOf(s) + 1) % SNAPS.length];
}

/** Where the sheet settles when released at height h with velocity v (px/ms, > 0 = growing). */
export function snapAfterDrag(h: number, v: number, hs: SnapHeights): Snap {
  if (v >= FLICK) return SNAPS.find((s) => hs[s] > h) ?? 'full';
  if (v <= -FLICK) return [...SNAPS].reverse().find((s) => hs[s] < h) ?? 'collapsed';
  let best: Snap = 'collapsed';
  for (const s of SNAPS) if (Math.abs(hs[s] - h) < Math.abs(hs[best] - h)) best = s;
  return best;
}
