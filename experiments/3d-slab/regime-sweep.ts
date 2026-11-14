// Regime meters, M2: the runner (docs/3d-regime-meters-plan-2026-10-23.md sections 8.4 and 9; the rule is runs/regime/rule-draft.md, to be
// frozen as experiments/3d-slab/regime-rule.md). Modelled on m4-calibrate.ts: preset plus overrides, one device per process, one JSON per
// job written to `.tmp` and renamed, a job whose JSON exists is skipped, so a killed run resumes by being started again. It measures; the
// rule is applied by regime-readout.ts. Observer-only: it reaches the sims through their public fields (packages/sim-gpu/src/regime.ts)
// and reads its numbers with the pure meters of packages/metrics/src/regime3.ts.
//
// Run (repo root, native WebGPU):  deno run -A --no-lock experiments/3d-slab/regime-sweep.ts --stage=dev|gate|main|late [flags]
//
// STAGES (R2, R9) and their queues
//   dev   Stage 0 (R9.0), seeds 9001 to 9003. G3 (slab mu60-s8-k1024), slab B0 (mu30-s8-k256) for information and G2 (2D spots-m3 and
//         gradient-m3, each read at 50,000 and 100,000 steps, T1 and T2; not at 20,000, where the registered 2D worlds are still filling,
//         R1): 18 jobs. Both rungs and the F pair for every metered job. The constant screen (R9.0) rides on the seed-9001 B0 job.
//         Output runs/regime/dev/, ids start `dev-`.
//   gate  the held-out gate (R9.1), seeds 101 to 103: G1 slab mu20-s8-k256 (3), G3 (3), G4 slab mu20-s8-k4096 (seeds 101, 102), G2 (12
//         reads, at T1 and T2): 20 jobs, both rungs and the F pair. --rung and --decider are required: they record the combination Stage 0 selected.
//   main  the sweep (R2.3): 32 settings (groups A to D and the mutRate control) x seeds 101 to 103 at T0 = 20,000 = 96 jobs, ONE rung (the
//         gate's, from gate.json), no F pair. The extension of R8.5 is --seeds=104,105,106 with --only=<the SPLIT settings>.
//   late  the late check (R11): the same 96 at T1 = 50,000, run only through --only (at most 6 settings), each a fresh burn-in.
//   One JSON per (job, rung): `<id>.json` with the rung (and, for main and late, the decider) at the end of the id, in --out (default
//   runs/regime/dev for dev, runs/regime/jobs for the others, runs/regime/devjobs under --dev). A dev or gate job writes a P1 and a P2 file
//   from one burn-in: the second rung's phase uses a frozen copy of R, so both see the same state at T. EXTINCT and NO_TARGET jobs write
//   both files too (no twins, no class). Also written (neither is a job; the reader skips them): constant-screen.json in the dev --out (the
//   reader's ConstantScreen: seed, setting, T, rung, decider, base and rows of {key, factor, value, nDecS30, n1_100}, plus both deciders'
//   counts) and, with --capture, `<id>.json` in --captures (the reader's Capture: id, W, H, D, steps {"10", "100", "1000"} -> flat x, y, z).
//
// FLAGS (plan 8.4)
//   --out=<dir>   --reverse   --only=<a,b,...>   --shard=i/n   --stage=...   --rung=P1|P2   --decider=net|occ   --t=<T>   --m4=<dir>
//   --capture   --dev
//   --captures=<dir>  where --capture writes (default: runs/regime/captures when --out ends in /jobs, else <out>/captures)
//   --only        job ids (with or without -P1/-P1-net), setting or preset ids (mu30-s8-k256, spots-m3), roles (G1 G2 G3 G4 B0 SWEEP), `B0`
//                 (the base setting in the main and late stages), `<world>-seed<n>`.
//   --shard=i/n   takes the jobs whose index in the stage's canonical queue (before --only and --kind) mod n is i; --reverse then walks
//                 them from the other end. Two machines can share a queue (shard, or reverse, with the outputs merged).
//   --rung, --decider  main and late read them from gate.json (the flags, if given, must agree); the gate records them; under --dev the
//                 main and late stages need them. In the dev stage they are the rung and decider of the constant screen (default P1, net).
//   --t           slab: the stage's own time; 2D: filters the two times (50,000, 100,000), so --t=20000 is a refusal for the dev and gate stages; --dev: any multiple of 1,000.
//   --m4=<dir>    the 180 exact M4 JSONs (default runs/m4-calibration). Without a JSON, experiments/3d-slab/m4-results.tsv is the rounded
//                 fallback (mode tsv-rounded; the gate's readout refuses it). Each job records m4Source {path, sha256, mode}.
//   --capture     re-runs the named jobs (their burn-in again) and writes the voxels with |B_S - B_R| >= thetaV at t = 10, 100 and 1,000
//                 (at most 4,000 voxels each, an even stride) as flat x, y, z. If the job's JSON exists the re-run is compared with it by state
//                 hash (R at T, R and S at 1,000) and the JSON is left alone; otherwise the job is written too.
//   --dev         tagged rehearsal: waives the clean-tree, frozen-rule and gate.json refusals; ids start `dev-`; jobs never enter a readout.
//                 Needs --seeds (9900 and up: 9001 to 9003 are Stage 0's, 101 to 109 the gate's, the sweep's and its extension's). Only
//                 with --dev: --grid=WxH (a rehearsal grid; the id carries -g<W>), --t=<any multiple of 1,000>.
//   Added: --kind=slab|2d, --seeds=<n,...>, --gate-json=<file>, --rule-sha=<file>, --keep-going, --list (print the queue and exit), --help.
//
// REFUSALS (exit 2, before any GPU work): main and late without a gate.json that says pass: true, carries the frozen rule's SHA-256 (and
//   the rung, decider, refClass, amplitude label, M4 manifest and development-log hash of R9.5); gate, main and late with an uncommitted
//   change in the four source files (or one of them missing), or with a rule that is not frozen (runs/regime/RULE.sha256, the committed
//   experiments/3d-slab/regime-rule.md and experiments/3d-slab/REGIME-FROZEN must agree); the gate without M4's exact JSONs for its slab jobs
//   in --m4 (the sweep and the late check fall back to the rounded TSV and say so); late naming more than 6 settings; bad flags; a gate whose
//   --rung/--decider, or a gate.json whose combination, differs from R1 of the frozen rule (read with the reader's strict fill form), and a
//   frozen rule whose R1 is not filled in. The rule's records are read as the reader reads them: the LAST hash of RULE.sha256 and of
//   REGIME-FROZEN. A --dev rehearsal seed is 9900 or more, and the seed of its noise-swapped twin (noiseSeed) must not be a reserved one either.
//   The dev stage needs none of them. During a run the source files are hashed again before every job: a change stops the run (exit 3).
//
// STAMPS on every job (R5 C6): ruleSha (the frozen rule; in the dev stage the draft's, ruleSource says which), codeCommit (the last commit
//   that changed one of the four source files, so an unrelated commit does not split a readout; `head` is HEAD), srcHash (SHA-256 of the
//   concatenated contents of packages/sim-gpu/src/regime.ts, packages/metrics/src/regime3.ts, this file and regime-readout.ts), treeClean.
//
// WHAT A JOB JSON HOLDS: the RegimeJob contract of regime3.ts (id, role, kind, world, seed, T, dev, extinctAt, cells, living, Bstar, NE,
//   liveblkT, liveT, h0, liveR, livingEnd, bank = the TwinBank of its rung, checks C1 to C8, ruleSha, codeCommit, srcHash, treeClean,
//   m4Mode) plus: schema, stage, rung, decider, selected, setting {id, group, params, overrides}, grid, status, window, living trace every
//   1,000 steps and the counts at multiples of 5,000 (living5k, what C4 compares), m4Source, stateHashT and stateDigestT (R12.3), the
//   thresholds of the P1 scale (the bank has its rung's), hashes {Z100, R100, R1000, S1000}, divergence {"100", "300", "1000"} -> {Jid, Jg,
//   ngdiff, dLiving, dSumB, census, scale curve} and scaleCurve (t = 1,000), entropy (R6.9, once per job), the colonies, seconds,
//   stepsPerSec (the burn-in's), timings, device, host, uptime at start and end. The extras follow the job-file contract that
//   regime-readout.ts documents in its header.
//   About 0.5 MB for a full bank at 256 x 256 x 8 (S, U, N, five doses, 16 sites, the F pair), under 0.15 MB for a FEW_SITES job.
//
// EXIT CODES: 0 done; 1 a job failed or was INVALID (R5: the queue stops at the first, --keep-going continues); 2 refused or bad usage;
//   3 the source files changed during the run.
//
// DECISIONS where the rule or the plan left a point open (each is reported to the main session):
//   - R2.6 and plan 3.4 put the F pair BEFORE the main bank (the pair runs alone first and is released).
//   - Z runs 100 steps (R2.6); in a FEW_SITES job (no S twin) it runs 1,000, so that R's live count over the whole phase (DIED_IN_PHASE,
//     C7) is logged; its first 100 steps are what C1 reads.
//   - C5 is applied to every twin's row 0 (Z and N against an empty kick, X_F against the S kick), not to S alone ("on each twin").
//   - A FEW_SITES job runs no S, U or F twin (R3.4); the doses, N and Z still run. Doses are not run at all when fewer than two pass the
//     cap (FEW_DOSES, R3.5).
//   - The constant screen takes half = ceil(base / 2) (26 for dtQ, as group D has it) and twice = min(2 x base, range bound): the diffusion
//     constants therefore go to 256, the lattice-parity limit of R2.3, because R9.0 says "or its range bound". Its rung is --rung (default
//     P1: nothing is selected at Stage 0); it keeps the base job's thresholds for every configuration and records both deciders.
//   - C6 is `applicable: false` for every dev-tagged job, Stage 0's included (the rule is frozen after Stage 0, so R5 C6 cannot hold for
//     them); ruleSha is then the draft's hash. `rehearsal` is true for any --dev run, so a readout can refuse them.
//   - C4 cuts M4's trace to this job's length and ignores an M4 extinction after T (M4 ran to 50,000, a job stops at T).
//   - `stateDigestT` is written for every slab job, not only the gateK settings. Each job also keeps the full `stateHashT`.
//   - Two independent computations are cross-checked at run time and a disagreement stops the run ("KERNEL FAULT", not an INVALID job):
//     the kick sets of regime3.ts and regime.ts, the per-site counts against the global count (R6.2), and the CPU's living blocks and
//     voxels against the diff pass at step 0.
//   - The 2D child runs before the slab jobs. A late check names at most 6 settings per invocation (R1 LATE_MAX).

