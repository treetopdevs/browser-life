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
const used = new Set(roster.evolved.flatMap((e) => e.observationIds));
const evolvedObservations = new Map<string, Outcome>(
  report.observations.filter((o) => used.has(o.id)).map((
    o,
  ) => [o.id, { status: "scored", score: o.score }]),
);
const genomeOf = new Map(roster.assays.map((a) => [a.cacheKey, a.genomeId]));
const arm = new Map(roster.genomes.map((g) => [g.id, g.arm]));
const allReplay = { expected: 8, matched: 8 };
const noAudits = { total: 3, matched: 3 };

/** Every mutant competition scores m, reconstruction r, specificity control c. */
function results(m: number, r: number, c = 0): Map<string, Outcome> {
  const by = { mutant: m, reconstruction: r, specificity: c };
  return new Map(
    roster.assays.map((
      a,
    ) => [a.cacheKey, {
      status: "scored",
      score: by[arm.get(genomeOf.get(a.cacheKey)!)!],
    }]),
  );
}
const run = (
  res: Map<string, Outcome>,
  replay = allReplay,
  audits = noAudits,
) =>
  analyzeDivergence({
    roster,
    evolvedObservations,
    results: res,
    replay,
    audits,
    bootstrapResamples: 500,
  });
const founder = (a: ReturnType<typeof run>, id: string) =>
  a.selection.find((f) => f.founderId === `discovery-cluster-${id}`)!;

Deno.test("harmful mutants and beneficial reconstructions: per-founder results and readings", () => {
  const a = run(results(-0.5, 0.6, 0));
  assert.ok(a.technicalComplete);
  assert.equal(a.confirmatoryTests, 6);
  assert.deepEqual(
    a.selection.map((f) => [f.founderId, f.certifiedSeeds, f.criterionMet]),
    [
      ["discovery-cluster-33", 8, true],
      ["discovery-cluster-4", 7, true],
      ["discovery-cluster-16", 8, true],
      ["discovery-cluster-139", 8, true],
    ],
  );
  assert.match(founder(a, "33").reading, /beyond divergence/);
  assert.match(founder(a, "16").reading, /purifying selection only/);
  for (const r of a.reconstruction) {
    assert.deepEqual([r.certifiedSeeds, r.criterionMet], [8, true]);
    assert.ok(
      Math.abs(
        r.recoveredShareOfEvolved! -
          0.6 / founder(a, r.founderId.split("-").at(-1)!).evolved.point!,
      ) < 1e-12,
    );
  }
  const [r33, r139] = a.reconstruction;
  assert.equal(r33.specificity!.seedsReconstructionAboveControl, 8);
  assert.ok(
    Math.abs(r33.specificity!.meanReconstructionMinusControl.point! - 0.6) <
      1e-12,
  );
  assert.equal(r139.specificity, null);
  const b = a.descriptive.bootstrap.point95!;
  assert.ok(
    b.lower <= a.descriptive.pooledEffect.point! &&
      a.descriptive.pooledEffect.point! <= b.upper,
  );
  assert.deepEqual(run(results(-0.5, 0.6, 0)), a);
});

Deno.test("mildly helpful mutants read as partly divergence; matching mutants leave no contrast", () => {
  assert.match(
    founder(run(results(0.2, 0.6)), "33").reading,
    /partly divergence/,
  );
  // A barely positive random-change score is noise, not "random change helps".
  assert.match(
    founder(run(results(0.05, 0.6)), "33").reading,
    /beyond divergence/,
  );
  const res = results(0, 0);
  for (const e of roster.evolved) {
    const mean = e.observationIds.reduce((s, id) =>
      s + evolvedObservations.get(id)!.score!, 0) / e.observationIds.length;
    for (
      const m of roster.mutants.filter((x) =>
        x.evolvedDrawId === e.drawId
      )
    ) {
      for (
        const a of roster.assays.filter((x) =>
          x.genomeId === m.genomeId
        )
      ) res.set(a.cacheKey, { status: "scored", score: mean });
    }
  }
  const a = run(res);
  assert.ok(
    a.selection.every((f) =>
      f.certifiedSeeds === 0 && !f.criterionMet && /^not met/.test(f.reading)
    ),
  );
  assert.ok(a.selection.every((f) => Math.abs(f.contrast.point!) < 1e-12));
});

