// Statistics of the ecological-scaffolding sandbox (docs/scaffold-protocol-v1.md): P1 regime criteria,
// P2 positive control, R1 pond-level heredity (ICC(1) + permutation), R2 adaptation gain, R3 removal
// advantage, R4 table passthrough, the truncation sensitivity rule (assay rows and evolution histories), the
// in-run donor repeatability and the decision table, and the later R1 variants on census traits: tau and R1'
// (Amendment 2) and the replication's R1'' (docs/scaffold-heredity-replication-v1.md), the R3 replication's screening, availability
// and rule (docs/scaffold-r3-replication-v1.md), and the scaffolding registration's validity, tests and outcome row
// (docs/scaffold-registration-v1.md, `reg1Report*`). Everything except `readTsv` is pure (no Deno
// API), so vitest exercises it directly with synthetic data; tools/scaffold-report.ts is the CLI over it.
// Large tables (ponds.tsv, lineages.tsv) are streamed row by row, never loaded whole.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { holm, mannWhitney } from "@bl/metrics";
import {
  M_ASSAY,
  R1DP_HISTORY_SEED_BASE,
  R1DP_REGIME,
  R1DP_SETS,
  R1_PRIME_BOUNDARIES,
  R3REP_ANCESTOR_SEED,
  R3REP_CYCLES,
  R3REP_REGIME,
  R3REP_SWAP_AE_WORDS,
  TAU_SEED_BASE,
  censusSteps,
  checkAssaySeeds,
  checkDonorSeed,
  checkR1PrimeDonorSeed,
  checkR1PrimeSeeds,
  checkR1dPrimeDonorSeed,
  checkR1dPrimeSeeds,
  checkR3RepSeeds,
  checkTauSeeds,
  r1PrimeH,
  r1PrimeSeed,
  r1dPrimeIdOf,
  r1dPrimeLabelsOf,
  r1dPrimeSeed,
  r1dPrimeSourceProblems,
  r3RepExpectedSets,
  r3RepLabelsFromJson,
  r3RepProvenanceProblems,
  r3RepRegimeProblems,
  r3RepSetIdOf,
  r3RepTreatmentProblems,
  r3RepUnavailableProblems,
  r3RepVariantProblems,
  r3RepWorldSeedOf,
  reg1ContinuationPathOf,
  reg1ContinuationProblems,
  reg1ControlProblems,
  type AssayLabelSet,
  type AssayName,
  type R1PrimeLabelSet,
  type R1dPrimeLabelSet,
  type R1dPrimeProvenance,
  type R3RepCheckpoint,
  type R3RepDominant,
  type R3RepInoculum,
  type R3RepLabelSet,
} from "./pond-assay.ts";
import { assaySeed, randomKey, weightedPick } from "./ponds.ts";

// ---------------------------------------------------------------------------------------------
// Streaming TSV

/** One TSV row keyed by the header line. */
export type TsvRow = Record<string, string>;

/** Header-keyed rows from an async or sync sequence of lines. Blank lines are skipped; a short row throws. */
export async function* tsvRows(lines: AsyncIterable<string> | Iterable<string>): AsyncGenerator<TsvRow> {
  let header: string[] | null = null;
  let n = 0;
  for await (const raw of lines) {
    n++;
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") continue;
    const cells = line.split("\t");
    if (!header) {
      header = cells;
      continue;
    }
    if (cells.length < header.length) throw new Error(`tsv line ${n}: ${cells.length} fields, header has ${header.length}`);
    const row: TsvRow = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i];
    yield row;
  }
}

/** Streams a TSV file (node:fs works under Deno and vitest alike). */
export function readTsv(path: string): AsyncGenerator<TsvRow> {
  return tsvRows(createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity }));
}

const num = (r: TsvRow, key: string): number => {
  const v = r[key];
  if (v === undefined) throw new Error(`tsv row has no column "${key}"`);
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Error(`tsv column "${key}" is not a number: ${v}`);
  return x;
};

// ---------------------------------------------------------------------------------------------
// Small numerics

/** Median; the mean of the two middle values for an even count. NaN for an empty input. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Population coefficient of variation sqrt(mean((x - m)^2)) / m; 0 when the mean is 0. */
export function populationCv(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  if (m === 0) return 0;
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m)))) / m;
}

export interface Dist {
  n: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
}

/** Descriptive summary for the "reported" distributions; every field null when empty. */
export function dist(xs: readonly number[]): Dist {
  if (xs.length === 0) return { n: 0, mean: null, median: null, min: null, max: null };
  return { n: xs.length, mean: mean(xs), median: median(xs), min: Math.min(...xs), max: Math.max(...xs) };
}

// ---------------------------------------------------------------------------------------------
// Truncation rule

/** A history with more than 1% truncated recipient rows is flagged (protocol, "Truncation"). */
export const TRUNCATION_LIMIT = 0.01;

export interface TruncationStat {
  truncated: number;
  rows: number;
  fraction: number;
  flagged: boolean;
}

/** `truncated` of `rows` recipient rows; flagged when more than 1% (exact integer comparison). */
export function truncationOf(truncated: number, rows: number): TruncationStat {
  return { truncated, rows, fraction: rows > 0 ? truncated / rows : 0, flagged: truncated * 100 > rows };
}

// ---------------------------------------------------------------------------------------------
// P1: regime

export const P1_PRIMARY_K = [3, 5, 8] as const;
export const P1_FALLBACK_K = [12, 16] as const;
export const P1_PERIODS = [1000, 3000, 10000] as const;
/** P1 seeds are 4,800,001 + 100 g + s; s is the seed's replicate within its regime. */
export const P1_SEED_BASE = 4_800_001;

/**
 * Streaming check of ponds.tsv's recipient identity. At every cycle the rows name each recipient 0..n-1 exactly once (every
 * arm writes one row per pond), so a duplicated recipient hides a missing pond behind the right row count, and the per-cycle
 * counts, sums and maps below would aggregate it without error. `add` throws on a repeat as it arrives, `finish` on a gap;
 * only one small set per cycle is held.
 *
 * Limit: without `expect` this checks identity within each cycle, not completeness. It does not know the configured pond count
 * (meta.side squared) or how many cycles the run recorded (done.cycles), so a cycle cut short at its end (recipients 0..62 of 64)
 * or an absent cycle passes. That is acceptable while ponds.tsv feeds only descriptive readouts, written by one tool and read once
 * the run is finished. A report stage whose decision rests on ponds.tsv passes those two numbers in as `expect`, and `finish` then
 * also requires exactly the cycles 1..`cycles` with `ponds` rows each: on all 79 recorded histories every cycle has exactly side^2
 * rows and the last cycle equals done.cycles.
 */
export class RecipientGuard {
  private seen = new Map<number, Set<number>>();

  constructor(private readonly expect?: { ponds: number; cycles: number }) {}

  /** One row by its raw cells: a blank or non-digit recipient is refused (`Number("")` is 0, which would read as pond 0). */
  addRow(r: TsvRow): void {
    const cell = r["recipient"];
    if (cell === undefined || !/^\d+$/.test(cell)) throw new Error(`ponds.tsv: recipient ${JSON.stringify(cell)} is not a pond index`);
    this.add(num(r, "cycle"), Number(cell));
  }

  add(cycle: number, recipient: number): void {
    if (!Number.isInteger(recipient) || recipient < 0) throw new Error(`ponds.tsv: recipient ${recipient} at cycle ${cycle} is not a pond index`);
    let at = this.seen.get(cycle);
    if (!at) this.seen.set(cycle, (at = new Set()));
    if (at.has(recipient)) throw new Error(`ponds.tsv has two rows for cycle ${cycle}, recipient ${recipient}`);
    at.add(recipient);
  }

  /** After the last row: every cycle's recipients are exactly 0..n-1 and, with `expect`, the cycles are exactly 1..cycles with `ponds` rows each. */
  finish(): void {
    for (const [cycle, at] of this.seen)
      for (let i = 0; i < at.size; i++) if (!at.has(i)) throw new Error(`ponds.tsv cycle ${cycle} has ${at.size} rows but none for recipient ${i}`);
    if (!this.expect) return;
    const { ponds, cycles } = this.expect;
    for (let b = 1; b <= cycles; b++) {
      const n = this.seen.get(b)?.size ?? 0;
      if (n !== ponds) throw new Error(`ponds.tsv cycle ${b} has ${n} rows, want ${ponds} (one per pond)`);
    }
    const extra = [...this.seen.keys()].filter((b) => !(Number.isInteger(b) && b >= 1 && b <= cycles));
    if (extra.length > 0) throw new Error(`ponds.tsv has cycle ${extra[0]}, want only cycles 1..${cycles}`);
  }
}

/** The columns of ponds.tsv that P1 reads. */
export interface P1Row {
  cycle: number;
  recipient: number;
  retMass: number;
  recipientTrait: number;
  /** 1 if the packet was truncated against M_r, else 0. */
  truncated: number;
}

export function p1Row(r: TsvRow): P1Row {
  return { cycle: num(r, "cycle"), recipient: num(r, "recipient"), retMass: num(r, "retMass"), recipientTrait: num(r, "recipientTrait"), truncated: num(r, "truncated") };
}

/** One P1 history: its regime, pond count, scheduled cycles, exactness flag and ponds.tsv rows. */
export interface P1Run {
  k: number;
  period: number;
  seed: number;
  ponds: number;
  cycles: number;
  conservationOk: boolean;
  rows: P1Row[];
}

/** A run's done.json (tools/scaffold.ts), as far as the report reads it. */
export interface DoneJson {
  ok?: boolean;
  conservationOk?: boolean;
  cycles?: number;
  ended?: boolean;
  endedAt?: number;
  error?: string;
}

/**
 * Whether a run's data can be read: "finished" (done.json says conservation held and it ran every scheduled
 * cycle or its history ended), "violated" (done.json records a real matter or ledger violation, which is a
 * result whatever the cycle count), or "unfinished" (no done.json, i.e. still running or crashed before a
 * resume, or stopped short without a violation). An unfinished run is not present: it counts neither as a
 * failure nor as data.
 */
export type RunStatus = "finished" | "violated" | "unfinished";

export function runStatus(done: DoneJson | null | undefined, scheduledCycles: number): RunStatus {
  if (!done) return "unfinished";
  if (done.conservationOk === false) return "violated";
  if (done.conservationOk !== true) return "unfinished";
  return done.ended === true || (typeof done.cycles === "number" && done.cycles >= scheduledCycles) ? "finished" : "unfinished";
}

/** A P1 history from its meta.json, done.json and ponds.tsv rows; null while the run is unfinished. */
export function p1RunOf(meta: { k: number; period: number; seed: number; side: number; cycles: number }, done: DoneJson | null, rows: P1Row[]): P1Run | null {
  const status = runStatus(done, meta.cycles);
  if (status === "unfinished") return null;
  const guard = new RecipientGuard();
  for (const r of rows) guard.add(r.cycle, r.recipient);
  guard.finish();
  return { k: meta.k, period: meta.period, seed: meta.seed, ponds: meta.side * meta.side, cycles: meta.cycles, conservationOk: status === "finished", rows };
}

/** The truncated share of a run's recipient rows. */
export const p1Truncation = (run: P1Run): TruncationStat => truncationOf(run.rows.filter((r) => r.truncated > 0).length, run.rows.length);

/** The pre-cycle trait of every pond at boundary 1 (cycle-1 rows carry every pond as a recipient). */
export function boundaryOneTraits(run: P1Run): number[] {
  return run.rows.filter((r) => r.cycle === 1).map((r) => r.recipientTrait);
}

/**
 * ref(period): the median boundary-1 trait pooled over every pond of every run with that period, whatever its
 * k and seed. Boundary 1 is the ancestor growing from its standard disc before any cycle, so k does not enter.
 */
export function p1Ref(runs: readonly P1Run[]): Map<number, number> {
  const pooled = new Map<number, number[]>();
  for (const run of runs) {
    const xs = pooled.get(run.period) ?? [];
    for (const x of boundaryOneTraits(run)) xs.push(x);
    pooled.set(run.period, xs);
  }
  return new Map([...pooled].map(([period, xs]) => [period, median(xs)]));
}

export interface P1SeedResult {
  seed: number;
  /** Replicate within the regime, (seed - 4,800,001) mod 100. */
  s: number;
  scheduled: number;
  successes: number;
  successFraction: number;
  meanIneligible: number;
  meanCv: number;
  conservationOk: boolean;
  criteria: { a: boolean; b: boolean; c: boolean; d: boolean };
  pass: boolean;
}

/**
 * The regime criteria for one seed. Recipients are those of cycles 1..C-1 (P ponds each, `scheduled` in all);
 * a recipient of cycle b succeeds iff its pond's trait at boundary b+1 is at least 0.25 ref and at least
 * 4x its retained landed B+P. A recipient with no recorded boundary b+1 (the history ended, or the run is
 * incomplete) is a failure. Boundaries 2..C give the ineligible fraction (trait 0) and the population CV of
 * the trait across ponds; a missing boundary counts as fully ineligible with CV 0, a missing pond as trait 0.
 * With ref = 0 the period fails outright.
 */
export function p1Seed(run: P1Run, ref: number): P1SeedResult {
  const R = run.ponds;
  const C = run.cycles;
  const byCycle = new Map<number, Map<number, P1Row>>();
  for (const row of run.rows) {
    let m = byCycle.get(row.cycle);
    if (!m) byCycle.set(row.cycle, (m = new Map()));
    m.set(row.recipient, row);
  }
  let successes = 0;
  const scheduled = (C - 1) * R;
  if (ref > 0) {
    for (let b = 1; b < C; b++) {
      for (let r = 0; r < R; r++) {
        const cur = byCycle.get(b)?.get(r);
        const next = byCycle.get(b + 1)?.get(r);
        if (!cur || !next) continue;
        if (4 * next.recipientTrait >= ref && next.recipientTrait >= 4 * cur.retMass) successes++;
      }
    }
  }
  const inelig: number[] = [];
  const cvs: number[] = [];
  for (let b = 2; b <= C; b++) {
    const rows = byCycle.get(b);
    if (!rows) {
      inelig.push(1);
      cvs.push(0);
      continue;
    }
    const traits: number[] = [];
    for (let r = 0; r < R; r++) traits.push(rows.get(r)?.recipientTrait ?? 0);
    inelig.push(traits.filter((x) => x === 0).length / R);
    cvs.push(populationCv(traits));
  }
  const successFraction = scheduled > 0 ? successes / scheduled : 0;
  const meanIneligible = mean(inelig);
  const meanCv = mean(cvs);
  const criteria = {
    a: ref > 0 && successFraction >= 0.3 && successFraction <= 0.9,
    b: ref > 0 && meanIneligible <= 0.5,
    c: ref > 0 && meanCv >= 0.1,
    d: run.conservationOk,
  };
  return {
    seed: run.seed,
    s: (((run.seed - P1_SEED_BASE) % 100) + 100) % 100,
    scheduled,
    successes,
    successFraction,
    meanIneligible,
    meanCv,
    conservationOk: run.conservationOk,
    criteria,
    pass: criteria.a && criteria.b && criteria.c && criteria.d,
  };
}

export interface P1Regime {
  k: number;
  period: number;
  ref: number;
  seeds: P1SeedResult[];
  /** At least `minSeeds` seeds were supplied. A regime passes only when complete and every seed passes. */
  complete: boolean;
  pass: boolean;
}

