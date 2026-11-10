import { describe, expect, it } from 'vitest';
import { ADVANCED_KEY, readFlag, writeFlag } from './prefs';

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}
const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } as unknown as Storage;

describe('remembered advanced drawer state', () => {
  it('round-trips open / closed', () => {
    const s = memory();
    expect(readFlag(s, ADVANCED_KEY)).toBe(false);
    writeFlag(s, ADVANCED_KEY, true);
    expect(readFlag(s, ADVANCED_KEY)).toBe(true);
    writeFlag(s, ADVANCED_KEY, false);
    expect(readFlag(s, ADVANCED_KEY)).toBe(false);
  });

  it('a throwing or missing storage reads as closed and never throws', () => {
    expect(readFlag(broken, ADVANCED_KEY)).toBe(false);
    expect(() => writeFlag(broken, ADVANCED_KEY, true)).not.toThrow();
    expect(readFlag(undefined, ADVANCED_KEY)).toBe(false);
    expect(() => writeFlag(undefined, ADVANCED_KEY, true)).not.toThrow();
  });
});
