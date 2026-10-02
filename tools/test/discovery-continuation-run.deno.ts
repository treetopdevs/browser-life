// Run: deno test --no-lock -A tools/test/discovery-continuation-run.deno.ts
// Uses a fake executor; no GPU and no study competitions. Output goes to temp dirs.
import assert from "node:assert/strict";
import { join } from "node:path";
import { stateHash } from "@bl/schema";
import { sha256 } from "../lib/founder-policy.ts";
import { type AssayResult } from "../lib/discovery-improvement-runtime.ts";
import {
  discoveryCompetitionConfig,
  discoveryCompetitionWorld,
} from "../lib/discovery-competition.ts";
import { analyzeContinuation } from "../lib/discovery-continuation.ts";
import {
  invocation,
  type InvocationOptions,
  type Request,
} from "../discovery_divergence_control_run.ts";
import { collect } from "../discovery_divergence_control_analyze.ts";
import { candidate, released } from "../discovery_continuation_run.ts";
import { HISTORIES, plan } from "../discovery_continuation.ts";

const STUDY = "experiments/founder-discovery/v1/improvement-study";
const REPORT = `${STUDY}/distribution-v1/analysis-v1/report.json`;
const MANIFEST = `${STUDY}/manifest.json`;
const PROTOCOL = "experiments/founder-discovery/v1/continuation-protocol.md";
const CONT = "experiments/founder-discovery/v1/continuation";
const ROSTER = `${CONT}/roster.json`;
const ONLY = ["discovery-cluster-4-6410002-normal"];

function fake(request: Request, source: string, win: boolean): AssayResult {
  const cfg = discoveryCompetitionConfig(request.seed);
  const descendantMass = win ? 150 : 50;
  return {
    format: "discovery-improvement-assay/v1",
    cacheKey: request.cacheKey,
    sourceManifestHash: source,
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
    descendantMass,
    ancestorMass: 50,
    unassociatedMass: 0,
    status: "scored",
    score: (descendantMass - 50) / (descendantMass + 50),
    elapsedSeconds: 1,
  };
}

/**
 * A candidate that re-derived one history (to keep tests fast), and a release of it.
 * `complete` rewrites the candidate as if every history had been re-derived: a
 * test-only stand-in for the full re-derivation, which the CLI always performs.
 */
async function prepared(dir: string) {
  const forecast = join(dir, "forecast.json");
  await Deno.writeTextFile(
    forecast,
    JSON.stringify({ capSeconds: 30_000, maxInvocations: 70 }),
  );
  const candidatePath = join(dir, "candidate.json");
  await candidate(
    ROSTER,
    MANIFEST,
    REPORT,
    PROTOCOL,
    forecast,
    HISTORIES,
    candidatePath,
    30_000,
    70,
    ONLY,
  );
  const release = (over = {}) => ({
    format: "discovery-continuation-release/v1",
    status: "RELEASED",
    candidatePath,
    candidateSha256: sha256(Deno.readFileSync(candidatePath)),
    reviewedBy: "test",
    reviewReference: "test",
    reviewedAt: "2026-10-02T00:00:00Z",
    ...over,
  });
  const releasePath = join(dir, "release.json");
  await Deno.writeTextFile(releasePath, JSON.stringify(release()));
  const complete = async (edit = (_: Record<string, unknown>) => {}) => {
    const c = JSON.parse(await Deno.readTextFile(candidatePath));
    const roster = JSON.parse(await Deno.readTextFile(ROSTER));
    c.rederivedHistories = roster.histories.map((h: { unitId: string }) =>
      h.unitId
    );
    edit(c);
    await Deno.writeTextFile(candidatePath, JSON.stringify(c, null, 2) + "\n");
    await Deno.writeTextFile(releasePath, JSON.stringify(release()));
  };
  return { forecast, candidatePath, releasePath, release, complete };
}

