// Amendment 1 of experiments/3d-rps/RULES.md (2026-10-24, after GATE-0-STOP): an exploration of the kill at S0's four mobility levels,
// applied mechanically to two job directories: the registered pilot's (read-only: S0's G0.2 scan and meter, and the three rate-0
// seed-401 cells of the table, which are the scan jobs) and the exploration's own (stages g0.table, g0.vcheck, g0.horizon, g0.confirm).
// Pure: readout.ts loads the jobs.
//
// What differs from 3.0 (A1.1 to A1.4): only S0 (removal) and V hosted on S0 (vacancy kill); row 1 reads `levels < 4` for S0, so its
// registered `G_spread` [6, 8, 10, 16] passes; both rungs are evaluated in full, side by side (no preference order, no rung "used");
// each ends with one label of A1.4, never a GO. Every threshold of 3.0 is unchanged (A1.3): the per-cell readings are readout-gate0.ts's.

import {
  HORIZON_STEPS,
  RATES_REMOVAL,
  RATES_VACANCY,
  SCAN_SEED,
  SHORT_RUN_CENSUSES,
  TABLE_SEEDS,
  cellOf,
  controlInfo,
  evaluateGate0,
  horizonOfRefs,
  kappaOf,
  tableSpreads,
  type ConfirmResult,
  type ControlInfo,
  type ExpectedJob,
  type HorizonResult,
  type MeterPoint,
  type ScanRow,
  type TableCell,
  type VCheck,
} from "./readout-gate0.ts";
import { CENSUS_INTERVAL, Problems, checkSettings, jobBugs, makeAnalyzer, pickOne, type Job, type JobSummary, type Kill, type RunAnalysis } from "./readout-jobs.ts";

/** The first line of every output of the exploration (Amendment 1, header). */
export const EXPLORATION_HEADER = "EXPLORATION (Amendment 1): the registered pilot ended GATE-0-STOP";
/** A1.1: for this exploration only, row 1 reads `levels < 4` for S0. */
export const LEVELS_MIN_EXPLORATION = 4;
/** A1.1: S0's `G_spread` as the registered G0.2 jobs gave it; the amendment is written for it. */
export const A1_G_SPREAD: readonly number[] = [6, 8, 10, 16];
/** The stages the exploration runs (A1.2); the registered G0.2 jobs are reused, not rerun. */
export const EXPLORATION_STAGES: readonly string[] = ["g0.table", "g0.vcheck", "g0.horizon", "g0.confirm"];

/** A1.4, in its order (the first that holds). */
export type ExplorationLabel = "EXPLORATION-V-VOID" | "EXPLORATION-NO-EFFECT" | "EXPLORATION-NO-HORIZON" | "EXPLORATION-NO-CONFIRM" | "EXPLORATION-WORKS";
export const EXPLORATION_LABELS: readonly ExplorationLabel[] = ["EXPLORATION-V-VOID", "EXPLORATION-NO-EFFECT", "EXPLORATION-NO-HORIZON", "EXPLORATION-NO-CONFIRM", "EXPLORATION-WORKS"];
const LABEL_OF_ROW: Record<2 | 3 | 4 | 5, ExplorationLabel> = { 2: "EXPLORATION-NO-EFFECT", 3: "EXPLORATION-NO-HORIZON", 4: "EXPLORATION-NO-CONFIRM", 5: "EXPLORATION-WORKS" };

export interface ExplorationRung {
  rung: "S0" | "V";
  kill: Kill;
  /** `done`: the rung has its label; `pending`: jobs are still to run (see `missing`). */
  state: "pending" | "done";
  label: ExplorationLabel | null;
  /** The row of 3.0 the label stands for (2 to 5); null for a void V. */
  row: 2 | 3 | 4 | 5 | null;
  /** Rung V only: its check failed, or is absent or incomplete although V jobs ran (G0.1): EXPLORATION-V-VOID. */
  voided: boolean;
  missing: string[];
  listed: string[];
  table: { spreads: number[]; rates: readonly number[]; cells: TableCell[] } | null;
  kappaW: number | null;
  vCal: number | null;
  horizon: HorizonResult | null;
  confirm: ConfirmResult | null;
}

