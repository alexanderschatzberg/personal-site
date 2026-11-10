import { describe, expect, it } from 'vitest';
import { DEFAULTS, RANGES, type Params } from '../types';
import { FIELDS, fromInput, toInput } from './fields';
import { MAX_SEED_LENGTH, paramsToQuery, queryToParams } from './url';

const roundTrip = (p: Params): Params => ({ ...DEFAULTS, ...queryToParams('?' + paramsToQuery(p)) });

/** What the page does on [apply]: params → input boxes → read back → URL → reload. */
function throughForm(p: Params): Params {
  const next = { ...p };
  for (const f of FIELDS) next[f.key] = fromInput(toInput(p[f.key]))!;
  return roundTrip(next);
}

describe('url', () => {
  it('defaults give an empty query', () => {
    expect(paramsToQuery(DEFAULTS)).toBe('');
  });

  it('round-trips full-precision values, through the form as well', () => {
    const p: Params = {
      ...DEFAULTS,
      dim: 3,
      geometry: 'torus',
      sizeGly: 93.123456789,
      galaxies: 12345,
      pLife: 1.2345678901234e-22,
      planetsPerGalaxy: 123456789012,
      speedMin: 0.30000000000000004,
      H0: 0,
      omegaLambda: 0.7123456789,
      tEndGyr: 333.3333333333333,
      lifeWindowGyr: 12.345678901234,
      mightModel: 'frontier',
      seed: 'hello world/&?=#',
    };
    expect(roundTrip(p)).toEqual(p);
    expect(throughForm(p)).toEqual(p);
  });

  it('ignores or clamps hostile values', () => {
    const q = queryToParams(
      '?galaxies=1e999&sizeGly=-5&pLife=NaN&H0=abc&omegaLambda=7&dim=4&geometry=hyperbolic' +
        '&mightModel=__proto__&seed=%20%20&tEndGyr=&speedMax=0x10&__proto__=1&constructor=2',
    );
    expect(q).toEqual({ sizeGly: RANGES.sizeGly[0], omegaLambda: RANGES.omegaLambda[1], speedMax: RANGES.speedMax[1] });
  });

  it('sphere is dropped in 3d', () => {
    expect(queryToParams('?dim=3&geometry=sphere').geometry).toBe('flat');
  });

  it('truncates a long seed without splitting a character, and that seed round-trips', () => {
    const long = 'a'.repeat(MAX_SEED_LENGTH - 1) + '🚀🚀';
    const seed = queryToParams('?' + new URLSearchParams({ seed: long })).seed!;
    expect(seed.isWellFormed()).toBe(true);
    expect(seed.startsWith('a'.repeat(MAX_SEED_LENGTH - 1))).toBe(true);
    expect(roundTrip({ ...DEFAULTS, seed }).seed).toBe(seed);
  });
});
