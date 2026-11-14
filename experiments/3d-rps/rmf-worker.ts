// Worker for experiments/3d-rps/rmf-sweep.ts: runs one chunk of realizations of one lattice cell (rmf-lattice.ts runChunk) and posts the
// ChunkResult back, timed with performance.now. Messages carry only data. Nothing here is imported by anything else.
/// <reference lib="deno.worker" />
import { runChunk, type ChunkJob } from "./rmf-lattice.ts";

self.onmessage = (ev: MessageEvent<ChunkJob>) => {
  try {
    self.postMessage({ ok: true, result: runChunk(ev.data, () => performance.now()) });
  } catch (e) {
    self.postMessage({ ok: false, error: (e as Error).message ?? String(e) });
  }
};
