// Runs the simulation off the main thread. In: { id, params }. Out: { id, result } with the
// positions, scale and edges buffers transferred, or { id, error }.
import { simulate } from './engine';
import { SCALE_SAMPLES, TODAY_GYR, type Params, type SimResult } from './types';

export type WorkerRequest = { id: number; params: Partial<Params> };
export type WorkerResponse = { id: number; result: SimResult } | { id: number; error: string };

/** Distinct transferable buffers of a result (a buffer may only be listed once). */
function transferables(r: SimResult): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const a of [r.positions, r.scale, r.edges]) if (a?.buffer instanceof ArrayBuffer) out.add(a.buffer);
  return [...out];
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, params } = e.data;
  try {
    const result = simulate(params);
    // TEMP stub: fill contract fields the engine does not produce yet. Drop at merge.
    result.scale ??= new Float32Array(SCALE_SAMPLES).fill(1);
    result.edges ??= new Uint32Array(0);
    if (result.tToday === undefined) result.tToday = TODAY_GYR;
    (self as unknown as Worker).postMessage({ id, result } satisfies WorkerResponse, transferables(result));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies WorkerResponse);
  }
};
