// Rule draft 7 (Q3: does the cycle grow): the run classes of 7.3, the horizon check of 7.4 (HORIZON-VOID), the arm verdicts of 7.5
// with the Fisher rule, and the predictions of 7.6. Pure: readout.ts loads the jobs.

import { CENSUS_INTERVAL, Problems, analyzeMutation, checkSettings, fisherOneSided, jobBugs, medianMean, type Arm, type Job, type MutationAnalysis, type MutationClass } from "./readout-jobs.ts";
import { SUBSTRATE_SCALE } from "./readout-gate0.ts";
import { type RegisteredPoint, type SweepResult, budgetsOf } from "./readout-kernel.ts";

export const MUTATION_SEEDS: readonly number[] = [251, 252, 253, 254, 255];
export const ARMS: readonly Arm[] = ["Z", "A", "B", "C", "N", "W"];
/** GROWS: `g_L >= 4` and `gN_L <= g_L - 4` is the one-sided exact Fisher test at 0.05 for 5 against 5 runs: 4 against 0, 5 against 0, 5 against 1. */
export const GROWS_MIN_LONG = 4;
export const GROWS_NULL_GAP = 4;
export const HORIZON_VOID_MIN = 3;
export const COLLAPSE_MIN = 3;
export const STABLE_MIN = 3;
export const UNDISTINGUISHED_MIN_LONG = 3;
export const SUPPLY_MIN = 1;

/**
 * The settings of each arm (the table of 7.2). `mutRate` is the value of rung S0; at a substrate of matter scale `s` an arm uses
 * `floor(mutRate / s)` (7.2), W included. Arm N has the operators of arm C with `rpsRate` 0.
 */
export const ARM_SETTINGS: Readonly<Record<Arm, { types: number; flip: number; edge: number; mutRate: number }>> = {
  Z: { types: 3, flip: 0, edge: 0, mutRate: 0 },
  A: { types: 3, flip: 4_294_967_295, edge: 256, mutRate: 42_950 },
  B: { types: 5, flip: 4_294_967_295, edge: 0, mutRate: 42_950 },
  C: { types: 5, flip: 4_294_967_295, edge: 128, mutRate: 42_950 },
  N: { types: 5, flip: 4_294_967_295, edge: 128, mutRate: 42_950 },
  W: { types: 3, flip: 0, edge: 0, mutRate: 429_497 },
};

/** The `mutRate` an arm uses at matter scale `scale` (7.2): the table's value for rung S0 divided by the scale, rounded down. */
export function armMutRate(arm: Arm, scale: number): number {
  return Math.floor(ARM_SETTINGS[arm].mutRate / scale);
}

/** Is `got` exactly the arm's `mutRate` at matter scale `scale` (7.2)? Not the ceiling, not a nearby integer: the registered physics is one number. */
export function mutRateOk(got: number, arm: Arm, scale: number): boolean {
  return got === armMutRate(arm, scale);
}

export type VerdictId = "GROWS" | "UNDISTINGUISHED" | "COLLAPSE" | "STABLE" | "INCONCLUSIVE";

export interface ArmCounts {
  /** LONG, THREE, LOOSE (`g_Lo`), MONO, EXTINCT. */
  gL: number;
  gT: number;
  gLo: number;
  gM: number;
  gE: number;
}

export function countClasses(runs: readonly { cls: MutationClass }[]): ArmCounts {
  const n = (c: MutationClass) => runs.filter((r) => r.cls === c).length;
  return { gL: n("LONG"), gT: n("THREE"), gLo: n("LOOSE"), gM: n("MONO"), gE: n("EXTINCT") };
}

export interface ArmVerdict {
  row: 1 | 2 | 3 | 4 | 5;
  verdict: VerdictId;
}

/**
 * The arm verdict of 7.5 (the first row that holds). Rows 1 and 2 are for arm C and need `gNL` (arm N's LONG count) and `uC` (the
 * median supply of arm C's runs).
 */
export function armVerdict(arm: Arm, c: ArmCounts, ctx: { gNL: number | null; uC: number | null }): ArmVerdict {
  const kc = c.gM + c.gE;
  const ks = c.gT + c.gL;
  if (arm === "C") {
    if (ctx.gNL === null || ctx.uC === null) throw new Error("armVerdict: arm C needs arm N's LONG count and the median supply");
    if (c.gL >= GROWS_MIN_LONG && ctx.gNL <= c.gL - GROWS_NULL_GAP && ctx.uC >= SUPPLY_MIN) return { row: 1, verdict: "GROWS" };
    if (c.gL >= UNDISTINGUISHED_MIN_LONG) return { row: 2, verdict: "UNDISTINGUISHED" };
  }
  if (kc >= COLLAPSE_MIN) return { row: 3, verdict: "COLLAPSE" };
  if (ks >= STABLE_MIN) return { row: 4, verdict: "STABLE" };
  return { row: 5, verdict: "INCONCLUSIVE" };
}

