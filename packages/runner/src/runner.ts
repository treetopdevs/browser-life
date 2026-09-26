// Host-agnostic experiment runner. Runs one (preset, condition, seed) history
// on a WebGPU device and writes a run bundle through a Sink:
//
//   manifest.json      spec, config, versions, host, checkpoint hashes, summary
//   series.jsonl       one record per census (population, ecology, activity, complexity)
//   mutations.tsv      childHi childLo parentHi parentLo (complete phylogeny)
//   lineages.tsv       step, lineage, cells (per-census abundance; activity analysis)
//   life.jsonl         inferred life events (fission, fusion, budding, birth, death)
//   heredity.tsv       step, trait pairs of sibling pieces at fission
//   checkpoints/*.blck periodic snapshots (optional)

import {
  PRESETS,
  cellCount,
  RULE_VERSION,
  SCHEMA_VERSION,
  artifactDigest,
  decodeCheckpoint,
  encodeCheckpoint,
  initWorld,
  presetConfig,
  stateHash,
  totalsOf,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { GpuSim } from "@bl/sim-gpu";
import { migrateAtBoundary } from "./migrate.ts";
import {
  ActivityTracker,
  Tracker,
  bioticRecycling,
  compressionRatio,
  entropy,
  fluxRates,
  individuals,
  lineageBytes,
  lineageProfiles,
  morphology,
  roleSummary,
  temporalMI,
  DEFAULT_CENSUS,
  unb64,
  type ActivityState,
  type TrackerState,
} from "@bl/metrics";
import { conditionById } from "./conditions.ts";
import { observeCensus, restoreObservers, serializeObservers } from "./observe.ts";

export interface RunSpec {
  experiment: string;
  presetId: string;
  condition: string;
  seed: number;
  steps: number;
  censusEvery: number;
  /** Role/complexity metrics every k censuses (they cost extra readback). */
  deepEvery: number;
  /** 0 disables periodic checkpoints. */
  checkpointEvery: number;
  /** Activity threshold (from neutral runs); Infinity collects distributions only. */
  activityThreshold?: number;
  /** Optional world overrides applied after the condition. */
  overrides?: Partial<WorldConfig>;
}

export interface Sink {
  writeText(path: string, text: string): Promise<void>;
  appendText(path: string, text: string): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
}

export interface HostInfo {
  host: string;
  adapter: string;
}

export interface RunSummary {
  steps: number;
  wallSeconds: number;
  stepsPerSecond: number;
  /** `artifactDigest(final, observer)` — physics and observer together. */
  finalHash: string;
  mutations: number;
  fissions: number;
  fusions: number;
  buddings: number;
  maxGeneration: number;
  finalIndividuals: number;
  finalLineages: number;
  extinct: boolean;
  conservationOk: boolean;
}

/** Observation settings; continuing with different settings is an error. */
export interface ObserverSettings {
  censusEvery: number;
  deepEvery: number;
  activityThreshold: number | null;
}

/**
 * Everything the observers carry between segments of one run. Lives in the
 * same artifact as the physics state it observes (see `@bl/schema`'s
 * `encodeCheckpoint`/`decodeCheckpoint`), so there is no separate digest for
 * "does this observer belong to this state" — `step` is kept only as a cheap
 * intrinsic self-consistency check (see `decodeArtifact`), not a second
 * cross-artifact identity.
 */
export interface ObserverState {
  step: number;
  settings: ObserverSettings;
  tracker: TrackerState;
  activity: ActivityState;
  mutations: number;
  buddings: number;
  censusIdx: number;
  extinct: boolean;
  prevSym: string | null;
}

export interface RunOptions {
  /** Start from this state (a segment of a longer run) instead of the preset's initial world. */
  start?: WorldState;
  /** Observer state saved by the previous segment (must match `start.step`). */
  observer?: ObserverState;
  /** Return the final state (islands upload it as the next segment's start). */
  keepFinal?: boolean;
}

export interface RunResult {
  summary: RunSummary;
  final?: WorldState;
  observer: ObserverState;
}

const posInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;

/** Rejects run specs that would loop forever, skip checkpoints or read out of range. */
export function validateSpec(spec: RunSpec): string[] {
  const errs: string[] = [];
  if (!spec.experiment || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(spec.experiment)) errs.push("experiment must match [a-z0-9_-]{1,64}");
  if (!posInt(spec.steps)) errs.push("steps must be a positive integer");
  if (!posInt(spec.censusEvery)) errs.push("censusEvery must be a positive integer");
  if (!posInt(spec.deepEvery)) errs.push("deepEvery must be a positive integer");
  if (!Number.isInteger(spec.seed) || spec.seed < 0 || spec.seed > 0xffffffff) errs.push("seed must be a u32");
  if (!Number.isInteger(spec.checkpointEvery) || spec.checkpointEvery < 0) errs.push("checkpointEvery must be a non-negative integer");
  else if (spec.checkpointEvery > 0 && spec.checkpointEvery % spec.censusEvery !== 0) errs.push("checkpointEvery must be a multiple of censusEvery");
  if (spec.activityThreshold !== undefined && !(spec.activityThreshold > 0)) errs.push("activityThreshold must be positive");
  return errs;
}

export function sameConfig(a: WorldConfig, b: WorldConfig): boolean {
  const keys = Object.keys(a).sort();
  return keys.length === Object.keys(b).length && keys.every((k) => a[k as keyof WorldConfig] === b[k as keyof WorldConfig]);
}

export function specConfig(spec: RunSpec): WorldConfig {
  const preset = PRESETS.find((p) => p.id === spec.presetId);
  if (!preset) throw new Error(`unknown preset ${spec.presetId}`);
  const base = presetConfig(preset, spec.seed);
  const cond = conditionById(spec.condition);
  // spec.overrides wins last, so e.g. { adhesion: true } re-enables adhesion even under no-signal-motility.
  return { ...base, ...cond.apply(base), ...(spec.overrides ?? {}) };
}

/** Observation settings as stored in artifacts: an infinite (uncalibrated) threshold is `null`, as in JSON. */
export function observerSettings(spec: RunSpec): ObserverSettings {
  const t = spec.activityThreshold;
  return { censusEvery: spec.censusEvery, deepEvery: spec.deepEvery, activityThreshold: t !== undefined && Number.isFinite(t) ? t : null };
}

/**
 * Field-by-field, not `JSON.stringify` comparison: `artifactDigest`/
 * `canonicalObserverJSON` (`@bl/schema`) already sort observer keys
 * recursively before digesting, so two artifacts the content-addressed
 * coordinator store treats as identical (same digest) can still decode to
 * `settings` objects with different key insertion order (whatever order the
 * writer's `JSON.stringify(observer)` happened to produce). Comparing that
 * raw serialization here would reject a perfectly valid continuation — and
 * since the store keeps only the first upload for a given digest, a
 * differently-ordered "bad" copy landing first can never be replaced by a
 * "good" recompute (same content, same digest, discarded by
 * `Coordinator.Store.put/3`), making the rejection permanent.
 */
function sameSettings(a: ObserverSettings, b: ObserverSettings): boolean {
  return a.censusEvery === b.censusEvery && a.deepEvery === b.deepEvery && a.activityThreshold === b.activityThreshold;
}

/**
 * Why a start state and observer state cannot continue `spec`, or null when
 * they can. Only checks run-context compatibility — that this artifact,
 * however it decoded, is the *right* one for this run: same config, same
 * observation settings. Everything artifact-intrinsic (tracker referential
 * integrity, settings/counter shape, label count, `prevSym` decodability) is
 * `decodeArtifact`'s job, not this function's — an artifact that decodes
 * cleanly can still be the wrong artifact for this run, which is what this
 * checks. Called both after `decodeArtifact` (island.ts, on bytes from the
 * network) and directly on an in-memory `RunOptions.start`/`observer` pair
 * (this function, continuing a run without ever touching bytes) — in the
 * latter case the observer came straight from a previous `runExperiment`
 * call's own return value, so it is already well-formed by construction.
 */
export function continuationError(spec: RunSpec, start: WorldState, observer: ObserverState | undefined): string | null {
  if (!sameConfig(start.cfg, specConfig(spec))) return "start state config differs from the run spec";
  if (start.step === 0) return null;
  if (!observer || typeof observer !== "object") return "continuing from a checkpoint requires the matching observer state";
  if (observer.step !== start.step) return `observer state does not belong to the start checkpoint (t=${observer.step})`;
  if (!sameSettings(observer.settings, observerSettings(spec))) return "observer settings differ from the run spec";
  return null;
}

const posIntOrThrow = (v: unknown, what: string) => {
  if (!posInt(v)) throw new Error(`checkpoint: observer ${what} is malformed`);
  return v as number;
};
const safeIntGe0 = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

/** Structural validation of a decoded observer section's shape, nothing domain-specific yet. */
function validateObserverShape(raw: unknown): ObserverState {
  if (!raw || typeof raw !== "object") throw new Error("checkpoint: observer section is not an object");
  const o = raw as Partial<ObserverState> & Record<string, unknown>;
  if (!safeIntGe0(o.step)) throw new Error("checkpoint: observer step is malformed");
  const s = o.settings as Partial<ObserverSettings> | undefined;
  if (!s || typeof s !== "object") throw new Error("checkpoint: observer settings is malformed");
  posIntOrThrow(s.censusEvery, "settings.censusEvery");
  posIntOrThrow(s.deepEvery, "settings.deepEvery");
  if (!(s.activityThreshold === null || typeof s.activityThreshold === "number")) throw new Error("checkpoint: observer settings.activityThreshold is malformed");
  if (!safeIntGe0(o.mutations) || !safeIntGe0(o.buddings) || !safeIntGe0(o.censusIdx)) throw new Error("checkpoint: observer counters are malformed");
  if (typeof o.extinct !== "boolean") throw new Error("checkpoint: observer extinct flag is malformed");
  if (o.prevSym != null && typeof o.prevSym !== "string") throw new Error("checkpoint: observer prevSym is malformed");
  return o as ObserverState;
}

/**
 * The single "parse, don't validate" loader for a checkpoint artifact.
 * Decodes the wire bytes (`@bl/schema`'s `decodeCheckpoint`: bytes-intrinsic
 * checks only) and then performs every check that depends on the observer's
 * domain types: settings/counter shape, tracker referential integrity
 * (`Tracker.fromJSON`, which already does this — not reimplemented here),
 * activity shape (`ActivityTracker.fromJSON`), component-label count against
 * the decoded state's cell count, `prevSym` decodability, and the artifact's
 * own step self-consistency (`observer.step === state.step` — always true
 * for an artifact this codebase wrote; checked anyway since nothing else
 * guarantees it for bytes from elsewhere). Every caller gets back a fully
 * validated `{state, observer}` or an exception naming the defect; no call
 * site outside this function parses raw JSON or bytes from an artifact.
 */
export function decodeArtifact(bytes: Uint8Array): { state: WorldState; observer: ObserverState } {
  const { state, observer: raw } = decodeCheckpoint(bytes);
  const observer = validateObserverShape(raw);
  if (observer.step !== state.step) throw new Error(`checkpoint: observer step ${observer.step} does not match state step ${state.step}`);
  try {
    const t = Tracker.fromJSON(observer.tracker);
    if (observer.tracker.prevLabels !== null && t.labelCount() !== cellCount(state.cfg)) throw new Error("observer component labels do not cover the world");
    ActivityTracker.fromJSON(observer.activity);
    if (observer.prevSym != null) unb64(observer.prevSym);
  } catch (e) {
    throw new Error(`checkpoint: observer state cannot be restored: ${(e as Error).message}`);
  }
  return { state, observer };
}

export function runId(spec: RunSpec): string {
  return `${spec.experiment}/${spec.presetId}/${spec.condition}/seed-${spec.seed}`;
}

export async function runExperiment(
  device: GPUDevice,
  spec: RunSpec,
  sink: Sink,
  host: HostInfo,
  onProgress: (msg: string) => void = () => {},
  opts: RunOptions = {},
): Promise<RunResult> {
  const errs = validateSpec(spec);
  if (errs.length) throw new Error(`invalid run spec: ${errs.join("; ")}`);
  const preset = PRESETS.find((p) => p.id === spec.presetId)!;
  const cfg = specConfig(spec);
  // Migration fires on multiples of the *absolute* step (see migration.ts), checked once
  // per census chunk: requiring it to land on a census boundary keeps a segmented run's
  // migration events at the same absolute steps as a continuous run's (the stitching
  // invariant tests/deno/stitch.ts checks), exactly like checkpointEvery's own rule below.
  const migrationPeriod = cfg.migrationPeriod ?? 0;
  if (migrationPeriod > 0 && migrationPeriod % spec.censusEvery !== 0) throw new Error("migrationPeriod must be a multiple of censusEvery");
  const init = opts.start ?? initWorld(cfg, preset.init);
  const startStep = init.step;
  // The step loop below re-chunks in `censusEvery`-sized steps *relative to
  // this call's own start* (unchanged from before migration existed, so a
  // migration-disabled continuation from any step -- aligned or not -- keeps
  // behaving exactly as it always has). That only lands on the same absolute
  // steps a continuous run would when `startStep` is itself already a
  // multiple of `censusEvery`, so a migration-enabled run requires it: a
  // fresh run starts at step 0, and the coordinator only ever hands out
  // segments whose segmentSteps -- and hence every startStep -- is a
  // multiple of censusEvery (Coordinator.Queue.validate/1's cadence checks),
  // so this loses nothing any real caller produces, only an off-grid start no
  // legitimate one does. (migrationPeriod is already required to be a
  // multiple of censusEvery, above, so this one condition is also enough to
  // guarantee migration itself lands on the right absolute steps -- no
  // separate "multiple of migrationPeriod" check is needed.)
  if (migrationPeriod > 0 && startStep % spec.censusEvery !== 0)
    throw new Error(`migration-enabled runs must start on a multiple of censusEvery (start step ${startStep}, censusEvery ${spec.censusEvery})`);
  const settings = observerSettings(spec);
  if (opts.start) {
    const bad = continuationError(spec, opts.start, opts.observer);
    if (bad) throw new Error(bad);
  }
  const t0tot = totalsOf(cfg, init.cells);
  // Ledger baseline: content + exported heat - absorbed light is invariant.
  const baseline = t0tot.energy + init.heatOut - init.lightIn;
  const startMatter = t0tot.matter;
  const sim = await GpuSim.create(device, init);
  const obs = restoreObservers(opts.observer, settings);
  const { tracker, activity } = obs;
  const manifest = {
    runId: runId(spec),
    spec,
    cfg,
    init: preset.init,
    schemaVersion: SCHEMA_VERSION,
    ruleVersion: RULE_VERSION,
    host,
    startStep,
    startedAt: new Date().toISOString(),
    checkpoints: [] as { step: number; file: string; hash: string }[],
    summary: null as RunSummary | null,
  };
  await sink.writeText("manifest.json", JSON.stringify(manifest, null, 2));
  await sink.writeText("mutations.tsv", "childHi\tchildLo\tparentHi\tparentLo\n");
  await sink.writeText("lineages.tsv", "step\tlineage\tcells\n");
  await sink.writeText("heredity.tsv", "step\tmuA\tmuB\tsigmaA\tsigmaB\tmassA\tmassB\n");
  await sink.writeText("series.jsonl", "");
  await sink.writeText("life.jsonl", "");
  // Only written when migration is configured, so a migration-disabled run's bundle is
  // byte-for-byte what it was before this file existed (no empty header appears either).
  if (migrationPeriod > 0) await sink.writeText("migrations.tsv", "step\tslot\tfromTile\ttoTile\tfromCell\ttoCell\tmatter\tlineageHi\tlineageLo\n");

  const t0 = performance.now();
  let prevFlux = init.flux.slice();
  let conservationOk = true;
  let lastCensus = { individuals: 0, lineages: 0 };

  try {
    for (let s = 0; s < spec.steps; ) {
      const chunk = Math.min(spec.censusEvery, spec.steps - s);
      const deep = obs.censusIdx % spec.deepEvery === 0;
      for (let k = 0; k < chunk; k += 64) sim.run(Math.min(64, chunk - k));
      s += chunk;
      await device.queue.onSubmittedWorkDone();

      const ledger = await sim.drainLedger();
      if (ledger.dropped > 0) throw new Error(`event buffer overflow (${ledger.dropped} dropped); lower censusEvery`);
      if (ledger.events.length)
        await sink.appendText("mutations.tsv", ledger.events.map((e) => `${e.childHi}\t${e.childLo}\t${e.parentHi}\t${e.parentLo}`).join("\n") + "\n");

      // Nothing else is queued, so these readbacks all describe the same step.
      const [snap, stats] = await Promise.all([sim.readSnapshot(deep), sim.readStats()]);
      const { cells, genomeHead } = snap;
      if (snap.step !== stats.step) throw new Error("snapshot and stats disagree on the step");
      const matter = stats.A + stats.B + stats.C + stats.P;
      const energy = stats.A * BigInt(cfg.eA) + stats.B * BigInt(cfg.eB) + stats.C * BigInt(cfg.eC) + stats.P * BigInt(cfg.eP) + stats.E + stats.S;
      const residual = energy + stats.heatOut - stats.lightIn - baseline;
      if (matter !== startMatter || residual !== 0n) conservationOk = false;

      const o = observeCensus(obs, cfg, snap, ledger.events.length);
      const { census: c, activity: act, sym } = o;
      for (const e of o.events) {
        if (e.kind !== "fission") continue;
        const a = obs.tracker.alive.get(e.parent);
        for (const id of e.children) {
          const b = obs.tracker.alive.get(id);
          if (a && b) await sink.appendText("heredity.tsv", `${c.step}\t${a.mu}\t${b.mu}\t${a.sigma}\t${b.sigma}\t${a.mass}\t${b.mass}\n`);
        }
      }
      if (o.life.length) await sink.appendText("life.jsonl", o.life.map((x) => JSON.stringify(x)).join("\n") + "\n");
      await sink.appendText("lineages.tsv", c.lineages.map((l) => `${c.step}\t${l.key}\t${l.cells}`).join("\n") + (c.lineages.length ? "\n" : ""));

      const rates = fluxRates(prevFlux, stats.flux, chunk);
      prevFlux = stats.flux;
      const ind = individuals(c);
      const totalMass = c.lineages.reduce((a, l) => a + l.mass, 0) || 1;
      let shannon = 0;
      for (const l of c.lineages) shannon -= (l.mass / totalMass) * Math.log2(l.mass / totalMass || 1);

      const rec: Record<string, unknown> = {
        step: c.step,
        individuals: ind.length,
        meanMass: ind.reduce((a, k) => a + k.mass, 0) / Math.max(1, ind.length),
        livingCells: c.livingCells,
        lineages: c.lineages.length,
        lineageShannon: shannon,
        pools: { A: Number(stats.A), B: Number(stats.B), C: Number(stats.C), P: Number(stats.P), E: Number(stats.E), S: Number(stats.S) },
        rates,
        bioticRecycling: bioticRecycling(rates),
        activity: act,
        fissions: tracker.fissions,
        fusions: tracker.fusions,
        buddings: obs.buddings,
        maxGeneration: tracker.maxGeneration(),
        mutations: obs.mutations,
        conservationOk,
      };

      rec.patternEntropy = entropy(sym);
      if (o.prevSym) rec.temporalMI = temporalMI(o.prevSym, sym);

      if (deep && snap.roles) {
        const profiles = lineageProfiles(cfg, snap.roles, genomeHead);
        const rs = roleSummary(profiles);
        rec.roles = rs.share;
        rec.rolesPresent = rs.present;
        rec.lineageCompression = await compressionRatio(lineageBytes(cfg, genomeHead));
        rec.patternCompression = await compressionRatio(sym);
        rec.morphology = morphology(cfg, cells, c, DEFAULT_CENSUS.minMass);
      }
      await sink.appendText("series.jsonl", JSON.stringify(rec) + "\n");
      lastCensus = { individuals: ind.length, lineages: c.lineages.length };
      // Observation continues through extinction (segments end at their boundary).
      if (o.becameExtinct) onProgress(`extinct at step ${c.step}`);
      // Scheduled through the same helper the lab worker uses (migrate.ts), so
      // both agree bit for bit on when and how migration applies. Keyed on the
      // absolute step (not this call's own start), so a segmented run fires it
      // at the same steps a continuous run would. Applied after this step's
      // census/observation, before any checkpoint at the same step, so a
      // checkpoint always carries the post-migration state forward.
      const mevents = await migrateAtBoundary(sim, c.step);
      if (mevents.length)
        await sink.appendText(
          "migrations.tsv",
          mevents.map((e) => `${e.step}\t${e.slot}\t${e.fromTile}\t${e.toTile}\t${e.fromCell}\t${e.toCell}\t${e.matter}\t${e.lineageHi}\t${e.lineageLo}`).join("\n") + "\n",
        );
      if (spec.checkpointEvery > 0 && (sim.step - startStep) % spec.checkpointEvery === 0) {
        const st = await sim.readState();
        const file = `checkpoints/t${String(st.step).padStart(9, "0")}.blck`;
        await sink.writeBytes(file, encodeCheckpoint(st, serializeObservers(obs, st.step, settings)));
        manifest.checkpoints.push({ step: st.step, file, hash: stateHash(st) });
      }
      if (obs.censusIdx % 20 === 0) {
        const el = (performance.now() - t0) / 1000;
        onProgress(`t=${c.step} ind=${ind.length} lin=${c.lineages.length} fis=${tracker.fissions} bud=${obs.buddings} mut=${obs.mutations} act.sig=${act.significant} ${((sim.step - startStep) / el).toFixed(0)} st/s`);
      }
    }
    const final = await sim.readState();
    const wall = (performance.now() - t0) / 1000;
    const observer = serializeObservers(obs, final.step, settings);
    const summary: RunSummary = {
      steps: final.step,
      wallSeconds: wall,
      stepsPerSecond: (final.step - startStep) / wall,
      // The one digest used for run completion, replay verification and the
      // predecessor-start check: physics *and* observer together (a verifier
      // must reproduce the observations too, not just the physics).
      finalHash: artifactDigest(final, observer),
      mutations: obs.mutations,
      fissions: tracker.fissions,
      fusions: tracker.fusions,
      buddings: obs.buddings,
      maxGeneration: tracker.maxGeneration(),
      finalIndividuals: lastCensus.individuals,
      finalLineages: lastCensus.lineages,
      extinct: obs.extinct,
      conservationOk,
    };
    manifest.summary = summary;
    await sink.writeText("manifest.json", JSON.stringify({ ...manifest, finishedAt: new Date().toISOString() }, null, 2));
    await sink.writeText("activity-final.json", JSON.stringify({ all: activity.allActivities(), top: activity.top(50) }));
    return { summary, final: opts.keepFinal ? final : undefined, observer };
  } finally {
    sim.destroy();
  }
}
