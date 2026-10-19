// Review 4: any defect in a predecessor's artifact must reject that
// predecessor (so the coordinator recomputes it) instead of failing the
// island. One artifact now carries physics and observer state together, so
// there is one fetch (`/start`) and every defect surfaces from decoding it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESETS, encodeCheckpoint, initWorld, stateHash } from "@bl/schema";
import { ActivityTracker, Tracker, b64 } from "@bl/metrics";
import { METRICS_VERSION } from "@bl/schema";
import { continuationError, decideRejoin, gardenTokenFor, gardenTokenForCoordinator, gardenTokenFrom, gardenTokenFromHash, ISLAND_CAPABILITIES, probeIslandIdentity, resolveRejoin, runIsland, specConfig, STALE_REGISTRATION, timeoutSignal, type ObserverState, type RunSpec } from "../src/index.ts";

const spec: RunSpec = { experiment: "t", presetId: "spots", condition: "treatment", seed: 3, steps: 500, censusEvery: 100, deepEvery: 5, checkpointEvery: 0, activityThreshold: 7 };
const start = { ...initWorld(specConfig(spec), PRESETS.find((p) => p.id === "spots")!.init), step: 500 };
const good: ObserverState = {
  step: 500,
  settings: { censusEvery: 100, deepEvery: 5, activityThreshold: 7 },
  tracker: new Tracker().toJSON(),
  activity: new ActivityTracker(7).toJSON(),
  mutations: 0,
  buddings: 0,
  censusIdx: 5,
  extinct: false,
  prevSym: null,
};

const labels = (n: number) => b64(new Uint8Array(new Int32Array(n).fill(-1).buffer));

/** Runs one island task against a fake coordinator; returns the reject reasons posted. */
async function attempt(startBytes: Uint8Array, taskSpec: RunSpec = spec): Promise<string[]> {
  const rejects: string[] = [];
  let served = false;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
    if (path === "/api/islands") return json({ id: "isl", token: "tok" });
    if (path === "/api/next") {
      if (served) return json({ kind: "idle" });
      served = true;
      return json({ kind: "run", lease: "L", segment: { id: "seg-1", run: "r", index: 1, startStep: 500, steps: 500 }, spec: taskSpec, startFrom: "seg-0", startHash: stateHash(start) });
    }
    if (path === "/api/segments/seg-0/start") return new Response(startBytes.slice(), { headers: { "content-type": "application/octet-stream" } });
    if (path === "/api/segments/seg-1/reject") {
      rejects.push(JSON.parse(String(init.body)).reason);
      return json({ ok: true });
    }
    throw new Error(`unexpected ${path}`);
  });
  const done = await runIsland({} as GPUDevice, { coordinator: "http://coord", host: { host: "t", adapter: "t" }, maxTasks: 1 });
  expect(done).toBe(0);
  return rejects;
}

