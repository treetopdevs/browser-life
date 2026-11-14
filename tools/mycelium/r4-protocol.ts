// Mycelium rung R4: the protocol's constants, arms, run gate and freeze checks as pure functions
// (docs/mycelium-r4-2026-11-14/PROTOCOL.md). No Deno, no file system, no clock: r4.ts, r4-analyze.ts and r4-freeze.ts are thin wrappers and
// vitest tests this module directly. The decision rules are in r4-decide.ts. Adapted from r3-protocol.ts (the R3 template).
import { defaultConfig, type MyceliumConfig } from "./world.ts";
import { localImports, manifestText, parseFrozen } from "./r2b-protocol.ts";
import { R4_ARM_OFFSET, R4_ARMS, R4_CONFIRM_SLOTS, R4_DEV_SLOTS, R4_SMOKE_SLOTS, type R4Arm, worldSeed } from "./r4-seeds.ts";

export { localImports, manifestText, parseFrozen, worldSeed };
export type { R4Arm };

export const PROTOCOL_ID = "mycelium-r4";

/** The protocol's numbers (section numbers refer to PROTOCOL.md). */
export const R4 = {
  /** Run length and the census cadence, both as R2b's and R3's. */
  STEPS: 100_000,
  SCALAR_EVERY: 100,
  HEAVY_EVERY: 500,
  /** The late window L = (L_LO, STEPS] carries every decision; the mid window M = (M_LO, M_HI] is descriptive (section 4). */
  L_LO: 50_000,
  M_LO: 10_000,
  M_HI: 20_000,
  /** Population guard (section 7): n below this at any scalar census of the late window. */
  GUARD_MIN_N: 200,
  ALPHA: 0.05,
  /** Rank-effect floor for a SUPPORT (|Cliff's delta|). */
  DELTA_FLOOR: 0.5,
  /** The margin is this fraction of the dev anchor span (physarum minus blind) of the same readout, fixed at calibration (section 6). */
  THETA: 0.15,
  /** A shift or interval end must exceed this fraction of the margin to count as a detected trace (below it, a difference is EQUIV, not SMALL or WRONG): the random baseline of dependence is not use. */
  DETECT: 0.25,
  /** Anchor validity (section 6, gate G): physarum above blind with this Cliff's delta on ALIGN and OCC, and spans at least these. */
  ANCHOR_DELTA: 0.9,
  ANCHOR_MIN_SPAN_ALIGN: 0.5,
  ANCHOR_MIN_SPAN_OCC: 1.0,
  ANCHOR_MIN_ACUTE: 0.5,
  /** A run is in the toll state when its late trail per particle is at least this; gate S needs MIN_IN_STATE such runs in each of inherit, blind and physarum. */
  IN_STATE_TM: 10,
  MIN_IN_STATE: 8,
  /** The floor (section 6): inherit's medians of req1 (at least), req2p (at most) and sat (at least). */
  FLOOR_REQ1: 0.8,
  FLOOR_REQ2P: 0.1,
  FLOOR_SAT: 0.9,
  /** The matched physarum deposit v (1/256 matter per particle-step) and the band its realised late d must keep against inherit's (calibration gate MATCH). */
  PHYSARUM_V: 256,
  MATCH_BAND: 0.10,
  /** Bootstrap resamples for the equivalence intervals (confirmation); calibration uses fewer. */
  BOOTS: 10_000,
  /** PRNG key of the one-sample bootstrap (ASCII "r4bs"). */
  BOOT_KEY1: 0x72346273,
} as const;

// ---- arms -------------------------------------------------------------------------------------------------

export const isR4Arm = (a: string): a is R4Arm => (R4_ARMS as readonly string[]).includes(a);

