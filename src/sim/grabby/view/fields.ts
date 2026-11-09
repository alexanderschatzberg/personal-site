// The drawer's fields, shared by the page markup (labels, ranges) and the controller
// (reading and writing values). Every numeric Params key appears exactly once.
import { RANGES } from '../types';

export type NumKey = keyof typeof RANGES;

export interface NumField {
  key: NumKey;
  label: string;
  unit?: string;
  /** 'range' draws a slider; 'number' a text-like number box. */
  input: 'range' | 'number';
  step: number | 'any';
  /** Only relevant for this might model (others get the field disabled). */
  model?: 'power' | 'frontier';
}

export const FIELDS: NumField[] = [
  { key: 'sizeGly', label: 'size', unit: 'Gly', input: 'range', step: 1 },
  { key: 'galaxies', label: 'galaxies', input: 'range', step: 500 },
  { key: 'pLife', label: 'p(life) / planet', input: 'number', step: 'any' },
  { key: 'planetsPerGalaxy', label: 'planets / galaxy', input: 'number', step: 'any' },
  { key: 'hardSteps', label: 'hard steps', input: 'number', step: 1 },
  { key: 'speedMin', label: 'speed min', unit: 'c', input: 'number', step: 0.01 },
  { key: 'speedMax', label: 'speed max', unit: 'c', input: 'number', step: 0.01 },
  { key: 'temperMean', label: 'temperament', input: 'range', step: 0.01 },
  { key: 'temperSpread', label: 'temper spread', input: 'number', step: 0.01 },
  { key: 'mightMin', label: 'base might min', input: 'number', step: 'any' },
  { key: 'mightMax', label: 'base might max', input: 'number', step: 'any' },
  { key: 'mightExponent', label: 'α (N^α)', input: 'number', step: 0.05, model: 'power' },
  { key: 'frontierRadiusGly', label: 'frontier radius', unit: 'Gly', input: 'number', step: 'any', model: 'frontier' },
  { key: 'defenderBonus', label: 'defender bonus', unit: '×', input: 'number', step: 0.1 },
  { key: 'tEndGyr', label: 'end time', unit: 'Gyr', input: 'number', step: 'any' },
];

/** Compact number for labels: 1e-22, 1e+11 → 1e11, 4,000, 0.6. */
export function fmt(v: number): string {
  if (v !== 0 && (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-3)) {
    const [m, e] = v.toExponential().split('e');
    const mant = String(Number(Number(m).toPrecision(3)));
    return `${mant}e${Number(e)}`;
  }
  return Number.isInteger(v) ? v.toLocaleString('en-US') : String(Number(v.toPrecision(4)));
}
