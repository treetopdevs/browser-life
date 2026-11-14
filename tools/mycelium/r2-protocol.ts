// Mycelium rung R2: the protocol's decisions as pure functions (docs/mycelium-r2-2026-11-13/PROTOCOL.md).
//
// Arm configs, the run gate (phases, seeds, the seed log), the FROZEN file check, calibration (noise
// floors, positive controls, the kept set) and the confirmation verdict. No Deno, no file system, no
// clock: tools/mycelium/r2.ts and r2-analyze.ts are thin wrappers, and vitest tests this module directly.
import { defaultConfig, type MyceliumConfig } from "./world.ts";
import { READOUT_IDS, type ReadoutId, type Readouts, R2 } from "./observe.ts";

// ---- arms and seeds ------------------------------------------------------------------------------------

export const ARMS = ["inherit", "blocked", "frozen", "physarum"] as const;
export const CONTROLS = ["pc-light", "pc-decay"] as const;
export type Arm = (typeof ARMS)[number];
export type Control = (typeof CONTROLS)[number];
export type AnyArm = Arm | Control;
export const isArm = (a: string): a is AnyArm => (ARMS as readonly string[]).includes(a) || (CONTROLS as readonly string[]).includes(a);

/** The config delta of each arm on top of defaultConfig() (PROTOCOL.md section 2, and 6 for the controls). */
export const ARM_DELTA: Record<AnyArm, Partial<MyceliumConfig>> = {
  inherit: { heredity: "inherit" },
  blocked: { heredity: "blocked" },
  frozen: { heredity: "frozen" },
  physarum: { controller: "physarum", heredity: "frozen" },
  "pc-light": { light: 2 },
  "pc-decay": { pDecay: 2620 },
};

/**
 * defaultConfig() plus the arm's delta. The inherit arm keeps the default's own heredity (it sets no key
 * the default lacks), so its config is byte-identical to defaultConfig({ seed }).
 */
export function armConfig(arm: AnyArm, seed: number): MyceliumConfig {
  const delta = arm === "inherit" ? {} : ARM_DELTA[arm];
  return defaultConfig({ ...delta, seed });
}

export const DEV_SEEDS = [101, 102, 103, 104, 105] as const;
export const FRESH_SEEDS = [9001, 9002, 9003, 9004, 9005] as const;
/** Seeds at or above this belong to confirmation only. */
export const FRESH_MIN = 9001;
export const CONFIRM_ARMS: readonly Arm[] = ["inherit", "blocked", "physarum", "frozen"];
/** The three arms that carry the population guard and the noise floor. */
export const GUARDED_ARMS: readonly Arm[] = ["inherit", "blocked", "physarum"];
/** At least this many seeds (of 5) must support an effect: the sign of the mean difference and a size above SUPPORT_FRACTION * NF. */
export const MIN_AGREE = 4;
/** A seed supports an effect only if |d_s| > SUPPORT_FRACTION * NF (NF = 2 SD, so this is one SD). PROTOCOL.md section 8. */
export const SUPPORT_FRACTION = 0.5;
/** R1 is dropped as degenerate when its mean over the dev seeds is below this in both inherit and blocked (PROTOCOL.md section 6). */
export const R1_DEGENERATE_BELOW = 0.05;
/** The largest effect a bounded readout can show (R1 is a share, so |D| <= 1). A noise floor at or above it can never be exceeded. */
export const MAX_EFFECT: Partial<Record<ReadoutId, number>> = { R1: 1 };
/** Readouts that must separate inherit from both contrasts for a PASS. */
export const K = 2;

// ---- the run gate --------------------------------------------------------------------------------------

export type Phase = "smoke" | "pass1" | "dev" | "confirm";

export interface SeedLogEntry {
  phase: Phase;
  arm: string;
  seed: number;
  steps: number;
  /** started and finished bracket a run; invalid is written when a ledger residual stops the protocol. */
  state: "started" | "finished" | "invalid";
}

export interface RunRequest {
  phase: Phase;
  arm: string;
  seed: number;
  steps: number;
  /** True when <out>/<arm>/seed-<n>/series.json already exists (only the confirm gate reads it). */
  seriesExists?: boolean;
}

/**
 * Problems with the log itself, which stop every logged phase (empty = clean): a fresh-seed entry outside
 * confirm (the embargo was broken) or an invalid entry (a ledger residual stopped the protocol).
 */
