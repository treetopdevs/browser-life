// Mycelium rung R3: the protocol's constants, arms, run gate and freeze checks as pure functions
// (docs/mycelium-r3-2026-11-13/PROTOCOL.md). No Deno, no file system, no clock: r3.ts, r3-analyze.ts and r3-freeze.ts are thin wrappers and
// vitest tests this module directly. The decision rules are in r3-decide.ts.
import { defaultConfig, type MyceliumConfig } from "./world.ts";
import { localImports, manifestText, parseFrozen } from "./r2b-protocol.ts";
import {
  NOT_R3_SLOTS, R2B_EMBARGOED_SLOTS, R3_ARM_OFFSET, R3_CONFIRM_ARMS, R3_CONFIRM_SLOTS, R3_DEV_ARMS, R3_DEV_SLOTS, R3_SMOKE_SLOTS, type R3Arm, worldSeed,
} from "./r3-seeds.ts";

export { localImports, manifestText, parseFrozen, worldSeed };
export type { R3Arm };

export const PROTOCOL_ID = "mycelium-r3";

/** The protocol's numbers (section numbers refer to PROTOCOL.md). */
export const R3 = {
  /** Run length (section 3) and the census cadence, both as R2b's. */
  STEPS: 100_000,
  SCALAR_EVERY: 100,
  HEAVY_EVERY: 500,
  /** Early window E = (E_LO, E_HI] and late window L = (L_LO, STEPS] (section 4). */
  E_LO: 0,
  E_HI: 5_000,
  L_LO: 50_000,
  /** Population guard (section 7): n below this at any scalar census of either window. */
  GUARD_MIN_N: 200,
  ALPHA: 0.05,
  /** Effect-size floors (section 6): |Cliff's delta| for D1 and D2, |Jonckheere-Terpstra tau| for D3, Cliff's delta for the TM concordance. */
  DELTA_FLOOR: 0.5,
  TAU_FLOOR: 0.25,
  TM_CONCORD: 0.33,
  /** Fixed-key Monte Carlo permutation count of the D3 trend test; the Mann-Whitney tests use r2b-stats' default (1,000,000). */
  TREND_PERMS: 1_000_000,
  /** PRNG key of the trend permutations (ASCII "r3jt"). */
  TREND_KEY: 0x72336a74,
  /** The costs of the dose arms, in increasing order (section 5). */
  COSTS: [1, 2, 4] as const,
} as const;

// ---- arms -------------------------------------------------------------------------------------------------

export const R3_ARMS: readonly R3Arm[] = R3_CONFIRM_ARMS;
export const isR3Arm = (a: string): a is R3Arm => (R3_ARMS as readonly string[]).includes(a);

/** Config deltas on top of defaultConfig() (section 2). Only existing keys; defaultConfig() itself is unchanged. */
export const ARM_DELTA: Record<R3Arm, Partial<MyceliumConfig>> = {
  inherit: {},
  blocked: { heredity: "blocked" },
  frozen: { heredity: "frozen" },
  "inherit-c1": { depositCost: 1 },
  "inherit-c4": { depositCost: 4 },
  "blocked-c1": { heredity: "blocked", depositCost: 1 },
  "blocked-c4": { heredity: "blocked", depositCost: 4 },
};

/** The deposit cost an arm runs at (default 2) and its heredity family. */
export const armCost = (arm: R3Arm): number => ARM_DELTA[arm].depositCost ?? 2;
export const armHeredity = (arm: R3Arm): "inherit" | "blocked" | "frozen" => ARM_DELTA[arm].heredity ?? "inherit";

/** defaultConfig() plus the arm's delta; `slot` is the registered slot and the world seed is slot + the arm's offset. */
export function armConfig(arm: R3Arm, slot: number): MyceliumConfig {
  return defaultConfig({ ...ARM_DELTA[arm], seed: worldSeed(arm, slot) });
}

// ---- the run gate -----------------------------------------------------------------------------------------

export type Phase = "smoke" | "dev" | "confirm" | "cpu-check";

export interface SeedLogEntry {
  phase: Phase;
  arm: string;
  /** The registered slot (not the world seed). */
  seed: number;
  steps: number;
  state: "started" | "finished" | "invalid";
  fileSha256?: string;
}

export interface RunRequest { phase: Phase; arm: string; seed: number; steps: number; seriesExists?: boolean }

const isDevSlot = (s: number) => R3_DEV_SLOTS.includes(s);
const isConfirmSlot = (s: number) => R3_CONFIRM_SLOTS.includes(s);

