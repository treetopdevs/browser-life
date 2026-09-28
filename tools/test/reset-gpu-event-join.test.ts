import { describe, expect, it } from "vitest";
import { cellCount, defaultConfig } from "@bl/schema";
import { joinResetMutationEvents } from "../lib/reset-gpu-event-join.ts";
import { RESET_DIAGNOSTIC_WORDS, type ResetGpuSnapshot } from "../lib/reset-gpu-copy-audit.ts";

const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1 };
const n = cellCount(cfg);
function frame(): ResetGpuSnapshot {
  const diagnostics = new Uint32Array(n * RESET_DIAGNOSTIC_WORDS);
  const put = (ch: number, site: number, v: number) => diagnostics[ch * n + site] = v;
  for (const site of [0, 1, 2]) { put(6, site, 0); put(7, site, 1); }
  put(8, 0, 101); put(9, 0, 0); put(5, 0, 1); put(4, 0, 4);
  put(8, 1, 101); put(9, 1, 1); put(5, 1, 0); put(4, 1, 5);
  return { step: 101, referenceStep: 99, tags: new Uint32Array(n), diagnostics };
}

describe("bounded passive mutation event join", () => {
  it("keeps exact earlier events while classifying only retained last-step evidence", () => {
    const rows = joinResetMutationEvents(cfg, 99, frame(), [
      { childHi: 100, childLo: 3, parentHi: 0, parentLo: 1 },
      { childHi: 101, childLo: 0, parentHi: 0, parentLo: 1 },
      { childHi: 101, childLo: 1, parentHi: 0, parentLo: 1 },
      { childHi: 101, childLo: 2, parentHi: 0, parentLo: 1 },
    ]);
    expect(rows.map(r => r.effect)).toEqual(["unavailable-earlier-step",
      "effective-genotype-change", "clamped-or-no-change-proposal", "transient-after-death"]);
    expect(rows.map(r => r.copySourceAtReference)).toEqual([null, 3, 4, null]);
    expect(rows.every(r => r.referenceStep === 99)).toBe(true);
  });

  it("rejects fabricated parent, duplicate event or wrong window", () => {
    const good = { childHi: 101, childLo: 0, parentHi: 0, parentLo: 1 };
    expect(() => joinResetMutationEvents(cfg, 99, frame(), [{ ...good, parentLo: 2 }]))
      .toThrow(/parent/);
    expect(() => joinResetMutationEvents(cfg, 99, frame(), [good, good]))
      .toThrow(/duplicate/);
    expect(() => joinResetMutationEvents(cfg, 100, frame(), [good]))
      .toThrow(/window/);
  });
});
