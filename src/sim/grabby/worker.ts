// Runs the simulation off the main thread. In: { id, params }. Out: { id, result } with the
// positions, scale and edges buffers transferred, or { id, error }.
import { simulate } from './engine';
import type { Params, SimResult } from './types';

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
    (self as unknown as Worker).postMessage({ id, result } satisfies WorkerResponse, transferables(result));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies WorkerResponse);
  }
};
