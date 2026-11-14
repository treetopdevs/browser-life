// The job model of the RPS readout and the per-job rules of runs/rps/rule-draft.md section 0 (run classes, windows, T_cx,
// chirality) and 7.3 (mutation-run classes). Pure: no file access (readout.ts loads the files and hands over `Job`s).
//
// The files a job writes are those of Appendix B: `census.tsv` (B.2, parsed by @bl/metrics `parseRpsCensusTsv`) and `summary.json`
// (B.3). B.3 does not fix how the configs are laid out, so `normalizeSummary` reads the fields it needs from the top level of the
// object first and then from `config.run` (a few other spellings are tried; see CFG_PREFIXES). This is the one place that has to
// follow the Gate-0 driver and the kernel drivers: every other module works on `JobSummary`.

import { chirality, cleanCycleLength, rpsCoexist, rpsIsPresent, type RpsCensusRecord } from "@bl/metrics";

// ---- constants of the rule draft ----

/** The burn-in of section 0 and 1.3 (D5, D13). */
export const B_IN = 6000;
/** Census interval in steps. */
export const CENSUS_INTERVAL = 1000;
/** Final window of sections 3 to 6, in run censuses. */
export const WINDOW = 20;
/** Final window of section 7. */
export const WINDOW7 = 50;
/** `liv(c) < 0.01` is extinct. */
export const LIV_EXT = 0.01;
/** A run is alive iff `liv(c) >= 0.20` at all censuses of its final window. */
export const LIV_ALIVE = 0.2;
/** A job starts iff `liv >= 0.50` at the last burn-in census. */
export const LIV_START = 0.5;
/** Dynamic iff the turnover over the final window is at least this (exactly: 1 / 50, see `windowTurnover`). */
export const TURNOVER_DYNAMIC = 0.02;
/** The cyclic signature: `chi_fw >= 0.2`. */
export const CHI_DC = 0.2;
/** A control is informative only with `|chi_fw|` at most this (median over the controls). */
export const CHI_CONTROL = 0.1;
/** A control with `|chi_fw|` above this is a bug indicator (8.4). */
export const CHI_CONTROL_BUG = 0.3;
/** Three consecutive censuses without `coexist` are a sustained loss. */
export const LOSS_CONSECUTIVE = 3;
/**
 * The name, up to the job id, of the hidden file beside the jobs in which the harness keeps the failures of a rerun that passed but lost
 * the publish race (`.retried-<id>-<pid>-<n>.json`, rule draft 1.3): the readout lists it as a bug indicator (8.4) and the Gate-0 driver
 * stops on it.
 */
export const LOST_RACE_PREFIX = ".retried-";

// ---- problems and exit codes ----

/** 2 unusable input, 3 a situation no row covers or a bug indicator, 4 jobs still missing (8.4). */
export type ProblemCode = 2 | 3 | 4;
export interface Problem {
  code: ProblemCode;
  message: string;
}

/** Thrown by the per-job rules for input they cannot use; the stage code turns it into a `Problem`. */
export class ReadoutError extends Error {
  constructor(
    readonly code: ProblemCode,
    message: string,
  ) {
    super(message);
  }
}

export class Problems {
  readonly list: Problem[] = [];
  add(code: ProblemCode, message: string): void {
    if (!this.list.some((p) => p.code === code && p.message === message)) this.list.push({ code, message });
  }
  /** Runs `f`; a `ReadoutError` becomes a problem and the result is null. */
  guard<T>(f: () => T): T | null {
    try {
      return f();
    } catch (e) {
      if (e instanceof ReadoutError) {
        this.add(e.code, e.message);
        return null;
      }
      throw e;
    }
  }
  /** The exit code these problems give: 2 before 3 before 4, else 0. */
  get code(): 0 | 2 | 3 | 4 {
    for (const c of [2, 3, 4] as const) if (this.list.some((p) => p.code === c)) return c;
    return 0;
  }
  has(code: ProblemCode): boolean {
    return this.list.some((p) => p.code === code);
  }
}

// ---- small statistics ----

/** Median; the mean of the two middle values for an even count (NaN for no values). */
export function medianMean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median; the lower of the two middle values for an even count (NaN for no values). */
export function medianLower(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[(s.length - 1) >> 1];
}

const binom = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
};

/**
 * One-sided exact Fisher test: the probability, given the margins, of `a` or more successes in the first group of a 2 x 2 table
 * `[[a, b], [c, d]]` (group 1: `a` successes of `a + b`; group 2: `c` successes of `c + d`).
 */
export function fisherOneSided(a: number, b: number, c: number, d: number): number {
  const n1 = a + b;
  const n2 = c + d;
  const k = a + c;
  const total = binom(n1 + n2, k);
  let p = 0;
  for (let x = a; x <= Math.min(n1, k); x++) p += binom(n1, x) * binom(n2, k - x);
  return p / total;
}

// ---- stages, rungs and the summary ----

export type Rung = "S0" | "S1" | "S2" | "V";
export type SubstrateRung = "S0" | "S1" | "S2";
export type Kill = "removal" | "vacancy";
export type Arm = "Z" | "A" | "B" | "C" | "N" | "W";

/**
 * The stage names the readout knows. Gate 0: `g0.scan` (G0.2 control scan), `g0.meter` (G0.2 meter), `g0.table` (G0.3), `g0.horizon`
 * (G0.4), `g0.confirm` (G0.5), `g0.dense` (G0.6), `g0.vcheck` (the V check of G0.1) and `g0.horizon-rung` (the 256 x 256 x 4 horizon
 * rung). Registered stages: `meter` (3.1), `calibration` (3.2), `sweep` (4.1 treatment and control, told apart by `rpsRate`),
 * `rate-arm` (4.1), `cycles` (5), `deep` (6.2) and `mutation` (7).
 */
