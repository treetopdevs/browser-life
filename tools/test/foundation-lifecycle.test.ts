import { describe, expect, it } from "vitest";
import { CH, CELL_CHANNELS, defaultConfig } from "@bl/schema";
import { morphology, Tracker, type Census } from "@bl/metrics";
import { analyzeLifecycle, componentShapes, memberRanges, overlappingPriorIdentities,
  type ObservedWindow, type TrajectoryFrame } from "../lib/foundation-lifecycle.ts";

const shape = { cells: 1, mass: 512, biomass: 400, membraneFraction: 0.2, membraneCellStd: 0.1,
  rimCoreMembraneDifference: 0.2, compartmentalised: true,
  cellResourceMeans: { A: 100, C: 100, E: 100, S: 100 } };
const frame = (step: number, id: number, born: number): TrajectoryFrame => ({ ...shape,
  step, id, componentIndex: id, tile: 0, born, age: step - born, leftTruncated: false,
  lineage: "0:1", purity: 1, mass: 512 + id * 10 + (step - born) });
function window(life: ObservedWindow["life"], frames: TrajectoryFrame[], endStep = 500): ObservedWindow {
  return { startStep: 0, endStep, life, frames, trackerEvents: [], overlapMixing: [], censusDigests: [], membership: [] };
}

