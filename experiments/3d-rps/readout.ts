// The pre-registered readout of the cyclic-competition line (runs/rps/rule-draft.md, frozen as experiments/3d-rps/RULES.md).
// It applies the rules mechanically to the per-job files of Appendix B; nobody reads a plot and decides.
//
//   deno run -A --no-lock experiments/3d-rps/readout.ts <command> [options]
//
//   commands   lattice      --lattice <dir>                 2.2 to 2.7 over the per-(L, M) JSON files of B.4
//              gate0        --jobs <dir>                    3.0: every rung, the shared jobs, the order S0 S1 S2 V, the operating point
//              meter        --jobs <dir> --op <file>        3.1 over G_spread (seed 205); D_lab ordering
//              calibration  --jobs <dir> --op <file>        3.2 kappa* or KAPPA-NONE
//              sweep        --jobs <dir> --op <file>        4: classes, informative spreads, edge pairs, the outcome row, spread*
//              cycles       --jobs <dir> --op <file>        5: VIABLE jobs and arms (needs the sweep's go row)
//              deep         --jobs <dir> --op <file>        6.1: the precondition of the deep volume
//              mutation     --jobs <dir> --op <file>        7: classes, the horizon check, arm verdicts
//              gate0-exploration --jobs <dir> --registered <dir>
//                                                           Amendment 1 (after GATE-0-STOP): S0 and V on S0 side by side, one label
//                                                           of A1.4 per rung; --registered is the registered pilot's job directory,
//                                                           read only (S0's G0.2 and the table's rate-0 seed-401 cells). Every output
//                                                           starts with the line "EXPLORATION (Amendment 1): the registered pilot ended
//                                                           GATE-0-STOP" and none is a verdict of Gate 0. No --draft: it refuses unless
//                                                           RULES.md is frozen and contains the "## Amendment 1" heading. Exit codes as
//                                                           for gate0 (0: both rungs have a label; a failed V check is exit 3, V void)
//   options    --draft      read runs/rps/rule-draft.md and label every output DRAFT (until the freeze)
//              --json       print the result as JSON
//              --root <dir> the repository root (default: two levels above this file)
//
// Without --draft the readout refuses unless experiments/3d-rps/RULES.md has a SHA-256 recorded in experiments/3d-rps/FROZEN
// (lines `<sha256>  RULES.md`, or a bare hash like experiments/FROZEN, or `RULES.md: <sha256>`; any recorded hash of the file counts,
// so a dated amendment that records its new hash keeps the readout working; a line may be dated, `2026-10-26  <sha256>  RULES.md` or
// `<sha256>  RULES.md  # 2026-10-26`). RULES.md is frozen first, before Gate 0 and the lattice sweep. The Gate-0 record
// experiments/3d-rps/GATE0-RECORD.md is written at the final GO (or GATE-0-STOP), completed with the dense rate of G0.6, and then hashed
// into FROZEN in a dated line (rule draft header, 8.5). So `gate0` and `lattice` need the recorded hash of RULES.md only: an existing,
// unhashed record is provisional and is completed with G0.6. Every registered Part B readout (meter, calibration, sweep, cycles, deep,
// mutation) needs the record too, with its current hash recorded, and takes the operating point from it: the `--op` file must agree with
// the record in every field the record holds (`kappaStar`, which only the calibration gives, is added to it). A GATE-0-STOP record holds
// no operating point, so those readouts then have nothing to run on.
//
// Exit codes (rule draft 8.4): 0 a verdict; 2 unusable input; 3 a situation no row covers, or a bug indicator; 4 jobs still missing.
// When several apply the order is 2, then 3, then 4. The rules are in the code (readout-*.ts); RULES.md is the text they implement.
//
// ---------------------------------------------------------------------------------------------------------------------------
// THE INPUT CONTRACT (what the Gate-0 driver and the kernel drivers must write; Appendix B fixes the columns, not the layout)
// ---------------------------------------------------------------------------------------------------------------------------
// --jobs <dir>: any tree with one directory per job (a directory whose name starts with a dot, such as the harness's .tmp- staging
//               directories, is skipped, and so is everything below it) holding
//   census.tsv    B.2, written with `formatRpsCensusRow` of @bl/metrics (header `RPS_CENSUS_HEADER`); step = job step, rstep = step -
//                 6000, phase `burn` for the burn-in's censuses (job steps 1,000 to 6,000) and `run` after; `n` and `Y` must agree
//                 with the label counts and modal masks (the readout recomputes them). The last row's step must equal summary.steps, and the steps are 1,000, 2,000, ... with none missing (six burn-in rows).
//   summary.json  B.3. The readout reads these fields, from the top level first and then from `config.run` (the run-phase
//                 WorldConfig) and `init.run` (its InitParams; `founders` is K0):
//                   id, stage, seed, steps, stop ("end" | "ext" | "loss" | "mono" | "nostart", or {reason, rstep}; the class is
//                   recomputed from census.tsv, so a "nostart" job is the six burn-in rows alone), residual ("0"), matterOk,
//                   burnHash, host, device, stepsPerSec, events, final (path of final.bin, relative to the job directory), xi,
//                   retried (the failures of earlier attempts of a job that passed on the rerun) and failures (the same in a MISSING
//                   marker), each [{attempt, kind: "crash" | "conservation" | "invariant", step, message}],
//                   shape ([W,H,D] or "WxHxD", else tileW/tileH/tileD[/tilesX/tilesY] of the config),
//                   spread, rpsRate, rpsTypes, rpsFlip, rpsEdge, mutRate, K0 (or init founders),
//                   Gate 0 only: rung ("S0" | "S1" | "S2" | "V"), kill ("removal" | "vacancy"), substrate (for V),
//                   section 7 only: arm ("Z" | "A" | "B" | "C" | "N" | "W").
//                 A job that failed twice is marked `missing: true` (or `status: "missing"`, or `stop: "missing"`).
//                 `config.burn` / `init.burn` (the burn-phase config) let the readout group jobs by burn-in for the burnHash check.
//   final.bin     B.3, for the DC treatment jobs of the sweep at spread* (6.1); summary.xi is used when it is absent.
// stage names:  Gate 0  g0.scan (G0.2 control scan, rate 0, seed 401), g0.meter (G0.2 meter, seed 405), g0.table (G0.3), g0.horizon
//               (G0.4), g0.confirm (G0.5), g0.dense (G0.6, seed 404), g0.vcheck (the V check: two rate-0 jobs, one per kill build,
//               whose census.tsv must be byte-identical), g0.horizon-rung (256 x 256 x 4);
//               registered  meter (3.1, seed 205), calibration (3.2), sweep (4.1; treatment and control told apart by rpsRate),
//               rate-arm, cycles (5), deep (6.2), mutation (7).
// meter jobs:   summary.json with `meter: { axis: "x" | "y", W, t }` (W = sum over lines of m (1 - m), t the steps run; the readout
//               computes D = pi W^2 / (8 t)), or `meter: { Dx, Dy }`, or one record with `Wx` and `Wy`; spread and (Gate 0) rung.
//               No census.tsv is needed.
// shared jobs:  the seed-401 rate-0 job of a table cell may be the g0.scan job itself; a rate-0 job counts for its substrate rung whichever
//               kill built it, and rung V's rate-0 cells are its substrate rung's.
// --op <file>:  the operating point: the `operatingPoint` object that `gate0` prints (rung, kill, substrate, gSpread, vCal, kappaW,
//               rCal, h0, shape, denseRate), plus `kappaStar` after `calibration`; JSON, or a Markdown file with a ```json block.
//               Without --draft it must agree with the hashed Gate-0 record in every field but `kappaStar` (see above).
// --lattice <dir>: one JSON per (L, iM) as in B.4 (L, M, iM, R, k, pExt, seeds); rehearsal data (R below the rule's) is refused.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRpsCensusTsv, parseRpsFinal, rpsFinalMeasures, RpsCensusParseError } from "@bl/metrics";
import { LOST_RACE_PREFIX, Problems, ReadoutError, canonicalStage, normalizeSummary, type Job, type Problem } from "./readout-jobs.ts";
import { evaluateGate0, evaluateMeter, type Gate0Result, type MeterPoint, type OperatingPoint } from "./readout-gate0.ts";
import { LAT_M, LAT_CONTINGENCY_SIZE, LAT_SIZES, evaluateLattice, parseLatticeCell, type LatticeCell, type LatticeEvaluation, type LatticeResult } from "./readout-lattice.ts";
import { evaluateCalibration, evaluateCycles, evaluateDeepPrecondition, evaluateSweep, type CalibrationResult, type CyclesResult, type DeepResult, type SweepResult } from "./readout-kernel.ts";
import { evaluateMutation, type MutationResult } from "./readout-mutation.ts";
import { checkFrozen, explorationRefusal, parseFrozen, type FrozenEntry, type RulesCheck } from "./frozen.ts";
import { EXPLORATION_HEADER, LEVELS_MIN_EXPLORATION, evaluateExploration, type ExplorationResult, type ExplorationRung } from "./readout-exploration.ts";

