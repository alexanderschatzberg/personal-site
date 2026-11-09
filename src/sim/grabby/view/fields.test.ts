import { describe, expect, it } from 'vitest';
import { RANGES } from '../types';
import { FIELDS, fromInput, TABS, toInput } from './fields';

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

describe('phone sheet tabs', () => {
  it('groups every field into space · life · war · cosmos, each tab non-empty', () => {
    expect(TABS).toEqual(['space', 'life', 'war', 'cosmos']);
    for (const f of FIELDS) expect(TABS, f.key).toContain(f.group);
    for (const t of TABS) expect(FIELDS.some((f) => f.group === t), t).toBe(true);
  });

  it('puts the might-model fields with war and the expansion fields with cosmos', () => {
    const group = (k: string) => FIELDS.find((f) => f.key === k)!.group;
    for (const k of ['mightExponent', 'frontierRadiusGly', 'temperMean', 'defenderBonus']) expect(group(k), k).toBe('war');
    for (const k of ['H0', 'omegaLambda', 'tEndGyr']) expect(group(k), k).toBe('cosmos');
    for (const k of ['sizeGly', 'galaxies']) expect(group(k), k).toBe('space');
  });
});
