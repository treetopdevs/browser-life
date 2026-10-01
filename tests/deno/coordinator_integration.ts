// HTTP-level integration test: unlike gpu_golden.ts (GPU-vs-CPU physics only)
// and segments.ts (in-process runner calls, no HTTP), this drives a *real*
// Coordinator.Queue over a *real* HTTP server (a `mix phx.server` subprocess
// against a scratch --data-dir) through packages/runner/src/island.ts's
// actual wire protocol: /next -> checkpoint PUT -> /complete, across two
// experiments -- one with verifyFraction 1.0, deliberately fed a corrupted
// verify report to check the content-addressed store's on-disk layout and
// the diverged/blocked cascade this produces; the other with verifyFraction
// 0 to isolate and confirm mandatory final-segment verification on its own
// (the first experiment's fractional verification alone can't tell a broken
// "only verify the sampled fraction, never the last segment on its own"
// implementation from a correct one). A last, ponds-small experiment checks
// capability gating over the wire (pond work only for an island that
// advertises "ponds-v1") and that its stitched bundles equal single
// tools/run.ts runs, ponds.tsv included.
//
// Run from the repo root: deno run -A tests/deno/coordinator_integration.ts < /dev/null
import { requestDevice } from "@bl/sim-gpu";
import { METRICS_VERSION } from "@bl/schema";
import { BUNDLE_FILES, OBSERVATION_FILES, observationDigests, PONDS_FILE, runExperiment, runIsland, VERIFIED_FILES, type RunSpec, type Sink, type Task } from "@bl/runner";

const root = Deno.cwd();
const coordinatorDir = `${root}/apps/coordinator`;
const port = 41099;
const base = `http://127.0.0.1:${port}`;
const dataDir = await Deno.makeTempDir({ prefix: "bl-coordinator-it-" });
const host = { host: "test", adapter: "test" };

let ok = true;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!cond) ok = false;
};

