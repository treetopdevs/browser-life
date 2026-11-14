// The two-phase kernel job of runs/rps/rule-draft.md 1.3 and Appendix B (frozen as experiments/3d-rps/RULES.md), for every kernel
// driver of the cyclic-competition line: the Gate-0 driver on the spike now, the registered drivers of Part B later.
//
// A job is one directory <out>/<id>/ holding census.tsv (B.2), summary.json (B.3) and, on request, final.bin:
//   1. burn-in: `burnSteps` (6,000) steps with the burn settings (rate 0, mutation 0), censuses every `censusEvery` (1,000) steps;
//   2. hand-over: the state is read back, burnHash = stateHash of it, and a NEW simulator is built from it with the job's own settings
//      (the rule constants are in the shader text, so a simulator cannot change them in place);
//   3. run: `runSteps` steps with the run settings, censuses as above, and the early stop of 1.5 evaluated after every run census.
// The simulator is a factory the caller supplies (`SimFactory`), so the harness knows nothing of the spike: it runs on the shipped
// GpuSim3, on the CPU reference (the tests) and on the spike's patched simulator alike. No Deno or GPU API is used here.
//
// Before the first step the founding must pass the schema's validator, bar the RPS encoding of the genome that it does not know yet
// (`foundingProblems`: total matter at most MATTER_MAX, E and S within the pool, the ledgers, the lineages and the configuration, which the
// rules' exact arithmetic relies on); a founding that does not is a defect of the job's specification and an invariant failure, not a
// crash. Checks at every census (1.3): the matter total equals the founding's, the energy ledger residual is exactly 0, the census step
// is the step asked for, and the MOT mirror agrees with the genome (plan 4.2). A crash (any other exception) or a failed check is
// rerun once from step 0 with the same seed; a second failure writes a MISSING marker (summary.json with `missing: true`) and, when a
// failure was a conservation or invariant failure rather than a crash, throws StageStop: a nonzero residual or a matter change is a
// bug, not a result, and the whole stage stops and is reported (1.3). A job that passes on the rerun keeps the failures of the earlier
// attempt in its summary (`retried`), so a conservation failure that does not come back leaves its trace; the readout lists it as a bug
// indicator (8.4) and the Gate-0 driver stops on it. If the rerun passes but another process has published the job first, the published
// files stand and the failures go to a hidden file `.retried-<id>-<pid>-<n>.json` beside the jobs (`retainLostRace`); a conservation or
// invariant failure among them stops the stage all the same (StageStop), because the summary that was published does not carry them.
// A MISSING marker that loses the publish with such a failure behind it goes to the same kind of file (`publishMissing`).
//
// The change counts (`ndom`, `nanti`) are written when the run phase has no mutation (`run.cfg.mutRate` 0) and left empty otherwise, for
// every row of the job (B.2); `supply` is filled only when the spec asks for it (section 7).
//
// NOSTART (rule draft 1.5 and section 0): a job of sections 3 to 6 whose burn-in ends in NOSTART (liv < 0.01 at some burn-in census,
// or liv < 0.50 or a founding label missing at the last) stops at the hand-over census: the six burn-in censuses are written, burnHash
// and endHash are the hash of the state read back there, `stop` is "nostart" and `stopRstep` is 0, and no run simulator is built. The
// test is the readout's own (`isNoStart`). Section 7 has no NOSTART class and passes `nostartStop: false`. The early stop of 1.5 proper
// is evaluated after run censuses only.
//
// Files are published atomically: written under <out>/.tmp-<id>-<pid>-<n>/ and renamed to <out>/<id>/. A job exists iff its directory
// does; a killed process leaves only a .tmp- directory (`cleanStaleTmp` removes old ones; the readout would otherwise read it).

import { RPS_CENSUS_HEADER, encodeRpsFinal, formatRpsCensusRow, rpsCensus, rpsCensusRecord, rpsChanges, rpsCoexist, rpsMirrorMismatches, type RpsDims } from "@bl/metrics";
import { G, cellCount, stateHash, totalsOf, validateState, worldH, worldW, type WorldConfig, type WorldState } from "@bl/schema";
import * as fs from "node:fs";
import * as path from "node:path";
import { B_IN, CENSUS_INTERVAL, LIV_EXT, LOSS_CONSECUTIVE, LOST_RACE_PREFIX, canonicalStage, isNoStart, type Arm } from "../readout-jobs.ts";

