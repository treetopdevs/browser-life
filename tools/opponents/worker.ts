// Worker thread: one contest per message. The @bl/* resolver is registered first, before the assay is imported
// (a hook registered in the parent does not reach a worker, and a plain Node 24 worker fails with ERR_MODULE_NOT_FOUND for @bl/schema).
import { parentPort } from "node:worker_threads";
import { registerAliases } from "./boot.ts";

registerAliases();
const arena = await import("../../packages/metrics/src/opponents/arena.ts");

parentPort!.on("message", (m: { id: number; job: import("../../packages/metrics/src/opponents/arena.ts").Job; params: import("../../packages/metrics/src/opponents/arena.ts").ArenaParams }) => {
  try {
    parentPort!.postMessage({ id: m.id, result: arena.runJob(m.job, m.params) });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: (e as Error).stack ?? String(e) });
  }
});
parentPort!.postMessage({ ready: true });
