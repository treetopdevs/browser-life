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
//   checkpoints/b<NNN>-pre.blck  pond runs: listed boundaries' pre-cycle states (optional)

import {
  PRESETS,
  applyExchange,
  cellCount,
  exchangeMatterTotal,
  exchangePositions,
  RULE_VERSION,
  SCHEMA_VERSION,
  METRICS_VERSION,
  artifactDigest,
  decodeCheckpoint,
  encodeCheckpoint,
  founderGenome,
  genomeFromHex,
  initWorld,
  G,
  GENOME_CHANNELS,
  m3World,
  M3_FOUNDERS,
  presetConfig,
  stateHash,
  presetIdentity,
  totalsOf,
  validateConfig,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { GpuSim } from "@bl/sim-gpu";
import { applyBoundary, branchTransform, cellsAtBoundary, pondColumns, pondContext, pondTsvRows, pondsHeader } from "./migrate.ts";
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
  tileSpeciesCensus,
  DEFAULT_CENSUS,
  unb64,
  type ActivityState,
  type TrackerState,
  type TileSpeciesRow,
  type Census,
} from "@bl/metrics";

/**
 * Fixed anchor set for `RunSpec.speciesCensus`'s per-tile species census --
 * the same M3 founder set every archipelago tile is seeded with
 * (tools/biogeo-sweep.ts's `archipelagoWorld`). Hardcoded here (not threaded
 * through `RunSpec`) because `RunSpec` is embedded verbatim in manifest.json
 * and diffed by `JSON.stringify` (`sameCompletedRun`) -- a `Genome[]` anchor
 * list would serialize each founder's `Int8Array` weights as a numeric-key
 * object, bloating every manifest for no benefit.
 */
const SPECIES_ANCHORS = M3_FOUNDERS.map(founderGenome);

function speciesTsvRows(step: number, rows: TileSpeciesRow[]): string {
  return rows.map((r) => `${step}\t${r.tile}\t${r.geneticRichness}\t${r.livingCells}\t${r.founderPresenceMask}\n`).join("");
}
import { conditionById } from "./conditions.ts";
import { observeCensus, restoreObservers, serializeObservers } from "./observe.ts";
import { PICKS_FILE, PickError, thrownMessage, formatFailedLine, formatPickLine, makeDonorHook, picksDigest, picksPreflightError, type PickEntry, type PickNote, type Picker } from "./picks.ts";

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
  /**
   * Optional world overrides applied after the condition. tools/run.ts's `--override` sets them from an
   * allowlist (`parseOverrides`): `mutRate` (the hunt's D3 runs with mutation off) and `pondDeath` (its G1
   * fallback at e = 1, `pondDeath` 65,536, which wins over pond-nat's and pond-shuf's 32,768).
   */
  overrides?: Partial<WorldConfig>;
  /**
   * This run's metapopulation, if it belongs to one (see
   * Coordinator.Queue's `:metapopulation` experiment spec) — a ring of runs
   * (same experiment/preset/condition, different seeds) exchanging small
   * cell packets at every segment boundary (packages/schema/src/exchange.ts).
   * `salt` is resolved and stored once by the coordinator at experiment
   * creation (never independently derived here), so every run in the ring —
   * and any verifier — picks the same boundary positions. `ringNamespace` is
   * this run's own 1-based position in the ring's `seeds` list (also
   * coordinator-assigned): `specConfig` mixes it into `WorldConfig.ringNamespace`
   * so this run's founders/mutations never collide with another ring
   * member's after an exchange (see WorldConfig.ringNamespace's doc). Present
   * (with a real `ringNamespace`) even for a "no-migration" condition's runs
   * within a metapopulation experiment: that condition is the metapopulation
   * *scheduling* control (no `import_from` wiring, no barrier -- see
   * Coordinator.Queue), not an exemption from needing a distinct namespace,
   * since a "no-migration" run's own founders could otherwise still collide
   * with another ring member's namespace-less ids.
   */
  metapopulation?: { salt: number; migrantCount: number; ringNamespace: number };
  /**
   * Per-tile species census (packages/metrics/src/biogeography.ts's
   * `tileSpeciesCensus`), appended to `species.tsv` at every census step,
   * against the fixed M3 founder set (`@bl/schema`'s `M3_FOUNDERS`). Omitted:
   * no `species.tsv`, no extra readback, output byte-identical to before
   * this field existed (see packages/runner/test's parity test and
   * tests/deno/species-census.ts).
   */
  speciesCensus?: boolean;
  /**
   * Overrides `runId`'s default `experiment/presetId/condition/seed-N` path-style identity with
   * this exact string -- for a caller (tools/biogeo-sweep.ts) whose own manifest already assigns
   * each run a canonical, content-hashed id (a short hash of config+seed+steps+cadences) and wants
   * that same id carried into manifest.json and used for resume/analysis identity, rather than a
   * second, coarser identity derived from condition+seed alone. Omitted: `runId` behaves exactly as
   * it always has (this field costs nothing to a run that doesn't opt in).
   */
  runId?: string;
  /**
   * Foundations-review observers (docs/plan.md, "M4 pivot: foundations review"), for replays and
   * assays: `profiles.tsv` (each lineage's catalytic profile, role and Lenia parameters at every deep
   * census), `genomes.tsv` (the genome of every lineage when first seen at a census) and `births.tsv`
   * (the traits of parent and offspring individuals at each fission and budding). Observation only:
   * the physics and every other file are unchanged. Omitted: none of these files, as before.
   */
  lineageObs?: boolean;
  /**
   * Index into `M3_FOUNDERS`: an m3 preset's founder discs all carry this one founder's genome
   * (same count, positions and amounts), for single-founder starts. Omitted: the preset's own world.
   */
  soloFounder?: number;
  /**
   * A genome as hex words from PARAM0 onwards (`genomeHex`, the `genomes.tsv` column): like
   * `soloFounder`, but every founder disc carries this genome. Omitted: the preset's own world.
   */
  soloGenome?: string;
  /**
   * Genome hex words (`genomeHex`) founding an m3 preset as a set: disc `i` carries
   * `founderSet[i % founderSet.length]`. Exclusive with `soloFounder` / `soloGenome`. Omitted: the
   * preset's own world. Absent from the manifest of any run that does not set it.
   */
  founderSet?: string[];
  /**
   * Pond runs only: boundaries b (positive, strictly increasing) at whose step b · pondPeriod the
   * runner also writes the state *before* that boundary's cycle (for arm cont, before its rows are
   * recorded: the same state), with the pre-cycle observer (`ponds.lastCycle` = b - 1), to
   * `checkpoints/b<NNN>-pre.blck`, and lists each in the manifest's `preCycleCheckpoints` with its
   * `stateHash` -- the assay sources of the scaffolding registration (docs/scaffold-registration-v1.md,
   * "Code to build"). Each boundary must fall inside this run, on its census grid. Observation only:
   * the physics, the cycle and every other file are unchanged, and `continuationError` refuses to
   * continue from such a state. Optional and absent from every default, so a run that does not set it
   * keeps its spec, manifest and every output byte-identical to before this field existed.
   */
  preCycleCheckpoints?: number[];
  /**
   * A branch run (docs/scaffold-transition-hunt-v1.md, "Branch contract"): instead of the preset's initial
   * world, the run starts from the pre-cycle state of another run at pond boundary `boundary`
   * (`RunOptions.branchFrom`, the decoded `checkpoints/b<NNN>-pre.blck` of the bundle at `source`) and applies
   * that boundary's transform, under this run's condition (`pond-nat` or `pond-shuf`) and seed, before its first
   * step. `source` is the source bundle's directory as the caller named it, `sourceHash` the `stateHash` of the
   * pre-cycle state, which the runner checks. `steps` then counts from the source's step, so a branch from
   * boundary 100 with `steps` 10^6 ends at step 2 * 10^6. The manifest records `branch` (this and the post-transform
   * `postHash`) and no `initHash`. Refused, before the GPU is touched, unless the condition is `pond-nat` or
   * `pond-shuf`, the source is at `boundary` * `pondPeriod`, its hash is `sourceHash`, and this run's config equals
   * the source's except `pondArm`, `pondDeath`, `pondExport` and `seed`; exclusive with the founder options and
   * `lineageObs`, and `preCycleCheckpoints` may list only boundaries after `boundary`. Optional and absent from every
   * default, so a run without it keeps its spec, manifest and every output byte-identical to before this field existed.
   * A later segment of a branch run is an ordinary continuation (`start` and `observer`) of the same spec.
   */
  branch?: BranchSpec;
  /**
   * A picked run (picks.ts): the pond cycles' donors come from `RunOptions.picker` or `RunOptions.picks` instead of
   * the arm's rule, and every boundary's donors are logged in `picks.jsonl` (the manifest's `picks` block says
   * who chose). It is part of `manifest.spec`, so a picked run and a rule-bred run are never the same run
   * (`sameCompletedRun`). Needs a pond config of arm scaf, rand or breed (`pickedConfigError`); exclusive with
   * `branch` and `metapopulation`. Never segmented: `runExperiment` refuses `start` and `immigrant` for it, an island
   * refuses it and `stitchRun` throws. Optional and absent from every default, so a run without it keeps its spec,
   * manifest and every output byte-identical to before this field existed.
   */
  picked?: true;
}