/** Arm Z's horizon check (7.4): void iff at least 3 of its 5 runs are MONO or EXTINCT. */
export function horizonVoid(z: ArmCounts): boolean {
  return z.gM + z.gE >= HORIZON_VOID_MIN;
}

export interface PredictionLine {
  arm: Arm;
  text: string;
  /** null: not decidable (the section is void, or the arm is not complete). */
  hit: boolean | null;
}

/** The predictions of 7.6, each checked against the arm's verdict (informative; `voidSection` makes the ones that need Z unevaluated). */
export function predictions(verdicts: ReadonlyMap<Arm, { v: VerdictId; counts: ArmCounts }>, voidSection: boolean): PredictionLine[] {
  const out: PredictionLine[] = [];
  const get = (a: Arm) => verdicts.get(a);
  const z = get("Z");
  if (z) out.push({ arm: "Z", text: "STABLE; the section is void only when the horizon check of 7.4 says so", hit: z.v === "STABLE" });
  const w = get("W");
  if (w) out.push({ arm: "W", text: "STABLE, if Z is not void", hit: voidSection ? null : w.v === "STABLE" });
  const a = get("A");
  if (a) out.push({ arm: "A", text: "STABLE or COLLAPSE", hit: a.v === "STABLE" || a.v === "COLLAPSE" });
  const b = get("B");
  if (b) {
    const commonest = b.counts.gLo > Math.max(b.counts.gL, b.counts.gT, b.counts.gM, b.counts.gE);
    out.push({ arm: "B", text: "COLLAPSE, or INCONCLUSIVE with LOOSE strictly more frequent than every other class", hit: b.v === "COLLAPSE" || (b.v === "INCONCLUSIVE" && commonest) });
  }
  const c = get("C");
  if (c) out.push({ arm: "C", text: "not GROWS (UNDISTINGUISHED, COLLAPSE, STABLE or INCONCLUSIVE)", hit: c.v !== "GROWS" });
  return out;
}

export interface ArmResult {
  arm: Arm;
  runs: (MutationAnalysis | null)[];
  /** Number of runs found (finished and analysable). */
  nRuns: number;
  counts: ArmCounts | null;
  verdict: ArmVerdict | null;
  /** Median supply over the runs (arm C only). */
  medianSupply: number | null;
  /** Arm C only: the one-sided exact Fisher p of C against N (informative; the operative rule is `g_L >= 4`, `gN_L <= g_L - 4`). */
  fisherP: number | null;
}

export interface MutationResult {
  /** `closed`: 4.4 gave no go row ("mutation runs not made: gate closed"). `pending`: runs still to do. */
  status: "done" | "pending" | "closed";
  tEnd7: number;
  arms: ArmResult[];
  /** Arm Z's horizon check. */
  horizonVoid: boolean | null;
  predictions: PredictionLine[];
  missing: string[];
  problems: Problems;
}

