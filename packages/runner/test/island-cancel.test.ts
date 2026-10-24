// Island cancellation (IslandOptions.signal, RunOptions.signal; docs/island-cancel-2026-10-18.md) against a fake
// coordinator (a `fetch` stub that records every call, honours `init.signal` the way a real fetch does, and can hold any
// request open) and a RefSim-backed stand-in for GpuSim (the mock below, after interventions.test.ts's), so a run is
// real physics on a small world and an abort can land inside a census chunk's GPU work. What each phase's abort must do:
// no task request after it changes the coordinator's record (PUT, reject, fail, complete, heartbeat), a complete
// already sent stands, the run stops at its next chunk boundary with its simulation destroyed, and runIsland resolves
// with the tasks completed instead of rejecting, after a bounded leave releases its registration.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type WorldState } from "@bl/schema";
import { GpuSim } from "@bl/sim-gpu";
import { runExperiment, runIsland, type RunSpec, type Sink } from "@bl/runner";

vi.mock("@bl/sim-gpu", async () => {
  const { RefSim } = await import("@bl/sim-ref");
  const { cellCount, cloneState, totalsOf, G, applyFeed } = await import("@bl/schema");
  class FakeGpuSim {
    static last: FakeGpuSim | null = null;
    static created = 0;
    /** Called after every `run`, with the step reached: lets a test abort inside a chunk's GPU work. */
    static onRun: ((step: number) => void) | null = null;
    /** Called inside every census snapshot readback and the final readState: lets a test abort during the readbacks. */
    static onSnapshot: ((step: number) => void) | null = null;
    static onReadState: ((step: number) => void) | null = null;
    readonly calls: string[] = [];
    destroyed = false;
    private ref: InstanceType<typeof RefSim>;
    private pending: { childHi: number; childLo: number; parentHi: number; parentLo: number }[] = [];
    private constructor(state: WorldState) {
      this.ref = new RefSim(state);
    }
    static async create(device: GPUDevice, state: WorldState) {
      (device as unknown as { createBuffer(): void }).createBuffer();
      FakeGpuSim.created++;
      return (FakeGpuSim.last = new FakeGpuSim(cloneState(state)));
    }
    get cfg() { return this.ref.cfg; }
    get step() { return this.ref.state.step; }
    run(count: number) {
      this.calls.push(`run ${count}`);
      this.pending.push(...this.ref.run(count));
      FakeGpuSim.onRun?.(this.ref.state.step);
    }
    async feed(x: number, y: number, r: number, amount: number) {
      this.calls.push(`feed ${x},${y},${r},${amount}`);
      return applyFeed(this.ref.state, x, y, r, amount);
    }
    async drainLedger() {
      this.calls.push("drain");
      const events = this.pending;
      this.pending = [];
      const s = this.ref.state;
      return { step: s.step, lightIn: s.lightIn, heatOut: s.heatOut, events, dropped: 0 };
    }
    async readSnapshot(withRoles = false) {
      this.calls.push("snapshot");
      FakeGpuSim.onSnapshot?.(this.ref.state.step);
      const s = this.ref.state, n = cellCount(s.cfg);
      return { step: s.step, cells: s.cells.slice(), genomeHead: s.genome.slice(0, (G.PARAM1 + 1) * n), roles: withRoles ? this.ref.roles.slice() : undefined, flux: s.flux.slice() };
    }
    async readStats() {
      this.calls.push("stats");
      const s = this.ref.state, t = totalsOf(s.cfg, s.cells);
      return { step: s.step, A: t.A, B: t.B, C: t.C, P: t.P, E: t.E, S: t.S, living: 0, dense: 0, lightIn: s.lightIn, heatOut: s.heatOut, flux: s.flux.slice() };
    }
    async readState() {
      this.calls.push("readState");
      FakeGpuSim.onReadState?.(this.ref.state.step);
      return cloneState(this.ref.state);
    }
    async readGenomeChannels(first: number, count: number) {
      const s = this.ref.state, n = cellCount(s.cfg);
      return s.genome.slice(first * n, (first + count) * n);
    }
    upload(state: WorldState) {
      this.calls.push("upload");
      this.ref = new RefSim(cloneState(state));
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { GpuSim: FakeGpuSim };
});

type Fake = { calls: string[]; destroyed: boolean; step: number };
type Hook = ((step: number) => void) | null;
const Sim = GpuSim as unknown as { last: Fake | null; created: number; onRun: Hook; onSnapshot: Hook; onReadState: Hook };

const device = { createBuffer() {}, queue: { onSubmittedWorkDone: async () => {} } } as unknown as GPUDevice;
const host = { host: "test", adapter: "test" };
/** A 32 x 32 spots world (kernel radius 4): four census chunks of 10 steps, each one `run(10)`. */
const spec: RunSpec = { experiment: "cancel", presetId: "spots", condition: "treatment", seed: 1, steps: 40, censusEvery: 10, deepEvery: 100, checkpointEvery: 0, overrides: { tileW: 32, tileH: 32, kernelRadius: 4 } };
const task = (over: Record<string, unknown> = {}) => ({ kind: "run", lease: "L", segment: { id: "seg-1", run: "r", index: 1, startStep: 0, steps: 40 }, spec, startFrom: null, startHash: null, ...over });

const abortError = () => new DOMException("This operation was aborted", "AbortError");
/** What a real fetch rejects with on abort: the signal's reason (an AbortError DOMException unless one was given). */
const reasonOf = (signal: AbortSignal) => signal.reason ?? abortError();
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

interface Call {
  key: string;
  signal?: AbortSignal;
  /** The call's signal had aborted by the time its answer was due (or it was aborted while held). */
  aborted: boolean;
}

/** A fake coordinator behind a stubbed `fetch`: one run task, then idle. `hold(key)` holds the next call to `key`
 * ("POST /api/next", "PUT /api/segments/seg-1/checkpoint", ...) until released or its signal aborts. */
function coordinator(opts: { task?: object; start?: Uint8Array; before?: (key: string) => void; freshAbort?: boolean } = {}) {
  // `freshAbort`: reject an aborted request with a new AbortError, not the signal's reason, as some engines do.
  const abortWith = (signal: AbortSignal) => (opts.freshAbort ? abortError() : reasonOf(signal));
  const calls: Call[] = [];
  const completeBodies: Record<string, unknown>[] = [];
  const holds = new Map<string, { arrived: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> }>();
  let served = false;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    const signal = init.signal ?? undefined;
    const call: Call = { key, signal, aborted: false };
    calls.push(call);
    if (signal?.aborted) {
      call.aborted = true;
      throw abortWith(signal);
    }
    const h = holds.get(key);
    if (h) {
      holds.delete(key);
      h.arrived.resolve();
      await new Promise<void>((resolve, reject) => {
        void h.release.promise.then(() => resolve());
        signal?.addEventListener(
          "abort",
          () => {
            call.aborted = true;
            reject(abortWith(signal!));
          },
          { once: true },
        );
      });
    }
    opts.before?.(key);
    if (key === "DELETE /api/islands/isl") {
      expect(new URL(url).searchParams.get("island")).toBe("isl");
      expect(init.headers).toEqual({ authorization: "Bearer tok" });
      expect(init.redirect).toBe("error");
      return new Response(null, { status: 204 });
    }
    if (key === "POST /api/islands") return json({ id: "isl", token: "tok" });
    if (key === "POST /api/next") {
      if (served || !opts.task) return json({ kind: "idle" });
      served = true;
      return json(opts.task);
    }
    if (key === "GET /api/segments/seg-0/start") return new Response((opts.start ?? new Uint8Array(4)).slice(), { headers: { "content-type": "application/octet-stream" } });
    if (key === "POST /api/segments/seg-1/complete") {
      completeBodies.push(JSON.parse(String(init.body)));
      return json({ status: "done" });
    }
    if (/^(POST|PUT) \/api\/segments\/seg-1\//.test(key)) return json({ ok: true });
    throw new Error(`unexpected ${key}`);
  });
  return {
    calls,
    completeBodies,
    // Existing phase assertions concern task traffic; lifecycle assertions use calls directly.
    keys: () => calls.filter((c) => !c.key.endsWith("/heartbeat") && !c.key.startsWith("DELETE ")).map((c) => c.key),
    hold(key: string) {
      const h = { arrived: deferred(), release: deferred() };
      holds.set(key, h);
      return { arrived: h.arrived.promise, release: () => h.release.resolve() };
    },
  };
}

function island(signal: AbortSignal, extra: Partial<Parameters<typeof runIsland>[1]> = {}) {
  const logged: string[] = [];
  const onJoined = vi.fn();
  const run = runIsland(device, { coordinator: "http://coord", host, log: (m) => logged.push(m), idleMs: 5, signal, onJoined, ...extra });
  return { run, logged, onJoined };
}

const writes = /^(PUT|POST) \/api\/segments\/seg-1\/(checkpoint|files|complete|reject|fail)/;

describe("runIsland stops when its signal aborts", () => {
  beforeEach(() => {
    Sim.last = null;
    Sim.onRun = Sim.onSnapshot = Sim.onReadState = null;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Sim.onRun = Sim.onSnapshot = Sim.onReadState = null;
  });

  it("before the join: no request at all, onJoined not called, 0", async () => {
    const c = coordinator({ task: task() });
    const ctrl = new AbortController();
    ctrl.abort();
    const { run, onJoined } = island(ctrl.signal);
    expect(await run).toBe(0);
    expect(c.calls).toEqual([]);
    expect(onJoined).not.toHaveBeenCalled();
  });

  it("during the join: the join is aborted, nothing follows, onJoined not called, 0", async () => {
    const c = coordinator({ task: task() });
    const held = c.hold("POST /api/islands");
    const ctrl = new AbortController();
    const { run, onJoined } = island(ctrl.signal);
    await held.arrived;
    ctrl.abort();
    expect(await run).toBe(0);
    expect(c.keys()).toEqual(["POST /api/islands"]);
    expect(c.calls.some((call) => call.key.startsWith("DELETE "))).toBe(false);
    expect(c.calls[0].aborted).toBe(true);
    expect(onJoined).not.toHaveBeenCalled();
  });

  it("during /next: that request is aborted and none follows, 0", async () => {
    const c = coordinator({ task: task() });
    const held = c.hold("POST /api/next");
    const ctrl = new AbortController();
    const { run, onJoined } = island(ctrl.signal);
    await held.arrived;
    ctrl.abort();
    expect(await run).toBe(0);
    expect(c.keys()).toEqual(["POST /api/islands", "POST /api/next"]);
    expect(c.calls[1].aborted).toBe(true);
    expect(onJoined).toHaveBeenCalledTimes(1);
  });

  it("mid-run: stops at the next chunk boundary, destroys the simulation, uploads and reports nothing, 0", async () => {
    const c = coordinator({ task: task() });
    const ctrl = new AbortController();
    // Inside the second chunk's GPU work (steps 10 to 20).
    Sim.onRun = (step) => {
      if (step >= 20) ctrl.abort();
    };
    const { run, logged } = island(ctrl.signal);
    expect(await run).toBe(0);
    const sim = Sim.last!;
    expect(sim.step).toBe(20);
    expect(sim.destroyed).toBe(true);
    expect(c.calls.at(-1)?.key).toBe("DELETE /api/islands/isl");
    expect(logged).toContain("left island: registration removed and unfinished work released");
    // The first chunk's census only: the aborted chunk is never read back, and there is no final readState.
    expect(sim.calls.filter((k) => k === "snapshot")).toHaveLength(1);
    expect(sim.calls).not.toContain("readState");
    expect(c.keys()).toEqual(["POST /api/islands", "POST /api/next"]);
    expect(c.keys().filter((k) => writes.test(k))).toEqual([]);
    expect(logged).toContain("stopped local work: r #1; requesting release");
  });

  it("during the checkpoint upload: the PUT is aborted, no file PUT and no complete follow, 0", async () => {
    const c = coordinator({ task: task() });
    const held = c.hold("PUT /api/segments/seg-1/checkpoint");
    const ctrl = new AbortController();
    const { run } = island(ctrl.signal);
    await held.arrived;
    ctrl.abort();
    expect(await run).toBe(0);
    expect(c.keys()).toEqual(["POST /api/islands", "POST /api/next", "PUT /api/segments/seg-1/checkpoint"]);
    expect(c.calls.find((k) => k.key.endsWith("/checkpoint"))!.aborted).toBe(true);
    expect(Sim.last!.destroyed).toBe(true);
  });

  it("racing a completion: a complete already sent is not aborted and counts, 1", async () => {
    const c = coordinator({ task: task() });
    const held = c.hold("POST /api/segments/seg-1/complete");
    const ctrl = new AbortController();
    const { run, logged } = island(ctrl.signal);
    await held.arrived;
    ctrl.abort();
    await Promise.resolve();
    expect(c.calls.some((call) => call.key.startsWith("DELETE "))).toBe(false);
    held.release();
    expect(await run).toBe(1);
    const completes = c.calls.filter((k) => k.key === "POST /api/segments/seg-1/complete");
    expect(c.calls.at(-1)?.key).toBe("DELETE /api/islands/isl");
    expect(completes).toHaveLength(1);
    expect(completes[0].signal).toBeUndefined();
    expect(completes[0].aborted).toBe(false);
    expect(logged.some((m) => /run complete: .* → done/.test(m))).toBe(true);
    // Nothing after it: the loop sees the abort before asking for more.
    expect(c.keys().at(-1)).toBe("POST /api/segments/seg-1/complete");
  });

  it("a reject not yet sent is not sent once the signal aborts (the next island meets the same defect)", async () => {
    const ctrl = new AbortController();
    // The bad predecessor arrives whole, and the abort lands as it does: the reject is decided after the abort.
    const c = coordinator({ task: task({ startFrom: "seg-0", startHash: "x" }), before: (k) => k === "GET /api/segments/seg-0/start" && ctrl.abort() });
    const { run, logged } = island(ctrl.signal);
    expect(await run).toBe(0);
    expect(c.keys()).toEqual(["POST /api/islands", "POST /api/next", "GET /api/segments/seg-0/start"]);
    expect(logged.some((m) => /rejecting/.test(m))).toBe(false);
    expect(logged).toContain("stopped local work: r #1; requesting release");
  });

  it("during the start download: the download is aborted, no reject, 0", async () => {
    const c = coordinator({ task: task({ startFrom: "seg-0", startHash: "x" }) });
    const held = c.hold("GET /api/segments/seg-0/start");
    const ctrl = new AbortController();
    const { run } = island(ctrl.signal);
    await held.arrived;
    ctrl.abort();
    expect(await run).toBe(0);
    expect(c.keys()).toEqual(["POST /api/islands", "POST /api/next", "GET /api/segments/seg-0/start"]);
    expect(c.calls[2].aborted).toBe(true);
  });

  it("a scheduled feed refused after the abort is not reported failed (no /fail)", async () => {
    const ctrl = new AbortController();
    // A feed at t=15 whose named matter the world will not reproduce: the runner throws InterventionError there,
    // inside the second chunk, before that chunk's boundary check. The abort lands in the GPU work just before it.
    const wounded: RunSpec = { ...spec, interventions: [{ step: 15, kind: "feed", x: 10, y: 10, r: 3, amount: 4, matter: 999 }] };
    const c = coordinator({ task: task({ spec: wounded }) });
    Sim.onRun = (step) => {
      if (step >= 15) ctrl.abort();
    };
    const { run, logged } = island(ctrl.signal);
    expect(await run).toBe(0);
    expect(c.keys().filter((k) => writes.test(k))).toEqual([]);
    expect(logged.some((m) => /cannot apply the schedule/.test(m))).toBe(false);
    expect(logged).toContain("stopped local work: r #1; requesting release");
  });

  it("no heartbeat leaves after the abort, and an aborted heartbeat is not logged", async () => {
    const c = coordinator({ task: task() });
    const beat = c.hold("POST /api/segments/seg-1/heartbeat");
    const held = c.hold("PUT /api/segments/seg-1/checkpoint");
    const ctrl = new AbortController();
    const { run, logged } = island(ctrl.signal, { heartbeatMs: 5 });
    await beat.arrived;
    await held.arrived;
    // Let a few more heartbeats go out while the upload is held.
    await new Promise((r) => setTimeout(r, 30));
    ctrl.abort();
    expect(await run).toBe(0);
    const beats = () => c.calls.filter((k) => k.key.endsWith("/heartbeat")).length;
    const after = beats();
    expect(after).toBeGreaterThanOrEqual(1);
    expect(c.calls.find((k) => k.key.endsWith("/heartbeat"))!.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    expect(beats()).toBe(after);
    expect(logged.some((m) => /heartbeat/.test(m))).toBe(false);
  });

  it("an AbortError while the signal has not aborted is not swallowed", async () => {
    vi.stubGlobal("fetch", async () => {
      throw abortError();
    });
    const ctrl = new AbortController();
    await expect(island(ctrl.signal).run).rejects.toThrow(/aborted/);
  });


  it("a garden join whose answer body is still arriving: the body read is aborted, 0, onJoined not called", async () => {
    // Headers arrive, the body is held open, and the abort lands: the body's own abort must reach `stopped`, not be
    // turned into joinAnswer's fixed "not an island id and token" refusal.
    const answered = deferred();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push(`${init.method ?? "GET"} ${new URL(url).pathname}`);
      const signal = init.signal!;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener("abort", () => controller.error(reasonOf(signal)), { once: true });
        },
      });
      answered.resolve();
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    });
    const ctrl = new AbortController();
    const { run, onJoined } = island(ctrl.signal, { gardenToken: "garden-secret-token" });
    await answered.promise;
    await new Promise((r) => setTimeout(r, 5));
    ctrl.abort();
    expect(await run).toBe(0);
    expect(calls).toEqual(["POST /api/islands"]);
    expect(onJoined).not.toHaveBeenCalled();
  });

  it("a /next answered just as the abort lands: the task is seen, left at once, nothing written, 0", async () => {
    const ctrl = new AbortController();
    const c = coordinator({ task: task(), before: (k) => k === "POST /api/next" && ctrl.abort() });
    const { run, logged } = island(ctrl.signal);
    expect(await run).toBe(0);
    expect(c.keys()).toEqual(["POST /api/islands", "POST /api/next"]);
    expect(logged.some((m) => /^run r #1 /.test(m))).toBe(true);
    expect(logged).toContain("stopped local work: r #1; requesting release");
    // The run never started a simulation's GPU work.
    expect(Sim.last).toBeNull();
  });

  it("the idle wait ends at once on abort, whatever idleMs is", async () => {
    const c = coordinator();
    const ctrl = new AbortController();
    const { run } = island(ctrl.signal, { idleMs: 60_000 });
    while (!c.calls.some((k) => k.key === "POST /api/next")) await new Promise((r) => setTimeout(r, 2));
    await new Promise((r) => setTimeout(r, 20));
    const t = Date.now();
    ctrl.abort();
    expect(await run).toBe(0);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(c.keys()).toEqual(["POST /api/islands", "POST /api/next"]);
  });

  it("an abort during a census's readbacks stops before the next chunk's GPU work", async () => {
    const c = coordinator({ task: task() });
    const ctrl = new AbortController();
    Sim.onSnapshot = (step) => {
      if (step === 10) ctrl.abort();
    };
    const { run } = island(ctrl.signal);
    expect(await run).toBe(0);
    expect(Sim.last!.step).toBe(10);
    expect(Sim.last!.destroyed).toBe(true);
    expect(c.keys().filter((k) => writes.test(k))).toEqual([]);
  });

  it("an abort during the last census's readbacks: no final readState, nothing written", async () => {
    const c = coordinator({ task: task() });
    const ctrl = new AbortController();
    Sim.onSnapshot = (step) => {
      if (step === 40) ctrl.abort();
    };
    const { run } = island(ctrl.signal);
    expect(await run).toBe(0);
    expect(Sim.last!.step).toBe(40);
    expect(Sim.last!.calls).not.toContain("readState");
    expect(c.keys().filter((k) => writes.test(k))).toEqual([]);
  });

  it("an abort as the last file PUT is answered: no complete (the last point before it)", async () => {
    // The file PUTs go out in the sink's insertion order, the same on every run of the spec: find the last one first.
    const probe = coordinator({ task: task() });
    expect(await island(new AbortController().signal, { maxTasks: 1 }).run).toBe(1);
    const last = probe.keys().filter((k) => k.startsWith("PUT /api/segments/seg-1/files/")).at(-1)!;
    vi.unstubAllGlobals();
    const ctrl = new AbortController();
    const c = coordinator({ task: task(), before: (k) => k === last && ctrl.abort() });
    const { run, logged } = island(ctrl.signal);
    expect(await run).toBe(0);
    expect(c.keys().at(-1)).toBe(last);
    expect(c.keys()).not.toContain("POST /api/segments/seg-1/complete");
    expect(logged).toContain("stopped local work: r #1; requesting release");
  });

  it("verify, mid-run: stops at the next chunk boundary, reports nothing, 0", async () => {
    const c = coordinator({ task: task({ kind: "verify" }) });
    const ctrl = new AbortController();
    Sim.onRun = (step) => {
      if (step >= 20) ctrl.abort();
    };
    const { run } = island(ctrl.signal);
    expect(await run).toBe(0);
    expect(Sim.last!.step).toBe(20);
    expect(Sim.last!.destroyed).toBe(true);
    expect(c.keys()).toEqual(["POST /api/islands", "POST /api/next"]);
  });

  it("verify, abort in the run's last readback: no complete, 0", async () => {
    const c = coordinator({ task: task({ kind: "verify" }) });
    const ctrl = new AbortController();
    // readState is the run's last GPU read; nothing in the runner checks the signal after it, so only the island's
    // last check before the complete stands between this abort and a complete.
    Sim.onReadState = () => ctrl.abort();
    const { run, logged } = island(ctrl.signal);
    expect(await run).toBe(0);
    expect(Sim.last!.calls).toContain("readState");
    expect(c.keys()).toEqual(["POST /api/islands", "POST /api/next"]);
    expect(logged).toContain("stopped local work: r #1; requesting release");
  });

  it("verify, abort while its observation digests are being computed: no complete, 0", async () => {
    // The abort lands inside the first SHA-256 of `observationDigests`, after every runner check and before the
    // island's last check: a guard placed before that await (instead of after it) would let the complete through.
    const c = coordinator({ task: task({ kind: "verify" }) });
    const ctrl = new AbortController();
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let hashed = 0;
    const spy = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (alg, data) => {
      if (hashed++ === 0) ctrl.abort();
      return digest(alg, data);
    });
    try {
      const { run, logged } = island(ctrl.signal);
      expect(await run).toBe(0);
      expect(hashed).toBeGreaterThan(0);
      expect(c.keys()).toEqual(["POST /api/islands", "POST /api/next"]);
      expect(logged).toContain("stopped local work: r #1; requesting release");
    } finally {
      spy.mockRestore();
    }
  });

  it("verify control: completes with observation digests and uploads nothing, 1", async () => {
    const c = coordinator({ task: task({ kind: "verify" }) });
    expect(await island(new AbortController().signal, { maxTasks: 1 }).run).toBe(1);
    expect(c.keys()).toEqual(["POST /api/islands", "POST /api/next", "POST /api/segments/seg-1/complete"]);
    expect(c.completeBodies[0].kind).toBe("verify");
    expect(c.completeBodies[0].observationDigests).toBeTruthy();
  });

  it("a stop requested from inside the log line of a refused feed sends no /fail", async () => {
    // The refusal is caught with the signal not yet aborted; the caller's own log callback aborts on the
    // "cannot apply" line, and the island must check again before sending the fail.
    const wounded: RunSpec = { ...spec, interventions: [{ step: 15, kind: "feed", x: 10, y: 10, r: 3, amount: 4, matter: 999 }] };
    const c = coordinator({ task: task({ spec: wounded }) });
    const ctrl = new AbortController();
    const logged: string[] = [];
    const run = runIsland(device, {
      coordinator: "http://coord",
      host,
      idleMs: 5,
      signal: ctrl.signal,
      log: (m) => {
        logged.push(m);
        if (/cannot apply the schedule/.test(m)) ctrl.abort();
      },
    });
    expect(await run).toBe(0);
    expect(c.keys().filter((k) => writes.test(k))).toEqual([]);
    expect(logged).toContain("stopped local work: r #1; requesting release");
  });

  it("a control for that: the same refused feed, never stopped, is reported failed", async () => {
    const wounded: RunSpec = { ...spec, interventions: [{ step: 15, kind: "feed", x: 10, y: 10, r: 3, amount: 4, matter: 999 }] };
    const c = coordinator({ task: task({ spec: wounded }) });
    const { run } = island(new AbortController().signal, { maxTasks: 1 });
    expect(await run).toBe(0);
    expect(c.keys()).toContain("POST /api/segments/seg-1/fail");
  });

  it("a stop requested from inside the rejecting log line sends no /reject", async () => {
    const c = coordinator({ task: task({ startFrom: "seg-0", startHash: "x" }) });
    const ctrl = new AbortController();
    const logged: string[] = [];
    const run = runIsland(device, {
      coordinator: "http://coord",
      host,
      idleMs: 5,
      signal: ctrl.signal,
      log: (m) => {
        logged.push(m);
        if (/rejecting/.test(m)) ctrl.abort();
      },
    });
    expect(await run).toBe(0);
    expect(c.keys()).toEqual(["POST /api/islands", "POST /api/next", "GET /api/segments/seg-0/start"]);
    expect(logged).toContain("stopped local work: r #1; requesting release");
  });

  it("custom abort reasons: a string reason mid-run, and a TimeoutError reason during /next, both resolve", async () => {
    const c1 = coordinator({ task: task() });
    const a = new AbortController();
    Sim.onRun = (step) => {
      if (step >= 20) a.abort("x");
    };
    const first = island(a.signal);
    expect(await first.run).toBe(0);
    expect(c1.keys().filter((k) => writes.test(k))).toEqual([]);
    expect(first.logged).toContain("stopped local work: r #1; requesting release");
    vi.unstubAllGlobals();
    Sim.onRun = null;

    const c2 = coordinator({ task: task() });
    const held = c2.hold("POST /api/next");
    const b = new AbortController();
    const second = island(b.signal);
    await held.arrived;
    b.abort(new DOMException("signal timed out", "TimeoutError"));
    expect(await second.run).toBe(0);
    expect(c2.keys()).toEqual(["POST /api/islands", "POST /api/next"]);
  });

  it("an abort reason of NaN (not equal to itself) is still recognised as the stop, mid-run and during /next", async () => {
    const c1 = coordinator({ task: task() });
    const a = new AbortController();
    Sim.onRun = (step) => {
      if (step >= 20) a.abort(NaN);
    };
    const first = island(a.signal);
    expect(await first.run).toBe(0);
    expect(c1.keys().filter((k) => writes.test(k))).toEqual([]);
    expect(first.logged).toContain("stopped local work: r #1; requesting release");
    vi.unstubAllGlobals();
    Sim.onRun = null;

    const c2 = coordinator({ task: task() });
    const held = c2.hold("POST /api/next");
    const b = new AbortController();
    const second = island(b.signal);
    await held.arrived;
    b.abort(NaN);
    expect(await second.run).toBe(0);
    expect(c2.keys()).toEqual(["POST /api/islands", "POST /api/next"]);
  });

  it("an abort reason of null is still recognised as the stop, mid-run and during /next", async () => {
    const c1 = coordinator({ task: task() });
    const a = new AbortController();
    Sim.onRun = (step) => {
      if (step >= 20) a.abort(null);
    };
    const first = island(a.signal);
    expect(await first.run).toBe(0);
    expect(Sim.last!.step).toBe(20);
    expect(c1.keys().filter((k) => writes.test(k))).toEqual([]);
    expect(first.logged).toContain("stopped local work: r #1; requesting release");
    vi.unstubAllGlobals();
    Sim.onRun = null;

    const c2 = coordinator({ task: task() });
    const held = c2.hold("POST /api/next");
    const b = new AbortController();
    const second = island(b.signal);
    await held.arrived;
    b.abort(null);
    expect(await second.run).toBe(0);
    expect(c2.keys()).toEqual(["POST /api/islands", "POST /api/next"]);
  });

  it("a fetch that rejects with a fresh AbortError rather than the custom reason is still the stop (join, /next, upload)", async () => {
    for (const key of ["POST /api/islands", "POST /api/next", "PUT /api/segments/seg-1/checkpoint"]) {
      const c = coordinator({ task: task(), freshAbort: true });
      const held = c.hold(key);
      const ctrl = new AbortController();
      const { run } = island(ctrl.signal);
      await held.arrived;
      ctrl.abort("custom");
      expect(await run).toBe(0);
      expect(c.keys().at(-1)).toBe(key);
      expect(c.keys().filter((k) => /complete|reject|fail|files/.test(k))).toEqual([]);
      vi.unstubAllGlobals();
    }
  });

  it("an AbortError from a complete (sent without the signal) as the stop lands is a failure, not a stop", async () => {
    const ctrl = new AbortController();
    const c = coordinator({
      task: task(),
      before: (key) => {
        if (key === "POST /api/segments/seg-1/complete") {
          ctrl.abort("custom");
          throw abortError();
        }
      },
    });
    const { run, logged } = island(ctrl.signal);
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(logged.some((m) => m.startsWith("stopped"))).toBe(false);
    expect(c.calls.find((k) => k.key === "POST /api/segments/seg-1/complete")!.signal).toBeUndefined();
  });

  it("an unrelated AbortError from the GPU as the stop lands is a failure, not a stop", async () => {
    const c = coordinator({ task: task() });
    const ctrl = new AbortController();
    const gpu = new DOMException("mapAsync aborted: device lost", "AbortError");
    Sim.onSnapshot = (step) => {
      if (step === 10) {
        ctrl.abort();
        throw gpu;
      }
    };
    const { run, logged } = island(ctrl.signal);
    await expect(run).rejects.toBe(gpu);
    expect(logged.some((m) => m.startsWith("stopped"))).toBe(false);
    expect(c.keys().filter((k) => writes.test(k))).toEqual([]);
  });

  it("normal idle maxTasks exit unregisters a resumed identity without joining or starting GPU work", async () => {
    const c = coordinator();
    const created = Sim.created;
    const { run } = island(new AbortController().signal, { identity: { id: "isl", token: "tok" }, maxTasks: 1 });
    expect(await run).toBe(0);
    expect(c.calls.map((call) => call.key)).toEqual(["POST /api/next", "DELETE /api/islands/isl"]);
    expect(Sim.created).toBe(created);
  });

  it("leaves a join whose identity arrives at the moment Stop lands", async () => {
    const ctrl = new AbortController();
    const c = coordinator({ before: (key) => key === "POST /api/islands" && ctrl.abort() });
    const { run, onJoined } = island(ctrl.signal);
    expect(await run).toBe(0);
    expect(onJoined).not.toHaveBeenCalled();
    expect(c.calls.map((call) => call.key)).toEqual(["POST /api/islands", "DELETE /api/islands/isl"]);
  });

  it.each([404, 405, 500, 200])("leave HTTP %s is an honest fallback and preserves the completed count", async (status) => {
    coordinator({ task: task() });
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => init.method === "DELETE" ? Promise.resolve(json({}, status)) : original(url, init));
    const { run, logged } = island(new AbortController().signal, { maxTasks: 1 });
    expect(await run).toBe(1);
    expect(logged.at(-1)).toMatch(/could not be confirmed.*lease expires/);
  });

  it("a leave transport ignoring its signal is bounded and aborts without further heartbeat", async () => {
    vi.useFakeTimers();
    try {
      const c = coordinator();
      const original = globalThis.fetch;
      let leaveSignal: AbortSignal | undefined;
      const arrived = deferred();
      vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
        if (init.method !== "DELETE") return original(url, init);
        leaveSignal = init.signal!;
        arrived.resolve();
        return new Promise<Response>(() => {});
      });
      const { run, logged } = island(new AbortController().signal, { maxTasks: 1 });
      await arrived.promise;
      expect(leaveSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await run).toBe(0);
      expect(leaveSignal?.aborted).toBe(true);
      expect(logged.at(-1)).toMatch(/could not be confirmed.*lease expires/);
      expect(c.calls.some((call) => call.key.endsWith("heartbeat"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leave network and logging failures preserve the original task error", async () => {
    const originalError = new Error("GPU lost");
    coordinator({ task: task(), before: (key) => {
      if (key === "DELETE /api/islands/isl") throw new Error("offline");
    } });
    Sim.onRun = () => { throw originalError; };
    const { run } = island(new AbortController().signal, { log: (message) => {
      if (message.startsWith("leave")) throw new Error("broken logger");
    } });
    await expect(run).rejects.toBe(originalError);
  });

  it.each(["reject", "fail"])("waits for an already-sent %s before leaving", async (decision) => {
    const wounded = { ...spec, interventions: [{ step: 0, kind: "feed", x: 10, y: 10, r: 3, amount: 4, matter: 999 }] };
    const c = coordinator({ task: task(decision === "reject" ? { startFrom: "seg-0", startHash: "x" } : { spec: wounded }) });
    const held = c.hold(`POST /api/segments/seg-1/${decision}`);
    const ctrl = new AbortController();
    const { run } = island(ctrl.signal);
    await held.arrived;
    ctrl.abort();
    await Promise.resolve();
    expect(c.calls.some((call) => call.key.startsWith("DELETE "))).toBe(false);
    held.release();
    expect(await run).toBe(0);
    expect(c.calls.at(-1)?.key).toBe("DELETE /api/islands/isl");
  });

  it("control: with a signal that never aborts the task uploads and completes, 1", async () => {
    const c = coordinator({ task: task() });
    const ctrl = new AbortController();
    const { run } = island(ctrl.signal, { maxTasks: 1 });
    expect(await run).toBe(1);
    const keys = c.keys();
    expect(keys.slice(0, 3)).toEqual(["POST /api/islands", "POST /api/next", "PUT /api/segments/seg-1/checkpoint"]);
    expect(keys.filter((k) => k.startsWith("PUT /api/segments/seg-1/files/")).length).toBeGreaterThan(0);
    expect(keys.at(-1)).toBe("POST /api/segments/seg-1/complete");
    expect(c.calls.at(-1)?.key).toBe("DELETE /api/islands/isl");
    expect(Sim.last!.destroyed).toBe(true);
  });
});

