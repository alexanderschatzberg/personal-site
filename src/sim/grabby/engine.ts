// The grabby-aliens simulation: seeded galaxies, civ origins, and an event-driven expansion
// along a k-nearest-neighbour graph with first-contact stances and battles.
// Browser-safe: runs in a Web Worker.

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

  // 6. Origin candidates.
  const q = 1 - Math.exp((-p.pLife * p.planetsPerGalaxy * REAL_GALAXIES) / n);
  const candidates: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    if (rng() >= q) continue;
    const t0 = p.tEndGyr * Math.pow(rng(), 1 / (p.hardSteps + 1));
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

  const might = (civ: number, g: number): number => {
    const base = civs[civ].baseMight;
    const N = held[civ];
    switch (p.mightModel) {
      case 'power':
        return base * Math.pow(N, p.mightExponent);
      case 'log':
        return base * Math.log(1 + N);
      case 'frontier':
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
    for (let e = graph.start[g]; e < graph.start[g + 1]; e++) {
      queue.push(t + graph.w[e] / speed, civ, graph.adj[e], g);
    }
    return prev;
  };

  let tLast = 0;
  let ranToEnd = false;
  while (queue.size > 0) {
    const id = queue.peek();
    const t = queue.t[id];
    if (t > p.tEndGyr) {
      ranToEnd = true;
      break;
    }
    queue.pop();
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

  return {
    params: p,
    positions,
    civs,
    events,
    log,
    tLast: ranToEnd ? p.tEndGyr : tLast,
  };
}
