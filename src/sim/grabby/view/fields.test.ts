import { describe, expect, it } from 'vitest';
import { RANGES } from '../types';
import { ADVANCED, BASIC, FIELDS, fromInput, TABS, toInput, webScaleNote } from './fields';

describe('drawer fields', () => {
  it('covers every RANGES key except the hidden safety cap exactly once, including H0 and omegaLambda', () => {
    const keys = FIELDS.map((f) => f.key).sort();
    expect(keys).toEqual(Object.keys(RANGES).filter((k) => k !== 'tEndGyr').sort());
    expect(keys).toContain('H0');
    expect(keys).toContain('omegaLambda');
  });

  it('never shows tEndGyr (a hidden safety cap): no field, not basic, not advanced', () => {
    expect(FIELDS.some((x) => (x.key as string) === 'tEndGyr')).toBe(false);
    expect(FIELDS.some((x) => /lifetime/i.test(x.label))).toBe(false);
    expect([...BASIC, ...ADVANCED]).not.toContain('tEndGyr');
  });

  it('labels the origin window as the life window, next to hard steps', () => {
    const i = FIELDS.findIndex((x) => x.key === 'lifeWindowGyr');
    const f = FIELDS[i];
    expect(`${f.label} (${f.unit})`).toBe('life window (Gyr)');
    expect(FIELDS[i - 1].key).toBe('hardSteps');
  });

  it('reads every value from a number box, never a step-snapping slider', () => {
    // A range input sanitises its value to its step (93.5 → 94), which used to leak into
    // the params and the URL. The value-holding control must be a number input.
    for (const f of FIELDS) expect(f.input, f.key).toBe('number');
  });

  it('writes full-precision values into inputs (fmt is for labels only)', () => {
    const values = [1.2345678901234e-22, 93.123456789, 0.30000000000000004, 1e11, 123456789012, 4000, 0, 0.69, 67.7];
    for (const v of values) expect(Number(toInput(v)), String(v)).toBe(v);
  });

  it('fromInput rejects blanks and non-finite text', () => {
    for (const s of ['', '  ', 'abc', 'Infinity', 'NaN', '1e999']) expect(fromInput(s), s).toBeNull();
    expect(fromInput(' 1e-22 ')).toBe(1e-22);
  });
});

describe('basic and advanced', () => {
  it('basic holds exactly galaxies, clumpiness, p(life), speed min/max, temperament mean and seed', () => {
    expect([...BASIC].sort()).toEqual(['clumpiness', 'galaxies', 'pLife', 'seed', 'speedMax', 'speedMin', 'temperMean'].sort());
  });

  it('advanced holds everything else, including the might model and [no expansion]', () => {
    expect([...ADVANCED].sort()).toEqual(
      [
        'sizeGly', 'webScaleGly', 'planetsPerGalaxy', 'hardSteps', 'lifeWindowGyr', 'temperSpread', 'mightModel',
        'mightMin', 'mightMax', 'mightExponent', 'frontierRadiusGly', 'defenderBonus', 'H0', 'omegaLambda', 'noExpansion',
      ].sort(),
    );
  });

  it('every numeric field is in exactly one of basic / advanced, matching its tab', () => {
    for (const f of FIELDS) {
      const inBasic = (BASIC as readonly string[]).includes(f.key);
      const inAdv = (ADVANCED as readonly string[]).includes(f.key);
      expect(inBasic !== inAdv, f.key).toBe(true);
      expect(f.group, f.key).toBe(inBasic ? 'basic' : 'advanced');
    }
  });

  it('phone sheet tabs are basic · advanced', () => {
    expect(TABS).toEqual(['basic', 'advanced']);
  });
});

describe('web scale note', () => {
  it('shows the effective spacing when it differs from the set value by more than 10%', () => {
    expect(webScaleNote(2, 93 / Math.sqrt(500))).toBe('effective ≈ 4.2 Gly at this galaxy count');
    expect(webScaleNote(100, 31)).toBe('effective ≈ 31 Gly at this universe size');
  });

  it('says nothing within 10%', () => {
    expect(webScaleNote(12, 12.02)).toBeNull();
    expect(webScaleNote(10, 10.9)).toBeNull();
    expect(webScaleNote(10, 9.1)).toBeNull();
    expect(webScaleNote(10, 11.2)).not.toBeNull();
  });
});
