import { describe, expect, it } from 'vitest';
import { RANGES } from '../types';
import { FIELDS, fromInput, toInput } from './fields';

describe('drawer fields', () => {
  it('covers every RANGES key exactly once, including H0 and omegaLambda', () => {
    const keys = FIELDS.map((f) => f.key).sort();
    expect(keys).toEqual(Object.keys(RANGES).sort());
    expect(keys).toContain('H0');
    expect(keys).toContain('omegaLambda');
  });

  it('labels the run length as the lifetime', () => {
    const f = FIELDS.find((x) => x.key === 'tEndGyr')!;
    expect(`${f.label} (${f.unit})`).toBe('lifetime (Gyr)');
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