// the name of the hidden file `retainLostRace` writes is the readout's convention (readout-jobs.ts), re-exported for the drivers
export { LOST_RACE_PREFIX };

// ---- the simulator interface ----

/** What a simulator hands over at a census: one consistent read of the host arrays and the ledger, all at `step`. */
export interface CensusRead {
  step: number;
  /** The 7 cell channels, channel major. Valid until the next `run`. */
  cells: Uint32Array;
  /** The first 4 genome channels (lineage hi and lo, PARAM0, PARAM1), channel major. Valid until the next `run`. */
  genomeHead: Uint32Array;
  lightIn: bigint;
  heatOut: bigint;
  /** Mutation events since the previous census read (the simulator drains its event buffer here). */
  events: number;
}

export interface KernelSim {
  /** Advances `count` steps. A GPU simulator may return before the work is done; `census()` waits for it. */
  run(count: number): void | Promise<void>;
  census(): CensusRead | Promise<CensusRead>;
  /** The whole state (cells, genome, ledger) at the current step, as a fresh copy the caller may keep. */
  readState(): WorldState | Promise<WorldState>;
  destroy(): void;
}

export type PhaseName = "burn" | "run";

/** What a factory is told about the simulator it must build. */
export interface SimContext {
  jobId: string;
  /** 1 for the first try, 2 for the rerun (a factory may rebuild a lost device on a rerun). */
  attempt: number;
  phase: PhaseName;
  /** The phase's WorldConfig; equal to `state.cfg`. */
  cfg: WorldConfig;
  /** The phase's settings that live outside WorldConfig (the spike's kill: form, rate, min, ...). */
  settings: Record<string, unknown>;
}

export type SimFactory = (ctx: SimContext, state: WorldState) => KernelSim | Promise<KernelSim>;

// ---- the early stop ----

/** One run census, as the stop rules see it. */
export interface RunPoint {
  /** Run step. */
  rstep: number;
  /** Living fraction. */
  liv: number;
  /** Every founding label present. */
  coexist: boolean;
  /** Number of present labels (`n_c`). */
  n: number;
}

export type StopReason = "ext" | "loss" | "mono" | "nostart";

/** Looks at the run censuses so far (the last is the current one) and says why the job stops now, or null. */
export type StopRule = (history: readonly RunPoint[]) => StopReason | null;

/** No early stop (a job that must run to its end). */
export const stopNever: StopRule = () => null;

/** Rule draft 1.5, sections 3 to 6: stop at an EXT census (`liv < 0.01`) and at the census that completes a sustained loss (three run censuses in a row without `coexist`). */
export const stopRule15: StopRule = (h) => {
  const last = h[h.length - 1];
  if (last === undefined) return null;
  if (last.liv < LIV_EXT) return "ext";
  if (h.length >= LOSS_CONSECUTIVE && h.slice(h.length - LOSS_CONSECUTIVE).every((p) => !p.coexist)) return "loss";
  return null;
};

/** Rule draft 7.2a, section 7: stop at an EXTINCT census; in arms Z, A and W (no label can appear) also at the third consecutive census with `n_c <= 1` (MONO). */
export function stopRule72a(arm: Arm): StopRule {
  const monoStops = arm === "Z" || arm === "A" || arm === "W";
  return (h) => {
    const last = h[h.length - 1];
    if (last === undefined) return null;
    if (last.liv < LIV_EXT) return "ext";
    if (monoStops && h.length >= 3 && h.slice(h.length - 3).every((p) => p.n <= 1)) return "mono";
    return null;
  };
}

// ---- the job ----

export interface PhaseSettings {
  /** Passed to the factory and recorded in summary.json (merged into `config.<phase>` and listed under `killParams`). */
  settings: Record<string, unknown>;
  /** InitParams of the founding, recorded as `init.<phase>`. */
  init: Record<string, unknown>;
}

