// Runs one discovery case in a browser Web Worker, so the page can enforce
// the case's wall-time limit by terminating it. CPU only.
import type { CaseSpec } from "@bl/schema";
import { runCase, type CaseRunOptions } from "../../../packages/runner/src/discovery.ts";

type Req = { spec: CaseSpec; initial: Uint8Array; opts: Omit<CaseRunOptions, "now" | "onProgress"> };

self.onmessage = async (ev: MessageEvent<Req>) => {
  const { spec, initial, opts } = ev.data;
  try {
    const out = await runCase(spec, initial, { ...opts, now: () => Date.now() });
    (self as unknown as Worker).postMessage({ ok: true, result: out.result, files: out.files });
  } catch (e) {
    (self as unknown as Worker).postMessage({ ok: false, error: (e as Error).message ?? String(e) });
  }
};
