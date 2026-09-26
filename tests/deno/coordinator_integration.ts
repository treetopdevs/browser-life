// HTTP-level integration test: unlike gpu_golden.ts (GPU-vs-CPU physics only)
// and segments.ts (in-process runner calls, no HTTP), this drives a *real*
// Coordinator.Queue over a *real* HTTP server (a `mix phx.server` subprocess
// against a scratch --data-dir) through packages/runner/src/island.ts's
// actual wire protocol: /next -> checkpoint PUT -> /complete, including a
// mandatory final-segment verification and, deliberately, a corrupted
// verify report — checking the content-addressed store's on-disk layout and
// the diverged/blocked cascade this produces.
//
// Run from the repo root: deno run -A tests/deno/coordinator_integration.ts < /dev/null
import { requestDevice } from "@bl/sim-gpu";
import { runIsland } from "@bl/runner";

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
