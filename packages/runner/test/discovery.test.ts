import { beforeAll, describe, expect, it } from "vitest";
import {
  RESULT_FILES,
  canonicalJSON,
  decodeCheckpoint,
  encodeCheckpoint,
  generalistGenome,
  genomeHex,
  sha256Hex,
  RENEWAL_PIN,
  validateCaseSpec,
  validateManifest,
  validateProtocol,
  type CaseSpec,
  type DiscoveryProtocol,
  type ResultFile,
  type ResultManifest,
} from "@bl/schema";
import { engineeringReadout, type ObservationRecord } from "@bl/metrics";
import {
  decideCase,
  decodeObservations,
  encodeObservations,
  freezeCampaign,
  reduceCampaign,
  runCase,
  validateAttempt,
  type AttemptInfo,
  type CaseContext,
  type CaseFiles,
  type FrozenCampaign,
} from "@bl/runner";

const CLOSURE = "c".repeat(64);
const hex = genomeHex(generalistGenome(60, 20));
const founders = [{ x: 8, y: 8, radius: 4, genomeHex: hex, biomass: 128, energy: 256 }];
const small = { tileW: 16, tileH: 16, kernelRadius: 5, lightMode: "uniform" as const };

const protocol: DiscoveryProtocol = {
  schemaVersion: "discovery-v1",
  campaign: "unit",
  purpose: "engineering",
  question: "unit test campaign",
  seedNamespace: { name: "unit", first: 8500901, last: 8500999 },
  blocks: [
    { id: "b1", seed: 8500901 },
    { id: "b2", seed: 8500902 },
  ],
  fixtures: [
    {
      id: "passive",
      candidateId: "p",
      habitatId: "d",
      founderId: "none",
      assayId: "passive-transport",
      armId: "fixture",
      config: { ...small, spread: 2, dtQ: 0, motility: false, kBDecay: 0, kPDecay: 0, kELeak: 0 },
      initial: { kind: "deposits", nutrient: 8, deposits: [{ x: 4, y: 4, B: 37, P: 72, E: 1156 }] },
      steps: 10,
      censusEvery: 5,
      segmentAt: [],
      sites: [{ x: 4, y: 4 }],
    },
    {
      id: "react",
      candidateId: "r",
      habitatId: "h",
      founderId: "g",
      assayId: "census-checkpoint",
      armId: "fixture",
      config: small,
      initial: { kind: "founders", nutrient: 32, founders },
      steps: 40,
      censusEvery: 10,
      segmentAt: [15, 25],
      sites: [{ x: 8, y: 8 }],
    },
    {
      id: "dies",
      candidateId: "d",
      habitatId: "h",
      founderId: "g",
      assayId: "extinction",
      armId: "fixture",
      config: { ...small, lightBase: 0, lightAmp: 0, kBDecay: 20000, kPDecay: 20000, kMaint: 20000 },
      initial: { kind: "founders", nutrient: 32, founders },
      steps: 120,
      censusEvery: 20,
      segmentAt: [],
      sites: [],
    },
  ],
  observerVersion: "exact-ledger-v1",
  readoutVersion: "engineering-readout-v1",
  resourceLimits: { concurrentCasesPerHost: 2, caseWallSeconds: 60, campaignWallSeconds: 600, campaignBytes: 1e8, attemptsPerCasePerRole: 3 },
  verificationPolicy: { replay: "every-case-cross-host" },
  stoppingRule: "unit",
};

let frozen: FrozenCampaign;
const results = new Map<string, { result: ResultManifest; files: CaseFiles }>();

const opts = (role: "primary" | "replay", host: string, k = 1) => ({
  attemptId: `${host}.${role}.${k}`,
  role,
  leaseId: null,
  workerId: `${host}-w`,
  physicalHostId: host,
  backendBuild: "test",
  sourceClosureDigest: CLOSURE,
  now: () => 1_700_000_000_000,
});

