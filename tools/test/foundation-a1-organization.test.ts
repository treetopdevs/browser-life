import { describe, expect, it } from "vitest";
import { joinA1Organization, type A1Morphology } from "../lib/foundation-a1-organization.ts";

const hash = "a".repeat(64);
const frame = (step: number, componentIndex: number, biomass: number, mass: number): A1Morphology => ({
  subject: "imported-root", targetStep: step, status: "observed",
  frame: { step, componentIndex, id: 1, cells: 2, mass, biomass,
    membraneFraction: mass === biomass ? 0 : 0.25, membraneCellStd: 0,
    rimCoreMembraneDifference: 0, compartmentalised: false,
    cellResourceMeans: { A: 1, C: 2, E: 3, S: 4 } },
  memberRanges: [[7, 2]],
});
const fixture = () => ({
  transitions: [
    { step: 100, components: [{ componentIndex: 0, currentCells: 2,
      currentMass: 100, copyOriginStatus: "one-initial-region", unknownCopyCells: 0 },
      { componentIndex: 1, currentCells: 1, currentMass: 8,
        copyOriginStatus: "ambiguous", unknownCopyCells: 1 }] },
    { step: 175, components: [{ componentIndex: 0, currentCells: 1,
      currentMass: 50, copyOriginStatus: "one-initial-region", unknownCopyCells: 0 }] },
    { step: 200, components: [{ componentIndex: 0, currentCells: 2,
      currentMass: 100, copyOriginStatus: "one-initial-region", unknownCopyCells: 0 }] },
    { step: 225, components: [{ componentIndex: 0, currentCells: 1,
      currentMass: 50, copyOriginStatus: "one-initial-region", unknownCopyCells: 0 }] },
  ], material: [{ step: 175, componentIndex: 0, cells: 1,
    reactionMaterialOwnership: "unavailable-after-mixing", genomeCopyValidation: "all-matched",
    postReactionBoundMinusIncomingBound: "3" }],
  morphology: [frame(100, 0, 100, 100), frame(200, 0, 90, 100)],
  census100: [{ step: 100, labelsSha256: hash }, { step: 200, labelsSha256: hash }],
  serialTraceMatched: true,
});

describe("post-execution A1 organization join", () => {
  it("retains every unit, a positive-polymer and zero-polymer trait, and explicit missing ages", () => {
    const rows = joinA1Organization(fixture());
    expect(rows).toHaveLength(5);
    expect(rows[0].morphology?.membraneFraction).toBe(0);
    expect(rows[0].morphology?.traitStatus).toBe("uninformative-zero-polymer");
    expect(rows[0].biologicalAge).toBeNull();
    expect(rows[1].morphologyAvailability).toBe("not-captured-for-component");
    expect(rows[2].morphologyAvailability).toBe("not-sampled-at-25-cadence");
    expect(rows[2].material?.postReactionBoundMinusIncomingBound).toBe("3");
    expect(rows[3].morphology?.traitStatus).toBe("measured-polymer-present");
    expect(rows[3].morphology?.membraneFraction).toBe(0.25);
    expect(rows[4].morphologyAvailability).toBe("not-sampled-at-25-cadence");
  });
  it("rejects missing exact trace parity and a bad physical component join", () => {
    expect(() => joinA1Organization({ ...fixture(), serialTraceMatched: false })).toThrow(/parity/);
    const bad = fixture(); bad.morphology[0].memberRanges = [[7, 1]];
    expect(() => joinA1Organization(bad)).toThrow(/physical component/);
    const bad2 = fixture(); bad2.morphology[0].frame!.mass = 99;
    expect(() => joinA1Organization(bad2)).toThrow(/physical component/);
  });
  it("refuses orphaned material and ambiguous morphology", () => {
    const bad = fixture(); bad.material[0].componentIndex = 99;
    expect(() => joinA1Organization(bad)).toThrow(/orphan material/);
    const bad2 = fixture(); bad2.morphology.push(frame(100, 0, 100, 100));
    expect(() => joinA1Organization(bad2)).toThrow(/ambiguous morphology/);
  });
});