class Mem implements Sink {
  readonly files = new Map<string, string>();
  async writeText(p: string, t: string) { this.files.set(p, t); }
  async appendText(p: string, t: string) { this.files.set(p, (this.files.get(p) ?? "") + t); }
  async writeBytes() {}
}

describe("runExperiment and RunOptions.signal", () => {
  it("an already-aborted signal rejects before any simulation is created", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const before = Sim.created;
    await expect(runExperiment(device, spec, new Mem(), host, () => {}, { signal: ctrl.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(Sim.created).toBe(before);
  });

  it("rejects with the signal's own reason, null included", async () => {
    for (const reason of [null, "x", 0]) {
      const ctrl = new AbortController();
      ctrl.abort(reason);
      await expect(runExperiment(device, spec, new Mem(), host, () => {}, { signal: ctrl.signal })).rejects.toBe(reason);
    }
  });

  it("a signal that never aborts changes nothing: same digest, same files", async () => {
    const a = new Mem(), b = new Mem();
    const plain = await runExperiment(device, spec, a, host);
    const signalled = await runExperiment(device, spec, b, host, () => {}, { signal: new AbortController().signal });
    expect(signalled.summary.finalHash).toBe(plain.summary.finalHash);
    const strip = (m: Map<string, string>) => [...m].filter(([k]) => k !== "manifest.json");
    expect(strip(b.files)).toEqual(strip(a.files));
    // The manifest differs only in its clock fields.
    const clockless = (t: string) => JSON.stringify(JSON.parse(t), (k, v) => (["finishedAt", "startedAt", "wallSeconds", "stepsPerSecond"].includes(k) ? undefined : v));
    expect(clockless(b.files.get("manifest.json")!)).toBe(clockless(a.files.get("manifest.json")!));
  });
});
