// Rule draft 3.2 (kill-rate calibration), 4 (the sweep: per-spread quantities, edge pairs, the outcome table, spread*), 5 (longer
// cycles) and 6.1 (the deep-volume precondition). Pure: readout.ts loads the jobs.

import { CENSUS_INTERVAL, CHI_CONTROL, CHI_DC, Problems, WINDOW, checkSettings, jobBugs, keepsLabels, makeAnalyzer, medianLower, medianMean, pickOne, type Job, type JobSummary, type RunAnalysis, type RunClass } from "./readout-jobs.ts";
import { controlInfo, scheduleOf, type OperatingPoint } from "./readout-gate0.ts";

export const CAL_SEEDS: readonly number[] = [201, 202];
export const SWEEP_TREAT_SEEDS: readonly number[] = [211, 212, 213, 214, 215];
export const SWEEP_CONTROL_SEEDS: readonly number[] = [211, 212, 213];
export const RATE_ARM_SEEDS: readonly number[] = [231, 232, 233];
export const CYCLE_SEEDS: Record<4 | 5, readonly number[]> = { 4: [241, 242, 243], 5: [244, 245, 246] };
export const CAL_LIV_LAST = 0.5;
export const XI_MIN = 6;

/** The key ranges of `rpsRate` for the rate arms: removal 10,922, the vacancy kill 16,384 (plan 4.1). */
export const RATE_MAX_REMOVAL = 10_922;
export const RATE_MAX_VACANCY = 16_384;

/** The operating point plus what the registered stages add to it (`kappaStar` after 3.2). */
export type RegisteredPoint = OperatingPoint;

// ---- 3.2 kill-rate calibration ----

export interface CalibrationJobRow {
  seed: number;
  cls: RunClass | "MISSING" | null;
  chiFw: number | null;
  turnoverFw: number | null;
  livLast: number | null;
}

export interface CalibrationRow {
  rate: number;
  jobs: CalibrationJobRow[];
  /** The paired rate-0 control of each seed. */
  controls: CalibrationJobRow[];
  qualifies: boolean;
  /** Why not, per seed. */
  why: string[];
}

export interface CalibrationResult {
  status: "done" | "pending";
  rows: CalibrationRow[];
  /** `kappa*`: the smallest qualifying rate; null is KAPPA-NONE. */
  kappaStar: number | null;
  verdict: "KAPPA" | "KAPPA-NONE" | null;
  missing: string[];
  listed: string[];
  problems: Problems;
  jobs: { job: Job; a: RunAnalysis | null }[];
}

const jrow = (seed: number, job: Job | undefined, a: RunAnalysis | null): CalibrationJobRow => ({
  seed,
  cls: job?.s.missing ? "MISSING" : (a?.cls ?? null),
  chiFw: a && a.cls !== "NOSTART" ? a.chiFw : null,
  turnoverFw: a?.turnoverFw ?? null,
  livLast: a?.livLast ?? null,
});

