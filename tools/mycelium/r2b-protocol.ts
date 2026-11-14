// Mycelium rung R2b: the protocol's constants, arms, seed gate and freeze checks as pure functions
// (docs/mycelium-r2b-2026-11-13/PROTOCOL.md). No Deno, no file system, no clock: tools/mycelium/r2b.ts and
// r2b-analyze.ts are thin wrappers, and vitest tests this module directly. Calibration and the decision are in r2b-decide.ts.
import { defaultConfig, type MyceliumConfig } from "./world.ts";
import { type FreezeHashes, manifestText, parseFrozen } from "./r2-protocol.ts";
import { ARM_SEED_OFFSET, worldSeed } from "./r2b-seeds.ts";

export { ARM_SEED_OFFSET, manifestText, parseFrozen, worldSeed };
export type { FreezeHashes };

export const PROTOCOL_ID = "mycelium-r2b";

/** The protocol's numbers (section numbers refer to PROTOCOL.md). */
export const R2B = {
  /** Run length and the measurement window W = (LO, STEPS] (section 3). */
  STEPS: 100_000,
  LO: 50_000,
  /** Scalar census every SCALAR_EVERY steps, heavy census every HEAVY_EVERY (100 of them in W, 200 per run). */
  SCALAR_EVERY: 100,
  HEAVY_EVERY: 500,
  /** Population guard (section 7): n below this at any scalar census in W. */
  GUARD_MIN_N: 200,
  /** Moran's I counts 0 and is tallied invalid below this much trail in total (section 4). */
  MORAN_MIN_SUM_P: 500,
  /** Matching runs (6.5): seeds, length, the part of the run the deposit is averaged over, tolerance, rounds. */
  MATCH_STEPS: 30_000,
  MATCH_LO: 10_000,
  MATCH_TOL: 0.10,
  MATCH_ROUNDS: 3,
  /** A null that deposits less than this per particle-step is a random walker (6.3), in matter units. */
  D_FLOOR: 1 / 16,
  MIN_TRAIL_ON: 4,
  /** Regime classifier adequacy (6.4). */
  OTSU_MIN_CLASS: 4,
  OTSU_SHARE: 0.70,
  /**
   * Two regimes need a gap (6.4): the log10 distance between the highest low-class value and the lowest high-class value must be at least
   * this (a factor of 3 in trail per particle) and at least the larger within-class standard deviation (the classes are further apart than
   * they are wide). 20 evenly spaced values pass the share rule at 0.75 and fail this one.
   */
  OTSU_MIN_GAP: 0.5,
  OTSU_GAP_SD: 1.0,
  /** Added before the log in the classifier and subtracted from the cut (6.4). */
  TAU_EPS: 0.01,
  /** A readout needs this many distinct values among the inherit dev seeds to be kept (6.7). */
  MIN_DISTINCT: 6,
  /** A readout separates only with |Cliff's delta| at least this and Holm rejection (section 8). */
  DELTA_MIN: 0.33,
  ALPHA: 0.05,
  /** Flag a ratio of inherit to the other arm beyond 25% (section 8, ordering). */
  RATIO_FLAG: 0.25,
  /** The null counts as matched only within this of the target T, both in the matching rounds and in the dev window (6.5, 6.6): the same 25% as RATIO_FLAG. */
  MATCH_GATE: 0.25,
  /**
   * MI is the mean of Moran's I over the heavy censuses of W, and exists only when EVERY one of them is valid (at least MORAN_MIN_SUM_P of trail and some
   * variance): a run with any invalid census has no MI (null). Moran's I is exactly invariant to scaling the trail field, so a mean over all the same censuses
   * cannot move with trail mass; zero-filling invalid censuses made it a mass indicator below the cutoff, and averaging only the valid ones let the mass
   * cutoff choose which spatial observations were averaged (a fraction under 1 leaves that selection in). A readout needs MI_MIN_SEEDS measurable seeds per
   * arm (and, in calibration, among the dev inherit seeds) to be tested at all.
   */
  MI_MIN_VALID_FRACTION: 1,
  MI_MIN_SEEDS: 8,
  /** Timing gate (section 3), aggregate steps per second: at least FULL, the full plan; at least REDUCED, the reduced plan; below, not started. */
  TIMING_FULL: 1800,
  TIMING_REDUCED: 1200,
  /** Spearman correlation between readouts above this is flagged (section 4). */
  CORR_FLAG: 0.8,
  /** Largest physarumDeposit and the matching start (clamped to it). */
  V_MAX: 768,
} as const;