/** Problems with the log itself, which stop every logged phase (empty = clean). */
export function logProblems(log: readonly SeedLogEntry[]): string[] {
  const bad: string[] = [];
  const unreg = log.filter((e) => !(isDevSlot(e.seed) || isConfirmSlot(e.seed)));
  if (unreg.length) bad.push(`the seed log holds a slot outside the registered sets (${unreg.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")})`);
  const leaked = log.filter((e) => isConfirmSlot(e.seed) && e.phase !== "confirm" && e.phase !== "cpu-check");
  if (leaked.length) bad.push(`the seed log holds a confirmation slot outside the confirm phases (${leaked.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")}); the embargo is broken and the protocol stops`);
  // Transitions: a run is finished at most once and never without a started entry (a crash may leave an extra started entry, which is allowed).
  const key = (e: SeedLogEntry) => `${e.phase}/${e.arm}/${e.seed}`;
  const fin = new Map<string, number>(), started = new Set<string>();
  for (const e of log) { if (e.state === "finished") fin.set(key(e), (fin.get(key(e)) ?? 0) + 1); else if (e.state === "started") started.add(key(e)); }
  const twice = [...fin].filter(([, n]) => n > 1).map(([k]) => k);
  if (twice.length) bad.push(`the seed log holds more than one finished entry for ${twice.join(", ")}; a run is never repeated`);
  const orphan = [...fin.keys()].filter((k) => !started.has(k));
  if (orphan.length) bad.push(`the seed log holds a finished entry with no started entry for ${orphan.join(", ")}`);
  const inv = log.filter((e) => e.state === "invalid");
  if (inv.length) bad.push(`the seed log holds an invalid run (${inv.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")}); the protocol stops`);
  return bad;
}

/**
 * Why a run may not start (empty = allowed). Smoke takes slots 1-100 (unlogged, never analysed). dev runs the five new arms on slots 2001-2010
 * at 100,000 steps. confirm runs the seven arms on slots 6001-6016 at 100,000 steps, never twice. cpu-check re-runs a finished dev-arm or
 * confirmation run on the CPU. R2b's embargoed slots 5001-5016 and the reserved 8001-8099 are refused in every phase.
 */
export function gateRun(req: RunRequest, log: readonly SeedLogEntry[]): string[] {
  const bad: string[] = [];
  const { phase, arm, seed, steps } = req;
  if (!Number.isInteger(seed) || seed < 0) bad.push("seed must be a non-negative integer");
  if (!isR3Arm(arm)) bad.push(`unknown arm ${arm}`);
  if (R2B_EMBARGOED_SLOTS.includes(seed)) bad.push(`slot ${seed} is R2b's embargoed confirmation slot; R3 never uses it`);
  if (NOT_R3_SLOTS.includes(seed)) bad.push(`slot ${seed} is in 8001-8099, which belongs to another exploration`);
  if (phase !== "smoke") bad.push(...logProblems(log));
  switch (phase) {
    case "smoke":
      if (!R3_SMOKE_SLOTS.includes(seed)) bad.push("smoke runs slots 1-100 only");
      if (!Number.isInteger(steps) || steps < 1000 || steps % 1000 !== 0 || steps > R3.STEPS) bad.push("a smoke run needs a step count that is a multiple of 1000, from 1000 to 100000");
      break;
    case "dev":
      if (!(R3_DEV_ARMS as readonly string[]).includes(arm)) bad.push(`dev runs ${R3_DEV_ARMS.join(", ")} only (inherit and blocked at the default cost reuse R2b's dev series)`);
      if (!isDevSlot(seed)) bad.push(`dev runs slots ${R3_DEV_SLOTS[0]}-${R3_DEV_SLOTS.at(-1)} only (got ${seed})`);
      if (steps !== R3.STEPS) bad.push(`dev runs ${R3.STEPS} steps`);
      break;
    case "confirm": {
      if (!(R3_CONFIRM_ARMS as readonly string[]).includes(arm)) bad.push("confirm runs the seven registered arms only");
      if (!isConfirmSlot(seed)) bad.push(`confirm runs slots ${R3_CONFIRM_SLOTS[0]}-${R3_CONFIRM_SLOTS.at(-1)} only (got ${seed})`);
      if (steps !== R3.STEPS) bad.push(`confirm runs ${R3.STEPS} steps`);
      const mine = log.filter((e) => e.phase === "confirm" && e.arm === arm && e.seed === seed);
      if (mine.some((e) => e.state === "finished")) bad.push(`(${arm}, ${seed}) is already finished in the seed log; a confirmation run is never repeated`);
      else if (mine.length && req.seriesExists) bad.push(`(${arm}, ${seed}) has a series.json but no finished entry; inspect it by hand, it is not run again`);
      break;
    }
    case "cpu-check":
      if (!((isDevSlot(seed) && (R3_DEV_ARMS as readonly string[]).includes(arm)) || isConfirmSlot(seed))) bad.push("cpu-check re-runs a dev-arm run or a confirmation run only");
      break;
    default:
      bad.push(`unknown phase ${phase as string}`);
  }
  if (phase !== "smoke" && !isDevSlot(seed) && !isConfirmSlot(seed)) bad.push(`slot ${seed} is outside every registered slot set`);
  return bad;
}

/** A run file's SHA-256 against the seed log: null when the finished entry records exactly this hash, otherwise the problem. */
export function fileHashProblem(log: readonly SeedLogEntry[], phase: Phase, arm: string, seed: number, sha: string): string | null {
  const entry = log.find((e) => e.phase === phase && e.arm === arm && e.seed === seed && e.state === "finished");
  const at = `${phase} ${arm} ${seed}`;
  if (!entry) return `${at}: the seed log has no finished entry for this run`;
  if (entry.fileSha256 === undefined) return `${at}: the seed log's finished entry has no fileSha256`;
  if (entry.fileSha256 !== sha) return `${at}: series.json (SHA-256 ${sha}) is not the file the run wrote (the seed log has ${entry.fileSha256})`;
  return null;
}

