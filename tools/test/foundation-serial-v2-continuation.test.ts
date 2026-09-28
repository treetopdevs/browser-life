import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseContinuationArgs, validateV2Prior } from
  "../foundation-serial-v2-continuation.ts";
import { selectFirstCopyLinkedTransition } from "../lib/foundation-serial-v2-selection.ts";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const digest = (value: Uint8Array) => ({ sha256: createHash("sha256").update(value).digest("hex"),
  bytes: value.length });
const arms = ["donor", "founder-genotype", "zero-controller-genotype", "empty"];
function proof() {
  const frames = Array.from({ length: 40 }, (_, i) => ({ step: (i + 1) * 25,
    currentStateHash: "1".repeat(64), copyMapSha256: "2".repeat(64),
    separationEvidenceSha256: "3".repeat(64), initialSourceCellCount: 16,
    components: [] }));
  const frameDigests = frames.map((frame) => ({ step: frame.step,
    stateHashSha256: frame.currentStateHash, copyMapSha256: frame.copyMapSha256,
    separationEvidenceSha256: frame.separationEvidenceSha256,
    framePayloadSha256: createHash("sha256").update(JSON.stringify(frame)).digest("hex"),
    components: frame.components.length }));
  const codeFiles = { "tools/foundation-serial-v2-continuation.ts": { sha256: "a".repeat(64), bytes: 1 } };
  const plan = { format: "foundation-serial-v2-plan/v1", status: "planned", stage: 0,
    seeds: [640020101, 640020102, 640020103], codeFiles,
    arms: arms.map((arm) => ({ arm, seed: 640020101, initialStateHash: `start-${arm}`,
      initialInventory: { matter: "100" } })) };
  const planBytes = bytes(plan);
  const result = { format: "foundation-serial-v2-result/v1", status: "complete",
    postExecutionRevalidated: true, overrun: false, planFile: digest(planBytes), codeFilesAfter: codeFiles,
    rows: arms.map((arm) => ({ arm, status: "complete", outcome: {
      status: "complete", arm, stage: 0, seed: 640020101,
      initialStateHash: `start-${arm}`, initialInventory: { matter: "100" },
      conservationOk: true, mutations: 0, reference: { matchedMeasured: true },
      observer: { status: "complete", observationFiles: { series: { sha256: "b".repeat(64) } } },
      sham: arm === "empty" ? null : { observationHashesMatched: true },
      colorParity: arm === "empty" ? null : { throughStep: 1000 },
      selection: arm === "empty" ? null : selectFirstCopyLinkedTransition({
        sourceKey: "m4/gradient-m3/treatment/seed-1",
        arm: arm as "donor" | "founder-genotype" | "zero-controller-genotype",
        stage: 0, seed: 640020101 }, frames),
      frameDigests: arm === "empty" ? [] : frameDigests,
      frameCertificates: arm === "empty" ? [] : frames,
      selectedPacket: null, selectedPacketError: null,
    } })) };
  return { planBytes, result };
}

describe("A2 conditional continuation provenance", () => {
  it("accepts only complete post-revalidated prior stage evidence", () => {
    const { planBytes, result } = proof();
    expect(validateV2Prior(planBytes, bytes(result), 0).planFile.sha256).toBe(digest(planBytes).sha256);
    for (const altered of [
      { ...result, postExecutionRevalidated: false },
      { ...result, status: "incomplete-time-cap" },
      { ...result, planFile: { ...result.planFile, sha256: "0".repeat(64) } },
      { ...result, codeFilesAfter: {} },
      { ...result, rows: result.rows.map((row, i) => i === 0 ?
        { ...row, outcome: { ...row.outcome, initialStateHash: "forged" } } : row) },
      { ...result, rows: result.rows.map((row, i) => i === 0 ?
        { ...row, outcome: { ...row.outcome,
          selection: { status: "selected", selected: { step: 25, componentIndex: 0 } },
          selectedPacket: null, selectedPacketError: null } } : row) },
      { ...result, rows: result.rows.map((row, i) => i === 0 ?
        { ...row, outcome: { ...row.outcome,
          selection: { status: "selected", selected: { step: 25, componentIndex: 0 } },
          selectedPacket: { sha256: "a".repeat(64), cells: [] }, selectedPacketError: null } } : row) },
    ]) expect(() => validateV2Prior(planBytes, bytes(altered), 0)).toThrow();
  });

  it("requires exactly one or two ordered prior directories and bounded execution", () => {
    expect(parseContinuationArgs(["--stage", "1", "--prior-dirs", "s0",
      "--out", "s1", "--max-seconds", "600"]).stage).toBe(1);
    expect(() => parseContinuationArgs(["--stage", "2", "--prior-dirs", "s0",
      "--out", "s2", "--max-seconds", "600"])).toThrow(/ordered priors/);
    expect(() => parseContinuationArgs(["--stage", "1", "--prior-dirs", "s0",
      "--out", "s1", "--max-seconds", "601"])).toThrow(/<=600/);
  });

  it("rejects an earlier eligible packet reclassified as rejected in saved evidence", () => {
    const { planBytes, result } = proof();
    const forged: any = JSON.parse(JSON.stringify(result));
    const frames = Array.from({ length: 40 }, (_, i) => ({ step: (i + 1) * 25,
      currentStateHash: "1".repeat(64), copyMapSha256: "2".repeat(64),
      separationEvidenceSha256: "3".repeat(64), initialSourceCellCount: 16,
      components: i < 2 ? [{ componentIndex: 0, cells: 1, mass: 256,
        initialCopySourceByCell: [1], continuousCopyCoverage: "complete",
        physicalSeparation: "confirmed", immediateParentSplit: "not-observed",
        singleGenotype: true, memberSha256: "4".repeat(64) }] : [] }));
    const identity = { sourceKey: "m4/gradient-m3/treatment/seed-1",
      arm: "donor" as const, stage: 0 as const, seed: 640020101 };
    const correct = selectFirstCopyLinkedTransition(identity, frames);
    forged.rows[0].outcome.selection = correct;
    forged.rows[0].outcome.frameCertificates = frames;
    forged.rows[0].outcome.frameDigests = frames.map((frame) => ({ step: frame.step,
      stateHashSha256: frame.currentStateHash, copyMapSha256: frame.copyMapSha256,
      separationEvidenceSha256: frame.separationEvidenceSha256,
      framePayloadSha256: createHash("sha256").update(JSON.stringify(frame)).digest("hex"),
      components: frame.components.length }));
    forged.rows[0].outcome.selectedPacketError = "selected extraction unavailable";
    expect(() => validateV2Prior(planBytes, bytes(forged), 0)).not.toThrow();
    forged.rows[0].outcome.selection = JSON.parse(JSON.stringify(correct));
    const candidates = forged.rows[0].outcome.selection.candidates;
    candidates[0].rejectionReasons = ["physical-separation-ambiguous"];
    candidates[0].disposition = "rejected";
    candidates[1].disposition = "selected";
    forged.rows[0].outcome.selection.selected = candidates[1];
    expect(() => validateV2Prior(planBytes, bytes(forged), 0)).toThrow(/rejection reasons/);
  });
});
