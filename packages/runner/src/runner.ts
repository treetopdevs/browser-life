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
  digestWords,
  encodeCheckpoint,
  initWorld,
  presetConfig,
  stateHash,
  totalsOf,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { GpuSim } from "@bl/sim-gpu";
import {
  ActivityTracker,
  Tracker,
  bioticRecycling,
  blockSymbols,
  census,
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
  tileDistance2,
  b64,
  unb64,
  type ActivityState,
  type TrackerState,
} from "@bl/metrics";
import { conditionById } from "./conditions.ts";

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

/** Everything the observers carry between segments of one run. */
export interface ObserverState {
  step: number;
  /** Canonical digest of the physics state this observer belongs to. */
  stateDigest: string;
  /** Observation settings; continuing with different settings is an error. */
  settings: { censusEvery: number; deepEvery: number; activityThreshold: number | null };
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
  return { ...base, ...cond.apply(base), ...(spec.overrides ?? {}) };
}

function observerSettings(spec: RunSpec) {
  return { censusEvery: spec.censusEvery, deepEvery: spec.deepEvery, activityThreshold: spec.activityThreshold ?? null };
}

/**
 * Why a start state and observer state cannot continue `spec`, or null when
 * they can. A continuation must carry the observers of the exact state it
 * resumes, under the same observation settings, in a restorable form.
 */
