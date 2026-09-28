/** Real A2 garden orchestration with its runner boundary replaced; no physical GPU claim. */
import { describe, expect, it, vi } from "vitest";
import type { SourceIdentity } from "../lib/foundation-replay.ts";
import { prepareV2Start } from "../lib/foundation-serial-v2.ts";

vi.mock("@bl/runner", async (loadOriginal) => {
  const actual = await loadOriginal<typeof import("@bl/runner")>();
  return { ...actual, runExperiment: vi.fn(async (_device: unknown, _spec: unknown,
    sink: { appendText: (name: string, content: string) => Promise<void> },
    _host: unknown, progress: () => void) => {
    await sink.appendText("series.jsonl", JSON.stringify({ step: 25,
      conservationOk: true, mutations: 0, pools: { B: 0, P: 0 } }) + "\n");
    progress();
    throw new Error("mock runner unexpectedly returned after progress");
  }) };
});

const source = { runId: "m4/gradient-m3/treatment/seed-1", spec: {
  experiment: "m4", presetId: "gradient-m3", condition: "treatment", seed: 1,
  steps: 1_000_000, censusEvery: 100, deepEvery: 500, checkpointEvery: 0,
} } as SourceIdentity;

describe("A2 runV2Garden injected runner boundary", () => {
  it("propagates a mid-garden cap after a real partial observer series", async () => {
    const { runV2Garden } = await import("../lib/foundation-serial-v2-run.ts");
    const start = prepareV2Start(source, 0, "empty", null);
    let checked = 0;
    const check = (where: string) => {
      checked++;
      if (where === "A2 measured empty") throw new Error("injected-time-cap");
    };
    await expect(runV2Garden({} as GPUDevice, start,
      { host: "test", adapter: "mock runner; no GPU" }, check))
      .rejects.toThrow("injected-time-cap");
    expect(checked).toBeGreaterThan(2);
  });
});