// ---- the frozen rules ----
// (frozen.ts: shared with the registered lattice sweep, which also refuses to start before the freeze)

export { checkFrozen, parseFrozen };
export type { FrozenEntry, RulesCheck };

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

// ---- I/O (injectable, so the tests can run on in-memory files) ----

export interface Io {
  /** The repository root. */
  root: string;
  readText(p: string): string | null;
  readBytes(p: string): Uint8Array | null;
  /** Every file under `dir` (recursive), as paths; empty if `dir` does not exist. */
  walk(dir: string): string[];
  exists(p: string): boolean;
}

export const nodeIo = (root: string): Io => ({
  root,
  readText: (p) => (fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : null),
  readBytes: (p) => (fs.existsSync(p) && fs.statSync(p).isFile() ? new Uint8Array(fs.readFileSync(p)) : null),
  walk: (dir) => {
    const out: string[] = [];
    const visit = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) visit(full);
        else if (e.isFile()) out.push(full);
      }
    };
    visit(dir);
    return out.sort();
  },
  exists: (p) => fs.existsSync(p),
});

/** An in-memory file system for the tests: `files` maps paths to text or bytes. */
export const memIo = (root: string, files: Record<string, string | Uint8Array>): Io => ({
  root,
  readText: (p) => (p in files ? (typeof files[p] === "string" ? (files[p] as string) : new TextDecoder().decode(files[p] as Uint8Array)) : null),
  readBytes: (p) => (p in files ? (typeof files[p] === "string" ? new TextEncoder().encode(files[p] as string) : (files[p] as Uint8Array)) : null),
  walk: (dir) => Object.keys(files).filter((f) => f.startsWith(dir.endsWith("/") ? dir : `${dir}/`)).sort(),
  exists: (p) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
});

/** Loads every `summary.json` (with its `census.tsv`) under `dir`. Unreadable files become exit-2 problems. */
export function loadJobs(io: Io, dir: string, pr: Problems): Job[] {
  const jobs: Job[] = [];
  // A hidden directory below `dir` (`.tmp-<id>-...`, where the harness assembles a job before it renames the directory into place, or
  // a copy of one that an rsync caught) is never a job. Only the path below `dir` counts: `dir` itself may sit under a dot directory.
  const hidden = (f: string): boolean => path.relative(dir, f).split(path.sep).some((c) => c.startsWith("."));
  const files = io.walk(dir).filter((f) => path.basename(f) === "summary.json" && !hidden(f));
  if (!io.exists(dir)) pr.add(2, `job directory ${dir} does not exist`);
  else if (files.length === 0) pr.add(2, `no summary.json under ${dir}`);
  for (const f of files) {
    const text = io.readText(f);
    if (text === null) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      pr.add(2, `${f}: ${(e as Error).message}`);
      continue;
    }
    const s = pr.guard(() => normalizeSummary(raw, f));
    if (!s) continue;
    const base = path.dirname(f);
    const censusText = io.readText(path.join(base, "census.tsv"));
    let rows = null;
    if (censusText !== null) {
      try {
        rows = parseRpsCensusTsv(censusText);
      } catch (e) {
        if (!(e instanceof RpsCensusParseError)) throw e;
        pr.add(2, `${s.id}: ${e.message}`);
      }
    }
    jobs.push({ s, rows, censusText: s.stage === "g0.vcheck" ? censusText : null, finalPath: s.final ? path.resolve(base, s.final) : null, dir: base });
  }
  // A rerun that passed but lost the publish race to another process keeps the failures of its earlier attempt in a hidden file next to
  // the jobs (rule draft 1.3, D22). The job that was published does not carry them, so the file itself is the bug indicator (8.4).
  for (const f of io.walk(dir)) {
    const name = path.basename(f);
    if (path.relative(dir, f) === name && name.startsWith(LOST_RACE_PREFIX) && name.endsWith(".json")) {
      // the harness writes the file also for a MISSING marker that lost the publish (`missing: true`): the job failed twice
      let missing = false;
      try {
        missing = (JSON.parse(io.readText(f) ?? "{}") as { missing?: unknown }).missing === true;
      } catch {
        missing = false;
      }
      pr.add(
        3,
        missing
          ? `${name}: a job that failed twice, a conservation or invariant check among the failures, lost the publish of its MISSING marker to another process (1.3, 8.4); the failures are in the file`
          : `${name}: a rerun that passed lost the publish race, and an earlier attempt of that job failed a conservation or invariant check (1.3, 8.4); the failures are in the file`,
      );
    }
  }
  return jobs;
}

/** The final snapshot's `xi` and z-coherence: from `final.bin` (B.1), else the `xi` the driver stored in summary.json. */
export function measureFinal(io: Io, job: Job): { xi: number | null; zcoh: number | null } | null {
  if (job.finalPath !== null) {
    const bytes = io.readBytes(job.finalPath);
    if (bytes !== null) {
      try {
        return rpsFinalMeasures(parseRpsFinal(bytes));
      } catch (e) {
        throw new ReadoutError(2, `${job.s.id}: ${(e as Error).message}`);
      }
    }
  }
  return job.s.xi !== null ? { xi: job.s.xi, zcoh: null } : null;
}

// ---- the operating point ----