const ctxOf = (i: number): CaseContext => ({ manifest: frozen.manifest, campaignDigest: frozen.campaignDigest, caseId: frozen.cases[i].caseId, spec: frozen.cases[i].spec });
const va = (i: number, r: Uint8Array | null, files: Partial<Record<ResultFile, Uint8Array>>) => validateAttempt(ctxOf(i), r, files, initialOf(frozen.cases[i].spec));
const bytesOf = (r: ResultManifest) => new TextEncoder().encode(canonicalJSON(r));
const initialOf = (spec: CaseSpec) => frozen.initialArtifacts.get(spec.initialArtifactDigest)!;

beforeAll(async () => {
  frozen = await freezeCampaign(protocol, { sourceClosureDigest: CLOSURE, registry: [] });
  for (const c of frozen.cases) results.set(c.caseId, await runCase(c.spec, initialOf(c.spec), opts("primary", "mac")));
}, 120_000);

describe("freeze", () => {
  it("resolves fixtures x blocks in canonical order and is deterministic", async () => {
    expect(frozen.cases.map((c) => `${c.spec.fixtureId}/${c.spec.blockId}`)).toEqual(["passive/b1", "passive/b2", "react/b1", "react/b2", "dies/b1", "dies/b2"]);
    const again = await freezeCampaign(protocol, { sourceClosureDigest: CLOSURE, registry: [] });
    expect(again.manifestDigest).toBe(frozen.manifestDigest);
    expect(new Set(frozen.manifest.orderedCaseIds).size).toBe(6);
  });

  it("refuses colliding seeds and an unavailable observer", async () => {
    await expect(freezeCampaign(protocol, { sourceClosureDigest: CLOSURE, registry: [{ first: 8500902, last: 8500902, owner: "someone" }] })).rejects.toThrow(/seed collisions/);
    await expect(freezeCampaign({ ...protocol, observerVersion: "renewal-v1" }, { sourceClosureDigest: CLOSURE, registry: [] })).rejects.toThrow(/not available/);
  });

  it("binds a different closure to different case IDs", async () => {
    const other = await freezeCampaign(protocol, { sourceClosureDigest: "d".repeat(64), registry: [] });
    expect(other.cases[0].caseId).not.toBe(frozen.cases[0].caseId);
  });
});

describe("runCase and its readouts", () => {
  it("is deterministic and host-independent in its canonical part", async () => {
    const c = frozen.cases[2];
    const again = await runCase(c.spec, initialOf(c.spec), opts("replay", "other"));
    expect(canonicalJSON(again.result.canonical)).toBe(canonicalJSON(results.get(c.caseId)!.result.canonical));
    expect(again.result.execution.physicalHostId).toBe("other");
  });

  it("meets every fixture's expectation, with exact invariants", () => {
    for (const c of frozen.cases) {
      const r = results.get(c.caseId)!;
      expect(r.result.canonical.invariantChecks.passed).toBe(true);
      const ro = JSON.parse(new TextDecoder().decode(r.files["readout.json"]));
      expect(ro.met, `${c.spec.fixtureId}/${c.spec.blockId}`).toBe(true);
      expect(ro.status).toBe("supported");
    }
  });

  it("treats an extinction as a completed scientific outcome, not a failure", () => {
    const r = results.get(frozen.cases[4].caseId)!;
    expect(r.result.canonical.outcome).toBe("completed");
    const ro = JSON.parse(new TextDecoder().decode(r.files["readout.json"]));
    expect(ro.extinct).toBe(true);
  });

  it("segments through checkpoints without changing state or observers", () => {
    const ro = JSON.parse(new TextDecoder().decode(results.get(frozen.cases[2].caseId)!.files["readout.json"]));
    const c = ro.details.continuity;
    expect(c.segmentedEndStateHash).toBe(c.continuousEndStateHash);
    expect(c.segmentedObserverDigest).toBe(c.continuousObserverDigest);
  });

  it("reports a history with a missing census as invalid or incomplete", () => {
    const c = frozen.cases[2];
    const recs = decodeObservations(results.get(c.caseId)!.files["observations.jsonl"]);
    const withoutLastCensus = recs.filter((r, i) => !(r.kind === "census" && i === recs.length - 2));
    expect(engineeringReadout(c.spec, withoutLastCensus as ObservationRecord[]).status).toBe("invalid-or-incomplete");
    expect(engineeringReadout(c.spec, recs.slice(0, -1)).status).toBe("invalid-or-incomplete");
  });

  it("refuses a corrupted initial artifact and a wrong backend contract", async () => {
    const c = frozen.cases[0];
    const bad = initialOf(c.spec).slice();
    bad[100] ^= 1;
    await expect(runCase(c.spec, bad, opts("primary", "mac"))).rejects.toThrow(/initial artifact/);
    await expect(runCase({ ...c.spec, requiredBackendContract: "webgpu-v1" as "cpu-ref-v1" }, initialOf(c.spec), opts("primary", "mac"))).rejects.toThrow(/provides cpu-ref-v1/);
  });
});

