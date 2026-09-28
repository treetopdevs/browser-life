import { describe, expect, it } from "vitest";
import { artifactDigest, encodeCheckpoint, soupWorld, stateHash, type WorldState } from "@bl/schema";
import { decodeArtifact, restoreObservers, serializeObservers, specConfig, type RunResult, type RunSpec } from "@bl/runner";
import {
  OBSERVATION_FILES, ObservationHashSink, buildReplayCache, parseMaxSeconds, replayBoundaries, sha256, verifyReplayCache,
  type ReplayStore, type SourceIdentity,
} from "../lib/foundation-replay.ts";

const enc = (text: string) => new TextEncoder().encode(text);
const copy = (bytes: Uint8Array) => bytes.slice();

class MemoryStore implements ReplayStore {
  reserved = false;
  files = new Map<string, Uint8Array>();
  async reserve() {
    if (this.reserved) throw new Error("output already exists");
    this.reserved = true;
  }
  async write(name: string, bytes: Uint8Array) {
    if (!this.reserved) throw new Error("output not reserved");
    if (name !== "manifest.json" && this.files.has(name)) throw new Error("overwrite refused");
    this.files.set(name, copy(bytes));
  }
  async read(name: string) {
    const bytes = this.files.get(name);
    if (!bytes) throw new Error(`missing ${name}`);
    return copy(bytes);
  }
}

function setup(finalHashOverride?: string) {
  const spec: RunSpec = { experiment: "pilot", presetId: "spots", condition: "treatment", seed: 7, steps: 10, censusEvery: 1, deepEvery: 1, checkpointEvery: 0, overrides: { tileW: 24, tileH: 24, kernelRadius: 2 } };
  const initial = soupWorld(specConfig(spec), 2, 32, 64);
  const settings = { censusEvery: 1, deepEvery: 1, activityThreshold: null };
  const observer = (step: number) => serializeObservers(restoreObservers(undefined, settings), step, settings);
  const final = { ...initial, step: 10 };
  const empty = sha256(enc(""));
  const files = Object.fromEntries(["manifest.json", "series.jsonl", "lineages.tsv", "mutations.tsv", "heredity.tsv", "life.jsonl", "activity-final.json"].map((name) => [name, empty]));
  const source: SourceIdentity = {
    runId: "pilot/spots/treatment/seed-7", spec, presetIdentity: "identity", versions: { schema: 3, rule: 1, metrics: 2 },
    finalHash: finalHashOverride ?? artifactDigest(final, observer(10)), finalHashMode: "artifact",
    files, codeRevision: "frozen", replayCodeFiles: { "runner.ts": sha256(enc("code")) },
  };
  let calls = 0;
  const segment = async (segmentSpec: RunSpec, _sink: unknown, start?: WorldState): Promise<RunResult> => {
    calls++;
    const end = (start?.step ?? 0) + segmentSpec.steps;
    const state = { ...(start ?? initial), step: end };
    return { final: state, observer: observer(end), summary: {
      steps: end, wallSeconds: 0, stepsPerSecond: 0, finalHash: artifactDigest(state, observer(end)),
      mutations: 0, fissions: 0, fusions: 0, buddings: 0, maxGeneration: 0,
      finalIndividuals: 0, finalLineages: 0, extinct: false, conservationOk: true,
    } };
  };
  return { source, segment, get calls() { return calls; }, initial, final };
}

