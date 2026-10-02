// Run: deno test --no-lock -A tools/test/discovery-divergence-control-analyze.deno.ts
// Synthetic outcomes only; no GPU and no study competitions.
import assert from "node:assert/strict";
import { join } from "node:path";
import { stateHash } from "@bl/schema";
import {
  type AssayResult,
  validateManifest,
} from "../lib/discovery-improvement-runtime.ts";
import {
  discoveryCompetitionConfig,
  discoveryCompetitionWorld,
} from "../lib/discovery-competition.ts";
import {
  analyzeDivergence,
  buildRoster,
  type ImprovementReport,
  type Outcome,
} from "../lib/discovery-divergence-control.ts";
import { REPORT_SHA256 } from "../discovery_divergence_control.ts";
import {
  invocation,
  type Request,
  requestsOf,
} from "../discovery_divergence_control_run.ts";
import { collect } from "../discovery_divergence_control_analyze.ts";

const STUDY = "experiments/founder-discovery/v1/improvement-study";
const manifest = validateManifest(
  JSON.parse(await Deno.readTextFile(`${STUDY}/manifest.json`)),
);
const report = JSON.parse(
  await Deno.readTextFile(`${STUDY}/distribution-v1/analysis-v1/report.json`),
) as ImprovementReport;
const roster = buildRoster(report, REPORT_SHA256, manifest);
const evolvedIds = new Set(roster.evolved.flatMap((e) => e.observationIds));
const evolvedObservations = new Map<string, Outcome>(
  report.observations.filter((o) => evolvedIds.has(o.id)).map((
    o,
  ) => [o.id, { status: "scored", score: o.score }]),
);
const genomeOf = new Map(roster.assays.map((a) => [a.cacheKey, a.genomeId]));
const arm = new Map(roster.genomes.map((g) => [g.id, g.arm]));
const allReplay = { expected: 8, matched: 8 };

/** Outcomes by arm: every mutant competition scores m, every reconstruction r. */
function results(m: number, r: number): Map<string, Outcome> {
  return new Map(roster.assays.map((a) => [a.cacheKey, {
    status: "scored",
    score: arm.get(genomeOf.get(a.cacheKey)!) === "mutant" ? m : r,
  }]));
}
const run = (res: Map<string, Outcome>, replay = allReplay) =>
  analyzeDivergence({
    roster,
    evolvedObservations,
    results: res,
    replay,
    bootstrapResamples: 500,
  });

Deno.test("harmful mutants and beneficial reconstructions meet both criteria", () => {
  const a = run(results(-0.5, 0.6));
  assert.ok(a.technicalComplete);
  assert.deepEqual([a.selection.certifiedBlocks, a.selection.criterionMet], [
    8,
    true,
  ]);
  for (const r of a.reconstruction) {
    assert.deepEqual([r.certifiedSeeds, r.criterionMet], [8, true]);
    const evolved = a.selection.byFounder.find((f) =>
      f.founderId === r.founderId
    )!.evolved.point!;
    assert.ok(Math.abs(r.recoveredShareOfEvolved! - 0.6 / evolved) < 1e-12);
  }
  const b = a.selection.bootstrap.point95!;
  assert.ok(
    b.lower <= a.selection.effect.point! &&
      a.selection.effect.point! <= b.upper,
  );
  assert.deepEqual(run(results(-0.5, 0.6)), a);
});

Deno.test("mutants that match each evolved draw leave no contrast", () => {
  const res = new Map<string, Outcome>();
  for (const e of roster.evolved) {
    const mean = e.observationIds.reduce(
      (s, id) => s + evolvedObservations.get(id)!.score!,
      0,
    ) / 16;
    const m = roster.mutants.find((x) => x.evolvedDrawId === e.drawId)!;
    for (const a of roster.assays.filter((x) => x.genomeId === m.genomeId)) {
      res.set(a.cacheKey, { status: "scored", score: mean });
    }
  }
  for (
    const a of roster.assays.filter((x) => arm.get(x.genomeId) !== "mutant")
  ) {
    res.set(a.cacheKey, { status: "scored", score: 0 });
  }
  const r = run(res);
  assert.equal(r.selection.certifiedBlocks, 0);
  assert.ok(Math.abs(r.selection.effect.point!) < 1e-12);
  assert.match(r.selection.interpretation, /not met/);
  assert.ok(r.reconstruction.every((x) => !x.criterionMet));
});

Deno.test("a missing result widens bounds exactly and blocks both criteria", () => {
  const base = run(results(-0.5, 0.6));
  const res = results(-0.5, 0.6);
  const victim = roster.assays.find((a) => arm.get(a.genomeId) === "mutant")!;
  res.set(victim.cacheKey, null);
  const a = run(res);
  assert.deepEqual([a.technicalComplete, a.missingNewResults], [false, 1]);
  assert.ok(
    !a.selection.criterionMet && a.reconstruction.every((x) => !x.criterionMet),
  );
  const draw = roster.mutants.find((m) => m.genomeId === victim.genomeId)!;
  const seed =
    roster.evolved.find((e) => e.drawId === draw.evolvedDrawId)!.seed;
  const i = a.selection.blocks.findIndex((b) => b.seed === seed);
  // One of 16 scores, in one of 2 draws, in one of 4 founders: (1 - (-0.5)) / 16 / 2 / 4.
  const shift = 1.5 / 16 / 2 / 4;
  assert.ok(
    Math.abs(
      base.selection.blocks[i].lower - shift - a.selection.blocks[i].lower,
    ) < 1e-12,
  );
  assert.equal(a.selection.blocks[i].point, null);
});

