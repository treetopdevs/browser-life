// Pre-stated decision rules (PLAN section 6), pure integer arithmetic. A schedule's contrast family comes from the capture ppm of the five
// strategies in grouped and dispersed placement across the blocks. Nothing here reads a fresh outcome to choose a rule.
import { lowbias32 } from "@bl/schema";
import { PROTOCOL, type Protocol } from "./protocol.ts";

export interface ArmNumbers {
  capturePpm: number;
  survivalPpm: number;
  /** Residual-coordination statistic (milli-Q^2) or null when unavailable. */
  cov: number | null;
}
/** One block's numbers for one schedule: strategy -> placement -> numbers. Missing strategies make the block incomplete. */
export type BlockNumbers = Partial<Record<string, { grouped: ArmNumbers; dispersed: ArmNumbers }>>;

export interface Floors {
  cap: number;
  res: number;
}

export const medianTimes2 = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? 2 * s[m] : s[m - 1] + s[m];
};

/** Exact one-sided sign-test tail P(X >= k), X ~ Binomial(n, 1/2), as an integer numerator over 2^n. */
export function signTail(k: number, n: number): { num: number; den: number } {
  let num = 0;
  let c = 1;
  for (let j = 0; j <= n; j++) {
    if (j >= k) num += c;
    c = (c * (n - j)) / (j + 1);
  }
  return { num, den: 2 ** n };
}
export const signP = (k: number, n: number): string => {
  const { num, den } = signTail(k, n);
  return `${num}/${den}`;
};

/** Deterministic bootstrap of the median (as twice-median): resamples whole blocks with lowbias32, returns the level quantile. */
export function bootstrapLowerBound2(xs: readonly number[], draws: number, seed: number, levelPpm: number): number | null {
  if (!xs.length) return null;
  const meds: number[] = [];
  let state = lowbias32(seed);
  for (let d = 0; d < draws; d++) {
    const pick: number[] = [];
    for (let i = 0; i < xs.length; i++) {
      state = lowbias32((state + 0x9e3779b9) >>> 0);
      pick.push(xs[state % xs.length]);
    }
    meds.push(medianTimes2(pick)!);
  }
  meds.sort((a, b) => a - b);
  return meds[Math.floor((meds.length * levelPpm) / 1_000_000)];
}

export interface Contrasts {
  S: number;
  N: number;
  V: number;
  B: number;
  Bdrift: number;
  /** Residual coordination (grouped minus dispersed) of sense and of the no-active-motility arms; null when unavailable. */
  resSense: number | null;
  resStill: number | null;
  resNomot: number | null;
  survDiff: number;
}

const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
export function contrastsOf(b: BlockNumbers): Contrasts | null {
  const s = b["sense"], n = b["sense-nosig"], d = b["drift"], st = b["still"], nm = b["sense-nomot"];
  if (!s || !n || !d || !st || !nm) return null;
  const S = s.grouped.capturePpm - s.dispersed.capturePpm;
  const N = n.grouped.capturePpm - n.dispersed.capturePpm;
  const V = d.grouped.capturePpm - d.dispersed.capturePpm;
  return {
    S,
    N,
    V,
    B: S - N,
    Bdrift: S - V,
    resSense: diff(s.grouped.cov, s.dispersed.cov),
    resStill: diff(st.grouped.cov, st.dispersed.cov),
    resNomot: diff(nm.grouped.cov, nm.dispersed.cov),
    survDiff: s.grouped.survivalPpm - s.dispersed.survivalPpm,
  };
}

export interface Criterion {
  id: string;
  pass: boolean;
  detail: string;
}
export interface Summary {
  positives: number;
  of: number;
  p: string;
  median2: number | null;
  lower2: number | null;
}
export interface ScheduleDecision {
  blocks: number;
  complete: number;
  contrasts: (Contrasts | null)[];
  S: Summary;
  B: Summary;
  Bdrift: Summary;
  criteria: Criterion[];
  /** (i)-(iii) hold (the persistence test used for transfer schedules). */
  core: boolean;
  /** Estimates are not positive: median S or median B at or below zero. */
  nonPositive: boolean;
  /** Comparators disagree: one of B and B_drift has a median clearly above the floor while the other is at or below zero. */
  comparatorsDisagree: boolean;
}

