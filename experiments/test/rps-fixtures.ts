// Synthetic jobs for the RPS readout tests: census rows with consistent n / Y / label counts, run classes on request, summary.json
// objects in the shape a driver writes, and scenario builders for Gate 0, the sweep and the mutation arms. The tests import nothing
// from runs/. Every number here is made up to land in a given row of a rule table; none is a result.

import { RPS_CENSUS_HEADER, cleanCycleLength, formatRpsCensusRow, rpsIsPresent, type RpsCensusRecord } from "@bl/metrics";
import { B_IN, normalizeSummary, type Arm, type Job, type Kill, type Rung, type Stage } from "../3d-rps/readout-jobs.ts";

export const NCELLS = 128 * 128 * 4;

/** Cyclic beats-masks of the starting ecology for a type space of K labels (label t kills t + 1 mod K). */
export const cycMasks = (K: number): number[] => Array.from({ length: 8 }, (_, t) => (t < K ? 1 << ((t + 1) % K) : 0));

export interface RowSpec {
  /** Living fraction of the world. */
  liv: number;
  /** Label shares (normalised); default equal over the first K0 labels. */
  shares?: number[];
  turnover?: number | null;
  ndom?: number | null;
  nanti?: number | null;
  modal?: number[];
  zcoh?: number | null;
  supply?: number | null;
  /** `B + P` per living cell (default 28). */
  massPerCell?: number;
}

function apportion(total: number, shares: readonly number[]): number[] {
  const sum = shares.reduce((a, b) => a + b, 0);
  const exact = shares.map((s) => (sum === 0 ? 0 : (s / sum) * total));
  const out = exact.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    if (exact[i] > 0) {
      out[i]++;
      rest--;
    }
  }
  return out;
}

/** A census row at a job step with consistent counts, `n` and `Y`. */
export function mkRecord(step: number, spec: RowSpec, K0 = 3): RpsCensusRecord {
  const living = Math.round(spec.liv * NCELLS);
  const shares = spec.shares ?? Array.from({ length: 8 }, (_, x) => (x < K0 ? 1 : 0));
  const cells = apportion(living, [...shares, ...new Array(8).fill(0)].slice(0, 8));
  const masks = spec.modal ?? cycMasks(K0);
  const modal = cells.map((c, x) => (c === 0 ? null : masks[x]));
  const present = cells.map((c) => rpsIsPresent(c, living));
  const S = present.flatMap((p, x) => (p ? [x] : []));
  return {
    phase: step <= B_IN ? "burn" : "run",
    step,
    rstep: step - B_IN,
    living,
    turnover: spec.turnover === undefined ? 0.1 : spec.turnover,
    ndom: spec.ndom === undefined ? 250 : spec.ndom,
    nanti: spec.nanti === undefined ? 50 : spec.nanti,
    zcoh: spec.zcoh === undefined ? 0.3 : spec.zcoh,
    n: S.length,
    Y: cleanCycleLength(S, modal),
    cells,
    mass: cells.map((c) => c * (spec.massPerCell ?? 28)),
    modal,
    supply: spec.supply === undefined ? null : spec.supply,
  };
}

export type ClassSpec =
  | "DC"
  | "CHURN"
  | "FC"
  | "SPARSE"
  | "LATE"
  | "NOSTART"
  | { LOSS: number }
  | { EXT: number }
  | { NOSTART: "liv" | "coexist" | "early" }
  | { custom: (k: number) => RowSpec; nRun?: number };

const DC_ROW: RowSpec = { liv: 0.9, turnover: 0.1, ndom: 250, nanti: 50 };
const CHURN_ROW: RowSpec = { liv: 0.9, turnover: 0.3, ndom: 150, nanti: 150 };
const FC_ROW: RowSpec = { liv: 0.9, turnover: 0.005, ndom: 3, nanti: 3 };
const SPARSE_ROW: RowSpec = { liv: 0.1, turnover: 0.1, ndom: 250, nanti: 50 };
const BURN_OK: RowSpec = { liv: 0.8, turnover: 0.2, ndom: 100, nanti: 100 };

