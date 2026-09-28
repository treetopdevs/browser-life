import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { CH, G, GENOME_CHANNELS, FLUX_NAMES, cellCount, cloneState, stateHash, totalsOf } from "@bl/schema";
import { parseSerialArgs, validateSerialPriors, validateSerialSeriesRows,
  type SerialManifest } from "../foundation-serial-transfer.ts";
import { SERIAL_SEEDS, boundIncorporationAccounting, prepareSerialStart, serialSpec,
  stageArms } from "../lib/foundation-serial-transfer.ts";
import { extractCellPacket, restoreCellPacket, exciseCellPacket,
  type CellPacket } from "../lib/foundation-transplant.ts";
import { sha256, type SourceIdentity } from "../lib/foundation-replay.ts";
import { SERIAL_SELECTION_SALT } from "../lib/foundation-serial-capture.ts";

const source = { runId: "m4/gradient-m3/treatment/seed-1", spec: {
  experiment: "m4", presetId: "gradient-m3", condition: "treatment", seed: 1,
  steps: 1_000_000, censusEvery: 100, deepEvery: 10, checkpointEvery: 0,
} } as SourceIdentity;

const inputs = ["--source", "/source", "--cache", "/cache", "--catalog", "/catalog.json",
  "--rule", "/rule.json", "--out", "/new-output", "--stage", "0"];

function priorFixture(): { prior: SerialManifest; plan: SerialManifest;
  planDigest: ReturnType<typeof sha256>; current: SerialManifest } {
  const digest = { sha256: "a".repeat(64), bytes: 1 };
  const inventory = { A: "0", B: "0", C: "0", P: "0", E: "0", S: "0", matter: "0", energy: "0" };
  const series = Array.from({ length: 120 }, (_, i) => ({ step: (i + 1) * 25,
    conservationOk: true, mutations: 0, pools: { A: 0, B: 0, C: 0, P: 0, E: 0, S: 0 },
    rates: Object.fromEntries(FLUX_NAMES.map((name) => [name, 0])) }));
  const current = { format: 1, stage: 1, status: "planned", codeFilesBefore: { a: digest }, planFile: digest,
    sourceFiles: { a: digest }, cacheManifestFile: digest, catalogFile: digest, ruleFile: digest,
    protocolFile: digest, sourceFinalArtifactHash: "a", donorSelection: { packetSha256: "b" },
    sourceCheckpoint: { step: 900000, file: "x", sha256: "c" }, priorStageFiles: [{ digest }],
    rows: stageArms(1).map((arm) => ({ arm, cycle: 1, seed: SERIAL_SEEDS[1],
      gardenId: `m4/gradient-m3/treatment/seed-1/serial/${arm}/cycle-1/seed-${SERIAL_SEEDS[1]}`,
      status: "not-run-unavailable", unavailableReason: "no selected packet", sourcePacket: null,
      importedFragment: null })),
  } as unknown as SerialManifest;
  const prior = { ...structuredClone(current), stage: 0, status: "complete", postExecutionRevalidated: true,
    codeFilesAfter: { a: digest }, priorStageFiles: [],
    runtime: { endedAt: "2026-01-01", overrun: false, adapter: { vendor: "test" } },
    execution: { requested: true, seeds: SERIAL_SEEDS, horizon: 3000, censusEvery: 25,
      coarseEvery: 100, gardenCount: 3 },
    rows: stageArms(0).map((arm) => ({ arm, cycle: 0, seed: SERIAL_SEEDS[0], status: "complete",
      gardenId: `m4/gradient-m3/treatment/seed-1/serial/${arm}/cycle-0/seed-${SERIAL_SEEDS[0]}`,
      importedFragment: arm === "donor" ? { kind: "evolved-source-unknown-age" } :
        { kind: "standard-founder-disc", founderIndex: 9 },
      sourcePacket: arm === "donor" ? { sha256: "b" } : null,
      pureRestoreMatched: true, initialStateHash: "h", inoculumSha256: "i",
      initialMatter: "0", initialEnergy: "0", initialInventory: inventory, inoculumInventory: inventory,
      outcome: { conservationOk: true, mutationCount: 0,
        capture: { complete: true, identity: { sourceKey: source.runId, arm, cycle: 0,
          seed: SERIAL_SEEDS[0], importedFragment: arm === "donor" ?
            { kind: "evolved-source-unknown-age" } : { kind: "standard-founder-disc", founderIndex: 9 } },
          selection: { status: "none" }, candidates: [] }, selectedPacket: null,
        measuredPhysicsHash: "p", finalInventory: inventory,
        incorporatedBoundMatterLowerBound: "0", series,
        reference: { step: 3000, stateHash: "p", matchedMeasured: true,
          drainedMutationEvents: 0, droppedMutationEvents: 0 },
        sham: { observationHashesMatched: true, conservationOk: true, controlPhysicsHash: "s",
          restoredPhysicsHash: "s", controlArtifactHash: "t", restoredArtifactHash: "t" } } })),
  } as unknown as SerialManifest;
  const plan = structuredClone(prior);
  plan.status = "planned"; plan.postExecutionRevalidated = false;
  delete plan.planFile;
  for (const row of plan.rows) { row.status = "planned"; delete row.outcome; }
  const planDigest = sha256(new TextEncoder().encode(JSON.stringify(plan, null, 2) + "\n"));
  prior.planFile = planDigest;
  current.priorStageFiles[0].planDigest = planDigest;
  return { prior, plan, planDigest, current };
}