function spawnServer() {
  return new Deno.Command("mix", {
    args: ["phx.server"],
    cwd: coordinatorDir,
    env: { ...Deno.env.toObject(), MIX_ENV: "dev", PORT: String(port), BL_DATA_DIR: dataDir },
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
}

let server = spawnServer();

// Waits for the server to accept connections (first boot may still be compiling).
async function waitReady(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/status`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("coordinator did not become ready in time");
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, init);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

try {
  await waitReady(30_000);

  const spec = {
    experiment: "it",
    presetId: "spots",
    conditions: ["treatment"],
    seeds: [1],
    steps: 20,
    segmentSteps: 5,
    censusEvery: 5,
    verifyFraction: 1.0,
  };
  const created = await call<{ segments: number }>("/api/experiments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec),
  });
  check("creates the 4-segment experiment", created.segments === 4, JSON.stringify(created));

  const device = await requestDevice(navigator.gpu);

  // Island "a" produces segments 0, 1 and 2 (never offered a verify task: it
  // is always the sole done-but-unverified segment's own producer at the
  // point it asks for the next task).
  const producedByA = await runIsland(device, { coordinator: base, host, maxTasks: 3, idleMs: 200 });
  check("island a completes 3 run tasks", producedByA === 3, String(producedByA));

  // Island "b" verifies segments 0 and 1 honestly, and deliberately stops
  // short of segment 2 so the next step can corrupt that one by hand.
  const verifiedByB = await runIsland(device, { coordinator: base, host, maxTasks: 2, idleMs: 200 });
  check("island b completes 2 verify tasks", verifiedByB === 2, String(verifiedByB));

  const mid = await call<{ runs: { done: number; verified: number; diverged: number; blocked: number }[] }>("/api/status");
  const run = mid.runs[0];
  check("segments 0 and 1 are verified before the corruption", run?.verified === 2, JSON.stringify(run));

  // runIsland (packages/runner/src/island.ts) reports each observation file's
  // SHA-256 for a verify attempt; the coordinator compares them against the
  // accepted run attempt's own recorded digests (Coordinator.Segment.
  // complete_verify/5) and exposes the result per segment.
  const expIt = await call<{ segments: { index: number; observationsVerified: boolean | null }[] }>("/api/experiments/it");
  const obsSeg0 = expIt.segments.find((s) => s.index === 0);
  const obsSeg1 = expIt.segments.find((s) => s.index === 1);
  check(
    "an honest verify attempt's reported observation digests match the accepted upload's, and the listing shows observationsVerified true",
    obsSeg0?.observationsVerified === true && obsSeg1?.observationsVerified === true,
    JSON.stringify({ obsSeg0, obsSeg1 }),
  );

  // Manufacture a diverged verify by hand (a real, honest replay can never
  // disagree with itself; the coordinator's own reject/divergence path is
  // otherwise untestable from outside a corrupted or buggy island). The same
  // fabricated completion also reports observation digests that don't match
  // the accepted upload's, standing in for a tampered upload being detected
  // (a real tampered upload would fail the same way: whatever the accepted
  // attempt actually recorded for these six names, a verifier's honestly
  // recomputed digests for the *real* file content would differ from a
  // *tampered* one, exactly as these fabricated ones differ from the real
  // recorded digests here).
  const joined = await call<{ id: string; token: string }>("/api/islands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Declares the current metrics version like a real (non-corrupt)
    // island would, so metrics-version gating doesn't stand in for the
    // digest corruption this island is here to test.
    body: JSON.stringify({ adapter: "corrupt", metricsVersion: METRICS_VERSION }),
  });
  const q = (extra = "") => `island=${encodeURIComponent(joined.id)}${extra}`;
  const authed = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${joined.token}` } });
  const task = await call<{ kind: string; lease: string; segment: { id: string; index: number } }>(`/api/next?${q()}`, authed({ method: "POST" }));
  check("the corrupt island is offered segment 2's verify task", task.kind === "verify" && task.segment.index === 2, JSON.stringify(task));

  const fakeDigest = (b: string) => b.repeat(64);
  const tamperedObservations = Object.fromEntries(
    ["series.jsonl", "lineages.tsv", "mutations.tsv", "heredity.tsv", "life.jsonl", "activity-final.json"].map((f, i) => [f, fakeDigest(String(i))]),
  );
  const completed = await call<{ status: string }>(`/api/segments/${task.segment.id}/complete?${q()}`, authed({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "verify", lease: task.lease, endHash: "0000000000000000", observationDigests: tamperedObservations }),
  }));
  check("the corrupted report diverges", completed.status === "diverged", JSON.stringify(completed));

  const statusAfterCorruption = await call<{ observationMismatches: { segment: string; run: string; index: number; producer: string; verifier: string }[] }>("/api/status");
  const obsMismatch = statusAfterCorruption.observationMismatches.find((m) => m.index === 2);
  check(
    "a tampered/fabricated observation report is exposed as an observation mismatch in /api/status",
    obsMismatch !== undefined && obsMismatch.segment === task.segment.id,
    JSON.stringify(statusAfterCorruption.observationMismatches),
  );

  const final = await call<{ runs: { done: number; verified: number; diverged: number; blocked: number }[] }>("/api/status");
  const finalRun = final.runs[0];
  check(
    "divergence blocks the run's remaining segment without touching the verified predecessors",
    finalRun?.verified === 2 && finalRun?.diverged === 1 && finalRun?.blocked === 1,
    JSON.stringify(finalRun),
  );

  // Restart against the SAME --data-dir in a genuinely fresh OS process (not
  // just a fresh GenServer in the same warm BEAM VM, the way `mix test`'s
  // own restart test runs) — the only way to catch a state.bin that
  // `:erlang.binary_to_term(_, [:safe])` refuses to load because some
  // module defining one of its attempts' atoms (`:uploaded_digest`,
  // `:heartbeat_at`, ...) hasn't been loaded yet on a cold boot.
  server.kill("SIGTERM");
  await server.status;
  server = spawnServer();
  await waitReady(30_000);
  const afterRestart = await call<{ runs: { verified: number; diverged: number; blocked: number }[] }>("/api/status");
  const restartedRun = afterRestart.runs[0];
  check(
    "state.bin (with in-flight/terminal attempts) survives a restart in a fresh OS process",
    restartedRun?.verified === 2 && restartedRun?.diverged === 1 && restartedRun?.blocked === 1,
    JSON.stringify(restartedRun),
  );

  // The store layout: one object per accepted run attempt's artifact
  // (segments 0, 1, 2 all ran; segment 3 never did), each under its digest's
  // own two-character fan-out directory, content-addressed rather than
  // segment-id-keyed.
  const objects: string[] = [];
  for await (const fanout of Deno.readDir(`${dataDir}/objects`)) {
    for await (const file of Deno.readDir(`${dataDir}/objects/${fanout.name}`)) objects.push(file.name);
  }
  check("the content-addressed store holds exactly the 3 run attempts' artifacts", objects.length === 3, objects.join(", "));

  // Review 1 finding #11: the scenario above sets `verifyFraction: 1.0`, so
  // *every* segment is verify-eligible -- it never actually exercises
  // "mandatory final-segment verification" specifically, since a broken
  // implementation of that rule (e.g. one that only ever verified a sampled
  // fraction, never the last segment on its own) would still pass. A
  // second, `verifyFraction: 0` experiment isolates that rule: no segment
  // should ever offer a verify task except the run's actual last one.
  const created2 = await call<{ segments: number }>("/api/experiments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...spec, experiment: "it-final-only", verifyFraction: 0 }),
  });
  check("creates the second, verifyFraction:0 experiment", created2.segments === 4, JSON.stringify(created2));

  // One island runs every segment of this experiment back to back; with
  // verifyFraction 0, none of the first 3 (non-last) segments should ever be
  // offered as a verify task to interrupt that sequence.
  const producedByC = await runIsland(device, { coordinator: base, host, maxTasks: 4, idleMs: 200 });
  check("a single island completes all 4 run tasks uninterrupted (no fractional verify offered)", producedByC === 4, String(producedByC));

  // A different island's very next task must be the final segment's verify
  // -- not idle, and not a run task (there is nothing left to run).
  const logD: string[] = [];
  const verifiedByD = await runIsland(device, { coordinator: base, host, maxTasks: 1, idleMs: 200, log: (m) => logD.push(m) });
  const dTask = logD.find((m) => /^(run|verify) /.test(m)) ?? "";
  check(
    "a second island is given exactly the final segment's verify task",
    verifiedByD === 1 && /^verify it-final-only\/\S+ #3 /.test(dTask),
    `${verifiedByD}: ${dTask}`,
  );
  const afterD = await runIsland(device, { coordinator: base, host, maxTasks: 1, idleMs: 200 });
  check("no further verification is offered for the run", afterD === 0, String(afterD));

  const afterFinal = await call<{ runs: { run: string; segments: number; verified: number; diverged: number; blocked: number }[] }>("/api/status");
  const finalOnlyRun = afterFinal.runs.find((r) => r.run.startsWith("it-final-only/"));
  check(
    "only the last segment is verified; the run has no divergence or blocking",
    finalOnlyRun?.segments === 4 && finalOnlyRun?.verified === 1 && finalOnlyRun?.diverged === 0 && finalOnlyRun?.blocked === 0,
    JSON.stringify(finalOnlyRun),
  );

  // tools/stitch.ts over the real HTTP export must rebuild exactly the bundle
  // a continuous run of the same spec writes.
  const outDir = `${dataDir}/stitched`;
  const stitchCli = (experiment: string) =>
    new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "tools/stitch.ts", "--coordinator", base, "--experiment", experiment, "--out", outDir],
      stdin: "null",
    }).output();
  const stitch = await stitchCli("it-final-only");
  const runDir = `${outDir}/it-final-only/spots/treatment/seed-1`;
  check("stitch.ts exports the verified run", stitch.success, new TextDecoder().decode(stitch.stderr).slice(0, 300));
  const stitchedManifest = JSON.parse(await Deno.readTextFile(`${runDir}/manifest.json`));
  const mem = new Map<string, string>();
  const sink: Sink = {
    async writeText(f, t) { mem.set(f, t); },
    async appendText(f, t) { mem.set(f, (mem.get(f) ?? "") + t); },
    async writeBytes() {},
  };
  await runExperiment(device, stitchedManifest.spec as RunSpec, sink, host, () => {});
  const differing: string[] = [];
  for (const f of BUNDLE_FILES) if (f !== "manifest.json" && (await Deno.readTextFile(`${runDir}/${f}`)) !== mem.get(f)) differing.push(f);
  check(
    "the stitched bundle equals a continuous run's",
    differing.length === 0 && stitchedManifest.summary.finalHash === JSON.parse(mem.get("manifest.json")!).summary.finalHash,
    differing.join(", "),
  );

  const stdout = (o: Deno.CommandOutput) => new TextDecoder().decode(o.stdout);
  const again = await stitchCli("it-final-only");
  check("re-exporting an unchanged history keeps the bundle", again.success && stdout(again).includes("0 written, 1 already present"), stdout(again).slice(-200));
  await Deno.remove(`${runDir}/life.jsonl`);
  const repaired = await stitchCli("it-final-only");
  const aside = [...Deno.readDirSync(`${outDir}/it-final-only/spots/treatment`)].map((e) => e.name).sort();
  check(
    "an incomplete bundle is moved aside and re-exported",
    repaired.success && stdout(repaired).includes("1 written") && aside.length === 2 && aside[0] === "seed-1" && aside[1].startsWith("seed-1.stale-"),
    aside.join(", "),
  );
  // The diverged run ("it") is not exportable: a bundle already sitting in
  // its place (say, from an earlier --allow-unverified export) is moved out
  // of analyze.ts's input layout.
  const stale = `${outDir}/it/spots/treatment/seed-1`;
  await Deno.mkdir(stale, { recursive: true });
  await Deno.writeTextFile(`${stale}/manifest.json`, "{}");
  const diverged = await stitchCli("it");
  check(
    "a no-longer-exportable run's old bundle is moved aside",
    diverged.success && stdout(diverged).includes("0 written") && !(await Deno.stat(stale).catch(() => null)),
    stdout(diverged).slice(-200),
  );

  // Review 4: an existing export missing migrations.tsv (exactly what an
  // older exporter that only ever fetched BUNDLE_FILES -- review 1's bug --
  // would leave behind) must be detected as incomplete and rebuilt, not kept
  // because its fingerprint (accepted digests only, not which files ended up
  // on disk) still matches. "archipelago" is the only preset with migration
  // configured; one segment (steps == segmentSteps) keeps this cheap.
  const migSpec = {
    experiment: "it-migration",
    presetId: "archipelago",
    conditions: ["treatment"],
    seeds: [1],
    steps: 200,
    segmentSteps: 200,
    censusEvery: 20,
    verifyFraction: 1.0,
  };
  const createdMig = await call<{ segments: number }>("/api/experiments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(migSpec),
  });
  check("creates the single-segment archipelago experiment", createdMig.segments === 1, JSON.stringify(createdMig));
  const producedByE = await runIsland(device, { coordinator: base, host, maxTasks: 1, idleMs: 200 });
  check("island e produces the archipelago run's only segment", producedByE === 1, String(producedByE));
  const verifiedByF = await runIsland(device, { coordinator: base, host, maxTasks: 1, idleMs: 200 });
  check("island f verifies it (a different island than produced it)", verifiedByF === 1, String(verifiedByF));

  const migRunDir = `${outDir}/it-migration/archipelago/treatment/seed-1`;
  const migStitch = await stitchCli("it-migration");
  check(
    "stitch.ts exports the archipelago run, migrations.tsv included",
    migStitch.success && !!(await Deno.stat(`${migRunDir}/migrations.tsv`).catch(() => null)),
    stdout(migStitch).slice(-200),
  );

  // Simulate an export an older, review-1-buggy exporter left behind: every
  // BUNDLE_FILES file present (so the old, narrower `existing()` check would
  // have called it complete) but migrations.tsv missing.
  await Deno.remove(`${migRunDir}/migrations.tsv`);
  const migRepaired = await stitchCli("it-migration");
  check(
    "an export missing migrations.tsv is rebuilt, even though every BUNDLE_FILES file is present and its fingerprint still matches",
    migRepaired.success && stdout(migRepaired).includes("1 written") && !!(await Deno.stat(`${migRunDir}/migrations.tsv`).catch(() => null)),
    stdout(migRepaired).slice(-200),
  );

  // Metrics-version gating (Coordinator.Queue's moduledoc): a fresh
  // experiment requires this build's current metrics version by default. An
  // island that never declares one at join (mimicking code from before the
  // concept existed) must be idle for it, while a real `runIsland` (which
  // declares the current METRICS_VERSION) is offered and completes it
  // normally -- exercised over the real HTTP wire, not just Coordinator.Queue
  // directly (see the ExUnit coverage in queue_test.exs for the rest: idling
  // only for the mismatched experiment and not globally, and complete_run
  // rejecting/accepting based on the *uploaded manifest's* metrics version).
  const gatedSpec = { ...spec, experiment: "it-metrics-gate", steps: 5, segmentSteps: 5 };
  const createdGated = await call<{ segments: number }>("/api/experiments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(gatedSpec),
  });
  check("creates the metrics-version-gated experiment", createdGated.segments === 1, JSON.stringify(createdGated));

  const oldIsland = await call<{ id: string; token: string }>("/api/islands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adapter: "old-no-metrics-version" }),
  });
  const oldQ = (extra = "") => `island=${encodeURIComponent(oldIsland.id)}${extra}`;
  const oldAuthed = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${oldIsland.token}` } });
  const oldTask = await call<{ kind: string }>(`/api/next?${oldQ()}`, oldAuthed({ method: "POST" }));
  check("an island that never declares a metrics version is idle for the fresh, current-version experiment", oldTask.kind === "idle", JSON.stringify(oldTask));

  const producedGated = await runIsland(device, { coordinator: base, host, maxTasks: 1, idleMs: 200 });
  check("a current-version island (real runIsland) is offered and completes the gated experiment's one segment", producedGated === 1, String(producedGated));

  // Capability gating (Coordinator.Queue's moduledoc): a pond experiment's
  // segments, run or verify, go only to an island whose /next carries
  // "ponds-v1" (runIsland's ISLAND_CAPABILITIES). Created last, so no earlier
  // runIsland call above can pick up its work and change those task counts.
  const pondSpec = {
    experiment: "it-ponds",
    presetId: "ponds-small",
    conditions: ["treatment", "pond-cont"],
    seeds: [1],
    steps: 4000,
    segmentSteps: 2000,
    censusEvery: 100,
    verifyFraction: 1.0,
  };
  const createdPonds = await call<{ segments: number }>("/api/experiments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pondSpec),
  });
  check("creates the ponds-small experiment (2 runs of 2 segments)", createdPonds.segments === 4, JSON.stringify(createdPonds));

  // An island built before the pond cycle: it declares the current metrics
  // version (so metrics-version gating doesn't stand in for the capability),
  // but its /next carries no "ponds-v1".
  const noCap = await call<{ id: string; token: string }>("/api/islands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adapter: "no-ponds-capability", metricsVersion: METRICS_VERSION }),
  });
  const noCapQ = `island=${encodeURIComponent(noCap.id)}`;
  const noCapAuthed = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${noCap.token}` } });
  const noCapNext = (body?: unknown) =>
    call<Task>(
      `/api/next?${noCapQ}`,
      noCapAuthed(body === undefined ? { method: "POST" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );

  // The metrics-gated experiment's one segment, just produced above with
  // verifyFraction 1.0, still waits for its verify: non-pond work, which must
  // still flow to this island. It replays it honestly in-process, as a real
  // island would (one segment: no start checkpoint), so nothing is left leased.
  const nonPond = await noCapNext();
  check(
    "an island without the ponds-v1 capability is still offered non-pond work (the metrics-gated segment's verify)",
    nonPond.kind === "verify" && nonPond.segment?.run.startsWith("it-metrics-gate/") === true,
    JSON.stringify(nonPond.segment ?? nonPond),
  );
  if (nonPond.kind === "verify" && nonPond.segment && nonPond.spec) {
    const replay = new Map<string, string>();
    const replaySink: Sink = {
      async writeText(f, t) { replay.set(f, t); },
      async appendText(f, t) { replay.set(f, (replay.get(f) ?? "") + t); },
      async writeBytes() {},
    };
    const replayed = await runExperiment(device, nonPond.spec, replaySink, host, () => {});
    const nonPondDone = await call<{ status: string }>(`/api/segments/${nonPond.segment.id}/complete?${noCapQ}`, noCapAuthed({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "verify", lease: nonPond.lease, endHash: replayed.summary.finalHash, summary: replayed.summary, observationDigests: await observationDigests(replay) }),
    }));
    check("its honest replay verifies that segment", nonPondDone.status === "verified", JSON.stringify(nonPondDone));
  }

  // Only the pond experiment's run tasks are left; ApiController.next/2 reads
  // a missing, empty or malformed capability list as none.
  for (const [what, body] of [["no body", undefined], ["an empty list", { capabilities: [] }], ["a malformed value", { capabilities: "ponds-v1" }]] as const) {
    const t = await noCapNext(body);
    check(`an island whose /next carries ${what} is idle while pond run tasks are waiting`, t.kind === "idle", JSON.stringify(t.segment ?? t));
  }

  // runIsland advertises "ponds-v1". One island runs both runs' segments
  // (never offered its own segments' verifies), a second verifies all four.
  const producedPonds = await runIsland(device, { coordinator: base, host, maxTasks: 4, idleMs: 200 });
  check("a capable island (real runIsland) runs all 4 pond segments", producedPonds === 4, String(producedPonds));
  const idleForVerify = await noCapNext();
  check("an island without the capability is idle while pond verify tasks are waiting", idleForVerify.kind === "idle", JSON.stringify(idleForVerify.segment ?? idleForVerify));
  const verifiedPonds = await runIsland(device, { coordinator: base, host, maxTasks: 4, idleMs: 200 });
  check("a second capable island verifies all 4 pond segments", verifiedPonds === 4, String(verifiedPonds));

  const pondStatus = await call<{ runs: { run: string; segments: number; verified: number; diverged: number; blocked: number }[] }>("/api/status");
  const pondRuns = pondStatus.runs.filter((r) => r.run.startsWith("it-ponds/"));
  check(
    "both pond runs are fully verified, with no divergence or blocking",
    pondRuns.length === 2 && pondRuns.every((r) => r.segments === 2 && r.verified === 2 && r.diverged === 0 && r.blocked === 0),
    JSON.stringify(pondRuns),
  );
  const expPonds = await call<{ segments: { run: string; index: number; files: Record<string, string> | null; observationsVerified: boolean | null }[] }>("/api/experiments/it-ponds");
  check(
    "every pond segment uploaded ponds.tsv, and its verifier's observation digests (ponds.tsv among them) matched",
    expPonds.segments.length === 4 && expPonds.segments.every((s) => typeof s.files?.[PONDS_FILE] === "string" && s.observationsVerified === true),
    JSON.stringify(expPonds.segments.map((s) => ({ run: s.run, index: s.index, ponds: s.files?.[PONDS_FILE] ?? null, observationsVerified: s.observationsVerified }))),
  );

  // The stitched bundles must equal single, unsegmented tools/run.ts runs of
  // the same preset, conditions, seed and steps (--deep 10 and --checkpoint 0
  // are the coordinator's task spec: Queue's default deepEvery, and no
  // checkpoints): finalHash and every verified file byte for byte.
  const pondStitch = await stitchCli("it-ponds");
  check("stitch.ts exports both pond runs", pondStitch.success && stdout(pondStitch).includes("2 written"), stdout(pondStitch).slice(-200));
  const singleOut = `${dataDir}/single`;
  const single = await new Deno.Command(Deno.execPath(), {
    args: [
      "run", "-A", "tools/run.ts", "--experiment", "it-ponds", "--preset", "ponds-small", "--conditions", pondSpec.conditions.join(","),
      "--seeds", "1", "--steps", String(pondSpec.steps), "--census", String(pondSpec.censusEvery), "--deep", "10", "--checkpoint", "0", "--out", singleOut,
    ],
    stdin: "null",
  }).output();
  check("tools/run.ts runs both pond conditions unsegmented", single.success, new TextDecoder().decode(single.stderr).slice(0, 300));
  const readOr = (p: string) => Deno.readTextFile(p).catch(() => undefined);
  for (const condition of pondSpec.conditions) {
    const stitchedDir = `${outDir}/it-ponds/ponds-small/${condition}/seed-1`;
    const singleDir = `${singleOut}/it-ponds/ponds-small/${condition}/seed-1`;
    // Equal, or absent from both: only a pond run's other optional files
    // (migrations.tsv, exchanges.tsv, species.tsv) may be absent.
    const differing: string[] = [];
    const missing: string[] = [];
    for (const f of VERIFIED_FILES) {
      const text = await readOr(`${stitchedDir}/${f}`);
      if (text !== (await readOr(`${singleDir}/${f}`))) differing.push(f);
      if (text === undefined && (f === PONDS_FILE || (OBSERVATION_FILES as readonly string[]).includes(f))) missing.push(f);
    }
    const pondRows = ((await readOr(`${stitchedDir}/${PONDS_FILE}`)) ?? "").split("\n").filter(Boolean).length - 1;
    const finalHash = async (dir: string) => JSON.parse((await readOr(`${dir}/manifest.json`)) ?? "{}").summary?.finalHash as string | undefined;
    const [stitchedHash, singleHash] = [await finalHash(stitchedDir), await finalHash(singleDir)];
    check(
      `the stitched ${condition} bundle equals the single tools/run.ts run's: finalHash and every verified file, ponds.tsv included`,
      differing.length === 0 && missing.length === 0 && pondRows > 0 && stitchedHash !== undefined && stitchedHash === singleHash,
      `differing [${differing.join(", ")}], missing [${missing.join(", ")}], ${pondRows} ponds.tsv rows, finalHash ${stitchedHash} vs ${singleHash}`,
    );
  }
} finally {
  try {
    server.kill("SIGTERM");
  } catch {
    // already exited
  }
  await server.status;
  await Deno.remove(dataDir, { recursive: true }).catch(() => {});
}

Deno.exit(ok ? 0 : 1);