async function reseal(r: ResultManifest, files: CaseFiles): Promise<ResultManifest> {
  const out = structuredClone(r);
  for (const f of RESULT_FILES) {
    out.execution.files[f] = await sha256Hex(files[f]);
    out.execution.artifactSizes[f] = files[f].byteLength;
  }
  out.canonical.endArtifactDigest = out.execution.files["end.blck"];
  out.canonical.canonicalObservationDigests.observations = out.execution.files["observations.jsonl"];
  out.canonical.readoutDigest = out.execution.files["readout.json"];
  return out;
}

describe("validateAttempt", () => {
  it("accepts an untouched attempt and re-derives its readout", async () => {
    const r = results.get(frozen.cases[0].caseId)!;
    const v = await va(0, bytesOf(r.result), r.files);
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
    expect(v.readout?.met).toBe(true);
  });

  it("rejects an incomplete attempt (no result.json) and a missing required file", async () => {
    const r = results.get(frozen.cases[0].caseId)!;
    expect((await va(0, null, r.files)).errors).toContain("missing result.json");
    const { "end.blck": _, ...rest } = r.files;
    expect((await va(0, bytesOf(r.result), rest as Partial<Record<ResultFile, Uint8Array>>)).errors).toContain("missing end.blck");
  });

  it("rejects corrupt bytes", async () => {
    const r = results.get(frozen.cases[2].caseId)!;
    const obs = r.files["observations.jsonl"].slice();
    obs[10] ^= 0x01;
    const v = await va(2, bytesOf(r.result), { ...r.files, "observations.jsonl": obs });
    expect(v.valid).toBe(false);
    expect(v.errors.join("\n")).toMatch(/corrupt bytes/);
  });

  it("rejects a wrong observer version even when every digest is consistent", async () => {
    const r = results.get(frozen.cases[2].caseId)!;
    const { state, observer } = decodeCheckpoint(r.files["end.blck"]);
    const o = observer as { exactLedger: { version: string } };
    o.exactLedger.version = "exact-ledger-v0";
    const files = { ...r.files, "end.blck": encodeCheckpoint(state, o) };
    const v = await va(2, bytesOf(await reseal(r.result, files)), files);
    expect(v.valid).toBe(false);
    expect(v.errors.join("\n")).toMatch(/observer version exact-ledger-v0 != manifest exact-ledger-v1/);
  });

  it("rejects a readout that does not re-derive from the observations, and a different source closure", async () => {
    const r = results.get(frozen.cases[0].caseId)!;
    const ro = JSON.parse(new TextDecoder().decode(r.files["readout.json"]));
    ro.met = !ro.met;
    const files = { ...r.files, "readout.json": new TextEncoder().encode(canonicalJSON(ro)) };
    const v = await va(0, bytesOf(await reseal(r.result, files)), files);
    expect(v.errors).toContain("readout does not re-derive from the observations");
    const other = structuredClone(r.result);
    other.execution.sourceClosureDigest = "e".repeat(64);
    expect((await va(0, bytesOf(other), r.files)).errors).toContain("result was produced by a different source closure");
  });

  it("rejects a history with intermediate censuses removed, even with consistent digests (review P1)", async () => {
    const c = frozen.cases[2];
    const r = results.get(c.caseId)!;
    const recs = decodeObservations(r.files["observations.jsonl"]);
    const thinned = [recs[0], ...recs.slice(-2)];
    const files = { ...r.files, "observations.jsonl": encodeObservations(thinned), "readout.json": new TextEncoder().encode(canonicalJSON(engineeringReadout(c.spec, thinned))) };
    const v = await va(2, bytesOf(await reseal(r.result, files)), files);
    expect(v.valid).toBe(false);
    expect(v.errors.join("\n")).toMatch(/a complete history has/);
  });

  it("rejects a census whose summary contradicts the end checkpoint (false extinction, review P1)", async () => {
    const c = frozen.cases[2];
    const r = results.get(c.caseId)!;
    const recs = decodeObservations(r.files["observations.jsonl"]);
    (recs[recs.length - 2] as { livingCells: number }).livingCells = 0;
    const files = { ...r.files, "observations.jsonl": encodeObservations(recs), "readout.json": new TextEncoder().encode(canonicalJSON(engineeringReadout(c.spec, recs))) };
    const v = await va(2, bytesOf(await reseal(r.result, files)), files);
    expect(v.errors).toContain("last census does not match the end artifact (state and observer)");
  });

  it("rejects an invariant flag that does not follow from the residuals, and malformed records without throwing", async () => {
    const r = results.get(frozen.cases[0].caseId)!;
    const bad = structuredClone(r.result);
    bad.canonical.invariantChecks.passed = false;
    expect((await va(0, bytesOf(bad), r.files)).errors).toContain("invariant 'passed' flag does not follow from the residuals");
    const junk = new TextEncoder().encode('{"kind":"census"}\n{"kind":"final"}\n');
    const files = { ...r.files, "observations.jsonl": junk };
    const v = await va(0, bytesOf(await reseal(r.result, files)), files);
    expect(v.valid).toBe(false);
  });

  it("rejects forged continuity digests that merely agree with each other (review 3b P2)", async () => {
    const c = frozen.cases[2];
    const r = results.get(c.caseId)!;
    const recs = decodeObservations(r.files["observations.jsonl"]);
    const fin = recs[recs.length - 1] as { continuity: { continuousObserverDigest: string; segmentedObserverDigest: string } };
    fin.continuity.continuousObserverDigest = fin.continuity.segmentedObserverDigest = "9".repeat(64);
    const files = { ...r.files, "observations.jsonl": encodeObservations(recs), "readout.json": new TextEncoder().encode(canonicalJSON(engineeringReadout(c.spec, recs))) };
    const v = await va(2, bytesOf(await reseal(r.result, files)), files);
    expect(v.errors).toContain("continuity: segmented observer digest is not the end artifact's observer section");
  });

  it("rejects intermediate counters that only coerce to decimal strings (review 3b P2)", async () => {
    const c = frozen.cases[2];
    const r = results.get(c.caseId)!;
    const recs = decodeObservations(r.files["observations.jsonl"]);
    (recs[2] as unknown as { totals: { A: unknown } }).totals.A = 0;
    (recs[3] as unknown as { flux: unknown[] }).flux[0] = [0];
    const files = { ...r.files, "observations.jsonl": encodeObservations(recs), "readout.json": new TextEncoder().encode(canonicalJSON(engineeringReadout(c.spec, recs))) };
    const v = await va(2, bytesOf(await reseal(r.result, files)), files);
    expect(v.errors.join("\n")).toMatch(/census 2: bad totals/);
    expect(v.errors.join("\n")).toMatch(/census 3: bad flux/);
  });

  it("rejects an attempt whose initial artifact is missing or corrupt", async () => {
    const r = results.get(frozen.cases[0].caseId)!;
    expect((await validateAttempt(ctxOf(0), bytesOf(r.result), r.files, null)).errors).toContain("the case's initial artifact is missing or corrupt");
  });

  it("treats a checkpoint continuity failure as invalid, not as a scientific negative (review P2)", () => {
    const c = frozen.cases[2];
    const recs = decodeObservations(results.get(c.caseId)!.files["observations.jsonl"]);
    const fin = recs[recs.length - 1] as { continuity: { segmentedObserverDigest: string } };
    fin.continuity.segmentedObserverDigest = "0".repeat(64);
    expect(engineeringReadout(c.spec, recs).status).toBe("invalid-or-incomplete");
  });

  it("rejects a result filed under another case", async () => {
    const r = results.get(frozen.cases[0].caseId)!;
    const v = await va(1, bytesOf(r.result), r.files);
    expect(v.errors).toContain("result names a different case");
  });
});

