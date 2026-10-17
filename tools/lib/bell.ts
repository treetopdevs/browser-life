// The anomaly bell, v0 (docs/naturalist-bell-v0-2026-10-17.md, section "Fixed before running"; that section is frozen and this
// file implements it, it does not amend it). Pure functions and classes over census streams; no Deno or filesystem access, so
// vitest can load it. The CLI is tools/bell.ts.
//
// What it computes. Thirteen signals per census (9 levels, 4 rates over RATE_LAG censuses). For a scored run and a reference set
// (neutral runs of one preset, at the same census) z = (x - median) / max(IQR/1.349, 0.05|median|, floor). A "ring" on a signal
// and side is a window of W consecutive censuses, all starting at or after BURN_IN_STEP, in which side*z stays >= Z. The run's
// score on (signal, side, W) is the largest, over counted windows, of the window's smallest side*z (floored at 0: a window with a
// census on the other side is worth 0, "its smallest |z| on that side" is 0). D(W) = the maximum over the 13 signals and both
// sides. The run is flagged at (Z, W) iff D(W) >= Z. D does not depend on Z, so one rolling minimum per (signal, side, W) serves
// every Z of the grid; only the receipts depend on Z.
//
// Quantile definition (one rule throughout): linear interpolation between order statistics at position (n-1)q, identical to
// quantileSorted in tools/lib/measures6.ts. Median = q0.5, IQR = q0.75 - q0.25. A neutral run in its own reference set is scored
// leave-one-out: the reference values are sorted once per census and signal and the run's own entry is skipped by index
// (quantileDrop), O(1) per statistic; the tests hold that equal, bit for bit, to filtering the run out and sorting again.
import { binomialLowerBound, mannWhitney } from "@bl/metrics";

export const BELL_VERSION = 0;
export const NOTE_PATH = "docs/naturalist-bell-v0-2026-10-17.md";

// ---------------------------------------------------------------------------------------------
// Fixed parameters (the note).

export type SignalKind = "level" | "rate";
export interface SignalDef {
  name: string;
  kind: SignalKind;
  floor: number;
  source: "series" | "lineages";
}
const sig = (name: string, kind: SignalKind, floor: number, source: "series" | "lineages" = "series"): SignalDef => ({ name, kind, floor, source });
/** The thirteen signals, in the note's table order. A rate is the increase of a cumulative counter over the last RATE_LAG censuses. */
export const SIGNALS: readonly SignalDef[] = [
  sig("livingCells", "level", 1),
  sig("individuals", "level", 1),
  sig("meanMass", "level", 1),
  sig("lineages", "level", 1),
  sig("lineageShannon", "level", 0.01),
  sig("patternEntropy", "level", 0.01),
  sig("bioticRecycling", "level", 0.01),
  sig("maxGeneration", "level", 1),
  sig("dominantShare", "level", 0.01, "lineages"),
  sig("fissions", "rate", 1),
  sig("fusions", "rate", 1),
  sig("buddings", "rate", 1),
  sig("mutations", "rate", 1),
];
export const RATE_LAG = 10;
export const BURN_IN_STEP = 10_000;
export const PRIMARY = { Z: 4, W: 50 } as const;
export const GRID = { Z: [3, 4, 6], W: [10, 50, 200] } as const;
export const SPREAD_REL = 0.05;
export const IQR_SCALE = 1.349;
/** Neutral runs the bar needs (test 6's corpus). */
export const EXPECTED_NEUTRAL = 70;
export const EXPECTED_TREATMENT = 10;
export const EXPECTED_NO_MUTATION = 5;
export const EXPECTED_GRADIENT_NEUTRAL = 40;
export const EXPECTED_CALIB_PER_PRESET = 20;
/** The secondary readout's corpus, from the note: per neutral preset, 20 replay-calib runs fix Z* and this many replay-m4 runs are held out. */
export const EXPECTED_HELD_OUT: Readonly<Record<string, number>> = { "gradient-m3": 20, "spots-m3": 10 };
/** Criterion 2: P(D_treatment > D_neutral) at least this. */
export const EFFECT_BAR = 0.8;
/** Criterion 1: binomial upper 95% bound on the false-alarm rate below this (test 6's null rule). */
export const UPPER_BAR = 0.1;
/** Largest W the receipt history can serve. */
const HIST = 256;

export type Condition = "neutral" | "treatment" | "no-mutation";
export type EnvelopeId = "all-neutral" | "m4-neutral";

// ---------------------------------------------------------------------------------------------
// Corpus (the note, "Corpora").