/** Reads the operating point from JSON, or from the first ```json block that has a `gSpread` in a Markdown file (the Gate-0 record). */
export function parseOperatingPoint(text: string, where: string): OperatingPoint {
  let raw: unknown;
  try {
    if (where.endsWith(".md")) {
      const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
      const hit = blocks.find((b) => b.includes("gSpread"));
      if (!hit) throw new Error("no ```json block with a gSpread");
      raw = JSON.parse(hit);
    } else raw = JSON.parse(text);
  } catch (e) {
    throw new ReadoutError(2, `${where}: ${(e as Error).message}`);
  }
  if (raw === null || typeof raw !== "object") throw new ReadoutError(2, `${where}: not an object`);
  const r = raw as Record<string, unknown>;
  // `gate0` prints { operatingPoint: {...} }; accept either the wrapper or the point
  const o = (r.operatingPoint !== undefined && typeof r.operatingPoint === "object" ? r.operatingPoint : r) as Record<string, unknown>;
  const bad = (m: string): never => {
    throw new ReadoutError(2, `${where}: ${m}`);
  };
  const numArr = (v: unknown, name: string): number[] => (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v as number[]) : bad(`${name} must be a non-empty array of numbers`));
  const rung = o.rung;
  if (rung !== "S0" && rung !== "S1" && rung !== "S2" && rung !== "V") bad("rung must be S0, S1, S2 or V");
  const kill = o.kill ?? (rung === "V" ? "vacancy" : "removal");
  if (kill !== "removal" && kill !== "vacancy") bad("kill must be removal or vacancy");
  const substrate = o.substrate ?? (rung === "V" ? undefined : rung);
  if (substrate !== "S0" && substrate !== "S1" && substrate !== "S2") bad("substrate must be S0, S1 or S2 (required for rung V)");
  const gSpread = numArr(o.gSpread, "gSpread");
  const num = (v: unknown, name: string): number => (typeof v === "number" && Number.isFinite(v) ? v : bad(`${name} must be a number`));
  const vCal = num(o.vCal, "vCal");
  if (!gSpread.includes(vCal)) bad("vCal is not in gSpread");
  const h0 = num(o.h0, "h0");
  if (![50_000, 100_000, 200_000].includes(h0)) bad("h0 must be 50000, 100000 or 200000");
  const shape = o.shape === null || o.shape === undefined ? null : Array.isArray(o.shape) && o.shape.length === 3 ? (o.shape as [number, number, number]) : bad("shape must be [W, H, D] or null");
  const dense = o.denseRate === null || o.denseRate === undefined ? null : num(o.denseRate, "denseRate");
  const star = o.kappaStar === null || o.kappaStar === undefined ? null : num(o.kappaStar, "kappaStar");
  return { rung: rung as OperatingPoint["rung"], kill: kill as OperatingPoint["kill"], substrate: substrate as OperatingPoint["substrate"], gSpread, vCal, kappaW: num(o.kappaW, "kappaW"), rCal: numArr(o.rCal, "rCal"), h0, shape, denseRate: dense, kappaStar: star };
}

/**
 * The fields in which a registered readout's `--op` file differs from the Gate-0 record's operating point (rule draft 8.5): every field
 * the record holds except `kappaStar`, which only the calibration gives (the record may hold none; if it does, it must agree). Empty
 * when they agree.
 */
export function operatingPointDiffs(op: OperatingPoint, rec: OperatingPoint): string[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const diffs: string[] = [];
  for (const k of ["rung", "kill", "substrate", "gSpread", "vCal", "kappaW", "rCal", "h0", "shape", "denseRate"] as const) {
    if (!same(op[k], rec[k])) diffs.push(`${k}: --op has ${JSON.stringify(op[k] ?? null)}, the record has ${JSON.stringify(rec[k] ?? null)}`);
  }
  if (rec.kappaStar !== undefined && rec.kappaStar !== null && !same(op.kappaStar, rec.kappaStar)) diffs.push(`kappaStar: --op has ${JSON.stringify(op.kappaStar ?? null)}, the record has ${JSON.stringify(rec.kappaStar)}`);
  return diffs;
}

/** Reads the operating point out of the Gate-0 record (exit 2 if it holds none, as a GATE-0-STOP record does) and compares it with `--op`. */
function bindToRecord(op: OperatingPoint, recordText: string | null, opFile: string): void {
  if (recordText === null) throw new ReadoutError(2, "the Gate-0 record cannot be read");
  let rec: OperatingPoint;
  try {
    rec = parseOperatingPoint(recordText, "GATE0-RECORD.md");
  } catch (e) {
    if (e instanceof ReadoutError) throw new ReadoutError(2, `the Gate-0 record holds no usable operating point, so a registered kernel stage has nothing to run on (${e.message})`);
    throw e;
  }
  const diffs = operatingPointDiffs(op, rec);
  if (diffs.length > 0) throw new ReadoutError(2, `${opFile} is not the operating point of the hashed Gate-0 record (8.5): ${diffs.join("; ")}`);
}

// ---- arguments and the result of a run ----

export interface Args {
  command: string | null;
  jobs: string | null;
  lattice: string | null;
  op: string | null;
  root: string | null;
  /** `gate0-exploration` only: the registered pilot's job directory (read only); absent unless given. */
  registered?: string;
  draft: boolean;
  json: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { command: null, jobs: null, lattice: null, op: null, root: null, draft: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--draft") a.draft = true;
    else if (t === "--json") a.json = true;
    else if (t.startsWith("--")) {
      const [k, inline] = t.slice(2).split(/=(.*)/s);
      const v = inline ?? argv[++i];
      if (v === undefined) throw new ReadoutError(2, `option ${t} needs a value`);
      if (k === "jobs" || k === "lattice" || k === "op" || k === "root" || k === "registered") a[k] = v;
      else throw new ReadoutError(2, `unknown option --${k}`);
    } else if (a.command === null) a.command = t;
    else throw new ReadoutError(2, `unexpected argument ${t}`);
  }
  return a;
}

export interface RunResult {
  /** The exit code: 0 a verdict, 2 unusable input, 3 a situation no row covers or a bug indicator, 4 jobs still missing. */
  code: 0 | 2 | 3 | 4;
  out: string;
  problems: Problem[];
  draft: boolean;
  /** The stage's structured result (the object `--json` prints). */
  result: unknown;
}

const CODE_MEANING: Record<number, string> = { 0: "a verdict", 2: "unusable input", 3: "a situation no row covers, or a bug indicator", 4: "jobs still missing" };

// ---- rendering ----

const fmt = (x: number | null | undefined, d = 3): string => (x === null || x === undefined ? "-" : Number.isInteger(x) ? String(x) : x === Infinity ? "inf" : x.toFixed(d));
const sci = (x: number | null | undefined): string => (x === null || x === undefined ? "-" : x.toExponential(2));
const md = (head: string[], rows: (string | number | null)[][]): string[] => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map((c) => (c === null ? "-" : String(c))).join(" | ")} |`)];

function renderLattice(r: LatticeResult, tag: string): string[] {
  const o: string[] = [`## Lattice (rules 2.2 to 2.7)${tag}`, ""];
  o.push(`status: ${r.status}${r.name ? `; outcome ${r.name}` : ""}`);
  if (r.missing.length > 0) o.push(`missing: ${r.missing.slice(0, 8).join("; ")}${r.missing.length > 8 ? "; ..." : ""}`);
  const k = new Map(r.cells.map((c) => [`${c.L}:${c.iM}`, c]));
  const sizes = [...LAT_SIZES, ...(r.cells.some((c) => c.L === LAT_CONTINGENCY_SIZE) ? [LAT_CONTINGENCY_SIZE] : [])];
  o.push("", "P_ext = k / R (rows: M, columns: L)", "");
  o.push(...md(["M", ...sizes.map((L) => `L=${L}`)], LAT_M.map((M, iM) => [sci(M), ...sizes.map((L) => { const c = k.get(`${L}:${iM}`); return c ? `${c.k}/${c.R} = ${(c.k / c.R).toFixed(3)}` : "-"; })])));
  const ev = (e: LatticeEvaluation, title: string) => {
    o.push("", `### ${title}`, "");
    o.push(...md(["pair", "sign changes (Ma -> Mb, supported)", "valid", "estimate"], e.pairs.map((p) => [`${p.L1}, ${p.L2}`, p.signChanges.map((s) => `${sci(s.Ma)} -> ${sci(s.Mb)}${s.supported ? " yes" : " no"}`).join("; ") || "none", p.valid ? "yes" : "no", sci(p.estimate)])));
    o.push("", `V = ${e.V} valid pairs; M_c = ${sci(e.Mc)}; estimates ${e.estimates.map(sci).join(", ") || "none"}; M_c / 4.5e-4 = ${fmt(e.McOverPaper, 2)}`);
    o.push(`R3: P_ext(60, 2e-3) - P_ext(60, 1e-5) = ${fmt(e.r3Delta)} (needs 0.20): ${e.r3 ? "yes" : "no"}`);
    o.push(`**row ${e.outcome.row}: ${e.outcome.name}**`);
  };
  if (r.main) ev(r.main, "Main grid (2.6)");
  if (r.contingency) {
    ev(r.contingency, "With L = 100 (2.7)");
    o.push("", `**outcome after the contingency: ${r.name}**`);
  }
  return o;
}

