import { describe, expect, it } from 'vitest';
import { capGalaxies, isPhone, PHONE_GALAXIES, PHONE_GALAXY_CAP, phoneParams } from './phone';

describe('phone defaults', () => {
  it('a phone is a coarse pointer with a short screen side ≤ 600', () => {
    expect(isPhone({ coarse: true, screenW: 390, screenH: 844 })).toBe(true);
    expect(isPhone({ coarse: true, screenW: 844, screenH: 390 })).toBe(true);
    expect(isPhone({ coarse: true, screenW: 600, screenH: 900 })).toBe(true);
    expect(isPhone({ coarse: true, screenW: 820, screenH: 1180 })).toBe(false); // tablet
    expect(isPhone({ coarse: false, screenW: 390, screenH: 844 })).toBe(false); // narrow desktop window
  });

  it('uses 2000 galaxies on a phone when the URL has none', () => {
    expect(PHONE_GALAXIES).toBe(2000);
    expect(phoneParams(true, { seed: 'x' })).toEqual({ params: { seed: 'x', galaxies: 2000 }, heavy: false });
  });

  it('leaves desktop params alone', () => {
    expect(phoneParams(false, { seed: 'x' })).toEqual({ params: { seed: 'x' }, heavy: false });
    expect(phoneParams(false, { galaxies: 40000 })).toEqual({ params: { galaxies: 40000 }, heavy: false });
  });

  it('honours a URL galaxies value on a phone, flagging one above the cap as heavy', () => {
    expect(PHONE_GALAXY_CAP).toBe(15000);
    expect(phoneParams(true, { galaxies: 8000 })).toEqual({ params: { galaxies: 8000 }, heavy: false });
    expect(phoneParams(true, { galaxies: 15000 })).toEqual({ params: { galaxies: 15000 }, heavy: false });
    expect(phoneParams(true, { galaxies: 30000 })).toEqual({ params: { galaxies: 30000 }, heavy: true });
  });

  it('does not mutate the query object', () => {
    const q = { seed: 'x' };
    phoneParams(true, q);
    expect(q).toEqual({ seed: 'x' });
  });

  it('caps the galaxies field on a phone, except an unchanged honoured value', () => {
    expect(capGalaxies(true, 20000, 2000)).toBe(15000);
    expect(capGalaxies(true, 9000, 2000)).toBe(9000);
    expect(capGalaxies(true, 30000, 30000)).toBe(30000); // came from the URL; untouched
    expect(capGalaxies(true, 40000, 30000)).toBe(15000);
    expect(capGalaxies(false, 40000, 4000)).toBe(40000);
  });
});