export interface KernelJobSpec {
  /** Directory name; letters, digits, `.`, `_` and `-`. */
  id: string;
  /** Stage name of the readout (`g0.table`, `sweep`, ...). */
  stage: string;
  seed: number;
  /** Founding labels (3 to 8): `coexist` and the chirality counts use them. */
  K0: number;
  /** Builds the founding state (step 0, empty ledger). Called once per attempt. Its `cfg` is the burn-in's WorldConfig. */
  found: () => WorldState;
  burn: PhaseSettings;
  run: PhaseSettings & { cfg: WorldConfig };
  /** Run steps after the burn-in; a multiple of `censusEvery`. */
  runSteps: number;
  /** Burn-in steps (default 6,000); a multiple of `censusEvery`. */
  burnSteps?: number;
  /** Census interval in steps (default 1,000). */
  censusEvery?: number;
  /** Default `stopRule15`. */
  stop?: StopRule;
  /**
   * Rule draft 1.5: stop at the hand-over census when the burn-in ends in NOSTART (`isNoStart` of the readout), with `stop` "nostart".
   * Default true (sections 3 to 6); section 7 has no NOSTART class and passes false.
   */
  nostartStop?: boolean;
  /** Fill the `supply` column (section 7 jobs). */
  supply?: boolean;
  /** Write `final.bin` (the last census's arrays). */
  final?: boolean;
  /** Treat a MOT mirror that disagrees with the genome as an invariant failure (default true). */
  checkMirror?: boolean;
  /** Extra top-level fields of summary.json (rung, kill, substrate, arm, spread, rpsRate, shape, mode, ...). May not repeat a field the harness writes. */
  summary?: Record<string, unknown>;
}

export interface KernelJobDeps {
  makeSim: SimFactory;
  /** Recorded as `host` and `device`. */
  host: string;
  device: string;
  /** Milliseconds; default `performance.now`. */
  clock?: () => number;
  log?: (line: string) => void;
  /** A progress line every this many censuses (default 10). */
  logEvery?: number;
}

export type FailureKind = "crash" | "conservation" | "invariant";

export interface JobFailure {
  attempt: number;
  kind: FailureKind;
  message: string;
  /** Job step of the census at which it was noticed, null before the first. */
  step: number | null;
  detail: Record<string, unknown>;
}

/** A failed attempt. `partialCensus` is the census.tsv text written up to the failure. */
export class KernelJobError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly step: number | null,
    readonly detail: Record<string, unknown>,
    readonly partialCensus: string,
  ) {
    super(message);
  }
}

/**
 * Thrown after a job failed twice and at least one failure was a conservation or invariant failure: the whole stage stops (1.3). Also
 * thrown (`lostRace`) when a rerun passed but lost the publish race with such a failure behind it (D22). `markerFile` names the hidden
 * file the MISSING marker went to when another process had published the job first (null when the marker is in the job's directory).
 */
export class StageStop extends Error {
  constructor(
    readonly jobId: string,
    readonly failures: JobFailure[],
    readonly lostRace = false,
    readonly markerFile: string | null = null,
  ) {
    const list = failures.map((f) => `attempt ${f.attempt}: ${f.kind}: ${f.message}`).join("; ");
    super(
      lostRace
        ? `stage stopped: job ${jobId} passed on the rerun but another process had published it first, and an earlier attempt failed (${list}); see ${LOST_RACE_PREFIX}${jobId}-*.json`
        : `stage stopped: job ${jobId} failed twice (${list})${markerFile !== null ? `; another process had published it first, so its MISSING marker is in ${markerFile}` : ""}`,
    );
  }
}


/** What a founding state conserves: matter, and the energy content together with the ledger it started with. */
export interface Baseline {
  matter: bigint;
  energy: bigint;
  light0: bigint;
  heat0: bigint;
}

export const baselineOf = (state: WorldState): Baseline => {
  const t = totalsOf(state.cfg, state.cells);
  return { matter: t.matter, energy: t.energy, light0: state.lightIn, heat0: state.heatOut };
};

/** Matter now and the energy residual since the founding: (content now + heat exported) - (content at start + light absorbed), both ledgers counted from the start. 0 for a correct run. */
export function conservationOf(cfg: WorldConfig, b: Baseline, read: Pick<CensusRead, "cells" | "lightIn" | "heatOut">): { matter: bigint; residual: bigint } {
  const t = totalsOf(cfg, read.cells);
  return { matter: t.matter, residual: t.energy - b.energy + (read.heatOut - b.heat0) - (read.lightIn - b.light0) };
}