function renderMeterPoints(points: readonly MeterPoint[]): string[] {
  return md(["spread", "D_x", "D_y", "ratio", "D_lab", "flags"], points.map((p) => [p.spread, sci(p.Dx), sci(p.Dy), p.ratio === null ? "-" : fmt(p.ratio, 2), sci(p.Dlab), [p.anisotropic ? "anisotropic" : "", p.flat ? "flat" : ""].filter(Boolean).join(" ") || "-"]));
}

function renderGate0(r: Gate0Result, tag: string): string[] {
  const o: string[] = [`## Gate 0 (rules 3.0)${tag}`, ""];
  const ov0 = r.overall;
  for (const e of r.rungs) {
    const status = e.notRun !== null ? "not run" : e.state === "pending" ? "pending" : `${e.verdict} (row ${e.row})`;
    o.push(`### Rung ${e.rung}${e.rung === "V" ? ` (vacancy kill on ${e.substrate})` : ""}: ${status}${e.voided ? ` VOID: no V job counts (the V check is ${r.vcheck.state}, G0.1)` : ""}${tag}`, "");
    // 3.0: the rungs are taken in the order S0, S1, S2, V; a GO is the answer only when no rung ahead of it is pending
    if (e.notRun !== null) o.push(`not run: rung ${e.notRun} gives GO, and the rungs after the first GO of the order S0, S1, S2, V are not run (3.0)`, "");
    else if (e.state === "done" && e.verdict === "GO" && ov0.status === "pending") o.push(`provisional: rung ${ov0.waitingFor.join(", ")} comes first in the order and still has jobs to run, so this GO is not the answer yet`, "");
    else if (e.state === "done" && e.verdict === "GO" && ov0.status === "go" && ov0.used !== e.rung) o.push(`not the rung used: rung ${ov0.used} comes first in the order`, "");
    if (e.missing.length > 0 && e.notRun === null) o.push(`jobs to run (${e.missing.length}): ${e.missing.slice(0, 6).join("; ")}${e.missing.length > 6 ? "; ..." : ""}`, "");
    if (e.listed.length > 0) o.push(`listed: ${e.listed.join("; ")}`, "");
    if (e.rung !== "V" && e.scan.length > 0) {
      o.push("G0.2 control scan (rate 0, seed 401) and meter:", "");
      const mp = new Map(e.meter.map((m) => [m.spread, m]));
      o.push(...md(["spread", "class", "carpet", "min liv", "B+P/cell", "D_lab", "flags", "in G_spread"], e.scan.map((x) => { const m = mp.get(x.spread); return [x.spread, x.cls ?? (x.missingMarked ? "MISSING" : "-"), x.carpet ? "yes" : "no", fmt(x.livMin), fmt(x.massPerCell, 1), sci(m?.Dlab), m ? [m.anisotropic ? "anisotropic" : "", m.flat ? "flat" : ""].filter(Boolean).join(" ") || "-" : "-", e.gSpread.includes(x.spread) ? "yes" : "no"]; })));
      o.push("", `B_meter = ${e.bMeter ?? "-"}; G_spread = [${e.gSpread.join(", ")}]; levels = ${e.levels ?? "-"} (row 1: levels < 5 is NO-GO: LEVELS)`, "");
    } else if (e.rung === "V") o.push(`G_spread (of ${e.substrate}) = [${e.gSpread.join(", ")}]; levels ${e.levels}`, "");
    if (e.table) {
      o.push(`G0.3 table (v_lo, v_mid, v_hi = ${e.table.spreads.join(", ")}; classes of seeds 401, 402, 403):`, "");
      o.push(...md(["spread", "rate", "classes", "DC", "works"], e.table.cells.map((c) => [c.spread, c.rate, c.classes.join(" "), c.nDC, c.rate === 0 ? "(control)" : c.works ? "yes" : "no"])));
      o.push("", "rate-0 controls (informative: >= 2 finished, >= 2 keep every label, median |chi_fw| <= 0.1):", "");
      o.push(...md(["spread", "finished", "keep labels", "median |chi_fw|", "informative"], [...e.controls].map(([v, c]) => [v, c.finished, c.keeps, fmt(c.medAbsChi), c.informative ? "yes" : "no"])));
      o.push("", `kappa_w = ${e.kappaW ?? "none"}; v_cal = ${e.vCal ?? "none"}${e.kappaW === null ? " (row 2: no rate works at 2 or more spreads: NO-GO: EFFECT)" : ""}`, "");
    }
    if (e.horizon) o.push(`G0.4 horizon (spread ${e.horizon.spread}, rate 0, shape ${e.horizon.shape ?? "?"}): classes ${e.horizon.classes.join(" ")}; first sustained loss (run step) ${e.horizon.tctl.map((t) => (t === null ? "-" : fmt(t))).join(", ")}; T_ctl ${fmt(e.horizon.Tctl)}; h0 ${e.horizon.h0 ?? "none"}${e.horizon.h0 === null ? " (row 3: NO-GO: HORIZON)" : ""}`, "");
    if (e.confirm) o.push(`G0.5 confirmation (spread ${e.confirm.spread}, rate ${e.confirm.rate}, ${e.confirm.steps} steps): classes ${e.confirm.classes.join(" ")}; ${e.confirm.nDC} of 3 DC${e.confirm.nDC < 2 ? " (row 4: NO-GO: CONFIRM)" : ""}`, "");
  }
  o.push(`### V check (G0.1)${tag}`, "", `${r.vcheck.state}: ${r.vcheck.detail}`, "");
  o.push(`### Verdict${tag}`, "");
  const ov = r.overall;
  if (ov.status === "go") o.push(`**GO: rung ${ov.used}** (the highest-preference rung of S0, S1, S2, V not excluded; every rung ahead of it ended NO-GO, and the rungs after it are not run)`);
  else if (ov.status === "pending") o.push(`**pending**: waiting for rung ${ov.waitingFor.join(", ") || "-"} (no GO is the answer while a rung ahead of it has jobs to run)`);
  else {
    o.push(`**GATE-0-STOP**${ov.onlyHorizon ? ": the only failures were HORIZON" : ""}`);
    if (ov.horizonRung) o.push(ov.horizonRung.state === "pending" ? `horizon rung (rung ${ov.horizonRung.rung}, 256 x 256 x 4, G0.4 alone): jobs to run: ${ov.horizonRung.missing.join("; ")}` : `horizon rung (rung ${ov.horizonRung.rung}, 256 x 256 x 4): T_ctl ${fmt(ov.horizonRung.horizon?.Tctl)}, h0 ${ov.horizonRung.horizon?.h0 ?? "none"}; diagnostic only (3.0): GATE-0-STOP stands whatever this says, and any continuation is a dated amendment (8.3)`);
  }
  if (r.rungs.some((e) => e.voided)) o.push(`rung V is void (the V check is ${r.vcheck.state}): its verdict above never decides (G0.1, 8.4)`);
  if (r.dense) o.push(`G0.6 dense rate: ${fmt(r.dense.stepsPerSec, 1)} steps/s on ${r.dense.host ?? "?"} (${r.dense.device ?? "?"})`);
  if (r.notes.length > 0) o.push("", ...r.notes.map((n) => `note: ${n}`));
  if (r.operatingPoint) o.push("", "operating point (for the Gate-0 record):", "", "```json", JSON.stringify({ operatingPoint: r.operatingPoint }, null, 2), "```");
  o.push("", `### Gate-0 jobs (8.5)${tag}`, "");
  o.push(...md(["id", "rung", "kill", "stage", "spread", "rate", "seed", "steps", "class", "chi_fw", "turnover", "liv", "steps/s", "host"], r.jobs.map(({ job: j, a }) => [j.s.id, j.s.rung, j.s.kill, j.s.stage, j.s.spread, j.s.rate, j.s.seed, j.s.steps, j.s.missing ? "MISSING" : (a?.cls ?? "-"), a && a.cls !== "NOSTART" ? fmt(a.chiFw) : "-", a?.turnoverFw != null ? fmt(a.turnoverFw) : "-", a?.livLast != null ? fmt(a.livLast) : "-", fmt(j.s.stepsPerSec, 1), j.s.host])));
  return o;
}