/** Every (k, period) regime present in `runs`, sorted by k then period, each seed judged separately. */
export function p1Regimes(runs: readonly P1Run[], minSeeds = 2): { refs: Map<number, number>; regimes: P1Regime[] } {
  const refs = p1Ref(runs);
  const groups = new Map<string, P1Run[]>();
  for (const run of runs) {
    const key = `${run.k}:${run.period}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const regimes: P1Regime[] = [...groups.values()].map((rs) => {
    const ref = refs.get(rs[0].period)!;
    const seeds = rs.map((r) => p1Seed(r, ref)).sort((a, b) => a.seed - b.seed);
    const complete = new Set(seeds.map((x) => x.seed)).size >= minSeeds;
    return { k: rs[0].k, period: rs[0].period, ref, seeds, complete, pass: complete && seeds.every((x) => x.pass) };
  });
  regimes.sort((a, b) => a.k - b.k || a.period - b.period);
  return { refs, regimes };
}

export interface P1Choice {
  /** Which grid produced the candidate: the primary k in {3,5,8} first, the fallback k in {12,16} only if none passed. */
  stage: "primary" | "fallback" | null;
  /** The chosen regime, set only once the verdict is true. */
  chosen: { k: number; period: number } | null;
  /** The regime that would be chosen on the data so far; smaller regimes that have not run could still displace it. */
  candidate: { k: number; period: number } | null;
  /** Every (k, period) of the primary grid is present with at least the required seeds. */
  primaryComplete: boolean;
  /** Likewise for the fallback grid (k in {12, 16}). */
  fallbackComplete: boolean;
  /** true: a regime was chosen; false: primary and fallback both ran and none passed; null: not yet decidable. */
  verdict: boolean | null;
  /** Passing regimes in choice order (smallest k, then shortest period), both grids. */
  passing: { k: number; period: number }[];
}

/**
 * The smallest passing k, then the shortest passing period; the fallback grid (k in {12, 16}) is consulted
 * only when no primary regime passes. A choice needs every regime before it to have run, and ref(period)
 * pools every run of the period, so `verdict` is true only once the whole primary grid is complete (and, for a
 * fallback choice, the fallback grid too); false only once both grids are complete and empty of passes; null
 * otherwise.
 */
export function p1Choose(regimes: readonly P1Regime[]): P1Choice {
  const inGrid = (ks: readonly number[]) => regimes.filter((r) => ks.includes(r.k));
  const passing = (rs: readonly P1Regime[]) =>
    rs.filter((r) => r.pass).sort((a, b) => a.k - b.k || a.period - b.period).map((r) => ({ k: r.k, period: r.period }));
  const complete = (ks: readonly number[]) => ks.every((k) => P1_PERIODS.every((p) => regimes.some((r) => r.k === k && r.period === p && r.complete)));
  const primary = passing(inGrid(P1_PRIMARY_K));
  const fallback = passing(inGrid(P1_FALLBACK_K));
  const primaryComplete = complete(P1_PRIMARY_K);
  const fallbackComplete = complete(P1_FALLBACK_K);
  const all = [...primary, ...fallback];
  const base = { primaryComplete, fallbackComplete, passing: all };
  if (primary.length) {
    const ok = primaryComplete;
    return { ...base, stage: "primary", chosen: ok ? primary[0] : null, candidate: primary[0], verdict: ok ? true : null };
  }
  if (fallback.length) {
    const ok = primaryComplete && fallbackComplete;
    return { ...base, stage: "fallback", chosen: ok ? fallback[0] : null, candidate: fallback[0], verdict: ok ? true : null };
  }
  return { ...base, stage: null, chosen: null, candidate: null, verdict: primaryComplete && fallbackComplete ? false : null };
}

export interface P1Sensitivity {
  /** Histories (runs) with more than 1% truncated recipient rows. */
  flagged: (TruncationStat & { k: number; period: number; seed: number })[];
  /** The choice with every history, and with the flagged histories left out (null when nothing is flagged). */
  full: P1Choice;
  without: P1Choice | null;
  /** Leaving the flagged histories out changes the verdict or the chosen regime. */
  sensitive: boolean;
}

/**
 * The truncation rule for P1: decisions use every history; the choice is repeated without the flagged ones
 * (each judged on its own ref pooled over the rest) and reported beside them. A regime keeps the completeness
 * it has with every history, so dropping a flagged seed does not make it "incomplete"; a regime left with no
 * seed cannot pass.
 */
export function p1Sensitivity(runs: readonly P1Run[], minSeeds = 2): P1Sensitivity {
  const { regimes: fullRegimes } = p1Regimes(runs, minSeeds);
  const full = p1Choose(fullRegimes);
  const flagged = runs.map((run) => ({ run, t: p1Truncation(run) })).filter((x) => x.t.flagged);
  const list = flagged.map(({ run, t }) => ({ ...t, k: run.k, period: run.period, seed: run.seed }));
  if (flagged.length === 0) return { flagged: list, full, without: null, sensitive: false };
  const kept = p1Regimes(runs.filter((run) => !p1Truncation(run).flagged), 1).regimes;
  const regimes = fullRegimes.map((f): P1Regime => {
    const k = kept.find((r) => r.k === f.k && r.period === f.period);
    return k ? { ...k, complete: f.complete, pass: f.complete && k.seeds.every((x) => x.pass) } : { ...f, seeds: [], pass: false };
  });
  const without = p1Choose(regimes);
  const same = (x: { k: number; period: number } | null, y: { k: number; period: number } | null) => x?.k === y?.k && x?.period === y?.period;
  return { flagged: list, full, without, sensitive: without.verdict !== full.verdict || !same(without.chosen, full.chosen) };
}

/** P1's R3 calibration: ancestor competence within [0.2, 0.9] and the quenched control at most 0.05. */
export const CALIBRATION_ANCESTOR = { min: 0.2, max: 0.9 } as const;
export const CALIBRATION_QUENCH_LIMIT = 0.05;

export interface CalibrationRegime {
  k: number;
  period: number;
  /** Competence of the ancestor source (calibration 1) and of the quenched control (calibration 2); null if not run. */
  ancestor: number | null;
  quenched: number | null;
  /**
   * The quenched control shares the ancestor's fragments: every (replicate, pond) row has the same requested and
   * retained B+P in both sets (common random numbers). null while either set is missing; false for a control that
   * was drawn separately, which is not a decision input.
   */
  paired: boolean | null;
  /** null while either competence is missing or the two sets are not paired. */
  pass: boolean | null;
}

/**
 * P1's calibration walk. `choice.passing` is tried in order (smallest k, then shortest period); the first
 * regime whose ancestor competence lies in [0.2, 0.9] and whose quenched control is at most 0.05 is the
 * regime, otherwise the next-smallest passing regime is tried. A regime whose calibration has not run, or a
 * fallback regime before the fallback grid is complete, leaves the verdict open; a verdict of false needs every
 * passing regime to have failed calibration with both grids complete. Sets carry `labels.calibration`
 * (1 = ancestor competence, 2 = quenched) and `labels.k`, `labels.period`, and are paired by that regime: the two
 * calibrations of a regime must hold the same fragments (`paired`), else the regime is not decided.
 */
export function p1Calibrate(choice: P1Choice, sets: readonly AssaySet[]): { verdict: boolean | null; chosen: { k: number; period: number } | null; regimes: CalibrationRegime[] } {
  const regimes: CalibrationRegime[] = [];
  const rowsOf = (k: number, period: number, cal: 1 | 2) =>
    sets
      .filter((s) => s.labels.calibration === cal && s.labels.k === k && s.labels.period === period)
      .flatMap((s) => s.rows.filter((r) => r.inoculum === (cal === 1 ? "fragment" : "quenched")).map((r) => ({ r, ref: s.labels.ref })));
  const value = (k: number, period: number, cal: 1 | 2): number | null => {
    const rows = rowsOf(k, period, cal);
    return rows.length ? rows.filter(({ r, ref }) => rowSuccess(r, ref)).length / rows.length : null;
  };
  const pairedAt = (k: number, period: number): boolean | null => {
    const anc = rowsOf(k, period, 1);
    const que = rowsOf(k, period, 2);
    if (!anc.length || !que.length) return null;
    const at = new Map(anc.map(({ r }) => [`${r.replicate}:${r.pond}`, r]));
    return anc.length === que.length && que.every(({ r }) => {
      const m = at.get(`${r.replicate}:${r.pond}`);
      return m !== undefined && m.reqMass === r.reqMass && m.retMass === r.retMass;
    });
  };
  if (choice.verdict === false) return { verdict: false, chosen: null, regimes };
  if (choice.verdict === null) return { verdict: null, chosen: null, regimes };
  for (const { k, period } of choice.passing) {
    if ((P1_FALLBACK_K as readonly number[]).includes(k) && !choice.fallbackComplete) break;
    const ancestor = value(k, period, 1);
    const quenched = value(k, period, 2);
    const paired = pairedAt(k, period);
    const pass = ancestor === null || quenched === null || paired !== true ? null : ancestor >= CALIBRATION_ANCESTOR.min && ancestor <= CALIBRATION_ANCESTOR.max && quenched <= CALIBRATION_QUENCH_LIMIT;
    regimes.push({ k, period, ancestor, quenched, paired, pass });
    if (pass === null) return { verdict: null, chosen: null, regimes };
    if (pass) return { verdict: true, chosen: { k, period }, regimes };
  }
  return { verdict: choice.primaryComplete && choice.fallbackComplete ? false : null, chosen: null, regimes };
}

// ---------------------------------------------------------------------------------------------
// P2: positive control

/** Selection-run seeds are 4,805,101 + 10 arm + s (arm 0 scaf, 1 rand). */
export const P2_SEED_BASE = 4_805_101;
export const P2_FOUNDERS = 12;
export const P2_HIGH = 6;
/** Both seeds (s = 0, 1) must pass, and the ranking assay runs on both. */
export const P2_SEEDS = [0, 1] as const;
export const P2_RANK_SEEDS = 2;
/** Ranking-assay seeds are 4,805,001 + s. */
export const P2_RANK_SEED_BASE = 4_805_001;
/** Selection runs have 20 cycles; every P2 run is 64 ponds (side 8) planted with the 12 founders round-robin. */
export const P2_CYCLES = 20;
export const P2_SIDE = 8;

/** The run directories P2 reads: the ranking assay (arm cont) and the scaf and rand selection runs. */
export type P2Role = "rank" | "scaf" | "rand";

const p2SeedBase = (role: P2Role): number => (role === "rank" ? P2_RANK_SEED_BASE : P2_SEED_BASE + (role === "scaf" ? 0 : 10));

/** The s of a P2 run's seed (ranking 4,805,001 + s; selection 4,805,101 + 10 arm + s, s = 0 or 1), or null when it is not one. */
export function p2Replicate(seed: unknown, role: P2Role): number | null {
  const s = typeof seed === "number" ? seed - p2SeedBase(role) : NaN;
  return (P2_SEEDS as readonly number[]).includes(s) ? s : null;
}

/**
 * Why a run directory (its meta.json) is not the protocol's P2 run of `role` at the frozen `regime`; empty when it
 * is. Ranking: arm cont, founders, mutation off, side 8, 1 cycle, one period of the regime, seed 4,805,001 + s.
 * Selection: arm scaf or rand, founders, mutation off, side 8, the regime's k and period, 20 cycles, seed
 * 4,805,101 + 10 arm + s. All of them carry the round-robin planting map, whose lineage ids
 * (0, t + 1) give each founder's mass. P2 never pools a run with reasons.
 */
export function p2RunProblems(meta: Record<string, unknown>, role: P2Role, regime: AssayRegime): string[] {
  const why: string[] = [];
  const check = (key: string, want: unknown) => {
    if (meta[key] !== want) why.push(`${key} ${JSON.stringify(meta[key])}, want ${JSON.stringify(want)}`);
  };
  check("arm", role === "rank" ? "cont" : role);
  check("init", "founders");
  check("mutRate", 0);
  check("side", P2_SIDE);
  check("cycles", role === "rank" ? 1 : P2_CYCLES);
  check("period", regime.period);
  if (role !== "rank") check("k", regime.k);
  if (p2Replicate(meta.seed, role) === null) why.push(`seed ${JSON.stringify(meta.seed)}, want ${p2SeedBase(role)} + s for s = 0 or 1`);
  const map = meta.plantingToFounder;
  if (!Array.isArray(map) || map.length !== P2_SIDE * P2_SIDE || map.some((f, t) => f !== t % P2_FOUNDERS)) why.push(`plantingToFounder is not the round-robin map of ${P2_FOUNDERS} founders over ${P2_SIDE * P2_SIDE} ponds`);
  return why;
}

export interface FounderScore {
  founder: number;
  n: number;
  sum: number;
  /** sum / n, or null when the founder has no pond. */
  mean: number | null;
}

/**
 * The ranking assay's founder scores and high set. `observations` are (founder, boundary-1 pond trait) over
 * every pond of every ranking seed; a founder's score is the pooled mean. The high set is the `nHigh` best,
 * ties to the smaller founder index; means are compared as exact fractions sum/n. Founders without a pond
 * rank last. `rankSeeds`, when given, is the number of ranking seeds behind the observations; the protocol's
 * score pools both, so fewer than 2 is refused.
 */
export function founderRank(
  observations: readonly { founder: number; trait: number }[],
  nFounders = P2_FOUNDERS,
  nHigh = P2_HIGH,
  rankSeeds?: number,
): { scores: FounderScore[]; high: number[] } {
  if (rankSeeds !== undefined && rankSeeds < P2_RANK_SEEDS) throw new Error(`founderRank: the ranking assay needs ${P2_RANK_SEEDS} seeds, got ${rankSeeds}`);
  const scores: FounderScore[] = Array.from({ length: nFounders }, (_, founder) => ({ founder, n: 0, sum: 0, mean: null }));
  for (const o of observations) {
    if (o.founder < 0 || o.founder >= nFounders) throw new Error(`founderRank: founder ${o.founder} out of range`);
    scores[o.founder].n++;
    scores[o.founder].sum += o.trait;
  }
  for (const s of scores) s.mean = s.n > 0 ? s.sum / s.n : null;
  const order = [...scores].sort((a, b) => {
    if (a.n === 0 || b.n === 0) return a.n === 0 && b.n === 0 ? a.founder - b.founder : a.n === 0 ? 1 : -1;
    const d = b.sum * a.n - a.sum * b.n; // b.mean - a.mean, scaled by a.n b.n
    return d !== 0 ? (d > 0 ? 1 : -1) : a.founder - b.founder;
  });
  return { scores, high: order.slice(0, nHigh).map((s) => s.founder).sort((a, b) => a - b) };
}

/**
 * The founder a lineage id belongs to. `buildWorld` gives planting index t the id (0, t + 1) (no ring
 * namespace), and `plantingToFounder` maps planting index to founder. -1 for anything else.
 */
export function lineageFounder(hi: number, lo: number, plantingToFounder: readonly number[]): number {
  if (hi !== 0 || lo < 1 || lo > plantingToFounder.length) return -1;
  return plantingToFounder[lo - 1];
}

export interface ShareCount {
  /** Trait mass of high-set founders, and of the whole world (lineages.tsv rows), at the boundary. */
  high: number;
  total: number;
}

/**
 * Streams lineages.tsv (columns boundary step pond hi lo mass) and totals, at each requested boundary, the
 * trait mass belonging to high-set founders and the whole. Rows at other boundaries are ignored.
 */
export async function highShareCounts(
  rows: AsyncIterable<TsvRow>,
  high: ReadonlySet<number>,
  plantingToFounder: readonly number[],
  boundaries: readonly number[],
): Promise<Map<number, ShareCount>> {
  const out = new Map<number, ShareCount>(boundaries.map((b) => [b, { high: 0, total: 0 }]));
  for await (const r of rows) {
    const c = out.get(num(r, "boundary"));
    if (!c) continue;
    const mass = num(r, "mass");
    c.total += mass;
    if (high.has(lineageFounder(num(r, "hi"), num(r, "lo"), plantingToFounder))) c.high += mass;
  }
  return out;
}

/** High share = high / total; 0 when the world holds no trait mass (an extinct pond world has no high-set mass). */
export const highShare = (c: ShareCount): number => (c.total > 0 ? c.high / c.total : 0);

/**
 * What P2 needs from one selection run: the integer trait masses (`ShareCount`) of high-set founders and of the
 * whole world at boundary 1 and at the last boundary, so shares and their difference compare exactly, and
 * `traitSum`, the sum of pond traits at the last boundary over `ponds` ponds.
 */
export interface P2Arm {
  high1: number;
  total1: number;
  highEnd: number;
  totalEnd: number;
  traitSum: number;
  ponds: number;
}

/**
 * delta = high share at the last boundary - high share at boundary 1, as the exact fraction n / d (d > 0) of
 * the integer masses; a world without trait mass has share 0.
 */
export function shareDelta(a: P2Arm): { n: bigint; d: bigint } {
  for (const x of [a.high1, a.total1, a.highEnd, a.totalEnd]) if (!Number.isSafeInteger(x) || x < 0) throw new Error(`P2 masses must be non-negative integers, got ${x}`);
  const share = (high: number, total: number) => (total > 0 ? { n: BigInt(high), d: BigInt(total) } : { n: 0n, d: 1n });
  const end = share(a.highEnd, a.totalEnd);
  const start = share(a.high1, a.total1);
  return { n: end.n * start.d - start.n * end.d, d: end.d * start.d };
}

export interface P2SeedResult {
  s: number;
  /** Both arms of this seed were supplied; a missing seed is pending, not failed. */
  present: boolean;
  deltaScaf: number;
  deltaRand: number;
  /** The deltas as exact fractions "n/d" (the criteria compare these, not the floats); null while the seed is missing. */
  deltaScafExact: string | null;
  deltaRandExact: string | null;
  meanTraitScaf: number;
  meanTraitRand: number;
  criteria: { deltaAtLeast: boolean; deltaBeatsRand: boolean; traitHigher: boolean };
  pass: boolean;
}

/**
 * P2 passes if, in both seeds, scaf's delta (high share at the last boundary minus at boundary 1) is at
 * least 0.10 and exceeds rand's delta for the same s, and scaf's mean trait at the last boundary is higher
 * than rand's. The two delta comparisons are exact (bigint cross-multiplication of the integer masses), so a delta
 * of exactly 0.10 passes whatever float rounding says. Every seed in `expected` (s = 0, 1) is judged; one missing an arm is pending, never dropped:
 * `pass` needs all of them present and passing, `verdict` is false as soon as a present seed fails, true once
 * every expected seed passes, and null while a seed is missing and none has failed. Seeds outside `expected`
 * are ignored.
 */
export function p2Evaluate(
  perSeed: readonly { s: number; scaf: P2Arm | null; rand: P2Arm | null }[],
  expected: readonly number[] = P2_SEEDS,
): { seeds: P2SeedResult[]; pass: boolean; verdict: boolean | null } {
  const seeds = expected.map((s): P2SeedResult => {
    const { scaf, rand } = perSeed.find((x) => x.s === s) ?? { scaf: null, rand: null };
    if (!scaf || !rand) {
      return {
        s,
        present: false,
        deltaScaf: NaN,
        deltaRand: NaN,
        deltaScafExact: null,
        deltaRandExact: null,
        meanTraitScaf: NaN,
        meanTraitRand: NaN,
        criteria: { deltaAtLeast: false, deltaBeatsRand: false, traitHigher: false },
        pass: false,
      };
    }
    const dS = shareDelta(scaf);
    const dR = shareDelta(rand);
    const criteria = {
      deltaAtLeast: 10n * dS.n >= dS.d,
      deltaBeatsRand: dS.n * dR.d > dR.n * dS.d,
      // Same pond count on both sides, so the sums compare exactly.
      traitHigher: scaf.traitSum * rand.ponds > rand.traitSum * scaf.ponds,
    };
    return {
      s,
      present: true,
      deltaScaf: Number(dS.n) / Number(dS.d),
      deltaRand: Number(dR.n) / Number(dR.d),
      deltaScafExact: `${dS.n}/${dS.d}`,
      deltaRandExact: `${dR.n}/${dR.d}`,
      meanTraitScaf: scaf.traitSum / scaf.ponds,
      meanTraitRand: rand.traitSum / rand.ponds,
      criteria,
      pass: criteria.deltaAtLeast && criteria.deltaBeatsRand && criteria.traitHigher,
    };
  });
  const pass = seeds.length > 0 && seeds.every((x) => x.pass);
  const verdict = seeds.some((x) => x.present && !x.pass) ? false : pass ? true : null;
  return { seeds, pass, verdict };
}

export interface P2Sensitivity {
  /** Seeds with a selection run of more than 1% truncated recipient rows, in either arm. */
  flagged: number[];
  verdict: boolean | null;
  /** The verdict over the remaining seeds only (null when none remain or one is missing). */
  without: boolean | null;
  sensitive: boolean;
}

/** The truncation rule for P2: the verdict repeated over the seeds no flagged run belongs to. */
export function p2Sensitivity(
  perSeed: readonly { s: number; scaf: P2Arm | null; rand: P2Arm | null }[],
  flagged: readonly number[],
  expected: readonly number[] = P2_SEEDS,
): P2Sensitivity {
  const verdict = p2Evaluate(perSeed, expected).verdict;
  const flaggedSeeds = expected.filter((s) => flagged.includes(s));
  if (flaggedSeeds.length === 0) return { flagged: [], verdict, without: verdict, sensitive: false };
  const kept = expected.filter((s) => !flagged.includes(s));
  const without = kept.length === 0 ? null : p2Evaluate(perSeed, kept).verdict;
  return { flagged: [...flaggedSeeds], verdict, without, sensitive: without !== verdict };
}

// ---------------------------------------------------------------------------------------------
// ICC(1), OLS residuals, permutation

/** The one-way ANOVA of `y` by family: `a` families, `N` values, the family means (by first appearance) and the mean squares. */
export interface OneWayAnova {
  a: number;
  N: number;
  means: number[];
  msb: number;
  msw: number;
  n0: number;
}

/**
 * One-way ANOVA with unequal family sizes: MSB, MSW and n0 = (N - sum n_i^2 / N) / (a - 1). Families are relabelled
 * by first appearance, so any two label vectors that induce the same partition give bit-identical results. null with
 * fewer than 2 families or no within-family degrees of freedom.
 */
export function oneWayAnova(y: readonly number[], labels: readonly number[]): OneWayAnova | null {
  const N = y.length;
  if (labels.length !== N) throw new Error("icc1: y and labels differ in length");
  const idOf = new Map<number, number>();
  const size: number[] = [];
  const sum: number[] = [];
  const gid = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    let g = idOf.get(labels[i]);
    if (g === undefined) {
      g = size.length;
      idOf.set(labels[i], g);
      size.push(0);
      sum.push(0);
    }
    gid[i] = g;
    size[g]++;
    sum[g] += y[i];
  }
  const a = size.length;
  if (a < 2 || N <= a) return null;
  let grand = 0;
  for (let i = 0; i < N; i++) grand += y[i];
  grand /= N;
  const gm = sum.map((s, g) => s / size[g]);
  let ssb = 0;
  for (let g = 0; g < a; g++) ssb += size[g] * (gm[g] - grand) * (gm[g] - grand);
  let ssw = 0;
  for (let i = 0; i < N; i++) ssw += (y[i] - gm[gid[i]]) * (y[i] - gm[gid[i]]);
  let sq = 0;
  for (let g = 0; g < a; g++) sq += size[g] * size[g];
  const msb = ssb / (a - 1);
  const msw = ssw / (N - a);
  const n0 = (N - sq / N) / (a - 1);
  return { a, N, means: gm, msb, msw, n0 };
}

/**
 * One-way random-effects ICC(1) with unequal family sizes: (MSB - MSW) / (MSB + (n0 - 1) MSW), the mean squares
 * from `oneWayAnova`. null with fewer than 2 families or no within-family degrees of freedom; 0 when the values
 * are all equal.
 */
export function icc1(y: readonly number[], labels: readonly number[]): number | null {
  const an = oneWayAnova(y, labels);
  if (an === null) return null;
  const denom = an.msb + (an.n0 - 1) * an.msw;
  return denom === 0 ? 0 : (an.msb - an.msw) / denom;
}

/**
 * Residuals of an OLS fit of `y` on an intercept and the columns `xs`, by modified Gram-Schmidt on the
 * columns; a column that is (numerically) in the span of the earlier ones is dropped, so constant or
 * collinear covariates give the fit on what remains rather than a singular system.
 */
export function olsResiduals(y: readonly number[], xs: readonly (readonly number[])[]): number[] {
  const n = y.length;
  const dot = (u: readonly number[], v: readonly number[]) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += u[i] * v[i];
    return s;
  };
  const basis: number[][] = [];
  for (const col of [new Array<number>(n).fill(1), ...xs]) {
    if (col.length !== n) throw new Error("olsResiduals: column length mismatch");
    const v = [...col];
    for (const q of basis) {
      const c = dot(q, v);
      for (let i = 0; i < n; i++) v[i] -= c * q[i];
    }
    const norm = Math.sqrt(dot(v, v));
    if (norm > 1e-9 * Math.max(1, Math.sqrt(dot(col, col)))) basis.push(v.map((x) => x / norm));
  }
  const r = [...y];
  for (const q of basis) {
    const c = dot(q, r);
    for (let i = 0; i < n; i++) r[i] -= c * q[i];
  }
  return r;
}

/**
 * Permutation p-value of the ICC over `nPerm` permutations of the family labels. Permutation p starts from
 * the original label order and runs Fisher-Yates for i = N-1 down to 1, swapping position i with
 * j = weightedPick(randomKey(sigma, p, i, 8), randomKey(sigma, p, i, 9), i + 1). The p-value is
 * (1 + #{permuted ICC >= observed ICC}) / (nPerm + 1). null when the ICC is undefined.
 */
export function permutationP(resid: readonly number[], families: readonly number[], sigma: number, nPerm = 1000): { icc: number; p: number } | null {
  const obs = icc1(resid, families);
  if (obs === null) return null;
  const N = resid.length;
  let ge = 0;
  for (let p = 0; p < nPerm; p++) {
    const perm = [...families];
    for (let i = N - 1; i >= 1; i--) {
      const j = weightedPick(randomKey(sigma, p, i, 8), randomKey(sigma, p, i, 9), i + 1);
      const t = perm[i];
      perm[i] = perm[j];
      perm[j] = t;
    }
    const v = icc1(resid, perm);
    if (v !== null && v >= obs) ge++;
  }
  return { icc: obs, p: (1 + ge) / (nPerm + 1) };
}

// ---------------------------------------------------------------------------------------------
// Evolution histories (main-run directories): truncation flag and in-run donor repeatability

/** Main-run seeds are 4,810,001 + 100 arm + i (arm 0 scaf, 1 rand, 2 cont; i = 0-5), C = ceil(10^6 / period) cycles. */
export const MAIN_SEED_BASE = 4_810_001;
export const MAIN_STEPS = 1_000_000;
export type MainArm = "scaf" | "rand" | "cont";

/**
 * The (arm, history index) of a main-run directory from its meta.json, or why it is not one: arm scaf, rand or
 * cont, seed 4,810,001 + 100 arm + i, side 8, ancestor clone, mutation on, C = ceil(10^6 / period) cycles, and
 * (when `regime` is given) its period and, for scaf and rand, its k.
 */
export function mainRunOf(meta: Record<string, unknown>, regime: AssayRegime | null): { key: { arm: MainArm; history: number } | null; why: string[] } {
  const why: string[] = [];
  const arm = meta.arm;
  const armIdx = arm === "scaf" ? 0 : arm === "rand" ? 1 : arm === "cont" ? 2 : -1;
  if (armIdx < 0) why.push(`arm ${JSON.stringify(arm)}, want scaf, rand or cont`);
  const i = typeof meta.seed === "number" ? meta.seed - MAIN_SEED_BASE - 100 * armIdx : NaN;
  if (armIdx >= 0 && !(Number.isInteger(i) && i >= 0 && i < 6)) why.push(`seed ${JSON.stringify(meta.seed)} is not ${MAIN_SEED_BASE} + 100 arm + i, i = 0-5, for arm ${arm}`);
  if (meta.side !== 8) why.push(`side ${JSON.stringify(meta.side)}, want 8`);
  if (meta.init !== "clone") why.push(`init ${JSON.stringify(meta.init)}, want "clone"`);
  if (!(typeof meta.mutRate === "number" && meta.mutRate > 0)) why.push("mutation off");
  if (typeof meta.period !== "number" || !(meta.period > 0)) why.push(`period ${JSON.stringify(meta.period)}`);
  else if (meta.cycles !== Math.ceil(MAIN_STEPS / meta.period)) why.push(`cycles ${JSON.stringify(meta.cycles)}, want ${Math.ceil(MAIN_STEPS / meta.period)}`);
  if (regime !== null) {
    if (meta.period !== regime.period) why.push(`period ${JSON.stringify(meta.period)}, want ${regime.period}`);
    if (arm !== "cont" && meta.k !== regime.k) why.push(`k ${JSON.stringify(meta.k)}, want ${regime.k}`);
  }
  return { key: why.length === 0 ? { arm: arm as MainArm, history: i } : null, why };
}

/** A history's truncation over its recipient rows (every ponds.tsv row), and which history it is. */
export interface HistoryTruncation extends TruncationStat {
  arm: MainArm;
  history: number;
}

/**
 * The in-run donor-family repeatability of a history (descriptive; never a decision input). For every cycle b that
 * has a next boundary (1 <= b < C, and b below the cycle the history ended at), the recipients' next-boundary
 * traits (their pre-cycle trait at boundary b + 1) are residualised on log(1 + retained B+P) by an OLS fitted
 * within the cycle, and the ICC(1) of the residuals is taken with families = the actual donor pond. `all` averages
 * the cycles whose ICC is defined; `lastHalf` does the same over those with b > C/2. It is confounded by
 * truncation and copied physical state.
 */
export interface DonorRepeatability {
  /** Every cycle with a next boundary, in order. */
  perCycle: { cycle: number; n: number; families: number; icc: number | null }[];
  /** Mean ICC over every cycle in `perCycle` with a defined ICC, and how many that is. */
  all: { mean: number | null; cycles: number };
  /** The same over the cycles with b > C/2. */
  lastHalf: { mean: number | null; cycles: number };
}

/**
 * One streaming pass over a history's ponds.tsv (cycles in ascending order): the truncated share of its rows and,
 * with `donors`, the in-run donor-family repeatability of its `cycles` scheduled cycles. Only two cycles' rows
 * (recipient, donor, retained B+P, pre-cycle trait) are held at a time.
 */
export async function summariseHistory(rows: AsyncIterable<TsvRow>, cycles: number, donors: boolean): Promise<{ truncation: TruncationStat; repeatability: DonorRepeatability | null }> {
  type Point = { recipient: number; donor: number; retMass: number; trait: number };
  const perCycle: DonorRepeatability["perCycle"] = [];
  let n = 0;
  let truncated = 0;
  let prev: { cycle: number; pts: Point[] } | null = null;
  let cur: { cycle: number; pts: Point[] } | null = null;
  const guard = new RecipientGuard();
  // Cycle b is settled once cycle b + 1 has been read: its recipients' traits there are the next-boundary traits.
  const settle = () => {
    if (prev === null || cur === null || cur.cycle !== prev.cycle + 1 || prev.cycle >= cycles) return;
    const next = new Map(cur.pts.map((x) => [x.recipient, x.trait]));
    const pts = prev.pts.filter((x) => next.has(x.recipient)).sort((x, y) => x.recipient - y.recipient);
    if (pts.length === 0) return;
    const resid = olsResiduals(pts.map((x) => next.get(x.recipient)!), [pts.map((x) => Math.log1p(x.retMass))]);
    const families = pts.map((x) => x.donor);
    perCycle.push({ cycle: prev.cycle, n: pts.length, families: new Set(families).size, icc: icc1(resid, families) });
  };
  for await (const r of rows) {
    n++;
    guard.addRow(r);
    if (num(r, "truncated") > 0) truncated++;
    if (!donors) continue;
    const cycle = num(r, "cycle");
    if (cur === null || cycle !== cur.cycle) {
      if (cur !== null && cycle < cur.cycle) throw new Error(`ponds.tsv: cycle ${cycle} follows cycle ${cur.cycle}; cycles must ascend`);
      settle();
      prev = cur;
      cur = { cycle, pts: [] };
    }
    cur.pts.push({ recipient: num(r, "recipient"), donor: num(r, "donor"), retMass: num(r, "retMass"), trait: num(r, "recipientTrait") });
  }
  guard.finish();
  const truncation = truncationOf(truncated, n);
  if (!donors) return { truncation, repeatability: null };
  settle();
  const over = (keep: (cycle: number) => boolean) => {
    const defined = perCycle.filter((c) => keep(c.cycle) && c.icc !== null).map((c) => c.icc!);
    return { mean: defined.length ? mean(defined) : null, cycles: defined.length };
  };
  return { truncation, repeatability: { perCycle, all: over(() => true), lastHalf: over((b) => 2 * b > cycles) } };
}

// ---------------------------------------------------------------------------------------------
// Assay tables and labels

/**
 * A row of assay.tsv. `reqE`, `retE` and `truncated` are the columns the assay tool appends to the contract's
 * header; null when a table predates them. R1 needs `retE` (its covariate log(1 + retained E)) and the
 * truncation rule needs `truncated`.
 */
export interface AssayRow {
  assay: string;
  source: string;
  replicate: number;
  pond: number;
  family: number;
  inoculum: string;
  reqMass: number;
  retMass: number;
  reqE: number | null;
  retE: number | null;
  truncated: number | null;
  endTrait: number;
  success: number;
}

export function assayRow(r: TsvRow): AssayRow {
  const opt = (k: string) => (r[k] === undefined || r[k] === "" ? null : num(r, k));
  return {
    assay: r.assay,
    source: r.source,
    replicate: num(r, "replicate"),
    pond: num(r, "pond"),
    family: num(r, "family"),
    inoculum: r.inoculum,
    reqMass: num(r, "reqMass"),
    retMass: num(r, "retMass"),
    reqE: opt("reqE"),
    retE: opt("retE"),
    truncated: opt("truncated"),
    endTrait: num(r, "endTrait"),
    success: num(r, "success"),
  };
}

/** The P1 success rule on an assay row: the recorded flag, or recomputed from `ref` when the flag is -1. */
export function rowSuccess(r: AssayRow, ref: number | null): boolean {
  if (r.success >= 0) return r.success === 1;
  if (ref === null) throw new Error("assay row has success -1 and no ref to recompute it");
  return ref > 0 && 4 * r.endTrait >= ref && r.endTrait >= 4 * r.retMass;
}

export type AssayArm = "scaf" | "rand" | "cont" | "ancestor";

/**
 * The history an assay directory belongs to, read from its assay.json (top level or under `labels`):
 * `arm` (scaf | rand | cont | ancestor), `history` (0-5; or `i`; or `h` = 6 arm + i), `time` (0, or 1 / "C" for
 * the final boundary) for R1 and R2, and `timing` ("a" | "b"; else from `time`) for R3. scaffold-assays writes
 * all of them (and `calibration` for P1's R3 calibration sets) under `labels`.
 */
export interface AssayLabels {
  arm: AssayArm;
  /** History index i within its arm (0-5); -1 for the ancestor. */
  history: number;
  time: 0 | 1 | null;
  timing: "a" | "b" | null;
  ref: number | null;
  insufficient: boolean;
  /** P1's R3 calibration set: 1 = ancestor competence, 2 = quenched control; null for an ordinary set. */
  calibration: 1 | 2 | null;
  /** The regime (k, period) the assay ran at, from the top level of assay.json; null when absent. */
  k: number | null;
  period: number | null;
}

export function assayLabels(json: Record<string, unknown>): AssayLabels {
  const nested = (json.labels ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (json[k] !== undefined) return json[k];
      if (nested[k] !== undefined) return nested[k];
    }
    return undefined;
  };
  const arm = pick("arm");
  if (arm !== "scaf" && arm !== "rand" && arm !== "cont" && arm !== "ancestor") throw new Error(`assay.json: arm must be scaf|rand|cont|ancestor, got ${JSON.stringify(arm)}`);
  let history = -1;
  if (arm !== "ancestor") {
    const hi = pick("history", "i");
    const h = pick("h");
    const v = hi !== undefined ? Number(hi) : h !== undefined ? Number(h) % 6 : NaN;
    if (!Number.isInteger(v) || v < 0 || v > 5) throw new Error("assay.json: history (0-5) missing or invalid");
    history = v;
  }
  const t = pick("time", "t");
  const time: 0 | 1 | null = t === undefined ? null : t === 0 || t === "0" || t === "t0" || t === "start" || t === "init" ? 0 : t === 1 || t === "1" || t === "C" || t === "c" || t === "end" || t === "final" ? 1 : null;
  const tg = pick("timing");
  const timing: "a" | "b" | null = tg === "a" || tg === "(a)" ? "a" : tg === "b" || tg === "(b)" ? "b" : time === 0 ? "a" : time === 1 ? "b" : null;
  const ref = pick("ref");
  const cal = pick("calibration");
  const k = pick("k");
  const period = pick("period");
  return {
    arm,
    history,
    time,
    timing,
    ref: typeof ref === "number" ? ref : null,
    insufficient: pick("insufficient") === true,
    calibration: cal === 1 || cal === 2 ? cal : null,
    k: typeof k === "number" ? k : null,
    period: typeof period === "number" ? period : null,
  };
}

/** An assay directory: its labels and every assay.tsv row. */
export interface AssaySet {
  labels: AssayLabels;
  rows: AssayRow[];
}

const armIndex = (arm: AssayArm): number => (arm === "scaf" ? 0 : arm === "rand" ? 1 : arm === "cont" ? 2 : 3);

/** competence: the fraction of an inoculum's rows that meet the success rule; null when there are none. */
export function competence(rows: readonly AssayRow[], ref: number | null = null): { n: number; successes: number; value: number | null } {
  const successes = rows.filter((r) => rowSuccess(r, ref)).length;
  return { n: rows.length, successes, value: rows.length ? successes / rows.length : null };
}

/** A history's source at one time (0 = time 0 / timing a, 1 = time C / timing b): what a verdict needs one set of. */
export interface AssayKey {
  arm: AssayArm;
  /** -1 for the ancestor. */
  history: number;
  time: 0 | 1;
}

/** The key of a set from its labels (`time`, else `timing`); null when neither is labelled. */
export function setKey(l: AssayLabels): AssayKey | null {
  const time = l.time ?? (l.timing === "a" ? 0 : l.timing === "b" ? 1 : null);
  return time === null ? null : { arm: l.arm, history: l.history, time };
}

const sameKey = (x: AssayKey, y: AssayKey) => x.arm === y.arm && x.history === y.history && x.time === y.time;
const hasKey = (keys: readonly AssayKey[], arm: AssayArm, history: number, time: 0 | 1) => keys.some((k) => sameKey(k, { arm, history, time }));
const HISTORIES: readonly number[] = [0, 1, 2, 3, 4, 5];
const armKeys = (arms: readonly ("scaf" | "rand" | "cont")[]): AssayKey[] => arms.flatMap((arm) => HISTORIES.flatMap((history) => ([0, 1] as const).map((time) => ({ arm, history, time }))));

/** Every (arm, history, time) each verdict is judged over with complete data: scaf and rand for R1 and R2; also cont and the ancestor for R3. */
export const R1_EXPECTED: readonly AssayKey[] = armKeys(["scaf", "rand"]);
export const R2_EXPECTED: readonly AssayKey[] = R1_EXPECTED;
export const R3_EXPECTED: readonly AssayKey[] = [...armKeys(["scaf", "rand", "cont"]), { arm: "ancestor", history: -1, time: 0 }, { arm: "ancestor", history: -1, time: 1 }];

/**
 * The protocol's "at least 4 of 6" over `n` remaining histories: 4 of 6 exactly, and scaled up to the
 * next whole history (ceil(4n/6)) when truncation-flagged histories are left out.
 */
export const atLeastFourOfSix = (n: number): number => Math.floor((4 * n + 5) / 6);

/** A sound assay directory: 64 ponds (side 8), 2 replicates. */
export const ASSAY_SIDE = 8;
export const ASSAY_REPLICATES = 2;

/** An assay directory as read: its path, assay.json, labels and assay.tsv rows. */
export interface AssayDir {
  dir: string;
  json: Record<string, unknown>;
  labels: AssayLabels;
  rows: AssayRow[];
}

export interface AssayRegime {
  k: number;
  period: number;
}

/**
 * Screens assay directories before any stage pools them. A set is rejected (dropped and reported, with its
 * reasons) unless its assay.json says side 8 and 2 replicates, its assay.tsv has side^2 x replicates rows (none
 * for an `insufficient` R1 set), its k and period are among `regimes` (when null the accepted sets must
 * agree with each other, else this throws), every recorded replicate's seeds decode to the labels
 * (`checkAssaySeeds`, which refuses `--allow-any-seed` smoke sets and a separately seeded quenched calibration) and,
 * for R1, `donorSeed` is assaySeed(1, h, t, 0, 9). Two accepted sets with the same (assay, arm, history, time,
 * calibration, inoculum) throw, since stages pool by label and would count both; a calibration set's identity
 * includes its regime, so the calibration of several regimes can be read together.
 */
export function validateAssayDirs(dirs: readonly AssayDir[], regimes: readonly AssayRegime[] | null): { accepted: AssayDir[]; rejected: { dir: string; reasons: string[] }[]; regime: AssayRegime | null } {
  const accepted: AssayDir[] = [];
  const rejected: { dir: string; reasons: string[] }[] = [];
  for (const d of dirs) {
    const { json, labels, rows } = d;
    const why: string[] = [];
    if (json.side !== ASSAY_SIDE) why.push(`side ${JSON.stringify(json.side)}, want ${ASSAY_SIDE}`);
    if (json.replicates !== ASSAY_REPLICATES) why.push(`replicates ${JSON.stringify(json.replicates)}, want ${ASSAY_REPLICATES}`);
    const want = labels.insufficient ? 0 : ASSAY_SIDE * ASSAY_SIDE * ASSAY_REPLICATES;
    if (rows.length !== want) why.push(`${rows.length} rows, want ${want}`);
    if (regimes !== null && !regimes.some((r) => r.k === labels.k && r.period === labels.period)) {
      why.push(`regime k ${labels.k} period ${labels.period}, want ${regimes.map((r) => `k ${r.k} period ${r.period}`).join(" or ")}`);
    }
    try {
      const name = json.assay;
      if (name !== "competence" && name !== "transmission" && name !== "garden") throw new Error(`assay ${JSON.stringify(name)} is not competence, transmission or garden`);
      const seeds = json.seeds as { physics?: unknown; fragment?: unknown }[] | undefined;
      if (!Array.isArray(seeds) || seeds.length !== ASSAY_REPLICATES) throw new Error(`assay.json has ${Array.isArray(seeds) ? seeds.length : "no"} seeds, want ${ASSAY_REPLICATES} {physics, fragment}`);
      const key = setKey(labels);
      if (key === null) throw new Error("no time or timing label");
      const set: AssayLabelSet = { arm: labels.arm, time: key.time, timing: key.time === 0 ? "a" : "b", ...(labels.arm === "ancestor" ? {} : { history: labels.history }), ...(labels.calibration !== null ? { calibration: labels.calibration } : {}) };
      seeds.forEach((sd, replicate) => {
        if (typeof sd?.physics !== "number" || typeof sd.fragment !== "number") throw new Error(`assay.json seeds[${replicate}] is not {physics, fragment}`);
        checkAssaySeeds(name as AssayName, set, String(json.inoculum ?? rows[0]?.inoculum ?? "fragment"), { physics: sd.physics, fragment: sd.fragment }, replicate);
      });
      if (name === "transmission") {
        if (typeof json.donorSeed !== "number") throw new Error("assay.json has no donorSeed");
        checkDonorSeed(set, json.donorSeed);
      }
    } catch (e) {
      why.push((e as Error).message);
    }
    if (why.length > 0) rejected.push({ dir: d.dir, reasons: why });
    else accepted.push(d);
  }
  const idOf = (d: AssayDir) => {
    const key = setKey(d.labels);
    const regime = d.labels.calibration === null ? "" : `|k${d.labels.k}|p${d.labels.period}`;
    return `${d.json.assay}|${d.labels.arm}|${d.labels.history}|${key?.time}|${d.labels.calibration}|${d.json.inoculum ?? d.rows[0]?.inoculum}${regime}`;
  };
  const seen = new Map<string, string>();
  for (const d of accepted) {
    const id = idOf(d);
    const prior = seen.get(id);
    if (prior !== undefined) throw new Error(`${d.dir} and ${prior} are the same assay set (${id}); a stage would count both`);
    seen.set(id, d.dir);
  }
  let regime: AssayRegime | null = regimes?.length === 1 ? regimes[0] : null;
  if (regimes === null) {
    for (const d of accepted) {
      const r = { k: d.labels.k!, period: d.labels.period! };
      if (regime === null) regime = r;
      else if (regime.k !== r.k || regime.period !== r.period) throw new Error(`assay sets mix regimes (k ${regime.k} period ${regime.period} and k ${r.k} period ${r.period}); pass --regime K PERIOD`);
    }
  }
  return { accepted, rejected, regime };
}

// ---------------------------------------------------------------------------------------------
// R1: pond-level heredity

export const R1_PERMUTATIONS = 1000;
export const R1_ALPHA = 0.05;

/** R1's covariates: the trait is residualised on log(1 + retained B+P) and log(1 + retained E). */
export const R1_COVARIATES = ["log1p(retMass)", "log1p(retE)"];

/**
 * R1's statistic on fragments in R1's order (replicate 0's f = 0..63, then replicate 1's): the OLS residuals of
 * `trait` on `R1_COVARIATES`, fitted over every fragment given, the ICC(1) of the residuals with families = donors, and
 * its permutation p-value from `R1_PERMUTATIONS` permutations with the stream `sigma`. `icc` and `p` are null when the
 * ICC is undefined. R1 calls it with the end trait and sigma8 = assaySeed(1, h, t, 0, 8), R1' with the trait at tau
 * (or the end trait) and sigma8 = r1PrimeSeed(h, t', 8).
 */
export function r1Test(
  trait: readonly number[],
  retMass: readonly number[],
  retE: readonly number[],
  families: readonly number[],
  sigma: number,
): { resid: number[]; icc: number | null; p: number | null; demonstrated: boolean } {
  const resid = olsResiduals(trait, [retMass.map((m) => Math.log1p(m)), retE.map((e) => Math.log1p(e))]);
  const res = permutationP(resid, families, sigma, R1_PERMUTATIONS);
  if (!res) return { resid, icc: null, p: null, demonstrated: false };
  return { resid, icc: res.icc, p: res.p, demonstrated: res.icc > 0 && res.p < R1_ALPHA };
}

export interface R1Result {
  /** History index h = 6 arm + i and time t (0 or 1) that key the permutation stream. */
  h: number;
  t: number;
  n: number;
  families: number;
  icc: number | null;
  p: number | null;
  /** ICC above 0 with p < 0.05. */
  demonstrated: boolean;
  covariates: string[];
  insufficient: boolean;
}

/**
 * R1 for one history and time. Fragments are ordered replicate 0's f = 0..63, then replicate 1's; the
 * end trait is residualised on log(1 + retained B+P) and log(1 + retained E), fitted over all fragments (a
 * table without retE is an error, not a fallback); the ICC(1) is taken with families = donors and tested against
 * `R1_PERMUTATIONS` permutations of the labels with sigma8 = assaySeed(1, h, t, 0, 8).
 */
export function r1History(rows: readonly AssayRow[], h: number, t: number, insufficient = false): R1Result {
  const frag = rows.filter((r) => r.inoculum === "fragment").sort((a, b) => a.replicate - b.replicate || a.pond - b.pond);
  const base = { h, t, n: frag.length, families: new Set(frag.map((r) => r.family)).size, insufficient };
  if (insufficient || frag.length === 0) return { ...base, icc: null, p: null, demonstrated: false, covariates: [] };
  // The protocol residualises on log(1 + retained B+P) and log(1 + retained E); a table without retE is another model.
  if (frag.some((r) => r.retE === null)) throw new Error(`R1 (h ${h}, t ${t}): assay.tsv has no retE column, so the protocol's covariate is missing; re-run the transmission assay`);
  const covariates = [...R1_COVARIATES];
  const res = r1Test(frag.map((r) => r.endTrait), frag.map((r) => r.retMass), frag.map((r) => r.retE!), frag.map((r) => r.family), assaySeed(1, h, t, 0, 8));
  if (res.icc === null) return { ...base, icc: null, p: null, demonstrated: false, covariates };
  return { ...base, icc: res.icc, p: res.p, demonstrated: res.demonstrated, covariates };
}

/** R1 over every scaf and rand set (labels need `time`); an arm demonstrates heredity with at least 4 of 6 histories at C. */
export function r1Evaluate(sets: readonly AssaySet[]): {
  histories: (R1Result & { arm: AssayArm; history: number })[];
  arms: Record<"scaf" | "rand", { demonstratedAtC: number; demonstrated: boolean }>;
} {
  const histories: (R1Result & { arm: AssayArm; history: number })[] = [];
  for (const set of sets) {
    const { arm, history, time } = set.labels;
    if ((arm !== "scaf" && arm !== "rand") || time === null) continue;
    histories.push({ arm, history, ...r1History(set.rows, 6 * armIndex(arm) + history, time, set.labels.insufficient) });
  }
  histories.sort((a, b) => armIndex(a.arm) - armIndex(b.arm) || a.history - b.history || a.t - b.t);
  const armResult = (arm: "scaf" | "rand") => {
    const demonstratedAtC = histories.filter((x) => x.arm === arm && x.t === 1 && x.demonstrated).length;
    return { demonstratedAtC, demonstrated: demonstratedAtC >= 4 };
  };
  return { histories, arms: { scaf: armResult("scaf"), rand: armResult("rand") } };
}

// ---------------------------------------------------------------------------------------------
// R1' and the tau calibration (protocol, Amendment 2)

/** traits.tsv (`scaffold-assays --traits`) holds a trait at every census, every 100 steps of the period. */
export const TRAIT_CENSUS = 100;

/** A row of traits.tsv: a pond's trait (B+P over cells with B+P >= 48) at one census step of an assay period. */
export interface TraitRow {
  replicate: number;
  pond: number;
  step: number;
  trait: number;
}

export function traitRow(r: TsvRow): TraitRow {
  return { replicate: num(r, "replicate"), pond: num(r, "pond"), step: num(r, "step"), trait: num(r, "trait") };
}

/** The (replicate, pond) grid an assay fills exactly once: replicates 0..R-1 x ponds 0..P-1 (2 x 64 for the protocol's 8 x 8 ponds). */
export interface FragmentGrid {
  replicates: number;
  ponds: number;
}

/** The grid an assay.json declares (replicates x side^2); null when it declares none. */
export function gridOfJson(json: Record<string, unknown>): FragmentGrid | null {
  const { side, replicates } = json;
  return Number.isInteger(side) && Number.isInteger(replicates) && (side as number) >= 1 && (replicates as number) >= 1 ? { replicates: replicates as number, ponds: (side as number) ** 2 } : null;
}

/** Rows of `keys` that repeat an earlier (replicate, pond) or fall outside `grid`. */
function gridViolations(keys: Iterable<{ replicate: number; pond: number }>, grid: FragmentGrid): { repeated: number; outside: number } {
  const seen = new Set<number>();
  let repeated = 0;
  let outside = 0;
  for (const { replicate, pond } of keys) {
    if (!Number.isInteger(replicate) || !Number.isInteger(pond) || replicate < 0 || replicate >= grid.replicates || pond < 0 || pond >= grid.ponds) {
      outside++;
      continue;
    }
    const id = replicate * grid.ponds + pond;
    if (seen.has(id)) repeated++;
    else seen.add(id);
  }
  return { repeated, outside };
}

export interface TraitsRead {
  /** Rows per census step, for every step in the file. */
  counts: Map<number, number>;
  /** Rows per census step that repeat a (replicate, pond) of that step or lie outside the grid; empty without a grid. */
  invalid: Map<number, number>;
  /** The rows of the steps in `keep` (every step when `keep` is omitted), in file order. */
  rows: Map<number, TraitRow[]>;
}

/**
 * Streams traits.tsv, counting every step's rows and keeping those of `keep`; the table is never held whole. With a
 * `grid`, it also counts, per step, the rows that repeat a (replicate, pond) or lie outside it.
 */
export async function readTraits(lines: AsyncIterable<TsvRow>, keep?: ReadonlySet<number>, grid?: FragmentGrid | null): Promise<TraitsRead> {
  const counts = new Map<number, number>();
  const invalid = new Map<number, number>();
  const seen = new Map<number, Set<number>>();
  const rows = new Map<number, TraitRow[]>();
  for await (const r of lines) {
    const t = traitRow(r);
    counts.set(t.step, (counts.get(t.step) ?? 0) + 1);
    if (grid) {
      let at = seen.get(t.step);
      if (!at) seen.set(t.step, (at = new Set()));
      const id = t.replicate * grid.ponds + t.pond;
      const inside = Number.isInteger(t.replicate) && Number.isInteger(t.pond) && t.replicate >= 0 && t.replicate < grid.replicates && t.pond >= 0 && t.pond < grid.ponds;
      if (!inside || at.has(id)) invalid.set(t.step, (invalid.get(t.step) ?? 0) + 1);
      else at.add(id);
    }
    if (keep !== undefined && !keep.has(t.step)) continue;
    const list = rows.get(t.step);
    if (list) list.push(t);
    else rows.set(t.step, [t]);
  }
  return { counts, invalid, rows };
}

/** The tau calibration's set and the R1' sets as read: path, assay.json, assay.tsv rows and traits.tsv (null when absent). */
export interface TraitSetDir {
  dir: string;
  json: Record<string, unknown>;
  rows: AssayRow[];
  traits: TraitsRead | null;
}

/** What is wrong with a set's traits.tsv against its assay.json: not recorded, other census steps than every `censusEvery` up to `period`, or other than one row per assay row at a step. */
function traitsProblems(json: Record<string, unknown>, assayRows: number, traits: TraitsRead | null): string[] {
  const why: string[] = [];
  if (json.traitsRecorded !== true) why.push("assay.json does not say traitsRecorded (run the assay with --traits)");
  if (traits === null) {
    why.push("no traits.tsv");
    return why;
  }
  const { period, censusEvery } = json;
  if (!Number.isInteger(period) || !Number.isInteger(censusEvery) || (period as number) < 1 || (censusEvery as number) < 1) {
    why.push("assay.json has no period and censusEvery");
    return why;
  }
  // An insufficient R1' set has no fragments, so no traits either.
  const want = assayRows === 0 ? [] : censusSteps(period as number, censusEvery as number);
  const have = [...traits.counts.keys()].sort((a, b) => a - b);
  if (have.length !== want.length || have.some((st, i) => st !== want[i])) {
    why.push(`traits.tsv has ${have.length} census steps${have.length ? ` (${have[0]}..${have[have.length - 1]})` : ""}, want ${want.length}${want.length ? ` (${want[0]}..${want[want.length - 1]})` : ""}`);
    return why;
  }
  const off = [...traits.counts].filter(([, c]) => c !== assayRows);
  if (off.length > 0) why.push(`traits.tsv has ${off.length} census steps without ${assayRows} rows (step ${off[0][0]} has ${off[0][1]})`);
  const bad = [...traits.invalid].filter(([, c]) => c > 0).sort(([x], [y]) => x - y);
  if (bad.length > 0) why.push(`traits.tsv has ${bad.length} census steps with a repeated or out-of-grid (replicate, pond) (step ${bad[0][0]}: ${bad[0][1]} rows)`);
  return why;
}

/**
 * What is wrong with assay.tsv's fragment grid: every row must be a fragment row, and (replicate, pond) must fill
 * `grid` exactly once (a row count that matches the grid is checked by the caller).
 */
function rowsProblems(rows: readonly AssayRow[], grid: FragmentGrid | null): string[] {
  const why: string[] = [];
  const other = rows.filter((r) => r.inoculum !== "fragment").length;
  if (other > 0) why.push(`${other} assay.tsv rows are not fragment rows`);
  if (grid) {
    const v = gridViolations(rows, grid);
    if (v.repeated > 0) why.push(`assay.tsv repeats a (replicate, pond) in ${v.repeated} rows`);
    if (v.outside > 0) why.push(`assay.tsv has ${v.outside} rows outside the ${grid.replicates} x ${grid.ponds} (replicate, pond) grid`);
  }
  return why;
}

// ---- tau

/** With no census at 0.25 ref, tau is the whole period (Amendment 2: 10,000), and R1''s trait is R1's end trait. */
export const TAU_FALLBACK = 10_000;

export interface TauResult {
  /** The first census step at which the median trait of the calibration's fragments is at least 0.25 ref, else the fallback. */
  tau: number;
  crossed: boolean;
  /** 0.25 ref. */
  threshold: number;
  /** The median trait at tau; null when tau (the fallback) is not a census step of the curve. */
  medianAtTau: number | null;
  /** The median trait over every fragment at each census step. */
  curve: { step: number; n: number; median: number }[];
}

/**
 * Amendment 2's tau: from the traits of the calibration's fragments by census step, the first step (ascending) at which
 * their median is at least 0.25 ref (4 median >= ref, exact since medians are halves); `fallback` when none is.
 */
export function tauRule(byStep: ReadonlyMap<number, readonly number[]>, ref: number, fallback = TAU_FALLBACK): TauResult {
  if (!(ref > 0)) throw new Error(`tau needs a positive ref, got ${ref}`);
  const curve = [...byStep].sort(([x], [y]) => x - y).map(([step, xs]) => ({ step, n: xs.length, median: median(xs) }));
  const hit = curve.find((c) => 4 * c.median >= ref);
  const tau = hit ? hit.step : fallback;
  return { tau, crossed: hit !== undefined, threshold: ref / 4, medianAtTau: curve.find((c) => c.step === tau)?.median ?? null, curve };
}

/** The grid a screen holds an assay to: the protocol's 2 x 64 in strict mode, what assay.json declares for a smoke run. */
const gridFor = (json: Record<string, unknown>, strict: boolean): FragmentGrid | null => (strict ? { replicates: ASSAY_REPLICATES, ponds: ASSAY_SIDE * ASSAY_SIDE } : gridOfJson(json));

/**
 * What Amendment 2's tau calibration is, in strict mode: the R3 ancestor source (seed 4,802,001 world) at the frozen
 * regime and reference, 64 ponds x 2 replicates.
 */
export const TAU_FROZEN = { ref: 103_058, k: 8, period: 10_000, side: 8, replicates: 2, source: "calib/source/ckpt/b1-pre.blck.gz" } as const;

/**
 * Screens the tau calibration's directories (the competence sets labelled `tauCalibration`). Strict mode requires
 * `TAU_FROZEN` (ref, k, period, side, replicates and an ancestor source path ending in its `source`), the label
 * `tauCalibration` on the ancestor, seeds 4,849,001 + s, and 100-step censuses; `allowAnySeed` (smoke runs) waives those
 * and holds the set to the grid assay.json declares. Either way the ref must be positive, assay.tsv and every census step
 * of traits.tsv must fill the (replicate, pond) grid exactly once (128 fragments in strict mode), and traits are
 * recorded. A set that fails is rejected with its reasons.
 */
export function tauScreen(dirs: readonly TraitSetDir[], o: { regimes: readonly AssayRegime[] | null; allowAnySeed?: boolean }): { accepted: TraitSetDir[]; rejected: { dir: string; reasons: string[] }[] } {
  const accepted: TraitSetDir[] = [];
  const rejected: { dir: string; reasons: string[] }[] = [];
  const strict = !o.allowAnySeed;
  for (const d of dirs) {
    const { json, rows, traits } = d;
    const why: string[] = [];
    if (json.assay !== "competence") why.push(`assay ${JSON.stringify(json.assay)}, want competence`);
    if (!(typeof json.ref === "number" && json.ref > 0)) why.push(`ref ${JSON.stringify(json.ref)}, want a positive number (the competence reference)`);
    const labels = (json.labels ?? {}) as Record<string, unknown>;
    if (labels.tauCalibration !== true) why.push("labels.tauCalibration is not true");
    const grid = gridFor(json, strict);
    if (grid === null) why.push("assay.json has no side and replicates");
    else {
      if (rows.length !== grid.replicates * grid.ponds) why.push(`${rows.length} rows, want ${grid.replicates * grid.ponds}`);
      why.push(...rowsProblems(rows, grid));
    }
    if (strict) {
      if (labels.arm !== "ancestor") why.push(`labels.arm ${JSON.stringify(labels.arm)}, want ancestor`);
      if (json.ref !== TAU_FROZEN.ref) why.push(`ref ${JSON.stringify(json.ref)}, want ${TAU_FROZEN.ref}`);
      if (json.k !== TAU_FROZEN.k) why.push(`k ${JSON.stringify(json.k)}, want ${TAU_FROZEN.k}`);
      if (json.period !== TAU_FROZEN.period) why.push(`period ${JSON.stringify(json.period)}, want ${TAU_FROZEN.period}`);
      if (json.side !== TAU_FROZEN.side) why.push(`side ${JSON.stringify(json.side)}, want ${TAU_FROZEN.side}`);
      if (json.replicates !== TAU_FROZEN.replicates) why.push(`replicates ${JSON.stringify(json.replicates)}, want ${TAU_FROZEN.replicates}`);
      if (!(typeof json.source === "string" && json.source.endsWith(TAU_FROZEN.source))) why.push(`source ${JSON.stringify(json.source)}, want a path ending in ${TAU_FROZEN.source}`);
      if (json.inoculum !== undefined && json.inoculum !== "fragment") why.push(`inoculum ${JSON.stringify(json.inoculum)}, want fragment`);
      if (json.censusEvery !== TRAIT_CENSUS) why.push(`censusEvery ${JSON.stringify(json.censusEvery)}, want ${TRAIT_CENSUS}`);
      if (o.regimes !== null && !o.regimes.some((r) => r.k === json.k && r.period === json.period)) why.push(`regime k ${json.k} period ${json.period}, want ${o.regimes.map((r) => `k ${r.k} period ${r.period}`).join(" or ")}`);
      const seeds = json.seeds as { physics?: unknown; fragment?: unknown }[] | undefined;
      if (!Array.isArray(seeds) || seeds.length !== ASSAY_REPLICATES) why.push(`assay.json has ${Array.isArray(seeds) ? seeds.length : "no"} seeds, want ${ASSAY_REPLICATES} {physics, fragment}`);
      else {
        try {
          seeds.forEach((sd, s) => {
            if (typeof sd?.physics !== "number" || typeof sd.fragment !== "number") throw new Error(`assay.json seeds[${s}] is not {physics, fragment}`);
            checkTauSeeds({ physics: sd.physics, fragment: sd.fragment }, s);
          });
        } catch (e) {
          why.push((e as Error).message);
        }
      }
    }
    why.push(...traitsProblems(json, rows.length, traits));
    if (why.length > 0) rejected.push({ dir: d.dir, reasons: why });
    else accepted.push(d);
  }
  return { accepted, rejected };
}

/** What is wrong with a tau.json as r1prime's input: not strict calibration output (validated, at the frozen regime and ancestor source, tau a census step of the period). */
export function tauJsonProblems(j: Record<string, unknown>): string[] {
  const why: string[] = [];
  if (j.stage !== "tau") why.push(`stage ${JSON.stringify(j.stage)}, want tau`);
  const tau = j.tau;
  if (!Number.isInteger(tau) || (tau as number) < 1) why.push(`tau ${JSON.stringify(tau)}, want a positive integer`);
  else if ((tau as number) % TRAIT_CENSUS !== 0 || (tau as number) > TAU_FROZEN.period) why.push(`tau ${tau} is not a census step of the ${TAU_FROZEN.period}-step period`);
  if (j.validated !== true) why.push("tau.json is not validated strict calibration output (validated is not true; a smoke or --allow-any-seed run?)");
  const p = (j.provenance ?? null) as Record<string, unknown> | null;
  if (p === null || typeof p !== "object") why.push("tau.json has no provenance");
  else {
    for (const key of ["ref", "k", "period", "side", "replicates"] as const) if (p[key] !== TAU_FROZEN[key]) why.push(`provenance.${key} ${JSON.stringify(p[key])}, want ${TAU_FROZEN[key]}`);
    if (!(typeof p.source === "string" && p.source.endsWith(TAU_FROZEN.source))) why.push(`provenance.source ${JSON.stringify(p.source)}, want a path ending in ${TAU_FROZEN.source}`);
    const seeds = p.seeds as { physics?: unknown; fragment?: unknown }[] | undefined;
    if (!Array.isArray(seeds) || seeds.length !== ASSAY_REPLICATES || seeds.some((sd, s) => sd?.physics !== TAU_SEED_BASE + s || sd?.fragment !== TAU_SEED_BASE + s)) why.push(`provenance.seeds are not 4,849,001 + s for s = 0-${ASSAY_REPLICATES - 1}`);
    if ((p.labels as Record<string, unknown> | undefined)?.tauCalibration !== true) why.push("provenance.labels.tauCalibration is not true");
  }
  return why;
}

// ---- R1'

export type R1PrimeKey = { arm: "scaf" | "rand"; history: number; tPrime: 0 | 1 | 2 };

const r1PrimeId = (k: R1PrimeKey): string => `${k.arm}-i${k.history}-t${k.tPrime}`;

/** The 12 histories x 3 boundaries R1' reads: scaf then rand, i = 0-5, t' = 0-2. */
export const R1_PRIME_KEYS: readonly R1PrimeKey[] = (["scaf", "rand"] as const).flatMap((arm) => HISTORIES.flatMap((history) => ([0, 1, 2] as const).map((tPrime) => ({ arm, history, tPrime }))));

/** One fragment of an R1' set: R1's columns, the trait at the end of the period and the trait at tau. */
export interface R1PrimeFragment {
  family: number;
  retMass: number;
  retE: number;
  truncated: boolean;
  endTrait: number;
  tauTrait: number;
}

/** A screened R1' set: fragments in R1's order (replicate 0's f = 0..63, then replicate 1's). */
export interface R1PrimeSet extends R1PrimeKey {
  /** Fewer than 2 eligible donors (a biological outcome: no fragments, not demonstrated). */
  insufficient: boolean;
  fragments: R1PrimeFragment[];
}

/** The (arm, history, t') an assay.json is labelled with, or null when it is not an R1' set's. */
export function r1PrimeKeyOf(json: Record<string, unknown>): R1PrimeKey | null {
  const lab = r1PrimeLabelsOf(json);
  return "error" in lab ? null : { arm: lab.labels.arm, history: lab.labels.history, tPrime: lab.labels.timePrime };
}

/** The `labels` of an R1' directory, or why it has none. */
function r1PrimeLabelsOf(json: Record<string, unknown>): { labels: R1PrimeLabelSet } | { error: string } {
  const l = (json.labels ?? {}) as Record<string, unknown>;
  if (l.r1prime !== true) return { error: "labels.r1prime is not true" };
  const { arm, history, timePrime } = l;
  if (arm !== "scaf" && arm !== "rand") return { error: `labels.arm ${JSON.stringify(arm)}, want scaf or rand` };
  if (!Number.isInteger(history) || (history as number) < 0 || (history as number) > 5) return { error: `labels.history ${JSON.stringify(history)}, want 0-5` };
  if (timePrime !== 0 && timePrime !== 1 && timePrime !== 2) return { error: `labels.timePrime ${JSON.stringify(timePrime)}, want 0, 1 or 2` };
  return { labels: { arm, history: history as number, r1prime: true, timePrime } };
}

/**
 * Screens R1' directories (transmission sets labelled `r1prime`) before the stage pools them. A set is rejected, with its
 * reasons, unless it is 64 ponds x 2 replicates (side 8; no rows when `insufficient`) whose assay.tsv fills the
 * (replicate, pond) grid exactly once and carries retE, at a regime in `regimes` (when null the accepted sets must agree,
 * else this throws), with replicate s seeded r1PrimeSeed(h, t', s) for its labels and donors drawn with s = 9; its
 * traits.tsv must fill the same grid exactly once at every census step (100..period) and agree with assay.tsv's end
 * trait at the last, and `tau` must be one of its census steps. Two sets with one (arm, history, t') are both rejected
 * (a stage would count both). Nothing here throws for one bad set: it is rejected with its key, so the stage can mark
 * that history-time unavailable. `allowAnySeed` (smoke runs) waives the side, replicate, regime and seed checks and
 * holds the set to the grid assay.json declares. An accepted set carries its fragments with the trait at `tau` and at
 * the end of the period.
 */
export function r1PrimeScreen(
  dirs: readonly TraitSetDir[],
  o: { tau: number; regimes: readonly AssayRegime[] | null; allowAnySeed?: boolean },
): { accepted: (R1PrimeSet & { dir: string })[]; rejected: { dir: string; key: R1PrimeKey | null; reasons: string[] }[]; regime: AssayRegime | null } {
  const strict = !o.allowAnySeed;
  const candidates: (R1PrimeSet & { dir: string; k: unknown; period: unknown })[] = [];
  const rejected: { dir: string; key: R1PrimeKey | null; reasons: string[] }[] = [];
  for (const d of dirs) {
    const { json, rows, traits } = d;
    const lab = r1PrimeLabelsOf(json);
    if ("error" in lab) {
      rejected.push({ dir: d.dir, key: null, reasons: [lab.error] });
      continue;
    }
    const labels = lab.labels;
    const key: R1PrimeKey = { arm: labels.arm, history: labels.history, tPrime: labels.timePrime };
    const insufficient = json.insufficient === true;
    const why: string[] = [];
    if (json.assay !== "transmission") why.push(`assay ${JSON.stringify(json.assay)}, want transmission`);
    const grid = gridFor(json, strict);
    if (insufficient) {
      if (rows.length !== 0) why.push(`${rows.length} rows, want 0 (fewer than 2 eligible donors)`);
    } else if (grid === null) why.push("assay.json has no side and replicates");
    else {
      if (rows.length !== grid.replicates * grid.ponds) why.push(`${rows.length} rows, want ${grid.replicates * grid.ponds}`);
      why.push(...rowsProblems(rows, grid));
    }
    if (rows.some((r) => r.retE === null)) why.push("assay.tsv has no retE column, so the protocol's covariate is missing; re-run the transmission assay");
    if (strict) {
      if (json.side !== ASSAY_SIDE) why.push(`side ${JSON.stringify(json.side)}, want ${ASSAY_SIDE}`);
      if (json.replicates !== ASSAY_REPLICATES) why.push(`replicates ${JSON.stringify(json.replicates)}, want ${ASSAY_REPLICATES}`);
      if (json.censusEvery !== TRAIT_CENSUS) why.push(`censusEvery ${JSON.stringify(json.censusEvery)}, want ${TRAIT_CENSUS}`);
      if (o.regimes !== null && !o.regimes.some((r) => r.k === json.k && r.period === json.period)) why.push(`regime k ${json.k} period ${json.period}, want ${o.regimes.map((r) => `k ${r.k} period ${r.period}`).join(" or ")}`);
      const seeds = json.seeds as { physics?: unknown; fragment?: unknown }[] | undefined;
      if (!Array.isArray(seeds) || seeds.length !== ASSAY_REPLICATES) why.push(`assay.json has ${Array.isArray(seeds) ? seeds.length : "no"} seeds, want ${ASSAY_REPLICATES} {physics, fragment}`);
      else {
        try {
          seeds.forEach((sd, s) => {
            if (typeof sd?.physics !== "number" || typeof sd.fragment !== "number") throw new Error(`assay.json seeds[${s}] is not {physics, fragment}`);
            checkR1PrimeSeeds(labels, { physics: sd.physics, fragment: sd.fragment }, s);
          });
          if (typeof json.donorSeed !== "number") throw new Error("assay.json has no donorSeed");
          checkR1PrimeDonorSeed(labels, json.donorSeed);
        } catch (e) {
          why.push((e as Error).message);
        }
      }
    }
    why.push(...traitsProblems(json, rows.length, traits));
    const frag = rows.filter((r) => r.inoculum === "fragment").sort((a, b) => a.replicate - b.replicate || a.pond - b.pond);
    const fragments: R1PrimeFragment[] = [];
    if (why.length === 0 && frag.length > 0) {
      const period = json.period as number;
      const at = (step: number): Map<string, number> | string => {
        const m = new Map<string, number>();
        for (const t of traits!.rows.get(step) ?? []) {
          const id = `${t.replicate}:${t.pond}`;
          if (m.has(id)) return `traits.tsv has two rows for replicate ${t.replicate} pond ${t.pond} at step ${step}`;
          m.set(id, t.trait);
        }
        return m;
      };
      const tauTraits = traits!.counts.has(o.tau) ? at(o.tau) : `tau ${o.tau} is not a census step of traits.tsv`;
      const endTraits = at(period);
      if (typeof tauTraits === "string") why.push(tauTraits);
      else if (typeof endTraits === "string") why.push(endTraits);
      else {
        let off = 0;
        for (const r of frag) {
          const id = `${r.replicate}:${r.pond}`;
          const tauTrait = tauTraits.get(id);
          if (tauTrait === undefined || endTraits.get(id) !== r.endTrait) {
            off++;
            continue;
          }
          fragments.push({ family: r.family, retMass: r.retMass, retE: r.retE!, truncated: (r.truncated ?? 0) > 0, endTrait: r.endTrait, tauTrait });
        }
        if (off > 0) why.push(`traits.tsv disagrees with assay.tsv for ${off} fragments (a fragment without a trait at tau, or an end trait other than the one at step ${period})`);
      }
    }
    if (why.length > 0) rejected.push({ dir: d.dir, key, reasons: why });
    else candidates.push({ ...key, dir: d.dir, insufficient, fragments, k: json.k, period: json.period });
  }
  // Two sets for one history-time are ambiguous: neither is used, and the history-time is unavailable.
  const accepted: (R1PrimeSet & { dir: string })[] = [];
  const regimesSeen: AssayRegime[] = [];
  for (const c of candidates) {
    const same = candidates.filter((x) => r1PrimeId(x) === r1PrimeId(c));
    if (same.length > 1) {
      rejected.push({ dir: c.dir, key: { arm: c.arm, history: c.history, tPrime: c.tPrime }, reasons: [`the same R1' set (${r1PrimeId(c)}) as ${same.filter((x) => x !== c).map((x) => x.dir).join(", ")}; a stage would count both`] });
      continue;
    }
    if (typeof c.k === "number" && typeof c.period === "number") regimesSeen.push({ k: c.k, period: c.period });
    const { k: _k, period: _period, ...set } = c;
    accepted.push(set);
  }
  let regime: AssayRegime | null = o.regimes?.length === 1 ? o.regimes[0] : null;
  if (o.regimes === null) {
    for (const r of regimesSeen) {
      if (regime === null) regime = r;
      else if (regime.k !== r.k || regime.period !== r.period) throw new Error(`R1' sets mix regimes (k ${regime.k} period ${regime.period} and k ${r.k} period ${r.period}); pass --regime K PERIOD`);
    }
  }
  return { accepted, rejected, regime };
}

/** The sample variance (n - 1) of `xs`; null with fewer than 2 values. */
function sampleVariance(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1);
}