// ---- readouts ------------------------------------------------------------------------------------------

export const READOUT_IDS = ["TM", "MI", "REG", "AGE", "TURN", "SIG"] as const;
export type ReadoutId = (typeof READOUT_IDS)[number];
/** Exposed against the physarum null by construction (section 4): counted, but not enough for a PASS alone. */
export const EXPOSED_VS_PHYSARUM: readonly ReadoutId[] = ["AGE", "TURN"];
/** Excluded from the physarum contrast: the null's genome is never read. */
export const EXCLUDED_VS_PHYSARUM: readonly ReadoutId[] = ["SIG"];
/** Readouts that follow trail mass, and the pair that are near-inverses (printed, never used to change a label). */
export const NON_EXPOSED: readonly ReadoutId[] = ["TM", "MI", "REG"];
/**
 * Families (section 4). MASS is trail per particle (REG is TM thresholded per census, so it is the same factor), STRUCT is the spatial
 * structure of the trail (MI, mass-normalised), LIFE is the lifetime pair (exposed against the null), GENOME is the heritable signature
 * (blocked contrast only). A PASS (section 8) needs the two non-exposed families, MASS and STRUCT, both separating from both arms.
 */
export const FAMILY: Record<ReadoutId, "MASS" | "STRUCT" | "LIFE" | "GENOME"> = { TM: "MASS", REG: "MASS", MI: "STRUCT", AGE: "LIFE", TURN: "LIFE", SIG: "GENOME" };
export const MASS_READOUTS: readonly ReadoutId[] = ["TM", "REG"];
export const STRUCT_READOUT: ReadoutId = "MI";

/** The members of `ids` that can complete a PASS: a MASS readout and MI. Empty when either is missing. */
export const passPair = (ids: readonly ReadoutId[]): ReadoutId[] => (ids.includes(STRUCT_READOUT) && ids.some((i) => MASS_READOUTS.includes(i)) ? ids.filter((i) => i === STRUCT_READOUT || MASS_READOUTS.includes(i)) : []);

/**
 * A PASS is attainable only with a kept set that has a MASS readout (TM or REG) and MI. Calibration (READY), the confirmation decision and
 * the calibration check before confirm all call this one predicate, so a READY calibration cannot coexist with an impossible PASS.
 */
export const passAttainable = (kept: readonly ReadoutId[]): boolean => passPair(kept).length > 0;

/**
 * The six fixed probe inputs of SIG (section 4), in the controller's input order (nutrient, waste, trail, trail east-west,
 * trail south-north, nutrient east-west, nutrient south-north, energy, body, crowding): all zero; nutrient 100; trail 100 with
 * an east gradient +100; trail 100 with a west gradient -100; waste 100; energy, body and crowding 100.
 */
export const PROBE_INPUTS: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [100, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 100, 100, 0, 0, 0, 0, 0, 0],
  [0, 0, 100, -100, 0, 0, 0, 0, 0, 0],
  [0, 100, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 100, 100, 100],
];

// ---- arms and seeds -------------------------------------------------------------------------------------

export const ARMS = ["inherit", "blocked", "physarum"] as const;
export const CONTROLS = ["pc-light", "pc-upkeep", "pc-blind"] as const;
export type Arm = (typeof ARMS)[number];
export type Control = (typeof CONTROLS)[number];
export type AnyArm = Arm | Control;
export const ALL_ARMS: readonly AnyArm[] = [...ARMS, ...CONTROLS];
export const isArm = (a: string): a is AnyArm => (ALL_ARMS as readonly string[]).includes(a);

/** Config deltas on top of defaultConfig() (section 2). The physarum arm also takes physarumDeposit from calibration. */
export const ARM_DELTA: Record<AnyArm, Partial<MyceliumConfig>> = {
  inherit: {},
  blocked: { heredity: "blocked" },
  physarum: { controller: "physarum", heredity: "frozen" },
  "pc-light": { light: 4 },
  "pc-upkeep": { upkeep: 9 },
  "pc-blind": { blindTrailGradient: true },
};

