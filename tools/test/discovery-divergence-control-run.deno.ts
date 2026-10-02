// Run: deno test --no-lock -A tools/test/discovery-divergence-control-run.deno.ts
// Uses a fake executor; no GPU and no study competitions.
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
  sameOutcome,
} from "../discovery_divergence_control_run.ts";

const STUDY = "experiments/founder-discovery/v1/improvement-study";
const REPORT = `${STUDY}/distribution-v1/analysis-v1/report.json`;
const MANIFEST = `${STUDY}/manifest.json`;
const PROTOCOL =
  "experiments/founder-discovery/v1/divergence-control-protocol.md";
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

async function fixture(
  over: Partial<InvocationOptions> = {},
): Promise<{ o: InvocationOptions; dir: string; now: { t: number } }> {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const now = { t: 0 };
  return {
    dir,
    now,
    o: {
      out: join(dir, "out"),
      seconds: 120,
      capSeconds: 10_000,
      maxInvocations: 20,
      minimumFreeBytes: 0,
      sourceManifestHash: source,
      identity: {
        candidateSha256: "c".repeat(64),
        releaseSha256: "r".repeat(64),
      },
      replay,
      requests: main,
      clock: () => now.t,
      freeBytes: () => 1e15,
      ...over,
    },
  };
}
const ticking = (now: { t: number }, step = 30) => (request: Request) => {
  now.t += step;
  return Promise.resolve(fake(request));
};
async function receipts(out: string) {
  const dir = join(out, "invocations"), all = [];
  for await (const e of Deno.readDir(dir)) {
    all.push(JSON.parse(await Deno.readTextFile(join(dir, e.name))));
  }
  return all.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

Deno.test("replays outcome ignores only wall-clock time", () => {
  const a = fake(requests[0]);
  assert.ok(sameOutcome(a, { ...a, elapsedSeconds: 99 }));
  assert.ok(!sameOutcome(a, { ...a, finalStateHash: "fedcba9876543210" }));
});

Deno.test("bounded invocations replay first, then resume to completion", async () => {
  const { o, dir, now } = await fixture();
  try {
    const first = await invocation(o, ticking(now)); // 60 s margin in 120 s: two competitions
    assert.deepEqual([first.replayed, first.newAssays, first.complete], [
      2,
      0,
      false,
    ]);
    let last = first;
    for (let i = 0; i < 5 && !last.complete; i++) {
      last = await invocation(o, ticking(now));
    }
    assert.ok(last.complete);
    const r = await receipts(o.out);
    assert.ok(r.every((x) => x.status === "settled"));
    assert.equal(r.reduce((a, x) => a + x.newAssays, 0), 5);
    let files = 0;
    for await (const _ of Deno.readDir(join(o.out, "assays"))) files++;
    assert.equal(files, 5);
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

Deno.test("budget, reservation and lock guards refuse to start", async () => {
  const { o, dir, now } = await fixture({ capSeconds: 100 });
  try {
    await assert.rejects(() => invocation(o, ticking(now)), /budget exhausted/);
    await assert.rejects(
      () =>
        invocation({ ...o, capSeconds: 1e4, maxInvocations: 0 }, ticking(now)),
      /budget exhausted/,
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
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("tampered or foreign cached results are refused on resume", async () => {
  const { o, dir, now } = await fixture({ seconds: 3600 });
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

Deno.test("storage floor fails the invocation with its full charge", async () => {
  const { o, dir, now } = await fixture({
    freeBytes: () => 0,
    minimumFreeBytes: 1,
  });
  try {
    await assert.rejects(() => invocation(o, ticking(now)), /storage floor/);
    const [r] = await receipts(o.out);
    assert.deepEqual([r.status, r.chargedSeconds], ["failed", 120]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("candidate pins the generator's exact roster; only a matching RELEASED file verifies", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  try {
    const rosterPath = join(dir, "roster.json"),
      candidatePath = join(dir, "candidate.json");
    await plan(REPORT, MANIFEST, rosterPath);
    await candidate(
      rosterPath,
      MANIFEST,
      REPORT,
      PROTOCOL,
      candidatePath,
      30_000,
      20,
    );
    const c = JSON.parse(await Deno.readTextFile(candidatePath));
    assert.deepEqual([
      c.status,
      c.authorizesGpu,
      Object.keys(c.replayExpected).length,
    ], ["PREPARED", false, 8]);
    assert.ok(Object.keys(c.executionSources).length >= 54 + 6);
    const sha = (await import("../lib/founder-policy.ts")).sha256(
      await Deno.readFile(candidatePath),
    );
    const release = (over = {}) => ({
      format: "discovery-divergence-control-release/v1",
      status: "RELEASED",
      candidatePath,
      candidateSha256: sha,
      reviewedBy: "test",
      reviewReference: "test",
      reviewedAt: "2026-10-02T00:00:00Z",
      ...over,
    });
    const releasePath = join(dir, "release.json");
    await Deno.writeTextFile(releasePath, JSON.stringify(release()));
    const r = await released(releasePath);
    assert.deepEqual([r.requests.length, r.replay.length], [1248, 8]);
    await Deno.writeTextFile(
      releasePath,
      JSON.stringify(release({ status: "PREPARED" })),
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
          join(dir, "c2.json"),
          30_000,
          20,
        ),
      /exact output/,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