export const STAGES = [
  "g0.scan",
  "g0.meter",
  "g0.table",
  "g0.horizon",
  "g0.confirm",
  "g0.dense",
  "g0.vcheck",
  "g0.horizon-rung",
  "meter",
  "calibration",
  "sweep",
  "rate-arm",
  "cycles",
  "deep",
  "mutation",
] as const;
export type Stage = (typeof STAGES)[number];

const STAGE_ALIASES: Record<string, Stage> = {
  "g0.2-scan": "g0.scan",
  "g0-scan": "g0.scan",
  "gate0-scan": "g0.scan",
  "g0.2-meter": "g0.meter",
  "g0-meter": "g0.meter",
  "gate0-meter": "g0.meter",
  "g0.3": "g0.table",
  "g0.3-table": "g0.table",
  "g0-table": "g0.table",
  "gate0-table": "g0.table",
  "g0.4": "g0.horizon",
  "g0.4-horizon": "g0.horizon",
  "g0-horizon": "g0.horizon",
  "gate0-horizon": "g0.horizon",
  "g0.5": "g0.confirm",
  "g0.5-confirm": "g0.confirm",
  "g0-confirm": "g0.confirm",
  "gate0-confirm": "g0.confirm",
  "g0.6": "g0.dense",
  "g0.6-dense": "g0.dense",
  "g0-dense": "g0.dense",
  "g0-vcheck": "g0.vcheck",
  "vcheck": "g0.vcheck",
  "v-check": "g0.vcheck",
  "g0-horizon-rung": "g0.horizon-rung",
  "horizon-rung": "g0.horizon-rung",
  "3.1": "meter",
  "3.1-meter": "meter",
  "3.2": "calibration",
  "3.2-calibration": "calibration",
  "kappa": "calibration",
  "4": "sweep",
  "4.1": "sweep",
  "sweep-treatment": "sweep",
  "sweep-control": "sweep",
  "rate-arms": "rate-arm",
  "4.1-rate-arm": "rate-arm",
  "5": "cycles",
  "m3c": "cycles",
  "longer-cycles": "cycles",
  "6": "deep",
  "6.2": "deep",
  "deep-volume": "deep",
  "7": "mutation",
  "m4": "mutation",
};

/** Maps a stage string to a known stage (case, spaces and underscores are normalised); null if unknown. */
export function canonicalStage(s: string): Stage | null {
  const k = s.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if ((STAGES as readonly string[]).includes(k)) return k as Stage;
  return STAGE_ALIASES[k] ?? null;
}

/** One failed attempt of a job (1.3), as the harness records it: kind `crash`, `conservation` or `invariant`. */
export interface AttemptFailure {
  attempt: number | null;
  kind: string;
  step: number | null;
  message: string;
}

export interface JobSummary {
  id: string;
  stage: Stage;
  rung: Rung | null;
  kill: Kill | null;
  /** The substrate rung a rung-V job ran on, if the job records it. */
  substrate: SubstrateRung | null;
  arm: Arm | null;
  seed: number;
  /** Job steps run. */
  steps: number | null;
  stopKind: string | null;
  stopRstep: number | null;
  /** The job failed twice and is marked MISSING (1.3). */
  missing: boolean;
  /** Failures of earlier attempts: `retried` of a job that passed on a rerun, `failures` of a MISSING marker. */
  attemptFailures: AttemptFailure[];
  host: string | null;
  device: string | null;
  stepsPerSec: number | null;
  matterOk: boolean | null;
  residual: string | null;
  burnHash: string | null;
  /**
   * Canonical JSON of the burn-phase `WorldConfig` and `InitParams` with the seed, when summary.json carries them. `stateHash` covers
   * the config, so `burnHash` is equal exactly for jobs with the same seed and the same burn-in config.
   */
  burnKey: string | null;
  events: number | null;
  /** Path of `final.bin`, if written. */
  final: string | null;
  /** Correlation length of the final snapshot, if the driver stored it (the readout prefers `final.bin`). */
  xi: number | null;
  dims: { W: number; H: number; D: number } | null;
  spread: number | null;
  rate: number | null;
  K0: number | null;
  types: number | null;
  mutRate: number | null;
  flip: number | null;
  edge: number | null;
  /** Mobility-meter record (stages `meter` and `g0.meter`). */
  meter: { axis: "x" | "y" | null; W: number | null; Wx: number | null; Wy: number | null; Dx: number | null; Dy: number | null; t: number | null; bMeter: number | null } | null;
}

export interface Job {
  s: JobSummary;
  /** Parsed `census.tsv`; null for jobs without one (the meter). */
  rows: RpsCensusRecord[] | null;
  /** The raw `census.tsv`, kept only for the V check. */
  censusText: string | null;
  /** Where `final.bin` is, resolved by the loader. */
  finalPath: string | null;
  dir: string | null;
}

type Raw = Record<string, unknown>;

function dig(o: unknown, path: string): unknown {
  let cur: unknown = o;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Raw)[k];
  }
  return cur;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The failed attempts a summary lists (`retried`, `failures`); entries without a kind are ignored. */
function failureList(v: unknown): AttemptFailure[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    if (x === null || typeof x !== "object") return [];
    const o = x as Raw;
    const kind = str(o.kind);
    return kind === null ? [] : [{ attempt: num(o.attempt), kind, step: num(o.step), message: str(o.message) ?? "" }];
  });
}

/** Where the run-phase `WorldConfig` fields may sit in `summary.json`, first match wins. */
const CFG_PREFIXES = ["", "config.run", "runConfig", "cfg.run", "run.config", "config", "cfg"];
/** Where the run-phase `InitParams` may sit. */
const INIT_PREFIXES = ["", "init.run", "initParams.run", "runInit", "run.init", "init", "initParams"];

function field(r: Raw, prefixes: readonly string[], names: readonly string[]): unknown {
  for (const p of prefixes) {
    for (const n of names) {
      const v = dig(r, p === "" ? n : `${p}.${n}`);
      if (v !== undefined && v !== null) return v;
    }
  }
  return undefined;
}

