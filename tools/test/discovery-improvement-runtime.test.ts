import { cellCount, CH, G, packLineageLo, stateHash } from "@bl/schema";
import { join } from "node:path";
import { sha256 } from "../lib/founder-policy.ts";
import { discoveryEvolutionWorld } from "../lib/discovery-evolution.ts";
import {
  analyzeScores,
  assayCacheKey,
  type AssayResult,
  buildManifest,
  checkpointPaths,
  loadCheckpointChain,
  loadVerifiedChainCache,
  type Manifest,
  requestsFromSamples,
  type Sample,
  validateCheckpointBiology,
  validateManifest,
  writeCheckpoint,
  writeVerifiedChainCache,
} from "../lib/discovery-improvement-runtime.ts";
import {
  discoveryCompetitionConfig,
  discoveryCompetitionWorld,
} from "../lib/discovery-competition.ts";
import {
  canStartAssay,
  type Release,
  validateRelease,
} from "../discovery_improvement.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw Error(message);
}
function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
async function rejects(
  work: () => unknown | Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  try {
    await work();
  } catch (e) {
    if (pattern.test(String(e))) return;
    throw e;
  }
  throw Error(`expected rejection ${pattern}`);
}
const shortlist = JSON.parse(
  await Deno.readTextFile("experiments/founder-discovery/v1/shortlist.json"),
);
const founders = shortlist.selected.map((
  f: { id: string; hex: string; cluster: number },
) => ({ id: f.id, hex: f.hex, cluster: f.cluster }));
function manifest(): Manifest {
  return buildManifest({
    format: "discovery-improvement-manifest/v1",
    ruleVersion: 1,
    sourceRoot: Deno.cwd(),
    pilotDesignSha256: "a".repeat(64),
    pilotAnalysisSha256: "b".repeat(64),
    inputs: {},
    sources: {},
    sourceManifestHash: "c".repeat(64),
    founders,
  });
}
function sample(
  unit: Manifest["units"][number],
  time: number,
  status: "present" | "absent" | "unresolved" = "present",
): Sample {
  const index = [0, 100_000, 1_000_000].indexOf(time);
  return {
    time,
    stateHash: "0".repeat(16),
    rootMass: status === "present" ? 42 : 0,
    byGenomeAbundance: status === "present"
      ? [{ hex: unit.founderHex, mass: 42 }]
      : [],
    draws: {
      status,
      genomes: status === "present" ? [unit.founderHex, unit.founderHex] : [],
      unresolvedMass: status === "unresolved" ? 42 : 0,
    },
    unknownAncestryMass: status === "unresolved" ? 42 : 0,
    unassociatedMass: 0,
    drawSeeds: unit.drawSeeds[index],
  };
}
function samples(
  m: Manifest,
  fill = true,
): Record<string, Record<number, Sample>> {
  return Object.fromEntries(
    m.units.map((u) => [
      u.id,
      fill
        ? Object.fromEntries(
          [0, 100_000, 1_000_000].map((t) => [t, sample(u, t)]),
        )
        : {},
    ]),
  );
}
Deno.test("manifest allocates complete paired histories and sampling seeds in frozen order", () => {
  const m = validateManifest(manifest());
  equal(m.units.length, 64);
  equal(m.units[0].drawSeeds, [[6420001, 6420002], [6420003, 6420004], [
    6420005,
    6420006,
  ]]);
  equal(m.units[1].mode, "off");
  equal(m.units.at(-1)?.drawSeeds[2], [6420383, 6420384]);
  equal(m.checkpointSteps.length * m.units.length, 704);
  assert(m.evolutionConfigs["6410001-normal"].mutRate > 0);
  equal(m.evolutionConfigs["6410001-off"].mutRate, 0);
  const bad = structuredClone(m);
  bad.units[0].drawSeeds[0][0]++;
  awaitRejectsSync(() => validateManifest(bad), /hash drift/);
});
function awaitRejectsSync(work: () => unknown, pattern: RegExp) {
  try {
    work();
  } catch (e) {
    if (pattern.test(String(e))) return;
    throw e;
  }
  throw Error(`expected rejection ${pattern}`);
}