/**
 * defaultConfig() plus the arm's delta and, for the physarum arm, the matched deposit `v` (required there, refused elsewhere). `seed` is the
 * registered slot; the world seed is slot + the arm's offset (r2b-seeds.ts), so arms never share founders or a PRNG stream.
 */
export function armConfig(arm: AnyArm, seed: number, v?: number): MyceliumConfig {
  const ws = worldSeed(arm, seed);
  if (arm === "physarum") {
    if (v === undefined) throw new Error("the physarum arm needs physarumDeposit v");
    return defaultConfig({ ...ARM_DELTA.physarum, physarumDeposit: v, seed: ws });
  }
  if (v !== undefined) throw new Error(`physarumDeposit v is only for the physarum arm, not ${arm}`);
  return defaultConfig({ ...ARM_DELTA[arm], seed: ws });
}

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export type PlanName = "full" | "reduced";
/** The full plan and the reduced plan fixed in advance (section 3): dev seeds per arm and confirmation seeds per arm. */
export const PLANS: Record<PlanName, { dev: readonly number[]; confirm: readonly number[] }> = {
  full: { dev: range(2001, 2020), confirm: range(5001, 5016) },
  reduced: { dev: range(2001, 2016), confirm: range(5001, 5012) },
};
export const MATCH_SEEDS: readonly number[] = range(2001, 2008);
/** R2's seeds: never run, in any phase, so R2 stays restartable (section 5). */
export const REFUSED_SEEDS: readonly number[] = [...range(101, 105), ...range(9001, 9005)];
export const CONFIRM_ARMS: readonly Arm[] = ["inherit", "blocked", "physarum"];
/** The three arms that carry the population guard in calibration and in confirmation (section 7); controls are unusable, not fatal. */
export const GUARDED_ARMS: readonly Arm[] = ARMS;
/** Smoke seeds: 1-100 or 106-1999 only (section 5). */
export const isSmokeSeed = (s: number): boolean => Number.isInteger(s) && ((s >= 1 && s <= 100) || (s >= 106 && s <= 1999));
/** Seeds from here on belong to confirmation (and its CPU cross-check) only. */
export const CONFIRM_MIN = 5001;
/** Seeds from here on are never run unless they are confirmation seeds. */
export const DEV_MAX = 2020;

// ---- the run gate ---------------------------------------------------------------------------------------

export type Phase = "smoke" | "dev" | "match" | "confirm" | "cpu-check";

export interface SeedLogEntry {
  phase: Phase;
  arm: string;
  seed: number;
  steps: number;
  /** started and finished bracket a run; invalid is written when a ledger residual or a digest mismatch stops the protocol. */
  state: "started" | "finished" | "invalid";
  /** Matching round (match phase only). */
  round?: number;
  /** The plan FROZEN named when the run was logged (logged phases): a later plan that differs stops the protocol (logProblems). */
  plan?: PlanName;
  /** SHA-256 of the exact bytes of the finished run's series.json (finished entries of logged phases): the analysis refuses a file that differs. */
  fileSha256?: string;
}

export interface RunRequest {
  phase: Phase;
  arm: string;
  seed: number;
  steps: number;
  plan: PlanName | null;
  /** True when <out>/<arm>/seed-<n>/series.json already exists (only the confirm gate reads it). */
  seriesExists?: boolean;
}

/** A fresh (embargoed) seed: a confirmation seed, which may be run or cross-checked only in the confirm phases. */
export const isConfirmSeed = (s: number): boolean => PLANS.full.confirm.includes(s);

/**
 * Problems with the log itself, which stop every logged phase (empty = clean). With `plan` (the one FROZEN names now) an entry logged under
 * another plan is a problem: the plan is fixed by the time of the first logged run and cannot be changed after dev results are seen.
 */
