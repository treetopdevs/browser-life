// Amendment 2 of experiments/3d-rps/RULES.md (2026-10-24, after Amendment 1 read EXPLORATION-NO-HORIZON): persistence at 256 x 256 x 4,
// applied mechanically to the exploration's job directory. A2.2: the horizon (G0.4 at this shape: spread 8, rate 0, seeds 401 to 403,
// 200,000 run steps, stage g0.horizon-rung); A2.3: the confirmation of both kill forms at rate 64, spread 8 (G0.5 at this shape, stage
// g0.confirm), once `h0` is known; A2.4: one label per kill form. `T_ctl` and `h0` are G0.4's own (`horizonOfRefs`), and the operating
// point (`v_cal` 8, `kappa_w` 64) is fixed by A2.1, not read from data. Pure: readout.ts loads the jobs.

import { HORIZON_STEPS, TABLE_SEEDS, horizonOfRefs, type ConfirmResult, type ExpectedJob, type HorizonResult } from "./readout-gate0.ts";
import { CENSUS_INTERVAL, Problems, jobBugs, makeAnalyzer, pickOne, type Job, type JobSummary, type Kill, type RunAnalysis } from "./readout-jobs.ts";

/** The first line of every output of Amendment 2's exploration. */
export const EXPLORATION_2_HEADER = "EXPLORATION (Amendment 2): the registered pilot ended GATE-0-STOP";
/** A2.1: the shape of every Amendment 2 job. */
export const A2_SHAPE: readonly [number, number, number] = [256, 256, 4];
/** A2.1: the operating point carried over from Amendment 1, for both kill forms. */
export const A2_V_CAL = 8;
export const A2_KAPPA_W = 64;
/** A2.2 and A2.3: seeds 401, 402 and 403. */
export const A2_SEEDS: readonly number[] = TABLE_SEEDS;
/** The stages Amendment 2 runs: the horizon at 256 x 256 x 4 (3.0's horizon rung) and the confirmation. */
export const A2_STAGES: readonly string[] = ["g0.horizon-rung", "g0.confirm"];
/** The kill forms of A2.3, with the rung label a job of each carries. */
export const A2_FORMS: readonly { kill: Kill; rung: "S0" | "V" }[] = [
  { kill: "removal", rung: "S0" },
  { kill: "vacancy", rung: "V" },
];

/** A2.4, in its order (the first that holds). */
export type Exploration2Label = "EXPLORATION-2-NO-HORIZON" | "EXPLORATION-2-NO-CONFIRM" | "EXPLORATION-2-PERSISTS";

export interface Exploration2Form {
  kill: Kill;
  rung: "S0" | "V";
  /** `done`: the form has its label; `pending`: jobs are still to run (see `missing`). */
  state: "pending" | "done";
  label: Exploration2Label | null;
  missing: string[];
  confirm: ConfirmResult | null;
}

export interface Exploration2Result {
  /** G0.4 at 256 x 256 x 4, once its three jobs are in. */
  horizon: HorizonResult | null;
  horizonMissing: string[];
  /** MISSING and NOSTART jobs, listed for the record. */
  listed: string[];
  /** The removal kill, then the vacancy kill. */
  forms: Exploration2Form[];
  /** Both forms have a label. */
  complete: boolean;
  notes: string[];
  problems: Problems;
  jobs: { job: Job; a: RunAnalysis | null }[];
}

const expectedRun = (steps: number) => steps / CENSUS_INTERVAL;
const shapeText = (d: { W: number; H: number; D: number }) => `${d.W}x${d.H}x${d.D}`;