/** JSON with object keys sorted recursively, for comparing configs. */
export function canonicalJson(v: unknown): string {
  const canon = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(canon);
    if (x !== null && typeof x === "object") return Object.fromEntries(Object.keys(x as Raw).sort().map((k) => [k, canon((x as Raw)[k])]));
    return x;
  };
  return JSON.stringify(canon(v));
}

/** Config keys that only select the kill form. The burn-in runs at `rpsRate` 0, so a removal job and a vacancy-kill job of one seed share one burn-in trajectory (8.4). */
const KILL_FORM_KEYS = ["rpsKill"];

function parseBurnKey(r: Raw, seed: number): string | null {
  const cfg = field(r, [""], ["burnConfig"]) ?? dig(r, "config.burn") ?? dig(r, "cfg.burn") ?? dig(r, "burn.config");
  if (cfg === undefined || cfg === null) return null;
  const init = field(r, [""], ["burnInit"]) ?? dig(r, "init.burn") ?? dig(r, "initParams.burn") ?? dig(r, "burn.init") ?? null;
  const plain = typeof cfg === "object" && !Array.isArray(cfg) ? Object.fromEntries(Object.entries(cfg as Raw).filter(([k]) => !KILL_FORM_KEYS.includes(k))) : cfg;
  return canonicalJson([seed, plain, init]);
}

function parseShape(r: Raw): { W: number; H: number; D: number } | null {
  const s = r.shape;
  if (Array.isArray(s) && s.length === 3 && s.every((v) => num(v) !== null)) return { W: Number(s[0]), H: Number(s[1]), D: Number(s[2]) };
  if (typeof s === "string") {
    const m = /^(\d+)\s*[x*]\s*(\d+)\s*[x*]\s*(\d+)$/i.exec(s.trim());
    if (m) return { W: Number(m[1]), H: Number(m[2]), D: Number(m[3]) };
  }
  const tw = num(field(r, CFG_PREFIXES, ["tileW"]));
  const th = num(field(r, CFG_PREFIXES, ["tileH"]));
  const td = num(field(r, CFG_PREFIXES, ["tileD"]));
  if (tw !== null && th !== null && td !== null) {
    const tx = num(field(r, CFG_PREFIXES, ["tilesX"])) ?? 1;
    const ty = num(field(r, CFG_PREFIXES, ["tilesY"])) ?? 1;
    return { W: tw * tx, H: th * ty, D: td };
  }
  return null;
}

function parseStop(r: Raw): { kind: string | null; rstep: number | null } {
  const s = r.stop;
  if (typeof s === "string") return { kind: s.toLowerCase(), rstep: num(r.stopRstep) ?? num(r.stopStep) };
  if (s !== null && typeof s === "object") {
    const o = s as Raw;
    const kind = str(o.kind) ?? str(o.reason) ?? str(o.type);
    return { kind: kind === null ? null : kind.toLowerCase(), rstep: num(o.rstep) ?? num(o.step) };
  }
  return { kind: null, rstep: num(r.stopRstep) ?? num(r.stopStep) };
}

function parseMeter(r: Raw): JobSummary["meter"] {
  const m = (r.meter !== null && typeof r.meter === "object" ? (r.meter as Raw) : r) as Raw;
  const axisRaw = str(m.axis);
  const axis: "x" | "y" | null = axisRaw === "x" ? "x" : axisRaw === "y" ? "y" : null;
  const out = {
    axis,
    W: num(m.W),
    Wx: num(m.Wx),
    Wy: num(m.Wy),
    Dx: num(m.Dx),
    Dy: num(m.Dy),
    t: num(m.t),
    bMeter: num(m.bMeter) ?? num(m.B_meter),
  };
  return Object.values(out).every((v) => v === null) ? null : out;
}

/** Reads one `summary.json` into the fields the readout uses. Throws `ReadoutError(2)` for an unknown stage or a missing seed. */
export function normalizeSummary(raw: unknown, where: string): JobSummary {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ReadoutError(2, `${where}: summary.json is not an object`);
  const r = raw as Raw;
  const stage = typeof r.stage === "string" ? canonicalStage(r.stage) : null;
  if (stage === null) throw new ReadoutError(2, `${where}: unknown stage ${JSON.stringify(r.stage)}`);
  const seed = num(r.seed);
  if (seed === null) throw new ReadoutError(2, `${where}: summary.json has no seed`);
  const rungRaw = str(r.rung);
  if (rungRaw !== null && !["S0", "S1", "S2", "V"].includes(rungRaw)) throw new ReadoutError(2, `${where}: rung ${JSON.stringify(rungRaw)} is not S0, S1, S2 or V`);
  const killRaw = str(r.kill);
  if (killRaw !== null && killRaw !== "removal" && killRaw !== "vacancy") throw new ReadoutError(2, `${where}: kill ${JSON.stringify(killRaw)} is not removal or vacancy`);
  const subRaw = str(r.substrate);
  const armRaw = str(r.arm);
  if (armRaw !== null && !["Z", "A", "B", "C", "N", "W"].includes(armRaw)) throw new ReadoutError(2, `${where}: arm ${JSON.stringify(armRaw)} is not Z, A, B, C, N or W`);
  const stop = parseStop(r);
  const residualRaw = r.residual;
  return {
    id: str(r.id) ?? where,
    stage,
    rung: rungRaw as Rung | null,
    kill: killRaw as Kill | null,
    substrate: subRaw === "S0" || subRaw === "S1" || subRaw === "S2" ? subRaw : null,
    arm: armRaw as Arm | null,
    seed,
    steps: num(r.steps),
    stopKind: stop.kind,
    stopRstep: stop.rstep,
    missing: r.missing === true || r.status === "missing" || stop.kind === "missing",
    attemptFailures: [...failureList(r.retried), ...failureList(r.failures)],
    host: str(r.host),
    device: str(r.device),
    stepsPerSec: num(r.stepsPerSec),
    matterOk: typeof r.matterOk === "boolean" ? r.matterOk : null,
    residual: typeof residualRaw === "string" ? residualRaw : typeof residualRaw === "number" ? String(residualRaw) : typeof residualRaw === "bigint" ? String(residualRaw) : null,
    burnHash: str(r.burnHash),
    burnKey: parseBurnKey(r, seed),
    events: num(r.events),
    final: str(r.final),
    xi: num(r.xi),
    dims: parseShape(r),
    spread: num(field(r, CFG_PREFIXES, ["spread"])),
    rate: num(field(r, CFG_PREFIXES, ["rpsRate", "rate"])),
    K0: num(field(r, ["", ...INIT_PREFIXES.slice(1), ...CFG_PREFIXES.slice(1)], ["K0", "founders"])),
    types: num(field(r, CFG_PREFIXES, ["rpsTypes"])),
    mutRate: num(field(r, CFG_PREFIXES, ["mutRate"])),
    flip: num(field(r, CFG_PREFIXES, ["rpsFlip"])),
    edge: num(field(r, CFG_PREFIXES, ["rpsEdge"])),
    meter: stage === "meter" || stage === "g0.meter" ? parseMeter(r) : null,
  };
}

