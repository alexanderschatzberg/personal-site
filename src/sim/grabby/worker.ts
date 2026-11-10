// Runs the simulation off the main thread. In: { id, params }. Out: { id, result } with the
// positions, scale and edges buffers transferred, or { id, error }. While a run is going, it
// also posts { id, progress } (throttled to ≤ 10/s) if the engine reports progress.
import * as engine from './engine';
import type { Params, SimResult } from './types';
import { throttleProgress, type OnProgress } from './view/progress';

export type WorkerRequest = { id: number; params: Partial<Params> };
export type WorkerProgress = { id: number; progress: { stage: string; frac: number } };
export type WorkerResponse = { id: number; result: SimResult } | { id: number; error: string } | WorkerProgress;

/** The engine's optional progress-reporting entry point (absent on older engines). */
type WithProgress = (p: Partial<Params>, onProgress?: OnProgress) => SimResult;

/** Distinct transferable buffers of a result (a buffer may only be listed once). */
function transferables(r: SimResult): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const a of [r.positions, r.scale, r.edges]) if (a?.buffer instanceof ArrayBuffer) out.add(a.buffer);
  return [...out];
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, params } = e.data;
  const post = (msg: WorkerResponse, transfer: ArrayBuffer[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
  try {
    const withProgress = (engine as { simulateWithProgress?: WithProgress }).simulateWithProgress;
    const onProgress = throttleProgress((stage, frac) => post({ id, progress: { stage: String(stage ?? ''), frac: Number(frac) } }));
    const result = typeof withProgress === 'function' ? withProgress(params, onProgress) : engine.simulate(params);
    post({ id, result }, transferables(result));
  } catch (err) {
    post({ id, error: String(err) });
  }
};
