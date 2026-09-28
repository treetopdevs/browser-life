/** Constructed CPU load only: 100 overlapping flags, never natural outcomes. */
import { createHash } from "node:crypto";
import { CH, G, allocState, cellCount, defaultConfig } from "@bl/schema";
import { ResetOriginMap } from "../lib/reset-copy-extraction.ts";
import { ResetWindowPersistence } from "../lib/reset-window-persistence.ts";
import type { ResetFragmentationFlag } from "../lib/reset-topology.ts";

const cfg = { ...defaultConfig(), tileW: 256, tileH: 256,
  tilesX: 1, tilesY: 1, kernelRadius: 4 };
const state = allocState(cfg), n = cellCount(cfg);
for (const i of [0, 128]) {
  state.cells[CH.B * n + i] = 300;
  state.genome[G.LIN_LO * n + i] = 1;
}
const tags = new Uint32Array(n); tags[0] = 1; tags[128] = 129;
const follow = new ResetWindowPersistence(cfg, 0, 101 * n * 4);
const source = new TextEncoder().encode(await Deno.readTextFile(import.meta.filename!));
const output = `runs/foundational-reset/cpu-window-load-${Date.now()}.json`;
await Deno.mkdir("runs/foundational-reset", { recursive: true });
const fd = await Deno.open(output, { write: true, createNew: true }); fd.close();
const startedAt = new Date().toISOString(), start = performance.now();
const result: Record<string, unknown> = { status: "started-constructed-load",
  startedAt, codeSha256: createHash("sha256").update(source).digest("hex"),
  worldSites: n, injectedFlags: 100, futureSamplesPerFlag: 100,
  interpretation: "artificial repeated flags for memory and CPU cost only, not natural event frequency" };
try {
  for (let step = 1; step <= 200; step++) {
    const origins = ResetOriginMap.fromSnapshot({ referenceStep: step - 1,
      step, tags, diagnostics: new Uint32Array(n * 10) });
    const flags: ResetFragmentationFlag[] = step <= 100 ? [{
      step, priorComponent: step, priorMass: 600,
      branches: [{ currentComponent: 0, currentMass: 300, copiedSitesFromPrior: 1,
        preexistingOtherBoundSites: 0, preexistingOtherBoundCarrierMass: 0 },
      { currentComponent: 1, currentMass: 300, copiedSitesFromPrior: 1,
        preexistingOtherBoundSites: 0, preexistingOtherBoundCarrierMass: 0 }],
      interpretation: "copy-associated-separation-candidate-not-birth",
    }] : [];
    follow.observeStep(step, state.cells, state.genome, origins, flags);
  }
  const rows = follow.results();
  if (rows.length !== 100 || rows.some(row => row.status !== "complete-100-future-samples" ||
      row.samples.length !== 100)) throw new Error("constructed load failed to complete descriptors");
  result.status = "passed-constructed-load";
  result.elapsedSeconds = (performance.now() - start) / 1000;
  result.peakEstimatedActiveBytes = 100 * n * 4;
  result.results = rows.length;
} catch (error) {
  result.status = "failed-constructed-load";
  result.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  result.finishedAt = new Date().toISOString();
  await Deno.writeTextFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(output);
}