/** One trait's statistic over a history-time's fragments. */
export interface R1PrimeTraitStat {
  icc: number | null;
  p: number | null;
  /** ICC above 0 with p < 0.05. */
  demonstrated: boolean;
  /** The one-way ANOVA between-family variance component (MS_between - MS_within) / n0 on the OLS-adjusted trait; negative estimates are kept. */
  varianceComponent: number | null;
  /** The sample variance of the family means of the raw trait. */
  rawFamilyMeanVariance: number | null;
  meanTrait: number;
  /** The fraction of fragments at 80% or more of the assay budget (5 trait >= 4 M_ASSAY). */
  saturation: number;
}

/**
 * R1's statistic (`r1Test`: OLS residuals on log1p(retMass) and log1p(retE) over all fragments, ICC(1) with families =
 * donors, `R1_PERMUTATIONS` permutations with the stream `sigma`) on the trait `pick` of `fragments`, with the
 * descriptive between-donor variances and the saturation share.
 */
export function r1PrimeStat(fragments: readonly R1PrimeFragment[], pick: (f: R1PrimeFragment) => number, sigma: number): R1PrimeTraitStat {
  const y = fragments.map(pick);
  const families = fragments.map((f) => f.family);
  const t = r1Test(y, fragments.map((f) => f.retMass), fragments.map((f) => f.retE), families, sigma);
  const adjusted = oneWayAnova(t.resid, families);
  const raw = oneWayAnova(y, families);
  return {
    icc: t.icc,
    p: t.p,
    demonstrated: t.demonstrated,
    varianceComponent: adjusted && (adjusted.msb - adjusted.msw) / adjusted.n0,
    rawFamilyMeanVariance: raw && sampleVariance(raw.means),
    meanTrait: mean(y),
    saturation: y.filter((v) => 5 * v >= 4 * M_ASSAY).length / y.length,
  };
}

/**
 * The replay check of the evolve path (`--replay`): the evidence that the pre-cycle states at boundaries 34 and 67 (t' = 0
 * and 1) were rebuilt faithfully. It is required, not assumed: a replayed history-time is valid only with a replay check
 * whose mechanism check passed and that lists it as valid. t' = 2 (boundary 100, the original b100-pre checkpoint) needs none.
 */
export interface ReplayCheck {
  /** A replay-check.json was given. */
  given: boolean;
  /** `mechanismCheck.passed` is true (and every replay/saved hash pair in it agrees). */
  mechanismPassed: boolean;
  /** Why the mechanism check does not count as passed; null when it does. */
  mechanismWhy: string | null;
  /** History-times (`scaf-i0-t0`) the replay lists as valid. */
  valid: string[];
  /** History-times the replay lists as failed (they win over `valid`). */
  failed: { id: string; why: string | null }[];
}

/** No replay check: no replayed boundary (t' = 0, 1) is valid. */
export const NO_REPLAY_CHECK: ReplayCheck = { given: false, mechanismPassed: false, mechanismWhy: "no replay check was given (--replay)", valid: [], failed: [] };

const REPLAY_ID = /^(scaf|rand)-i[0-5]-t[0-2]$/;

/**
 * Reads a replay-check.json: `{ "mechanismCheck": { "passed": true, "scaf-i0": { "replay": H, "saved": H }, "rand-i0": {...} },
 * "valid": ["scaf-i0-t0", ...], "failed": [{ "id": "scaf-i3-t1", "why": "..." }] }`. The mechanism check counts as passed
 * only if `mechanismCheck.passed === true` and no replay/saved pair in it differs; a missing or false check is
 * recorded (`mechanismPassed` false, with the reason), not thrown, so the stage fails closed. A `failed` entry is an id
 * string or { id, why | reason }. A shape this cannot read throws, so a failure is never silently ignored.
 */
export function parseReplayCheck(json: unknown): ReplayCheck {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error("replay check: want an object { mechanismCheck, valid, failed }");
  const top = json as Record<string, unknown>;
  const mc = top.mechanismCheck;
  let mechanismWhy: string | null = null;
  if (typeof mc !== "object" || mc === null || Array.isArray(mc)) mechanismWhy = "the replay check has no mechanismCheck object";
  else {
    const m = mc as Record<string, unknown>;
    if (m.passed !== true) mechanismWhy = "mechanismCheck.passed is not true";
    else {
      const differ = Object.entries(m)
        .filter(([key, v]) => key !== "passed" && typeof v === "object" && v !== null && ("replay" in v || "saved" in v))
        .filter(([, v]) => typeof (v as Record<string, unknown>).replay !== "string" || (v as Record<string, unknown>).replay !== (v as Record<string, unknown>).saved)
        .map(([key]) => key);
      if (differ.length > 0) mechanismWhy = `mechanismCheck.passed is true but the replay and saved hashes of ${differ.join(", ")} differ or are missing`;
    }
  }
  const ids = (name: string, list: unknown): unknown[] => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new Error(`replay check: ${name} must be an array`);
    return list;
  };
  const valid = ids("valid", top.valid).map((e) => {
    if (typeof e !== "string" || !REPLAY_ID.test(e)) throw new Error(`replay check: unrecognised valid entry ${JSON.stringify(e)} (want e.g. "scaf-i2-t0")`);
    return e;
  });
  const failed = ids("failed", top.failed).map((e): ReplayCheck["failed"][number] => {
    const o = typeof e === "string" ? { id: e } : ((e ?? {}) as Record<string, unknown>);
    if (typeof o.id !== "string" || !REPLAY_ID.test(o.id)) throw new Error(`replay check: unrecognised failed entry ${JSON.stringify(e)} (want "scaf-i2-t0" or { "id": "scaf-i2-t0", "why": "..." })`);
    const why = o.why ?? o.reason;
    return { id: o.id, why: typeof why === "string" ? why : null };
  });
  return { given: true, mechanismPassed: mechanismWhy === null, mechanismWhy, valid, failed };
}

/** One (arm, history, t') of R1': its availability and, when available, its statistic at tau and at the end of the period. */
export interface R1PrimeHistory extends R1PrimeKey {
  /** h = 6 arm + i, the history index that keys the permutation stream r1PrimeSeed(h, t', 8). */
  h: number;
  /** 34, 67 or 100. */
  boundary: number;
  /** false: technically unavailable (no valid set, or the replay check failed), which counts as not demonstrated. */
  available: boolean;
  why: string | null;
  /** Fewer than 2 eligible donors: a valid history that is not demonstrated. */
  insufficient: boolean;
  n: number;
  families: number;
  truncatedRows: number;
  covariates: string[];
  /** The primary statistic: the trait at tau. */
  demonstrated: boolean;
  atTau: R1PrimeTraitStat | null;
  atEnd: R1PrimeTraitStat | null;
}

export interface R1PrimeArm {
  /** The rule at t' = 0: uninformative with fewer than 4 valid histories, else whether at least 4 of 6 are demonstrated at tau. */
  verdict: true | false | "uninformative";
  valid: number;
  demonstrated: number;
  byTime: { tPrime: 0 | 1 | 2; boundary: number; valid: number; demonstratedAtTau: number; demonstratedAtEnd: number; meanSaturationAtTau: number | null; meanSaturationAtEnd: number | null }[];
}

/** Amendment 2's rule on an arm's t' = 0 histories: availability first (fewer than 4 valid is uninformative), then at least 4 of 6 with ICC > 0 and p < 0.05 at tau. */
export function r1PrimeVerdict(histories: readonly R1PrimeHistory[], arm: "scaf" | "rand"): true | false | "uninformative" {
  const at0 = histories.filter((x) => x.arm === arm && x.tPrime === 0);
  if (at0.filter((x) => x.available).length < 4) return "uninformative";
  return at0.filter((x) => x.demonstrated).length >= 4;
}

/**
 * R1' over the screened sets: every (arm, history, t') of `R1_PRIME_KEYS`, with the statistic at tau and at the end of
 * the period for the available ones. A key is unavailable when the replay check lists it as failed; at t' = 0 and 1,
 * unless the replay check's mechanism check passed and lists it as valid (no replay check means none is valid);
 * when it has no set (`rejected` says why when a rejected directory carried its labels); or when its analysis fails.
 * The verdict is `r1PrimeVerdict` for scaf, reported for rand as well.
 */
export function r1PrimeEvaluate(
  sets: readonly R1PrimeSet[],
  replay: ReplayCheck = NO_REPLAY_CHECK,
  rejected: readonly { key: R1PrimeKey | null; reasons: string[] }[] = [],
): { verdict: true | false | "uninformative"; arms: Record<"scaf" | "rand", R1PrimeArm>; histories: R1PrimeHistory[] } {
  const histories = R1_PRIME_KEYS.map((key): R1PrimeHistory => {
    const h = r1PrimeH(key);
    const id = r1PrimeId(key);
    const entry = (o: Partial<R1PrimeHistory>): R1PrimeHistory => ({
      ...key,
      h,
      boundary: R1_PRIME_BOUNDARIES[key.tPrime],
      available: false,
      why: null,
      insufficient: false,
      n: 0,
      families: 0,
      truncatedRows: 0,
      covariates: [],
      demonstrated: false,
      atTau: null,
      atEnd: null,
      ...o,
    });
    const fail = replay.failed.find((f) => f.id === id);
    if (fail) return entry({ why: `replay check failed${fail.why ? `: ${fail.why}` : ""}` });
    // t' = 0 and 1 are replayed states: valid only on the replay's evidence. t' = 2 is the original checkpoint.
    if (key.tPrime < 2) {
      if (!replay.mechanismPassed) return entry({ why: `no replay evidence: ${replay.mechanismWhy ?? "the mechanism check did not pass"}` });
      if (!replay.valid.includes(id)) return entry({ why: "no replay evidence: the replay check does not list it as valid" });
    }
    const set = sets.find((x) => r1PrimeId(x) === id);
    if (!set) {
      const rej = rejected.filter((r) => r.key !== null && r1PrimeId(r.key) === id);
      return entry({ why: rej.length ? `set rejected: ${rej.flatMap((r) => r.reasons).join("; ")}` : "no assay set" });
    }
    try {
      if (set.insufficient || set.fragments.length === 0) return entry({ available: true, insufficient: true });
      const sigma = r1PrimeSeed(h, key.tPrime, 8);
      const atTau = r1PrimeStat(set.fragments, (f) => f.tauTrait, sigma);
      const atEnd = r1PrimeStat(set.fragments, (f) => f.endTrait, sigma);
      return entry({
        available: true,
        n: set.fragments.length,
        families: new Set(set.fragments.map((f) => f.family)).size,
        truncatedRows: set.fragments.filter((f) => f.truncated).length,
        covariates: [...R1_COVARIATES],
        demonstrated: atTau.demonstrated,
        atTau,
        atEnd,
      });
    } catch (e) {
      return entry({ why: `analysis failed: ${(e as Error).message}` });
    }
  });
  const armResult = (arm: "scaf" | "rand"): R1PrimeArm => {
    const at0 = histories.filter((x) => x.arm === arm && x.tPrime === 0);
    const byTime = ([0, 1, 2] as const).map((tPrime) => {
      const hs = histories.filter((x) => x.arm === arm && x.tPrime === tPrime);
      const stats = hs.filter((x) => x.atTau !== null);
      return {
        tPrime,
        boundary: R1_PRIME_BOUNDARIES[tPrime],
        valid: hs.filter((x) => x.available).length,
        demonstratedAtTau: hs.filter((x) => x.demonstrated).length,
        demonstratedAtEnd: hs.filter((x) => x.atEnd?.demonstrated).length,
        meanSaturationAtTau: stats.length ? mean(stats.map((x) => x.atTau!.saturation)) : null,
        meanSaturationAtEnd: stats.length ? mean(stats.map((x) => x.atEnd!.saturation)) : null,
      };
    });
    return { verdict: r1PrimeVerdict(histories, arm), valid: at0.filter((x) => x.available).length, demonstrated: at0.filter((x) => x.demonstrated).length, byTime };
  };
  const arms = { scaf: armResult("scaf"), rand: armResult("rand") };
  return { verdict: arms.scaf.verdict, arms, histories };
}

// ---------------------------------------------------------------------------------------------
// R1'' (docs/scaffold-heredity-replication-v1.md): pond-level heredity on the crossing time, on fresh histories

/** m* = 0.25 ref, the threshold that defined tau: 25,764.5 at ref 103,058. A trait reaches it when 4 trait >= ref (exact). */
export const R1DP_THRESHOLD = TAU_FROZEN.ref / 4;
export const reachesThreshold = (trait: number): boolean => 4 * trait >= TAU_FROZEN.ref;
/** The T of a fragment that never reaches m* within the period: one census past the period (10,100). */
export const R1DP_CENSORED = R1DP_REGIME.period + R1DP_REGIME.censusEvery;
/** The census step whose trait is reported beside the end trait: R1' tau (4,100). */
export const R1DP_TAU = 4100;
/** The boundary the fresh histories are assayed at; a history that ended before it has no pre-cycle state there. */
export const R1DP_BOUNDARY = 34;

/**
 * T of one fragment: the first census step at which its trait is at least m* (`reachesThreshold`), whatever order the
 * (step, trait) pairs come in; `censored` (10,100) when it never is, dead or alive. The R1'' score is log T.
 */
export function crossingTime(series: readonly (readonly [step: number, trait: number])[], censored = R1DP_CENSORED): number {
  let first = Infinity;
  for (const [step, trait] of series) if (step < first && reachesThreshold(trait)) first = step;
  return first === Infinity ? censored : first;
}

/** One fragment of an R1'' set: R1's columns, its crossing time T, the trait at the end of the period and the trait at tau. */
export interface R1dPrimeFragment {
  family: number;
  retMass: number;
  retE: number;
  truncated: boolean;
  T: number;
  endTrait: number;
  /** The trait at tau = 4,100; null when 4,100 is not a census step (a smoke run's shorter period). */
  tauTrait: number | null;
}

/** A screened R1'' set, by h: fragments in R1's order (replicate 0's f = 0..63, then replicate 1's). */
export interface R1dPrimeSet {
  h: number;
  /** Fewer than 2 eligible donors (a biological outcome: no fragments). */
  insufficient: boolean;
  /** The T of a fragment that never reached m*: one census past this set's period. */
  censored: number;
  fragments: R1dPrimeFragment[];
  /** The source provenance and protocol hash the assay recorded (null when it recorded none: a smoke set). */
  provenance: R1dPrimeProvenance | null;
  protocolSha256R1dp: string | null;
}

/** The `labels` of an R1'' directory (consistent with its h), or why it has none. */
function r1dPrimeLabelsOfJson(json: Record<string, unknown>): { labels: R1dPrimeLabelSet } | { error: string } {
  const l = (json.labels ?? {}) as Record<string, unknown>;
  if (l.r1dprime !== true) return { error: "labels.r1dprime is not true" };
  const h = l.h;
  if (!Number.isInteger(h) || (h as number) < 0 || (h as number) >= R1DP_SETS) return { error: `labels.h ${JSON.stringify(h)}, want 0-${R1DP_SETS - 1}` };
  const want = r1dPrimeLabelsOf(h as number);
  for (const key of ["arm", "history", "control"] as const) {
    if (l[key] !== want[key]) return { error: `labels.${key} ${JSON.stringify(l[key])}, want ${JSON.stringify(want[key])} for h ${h}` };
  }
  return { labels: want };
}

/** The h an assay.json is labelled with, or null when it is not an R1'' set's. */
export function r1dPrimeHOf(json: Record<string, unknown>): number | null {
  const lab = r1dPrimeLabelsOfJson(json);
  return "error" in lab ? null : lab.labels.h;
}

const isHex64 = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);

/** The provenance an assay.json records, with every field of the right type; null otherwise. */
function r1dPrimeProvenanceOf(x: unknown): R1dPrimeProvenance | null {
  if (typeof x !== "object" || x === null) return null;
  const p = x as Record<string, unknown>;
  const ints = ["seed", "mutRate", "step", "tilesX", "tilesY", "distinctGenomes"] as const;
  if (typeof p.source !== "string" || typeof p.stateHash !== "string" || ints.some((k) => !Number.isInteger(p[k]))) return null;
  // The phase check (pre- or post-cycle) with every measure of the right type.
  const ph = p.phase as Record<string, unknown> | null | undefined;
  if (typeof ph !== "object" || ph === null || typeof ph.postCycle !== "boolean" || (["totalC", "totalS", "carrying", "outsideWindow"] as const).some((k) => !Number.isInteger(ph[k]))) return null;
  return p as unknown as R1dPrimeProvenance;
}

/**
 * The crossing-time fragments of a transmission set with traits.tsv, in R1's order (replicate 0's f = 0..63, then replicate 1's): its
 * traits.tsv is checked first (`traitsProblems`, onto `why`), and only while `why` is still empty is every fragment's T, trait at the
 * end of the period and trait at tau read. A fragment short of a census step, or whose end trait is not assay.tsv's, adds a reason, as
 * does (strict) a set whose census steps do not include tau. `censored` is one census past the set's period. R1'' and the
 * registration's S3 read their sets through it.
 */
function crossingFragments(json: Record<string, unknown>, rows: readonly AssayRow[], traits: TraitsRead | null, why: string[], strict: boolean): { fragments: R1dPrimeFragment[]; censored: number } {
  why.push(...traitsProblems(json, rows.length, traits));
  const frag = rows.filter((r) => r.inoculum === "fragment").sort((a, b) => a.replicate - b.replicate || a.pond - b.pond);
  const fragments: R1dPrimeFragment[] = [];
  const period = json.period as number;
  const censored = (Number.isInteger(period) ? period : 0) + (Number.isInteger(json.censusEvery) ? (json.censusEvery as number) : 0);
  if (why.length === 0 && frag.length > 0) {
    // Every census step of every fragment, grouped by (replicate, pond): its crossing time and its traits at tau and at the end.
    const series = new Map<string, [number, number][]>();
    for (const [step, list] of traits!.rows) {
      for (const t of list) {
        const id = `${t.replicate}:${t.pond}`;
        const s = series.get(id);
        if (s) s.push([step, t.trait]);
        else series.set(id, [[step, t.trait]]);
      }
    }
    let off = 0;
    for (const r of frag) {
      const s = series.get(`${r.replicate}:${r.pond}`);
      const end = s?.find(([step]) => step === period);
      // One row per census step: a fragment short of a step, or whose end trait is not assay.tsv's, is off.
      if (s === undefined || s.length !== traits!.counts.size || end === undefined || end[1] !== r.endTrait) {
        off++;
        continue;
      }
      const atTau = s.find(([step]) => step === R1DP_TAU);
      fragments.push({ family: r.family, retMass: r.retMass, retE: r.retE!, truncated: (r.truncated ?? 0) > 0, T: crossingTime(s, censored), endTrait: r.endTrait, tauTrait: atTau ? atTau[1] : null });
    }
    if (off > 0) why.push(`traits.tsv disagrees with assay.tsv for ${off} fragments (a census step missing, or an end trait other than the one at step ${period})`);
    else if (strict && fragments.some((f) => f.tauTrait === null)) why.push(`tau ${R1DP_TAU} is not a census step of traits.tsv`);
  }
  return { fragments, censored };
}

/**
 * Screens R1'' directories (transmission sets labelled `r1dprime`) before the stage pools them. A set is rejected, with its
 * reasons, unless it is 64 ponds x 2 replicates (side 8; no rows when `insufficient`) whose assay.tsv fills the (replicate, pond)
 * grid exactly once and carries retE, at the frozen regime (k 8, period 10,000, census every 100; and `regimes` when given), with
 * replicate s seeded r1dPrimeSeed(h, s) for its labels, donors drawn with s = 9, a source provenance that is the protocol's for
 * its labels (`r1dPrimeSourceProblems`: the pre-cycle checkpoint's name, seed, step, mutation rate, genomes and recorded phase check)
 * and the protocol's SHA-256 recorded; its traits.tsv must fill the same grid exactly once
 * at every census step (100..period) and agree with assay.tsv's end trait at the last. Two sets with one h are both rejected (a
 * stage would count both). Nothing here throws for one bad set: it is rejected with its h, so the stage can mark it unavailable.
 * `allowAnySeed` (smoke runs) waives the side, replicate, regime, seed, provenance and hash checks and holds the set to the grid
 * assay.json declares. An accepted set carries its fragments with T, the trait at the end of the period and the trait at tau.
 */
export function r1dPrimeScreen(
  dirs: readonly TraitSetDir[],
  o: { regimes: readonly AssayRegime[] | null; allowAnySeed?: boolean },
): { accepted: (R1dPrimeSet & { dir: string })[]; rejected: { dir: string; h: number | null; reasons: string[] }[]; regime: AssayRegime | null } {
  const strict = !o.allowAnySeed;
  const candidates: (R1dPrimeSet & { dir: string; k: unknown; period: unknown })[] = [];
  const rejected: { dir: string; h: number | null; reasons: string[] }[] = [];
  for (const d of dirs) {
    const { json, rows, traits } = d;
    const lab = r1dPrimeLabelsOfJson(json);
    if ("error" in lab) {
      rejected.push({ dir: d.dir, h: null, reasons: [lab.error] });
      continue;
    }
    const labels = lab.labels;
    const h = labels.h;
    const insufficient = json.insufficient === true;
    const why: string[] = [];
    if (json.assay !== "transmission") why.push(`assay ${JSON.stringify(json.assay)}, want transmission`);
    const grid = gridFor(json, strict);
    if (insufficient) {
      if (rows.length !== 0) why.push(`${rows.length} rows, want 0 (fewer than 2 eligible donors)`);
    } else if (grid === null) why.push("assay.json has no side and replicates");
    else {
      if (rows.length !== grid.replicates * grid.ponds) why.push(`${rows.length} rows, want ${grid.replicates * grid.ponds}`);
      why.push(...rowsProblems(rows, grid));
    }
    if (rows.some((r) => r.retE === null)) why.push("assay.tsv has no retE column, so the protocol's covariate is missing; re-run the transmission assay");
    const provenance = r1dPrimeProvenanceOf(json.provenance);
    if (strict) {
      for (const key of ["side", "replicates", "censusEvery", "k", "period"] as const) if (json[key] !== R1DP_REGIME[key]) why.push(`${key} ${JSON.stringify(json[key])}, want ${R1DP_REGIME[key]}`);
      if (o.regimes !== null && !o.regimes.some((r) => r.k === json.k && r.period === json.period)) why.push(`regime k ${json.k} period ${json.period}, want ${o.regimes.map((r) => `k ${r.k} period ${r.period}`).join(" or ")}`);
      if (json.inoculum !== undefined && json.inoculum !== "fragment") why.push(`inoculum ${JSON.stringify(json.inoculum)}, want fragment`);
      const seeds = json.seeds as { physics?: unknown; fragment?: unknown }[] | undefined;
      if (!Array.isArray(seeds) || seeds.length !== R1DP_REGIME.replicates) why.push(`assay.json has ${Array.isArray(seeds) ? seeds.length : "no"} seeds, want ${R1DP_REGIME.replicates} {physics, fragment}`);
      else {
        try {
          seeds.forEach((sd, s) => {
            if (typeof sd?.physics !== "number" || typeof sd.fragment !== "number") throw new Error(`assay.json seeds[${s}] is not {physics, fragment}`);
            checkR1dPrimeSeeds(labels, { physics: sd.physics, fragment: sd.fragment }, s);
          });
          if (typeof json.donorSeed !== "number") throw new Error("assay.json has no donorSeed");
          checkR1dPrimeDonorSeed(labels, json.donorSeed);
        } catch (e) {
          why.push((e as Error).message);
        }
      }
      if (provenance === null) why.push("assay.json has no provenance of the source checkpoint with its phase check (run the assay with --r1dprime)");
      else {
        why.push(...r1dPrimeSourceProblems(labels, provenance));
        if (provenance.source !== json.source) why.push(`provenance.source ${JSON.stringify(provenance.source)} is not the assay's source ${JSON.stringify(json.source)}`);
      }
      if (!isHex64(json.protocolSha256R1dp)) why.push("assay.json has no protocolSha256R1dp");
    }
    const { fragments, censored } = crossingFragments(json, rows, traits, why, strict);
    if (why.length > 0) rejected.push({ dir: d.dir, h, reasons: why });
    else candidates.push({ dir: d.dir, h, insufficient, censored, fragments, provenance, protocolSha256R1dp: isHex64(json.protocolSha256R1dp) ? json.protocolSha256R1dp : null, k: json.k, period: json.period });
  }
  // Two sets for one h are ambiguous: neither is used, and the set is unavailable.
  const accepted: (R1dPrimeSet & { dir: string })[] = [];
  const regimesSeen: AssayRegime[] = [];
  for (const c of candidates) {
    const same = candidates.filter((x) => x.h === c.h);
    if (same.length > 1) {
      rejected.push({ dir: c.dir, h: c.h, reasons: [`the same R1'' set (${r1dPrimeIdOf(r1dPrimeLabelsOf(c.h))}) as ${same.filter((x) => x !== c).map((x) => x.dir).join(", ")}; a stage would count both`] });
      continue;
    }
    if (typeof c.k === "number" && typeof c.period === "number") regimesSeen.push({ k: c.k, period: c.period });
    const { k: _k, period: _period, ...set } = c;
    accepted.push(set);
  }
  let regime: AssayRegime | null = o.regimes?.length === 1 ? o.regimes[0] : null;
  if (o.regimes === null) {
    for (const r of regimesSeen) {
      if (regime === null) regime = r;
      else if (regime.k !== r.k || regime.period !== r.period) throw new Error(`R1'' sets mix regimes (k ${regime.k} period ${regime.period} and k ${r.k} period ${r.period}); pass --regime K PERIOD`);
    }
  }
  return { accepted, rejected, regime };
}

