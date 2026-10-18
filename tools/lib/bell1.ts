// The anomaly bell, v1, parts A and B (docs/naturalist-bell-v1-plan-2026-10-17.md, section "Fixed before running"; that section is
// frozen and this file implements it, it does not amend it). v0's note (docs/naturalist-bell-v0-2026-10-17.md) defines the
// inherited score, and tools/lib/bell.ts is imported, not edited. Pure functions and classes over census streams; no Deno or
// filesystem access, so vitest can load it. The CLI is tools/bell1.ts; the job list and the nudge rule are tools/lib/bell-v1-jobs.ts.
//
// Part A (the envelope bell on fresh nulls). v0's departure score (z with spread max(IQR/1.349, 5% |median|, floor); rates over 10
// censuses; windows starting at or after step 10,000; Z = 4, W = 50), with two changes: eleven signals (v0's thirteen without
// `maxGeneration` and `dominantShare`) and a horizon of 300,000 steps. One BellScorer pass gives both rules: D13 is the scorer's
// own D (all thirteen signals), D11 is the largest D among the eleven kept signals (`dBySignal`). A run rings iff D >= Z, as in v0.
// A member of the envelope is scored leave-one-out (BellScorer does that for a scored run that is also a member); a fresh run and
// a treatment run are not members and are scored against all of them.
//
// Part B (the twin bell). For a twin and its base, z_s(t) = (x_twin - x_base) / spread_s(t), where spread_s(t) is v0's spread
// max(IQR/1.349, 5% |median|, floor) over the bases at t (ten treatment bundles; the base is one of them, the twin is not). All
// thirteen signals, each run's rates from its own counters over 10 censuses. A window is W_PAIR = 10 consecutive censuses; it counts
// only when its first census is at a step in [S + 100, S + 5000]. D_pair = the largest, over counted windows and both sides, of the
// window's smallest side*z, floored at 0, then the maximum over signals. The window minima are kept (per signal and side), so
// "the first window above Z*_pair" is known once Z*_pair is, without a second read.
import { binomialLowerBound, mannWhitney } from "@bl/metrics";
import {
  BellScorer,
  PRIMARY,
  RollingMin,
  SIGNALS,
  SignalExtractor,
  binomialUpperBound,
  corpusRuns,
  departure,
  finiteOrZero,
  parseManifest,
  type BellManifest,
  type CorpusRun,
  type Count,
  type Envelope,
  type Receipt,
  type Scoring,
  type ScoringResult,
} from "./bell.ts";
import { ARMS, NUDGE_TARGETS, S as S_DEFAULT, STEPS, interventionsMatch, planJobs, type Arm, type Job, type NudgeCentres } from "./bell-v1-jobs.ts";

export const BELL1_VERSION = 1;
export const NOTE1_PATH = "docs/naturalist-bell-v1-plan-2026-10-17.md";

// ---------------------------------------------------------------------------------------------
// Fixed parameters (the note).

/** Census cadence of every bundle read here. */
export const CADENCE = 100;
/** Part A's horizon: censuses at steps up to this; 3,000 of them. */
export const HORIZON = 300_000;
export const HORIZON_CENSUSES = HORIZON / CADENCE;
/** The two signals v1 drops. */
export const DROPPED_SIGNALS: readonly string[] = ["maxGeneration", "dominantShare"];
export const isV1Signal = (name: string): boolean => !DROPPED_SIGNALS.includes(name);
/** Fresh nulls the criterion needs (seeds 2002 to 2071), and the envelope. */
export const EXPECTED_FRESH = 70;
export const EXPECTED_ENVELOPE = 40;
export const EXPECTED_SPOTS = 30;
export const EXPECTED_TREATMENT_A = 10;
/** Criterion A1: at most this many of the 70 fresh runs ring (the note; it is the upper-95% bound below 0.1 for n = 70). */
export const A1_MAX_RINGS = 2;
export const NULL_EXPERIMENT = "bell-v1-null";
export const ENVELOPE_ID = "E";
/** The scorer settings of part A: one cell, Z = 4, W = 50, burn-in 10,000 (the scorer's default), every census at the cadence. */
export const NULL_SCORER_OPTS = { Z: [PRIMARY.Z], W: [PRIMARY.W], cadence: CADENCE } as const;

/** Part B. */
export const W_PAIR = 10;
/** A window counts when its first census is at a step in [S + EARLY_FROM, S + EARLY_TO]. */
export const EARLY_FROM = 100;
export const EARLY_TO = 5000;
export const PER_ARM = 10;
/** B2: at least this many of the 10 twins of an arm. B3: at most this many of the 10 nudge2 twins. */
export const B2_MIN_HITS = 8;
export const B3_MAX_HITS = 2;
/**
 * The matter channels of a series record's `pools` (A nutrient, B biomass, C waste, P polymer): matter = A + B + C + P, as in
 * packages/schema/src/accounting.ts `totalsOf`. E (free energy) and S (signal) are energy, not matter, and are left out.
 */
