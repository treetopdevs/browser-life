/// <reference types="node" />
// Opt-in real Phoenix + cross-origin browser smoke; no GPU or scientific work.
// MIX_ENV=test mix deps.get (in apps/coordinator), then from the root:
// BL_ISLAND_BACKOFF_WIRE=1 BL_E2E_PORT=5272 pnpm exec playwright test tests/e2e/island-backoff-wire.spec.ts --project=chrome --workers=1
// Add BL_EXPECT_ISLAND_LEAVE=1 when validating the separate leave branch integrated with this slice.
import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const port = Number(process.env.BL_ISLAND_WIRE_PORT || 5273);
const coordinator = `http://127.0.0.1:${port}`;
const moduleURL = `/@fs/${root}packages/runner/src/island.ts`;
const expectLeave = process.env.BL_EXPECT_ISLAND_LEAVE === "1";
test.skip(process.env.BL_ISLAND_BACKOFF_WIRE !== "1", "opt-in: starts a scratch loopback Phoenix coordinator");
test.describe.configure({ mode: "serial" });

let child: ChildProcess | undefined;
let directory: string | undefined;
async function stop() {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const proc = child;
    const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
    proc.kill("SIGTERM");
    const guard = setTimeout(() => proc.kill("SIGKILL"), 3_000);
    await exited;
    clearTimeout(guard);
  }
  child = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
}
test.afterEach(stop);
test.beforeEach(async ({ context, baseURL }) => {
  // Chrome's separate local-network permission is needed for localhost ->
  // 127.0.0.1. This does not disable CORS or expose otherwise hidden headers.
  await context.grantPermissions(["local-network-access"], { origin: new URL(baseURL!).origin });
});

async function start(origin: string, capacity = false) {
  directory = await mkdtemp(join(tmpdir(), "bl-island-backoff-"));
  const script = join(directory, "server.exs");
  // Fixed scratch settings after runtime config; neither production config nor data is used.
  await writeFile(script, `
Application.put_env(:coordinator, :start_queue, true)
Application.put_env(:coordinator, :start_discovery, false)
Application.put_env(:coordinator, :data_dir, ${JSON.stringify(join(directory, "data"))})
Application.put_env(:coordinator, :cors_origins, [${JSON.stringify(origin)}])
Application.put_env(:coordinator, :island_joins_per_address, ${capacity ? "1000000" : "1"})
Application.put_env(:coordinator, :island_join_window_ms, 3000)
Application.put_env(:coordinator, :island_requests_per_address, nil)
Application.put_env(:coordinator, :max_islands, ${capacity ? "1" : "100"})
config = Application.fetch_env!(:coordinator, CoordinatorWeb.Endpoint)
Application.put_env(:coordinator, CoordinatorWeb.Endpoint, Keyword.merge(config, server: true, http: [ip: {127,0,0,1}, port: ${port}]))
{:ok, _} = Application.ensure_all_started(:coordinator)
${capacity ? '{:ok, _} = Coordinator.Queue.join(%{"adapter" => "capacity fixture"})' : `Process.sleep(3000 - rem(System.system_time(:millisecond), 3000) + 20)
:ok = Coordinator.IslandLimiter.take(:join, {127,0,0,1})`}
IO.puts("ISLAND_WIRE_READY")
Process.sleep(:infinity)
`);
  child = spawn("mix", ["run", "--no-start", script], { cwd: join(root, "apps/coordinator"), env: { ...process.env, MIX_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
  const proc = child;
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("scratch coordinator did not become ready within 60 seconds")), 60_000);
    proc.once("error", (error) => { clearTimeout(timer); reject(error); });
    proc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`scratch coordinator exited before ready (${code})`)); });
    proc.stdout!.on("data", (chunk) => {
      output = (output + chunk.toString()).slice(-2_000);
      if (output.includes("ISLAND_WIRE_READY")) { clearTimeout(timer); resolve(); }
    });
    // Drain both streams, without printing credentials, request bodies or persisted state.
    proc.stderr!.on("data", () => {});
  });
}

