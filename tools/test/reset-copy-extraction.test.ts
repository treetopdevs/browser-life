import { describe, expect, it } from "vitest";
import { CH, G, GENOME_CHANNELS, allocState, cellCount, defaultConfig,
  encodeGenome, generalistGenome } from "@bl/schema";
import { census } from "@bl/metrics";
import { ResetOriginMap, resetCopyShare } from "../lib/reset-copy-extraction.ts";
import type { ResetGpuSnapshot } from "../lib/reset-gpu-copy-audit.ts";
import type { ResetParentSupport } from "../lib/reset-probe-a-observer.ts";

function scene() {
  const cfg = { ...defaultConfig(), tileW: 8, tileH: 8, tilesX: 1, tilesY: 1,
    kernelRadius: 2 };
  const state = allocState(cfg), n = cellCount(cfg);
  const words = encodeGenome(generalistGenome(cfg.defaultMu, cfg.defaultSigma), 0, 1);
  for (const [i, B] of [[0, 100], [1, 200], [2, 300]]) {
    state.cells[CH.B * n + i] = B;
    for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + i] = words[g];
  }
  state.step = 100;
  const c = census({ cfg, step: state.step, cells: state.cells, genomeHead: state.genome });
  const tags = new Uint32Array(n); tags[0] = 1; tags[1] = 2;
  const snapshot: ResetGpuSnapshot = { step: 100, referenceStep: 0, tags,
    diagnostics: new Uint32Array(n * 10) };
  const parent: ResetParentSupport = { status: "available", referenceStep: 0,
    parentId: 7, sites: [0], sitesSha256: "frozen-parent-support" };
  return { cfg, state, c, snapshot, parent };
}

describe("composed copy origins and numeric child-support attribution", () => {
  it("keeps parent, known nonparent and unknown in both denominators without a majority label", () => {
    const s = scene(), map = ResetOriginMap.fromSnapshot(s.snapshot);
    const row = resetCopyShare(s.cfg, s.c, s.state.cells, s.state.genome, 0, map, s.parent);
    expect(row).toMatchObject({ status: "available", physicalSites: 3,
      genomeBearingSites: 3, genomeFreeSites: 0,
      parentLinkedSites: 1, knownNonparentSites: 1, unknownSites: 1,
      parentLinkedBoundCarrierMass: 100, knownNonparentBoundCarrierMass: 200,
      unknownBoundCarrierMass: 300,
      parentCellFractionInterval: [1 / 3, 2 / 3],
      parentBoundCarrierFractionInterval: [1 / 6, 4 / 6],
      interpretation: "copy-tagged-current-support-not-inherited-material" });
  });

  it("composes earlier origins across a later census reset instead of relabeling as latest sites", () => {
    const s = scene(), first = ResetOriginMap.fromSnapshot(s.snapshot);
    const later = new Uint32Array(cellCount(s.cfg));
    later[0] = 2; later[1] = 1; later[2] = 0;
    const second = first.compose({ step: 200, referenceStep: 100, tags: later,
      diagnostics: new Uint32Array(later.length * 10) });
    expect([...second.origins.slice(0, 3)]).toEqual([2, 1, 0]);
    expect(second.referenceStep).toBe(0);
    expect(second.currentStep).toBe(200);
    expect(() => first.compose({ step: 200, referenceStep: 99, tags: later,
      diagnostics: new Uint32Array(later.length * 10) })).toThrow(/gap/);
    const retainedInterval = ResetOriginMap.fromSnapshot({ step: 200,
      referenceStep: 100, tags: later,
      diagnostics: new Uint32Array(later.length * 10) });
    expect([...first.composeMap(retainedInterval).origins.slice(0, 3)])
      .toEqual([2, 1, 0]);
    expect(() => first.composeMap(first)).toThrow(/gap/);
  });

  it("retains unavailable parent and genome-free physical support explicitly", () => {
    const s = scene(), n = cellCount(s.cfg);
    s.state.genome[G.LIN_HI * n + 2] = 0;
    s.state.genome[G.LIN_LO * n + 2] = 0;
    const c = census({ cfg: s.cfg, step: 100, cells: s.state.cells,
      genomeHead: s.state.genome });
    const map = ResetOriginMap.fromSnapshot(s.snapshot);
    const unavailable: ResetParentSupport = { status: "unavailable", referenceStep: 0,
      parentId: 7, reason: "absent-prior-census" };
    const row = resetCopyShare(s.cfg, c, s.state.cells, s.state.genome, 0, map, unavailable);
    expect(row).toMatchObject({ status: "unavailable-parent-support", physicalSites: 3,
      genomeBearingSites: 2, genomeFreeSites: 1,
      parentLinkedSites: null, parentCellFractionInterval: null });
    const known = resetCopyShare(s.cfg, c, s.state.cells, s.state.genome, 0, map, s.parent);
    expect(known.parentCellFractionInterval).toEqual([1 / 2, 1 / 2]);
  });

  it("rejects a short origin map rather than treating absent tags as known nonparent copies", () => {
    const s = scene();
    const short = ResetOriginMap.fromSnapshot({ step: 100, referenceStep: 0,
      tags: new Uint32Array([1, 2]), diagnostics: new Uint32Array(20) });
    expect(() => resetCopyShare(s.cfg, s.c, s.state.cells, s.state.genome,
      0, short, s.parent)).toThrow(/matching physical census/);
  });

  it("marks a child with no genome-bearing support as an unavailable attribution endpoint", () => {
    const s = scene(), n = cellCount(s.cfg);
    for (let i = 0; i < 3; i++) {
      s.state.genome[G.LIN_HI * n + i] = 0;
      s.state.genome[G.LIN_LO * n + i] = 0;
    }
    const c = census({ cfg: s.cfg, step: 100, cells: s.state.cells,
      genomeHead: s.state.genome });
    const row = resetCopyShare(s.cfg, c, s.state.cells, s.state.genome, 0,
      ResetOriginMap.fromSnapshot(s.snapshot), s.parent);
    expect(row.status).toBe("unavailable-no-genome-bearing-child-sites");
    expect(row.genomeBearingSites).toBe(0);
    expect(row.parentCellFractionInterval).toBeNull();
  });
});