export const CORPUS: readonly { experiment: string; preset: string; condition: Condition; seeds: readonly [number, number] }[] = [
  { experiment: "replay-calib", preset: "gradient-m3", condition: "neutral", seeds: [1001, 1020] },
  { experiment: "replay-calib", preset: "spots-m3", condition: "neutral", seeds: [1001, 1020] },
  { experiment: "replay-m4", preset: "gradient-m3", condition: "neutral", seeds: [1, 20] },
  { experiment: "replay-m4", preset: "spots-m3", condition: "neutral", seeds: [1, 10] },
  { experiment: "replay-m4", preset: "gradient-m3", condition: "treatment", seeds: [1, 10] },
  { experiment: "replay-m4", preset: "gradient-m3", condition: "no-mutation", seeds: [1, 5] },
];
export interface CorpusRun {
  id: string;
  experiment: string;
  preset: string;
  condition: Condition;
  seed: number;
  /** Path under the runs base directory. */
  rel: string;
}
export function corpusRuns(): CorpusRun[] {
  const out: CorpusRun[] = [];
  for (const c of CORPUS) {
    for (let seed = c.seeds[0]; seed <= c.seeds[1]; seed++) {
      const rel = `${c.experiment}/${c.preset}/${c.condition}/seed-${seed}`;
      out.push({ id: rel, experiment: c.experiment, preset: c.preset, condition: c.condition, seed, rel });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Quantiles and z.

/** Linear-interpolated quantile of the ascending `sorted`, with the element at index `skip` left out (pass Infinity to keep all); `n` is the length after the skip. */
export function quantileDrop(sorted: ArrayLike<number>, skip: number, n: number, q: number): number {
  if (n <= 0) return NaN;
  const pos = (n - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  const a = sorted[lo < skip ? lo : lo + 1], b = sorted[hi < skip ? hi : hi + 1];
  return a + (b - a) * (pos - lo);
}

export interface Departure {
  z: number;
  median: number;
  spread: number;
}
/** z of x against ascending reference values, leaving out the entry at index `skip` (Infinity: none). Throws when no reference value remains. */
export function departure(x: number, sorted: ArrayLike<number>, skip: number, floor: number): Departure {
  const n = sorted.length - (skip < sorted.length ? 1 : 0);
  if (n < 1) throw new Error("departure: no reference values left");
  const median = quantileDrop(sorted, skip, n, 0.5);
  const iqr = quantileDrop(sorted, skip, n, 0.75) - quantileDrop(sorted, skip, n, 0.25);
  const spread = Math.max(iqr / IQR_SCALE, SPREAD_REL * Math.abs(median), floor);
  return { z: (x - median) / spread, median, spread };
}

// ---------------------------------------------------------------------------------------------
// Signals from a census.

/** A missing or non-finite value counts as 0. */
export const finiteOrZero = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The largest lineage's cells over all living cells at the census; 0 with no living cells. Rows with no (or non-finite) cells are ignored. */
export function dominantShare(rows: readonly (readonly [string, number])[]): number {
  let total = 0, max = 0;
  for (const [, c] of rows) {
    if (!Number.isFinite(c) || c <= 0) continue;
    total += c;
    if (c > max) max = c;
  }
  return total > 0 ? max / total : 0;
}

/**
 * Turns one run's censuses (series record plus lineage rows) into signal vectors, in SIGNALS order. Rates need RATE_LAG earlier
 * censuses and are null before that (undefined, not 0); levels are always defined. Feed it every census, in order.
 */
export class SignalExtractor {
  private n = 0;
  private rings: (Float64Array | undefined)[] = SIGNALS.map((d) => (d.kind === "rate" ? new Float64Array(RATE_LAG) : undefined));
  push(rec: Record<string, unknown>, rows: readonly (readonly [string, number])[]): (number | null)[] {
    const out: (number | null)[] = new Array(SIGNALS.length);
    for (let i = 0; i < SIGNALS.length; i++) {
      const d = SIGNALS[i];
      if (d.source === "lineages") {
        out[i] = dominantShare(rows);
        continue;
      }
      const v = finiteOrZero(rec[d.name]);
      if (d.kind === "level") {
        out[i] = v;
        continue;
      }
      const ring = this.rings[i]!, slot = this.n % RATE_LAG;
      out[i] = this.n >= RATE_LAG ? v - ring[slot] : null;
      ring[slot] = v;
    }
    this.n++;
    return out;
  }
}

/**
 * Joins a run's series stream with its lineage-census stream. Series drives the steps; a series census with no lineage census
 * (no living cells) gets empty rows. A lineage census at a step the series does not have throws, naming the run. The two files
 * are cross-checked at every census, so a truncated lineages.tsv cannot pass for an extinct world: the lineage census (empty or not)
 * must agree with the series on living cells (sum of its cells) and on the lineage count (its rows), wherever the series states
 * them as finite numbers. Checked on good bundles of both presets, all three conditions: both hold at every census.
 * The lineage iterator is closed on every exit, normal or not.
 */
export async function* mergeCensuses<R extends { step: number }>(
  runId: string,
  series: AsyncIterable<R>,
  lineages: AsyncIterable<readonly [number, [string, number][]]>,
): AsyncGenerator<{ rec: R; rows: [string, number][] }> {
  const it = lineages[Symbol.asyncIterator]();
  try {
    let next = await it.next();
    for await (const rec of series) {
      let rows: [string, number][] = [];
      if (!next.done) {
        const [ls, lr] = next.value;
        if (ls < rec.step) throw new Error(`${runId}: lineages.tsv has a census at step ${ls} that series.jsonl does not (series is at ${rec.step})`);
        if (ls === rec.step) {
          rows = lr;
          next = await it.next();
        }
      }
      // Cross-checked only against fields the series states as finite numbers; a missing one counts as 0 for the signal (the note)
      // but is not evidence either way about the lineage table.
      const r = rec as unknown as Record<string, unknown>;
      const stated = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
      let cells = 0;
      for (const [, c] of rows) cells += c;
      if (stated(r.livingCells) && cells !== r.livingCells)
        throw new Error(`${runId}: step ${rec.step} lineage rows sum to ${cells} cells but series.jsonl says livingCells ${r.livingCells}${rows.length ? "" : " (lineages.tsv truncated or short?)"}`);
      if (stated(r.lineages) && rows.length !== r.lineages)
        throw new Error(`${runId}: step ${rec.step} has ${rows.length} lineage rows but series.jsonl says lineages ${r.lineages}${rows.length ? "" : " (lineages.tsv truncated or short?)"}`);
      yield { rec, rows };
    }
    if (!next.done) throw new Error(`${runId}: lineages.tsv has a census at step ${next.value[0]} after the last series census`);
  } finally {
    await it.return?.(undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// Text streams (pure, so the tests can feed them chunks).

/** Lines of a stream of decoded text chunks, split by hand without holding the whole text: LF or CRLF, a last line with no newline is yielded, a lone CR is stripped only at a line end. */
export async function* splitLines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let pending: string[] = [];
  const clean = (l: string) => (l.endsWith("\r") ? l.slice(0, -1) : l);
  for await (const chunk of chunks) {
    let start = 0, nl: number;
    while ((nl = chunk.indexOf("\n", start)) >= 0) {
      const line = pending.length ? pending.join("") + chunk.slice(start, nl) : chunk.slice(start, nl);
      pending = [];
      yield clean(line);
      start = nl + 1;
    }
    if (start < chunk.length) pending.push(chunk.slice(start));
  }
  const last = pending.join("");
  if (last) yield clean(last);
}

/** series.jsonl lines to records, each an object with a numeric step; every other shape throws naming the run and the line. */
export async function* parseSeries(runId: string, lines: AsyncIterable<string>): AsyncGenerator<Record<string, unknown> & { step: number }> {
  let n = 0;
  for await (const l of lines) {
    n++;
    if (!l.trim()) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(l);
    } catch (e) {
      throw new Error(`${runId}: series.jsonl line ${n} is not JSON (${(e as Error).message})`);
    }
    if (rec === null || typeof rec !== "object" || Array.isArray(rec)) throw new Error(`${runId}: series.jsonl line ${n} is not a JSON object`);
    if (typeof (rec as { step?: unknown }).step !== "number") throw new Error(`${runId}: series.jsonl line ${n} has no numeric step`);
    yield rec as Record<string, unknown> & { step: number };
  }
}

export interface BellManifest {
  spec: { experiment: string; presetId: string; condition: string; seed: number; steps: number; censusEvery: number };
  presetIdentity: string;
  summary?: unknown;
}
/** Parses and checks a manifest.json text for the corpus run `r`; every failure names the run. */
export function parseManifest(r: CorpusRun, text: string): BellManifest {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch (e) {
    throw new Error(`${r.id}: manifest.json is not JSON (${(e as Error).message})`);
  }
  const o = m as { spec?: Record<string, unknown>; presetIdentity?: unknown; summary?: unknown } | null;
  if (o === null || typeof o !== "object" || o.spec === null || typeof o.spec !== "object") throw new Error(`${r.id}: manifest.json has no spec object`);
  const s = o.spec;
  if (s.experiment !== r.experiment || s.presetId !== r.preset || s.condition !== r.condition || s.seed !== r.seed)
    throw new Error(`${r.id}: manifest says ${s.experiment}/${s.presetId}/${s.condition}/seed-${s.seed}`);
  if (!o.summary) throw new Error(`${r.id}: manifest has no summary (unfinished run)`);
  if (typeof o.presetIdentity !== "string" || !o.presetIdentity) throw new Error(`${r.id}: manifest has no presetIdentity`);
  return o as unknown as BellManifest;
}

// ---------------------------------------------------------------------------------------------
// Rolling minimum.

/** Minimum of the last W pushed values, amortised O(1): a monotonic deque of (index, value), values increasing from the front. */
export class RollingMin {
  private idx: Float64Array;
  private val: Float64Array;
  private head = 0;
  private size = 0;
  private cap: number;
  constructor(readonly W: number) {
    this.cap = W + 1;
    this.idx = new Float64Array(this.cap);
    this.val = new Float64Array(this.cap);
  }
  clear() {
    this.head = 0;
    this.size = 0;
  }
  /** Push value v at index i (indices strictly increasing since the last clear). */
  push(i: number, v: number) {
    while (this.size > 0 && this.idx[this.head] <= i - this.W) {
      this.head = (this.head + 1) % this.cap;
      this.size--;
    }
    while (this.size > 0 && this.val[(this.head + this.size - 1) % this.cap] >= v) this.size--;
    const at = (this.head + this.size) % this.cap;
    this.idx[at] = i;
    this.val[at] = v;
    this.size++;
  }
  min(): number {
    return this.size > 0 ? this.val[this.head] : NaN;
  }
}

// ---------------------------------------------------------------------------------------------
// Group identity.

export interface RunIdentity {
  id: string;
  presetIdentity: unknown;
  steps: unknown;
  censusEvery: unknown;
}
/** Runs scored together must share preset identity, steps and census cadence; throws naming the first run that differs. */
export function checkGroupIdentity(runs: readonly RunIdentity[]): void {
  if (!runs.length) return;
  const r0 = runs[0];
  for (const r of runs) {
    for (const k of ["presetIdentity", "steps", "censusEvery"] as const) {
      if (r[k] !== r0[k]) throw new Error(`group mismatch: ${r.id} has ${k} ${JSON.stringify(r[k])}, ${r0.id} has ${JSON.stringify(r0[k])}`);
    }
    const { steps, censusEvery } = r;
    if (!(typeof steps === "number" && typeof censusEvery === "number" && Number.isInteger(steps) && Number.isInteger(censusEvery) && censusEvery > 0 && steps > 0 && steps % censusEvery === 0))
      throw new Error(`${r.id}: steps ${JSON.stringify(steps)} / censusEvery ${JSON.stringify(censusEvery)} are not a positive whole number of censuses`);
  }
}

// ---------------------------------------------------------------------------------------------
// The online scorer.

export interface Envelope {
  id: string;
  /** Indices of the runs whose values make the reference set. */
  members: number[];
}
export interface Scoring {
  /** Result id. */
  id: string;
  /** Index of the run being scored. */
  run: number;
  /** Envelope id. If the run is one of its members, it is left out (leave-one-out). */
  envelope: string;
}
export interface Receipt {
  signal: string;
  side: "high" | "low";
  Z: number;
  W: number;
  /** Step of the first census of the first window that reached Z, and of its last. */
  startStep: number;
  endStep: number;
  /** The window's smallest side*z (>= Z). */
  minAbsZ: number;
  /** The run's value and the envelope median at the window's first census. */
  value: number;
  median: number;
}
export interface SignalScore {
  signal: string;
  side: "high" | "low";
  W: number;
  D: number;
}
export interface ScoringResult {
  id: string;
  run: number;
  envelope: string;
  /** D per W, in GRID.W order. */
  D: number[];
  /** Counted windows per W (per signal); 0 means no window was long enough to count and D is 0 by default. */
  windows: number[];
  dBySignal: SignalScore[];
  /** For every (Z, W) cell, each (signal, side) that rang, with its first window; ordered by Z, W, end step, signal, side. */
  receipts: Receipt[];
  censuses: number;
}

export interface ScorerOptions {
  Z?: readonly number[];
  W?: readonly number[];
  /** When given, steps must be cadence, 2*cadence, ... with no gap. */
  cadence?: number;
  burnIn?: number;
}

const SIDES = [1, -1] as const;
const SIDE_NAME = ["high", "low"] as const;

class SignalWindows {
  len = 0;
  mins: RollingMin[][];
  D: number[][];
  windows: number[];
  first: (Receipt | undefined)[][][];
  histStep = new Float64Array(HIST);
  histX = new Float64Array(HIST);
  histM = new Float64Array(HIST);
  constructor(ws: readonly number[], zs: readonly number[]) {
    this.mins = SIDES.map(() => ws.map((w) => new RollingMin(w)));
    this.D = SIDES.map(() => ws.map(() => 0));
    this.windows = ws.map(() => 0);
    this.first = SIDES.map(() => ws.map(() => zs.map(() => undefined)));
  }
  reset() {
    this.len = 0;
    for (const side of this.mins) for (const m of side) m.clear();
  }
}

interface EnvState {
  members: number[];
  memberPos: Map<number, number>;
  sorted: Float64Array[]; // per signal
  rank: Int32Array[]; // per signal: member position -> index in sorted
}

/**
 * Consumes censuses in lockstep for a group of runs and scores some of them against reference sets drawn from the group.
 * `push` takes one entry per run (same step for all, else it throws naming the runs), with that run's signal vector
 * (SignalExtractor output). Holds O(scorings x signals x sides x W) state, never a table.
 */
export class BellScorer {
  readonly zs: readonly number[];
  readonly ws: readonly number[];
  readonly burnIn: number;
  private cadence?: number;
  private env: EnvState[];
  private envIndex = new Map<string, number>();
  private state: SignalWindows[][]; // [scoring][signal]
  private n = 0;
  private lastStep = -Infinity;

  constructor(readonly runIds: readonly string[], envelopes: readonly Envelope[], readonly scorings: readonly Scoring[], opts: ScorerOptions = {}) {
    this.zs = opts.Z ?? GRID.Z;
    this.ws = opts.W ?? GRID.W;
    this.burnIn = opts.burnIn ?? BURN_IN_STEP;
    this.cadence = opts.cadence;
    for (const w of this.ws) if (!(Number.isInteger(w) && w >= 1 && w < HIST)) throw new Error(`window length ${w} outside 1..${HIST - 1}`);
    this.env = envelopes.map((e, k) => {
      if (this.envIndex.has(e.id)) throw new Error(`duplicate envelope ${e.id}`);
      this.envIndex.set(e.id, k);
      if (!e.members.length) throw new Error(`envelope ${e.id} has no members`);
      const memberPos = new Map<number, number>();
      e.members.forEach((r, p) => {
        if (!(r >= 0 && r < runIds.length)) throw new Error(`envelope ${e.id}: member ${r} is not a run`);
        if (memberPos.has(r)) throw new Error(`envelope ${e.id}: run ${runIds[r]} listed twice`);
        memberPos.set(r, p);
      });
      return {
        members: [...e.members],
        memberPos,
        sorted: SIGNALS.map(() => new Float64Array(e.members.length)),
        rank: SIGNALS.map(() => new Int32Array(e.members.length)),
      };
    });
    const ids = new Set<string>();
    for (const s of scorings) {
      if (ids.has(s.id)) throw new Error(`duplicate scoring ${s.id}`);
      ids.add(s.id);
      if (!this.envIndex.has(s.envelope)) throw new Error(`scoring ${s.id}: unknown envelope ${s.envelope}`);
      if (!(s.run >= 0 && s.run < runIds.length)) throw new Error(`scoring ${s.id}: run ${s.run} is not a run`);
      const e = this.env[this.envIndex.get(s.envelope)!];
      if (e.members.length - (e.memberPos.has(s.run) ? 1 : 0) < 1) throw new Error(`scoring ${s.id}: no reference run left after leaving it out`);
    }
    this.state = scorings.map(() => SIGNALS.map(() => new SignalWindows(this.ws, this.zs)));
  }

  get censuses(): number {
    return this.n;
  }

  push(censuses: readonly { step: number; values: readonly (number | null)[] }[]): void {
    const R = this.runIds.length;
    if (censuses.length !== R) throw new Error(`lockstep: ${censuses.length} censuses for ${R} runs`);
    const step = censuses[0].step;
    for (let r = 0; r < R; r++) {
      if (censuses[r].step !== step)
        throw new Error(`lockstep: ${this.runIds[r]} is at step ${censuses[r].step} but the first run ${this.runIds[0]} (the reference) is at step ${step}`);
      if (censuses[r].values.length !== SIGNALS.length) throw new Error(`${this.runIds[r]}: ${censuses[r].values.length} signal values, expected ${SIGNALS.length}`);
    }
    if (!Number.isFinite(step) || !(step > this.lastStep)) throw new Error(`lockstep: step ${step} does not follow step ${this.lastStep}`);
    if (this.cadence !== undefined) {
      const want = this.n === 0 ? this.cadence : this.lastStep + this.cadence;
      if (step !== want) throw new Error(`lockstep: census at step ${step} where cadence ${this.cadence} expects ${want} (a missing or extra census)`);
    }
    // A signal is undefined (null) for all runs or for none.
    const defined: boolean[] = [];
    for (let s = 0; s < SIGNALS.length; s++) {
      let nulls = 0, firstNull = -1;
      for (let r = 0; r < R; r++) {
        if (censuses[r].values[s] !== null) continue;
        nulls++;
        if (firstNull < 0) firstNull = r;
      }
      if (nulls !== 0 && nulls !== R) throw new Error(`${SIGNALS[s].name} is undefined for ${this.runIds[firstNull]} but not for every run at step ${step}`);
      defined.push(nulls === 0);
    }
    const x = (r: number, s: number) => finiteOrZero(censuses[r].values[s]);
    // Reference sets, sorted once per census and signal.
    for (const e of this.env) {
      for (let s = 0; s < SIGNALS.length; s++) {
        if (!defined[s]) continue;
        const m = e.members.length;
        const order = Array.from({ length: m }, (_, i) => i).sort((a, b) => x(e.members[a], s) - x(e.members[b], s) || a - b);
        for (let k = 0; k < m; k++) {
          e.sorted[s][k] = x(e.members[order[k]], s);
          e.rank[s][order[k]] = k;
        }
      }
    }
    const idx = this.n;
    const counted = step >= this.burnIn;
    for (let k = 0; k < this.scorings.length; k++) {
      const sc = this.scorings[k];
      const e = this.env[this.envIndex.get(sc.envelope)!];
      const p = e.memberPos.get(sc.run);
      for (let s = 0; s < SIGNALS.length; s++) {
        const st = this.state[k][s];
        if (!defined[s] || !counted) {
          st.reset();
          continue;
        }
        const xv = x(sc.run, s);
        const skip = p === undefined ? Infinity : e.rank[s][p];
        const d = departure(xv, e.sorted[s], skip, SIGNALS[s].floor);
        st.len++;
        const h = idx % HIST;
        st.histStep[h] = step;
        st.histX[h] = xv;
        st.histM[h] = d.median;
        for (let si = 0; si < 2; si++) {
          const v = SIDES[si] * d.z;
          for (let wi = 0; wi < this.ws.length; wi++) {
            const W = this.ws[wi];
            const rm = st.mins[si][wi];
            rm.push(idx, v);
            if (st.len < W) continue;
            const m = rm.min();
            if (si === 0) st.windows[wi]++;
            if (m > st.D[si][wi]) st.D[si][wi] = m;
            for (let zi = 0; zi < this.zs.length; zi++) {
              if (st.first[si][wi][zi] || !(m >= this.zs[zi])) continue;
              const sh = (idx - W + 1) % HIST;
              st.first[si][wi][zi] = {
                signal: SIGNALS[s].name,
                side: SIDE_NAME[si],
                Z: this.zs[zi],
                W,
                startStep: st.histStep[sh],
                endStep: step,
                minAbsZ: m,
                value: st.histX[sh],
                median: st.histM[sh],
              };
            }
          }
        }
      }
    }
    this.lastStep = step;
    this.n++;
  }

  results(): ScoringResult[] {
    return this.scorings.map((sc, k) => {
      const D = this.ws.map(() => 0);
      const windows = this.ws.map(() => 0);
      const dBySignal: SignalScore[] = [];
      const receipts: Receipt[] = [];
      for (let s = 0; s < SIGNALS.length; s++) {
        const st = this.state[k][s];
        for (let wi = 0; wi < this.ws.length; wi++) {
          windows[wi] = Math.max(windows[wi], st.windows[wi]);
          for (let si = 0; si < 2; si++) {
            const d = st.D[si][wi];
            if (d > D[wi]) D[wi] = d;
            dBySignal.push({ signal: SIGNALS[s].name, side: SIDE_NAME[si], W: this.ws[wi], D: d });
            for (const r of st.first[si][wi]) if (r) receipts.push(r);
          }
        }
      }
      const order = (n: string) => SIGNALS.findIndex((d) => d.name === n);
      receipts.sort((a, b) => a.Z - b.Z || a.W - b.W || a.endStep - b.endStep || order(a.signal) - order(b.signal) || (a.side === b.side ? 0 : a.side === "high" ? -1 : 1));
      return { id: sc.id, run: sc.run, envelope: sc.envelope, D, windows, dBySignal, receipts, censuses: this.n };
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Group plan: who is a reference, who is scored against what.

export interface GroupPlan {
  /** The runs of the group that are read (reference members or scored), in the order given. */
  runs: CorpusRun[];
  envelopes: Envelope[];
  scorings: (Scoring & { envelope: EnvelopeId })[];
}
/**
 * One preset's runs. "all-neutral": every neutral run of the preset (pooled across experiments); every run is scored against it,
 * a neutral run leave-one-out. "m4-neutral" (the preliminary readout, only where the group has treatment or no-mutation runs): the
 * replay-m4 neutral runs; those, treatment and no-mutation are scored against it. With `preliminaryOnly` the first is left out.
 */
export function planGroup(group: readonly CorpusRun[], opts: { preliminaryOnly?: boolean } = {}): GroupPlan {
  const presets = new Set(group.map((r) => r.preset));
  if (presets.size > 1) throw new Error(`planGroup: runs of more than one preset (${[...presets].join(", ")})`);
  const neutral = group.filter((r) => r.condition === "neutral");
  const hasDiffering = group.some((r) => r.condition !== "neutral");
  const m4 = neutral.filter((r) => r.experiment === "replay-m4");
  const wantFull = !opts.preliminaryOnly;
  const wantPrelim = hasDiffering && m4.length > 0;
  const refs: Record<EnvelopeId, CorpusRun[]> = { "all-neutral": wantFull ? neutral : [], "m4-neutral": wantPrelim ? m4 : [] };
  const wanted: { run: CorpusRun; envelope: EnvelopeId }[] = [];
  if (wantFull) for (const r of group) wanted.push({ run: r, envelope: "all-neutral" });
  if (wantPrelim) for (const r of group) if (r.condition !== "neutral" || r.experiment === "replay-m4") wanted.push({ run: r, envelope: "m4-neutral" });
  // A scoring needs at least one reference run left after leaving the scored run out (a lone neutral run has none and is skipped, not crashed on).
  const kept = wanted.filter((w) => refs[w.envelope].length - (refs[w.envelope].some((m) => m.id === w.run.id) ? 1 : 0) >= 1);
  const liveEnv = (["all-neutral", "m4-neutral"] as const).filter((id) => kept.some((w) => w.envelope === id));
  const used = new Set<string>();
  for (const w of kept) used.add(w.run.id);
  for (const id of liveEnv) for (const r of refs[id]) used.add(r.id);
  const runs = group.filter((r) => used.has(r.id));
  const at = new Map(runs.map((r, i) => [r.id, i]));
  const envelopes: Envelope[] = liveEnv.map((id) => ({ id, members: refs[id].map((r) => at.get(r.id)!) }));
  const scorings = kept.map((w) => ({ id: `${w.run.id}@${w.envelope}`, run: at.get(w.run.id)!, envelope: w.envelope }));
  return { runs, envelopes, scorings };
}

// ---------------------------------------------------------------------------------------------
// Summary and reading.

export interface ScoredEntry {
  id: string;
  experiment: string;
  preset: string;
  condition: Condition;
  envelope: EnvelopeId;
  /** D keyed by String(W). */
  D: Record<string, number>;
}
export function entryOf(run: CorpusRun, result: ScoringResult, ws: readonly number[] = GRID.W): ScoredEntry {
  return {
    id: run.id,
    experiment: run.experiment,
    preset: run.preset,
    condition: run.condition,
    envelope: result.envelope as EnvelopeId,
    D: Object.fromEntries(ws.map((w, i) => [String(w), result.D[i]])),
  };
}

/** One-sided 95% Clopper–Pearson upper bound on a rate k/n (as tools/foundations.ts binomialUpperBound, test 6's null rule). */
export const binomialUpperBound = (k: number, n: number): number => 1 - binomialLowerBound(n - k, n);

export type Reading = "clapper" | "quiet but deaf" | "rings on drift" | "not called";
export interface Count {
  k: number;
  of: number;
}
export interface GridCell {
  Z: number;
  W: number;
  /** Neutral runs flagged against the all-neutral envelope (leave-one-out) and the binomial upper bound (null when there are none). */
  falseAlarms: Count & { upper95: number | null };
  /** The 20 replay-m4 gradient neutral runs against the m4-neutral envelope. */
  falseAlarmsPrelim: Count;
  treatmentRings: Count;
  noMutationRings: Count;
  treatmentRingsPrelim: Count;
  noMutationRingsPrelim: Count;
  /** P(D_a > D_b) with ties half; a over b. */
  effectTreatmentVsNeutral: number | null;
  effectNoMutationVsNeutral: number | null;
  effectTreatmentVsNoMutation: number | null;
  effectTreatmentVsNeutralPrelim: number | null;
  effectNoMutationVsNeutralPrelim: number | null;
}
export interface Criterion {
  status: "pass" | "fail" | "not-called";
  reason?: string;
}
export interface HeldOut {
  status: "called" | "not-called";
  reason?: string;
  W: number;
  perPreset: Record<string, { calibRuns: number; zStar: number | null; heldOutNeutral: Count; expected: number | null }>;
  heldOutNeutralTotal: Count & { expected: number };
  treatment: Count & { zStar: number | null };
  noMutation: Count & { zStar: number | null };
}
export interface BellSummary {
  version: number;
  primary: { Z: number; W: number };
  complete: boolean;
  criterion1: Criterion & { k: number; n: number; upper95: number | null };
  criterion2: Criterion & { effect: number | null; nTreatment: number; nNeutral: number };
  reading: Reading;
  grid: GridCell[];
  reported: {
    noMutationVsNeutral: { effect: number | null; rings: Count };
    treatmentRings: Count;
    treatmentVsNoMutation: { effect: number | null };
    preliminary: { falseAlarms: Count; treatmentRings: Count; noMutationRings: Count; effectTreatmentVsNeutral: number | null; effectNoMutationVsNeutral: number | null };
  };
  secondary: HeldOut;
}

const effect = (a: number[], b: number[]): number | null => (a.length && b.length ? mannWhitney(a, b, "normal").effect : null);

export function summarize(entries: readonly ScoredEntry[], opts: { complete?: boolean } = {}): BellSummary {
  const complete = opts.complete ?? true;
  const sel = (envelope: EnvelopeId, condition: Condition, preset?: string, experiment?: string) =>
    entries.filter((e) => e.envelope === envelope && e.condition === condition && (preset === undefined || e.preset === preset) && (experiment === undefined || e.experiment === experiment));
  const Ds = (es: ScoredEntry[], W: number) => es.map((e) => e.D[String(W)]);
  const rings = (es: ScoredEntry[], Z: number, W: number): Count => ({ k: es.filter((e) => e.D[String(W)] >= Z).length, of: es.length });

  const neutral = sel("all-neutral", "neutral");
  const gradNeutral = sel("all-neutral", "neutral", "gradient-m3");
  const treat = sel("all-neutral", "treatment");
  const noMut = sel("all-neutral", "no-mutation");
  const neutralPre = sel("m4-neutral", "neutral");
  const treatPre = sel("m4-neutral", "treatment");
  const noMutPre = sel("m4-neutral", "no-mutation");

  const grid: GridCell[] = [];
  for (const W of GRID.W) {
    for (const Z of GRID.Z) {
      const fa = rings(neutral, Z, W);
      grid.push({
        Z,
        W,
        falseAlarms: { ...fa, upper95: fa.of > 0 ? binomialUpperBound(fa.k, fa.of) : null },
        falseAlarmsPrelim: rings(neutralPre, Z, W),
        treatmentRings: rings(treat, Z, W),
        noMutationRings: rings(noMut, Z, W),
        treatmentRingsPrelim: rings(treatPre, Z, W),
        noMutationRingsPrelim: rings(noMutPre, Z, W),
        effectTreatmentVsNeutral: effect(Ds(treat, W), Ds(gradNeutral, W)),
        effectNoMutationVsNeutral: effect(Ds(noMut, W), Ds(gradNeutral, W)),
        effectTreatmentVsNoMutation: effect(Ds(treat, W), Ds(noMut, W)),
        effectTreatmentVsNeutralPrelim: effect(Ds(treatPre, W), Ds(neutralPre, W)),
        effectNoMutationVsNeutralPrelim: effect(Ds(noMutPre, W), Ds(neutralPre, W)),
      });
    }
  }
  const cell = grid.find((c) => c.Z === PRIMARY.Z && c.W === PRIMARY.W)!;

  // Criterion 1: refused unless all 70 neutral runs are present (and the corpus is complete).
  const faPrimary = cell.falseAlarms;
  let criterion1: BellSummary["criterion1"];
  if (!complete || faPrimary.of !== EXPECTED_NEUTRAL) {
    criterion1 = { status: "not-called", reason: `${faPrimary.of} neutral runs scored${complete ? "" : " (incomplete corpus)"}, the bar needs ${EXPECTED_NEUTRAL}`, k: faPrimary.k, n: faPrimary.of, upper95: faPrimary.upper95 };
  } else {
    criterion1 = { status: faPrimary.upper95! < UPPER_BAR ? "pass" : "fail", k: faPrimary.k, n: faPrimary.of, upper95: faPrimary.upper95 };
  }
  // Criterion 2: 10 treatment against the 40 gradient-m3 neutral runs.
  let criterion2: BellSummary["criterion2"];
  const eff = cell.effectTreatmentVsNeutral;
  if (!complete || treat.length !== EXPECTED_TREATMENT || gradNeutral.length !== EXPECTED_GRADIENT_NEUTRAL || eff === null) {
    criterion2 = { status: "not-called", reason: `${treat.length} treatment and ${gradNeutral.length} gradient-m3 neutral runs scored${complete ? "" : " (incomplete corpus)"}, the bar needs ${EXPECTED_TREATMENT} and ${EXPECTED_GRADIENT_NEUTRAL}`, effect: eff, nTreatment: treat.length, nNeutral: gradNeutral.length };
  } else {
    criterion2 = { status: eff >= EFFECT_BAR ? "pass" : "fail", effect: eff, nTreatment: treat.length, nNeutral: gradNeutral.length };
  }
  // Reading, as fixed in the note. No label for the case where a criterion could not be called: "not called".
  let reading: Reading = "not called";
  if (criterion1.status === "fail") reading = "rings on drift";
  else if (criterion1.status === "pass" && criterion2.status === "pass") reading = "clapper";
  else if (criterion1.status === "pass" && criterion2.status === "fail") reading = "quiet but deaf";

  // Secondary: a calibrated bell, held out. Z*_p = largest D at W = 50 among the replay-calib neutral runs of preset p.
  const W2 = PRIMARY.W;
  // The preset list is the note's, not inferred from the data: a preset that is absent entirely is a missing corpus, not a smaller one.
  const presets = [...new Set([...Object.keys(EXPECTED_HELD_OUT), ...neutral.map((e) => e.preset)])].sort();
  const perPreset: HeldOut["perPreset"] = {};
  let hk = 0, hn = 0, hExpected = 0, secondaryOk = true;
  const zStars: Record<string, number | null> = {};
  for (const p of presets) {
    const calib = Ds(neutral.filter((e) => e.preset === p && e.experiment === "replay-calib"), W2);
    const held = neutral.filter((e) => e.preset === p && e.experiment === "replay-m4");
    const zStar = calib.length === EXPECTED_CALIB_PER_PRESET ? Math.max(...calib) : null;
    zStars[p] = zStar;
    if (zStar === null || held.length !== EXPECTED_HELD_OUT[p]) secondaryOk = false;
    const k = zStar === null ? 0 : held.filter((e) => e.D[String(W2)] > zStar).length;
    const expected = zStar === null ? null : held.length / (calib.length + 1);
    perPreset[p] = { calibRuns: calib.length, zStar, heldOutNeutral: { k, of: held.length }, expected };
    if (zStar !== null) {
      hk += k;
      hn += held.length;
      hExpected += expected!;
    }
  }
  const zg = zStars["gradient-m3"] ?? null;
  const above = (es: ScoredEntry[]): Count & { zStar: number | null } => ({ k: zg === null ? 0 : es.filter((e) => e.D[String(W2)] > zg).length, of: es.length, zStar: zg });
  const secondary: HeldOut = {
    status: secondaryOk && complete ? "called" : "not-called",
    ...(secondaryOk && complete ? {} : { reason: complete ? `each of ${Object.keys(EXPECTED_HELD_OUT).join(" and ")} needs ${EXPECTED_CALIB_PER_PRESET} replay-calib neutral runs and its held-out replay-m4 neutral runs (${Object.entries(EXPECTED_HELD_OUT).map(([p, n]) => `${p} ${n}`).join(", ")})` : "incomplete corpus" }),
    W: W2,
    perPreset,
    heldOutNeutralTotal: { k: hk, of: hn, expected: hExpected },
    treatment: above(treat),
    noMutation: above(noMut),
  };

  return {
    version: BELL_VERSION,
    primary: { ...PRIMARY },
    complete,
    criterion1,
    criterion2,
    reading,
    grid,
    reported: {
      noMutationVsNeutral: { effect: cell.effectNoMutationVsNeutral, rings: cell.noMutationRings },
      treatmentRings: cell.treatmentRings,
      treatmentVsNoMutation: { effect: cell.effectTreatmentVsNoMutation },
      preliminary: {
        falseAlarms: cell.falseAlarmsPrelim,
        treatmentRings: cell.treatmentRingsPrelim,
        noMutationRings: cell.noMutationRingsPrelim,
        effectTreatmentVsNeutral: cell.effectTreatmentVsNeutralPrelim,
        effectNoMutationVsNeutral: cell.effectNoMutationVsNeutralPrelim,
      },
    },
    secondary,
  };
}

// ---------------------------------------------------------------------------------------------
// Where the records go, and what may be overwritten.

/**
 * The default record and detail paths. Only a complete readout goes to the official names; a preliminary-only or incomplete run
 * gets its own, so exploring cannot replace a called readout.
 */
export function defaultOutputs(mode: { complete: boolean; preliminaryOnly: boolean }): { record: string; out: string } {
  const suffix = mode.complete ? "" : mode.preliminaryOnly ? ".preliminary" : ".incomplete";
  return { record: `experiments/naturalist/bell-v0${suffix}.json`, out: `runs/naturalist/bell-v0${suffix}` };
}

/**
 * Whether a new record may be written over what is at the target: refuses a record with no scored runs, and refuses to replace an
 * existing record that is complete with one that is not (unless forced). Returns the reason to refuse, or null.
 */
export function recordRefusal(existingText: string | null, next: { complete: boolean; scored: number; force?: boolean }): string | null {
  if (next.scored === 0) return "no run was scored, so there is nothing to record";
  if (next.complete || next.force || existingText === null) return null;
  let old: unknown;
  try {
    old = JSON.parse(existingText);
  } catch {
    return null; // an unreadable file holds no called readout to protect
  }
  if (old !== null && typeof old === "object" && (old as { complete?: unknown }).complete === true)
    return "the file already holds a complete readout and this run is incomplete or preliminary (pass --force to replace it, or choose another --record)";
  return null;
}
