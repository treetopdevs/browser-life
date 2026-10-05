// Runs one discovery case inside a Deno Worker, so the parent can enforce the
// per-case wall-time limit by terminating it. Messages carry only data.
/// <reference lib="deno.worker" />
import type { CaseSpec } from "@bl/schema";
import { runCase, type CaseRunOptions } from "../packages/runner/src/discovery.ts";

type Req = { spec: CaseSpec; initial: Uint8Array; opts: Omit<CaseRunOptions, "now" | "onProgress"> };

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { spec, initial, opts } = ev.data;
  try {
    const out = await runCase(spec, initial, { ...opts, now: () => Date.now() });
    self.postMessage({ ok: true, result: out.result, files: out.files });
  } catch (e) {
    self.postMessage({ ok: false, error: (e as Error).message ?? String(e) });
  }
};
