// The drawer's fields, shared by the page markup (labels, ranges) and the controller
// (reading and writing values). Every numeric Params key appears exactly once.
import { RANGES } from '../types';

export type NumKey = keyof typeof RANGES;

/** Tabs of the phone bottom sheet. The desktop drawer shows every group at once. */
export const TABS = ['space', 'life', 'war', 'cosmos'] as const;
export type Tab = (typeof TABS)[number];

export interface NumField {
  key: NumKey;
  /** Phone sheet tab. */
  group: Tab;
  label: string;
  unit?: string;
  /** The value always lives in a number box: a range input would snap it to its step. */
  input: 'number';
  /** Optional companion slider (no name, not read by the form). Its step only affects dragging. */
  slider?: number;
  /** Extra hint shown under the range. */
  note?: string;
  /** Only relevant for this might model (others get the field disabled). */
  model?: 'power' | 'frontier';
}

export const FIELDS: NumField[] = [
  { key: 'sizeGly', group: 'space', label: 'size', unit: 'Gly', input: 'number', slider: 1 },
  { key: 'galaxies', group: 'space', label: 'galaxies', input: 'number', slider: 500 },
  { key: 'pLife', group: 'life', label: 'p(life) / planet', input: 'number' },
  { key: 'planetsPerGalaxy', group: 'life', label: 'planets / galaxy', input: 'number' },
  { key: 'hardSteps', group: 'life', label: 'hard steps', input: 'number' },
  { key: 'lifeWindowGyr', group: 'life', label: 'life window', unit: 'Gyr', input: 'number', note: 'civilizations can only arise before this' },
  { key: 'speedMin', group: 'life', label: 'speed min', unit: 'c', input: 'number' },
  { key: 'speedMax', group: 'life', label: 'speed max', unit: 'c', input: 'number' },
  { key: 'temperMean', group: 'war', label: 'temperament', input: 'number', slider: 0.01, note: '0 peaceful · 1 aggressive' },
  { key: 'temperSpread', group: 'war', label: 'temper spread', input: 'number' },
  { key: 'mightMin', group: 'war', label: 'base might min', input: 'number' },
  { key: 'mightMax', group: 'war', label: 'base might max', input: 'number' },
  { key: 'mightExponent', group: 'war', label: 'α (N^α)', input: 'number', model: 'power' },
  { key: 'frontierRadiusGly', group: 'war', label: 'frontier radius', unit: 'Gly', input: 'number', model: 'frontier' },
  { key: 'defenderBonus', group: 'war', label: 'defender bonus', unit: '×', input: 'number' },
  { key: 'tEndGyr', group: 'cosmos', label: 'lifetime', unit: 'Gyr', input: 'number', note: 'upper cap; the run ends earlier once nothing more can be reached' },
  { key: 'H0', group: 'cosmos', label: 'H0', unit: 'km/s/Mpc', input: 'number', note: '0 = no expansion' },
  { key: 'omegaLambda', group: 'cosmos', label: 'ΩΛ', input: 'number', note: 'dark energy; matter = 1 − ΩΛ' },
];

/** Compact number for labels only: 1e-22, 1e+11 → 1e11, 4,000, 0.6. Lossy; never use for values. */
export function fmt(v: number): string {
  if (v !== 0 && (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-3)) {
    const [m, e] = v.toExponential().split('e');
    const mant = String(Number(Number(m).toPrecision(3)));
    return `${mant}e${Number(e)}`;
  }
  return Number.isInteger(v) ? v.toLocaleString('en-US') : String(Number(v.toPrecision(4)));
}

/** Value for an <input type=number>. Shortest string that parses back to exactly v. */
export function toInput(v: number): string {
  return String(v);
}

/** Parse an input's text. null for blank, non-numeric or non-finite text. */
export function fromInput(s: string): number | null {
  const raw = s.trim();
  if (raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}