async function info(i: number, role: "primary" | "replay", host: string, k = 1, tamper = false): Promise<AttemptInfo> {
  const c = frozen.cases[i];
  let out = await runCase(c.spec, initialOf(c.spec), opts(role, host, k));
  if (tamper) {
    // A host whose physics differs: a different end state with self-consistent digests.
    const { state, observer } = decodeCheckpoint(out.files["end.blck"]);
    state.cells[3 * 256 + 5] += 1; // P of one cell
    state.cells[0] -= 1; // keep matter totals equal
    const files = { ...out.files, "end.blck": encodeCheckpoint(state, observer) };
    const r = await reseal(out.result, files);
    const { stateHash } = await import("@bl/schema");
    r.canonical.endStateHash = stateHash(state);
    out = { result: r, files };
  }
  const verdict = tamper ? { valid: true, errors: [], readout: null } : await va(i, bytesOf(out.result), out.files);
  return { attemptId: out.result.execution.attemptId, role, physicalHostId: host, verdict, canonical: out.result.canonical, partial: false };
}

describe("decideCase", () => {
  it("accepts a primary and a replay from different physical hosts that agree", async () => {
    const d = await decideCase(frozen.cases[0].caseId, [await info(0, "primary", "mac"), await info(0, "replay", "m3pro")]);
    expect(d.decision).toBe("accepted");
    expect(d.readout?.met).toBe(true);
  });

  it("does not accept a replay from the same physical host", async () => {
    const d = await decideCase(frozen.cases[0].caseId, [await info(0, "primary", "mac"), await info(0, "replay", "mac")]);
    expect(d.decision).toBe("pending-replay");
  });

  it("quarantines two hosts' disagreeing results and keeps both attempts", async () => {
    const d = await decideCase(frozen.cases[0].caseId, [await info(0, "primary", "mac"), await info(0, "replay", "m3pro", 1, true)]);
    expect(d.decision).toBe("quarantined");
    expect(d.attempts).toHaveLength(2);
  });

  it("keeps one accepted result per case when a duplicate result arrives, whatever the arrival order", async () => {
    const xs = [await info(0, "primary", "mac"), await info(0, "primary", "m3pro"), await info(0, "replay", "m3pro"), await info(0, "replay", "mac", 2)];
    const a = await decideCase(frozen.cases[0].caseId, xs);
    const b = await decideCase(frozen.cases[0].caseId, [...xs].reverse());
    expect(a.decision).toBe("accepted");
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
  });

  it("does not treat a retained partial attempt as a result", async () => {
    const partial: AttemptInfo = { attemptId: "mac.primary.1", role: "primary", physicalHostId: "mac", partial: true, canonical: null, verdict: { valid: false, errors: ["interrupted"], readout: null } };
    expect((await decideCase(frozen.cases[0].caseId, [partial])).decision).toBe("missing");
    const d = await decideCase(frozen.cases[0].caseId, [partial, await info(0, "primary", "mac", 2), await info(0, "replay", "m3pro")]);
    expect(d.decision).toBe("accepted");
  });
});

