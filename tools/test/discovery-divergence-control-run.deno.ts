// Run: deno test --no-lock -A tools/test/discovery-divergence-control-run.deno.ts
// Uses a fake executor; no GPU and no study competitions.
import assert from "node:assert/strict";
import { join } from "node:path";
import { stateHash } from "@bl/schema";
import { sha256 } from "../lib/founder-policy.ts";
import {
  type AssayResult,
  validateManifest,
} from "../lib/discovery-improvement-runtime.ts";
import {
  discoveryCompetitionConfig,
  discoveryCompetitionWorld,
} from "../lib/discovery-competition.ts";
import {
  buildRoster,
  type ImprovementReport,
} from "../lib/discovery-divergence-control.ts";
import { plan, REPORT_SHA256 } from "../discovery_divergence_control.ts";
import {
  candidate,
  invocation,
  type InvocationOptions,
  released,
  type Request,
  requestsOf,
  resolveStale,
  sameOutcome,
} from "../discovery_divergence_control_run.ts";

const STUDY = "experiments/founder-discovery/v1/improvement-study";
const REPORT = `${STUDY}/distribution-v1/analysis-v1/report.json`;
const MANIFEST = `${STUDY}/manifest.json`;
const PROTOCOL =
  "experiments/founder-discovery/v1/divergence-control-protocol.md";
const DC = "experiments/founder-discovery/v1/divergence-control";
const manifest = validateManifest(
  JSON.parse(await Deno.readTextFile(MANIFEST)),
);
const roster = buildRoster(
  JSON.parse(await Deno.readTextFile(REPORT)) as ImprovementReport,
  REPORT_SHA256,
  manifest,
);
const requests = requestsOf(roster);
const source = manifest.sourceManifestHash;