/** The toll rule at moveCost 12 and strength 64 (the screen's smallest strength at which all four inherit seeds kept the trail). */
const TOLL: Partial<MyceliumConfig> = { moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" };

/** Config deltas on top of defaultConfig() (section 2). Only existing keys; defaultConfig() itself is unchanged. */
export const ARM_DELTA: Record<R4Arm, Partial<MyceliumConfig>> = {
  inherit: { ...TOLL },
  blocked: { ...TOLL, heredity: "blocked" },
  physarum: { ...TOLL, heredity: "frozen", controller: "physarum", physarumDeposit: R4.PHYSARUM_V },
  blind: { ...TOLL, blindTrailGradient: true },
  keyless: { moveCost: 12 },
};

/** defaultConfig() plus the arm's delta; `slot` is the registered slot and the world seed is slot + the arm's offset. */
export function armConfig(arm: R4Arm, slot: number): MyceliumConfig {
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
  /** A finished cpu-check entry records the CPU digest here. */
  digest?: string;
}

export interface RunRequest { phase: Phase; arm: string; seed: number; steps: number; seriesExists?: boolean }

const isDevSlot = (s: number) => R4_DEV_SLOTS.includes(s);
const isConfirmSlot = (s: number) => R4_CONFIRM_SLOTS.includes(s);

/** Problems with the log itself, which stop every logged phase (empty = clean). */
export function logProblems(log: readonly SeedLogEntry[]): string[] {
  const bad: string[] = [];
  const unreg = log.filter((e) => !(isDevSlot(e.seed) || isConfirmSlot(e.seed)));
  if (unreg.length) bad.push(`the seed log holds a slot outside the registered sets (${unreg.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")})`);
  const leaked = log.filter((e) => isConfirmSlot(e.seed) && e.phase !== "confirm" && e.phase !== "cpu-check");
  if (leaked.length) bad.push(`the seed log holds a confirmation slot outside the confirm phases (${leaked.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")}); the embargo is broken and the protocol stops`);
  // Schema: every entry names a registered arm, a known phase and state, and a step count.
  const schema = log.filter((e) => !isR4Arm(e.arm) || !["smoke", "dev", "confirm", "cpu-check"].includes(e.phase) || !["started", "finished", "invalid"].includes(e.state) || e.steps !== R4.STEPS);
  if (schema.length) bad.push(`the seed log holds an entry with an unknown arm, phase, state or step count (${schema.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")})`);
  // Transitions in order: a run is finished at most once, only after a started entry, and nothing starts after it finished (a crash may leave an extra started entry
  // before the finish, which is allowed). A finished entry carries its completion fields: a file hash and digest for a run, a digest for a cpu-check.
  const key = (e: SeedLogEntry) => `${e.phase}/${e.arm}/${e.seed}`;
  const fin = new Map<string, number>(), started = new Set<string>(), orphan: string[] = [], restarted: string[] = [], incomplete: string[] = [];
  for (const e of log) {
    if (e.state === "started") { if (fin.has(key(e))) restarted.push(key(e)); started.add(key(e)); }
    else if (e.state === "finished") {
      fin.set(key(e), (fin.get(key(e)) ?? 0) + 1);
      if (!started.has(key(e))) orphan.push(key(e));
      const needHash = e.phase === "dev" || e.phase === "confirm";
      if ((needHash && typeof e.fileSha256 !== "string") || ((needHash || e.phase === "cpu-check") && typeof e.digest !== "string")) incomplete.push(key(e));
    }
  }
  if (restarted.length) bad.push(`the seed log holds a started entry after a finished one for ${restarted.join(", ")}`);
  if (incomplete.length) bad.push(`the seed log holds a finished entry without its file hash or digest for ${incomplete.join(", ")}`);
  const twice = [...fin].filter(([, n]) => n > 1).map(([k]) => k);
  if (twice.length) bad.push(`the seed log holds more than one finished entry for ${twice.join(", ")}; a run is never repeated`);
  if (orphan.length) bad.push(`the seed log holds a finished entry with no earlier started entry for ${orphan.join(", ")}`);
  const smoke = log.filter((e) => e.phase === "smoke");
  if (smoke.length) bad.push(`the seed log holds a smoke entry (${smoke.map((e) => `${e.arm} ${e.seed}`).join(", ")}); smoke runs are never logged`);
  const wrongPhase = log.filter((e) => (e.phase === "confirm" && !isConfirmSlot(e.seed)) || (e.phase === "dev" && !isDevSlot(e.seed)));
  if (wrongPhase.length) bad.push(`the seed log holds a run in the wrong phase for its slot (${wrongPhase.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")})`);
  const inv = log.filter((e) => e.state === "invalid");
  if (inv.length) bad.push(`the seed log holds an invalid run (${inv.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")}); the protocol stops`);
  return bad;
}

/**
 * Why a run may not start (empty = allowed). Smoke takes slots 1-100 (unlogged shaping runs, never analysed). dev runs the five arms on slots 8001-8020
 * at 100,000 steps. confirm runs the five arms on slots 7001-7016 at 100,000 steps, never twice. cpu-check re-runs a finished dev or confirmation
 * run on the CPU. Every slot outside these sets is refused (R2b's embargoed 5001-5016 included).
 */
export function gateRun(req: RunRequest, log: readonly SeedLogEntry[]): string[] {
  const bad: string[] = [];
  const { phase, arm, seed, steps } = req;
  if (!Number.isInteger(seed) || seed < 0) bad.push("seed must be a non-negative integer");
  if (!isR4Arm(arm)) bad.push(`unknown arm ${arm}`);
  if (phase !== "smoke") bad.push(...logProblems(log));
  switch (phase) {
    case "smoke":
      if (!R4_SMOKE_SLOTS.includes(seed)) bad.push("smoke runs slots 1-100 only");
      if (!Number.isInteger(steps) || steps < 1000 || steps % 1000 !== 0 || steps > R4.STEPS) bad.push("a smoke run needs a step count that is a multiple of 1000, from 1000 to 100000");
      break;
    case "dev": {
      if (!isDevSlot(seed)) bad.push(`dev runs slots ${R4_DEV_SLOTS[0]}-${R4_DEV_SLOTS.at(-1)} only (got ${seed})`);
      if (steps !== R4.STEPS) bad.push(`dev runs ${R4.STEPS} steps`);
      const mine = log.filter((e) => e.phase === "dev" && e.arm === arm && e.seed === seed);
      if (mine.some((e) => e.state === "finished")) bad.push(`(${arm}, ${seed}) is already finished in the seed log; a dev run is never repeated`);
      else if (req.seriesExists) bad.push(`(${arm}, ${seed}) has a series.json but no finished entry; inspect it by hand, it is not run again`);
      break;
    }
    case "confirm": {
      if (!isConfirmSlot(seed)) bad.push(`confirm runs slots ${R4_CONFIRM_SLOTS[0]}-${R4_CONFIRM_SLOTS.at(-1)} only (got ${seed})`);
      if (steps !== R4.STEPS) bad.push(`confirm runs ${R4.STEPS} steps`);
      const mine = log.filter((e) => e.phase === "confirm" && e.arm === arm && e.seed === seed);
      if (mine.some((e) => e.state === "finished")) bad.push(`(${arm}, ${seed}) is already finished in the seed log; a confirmation run is never repeated`);
      else if (req.seriesExists) bad.push(`(${arm}, ${seed}) has a series.json but no finished entry; inspect it by hand, it is not run again`);
      break;
    }
    case "cpu-check": {
      if (!(isDevSlot(seed) || isConfirmSlot(seed))) bad.push("cpu-check re-runs a dev-arm run or a confirmation run only");
      const runPhase = isConfirmSlot(seed) ? "confirm" : "dev";
      if (!log.some((e) => e.phase === runPhase && e.arm === arm && e.seed === seed && e.state === "finished")) bad.push(`(${arm}, ${seed}) has no finished ${runPhase} entry in the seed log; cpu-check re-runs a finished run`);
      if (log.some((e) => e.phase === "cpu-check" && e.arm === arm && e.seed === seed && e.state === "finished")) bad.push(`(${arm}, ${seed}) already has a finished cpu-check in the seed log; the cross-check is done once`);
      break;
    }
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

/** What a cpu-check.json holds, with the digest of the run file it re-ran, read by the caller. */
export interface CpuCheckFile { equal?: boolean; cpuDigest?: string; gpuDigest?: string; runDigest?: string; codeHash?: string; steps?: number }

/**
 * The CPU cross-check as an acceptance gate (section 3). A check qualifies when its log entry is finished (phase cpu-check, a slot of the phase), the log entry's digest
 * equals the cpu-check.json CPU digest, the GPU digest and the run file's digest, the files say `equal`, the check ran the full 100,000 steps and the frozen code hash.
 * Dev needs at least one qualifying check on a physarum run and one on a run of another arm (the two controller paths); confirm needs at least one on any arm.
 * `checks` is keyed "arm/slot".
 */
export function cpuCheckProblems(phase: "dev" | "confirm", log: readonly SeedLogEntry[], code: string, checks: Record<string, CpuCheckFile | null>): string[] {
  const done = log.filter((e) => e.phase === "cpu-check" && e.state === "finished" && (phase === "confirm" ? isConfirmSlot(e.seed) : isDevSlot(e.seed)));
  if (done.length === 0) return [`no finished cpu-check for a ${phase} run in the seed log (the full-horizon CPU cross-check of a ${phase} run is required)`];
  const ok = done.filter((e) => {
    const c = checks[`${e.arm}/${e.seed}`];
    return !!c && c.equal === true && e.steps === R4.STEPS && c.steps === R4.STEPS && c.cpuDigest !== undefined && c.cpuDigest === c.gpuDigest && c.gpuDigest === c.runDigest && e.digest === c.cpuDigest && c.codeHash === code;
  });
  const names = done.map((e) => `${e.arm}/${e.seed}`).join(", ");
  if (ok.length === 0) return [`no cpu-check for a ${phase} run has equal CPU, GPU, run-file and logged digests at the full horizon under the frozen code hash (${names})`];
  if (phase === "dev") {
    const bad: string[] = [];
    if (!ok.some((e) => e.arm === "physarum")) bad.push("no qualifying dev cpu-check on a physarum run (the fixed-rule controller path)");
    if (!ok.some((e) => e.arm !== "physarum")) bad.push("no qualifying dev cpu-check on a neural-controller run");
    return bad;
  }
  return [];
}

/** The confirm (arm, slot) pairs still to run, in the fixed order (arm major, slot ascending), given the log. */
export function pendingConfirm(log: readonly SeedLogEntry[]): { arm: R4Arm; seed: number }[] {
  const done = new Set(log.filter((e) => e.phase === "confirm" && e.state === "finished").map((e) => `${e.arm}/${e.seed}`));
  return R4_ARMS.flatMap((arm) => R4_CONFIRM_SLOTS.map((seed) => ({ arm, seed }))).filter((p) => !done.has(`${p.arm}/${p.seed}`));
}

// ---- the kernel ---------------------------------------------------------------------------------------------

/** SHA-256 of the kernel files at commit e5b43f69 (the trail-use rule on top of R3's eef9c043). R4 runs on exactly this kernel (PROTOCOL.md section 9). */
export const KERNEL_SHA256: Record<string, string> = {
  "tools/mycelium/world.ts": "42f4bade799f82eee5df2c5bed410dede03e721348d8ffc32c62584f35c80242",
  "tools/mycelium/gpu.ts": "09126acfdf1614df9c6b5adaae6345e94a452bf5fb5375285ade7a962e512330",
};

/** Problems with the kernel files against the e5b43f69 hashes (empty = unchanged). `files` is the manifest's path -> SHA-256 map. */
export function kernelProblems(files: Record<string, string>): string[] {
  return Object.entries(KERNEL_SHA256).flatMap(([p, h]) => (files[p] === h ? [] : [`${p} differs from the e5b43f69 kernel (${files[p] ?? "missing"}, expected ${h})`]));
}

// ---- FROZEN -------------------------------------------------------------------------------------------------

/** The modules the R4 runner, freeze tool and analysis start from; code_hash covers their import closure under tools/mycelium (section 9). */
export const R4_ENTRY_FILES: readonly string[] = ["tools/mycelium/r4.ts", "tools/mycelium/r4-analyze.ts", "tools/mycelium/r4-freeze.ts"];

export interface FreezeHashesR4 {
  protocol: string;
  code: string;
  files: Record<string, string>;
  calibration: string | null;
}

/**
 * Problems that stop a run (empty = frozen as required). Freeze 1 (dev, and confirm too) needs the protocol hash, the code hash and every per-file
 * line, each once. Freeze 2 (confirm) also needs calibration_sha256 matching CALIBRATION.json's bytes.
 */
export function checkFrozen(phase: Phase, frozenText: string | null, actual: FreezeHashesR4): string[] {
  if (phase === "smoke") return [];
  if (frozenText === null) return [phase === "confirm" ? "FROZEN does not exist; both freezes must be recorded before a confirmation run" : "FROZEN does not exist; Freeze 1 must be recorded before a dev run"];
  const { keys: f, files, duplicates } = parseFrozen(frozenText);
  const bad: string[] = [...kernelProblems(actual.files)];
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

/**
 * Everything a confirmation needs from CALIBRATION.json before anything runs or is read: READY under the frozen code and protocol (checkCalibrationForConfirm) and four
 * positive, finite margins. Used by the runner's preflight, the analysis and Freeze 2.
 */
export function calibrationProblems(cal: { codeHash?: string | null; protocolSha256?: string | null; verdict?: string; reasons?: string[]; margins?: object } | null, frozen: { code_hash?: string; protocol_sha256?: string }): string[] {
  if (!cal) return ["CALIBRATION.json cannot be read"];
  const bad = checkCalibrationForConfirm(cal, frozen);
  const m = cal.margins as Record<string, unknown> | undefined;
  if (!m || !["align", "occ", "acute", "sens"].every((k) => typeof m[k] === "number" && Number.isFinite(m[k] as number) && (m[k] as number) > 0)) bad.push("CALIBRATION.json holds no usable margins (align, occ, acute and sens must be positive and finite)");
  return bad;
}