/** Burn-in (6 censuses) and run rows (`nRun`, fewer when the class stops the job) for a class. */
export function rowsOf(cls: ClassSpec, nRun: number, K0 = 3, tail = false): { burn: RowSpec[]; run: RowSpec[] } {
  const burn = Array.from({ length: 6 }, () => ({ ...BURN_OK }));
  const lostShares = Array.from({ length: 8 }, (_, x) => (x < K0 - 1 ? 1 : 0));
  const run = (f: (k: number) => RowSpec, n = nRun) => Array.from({ length: n }, (_, k) => f(k));
  if (cls === "DC") return { burn, run: run(() => ({ ...DC_ROW })) };
  if (cls === "CHURN") return { burn, run: run(() => ({ ...CHURN_ROW })) };
  if (cls === "FC") return { burn, run: run(() => ({ ...FC_ROW })) };
  if (cls === "SPARSE") return { burn, run: run(() => ({ ...SPARSE_ROW })) };
  if (cls === "LATE") return { burn, run: run((k) => (k >= nRun - 2 ? { ...DC_ROW, shares: lostShares } : { ...DC_ROW })) };
  if (cls === "NOSTART") return { burn: burn.map((b, i) => (i === 5 ? { ...b, liv: 0.3 } : b)), run: run(() => ({ ...DC_ROW })) };
  if ("NOSTART" in cls) {
    const b = burn.map((r, i) => {
      if (cls.NOSTART === "liv" && i === 5) return { ...r, liv: 0.49 };
      if (cls.NOSTART === "coexist" && i === 5) return { ...r, shares: lostShares };
      if (cls.NOSTART === "early" && i === 2) return { ...r, liv: 0.005 };
      return r;
    });
    return { burn: b, run: run(() => ({ ...DC_ROW })) };
  }
  if ("LOSS" in cls) {
    const L = cls.LOSS; // 1-based run census index of the first census of the loss
    const n = tail ? nRun : L + 2;
    return { burn, run: run((k) => (k + 1 >= L ? { ...DC_ROW, shares: lostShares } : { ...DC_ROW }), n) };
  }
  if ("EXT" in cls) {
    const E = cls.EXT;
    const n = tail ? nRun : E;
    return { burn, run: run((k) => (k + 1 >= E ? { liv: 0.001, turnover: 0.1, ndom: 3, nanti: 1 } : { ...DC_ROW }), n) };
  }
  return { burn, run: run(cls.custom, cls.nRun ?? nRun) };
}

export interface MkJobOpts {
  id?: string;
  stage: Stage;
  rung?: Rung;
  kill?: Kill;
  arm?: Arm;
  substrate?: string;
  seed: number;
  spread?: number;
  rate?: number;
  K0?: number;
  /** Run censuses (default 20). */
  nRun?: number;
  cls?: ClassSpec;
  /** Run rows built by hand (overrides `cls`). */
  rows?: { burn: RowSpec[]; run: RowSpec[] };
  mutRate?: number;
  types?: number;
  flip?: number;
  edge?: number;
  /** Rows go on past the stop of the class (a driver that did not stop early). */
  tail?: boolean;
  /** Controls (rate 0) of a generated class get symmetric change counts; false keeps the class's own. */
  neutral?: boolean;
  burnHash?: string;
  residual?: string;
  matterOk?: boolean;
  stepsPerSec?: number;
  host?: string;
  /** Extra or overriding top-level fields of summary.json. */
  extra?: Record<string, unknown>;
  withFinal?: string;
}

const hashOf = (s: string): string => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(2);
};