/** `RunSpec.branch`: where a branch run's pre-cycle source came from, and which boundary's transform it applies first. */
export interface BranchSpec {
  source: string;
  sourceHash: string;
  boundary: number;
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
  /**
   * Pond runs only (`WorldConfig.pondPeriod`); absent from every other
   * observer, so their artifacts and digests are unchanged. `lastCycle` is
   * the last boundary whose pond cycle has been applied (or, for arm cont,
   * recorded): floor(step / pondPeriod) for every state a pond run writes,
   * since each boundary's cycle runs before that step's checkpoint -- except
   * the opt-in pre-cycle checkpoints (`RunSpec.preCycleCheckpoints`), which
   * carry b - 1 at boundary b. See `pondContinuationError`.
   */
  ponds?: { lastCycle: number };
  /**
   * Fed histories only (feed.ts in @bl/schema): the net quanta of nutrient this history's logged feeds
   * have added (negative: drained) and how many feeds there were. Absent when the history was never
   * fed, so every other observer state and its digest are unchanged. It travels with the checkpoint
   * artifact, so a fed world exported and imported elsewhere still says that it was fed.
   */
  fed?: { matter: number; feeds: number };
}

export interface RunOptions {
  /** Start from this state (a segment of a longer run) instead of the preset's initial world. */
  start?: WorldState;
  /** Observer state saved by the previous segment (must match `start.step`). */
  observer?: ObserverState;
  /** Return the final state (islands upload it as the next segment's start). */
  keepFinal?: boolean;
  /**
   * The ring-predecessor's own accepted end-of-segment state (see
   * `RunSpec.metapopulation`), if this segment has one — the same one
   * `spec.metapopulation` must also be set for. Applied once, before any
   * physics steps, via `packages/schema/src/exchange.ts`. Refused for a pond
   * run, whose ponds each keep their own matter.
   */
  immigrant?: WorldState;
  /**
   * The decoded pre-cycle source of a branch run (`RunSpec.branch`), whose boundary transform `runExperiment`
   * applies on the CPU before creating the simulation. Required for a branch run's first segment, refused
   * otherwise and with `start`/`observer` (a branch's later segments continue from `start` instead).
   */
  branchFrom?: WorldState;
  /**
   * Chooses the donors of a pond boundary the record (`picks`) does not cover (a picked run, `RunSpec.picked`; picks.ts).
   * A run is picked exactly when it has a picker or a record: the two are required to agree with `spec.picked`.
   */
  picker?: Picker;
  /**
   * Recorded donors (a `picks.jsonl`, or a lab manifest's pick interventions), applied at their boundaries with no picker
   * consulted; the record wins where it has an entry. With no picker the record must cover every boundary
   * (`picksPreflightError`), unless `implicitRule` says a boundary without an entry takes the rule's donors, as the lab's
   * own replay does.
   */
  picks?: readonly PickEntry[];
  /** `picks` came from a lab manifest, which is sparse: a boundary with no entry and no picker takes the rule's donors. */
  implicitRule?: boolean;
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
  if (spec.soloFounder !== undefined) {
    if (!Number.isInteger(spec.soloFounder) || spec.soloFounder < 0 || spec.soloFounder >= M3_FOUNDERS.length) errs.push(`soloFounder must be an index into the ${M3_FOUNDERS.length} M3 founders`);
    else if (PRESETS.find((p) => p.id === spec.presetId)?.init.kind !== "m3") errs.push("soloFounder needs a preset founded from the M3 founder set");
  }
  if (spec.soloGenome !== undefined) {
    try {
      genomeFromHex(spec.soloGenome);
      if (spec.soloFounder !== undefined) errs.push("soloGenome and soloFounder are exclusive");
      else if (PRESETS.find((p) => p.id === spec.presetId)?.init.kind !== "m3") errs.push("soloGenome needs a preset founded from the M3 founder set");
    } catch (e) {
      errs.push(`soloGenome: ${(e as Error).message}`);
    }
  }
  if (spec.founderSet !== undefined) {
    if (!Array.isArray(spec.founderSet) || spec.founderSet.length === 0) errs.push("founderSet must be a non-empty array of genome hex strings");
    else {
      for (let i = 0; i < spec.founderSet.length; i++) {
        try {
          genomeFromHex(spec.founderSet[i]);
        } catch (e) {
          errs.push(`founderSet[${i}]: ${(e as Error).message}`);
        }
      }
      if (spec.soloFounder !== undefined || spec.soloGenome !== undefined) errs.push("founderSet is exclusive with soloFounder and soloGenome");
      else if (PRESETS.find((p) => p.id === spec.presetId)?.init.kind !== "m3") errs.push("founderSet needs a preset founded from the M3 founder set");
    }
  }
  if (spec.branch !== undefined) {
    const br = spec.branch as Partial<BranchSpec> | null;
    if (!br || typeof br !== "object" || Array.isArray(br)) errs.push("branch must be an object { source, sourceHash, boundary }");
    else {
      if (Object.keys(br).sort().join() !== "boundary,source,sourceHash") errs.push("branch must have exactly the keys source, sourceHash and boundary");
      if (typeof br.source !== "string" || br.source === "") errs.push("branch.source must be a non-empty string (the source bundle's directory)");
      if (typeof br.sourceHash !== "string" || !/^[0-9a-f]{16}$/.test(br.sourceHash)) errs.push("branch.sourceHash must be a 16-digit hex state hash");
      if (!Number.isSafeInteger(br.boundary) || (br.boundary as number) <= 0) errs.push("branch.boundary must be a positive integer (a pond boundary)");
    }
    if (spec.condition !== "pond-nat" && spec.condition !== "pond-shuf") errs.push("a branch run needs the condition pond-nat or pond-shuf");
    if (spec.soloFounder !== undefined || spec.soloGenome !== undefined || spec.founderSet !== undefined) errs.push("a branch starts from its source, so it excludes soloFounder, soloGenome and founderSet");
    if (spec.lineageObs) errs.push("lineageObs needs a run observed from step 0; a branch starts at its source's step");
  }
  if (spec.picked !== undefined) {
    if ((spec.picked as unknown) !== true) errs.push("picked must be true or absent");
    if (spec.branch !== undefined) errs.push("a picked run cannot be a branch run");
    if (spec.metapopulation !== undefined) errs.push("a picked run cannot belong to a metapopulation");
  }
  // The pond-specific checks (a pond config, each boundary inside this run and on its census grid)
  // need the config and the start step: `preCycleError`, which runExperiment applies.
  if (spec.preCycleCheckpoints !== undefined) {
    const bs = spec.preCycleCheckpoints;
    // An indexed loop, not every/some, which skip the holes of a sparse array ([, 2]).
    let shape = Array.isArray(bs) && bs.length > 0;
    let increasing = true;
    for (let i = 0; shape && i < bs.length; i++) {
      if (!Number.isSafeInteger(bs[i]) || bs[i] <= 0) shape = false;
      else if (i > 0 && bs[i] <= bs[i - 1]) increasing = false;
    }
    if (!shape) errs.push("preCycleCheckpoints must be a non-empty array of positive integers (pond boundaries)");
    else if (!increasing) errs.push("preCycleCheckpoints must be strictly increasing");
  }
  return errs;
}