function summary(xs: number[], p: Protocol): Summary {
  const k = xs.filter((x) => x > 0).length;
  return { positives: k, of: xs.length, p: signP(k, xs.length), median2: medianTimes2(xs), lower2: bootstrapLowerBound2(xs, p.rule.bootstrapDraws, p.rule.bootstrapSeed, p.rule.bootstrapLevelPpm) };
}

/** Decide one schedule from its block numbers. `full` also checks (iv)-(vi); transfer schedules use the core (i)-(iii) only. */
export function decideSchedule(blocks: readonly BlockNumbers[], floors: Floors, full: boolean, p: Protocol = PROTOCOL): ScheduleDecision {
  // The frozen block count is the denominator: fewer supplied blocks count as missing, never as a smaller panel.
  const total = Math.max(blocks.length, p.rule.blocks);
  const cs = [...blocks.map(contrastsOf), ...Array.from({ length: total - blocks.length }, () => null)];
  const ok = cs.filter((c): c is Contrasts => c !== null);
  const need = p.rule.minPositive;
  const S = summary(ok.map((c) => c.S), p), B = summary(ok.map((c) => c.B), p), Bd = summary(ok.map((c) => c.Bdrift), p);
  const criteria: Criterion[] = [];
  const add = (id: string, pass: boolean, detail: string) => criteria.push({ id, pass, detail });
  // Missing blocks make the rule fail, never drop: positives are counted against the full block count.
  add("i", S.positives >= need && B.positives >= need && ok.length === total, `S positive ${S.positives}/${total} (p ${S.p}), B positive ${B.positives}/${total} (p ${B.p}), need ${need}`);
  add("ii", S.median2 !== null && B.median2 !== null && S.median2 > 2 * floors.cap && B.median2 > 2 * floors.cap, `2*median S ${S.median2}, 2*median B ${B.median2}, 2*floor ${2 * floors.cap}`);
  add("iii", B.lower2 !== null && B.lower2 > 0, `bootstrap lower bound of 2*median B ${B.lower2}`);
  if (full) {
    const avail = ok.filter((c) => c.resSense !== null);
    const resPos = ok.filter((c) => c.resSense !== null && c.resSense > floors.res).length;
    const unavailable = total - avail.length;
    const inside = (key: "resStill" | "resNomot") => ok.filter((c) => c[key] !== null && Math.abs(c[key]!) <= floors.res).length;
    add("iv", unavailable <= 2 && resPos >= p.rule.residualMin && inside("resStill") >= p.rule.residualMin && inside("resNomot") >= p.rule.residualMin, `residual above floor ${resPos}/${total} (need ${p.rule.residualMin}), unavailable ${unavailable}, still inside ${inside("resStill")}, nomot inside ${inside("resNomot")}`);
    // (v): grouped sense survival must not be below dispersed sense survival by more than the margin, in the median and in at least residualMin of the blocks.
    const sm = medianTimes2(ok.map((c) => c.survDiff));
    const survOk = ok.filter((c) => c.survDiff >= -p.survivalMarginPpm).length;
    add("v", sm !== null && sm >= -2 * p.survivalMarginPpm && survOk >= p.rule.residualMin, `2*median survival difference (grouped minus dispersed sense) ${sm}, margin ${-2 * p.survivalMarginPpm}; within the margin in ${survOk}/${total} blocks (need ${p.rule.residualMin})`);
    add("vi", Bd.median2 !== null && Bd.median2 > 2 * floors.cap, `2*median B_drift ${Bd.median2}`);
  }
  return {
    blocks: total,
    complete: ok.length,
    contrasts: cs,
    S,
    B,
    Bdrift: Bd,
    criteria,
    core: criteria.filter((c) => ["i", "ii", "iii"].includes(c.id)).every((c) => c.pass),
    // Not positive: a median at or below zero with at most half the blocks positive. A median tie at zero with a positive majority is inconclusive, not unsupported.
    nonPositive: ((S.median2 ?? 0) <= 0 && S.positives * 2 <= total) || ((B.median2 ?? 0) <= 0 && B.positives * 2 <= total),
    // One comparator shows a benefit above the floor while the other shows none.
    comparatorsDisagree: ((B.median2 ?? 0) > 2 * floors.cap && (Bd.median2 ?? 0) <= 0) || ((Bd.median2 ?? 0) > 2 * floors.cap && (B.median2 ?? 0) <= 0),
  };
}