describe("in-situ lifecycle traceability", () => {
  it("computes per-component membrane organization from actual census labels", () => {
    const cfg = defaultConfig({ tileW: 5, tileH: 5, tilesX: 1, tilesY: 1 });
    const n = 25, cells = new Uint32Array(n * CELL_CHANNELS), labels = new Int32Array(n).fill(-1);
    let mass = 0, biomass = 0;
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) {
      const i = y * 5 + x, rim = x !== 2 || y !== 2, b = rim ? 20 : 100, p = rim ? 80 : 0;
      labels[i] = 0; cells[CH.B * n + i] = b; cells[CH.P * n + i] = p;
      cells[CH.A * n + i] = 100; mass += b + p; biomass += b;
    }
    const c: Census = { step: 100, labels, components: [{ idx: 0, cells: 9, mass, biomass,
      cx: 2, cy: 2, tile: 0, lineage: "0:1", purity: 1, mu: 0, sigma: 0 }], lineages: [], livingCells: 9 };
    const measured = componentShapes(cfg, cells, c)[0];
    expect(measured).toMatchObject({ cells: 9, mass: 900, biomass: 260, compartmentalised: true });
    expect(measured.rimCoreMembraneDifference).toBeCloseTo(0.8);
    expect(measured.membraneFraction).toBeCloseTo(640 / 900);
    expect(measured.cellResourceMeans.A).toBe(100);
    expect(morphology(cfg, cells, c, 1).compartmentalised).toBe(1);
    expect(memberRanges(labels, 0)).toEqual([[6, 3], [11, 3], [16, 3]]);
  });

  it("separates a three-identity split chain, G2 persistence and G2 reproduction", () => {
    const life: ObservedWindow["life"] = [
      { step: 100, kind: "birth", id: 1 },
      { step: 100, kind: "birth", id: 4 },
      { step: 200, kind: "fission", parent: 1, children: [2] },
      { step: 300, kind: "fission", parent: 2, children: [3] },
    ];
    const frames = [100, 200, 300, 400, 500].flatMap((step) => [
      ...(step >= 100 ? [frame(step, 1, 100), frame(step, 4, 100)] : []),
      ...(step >= 200 ? [frame(step, 2, 200)] : []),
      ...(step >= 300 ? [frame(step, 3, 300)] : []),
    ]);
    const result = analyzeLifecycle(window(life, frames), "source-test");
    expect(result.denominators).toMatchObject({ postBaselineIntroduced: 4, fissionChildren: 2,
      rawThreeIdentityChains: 1, cleanThreeIdentityChains: 1, age200Observed: 1,
      g2Reproduced: 0, g2RightCensoredBeforeReproduction: 1 });
    expect(result.selectedChains[0].g0g1).toHaveLength(2);
    expect(result.selectedChains[0].g1g2).toHaveLength(2);
    expect(result.selectedChains[0].g2Age200).toMatchObject({ status: "observed", age: 200 });
    expect(result.selectedChains[0].g2NextFission.status).toBe("right-censored");
    expect(result.selectedChains[0].nonlinkedObserverFamilyControls.find((r) =>
      r.link === "g0g1" && r.age === 100)).toMatchObject({ controlParentId: 4 });
    expect(result.selectedChains[0].matchedParentReassignmentControls.every((r) => r.parentId === null)).toBe(true);
    const noSelected = analyzeLifecycle(window(life, frames), "source-test", 0);
    expect(noSelected.selectedChains).toHaveLength(0);
    expect(noSelected.denominators.cleanThreeIdentityChains).toBe(1);
    expect(noSelected.denominators.age200Observed).toBe(1);
  });

  it("keeps fusion and right censoring distinct, and refuses fusion-contaminated chains", () => {
    const base: ObservedWindow["life"] = [
      { step: 100, kind: "birth", id: 1 },
      { step: 200, kind: "fission", parent: 1, children: [2] },
      { step: 300, kind: "fission", parent: 2, children: [3] },
    ];
    const frames = [frame(100, 1, 100), frame(200, 1, 100), frame(200, 2, 200),
      frame(300, 1, 100), frame(300, 2, 200), frame(300, 3, 300), frame(400, 3, 300)];
    const fused = analyzeLifecycle(window([...base,
      { step: 400, kind: "fusion", parents: [3, 99], child: 3 }], frames), "source-test");
    expect(fused.selectedChains[0].g2Age200.status).toBe("fusion");
    expect(fused.selectedChains[0].g2NextFission.status).toBe("fusion");
    const censored = analyzeLifecycle(window(base, frames, 400), "source-test");
    expect(censored.selectedChains[0].g2Age200.status).toBe("right-censored");
    const sameStep = analyzeLifecycle(window([...base,
      { step: 300, kind: "fusion", parents: [2, 99], child: 2 }], frames), "source-test");
    expect(sameStep.denominators).toMatchObject({ rawThreeIdentityChains: 1, cleanThreeIdentityChains: 0 });
  });

  it("finds crossing overlap mixing even when both parents continue and Tracker emits no fusion", () => {
    const previous = Int32Array.from([0, 0, 0, 0, 1, 1, 1, 1]);
    const labels = Int32Array.from([0, 0, 0, 1, 0, 1, 1, 1]);
    const priorCensus: Census = { step: 200, labels: previous, components: [
      { idx: 0, cells: 4, mass: 512, biomass: 400, cx: 0, cy: 0, tile: 0, lineage: "0:1", purity: 1, mu: 0, sigma: 0 },
      { idx: 1, cells: 4, mass: 512, biomass: 400, cx: 1, cy: 0, tile: 0, lineage: "0:1", purity: 1, mu: 0, sigma: 0 },
    ], lineages: [], livingCells: 8 };
    const census: Census = { step: 300, labels, components: [
      { idx: 0, cells: 4, mass: 512, biomass: 400, cx: 0, cy: 0, tile: 0, lineage: "0:1", purity: 1, mu: 0, sigma: 0 },
      { idx: 1, cells: 4, mass: 512, biomass: 400, cx: 1, cy: 0, tile: 0, lineage: "0:1", purity: 1, mu: 0, sigma: 0 },
    ], lineages: [], livingCells: 8 };
    const initialTracker = new Tracker({ threshold: 48, minMass: 256 });
    expect(initialTracker.update(priorCensus)).toEqual([]);
    const tracker = Tracker.fromJSON(initialTracker.toJSON());
    const priorIds = new Map([[0, tracker.idOf(0)!], [1, tracker.idOf(1)!]]);
    const actualEvents = tracker.update(census);
    expect(actualEvents.filter((event) => event.kind === "fusion")).toEqual([]);
    expect([...tracker.alive.keys()].sort()).toEqual([1, 2]);
    const mixed = overlappingPriorIdentities(previous, priorIds, census,
      (idx) => tracker.idOf(idx), tracker.opt.minMass);
    expect(mixed).toEqual([
      { step: 300, componentIndex: 0, currentId: 1, priorIds: [1, 2] },
      { step: 300, componentIndex: 1, currentId: 2, priorIds: [1, 2] },
    ]);
    const life: ObservedWindow["life"] = [
      { step: 100, kind: "birth", id: 1 },
      { step: 200, kind: "fission", parent: 1, children: [2] },
      { step: 300, kind: "fission", parent: 2, children: [3] },
    ];
    const observed = window(life, [frame(100, 1, 100), frame(200, 1, 100), frame(200, 2, 200),
      frame(300, 1, 100), frame(300, 2, 200), frame(300, 3, 300)]);
    observed.overlapMixing = mixed;
    const result = analyzeLifecycle(observed, "crossing");
    expect(result.denominators).toMatchObject({ rawThreeIdentityChains: 1, cleanThreeIdentityChains: 0,
      overlapMixedComponents: 2, overlapMixedWithoutTrackerFusion: 2 });
  });
});