/** Amendment 1: the exploration's table. Its labels are those of A1.4 and nothing here is a verdict of Gate 0 (the header line is run's). */
function renderExploration(r: ExplorationResult): string[] {
  const o: string[] = ["## Exploration of the kill at S0's four mobility levels (RULES.md Amendment 1)", ""];
  o.push("Not a registered result: nothing below may be cited as passing Gate 0 or as a result of the registered programme, and a label licenses nothing (A1.6).", "");
  o.push("### Registered G0.2 of S0 (reused, not rerun: A1.1)", "");
  const g = r.registered;
  if (g === null) o.push("not usable (see the problems below)", "");
  else {
    const mp = new Map(g.meter.map((m) => [m.spread, m]));
    o.push(...md(["spread", "class", "carpet", "min liv", "B+P/cell", "D_lab", "flags", "in G_spread"], g.scan.map((x) => { const m = mp.get(x.spread); return [x.spread, x.cls ?? (x.missingMarked ? "MISSING" : "-"), x.carpet ? "yes" : "no", fmt(x.livMin), fmt(x.massPerCell, 1), sci(m?.Dlab), m ? [m.anisotropic ? "anisotropic" : "", m.flat ? "flat" : ""].filter(Boolean).join(" ") || "-" : "-", g.gSpread.includes(x.spread) ? "yes" : "no"]; })));
    o.push("", `B_meter = ${g.bMeter ?? "-"}; G_spread = [${g.gSpread.join(", ")}]; levels = ${g.levels ?? "-"} (row 1 for this exploration: levels < ${LEVELS_MIN_EXPLORATION} fails, A1.1)`, "");
  }
  if (r.spreads) o.push(`v_lo, v_mid, v_hi = ${r.spreads.join(", ")} (A1.2)`, "");
  const rungTitle = (e: ExplorationRung) => (e.rung === "S0" ? "Rung S0 (removal kill)" : "Rung V (vacancy kill on S0)");
  const status = (e: ExplorationRung) => (e.state === "pending" ? "pending" : `${e.label}${e.row !== null ? ` (row ${e.row})` : ""}`);
  for (const e of r.rungs) {
    o.push(`### ${rungTitle(e)}: ${status(e)}`, "");
    if (e.voided) o.push(`void: the V check is ${r.vcheck.state} (${r.vcheck.detail}), so no V job counts (G0.1, A1.2)`, "");
    if (e.missing.length > 0 && e.state === "pending") o.push(`jobs to run (${e.missing.length}): ${e.missing.slice(0, 6).join("; ")}${e.missing.length > 6 ? "; ..." : ""}`, "");
    if (e.listed.length > 0) o.push(`listed: ${e.listed.join("; ")}`, "");
    if (e.table) {
      o.push(`G0.3 table (rates ${e.table.rates.join(", ")}; classes of seeds 401, 402, 403; the rate-0 cells are S0's, their seed 401 the registered scan job):`, "");
      o.push(...md(["spread", "rate", "classes", "DC", "works"], e.table.cells.map((c) => [c.spread, c.rate, c.classes.join(" "), c.nDC, c.rate === 0 ? "(control)" : c.works ? "yes" : "no"])));
      o.push("", `kappa_w = ${e.kappaW ?? "none"}; v_cal = ${e.vCal ?? "none"}${e.kappaW === null ? " (row 2: no rate works at 2 or more spreads: EXPLORATION-NO-EFFECT)" : ""}`, "");
    }
    if (e.horizon) o.push(`G0.4 horizon (shared; spread ${e.horizon.spread}, rate 0, shape ${e.horizon.shape ?? "?"}): classes ${e.horizon.classes.join(" ")}; first sustained loss (run step) ${e.horizon.tctl.map((t) => (t === null ? "-" : fmt(t))).join(", ")}; T_ctl ${fmt(e.horizon.Tctl)}; h0 ${e.horizon.h0 ?? "none"}${e.horizon.h0 === null ? " (row 3: EXPLORATION-NO-HORIZON)" : ""}`, "");
    if (e.confirm) o.push(`G0.5 confirmation (spread ${e.confirm.spread}, rate ${e.confirm.rate}, ${e.confirm.steps} steps): classes ${e.confirm.classes.join(" ")}; ${e.confirm.nDC} of 3 DC${e.confirm.nDC < 2 ? " (row 4: EXPLORATION-NO-CONFIRM)" : ""}`, "");
  }
  if (r.controls.size > 0) {
    o.push("rate-0 controls of both rungs (informative: >= 2 finished, >= 2 keep every label, median |chi_fw| <= 0.1):", "");
    o.push(...md(["spread", "finished", "keep labels", "median |chi_fw|", "informative"], [...r.controls].map(([v, c]) => [v, c.finished, c.keeps, fmt(c.medAbsChi), c.informative ? "yes" : "no"])), "");
  }
  o.push("### V check (G0.1, A1.2)", "", `${r.vcheck.state}: ${r.vcheck.detail}`, "");
  o.push("### Labels (A1.4: one per rung, both rungs evaluated in full; no rung is used)", "");
  for (const e of r.rungs) o.push(`- ${rungTitle(e)}: **${e.state === "pending" ? `pending (${e.missing.length} job${e.missing.length === 1 ? "" : "s"} to run)` : status(e)}**`);
  if (r.notes.length > 0) o.push("", ...r.notes.map((n) => `note: ${n}`));
  o.push("", "### Exploration jobs (A1.5; the registered rows are the table's rate-0 seed-401 cells)", "");
  o.push(...md(["id", "source", "rung", "kill", "stage", "spread", "rate", "seed", "steps", "class", "chi_fw", "turnover", "liv", "steps/s", "host"], r.jobs.map(({ job: j, a, source }) => [j.s.id, source, j.s.rung, j.s.kill, j.s.stage, j.s.spread, j.s.rate, j.s.seed, j.s.steps, j.s.missing ? "MISSING" : (a?.cls ?? "-"), a && a.cls !== "NOSTART" ? fmt(a.chiFw) : "-", a?.turnoverFw != null ? fmt(a.turnoverFw) : "-", a?.livLast != null ? fmt(a.livLast) : "-", fmt(j.s.stepsPerSec, 1), j.s.host])));
  return o;
}

