// Rule draft 3.0 (Gate 0), 3.1 (the mobility meter): the pilot that sets the operating point, applied mechanically to the per-job
// files of the Gate-0 driver (stages `g0.*`, Appendix B). Pure: readout.ts loads the jobs.
//
// Rungs S0, S1 and S2 are substrates; V is the vacancy kill on the substrate of the first of S0, S1, S2 that passes row 1 and shares
// that rung's rate-0 jobs. A rung's jobs carry `rung` (and `kill`); a rate-0 job counts for its substrate whichever kill built it.

import {
  CHI_CONTROL,
  CENSUS_INTERVAL,
  Problems,
  attemptBugs,
  checkSettings,
  jobBugs,
  keepsLabels,
  makeAnalyzer,
  medianLower,
  medianMean,
  pickOne,
  type Job,
  type JobSummary,
  type Kill,
  type Rung,
  type RunAnalysis,
  type RunClass,
  type SubstrateRung,
} from "./readout-jobs.ts";

// ---- the fixed tables of 3.0 ----

/** Candidate spreads of G0.2. */
export const CANDIDATE_SPREADS: readonly number[] = [2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32];
export const SCAN_SEED = 401;
export const TABLE_SEEDS: readonly number[] = [401, 402, 403];
export const DENSE_SEED = 404;
export const METER_SEED_GATE0 = 405;
export const METER_SEED = 205;
/** Rate grids of G0.3: removal (S0 to S2) and the vacancy kill (V, G0.1). */
export const RATES_REMOVAL: readonly number[] = [0, 8, 16, 32, 64];
export const RATES_VACANCY: readonly number[] = [0, 64, 256, 1024, 4096];
/** Run censuses of the 20,000-step jobs (scan, table). */
export const SHORT_RUN_CENSUSES = 20_000 / CENSUS_INTERVAL;
export const HORIZON_STEPS = 200_000;
/** Candidate horizons of G0.4, largest first. */
export const HORIZONS: readonly number[] = [200_000, 100_000, 50_000];
export const GRID_RATIO = 1.3;
export const GRID_FLOOR = 0.005;
export const GRID_MAX = 8;
export const LEVELS_MIN = 5;
export const FLAT_DLAB = 0.005;
export const ORDER_RATIO = 1.3;
/** `R_cal` at rung V is capped here (G0.1). */
export const RCAL_CAP_V = 16_384;
export const RUNG_ORDER: readonly Rung[] = ["S0", "S1", "S2", "V"];
/** Matter scale `s` of the substrate rungs (G0.1): the divisor of the mutation rates of 7.2. */
export const SUBSTRATE_SCALE: Readonly<Record<SubstrateRung, number>> = { S0: 1, S1: 4, S2: 8 };

// ---- the mobility meter (3.1) ----

/** `D = pi W^2 / (8 t)`, with `W = sum over lines of m (1 - m)` and `t` the steps run (3.1). */
export function mixingIndex(W: number, t: number): number {
  return (Math.PI * W * W) / (8 * t);
}

export interface MeterPoint {
  spread: number;
  Dx: number | null;
  Dy: number | null;
  /** `(Dx + Dy) / 2`; null while an axis is missing. */
  Dlab: number | null;
  /** `max / min` of the two axes (Infinity if one is 0 and the other is not, 1 if both are 0). */
  ratio: number | null;
  /** The axes differ by more than a factor 2, or exactly one is 0. */
  anisotropic: boolean;
  /** `D_lab < 0.005`. */
  flat: boolean;
  /** `B_meter` the job recorded, if any. */
  bMeter: number | null;
}

function axisD(j: Job, axis: "x" | "y"): number | null {
  const m = j.s.meter;
  if (!m) return null;
  const direct = axis === "x" ? m.Dx : m.Dy;
  if (direct !== null) return direct;
  const W = axis === "x" ? (m.Wx ?? (m.axis === "x" ? m.W : null)) : (m.Wy ?? (m.axis === "y" ? m.W : null));
  const t = m.t ?? j.s.steps;
  if (W === null || t === null || t <= 0) return null;
  return mixingIndex(W, t);
}

/** The meter point of one spread from its meter job(s): one record per axis, or one record with both. */
export function meterPoint(spread: number, jobs: readonly Job[]): MeterPoint {
  let Dx: number | null = null;
  let Dy: number | null = null;
  let bMeter: number | null = null;
  for (const j of jobs) {
    Dx = Dx ?? axisD(j, "x");
    Dy = Dy ?? axisD(j, "y");
    bMeter = bMeter ?? j.s.meter?.bMeter ?? null;
  }
  const Dlab = Dx !== null && Dy !== null ? (Dx + Dy) / 2 : null;
  let ratio: number | null = null;
  let anisotropic = false;
  if (Dx !== null && Dy !== null) {
    const hi = Math.max(Dx, Dy);
    const lo = Math.min(Dx, Dy);
    ratio = hi === 0 ? 1 : lo === 0 ? Infinity : hi / lo;
    anisotropic = hi > 2 * lo;
  }
  return { spread, Dx, Dy, Dlab, ratio, anisotropic, flat: Dlab !== null && Dlab < FLAT_DLAB, bMeter };
}

/**
 * The grid rule of G0.2: scanning the carpet spreads in increasing order, `G_spread` takes the first and then each `v` with
 * `D_lab(v) >= max(1.3 D_lab(last taken), 0.005)`, keeping at most 8.
 */
export function gridRule(carpetSpreads: readonly number[], dlab: ReadonlyMap<number, number>): number[] {
  const G: number[] = [];
  for (const v of [...carpetSpreads].sort((a, b) => a - b)) {
    if (G.length >= GRID_MAX) break;
    if (G.length === 0) {
      G.push(v);
      continue;
    }
    const last = dlab.get(G[G.length - 1])!;
    if ((dlab.get(v) ?? -Infinity) >= Math.max(GRID_RATIO * last, GRID_FLOOR)) G.push(v);
  }
  return G;
}

