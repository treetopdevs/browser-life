// Review 4: any defect in a predecessor's artifact must reject that
// predecessor (so the coordinator recomputes it) instead of failing the
// island. One artifact now carries physics and observer state together, so
// there is one fetch (`/start`) and every defect surfaces from decoding it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRESETS, encodeCheckpoint, initWorld, stateHash } from "@bl/schema";
import { ActivityTracker, Tracker, b64 } from "@bl/metrics";
import { continuationError, runIsland, specConfig, type ObserverState, type RunSpec } from "../src/index.ts";

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

describe("uncalibrated threshold (refactor review 2)", () => {
  it("an explicit Infinity activity threshold survives a checkpoint round trip", () => {
    const inf = { ...spec, activityThreshold: Infinity };
    const observer = { ...good, settings: observerSettings(inf), activity: new ActivityTracker(Infinity).toJSON() };
    expect(observer.settings.activityThreshold).toBeNull();
    const { state, observer: back } = decodeArtifact(encodeCheckpoint(start, observer));
    expect(continuationError(inf, state, back)).toBeNull();
  });
});