/** summary.json as a driver would write it (both phase configs, init params, bookkeeping), plus the census.tsv text. */
export function rawJob(o: MkJobOpts): { summary: Record<string, unknown>; census: string; rows: RpsCensusRecord[] } {
  const K0 = o.K0 ?? 3;
  const nRun = o.nRun ?? 20;
  const spec = o.rows ?? rowsOf(o.cls ?? "DC", nRun, K0, o.tail ?? false);
  // a control (rate 0) has no cyclic signature: generated classes get symmetric change counts unless the rows are given
  const generated = o.rows === undefined && !(typeof o.cls === "object" && o.cls !== null && "custom" in o.cls);
  if (o.rate === 0 && generated && o.neutral !== false) spec.run = spec.run.map((r) => ({ ...r, ndom: r.ndom === null ? null : o.cls === "FC" ? 3 : 150, nanti: r.nanti === null ? null : o.cls === "FC" ? 3 : 150 }));
  const all: RpsCensusRecord[] = [
    ...spec.burn.map((r, i) => mkRecord(1000 * (i + 1), r, K0)),
    ...spec.run.map((r, i) => mkRecord(B_IN + 1000 * (i + 1), r, K0)),
  ];
  const clsKey = typeof o.cls === "object" && o.cls !== null ? Object.keys(o.cls)[0] : null;
  const stop = !o.tail && clsKey === "LOSS" ? "loss" : !o.tail && clsKey === "EXT" ? "ext" : "end";
  // the spike keeps the kill's parameters outside WorldConfig (B.3), so both builds of a rung have one config and one burn-in
  const base = { tileW: 128, tileH: 128, tileD: 4, spread: o.spread ?? 16, rpsTypes: o.types ?? 3, rpsFlip: o.flip ?? 0, rpsEdge: o.edge ?? 0 };
  const burnCfg = { ...base, rpsRate: 0, mutRate: 0 };
  const runCfg = { ...base, rpsRate: o.rate ?? 0, mutRate: o.mutRate ?? 0 };
  const init = { founders: K0, occupied: 75, columns: true };
  const summary: Record<string, unknown> = {
    id: o.id ?? `${o.stage}-${o.rung ?? "-"}${o.kill === "vacancy" ? "v" : ""}-${o.arm ?? ""}-sp${o.spread ?? 16}-r${o.rate ?? 0}-s${o.seed}`,
    stage: o.stage,
    ...(o.rung ? { rung: o.rung } : {}),
    ...(o.kill ? { kill: o.kill } : {}),
    ...(o.arm ? { arm: o.arm } : {}),
    ...(o.kill === "vacancy" ? { killParams: { form: "vacancy", note: "the spike keeps the kill outside WorldConfig" } } : {}),
    ...(o.substrate ? { substrate: o.substrate } : {}),
    seed: o.seed,
    steps: all[all.length - 1].step,
    stop,
    config: { burn: burnCfg, run: runCfg },
    init: { burn: init, run: init },
    host: o.host ?? "test-host",
    device: "test-gpu",
    stepsPerSec: o.stepsPerSec ?? 500,
    matterOk: o.matterOk ?? true,
    residual: o.residual ?? "0",
    burnHash: o.burnHash ?? hashOf(JSON.stringify([o.seed, burnCfg, init])),
    extinctAt: null,
    events: 0,
    final: o.withFinal ?? null,
    ...o.extra,
  };
  return { summary, census: RPS_CENSUS_HEADER + all.map(formatRpsCensusRow).join(""), rows: all };
}

/** A `Job` with the files it would have been loaded from (for the tests of the loader and the command line). */
export type FixtureJob = Job & { raw: { summary: Record<string, unknown>; census: string | null } };

/** A `Job` built through the same normalisation the loader uses. */
export function mkJob(o: MkJobOpts): FixtureJob {
  const { summary, rows, census } = rawJob(o);
  const s = normalizeSummary(summary, String(summary.id));
  return { s, rows, censusText: o.stage === "g0.vcheck" ? census : null, finalPath: null, dir: null, raw: { summary, census } };
}

/** The in-memory file tree of a set of fixture jobs: `<dir>/<id>/summary.json` and `census.tsv`. */
export function filesOf(jobs: readonly Job[], dir = "/jobs"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const j of jobs) {
    const raw = (j as FixtureJob).raw;
    out[`${dir}/${j.s.id}/summary.json`] = JSON.stringify(raw.summary);
    if (raw.census !== null) out[`${dir}/${j.s.id}/census.tsv`] = raw.census;
  }
  return out;
}

/** A meter job (one axis) whose `D` is `D` for `t` steps: W = sqrt(8 t D / pi). */
export function meterJob(o: { stage?: "g0.meter" | "meter"; rung?: Rung; spread: number; axis: "x" | "y"; D: number; t?: number; seed?: number; bMeter?: number; useD?: boolean }): FixtureJob {
  const t = o.t ?? 5000;
  const meter = o.useD ? { axis: o.axis, [o.axis === "x" ? "Dx" : "Dy"]: o.D } : { axis: o.axis, W: Math.sqrt((8 * t * o.D) / Math.PI), t, ...(o.bMeter !== undefined ? { bMeter: o.bMeter } : {}) };
  const raw = {
    id: `${o.stage ?? "g0.meter"}-${o.rung ?? "-"}-sp${o.spread}-${o.axis}`,
    stage: o.stage ?? "g0.meter",
    ...(o.rung ? { rung: o.rung, kill: "removal" } : {}),
    seed: o.seed ?? 405,
    steps: t,
    spread: o.spread,
    meter,
  };
  return { s: normalizeSummary(raw, raw.id), rows: null, censusText: null, finalPath: null, dir: null, raw: { summary: raw, census: null } } as FixtureJob;
}