// A scheduled feed the world refuses (RunSpec.interventions) is a property of the spec against
// its world, the same on every island: the island reports the segment failed under its lease
// (POST /api/segments/:id/fail, see Coordinator.Queue's moduledoc on what creation cannot
// check) instead of crashing, or leaving the task for the next island to fail again. Both
// refusals here are step-0 feeds, applied on the CPU before any GPU work, so a fake device
// suffices: one past MATTER_MAX (the case the archipelago can meet: 4096 per cell over r=100 on
// spots is ~1.3e8 quanta against a bound of 2^26), one whose named matter the starting world
// does not reproduce (refused at creation by the coordinator, so only a direct task carries it).
describe("island reports a task whose schedule cannot be applied as failed", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** One task with `interventions`; `onFail` answers the /fail POST. Returns the calls (heartbeats aside), the log and the /fail bodies. */
  async function failing(interventions: RunSpec["interventions"], onFail: () => Response, maxTasks = 2) {
    const calls: string[] = [];
    const logged: string[] = [];
    const bodies: { lease?: unknown; reason?: unknown }[] = [];
    let served = false;
    const wounded: RunSpec = { ...spec, interventions };
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      calls.push(`${init.method ?? "GET"} ${path}`);
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (path === "/api/islands") return json({ id: "isl", token: "tok" });
      if (path === "/api/next") {
        if (served) return json({ kind: "idle" });
        served = true;
        return json({ kind: "run", lease: "L", segment: { id: "seg-0", run: "r", index: 0, startStep: 0, steps: 500 }, spec: wounded, startFrom: null, startHash: null });
      }
      if (path === "/api/segments/seg-0/heartbeat") return json({ ok: true });
      if (path === "/api/segments/seg-0/fail") {
        expect(init.method).toBe("POST");
        bodies.push(JSON.parse(String(init.body)));
        return onFail();
      }
      throw new Error(`unexpected ${path}`);
    });
    const done = await runIsland({} as GPUDevice, { coordinator: "http://coord", host: { host: "t", adapter: "t" }, maxTasks, log: (m) => logged.push(m) });
    return { done, calls: calls.filter((c) => !/heartbeat/.test(c)), logged, bodies };
  }
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const pastMatterMax: RunSpec["interventions"] = [{ step: 0, kind: "feed", x: 128, y: 128, r: 100, amount: 4096 }];
  const wrongMatter: RunSpec["interventions"] = [{ step: 0, kind: "feed", x: 10, y: 10, r: 3, amount: 4, matter: 999 }];

  it("logs the InterventionError, POSTs /fail with the lease and the runner's reason, completes nothing, and goes on to the next task", async () => {
    const { done, calls, logged, bodies } = await failing(pastMatterMax, () => json({ ok: true }));
    expect(done).toBe(0);
    expect(logged.find((m) => /cannot apply the schedule as given, leaving the task/.test(m))).toMatch(/past MATTER_MAX/);
    expect(logged.find((m) => /reported r #0 as failed/.test(m))).toBeDefined();
    // No checkpoint, file, completion or rejection went out: the join, the task, its failure report, the next ask.
    expect(calls).toEqual(["POST /api/islands", "POST /api/next", "POST /api/segments/seg-0/fail", "POST /api/next"]);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].lease).toBe("L");
    expect(bodies[0].reason).toMatch(/the feed at t=0 failed: feed refused: \d+ quanta would take the world past MATTER_MAX/);
    expect(String(bodies[0].reason).length).toBeLessThanOrEqual(500);
  });

  it("a feed whose named matter the world does not reproduce is reported the same way", async () => {
    const { done, calls, bodies } = await failing(wrongMatter, () => json({ ok: true }));
    expect(done).toBe(0);
    expect(calls).toEqual(["POST /api/islands", "POST /api/next", "POST /api/segments/seg-0/fail", "POST /api/next"]);
    expect(bodies[0].reason).toMatch(/not the observed history/);
  });

  it("a 409 from /fail (the lease was reclaimed, or the segment blocked, meanwhile) is logged and not fatal", async () => {
    const { done, calls, logged } = await failing(pastMatterMax, () => json({ error: "segment not assigned to this island/lease" }, 409));
    expect(done).toBe(0);
    expect(logged.find((m) => /task abandoned: POST \/api\/segments\/seg-0\/fail: 409/.test(m))).toBeDefined();
    expect(calls).toEqual(["POST /api/islands", "POST /api/next", "POST /api/segments/seg-0/fail", "POST /api/next"]);
  });

  it("any other failure to report (here a 500) still throws out of the island", async () => {
    await expect(failing(pastMatterMax, () => json({ error: "boom" }, 500), 1)).rejects.toThrow(/POST \/api\/segments\/seg-0\/fail: 500/);
  });

  it("still throws on a failure of the host (here a device with no createBuffer), which is not the schedule's", async () => {
    let served = false;
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (path === "/api/islands") return json({ id: "isl", token: "tok" });
      if (path === "/api/next") {
        if (served) return json({ kind: "idle" });
        served = true;
        // A lesion at step 0 is applied on the CPU; the GPU is then created and fails.
        return json({ kind: "run", lease: "L", segment: { id: "seg-0", run: "r", index: 0, startStep: 0, steps: 500 }, spec: { ...spec, interventions: [{ step: 0, kind: "lesion", x: 10, y: 10, r: 3 }] }, startFrom: null, startHash: null });
      }
      if (path === "/api/segments/seg-0/heartbeat") return json({ ok: true });
      throw new Error(`unexpected ${path}`);
    });
    await expect(runIsland({} as GPUDevice, { coordinator: "http://coord", host: { host: "t", adapter: "t" }, maxTasks: 1 })).rejects.toThrow(/is not a function/);
  });
});

describe("island rejects bad predecessor artifacts", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("accepts a well-formed continuation", () => {
    expect(continuationError(spec, start, good)).toBeNull();
  });

  // Review 1 finding #3: `artifactDigest` canonicalizes (sorts) the observer's
  // keys before digesting, so two artifacts with reordered-but-equal
  // `settings` fields share one digest in the content-addressed coordinator
  // store -- which keeps only the first upload for a digest and discards any
  // later "duplicate", correct or not. `continuationError` must therefore
  // compare `settings` by value, not by serialized key order, or a
  // differently-ordered decode can never be un-rejected by recomputing (same
  // content, same digest, always discarded).
  it("accepts settings whose keys decoded in a different order than observerSettings builds them", () => {
    const reordered: ObserverState = {
      ...good,
      settings: { activityThreshold: good.settings.activityThreshold, deepEvery: good.settings.deepEvery, censusEvery: good.settings.censusEvery },
    };
    expect(continuationError(spec, start, reordered)).toBeNull();
  });

  const goodBytes = encodeCheckpoint(start, good);
  const corrupt = goodBytes.slice();
  corrupt[4000] ^= 1;

  const withObserver = (observer: unknown) => encodeCheckpoint(start, observer);

  const cases: [string, Uint8Array][] = [
    ["undecodable checkpoint", corrupt],
    ["default (empty) observer section", encodeCheckpoint(start)],
    ["wrong observer step", withObserver({ ...good, step: 400 })],
    ["wrong observer settings", withObserver({ ...good, settings: { ...good.settings, censusEvery: 50 } })],
    ["unrestorable tracker", withObserver({ ...good, tracker: { nope: 1 } })],
    ["malformed counters", withObserver({ ...good, mutations: "x" })],
    ["dangling individual reference", withObserver({ ...good, tracker: { ...good.tracker, prevLabels: labels(start.cells.length / 7), prevIds: [[0, 0]], nextId: 1 } })],
    ["labels of the wrong size", withObserver({ ...good, tracker: { ...good.tracker, prevLabels: labels(64) } })],
  ];
  for (const [name, bytes] of cases)
    it(name, async () => {
      const r = await attempt(bytes);
      expect(r).toHaveLength(1);
    });

  // Codex pass 3: the runner's sun check (`sunContinuationError`) is part of the preflight, so a predecessor taken under
  // another sun than the schedule's (or under none while the schedule has one active) is rejected for recomputation
  // instead of throwing out of runExperiment, which left the lease to expire and the next island to fail the same way.
  const sunny: RunSpec = { ...spec, interventions: [{ step: 200, kind: "sun", percent: 50, span: 400 }] };
  it("a predecessor taken under another sun than the schedule's", async () => {
    const r = await attempt(withObserver({ ...good, sun: { step: 200, percent: 75, span: 400 } }), sunny);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/^the start checkpoint was taken under another sun than this schedule's: its observer says 75% from t=200/);
  });
  it("a predecessor with no sun where the schedule has one active", async () => {
    const r = await attempt(goodBytes, sunny);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/its observer says no sun, the schedule 50% from t=200 for 400 steps at t=500/);
  });
});

