// Regime meters, the reader (plan docs/3d-regime-meters-plan-2026-10-23.md section 8.5; rule runs/regime/rule-draft.md, to be frozen as
// experiments/3d-slab/regime-rule.md). It applies the pre-stated rule to the job JSONs and nothing else: every decision is made by the
// pure functions of packages/metrics/src/regime3.ts (M0); this file loads and checks the files, joins the jobs, calls those functions and
// prints, tabulates and writes what they return. A disagreement between this file and the rule is a bug here (R0).
//
//   deno run -A --no-lock experiments/3d-slab/regime-readout.ts --dev   [--run=N] [--draft]   Stage 0 (R9.0): outcome, causes by combination,
//                                                                                             go/no-go reports, threshold trigger, constant screen
//   deno run -A --no-lock experiments/3d-slab/regime-readout.ts --gate  [--draft]             the held-out gate (R9): writes gate.json
//   deno run -A --no-lock experiments/3d-slab/regime-readout.ts --sweep [--draft]             R3 to R12 on the sweep: regime-results.tsv,
//        [--allow-missing=<setting,...>]                                                      regime-settings.tsv, regime-readout.md,
//                                                                                             regime-results.json
//
// Options: --root=<repo root> (default: this file's repo), --jobs=<dir> (default runs/regime/jobs; --dev: runs/regime/dev), --out=<dir>
// (default runs/regime), --rule=<file> (override the rule file), --combo=P1-net|P1-occ|P2-net|P2-occ (only with --draft: the combination
// the rule's R1 does not yet hold), --gate-file=<file> (--sweep: the gate file; default <out>/gate.json, with --draft <out>/gate.DRAFT.json),
// --captures=<dir> (default <out>/captures), --no-sensitivity (skip the R13 sensitivity table: a quick look, never the written result).
//
// Exit code: 0 for any outcome the rule defines (GATE-FAIL, STAGE0-FAIL and STAGE0-CLOSED included: they are results), 1 for INVALID-RUN
// (a gate or sweep job failed a check of R5, or the jobs carry more than one ruleSha, codeCommit or srcHash), 2 for a refusal or a usage error (a rule
// whose SHA-256 differs from REGIME-FROZEN, a missing or failed gate.json, a malformed job file, a combination the jobs were not run under).
// Stage 0 is the one exception to INVALID-RUN (R5, R9.0): an INVALID Stage 0 job is the cause INVALID-JOB of every combination (G5; a failed C1 is also
// go/no-go (a)), the run counts, the readout lists the failed checks and exits 0 whatever its outcome, and the jobs of a Stage 0 run are not compared with one
// another for stamps (the two rung files of one job must agree: a difference is a C6 failure of that job).
//
// Frozen versus draft. Without --draft the reader reads experiments/3d-slab/regime-rule.md and REFUSES it unless its SHA-256 equals the last
// hash in experiments/3d-slab/REGIME-FROZEN and the one in runs/regime/RULE.sha256. With --draft it reads runs/regime/rule-draft.md and every
// output says DRAFT: the file names carry ".DRAFT" (gate.DRAFT.json, which the runner never reads), the rows carry a `rule` column, the
// readout starts with a banner and the JSON says "draft": true. Jobs that carry "synthetic": true (the page builder's synthetic sweep) are read
// the same way and every output says SYNTHETIC (".SYNTHETIC" in the names); synthetic and real jobs never mix.
//
// The R1 fill form. RUNG and DECIDER are read from the value cell of the R1 row that starts "RUNG, DECIDER": the row counts as filled iff the
// cell (backticks and bold removed) IS one fill form, `P2, occ` or `RUNG = P2, DECIDER = occ` (a comma, both labels or neither), and nothing else: any other text,
// such as a placeholder that names both options or a half fill like `RUNG = P1; DECIDER is not filled (net is a possibility)`, is not a fill.
// gate.json repeats the combination and --sweep checks it against the rule. The parser is regime3.ts `parseCombination`; the runner uses it too.
//
// Rosters. A verdict is issued only on the registered set of jobs (R9.0, R9.1, R2.3): --dev needs the 18 Stage 0 jobs, --gate the 20 gate jobs
// (the 2D reference worlds are read at T1 and T2 only, 12 of them per stage, R1), each with both rung files; --sweep needs the 32 settings at
// seeds 101 to 103 and T0 (96 jobs). A missing job, a missing rung file or a job the
// roster does not list is a refusal (exit 2) that names the files. A trimmed sweep (plan section 9: the control, group B, gateK 1024, the lightK
// 4096 carpets) is read only with --allow-missing=<setting,...>: each named setting must have no job at all, and the readout names them (outcome
// details, regime-readout.md, regime-results.json "trimmed"); they read INSUFFICIENT. Extension jobs (seeds 104 to 106) are read only when R10
// gave UNRESOLVED on seeds 101 to 103 and only for the settings that were SPLIT there, all three seeds each; late-check jobs (T1) only for LATE0.
//
// Job-file contract (what the runner writes; the pure functions read the `RegimeJob` fields of regime3.ts, the rest rides along):
//   one JSON per (job, rung) under runs/regime/jobs (sweep, late, extension, gate) or runs/regime/dev (Stage 0, ids prefixed dev-). The two
//   rung files of a gate or Stage 0 job (same kind, world, seed and T) are joined; a sweep job has one file, run under the gate's combination.
//   Extra fields, all optional, each printed as an empty cell when absent:
//     synthetic: true                       set by the synthetic generator only
//     rehearsal: true                       set by the runner's --dev flag: such a job is refused by every mode (exit 2)
//     livingTrace: number[]                 living count every 1,000 steps of the burn-in
//     m4Source: { path, sha256, mode }      the M4 JSON compared by C4 (mode json | tsv-rounded | none); the job's m4Mode must agree
//     stateHashT, stateDigestT: string      R2.5, R12.3 (stateDigestT is compared across seeds for the INERT test)
//     seconds, stepsPerSec: number, device: string
//     entropy: { H0, h_sp, h_z, h_st, c_ratio }                            R6.9
//     divergence: { "100" | "300" | "1000": { Jid, Jg, ngdiff } }           R6.10 genome-set columns (the census columns come from the S log)
//     scaleCurve: number[6]                                                 R6.10, scales 1, 2, 4, 8, 16, 32
//   Stage 0 also writes runs/regime/dev/constant-screen.json (ConstantScreen below). Captures: runs/regime/captures/<jobId>.json (Capture below).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  AXES, AXIS_LISTS, B0_ID, B0_PARAMS, COMBINATIONS, REGIME, SEEDS, axesDiffering, buildSettingRows, censusDivergence, comboKey, comboLabel, comboOf,
  decideOutcome, decidingColumn, derridaAnalysis, distanceToTarget, expectedRoster, findBrackets, gateReport, gateSlabId, inPool, inferenceSentence, isClassBearing, isInertGateK,
  isNum, isRegimeClass, isValidJob, jobId, mergeSummaries, median, parseCombination, parseHashFile, reproCounts, rosterKey, rosterLabel, secondColumns,
  sensitivityScenarios, stage0, startState, summarizeJob, sweepRoster, sweepSettings, sweepWithExtension, validateRun, windowMean,
} from "@bl/metrics";
import type {
  AmpLabel, Axis, CheckName, ComboKey, Combination, DiffLog, GateCause, GateEval, JobReading, JobSummary, LateResult, M4Mode, Outcome, Ranking,
  RegimeClass, RegimeConstants, RegimeJob, Rung, SettingParams, SettingRow, Stage0Result, Decider,
} from "@bl/metrics";

// =====================================================================================================================
// Errors, small helpers

/** A refusal or a malformed input: the CLI prints the message and exits with `exit` (2). Never an outcome of the rule. */
export class ReaderError extends Error {
  constructor(message: string, readonly exit: number = 2) {
    super(message);
    this.name = "ReaderError";
  }
}

export const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export type Cell = string | number | boolean | null | undefined;
/** A number printed with at most six significant digits; null, undefined, NaN and infinities print as an empty cell. */
export function fmt(x: Cell): string {
  if (x === null || x === undefined) return "";
  if (typeof x === "boolean") return x ? "yes" : "no";
  if (typeof x === "number") return Number.isFinite(x) ? String(Number(x.toPrecision(6))) : "";
  return String(x).replace(/[\t\r\n]+/g, " ");
}
const pct = (x: number | null | undefined, digits = 2): string => (isNum(x) ? `${(100 * x).toFixed(digits)} percent` : "n/a");
const num = (x: number | null | undefined, digits = 3): string => (isNum(x) ? String(Number(x.toFixed(digits))) : "n/a");
const unique = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];
const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// =====================================================================================================================
// Paths

export interface Options {
  root: string;
  draft: boolean;
  jobs?: string;
  out?: string;
  rule?: string;
  combo?: string;
  run?: number;
  gateFile?: string;
  captures?: string;
  noSensitivity: boolean;
  /** --sweep: settings declared not run (the plan's trim order); each must have no job at all, and the readout names them. */
  allowMissing?: string[];
}
export interface Paths {
  root: string;
  frozenRule: string;
  frozenHashFile: string;
  ruleShaFile: string;
  draftRule: string;
  jobsDir: string;
  devDir: string;
  outDir: string;
  capturesDir: string;
  m4Tsv: string;
}
export function pathsFor(o: Pick<Options, "root" | "jobs" | "out" | "rule" | "captures">): Paths {
  const root = resolve(o.root);
  const outDir = resolve(root, o.out ?? "runs/regime");
  return {
    root,
    frozenRule: resolve(root, o.rule ?? "experiments/3d-slab/regime-rule.md"),
    frozenHashFile: resolve(root, "experiments/3d-slab/REGIME-FROZEN"),
    ruleShaFile: resolve(root, "runs/regime/RULE.sha256"),
    draftRule: resolve(root, o.rule ?? "runs/regime/rule-draft.md"),
    jobsDir: resolve(root, o.jobs ?? "runs/regime/jobs"),
    devDir: resolve(root, o.jobs ?? "runs/regime/dev"),
    outDir,
    capturesDir: resolve(root, o.captures ?? join(o.out ?? "runs/regime", "captures")),
    m4Tsv: resolve(root, "experiments/3d-slab/m4-results.tsv"),
  };
}

// =====================================================================================================================
// The rule: frozen or draft, its R1 combination, its development log

export interface RuleInfo {
  status: "FROZEN" | "DRAFT";
  path: string;
  sha256: string;
  /** RUNG and DECIDER of R1 if filled in (see the fill form in the header), else null with the reason. */
  combo: Combination | null;
  comboWhy: string | null;
  /** The R0.2 block (the development log) and its SHA-256: gate.json records the hash (R9.5). */
  devLog: string;
  devLogSha: string;
}

// The two parsers of the rule file live in regime3.ts (the runner reads them too, so the three tools share one reading): the hashes in a
// REGIME-FROZEN or RULE.sha256 file (the LAST is the rule's current hash) and the R1 fill (one strict form, see the header).
export { parseCombination, parseHashFile };

/** The block of R0 that starts at the bullet "R0.2 Development data and the development log" and runs to the next level-2 heading. */
export function extractDevLog(ruleText: string): string {
  const lines = ruleText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^- \*\*R0\.2\b/.test(l));
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^## /.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join("\n").trimEnd();
}

/**
 * Reads the rule. Frozen: the file's SHA-256 must equal the last hash in REGIME-FROZEN and the one in RULE.sha256, else the reader refuses.
 * Draft (--draft): runs/regime/rule-draft.md, no hash check, status DRAFT.
 */
export function loadRule(p: Paths, draft: boolean): RuleInfo {
  const path = draft ? p.draftRule : p.frozenRule;
  if (!existsSync(path)) throw new ReaderError(draft ? `the draft rule ${path} does not exist` : `the frozen rule ${path} does not exist (the rule is frozen after Stage 0 and before the held-out gate; use --draft until then)`);
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8");
  const sha = sha256Hex(bytes);
  if (!draft) {
    if (!existsSync(p.frozenHashFile)) throw new ReaderError(`${p.frozenHashFile} is missing: the rule is not frozen (use --draft until it is)`);
    const recorded = parseHashFile(readFileSync(p.frozenHashFile, "utf8"));
    if (recorded.length === 0) throw new ReaderError(`${p.frozenHashFile} holds no SHA-256`);
    if (recorded[recorded.length - 1] !== sha) {
      throw new ReaderError(`REFUSED: ${path} has SHA-256 ${sha}, but REGIME-FROZEN records ${recorded[recorded.length - 1]}${recorded.includes(sha) ? " (an older hash: the rule was amended since)" : ""}`);
    }
    if (!existsSync(p.ruleShaFile)) throw new ReaderError(`${p.ruleShaFile} is missing (R15 records the hash there too)`);
    const second = parseHashFile(readFileSync(p.ruleShaFile, "utf8"));
    if (second.length === 0 || second[second.length - 1] !== sha) throw new ReaderError(`REFUSED: runs/regime/RULE.sha256 does not equal the SHA-256 of ${path}`);
  }
  const { combo, why } = parseCombination(text);
  const devLog = extractDevLog(text);
  return { status: draft ? "DRAFT" : "FROZEN", path, sha256: sha, combo, comboWhy: why, devLog, devLogSha: sha256Hex(devLog) };
}

/** The combination to read under: the rule's R1 if filled in; with --draft `--combo=` fills in for it (and must agree with R1 if R1 is filled). */
export function selectedCombination(rule: RuleInfo, comboArg: string | undefined): Combination {
  let given: Combination | null = null;
  if (comboArg !== undefined) {
    if (rule.status !== "DRAFT") throw new ReaderError("--combo is only allowed with --draft; a frozen rule holds RUNG and DECIDER itself");
    if (!/^P[12]-(net|occ)$/.test(comboArg)) throw new ReaderError(`--combo=${comboArg}: expected P1-net, P1-occ, P2-net or P2-occ`);
    given = comboOf(comboArg as ComboKey);
  }
  if (rule.combo && given && comboKey(rule.combo) !== comboKey(given)) throw new ReaderError(`--combo=${comboArg} disagrees with R1 (${comboLabel(rule.combo)})`);
  const c = rule.combo ?? given;
  if (!c) throw new ReaderError(`R1 does not hold RUNG and DECIDER yet: ${rule.comboWhy}${rule.status === "DRAFT" ? "; pass --combo=<rung>-<decider> to read a draft under one" : ""}`);
  return c;
}

/** The label that goes into file names and rows: SYNTHETIC beats DRAFT beats nothing. */
export function labelOf(rule: RuleInfo | null, synthetic: boolean): "SYNTHETIC" | "DRAFT" | "" {
  return synthetic ? "SYNTHETIC" : rule && rule.status === "DRAFT" ? "DRAFT" : "";
}
export const withLabel = (name: string, label: string): string => (label ? name.replace(/(\.[A-Za-z0-9]+)$/, `.${label}$1`) : name);

// =====================================================================================================================
// Job files

export interface JobExtras {
  synthetic?: boolean;
  /** The runner's --dev rehearsals (tiny grids, odd start steps, seeds 9900 and up) are tagged `rehearsal: true` and never enter a readout. */
  rehearsal?: boolean;
  livingTrace?: number[];
  m4Source?: { path: string; sha256: string; mode: M4Mode | "none" };
  stateHashT?: string;
  stateDigestT?: string;
  seconds?: number;
  stepsPerSec?: number;
  device?: string;
  entropy?: { H0?: number | null; h_sp?: number | null; h_z?: number | null; h_st?: number | null; c_ratio?: number | null };
  divergence?: Record<string, { Jid?: number | null; Jg?: number | null; ngdiff?: number | null }>;
  scaleCurve?: number[];
}
export type JobFile = RegimeJob & JobExtras;

/** One job as the reader holds it: its rung files, their summary under the deciders asked for, and the file names. */
export interface JobBundle {
  key: string;
  files: JobFile[];
  names: string[];
  summary: JobSummary;
  /** The stamp problems the reader found by itself (C6 against the rule it loaded): a bundle with any is INVALID. */
  restamp: string[];
}

/**
 * The file of a bundle whose twin bank was run under `combo`'s rung. A gate or Stage 0 bundle holds both rung files in name order (P1 first); the descriptive
 * quantities of a combination (k, the S twin's census, the genome divergence, the dose curve) belong to the file of its own rung. A sweep bundle has the one file
 * run under the selected combination. A bundle with no bank (EXTINCT, NO_TARGET) falls back to its first file.
 */
export function bankFileOf(b: JobBundle, combo: Combination): JobFile {
  return b.files.find((f) => f.bank?.rung === combo.rung) ?? b.files.find((f) => f.bank) ?? b.files[0];
}