/**
 * Why `spec.preCycleCheckpoints` cannot be written by a run of config `cfg` from `startStep`, or
 * null when it can (or is absent). The runner acts at census steps only, and a history never cycles
 * at its own start step (that boundary's cycle belongs to the run that reached it), so each boundary
 * step b · pondPeriod must lie in (startStep, startStep + steps] and on this run's census grid.
 * runExperiment refuses such a spec before touching the GPU; tools/run.ts checks its fresh runs
 * (startStep 0) before it even requests a device.
 */
export function preCycleError(spec: RunSpec, cfg: WorldConfig, startStep: number): string | null {
  const bs = spec.preCycleCheckpoints;
  if (bs === undefined) return null;
  const period = cfg.pondPeriod;
  if (period === undefined) return "preCycleCheckpoints needs a pond run: this config has no pondPeriod";
  const end = startStep + spec.steps;
  for (const b of bs) {
    const t = b * period;
    if (t <= startStep) return `preCycleCheckpoints: boundary ${b} (t=${t}) is at or before this run's start step ${startStep}; its cycle belongs to the run that reached it`;
    if (t > end) return `preCycleCheckpoints: boundary ${b} (t=${t}) is beyond this run's last step ${end}`;
    if ((t - startStep) % spec.censusEvery !== 0) return `preCycleCheckpoints: boundary ${b} (t=${t}) is not a census step of this run (start ${startStep}, censusEvery ${spec.censusEvery})`;
  }
  return null;
}

/** The `WorldConfig` keys tools/run.ts's `--override` accepts: the hunt's D3 (mutation off) and G1 fallback (e = 1). */
const OVERRIDE_KEYS = ["mutRate", "pondDeath"] as const;

/**
 * `RunSpec.overrides` from tools/run.ts's `--override` text: a comma-separated list of `key=integer`, with keys from
 * the allowlist `mutRate` and `pondDeath` (each at most once). Throws on any other key, a value that is not a plain
 * decimal integer, a repeated key or an empty list; range and arm checks are `validateConfig`'s, on the run's config.
 */
