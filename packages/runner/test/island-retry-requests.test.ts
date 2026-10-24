import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initWorld, PRESETS } from "@bl/schema";
import { runIsland } from "../src/island.ts";
import { runExperiment, specConfig, type RunResult, type RunSpec } from "../src/runner.ts";
import { InterventionError } from "../src/interventions.ts";

vi.mock("../src/runner.ts", async (original) => ({ ...await original<typeof import("../src/runner.ts")>(), runExperiment: vi.fn() }));
const run = vi.mocked(runExperiment);
const spec: RunSpec = { experiment: "retry", presetId: "spots", condition: "treatment", seed: 1, steps: 1, censusEvery: 1, deepEvery: 1, checkpointEvery: 0, overrides: { tileW: 32, tileH: 32, kernelRadius: 4 } };
const final = initWorld(specConfig(spec), PRESETS.find((preset) => preset.id === "spots")!.init);
const result = { final, summary: { finalHash: "0123456789abcdef" } } as RunResult;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const refused = (status = 429) => json({ error: "busy" }, status, { "x-island-request-applied": "false", "retry-after": "1" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
interface Seen { key: string; url: string; init: RequestInit; at: number }
function setup(target: string, options: { status?: number; stop?: AbortController; mode?: "reject" | "fail"; answer?: () => Promise<Response> } = {}) {
  const seen: Seen[] = [];
  let gaveTask = false;
  let refusedOnce = false;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    seen.push({ key, url, init, at: Date.now() });
    if (key === target && !refusedOnce) {
      refusedOnce = true;
      if (options.answer) return options.answer();
      options.stop?.abort("stop during refusal");
      return refused(options.status);
    }
    if (key === "DELETE /api/islands/isl") return new Response(null, { status: 204 });
    if (key === "POST /api/islands") return json({ id: "isl", token: "secret" });
    if (key === "POST /api/next") {
      if (gaveTask) return json({ kind: "idle" });
      gaveTask = true;
      return json({ kind: "run", lease: "lease-1", segment: { id: "seg", run: "r", index: 0, startStep: 0, steps: 1 }, spec, ...(options.mode === "reject" ? { startFrom: "previous" } : {}) });
    }
    if (key === "GET /api/segments/previous/start") return new Response(new Uint8Array(4));
    if (key.endsWith("/complete")) return json({ status: "done" });
    return json({ ok: true });
  });
  if (options.mode === "fail") run.mockRejectedValue(new InterventionError("refused schedule"));
  return seen;
}
const paths = [
  "POST /api/islands", "POST /api/next", "GET /api/segments/previous/start", "PUT /api/segments/seg/checkpoint",
  "PUT /api/segments/seg/files/series.jsonl", "POST /api/segments/seg/complete", "POST /api/segments/seg/reject", "POST /api/segments/seg/fail",
];
function modeFor(path: string) { return path.includes("previous") || path.endsWith("reject") ? "reject" as const : path.endsWith("fail") ? "fail" as const : undefined; }
const start = (signal?: AbortSignal, extra = {}) => runIsland({} as GPUDevice, { coordinator: "http://coord", host: { host: "test", adapter: "test" }, maxTasks: 1, signal, ...extra });