// ---- rates, calibration rates, horizon ----

/** `R_cal` of the Gate-0 record: `{kappa_w / 2, kappa_w, 2 kappa_w, 4 kappa_w}`, each rounded to an integer of at least 1 (capped at 16,384 at rung V). */
export function rCalOf(kappaW: number, vacancy: boolean): number[] {
  const rounded = [kappaW / 2, kappaW, 2 * kappaW, 4 * kappaW].map((x) => Math.max(1, Math.round(x)));
  const capped = vacancy ? rounded.map((x) => Math.min(RCAL_CAP_V, x)) : rounded;
  return [...new Set(capped)].sort((a, b) => a - b);
}

/** `h0`: the largest of 200,000, 100,000 and 50,000 that is at most `T_ctl / 4`; null (none) if `T_ctl / 4` is below 50,000. */
export function horizonOf(Tctl: number): number | null {
  for (const h of HORIZONS) if (h <= Tctl / 4) return h;
  return null;
}

/** The registered step budgets of 1.2 from `h0` and the dense rate of G0.6 (below 600 steps/s the reduced schedule halves them at most). */
export function scheduleOf(h0: number, denseRate: number): { tEnd: number; tEnd7: number; reduced: boolean } {
  const reduced = denseRate < 600;
  const tEnd = Math.min(h0, reduced ? 100_000 : 200_000);
  return { tEnd, tEnd7: Math.min(5 * tEnd, 1_000_000), reduced };
}

// ---- per-spread control information (the sense of 4.2) ----

export interface ControlInfo {
  /** Finished (not NOSTART, not MISSING, usable) rate-0 jobs. */
  finished: number;
  /** Of those, alive with `coexist` at every census of the final window. */
  keeps: number;
  /** Median `|chi_fw|` of the finished controls (the mean of the two middle values for an even count). */
  medAbsChi: number | null;
  /** At least 2 finished, at least 2 of them keep every label, and the median `|chi_fw|` is at most 0.1. */
  informative: boolean;
}

/** `informative` of 4.2 / G0.3 for a spread's rate-0 jobs (NOSTART jobs are excluded from every count). */
export function controlInfo(analyses: readonly (RunAnalysis | null)[]): ControlInfo {
  const fin = analyses.filter((a): a is RunAnalysis => a !== null && a.cls !== "NOSTART");
  const keeps = fin.filter(keepsLabels).length;
  const med = fin.length === 0 ? null : medianMean(fin.map((a) => Math.abs(a.chiFw)));
  return { finished: fin.length, keeps, medAbsChi: med, informative: fin.length >= 2 && keeps >= 2 && med !== null && med <= CHI_CONTROL };
}

// ---- rung evaluation ----

export type VerdictName = "GO" | "NO-GO: LEVELS" | "NO-GO: EFFECT" | "NO-GO: HORIZON" | "NO-GO: CONFIRM";

/** The verdict table of 3.0 for given inputs (rows 1 to 5, the first that holds). Row 1 is skipped for V, which takes its substrate's. */
export function verdictRow(i: { levels: number | null; kappaW: number | null; h0: number | null; confirmDC: number | null }): { row: 1 | 2 | 3 | 4 | 5; verdict: VerdictName } {
  if (i.levels !== null && i.levels < LEVELS_MIN) return { row: 1, verdict: "NO-GO: LEVELS" };
  if (i.kappaW === null) return { row: 2, verdict: "NO-GO: EFFECT" };
  if (i.h0 === null) return { row: 3, verdict: "NO-GO: HORIZON" };
  if ((i.confirmDC ?? 0) < 2) return { row: 4, verdict: "NO-GO: CONFIRM" };
  return { row: 5, verdict: "GO" };
}

/** One expected job of a table cell, the horizon or the confirmation: the job found (null while it is to run) and its analysis. */
export interface ExpectedJob {
  desc: string;
  job: Job | null;
  a: RunAnalysis | null;
}

export interface ScanRow {
  spread: number;
  cls: RunClass | null;
  carpet: boolean;
  livMin: number | null;
  massPerCell: number | null;
  stepsPerSec: number | null;
  id: string | null;
  missingMarked: boolean;
}

export interface TableCell {
  spread: number;
  rate: number;
  classes: (RunClass | "MISSING" | null)[];
  nDC: number;
  /** `rate > 0`, at least 2 of 3 jobs DC, and the spread's rate-0 jobs informative. */
  works: boolean;
}

export interface HorizonResult {
  spread: number;
  /** Per job: the run step of the first sustained loss (EXT: the stop step), Infinity for a job that keeps every label. */
  tctl: (number | null)[];
  classes: (RunClass | null)[];
  Tctl: number | null;
  h0: number | null;
  /** Shape of the horizon jobs, for the record. */
  shape: string | null;
}

export interface ConfirmResult {
  spread: number;
  rate: number;
  steps: number;
  classes: (RunClass | null)[];
  nDC: number;
}

export interface RungEval {
  rung: Rung;
  /** The substrate the rung's jobs ran on (itself for S0 to S2). */
  substrate: SubstrateRung | null;
  kill: Kill;
  /** `done`: a verdict row holds; `pending`: jobs are still to run (see `missing`). */
  state: "pending" | "done";
  /** Rung V only: the V check is not identical although V jobs ran, so "no V job counts" (G0.1): the verdict is printed and never decides. */
  voided: boolean;
  /**
   * The rung whose GO makes this one unnecessary, for a rung that still has jobs to run (3.0: the rungs run in the order S0, S1, S2, V
   * and the rungs after the first GO are not run), else null. Its `missing` jobs are then not asked for.
   */
  notRun: Rung | null;
  row: 1 | 2 | 3 | 4 | 5 | null;
  verdict: VerdictName | null;
  /** Jobs of the stage that is not complete (what to run next). */
  missing: string[];
  /** Jobs marked MISSING (failed twice) and NOSTART jobs, listed for the record. */
  listed: string[];
  scan: ScanRow[];
  meter: MeterPoint[];
  bMeter: number | null;
  gSpread: number[];
  levels: number | null;
  controls: Map<number, ControlInfo>;
  table: { spreads: number[]; rates: readonly number[]; cells: TableCell[] } | null;
  kappaW: number | null;
  vCal: number | null;
  horizon: HorizonResult | null;
  confirm: ConfirmResult | null;
}

