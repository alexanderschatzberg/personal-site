// Builds the 3d territory shells off the main thread (see shells.ts). In: 'init' once per run with
// the positions, then 'job' with an owner snapshot. Out: one reply per job, with every shell's
// position and normal arrays transferred. The page keeps at most one job here at a time
// (LatestWins), so a reply always answers the newest snapshot it sent.
import { ShellBuilder, type CivShell, type ShellOptions } from './shells';

export type ShellRequest =
  | ({ type: 'init'; positions: Float32Array } & ShellOptions)
  | { type: 'job'; seq: number; owner: Int32Array; civCount: number };
export type ShellResponse = { seq: number; shells: CivShell[]; ms: number } | { seq: number; error: string };

let builder: ShellBuilder | undefined;

self.onmessage = (e: MessageEvent<ShellRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    builder = new ShellBuilder(msg.positions, { L: msg.L, G: msg.G, periodic: msg.periodic });
    return;
  }
  const post = (r: ShellResponse, transfer: ArrayBuffer[] = []) => (self as unknown as Worker).postMessage(r, transfer);
  try {
    if (!builder) throw new Error('shell worker: job before init');
    const t0 = performance.now();
    const shells = builder.build(msg.owner, msg.civCount);
    const ms = performance.now() - t0;
    post({ seq: msg.seq, shells, ms }, shells.flatMap((s) => [s.positions.buffer as ArrayBuffer, s.normals.buffer as ArrayBuffer]));
  } catch (err) {
    post({ seq: msg.seq, error: String(err) });
  }
};