export function logProblems(log: readonly SeedLogEntry[], plan?: PlanName | null): string[] {
  const bad: string[] = [];
  const planned = [...new Set(log.map((e) => e.plan).filter((p): p is PlanName => p !== undefined))];
  if (planned.length > 1) bad.push(`the seed log holds runs under more than one plan (${planned.join(", ")}); the plan is fixed at Freeze 1`);
  else if (plan && planned.length === 1 && planned[0] !== plan) bad.push(`the seed log was written under the ${planned[0]} plan but FROZEN names the ${plan} plan; the plan is fixed at Freeze 1`);
  const refused = log.filter((e) => REFUSED_SEEDS.includes(e.seed));
  if (refused.length) bad.push(`the seed log holds a refused seed (${refused.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")}); R2's seeds are never run`);
  const leaked = log.filter((e) => (isConfirmSeed(e.seed) && e.phase !== "confirm" && e.phase !== "cpu-check") || (e.seed > DEV_MAX && !isConfirmSeed(e.seed)));
  if (leaked.length) bad.push(`the seed log holds a fresh seed outside the confirm phases (${leaked.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")}); the embargo is broken and the protocol stops`);
  const inv = log.filter((e) => e.state === "invalid");
  if (inv.length) bad.push(`the seed log holds an invalid run (${inv.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")}); the protocol stops`);
  return bad;
}

/**
 * Why a run may not start (empty = allowed). R2's seeds are refused in every phase, smoke included. Smoke takes seeds 1-100 and
 * 106-1999 only. dev runs the plan's dev seeds at 100,000 steps on any arm; match runs the physarum arm on seeds 2001-2008 at
 * 30,000 steps; confirm runs the plan's confirmation seeds on the three arms at 100,000 steps and never twice (a finished pair, or a
 * series.json without a finished entry, is not run again); cpu-check re-runs a dev or confirmation seed on the CPU reference. A log with a
 * leak, an invalid entry or a refused seed stops every logged phase.
 */
export function gateRun(req: RunRequest, log: readonly SeedLogEntry[]): string[] {
  const bad: string[] = [];
  const { phase, arm, seed, steps } = req;
  if (!Number.isInteger(seed) || seed < 0) bad.push("seed must be a non-negative integer");
  if (!isArm(arm)) bad.push(`unknown arm ${arm}`);
  if (REFUSED_SEEDS.includes(seed)) bad.push(`seed ${seed} is refused: it belongs to R2 (101-105, 9001-9005), which stays restartable`);
  if (phase !== "smoke") bad.push(...logProblems(log, req.plan));
  const plan = req.plan === null ? null : PLANS[req.plan];
  const needPlan = () => { if (plan === null) bad.push(`${phase} needs the plan (full or reduced) recorded in FROZEN`); };
  switch (phase) {
    case "smoke":
      if (!isSmokeSeed(seed)) bad.push(`smoke seeds are 1-100 or 106-1999 (got ${seed})`);
      if (!Number.isInteger(steps) || steps < 1000 || steps % 1000 !== 0 || steps > R2B.STEPS) bad.push("a smoke run needs a step count that is a multiple of 1000, from 1000 to 100000 (its window starts at half)");
      break;
    case "dev":
      needPlan();
      if (plan && !plan.dev.includes(seed)) bad.push(`dev runs the plan's dev seeds ${plan.dev[0]}-${plan.dev.at(-1)} only (got ${seed})`);
      if (steps !== R2B.STEPS) bad.push(`dev runs ${R2B.STEPS} steps`);
      break;
    case "match":
      if (arm !== "physarum") bad.push("matching runs the physarum arm only");
      if (!MATCH_SEEDS.includes(seed)) bad.push("matching runs seeds 2001-2008 only");
      if (steps !== R2B.MATCH_STEPS) bad.push(`matching runs ${R2B.MATCH_STEPS} steps`);
      break;
    case "confirm": {
      needPlan();
      if (plan && !plan.confirm.includes(seed)) bad.push(`confirm runs the plan's confirmation seeds ${plan.confirm[0]}-${plan.confirm.at(-1)} only (got ${seed})`);
      if (!(CONFIRM_ARMS as readonly string[]).includes(arm)) bad.push("confirm runs inherit, blocked and physarum only");
      if (steps !== R2B.STEPS) bad.push(`confirm runs ${R2B.STEPS} steps`);
      const mine = log.filter((e) => e.phase === "confirm" && e.arm === arm && e.seed === seed);
      if (mine.some((e) => e.state === "finished")) bad.push(`(${arm}, ${seed}) is already finished in the seed log; a confirmation run is never repeated`);
      else if (mine.length && req.seriesExists) bad.push(`(${arm}, ${seed}) has a series.json but no finished entry; inspect it by hand, it is not run again`);
      break;
    }
    case "cpu-check":
      if (!(PLANS.full.dev.includes(seed) || isConfirmSeed(seed))) bad.push("cpu-check re-runs a dev or confirmation seed only");
      break;
    default:
      bad.push(`unknown phase ${phase as string}`);
  }
  if (seed > DEV_MAX && !isConfirmSeed(seed) && phase !== "smoke") bad.push(`seed ${seed} is outside every registered seed set`);
  return bad;
}

