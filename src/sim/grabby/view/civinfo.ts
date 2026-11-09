// Tap-for-info card maths. Pure: the page passes in the civ, the timeline counts and, for the
// frontier model, the civ's galaxies within the radius of the tapped galaxy.
import type { MightModel } from '../types';
import { fmt } from './fields';

export type Temperament = 'peaceful' | 'wary' | 'aggressive';

export function temperamentWord(t: number): Temperament {
  return t < 0.33 ? 'peaceful' : t < 0.67 ? 'wary' : 'aggressive';
}

export function civName(id: number): string {
  return `civ-${String(id).padStart(2, '0')}`;
}

/**
 * Might now, as the engine computes it in a battle (engine.ts `might`):
 * power base·N^α, log base·ln(1+N), frontier base·max(1, own galaxies within the radius of the
 * contested galaxy). `local` is that frontier count, or null if it wasn't evaluated (→ null).
 */
export function currentMight(model: MightModel, base: number, held: number, exponent: number, local: number | null): number | null {
  switch (model) {
    case 'power':
      return base * Math.pow(held, exponent);
    case 'log':
      return base * Math.log(1 + held);
    case 'frontier':
      return local === null ? null : base * Math.max(1, local);
  }
}

const sig = (v: number) => fmt(Number(v.toPrecision(3)));

/** Card text for the current might. Frontier spells out base × local. */
export function mightText(model: MightModel, base: number, might: number | null, local: number | null): string {
  if (might === null) return '—';
  if (model === 'frontier' && local !== null) return `${sig(base)} × ${Math.max(1, local)} = ${sig(might)}`;
  return sig(might);
}

/** During playback the card's frontier count (O(galaxies) when the radius is large) is redone at most this often. */
export const LOCAL_COUNT_THROTTLE_MS = 250;

/** The last frontier count shown: galaxy g owned by civ, counted at time `at` (ms). */
export interface LocalCountCache {
  g: number;
  civ: number;
  at: number;
  count: number;
}

/**
 * Show the cached frontier count instead of recounting? Only while playing, for the same
 * galaxy and owner, within LOCAL_COUNT_THROTTLE_MS. A paused seek, a new pick or a change of
 * owner always recounts.
 */
export function reuseLocalCount(cache: LocalCountCache | null, g: number, civ: number, now: number, playing: boolean): boolean {
  return !!cache && playing && cache.g === g && cache.civ === civ && now - cache.at < LOCAL_COUNT_THROTTLE_MS;
}
