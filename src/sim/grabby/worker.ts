// Runs the simulation off the main thread. In: { id, params }. Out: { id, result } with
// the positions buffer transferred, or { id, error }.
import { simulate } from './engine';
import type { Params, SimResult } from './types';

export type WorkerRequest = { id: number; params: Partial<Params> };
export type WorkerResponse = { id: number; result: SimResult } | { id: number; error: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, params } = e.data;
  try {
    const result = simulate(params);
    (self as unknown as Worker).postMessage({ id, result } satisfies WorkerResponse, [result.positions.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies WorkerResponse);
  }
};
