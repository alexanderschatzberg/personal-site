// Shared contract between the simulation engine and the page that draws it.
// Engine: src/sim/grabby/{rng,geometry,engine,timeline}.ts. View: src/sim/grabby/view/*.

export type Dim = 2 | 3;
/** 'sphere' is the surface of a sphere and only exists in 2d. */
export type Geometry = 'flat' | 'torus' | 'sphere';
/**
 * How a civilization's might grows with the galaxies it holds (N):
 * - power:    base × N^mightExponent
 * - log:      base × ln(1 + N)
 * - frontier: base × (own galaxies within frontierRadiusGly of the contested galaxy)
 */
export type MightModel = 'power' | 'log' | 'frontier';

export interface Params {
  dim: Dim;
  geometry: Geometry;
  /** Flat/torus: side length of the square or cube. Sphere: circumference. In Gly. */
  sizeGly: number;
  /** Large-scale structure (Zel'dovich approximation): 0 = uniform, 1 = strongly evolved cosmic web
   *  (thin filaments and dense knots around empty voids). */
  clumpiness: number;
  /** Smoothing scale of the initial density field, which sets the typical void size, in Gly. Real
   *  voids are ~0.1–0.3 Gly; the default is scaled up so the web is visible. */
  webScaleGly: number;
  /** Number of simulated points. Each stands for REAL_GALAXIES / galaxies real galaxies. */
  galaxies: number;
  planetsPerGalaxy: number;
  /** Chance that a single planet produces a grabby civilization at some point. */
  pLife: number;
  /** Hard-steps exponent n: origin time is drawn with density ∝ t^n on [0, min(lifeWindowGyr, tEndGyr)]. */
  hardSteps: number;
  /** Life window: civilizations can only arise before this time, in Gyr after the big bang. */
  lifeWindowGyr: number;
  /** Expansion speed range, as a fraction of c. Each civ draws uniformly from it. */
  speedMin: number;
  speedMax: number;
  /** Temperament: 0 = always leaves others alone, 1 = always declares war. Each civ draws
   *  from a normal(temperMean, temperSpread) clamped to [0, 1]. */
  temperMean: number;
  temperSpread: number;
  /** Base (intrinsic) might range. Each civ draws uniformly from it. */
  mightMin: number;
  mightMax: number;
  mightModel: MightModel;
  /** α for the 'power' model. */
  mightExponent: number;
  /** Radius for the 'frontier' model, in Gly. */
  frontierRadiusGly: number;
  /** Multiplier on the defender's might in a battle. */
  defenderBonus: number;
  /** Safety cap only (not shown in the UI): the run normally ends when no empire can reach any
   *  more galaxies (SimResult.tLast). In Gyr after the big bang. */
  tEndGyr: number;
  /** Hubble constant today, km/s/Mpc. 0 = static universe (no expansion, scale factor 1). */
  H0: number;
  /** Dark-energy fraction of a flat ΛCDM universe; matter = 1 − omegaLambda, radiation ignored. */
  omegaLambda: number;
  seed: string;
}

/** Real galaxies in the observable universe (order of magnitude, Conselice et al. 2016). */
export const REAL_GALAXIES = 2e12;
/** Age of the universe today. Only a fallback: with expansion on, "today" is SimResult.tToday. */
export const TODAY_GYR = 13.8;
/** 1 km/s/Mpc in 1/Gyr. Units: distance Gly, time Gyr, so c = 1. */
export const KMS_MPC_TO_PER_GYR = 1.0227e-3;
/** Number of samples in SimResult.scale. */
export const SCALE_SAMPLES = 1024;

export const DEFAULTS: Params = {
  dim: 2,
  geometry: 'flat',
  sizeGly: 93, // diameter of the observable universe
  clumpiness: 0.7,
  webScaleGly: 12,
  galaxies: 200000,
  planetsPerGalaxy: 1e11,
  pLife: 1e-22,
  hardSteps: 6,
  lifeWindowGyr: 20,
  speedMin: 0.3,
  speedMax: 0.9,
  temperMean: 0.5,
  temperSpread: 0.25,
  mightMin: 1,
  mightMax: 10,
  mightModel: 'power',
  mightExponent: 0.6,
  frontierRadiusGly: 10,
  defenderBonus: 1.5,
  tEndGyr: 5000,
  H0: 67.7, // Planck 2018
  omegaLambda: 0.69, // Planck 2018
  seed: '5eed',
};