// ---- prepared census rows ----

export interface PreparedRow {
  rec: RpsCensusRecord;
  /** `living / total cells`. */
  liv: number;
  present: boolean[];
  /** The present labels, ascending. */
  S: number[];
  n: number;
  coexist: boolean;
  Y: number;
}

export interface PreparedJob {
  burn: PreparedRow[];
  run: PreparedRow[];
}

export function jobCells(s: JobSummary): number {
  if (s.dims === null) throw new ReadoutError(2, `${s.id}: summary.json gives no shape (shape, or tileW/tileH/tileD in the config)`);
  return s.dims.W * s.dims.H * s.dims.D;
}

/** Splits the burn-in and run rows, checks their bookkeeping, and recomputes `n`, `coexist` and `Y` from the columns (they must equal the stored `n` and `Y`). */
export function prepareRows(job: Job, K0: number): PreparedJob {
  const id = job.s.id;
  if (job.rows === null || job.rows.length === 0) throw new ReadoutError(2, `${id}: no census.tsv rows`);
  const total = jobCells(job.s);
  const burn: PreparedRow[] = [];
  const run: PreparedRow[] = [];
  let prevStep = -Infinity;
  for (const rec of job.rows) {
    if (rec.step <= prevStep) throw new ReadoutError(2, `${id}: census.tsv steps are not increasing at step ${rec.step}`);
    prevStep = rec.step;
    // the schedule of section 0: a census every 1,000 steps from step 1,000 and none missing (a gap would change the burn-in's last row or a window)
    const wantStep = CENSUS_INTERVAL * (burn.length + run.length + 1);
    if (rec.step !== wantStep) throw new ReadoutError(2, `${id}: census.tsv has a census at step ${rec.step} where the schedule has step ${wantStep} (a census every ${CENSUS_INTERVAL} steps from step ${CENSUS_INTERVAL}, none missing)`);
    if (rec.rstep !== rec.step - B_IN) throw new ReadoutError(2, `${id}: census.tsv step ${rec.step} has rstep ${rec.rstep}, expected ${rec.step - B_IN} (burn-in ${B_IN})`);
    if (rec.phase === "burn" ? rec.rstep > 0 : rec.rstep <= 0) throw new ReadoutError(2, `${id}: census.tsv step ${rec.step} is phase ${rec.phase} with rstep ${rec.rstep}`);
    if (rec.phase === "burn" && run.length > 0) throw new ReadoutError(2, `${id}: a burn-in row follows a run row at step ${rec.step}`);
    const sumCells = rec.cells.reduce((a, b) => a + b, 0);
    if (sumCells !== rec.living) throw new ReadoutError(2, `${id}: census.tsv step ${rec.step}: label counts add up to ${sumCells}, living is ${rec.living}`);
    if (rec.living > total) throw new ReadoutError(2, `${id}: census.tsv step ${rec.step}: ${rec.living} living cells of ${total}`);
    const present = rec.cells.map((c) => rpsIsPresent(c, rec.living));
    const S = present.flatMap((p, x) => (p ? [x] : []));
    const Y = cleanCycleLength(S, rec.modal);
    if (S.length !== rec.n) throw new ReadoutError(2, `${id}: census.tsv step ${rec.step}: n is ${rec.n}, the label counts give ${S.length}`);
    if (Y !== rec.Y) throw new ReadoutError(2, `${id}: census.tsv step ${rec.step}: Y is ${rec.Y}, the modal masks give ${Y}`);
    const row: PreparedRow = { rec, liv: rec.living / total, present, S, n: S.length, coexist: rpsCoexist(present, K0), Y };
    (rec.phase === "burn" ? burn : run).push(row);
  }
  const wantBurn = B_IN / CENSUS_INTERVAL;
  if (burn.length !== wantBurn) throw new ReadoutError(2, `${id}: census.tsv has ${burn.length} burn-in censuses, the schedule gives ${wantBurn} (steps ${CENSUS_INTERVAL} to ${B_IN})`);
  return { burn, run };
}

function needK0(s: JobSummary): number {
  if (s.K0 === null) throw new ReadoutError(2, `${s.id}: summary.json gives no K0 (init founders)`);
  return s.K0;
}

// ---- run classes (sections 3 to 6) ----

export type RunClass = "NOSTART" | "EXT" | "LOSS" | "SPARSE" | "LATE" | "FC" | "CHURN" | "DC";
export const RUN_CLASSES: readonly RunClass[] = ["NOSTART", "EXT", "LOSS", "SPARSE", "LATE", "FC", "CHURN", "DC"];