function renderCalibration(r: CalibrationResult, tag: string): string[] {
  const o: string[] = [`## Kill-rate calibration (rules 3.2)${tag}`, ""];
  o.push(...md(["rate", "seed", "class", "chi_fw", "turnover", "liv", "control class", "control chi_fw", "qualifies"], r.rows.flatMap((row) => row.jobs.map((j, k) => [row.rate, j.seed, j.cls, fmt(j.chiFw), fmt(j.turnoverFw), fmt(j.livLast), row.controls[k].cls, fmt(row.controls[k].chiFw), k === 0 ? (row.qualifies ? "yes" : `no (${row.why.join("; ")})`) : ""]))));
  if (r.status === "pending") o.push("", `jobs to run (${r.missing.length}): ${r.missing.slice(0, 6).join("; ")}`);
  else o.push("", r.verdict === "KAPPA" ? `**kappa* = ${r.kappaStar}**` : "**KAPPA-NONE**: no rate qualifies; the sweep and everything after it do not run, and the main session writes an amendment");
  return o;
}

function renderSweep(r: SweepResult, tag: string): string[] {
  const o: string[] = [`## Sweep (rules 4)${tag}`, ""];
  o.push(`kappa* ${r.kappaStar}; T_end ${r.tEnd}${r.reduced ? " (reduced schedule, 1.2)" : ""}; T_end / 4 = ${r.tEnd / 4}`, "");
  o.push(...md(["spread", "informative", "treat", "ctrl", "n_dyn", "n_fc", "n_churn", "n_lost", "n_ext", "n_sparse", "n_sig", "Tmed", "ctrl keep", "ctrl med |chi|"], r.spreads.map((s) => [s.spread, s.informative ? "yes" : s.incomplete ? "no (incomplete)" : "no", s.nTreat, s.nCtrl, s.nDyn, s.nFc, s.nChurn, s.nLost, s.nExt, s.nSparse, s.nSig, fmt(s.Tmed), s.ctlKeeps, fmt(s.ctlMedAbsChi)])));
  if (r.listed.length > 0) o.push("", `listed: ${r.listed.join("; ")}`);
  if (r.status === "pending") {
    o.push("", `jobs to run (${r.missing.length}): ${r.missing.slice(0, 6).join("; ")}`);
    return o;
  }
  o.push("", `I = ${r.I} informative spreads; edge pairs: ${r.edges.length === 0 ? "none" : r.edges.map((e) => `${e.kind} (${e.a}, ${e.b})`).join(", ")}`);
  if (r.outcome) o.push(`**row ${r.outcome.row}: ${r.outcome.name}** (${r.outcome.go ? "go" : "stop"}): ${r.outcome.consequence}`);
  if (r.spreadStar !== null) o.push(`spread* = ${r.spreadStar}`);
  if (r.rateArms.length > 0) {
    o.push("", "Rate arms (reported beside the table; not part of the outcome):", "");
    o.push(...md(["rate", "seed", "class", "chi_fw"], r.rateArms.map((a) => [a.rate, a.seed, a.cls, fmt(a.chiFw)])));
  }
  return o;
}

function renderCycles(r: CyclesResult, tag: string): string[] {
  const o: string[] = [`## Longer cycles (rules 5)${tag}`, ""];
  if (r.status === "closed") return [...o, "gate closed: 4.4 gave no go row, so section 5 does not run"];
  o.push(...md(["K0", "seed", "class", "VIABLE"], r.jobs.map((j) => [j.K0, j.seed, j.cls, j.viable ? "yes" : "no"])));
  if (r.status === "pending") o.push("", `jobs to run: ${r.missing.join("; ")}`);
  else o.push("", `K0 = 4: ${r.arms[4].viable} of 3 VIABLE, arm ${r.arms[4].armViable ? "viable" : "not viable"}; K0 = 5: ${r.arms[5].viable} of 3 VIABLE, arm ${r.arms[5].armViable ? "viable" : "not viable"} (reported only; state it next to section 7)`);
  return o;
}

function renderDeep(r: DeepResult, tag: string): string[] {
  const o: string[] = [`## Deep volume precondition (rules 6.1)${tag}`, ""];
  if (r.status === "closed") return [...o, `**does not hold**: ${r.reason}`];
  o.push(...md(["DC treatment job at spread*", "xi", "z-coherence"], r.dcJobs.map((d) => [d.id, fmt(d.xi, 2), fmt(d.zcoh)])));
  o.push("", r.status === "pending" ? "pending: the sweep is not complete" : `median xi = ${fmt(r.medianXi, 2)}; **6.1 ${r.holds ? "holds: the three 64 x 64 x 32 runs (seeds 261 to 263) are due" : `does not hold: ${r.reason ?? "final snapshots are missing"}`}**`);
  return o;
}

function renderMutation(r: MutationResult, tag: string): string[] {
  const o: string[] = [`## Mutation arms (rules 7)${tag}`, ""];
  if (r.status === "closed") return [...o, "mutation runs not made: gate closed (4.4 gave no go row)"];
  o.push(`T_end7 ${r.tEnd7}`, "");
  const void_ = r.horizonVoid === true;
  o.push(...md(["arm", "runs", "LONG", "THREE", "LOOSE", "MONO", "EXTINCT", "median supply", "Fisher p (C vs N)", "verdict"], r.arms.map((a) => [a.arm, a.nRuns, a.counts?.gL ?? "-", a.counts?.gT ?? "-", a.counts?.gLo ?? "-", a.counts?.gM ?? "-", a.counts?.gE ?? "-", fmt(a.medianSupply, 1), a.fisherP === null ? "-" : a.fisherP.toFixed(4), a.verdict ? `${a.verdict.verdict} (row ${a.verdict.row})${void_ && a.arm !== "Z" ? " VOID" : ""}` : "-"])));
  const runs = r.arms.flatMap((a) => a.runs.filter((x) => x !== null).map((x) => [a.arm, x!.id, x!.cls, x!.nRun, x!.everLong ? "yes" : "no", x!.maxY, x!.firstN4 ?? "-", x!.supplyMax, x!.events ?? "-"]));
  if (runs.length > 0) o.push("", ...md(["arm", "run", "class", "run censuses", "EVER-LONG", "max Y", "first n>=4 (run step)", "supply", "events"], runs));
  o.push("");
  if (r.horizonVoid === true) o.push("**HORIZON-VOID** (7.4): at least 3 of arm Z's 5 runs are MONO or EXTINCT, so no verdict of 7.5 says anything about mutation; every verdict above is void");
  else if (r.horizonVoid === false) o.push("horizon check (7.4) passed: fewer than 3 of arm Z's 5 runs are MONO or EXTINCT");
  if (r.predictions.length > 0) o.push("", "Registered predictions (7.6):", ...r.predictions.map((p) => `- arm ${p.arm}: ${p.text}: ${p.hit === null ? "not evaluated" : p.hit ? "hit" : "miss"}`));
  if (r.missing.length > 0) o.push("", `to run: ${r.missing.join("; ")}`);
  return o;
}

// ---- JSON ----

/** One line per job for the JSON output: the facts of the Gate-0 job list (8.5) without the census rows. */
function compactJob(x: { job: Job; a: { cls: string; tcx: unknown; chiFw: number; chiAll: number; turnoverFw: number | null; livLast: number | null } | null; source?: string }) {
  const s = x.job.s;
  return { ...(x.source === undefined ? {} : { source: x.source }), id: s.id, stage: s.stage, rung: s.rung, kill: s.kill, spread: s.spread, rate: s.rate, seed: s.seed, steps: s.steps, missing: s.missing, stepsPerSec: s.stepsPerSec, host: s.host, class: x.a?.cls ?? null, tcx: x.a?.tcx ?? null, chiFw: x.a?.chiFw ?? null, chiAll: x.a?.chiAll ?? null, turnoverFw: x.a?.turnoverFw ?? null, livLast: x.a?.livLast ?? null };
}

