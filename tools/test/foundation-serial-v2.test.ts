import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CH, G, GENOME_CHANNELS, allocState, cellCount, encodeGenome,
  generalistGenome } from "@bl/schema";
import { specConfig } from "@bl/runner";
import type { SourceIdentity } from "../lib/foundation-replay.ts";
import { extractCellPacket } from "../lib/foundation-transplant.ts";
import { packetBoundAccounting, planV2Stage, prepareV2Start,
  validateA1Gate } from "../lib/foundation-serial-v2.ts";
import { parseV2Args, validateV2Seeds } from "../foundation-serial-transfer-v2.ts";
import { V2ObserverSink } from "../lib/foundation-serial-v2-observe.ts";
import { competingGpuPids } from "../lib/foundation-serial-v2-gpu-guard.ts";

const bytes = (x: unknown) => new TextEncoder().encode(JSON.stringify(x));
const sha = (x: Uint8Array) => createHash("sha256").update(x).digest("hex");
const h = "a".repeat(64);
function proof() {
  const plan = bytes({ format: 1, status: "planned", diagnosticSteps: [175, 200, 225],
    horizon: 250, physicsHorizon: 3000, claim: "selected-debugging-replay-only",
    inputs: { source: "source", cache: "cache", catalog: "catalog", rule: "rule",
      priorSerial: "prior" }, priorSerialFile: { sha256: h },
    priorSerialPlanFile: { sha256: h },
    preflight: { status: "pass", sourceRunId: "m4/gradient-m3/treatment/seed-1",
      selectedComponent: { packetSha256: h } },
    oldDonor: { sourcePacketSha256: h, initialStateHash: "start",
      measuredPhysicsHash: "physics", measuredArtifactHash: "artifact" } });
  const result = { format: 1, status: "verified", planFile: { sha256: sha(plan), bytes: plan.length },
    overrun: false, adapter: { vendor: "test adapter" }, parityThroughStep: 250,
    fullParitySteps: [25, 50, 75, 100, 125, 150, 175, 200, 225, 250],
    serialTraceMatched: true, terminalPhysicsMatched: true,
    originalArtifactMatched: true, observationHashesMatched: true };
  return { plan, result };
}