export function continuationError(spec: RunSpec, start: WorldState, observer: ObserverState | undefined): string | null {
  if (!sameConfig(start.cfg, specConfig(spec))) return "start state config differs from the run spec";
  if (start.step === 0) return null;
  const o = observer as Partial<ObserverState> | undefined;
  if (!o || typeof o !== "object") return "continuing from a checkpoint requires the matching observer state";
  if (o.step !== start.step || o.stateDigest !== stateHash(start)) return `observer state does not belong to the start checkpoint (t=${o.step})`;
  if (JSON.stringify(o.settings) !== JSON.stringify(observerSettings(spec))) return "observer settings differ from the run spec";
  if (!Number.isSafeInteger(o.mutations) || !Number.isSafeInteger(o.buddings) || !Number.isSafeInteger(o.censusIdx) || typeof o.extinct !== "boolean")
    return "observer counters are malformed";
  if (o.prevSym != null && typeof o.prevSym !== "string") return "observer prevSym is malformed";
  try {
    const t = Tracker.fromJSON(o.tracker!);
    if (o.tracker!.prevLabels !== null && t.labelCount() !== cellCount(start.cfg)) return "observer component labels do not cover the world";
    ActivityTracker.fromJSON(o.activity!);
    if (o.prevSym) unb64(o.prevSym);
  } catch (e) {
    return `observer state cannot be restored: ${(e as Error).message}`;
  }
  return null;
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
  const init = opts.start ?? initWorld(cfg, preset.init);
  const settings = observerSettings(spec);
  if (opts.start) {
    const bad = continuationError(spec, opts.start, opts.observer);
    if (bad) throw new Error(bad);
  }
  const t0tot = totalsOf(cfg, init.cells);
  // Ledger baseline: content + exported heat - absorbed light is invariant.
  const baseline = t0tot.energy + init.heatOut - init.lightIn;
  const startMatter = t0tot.matter;
  const startStep = init.step;
  const sim = await GpuSim.create(device, init);
  const obs = opts.observer;
  const tracker = obs ? Tracker.fromJSON(obs.tracker) : new Tracker();
  const activity = obs ? ActivityTracker.fromJSON(obs.activity) : new ActivityTracker(spec.activityThreshold ?? Infinity);
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

  const t0 = performance.now();
  let mutations = obs?.mutations ?? 0;
  let buddings = obs?.buddings ?? 0;
  let prevFlux = init.flux.slice();
  let prevSym: Uint8Array | null = obs?.prevSym ? unb64(obs.prevSym) : null;
  let censusIdx = obs?.censusIdx ?? 0;
  let conservationOk = true;
  let extinct = obs?.extinct ?? false;
  let lastCensus = { individuals: 0, lineages: 0 };

  try {
    for (let s = 0; s < spec.steps; ) {
      const chunk = Math.min(spec.censusEvery, spec.steps - s);
      const deep = censusIdx % spec.deepEvery === 0;
      for (let k = 0; k < chunk; k += 64) sim.run(Math.min(64, chunk - k));
      s += chunk;
      await device.queue.onSubmittedWorkDone();

      const ledger = await sim.drainLedger();
      if (ledger.dropped > 0) throw new Error(`event buffer overflow (${ledger.dropped} dropped); lower censusEvery`);
      mutations += ledger.events.length;
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

      const c = census({ cfg, step: snap.step, cells, genomeHead });
      const events = tracker.update(c);
      const life: object[] = [];
      for (const e of events) {
        if (e.kind === "fission") {
          const a = tracker.alive.get(e.parent);
          for (const id of e.children) {
            const b = tracker.alive.get(id);
            if (a && b) await sink.appendText("heredity.tsv", `${c.step}\t${a.mu}\t${b.mu}\t${a.sigma}\t${b.sigma}\t${a.mass}\t${b.mass}\n`);
          }
          life.push(e);
        } else if (e.kind === "birth") {
          // Condensation from leaked biomass: attribute to the nearest living
          // individual of the same lineage (budding) when one is close.
          const b = tracker.alive.get(e.id);
          let parent: number | null = null;
          let best = 24 * 24;
          if (b && b.lineage)
            for (const o of tracker.alive.values()) {
              if (o.id === b.id || o.lineage !== b.lineage || o.born === c.step) continue;
              const d = tileDistance2(o, b, cfg.tileW, cfg.tileH);
              if (d < best) [best, parent] = [d, o.id];
            }
          if (parent !== null) {
            buddings++;
            if (b) {
              b.parent = parent;
              b.generation = (tracker.alive.get(parent)?.generation ?? 0) + 1;
            }
            life.push({ step: e.step, kind: "budding", parent, child: e.id });
          } else life.push(e);
        } else life.push(e);
      }
      if (life.length) await sink.appendText("life.jsonl", life.map((x) => JSON.stringify(x)).join("\n") + "\n");

      const abundance = c.lineages.map((l) => [l.key, l.cells] as [string, number]);
      const act = activity.update(c.step, abundance);
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
        buddings,
        maxGeneration: tracker.maxGeneration(),
        mutations,
        conservationOk,
      };

      const sym = blockSymbols(cfg, cells);
      rec.patternEntropy = entropy(sym);
      if (prevSym) rec.temporalMI = temporalMI(prevSym, sym);
      prevSym = sym;

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
      censusIdx++;

      // Keep observing through extinction: segments must end at their scheduled
      // boundary and the observation window must not be truncated.
      if (c.livingCells === 0 && !extinct) {
        extinct = true;
        onProgress(`extinct at step ${c.step}`);
      }
      if (spec.checkpointEvery > 0 && (sim.step - startStep) % spec.checkpointEvery === 0) {
        const st = await sim.readState();
        const file = `checkpoints/t${String(st.step).padStart(9, "0")}.blck`;
        await sink.writeBytes(file, encodeCheckpoint(st));
        manifest.checkpoints.push({ step: st.step, file, hash: stateHash(st) });
      }
      if (censusIdx % 20 === 0) {
        const el = (performance.now() - t0) / 1000;
        onProgress(`t=${c.step} ind=${ind.length} lin=${c.lineages.length} fis=${tracker.fissions} bud=${buddings} mut=${mutations} act.sig=${act.significant} ${((sim.step - startStep) / el).toFixed(0)} st/s`);
      }
    }
    const final = await sim.readState();
    const wall = (performance.now() - t0) / 1000;
    const summary: RunSummary = {
      steps: final.step,
      wallSeconds: wall,
      stepsPerSecond: (final.step - startStep) / wall,
      finalHash: stateHash(final),
      mutations,
      fissions: tracker.fissions,
      fusions: tracker.fusions,
      buddings,
      maxGeneration: tracker.maxGeneration(),
      finalIndividuals: lastCensus.individuals,
      finalLineages: lastCensus.lineages,
      extinct,
      conservationOk,
    };
    manifest.summary = summary;
    await sink.writeText("manifest.json", JSON.stringify({ ...manifest, finishedAt: new Date().toISOString() }, null, 2));
    await sink.writeText("activity-final.json", JSON.stringify({ all: activity.allActivities(), top: activity.top(50) }));
    const observer: ObserverState = {
      step: final.step,
      stateDigest: summary.finalHash,
      settings,
      tracker: tracker.toJSON(),
      activity: activity.toJSON(),
      mutations,
      buddings,
      censusIdx,
      extinct,
      prevSym: prevSym ? b64(prevSym) : null,
    };
    return { summary, final: opts.keepFinal ? final : undefined, observer };
  } finally {
    sim.destroy();
  }
}

/**
 * Digest of an uploaded artifact's exact bytes: digestWords over
 * [byte length, bytes zero-padded to whole words]. Mirrored by the
 * coordinator (Coordinator.Checkpoint.bytes_digest).
 */
export function bytesDigest(bytes: Uint8Array): string {
  const words = new Uint32Array(1 + Math.ceil(bytes.length / 4));
  words[0] = bytes.length;
  new Uint8Array(words.buffer, 4).set(bytes);
  const [a, b] = digestWords(words);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