// Coverage gap the review flagged: a defect in the *import* predecessor
// (a metapopulation's cross-run exchange source -- RunSpec.metapopulation)
// must reject with `predecessor: "import"`, routed by Coordinator.Queue's
// `reject/5` to the ring-predecessor's segment, never `"own"` (this run's
// same-run predecessor, which in every case below is perfectly fine on its
// own) -- otherwise a bad import would get misfiled as if this run's own
// history were the problem. Mirrors "island rejects bad predecessor
// artifacts" above, but for the importFrom branch, and every artifact here
// round-trips through `encodeCheckpoint`/`decodeArtifact` exactly as the real
// wire protocol does (not an in-memory WorldState), the "serialized replay"
// coverage the review also asked for.
describe("island routes bad import-predecessor artifacts to \"import\", not \"own\" (metapopulation)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const metaSpec: RunSpec = { ...spec, metapopulation: { salt: 1, migrantCount: 4, ringNamespace: 1 } };
  // This run's own predecessor, under metaSpec's own (namespaced) config --
  // *not* the file's shared `start`/top-level `spec`, whose cfg has no
  // ringNamespace at all and would make even the *own*-predecessor check
  // fail on a config mismatch before the import branch is ever reached.
  const myCfg = specConfig(metaSpec);
  const ownState = { ...initWorld(myCfg, PRESETS.find((p) => p.id === "spots")!.init), step: 500 };
  // A different ring member's own state: different seed *and* ringNamespace
  // (review P1 -- sameConfigExceptSeed exempts both), at the same absolute
  // step this segment starts from, as a real cross-run import must be.
  const theirCfg = specConfig({ ...metaSpec, seed: 99, metapopulation: { salt: 1, migrantCount: 4, ringNamespace: 2 } });
  const theirState = { ...initWorld(theirCfg, PRESETS.find((p) => p.id === "spots")!.init), step: 500 };
  const theirBytes = encodeCheckpoint(theirState, good);
  const corruptImportDigest = theirBytes.slice();
  corruptImportDigest[4000] ^= 1;
  // A state that decodes cleanly but belongs to a config this run cannot
  // possibly share (a different preset entirely) -- immigrantError's own
  // config check, not the digest check above.
  const mismatchedCfg = specConfig({ experiment: "t", presetId: "archipelago", condition: "treatment", seed: 99, steps: 500, censusEvery: 100, deepEvery: 5, checkpointEvery: 0 });
  const mismatchedConfigState = { ...initWorld(mismatchedCfg, PRESETS.find((p) => p.id === "archipelago")!.init), step: 500 };
  const mismatchedConfigBytes = encodeCheckpoint(mismatchedConfigState, good);

  /** Same fake-coordinator shape as `attempt` above, but the task carries a
   * good startFrom (this run's own predecessor -- never the thing under
   * test here) alongside an importFrom whose artifact bytes are the thing
   * being probed, so a misrouted rejection would show up unambiguously.
   * `importHash` defaults to the *intended* import's own digest (so a
   * config-only defect can be isolated from a digest mismatch); pass the
   * real target's digest explicitly to probe the digest check itself. */
  async function attemptImport(importBytes: Uint8Array, importHash = stateHash(theirState)): Promise<{ reason: string; predecessor: string }[]> {
    const rejects: { reason: string; predecessor: string }[] = [];
    let served = false;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (path === "/api/islands") return json({ id: "isl", token: "tok" });
      if (path === "/api/next") {
        if (served) return json({ kind: "idle" });
        served = true;
        return json({
          kind: "run",
          lease: "L",
          segment: { id: "seg-1", run: "r", index: 1, startStep: 500, steps: 500 },
          spec: metaSpec,
          startFrom: "seg-0",
          startHash: stateHash(ownState),
          importFrom: "seg-import-0",
          importHash,
        });
      }
      if (path === "/api/segments/seg-0/start") return new Response(encodeCheckpoint(ownState, good).slice(), { headers: { "content-type": "application/octet-stream" } });
      if (path === "/api/segments/seg-import-0/start") return new Response(importBytes.slice(), { headers: { "content-type": "application/octet-stream" } });
      if (path === "/api/segments/seg-1/reject") {
        const body = JSON.parse(String(init.body));
        rejects.push({ reason: body.reason, predecessor: body.predecessor });
        return json({ ok: true });
      }
      throw new Error(`unexpected ${path}`);
    });
    const done = await runIsland({} as GPUDevice, { coordinator: "http://coord", host: { host: "t", adapter: "t" }, maxTasks: 1 });
    expect(done).toBe(0);
    return rejects;
  }

  it("a bad import checkpoint digest is rejected as predecessor \"import\" (own predecessor is fine)", async () => {
    const r = await attemptImport(corruptImportDigest);
    expect(r).toHaveLength(1);
    expect(r[0].predecessor).toBe("import");
  });

  it("an import whose config cannot match this run's is rejected as predecessor \"import\", not \"own\"", async () => {
    const r = await attemptImport(mismatchedConfigBytes, stateHash(mismatchedConfigState));
    expect(r).toHaveLength(1);
    expect(r[0].predecessor).toBe("import");
    expect(r[0].reason).toMatch(/config differs/);
  });
});