describe("serial-transfer bounded execution gates", () => {
  it("defaults to CPU planning and requires an explicit valid execution cap and ordered prior paths", () => {
    expect(parseSerialArgs(inputs)).toMatchObject({ execute: false, maxSeconds: null, stage: 0, priors: [] });
    expect(() => parseSerialArgs([...inputs, "--execute"])).toThrow(/requires --max-seconds/);
    expect(() => parseSerialArgs([...inputs, "--execute", "--max-seconds", "601"])).toThrow(/<=600/);
    expect(() => parseSerialArgs([...inputs, "--max-seconds", "NaN"])).toThrow(/finite/);
    expect(() => parseSerialArgs([...inputs.slice(0, -1), "1"])).toThrow(/ordered prior manifests/);
    expect(parseSerialArgs([...inputs, "--execute", "--max-seconds", "600"])).toMatchObject({
      execute: true, maxSeconds: 600 });
  });

  it("makes paired founder and zero-controller worlds with identical physical inventory and exact restoration", () => {
    const founder = prepareSerialStart(source, 0, "founder", null);
    const zero = prepareSerialStart(source, 0, "zero-controller", null);
    expect(serialSpec(source, 0)).toMatchObject({ seed: SERIAL_SEEDS[0], censusEvery: 25,
      checkpointEvery: 25, overrides: { mutRate: 0, lightMode: "uniform" } });
    expect([...founder.state.cells]).toEqual([...zero.state.cells]);
    expect(totalsOf(founder.state.cfg, founder.state.cells)).toEqual(
      totalsOf(zero.state.cfg, zero.state.cells));
    const n = cellCount(founder.state.cfg);
    for (let g = 0; g < G.W0; g++)
      expect([...founder.state.genome.subarray(g * n, (g + 1) * n)]).toEqual(
        [...zero.state.genome.subarray(g * n, (g + 1) * n)]);
    for (let g = G.W0; g < GENOME_CHANNELS; g++)
      expect(zero.state.genome.subarray(g * n, (g + 1) * n).every((v) => v === 0)).toBe(true);
    expect(stateHash(founder.state)).not.toBe(stateHash(zero.state));
    expect(founder.state.cells[CH.B * n + 128 * 256 + 128]).toBeGreaterThan(0);
    const restored = restoreCellPacket(exciseCellPacket(founder.state, founder.inoculum), founder.inoculum);
    expect(stateHash(restored)).toBe(founder.initialStateHash);
    const child = extractCellPacket(founder.state, founder.inoculum.cells.map((c) => c.sourceIndex));
    const transfer = prepareSerialStart(source, 1, "founder", child);
    expect(transfer.transplantAudit?.ledgerUnchanged).toBe(true);
    expect(transfer.inoculum.sha256).not.toBe(child.sha256);
    expect(transfer.state.step).toBe(0);
  });

  it("retains all census rows and bounds ambient matter incorporated into final bound mass", () => {
    const start = prepareSerialStart(source, 0, "founder", null);
    const final = cloneState(start.state), n = cellCount(final.cfg);
    final.step = 3000;
    expect(boundIncorporationAccounting(start.state, final, start.inoculum)
      .incorporatedBoundMatterLowerBound).toBe("0");
    const needed = Number(BigInt(start.inoculum.inventory.matter) -
      BigInt(start.inoculum.inventory.B) - BigInt(start.inoculum.inventory.P) + 1n);
    let moved = 0;
    for (let i = 0; i < n && moved < needed; i++) {
      if (final.cells[CH.B * n + i] + final.cells[CH.P * n + i] > 0) continue;
      const move = Math.min(final.cells[CH.A * n + i], needed - moved);
      final.cells[CH.A * n + i] -= move; final.cells[CH.B * n + i] += move; moved += move;
    }
    expect(moved).toBe(needed);
    expect(boundIncorporationAccounting(start.state, final, start.inoculum)
      .incorporatedBoundMatterLowerBound).toBe("1");
    const contaminated = cloneState(start.state);
    contaminated.cells[CH.A * n]--; contaminated.cells[CH.B * n]++;
    expect(() => boundIncorporationAccounting(contaminated, final, start.inoculum))
      .toThrow(/outside the inoculum/);
    const rows = Array.from({ length: 120 }, (_, i) => ({ step: (i + 1) * 25,
      conservationOk: true, mutations: 0, pools: { A: 0, B: 0, C: 0, P: 0, E: 0, S: 0 },
      rates: Object.fromEntries(FLUX_NAMES.map((name) => [name, 0])) }));
    expect(() => validateSerialSeriesRows(rows)).not.toThrow();
    rows[61].step = 1600;
    expect(() => validateSerialSeriesRows(rows)).toThrow(/row 62/);
  });

  it("refuses failed, unverified, or forged prior stages before any transfer", () => {
    const { prior, plan, planDigest, current } = priorFixture();
    const validate = (p: SerialManifest) => validateSerialPriors(current, [p], [{ manifest: plan, digest: planDigest }]);
    expect(() => validate(prior)).not.toThrow();
    for (const mutate of [
      (p: SerialManifest) => { p.status = "failed"; },
      (p: SerialManifest) => { p.postExecutionRevalidated = false; },
      (p: SerialManifest) => { p.runtime!.overrun = true; },
      (p: SerialManifest) => { p.rows[0].outcome!.capture.identity.seed++; },
      (p: SerialManifest) => { p.rows[0].outcome!.reference.matchedMeasured = false; },
      (p: SerialManifest) => { p.rows[0].outcome!.reference.stateHash = "forged"; },
      (p: SerialManifest) => { p.rows[0].outcome!.sham.restoredArtifactHash = "forged"; },
      (p: SerialManifest) => { p.rows[0].sourcePacket = null; },
      (p: SerialManifest) => { p.rows[0].initialStateHash = "other-start"; },
      (p: SerialManifest) => { p.rows[0].importedFragment = { kind: "standard-founder-disc", founderIndex: 9 }; },
      (p: SerialManifest) => { p.donorSelection.packetSha256 = "changed"; },
      (p: SerialManifest) => { p.rows[0].status = "incomplete-time-cap"; },
      (p: SerialManifest) => { (p.rows[0].outcome!.series.at(-1)!.pools as Record<string, number>).A = 1; },
    ]) {
      const altered = structuredClone(prior); mutate(altered);
      expect(() => validate(altered)).toThrow();
    }
  });

  it("requires selected packet and observer-child identity to link the next garden", () => {
    const { prior, plan, planDigest, current } = priorFixture();
    const packet = { sha256: "d".repeat(64), sourceStep: 25 } as CellPacket;
    const sourceRow = prior.rows[0];
    const key = createHash("sha256").update(`${SERIAL_SELECTION_SALT}\n${source.runId}\ndonor\n0\n` +
      `${SERIAL_SEEDS[0]}\n25\n2\n1`).digest("hex");
    sourceRow.outcome!.selectedPacket = packet;
    sourceRow.outcome!.capture.selection = { status: "packet-valid", step: 25, childId: 2,
      componentIndex: 1, selectionSha256: key, packetSha256: packet.sha256, packetError: null };
    sourceRow.outcome!.capture.root = { status: "one-eligible", id25: 1, id100: 1,
      eligibleAtStep0: 1, disqualifiedAt: null, disqualificationReason: null };
    sourceRow.outcome!.capture.rootSourceFate = { status: "right-censored", step: 3000 };
    sourceRow.outcome!.capture.selectedChildSourceFate = { status: "right-censored", step: 3000 };
    sourceRow.outcome!.capture.events25 = [{ kind: "fission", step: 25, parent: 1, children: [2] }];
    sourceRow.outcome!.capture.overlapMixing25 = [];
    sourceRow.outcome!.capture.candidates = [{ step: 25, parentId: 1, childId: 2,
      componentIndex: 1, mass: 300, topologyEligible: true, rejectionReasons: [],
      disposition: "selected-packet-valid", selectionSha256: key,
      packetSha256: packet.sha256, packetError: null }];
    current.rows[0].sourcePacket = packet;
    current.rows[0].status = "planned";
    current.rows[0].importedFragment = { kind: "selected-observer-child",
      sourceGardenId: sourceRow.gardenId, sourceCycle: 0, sourceStep: 25,
      parentTrackerId: 1, childTrackerId: 2, packetSha256: packet.sha256,
      ageSinceObservedFissionAtPlacement: 0 };
    const validate = () => validateSerialPriors(current, [prior], [{ manifest: plan, digest: planDigest }]);
    expect(validate).not.toThrow();
    current.rows[0].importedFragment.childTrackerId = 3;
    expect(validate).toThrow(/packet chain differs/);
    current.rows[0].importedFragment.childTrackerId = 2;
    sourceRow.outcome!.capture.rootSourceFate = { status: "fusion", step: 50 };
    sourceRow.outcome!.capture.root.disqualifiedAt = 50;
    sourceRow.outcome!.capture.root.disqualificationReason = "fusion";
    expect(validate).not.toThrow(); // later source-copy fate does not veto its selected transfer
    sourceRow.outcome!.capture.rootSourceFate = { status: "fusion", step: 25 };
    expect(validate).toThrow(/provenance missing/);
    sourceRow.outcome!.capture.rootSourceFate = { status: "right-censored", step: 3000 };
    sourceRow.outcome!.capture.root.disqualifiedAt = null;
    sourceRow.outcome!.capture.root.disqualificationReason = null;
    sourceRow.outcome!.capture.candidates[0].parentId = 3;
    expect(validate).toThrow(/provenance missing/);
    sourceRow.outcome!.capture.candidates[0].parentId = 1;
    sourceRow.outcome!.capture.events25 = [];
    expect(validate).toThrow(/provenance missing/);
    sourceRow.outcome!.capture.events25 = [{ kind: "fission", step: 25, parent: 1, children: [2] }];
    sourceRow.outcome!.capture.overlapMixing25 = [{ step: 25, componentIndex: 1,
      currentId: 1, priorIds: [1] }];
    expect(validate).toThrow(/provenance missing/);
    sourceRow.outcome!.capture.overlapMixing25 = [];
    sourceRow.outcome!.capture.events25.push({ kind: "fusion", step: 25, parents: [2, 3], child: 4 });
    expect(validate).toThrow(/provenance missing/); // forged candidate still claimed eligible
    sourceRow.outcome!.capture.events25.pop();
    sourceRow.outcome!.capture.overlapMixing25 = [{ step: 25, componentIndex: 1,
      currentId: 2, priorIds: [2] }];
    expect(validate).toThrow(/provenance missing/);
    sourceRow.outcome!.capture.overlapMixing25 = [];
    sourceRow.outcome!.capture.events25.push({ kind: "fusion", step: 50, parents: [2, 3], child: 4 });
    sourceRow.outcome!.capture.selectedChildSourceFate = { status: "fusion", step: 50 };
    expect(validate).not.toThrow(); // source-copy child may fuse after packet selection
    sourceRow.outcome!.capture.events25.pop();
    sourceRow.outcome!.capture.selectedChildSourceFate = { status: "right-censored", step: 3000 };
    sourceRow.outcome!.capture.candidates = [];
    expect(validate).toThrow(/provenance missing/);
  });
});
