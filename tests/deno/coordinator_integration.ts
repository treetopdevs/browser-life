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
// implementation from a correct one).
//
// Run from the repo root: deno run -A tests/deno/coordinator_integration.ts < /dev/null
import { requestDevice } from "@bl/sim-gpu";
import { BUNDLE_FILES, runExperiment, runIsland, type RunSpec, type Sink } from "@bl/runner";

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

  // Manufacture a diverged verify by hand (a real, honest replay can never
  // disagree with itself; the coordinator's own reject/divergence path is
  // otherwise untestable from outside a corrupted or buggy island).
  const joined = await call<{ id: string; token: string }>("/api/islands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adapter: "corrupt" }),
  });
  const q = (extra = "") => `island=${encodeURIComponent(joined.id)}${extra}`;
  const authed = (init: RequestInit = {}): RequestInit => ({ ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${joined.token}` } });
  const task = await call<{ kind: string; lease: string; segment: { id: string; index: number } }>(`/api/next?${q()}`, authed({ method: "POST" }));
  check("the corrupt island is offered segment 2's verify task", task.kind === "verify" && task.segment.index === 2, JSON.stringify(task));

  const completed = await call<{ status: string }>(`/api/segments/${task.segment.id}/complete?${q()}`, authed({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "verify", lease: task.lease, endHash: "0000000000000000" }),
  }));
  check("the corrupted report diverges", completed.status === "diverged", JSON.stringify(completed));

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