describe("island idle wait", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("explains an empty assignment once while continuing to poll", async () => {
    const controller = new AbortController();
    const messages: string[] = [];
    let polls = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (path === "/api/islands") return json({ id: "isl", token: "tok" });
      if (path === "/api/next") {
        if (++polls === 2) controller.abort();
        return json({ kind: "idle" });
      }
      throw new Error(`unexpected ${path}`);
    });

    await runIsland({} as GPUDevice, {
      coordinator: "http://coord", host: { host: "t", adapter: "t" },
      idleMs: 1, signal: controller.signal, log: (message) => messages.push(message),
    });

    expect(polls).toBe(2);
    expect(messages.filter((message) => message.includes("waiting for work"))).toHaveLength(1);
  });

  // The coordinator gates pond work on this capability (Coordinator.Queue's
  // moduledoc), so it must go with every `/next`, not just the first.
  it("advertises ISLAND_CAPABILITIES as the JSON body of every /next", async () => {
    const controller = new AbortController();
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (path === "/api/islands") return json({ id: "isl", token: "tok" });
      if (path === "/api/next") {
        expect(init.method).toBe("POST");
        expect(new Headers(init.headers).get("content-type")).toBe("application/json");
        bodies.push(JSON.parse(String(init.body)));
        if (bodies.length === 2) controller.abort();
        return json({ kind: "idle" });
      }
      throw new Error(`unexpected ${path}`);
    });
    await runIsland({} as GPUDevice, { coordinator: "http://coord", host: { host: "t", adapter: "t" }, idleMs: 1, signal: controller.signal });
    const caps = ["ponds-v1", "ponds-v2", "interventions-v1", "breed-v1", "sun-v1"];
    expect(ISLAND_CAPABILITIES).toEqual(caps);
    expect(bodies).toEqual([{ capabilities: caps }, { capabilities: caps }]);
  });

  // Review 5: Stop can abort while `/next` is in flight and it comes back
  // idle; the wait must notice `signal.aborted` before it starts rather than
  // running the full `idleMs` regardless.
  it("skips the wait entirely when the signal is already aborted", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (path === "/api/islands") return json({ id: "isl", token: "tok" });
      if (path === "/api/next") {
        // Simulate Stop firing while this call was pending.
        controller.abort();
        return json({ kind: "idle" });
      }
      throw new Error(`unexpected ${path}`);
    });
    const t0 = performance.now();
    const done = await runIsland({} as GPUDevice, { coordinator: "http://coord", host: { host: "t", adapter: "t" }, idleMs: 10_000, signal: controller.signal });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(done).toBe(0);
  });
});

import { decodeArtifact, observerSettings } from "../src/index.ts";

// Auto-rejoin (browser-life issue: a reloaded island silently dropped back
// to the Join screen for ~100 minutes). `decideRejoin` is the pure decision
// the browser page's auto-rejoin makes from a probe of a remembered
// identity against the side-effect-free `GET /api/islands/me` (never
// `/api/next`, which would claim -- and then strand -- a task); kept
// separate from `runIsland` so it's trivial to unit test.
describe("decideRejoin", () => {
  it("reuses the identity when the probe returns 200", () => {
    expect(decideRejoin(200)).toBe("reuse");
  });
  it("falls back to a fresh join only on 401 (the coordinator no longer knows the island)", () => {
    expect(decideRejoin(401)).toBe("fresh");
  });
  it("also joins afresh when the identity was registered under another metrics version", () => {
    expect(decideRejoin(STALE_REGISTRATION)).toBe("fresh");
  });

  // Review: 404 (an older coordinator without this route), 5xx (e.g. mid
  // hot-reload) and a failed request don't establish anything about the
  // identity either way -- retrying beats guessing "reuse" or "fresh".
  it("treats everything else as inconclusive (retry), not as authentication either way", () => {
    expect(decideRejoin(404)).toBe("retry");
    expect(decideRejoin(500)).toBe("retry");
    expect(decideRejoin(409)).toBe("retry");
    expect(decideRejoin(null)).toBe("retry");
  });
});