export function parseOverrides(text: string): Partial<WorldConfig> {
  const out: Partial<WorldConfig> = {};
  const parts = text.split(",").map((part) => part.trim());
  if (text.trim() === "" || parts.some((part) => part === "")) throw new Error(`--override needs key=integer pairs separated by commas, got ${JSON.stringify(text)}`);
  for (const part of parts) {
    const eq = part.indexOf("=");
    const key = part.slice(0, eq), value = part.slice(eq + 1);
    if (eq < 0 || !(OVERRIDE_KEYS as readonly string[]).includes(key)) throw new Error(`--override ${JSON.stringify(part)}: the keys allowed are ${OVERRIDE_KEYS.join(", ")}, as key=integer`);
    if (!/^(0|-?[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`--override ${key}: ${JSON.stringify(value)} is not an integer`);
    if (key in out) throw new Error(`--override ${key} is given twice`);
    out[key as (typeof OVERRIDE_KEYS)[number]] = Number(value);
  }
  return out;
}

/**
 * Why `spec.branch` and `opts.branchFrom` do not make a legal branch run of config `cfg` (`specConfig(spec)`), or null
 * when they do, or when neither is involved. Pure and independent of the GPU: runExperiment refuses before touching
 * it, and tools/run.ts checks every spec before it requests a device. The branch contract's refusals, in order:
 * `branchFrom` without `spec.branch`; a branch without its source (a later segment continues from `start` instead,
 * which must not precede its boundary); `start` or `observer` beside `branchFrom`; an arm other than nat and shuf; a
 * source not at `boundary` * `pondPeriod` (> 0); a source whose `stateHash` is not `sourceHash`; an invalid config;
 * and a config that differs from the source's in anything but `pondArm`, `pondDeath`, `pondExport` and `seed`.
 */
export function branchError(spec: RunSpec, cfg: WorldConfig, opts: Pick<RunOptions, "start" | "observer" | "branchFrom">): string | null {
  const br = spec.branch;
  const source = opts.branchFrom;
  if (!br) return source ? "a branch source (branchFrom) needs spec.branch" : null;
  if (cfg.pondArm !== "nat" && cfg.pondArm !== "shuf") return `a branch run needs the pond arm nat or shuf, got ${JSON.stringify(cfg.pondArm)}`;
  if (!source) {
    if (!opts.start) return "a branch run needs its source state (branchFrom), or a start state to continue from";
    if (opts.start.step < br.boundary * cfg.pondPeriod!) return `a branch continuation starts at t=${opts.start.step}, before its boundary ${br.boundary} (t=${br.boundary * cfg.pondPeriod!})`;
    return null;
  }
  if (opts.start || opts.observer) return "a branch starts from its source alone: branchFrom excludes a start state and an observer";
  const want = br.boundary * cfg.pondPeriod!;
  if (source.step !== want || want <= 0) return `branch source is at t=${source.step}, but boundary ${br.boundary} is at t=${want}`;
  const hash = stateHash(source);
  if (hash !== br.sourceHash) return `branch source's state hash ${hash} is not the spec's ${br.sourceHash}`;
  const errs = validateConfig(cfg);
  if (errs.length) return `invalid config: ${errs.join("; ")}`;
  const own = new Set(["pondArm", "pondDeath", "pondExport", "seed"]);
  const a = source.cfg as unknown as Record<string, unknown>, b = cfg as unknown as Record<string, unknown>;
  const differs = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().find((k) => !own.has(k) && a[k] !== b[k]);
  if (differs !== undefined) return `branch config differs from its source's at ${differs} (only pondArm, pondDeath, pondExport and seed may differ)`;
  return null;
}

/**
 * Why a picked run (`spec.picked`) cannot run on `cfg`, or null (also null for an unpicked spec): the donors it takes
 * belong to a pond cycle of arm scaf, rand or breed. Needs no GPU, so tools/run.ts checks it first.
 */
export function pickedConfigError(spec: RunSpec, cfg: WorldConfig): string | null {
  if (!spec.picked) return null;
  if (cfg.pondPeriod === undefined) return "a picked run needs a pond config (a pond preset)";
  if (cfg.pondArm !== "scaf" && cfg.pondArm !== "rand" && cfg.pondArm !== "breed") return `a picked run needs pond arm scaf, rand or breed, got ${JSON.stringify(cfg.pondArm)}: only those arms choose donors`;
  return null;
}

/**
 * `spec` with `speciesCensus` dropped unless it is exactly `true` -- so a caller that explicitly
 * writes `speciesCensus: false` serializes (in `manifest.json`, and for `sameCompletedRun`'s
 * comparison below) byte-identically to one that never mentioned the field at all. `JSON.stringify`
 * already drops an `undefined` value on its own; only the explicit-`false` case needs this.
 */
function normalizedSpec(spec: RunSpec): RunSpec {
  let out = spec;
  if (out.speciesCensus === false) {
    const { speciesCensus: _drop, ...rest } = out;
    out = rest;
  }
  if (out.lineageObs === false) {
    const { lineageObs: _drop, ...rest } = out;
    out = rest;
  }
  if ((out.picked as unknown) === false) {
    const { picked: _drop, ...rest } = out;
    out = rest;
  }
  return out;
}

export function sameConfig(a: WorldConfig, b: WorldConfig): boolean {
  const keys = Object.keys(a).sort();
  return keys.length === Object.keys(b).length && keys.every((k) => a[k as keyof WorldConfig] === b[k as keyof WorldConfig]);
}

/** Like `sameConfig`, but ignoring `seed` and `ringNamespace`: a metapopulation's runs share preset/condition/config by definition, but each has its own seed and (review P1) its own ring namespace -- two ring members legitimately differ in exactly those two fields, never any other. Used to check an immigrant state's config against this run's, not a same-run predecessor's (which must match on `seed`/`ringNamespace` too, via `sameConfig`). */
function sameConfigExceptSeed(a: WorldConfig, b: WorldConfig): boolean {
  const keys = Object.keys(a).sort();
  const exempt = (k: string) => k === "seed" || k === "ringNamespace";
  return keys.length === Object.keys(b).length && keys.every((k) => exempt(k) || a[k as keyof WorldConfig] === b[k as keyof WorldConfig]);
}

export function specConfig(spec: RunSpec): WorldConfig {
  const preset = PRESETS.find((p) => p.id === spec.presetId);
  if (!preset) throw new Error(`unknown preset ${spec.presetId}`);
  const base = presetConfig(preset, spec.seed);
  // "no-migration" (conditions.ts) never throws by itself any more -- it has
  // no visibility into whether a metapopulation makes it meaningful, only the
  // WorldConfig. Checked here, once, with both pieces of context: the control
  // must remove *something* -- tile migration configured for this preset, or
  // this run belonging to a metapopulation (RunSpec.metapopulation) -- or it
  // is a no-op control, which is rejected the same way uniform-light/fixed-env
  // already reject a preset that has nothing for them to remove.
  if (spec.condition === "no-migration" && !base.migrationPeriod && !spec.metapopulation)
    throw new Error("no-migration control needs either tile migration (this preset) or a metapopulation (this experiment)");
  const cond = conditionById(spec.condition);
  // spec.overrides wins last, so e.g. { adhesion: true } re-enables adhesion even under no-signal-motility.
  const cfg = { ...base, ...cond.apply(base), ...(spec.overrides ?? {}) };
  // Each pond keeps its own matter (WorldConfig.pondPeriod), which a
  // metapopulation's cross-run exchange would break; validateConfig refuses
  // the ring namespace below on a pond config too, but this says why, before
  // any state is built.
  if (spec.metapopulation && cfg.pondPeriod !== undefined) throw new Error("a pond run cannot belong to a metapopulation: cross-run exchange would move matter into and out of its ponds");
  if (spec.metapopulation) {
    const { migrantCount, salt } = spec.metapopulation;
    // The coordinator already bounds migrantCount to a conservative fixed
    // cap (Coordinator.Queue's @max_migrant_count) at experiment-creation
    // time, without knowing this preset's actual cell count -- checked again
    // here, against the *real* cellCount(cfg), because exchangePositions's
    // reprobe loop (packages/schema/src/exchange.ts) never terminates once
    // migrantCount exceeds the number of cells there are to choose from
    // (review P2: a 64-cell preset with migrantCount 65 hangs). Caught here,
    // before that loop ever runs, with a clear error instead.
    if (!Number.isInteger(migrantCount) || migrantCount < 1) throw new Error("metapopulation.migrantCount must be a positive integer");
    if (migrantCount > cellCount(cfg)) throw new Error(`metapopulation.migrantCount (${migrantCount}) exceeds this preset's cell count (${cellCount(cfg)})`);
    if (!Number.isInteger(salt) || salt < 0 || salt > 0xffffffff) throw new Error("metapopulation.salt must be a u32 integer");
  }
  // Coordinator-controlled, applied after overrides: a metapopulation run's
  // ring position determines its namespace (see WorldConfig.ringNamespace),
  // which every founder/mutation id must be mixed with to stay unique across
  // the ring's runs -- a correctness requirement, not a tunable, so it always
  // wins regardless of what spec.overrides asked for.
  return spec.metapopulation ? { ...cfg, ringNamespace: spec.metapopulation.ringNamespace } : cfg;
}

/**
 * Whether a previously written `manifest.json` (`done`, parsed JSON — its
 * shape is otherwise untyped in this codebase, hence `Record<string,
 * unknown>`) already covers `spec` under the same rule/schema/metrics
 * versions and config: tools/run.ts's "resume/reuse" convenience check
 * (skip re-running a directory that already holds an identical, complete
 * history). A missing `metricsVersion` field predates the constant and is
 * version 1 — a bundle computed under a different metrics definition (e.g.
 * `compressionRatio`'s compressor) must never be treated as reusable, even
 * though its spec/config/rule/schema otherwise match exactly.
 */
export function sameCompletedRun(done: Record<string, unknown>, spec: RunSpec): boolean {
  return (
    JSON.stringify(done.spec) === JSON.stringify(normalizedSpec(spec)) &&
    done.ruleVersion === RULE_VERSION &&
    done.schemaVersion === SCHEMA_VERSION &&
    ((done.metricsVersion as number | undefined) ?? 1) === METRICS_VERSION &&
    sameConfig(done.cfg as WorldConfig, specConfig(spec))
  );
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
  // At step 0 an observer is optional, but one that is given must not carry a stray pond field.
  if (start.step === 0) return observer && typeof observer === "object" ? pondContinuationError(start.cfg, observer, 0) : null;
  if (!observer || typeof observer !== "object") return "continuing from a checkpoint requires the matching observer state";
  if (observer.step !== start.step) return `observer state does not belong to the start checkpoint (t=${observer.step})`;
  if (!sameSettings(observer.settings, observerSettings(spec))) return "observer settings differ from the run spec";
  return pondContinuationError(start.cfg, observer, start.step);
}

/**
 * Why `observer` cannot continue a history of config `cfg` at `step` as far
 * as the pond cycle is concerned, or null when it can. The `ponds` field
 * must be present exactly in pond runs (`cfg.pondPeriod` set) past step 0 --
 * at step 0 a pond observer may omit it, and if present it must say 0 -- and
 * absent otherwise; and `ponds.lastCycle` must equal floor(step /
 * pondPeriod). That rejects the one continuation the rest of the checks
 * cannot see: a pre-cycle state at a boundary (a pond run writes one only
 * when asked, `RunSpec.preCycleCheckpoints`, and tools/scaffold.ts's
 * `b<C>-pre` checkpoints are such states), which
 * would otherwise silently skip that boundary's cycle, since a history never
 * cycles at its own start step. Shared by `continuationError` (tools/run.ts
 * continuations and islands) and the lab's adoption of an imported or
 * restored world.
 */
export function pondContinuationError(cfg: WorldConfig, observer: ObserverState | undefined, step: number): string | null {
  const ponds = observer?.ponds;
  if (cfg.pondPeriod === undefined) return ponds === undefined ? null : "the observer state carries a pond-cycle field but the config has no pond cycle";
  if (ponds === undefined) return step > 0 ? "continuing a pond run requires the observer's pond-cycle field (ponds.lastCycle)" : null;
  const want = Math.floor(step / cfg.pondPeriod);
  if (ponds.lastCycle === want) return null;
  const pre = ponds.lastCycle === want - 1 && step % cfg.pondPeriod === 0;
  return `the observer's last pond cycle is ${ponds.lastCycle}, but t=${step} needs ${want}${pre ? " (a pre-cycle state: this boundary's cycle has not been applied)" : ""}`;
}

/**
 * Why an immigrant state (see `RunOptions.immigrant`) cannot be applied to
 * this segment, or null when it can. Same idea as `continuationError`, but
 * comparing configs with `sameConfigExceptSeed` rather than `sameConfig` (a
 * metapopulation's runs share preset/condition/config by definition, but each
 * has its own seed), and checking the immigrant's own step against `myStart`
 * rather than the observer's: a ring's runs share one `segmentSteps`, so a
 * boundary always lands at the same absolute step in every run, and the
 * immigrant (the predecessor's own end-of-this-boundary state) must be at
 * exactly that step, no more no less. Called both by island.ts, right after
 * decoding bytes fetched via `importFrom`, and internally by
 * `runExperiment` (defense in depth, matching `continuationError`'s own
 * double-checking).
 */
export function immigrantError(spec: RunSpec, myStart: number, immigrant: WorldState): string | null {
  if (!sameConfigExceptSeed(immigrant.cfg, specConfig(spec))) return "immigrant state's config differs from this run's (besides seed)";
  if (immigrant.step !== myStart) return `immigrant state is at t=${immigrant.step}, expected this segment's own start t=${myStart}`;
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
  if (o.ponds !== undefined && (!o.ponds || typeof o.ponds !== "object" || !safeIntGe0((o.ponds as { lastCycle?: unknown }).lastCycle)))
    throw new Error("checkpoint: observer ponds.lastCycle is malformed");
  if (o.fed !== undefined) {
    const f = o.fed as { matter?: unknown; feeds?: unknown } | null;
    if (!f || typeof f !== "object" || !Number.isSafeInteger(f.matter) || !posInt(f.feeds)) throw new Error("checkpoint: observer fed is malformed");
  }
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

interface IndStats {
  lineage: string;
  mass: number;
  biomass: number;
  cells: number;
  purity: number;
}

/** Each tracked individual's component at this census, keyed by individual id. */
function indStats(c: Census, tracker: Tracker): Map<number, IndStats> {
  const out = new Map<number, IndStats>();
  for (const k of c.components) {
    const id = tracker.idOf(k.idx);
    if (id !== undefined) out.set(id, { lineage: k.lineage, mass: k.mass, biomass: k.biomass, cells: k.cells, purity: +k.purity.toFixed(4) });
  }
  return out;
}

/** `genomes.tsv` rows: genome words PARAM0.. (hex, 8 digits each) of each lineage in `keys`, read from its first cell. */
function genomeRows(cfg: WorldConfig, step: number, keys: Set<string>, genome: Uint32Array): string {
  const n = cellCount(cfg);
  const rows: string[] = [];
  for (let i = 0; i < n && keys.size; i++) {
    const hi = genome[G.LIN_HI * n + i], lo = genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    const key = `${hi}:${lo}`;
    if (!keys.delete(key)) continue;
    let words = "";
    for (let g = G.PARAM0; g < GENOME_CHANNELS; g++) words += genome[g * n + i].toString(16).padStart(8, "0");
    rows.push(`${key}\t${step}\t${words}\n`);
  }
  return rows.join("");
}

/** `profiles.tsv` rows: each lineage's summed catalytic profile, role and Lenia parameters. */
function profileRows(cfg: WorldConfig, c: Census, profiles: ReturnType<typeof lineageProfiles>, genomeHead: Uint32Array): string {
  const n = cellCount(cfg);
  const params = new Map<string, [number, number]>();
  for (let i = 0; i < n; i++) {
    const hi = genomeHead[G.LIN_HI * n + i], lo = genomeHead[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    const key = `${hi}:${lo}`;
    if (!params.has(key)) params.set(key, [genomeHead[G.PARAM0 * n + i], genomeHead[G.PARAM1 * n + i]]);
  }
  const mass = new Map(c.lineages.map((l) => [l.key, l.mass]));
  return profiles
    .map((p) => {
      const [p0, p1] = params.get(p.key) ?? [0, 0];
      return `${c.step}\t${p.key}\t${p.cells}\t${mass.get(p.key) ?? 0}\t${p.photo}\t${p.grow}\t${p.decomp}\t${p.resp}\t${p.role}\t${p0 & 0xffff}\t${p0 >>> 16}\t${p1 & 0xff}\n`;
    })
    .join("");
}

export function runId(spec: RunSpec): string {
  return spec.runId ?? `${spec.experiment}/${spec.presetId}/${spec.condition}/seed-${spec.seed}`;
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
  // A branch run (RunSpec.branch) is refused here, before any state is built or the GPU touched.
  const branchBad = branchError(spec, cfg, opts);
  if (branchBad) throw new Error(branchBad);
  // A picked run (RunSpec.picked) is one whole history from its preset: refused here too, before any state is built.
  const picked = spec.picked === true;
  if (picked !== !!(opts.picker || opts.picks)) throw new Error(picked ? "a picked run needs its picks (a picker or a record)" : "a picker or recorded picks need spec.picked");
  if (picked) {
    if (opts.start || opts.observer) throw new Error("a picked run cannot continue from a checkpoint; replay its picks (--picks-from) from step 0");
    if (opts.immigrant) throw new Error("a picked run cannot import an immigrant state");
    const pickedBad = pickedConfigError(spec, cfg) ?? picksPreflightError(opts.picks ?? [], cfg, 0, spec.steps, !!opts.picker || !!opts.implicitRule);
    if (pickedBad) throw new Error(pickedBad);
  }
  // Migration fires on multiples of the *absolute* step (see migration.ts), checked once
  // per census chunk: requiring it to land on a census boundary keeps a segmented run's
  // migration events at the same absolute steps as a continuous run's (the stitching
  // invariant tests/deno/stitch.ts checks), exactly like checkpointEvery's own rule below.
  const migrationPeriod = cfg.migrationPeriod ?? 0;
  if (migrationPeriod > 0 && migrationPeriod % spec.censusEvery !== 0) throw new Error("migrationPeriod must be a multiple of censusEvery");
  // The pond cycle (WorldConfig.pondPeriod) is keyed on the absolute step like
  // migration, at the same hook, so it takes the same cadence guards (this one
  // and the start-step one below). Its ponds each keep their own matter, so a
  // pond run never imports cells from another run (a metapopulation member is
  // already refused by specConfig).
  const pondPeriod = cfg.pondPeriod ?? 0;
  if (pondPeriod > 0 && pondPeriod % spec.censusEvery !== 0) throw new Error("pondPeriod must be a multiple of censusEvery");
  // Declared cells (WorldConfig.cellPeriod, cells sandbox): the same hook and the same cadence guards.
  const cellPeriod = cfg.cellPeriod ?? 0;
  if (cellPeriod > 0 && cellPeriod % spec.censusEvery !== 0) throw new Error("cellPeriod must be a multiple of censusEvery");
  if (pondPeriod > 0 && opts.immigrant) throw new Error("a pond run cannot import an immigrant state: cross-run exchange would move matter into and out of its ponds");
  // A branch run starts from its source (RunOptions.branchFrom) under this run's own config: the source's cells, genome
  // and ledger at its step, whose boundary transform is applied below.
  const init =
    (opts.branchFrom ? { ...opts.branchFrom, cfg } : undefined) ??
    opts.start ??
    (spec.soloFounder !== undefined || spec.soloGenome !== undefined || spec.founderSet !== undefined
      ? m3World(
          cfg,
          preset.init.founders,
          preset.init.nutrient,
          preset.init.biomass,
          spec.founderSet !== undefined
            ? spec.founderSet.map(genomeFromHex)
            : spec.soloGenome !== undefined
              ? genomeFromHex(spec.soloGenome)
              : spec.soloFounder,
        )
      : initWorld(cfg, preset.init));
  const startStep = init.step;
  // Checked first among the start-step guards, so a listed boundary off this run's census grid
  // (which the two pond cadence guards also rule out) is named as such.
  const preCycleBad = preCycleError(spec, cfg, startStep);
  if (preCycleBad) throw new Error(preCycleBad);
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
  if (pondPeriod > 0 && startStep % spec.censusEvery !== 0)
    throw new Error(`pond runs must start on a multiple of censusEvery (start step ${startStep}, censusEvery ${spec.censusEvery})`);
  if (cellPeriod > 0 && startStep % spec.censusEvery !== 0)
    throw new Error(`declared-cell runs must start on a multiple of censusEvery (start step ${startStep}, censusEvery ${spec.censusEvery})`);
  const settings = observerSettings(spec);
  // The lineageObs bookkeeping (lineages already seen, the previous census's individuals) is not part of
  // the checkpointed observer state, so those files are only exact for a run observed from its start.
  if (spec.lineageObs && opts.start && opts.start.step > 0) throw new Error("lineageObs needs a run observed from step 0; it cannot continue a checkpoint");
  if (opts.start) {
    const bad = continuationError(spec, opts.start, opts.observer);
    if (bad) throw new Error(bad);
  } else if (opts.observer) {
    // An observer for the preset's own start world: its pond field obeys the same rule.
    const bad = pondContinuationError(cfg, opts.observer, startStep);
    if (bad) throw new Error(bad);
  }
  if (opts.immigrant && !spec.metapopulation) throw new Error("an immigrant state requires spec.metapopulation");
  if (opts.immigrant) {
    const bad = immigrantError(spec, startStep, opts.immigrant);
    if (bad) throw new Error(bad);
  }
  // Applied once, before any physics steps: the segment's *actual* starting
  // point. `startHash` (the coordinator-validated digest of `opts.start`,
  // above) stays the pre-import predecessor digest -- `manifest.json` records
  // this adjusted state's own hash separately (`importedStartHash`) so
  // stitch/analyze can tell a recorded import apart from a real discontinuity
  // (see exchange.ts's doc and packages/runner/src/stitch.ts).
  const exchange = opts.immigrant
    ? applyExchange(init, opts.immigrant, exchangePositions(cfg, spec.metapopulation!.salt, startStep, spec.metapopulation!.migrantCount), startStep)
    : null;
  // A branch's first transform (the branch contract): boundary B's cycle of the current, with this run's seed, on the CPU
  // before any simulation exists. M_r, the matter total and the ledger baseline are the source's own, which the
  // transform preserves exactly (`branchTransform` asserts it).
  const branched = opts.branchFrom ? branchTransform(init, spec.branch!.boundary, pondContext(init)!) : null;
  const actualInit = branched?.state ?? exchange?.state ?? init;
  const t0tot = totalsOf(cfg, actualInit.cells);
  // Ledger baseline: content + exported heat - absorbed light is invariant.
  // Computed from `actualInit` (post-import when there is one), so this
  // segment's physics-conservation check (`conservationOk` below) verifies
  // conservation *from the segment's real starting point forward* -- the
  // exchange itself is accounted for explicitly, once, here, rather than
  // silently weakening the check by comparing against a pre-import baseline
  // an import was never going to match.
  const baseline = t0tot.energy + actualInit.heatOut - actualInit.lightIn;
  const startMatter = t0tot.matter;
  // Pond runs only: M_r and the conservation baseline of every cycle, from this
  // segment's own start (see migrate.ts's PondContext).
  const ponds = pondContext(branched ? init : actualInit);
  const sim = await GpuSim.create(device, actualInit);
  const obs = restoreObservers(opts.observer, settings, cfg);
  // Observers start fresh on a branch's post-transform state, which has had its boundary's cycle.
  if (branched) obs.ponds = { lastCycle: branched.ponds.b };
  const { tracker, activity } = obs;
  // RunSpec.preCycleCheckpoints: boundary step -> b, and the manifest's list of what was written.
  const preCycleAt = new Map((spec.preCycleCheckpoints ?? []).map((b) => [b * pondPeriod, b]));
  const preCycleFiles: { boundary: number; step: number; file: string; hash: string }[] = [];
  // A picked run's record of who chose, finished with counts and the digest at the end.
  const picksInfo: { file: string; picker: string; recorded?: number; live?: number; boundaries?: number; digest?: string } = { file: PICKS_FILE, picker: opts.picker?.name ?? "replay" };
  const pickLog: PickEntry[] = [];
  const pickBy = { recorded: 0, live: 0 };
  const note: PickNote = { by: "none", suggested: [] };
  const manifest = {
    runId: runId(spec),
    spec: normalizedSpec(spec),
    cfg,
    init: preset.init,
    // Provenance of the starting distribution: the preset's identity (config,
    // init and founder set; presetIdentity) and, for a run built from the
    // preset rather than continued from a checkpoint, the initial state's hash,
    // so analysis can verify which founders a bundle actually started from.
    // This is the preset-built world, which analysis can rebuild and compare;
    // a step-zero import is recorded separately as importedStartHash below.
    presetIdentity: presetIdentity(preset),
    ...(opts.start || branched ? {} : { initHash: stateHash(init) }),
    // A branch's first segment: where it came from and the state its transform produced, which a replay of the transform
    // from the source must reproduce. Absent from every other manifest (a branch's later segments included).
    ...(branched ? { branch: { ...spec.branch!, postHash: stateHash(actualInit) } } : {}),
    schemaVersion: SCHEMA_VERSION,
    ruleVersion: RULE_VERSION,
    metricsVersion: METRICS_VERSION,
    host,
    startStep,
    // Present (non-null only when this segment applied an import) *only* for
    // a metapopulation run -- an ordinary run's manifest omits both keys
    // entirely rather than carrying them as always-null, so it stays
    // byte-identical to its shape from before metapopulation existed (review
    // P2; same discipline as migrations.tsv/exchanges.tsv not appearing in
    // BUNDLE_FILES). When present: the hash of the state physics actually
    // started from, which legitimately differs from the coordinator's own
    // startHash (the pre-import predecessor's digest), and the net matter
    // this boundary moved (imports - exports; not zero in general -- see
    // exchange.ts), for a standalone archipelago checker to reconcile
    // against `exchanges.tsv` without recomputing it.
    ...(spec.metapopulation
      ? {
          importedStartHash: exchange ? stateHash(actualInit) : null,
          netExchangeMatter: exchange ? exchangeMatterTotal(exchange.imports) - exchangeMatterTotal(exchange.exports) : null,
        }
      : {}),
    startedAt: new Date().toISOString(),
    checkpoints: [] as { step: number; file: string; hash: string }[],
    // Only when RunSpec.preCycleCheckpoints is set, so every other manifest keeps its shape.
    ...(spec.preCycleCheckpoints !== undefined ? { preCycleCheckpoints: preCycleFiles } : {}),
    // Only for a picked run. Its checkpoints are analysis artifacts, not resume points (`picked` refuses `start`).
    ...(picked ? { picks: picksInfo } : {}),
    summary: null as RunSummary | null,
  };
  await sink.writeText("manifest.json", JSON.stringify(manifest, null, 2));
  await sink.writeText("mutations.tsv", "childHi\tchildLo\tparentHi\tparentLo\n");
  // Declared cells: every birth is also a mutations.tsv row (child and parent ids); cells.tsv adds what the pass saw.
  if (cellPeriod > 0) await sink.writeText("cells.tsv", "step\tchildHi\tchildLo\tparentHi\tparentLo\tanchor\tcells\tmass\tmutated\n");
  await sink.writeText("lineages.tsv", "step\tlineage\tcells\n");
  await sink.writeText("heredity.tsv", "step\tmuA\tmuB\tsigmaA\tsigmaB\tmassA\tmassB\n");
  await sink.writeText("series.jsonl", "");
  await sink.writeText("life.jsonl", "");
  // Only written when migration is configured, so a migration-disabled run's bundle is
  // byte-for-byte what it was before this file existed (no empty header appears either).
  if (migrationPeriod > 0) await sink.writeText("migrations.tsv", "step\tslot\tfromTile\ttoTile\tfromCell\ttoCell\tmatter\tlineageHi\tlineageLo\n");
  // Only written for a metapopulation run, same discipline. Both directions
  // this run exchanged at this boundary go in one file (a `direction` column)
  // rather than an "imports.tsv" that would only tell half the story of this
  // run's own per-run ledger (see exchange.ts's doc on why the "export" rows
  // are logged here, by the *importing* run, not by the predecessor).
  if (spec.metapopulation) await sink.writeText("exchanges.tsv", "step\tdirection\tslot\tcell\tmatter\tlineageHi\tlineageLo\n");
  // Written in every pond run, header only when this call crosses no boundary,
  // and never otherwise (same discipline as migrations.tsv): one row per
  // recipient (scaf, rand) or per pond (cont, nat, shuf) per boundary, formatted as
  // tools/scaffold.ts writes them (the hunt's nat and shuf with three more columns).
  const pondCols = pondColumns(cfg.pondArm, cfg.pondScore);
  if (ponds) await sink.writeText("ponds.tsv", pondsHeader(cfg.pondArm, cfg.pondScore));
  // Only a picked run has a pick log; the donor hook appends its `failed` lines to it.
  if (picked) await sink.writeText(PICKS_FILE, "");
  const hook = picked
    ? makeDonorHook({ cfg, recorded: new Map((opts.picks ?? []).map((e) => [e.step, e])), picker: opts.picker, implicitRule: opts.implicitRule, sink, note })
    : undefined;
  // A branch's own transform, at its source's boundary: its rows come before the first census, as they would in a run that reached it.
  if (branched) {
    await sink.appendText("ponds.tsv", pondTsvRows(branched.ponds.rows, pondCols));
    if (branched.ponds.ended) onProgress(`cycle ${branched.ponds.b} at t=${startStep}: no pond eligible, every pond cleared to nutrient (branch ended; stepping on)`);
  }
  if (exchange) {
    const rows = (dir: "import" | "export", es: typeof exchange.imports) => es.map((e) => `${e.step}\t${dir}\t${e.slot}\t${e.cell}\t${e.matter}\t${e.lineageHi}\t${e.lineageLo}`);
    await sink.appendText("exchanges.tsv", [...rows("import", exchange.imports), ...rows("export", exchange.exports)].join("\n") + "\n");
  }
  // Only written when opted into, same discipline as migrations.tsv/exchanges.tsv: a run without
  // speciesCensus has no species.tsv at all, and every other file stays byte-identical to before
  // this field existed. actualInit's {cfg, genome} are already in memory, so the step-0 baseline
  // row needs no readback.
  if (spec.speciesCensus) {
    await sink.writeText("species.tsv", "step\ttile\tgeneticRichness\tlivingCells\tfounderPresenceMask\n");
    await sink.appendText("species.tsv", speciesTsvRows(actualInit.step, tileSpeciesCensus({ step: actualInit.step, cfg, genome: actualInit.genome }, SPECIES_ANCHORS)));
  }

  // Foundations-review observers (RunSpec.lineageObs): written only when opted into, same
  // discipline as species.tsv, so every other file stays byte-identical.
  if (spec.lineageObs) {
    await sink.writeText("profiles.tsv", "step\tlineage\tcells\tmass\tphoto\tgrow\tdecomp\tresp\trole\tmu\tsigma\tmotGain\n");
    await sink.writeText("genomes.tsv", "lineage\tfirstStep\twords\n");
    await sink.writeText("births.tsv", "step\tkind\tparent\tchild\tchildGeneration\tparentLineage\tchildLineage\tparentMass\tparentBiomass\tparentCells\tparentPurity\tchildMass\tchildBiomass\tchildCells\tchildPurity\n");
  }
  const seenLineages = new Set<string>();
  // Individual id -> its component at the previous census (a parent's traits just before a fission).
  let prevIndStats = new Map<number, IndStats>();

  const t0 = performance.now();
  let prevFlux = actualInit.flux.slice();
  let conservationOk = true;
  let lastCensus = { individuals: 0, lineages: 0 };
  // Pond runs: whether the next census is the first after a pond boundary.
  // Known from the step alone, so a segment starting at a boundary (whose
  // cycle its predecessor applied) flags its first census as a continuous
  // run would.
  let afterCycle = ponds !== null && startStep > 0 && startStep % pondPeriod === 0;

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
      if (spec.lineageObs) {
        const fresh = c.lineages.filter((l) => !seenLineages.has(l.key));
        if (fresh.length) {
          for (const l of fresh) seenLineages.add(l.key);
          await sink.appendText("genomes.tsv", genomeRows(cfg, c.step, new Set(fresh.map((l) => l.key)), await sim.readGenomeChannels(0, GENOME_CHANNELS)));
        }
        const cur = indStats(c, obs.tracker);
        const rows: string[] = [];
        const row = (kind: string, parent: number, child: number) => {
          const p = prevIndStats.get(parent), k = cur.get(child);
          if (!p || !k) return;
          const gen = obs.tracker.alive.get(child)?.generation ?? 0;
          rows.push(`${c.step}\t${kind}\t${parent}\t${child}\t${gen}\t${p.lineage}\t${k.lineage}\t${p.mass}\t${p.biomass}\t${p.cells}\t${p.purity}\t${k.mass}\t${k.biomass}\t${k.cells}\t${k.purity}`);
        };
        for (const e of o.events) if (e.kind === "fission") for (const id of e.children) row("fission", e.parent, id);
        for (const x of o.life as { kind: string; parent?: number; child?: number }[]) if (x.kind === "budding") row("budding", x.parent!, x.child!);
        if (rows.length) await sink.appendText("births.tsv", rows.join("\n") + "\n");
        prevIndStats = cur;
      }

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
      // Pond runs: tracker-derived outputs (life.jsonl, heredity.tsv, buddings,
      // generations) link across a cycle's grind, so analysis must not read
      // them across it (protocol v1); this marks where each cycle falls.
      if (afterCycle) {
        rec.afterCycle = true;
        afterCycle = false;
      }

      rec.patternEntropy = entropy(sym);
      if (o.prevSym) rec.temporalMI = temporalMI(o.prevSym, sym);

      if (deep && snap.roles) {
        const profiles = lineageProfiles(cfg, snap.roles, genomeHead);
        const rs = roleSummary(profiles);
        rec.roles = rs.share;
        rec.rolesPresent = rs.present;
        rec.lineageCompression = compressionRatio(lineageBytes(cfg, genomeHead));
        rec.patternCompression = compressionRatio(sym);
        rec.morphology = morphology(cfg, cells, c, DEFAULT_CENSUS.minMass);
        if (spec.lineageObs) await sink.appendText("profiles.tsv", profileRows(cfg, c, profiles, genomeHead));
      }
      await sink.appendText("series.jsonl", JSON.stringify(rec) + "\n");
      lastCensus = { individuals: ind.length, lineages: c.lineages.length };
      // Observation continues through extinction (segments end at their boundary).
      if (o.becameExtinct) onProgress(`extinct at step ${c.step}`);
      // RunSpec.preCycleCheckpoints: the state at a listed boundary before its cycle, with the
      // observer as it stands (ponds.lastCycle = b - 1), read back here, before applyBoundary. Its
      // own readback, since the one applyBoundary returns is the post-cycle state for scaf and rand;
      // the cycle's own readback and everything after it are untouched.
      const preB = preCycleAt.get(c.step);
      if (preB !== undefined) {
        const pre = await sim.readState();
        const file = `checkpoints/b${String(preB).padStart(3, "0")}-pre.blck`;
        await sink.writeBytes(file, encodeCheckpoint(pre, serializeObservers(obs, pre.step, settings)));
        preCycleFiles.push({ boundary: preB, step: pre.step, file, hash: stateHash(pre) });
      }
      // Scheduled through the same helper the lab worker uses (migrate.ts), so
      // both agree bit for bit on when and how migration and the pond cycle
      // apply. Keyed on the absolute step (not this call's own start), so a
      // segmented run fires them at the same steps a continuous run would.
      // Applied after this step's census/observation, before any checkpoint at
      // the same step, so a checkpoint always carries the post-migration and
      // post-cycle state forward.
      // A picked run's hook is passed only at an actual pond boundary: applyBoundary refuses donors anywhere else,
      // and this is called at every census.
      const atPondBoundary = pondPeriod > 0 && c.step !== 0 && c.step % pondPeriod === 0;
      const boundary = await applyBoundary(sim, c.step, ponds, hook && atPondBoundary ? hook : undefined);
      const mevents = boundary.migrations;
      if (mevents.length)
        await sink.appendText(
          "migrations.tsv",
          mevents.map((e) => `${e.step}\t${e.slot}\t${e.fromTile}\t${e.toTile}\t${e.fromCell}\t${e.toCell}\t${e.matter}\t${e.lineageHi}\t${e.lineageLo}`).join("\n") + "\n",
        );
      if (boundary.ponds) {
        await sink.appendText("ponds.tsv", pondTsvRows(boundary.ponds.rows, pondCols));
        obs.ponds = { lastCycle: boundary.ponds.b };
        afterCycle = true;
        // Unlike tools/scaffold.ts, an ended history keeps stepping; later cycles take the same no-donor path.
        if (boundary.ponds.ended) onProgress(`cycle ${boundary.ponds.b} at t=${c.step}: no pond eligible, every pond cleared to nutrient (history ended; stepping on)`);
        if (picked) {
          // From the donors the boundary reports, so the log cannot disagree with what was applied; the rows are already written.
          const entry = { step: c.step, cycle: boundary.ponds.b, donors: [...boundary.ponds.donors] };
          await sink.appendText(PICKS_FILE, formatPickLine({ ...entry, by: note.by, suggested: note.suggested }));
          pickLog.push(entry);
          if (note.by === "recorded") pickBy.recorded++;
          else if (note.by === opts.picker?.name) pickBy.live++;
          // Post-commit: the boundary is applied and logged, so a failure here is recorded as such and recovery replays it.
          if (note.request && opts.picker?.applied) {
            try {
              // A copy: the log's entries feed the manifest's digest, and a callback may scribble on what it is given.
              await opts.picker.applied(note.request, [...entry.donors], note.by);
            } catch (e) {
              await sink.appendText(PICKS_FILE, formatFailedLine(c.step, entry.cycle, note.by, thrownMessage(e), "after"));
              throw new PickError(`pond cycle ${entry.cycle} at t=${c.step}, after the boundary was applied: ${thrownMessage(e)}`);
            }
          }
        }
      }
      // Declared cells: the pass at this boundary, after the census saw the pre-pass state and before
      // any checkpoint. Births are lineage events like mutations (a new id with its parent's).
      const cellPass = await cellsAtBoundary(sim, c.step, boundary.state);
      if (cellPass.births.length) {
        await sink.appendText("mutations.tsv", cellPass.births.map((e) => `${e.childHi}\t${e.childLo}\t${e.parentHi}\t${e.parentLo}`).join("\n") + "\n");
        await sink.appendText("cells.tsv", cellPass.births.map((e) => [e.step, e.childHi, e.childLo, e.parentHi, e.parentLo, e.anchor, e.cells, e.mass, e.mutated ? 1 : 0].join("\t")).join("\n") + "\n");
        obs.mutations += cellPass.births.length;
      }
      // One readState() when either a checkpoint or a species census is due -- never two: both
      // need the full genome buffer (species census needs every GENOME_CHANNELS word per cell,
      // not the 4-word genomeHead readSnapshot already read above), so they share this readback.
      // A pond boundary has already read the post-cycle state back, so it is reused here.
      const dueForCheckpoint = spec.checkpointEvery > 0 && (sim.step - startStep) % spec.checkpointEvery === 0;
      if (dueForCheckpoint || spec.speciesCensus) {
        const st = cellPass.state ?? boundary.state ?? (await sim.readState());
        if (dueForCheckpoint) {
          const file = `checkpoints/t${String(st.step).padStart(9, "0")}.blck`;
          await sink.writeBytes(file, encodeCheckpoint(st, serializeObservers(obs, st.step, settings)));
          manifest.checkpoints.push({ step: st.step, file, hash: stateHash(st) });
        }
        if (spec.speciesCensus) await sink.appendText("species.tsv", speciesTsvRows(st.step, tileSpeciesCensus({ step: st.step, cfg, genome: st.genome }, SPECIES_ANCHORS)));
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
    if (picked) Object.assign(picksInfo, { recorded: pickBy.recorded, live: pickBy.live, boundaries: pickLog.length, digest: await picksDigest(pickLog) });
    await sink.writeText("manifest.json", JSON.stringify({ ...manifest, finishedAt: new Date().toISOString() }, null, 2));
    await sink.writeText("activity-final.json", JSON.stringify({ all: activity.allActivities(), top: activity.top(50) }));
    return { summary, final: opts.keepFinal ? final : undefined, observer };
  } finally {
    sim.destroy();
  }
}