export interface OperatingPoint {
  rung: Rung;
  kill: Kill;
  /** The substrate the rung ran on (the rung itself unless V). */
  substrate: SubstrateRung;
  gSpread: number[];
  vCal: number;
  kappaW: number;
  rCal: number[];
  h0: number;
  shape: [number, number, number] | null;
  /** The dense rate of G0.6 (idle M3 Pro), null until measured. */
  denseRate: number | null;
  /** The kill-rate calibration's `kappa*`, added after 3.2. */
  kappaStar?: number | null;
}

export interface VCheck {
  /** `absent`: no V check job; `incomplete`: only one of the two builds; `identical` / `different`: the census files compared byte for byte. */
  state: "absent" | "incomplete" | "identical" | "different";
  detail: string;
}

export interface HorizonRungResult {
  rung: Rung;
  state: "pending" | "done";
  missing: string[];
  horizon: HorizonResult | null;
}

export interface Gate0Result {
  rungs: RungEval[];
  vcheck: VCheck;
  /** `go`: the rung used (first of S0, S1, S2, V with GO); `stop`: GATE-0-STOP; `pending`: a rung that could still change the answer has jobs to run. */
  overall: { status: "go"; used: Rung } | { status: "stop"; onlyHorizon: boolean; horizonRung: HorizonRungResult | null } | { status: "pending"; waitingFor: Rung[] };
  operatingPoint: OperatingPoint | null;
  dense: { stepsPerSec: number; host: string | null; device: string | null; id: string } | null;
  notes: string[];
  problems: Problems;
  /** Every Gate-0 job with its class (the list of 8.5). */
  jobs: { job: Job; a: RunAnalysis | null }[];
}

// ---- the per-cell readings of G0.3 and G0.4 (shared with the exploration of Amendment 1, readout-exploration.ts) ----

/** `v_lo`, `v_mid`, `v_hi` of G0.3: the lowest, the median (the lower middle for an even count) and the highest spread of `G_spread`. */
export const tableSpreads = (g: readonly number[]): [number, number, number] => [g[0], g[(g.length - 1) >> 1], g[g.length - 1]];

/** A cell of G0.3: it works iff `rate > 0`, at least 2 of its 3 jobs are DC and the spread's rate-0 jobs are informative. */
export const cellOf = (spread: number, rate: number, refs: readonly ExpectedJob[], ctl: ControlInfo): TableCell => {
  const classes = refs.map((x) => (x.job?.s.missing ? ("MISSING" as const) : (x.a?.cls ?? null)));
  const nDC = refs.filter((x) => x.a?.cls === "DC").length;
  return { spread, rate, classes, nDC, works: rate > 0 && nDC >= 2 && ctl.informative };
};

/** `kappa_w`: the smallest nonzero rate that works at 2 or more of the three spreads, and `v_cal`: the median (lower middle) of the spreads where it works. */
export const kappaOf = (cells: readonly TableCell[], spreads: readonly number[], rates: readonly number[]): { kappaW: number | null; vCal: number | null } => {
  for (const rate of rates.filter((q) => q > 0).sort((a, b) => a - b)) {
    const at = spreads.filter((v) => cells.some((c) => c.spread === v && c.rate === rate && c.works));
    if (at.length >= 2) return { kappaW: rate, vCal: medianLower(at) };
  }
  return { kappaW: null, vCal: null };
};

/** G0.4 from its three controls: the first sustained loss per job (EXT, LOSS), `T_ctl` (lower middle, a job that keeps every label counting as infinite) and `h0`. */
export const horizonOfRefs = (spread: number, refs: readonly ExpectedJob[]): HorizonResult => {
  const tctl = refs.map((x) => {
    const a = x.a;
    if (a === null || a.cls === "NOSTART") return null;
    if (a.cls === "EXT" || a.cls === "LOSS") return a.tcx as number;
    return Infinity;
  });
  const usable = tctl.filter((t): t is number => t !== null);
  const Tctl = usable.length === 0 ? null : medianLower(usable);
  const dims = refs.find((x) => x.job?.s.dims)?.job?.s.dims;
  return { spread, tctl, classes: refs.map((x) => x.a?.cls ?? null), Tctl, h0: Tctl === null ? null : horizonOf(Tctl), shape: dims ? `${dims.W}x${dims.H}x${dims.D}` : null };
};

const isG0 = (s: JobSummary) => s.stage.startsWith("g0.");

/** The substrate rung a job counts for: its own rung, or for a rung-V job the substrate it records or `hostOfV`. */
function substrateOf(s: JobSummary, hostOfV: SubstrateRung | null): SubstrateRung | null {
  if (s.rung === "V") return s.substrate ?? hostOfV;
  return s.rung;
}