/** Section 7 over the `mutation` jobs of the sweep's `spread*`. */
export function evaluateMutation(allJobs: readonly Job[], op: RegisteredPoint, sweep: SweepResult): MutationResult {
  const pr = new Problems();
  const missing: string[] = [];
  const base = (status: MutationResult["status"], tEnd7 = 0): MutationResult => ({ status, tEnd7, arms: [], horizonVoid: null, predictions: [], missing, problems: pr });
  if (sweep.status !== "done" || !sweep.outcome) {
    pr.add(4, "section 7 needs the sweep outcome of 4.4, which is not complete");
    return base("pending");
  }
  if (!sweep.outcome.go || sweep.spreadStar === null) return base("closed");
  const sched = budgetsOf(op, pr);
  if (sched === null) return base("pending");
  const nRun = sched.tEnd7 / CENSUS_INTERVAL;
  const jobs = allJobs.filter((j) => j.s.stage === "mutation");
  const scale = SUBSTRATE_SCALE[op.substrate];
  // the arm of a job is its recorded arm
  const armOf = (j: Job): Arm | null => j.s.arm;
  for (const j of jobs) {
    if (armOf(j) === null) pr.add(2, `${j.s.id}: a mutation job needs an arm (Z, A, B, C, N or W) in summary.json`);
    // 7.2: every arm runs at spread* with kappa* (arm N with predation off)
    else if (j.s.spread !== sweep.spreadStar) pr.add(2, `${j.s.id}: spread ${j.s.spread}, but the arms run at spread* ${sweep.spreadStar}`);
    else if (j.s.rate !== (armOf(j) === "N" ? 0 : sweep.kappaStar)) pr.add(2, `${j.s.id}: rate ${j.s.rate}, but arm ${armOf(j)} runs at ${armOf(j) === "N" ? 0 : sweep.kappaStar}`);
    // the arm is a label: the operators it names must be the ones the job was run with (7.2), or a mislabelled file would be counted
    const arm = armOf(j);
    if (arm !== null) {
      const t = ARM_SETTINGS[arm];
      const bad: string[] = [];
      const need = (name: string, got: number | null, want: number) => {
        if (got === null) bad.push(`${name} is not recorded`);
        else if (got !== want) bad.push(`${name} is ${got}, the table gives ${want}`);
      };
      need("rpsTypes", j.s.types, t.types);
      need("rpsFlip", j.s.flip, t.flip);
      need("rpsEdge", j.s.edge, t.edge);
      if (j.s.mutRate === null) bad.push("mutRate is not recorded");
      else if (!mutRateOk(j.s.mutRate, arm, scale)) bad.push(`mutRate is ${j.s.mutRate}, the table gives floor(${t.mutRate} / ${scale}) = ${armMutRate(arm, scale)} (matter scale of ${op.substrate})`);
      if (bad.length > 0) pr.add(2, `${j.s.id}: arm ${arm} is not run as 7.2 says: ${bad.join("; ")}`);
      checkSettings(j.s, { K0: 3 }, pr, "section 7");
    }
  }
  const arms: ArmResult[] = ARMS.map((arm) => {
    const runs = MUTATION_SEEDS.map((sd) => {
      const j = jobs.filter((x) => armOf(x) === arm && x.s.seed === sd);
      if (j.length > 1) pr.add(2, `${j.length} jobs for arm ${arm} seed ${sd}`);
      if (j.length === 0 || j[0].s.missing) return null;
      return pr.guard(() => analyzeMutation(j[0], arm, { expectedRun: nRun }));
    });
    const found = runs.filter((r): r is MutationAnalysis => r !== null);
    const counts = found.length === 0 ? null : countClasses(found);
    return { arm, runs, nRuns: found.length, counts, verdict: null, medianSupply: arm === "C" && found.length > 0 ? medianMean(found.map((r) => r.supplyMax)) : null, fisherP: null };
  });
  const byArm = new Map(arms.map((a) => [a.arm, a]));
  jobBugs(jobs, () => null, pr, { chiControls: false });
  // LONG cannot occur in arms Z, A, B or W: a bug in the operator or the readout (7.5, 8.4)
  for (const arm of ["Z", "A", "B", "W"] as const) {
    const r = byArm.get(arm)!;
    for (const x of r.runs) if (x && x.cls === "LONG") pr.add(3, `${x.id}: class LONG in arm ${arm}, where no clean cycle through four labels can occur (bug indicator, 7.5 and 8.4)`);
  }
  // 7.4: arm Z first and complete
  const z = byArm.get("Z")!;
  if (z.nRuns < MUTATION_SEEDS.length) {
    missing.push(`arm Z: ${MUTATION_SEEDS.length - z.nRuns} of ${MUTATION_SEEDS.length} runs missing or unusable`);
    pr.add(4, `arm Z needs all five runs for the horizon check of 7.4 (${z.nRuns} found)`);
    return { ...base("pending", sched.tEnd7), arms };
  }
  const voidSection = horizonVoid(z.counts!);
  const verdicts = new Map<Arm, { v: VerdictId; counts: ArmCounts }>();
  const nArmN = byArm.get("N")!;
  for (const r of arms) {
    if (r.counts === null) continue;
    // a void section needs no other arm: whatever ran is printed marked void, and a partial arm is not a missing job
    if (r.arm !== "Z" && r.nRuns < MUTATION_SEEDS.length) {
      if (!voidSection) {
        missing.push(`arm ${r.arm}: ${MUTATION_SEEDS.length - r.nRuns} of ${MUTATION_SEEDS.length} runs missing or unusable`);
        pr.add(4, `arm ${r.arm} has ${r.nRuns} of ${MUTATION_SEEDS.length} runs`);
      }
      continue;
    }
    if (r.arm === "C") {
      if (nArmN.nRuns < MUTATION_SEEDS.length) {
        if (!voidSection) {
          pr.add(4, `arm C's rows 1 and 2 need all five runs of arm N (${nArmN.nRuns} found)`);
          missing.push(`arm N: ${MUTATION_SEEDS.length - nArmN.nRuns} of ${MUTATION_SEEDS.length} runs missing or unusable`);
        }
        continue;
      }
      r.verdict = armVerdict("C", r.counts, { gNL: nArmN.counts!.gL, uC: r.medianSupply });
      r.fisherP = fisherOneSided(r.counts.gL, MUTATION_SEEDS.length - r.counts.gL, nArmN.counts!.gL, MUTATION_SEEDS.length - nArmN.counts!.gL);
    } else r.verdict = armVerdict(r.arm, r.counts, { gNL: null, uC: null });
    verdicts.set(r.arm, { v: r.verdict.verdict, counts: r.counts });
  }
  // the other arms are queued only if the horizon check passed
  if (!voidSection) {
    for (const arm of ARMS) {
      if (arm === "Z") continue;
      const r = byArm.get(arm)!;
      if (r.nRuns === 0) {
        missing.push(`arm ${arm}: not run (arm Z passed the horizon check, so the arm is due)`);
        pr.add(4, `arm ${arm} has not run; arm Z passed its horizon check`);
      }
    }
  }
  const status = pr.has(4) ? "pending" : "done";
  return { status, tEnd7: sched.tEnd7, arms, horizonVoid: voidSection, predictions: predictions(verdicts, voidSection), missing, problems: pr };
}