describe("A2 preparation gate", () => {
  it("requires complete A1 authenticated natural replay, not a passing CPU preflight alone", () => {
    const { plan, result } = proof();
    expect(validateA1Gate(plan, bytes(result))).toMatchObject({ sourcePacketSha256: h,
      validatedThroughStep: 250, copiedGenomeSourceInterpretation: "initial-inoculum-copy-origin-only" });
    for (const altered of [
      { ...result, status: "incomplete-time-cap" },
      { ...result, parityThroughStep: 225 },
      { ...result, observationHashesMatched: false },
      { ...result, overrun: true },
      { ...result, planFile: { sha256: h, bytes: plan.length } },
    ]) expect(() => validateA1Gate(plan, bytes(altered))).toThrow(/authenticated A1/);
  });

  it("preplans exactly four, two, two arms and retains missing branches", () => {
    const zero = planV2Stage(0, h);
    expect(zero.rows.map((r) => r.arm)).toEqual([
      "donor", "founder-genotype", "zero-controller-genotype", "empty",
    ]);
    expect(new Set(zero.rows.map((r) => r.seed)).size).toBe(1);
    const one = planV2Stage(1, h, { donor: { status: "complete", selectedPacketSha256: h },
      "founder-genotype": { status: "complete", selectedPacketSha256: null } });
    expect(one.rows.map((r) => r.status)).toEqual(["planned", "unavailable"]);
    const two = planV2Stage(2, h, { donor: { status: "failed", selectedPacketSha256: h },
      "founder-genotype": { status: "unavailable", selectedPacketSha256: null } });
    expect(two.rows.map((r) => r.status)).toEqual(["unavailable", "unavailable"]);
    expect(() => planV2Stage(1, h)).toThrow(/invalid A2/);
  });

  it("prepares three same-geometry genotype interventions and an empty matched garden", () => {
    const source = { runId: "m4/gradient-m3/treatment/seed-1", spec: {
      experiment: "m4", presetId: "gradient-m3", condition: "treatment", seed: 1,
      steps: 1_000_000, censusEvery: 100, deepEvery: 500, checkpointEvery: 0,
    } } as SourceIdentity;
    const state = allocState(specConfig(source.spec));
    const n = cellCount(state.cfg), sites = [128 * 256 + 128, 128 * 256 + 129,
      129 * 256 + 128, 129 * 256 + 129];
    const words = encodeGenome(generalistGenome(state.cfg.defaultMu, state.cfg.defaultSigma), 0, 1);
    for (const i of sites) {
      state.cells[CH.B * n + i] = 75;
      state.cells[CH.A * n + i] = 32;
      for (let g = 0; g < GENOME_CHANNELS; g++) state.genome[g * n + i] = words[g];
    }
    const packet = extractCellPacket(state, sites);
    const starts = (["donor", "founder-genotype", "zero-controller-genotype", "empty"] as const)
      .map((arm) => prepareV2Start(source, 0, arm, arm === "empty" ? null : packet));
    expect(starts.map((x) => x.eligibleRootsAtStep0)).toEqual([1, 1, 1, 0]);
    expect(starts[0].state.cells).toEqual(starts[1].state.cells);
    expect(starts[1].state.cells).toEqual(starts[2].state.cells);
    expect(Array.from({ length: GENOME_CHANNELS - 2 }, (_, i) => i + 2).some((g) =>
      starts[0].state.genome[g * n + sites[0]] !== starts[1].state.genome[g * n + sites[0]])).toBe(true);
    expect(starts[2].state.genome[G.W0 * n + sites[0]]).toBe(0);
    expect(new Set(starts.map((x) => x.seed))).toEqual(new Set([640020101]));
  });

  it("requires an explicit bounded, create-new A2 plan before any execution", () => {
    const args = parseV2Args(["--a1-dir", "a1", "--seed-audit", "audit.json",
      "--seed-ledger", "ledger.json", "--out", "new-output", "--max-seconds", "600"]);
    expect(args.execute).toBe(false);
    expect(args.maxSeconds).toBe(600);
    expect(() => parseV2Args(["--a1-dir", "a1", "--seed-audit", "audit.json",
      "--seed-ledger", "ledger.json", "--out", "new-output", "--max-seconds", "601"]))
      .toThrow(/<=600/);
    expect(() => parseV2Args(["--execute", "--out", "existing", "--max-seconds", "600"]))
      .toThrow(/frozen plan/);
  });

  it("requires exact seed suballocation and rejects another use of a stage seed", () => {
    const audit = { status: "cleared", collisions: [], additionalReservations: [
      { purpose: "ancestry/serial", first: 640020001, last: 640029999 }] };
    const ledger = { records: [
      { purpose: "ancestry diagnostic and serial v2", range: { first: 640020001, last: 640029999 } },
      { purpose: "A2 serial exact-stage seed suballocation", status: "reserved",
        seeds: [640020101, 640020102, 640020103] },
    ] };
    expect(() => validateV2Seeds(audit, ledger)).not.toThrow();
    expect(() => validateV2Seeds(audit, { records: ledger.records.slice(0, 1) }))
      .toThrow(/exact seeds/);
    expect(() => validateV2Seeds(audit, { records: [...ledger.records,
      { purpose: "another run", seed: 640020102 }] })).toThrow(/already assigned/);
  });

  it("retains original series but rejects missing or unsafe census rows", async () => {
    const sink = new V2ObserverSink(() => {});
    await sink.appendText("series.jsonl", JSON.stringify({ step: 25, conservationOk: true,
      mutations: 0, pools: { B: 123, P: 4 } }) + "\n");
    expect(sink.result().series).toHaveLength(1);
    await expect(sink.appendText("series.jsonl", JSON.stringify({ step: 75,
      conservationOk: true, mutations: 0 }) + "\n")).rejects.toThrow(/cadence/);
    expect(() => sink.result(true)).toThrow(/incomplete/);
  });

  it("reports packet-specific bound incorporation conservatively, including uninformative zero", () => {
    const inventory = (matter: string, B: string, P: string) => ({
      A: "0", B, C: "0", P, E: "0", S: "0", matter, energy: "0" });
    const incoming = inventory("100", "20", "0");
    expect(packetBoundAccounting(incoming, inventory("150", "70", "40")))
      .toEqual({ lowerBound: "10", status: "positive-lower-bound" });
    expect(packetBoundAccounting(incoming, inventory("150", "20", "40")))
      .toEqual({ lowerBound: "0", status: "zero-lower-bound" });
    expect(packetBoundAccounting(incoming, null))
      .toEqual({ lowerBound: null, status: "unavailable-no-packet" });
  });

  it("detects live competing assay processes without mistaking dormant watcher shells for GPU workers", () => {
    const listing = [
      " 10 deno deno run -A tools/foundation-role-cohort.ts --execute",
      " 11 zsh zsh -c 'sleep 60; deno run -A tools/foundations.ts t4'",
      " 12 deno deno run -A tools/m4-growth-calibration.ts --manifest cpu.json",
      " 13 deno deno run -A tools/foundation-serial-transfer-v2.ts --execute --out here",
      " 14 deno deno run -A tools/foundations.ts t4 --dir original",
      " 15 deno deno check tools/foundation-serial-transfer-v2.ts",
      " 16 deno deno run -A tools/foundation-serial-transfer-v2.ts --out plan-only",
      " 17 deno deno run -A tools/foundation-serial-v2-continuation.ts --out plan-only",
      " 18 deno deno run -A tools/foundation-replay.ts verify --out cache",
    ].join("\n");
    expect(competingGpuPids(listing, 13)).toEqual([10, 14]);
  });
});