/** Allowed [min, max] for each numeric param. The engine clamps to these; the UI uses them. */
export const RANGES = {
  sizeGly: [10, 500],
  clumpiness: [0, 1],
  webScaleGly: [2, 100],
  galaxies: [500, 1000000],
  planetsPerGalaxy: [1e9, 1e13],
  pLife: [1e-30, 1e-10],
  hardSteps: [0, 12],
  lifeWindowGyr: [1, 1000],
  speedMin: [0.01, 0.99],
  speedMax: [0.01, 0.99],
  temperMean: [0, 1],
  temperSpread: [0, 1],
  mightMin: [1, 100],
  mightMax: [1, 100],
  mightExponent: [0.1, 1],
  frontierRadiusGly: [1, 100],
  defenderBonus: [1, 5],
  tEndGyr: [20, 10000],
  H0: [0, 150],
  omegaLambda: [0, 0.99],
} as const satisfies Record<string, readonly [number, number]>;

export interface Civ {
  id: number; // index into SimResult.civs
  origin: number; // galaxy index
  t0: number; // Gyr
  speed: number; // fraction of c
  temper: number; // 0..1
  baseMight: number;
}

export type OwnershipKind = 'arise' | 'colonize' | 'conquer';

/** One change of a galaxy's owner. `prev` lets the timeline step backwards. -1 = nobody. */
export interface OwnershipEvent {
  t: number;
  galaxy: number;
  owner: number;
  prev: number;
  kind: OwnershipKind;
}

export type CivEventKind = 'arise' | 'meet' | 'war' | 'peace' | 'conquer' | 'repel' | 'extinct';

/** Story-level events for the log. `other` is the other civ, `galaxy` where it happened. */
export interface CivEvent {
  t: number;
  civ: number;
  kind: CivEventKind;
  other?: number;
  galaxy?: number;
}

export interface SimResult {
  params: Params; // after clamping
  /** xyz per galaxy (z = 0 for 2d flat/torus; on the sphere surface for 'sphere'). Comoving
   *  coordinates in Gly, i.e. physical distances at scale factor a = 1 ("today"). */
  positions: Float32Array;
  civs: Civ[];
  /** Sorted by t ascending (ties keep processing order). */
  events: OwnershipEvent[];
  /** Sorted by t ascending. */
  log: CivEvent[];
  /** Time the last event happened, or params.tEndGyr if the queue ran until the end. */
  tLast: number;
  /** Scale factor a(t) at SCALE_SAMPLES evenly spaced times from 0 to tLast inclusive
   *  (sample i is at t = i * tLast / (SCALE_SAMPLES - 1); all samples a(0) if tLast = 0). All 1 when H0 = 0. Physical
   *  position at time t = positions × a(t). Interpolate linearly between samples. */
  scale: Float64Array;
  /** The symmetrised kNN neighbour graph (plus the fewest shortest bridges that make it connected
   *  when the cosmic web splits it into clumps) that the fronts travel along, as index pairs (i, j) with
   *  i < j, each pair once: edges[2k], edges[2k+1]. The view draws borders on edges whose two
   *  ends have different owners. */
  edges: Uint32Array;
  /** The last nBridges pairs of `edges` are bridges (long links added to join clumps); all earlier
   *  pairs are ordinary nearest-neighbour links. The view draws no borders on bridges. */
  nBridges: number;
  /** Time at which a = 1 ("today"), or null if that is not inside [0, tEndGyr]. H0 = 0 → TODAY_GYR. */
  tToday: number | null;
}

/** engine.ts exports: `export function simulate(p: Partial<Params>): SimResult` */
export type Simulate = (p: Partial<Params>) => SimResult;

/**
 * timeline.ts exports: `export function createTimeline(r: SimResult): Timeline`.
 * Scrubbing replays OwnershipEvents forwards or backwards from the current position, so a
 * small seek is cheap. A fresh timeline starts at t = 0 with nobody owning anything.
 */
export interface Timeline {
  readonly t: number;
  /** Move to time t (clamped to [0, params.tEndGyr]). Applies every event with e.t <= t. */
  seek(t: number): void;
  /** Owner of each galaxy at the current time, -1 = nobody. Updated in place by seek. */
  readonly owner: Int32Array;
  /** Galaxies held by each civ at the current time. Updated in place by seek. */
  readonly held: Int32Array;
  /** Galaxies owned by anyone at the current time. */
  readonly claimed: number;
  /** Civs that have arisen and still hold at least one galaxy. */
  readonly alive: number;
  /** Galaxies whose owner changed during the last seek (for partial colour updates). */
  readonly changed: Int32Array;
  readonly changedCount: number;
}