/** 3.2: a rate qualifies iff in both seeds the job is DC, `liv >= 0.50` at its last census, and the paired rate-0 job is alive with every label kept and `|chi_fw| <= 0.1`. */
export function evaluateCalibration(allJobs: readonly Job[], op: Pick<OperatingPoint, "vCal" | "rCal">): CalibrationResult {
  const pr = new Problems();
  const missing: string[] = [];
  const listed: string[] = [];
  const analyze = makeAnalyzer(pr);
  const jobs = allJobs.filter((j) => j.s.stage === "calibration");
  for (const j of jobs) checkSettings(j.s, { K0: 3, types: 3, mutRate: 0 }, pr, "the kill-rate calibration (3.2)");
  const find = (rate: number, seed: number): Job | undefined => {
    const j = pickOne(jobs, pr, `calibration rate ${rate} seed ${seed}`, (s) => s.spread === op.vCal && s.rate === rate && s.seed === seed);
    if (!j) missing.push(`calibration spread ${op.vCal} rate ${rate} seed ${seed}`);
    else if (j.s.missing) listed.push(`${j.s.id} is MISSING (failed twice)`);
    return j;
  };
  const get = (rate: number, seed: number) => {
    const j = find(rate, seed);
    const a = j && !j.s.missing ? analyze(j, WINDOW) : null;
    if (a && a.cls === "NOSTART") listed.push(`${j!.s.id} is NOSTART`);
    return { j, a };
  };
  const controls = new Map<number, { j: Job | undefined; a: RunAnalysis | null }>();
  for (const sd of CAL_SEEDS) controls.set(sd, get(0, sd));
  const rows: CalibrationRow[] = [];
  for (const rate of op.rCal) {
    const row: CalibrationRow = { rate, jobs: [], controls: [], qualifies: true, why: [] };
    for (const sd of CAL_SEEDS) {
      const { j, a } = get(rate, sd);
      const c = controls.get(sd)!;
      row.jobs.push(jrow(sd, j, a));
      row.controls.push(jrow(sd, c.j, c.a));
      if (!a || a.cls !== "DC") {
        row.qualifies = false;
        row.why.push(`seed ${sd}: class ${j?.s.missing ? "MISSING" : (a?.cls ?? "none")}, not DC`);
      } else if (!(a.livLast !== null && a.livLast >= CAL_LIV_LAST)) {
        row.qualifies = false;
        row.why.push(`seed ${sd}: liv ${a.livLast?.toFixed(3)} at the last census, below ${CAL_LIV_LAST}`);
      }
      if (!c.a || !keepsLabels(c.a) || Math.abs(c.a.chiFw) > CHI_CONTROL) {
        row.qualifies = false;
        row.why.push(`seed ${sd}: the rate-0 control is ${c.j?.s.missing ? "MISSING" : (c.a?.cls ?? "none")}${c.a && keepsLabels(c.a) ? ` with |chi_fw| ${Math.abs(c.a.chiFw).toFixed(3)} above ${CHI_CONTROL}` : ", not alive with every label kept"}`);
      }
    }
    rows.push(row);
  }
  const jobList = jobs.map((job) => ({ job, a: job.s.missing ? null : analyze(job, WINDOW) }));
  jobBugs(jobs, (j) => analyze(j, WINDOW), pr);
  if (missing.length > 0) {
    pr.add(4, `calibration jobs missing (${missing.length}): ${missing.slice(0, 5).join("; ")}${missing.length > 5 ? "; ..." : ""}`);
    return { status: "pending", rows, kappaStar: null, verdict: null, missing, listed, problems: pr, jobs: jobList };
  }
  const q = rows.filter((r) => r.qualifies).map((r) => r.rate);
  const kappaStar = q.length === 0 ? null : Math.min(...q);
  return { status: "done", rows, kappaStar, verdict: kappaStar === null ? "KAPPA-NONE" : "KAPPA", missing, listed, problems: pr, jobs: jobList };
}

// ---- 4 the sweep ----

/** The per-spread quantities of 4.2. */
export interface SweepSpread {
  spread: number;
  /** Informative controls and at least 4 finished treatment jobs and 2 finished controls. */
  informative: boolean;
  incomplete: boolean;
  nTreat: number;
  nCtrl: number;
  nDyn: number;
  nFc: number;
  nChurn: number;
  /** LOSS and LATE. */
  nLost: number;
  nExt: number;
  nSparse: number;
  /** Treatment jobs with `chi_all >= 0.2` or `chi_fw >= 0.2`, whatever their class. */
  nSig: number;
  /** Median `T_cx` of the finished treatment jobs (lower middle), CENSORED counted as `T_end + 1,000`. */
  Tmed: number | null;
  ctlKeeps: number;
  ctlMedAbsChi: number | null;
}

