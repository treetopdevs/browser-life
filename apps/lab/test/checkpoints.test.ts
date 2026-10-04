import { describe, expect, it } from "vitest";
import type { Intervention } from "@bl/schema";
import { jumpTarget, prunableAuto, replayPlan } from "../src/checkpoints.ts";

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

  describe("what a jump replays", () => {
    const lesion = (step: number): Intervention => ({ step, kind: "lesion", x: 1, y: 1, r: 2 });
    const pick = (step: number, donors: number[]): Intervention => ({ step, kind: "pick", cycle: step / 4, donors });
    // Picks at the boundaries t=4 and t=8, a lesion after each, and the world now at t=10.
    const log = [pick(4, [3, 1]), lesion(4), lesion(6), pick(8, [0]), lesion(8)];

    it("is everything before the step that the checkpoint has not seen, and a pick at the step itself", () => {
      expect(replayPlan(log, 0, 10, 10)).toEqual({ missed: log, dropped: 0, until: 11 });
      // A checkpoint at t=4 saved after its pick and lesion has seen two entries.
      expect(replayPlan(log, 2, 10, 10)).toEqual({ missed: log.slice(2), dropped: 0, until: 11 });
      // To a boundary: its cycle is part of arriving there, so its pick is replayed and the lesion made after it is not.
      expect(replayPlan(log, 0, 8, 10)).toEqual({ missed: log.slice(0, 4), dropped: 1, until: 9 });
      expect(replayPlan(log, 0, 4, 10)).toEqual({ missed: [log[0]], dropped: 4, until: 5 });
      // Between boundaries: the later entries stay with the saved present.
      expect(replayPlan(log, 0, 6, 10)).toEqual({ missed: log.slice(0, 2), dropped: 3, until: 7 });
      expect(replayPlan([], 0, 6, 10)).toEqual({ missed: [], dropped: 0, until: 7 });
    });

    it("never treats steps beyond the known history as replayed", () => {
      // A jump to t=6 kept only the entries before it. A second jump, to t=10, made while that replay stood at t=2
      // (so the history known runs to 6): the pick at t=8 is gone, and the boundary there must wait again.
      const first = replayPlan(log, 0, 6, 10);
      const second = replayPlan(first.missed, 0, 10, Math.max(2, first.until - 1));
      expect(second).toEqual({ missed: log.slice(0, 2), dropped: 0, until: 7 });
      // A jump forward from the present enters steps nobody has seen: nothing there is replayed.
      expect(replayPlan(log, 5, 30, 10).until).toBe(11);
    });
  });
});
