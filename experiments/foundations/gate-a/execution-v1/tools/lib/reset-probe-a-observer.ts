/** Restore the original common observer and bind parent support to a physical census. */
import { createHash } from "node:crypto";
import { PRESETS, artifactDigest, cellCount, initWorld, stateHash,
  type WorldConfig, type WorldState } from "@bl/schema";
import { census, unb64, type Census } from "@bl/metrics";
import { continuationError, decodeArtifact, observeCensus, observerSettings, specConfig,
  restoreObservers, serializeObservers, type ObserverState, type RunSpec,
  type CensusObservation, type Observers } from "@bl/runner";

export interface ResetCheckpointIdentity {
  bytesSha256: string;
  physicsHash: string;
  artifactDigest: string;
}
export type ResetParentSupport = {
  status: "available"; referenceStep: number; parentId: number;
  sites: number[]; sitesSha256: string;
} | {
  status: "unavailable"; referenceStep: number; parentId: number;
  reason: "absent-prior-census" | "ambiguous-prior-components";
};
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sameLabels = (a: Int32Array, b: Int32Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

function physicalCensus(state: WorldState, opt: Observers["tracker"]["opt"]): Census {
  const n = cellCount(state.cfg);
  return census({ cfg: state.cfg, step: state.step, cells: state.cells,
    genomeHead: state.genome.subarray(0, 4 * n) }, opt);
}

export class ResetProbeAObserver {
  readonly spec: RunSpec;
  readonly sourceIdentity: ResetCheckpointIdentity | null;
  private readonly cfg: WorldConfig;
  private obs: Observers;
  private current: Census;
  private step: number;

  private constructor(spec: RunSpec, identity: ResetCheckpointIdentity | null,
    obs: Observers, current: Census, cfg: WorldConfig) {
    this.spec = spec; this.sourceIdentity = identity; this.obs = obs;
    this.current = current; this.step = current.step; this.cfg = cfg;
  }

  /** Step-zero history start, with the original preset/config and pinned init physics. */
  static fromFresh(spec: RunSpec, expectedInitialPhysicsHash: string):
    { adapter: ResetProbeAObserver; state: WorldState } {
    const preset = PRESETS.find(p => p.id === spec.presetId);
    if (!preset) throw new Error("fresh reset history has unknown preset");
    const cfg = specConfig(spec), state = initWorld(cfg, preset.init);
    if (state.step !== 0 || stateHash(state) !== expectedInitialPhysicsHash)
      throw new Error("fresh reset history differs from pinned original initial physics");
    const obs = restoreObservers(undefined, observerSettings(spec));
    return { adapter: new ResetProbeAObserver(spec, null, obs,
      physicalCensus(state, obs.tracker.opt), cfg), state };
  }

  static fromCheckpoint(bytes: Uint8Array, spec: RunSpec,
    identity: ResetCheckpointIdentity): { adapter: ResetProbeAObserver; state: WorldState } {
    if (sha(bytes) !== identity.bytesSha256)
      throw new Error("original observer checkpoint file SHA-256 mismatch");
    const { state, observer } = decodeArtifact(bytes);
    if (stateHash(state) !== identity.physicsHash ||
        artifactDigest(state, observer) !== identity.artifactDigest)
      throw new Error("original observer checkpoint physics/artifact digest mismatch");
    const continuation = continuationError(spec, state, observer);
    if (continuation) throw new Error(`original observer cannot continue: ${continuation}`);
    const obs = restoreObservers(observer, observerSettings(spec));
    const c = physicalCensus(state, obs.tracker.opt);
    const raw = observer.tracker.prevLabels;
    if (raw === null) throw new Error("checkpoint has no prior physical census membership");
    const saved = new Int32Array(unb64(raw).buffer);
    if (!sameLabels(saved, c.labels))
      throw new Error("original tracker prior labels differ from checkpoint physical components");
    for (const [idx] of observer.tracker.prevIds)
      if (idx >= c.components.length || c.components[idx].mass < obs.tracker.opt.minMass)
        throw new Error("original tracker component identity lacks physical support");
    return { adapter: new ResetProbeAObserver(spec, identity, obs, c, state.cfg), state };
  }

  /** Actual prior-census membership, with absence retained as data. */
  parentSupport(parentId: number): ResetParentSupport {
    if (!Number.isSafeInteger(parentId) || parentId <= 0)
      throw new Error("invalid observer parent id");
    const components = new Set<number>();
    for (const c of this.current.components)
      if (this.obs.tracker.idOf(c.idx) === parentId) components.add(c.idx);
    if (components.size !== 1) return { status: "unavailable", referenceStep: this.step,
      parentId, reason: components.size === 0 ? "absent-prior-census" :
        "ambiguous-prior-components" };
    const sites: number[] = [];
    for (let i = 0; i < this.current.labels.length; i++)
      if (components.has(this.current.labels[i])) sites.push(i);
    if (!sites.length) throw new Error("attributed parent physical support is empty");
    return { status: "available", referenceStep: this.step, parentId, sites,
      sitesSha256: createHash("sha256").update(JSON.stringify({ step: this.step,
        parentId, sites })).digest("hex") };
  }

  parentSites(parentId: number): number[] {
    const support = this.parentSupport(parentId);
    if (support.status !== "available")
      throw new Error("attributed observer parent lacks one prior physical component");
    return support.sites;
  }

  componentForTrackerId(id: number): number | null {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("invalid observer identity");
    const components = this.current.components.filter(c => this.obs.tracker.idOf(c.idx) === id);
    if (components.length > 1) throw new Error("observer identity has ambiguous components");
    return components[0]?.idx ?? null;
  }

  /** Advance the unchanged runner observer at its actual census cadence. */
  observeNext(snapshot: { step: number; cells: Uint32Array; genomeHead: Uint32Array },
    mutationCount: number): CensusObservation {
    if (snapshot.step !== this.step + this.spec.censusEvery ||
        !Number.isSafeInteger(mutationCount) || mutationCount < 0)
      throw new Error("original observer census step or mutation count is invalid");
    const result = observeCensus(this.obs, this.cfg, snapshot, mutationCount);
    this.current = result.census; this.step = snapshot.step;
    return result;
  }

  /** Full original common-observer artifact comparison at a saved boundary. */
  verifyCheckpoint(state: WorldState, sourceBytes: Uint8Array,
    sourceIdentity: ResetCheckpointIdentity): ObserverState {
    if (state.step !== this.step || sha(sourceBytes) !== sourceIdentity.bytesSha256)
      throw new Error("observer checkpoint boundary or source file changed");
    const original = decodeArtifact(sourceBytes);
    if (stateHash(original.state) !== sourceIdentity.physicsHash ||
        artifactDigest(original.state, original.observer) !== sourceIdentity.artifactDigest ||
        stateHash(state) !== sourceIdentity.physicsHash)
      throw new Error("observer checkpoint physics/artifact source mismatch");
    const current = serializeObservers(this.obs, this.step, observerSettings(this.spec));
    if (artifactDigest(state, current) !== sourceIdentity.artifactDigest)
      throw new Error("replayed common observer differs from original checkpoint artifact");
    return current;
  }

  get currentStep(): number { return this.step; }
  get census(): Census { return this.current; }
  observerState(): ObserverState {
    return serializeObservers(this.obs, this.step, observerSettings(this.spec));
  }
}