for (const cancel of [false, true]) {
  test(cancel ? "real marked refusal: cancellation during cooldown sends no retry" : "real CORS refusal: runIsland retries once without duplicate registration or GPU", async ({ page, baseURL }) => {
    await page.route("**/__wire.html", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Local island wire smoke</title>" }));
    await page.goto("/__wire.html");
    await page.evaluate(async (url) => { await import(/* @vite-ignore */ url); }, moduleURL);
    await start(new URL(baseURL!).origin);

    const result = await page.evaluate(async ({ coordinator, moduleURL, cancel }) => {
      const { runIsland } = await import(/* @vite-ignore */ moduleURL);
      const original = window.fetch.bind(window);
      const abort = new AbortController();
      const requests: { method: string; path: string; status: number; marker: string | null; retry: string | null; at: number }[] = [];
      let active = 0, peak = 0, joined = 0;
      const started = performance.now();
      window.fetch = async (input, init) => {
        active++; peak = Math.max(peak, active);
        try {
          const response = await original(input, init);
          const url = new URL(typeof input === "string" ? input : input instanceof Request ? input.url : input.href);
          if (url.origin === coordinator) requests.push({ method: init?.method ?? "GET", path: url.pathname, status: response.status, marker: response.headers.get("x-island-request-applied"), retry: response.headers.get("retry-after"), at: performance.now() - started });
          if (cancel && response.status === 429) setTimeout(() => abort.abort(), 50);
          return response;
        } finally { active--; }
      };
      try {
        const gpu = new Proxy({}, { get() { throw new Error("wire smoke must never access a GPU"); } });
        const done = await runIsland(gpu, { coordinator, host: { adapter: "wire smoke", host: "browser" }, maxTasks: 1, signal: abort.signal, onJoined: () => { joined++; } });
        return { done, joined, requests, peak, elapsed: performance.now() - started };
      } finally { window.fetch = original; }
    }, { coordinator, moduleURL, cancel });
    expect(result.done).toBe(0);
    expect(result.peak).toBe(1);
    const joins = result.requests.filter((r) => r.path === "/api/islands");
    expect(joins[0].status).toBe(429);
    expect(joins[0].marker).toBe("false");
    expect(Number(joins[0].retry)).toBeGreaterThan(0);
    expect(result.joined).toBe(cancel ? 0 : 1);
    expect(joins.map((r) => r.status)).toEqual(cancel ? [429] : [429, 200]);
    if (cancel) expect(result.elapsed).toBeLessThan(1_000);
    else expect(joins[1].at - joins[0].at).toBeGreaterThanOrEqual(Number(joins[0].retry) * 1_000 - 20);
    const status = await (await fetch(`${coordinator}/api/status`)).json();
    expect(status.islands).toHaveLength(cancel || expectLeave ? 0 : 1);
    expect(status.counts.assigned ?? 0).toBe(0);
    expect(result.requests.filter((r) => r.method === "DELETE")).toHaveLength(!cancel && expectLeave ? 1 : 0);
  });
}

test("real capacity 503 exposes Retry-After and the no-application marker to the browser", async ({ page, baseURL }) => {
  await page.route("**/__wire.html", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Local island wire smoke</title>" }));
  await page.goto("/__wire.html");
  await start(new URL(baseURL!).origin, true);
  const refusal = await page.evaluate(async (base) => {
    const response = await fetch(`${base}/api/islands`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return { status: response.status, marker: response.headers.get("x-island-request-applied"), retry: response.headers.get("retry-after") };
  }, coordinator);
  expect(refusal.status).toBe(503);
  expect(refusal.marker).toBe("false");
  expect(Number(refusal.retry)).toBeGreaterThan(0);
  const status = await (await fetch(`${coordinator}/api/status`)).json();
  expect(status.islands).toHaveLength(1);
});