export interface RunAnalysis {
  id: string;
  cls: RunClass;
  /** `T_cx` in run steps: the stop step for EXT, the first census of the loss for LOSS, CENSORED otherwise, null for NOSTART. */
  tcx: number | "CENSORED" | null;
  /** Run censuses used (after the early stop). */
  nRun: number;
  /** Run step of the census at which the job stopped early (EXT or the third census of a LOSS), else null. */
  stopRstep: number | null;
  /** `liv` at the last used run census. */
  livLast: number | null;
  /** `liv >= 0.50` at every used run census (the `carpet` test of G0.2). */
  carpetAll: boolean;
  /** `(B + P)` per living cell at the last used run census. */
  massPerCell: number | null;
  hasWindow: boolean;
  /** Mean turnover over the final window; null without one. */
  turnoverFw: number | null;
  chiFw: number;
  chiAll: number;
  /** Mean z-coherence over the final window (reported). */
  zcohFw: number | null;
  /** The used run rows. */
  rows: PreparedRow[];
  /** The last burn-in row (NOSTART jobs included). */
  burnLast: PreparedRow | null;
}

export interface RunOptions {
  /** Final window in run censuses (20). */
  window?: number;
  /** Run censuses a job that ends normally must have; a job of another length is unusable input. */
  expectedRun?: number | null;
}

// ---- the turnover of a window, exactly (rule draft 0: Turnover, Dynamic) ----

/** A fraction of two counts, `num / den`, with `den` positive. */
export interface Ratio {
  num: bigint;
  den: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

/**
 * The fraction `k / n` with `n` at most `nMax` of which the double `t` is the correctly rounded value, in lowest terms, or null if there
 * is none. A census file holds each turnover as such a quotient (`changed / both`, with `both` at most the number of cells). Two
 * different fractions with denominators at most `nMax` differ by at least 1 / nMax^2, which is far more than the spacing of doubles
 * (for `nMax` below 2^24), so the fraction is unique; it is a convergent of the continued fraction of `t` (a fraction within 1 / (2 q^2)
 * of `t` is one), and each convergent is tried by the same division the census made.
 */
export function turnoverRatio(t: number, nMax: number): Ratio | null {
  if (!Number.isFinite(t) || t < 0 || t > 1 || !Number.isInteger(nMax) || nMax < 1) return null;
  if (t === 0) return { num: 0n, den: 1n };
  if (t === 1) return { num: 1n, den: 1n };
  // t = m / 2^s exactly
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, t);
  const bits = view.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  let m = bits & 0xfffffffffffffn;
  let shift = 1074;
  if (expBits !== 0) {
    m |= 1n << 52n;
    shift = 1075 - expBits;
  }
  const limit = BigInt(nMax);
  let [p0, q0, p1, q1] = [0n, 1n, 1n, 0n];
  let [x, y] = [m, 1n << BigInt(shift)];
  while (y !== 0n) {
    const a = x / y;
    const p2 = a * p1 + p0;
    const q2 = a * q1 + q0;
    if (q2 > limit) return null;
    [p0, q0, p1, q1] = [p1, q1, p2, q2];
    if (Number(p1) / Number(q1) === t) return { num: p1, den: q1 };
    [x, y] = [y, x - a * y];
  }
  return null;
}

export interface WindowTurnover {
  /** The exact mean of the window's turnovers, as a double (for reports). */
  mean: number;
  /** The exact mean is at least `TURNOVER_DYNAMIC` (1 / 50): decided on the fractions, not on the doubles. */
  dynamic: boolean;
}

/**
 * The mean of a window's turnovers, computed exactly: each value is recovered as the fraction of cell counts it came from
 * (`turnoverRatio`), the fractions are added as rationals, and the mean is compared with 1 / 50. A mean of exactly 0.02 is dynamic
 * whatever floating-point addition would make of the same values. Null if some value is not a quotient of two counts at most `nMax`.
 */
export function windowTurnover(values: readonly number[], nMax: number): WindowTurnover | null {
  if (values.length === 0) return null;
  let sum: Ratio = { num: 0n, den: 1n };
  for (const v of values) {
    const r = turnoverRatio(v, nMax);
    if (r === null) return null;
    const num = sum.num * r.den + r.num * sum.den;
    const den = sum.den * r.den;
    const g = gcd(num, den);
    sum = { num: num / g, den: den / g };
  }
  const den = sum.den * BigInt(values.length);
  return { mean: Number(sum.num) / Number(den), dynamic: sum.num * 50n >= den };
}

const sumOf = (xs: readonly (number | null)[], what: string, id: string): number => {
  let t = 0;
  for (const x of xs) {
    if (x === null) throw new ReadoutError(2, `${id}: ${what} is empty in a census of a mutRate-0 job`);
    t += x;
  }
  return t;
};

/** Makes the per-census fields of an analysis non-enumerable: still there for the rules, but not part of a JSON dump. */
function hideHeavy<T extends object>(a: T, ...keys: (keyof T)[]): T {
  for (const k of keys) {
    const value = a[k];
    Object.defineProperty(a, k, { value, enumerable: false, writable: true, configurable: true });
  }
  return a;
}

/** The class, `T_cx`, final-window turnover and chirality of one job of sections 3 to 6 (rule draft 0). */
export function analyzeRun(job: Job, opts: RunOptions = {}): RunAnalysis {
  return hideHeavy(analyzeRunRaw(job, opts), "rows", "burnLast");
}