/** Sections 3.0: evaluates Gate 0 from the loaded jobs. */
export function evaluateGate0(allJobs: readonly Job[]): Gate0Result {
  const pr = new Problems();
  const notes: string[] = [];
  const jobs = allJobs.filter((j) => isG0(j.s));
  const analyze = makeAnalyzer(pr);
  for (const j of jobs) {
    const s = j.s;
    // 3.0 Procedure: every job has `mutRate` 0 and `rpsTypes` 3 (K0 3); the meter's inert world has no founders
    checkSettings(s, s.stage === "g0.meter" ? { mutRate: 0 } : { K0: 3, types: 3, mutRate: 0 }, pr, "Gate 0");
    // a rung-V job is built with the vacancy kill; a job of a substrate rung at a nonzero rate with the removal kill (a rate-0 job is the
    // same under both kills, so a shared one may carry either)
    if (s.stage !== "g0.meter" && s.kill !== null && s.rung !== null) {
      if (s.rung === "V" && s.kill !== "vacancy") pr.add(2, `${s.id}: rung V is the vacancy kill, but the job is built with the ${s.kill} kill`);
      if (s.rung !== "V" && s.kill !== "removal" && (s.rate ?? 0) > 0) pr.add(2, `${s.id}: rung ${s.rung} is the removal kill, but the job (rate ${s.rate}) is built with the ${s.kill} kill`);
    }
    if (s.stage === "g0.meter" || s.stage === "g0.vcheck") {
      if (s.stage === "g0.meter" && (s.rung === null || s.spread === null)) pr.add(2, `${s.id}: a Gate-0 meter job needs rung and spread in summary.json`);
      continue;
    }
    if (s.rung === null || s.kill === null || s.spread === null || s.rate === null) {
      pr.add(2, `${s.id}: a Gate-0 job needs rung, kill, spread and rpsRate in summary.json`);
    }
  }

  /** Looks for the jobs of a rung's expected cell; `hostOfV` resolves rung-V jobs that carry no substrate. */
  const ctx = { hostOfV: null as SubstrateRung | null };

  const find = (desc: string, pred: (s: JobSummary) => boolean): Job | undefined => pickOne(jobs, pr, desc, pred, (s) => s.rung !== "V");
  const expectedRun = (steps: number) => steps / CENSUS_INTERVAL;
  const refOf = (desc: string, job: Job | undefined, nRun: number | null, missing: string[], listed: string[]): ExpectedJob => {
    if (!job) {
      missing.push(desc);
      return { desc, job: null, a: null };
    }
    if (job.s.missing) {
      listed.push(`${job.s.id} is MISSING (failed twice)`);
      return { desc, job, a: null };
    }
    const a = analyze(job, nRun);
    if (a && a.cls === "NOSTART") listed.push(`${job.s.id} is NOSTART`);
    return { desc, job, a };
  };

  // ---- substrate rungs ----
  const evalSubstrate = (r: SubstrateRung): RungEval => {
    const missing: string[] = [];
    const listed: string[] = [];
    const ev: RungEval = {
      rung: r,
      substrate: r,
      kill: "removal",
      state: "pending",
      voided: false,
      notRun: null,
      row: null,
      verdict: null,
      missing,
      listed,
      scan: [],
      meter: [],
      bMeter: null,
      gSpread: [],
      levels: null,
      controls: new Map(),
      table: null,
      kappaW: null,
      vCal: null,
      horizon: null,
      confirm: null,
    };
    // G0.2 scan
    const scanRefs = CANDIDATE_SPREADS.map((v) =>
      refOf(`g0.scan ${r} spread ${v} seed ${SCAN_SEED}`, find(`g0.scan ${r} spread ${v}`, (s) => s.stage === "g0.scan" && substrateOf(s, ctx.hostOfV) === r && s.spread === v && s.seed === SCAN_SEED && s.rate === 0), SHORT_RUN_CENSUSES, missing, listed),
    );
    ev.scan = scanRefs.map((x, k) => ({
      spread: CANDIDATE_SPREADS[k],
      cls: x.a?.cls ?? null,
      carpet: x.a !== null && x.a.cls !== "NOSTART" && x.a.carpetAll,
      livMin: x.a && x.a.rows.length > 0 ? Math.min(...x.a.rows.map((q) => q.liv)) : null,
      massPerCell: x.a?.massPerCell ?? null,
      stepsPerSec: x.job?.s.stepsPerSec ?? null,
      id: x.job?.s.id ?? null,
      missingMarked: x.job?.s.missing ?? false,
    }));
    if (missing.length > 0) return ev;
    const carpets = ev.scan.filter((x) => x.carpet);
    const masses = carpets.map((x) => x.massPerCell).filter((m): m is number => m !== null);
    ev.bMeter = masses.length === 0 ? null : Math.round(medianMean(masses));
    // G0.2 meter, for the carpet spreads (the grid rule looks at no other)
    const dlab = new Map<number, number>();
    for (const c of carpets) {
      const mjobs = jobs.filter((j) => j.s.stage === "g0.meter" && substrateOf(j.s, ctx.hostOfV) === r && j.s.spread === c.spread && j.s.seed === METER_SEED_GATE0);
      const mp = meterPoint(c.spread, mjobs);
      ev.meter.push(mp);
      if (mp.Dlab === null) {
        // a meter job that failed twice (a MISSING marker) is not to be run again (1.3, 8.1) and leaves its spread without D_lab: no row covers it (G0.2)
        const dead = mjobs.filter((j) => j.s.missing).map((j) => j.s.id);
        if (dead.length > 0) pr.add(3, `${dead.join(", ")}: the meter job of carpet spread ${c.spread} is MISSING (failed twice), so D_lab is unavailable for it; no row of 3.0 covers that (G0.2), and the main session decides by amendment (8.3)`);
        missing.push(`g0.meter ${r} spread ${c.spread} seed ${METER_SEED_GATE0} (x and y stripes)${dead.length > 0 ? ": a MISSING marker is there, not to be rerun" : ""}`);
      } else dlab.set(c.spread, mp.Dlab);
      if (mp.bMeter !== null && ev.bMeter !== null && mp.bMeter !== ev.bMeter) notes.push(`${r} spread ${c.spread}: the meter ran with B_meter ${mp.bMeter}, the rule gives ${ev.bMeter}`);
    }
    if (missing.length > 0) return ev;
    ev.gSpread = gridRule(
      carpets.map((c) => c.spread),
      dlab,
    );
    ev.levels = ev.gSpread.length;
    if (ev.levels < LEVELS_MIN) return finish(ev, verdictRow({ levels: ev.levels, kappaW: null, h0: null, confirmDC: null }));
    // G0.3 table (substrate part; rate-0 jobs are shared with V)
    const [vLo, vMid, vHi] = tableSpreads(ev.gSpread);
    const rates = RATES_REMOVAL;
    ev.table = { spreads: [vLo, vMid, vHi], rates, cells: [] };
    const tableJob = (v: number, rate: number, seed: number): ExpectedJob => {
      const desc = `g0.table ${r} spread ${v} rate ${rate} seed ${seed}`;
      const own = (s: JobSummary) => substrateOf(s, ctx.hostOfV) === r && s.rung !== "V" && s.spread === v && s.rate === rate && s.seed === seed;
      // the rate-0 seed-401 cell of the table is the scan job of the same spread when the driver ran it once
      const job = find(desc, (s) => s.stage === "g0.table" && own(s)) ?? (rate === 0 && seed === SCAN_SEED ? find(desc, (s) => s.stage === "g0.scan" && own(s)) : undefined);
      return refOf(desc, job, SHORT_RUN_CENSUSES, missing, listed);
    };
    const cellRefs = new Map<string, ExpectedJob[]>();
    for (const v of ev.table.spreads) for (const rate of rates) cellRefs.set(`${v}|${rate}`, TABLE_SEEDS.map((sd) => tableJob(v, rate, sd)));
    if (missing.length > 0) return ev;
    for (const v of ev.table.spreads) ev.controls.set(v, controlInfo(cellRefs.get(`${v}|0`)!.map((x) => x.a)));
    for (const v of ev.table.spreads) for (const rate of rates) ev.table.cells.push(cellOf(v, rate, cellRefs.get(`${v}|${rate}`)!, ev.controls.get(v)!));
    const pick = kappaOf(ev.table.cells, ev.table.spreads, rates);
    ev.kappaW = pick.kappaW;
    ev.vCal = pick.vCal;
    if (pick.kappaW === null) return finish(ev, verdictRow({ levels: ev.levels, kappaW: null, h0: null, confirmDC: null }));
    // G0.4 horizon (shared with V)
    const hz = horizonStage(r, vMid, missing, listed);
    ev.horizon = hz;
    if (missing.length > 0) return ev;
    if (hz === null || hz.Tctl === null) {
      pr.add(3, `${r}: no horizon control is usable (all NOSTART or MISSING), so G0.4 has no value and no row of 3.0 covers it`);
      return ev;
    }
    if (hz.h0 === null) return finish(ev, verdictRow({ levels: ev.levels, kappaW: pick.kappaW, h0: null, confirmDC: null }));
    // G0.5 confirmation
    ev.confirm = confirmStage(`${r}`, (s) => substrateOf(s, ctx.hostOfV) === r && s.rung !== "V", pick.vCal!, pick.kappaW, hz.h0, missing, listed);
    if (missing.length > 0) return ev;
    return finish(ev, verdictRow({ levels: ev.levels, kappaW: pick.kappaW, h0: hz.h0, confirmDC: ev.confirm!.nDC }));
  };

  const finish = (ev: RungEval, v: { row: 1 | 2 | 3 | 4 | 5; verdict: VerdictName }): RungEval => {
    ev.state = "done";
    ev.row = v.row;
    ev.verdict = v.verdict;
    return ev;
  };

  const horizonStage = (r: SubstrateRung, vMid: number, missing: string[], listed: string[]): HorizonResult | null => {
    const refs = TABLE_SEEDS.map((sd) =>
      refOf(
        `g0.horizon ${r} spread ${vMid} rate 0 seed ${sd}`,
        find(`g0.horizon ${r} spread ${vMid} seed ${sd}`, (s) => s.stage === "g0.horizon" && substrateOf(s, ctx.hostOfV) === r && s.spread === vMid && s.rate === 0 && s.seed === sd),
        expectedRun(HORIZON_STEPS),
        missing,
        listed,
      ),
    );
    if (refs.some((x) => x.job === null)) return null;
    return horizonOfRefs(vMid, refs);
  };

  const confirmStage = (label: string, own: (s: JobSummary) => boolean, vCal: number, rate: number, h0: number, missing: string[], listed: string[]): ConfirmResult => {
    const refs = TABLE_SEEDS.map((sd) =>
      refOf(
        `g0.confirm ${label} spread ${vCal} rate ${rate} seed ${sd}`,
        find(`g0.confirm ${label} spread ${vCal} rate ${rate} seed ${sd}`, (s) => s.stage === "g0.confirm" && own(s) && s.spread === vCal && s.rate === rate && s.seed === sd),
        expectedRun(h0),
        missing,
        listed,
      ),
    );
    return { spread: vCal, rate, steps: h0, classes: refs.map((x) => x.a?.cls ?? null), nDC: refs.filter((x) => x.a?.cls === "DC").length };
  };

  // ---- evaluate S0, S1, then S2 when both ended LEVELS ----
  const evals = new Map<Rung, RungEval>();
  evals.set("S0", evalSubstrate("S0"));
  evals.set("S1", evalSubstrate("S1"));
  const levelsOut = (r: Rung) => evals.get(r)?.state === "done" && evals.get(r)?.verdict === "NO-GO: LEVELS";
  const s2Needed = levelsOut("S0") && levelsOut("S1");
  if (s2Needed) evals.set("S2", evalSubstrate("S2"));
  else if (jobs.some((j) => j.s.rung === "S2")) notes.push("S2 jobs are present but S2 is run only after S0 and S1 both end NO-GO: LEVELS; they are not used");

  // ---- V ----
  // the host is the first of S0, S1, S2 that passes row 1 (levels at least 5); it is undecided while a rung before it has its scan or meter to run
  let host: SubstrateRung | null = null;
  let hostPending = false;
  for (const r of ["S0", "S1", "S2"] as const) {
    const e = evals.get(r);
    if (!e) continue; // S2 is evaluated only when S0 and S1 both ended LEVELS
    if (e.levels === null) {
      hostPending = true;
      break;
    }
    if (e.levels >= LEVELS_MIN) {
      host = r;
      break;
    }
  }
  ctx.hostOfV = host;
  let vEval: RungEval | null = null;
  const vJobs = jobs.filter((j) => j.s.rung === "V");
  if (host !== null && !hostPending) {
    vEval = evalV(host);
  } else if (vJobs.length > 0 && host === null && !hostPending) {
    pr.add(3, "rung V jobs are present but no substrate rung passed row 1 (levels at least 5): V has no substrate, and no row of 3.0 covers it");
  }

  function evalV(h: SubstrateRung): RungEval {
    const hostEval = evals.get(h)!;
    const missing: string[] = [];
    const listed: string[] = [];
    const ev: RungEval = {
      rung: "V",
      substrate: h,
      kill: "vacancy",
      state: "pending",
      voided: false,
      notRun: null,
      row: null,
      verdict: null,
      missing,
      listed,
      scan: hostEval.scan,
      meter: hostEval.meter,
      bMeter: hostEval.bMeter,
      gSpread: hostEval.gSpread,
      levels: hostEval.levels,
      controls: hostEval.controls,
      table: null,
      kappaW: null,
      vCal: null,
      horizon: null,
      confirm: null,
    };
    const hostTable = hostEval.table;
    if (hostTable === null || hostEval.controls.size < hostTable.spreads.length) {
      missing.push(`the table of ${h} (its rate-0 jobs are shared with V)`);
      return ev;
    }
    for (const j of vJobs) {
      if (j.s.substrate !== null && j.s.substrate !== h) pr.add(3, `${j.s.id}: V ran on ${j.s.substrate}, the first rung to pass row 1 is ${h} (no row of 3.0 covers a V on another substrate)`);
    }
    const rates = RATES_VACANCY;
    ev.table = { spreads: hostTable.spreads, rates, cells: [] };
    const vRef = (v: number, rate: number, seed: number): ExpectedJob =>
      refOf(
        `g0.table V (on ${h}) spread ${v} rate ${rate} seed ${seed}`,
        find(`g0.table V spread ${v} rate ${rate} seed ${seed}`, (s) => s.stage === "g0.table" && s.rung === "V" && s.spread === v && s.rate === rate && s.seed === seed),
        SHORT_RUN_CENSUSES,
        missing,
        listed,
      );
    const refs = new Map<string, ExpectedJob[]>();
    for (const v of hostTable.spreads) for (const rate of rates.filter((q) => q > 0)) refs.set(`${v}|${rate}`, TABLE_SEEDS.map((sd) => vRef(v, rate, sd)));
    if (missing.length > 0) return ev;
    for (const v of hostTable.spreads) {
      for (const rate of rates) {
        if (rate === 0) {
          const hc = hostTable.cells.find((c) => c.spread === v && c.rate === 0);
          if (hc) ev.table.cells.push(hc);
        } else ev.table.cells.push(cellOf(v, rate, refs.get(`${v}|${rate}`)!, hostEval.controls.get(v)!));
      }
    }
    const pick = kappaOf(ev.table.cells, hostTable.spreads, rates);
    ev.kappaW = pick.kappaW;
    ev.vCal = pick.vCal;
    if (pick.kappaW === null) return finish(ev, verdictRow({ levels: null, kappaW: null, h0: null, confirmDC: null }));
    // G0.4: the substrate's jobs, shared; run when either has passed rows 1 and 2
    const hz = horizonStage(h, hostTable.spreads[1], missing, listed);
    ev.horizon = hz;
    if (missing.length > 0) return ev;
    if (hz === null || hz.Tctl === null) {
      pr.add(3, `V (on ${h}): no horizon control is usable (all NOSTART or MISSING), so G0.4 has no value and no row of 3.0 covers it`);
      return ev;
    }
    if (hz.h0 === null) return finish(ev, verdictRow({ levels: null, kappaW: pick.kappaW, h0: null, confirmDC: null }));
    ev.confirm = confirmStage("V", (s) => s.rung === "V", pick.vCal!, pick.kappaW, hz.h0, missing, listed);
    if (missing.length > 0) return ev;
    return finish(ev, verdictRow({ levels: null, kappaW: pick.kappaW, h0: hz.h0, confirmDC: ev.confirm!.nDC }));
  }
  if (vEval) evals.set("V", vEval);

  // ---- the V check (8.4) ----
  // The two V-check jobs are not V jobs "run" (a half-finished check is not a V that ran without its check).
  const vRun = vJobs.some((j) => j.s.stage !== "g0.vcheck");
  const vcheck = vCheckOf(jobs, vRun, pr);
  // "no V job counts" (G0.1): when V ran and its check is not identical (a failed check is a bug in the V switch; a missing one leaves
  // the V build unverified), V's verdict is printed and flagged, and never decides
  if (vEval !== null && vRun && vcheck.state !== "identical") vEval.voided = true;

  // ---- overall: the first rung of S0, S1, S2, V with GO ----
  const rungs = RUNG_ORDER.flatMap((r) => (evals.has(r) ? [evals.get(r)!] : []));
  const vNeeded = host !== null && !hostPending && !(vEval !== null && vEval.voided);
  const required: Rung[] = ["S0", "S1", ...(s2Needed ? (["S2"] as Rung[]) : []), ...(vNeeded ? (["V"] as Rung[]) : [])];
  let overall: Gate0Result["overall"] | null = null;
  const waiting: Rung[] = [];
  // 3.0 (decision O-8): the rungs are taken in the order S0, S1, S2, V. The answer is the highest-preference rung not yet excluded, when it
  // gives GO; a GO of a rung with a pending rung ahead of it is that rung's own verdict and not the answer yet (the overall verdict stays
  // pending), and either way the rungs after the first GO cannot change the answer and are not run.
  let firstGo: Rung | null = null;
  for (const r of required) {
    const e = evals.get(r);
    if (!e || e.state === "pending") {
      waiting.push(r);
      continue;
    }
    if (e.verdict === "GO") {
      firstGo = r;
      if (waiting.length === 0) overall = { status: "go", used: r };
      break;
    }
  }
  if (firstGo !== null) {
    for (const r of RUNG_ORDER.slice(RUNG_ORDER.indexOf(firstGo) + 1)) {
      const e = evals.get(r);
      if (e && e.state === "pending") e.notRun = firstGo;
    }
  }
  if (overall === null) {
    if (waiting.length > 0 || hostPending) overall = { status: "pending", waitingFor: waiting.length > 0 ? waiting : required.filter((r) => !evals.has(r)) };
    else {
      const failed = required.map((r) => evals.get(r)!);
      // 3.0 (decision O-1): the horizon rung is tried when every rung that passed rows 1 and 2 failed at row 3 (HORIZON). A rung that
      // failed at row 1 or 2 (LEVELS, EFFECT) is out for another reason and does not count either way; at least one rung must have reached row 3.
      const reached = failed.filter((e) => e.row !== null && e.row >= 3);
      const onlyHorizon = reached.length > 0 && reached.every((e) => e.verdict === "NO-GO: HORIZON");
      let horizonRung: HorizonRungResult | null = null;
      if (onlyHorizon) {
        const first = reached[0];
        const sub = first.rung === "V" ? first.substrate! : (first.rung as SubstrateRung);
        if (sub === "S2") {
          // 3.0: the specified founding of S2 at 256 x 256 x 4 exceeds the kernel's total-world matter bound for seeds 401 and 403, so the horizon rung is not run on S2
          notes.push(`the horizon rung is not run on S2 (3.0): its founding at 256 x 256 x 4 exceeds the kernel's total-world matter bound (seeds 401 and 403), so GATE-0-STOP stands and a dated amendment is needed before its founding or shape change`);
        } else {
          horizonRung = horizonRungStage(first.rung, sub, evals.get(sub)!);
          if (horizonRung.state === "pending") pr.add(4, `GATE-0-STOP with only HORIZON failures: the horizon rung (256 x 256 x 4, G0.4 alone, rung ${first.rung}) is to be tried: ${horizonRung.missing.join("; ")}`);
          // once its jobs are in, the horizon rung is a diagnostic: Gate 0 remains GATE-0-STOP whatever they say (3.0), a verdict and no exit 3
        }
      }
      overall = { status: "stop", onlyHorizon, horizonRung };
    }
  }

  // jobs still to run are exit 4: name the rungs that could still change the answer and what each lacks
  if (overall.status === "pending") {
    for (const r of overall.waitingFor) {
      const m = evals.get(r)?.missing ?? [];
      pr.add(4, `Gate 0 is incomplete: rung ${r} has ${m.length} job${m.length === 1 ? "" : "s"} to run${m.length > 0 ? ` (${m.slice(0, 3).join("; ")}${m.length > 3 ? "; ..." : ""})` : ""}`);
    }
    if (overall.waitingFor.length === 0) pr.add(4, "Gate 0 is incomplete");
  }

  function horizonRungStage(rung: Rung, sub: SubstrateRung, subEval: RungEval): HorizonRungResult {
    const missing: string[] = [];
    const listed: string[] = [];
    const vMid = subEval.table!.spreads[1];
    const refs = TABLE_SEEDS.map((sd) =>
      refOf(
        `g0.horizon-rung ${sub} spread ${vMid} rate 0 seed ${sd}`,
        find(`g0.horizon-rung ${sub} spread ${vMid} seed ${sd}`, (s) => s.stage === "g0.horizon-rung" && substrateOf(s, host) === sub && s.spread === vMid && s.rate === 0 && s.seed === sd),
        expectedRun(HORIZON_STEPS),
        missing,
        listed,
      ),
    );
    if (missing.length > 0) return { rung, state: "pending", missing, horizon: null };
    return { rung, state: "done", missing: [], horizon: horizonOfRefs(vMid, refs) };
  }

  // ---- operating point and the dense rate ----
  let operatingPoint: OperatingPoint | null = null;
  let dense: Gate0Result["dense"] = null;
  if (overall.status === "go") {
    const e = evals.get(overall.used)!;
    const sub = e.substrate!;
    const dims = jobs.find((j) => j.s.dims && substrateOf(j.s, host) === sub)?.s.dims ?? null;
    const vMid = e.table!.spreads[1];
    const denseJobs = jobs.filter((j) => j.s.stage === "g0.dense" && j.s.seed === DENSE_SEED && j.s.spread === vMid && (j.s.rung === e.rung || substrateOf(j.s, host) === sub));
    if (denseJobs.length > 1) pr.add(2, `${denseJobs.length} dense-rate jobs (G0.6) for rung ${e.rung}`);
    const dj = denseJobs[0];
    if (dj) {
      // G0.6: the job counts only as the dense case it names, a rate-0 carpet that ran its 20 run censuses. A job with a nonzero rate,
      // one that did not start (NOSTART: its burn-in alone, at the hand-over), stopped (EXT, LOSS: also a loss completing at census 20)
      // or is no carpet (SPARSE, or liv below 0.50 at some census) says nothing of the dense rate: it stays unavailable and no row
      // covers that (exit 3).
      const a = dj.s.missing || dj.rows === null ? null : analyze(dj, SHORT_RUN_CENSUSES);
      if (dj.s.missing) pr.add(3, `${dj.s.id}: the dense-rate job (G0.6) is MISSING (failed twice), so there is no dense rate; no row covers that, and a repeat measurement is a dated amendment (8.3)`);
      else if (dj.s.stepsPerSec === null) pr.add(2, `${dj.s.id}: the dense-rate job has no stepsPerSec`);
      else if (a === null) pr.add(2, `${dj.s.id}: the dense-rate job has no usable census.tsv, so its steps per second cannot be taken as the dense rate`);
      else if (dj.s.rate !== 0 || a.cls === "NOSTART" || a.cls === "EXT" || a.cls === "LOSS" || a.cls === "SPARSE" || a.nRun < SHORT_RUN_CENSUSES || !a.carpetAll) {
        pr.add(3, `${dj.s.id}: the dense-rate job is not the dense case G0.6 names (class ${a.cls}, ${a.nRun} of ${SHORT_RUN_CENSUSES} run censuses${a.cls === "NOSTART" ? "" : a.carpetAll ? "" : ", liv below 0.50 at some census"}${dj.s.rate !== 0 ? `, rate ${dj.s.rate} instead of 0` : ""}), so there is no dense rate; no row covers that, and a repeat measurement is a dated amendment (8.3)`);
      } else dense = { stepsPerSec: dj.s.stepsPerSec, host: dj.s.host, device: dj.s.device, id: dj.s.id };
    }
    operatingPoint = {
      rung: e.rung,
      kill: e.kill,
      substrate: sub,
      gSpread: e.gSpread,
      vCal: e.vCal!,
      kappaW: e.kappaW!,
      rCal: rCalOf(e.kappaW!, e.rung === "V"),
      h0: e.confirm!.steps,
      shape: dims ? [dims.W, dims.H, dims.D] : null,
      denseRate: dense ? dense.stepsPerSec : null,
    };
    if (dense && dense.host !== null && !/m3/i.test(dense.host) && !/m3/i.test(dense.device ?? "")) notes.push(`G0.6 ran on "${dense.host}": the rule wants the idle M3 Pro`);
  }

  // ---- bug indicators common to the stage ----
  const analysisOf = (j: Job) => {
    const nRun = j.s.stage === "g0.horizon" || j.s.stage === "g0.horizon-rung" ? expectedRun(HORIZON_STEPS) : j.s.stage === "g0.confirm" ? null : SHORT_RUN_CENSUSES;
    return j.rows !== null && !j.s.missing && j.s.stage !== "g0.vcheck" ? analyze(j, nRun) : null;
  };
  const jobList = jobs.map((job) => ({ job, a: job.s.stage === "g0.meter" ? null : analysisOf(job) }));
  jobBugs(
    jobs.filter((j) => j.s.stage !== "g0.meter"),
    analysisOf,
    pr,
    { substrateOf: (s) => (s.rung === "V" ? host : s.rung) },
  );
  attemptBugs(jobs.filter((j) => j.s.stage === "g0.meter"), pr);

  return { rungs, vcheck, overall, operatingPoint, dense, notes, problems: pr, jobs: jobList };
}