/**
 * Why a set's scores cannot carry R1''s test: "constant score" (every score is the same value, compared exactly) or "negligible
 * residual variance" (the OLS residuals are at roundoff level: their sum of squares is at most `R1DP_DEGENERATE_RELATIVE` of the
 * scores' total sum of squares about their mean, or at most `R1DP_DEGENERATE_ABSOLUTE`). The ICC of such residuals is a ratio of
 * roundoff errors, which can look like heredity (ICC near 1, p = 1/1001) in 128 fragments that all crossed at one T.
 */
export type R1dPrimeDegeneracy = "constant score" | "negligible residual variance";
export const R1DP_DEGENERATE_RELATIVE = 1e-9;
export const R1DP_DEGENERATE_ABSOLUTE = 1e-12;

/**
 * Whether the scores `values` (compared exactly, so the integer T of every fragment) with OLS residuals `resid` are degenerate,
 * and why. `scores` are the values the OLS was fitted to when they are a transform of `values` (log T); the total sum of squares
 * is theirs, about their mean. null for scores that vary and leave residual variance.
 */
export function r1dPrimeDegeneracy(values: readonly number[], resid: readonly number[], scores: readonly number[] = values): R1dPrimeDegeneracy | null {
  if (values.length > 0 && values.every((v) => v === values[0])) return "constant score";
  const m = mean(scores);
  const sst = scores.reduce((a, v) => a + (v - m) * (v - m), 0);
  const rss = resid.reduce((a, r) => a + r * r, 0);
  return rss <= R1DP_DEGENERATE_ABSOLUTE || rss <= R1DP_DEGENERATE_RELATIVE * sst ? "negligible residual variance" : null;
}

/** R1's statistic on a set's log T, with the descriptive between-donor variances. */
export interface R1dPrimeStat {
  icc: number | null;
  p: number | null;
  /** ICC above 0 with p < 0.05. */
  demonstrated: boolean;
  /** Set when the scores are degenerate: the test is not run, and the set has ICC 0, p 1 and is not demonstrated. */
  degenerate: R1dPrimeDegeneracy | null;
  /** The one-way ANOVA between-family variance component (MS_between - MS_within) / n0 on the OLS-adjusted log T; negative estimates are kept (0 when degenerate). */
  varianceComponent: number | null;
  /** The sample variance of the family means of the raw log T. */
  rawFamilyMeanVariance: number | null;
  meanLogT: number;
}

/**
 * R1's statistic (`r1Test`, unchanged: OLS residuals on log1p(retMass) and log1p(retE) over all fragments, ICC(1) with families
 * = donors, `R1_PERMUTATIONS` permutations with the stream `sigma`) on each fragment's log T, except that degenerate scores
 * (`r1dPrimeDegeneracy`) are not tested: ICC 0, p 1, not demonstrated, with the reason in `degenerate`.
 */
export function r1dPrimeStat(fragments: readonly R1dPrimeFragment[], sigma: number): R1dPrimeStat {
  const y = fragments.map((f) => Math.log(f.T));
  const families = fragments.map((f) => f.family);
  const retMass = fragments.map((f) => f.retMass);
  const retE = fragments.map((f) => f.retE);
  // The fit r1Test makes, to see whether anything but roundoff is left of the scores before testing it.
  const degenerate = r1dPrimeDegeneracy(fragments.map((f) => f.T), olsResiduals(y, [retMass.map((m) => Math.log1p(m)), retE.map((e) => Math.log1p(e))]), y);
  const raw = oneWayAnova(y, families);
  if (degenerate !== null) return { icc: 0, p: 1, demonstrated: false, degenerate, varianceComponent: 0, rawFamilyMeanVariance: degenerate === "constant score" ? 0 : raw && sampleVariance(raw.means), meanLogT: mean(y) };
  const t = r1Test(y, retMass, retE, families, sigma);
  const adjusted = oneWayAnova(t.resid, families);
  return {
    icc: t.icc,
    p: t.p,
    demonstrated: t.demonstrated,
    degenerate: null,
    varianceComponent: adjusted && (adjusted.msb - adjusted.msw) / adjusted.n0,
    rawFamilyMeanVariance: raw && sampleVariance(raw.means),
    meanLogT: mean(y),
  };
}

/** `r1PrimeStat` with the same guard (`r1dPrimeDegeneracy` on the trait itself): R1''s end-trait and tau-trait columns are not read off roundoff either. */
export interface R1dPrimeTraitStat extends R1PrimeTraitStat {
  degenerate: R1dPrimeDegeneracy | null;
}

function r1dPrimeTraitStat(fragments: readonly R1PrimeFragment[], pick: (f: R1PrimeFragment) => number, sigma: number): R1dPrimeTraitStat {
  const y = fragments.map(pick);
  const degenerate = r1dPrimeDegeneracy(y, olsResiduals(y, [fragments.map((f) => Math.log1p(f.retMass)), fragments.map((f) => Math.log1p(f.retE))]));
  const st = r1PrimeStat(fragments, pick, sigma);
  return degenerate === null ? { ...st, degenerate } : { ...st, icc: 0, p: 1, demonstrated: false, varianceComponent: 0, degenerate };
}

/** A fresh history's run directory, as the report reads it for the extinction rule: whether and when its history ended. */
export interface R1dPrimeRun {
  arm: "scaf" | "rand";
  history: number;
  dir: string;
  status: RunStatus;
  /** done.json says the history ended (no pond survived); `endedAt` is that cycle. */
  ended: boolean;
  endedAt: number | null;
}

/**
 * The (arm, history index) of a fresh-history run directory from its meta.json, or why it is not one: arm scaf or rand, seed
 * 4,811,001 + 100 arm + i (i = 0-5), side 8, ancestor clone, mutation on, k 8, period 10,000 and 34 cycles.
 */
export function r1dPrimeRunOf(meta: Record<string, unknown>): { key: { arm: "scaf" | "rand"; history: number } | null; why: string[] } {
  const why: string[] = [];
  const arm = meta.arm;
  const armIdx = arm === "scaf" ? 0 : arm === "rand" ? 1 : -1;
  if (armIdx < 0) why.push(`arm ${JSON.stringify(arm)}, want scaf or rand`);
  const i = typeof meta.seed === "number" ? meta.seed - R1DP_HISTORY_SEED_BASE - 100 * armIdx : NaN;
  if (armIdx >= 0 && !(Number.isInteger(i) && i >= 0 && i < 6)) why.push(`seed ${JSON.stringify(meta.seed)} is not ${R1DP_HISTORY_SEED_BASE} + 100 arm + i, i = 0-5, for arm ${arm}`);
  if (meta.side !== R1DP_REGIME.side) why.push(`side ${JSON.stringify(meta.side)}, want ${R1DP_REGIME.side}`);
  if (meta.init !== "clone") why.push(`init ${JSON.stringify(meta.init)}, want "clone"`);
  if (!(typeof meta.mutRate === "number" && meta.mutRate > 0)) why.push("mutation off");
  if (meta.k !== R1DP_REGIME.k) why.push(`k ${JSON.stringify(meta.k)}, want ${R1DP_REGIME.k}`);
  if (meta.period !== R1DP_REGIME.period) why.push(`period ${JSON.stringify(meta.period)}, want ${R1DP_REGIME.period}`);
  if (meta.cycles !== R1DP_BOUNDARY) why.push(`cycles ${JSON.stringify(meta.cycles)}, want ${R1DP_BOUNDARY}`);
  return { key: why.length === 0 ? { arm: arm as "scaf" | "rand", history: i } : null, why };
}

/**
 * One of the 18 R1'' sets. `outcome` is "analysed" (a screened set whose statistic completed), "ended" (the run ended before
 * boundary 34, so no pre-cycle state exists: biological), "donors" (fewer than 2 eligible donors: biological) or "unavailable"
 * (no set, a rejected or unreadable one, or an analysis that failed: technical). A set is `valid` unless it is unavailable, and
 * only an analysed one can be demonstrated.
 */
export interface R1dPrimeEntry {
  h: number;
  id: string;
  arm: "scaf" | "rand" | "control";
  control: "positive" | "negative" | null;
  /** The history index i, or the control world. */
  history: number;
  outcome: "analysed" | "ended" | "donors" | "unavailable";
  valid: boolean;
  why: string | null;
  n: number;
  families: number;
  truncatedRows: number;
  covariates: string[];
  icc: number | null;
  p: number | null;
  /** ICC above 0 with p < 0.05. */
  demonstrated: boolean;
  /** Scores that cannot carry the test (see `r1dPrimeDegeneracy`): ICC 0, p 1, not demonstrated. */
  degenerate: R1dPrimeDegeneracy | null;
}

/** What a control must show: a positive one ICC above 0 with p < 0.05 (`demonstrated`), a negative one p below 0.05 for at most 1 of 4 (`significant`). */
export interface R1dPrimeControl extends Pick<R1dPrimeEntry, "h" | "id" | "outcome" | "why" | "n" | "families" | "icc" | "p" | "demonstrated" | "degenerate"> {
  /** The control world: positive s = 0-1, negative j = 0-3. */
  world: number;
  /** A test result exists: not a set with fewer than 2 donors, and not one whose scores are degenerate (it could not have shown anything). */
  tested: boolean;
  /** p < 0.05. */
  significant: boolean;
}

export interface R1dPrimeArm {
  /** The rule's outcome for the arm alone, availability first (fewer than 4 valid is uninformative); the controls apply to the stage's verdict, not here. */
  verdict: true | false | "uninformative";
  valid: number;
  demonstrated: number;
  /** Histories whose run ended before boundary 34, those with fewer than 2 donors, and the technically unavailable ones. */
  ended: number;
  donors: number;
  unavailable: number;
}

/** Descriptive, never a decision input: one set's endpoint fractions, its trait at the end and at tau, and its donor variances. */
export interface R1dPrimeDescriptive {
  h: number;
  id: string;
  n: number;
  /** The fractions of fragments at T = 100 (reached m* by the first census) and at T = 10,100 (never did). */
  fractionAt100: number;
  fractionCensored: number;
  /** R1's statistic on the end trait and on the trait at tau = 4,100 (null when 4,100 is not a census step), as R1' reported them. */
  atEnd: R1dPrimeTraitStat;
  atTau: R1dPrimeTraitStat | null;
  varianceComponent: number | null;
  rawFamilyMeanVariance: number | null;
  meanLogT: number;
  /** Fragments whose pond has no trait (B+P over cells with B+P >= 48) at the end of the period. */
  extinctFragments: number;
}

/** An entry that is not demonstrated: no statistic, with the outcome and why. */
const r1dPrimeEntryOf = (e: Pick<R1dPrimeEntry, "h" | "id" | "arm" | "control" | "history">, outcome: R1dPrimeEntry["outcome"], why: string | null): R1dPrimeEntry => ({
  ...e,
  outcome,
  valid: outcome !== "unavailable",
  why,
  n: 0,
  families: 0,
  truncatedRows: 0,
  covariates: [],
  icc: null,
  p: null,
  demonstrated: false,
  degenerate: null,
});

/** What R1'' computes for one set: R1's statistic on log T, and the descriptive columns (those of `R1dPrimeDescriptive` but its h and id). */
export interface R1dPrimeAnalysis {
  stat: R1dPrimeStat;
  descriptive: Omit<R1dPrimeDescriptive, "h" | "id">;
}

const analysisOf = new WeakMap<R1dPrimeSet, R1dPrimeAnalysis>();

/**
 * The analysis of `set` with the permutation stream r1dPrimeSeed(h, 8): `r1dPrimeStat` on log T, and the same statistic on the end
 * trait and on the trait at tau, as R1' read them. Kept per set object (a screened set is never changed), since three traits' 1,000
 * permutations are most of the work of the stage.
 */
export function r1dPrimeAnalyse(set: R1dPrimeSet): R1dPrimeAnalysis {
  let a = analysisOf.get(set);
  if (a) return a;
  const sigma = r1dPrimeSeed(set.h, 8);
  const frags = set.fragments;
  const stat = r1dPrimeStat(frags, sigma);
  // The end trait and the trait at tau go through R1's statistic as R1' did (R1PrimeFragment carries both).
  const asPrime = (trait: (f: R1dPrimeFragment) => number): R1PrimeFragment[] => frags.map((f) => ({ family: f.family, retMass: f.retMass, retE: f.retE, truncated: f.truncated, endTrait: f.endTrait, tauTrait: trait(f) }));
  a = {
    stat,
    descriptive: {
      n: frags.length,
      fractionAt100: frags.filter((f) => f.T === R1DP_REGIME.censusEvery).length / frags.length,
      fractionCensored: frags.filter((f) => f.T === set.censored).length / frags.length,
      atEnd: r1dPrimeTraitStat(asPrime((f) => f.endTrait), (f) => f.endTrait, sigma),
      atTau: frags.every((f) => f.tauTrait !== null) ? r1dPrimeTraitStat(asPrime((f) => f.tauTrait!), (f) => f.tauTrait, sigma) : null,
      varianceComponent: stat.varianceComponent,
      rawFamilyMeanVariance: stat.rawFamilyMeanVariance,
      meanLogT: stat.meanLogT,
      extinctFragments: frags.filter((f) => f.endTrait === 0).length,
    },
  };
  analysisOf.set(set, a);
  return a;
}

/** The rule on an arm's six fresh histories: availability first (fewer than 4 valid is uninformative), then at least 4 of 6 with ICC > 0 and p < 0.05. */
export function r1dPrimeVerdict(entries: readonly R1dPrimeEntry[], arm: "scaf" | "rand"): true | false | "uninformative" {
  const hs = entries.filter((x) => x.arm === arm);
  if (hs.filter((x) => x.valid).length < 4) return "uninformative";
  return hs.filter((x) => x.demonstrated).length >= 4;
}

/**
 * R1'' over the screened sets, in the protocol's order. 1. Controls: both positive-control worlds (h 12, 13) must show ICC > 0
 * with p < 0.05, and at most 1 of the 4 negative-control worlds (h 14-17) may have p < 0.05, every one of them tested (a missing
 * negative, one with fewer than 2 donors, or one with degenerate scores leaves the gate unmet); otherwise the verdict is "uninformative". 2. Availability: a fresh history is
 * valid if its set was analysed, or if it is a biological outcome (`runs` says it ended before boundary 34, or it has fewer
 * than 2 donors); a missing, rejected or failed set is unavailable and counts as not demonstrated; fewer than 4 valid scaf
 * histories is "uninformative". 3. At least 4 of 6 scaf histories demonstrated (a set with degenerate scores, `r1dPrimeDegeneracy`, is analysed but has ICC 0, p 1, and is not). The statistic is `r1dPrimeStat` with the stream
 * r1dPrimeSeed(h, 8); rand is reported with the same one (`arms.rand`, no decision). `runs` is null without --runs.
 */
export function r1dPrimeEvaluate(
  sets: readonly R1dPrimeSet[],
  runs: readonly R1dPrimeRun[] | null = null,
  rejected: readonly { h: number | null; reasons: string[] }[] = [],
): {
  verdict: true | false | "uninformative";
  controls: { positive: R1dPrimeControl[]; negative: R1dPrimeControl[]; nullGatePassed: boolean; positivePassed: boolean };
  arms: Record<"scaf" | "rand", R1dPrimeArm>;
  histories: R1dPrimeEntry[];
  descriptive: { sets: R1dPrimeDescriptive[]; extinction: Record<"scaf" | "rand", { histories: number; ended: number; donors: number; fragments: number; extinctFragments: number }> };
} {
  const descriptive: R1dPrimeDescriptive[] = [];
  const all = Array.from({ length: R1DP_SETS }, (_, h): R1dPrimeEntry => {
    const l = r1dPrimeLabelsOf(h);
    const e = { h, id: r1dPrimeIdOf(l), arm: l.arm, control: l.control ?? null, history: l.history };
    const run = l.arm === "control" ? undefined : runs?.find((r) => r.arm === l.arm && r.history === l.history);
    if (run?.ended && run.endedAt !== null && run.endedAt < R1DP_BOUNDARY) return r1dPrimeEntryOf(e, "ended", `the run ended at cycle ${run.endedAt}, before boundary ${R1DP_BOUNDARY}: no pre-cycle state to assay`);
    const set = sets.find((x) => x.h === h);
    if (!set) {
      const rej = rejected.filter((r) => r.h === h);
      return r1dPrimeEntryOf(e, "unavailable", rej.length ? `set rejected: ${rej.flatMap((r) => r.reasons).join("; ")}` : run && run.status !== "finished" ? `no assay set (the run is ${run.status})` : "no assay set");
    }
    try {
      if (set.insufficient || set.fragments.length === 0) return r1dPrimeEntryOf(e, "donors", "fewer than 2 eligible donors");
      const { stat, descriptive: d } = r1dPrimeAnalyse(set);
      descriptive.push({ h, id: e.id, ...d });
      const frags = set.fragments;
      return { ...r1dPrimeEntryOf(e, "analysed", null), n: frags.length, families: new Set(frags.map((f) => f.family)).size, truncatedRows: frags.filter((f) => f.truncated).length, covariates: [...R1_COVARIATES], icc: stat.icc, p: stat.p, demonstrated: stat.demonstrated, degenerate: stat.degenerate };
    } catch (err) {
      return r1dPrimeEntryOf(e, "unavailable", `analysis failed: ${(err as Error).message}`);
    }
  });
  const histories = all.filter((x) => x.arm !== "control");
  const control = (kind: "positive" | "negative"): R1dPrimeControl[] =>
    all
      .filter((x) => x.control === kind)
      .map(({ h, id, history, outcome, why, n, families, icc, p, demonstrated, degenerate }) => ({ h, id, outcome, why, n, families, icc, p, demonstrated, degenerate, world: history, tested: icc !== null && degenerate === null, significant: p !== null && p < R1_ALPHA }));
  const positive = control("positive");
  const negative = control("negative");
  const positivePassed = positive.every((c) => c.demonstrated);
  const nullGatePassed = negative.every((c) => c.tested) && negative.filter((c) => c.significant).length <= 1;
  const armResult = (arm: "scaf" | "rand"): R1dPrimeArm => {
    const hs = histories.filter((x) => x.arm === arm);
    return {
      verdict: r1dPrimeVerdict(histories, arm),
      valid: hs.filter((x) => x.valid).length,
      demonstrated: hs.filter((x) => x.demonstrated).length,
      ended: hs.filter((x) => x.outcome === "ended").length,
      donors: hs.filter((x) => x.outcome === "donors").length,
      unavailable: hs.filter((x) => x.outcome === "unavailable").length,
    };
  };
  const arms = { scaf: armResult("scaf"), rand: armResult("rand") };
  const extinction = (arm: "scaf" | "rand") => {
    const ds = descriptive.filter((d) => histories.some((x) => x.h === d.h && x.arm === arm));
    return { histories: 6, ended: arms[arm].ended, donors: arms[arm].donors, fragments: ds.reduce((a, d) => a + d.n, 0), extinctFragments: ds.reduce((a, d) => a + d.extinctFragments, 0) };
  };
  return {
    verdict: positivePassed && nullGatePassed ? arms.scaf.verdict : "uninformative",
    controls: { positive, negative, nullGatePassed, positivePassed },
    arms,
    histories,
    descriptive: { sets: descriptive.sort((x, y) => x.h - y.h), extinction: { scaf: extinction("scaf"), rand: extinction("rand") } },
  };
}

// ---------------------------------------------------------------------------------------------
// R2: adaptation

export interface R2History {
  arm: "scaf" | "rand";
  history: number;
  /** Mean end trait per time on the standardised (disc) and raw (fragment) inoculum; null if absent. */
  standardised: { t0: number | null; tC: number | null; gain: number | null };
  raw: { t0: number | null; tC: number | null; gain: number | null };
}

/**
 * R2: gain of a history = mean end trait from time C's inoculum minus time 0's, on the standardised
 * (dominant-genome disc) inoculum. Genome-level adaptation beyond the bottleneck is shown if scaf's gain is
 * above 0 in at least 4 of 6 histories and the median scaf gain exceeds the median rand gain.
 */
export function r2Evaluate(sets: readonly AssaySet[]): {
  histories: R2History[];
  medianGain: { scaf: number | null; rand: number | null };
  scafPositive: number;
  shown: boolean;
} {
  const meanOf = (arm: "scaf" | "rand", history: number, time: 0 | 1, inoculum: string): number | null => {
    const xs = sets
      .filter((s) => s.labels.arm === arm && s.labels.history === history && s.labels.time === time)
      .flatMap((s) => s.rows.filter((r) => r.inoculum === inoculum).map((r) => r.endTrait));
    return xs.length ? mean(xs) : null;
  };
  const gainOf = (arm: "scaf" | "rand", history: number, inoculum: string) => {
    const t0 = meanOf(arm, history, 0, inoculum);
    const tC = meanOf(arm, history, 1, inoculum);
    return { t0, tC, gain: t0 !== null && tC !== null ? tC - t0 : null };
  };
  const histories: R2History[] = [];
  for (const arm of ["scaf", "rand"] as const) {
    for (let history = 0; history < 6; history++) histories.push({ arm, history, standardised: gainOf(arm, history, "disc"), raw: gainOf(arm, history, "fragment") });
  }
  const gains = (arm: "scaf" | "rand") => histories.filter((x) => x.arm === arm && x.standardised.gain !== null).map((x) => x.standardised.gain!);
  const scafGains = gains("scaf");
  const randGains = gains("rand");
  const medianGain = { scaf: scafGains.length ? median(scafGains) : null, rand: randGains.length ? median(randGains) : null };
  const scafPositive = scafGains.filter((g) => g > 0).length;
  const shown = scafPositive >= 4 && medianGain.scaf !== null && medianGain.rand !== null && medianGain.scaf > medianGain.rand;
  return { histories, medianGain, scafPositive, shown };
}

// ---------------------------------------------------------------------------------------------
// R3: removal

export const R3_QUENCH_LIMIT = 0.05;

export interface R3Timing {
  /** Competence of scaf_i, rand_i, cont_i and the ancestor at this timing (null when the source is absent). */
  scaf: number | null;
  rand: number | null;
  cont: number | null;
  ancestor: number | null;
  /** adv_i(X) = competence(scaf_i) - competence(X). */
  advRand: number | null;
  advCont: number | null;
  advAncestor: number | null;
  /** Every advantage is defined and above 0. */
  allPositive: boolean;
}

export interface R3History {
  history: number;
  a: R3Timing;
  b: R3Timing;
  /** Advantages positive against every X at both timings. */
  advantage: boolean;
  /** Competence of scaf_i's quenched control at each timing (null when absent). */
  quenched: { a: number | null; b: number | null };
  /** Ge-on-Fa (swap-ea rows of scaf_i at (a)) and Ga-on-Fe (swap-ae rows) competences. */
  swapEa: number | null;
  swapAe: number | null;
  /** competence(Ge-on-Fa_i) - competence(ancestor) >= 0.5 adv_i(ancestor) at timing (a). */
  swapCriterion: boolean;
  /** Every source, swap arm and scaf quenched control this history needs is present. */
  complete: boolean;
  /** The advantage / swap criterion could still be met: met, or with a missing input and no failed one. */
  advantageOpen: boolean;
  swapOpen: boolean;
}

/**
 * R3 over competence assays. Each set is one source world (`arm`, `history`, `timing`); its rows carry the
 * inoculum variants: `fragment` (competence of the source), and for scaf sources `swap-ea` (Ge-on-Fa, ancestor
 * fragments carrying the history's dominant genome), `swap-ae` (Ga-on-Fe) and `quenched`.
 *
 * Decisive if adv_i(X) > 0 for every X in {rand_i, cont_i, ancestor} at both timings in at least 4 of 6
 * histories, and Ge-on-Fa_i - ancestor >= 0.5 adv_i(ancestor) at timing (a) in at least 4 of 6. If any scaf
 * source's quenched competence exceeds 0.05, or no quenched control is present, R3 is unreliable and never
 * decisive.
 */
export function r3Evaluate(sets: readonly AssaySet[]): {
  histories: R3History[];
  advantageHistories: number;
  swapHistories: number;
  quenched: { n: number; max: number | null; mean: number | null; unreliable: boolean };
  decisive: boolean;
  /** Every source (scaf, rand, cont at both timings, the ancestor), swap arm and scaf quenched control is present. */
  complete: boolean;
  /** Histories that still could meet the advantage / swap criterion: met, or with a missing input and no failed one. */
  advantagePossible: number;
  swapPossible: number;
  unmatched: { source: string; retMass: Dist; retE: Dist }[];
} {
  const find = (arm: AssayArm, history: number, timing: "a" | "b") =>
    sets.filter((s) => s.labels.arm === arm && s.labels.history === history && s.labels.timing === timing);
  const comp = (arm: AssayArm, history: number, timing: "a" | "b", inoculum = "fragment"): number | null => {
    const rows = find(arm, history, timing).flatMap((s) => s.rows.filter((r) => r.inoculum === inoculum).map((r) => ({ r, ref: s.labels.ref })));
    if (rows.length === 0) return null;
    return rows.filter(({ r, ref }) => rowSuccess(r, ref)).length / rows.length;
  };
  const diff = (x: number | null, y: number | null) => (x === null || y === null ? null : x - y);
  const timingOf = (history: number, timing: "a" | "b"): R3Timing => {
    const scaf = comp("scaf", history, timing);
    const rand = comp("rand", history, timing);
    const cont = comp("cont", history, timing);
    const ancestor = comp("ancestor", -1, timing);
    const advRand = diff(scaf, rand);
    const advCont = diff(scaf, cont);
    const advAncestor = diff(scaf, ancestor);
    const allPositive = [advRand, advCont, advAncestor].every((x) => x !== null && x > 0);
    return { scaf, rand, cont, ancestor, advRand, advCont, advAncestor, allPositive };
  };
  const histories: R3History[] = [];
  for (let history = 0; history < 6; history++) {
    const a = timingOf(history, "a");
    const b = timingOf(history, "b");
    const swapEa = comp("scaf", history, "a", "swap-ea");
    const swapAe = comp("scaf", history, "a", "swap-ae");
    const gain = diff(swapEa, a.ancestor);
    // The tolerance only absorbs float rounding of fractions like 0.6 - 0.4 vs 0.5 * 0.4 at exact equality.
    const swapCriterion = gain !== null && a.advAncestor !== null && gain - 0.5 * a.advAncestor >= -1e-9;
    histories.push({
      history,
      a,
      b,
      advantage: a.allPositive && b.allPositive,
      quenched: { a: comp("scaf", history, "a", "quenched"), b: comp("scaf", history, "b", "quenched") },
      swapEa,
      swapAe,
      swapCriterion,
      complete:
        [a, b].every((t) => t.scaf !== null && t.rand !== null && t.cont !== null && t.ancestor !== null) &&
        swapEa !== null &&
        swapAe !== null &&
        (["a", "b"] as const).every((t) => comp("scaf", history, t, "quenched") !== null),
      // A criterion is still open while every input it has is unfavourable-free: a defined advantage <= 0 kills it.
      advantageOpen: [a, b].every((t) => [t.advRand, t.advCont, t.advAncestor].every((x) => x === null || x > 0)),
      swapOpen: swapEa === null || a.ancestor === null || a.scaf === null || swapCriterion,
    });
  }
  const advantageHistories = histories.filter((h) => h.advantage).length;
  const swapHistories = histories.filter((h) => h.swapCriterion).length;
  const advantagePossible = histories.filter((h) => h.advantageOpen).length;
  const swapPossible = histories.filter((h) => h.swapOpen).length;
  const complete = histories.every((h) => h.complete);
  const qs = sets
    .filter((s) => s.labels.arm === "scaf")
    .map((s) => competence(s.rows.filter((r) => r.inoculum === "quenched"), s.labels.ref).value)
    .filter((v): v is number => v !== null);
  const quenched = {
    n: qs.length,
    max: qs.length ? Math.max(...qs) : null,
    mean: qs.length ? mean(qs) : null,
    unreliable: qs.length === 0 || Math.max(...qs) > R3_QUENCH_LIMIT,
  };
  const unmatched = sets.map((s, i) => {
    const fr = s.rows.filter((r) => r.inoculum === "fragment");
    return {
      source: `${s.labels.arm}${s.labels.history >= 0 ? `-${s.labels.history}` : ""}@${s.labels.timing ?? "?"}#${i}`,
      retMass: dist(fr.map((r) => r.retMass)),
      retE: dist(fr.filter((r) => r.retE !== null).map((r) => r.retE!)),
    };
  });
  return {
    histories,
    advantageHistories,
    swapHistories,
    quenched,
    decisive: advantageHistories >= 4 && swapHistories >= 4 && !quenched.unreliable,
    complete,
    advantagePossible,
    swapPossible,
    unmatched,
  };
}

/**
 * Verdicts for the decision table: true once the rule is met, false once no completion of the missing
 * histories could meet it, and null while the data are incomplete. `expected` lists the (arm, history, time)
 * sets the verdict is judged over (default: every one); the truncation sensitivity pass drops the flagged sets
 * from it, so completeness is judged against the histories that remain and "4 of 6" scales to them
 * (`atLeastFourOfSix`).
 */
export function r1Verdict(r: ReturnType<typeof r1Evaluate>, expected: readonly AssayKey[] = R1_EXPECTED): boolean | null {
  const E = HISTORIES.filter((h) => hasKey(expected, "scaf", h, 1));
  if (E.length === 0) return null;
  const need = atLeastFourOfSix(E.length);
  const at = r.histories.filter((x) => x.arm === "scaf" && x.t === 1 && E.includes(x.history));
  const present = new Set(at.map((x) => x.history)).size;
  const n = at.filter((x) => x.demonstrated).length;
  return n >= need ? true : n + (E.length - present) < need ? false : null;
}

/**
 * R2 is true only with every expected scaf and rand gain present (the median comparison moves as histories
 * arrive); false as soon as too few scaf gains could still be positive, or once complete and not shown. A history
 * needs both its time-0 and time-C keys in `expected`.
 */
export function r2Verdict(r: ReturnType<typeof r2Evaluate>, expected: readonly AssayKey[] = R2_EXPECTED): boolean | null {
  const both = (arm: "scaf" | "rand") => HISTORIES.filter((h) => hasKey(expected, arm, h, 0) && hasKey(expected, arm, h, 1));
  const Es = both("scaf");
  const Er = both("rand");
  if (Es.length === 0) return null;
  const gains = (arm: "scaf" | "rand", E: readonly number[]) =>
    E.map((h) => r.histories.find((x) => x.arm === arm && x.history === h)?.standardised.gain ?? null).filter((g): g is number => g !== null);
  const need = atLeastFourOfSix(Es.length);
  const sg = gains("scaf", Es);
  const rg = gains("rand", Er);
  const positive = sg.filter((g) => g > 0).length;
  const missingScaf = Es.length - sg.length;
  if (positive + missingScaf < need) return false;
  if (missingScaf > 0 || Er.length === 0 || rg.length < Er.length) return null;
  return positive >= need && median(sg) > median(rg);
}

/**
 * R3 is true only when every source, swap arm and quenched control of the expected histories is present and the
 * rule holds; false as soon as a quenched control of an expected history exceeds 0.05 (later sets only raise the
 * maximum) or a 4-of-6 count can no longer be reached; null otherwise. A history is expected when its scaf, rand
 * and cont sources and the ancestor are, at both timings; the quenched veto reads only those comparison
 * histories, so a comparison left out of `expected` no longer vetoes the rest.
 */
export function r3Verdict(r: ReturnType<typeof r3Evaluate>, expected: readonly AssayKey[] = R3_EXPECTED): boolean | null {
  const E = r.histories.filter(
    (h) => (["scaf", "rand", "cont"] as const).every((arm) => hasKey(expected, arm, h.history, 0) && hasKey(expected, arm, h.history, 1)) && hasKey(expected, "ancestor", -1, 0) && hasKey(expected, "ancestor", -1, 1),
  );
  const qs = E.flatMap((h) => [h.quenched.a, h.quenched.b]).filter((v): v is number => v !== null);
  if (qs.some((q) => q > R3_QUENCH_LIMIT)) return false;
  if (E.length === 0) return null;
  const need = atLeastFourOfSix(E.length);
  if (E.filter((h) => h.advantageOpen).length < need || E.filter((h) => h.swapOpen).length < need) return false;
  if (!E.every((h) => h.complete)) return null;
  return E.filter((h) => h.advantage).length >= need && E.filter((h) => h.swapCriterion).length >= need && qs.length > 0;
}

export interface AssayTruncation {
  /** Sets with more than 1% truncated rows. */
  flagged: (TruncationStat & { arm: AssayArm; history: number; time: 0 | 1 | null; timing: "a" | "b" | null; inoculum: string[] })[];
  /** Every row of every set carries a `truncated` value; false for tables that predate the column. */
  known: boolean;
  /**
   * Every (arm, history) the readout needs has a loaded evolution run with rows, so its truncation flag is known
   * (`--runs`). When false the sensitivity below is pending: `without` and `sensitive` are null.
   */
  evolutionKnown: boolean;
  /** The (arm, history) identities the readout needs that have no loaded evolution run (not loaded, rejected, unfinished or empty). */
  evolutionMissing: { arm: MainArm; history: number }[];
  /** Loaded histories with more than 1% truncated recipient rows in their ponds.tsv (protocol, "Truncation"). */
  evolutionFlagged: HistoryTruncation[];
  verdict: boolean | null;
  /** The verdict with the flagged sets and flagged histories left out, judged over the histories that remain; null while pending. */
  without: boolean | null;
  /** The two verdicts are both decided and differ, or leaving the flagged sets out decides a verdict that was open; null while pending. */
  sensitive: boolean | null;
  /** The verdict was decided but is undecidable once the flagged sets are gone (too few histories remain to judge). */
  inconclusive: boolean;
}

/**
 * The truncation rule for an assay stage. Two things flag: a set (one history's source at one time or timing) with
 * more than 1% truncated assay rows, and (`evolution`, the histories' `summariseHistory` truncation) a history whose
 * evolution run had more than 1% truncated recipient rows, which leaves the whole history out (both times, every
 * variant and comparator arm of it). `verdictOf` runs on every set against `expected` (the stage's full key list),
 * and again without the flagged ones against `expected` minus their keys, so a left-out history is not mistaken
 * for missing data; decisions themselves use every history. The stage is sensitive to truncation only when both
 * verdicts are decided and differ (or the second decides one the first left open); a decided verdict whose
 * remainder is undecidable is reported as `inconclusive`, not sensitive.
 *
 * Every (arm, history) in `expected` needs a loaded evolution run with rows: without that the truncation flag is
 * unknown for some history, so the result stays pending (`evolutionKnown` false, `without` and `sensitive` null,
 * the gaps in `evolutionMissing`) rather than passing for "nothing flagged". `evolution` null means none loaded.
 *
 * With `paired` (R3, whose scaf_i, rand_i and cont_i are one comparison), excluding any comparison index i, for
 * whichever arm or set flagged it, removes all of that comparison's sets (its sources, swaps and quenched
 * control) and its keys before aggregating, so its quenched control cannot veto the comparisons that remain.
 */
export function assaySensitivity(
  sets: readonly AssaySet[],
  verdictOf: (sets: readonly AssaySet[], expected: readonly AssayKey[]) => boolean | null,
  expected: readonly AssayKey[],
  evolution: readonly HistoryTruncation[] | null = null,
  paired = false,
): AssayTruncation {
  const stats = sets.map((s) => ({ s, t: truncationOf(s.rows.filter((r) => r.truncated !== null && r.truncated > 0).length, s.rows.length) }));
  const known = sets.every((s) => s.rows.every((r) => r.truncated !== null));
  const flaggedSets = stats.filter(({ t }) => t.flagged);
  const flagged = flaggedSets.map(({ s, t }) => ({ ...t, arm: s.labels.arm, history: s.labels.history, time: s.labels.time, timing: s.labels.timing, inoculum: [...new Set(s.rows.map((r) => r.inoculum))] }));
  const loaded = (evolution ?? []).filter((h) => h.rows > 0);
  const required = expected.filter((k): k is AssayKey & { arm: MainArm } => k.arm !== "ancestor" && k.history >= 0).filter((k, i, all) => all.findIndex((o) => o.arm === k.arm && o.history === k.history) === i);
  const evolutionMissing = required.filter((k) => !loaded.some((h) => h.arm === k.arm && h.history === k.history)).map(({ arm, history }) => ({ arm, history }));
  const evolutionFlagged = loaded.filter((h) => h.flagged);
  const base = { known, evolutionKnown: evolutionMissing.length === 0, evolutionMissing, evolutionFlagged };
  const verdict = verdictOf(sets, expected);
  if (evolutionMissing.length > 0) return { flagged, ...base, verdict, without: null, sensitive: null, inconclusive: false };
  if (flagged.length === 0 && evolutionFlagged.length === 0) return { flagged, ...base, verdict, without: verdict, sensitive: false, inconclusive: false };
  // Comparison indices left out whole when the readout pairs its arms by history index (R3).
  const leftOut = new Set(paired ? [...flaggedSets.map(({ s }) => s.labels.history), ...evolutionFlagged.map((h) => h.history)].filter((i) => i >= 0) : []);
  const inFlaggedHistory = (s: AssaySet) => evolutionFlagged.some((h) => h.arm === s.labels.arm && h.history === s.labels.history) || leftOut.has(s.labels.history);
  const dropped = [
    ...flaggedSets.map(({ s }) => setKey(s.labels)).filter((k): k is AssayKey => k !== null),
    ...evolutionFlagged.flatMap((h) => ([0, 1] as const).map((time): AssayKey => ({ arm: h.arm, history: h.history, time }))),
    ...[...leftOut].flatMap((history) => (["scaf", "rand", "cont"] as const).flatMap((arm) => ([0, 1] as const).map((time): AssayKey => ({ arm, history, time })))),
  ];
  const without = verdictOf(
    stats.filter(({ s, t }) => !t.flagged && !inFlaggedHistory(s)).map(({ s }) => s),
    expected.filter((k) => !dropped.some((d) => sameKey(d, k))),
  );
  const sensitive = verdict !== null && without !== null ? verdict !== without : verdict === null && without !== null;
  return { flagged, ...base, verdict, without, sensitive, inconclusive: verdict !== null && without === null };
}

// ---------------------------------------------------------------------------------------------
// R3 replication (docs/scaffold-r3-replication-v1.md): protocol v1's R3 on fresh histories