/**
 * A run file's SHA-256 against the seed log (section 9): null when the log's finished entry for (phase, arm, seed[, round]) records exactly
 * this hash, otherwise the problem. The census series are stored in the file itself, so the log's hash is what stops an edited series.
 */
export function fileHashProblem(log: readonly SeedLogEntry[], phase: Phase, arm: string, seed: number, sha: string, round?: number): string | null {
  const entry = log.find((e) => e.phase === phase && e.arm === arm && e.seed === seed && e.state === "finished" && (round === undefined || e.round === round));
  const at = `${phase} ${arm} ${seed}`;
  if (!entry) return `${at}: the seed log has no finished entry for this run`;
  if (entry.fileSha256 === undefined) return `${at}: the seed log's finished entry has no fileSha256`;
  if (entry.fileSha256 !== sha) return `${at}: series.json (SHA-256 ${sha}) is not the file the run wrote (the seed log has ${entry.fileSha256})`;
  return null;
}

/** The confirm (arm, seed) pairs still to run, in the fixed order (arm major, seed ascending), given the log. */
export function pendingConfirm(log: readonly SeedLogEntry[], plan: PlanName): { arm: Arm; seed: number }[] {
  const done = new Set(log.filter((e) => e.phase === "confirm" && e.state === "finished").map((e) => `${e.arm}/${e.seed}`));
  return CONFIRM_ARMS.flatMap((arm) => PLANS[plan].confirm.map((seed) => ({ arm, seed }))).filter((p) => !done.has(`${p.arm}/${p.seed}`));
}

// ---- FROZEN ---------------------------------------------------------------------------------------------

/** The plan the timing figure implies (section 3): at least 1,800 aggregate steps per second the full plan, 1,200 to 1,799 the reduced plan, below that none (null: not started). */
export const planForTiming = (timing: number): PlanName | null => (timing >= R2B.TIMING_FULL ? "full" : timing >= R2B.TIMING_REDUCED ? "reduced" : null);

/**
 * Lines of FROZEN beyond the hashes (section 3 and 10): `plan: full|reduced` and `timing_steps_per_second: <number>`. Returns what it finds
 * and the keys that appear more than once (a repeated line is a problem, never an override: the last-line-wins reading let a plan be appended
 * after the dev results were seen).
 */
export function parseFrozenExtras(text: string): { plan: PlanName | null; timing: number | null; duplicates: string[] } {
  let plan: PlanName | null = null, timing: number | null = null;
  const duplicates: string[] = [];
  let np = 0, nt = 0;
  for (const line of text.split("\n")) {
    const p = /^\s*plan\s*:\s*(full|reduced)\s*$/.exec(line);
    if (p) { plan = p[1] as PlanName; if (++np === 2) duplicates.push("plan"); }
    else if (/^\s*plan\s*:/.test(line)) duplicates.push("plan (malformed line)");
    const t = /^\s*timing_steps_per_second\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*$/.exec(line);
    if (t) { timing = Number(t[1]); if (++nt === 2) duplicates.push("timing_steps_per_second"); }
    else if (/^\s*timing_steps_per_second\s*:/.test(line)) duplicates.push("timing_steps_per_second (malformed line)");
  }
  return { plan, timing, duplicates };
}

export interface ProtocolRecord { plan: PlanName | null; timing: number | null; duplicates: string[] }

/**
 * The Freeze 1 record inside PROTOCOL.md, so the plan and the timing figure are covered by protocol_sha256: the lines between
 * `<!-- FREEZE-1-RECORD -->` and `<!-- /FREEZE-1-RECORD -->`, in the format of FROZEN's lines. null when the block is absent.
 */
