// TEMP stub so the page can run before the real engine lands. A few fake civs grow in
// circles. Replaced by the engine unit at merge.
import { DEFAULTS, type Civ, type OwnershipEvent, type Params, type SimResult } from './types';

export function simulate(p: Partial<Params>): SimResult {
  const params: Params = { ...DEFAULTS, ...p };
  if (params.dim === 3 && params.geometry === 'sphere') params.geometry = 'flat';
  let s = 0;
  for (const ch of params.seed) s = (Math.imul(s, 31) + ch.charCodeAt(0)) | 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = params.galaxies, L = params.sizeGly, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (params.geometry === 'sphere') {
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z), R = L / (2 * Math.PI);
      pos.set([R * r * Math.cos(a), R * r * Math.sin(a), R * z], i * 3);
    } else pos.set([rnd() * L, rnd() * L, params.dim === 3 ? rnd() * L : 0], i * 3);
  }
  const civs: Civ[] = [];
  for (let id = 0; id < 5; id++)
    civs.push({ id, origin: Math.floor(rnd() * n), t0: rnd() * params.tEndGyr * 0.3, speed: 0.3 + rnd() * 0.6, temper: rnd(), baseMight: 1 });
  const events: OwnershipEvent[] = [];
  for (let g = 0; g < n; g++) {
    let best = -1, bt = Infinity;
    for (const c of civs) {
      const o = c.origin * 3, d = Math.hypot(pos[g * 3] - pos[o], pos[g * 3 + 1] - pos[o + 1], pos[g * 3 + 2] - pos[o + 2]);
      const t = c.t0 + d / c.speed;
      if (t < bt) { bt = t; best = c.id; }
    }
    if (bt <= params.tEndGyr) events.push({ t: bt, galaxy: g, owner: best, prev: -1, kind: civs[best].origin === g ? 'arise' : 'colonize' });
  }
  events.sort((a, b) => a.t - b.t);
  const log = civs.map((c) => ({ t: c.t0, civ: c.id, kind: 'arise' as const })).sort((a, b) => a.t - b.t);
  return { params, positions: pos, civs, events, log, tLast: events.length ? events[events.length - 1].t : params.tEndGyr };
}
