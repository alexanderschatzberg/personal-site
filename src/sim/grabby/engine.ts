// The grabby-aliens simulation: seeded galaxies, civ origins, and an event-driven expansion
// along a k-nearest-neighbour graph with first-contact stances and battles.
// Browser-safe: runs in a Web Worker.

import { makeCosmology } from './cosmology';
import { Space } from './geometry';
import { makeRng, normal } from './rng';
import { DEFAULTS, RANGES, REAL_GALAXIES } from './types';
import type { Civ, CivEvent, OwnershipEvent, Params, SimResult } from './types';

type RangeKey = keyof typeof RANGES;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Merge over DEFAULTS, clamp to RANGES, swap inverted ranges, no sphere in 3d. */
export function normalizeParams(input: Partial<Params>): Params {
  const p: Params = { ...DEFAULTS };
  for (const key of Object.keys(RANGES) as RangeKey[]) {
    const v = input[key];
    const [lo, hi] = RANGES[key];
    p[key] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : DEFAULTS[key];
  }
  p.galaxies = Math.round(p.galaxies);
  if (input.dim === 2 || input.dim === 3) p.dim = input.dim;
  if (input.geometry === 'flat' || input.geometry === 'torus' || input.geometry === 'sphere') {
    p.geometry = input.geometry;
  }
  if (input.mightModel === 'power' || input.mightModel === 'log' || input.mightModel === 'frontier') {
    p.mightModel = input.mightModel;
  }
  if (input.seed !== undefined && input.seed !== null) p.seed = String(input.seed);
  if (p.speedMin > p.speedMax) [p.speedMin, p.speedMax] = [p.speedMax, p.speedMin];
  if (p.mightMin > p.mightMax) [p.mightMin, p.mightMax] = [p.mightMax, p.mightMin];
  if (p.dim === 3 && p.geometry === 'sphere') p.geometry = 'flat';
  return p;
}

/** Min-heap of queue entries keyed by (t, sequence). Entries live in parallel arrays. */
class Queue {
  t: number[] = [];
  a: number[] = []; // civ (arrival) or candidate index (arise)
  g: number[] = []; // target galaxy
  s: number[] = []; // source galaxy, -1 for arise
  private heap: number[] = [];

  get size(): number {
    return this.heap.length;
  }

  private less(x: number, y: number): boolean {
    const tx = this.t[x], ty = this.t[y];
    return tx < ty || (tx === ty && x < y);
  }

  push(t: number, a: number, g: number, s: number): void {
    const id = this.t.length;
    this.t.push(t);
    this.a.push(a);
    this.g.push(g);
    this.s.push(s);
    const h = this.heap;
    let i = h.length;
    h.push(id);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(id, h[parent])) break;
      h[i] = h[parent];
      i = parent;
    }
    h[i] = id;
  }

  peek(): number {
    return this.heap[0];
  }

  pop(): number {
    const h = this.heap;
    const top = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      let i = 0;
      const n = h.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && this.less(h[r], h[l]) ? r : l;
        if (!this.less(h[c], last)) break;
        h[i] = h[c];
        i = c;
      }
      h[i] = last;
    }
    return top;
  }
}

interface Candidate {
  galaxy: number;
  t0: number;
  speed: number;
  temper: number;
  baseMight: number;
}

