import { stateHash } from "@bl/schema";
import { sha256 } from "../lib/founder-policy.ts";
import {
  type AssayResult,
  buildManifest,
  requestsFromSamples,
  type Sample,
} from "../lib/discovery-improvement-runtime.ts";
import {
  discoveryCompetitionConfig,
  discoveryCompetitionWorld,
} from "../lib/discovery-competition.ts";
import {
  budget,
  partition,
  requireRelease,
  type Roster,
  validateCached,
  validateRoster,
} from "../discovery_improvement_assay.ts";
import type { Allocation } from "../discovery_improvement_shard.ts";
function assert(x: unknown): asserts x {
  if (!x) throw Error("assertion");
}
function fails(f: () => unknown) {
  let failed = false;
  try {
    f();
  } catch {
    failed = true;
  }
  assert(failed);
}
const shortlist = JSON.parse(
  await Deno.readTextFile("experiments/founder-discovery/v1/shortlist.json"),
);
const m = buildManifest({
  format: "discovery-improvement-manifest/v1",
  ruleVersion: 1,
  sourceRoot: Deno.cwd(),
  pilotDesignSha256: "a".repeat(64),
  pilotAnalysisSha256: "b".repeat(64),
  inputs: {},
  sources: {},
  sourceManifestHash: "c".repeat(64),
  founders: shortlist.selected.map((f: any) => ({
    id: f.id,
    hex: f.hex,
    cluster: f.cluster,
  })),
});
function fixture() {
  const samples = Object.fromEntries(
    m.units.map(
      (u) => [
        u.id,
        Object.fromEntries(
          m.times.map((
            time,
            t,
          ) => [
            time,
            {
              time,
              drawSeeds: u.drawSeeds[t],
              draws: {
                status: "present",
                genomes: [u.founderHex, u.founderHex],
                unresolvedMass: 0,
              },
            } as Sample,
          ]),
        ),
      ],
    ),
  );
  samples[m.units[0].id][0].draws = {
    status: "absent",
    genomes: [],
    unresolvedMass: 0,
  };
  samples[m.units[1].id][100000].draws = {
    status: "unresolved",
    genomes: [],
    unresolvedMass: 1,
  };
  const r: Roster = {
      manifestHash: m.manifestHash,
      ...requestsFromSamples(m, samples),
    },
    raw = new TextEncoder().encode(JSON.stringify(r) + "\n"),
    counts: Record<string, number> = {};
  for (const d of r.draws) counts[d.status] = (counts[d.status] ?? 0) + 1;
  return {
    r,
    raw,
    ready: {
      format: "discovery-improvement-global-readiness/v1",
      manifestHash: m.manifestHash,
      sourceManifestHash: m.sourceManifestHash,
      physicalComplete: true,
      unexpected: [],
      slots: m.units.map((u) => ({ unitId: u.id, status: "complete" })),
      semanticCounts: {
        draws: 384,
        requests: 6144,
        uniqueConfigurations: r.uniqueKeys.length,
        drawStatuses: counts,
      },
      rosterSha256: sha256(raw),
    },
  };
}
Deno.test("semantic roster preserves all references duplicates and unavailable outcomes", () => {
  const { r, raw, ready } = fixture(),
    requests = validateRoster(m, r, ready, raw);
  assert(requests.size === r.uniqueKeys.length && requests.size < 6144);
  assert(r.assays.filter((a) => a.status === "absent").length === 32);
  assert(r.assays.filter((a) => a.status === "unresolved").length === 32);
  const divided = partition(r.uniqueKeys, ["local", "remote"]);
  assert(divided.local.length + divided.remote.length === requests.size);
  assert(new Set([...divided.local, ...divided.remote]).size === requests.size);
  assert(
    JSON.stringify(divided) ===
      JSON.stringify(
        partition([...r.uniqueKeys].reverse(), ["local", "remote"]),
      ),
  );
});
Deno.test("roster gate rejects partial readiness drift foreign references duplicate keys and unavailable cache", () => {
  const { r, raw, ready } = fixture();
  fails(() => validateRoster(m, r, { ...ready, physicalComplete: false }, raw));
  fails(() =>
    validateRoster(m, r, { ...ready, slots: ready.slots.slice(1) }, raw)
  );
  fails(() =>
    validateRoster(m, r, ready, new TextEncoder().encode(JSON.stringify(r)))
  );
  const changed = structuredClone(r);
  changed.draws[2].sampleSeed++;
  fails(() => validateRoster(m, changed, ready));
  changed.draws[2].sampleSeed--;
  changed.assays[0].cacheKey = "foreign";
  fails(() => validateRoster(m, changed, ready));
  fails(() =>
    validateRoster(
      m,
      { ...r, uniqueKeys: [...r.uniqueKeys, r.uniqueKeys[0]] },
      ready,
    )
  );
  const foreign = structuredClone(r);
  foreign.assays[50].drawId = "foreign";
  fails(() => validateRoster(m, foreign, ready));
});
Deno.test("PREPARED never authorizes production and conservative envelope fits original caps", () => {
  fails(() =>
    requireRelease(
      {
        format: "discovery-improvement-assay-candidate/v1",
        status: "PREPARED",
      } as any,
    )
  );
  const a = {
    globalPriorSeconds: 24479.946090875,
    priorInvocations: 29,
    engineeringReserveSeconds: 1000,
    engineeringReserveInvocations: 2,
    hosts: [{ capSeconds: 100000, maxInvocations: 170 }, {
      capSeconds: 130000,
      maxInvocations: 220,
    }],
  } as Allocation;
  const b = budget(a);
  assert(b.remainingSeconds >= 86000 && b.remainingInvocations === 155);
  fails(() => budget({ ...a, globalPriorSeconds: 50000 }));
  fails(() => budget({ ...a, priorInvocations: 100 }));
});
Deno.test("both-extinct original cache validates shared configurations and rejects resume drift", () => {
  const { r, raw, ready } = fixture(),
    request = [...validateRoster(m, r, ready, raw).values()][0],
    cfg = discoveryCompetitionConfig(request.seed),
    world = discoveryCompetitionWorld(
      cfg,
      request.descendantHex,
      request.founderHex,
      request.assignment,
    );
  const result: AssayResult = {
    format: "discovery-improvement-assay/v1",
    cacheKey: request.cacheKey,
    sourceManifestHash: m.sourceManifestHash,
    descendantHex: request.descendantHex,
    founderHex: request.founderHex,
    cfg,
    seed: request.seed,
    assignment: request.assignment,
    steps: 20000,
    initialStateHash: stateHash(world.state),
    finalStateHash: "0".repeat(16),
    descendantMass: 0,
    ancestorMass: 0,
    unassociatedMass: 0,
    status: "both-extinct",
    score: null,
    elapsedSeconds: 1,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(result) + "\n");
  assert(validateCached(bytes, request, m.sourceManifestHash).score === null);
  fails(() =>
    validateCached(
      bytes,
      { ...request, cacheKey: "foreign" },
      m.sourceManifestHash,
    )
  );
  fails(() => validateCached(bytes, request, "d".repeat(64)));
  fails(() =>
    validateCached(
      new TextEncoder().encode(JSON.stringify({ ...result, score: 1 }) + "\n"),
      request,
      m.sourceManifestHash,
    )
  );
  fails(() =>
    validateCached(
      new TextEncoder().encode(JSON.stringify(result)),
      request,
      m.sourceManifestHash,
    )
  );
});