/** A margin "in fragments" is out of one set's 128 (2 replicates x 64 ponds), as v1 reported its swap margins. */
export const R3REP_FRAGMENTS = R3REP_REGIME.replicates * R3REP_REGIME.side * R3REP_REGIME.side;
/** Each criterion must hold in at least 4 of the 6 comparisons, and the rule needs at least 4 histories available. */
export const R3REP_NEED = 4;
/** The boundaries v1's trajectories.json reported per arm: the per-arm medians are given at these, beside every history's full trajectory. */
export const R3REP_TRAJECTORY_BOUNDARIES = [1, 10, 25, 50, 75, 100] as const;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** An R3-replication directory as read: its path, assay.json and every assay.tsv row. */
export interface R3RepSetDir {
  dir: string;
  json: Record<string, unknown>;
  rows: AssayRow[];
}

/**
 * A checkpoint the report reloaded from a path that a set's provenance records: its record as the assay tool makes it
 * (`r3RepCheckpointOf`) and its dominant genome (`r3RepDominantRecord`), or why it could not be read. A path the report could not
 * reach has no entry.
 */
export type R3RepReload = { record: R3RepCheckpoint; dominant: R3RepDominant | null } | { error: string };

/** A screened set of the replication: one source world at one timing, one variant. */
export interface R3RepSet {
  dir: string;
  /** `r3RepSetIdOf`: scaf-i0-a, scaf-i0-b-quenched, scaf-i0-a-swap-ea, ancestor-b, ... */
  id: string;
  labels: R3RepLabelSet;
  inoculum: R3RepInoculum;
  /** A Ge-on-Fa record whose donor has no dominant genome: no rows, biologically unavailable rather than a technical failure. */
  biological: boolean;
  /** The set's ref (103,058 in strict mode); null for a biological record, which has no rows to judge. */
  ref: number | null;
  rows: AssayRow[];
  /** The recorded checkpoints (role and path) the report could not reach, so could not re-hash: the set stands on its recorded provenance. */
  unverifiable: string[];
}

/** The set an assay.json names (`r3RepSetIdOf`), or null when its labels are not an R3-replication set's or it names no variant. */
export function r3RepSetIdOfJson(json: Record<string, unknown>): string | null {
  const lab = r3RepLabelsFromJson(json.labels);
  return "error" in lab || typeof json.inoculum !== "string" ? null : r3RepSetIdOf(lab.labels, json.inoculum);
}

/**
 * The checkpoints an assay.json's provenance records, by role: the assayed checkpoint (`source`), at timing (b) the timing (a) state
 * it was continued from (`continuation source`), and Ge-on-Fa's genome donor (`donor`). The report reloads those it can reach.
 */
export function r3RepRecordedCheckpoints(json: Record<string, unknown>): { role: "source" | "continuation source" | "donor"; record: Record<string, unknown> }[] {
  const p = json.provenance;
  if (!isRecord(p)) return [];
  const out: { role: "source" | "continuation source" | "donor"; record: Record<string, unknown> }[] = [];
  for (const [role, x] of [["source", p], ["continuation source", p.origin], ["donor", p.donor]] as const) if (isRecord(x) && typeof x.source === "string") out.push({ role, record: x });
  return out;
}

/**
 * What the reloaded checkpoints say against a set's recorded provenance (`r3RepRecordedCheckpoints`): every one the report reached
 * must still have the recorded state hash, world seed, mutation rate, step and pond grid, and a donor the recorded dominant genome (id
 * and words; none for a biological record, so a donor that has one makes the record false). The paths `reloaded` has no entry for are
 * returned as `unverifiable`, with their role.
 */
export function r3RepReloadProblems(json: Record<string, unknown>, reloaded: ReadonlyMap<string, R3RepReload>): { why: string[]; unverifiable: string[] } {
  const why: string[] = [];
  const unverifiable: string[] = [];
  for (const { role, record } of r3RepRecordedCheckpoints(json)) {
    const path = record.source as string;
    const r = reloaded.get(path);
    if (r === undefined) {
      unverifiable.push(`${role} ${path}`);
      continue;
    }
    if ("error" in r) {
      why.push(`${role} ${path} could not be read: ${r.error}`);
      continue;
    }
    for (const key of ["stateHash", "seed", "mutRate", "step", "tilesX", "tilesY"] as const) {
      if (record[key] !== r.record[key]) why.push(`${role} ${path} has ${key} ${JSON.stringify(r.record[key])} now, but the assay recorded ${JSON.stringify(record[key])}`);
    }
    if (role !== "donor") continue;
    const was = record.dominant;
    const now = r.dominant;
    const same = was === null ? now === null : isRecord(was) && now !== null && was.id === now.id && was.words === now.words;
    if (same) continue;
    if (was === null) why.push(`donor ${path} has a dominant genome (${now!.id}), so its Ge-on-Fa set is not biologically unavailable`);
    else why.push(`donor ${path} has dominant genome ${now === null ? "none (no eligible cell)" : now.id}, but the assay recorded ${isRecord(was) ? was.id : JSON.stringify(was)}`);
  }
  return { why, unverifiable };
}

/**
 * Screens the replication's directories (competence sets labelled `r3rep`) before the stage reads them. Every problem of a set is
 * collected and the set rejected with its directory, id (null when its labels or variant cannot name one) and reasons; nothing
 * throws for one bad set. A set needs labels consistent with their h (`r3RepLabelsFromJson`), a variant its labels allow
 * (`r3RepVariantProblems`), assay competence and the variant's recorded treatment (`r3RepTreatmentProblems`: quench and swap, Ge-on-Fa's
 * words its donor's dominant genome). A biologically unavailable Ge-on-Fa record (`biologicallyUnavailable`) must be
 * consistent (`r3RepUnavailableProblems`) and have no rows; any other set needs a positive ref and an assay.tsv that fills the
 * (replicate, pond) grid exactly once (2 x 64 in strict mode), every row a competence row of the set's variant with a success flag of
 * 0 or 1. In strict mode the regime is `R3REP_REGIME` (k 8, period 10,000, ref 103,058, side 8, 2 replicates, census 100), replicate s
 * is seeded r3RepSeedOf(labels, variant, s) (Ge-on-Fa: the ancestor's h = 18), the recorded protocolSha256R3rep is `sha.r3rep` (the
 * pinned SHA-256 of the document as frozen, `R3REP_SHA256`: never the document as it is now, which gains dated amendments), and the
 * recorded provenance is the protocol's for the labels and variant (`r3RepProvenanceProblems`, with protocol v1's pinned SHA-256
 * `sha.protocol` in the runs' meta.json) and of the assay's own source. In both modes every recorded checkpoint
 * that `reloaded` holds must still be what was recorded (`r3RepReloadProblems`); the others are listed as unverifiable, except that in
 * strict mode a biological record with an unreachable checkpoint is rejected (its donor's missing genome must be seen). Two sets that
 * pass with one id are both rejected (a stage would count both). `allowAnySeed` (smoke runs) waives the regime, seed, hash and
 * provenance checks and holds the set to the grid assay.json declares.
 */
export function r3RepScreen(
  dirs: readonly R3RepSetDir[],
  o: { sha: { protocol: string; r3rep: string }; reloaded?: ReadonlyMap<string, R3RepReload>; allowAnySeed?: boolean },
): { accepted: R3RepSet[]; rejected: { dir: string; id: string | null; reasons: string[] }[] } {
  const strict = !o.allowAnySeed;
  const candidates: R3RepSet[] = [];
  const rejected: { dir: string; id: string | null; reasons: string[] }[] = [];
  for (const d of dirs) {
    const { json, rows } = d;
    const lab = r3RepLabelsFromJson(json.labels);
    if ("error" in lab) {
      rejected.push({ dir: d.dir, id: null, reasons: [lab.error] });
      continue;
    }
    const labels = lab.labels;
    if (typeof json.inoculum !== "string") {
      rejected.push({ dir: d.dir, id: null, reasons: [`inoculum ${JSON.stringify(json.inoculum)}, want fragment, quenched, swap-ea or swap-ae`] });
      continue;
    }
    const inoculum = json.inoculum;
    const id = r3RepSetIdOf(labels, inoculum);
    const why = r3RepVariantProblems(labels, inoculum);
    if (json.assay !== "competence") why.push(`assay ${JSON.stringify(json.assay)}, want competence`);
    why.push(...r3RepTreatmentProblems(json));
    const biological = json.biologicallyUnavailable !== undefined;
    const ref = typeof json.ref === "number" && json.ref > 0 ? json.ref : null;
    if (biological) {
      why.push(...r3RepUnavailableProblems(json));
      if (rows.length !== 0) why.push(`${rows.length} rows, want 0 (a biologically unavailable record has none)`);
    } else {
      if (ref === null) why.push(`ref ${JSON.stringify(json.ref)}: competence needs a positive ref`);
      const grid = gridFor(json, strict);
      if (grid === null) why.push("assay.json has no side and replicates");
      else {
        if (rows.length !== grid.replicates * grid.ponds) why.push(`${rows.length} rows, want ${grid.replicates * grid.ponds}`);
        const v = gridViolations(rows, grid);
        if (v.repeated > 0) why.push(`assay.tsv repeats a (replicate, pond) in ${v.repeated} rows`);
        if (v.outside > 0) why.push(`assay.tsv has ${v.outside} rows outside the ${grid.replicates} x ${grid.ponds} (replicate, pond) grid`);
      }
      const other = rows.filter((r) => r.inoculum !== inoculum).length;
      if (other > 0) why.push(`${other} assay.tsv rows are not ${inoculum} rows`);
      const notCompetence = rows.filter((r) => r.assay !== "competence").length;
      if (notCompetence > 0) why.push(`${notCompetence} assay.tsv rows are not competence rows`);
      const unflagged = rows.filter((r) => r.success !== 0 && r.success !== 1).length;
      if (unflagged > 0) why.push(`${unflagged} assay.tsv rows have no success flag (0 or 1)`);
    }
    if (strict) {
      why.push(...r3RepRegimeProblems({ k: json.k, period: json.period, ref: json.ref, side: json.side, replicates: json.replicates, censusEvery: json.censusEvery }));
      const seeds = json.seeds;
      if (!Array.isArray(seeds) || seeds.length !== R3REP_REGIME.replicates) why.push(`assay.json has ${Array.isArray(seeds) ? seeds.length : "no"} seeds, want ${R3REP_REGIME.replicates} {physics, fragment}`);
      else {
        try {
          seeds.forEach((sd, s) => {
            if (typeof sd?.physics !== "number" || typeof sd.fragment !== "number") throw new Error(`assay.json seeds[${s}] is not {physics, fragment}`);
            checkR3RepSeeds(labels, inoculum, { physics: sd.physics, fragment: sd.fragment }, s);
          });
        } catch (e) {
          why.push((e as Error).message);
        }
      }
      if (json.protocolSha256R3rep !== o.sha.r3rep) why.push(`protocolSha256R3rep ${JSON.stringify(json.protocolSha256R3rep)} is not the pinned SHA-256 of docs/scaffold-r3-replication-v1.md (${o.sha.r3rep})`);
      why.push(...r3RepProvenanceProblems(labels, inoculum, json.provenance, o.sha));
      if (isRecord(json.provenance) && json.provenance.source !== json.source) why.push(`provenance.source ${JSON.stringify(json.provenance.source)} is not the assay's source ${JSON.stringify(json.source)}`);
    }
    const reload = r3RepReloadProblems(json, o.reloaded ?? new Map());
    why.push(...reload.why);
    // A biological record has no rows to stand on: in strict mode its donor must be reachable, so that "no dominant genome" is
    // verified on the checkpoint itself and never taken from the record alone. Other sets list what could not be re-hashed.
    if (strict && biological && reload.unverifiable.length > 0) why.push(`a biologically unavailable record needs its checkpoints verified, but these are not reachable from here: ${reload.unverifiable.join("; ")}`);
    if (why.length > 0) rejected.push({ dir: d.dir, id, reasons: why });
    else candidates.push({ dir: d.dir, id, labels, inoculum: inoculum as R3RepInoculum, biological, ref: biological ? null : ref, rows, unverifiable: reload.unverifiable });
  }
  // Two sets for one (arm, history, timing, variant) are ambiguous: neither is used, and the set is unavailable.
  const accepted: R3RepSet[] = [];
  for (const c of candidates) {
    const same = candidates.filter((x) => x.id === c.id);
    if (same.length > 1) rejected.push({ dir: c.dir, id: c.id, reasons: [`the same R3-replication set (${c.id}) as ${same.filter((x) => x !== c).map((x) => x.dir).join(", ")}; a stage would count both`] });
    else accepted.push(c);
  }
  return { accepted, rejected };
}

/** One of the 62 sets as the availability rule sees it. */
export interface R3RepSetStatus {
  id: string;
  arm: R3RepLabelSet["arm"];
  history: number;
  timing: "a" | "b";
  inoculum: R3RepInoculum;
  /** "available" (screened), "biological" (a validated Ge-on-Fa record: the donor has no dominant genome) or "unavailable" (missing or rejected: technical). */
  status: "available" | "biological" | "unavailable";
  why: string | null;
  dir: string | null;
}

/**
 * The margins of comparison i in fragments (out of `R3REP_FRAGMENTS`): adv_i(X) for X = rand_i, cont_i and the ancestor at each timing,
 * and the swap criterion's (gain - 0.5 adv_i(ancestor)) at (a), gain = competence(Ge-on-Fa_i) - competence(ancestor); null where an
 * input is missing. Every competence is a count over 128 (a dyadic fraction), so the margins are exact.
 */
export interface R3RepMargins {
  a: { rand: number | null; cont: number | null; ancestor: number | null };
  b: { rand: number | null; cont: number | null; ancestor: number | null };
  swap: number | null;
}

export function r3RepMargins(h: Pick<R3History, "a" | "b" | "swapEa">): R3RepMargins {
  const f = (x: number | null) => (x === null ? null : x * R3REP_FRAGMENTS);
  const at = (t: R3Timing) => ({ rand: f(t.advRand), cont: f(t.advCont), ancestor: f(t.advAncestor) });
  const gain = h.swapEa === null || h.a.ancestor === null ? null : h.swapEa - h.a.ancestor;
  return { a: at(h.a), b: at(h.b), swap: gain === null || h.a.advAncestor === null ? null : f(gain - 0.5 * h.a.advAncestor) };
}

/** Comparison i under the rule: its availability, and v1's evaluation of it on the decision's input. */
export interface R3RepHistory extends Pick<R3History, "history" | "a" | "b" | "advantage" | "quenched" | "swapEa" | "swapAe" | "swapCriterion"> {
  /** All 10 of its sets are available: scaf, rand and cont at (a) and (b), Ge-on-Fa (or its biological record), Ga-on-Fe and both quenched controls. An unavailable history fails both criteria. */
  available: boolean;
  missing: { id: string; why: string }[];
  /** Its Ge-on-Fa set is the biological record: the history is valid and fails the swap criterion. */
  biologicalSwapEa: boolean;
  margins: R3RepMargins;
}

/** One set's competence, over both replicates and each alone (descriptive). */
export interface R3RepCompetence {
  id: string;
  dir: string;
  inoculum: R3RepInoculum;
  status: "available" | "biological";
  n: number;
  successes: number;
  competence: number | null;
  perReplicate: { replicate: number; n: number; successes: number; competence: number | null }[];
  truncatedRows: number;
  unverifiable: string[];
}

/** v1's AssaySet of a screened set, so v1's `r3Evaluate` reads it unchanged (`assayLabels` takes arm, history and timing from the labels). */
const r3RepAssaySet = (s: R3RepSet, rows: AssayRow[] = s.rows): AssaySet => ({ labels: assayLabels({ labels: s.labels, ref: s.ref ?? undefined }), rows });

/**
 * The replication's rule (docs/scaffold-r3-replication-v1.md, "Rule (fixed now)"), on the screened sets, in the protocol's order.
 * 1. Quenched controls first: any available quenched control above 0.05 makes R3 unreliable, so "does not replicate", whatever else is
 * missing; otherwise, with any of the 12 unavailable, "uninformative". 2. Both ancestor sets available, else "uninformative". 3. History i
 * is available when all 10 of its sets are (a biological Ge-on-Fa record counts); fewer than 4 is "uninformative". 4. v1's `r3Evaluate`
 * over the 6 comparisons, on the available histories' sets and the ancestor's (an unavailable history has no input, so it fails both
 * criteria; a biological record has no rows, so its history fails the swap criterion with its advantage evaluated): "replicates" when
 * decisive (advantage and swap criterion each in at least 4 of 6), else "does not replicate" with the failed criteria in `failed`.
 * A set is unavailable when it is missing or `rejected` names its id (the reasons are carried). The descriptive part never feeds the outcome.
 */
export function r3RepEvaluate(
  sets: readonly R3RepSet[],
  rejected: readonly { id: string | null; reasons: string[] }[] = [],
): {
  outcome: "replicates" | "does not replicate" | "uninformative";
  reasons: string[];
  failed: ("quenched" | "advantage" | "swap")[];
  availability: { sets: R3RepSetStatus[]; expected: number; available: number; biological: number; unavailable: number; ancestor: { a: boolean; b: boolean }; histories: { history: number; available: boolean; missing: string[] }[]; availableHistories: number };
  quenched: { limit: number; sets: { id: string; history: number; timing: "a" | "b"; available: boolean; n: number; successes: number; competence: number | null }[]; available: number; max: number | null; allAvailable: boolean; unreliable: boolean };
  histories: R3RepHistory[];
  counts: { evaluated: boolean; availableHistories: number; advantageHistories: number; swapHistories: number; need: number; decisive: boolean };
  /** v1's evaluation on the decision's input, for the side-by-side. */
  evaluation: ReturnType<typeof r3Evaluate>;
  descriptive: {
    competences: R3RepCompetence[];
    histories: (Pick<R3History, "history" | "a" | "b" | "advantage" | "quenched" | "swapEa" | "swapAe" | "swapCriterion"> & { margins: R3RepMargins })[];
    perReplicate: { replicate: number; advantageHistories: number; swapHistories: number; histories: { history: number; advantage: boolean; swapCriterion: boolean; margins: R3RepMargins }[] }[];
    unmatched: { id: string; retMass: Dist; retE: Dist }[];
    truncation: { rows: number; truncatedRows: number; flagged: string[] };
  };
} {
  const byId = new Map(sets.map((s) => [s.id, s]));
  const statuses: R3RepSetStatus[] = r3RepExpectedSets().map(({ labels, inoculum }) => {
    const id = r3RepSetIdOf(labels, inoculum);
    const base = { id, arm: labels.arm, history: labels.history, timing: labels.timing, inoculum };
    const set = byId.get(id);
    if (set) return { ...base, status: set.biological ? "biological" : "available", why: set.biological ? "Ge-on-Fa: the donor has no dominant genome (no eligible cell)" : null, dir: set.dir };
    const rej = rejected.filter((r) => r.id === id);
    return { ...base, status: "unavailable", why: rej.length ? `set rejected: ${rej.flatMap((r) => r.reasons).join("; ")}` : "no assay set", dir: null };
  });
  const unavailable = (x: R3RepSetStatus) => x.status === "unavailable";
  const comp = (s: R3RepSet, rows: readonly AssayRow[] = s.rows) => competence(rows, s.ref);

  // 1. The quenched controls, read first.
  const quenchedSets = statuses
    .filter((x) => x.inoculum === "quenched")
    .map((x) => {
      const set = byId.get(x.id);
      const c = set ? comp(set) : { n: 0, successes: 0, value: null };
      return { id: x.id, history: x.history, timing: x.timing, available: !unavailable(x), n: c.n, successes: c.successes, competence: c.value };
    });
  const qs = quenchedSets.filter((q) => q.competence !== null).map((q) => q.competence!);
  const loud = quenchedSets.filter((q) => q.competence !== null && q.competence > R3_QUENCH_LIMIT);
  const quenched = { limit: R3_QUENCH_LIMIT, sets: quenchedSets, available: quenchedSets.filter((q) => q.available).length, max: qs.length ? Math.max(...qs) : null, allAvailable: quenchedSets.every((q) => q.available), unreliable: loud.length > 0 };

  // 2-3. The ancestor and the histories.
  const ancestor = { a: !statuses.some((x) => x.arm === "ancestor" && x.timing === "a" && unavailable(x)), b: !statuses.some((x) => x.arm === "ancestor" && x.timing === "b" && unavailable(x)) };
  const historyAvailability = HISTORIES.map((history) => {
    const missing = statuses.filter((x) => x.arm !== "ancestor" && x.history === history && unavailable(x));
    return { history, available: missing.length === 0, missing };
  });
  const availableHistories = historyAvailability.filter((h) => h.available).length;
  const isAvailable = (s: R3RepSet) => s.labels.arm === "ancestor" || historyAvailability[s.labels.history].available;

  // 4. v1's evaluation over the 6 comparisons, on the available histories and the ancestor.
  const input = sets.filter(isAvailable);
  const evaluation = r3Evaluate(input.map((s) => r3RepAssaySet(s)));
  const histories: R3RepHistory[] = evaluation.histories.map((h) => {
    const av = historyAvailability[h.history];
    const { history, a, b, advantage, quenched: q, swapEa, swapAe, swapCriterion } = h;
    return { history, available: av.available, missing: av.missing.map((x) => ({ id: x.id, why: x.why! })), biologicalSwapEa: byId.get(r3RepSetIdOf({ arm: "scaf", history, timing: "a" }, "swap-ea"))?.biological === true, a, b, advantage, quenched: q, swapEa, swapAe, swapCriterion, margins: r3RepMargins(h) };
  });

  const reasons: string[] = [];
  const failed: ("quenched" | "advantage" | "swap")[] = [];
  let outcome: "replicates" | "does not replicate" | "uninformative";
  let evaluated = false;
  const listUnavailable = (xs: readonly R3RepSetStatus[]) => xs.map((x) => `${x.id} (${x.why})`).join(", ");
  if (loud.length > 0) {
    outcome = "does not replicate";
    failed.push("quenched");
    reasons.push(`unreliable: ${loud.map((q) => `${q.id} has competence ${q.competence}`).join(", ")}, above ${R3_QUENCH_LIMIT}`);
  } else if (!quenched.allAvailable) {
    outcome = "uninformative";
    reasons.push(`quenched controls unavailable: ${listUnavailable(statuses.filter((x) => x.inoculum === "quenched" && unavailable(x)))}`);
  } else if (!ancestor.a || !ancestor.b) {
    outcome = "uninformative";
    reasons.push(`ancestor sets unavailable: ${listUnavailable(statuses.filter((x) => x.arm === "ancestor" && unavailable(x)))}`);
  } else if (availableHistories < R3REP_NEED) {
    outcome = "uninformative";
    reasons.push(`${availableHistories} of 6 histories available, need ${R3REP_NEED}`);
  } else {
    evaluated = true;
    const unheld = (n: number) => n < R3REP_NEED;
    if (unheld(evaluation.advantageHistories)) failed.push("advantage");
    if (unheld(evaluation.swapHistories)) failed.push("swap");
    // Unreachable after step 1 with 4 or more histories in (all 12 controls at most 0.05), but v1's rule says it, so it is read.
    if (evaluation.quenched.unreliable) failed.push("quenched");
    outcome = evaluation.decisive && failed.length === 0 ? "replicates" : "does not replicate";
    const counts = `advantage over rand, cont and the ancestor at both timings in ${evaluation.advantageHistories} of 6 histories, the swap criterion in ${evaluation.swapHistories} of 6 (each needs ${R3REP_NEED}; ${availableHistories} available)`;
    reasons.push(outcome === "replicates" ? `decisive: ${counts}; no quenched control above ${R3_QUENCH_LIMIT}` : `not decisive (${failed.join(", ")} failed): ${counts}`);
  }

  // Descriptive: never a decision input.
  const competences: R3RepCompetence[] = statuses.flatMap((x) => {
    const s = byId.get(x.id);
    if (!s) return [];
    const c = comp(s);
    const perReplicate = [...new Set(s.rows.map((r) => r.replicate))].sort((p, q) => p - q).map((replicate) => {
      const r = comp(s, s.rows.filter((row) => row.replicate === replicate));
      return { replicate, n: r.n, successes: r.successes, competence: r.value };
    });
    return [{ id: s.id, dir: s.dir, inoculum: s.inoculum, status: s.biological ? "biological" : "available", n: c.n, successes: c.successes, competence: c.value, perReplicate, truncatedRows: s.rows.filter((r) => (r.truncated ?? 0) > 0).length, unverifiable: s.unverifiable }];
  });
  const all = r3Evaluate(sets.map((s) => r3RepAssaySet(s)));
  const replicates = [...new Set(input.flatMap((s) => s.rows.map((r) => r.replicate)))].sort((p, q) => p - q);
  const perReplicate = replicates.map((replicate) => {
    const r = r3Evaluate(input.map((s) => r3RepAssaySet(s, s.rows.filter((row) => row.replicate === replicate))));
    return { replicate, advantageHistories: r.advantageHistories, swapHistories: r.swapHistories, histories: r.histories.map((h) => ({ history: h.history, advantage: h.advantage, swapCriterion: h.swapCriterion, margins: r3RepMargins(h) })) };
  });
  const sources = statuses.filter((x) => x.inoculum === "fragment" && byId.has(x.id)).map((x) => byId.get(x.id)!);
  const rows = sets.reduce((n, s) => n + s.rows.length, 0);
  return {
    outcome,
    reasons,
    failed,
    availability: {
      sets: statuses,
      expected: statuses.length,
      available: statuses.filter((x) => x.status === "available").length,
      biological: statuses.filter((x) => x.status === "biological").length,
      unavailable: statuses.filter(unavailable).length,
      ancestor,
      histories: historyAvailability.map((h) => ({ history: h.history, available: h.available, missing: h.missing.map((x) => x.id) })),
      availableHistories,
    },
    quenched,
    histories,
    counts: { evaluated, availableHistories, advantageHistories: evaluation.advantageHistories, swapHistories: evaluation.swapHistories, need: R3REP_NEED, decisive: evaluated && outcome === "replicates" },
    evaluation,
    descriptive: {
      competences,
      histories: all.histories.map(({ history, a, b, advantage, quenched: q, swapEa, swapAe, swapCriterion }) => ({ history, a, b, advantage, quenched: q, swapEa, swapAe, swapCriterion, margins: r3RepMargins({ a, b, swapEa }) })),
      perReplicate,
      unmatched: sources.map((s) => ({ id: s.id, retMass: dist(s.rows.map((r) => r.retMass)), retE: dist(s.rows.filter((r) => r.retE !== null).map((r) => r.retE!)) })),
      truncation: { rows, truncatedRows: competences.reduce((n, c) => n + c.truncatedRows, 0), flagged: competences.filter((c) => truncationOf(c.truncatedRows, c.n).flagged).map((c) => c.id) },
    },
  };
}

/** A replication history's run directory (runs/scaffold/r3rep/main/<arm>/i<i>), as the report reads it for the descriptive trajectories. */
export interface R3RepRun {
  arm: "scaf" | "rand" | "cont";
  history: number;
  h: number;
  dir: string;
  status: RunStatus;
  /** done.json says the history ended (no eligible pond at a boundary); `endedAt` is that boundary. */
  ended: boolean;
  endedAt: number | null;
  /** Its ponds.tsv, streamed (`r3RepTrajectory`); null unless the run finished. */
  trajectory: R3RepTrajectory | null;
}

/**
 * The (arm, history index, h) of a replication history's run directory from its meta.json, or why it is not one: arm scaf, rand or
 * cont with the world seed of h = 6 arm + i (`r3RepWorldSeedOf`: 4,811,001 + 100 arm + i, cont 4,811,301 + i), side 8, ancestor clone,
 * mutation on, period 10,000, k 8 (scaf and rand) and 100 cycles. The ancestor world (seed 4,818,401) is not a history.
 */
export function r3RepRunOf(meta: Record<string, unknown>): { key: { arm: "scaf" | "rand" | "cont"; history: number; h: number } | null; why: string[] } {
  const why: string[] = [];
  const arm = meta.arm;
  const armIdx = arm === "scaf" ? 0 : arm === "rand" ? 1 : arm === "cont" ? 2 : -1;
  const i = armIdx < 0 ? -1 : HISTORIES.findIndex((x) => r3RepWorldSeedOf(6 * armIdx + x) === meta.seed);
  if (armIdx < 0) why.push(`arm ${JSON.stringify(arm)}, want scaf, rand or cont`);
  else if (meta.seed === R3REP_ANCESTOR_SEED) why.push(`seed ${R3REP_ANCESTOR_SEED} is the ancestor world, not a history`);
  else if (i < 0) why.push(`seed ${JSON.stringify(meta.seed)} is not ${r3RepWorldSeedOf(6 * armIdx)} + i, i = 0-5, for arm ${arm}`);
  if (meta.side !== R3REP_REGIME.side) why.push(`side ${JSON.stringify(meta.side)}, want ${R3REP_REGIME.side}`);
  if (meta.init !== "clone") why.push(`init ${JSON.stringify(meta.init)}, want "clone"`);
  if (!(typeof meta.mutRate === "number" && meta.mutRate > 0)) why.push("mutation off");
  if (meta.period !== R3REP_REGIME.period) why.push(`period ${JSON.stringify(meta.period)}, want ${R3REP_REGIME.period}`);
  if (arm !== "cont" && meta.k !== R3REP_REGIME.k) why.push(`k ${JSON.stringify(meta.k)}, want ${R3REP_REGIME.k}`);
  if (meta.cycles !== R3REP_CYCLES) why.push(`cycles ${JSON.stringify(meta.cycles)}, want ${R3REP_CYCLES}`);
  return { key: why.length === 0 ? { arm: arm as "scaf" | "rand" | "cont", history: i, h: 6 * armIdx + i } : null, why };
}

/** A history's ponds.tsv, summarised per boundary (descriptive). */
export interface R3RepTrajectory {
  /** Per boundary b with rows, ascending: its rows (one per pond), the mean pre-cycle pond trait (recipientTrait; an extinct pond counts 0) and the ponds with trait 0. */
  boundaries: { boundary: number; n: number; meanTrait: number; extinct: number }[];
  /** The truncated share of its recipient rows. */
  truncation: TruncationStat;
}

/** One streaming pass over a history's ponds.tsv: per boundary only a row count and two sums are held. */
export async function r3RepTrajectory(rows: AsyncIterable<TsvRow>): Promise<R3RepTrajectory> {
  const at = new Map<number, { n: number; sum: number; extinct: number }>();
  const guard = new RecipientGuard();
  let n = 0;
  let truncated = 0;
  for await (const r of rows) {
    n++;
    guard.addRow(r);
    if (num(r, "truncated") > 0) truncated++;
    const trait = num(r, "recipientTrait");
    const b = num(r, "cycle");
    let x = at.get(b);
    if (!x) at.set(b, (x = { n: 0, sum: 0, extinct: 0 }));
    x.n++;
    x.sum += trait;
    if (trait === 0) x.extinct++;
  }
  guard.finish();
  const boundaries = [...at].sort(([p], [q]) => p - q).map(([boundary, x]) => ({ boundary, n: x.n, meanTrait: x.sum / x.n, extinct: x.extinct }));
  return { boundaries, truncation: truncationOf(truncated, n) };
}

/**
 * The runs as the readout reports them (descriptive): per history its status, whether it ended, the extinct ponds at boundary 100
 * (null when it has no boundary-100 rows: an ended or unfinished run), its truncation and its mean pond trait per boundary; per arm,
 * the median over its histories of the mean pond trait and of the extinct ponds at `R3REP_TRAJECTORY_BOUNDARIES` (as v1's trajectories.json).
 */
export function r3RepRunsSummary(runs: readonly R3RepRun[]) {
  const histories = [...runs]
    .sort((x, y) => x.h - y.h)
    .map((r) => {
      const b = r.trajectory?.boundaries ?? [];
      return {
        id: `${r.arm}-i${r.history}`,
        arm: r.arm,
        history: r.history,
        dir: r.dir,
        status: r.status,
        ended: r.ended,
        endedAt: r.endedAt,
        extinctAt100: b.find((x) => x.boundary === R3REP_CYCLES)?.extinct ?? null,
        lastBoundary: b.at(-1)?.boundary ?? null,
        truncation: r.trajectory?.truncation ?? null,
        trajectory: b,
      };
    });
  const arm = (a: "scaf" | "rand" | "cont") =>
    R3REP_TRAJECTORY_BOUNDARIES.map((boundary) => {
      const at = histories.filter((h) => h.arm === a).flatMap((h) => h.trajectory.filter((x) => x.boundary === boundary));
      return { boundary, histories: at.length, medianMeanTrait: at.length ? median(at.map((x) => x.meanTrait)) : null, medianExtinct: at.length ? median(at.map((x) => x.extinct)) : null };
    });
  return { histories, arms: { scaf: arm("scaf"), rand: arm("rand"), cont: arm("cont") } };
}

/**
 * v1's R3 numbers (the r3 stage's output, experiments/scaffold/readouts/r3.json) beside the replication's evaluation: the counts and
 * the quenched maximum of each, and per comparison i whether each criterion held, scaf's and the ancestor's competence at (a), Ge-on-Fa's
 * and the margins in fragments. `quenchedMax` is the replication's over its available quenched controls (default: over `rep`'s input).
 * Descriptive only; throws when `v1` is not an r3 stage output.
 */
export function r3RepSideBySide(v1: unknown, rep: ReturnType<typeof r3Evaluate>, quenchedMax: number | null = rep.quenched.max) {
  if (!isRecord(v1) || v1.stage !== "r3" || !Array.isArray(v1.histories) || !v1.histories.every((h) => isRecord(h) && Number.isInteger(h.history) && isRecord(h.a) && isRecord(h.b))) throw new Error("the v1 readout is not an r3 stage output (stage r3 with histories)");
  const old = v1.histories as R3History[];
  const row = (h: R3History | undefined) => (h ? { advantage: h.advantage, swapCriterion: h.swapCriterion, scafA: h.a.scaf, ancestorA: h.a.ancestor, swapEa: h.swapEa, margins: r3RepMargins(h) } : null);
  const q = (x: unknown) => (isRecord(x) && typeof x.max === "number" ? x.max : null);
  return {
    counts: {
      v1: { advantageHistories: v1.advantageHistories ?? null, swapHistories: v1.swapHistories ?? null, quenchedMax: q(v1.quenched) },
      replication: { advantageHistories: rep.advantageHistories, swapHistories: rep.swapHistories, quenchedMax },
    },
    histories: HISTORIES.map((history) => ({ history, v1: row(old.find((h) => h.history === history)), replication: row(rep.histories.find((h) => h.history === history)) })),
  };
}

// ---------------------------------------------------------------------------------------------
// Scaffolding registration v1 (docs/scaffold-registration-v1.md): validity, the primary and secondary tests, the outcome row

/**
 * The frozen registration, pinned by SHA-256 and length (experiments/scaffold/REGISTRATION-v1). A change after the freeze goes in a
 * dated amendment at the end, so the document keeps beginning with these bytes: sets are checked against the pin, never against the
 * document as it is now, which the report only describes.
 */
export const REG1_REPORT_PROTOCOL = { doc: "docs/scaffold-registration-v1.md", sha256: "8a1b00ec5bd1440e8c4ab4ea61f3816dee0dbe110cb2052f0ae0ca785a817f69", bytes: 31_675 } as const;

/** What is wrong with `doc` (the registration's bytes as they are now) as its frozen text followed by amendments only. */
export async function reg1ReportProtocolProblems(doc: Uint8Array): Promise<string[]> {
  const pin = REG1_REPORT_PROTOCOL;
  if (doc.length < pin.bytes) return [`${pin.doc} has ${doc.length} bytes, fewer than the ${pin.bytes} it had when frozen`];
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", doc.slice(0, pin.bytes))), (b) => b.toString(16).padStart(2, "0")).join("");
  if (sha === pin.sha256) return [];
  return [`${pin.doc} no longer begins with its frozen text (SHA-256 ${pin.sha256}; its first ${pin.bytes} bytes hash to ${sha}): a change after the freeze goes in a dated amendment at the end`];
}

/** α of both Holm families, the histories per arm (and ancestor worlds), and the unresolved histories an arm may have before the whole outcome is uninformative. */
export const REG1_REPORT_ALPHA = 0.01;
export const REG1_REPORT_HISTORIES = 24;
export const REG1_REPORT_UNRESOLVED_LIMIT = 6;
/** The assay regime ("Assays", protocol v1's): k 8, period 10,000, ref 103,058, 64 ponds at 512^2 (side 8), census every 100, mutation off. */
export const REG1_REPORT_REGIME = { k: 8, period: 10_000, ref: 103_058, side: 8, censusEvery: 100, mutRate: 0 } as const;
/** Replicates of 64 fragments: 4 per competence set, 8 for the swap pair, 2 for S2's and S3's sets. */
export const REG1_REPORT_REPLICATES = { competence: 4, swap: 8, garden: 2, heredity: 2 } as const;
const REG1_PONDS = REG1_REPORT_REGIME.side * REG1_REPORT_REGIME.side;

/** The registration's seed block ("Seeds"): every base the report checks or draws from. */
export const REG1_REPORT_SEEDS = {
  /** History i of arm a (0 scaf, 1 rand, 2 cont): + 100 a + i. */
  history: 4_850_001,
  /** Ancestor world i: + i. */
  ancestor: 4_850_401,
  /** The continuation (b) of seed index h: + h. */
  continuation: 4_850_501,
  /** σ(h, t, s): + 100 h + 10 t + s. */
  competence: 4_851_001,
  /** S2: + 100 h + 20 t + 10 v + s. */
  garden: 4_861_001,
  /** S3: + 250 h + s. */
  heredity: 4_866_001,
  /** S3's negative-control worlds: + j. */
  negativeWorld: 4_880_001,
  reproducibility: 4_880_101,
  bootstrap: 4_880_201,
  device: 4_880_301,
} as const;

/**
 * The run bundles (tools/run.ts, "System under test" and "Histories and sources"): preset `ponds` with its identity, the default mutation
 * rate, 8 x 8 ponds with period 10,000, deep metrics every 10 censuses, no periodic checkpoints, and per kind of run its steps, pre-cycle
 * checkpoints and experiments with their census (`--out runs/scaffold/reg1 --experiment <name>`, so a bundle is
 * runs/scaffold/reg1/<experiment>/ponds/<condition>/seed-<n>): census every 1,000, or every 100 under hist-c100 and anc-c100 for a run
 * repeated after an event-buffer overflow ("Validity" 3; ponds.tsv and the physics do not depend on the census).
 */
export const REG1_REPORT_RUNS = {
  presetId: "ponds",
  presetIdentity: "56526b894cfccf3f",
  mutRate: 429_497,
  pondPeriod: 10_000,
  side: 8,
  deepEvery: 10,
  history: { experiments: { hist: [1_000], "hist-c100": [100] }, steps: 1_000_000, cycles: 100, preCycle: [34, 100] },
  ancestor: { experiments: { anc: [1_000], "anc-c100": [100] }, steps: 10_000, cycles: 1, preCycle: [1] },
  repro: { experiments: { repro: [1_000, 100] }, steps: 340_000, preCycle: [34] },
  device: { experiments: { device: [1_000] }, condition: "treatment", steps: 20_000 },
} as const;