/** The per-spread quantities of 4.2 from the analyses of the treatment and control jobs at a spread (null analyses are jobs that could not be used and count as unfinished). */
export function spreadStats(spread: number, treat: readonly (RunAnalysis | null)[], ctrl: readonly (RunAnalysis | null)[], tEnd: number): SweepSpread {
  const fin = treat.filter((a): a is RunAnalysis => a !== null && a.cls !== "NOSTART");
  const cinfo = controlInfo(ctrl);
  const count = (...cs: RunClass[]) => fin.filter((a) => cs.includes(a.cls)).length;
  const s: SweepSpread = {
    spread,
    informative: false,
    incomplete: fin.length < 4 || cinfo.finished < 2,
    nTreat: fin.length,
    nCtrl: cinfo.finished,
    nDyn: count("DC"),
    nFc: count("FC"),
    nChurn: count("CHURN"),
    nLost: count("LOSS", "LATE"),
    nExt: count("EXT"),
    nSparse: count("SPARSE"),
    nSig: fin.filter((a) => a.chiAll >= CHI_DC || a.chiFw >= CHI_DC).length,
    Tmed: fin.length === 0 ? null : medianLower(fin.map((a) => (a.tcx === "CENSORED" || a.tcx === null ? tEnd + CENSUS_INTERVAL : a.tcx))),
    ctlKeeps: cinfo.keeps,
    ctlMedAbsChi: cinfo.medAbsChi,
  };
  if (s.nDyn + s.nFc + s.nChurn + s.nLost + s.nExt + s.nSparse !== s.nTreat) throw new Error(`spreadStats: the class counts do not add up at spread ${spread}`);
  s.informative = !s.incomplete && cinfo.informative;
  return s;
}

export type EdgeKind = "L" | "I" | "F";
export interface EdgePair {
  kind: EdgeKind;
  a: number;
  b: number;
}

/** 4.3: the edge pairs among consecutive values of `G_spread` (in the order given), both informative. */
export function edgePairs(spreads: readonly SweepSpread[], tEnd: number): EdgePair[] {
  const out: EdgePair[] = [];
  for (let i = 0; i + 1 < spreads.length; i++) {
    const a = spreads[i];
    const b = spreads[i + 1];
    if (!a.informative || !b.informative) continue;
    const above = spreads.slice(i + 2).filter((v) => v.informative);
    const below = spreads.slice(0, i).filter((v) => v.informative);
    if (a.nDyn >= 4 && b.nDyn <= 1 && b.Tmed !== null && b.Tmed <= tEnd / 4 && above.every((v) => v.nDyn <= 2)) out.push({ kind: "L", a: a.spread, b: b.spread });
    if (a.nDyn <= 1 && b.nDyn >= 4 && a.Tmed !== null && a.Tmed <= tEnd / 4 && below.every((v) => v.nDyn <= 2)) out.push({ kind: "I", a: a.spread, b: b.spread });
    if (a.nFc >= 4 && b.nDyn >= 4 && below.every((v) => v.nDyn <= 1)) out.push({ kind: "F", a: a.spread, b: b.spread });
  }
  return out;
}

export type SweepRowId = "A7" | "A9" | "A1" | "A2" | "A8" | "A3" | "A11" | "A6" | "A10" | "A4" | "A5";
export interface SweepOutcome {
  row: SweepRowId;
  name: string;
  /** M3c and M4 (sections 5 to 7) run: A1, A2, A3, A8, A9. */
  go: boolean;
  consequence: string;
}

const OUTCOMES: Record<SweepRowId, { name: string; go: boolean; consequence: string }> = {
  A7: { name: "UNINFORMATIVE", go: false, consequence: "stop and report; the controls fail at most spreads: a physics problem (Gate 0 should have prevented it), not an RPS result" },
  A9: { name: "DYNAMIC WINDOW", go: true, consequence: "M3c and M4 run" },
  A1: { name: "CLIFF, lattice-like orientation", go: true, consequence: "M3c and M4 run" },
  A2: { name: "CLIFF, inverted orientation", go: true, consequence: "M3c and M4 run; the plan predicted this is possible (colonization and mobility are one transport)" },
  A8: { name: "FREEZE EDGE", go: true, consequence: "M3c and M4 run" },
  A3: { name: "COEXISTENCE THROUGHOUT (within the budget)", go: true, consequence: "M3c and M4 run; not evidence of stable coexistence (the budget is not a waiting time)" },
  A11: { name: "NO DETECTABLE PREDATION EFFECT", go: false, consequence: "stop; labels coexist and churn as in the control and the kill leaves no cyclic signature, so at kappa* the kill is washed out. The next step is another substrate rung (3.0), not a wider sweep" },
  A6: { name: "FROZEN COEXISTENCE ONLY", go: false, consequence: "stop; the deferred exchange knob (plan 11) is the next step" },
  A10: { name: "SPARSE FILM", go: false, consequence: "stop; persistent sparse films are not a carpet: a substrate question (3.0), not an RPS result" },
  A4: { name: "LABEL LOSS THROUGHOUT", go: false, consequence: "stop; the deferred transfer (plan 11) or another substrate rung is the next step" },
  A5: { name: "RAGGED OR GRADUAL", go: false, consequence: "M3c and M4 do not run; the readout prints the table and the main session decides by amendment (the options of plan 4.5)" },
};