import {
  B0_ID,
  B0_PARAMS,
  GATE_SLABS,
  REGIME,
  blockNetDiff,
  c4Applicable,
  censusDivergence,
  checkC1,
  checkC2,
  checkC3,
  checkC4,
  checkC5,
  checkC6,
  checkC7,
  checkC8,
  colonyLabels,
  doseTable,
  genomeFingerprints,
  jobId,
  keyedPrefix,
  kickPlanP1,
  kickPlanP2,
  lineageDivergence,
  livingColumns,
  medianNonzeroAbs,
  noiseSeed,
  parseCombination,
  parseHashFile,
  placeSites,
  refTimes,
  scaleCurve,
  scaleOf,
  selectionSeed,
  settingId,
  siteColonies,
  siteSumsMatchGlobal,
  spatialEntropy,
  startState,
  storedSteps,
  summarizeJob,
  sweepSettings,
  thresholdsP2,
  unitKickPlan,
  windowMean,
  type CheckName,
  type CheckResult,
  type Decider,
  type DiffColumn,
  type DiffLog as MDiffLog,
  type DiffRow,
  type Geom,
  type JobRole,
  type KickPlan,
  type RegimeJob,
  type Rung,
  type SettingSpec,
  type SiteLog,
  type TwinBank,
} from "@bl/metrics";
import {
  CH,
  G,
  cellCount,
  genomeChannels,
  initWorld,
  presetById,
  presetConfig,
  stateHash,
  totalsOf,
  validateConfig,
  validateState,
  worldH,
  worldW,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import {
  applyKick,
  blockGrid,
  configDiff,
  createControlSim,
  createDiff,
  createSim,
  createTwin,
  freezeRef,
  kickBalls,
  kickSites,
  readChannels,
  requestDeviceFor,
  runLockstep,
  unitKick,
  type BlockGrid,
  type Diff,
  type DiffLog as GDiffLog,
  type FrozenRef,
  type GpuSim,
  type GpuSim3,
  type KickSet,
  type LockMember,
  type RefSimLike,
  type StepSim,
} from "@bl/sim-gpu";

// ---------------------------------------------------------------------------------------------------------------------------------
// Constants and types

export const SCHEMA = "regime-job-1";
export type Stage = "dev" | "gate" | "main" | "late";
export type Kind = "slab" | "2d";
type AnySim = GpuSim | GpuSim3;

/** Where this file lives: the repository root is two levels up (experiments/3d-slab/). */
export const ROOT: string = decodeURIComponent(new URL("../../", import.meta.url).pathname);
const rel = (p: string) => ROOT + p;

/** The four source files whose hash and cleanliness stamp every job (R5 C6). */
export const SRC_FILES = ["packages/sim-gpu/src/regime.ts", "packages/metrics/src/regime3.ts", "experiments/3d-slab/regime-sweep.ts", "experiments/3d-slab/regime-readout.ts"] as const;

/** The gate's slab worlds (R9.1). G3 is the known carpet, G1 the known dead world, G4 the starved relic. */
const G1_MU = GATE_SLABS.G1;
const G3_MU = GATE_SLABS.G3;
const G4_MU = GATE_SLABS.G4;
const GATE_2D = ["spots-m3", "gradient-m3"] as const;
const SEEDS_MAIN = [101, 102, 103];
const SEEDS_DEV = [9001, 9002, 9003];
const SEEDS_EXT = [104, 105, 106];
/** Rehearsal seeds (--dev) start here: 9001 to 9003 belong to Stage 0 and 101 to 109 to the gate, the sweep and its extension. */
export const REHEARSAL_SEED_MIN = 9900;
/** The start steps at which the 2D reference worlds are read: T1 and T2 (R1, R9.1; the registered 2D worlds are still filling at T0 = 20,000). */
const TIMES_2D = refTimes(REGIME);
const CAPTURE_POINTS = 4000;
/** Lockstep steps per command buffer: a runner parameter, not a rule constant (R2.6). */
const STEPS_PER_SUBMIT = 10;

export class UsageError extends Error {}

/** Seeds no rehearsal may configure a sim with: 1 to 6 (never used), 101 to 109 (gate, sweep, extension), 9001 to 9003 (Stage 0). */
export const isReservedSeed = (s: number): boolean => (s >= 1 && s <= 6) || (s >= 101 && s <= 109) || (s >= 9001 && s <= 9003);

// ---------------------------------------------------------------------------------------------------------------------------------
// Arguments

export interface Options {
  stage: Stage;
  out: string | null;
  reverse: boolean;
  only: string[];
  shard: { i: number; n: number } | null;
  rung: Rung | null;
  decider: Decider | null;
  t: number | null;
  m4: string | null;
  capture: boolean;
  captures: string | null;
  dev: boolean;
  kind: Kind | null;
  seeds: number[] | null;
  grid: { W: number; H: number } | null;
  gateJson: string | null;
  ruleSha: string | null;
  keepGoing: boolean;
  list: boolean;
  help: boolean;
}

const KNOWN = new Set(["stage", "out", "reverse", "only", "shard", "rung", "decider", "t", "m4", "capture", "captures", "dev", "kind", "seeds", "grid", "gate-json", "rule-sha", "keep-going", "list", "help"]);
const BOOLEAN = new Set(["reverse", "capture", "dev", "keep-going", "list", "help"]);

const intArg = (name: string, v: string): number => {
  if (!/^\d+$/.test(v)) throw new UsageError(`--${name}=${v}: not a non-negative integer`);
  return Number(v);
};

/** Parses `--key=value` and `--flag` arguments. Throws UsageError on anything unknown or malformed. */
export function parseArgs(args: readonly string[]): Options {
  const raw = new Map<string, string>();
  for (const a of args) {
    const m = /^--([a-z0-9-]+)(?:=(.*))?$/.exec(a);
    if (!m || !KNOWN.has(m[1])) throw new UsageError(`unknown argument ${a} (try --help)`);
    if (BOOLEAN.has(m[1]) ? m[2] !== undefined : m[2] === undefined) throw new UsageError(`--${m[1]} ${BOOLEAN.has(m[1]) ? "takes no value" : "needs =value"}`);
    raw.set(m[1], m[2] ?? "true");
  }
  const stage = raw.get("stage") as Stage | undefined;
  if (!raw.has("help") && (stage === undefined || !["dev", "gate", "main", "late"].includes(stage))) throw new UsageError("--stage=dev|gate|main|late is required");
  const shardS = raw.get("shard");
  let shard: Options["shard"] = null;
  if (shardS !== undefined) {
    const m = /^(\d+)\/(\d+)$/.exec(shardS);
    if (!m || Number(m[2]) < 1 || Number(m[1]) >= Number(m[2])) throw new UsageError(`--shard=${shardS}: expected i/n with 0 <= i < n`);
    shard = { i: Number(m[1]), n: Number(m[2]) };
  }
  const rung = raw.get("rung");
  if (rung !== undefined && rung !== "P1" && rung !== "P2") throw new UsageError(`--rung=${rung}: expected P1 or P2`);
  const decider = raw.get("decider");
  if (decider !== undefined && decider !== "net" && decider !== "occ") throw new UsageError(`--decider=${decider}: expected net or occ`);
  const kind = raw.get("kind");
  if (kind !== undefined && kind !== "slab" && kind !== "2d") throw new UsageError(`--kind=${kind}: expected slab or 2d`);
  const gridS = raw.get("grid");
  let grid: Options["grid"] = null;
  if (gridS !== undefined) {
    const m = /^(\d+)(?:x(\d+))?$/.exec(gridS);
    if (!m) throw new UsageError(`--grid=${gridS}: expected WxH (for example 128x128)`);
    grid = { W: Number(m[1]), H: Number(m[2] ?? m[1]) };
    if (grid.W % 8 !== 0 || grid.H % 8 !== 0 || grid.W < 16 || grid.H < 16) throw new UsageError("--grid: a whole number of 8 x 8 blocks, at least 16 x 16");
  }
  const seedsS = raw.get("seeds");
  const seeds = seedsS === undefined ? null : seedsS.split(",").map((s) => intArg("seeds", s.trim()));
  if (seeds !== null && seeds.length === 0) throw new UsageError("--seeds: empty");
  const tS = raw.get("t");
  return {
    stage: (stage ?? "dev") as Stage,
    out: raw.get("out") ?? null,
    reverse: raw.has("reverse"),
    only: (raw.get("only") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    shard,
    rung: (rung as Rung | undefined) ?? null,
    decider: (decider as Decider | undefined) ?? null,
    t: tS === undefined ? null : intArg("t", tS),
    m4: raw.get("m4") ?? null,
    capture: raw.has("capture"),
    captures: raw.get("captures") ?? null,
    dev: raw.has("dev"),
    kind: (kind as Kind | undefined) ?? null,
    seeds,
    grid,
    gateJson: raw.get("gate-json") ?? null,
    ruleSha: raw.get("rule-sha") ?? null,
    keepGoing: raw.has("keep-going"),
    list: raw.has("list"),
    help: raw.has("help"),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Job lists (R2.3, R2.4, R9.1): pure functions of the options, no GPU and no file system

/** The selected combination of rung and decider (R1): from gate.json for the main and late stages, recorded by the gate. */
export interface Selection {
  rung: Rung;
  decider: Decider;
}

/** One job: a world read at a time T. The rungs are the twin phases it runs (dev and gate: both; main and late: the selected one). */
export interface JobSpec {
  kind: Kind;
  role: JobRole;
  /** Setting id (slab) or preset id (2D), plus `-g<W>` on a rehearsal grid: the `world` of the job id. */
  world: string;
  settingId: string | null;
  setting: SettingSpec | null;
  preset: string;
  seed: number;
  T: number;
  /** Tagged `dev`: Stage 0 jobs and --dev rehearsals. Ids start `dev-`. */
  dev: boolean;
  rungs: Rung[];
  /** The selected decider (main and late jobs; it ends the id). */
  decider: Decider | null;
  fPair: boolean;
  /** The constant screen of R9.0 rides on this job's burn-in. */
  screen: boolean;
  grid: { W: number; H: number } | null;
  /** One id (and one JSON file) per rung. */
  ids: string[];
  /** Position in the stage's canonical list, before --only, --kind, --shard and --reverse (what --shard divides). */
  index: number;
}

/** A slab setting by its three M4 axes: the other axes at B0's values, the overrides `presetConfig` gets (R2.1). */
export function slabSpec(mu: number, sigma: number, lightK: number): SettingSpec {
  const params = { ...B0_PARAMS, mu, sigma, lightK };
  return { id: settingId(params), group: "A", params, control: false, overrides: { defaultMu: mu, defaultSigma: sigma, lightK } };
}

/** The world part of a job id: the setting or preset id, marked `-g<W>` on a rehearsal grid (the plan's `g128`). */
export const worldName = (id: string, grid: { W: number; H: number } | null): string => (grid ? `${id}-g${grid.W === grid.H ? grid.W : `${grid.W}x${grid.H}`}` : id);

/** Settings M4 never varied (R5 C4): a changed diffusion, gate, dtQ or spread constant, or the mutRate control. */
export const changedUnvariedKey = (s: SettingSpec | null): boolean => !!s && (s.control || Object.keys(s.overrides).some((k) => !["defaultMu", "defaultSigma", "lightK"].includes(k)));

/** Checks the combinations of options that the stages allow; throws UsageError. */
export function validateOptions(o: Options): void {
  const real = o.stage === "dev" ? SEEDS_DEV : o.stage === "gate" ? SEEDS_MAIN : [...SEEDS_MAIN, ...SEEDS_EXT];
  if (o.dev) {
    if (!o.seeds) throw new UsageError(`--dev needs --seeds=<n,...> (rehearsal seeds, ${REHEARSAL_SEED_MIN} and up): the seeds of the stages are reserved`);
    for (const s of o.seeds) {
      if (s < REHEARSAL_SEED_MIN) throw new UsageError(`--dev: seed ${s} is reserved (9001 to 9003 are Stage 0's, 101 to 109 the gate's, the sweep's and its extension's); rehearse on ${REHEARSAL_SEED_MIN} and up`);
      // the N twin runs under seed noiseSeed(s): a configuration that names a reserved seed is not stepped in a rehearsal either (R4.10, R0.2)
      const ns = noiseSeed(s);
      if (isReservedSeed(ns)) throw new UsageError(`--dev: seed ${s} gives the noise-swapped twin the reserved seed ${ns}; pick another rehearsal seed`);
    }
    if (o.t !== null && (o.t < 1 || o.t % 1000 !== 0)) throw new UsageError("--t: a positive multiple of 1,000 (the burn-in checks every 1,000 steps)");
    if ((o.stage === "main" || o.stage === "late") && (!o.rung || !o.decider)) throw new UsageError(`--dev --stage=${o.stage} needs --rung and --decider (there is no gate.json to read them from)`);
  } else {
    if (o.grid) throw new UsageError("--grid is a rehearsal flag (--dev): the grid of the stages is 256 x 256 x 8 (R1 GRID)");
    if (o.seeds) {
      if (o.stage !== "main" && o.stage !== "late") throw new UsageError(`--seeds is only for the extension of the main and late stages (the seeds of --stage=${o.stage} are fixed)`);
      for (const s of o.seeds) if (!real.includes(s)) throw new UsageError(`--seeds: ${s} is not a gate, sweep or extension seed (101 to 106)`);
    }
    if (o.t !== null) {
      const ok = o.stage === "late" ? [REGIME.T1] : o.stage === "main" ? [REGIME.T0] : TIMES_2D;
      if (!ok.includes(o.t)) throw new UsageError(`--t=${o.t}: --stage=${o.stage} reads at ${ok.join(", ")}`);
    }
  }
  if (o.stage === "gate" && !o.dev && (!o.rung || !o.decider)) throw new UsageError("--stage=gate needs --rung and --decider: the combination Stage 0 selected (R1 RUNG and DECIDER), recorded in every gate job");
  if (o.stage === "late" && o.only.length === 0) throw new UsageError("--stage=late needs --only=<settings or job ids>: the late check re-burns only the settings the readout lists (R11, at most 6)");
  if (o.capture && o.only.length === 0) throw new UsageError("--capture needs --only=<job ids>: it re-runs the jobs it names");
}

/**
 * The canonical queue of a stage (R2). Dev: G3 and B0 (slab, T0) then G2 (2D, T1 and T2). Gate: G1, G3, G4, then G2. Main: 32 settings
 * x 3 seeds at T0. Late: the same list at T1 (it is only ever run through --only). `sel` is the selected combination (main and late).
 */
export function jobList(o: Options, sel: Selection | null): JobSpec[] {
  const tag = o.dev || o.stage === "dev";
  const grid = o.grid;
  const seeds = o.seeds ?? (o.stage === "dev" ? SEEDS_DEV : SEEDS_MAIN);
  const out: JobSpec[] = [];
  const add = (j: Omit<JobSpec, "ids" | "index" | "dev" | "grid">) => {
    const world = worldName(j.world, grid);
    const ids = j.rungs.map((rung) => jobId({ dev: tag, kind: j.kind, world, seed: j.seed, T: j.T, rung, decider: j.decider ?? undefined }));
    out.push({ ...j, world, dev: tag, grid, ids, index: out.length });
  };
  const slab = (role: JobRole, s: SettingSpec, seed: number, T: number, extra: Partial<JobSpec> = {}) =>
    add({ kind: "slab", role, world: s.id, settingId: s.id, setting: s, preset: "slab-spots", seed, T, rungs: ["P1", "P2"], decider: null, fPair: true, screen: false, ...extra });
  const flat = (preset: string, seed: number, T: number) =>
    add({ kind: "2d", role: "G2", world: preset, settingId: null, setting: null, preset, seed, T, rungs: ["P1", "P2"], decider: null, fPair: true, screen: false });
  const T2d = o.t !== null ? [o.t] : TIMES_2D;
  // The slab is read at T0 whatever --t says (--t filters the two 2D times, T1 and T2); only a --dev rehearsal may move it.
  const T0 = o.dev ? (o.t ?? REGIME.T0) : REGIME.T0;
  if (o.stage === "dev") {
    for (const seed of seeds) slab("G3", slabSpec(G3_MU.mu, G3_MU.sigma, G3_MU.lightK), seed, T0);
    seeds.forEach((seed, k) => slab("B0", slabSpec(B0_PARAMS.mu, B0_PARAMS.sigma, B0_PARAMS.lightK), seed, T0, { screen: k === 0 }));
    for (const p of GATE_2D) for (const seed of seeds) for (const T of T2d) flat(p, seed, T);
  } else if (o.stage === "gate") {
    for (const seed of seeds) slab("G1", slabSpec(G1_MU.mu, G1_MU.sigma, G1_MU.lightK), seed, T0);
    for (const seed of seeds) slab("G3", slabSpec(G3_MU.mu, G3_MU.sigma, G3_MU.lightK), seed, T0);
    for (const seed of seeds.filter((s) => s === 101 || s === 102 || o.dev)) slab("G4", slabSpec(G4_MU.mu, G4_MU.sigma, G4_MU.lightK), seed, T0);
    for (const p of GATE_2D) for (const seed of seeds) for (const T of T2d) flat(p, seed, T);
  } else {
    if (!sel) throw new UsageError(`--stage=${o.stage} needs the selected combination (gate.json, or --rung and --decider under --dev)`);
    const T = o.t ?? (o.stage === "late" ? REGIME.T1 : REGIME.T0);
    for (const s of sweepSettings()) for (const seed of seeds) add({ kind: "slab", role: "SWEEP", world: s.id, settingId: s.id, setting: s, preset: "slab-spots", seed, T, rungs: [sel.rung], decider: sel.decider, fPair: false, screen: false });
  }
  return out;
}

const RUNG_SUFFIX = /-P[12](-(net|occ))?$/;

/** --only: a token names a job id (with or without its rung and decider), a setting or preset id, a role (G1, G2, G3, G4, B0, SWEEP) or `<world>-seed<n>`. */
export function matchesOnly(j: JobSpec, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const base = j.ids[0].replace(RUNG_SUFFIX, "");
  return tokens.some((raw) => {
    const t = raw.replace(RUNG_SUFFIX, "");
    return t === base || (t === "B0" && j.settingId === B0_ID) || t === j.world || t === j.settingId || t === j.preset || t === j.role || t === `${j.world}-seed${j.seed}` || t === `${j.settingId}-seed${j.seed}`;
  });
}

/** The jobs this invocation takes, in its order: --only, --kind, --shard (on the canonical index), then --reverse. */
export function selectJobs(list: readonly JobSpec[], o: Options): JobSpec[] {
  let xs = list.filter((j) => matchesOnly(j, o.only));
  if (o.kind) xs = xs.filter((j) => j.kind === o.kind);
  const sh = o.shard;
  if (sh) xs = xs.filter((j) => j.index % sh.n === sh.i);
  return o.reverse ? [...xs].reverse() : xs;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Environment: hashes, git, uptime

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const sha256Bytes = async (b: Uint8Array): Promise<string> => hex(await crypto.subtle.digest("SHA-256", b as unknown as BufferSource));
export const sha256Text = (s: string): Promise<string> => sha256Bytes(new TextEncoder().encode(s));

const readOpt = (p: string): Uint8Array | null => {
  try {
    return Deno.readFileSync(p);
  } catch {
    return null;
  }
};
const existsPath = (p: string): boolean => {
  try {
    Deno.statSync(p);
    return true;
  } catch {
    return false;
  }
};

async function run(cmd: string, args: string[], cwd = ROOT): Promise<{ code: number; out: string }> {
  try {
    const r = await new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" }).output();
    return { code: r.code, out: new TextDecoder().decode(r.stdout).trim() };
  } catch {
    return { code: -1, out: "" };
  }
}

/** The machine's load line, recorded beside every timing. */
export async function uptime(): Promise<string> {
  const r = await run("uptime", []);
  return r.code === 0 ? r.out : "uptime unavailable";
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Stamps (R5 C6) and refusals (plan 8.4)

export interface Stamps {
  /** SHA-256 of the frozen rule (runs/regime/RULE.sha256), or of the draft before the freeze, or null. */
  ruleSha: string | null;
  ruleSource: "frozen" | "draft" | "none";
  /** The most recent commit that changed one of the four source files ("uncommitted" if none did). `head` is HEAD. */
  codeCommit: string;
  head: string;
  /** SHA-256 of the concatenated contents of the four source files (those that exist, in the order of SRC_FILES). */
  srcHash: string;
  srcMissing: string[];
  /** True if the four source files have no uncommitted change (an untracked file counts as uncommitted). */
  treeClean: boolean;
  dirty: string[];
  /** Why the frozen rule cannot be trusted (RULE.sha256, the committed copy and REGIME-FROZEN disagree or are missing). */
  ruleProblems: string[];
  /** RUNG and DECIDER of R1 in the committed frozen rule (the reader's strict fill form), or null with the reason. */
  ruleCombo: Selection | null;
  ruleComboWhy: string | null;
}

/** Hashes the source files and asks git; cheap, and run again before every job so a file that changes mid-run is caught. */
export async function sourceStamps(): Promise<Pick<Stamps, "codeCommit" | "head" | "srcHash" | "srcMissing" | "treeClean" | "dirty">> {
  const chunks: Uint8Array[] = [];
  const missing: string[] = [];
  for (const f of SRC_FILES) {
    const b = readOpt(rel(f));
    if (b) chunks.push(b);
    else missing.push(f);
  }
  const all = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  const present = SRC_FILES.filter((f) => !missing.includes(f));
  const st = await run("git", ["status", "--porcelain", "--", ...present]);
  const dirty = st.out === "" ? [] : st.out.split("\n").map((l) => l.trim());
  const head = (await run("git", ["rev-parse", "HEAD"])).out;
  const last = (await run("git", ["log", "-1", "--format=%H", "--", ...present])).out;
  return { codeCommit: last || "uncommitted", head, srcHash: await sha256Bytes(all), srcMissing: missing, treeClean: st.code === 0 && dirty.length === 0, dirty };
}

export async function computeStamps(o: Pick<Options, "ruleSha">, rulesRoot: string = ROOT): Promise<Stamps> {
  const src = await sourceStamps();
  const at = (p: string) => (rulesRoot.endsWith("/") ? rulesRoot : `${rulesRoot}/`) + p;
  const ruleFile = o.ruleSha ?? at("runs/regime/RULE.sha256");
  const frozenRule = at("experiments/3d-slab/regime-rule.md");
  const marker = at("experiments/3d-slab/REGIME-FROZEN");
  const problems: string[] = [];
  let ruleSha: string | null = null;
  let ruleSource: Stamps["ruleSource"] = "none";
  let ruleCombo: Selection | null = null;
  let ruleComboWhy: string | null = "no frozen rule";
  const recorded = readOpt(ruleFile);
  if (recorded) {
    // The current hash is the LAST one in each record (R15: an amendment appends), as the reader reads it.
    const hashes = parseHashFile(new TextDecoder().decode(recorded));
    if (hashes.length === 0) problems.push(`${ruleFile} holds no SHA-256`);
    else {
      ruleSha = hashes[hashes.length - 1];
      ruleSource = "frozen";
      const copy = readOpt(frozenRule);
      if (!copy) problems.push(`the frozen rule ${frozenRule} does not exist (R15: commit it before the gate)`);
      else {
        if ((await sha256Bytes(copy)) !== ruleSha) problems.push(`the SHA-256 of ${frozenRule} differs from ${ruleFile}`);
        const c = parseCombination(new TextDecoder().decode(copy));
        ruleCombo = c.combo;
        ruleComboWhy = c.why;
      }
      const mk = readOpt(marker);
      if (!mk) problems.push(`${marker} does not exist (R15)`);
      else {
        const recordedInMarker = parseHashFile(new TextDecoder().decode(mk));
        if (recordedInMarker[recordedInMarker.length - 1] !== ruleSha) problems.push(`the last SHA-256 in ${marker} is not the rule's`);
      }
    }
  } else {
    const draft = readOpt(at("runs/regime/rule-draft.md"));
    if (draft) {
      ruleSha = await sha256Bytes(draft);
      ruleSource = "draft";
    }
  }
  return { ruleSha, ruleSource, ...src, ruleProblems: problems, ruleCombo, ruleComboWhy };
}

/** What the main and late stages read from gate.json (R9.5). The names are the ones regime-readout.ts is expected to write. */
export interface GateInfo {
  pass: boolean;
  /** The reader's gate file is marked draft, synthetic or invalid: none of these may start a sweep. */
  draft: boolean;
  synthetic: boolean;
  invalidRun: boolean;
  ruleStatus: string | null;
  ruleSha: string | null;
  rung: Rung | null;
  decider: Decider | null;
  refClass: string | null;
  amp: string | null;
  m4Manifest: string | null;
  devLogSha: string | null;
}

const firstString = (r: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) if (typeof r[k] === "string" && (r[k] as string) !== "") return r[k] as string;
  return null;
};

/** gate.json (the reader's `regime-gate/1` file) -> the fields the runner checks. `m4Manifest` is an object path -> SHA-256 there; a non-empty string is accepted too. */
export function parseGate(raw: unknown): GateInfo {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rung = r.rung === "P1" || r.rung === "P2" ? r.rung : null;
  const decider = r.decider === "net" || r.decider === "occ" ? r.decider : null;
  const manifest = r.m4Manifest ?? r.m4ManifestSha ?? r.m4Sha ?? r.manifest;
  const m4Manifest = typeof manifest === "string" && manifest !== "" ? manifest : manifest && typeof manifest === "object" && Object.keys(manifest).length > 0 ? `${Object.keys(manifest).length} files` : null;
  return {
    pass: r.pass === true,
    draft: r.draft === true,
    synthetic: r.synthetic === true,
    invalidRun: r.invalidRun === true,
    ruleStatus: firstString(r, ["ruleStatus"]),
    ruleSha: firstString(r, ["ruleSha", "ruleSHA", "ruleSha256"]),
    rung,
    decider,
    refClass: firstString(r, ["refClass"]),
    amp: firstString(r, ["amp", "ampLabel", "amplitude"]),
    m4Manifest,
    devLogSha: firstString(r, ["devLogSha", "devLogSha256", "devLog"]),
  };
}

/** The refusals about gate.json (R9.5, plan 8.4): a passing gate that carries the frozen rule's hash and the selected combination. */
export function gateProblems(g: GateInfo, ruleSha: string | null, o: Pick<Options, "rung" | "decider">): string[] {
  const p: string[] = [];
  if (!g.pass) p.push("gate.json does not say pass: true (the held-out gate failed or was not run; candidate 8 is closed unless it passed)");
  if (g.draft || g.ruleStatus === "DRAFT") p.push("gate.json was written under a DRAFT rule, not the frozen one");
  if (g.synthetic) p.push("gate.json is SYNTHETIC (the page builder's synthetic sweep), not a gate run");
  if (g.invalidRun) p.push("gate.json records an INVALID gate run (no verdict)");
  if (!ruleSha) p.push("no frozen rule hash (runs/regime/RULE.sha256)");
  else if (g.ruleSha !== ruleSha) p.push(`gate.json carries ruleSha ${g.ruleSha ?? "(none)"}, not the frozen rule's ${ruleSha}`);
  if (!g.rung || !g.decider) p.push("gate.json names no rung and decider");
  if (g.rung && o.rung && o.rung !== g.rung) p.push(`--rung=${o.rung} differs from gate.json's ${g.rung}`);
  if (g.decider && o.decider && o.decider !== g.decider) p.push(`--decider=${o.decider} differs from gate.json's ${g.decider}`);
  if (!g.refClass) p.push("gate.json has no refClass (R9.5)");
  if (!g.amp) p.push("gate.json has no amplitude label (R9.5)");
  if (!g.m4Manifest) p.push("gate.json has no SHA-256 manifest of the M4 JSONs (R9.5)");
  if (!g.devLogSha) p.push("gate.json has no SHA-256 of the development log (R9.5)");
  return p;
}

export interface Preflight {
  problems: string[];
  notes: string[];
  sel: Selection | null;
  gate: (GateInfo & { path: string; sha256: string }) | null;
}

/**
 * The refusals of plan 8.4, before any GPU work: main and late need a passing gate.json that carries the frozen rule's hash; gate, main
 * and late refuse a dirty source tree and a rule that is not frozen consistently; --dev waives all of them (the jobs are tagged).
 */
export async function preflight(o: Options, st: Stamps): Promise<Preflight> {
  const problems: string[] = [];
  const notes: string[] = [];
  let sel: Selection | null = null;
  let gate: Preflight["gate"] = null;
  const strict = !o.dev && o.stage !== "dev";
  if (strict) {
    if (st.srcMissing.length) problems.push(`source files missing: ${st.srcMissing.join(", ")} (srcHash needs all four)`);
    if (!st.treeClean) problems.push(`uncommitted changes in the source files (${st.dirty.join("; ")}); commit them, or use --dev for a tagged rehearsal`);
    if (!st.ruleSha || st.ruleSource !== "frozen") problems.push("the rule is not frozen: runs/regime/RULE.sha256 is missing (R15: the main session freezes it after Stage 0 and before the gate)");
    for (const p of st.ruleProblems) problems.push(p);
    if (st.ruleSource === "frozen" && !st.ruleCombo) problems.push(`R1 of the frozen rule does not hold RUNG and DECIDER (Stage 0 fills them in before the freeze): ${st.ruleComboWhy}`);
  } else if (o.dev) {
    notes.push("--dev: clean-tree, frozen-rule and gate.json refusals waived; jobs are tagged dev and never enter a readout");
  }
  const r1 = st.ruleCombo;
  const differs = (a: Selection, b: Selection) => a.rung !== b.rung || a.decider !== b.decider;
  const lbl = (a: Selection) => `(${a.rung}, ${a.decider})`;
  if (o.stage === "gate") {
    if (o.rung && o.decider) sel = { rung: o.rung, decider: o.decider };
    if (strict && sel && r1 && differs(sel, r1)) problems.push(`--rung=${sel.rung} --decider=${sel.decider} differ from R1 of the frozen rule, ${lbl(r1)}: the gate tests the combination Stage 0 selected and no other (R9.4)`);
  } else if (o.stage === "main" || o.stage === "late") {
    if (o.dev) sel = o.rung && o.decider ? { rung: o.rung, decider: o.decider } : null;
    else {
      const path = o.gateJson ?? rel("runs/regime/gate.json");
      const bytes = readOpt(path);
      if (!bytes) problems.push(`${path} does not exist: the ${o.stage} stage needs a passing held-out gate (R9.5)`);
      else {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
          problems.push(`${path} is not JSON: ${(e as Error).message}`);
        }
        if (parsed !== null) {
          const g = parseGate(parsed);
          gate = { ...g, path, sha256: await sha256Bytes(bytes) };
          for (const p of gateProblems(g, st.ruleSha, o)) problems.push(p);
          if (g.rung && g.decider) sel = { rung: g.rung, decider: g.decider };
          if (sel && r1 && differs(sel, r1)) problems.push(`gate.json's combination ${lbl(sel)} differs from R1 of the frozen rule, ${lbl(r1)}`);
        }
      }
    }
  } else if (o.stage === "dev" && o.rung) {
    sel = { rung: o.rung, decider: o.decider ?? "net" };
  }
  return { problems, notes, sel, gate };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The M4 overlay (R5 C4): the living trace of the same (setting, seed) in M4's exact per-run JSON, or in the rounded TSV

export interface M4Entry {
  mode: "json" | "tsv-rounded";
  path: string;
  sha256: string;
  /** livingTrace5k of the JSON (counts at 5,000, 10,000, ...), or the TSV's rounded fractions. */
  living5k: number[];
  extinctAt: number | null;
}

let tsvCache: { path: string; sha256: string; rows: Map<string, { extinctAt: number | null; fracs: number[] }> } | null | undefined;

function loadTsv(path: string): NonNullable<typeof tsvCache> | null {
  if (tsvCache !== undefined && tsvCache?.path === path) return tsvCache;
  const b = readOpt(path);
  if (!b) return (tsvCache = null);
  const lines = new TextDecoder().decode(b).split("\n").filter(Boolean);
  const head = lines[0].split("\t");
  const col = (name: string) => head.indexOf(name);
  const iId = col("id"), iExt = col("extinctAt"), iTr = col("livingFracEvery5k");
  const rows = new Map<string, { extinctAt: number | null; fracs: number[] }>();
  for (const l of lines.slice(1)) {
    const f = l.split("\t");
    rows.set(f[iId], { extinctAt: f[iExt] === "" || f[iExt] === undefined ? null : Number(f[iExt]), fracs: (f[iTr] ?? "").split(" ").filter(Boolean).map(Number) });
  }
  // The SHA-256 is filled in lazily by the caller (async); keep a placeholder until then.
  return (tsvCache = { path, sha256: "", rows });
}

/**
 * M4's record for (setting, seed): `<dir>/<setting>-seed<n>.json` (mode json) or, failing that, the TSV row (mode tsv-rounded, four
 * decimals: +-26 voxels; the gate refuses it). The id is M4's `mu<mu>-s<sigma>-k<lightK>-seed<n>`, which is the setting id of every
 * setting M4 ran (groups A and B and the gate's worlds).
 */
export async function m4Entry(setting: string, seed: number, dir: string, tsvPath: string): Promise<M4Entry | null> {
  const id = `${setting}-seed${seed}`;
  const jp = `${dir}/${id}.json`;
  const jb = readOpt(jp);
  if (jb) {
    const j = JSON.parse(new TextDecoder().decode(jb)) as { livingTrace5k: number[]; extinctAt: number | null };
    return { mode: "json", path: jp.startsWith(ROOT) ? jp.slice(ROOT.length) : jp, sha256: await sha256Bytes(jb), living5k: j.livingTrace5k, extinctAt: j.extinctAt ?? null };
  }
  const tsv = loadTsv(tsvPath);
  const row = tsv?.rows.get(id);
  if (!tsv || !row) return null;
  if (tsv.sha256 === "") tsv.sha256 = await sha256Bytes(readOpt(tsvPath)!);
  return { mode: "tsv-rounded", path: tsvPath.startsWith(ROOT) ? tsvPath.slice(ROOT.length) : tsvPath, sha256: tsv.sha256, living5k: row.fracs, extinctAt: row.extinctAt };
}

/**
 * The jobs of a queue that C4 applies to (slab jobs of M4's grid at seeds 101 to 103) and whose exact M4 JSON is not in `dir`. The gate
 * refuses to start with any (its readout refuses the rounded TSV for G1 and G3); the sweep falls back to the TSV and says so.
 */
export function m4Missing(queue: readonly JobSpec[], dir: string): string[] {
  return queue
    .filter((j) => j.kind === "slab" && !j.dev && j.settingId !== null && [101, 102, 103].includes(j.seed) && !changedUnvariedKey(j.setting))
    .map((j) => `${j.settingId}-seed${j.seed}.json`)
    .filter((f, i, all) => all.indexOf(f) === i && !existsPath(`${dir}/${f}`));
}

export interface C4Out {
  check: CheckResult;
  mode: "json" | "tsv-rounded" | "none";
  source: { path: string; sha256: string; mode: string } | null;
}

/**
 * C4 for a job: R's living counts at every multiple of 5,000 steps up to T (and the extinction step, if it came first) against M4's.
 * M4's trace is cut to the length of this job's (a job stops at T, M4 at 50,000), and an M4 extinction after T is not an extinction here.
 */
export function c4Of(spec: JobSpec, i: { living5k: readonly number[]; extinctAt: number | null; cells: number }, m4: M4Entry | null): C4Out {
  const subject = { kind: spec.kind, seed: spec.seed, dev: spec.dev, changedUnvariedKey: changedUnvariedKey(spec.setting) };
  if (!c4Applicable(subject)) return { check: { ok: true, applicable: false }, mode: "none", source: null };
  if (!m4) return { check: { ok: false, detail: "no M4 record (neither the JSON nor the TSV row) for this setting and seed" }, mode: "none", source: null };
  const m4Ext = m4.extinctAt !== null && m4.extinctAt <= spec.T ? m4.extinctAt : null;
  const cut = m4.living5k.slice(0, i.living5k.length);
  const r = checkC4({
    subject,
    mode: m4.mode,
    cells: i.cells,
    living5k: i.living5k,
    m4Living5k: m4.mode === "json" ? cut : undefined,
    m4Tsv5k: m4.mode === "tsv-rounded" ? cut : undefined,
    extinctAt: i.extinctAt,
    m4ExtinctAt: m4Ext,
  });
  return { check: { ok: r.ok, ...(r.detail ? { detail: r.detail } : {}) }, mode: m4.mode, source: { path: m4.path, sha256: m4.sha256, mode: m4.mode } };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Output: compact JSON, written to `.tmp` and renamed

let nonFinite = 0;
const finiteOrNull = (_k: string, v: unknown): unknown => {
  if (typeof v === "number" && !Number.isFinite(v)) {
    nonFinite++;
    return null;
  }
  if (typeof v === "bigint") return String(v);
  return v;
};

/** One top-level key per line, each value compact: the logs stay under 1 MB and `grep` still reads the header fields. */
export function jobText(o: Record<string, unknown>): string {
  return "{\n" + Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v, finiteOrNull)}`).join(",\n") + "\n}\n";
}

export function writeAtomic(path: string, text: string): void {
  Deno.writeTextFileSync(`${path}.tmp`, text);
  Deno.renameSync(`${path}.tmp`, path);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// GPU helpers

let theDevice: GPUDevice | null = null;
let adapterDescription = "unknown";

/** One device for the process, sized for the first world (R1 GRID: every world of a run has the same shape). */
async function deviceFor(cfg: WorldConfig): Promise<GPUDevice> {
  if (!theDevice) {
    const gpu = (navigator as unknown as { gpu?: GPU }).gpu;
    if (!gpu) throw new Error("no WebGPU in this runtime: run with Deno and native WebGPU");
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    adapterDescription = (adapter as unknown as { info?: { description?: string } } | null)?.info?.description ?? "unknown";
    theDevice = await requestDeviceFor(gpu, cfg);
  }
  return theDevice;
}

const geomOf = (cfg: WorldConfig): Geom => ({ W: worldW(cfg), H: worldH(cfg), D: cfg.tileD ?? 1 });

export interface World {
  cfg: WorldConfig;
  /** The initial world, a valid state of the right shape (twins are created from it and then overwritten by a fork). */
  state0: WorldState;
  /** R's own initial totals: the baseline of C2 for every sim of the job. */
  start0: ReturnType<typeof totalsOf>;
  /** The same world under B0's configuration (for `stateDigestT`, R12.3). */
  cfgB0: WorldConfig | null;
}

/** `presetConfig(preset, seed, overrides)` then `initWorld`, as m4-calibrate.ts builds a slab; a 2D gate world has no overrides (R2.2). */
export function buildWorld(spec: JobSpec): World {
  const preset = presetById(spec.preset);
  if (!preset) throw new Error(`no preset ${spec.preset}`);
  const grid = spec.grid ? { tileW: spec.grid.W, tileH: spec.grid.H } : {};
  const cfg = presetConfig(preset, spec.seed, { ...(spec.setting?.overrides ?? {}), ...grid });
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error(`invalid config for ${spec.world}: ${errs.join("; ")}`);
  const state0 = initWorld(cfg, preset.init);
  const b0 = spec.kind === "slab" ? presetConfig(preset, spec.seed, { defaultMu: B0_PARAMS.mu, defaultSigma: B0_PARAMS.sigma, lightK: B0_PARAMS.lightK, ...grid }) : null;
  return { cfg, state0, start0: totalsOf(cfg, state0.cells), cfgB0: b0 };
}

export interface Burn {
  extinctAt: number | null;
  living: number;
  /** Living count after each 1,000-step block (the last block is shorter if T is not a multiple of 1,000), and the step of each. */
  trace: number[];
  traceSteps: number[];
  /** Living count at every multiple of 5,000 (the C4 comparison with M4's livingTrace5k). */
  living5k: number[];
  seconds: number;
}

/** The burn-in of m4-calibrate.ts to step T: blocks of 1,000 steps in batches of 100 with drainLedger and readStats after each block; stops at extinction. */
export async function burnIn(sim: AnySim, T: number): Promise<Burn> {
  const t0 = performance.now();
  const trace: number[] = [], traceSteps: number[] = [], living5k: number[] = [];
  let living = 0, extinctAt: number | null = null;
  for (let s = 0; s < T; s += 1000) {
    const n = Math.min(1000, T - s);
    for (let b = 0; b < n; b += 100) sim.run(Math.min(100, n - b));
    await sim.drainLedger();
    living = (await sim.readStats()).living;
    trace.push(living);
    traceSteps.push(s + n);
    if ((s + n) % 5000 === 0) living5k.push(living);
    if (living === 0) {
      extinctAt = s + n;
      break;
    }
  }
  return { extinctAt, living, trace, traceSteps, living5k, seconds: (performance.now() - t0) / 1000 };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Logs: the GPU rows -> the JSON-safe columns of regime3.ts

const COLUMNS = [
  "n_blk", "n_blk2", "n_occ", "L1c", "liveblk_R", "n_thetaV", "n_2thetaV", "n_1", "n_live", "n_vox",
  "L1_A", "L1_B", "L1_C", "L1_P", "SB_R", "live_R", "SB_X", "live_X",
] as const satisfies readonly DiffColumn[];

/** Columns by name: `log.n_blk[t]` is the counter after t steps (t = 0 is the pass before step 1). */
export function toDiffLog(l: GDiffLog): MDiffLog {
  const out = Object.fromEntries(COLUMNS.map((c) => [c, [] as number[]])) as unknown as MDiffLog;
  for (let t = 0; t < l.rows; t++) for (const c of COLUMNS) out[c].push(l.at(t, c));
  return out;
}

/** The per-site words at the stored steps (R6.5): `[site][stored step index]`. */
export function toSiteLog(l: GDiffLog, nSites: number, steps: readonly number[]): SiteLog {
  const col = (pick: (r: ReturnType<GDiffLog["site"]>) => number) => Array.from({ length: nSites }, (_, j) => steps.map((t) => pick(l.site(t, j))));
  return { steps: [...steps], n_blk: col((r) => r.net), n_occ: col((r) => r.occ), reach_blk: col((r) => r.reachNet), reach_occ: col((r) => r.reachOcc) };
}

/** Blocks with at least one living voxel (B + P > 0): liveblk_R at T. */
export function liveBlocksOf(cells: Uint32Array, g: Geom): number {
  const n = g.W * g.H * g.D, bw = g.W >> 3;
  const live = new Uint8Array((g.W >> 3) * (g.H >> 3));
  for (let v = 0; v < n; v++) if (cells[CH.B * n + v] + cells[CH.P * n + v] > 0) live[((Math.floor(v / g.W) % g.H) >> 3) * bw + ((v % g.W) >> 3)] = 1;
  let c = 0;
  for (const x of live) c += x;
  return c;
}

const liveFlags = (cells: Uint32Array, n: number): Uint8Array => {
  const f = new Uint8Array(n);
  for (let v = 0; v < n; v++) f[v] = cells[CH.B * n + v] + cells[CH.P * n + v] > 0 ? 1 : 0;
  return f;
};

const sumChan = (cells: Uint32Array, n: number, ch: number): number => {
  let s = 0;
  for (let v = ch * n; v < (ch + 1) * n; v++) s += cells[v];
  return s;
};

/** M1's kick set and M0's kick plan are written independently; a job refuses to run if they disagree (the cross-check M1 asked M2 to make). */
function sameKick(plan: KickPlan, set: KickSet, what: string): void {
  const eq = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((x, i) => x === b[i]);
  if (!(plan.total === set.total && eq(plan.voxels, set.voxels) && eq(plan.amounts, set.amounts) && eq(plan.blocks, set.blocks) && eq(plan.blockSums, set.blockSums)))
    throw new Error(`the ${what} kick differs between regime3.ts (KickPlan) and regime.ts (KickSet): voxels ${plan.voxels.length}/${set.voxels.length}, total ${plan.total}/${set.total}, blocks ${plan.blocks.length}/${set.blocks.length}`);
}

const EMPTY_PLAN: KickPlan = { voxels: new Uint32Array(0), amounts: new Uint32Array(0), total: 0, blocks: new Uint32Array(0), blockSums: new Uint32Array(0) };

const medianOf = (xs: ArrayLike<number>): number => {
  const s = Array.from(xs).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// A job's context at T: the frozen reference, the scale, the sites and the colonies (R3, R4)

export interface JobCtx {
  spec: JobSpec;
  world: World;
  cfg: WorldConfig;
  g: Geom;
  bg: BlockGrid;
  n: number;
  T: number;
  frozen: FrozenRef;
  B: Uint32Array;
  P: Uint32Array;
  scale: ReturnType<typeof scaleOf>;
  h0: number;
  liveblkT: number;
  liveT: number;
  sites: number[];
  col: ReturnType<typeof siteColonies>;
  colonyCount: number;
  colonySizes: number[];
  /** The first min(64, N_E) voxels of E sorted by the dose key (R4.5): dose m kicks the first m of them. */
  keyed: number[];
}

/** R4.1 to R4.5 from R's cells at T. Needs a METERED job (B* defined, N_E at least NE_MIN). */
export function buildCtx(spec: JobSpec, world: World, frozen: FrozenRef): JobCtx {
  const cfg = world.cfg;
  const g = geomOf(cfg);
  const n = g.W * g.H * g.D;
  const B = frozen.cells.subarray(CH.B * n, (CH.B + 1) * n);
  const P = frozen.cells.subarray(CH.P * n, (CH.P + 1) * n);
  const scale = scaleOf(B);
  const h0 = selectionSeed(cfg.seed, frozen.step);
  const sites = placeSites(scale.E, g, h0);
  const labels = colonyLabels(livingColumns(B, P, g), g);
  const col = siteColonies(sites, labels.labels, g);
  let liveT = 0;
  for (let v = 0; v < n; v++) if (B[v] + P[v] > 0) liveT++;
  return {
    spec, world, cfg, g, bg: blockGrid(cfg), n, T: frozen.step, frozen, B, P, scale, h0,
    liveblkT: liveBlocksOf(frozen.cells, g), liveT, sites, col,
    colonyCount: labels.count, colonySizes: [...labels.sizes].sort((a, b) => b - a).slice(0, 20),
    keyed: keyedPrefix(scale.E, h0, Math.min(64, scale.NE)),
  };
}

/** The kicks of one rung (R4.6, R4.8, R4.9) as both modules compute them, cross-checked, with the thresholds in force. */
export interface Kicks {
  rung: Rung;
  /** The kick size: k under P1, the median k_v of the S kick under P2. */
  k: number;
  thetaB: number;
  thetaV: number;
  planS: KickPlan;
  setS: KickSet;
  planU: KickPlan;
  setU: KickSet;
  n0Site: number[];
  fewSites: boolean;
  doses: { m: number; n0: number; run: boolean; plan: KickPlan; set: KickSet | null }[];
  fewDoses: boolean;
}

export function makeKicks(ctx: JobCtx, rung: Rung): Kicks {
  const { g, bg, B, sites } = ctx;
  const k = ctx.scale.k!;
  const plan = (centres: readonly number[]): KickPlan => (rung === "P1" ? kickPlanP1(B, centres, k, g) : kickPlanP2(B, centres, g));
  const kset = (centres: readonly number[]): KickSet => (rung === "P1" ? kickSites(bg, B, centres, k) : kickBalls(bg, B, centres));
  const planS = plan(sites);
  const setS = kset(sites);
  sameKick(planS, setS, "S");
  const planU = unitKickPlan(planS, g);
  const setU = unitKick(bg, setS);
  sameKick(planU, setU, "U");
  const th = rung === "P1" ? { thetaB: ctx.scale.thetaB!, thetaV: ctx.scale.thetaV! } : thresholdsP2(planS);
  const plans = new Map<number, KickPlan>();
  const table = doseTable(ctx.scale.NE, ctx.liveblkT, (m) => {
    const p = plan(ctx.keyed.slice(0, m));
    plans.set(m, p);
    return p.blocks.length;
  });
  const few = table.origin.length < 2;
  const doses = table.doses.map((d) => {
    const run = d.run && !few;
    const set = run ? kset(ctx.keyed.slice(0, d.m)) : null;
    if (set) sameKick(plans.get(d.m)!, set, `D${d.m}`);
    return { m: d.m, n0: d.n0, run, plan: plans.get(d.m)!, set };
  });
  return {
    rung, k: rung === "P1" ? k : medianOf(planS.amounts), thetaB: th.thetaB, thetaV: th.thetaV, planS, setS, planU, setU,
    n0Site: sites.map((s) => plan([s]).blocks.length), fewSites: sites.length < REGIME.M_S_MIN, doses, fewDoses: few,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The twin phase of one rung (R2.6)

export interface DivRow {
  t: number;
  Jid: number | null;
  Jg: number | null;
  ngdiff: number | null;
  dLiving: number;
  dSumB: number;
  liveS: number;
  liveR: number;
  sumBS: number;
  sumBR: number;
  /** Relative L1 of the column-summed B field at 1, 2, 4, 8, 16 and 32 columns (R6.10). */
  scale: number[];
}

export interface CaptureOut {
  thetaV: number;
  sites: number[];
  /** Damaged voxels (|dB| >= thetaV) of the S twin against R at each captured step: how many there are, and at most 4,000 of them kept by an even stride. */
  snapshots: { t: number; total: number; points: number[][] }[];
}

export interface PhaseOptions {
  fPair: boolean;
  /** Compute the spatial entropy (R6.9: R's B at T and T + 100); the job does it once, in its first phase. */
  entropy: boolean;
  capture: boolean;
  log: (s: string) => void;
}

export interface PhaseOut {
  rung: Rung;
  bank: TwinBank;
  /** C1, C3, C5, C7, C8 of this phase; C2 is built by the caller from `c2` plus R at T. */
  checks: Partial<Record<CheckName, CheckResult>>;
  c2: C2In[];
  /** R's living count at every step of the phase (the diff log's live_R of S, or of Z run to 1,000 steps if there is no S) and at its end. */
  liveR: number[];
  livingEnd: number;
  hashes: { Z100: string; R100: string; R1000: string; S1000: string | null };
  /** J_id, J_g, n_gdiff, census and scale curve of S against R, keyed by the step ("100", "300", "1000"): the reader's `divergence`. */
  divergence: Record<string, Omit<DivRow, "t">>;
  /** The scale curve at step 1,000 (R6.10): the reader's `scaleCurve`. */
  scaleCurve: number[] | null;
  entropy: ReturnType<typeof spatialEntropy> | null;
  capture: CaptureOut | null;
  doseS: number;
  doseU: number | null;
  timings: { fSeconds: number; buildSeconds: number; lockstepSeconds: number; pauseSeconds: number; readSeconds: number; totalSeconds: number; simSteps: number };
}

export interface C2In {
  name: string;
  matterStart: string;
  matterEnd: string;
  residual: string;
}

function c2Entry(name: string, st: WorldState, start0: World["start0"]): C2In {
  const t = totalsOf(st.cfg, st.cells);
  // ledgerResidual of accounting.ts, from the totals already computed: (content now + heat exported) - (content at start + light absorbed)
  return { name, matterStart: String(start0.matter), matterEnd: String(t.matter), residual: String(t.energy + st.heatOut - (start0.energy + st.lightIn)) };
}

const rowOf = (l: GDiffLog, t: number): DiffRow => Object.fromEntries(COLUMNS.map((c) => [c, l.at(t, c)])) as DiffRow;

/** An even-stride thinning to at most `max` points, deterministic. */
function thin<T>(xs: readonly T[], max: number): T[] {
  if (xs.length <= max) return [...xs];
  return Array.from({ length: max }, (_, j) => xs[Math.floor((j * xs.length) / max)]);
}

function damagedVoxels(g: Geom, bR: ArrayLike<number>, bS: ArrayLike<number>, thetaV: number): { t: number; total: number; points: number[][] } & { t: number } {
  const idx: number[] = [];
  const n = g.W * g.H * g.D;
  for (let v = 0; v < n; v++) if (Math.abs(bS[v] - bR[v]) >= thetaV) idx.push(v);
  const pts = thin(idx, CAPTURE_POINTS).map((v) => [v % g.W, Math.floor(v / g.W) % g.H, Math.floor(v / (g.W * g.H)), bS[v] - bR[v]]);
  return { t: 0, total: idx.length, points: pts };
}

/**
 * The twin phase of one rung from the reference `ref` (idle at T, whose cells ctx.frozen holds): the F pair first, alone (R2.6), then the
 * main bank Z, S, U, N and the doses in lockstep with R for 1,000 steps, paused at steps 30, 100, 300 and 1,000 for the reads the
 * checks and the descriptive columns need. Releases every sim it made. R ends the phase at T + 1,000.
 */
export async function twinPhase(ctx: JobCtx, ref: AnySim, rung: Rung, opt: PhaseOptions): Promise<PhaseOut> {
  const { world, cfg, frozen, g, n, sites } = ctx;
  const refStep = ref as unknown as StepSim;
  const kx = makeKicks(ctx, rung);
  const mS = sites.length;
  const fewSites = kx.fewSites;
  const stored = storedSteps();
  const gc = genomeChannels(cfg);
  const owned: AnySim[] = [];
  const diffs: Diff[] = [];
  const own = <X extends AnySim>(s: X): X => (owned.push(s), s);
  const mkDiff = async (against: AnySim, x: AnySim, steps: number, siteList: readonly number[]): Promise<Diff> => {
    const d = await createDiff(against, x, { startStep: frozen.step, maxSteps: steps, thetaB: kx.thetaB, thetaV: kx.thetaV, sites: siteList });
    diffs.push(d);
    return d;
  };
  const c2: C2In[] = [];
  const c8: { name: string; differing: string[]; expected: string[] }[] = [];
  const c5: { name: string; row0: DiffRow; plan: KickPlan }[] = [];
  const noteConfig = (name: string, sim: AnySim, expected: string[]) => c8.push({ name, differing: configDiff(cfg, sim.cfg), expected });
  // C8 also checks the values: N's seed is seedN of R4.10, the F pair has dtQ 0 and no motility.
  const valueFaults: string[] = [];
  const noteValues = (name: string, sim: AnySim, kind: "N" | "F") => {
    if (kind === "N" && sim.cfg.seed !== noiseSeed(cfg.seed)) valueFaults.push(`${name}: seed ${sim.cfg.seed}, not ${noiseSeed(cfg.seed)}`);
    if (kind === "F" && (sim.cfg.dtQ !== 0 || sim.cfg.motility !== false)) valueFaults.push(`${name}: dtQ ${sim.cfg.dtQ}, motility ${sim.cfg.motility}`);
  };
  const tStart = performance.now();
  let fSeconds = 0;
  noteConfig("R", ref, []);
  try {
    // ---- the F pair (R2.6): two copies of R under dtQ 0 and no motility, X_F carrying the S kick, 1,000 steps, before the main bank
    let F: { log: MDiffLog; sites: SiteLog } | undefined;
    if (opt.fPair && !fewSites) {
      const tF = performance.now();
      const RF = own(await createControlSim(ref, world.state0, "F"));
      const XF = own(await createControlSim(ref, world.state0, "F"));
      applyKick(XF, frozen, kx.setS);
      const dF = await mkDiff(RF, XF, 1000, sites);
      await runLockstep(RF as unknown as StepSim, [{ sim: XF as unknown as StepSim, diff: dF, steps: 1000 }], 1000, { initial: true, stepsPerSubmit: STEPS_PER_SUBMIT });
      const lF = await dF.read();
      c5.push({ name: "XF", row0: rowOf(lF, 0), plan: kx.planS });
      F = { log: toDiffLog(lF), sites: toSiteLog(lF, mS, stored) };
      c2.push(c2Entry("RF", await RF.readState(), world.start0), c2Entry("XF", await XF.readState(), world.start0));
      noteConfig("RF", RF, ["dtQ", "motility"]);
      noteConfig("XF", XF, ["dtQ", "motility"]);
      noteValues("RF", RF, "F");
      noteValues("XF", XF, "F");
      dF.destroy();
      RF.destroy();
      XF.destroy();
      fSeconds = (performance.now() - tF) / 1000;
    }

    // ---- the main bank: Z, S, U, N and the doses that pass the cap, each a fork of R (R4.7); N under another seed (R4.10)
    const tB = performance.now();
    const members: LockMember[] = [];
    const diffMap = new Map<string, Diff>();
    const simOf = new Map<string, AnySim>();
    const planOf = new Map<string, KickPlan>();
    const add = async (name: string, sim: AnySim, steps: number, siteList: readonly number[], plan: KickPlan, expected: string[]) => {
      const d = await mkDiff(ref, sim, steps, siteList);
      diffMap.set(name, d);
      simOf.set(name, sim);
      planOf.set(name, plan);
      members.push({ sim: sim as unknown as StepSim, diff: d, steps });
      noteConfig(name, sim, expected);
    };
    const Z = own(await createTwin(ref, world.state0)) as AnySim;
    await add("Z", Z, fewSites ? REGIME.TRAJ_STEPS : 100, [], EMPTY_PLAN, []);
    let S: AnySim | null = null, U: AnySim | null = null;
    let c3: CheckResult = { ok: true, applicable: false };
    if (!fewSites) {
      S = own(await createTwin(ref, world.state0)) as AnySim;
      applyKick(S, frozen, kx.setS);
      c3 = checkC3(validateState(await S.readState()));
      await add("S", S, REGIME.TRAJ_STEPS, sites, kx.planS, []);
      U = own(await createTwin(ref, world.state0)) as AnySim;
      applyKick(U, frozen, kx.setU);
      await add("U", U, REGIME.DOSE_STEPS, [], kx.planU, []);
    }
    const N = own(await createControlSim(ref, world.state0, "N")) as AnySim;
    await add("N", N, REGIME.DOSE_STEPS, [], EMPTY_PLAN, ["seed"]);
    noteValues("N", N, "N");
    for (const d of kx.doses) {
      if (!d.run) continue;
      const D = own(await createTwin(ref, world.state0)) as AnySim;
      applyKick(D, frozen, d.set!);
      await add(`D${d.m}`, D, REGIME.DOSE_STEPS, [], d.plan, []);
    }
    const buildSeconds = (performance.now() - tB) / 1000;

    // ---- lockstep with pauses
    const divergence: DivRow[] = [];
    const snaps: CaptureOut["snapshots"] = [];
    let entropy: PhaseOut["entropy"] = null;
    let medianBlock30: number | null = null;
    let hashZ100 = "", hashR100 = "";
    let done = 0;
    const advance = async (to: number) => {
      if (to === done) return;
      await runLockstep(refStep, members, to - done, { done, initial: done === 0, stepsPerSubmit: STEPS_PER_SUBMIT });
      done = to;
    };
    const divAt = (t: number, rs: WorldState, ss: WorldState): DivRow => {
      const view = (st: WorldState) => ({ live: liveFlags(st.cells, n), idHi: st.genome.subarray(G.LIN_HI * n, (G.LIN_HI + 1) * n), idLo: st.genome.subarray(G.LIN_LO * n, (G.LIN_LO + 1) * n), fp: genomeFingerprints(st.genome, n, gc) });
      const lin = lineageDivergence(view(ss), view(rs));
      const liveS = liveFlags(ss.cells, n).reduce((a, b) => a + b, 0), liveRn = liveFlags(rs.cells, n).reduce((a, b) => a + b, 0);
      const sumBS = sumChan(ss.cells, n, CH.B), sumBR = sumChan(rs.cells, n, CH.B);
      const cen = censusDivergence({ liveS, liveR: liveRn, sumBS, sumBR });
      return { t, Jid: lin.Jid, Jg: lin.Jg, ngdiff: lin.ngdiff, ...cen, liveS, liveR: liveRn, sumBS, sumBR, scale: scaleCurve(rs.cells.subarray(CH.B * n, (CH.B + 1) * n), ss.cells.subarray(CH.B * n, (CH.B + 1) * n), g) };
    };
    const pauses = [...new Set([...(opt.capture ? [10] : []), 30, 100, 300, 1000])].sort((a, b) => a - b);
    let hashS1000: string | null = null, hashR1000 = "";
    let refState1000: WorldState | null = null, sState1000: WorldState | null = null;
    const tL = performance.now();
    let advSeconds = 0;
    for (const t of pauses) {
      const tA = performance.now();
      await advance(t);
      advSeconds += (performance.now() - tA) / 1000;
      if (t === 10 && S) {
        const [bR] = await readChannels(ref, [CH.B]);
        const [bS] = await readChannels(S, [CH.B]);
        snaps.push({ ...damagedVoxels(g, bR, bS, kx.thetaV), t });
      }
      if (t === 30 && U) {
        const [bR] = await readChannels(ref, [CH.B]);
        const [bU] = await readChannels(U, [CH.B]);
        medianBlock30 = medianNonzeroAbs(blockNetDiff(bR, bU, g));
      }
      if (t === 100) {
        const rs = await ref.readState();
        hashR100 = stateHash(rs);
        hashZ100 = stateHash(await Z.readState());
        if (opt.entropy) entropy = spatialEntropy(ctx.B, rs.cells.subarray(CH.B * n, (CH.B + 1) * n), g, ctx.h0);
        if (S) {
          const ss = await S.readState();
          divergence.push(divAt(100, rs, ss));
          if (opt.capture) snaps.push({ ...damagedVoxels(g, rs.cells.subarray(CH.B * n, (CH.B + 1) * n), ss.cells.subarray(CH.B * n, (CH.B + 1) * n), kx.thetaV), t: 100 });
        }
      }
      if ((t === 300 || t === 1000) && S) {
        const rs = await ref.readState();
        const ss = await S.readState();
        divergence.push(divAt(t, rs, ss));
        if (t === 1000) {
          if (opt.capture) snaps.push({ ...damagedVoxels(g, rs.cells.subarray(CH.B * n, (CH.B + 1) * n), ss.cells.subarray(CH.B * n, (CH.B + 1) * n), kx.thetaV), t: 1000 });
          refState1000 = rs;
          sState1000 = ss;
        }
      }
      if (t === 1000 && !S) refState1000 = await ref.readState();
    }
    const pauseSeconds = (performance.now() - tL) / 1000 - advSeconds;
    const lockstepSeconds = advSeconds;

    // ---- the logs, the exact ledgers and the checks
    const tR = performance.now();
    const logs = new Map<string, GDiffLog>();
    for (const [name, d] of diffMap) logs.set(name, await d.read());
    const livingEnd = (await (ref as unknown as RefSimLike).readStats()).living;
    c2.push(c2Entry("R", refState1000!, world.start0));
    hashR1000 = stateHash(refState1000!);
    if (sState1000) {
      c2.push(c2Entry("S", sState1000, world.start0));
      hashS1000 = stateHash(sState1000);
    }
    refState1000 = null;
    sState1000 = null;
    // S was read at step 1,000 above; Z, U, N and the doses end at their own lengths and are read now.
    for (const [name, sim] of simOf) if (name !== "S") c2.push(c2Entry(name, await sim.readState(), world.start0));
    for (const [name, l] of logs) c5.push({ name, row0: rowOf(l, 0), plan: planOf.get(name) ?? EMPTY_PLAN });

    const zLog = toDiffLog(logs.get("Z")!);
    const longest = logs.get(fewSites ? "Z" : "S")!;
    const liveR = Array.from({ length: longest.rows }, (_, t) => longest.at(t, "live_R"));
    if (longest.at(0, "liveblk_R") !== ctx.liveblkT || longest.at(0, "live_R") !== ctx.liveT)
      throw new Error(`KERNEL FAULT: the diff pass at step 0 counts ${longest.at(0, "liveblk_R")} living blocks and ${longest.at(0, "live_R")} living voxels, the CPU ${ctx.liveblkT} and ${ctx.liveT}`);
    const checks: PhaseOut["checks"] = {
      C1: checkC1({ counters: zLog as unknown as Partial<Record<DiffColumn, ArrayLike<number>>>, hashZ: hashZ100, hashR: hashR100 }),
      C3: c3,
      C5: (() => {
        const bad = c5.map((x) => ({ name: x.name, r: checkC5({ row0: x.row0, plan: x.plan, thetaB: kx.thetaB, rung }) })).filter((x) => !x.r.ok);
        return bad.length ? { ok: false, detail: bad.map((x) => `${x.name}: ${x.r.detail}`).join("; ") } : { ok: true };
      })(),
      C7: checkC7(liveR[liveR.length - 1], livingEnd),
      C8: (() => {
        const bad = c8.map((x) => ({ name: x.name, r: checkC8(x.differing, x.expected) })).filter((x) => !x.r.ok);
        return bad.length || valueFaults.length ? { ok: false, detail: [...bad.map((x) => `${x.name}: ${x.r.detail}`), ...valueFaults].join("; ") } : { ok: true };
      })(),
    };
    if (S) {
      const ls = logs.get("S")!;
      const toSites = toSiteLog(ls, mS, stored);
      if (!siteSumsMatchGlobal(toDiffLog(ls), toSites, "net") || !siteSumsMatchGlobal(toDiffLog(ls), toSites, "occ"))
        throw new Error("KERNEL FAULT: the per-site damaged-block counts do not add up to the global count (R6.2): the diff pass loses or double-counts a block");
    }

    // ---- the bank (the contract of regime3.ts)
    const mk = (name: string) => toDiffLog(logs.get(name)!);
    const bank: TwinBank = {
      rung, k: kx.k, thetaB: kx.thetaB, thetaV: kx.thetaV, sites: [...sites], nCol: ctx.col.nCol, colonies: ctx.col.colonies,
      n0: kx.planS.blocks.length, n0Site: kx.n0Site, doseS: kx.planS.total,
      doses: kx.doses.filter((d) => d.run).map((d) => ({ m: d.m, n0: d.n0, log: mk(`D${d.m}`) })),
      skipped: kx.doses.filter((d) => !d.run).map((d) => ({ m: d.m, n0: d.n0 })),
      ...(S ? { S: { log: mk("S"), sites: toSiteLog(logs.get("S")!, mS, stored) } } : {}),
      ...(U ? { U: { log: mk("U"), doseU: kx.planU.total, medianBlock30 } } : {}),
      N: { log: mk("N") },
      ...(F ? { F } : {}),
    };
    const readSeconds = (performance.now() - tR) / 1000;
    return {
      rung, bank, checks, c2, liveR, livingEnd, hashes: { Z100: hashZ100, R100: hashR100, R1000: hashR1000, S1000: hashS1000 },
      divergence: Object.fromEntries(divergence.map(({ t, ...rest }) => [String(t), rest])), scaleCurve: divergence.find((d) => d.t === 1000)?.scale ?? null, entropy,
      capture: opt.capture && S ? { thetaV: kx.thetaV, sites: [...sites], snapshots: snaps } : null,
      doseS: kx.planS.total, doseU: U ? kx.planU.total : null,
      timings: { fSeconds, buildSeconds, lockstepSeconds, pauseSeconds, readSeconds, totalSeconds: (performance.now() - tStart) / 1000, simSteps: (F ? 2 * REGIME.TRAJ_STEPS : 0) + REGIME.TRAJ_STEPS + members.reduce((a, m) => a + m.steps, 0) },
    };
  } finally {
    for (const d of diffs) d.destroy();
    for (const s of owned) s.destroy();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The constant screen of R9.0 (descriptive; it decides nothing)

/** Keys, their config ranges (validateConfig) and the screen's two values: half the base and twice it, or the range bound (R9.0). */
const SCREEN_KEYS: { key: keyof WorldConfig; lo: number; hi: number }[] = [
  { key: "dtQ", lo: 0, hi: 1024 },
  { key: "spread", lo: 0, hi: 32 },
  { key: "thetaMass", lo: 1, hi: 2048 },
  { key: "massUnit", lo: 16, hi: 4096 },
  { key: "diffA", lo: 0, hi: 256 },
  { key: "diffC", lo: 0, hi: 256 },
  { key: "diffS", lo: 0, hi: 256 },
  { key: "gateK", lo: 1, hi: 65535 },
  { key: "mutRate", lo: 0, hi: 0xffffffff },
];

/** One configuration of the screen: window means (R0 W1) of the S kick against its unkicked twin under that configuration. */
export interface ScreenRow {
  key: string;
  /** 0.5 (half the base value), 2 (twice, or the range bound) or 1 (the base configuration itself). */
  factor: number;
  value: number;
  /** n_dec,S(TAU_DEC) of the screen's decider (the reader's column), and both deciders' block counts at TAU_DEC; n_1 at step 100. */
  nDecS30: number;
  nBlk30: number;
  nOcc30: number;
  n1_100: number;
}

export interface ScreenOut {
  rung: Rung;
  decider: Decider;
  thetaB: number;
  thetaV: number;
  base: { nDecS30: number; n1_100: number; nBlk30: number; nOcc30: number };
  rows: ScreenRow[];
  /** Configurations that validateConfig refuses (none expected). */
  skipped: { key: string; factor: number; value: number; error: string }[];
  seconds: number;
}

/**
 * R9.0 constant screen on the state at T: for each constant at half and at twice its base value (or its range bound), two forks of R under
 * the changed configuration, one with the S kick of `rung` and one without, 300 steps; the kicked fork is compared with the other. About
 * 70 s on the slab at 256 x 256 x 8. R must be idle at T. Every configuration keeps the base job's thresholds.
 */
export async function constantScreen(ctx: JobCtx, ref: AnySim, rung: Rung, decider: Decider, log: (s: string) => void): Promise<ScreenOut> {
  const t0 = performance.now();
  const kx = makeKicks(ctx, rung);
  const configs: { key: string; factor: number; cfg: WorldConfig; value: number }[] = [{ key: "base", factor: 1, cfg: ctx.cfg, value: 0 }];
  for (const { key, lo, hi } of SCREEN_KEYS) {
    const base = ctx.cfg[key] as number;
    const half = Math.max(lo, Math.ceil(base / 2)); // ceil: 26 for dtQ, as group D's setting ids have it
    const twice = Math.min(hi, 2 * base);
    configs.push({ key, factor: 0.5, value: half, cfg: { ...ctx.cfg, [key]: half } });
    configs.push({ key, factor: 2, value: twice, cfg: { ...ctx.cfg, [key]: twice } });
  }
  const rows: ScreenRow[] = [];
  const skipped: ScreenOut["skipped"] = [];
  for (const c of configs) {
    const errs = validateConfig(c.cfg);
    if (errs.length) {
      skipped.push({ key: c.key, factor: c.factor, value: c.value, error: errs.join("; ") });
      continue;
    }
    const X = (await createTwin(ref, ctx.world.state0, c.cfg)) as AnySim;
    const Y = (await createTwin(ref, ctx.world.state0, c.cfg)) as AnySim;
    try {
      applyKick(X, ctx.frozen, kx.setS);
      const d = await createDiff(Y, X, { startStep: ctx.frozen.step, maxSteps: REGIME.DOSE_STEPS, thetaB: kx.thetaB, thetaV: kx.thetaV, sites: ctx.sites });
      await runLockstep(Y as unknown as StepSim, [{ sim: X as unknown as StepSim, diff: d, steps: REGIME.DOSE_STEPS }], REGIME.DOSE_STEPS, { initial: true, stepsPerSubmit: STEPS_PER_SUBMIT });
      const l = toDiffLog(await d.read());
      d.destroy();
      const nBlk30 = windowMean(l.n_blk, REGIME.TAU_DEC, REGIME.DOSE_STEPS) ?? 0;
      const nOcc30 = windowMean(l.n_occ, REGIME.TAU_DEC, REGIME.DOSE_STEPS) ?? 0;
      rows.push({ key: c.key, factor: c.factor, value: c.value, nDecS30: decider === "net" ? nBlk30 : nOcc30, nBlk30, nOcc30, n1_100: windowMean(l.n_1, 100, REGIME.DOSE_STEPS) ?? 0 });
    } finally {
      X.destroy();
      Y.destroy();
    }
  }
  const base = rows.shift()!;
  const seconds = (performance.now() - t0) / 1000;
  log(`  constant screen (${rung}, ${decider}): ${rows.length + 1} configurations in ${seconds.toFixed(1)} s`);
  return { rung, decider, thetaB: kx.thetaB, thetaV: kx.thetaV, base: { nDecS30: base.nDecS30, n1_100: base.n1_100, nBlk30: base.nBlk30, nOcc30: base.nOcc30 }, rows, skipped, seconds };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Running one job

export interface Env {
  o: Options;
  st: Stamps;
  sel: Selection | null;
  gate: Preflight["gate"];
  out: string;
  /** Where --capture writes `<id>.json` (the reader's default: runs/regime/captures, beside runs/regime/jobs). */
  captures: string;
  m4dir: string;
  tsv: string;
  log: (s: string) => void;
}

const jobPath = (env: Env, id: string) => `${env.out}/${id}.json`;
const capturePath = (env: Env, id: string) => `${env.captures}/${id}.json`;
/** The reader looks for runs/regime/dev/constant-screen.json (and never takes it for a job). */
const screenPath = (env: Env) => `${env.out}/constant-screen.json`;

/** The rungs of a job that still need running (a file is missing), and whether its screen does. */
export function pending(env: Env, spec: JobSpec): { rungs: Rung[]; screen: boolean } {
  const rungs = spec.rungs.filter((_, i) => !existsPath(env.o.capture ? capturePath(env, spec.ids[i]) : jobPath(env, spec.ids[i])));
  const screen = !env.o.capture && spec.screen && !existsPath(screenPath(env));
  return { rungs, screen };
}

const flagsOf = (flag: string | null): string[] => (flag && flag !== "IN_WINDOW" ? [flag] : []);

/** One line per reading of a written job: the rule's own reading, so a bad run shows at once. */
function readingLine(text: string): string {
  const s = summarizeJob(JSON.parse(text) as RegimeJob);
  const parts = Object.entries(s.readings).map(([k, r]) => `${k} T:${r.tClass}${r.tFrozen ? "(frozen)" : ""} D:${r.dClass ?? "NA"} dust:${r.dust}${r.ratioU === null ? "" : `(${r.ratioU.toFixed(2)})`} class:${r.jobClass ?? "none"}${r.vote ? " VOTE" : ""} s30:${r.s30 === null ? "NA" : r.s30.toFixed(2)}`);
  return `${s.extinct ? "EXTINCT" : s.noTarget ? "NO_TARGET" : `f=${s.f.toFixed(3)}${flagsOf(s.flag).length ? " " + s.flag : ""}`}${s.diedInPhase ? " DIED_IN_PHASE" : ""}${s.drift ? " DRIFT" : ""}${s.invalid ? ` INVALID(${s.invalidChecks.join(",")})` : ""} ${parts.join(" | ")}`;
}

export interface JobResult {
  wrote: string[];
  invalid: string[];
  seconds: number;
}

/** Runs one job: burn-in to T, the scale, the constant screen (Stage 0), then one twin phase per pending rung, one JSON file per rung. */
export async function runJob(spec: JobSpec, env: Env): Promise<JobResult> {
  const t0 = performance.now();
  const upStart = await uptime();
  const pend = pending(env, spec);
  const world = buildWorld(spec);
  const cfg = world.cfg;
  const device = await deviceFor(cfg);
  const cells = cellCount(cfg);
  const log = env.log;
  const wrote: string[] = [];
  const invalid: string[] = [];
  Deno.mkdirSync(env.out, { recursive: true });
  const R = (await createSim(device, world.state0)) as AnySim;
  const owned: AnySim[] = [R];
  try {
    const burn = await burnIn(R, spec.T);
    const living = burn.living;
    const f = living / cells;
    const m4 = spec.kind === "slab" && spec.settingId ? await m4Entry(spec.settingId, spec.seed, env.m4dir, env.tsv) : null;
    const c4 = c4Of(spec, { living5k: burn.living5k, extinctAt: burn.extinctAt, cells }, m4);
    log(`  burn-in ${spec.T} steps: ${burn.seconds.toFixed(1)} s (${((burn.extinctAt ?? spec.T) / burn.seconds).toFixed(0)} steps/s), living ${living} (${(100 * f).toFixed(2)}%)${burn.extinctAt ? ` EXTINCT@${burn.extinctAt}` : ""}, C4 ${c4.mode === "none" ? "n/a" : `${c4.mode} ${c4.check.ok ? "ok" : "FAILED " + c4.check.detail}`}`);

    // R at T (or where it went extinct): hashes, then the frozen copy that the kicks are defined against (R4.7)
    const stT = await R.readState();
    const stateHashT = stateHash(stT);
    const stateDigestT = world.cfgB0 ? stateHash({ ...stT, cfg: world.cfgB0 }) : null;
    const c2R = c2Entry("R at T", stT, world.start0);
    const frozen = burn.extinctAt === null ? await freezeRef(R as unknown as RefSimLike) : null;
    const g = geomOf(cfg);
    const nVox = g.W * g.H * g.D;
    const scale = frozen ? scaleOf(frozen.cells.subarray(CH.B * nVox, (CH.B + 1) * nVox)) : null;
    const start = startState({ extinct: burn.extinctAt !== null, Bstar: scale?.Bstar ?? null, NE: scale?.NE ?? 0, f });
    const c6: CheckResult = spec.dev
      ? { ok: true, applicable: false, detail: "dev job: not stamped against a frozen rule" }
      : checkC6({ ruleSha: env.st.ruleSha ?? undefined, ruleShaRecorded: env.st.ruleSha ?? "", codeCommit: env.st.codeCommit, srcHash: env.st.srcHash, treeClean: env.st.treeClean });
    const common: Record<string, unknown> = {
      schema: SCHEMA, role: spec.role, kind: spec.kind, world: spec.world, settingId: spec.settingId, preset: spec.preset, stage: env.o.stage, dev: spec.dev,
      rehearsal: env.o.dev,
      setting: spec.setting ? { id: spec.setting.id, group: spec.setting.group, params: spec.setting.params, overrides: spec.setting.overrides, control: spec.setting.control } : null,
      seed: spec.seed, T: spec.T, grid: g, cells, selected: env.o.stage === "dev" ? null : env.sel, screenRung: spec.screen ? (env.o.rung ?? "P1") : undefined, decider: spec.decider,
      status: burn.extinctAt !== null ? "EXTINCT" : start.status, window: start.flag, extinctAt: burn.extinctAt, living, f,
      livingTrace: burn.trace, livingTraceSteps: burn.traceSteps, living5k: burn.living5k,
      m4Source: c4.source ?? { path: "", sha256: "", mode: "none" }, m4Mode: c4.mode,
      stepsPerSec: +((burn.extinctAt ?? spec.T) / burn.seconds).toFixed(1),
      stateHashT, stateDigestT, stateStep: stT.step,
      ruleSha: env.st.ruleSha ?? undefined, ruleSource: env.st.ruleSource, codeCommit: env.st.codeCommit, head: env.st.head,
      srcHash: env.st.srcHash, srcMissing: env.st.srcMissing.length ? env.st.srcMissing : undefined, treeClean: env.st.treeClean, gateSha: env.gate?.sha256,
      device: adapterDescription, host: Deno.hostname(), uptimeStart: upStart,
    };
    const finish = async (rung: Rung, i: number, extra: Record<string, unknown>, checks: Partial<Record<CheckName, CheckResult>>, timings: Record<string, unknown>) => {
      const id = spec.ids[i];
      const text = jobText({ ...common, ...extra, id, rung, checks, seconds: +((performance.now() - t0) / 1000).toFixed(1), timings: { ...timings, burnSeconds: burn.seconds }, uptimeEnd: await uptime() });
      writeAtomic(jobPath(env, id), text);
      wrote.push(jobPath(env, id));
      let line = "";
      try {
        line = readingLine(text);
      } catch (e) {
        line = `reading failed: ${(e as Error).message}`;
      }
      const bad = Object.entries(checks).filter(([, c]) => c && c.applicable !== false && !c.ok).map(([k, c]) => `${k}${c!.detail ? ` (${c!.detail})` : ""}`);
      if (bad.length) invalid.push(`${id}: ${bad.join("; ")}`);
      log(`${id}: ${(text.length / 1024).toFixed(0)} KB${text.length > 1_000_000 ? " OVER 1 MB" : ""}; ${line}${bad.length ? `\n  INVALID: ${bad.join("; ")}` : ""}`);
    };

    if (burn.extinctAt !== null || start.status !== "METERED" || !frozen) {
      // EXTINCT or NO_TARGET: no twins and no class (R3); every pending rung file of a gate or Stage 0 job says so
      if (env.o.capture) log("  nothing to capture: no twin phase for this job");
      else
        for (const rung of pend.rungs) {
          const i = spec.rungs.indexOf(rung);
          await finish(rung, i, { Bstar: scale?.Bstar ?? null, k: scale?.k ?? null, NE: scale?.NE ?? 0, liveblkT: 0, liveT: living, h0: 0, liveR: [], livingEnd: living }, { C2: checkC2([c2R]), C4: c4.check, C6: c6 }, { totalSeconds: (performance.now() - t0) / 1000 });
        }
      return { wrote, invalid, seconds: (performance.now() - t0) / 1000 };
    }

    const ctx = buildCtx(spec, world, frozen);
    if (ctx.liveT !== living) throw new Error(`the living count of readStats (${living}) differs from B + P > 0 over the cells (${ctx.liveT}) at T`);
    log(`  B* ${scale!.Bstar}, k ${scale!.k}, thetaB ${scale!.thetaB}, thetaV ${scale!.thetaV}, N_E ${scale!.NE}, ${ctx.sites.length} sites in ${ctx.col.nCol} colonies (${ctx.colonyCount} in all), living blocks ${ctx.liveblkT}`);

    if (pend.screen) {
      const scr = await constantScreen(ctx, R, env.o.rung ?? "P1", env.o.decider ?? "net", log);
      const p = screenPath(env);
      writeAtomic(p, jobText({
        schema: "regime-screen-1", seed: spec.seed, setting: spec.world, T: spec.T, ...scr, stateHashT, ruleSha: env.st.ruleSha ?? undefined, ruleSource: env.st.ruleSource,
        codeCommit: env.st.codeCommit, srcHash: env.st.srcHash, treeClean: env.st.treeClean, device: adapterDescription, host: Deno.hostname(),
      }));
      wrote.push(p);
    }

    // one twin phase per pending rung; with two, the second runs from a frozen copy of R (so both rungs see the same state at T)
    let Rf: AnySim | null = null;
    if (pend.rungs.length > 1) {
      Rf = (await createTwin(R, world.state0)) as AnySim;
      owned.push(Rf);
    }
    let entropy: PhaseOut["entropy"] = null;
    for (let p = 0; p < pend.rungs.length; p++) {
      const rung = pend.rungs[p];
      const i = spec.rungs.indexOf(rung);
      const ref = p === 0 ? R : Rf!;
      const out = await twinPhase(ctx, ref, rung, { fPair: spec.fPair, entropy: p === 0, capture: env.o.capture, log });
      entropy ??= out.entropy;
      const tm = out.timings;
      log(`  ${rung}: phase ${tm.totalSeconds.toFixed(1)} s (F pair ${tm.fSeconds.toFixed(1)}, build ${tm.buildSeconds.toFixed(1)}, lockstep ${tm.lockstepSeconds.toFixed(1)}, pauses ${tm.pauseSeconds.toFixed(1)}, reads ${tm.readSeconds.toFixed(1)}); ${tm.simSteps} sim-steps, ${(tm.simSteps / Math.max(tm.fSeconds + tm.lockstepSeconds, 1e-9)).toFixed(0)} per s of stepping`);
      const extra = {
        liveR: out.liveR, livingEnd: out.livingEnd, liveblkT: ctx.liveblkT, liveT: ctx.liveT, h0: ctx.h0, Bstar: scale!.Bstar, k: scale!.k, thetaB: scale!.thetaB, thetaV: scale!.thetaV, NE: scale!.NE,
        bank: out.bank, hashes: out.hashes, divergence: out.divergence, scaleCurve: out.scaleCurve, entropy, doseS: out.doseS, doseU: out.doseU,
        colonies: { count: ctx.colonyCount, topSizes: ctx.colonySizes, withSites: ctx.col.nCol },
      };
      if (env.o.capture) {
        const jp = jobPath(env, spec.ids[i]);
        const existing = existsPath(jp) ? (JSON.parse(Deno.readTextFileSync(jp)) as { stateHashT?: string; hashes?: { R1000?: string; S1000?: string | null } }) : null;
        if (existing && (existing.stateHashT !== stateHashT || existing.hashes?.R1000 !== out.hashes.R1000 || existing.hashes?.S1000 !== out.hashes.S1000))
          throw new Error(`the capture re-run of ${spec.ids[i]} does not reproduce the stored job (state hashes differ): the run is not deterministic here`);
        Deno.mkdirSync(env.captures, { recursive: true });
        const cp = capturePath(env, spec.ids[i]);
        const cap = out.capture;
        // the reader's Capture: id, W, H, D and steps -> the damaged voxels as a flat [x, y, z, x, y, z, ...]; the rest rides along
        writeAtomic(cp, jobText({
          schema: "regime-capture-1", id: spec.ids[i], W: g.W, H: g.H, D: g.D,
          steps: Object.fromEntries((cap?.snapshots ?? []).map((s) => [String(s.t), s.points.flatMap((q) => [q[0], q[1], q[2]])])),
          damagedVoxels: Object.fromEntries((cap?.snapshots ?? []).map((s) => [String(s.t), s.total])), thetaV: cap?.thetaV, sites: cap?.sites,
          world: spec.world, seed: spec.seed, T: spec.T, rung, stateHashT, reproducesStoredJob: existing ? true : null,
        }));
        wrote.push(cp);
        log(`  captured ${out.capture?.snapshots.map((s) => `t=${s.t}: ${s.points.length} of ${s.total}`).join(", ") ?? "nothing (no S twin)"}${existing ? "; the re-run reproduces the stored job" : ""}`);
        if (existing) continue;
      }
      await finish(rung, i, extra, { ...out.checks, C2: checkC2([c2R, ...out.c2]), C4: c4.check, C6: c6 }, { phase: tm, totalSeconds: (performance.now() - t0) / 1000 });
      if (p === 0 && Rf) {
        R.destroy();
        owned.splice(owned.indexOf(R), 1);
      }
    }
    return { wrote, invalid, seconds: (performance.now() - t0) / 1000 };
  } finally {
    for (const s of owned) s.destroy();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The queue

const USAGE = `regime-sweep.ts: the runner of the regime meters (plan 8.4)
  deno run -A --no-lock experiments/3d-slab/regime-sweep.ts --stage=dev|gate|main|late [flags]
  --out=<dir> --reverse --only=<ids> --shard=i/n --rung=P1|P2 --decider=net|occ --t=<T> --m4=<dir> --capture --dev
  --kind=slab|2d --seeds=<n,...> --grid=WxH --captures=<dir> --gate-json=<file> --rule-sha=<file> --keep-going --list --help
  See the header of this file for what each stage runs, what each flag does and the exit codes.`;

const POS = decodeURIComponent(new URL(import.meta.url).pathname);

/** The 2D jobs run in a process of their own (plan 8.4): a fresh device from the 2D requestDevice. */
async function spawn2d(argv: readonly string[]): Promise<number> {
  const args = ["run", "-A", "--no-lock", `--config=${ROOT}deno.json`, POS, ...argv.filter((a) => !a.startsWith("--kind=")), "--kind=2d"];
  // No cwd override: a relative --out or --m4 must mean the same directory in the child as in the parent.
  const child = new Deno.Command(Deno.execPath(), { args, stdout: "inherit", stderr: "inherit" }).spawn();
  return (await child.status).code;
}

export async function main(argv: readonly string[]): Promise<number> {
  let o: Options;
  try {
    o = parseArgs(argv);
    if (o.help) {
      console.log(USAGE);
      return 0;
    }
    validateOptions(o);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`usage: ${e.message}`);
      return 2;
    }
    throw e;
  }
  const st = await computeStamps(o);
  const pre = await preflight(o, st);
  if (pre.problems.length) {
    console.error(`REFUSED (--stage=${o.stage}):\n${pre.problems.map((p) => `  - ${p}`).join("\n")}`);
    return 2;
  }
  let list: JobSpec[];
  try {
    list = jobList(o, pre.sel);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`usage: ${e.message}`);
      return 2;
    }
    throw e;
  }
  const out = o.out ?? rel(o.dev ? "runs/regime/devjobs" : o.stage === "dev" ? "runs/regime/dev" : "runs/regime/jobs");
  const trimmed = out.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  const captures = o.captures ?? (trimmed.slice(slash + 1) === "jobs" ? `${slash > 0 ? trimmed.slice(0, slash) : "."}/captures` : `${trimmed}/captures`);
  const env: Env = { o, st, sel: pre.sel, gate: pre.gate, out, captures, m4dir: o.m4 ?? rel("runs/m4-calibration"), tsv: rel("experiments/3d-slab/m4-results.tsv"), log: (s) => console.log(s) };
  const queue = selectJobs(list, o);
  if (queue.length === 0) {
    if (o.shard && selectJobs(list, { ...o, shard: null }).length > 0) {
      console.log(`nothing in shard ${o.shard.i}/${o.shard.n} of this queue`);
      return 0;
    }
    console.error(`no job matches (the stage has ${list.length} jobs; --only=${o.only.join(",")} --kind=${o.kind ?? "any"})`);
    return 2;
  }
  if (!o.dev) {
    const missing = m4Missing(queue, env.m4dir);
    if (o.stage === "gate" && missing.length) {
      console.error(`REFUSED: the gate needs M4's exact per-run JSON (mode json), and ${env.m4dir} lacks ${missing.length}: ${missing.join(", ")}. Copy the 180 files from .claude/worktrees/3d-rung1b-slab/runs/m4-calibration/.`);
      return 2;
    }
    if (missing.length) console.log(`  note: ${missing.length} job(s) of this queue have no M4 JSON in ${env.m4dir} and fall back to the rounded TSV (mode tsv-rounded)`);
  }
  if (o.stage === "late" && !o.dev) {
    const settings = new Set(queue.map((j) => j.settingId));
    if (settings.size > REGIME.LATE_MAX) {
      console.error(`REFUSED: --only names ${settings.size} settings; the late check re-burns at most ${REGIME.LATE_MAX} (R1 LATE_MAX, R11)`);
      return 2;
    }
  }
  const todo = queue.filter((j) => {
    const p = pending(env, j);
    return p.rungs.length > 0 || p.screen;
  });
  const sel = pre.sel ? `rung ${pre.sel.rung}, decider ${pre.sel.decider}` : "no combination";
  console.log(
    `regime-sweep: stage ${o.stage}${o.dev ? " (--dev: tagged)" : ""}, ${list.length} jobs in the stage, ${queue.length} in this queue, ${queue.length - todo.length} done, ${todo.length} to run; ${sel}; out ${out}\n` +
      `  rule ${st.ruleSha ? st.ruleSha.slice(0, 12) : "none"} (${st.ruleSource}), codeCommit ${st.codeCommit.slice(0, 12)}, srcHash ${st.srcHash.slice(0, 12)}, treeClean ${st.treeClean}${st.srcMissing.length ? `, missing ${st.srcMissing.join(", ")}` : ""}`,
  );
  for (const n of pre.notes) console.log(`  note: ${n}`);
  if (o.list) {
    for (const j of queue) {
      const p = pending(env, j);
      console.log(`${p.rungs.length > 0 || p.screen ? "todo" : "done"}\t#${j.index}\t${j.kind}\t${j.role}\tT=${j.T}\t${j.ids.join(" ")}${j.screen ? "\t+screen" : ""}`);
    }
    return 0;
  }
  if (todo.length === 0) {
    console.log("queue done (nothing to run)");
    return 0;
  }
  if (o.kind === null && todo.some((j) => j.kind === "2d")) {
    console.log(`${todo.filter((j) => j.kind === "2d").length} 2D jobs run in a child process first`);
    const code = await spawn2d(argv);
    if (code !== 0) {
      console.error(`the 2D child exited with ${code}`);
      return code;
    }
  }
  const mine = todo.filter((j) => (o.kind === null ? j.kind === "slab" : j.kind === o.kind));
  const strict = !o.dev && o.stage !== "dev";
  let failures = 0;
  for (let k = 0; k < mine.length; k++) {
    const spec = mine[k];
    if (strict) {
      const now = await sourceStamps();
      if (now.srcHash !== st.srcHash || now.codeCommit !== st.codeCommit || !now.treeClean) {
        console.error("the source files changed while the run was going (srcHash, codeCommit or treeClean differ from the start): stopping, so no readout mixes stamps");
        return 3;
      }
    }
    console.log(`[${k + 1}/${mine.length}] ${spec.ids.join(" ")}`);
    try {
      const r = await runJob(spec, env);
      console.log(`  done in ${r.seconds.toFixed(1)} s; load: ${await uptime()}`);
      if (r.invalid.length) {
        failures += r.invalid.length;
        const stage0 = o.stage === "dev" && !o.dev;
        console.error(
          `INVALID JOB${r.invalid.length > 1 ? "S" : ""} (R5; ${stage0 ? "Stage 0: the readout prints the cause INVALID-JOB in every combination, and this Stage 0 run counts as one of the three (R9.0)" : "the readout will print INVALID-RUN"}):\n${r.invalid.map((s) => `  ${s}`).join("\n")}`,
        );
        if (!o.keepGoing) {
          console.error(
            stage0
              ? "stopping at the first INVALID job (--keep-going to finish the run's roster): the Stage 0 run still counts (R9.0); a rerun is licensed only by R9.0's Repetition clause after a STAGE0-FAIL, and every run and change goes into the development log (R0.2)"
              : "stopping at the first INVALID job (--keep-going to continue): fix the cause and rerun those jobs",
          );
          return 1;
        }
      }
    } catch (e) {
      console.error(`FAILED ${spec.ids.join(" ")}: ${(e as Error).stack ?? e}`);
      return 1;
    }
  }
  if (nonFinite > 0) console.warn(`warning: ${nonFinite} non-finite numbers were written as null`);
  console.log(failures ? `queue done with ${failures} INVALID job(s)` : "queue done");
  return failures ? 1 : 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
