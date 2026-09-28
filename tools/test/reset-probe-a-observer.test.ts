import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PRESETS, artifactDigest, cloneState, encodeCheckpoint, initWorld, stateHash,
  type WorldState } from "@bl/schema";
import { b64 } from "@bl/metrics";
import { observeCensus, observerSettings, restoreObservers, serializeObservers, specConfig,
  type RunSpec } from "@bl/runner";
import { ResetProbeAObserver, type ResetCheckpointIdentity } from
  "../lib/reset-probe-a-observer.ts";

const spec: RunSpec = { experiment: "reset-control", presetId: "gradient-m3",
  condition: "treatment", seed: 17, steps: 300, censusEvery: 100,
  deepEvery: 10, checkpointEvery: 100 };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const snapshot = (state: WorldState) => ({ step: state.step,
  cells: state.cells, genomeHead: state.genome });
function fixture() {
  const preset = PRESETS.find(p => p.id === spec.presetId)!;
  const init = initWorld(specConfig(spec), preset.init);
  const one = cloneState(init); one.step = 100;
  const original = restoreObservers(undefined, observerSettings(spec));
  observeCensus(original, one.cfg, snapshot(one), 0);
  const observer = serializeObservers(original, one.step, observerSettings(spec));
  const bytes = encodeCheckpoint(one, observer);
  const identity: ResetCheckpointIdentity = { bytesSha256: sha(bytes),
    physicsHash: stateHash(one), artifactDigest: artifactDigest(one, observer) };
  return { init, one, original, bytes, identity };
}

describe("Probe A original-observer restoration", () => {
  it("starts from the pinned preset and requires physical prior-census parent support", () => {
    const { init } = fixture();
    const fresh = ResetProbeAObserver.fromFresh(spec, stateHash(init));
    expect(stateHash(fresh.state)).toBe(stateHash(init));
    expect(() => fresh.adapter.parentSites(1)).toThrow(/lacks one prior/);
    const one = cloneState(init); one.step = 100;
    fresh.adapter.observeNext(snapshot(one), 0);
    expect(fresh.adapter.parentSites(1).length).toBeGreaterThan(0);
    expect(() => ResetProbeAObserver.fromFresh(spec, "0000000000000000"))
      .toThrow(/initial physics/);
  });

  it("restores saved tracker membership and reproduces a later full observer artifact", () => {
    const { one, original, bytes, identity } = fixture();
    const restored = ResetProbeAObserver.fromCheckpoint(bytes, spec, identity);
    expect(stateHash(restored.state)).toBe(identity.physicsHash);
    expect(restored.adapter.parentSites(1).length).toBeGreaterThan(0);
    const two = cloneState(one); two.step = 200;
    restored.adapter.observeNext(snapshot(two), 0);
    observeCensus(original, two.cfg, snapshot(two), 0);
    const terminalObserver = serializeObservers(original, two.step, observerSettings(spec));
    const terminalBytes = encodeCheckpoint(two, terminalObserver);
    const terminalIdentity: ResetCheckpointIdentity = { bytesSha256: sha(terminalBytes),
      physicsHash: stateHash(two), artifactDigest: artifactDigest(two, terminalObserver) };
    expect(restored.adapter.verifyCheckpoint(two, terminalBytes, terminalIdentity))
      .toEqual(terminalObserver);
  });

  it("rejects changed source bytes and tracker labels even when re-encoded", () => {
    const { one, original, bytes, identity } = fixture();
    expect(() => ResetProbeAObserver.fromCheckpoint(bytes, spec,
      { ...identity, bytesSha256: "0".repeat(64) })).toThrow(/SHA-256/);
    const bad = serializeObservers(original, 100, observerSettings(spec));
    const labels = new Int32Array(one.cells.length / 7).fill(-1);
    bad.tracker.prevLabels = b64(new Uint8Array(labels.buffer));
    const recoded = encodeCheckpoint(one, bad);
    const recodedIdentity: ResetCheckpointIdentity = { bytesSha256: sha(recoded),
      physicsHash: stateHash(one), artifactDigest: artifactDigest(one, bad) };
    expect(() => ResetProbeAObserver.fromCheckpoint(recoded, spec, recodedIdentity))
      .toThrow(/prior labels differ/);
  });
});