// ---- lattice cells ----

import { LAT_CONTINGENCY_M, LAT_M, LAT_SIZES, type LatticeCell } from "../3d-rps/readout-lattice.ts";

/** P_ext(L, M) = logistic in log10 M, centred at Mc with steepness `s[L]` per decade: a larger world is steeper, so D is negative below Mc and positive above. */
export const logisticP = (Mc: number, s: Record<number, number>) => (L: number, M: number) => 1 / (1 + Math.exp(-s[L] * (Math.log10(M) - Math.log10(Mc))));
export const STEEP: Record<number, number> = { 20: 1.5, 30: 2.5, 40: 4, 60: 8, 100: 12 };

/** The main grid (4 sizes x 11 values of M, R = 600) from a function P(L, M), plus the L = 100 cells (R = 300, six values of M) when given. */
export function latticeCells(p: (L: number, M: number) => number, withL100?: (M: number) => number): LatticeCell[] {
  const out: LatticeCell[] = [];
  for (const L of LAT_SIZES) LAT_M.forEach((M, iM) => out.push({ L, iM, M, R: 600, k: Math.round(600 * p(L, M)) }));
  if (withL100) LAT_M.forEach((M, iM) => { if (LAT_CONTINGENCY_M.includes(M)) out.push({ L: 100, iM, M, R: 300, k: Math.round(300 * withL100(M)) }); });
  return out;
}

// ---- Gate 0 scenarios ----

import { RATES_REMOVAL, RATES_VACANCY, TABLE_SEEDS, CANDIDATE_SPREADS } from "../3d-rps/readout-gate0.ts";
import type { SubstrateRung } from "../3d-rps/readout-jobs.ts";

export { CANDIDATE_SPREADS };

/** What a substrate rung's Gate-0 jobs look like. `null` where a field says so leaves those jobs out (they are still to run). */
export interface RungScenario {
  rung: SubstrateRung;
  /** Spreads whose rate-0 scan is a carpet; the other candidates are sparse. */
  carpets: number[];
  /** D_lab per carpet spread (the x and y meters get this D each). */
  dlab: Record<number, number>;
  /** The grid the rule should pick; the table is placed at its first, middle and last values. */
  g: number[];
  massPerCell?: number;
  /** Classes of seeds 401 to 403 at a nonzero rate (default: rates 16 and up are DC, rate 8 is CHURN). */
  table?: ((v: number, rate: number) => ClassSpec[]) | null;
  /** Classes of seeds 401 to 403 of the rate-0 control at a spread (default CHURN). */
  control?: (v: number) => ClassSpec[];
  /** Classes of the three 200,000-step horizon controls (default CHURN: every label kept, T_ctl infinite). */
  horizon?: ClassSpec[] | null;
  /** The confirmation jobs: where, how long and what they are. */
  confirm?: { vCal: number; rate: number; h0: number; classes: ClassSpec[] } | null;
  /** Write the meter as W (default) or as D. */
  meterAs?: "W" | "D";
  /** Also write a table-stage copy of the seed-401 rate-0 job (the driver ran it twice). */
  duplicateRate0?: boolean;
  /** Leave out the meter jobs of these spreads. */
  noMeter?: number[];
  /** Leave out the scan jobs of these spreads. */
  noScan?: number[];
}

export const vlmh = (g: readonly number[]): [number, number, number] => [g[0], g[(g.length - 1) >> 1], g[g.length - 1]];

const gjob = (o: MkJobOpts & { stage: Stage }): Job => mkJob({ kill: "removal", ...o });