describe("resolveRejoin", () => {
  const noSleep = async () => {};

  it("returns reuse/fresh as soon as the probe is conclusive, without retrying", async () => {
    const probe = vi.fn(async () => 200);
    expect(await resolveRejoin({ probe, sleep: noSleep })).toBe("reuse");
    expect(probe).toHaveBeenCalledTimes(1);

    probe.mockReset().mockImplementation(async () => 401);
    expect(await resolveRejoin({ probe, sleep: noSleep })).toBe("fresh");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("retries an inconclusive probe with backoff, then reuses once it becomes conclusive", async () => {
    let calls = 0;
    const probe = vi.fn(async () => (++calls < 3 ? null : 200));
    const sleeps: number[] = [];
    const result = await resolveRejoin({ probe, sleep: async (ms) => void sleeps.push(ms), retries: 3 });
    expect(result).toBe("reuse");
    expect(probe).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 1000]); // default backoff for attempts 0 and 1
  });

  it("gives up as `wait` after exhausting retries on a persistently inconclusive probe", async () => {
    const probe = vi.fn(async () => 500);
    const result = await resolveRejoin({ probe, sleep: noSleep, retries: 2 });
    expect(result).toBe("wait");
    expect(probe).toHaveBeenCalledTimes(3); // the first attempt plus 2 retries
  });
});

// Round-3 review: Chrome shipped WebGPU in 113, three versions before
// `AbortSignal.any` (116). Calling it unconditionally throws while building
// fetch's options -- *before* `fetch` is ever invoked -- and the probe's own
// `catch { return null; }` then reports that as an indistinguishable network
// failure: on such an engine, no fetch is ever made, every attempt "fails",
// retries exhaust, and a remembered identity can never be reconfirmed. These
// tests simulate that engine by removing both APIs and driving the real
// `probeIslandIdentity`/`timeoutSignal` through a fake `fetch` that behaves
// like the real one with respect to `signal`, to catch a regression back to
// the unconditional call.
describe("timeoutSignal / probeIslandIdentity (missing AbortSignal.any/.timeout)", () => {
  const withoutNativeAbortHelpers = async (fn: () => Promise<void>) => {
    const any_ = AbortSignal.any;
    const timeout_ = AbortSignal.timeout;
    // @ts-expect-error -- simulating an engine that doesn't have these yet
    delete AbortSignal.any;
    // @ts-expect-error
    delete AbortSignal.timeout;
    try {
      await fn();
    } finally {
      AbortSignal.any = any_;
      AbortSignal.timeout = timeout_;
    }
  };

  // Behaves like the real `fetch` only with respect to `signal`: never
  // resolves on its own, but rejects the moment the signal it was given
  // aborts -- which is what actually makes a timeout or a cancel observable
  // through `probeIslandIdentity`'s `await fetch(...)`.
  const abortableFakeFetch = () =>
    vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("aborted", "AbortError"));
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
    });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("still makes a fetch and times out, rather than throwing before ever fetching", () =>
    withoutNativeAbortHelpers(async () => {
      vi.useFakeTimers();
      const fetchMock = abortableFakeFetch();
      vi.stubGlobal("fetch", fetchMock);

      const ctrl = new AbortController();
      const result = probeIslandIdentity("http://coord", "isl-1", "tok", ctrl.signal, 5000);

      // The regression this guards against: an unconditional `AbortSignal.any`
      // throws while building fetch's options, so fetch is never called.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5000); // the fallback's own setTimeout fires
      expect(await result).toBeNull(); // inconclusive, not a thrown error
    }));

  it("still lets an operation cancel abort the in-flight probe", () =>
    withoutNativeAbortHelpers(async () => {
      const fetchMock = abortableFakeFetch();
      vi.stubGlobal("fetch", fetchMock);

      const ctrl = new AbortController();
      const result = probeIslandIdentity("http://coord", "isl-1", "tok", ctrl.signal, 5000);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      ctrl.abort(); // e.g. the user clicked Cancel
      expect(await result).toBeNull();
    }));

  it("timeoutSignal's fallback clears its timer once the operation signal aborts first", () =>
    withoutNativeAbortHelpers(async () => {
      vi.useFakeTimers();
      const ctrl = new AbortController();
      const combined = timeoutSignal(ctrl.signal, 1000);
      expect(vi.getTimerCount()).toBe(1); // the fallback's own setTimeout is pending

      ctrl.abort(); // settles via the operation signal, not the timer
      expect(combined.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0); // cleared -- not left running until it would have fired
    }));
});

