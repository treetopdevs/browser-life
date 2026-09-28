import { describe, expect, it } from "vitest";
import { CH, GENOME_CHANNELS, allocState, cellCount, defaultConfig, encodeGenome,
  generalistGenome, type WorldState } from "@bl/schema";
import { SerialGardenCapture } from "../lib/foundation-serial-capture.ts";

const cfg = () => ({ ...defaultConfig(), tileW: 16, tileH: 16, tilesX: 1, tilesY: 1,
  kernelRadius: 2, seed: 640010001, mutRate: 0 });
const identity = { sourceKey: "source-1/late/rank-0", arm: "donor" as const,
  cycle: 0 as const, seed: 640010001,
  importedFragment: { kind: "evolved-source-unknown-age" as const } };
type Point = [number, number];
const line = (from: number, to: number, y = 3): Point[] =>
  Array.from({ length: to - from + 1 }, (_, i) => [from + i, y]);
function state(step: number, groups: { points: Point[]; genomeVariant?: boolean }[]): WorldState {
  const s = allocState(cfg()), n = cellCount(s.cfg);
  s.step = step;
  const base = encodeGenome(generalistGenome(s.cfg.defaultMu, s.cfg.defaultSigma), 0, 3);
  for (const group of groups) for (const [x, y] of group.points) {
    const i = y * s.cfg.tileW + x;
    s.cells[CH.B * n + i] = 100;
    s.cells[CH.E * n + i] = 5;
    const words = group.genomeVariant ?
      encodeGenome(generalistGenome(s.cfg.defaultMu, s.cfg.defaultSigma), 0, 4) : base;
    for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = words[g];
  }
  return s;
}

