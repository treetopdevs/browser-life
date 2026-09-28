import { describe, expect, it } from "vitest";
import { CH, G, cellCount, defaultConfig } from "@bl/schema";
import { behaviorSamples, compareBehaviorTraces } from "../src/foundation-behavior.ts";

const cfg = defaultConfig({ tileW: 32, tileH: 32, tilesX: 2, tilesY: 1 });
const n = cellCount(cfg);
const buffers = () => ({ cells: new Uint32Array(n * 7), head: new Uint32Array(n * 4), roles: new Uint32Array(n * 2) });

describe("foundation behavior observation", () => {
  it("resolves known fixed roles by living-cell denominator and leaves an empty tile unavailable", () => {
    const { cells, head, roles } = buffers();
    cells[CH.B * n] = 100; cells[CH.P * n] = 50;
    cells[CH.B * n + 1] = 50; cells[CH.P * n + 1] = 50;
    head[G.LIN_LO * n] = 1; head[G.LIN_LO * n + 1] = 2;
    roles[0] = 10; // photo flux; lineage 1 -> phototroph
    roles[3] = 20; // decomp flux; lineage 2 -> decomposer
    const [a, empty] = behaviorSamples(cfg, 100, cells, head, roles, [
      { distanceCells: 4, observedIntervals: 2, intervalSteps: 100 },
      { distanceCells: 0, observedIntervals: 0, intervalSteps: 100 },
    ]);
    expect(a).toMatchObject({ livingCells: 2, biomass: 150, polymer: 100, boundMass: 250, membraneFraction: 0.4 });
    expect(a.roles.availability).toBe("available");
    expect(a.roles.denominatorLivingCells).toBe(2);
    expect(a.roles.totalCatalyticQuanta).toBe(30);
    expect(a.roles.zeroFluxLineageCells).toBe(0);
    expect(a.roles.shares).toEqual({ phototroph: 0.5, chemotroph: 0, decomposer: 0.5, mixed: 0 });
    expect(a.roles.effectiveDiversity).toBeCloseTo(2);
    expect(a.movement).toMatchObject({ observedIntervals: 2, meanCellsPer100Steps: 2 });
    expect(empty.roles).toMatchObject({ availability: "no-living-cells", denominatorLivingCells: 0,
      shares: null, effectiveDiversity: null });
    expect(empty.membraneFraction).toBeNull();
    expect(empty.movement.meanCellsPer100Steps).toBeNull();
  });

  it("does not call zero-activity living cells mixed-role evidence, or missing buffers zero flux", () => {
    const { cells, head, roles } = buffers();
    head[G.LIN_LO * n] = 1;
    cells[CH.B * n] = 10;
    const zeroActivity = behaviorSamples(cfg, 8, cells, head, roles)[0];
    expect(zeroActivity.roles).toMatchObject({ availability: "no-catalytic-activity", denominatorLivingCells: 1,
      zeroFluxLineageCells: 1, totalCatalyticQuanta: 0, shares: null, effectiveDiversity: null });
    const missing = behaviorSamples(cfg, 8, cells, head)[0];
    expect(missing.roles).toMatchObject({ availability: "missing-role-buffer", totalCatalyticQuanta: null, shares: null });
    expect(() => behaviorSamples(cfg, 8, cells, head, new Uint32Array(1))).toThrow(/length mismatch/);
  });

  it("compares only aligned points and preserves unavailable role/movement differences", () => {
    const { cells, head, roles } = buffers();
    cells[CH.B * n] = 10;
    head[G.LIN_LO * n] = 1;
    const parent = behaviorSamples(cfg, 8, cells, head, roles).slice(0, 1);
    cells[CH.B * n] = 15;
    const mutant = behaviorSamples(cfg, 8, cells, head, roles).slice(0, 1);
    expect(compareBehaviorTraces(parent, mutant)[0]).toMatchObject({ boundMassDifference: 5,
      effectiveRoleDiversityDifference: null, fixedRoleShareDifferences: null, movementDifference: null });
    expect(() => compareBehaviorTraces(parent, [])).toThrow(/different lengths/);
    expect(() => compareBehaviorTraces(parent, [{ ...mutant[0], step: 9 }])).toThrow(/schedule differs/);
  });
});