describe("runIsland identity reuse", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("skips /api/islands and uses the supplied identity when `identity` is given", async () => {
    const calledIslands = vi.fn();
    vi.stubGlobal("fetch", async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/api/islands") calledIslands();
      if (u.pathname === "/api/next") {
        expect(u.searchParams.get("island")).toBe("isl-existing");
        return new Response(JSON.stringify({ kind: "idle" }), { headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected ${u.pathname}`);
    });
    const onJoined = vi.fn();
    const done = await runIsland({} as GPUDevice, {
      coordinator: "http://coord",
      host: { host: "t", adapter: "t" },
      identity: { id: "isl-existing", token: "tok-existing" },
      onJoined,
      maxTasks: 1,
    });
    expect(done).toBe(0);
    expect(calledIslands).not.toHaveBeenCalled();
    expect(onJoined).toHaveBeenCalledWith({ id: "isl-existing", token: "tok-existing" });
  });

  it("reports the fresh id/token via onJoined when no identity is supplied", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const path = new URL(url).pathname;
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (path === "/api/islands") return json({ id: "isl-new", token: "tok-new" });
      if (path === "/api/next") return json({ kind: "idle" });
      throw new Error(`unexpected ${path}`);
    });
    const onJoined = vi.fn();
    await runIsland({} as GPUDevice, { coordinator: "http://coord", host: { host: "t", adapter: "t" }, onJoined, maxTasks: 1 });
    expect(onJoined).toHaveBeenCalledWith({ id: "isl-new", token: "tok-new" });
  });
});

describe("uncalibrated threshold (refactor review 2)", () => {
  it("an explicit Infinity activity threshold survives a checkpoint round trip", () => {
    const inf = { ...spec, activityThreshold: Infinity };
    const observer = { ...good, settings: observerSettings(inf), activity: new ActivityTracker(Infinity).toJSON() };
    expect(observer.settings.activityThreshold).toBeNull();
    const { state, observer: back } = decodeArtifact(encodeCheckpoint(start, observer));
    expect(continuationError(inf, state, back)).toBeNull();
  });
});

// Review: the page saves its own metrics version when it joins, but a page
// that joined an older coordinator (which ignored the declared version) holds
// a v1 registration under a locally v2 identity; after the coordinator is
// upgraded, reusing it would idle on current work. The probe must check the
// version the coordinator actually recorded.
describe("probeIslandIdentity checks the registered metrics version", () => {
  const probeWith = async (status: number, body: unknown) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
    try {
      return await probeIslandIdentity("http://coord", "isl-1", "tok", new AbortController().signal, 5000);
    } finally {
      globalThis.fetch = realFetch;
    }
  };
  it("reuses a registration made under the current version", async () => {
    expect(await probeWith(200, { id: "isl-1", metrics_version: METRICS_VERSION })).toBe(200);
  });
  it("reports a registration without a version (joined before versions existed) or with another version as stale", async () => {
    expect(await probeWith(200, { id: "isl-1" })).toBe(STALE_REGISTRATION);
    expect(await probeWith(200, { id: "isl-1", metrics_version: METRICS_VERSION + 1 })).toBe(STALE_REGISTRATION);
  });
  it("passes other statuses through unchanged", async () => {
    expect(await probeWith(401, { error: "x" })).toBe(401);
  });
});

// Slice 15 (docs/garden-hardening-2026-10-18.md, item 1): a coordinator with a
// garden island token offers a garden's days only to islands that showed it at
// join. The token goes in the join body and nowhere else.

describe("garden token", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** One idle `/next` against a fake coordinator; returns every request (URL, headers, body). */
  async function requests(opts: { gardenToken?: string; identity?: { id: string; token: string }; polls?: number }) {
    const seen: { url: string; headers: Headers; body: string | undefined }[] = [];
    const controller = new AbortController();
    let polls = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      seen.push({ url, headers: new Headers(init.headers), body: init.body === undefined ? undefined : String(init.body) });
      const path = new URL(url).pathname;
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
      if (path === "/api/islands") return json({ id: "isl-AAAAAAAAAAAA", token: "T".repeat(43) });
      if (path === "/api/next") {
        if (++polls >= (opts.polls ?? 1)) controller.abort();
        return json({ kind: "idle" });
      }
      throw new Error(`unexpected ${path}`);
    });
    const logged: string[] = [];
    await runIsland({} as GPUDevice, {
      coordinator: "http://coord",
      host: { host: "t", adapter: "a" },
      idleMs: 1,
      signal: controller.signal,
      log: (m) => logged.push(m),
      gardenToken: opts.gardenToken,
      identity: opts.identity,
    });
    return { seen, logged };
  }

  it("join body carries gardenToken only when given", async () => {
    const join = async (gardenToken?: string) => {
      const { seen } = await requests({ gardenToken });
      const j = seen.find((r) => new URL(r.url).pathname === "/api/islands");
      return JSON.parse(j!.body!);
    };
    expect(await join("t")).toEqual({ adapter: "a", userAgent: "t", metricsVersion: METRICS_VERSION, gardenToken: "t" });
    for (const none of [undefined, ""]) {
      const body = await join(none);
      expect(body).toEqual({ adapter: "a", userAgent: "t", metricsVersion: METRICS_VERSION });
      expect("gardenToken" in body).toBe(false);
    }
  });

  it("never in /next bodies, any URL, any header or the log", async () => {
    const secret = "s3cret-garden";
    const { seen, logged } = await requests({ gardenToken: secret, polls: 3 });
    expect(seen.filter((r) => new URL(r.url).pathname === "/api/next")).toHaveLength(3);
    for (const r of seen) {
      expect(r.url).not.toContain(secret);
      for (const [, v] of r.headers) expect(v).not.toContain(secret);
      if (new URL(r.url).pathname !== "/api/islands") expect(r.body ?? "").not.toContain(secret);
    }
    expect(logged.join("\n")).not.toContain(secret);
  });

  it("a resumed identity makes no join and sends no token", async () => {
    const secret = "s3cret-garden";
    const { seen } = await requests({ gardenToken: secret, identity: { id: "isl-old", token: "tok-old" }, polls: 2 });
    expect(seen.some((r) => new URL(r.url).pathname === "/api/islands")).toBe(false);
    expect(JSON.stringify(seen.map((r) => [r.url, [...r.headers], r.body]))).not.toContain(secret);
  });

  it("gardenTokenFrom: flag over env, empty is none", () => {
    expect(gardenTokenFrom("f", "e")).toBe("f");
    expect(gardenTokenFrom(undefined, "e")).toBe("e");
    expect(gardenTokenFrom(null, "e")).toBe("e");
    expect(gardenTokenFrom(undefined, "")).toBeUndefined();
    expect(gardenTokenFrom(undefined, undefined)).toBeUndefined();
    // An explicit empty flag is "no token", even with the variable set.
    expect(gardenTokenFrom("", "e")).toBeUndefined();
  });

  it("fragment parse keeps other keys; origin rule withholds the token from another coordinator", () => {
    expect(gardenTokenFromHash("")).toEqual({ rest: "", found: false });
    expect(gardenTokenFromHash("#")).toEqual({ rest: "", found: false });
    expect(gardenTokenFromHash("#garden-token=abc")).toEqual({ token: "abc", rest: "", found: true });
    expect(gardenTokenFromHash("garden-token=abc")).toEqual({ token: "abc", rest: "", found: true });
    expect(gardenTokenFromHash("#a=1&garden-token=abc&b=2")).toEqual({ token: "abc", rest: "#a=1&b=2", found: true });
    expect(gardenTokenFromHash("#garden-token=a%2Bb%3D")).toEqual({ token: "a+b=", rest: "", found: true });
    expect(gardenTokenFromHash("#a=1")).toEqual({ token: undefined, rest: "#a=1", found: false });
    // An empty token is none, but the key is still stripped.
    expect(gardenTokenFromHash("#garden-token=&a=1")).toEqual({ token: undefined, rest: "#a=1", found: true });
    expect(gardenTokenFromHash("#garden-token&a=1")).toEqual({ token: undefined, rest: "#a=1", found: true });
    // A literal `+` is a plus (a token is not form data); `=` inside the value is kept.
    expect(gardenTokenFromHash("#garden-token=ab+cd")).toEqual({ token: "ab+cd", rest: "", found: true });
    expect(gardenTokenFromHash("#garden-token=a=b")).toEqual({ token: "a=b", rest: "", found: true });
    // A key spelt with percent escapes is the same key, and is found (so stripped).
    expect(gardenTokenFromHash("#%67arden-token=secret")).toEqual({ token: "secret", rest: "", found: true });
    expect(gardenTokenFromHash("#garden%2Dtoken=secret&x")).toEqual({ token: "secret", rest: "#x", found: true });
    // The rest of the fragment is kept byte for byte, keys without values included.
    expect(gardenTokenFromHash("#a/b&garden-token=x")).toEqual({ token: "x", rest: "#a/b", found: true });
    expect(gardenTokenFromHash("#foo&garden-token=x&c=%2F")).toEqual({ token: "x", rest: "#foo&c=%2F", found: true });
    expect(gardenTokenFromHash("#a/b")).toEqual({ token: undefined, rest: "#a/b", found: false });
    // A value that does not decode is taken as written.
    expect(gardenTokenFromHash("#garden-token=50%")).toEqual({ token: "50%", rest: "", found: true });

    expect(gardenTokenFor("https://cadence.garden", "https://cadence.garden", "t")).toBe("t");
    expect(gardenTokenFor("https://cadence.garden/", "https://cadence.garden", "t")).toBe("t");
    expect(gardenTokenFor("http://localhost:5173", "http://localhost:5173", "t")).toBe("t");
    expect(gardenTokenFor("http://localhost:4000", "http://localhost:5173", "t")).toBeUndefined();
    expect(gardenTokenFor("https://evil.example", "https://cadence.garden", "t")).toBeUndefined();
    expect(gardenTokenFor("http://cadence.garden", "https://cadence.garden", "t")).toBeUndefined();
    expect(gardenTokenFor("not a url", "https://cadence.garden", "t")).toBeUndefined();
    expect(gardenTokenFor("https://cadence.garden", "https://cadence.garden", undefined)).toBeUndefined();
    expect(gardenTokenFor("https://cadence.garden", "https://cadence.garden", "")).toBeUndefined();
  });

  it("gardenTokenForCoordinator: https or loopback only", () => {
    for (const c of ["https://cadence.garden", "https://10.0.0.5:4000", "http://localhost:4000", "http://127.0.0.1:4000", "http://127.1.2.3", "http://[::1]:4000", "http://app.localhost:4000"]) {
      expect(gardenTokenForCoordinator(c, "t"), c).toBe("t");
    }
    for (const c of ["http://cadence.garden", "http://10.0.0.5:4000", "http://localhost.evil.example", "http://127.0.0.1.evil.example", "ws://localhost:4000", "not a url"]) {
      expect(gardenTokenForCoordinator(c, "t"), c).toBeUndefined();
    }
    expect(gardenTokenForCoordinator("https://cadence.garden", "")).toBeUndefined();
    expect(gardenTokenForCoordinator("https://cadence.garden", undefined)).toBeUndefined();
  });

  /** A join answered by `respond`; returns the join's RequestInit and the error runIsland threw. */
  async function failedJoin(gardenToken: string | undefined, respond: () => Response) {
    let init: RequestInit | undefined;
    vi.stubGlobal("fetch", async (_url: string, i: RequestInit = {}) => {
      init = i;
      return respond();
    });
    const err = await runIsland({} as GPUDevice, { coordinator: "http://coord", host: { host: "t", adapter: "a" }, gardenToken }).then(
      () => undefined,
      (e: Error) => e,
    );
    return { init, err };
  }

  it("a join with a token follows no redirect; one without keeps fetch's default", async () => {
    const { init } = await failedJoin("t", () => new Response(null, { status: 307, headers: { location: "https://evil.example/api/islands" } }));
    expect(init?.redirect).toBe("manual");
    const plain = await failedJoin(undefined, () => new Response("no", { status: 500 }));
    expect(plain.init?.redirect).toBeUndefined();
  });

  it("a redirect answering a tokened join is refused, and named", async () => {
    const { err } = await failedJoin("t", () => new Response(null, { status: 308, headers: { location: "https://evil.example/" } }));
    expect(err?.message).toMatch(/^join: the coordinator answered with a redirect \(308\)/);
  });

  it("a refused tokened join never repeats a body that reflects the token", async () => {
    const secret = "s3cret-garden";
    const html = await failedJoin(secret, () => new Response(`<pre>%{"gardenToken" => "${secret}"}</pre>`, { status: 500, headers: { "content-type": "text/html" } }));
    expect(html.err?.message).toBe("join: 500 (response withheld: the join carried a garden token)");
    const echoed = await failedJoin(secret, () => Response.json({ error: `bad ${secret}` }, { status: 400 }));
    expect(echoed.err?.message).toBe("join: 400 (response withheld: the join carried a garden token)");
    // An echo that escapes the token (a JSON-encoded `"` here) is withheld too: no error string is repeated at all.
    const quoted = 'garden"secret';
    const escaped = await failedJoin(quoted, () => Response.json({ error: JSON.stringify({ gardenToken: quoted }) }, { status: 400 }));
    expect(escaped.err?.message).toBe("join: 400 (response withheld: the join carried a garden token)");
    expect(escaped.err?.message).not.toContain("secret");
    // The two refusals of normal running get a fixed description, so "no room" stays legible.
    const full = await failedJoin(secret, () => Response.json({ error: `the coordinator has no room ${secret}` }, { status: 503 }));
    expect(full.err?.message).toBe("join: 503 the coordinator has no room for new islands, or is unavailable");
    const limited = await failedJoin(secret, () => Response.json({ error: "too many requests from this address" }, { status: 429 }));
    expect(limited.err?.message).toBe("join: 429 too many joins or requests from this address; try later");
    // Without a token the body is repeated as before.
    const plain = await failedJoin(undefined, () => new Response("boom", { status: 500 }));
    expect(plain.err?.message).toBe("join: 500 boom");
  });

  it("an accepted tokened join whose answer is not an id and token quotes none of it", async () => {
    const secret = "garden-secret";
    // JSON.parse's own error would quote the body ('"garden-secret" is not valid JSON').
    const bare = await failedJoin(secret, () => new Response(secret, { status: 200 }));
    expect(bare.err?.message).toBe("join: 200 answer is not an island id and token (response withheld: the join carried a garden token)");
    const odd = await failedJoin(secret, () => Response.json({ echo: secret }, { status: 200 }));
    expect(odd.err?.message).toBe("join: 200 answer is not an island id and token (response withheld: the join carried a garden token)");
    // A reflected or malformed id or token is refused too: an id is logged, remembered and put in URLs.
    const good = { id: "isl-AAAAAAAAAAAA", token: "T".repeat(43) };
    for (const answer of [
      { ...good, id: secret },
      { ...good, id: "isl-short" },
      { ...good, token: `x\n${secret}` },
      { ...good, token: 42 },
    ]) {
      const r = await failedJoin(secret, () => Response.json(answer, { status: 200 }));
      expect(r.err?.message, JSON.stringify(answer)).toBe("join: 200 answer is not an island id and token (response withheld: the join carried a garden token)");
    }
    const reflectedToken = "B".repeat(43);
    const asToken = await failedJoin(reflectedToken, () => Response.json({ ...good, token: reflectedToken }, { status: 200 }));
    expect(asToken.err?.message).toBe("join: 200 answer is not an island id and token (response withheld: the join carried a garden token)");
    const asId = await failedJoin("CCCCCCCCCCCC", () => Response.json({ ...good, id: "isl-CCCCCCCCCCCC" }, { status: 200 }));
    expect(asId.err?.message).toBe("join: 200 answer is not an island id and token (response withheld: the join carried a garden token)");
    // A reflection padded to the right format is refused too.
    for (const [garden, answer] of [
      ["open-sesame", { ...good, id: "isl-open-sesameA" }],
      ["garden-secret", { ...good, token: `garden-secret${"A".repeat(30)}` }],
    ] as const) {
      const r = await failedJoin(garden, () => Response.json(answer, { status: 200 }));
      expect(r.err?.message, garden).toBe("join: 200 answer is not an island id and token (response withheld: the join carried a garden token)");
    }
    // Without a token the parser's error is unchanged.
    const plain = await failedJoin(undefined, () => new Response("boom", { status: 200 }));
    expect(plain.err?.message).toMatch(/JSON/);
  });
});