describe("state-fed serial-transfer capture", () => {
  it("seeds both observer cadences at zero, selects a direct child immediately, and keeps exact age memberships", () => {
    const capture = new SerialGardenCapture(identity);
    capture.observe(state(0, [{ points: line(1, 9) }]));
    expect(capture.result().root).toMatchObject({ status: "one-eligible", eligibleAtStep0: 1,
      id25: 1, id100: 1 });
    for (let step = 25; step <= 3000; step += 25)
      capture.observe(state(step, [{ points: line(1, 6) }, { points: line(8, 10) }]));
    const result = capture.result();
    expect(result.complete).toBe(true);
    expect([result.censuses25.length, result.censuses100.length]).toEqual([121, 31]);
    expect(result.selection).toMatchObject({ status: "packet-valid", step: 25, childId: 2 });
    expect(result.selectionVisibility100).toMatchObject({ step: 100, status: "direct-root-fission",
      fineChildId: 2, fineComponentIndex: 1 });
    expect(capture.selectedPacket()?.cells.map((cell) => cell.sourceIndex)).toEqual([56, 57, 58]);
    expect(result.candidates[0]).toMatchObject({ topologyEligible: true,
      disposition: "selected-packet-valid" });
    expect(result.morphology.find((m) => m.subject === "selected-source-child" &&
      m.targetAgeSinceTransferOrSelection === 100)).toMatchObject({ status: "observed",
      targetStep: 125, timeSincePlacement: 125, observerIdentityAge: 100,
      importedFragmentAgeSinceObservedFission: null, biologicalAge: null,
      memberRanges: [[56, 3]] });
    expect(result.morphology.find((m) => m.subject === "imported-root" &&
      m.targetAgeSinceTransferOrSelection === 100)).toMatchObject({ status: "observed",
      targetStep: 100, observerIdentityAge: null });
    expect(result.selectedChildSourceFate).toEqual({ status: "alive-at-horizon", step: 3000 });
    expect(result.events100.some((e) => e.kind === "fission")).toBe(true);
  });

  it("freezes the first topology child before checking packet purity and never replaces it", () => {
    const capture = new SerialGardenCapture(identity);
    capture.observe(state(0, [{ points: line(1, 9) }]));
    capture.observe(state(25, [{ points: line(1, 6) },
      { points: line(8, 9) }, { points: [[10, 3]], genomeVariant: true }]));
    expect(capture.result().selection).toMatchObject({ status: "packet-invalid", step: 25 });
    expect(capture.result().selection.packetError).toMatch(/mixed lineage\/genome/);
    capture.observe(state(50, [{ points: line(1, 3) }, { points: line(5, 7) },
      { points: line(9, 10) }, { points: [[11, 3]], genomeVariant: true }]));
    const result = capture.result();
    expect(result.selection).toMatchObject({ status: "packet-invalid", step: 25 });
    expect(result.selectionVisibility100).toEqual({ status: "unavailable",
      reason: "shared-census-not-yet-observed" });
    expect(capture.selectedPacket()).toBeNull();
    expect(result.candidates.find((c) => c.step === 50 && c.parentId === 1)).toMatchObject({
      topologyEligible: true, disposition: "eligible-after-selection" });
    expect(result.selectedChildSourceFate).toMatchObject({ status: "right-censored", step: 50 });
  });

  it("retains unavailable roots and source-copy death without treating local IDs as births", () => {
    const empty = new SerialGardenCapture(identity);
    empty.observe(state(0, []));
    expect(empty.result().root).toMatchObject({ status: "unavailable", eligibleAtStep0: 0 });
    expect(empty.result().selection.status).toBe("none");
    expect(empty.result().selectionVisibility100).toEqual({ status: "unavailable", reason: "no-selection" });
    const capture = new SerialGardenCapture(identity);
    capture.observe(state(0, [{ points: line(1, 9) }]));
    capture.observe(state(25, [{ points: line(1, 6) }, { points: line(8, 10) }]));
    capture.observe(state(50, [{ points: line(1, 6) }]));
    expect(capture.result().selection.status).toBe("packet-valid");
    expect(capture.result().selectedChildSourceFate).toEqual({ status: "death", step: 50 });
    expect(capture.selectedPacket()).not.toBeNull();
    expect(capture.result().morphology.find((m) => m.subject === "selected-source-child" &&
      m.targetAgeSinceTransferOrSelection === 100)).toMatchObject({ status: "death", targetStep: 125 });
    expect(() => capture.observe(state(100, []))).toThrow(/expected step 75/);
    capture.observe(state(75, [{ points: line(1, 6) }]));
    capture.observe(state(100, [{ points: line(1, 6) }]));
    expect(capture.result().selectionVisibility100).toMatchObject({ status: "absent", step: 100,
      coarseChildId: null });
  });

  it("uses a stable same-census hash tie-break and disqualifies a dead root", () => {
    const tied = () => {
      const capture = new SerialGardenCapture(identity);
      capture.observe(state(0, [{ points: line(1, 12) }]));
      capture.observe(state(25, [{ points: line(1, 3) }, { points: line(5, 7) },
        { points: line(9, 11) }]));
      return capture.result();
    };
    const first = tied(), second = tied();
    expect(first.candidates.filter((c) => c.topologyEligible)).toHaveLength(2);
    expect(first.candidates.map((c) => c.disposition).sort()).toEqual([
      "eligible-not-selected", "selected-packet-valid"]);
    expect(first.selection).toEqual(second.selection);
    const dead = new SerialGardenCapture(identity);
    dead.observe(state(0, [{ points: line(1, 9) }]));
    dead.observe(state(25, []));
    dead.observe(state(50, [{ points: line(1, 9) }]));
    dead.observe(state(75, [{ points: line(1, 6) }, { points: line(8, 10) }]));
    expect(dead.result().root).toMatchObject({ disqualifiedAt: 25,
      disqualificationReason: "death" });
    expect(dead.result().selection.status).toBe("none");
    expect(dead.result().candidates[0].rejectionReasons).toContain("not-direct-imported-root-child");
  });

  it("retains a morphology frame but flags prior same-site mixing even without Tracker fusion", () => {
    const capture = new SerialGardenCapture(identity);
    capture.observe(state(0, [{ points: line(1, 9) }]));
    capture.observe(state(25, [{ points: line(1, 6) }, { points: line(8, 10) }]));
    for (const step of [50, 75, 100, 125])
      capture.observe(state(step, [{ points: line(1, 8) }, { points: line(10, 12) }]));
    const result = capture.result();
    expect(result.overlapMixing25.some((m) => m.step === 50 && m.priorIds.length === 2)).toBe(true);
    expect(result.events25.filter((e) => e.kind === "fusion")).toEqual([]);
    expect(result.root).toMatchObject({ disqualifiedAt: 50,
      disqualificationReason: "overlap-mixed" });
    expect(result.morphology.find((m) => m.subject === "imported-root" &&
      m.targetAgeSinceTransferOrSelection === 100)).toMatchObject({ status: "overlap-mixed",
      targetStep: 100, frame: { step: 100 } });
    expect(result.selection.status).toBe("packet-valid");
  });

  it("requires explicit source-observer evidence for transferred packets", () => {
    expect(() => new SerialGardenCapture({ ...identity, arm: "founder",
      importedFragment: { kind: "standard-founder-disc", founderIndex: 9 } })).not.toThrow();
    expect(() => new SerialGardenCapture({ ...identity, cycle: 1, seed: 640010002,
      importedFragment: { kind: "evolved-source-unknown-age" } })).toThrow(/identity/);
    const transferred = new SerialGardenCapture({ ...identity, cycle: 1, seed: 640010002,
      importedFragment: { kind: "selected-observer-child", sourceGardenId: "garden-0",
        sourceCycle: 0, sourceStep: 25, parentTrackerId: 1, childTrackerId: 2,
        packetSha256: "a".repeat(64), ageSinceObservedFissionAtPlacement: 0 } });
    transferred.observe(state(0, [{ points: line(1, 9) }]));
    expect(transferred.result().morphology[0]).toMatchObject({ timeSincePlacement: 0,
      importedFragmentAgeSinceObservedFission: 0, biologicalAge: null });
  });
});