/** The outcome table of 4.4: the first row that holds, in the order of the table (A7, A9, A1, A2, A8, A3, A11, A6, A10, A4, A5). */
export function sweepOutcome(spreads: readonly SweepSpread[], tEnd: number): SweepOutcome & { I: number; edges: EdgePair[] } {
  const inf = spreads.filter((s) => s.informative);
  const edges = edgePairs(spreads, tEnd);
  const L = edges.filter((e) => e.kind === "L");
  const I = edges.filter((e) => e.kind === "I");
  const F = edges.filter((e) => e.kind === "F");
  const none = edges.length === 0;
  const all = (f: (s: SweepSpread) => boolean) => inf.every(f);
  const some = (f: (s: SweepSpread) => boolean) => inf.some(f);
  const pick = (row: SweepRowId) => ({ row, ...OUTCOMES[row], I: inf.length, edges });
  if (inf.length < 4) return pick("A7");
  if (F.length === 1 && L.length === 1 && I.length === 0 && F[0].b <= L[0].a && inf.filter((s) => s.spread >= F[0].b && s.spread <= L[0].a).every((s) => s.nDyn >= 3)) return pick("A9");
  if (L.length === 1 && F.length === 0 && I.length === 0) return pick("A1");
  if (I.length === 1 && F.length === 0 && L.length === 0) return pick("A2");
  if (F.length === 1 && L.length === 0 && I.length === 0 && inf.filter((s) => s.spread >= F[0].b).every((s) => s.nDyn >= 3)) return pick("A8");
  if (none && all((s) => s.nDyn >= 4)) return pick("A3");
  if (none && all((s) => s.nSig <= 1) && some((s) => s.nChurn >= 4)) return pick("A11");
  if (none && all((s) => s.nDyn <= 1) && some((s) => s.nFc >= 4)) return pick("A6");
  if (none && all((s) => s.nDyn <= 1) && some((s) => s.nSparse >= 3)) return pick("A10");
  if (none && all((s) => s.nDyn <= 1 && s.nFc <= 3 && s.nLost + s.nExt >= 3)) return pick("A4");
  return pick("A5");
}

/**
 * 4.6, for the go rows: the smallest informative `v` in `G_spread` with `n_dyn(v) >= 4` whose informative neighbours in `G_spread`
 * (the previous and the next value) all have `n_dyn >= 3`; if there is none, the smallest informative `v` with `n_dyn(v) >= 4`.
 * `v` itself must be informative (decision O-2): a spread whose control lost a label is a physics failure, not an RPS result, and
 * must not be the point the mutation runs start at.
 */
export function spreadStar(spreads: readonly SweepSpread[]): number | null {
  const ok = (k: number) => spreads[k].informative && spreads[k].nDyn >= 4;
  for (let k = 0; k < spreads.length; k++) {
    if (!ok(k)) continue;
    const nb = [spreads[k - 1], spreads[k + 1]].filter((x): x is SweepSpread => x !== undefined && x.informative);
    if (nb.every((x) => x.nDyn >= 3)) return spreads[k].spread;
  }
  for (let k = 0; k < spreads.length; k++) if (ok(k)) return spreads[k].spread;
  return null;
}

export interface RateArmRow {
  rate: number;
  seed: number;
  cls: RunClass | "MISSING" | null;
  chiFw: number | null;
  tcx: number | "CENSORED" | null;
}