function fake(request: Request, descendantMass = 100): AssayResult {
  const cfg = discoveryCompetitionConfig(request.seed);
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
// Two replay requests stand in for the frozen evidence; their expected results come from the fake.
const replay = requests.slice(100, 102).map((request) => ({
  request,
  expected: fake(request),
}));
const main = requests.slice(0, 5);
const identity = {
  studyIdentitySha256: "s".repeat(64),
  candidateSha256: "c".repeat(64),
  releaseSha256: "r".repeat(64),
};

async function fixture(over: Partial<InvocationOptions> = {}) {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const now = { t: 0 };
  const o: InvocationOptions = {
    out: join(dir, "out"),
    seconds: 120,
    capSeconds: 10_000,
    maxInvocations: 20,
    minimumFreeBytes: 0,
    sourceManifestHash: source,
    identity,
    replay,
    requests: main,
    clock: () => now.t,
    freeBytes: () => 1e15,
    ...over,
  };
  return { dir, now, o };
}
const ticking = (now: { t: number }, step = 15) => (request: Request) => {
  now.t += step;
  return Promise.resolve(fake(request));
};
async function receipts(out: string) {
  const dir = join(out, "invocations"), all = [];
  for await (const e of Deno.readDir(dir)) {
    all.push({
      name: e.name,
      ...JSON.parse(await Deno.readTextFile(join(dir, e.name))),
    });
  }
  return all.sort((a, b) => a.name.localeCompare(b.name));
}
async function count(dir: string) {
  let n = 0;
  try {
    for await (const _ of Deno.readDir(dir)) n++;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return n;
}

Deno.test("replay outcome ignores only wall-clock time", () => {
  const a = fake(requests[0]);
  assert.ok(sameOutcome(a, { ...a, elapsedSeconds: 99 }));
  assert.ok(!sameOutcome(a, { ...a, finalStateHash: "fedcba9876543210" }));
});

Deno.test("invocations replay first, audit after new work, and resume to completion", async () => {
  const { o, dir, now } = await fixture();
  try {
    // 120 s with a 60 s margin and 15 s per competition: four starts per invocation.
    const first = await invocation(o, ticking(now));
    assert.deepEqual([first.replayed, first.newAssays, first.audited], [
      2,
      2,
      1,
    ]);
    let last = first;
    for (let i = 0; i < 5 && !last.complete; i++) {
      last = await invocation(o, ticking(now));
    }
    assert.ok(last.complete);
    const r = await receipts(o.out);
    assert.ok(r.every((x) => x.status === "settled" && x.env?.deno));
    assert.equal(r.reduce((a, x) => a + x.newAssays, 0), 5);
    assert.equal(await count(join(o.out, "assays")), 5);
    assert.equal(
      await count(join(o.out, "audit")),
      r.filter((x) => x.newAssays > 0).length,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a replay mismatch stops the study and blocks later invocations", async () => {
  const { o, dir, now } = await fixture();
  try {
    const wrong = (request: Request) => {
      now.t += 1;
      return Promise.resolve(fake(request, 101));
    };
    await assert.rejects(() => invocation(o, wrong), /replay mismatch/);
    const [r] = await receipts(o.out);
    assert.deepEqual([r.status, r.chargedSeconds], ["failed", 120]);
    await assert.rejects(
      () => invocation(o, ticking(now)),
      /mismatch recorded/,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a device that stops reproducing fails the end-of-invocation audit", async () => {
  const { o, dir, now } = await fixture({ seconds: 600 });
  try {
    let calls = 0;
    const drifting = (request: Request) => {
      now.t += 1;
      calls++;
      // Replays (2) and main work (5) are fine; the audit afterwards drifts.
      return Promise.resolve(fake(request, calls > 7 ? 101 : 100));
    };
    await assert.rejects(() => invocation(o, drifting), /audit mismatch/);
    await assert.rejects(
      () => invocation(o, ticking(now)),
      /audit mismatch recorded/,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("budget, reservation, lock, storage and stop guards refuse before reserving", async () => {
  const { o, dir, now } = await fixture({ capSeconds: 100 });
  try {
    await assert.rejects(() => invocation(o, ticking(now)), /budget exhausted/);
    await assert.rejects(
      () =>
        invocation({ ...o, capSeconds: 1e4, maxInvocations: 0 }, ticking(now)),
      /budget exhausted/,
    );
    await assert.rejects(
      () =>
        invocation({
          ...o,
          capSeconds: 1e4,
          freeBytes: () => 0,
          minimumFreeBytes: 1,
        }, ticking(now)),
      /storage floor/,
    );
    assert.equal(await count(join(o.out, "invocations")), 0);
    await assert.rejects(
      () => invocation({ ...o, capSeconds: 1e4, seconds: 601 }, ticking(now)),
      /out of range/,
    );
    await Deno.mkdir(join(o.out, "invocations"), { recursive: true });
    await Deno.writeTextFile(
      join(o.out, "invocations", "001-1.json"),
      JSON.stringify({ status: "reserved", chargedSeconds: 120 }),
    );
    await assert.rejects(
      () => invocation({ ...o, capSeconds: 1e4 }, ticking(now)),
      /unresolved invocation reservation/,
    );
    await Deno.remove(join(o.out, "invocations"), { recursive: true });
    await Deno.writeTextFile(join(o.out, "RUNNING"), "{}");
    await assert.rejects(
      () => invocation({ ...o, capSeconds: 1e4 }, ticking(now)),
      Deno.errors.AlreadyExists,
    );
    await Deno.remove(join(o.out, "RUNNING"));
    await Deno.writeTextFile(join(o.out, "STOPPED.json"), "{}");
    await assert.rejects(
      () => invocation({ ...o, capSeconds: 1e4 }, ticking(now)),
      /study stopped/,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a stale lock from a dead process is resolved with its full charge; a live one is not", async () => {
  const { o, dir } = await fixture();
  try {
    await Deno.mkdir(join(o.out, "invocations"), { recursive: true });
    const dead = 2_000_000_000;
    await Deno.writeTextFile(
      join(o.out, "RUNNING"),
      JSON.stringify({ pid: dead }),
    );
    await Deno.writeTextFile(
      join(o.out, "invocations", `001-${dead}.json`),
      JSON.stringify({ status: "reserved", chargedSeconds: 600 }),
    );
    await assert.rejects(() => resolveStale(o.out, " ", "test"), /reason/);
    const settled = await resolveStale(o.out, "killed during test", "test");
    assert.deepEqual(settled, [{
      name: `001-${dead}.json`,
      chargedSeconds: 600,
    }]);
    const [r] = await receipts(o.out);
    assert.deepEqual([r.status, r.chargedSeconds], ["failed", 600]);
    assert.equal(await count(join(o.out, "resolutions")), 1);
    await Deno.writeTextFile(
      join(o.out, "RUNNING"),
      JSON.stringify({ pid: Deno.pid }),
    );
    await assert.rejects(
      () => resolveStale(o.out, "should refuse", "test"),
      /still alive/,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("tampered or foreign cached results are refused on resume", async () => {
  const { o, dir, now } = await fixture({ seconds: 600 });
  try {
    assert.ok((await invocation(o, ticking(now, 1))).complete);
    const victim = join(o.out, "assays", `${main[0].cacheKey}.json`);
    const original = await Deno.readTextFile(victim);
    await Deno.writeTextFile(
      victim,
      original.replace('"elapsedSeconds":1', '"elapsedSeconds":2'),
    );
    await assert.rejects(
      () => invocation(o, ticking(now, 1)),
      /provenance drift/,
    );
    await Deno.writeTextFile(victim, original);
    await assert.rejects(
      () =>
        invocation({
          ...o,
          identity: { ...identity, studyIdentitySha256: "x".repeat(64) },
        }, ticking(now, 1)),
      /mismatch recorded|provenance drift/,
    );
    await Deno.writeTextFile(
      join(o.out, "assays", `${"f".repeat(64)}.json`),
      "{}",
    );
    await assert.rejects(
      () => invocation(o, ticking(now, 1)),
      /foreign assay cache entry/,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("candidate pins the exact roster and evidence; only a matching RELEASED file verifies", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  try {
    const rosterPath = join(dir, "roster.json"),
      candidatePath = join(dir, "candidate.json");
    const forecast = `${DC}/resource-forecast.json`,
      check = `${DC}/engineering-check.json`;
    await plan(REPORT, MANIFEST, rosterPath);
    await candidate(
      rosterPath,
      MANIFEST,
      REPORT,
      PROTOCOL,
      forecast,
      check,
      candidatePath,
      25_000,
      60,
    );
    const c = JSON.parse(await Deno.readTextFile(candidatePath));
    assert.deepEqual([
      c.status,
      c.authorizesGpu,
      Object.keys(c.replayExpected).length,
    ], ["PREPARED", false, 8]);
    assert.ok(Object.keys(c.executionSources).length >= 54 + 7);
    assert.ok(
      "tools/discovery_divergence_control_analyze.ts" in c.executionSources,
    );
    const release = (over = {}) => ({
      format: "discovery-divergence-control-release/v1",
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
    const r = await released(releasePath);
    assert.deepEqual([r.requests.length, r.replay.length], [1200, 8]);
    assert.equal(r.identity.studyIdentitySha256, c.studyIdentitySha256);
    await Deno.writeTextFile(
      releasePath,
      JSON.stringify(release({ status: "PREPARED" })),
    );
    await assert.rejects(() => released(releasePath), /not a RELEASED/);
    await Deno.writeTextFile(
      releasePath,
      JSON.stringify(release({ reviewedAt: "soon" })),
    );
    await assert.rejects(() => released(releasePath), /not a RELEASED/);
    await Deno.writeTextFile(
      releasePath,
      JSON.stringify(release({ candidateSha256: "0".repeat(64) })),
    );
    await assert.rejects(() => released(releasePath), /candidate hash drift/);
    await Deno.writeTextFile(releasePath, JSON.stringify(release()));
    await Deno.writeTextFile(
      rosterPath,
      (await Deno.readTextFile(rosterPath)) + " ",
    );
    await assert.rejects(() => released(releasePath), /pin drift/);
    await assert.rejects(
      () =>
        candidate(
          rosterPath,
          MANIFEST,
          REPORT,
          PROTOCOL,
          forecast,
          check,
          join(dir, "c2.json"),
          25_000,
          60,
        ),
      /exact output/,
    );
    const otherReport = join(dir, "report.json");
    await Deno.writeTextFile(
      otherReport,
      (await Deno.readTextFile(REPORT)) + "\n",
    );
    await assert.rejects(
      () =>
        candidate(
          rosterPath,
          MANIFEST,
          otherReport,
          PROTOCOL,
          forecast,
          check,
          join(dir, "c3.json"),
          25_000,
          60,
        ),
      /frozen report hash drift/,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
