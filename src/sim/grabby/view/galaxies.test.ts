import { describe, expect, it } from 'vitest';
import { DEFAULT_GALAXIES_3D, DEFAULTS } from '../types';
import { defaultGalaxies, dimGalaxies, startParams } from './galaxies';
import { PHONE_GALAXIES } from './phone';
import { paramsToQuery, queryToParams } from './url';

describe('galaxies default per dim', () => {
  it('is 200k in 2d and 100k in 3d; a phone takes its 50k when lower', () => {
    expect(DEFAULTS.galaxies).toBe(200000);
    expect(DEFAULT_GALAXIES_3D).toBe(100000);
    expect(defaultGalaxies(2, false)).toBe(200000);
    expect(defaultGalaxies(3, false)).toBe(100000);
    expect(defaultGalaxies(2, true)).toBe(PHONE_GALAXIES);
    expect(defaultGalaxies(3, true)).toBe(PHONE_GALAXIES);
  });

  it('starts from the dim default when the URL has no galaxies', () => {
    expect(startParams(false, queryToParams('?dim=3'))).toEqual({
      params: { ...DEFAULTS, dim: 3, galaxies: 100000 },
      heavy: false,
      auto: true,
    });
    expect(startParams(false, queryToParams(''))).toEqual({ params: DEFAULTS, heavy: false, auto: true });
    expect(startParams(true, queryToParams('?dim=3')).params.galaxies).toBe(50000);
    expect(startParams(true, queryToParams('?dim=3')).auto).toBe(true);
  });

  it('honours an explicit URL value in either dim, as not a default', () => {
    expect(startParams(false, queryToParams('?dim=3&galaxies=200000'))).toEqual({
      params: { ...DEFAULTS, dim: 3, galaxies: 200000 },
      heavy: false,
      auto: false,
    });
    expect(startParams(false, queryToParams('?galaxies=100000')).params.galaxies).toBe(100000);
    expect(startParams(true, queryToParams('?dim=3&galaxies=300000'))).toMatchObject({ heavy: true, auto: false });
  });

  it('[2d]/[3d] swaps defaults only while the field shows an untouched default', () => {
    expect(dimGalaxies(3, false, { galaxies: 200000, auto: true })).toBe(100000);
    expect(dimGalaxies(2, false, { galaxies: 100000, auto: true })).toBe(200000);
    expect(dimGalaxies(3, true, { galaxies: 50000, auto: true })).toBe(50000);
    // edited by the user (or set by the URL): kept as is, even if it happens to equal a default
    expect(dimGalaxies(3, false, { galaxies: 200000, auto: false })).toBe(200000);
    expect(dimGalaxies(2, false, { galaxies: 100000, auto: false })).toBe(100000);
    expect(dimGalaxies(3, false, { galaxies: 30000, auto: false })).toBe(30000);
  });

  it('the URL omits galaxies when it equals the default for the current dim', () => {
    expect(paramsToQuery({ ...DEFAULTS, dim: 3, galaxies: 100000 })).toBe('dim=3');
    expect(paramsToQuery({ ...DEFAULTS, dim: 3, galaxies: 200000 })).toBe('dim=3&galaxies=200000');
    expect(paramsToQuery({ ...DEFAULTS, dim: 2, galaxies: 100000 })).toBe('galaxies=100000');
    expect(paramsToQuery(DEFAULTS)).toBe('');
  });

  it('URL → start params → URL is stable in both dims', () => {
    for (const q of ['dim=3', 'dim=3&galaxies=200000', 'galaxies=100000', '', 'dim=3&galaxies=12345']) {
      expect(paramsToQuery(startParams(false, queryToParams('?' + q)).params)).toBe(q);
    }
  });
});