export function logProblems(log: readonly SeedLogEntry[]): string[] {
  const bad: string[] = [];
  const leaked = log.filter((e) => e.seed >= FRESH_MIN && e.phase !== "confirm");
  if (leaked.length) bad.push(`the seed log holds a fresh-seed run outside confirm (${leaked.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")}); the embargo is broken and the protocol stops`);
  const inv = log.filter((e) => e.state === "invalid");
  if (inv.length) bad.push(`the seed log holds an invalid run (${inv.map((e) => `${e.phase} ${e.arm} ${e.seed}`).join(", ")}); a ledger residual stops the protocol`);
  return bad;
}

/**
 * Why a run may not start (empty = allowed). Seeds of 9001 and above run only in confirm, only on the
 * four confirmation arms, only for 20,000 steps, and a confirm (arm, seed) with a finished entry is never run
 * again, so a fresh-seed result can never be redone after it was seen. A started entry with no finished entry
 * and no series.json (a crash before anything was written or shown) may be run again: the run is
 * deterministic and nothing of it was displayed. smoke runs are short and never gating, so they may not use a
 * fresh seed either. A log that holds a leak or an invalid run refuses every pass1, dev and confirm run.
 */
export function gateRun(req: RunRequest, log: readonly SeedLogEntry[]): string[] {
  const bad: string[] = [];
  const { phase, arm, seed, steps } = req;
  if (!Number.isInteger(seed) || seed < 0) bad.push("seed must be a non-negative integer");
  if (!isArm(arm)) bad.push(`unknown arm ${arm}`);
  if (seed >= FRESH_MIN && phase !== "confirm") bad.push(`seed ${seed} is a fresh seed (>= ${FRESH_MIN}); it runs only in the confirm phase`);
  if (phase !== "smoke") bad.push(...logProblems(log));
  switch (phase) {
    case "smoke":
      break;
    case "pass1":
      if (arm !== "inherit") bad.push("pass1 runs the inherit arm only");
      if (!(DEV_SEEDS as readonly number[]).includes(seed)) bad.push("pass1 runs dev seeds 101-105 only");
      if (steps !== R2.STEPS) bad.push(`pass1 runs ${R2.STEPS} steps`);
      break;
    case "dev":
      if (!(DEV_SEEDS as readonly number[]).includes(seed)) bad.push("dev runs seeds 101-105 only");
      if (steps !== R2.STEPS) bad.push(`dev runs ${R2.STEPS} steps`);
      break;
    case "confirm": {
      if (!(FRESH_SEEDS as readonly number[]).includes(seed)) bad.push("confirm runs seeds 9001-9005 only");
      if (!(CONFIRM_ARMS as readonly string[]).includes(arm)) bad.push("confirm runs inherit, blocked, physarum and frozen only");
      if (steps !== R2.STEPS) bad.push(`confirm runs ${R2.STEPS} steps`);
      const mine = log.filter((e) => e.phase === "confirm" && e.arm === arm && e.seed === seed);
      if (mine.some((e) => e.state === "finished")) bad.push(`(${arm}, ${seed}) is already finished in the seed log; a fresh-seed run is never repeated`);
      else if (mine.length && req.seriesExists) bad.push(`(${arm}, ${seed}) has a series.json but no finished entry; inspect it by hand, it is not run again`);
      break;
    }
    default:
      bad.push(`unknown phase ${phase as string}`);
  }
  return bad;
}

/**
 * The batch form of the confirmation (the only form the runner offers): refuses to start on a leak or an
 * invalid run in the log. Pairs already finished are skipped by the caller, so a crashed batch resumes.
 */
export function gateConfirmBatch(log: readonly SeedLogEntry[]): string[] {
  return logProblems(log);
}

/** The confirm (arm, seed) pairs still to run, in the fixed order, given the log: those without a finished entry. */
export function pendingConfirm(log: readonly SeedLogEntry[]): { arm: string; seed: number }[] {
  const done = new Set(log.filter((e) => e.phase === "confirm" && e.state === "finished").map((e) => `${e.arm}/${e.seed}`));
  return CONFIRM_ARMS.flatMap((arm) => FRESH_SEEDS.map((seed) => ({ arm: arm as string, seed }))).filter((p) => !done.has(`${p.arm}/${p.seed}`));
}

// ---- FROZEN --------------------------------------------------------------------------------------------