export interface SweepResult {
  status: "done" | "pending";
  tEnd: number;
  reduced: boolean;
  kappaStar: number;
  spreads: SweepSpread[];
  I: number;
  edges: EdgePair[];
  outcome: (SweepOutcome & { I: number; edges: EdgePair[] }) | null;
  spreadStar: number | null;
  rateArms: RateArmRow[];
  missing: string[];
  listed: string[];
  problems: Problems;
  jobs: { job: Job; a: RunAnalysis | null }[];
}

/** The kill rate the registered stages use: the operating point's `kappaStar`, else the one nonzero `rpsRate` of the sweep's treatment jobs. */
export function kappaStarOf(op: Pick<OperatingPoint, "kappaStar">, sweepJobs: readonly Job[], pr: Problems): number | null {
  if (op.kappaStar !== undefined && op.kappaStar !== null) return op.kappaStar;
  const rates = new Set(sweepJobs.filter((j) => j.s.rate !== null && j.s.rate > 0 && SWEEP_TREAT_SEEDS.includes(j.s.seed)).map((j) => j.s.rate!));
  if (rates.size === 1) return [...rates][0];
  pr.add(2, `the operating point has no kappaStar and the sweep's treatment jobs do not share one nonzero rate (${[...rates].join(", ") || "none found"})`);
  return null;
}

/** The step budgets from the operating point (1.2); unusable input if the dense rate of G0.6 is missing. */
export function budgetsOf(op: Pick<OperatingPoint, "h0" | "denseRate">, pr: Problems): { tEnd: number; tEnd7: number; reduced: boolean } | null {
  if (op.denseRate === null || op.denseRate === undefined) {
    pr.add(2, "the operating point has no denseRate (G0.6): the step budgets of 1.2 are not decided");
    return null;
  }
  return scheduleOf(op.h0, op.denseRate);
}

/** Sections 4.1 to 4.6 over the sweep jobs (stages `sweep` and `rate-arm`). */
export function evaluateSweep(allJobs: readonly Job[], op: RegisteredPoint): SweepResult {
  const pr = new Problems();
  const missing: string[] = [];
  const listed: string[] = [];
  const jobs = allJobs.filter((j) => j.s.stage === "sweep" || j.s.stage === "rate-arm");
  for (const j of jobs) checkSettings(j.s, { K0: 3, types: 3, mutRate: 0 }, pr, "the sweep (4.1)");
  const sched = budgetsOf(op, pr);
  const kappa = kappaStarOf(op, jobs, pr);
  const tEnd = sched?.tEnd ?? 0;
  const empty: SweepResult = { status: "pending", tEnd, reduced: sched?.reduced ?? false, kappaStar: kappa ?? 0, spreads: [], I: 0, edges: [], outcome: null, spreadStar: null, rateArms: [], missing, listed, problems: pr, jobs: [] };
  if (sched === null || kappa === null) return empty;
  const analyze = makeAnalyzer(pr);
  const nRun = tEnd / CENSUS_INTERVAL;
  const get = (desc: string, pred: (s: JobSummary) => boolean) => {
    const j = pickOne(jobs, pr, desc, pred);
    if (!j) {
      missing.push(desc);
      return { j, a: null as RunAnalysis | null };
    }
    if (j.s.missing) {
      listed.push(`${j.s.id} is MISSING (failed twice)`);
      return { j, a: null };
    }
    const a = analyze(j, nRun);
    if (a && a.cls === "NOSTART") listed.push(`${j.s.id} is NOSTART`);
    return { j, a };
  };
  for (const j of jobs) {
    if (j.s.stage === "sweep" && SWEEP_TREAT_SEEDS.includes(j.s.seed) && j.s.rate !== null && j.s.rate !== 0 && j.s.rate !== kappa) {
      pr.add(2, `${j.s.id}: a sweep treatment job at rate ${j.s.rate}, but kappa* is ${kappa}`);
    }
  }
  const spreads: SweepSpread[] = [];
  for (const v of op.gSpread) {
    const treat = SWEEP_TREAT_SEEDS.map((sd) => get(`sweep spread ${v} rate ${kappa} seed ${sd}`, (s) => s.stage === "sweep" && s.spread === v && s.seed === sd && s.rate === kappa));
    const ctrl = SWEEP_CONTROL_SEEDS.map((sd) => get(`sweep spread ${v} rate 0 seed ${sd} (control)`, (s) => s.stage === "sweep" && s.spread === v && s.seed === sd && s.rate === 0));
    spreads.push(spreadStats(v, treat.map((x) => x.a), ctrl.map((x) => x.a), tEnd));
  }
  // the rate arms are reported beside the table and are not part of the outcome, so they never block it
  const arms: RateArmRow[] = [];
  const armJobs = jobs.filter((j) => j.s.stage === "rate-arm");
  const maxRate = op.rung === "V" ? RATE_MAX_VACANCY : RATE_MAX_REMOVAL;
  const armRates = [Math.max(1, Math.floor(kappa / 4)), Math.min(maxRate, 4 * kappa)];
  for (const rate of armRates) {
    for (const sd of RATE_ARM_SEEDS) {
      const j = armJobs.find((x) => x.s.rate === rate && x.s.seed === sd && x.s.spread === op.vCal);
      const a = j && !j.s.missing ? analyze(j, nRun) : null;
      arms.push({ rate, seed: sd, cls: j ? (j.s.missing ? "MISSING" : (a?.cls ?? null)) : null, chiFw: a && a.cls !== "NOSTART" ? a.chiFw : null, tcx: a?.tcx ?? null });
    }
  }
  const jobList = jobs.map((job) => ({ job, a: job.s.missing ? null : analyze(job, nRun) }));
  jobBugs(jobs, (j) => analyze(j, nRun), pr);
  if (missing.length > 0) {
    pr.add(4, `sweep jobs missing (${missing.length}): ${missing.slice(0, 5).join("; ")}${missing.length > 5 ? "; ..." : ""}`);
    return { ...empty, spreads, rateArms: arms, jobs: jobList };
  }
  const outcome = sweepOutcome(spreads, tEnd);
  return { status: "done", tEnd, reduced: sched.reduced, kappaStar: kappa, spreads, I: outcome.I, edges: outcome.edges, outcome, spreadStar: outcome.go ? spreadStar(spreads) : null, rateArms: arms, missing, listed, problems: pr, jobs: jobList };
}

