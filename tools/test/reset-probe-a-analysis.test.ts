import { describe, expect, it } from "vitest";
import { CH, G, allocState, cellCount, defaultConfig } from "@bl/schema";
import { census } from "@bl/metrics";
import { ResetOriginMap } from "../lib/reset-copy-extraction.ts";
import { ResetProbeAAnalysis, type ResetSelectedLink } from "../lib/reset-probe-a-analysis.ts";
import type { ResetProbeAObserver } from "../lib/reset-probe-a-observer.ts";

const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
  kernelRadius: 2 };
const row: ResetSelectedLink = { rowIndex: 7, h: 1, step: 200,
  kind: "budding", parent: 10, child: 11,
  parentLineage: "0:1", childLineage: "0:1",
  parentPurity: 1, childPurity: 1 };
function frame(step: number, childSite: number) {
  const state = allocState(cfg), n = cellCount(cfg); state.step = step;
  for (const i of [0, childSite]) {
    state.cells[CH.B * n + i] = 300;
    state.genome[G.LIN_LO * n + i] = 1;
  }
  return { step, cells: state.cells, genomeHead: state.genome };
}
function origin(referenceStep: number, step: number,
  assignments: [number, number][]) {
  const tags = new Uint32Array(cellCount(cfg));
  for (const [destination, source] of assignments) tags[destination] = source + 1;
  return ResetOriginMap.fromSnapshot({ referenceStep, step, tags,
    diagnostics: new Uint32Array(tags.length * 10) });
}

describe("selected link adapter across census resets", () => {
  it("retains t−100 parent origin and independently composes birth-t focal reference for all 11 samples", () => {
    let currentStep = 100;
    const initial = frame(100, 3);
    let currentCensus = census({ cfg, step: 100, cells: initial.cells,
      genomeHead: initial.genomeHead });
    const observer = {
      get currentStep() { return currentStep; },
      get census() { return currentCensus; },
      parentSupport(parentId: number) {
        if (currentStep !== 100 || parentId !== 10) throw new Error("wrong prior census");
        return { status: "available" as const, referenceStep: 100,
          parentId, sites: [0], sitesSha256: "parent-at-100" };
      },
      componentForTrackerId(id: number) {
        return id === 10 ? 0 : id === 11 ? 1 : null;
      },
      observeNext(s: { step: number; cells: Uint32Array; genomeHead: Uint32Array }) {
        currentStep = s.step;
        currentCensus = census({ cfg, step: s.step, cells: s.cells,
          genomeHead: s.genomeHead });
        return { census: currentCensus,
          life: s.step === 200 ? [{ step: 200, kind: "budding", parent: 10, child: 11 }] : [] };
      },
    } as unknown as ResetProbeAObserver;
    const analysis = new ResetProbeAAnalysis(cfg, observer, [row]);
    const born = frame(200, 3);
    analysis.observeCensus(born, origin(100, 200, [[0, 0], [3, 0]]), 0);
    expect(analysis.rows()[0].birthCopyShare).toMatchObject({
      status: "available", parentLinkedSites: 1,
      parentCellFractionInterval: [1, 1] });
    let previousChild = 3;
    for (let step = 300; step <= 1200; step += 100) {
      const childSite = step >= 400 ? 5 : 3;
      const state = frame(step, childSite);
      analysis.observeCensus(state, origin(step - 100, step,
        [[0, 0], [childSite, previousChild]]), 0);
      previousChild = childSite;
    }
    const evidence = analysis.rows()[0];
    expect(evidence.samples).toHaveLength(22);
    expect(evidence.samples.filter(x => x.rule.threshold === 1).map(x => x.step))
      .toEqual([200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]);
    expect(evidence.samples.at(-1)?.branches[0]).toMatchObject({
      genomeBearingCopySites: 1, copyAssociatedBoundCarrierMass: 300 });
    expect(evidence.samples.at(-1)?.comparisons[0].status).toBe("sampled-disconnected");
    expect(analysis.pendingRows()).toEqual([]);
  });

  it("rejects duplicate selected rows before observation", () => {
    const observer = { currentStep: 100 } as ResetProbeAObserver;
    expect(() => new ResetProbeAAnalysis(cfg, observer, [row, row]))
      .toThrow(/identity or census/);
  });

  it("rejects a missing original event even when child support is unavailable", () => {
    const initial = frame(100, 3);
    const prior = census({ cfg, step: 100, cells: initial.cells,
      genomeHead: initial.genomeHead });
    const observer = {
      currentStep: 100, census: prior,
      parentSupport: () => ({ status: "available" as const, referenceStep: 100,
        parentId: 10, sites: [0], sitesSha256: "parent-at-100" }),
      componentForTrackerId: (id: number) => id === 10 ? 0 : null,
      observeNext: (s: { step: number; cells: Uint32Array; genomeHead: Uint32Array }) => ({
        census: census({ cfg, step: s.step, cells: s.cells, genomeHead: s.genomeHead }),
        life: [],
      }),
    } as unknown as ResetProbeAObserver;
    const analysis = new ResetProbeAAnalysis(cfg, observer, [row]);
    const born = frame(200, 3);
    expect(() => analysis.observeCensus(born, origin(100, 200, [[0, 0], [3, 0]]), 0))
      .toThrow(/exact emitted life event/);
    expect(analysis.rows()).toEqual([]);
  });
});
