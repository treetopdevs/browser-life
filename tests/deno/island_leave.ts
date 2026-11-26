// Real loopback HTTP leave smoke; no GPU or simulation time is needed.
// From the repository root: deno run --no-lock -A tests/deno/island_leave.ts
// Requires the coordinator's Mix dependencies. All server state is temporary.
import { METRICS_VERSION } from "@bl/schema";
import { runIsland } from "@bl/runner";
import { noLockDenoBin } from "./lib/no_lock_deno.ts";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const scratch = await Deno.makeTempDir({ prefix: "island-leave-http-" });
const root = decodeURIComponent(new URL("../../", import.meta.url).pathname);
const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
const port = (listener.addr as Deno.NetAddr).port;
listener.close();
const base = `http://127.0.0.1:${port}`;
const admin = crypto.randomUUID();
let server: Deno.ChildProcess | undefined;
let exited = false;
let drained: Promise<unknown> | undefined;
let serverLog = "";
async function drain(stream: ReadableStream<Uint8Array>) {
  for await (const chunk of stream.pipeThrough(new TextDecoderStream())) {
    serverLog = (serverLog + chunk).slice(-16_000);
  }
}
async function request(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(3_000),
    redirect: "error",
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const leavePath = (id: string) => `/api/islands/${encodeURIComponent(id)}?island=${encodeURIComponent(id)}`;

try {
  const denoBin = await noLockDenoBin(`${scratch}/bin`);
  server = new Deno.Command("mix", {
    args: ["phx.server"],
    cwd: `${root}apps/coordinator`,
    clearEnv: true,
    env: {
      ...Object.fromEntries(Object.entries(Deno.env.toObject()).filter(([name]) => !name.startsWith("BL_"))),
      PATH: `${denoBin}:${Deno.env.get("PATH") ?? ""}`,
      MIX_ENV: "dev", PORT: String(port), BL_ADMIN_TOKEN: admin,
      BL_DATA_DIR: `${scratch}/queue`, BL_DISCOVERY_DATA_DIR: `${scratch}/discovery`,
      BL_GARDEN_SCHEDULING: "off",
    },
    stdin: "null", stdout: "piped", stderr: "piped",
  }).spawn();
  drained = Promise.all([drain(server.stdout), drain(server.stderr)]);
  void server.status.then(() => { exited = true; });
  const deadline = Date.now() + 180_000;
  let ready = false;
  while (!exited && Date.now() < deadline) {
    try {
      if ((await request("GET", "/api/status", undefined, admin)).status === 200) {
        ready = true;
        break;
      }
    } catch { /* The listener may not yet exist while Mix starts. */ }
    await sleep(200);
  }
  check(ready, exited ? "coordinator exited during startup" : "coordinator startup exceeded 180 seconds");
  const created = await request("POST", "/api/experiments", {
    experiment: "leave-smoke", presetId: "spots", conditions: ["treatment"], seeds: [1],
    steps: 500, segmentSteps: 500, censusEvery: 100, verifyFraction: 1,
  }, admin);
  check([200, 201].includes(created.status), `create experiment: HTTP ${created.status}`);
  const joined = await request("POST", "/api/islands", { adapter: "http-smoke-a", metricsVersion: METRICS_VERSION });
  check(joined.status === 200, `join A: HTTP ${joined.status}`);
  const a = joined.body as { id: string; token: string };
  const first = await request("POST", `/api/next?island=${a.id}`, {}, a.token);
  check(first.status === 200 && first.body.kind === "run", "A did not receive a run task");
  check((await request("DELETE", leavePath(a.id), undefined, "wrong-token")).status === 401, "wrong token could leave A");

  // A already owns a real lease. Abort when runIsland accepts this identity,
  // before its task loop; finally must perform real HTTP cleanup. The proxy
  // makes accidental GPU use fail immediately rather than silently simulate.
  const noGpu = new Proxy({}, { get() { throw new Error("this smoke must never use a GPU"); } }) as GPUDevice;
  const stop = new AbortController();
  const messages: string[] = [];
  const count = await runIsland(noGpu, {
    coordinator: base, host: { host: "http-smoke", adapter: "no-gpu" },
    identity: a, maxTasks: 0, signal: stop.signal,
    onJoined: () => stop.abort(), log: (message) => messages.push(message),
  });
  check(count === 0, "no-GPU cleanup changed task count");
  check(messages.includes("left island: registration removed and unfinished work released"), "runIsland did not confirm leave");
  check((await request("DELETE", leavePath(a.id), undefined, a.token)).status === 204, "duplicate leave was not idempotent");
  check((await request("GET", `/api/islands/me?island=${a.id}`, undefined, a.token)).status === 401, "departed identity still authenticates");
  const joinedB = await request("POST", "/api/islands", { adapter: "http-smoke-b", metricsVersion: METRICS_VERSION });
  check(joinedB.status === 200, `join B: HTTP ${joinedB.status}`);
  const b = joinedB.body as { id: string; token: string };
  const second = await request("POST", `/api/next?island=${b.id}`, {}, b.token);
  check(second.status === 200 && second.body.kind === "run", "released task was not immediately available");
  check(second.body.segment.id === first.body.segment.id, "B received a different segment");
  check(second.body.lease !== first.body.lease, "reassignment reused the old lease");
  check((await request("DELETE", leavePath(b.id), undefined, b.token)).status === 204, "B failed to leave");
  const status = await request("GET", "/api/status", undefined, admin);
  check(status.status === 200 && status.body.islands.length === 0, "active island rows remain after leave");
  console.log("PASS real HTTP: runIsland cleanup, wrong-token rejection, duplicate 204, immediate new-lease reassignment, zero active rows (no GPU)");
} catch (error) {
  console.error(serverLog);
  throw error;
} finally {
  if (server) {
    if (!exited) {
      try { server.kill("SIGTERM"); } catch { /* Already exited. */ }
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([server.status, new Promise<void>((resolve) => { timer = setTimeout(resolve, 5_000); })]);
      clearTimeout(timer);
      if (!exited) {
        try { server.kill("SIGKILL"); } catch { /* Already exited. */ }
      }
    }
    await server.status; // Reap only the child this smoke started.
    await drained;
  }
  await Deno.remove(scratch, { recursive: true });
}