// ---- 5 longer cycles ----

export interface CycleJob {
  K0: 4 | 5;
  seed: number;
  cls: RunClass | "MISSING" | null;
  /** DC and `Y_c = K0` at every census of the final window. */
  viable: boolean;
}
export interface CyclesResult {
  /** `closed`: 4.4 gave no go row, so section 5 does not run. */
  status: "done" | "pending" | "closed";
  jobs: CycleJob[];
  /** An arm is viable iff at least 2 of its 3 jobs are VIABLE. */
  arms: Record<4 | 5, { viable: number; armViable: boolean }>;
  missing: string[];
  problems: Problems;
}

/** Section 5: VIABLE jobs and viable arms (reported only; the write-up states them next to section 7). */
export function evaluateCycles(allJobs: readonly Job[], sweep: SweepResult): CyclesResult {
  const pr = new Problems();
  const missing: string[] = [];
  const arms = { 4: { viable: 0, armViable: false }, 5: { viable: 0, armViable: false } };
  if (sweep.status !== "done" || !sweep.outcome) {
    pr.add(4, "section 5 needs the sweep outcome of 4.4, which is not complete");
    return { status: "pending", jobs: [], arms, missing, problems: pr };
  }
  if (!sweep.outcome.go || sweep.spreadStar === null) return { status: "closed", jobs: [], arms, missing, problems: pr };
  const analyze = makeAnalyzer(pr);
  const nRun = sweep.tEnd / CENSUS_INTERVAL;
  const jobs = allJobs.filter((j) => j.s.stage === "cycles");
  // section 5: `rpsTypes = K0` and no mutation
  for (const j of jobs) checkSettings(j.s, { types: j.s.K0 ?? undefined, mutRate: 0 }, pr, "longer cycles (5)");
  const out: CycleJob[] = [];
  for (const K0 of [4, 5] as const) {
    for (const sd of CYCLE_SEEDS[K0]) {
      const j = pickOne(jobs, pr, `cycles K0 ${K0} seed ${sd}`, (s) => s.seed === sd && s.K0 === K0 && s.spread === sweep.spreadStar && s.rate === sweep.kappaStar);
      if (!j) {
        missing.push(`cycles K0 ${K0} spread ${sweep.spreadStar} rate ${sweep.kappaStar} seed ${sd}`);
        continue;
      }
      const a = j.s.missing ? null : analyze(j, nRun);
      const viable = a !== null && a.cls === "DC" && a.rows.slice(a.rows.length - WINDOW).every((r) => r.Y === K0);
      out.push({ K0, seed: sd, cls: j.s.missing ? "MISSING" : (a?.cls ?? null), viable });
    }
  }
  jobBugs(jobs, (j) => analyze(j, nRun), pr);
  if (missing.length > 0) {
    pr.add(4, `section 5 jobs missing (${missing.length}): ${missing.join("; ")}`);
    return { status: "pending", jobs: out, arms, missing, problems: pr };
  }
  for (const K0 of [4, 5] as const) {
    const v = out.filter((x) => x.K0 === K0 && x.viable).length;
    arms[K0] = { viable: v, armViable: v >= 2 };
  }
  return { status: "done", jobs: out, arms, missing, problems: pr };
}

