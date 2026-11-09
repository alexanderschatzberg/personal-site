// Flat ΛCDM background (radiation ignored): scale factor a(t), "today" (a = 1) and conformal
// time η(t) = ∫₀ᵗ dt'/a(t'). Units: Gyr and Gly, so c = 1 and a comoving distance χ is crossed
// by a front at speed v in conformal time χ / v.
// H0 = 0 is a static universe: a ≡ 1 and η(t) = t exactly.

import { KMS_MPC_TO_PER_GYR, SCALE_SAMPLES, TODAY_GYR } from './types';

export interface Cosmology {
  /** H0 = 0: a ≡ 1, η(t) = t, etaInv(η) = η, with no rounding at all. */
  readonly isStatic: boolean;
  a(t: number): number;
  /** Conformal time at t, for t in [0, tEnd]. Strictly increasing. */
  eta(t: number): number;
  /** Inverse of eta, for η in [0, etaEnd]. */
  etaInv(eta: number): number;
  /** η(tEnd). */
  readonly etaEnd: number;
  /** η(∞): a front sent at t can never reach comoving distance > v·(etaInf − η(t)). Infinity
   *  without dark energy or without expansion. */
  readonly etaInf: number;
  /** Time at which a = 1, or null if outside [0, tEnd]. Static: TODAY_GYR. */
  readonly tToday: number | null;
  /** a(t) at SCALE_SAMPLES evenly spaced times over [0, tEnd] inclusive, capped at SCALE_MAX. */
  readonly scale: Float32Array;
}

/**
 * Table resolution. η is tabulated against s, where t = tEnd·s³ and s is uniform on [0, 1].
 * Near t = 0, a ∝ t^{2/3}, so dη/ds = 3·tEnd·s²/a(tEnd·s³) tends to a finite constant and the
 * integrand is smooth in s (the t^{-2/3} singularity is gone). Each interval is integrated
 * with Simpson's rule, and η is linear in s between nodes, so eta and etaInv are exact
 * inverses of one piecewise-linear map and both are monotonic.
 */
const NODES = 1 << 16;

/** Largest stored scale sample: a(t) passes Float32's max (≈3.4e38) for some in-range params
 *  (e.g. H0 = 150, tEnd = 1000), and a sample of Infinity would make interpolation NaN. */
export const SCALE_MAX = 3e38;

export function makeCosmology(H0: number, omegaLambda: number, tEnd: number): Cosmology {
  if (!(H0 > 0)) return staticCosmology(tEnd);

  const H = H0 * KMS_MPC_TO_PER_GYR;
  const oL = omegaLambda;
  const oM = 1 - oL;
  const lam = oL > 0;
  const sqL = Math.sqrt(oL);
  const pre = lam ? Math.cbrt(oM / oL) : 0;
  const k = 1.5 * sqL * H;

  const a = (t: number): number => {
    if (t <= 0) return 0;
    return lam ? pre * Math.pow(Math.sinh(k * t), 2 / 3) : Math.pow(1.5 * H * t, 2 / 3);
  };

  const tTodayRaw = lam ? (2 / (3 * H * sqL)) * Math.asinh(Math.sqrt(oL / oM)) : 2 / (3 * H);
  const tToday = tTodayRaw >= 0 && tTodayRaw <= tEnd ? tTodayRaw : null;

  // dη/ds at s = 0: a → Ωm^{1/3}·(1.5Ht)^{2/3}, so 3·tEnd·s²/a → 3·tEnd^{1/3}/(Ωm^{1/3}(1.5H)^{2/3}).
  const f0 = (3 * Math.cbrt(tEnd)) / (Math.cbrt(oM) * Math.pow(1.5 * H, 2 / 3));
  const f = (s: number): number => {
    if (s <= 0) return f0;
    return (3 * tEnd * s * s) / a(tEnd * s * s * s);
  };

  const M = NODES;
  const h = 1 / M;
  const table = new Float64Array(M + 1);
  let fl = f(0);
  for (let i = 0; i < M; i++) {
    const s = i * h;
    const fm = f(s + h / 2);
    const fr = f(s + h);
    table[i + 1] = table[i] + (h / 6) * (fl + 4 * fm + fr);
    fl = fr;
  }
  const etaEnd = table[M];

  const eta = (t: number): number => {
    if (t <= 0) return 0;
    if (t >= tEnd) return etaEnd;
    const x = Math.cbrt(t / tEnd) * M;
    let i = Math.floor(x);
    if (i >= M) i = M - 1;
    const u = x - i;
    return table[i] + u * (table[i + 1] - table[i]);
  };

  const etaInv = (e: number): number => {
    if (e <= 0) return 0;
    if (e >= etaEnd) return tEnd;
    let lo = 0;
    let hi = M; // table[lo] <= e < table[hi]
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (table[mid] <= e) lo = mid;
      else hi = mid;
    }
    const u = (e - table[lo]) / (table[hi] - table[lo]);
    const s = (lo + u) / M;
    return tEnd * s * s * s;
  };

  // η(∞) − η(tEnd) = ∫_tEnd^∞ dt/a. Since sinh(x)/eˣ grows with x, 1/a(t) decays at least as
  // fast as e^{−H√ΩΛ (t − tEnd)}; integrate 60 e-folds of that numerically (the rest is
  // below e^{−60} of the total).
  let etaInf = Infinity;
  if (lam) {
    const span = 60 / (H * sqL);
    const m = 20000;
    const dt = span / m;
    let sum = 0;
    for (let i = 0; i < m; i++) sum += 1 / a(tEnd + (i + 0.5) * dt);
    etaInf = etaEnd + sum * dt;
  }

  const scale = new Float32Array(SCALE_SAMPLES);
  for (let i = 0; i < SCALE_SAMPLES; i++) scale[i] = Math.min(SCALE_MAX, a((i * tEnd) / (SCALE_SAMPLES - 1)));

  return { isStatic: false, a, eta, etaInv, etaEnd, etaInf, tToday, scale };
}

function staticCosmology(tEnd: number): Cosmology {
  return {
    isStatic: true,
    a: () => 1,
    eta: (t) => t,
    etaInv: (e) => e,
    etaEnd: tEnd,
    etaInf: Infinity,
    tToday: TODAY_GYR,
    scale: new Float32Array(SCALE_SAMPLES).fill(1),
  };
}
