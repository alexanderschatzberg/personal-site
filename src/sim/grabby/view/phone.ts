// Phone defaults: lighter runs on small touch devices. Pure; the page passes in the flags.
import type { Params } from '../types';

/** Galaxies for a phone run when the URL doesn't set them. */
export const PHONE_GALAXIES = 50000;
/** Largest galaxies value the phone drawer accepts (a URL may still ask for more). */
export const PHONE_GALAXY_CAP = 200000;
/** Largest device pixel ratio the renderer uses. */
export const MAX_PIXEL_RATIO = 2;

export interface Device {
  /** matchMedia('(pointer: coarse)') */
  coarse: boolean;
  /** screen.width / screen.height, CSS px */
  screenW: number;
  screenH: number;
}

export function isPhone(d: Device): boolean {
  return d.coarse && Math.min(d.screenW, d.screenH) <= 600;
}

/**
 * The params a run starts from, given the URL's params. On a phone with no galaxies in the URL,
 * use PHONE_GALAXIES. A URL value is always honoured; above the cap it is flagged as heavy.
 */
export function phoneParams(phone: boolean, query: Partial<Params>): { params: Partial<Params>; heavy: boolean } {
  if (!phone) return { params: { ...query }, heavy: false };
  if (query.galaxies === undefined) return { params: { ...query, galaxies: PHONE_GALAXIES }, heavy: false };
  return { params: { ...query }, heavy: query.galaxies > PHONE_GALAXY_CAP };
}

/** The drawer's galaxies value on apply. Over the phone cap it is cut to the cap, unless it is
 *  the run's current value (an honoured URL value the user didn't touch). */
export function capGalaxies(phone: boolean, v: number, current: number): number {
  if (!phone || v <= PHONE_GALAXY_CAP || v === current) return v;
  return PHONE_GALAXY_CAP;
}