/** The reader's own files and the runner's side files that share a job directory: never jobs. */
const NOT_JOBS = /^(stage0|gate|constant-screen|regime-results)(\.(DRAFT|SYNTHETIC))?\.json$/;
const isJobShape = (x: unknown): x is JobFile => {
  const o = x as Record<string, unknown> | null;
  return !!o && typeof o === "object" && typeof o.id === "string" && typeof o.role === "string" && typeof o.kind === "string" && typeof o.world === "string" && typeof o.seed === "number" && typeof o.T === "number" && typeof o.cells === "number";
};

/** Reads every job JSON in `dir` (`*.json`, not `*.tmp`, not the reader's own files). Malformed files and duplicate ids are refusals. */
export function loadJobFiles(dir: string): { file: string; job: JobFile }[] {
  if (!existsSync(dir)) throw new ReaderError(`job directory ${dir} does not exist`);
  const out: { file: string; job: JobFile }[] = [];
  const seen = new Map<string, string>();
  for (const name of readdirSync(dir).sort(byStr)) {
    if (!name.endsWith(".json") || NOT_JOBS.test(name)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch (e) {
      throw new ReaderError(`${join(dir, name)} is not valid JSON: ${(e as Error).message}`);
    }
    if (!isJobShape(parsed)) throw new ReaderError(`${join(dir, name)} is not a job file (needs id, role, kind, world, seed, T and cells)`);
    if (seen.has(parsed.id)) throw new ReaderError(`job id ${parsed.id} appears in both ${seen.get(parsed.id)} and ${name}`);
    seen.set(parsed.id, name);
    out.push({ file: name, job: parsed });
  }
  return out;
}

const bundleKey = (j: JobFile): string => `${j.kind}|${j.world}|${j.seed}|${j.T}|${j.dev ? "dev" : "main"}`;

/** A job that was METERED at T must hold a twin bank: a missing one is a runner bug, not a job without a class. */
function checkShape(j: JobFile): void {
  if (j.rehearsal === true) throw new ReaderError(`job ${j.id} is a rehearsal (written by the runner's --dev flag): rehearsals never enter a readout; remove it from the job directory`);
  const st = startState({ extinct: j.extinctAt !== null, Bstar: j.Bstar, NE: j.NE, f: j.cells > 0 ? j.living / j.cells : 0 });
  if (st.status === "METERED" && !j.bank) throw new ReaderError(`job ${j.id} was metered at T but has no twin bank`);
  if (j.bank && (!j.bank.doses || !Array.isArray(j.bank.sites))) throw new ReaderError(`job ${j.id} has a malformed twin bank`);
  if (j.m4Source && j.m4Mode && j.m4Source.mode !== j.m4Mode) throw new ReaderError(`job ${j.id}: m4Mode ${j.m4Mode} disagrees with m4Source.mode ${j.m4Source.mode}`);
  if (j.m4Mode === "json" && !(j.m4Source && j.m4Source.sha256)) throw new ReaderError(`job ${j.id}: m4Mode is json but m4Source has no sha256 (the gate records the manifest)`);
}

/**
 * Groups the files of one job (its rung files), summarizes each under `deciders` with the M0 `summarizeJob` and joins them with `mergeSummaries`.
 * `rule` (frozen only) adds the reader's own C6 check: a job whose `ruleSha` is not the loaded rule's hash is INVALID.
 */
export function bundleJobs(files: readonly { file: string; job: JobFile }[], deciders: readonly Decider[], rule: RuleInfo | null, c: RegimeConstants = REGIME): JobBundle[] {
  const groups = new Map<string, { file: string; job: JobFile }[]>();
  for (const f of files) {
    checkShape(f.job);
    const k = bundleKey(f.job);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const out: JobBundle[] = [];
  for (const [key, fs] of [...groups.entries()].sort((a, b) => byStr(a[0], b[0]))) {
    const rungs = fs.map((f) => f.job.bank?.rung).filter((r): r is Rung => !!r);
    if (new Set(rungs).size !== rungs.length) throw new ReaderError(`two files for ${key} carry the same rung: ${fs.map((f) => f.file).join(", ")}`);
    const parts = fs.map((f) => summarizeJob(f.job, deciders, c));
    const summary = parts.length === 1 ? parts[0] : mergeSummaries(parts);
    // The two rung files of a gate or Stage 0 job are one job: its id carries no rung.
    if (parts.length > 1) summary.id = summary.id.replace(/-P[12]$/, "");
    const restamp: string[] = [];
    if (rule && rule.status === "FROZEN") {
      for (const f of fs) {
        if (f.job.ruleSha !== rule.sha256) restamp.push(`${f.job.id}: ruleSha ${f.job.ruleSha ?? "(missing)"} is not the frozen rule's ${rule.sha256.slice(0, 12)}`);
        else if (!f.job.codeCommit || !f.job.srcHash) restamp.push(`${f.job.id}: codeCommit or srcHash missing`);
        else if (f.job.treeClean !== true) restamp.push(`${f.job.id}: the tree was not clean`);
      }
    }
    // The rung files of one gate or Stage 0 job are one job (R5 C6, R10.1): they carry one ruleSha, one codeCommit and one srcHash. `mergeSummaries`
    // keeps the first file's stamps, so a second-rung file written by another version of the instrument would otherwise vanish into the join.
    if (fs.length > 1)
      for (const k of ["ruleSha", "codeCommit", "srcHash"] as const) {
        const vals = unique(fs.map((f) => f.job[k] ?? "(missing)"));
        if (vals.length > 1) restamp.push(`${summary.id}: its rung files carry different ${k}: ${vals.map((v) => (v === "(missing)" ? v : v.slice(0, 12))).join(" and ")}`);
      }
    if (restamp.length) {
      summary.invalid = true;
      summary.invalidChecks = unique([...summary.invalidChecks, "C6" as CheckName]).sort() as CheckName[];
    }
    out.push({ key, files: fs.map((f) => f.job), names: fs.map((f) => f.file), summary, restamp });
  }
  return out;
}

const anySynthetic = (bs: readonly JobBundle[]): boolean => bs.some((b) => b.files.some((f) => f.synthetic === true));
/** Synthetic and real job files never mix: checked on the files, before any job is analysed. */
function assertNoMixedSyntheticFiles(files: readonly { job: JobFile }[]): void {
  if (new Set(files.map((f) => f.job.synthetic === true)).size > 1) throw new ReaderError("synthetic and real job files are mixed; synthetic jobs live in runs/regime/synthetic and never beside real ones");
}
function assertNoMixedSynthetic(bs: readonly JobBundle[]): void {
  const flags = unique(bs.flatMap((b) => b.files.map((f) => f.synthetic === true)));
  if (flags.length > 1) throw new ReaderError("synthetic and real job files are mixed; synthetic jobs live in runs/regime/synthetic and never beside real ones");
}

// =====================================================================================================================
// The roster (R9.0, R9.1, R2.3): a verdict is issued only on the complete, registered set of jobs

/** What a roster check found: the job files the stage needs and the directory does not hold, and the jobs the stage does not list. */
export interface RosterReport {
  missing: string[];
  unexpected: string[];
}

const rungOf = (id: string): string => /-(P[12])(?:-(?:net|occ))?$/.exec(id)?.[1] ?? "";

/**
 * Stage 0 (18 jobs) and the gate (20 jobs): every listed job needs both rung files (an EXTINCT or NO_TARGET job writes both too), and nothing else
 * may be there. The roster is `expectedRoster` of regime3.ts; tests/deno/regime_runner.ts checks that the runner's job list is the same set.
 */
export function checkBundleRoster(stage: "dev" | "gate", bundles: readonly JobBundle[]): RosterReport {
  const want = expectedRoster(stage);
  const have = new Map(bundles.map((b) => [b.key, b]));
  const missing: string[] = [];
  for (const e of want) {
    const b = have.get(rosterKey(e));
    for (const rung of ["P1", "P2"] as const)
      if (!b || !b.files.some((f) => rungOf(f.id) === rung)) missing.push(jobId({ dev: e.dev, kind: e.kind, world: e.world, seed: e.seed, T: e.T, rung }));
  }
  const listed = new Set(want.map(rosterKey));
  return { missing, unexpected: bundles.filter((b) => !listed.has(b.key)).map((b) => b.summary.id) };
}

/**
 * The main stage: the 32 settings of the catalogue at seeds 101 to 103 and T0 (96 jobs, one file each). `allowMissing` names settings that were
 * deliberately not run (the plan's trim order: the control, group B, gateK 1024, the lightK 4096 carpets); each must have no job at all, and the
 * readout says so. Jobs at the extension seeds are judged by the extension's own licence (R8.5), not here.
 */
export function checkSweepRoster(t0: readonly JobBundle[], combo: Combination, allowMissing: readonly string[] = [], specs = sweepSettings()): RosterReport {
  const skip = new Set(allowMissing);
  const want = sweepRoster(specs.filter((s) => !skip.has(s.id)), SEEDS.main, REGIME.T0);
  const have = new Set(t0.map((b) => b.key));
  const missing = want.filter((e) => !have.has(rosterKey(e))).map((e) => jobId({ kind: "slab", world: e.world, seed: e.seed, T: e.T, rung: combo.rung, decider: combo.decider }));
  const listed = new Set([...want, ...sweepRoster(specs.filter((s) => !skip.has(s.id)), SEEDS.extension, REGIME.T0)].map(rosterKey));
  return { missing, unexpected: t0.filter((b) => !listed.has(b.key)).map((b) => b.summary.id) };
}

/** Refuses (exit 2, naming the jobs) a roster that is incomplete or holds a job the stage does not list. */
export function assertRoster(rep: RosterReport, what: string): void {
  if (!rep.missing.length && !rep.unexpected.length) return;
  const show = (xs: readonly string[]) => (xs.length > 12 ? `${xs.slice(0, 12).join(", ")}, and ${xs.length - 12} more` : xs.join(", "));
  throw new ReaderError(
    `REFUSED: ${what} is not the registered set of jobs; a verdict is issued only on a complete roster (R9.0, R9.1, R2.3)` +
      (rep.missing.length ? `; ${rep.missing.length} job file(s) missing: ${show(rep.missing)}` : "") +
      (rep.unexpected.length ? `; ${rep.unexpected.length} job(s) the roster does not list: ${show(rep.unexpected)}` : ""),
  );
}

// =====================================================================================================================
// Text helpers: tables, causes, the reading scale

export function mdTable(headers: readonly string[], rows: readonly (readonly Cell[])[]): string[] {
  const esc = (c: Cell) => fmt(c).replace(/\|/g, "\\|");
  return [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`)];
}
export const tsv = (headers: readonly string[], rows: readonly (readonly Cell[])[]): string => [headers.join("\t"), ...rows.map((r) => r.map(fmt).join("\t"))].join("\n") + "\n";

const causeCodes = (cs: readonly GateCause[]): string => (cs.length ? cs.map((c) => c.code).join(", ") : "none");
const causeDetail = (cs: readonly GateCause[]): string[] => cs.map((c) => `${c.code}: ${c.where.join(", ")}`);
const ALL_COMBOS_ORDER: readonly Combination[] = COMBINATIONS;

/** The banner every DRAFT or SYNTHETIC output starts with. */
export function banner(label: string): string | null {
  if (label === "SYNTHETIC") return "SYNTHETIC: not a result. These jobs were generated by the page builder to exercise the reader; no run produced them.";
  if (label === "DRAFT") return "DRAFT: the rule was not frozen when this was read (runs/regime/rule-draft.md). Nothing here is a result of the registered programme.";
  return null;
}

// =====================================================================================================================
// Stage 0 (R9.0)

/** `runs/regime/dev/constant-screen.json`, written by the Stage 0 runner (R9.0 "Constant screen"): n_dec,S(TAU_DEC) and n_1(100) of the changed fork relative to the base. */
export interface ConstantScreen {
  seed: number;
  setting: string;
  T: number;
  rung: Rung;
  decider: Decider;
  base: { nDecS30: number; n1_100: number };
  rows: { key: string; factor: number; value: number; nDecS30: number; n1_100: number }[];
}

export function loadConstantScreen(dir: string): ConstantScreen | null {
  const p = join(dir, "constant-screen.json");
  if (!existsSync(p)) return null;
  try {
    const x = JSON.parse(readFileSync(p, "utf8")) as ConstantScreen;
    if (!x || !x.base || !Array.isArray(x.rows)) throw new Error("needs base and rows");
    return x;
  } catch (e) {
    throw new ReaderError(`${p} is not a constant screen: ${(e as Error).message}`);
  }
}

export function constantScreenLines(s: ConstantScreen | null): string[] {
  if (!s) return ["Constant screen: not run (no constant-screen.json in the Stage 0 directory). A descriptive line; it decides nothing."];
  const ratio = (a: number, b: number) => (b > 0 ? num(a / b, 2) : a === 0 ? "1 (both 0)" : "inf");
  return [
    `Constant screen (descriptive, decides nothing): ${s.setting} seed ${s.seed} at T = ${s.T}, rung ${s.rung} with ${s.decider}; base n_dec,S(${REGIME.TAU_DEC}) = ${num(s.base.nDecS30, 2)}, n_1(100) = ${num(s.base.n1_100, 2)}.`,
    ...mdTable(["constant", "factor", "value", `n_dec,S(${REGIME.TAU_DEC}) / base`, "n_1(100) / base"], s.rows.map((r) => [r.key, r.factor, r.value, ratio(r.nDecS30, s.base.nDecS30), ratio(r.n1_100, s.base.n1_100)])),
  ];
}

export function stage0Text(r: Stage0Result): string {
  const causes = ALL_COMBOS_ORDER.map((c) => `${comboLabel(c)} ${causeCodes(r.combos.find((x) => comboKey(x.combo) === comboKey(c))!.causes)}`).join("; ");
  if (r.outcome === "STAGE0-PASS") return `STAGE 0 PASS (run ${r.run} of ${REGIME.STAGE0_RUNS}): combination ${comboLabel(r.selected!)} selected on seeds 9001 to 9003; write it into R1.`;
  if (r.outcome === "STAGE0-FAIL") return `STAGE 0 FAIL (run ${r.run} of ${REGIME.STAGE0_RUNS}). Causes by combination: ${causes}.`;
  return `STAGE 0 CLOSED after ${r.run} runs: candidate 8 ends here.`;
}
export function thresholdTriggerLine(r: Stage0Result): string {
  const t = r.goNoGo.trigger;
  return `Threshold trigger: ${t.fired ? `fired in ${t.jobs.join(", ")}` : "not fired"}.`;
}
/**
 * The dust floor (go/no-go b) and the threshold trigger by rung's bank (R9.0): a failure in a rung's bank fails that rung's two combinations only
 * (DUST-FLOOR, DUST-THRESHOLD); thetaB is never re-derived. R13's trigger line above is unchanged; this line follows it.
 */
export function rungDustLine(r: Stage0Result): string {
  const g = r.goNoGo;
  const part = (rung: Rung): string => {
    const f = g.dustFloor.byRung[rung], t = g.trigger.byRung[rung];
    return `${rung} bank: ${f.ok ? "dust floor holds" : `DUST-FLOOR in ${f.jobs.join(", ")}`}, ${t.fired ? `trigger fired in ${t.jobs.join(", ")} (DUST-THRESHOLD)` : "trigger not fired"}`;
  };
  return `By rung (a failure fails that rung's two combinations only; thetaB is never re-derived): ${part("P1")}; ${part("P2")}.`;
}

export interface DevReport {
  run: number;
  result: Stage0Result;
  text: string;
  triggerLine: string;
  rungLine: string;
  /** One line per failed check of an INVALID Stage 0 job and per stamp finding of the reader (R5 at Stage 0; empty when every job is valid). */
  invalid: string[];
  lines: string[];
  json: Record<string, unknown>;
}

/** R9.0 on the Stage 0 jobs: the M0 `stage0` decides; this builds the readout around it. Jobs are summarized under both deciders and both rungs. */
export function evaluateDev(bundles: readonly JobBundle[], run: number, rule: RuleInfo, screen: ConstantScreen | null, label: string, runDefaulted = false, rosterCheck = true): DevReport {
  if (rosterCheck) assertRoster(checkBundleRoster("dev", bundles), "the Stage 0 job set");
  const result = stage0(bundles.map((b) => b.summary), run);
  const text = stage0Text(result);
  const triggerLine = thresholdTriggerLine(result);
  const rungLine = rungDustLine(result);
  const sumOf = bundles.map((b) => b.summary);
  const lines: string[] = [];
  const b = banner(label);
  if (b) lines.push(b, "");
  lines.push(`# Stage 0 readout (R9.0), run ${run} of ${REGIME.STAGE0_RUNS}`, "");
  lines.push(`Rule: ${rule.status} ${rule.path} (SHA-256 ${rule.sha256}). Jobs read: ${bundles.length} (${bundles.map((x) => x.summary.id).join(", ") || "none"}).`);
  if (runDefaulted) lines.push(`The run number defaulted to 1; pass --run=<n> for a repeat (the development log R0.2 lists the earlier Stage 0 runs).`);
  lines.push("", text, triggerLine, rungLine, "");
  if (result.outcome !== "STAGE0-PASS") lines.push("Causes by combination, in detail:", ...ALL_COMBOS_ORDER.flatMap((c) => {
    const sc = result.combos.find((x) => comboKey(x.combo) === comboKey(c))!;
    return [`- ${comboLabel(c)}: ${sc.causes.length ? `${sc.causes.length} cause${sc.causes.length === 1 ? "" : "s"}` : "none"}`, ...causeDetail(sc.causes).map((l) => `  - ${l}`)];
  }), "");
  // R5 at Stage 0: an INVALID job is the cause INVALID-JOB of every combination (G5), the readout says which checks failed and why, and it exits 0 whatever the outcome (final review F3).
  const invalidJobs = bundles.filter((x) => x.summary.invalid).map((x) => ({ id: x.summary.id, checks: x.summary.invalidChecks }));
  const invalid = invalidJobs.length ? invalidJobDetails(invalidJobs, bundles) : [];
  if (invalidJobs.length) lines.push(`Invalid Stage 0 jobs (R5; each is the cause INVALID-JOB of every combination, G5, and the readout exits 0 whatever the outcome; a failed C1 is also go/no-go (a), Z-NOT-ZERO):`, ...invalid.map((l) => `- ${l}`), "");
  // Selection table.
  lines.push("## Selection (first combination that satisfies G2, G3, G5, G6, G7, the margin condition and the go/no-go reports of its rung)", "");
  lines.push(...mdTable(["combination", "G2", "G3", "G5", "G6", "G7", "marginal jobs", "dust floor holds (b)", "trigger fired", "satisfies"], result.combos.map((x) => [
    comboLabel(x.combo), x.gate.g2.holds, x.gate.g3.holds, x.gate.g5.holds, x.gate.g6.holds, x.gate.g7.holds, x.marginal.length, x.rung.floorOk, x.rung.triggerFired, x.satisfies,
  ])), "");
  for (const x of result.combos) if (x.marginal.length) lines.push(`Margin condition, ${comboLabel(x.combo)}: ${x.marginal.map((m) => `${m.job} (${m.quantities.join(", ")})`).join("; ")}.`);
  // Go/no-go.
  const g = result.goNoGo;
  const covs = sumOf.flatMap((s) => Object.values(s.readings).map((r) => (r ? r.uNetCoverage30 : null))).filter(isNum);
  lines.push("", "## Go/no-go reports", "");
  lines.push(`(a) the Z twin is exactly zero in every Stage 0 job (C1): ${g.zExact.ok ? "yes" : `NO (${g.zExact.jobs.join(", ")})`}`);
  const floorFails = (["P1", "P2"] as const).filter((rung) => !g.dustFloor.byRung[rung].ok).map((rung) => `the ${rung} bank (${g.dustFloor.byRung[rung].jobs.join(", ")})`);
  lines.push(`(b) the dust floor: the U twin's block-net n_dec(${REGIME.TAU_DEC}) / liveblk_R is at most SAT = ${REGIME.SAT} in every metered job that has a U twin (a job without one is named below and counts as neither a pass nor a failure), read in each rung's bank (a failure fails that rung's two combinations only): ${g.dustFloor.ok ? "yes" : `NO, DUST-FLOOR in ${floorFails.join(" and ")}`}; largest ${covs.length ? num(Math.max(...covs), 4) : "n/a"}`);
  lines.push(`U twin read (R9.0 missing evidence): ${(["P1", "P2"] as const).map((rung) => `${rung} bank ${g.uEvidence[rung].assessed} of ${g.uEvidence[rung].metered} metered jobs`).join(", ")}${(["P1", "P2"] as const).some((rung) => g.uEvidence[rung].absent.length) ? `; no U twin (a FEW_SITES job runs no S or U twin, so there is nothing to read for (b), (c) or the trigger): ${(["P1", "P2"] as const).filter((rung) => g.uEvidence[rung].absent.length).map((rung) => `${rung} bank ${g.uEvidence[rung].absent.join(", ")}`).join("; ")}` : ""}.`);
  const top = [...g.medianBlock].sort((a, b) => b.median / Math.max(b.thetaB, 1) - a.median / Math.max(a.thetaB, 1) || byStr(a.job, b.job)).slice(0, 10);
  lines.push(`(c) the U twin's median |dB_blk| over its nonzero blocks at step ${REGIME.TAU_DEC}, next to thetaB (it feeds the threshold trigger, which fails the combinations of a rung whose bank fires it with DUST-THRESHOLD): ${g.medianBlock.length} job and rung readings (a U log with no block of nonzero difference has no median, NA, and does not fire (c)), ${g.medianBlock.filter((m) => m.exceeds).length} above thetaB${top.length ? `; the ${top.length} highest relative to thetaB:` : "."}`, "");
  lines.push(...(top.length ? mdTable(["job", "rung", "median |dB_blk|", "thetaB", "exceeds thetaB"], top.map((m) => [m.job, m.rung, m.median, m.thetaB, m.exceeds])) : ["(no U twin reported a median)"]), "");
  // Per-job classes and dust ratios (what the margin condition and G6 read).
  const gateJobs = bundles.filter((x) => (x.summary.role === "G2" || x.summary.role === "G3") && x.summary.flag !== null);
  lines.push("## The gate worlds on the development seeds", "");
  lines.push(...mdTable(["job", ...ALL_COMBOS_ORDER.map(comboLabel)], gateJobs.map((x) => [x.summary.id, ...ALL_COMBOS_ORDER.map((c) => {
    const r = x.summary.readings[comboKey(c)];
    return r ? `${r.jobClass ?? "no class"} ${r.dust} ratio ${num(r.ratioU, 2)}` : "no reading";
  })])), "");
  lines.push("MIXED and UNSTABLE rate among the metered gate jobs (A-F07):", "");
  lines.push(...mdTable(["combination", "MIXED or UNSTABLE", "of"], ALL_COMBOS_ORDER.map((c) => {
    const rs = gateJobs.map((x) => x.summary.readings[comboKey(c)]).filter((r): r is JobReading => !!r);
    return [comboLabel(c), rs.filter((r) => r.jobClass === "MIXED" || r.jobClass === "UNSTABLE").length, rs.length];
  })), "");
  // B0, informational.
  const b0 = bundles.filter((x) => x.summary.role === "B0");
  lines.push(`## ${B0_ID} (informational: the sweep's own base reading and dust state)`, "");
  lines.push(...(b0.length ? mdTable(["job", ...ALL_COMBOS_ORDER.map(comboLabel)], b0.map((x) => [x.summary.id, ...ALL_COMBOS_ORDER.map((c) => {
    const r = x.summary.readings[comboKey(c)];
    return r ? `${r.jobClass ?? "no class"} ${r.dust} ratio ${num(r.ratioU, 2)} s30 ${num(r.s30, 2)}` : "no reading";
  })])) : ["(no B0 job)"]), "");
  lines.push(...constantScreenLines(screen), "");
  // R9.0 Repetition: the first STAGE0-PASS is final (also when the threshold trigger fired in the other rung's bank); a rerun is licensed only after a STAGE0-FAIL, at most
  // STAGE0_RUNS - run more times, and declining it closes the candidate (final review F1).
  const rerunsLeft = result.outcome === "STAGE0-FAIL" ? Math.max(0, REGIME.STAGE0_RUNS - run) : 0;
  const triggerOther = result.goNoGo.trigger.fired ? ` although the threshold trigger fired in the other rung's bank (${result.goNoGo.trigger.jobs.join(", ")})` : "";
  lines.push(`## Next`, "", result.outcome === "STAGE0-PASS"
    ? `Write ${comboLabel(result.selected!)} into R1 (RUNG, DECIDER) in the form \`${result.selected!.rung}, ${result.selected!.decider}\`, log this run in R0.2, review the rule, freeze it (R15), then run the held-out gate. This PASS is final (R9.0 Repetition): no further Stage 0 run is permitted${triggerOther}. The constants Stage 0 read stand unchanged to the freeze (R9.0).`
    : result.outcome === "STAGE0-FAIL"
      ? `The finalizer may change J constants (R1) and rerun Stage 0, at most ${rerunsLeft} more time(s); every run and change goes into the development log (R0.2). Declining to rerun closes the candidate (STAGE0-CLOSED, recorded in that log).`
      : "Candidate 8 ends here.", "");
  const json = {
    schema: "regime-stage0/1", label, draft: rule.status === "DRAFT", run, outcome: result.outcome, selected: result.selected, final: result.outcome !== "STAGE0-FAIL", rerunsLeft, text, triggerLine, rungLine,
    ruleSha: rule.sha256, devLogSha: rule.devLogSha, jobs: bundles.map((x) => x.summary.id),
    combos: result.combos.map((x) => ({ combo: comboKey(x.combo), satisfies: x.satisfies, causes: x.causes, marginal: x.marginal, g: { g2: x.gate.g2.holds, g3: x.gate.g3.holds, g5: x.gate.g5.holds, g6: x.gate.g6.holds, g7: x.gate.g7.holds }, rung: x.rung, refClass: x.gate.refClass })),
    goNoGo: result.goNoGo, constantScreen: screen, invalid,
  };
  return { run, result, text, triggerLine, rungLine, invalid, lines, json };
}

// =====================================================================================================================
// R10.1 INVALID-RUN, dose curves, the reading scale (shared by the gate and the sweep)

/**
 * One line per failed check of the invalid jobs (the check and the reason its job file gives, or that the file does not record it) and the reader's own stamp findings
 * (a gate or Stage 0 job whose rung files carry different ruleSha, codeCommit or srcHash, or a stamp that is not the frozen rule's). Shared by the INVALID-RUN text of the gate
 * and the sweep and by the Stage 0 readout's list of invalid jobs (final review F3).
 */
export function invalidJobDetails(invalid: readonly { id: string; checks: readonly CheckName[] }[], bundles: readonly JobBundle[]): string[] {
  const details: string[] = [];
  for (const j of invalid) {
    const files = bundles.filter((b) => b.summary.id === j.id).flatMap((b) => b.files);
    for (const ck of j.checks) {
      const absent = files.length > 0 && files.every((f) => f.checks?.[ck] === undefined);
      const why = absent ? "the check is missing from the job file" : unique(files.map((f) => f.checks?.[ck]?.detail).filter((d): d is string => !!d)).join("; ");
      details.push(`${j.id}: ${ck}${why ? ` (${why})` : ""}`);
    }
  }
  for (const b of bundles) for (const m of b.restamp) details.push(m);
  return details;
}

export function invalidRunText(v: ReturnType<typeof validateRun>, bundles: readonly JobBundle[]): { text: string; details: string[] } {
  const parts: string[] = [];
  if (v.invalid.length) parts.push(`${v.invalid.map((j) => j.id).join(", ")} failed ${unique(v.invalid.flatMap((j) => j.checks)).sort().join(", ")}`);
  const mixedKeys = (["ruleSha", "codeCommit", "srcHash"] as const).filter((k) => v.mixed[k].length > 1);
  if (mixedKeys.length) parts.push(`the jobs carry mixed ${mixedKeys.join(", ")}`);
  const details: string[] = invalidJobDetails(v.invalid, bundles);
  for (const k of mixedKeys) details.push(`mixed ${k}: ${v.mixed[k].join(", ")}`);
  return { text: `INVALID RUN: ${parts.join("; ")}. No outcome. Fix the cause and rerun those jobs.`, details };
}

/** The dose curve of one job (R6.6): kicked-block fraction x = n0(m) / liveblk_R and the response ratio s_m(tau) per dose; the pooled ratio per tau. */
export interface DoseCurve {
  m: number[];
  n0: number[];
  x: number[];
  /** s[tauIndex][doseIndex], tau in REGIME.TAU. */
  s: (number | null)[][];
  pooled: (number | null)[];
}
export function doseCurveOf(job: JobFile, decider: Decider): DoseCurve | null {
  const bank = job.bank;
  if (!bank || bank.doses.length === 0) return null;
  const der = derridaAnalysis(bank.doses.map((d) => ({ m: d.m, n0: d.n0, nDec: decidingColumn(d.log, decider) })), { liveblkT: job.liveblkT, liveT: job.liveT });
  return {
    m: der.doses.map((d) => d.m), n0: der.doses.map((d) => d.n0), x: der.doses.map((d) => d.x),
    s: REGIME.TAU.map((_, t) => der.doses.map((d) => d.s[t])), pooled: der.s,
  };
}

/** The census divergence of the S twin after t steps, from its own log (R6.10): living-count and biomass divergence as fractions. */
export function censusAt(log: DiffLog | undefined, t: number): { dLiving: number; dSumB: number } | null {
  if (!log || log.live_R.length <= t) return null;
  return censusDivergence({ liveS: log.live_X[t], liveR: log.live_R[t], sumBS: log.SB_X[t], sumBR: log.SB_R[t] });
}

/**
 * The reading scale and the repro line that end every outcome string that names settings or jobs (R13 Footer). `named` are the bundles the
 * string speaks of (a bundle per job); the macro numbers are the median over their settings of the median over the setting's jobs.
 */
export function footerLine(named: readonly JobBundle[], all: readonly JobBundle[], combo: Combination): string {
  const key = comboKey(combo);
  // k, the S twin's census and the genome divergence are those of the file run under the combination's rung: a gate bundle holds both rung files and the
  // first by name is P1's, so reading files[0] would print P1's numbers under a P2 selection (final review F4).
  const metered = named.filter((b) => b.summary.readings[key] && b.files.some((f) => f.bank?.rung === combo.rung));
  const ks = metered.map((b) => bankFileOf(b, combo).bank!.k);
  const bySetting = new Map<string, JobBundle[]>();
  for (const b of metered) bySetting.set(b.summary.world, [...(bySetting.get(b.summary.world) ?? []), b]);
  const macro = (pick: (b: JobBundle) => number | null): number | null => {
    const per = [...bySetting.values()].map((bs) => median(bs.map(pick).filter(isNum))).filter(isNum);
    return median(per);
  };
  const dLiv = macro((b) => censusAt(bankFileOf(b, combo).bank!.S?.log, 1000)?.dLiving ?? null);
  const dSum = macro((b) => censusAt(bankFileOf(b, combo).bank!.S?.log, 1000)?.dSumB ?? null);
  const jg = macro((b) => divergenceAt(bankFileOf(b, combo), "1000")?.Jg ?? null);
  const valid = named.filter((b) => isValidJob(b.summary, key));
  const noVote = valid.filter((b) => isRegimeClass(b.summary.readings[key]!.jobClass) && !b.summary.readings[key]!.vote);
  const rc = reproCounts(all.map((b) => b.summary));
  const kTxt = ks.length ? num(median(ks), 1) : "n/a";
  return `Reading scale: finite-amplitude response to ${combo.rung} kicks (k = ${kTxt}), blocks 8x8x8, same noise, decided at step ${REGIME.TAU_DEC}, trajectory 100 to 1000. ` +
    `Macro at step 1000 (median over the settings named): living-count divergence ${pct(dLiv)}, biomass divergence ${pct(dSum)}, genome-set divergence ${pct(jg)}. ` +
    `Jobs that cast no vote because of the dust control: ${noVote.length} of ${valid.length}. ` +
    `repro: ${rc.json.passed} of ${rc.json.total} M4 comparisons by exact JSON, ${rc.tsv.passed} by rounded TSV, ${rc.notApplicable} not applicable.`;
}

// =====================================================================================================================
// The held-out gate (R9): gate.json

export interface GateCondition {
  id: string;
  what: string;
  /** null for G8, which is a label. */
  holds: boolean | null;
  info: boolean;
  detail: string;
  causes: GateCause[];
}
export interface GateGroup {
  label: string;
  world: string;
  T: number | null;
  /** The class held by at least 2 of the 3 voting jobs (G2: window jobs; G3: whatever the CARPET flag), or null. */
  cls: RegimeClass | null;
  jobs: { id: string; seed: number; flag: string | null; jobClass: string | null; dust: string; ratioU: number | null; s30: number | null; e: number | null; nSat100: number | null; fClass: string | null; nDecF30: number | null; nDecS30: number | null; nDecN30: number | null }[];
}
export interface GateFile {
  schema: "regime-gate/1";
  label: "" | "DRAFT" | "SYNTHETIC";
  draft: boolean;
  synthetic: boolean;
  pass: boolean;
  /** An INVALID gate job, or stamps that differ: no verdict (R10.1), and pass is false so that no stale file lets the runner start. */
  invalidRun: boolean;
  rung: Rung;
  decider: Decider;
  refClass: RegimeClass | null;
  amp: AmpLabel | null;
  ruleSha: string;
  ruleStatus: "FROZEN" | "DRAFT";
  devLogSha: string;
  /** M4 JSON path -> SHA-256 for every job that compared with M4's per-run JSON (R9.5). */
  m4Manifest: Record<string, string>;
  stamps: { ruleSha: string[]; codeCommit: string[]; srcHash: string[] };
  causes: GateCause[];
  others: { combo: ComboKey; pass: boolean; refClass: RegimeClass | null; causes: GateCause[] }[];
  conditions: GateCondition[];
  groups: GateGroup[];
  curves: { id: string; world: string; T: number; seed: number; role: string; curve: DoseCurve }[];
  text: string;
  details: string[];
  footer: string;
}

const GATE_ROLES = new Set(["G1", "G2", "G3", "G4"]);

function groupJobs(bundles: readonly JobBundle[], label: string): JobBundle[] {
  if (label === "carpet") return bundles.filter((b) => b.summary.role === "G3");
  const [world, t] = label.split("@");
  return bundles.filter((b) => b.summary.role === "G2" && b.summary.world === world && String(b.summary.T) === t);
}

export function passWording(refClass: RegimeClass, amp: AmpLabel): string {
  if (refClass === "CRITICAL") {
    return amp === "AMP-ROBUST"
      ? "The project's alive 2D worlds read critical at this kick scale and at the other scale, so the candidate's criticality reading applies and its inference may be drawn (R12)."
      : "The project's alive 2D worlds read in the CRITICAL class at this kick scale but not at the other (AMP-DEPENDENT): the inference may be drawn (R12) in the words \"in the CRITICAL class at this kick scale\", and the criticality wording is withheld (R9.8).";
  }
  return "The project's alive 2D worlds read chaotic: the target is called \"chaotic-like\", the sweep is still read and the ranking still runs toward it. This does not test the criticality hypothesis.";
}

/** The sentences that follow GATE FAIL (R13): dose insensitivity listing, the net or occ wording of REF-ORDERED, control failures. */
export function gateFailSentences(sel: GateEval, bundles: readonly JobBundle[], combo: Combination): string[] {
  const out: string[] = [];
  const key = comboKey(combo);
  const dustCauses = sel.causes.filter((c) => c.code === "DUST-LIMITED" || c.code === "DUST-AMBIGUOUS");
  if (dustCauses.length) {
    const labels = unique(dustCauses.flatMap((c) => c.where));
    const listing = labels.map((label) => {
      const rows = groupJobs(bundles, label).map((b) => ({ b, r: b.summary.readings[key] })).filter((x) => !x.r || x.r.dust !== "CLEAR");
      return `${label}: seeds ${rows.map(({ b, r }) => `${b.summary.seed} (${r ? r.dust : "UNAVAILABLE"}${r && isNum(r.ratioU) ? `, ratio ${num(r.ratioU, 2)}` : ""})`).join(", ") || "none"}`;
    }).join("; ");
    out.push(`Observed dose insensitivity: a much smaller kick left at least half (DUST-LIMITED) or a quarter to a half (DUST-AMBIGUOUS) of the damage at step ${REGIME.TAU_DEC} in ${listing}; this comparison does not say whether the cause is rounding dust or sensitive dependence.`);
  }
  if (sel.causes.some((c) => c.code === "REF-ORDERED")) {
    // ORDERED is also what a persistent, non-spreading scar reads (R6.4 step 6, R7 FROZEN), so the sentence says what was read and not that the damage healed.
    const g2 = bundles.filter((b) => b.summary.role === "G2" && b.summary.readings[key]);
    const frozen = g2.filter((b) => b.summary.readings[key]!.flags.includes("FROZEN")).length;
    out.push(`The alive reference worlds read ORDERED under the selected block decider (${combo.decider}) at this kick scale; their decay, frozen-scar, trajectory and dose readings are listed. Reference jobs with the FROZEN flag (a scar that persists without spreading): ${frozen} of ${g2.length}.`);
  }
  for (const code of ["N-NOT-SATURATED", "FROZEN-NOT-ORDERED", "NO-CONTRAST-WITH-CONTROLS"]) {
    const c = sel.causes.find((x) => x.code === code);
    if (c) out.push(`Control failure ${code} in ${c.where.join(", ")}.`);
  }
  return out;
}

export interface GateResult {
  gate: GateFile;
  lines: string[];
  exit: number;
}

/**
 * R9 on the gate jobs (roles G1 to G4): the M0 `gateReport` decides for the selected combination; the other three are printed as information
 * only. The bundles must have been summarized under both deciders. `now`-free: the same jobs always give the same file.
 */
export function evaluateGateJobs(allBundles: readonly JobBundle[], rule: RuleInfo, combo: Combination, label: "" | "DRAFT" | "SYNTHETIC", rosterCheck = true): GateResult {
  const bundles = allBundles.filter((b) => GATE_ROLES.has(b.summary.role) && !b.summary.dev);
  if (bundles.length === 0) throw new ReaderError("no gate jobs (roles G1 to G4) were found in the job directory");
  if (rosterCheck) assertRoster(checkBundleRoster("gate", bundles), "the gate job set");
  assertNoMixedSynthetic(bundles);
  const sums = bundles.map((b) => b.summary);
  const validation = validateRun(sums);
  const key = comboKey(combo);
  const rep = gateReport(sums, combo);
  const sel = rep.selected;
  const vtxt = invalidRunText(validation, bundles);
  const m4Manifest: Record<string, string> = {};
  for (const b of bundles) for (const f of b.files) if (f.m4Mode === "json" && f.m4Source) m4Manifest[f.m4Source.path] = f.m4Source.sha256;
  const sortedManifest = Object.fromEntries(Object.entries(m4Manifest).sort((a, b) => byStr(a[0], b[0])));

  const g4 = bundles.filter((b) => b.summary.role === "G4");
  const g4ok = g4.length >= 2 && g4.every((b) => !b.summary.invalid);
  const classes = sel.g2.classes;
  const conditions: GateCondition[] = [
    { id: "G1", what: "known dead: all three jobs EXTINCT at M4's step (a repro check, C4 by exact JSON)", holds: sel.g1 ? sel.g1.holds : null, info: false, detail: sel.g1?.holds ? "all extinct at M4's step" : causeCodes(sel.g1?.causes ?? []), causes: sel.g1?.causes ?? [] },
    { id: "G2", what: "the alive 2D worlds hold one non-ORDERED class, the same at T1, T2 and for both presets (refClass)", holds: sel.g2.holds, info: false, detail: `refClass ${sel.g2.refClass ?? "none"}; ` + Object.entries(classes).map(([k, v]) => `${k} ${v ?? "none"}`).join(", "), causes: sel.g2.causes },
    { id: "G3", what: "the known carpet reads a class that differs from refClass", holds: sel.g3.holds, info: false, detail: `carpet ${sel.g3.carpetClass ?? "none"}`, causes: sel.g3.causes },
    { id: "G4", what: "starved relic: finishes without error (informational)", holds: g4ok, info: true, detail: g4.length ? `${g4.length} job(s)${g4ok ? "" : ", not all finished clean"}` : "no job", causes: [] },
    { id: "G5", what: "no gate job is INVALID", holds: sel.g5.holds, info: false, detail: sel.g5.holds ? "none invalid" : sel.g5.causes.map((c) => c.where.join(", ")).join("; "), causes: sel.g5.causes },
    { id: "G6", what: "dust control: at least 2 of 3 jobs DUST_CLEAR in each of spots-m3, gradient-m3 (each time) and the carpet", holds: sel.g6.holds, info: false, detail: causeCodes(sel.g6.causes), causes: sel.g6.causes },
    { id: "G7", what: "controls: N saturates, the F pair reads ORDERED, damage at step 30 is F < S < N", holds: sel.g7.holds, info: false, detail: causeCodes(sel.g7.causes), causes: sel.g7.causes },
    { id: "G8", what: "amplitude label (informational)", holds: null, info: true, detail: rep.amp ?? "n/a (no refClass)", causes: [] },
  ];
  const groups: GateGroup[] = [];
  const mk = (lbl: string, world: string, T: number | null, cls: RegimeClass | null): GateGroup => ({
    label: lbl, world, T, cls,
    jobs: groupJobs(bundles, lbl).sort((a, b) => a.summary.seed - b.summary.seed).map((b) => {
      const r = b.summary.readings[key];
      return {
        id: b.summary.id, seed: b.summary.seed, flag: b.summary.flag, jobClass: r ? r.jobClass : null, dust: r ? r.dust : "UNAVAILABLE", ratioU: r ? r.ratioU : null,
        s30: r ? r.s30 : null, e: r ? r.e : null, nSat100: r ? r.nSat100 : null, fClass: r ? r.fClass : null, nDecF30: r ? r.nDecF30 : null, nDecS30: r ? r.nDecS30 : null, nDecN30: r ? r.nDecN30 : null,
      };
    }),
  });
  for (const [lbl, cls] of Object.entries(classes)) { const [w, t] = lbl.split("@"); groups.push(mk(lbl, w, Number(t), cls)); }
  groups.push(mk("carpet", gateSlabId("G3"), null, sel.g3.carpetClass));
  const curves = bundles.filter((b) => (b.summary.role === "G2" && b.summary.T === REGIME.T1) || b.summary.role === "G3").flatMap((b) => {
    const f = b.files.find((x) => x.bank && x.bank.rung === combo.rung);
    const c = f ? doseCurveOf(f, combo.decider) : null;
    return c ? [{ id: b.summary.id, world: b.summary.world, T: b.summary.T, seed: b.summary.seed, role: b.summary.role, curve: c }] : [];
  });
  const stamps = validation.mixed;
  const details: string[] = [];
  let text: string;
  let pass = sel.pass && !validation.fatal;
  if (validation.fatal) {
    text = vtxt.text;
    details.push(...vtxt.details);
    pass = false;
  } else if (!sel.pass) {
    const others = rep.others.map((o) => `${comboLabel(o.combo)} ${causeCodes(o.causes)}`).join("; ");
    text = `GATE FAIL. Selected combination ${comboLabel(combo)}, causes: ${causeCodes(sel.causes)}. Other combinations, information only: ${others}. CLOSED: candidate 8 ends here.`;
    details.push(...gateFailSentences(sel, bundles, combo));
  } else {
    text = `GATE PASS. Selected combination ${comboLabel(combo)}; refClass ${sel.refClass} (${rep.amp}); G1, G2, G3, G5, G6 and G7 hold. The sweep may run.`;
    details.push(passWording(sel.refClass!, rep.amp!));
  }
  const footer = validation.fatal ? "" : footerLine(bundles.filter((b) => b.files.some((f) => f.bank && f.bank.rung === combo.rung)), bundles, combo);
  const gate: GateFile = {
    schema: "regime-gate/1", label, draft: rule.status === "DRAFT", synthetic: label === "SYNTHETIC", pass, invalidRun: validation.fatal,
    rung: combo.rung, decider: combo.decider, refClass: sel.refClass, amp: rep.amp, ruleSha: rule.sha256, ruleStatus: rule.status, devLogSha: rule.devLogSha,
    m4Manifest: sortedManifest, stamps, causes: sel.causes,
    others: rep.others.map((o) => ({ combo: comboKey(o.combo), pass: o.pass, refClass: o.refClass, causes: o.causes })),
    conditions, groups, curves, text, details, footer,
  };

  const lines: string[] = [];
  const b0 = banner(label);
  if (b0) lines.push(b0, "");
  lines.push("# Held-out gate readout (R9)", "", `Rule: ${rule.status} ${rule.path} (SHA-256 ${rule.sha256}). Selected combination ${comboLabel(combo)}. Jobs read: ${bundles.length}.`, "");
  lines.push(text, ...details, ...(footer ? ["", footer] : []), "");
  lines.push("## Conditions (selected combination only)", "", ...mdTable(["id", "condition", "holds", "detail"], conditions.map((c) => [c.id, c.what, c.holds === null ? "label" : c.holds ? (c.info ? "yes (info)" : "yes") : c.info ? "no (info)" : "NO", c.detail])), "");
  if (!sel.pass || validation.fatal) {
    lines.push("Causes in detail:", ...causeDetail(sel.causes).map((l) => `- ${l}`), "");
  }
  lines.push("## Groups", "", ...mdTable(["group", "class (2 of 3)", "job", "flag", "job class", "dust", "ratio_U", "s(30)", "e", "N sat100", "F class", "n_dec F/S/N at 30"], groups.flatMap((g) => g.jobs.map((j) => [
    g.label, g.cls ?? "none", j.id, j.flag ?? "", j.jobClass ?? "no class", j.dust, num(j.ratioU, 2), num(j.s30, 2), num(j.e, 2), num(j.nSat100, 3), j.fClass ?? "", `${num(j.nDecF30, 1)} / ${num(j.nDecS30, 1)} / ${num(j.nDecN30, 1)}`,
  ]))), "");
  lines.push("## The other combinations (information only: they never change the result, R9.4)", "", ...mdTable(["combination", "would pass", "refClass", "causes"], rep.others.map((o) => [comboLabel(o.combo), o.pass, o.refClass ?? "none", causeCodes(o.causes)])), "");
  lines.push(`M4 manifest (${Object.keys(sortedManifest).length} JSON files compared): ${Object.keys(sortedManifest).length ? "recorded in gate.json" : "none recorded"}. Development log SHA-256: ${rule.devLogSha}.`, "");
  return { gate, lines, exit: validation.fatal ? 1 : 0 };
}

// =====================================================================================================================
// The sweep (R3 to R12): job rows, setting rows, example cards, outcome strings

export function loadGateFile(path: string): GateFile {
  if (!existsSync(path)) throw new ReaderError(`${path} does not exist: run --gate first (the sweep is read only after a gate)`);
  let g: GateFile;
  try {
    g = JSON.parse(readFileSync(path, "utf8")) as GateFile;
  } catch (e) {
    throw new ReaderError(`${path} is not valid JSON: ${(e as Error).message}`);
  }
  if (g.schema !== "regime-gate/1" || typeof g.pass !== "boolean" || !g.rung || !g.decider) throw new ReaderError(`${path} is not a gate file (schema regime-gate/1)`);
  return g;
}

/** R9.5: the gate file must belong to this rule, this combination and this development log. A failed gate is not a refusal: it is the outcome. */
export function checkGateFile(g: GateFile, rule: RuleInfo, combo: Combination): void {
  if (g.invalidRun) throw new ReaderError("REFUSED: the gate run was INVALID (no verdict); fix the gate jobs and run --gate again");
  if (g.ruleSha !== rule.sha256) throw new ReaderError(`REFUSED: gate.json carries rule hash ${String(g.ruleSha).slice(0, 12)}, the rule read is ${rule.sha256.slice(0, 12)}`);
  if (g.draft !== (rule.status === "DRAFT")) throw new ReaderError(`REFUSED: gate file draft=${g.draft} but the rule is ${rule.status}`);
  if (comboKey({ rung: g.rung, decider: g.decider }) !== comboKey(combo)) throw new ReaderError(`REFUSED: gate.json was read for ${comboLabel({ rung: g.rung, decider: g.decider })}, the rule's R1 holds ${comboLabel(combo)}`);
  if (g.devLogSha !== rule.devLogSha) throw new ReaderError("REFUSED: the development log (R0.2) changed after the gate ran (R15: a change of R1 after the gate needs a new gate)");
  if (g.pass && (!g.refClass || !g.amp)) throw new ReaderError("REFUSED: gate.json passes but holds no refClass or amplitude label");
}

const rungOfId = (id: string): string => /-(P[12])(?:-(?:net|occ))?$/.exec(id)?.[1] ?? "";
const SETTING_ORDER: Map<string, number> = new Map(sweepSettings().map((s, i) => [s.id, i]));
const bySettingSeed = (a: JobBundle, b: JobBundle): number =>
  a.summary.T - b.summary.T || (SETTING_ORDER.get(a.summary.world) ?? 99) - (SETTING_ORDER.get(b.summary.world) ?? 99) || byStr(a.summary.world, b.summary.world) || a.summary.seed - b.summary.seed;

export function statusOf(s: JobSummary, r: JobReading | undefined): string {
  if (s.invalid) return "INVALID";
  if (s.extinct) return "EXTINCT";
  if (s.noTarget) return "NO_TARGET";
  if (s.diedInPhase) return "DIED_IN_PHASE";
  if (s.drift) return "DRIFT";
  if (r && r.fewDoses) return "FEW_DOSES";
  return "METERED";
}
export function flagsOf(s: JobSummary, r: JobReading | undefined): string[] {
  const f: string[] = [];
  if (s.flag === "CARPET" || s.flag === "RELIC") f.push(s.flag);
  if (r) {
    if (r.footprint) f.push("FOOTPRINT");
    for (const x of r.flags) f.push(x);
    if (r.fewSites) f.push("FEW_SITES");
    if (r.fewColonies) f.push("FEW_COLONIES");
    if (r.overlap) f.push("OVERLAP");
  }
  if (s.drift) f.push("DRIFT");
  return unique(f);
}

const GRID_I100 = REGIME.TRAJ.indexOf(100);
const GRID_I1000 = REGIME.TRAJ.indexOf(1000);
const SECOND_NAMES = ["n_blk2", "L1c", "n_thetaV", "n_2thetaV", "n_1", "n_live", "n_vox", "L1_A", "L1_B", "L1_C", "L1_P", "L1_B/SB_R", "n_thetaV/n_dec"] as const;
const secondCol = (n: string): string => (n === "L1_B/SB_R" ? "L1_B_per_SB_R" : n === "n_thetaV/n_dec" ? "fine_coarse" : n);

/** The columns of regime-results.tsv (R13, job rows), in order. */
export const JOB_COLUMNS: readonly string[] = [
  "id", "world", "setting", "seed", "T", "rung", "status", "flags", "decider", "extinctAt", "living", "f", "Bstar", "k", "thetaB", "thetaV", "N_E", "m_S", "n_col",
  "s30", "s100", "s300", "sS100", "b", "r100", "r1000", "e", "saturated", "form", "Tclass", "Dclass", "stT", "stD", "overlap", "speed", "jobclass",
  "NbarS", "NbarU", "ratioU", "dust", "doseS", "doseU", "vote",
  "n_blk_100", "n_blk_1000", "n_occ_100", "n_occ_1000",
  ...SECOND_NAMES.flatMap((n) => [`${secondCol(n)}_100`, `${secondCol(n)}_1000`]),
  "q30", "q100", "q300", "siteMedian30", "siteMedian100", "siteMedian300", "siteIqr30", "siteIqr100", "siteIqr300",
  ...["100", "300", "1000"].flatMap((t) => [`Jid_${t}`, `Jg_${t}`, `ngdiff_${t}`, `dLiving_${t}`, `dSumB_${t}`]),
  "scale_1", "scale_2", "scale_4", "scale_8", "scale_16", "scale_32", "H0", "h_sp", "h_z", "h_st", "c_ratio",
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "m4Path", "m4Sha256", "m4Mode", "stateHashT", "stateDigestT", "ruleSha", "codeCommit", "srcHash", "treeClean",
  "seconds", "stepsPerSec", "device", "rule",
];

/** The genome-set columns at step `t`: `divergence` is keyed by step ("100", "300", "1000"); an array of rows with a `t` (an older runner's form) is read too. */
export function divergenceAt(f: JobFile, t: string): { Jid?: number | null; Jg?: number | null; ngdiff?: number | null } | undefined {
  const d = f.divergence as unknown;
  if (Array.isArray(d)) return (d as { t?: number; Jid?: number | null; Jg?: number | null; ngdiff?: number | null }[]).find((r) => String(r.t) === t);
  return (d as JobExtras["divergence"])?.[t];
}

/** One row of regime-results.tsv for a job read under `combo`. */
export function jobRow(b: JobBundle, combo: Combination, ruleCol: string): Record<string, Cell> {
  const s = b.summary;
  const f = bankFileOf(b, combo);
  const key = comboKey(combo);
  const r = s.readings[key];
  const bank = f.bank;
  const row: Record<string, Cell> = {};
  row.id = s.id; row.world = s.kind; row.setting = s.world; row.seed = s.seed; row.T = s.T; row.rung = bank?.rung ?? rungOfId(s.id);
  row.status = statusOf(s, r); row.flags = flagsOf(s, r).join(","); row.decider = combo.decider;
  row.extinctAt = s.extinctAt; row.living = f.living; row.f = s.f; row.Bstar = f.Bstar; row.k = bank?.k ?? null; row.thetaB = bank?.thetaB ?? null; row.thetaV = bank?.thetaV ?? null;
  row.N_E = f.NE; row.m_S = bank ? bank.sites.length : null; row.n_col = bank ? bank.nCol : null;
  if (r) {
    row.s30 = r.s30; row.s100 = r.s[1]; row.s300 = r.s[2]; row.sS100 = r.sS[1]; row.b = r.b; row.r100 = r.gridR[GRID_I100]; row.r1000 = r.gridR[GRID_I1000]; row.e = r.e;
    row.saturated = r.saturated; row.form = r.form; row.Tclass = r.tClass; row.Dclass = r.dClass; row.stT = r.stT; row.stD = r.stD; row.overlap = r.overlap; row.speed = r.speed;
    row.jobclass = r.jobClass; row.NbarS = r.NbarS; row.NbarU = r.NbarU; row.ratioU = r.ratioU; row.dust = r.dust; row.doseS = r.doseS; row.doseU = r.doseU; row.vote = r.vote;
  }
  if (bank?.S) {
    const L = bank.S.log;
    const at = (col: number[], i: number) => windowMean(col, REGIME.TRAJ[i], REGIME.TRAJ_STEPS);
    row.n_blk_100 = at(L.n_blk, GRID_I100); row.n_blk_1000 = at(L.n_blk, GRID_I1000); row.n_occ_100 = at(L.n_occ, GRID_I100); row.n_occ_1000 = at(L.n_occ, GRID_I1000);
    const sc = secondColumns({ S: L, N: bank.N?.log, sites: bank.S.sites, decider: combo.decider });
    for (const n of SECOND_NAMES) { row[`${secondCol(n)}_100`] = sc.grid[n]?.[GRID_I100] ?? null; row[`${secondCol(n)}_1000`] = sc.grid[n]?.[GRID_I1000] ?? null; }
    row.q30 = sc.q[0]; row.q100 = sc.q[1]; row.q300 = sc.q[2];
    row.siteMedian30 = sc.siteMedian[0]; row.siteMedian100 = sc.siteMedian[1]; row.siteMedian300 = sc.siteMedian[2];
    row.siteIqr30 = sc.siteIqr[0]; row.siteIqr100 = sc.siteIqr[1]; row.siteIqr300 = sc.siteIqr[2];
    for (const t of [100, 300, 1000]) {
      const c = censusAt(L, t);
      row[`dLiving_${t}`] = c ? c.dLiving : null; row[`dSumB_${t}`] = c ? c.dSumB : null;
    }
  }
  for (const t of ["100", "300", "1000"]) {
    const d = divergenceAt(f, t);
    row[`Jid_${t}`] = d?.Jid ?? null; row[`Jg_${t}`] = d?.Jg ?? null; row[`ngdiff_${t}`] = d?.ngdiff ?? null;
  }
  [1, 2, 4, 8, 16, 32].forEach((sc, i) => { row[`scale_${sc}`] = f.scaleCurve?.[i] ?? null; });
  row.H0 = f.entropy?.H0 ?? null; row.h_sp = f.entropy?.h_sp ?? null; row.h_z = f.entropy?.h_z ?? null; row.h_st = f.entropy?.h_st ?? null; row.c_ratio = f.entropy?.c_ratio ?? null;
  for (const ck of ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"] as const) {
    const c = b.files.map((x) => x.checks?.[ck]).find((x) => x !== undefined);
    row[ck] = c === undefined ? "" : c.applicable === false ? "NA" : c.ok ? "ok" : "FAIL";
  }
  row.m4Path = f.m4Source?.path ?? ""; row.m4Sha256 = f.m4Source?.sha256 ?? ""; row.m4Mode = f.m4Mode ?? f.m4Source?.mode ?? "";
  row.stateHashT = f.stateHashT ?? ""; row.stateDigestT = f.stateDigestT ?? "";
  row.ruleSha = f.ruleSha ?? ""; row.codeCommit = f.codeCommit ?? ""; row.srcHash = f.srcHash ?? ""; row.treeClean = f.treeClean ?? null;
  row.seconds = f.seconds ?? null; row.stepsPerSec = f.stepsPerSec ?? null; row.device = f.device ?? ""; row.rule = ruleCol;
  return row;
}

export const SETTING_COLUMNS: readonly string[] = ["setting", "group", "status", "class", "wouldBe", "votesORDERED", "votesCRITICAL", "votesCHAOTIC", "voting", "valid", "ell", "d", "target", "T1status", "T1class", "bracket", "inert", "seeds", "rule"];

export function classLetter(row: SettingRow): string {
  const st = row.result.status;
  if (st === "UNMETERABLE") return "U";
  if (st === "CARPET") return "K";
  if (st === "RELIC") return "R";
  switch (row.result.cls) {
    case "ORDERED": return "O";
    case "CRITICAL": return "C";
    case "CHAOTIC": return "X";
    case "SPLIT": return "S";
    case "DUSTY": return "D";
    default: return "I";
  }
}

// ---- example cards (plan 8.6 item 2) -----------------------------------------------------------------------------------

/** What `--capture` writes per example job (runs/regime/captures/<jobId>.json): the damaged voxels at steps 10, 100 and 1000, at most 4,000 each, flat [x, y, z, x, y, z, ...]. */
export interface Capture {
  id: string;
  W: number;
  H: number;
  D: number;
  steps: Record<string, number[]>;
}

export interface CardSeries {
  /** Steps (a log-spaced subsample of the stored steps). */
  t: number[];
  /** N(t) = n_dec,S(t) / m_S, and the U and N twins' (to step 300; null beyond), all window means; surv = share of S sites with damage at t. */
  S: (number | null)[];
  U: (number | null)[];
  N: (number | null)[];
  surv: (number | null)[];
  /** The levels the plot draws: N at 100 (the band's anchor), the ORDERED line ORD_R * n0_S and the coverage line SAT * liveblk_R / m_S. */
  anchorN: number | null;
  ordN: number;
  satN: number | null;
}
export interface CardJson {
  slot: "ORDERED" | "CRITICAL" | "CHAOTIC";
  kind: "class" | "nearest-band" | "nearest-e" | "none";
  note: string;
  id: string | null;
  setting: string | null;
  seed: number | null;
  jobClass: string | null;
  e: number | null;
  s30: number | null;
  b: number | null;
  ratioU: number | null;
  dust: string | null;
  saturated: boolean | null;
  form: string | null;
  mS: number | null;
  nCol: number | null;
  k: number | null;
  thetaB: number | null;
  series: CardSeries | null;
  capture: { id: string; file: string; present: boolean } | null;
}

function cardSeries(f: JobFile, combo: Combination): CardSeries | null {
  const bank = f.bank;
  if (!bank || !bank.S) return null;
  const mS = Math.max(bank.sites.length, 1);
  const stored = bank.S.sites.steps;
  const picks: number[] = [];
  for (let i = 0; i < 60; i++) {
    const target = Math.pow(10, (i * 3) / 59);
    let best = -1;
    for (const t of stored) {
      if (t < 1) continue;
      if (best < 1 || Math.abs(Math.log(t / target)) < Math.abs(Math.log(best / target))) best = t;
    }
    if (best >= 1 && !picks.includes(best)) picks.push(best);
  }
  picks.sort((a, b) => a - b);
  const sCol = decidingColumn(bank.S.log, combo.decider);
  const uCol = bank.U ? decidingColumn(bank.U.log, combo.decider) : null;
  const nCol = bank.N ? decidingColumn(bank.N.log, combo.decider) : null;
  const ss = combo.decider === "net" ? bank.S.sites.n_blk : bank.S.sites.n_occ;
  const idx = new Map(stored.map((t, i) => [t, i]));
  const wm = (col: number[] | null, t: number, tmax: number): number | null => {
    if (!col) return null;
    const m = windowMean(col, t, tmax);
    return m === null ? null : m / mS;
  };
  const at100 = wm(sCol, 100, REGIME.TRAJ_STEPS);
  const liveblk = bank.S.log.liveblk_R[0] ?? 0;
  return {
    t: picks,
    S: picks.map((t) => wm(sCol, t, REGIME.TRAJ_STEPS)),
    U: picks.map((t) => (t <= REGIME.DOSE_STEPS ? wm(uCol, t, REGIME.DOSE_STEPS) : null)),
    N: picks.map((t) => (t <= REGIME.DOSE_STEPS ? wm(nCol, t, REGIME.DOSE_STEPS) : null)),
    surv: picks.map((t) => {
      const i = idx.get(t);
      if (i === undefined || ss.length === 0) return null;
      return ss.filter((row) => row[i] > 0).length / ss.length;
    }),
    anchorN: at100,
    ordN: REGIME.ORD_R * (Math.max(bank.n0, 1) / mS),
    satN: liveblk > 0 ? (REGIME.SAT * liveblk) / mS : null,
  };
}

/** The three example runs (plan 8.6 item 2): the ORDERED pool job with the lowest e, the CRITICAL pool job with e nearest 0, the CHAOTIC pool job with the highest e, with the stated fallbacks. */
export function selectCards(rows: readonly SettingRow[], t0: readonly JobBundle[], combo: Combination, capturesDir: string | null): CardJson[] {
  const key = comboKey(combo);
  const poolIds = new Set(rows.filter(inPool).map((r) => r.id));
  const pool = t0.filter((b) => poolIds.has(b.summary.world) && isValidJob(b.summary, key));
  const rd = (b: JobBundle) => b.summary.readings[key]!;
  const tie = (a: JobBundle, b: JobBundle) => byStr(a.summary.id, b.summary.id);
  const withE = pool.filter((b) => isNum(rd(b).e));
  const mk = (slot: CardJson["slot"], kind: CardJson["kind"], note: string, b: JobBundle | null): CardJson => {
    if (!b) return { slot, kind: "none", note, id: null, setting: null, seed: null, jobClass: null, e: null, s30: null, b: null, ratioU: null, dust: null, saturated: null, form: null, mS: null, nCol: null, k: null, thetaB: null, series: null, capture: null };
    const r = rd(b);
    const f = bankFileOf(b, combo);
    return {
      slot, kind, note, id: b.summary.id, setting: b.summary.world, seed: b.summary.seed, jobClass: r.jobClass, e: r.e, s30: r.s30, b: r.b, ratioU: r.ratioU, dust: r.dust, saturated: r.saturated,
      form: r.form, mS: r.mS, nCol: r.nCol, k: f.bank?.k ?? null, thetaB: f.bank?.thetaB ?? null, series: cardSeries(f, combo),
      capture: capturesDir ? { id: b.summary.id, file: `captures/${b.summary.id}.json`, present: existsSync(join(capturesDir, `${b.summary.id}.json`)) } : null,
    };
  };
  const cards: CardJson[] = [];
  const ord = withE.filter((b) => rd(b).jobClass === "ORDERED").sort((a, b) => rd(a).e! - rd(b).e! || tie(a, b));
  cards.push(ord.length ? mk("ORDERED", "class", "the ORDERED pool job with the lowest e", ord[0])
    : withE.length ? mk("ORDERED", "nearest-e", "none: no ORDERED pool job has an e; the pool job with the lowest e is shown", [...withE].sort((a, b) => rd(a).e! - rd(b).e! || tie(a, b))[0])
    : mk("ORDERED", "none", "none: no pool job has a defined e", null));
  const crit = withE.filter((b) => rd(b).jobClass === "CRITICAL").sort((a, b) => Math.abs(rd(a).e!) - Math.abs(rd(b).e!) || tie(a, b));
  const dist = (b: JobBundle) => distanceToTarget(Math.log(Math.max(rd(b).s30 as number, REGIME.S_FLOOR)), "CRITICAL");
  const withS = pool.filter((b) => isNum(rd(b).s30));
  cards.push(crit.length ? mk("CRITICAL", "class", "the CRITICAL pool job with e nearest 0", crit[0])
    : withS.length ? mk("CRITICAL", "nearest-band", "no CRITICAL pool job: the pool job whose s(30) is nearest the band is shown", [...withS].sort((a, b) => dist(a) - dist(b) || tie(a, b))[0])
    : mk("CRITICAL", "none", "none: no pool job has a response ratio", null));
  const cha = withE.filter((b) => rd(b).jobClass === "CHAOTIC").sort((a, b) => rd(b).e! - rd(a).e! || tie(a, b));
  cards.push(cha.length ? mk("CHAOTIC", "class", "the CHAOTIC pool job with the highest e", cha[0])
    : withE.length ? mk("CHAOTIC", "nearest-e", "none: no CHAOTIC pool job has an e; the pool job with the highest e is shown", [...withE].sort((a, b) => rd(b).e! - rd(a).e! || tie(a, b))[0])
    : mk("CHAOTIC", "none", "none: no pool job has a defined e", null));
  return cards;
}

// ---- the R13 outcome strings --------------------------------------------------------------------------------------------

export const NOT_SWEPT: readonly string[] = [
  "kernelRadius (fixed at 3 for the slab: an R sweep is a kernel change)", "thetaMass", "massUnit", "kCatHalf", "every k* rate", "mutRate (except the one control)", "mutStep",
  "the energies eA..eP", "lightBase", "lightAmp", "seasons", "tileD",
];

export function rankingLines(rk: Ranking): string[] {
  if (rk.kind === "NO-RANKING" && rk.rows.length === 0) return [];
  return mdTable(["rank", "axis", "direction", "to", "Delta", "|log2| change", "best setting", "candidates"], rk.rows.map((r, i) => [i + 1, r.axis, r.direction ?? "", r.bestValue, r.delta === null ? "no candidate" : num(r.delta, 3), r.change === null ? "" : num(r.change, 3), r.best ?? "", r.candidates.join(", ")]));
}
export function rankingSentence(rk: Ranking): string {
  const defined = rk.rows.filter((r) => r.delta !== null);
  const top = defined.length ? defined[0].delta! : null;
  const tied = top === null ? [] : defined.filter((r) => r.delta! >= top - REGIME.TIE).map((r) => r.axis);
  return `Axis ranking: ${defined.map((r, i) => `${i + 1}. ${r.axis} ${r.direction} to ${r.bestValue} (Delta ${num(r.delta, 2)})`).join("; ")}.` +
    (tied.length > 1 ? ` Axes within ${REGIME.TIE} of the top are tied and ordered by the smaller change of the constant: ${tied.join(", ")}.` : "");
}
const noAxisSentence = (rk: Ranking): string =>
  `NO-AXIS: no swept constant moves the meters toward the target by more than a factor 1.4 or by more than B0's own seed-to-seed spread (top Delta ${num(rk.rows.find((r) => r.delta !== null)?.delta ?? null, 3)}, threshold ${num(Math.max(REGIME.NO_AXIS, rk.noise ?? 0), 3)}), so the levers are among the constants not swept (R2.3) or in the structure (kernel radius, topology).`;
/** R12.2: NO-RANKING has two readings. B0 cannot anchor a ranking, or B0 can and no swept axis has a candidate (every Delta NA): no constant was compared, which is not NO-AXIS. */
export const noRankingSentence = (rk: Ranking): string =>
  rk.reason === "NO-CANDIDATE"
    ? `NO-RANKING: no swept axis has a class-bearing setting next to ${B0_ID} on its tested list (every Delta is NA), so no constant was compared and no axis can be ranked or excluded.`
    : `NO-RANKING: ${B0_ID} is not in the pool with a class and at least two voting jobs, so no axis can be ranked.`;

export interface TextCtx {
  combo: Combination;
  /** Sweep jobs at T0 (seeds 101 to 106) and at T1, and all of them. */
  t0: readonly JobBundle[];
  t1: readonly JobBundle[];
  all: readonly JobBundle[];
  rows: readonly SettingRow[];
  screen: ConstantScreen | null;
  validation: ReturnType<typeof validateRun>;
  gate: GateFile;
}
export interface OutcomeText {
  text: string;
  details: string[];
  /** The settings and job ids the string names (for the page). */
  settings: string[];
  jobIds: string[];
  /** The jobs the reading scale is computed over. */
  named: JobBundle[];
}

const list = (xs: readonly string[]): string => (xs.length ? xs.join(", ") : "none");

/** The fixed wording of R13 for the outcome `o`, with its follow-up lines. The reading scale footer is added by `withFooter`. */
export function outcomeText(o: Outcome, x: TextCtx): OutcomeText {
  const key = comboKey(x.combo);
  const inWorlds = (bs: readonly JobBundle[], ids: readonly string[]) => bs.filter((b) => ids.includes(b.summary.world));
  const votersOf = (bs: readonly JobBundle[], ids: readonly string[], cls: RegimeClass) => inWorlds(bs, ids).filter((b) => b.summary.readings[key]?.vote && b.summary.readings[key]?.jobClass === cls).map((b) => b.summary.id);
  const poolBundles = inWorlds(x.t0, x.rows.filter(inPool).map((r) => r.id));
  const out = (text: string, details: string[], settings: string[], jobIds: string[], named: JobBundle[]): OutcomeText => ({ text, details, settings, jobIds, named });
  switch (o.id) {
    case "INVALID-RUN": {
      const v = invalidRunText(x.validation, x.all);
      return out(v.text, v.details, [], x.validation.invalid.map((j) => j.id), []);
    }
    case "GATE-FAIL":
      return out(x.gate.text, x.gate.details, [], [], []);
    case "NO-CONTRAST":
      return out(`NO CONTRAST: ${o.n} of ${o.of} class-bearing settings read ${o.refClass}; the meters do not separate these settings from one another. No inference. The settings are listed.`, [`Settings reading ${o.refClass}: ${list(o.settings)}`], o.settings, [], inWorlds(x.t0, o.settings));
    case "PENDING-LATE-CHECK": {
      const pend = o.late.late0.filter((id) => o.late.settings[id].status === "PENDING");
      return out(`PENDING: run the late check for ${list(pend)} (jobs ${list(o.missing)}).`, [`Target settings at T0: ${list(o.late.late0)}`, ...(o.late.uncheckedCap.length ? [`Unchecked (cap): ${list(o.late.uncheckedCap)}`] : [])], pend, o.missing, inWorlds(x.t0, o.late.late0));
    }
    case "BAND-FOUND": {
      const ids = [...votersOf(x.t0, o.settings, o.refClass), ...votersOf(x.t1, o.settings, o.refClass)];
      const inf = inferenceSentence(o)!;
      const crit = o.refClass === "CRITICAL";
      const strong = crit && o.amp === "AMP-ROBUST";
      const text = crit
        ? `BAND FOUND: ${strong ? "critical" : "CRITICAL"} class at T0 and T1 in ${list(o.settings)} (at this kick scale; ${o.amp}). The project's alive 2D worlds read ${strong ? "critical" : "in the CRITICAL class at this kick scale"}. ${inf} Next: look by eye inside the band (job ids ${list(ids)}).`
        : `ALIVE-LIKE SETTINGS FOUND: ${list(o.settings)} read chaotic at T0 and T1, like the project's alive 2D worlds. This does not test the criticality hypothesis. ${inf} Next: look by eye (job ids ${list(ids)}).`;
      return out(text, [`Also listed: transient ${list(o.late.transient)}; inconclusive ${list(o.late.inconclusive)}; unchecked (cap) ${list(o.late.uncheckedCap)}`], o.settings, ids, [...inWorlds(x.t0, o.settings), ...inWorlds(x.t1, o.settings)]);
    }
    case "LATE-INCONCLUSIVE":
      return out(`LATE INCONCLUSIVE: ${list(o.late.inconclusive)} read ${o.refClass} at T0 and their T1 evidence was insufficient (fewer than 2 valid jobs after all late jobs ran). No inference. Transient: ${list(o.late.transient)}. Unchecked (cap): ${list(o.late.uncheckedCap)}.`, [], o.late.inconclusive, votersOf(x.t0, o.late.late0, o.refClass), inWorlds(x.t0, o.late.late0));
    case "TRANSIENT-BAND": {
      const ids = votersOf(x.t0, o.late.late0, o.refClass);
      return out(`TRANSIENT BAND: ${list(o.late.late0)} read ${o.refClass} at T0 but not at T1. A stage of the transient, not a standing band. Look by eye at the T0 states (job ids ${list(ids)}).`, [`Unchecked (cap): ${list(o.late.uncheckedCap)}`], o.late.late0, ids, inWorlds(x.t0, o.late.late0));
    }
    case "EMPTY-WINDOW":
      return out("EMPTY WINDOW: no setting had 2 valid in-window jobs. Re-centre the sweep on the livable region before drawing anything.", [`Setting statuses: ${x.rows.filter((r) => !r.control).map((r) => `${r.id} ${r.result.status}${r.result.cls ? ` ${r.result.cls}` : ""}`).join("; ")}`], [], [], [...x.t0]);
    case "TOO-MANY-UNMETERABLE": {
      const livable = x.rows.filter((r) => !r.control && r.result.status !== "UNMETERABLE").map((r) => r.id);
      return out(`TOO MANY UNMETERABLE: ${o.n} of ${o.of} settings were extinct or had no target in 2 of 3 seeds. No inference. The livable settings are listed.`, [`Livable settings: ${list(livable)}`], livable, [], [...x.t0]);
    }
    case "THIN-POOL":
      return out(`THIN POOL: ${o.classBearing} class-bearing settings spanning ${o.axes.length} swept axes (the rule needs ${REGIME.POOL_MIN} and ${REGIME.AXES_MIN}). No inference.`, [`Class-bearing settings: ${list(x.rows.filter(isClassBearing).map((r) => `${r.id} ${r.result.cls}`))}`, `Axes spanned: ${list(o.axes)}`], x.rows.filter(isClassBearing).map((r) => r.id), [], poolBundles);
    case "SENSITIVE-EVERYWHERE": {
      const wb = x.rows.filter(inPool).map((r) => `${r.id}: ${r.result.cls}${r.result.wouldBe ? `, would-be ${r.result.wouldBe}` : ""}`);
      return out(`SENSITIVE EVERYWHERE: ${o.n} of ${o.of} valid jobs were not DUST_CLEAR (observed dose insensitivity at step ${REGIME.TAU_DEC}). No band can be read or excluded here. The would-be classes are listed.`, [`Pool settings: ${list(wb)}`], x.rows.filter(inPool).map((r) => r.id), [], poolBundles);
    }
    case "UNDER-SUPPORTED":
      return out(`UNDER-SUPPORTED: ${o.n} of ${o.of} valid jobs were D_ONLY (too few sites or colonies, or overlapping damage), so the trajectory meter could not certify a band. No inference.`, [], x.rows.filter(inPool).map((r) => r.id), [], poolBundles);
    case "UNRESOLVED":
    case "UNRESOLVED-FINAL": {
      const split = x.rows.filter(inPool).filter((r) => r.result.cls === "SPLIT").map((r) => r.id);
      const ext = split.flatMap((id) => SEEDS.extension.map((seed) => jobId({ kind: "slab", world: id, seed, T: REGIME.T0, rung: x.combo.rung, decider: x.combo.decider })));
      const text = o.id === "UNRESOLVED"
        ? `UNRESOLVED: ${o.n} of ${o.pool} settings split across seeds. The meters are too noisy at these settings. No inference.`
        : `UNRESOLVED-FINAL: ${o.n} of ${o.pool} settings split across seeds after the seed extension. The meters are too noisy at these settings. No inference.`;
      // UNRESOLVED-FINAL is only reached once every SPLIT setting has all of seeds 104 to 106 (the reader refuses a started, incomplete extension)
      return out(text, [`SPLIT settings: ${list(split)}`, ...(o.id === "UNRESOLVED" ? [`Next (R8.5): run the extension once, seeds 104 to 106 at T0 under ${comboLabel(x.combo)}, jobs ${list(ext)}; then read again.`] : [])], split, o.id === "UNRESOLVED" ? ext : [], inWorlds(x.t0, split));
    }
    case "CROSSING-BRACKETED": {
      const cls = (id: string) => x.rows.find((r) => r.id === id)?.result.cls ?? "";
      const inf = inferenceSentence(o)!;
      const first = o.brackets[0];
      const text = `CROSSING BRACKETED between ${first.a} (${cls(first.a)}) and ${first.b} (${cls(first.b)}) along ${first.axis}. ${inf}`;
      const details = [
        ...o.brackets.slice(1).map((b) => `Also bracketed: ${b.a} (${cls(b.a)}) and ${b.b} (${cls(b.b)}) along ${b.axis}.`),
        ...(o.ranking.kind === "RANKED" ? [rankingSentence(o.ranking)] : o.ranking.kind === "NO-AXIS" ? [noAxisSentence(o.ranking)] : [noRankingSentence(o.ranking)]),
      ];
      const ids = unique(o.brackets.flatMap((b) => [b.a, b.b]));
      return out(text, details, ids, [], inWorlds(x.t0, ids));
    }
    case "NO-BAND": {
      const inf = inferenceSentence(o)!;
      const tail = o.ranking.kind === "RANKED" ? rankingSentence(o.ranking) : o.ranking.kind === "NO-AXIS" ? noAxisSentence(o.ranking) : noRankingSentence(o.ranking);
      const bearing = x.rows.filter(isClassBearing).map((r) => r.id);
      const details: string[] = [];
      if (o.ranking.kind === "NO-AXIS") {
        details.push(`Constants not swept: ${NOT_SWEPT.join("; ")}.`);
        details.push(...constantScreenLines(x.screen));
      }
      return out(`NO BAND (${o.label}). ${inf} ${tail}`, details, bearing, [], inWorlds(x.t0, bearing));
    }
  }
}

export const withFooter = (t: OutcomeText, x: TextCtx, outcomeId: string): string => {
  if (outcomeId === "INVALID-RUN") return "";
  if (outcomeId === "GATE-FAIL") return x.gate.footer;
  return footerLine(t.named.length ? t.named : x.t0, x.all, x.combo);
};

// ---- sensitivity table (R13: printed, never used) ----------------------------------------------------------------------

export interface SensitivityTable {
  columns: { constant: string; direction: "widen" | "narrow" }[];
  rows: { id: string; base: string; cells: string[] }[];
  changed: number;
}

/** Every setting's class with each of ten constants moved by 25 percent in the direction that widens, then narrows, the CRITICAL band: the same M0 code re-run on the job banks. */
export function sensitivityTable(t0: readonly JobBundle[], combo: Combination, baseRows: readonly SettingRow[]): SensitivityTable {
  const specs = sweepSettings();
  const scenarios = sensitivityScenarios();
  const rows = specs.map((sp) => ({ id: sp.id, base: classLetter(baseRows.find((r) => r.id === sp.id)!), cells: [] as string[] }));
  for (const sc of scenarios) {
    const sums = t0.map((b) => {
      const parts = b.files.map((f) => summarizeJob(f, [combo.decider], sc.consts));
      const s = parts.length === 1 ? parts[0] : mergeSummaries(parts);
      if (b.restamp.length) { s.invalid = true; }
      return s;
    });
    const rr = buildSettingRows(sums, combo, specs, sc.consts);
    rows.forEach((row, i) => row.cells.push(classLetter(rr[i])));
  }
  return { columns: scenarios.map((s) => ({ constant: s.constant, direction: s.direction })), rows, changed: rows.filter((r) => r.cells.some((c) => c !== r.base)).length };
}

// ---- results JSON (the page's contract) --------------------------------------------------------------------------------

export interface JobBrief {
  id: string;
  setting: string;
  seed: number;
  T: number;
  status: string;
  flags: string;
  jobClass: string | null;
  tClass: string;
  dClass: string | null;
  e: number | null;
  s30: number | null;
  s100: number | null;
  s300: number | null;
  b: number | null;
  ratioU: number | null;
  dust: string;
  vote: boolean;
  saturated: boolean | null;
  form: string | null;
  mS: number | null;
  nCol: number | null;
  k: number | null;
  f: number;
  speed: number | null;
  stT: number | null;
  stD: boolean | null;
}
export interface SettingJson {
  id: string;
  group: string;
  control: boolean;
  params: SettingParams;
  status: string;
  cls: string | null;
  wouldBe: string | null;
  votes: Record<RegimeClass, number>;
  voting: number;
  valid: number;
  ell: number | null;
  d: number | null;
  /** The cell colour of the map: median of e over the setting's jobs that have one (METERED, not INVALID), and the number of jobs it is made of. */
  eMed: number | null;
  eN: number;
  /** The second colouring: median over the setting's jobs of ln(max(s(30), S_FLOOR)). */
  lnS30Med: number | null;
  target: boolean;
  t1: { status: string; cls: string | null; statusAtT1: string | null } | null;
  brackets: string[];
  inert: boolean;
  seeds: number[];
  jobs: JobBrief[];
}
export interface OutcomeJson {
  id: string;
  text: string;
  details: string[];
  footer: string;
  fatal: boolean;
  inference: string | null;
  refClass: RegimeClass | null;
  amp: AmpLabel | null;
  settings: string[];
  jobIds: string[];
  ranking: Ranking | null;
  brackets: { a: string; b: string; axis: string }[];
  label: string | null;
  late: LateResult | null;
}
export interface ResultsJson {
  schema: "regime-results/1";
  label: "" | "DRAFT" | "SYNTHETIC";
  synthetic: boolean;
  draft: boolean;
  rule: { path: string; sha256: string; status: "FROZEN" | "DRAFT"; devLogSha: string };
  stamps: { ruleSha: string[]; codeCommit: string[]; srcHash: string[] };
  combo: { rung: Rung; decider: Decider };
  constants: Record<string, number | string>;
  gate: {
    pass: boolean; refClass: RegimeClass | null; amp: AmpLabel | null; rung: Rung; decider: Decider; text: string; details: string[]; footer: string; causes: GateCause[];
    conditions: GateCondition[]; groups: GateGroup[]; curves: GateFile["curves"]; m4Files: number; ruleSha: string;
  };
  outcome: OutcomeJson;
  axes: { name: Axis; values: number[]; base: number }[];
  settings: SettingJson[];
  /** The late-check jobs (T1) in brief. */
  t1Jobs: JobBrief[];
  /** Dose curves of the sweep's T0 jobs by job id (response ratio per dose and tau, plus the pooled ratio). */
  curves: Record<string, DoseCurve>;
  cards: CardJson[];
  notSwept: string[];
  constantScreen: ConstantScreen | null;
  counts: { jobs: number; t0: number; t1: number; extension: number; invalid: number };
  /** Settings declared not run (--allow-missing): named here so that a trimmed sweep is never silent. They read INSUFFICIENT. */
  trimmed: string[];
  /** The sweep jobs carry another codeCommit or srcHash than the gate jobs (a note, not a refusal: R9.5 asks for the rule's hash only). */
  sourceChanged: boolean;
}

function jobBrief(b: JobBundle, combo: Combination): JobBrief {
  const s = b.summary;
  const r = s.readings[comboKey(combo)];
  const f = bankFileOf(b, combo);
  return {
    id: s.id, setting: s.world, seed: s.seed, T: s.T, status: statusOf(s, r), flags: flagsOf(s, r).join(","), jobClass: r ? r.jobClass : null, tClass: r ? r.tClass : "NA", dClass: r ? r.dClass : null,
    e: r ? r.e : null, s30: r ? r.s30 : null, s100: r ? r.s[1] : null, s300: r ? r.s[2] : null, b: r ? r.b : null, ratioU: r ? r.ratioU : null, dust: r ? r.dust : "UNAVAILABLE", vote: r ? r.vote : false,
    saturated: r ? r.saturated : null, form: r ? r.form : null, mS: f.bank ? f.bank.sites.length : null, nCol: f.bank ? f.bank.nCol : null, k: f.bank ? f.bank.k : null, f: s.f,
    speed: r ? r.speed : null, stT: r ? r.stT : null, stD: r ? r.stD : null,
  };
}

// ---- the sweep ---------------------------------------------------------------------------------------------------------

export interface SweepOptions {
  label: "" | "DRAFT" | "SYNTHETIC";
  screen: ConstantScreen | null;
  capturesDir: string | null;
  sensitivity: boolean;
  /**
   * Settings that were deliberately not run (the plan's trim order, section 9: the control, group B, gateK 1024, the lightK 4096 carpets). Each must have
   * no job at all; the readout names them in its outcome details and in regime-results.json, so a trim is never silent. They read INSUFFICIENT.
   */
  allowMissing?: readonly string[];
  /** false skips the check that the T0 jobs are the whole catalogue at seeds 101 to 103 (the tests of the decisions use partial tables; the CLI never sets it). */
  roster?: boolean;
}
export interface SweepResult {
  outcomeId: string;
  text: string;
  details: string[];
  footer: string;
  exit: number;
  jobColumns: readonly string[];
  jobRows: Record<string, Cell>[];
  settingRows: Record<string, Cell>[];
  md: string[];
  results: ResultsJson;
}

/**
 * R3 to R12 on the sweep jobs. The gate verdict comes from `gate` (gate.json), never from the gate jobs; the decisions are the M0 `decideOutcome`
 * (which evaluates R10 in its order: INVALID-RUN, GATE-FAIL, NO-CONTRAST, the late check, the empty-target clauses). `allBundles` may hold other
 * roles (they are ignored); a Stage 0 job, a 2D job, a job at another start step or a job of a setting outside the catalogue is a refusal.
 */
export function evaluateSweepJobs(allBundles: readonly JobBundle[], rule: RuleInfo, gate: GateFile, combo: Combination, opts: SweepOptions): SweepResult {
  const bundles = allBundles.filter((b) => !GATE_ROLES.has(b.summary.role));
  if (bundles.some((b) => b.summary.dev)) throw new ReaderError("Stage 0 (dev) jobs are among the sweep jobs; they live in runs/regime/dev and never enter a readout");
  if (bundles.some((b) => b.summary.kind !== "slab")) throw new ReaderError("a 2D job is among the sweep jobs (2D worlds are read by the gate only)");
  assertNoMixedSynthetic(bundles);
  const specs = sweepSettings();
  const known = new Set(specs.map((s) => s.id));
  for (const b of bundles) {
    if (b.summary.T !== REGIME.T0 && b.summary.T !== REGIME.T1) throw new ReaderError(`job ${b.summary.id}: start step ${b.summary.T} is neither T0 ${REGIME.T0} nor T1 ${REGIME.T1}`);
    if (!known.has(b.summary.world)) throw new ReaderError(`job ${b.summary.id}: ${b.summary.world} is not a setting of the catalogue (R2.3)`);
    if (b.files.some((f) => f.bank && f.bank.rung !== combo.rung)) throw new ReaderError(`job ${b.summary.id} was run under rung ${b.files.find((f) => f.bank)!.bank!.rung}, but the selected combination is ${comboLabel(combo)}`);
  }
  if (gate.pass && bundles.length === 0) throw new ReaderError("no sweep jobs were found in the job directory");
  const trimmed = unique(opts.allowMissing ?? []).sort(byStr);
  for (const id of trimmed) {
    if (!known.has(id)) throw new ReaderError(`--allow-missing names ${id}, which is not a setting of the catalogue (R2.3)`);
    if (bundles.some((b) => b.summary.world === id)) throw new ReaderError(`--allow-missing names ${id}, but jobs of ${id} exist: only a setting that was not run at all can be left out`);
  }
  const key = comboKey(combo);
  const t0 = bundles.filter((b) => b.summary.T === REGIME.T0).sort(bySettingSeed);
  const t1 = bundles.filter((b) => b.summary.T === REGIME.T1).sort(bySettingSeed);
  if (gate.pass && opts.roster !== false) assertRoster(checkSweepRoster(t0, combo, trimmed, specs), "the sweep job set");
  const sums = bundles.map((b) => b.summary);
  const validation = validateRun(sums);
  const digestsOf = (id: string): Record<number, string> => Object.fromEntries(t0.filter((b) => b.summary.world === id).flatMap((b) => (b.files[0].stateDigestT ? [[b.summary.seed, b.files[0].stateDigestT] as [number, string]] : [])));
  const inert = new Set<string>();
  for (const sp of specs) {
    const d = axesDiffering(sp.params);
    if (!sp.control && d.length === 1 && d[0] === "gateK" && isInertGateK(digestsOf(sp.id), digestsOf(B0_ID))) inert.add(sp.id);
  }
  const refClass: RegimeClass = gate.refClass ?? "CRITICAL";
  const amp: AmpLabel = gate.amp ?? "AMP-DEPENDENT";
  // R10 on the table of seeds 101 to 103; if it gives UNRESOLVED, the extension of R8.5 (seeds 104 to 106, once, for the SPLIT settings) is read and R10 again.
  const wx = sweepWithExtension({
    t0: t0.map((b) => b.summary), combo, specs,
    input: {
      validation, gate: { pass: gate.pass, causes: gate.causes, others: gate.others.map((o) => ({ combo: comboOf(o.combo), causes: o.causes })) },
      refClass, amp, combo, late: { t1Jobs: t1.map((b) => b.summary) }, inert,
    },
  });
  const { rows, outcome } = wx;
  if (gate.pass && !validation.fatal) {
    const jobs = (xs: readonly { world: string; seed: number }[]) => xs.map((e) => jobId({ kind: "slab", world: e.world, seed: e.seed, T: REGIME.T0, rung: combo.rung, decider: combo.decider }));
    if (wx.ext.unlicensed.length)
      throw new ReaderError(`REFUSED: ${wx.ext.unlicensed.length} extension job(s) that R8.5 does not license (the extension is run once, for the settings that are SPLIT at seeds 101 to 103, when R10 gives UNRESOLVED there; it gave ${wx.baseOutcome.id}): ${jobs(wx.ext.unlicensed).join(", ")}`);
    if (wx.ext.started && wx.ext.missing.length)
      throw new ReaderError(`REFUSED: the seed extension (R8.5) is incomplete: ${wx.ext.missing.length} job(s) missing (every SPLIT setting needs all of seeds 104 to 106): ${jobs(wx.ext.missing).join(", ")}`);
    // R11: late-check jobs exist only for the settings of LATE0, at the seeds of their T0 jobs
    const listed = new Set<string>();
    if ("late" in outcome) for (const id of outcome.late.late0) for (const s of rows.find((r) => r.id === id)?.seeds ?? []) listed.add(`${id}|${s}`);
    const stray = t1.filter((b) => !listed.has(`${b.summary.world}|${b.summary.seed}`));
    if (stray.length) throw new ReaderError(`REFUSED: ${stray.length} late-check job(s) that R11 does not list (LATE0 is the first ${REGIME.LATE_MAX} target settings; a setting beyond the cap is never run): ${stray.map((b) => b.summary.id).join(", ")}`);
  }
  const ctx: TextCtx = { combo, t0, t1, all: bundles, rows, screen: opts.screen, validation, gate };
  const ot = outcomeText(outcome, ctx);
  if (trimmed.length) ot.details.unshift(`Trimmed settings (declared with --allow-missing; no job was run for them, they read INSUFFICIENT): ${trimmed.join(", ")}.`);
  const gateSrc = gate.stamps ?? { ruleSha: [], codeCommit: [], srcHash: [] };
  const sourceChanged = (["codeCommit", "srcHash"] as const).some((k) => gateSrc[k].length > 0 && validation.mixed[k].length > 0 && validation.mixed[k].some((v) => !gateSrc[k].includes(v)));
  if (sourceChanged) ot.details.push(`NOTE: the sweep jobs carry codeCommit ${list(validation.mixed.codeCommit.map((s) => s.slice(0, 12)))} and srcHash ${list(validation.mixed.srcHash.map((s) => s.slice(0, 12)))}, the gate jobs ${list(gateSrc.codeCommit.map((s) => s.slice(0, 12)))} and ${list(gateSrc.srcHash.map((s) => s.slice(0, 12)))}: the instrument changed between the gate and the sweep (R9.5 asks only for the rule's hash; the main session decides whether the gate stands).`);
  const footer = withFooter(ot, ctx, outcome.id);
  const brackets = findBrackets(rows, inert);
  const late: LateResult | null = "late" in outcome ? outcome.late : null;
  const ruleCol = opts.label || rule.sha256.slice(0, 12);
  const groupOf = new Map(specs.map((s) => [s.id, s.group]));
  const targetIds = new Set(rows.filter((r) => isClassBearing(r) && r.result.cls === refClass).map((r) => r.id));

  // Job rows.
  const jobBundles = [...t0, ...t1];
  const jobRows = jobBundles.map((b) => jobRow(b, combo, ruleCol));
  // Setting rows and JSON.
  const settingRows: Record<string, Cell>[] = [];
  const settings: SettingJson[] = [];
  const curves: Record<string, DoseCurve> = {};
  for (const b of t0) {
    const c = doseCurveOf(bankFileOf(b, combo), combo.decider);
    if (c) curves[b.summary.id] = c;
  }
  for (const row of rows) {
    const r = row.result;
    const own = t0.filter((b) => b.summary.world === row.id);
    const briefs = own.map((b) => jobBrief(b, combo));
    const eVals = briefs.filter((j) => j.status !== "INVALID" && isNum(j.e)).map((j) => j.e as number);
    const lnS = briefs.filter((j) => j.status !== "INVALID" && isNum(j.s30)).map((j) => Math.log(Math.max(j.s30 as number, REGIME.S_FLOOR)));
    const partners = brackets.filter((br) => br.a === row.id || br.b === row.id).map((br) => (br.a === row.id ? br.b : br.a));
    const lt = late && late.settings[row.id] ? late.settings[row.id] : null;
    const d = r.ell !== null ? distanceToTarget(r.ell, refClass) : null;
    const isTarget = targetIds.has(row.id) && !row.control;
    settings.push({
      id: row.id, group: groupOf.get(row.id) ?? "", control: row.control, params: row.params, status: r.status, cls: r.cls, wouldBe: r.wouldBe, votes: r.votes, voting: r.voting, valid: r.valid,
      ell: r.ell, d, eMed: median(eVals), eN: eVals.length, lnS30Med: median(lnS), target: isTarget, t1: lt ? { status: lt.status, cls: lt.cls, statusAtT1: lt.statusAtT1 } : null,
      brackets: partners, inert: inert.has(row.id), seeds: row.seeds, jobs: briefs,
    });
    settingRows.push({
      setting: row.id, group: groupOf.get(row.id) ?? "", status: r.status, class: r.cls ?? "", wouldBe: r.wouldBe ?? "", votesORDERED: r.votes.ORDERED, votesCRITICAL: r.votes.CRITICAL, votesCHAOTIC: r.votes.CHAOTIC,
      voting: r.voting, valid: r.valid, ell: r.ell, d, target: isTarget, T1status: lt ? lt.status : "", T1class: lt?.cls ?? "", bracket: partners.join("|"), inert: inert.has(row.id), seeds: row.seeds.join("/"), rule: ruleCol,
    });
  }
  const cards = gate.pass && outcome.id !== "INVALID-RUN" ? selectCards(rows, t0, combo, opts.capturesDir) : [];
  const sens = opts.sensitivity && gate.pass && outcome.id !== "INVALID-RUN" && t0.length ? sensitivityTable(t0, combo, rows) : null;

  const outcomeJson: OutcomeJson = {
    id: outcome.id, text: ot.text, details: ot.details, footer, fatal: "fatal" in outcome ? outcome.fatal : false, inference: "inference" in outcome && outcome.inference ? inferenceSentence(outcome) : null,
    refClass: gate.refClass, amp: gate.amp, settings: ot.settings, jobIds: ot.jobIds, ranking: "ranking" in outcome ? outcome.ranking : null,
    brackets: outcome.id === "CROSSING-BRACKETED" ? outcome.brackets : [], label: outcome.id === "NO-BAND" ? outcome.label : null, late,
  };
  const results: ResultsJson = {
    schema: "regime-results/1", label: opts.label, synthetic: opts.label === "SYNTHETIC", draft: rule.status === "DRAFT",
    rule: { path: rule.path, sha256: rule.sha256, status: rule.status, devLogSha: rule.devLogSha },
    stamps: validation.mixed, combo, constants: constantsForPage(), gate: {
      pass: gate.pass, refClass: gate.refClass, amp: gate.amp, rung: gate.rung, decider: gate.decider, text: gate.text, details: gate.details, footer: gate.footer, causes: gate.causes,
      conditions: gate.conditions, groups: gate.groups, curves: gate.curves, m4Files: Object.keys(gate.m4Manifest).length, ruleSha: gate.ruleSha,
    },
    outcome: outcomeJson, axes: AXES.map((a) => ({ name: a, values: [...AXIS_LISTS[a]], base: B0_PARAMS[a] })), settings, t1Jobs: t1.map((b) => jobBrief(b, combo)), curves, cards,
    notSwept: [...NOT_SWEPT], constantScreen: opts.screen,
    counts: { jobs: bundles.length, t0: t0.length, t1: t1.length, extension: t0.filter((b) => SEEDS.extension.includes(b.summary.seed)).length, invalid: validation.invalid.length },
    trimmed: [...trimmed], sourceChanged,
  };
  const md = sweepMarkdown({ rule, gate, combo, label: opts.label, outcome: outcomeJson, ot, settings, rows, late, brackets, inert, cards, sens, bundles, t0, t1, validation, results, key, ruleCol });
  return { outcomeId: outcome.id, text: ot.text, details: ot.details, footer, exit: outcome.id === "INVALID-RUN" ? 1 : 0, jobColumns: JOB_COLUMNS, jobRows, settingRows, md, results };
}

export function constantsForPage(): Record<string, number | string> {
  return {
    T0: REGIME.T0, T1: REGIME.T1, TAU_DEC: REGIME.TAU_DEC, D_LO: REGIME.D_LO, D_HI: REGIME.D_HI, B_LO: REGIME.B_LO, B_HI: REGIME.B_HI, ORD_R: REGIME.ORD_R, SAT: REGIME.SAT,
    R_AMP: REGIME.R_AMP, DUST_CLEAR: REGIME.DUST_CLEAR, DUST_LIM: REGIME.DUST_LIM, S_FLOOR: REGIME.S_FLOOR, SPEED_MIN: REGIME.SPEED_MIN, TAU: REGIME.TAU.join(","), TRAJ: REGIME.TRAJ.join(","),
  };
}

// ---- regime-readout.md -------------------------------------------------------------------------------------------------

interface MdIn {
  rule: RuleInfo;
  gate: GateFile;
  combo: Combination;
  label: "" | "DRAFT" | "SYNTHETIC";
  outcome: OutcomeJson;
  ot: OutcomeText;
  settings: SettingJson[];
  rows: SettingRow[];
  late: LateResult | null;
  brackets: { a: string; b: string; axis: Axis }[];
  inert: Set<string>;
  cards: CardJson[];
  sens: SensitivityTable | null;
  bundles: JobBundle[];
  t0: JobBundle[];
  t1: JobBundle[];
  validation: ReturnType<typeof validateRun>;
  results: ResultsJson;
  key: ComboKey;
  ruleCol: string;
}

function sweepMarkdown(m: MdIn): string[] {
  const L: string[] = [];
  const b = banner(m.label);
  if (b) L.push(b, "");
  L.push("# Regime readout (R13)", "");
  L.push(`Rule: ${m.rule.status} \`${m.rule.path}\`, SHA-256 \`${m.rule.sha256}\`. Gate: ${m.gate.pass ? "PASS" : "FAIL"}, combination ${comboLabel(m.combo)}, refClass ${m.gate.refClass ?? "none"} (${m.gate.amp ?? "no label"}).`);
  L.push(`Jobs read: ${m.bundles.length} (T0 ${m.t0.length}, T1 ${m.t1.length}, of which extension seeds ${m.results.counts.extension}). Stamps: ruleSha ${list(m.validation.mixed.ruleSha.map((s) => s.slice(0, 12)))}; codeCommit ${list(m.validation.mixed.codeCommit.map((s) => s.slice(0, 12)))}; srcHash ${list(m.validation.mixed.srcHash.map((s) => s.slice(0, 12)))}.`, "");
  if (m.results.trimmed.length) L.push(`TRIMMED: ${list(m.results.trimmed)} were not run (declared with --allow-missing); they read INSUFFICIENT and are in no pool.`, "");
  L.push("## Outcome", "", m.outcome.text, "");
  for (const d of m.outcome.details) L.push(`- ${d}`);
  if (m.outcome.footer) L.push("", m.outcome.footer);
  L.push("");
  if (m.outcome.id === "INVALID-RUN" || m.outcome.id === "GATE-FAIL") {
    if (m.outcome.id === "GATE-FAIL") L.push("The gate failed: no sweep is read (R9.4).", "");
    return L;
  }
  L.push(`## Settings at T0 (${REGIME.T0})`, "");
  L.push(...mdTable(["setting", "group", "status", "class", "votes O/C/X", "voting / valid", "e (median)", "ell", "d", "target", "T1"], m.settings.map((s) => [
    s.id + (s.control ? " (control)" : ""), s.group, s.status, s.cls ?? "", `${s.votes.ORDERED}/${s.votes.CRITICAL}/${s.votes.CHAOTIC}`, `${s.voting} / ${s.valid}`, num(s.eMed, 2), num(s.ell, 3), num(s.d, 3), s.target, s.t1 ? `${s.t1.status}${s.t1.cls ? ` ${s.t1.cls}` : ""}` : "",
  ])), "");
  const wb = m.settings.filter((s) => s.wouldBe && s.cls === "DUSTY");
  if (wb.length) L.push(`DUSTY settings and their would-be classes: ${wb.map((s) => `${s.id} (${s.wouldBe})`).join(", ")}.`, "");
  if (m.late) {
    L.push(`## Late check (R11), T1 = ${REGIME.T1}`, "", `LATE0: ${list(m.late.late0)}. Unchecked (cap): ${list(m.late.uncheckedCap)}.`, "");
    L.push(...mdTable(["setting", "status", "class at T1", "status at T1", "missing jobs"], Object.entries(m.late.settings).map(([id, s]) => [id, s.status, s.cls ?? "", s.statusAtT1 ?? "", s.missing.join(", ")])), "");
  }
  L.push("## Brackets and INERT gateK", "", `Brackets (R10; they decide only when refClass is CRITICAL): ${m.brackets.length ? m.brackets.map((x) => `${x.a} / ${x.b} along ${x.axis}`).join("; ") : "none"}.`, `INERT gateK settings (R12.3, state digest equal to B0's for every seed): ${list([...m.inert])}.`, "");
  if (m.outcome.ranking && (m.outcome.ranking.kind !== "NO-RANKING" || m.outcome.ranking.rows.length > 0)) {
    const rk = m.outcome.ranking;
    L.push("## Axis ranking (R12)", "", `d(B0) = ${num(rk.dB0, 3)}; NOISE (B0's seed-to-seed range of ln s(${REGIME.TAU_DEC})) = ${num(rk.noise, 3)}; NO_AXIS = ${REGIME.NO_AXIS}; kind ${rk.kind}${rk.reason ? ` (${rk.reason})` : ""}.`, "", ...rankingLines(rk), "");
  }
  L.push("## Example runs (plan 8.6)", "", ...mdTable(["slot", "kind", "job", "class", "e", "s(30)", "capture"], m.cards.map((c) => [c.slot, c.kind, c.id ?? "none", c.jobClass ?? "", num(c.e, 2), num(c.s30, 2), c.capture ? (c.capture.present ? "present" : "run --capture") : ""])), "");
  const need = m.cards.filter((c) => c.capture && !c.capture.present).map((c) => c.id as string);
  if (need.length) L.push(`Captures to run (about 6 minutes): ${need.join(", ")}.`, "");
  L.push("## Jobs", "", ...mdTable(["job", "status", "flags", "class", "T-class", "D-class", "e", "s(30)", "ratio_U", "dust", "vote", "k", "m_S"], [...m.t0, ...m.t1].map((bb) => {
    const j = jobBrief(bb, m.combo);
    return [j.id, j.status, j.flags, j.jobClass ?? "", j.tClass, j.dClass ?? "", num(j.e, 2), num(j.s30, 2), num(j.ratioU, 2), j.dust, j.vote, j.k, j.mS];
  })), "");
  if (m.sens) {
    L.push("## Sensitivity table (printed, never used)", "", `Each class letter is the setting's class with one constant moved by 25 percent in the direction that widens (w) or narrows (n) the CRITICAL band. O ORDERED, C CRITICAL, X CHAOTIC, S SPLIT, D DUSTY, I INSUFFICIENT, U UNMETERABLE, K CARPET, R RELIC. ${m.sens.changed} of ${m.sens.rows.length} settings change class under some move.`, "");
    L.push(...mdTable(["setting", "base", ...m.sens.columns.map((c) => `${c.constant} ${c.direction === "widen" ? "w" : "n"}`)], m.sens.rows.map((r) => [r.id, r.base, ...r.cells])), "");
  } else L.push("## Sensitivity table", "", "Not computed (--no-sensitivity or no metered job).", "");
  L.push("## Development log (R0.2)", "", "```", m.rule.devLog || "(the rule holds no R0.2 block)", "```", "");
  const rc = reproCounts(m.bundles.map((x) => x.summary));
  L.push("## Reproduction of M4's burn-in", "", `C4 living-trace agreement: ${rc.json.passed} of ${rc.json.total} by exact JSON, ${rc.tsv.passed} of ${rc.tsv.total} by rounded TSV, ${rc.notApplicable} not applicable (groups C and D, the control, extension seeds).`, "");
  return L;
}

// =====================================================================================================================
// Files and the CLI

/** A JSON replacer that keeps six significant digits (the page and the TSV never need more, and the file is inlined into the page). */
export const round6 = (_k: string, v: unknown): unknown => (typeof v === "number" && Number.isFinite(v) ? Number(v.toPrecision(6)) : v);

/** Writes `text` to `path` through `<path>.tmp` and a rename, creating the directory. */
export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

export interface IO {
  log: (s: string) => void;
  err: (s: string) => void;
}
const consoleIO: IO = { log: (s) => console.log(s), err: (s) => console.error(s) };

export const USAGE = `usage: regime-readout.ts (--dev [--run=N] | --gate | --sweep) [--draft] [--root=DIR] [--jobs=DIR] [--out=DIR] [--rule=FILE] [--combo=P1-net|P1-occ|P2-net|P2-occ]
                         [--gate-file=FILE] [--captures=DIR] [--no-sensitivity] [--allow-missing=<setting,...>]`;

export function parseArgs(argv: readonly string[]): { mode: "dev" | "gate" | "sweep"; opts: Options } {
  const flags = new Set<string>();
  const kv: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new ReaderError(`unknown argument ${a}\n${USAGE}`);
    if (m[2] === undefined) flags.add(m[1]);
    else kv[m[1]] = m[2];
  }
  const known = new Set(["dev", "gate", "sweep", "draft", "no-sensitivity", "help", "root", "jobs", "out", "rule", "combo", "run", "gate-file", "captures", "allow-missing"]);
  for (const k of [...flags, ...Object.keys(kv)]) if (!known.has(k)) throw new ReaderError(`unknown option --${k}\n${USAGE}`);
  if (flags.has("help")) throw new ReaderError(USAGE, 0);
  const modes = (["dev", "gate", "sweep"] as const).filter((m) => flags.has(m));
  if (modes.length !== 1) throw new ReaderError(`give exactly one of --dev, --gate, --sweep\n${USAGE}`);
  const run = kv.run === undefined ? undefined : Number(kv.run);
  if (run !== undefined && !(Number.isInteger(run) && run >= 1 && run <= REGIME.STAGE0_RUNS)) throw new ReaderError(`--run must be an integer from 1 to ${REGIME.STAGE0_RUNS}`);
  if (kv["allow-missing"] !== undefined && modes[0] !== "sweep") throw new ReaderError("--allow-missing is only for --sweep (the gate and Stage 0 rosters have no trims)");
  const allowMissing = kv["allow-missing"] === undefined ? undefined : kv["allow-missing"].split(",").map((s) => s.trim()).filter(Boolean);
  if (allowMissing !== undefined && allowMissing.length === 0) throw new ReaderError("--allow-missing needs at least one setting id");
  return {
    mode: modes[0],
    opts: { root: kv.root ?? REPO_ROOT, draft: flags.has("draft"), jobs: kv.jobs, out: kv.out, rule: kv.rule, combo: kv.combo, run, gateFile: kv["gate-file"], captures: kv.captures, noSensitivity: flags.has("no-sensitivity"), allowMissing },
  };
}

function runDev(o: Options, p: Paths, io: IO): number {
  const rule = loadRule(p, o.draft);
  const files = loadJobFiles(p.devDir);
  if (files.length === 0) throw new ReaderError(`no Stage 0 jobs in ${p.devDir}`);
  if (files.some((f) => !f.job.dev)) throw new ReaderError(`${p.devDir} holds a job that is not a Stage 0 job (ids start with dev-, "dev": true)`);
  assertNoMixedSyntheticFiles(files);
  const bundles = bundleJobs(files, ["net", "occ"], null);
  const label = labelOf(rule, anySynthetic(bundles));
  const rep = evaluateDev(bundles, o.run ?? 1, rule, loadConstantScreen(p.devDir), label, o.run === undefined);
  writeAtomic(join(p.devDir, withLabel("stage0.json", label)), JSON.stringify(rep.json, null, 1) + "\n");
  writeAtomic(join(p.devDir, withLabel("stage0-readout.md", label)), rep.lines.join("\n") + "\n");
  const b = banner(label);
  if (b) io.log(b);
  io.log(`OUTCOME: ${rep.result.outcome}`);
  io.log(rep.text);
  io.log(rep.triggerLine);
  io.log(rep.rungLine);
  if (rep.invalid.length) io.log(`Invalid Stage 0 job(s), the cause INVALID-JOB of every combination (R5 at Stage 0; the exit code stays 0):\n${rep.invalid.map((l) => `  ${l}`).join("\n")}`);
  io.log(`Written: ${join(p.devDir, withLabel("stage0.json", label))}, ${join(p.devDir, withLabel("stage0-readout.md", label))}`);
  return 0;
}

/** The main job directory holds no Stage 0 job, whatever its role: those live in runs/regime/dev and never enter a readout. */
function mainJobFiles(p: Paths): { file: string; job: JobFile }[] {
  const all = loadJobFiles(p.jobsDir);
  const dev = all.filter((f) => f.job.dev || f.job.id.startsWith("dev-"));
  if (dev.length) throw new ReaderError(`Stage 0 (dev) jobs are among the jobs in ${p.jobsDir} (${dev.slice(0, 3).map((f) => f.file).join(", ")}${dev.length > 3 ? ", ..." : ""}); they live in runs/regime/dev and never enter a readout`);
  return all;
}

function runGate(o: Options, p: Paths, io: IO): number {
  const rule = loadRule(p, o.draft);
  const combo = selectedCombination(rule, o.combo);
  const files = mainJobFiles(p).filter((f) => GATE_ROLES.has(f.job.role));
  assertNoMixedSyntheticFiles(files);
  const bundles = bundleJobs(files, ["net", "occ"], rule);
  const label = labelOf(rule, anySynthetic(bundles));
  const res = evaluateGateJobs(bundles, rule, combo, label);
  const gatePath = join(p.outDir, withLabel("gate.json", label));
  writeAtomic(gatePath, JSON.stringify(res.gate, null, 1) + "\n");
  writeAtomic(join(p.outDir, withLabel("gate-readout.md", label)), res.lines.join("\n") + "\n");
  const b = banner(label);
  if (b) io.log(b);
  io.log(`OUTCOME: ${res.gate.invalidRun ? "INVALID-RUN" : res.gate.pass ? "GATE-PASS" : "GATE-FAIL"}`);
  io.log(res.gate.text);
  for (const d of res.gate.details) io.log(d);
  if (res.gate.footer) io.log(res.gate.footer);
  io.log(`Written: ${gatePath}, ${join(p.outDir, withLabel("gate-readout.md", label))}`);
  return res.exit;
}

function runSweep(o: Options, p: Paths, io: IO): number {
  const rule = loadRule(p, o.draft);
  const combo = selectedCombination(rule, o.combo);
  const files = mainJobFiles(p).filter((f) => !GATE_ROLES.has(f.job.role));
  assertNoMixedSyntheticFiles(files);
  const bundles = bundleJobs(files, [combo.decider], rule);
  const label = labelOf(rule, anySynthetic(bundles));
  const gatePath = o.gateFile ? resolve(p.root, o.gateFile) : join(p.outDir, withLabel("gate.json", label));
  const gate = loadGateFile(gatePath);
  checkGateFile(gate, rule, combo);
  const res = evaluateSweepJobs(bundles, rule, gate, combo, { label, screen: loadConstantScreen(p.devDir), capturesDir: p.capturesDir, sensitivity: !o.noSensitivity, allowMissing: o.allowMissing });
  const out = (name: string) => join(p.outDir, withLabel(name, label));
  writeAtomic(out("regime-results.tsv"), tsv(res.jobColumns, res.jobRows.map((r) => res.jobColumns.map((c) => r[c]))));
  writeAtomic(out("regime-settings.tsv"), tsv(SETTING_COLUMNS, res.settingRows.map((r) => SETTING_COLUMNS.map((c) => r[c]))));
  writeAtomic(out("regime-readout.md"), res.md.join("\n") + "\n");
  writeAtomic(out("regime-results.json"), JSON.stringify(res.results, round6) + "\n");
  const b = banner(label);
  if (b) io.log(b);
  io.log(`OUTCOME: ${res.outcomeId}`);
  io.log(res.text);
  for (const d of res.details) io.log(d);
  if (res.footer) io.log(res.footer);
  io.log(`Written: ${["regime-results.tsv", "regime-settings.tsv", "regime-readout.md", "regime-results.json"].map(out).join(", ")}`);
  return res.exit;
}

/** The CLI. Returns the exit code (see the header); a ReaderError is printed and becomes its exit code. */
export function main(argv: readonly string[], io: IO = consoleIO): number {
  try {
    const { mode, opts } = parseArgs(argv);
    const p = pathsFor(opts);
    return mode === "dev" ? runDev(opts, p, io) : mode === "gate" ? runGate(opts, p, io) : runSweep(opts, p, io);
  } catch (e) {
    if (e instanceof ReaderError) {
      (e.exit === 0 ? io.log : io.err)(e.message);
      return e.exit;
    }
    throw e;
  }
}

if ((import.meta as { main?: boolean }).main === true) process.exit(main(process.argv.slice(2)));