describe("runIsland retries complete HTTP requests without redoing work", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
    run.mockReset();
    run.mockImplementation(async (_device, _spec, sink) => { await sink.writeText("series.jsonl", "retained bytes"); return result; });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each(paths)("retries %s retaining body, authorization, URL and lease", async (path) => {
    const mode = modeFor(path);
    const seen = setup(path, { mode, status: 503 });
    const promise = start();
    await vi.runAllTimersAsync();
    expect(await promise).toBe(mode ? 0 : 1);
    const attempts = seen.filter((request) => request.key === path);
    expect(attempts).toHaveLength(2);
    expect(attempts[1].at - attempts[0].at).toBeGreaterThanOrEqual(1_000);
    expect(attempts[1].url).toBe(attempts[0].url);
    expect(attempts[1].init.body).toBe(attempts[0].init.body);
    expect(attempts[1].init.headers).toEqual(attempts[0].init.headers);
    if (path !== "POST /api/islands") expect(new Headers(attempts[1].init.headers).get("authorization")).toBe("Bearer secret");
    if (/complete|reject|fail/.test(path)) {
      expect(JSON.parse(String(attempts[1].init.body)).lease).toBe("lease-1");
      expect(attempts[1].init.signal).toBeUndefined();
    }
    expect(run).toHaveBeenCalledTimes(mode === "reject" ? 0 : 1);
    expect(seen.at(-1)?.key).toBe("DELETE /api/islands/isl");
    expect(seen.filter((request) => request.key.startsWith("DELETE"))).toHaveLength(1);
  });

  it.each(paths)("Stop after refused %s prevents another attempt", async (path) => {
    const stop = new AbortController();
    const seen = setup(path, { mode: modeFor(path), stop });
    const promise = start(stop.signal);
    await vi.runAllTimersAsync();
    expect(await promise).toBe(0);
    expect(seen.filter((request) => request.key === path)).toHaveLength(1);
    const at = seen.findIndex((request) => request.key === path);
    expect(seen.slice(at + 1).map((request) => request.key)).toEqual(path === "POST /api/islands" ? [] : ["DELETE /api/islands/isl"]);
    if (path !== "POST /api/islands") expect(seen.at(-1)?.at).toBe(seen[at].at); // leave bypasses the still-active retry cooldown
  });

  it.each(paths)("Stop during the %s backoff wait wakes immediately", async (path) => {
    const stop = new AbortController();
    const seen = setup(path, { mode: modeFor(path) });
    const promise = start(stop.signal);
    await vi.advanceTimersByTimeAsync(500);
    expect(seen.filter((request) => request.key === path)).toHaveLength(1);
    stop.abort("stop while sleeping");
    await vi.advanceTimersByTimeAsync(0);
    expect(await promise).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(seen.filter((request) => request.key === path)).toHaveLength(1);
  });

  it.each(["transport", "unmarked503", "body"])("does not replay a terminal decision after ambiguous %s failure", async (failure) => {
    const error = new Error("lost reply");
    const seen = setup("POST /api/segments/seg/complete", { answer: async () => {
      if (failure === "transport") throw error;
      if (failure === "unmarked503") return json({}, 503);
      return new Response("broken-json", { headers: { "content-type": "application/json" } });
    } });
    const caught = start().catch((reason) => reason);
    await vi.runAllTimersAsync();
    expect(await caught).toBeInstanceOf(Error);
    expect(seen.filter((request) => request.key.endsWith("/complete"))).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("Stop cancels a terminal decision's retry wait but not its already-sent response", async () => {
    const stop = new AbortController(); const held = deferred<Response>();
    const seen = setup("POST /api/segments/seg/complete", { answer: () => held.promise });
    const promise = start(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.at(-1)?.key).toBe("POST /api/segments/seg/complete");
    stop.abort();
    expect(seen.at(-1)?.init.signal).toBeUndefined();
    held.resolve(refused());
    await vi.runAllTimersAsync();
    expect(await promise).toBe(0);
    expect(seen.filter((request) => request.key.endsWith("/complete"))).toHaveLength(1);
  });

  it("cancels heartbeat retry at task teardown and shares its cooldown with uploads", async () => {
    const local = deferred<RunResult>(); run.mockReturnValue(local.promise);
    const seen = setup("POST /api/segments/seg/heartbeat");
    const promise = start(undefined, { heartbeatMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(seen.filter((request) => request.key.endsWith("heartbeat"))).toHaveLength(1);
    local.resolve(result);
    await vi.advanceTimersByTimeAsync(999);
    expect(seen.some((request) => request.key.startsWith("PUT"))).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(await promise).toBe(1);
    const count = seen.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(seen).toHaveLength(count);
    const beats = seen.filter((request) => request.key.endsWith("heartbeat"));
    expect(beats).toHaveLength(2);
    expect(beats[1].url).toBe(beats[0].url);
    expect(beats[1].init.body).toBe(beats[0].init.body);
    expect(beats[1].init.headers).toEqual(beats[0].init.headers);
  });

  it("does not overlap heartbeat attempts while one response is held", async () => {
    const local = deferred<RunResult>(); const held = deferred<Response>();
    run.mockReturnValue(local.promise);
    const stop = new AbortController();
    const seen = setup("POST /api/segments/seg/heartbeat", { answer: () => held.promise });
    const promise = start(stop.signal, { heartbeatMs: 10 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(seen.filter((request) => request.key.endsWith("heartbeat"))).toHaveLength(1);
    stop.abort(); held.resolve(refused()); local.resolve(result);
    await vi.runAllTimersAsync();
    expect(await promise).toBe(0);
    expect(seen.filter((request) => request.key.endsWith("heartbeat"))).toHaveLength(1);
  });
});