function jsonable(v: unknown): unknown {
  return JSON.parse(
    JSON.stringify(v, (k, x) => {
      if (k === "jobs" && Array.isArray(x) && x.length > 0 && typeof x[0] === "object" && x[0] !== null && "job" in x[0]) return x.map(compactJob);
      if (k === "problems") return undefined; // the same list is printed once at the top level
      if (x instanceof Map) return Object.fromEntries(x);
      if (x === Infinity) return "Infinity";
      if (typeof x === "bigint") return x.toString();
      return x;
    }),
  );
}

// ---- the run ----

const COMMANDS = ["lattice", "gate0", "meter", "calibration", "sweep", "cycles", "deep", "mutation"] as const;
const NEEDS_OP = new Set(["meter", "calibration", "sweep", "cycles", "deep", "mutation"]);

/** Runs one command. Never throws for bad input: that is exit code 2. */
export function run(argv: readonly string[], io: Io): RunResult {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof ReadoutError)) throw e;
    if (argv.includes(EXPLORATION_COMMAND)) return finishExploration(2, [EXPLORATION_HEADER, "", `readout: ${e.message}`], [{ code: 2, message: e.message }], null, false);
    return finish(2, [`readout: ${e.message}`], [{ code: 2, message: e.message }], false, null, false);
  }
  if (args.command === EXPLORATION_COMMAND) return runExploration(args, io);
  const root = args.root ?? io.root;
  const draft = args.draft;
  const tag = draft ? " [DRAFT]" : "";
  const pr = new Problems();
  const lines: string[] = [];
  // the rules: frozen and hash-checked, or the draft with every output labelled DRAFT
  const rulesDir = path.join(root, "experiments", "3d-rps");
  if (draft) {
    const dp = path.join(root, "runs", "rps", "rule-draft.md");
    const bytes = io.readBytes(dp);
    if (bytes === null) pr.add(2, `--draft: ${dp} not found`);
    else lines.push(`**DRAFT rules** (${dp}, sha256 ${sha256(bytes)}): not frozen, so every output below is DRAFT and is not a registered result`, "");
  } else {
    const rules = io.readBytes(path.join(rulesDir, "RULES.md"));
    const frozen = io.readText(path.join(rulesDir, "FROZEN"));
    if (rules === null || frozen === null) pr.add(2, `the rules are not frozen: ${rules === null ? "experiments/3d-rps/RULES.md" : "experiments/3d-rps/FROZEN"} not found (use --draft until the freeze)`);
    else {
      const c = checkFrozen(rules, frozen, "RULES.md");
      if (!c.ok) pr.add(2, `refusing to apply the rules: ${c.message}`);
      else lines.push(`rules: ${c.message}`, "");
      // The Gate-0 record (8.5). The registered Part B readouts need it, completed and hashed, because they take the operating point
      // from it; `gate0` and `lattice` need RULES.md only: an existing record whose hash is not (yet) recorded is provisional, and G0.6
      // completes it before it is hashed.
      const g0 = io.readBytes(path.join(rulesDir, "GATE0-RECORD.md"));
      const registered = args.command !== null && NEEDS_OP.has(args.command);
      if (c.ok && registered) {
        if (g0 === null) pr.add(2, `${args.command} is a registered Part B readout and needs the Gate-0 record experiments/3d-rps/GATE0-RECORD.md, which does not exist (8.5; use --draft until it is written and hashed)`);
        else {
          const gc = checkFrozen(g0, frozen, "GATE0-RECORD.md");
          if (!gc.ok) pr.add(2, `refusing to apply the rules: ${gc.message}`);
          else lines.push(`Gate-0 record: ${gc.message}`, "");
        }
      } else if (c.ok && g0 !== null) {
        const gc = checkFrozen(g0, frozen, "GATE0-RECORD.md");
        lines.push(gc.ok ? `Gate-0 record: ${gc.message}` : `Gate-0 record: present, and its sha256 ${gc.sha256} is not (yet) recorded in FROZEN: provisional, to be completed with G0.6 and then hashed (8.5)`, "");
      }
    }
  }
  if (args.command === null || !(COMMANDS as readonly string[]).includes(args.command)) {
    pr.add(2, `command must be one of ${COMMANDS.join(", ")}`);
  }
  if (args.registered !== undefined) pr.add(2, `--registered is for ${EXPLORATION_COMMAND} only`);
  if (pr.has(2)) return finish(2, lines, pr.list, draft, null, args.json);
  const cmd = args.command as (typeof COMMANDS)[number];
  let result: unknown = null;
  let stage: Problems = new Problems();
  let body: string[] = [];
  try {
    if (cmd === "lattice") {
      if (args.lattice === null) throw new ReadoutError(2, "lattice needs --lattice <dir>");
      const cells: LatticeCell[] = [];
      // one JSON per (L, iM); the sweep driver's chunk files (a `chunks/` directory) and JSON that is not a cell are not cells
      const files = io.walk(args.lattice).filter((f) => f.endsWith(".json") && !/(^|\/)chunks(\/|$)/.test(f));
      if (files.length === 0) throw new ReadoutError(2, `no lattice .json files under ${args.lattice}`);
      for (const f of files) {
        let raw: unknown;
        try {
          raw = JSON.parse(io.readText(f) ?? "");
        } catch (e) {
          throw new ReadoutError(2, `${f}: ${(e as Error).message}`);
        }
        const isCell = raw !== null && typeof raw === "object" && typeof (raw as { L?: unknown }).L === "number" && typeof (raw as { iM?: unknown }).iM === "number";
        if (isCell) cells.push(parseLatticeCell(raw, f));
      }
      if (cells.length === 0) throw new ReadoutError(2, `no lattice cell files (with L and iM) under ${args.lattice}`);
      const res = evaluateLattice(cells);
      result = res;
      stage = res.problems;
      body = renderLattice(res, tag);
    } else {
      if (args.jobs === null) throw new ReadoutError(2, `${cmd} needs --jobs <dir>`);
      const jobs = loadJobs(io, args.jobs, stage);
      if (cmd === "gate0") {
        const res = evaluateGate0(jobs);
        result = res;
        for (const p of res.problems.list) stage.add(p.code, p.message);
        body = renderGate0(res, tag);
      } else {
        if (NEEDS_OP.has(cmd) && args.op === null) throw new ReadoutError(2, `${cmd} needs --op <file> (the operating point of the Gate-0 record)`);
        const opText = io.readText(args.op!);
        if (opText === null) throw new ReadoutError(2, `operating point file ${args.op} not found`);
        const op = parseOperatingPoint(opText, args.op!);
        // a registered readout runs on the operating point of the hashed Gate-0 record, not on whichever file it is given (8.5)
        if (!draft) bindToRecord(op, io.readText(path.join(rulesDir, "GATE0-RECORD.md")), args.op!);
        if (cmd === "meter") {
          const res = evaluateMeter(jobs, op.gSpread);
          result = res;
          for (const p of res.problems.list) stage.add(p.code, p.message);
          body = [`## Mobility meter (rules 3.1)${tag}`, "", ...renderMeterPoints(res.points)];
        } else if (cmd === "calibration") {
          const res = evaluateCalibration(jobs, op);
          result = res;
          for (const p of res.problems.list) stage.add(p.code, p.message);
          body = renderCalibration(res, tag);
        } else {
          const sweep = evaluateSweep(jobs, op);
          for (const p of sweep.problems.list) stage.add(p.code, p.message);
          if (cmd === "sweep") {
            result = sweep;
            body = renderSweep(sweep, tag);
          } else if (cmd === "cycles") {
            const res = evaluateCycles(jobs, sweep);
            result = res;
            for (const p of res.problems.list) stage.add(p.code, p.message);
            body = [...renderSweep(sweep, tag), "", ...renderCycles(res, tag)];
          } else if (cmd === "deep") {
            const res = evaluateDeepPrecondition(sweep, (j) => measureFinal(io, j));
            result = res;
            for (const p of res.problems.list) stage.add(p.code, p.message);
            body = [...renderSweep(sweep, tag), "", ...renderDeep(res, tag)];
          } else {
            const res = evaluateMutation(jobs, op, sweep);
            result = res;
            for (const p of res.problems.list) stage.add(p.code, p.message);
            body = [...renderSweep(sweep, tag), "", ...renderMutation(res, tag)];
          }
        }
      }
    }
  } catch (e) {
    if (!(e instanceof ReadoutError)) throw e;
    stage.add(e.code, e.message);
  }
  return finish(stage.code, [...lines, ...body], stage.list, draft, result, args.json);
}

