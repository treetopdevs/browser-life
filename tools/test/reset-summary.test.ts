import { describe, expect, it } from "vitest";
import { admitResetAttempt, authenticateResetCompletion, describeResetRows } from "../reset-summarize.ts";
import type { ResetLinkEvidence, ResetSelectedLink } from "../lib/reset-probe-a-analysis.ts";

const original = (rowIndex: number): ResetSelectedLink => ({ rowIndex, h: 1,
  step: 200 + rowIndex * 100, kind: "budding", parent: 1, child: rowIndex + 2,
  parentLineage: "0:1", childLineage: "0:1", parentPurity: 1, childPurity: 1 });
function unavailable(row: ResetSelectedLink): ResetLinkEvidence {
  return { original: row, status: "unavailable-child-support", parentSupport: {
    status: "unavailable", referenceStep: row.step - 100,
    parentId: row.parent, reason: "absent-prior-census" },
    birthCopyShare: null, birthReferences: null, samples: [],
    interpretation: "observer-link-with-copy-attribution-not-biological-reproduction" } as ResetLinkEvidence;
}
function measured(row: ResetSelectedLink, parent: number, other: number, unknown: number): ResetLinkEvidence {
  const n = parent + other + unknown;
  return { ...unavailable(row), status: "available", birthCopyShare: {
    status: n ? "available" : "unavailable-no-genome-bearing-child-sites",
    genomeBearingSites: n, parentLinkedSites: parent, knownNonparentSites: other,
    unknownSites: unknown, parentBoundCarrierFractionInterval: n ? [parent / n, (parent + unknown) / n] : null,
    parentCellFractionInterval: n ? [parent / n, (parent + unknown) / n] : null,
  } } as ResetLinkEvidence;
}
function completedFixture() {
  const rows = Array.from({ length: 20 }, (_, i) => original(i));
  const steps = Array.from({ length: 10 }, (_, i) => (i + 1) * 100000);
  const design = { sample: { rows }, histories: [{ history: 1, rowIndices: rows.map(r => r.rowIndex),
    checkpointSteps: steps, continuousWindow: { candidateStepsFirst: 100001, candidateStepsLast: 101000 } }] };
  const expected = { planSha256: "a".repeat(64), designSha256: "b".repeat(64),
    checkpoints: steps.map(step => ({ h: 1, step, physicsHash: "physical-" + step, artifactHash: "artifact-" + step })) };
  const ledger = { sourceSha256: "c".repeat(64), replaySha256: "c".repeat(64), count: 0, dropped: 0 };
  const attempt: Parameters<typeof admitResetAttempt>[0] = { status: "complete", history: 1, attempt: 1,
    planSha256: expected.planSha256, designSha256: expected.designSha256, sourcePostvalidated: true,
    evidence: rows.map(unavailable), checkpointVerifications: expected.checkpoints.map(c => ({
      step: c.step, physicsHash: c.physicsHash, artifactDigest: c.artifactHash })),
    mutationLedger: { ...ledger }, lifeLedger: { ...ledger }, lineageLedger: { ...ledger }, windows: {
      frames: Array.from({ length: 1000 }, (_, i) => ({ step: 100001 + i,
        trackerIntervalCooccurrence: "neither", flags: [] })), persistence: [] } };
  return { attempt, design, expected };
}

describe("reset descriptive analysis admission and denominators", () => {
  it("keeps missing links and unknown copy paths out of a false zero average", () => {
    const rows = [original(0), original(1), original(2)];
    const summary = describeResetRows(rows, [measured(rows[0], 0, 4, 0), measured(rows[1], 1, 1, 2)]);
    expect(summary.originalRows).toBe(3);
    expect(summary.admittedRows).toBe(2);
    expect(summary.availability).toEqual({ available: 2, "not-admitted": 1 });
    expect(summary.conditionalMeanCellFractionBounds).toEqual([0.125, 0.375]);
    expect(summary.conditionalMeanBoundCarrierFractionBounds).toEqual([0.125, 0.375]);
    expect(summary.definedCarrierFractionRows).toBe(2);
    expect(summary.categories.zeroKnownAndNoUnknown).toBe(1);
    expect(summary.categories.unresolvedExactFraction).toBe(1);
  });
  it("does not give genome-free supports a zero copy fraction", () => {
    const row = original(0), result = describeResetRows([row], [measured(row, 0, 0, 0)]);
    expect(result.definedFractionRows).toBe(0);
    expect(result.conditionalMeanCellFractionBounds).toBeNull();
    expect(result.availability["unavailable-no-genome-bearing-child-sites"]).toBe(1);
  });
  it("admits a fully observed history even when its child supports are unavailable", () => {
    const { attempt, design, expected } = completedFixture();
    expect(() => admitResetAttempt(attempt, design, expected)).not.toThrow();
  });
  it.each(["postvalidation", "checkpoint", "mutation", "lineage", "original-row", "partial-window"])(
    "rejects a nominally complete history with invalid %s evidence", failure => {
      const { attempt, design, expected } = completedFixture();
      if (failure === "postvalidation") attempt.sourcePostvalidated = false;
      if (failure === "checkpoint") attempt.checkpointVerifications.pop();
      if (failure === "mutation") attempt.mutationLedger.dropped = 1;
      if (failure === "lineage") attempt.lineageLedger.replaySha256 = null;
      if (failure === "original-row") attempt.evidence[0].original = { ...attempt.evidence[0].original, parentPurity: 0.5 };
      if (failure === "partial-window") attempt.windows.frames.pop();
      expect(() => admitResetAttempt(attempt, design, expected)).toThrow();
    });
  it("rejects a raw flag whose promised one-hundred-step descriptor is missing", () => {
    const { attempt, design, expected } = completedFixture();
    attempt.windows.frames[0].flags.push({ step: 100001, priorComponent: 0,
      branches: [{ currentComponent: 0 }, { currentComponent: 1 }] });
    expect(() => admitResetAttempt(attempt, design, expected)).toThrow(/omits or duplicates/);
  });
});


describe("terminal result authentication", () => {
  it("rejects altered result bytes and another source freeze", () => {
    const { attempt, expected } = completedFixture();
    const binding = { ...expected, freezeSha256: "d".repeat(64) };
    const result = { sha256: "e".repeat(64), bytes: 1234 };
    const receipt = { status: "complete", history: 1, attempt: 1,
      ...binding, resultSha256: result.sha256, resultBytes: result.bytes };
    expect(() => authenticateResetCompletion(attempt, result, receipt, binding)).not.toThrow();
    expect(() => authenticateResetCompletion(attempt, { ...result, sha256: "f".repeat(64) }, receipt, binding)).toThrow();
    expect(() => authenticateResetCompletion(attempt, result, { ...receipt, freezeSha256: "0".repeat(64) }, binding)).toThrow();
  });
});