export const MATTER_CHANNELS = ["A", "B", "C", "P"] as const;
/** A series record's matter total (MATTER_CHANNELS of its pools); null when `pools` or any of those channels is missing or not finite. */
export function matterOf(rec: Record<string, unknown>): number | null {
  const pools = rec.pools as Record<string, unknown> | null | undefined;
  if (pools === null || typeof pools !== "object") return null;
  let m = 0;
  for (const ch of MATTER_CHANNELS) {
    const v = pools[ch];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    m += v;
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Corpus.

export interface NullRun extends CorpusRun {
  set: NullSet;
}
export type NullSet = "v0-gradient" | "v0-spots" | "treatment" | "fresh";

/** The 40 gradient-m3 envelope runs, the 30 spots-m3 runs and the 10 gradient-m3 treatment runs of v0's corpus, in corpusRuns() order. */
export function v0Runs(): { envelope: NullRun[]; spots: NullRun[]; treatment: NullRun[] } {
  const all = corpusRuns();
  const tag = (rs: CorpusRun[], set: NullSet): NullRun[] => rs.map((r) => ({ ...r, set }));
  return {
    envelope: tag(all.filter((r) => r.condition === "neutral" && r.preset === "gradient-m3"), "v0-gradient"),
    spots: tag(all.filter((r) => r.condition === "neutral" && r.preset === "spots-m3"), "v0-spots"),
    treatment: tag(all.filter((r) => r.condition === "treatment" && r.preset === "gradient-m3"), "treatment"),
  };
}
/** The fresh nulls: bell-v1-null/gradient-m3/neutral/seed-2002..2071. */
export function freshRuns(seeds: readonly [number, number] = [2002, 2071]): NullRun[] {
  const out: NullRun[] = [];
  for (let seed = seeds[0]; seed <= seeds[1]; seed++) {
    const rel = `${NULL_EXPERIMENT}/gradient-m3/neutral/seed-${seed}`;
    out.push({ id: rel, experiment: NULL_EXPERIMENT, preset: "gradient-m3", condition: "neutral", seed, rel, set: "fresh" });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Manifest checks.

/** A v0 run (envelope, spots, treatment): the corpus manifest checks, a census cadence of 100 and at least HORIZON steps. */
export function checkV0Manifest(r: CorpusRun, text: string): BellManifest {
  const m = parseManifest(r, text);
  if (m.spec.censusEvery !== CADENCE) throw new Error(`${r.id}: censusEvery ${m.spec.censusEvery}, expected ${CADENCE}`);
  if (!(typeof m.spec.steps === "number" && m.spec.steps >= HORIZON)) throw new Error(`${r.id}: ${m.spec.steps} steps, the horizon needs at least ${HORIZON}`);
  return m;
}
/** A fresh run (or a twin): the corpus manifest checks, cadence 100 and exactly `steps` steps. */
export function checkExactManifest(r: CorpusRun, text: string, steps: number): BellManifest {
  const m = parseManifest(r, text);
  if (m.spec.censusEvery !== CADENCE) throw new Error(`${r.id}: censusEvery ${m.spec.censusEvery}, expected ${CADENCE}`);
  if (m.spec.steps !== steps) throw new Error(`${r.id}: ${m.spec.steps} steps, expected exactly ${steps}`);
  return m;
}
/** Runs scored together share preset identity and census cadence (steps differ by design: v0 bundles are longer than the horizon). Throws naming the first that differs. */
export function checkHorizonIdentity(runs: readonly { id: string; presetIdentity: string; censusEvery: number }[]): void {
  if (!runs.length) return;
  const r0 = runs[0];
  for (const r of runs) {
    if (r.presetIdentity !== r0.presetIdentity) throw new Error(`group mismatch: ${r.id} has presetIdentity ${r.presetIdentity}, ${r0.id} has ${r0.presetIdentity}`);
    if (r.censusEvery !== r0.censusEvery) throw new Error(`group mismatch: ${r.id} has censusEvery ${r.censusEvery}, ${r0.id} has ${r0.censusEvery}`);
  }
}

/**
 * Reads `count` censuses from a merged stream (mergeCensuses output), checking that census i is at step i * cadence. `exact`: then one
 * more read must find the stream finished (a 3,001st census, or a lineage census past the last series census, throws). A stream read
 * to the horizon only (a v0 bundle, 1,000,000 steps long) is not exact. The generator is closed on every exit.
 */
export async function checkCensusStream(runId: string, it: AsyncGenerator<{ rec: { step: number } }>, count: number, cadence: number, exact: boolean): Promise<void> {
  try {
    for (let i = 0; i < count; i++) {
      const n = await it.next();
      if (n.done) throw new Error(`${runId}: ${i} censuses, expected ${count}`);
      const want = (i + 1) * cadence;
      if (n.value.rec.step !== want) throw new Error(`${runId}: census ${i + 1} is at step ${n.value.rec.step}, expected ${want}`);
    }
    if (exact) {
      const n = await it.next();
      if (!n.done) throw new Error(`${runId}: more than ${count} censuses (the next is at step ${n.value.rec.step})`);
    }
  } finally {
    await it.return(undefined);
  }
}

type StrictCensus = { rec: Record<string, unknown> & { step: number }; rows: readonly (readonly [string, number])[] };
/**
 * The note's per-census validity rule for a fresh null and for every twin: finite `livingCells` and `lineages`, the lineage rows' cells
 * summing to `livingCells`, one row per lineage, and no rows only when both are 0. Stricter than v0's mergeCensuses, which skips a check
 * when the series does not state the field. Null when the census passes, else the reason.
 */
export function censusProblem(rec: Record<string, unknown> & { step: number }, rows: readonly (readonly [string, number])[]): string | null {
  const lc = rec.livingCells, ln = rec.lineages;
  if (typeof lc !== "number" || !Number.isFinite(lc)) return `step ${rec.step}: livingCells is ${JSON.stringify(lc) ?? "missing"}, not a finite number`;
  if (typeof ln !== "number" || !Number.isFinite(ln)) return `step ${rec.step}: lineages is ${JSON.stringify(ln) ?? "missing"}, not a finite number`;
  let cells = 0;
  for (const [, c] of rows) cells += c;
  if (cells !== lc) return `step ${rec.step}: lineage rows sum to ${cells} cells but livingCells is ${lc}${rows.length ? "" : " (lineages.tsv truncated or short?)"}`;
  if (rows.length !== ln) return `step ${rec.step}: ${rows.length} lineage rows but lineages is ${ln}${rows.length ? "" : " (lineages.tsv truncated or short?)"}`;
  // Implied by the two checks above (no rows iff lineages is 0, and then livingCells is 0); kept so the note's wording is checked as written.
  if ((rows.length === 0) !== (lc === 0 && ln === 0)) return `step ${rec.step}: ${rows.length} lineage rows with livingCells ${lc} and lineages ${ln} (no rows only when both are 0)`;
  return null;
}
/** A census stream (mergeCensuses output) that throws, naming the run, at the first census failing censusProblem. The source is closed on every exit. */
export async function* strictCensuses<T extends StrictCensus>(runId: string, it: AsyncIterable<T>): AsyncGenerator<T> {
  for await (const c of it) {
    const p = censusProblem(c.rec, c.rows);
    if (p) throw new Error(`${runId}: ${p}`);
    yield c;
  }
}

// ---------------------------------------------------------------------------------------------
// The launch log (tools/bell-v1-launch.ts: one {id, exit, seconds} line per finished job).

export function parseLaunchLog(text: string): Map<string, { exit: number; seconds?: number }> {
  const out = new Map<string, { exit: number; seconds?: number }>();
  text.split("\n").forEach((l, i) => {
    if (!l.trim()) return;
    let o: unknown;
    try {
      o = JSON.parse(l);
    } catch (e) {
      throw new Error(`launch log line ${i + 1} is not JSON (${(e as Error).message})`);
    }
    const r = o as { id?: unknown; exit?: unknown; seconds?: unknown } | null;
    if (r === null || typeof r !== "object" || typeof r.id !== "string" || typeof r.exit !== "number") throw new Error(`launch log line ${i + 1} has no id and exit`);
    out.set(r.id, { exit: r.exit, seconds: typeof r.seconds === "number" ? r.seconds : undefined }); // a repeated id: the last line wins
  });
  return out;
}
/**
 * Null when the job is listed and exited 0, else the reason. The launcher writes a line for every job that finishes, whatever its exit,
 * so a job the log does not list has not finished (or was never launched) and does not count. A null log means no check was asked for
 * (only the smoke-test plan runs without one).
 */
export function launchProblem(log: Map<string, { exit: number }> | null, jobId: string): string | null {
  if (log === null) return null;
  const e = log.get(jobId);
  if (!e) return `launch log: ${jobId} is not listed (unfinished, or never launched)`;
  return e.exit !== 0 ? `launch log: ${jobId} exited ${e.exit}` : null;
}
/** For the record: how many of the expected jobs the log lists, and how many of those exited 0. */
export function launchCoverage(log: Map<string, { exit: number }>, ids: readonly string[]): { expected: number; listed: number; exit0: number } {
  const listed = ids.filter((i) => log.has(i));
  return { expected: ids.length, listed: listed.length, exit0: listed.filter((i) => log.get(i)!.exit === 0).length };
}

// ---------------------------------------------------------------------------------------------
// Part A: scoring plan, entries, summary.

export interface NullPlan {
  runIds: string[];
  envelopes: Envelope[];
  scorings: Scoring[];
}
/** Runs in the order envelope, then the rest; every run is scored against the envelope (an envelope member leave-one-out, by the scorer). */
export function planNull(envelopeIds: readonly string[], otherIds: readonly string[]): NullPlan {
  const runIds = [...envelopeIds, ...otherIds];
  return {
    runIds,
    envelopes: [{ id: ENVELOPE_ID, members: envelopeIds.map((_, i) => i) }],
    scorings: runIds.map((id, run) => ({ id, run, envelope: ENVELOPE_ID })),
  };
}
export function newNullScorer(plan: NullPlan): BellScorer {
  return new BellScorer(plan.runIds, plan.envelopes, plan.scorings, NULL_SCORER_OPTS);
}

export interface NullEntry {
  id: string;
  set: NullSet;
  preset: string;
  seed: number;
  /** Largest D over all thirteen signals (v0's rule) and over the eleven kept ones (v1's), at W = 50. */
  D13: number;
  D11: number;
  ring13: boolean;
  ring11: boolean;
  /** The earliest ring (by end step) of each rule, with its receipts; null when the rule does not ring. */
  firstRing13: Receipt | null;
  firstRing11: Receipt | null;
}
const firstOf = (rs: readonly Receipt[], keep: (s: string) => boolean): Receipt | null => {
  let best: Receipt | null = null;
  for (const r of rs) if (r.Z === PRIMARY.Z && r.W === PRIMARY.W && keep(r.signal) && (!best || r.endStep < best.endStep)) best = r;
  return best;
};
export function d11Of(result: ScoringResult): number {
  let d = 0;
  for (const s of result.dBySignal) if (s.W === PRIMARY.W && isV1Signal(s.signal) && s.D > d) d = s.D;
  return d;
}
export function nullEntry(run: NullRun, result: ScoringResult): NullEntry {
  const D13 = result.D[0]; // one W in the scorer's options
  const D11 = d11Of(result);
  const ring13 = D13 >= PRIMARY.Z, ring11 = D11 >= PRIMARY.Z;
  return {
    id: run.id,
    set: run.set,
    preset: run.preset,
    seed: run.seed,
    D13,
    D11,
    ring13,
    ring11,
    firstRing13: ring13 ? firstOf(result.receipts, () => true) : null,
    firstRing11: ring11 ? firstOf(result.receipts, isV1Signal) : null,
  };
}

export type NullReading = "quiet on fresh drift (exploratory)" | "still rings on drift" | "not called";
/**
 * Whether a reported (not deciding) item had its whole corpus: `called` false with the reason when a run it reads is missing or failed.
 * The figures are still given over what was scored; they only decide nothing, and neither does their absence (A1 has its own corpus).
 */
export interface ReportedStatus {
  called: boolean;
  reason?: string;
}
export interface NullSummary {
  complete: boolean;
  A1: { status: "met" | "missed" | "not-called"; reason?: string; k: number; n: number; upper95: number | null; maxRings: number; reading: NullReading };
  reported: {
    /** The v1 rule (eleven signals) on v0's 70 at the horizon, each leave-one-out: gradient-m3 against its 40, spots-m3 against its 30. A post-hoc look at seen data. */
    v1OnV0: ReportedStatus & { gradient: Count; spots: Count; total: Count & { upper95: number | null } };
    /** v0's thirteen-signal rule on the fresh runs. */
    v0RuleOnFresh: ReportedStatus & Count & { upper95: number | null };
    /** The treatment runs under the v1 rule against the 40: rings, the same under the 13-signal rule, and P(D11 treatment > D11 neutral) with ties half. */
    treatment: ReportedStatus & { rings11: Count; rings13: Count; effect11: number | null };
    /** Z* = the largest 13-signal D among the 40 envelope runs (leave-one-out), applied to the fresh runs by D13 > Z* (strict). Descriptive. */
    calibrated: ReportedStatus & { zStar: number | null; fresh: Count; treatment: Count };
  };
  freshFailed: { id: string; reason: string }[];
}

/** Whether A1 is called. */
export const nullCalled = (s: NullSummary): boolean => s.A1.status !== "not-called";

const ub = (k: number, n: number): number | null => (n > 0 ? binomialUpperBound(k, n) : null);
const count = (es: readonly NullEntry[], f: (e: NullEntry) => boolean): Count => ({ k: es.filter(f).length, of: es.length });

export function summarizeNull(entries: readonly NullEntry[], opts: { complete: boolean; freshFailed?: { id: string; reason: string }[] }): NullSummary {
  const by = (set: NullSet) => entries.filter((e) => e.set === set);
  const grad = by("v0-gradient"), spots = by("v0-spots"), treat = by("treatment"), fresh = by("fresh");
  const freshFailed = opts.freshFailed ?? [];

  const k = fresh.filter((e) => e.ring11).length, n = fresh.length;
  // A1 is gated on its own corpus only: the 70 fresh runs and the 40 envelope runs. The spots and treatment runs feed the reported
  // items, which carry their own status; a missing one of them withholds that item, never A1 (`complete` is only a record flag).
  const freshOk = n === EXPECTED_FRESH && freshFailed.length === 0, gradOk = grad.length === EXPECTED_ENVELOPE;
  const spotsOk = spots.length === EXPECTED_SPOTS, treatOk = treat.length === EXPECTED_TREATMENT_A;
  const callable = freshOk && gradOk;
  let status: NullSummary["A1"]["status"];
  let reason: string | undefined;
  if (!callable) {
    status = "not-called";
    reason = `${n} fresh runs count (${freshFailed.length} failed), ${grad.length} envelope runs scored; A1 needs ${EXPECTED_FRESH} fresh and ${EXPECTED_ENVELOPE} envelope runs`;
  } else {
    status = k <= A1_MAX_RINGS ? "met" : "missed";
  }
  const reading: NullReading = status === "met" ? "quiet on fresh drift (exploratory)" : status === "missed" ? "still rings on drift" : "not called";

  const v1g = count(grad, (e) => e.ring11), v1s = count(spots, (e) => e.ring11);
  const tot = { k: v1g.k + v1s.k, of: v1g.of + v1s.of };
  const zStar = grad.length ? Math.max(...grad.map((e) => e.D13)) : null;
  const above = (es: readonly NullEntry[]): Count => ({ k: zStar === null ? 0 : es.filter((e) => e.D13 > zStar).length, of: es.length });
  const effect11 = treat.length && grad.length ? mannWhitney(treat.map((e) => e.D11), grad.map((e) => e.D11), "normal").effect : null;
  /** The status of a reported item from the parts of its corpus it needs, each [ok, have, expected, name]. */
  const st = (...parts: [boolean, number, number, string][]): ReportedStatus => {
    const short = parts.filter(([ok]) => !ok);
    return short.length ? { called: false, reason: short.map(([, have, want, name]) => `${have} of ${want} ${name}`).join(", ") + "; reported over what was scored, not called" } : { called: true };
  };
  const envPart: [boolean, number, number, string] = [gradOk, grad.length, EXPECTED_ENVELOPE, "envelope runs"];
  const freshPart: [boolean, number, number, string] = [freshOk, n, EXPECTED_FRESH, `fresh runs (${freshFailed.length} failed)`];
  const treatPart: [boolean, number, number, string] = [treatOk, treat.length, EXPECTED_TREATMENT_A, "treatment runs"];

  return {
    complete: opts.complete,
    A1: { status, ...(reason ? { reason } : {}), k, n, upper95: ub(k, n), maxRings: A1_MAX_RINGS, reading },
    reported: {
      v1OnV0: { ...st(envPart, [spotsOk, spots.length, EXPECTED_SPOTS, "spots runs"]), gradient: v1g, spots: v1s, total: { ...tot, upper95: ub(tot.k, tot.of) } },
      v0RuleOnFresh: { ...st(freshPart), ...count(fresh, (e) => e.ring13), upper95: ub(fresh.filter((e) => e.ring13).length, n) },
      treatment: { ...st(treatPart, envPart), rings11: count(treat, (e) => e.ring11), rings13: count(treat, (e) => e.ring13), effect11 },
      calibrated: { ...st(envPart, freshPart, treatPart), zStar, fresh: above(fresh), treatment: above(treat) },
    },
    freshFailed: [...freshFailed],
  };
}

// ---------------------------------------------------------------------------------------------
// Records: what may be overwritten.

/**
 * Whether a record may be written at the target. Refuses a record with no scored runs, and refuses to replace an existing record that
 * is complete and holds a called readout (unless forced): a called readout is replaced only on purpose. A record that is complete but
 * called nothing (a readout taken while runs were still in flight) is not protected, and a record with no `called` field is treated
 * as called when complete. Returns the reason to refuse, or null.
 */
export function recordRefusal1(existingText: string | null, next: { scored: number; force?: boolean }): string | null {
  if (next.scored === 0) return "no run was scored, so there is nothing to record";
  if (next.force || existingText === null) return null;
  let old: unknown;
  try {
    old = JSON.parse(existingText);
  } catch {
    return null; // an unreadable file holds no called readout to protect
  }
  if (old !== null && typeof old === "object") {
    const o = old as { complete?: unknown; called?: unknown };
    if (o.complete === true && o.called !== false) return "the file already holds a complete record (pass --force to replace it, or choose another --record)";
  }
  return null;
}
/** The default record path: the official one when the record is complete or called something, else the ".incomplete" one. */
export function defaultRecord(part: "null" | "twins", official: boolean): string {
  return `experiments/naturalist/bell-v1-${part}${official ? "" : ".incomplete"}.json`;
}

// ---------------------------------------------------------------------------------------------
// Part B: equality helpers.

/** Structural equality of parsed JSON values (key order does not matter; numbers by ===). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bb[i])) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}
type Rows = readonly (readonly [string, number])[];
/** Lineage rows equal, in file order. */
export function rowsEqual(a: Rows, b: Rows): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Part B: nudge centres and interventions.

/** experiments/naturalist/bell-v1-nudges.json (written by tools/bell-v1-launch.ts: `centres` with seed, arm, x, y) to the centres planJobs takes. Every seed 1..10 and both nudge arms are required. */
export function parseNudgeFile(text: string, seeds: readonly [number, number] = [1, 10]): NudgeCentres {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch (e) {
    throw new Error(`nudges file is not JSON (${(e as Error).message})`);
  }
  const cs = (o as { centres?: unknown } | null)?.centres;
  if (!Array.isArray(cs)) throw new Error("nudges file has no centres array");
  const out: Record<number, Record<string, { x: number; y: number }>> = {};
  for (const c of cs as { seed?: unknown; arm?: unknown; x?: unknown; y?: unknown }[]) {
    if (typeof c?.seed !== "number" || (c.arm !== "nudge" && c.arm !== "nudge2") || !Number.isInteger(c.x) || !Number.isInteger(c.y)) throw new Error(`nudges file: bad centre ${JSON.stringify(c)}`);
    out[c.seed] ??= {};
    if (out[c.seed][c.arm]) throw new Error(`nudges file: duplicate centre for seed ${c.seed} ${c.arm}`);
    out[c.seed][c.arm] = { x: c.x as number, y: c.y as number };
  }
  for (let seed = seeds[0]; seed <= seeds[1]; seed++) for (const arm of Object.keys(NUDGE_TARGETS)) if (!out[seed]?.[arm]) throw new Error(`nudges file: no ${arm} centre for seed ${seed}`);
  return out as NudgeCentres;
}

/** interventions.jsonl text to its parsed lines (blank lines skipped); a missing file is the empty text. */
export function parseInterventions(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  text.split("\n").forEach((l, i) => {
    if (!l.trim()) return;
    let o: unknown;
    try {
      o = JSON.parse(l);
    } catch (e) {
      throw new Error(`interventions.jsonl line ${i + 1} is not JSON (${(e as Error).message})`);
    }
    if (o === null || typeof o !== "object" || Array.isArray(o)) throw new Error(`interventions.jsonl line ${i + 1} is not a JSON object`);
    out.push(o as Record<string, unknown>);
  });
  return out;
}
/** Null when interventions.jsonl holds exactly the job's scheduled entry, else the reason. */
export function interventionProblem(job: Job, text: string | null): string | null {
  let applied: Record<string, unknown>[];
  try {
    applied = parseInterventions(text ?? "");
  } catch (e) {
    return (e as Error).message;
  }
  if (interventionsMatch(job, applied)) return null;
  return `interventions.jsonl holds ${applied.length} entr${applied.length === 1 ? "y" : "ies"}, not exactly the scheduled ${job.expected ? `${job.expected.kind} ${job.expected.x},${job.expected.y},${job.expected.r}${job.expected.amount !== undefined ? `,${job.expected.amount}` : ""} at ${job.expected.step}` : "nothing"}`;
}

// ---------------------------------------------------------------------------------------------
// Part B: the twin plan.

export interface TwinSpec {
  /** Job id (twin-<arm>-<seed>), the launch log's key. */
  id: string;
  arm: Arm;
  seed: number;
  /** Index into the plan's bases of the twin's base. */
  base: number;
  /** The twin's bundle directory. */
  dir: string;
  /** What its manifest must say, and the one entry its interventions.jsonl must hold. */
  spec: { experiment: string; presetId: string; condition: string; seed: number };
  job: Job;
}
export interface BaseSpec {
  id: string;
  dir: string;
  /** A test hook for smoke plans: a bundle that only contributes to the spread, so the check that a base holds no interventions is skipped. */
  spreadOnly?: boolean;
  spec: { experiment: string; presetId: string; condition: string; seed: number };
}
export interface TwinsPlan {
  /** The step of the intervention. */
  S: number;
  /** Steps of a twin's run (exactly), and of the horizon read from the bases and the twins. */
  steps: number;
  bases: BaseSpec[];
  twins: TwinSpec[];
}
/** The real plan: bases replay-m4 gradient-m3 treatment seeds 1..10 under baseRoot, 50 twins under runsRoot. */
export function defaultTwinsPlan(runsRoot: string, baseRoot: string, nudges: NudgeCentres): TwinsPlan {
  const jobs = planJobs(nudges).filter((j) => j.part === "B");
  const seeds = [...new Set(jobs.map((j) => j.seed))].sort((a, b) => a - b);
  const bases: BaseSpec[] = seeds.map((seed) => ({
    id: `replay-m4/gradient-m3/treatment/seed-${seed}`,
    dir: `${baseRoot}/replay-m4/gradient-m3/treatment/seed-${seed}`,
    spec: { experiment: "replay-m4", presetId: "gradient-m3", condition: "treatment", seed },
  }));
  const twins: TwinSpec[] = jobs.map((job) => ({
    id: job.id,
    arm: job.arm as Arm,
    seed: job.seed,
    base: seeds.indexOf(job.seed),
    dir: `${runsRoot}/${job.rel}`,
    spec: { experiment: job.experiment, presetId: "gradient-m3", condition: job.condition, seed: job.seed },
    job,
  }));
  return { S: S_DEFAULT, steps: STEPS, bases, twins };
}
const asRun = (s: { experiment: string; presetId: string; condition: string; seed: number }, id: string): CorpusRun => ({
  id,
  experiment: s.experiment,
  preset: s.presetId,
  condition: s.condition as CorpusRun["condition"],
  seed: s.seed,
  rel: id,
});
/** A base's manifest: the spec it must state, a summary, cadence 100, at least `steps` steps. Throws naming the base. */
export function checkBaseManifest(b: BaseSpec, text: string, steps: number): BellManifest {
  const m = parseManifest(asRun(b.spec, b.id), text);
  if (m.spec.censusEvery !== CADENCE) throw new Error(`${b.id}: censusEvery ${m.spec.censusEvery}, expected ${CADENCE}`);
  if (!(typeof m.spec.steps === "number" && m.spec.steps >= steps)) throw new Error(`${b.id}: ${m.spec.steps} steps, the horizon needs at least ${steps}`);
  return m;
}
/** A twin's manifest problem, or null: its spec, a summary, cadence 100, exactly `steps` steps, and its base's preset identity. */
export function twinManifestProblem(t: TwinSpec, text: string, steps: number, basePresetIdentity: string): string | null {
  try {
    const m = checkExactManifest(asRun(t.spec, t.id), text, steps);
    if (m.presetIdentity !== basePresetIdentity) return `${t.id}: presetIdentity ${m.presetIdentity} differs from its base's ${basePresetIdentity}`;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// ---------------------------------------------------------------------------------------------
// Part B: the pair scorer.

export interface Census {
  rec: Record<string, unknown> & { step: number };
  rows: Rows;
}
/** One twin's input at a census: the census, or a failure (a stream that ended, threw, or is already void for another reason). */
export type TwinInput = Census | { fail: string };
export interface PairSpec {
  id: string;
  arm: string;
  seed: number;
  /** Index into the bases passed to push. */
  base: number;
}
export interface PairResult {
  id: string;
  arm: string;
  seed: number;
  /** Why the stream could not be scored (ended early, threw, wrong step); null when it ran to the last census pushed. */
  failed: string | null;
  censuses: number;
  /** First census step at or before S where the twin's series record or lineage rows differ from its base's (they must not). */
  diffAtOrBeforeS: number | null;
  /** First census step after S where they differ (a twin must differ somewhere after S). */
  firstDiffStep: number | null;
  /** First census step where any of the 13 signal values differs from the base's. */
  firstSignalDiffStep: number | null;
  /** D_pair: the largest window minimum over counted windows, both sides and all 13 signals, floored at 0. */
  D: number;
  /** The signal and side that gave D (null when D is 0). */
  signal: string | null;
  side: "high" | "low" | null;
  dBySignal: { signal: string; side: "high" | "low"; D: number }[];
  /** Per counted window (first census S+100, S+200, ..., S+5000): the largest, over signals and sides, of the window's smallest side*z. Can be negative. */
  windowMax: number[];
  /** The dose at S + 100: living cells and matter (A+B+C+P of the pools), twin and base, and twin - base. */
  dose: Dose;
}
export interface DosePair {
  twin: number | null;
  base: number | null;
  /** twin - base; null when either is. */
  delta: number | null;
}
export interface Dose {
  step: number;
  livingCells: DosePair;
  /** MATTER_CHANNELS summed over the series record's pools. */
  matter: DosePair;
}
const dosePair = (twin: number | null, base: number | null): DosePair => ({ twin, base, delta: twin !== null && base !== null ? twin - base : null });

const NS = SIGNALS.length;
const SIDE = [1, -1] as const;
const SIDE_NAME = ["high", "low"] as const;

class TwinState {
  ext = new SignalExtractor();
  mins: RollingMin[] = Array.from({ length: NS * 2 }, () => new RollingMin(W_PAIR));
  windowMin: Float64Array;
  fail: string | null = null;
  n = 0;
  diffBefore: number | null = null;
  firstDiff: number | null = null;
  firstSigDiff: number | null = null;
  doseTwin: number | null = null;
  doseBase: number | null = null;
  matterTwin: number | null = null;
  matterBase: number | null = null;
  constructor(readonly spec: PairSpec, nWindows: number) {
    this.windowMin = new Float64Array(NS * 2 * nWindows).fill(-Infinity);
  }
}

/**
 * Pair scoring of twins against their bases. `push` takes one census per base (all at the next cadence step) and one input per
 * twin. Bases are extracted once per census; the spread of signal s at the census is v0's spread over the bases' values of s.
 * A twin that fails stays failed (later inputs are ignored); a base that is off cadence throws. Holds O(twins x signals x W) state.
 */
export class PairScorer {
  private bases: SignalExtractor[];
  private twins: TwinState[];
  private nWindows: number;
  private n = 0;
  private baseVals: (number | null)[][] = [];
  constructor(readonly S: number, nBases: number, specs: readonly PairSpec[], readonly cadence = CADENCE) {
    if (!(Number.isInteger(S) && S > 0 && S % cadence === 0)) throw new Error(`S ${S} is not a positive multiple of the cadence ${cadence}`);
    if (EARLY_FROM % cadence !== 0 || EARLY_TO % cadence !== 0) throw new Error(`cadence ${cadence} does not divide the early range ${EARLY_FROM}..${EARLY_TO}`);
    this.nWindows = (EARLY_TO - EARLY_FROM) / cadence + 1;
    this.bases = Array.from({ length: nBases }, () => new SignalExtractor());
    for (const s of specs) if (!(s.base >= 0 && s.base < nBases)) throw new Error(`${s.id}: base ${s.base} is not one of ${nBases} bases`);
    this.twins = specs.map((s) => new TwinState(s, this.nWindows));
  }
  get censuses(): number {
    return this.n;
  }
  /** Marks a twin failed from the outside (for example, a stream that has more censuses than it should). */
  fail(i: number, reason: string): void {
    const t = this.twins[i];
    if (!t.fail) t.fail = reason;
  }
  push(bases: readonly Census[], twins: readonly TwinInput[]): void {
    if (bases.length !== this.bases.length) throw new Error(`lockstep: ${bases.length} base censuses for ${this.bases.length} bases`);
    if (twins.length !== this.twins.length) throw new Error(`lockstep: ${twins.length} twin inputs for ${this.twins.length} twins`);
    const step = (this.n + 1) * this.cadence;
    bases.forEach((b, i) => {
      if (b.rec.step !== step) throw new Error(`lockstep: base ${i} is at step ${b.rec.step} where cadence ${this.cadence} expects ${step}`);
    });
    this.baseVals = bases.map((b, i) => this.bases[i].push(b.rec, b.rows));
    // Spread per signal over the bases at this census (a rate is undefined for all bases or none).
    const spread: (number | null)[] = SIGNALS.map((d, s) => {
      if (this.baseVals.some((v) => v[s] === null)) return null;
      const sorted = Float64Array.from(this.baseVals.map((v) => v[s] as number)).sort();
      return departure(0, sorted, Infinity, d.floor).spread;
    });
    const idx = this.n;
    const f = step - (W_PAIR - 1) * this.cadence; // first census of the window ending here
    const counted = idx >= W_PAIR - 1 && f >= this.S + EARLY_FROM && f <= this.S + EARLY_TO;
    const wi = counted ? (f - (this.S + EARLY_FROM)) / this.cadence : -1;
    for (let j = 0; j < this.twins.length; j++) {
      const t = this.twins[j];
      if (t.fail) continue;
      const inp = twins[j];
      if ("fail" in inp) {
        t.fail = inp.fail;
        continue;
      }
      if (inp.rec.step !== step) {
        t.fail = `census at step ${inp.rec.step} where cadence ${this.cadence} expects ${step}`;
        continue;
      }
      const b = bases[t.spec.base];
      const vals = t.ext.push(inp.rec, inp.rows);
      const bv = this.baseVals[t.spec.base];
      // Equality with the base: the series record and the lineage census, whole.
      const same = deepEqual(inp.rec, b.rec) && rowsEqual(inp.rows, b.rows);
      if (!same) {
        if (step <= this.S) t.diffBefore ??= step;
        else t.firstDiff ??= step;
      }
      for (let s = 0; s < NS; s++) {
        if (t.firstSigDiff === null && (vals[s] ?? null) !== (bv[s] ?? null)) t.firstSigDiff = step;
        const sp = spread[s];
        const z = vals[s] === null || bv[s] === null || sp === null ? 0 : ((vals[s] as number) - (bv[s] as number)) / sp;
        for (let si = 0; si < 2; si++) {
          const rm = t.mins[s * 2 + si];
          rm.push(idx, SIDE[si] * z);
          if (counted) t.windowMin[(s * 2 + si) * this.nWindows + wi] = rm.min();
        }
      }
      if (step === this.S + this.cadence) {
        t.doseTwin = typeof inp.rec.livingCells === "number" ? inp.rec.livingCells : null;
        t.doseBase = typeof b.rec.livingCells === "number" ? b.rec.livingCells : null;
        t.matterTwin = matterOf(inp.rec);
        t.matterBase = matterOf(b.rec);
      }
      t.n++;
    }
    this.n++;
  }
  results(): PairResult[] {
    return this.twins.map((t) => {
      const dBySignal: PairResult["dBySignal"] = [];
      const windowMax: number[] = new Array(this.nWindows).fill(-Infinity);
      let D = 0, signal: string | null = null, side: "high" | "low" | null = null;
      for (let s = 0; s < NS; s++) {
        for (let si = 0; si < 2; si++) {
          let d = 0;
          for (let w = 0; w < this.nWindows; w++) {
            const m = t.windowMin[(s * 2 + si) * this.nWindows + w];
            if (m > windowMax[w]) windowMax[w] = m;
            if (m > d) d = m;
          }
          dBySignal.push({ signal: SIGNALS[s].name, side: SIDE_NAME[si], D: d });
          if (d > D) {
            D = d;
            signal = SIGNALS[s].name;
            side = SIDE_NAME[si];
          }
        }
      }
      return {
        id: t.spec.id,
        arm: t.spec.arm,
        seed: t.spec.seed,
        failed: t.fail,
        censuses: t.n,
        diffAtOrBeforeS: t.diffBefore,
        firstDiffStep: t.firstDiff,
        firstSignalDiffStep: t.firstSigDiff,
        D,
        signal,
        side,
        dBySignal,
        windowMax: windowMax.map((m) => (m === -Infinity ? 0 : m)),
        dose: { step: this.S + this.cadence, livingCells: dosePair(t.doseTwin, t.doseBase), matter: dosePair(t.matterTwin, t.matterBase) },
      };
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Part B: validity and the readout.

export interface TwinOutcome extends PairResult {
  valid: boolean;
  voidReasons: string[];
  /** The `matter` field of the twin's interventions.jsonl entry (what the feed or lesion logged), null when absent. Kept apart from the dose's matter, which is measured at S + 100 against the base. */
  interventionMatter: number | null;
}
/**
 * The reasons a twin is void (empty: valid). `pre` holds the checks made before streaming (manifest, launch log, interventions,
 * a missing directory); the rest come from the pair result: a failed stream (which covers the census count), a difference from the
 * base at or before S, and no difference after S.
 */
export function voidReasons(r: PairResult, S: number, pre: { missing?: boolean; manifest?: string | null; launch?: string | null; interventions?: string | null }): string[] {
  const out: string[] = [];
  if (pre.missing) out.push("bundle missing");
  if (pre.manifest) out.push(pre.manifest);
  if (pre.launch) out.push(pre.launch);
  if (pre.interventions) out.push(pre.interventions);
  if (r.failed) {
    out.push(`stream: ${r.failed}`);
    return out;
  }
  if (r.diffAtOrBeforeS !== null) out.push(`differs from its base at step ${r.diffAtOrBeforeS}, at or before S = ${S}`);
  if (r.firstDiffStep === null) out.push(`no difference from its base after S = ${S}`);
  return out;
}
export const judgeTwin = (r: PairResult, S: number, pre: Parameters<typeof voidReasons>[2], interventionMatter: number | null): TwinOutcome => {
  const reasons = voidReasons(r, S, pre);
  return { ...r, valid: reasons.length === 0, voidReasons: reasons, interventionMatter };
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface TwinReport {
  id: string;
  arm: string;
  seed: number;
  valid: boolean;
  voidReasons: string[];
  D: number | null;
  signal: string | null;
  side: "high" | "low" | null;
  /** D > Z*_pair (strict); null when Z*_pair is not called (fewer than 10 valid nudges) or the twin is void. */
  hit: boolean | null;
  /** First census step of the first counted window above Z*_pair (for a hit); null when Z*_pair is not called. */
  firstWindowAboveZ: number | null;
  firstDiffStep: number | null;
  firstSignalDiffStep: number | null;
  dose: Dose & { interventionMatter: number | null };
  /** The signals and sides with D > 0, by size. */
  dBySignal: { signal: string; side: string; D: number }[];
}
export interface ArmReport {
  arm: Arm;
  /** Valid twins, of PER_ARM. */
  valid: number;
  /** Seeds of the void ones. */
  voidSeeds: number[];
  /** Valid twins with D > Z*_pair; null when Z*_pair is not called (no count is made against a subset maximum). */
  hits: Count | null;
  /** P(D_arm > D_nudge), ties half, over the valid twins of both; null when either has none. */
  effectVsNudge: { effect: number | null; nArm: number; nNudge: number };
  medianD: number | null;
}
export type TwinReading = "hears events (exploratory)" | "hears some events" | "its threshold does not hold out" | "did not meet the exploratory bar" | "not called";
export interface Criterion {
  called: boolean;
  met: boolean | null;
  /** Hits (B2) or exceedances (B3) among the valid twins; null when Z*_pair is not called. */
  k: number | null;
  n: number;
  reason?: string;
  /** B2: one-sided 95% lower bound on the hit rate; B3: upper bound on the exceedance rate. */
  bound95: number | null;
}
export interface TwinSummary {
  complete: boolean;
  /**
   * Z*_pair: the largest D among the 10 nudge twins, `value` only when all 10 are valid (`called`). With fewer, `provisional` is the
   * maximum over the valid ones, for the record only: no hit, count or first window is ever taken from it.
   */
  zStarPair: { value: number | null; provisional: number | null; /** Valid nudge twins it is the maximum over. */ n: number; called: boolean };
  nudge: { medianD: number | null; firstDiffSteps: (number | null)[] };
  arms: Record<Arm, ArmReport>;
  B2: { l96: Criterion; f: Criterion };
  /** L64's B2, reported beside the criteria. */
  B2_l64: Criterion;
  B3: Criterion;
  reading: TwinReading;
  /** For "hears some events": the arm that met B2. */
  armsMet: string[];
  twins: TwinReport[];
}

/** Whether any criterion of the twin readout is called (B2 for L96 or F, L64's B2, or B3). */
export const twinsCalled = (s: TwinSummary): boolean => s.B2.l96.called || s.B2.f.called || s.B2_l64.called || s.B3.called;

export function summarizeTwins(outcomes: readonly TwinOutcome[], opts: { S: number; cadence?: number; complete: boolean }): TwinSummary {
  const cadence = opts.cadence ?? CADENCE;
  const valid = (arm: Arm) => outcomes.filter((o) => o.arm === arm && o.valid);
  const nudges = valid("nudge");
  const nudgeCalled = nudges.length === PER_ARM; // validity alone decides: a missing bundle is a void twin, and `complete` is only a record flag
  const subsetMax = nudges.length ? Math.max(...nudges.map((o) => o.D)) : null;
  // Every threshold-dependent field (hit, first window above, counts) needs Z*_pair called; a subset maximum is provisional only.
  const zStar = nudgeCalled ? subsetMax : null;

  const reports: TwinReport[] = outcomes.map((o) => {
    const hit = o.valid && zStar !== null ? o.D > zStar : null;
    let firstWindowAboveZ: number | null = null;
    if (hit && zStar !== null) {
      const wi = o.windowMax.findIndex((m) => m > zStar);
      if (wi >= 0) firstWindowAboveZ = opts.S + EARLY_FROM + wi * cadence;
    }
    return {
      id: o.id,
      arm: o.arm,
      seed: o.seed,
      valid: o.valid,
      voidReasons: o.voidReasons,
      D: o.failed ? null : o.D,
      signal: o.signal,
      side: o.side,
      hit,
      firstWindowAboveZ,
      firstDiffStep: o.firstDiffStep,
      firstSignalDiffStep: o.firstSignalDiffStep,
      dose: { ...o.dose, interventionMatter: o.interventionMatter },
      dBySignal: o.dBySignal.filter((d) => d.D > 0).sort((a, b) => b.D - a.D),
    };
  });

  const armReport = (arm: Arm): ArmReport => {
    const v = valid(arm);
    const all = outcomes.filter((o) => o.arm === arm);
    return {
      arm,
      valid: v.length,
      voidSeeds: all.filter((o) => !o.valid).map((o) => o.seed).sort((a, b) => a - b),
      hits: zStar === null ? null : { k: v.filter((o) => o.D > zStar).length, of: v.length },
      effectVsNudge: { effect: v.length && nudges.length ? mannWhitney(v.map((o) => o.D), nudges.map((o) => o.D), "normal").effect : null, nArm: v.length, nNudge: nudges.length },
      medianD: median(v.map((o) => o.D)),
    };
  };
  const arms = Object.fromEntries(ARMS.map((a) => [a, armReport(a)])) as Record<Arm, ArmReport>;

  const b2 = (arm: Arm): Criterion => {
    const r = arms[arm];
    const called = nudgeCalled && r.valid === PER_ARM;
    return {
      called,
      met: called ? r.hits!.k >= B2_MIN_HITS : null,
      k: r.hits?.k ?? null,
      n: PER_ARM,
      ...(called ? {} : { reason: `${r.valid} of ${PER_ARM} ${arm} twins and ${nudges.length} of ${PER_ARM} nudge twins are valid; a call needs all of them` }),
      bound95: called ? binomialLowerBound(r.hits!.k, PER_ARM) : null,
    };
  };
  const b3Called = nudgeCalled && arms.nudge2.valid === PER_ARM;
  const B3: Criterion = {
    called: b3Called,
    met: b3Called ? arms.nudge2.hits!.k <= B3_MAX_HITS : null,
    k: arms.nudge2.hits?.k ?? null,
    n: PER_ARM,
    ...(b3Called ? {} : { reason: `${arms.nudge2.valid} of ${PER_ARM} nudge2 twins and ${nudges.length} of ${PER_ARM} nudge twins are valid; B3 needs all of them` }),
    bound95: b3Called ? binomialUpperBound(arms.nudge2.hits!.k, PER_ARM) : null,
  };
  const B2 = { l96: b2("l96"), f: b2("f") };

  const armsMet = (["l96", "f"] as const).filter((a) => B2[a].met === true).map((a) => (a === "l96" ? "L96" : "F"));
  let reading: TwinReading;
  if (!B3.called) reading = "not called";
  else if (B3.met === false) reading = "its threshold does not hold out";
  else if (!B2.l96.called || !B2.f.called) reading = "not called";
  else if (armsMet.length === 2) reading = "hears events (exploratory)";
  else if (armsMet.length === 1) reading = "hears some events";
  else reading = "did not meet the exploratory bar";

  return {
    complete: opts.complete,
    zStarPair: { value: zStar, provisional: nudgeCalled ? null : subsetMax, n: nudges.length, called: nudgeCalled },
    nudge: { medianD: arms.nudge.medianD, firstDiffSteps: outcomes.filter((o) => o.arm === "nudge").sort((a, b) => a.seed - b.seed).map((o) => o.firstDiffStep) },
    arms,
    B2,
    B2_l64: b2("l64"),
    B3,
    reading,
    armsMet,
    twins: reports,
  };
}