function analyzeRunRaw(job: Job, opts: RunOptions): RunAnalysis {
  const s = job.s;
  const W = opts.window ?? WINDOW;
  const K0 = needK0(s);
  if (s.missing) throw new ReadoutError(2, `${s.id}: a MISSING job has no run class`);
  const { burn, run } = prepareRows(job, K0);
  const burnLast = burn.length > 0 ? burn[burn.length - 1] : null;
  if (burnLast === null) throw new ReadoutError(2, `${s.id}: census.tsv has no burn-in rows`);
  if (job.rows![job.rows!.length - 1].step !== s.steps && s.steps !== null) {
    throw new ReadoutError(2, `${s.id}: summary.json says ${s.steps} steps, census.tsv ends at step ${job.rows![job.rows!.length - 1].step}`);
  }
  const base = { id: s.id, burnLast, hasWindow: false, turnoverFw: null, chiFw: 0, chiAll: 0, zcohFw: null, nRun: 0, stopRstep: null, livLast: null, carpetAll: false, massPerCell: null };
  // NOSTART: the film has not become a carpet with all founding labels by the end of the burn-in (a harness job stops at the hand-over, 1.5)
  if (isNoStart(burn)) {
    return { ...base, cls: "NOSTART", tcx: null, rows: [] };
  }
  // early stop: the first run census at which the job is extinct or a sustained loss completes (1.5); nothing after it is used
  let stopAt = -1;
  let streak = 0;
  for (let k = 0; k < run.length; k++) {
    streak = run[k].coexist ? 0 : streak + 1;
    if (run[k].liv < LIV_EXT || streak >= LOSS_CONSECUTIVE) {
      stopAt = k;
      break;
    }
  }
  const used = stopAt >= 0 ? run.slice(0, stopAt + 1) : run;
  if (stopAt < 0 && opts.expectedRun !== null && opts.expectedRun !== undefined && used.length !== opts.expectedRun) {
    throw new ReadoutError(2, `${s.id}: ${used.length} run censuses, the schedule gives ${opts.expectedRun}`);
  }
  const rstepOf = (r: PreparedRow) => r.rec.rstep;
  const last = used[used.length - 1];
  const common = {
    nRun: used.length,
    rows: used,
    livLast: last ? last.liv : null,
    carpetAll: used.length > 0 && used.every((r) => r.liv >= LIV_START),
    massPerCell: last && last.rec.living > 0 ? last.rec.mass.reduce((a, b) => a + b, 0) / last.rec.living : null,
  };
  // the window is the last W run censuses a job has; a job that stopped before W censuses has none (chi_fw is then 0)
  const window = used.length >= W ? used.slice(used.length - W) : null;
  const sums = (rows: readonly PreparedRow[]) => ({
    dom: sumOf(rows.map((r) => r.rec.ndom), "ndom", s.id),
    anti: sumOf(rows.map((r) => r.rec.nanti), "nanti", s.id),
  });
  const chiOf = (rows: readonly PreparedRow[]) => {
    const t = sums(rows);
    return chirality(t.dom, t.anti);
  };
  const extinct = last !== undefined && last.liv < LIV_EXT;
  // A sustained loss is complete at the stop census iff the run of censuses without `coexist` has reached three there. An EXT census
  // can complete one too (the class is then EXT, which comes first in the table), and chi_all stops before the loss either way.
  const lossComplete = stopAt >= 0 && streak >= LOSS_CONSECUTIVE;
  const lossStopped = lossComplete && !extinct;
  // chi_all: every run census up to the last one before a sustained loss (all of them if there is none)
  const allRows = lossComplete ? used.slice(0, used.length - LOSS_CONSECUTIVE) : used;
  const chiAll = chiOf(allRows);
  const chiFw = window ? chiOf(window) : 0;
  const withWindow = { ...base, ...common, chiAll, chiFw, hasWindow: window !== null };
  if (extinct) return { ...withWindow, cls: "EXT", tcx: rstepOf(last), stopRstep: rstepOf(last) };
  if (lossStopped) return { ...withWindow, cls: "LOSS", tcx: rstepOf(used[used.length - LOSS_CONSECUTIVE]), stopRstep: rstepOf(last) };
  if (window === null) throw new ReadoutError(2, `${s.id}: ${used.length} run censuses, fewer than the final window of ${W}`);
  // The turnover of the final window (section 0): its mean is exact, and a census at which no cell lives at both censuses (an empty
  // field) has none. Only the rows FC, CHURN and DC need it; SPARSE and LATE are decided without it, so an empty field stops the
  // readout (code 3: no row covers it) only when the class reaches the turnover test, and a value that is not a quotient of two cell
  // counts (a file that does not follow B.2) stops it with code 2 there too.
  const turnovers = window.map((r) => r.rec.turnover);
  const defined = turnovers.every((t): t is number => t !== null);
  const exact = defined ? windowTurnover(turnovers as number[], jobCells(s)) : null;
  const turnoverFw = !defined ? null : exact !== null ? exact.mean : (turnovers as number[]).reduce((a, b) => a + b, 0) / W;
  const zs = window.map((r) => r.rec.zcoh).filter((z): z is number => z !== null);
  const zcohFw = zs.length === 0 ? null : zs.reduce((a, b) => a + b, 0) / zs.length;
  const fin = { ...withWindow, turnoverFw, zcohFw, tcx: "CENSORED" as const };
  if (!window.every((r) => r.liv >= LIV_ALIVE)) return { ...fin, cls: "SPARSE" };
  if (!window.every((r) => r.coexist)) return { ...fin, cls: "LATE" };
  if (!defined) {
    const k = turnovers.findIndex((t) => t === null);
    throw new ReadoutError(3, `${s.id}: no cell lives at both censuses ${window[k].rec.step - CENSUS_INTERVAL} and ${window[k].rec.step}, so the turnover of that census is undefined, and the class (FC, CHURN or DC) needs it: no row covers this (section 0)`);
  }
  if (exact === null) {
    const k = turnovers.findIndex((t) => turnoverRatio(t as number, jobCells(s)) === null);
    throw new ReadoutError(2, `${s.id}: census.tsv step ${window[k].rec.step}: turnover ${turnovers[k]} is not a quotient of two cell counts (at most ${jobCells(s)} cells), which B.2 requires`);
  }
  if (!exact.dynamic) return { ...fin, cls: "FC" };
  return { ...fin, cls: chiFw >= CHI_DC ? "DC" : "CHURN" };
}