Deno.test("both-extinct is unavailable, not technical missingness", () => {
  const res = results(-0.5, 0.6);
  const victim = roster.assays.find((a) => arm.get(a.genomeId) === "mutant")!;
  res.set(victim.cacheKey, { status: "both-extinct", score: null });
  const a = run(res);
  assert.ok(a.technicalComplete);
  assert.equal(a.missingNewResults, 0);
  assert.equal(a.selection.bootstrap.point95, null);
  assert.ok(a.selection.criterionMet);
});

Deno.test("an incomplete or mismatched replay blocks both criteria", () => {
  for (
    const replay of [{ expected: 8, matched: 7 }, { expected: 7, matched: 7 }]
  ) {
    const a = run(results(-0.5, 0.6), replay);
    assert.ok(!a.technicalComplete && !a.selection.criterionMet);
    assert.ok(a.reconstruction.every((r) => !r.criterionMet));
  }
});

Deno.test("certification requires a lower bound strictly above 0.10", () => {
  assert.ok(
    run(results(-0.5, 0.1001)).reconstruction.every((r) =>
      r.certifiedSeeds === 8
    ),
  );
  assert.ok(
    run(results(-0.5, 0.0999)).reconstruction.every((r) =>
      r.certifiedSeeds === 0
    ),
  );
});

Deno.test("duplicate cluster-139 genomes share one outcome", () => {
  const res = results(-0.5, 0.6);
  const r139 = roster.reconstructions.find((r) =>
    r.founderId === "discovery-cluster-139"
  )!;
  const dup = r139.perSeed.find((p, i) =>
    r139.perSeed.findIndex((q) => q.genomeId === p.genomeId) !== i
  )!;
  for (const a of roster.assays.filter((x) => x.genomeId === dup.genomeId)) {
    res.set(a.cacheKey, { status: "scored", score: 0.25 });
  }
  const r = run(res).reconstruction.find((x) =>
    x.founderId === "discovery-cluster-139"
  )!;
  assert.equal(r.distinctGenomes, 6);
  const shared = r.perSeed.filter((p) => p.genomeId === dup.genomeId);
  assert.ok(shared.length === 2 && shared.every((p) => p.point === 0.25));
});

// collect(): file-level validation over a small fake run.
function fake(request: Request): AssayResult {
  const cfg = discoveryCompetitionConfig(request.seed);
  return {
    format: "discovery-improvement-assay/v1",
    cacheKey: request.cacheKey,
    sourceManifestHash: manifest.sourceManifestHash,
    descendantHex: request.descendantHex,
    founderHex: request.founderHex,
    cfg,
    seed: request.seed,
    assignment: request.assignment,
    steps: 20000,
    initialStateHash: stateHash(
      discoveryCompetitionWorld(
        cfg,
        request.descendantHex,
        request.founderHex,
        request.assignment,
      ).state,
    ),
    finalStateHash: "0123456789abcdef",
    descendantMass: 30,
    ancestorMass: 90,
    unassociatedMass: 0,
    status: "scored",
    score: -0.5,
    elapsedSeconds: 1,
  };
}

Deno.test("collect re-validates results, provenance and replay records", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  try {
    const requests = requestsOf(roster).slice(0, 4);
    const replay = requestsOf(roster).slice(50, 52).map((request) => ({
      request,
      expected: fake(request),
    }));
    const identity = {
      candidateSha256: "c".repeat(64),
      releaseSha256: "r".repeat(64),
    };
    const out = join(dir, "out");
    let t = 0;
    await invocation({
      out,
      seconds: 3600,
      capSeconds: 1e4,
      maxInvocations: 5,
      minimumFreeBytes: 0,
      sourceManifestHash: manifest.sourceManifestHash,
      identity,
      replay,
      requests: requests.slice(0, 3),
      clock: () => t++,
      freeBytes: () => 1e15,
    }, (r) => Promise.resolve(fake(r)));
    const c = await collect(
      out,
      requests,
      replay,
      manifest.sourceManifestHash,
      identity,
    );
    assert.deepEqual(c.replay, { expected: 2, matched: 2 });
    assert.deepEqual(
      requests.map((r) => c.results.get(r.cacheKey)?.score ?? null),
      [-0.5, -0.5, -0.5, null],
    );
    await assert.rejects(
      () =>
        collect(out, requests, replay, manifest.sourceManifestHash, {
          ...identity,
          releaseSha256: "x".repeat(64),
        }),
      /provenance drift/,
    );
    const recPath = join(out, "replay", `${replay[0].request.cacheKey}.json`);
    const rec = JSON.parse(await Deno.readTextFile(recPath));
    await Deno.writeTextFile(
      recPath,
      JSON.stringify({ ...rec, matches: false }) + "\n",
    );
    await assert.rejects(
      () =>
        collect(out, requests, replay, manifest.sourceManifestHash, identity),
      /disagrees/,
    );
    await Deno.writeTextFile(join(out, "RUNNING"), "{}");
    await assert.rejects(
      () =>
        collect(out, requests, replay, manifest.sourceManifestHash, identity),
      /lock is active/,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("evolved-arm founder means reproduce the frozen report's effects", () => {
  const frozen = (report as unknown as {
    byTime: {
      time: number;
      byFounder: { founderId: string; conditionalEffect: number }[];
    }[];
  }).byTime.find((t) => t.time === 1_000_000)!.byFounder;
  const a = run(results(-0.5, 0.6));
  for (const f of frozen) {
    const mine = a.selection.byFounder.find((x) => x.founderId === f.founderId)!
      .evolved.point!;
    assert.ok(Math.abs(mine - f.conditionalEffect) < 1e-12, f.founderId);
  }
});