export type Reg1ReportArm = "scaf" | "rand" | "cont" | "ancestor";
const REG1_ARMS = ["scaf", "rand", "cont"] as const;
const REG1_ALL_ARMS: readonly Reg1ReportArm[] = [...REG1_ARMS, "ancestor"];
/** The runner condition of each arm (`scaf` = treatment); an ancestor world is a pond-cont world of one period. */
export const REG1_REPORT_CONDITIONS: Readonly<Record<Reg1ReportArm, string>> = { scaf: "treatment", rand: "pond-rand", cont: "pond-cont", ancestor: "pond-cont" };
/** S3's seed indices: 0-47 the scaf and rand histories, 48-49 the positive controls (s 0-1), 50-53 the negative controls (j 0-3). */
export const REG1_REPORT_S3 = { positive: 48, negative: 50, sets: 54 } as const;

const reg1Int = (fn: string, name: string, x: number, lo: number, hi: number): void => {
  if (!Number.isInteger(x) || x < lo || x > hi) throw new Error(`${fn}: ${name} must be an integer in ${lo}..${hi}, got ${x}`);
};

/** A history's name in the report and in set ids: scaf-i00 .. cont-i23, and ancestor-i00 .. ancestor-i23 for the ancestor worlds. */
export const reg1ReportHistoryId = (arm: Reg1ReportArm, i: number): string => `${arm}-i${String(i).padStart(2, "0")}`;

/** The seed index h: 24 arm + i for history i of `arm` (0 scaf, 1 rand, 2 cont), 72 + i for ancestor world i. */
export function reg1ReportH(arm: Reg1ReportArm, i: number): number {
  reg1Int("reg1ReportH", "i", i, 0, REG1_REPORT_HISTORIES - 1);
  if (arm === "ancestor") return 3 * REG1_REPORT_HISTORIES + i;
  const a = REG1_ARMS.indexOf(arm);
  if (a < 0) throw new Error(`reg1ReportH: arm must be scaf, rand, cont or ancestor, got ${JSON.stringify(arm)}`);
  return REG1_REPORT_HISTORIES * a + i;
}

/** The world seed of history i of `arm` (4,850,001 + 100 arm + i) or of ancestor world i (4,850,401 + i). */
export function reg1ReportWorldSeed(arm: Reg1ReportArm, i: number): number {
  const h = reg1ReportH(arm, i);
  return arm === "ancestor" ? REG1_REPORT_SEEDS.ancestor + i : REG1_REPORT_SEEDS.history + 100 * Math.floor(h / REG1_REPORT_HISTORIES) + i;
}

/** The seed of the continuation (b) of seed index h (0-95): 4,850,501 + h, at most 4,850,596. */
export function reg1ReportContinuationSeed(h: number): number {
  reg1Int("reg1ReportContinuationSeed", "h", h, 0, 4 * REG1_REPORT_HISTORIES - 1);
  return REG1_REPORT_SEEDS.continuation + h;
}

/**
 * σ(h, t, s) = 4,851,001 + 100 h + 10 t + s: h 0-95, t 0 for timing (a) and 1 for (b), s the replicate 0-3, or 0-7 for the swap pair
 * (h 72-95 at t 0). At most 4,860,514.
 */
export function reg1ReportCompetenceSeed(h: number, t: number, s: number): number {
  reg1Int("reg1ReportCompetenceSeed", "h", h, 0, 4 * REG1_REPORT_HISTORIES - 1);
  reg1Int("reg1ReportCompetenceSeed", "t", t, 0, 1);
  const swap = h >= 3 * REG1_REPORT_HISTORIES && t === 0;
  reg1Int("reg1ReportCompetenceSeed", "s", s, 0, (swap ? REG1_REPORT_REPLICATES.swap : REG1_REPORT_REPLICATES.competence) - 1);
  return REG1_REPORT_SEEDS.competence + 100 * h + 10 * t + s;
}

/** S2: 4,861,001 + 100 h + 20 t + 10 v + s, h 0-47 (scaf and rand), t 0 time 0 / 1 time C, v 0 raw / 1 disc, s 0-1. At most 4,865,732. */
export function reg1ReportGardenSeed(h: number, t: number, v: number, s: number): number {
  reg1Int("reg1ReportGardenSeed", "h", h, 0, 2 * REG1_REPORT_HISTORIES - 1);
  reg1Int("reg1ReportGardenSeed", "t", t, 0, 1);
  reg1Int("reg1ReportGardenSeed", "v", v, 0, 1);
  reg1Int("reg1ReportGardenSeed", "s", s, 0, REG1_REPORT_REPLICATES.garden - 1);
  return REG1_REPORT_SEEDS.garden + 100 * h + 20 * t + 10 * v + s;
}

/** S3: 4,866,001 + 250 h + s, h 0-53 (`REG1_REPORT_S3`), s 0-1 the replicates, 8 the permutation stream, 9 the donor selection. At most 4,879,260. */
export function reg1ReportHereditySeed(h: number, s: number): number {
  reg1Int("reg1ReportHereditySeed", "h", h, 0, REG1_REPORT_S3.sets - 1);
  if (s !== 0 && s !== 1 && s !== 8 && s !== 9) throw new Error(`reg1ReportHereditySeed: s must be 0-1 (replicates), 8 (permutations) or 9 (donors), got ${s}`);
  return REG1_REPORT_SEEDS.heredity + 250 * h + s;
}

/** The registration's sets by `labels.set`: the competence sets ("Assays"), S2's garden sets and S3's transmission sets. */
export type Reg1ReportKind = "source" | "ge-on-fa" | "ga-on-fa" | "ga-on-fe" | "quench" | "garden-raw" | "garden-disc" | "heredity";
/** The state of a run bundle a set's source is: a pre-cycle checkpoint by boundary, the initial world (S2 at time 0) or a continuation (timing b). */
export type Reg1ReportCheckpoint = "b001" | "b034" | "b100" | "init" | "continuation";
/** The state hashes a bundle's manifest records, by checkpoint (a continuation's state is in no manifest). */
export type Reg1ReportHashes = Partial<Record<Exclude<Reg1ReportCheckpoint, "continuation">, string>>;

/** An assay.json's `labels` for this registration: the set, the history it belongs to, and h, the seed index its seeds use. */
export interface Reg1ReportLabels {
  reg1: true;
  set: Reg1ReportKind;
  arm: Reg1ReportArm | "control";
  /** The history (or ancestor world) i; null for S3's controls. */
  history: number | null;
  timing: "a" | "b" | null;
  time: 0 | 1 | null;
  h: number;
  control: "positive" | "negative" | null;
}

/** One set the registration runs: its id, labels, assay and replicates, every replicate's seeds, and where its source comes from. */
export interface Reg1ReportExpectedSet {
  id: string;
  labels: Reg1ReportLabels;
  assay: "competence" | "garden" | "transmission";
  replicates: number;
  /** Replicate s's {physics, fragment} seeds. */
  seeds: { physics: number; fragment: number }[];
  /** The seed formula, for the reasons a screen gives. */
  formula: string;
  /** S3: the donor-selection seed (s = 9); null for every other set. */
  donorSeed: number | null;
  /** The run bundles its source is read from: the fragment source first, then (Ge-on-Fa) the genome donor. Empty for S3's controls. */
  sources: { bundle: string; checkpoint: Reg1ReportCheckpoint }[];
  /** The history or ancestor world it belongs to for the unresolved count (the swap pair is scaf_i's); null for S3's controls. */
  owner: string | null;
}

let reg1Expected: readonly Reg1ReportExpectedSet[] | null = null;
let reg1ExpectedById: ReadonlyMap<string, Reg1ReportExpectedSet> | null = null;

/**
 * Every set the registration runs (558), in queue order: per index i the 13 competence sets (scaf, rand, cont and the ancestor at (a) and
 * (b), Ge-on-Fa, Ga-on-Fa, Ga-on-Fe and the quenched controls at (a) and (b)); then S2's four per scaf and rand history and time (raw and
 * disc at time 0 and C); then S3's 48 history sets and its 6 controls. R4's capability set is descriptive and not listed.
 */
export function reg1ReportExpectedSets(): readonly Reg1ReportExpectedSet[] {
  if (reg1Expected) return reg1Expected;
  const out: Reg1ReportExpectedSet[] = [];
  const labels = (set: Reg1ReportKind, arm: Reg1ReportLabels["arm"], history: number | null, h: number, o: Partial<Pick<Reg1ReportLabels, "timing" | "time" | "control">> = {}): Reg1ReportLabels => ({
    reg1: true,
    set,
    arm,
    history,
    timing: o.timing ?? null,
    time: o.time ?? null,
    h,
    control: o.control ?? null,
  });
  const competence = (id: string, l: Reg1ReportLabels, t: number, replicates: number, sources: Reg1ReportExpectedSet["sources"], owner: string): Reg1ReportExpectedSet => ({
    id,
    labels: l,
    assay: "competence",
    replicates,
    seeds: Array.from({ length: replicates }, (_, s) => {
      const x = reg1ReportCompetenceSeed(l.h, t, s);
      return { physics: x, fragment: x };
    }),
    formula: `σ(${l.h}, ${t}, s) = 4,851,001 + 100·${l.h} + 10·${t} + s`,
    donorSeed: null,
    sources,
    owner,
  });
  const heredity = (id: string, l: Reg1ReportLabels, sources: Reg1ReportExpectedSet["sources"], owner: string | null): Reg1ReportExpectedSet => ({
    id,
    labels: l,
    assay: "transmission",
    replicates: REG1_REPORT_REPLICATES.heredity,
    seeds: Array.from({ length: REG1_REPORT_REPLICATES.heredity }, (_, s) => {
      const x = reg1ReportHereditySeed(l.h, s);
      return { physics: x, fragment: x };
    }),
    formula: `4,866,001 + 250·${l.h} + s`,
    donorSeed: reg1ReportHereditySeed(l.h, 9),
    sources,
    owner,
  });
  const timings = ["a", "b"] as const;
  for (let i = 0; i < REG1_REPORT_HISTORIES; i++) {
    for (const arm of REG1_ALL_ARMS) {
      const id = reg1ReportHistoryId(arm, i);
      const h = reg1ReportH(arm, i);
      for (const timing of timings) {
        const checkpoint: Reg1ReportCheckpoint = timing === "b" ? "continuation" : arm === "ancestor" ? "b001" : "b100";
        out.push(competence(`${id}-${timing}`, labels("source", arm, i, h, { timing }), timing === "a" ? 0 : 1, REG1_REPORT_REPLICATES.competence, [{ bundle: id, checkpoint }], id));
      }
    }
    const scaf = reg1ReportHistoryId("scaf", i);
    const anc = reg1ReportHistoryId("ancestor", i);
    const ha = reg1ReportH("ancestor", i);
    out.push(competence(`${scaf}-ge-on-fa`, labels("ge-on-fa", "scaf", i, ha, { timing: "a" }), 0, REG1_REPORT_REPLICATES.swap, [{ bundle: anc, checkpoint: "b001" }, { bundle: scaf, checkpoint: "b100" }], scaf));
    out.push(competence(`${scaf}-ga-on-fa`, labels("ga-on-fa", "scaf", i, ha, { timing: "a" }), 0, REG1_REPORT_REPLICATES.swap, [{ bundle: anc, checkpoint: "b001" }], scaf));
    out.push(competence(`${scaf}-ga-on-fe`, labels("ga-on-fe", "scaf", i, i, { timing: "a" }), 0, REG1_REPORT_REPLICATES.competence, [{ bundle: scaf, checkpoint: "b100" }], scaf));
    for (const timing of timings) {
      out.push(competence(`${scaf}-quench-${timing}`, labels("quench", "scaf", i, i, { timing }), timing === "a" ? 0 : 1, REG1_REPORT_REPLICATES.competence, [{ bundle: scaf, checkpoint: timing === "a" ? "b100" : "continuation" }], scaf));
    }
  }
  for (const arm of ["scaf", "rand"] as const) {
    for (let i = 0; i < REG1_REPORT_HISTORIES; i++) {
      const id = reg1ReportHistoryId(arm, i);
      const h = reg1ReportH(arm, i);
      for (const time of [0, 1] as const) {
        for (const v of [0, 1] as const) {
          out.push({
            id: `garden-${id}-t${time}-${v === 0 ? "raw" : "disc"}`,
            labels: labels(v === 0 ? "garden-raw" : "garden-disc", arm, i, h, { time }),
            assay: "garden",
            replicates: REG1_REPORT_REPLICATES.garden,
            seeds: Array.from({ length: REG1_REPORT_REPLICATES.garden }, (_, s) => ({ physics: reg1ReportGardenSeed(h, time, v, s), fragment: reg1ReportGardenSeed(h, time, 0, s) })),
            formula: `physics 4,861,001 + 100·${h} + 20·${time} + 10·${v} + s, fragments the same with v = 0`,
            donorSeed: null,
            sources: [{ bundle: id, checkpoint: time === 0 ? "init" : "b100" }],
            owner: id,
          });
        }
      }
    }
  }
  for (const arm of ["scaf", "rand"] as const) {
    for (let i = 0; i < REG1_REPORT_HISTORIES; i++) {
      const id = reg1ReportHistoryId(arm, i);
      out.push(heredity(`heredity-${id}`, labels("heredity", arm, i, reg1ReportH(arm, i)), [{ bundle: id, checkpoint: "b034" }], id));
    }
  }
  for (let s = 0; s < 2; s++) out.push(heredity(`heredity-pos-s${s}`, labels("heredity", "control", null, REG1_REPORT_S3.positive + s, { control: "positive" }), [], null));
  for (let j = 0; j < 4; j++) out.push(heredity(`heredity-neg-j${j}`, labels("heredity", "control", null, REG1_REPORT_S3.negative + j, { control: "negative" }), [], null));
  reg1Expected = out;
  reg1ExpectedById = new Map(out.map((x) => [x.id, x]));
  return out;
}

/** The expected set of an id, or undefined. */
export function reg1ReportExpectedSet(id: string): Reg1ReportExpectedSet | undefined {
  reg1ReportExpectedSets();
  return reg1ExpectedById!.get(id);
}

/**
 * The id of the set an assay.json's `labels` name (`set`, `arm`, `history`, `timing` or `time`, and for S3's controls `control` and h), or
 * why they name none. The labels must still agree with the set in full (`reg1ReportLabelProblems`).
 */
export function reg1ReportSetIdOf(labels: unknown): { id: string } | { error: string } {
  if (!isRecord(labels) || labels.reg1 !== true) return { error: "labels.reg1 is not true" };
  const l = labels;
  const i = l.history;
  const history = (arms: readonly string[]): string | null =>
    typeof l.arm === "string" && arms.includes(l.arm) && Number.isInteger(i) && (i as number) >= 0 && (i as number) < REG1_REPORT_HISTORIES ? reg1ReportHistoryId(l.arm as Reg1ReportArm, i as number) : null;
  const bad = (what: string) => ({ error: `labels name no registration set (${what}): ${JSON.stringify(labels)}` });
  switch (l.set) {
    case "source": {
      const id = history(REG1_ALL_ARMS);
      if (id === null) return bad("a source needs arm scaf, rand, cont or ancestor and history 0-23");
      return l.timing === "a" || l.timing === "b" ? { id: `${id}-${l.timing}` } : bad("a source needs timing a or b");
    }
    case "ge-on-fa":
    case "ga-on-fa":
    case "ga-on-fe": {
      const id = history(["scaf"]);
      return id === null ? bad(`${l.set} labels scaf history 0-23`) : { id: `${id}-${l.set}` };
    }
    case "quench": {
      const id = history(["scaf"]);
      if (id === null) return bad("quench labels scaf history 0-23");
      return l.timing === "a" || l.timing === "b" ? { id: `${id}-quench-${l.timing}` } : bad("quench needs timing a or b");
    }
    case "garden-raw":
    case "garden-disc": {
      const id = history(["scaf", "rand"]);
      if (id === null) return bad(`${l.set} labels scaf or rand history 0-23`);
      return l.time === 0 || l.time === 1 ? { id: `garden-${id}-t${l.time}-${l.set === "garden-raw" ? "raw" : "disc"}` } : bad(`${l.set} needs time 0 or 1`);
    }
    case "heredity": {
      if (l.arm === "control") {
        const h = l.h as number;
        if (l.control === "positive" && Number.isInteger(h) && h >= REG1_REPORT_S3.positive && h < REG1_REPORT_S3.negative) return { id: `heredity-pos-s${h - REG1_REPORT_S3.positive}` };
        if (l.control === "negative" && Number.isInteger(h) && h >= REG1_REPORT_S3.negative && h < REG1_REPORT_S3.sets) return { id: `heredity-neg-j${h - REG1_REPORT_S3.negative}` };
        return bad("an S3 control is positive with h 48-49 or negative with h 50-53");
      }
      const id = history(["scaf", "rand"]);
      return id === null ? bad("heredity labels scaf or rand history 0-23, or arm control") : { id: `heredity-${id}` };
    }
    default:
      return bad(`set ${JSON.stringify(l.set)}`);
  }
}

/** What is wrong with `labels` for the set `want` (every field of reg1-interfaces.md's labels; an absent one reads as null). */
export function reg1ReportLabelProblems(labels: Record<string, unknown>, want: Reg1ReportExpectedSet): string[] {
  const why: string[] = [];
  for (const key of ["set", "arm", "history", "timing", "time", "h", "control"] as const) {
    if ((labels[key] ?? null) !== want.labels[key]) why.push(`labels.${key} ${JSON.stringify(labels[key])}, want ${JSON.stringify(want.labels[key])} for ${want.id}`);
  }
  return why;
}

/** The expected run bundles in order: the scaf, rand and cont histories, then the ancestor worlds, i = 0-23 each. */
export function reg1ReportExpectedRuns(): { id: string; arm: Reg1ReportArm; history: number }[] {
  return REG1_ALL_ARMS.flatMap((arm) => Array.from({ length: REG1_REPORT_HISTORIES }, (_, i) => ({ id: reg1ReportHistoryId(arm, i), arm, history: i })));
}

/** What a run bundle is, from its manifest's spec.seed: a history (1,000,000 steps), its reproducibility rerun (340,000), an ancestor world, or the device check. */
export type Reg1ReportBundleRole =
  | { role: "history" | "repro"; arm: "scaf" | "rand" | "cont"; history: number; id: string }
  | { role: "ancestor"; arm: "ancestor"; history: number; id: string }
  | { role: "device" };

/** The role of a bundle from its manifest, or why it is none of the registration's (its seed is outside the block's run seeds). */
export function reg1ReportBundleRoleOf(manifest: unknown): { role: Reg1ReportBundleRole } | { why: string } {
  const spec = isRecord(manifest) && isRecord(manifest.spec) ? manifest.spec : null;
  if (spec === null) return { why: "manifest.json has no spec" };
  const seed = spec.seed;
  if (seed === REG1_REPORT_SEEDS.device) return { role: { role: "device" } };
  if (typeof seed === "number") {
    for (let a = 0; a < REG1_ARMS.length; a++) {
      const i = seed - REG1_REPORT_SEEDS.history - 100 * a;
      if (Number.isInteger(i) && i >= 0 && i < REG1_REPORT_HISTORIES) {
        const arm = REG1_ARMS[a];
        return { role: { role: spec.steps === REG1_REPORT_RUNS.repro.steps ? "repro" : "history", arm, history: i, id: reg1ReportHistoryId(arm, i) } };
      }
    }
    const i = seed - REG1_REPORT_SEEDS.ancestor;
    if (Number.isInteger(i) && i >= 0 && i < REG1_REPORT_HISTORIES) return { role: { role: "ancestor", arm: "ancestor", history: i, id: reg1ReportHistoryId("ancestor", i) } };
  }
  return { why: `spec.seed ${JSON.stringify(seed)} is not a registration history (4,850,001 + 100 arm + i), ancestor world (4,850,401 + i) or device check (4,880,301) seed` };
}

const pad3 = (b: number) => String(b).padStart(3, "0");

/**
 * What is wrong with a bundle's manifest.json for its role (none: it is the registration's run). Every role: finished (summary and
 * finishedAt) with exact conservation (summary.conservationOk), one of its experiments with that experiment's census (`REG1_REPORT_RUNS`:
 * hist or hist-c100, anc or anc-c100, repro, device) and the runId the runner derives from it (<experiment>/ponds/<condition>/seed-<n>),
 * which `dir`, when given, must end in. The device check: preset ponds, condition treatment, seed 4,880,301, 20,000 steps and a finalHash.
 * A history, an ancestor world or a reproducibility rerun: preset ponds and its identity 56526b894cfccf3f, the arm's condition and world
 * seed, its steps (10^6, 10^4 or 340,000), deep every 10, no periodic checkpoints, its pre-cycle boundaries (34 and 100, 1, or 34) and
 * nothing else that changes the world; a config with the default mutation rate 429,497, 8 x 8 ponds, period 10,000 and the arm; started
 * from the preset (startStep 0, initHash); and every pre-cycle checkpoint listed in order with its step, file checkpoints/b<NNN>-pre.blck and hash.
 */
export function reg1ReportBundleProblems(manifest: unknown, role: Reg1ReportBundleRole, dir?: string): string[] {
  if (!isRecord(manifest) || !isRecord(manifest.spec)) return ["manifest.json has no spec"];
  const m = manifest;
  const spec = manifest.spec;
  const why: string[] = [];
  const want = (name: string, got: unknown, expected: unknown) => {
    if (got !== expected) why.push(`${name} ${JSON.stringify(got)}, want ${JSON.stringify(expected)}`);
  };
  const summary = isRecord(m.summary) ? m.summary : null;
  if (summary === null || typeof m.finishedAt !== "string") why.push("the run did not finish (manifest.json has no summary and finishedAt)");
  else if (summary.conservationOk !== true) why.push(`summary.conservationOk ${JSON.stringify(summary.conservationOk)}: matter or the energy ledger was not conserved`);
  const runs = REG1_REPORT_RUNS;
  const kind = role.role === "device" ? runs.device : role.role === "ancestor" ? runs.ancestor : role.role === "repro" ? runs.repro : runs.history;
  const condition = role.role === "device" ? runs.device.condition : REG1_REPORT_CONDITIONS[role.arm];
  const experiments: Readonly<Record<string, readonly number[]>> = kind.experiments;
  const experiment = typeof spec.experiment === "string" && Object.hasOwn(experiments, spec.experiment) ? spec.experiment : null;
  if (experiment === null) why.push(`spec.experiment ${JSON.stringify(spec.experiment)}, want ${Object.keys(experiments).join(" or ")}`);
  else if (!experiments[experiment].includes(spec.censusEvery as number)) why.push(`spec.censusEvery ${JSON.stringify(spec.censusEvery)}, want ${experiments[experiment].join(" or ")} under experiment ${experiment}`);
  const runId = `${experiment ?? Object.keys(experiments)[0]}/${runs.presetId}/${condition}/seed-${role.role === "device" ? REG1_REPORT_SEEDS.device : reg1ReportWorldSeed(role.arm, role.history)}`;
  want("runId", m.runId, runId);
  if (dir !== undefined) {
    const path = dir.replace(/\/+$/, "");
    if (path !== runId && !path.endsWith(`/${runId}`)) why.push(`the bundle directory ${JSON.stringify(dir)} does not end in ${runId}`);
  }
  want("spec.presetId", spec.presetId, REG1_REPORT_RUNS.presetId);
  if (role.role === "device") {
    const d = runs.device;
    want("spec.condition", spec.condition, d.condition);
    want("spec.seed", spec.seed, REG1_REPORT_SEEDS.device);
    want("spec.steps", spec.steps, d.steps);
    if (summary !== null && typeof summary.finalHash !== "string") why.push("summary.finalHash is missing");
    return why;
  }
  const shape: { steps: number; preCycle: readonly number[] } = role.role === "ancestor" ? REG1_REPORT_RUNS.ancestor : role.role === "repro" ? REG1_REPORT_RUNS.repro : REG1_REPORT_RUNS.history;
  want("spec.condition", spec.condition, REG1_REPORT_CONDITIONS[role.arm]);
  want("spec.seed", spec.seed, reg1ReportWorldSeed(role.arm, role.history));
  want("spec.steps", spec.steps, shape.steps);
  want("spec.deepEvery", spec.deepEvery, REG1_REPORT_RUNS.deepEvery);
  want("spec.checkpointEvery", spec.checkpointEvery, 0);
  if (JSON.stringify(spec.preCycleCheckpoints) !== JSON.stringify(shape.preCycle)) why.push(`spec.preCycleCheckpoints ${JSON.stringify(spec.preCycleCheckpoints)}, want ${JSON.stringify(shape.preCycle)}`);
  for (const key of ["overrides", "metapopulation", "soloFounder", "soloGenome", "founderSet"]) if (spec[key] !== undefined) why.push(`spec.${key} is set, but the registration's runs are the preset's own world`);
  want("presetIdentity", m.presetIdentity, REG1_REPORT_RUNS.presetIdentity);
  want("startStep", m.startStep, 0);
  if (typeof m.initHash !== "string") why.push("manifest.json has no initHash (not a run built from the preset)");
  const cfg = isRecord(m.cfg) ? m.cfg : {};
  want("cfg.mutRate", cfg.mutRate, REG1_REPORT_RUNS.mutRate);
  want("cfg.pondPeriod", cfg.pondPeriod, REG1_REPORT_RUNS.pondPeriod);
  want("cfg.tilesX", cfg.tilesX, REG1_REPORT_RUNS.side);
  want("cfg.tilesY", cfg.tilesY, REG1_REPORT_RUNS.side);
  want("cfg.pondArm", cfg.pondArm, role.arm === "ancestor" ? "cont" : role.arm);
  if (summary !== null) want("summary.steps", summary.steps, shape.steps);
  const listed = m.preCycleCheckpoints;
  if (!Array.isArray(listed)) why.push("manifest.json lists no preCycleCheckpoints");
  else {
    if (listed.length !== shape.preCycle.length) why.push(`manifest.json lists ${listed.length} preCycleCheckpoints, want ${shape.preCycle.length}`);
    shape.preCycle.forEach((b, k) => {
      const e = listed[k];
      const file = `checkpoints/b${pad3(b)}-pre.blck`;
      if (!isRecord(e) || e.boundary !== b || e.step !== b * REG1_REPORT_RUNS.pondPeriod || e.file !== file || typeof e.hash !== "string" || e.hash === "") {
        why.push(`preCycleCheckpoints[${k}] ${JSON.stringify(e)}, want boundary ${b} at step ${b * REG1_REPORT_RUNS.pondPeriod} in ${file} with its hash`);
      }
    });
  }
  return why;
}

/** The state hashes a bundle's manifest records: its pre-cycle checkpoints by boundary and its initial state (initHash). */
export function reg1ReportBundleHashes(manifest: unknown): Reg1ReportHashes {
  const out: Reg1ReportHashes = {};
  if (!isRecord(manifest)) return out;
  if (typeof manifest.initHash === "string") out.init = manifest.initHash;
  for (const e of Array.isArray(manifest.preCycleCheckpoints) ? manifest.preCycleCheckpoints : []) {
    if (!isRecord(e) || typeof e.hash !== "string") continue;
    if (e.boundary === 1) out.b001 = e.hash;
    if (e.boundary === 34) out.b034 = e.hash;
    if (e.boundary === 100) out.b100 = e.hash;
  }
  return out;
}

/**
 * The one bundle of a history (or ancestor world) among those found for it ("Validity" 2-3): reruns after an infrastructure failure
 * write the same directory, and a run that stopped on an event-buffer overflow is repeated at census 100 under hist-c100 (anc-c100), so
 * exactly one of them may be finished (summary and finishedAt). That one is taken and the unfinished attempts are `superseded`; with none
 * finished a single attempt is taken (and fails as unfinished); two finished bundles, or several unfinished ones, are refused (`why`).
 */
export function reg1ReportPickBundle<T extends { dir: string; manifest: unknown }>(found: readonly T[]): { pick: T | null; superseded: T[]; why: string | null } {
  const finished = (b: T) => isRecord(b.manifest) && isRecord(b.manifest.summary) && typeof b.manifest.finishedAt === "string";
  const done = found.filter(finished);
  if (found.length === 0) return { pick: null, superseded: [], why: "no run bundle" };
  if (done.length > 1) return { pick: null, superseded: [], why: `${done.length} finished run bundles (${done.map((b) => b.dir).join(", ")}); neither is used` };
  if (done.length === 1) return { pick: done[0], superseded: found.filter((b) => b !== done[0]), why: null };
  if (found.length > 1) return { pick: null, superseded: [], why: `${found.length} unfinished run bundles (${found.map((b) => b.dir).join(", ")}) and none finished` };
  return { pick: found[0], superseded: [], why: null };
}

/** A bundle's ponds.tsv, summarised: per boundary its rows, mean pre-cycle pond trait and extinct ponds; its truncation; whether its history ended. */
export interface Reg1ReportTrajectory {
  boundaries: { boundary: number; n: number; meanTrait: number; extinct: number }[];
  /** The truncated share of its recipient rows (protocol v1's truncation rule). */
  truncation: TruncationStat;
  /** The first boundary at which no pond was eligible (every row's donor -1: the history ended and stepped on, cleared); null if none, and for cont. */
  endedAt: number | null;
}

/**
 * One streaming pass over a bundle's ponds.tsv, which must hold one row per pond (recipient) at every boundary 1..cycles and no other
 * (`RecipientGuard` with `expect`): otherwise it throws, and the bundle is unresolved. `cycled` (scaf and rand) reads `endedAt`.
 */
export async function reg1ReportTrajectory(rows: AsyncIterable<TsvRow>, expect: { ponds: number; cycles: number }, cycled: boolean): Promise<Reg1ReportTrajectory> {
  const at = new Map<number, { n: number; sum: number; extinct: number; donors: number }>();
  const guard = new RecipientGuard(expect);
  let n = 0;
  let truncated = 0;
  for await (const r of rows) {
    n++;
    guard.addRow(r);
    if (num(r, "truncated") > 0) truncated++;
    const b = num(r, "cycle");
    const trait = num(r, "recipientTrait");
    let x = at.get(b);
    if (!x) at.set(b, (x = { n: 0, sum: 0, extinct: 0, donors: 0 }));
    x.n++;
    x.sum += trait;
    if (trait === 0) x.extinct++;
    if (num(r, "donor") >= 0) x.donors++;
  }
  guard.finish();
  const sorted = [...at].sort(([p], [q]) => p - q);
  return {
    boundaries: sorted.map(([boundary, x]) => ({ boundary, n: x.n, meanTrait: x.sum / x.n, extinct: x.extinct })),
    truncation: truncationOf(truncated, n),
    endedAt: cycled ? (sorted.find(([, x]) => x.donors === 0)?.[0] ?? null) : null,
  };
}

/** One expected run bundle (a history or an ancestor world) as the report found it. */
export interface Reg1ReportRun {
  id: string;
  arm: Reg1ReportArm;
  history: number;
  /** The bundle directory; null when none was found. */
  dir: string | null;
  /** Found exactly once, finished, with a valid manifest and a complete ponds.tsv; otherwise unresolved, and why. */
  resolved: boolean;
  why: string[];
  hashes: Reg1ReportHashes;
  censusEvery: number | null;
  /** The host and adapter its manifest records (tools/run.ts), which a device check must have covered; null when no one bundle was taken. */
  host: { host: string | null; adapter: string | null } | null;
  trajectory: Reg1ReportTrajectory | null;
}

/** The host and adapter a manifest records (`HostInfo`). */
export function reg1ReportHostOf(manifest: unknown): { host: string | null; adapter: string | null } {
  const h = isRecord(manifest) && isRecord(manifest.host) ? manifest.host : {};
  return { host: typeof h.host === "string" ? h.host : null, adapter: typeof h.adapter === "string" ? h.adapter : null };
}

/** The device check's bundles: the Mac's (its host names darwin, the reference) and one per instance (three). */
export const REG1_REPORT_DEVICES = { bundles: 4, mac: "darwin" } as const;

/** The device check ("Validity" 1) over the --device bundles. */
export interface Reg1ReportDevice {
  /** Four bundles in distinct directories (the Mac's, whose host names darwin, and three instances'), every one the device spec, finished with exact conservation, all with one finalHash, and every run bundle's host and adapter among theirs. */
  passed: boolean;
  reasons: string[];
  finalHash: string | null;
  /** The Mac's bundle (the reference); null unless exactly one host names darwin. */
  mac: string | null;
  bundles: { dir: string; host: string | null; adapter: string | null; finalHash: string | null; problems: string[] }[];
  /** Run bundles whose host and adapter no device check covers. */
  uncovered: string[];
}

/**
 * The device check: four --device bundles in distinct directories, exactly one of them the Mac's (its host names darwin: the reference)
 * and three instances', each preset ponds, condition treatment, seed 4,880,301, 20,000 steps, census 1,000, finished with exact
 * conservation, all reporting one `summary.finalHash`; and every run bundle taken (`runs`, when given) ran on a host and adapter that one
 * of them reports. Anything else fails it: a check that cannot be made fails as a mismatch does.
 */
export function reg1ReportDeviceCheck(bundles: readonly { dir: string; manifest: unknown }[], runs: readonly Pick<Reg1ReportRun, "id" | "host">[] | null = null): Reg1ReportDevice {
  const rows = bundles.map(({ dir, manifest }) => {
    const m = isRecord(manifest) ? manifest : {};
    const role = reg1ReportBundleRoleOf(manifest);
    const problems = "why" in role ? [role.why] : role.role.role !== "device" ? [`spec.seed ${JSON.stringify(isRecord(m.spec) ? m.spec.seed : undefined)} is not the device check's (4,880,301)`] : reg1ReportBundleProblems(manifest, role.role, dir);
    const summary = isRecord(m.summary) ? m.summary : {};
    return { dir, ...reg1ReportHostOf(manifest), finalHash: typeof summary.finalHash === "string" ? summary.finalHash : null, problems };
  });
  const reasons: string[] = [];
  const want = REG1_REPORT_DEVICES;
  if (rows.length !== want.bundles) reasons.push(`${rows.length} device check bundle${rows.length === 1 ? "" : "s"}, want ${want.bundles}: the Mac's and one per instance`);
  const dirs = rows.map((r) => r.dir.replace(/\/+$/, ""));
  if (new Set(dirs).size !== dirs.length) reasons.push(`device check bundles share a directory: ${dirs.filter((d, k) => dirs.indexOf(d) !== k).join(", ")}`);
  const macs = rows.filter((r) => r.host?.includes(want.mac) === true);
  if (macs.length !== 1) reasons.push(`${macs.length} device check bundles ran on a host naming ${want.mac}, want exactly 1 (the Mac's, the reference)`);
  for (const r of rows) if (r.problems.length > 0) reasons.push(`${r.dir}: ${r.problems.join("; ")}`);
  const hashes = [...new Set(rows.map((r) => r.finalHash))];
  if (rows.length > 0 && hashes.length > 1) reasons.push(`finalHash differs between the device check bundles: ${rows.map((r) => `${r.dir} ${r.finalHash}`).join(", ")}`);
  const covered = new Set(rows.map((r) => JSON.stringify([r.host, r.adapter])));
  const uncovered = (runs ?? []).filter((r) => r.host !== null && !covered.has(JSON.stringify([r.host.host, r.host.adapter]))).map((r) => r.id);
  if (uncovered.length > 0) {
    const first = runs!.find((r) => r.id === uncovered[0])!.host!;
    reasons.push(`${uncovered.length} run bundles ran on a host and adapter no device check reports (${uncovered.slice(0, 5).join(", ")}${uncovered.length > 5 ? ", ..." : ""}; ${uncovered[0]} on ${JSON.stringify(first.host)} with ${JSON.stringify(first.adapter)})`);
  }
  const passed = reasons.length === 0;
  return { passed, reasons, finalHash: passed ? rows[0].finalHash : null, mac: macs.length === 1 ? macs[0].dir : null, bundles: rows, uncovered };
}

/**
 * The reproducibility draw ("Validity" 7): the first two distinct values of randomKey(4,880,101, 0, k, 0) mod 72 for k = 0, 1, ..., each
 * naming a history in seed order (scaf 0-23, rand 24-47, cont 48-71), with every draw up to the second distinct value.
 */
export function reg1ReportReproSelection(): { draws: { k: number; value: number }[]; selected: { value: number; arm: "scaf" | "rand" | "cont"; history: number; id: string }[] } {
  const draws: { k: number; value: number }[] = [];
  const values: number[] = [];
  for (let k = 0; values.length < 2; k++) {
    if (k > 100_000) throw new Error("reg1ReportReproSelection: no second distinct value");
    const value = randomKey(REG1_REPORT_SEEDS.reproducibility, 0, k, 0) % (3 * REG1_REPORT_HISTORIES);
    draws.push({ k, value });
    if (!values.includes(value)) values.push(value);
  }
  const selected = values.map((value) => {
    const arm = REG1_ARMS[Math.floor(value / REG1_REPORT_HISTORIES)];
    const history = value % REG1_REPORT_HISTORIES;
    return { value, arm, history, id: reg1ReportHistoryId(arm, history) };
  });
  return { draws, selected };
}

/** The reproducibility check over the selected histories' Mac reruns. */
export interface Reg1ReportReproducibility {
  /** Both selected histories resolved, each with exactly one valid rerun whose b034-pre hash equals the instance's. */
  passed: boolean;
  reasons: string[];
  draws: { k: number; value: number }[];
  histories: { id: string; value: number; instanceHash: string | null; rerun: string | null; rerunHash: string | null; passed: boolean; why: string | null }[];
  /** --repro bundles that are not a rerun of a selected history. */
  skipped: { dir: string; why: string }[];
}

/**
 * The reproducibility check: each selected history (`reg1ReportReproSelection`, never replaced) needs its instance bundle resolved and
 * exactly one rerun among `reruns` (the history's condition and seed, 340,000 steps, its b034-pre listed; `reg1ReportBundleProblems`) made
 * on the Mac (its host names darwin) whose b034-pre hash equals the instance's. A mismatch, a missing or invalid rerun, or an unresolved history fails it.
 */
