// The drawer's fields, shared by the page markup (labels, ranges) and the controller
// (reading and writing values). Every numeric Params key appears exactly once, except tEndGyr:
// a hidden safety cap that is never shown.
import { RANGES } from '../types';

export type NumKey = Exclude<keyof typeof RANGES, 'tEndGyr'>;

/** Tabs of the phone bottom sheet. On desktop, advanced is a collapsible section. */
export const TABS = ['basic', 'advanced'] as const;
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
  { key: 'galaxies', group: 'basic', label: 'galaxies', input: 'number', slider: 500 },
  { key: 'clumpiness', group: 'basic', label: 'clumpiness', input: 'number', slider: 0.01, note: '0 uniform · 1 strong cosmic web' },
  { key: 'pLife', group: 'basic', label: 'p(life) / planet', input: 'number' },
  { key: 'speedMin', group: 'basic', label: 'speed min', unit: 'c', input: 'number' },
  { key: 'speedMax', group: 'basic', label: 'speed max', unit: 'c', input: 'number' },
  { key: 'temperMean', group: 'basic', label: 'temperament', input: 'number', slider: 0.01, note: '0 peaceful · 1 aggressive' },
  { key: 'sizeGly', group: 'advanced', label: 'universe size', unit: 'Gly', input: 'number', slider: 1 },
  { key: 'webScaleGly', group: 'advanced', label: 'web scale', unit: 'Gly', input: 'number' },
  { key: 'planetsPerGalaxy', group: 'advanced', label: 'planets / galaxy', input: 'number' },
  { key: 'hardSteps', group: 'advanced', label: 'hard steps', input: 'number' },
  { key: 'lifeWindowGyr', group: 'advanced', label: 'life window', unit: 'Gyr', input: 'number', note: 'civilizations can only arise before this' },
  { key: 'temperSpread', group: 'advanced', label: 'temper spread', input: 'number' },
  { key: 'mightMin', group: 'advanced', label: 'base might min', input: 'number' },
  { key: 'mightMax', group: 'advanced', label: 'base might max', input: 'number' },
  { key: 'mightExponent', group: 'advanced', label: 'α (N^α)', input: 'number', model: 'power' },
  { key: 'frontierRadiusGly', group: 'advanced', label: 'frontier radius', unit: 'Gly', input: 'number', model: 'frontier' },
  { key: 'defenderBonus', group: 'advanced', label: 'defender bonus', unit: '×', input: 'number' },
  { key: 'H0', group: 'advanced', label: 'H0', unit: 'km/s/Mpc', input: 'number', note: '0 = no expansion' },
  { key: 'omegaLambda', group: 'advanced', label: 'ΩΛ', input: 'number', note: 'dark energy; matter = 1 − ΩΛ' },
];

/** Controls in the basic part of the drawer (numeric fields plus the seed box). */
export const BASIC = [...FIELDS.filter((f) => f.group === 'basic').map((f) => f.key), 'seed'] as const;
/** Controls in the advanced part (numeric fields, the might model and [no expansion]). */
export const ADVANCED = [...FIELDS.filter((f) => f.group === 'advanced').map((f) => f.key), 'mightModel', 'noExpansion'] as const;

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

/** Above this relative difference between the set and effective web scale, the drawer says so. */
export const WEB_NOTE_TOLERANCE = 0.1;

/**
 * Note for the web scale field when the run's effective spacing (structure.effectiveWebScaleGly)
 * is more than 10% off the set value, else null. Larger means too few galaxies for that many
 * cells; smaller means the universe is too small for so few.
 */
export function webScaleNote(set: number, effective: number): string | null {
  if (!(set > 0) || Math.abs(effective / set - 1) <= WEB_NOTE_TOLERANCE) return null;
  const v = effective >= 10 ? String(Math.round(effective)) : effective.toFixed(1);
  return `effective ≈ ${v} Gly at this ${effective > set ? 'galaxy count' : 'universe size'}`;
}
