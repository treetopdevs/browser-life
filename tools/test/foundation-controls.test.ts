import { describe, expect, it } from "vitest";
import { buildFoundationControlReport, summarizeObservations } from "../lib/foundation-controls";

describe("constructed foundation observer controls", () => {
  it("runs known topology, tracking, collective, and morphology controls through existing metrics", () => {
    const report = buildFoundationControlReport();
    expect(report.controls.every((row) => Object.values(row.asserted).every((v) => v === "supported"))).toBe(true);
    expect(report.controls.find((row) => row.id === "separate-vs-contacting")?.measured).toMatchObject({
      isolatedComponents: 2,
      contactingComponents: 1,
      contactingLineages: 2,
    });
    expect(report.controls.find((row) => row.id === "split-readback")?.measured.fissions).toBe(1);
    expect(report.controls.find((row) => row.id === "fusion-readback")?.measured.fusions).toBe(1);
    expect(report.controls.find((row) => row.id === "zero-overlap-transport")?.measured).toMatchObject({ births: 1, deaths: 1 });
    expect(report.controls.find((row) => row.id === "membrane-rim-core")?.measured).toMatchObject({ membraneRimCore: 1, uniformComposition: 0 });
    expect(report.controls.find((row) => row.id === "hollow-shell-limit")?.measured.hollowShellCounted).toBe(0);
  });

  it("shows cadence and component thresholds change observer outcomes", () => {
    const report = buildFoundationControlReport();
    expect(report.sensitivity.censusCadence).toEqual([
      { censusEvery: 1, readbacks: 3, fissions: 1, fusions: 1 },
      { censusEvery: 2, readbacks: 2, fissions: 0, fusions: 0 },
    ]);
    expect(report.sensitivity.deepCadence).toEqual([
      { deepEvery: 1, scheduledDeepReadbacks: 3, finite: 3, missing: 0, compartmentalised: 1 / 3 },
      { deepEvery: 2, scheduledDeepReadbacks: 2, finite: 2, missing: 0, compartmentalised: 0 },
    ]);
    expect(report.sensitivity.componentThresholds).toContainEqual({ cellThreshold: 48, minMass: 300, components: 1, trackedIndividuals: 1 });
    expect(report.sensitivity.componentThresholds).toContainEqual({ cellThreshold: 49, minMass: 300, components: 2, trackedIndividuals: 2 });
    expect(report.sensitivity.componentThresholds).toContainEqual({ cellThreshold: 48, minMass: 2000, components: 1, trackedIndividuals: 0 });
  });

  it("preserves denominators and reports no finite readback as unavailable, not zero", () => {
    expect(summarizeObservations([null, Number.NaN, undefined], 4)).toEqual({
      scheduled: 4,
      readbacks: 3,
      finite: 0,
      missing: 4,
      mean: null,
      min: null,
      max: null,
    });
    expect(summarizeObservations([2, null], 2)).toEqual({
      scheduled: 2,
      readbacks: 2,
      finite: 1,
      missing: 1,
      mean: 2,
      min: 2,
      max: 2,
    });
  });
});