Deno.test("a missing result widens bounds exactly and blocks every criterion", () => {
  const base = run(results(-0.5, 0.6));
  const res = results(-0.5, 0.6);
  const victim = roster.assays.find((a) => arm.get(a.genomeId) === "mutant")!;
  res.set(victim.cacheKey, null);
  const a = run(res);
  assert.deepEqual([a.technicalComplete, a.missingNewResults], [false, 1]);
  assert.ok(
    a.selection.every((f) =>
      !f.criterionMet && f.reading === "technically incomplete"
    ),
  );
  assert.ok(a.reconstruction.every((r) => !r.criterionMet));
  const m = roster.mutants.find((x) => x.genomeId === victim.genomeId)!;
  const e = roster.evolved.find((x) => x.drawId === m.evolvedDrawId)!;
  const unit = (x: ReturnType<typeof run>) =>
    x.units.find((u) => u.founderId === e.founderId && u.seed === e.seed)!;
  // One of 8 scores, in one of 2 mutants, in one of 2 draws: (1 - (-0.5)) / 8 / 2 / 2.
  assert.ok(
    Math.abs(unit(base).contrast.lower - 1.5 / 32 - unit(a).contrast.lower) <
      1e-12,
  );
  assert.equal(unit(a).contrast.point, null);
});

Deno.test("both-extinct is unavailable, not technical missingness", () => {
  const res = results(-0.5, 0.6);
  res.set(
    roster.assays.find((a) => arm.get(a.genomeId) === "mutant")!.cacheKey,
    { status: "both-extinct", score: null },
  );
  const a = run(res);
  assert.ok(a.technicalComplete);
  assert.equal(a.missingNewResults, 0);
  assert.equal(a.descriptive.bootstrap.point95, null);
  assert.ok(a.selection.every((f) => f.criterionMet));
});

Deno.test("an incomplete or mismatched replay, or a failed audit, blocks every criterion", () => {
  const cases: [
    { expected: number; matched: number },
    { total: number; matched: number },
  ][] = [
    [{ expected: 8, matched: 7 }, noAudits],
    [{ expected: 7, matched: 7 }, noAudits],
    [allReplay, { total: 3, matched: 2 }],
  ];
  for (const [replay, audits] of cases) {
    const a = run(results(-0.5, 0.6), replay, audits);
    assert.ok(
      !a.technicalComplete && a.selection.every((f) => !f.criterionMet) &&
        a.reconstruction.every((r) => !r.criterionMet),
    );
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

Deno.test("evolved-arm founder means reproduce the frozen report's effects", () => {
  const frozen = (report as unknown as {
    byTime: {
      time: number;
      byFounder: { founderId: string; conditionalEffect: number }[];
    }[];
  }).byTime.find((t) => t.time === 1_000_000)!.byFounder;
  const a = run(results(-0.5, 0.6));
  for (const f of frozen) {
    const mine = a.selection.find((x) => x.founderId === f.founderId)!.evolved
      .point!;
    assert.ok(Math.abs(mine - f.conditionalEffect) < 1e-12, f.founderId);
  }
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

Deno.test("collect re-validates output and refuses interim analysis", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  try {
    const requests = requestsOf(roster).slice(0, 4);
    const replay = requestsOf(roster).slice(50, 52).map((request) => ({
      request,
      expected: fake(request),
    }));
    const identity = {
      studyIdentitySha256: "s".repeat(64),
      candidateSha256: "c".repeat(64),
      releaseSha256: "r".repeat(64),
    };
    const out = join(dir, "out");
    let t = 0;
    await invocation({
      out,
      seconds: 600,
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
    const args = [out, requests, replay, manifest.sourceManifestHash] as const;
    await assert.rejects(
      () => collect(...args, identity),
      /not stopped; no interim analysis/,
    );
    await Deno.writeTextFile(join(out, "STOPPED.json"), "{}");
    const c = await collect(...args, identity);
    assert.deepEqual([c.replay, c.audits], [{ expected: 2, matched: 2 }, {
      total: 1,
      matched: 1,
    }]);
    assert.deepEqual(
      requests.map((r) => c.results.get(r.cacheKey)?.score ?? null),
      [-0.5, -0.5, -0.5, null],
    );
    await assert.rejects(
      () =>
        collect(...args, { ...identity, studyIdentitySha256: "x".repeat(64) }),
      /provenance drift/,
    );
    const recPath = join(out, "replay", `${replay[0].request.cacheKey}.json`);
    const rec = JSON.parse(await Deno.readTextFile(recPath));
    await Deno.writeTextFile(
      recPath,
      JSON.stringify({ ...rec, matches: false }) + "\n",
    );
    await assert.rejects(() => collect(...args, identity), /disagrees/);
    await Deno.writeTextFile(recPath, JSON.stringify(rec) + "\n");
    const auditPath = join(out, "audit", "001.json");
    const auditText = await Deno.readTextFile(auditPath);
    await Deno.remove(auditPath);
    assert.deepEqual((await collect(...args, identity)).audits, {
      total: 1,
      matched: 0,
    });
    await Deno.writeTextFile(auditPath, auditText);
    await Deno.writeTextFile(recPath, JSON.stringify(rec) + "\n");
    await Deno.writeTextFile(join(out, "replay", "notes.txt"), "x");
    await assert.rejects(() => collect(...args, identity), /foreign entry/);
    await Deno.remove(join(out, "replay", "notes.txt"));
    await Deno.writeTextFile(join(out, "RUNNING"), "{}");
    await assert.rejects(() => collect(...args, identity), /lock is active/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