export function reg1ReportReproducibility(runs: ReadonlyMap<string, Pick<Reg1ReportRun, "resolved" | "hashes">>, reruns: readonly { dir: string; manifest: unknown }[]): Reg1ReportReproducibility {
  const { draws, selected } = reg1ReportReproSelection();
  const skipped: { dir: string; why: string }[] = [];
  const byId = new Map<string, { dir: string; manifest: unknown; role: Reg1ReportBundleRole }[]>();
  for (const r of reruns) {
    const role = reg1ReportBundleRoleOf(r.manifest);
    if ("why" in role) skipped.push({ dir: r.dir, why: role.why });
    else if (role.role.role !== "repro") skipped.push({ dir: r.dir, why: `not a reproducibility rerun (${role.role.role === "device" ? "the device check" : `${role.role.role} ${role.role.id}, ${JSON.stringify(isRecord(r.manifest) && isRecord(r.manifest.spec) ? r.manifest.spec.steps : undefined)} steps`})` });
    else if (!selected.some((s) => s.id === (role.role as { id: string }).id)) skipped.push({ dir: r.dir, why: `${role.role.id} is not a selected history (${selected.map((s) => s.id).join(", ")})` });
    else byId.set(role.role.id, [...(byId.get(role.role.id) ?? []), { ...r, role: role.role }]);
  }
  const histories = selected.map(({ id, value }) => {
    const run = runs.get(id);
    const instanceHash = run?.resolved ? (run.hashes.b034 ?? null) : null;
    const found = byId.get(id) ?? [];
    const base = { id, value, instanceHash, rerun: found.length === 1 ? found[0].dir : null };
    const fail = (why: string, rerunHash: string | null = null) => ({ ...base, rerunHash, passed: false, why });
    if (!run?.resolved) return fail(`${id} is unresolved, so the check cannot be made`);
    if (found.length === 0) return fail(`no rerun of ${id}`);
    if (found.length > 1) return fail(`${found.length} reruns of ${id} (${found.map((f) => f.dir).join(", ")}); neither is used`);
    const problems = reg1ReportBundleProblems(found[0].manifest, found[0].role, found[0].dir);
    const host = reg1ReportHostOf(found[0].manifest).host;
    if (host?.includes(REG1_REPORT_DEVICES.mac) !== true) problems.push(`it ran on host ${JSON.stringify(host)}, not the Mac's (${REG1_REPORT_DEVICES.mac})`);
    const rerunHash = reg1ReportBundleHashes(found[0].manifest).b034 ?? null;
    if (problems.length > 0) return fail(`the rerun of ${id} is not valid: ${problems.join("; ")}`, rerunHash);
    if (rerunHash !== instanceHash) return fail(`the rerun's b034-pre hash ${rerunHash} is not the instance's ${instanceHash}`, rerunHash);
    return { ...base, rerunHash, passed: true, why: null };
  });
  const reasons = histories.filter((h) => !h.passed).map((h) => h.why!);
  return { passed: reasons.length === 0, reasons, draws, histories, skipped };
}

/** An assay directory as read for the registration: its path, assay.json, every assay.tsv row and (S3) traits.tsv. */
export interface Reg1ReportSetDir {
  dir: string;
  json: Record<string, unknown>;
  rows: AssayRow[];
  traits: TraitsRead | null;
}

/**
 * A `scaf` history's source (a) as the report reloaded it from its bundle, for a Ge-on-Fa record that says it has no dominant genome: the
 * state hash and whether it has a dominant genome (`dominantGenome`), or why it could not be read.
 */
export type Reg1ReportDonorCheck = { stateHash: string; dominant: boolean } | { error: string };

/** A screened set of the registration. */
export interface Reg1ReportSet {
  id: string;
  dir: string;
  expected: Reg1ReportExpectedSet;
  /** A Ge-on-Fa record whose donor has no dominant genome (no eligible cell): no rows, a measured failure of H2 and S1, never unresolved. */
  biological: boolean;
  rows: AssayRow[];
  /** S3: the crossing-time fragments, or `insufficient` (fewer than 2 eligible donors, a biological outcome); null for other sets. */
  heredity: { insufficient: boolean; censored: number; fragments: R1dPrimeFragment[] } | null;
}

const HEX_WORDS = new RegExp(`^[0-9a-f]{${R3REP_SWAP_AE_WORDS.length}}$`);

/** What is wrong with the treatment a competence set records (`quench`, `swap`, as competence --r3rep records them) for its kind; Ge-on-Fa's words are its donor's recorded dominant genome. */
function reg1TreatmentProblems(json: Record<string, unknown>, kind: Reg1ReportKind, biological: boolean): string[] {
  const why: string[] = [];
  const quench = kind === "quench";
  if (json.quench !== quench) why.push(`quench ${JSON.stringify(json.quench)}, want ${quench} for ${kind}`);
  const swap = isRecord(json.swap) ? json.swap : null;
  if (kind === "source" || kind === "quench") {
    if (json.swap !== null && json.swap !== undefined) why.push(`swap ${JSON.stringify(json.swap)}, want none: ${kind} plants no swapped genome`);
  } else if (kind === "ga-on-fa" || kind === "ga-on-fe") {
    if (swap?.words !== R3REP_SWAP_AE_WORDS) why.push(`swap words are not M3_FOUNDERS[2]'s relabelled to 0:1: ${kind} plants the ancestor's genome`);
  } else if (kind === "ge-on-fa") {
    const dominant = isRecord(json.provenance) && isRecord(json.provenance.donor) ? json.provenance.donor.dominant : undefined;
    if (biological) {
      if (swap !== null && swap.words !== null && swap.words !== undefined) why.push("swap words are recorded, but a biologically unavailable record plants no genome");
    } else if (typeof swap?.words !== "string" || !HEX_WORDS.test(swap.words)) why.push(`swap ${JSON.stringify(json.swap)}: Ge-on-Fa records the dominant genome it planted (words)`);
    else if (!isRecord(dominant) || swap.words !== dominant.words) why.push(`swap words are not the donor's dominant genome (provenance.donor.dominant.words ${JSON.stringify(isRecord(dominant) ? dominant.words : dominant)})`);
  }
  return why;
}

/** What is wrong with an assay.json's regime for its set (strict): k, period, side, census, replicates and mutation off; competence's ref 103,058, S2's 103,058 or none. */
function reg1RegimeProblems(json: Record<string, unknown>, want: Reg1ReportExpectedSet): string[] {
  const why: string[] = [];
  const r = REG1_REPORT_REGIME;
  for (const [key, value] of [["k", r.k], ["period", r.period], ["side", r.side], ["censusEvery", r.censusEvery], ["replicates", want.replicates], ["mutRate", r.mutRate]] as const) {
    if (json[key] !== value) why.push(`${key} ${JSON.stringify(json[key])}, want ${value}`);
  }
  if (want.assay === "competence" && json.ref !== r.ref) why.push(`ref ${JSON.stringify(json.ref)}, want ${r.ref}`);
  if (want.assay === "garden" && json.ref !== r.ref && json.ref !== null && json.ref !== undefined) why.push(`ref ${JSON.stringify(json.ref)}, want ${r.ref} or none`);
  return why;
}

/** What is wrong with an assay.json's seeds (and S3's donor seed) against the set's formula. */
function reg1SeedProblems(json: Record<string, unknown>, want: Reg1ReportExpectedSet): string[] {
  const seeds = json.seeds;
  if (!Array.isArray(seeds) || seeds.length !== want.replicates) return [`assay.json has ${Array.isArray(seeds) ? seeds.length : "no"} seeds, want ${want.replicates} {physics, fragment}`];
  const why: string[] = [];
  seeds.forEach((sd, s) => {
    const w = want.seeds[s];
    if (!isRecord(sd) || sd.physics !== w.physics || sd.fragment !== w.fragment) why.push(`seeds[${s}] ${JSON.stringify(sd)} do not match ${want.id}: want ${JSON.stringify(w)} (${want.formula})`);
  });
  if (want.donorSeed !== null && json.donorSeed !== want.donorSeed) why.push(`donorSeed ${JSON.stringify(json.donorSeed)}, want ${want.donorSeed} (s = 9)`);
  return why;
}

const endsInPath = (path: string, tail: string): boolean => path === tail || path.endsWith(`/${tail}`);

/**
 * What is wrong with an assay.json's recorded source (strict). Its provenance's `stateHash` (and, for Ge-on-Fa, the donor's
 * `provenance.donor.stateHash`) must be recorded and, where the source is a bundle's pre-cycle checkpoint or initial world and that bundle
 * was loaded and resolved, equal the hash its manifest records. A timing (b) source is the continuation scaffold/reg1/cont200k/<id>.blck.gz
 * with its sidecar (`reg1ContinuationProblems`: seed, steps, census, the timing (a) source it names and the end state) and that timing (a)
 * source's state hash the manifest's b100-pre (b001-pre for an ancestor world). An S3 control's is the R1'' record of its world
 * (`reg1ControlProblems`: path, seed, mutation off, step, genomes and the pre-cycle phase), the assay's own source. A bundle that is not
 * resolved leaves the set unresolved anyway, so nothing is compared against it here.
 */
function reg1ProvenanceProblems(json: Record<string, unknown>, want: Reg1ReportExpectedSet, bundles: ReadonlyMap<string, { resolved: boolean; hashes: Reg1ReportHashes }>, sha: string): string[] {
  const p = json.provenance;
  if (want.sources.length === 0) {
    const control = r1dPrimeProvenanceOf(p);
    if (control === null) return ["assay.json has no provenance of the control world with its phase check (run the assay with --reg1)"];
    return [...reg1ControlProblems(want.labels.h, control), ...(control.source !== json.source ? [`provenance.source ${JSON.stringify(control.source)} is not the assay's source ${JSON.stringify(json.source)}`] : [])];
  }
  if (!isRecord(p)) return ["assay.json has no provenance of its source (run the assay with --reg1)"];
  const why: string[] = [];
  const manifestHash = (bundle: string, checkpoint: Exclude<Reg1ReportCheckpoint, "continuation">) => {
    const b = bundles.get(bundle);
    return b?.resolved ? b.hashes[checkpoint] : undefined;
  };
  const check = (role: string, rec: unknown, src: Reg1ReportExpectedSet["sources"][number]) => {
    if (!isRecord(rec) || typeof rec.stateHash !== "string" || rec.stateHash === "") {
      why.push(`${role} records no stateHash`);
      return;
    }
    if (src.checkpoint === "continuation") {
      const path = reg1ContinuationPathOf(want.labels.h);
      if (typeof rec.source !== "string" || !endsInPath(rec.source, path)) why.push(`${role} source ${JSON.stringify(rec.source)} does not end in ${path}`);
      why.push(...reg1ContinuationProblems(want.labels.h, rec.continuation, rec.origin, rec, sha));
      const origin = src.bundle.startsWith("ancestor-") ? "b001" : "b100";
      const hash = manifestHash(src.bundle, origin);
      const recorded = isRecord(rec.origin) ? rec.origin.stateHash : undefined;
      if (hash !== undefined && recorded !== hash) why.push(`${role}.origin stateHash ${JSON.stringify(recorded)} is not ${src.bundle}'s ${origin}-pre hash ${hash} in its manifest`);
      return;
    }
    const hash = manifestHash(src.bundle, src.checkpoint);
    if (hash !== undefined && rec.stateHash !== hash) why.push(`${role} stateHash ${rec.stateHash} is not ${src.bundle}'s ${src.checkpoint === "init" ? "initHash" : `${src.checkpoint}-pre hash`} ${hash} in its manifest`);
  };
  check("provenance", p, want.sources[0]);
  if (want.sources.length > 1) check("provenance.donor", p.donor, want.sources[1]);
  return why;
}

/**
 * What is wrong with a Ge-on-Fa set's `biologicallyUnavailable` record: { reason "no dominant genome", donor, donorStateHash } with
 * summary.rows 0, its provenance.donor recording no dominant genome and that state hash, and its donor (scaf_i's source (a), reloaded by
 * the report: `donors`) must have that state hash and indeed no dominant genome. In strict mode a donor the report could not reload rejects the record: "no dominant genome" is seen on the checkpoint, never
 * taken from the record alone.
 */
function reg1UnavailableProblems(json: Record<string, unknown>, want: Reg1ReportExpectedSet, donors: ReadonlyMap<string, Reg1ReportDonorCheck>, strict: boolean): string[] {
  const rec = json.biologicallyUnavailable;
  if (!isRecord(rec) || rec.reason !== "no dominant genome" || typeof rec.donorStateHash !== "string") return [`biologicallyUnavailable ${JSON.stringify(rec)} is not { reason: "no dominant genome", donor, donorStateHash }`];
  const why: string[] = [];
  const summary = isRecord(json.summary) ? json.summary : {};
  if (summary.rows !== 0) why.push(`summary.rows ${JSON.stringify(summary.rows)}, want 0`);
  const recorded = isRecord(json.provenance) && isRecord(json.provenance.donor) ? json.provenance.donor : null;
  if (recorded === null || recorded.dominant !== null) why.push(`provenance.donor.dominant ${JSON.stringify(recorded?.dominant)}, want null (no eligible cell)`);
  if (recorded !== null && rec.donorStateHash !== recorded.stateHash) why.push(`biologicallyUnavailable.donorStateHash ${rec.donorStateHash} is not provenance.donor.stateHash ${JSON.stringify(recorded.stateHash)}`);
  const donor = want.sources[1].bundle;
  const check = donors.get(donor);
  if (check === undefined) {
    if (strict) why.push(`a biologically unavailable record needs its donor ${donor}'s b100-pre reloaded, to see that it has no dominant genome, but the report could not reach it`);
  } else if ("error" in check) why.push(`donor ${donor}'s b100-pre could not be read: ${check.error}`);
  else {
    if (check.stateHash !== rec.donorStateHash) why.push(`donor ${donor}'s b100-pre hashes to ${check.stateHash}, but the record names ${rec.donorStateHash}`);
    if (check.dominant) why.push(`donor ${donor} has a dominant genome, so its Ge-on-Fa set is not biologically unavailable`);
  }
  return why;
}

/**
 * Screens the registration's assay directories (labels.reg1) before the stage reads them. Every problem of a set is collected and the set
 * rejected with its directory, id (null when its labels name no set) and reasons; nothing throws for one bad set. A set needs labels that
 * name one of `reg1ReportExpectedSets` and agree with it in full, the set's assay, and rows that fill its (replicate, pond) grid exactly
 * once: competence rows of the set's inoculum with a success flag of 0 or 1 and a positive ref; S2's of fragment (raw) or disc
 * inoculum; S3's fragment rows with retE and a traits.tsv that R1'' can read (none for fewer than 2 eligible donors). A competence set's
 * treatment must be its kind's (`quench`; Ga-on-Fa and Ga-on-Fe plant M3_FOUNDERS[2] relabelled; Ge-on-Fa a dominant genome). Only
 * Ge-on-Fa may be a biologically unavailable record, with no rows and its donor reloaded (`reg1UnavailableProblems`). In strict mode
 * the regime (`REG1_REPORT_REGIME`, the set's replicates), every seed against the set's formula, protocolSha256Reg1 against `sha` (the
 * pinned SHA-256) and the recorded source (`reg1ProvenanceProblems`, against `bundles`: a continuation's sidecar and an S3 control's
 * world included) are checked too. Two sets that pass with one id
 * are both rejected. `allowAnySeed` (smoke runs) waives the regime, seeds, hash and provenance and holds the set to the grid it declares.
 */
export function reg1ReportScreen(
  dirs: readonly Reg1ReportSetDir[],
  o: { sha: string; bundles?: ReadonlyMap<string, { resolved: boolean; hashes: Reg1ReportHashes }>; donors?: ReadonlyMap<string, Reg1ReportDonorCheck>; allowAnySeed?: boolean },
): { accepted: Reg1ReportSet[]; rejected: { dir: string; id: string | null; reasons: string[] }[] } {
  const strict = !o.allowAnySeed;
  const candidates: Reg1ReportSet[] = [];
  const rejected: { dir: string; id: string | null; reasons: string[] }[] = [];
  for (const d of dirs) {
    const { json, rows } = d;
    const named = reg1ReportSetIdOf(json.labels);
    if ("error" in named) {
      rejected.push({ dir: d.dir, id: null, reasons: [named.error] });
      continue;
    }
    const want = reg1ReportExpectedSet(named.id)!;
    const kind = want.labels.set;
    const why = reg1ReportLabelProblems(json.labels as Record<string, unknown>, want);
    if (json.assay !== want.assay) why.push(`assay ${JSON.stringify(json.assay)}, want ${want.assay}`);
    const grid: FragmentGrid | null = strict ? { replicates: want.replicates, ponds: REG1_PONDS } : gridOfJson(json);
    const biological = json.biologicallyUnavailable !== undefined;
    let heredity: Reg1ReportSet["heredity"] = null;
    if (biological) {
      if (kind !== "ge-on-fa") why.push(`only Ge-on-Fa can be biologically unavailable (no dominant genome), not ${want.id}`);
      else why.push(...reg1UnavailableProblems(json, want, o.donors ?? new Map(), strict));
      if (rows.length !== 0) why.push(`${rows.length} rows, want 0 (a biologically unavailable record has none)`);
    } else if (kind === "heredity") {
      const insufficient = json.insufficient === true;
      if (insufficient) {
        if (rows.length !== 0) why.push(`${rows.length} rows, want 0 (fewer than 2 eligible donors)`);
      } else if (grid === null) why.push("assay.json has no side and replicates");
      else {
        if (rows.length !== grid.replicates * grid.ponds) why.push(`${rows.length} rows, want ${grid.replicates * grid.ponds}`);
        why.push(...rowsProblems(rows, grid));
      }
      if (rows.some((r) => r.retE === null)) why.push("assay.tsv has no retE column, so R1''s covariate is missing");
      heredity = { insufficient, ...crossingFragments(json, rows, d.traits, why, strict) };
    } else {
      if (grid === null) why.push("assay.json has no side and replicates");
      else {
        if (rows.length !== grid.replicates * grid.ponds) why.push(`${rows.length} rows, want ${grid.replicates * grid.ponds}`);
        const v = gridViolations(rows, grid);
        if (v.repeated > 0) why.push(`assay.tsv repeats a (replicate, pond) in ${v.repeated} rows`);
        if (v.outside > 0) why.push(`assay.tsv has ${v.outside} rows outside the ${grid.replicates} x ${grid.ponds} (replicate, pond) grid`);
      }
      const inoculum = json.inoculum;
      if (typeof inoculum !== "string") why.push(`inoculum ${JSON.stringify(inoculum)} is not recorded`);
      else if (kind === "garden-raw" && inoculum !== "fragment") why.push(`inoculum ${JSON.stringify(inoculum)}, want fragment (the raw inoculum)`);
      else if (kind === "garden-disc" && inoculum !== "disc") why.push(`inoculum ${JSON.stringify(inoculum)}, want disc (the standardised inoculum)`);
      const other = rows.filter((r) => r.inoculum !== inoculum).length;
      if (other > 0) why.push(`${other} assay.tsv rows are not ${inoculum} rows`);
      const notAssay = rows.filter((r) => r.assay !== want.assay).length;
      if (notAssay > 0) why.push(`${notAssay} assay.tsv rows are not ${want.assay} rows`);
      if (want.assay === "competence") {
        if (!(typeof json.ref === "number" && json.ref > 0)) why.push(`ref ${JSON.stringify(json.ref)}: competence needs a positive ref`);
        const unflagged = rows.filter((r) => r.success !== 0 && r.success !== 1).length;
        if (unflagged > 0) why.push(`${unflagged} assay.tsv rows have no success flag (0 or 1)`);
      }
    }
    if (want.assay === "competence") why.push(...reg1TreatmentProblems(json, kind, biological));
    if (strict) {
      why.push(...reg1RegimeProblems(json, want));
      why.push(...reg1SeedProblems(json, want));
      if (json.protocolSha256Reg1 !== o.sha) why.push(`protocolSha256Reg1 ${JSON.stringify(json.protocolSha256Reg1)} is not the pinned SHA-256 of ${REG1_REPORT_PROTOCOL.doc} (${o.sha})`);
      why.push(...reg1ProvenanceProblems(json, want, o.bundles ?? new Map(), o.sha));
    }
    if (why.length > 0) rejected.push({ dir: d.dir, id: want.id, reasons: why });
    else candidates.push({ id: want.id, dir: d.dir, expected: want, biological, rows, heredity });
  }
  // Two sets for one id are ambiguous: neither is used, and the set is unresolved.
  const accepted: Reg1ReportSet[] = [];
  for (const c of candidates) {
    const same = candidates.filter((x) => x.id === c.id);
    if (same.length > 1) rejected.push({ dir: c.dir, id: c.id, reasons: [`the same registration set (${c.id}) as ${same.filter((x) => x !== c).map((x) => x.dir).join(", ")}; a stage would count both`] });
    else accepted.push(c);
  }
  return { accepted, rejected };
}

/** One expected set as the rule reads it. */
export interface Reg1ReportSetStatus {
  id: string;
  kind: Reg1ReportKind;
  owner: string | null;
  /** "measured" (screened, its source bundles resolved), "biological" (a Ge-on-Fa record without a dominant genome: a measured failure) or "unresolved" (missing, rejected, or a source bundle unresolved). */
  status: "measured" | "biological" | "unresolved";
  why: string | null;
  dir: string | null;
}

/**
 * Every expected set's status ("Validity" 4): a set that is missing or rejected (`rejected` names its id, with the reasons carried) is
 * unresolved, never dropped; so is a set whose source bundle (`runs`, by history id) is missing or unresolved, since its source cannot
 * be the manifest-recorded one. A Ge-on-Fa set without a dominant genome is biological.
 */
export function reg1ReportStatuses(sets: readonly Reg1ReportSet[], rejected: readonly { id: string | null; reasons: string[] }[], runs: ReadonlyMap<string, Pick<Reg1ReportRun, "resolved">>): Reg1ReportSetStatus[] {
  const byId = new Map(sets.map((s) => [s.id, s]));
  return reg1ReportExpectedSets().map((want) => {
    const base = { id: want.id, kind: want.labels.set, owner: want.owner };
    const set = byId.get(want.id);
    if (!set) {
      const rej = rejected.filter((r) => r.id === want.id);
      return { ...base, status: "unresolved", why: rej.length ? `set rejected: ${rej.flatMap((r) => r.reasons).join("; ")}` : "no assay set", dir: null };
    }
    const gone = [...new Set(want.sources.map((x) => x.bundle))].filter((b) => !runs.get(b)?.resolved);
    if (gone.length > 0) return { ...base, status: "unresolved", why: `its source bundle ${gone.map((b) => `${b} (${runs.has(b) ? "unresolved" : "not found"})`).join(", ")} is not resolved`, dir: set.dir };
    return { ...base, status: set.biological ? "biological" : "measured", why: set.biological ? "Ge-on-Fa: the donor has no dominant genome (no eligible cell)" : null, dir: set.dir };
  });
}

/**
 * The registration's one definition of "unresolved" ("Validity, missing data and availability" 4-5), as the readout states it. A history's
 * sets are those it owns (`Reg1ReportExpectedSet.owner`: the swap pair is scaf_i's).
 */
export const REG1_REPORT_UNRESOLVED =
  "A history is unresolved when its run bundle or any of its sets is (scaf: a, b, Ge-on-Fa, Ga-on-Fa, Ga-on-Fe, both quenched controls, its four S2 sets and its S3 set; rand: a, b, S2 and S3; cont: a and b; an ancestor world: a and b), and a set when it is missing, rejected or reads an unresolved bundle. That count decides the more-than-6 rule; an unresolved history is not positive in H2, S1 and S2a and not significant in S3. A rank-test value (H1, S2b) is unresolved when its own set or bundle is, or, for a scaf history, when either quenched control is (step 5).";

/** A history's (or ancestor world's) unresolved parts: its run bundle and the sets that belong to it. */
export interface Reg1ReportHistoryStatus {
  id: string;
  arm: Reg1ReportArm;
  history: number;
  /** The bundle (`<id> run`) and the set ids that are unresolved; the history is unresolved when any is (`REG1_REPORT_UNRESOLVED`). */
  unresolved: string[];
}

/** Every history's and ancestor world's unresolved parts, in `reg1ReportExpectedRuns` order. */
export function reg1ReportHistoryStatuses(statuses: readonly Reg1ReportSetStatus[], runs: ReadonlyMap<string, Pick<Reg1ReportRun, "resolved">>): Reg1ReportHistoryStatus[] {
  return reg1ReportExpectedRuns().map(({ id, arm, history }) => {
    const own = statuses.filter((s) => s.owner === id && s.status === "unresolved");
    return { id, arm, history, unresolved: [...(runs.get(id)?.resolved ? [] : [`${id} run`]), ...own.map((s) => s.id)] };
  });
}

/**
 * P(X >= k) for X ~ Binomial(n, num / den), summed exactly over integers (BigInt) and divided once in floating point. The sign test is
 * num / den = 1 / 2; S3's per-history null rate is 1 / 20.
 */
export function binomialUpperTail(k: number, n: number, num = 1, den = 2): number {
  if (!Number.isInteger(n) || n < 0 || !Number.isInteger(k) || !Number.isInteger(num) || !Number.isInteger(den) || den < 1 || num < 0 || num > den) throw new Error(`binomialUpperTail: need integers k, n >= 0 and 0 <= num <= den, got k=${k} n=${n} ${num}/${den}`);
  if (k <= 0) return 1;
  if (k > n) return 0;
  const p = BigInt(num);
  const q = BigInt(den - num);
  let c = 1n;
  let tail = 0n;
  for (let j = 0; j <= n; j++) {
    if (j >= k) tail += c * p ** BigInt(j) * q ** BigInt(n - j);
    c = (c * BigInt(n - j)) / BigInt(j + 1);
  }
  return Number(tail) / Number(BigInt(den) ** BigInt(n));
}

/** The exact one-sided sign test ("Primary tests"): P(X >= positive) for X ~ Binomial(n, 1/2). */
export const reg1ReportSignTest = (positive: number, n: number): number => binomialUpperTail(positive, n, 1, 2);

/** S1's percentile bootstrap: 10,000 resamples, the 95% interval by nearest rank (the 250th and 9,750th of the sorted resample medians). */
export const REG1_REPORT_BOOTSTRAP = { resamples: 10_000, lower: 25, upper: 975, per: 1000 } as const;
/** How the S1 ratio's interval is taken, as the readout records it (the document leaves the percentile rule and the history order open). */
export const REG1_REPORT_BOOTSTRAP_METHOD = "nearest-rank percentiles 250/9750 of 10,000 sorted medians; eligible histories in ascending i";

/**
 * The median of `xs` (in the order given) with a percentile bootstrap interval: resample r = 0..B-1 takes xs[randomKey(seed, r, j, 0) mod m]
 * for j = 0..m-1, and the interval is the ⌈0.025 B⌉-th and ⌈0.975 B⌉-th smallest of the B resample medians (nearest rank). null for an
 * empty `xs`: the ratio is unavailable.
 */
export function reg1ReportBootstrapMedian(xs: readonly number[], seed: number = REG1_REPORT_SEEDS.bootstrap, B: number = REG1_REPORT_BOOTSTRAP.resamples): { m: number; median: number; lower: number; upper: number; resamples: number } | null {
  const m = xs.length;
  if (m === 0) return null;
  const medians = new Float64Array(B);
  const pick = new Array<number>(m);
  for (let r = 0; r < B; r++) {
    for (let j = 0; j < m; j++) pick[j] = xs[randomKey(seed, r, j, 0) % m];
    medians[r] = median(pick);
  }
  medians.sort();
  const { lower, upper, per } = REG1_REPORT_BOOTSTRAP;
  const nearest = (q: number) => medians[Math.max(1, Math.ceil((q * B) / per)) - 1];
  return { m, median: median(xs), lower: nearest(lower), upper: nearest(upper), resamples: B };
}

/** The outcome table ("Outcomes and disposition"), in order: the first matching row is the outcome. */
export const REG1_REPORT_OUTCOMES = [
  { outcome: "Invalid", statement: "The device, quenched or reproducibility check failed.", next: "Report; no claim." },
  { outcome: "Uninformative", statement: "More than 6 unresolved histories in an arm, or the budget stopped the queue.", next: "Report; decide whether to complete or rerun." },
  {
    outcome: "H1 and H2 confirmed",
    statement: 'Both claims as stated under "What a confirmed result would and would not mean", reported separately; "heritable" only if S3 holds in `scaf`.',
    next: "Next rung toward endogenisation, e.g. protocol v1's withdrawal ladder (longer removal, partial grind, migration-only dispersal), and the M7 question.",
  },
  { outcome: "H1 confirmed, H2 not", statement: "Persistence beyond the controls is confirmed; the genome effect is not confirmed by this registration. The advantage may sit in community composition or physical structure.", next: "Dissect: multi-genome swaps, community transplants." },
  { outcome: "H2 confirmed, H1 not", statement: "The genome effect is confirmed; `scaf`'s advantage over every control is not, and the failed comparisons are named.", next: "Report which comparisons did not establish higher `scaf` competence, distinguishing uninformative ones." },
  { outcome: "Neither", statement: "Not confirmed by this registration.", next: "Report; the exploratory results stay as recorded." },
] as const;
export type Reg1ReportOutcome = (typeof REG1_REPORT_OUTCOMES)[number]["outcome"];
/** The table's note on H1 ("Outcomes and disposition"). */
export const REG1_REPORT_H1_NOTE = "If an unresolved value entered an H1 comparison, H1 is uninformative: it counts as not confirmed for this table, with Holm slot p = 1, and the report marks it uninformative rather than not confirmed.";

/** One of H1's six comparisons: scaf against `other` at `timing`. */
export interface Reg1ReportComparison {
  other: "rand" | "cont" | "ancestor";
  timing: "a" | "b";
  n: { scaf: number; other: number };
  /** The exact one-sided Mann-Whitney p that scaf ranks higher; null when uninformative. */
  p: number | null;
  /** An unresolved value would enter it (listed): the comparison is uninformative and not run. */
  uninformative: boolean;
  unresolved: string[];
  /** Its p alone would confirm H1 in the primary Holm family (beside H2's p); null when uninformative. */
  established: boolean | null;
  medians: { scaf: number | null; other: number | null };
}

/** One history's term of a sign test: measured (with its value), a failure without a dominant genome, or unresolved; only a measured positive one counts. */
export interface Reg1ReportSignTerm {
  id: string;
  status: "measured" | "no dominant genome" | "unresolved";
  value: number | null;
  positive: boolean;
  why: string | null;
}

/** An exact sign test over a family's terms (`n` the histories, unresolved and failures included as not positive). */
export interface Reg1ReportSign {
  positive: number;
  n: number;
  p: number;
  terms: Reg1ReportSignTerm[];
}

/** One S3 set (`r1dPrimeStat` on its crossing times, stream 4,866,001 + 250 h + 8). */
export interface Reg1ReportS3Entry {
  id: string;
  h: number;
  arm: "scaf" | "rand" | "control";
  control: "positive" | "negative" | null;
  history: number | null;
  /** "analysed", "donors" (fewer than 2 eligible donors: biological, not significant) or "unresolved" (not significant). */
  outcome: "analysed" | "donors" | "unresolved";
  why: string | null;
  n: number;
  families: number;
  icc: number | null;
  p: number | null;
  /** ICC > 0 and p < 0.05. */
  demonstrated: boolean;
  /** p < 0.05. */
  significant: boolean;
  /** Analysed with scores that can carry the test (not degenerate). */
  tested: boolean;
  degenerate: R1dPrimeDegeneracy | null;
}

/** The validity checks ("Validity, missing data and availability"), evaluated once over every history. */
export interface Reg1ReportValidity {
  device: { passed: boolean; reasons: string[] };
  unresolved: { limit: number; arms: Record<Reg1ReportArm, { histories: number; unresolved: number; ids: string[] }>; uninformative: boolean };
  quenched: { limit: number; sets: { id: string; successes: number; n: number; competence: number | null; above: boolean }[]; max: number | null; failed: boolean };
  reproducibility: { passed: boolean; reasons: string[] };
}

/** The tests on one set of histories (all of them, or without the truncation-flagged ones), and the row they decide. */
export interface Reg1ReportTests {
  /** The row the tests pick (H1 and H2 under Holm), when the validity checks leave it to them. */
  outcome: Exclude<Reg1ReportOutcome, "Invalid" | "Uninformative">;
  reasons: string[];
  /** Histories left out (the truncation sensitivity). */
  excluded: string[];
  primary: {
    alpha: number;
    h1: { status: "confirmed" | "not confirmed" | "uninformative"; p: number | null; slot: number; holm: number; comparisons: Reg1ReportComparison[] };
    h2: Reg1ReportSign & { status: "confirmed" | "not confirmed"; holm: number };
  };
  secondary: {
    alpha: number;
    s1: Reg1ReportSign & {
      status: "confirmed" | "not confirmed";
      holm: number;
      ratio: { eligible: { id: string; ratio: number }[]; excluded: { unresolved: number; noDominantGenome: number; nonPositiveDenominator: number }; median: number | null; interval: { lower: number; upper: number; resamples: number } | null; available: boolean; method: string };
    };
    s2a: Reg1ReportSign & { status: "confirmed" | "not confirmed"; holm: number };
    s2b: { status: "confirmed" | "not confirmed" | "uninformative"; p: number | null; slot: number; holm: number; n: { scaf: number; rand: number }; unresolved: string[]; medians: { scaf: number | null; rand: number | null } };
    s3: {
      status: "confirmed" | "not confirmed" | "uninformative";
      p: number | null;
      slot: number;
      holm: number;
      gates: { positivePassed: boolean; nullGatePassed: boolean; positive: Reg1ReportS3Entry[]; negative: Reg1ReportS3Entry[] };
      arms: Record<"scaf" | "rand", { n: number; demonstrated: number; p: number }>;
      histories: Reg1ReportS3Entry[];
    };
    /** "Heritable" is used for the pond-level trait only if S3 is confirmed in scaf. */
    heritable: boolean;
    gains: { scaf: { id: string; gain: number | null; status: "measured" | "unresolved" }[]; rand: { id: string; gain: number | null; status: "measured" | "unresolved" }[] };
  };
}

/** The registration's evaluation: validity once over every history, then the tests, and the row. */
export interface Reg1ReportEvaluation {
  outcome: Reg1ReportOutcome;
  reasons: string[];
  validity: Reg1ReportValidity;
  /** The tests decided the row (the validity checks did not settle it as Invalid or Uninformative); the readout withholds them otherwise. */
  applied: boolean;
  tests: Reg1ReportTests;
}

const reg1HeredityStats = new WeakMap<Reg1ReportSet, R1dPrimeStat>();

/** R1''s statistic on an S3 set's crossing times with the stream 4,866,001 + 250 h + 8, kept per set object (1,000 permutations each). */
function reg1HeredityStat(set: Reg1ReportSet): R1dPrimeStat {
  let st = reg1HeredityStats.get(set);
  if (!st) reg1HeredityStats.set(set, (st = r1dPrimeStat(set.heredity!.fragments, reg1ReportHereditySeed(set.expected.labels.h, 8))));
  return st;
}

/**
 * The validity checks, in the document's order, over every history: the device check, the unresolved histories (more than 6 in an arm or
 * in the ancestor worlds is uninformative), the quenched gate (any screened quenched set above 0.05 is invalid, whatever else holds) and
 * the reproducibility check (`reg1ReportDeviceCheck` and `reg1ReportReproducibility` are inputs). Invalid comes before Uninformative in
 * the outcome table. They are never re-run without the truncation-flagged histories.
 */
export function reg1ReportValidity(
  sets: readonly Reg1ReportSet[],
  histories: readonly Reg1ReportHistoryStatus[],
  gates: { device: Pick<Reg1ReportDevice, "passed" | "reasons">; reproducibility: Pick<Reg1ReportReproducibility, "passed" | "reasons"> },
): { validity: Reg1ReportValidity; invalid: boolean; uninformative: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const arms = Object.fromEntries(
    REG1_ALL_ARMS.map((arm) => {
      const hs = histories.filter((h) => h.arm === arm);
      const bad = hs.filter((h) => h.unresolved.length > 0);
      return [arm, { histories: hs.length, unresolved: bad.length, ids: bad.map((h) => h.id) }];
    }),
  ) as Reg1ReportValidity["unresolved"]["arms"];
  const tooMany = REG1_ALL_ARMS.filter((arm) => arms[arm].unresolved > REG1_REPORT_UNRESOLVED_LIMIT);
  const quenchedSets = sets
    .filter((s) => s.expected.labels.set === "quench")
    .map((s) => {
      const successes = s.rows.filter((r) => r.success === 1).length;
      const n = s.rows.length;
      // competence > 0.05, exactly: 20 successes > n.
      return { id: s.id, successes, n, competence: n > 0 ? successes / n : null, above: 20 * successes > n };
    });
  const quenched = { limit: R3_QUENCH_LIMIT, sets: quenchedSets, max: quenchedSets.length ? Math.max(...quenchedSets.map((q) => q.competence ?? 0)) : null, failed: quenchedSets.some((q) => q.above) };
  if (!gates.device.passed) reasons.push(`device check failed: ${gates.device.reasons.join("; ")}`);
  for (const q of quenchedSets.filter((x) => x.above)) reasons.push(`quenched control ${q.id} has competence ${q.successes}/${q.n}, above ${R3_QUENCH_LIMIT}`);
  if (!gates.reproducibility.passed) reasons.push(`reproducibility check failed: ${gates.reproducibility.reasons.join("; ")}`);
  for (const arm of tooMany) reasons.push(`${arm === "ancestor" ? "the ancestor worlds have" : `${arm} has`} ${arms[arm].unresolved} unresolved histories, more than ${REG1_REPORT_UNRESOLVED_LIMIT} (${arms[arm].ids.join(", ")})`);
  return {
    validity: { device: { passed: gates.device.passed, reasons: gates.device.reasons }, unresolved: { limit: REG1_REPORT_UNRESOLVED_LIMIT, arms, uninformative: tooMany.length > 0 }, quenched, reproducibility: { passed: gates.reproducibility.passed, reasons: gates.reproducibility.reasons } },
    invalid: !gates.device.passed || quenched.failed || !gates.reproducibility.passed,
    uninformative: tooMany.length > 0,
    reasons,
  };
}

/**
 * The registration's tests over the screened sets, with one definition of unresolved (`REG1_REPORT_UNRESOLVED`). The primary tests (H1: six
 * exact one-sided Mann-Whitney tests, p the largest, uninformative with Holm slot 1 when an unresolved value would enter one; H2: the exact
 * sign test on g_i > 0, an unresolved history and a missing dominant genome counted as not positive; Holm over {H1, H2} at 0.01) pick the
 * row; the secondary tests (S1, S2a, S2b, S3; their own Holm family) are reported beside it. `exclude` names histories left out whole (their
 * values and terms; a sign test's n counts the rest), for the truncation sensitivity.
 */