export interface ExplorationResult {
  /** S0's G0.2 as the registered jobs give it (null if they are not usable). */
  registered: { scan: ScanRow[]; meter: MeterPoint[]; bMeter: number | null; gSpread: number[]; levels: number | null } | null;
  /** `v_lo`, `v_mid`, `v_hi` (A1.2: 6, 8, 16), null when the registered G0.2 is not usable. */
  spreads: [number, number, number] | null;
  /** The rate-0 controls of the three spreads (shared by S0 and V), once all nine are in. */
  controls: Map<number, ControlInfo>;
  /** S0 then V, both evaluated in full. */
  rungs: ExplorationRung[];
  vcheck: VCheck;
  /** G0.4 is run (once, shared) when either rung passed row 2 (a void V does not count). */
  horizonNeeded: boolean;
  /**
   * The problems (exit 3) that void V and nothing else: a failed V check, or one absent or incomplete although V jobs ran. They give
   * the final exit 3, but the driver does not stop S0 for them (A1.1: S0 is evaluated in full); every other exit 2 or 3 stops it.
   */
  voidMessages: string[];
  /** Both rungs have a label. */
  complete: boolean;
  notes: string[];
  problems: Problems;
  /** Every exploration job, and the registered jobs the table reads, with its class (A1.5). */
  jobs: { job: Job; a: RunAnalysis | null; source: "registered" | "exploration" }[];
}

export interface ExplorationInput {
  /** The registered pilot's jobs (read-only). */
  registered: readonly Job[];
  /** The exploration's jobs. */
  exploration: readonly Job[];
  /** The `census.tsv` text of a registered job (the loader keeps the text only for g0.vcheck jobs), for the V check. */
  registeredCensus: (j: Job) => string | null;
}

const expectedRun = (steps: number) => steps / CENSUS_INTERVAL;