/**
 * The CPU cross-check as an acceptance gate (section 3): at least one finished cpu-check entry in the seed log for a run of the phase (dev: a dev-arm run on
 * slots 2001-2010; confirm: a confirmation slot), whose cpu-check.json says the CPU and GPU digests are equal, whose gpuDigest is the run file's digest, and
 * whose codeHash is the frozen one. `checks` are the cpu-check.json contents read by the caller, keyed "arm/slot", with the digest and code hash of the run file.
 */
export function cpuCheckProblems(
  phase: "dev" | "confirm", log: readonly SeedLogEntry[], code: string,
  checks: Record<string, { equal?: boolean; gpuDigest?: string; codeHash?: string; runDigest?: string } | null>,
): string[] {
  const done = log.filter((e) => e.phase === "cpu-check" && e.state === "finished" && (phase === "confirm" ? isConfirmSlot(e.seed) : isDevSlot(e.seed)));
  if (done.length === 0) return [`no finished cpu-check for a ${phase} run in the seed log (the full-horizon CPU cross-check of one ${phase} run is required)`];
  const ok = done.some((e) => {
    const c = checks[`${e.arm}/${e.seed}`];
    return !!c && c.equal === true && c.gpuDigest !== undefined && c.gpuDigest === c.runDigest && c.codeHash === code;
  });
  return ok ? [] : [`no cpu-check for a ${phase} run has equal digests, the run file's digest and the frozen code hash (${done.map((e) => `${e.arm}/${e.seed}`).join(", ")})`];
}

/** The confirm (arm, slot) pairs still to run, in the fixed order (arm major, slot ascending), given the log. */
export function pendingConfirm(log: readonly SeedLogEntry[]): { arm: R3Arm; seed: number }[] {
  const done = new Set(log.filter((e) => e.phase === "confirm" && e.state === "finished").map((e) => `${e.arm}/${e.seed}`));
  return R3_CONFIRM_ARMS.flatMap((arm) => R3_CONFIRM_SLOTS.map((seed) => ({ arm, seed }))).filter((p) => !done.has(`${p.arm}/${p.seed}`));
}

// ---- FROZEN -------------------------------------------------------------------------------------------------

/** The modules the R3 runner, freeze tool and analysis start from; code_hash covers their import closure under tools/mycelium (section 9). */
export const R3_ENTRY_FILES: readonly string[] = ["tools/mycelium/r3.ts", "tools/mycelium/r3-analyze.ts", "tools/mycelium/r3-freeze.ts"];

export interface FreezeHashesR3 {
  protocol: string;
  code: string;
  files: Record<string, string>;
  calibration: string | null;
}

/**
 * Problems that stop a run (empty = frozen as required). Freeze 1 (dev, and confirm too) needs the protocol hash, the code hash and every per-file
 * line, each once. Freeze 2 (confirm) also needs calibration_sha256 matching CALIBRATION.json's bytes.
 */
export function checkFrozen(phase: Phase, frozenText: string | null, actual: FreezeHashesR3): string[] {
  if (phase === "smoke") return [];
  if (frozenText === null) return [phase === "confirm" ? "FROZEN does not exist; both freezes must be recorded before a confirmation run" : "FROZEN does not exist; Freeze 1 must be recorded before a dev run"];
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
  if (phase === "confirm") {
    if (f.calibration_sha256 === undefined) bad.push("FROZEN has no calibration_sha256 (Freeze 2 is missing)");
    else if (actual.calibration === null) bad.push("CALIBRATION.json does not exist");
    else if (f.calibration_sha256 !== actual.calibration) bad.push("CALIBRATION.json differs from the hash in FROZEN");
  }
  return bad;
}

/** The calibration must have been made under the frozen protocol and code, with verdict READY, before the first confirmation run. */
export function checkCalibrationForConfirm(cal: { codeHash?: string | null; protocolSha256?: string | null; verdict?: string; reasons?: string[] }, frozen: { code_hash?: string; protocol_sha256?: string }): string[] {
  const bad: string[] = [];
  if (!cal.codeHash || cal.codeHash !== frozen.code_hash) bad.push(`CALIBRATION.json was made under code ${cal.codeHash ?? "(none recorded)"}, FROZEN has ${frozen.code_hash}`);
  if (!cal.protocolSha256 || cal.protocolSha256 !== frozen.protocol_sha256) bad.push(`CALIBRATION.json was made under protocol ${cal.protocolSha256 ?? "(none recorded)"}, FROZEN has ${frozen.protocol_sha256}`);
  if (cal.verdict !== "READY") bad.push(`the calibration verdict is ${cal.verdict ?? "missing"}, not READY; confirmation is not run${cal.reasons?.length ? ` (${cal.reasons.join("; ")})` : ""}`);
  return bad;
}