export function parseProtocolRecord(protocolText: string): ProtocolRecord | null {
  const m = /<!-- FREEZE-1-RECORD -->([\s\S]*?)<!-- \/FREEZE-1-RECORD -->/.exec(protocolText);
  return m ? parseFrozenExtras(m[1]) : null;
}

export interface FreezeHashesR2b extends FreezeHashes {
  /** The plan and timing figure PROTOCOL.md itself records (null: the block is missing). */
  record: ProtocolRecord | null;
}

/**
 * Problems that stop a run (empty = frozen as required). Freeze 1 (dev, match, and confirm too) needs the protocol hash, the code hash,
 * every per-file line and the plan. The plan and the timing figure must also stand in PROTOCOL.md's record (so they are hashed), be
 * stated once each, and agree with the 1,800 / 1,200 mapping. Freeze 2 (confirm) also needs calibration_sha256 matching CALIBRATION.json's
 * bytes. Smoke needs none.
 */
export function checkFrozen(phase: Phase, frozenText: string | null, actual: FreezeHashesR2b): string[] {
  if (phase === "smoke") return [];
  if (frozenText === null) return [phase === "confirm" ? "FROZEN does not exist; both freezes must be recorded before a confirmation run" : "FROZEN does not exist; Freeze 1 must be recorded before a dev or matching run"];
  const { keys: f, files, duplicates } = parseFrozen(frozenText);
  const bad: string[] = [];
  if (duplicates.length) bad.push(`FROZEN repeats ${duplicates.join(", ")}; a key or file may appear once (Freeze 2 only appends calibration_sha256)`);
  if (f.protocol_sha256 === undefined) bad.push("FROZEN has no protocol_sha256");
  else if (f.protocol_sha256 !== actual.protocol) bad.push("PROTOCOL.md differs from the hash in FROZEN");
  if (f.code_hash === undefined) bad.push("FROZEN has no code_hash");
  else if (f.code_hash !== actual.code) bad.push("the code differs from the code_hash in FROZEN");
  const changed = Object.keys(actual.files).filter((p) => files[p] !== undefined && files[p] !== actual.files[p]);
  const added = Object.keys(actual.files).filter((p) => files[p] === undefined);
  const gone = Object.keys(files).filter((p) => actual.files[p] === undefined);
  if (Object.keys(files).length === 0) bad.push("FROZEN lists no per-file hashes");
  else if (changed.length || added.length || gone.length) {
    bad.push(`files differ from FROZEN: ${[...changed.map((p) => `${p} changed`), ...added.map((p) => `${p} not listed`), ...gone.map((p) => `${p} missing`)].join(", ")}`);
  }
  const extras = parseFrozenExtras(frozenText);
  if (extras.duplicates.length) bad.push(`FROZEN repeats or malforms ${extras.duplicates.join(", ")}; the plan and the timing figure are stated once`);
  if (extras.plan === null) bad.push("FROZEN has no `plan: full` or `plan: reduced` line (the timing gate's choice)");
  if (extras.timing === null) bad.push("FROZEN has no timing_steps_per_second line");
  if (extras.timing !== null) {
    const implied = planForTiming(extras.timing);
    if (implied === null) bad.push(`the timing figure ${extras.timing} is below ${R2B.TIMING_REDUCED} steps per second: the protocol is not started and is redrafted`);
    else if (extras.plan !== null && extras.plan !== implied) bad.push(`FROZEN names the ${extras.plan} plan but the timing figure ${extras.timing} implies the ${implied} plan`);
  }
  if (actual.record === null) bad.push("PROTOCOL.md has no FREEZE-1-RECORD block, so the plan and the timing figure are not covered by protocol_sha256");
  else {
    if (actual.record.duplicates.length) bad.push(`PROTOCOL.md's FREEZE-1-RECORD repeats or malforms ${actual.record.duplicates.join(", ")}`);
    if (actual.record.plan === null || actual.record.timing === null) bad.push("PROTOCOL.md's FREEZE-1-RECORD has no valid plan and timing_steps_per_second lines");
    if (actual.record.plan !== extras.plan || actual.record.timing !== extras.timing) bad.push(`FROZEN's plan and timing (${extras.plan}, ${extras.timing}) differ from PROTOCOL.md's FREEZE-1-RECORD (${actual.record.plan}, ${actual.record.timing})`);
  }
  if (phase === "confirm") {
    if (f.calibration_sha256 === undefined) bad.push("FROZEN has no calibration_sha256 (Freeze 2 is missing)");
    else if (actual.calibration === null) bad.push("CALIBRATION.json does not exist");
    else if (f.calibration_sha256 !== actual.calibration) bad.push("CALIBRATION.json differs from the hash in FROZEN");
  }
  return bad;
}