describe("authenticated foundation replay cache", () => {
  it("requires a finite positive replay cap and defaults to 2700 seconds", () => {
    expect(parseMaxSeconds(undefined)).toBe(2700);
    expect(parseMaxSeconds("2.5")).toBe(2.5);
    for (const value of ["", "0", "-1", "NaN", "Infinity", "-Infinity"]) expect(() => parseMaxSeconds(value)).toThrow(/finite positive/);
  });

  it("streams six observation hashes across segments without duplicated headers", async () => {
    const sink = new ObservationHashSink();
    const expected: Record<string, string> = {};
    for (const name of OBSERVATION_FILES) {
      if (name === "activity-final.json") {
        await sink.writeText(name, "partial");
        expected[name] = "final";
      } else {
        await sink.writeText(name, "header\n");
        await sink.appendText(name, "first\n");
        expected[name] = "header\nfirst\nsecond\n";
      }
    }
    sink.nextSegment();
    for (const name of OBSERVATION_FILES) {
      if (name === "activity-final.json") await sink.writeText(name, "final");
      else {
        await sink.writeText(name, "header\n");
        await sink.appendText(name, "second\n");
      }
    }
    const digests = sink.digest();
    for (const name of OBSERVATION_FILES) expect(digests[name]).toEqual(sha256(enc(expected[name])));
  });

  it("rejects off-census, repeated or terminal samples", () => {
    const { source } = setup();
    expect(replayBoundaries(source.spec, [3, 7])).toEqual([3, 7, 10]);
    expect(() => replayBoundaries(source.spec, [3, 3])).toThrow(/unique/);
    expect(() => replayBoundaries(source.spec, [10])).toThrow(/interior/);
  });

  it("reserves before acquiring a runner, replays once across samples, and verifies the cached bytes", async () => {
    const store = new MemoryStore();
    const fixture = setup();
    const result = await buildReplayCache(store, fixture.source, [3, 7], async () => {
      expect(store.reserved).toBe(true);
      expect(store.files.has("manifest.json")).toBe(true);
      return fixture.segment;
    });
    expect(fixture.calls).toBe(3);
    expect(result).toMatchObject({ status: "verified", observerCompatible: true, final: { matchedSource: true, physicsHash: stateHash(fixture.final) } });
    expect(result.checkpoints.map((x) => x.step)).toEqual([3, 7]);
    expect((await verifyReplayCache(store, fixture.source)).status).toBe("verified");
    await expect(buildReplayCache(store, fixture.source, [3], async () => fixture.segment)).rejects.toThrow(/already exists/);
  });

  it("retains failed artifacts but never authenticates a terminal mismatch", async () => {
    const store = new MemoryStore();
    const fixture = setup("0".repeat(16));
    await expect(buildReplayCache(store, fixture.source, [3, 7], async () => fixture.segment)).rejects.toThrow(/terminal artifact digest mismatch/);
    const saved = JSON.parse(new TextDecoder().decode(await store.read("manifest.json")));
    expect(saved).toMatchObject({ status: "failed", final: { matchedSource: false } });
    expect(store.files.has("checkpoints/t000000003.blck")).toBe(true);
    await expect(verifyReplayCache(store)).rejects.toThrow(/not verified/);
  });

  it("detects truncation, corruption and source identity drift on readback", async () => {
    const store = new MemoryStore();
    const fixture = setup();
    await buildReplayCache(store, fixture.source, [3], async () => fixture.segment);
    const path = "checkpoints/t000000003.blck";
    const original = await store.read(path);
    store.files.set(path, original.slice(0, -4));
    await expect(verifyReplayCache(store, fixture.source)).rejects.toThrow(/SHA-256\/length mismatch/);
    const corrupt = copy(original);
    corrupt[24] ^= 0xff;
    store.files.set(path, corrupt);
    await expect(verifyReplayCache(store, fixture.source)).rejects.toThrow(/SHA-256\/length mismatch/);
    store.files.set(path, original);
    await expect(verifyReplayCache(store, { ...fixture.source, codeRevision: "changed" })).rejects.toThrow(/source identity mismatch/);
  });

  it("keeps the reserved directory and failure manifest if runner acquisition fails", async () => {
    const store = new MemoryStore();
    const fixture = setup();
    await expect(buildReplayCache(store, fixture.source, [3], async () => { throw new Error("GPU unavailable"); })).rejects.toThrow(/GPU unavailable/);
    expect(store.reserved).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(await store.read("manifest.json"))).status).toBe("failed");
  });

  it("rejects source drift after replay and preserves all pending checkpoints", async () => {
    const store = new MemoryStore();
    const fixture = setup();
    await expect(buildReplayCache(store, fixture.source, [3, 7], async () => fixture.segment, async () => {
      throw new Error("source files changed");
    })).rejects.toThrow(/source files changed/);
    expect(JSON.parse(new TextDecoder().decode(await store.read("manifest.json"))).status).toBe("failed");
    expect(store.files.has("checkpoints/t000000007.blck")).toBe(true);
  });

  it("reports observation mismatch separately from authenticated terminal state", async () => {
    const store = new MemoryStore();
    const fixture = setup();
    fixture.source.files["life.jsonl"] = sha256(enc("different observations"));
    const cache = await buildReplayCache(store, fixture.source, [3], async () => fixture.segment);
    expect(cache).toMatchObject({ status: "verified", observerCompatible: false, final: { matchedSource: true } });
    expect(cache.observationComparison?.["life.jsonl"].matched).toBe(false);
    expect((await verifyReplayCache(store, fixture.source)).observerCompatible).toBe(false);
  });

  it("does not publish verified status when cached bytes change during storage", async () => {
    const store = new MemoryStore();
    const write = store.write.bind(store);
    store.write = async (name, bytes) => {
      await write(name, bytes);
      if (name.endsWith(".blck")) store.files.set(name, bytes.slice(0, -4));
    };
    const fixture = setup();
    await expect(buildReplayCache(store, fixture.source, [3], async () => fixture.segment)).rejects.toThrow(/cached bytes failed readback/);
    expect(JSON.parse(new TextDecoder().decode(await store.read("manifest.json"))).status).toBe("failed");
  });

  it("retains a failed manifest when the cap fires between segments", async () => {
    const store = new MemoryStore();
    const fixture = setup();
    const metadata = { maxSeconds: 1, startedAt: "2026-09-28T00:00:00Z", host: "test", adapter: null };
    await expect(buildReplayCache(store, fixture.source, [3, 7], async () => fixture.segment, async () => {},
      (stage) => { if (stage === "before segment ending 7") throw new Error("time cap exceeded"); }, metadata)).rejects.toThrow(/time cap exceeded/);
    const saved = JSON.parse(new TextDecoder().decode(await store.read("manifest.json")));
    expect(saved).toMatchObject({ status: "failed", failure: "time cap exceeded", runMetadata: metadata });
    expect(store.files.has("checkpoints/t000000003.blck")).toBe(true);
  });

  it("rejects reordered sample steps and a falsified terminal step in the manifest", async () => {
    const store = new MemoryStore();
    const fixture = setup();
    await buildReplayCache(store, fixture.source, [3, 7], async () => fixture.segment);
    const original = await store.read("manifest.json");
    const changed = JSON.parse(new TextDecoder().decode(original));
    changed.requestedSteps = [7, 3];
    store.files.set("manifest.json", enc(JSON.stringify(changed)));
    await expect(verifyReplayCache(store, fixture.source)).rejects.toThrow(/unordered/);
    changed.requestedSteps = [3, 7];
    changed.final.step = 9;
    store.files.set("manifest.json", enc(JSON.stringify(changed)));
    await expect(verifyReplayCache(store, fixture.source)).rejects.toThrow(/terminal step\/path mismatch/);
  });

  it("rejects a rehashed but foreign-config checkpoint", async () => {
    const store = new MemoryStore();
    const fixture = setup();
    await buildReplayCache(store, fixture.source, [3], async () => fixture.segment);
    const path = "checkpoints/t000000003.blck";
    const decoded = decodeArtifact(await store.read(path));
    const foreignState = { ...decoded.state, cfg: { ...decoded.state.cfg, seed: 8 } };
    const foreignBytes = encodeCheckpoint(foreignState, decoded.observer);
    store.files.set(path, foreignBytes);
    const changed = JSON.parse(new TextDecoder().decode(await store.read("manifest.json")));
    changed.checkpoints[0].fileDigest = sha256(foreignBytes);
    changed.checkpoints[0].physicsHash = stateHash(foreignState);
    changed.checkpoints[0].artifactHash = artifactDigest(foreignState, decoded.observer);
    store.files.set("manifest.json", enc(JSON.stringify(changed)));
    await expect(verifyReplayCache(store, fixture.source)).rejects.toThrow(/start state config differs/);
  });
});