export function reg1ReportTests(sets: readonly Reg1ReportSet[], statuses: readonly Reg1ReportSetStatus[], histories: readonly Reg1ReportHistoryStatus[], exclude: ReadonlySet<string> = new Set()): Reg1ReportTests {
  const alpha = REG1_REPORT_ALPHA;
  const setById = new Map(sets.map((s) => [s.id, s]));
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const historyById = new Map(histories.map((h) => [h.id, h]));
  const kept = (arm: Reg1ReportArm) => Array.from({ length: REG1_REPORT_HISTORIES }, (_, i) => i).filter((i) => !exclude.has(reg1ReportHistoryId(arm, i)));
  const status = (id: string) => statusById.get(id) ?? { id, status: "unresolved" as const, why: "not an expected set", dir: null };
  /** Why a history is unresolved (its unresolved parts), or null: such a history is not positive in a sign test and not significant in S3. */
  const historyGone = (id: string): string | null => {
    const parts = historyById.get(id)?.unresolved ?? [`${id} run`];
    return parts.length > 0 ? `${id} is unresolved (${parts.join(", ")})` : null;
  };
  /** Why a rank-test value is unresolved: its own set (or the bundle it reads) is, or, for a scaf history, either quenched control (step 5). */
  const valueGone = (id: string, owner: string): string | null => {
    if (status(id).status === "unresolved") return `${id}: ${status(id).why}`;
    if (!owner.startsWith("scaf-")) return null;
    const q = [`${owner}-quench-a`, `${owner}-quench-b`].filter((x) => status(x).status === "unresolved");
    return q.length > 0 ? `${id}: its history's quenched control ${q.join(", ")} is unresolved` : null;
  };
  /** A measured competence set's successes and fragments; null unless measured. */
  const comp = (id: string): { successes: number; n: number } | null => {
    const s = setById.get(id);
    if (!s || status(id).status !== "measured") return null;
    return { successes: s.rows.filter((r) => r.success === 1).length, n: s.rows.length };
  };
  const frac = (c: { successes: number; n: number }) => c.successes / c.n;
  const reasons: string[] = [];

  // H2 (and S1's terms): g_i on the swap pair's identical fragments. A missing dominant genome is a measured failure, named before
  // any unresolved part; an unresolved history (or, for d_i, an unresolved ancestor_i (a)) is not positive.
  const swapTerm = (i: number, dTerm: boolean): Reg1ReportSignTerm & { g: number | null; adv: number | null; advPositive: boolean } => {
    const scaf = reg1ReportHistoryId("scaf", i);
    const anc = reg1ReportHistoryId("ancestor", i);
    const base = { id: scaf, g: null, adv: null, advPositive: false, value: null, positive: false };
    if (status(`${scaf}-ge-on-fa`).status === "biological") return { ...base, status: "no dominant genome", why: `${scaf}'s source (a) has no eligible cell` };
    const gone = [historyGone(scaf), dTerm ? valueGone(`${anc}-a`, anc) : null].filter((x): x is string => x !== null);
    if (gone.length > 0) return { ...base, status: "unresolved", why: gone.join("; ") };
    const e = comp(`${scaf}-ge-on-fa`)!;
    const a = comp(`${scaf}-ga-on-fa`)!;
    const g = frac(e) - frac(a);
    if (!dTerm) return { ...base, status: "measured", why: null, g, value: g, positive: e.successes * a.n > a.successes * e.n };
    const s = comp(`${scaf}-a`)!;
    const w = comp(`${anc}-a`)!;
    const adv = frac(s) - frac(w);
    // d_i = g_i - adv_i / 2 > 0, exactly: 2 (Se na - Sa ne) ns nw > (Ss nw - Sw ns) ne na.
    const positive = 2 * (e.successes * a.n - a.successes * e.n) * s.n * w.n > (s.successes * w.n - w.successes * s.n) * e.n * a.n;
    return { ...base, status: "measured", why: null, g, adv, advPositive: s.successes * w.n > w.successes * s.n, value: g - 0.5 * adv, positive };
  };
  const signOf = (terms: Reg1ReportSignTerm[]): Reg1ReportSign => {
    const positive = terms.filter((t) => t.positive).length;
    return { positive, n: terms.length, p: reg1ReportSignTest(positive, terms.length), terms };
  };
  const swapIdx = kept("scaf").filter((i) => !exclude.has(reg1ReportHistoryId("ancestor", i)));
  const h2 = signOf(swapIdx.map((i) => swapTerm(i, false)).map(({ id, status: st, value, positive, why }) => ({ id, status: st, value, positive, why })));

  // H1: six two-sample comparisons over the arms' independent histories.
  const comparisons: Reg1ReportComparison[] = (["a", "b"] as const).flatMap((timing) =>
    (["rand", "cont", "ancestor"] as const).map((other): Reg1ReportComparison => {
      const ids = (arm: Reg1ReportArm) => kept(arm).map((i) => ({ id: `${reg1ReportHistoryId(arm, i)}-${timing}`, owner: reg1ReportHistoryId(arm, i) }));
      const scafIds = ids("scaf");
      const otherIds = ids(other);
      const unresolved = [...scafIds, ...otherIds].filter((x) => valueGone(x.id, x.owner) !== null || comp(x.id) === null).map((x) => x.id);
      const n = { scaf: scafIds.length, other: otherIds.length };
      if (unresolved.length > 0) return { other, timing, n, p: null, uninformative: true, unresolved, established: null, medians: { scaf: null, other: null } };
      const xs = scafIds.map((x) => frac(comp(x.id)!));
      const ys = otherIds.map((x) => frac(comp(x.id)!));
      return { other, timing, n, p: mannWhitney(xs, ys, "exact").pGreater, uninformative: false, unresolved, established: null, medians: { scaf: xs.length ? median(xs) : null, other: ys.length ? median(ys) : null } };
    }),
  );
  const h1Uninformative = comparisons.some((c) => c.uninformative);
  const h1P = h1Uninformative ? null : Math.max(...comparisons.map((c) => c.p!));
  const h1Slot = h1P ?? 1;
  const [h1Holm, h2Holm] = holm([h1Slot, h2.p]);
  for (const c of comparisons) if (c.p !== null) c.established = holm([c.p, h2.p])[0] <= alpha;
  const h1Confirmed = h1Holm <= alpha;
  const h2Confirmed = h2Holm <= alpha;

  // S1: d_i = g_i - 0.5 adv_i by a sign test; the ratio g_i / adv_i is descriptive.
  const s1Terms = swapIdx.map((i) => swapTerm(i, true));
  const s1 = signOf(s1Terms.map(({ id, status: st, value, positive, why }) => ({ id, status: st, value, positive, why })));
  const eligible = s1Terms.filter((t) => t.status === "measured" && t.advPositive).map((t) => ({ id: t.id, ratio: t.g! / t.adv! }));
  const excluded = { unresolved: s1Terms.filter((t) => t.status === "unresolved").length, noDominantGenome: s1Terms.filter((t) => t.status === "no dominant genome").length, nonPositiveDenominator: s1Terms.filter((t) => t.status === "measured" && !t.advPositive).length };
  const boot = reg1ReportBootstrapMedian(eligible.map((x) => x.ratio));

  // S2: gain_i = mean end trait at time C - at time 0 on the disc inoculum; S2a's terms read the history, S2b's ranks the values.
  const gainOf = (arm: "scaf" | "rand", i: number, gone: string | null, inoculum: "raw" | "disc" = "disc"): { id: string; gain: number | null; status: "measured" | "unresolved"; positive: boolean; why: string | null } => {
    const id = reg1ReportHistoryId(arm, i);
    const ids = [0, 1].map((t) => `garden-${id}-t${t}-${inoculum}`);
    const why = gone ?? ids.map((x) => valueGone(x, id)).find((x) => x !== null) ?? null;
    if (why !== null) return { id, gain: null, status: "unresolved", positive: false, why };
    const [t0, tC] = ids.map((x) => {
      const rows = setById.get(x)!.rows;
      return { sum: rows.reduce((a, r) => a + r.endTrait, 0), n: rows.length };
    });
    // Exact: the numerator is an integer, and equal rationals give one double.
    const numer = tC.sum * t0.n - t0.sum * tC.n;
    return { id, gain: numer / (tC.n * t0.n), status: "measured", positive: numer > 0, why: null };
  };
  const s2a = signOf(kept("scaf").map((i) => gainOf("scaf", i, historyGone(reg1ReportHistoryId("scaf", i)))).map(({ id, status: st, gain, positive, why }) => ({ id, status: st, value: gain, positive, why })));
  const scafGains = kept("scaf").map((i) => gainOf("scaf", i, null));
  const randGains = kept("rand").map((i) => gainOf("rand", i, null));
  const s2bUnresolved = [...scafGains, ...randGains].filter((g) => g.status === "unresolved").map((g) => g.id);
  const s2bP = s2bUnresolved.length > 0 ? null : mannWhitney(scafGains.map((g) => g.gain!), randGains.map((g) => g.gain!), "exact").pGreater;

  // S3: R1'' at boundary 34, per arm the binomial tail of the histories with ICC > 0 and p < 0.05; the controls gate it.
  const s3Entry = (want: Reg1ReportExpectedSet): Reg1ReportS3Entry => {
    const l = want.labels;
    const base = { id: want.id, h: l.h, arm: l.arm as Reg1ReportS3Entry["arm"], control: l.control, history: l.history, n: 0, families: 0, icc: null, p: null, demonstrated: false, significant: false, tested: false, degenerate: null };
    const st = status(want.id);
    const gone = want.owner !== null ? historyGone(want.owner) : st.status === "unresolved" ? st.why : null;
    if (gone !== null) return { ...base, outcome: "unresolved", why: gone };
    const set = setById.get(want.id)!;
    if (set.heredity!.insufficient || set.heredity!.fragments.length === 0) return { ...base, outcome: "donors", why: "fewer than 2 eligible donors" };
    try {
      const stat = reg1HeredityStat(set);
      const frags = set.heredity!.fragments;
      return { ...base, outcome: "analysed", why: null, n: frags.length, families: new Set(frags.map((f) => f.family)).size, icc: stat.icc, p: stat.p, demonstrated: stat.demonstrated, significant: stat.p !== null && stat.p < R1_ALPHA, tested: stat.icc !== null && stat.degenerate === null, degenerate: stat.degenerate };
    } catch (err) {
      return { ...base, outcome: "unresolved", why: `analysis failed: ${(err as Error).message}` };
    }
  };
  const heredity = reg1ReportExpectedSets().filter((x) => x.labels.set === "heredity");
  const s3Histories = heredity.filter((x) => x.labels.arm !== "control" && !exclude.has(x.owner!)).map(s3Entry);
  const positiveControls = heredity.filter((x) => x.labels.control === "positive").map(s3Entry);
  const negativeControls = heredity.filter((x) => x.labels.control === "negative").map(s3Entry);
  const positivePassed = positiveControls.every((c) => c.demonstrated);
  const nullGatePassed = negativeControls.every((c) => c.tested) && negativeControls.filter((c) => c.significant).length <= 1;
  const s3Arm = (arm: "scaf" | "rand") => {
    const hs = s3Histories.filter((x) => x.arm === arm);
    const demonstrated = hs.filter((x) => x.demonstrated).length;
    return { n: hs.length, demonstrated, p: binomialUpperTail(demonstrated, hs.length, 1, 20) };
  };
  const s3Arms = { scaf: s3Arm("scaf"), rand: s3Arm("rand") };
  const s3Gated = positivePassed && nullGatePassed;
  const s3Slot = s3Gated ? s3Arms.scaf.p : 1;
  const s2bSlot = s2bP ?? 1;
  const [s1Holm, s2aHolm, s2bHolm, s3Holm] = holm([s1.p, s2a.p, s2bSlot, s3Slot]);
  const verdict = (adjusted: number) => (adjusted <= alpha ? ("confirmed" as const) : ("not confirmed" as const));

  const outcome = h1Confirmed && h2Confirmed ? "H1 and H2 confirmed" : h1Confirmed ? "H1 confirmed, H2 not" : h2Confirmed ? "H2 confirmed, H1 not" : "Neither";
  const fmt = (p: number) => p.toPrecision(3);
  const named = (c: Reg1ReportComparison) => `scaf > ${c.other} at (${c.timing})`;
  reasons.push(
    h1Uninformative
      ? `H1 uninformative (an unresolved value enters ${comparisons.filter((c) => c.uninformative).map(named).join(", ")}): Holm slot p = 1; uninformative; counts as not confirmed for the table`
      : `H1 ${h1Confirmed ? "confirmed" : "not confirmed"}: largest of the six p ${fmt(h1P!)}, Holm ${fmt(h1Holm)}`,
    `H2 ${h2Confirmed ? "confirmed" : "not confirmed"}: ${h2.positive} of ${h2.n} histories with g > 0, sign test p ${fmt(h2.p)}, Holm ${fmt(h2Holm)}`,
  );
  if (outcome === "H2 confirmed, H1 not") {
    const failed = comparisons.filter((c) => c.established !== true);
    reasons.push(`comparisons that did not establish higher scaf competence: ${failed.map((c) => (c.uninformative ? `${named(c)} (uninformative)` : `${named(c)} (p ${fmt(c.p!)})`)).join(", ")}`);
  }
  return {
    outcome,
    reasons,
    excluded: [...exclude].sort(),
    primary: {
      alpha,
      h1: { status: h1Uninformative ? "uninformative" : verdict(h1Holm), p: h1P, slot: h1Slot, holm: h1Holm, comparisons },
      h2: { ...h2, status: verdict(h2Holm), holm: h2Holm },
    },
    secondary: {
      alpha,
      s1: { ...s1, status: verdict(s1Holm), holm: s1Holm, ratio: { eligible, excluded, median: boot?.median ?? null, interval: boot && { lower: boot.lower, upper: boot.upper, resamples: boot.resamples }, available: boot !== null, method: REG1_REPORT_BOOTSTRAP_METHOD } },
      s2a: { ...s2a, status: verdict(s2aHolm), holm: s2aHolm },
      s2b: {
        status: s2bP === null ? "uninformative" : verdict(s2bHolm),
        p: s2bP,
        slot: s2bSlot,
        holm: s2bHolm,
        n: { scaf: scafGains.length, rand: randGains.length },
        unresolved: s2bUnresolved,
        medians: { scaf: s2bP === null ? null : median(scafGains.map((g) => g.gain!)), rand: s2bP === null ? null : median(randGains.map((g) => g.gain!)) },
      },
      s3: { status: s3Gated ? verdict(s3Holm) : "uninformative", p: s3Gated ? s3Arms.scaf.p : null, slot: s3Slot, holm: s3Holm, gates: { positivePassed, nullGatePassed, positive: positiveControls, negative: negativeControls }, arms: s3Arms, histories: s3Histories },
      heritable: s3Gated && s3Holm <= alpha,
      gains: { scaf: scafGains.map(({ id, gain, status: st }) => ({ id, gain, status: st })), rand: randGains.map(({ id, gain, status: st }) => ({ id, gain, status: st })) },
    },
  };
}

/**
 * The registration's rule: the validity checks once over every history (`reg1ReportValidity`), then the tests (`reg1ReportTests`). The
 * first matching row of the outcome table is the outcome: Invalid, then Uninformative, then the row the tests pick.
 */
export function reg1ReportEvaluate(
  sets: readonly Reg1ReportSet[],
  statuses: readonly Reg1ReportSetStatus[],
  histories: readonly Reg1ReportHistoryStatus[],
  gates: { device: Pick<Reg1ReportDevice, "passed" | "reasons">; reproducibility: Pick<Reg1ReportReproducibility, "passed" | "reasons"> },
): Reg1ReportEvaluation {
  const v = reg1ReportValidity(sets, histories, gates);
  const tests = reg1ReportTests(sets, statuses, histories);
  const applied = !v.invalid && !v.uninformative;
  const outcome: Reg1ReportOutcome = v.invalid ? "Invalid" : v.uninformative ? "Uninformative" : tests.outcome;
  return { outcome, reasons: [...v.reasons, ...(applied ? tests.reasons : [])], validity: v.validity, applied, tests };
}

/** The retained-mass bin of a fragment: 0 (nothing landed), else [2^k, 2^(k+1)). */
function reg1MassBin(m: number): { bin: string; lower: number } {
  if (!(m > 0)) return { bin: "0", lower: 0 };
  let lower = 1;
  while (lower * 2 <= m) lower *= 2;
  return { bin: `[${lower}, ${2 * lower})`, lower };
}

/**
 * The medians the side-by-side reads from a prior R3 readout (v1's r3 stage, or the replication's r3rep stage): per source and timing,
 * Ge-on-Fa - ancestor and the quenched maximum. Throws when `json` is not that stage's output.
 */
export function reg1ReportPriorSummary(json: unknown, stage: "r3" | "r3rep") {
  if (!isRecord(json) || json.stage !== stage || !Array.isArray(json.histories)) throw new Error(`not a ${stage} stage output (stage ${stage} with histories)`);
  const hs = json.histories.filter(isRecord);
  const at = (h: Record<string, unknown>, t: "a" | "b", arm: string): number | null => {
    const x = h[t];
    return isRecord(x) && typeof x[arm] === "number" ? (x[arm] as number) : null;
  };
  const med = (pick: (h: Record<string, unknown>) => number | null) => {
    const xs = hs.map(pick).filter((x): x is number => x !== null);
    return xs.length ? median(xs) : null;
  };
  const timing = (t: "a" | "b") => Object.fromEntries(REG1_ALL_ARMS.map((arm) => [arm, med((h) => at(h, t, arm))]));
  return {
    histories: hs.length,
    a: timing("a"),
    b: timing("b"),
    geOnFaMinusAncestor: med((h) => (typeof h.swapEa === "number" && at(h, "a", "ancestor") !== null ? (h.swapEa as number) - at(h, "a", "ancestor")! : null)),
    quenchedMax: isRecord(json.quenched) && typeof json.quenched.max === "number" ? json.quenched.max : null,
  };
}

/** Why the tests are withheld under a row the validity checks settle (its disposition is "no claim" or "decide whether to complete"); null under a row the tests decide. */
function reg1Withheld(outcome: Reg1ReportOutcome): string | null {
  if (outcome === "Invalid") return "the row is Invalid (Report; no claim): no test statistic is reported";
  if (outcome === "Uninformative") return "the row is Uninformative (Report; decide whether to complete or rerun): no test statistic is reported";
  return null;
}

/**
 * The queue's completeness ("Execution order and stopping"): every command of the queue manifest (`{ commands: [{ id, instance }] }`) needs
 * a terminal state ("done" or "fail", an unresolved command counting as complete) in its own instance's status file (`{ instance,
 * commands: { <id>: "done" | "fail" } }`). Until then no partial ensemble is analysed. Throws on a malformed queue or status file, on two
 * status files for one instance, and on a command listed twice.
 */
export function reg1ReportQueueCheck(queue: unknown, statusFiles: readonly unknown[]): { complete: boolean; commands: number; done: number; failed: number; pending: string[]; reasons: string[] } {
  const commands = isRecord(queue) && Array.isArray(queue.commands) ? queue.commands : null;
  if (commands === null) throw new Error('the queue is not { "commands": [{ "id", "instance" }] }');
  const byInstance = new Map<number, Record<string, unknown>>();
  for (const f of statusFiles) {
    if (!isRecord(f) || !Number.isInteger(f.instance) || !isRecord(f.commands)) throw new Error('a status file is not { "instance": n, "commands": { "<id>": "done" | "fail" } }');
    if (byInstance.has(f.instance as number)) throw new Error(`two status files for instance ${f.instance}`);
    byInstance.set(f.instance as number, f.commands);
  }
  const seen = new Set<string>();
  let done = 0;
  let failed = 0;
  const pending: string[] = [];
  for (const c of commands) {
    if (!isRecord(c) || typeof c.id !== "string" || !Number.isInteger(c.instance)) throw new Error(`queue command ${JSON.stringify(c)} is not { "id": string, "instance": n }`);
    if (seen.has(c.id)) throw new Error(`queue command ${c.id} is listed twice`);
    seen.add(c.id);
    const state = byInstance.get(c.instance as number)?.[c.id];
    if (state === "done") done++;
    else if (state === "fail") failed++;
    else pending.push(c.id);
  }
  const reasons = pending.length > 0 ? [`the queue has not completed: ${pending.length} of ${commands.length} commands have no terminal state (${pending.slice(0, 5).join(", ")}${pending.length > 5 ? ", ..." : ""})`] : [];
  return { complete: pending.length === 0, commands: commands.length, done, failed, pending, reasons };
}

/**
 * The registration's readout (pure; the CLI reads the files): the screened sets and their rejections, every expected run bundle, the
 * device and reproducibility checks, the queue's completeness, the optional capability rows and prior readouts. With `budgetStopped`
 * nothing is analysed: the outcome is Uninformative, or Invalid if the device check (technical status, if given) failed. With a queue that
 * has not completed nothing is analysed either: the outcome is "incomplete", which is no row of the table. Otherwise the validity checks
 * once over every history and the tests decide the row; under a row the validity checks settle (Invalid, Uninformative) the tests are
 * withheld (`withheld`: `primary` and `secondary` null, and no truncation verdict). Under a row the tests decide, the tests are run again
 * without the truncation-flagged histories (a history with more than 1% truncated recipient rows in its ponds.tsv), never the validity
 * checks, and the readout is sensitive to truncation when that row differs. The descriptive outputs never feed the outcome.
 */
export function reg1ReportReadout(x: {
  sets: readonly Reg1ReportSet[];
  rejected: readonly { dir: string; id: string | null; reasons: string[] }[];
  runs: readonly Reg1ReportRun[];
  device: Reg1ReportDevice | null;
  reproducibility: Reg1ReportReproducibility | null;
  budgetStopped?: boolean;
  queue?: ReturnType<typeof reg1ReportQueueCheck> | null;
  capability?: readonly R4Row[] | null;
  v1?: unknown;
  r3rep?: unknown;
}) {
  const rowOf = (outcome: Reg1ReportOutcome) => ({ ...REG1_REPORT_OUTCOMES.find((r) => r.outcome === outcome)!, note: REG1_REPORT_H1_NOTE });
  const definitions = { unresolved: REG1_REPORT_UNRESOLVED };
  const nothing = { primary: null, secondary: null, truncation: null, availability: null, descriptive: null };
  if (x.budgetStopped) {
    const outcome: Reg1ReportOutcome = x.device?.passed === false ? "Invalid" : "Uninformative";
    const reasons = [...(x.device?.passed === false ? [`device check failed: ${x.device.reasons.join("; ")}`] : []), "the budget stopped the queue: nothing is analysed (no partial ensemble is ever analysed)"];
    return { outcome, row: rowOf(outcome), reasons, budgetStopped: true, withheld: true, withheldReason: "the budget stopped the queue: nothing is analysed", definitions, queue: x.queue ?? null, validity: { device: x.device ?? { passed: null, reasons: ["not given"] } }, ...nothing };
  }
  if (x.queue && !x.queue.complete) {
    return { outcome: "incomplete" as const, row: null, reasons: [...x.queue.reasons, "nothing is analysed (no partial ensemble is ever analysed)"], budgetStopped: false, withheld: true, withheldReason: "the queue has not completed: nothing is analysed", definitions, queue: x.queue, validity: { device: x.device ?? { passed: null, reasons: ["not given"] } }, ...nothing };
  }
  if (x.device === null || x.reproducibility === null) throw new Error("reg1ReportReadout: the device and reproducibility checks are needed unless nothing is analysed");
  const runs = new Map(x.runs.map((r) => [r.id, r]));
  const statuses = reg1ReportStatuses(x.sets, x.rejected, runs);
  const histories = reg1ReportHistoryStatuses(statuses, runs);
  const all = reg1ReportEvaluate(x.sets, statuses, histories, { device: x.device, reproducibility: x.reproducibility });
  const withheldReason = reg1Withheld(all.outcome);
  const flagged = x.runs.filter((r) => r.trajectory?.truncation.flagged).map((r) => ({ id: r.id, ...r.trajectory!.truncation }));
  // The tests only, without the flagged histories, and only under a row the tests decide: the validity checks stand as evaluated.
  const without = withheldReason !== null ? null : flagged.length === 0 ? all.tests : reg1ReportTests(x.sets, statuses, histories, new Set(flagged.map((f) => f.id)));
  const truncation = {
    limit: TRUNCATION_LIMIT,
    flagged,
    /** Bundles whose ponds.tsv could not be read (unresolved): their truncation is unknown. */
    unknown: x.runs.filter((r) => r.trajectory === null).map((r) => r.id),
    without: without && {
      outcome: without.outcome,
      reasons: without.reasons,
      excluded: without.excluded,
      h1: { status: without.primary.h1.status, p: without.primary.h1.p, holm: without.primary.h1.holm },
      h2: { status: without.primary.h2.status, positive: without.primary.h2.positive, n: without.primary.h2.n, p: without.primary.h2.p, holm: without.primary.h2.holm },
      secondary: { s1: without.secondary.s1.status, s2a: without.secondary.s2a.status, s2b: without.secondary.s2b.status, s3: without.secondary.s3.status },
    },
    sensitive: without === null ? null : without.outcome !== all.outcome,
  };
  const reasons = [...all.reasons, ...(truncation.sensitive ? [`sensitive to truncation: without the ${flagged.length} flagged histories the row would be ${without!.outcome}`] : [])];

  // Descriptive: never a decision input.
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const setById = new Map(x.sets.map((s) => [s.id, s]));
  const count = (rows: readonly AssayRow[]) => ({ n: rows.length, successes: rows.filter((r) => r.success === 1).length });
  const competences = reg1ReportExpectedSets()
    .filter((w) => w.assay === "competence" && setById.has(w.id))
    .map((w) => {
      const s = setById.get(w.id)!;
      const c = count(s.rows);
      const perReplicate = [...new Set(s.rows.map((r) => r.replicate))].sort((p, q) => p - q).map((replicate) => ({ replicate, ...count(s.rows.filter((r) => r.replicate === replicate)) }));
      const truncatedRows = s.rows.filter((r) => (r.truncated ?? 0) > 0).length;
      return { id: w.id, status: statusById.get(w.id)!.status, ...c, competence: c.n ? c.successes / c.n : null, perReplicate, truncatedRows, truncationFlagged: truncationOf(truncatedRows, c.n).flagged, retMass: dist(s.rows.map((r) => r.retMass)), retE: dist(s.rows.filter((r) => r.retE !== null).map((r) => r.retE!)) };
    });
  const gaOnFe = Array.from({ length: REG1_REPORT_HISTORIES }, (_, i) => {
    const id = `${reg1ReportHistoryId("scaf", i)}-ga-on-fe`;
    const c = competences.find((y) => y.id === id);
    return { id, status: statusById.get(id)!.status, successes: c?.successes ?? null, n: c?.n ?? null, competence: c?.competence ?? null };
  });
  const massBins = (["a", "b"] as const).flatMap((timing) =>
    REG1_ALL_ARMS.map((arm) => {
      const rows = Array.from({ length: REG1_REPORT_HISTORIES }, (_, i) => `${reg1ReportHistoryId(arm, i)}-${timing}`)
        .filter((id) => statusById.get(id)?.status === "measured")
        .flatMap((id) => setById.get(id)!.rows);
      const bins = new Map<string, { bin: string; lower: number; n: number; successes: number }>();
      for (const r of rows) {
        const b = reg1MassBin(r.retMass);
        const e = bins.get(b.bin) ?? { ...b, n: 0, successes: 0 };
        e.n++;
        if (r.success === 1) e.successes++;
        bins.set(b.bin, e);
      }
      return { arm, timing, fragments: rows.length, bins: [...bins.values()].sort((p, q) => p.lower - q.lower).map(({ bin, n, successes }) => ({ bin, n, successes, competence: successes / n })) };
    }),
  );
  const gardenOf = (inoculum: "raw" | "disc") =>
    (["scaf", "rand"] as const).flatMap((arm) =>
      Array.from({ length: REG1_REPORT_HISTORIES }, (_, i) => {
        const id = reg1ReportHistoryId(arm, i);
        const mean = (t: 0 | 1) => {
          const s = setById.get(`garden-${id}-t${t}-${inoculum}`);
          return s && statusById.get(s.id)!.status === "measured" && s.rows.length ? s.rows.reduce((a, r) => a + r.endTrait, 0) / s.rows.length : null;
        };
        const t0 = mean(0);
        const tC = mean(1);
        return { id, t0, tC, gain: t0 !== null && tC !== null ? tC - t0 : null };
      }),
    );
  const trajectoryBoundaries = R3REP_TRAJECTORY_BOUNDARIES;
  const runSummary = x.runs.map((r) => {
    const b = r.trajectory?.boundaries ?? [];
    return { id: r.id, arm: r.arm, history: r.history, dir: r.dir, resolved: r.resolved, censusEvery: r.censusEvery, endedAt: r.trajectory?.endedAt ?? null, extinctAt100: b.find((y) => y.boundary === REG1_REPORT_RUNS.history.cycles)?.extinct ?? null, lastBoundary: b.at(-1)?.boundary ?? null, truncation: r.trajectory?.truncation ?? null, trajectory: b };
  });
  const armTrajectory = (arm: Reg1ReportArm) =>
    trajectoryBoundaries.map((boundary) => {
      const at = runSummary.filter((h) => h.arm === arm).flatMap((h) => h.trajectory.filter((y) => y.boundary === boundary));
      return { boundary, histories: at.length, medianMeanTrait: at.length ? median(at.map((y) => y.meanTrait)) : null, medianExtinct: at.length ? median(at.map((y) => y.extinct)) : null };
    });
  const sideBySide = {
    reg1: {
      histories: REG1_REPORT_HISTORIES,
      ...Object.fromEntries((["a", "b"] as const).map((t) => [t, Object.fromEntries(REG1_ALL_ARMS.map((arm) => {
        const ids = new Set(Array.from({ length: REG1_REPORT_HISTORIES }, (_, i) => `${reg1ReportHistoryId(arm, i)}-${t}`));
        const xs = competences.filter((c) => c.status === "measured" && ids.has(c.id) && c.competence !== null).map((c) => c.competence!);
        return [arm, xs.length ? median(xs) : null];
      }))])),
      geOnFaMinusAncestor: (() => {
        const xs = Array.from({ length: REG1_REPORT_HISTORIES }, (_, i) => {
          const e = competences.find((c) => c.id === `${reg1ReportHistoryId("scaf", i)}-ge-on-fa` && c.status === "measured");
          const w = competences.find((c) => c.id === `${reg1ReportHistoryId("ancestor", i)}-a` && c.status === "measured");
          return e && w ? e.competence! - w.competence! : null;
        }).filter((v): v is number => v !== null);
        return xs.length ? median(xs) : null;
      })(),
      g: (() => {
        const xs = all.tests.primary.h2.terms.filter((t) => t.status === "measured").map((t) => t.value!);
        return xs.length ? median(xs) : null;
      })(),
      quenchedMax: all.validity.quenched.max,
    },
    v1: x.v1 === undefined ? null : reg1ReportPriorSummary(x.v1, "r3"),
    r3rep: x.r3rep === undefined ? null : reg1ReportPriorSummary(x.r3rep, "r3rep"),
  };
  return {
    outcome: all.outcome,
    row: rowOf(all.outcome),
    reasons,
    budgetStopped: false,
    withheld: withheldReason !== null,
    withheldReason,
    definitions,
    queue: x.queue ?? null,
    validity: { ...all.validity, device: x.device, reproducibility: x.reproducibility },
    primary: withheldReason === null ? all.tests.primary : null,
    secondary: withheldReason === null ? all.tests.secondary : null,
    truncation,
    availability: {
      expected: statuses.length,
      measured: statuses.filter((s) => s.status === "measured").length,
      biological: statuses.filter((s) => s.status === "biological").length,
      unresolved: statuses.filter((s) => s.status === "unresolved").length,
      sets: statuses,
      histories,
      runs: x.runs.map(({ id, dir, resolved, why, censusEvery }) => ({ id, dir, resolved, why, censusEvery })),
    },
    descriptive: {
      note: "never a decision input. competences: every set's successes out of its fragments (256, the swap pair 512) and per replicate (64), its truncated rows and the retained B+P (retMass) and E (retE) of its fragments; gaOnFe: Ga-on-Fe per history; massBins: success within retained-mass bins (0, then [2^k, 2^(k+1))) per arm and timing over the measured source sets (the mass confound of the unmatched H1 comparisons); garden: the mean end trait at time 0 and C and the gain per history, raw and disc; runs: per bundle its mean pre-cycle pond trait per boundary (extinct ponds count 0), its extinct ponds at boundary 100 (null for an ancestor world), the boundary its history ended at and its truncation, and per arm the medians at boundaries 1, 10, 25, 50, 75 and 100; capability: R4's rows (DEFAULT_EVAL, its own seed 1 and 4 replicates); sideBySide: the medians beside protocol v1's (--v1) and the R3 replication's (--r3rep)",
      competences,
      gaOnFe,
      massBins,
      garden: { raw: gardenOf("raw"), disc: gardenOf("disc") },
      runs: { histories: runSummary, ended: runSummary.filter((r) => r.endedAt !== null).map((r) => ({ id: r.id, endedAt: r.endedAt })), arms: Object.fromEntries(REG1_ALL_ARMS.map((arm) => [arm, armTrajectory(arm)])) },
      capability: x.capability ? reg1ReportCapability(x.capability) : { given: false },
      sideBySide,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// R4: capability (descriptive)

/** A row of the capability table: an arm and history plus numeric measures (quality, recovery, regeneration, ...). */
export type R4Row = { arm: string; history?: number } & Record<string, unknown>;

/**
 * The capability rows of an assay.json (scaffold-assays `capability`: `capability` rows, each with `arm`), a
 * JSON array of rows, or an object with `rows`. The older `sources` shape (rows with a nested `evaluation`) is read
 * when its sources carry an `arm`. A row with no string `arm` throws: the table is per arm.
 */
export function r4RowsOf(json: unknown): R4Row[] {
  const j = (json ?? {}) as Record<string, unknown>;
  let rows: unknown[];
  if (Array.isArray(json)) rows = json;
  else if (Array.isArray(j.capability)) rows = j.capability;
  else if (Array.isArray(j.rows)) rows = j.rows;
  else if (Array.isArray(j.sources)) rows = (j.sources as Record<string, unknown>[]).map(({ evaluation, ...rest }) => ({ ...rest, ...(evaluation && typeof evaluation === "object" ? (evaluation as Record<string, unknown>) : {}) }));
  else rows = [];
  for (const r of rows) if (typeof (r as R4Row)?.arm !== "string") throw new Error(`capability row has no arm (${JSON.stringify(r).slice(0, 80)}); re-run scaffold-assays capability with --arm`);
  return rows as R4Row[];
}

/**
 * Rows passed through as given, with per arm the evaluated rows (`evaluated` not false: a source whose genome was not evaluated has no
 * measures) and the mean and median of each of their numeric columns; the labels arm, history and h are not measures.
 */
export function r4Table(rows: readonly R4Row[]): { rows: R4Row[]; arms: Record<string, { n: number; measures: Record<string, Dist> }> } {
  const arms: Record<string, { n: number; measures: Record<string, Dist> }> = {};
  const byArm = new Map<string, R4Row[]>();
  for (const r of rows) byArm.set(r.arm, [...(byArm.get(r.arm) ?? []), r]);
  for (const [arm, all] of byArm) {
    const rs = all.filter((r) => r.evaluated !== false);
    const cols = new Set(rs.flatMap((r) => Object.keys(r).filter((k) => k !== "arm" && k !== "history" && k !== "h" && typeof r[k] === "number")));
    arms[arm] = {
      n: rs.length,
      measures: Object.fromEntries([...cols].sort().map((c) => [c, dist(rs.filter((r) => typeof r[c] === "number").map((r) => r[c] as number))])),
    };
  }
  return { rows: [...rows], arms };
}

/** R4 as the registration reports it (descriptive): `r4Table`, and per arm the rows given, the evaluated ones and the unavailable sources with why. */
export function reg1ReportCapability(rows: readonly R4Row[]) {
  const t = r4Table(rows);
  const counts = Object.fromEntries(
    Object.keys(t.arms).map((arm) => {
      const rs = rows.filter((r) => r.arm === arm);
      return [arm, { rows: rs.length, evaluated: rs.filter((r) => r.evaluated !== false).length, unavailable: rs.filter((r) => r.evaluated === false).map((r) => ({ history: r.history ?? null, why: typeof r.unavailable === "string" ? r.unavailable : null })) }];
    }),
  );
  return { given: true, ...t, counts };
}

// ---------------------------------------------------------------------------------------------
// Decision table

/** Verdicts by stage: true / false, or null / undefined while a stage has not run. */
export interface DecisionInputs {
  /** A regime was found (fallback included): `p1Choose(...).verdict`. */
  p1?: boolean | null;
  p2?: boolean | null;
  /** R1 demonstrated in scaf. */
  r1?: boolean | null;
  r2?: boolean | null;
  /** R3 decisive (a source with an unreliable quenched control is not decisive). */
  r3?: boolean | null;
}

export interface DecisionResult {
  /** 1-6, the first matching row of the protocol's table; null when the decision is pending. */
  row: number | null;
  disposition: string;
  /** The first stage whose verdict is missing and needed to reach a row. */
  pending: keyof DecisionInputs | null;
}

export const DECISION_TABLE: readonly string[] = [
  "Stop. Report that no workable regime exists. Any new regime space needs a dated amendment.",
  "Stop. The machinery does not see selection among ponds even on standing variation, which points to heredity. Recommend a heredity rule variant (genome retention in bodies) as a separate dated decision.",
  "Same as P2 failing: pond-level heredity is not demonstrated under RULE_VERSION 1 even with an imposed bottleneck.",
  "Heredity is present but no pond-level adaptation appeared within C cycles. Possible next step, by dated amendment: a longer run or more ponds. No integration.",
  "B: integrate the cycle into the runner and lab (optional config keys, conditions, segment parity). Then a withdrawal ladder, re-testing R3 at each rung: longer periods, partial clearing, dispersal by migration packets only.",
  "C: integrate, then draft a registration for a confirmatory scaffolding ensemble (an M7 candidate). Any AWS draw is recorded by a dated note before paid runs.",
];

/**
 * The first matching row of the decision table. Rows are tried in order; the first stage whose verdict is
 * missing before a row matches makes the result pending.
 */
export function decide(x: DecisionInputs): DecisionResult {
  const done = (row: number): DecisionResult => ({ row, disposition: DECISION_TABLE[row - 1], pending: null });
  const wait = (stage: keyof DecisionInputs): DecisionResult => ({ row: null, disposition: `pending: ${stage} has no verdict yet`, pending: stage });
  if (x.p1 == null) return wait("p1");
  if (x.p1 === false) return done(1);
  if (x.p2 == null) return wait("p2");
  if (x.p2 === false) return done(2);
  if (x.r1 == null) return wait("r1");
  if (x.r1 === false) return done(3);
  if (x.r2 == null) return wait("r2");
  if (x.r2 === false) return done(4);
  if (x.r3 == null) return wait("r3");
  return done(x.r3 ? 6 : 5);
}