/**
 * The calibration must have been made under the frozen protocol and code, with at least 2 kept readouts and a matched v, before the first
 * confirmation run (section 10). `cal` is CALIBRATION.json as parsed.
 */
export function checkCalibrationForConfirm(
  cal: { codeHash?: string | null; protocolSha256?: string | null; plan?: string; verdict?: string; kept?: string[]; physarum?: { v?: number | null } },
  frozen: { code_hash?: string; protocol_sha256?: string },
  plan: PlanName | null,
): string[] {
  const bad: string[] = [];
  if (!cal.codeHash || cal.codeHash !== frozen.code_hash) bad.push(`CALIBRATION.json was made under code ${cal.codeHash ?? "(none recorded)"}, FROZEN has ${frozen.code_hash}`);
  if (!cal.protocolSha256 || cal.protocolSha256 !== frozen.protocol_sha256) bad.push(`CALIBRATION.json was made under protocol ${cal.protocolSha256 ?? "(none recorded)"}, FROZEN has ${frozen.protocol_sha256}`);
  if (plan !== null && cal.plan !== plan) bad.push(`CALIBRATION.json was made under the ${cal.plan ?? "(no)"} plan, FROZEN has ${plan}`);
  if (cal.verdict === "MEASUREMENT-LIMITED") bad.push("the calibration verdict is MEASUREMENT-LIMITED; confirmation is not run");
  if (!Array.isArray(cal.kept) || cal.kept.length < 2) bad.push(`CALIBRATION.json keeps fewer than 2 readouts (${cal.kept?.length ?? 0})`);
  else if (!passAttainable(cal.kept as ReadoutId[])) bad.push(`CALIBRATION.json's kept set (${cal.kept.join(", ")}) cannot make a PASS: it needs TM or REG, and MI`);
  if (!Number.isInteger(cal.physarum?.v)) bad.push("CALIBRATION.json has no matched physarumDeposit v");
  return bad;
}

/** The provenance chain: every run file's codeHash and the calibration's must equal FROZEN's. Empty = one implementation throughout. */
export function checkProvenance(frozenCode: string, calibrationCode: string | null | undefined, runHashes: readonly { path: string; codeHash: string | null }[]): string[] {
  const bad: string[] = [];
  if (calibrationCode !== undefined && calibrationCode !== frozenCode) bad.push(`CALIBRATION.json was made under code ${calibrationCode ?? "(none recorded)"}, FROZEN has ${frozenCode}`);
  const off = runHashes.filter((r) => r.codeHash !== frozenCode);
  if (off.length) bad.push(`${off.length} run file(s) were not run under the frozen code (first: ${off[0].path} has ${off[0].codeHash ?? "no code hash"})`);
  return bad;
}

// ---- the code manifest ----------------------------------------------------------------------------------

/** The relative `./x.ts` modules a source text imports or re-exports from (static `from "./x.ts"` clauses and bare `import "./x.ts"`). Pure. */
export function localImports(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;"']*?\bfrom\s*["'](\.{1,2}\/[^"']+\.ts)["']/g)) out.add(m[1]);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["'](\.{1,2}\/[^"']+\.ts)["']/g)) out.add(m[1]);
  return [...out];
}

/** The modules the R2b runner, freeze tool and analysis start from; code_hash covers their import closure under tools/mycelium (section 10). */
export const R2B_ENTRY_FILES: readonly string[] = ["tools/mycelium/r2b.ts", "tools/mycelium/r2b-analyze.ts", "tools/mycelium/r2b-freeze.ts"];
