import { describe, expect, it } from "vitest";
import { CH, G, allocState, cellCount, defaultConfig } from "@bl/schema";
import { ResetOriginMap } from "../lib/reset-copy-extraction.ts";
import { resetFragmentationFlags } from "../lib/reset-topology.ts";
import { ResetWindowPersistence } from "../lib/reset-window-persistence.ts";

const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
  kernelRadius: 2 };
function scene(step: number, bridge = false) {
  const s = allocState(cfg), n = cellCount(cfg); s.step = step;
  for (const site of [0, 2]) {
    s.cells[CH.B * n + site] = 300;
    s.genome[G.LIN_LO * n + site] = 1;
  }
  if (bridge) s.cells[CH.B * n + 1] = 1;
  return s;
}
function origin(step: number, assignments: [number, number][]) {
  const tags = new Uint32Array(cellCount(cfg));
  for (const [destination, source] of assignments) tags[destination] = source + 1;
  return ResetOriginMap.fromSnapshot({ referenceStep: step - 1, step, tags,
    diagnostics: new Uint32Array(tags.length * 10) });
}

describe("per-flag 100-future-sample persistence descriptor", () => {
  it("retains every future sample, including transient contact, with no event grouping", () => {
    const prior = scene(0);
    prior.cells[CH.B * cellCount(cfg) + 1] = 300;
    const first = scene(1);
    const flags = resetFragmentationFlags(cfg, 1, prior.cells, first.cells,
      first.genome, origin(1, [[0, 0], [2, 2]]));
    expect(flags).toHaveLength(1);
    const follow = new ResetWindowPersistence(cfg, 0, 64 * 4 * 2);
    follow.observeStep(1, first.cells, first.genome,
      origin(1, [[0, 0], [2, 2]]), flags);
    expect(follow.results()[0].status).toBe("incomplete");
    for (let step = 2; step <= 101; step++) {
      const current = scene(step, step === 50);
      follow.observeStep(step, current.cells, current.genome,
        origin(step, [[0, 0], [2, 2]]), []);
    }
    const result = follow.results()[0];
    expect(result).toMatchObject({ flagStep: 1,
      status: "complete-100-future-samples", branchComponentIndices: [0, 1] });
    expect(result.samples).toHaveLength(100);
    expect(result.samples.map(x => x.offset)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1));
    expect(result.samples.find(x => x.step === 50)?.status)
      .toBe("shared-physical-support");
    expect(result.samples.find(x => x.step === 51)?.status)
      .toBe("known-separated");
    expect(follow.activeBytes).toBe(0);
  });

  it("keeps a partial descriptor on missing future samples and rejects nonadjacent input", () => {
    const prior = scene(0), first = scene(1);
    prior.cells[CH.B * cellCount(cfg) + 1] = 300;
    const flags = resetFragmentationFlags(cfg, 1, prior.cells, first.cells,
      first.genome, origin(1, [[0, 0], [2, 2]]));
    const follow = new ResetWindowPersistence(cfg, 0, 64 * 4);
    follow.observeStep(1, first.cells, first.genome,
      origin(1, [[0, 0], [2, 2]]), flags);
    const second = scene(2);
    expect(() => follow.observeStep(3, second.cells, second.genome,
      origin(3, [[0, 0], [2, 2]]), [])).toThrow(/exact adjacent/);
    expect(follow.results()[0]).toMatchObject({ status: "incomplete", samples: [] });
  });

  it("propagates unknown ancestry across later known one-step sources", () => {
    const prior = scene(0), first = scene(1);
    prior.cells[CH.B * cellCount(cfg) + 1] = 300;
    const flags = resetFragmentationFlags(cfg, 1, prior.cells, first.cells,
      first.genome, origin(1, [[0, 0], [2, 2]]));
    const follow = new ResetWindowPersistence(cfg, 0, 64 * 4);
    follow.observeStep(1, first.cells, first.genome,
      origin(1, [[0, 0], [2, 2]]), flags);
    const second = scene(2), third = scene(3);
    follow.observeStep(2, second.cells, second.genome,
      origin(2, [[0, 0]]), []);
    follow.observeStep(3, third.cells, third.genome,
      origin(3, [[0, 0], [2, 2]]), []);
    const samples = follow.results()[0].samples;
    expect(samples.map(x => [x.status, x.unknownGenomeBearingCopySites]))
      .toEqual([["unknown-copy-origin", 1], ["unknown-copy-origin", 1]]);
    expect(samples[1].knownCopySitesByBranch).toEqual([1, 0]);
  });
});