/**
 * Section 0, class NOSTART, as a function of the burn-in censuses (in order, `liv` and `coexist` of each): the film has not become a
 * carpet with all founding labels by the end of the burn-in, that is, `liv < 0.01` at any burn-in census, or `liv < 0.50` or `coexist`
 * false at the last. One definition: the readout classes a job with it (`analyzeRun`) and the kernel-job harness stops a job at the
 * hand-over census with it (rule draft 1.5).
 */
export function isNoStart(burn: readonly { liv: number; coexist: boolean }[]): boolean {
  const last = burn[burn.length - 1];
  return burn.some((r) => r.liv < LIV_EXT) || (last !== undefined && (last.liv < LIV_START || !last.coexist));
}

/** True iff the job was alive with `coexist` at every census of its final window (the classes FC, CHURN and DC). */
export const keepsLabels = (a: RunAnalysis): boolean => a.cls === "FC" || a.cls === "CHURN" || a.cls === "DC";

// ---- run classes of section 7 ----

export type MutationClass = "EXTINCT" | "LONG" | "THREE" | "LOOSE" | "MONO";

export interface MutationAnalysis {
  id: string;
  cls: MutationClass;
  nRun: number;
  /** The job stopped early: at an EXTINCT census, or (arms Z, A and W) at the third census in a row with `n_c <= 1`. */
  stoppedEarly: boolean;
  /** A stretch of 20 consecutive censuses with `Y_c >= 4` anywhere. */
  everLong: boolean;
  maxY: number;
  /** Run step of the first census with `n_c >= 4`; null if none. */
  firstN4: number | null;
  /** The largest `supply` over the censuses. */
  supplyMax: number;
  events: number | null;
}

export const EVER_LONG_STRETCH = 20;
const MONO_CONSECUTIVE = 3;

/** Section 7.3: the class of a mutation run, plus the facts recorded for every run. `arm` decides whether the MONO early stop of 7.2a applies. */
export function analyzeMutation(job: Job, arm: Arm, opts: { expectedRun?: number | null } = {}): MutationAnalysis {
  const s = job.s;
  if (s.missing) throw new ReadoutError(2, `${s.id}: a MISSING job has no run class`);
  const K0 = needK0(s);
  const { run } = prepareRows(job, K0);
  if (job.rows![job.rows!.length - 1].step !== s.steps && s.steps !== null) {
    throw new ReadoutError(2, `${s.id}: summary.json says ${s.steps} steps, census.tsv ends at step ${job.rows![job.rows!.length - 1].step}`);
  }
  const monoStops = arm === "Z" || arm === "A" || arm === "W";
  let stopAt = -1;
  let monoStreak = 0;
  let stoppedMono = false;
  for (let k = 0; k < run.length; k++) {
    monoStreak = run[k].n <= 1 ? monoStreak + 1 : 0;
    if (run[k].liv < LIV_EXT) {
      stopAt = k;
      break;
    }
    if (monoStops && monoStreak >= MONO_CONSECUTIVE) {
      stopAt = k;
      stoppedMono = true;
      break;
    }
  }
  const used = stopAt >= 0 ? run.slice(0, stopAt + 1) : run;
  if (stopAt < 0 && opts.expectedRun !== null && opts.expectedRun !== undefined && used.length !== opts.expectedRun) {
    throw new ReadoutError(2, `${s.id}: ${used.length} run censuses, the schedule gives ${opts.expectedRun}`);
  }
  const supplies = used.map((r) => r.rec.supply);
  if (supplies.some((v) => v === null)) throw new ReadoutError(2, `${s.id}: supply is empty in a census of a mutation run`);
  let stretch = 0;
  let everLong = false;
  let maxY = 0;
  let firstN4: number | null = null;
  for (const r of used) {
    stretch = r.Y >= 4 ? stretch + 1 : 0;
    if (stretch >= EVER_LONG_STRETCH) everLong = true;
    maxY = Math.max(maxY, r.Y);
    if (firstN4 === null && r.n >= 4) firstN4 = r.rec.rstep;
  }
  const facts = {
    id: s.id,
    nRun: used.length,
    stoppedEarly: stopAt >= 0,
    everLong,
    maxY,
    firstN4,
    supplyMax: Math.max(0, ...(supplies as number[])),
    events: s.events,
  };
  if (used.length > 0 && used[used.length - 1].liv < LIV_EXT) return { ...facts, cls: "EXTINCT" };
  if (stoppedMono) return { ...facts, cls: "MONO" };
  if (used.length < WINDOW7) throw new ReadoutError(2, `${s.id}: ${used.length} run censuses, fewer than the final window of ${WINDOW7}`);
  const window = used.slice(used.length - WINDOW7);
  if (window.every((r) => r.Y >= 4)) return { ...facts, cls: "LONG" };
  if (window.every((r) => r.Y === 3)) return { ...facts, cls: "THREE" };
  if (window.every((r) => r.n >= 2)) return { ...facts, cls: "LOOSE" };
  return { ...facts, cls: "MONO" };
}

// ---- bug indicators common to every stage (8.4) ----

/**
 * The key under which jobs must share a `burnHash` (8.4): the same seed and the same burn-in config, since `stateHash` covers the
 * config. From summary.json's burn-phase config when it has one (a kill-form key is left out: the burn-in runs at `rpsRate` 0, so
 * the removal build and the vacancy build of one seed are one trajectory and one hash); otherwise from the job-own settings that sit
 * in it (substrate, spread, shape, K0, `rpsTypes`, `rpsFlip`, `rpsEdge`; not the kill form).
 */