export function simulate(input: Partial<Params>): SimResult {
  const p = normalizeParams(input);
  const rng = makeRng(p.seed);
  const n = p.galaxies;

  // 3. Positions.
  const positions = new Float32Array(n * 3);
  if (p.geometry === 'sphere') {
    const R = p.sizeGly / (2 * Math.PI);
    for (let i = 0; i < n; i++) {
      const z = 2 * rng() - 1;
      const phi = 2 * Math.PI * rng();
      const rho = Math.sqrt(Math.max(0, 1 - z * z));
      positions[3 * i] = R * rho * Math.cos(phi);
      positions[3 * i + 1] = R * rho * Math.sin(phi);
      positions[3 * i + 2] = R * z;
    }
  } else {
    for (let i = 0; i < n; i++) {
      positions[3 * i] = rng() * p.sizeGly;
      positions[3 * i + 1] = rng() * p.sizeGly;
      positions[3 * i + 2] = p.dim === 3 ? rng() * p.sizeGly : 0;
    }
  }

  // 4–5. Metric and neighbour graph.
  const space = new Space(positions, p.dim, p.geometry, p.sizeGly);
  const graph = space.neighbours(p.dim === 3 ? 12 : 8);
  const edgeList: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let e = graph.start[i]; e < graph.start[i + 1]; e++) {
      const j = graph.adj[e];
      if (i < j) edgeList.push(i, j);
    }
  }
  const edges = Uint32Array.from(edgeList);

  // Expansion. Distances on `positions` are comoving; a front at speed v covers comoving
  // distance d in conformal time d / v, i.e. dχ/dt = v / a(t).
  const cosmo = makeCosmology(p.H0, p.omegaLambda, p.tEndGyr);

  // 6. Origin candidates.
  const q = 1 - Math.exp((-p.pLife * p.planetsPerGalaxy * REAL_GALAXIES) / n);
  // Life can only arise inside the life window (density ∝ t^hardSteps on [0, tWindow]).
  const tWindow = Math.min(p.lifeWindowGyr, p.tEndGyr);
  const candidates: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    if (rng() >= q) continue;
    const t0 = tWindow * Math.pow(rng(), 1 / (p.hardSteps + 1));
    const speed = p.speedMin + (p.speedMax - p.speedMin) * rng();
    const temper = clamp(normal(rng, p.temperMean, p.temperSpread), 0, 1);
    const baseMight = p.mightMin + (p.mightMax - p.mightMin) * rng();
    candidates.push({ galaxy: i, t0, speed, temper, baseMight });
  }

  const queue = new Queue();
  for (let c = 0; c < candidates.length; c++) {
    queue.push(candidates[c].t0, c, candidates[c].galaxy, -1);
  }

  const owner = new Int32Array(n).fill(-1);
  const civs: Civ[] = [];
  const held: number[] = [];
  const events: OwnershipEvent[] = [];
  const log: CivEvent[] = [];
  /** Stance of ordered pair (A,B): undefined = not met, true = war, false = peace. */
  const stance = new Map<number, boolean>();
  const firstConquest = new Set<number>();
  const battles = new Set<number>();
  const pairKey = (a: number, b: number) => a * candidates.length + b;

  // Frontier performance: countWithin scans every grid cell within the radius, so a radius
  // as large as the universe makes each battle O(galaxies) (a 3d, 50k-galaxy, radius-100 run
  // with early civs took ~190 s). When the radius reaches the largest possible distance under
  // the metric, the count is exactly the civ's held count, so use that instead: O(1), same result.
  const frontierAll = p.frontierRadiusGly >= space.maxDist * (1 + 1e-12);
  /** Arrivals that would land after tEnd (civ, target, source). Never processed; only checked
   *  at the end to tell "lifetime reached" from "nothing more reachable". */
  const lateA: number[] = [];
  const lateG: number[] = [];
  const lateS: number[] = [];
  const late = (civ: number, g: number, s: number) => {
    lateA.push(civ);
    lateG.push(g);
    lateS.push(s);
  };

  const might = (civ: number, g: number): number => {
    const base = civs[civ].baseMight;
    const N = held[civ];
    switch (p.mightModel) {
      case 'power':
        return base * Math.pow(N, p.mightExponent);
      case 'log':
        return base * Math.log(1 + N);
      case 'frontier':
        // When the radius covers the whole universe, every galaxy the civ holds is in range.
        if (frontierAll) return base * Math.max(1, N);
        return base * Math.max(1, space.countWithin(g, p.frontierRadiusGly, owner, civ));
    }
  };

  const take = (t: number, g: number, civ: number, kind: OwnershipEvent['kind']) => {
    const prev = owner[g];
    owner[g] = civ;
    held[civ]++;
    if (prev >= 0) held[prev]--;
    events.push({ t, galaxy: g, owner: civ, prev, kind });
    const speed = civs[civ].speed;
    if (cosmo.isStatic) {
      // a ≡ 1: the round-1 arithmetic, unchanged.
      for (let e = graph.start[g]; e < graph.start[g + 1]; e++) {
        const tArr = t + graph.w[e] / speed;
        if (tArr > p.tEndGyr) late(civ, graph.adj[e], g);
        else queue.push(tArr, civ, graph.adj[e], g);
      }
    } else {
      // Solve η(t_arr) = η(t) + d / v. Beyond η(∞) the target is past the event horizon and
      // can never be reached; beyond η(tEnd) it would only be reached after the lifetime.
      const etaSend = cosmo.eta(t);
      for (let e = graph.start[g]; e < graph.start[g + 1]; e++) {
        const etaArr = etaSend + graph.w[e] / speed;
        if (etaArr > cosmo.etaInf) continue;
        if (etaArr > cosmo.etaEnd) {
          late(civ, graph.adj[e], g);
          continue;
        }
        const tArr = Math.min(p.tEndGyr, Math.max(t, cosmo.etaInv(etaArr)));
        queue.push(tArr, civ, graph.adj[e], g);
      }
    }
    return prev;
  };

  // Every queued entry is at or before tEnd, so the queue runs until it is empty. Arises on
  // already-owned galaxies are skipped on pop and do not count as events.
  let tLast = 0;
  while (queue.size > 0) {
    const id = queue.pop();
    const t = queue.t[id];
    const g = queue.g[id];
    const s = queue.s[id];

    if (s < 0) {
      // Arise.
      if (owner[g] !== -1) continue;
      const cand = candidates[queue.a[id]];
      const civ = civs.length;
      civs.push({
        id: civ,
        origin: g,
        t0: cand.t0,
        speed: cand.speed,
        temper: cand.temper,
        baseMight: cand.baseMight,
      });
      held.push(0);
      take(t, g, civ, 'arise');
      log.push({ t, civ, kind: 'arise', galaxy: g });
      tLast = t;
      continue;
    }

    // Arrival of civ A at g from s.
    const A = queue.a[id];
    if (owner[s] !== A) continue; // the front was cut
    const B = owner[g];
    if (B === A) continue;
    if (B === -1) {
      take(t, g, A, 'colonize');
      tLast = t;
      continue;
    }

    const key = pairKey(A, B);
    let war = stance.get(key);
    if (war === undefined) {
      war = rng() < civs[A].temper;
      stance.set(key, war);
      log.push({ t, civ: A, kind: 'meet', other: B, galaxy: g });
      log.push({ t, civ: A, kind: war ? 'war' : 'peace', other: B, galaxy: g });
      tLast = t;
    }
    if (!war) continue;

    const battleKey = (A * n + g) * n + s;
    if (battles.has(battleKey)) continue;
    battles.add(battleKey);

    const mA = might(A, g);
    const mB = might(B, g) * p.defenderBonus;
    tLast = t;
    if (rng() * (mA + mB) < mA) {
      take(t, g, A, 'conquer');
      if (!firstConquest.has(key)) {
        firstConquest.add(key);
        log.push({ t, civ: A, kind: 'conquer', other: B, galaxy: g });
      }
      if (held[B] === 0) log.push({ t, civ: B, kind: 'extinct', other: A, galaxy: g });
    } else {
      // `civ` is the defender that repelled the attack, `other` the attacker.
      log.push({ t, civ: B, kind: 'repel', other: A, galaxy: g });
    }
  }

  // Did the lifetime cut anything short? An arrival after tEnd matters if it would still do
  // something: its front is intact, its target is not the civ's own, and it would colonize,
  // meet, or fight a battle that has not happened yet.
  let cutByLifetime = false;
  for (let k = 0; k < lateA.length && !cutByLifetime; k++) {
    const A = lateA[k], g = lateG[k], s = lateS[k];
    if (owner[s] !== A) continue;
    const B = owner[g];
    if (B === A) continue;
    if (B === -1) {
      cutByLifetime = true;
      continue;
    }
    const war = stance.get(pairKey(A, B));
    if (war === undefined || (war && !battles.has((A * n + g) * n + s))) cutByLifetime = true;
  }

  return {
    params: p,
    positions,
    civs,
    events,
    log,
    tLast: cutByLifetime ? p.tEndGyr : tLast,
    scale: cosmo.scale,
    edges,
    tToday: cosmo.tToday,
  };
}
