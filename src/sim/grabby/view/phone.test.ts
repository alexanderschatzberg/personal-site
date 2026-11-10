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

  it('uses 50000 galaxies on a phone when the URL has none', () => {
    expect(PHONE_GALAXIES).toBe(50000);
    expect(phoneParams(true, { seed: 'x' })).toEqual({ params: { seed: 'x', galaxies: 50000 }, heavy: false });
  });

  it('leaves desktop params alone', () => {
    expect(phoneParams(false, { seed: 'x' })).toEqual({ params: { seed: 'x' }, heavy: false });
    expect(phoneParams(false, { galaxies: 40000 })).toEqual({ params: { galaxies: 40000 }, heavy: false });
  });

  it('honours a URL galaxies value on a phone, flagging one above the cap as heavy', () => {
    expect(PHONE_GALAXY_CAP).toBe(200000);
    expect(phoneParams(true, { galaxies: 8000 })).toEqual({ params: { galaxies: 8000 }, heavy: false });
    expect(phoneParams(true, { galaxies: 200000 })).toEqual({ params: { galaxies: 200000 }, heavy: false });
    expect(phoneParams(true, { galaxies: 300000 })).toEqual({ params: { galaxies: 300000 }, heavy: true });
  });

  it('does not mutate the query object', () => {
    const q = { seed: 'x' };
    phoneParams(true, q);
    expect(q).toEqual({ seed: 'x' });
  });

  it('caps the galaxies field on a phone, except an unchanged honoured value', () => {
    expect(capGalaxies(true, 250000, 50000)).toBe(200000);
    expect(capGalaxies(true, 90000, 50000)).toBe(90000);
    expect(capGalaxies(true, 300000, 300000)).toBe(300000); // came from the URL; untouched
    expect(capGalaxies(true, 400000, 300000)).toBe(200000);
    expect(capGalaxies(false, 400000, 4000)).toBe(400000);
  });
});