describe("reduceCampaign", () => {
  async function index(hosts: [string, string], drop: number[] = [], quarantine: number[] = []) {
    const cases = [];
    for (let i = 0; i < frozen.cases.length; i++) {
      if (drop.includes(i)) continue;
      const xs = [await info(i, "primary", hosts[0]), await info(i, "replay", hosts[1], 1, quarantine.includes(i))];
      cases.push(await decideCase(frozen.cases[i].caseId, xs));
    }
    return { schemaVersion: "discovery-v1" as const, manifestDigest: frozen.manifestDigest, policy: frozen.manifest.verificationPolicy, cases, strays: [] };
  }
  const specs = () => new Map(frozen.cases.map((c) => [c.caseId, c.spec]));

  it("reports complete, counts shared-seed blocks once, and is independent of which host ran what", async () => {
    const a = await reduceCampaign(frozen.manifest, specs(), await index(["mac", "m3pro"]));
    const b = await reduceCampaign(frozen.manifest, specs(), await index(["m3pro", "mac"]));
    expect(a.status).toBe("complete");
    expect(a.independentBlocks).toBe(2);
    expect(a.fixtures.every((f) => f.status === "supported")).toBe(true);
    expect(a.reductionDigest).toBe(b.reductionDigest);
  }, 60_000);

  it("blocks completeness on a missing case and reports a quarantine", async () => {
    const inc = await reduceCampaign(frozen.manifest, specs(), await index(["mac", "m3pro"], [3]));
    expect(inc.status).toBe("incomplete");
    expect(inc.counts.missing).toBe(1);
    expect(inc.fixtures.find((f) => f.fixtureId === "react")!.status).toBe("invalid-or-incomplete");
    const q = await reduceCampaign(frozen.manifest, specs(), await index(["mac", "m3pro"], [], [1]));
    expect(q.status).toBe("quarantined");
  }, 60_000);

  it("refuses duplicate or unexpected rows instead of letting the last one win (review P2)", async () => {
    const idx = await index(["mac", "m3pro"]);
    const dup = { ...idx, cases: [...idx.cases, { ...idx.cases[0], decision: "quarantined" as const }] };
    await expect(reduceCampaign(frozen.manifest, specs(), dup)).rejects.toThrow(/twice/);
    const stray = { ...idx, cases: [...idx.cases, { ...idx.cases[0], caseId: "f".repeat(64) }] };
    await expect(reduceCampaign(frozen.manifest, specs(), stray)).rejects.toThrow(/outside the manifest/);
  }, 60_000);

  it("refuses an acceptance index from another manifest", async () => {
    const idx = await index(["mac", "m3pro"]);
    await expect(reduceCampaign(frozen.manifest, specs(), { ...idx, manifestDigest: "0".repeat(64) })).rejects.toThrow(/different manifest/);
  }, 60_000);
});