/** Amendment 1: evaluates the exploration from the registered jobs and the exploration's own. */
export function evaluateExploration(inp: ExplorationInput): ExplorationResult {
  const pr = new Problems();
  const notes: string[] = [];
  const analyze = makeAnalyzer(pr);
  const mkRung = (rung: "S0" | "V", kill: Kill): ExplorationRung => ({ rung, kill, state: "pending", label: null, row: null, voided: false, missing: [], listed: [], table: null, kappaW: null, vCal: null, horizon: null, confirm: null });
  const s0 = mkRung("S0", "removal");
  const v = mkRung("V", "vacancy");
  const res: ExplorationResult = { registered: null, spreads: null, controls: new Map(), rungs: [s0, v], vcheck: { state: "absent", detail: "no g0.vcheck job" }, horizonNeeded: false, voidMessages: [], complete: false, notes, problems: pr, jobs: [] };

  // ---- the exploration directory: only the stages and rungs of A1.2 ----
  const exp: Job[] = [];
  for (const j of inp.exploration) {
    const s = j.s;
    if (!EXPLORATION_STAGES.includes(s.stage)) {
      pr.add(2, `${s.id}: stage ${s.stage} does not belong in the exploration directory (A1.1: the registered G0.2 jobs are reused, not rerun; A1.2 runs ${EXPLORATION_STAGES.join(", ")})`);
      continue;
    }
    if (s.rung !== "S0" && s.rung !== "V") {
      pr.add(2, `${s.id}: rung ${s.rung ?? "-"} is not explored (A1.1: S0 and V on S0 only)`);
      continue;
    }
    if (s.rung === "V" && s.substrate !== null && s.substrate !== "S0") pr.add(2, `${s.id}: V ran on ${s.substrate}; Amendment 1 hosts V on S0 (A1.1)`);
    checkSettings(s, { K0: 3, types: 3, mutRate: 0 }, pr, "the exploration (Amendment 1, 3.0)");
    if (s.kill === null || s.spread === null || s.rate === null) pr.add(2, `${s.id}: an exploration job needs rung, kill, spread and rpsRate in summary.json`);
    if (s.rung === "V" && s.kill !== null && s.kill !== "vacancy") pr.add(2, `${s.id}: rung V is the vacancy kill, but the job is built with the ${s.kill} kill`);
    if (s.rung === "S0" && s.kill !== null && s.kill !== "removal" && (s.rate ?? 0) > 0) pr.add(2, `${s.id}: rung S0 is the removal kill, but the job (rate ${s.rate}) is built with the ${s.kill} kill`);
    if (s.stage === "g0.table" && s.rung === "S0" && s.rate === 0 && s.seed === SCAN_SEED) pr.add(2, `${s.id}: the rate-0 seed-401 cells are the registered scan jobs (A1.2), read from the registered directory; a second copy is not used`);
    exp.push(j);
  }

  // ---- the registered G0.2 of S0 (read-only, A1.1) ----
  const regS0 = inp.registered.filter((j) => j.s.rung === "S0" && (j.s.stage === "g0.scan" || j.s.stage === "g0.meter"));
  const reg = evaluateGate0(regS0);
  for (const p of reg.problems.list) if (p.code !== 4) pr.add(p.code, `registered G0.2: ${p.message}`);
  const s0reg = reg.rungs.find((e) => e.rung === "S0");
  if (s0reg === undefined || s0reg.levels === null) {
    pr.add(2, `the registered directory does not hold S0's complete G0.2 (scan and meter${s0reg && s0reg.missing.length > 0 ? `: ${s0reg.missing.slice(0, 3).join("; ")}${s0reg.missing.length > 3 ? "; ..." : ""}` : ""}); Amendment 1 reuses those jobs and never reruns them (A1.1)`);
    return res;
  }
  res.registered = { scan: s0reg.scan, meter: s0reg.meter, bMeter: s0reg.bMeter, gSpread: s0reg.gSpread, levels: s0reg.levels };
  if (s0reg.levels < LEVELS_MIN_EXPLORATION) {
    pr.add(3, `the registered G0.2 gives S0 ${s0reg.levels} levels, below the exploration's row 1 (levels < ${LEVELS_MIN_EXPLORATION}, A1.1): no label of A1.4 covers that`);
    return res;
  }
  if (s0reg.gSpread.join(",") !== A1_G_SPREAD.join(",")) {
    pr.add(3, `the registered G0.2 gives S0 G_spread [${s0reg.gSpread.join(", ")}], and Amendment 1 is written for [${A1_G_SPREAD.join(", ")}] (A1.1, A1.2): no label of A1.4 covers another grid`);
    return res;
  }
  const spreads = tableSpreads(s0reg.gSpread);
  res.spreads = spreads;
  const vMid = spreads[1];

  const refOf = (desc: string, job: Job | undefined, nRun: number | null, r: ExplorationRung): ExpectedJob => {
    if (!job) {
      if (!r.missing.includes(desc)) r.missing.push(desc);
      return { desc, job: null, a: null };
    }
    if (job.s.missing) {
      const l = `${job.s.id} is MISSING (failed twice)`;
      if (!r.listed.includes(l)) r.listed.push(l);
      return { desc, job, a: null };
    }
    const a = analyze(job, nRun);
    if (a && a.cls === "NOSTART" && !r.listed.includes(`${job.s.id} is NOSTART`)) r.listed.push(`${job.s.id} is NOSTART`);
    return { desc, job, a };
  };
  const findExp = (desc: string, pred: (s: JobSummary) => boolean): Job | undefined => pickOne(exp, pr, desc, pred);
  const scanOf = (sp: number): Job | undefined => pickOne(regS0, pr, `registered g0.scan S0 spread ${sp}`, (s) => s.stage === "g0.scan" && s.spread === sp && s.seed === SCAN_SEED && s.rate === 0);

  // ---- G0.3: S0 (removal) at {0, 8, 16, 32, 64}; the rate-0 seed-401 cells are the registered scan jobs ----
  const tableRef = (sp: number, rate: number, seed: number, r: ExplorationRung): ExpectedJob => {
    if (rate === 0 && seed === SCAN_SEED) return refOf(`registered g0.scan S0 spread ${sp} seed ${SCAN_SEED} (the table's rate-0 seed-401 cell)`, scanOf(sp), SHORT_RUN_CENSUSES, r);
    const desc = `g0.table S0 spread ${sp} rate ${rate} seed ${seed}`;
    return refOf(desc, findExp(desc, (s) => s.stage === "g0.table" && s.rung === "S0" && s.spread === sp && s.rate === rate && s.seed === seed), SHORT_RUN_CENSUSES, r);
  };
  const s0Refs = new Map<string, ExpectedJob[]>();
  for (const sp of spreads) for (const rate of RATES_REMOVAL) s0Refs.set(`${sp}|${rate}`, TABLE_SEEDS.map((sd) => tableRef(sp, rate, sd, s0)));
  // the controls (rate 0) are shared: V needs them too (G0.1)
  const controlRefs = spreads.map((sp) => s0Refs.get(`${sp}|0`)!);
  const controlsIn = controlRefs.every((refs) => refs.every((x) => x.job !== null));
  if (controlsIn) for (const [k, sp] of spreads.entries()) res.controls.set(sp, controlInfo(controlRefs[k].map((x) => x.a)));
  else for (const refs of controlRefs) for (const x of refs) if (x.job === null && !v.missing.includes(x.desc)) v.missing.push(`${x.desc} (shared with S0)`);
  if (s0.missing.length === 0) {
    s0.table = { spreads: [...spreads], rates: RATES_REMOVAL, cells: [] };
    for (const sp of spreads) for (const rate of RATES_REMOVAL) s0.table.cells.push(cellOf(sp, rate, s0Refs.get(`${sp}|${rate}`)!, res.controls.get(sp)!));
    const pick = kappaOf(s0.table.cells, spreads, RATES_REMOVAL);
    s0.kappaW = pick.kappaW;
    s0.vCal = pick.vCal;
  }

  // ---- the V check (G0.1, A1.2): the vacancy build of the rate-0 job at v_mid, seed 401, against the registered scan job ----
  res.vcheck = vcheckOf(exp, scanOf(vMid), vMid, inp.registeredCensus, pr);
  const vRun = exp.some((j) => j.s.rung === "V" && j.s.stage !== "g0.vcheck");
  const voidV = (m: string) => {
    pr.add(3, m);
    res.voidMessages.push(m);
  };
  if (res.vcheck.state === "different") voidV(`the V check failed (${res.vcheck.detail}): a bug in the V switch, so no V job counts (G0.1, 8.4): EXPLORATION-V-VOID`);
  else if (vRun && res.vcheck.state !== "identical") voidV(`rung V was run but the V check is ${res.vcheck.state} (${res.vcheck.detail}); G0.1 and 8.4 make that a bug indicator: EXPLORATION-V-VOID`);
  else if (res.vcheck.state === "incomplete") voidV(`the V check cannot be made (${res.vcheck.detail}), and a MISSING job is not rerun (1.3): EXPLORATION-V-VOID`);
  v.voided = res.vcheck.state === "different" || (vRun && res.vcheck.state !== "identical") || res.vcheck.state === "incomplete";
  if (res.vcheck.state === "absent" && !v.voided) v.missing.unshift(`g0.vcheck vacancy build S0 spread ${vMid} rate 0 seed ${SCAN_SEED} (the V check, A1.2)`);

  // ---- G0.3: V (vacancy) at {64, 256, 1024, 4096}; its rate-0 cells are S0's (G0.1) ----
  const vRefs = new Map<string, ExpectedJob[]>();
  for (const sp of spreads) {
    for (const rate of RATES_VACANCY.filter((q) => q > 0)) {
      vRefs.set(
        `${sp}|${rate}`,
        TABLE_SEEDS.map((sd) => {
          const desc = `g0.table V (on S0) spread ${sp} rate ${rate} seed ${sd}`;
          return refOf(desc, findExp(desc, (s) => s.stage === "g0.table" && s.rung === "V" && s.spread === sp && s.rate === rate && s.seed === sd), SHORT_RUN_CENSUSES, v);
        }),
      );
    }
  }
  // the table is read once its jobs and the shared controls are in (a V whose check is still to run is printed with its table, but has no label yet)
  if (controlsIn && [...vRefs.values()].every((refs) => refs.every((x) => x.job !== null))) {
    v.table = { spreads: [...spreads], rates: RATES_VACANCY, cells: [] };
    for (const sp of spreads) {
      for (const rate of RATES_VACANCY) {
        if (rate === 0) v.table.cells.push(cellOf(sp, 0, controlRefs[spreads.indexOf(sp)], res.controls.get(sp)!));
        else v.table.cells.push(cellOf(sp, rate, vRefs.get(`${sp}|${rate}`)!, res.controls.get(sp)!));
      }
    }
    const pick = kappaOf(v.table.cells, spreads, RATES_VACANCY);
    v.kappaW = pick.kappaW;
    v.vCal = pick.vCal;
  }

  // ---- G0.4: once, shared, when either rung passed row 2 (a void V does not count: no V job counts) ----
  res.horizonNeeded = s0.kappaW !== null || (!v.voided && v.kappaW !== null);
  let horizon: HorizonResult | null = null;
  const hzMissing: string[] = [];
  const hzListed: string[] = [];
  if (res.horizonNeeded) {
    const hz = mkRung("S0", "removal");
    const refs = TABLE_SEEDS.map((sd) => {
      const desc = `g0.horizon S0 spread ${vMid} rate 0 seed ${sd} (shared by S0 and V)`;
      return refOf(desc, findExp(desc, (s) => s.stage === "g0.horizon" && s.rung === "S0" && s.spread === vMid && s.rate === 0 && s.seed === sd), expectedRun(HORIZON_STEPS), hz);
    });
    hzMissing.push(...hz.missing);
    hzListed.push(...hz.listed);
    if (hz.missing.length === 0) {
      horizon = horizonOfRefs(vMid, refs);
      if (horizon.Tctl === null) pr.add(3, `no horizon control is usable (all NOSTART or MISSING), so G0.4 has no value and no label of A1.4 covers it`);
    }
  } else if (exp.some((j) => j.s.stage === "g0.horizon")) notes.push("horizon jobs are present though neither rung passed row 2: they are not used (A1.2)");

  // ---- each rung's label (A1.4, the first that holds), both rungs in full ----
  const done = (r: ExplorationRung, row: 2 | 3 | 4 | 5) => {
    r.state = "done";
    r.row = row;
    r.label = LABEL_OF_ROW[row];
  };
  const settle = (r: ExplorationRung, own: (s: JobSummary) => boolean) => {
    if (r.voided) {
      r.state = "done";
      r.label = "EXPLORATION-V-VOID";
      return;
    }
    if (r.missing.length > 0 || r.table === null) return;
    if (r.kappaW === null) return done(r, 2);
    for (const m of hzMissing) r.missing.push(m);
    for (const l of hzListed) if (!r.listed.includes(l)) r.listed.push(l);
    if (horizon === null || horizon.Tctl === null) return;
    r.horizon = horizon;
    if (horizon.h0 === null) return done(r, 3);
    const h0 = horizon.h0;
    const refs = TABLE_SEEDS.map((sd) => {
      const desc = `g0.confirm ${r.rung} spread ${r.vCal} rate ${r.kappaW} seed ${sd}`;
      return refOf(desc, findExp(desc, (s) => s.stage === "g0.confirm" && own(s) && s.spread === r.vCal && s.rate === r.kappaW && s.seed === sd), expectedRun(h0), r);
    });
    if (r.missing.length > 0) return;
    r.confirm = { spread: r.vCal!, rate: r.kappaW, steps: h0, classes: refs.map((x) => x.a?.cls ?? null), nDC: refs.filter((x) => x.a?.cls === "DC").length };
    return done(r, r.confirm.nDC < 2 ? 4 : 5);
  };
  settle(s0, (s) => s.rung === "S0");
  settle(v, (s) => s.rung === "V");
  res.complete = s0.state === "done" && v.state === "done";
  for (const r of res.rungs) {
    if (r.state === "pending") pr.add(4, `the exploration is incomplete: rung ${r.rung} has ${r.missing.length} job${r.missing.length === 1 ? "" : "s"} to run${r.missing.length > 0 ? ` (${r.missing.slice(0, 3).join("; ")}${r.missing.length > 3 ? "; ..." : ""})` : ""}`);
  }

  // ---- bug indicators: the exploration's jobs with the registered S0 scans (one burn-in group spans both directories) ----
  const analysisOf = (j: Job): RunAnalysis | null => {
    if (j.rows === null || j.s.missing || j.s.stage === "g0.vcheck") return null;
    const nRun = j.s.stage === "g0.horizon" ? expectedRun(HORIZON_STEPS) : j.s.stage === "g0.confirm" ? null : SHORT_RUN_CENSUSES;
    return analyze(j, nRun);
  };
  const regScans = regS0.filter((j) => j.s.stage === "g0.scan");
  jobBugs([...exp, ...regScans], analysisOf, pr, { substrateOf: (s) => (s.rung === "V" ? "S0" : s.rung) });
  const used = spreads.map((sp) => scanOf(sp)).filter((j): j is Job => j !== undefined);
  res.jobs = [...used.map((job) => ({ job, a: analysisOf(job), source: "registered" as const })), ...exp.map((job) => ({ job, a: analysisOf(job), source: "exploration" as const }))];
  return res;
}