export function burnGroupKey(s: JobSummary, substrateOf?: (s: JobSummary) => string | null): string {
  if (s.burnKey !== null) return s.burnKey;
  const d = s.dims ? `${s.dims.W}x${s.dims.H}x${s.dims.D}` : "?";
  const sub = s.rung === "V" ? (s.substrate ?? substrateOf?.(s) ?? "V") : (s.rung ?? "-");
  return `${sub}|spread=${s.spread}|${d}|K0=${s.K0}|types=${s.types}|flip=${s.flip}|edge=${s.edge}|seed=${s.seed}`;
}

/**
 * A conservation or invariant failure of an earlier attempt is a bug, not a result (1.3, 8.4: "a nonzero residual or a matter
 * change"), also when the rerun passed or the job ended as a MISSING marker: the simulator is deterministic, so a failure that does
 * not come back is itself a sign of trouble. A crash alone is not a bug indicator. Exit code 3 for each such failure.
 */
export function attemptBugs(jobs: readonly Job[], pr: Problems): void {
  for (const j of jobs) {
    const s = j.s;
    for (const f of s.attemptFailures) {
      if (f.kind !== "conservation" && f.kind !== "invariant") continue;
      pr.add(3, `${s.id}: attempt ${f.attempt ?? "?"} failed a ${f.kind} check${f.step === null ? "" : ` at step ${f.step}`}${f.message === "" ? "" : ` (${f.message})`}: a bug, not a result, whether or not the rerun passed (1.3, 8.4)`);
    }
  }
}

/**
 * What a job must have been run with, by the rules (`undefined`: not constrained). A recorded value that differs is unusable input; a
 * value the summary does not record is not checked here.
 */
export interface ExpectedSettings {
  K0?: number;
  types?: number;
  mutRate?: number;
  flip?: number;
  edge?: number;
}

/** Unusable input (exit 2) for a job whose recorded settings are not those the rules give for its stage (`where` names the stage in the message). */
export function checkSettings(s: JobSummary, want: ExpectedSettings, pr: Problems, where: string): void {
  const one = (name: string, got: number | null, w: number | undefined) => {
    if (w !== undefined && got !== null && got !== w) pr.add(2, `${s.id}: ${name} is ${got}, but ${where} runs with ${w}`);
  };
  one("K0", s.K0, want.K0);
  one("rpsTypes", s.types, want.types);
  one("mutRate", s.mutRate, want.mutRate);
  one("rpsFlip", s.flip, want.flip);
  one("rpsEdge", s.edge, want.edge);
}

/**
 * The generic bug indicators of 8.4: a nonzero residual or a matter change (in the job, or in an earlier attempt of it: `attemptBugs`);
 * jobs of one burn-in group whose `burnHash` differ; a control (`rpsRate` 0) with `|chi_fw|` above 0.3. Exit code 3 for each, 2 for a
 * job that does not report the residual.
 */
export function jobBugs(jobs: readonly Job[], analysis: (j: Job) => RunAnalysis | null, pr: Problems, opts: { substrateOf?: (s: JobSummary) => string | null; chiControls?: boolean } = {}): void {
  const groups = new Map<string, Map<string, string[]>>();
  attemptBugs(jobs, pr);
  for (const j of jobs) {
    const s = j.s;
    if (s.missing) continue;
    if (s.residual === null) pr.add(2, `${s.id}: summary.json has no residual`);
    else if (s.residual !== "0") pr.add(3, `${s.id}: nonzero energy residual ${s.residual} (bug indicator, 1.3)`);
    if (s.matterOk === false) pr.add(3, `${s.id}: matter changed (matterOk false; bug indicator, 1.3)`);
    if (s.burnHash !== null) {
      const key = burnGroupKey(s, opts.substrateOf);
      const g = groups.get(key) ?? new Map<string, string[]>();
      g.set(s.burnHash, [...(g.get(s.burnHash) ?? []), s.id]);
      groups.set(key, g);
    }
    if (opts.chiControls !== false && s.rate === 0 && j.rows !== null && s.stage !== "mutation" && (s.mutRate ?? 0) === 0) {
      const a = analysis(j);
      if (a && a.cls !== "NOSTART" && Math.abs(a.chiFw) > CHI_CONTROL_BUG) pr.add(3, `${s.id}: a control with |chi_fw| ${Math.abs(a.chiFw).toFixed(3)} above ${CHI_CONTROL_BUG} (bug indicator, 8.4)`);
    }
  }
  for (const [key, g] of groups) {
    if (g.size > 1) pr.add(3, `burnHash differs within one burn-in group (${key}): ${[...g].map(([h, ids]) => `${h.slice(0, 12)} (${ids.length} jobs, e.g. ${ids[0]})`).join(" vs ")} (bug indicator, 8.4)`);
  }
}

// ---- analysis cache ----

/** A memoising wrapper around `analyzeRun` that records `ReadoutError`s as problems and returns null for a job it cannot use. */
export function makeAnalyzer(pr: Problems): (job: Job, expectedRun: number | null) => RunAnalysis | null {
  const cache = new Map<Job, RunAnalysis | null>();
  return (job, expectedRun) => {
    if (cache.has(job)) return cache.get(job)!;
    const a = pr.guard(() => analyzeRun(job, { expectedRun }));
    cache.set(job, a);
    return a;
  };
}

/** Picks the one job satisfying `pred`; two or more are unusable input (the first is returned so the caller can go on). */
export function pickOne(jobs: readonly Job[], pr: Problems, desc: string, pred: (s: JobSummary) => boolean, prefer?: (s: JobSummary) => boolean): Job | undefined {
  let c = jobs.filter((j) => pred(j.s));
  if (c.length > 1 && prefer) {
    const p = c.filter((j) => prefer(j.s));
    if (p.length > 0) c = p;
  }
  if (c.length > 1) pr.add(2, `${c.length} jobs for ${desc}: ${c.map((j) => j.s.id).join(", ")}`);
  return c[0];
}