Deno.test("checkpoint chain binds physical bytes, edge delta, parent receipt and exact samples", async () => {
  const m = manifest(), unit = m.units.find((u) => u.mode === "off")!;
  const dir = await Deno.makeTempDir();
  try {
    const zero =
      discoveryEvolutionWorld(unit.seed, unit.mode, unit.founderHex).state;
    const first = await writeCheckpoint(dir, m, unit, zero, [], [], null);
    const hundred = { ...zero, step: 100_000 };
    await writeCheckpoint(dir, m, unit, hundred, [], [], first);
    const verified = await loadCheckpointChain(dir, m, unit);
    equal(verified?.state.step, 100_000);
    equal(verified?.samples[0].drawSeeds, unit.drawSeeds[0]);
    equal(verified?.samples[100_000].drawSeeds, unit.drawSeeds[1]);
    const paths = checkpointPaths(dir, 100_000);
    await Deno.writeTextFile(paths.edges, "[ ]\n");
    await rejects(() => loadCheckpointChain(dir, m, unit), /hash drift/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("partial later checkpoint cannot be skipped on resume", async () => {
  const m = manifest(), unit = m.units[0], dir = await Deno.makeTempDir();
  try {
    const zero =
      discoveryEvolutionWorld(unit.seed, unit.mode, unit.founderHex).state;
    await writeCheckpoint(dir, m, unit, zero, [], [], null);
    await Deno.writeTextFile(checkpointPaths(dir, 200_000).edges, "[]\n");
    await rejects(
      () => loadCheckpointChain(dir, m, unit),
      /incomplete\/noncontiguous/,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("intermediate checkpoint rejects future or wrong-interval edges and off-genome changes", () => {
  const m = manifest(), normal = m.units[0], off = m.units[1];
  const state =
    discoveryEvolutionWorld(normal.seed, normal.mode, normal.founderHex).state;
  state.step = 200_000;
  validateCheckpointBiology(state, normal, [], [], 100_000);
  const invalid = [{ child: "200001:1", parent: "0:1" }];
  awaitRejectsSync(
    () => validateCheckpointBiology(state, normal, invalid, invalid, 100_000),
    /noncausal\/invalid/,
  );
  const founder = Object.keys(
    discoveryEvolutionWorld(normal.seed, normal.mode, normal.founderHex)
      .founderRoots,
  )[0];
  const stale = [{
    child: `100000:${packLineageLo(state.cfg, 0)}`,
    parent: founder,
  }];
  awaitRejectsSync(
    () => validateCheckpointBiology(state, normal, stale, stale, 100_000),
    /outside checkpoint interval/,
  );
  const offState =
    discoveryEvolutionWorld(off.seed, off.mode, off.founderHex).state;
  offState.step = 200_000;
  awaitRejectsSync(
    () =>
      validateCheckpointBiology(
        offState,
        off,
        [{ child: "200000:1", parent: "0:1" }],
        [{ child: "200000:1", parent: "0:1" }],
        100_000,
      ),
    /mutation-off edge/,
  );
  const n = cellCount(offState.cfg);
  let cell = -1;
  for (let i = 0; i < n; i++) {
    if (offState.cells[CH.B * n + i] + offState.cells[CH.P * n + i] > 0) {
      cell = i;
      break;
    }
  }
  assert(cell >= 0);
  offState.genome[G.PARAM0 * n + cell] ^= 1;
  awaitRejectsSync(
    () => validateCheckpointBiology(offState, off, [], [], 100_000),
    /founder genome identity drift/,
  );
});

Deno.test("completed chain cache reuses validated samples but rejects changed bytes or samples", async () => {
  const m = manifest(), unit = m.units[1], dir = await Deno.makeTempDir();
  try {
    const zero =
      discoveryEvolutionWorld(unit.seed, unit.mode, unit.founderHex).state;
    let prior = null;
    for (let step = 0; step <= 1_000_000; step += 100_000) {
      prior = await writeCheckpoint(
        dir,
        m,
        unit,
        { ...zero, step },
        [],
        [],
        prior,
      );
    }
    assert(prior !== null);
    await writeVerifiedChainCache(dir, m, unit, prior);
    const quick = await loadVerifiedChainCache(dir, m, unit);
    equal(quick?.samples[1_000_000], prior.samples[1_000_000]);
    equal(quick?.receiptSha256, prior.receiptSha256);
    const cp = checkpointPaths(dir, 500_000).checkpoint,
      cpBytes = await Deno.readFile(cp);
    const changed = cpBytes.slice();
    changed[100] ^= 1;
    await Deno.writeFile(cp, changed);
    await rejects(() => loadVerifiedChainCache(dir, m, unit), /drift/);
    await Deno.writeFile(cp, cpBytes);
    const receipt = checkpointPaths(dir, 500_000).receipt,
      receiptBytes = await Deno.readFile(receipt);
    await Deno.writeTextFile(
      receipt,
      new TextDecoder().decode(receiptBytes).replace(
        '"step":500000',
        '"step":500001',
      ),
    );
    await rejects(() => loadVerifiedChainCache(dir, m, unit), /drift/);
    await Deno.writeFile(receipt, receiptBytes);
    const cachePath = join(dir, "verified-chain-cache.json"),
      cacheBytes = await Deno.readFile(cachePath),
      cache = JSON.parse(new TextDecoder().decode(cacheBytes));
    cache.samples[100000].rootMass++;
    await Deno.writeTextFile(cachePath, JSON.stringify(cache) + "\n");
    await rejects(() => loadVerifiedChainCache(dir, m, unit), /drift/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("requested roster preserves duplicates, absence, unresolved ancestry and missing units", () => {
  const m = manifest(), s = samples(m);
  s[m.units[0].id][100_000] = sample(m.units[0], 100_000, "absent");
  s[m.units[1].id][1_000_000] = sample(m.units[1], 1_000_000, "unresolved");
  delete s[m.units[2].id][1_000_000];
  const roster = requestsFromSamples(m, s);
  equal(roster.draws.length, 384);
  equal(roster.assays.length, 6144);
  equal(roster.draws.filter((d) => d.status === "absent").length, 2);
  equal(roster.draws.filter((d) => d.status === "unresolved").length, 2);
  equal(roster.draws.filter((d) => d.status === "missing").length, 2);
  equal(roster.assays.filter((a) => a.status === "absent").length, 32);
  equal(roster.draws[0].descendantHex, roster.draws[1].descendantHex);
  equal(roster.assays[0].cacheKey, roster.assays[16].cacheKey);
  assert(roster.uniqueKeys.length <= 2112);
});

Deno.test("cache key binds complete genomes, seed, placement and source identity", () => {
  const m = manifest(), [a, b] = m.founders;
  const key = assayCacheKey(a.hex, a.hex, 6430001, 0, m.sourceManifestHash);
  equal(key, assayCacheKey(a.hex, a.hex, 6430001, 0, m.sourceManifestHash));
  assert(key !== assayCacheKey(b.hex, a.hex, 6430001, 0, m.sourceManifestHash));
  assert(key !== assayCacheKey(a.hex, a.hex, 6430002, 0, m.sourceManifestHash));
  assert(key !== assayCacheKey(a.hex, a.hex, 6430001, 1, m.sourceManifestHash));
  assert(key !== assayCacheKey(a.hex, a.hex, 6430001, 0, "d".repeat(64)));
});

Deno.test("endpoint analysis maps 32 fixed slots, unknown retention and conservative bounds", () => {
  const m = manifest(), s = samples(m);
  s[m.units[1].id][1_000_000] = sample(m.units[1], 1_000_000, "unresolved");
  const roster = requestsFromSamples(m, s);
  const result = analyzeScores(m, roster, {}, s);
  equal(result.rows.length, 64);
  equal(result.rows[0].scores.length, 32);
  equal(result.rows[1].retained, null);
  equal(result.summary.effectBounds, { lower: -2, upper: 2 });
  equal(result.byTime.map((t) => t.role), [
    "calibration",
    "descriptive",
    "confirmatory",
  ]);
  equal(result.byTime[2].byFounder[0].retention.off.unknown, 1);
  equal(result.observations.length, 6144);
  equal(result.certifiedBlocks, 0);
  equal(result.repeatabilityCriterionMet, false);
  assert(!result.technicalComplete);
});

Deno.test("analysis preserves scored and both-extinct technical slots with shared cache references", () => {
  const m = manifest(), s = samples(m), roster = requestsFromSamples(m, s);
  const draw = roster.draws[0],
    scoredRequest = roster.assays[0],
    extinctRequest = roster.assays[4];
  const result = (
    request: typeof scoredRequest,
    descendantMass: number,
    ancestorMass: number,
  ): AssayResult => {
    const cfg = discoveryCompetitionConfig(request.assaySeed);
    const built = discoveryCompetitionWorld(
      cfg,
      draw.descendantHex!,
      draw.founderHex,
      request.assignment,
    );
    const score = descendantMass + ancestorMass
      ? (descendantMass - ancestorMass) / (descendantMass + ancestorMass)
      : null;
    return {
      format: "discovery-improvement-assay/v1",
      cacheKey: request.cacheKey!,
      sourceManifestHash: m.sourceManifestHash,
      descendantHex: draw.descendantHex!,
      founderHex: draw.founderHex,
      cfg,
      seed: request.assaySeed,
      assignment: request.assignment,
      steps: 20_000,
      initialStateHash: stateHash(built.state),
      finalStateHash: stateHash(built.state),
      descendantMass,
      ancestorMass,
      unassociatedMass: 0,
      status: score === null ? "both-extinct" : "scored",
      score,
      elapsedSeconds: 1,
    };
  };
  const scored = result(scoredRequest, 20, 10),
    extinct = result(extinctRequest, 0, 0);
  const analysis = analyzeScores(m, roster, {
    [scored.cacheKey]: scored,
    [extinct.cacheKey]: extinct,
  }, s);
  assert(
    analysis.observations.some((o) =>
      o.status === "scored" && o.score === 1 / 3
    ),
  );
  assert(
    analysis.observations.some((o) =>
      o.status === "both-extinct" && o.score === null
    ),
  );
  assert(
    analysis.observations.filter((o) => o.cacheKey === scored.cacheKey).length >
      1,
  );
  equal(analysis.byTime[0].role, "calibration");
});

Deno.test("release requires full measured local envelope and stops a budget-overrun tranche", () => {
  const m = manifest(),
    manifestSha = sha256("manifest"),
    out = "/tmp/improvement-raw";
  const f: Release["forecast"] = {
    histories: 64,
    evolutionSteps: 64_000_000,
    requestedAssays: 6144,
    maximumDistinctAssays: 2112,
    physicalCheckpoints: 704,
    plannedInvocations: 10,
    measuredEvolutionWithLedgerStepSeconds: 0.000001,
    measuredCheckpointReadSeconds: 0.01,
    measuredCheckpointSemanticSeconds: 0.01,
    measuredSampleSeconds: 0.01,
    measuredAssaySeconds: 0.1,
    measuredCheckpointWriteSeconds: 0.01,
    estimatedResumeVerificationSecondsPerInvocation: 1,
    estimatedStorageBytes: 10_000,
    availableStorageBytes: 30_000,
    estimatedTotalWallSeconds: 1000,
    cumulativeExecutionCapSeconds: 1800,
    minimumFreeBytes: 10_000,
  };
  const release: Release = {
    format: "discovery-improvement-release/v1",
    manifestSha256: manifestSha,
    manifestHash: m.manifestHash,
    pilotAnalysisSha256: m.pilotAnalysisSha256,
    outputDir: out,
    localOnly: true,
    paidUSD: 0,
    forecast: f,
  };
  validateRelease(release, m, manifestSha, out, 0, 600);
  awaitRejectsSync(
    () => validateRelease(release, m, manifestSha, out, 1700, 600),
    /exceed released execution/,
  );
  awaitRejectsSync(
    () =>
      validateRelease(
        { ...release, paidUSD: 1 as 0 },
        m,
        manifestSha,
        out,
        0,
        600,
      ),
    /local-only release/,
  );
  awaitRejectsSync(
    () =>
      validateRelease(
        { ...release, forecast: { ...f, maximumDistinctAssays: 2000 as 2112 } },
        m,
        manifestSha,
        out,
        0,
        600,
      ),
    /full fixed roster/,
  );
  const longAssay: Release = {
    ...release,
    forecast: {
      ...f,
      measuredAssaySeconds: 2,
      estimatedTotalWallSeconds: 5000,
      cumulativeExecutionCapSeconds: 6000,
    },
  };
  awaitRejectsSync(
    () => validateRelease(longAssay, m, manifestSha, out, 5398.5, 600),
    /exceed released execution/,
  );
  assert(!canStartAssay(longAssay, 5999, 0));
  assert(canStartAssay(longAssay, 5998, 0));
});