/** All jobs of one substrate rung. */
export function rungJobs(sc: RungScenario): Job[] {
  const jobs: Job[] = [];
  const [lo, mid, hi] = vlmh(sc.g);
  const control = sc.control ?? (() => ["CHURN", "CHURN", "CHURN"]);
  const table = sc.table === undefined ? (_v: number, rate: number): ClassSpec[] => (rate >= 16 ? ["DC", "DC", "DC"] : ["CHURN", "CHURN", "CHURN"]) : sc.table;
  const scanClass = (v: number): ClassSpec => (!sc.carpets.includes(v) ? "SPARSE" : [lo, mid, hi].includes(v) ? control(v)[0] : "CHURN");
  for (const v of CANDIDATE_SPREADS) {
    if (sc.noScan?.includes(v)) continue;
    const rows = scanClass(v) === "SPARSE" ? undefined : { burn: rowsOf("CHURN", 20).burn, run: rowsOf("CHURN", 20).run.map((r) => ({ ...r, massPerCell: sc.massPerCell ?? 28 })) };
    jobs.push(gjob({ stage: "g0.scan", rung: sc.rung, seed: 401, spread: v, rate: 0, cls: scanClass(v), ...(rows && scanClass(v) === "CHURN" ? { rows } : {}) }));
  }
  for (const v of sc.carpets) {
    if (sc.noMeter?.includes(v)) continue;
    for (const axis of ["x", "y"] as const) jobs.push(meterJob({ rung: sc.rung, spread: v, axis, D: sc.dlab[v], useD: sc.meterAs === "D" }));
  }
  if (table !== null) {
    for (const v of [lo, mid, hi]) {
      for (const rate of RATES_REMOVAL) {
        const classes = rate === 0 ? control(v) : table(v, rate);
        TABLE_SEEDS.forEach((sd, k) => {
          if (rate === 0 && sd === 401 && !sc.duplicateRate0) return; // the scan job is the table's rate-0 seed-401 job
          jobs.push(gjob({ stage: "g0.table", rung: sc.rung, seed: sd, spread: v, rate, cls: classes[k] }));
        });
      }
    }
  }
  if (sc.horizon !== null && sc.horizon !== undefined) sc.horizon.forEach((c, k) => jobs.push(gjob({ stage: "g0.horizon", rung: sc.rung, seed: TABLE_SEEDS[k], spread: mid, rate: 0, nRun: 200, cls: c })));
  if (sc.confirm) sc.confirm.classes.forEach((c, k) => jobs.push(gjob({ stage: "g0.confirm", rung: sc.rung, seed: TABLE_SEEDS[k], spread: sc.confirm!.vCal, rate: sc.confirm!.rate, nRun: sc.confirm!.h0 / 1000, cls: c })));
  return jobs;
}

export interface VScenario {
  host: SubstrateRung;
  g: number[];
  /** Classes of seeds 401 to 403 at a nonzero vacancy rate (default: 256 and up are DC). */
  table?: ((v: number, rate: number) => ClassSpec[]) | null;
  confirm?: { vCal: number; rate: number; h0: number; classes: ClassSpec[] } | null;
  /** The V check: byte-identical census files (default), different ones, none, or only one of the two builds. */
  vcheck?: "identical" | "different" | "absent" | "half";
  /** The substrate recorded in the V jobs' summary.json. */
  substrate?: string;
}

/** The jobs rung V adds to its host's: the nonzero rates of its table, its own confirmation, and the V check. */
export function vJobs(sc: VScenario): Job[] {
  const jobs: Job[] = [];
  const [lo, mid, hi] = vlmh(sc.g);
  const table = sc.table === undefined ? (_v: number, rate: number): ClassSpec[] => (rate >= 256 ? ["DC", "DC", "DC"] : ["CHURN", "CHURN", "CHURN"]) : sc.table;
  const sub = sc.substrate !== undefined ? { substrate: sc.substrate } : {};
  if (table !== null) {
    for (const v of [lo, mid, hi]) {
      for (const rate of RATES_VACANCY.filter((r) => r > 0)) {
        const classes = table(v, rate);
        TABLE_SEEDS.forEach((sd, k) => jobs.push(mkJob({ stage: "g0.table", rung: "V", kill: "vacancy", ...sub, seed: sd, spread: v, rate, cls: classes[k] })));
      }
    }
  }
  if (sc.confirm) sc.confirm.classes.forEach((c, k) => jobs.push(mkJob({ stage: "g0.confirm", rung: "V", kill: "vacancy", ...sub, seed: TABLE_SEEDS[k], spread: sc.confirm!.vCal, rate: sc.confirm!.rate, nRun: sc.confirm!.h0 / 1000, cls: c })));
  const mode = sc.vcheck ?? "identical";
  if (mode !== "absent") {
    const rowsDiff = rowsOf("CHURN", 20);
    rowsDiff.run[7] = { ...rowsDiff.run[7], ndom: 151 };
    jobs.push(mkJob({ stage: "g0.vcheck", rung: "V", kill: "vacancy", ...sub, seed: 401, spread: mid, rate: 0, cls: "CHURN", ...(mode === "different" ? { rows: rowsDiff } : {}) }));
    if (mode !== "half") jobs.push(mkJob({ stage: "g0.vcheck", rung: sc.host, kill: "removal", seed: 401, spread: mid, rate: 0, cls: "CHURN" }));
  }
  return jobs;
}