/** Amendment 2: evaluates the exploration from its own jobs. */
export function evaluateExploration2(allJobs: readonly Job[]): Exploration2Result {
  const pr = new Problems();
  const notes: string[] = [];
  const listed: string[] = [];
  const analyze = makeAnalyzer(pr);
  const forms: Exploration2Form[] = A2_FORMS.map((f) => ({ kill: f.kill, rung: f.rung, state: "pending", label: null, missing: [], confirm: null }));
  const res: Exploration2Result = { horizon: null, horizonMissing: [], listed, forms, complete: false, notes, problems: pr, jobs: [] };

  // ---- the jobs: only the stages, shape and settings of A2.1 to A2.3; a job run with others is a bug indicator (exit 3) ----
  const jobs: Job[] = [];
  for (const j of allJobs) {
    const s = j.s;
    if (!A2_STAGES.includes(s.stage)) {
      pr.add(2, `${s.id}: stage ${s.stage} does not belong in the Amendment 2 directory (A2.2 and A2.3 run ${A2_STAGES.join(" and ")})`);
      continue;
    }
    if (s.rung === null || s.kill === null || s.spread === null || s.rate === null) {
      pr.add(2, `${s.id}: an Amendment 2 job needs rung, kill, spread and rpsRate in summary.json`);
      continue;
    }
    if (s.dims === null) {
      pr.add(2, `${s.id}: summary.json gives no shape`);
      continue;
    }
    const wrong: string[] = [];
    if (shapeText(s.dims) !== A2_SHAPE.join("x")) wrong.push(`shape ${shapeText(s.dims)} instead of ${A2_SHAPE.join("x")}`);
    if (s.spread !== A2_V_CAL) wrong.push(`spread ${s.spread} instead of ${A2_V_CAL}`);
    if (!A2_SEEDS.includes(s.seed)) wrong.push(`seed ${s.seed} outside ${A2_SEEDS.join(", ")}`);
    if (s.K0 !== null && s.K0 !== 3) wrong.push(`K0 ${s.K0} instead of 3`);
    if (s.types !== null && s.types !== 3) wrong.push(`rpsTypes ${s.types} instead of 3`);
    if (s.mutRate !== null && s.mutRate !== 0) wrong.push(`mutRate ${s.mutRate} instead of 0`);
    // A2.1: every Amendment 2 job, the horizon and both confirmations, runs on rung S0's substrate (V is hosted on S0).
    if (s.substrate !== "S0") wrong.push(`substrate ${s.substrate ?? "not recorded"} instead of S0`);
    if (s.stage === "g0.horizon-rung" && (s.rate !== 0 || s.rung !== "S0" || s.kill !== "removal")) wrong.push(`the horizon is rung S0, the removal build, rate 0 (got rung ${s.rung}, ${s.kill}, rate ${s.rate})`);
    if (s.stage === "g0.confirm") {
      const form = A2_FORMS.find((f) => f.kill === s.kill);
      if (s.rate !== A2_KAPPA_W) wrong.push(`rate ${s.rate} instead of ${A2_KAPPA_W}`);
      if (form === undefined || form.rung !== s.rung) wrong.push(`rung ${s.rung} with the ${s.kill} kill (removal is rung S0, the vacancy kill rung V)`);
    }
    if (wrong.length > 0) {
      pr.add(3, `${s.id}: not run as Amendment 2 says (${wrong.join("; ")}); a bug indicator, and the job is not used (A2.1 to A2.3, 8.4)`);
      continue;
    }
    jobs.push(j);
  }

  const refOf = (desc: string, job: Job | undefined, nRun: number | null, missing: string[]): ExpectedJob => {
    if (!job) {
      missing.push(desc);
      return { desc, job: null, a: null };
    }
    if (job.s.missing) {
      if (!listed.includes(`${job.s.id} is MISSING (failed twice)`)) listed.push(`${job.s.id} is MISSING (failed twice)`);
      return { desc, job, a: null };
    }
    const a = analyze(job, nRun);
    if (a && a.cls === "NOSTART" && !listed.includes(`${job.s.id} is NOSTART`)) listed.push(`${job.s.id} is NOSTART`);
    return { desc, job, a };
  };
  const find = (desc: string, pred: (s: JobSummary) => boolean): Job | undefined => pickOne(jobs, pr, desc, pred);

  // ---- A2.2: the horizon ----
  const hzRefs = A2_SEEDS.map((sd) => {
    const desc = `g0.horizon-rung S0 spread ${A2_V_CAL} rate 0 seed ${sd} (256 x 256 x 4, ${HORIZON_STEPS} run steps)`;
    return refOf(desc, find(desc, (s) => s.stage === "g0.horizon-rung" && s.seed === sd), expectedRun(HORIZON_STEPS), res.horizonMissing);
  });
  if (res.horizonMissing.length === 0) {
    res.horizon = horizonOfRefs(A2_V_CAL, hzRefs);
    if (res.horizon.Tctl === null) pr.add(3, "no horizon control is usable (all NOSTART or MISSING), so G0.4 has no value and no label of A2.4 covers it");
  }

  // ---- A2.3 and A2.4: each kill form ----
  const h0 = res.horizon?.h0 ?? null;
  for (const f of forms) {
    if (res.horizon === null) {
      f.missing.push(...res.horizonMissing);
      continue;
    }
    if (res.horizon.Tctl === null) continue;
    if (h0 === null) {
      f.state = "done";
      f.label = "EXPLORATION-2-NO-HORIZON";
      continue;
    }
    const refs = A2_SEEDS.map((sd) => {
      const desc = `g0.confirm ${f.rung} (${f.kill} kill) spread ${A2_V_CAL} rate ${A2_KAPPA_W} seed ${sd} (${h0} run steps)`;
      return refOf(desc, find(desc, (s) => s.stage === "g0.confirm" && s.kill === f.kill && s.seed === sd), expectedRun(h0), f.missing);
    });
    if (f.missing.length > 0) continue;
    f.confirm = { spread: A2_V_CAL, rate: A2_KAPPA_W, steps: h0, classes: refs.map((x) => x.a?.cls ?? null), nDC: refs.filter((x) => x.a?.cls === "DC").length };
    f.state = "done";
    f.label = f.confirm.nDC >= 2 ? "EXPLORATION-2-PERSISTS" : "EXPLORATION-2-NO-CONFIRM";
  }
  if (h0 === null && jobs.some((j) => j.s.stage === "g0.confirm")) notes.push("confirmation jobs are present but h0 is none or not yet known: they are not used (A2.3)");
  res.complete = forms.every((f) => f.state === "done");
  for (const f of forms) {
    if (f.state === "pending" && f.missing.length > 0) pr.add(4, `the exploration is incomplete: the ${f.kill} kill has ${f.missing.length} job${f.missing.length === 1 ? "" : "s"} to run (${f.missing.slice(0, 3).join("; ")}${f.missing.length > 3 ? "; ..." : ""})`);
  }

  // ---- bug indicators (conservation, invariants, burn-in groups, chirality of the controls) ----
  const analysisOf = (j: Job): RunAnalysis | null => {
    if (j.rows === null || j.s.missing) return null;
    return analyze(j, j.s.stage === "g0.horizon-rung" ? expectedRun(HORIZON_STEPS) : h0 === null ? null : expectedRun(h0));
  };
  jobBugs(jobs, analysisOf, pr, { substrateOf: () => "S0" });
  res.jobs = jobs.map((job) => ({ job, a: analysisOf(job) }));
  return res;
}
