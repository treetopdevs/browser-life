// Review 4: any defect in a predecessor's artifact must reject that
// predecessor (so the coordinator recomputes it) instead of failing the
// island. One artifact now carries physics and observer state together, so
// there is one fetch (`/start`) and every defect surfaces from decoding it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESETS, encodeCheckpoint, initWorld, stateHash } from "@bl/schema";
import { ActivityTracker, Tracker, b64 } from "@bl/metrics";
import { continuationError, decideRejoin, probeIslandIdentity, resolveRejoin, runIsland, specConfig, timeoutSignal, type ObserverState, type RunSpec } from "../src/index.ts";

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
async function attempt(startBytes: Uint8Array): Promise<string[]> {
  const rejects: string[] = [];
  let served = false;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
    if (path === "/api/islands") return json({ id: "isl", token: "tok" });
    if (path === "/api/next") {
      if (served) return json({ kind: "idle" });
      served = true;
      return json({ kind: "run", lease: "L", segment: { id: "seg-1", run: "r", index: 1, startStep: 500, steps: 500 }, spec, startFrom: "seg-0", startHash: stateHash(start) });
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
});

describe("island idle wait", () => {
  afterEach(() => vi.unstubAllGlobals());

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
