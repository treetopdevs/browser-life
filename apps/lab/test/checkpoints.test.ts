import { describe, expect, it } from "vitest";
import { jumpTarget, prunableAuto } from "../src/checkpoints.ts";

const ck = (file: string, step: number, auto = false) => ({ file, step, hash: "h", interventions: 0, edges: 0, dropped: 0, ...(auto ? { auto } : {}) });

describe("lab checkpoint policies", () => {
  // Run A saved automatic checkpoints at 20k..120k and a manual one at 130k; fork B (restored from 100k)
  // lists A's first five and adds its own.
  const a = ["20", "40", "60", "80", "100", "120"].map((k) => ck(`spots-s1-a-t${k}000-x.blck`, Number(k) * 1000, true));
  const fork = { runId: "spots-s1-a-bq", checkpoints: [...a.slice(0, 5), ck("spots-s1-a-bq-t120000-y.blck", 120_000, true), ck("spots-s1-a-bq-t140000-z.blck", 140_000, true)] };

  it("prunes only the run's own automatic checkpoints, never its parent's", () => {
    expect(prunableAuto(fork, 6)).toEqual([]);
    expect(prunableAuto(fork, 1).map((c) => c.file)).toEqual(["spots-s1-a-bq-t120000-y.blck"]);
    const parent = { runId: "spots-s1-a", checkpoints: [...a, ck("spots-s1-a-t130000-m.blck", 130_000)] };
    expect(prunableAuto(parent, 4).map((c) => c.step)).toEqual([20_000, 40_000]);
  });

  it("jumps to the latest checkpoint at or before the step that still exists", () => {
    const onDisk = new Set(fork.checkpoints.map((c) => c.file).filter((f) => !f.includes("t40000")));
    expect(jumpTarget(fork.checkpoints, onDisk, 50_000)?.step).toBe(20_000);
    expect(jumpTarget(fork.checkpoints, onDisk, 130_000)?.step).toBe(120_000);
    expect(jumpTarget(fork.checkpoints, onDisk, 19_999)).toBeUndefined();
  });
});