function finish(code: 0 | 2 | 3 | 4, lines: string[], problems: Problem[], draft: boolean, result: unknown, json: boolean): RunResult {
  const tail: string[] = [];
  if (problems.length > 0) tail.push("", `### Problems${draft ? " [DRAFT]" : ""}`, "", ...problems.map((p) => `- exit ${p.code}: ${p.message}`));
  tail.push("", `exit code ${code}: ${CODE_MEANING[code]}${draft ? " [DRAFT]" : ""}`);
  const out = json ? JSON.stringify({ draft, status: draft ? "DRAFT" : "FROZEN", code, problems, result: jsonable(result) }, null, 2) : [...lines, ...tail].join("\n");
  return { code, out, problems, draft, result };
}

// ---- Amendment 1: the exploration ----

const EXPLORATION_COMMAND = "gate0-exploration";
const EXPLORATION_CODE_MEANING: Record<number, string> = { 0: "both rungs have a label of A1.4 (an exploration, not a registered result)", 2: "unusable input", 3: "a situation no label covers, or a bug indicator", 4: "jobs still to run" };

/**
 * `a` is `b` or lies inside it (both absolute). A relative path leaves `b` only through a `..` segment: exactly `..` or a prefix of
 * `..` plus the separator. A child named `..exploration` is inside `b`, so a bare `startsWith("..")` would be wrong.
 */
const within = (a: string, b: string): boolean => {
  const rel = path.relative(b, a);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
};

/**
 * The real path of `p`: its nearest existing ancestor with every symlink resolved (realpath), and the part that does not exist yet
 * appended, so that an output directory still to be created is placed where it will really be.
 */
export function realPathOf(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    if (fs.existsSync(cur)) return path.join(fs.realpathSync(cur), ...rest);
    const up = path.dirname(cur);
    if (up === cur) return path.join(cur, ...rest);
    rest.unshift(path.basename(cur));
    cur = up;
  }
}

/** Two directories are one, or one lies inside the other, once symlinks are resolved (the exploration's isolation check; also gate0.ts's). */
export function dirsOverlap(a: string, b: string): boolean {
  const x = realPathOf(a);
  const y = realPathOf(b);
  return within(x, y) || within(y, x);
}

/**
 * `gate0-exploration --jobs <exploration dir> --registered <registered dir>` (RULES.md Amendment 1). The first line of every output is
 * EXPLORATION_HEADER. Refuses (exit 2) unless RULES.md is frozen and contains the Amendment 1 heading, with --draft, and when the two
 * directories are one or nest. An exploration directory with no job yet is the start of the run (exit 4, the first jobs listed).
 */
function runExploration(args: Args, io: Io): RunResult {
  const root = args.root ?? io.root;
  const lines: string[] = [EXPLORATION_HEADER, ""];
  const pr = new Problems();
  const rulesDir = path.join(root, "experiments", "3d-rps");
  if (args.draft) pr.add(2, `--draft is not available for ${EXPLORATION_COMMAND}: the exploration exists only by Amendment 1 of the frozen RULES.md`);
  else {
    const rules = io.readBytes(path.join(rulesDir, "RULES.md"));
    const frozen = io.readText(path.join(rulesDir, "FROZEN"));
    const refusal = explorationRefusal(rules, frozen);
    if (refusal !== null) pr.add(2, `refusing to apply Amendment 1: ${refusal}`);
    else lines.push(`rules: ${checkFrozen(rules!, frozen!, "RULES.md").message}, and it contains the Amendment 1 heading`, "");
  }
  if (args.jobs === null || args.registered === undefined) pr.add(2, `${EXPLORATION_COMMAND} needs --jobs <exploration dir> and --registered <registered pilot dir>`);
  else if (dirsOverlap(args.jobs, args.registered)) {
    pr.add(2, `--jobs (${args.jobs}) and --registered (${args.registered}) must be two directories, neither inside the other: the registered pilot's jobs are read only and never mixed with the exploration's`);
  }
  if (args.op !== null || args.lattice !== null) pr.add(2, `${EXPLORATION_COMMAND} takes --jobs and --registered only`);
  if (pr.has(2)) return finishExploration(2, lines, pr.list, null, args.json);
  const stage = new Problems();
  const registered = loadJobs(io, args.registered!, stage);
  const loaded = new Problems();
  const exploration = loadJobs(io, args.jobs!, loaded);
  // a directory with no job in it yet is the start of the exploration, not unusable input
  const started = io.walk(args.jobs!).some((f) => path.basename(f) === "summary.json");
  if (started) for (const p of loaded.list) stage.add(p.code, p.message);
  const res = evaluateExploration({ registered, exploration, registeredCensus: (j) => (j.dir === null ? null : io.readText(path.join(j.dir, "census.tsv"))) });
  for (const p of res.problems.list) stage.add(p.code, p.message);
  return finishExploration(stage.code, [...lines, ...renderExploration(res)], stage.list, res, args.json);
}

function finishExploration(code: 0 | 2 | 3 | 4, lines: string[], problems: Problem[], result: unknown, json: boolean): RunResult {
  const tail: string[] = [];
  if (problems.length > 0) tail.push("", "### Problems", "", ...problems.map((p) => `- exit ${p.code}: ${p.message}`));
  tail.push("", `exit code ${code}: ${EXPLORATION_CODE_MEANING[code]}`);
  // JSON keeps the header as its first key (a line before the object would not parse)
  const out = json ? JSON.stringify({ exploration: EXPLORATION_HEADER, status: "EXPLORATION", code, problems, result: jsonable(result) }, null, 2) : [...lines, ...tail].join("\n");
  return { code, out, problems, draft: false, result };
}

// ---- command line ----

if ((import.meta as { main?: boolean }).main === true) {
  const g = globalThis as unknown as { Deno?: { args: string[]; exit(c: number): never }; process?: { argv: string[]; exit(c: number): never } };
  const argv = g.Deno ? g.Deno.args : (g.process?.argv.slice(2) ?? []);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const res = run(argv, nodeIo(root));
  console.log(res.out);
  if (g.Deno) g.Deno.exit(res.code);
  else g.process?.exit(res.code);
}

// keep canonicalStage reachable for drivers that want to validate a stage name before writing summary.json
export { canonicalStage };
