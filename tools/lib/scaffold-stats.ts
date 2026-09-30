// Statistics of the ecological-scaffolding sandbox (docs/scaffold-protocol-v1.md): P1 regime criteria,
// P2 positive control, R1 pond-level heredity (ICC(1) + permutation), R2 adaptation gain, R3 removal
// advantage, R4 table passthrough, the truncation sensitivity rule (assay rows and evolution histories), the
// in-run donor repeatability and the decision table. Everything except `readTsv` is pure (no Deno
// API), so vitest exercises it directly with synthetic data; tools/scaffold-report.ts is the CLI over it.
// Large tables (ponds.tsv, lineages.tsv) are streamed row by row, never loaded whole.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { checkAssaySeeds, checkDonorSeed, type AssayLabelSet, type AssayName } from "./pond-assay.ts";
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

/**
 * One-way random-effects ICC(1) with unequal family sizes: (MSB - MSW) / (MSB + (n0 - 1) MSW) with
 * n0 = (N - sum n_i^2 / N) / (a - 1). Families are relabelled by first appearance, so any two label vectors
 * that induce the same partition give bit-identical results. null with fewer than 2 families or no
 * within-family degrees of freedom; 0 when the values are all equal.
 */
export function icc1(y: readonly number[], labels: readonly number[]): number | null {
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
  const denom = msb + (n0 - 1) * msw;
  return denom === 0 ? 0 : (msb - msw) / denom;
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
  const covariates = ["log1p(retMass)", "log1p(retE)"];
  const xs = [frag.map((r) => Math.log1p(r.retMass)), frag.map((r) => Math.log1p(r.retE!))];
  const resid = olsResiduals(frag.map((r) => r.endTrait), xs);
  const res = permutationP(resid, frag.map((r) => r.family), assaySeed(1, h, t, 0, 8), R1_PERMUTATIONS);
  if (!res) return { ...base, icc: null, p: null, demonstrated: false, covariates };
  return { ...base, icc: res.icc, p: res.p, demonstrated: res.icc > 0 && res.p < R1_ALPHA, covariates };
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

/** Rows passed through as given, with per-arm mean and median of each numeric column. */
export function r4Table(rows: readonly R4Row[]): { rows: R4Row[]; arms: Record<string, { n: number; measures: Record<string, Dist> }> } {
  const arms: Record<string, { n: number; measures: Record<string, Dist> }> = {};
  const byArm = new Map<string, R4Row[]>();
  for (const r of rows) byArm.set(r.arm, [...(byArm.get(r.arm) ?? []), r]);
  for (const [arm, rs] of byArm) {
    const cols = new Set(rs.flatMap((r) => Object.keys(r).filter((k) => k !== "arm" && k !== "history" && typeof r[k] === "number")));
    arms[arm] = {
      n: rs.length,
      measures: Object.fromEntries([...cols].sort().map((c) => [c, dist(rs.filter((r) => typeof r[c] === "number").map((r) => r[c] as number))])),
    };
  }
  return { rows: [...rows], arms };
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
