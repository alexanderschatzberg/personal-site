import { describe, expect, it } from 'vitest';
import { civName, currentMight, mightText, temperamentWord } from './civinfo';

describe('civ info card', () => {
  it('names temperament: peaceful < 0.33 ≤ wary < 0.67 ≤ aggressive', () => {
    expect(temperamentWord(0)).toBe('peaceful');
    expect(temperamentWord(0.329)).toBe('peaceful');
    expect(temperamentWord(0.33)).toBe('wary');
    expect(temperamentWord(0.669)).toBe('wary');
    expect(temperamentWord(0.67)).toBe('aggressive');
    expect(temperamentWord(1)).toBe('aggressive');
  });

  it('names civs with a two-digit id', () => {
    expect(civName(7)).toBe('civ-07');
    expect(civName(0)).toBe('civ-00');
    expect(civName(123)).toBe('civ-123');
  });

  it('power: base × N^α', () => {
    expect(currentMight('power', 5, 16, 0.5, null)).toBeCloseTo(20, 12);
    expect(currentMight('power', 3, 1, 0.6, null)).toBe(3);
  });

  it('log: base × ln(1 + N)', () => {
    expect(currentMight('log', 2, Math.E - 1, 0.6, null)).toBeCloseTo(2, 12);
    expect(currentMight('log', 4, 10, 0.6, null)).toBeCloseTo(4 * Math.log(11), 12);
  });

  it('frontier: base × local own galaxies (at least 1), or null when not evaluated', () => {
    expect(currentMight('frontier', 3, 500, 0.6, 12)).toBe(36);
    expect(currentMight('frontier', 3, 500, 0.6, 0)).toBe(3);
    expect(currentMight('frontier', 3, 500, 0.6, null)).toBeNull();
  });

  it('formats might: frontier shows base × local, — when unknown', () => {
    expect(mightText('power', 5, 20, null)).toBe('20');
    expect(mightText('log', 2.5, 5.994, null)).toBe('5.99');
    expect(mightText('frontier', 3, 36, 12)).toBe('3 × 12 = 36');
    expect(mightText('frontier', 3, null, null)).toBe('—');
  });
});