/** The V check of G0.1: one rate-0 job run with the V build and the removal build, their `census.tsv` compared byte for byte. */
export function vCheckOf(jobs: readonly Job[], vWasRun: boolean, pr: Problems): VCheck {
  const checks = jobs.filter((j) => j.s.stage === "g0.vcheck");
  const withKill = (k: Kill) => checks.filter((j) => j.s.kill === k);
  const vac = withKill("vacancy");
  const rem = withKill("removal");
  let vc: VCheck;
  if (checks.length === 0) vc = { state: "absent", detail: "no g0.vcheck job" };
  else if (vac.length !== 1 || rem.length !== 1) vc = { state: "incomplete", detail: `${vac.length} vacancy-build and ${rem.length} removal-build V-check jobs (one of each is needed)` };
  else if (vac[0].censusText === null || rem[0].censusText === null) vc = { state: "incomplete", detail: "a V-check job has no census.tsv" };
  else if (vac[0].censusText === rem[0].censusText) vc = { state: "identical", detail: `${vac[0].s.id} and ${rem[0].s.id}: census.tsv identical byte for byte` };
  else vc = { state: "different", detail: `${vac[0].s.id} and ${rem[0].s.id}: census.tsv differ` };
  if (vc.state === "different") pr.add(3, `the V check failed (${vc.detail}): a bug in the V switch, so no V job counts (8.4)`);
  else if (vWasRun && vc.state !== "identical") pr.add(3, `rung V was run but the V check is ${vc.state === "absent" ? "absent" : "incomplete"} (${vc.detail}); 8.4 makes that a bug indicator`);
  return vc;
}

/** The registered meter (3.1, seed 205) over `G_spread`: D_lab per spread and the ordering check (exit 3 if some consecutive pair falls by more than 1.3). */
export function evaluateMeter(allJobs: readonly Job[], gSpread: readonly number[]): { points: MeterPoint[]; problems: Problems } {
  const pr = new Problems();
  const points = gSpread.map((v) => {
    const mj = allJobs.filter((j) => j.s.stage === "meter" && j.s.spread === v && j.s.seed === METER_SEED);
    const p = meterPoint(v, mj);
    if (p.Dlab === null) pr.add(4, `meter jobs missing for spread ${v} (seed ${METER_SEED}, x and y stripes)`);
    return p;
  });
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1].Dlab;
    const b = points[k].Dlab;
    if (a !== null && b !== null && b < a / ORDER_RATIO) pr.add(3, `D_lab falls from ${a.toPrecision(4)} (spread ${points[k - 1].spread}) to ${b.toPrecision(4)} (spread ${points[k].spread}), by more than ${ORDER_RATIO}: the edge logic of 4.3 assumes mobility rises along G_spread (3.1)`);
  }
  return { points, problems: pr };
}