export function denseJob(o: { rung: Rung; spread: number; stepsPerSec: number; host?: string; cls?: ClassSpec; nRun?: number }): Job {
  return mkJob({ stage: "g0.dense", rung: o.rung, kill: o.rung === "V" ? "vacancy" : "removal", seed: 404, spread: o.spread, rate: 0, cls: o.cls ?? "CHURN", nRun: o.nRun, stepsPerSec: o.stepsPerSec, host: o.host ?? "M3 Pro (idle)" });
}

/** A grid scenario that the rule resolves to `g = [4, 8, 12, 20, 28]` (levels 5). */
export const DLAB_5: Record<number, number> = { 4: 0.008, 6: 0.009, 8: 0.012, 10: 0.015, 12: 0.02, 16: 0.024, 20: 0.03, 24: 0.036, 28: 0.05 };
export const CARPETS_5 = [4, 6, 8, 10, 12, 16, 20, 24, 28];
export const G_5 = [4, 8, 12, 20, 28];
/** Fewer than five levels: only 4, 8 and 12 survive the grid rule. */
export const DLAB_3: Record<number, number> = { 4: 0.008, 6: 0.009, 8: 0.012, 10: 0.0125, 12: 0.02 };
export const CARPETS_3 = [4, 6, 8, 10, 12];
export const G_3 = [4, 8, 12];

// ---- registered stages: the operating point, calibration, sweep, cycles, mutation ----

import type { OperatingPoint } from "../3d-rps/readout-gate0.ts";

/** An operating point of rung S0 with h0 50,000 and a dense rate of 700 steps/s (so T_end is 50,000 and T_end7 250,000). */
export const OP: OperatingPoint = { rung: "S0", kill: "removal", substrate: "S0", gSpread: G_5, vCal: 12, kappaW: 16, rCal: [8, 16, 32, 64], h0: 50_000, shape: [128, 128, 4], denseRate: 700, kappaStar: 32 };
export const TEND = 50_000;

export interface SpreadSpec {
  /** Classes of the five treatment seeds (211 to 215). */
  treat: ClassSpec[];
  /** Classes of the three control seeds (211 to 213); default CHURN. */
  ctrl?: ClassSpec[];
}

/** Sweep jobs at the operating point's `kappaStar`: five treatment and three control jobs per spread of `per` (a spread not in `per` is left out). */
export function sweepJobs(per: Record<number, SpreadSpec>, op: OperatingPoint = OP): Job[] {
  const jobs: Job[] = [];
  const nRun = TEND / 1000;
  for (const [vs, sp] of Object.entries(per)) {
    const v = Number(vs);
    sp.treat.forEach((c, k) => jobs.push(mkJob({ stage: "sweep", seed: 211 + k, spread: v, rate: op.kappaStar!, nRun, cls: c })));
    (sp.ctrl ?? ["CHURN", "CHURN", "CHURN"]).forEach((c, k) => jobs.push(mkJob({ stage: "sweep", seed: 211 + k, spread: v, rate: 0, nRun, cls: c })));
  }
  return jobs;
}

/** Five-seed class patterns for a spread. */
export const five = (c: ClassSpec): ClassSpec[] => [c, c, c, c, c];
export const mixed = (...cs: ClassSpec[]): ClassSpec[] => cs;