export const LABELS = ["supported", "unsupported-within-tested-domain", "inconclusive-confounded", "inconclusive", "invalid-or-incomplete", "unsupported-measurement"] as const;
export type Label = (typeof LABELS)[number];

export interface Verdict {
  label: Label;
  reasons: string[];
  schedules: Record<string, { core: boolean; allCriteria: boolean }>;
}

export interface VerdictInput {
  fixed: ScheduleDecision;
  paused: ScheduleDecision | null;
  reversed: ScheduleDecision | null;
  wandering: ScheduleDecision | null;
  /** Floors per schedule (the paused control is judged against its own floor). */
  floors: Record<string, Floors>;
  /** Calibration found the assay insensitive (sense does not track the sun on dev, or the capture noise floor exceeds the frozen bound). */
  insensitive: boolean;
  /** Blocks with a failed audit or missing engine data. */
  invalidBlocks: number;
  blocks: number;
}

/** The overall label, following the pre-stated rules in PLAN section 6. */
export function verdictOf(v: VerdictInput): Verdict {
  const sched: Verdict["schedules"] = {};
  for (const [id, d] of [["fixed", v.fixed], ["paused", v.paused], ["reversed", v.reversed], ["wandering", v.wandering]] as const)
    if (d) sched[id] = { core: d.core, allCriteria: d.criteria.every((c) => c.pass) };
  const done = (label: Label, why: string): Verdict => ({ label, reasons: [why], schedules: sched });
  if (v.invalidBlocks > 1 || v.blocks - v.fixed.complete > 1) return done("invalid-or-incomplete", `${v.invalidBlocks} invalid blocks, ${v.blocks - v.fixed.complete} incomplete in the screen`);
  if (v.insensitive) return done("unsupported-measurement", "dev calibration: the assay is insensitive (sense does not track the sun at the matched speed, or the replicate-noise floor of the capture readout exceeds the frozen bound)");
  const f = v.fixed;
  if (!f.criteria.every((c) => c.pass)) {
    const failed = f.criteria.filter((c) => !c.pass).map((c) => c.id).join(", ");
    if (f.comparatorsDisagree) return done("inconclusive-confounded", `screen: the information-free and hard-coded comparators disagree (failed ${failed})`);
    if (f.nonPositive) return done("unsupported-within-tested-domain", `screen: median S or median B is not positive (failed ${failed})`);
    return done("inconclusive", `screen: estimates are positive but ${failed} failed`);
  }
  const pausedBenefit = v.paused === null || v.paused.B.median2 === null || Math.abs(v.paused.B.median2) > 2 * v.floors.paused.cap;
  if (pausedBenefit) return done("inconclusive-confounded", "paused (static) control shows a benefit or was not run");
  for (const id of ["reversed", "wandering"] as const) {
    const d = v[id];
    if (!d) return done("inconclusive", `transfer ${id} not run`);
    if (!d.core) return done(d.nonPositive ? "unsupported-within-tested-domain" : "inconclusive", `transfer ${id}: benefit does not persist (${d.criteria.filter((c) => !c.pass).map((c) => c.id).join(", ")} failed)`);
  }
  return done("supported", "screening and both transfer schedules pass; the paused control is within the floor");
}
