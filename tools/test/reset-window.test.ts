import { describe, expect, it } from "vitest";
import { CH, G, allocState, cellCount, defaultConfig } from "@bl/schema";
import { ResetOriginMap } from "../lib/reset-copy-extraction.ts";
import { resetWindowFrame, resolveResetWindowInterval } from "../lib/reset-window.ts";

const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
  kernelRadius: 2 };
function state(step: number, sites: [number, number][]) {
  const s = allocState(cfg), n = cellCount(cfg); s.step = step;
  for (const [i, mass] of sites) {
    s.cells[CH.B * n + i] = mass; s.genome[G.LIN_LO * n + i] = 1;
  }
  return s;
}
function map(step: number, sites: [number, number][]) {
  const tags = new Uint32Array(cellCount(cfg));
  for (const [destination, source] of sites) tags[destination] = source + 1;
  return ResetOriginMap.fromSnapshot({ step, referenceStep: step - 1, tags,
    diagnostics: new Uint32Array(tags.length * 10) });
}

describe("fixed continuous-window bookkeeping", () => {
  it("retains a raw geometry flag and annotates only census-interval co-occurrence", () => {
    const before = state(0, [[0, 300], [1, 300], [2, 300]]);
    const after = state(1, [[0, 300], [2, 300]]);
    const frame = resetWindowFrame(cfg, 1, 1, 1000, before.cells,
      after.cells, after.genome, map(1, [[0, 0], [2, 2]]));
    expect(frame).toMatchObject({ step: 1, enclosingCensusStep: 100,
      components48Four: 2, components1Eight: 2,
      trackerIntervalCooccurrence: "pending" });
    expect(frame.flags).toHaveLength(1);
    const rows = resolveResetWindowInterval([frame], 100,
      [{ step: 100, kind: "fission", parent: 99, children: [100] }]);
    expect(rows[0].trackerIntervalCooccurrence).toBe("fission");
    expect(rows[0].flags).toEqual(frame.flags);
    expect(rows[0].interpretation).toBe("raw-copy-associated-geometry-not-unique-reproduction-events");
    expect(resolveResetWindowInterval([frame], 100, null)[0]
      .trackerIntervalCooccurrence).toBe("unavailable");
    expect(() => resolveResetWindowInterval([frame], 100,
      [{ step: 200, kind: "fission", parent: 99, children: [100] }]))
      .toThrow(/one unresolved/);
  });

  it("refuses adjacent-step gaps, wrong fixed length and duplicate interval resolution", () => {
    const before = state(0, [[0, 300]]), after = state(1, [[0, 300]]);
    const origin = map(1, [[0, 0]]);
    expect(() => resetWindowFrame(cfg, 1, 1, 999, before.cells,
      after.cells, after.genome, origin)).toThrow(/fixed adjacent/);
    const row = resetWindowFrame(cfg, 1, 1, 1000, before.cells,
      after.cells, after.genome, origin);
    expect(() => resolveResetWindowInterval([row], 200, [])).toThrow(/one unresolved/);
    expect(() => resolveResetWindowInterval(
      resolveResetWindowInterval([row], 100, []), 100, [])).toThrow(/one unresolved/);
  });
});