export function calibrationJobs(per: Record<number, [ClassSpec, ClassSpec]>, controls: [ClassSpec, ClassSpec] = ["CHURN", "CHURN"], op: OperatingPoint = OP, livLast?: Record<number, number>): Job[] {
  const jobs: Job[] = [];
  for (const sd of [201, 202]) jobs.push(mkJob({ stage: "calibration", seed: sd, spread: op.vCal, rate: 0, nRun: 20, cls: controls[sd - 201] }));
  for (const [rs, cs] of Object.entries(per)) {
    const rate = Number(rs);
    [201, 202].forEach((sd, k) => {
      const base = rowsOf(cs[k], 20);
      const rows = livLast?.[rate] !== undefined ? { burn: base.burn, run: base.run.map((r, i) => (i === 19 ? { ...r, liv: livLast[rate] } : r)) } : undefined;
      jobs.push(mkJob({ stage: "calibration", seed: sd, spread: op.vCal, rate, nRun: 20, cls: cs[k], ...(rows ? { rows } : {}) }));
    });
  }
  return jobs;
}

// ---- section 7 ----

export type MutKind = "LONG" | "THREE" | "LOOSE" | "MONO" | "EXTINCT";
const FIVE: RowSpec = { liv: 0.9, shares: [1, 1, 1, 1, 1], modal: [2, 4, 8, 16, 1] };
const THREE: RowSpec = { liv: 0.9, shares: [1, 1, 1] };
const HIER: RowSpec = { liv: 0.9, shares: [1, 1, 1], modal: [6, 4, 0] };
const ONE: RowSpec = { liv: 0.9, shares: [1] };

/** Run rows of a mutation run that ends in `kind` after `n` censuses (arms Z, A and W stop early at three censuses with one label). */
export function mutRows(kind: MutKind, supply: number, arm: Arm, n = 250): RowSpec[] {
  const withSupply = (r: RowSpec): RowSpec => ({ ...r, supply });
  const rep = (r: RowSpec, k: number) => Array.from({ length: k }, () => withSupply(r));
  if (kind === "LONG") return rep(FIVE, n);
  if (kind === "THREE") return rep(THREE, n);
  if (kind === "LOOSE") return rep(HIER, n);
  if (kind === "EXTINCT") return [...rep(THREE, 40), withSupply({ liv: 0.001, shares: [1, 1, 1] })];
  // MONO: arms that stop early do so after 3 censuses of one label; the others end with one label in the final window
  return ["Z", "A", "W"].includes(arm) ? [...rep(THREE, 30), ...rep(ONE, 3)] : [...rep(THREE, n - 1), ...rep(ONE, 1)];
}

/** The settings of each arm at rung S0, written out from the table of rule 7.2 (not imported from the readout, which checks them). */
export const ARM_ROW: Record<Arm, { types: number; flip: number; edge: number; mutRate: number }> = {
  Z: { types: 3, flip: 0, edge: 0, mutRate: 0 },
  A: { types: 3, flip: 4294967295, edge: 256, mutRate: 42950 },
  B: { types: 5, flip: 4294967295, edge: 0, mutRate: 42950 },
  C: { types: 5, flip: 4294967295, edge: 128, mutRate: 42950 },
  N: { types: 5, flip: 4294967295, edge: 128, mutRate: 42950 },
  W: { types: 3, flip: 0, edge: 0, mutRate: 429497 },
};

/**
 * Mutation jobs: `kinds[arm]` gives the class of each of the five seeds (251 to 255); `supply` the per-run supply (default 5). `scale`
 * is the matter scale of the substrate (the arms' `mutRate` is divided by it, 7.2).
 */
export function mutationJobs(kinds: Partial<Record<Arm, MutKind[]>>, o: { supply?: Partial<Record<Arm, number[]>>; spreadStar?: number; kappa?: number; n?: number; scale?: number } = {}): Job[] {
  const jobs: Job[] = [];
  for (const [arm, ks] of Object.entries(kinds) as [Arm, MutKind[]][]) {
    ks.forEach((kind, k) => {
      const supply = o.supply?.[arm]?.[k] ?? 5;
      const row = ARM_ROW[arm];
      jobs.push(
        mkJob({
          stage: "mutation",
          arm,
          seed: 251 + k,
          spread: o.spreadStar ?? 12,
          rate: arm === "N" ? 0 : (o.kappa ?? 32),
          mutRate: Math.floor(row.mutRate / (o.scale ?? 1)),
          types: row.types,
          flip: row.flip,
          edge: row.edge,
          rows: { burn: rowsOf("DC", 1).burn, run: mutRows(kind, supply, arm, o.n) },
        }),
      );
    });
  }
  return jobs;
}
