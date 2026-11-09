// Params <-> query string. Only params that differ from DEFAULTS are written, so a default
// run has a clean URL. Reading ignores unknown keys and bad values and clamps to RANGES.
import { DEFAULTS, RANGES, type Params } from '../types';

type NumKey = keyof typeof RANGES;
const NUM_KEYS = Object.keys(RANGES) as NumKey[];
const GEOMETRIES = ['flat', 'torus', 'sphere'] as const;
const MODELS = ['power', 'log', 'frontier'] as const;
export const MAX_SEED_LENGTH = 64;

/** Trim and cut to MAX_SEED_LENGTH UTF-16 units without leaving half a surrogate pair. */
export function clipSeed(raw: string): string {
  let s = raw.trim().slice(0, MAX_SEED_LENGTH);
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
  return s;
}

export function clampNum(key: NumKey, v: number): number {
  const [lo, hi] = RANGES[key];
  return Math.min(hi, Math.max(lo, v));
}

export function paramsToQuery(p: Params): string {
  const q = new URLSearchParams();
  for (const k of Object.keys(DEFAULTS) as (keyof Params)[]) {
    if (p[k] !== DEFAULTS[k]) q.set(k, String(p[k]));
  }
  return q.toString();
}

export function queryToParams(search: string): Partial<Params> {
  const q = new URLSearchParams(search);
  const out: Partial<Params> = {};
  for (const k of NUM_KEYS) {
    const raw = q.get(k);
    if (raw === null || raw.trim() === '') continue;
    const v = Number(raw);
    if (Number.isFinite(v)) out[k] = clampNum(k, v);
  }
  const dim = q.get('dim');
  if (dim === '2' || dim === '3') out.dim = Number(dim) as 2 | 3;
  const geo = q.get('geometry');
  if (geo && (GEOMETRIES as readonly string[]).includes(geo)) out.geometry = geo as Params['geometry'];
  const model = q.get('mightModel');
  if (model && (MODELS as readonly string[]).includes(model)) out.mightModel = model as Params['mightModel'];
  const seed = q.get('seed');
  if (seed && clipSeed(seed)) out.seed = clipSeed(seed);
  if (out.dim === 3 && out.geometry === 'sphere') out.geometry = 'flat';
  return out;
}
