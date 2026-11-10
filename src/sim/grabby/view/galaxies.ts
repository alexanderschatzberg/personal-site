// The galaxies default depends on dim (3d simulates slower per galaxy) and on the device. Pure.
// A value counts as a default ("auto") until the user edits the field or the URL sets it; only
// then does [2d]/[3d] leave it alone.
import { DEFAULT_GALAXIES_3D, DEFAULTS, type Dim, type Params } from '../types';
import { PHONE_GALAXIES, phoneParams } from './phone';

/** Device-independent default for a dim: what the URL omits. */
export function baseGalaxies(dim: Dim): number {
  return dim === 3 ? DEFAULT_GALAXIES_3D : DEFAULTS.galaxies;
}

/** Default for a dim on this device: the phone default wins whenever it is lower. */
export function defaultGalaxies(dim: Dim, phone: boolean): number {
  const base = baseGalaxies(dim);
  return phone ? Math.min(PHONE_GALAXIES, base) : base;
}

/** The params a run starts from, given the URL's params. auto: galaxies is a default. */
export function startParams(phone: boolean, query: Partial<Params>): { params: Params; heavy: boolean; auto: boolean } {
  const { heavy } = phoneParams(phone, query);
  const params: Params = { ...DEFAULTS, ...query };
  const auto = query.galaxies === undefined;
  if (auto) params.galaxies = defaultGalaxies(params.dim, phone);
  return { params, heavy, auto };
}

/** Galaxies after switching to dim: the new default while the current value is an untouched one. */
export function dimGalaxies(dim: Dim, phone: boolean, current: { galaxies: number; auto: boolean }): number {
  return current.auto ? defaultGalaxies(dim, phone) : current.galaxies;
}