/** Throws the conservation failure of 1.3 (a matter change, or a nonzero residual) as a KernelJobError. */
export function assertConserved(b: Baseline, now: { matter: bigint; residual: bigint }, step: number, census: string): void {
  if (now.matter !== b.matter) {
    throw new KernelJobError("conservation", `matter ${now.matter} at step ${step}, ${b.matter} at the start`, step, { matter: String(now.matter), matterStart: String(b.matter), residual: String(now.residual) }, census);
  }
  if (now.residual !== 0n) {
    throw new KernelJobError("conservation", `energy residual ${now.residual} at step ${step}`, step, { residual: String(now.residual), matter: String(now.matter) }, census);
  }
}

/**
 * The problems of a founding state, from the schema's own validator (`validateState`: the configuration, the buffer sizes, the step, total
 * matter at most MATTER_MAX, E and S within the pool, the ledgers, the lineages), which the rules' exact arithmetic relies on (docs/rules.md).
 * Empty for a sound founding. The one thing exempted is the RPS encoding of a job's genome (the type in PARAM1 byte 1 and the beats-mask
 * in byte 2), which the shipped validator does not know yet and wants 0 in a slab: it is asked about a copy with those two bytes cleared.
 */
export function foundingProblems(state: WorldState): string[] {
  const n = cellCount(state.cfg);
  const genome = state.genome.slice();
  const p = G.PARAM1 * n;
  for (let i = 0; i < n; i++) genome[p + i] = (genome[p + i] & 0xff0000ff) >>> 0;
  return validateState({ ...state, genome });
}
/** Throws the invariant failure of a founding that is not a valid world state (a defect of the specification, so it stops the stage and is no crash). */
export function checkFounding(state: WorldState, census: string): void {
  const bad = foundingProblems(state);
  if (bad.length > 0) throw new KernelJobError("invariant", `the founding is not a valid world state: ${bad.join("; ")}`, null, { problems: bad }, census);
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HARNESS_FIELDS = [
  "id", "stage", "seed", "K0", "steps", "stop", "stopRstep", "config", "init", "killParams", "burnSteps", "censusEvery", "runStepsScheduled",
  "host", "device", "stepsPerSec", "seconds", "matterOk", "residual", "burnHash", "endHash", "extinctAt", "events", "final", "attempts",
  "mirrorMismatches", "missing", "status", "failures", "retried",
] as const;

interface AttemptOutput {
  summary: Record<string, unknown>;
  census: string;
  final: Uint8Array | null;
}

/** The fields shared by a finished job's summary and a MISSING marker. */
function summaryBase(spec: KernelJobSpec, deps: KernelJobDeps, burnCfg: WorldConfig | null): Record<string, unknown> {
  const extra = spec.summary ?? {};
  for (const k of HARNESS_FIELDS) if (k in extra) throw new Error(`${spec.id}: summary field "${k}" is written by the harness and may not be given in spec.summary`);
  return {
    ...extra,
    id: spec.id,
    stage: spec.stage,
    seed: spec.seed,
    K0: spec.K0,
    config: { burn: burnCfg === null ? null : { ...burnCfg, ...spec.burn.settings }, run: { ...spec.run.cfg, ...spec.run.settings } },
    init: { burn: spec.burn.init, run: spec.run.init },
    killParams: { burn: spec.burn.settings, run: spec.run.settings },
    burnSteps: spec.burnSteps ?? B_IN,
    censusEvery: spec.censusEvery ?? CENSUS_INTERVAL,
    runStepsScheduled: spec.runSteps,
    host: deps.host,
    device: deps.device,
  };
}

function checkSpec(spec: KernelJobSpec): { burnSteps: number; every: number } {
  const burnSteps = spec.burnSteps ?? B_IN;
  const every = spec.censusEvery ?? CENSUS_INTERVAL;
  const bad = (m: string): never => {
    throw new Error(`${spec.id}: ${m}`);
  };
  for (const k of HARNESS_FIELDS) if (spec.summary !== undefined && k in spec.summary) bad(`summary field "${k}" is written by the harness and may not be given in spec.summary`);
  if (!ID_RE.test(spec.id)) bad(`id "${spec.id}" is not a safe directory name`);
  if (canonicalStage(spec.stage) !== spec.stage) bad(`stage "${spec.stage}" is not a stage name of the readout`);
  if (!Number.isInteger(spec.seed) || spec.seed < 0) bad("seed must be a non-negative integer");
  if (!Number.isInteger(spec.K0) || spec.K0 < 3 || spec.K0 > 8) bad("K0 must be 3 to 8");
  if (!(Number.isInteger(every) && every > 0)) bad("censusEvery must be a positive integer");
  if (!(Number.isInteger(burnSteps) && burnSteps > 0 && burnSteps % every === 0)) bad(`burnSteps ${burnSteps} must be a positive multiple of censusEvery ${every}`);
  if (!(Number.isInteger(spec.runSteps) && spec.runSteps > 0 && spec.runSteps % every === 0)) bad(`runSteps ${spec.runSteps} must be a positive multiple of censusEvery ${every}`);
  return { burnSteps, every };
}

/** One try, from step 0. Throws KernelJobError. */
async function runAttempt(spec: KernelJobSpec, deps: KernelJobDeps, attemptNo: number): Promise<AttemptOutput> {
  const { burnSteps, every } = checkSpec(spec);
  const clock = deps.clock ?? (() => performance.now());
  const logEvery = deps.logEvery ?? 10;
  const stopRule = spec.stop ?? stopRule15;
  const chiralityCounts = spec.run.cfg.mutRate === 0;
  let census = RPS_CENSUS_HEADER;
  let lastStep: number | null = null;
  let sim: KernelSim | null = null;
  try {
    const state0 = spec.found();
    if (state0.step !== 0) throw new Error(`the founding state is at step ${state0.step}, not 0`);
    checkFounding(state0, census);
    const cfg0 = state0.cfg;
    const runCfg = spec.run.cfg;
    const dims: RpsDims = { W: worldW(cfg0), H: worldH(cfg0), D: cfg0.tileD ?? 1 };
    if (cfg0.seed !== spec.seed || runCfg.seed !== spec.seed) throw new Error(`seed ${spec.seed} but the founding config has seed ${cfg0.seed} and the run config ${runCfg.seed}`);
    const baseline = baselineOf(state0);

    sim = await deps.makeSim({ jobId: spec.id, attempt: attemptNo, phase: "burn", cfg: cfg0, settings: spec.burn.settings }, state0);
    let phase: PhaseName = "burn";
    let busyMs = 0;
    let prevLabels: Uint8Array | null = null;
    let events = 0;
    let extinctAt: number | null = null;
    let burnHash: string | null = null;
    let stopReason: StopReason | null = null;
    let mirrorWorst = 0;
    let residual = 0n;
    let lastRead: CensusRead | null = null;
    let burnEnd: WorldState | null = null;
    const burnPoints: { liv: number; coexist: boolean }[] = [];
    const history: RunPoint[] = [];
    const total = (burnSteps + spec.runSteps) / every;

    for (let k = 1; k <= total; k++) {
      const step = k * every;
      const t0 = clock();
      await sim.run(every);
      const read = await sim.census();
      busyMs += clock() - t0;
      lastStep = step;
      if (read.step !== step) throw new KernelJobError("invariant", `census at step ${read.step}, expected ${step}`, step, { got: read.step }, census);

      // conservation, at every census (1.3)
      const now = conservationOf(phase === "burn" ? cfg0 : runCfg, baseline, read);
      residual = now.residual;
      assertConserved(baseline, now, step, census);
      if (spec.checkMirror !== false) {
        const bad = rpsMirrorMismatches(read, dims);
        mirrorWorst = Math.max(mirrorWorst, bad);
        if (bad > 0) throw new KernelJobError("invariant", `${bad} cells whose MOT mirror disagrees with the genome at step ${step}`, step, { mirrorMismatches: bad }, census);
      }

      // the census row
      const c = rpsCensus(read, dims, { supply: spec.supply === true });
      const change = prevLabels === null ? null : rpsChanges(prevLabels, c.labels, chiralityCounts ? spec.K0 : null);
      census += formatRpsCensusRow(rpsCensusRecord(c, change, { phase, step, rstep: step - burnSteps, supply: spec.supply === true }));
      prevLabels = c.labels;
      events += read.events;
      if (extinctAt === null && c.liv < LIV_EXT) extinctAt = step;
      lastRead = read;
      if (step <= burnSteps) burnPoints.push({ liv: c.liv, coexist: rpsCoexist(c.present, spec.K0) });

      if (deps.log && (k % logEvery === 0 || k === total)) {
        const turnover = change?.turnover ?? null;
        deps.log(`${spec.id} step ${step} ${phase} liv ${c.liv.toFixed(3)} n ${c.n} Y ${c.Y} turnover ${turnover === null ? "-" : turnover.toFixed(3)} ${(step / Math.max(1e-9, busyMs / 1000)).toFixed(0)} steps/s`);
      }

      if (step === burnSteps) {
        // hand-over: read the state back, hash it, and build a new simulator with the run settings
        const t1 = clock();
        const st = await sim.readState();
        busyMs += clock() - t1;
        if (st.step !== burnSteps) throw new KernelJobError("invariant", `burn-in state read back at step ${st.step}, expected ${burnSteps}`, step, {}, census);
        burnHash = stateHash(st);
        sim.destroy();
        sim = null;
        // NOSTART (1.5): the film did not start, so nothing after the hand-over is used; no run simulator is built
        if (spec.nostartStop !== false && isNoStart(burnPoints)) {
          stopReason = "nostart";
          burnEnd = st;
          deps.log?.(`${spec.id} step ${step}: the burn-in ended in NOSTART (liv ${c.liv.toFixed(3)}, n ${c.n}); the job stops at the hand-over`);
          break;
        }
        const runState: WorldState = { ...st, cfg: runCfg };
        sim = await deps.makeSim({ jobId: spec.id, attempt: attemptNo, phase: "run", cfg: runCfg, settings: spec.run.settings }, runState);
        phase = "run";
      } else if (step > burnSteps) {
        history.push({ rstep: step - burnSteps, liv: c.liv, coexist: rpsCoexist(c.present, spec.K0), n: c.n });
        stopReason = stopRule(history);
        if (stopReason !== null) break;
      }
    }

    // the end state: its hash is a determinism witness (two machines running one job must agree). A NOSTART job ends at the hand-over,
    // where the state read back is its end state.
    let endHash: string;
    const steps = lastStep!;
    if (burnEnd !== null) endHash = stateHash(burnEnd);
    else {
      const t2 = clock();
      const end = await sim!.readState();
      busyMs += clock() - t2;
      endHash = stateHash(end);
      if (end.step !== steps) throw new KernelJobError("invariant", `end state read back at step ${end.step}, expected ${steps}`, steps, {}, census);
    }
    const seconds = busyMs / 1000;
    const summary: Record<string, unknown> = {
      ...summaryBase(spec, deps, cfg0),
      steps,
      stop: stopReason ?? "end",
      stopRstep: steps - burnSteps,
      stepsPerSec: Math.round((steps / Math.max(1e-9, seconds)) * 10) / 10,
      seconds: Math.round(seconds * 10) / 10,
      matterOk: true,
      residual: String(residual),
      burnHash,
      endHash,
      extinctAt,
      events,
      final: spec.final === true && burnEnd === null ? "final.bin" : null,
      attempts: attemptNo,
      mirrorMismatches: mirrorWorst,
    };
    const final = spec.final === true && burnEnd === null && lastRead !== null ? encodeRpsFinal({ ...dims, K0: spec.K0, cells: lastRead.cells, genomeHead: lastRead.genomeHead }) : null;
    return { summary, census, final };
  } catch (e) {
    if (e instanceof KernelJobError) throw e;
    const err = e as Error;
    throw new KernelJobError("crash", err?.message ?? String(e), lastStep, { stack: err?.stack ?? null }, census);
  } finally {
    try {
      sim?.destroy();
    } catch {
      // a simulator that cannot be destroyed after a failure is not a second failure
    }
  }
}

// ---- files ----

/** The directory of a job. */
export const jobDir = (outDir: string, id: string): string => path.join(outDir, id);

/** A job exists iff its directory does (directories are published atomically). */
export const jobExists = (outDir: string, id: string): boolean => fs.existsSync(jobDir(outDir, id));

let tmpCounter = 0;

/** Writes `files` under a temporary directory next to the job and renames it into place. Returns false if the job directory appeared meanwhile (another process won). */
export function publishJob(outDir: string, id: string, files: Record<string, string | Uint8Array>): boolean {
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = path.join(outDir, `.tmp-${id}-${process.pid}-${tmpCounter++}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);
  try {
    // summary.json last: a directory without it is never mistaken for a finished job
    for (const name of Object.keys(files).sort((a, b) => (a === "summary.json" ? 1 : b === "summary.json" ? -1 : a < b ? -1 : 1))) fs.writeFileSync(path.join(tmp, name), files[name]);
    fs.renameSync(tmp, jobDir(outDir, id));
    return true;
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    const code = (e as NodeJS.ErrnoException).code;
    if ((code === "ENOTEMPTY" || code === "EEXIST") && jobExists(outDir, id)) return false;
    throw e;
  }
}

/** Removes `.tmp-` directories older than `maxAgeMs` (default 30 minutes): what a killed process left behind. Returns how many. */
export function cleanStaleTmp(outDir: string, maxAgeMs = 30 * 60 * 1000, now = Date.now()): number {
  if (!fs.existsSync(outDir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (!e.isDirectory() || !e.name.startsWith(".tmp-")) continue;
    const p = path.join(outDir, e.name);
    if (now - fs.statSync(p).mtimeMs >= maxAgeMs) {
      fs.rmSync(p, { recursive: true, force: true });
      n++;
    }
  }
  return n;
}

/** Reads a published job's summary.json, or null if the job does not exist. */
export function readSummary(outDir: string, id: string): Record<string, unknown> | null {
  const p = path.join(jobDir(outDir, id), "summary.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>) : null;
}

/** `failures` of an `ok` outcome are those of the earlier attempts (empty when the first attempt passed). */
export type RetryOutcome<T> = { ok: true; value: T; attempts: number; failures: JobFailure[] } | { ok: false; failures: JobFailure[]; partialCensus: string };

/** Rule draft 1.3: runs `attempt` (1, then 2) until one returns; a thrown KernelJobError keeps its kind, anything else is a crash. Shared by every kind of job. */
export async function withRetry<T>(id: string, attemptFn: (attempt: number) => Promise<T>, o: { maxAttempts?: number; log?: (line: string) => void } = {}): Promise<RetryOutcome<T>> {
  const maxAttempts = o.maxAttempts ?? 2;
  const failures: JobFailure[] = [];
  let partialCensus = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return { ok: true, value: await attemptFn(attempt), attempts: attempt, failures };
    } catch (e) {
      const err = e instanceof KernelJobError ? e : new KernelJobError("crash", (e as Error)?.message ?? String(e), null, { stack: (e as Error)?.stack ?? null }, "");
      partialCensus = err.partialCensus;
      failures.push({ attempt, kind: err.kind, message: err.message, step: err.step, detail: err.detail });
      o.log?.(`${id} attempt ${attempt} failed (${err.kind}): ${err.message}${attempt < maxAttempts ? "; rerunning from step 0" : ""}`);
    }
  }
  return { ok: false, failures, partialCensus };
}

/**
 * Publishes the MISSING marker of a job that failed every attempt: `base` (the fields every summary of the job carries) plus
 * `missing: true`, the failures, and the partial census for diagnosis. Throws StageStop afterwards when a failure was a conservation
 * or invariant failure (1.3: the whole stage stops and is reported). Returns false if the job directory appeared meanwhile; with a
 * conservation or invariant failure behind it, the marker then goes to a hidden `.retried-<id>-<pid>-<n>.json` beside the jobs (as in
 * `retainLostRace`) before the throw, so a later run of the driver still stops on it.
 */
export function publishMissing(outDir: string, id: string, base: Record<string, unknown>, failures: JobFailure[], partialCensus: string): boolean {
  const conservation = failures.find((f) => f.kind === "conservation");
  const marker: Record<string, unknown> = {
    ...base,
    missing: true,
    status: "missing",
    stop: "missing",
    attempts: failures.length,
    failures,
    ...(conservation ? { matterOk: false, residual: String(conservation.detail.residual ?? "unknown") } : {}),
  };
  const files: Record<string, string | Uint8Array> = { "summary.json": `${JSON.stringify(marker, null, 2)}\n` };
  if (partialCensus !== "") files["census.partial.tsv"] = partialCensus;
  const published = publishJob(outDir, id, files);
  // a conservation or invariant failure stops the stage whether or not this process won the publish. A job another process published
  // cleanly does not carry it, so a lost publish keeps the marker in the hidden file first (1.3, D22): only that makes the stop durable
  if (failures.some((f) => f.kind !== "crash")) {
    const trace = published ? null : writeLostRaceTrace(outDir, id, { ...marker, id, lostRace: true, ...(partialCensus !== "" ? { partialCensus } : {}) });
    throw new StageStop(id, failures, false, trace);
  }
  return published;
}

let traceCounter = 0;

/** Writes `body` to a new hidden `.retried-<id>-<pid>-<n>.json` beside the jobs, through a `.tmp-` file and a rename; returns its name. */
function writeLostRaceTrace(outDir: string, id: string, body: Record<string, unknown>): string {
  fs.mkdirSync(outDir, { recursive: true });
  const name = `${LOST_RACE_PREFIX}${id}-${process.pid}-${traceCounter++}.json`;
  const tmp = path.join(outDir, `.tmp-${name}`);
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
  fs.renameSync(tmp, path.join(outDir, name));
  return name;
}

/**
 * A rerun that passed lost the publish race: another process published the job first, and its files stand. Failures of the earlier
 * attempt that were not plain crashes (a conservation or invariant failure) are not erased by that (1.3, D22): they are written to a
 * hidden file `.retried-<id>-<pid>-<n>.json` beside the jobs, with the summary the rerun would have published (the loader and the
 * driver's job listing skip hidden entries, the readout and the driver look for this file by its name), and the stage stops
 * (StageStop). A plain crash is only recorded in the log, as when the rerun wins the race. Returns normally when there is nothing to stop for.
 */
export function retainLostRace(outDir: string, id: string, failures: readonly JobFailure[], loser: Record<string, unknown>): void {
  if (!failures.some((f) => f.kind !== "crash")) return;
  writeLostRaceTrace(outDir, id, { id, lostRace: true, retried: failures, loser });
  throw new StageStop(id, [...failures], true);
}

export type KernelJobResult =
  | { status: "done"; dir: string; summary: Record<string, unknown> }
  | { status: "exists"; dir: string }
  | { status: "missing"; dir: string; failures: JobFailure[] };

/**
 * Runs a job to its directory: skips it if the directory exists, retries a failed attempt once from step 0 (1.3), publishes the
 * files, and on a second failure publishes a MISSING marker. Throws StageStop after the marker when a failure was not a plain crash.
 */
export async function executeKernelJob(spec: KernelJobSpec, deps: KernelJobDeps, outDir: string, opts: { maxAttempts?: number } = {}): Promise<KernelJobResult> {
  checkSpec(spec);
  const dir = jobDir(outDir, spec.id);
  if (jobExists(outDir, spec.id)) return { status: "exists", dir };
  const r = await withRetry(spec.id, (attempt) => runAttempt(spec, deps, attempt), { maxAttempts: opts.maxAttempts, log: deps.log });
  if (r.ok) {
    const out = r.value;
    // an earlier attempt's failure leaves its trace in the summary (`retried`): a conservation failure that does not come back is not
    // erased by the rerun that passed (1.3), and the readout lists it as a bug indicator (8.4)
    const summary = r.failures.length > 0 ? { ...out.summary, retried: r.failures } : out.summary;
    const files: Record<string, string | Uint8Array> = { "census.tsv": out.census, "summary.json": `${JSON.stringify(summary, null, 2)}\n` };
    if (out.final !== null) files["final.bin"] = out.final;
    if (publishJob(outDir, spec.id, files)) return { status: "done", dir, summary };
    // another process published the job first and its files stand; the failures behind our rerun are not lost with it (D22)
    retainLostRace(outDir, spec.id, r.failures, summary);
    return { status: "exists", dir };
  }
  // failed every attempt: a MISSING marker, with the partial census of the last attempt for diagnosis
  let burnCfg: WorldConfig | null = null;
  try {
    burnCfg = spec.found().cfg;
  } catch {
    burnCfg = null;
  }
  return publishMissing(outDir, spec.id, summaryBase(spec, deps, burnCfg), r.failures, r.partialCensus) ? { status: "missing", dir, failures: r.failures } : { status: "exists", dir };
}