/**
 * FROZEN is `key: <64 hex>` lines (anything else is ignored). Keys: `protocol_sha256`, `code_hash` and, after
 * Freeze 2, `calibration_sha256`, each exactly once. A repeated key is an error, not an override: Freeze 2
 * only appends calibration_sha256 and never rewrites the Freeze 1 lines (an amendment starts a new FROZEN).
 * Per-file lines in `shasum -a 256` format (`<64 hex>  <path>`) list the manifest behind code_hash.
 */
export function parseFrozen(text: string): { keys: Record<string, string>; files: Record<string, string>; duplicates: string[] } {
  const keys: Record<string, string> = {}, files: Record<string, string> = {};
  const duplicates: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*([a-z0-9_]+)\s*:\s*([0-9a-f]{64})\s*$/.exec(line);
    if (m) {
      if (m[1] in keys) duplicates.push(m[1]);
      keys[m[1]] = m[2];
      continue;
    }
    const f = /^([0-9a-f]{64})  (\S+)\s*$/.exec(line);
    if (f) {
      if (f[2] in files) duplicates.push(f[2]);
      files[f[2]] = f[1];
    }
  }
  return { keys, files, duplicates };
}

/** The text code_hash is the SHA-256 of: one `<hash>  <path>` line per file, sorted by path (plain string order). */
export function manifestText(files: Readonly<Record<string, string>>): string {
  return Object.keys(files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((p) => `${files[p]}  ${p}\n`).join("");
}

export interface FreezeHashes {
  protocol: string;
  code: string;
  /** Per-file SHA-256 of everything code_hash covers, by repo-relative path. */
  files: Record<string, string>;
  calibration: string | null;
}

/**
 * Problems that stop a run. Freeze 1 (needed before any dev or pass1 run) checks the protocol hash, the code
 * hash and every per-file line. Freeze 2 (needed before confirm) also requires the calibration hash.
 * Smoke needs neither.
 */
export function checkFrozen(phase: Phase, frozenText: string | null, actual: FreezeHashes): string[] {
  if (phase === "smoke") return [];
  if (frozenText === null) return [phase === "confirm" ? "FROZEN does not exist; both freezes must be recorded before a confirmation run" : "FROZEN does not exist; Freeze 1 must be recorded before a dev run"];
  const { keys: f, files, duplicates } = parseFrozen(frozenText);
  const bad: string[] = [];
  if (duplicates.length) bad.push(`FROZEN repeats ${duplicates.join(", ")}; a key or file may appear once (Freeze 2 only appends calibration_sha256)`);
  if (f.protocol_sha256 === undefined) bad.push("FROZEN has no protocol_sha256");
  else if (f.protocol_sha256 !== actual.protocol) bad.push("PROTOCOL.md differs from the hash in FROZEN");
  if (f.code_hash === undefined) bad.push("FROZEN has no code_hash");
  else if (f.code_hash !== actual.code) bad.push("the code differs from the code_hash in FROZEN");
  // Per-file lines: they must be exactly the files the code hash covers, with the same hashes.
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

// ---- statistics ----------------------------------------------------------------------------------------

export const mean = (a: readonly number[]): number => a.reduce((t, v) => t + v, 0) / a.length;
/** Sample standard deviation (n - 1). */
export function sd(a: readonly number[]): number {
  if (a.length < 2) return NaN;
  const m = mean(a);
  let t = 0;
  for (const v of a) t += (v - m) * (v - m);
  return Math.sqrt(t / (a.length - 1));
}

export interface Separation {
  /** Mean of the paired differences. */
  D: number;
  /** Seeds that support the effect: the sign of D and |d_s| > SUPPORT_FRACTION * NF (a zero difference never supports). */
  agree: number;
  signs: number[];
  /** |D| > NF and agree >= MIN_AGREE. */
  separates: boolean;
}

/**
 * The effect test shared by calibration (controls) and confirmation: |mean d| > NF and at least 4 of 5
 * seeds individually support it (sign of the mean, and a size above half the floor, i.e. one SD). One extreme
 * seed cannot carry the mean, and four tiny same-sign differences cannot either.
 */
export function separation(d: readonly number[], nf: number): Separation {
  const D = mean(d);
  const sgn = Math.sign(D);
  const signs = d.map((v) => Math.sign(v));
  const agree = sgn === 0 ? 0 : d.filter((v) => Math.sign(v) === sgn && Math.abs(v) > SUPPORT_FRACTION * nf).length;
  return { D, agree, signs, separates: Math.abs(D) > nf && agree >= MIN_AGREE };
}

// ---- run summaries -------------------------------------------------------------------------------------

/** What the analysis needs from one series.json. */
export interface RunSummary {
  readouts: Readouts;
  guardTripped: boolean;
}
/** values[arm][seed] */
export type RunTable = Partial<Record<AnyArm, Record<number, RunSummary>>>;

function need(t: RunTable, arm: AnyArm, seed: number): RunSummary {
  const r = t[arm]?.[seed];
  if (!r) throw new Error(`missing run: ${arm} seed ${seed}`);
  return r;
}
function value(r: RunSummary, id: ReadoutId, arm: string, seed: number): number {
  const v = r.readouts[id];
  if (v === null || !Number.isFinite(v)) throw new Error(`readout ${id} is undefined for ${arm} seed ${seed} (no guard trip explains it)`);
  return v;
}

// ---- calibration ---------------------------------------------------------------------------------------

export interface ControlEffect {
  usable: boolean;
  /** Per readout: paired differences (control - inherit) by seed, the test result against the blocked-contrast NF. */
  effects: Partial<Record<ReadoutId, Separation & { d: number[] }>>;
}

/** A noise floor per contrast: 2 x the larger SD of the two arms compared (PROTOCOL.md section 6). */
export interface Floors { blocked: number; physarum: number }

export interface Calibration {
  protocol: "mycelium-r2";
  theta: number;
  steps: number;
  seeds: number[];
  /** Provenance, filled in by r2-analyze.ts from FROZEN and the run files: every dev run carries this code hash. */
  codeHash: string | null;
  protocolSha256: string | null;
  /** MEASUREMENT-LIMITED when calibration cannot support a confirmation; null otherwise. */
  verdict: "MEASUREMENT-LIMITED" | null;
  reasons: string[];
  guardTrips: { arm: string; seed: number }[];
  sd: Partial<Record<ReadoutId, Partial<Record<Arm, number>>>>;
  nf: Partial<Record<ReadoutId, Floors>>;
  dropped: ReadoutId[];
  dropReasons: Partial<Record<ReadoutId, string>>;
  /** Kept or not, readouts whose physarum floor can never be exceeded (bounded readout, NF >= its largest possible effect). */
  unreachableVsPhysarum: ReadoutId[];
  controls: Record<Control, ControlEffect>;
  /** Informational only, changes no decision: the same effect test applied to inherit - blocked and inherit - physarum on the dev seeds. */
  devContrasts: Partial<Record<ReadoutId, Record<"blocked" | "physarum", Separation & { d: number[] }>>>;
  kept: ReadoutId[];
}

/**
 * Calibration on the dev seeds (PROTOCOL.md section 6): guard first, then per-contrast noise floors, the
 * degeneracy and reachability drops, the two positive controls, then the kept set. A guard trip on any of the
 * three guarded arms ends it with MEASUREMENT-LIMITED. A trip in a control makes only that control unusable.
 */
export function calibrate(t: RunTable, theta: number, seeds: readonly number[] = DEV_SEEDS): Calibration {
  const reasons: string[] = [];
  const out: Calibration = {
    protocol: "mycelium-r2", theta, steps: R2.STEPS, seeds: [...seeds], codeHash: null, protocolSha256: null, verdict: null, reasons, guardTrips: [], sd: {}, nf: {}, dropped: [], dropReasons: {},
    unreachableVsPhysarum: [], controls: { "pc-light": { usable: false, effects: {} }, "pc-decay": { usable: false, effects: {} } }, devContrasts: {}, kept: [],
  };
  for (const arm of GUARDED_ARMS) for (const s of seeds) if (need(t, arm, s).guardTripped) out.guardTrips.push({ arm, seed: s });
  for (const s of seeds) need(t, "frozen", s);
  if (out.guardTrips.length) {
    out.verdict = "MEASUREMENT-LIMITED";
    reasons.push(`population guard tripped on dev: ${out.guardTrips.map((g) => `${g.arm} ${g.seed}`).join(", ")}`);
    return out;
  }
  const drop = (id: ReadoutId, why: string) => { out.dropped.push(id); out.dropReasons[id] = why; };
  for (const id of READOUT_IDS) {
    const per: Partial<Record<Arm, number>> = {};
    const vals: Partial<Record<Arm, number[]>> = {};
    for (const arm of GUARDED_ARMS) { vals[arm] = seeds.map((s) => value(need(t, arm, s), id, arm, s)); per[arm] = sd(vals[arm]!); }
    out.sd[id] = per;
    const nf: Floors = { blocked: 2 * Math.max(per.inherit!, per.blocked!), physarum: 2 * Math.max(per.inherit!, per.physarum!) };
    out.nf[id] = nf;
    const max = MAX_EFFECT[id];
    if (nf.blocked === 0 || nf.physarum === 0) drop(id, "a noise floor is 0");
    else if (max !== undefined && nf.blocked >= max) drop(id, `the blocked floor ${nf.blocked} is at or above the largest possible effect ${max}`);
    else if (id === "R1" && mean(vals.inherit!) < R1_DEGENERATE_BELOW && mean(vals.blocked!) < R1_DEGENERATE_BELOW) drop(id, `degenerate: mean R1 is below ${R1_DEGENERATE_BELOW} in both inherit and blocked`);
    if (max !== undefined && nf.physarum >= max) out.unreachableVsPhysarum.push(id);
  }
  const live = READOUT_IDS.filter((id) => !out.dropped.includes(id));
  for (const id of live) {
    const row = {} as Record<"blocked" | "physarum", Separation & { d: number[] }>;
    for (const other of ["blocked", "physarum"] as const) {
      const d = seeds.map((s) => value(need(t, "inherit", s), id, "inherit", s) - value(need(t, other, s), id, other, s));
      row[other] = { ...separation(d, out.nf[id]![other]), d };
    }
    out.devContrasts[id] = row;
  }
  for (const c of CONTROLS) {
    const usable = seeds.every((s) => !need(t, c, s).guardTripped);
    out.controls[c].usable = usable;
    if (!usable) { reasons.push(`control ${c} tripped the population guard and is ignored`); continue; }
    for (const id of live) {
      const d = seeds.map((s) => value(need(t, c, s), id, c, s) - value(need(t, "inherit", s), id, "inherit", s));
      out.controls[c].effects[id] = { ...separation(d, out.nf[id]!.blocked), d };
    }
  }
  if (!out.controls["pc-light"].usable && !out.controls["pc-decay"].usable) {
    out.verdict = "MEASUREMENT-LIMITED";
    reasons.push("both positive controls are unusable");
    return out;
  }
  out.kept = live.filter((id) => CONTROLS.some((c) => out.controls[c].usable && out.controls[c].effects[id]?.separates));
  if (out.kept.length < 2) {
    out.verdict = "MEASUREMENT-LIMITED";
    reasons.push(`fewer than 2 readouts kept (${out.kept.join(", ") || "none"})`);
  }
  return out;
}

/**
 * Why a confirmation may not start from this CALIBRATION.json (PROTOCOL.md section 6, items 1 and 5):
 * a MEASUREMENT-LIMITED calibration, or fewer than 2 kept readouts, means confirmation is not run. Empty = allowed.
 */
export function checkCalibrationForConfirm(cal: Pick<Calibration, "verdict" | "kept" | "theta" | "reasons">): string[] {
  const bad: string[] = [];
  if (cal.verdict !== null) bad.push(`CALIBRATION.json verdict is ${cal.verdict}${cal.reasons?.length ? ` (${cal.reasons.join("; ")})` : ""}; confirmation is not run`);
  if (!Array.isArray(cal.kept) || cal.kept.length < 2) bad.push("CALIBRATION.json keeps fewer than 2 readouts; confirmation is not run");
  if (!Number.isInteger(cal.theta) || cal.theta < R2.THETA_MIN) bad.push("CALIBRATION.json has no valid theta");
  return bad;
}

/**
 * The provenance chain (PROTOCOL.md section 10): every run file's codeHash, the calibration's codeHash and
 * FROZEN's code_hash must all be one value. `runHashes` are the codeHash fields read from the series.json
 * files (null for a run that recorded none). Empty = one implementation throughout.
 */
export function checkProvenance(frozenCode: string, calibrationCode: string | null | undefined, runHashes: readonly { path: string; codeHash: string | null }[]): string[] {
  const bad: string[] = [];
  if (calibrationCode !== undefined && calibrationCode !== frozenCode) bad.push(`CALIBRATION.json was made under code ${calibrationCode ?? "(none recorded)"}, FROZEN has ${frozenCode}`);
  const off = runHashes.filter((r) => r.codeHash !== frozenCode);
  if (off.length) bad.push(`${off.length} run file(s) were not run under the frozen code (first: ${off[0].path} has ${off[0].codeHash ?? "no code hash"})`);
  return bad;
}

/**
 * CALIBRATION.json must have been made under the frozen protocol and the frozen code (PROTOCOL.md section 10).
 * The runner checks this before the first fresh-seed run, so a stale calibration cannot spend the seeds.
 */
export function checkCalibrationProvenance(cal: { codeHash?: string | null; protocolSha256?: string | null }, frozen: { code_hash?: string; protocol_sha256?: string }): string[] {
  const bad: string[] = [];
  if (!cal.codeHash || cal.codeHash !== frozen.code_hash) bad.push(`CALIBRATION.json was made under code ${cal.codeHash ?? "(none recorded)"}, FROZEN has ${frozen.code_hash}`);
  if (!cal.protocolSha256 || cal.protocolSha256 !== frozen.protocol_sha256) bad.push(`CALIBRATION.json was made under protocol ${cal.protocolSha256 ?? "(none recorded)"}, FROZEN has ${frozen.protocol_sha256}`);
  return bad;
}

// ---- confirmation --------------------------------------------------------------------------------------

export type Label = "PASS" | "FAIL" | "NOT-SEPARATED-FROM-PHYSARUM" | "PARTIAL" | "MEASUREMENT-LIMITED";

export interface Decision {
  label: Label;
  reasons: string[];
  kept: ReadoutId[];
  /** Per kept readout and contrast: D, supporting-seed counts and the test against that contrast's NF. */
  tests: Partial<Record<ReadoutId, Record<"blocked" | "physarum", Separation & { nf: number; d: number[] }>>>;
  sepBlocked: ReadoutId[];
  sepPhysarum: ReadoutId[];
  sepBoth: ReadoutId[];
  /**
   * For each readout that separates from both: "beyond" if inherit lies on the same side of blocked and physarum
   * (the extreme of the three), "between" if it lies between them. Reported; it changes no label (PROTOCOL.md section 8).
   */
  ordering: Partial<Record<ReadoutId, "beyond" | "between">>;
}

/**
 * The verdicts of PROTOCOL.md section 8, in the order given, so exactly one applies. `cal.kept` and
 * `cal.nf` come from CALIBRATION.json. Frozen is not read.
 */
export function decide(t: RunTable, cal: Pick<Calibration, "kept" | "nf" | "verdict" | "reasons">, seeds: readonly number[] = FRESH_SEEDS): Decision {
  const d: Decision = { label: "MEASUREMENT-LIMITED", reasons: [], kept: [...cal.kept], tests: {}, sepBlocked: [], sepPhysarum: [], sepBoth: [], ordering: {} };
  const tripped: string[] = [];
  for (const arm of GUARDED_ARMS) for (const s of seeds) if (need(t, arm, s).guardTripped) tripped.push(`${arm} ${s}`);
  if (tripped.length) d.reasons.push(`population guard tripped: ${tripped.join(", ")}`);
  if (cal.verdict === "MEASUREMENT-LIMITED") d.reasons.push(`calibration verdict is MEASUREMENT-LIMITED (${cal.reasons.join("; ")})`);
  if (cal.kept.length < 2) d.reasons.push(`fewer than 2 readouts kept (${cal.kept.length})`);
  if (d.reasons.length) return d;
  for (const id of cal.kept) {
    const floors = cal.nf[id];
    if (floors === undefined || !(floors.blocked > 0) || !(floors.physarum > 0)) throw new Error(`kept readout ${id} has no positive noise floors in the calibration`);
    const row = {} as Record<"blocked" | "physarum", Separation & { nf: number; d: number[] }>;
    for (const other of ["blocked", "physarum"] as const) {
      const diffs = seeds.map((s) => value(need(t, "inherit", s), id, "inherit", s) - value(need(t, other, s), id, other, s));
      const nf = floors[other];
      row[other] = { ...separation(diffs, nf), nf, d: diffs };
    }
    d.tests[id] = row;
    if (row.blocked.separates) d.sepBlocked.push(id);
    if (row.physarum.separates) d.sepPhysarum.push(id);
    if (row.blocked.separates && row.physarum.separates) {
      d.sepBoth.push(id);
      d.ordering[id] = Math.sign(row.blocked.D) === Math.sign(row.physarum.D) ? "beyond" : "between";
    }
  }
  if (d.sepBlocked.length === 0) d.label = "FAIL";
  else if (d.sepBoth.length >= K) d.label = "PASS";
  else if (d.sepBoth.length === 0) d.label = "NOT-SEPARATED-FROM-PHYSARUM";
  else d.label = "PARTIAL";
  return d;
}