/**
 * The V check of G0.1 as Amendment 1 runs it (A1.2): the table's rate-0 job at `v_mid`, seed 401, with both builds, `census.tsv` byte
 * for byte. The removal build of that job is the registered scan job of the same spread and seed (the table's rate-0 seed-401 cell is
 * the scan job, G0.3), so the exploration runs the vacancy build only and compares it with the registered file. A removal-build g0.vcheck
 * job in the exploration directory, if one was run, is compared as well.
 */
export function vcheckOf(exp: readonly Job[], regScan: Job | undefined, vMid: number, census: (j: Job) => string | null, pr: Problems): VCheck {
  const checks = exp.filter((j) => j.s.stage === "g0.vcheck");
  const vac = checks.filter((j) => j.s.kill === "vacancy");
  const rem = checks.filter((j) => j.s.kill === "removal");
  for (const j of checks) {
    if (j.s.spread !== vMid || j.s.seed !== SCAN_SEED || j.s.rate !== 0) pr.add(2, `${j.s.id}: the V check is the rate-0 job at v_mid ${vMid}, seed ${SCAN_SEED} (G0.1, A1.2)`);
  }
  if (vac.length === 0) return { state: "absent", detail: "no vacancy-build g0.vcheck job" };
  if (vac.length > 1) pr.add(2, `${vac.length} vacancy-build V-check jobs: ${vac.map((j) => j.s.id).join(", ")}`);
  const vj = vac[0];
  if (vj.s.missing) return { state: "incomplete", detail: `${vj.s.id} is MISSING (failed twice)` };
  if (regScan === undefined) return { state: "incomplete", detail: `the registered scan job at spread ${vMid}, seed ${SCAN_SEED} (the removal build) is not there` };
  const vt = vj.censusText;
  const rt = census(regScan);
  if (vt === null) return { state: "incomplete", detail: `${vj.s.id} has no census.tsv` };
  if (rt === null) return { state: "incomplete", detail: `${regScan.s.id} (registered) has no census.tsv` };
  if (vt !== rt) return { state: "different", detail: `${vj.s.id} and the registered ${regScan.s.id}: census.tsv differ` };
  for (const r of rem) {
    if (r.censusText !== rt) return { state: "different", detail: `${r.s.id} (removal build) and the registered ${regScan.s.id}: census.tsv differ` };
  }
  return { state: "identical", detail: `${vj.s.id} and the registered ${regScan.s.id}${rem.length > 0 ? ` (and ${rem.map((r) => r.s.id).join(", ")})` : ""}: census.tsv identical byte for byte` };
}