Deno.test("plan refuses a drifted report and an existing roster before any work", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const drifted = join(dir, "report.json");
    await Deno.writeTextFile(drifted, (await Deno.readTextFile(REPORT)) + "\n");
    await assert.rejects(
      () => plan(drifted, MANIFEST, HISTORIES, join(dir, "a.json")),
      /report hash drift/,
    );
    const existing = join(dir, "exists.json");
    await Deno.writeTextFile(existing, "{}");
    await assert.rejects(
      () => plan(REPORT, MANIFEST, HISTORIES, existing),
      Deno.errors.AlreadyExists,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("candidate re-derives ancestry and the exact roster; only a fully re-derived, matching RELEASED file verifies", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  try {
    const { forecast, candidatePath, releasePath, release, complete } =
      await prepared(dir);
    const c = JSON.parse(await Deno.readTextFile(candidatePath));
    assert.deepEqual(
      [
        c.status,
        c.authorizesGpu,
        Object.keys(c.replayExpected).length,
        Object.keys(c.midpointReceipts).length,
        c.rederivedHistories,
      ],
      ["PREPARED", false, 8, 64, ONLY],
    );
    assert.ok("tools/discovery_divergence_control_run.ts" in c.executionSources);
    await assert.rejects(
      () => released(releasePath),
      /did not re-derive every history/,
    );
    await complete();
    const r = await released(releasePath);
    assert.equal(r.requests.length, r.roster.assays.length);
    assert.equal(r.replay.length, 8);
    assert.ok(
      r.requests.every((q, i) =>
        q.founderHex === r.roster.assays[i].ancestorHex
      ),
    );
    // A pinned midpoint receipt that no longer matches refuses.
    await complete((x) => {
      const pins = x.midpointReceipts as Record<string, string>;
      pins[Object.keys(pins)[0]] = "0".repeat(64);
    });
    await assert.rejects(() => released(releasePath), /midpoint receipt drift/);
    await complete();
    // A protocol amendment changes the candidate but not the study identity.
    const amended = join(dir, "protocol.md");
    await Deno.writeTextFile(
      amended,
      (await Deno.readTextFile(PROTOCOL)) + "\n## Amendment\n",
    );
    await candidate(
      ROSTER,
      MANIFEST,
      REPORT,
      amended,
      forecast,
      HISTORIES,
      join(dir, "c1.json"),
      30_000,
      70,
      ONLY,
    );
    assert.equal(
      JSON.parse(await Deno.readTextFile(join(dir, "c1.json")))
        .studyIdentitySha256,
      c.studyIdentitySha256,
    );
    await assert.rejects(
      () =>
        candidate(
          ROSTER,
          MANIFEST,
          REPORT,
          PROTOCOL,
          forecast,
          HISTORIES,
          join(dir, "c2.json"),
          25_000,
          70,
          ONLY,
        ),
      /differs from the pinned forecast/,
    );
    // A roster whose ancestry was altered does not re-derive.
    const roster = JSON.parse(await Deno.readTextFile(ROSTER));
    const a = roster.ancestors.find((x: { unitId: string }) =>
      x.unitId === ONLY[0]
    );
    a.generations += 1;
    const tampered = join(dir, "roster.json");
    await Deno.writeTextFile(tampered, JSON.stringify(roster, null, 2) + "\n");
    await assert.rejects(
      () =>
        candidate(
          tampered,
          MANIFEST,
          REPORT,
          PROTOCOL,
          forecast,
          HISTORIES,
          join(dir, "c3.json"),
          30_000,
          70,
          ONLY,
        ),
      /does not re-derive|exact output/,
    );
    for (
      const [over, pattern] of [
        [{ status: "PREPARED" }, /not a RELEASED/],
        [{ format: "discovery-divergence-control-release/v1" }, /not a RELEASED/],
        [{ reviewedAt: "soon" }, /not a RELEASED/],
        [{ candidateSha256: "0".repeat(64) }, /candidate hash drift/],
      ] as const
    ) {
      await Deno.writeTextFile(releasePath, JSON.stringify(release(over)));
      await assert.rejects(() => released(releasePath), pattern);
    }
    const copy = JSON.parse(await Deno.readTextFile(candidatePath));
    copy.host.outputRel = "runs/founder-discovery-divergence-control-v1";
    const other = join(dir, "other.json");
    await Deno.writeTextFile(other, JSON.stringify(copy, null, 2) + "\n");
    await Deno.writeTextFile(
      releasePath,
      JSON.stringify(
        release({
          candidatePath: other,
          candidateSha256: sha256(Deno.readFileSync(other)),
        }),
      ),
    );
    await assert.rejects(() => released(releasePath), /format drift/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("released requests run through the shared core, replays first, to a complete analysis", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  try {
    const { releasePath, complete } = await prepared(dir);
    await complete();
    const r = await released(releasePath);
    const source = r.manifest.sourceManifestHash;
    const replayByKey = new Map(r.replay.map((x) => [x.request.cacheKey, x]));
    const lateKeys = new Set(
      r.roster.genomes.filter((g) => g.arm === "late").flatMap((g) =>
        g.cacheKeys
      ),
    );
    const order: string[] = [];
    const now = { t: 0 };
    const execute = (q: Request) => {
      now.t += 1;
      order.push(q.cacheKey);
      const rep = replayByKey.get(q.cacheKey);
      return Promise.resolve(
        rep ? rep.expected : fake(q, source, lateKeys.has(q.cacheKey)),
      );
    };
    const out = join(dir, "out");
    const o: InvocationOptions = {
      out,
      seconds: 600,
      capSeconds: 30_000,
      maxInvocations: 70,
      minimumFreeBytes: 0,
      sourceManifestHash: source,
      identity: r.identity,
      replay: r.replay,
      requests: r.requests,
      clock: () => now.t,
      freeBytes: () => 1e15,
    };
    for (let i = 0; i < 10; i++) {
      const res = await invocation(o, execute);
      if (res.complete) break;
    }
    assert.deepEqual(order.slice(0, 8), r.replay.map((x) => x.request.cacheKey));
    const got = await collect(out, r.requests, r.replay, source, r.identity);
    assert.deepEqual(got.replay, { expected: 8, matched: 8 });
    assert.equal(got.audits.matched, got.audits.total);
    const a = analyzeContinuation({
      roster: r.roster,
      ...got,
      bootstrapResamples: 200,
    });
    assert.equal(a.technicalComplete, true);
    assert.ok(a.continuation.every((c) =>
      c.criterionMet && c.reading.startsWith("met, continued beyond divergence")
    ));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