// ---- 6.1 the deep-volume precondition ----

export interface DeepResult {
  status: "done" | "pending" | "closed";
  /** 6.1 holds: a go row and, among the DC treatment jobs at `spread*` (at least 4), the median `xi` of the final snapshot is at least 6. */
  holds: boolean;
  /** The failing condition when it does not hold. */
  reason: string | null;
  dcJobs: { id: string; xi: number | null; zcoh: number | null }[];
  medianXi: number | null;
  problems: Problems;
}

/**
 * 6.1. `measure(job)` gives the final snapshot's `xi` and z-coherence (readout.ts reads `final.bin`, or `summary.json`'s `xi`); null if it has neither.
 * The median of an even number of `xi` values is the mean of the two middle values.
 */
export function evaluateDeepPrecondition(sweep: SweepResult, measure: (job: Job) => { xi: number | null; zcoh: number | null } | null): DeepResult {
  const pr = new Problems();
  const base = { dcJobs: [], medianXi: null, problems: pr };
  if (sweep.status !== "done" || !sweep.outcome) {
    pr.add(4, "section 6.1 needs the sweep outcome of 4.4, which is not complete");
    return { status: "pending", holds: false, reason: null, ...base };
  }
  if (!sweep.outcome.go || sweep.spreadStar === null) return { status: "closed", holds: false, reason: `4.4 gave ${sweep.outcome.row} (${sweep.outcome.name}), not a go row`, ...base };
  const dc = sweep.jobs.filter(({ job, a }) => job.s.stage === "sweep" && job.s.spread === sweep.spreadStar && job.s.rate === sweep.kappaStar && a?.cls === "DC");
  const dcJobs = dc.map(({ job }) => {
    const m = measure(job);
    if (m === null || m.xi === null) pr.add(2, `${job.s.id}: no final.bin and no xi in summary.json for a DC treatment job at spread* (6.1 needs the final snapshot)`);
    return { id: job.s.id, xi: m?.xi ?? null, zcoh: m?.zcoh ?? null };
  });
  if (pr.has(2)) return { status: "done", holds: false, reason: null, dcJobs, medianXi: null, problems: pr };
  if (dcJobs.length < 4) return { status: "done", holds: false, reason: `only ${dcJobs.length} DC treatment jobs at spread* ${sweep.spreadStar} (6.1 needs at least 4)`, dcJobs, medianXi: null, problems: pr };
  const medianXi = medianMean(dcJobs.map((d) => d.xi as number));
  if (medianXi < XI_MIN) return { status: "done", holds: false, reason: `median xi ${medianXi.toFixed(2)} of the final snapshots at spread* ${sweep.spreadStar} is below ${XI_MIN} cells`, dcJobs, medianXi, problems: pr };
  return { status: "done", holds: true, reason: null, dcJobs, medianXi, problems: pr };
}