describe("pinned renewal campaigns (D5)", () => {
  const PIN = { name: RENEWAL_PIN.name, constructionRevision: RENEWAL_PIN.constructionRevision, sourceDigest: RENEWAL_PIN.sourceDigest };
  const pinnedProtocol: DiscoveryProtocol = {
    ...protocol,
    campaign: "pinned",
    fixtures: [
      {
        ...protocol.fixtures[0],
        id: "cells",
        assayId: "renewal-null",
        config: { ...small, dtQ: 0, motility: false, mutRate: 0 },
        initial: { kind: "cells", nutrient: 4, founders: [{ x: 3, y: 5, genomeHex: hex, biomass: 512, energy: 1024 }, { x: 12, y: 5, genomeHex: hex, biomass: 64, energy: 128 }] },
      },
    ],
    observerVersion: RENEWAL_PIN.observerVersion,
    readoutVersion: RENEWAL_PIN.readoutVersion,
  };

  it("the launcher's hard-coded pin is the schema's pin", async () => {
    const { EXPECTED_PIN } = await import("../../../tools/lib/discovery-pin.ts");
    expect({ name: EXPECTED_PIN.name, constructionRevision: EXPECTED_PIN.constructionRevision, sourceDigest: EXPECTED_PIN.sourceDigest }).toEqual(PIN);
  });

  it("allows polymerTransport only on a pinned campaign", () => {
    const withAbl = (pinnedOrNot: DiscoveryProtocol) => ({ ...pinnedOrNot, fixtures: [{ ...pinnedOrNot.fixtures[0], config: { ...pinnedOrNot.fixtures[0].config, polymerTransport: false } as never }] });
    expect(validateProtocol(withAbl(pinnedProtocol))).toEqual([]);
    expect(validateProtocol(withAbl(protocol)).join()).toMatch(/allowed only on a campaign pinned/);
  });

  it("needs the verified pin, the matching readout and a known pin record", async () => {
    await expect(freezeCampaign(pinnedProtocol, { sourceClosureDigest: CLOSURE, registry: [] })).rejects.toThrow(/needs the verified construction pin/);
    await expect(freezeCampaign({ ...pinnedProtocol, readoutVersion: "engineering-readout-v1" }, { sourceClosureDigest: CLOSURE, registry: [], pin: PIN })).rejects.toThrow(/goes with readout/);
    await expect(freezeCampaign(pinnedProtocol, { sourceClosureDigest: CLOSURE, registry: [], pin: { ...PIN, sourceDigest: "0".repeat(64) } })).rejects.toThrow(/not the one this build knows/);
  });

  it("records the pin and its physics, and binds every case to the pinned backend", async () => {
    const f = await freezeCampaign(pinnedProtocol, { sourceClosureDigest: CLOSURE, registry: [], pin: PIN });
    expect(f.manifest.pin).toEqual(PIN);
    expect(f.manifest.physicsVersions).toEqual(RENEWAL_PIN.physicsVersions);
    expect(validateManifest(f.manifest)).toEqual([]);
    expect(f.cases.every((c) => c.spec.requiredBackendContract === RENEWAL_PIN.backend && validateCaseSpec(c.spec).length === 0)).toBe(true);
    const { pin: _p, ...unpinned } = f.manifest;
    expect(validateManifest(unpinned).join()).toMatch(/needs the pin record/);
    expect(validateManifest({ ...f.manifest, pin: { ...PIN, constructionRevision: "x" } }).join()).toMatch(/not a pin this build knows/);
    // Without its validator a pinned result is never valid.
    const c = f.cases[0];
    const v = await validateAttempt({ manifest: f.manifest, campaignDigest: f.campaignDigest, caseId: c.caseId, spec: c.spec }, bytesOf(results.values().next().value!.result), results.values().next().value!.files, f.initialArtifacts.get(c.spec.initialArtifactDigest)!);
    expect(v.valid).toBe(false);
  });

  it("builds exact single-cell founders (the construction workstream's constructionWorld)", async () => {
    const f = await freezeCampaign(pinnedProtocol, { sourceClosureDigest: CLOSURE, registry: [], pin: PIN });
    const { state } = decodeCheckpoint(f.initialArtifacts.get(f.cases[0].spec.initialArtifactDigest)!);
    const n = 256, CHB = 1, CHE = 4, CHA = 0;
    const at = (x: number, y: number) => y * 16 + x;
    expect(state.cells[CHB * n + at(3, 5)]).toBe(512);
    expect(state.cells[CHE * n + at(12, 5)]).toBe(128);
    expect(Array.from(state.cells.subarray(CHA * n, (CHA + 1) * n)).every((v) => v === 4)).toBe(true);
    expect(Array.from(state.cells.subarray(CHB * n, (CHB + 1) * n)).reduce((a, b) => a + b, 0)).toBe(576);
    expect(validateProtocol({ ...pinnedProtocol, fixtures: [{ ...pinnedProtocol.fixtures[0], initial: { kind: "cells", nutrient: 4, founders: [{ x: 3, y: 5, genomeHex: hex, biomass: 1, energy: 1 }, { x: 3, y: 5, genomeHex: hex, biomass: 1, energy: 1 }] } }] }).join()).toMatch(/overlaps/);
  });
});
