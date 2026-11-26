// Tests of the regime meters (packages/metrics/src/regime3.ts), M0 of docs/3d-regime-meters-plan-2026-10-23.md section 8.3.
// Every `it` that tests a row of the rule's boundary table is named "R14 row NN: ..." with the number of the row in the table
// (runs/regime/rule-draft.md, R14, rows in order); `grep -n 'it("' regime3.test.ts` is the coverage map. Hand cases of plan 8.3 and
// one test per outcome of R10, R11 and R12 follow the rows. Pure functions only: no GPU, nothing from runs/.
import { describe, expect, it } from "vitest";
import { CELL_CHANNELS, CH, buildWorld3, cellCount, cloneState, defaultConfig, draw, generalistGenome3, lowbias32 } from "@bl/schema";
import { RefSim3, share3, w1d } from "@bl/sim-ref";
import {
  AXES, AXIS_LISTS, B0_ID, B0_PARAMS, BLOCK, COMBINATIONS, DIFF_COLUMNS, REGIME, SEEDS, SLAB_GEOM,
  ampLabel, analyzeBank, applyKickToChannels, reproCounts, buildSettingRows, siteLogComplete, siteSumsMatchGlobal, comboOf, gateReport, seedsByWorld, axesDiffering, axisCandidateIds, ballVoxels, blockCentre, blockNetDiff, blockOfVoxel, bootstrapDraw, bootstrapSeed,
  bootstrapStability, c4Applicable, c4GateAccepts, censusDivergence, checkC1, checkC2, checkC3, checkC4, checkC5, checkC6, checkC7, checkC8,
  classifyTrajectory, colonyLabels, comboKey, conditionalEntropy, decideOutcome, decidingColumn, derridaAnalysis, derridaClass, diffCounters,
  diffLogFromRows, diffLogLength, diffRowAt, otherColumn, fracCmp, fracLE, fracLT, fracValue, distanceToTarget, doseIsRun, doseTable, dustRatio, dustState, emptyDiffLog, entropyBiasBound, evaluateG6,
  evaluateG7, evaluateGate, fewColonies, fewDoses, fewSites, findBrackets, fitExponent, fracGE, fracGT, genomeFingerprint, genomeFingerprints, groupClass,
  growthForm, hilbertOrder, inferenceSentence, invalidChecks, isClassBearing, isInertGateK, isSaturated, isFootprint, isValidJob, isVotingJob,
  jobClassOf, jobId, jobVotes, kickHeat, kickPlanP1, kickPlanP2, kickedBlockIds, lateCheck, lateOrder, lineageDivergence, livingColumns, lowerMedian,
  mapExponent, marginHits, marginalEntropy, median, meanExact, mergeSummaries, nearestSite, noiseSeed, overlapOf, phaseState, placeSites,
  quantiseB, rankAxes, scaleCurve, scaleFromBstar, scaleOf, secondColumns, selectionSeed, sensitivityScenarios, seededShuffle, settingId,
  settingResult, settingStatus, siteColonies, siteCounters, siteSeries, siteSpeed, spatialEntropy, stage0, startState, storedSteps, summarizeJob,
  sweepSettings, thresholdsP2, torusChebyshev, trajectorySeries, unitKickAvailable, unitKickPlan, validateRun, voxelAt, windowBounds, windowFlag,
  windowMean, windowMeanRatio, windowMeanStored, keyedPrefix, missingChecks, REQUIRED_CHECKS,
  type Combination, type ComboKey, type DiffLog, type DiffRow, type Geom, type JobReading, type JobSummary, type RegimeClass, type RegimeJob,
  type SettingRow, type SiteLog, type TwinBank, type DustState, type JobClass, type Rung,
} from "@bl/metrics";
import {
  GATE_GROUP_JOBS, checkExtension, evaluateG3, expectedRoster, gateRosterGaps, gateSlabId, parseCombination, parseHashFile, refTimes, rosterKey, rosterLabel, sweepRoster, sweepWithExtension,
  type OutcomeInput,
} from "@bl/metrics";

declare const process: { env: Record<string, string | undefined> };

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures

/** A 16 x 16 x 2 world: 2 x 2 blocks of 8 x 8 columns. */
const GS: Geom = { W: 16, H: 16, D: 2 };
const NS = GS.W * GS.H * GS.D;
const cellsOf = (g: Geom, spec: Partial<Record<keyof typeof CH, [number, number][]>>): Uint32Array => {
  const n = g.W * g.H * g.D;
  const out = new Uint32Array(n * CELL_CHANNELS);
  for (const [name, list] of Object.entries(spec) as [keyof typeof CH, [number, number][]][]) for (const [v, val] of list) out[CH[name] * n + v] = val;
  return out;
};
const P1NET: Combination = COMBINATIONS[0];
const P1OCC: Combination = COMBINATIONS[1];
const P2NET: Combination = COMBINATIONS[2];

// ---- Fixtures for the decision functions: job summaries, settings tables, twin banks --------------------------------------

const KEY: ComboKey = "P1-net";
const S30_OF: Record<string, number> = { ORDERED: 0.2, CRITICAL: 1.0, CHAOTIC: 4.0 };

/** A valid, CRITICAL, dust-clear, voting reading; every field can be overridden. */
function reading(o: Partial<JobReading> = {}): JobReading {
  const cls = (o.jobClass === undefined ? "CRITICAL" : o.jobClass) as JobClass | null;
  const dust: DustState = o.dust ?? "CLEAR";
  return {
    rung: "P1", decider: "net", fewSites: false, fewColonies: false, fewDoses: false, overlap: false, mS: 12, nCol: 3,
    tClass: "CRITICAL", tFrozen: false, form: "flat", saturated: false, footprint: false, b: 0, e: 0, speed: 0.01,
    gridR: REGIME.TRAJ.map(() => 1), gridSatFrac: REGIME.TRAJ.map(() => 0.01), stT: 1,
    dClass: "CRITICAL", stD: true, s: [1, 1, 1], sS: [1, 1, 1], s30: 1,
    NbarS: 1, NbarU: 0.1, ratioU: 0.1, dust, doseS: 100, doseU: 8,
    jobClass: cls, flags: [], vote: jobVotes(cls, dust),
    nSat100: 0.5, fClass: "ORDERED", nDecF30: 5, nDecS30: 20, nDecN30: 100,
    uNetCoverage30: 0.01, uMedianBlock30: 3, thetaB: 6,
    ...o,
  };
}

/** A job summary (IN_WINDOW, valid) with one reading under `key`; `r` overrides the reading, the rest the summary. */
function sj(o: Partial<JobSummary> & { r?: Partial<JobReading>; key?: ComboKey } = {}): JobSummary {
  const { r, key, ...rest } = o;
  const out: JobSummary = {
    id: "", role: "SWEEP", kind: "slab", world: B0_ID, seed: 101, T: REGIME.T0, dev: false, invalid: false, invalidChecks: [], extinct: false, extinctAt: null,
    noTarget: false, f: 0.3, flag: "IN_WINDOW", diedInPhase: false, drift: false, stamps: { ruleSha: "r", codeCommit: "c", srcHash: "s" },
    readings: { [key ?? KEY]: reading(r) }, ...rest,
  };
  if (!out.id) out.id = jobId({ kind: out.kind, world: out.world, seed: out.seed, T: out.T, rung: "P1", decider: "net" });
  return out;
}

type JobSpec = JobClass | "EXTINCT" | "NO_TARGET" | "CARPET" | "RELIC" | (Partial<JobSummary> & { r?: Partial<JobReading> });
/** The jobs of one setting at seeds 101, 102, ...: a class name is a valid voting job of that class. */
function mkJobs(world: string, specs: JobSpec[], T: number = REGIME.T0, key: ComboKey = KEY): JobSummary[] {
  const seeds = [101, 102, 103, 104, 105, 106];
  return specs.map((sp, i) => {
    const base = { world, seed: seeds[i], T, key };
    if (typeof sp !== "string") return sj({ ...base, ...sp });
    if (sp === "EXTINCT") return sj({ ...base, extinct: true, flag: null, readings: {} });
    if (sp === "NO_TARGET") return sj({ ...base, noTarget: true, flag: null, readings: {} });
    if (sp === "CARPET" || sp === "RELIC") return sj({ ...base, flag: sp });
    return sj({ ...base, r: { jobClass: sp, tClass: sp === "MIXED" || sp === "UNSTABLE" ? "CRITICAL" : sp, s30: S30_OF[sp] ?? 1 } });
  });
}

const SPECS = sweepSettings();
const spec = (id: string) => SPECS.find((s) => s.id === id)!;
const rowOf = (id: string, jobs: JobSummary[], extended = false, combo: Combination = P1NET): SettingRow => ({
  id, params: spec(id).params, control: spec(id).control, seeds: jobs.map((j) => j.seed), result: settingResult(jobs, combo, { extended }),
});
const FILL: JobSpec[] = ["CARPET", "CARPET", "CARPET"];
/** All 32 settings; the ones not listed are carpets (windowless, not unmeterable, not in the pool). */
function table(over: Record<string, JobSpec[]>, T: number = REGIME.T0): SettingRow[] {
  return SPECS.map((s) => rowOf(s.id, mkJobs(s.id, over[s.id] ?? FILL, T)));
}

const okRun = validateRun([sj()]);
const outcome = (rows: SettingRow[], o: Partial<Parameters<typeof decideOutcome>[0]> = {}) =>
  decideOutcome({ validation: okRun, gate: { pass: true, causes: [] }, rows, refClass: "CRITICAL", amp: "AMP-ROBUST", extended: false, combo: P1NET, late: { t1Jobs: [] }, ...o });
const SEEDS3 = [101, 102, 103];

// ---- Twin banks -----------------------------------------------------------------------------------------------------------

function mkLog(len: number, f: Partial<Record<keyof DiffRow, (t: number) => number>>, liveblk = 300): DiffLog {
  const rows: DiffRow[] = [];
  for (let t = 0; t < len; t++) {
    const row = Object.fromEntries(DIFF_COLUMNS.map((k) => [k, f[k] ? f[k]!(t) : 0])) as DiffRow;
    if (!f.liveblk_R) row.liveblk_R = liveblk;
    if (!f.live_R) row.live_R = 5000;
    if (!f.live_X) row.live_X = 5000;
    if (!f.SB_R) row.SB_R = 60000;
    if (!f.SB_X) row.SB_X = 60000;
    rows.push(row);
  }
  return diffLogFromRows(rows);
}
function mkSiteLog(mS: number, n: (j: number, t: number) => number, reach: (j: number, t: number) => number): SiteLog {
  const steps = storedSteps();
  const per = (fn: (j: number, t: number) => number) => Array.from({ length: mS }, (_, j) => steps.map((t) => fn(j, t)));
  return { steps, n_blk: per(n), n_occ: per(n), reach_blk: per(reach), reach_occ: per(reach) };
}
type Shape = "critical" | "frozen" | "ordered" | "chaotic" | "saturated";
const SHAPE: Record<Shape, { n: (t: number) => number; reach: (t: number) => number }> = {
  critical: { n: () => 1, reach: (t) => (t < 100 ? (4 * t) / 100 : 4 + ((t - 100) * 8.5) / 900) },
  frozen: { n: () => 1, reach: () => 4 },
  ordered: { n: (t) => Math.max(0, 1.5 - t / 200), reach: () => 4 },
  chaotic: { n: (t) => t / 100, reach: (t) => Math.min(19, 4 + t / 60) },
  saturated: { n: (t) => t / 50, reach: (t) => Math.min(19, 4 + t / 60) },
};
interface BankOpts {
  rung?: Rung;
  mS?: number;
  nCol?: number;
  liveblk?: number;
  shape?: Shape;
  /** The pooled response ratio at every dose. */
  s30?: number;
  ratioU?: number;
  doses?: number[];
  withF?: boolean;
  withN?: boolean;
  withU?: boolean;
  withS?: boolean;
  fShape?: Shape;
  nSat?: number;
}
function mkBank(o: BankOpts = {}): TwinBank {
  const mS = o.mS ?? 12, shape = SHAPE[o.shape ?? "critical"], liveblk = o.liveblk ?? 300;
  const s30 = o.s30 ?? 1, ratioU = o.ratioU ?? 0.1;
  const nCol = o.nCol ?? 3;
  const sNDec = (t: number) => (t === 0 ? mS : mS * shape.n(t));
  const sites = Array.from({ length: mS }, (_, j) => voxelAt(20 + 45 * (j % 5), 20 + 45 * Math.floor(j / 5), 3, SLAB_GEOM));
  const colonies: number[][] = Array.from({ length: nCol }, () => []);
  sites.forEach((_, j) => colonies[j % nCol].push(j));
  const fShape = SHAPE[o.fShape ?? "frozen"];
  const bank: TwinBank = {
    rung: o.rung ?? "P1", k: 12, thetaB: 6, thetaV: 3, sites, nCol, colonies: colonies.filter((c) => c.length), n0: mS, n0Site: new Array(mS).fill(1), doseS: mS * 12,
    doses: (o.doses ?? [4, 8, 16]).map((m) => ({ m, n0: m, log: mkLog(301, { n_blk: (t) => (t === 0 ? m : s30 * m), n_occ: (t) => (t === 0 ? 0 : s30 * m) }, liveblk) })),
  };
  if (o.withS !== false) {
    bank.S = { log: mkLog(1001, { n_blk: sNDec, n_occ: sNDec }, liveblk), sites: mkSiteLog(mS, (_, t) => (t === 0 ? 1 : shape.n(t)), (_, t) => shape.reach(t)) };
    if (o.withU !== false) bank.U = { log: mkLog(301, { n_blk: (t) => ratioU * sNDec(t), n_occ: (t) => ratioU * sNDec(t) }, liveblk), doseU: mS };
    if (o.withF) bank.F = { log: mkLog(1001, { n_blk: () => mS * 0.5, n_occ: () => mS * 0.5 }, liveblk), sites: mkSiteLog(mS, () => 1, (_, t) => fShape.reach(t)) };
  }
  if (o.withN !== false) bank.N = { log: mkLog(301, { n_blk: () => (o.nSat ?? 0.5) * liveblk, n_occ: () => (o.nSat ?? 0.5) * liveblk }, liveblk) };
  return bank;
}
const CORE = { liveblkT: 300, liveT: 5000, h0: selectionSeed(101, REGIME.T0), diedInPhase: false, drift: false };
/** The eight checks a METERED job carries (R5), all passed: the runner writes every one of them (C3 and C4 as not applicable when they do not apply). */
const OK_CHECKS: Record<"C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8", { ok: true }> = { C1: { ok: true }, C2: { ok: true }, C3: { ok: true }, C4: { ok: true }, C5: { ok: true }, C6: { ok: true }, C7: { ok: true }, C8: { ok: true } };

/** Recursively checks that every number in a value is finite. */
function allFinite(x: unknown, path = "$"): string[] {
  if (typeof x === "number") return Number.isFinite(x) ? [] : [path];
  if (Array.isArray(x)) return x.flatMap((v, i) => allFinite(v, `${path}[${i}]`));
  if (x && typeof x === "object") return Object.entries(x).flatMap(([k, v]) => allFinite(v, `${path}.${k}`));
  return [];
}

describe("constants (R1)", () => {
  it("pins the values the rule states", () => {
    expect(REGIME).toMatchObject({ T0: 20000, T1: 50000, T2: 100000, K_MIN: 12, NE_MIN: 64, OCC_V: 8, M_S: 16, D_SEP: 40, M_S_MIN: 6, M_COL_MIN: 2, TAU_DEC: 30, ORD_R: 0.1, B_LO: -0.5, B_HI: 0.5, SAT: 0.05, R_AMP: 2, DUST_CLEAR: 0.25, DUST_LIM: 0.5, D_LO: 0.5, D_HI: 2, OVERLAP_REACH: 20, BOOT: 1000, STABLE: 0.8, S_FLOOR: 0.01, VOTE: 2, POOL_MIN: 8, AXES_MIN: 3, LATE_MAX: 6, NO_AXIS: 0.35, TIE: 0.1, MARGIN_RATIO: 0.1, MARGIN_S: 1.25, MARGIN_ST: 0.05 });
    expect([...REGIME.DOSES]).toEqual([4, 8, 16, 32, 64]);
    expect([...REGIME.TAU]).toEqual([30, 100, 300]);
    expect([...REGIME.TRAJ]).toEqual([100, 139, 193, 268, 373, 518, 720, 1000]);
    expect(REGIME.SPEED_MIN).toBe(8 / 900);
    expect(REGIME.DOSE_CAP).toEqual({ num: 1, den: 10 });
    expect(BLOCK).toBe(8);
    expect([...SEEDS.main, ...SEEDS.extension, ...SEEDS.dev]).toEqual([101, 102, 103, 104, 105, 106, 9001, 9002, 9003]);
  });
  it("lists the four combinations in Stage 0's order", () => {
    expect(COMBINATIONS.map(comboKey)).toEqual(["P1-net", "P1-occ", "P2-net", "P2-occ"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Windows, classes of the response ratio and of the trajectory

describe("R14 rows 1 to 16: windows, the Derrida window, the trajectory classes", () => {
  it("R14 row 01: a constant series 7 over steps 995 to 1000 and 0 before: Nbar(1000) = 7, Nbar(139) uses steps 134 to 144", () => {
    const s = Array.from({ length: 1001 }, (_, t) => (t >= 995 ? 7 : 0));
    expect(windowMean(s, 1000, 1000)).toBe(7);
    expect(windowBounds(1000, 1000)).toEqual([995, 1000]);
    expect(windowBounds(139, 1000)).toEqual([134, 144]);
    const ramp = Array.from({ length: 1001 }, (_, t) => t);
    expect(windowMean(ramp, 139, 1000)).toBe(139);
    expect(windowMean(ramp, 1000, 1000)).toBe((995 + 996 + 997 + 998 + 999 + 1000) / 6);
    expect(windowBounds(3, 1000)).toEqual([1, 8]);
    expect(windowBounds(300, 300)).toEqual([295, 300]);
  });
  it("R14 row 02: s(30) = 0.5 is CRITICAL", () => expect(derridaClass(0.5)).toBe("CRITICAL"));
  it("R14 row 03: s(30) = 2.0 is CRITICAL", () => expect(derridaClass(2.0)).toBe("CRITICAL"));
  it("R14 row 04: s(30) = 0.4999 is ORDERED", () => expect(derridaClass(0.4999)).toBe("ORDERED"));
  it("R14 row 05: s(30) = 2.0001 is CHAOTIC", () => expect(derridaClass(2.0001)).toBe("CHAOTIC"));

  const base = { fewSites: false, fewColonies: false, saturated: false, overlap: false, r1000: 0.5, b: 0, speed: 1 };
  it("R14 row 06: r(1000) = 0.1, b = 0, speed at SPEED_MIN is not ORDERED by the first test", () => {
    const r = classifyTrajectory({ ...base, r1000: 0.1, b: 0, speed: REGIME.SPEED_MIN });
    expect(r.cls).toBe("CRITICAL");
  });
  it("R14 row 07: r(1000) = 0.0999 is ORDERED", () => expect(classifyTrajectory({ ...base, r1000: 0.0999 }).cls).toBe("ORDERED"));
  it("R14 row 08: b = -0.5 with r(1000) >= 0.1 is not ORDERED by the b test", () => {
    expect(classifyTrajectory({ ...base, b: -0.5 }).cls).toBe("CRITICAL");
    expect(classifyTrajectory({ ...base, b: -0.5001 }).cls).toBe("ORDERED");
  });
  it("R14 row 09: b = +0.5 is not CHAOTIC by the b test", () => {
    expect(classifyTrajectory({ ...base, b: 0.5 }).cls).toBe("CRITICAL");
    expect(classifyTrajectory({ ...base, b: 0.5001 }).cls).toBe("CHAOTIC");
  });
  it("R14 row 10: satFrac = 0.05 and r = 2.0 at one grid time: saturated, T-class CHAOTIC", () => {
    expect(isSaturated(0.05, 2.0)).toBe(true);
    expect(classifyTrajectory({ ...base, saturated: true }).cls).toBe("CHAOTIC");
  });
  it("R14 row 11: satFrac = 0.05 and r = 1.9999: not saturated, flag FOOTPRINT", () => {
    expect(isSaturated(0.05, 1.9999)).toBe(false);
    expect(isFootprint(0.05, 1.9999)).toBe(true);
  });
  it("R14 row 12: satFrac = 0.0499 and r = 3: not saturated, no flag", () => {
    expect(isSaturated(0.0499, 3)).toBe(false);
    expect(isFootprint(0.0499, 3)).toBe(false);
  });

  const flat = (L: number, nDec: number) => trajectorySeries({ mS: 16, n0: 16, nDec: new Array(1001).fill(nDec), liveblk: new Array(1001).fill(L) });
  it("R14 row 13: m_S = 16, P1, constant r = 1, b = 0, liveblk_R = 100, 320, 512: never saturated; FOOTPRINT at 100 and 320, none at 512", () => {
    const flags: Record<number, boolean> = {};
    for (const L of [100, 320, 512]) {
      const s = flat(L, 16);
      expect(s.r.every((v) => v === 1)).toBe(true);
      expect(s.saturated).toBe(false);
      flags[L] = s.footprint;
      const fit = fitExponent(s.r, 16, s.firstSaturated);
      expect(fit.b).toBeCloseTo(0, 12);
      // T-class CRITICAL if the damage spreads by a block over steps 100 to 1000, else ORDERED frozen
      expect(classifyTrajectory({ fewSites: false, fewColonies: false, saturated: s.saturated, overlap: false, r1000: s.r[7], b: fit.b, speed: REGIME.SPEED_MIN })).toEqual({ cls: "CRITICAL", frozen: false });
      expect(classifyTrajectory({ fewSites: false, fewColonies: false, saturated: s.saturated, overlap: false, r1000: s.r[7], b: fit.b, speed: 0 })).toEqual({ cls: "ORDERED", frozen: true });
    }
    expect(flags).toEqual({ 100: true, 320: true, 512: false });
  });
  it("R14 row 14: m_S = 16, P1, constant r = 3 with liveblk_R = 1,024: satFrac 0.047, not saturated; r = 3.2: satFrac 0.05, saturated", () => {
    const a = flat(1024, 48);
    expect(a.satFrac[0]).toBeCloseTo(0.046875, 12);
    expect(a.r[0]).toBe(3);
    expect(a.saturated).toBe(false);
    const b = flat(1024, 51.2);
    expect(b.satFrac[0]).toBe(0.05);
    expect(b.r[0]).toBe(3.2);
    expect(b.saturated).toBe(true);
    expect(b.firstSaturated).toBe(0);
  });
  it("R14 row 15: r(1000) = 0.5, b = 0, speed = 8/900: T-class CRITICAL", () => {
    expect(classifyTrajectory({ ...base, r1000: 0.5, b: 0, speed: 8 / 900 }).cls).toBe("CRITICAL");
  });
  it("R14 row 16: the same with speed = 7.99/900: T-class ORDERED, form frozen", () => {
    const r = classifyTrajectory({ ...base, r1000: 0.5, b: 0, speed: 7.99 / 900 });
    expect(r).toEqual({ cls: "ORDERED", frozen: true });
    expect(growthForm({ cls: r.cls, frozen: r.frozen, saturated: false, b: 0, sseExp: null, sseLogT: null })).toBe("frozen");
  });
  it("the trajectory steps in R6.4's order: NA, saturated, overlap, then the tests of r(1000), b and speed", () => {
    expect(classifyTrajectory({ ...base, fewSites: true, saturated: true }).cls).toBe("NA");
    expect(classifyTrajectory({ ...base, fewColonies: true, saturated: true }).cls).toBe("NA");
    expect(classifyTrajectory({ ...base, saturated: true, overlap: true }).cls).toBe("CHAOTIC");
    expect(classifyTrajectory({ ...base, overlap: true }).cls).toBe("NA");
    expect(classifyTrajectory({ ...base, r1000: null }).cls).toBe("NA");
    expect(classifyTrajectory({ ...base, b: null }).cls).toBe("NA");
    expect(classifyTrajectory({ ...base, speed: null }).cls).toBe("NA");
  });
  it("growth-form labels: decays, frozen, saturating, exponential, cone, super-cone, flat", () => {
    const f = (o: Partial<Parameters<typeof growthForm>[0]>) => growthForm({ cls: "CHAOTIC", frozen: false, saturated: false, b: 1, sseExp: 2, sseLogT: 1, ...o });
    expect(f({ cls: "ORDERED" })).toBe("decays");
    expect(f({ cls: "ORDERED", frozen: true })).toBe("frozen");
    expect(f({ saturated: true })).toBe("saturating");
    expect(f({ sseExp: 0.5, sseLogT: 1 })).toBe("exponential");
    expect(f({ b: 2.5 })).toBe("cone");
    expect(f({ b: 2.6 })).toBe("super-cone");
    expect(f({ cls: "CRITICAL", b: 0 })).toBe("flat");
    expect(f({ cls: "NA" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R3, R4: statuses, scale, sites, colonies, doses, kicks

describe("R14 rows 33 to 41, 44 to 46: statuses, scale, sites, colonies, block counters", () => {
  it("R14 row 33: m_S = 5 is FEW_SITES, m_S = 6 is not", () => {
    expect(fewSites(5)).toBe(true);
    expect(fewSites(6)).toBe(false);
  });

  it("R14 row 34: two sites at horizontal Chebyshev distance 39 are not both accepted; at 40 they are", () => {
    const a = voxelAt(10, 10, 0, SLAB_GEOM);
    const near = voxelAt(49, 10, 3, SLAB_GEOM); // dx 39, z ignored
    const far = voxelAt(50, 10, 3, SLAB_GEOM); // dx 40
    expect(torusChebyshev(a, near, SLAB_GEOM)).toBe(39);
    expect(torusChebyshev(a, far, SLAB_GEOM)).toBe(40);
    const h0 = selectionSeed(101, 20000);
    expect(placeSites([a, near], SLAB_GEOM, h0)).toHaveLength(1);
    expect(placeSites([a, far], SLAB_GEOM, h0)).toHaveLength(2);
    // the torus: x = 2 and x = 250 are 8 apart
    expect(torusChebyshev(voxelAt(2, 2, 0, SLAB_GEOM), voxelAt(250, 2, 0, SLAB_GEOM), SLAB_GEOM)).toBe(8);
    expect(torusChebyshev(voxelAt(2, 2, 0, SLAB_GEOM), voxelAt(2, 130, 0, SLAB_GEOM), SLAB_GEOM)).toBe(128);
  });

  it("site selection is deterministic, respects D_SEP and stops at M_S (R4.4)", () => {
    const E = new Uint32Array(40000);
    for (let i = 0; i < E.length; i++) E[i] = i * 13; // 40,000 eligible voxels spread over the first layers
    const h0 = selectionSeed(102, 20000);
    const a = placeSites(E, SLAB_GEOM, h0);
    const b = placeSites(E, SLAB_GEOM, h0);
    expect(a).toEqual(b);
    expect(a).toHaveLength(REGIME.M_S);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) expect(torusChebyshev(a[i], a[j], SLAB_GEOM)).toBeGreaterThanOrEqual(REGIME.D_SEP);
    expect(placeSites(E, SLAB_GEOM, selectionSeed(103, 20000))).not.toEqual(a);
    expect(placeSites([], SLAB_GEOM, h0)).toEqual([]);
    expect(h0).toBe(lowbias32((Math.imul(102, 7919) ^ 20000) >>> 0));
  });

  it("the dose order is the key order and nested: the first m entries of one list (R4.5)", () => {
    const E = Array.from({ length: 5000 }, (_, i) => i * 7);
    const h0 = selectionSeed(101, 20000);
    const p = keyedPrefix(E, h0, 64);
    const full = [...E].sort((a, b) => lowbias32((a ^ h0) >>> 0) - lowbias32((b ^ h0) >>> 0) || a - b);
    expect(p).toEqual(full.slice(0, 64));
    expect(keyedPrefix(E, h0, 8)).toEqual(p.slice(0, 8));
  });

  it("R14 row 35: 12 sites in 1 colony are FEW_COLONIES (T-class NA); in 2 colonies the T-class is available", () => {
    expect(fewColonies(12, 1)).toBe(true);
    expect(fewColonies(12, 2)).toBe(false);
    expect(fewColonies(5, 1)).toBe(false); // FEW_SITES comes first
    const facts = { fewSites: false, saturated: false, overlap: false, r1000: 0.5, b: 0, speed: 1 };
    expect(classifyTrajectory({ ...facts, fewColonies: true }).cls).toBe("NA");
    expect(classifyTrajectory({ ...facts, fewColonies: false }).cls).toBe("CRITICAL");
  });

  it("colonies are 4-connected components of living columns with x and y wrapping, and sites belong to the colony of their column (R4.4)", () => {
    const g: Geom = { W: 16, H: 16, D: 2 };
    const n = g.W * g.H * g.D;
    const B = new Uint32Array(n), P = new Uint32Array(n);
    const live = (x: number, y: number, z = 0) => { B[voxelAt(x, y, z, g)] = 5; };
    // colony 0: a strip across the x wrap (columns x = 15, 0, 1 at y = 3); a diagonal cell touches only at a corner and is its own colony
    live(15, 3); live(0, 3); live(1, 3); live(2, 4);
    // colony: a vertical strip across the y wrap (y = 15, 0) at x = 8, living only in layer 1 (any layer makes the column living)
    live(8, 15, 1); live(8, 0, 0);
    // P alone also makes a column living
    P[voxelAt(12, 12, 0, g)] = 3;
    const mask = livingColumns(B, P, g);
    const col = colonyLabels(mask, g);
    expect(col.count).toBe(4);
    expect(col.sizes.reduce((a, b) => a + b, 0)).toBe(4 + 2 + 1);
    expect(col.labels[3 * 16 + 15]).toBe(col.labels[3 * 16 + 0]);
    expect(col.labels[3 * 16 + 1]).toBe(col.labels[3 * 16 + 0]);
    expect(col.labels[4 * 16 + 2]).not.toBe(col.labels[3 * 16 + 1]);
    expect(col.labels[15 * 16 + 8]).toBe(col.labels[0 * 16 + 8]);
    expect(col.labels[5]).toBe(-1);
    const sites = [voxelAt(15, 3, 0, g), voxelAt(1, 3, 1, g), voxelAt(12, 12, 0, g), voxelAt(8, 0, 0, g)];
    const sc = siteColonies(sites, col.labels, g);
    expect(sc.nCol).toBe(3);
    expect(sc.colonies).toEqual([[0, 1], [2], [3]]);
    expect(sc.colonyOfSite).toEqual([0, 0, 1, 2]);
  });

  it("R14 row 36: B* = 6 gives k = 12, thetaB = 6, thetaV = 3", () => expect(scaleFromBstar(6)).toEqual({ k: 12, thetaB: 6, thetaV: 3 }));
  it("R14 row 37: B* = 30 gives k = 15, thetaB = 8, thetaV = 4", () => expect(scaleFromBstar(30)).toEqual({ k: 15, thetaB: 8, thetaV: 4 }));
  it("R14 row 38: B* = 40 gives k = 20, thetaB = 10, thetaV = 5", () => expect(scaleFromBstar(40)).toEqual({ k: 20, thetaB: 10, thetaV: 5 }));
  it("B* is the lower median of B over the voxels with B >= 1, and E is the voxels with B >= k + 1 in ascending order (R4.1, R4.2)", () => {
    const B = new Uint32Array(100);
    [0, 3, 6, 6, 9].forEach((v, i) => (B[10 + i] = v));
    const s = scaleOf(B);
    expect(s.Bstar).toBe(6); // [3, 6, 6, 9]: element floor(3 / 2) = 1
    expect(s.k).toBe(12);
    expect(s.NE).toBe(0);
    const C = new Uint32Array(100).fill(13);
    C[0] = 0;
    const t = scaleOf(C);
    expect(t.Bstar).toBe(13);
    expect(t.k).toBe(12);
    expect(t.NE).toBe(99);
    expect(t.E[0]).toBe(1);
    expect(lowerMedian([5, 1, 9, 3])).toBe(3);
    expect(median([5, 1, 9, 3])).toBe(4);
    expect(median([])).toBeNull();
  });

  it("R14 row 39: N_E = 63 is NO_TARGET, N_E = 64 is METERED", () => {
    const mk = (count: number) => { const B = new Uint32Array(500); B.fill(13, 0, count); return scaleOf(B); };
    expect(startState({ extinct: false, Bstar: mk(63).Bstar, NE: mk(63).NE, f: 0.3 }).status).toBe("NO_TARGET");
    const ok = mk(64);
    expect(ok.NE).toBe(64);
    expect(startState({ extinct: false, Bstar: ok.Bstar, NE: ok.NE, f: 0.3 })).toEqual({ status: "METERED", flag: "IN_WINDOW" });
    expect(startState({ extinct: true, Bstar: 13, NE: 99, f: 0.3 }).status).toBe("EXTINCT");
  });

  it("R14 row 40: a living state with P > 0 and no voxel with B >= 1 is NO_TARGET (B* is NA)", () => {
    const B = new Uint32Array(64), P = new Uint32Array(64).fill(4);
    const s = scaleOf(B);
    expect(s.Bstar).toBeNull();
    expect(s.k).toBeNull();
    expect(s.NE).toBe(0);
    expect(livingColumns(B, P, { W: 8, H: 8, D: 1 }).every((x) => x === 1)).toBe(true);
    expect(startState({ extinct: false, Bstar: s.Bstar, NE: s.NE, f: 1 }).status).toBe("NO_TARGET");
  });

  it("R14 row 41: a kick of k at one site is counted when one block holds all of it, and a block holding ceil(k/2) - 1 of it is not", () => {
    const thr = { thetaB: 6, thetaV: 3 };
    const R = cellsOf(GS, { B: [[voxelAt(3, 3, 0, GS), 20], [voxelAt(7, 3, 0, GS), 20], [voxelAt(8, 3, 0, GS), 20]] });
    const kick = (amounts: [number, number][]) => {
      const X = R.slice();
      for (const [v, a] of amounts) { X[CH.B * NS + v] -= a; X[CH.C * NS + v] += a; }
      return diffCounters(R, X, GS, thr);
    };
    // all 12 in one block: counted once
    const whole = kick([[voxelAt(3, 3, 0, GS), 12]]);
    expect(whole.row.n_blk).toBe(1);
    expect(whole.row.n_blk2).toBe(1); // 12 >= 2 * 6
    expect(whole.row.L1c).toBe(12);
    // a kick that straddles the boundary x = 7 | 8: 7 in block 0 (counted), 5 in block 1 (ceil(12/2) - 1: not counted)
    const straddle = kick([[voxelAt(7, 3, 0, GS), 7], [voxelAt(8, 3, 0, GS), 5]]);
    expect(straddle.row.n_blk).toBe(1);
    expect(straddle.row.L1c).toBe(12);
    // 6 and 6: both counted
    expect(kick([[voxelAt(7, 3, 0, GS), 6], [voxelAt(8, 3, 0, GS), 6]]).row.n_blk).toBe(2);
    // 5 and 5: neither
    expect(kick([[voxelAt(7, 3, 0, GS), 5], [voxelAt(8, 3, 0, GS), 5]]).row.n_blk).toBe(0);
  });

  it("the same counters serve a 2D world (one layer, blocks of 8 x 8 voxels)", () => {
    const g2: Geom = { W: 16, H: 16, D: 1 };
    const n2 = g2.W * g2.H;
    const v = voxelAt(9, 2, 0, g2); // block 1
    const R = cellsOf(g2, { B: [[v, 30]] });
    const X = R.slice();
    X[CH.B * n2 + v] -= 12;
    X[CH.C * n2 + v] += 12;
    const { row, blocks } = diffCounters(R, X, g2, { thetaB: 6, thetaV: 3 });
    expect(row).toMatchObject({ n_blk: 1, n_blk2: 1, n_occ: 0, L1c: 12, liveblk_R: 1, n_thetaV: 1, n_1: 1, n_vox: 1, L1_B: 12, L1_C: 12, SB_R: 30, SB_X: 18, live_R: 1, live_X: 1 });
    expect(Array.from(blocks.net)).toEqual([0, -12, 0, 0]);
    expect(blockOfVoxel(v, g2)).toBe(1);
    expect(blockCentre(1, g2)).toEqual([12, 4]);
  });

  it("block sums are signed: a plus and a minus inside one block cancel, and the occupancy count sees them (R6)", () => {
    const thr = { thetaB: 6, thetaV: 3 };
    const R = cellsOf(GS, { B: [[voxelAt(1, 1, 0, GS), 20], [voxelAt(2, 1, 0, GS), 20]] });
    const X = R.slice();
    X[CH.B * NS + voxelAt(1, 1, 0, GS)] -= 10;
    X[CH.B * NS + voxelAt(2, 1, 0, GS)] += 10;
    const { row } = diffCounters(R, X, GS, thr);
    expect(row.n_blk).toBe(0);
    expect(row.L1c).toBe(0);
    expect(row.n_thetaV).toBe(2);
    expect(row.n_1).toBe(2);
  });

  it("a block with 7 differing voxels is not occupied and one with 8 is (OCC_V = 8, R6)", () => {
    const thr = { thetaB: 1000, thetaV: 3 };
    const R = cellsOf(GS, { B: Array.from({ length: 16 }, (_, i) => [voxelAt(i % 8, Math.floor(i / 8), 0, GS), 10] as [number, number]) });
    const seven = R.slice(), eight = R.slice();
    for (let i = 0; i < 8; i++) { if (i < 7) seven[CH.B * NS + voxelAt(i, 0, 0, GS)] += 3; eight[CH.B * NS + voxelAt(i, 0, 0, GS)] += 3; }
    expect(diffCounters(R, seven, GS, thr).row.n_occ).toBe(0);
    expect(diffCounters(R, eight, GS, thr).row.n_occ).toBe(1);
    // |dB| = thetaV - 1 does not count
    const below = R.slice();
    for (let i = 0; i < 8; i++) below[CH.B * NS + voxelAt(i, 0, 0, GS)] += 2;
    expect(diffCounters(R, below, GS, thr).row.n_occ).toBe(0);
    // n_thetaV and n_2thetaV
    expect(diffCounters(R, eight, GS, thr).row.n_thetaV).toBe(8);
    expect(diffCounters(R, eight, GS, thr).row.n_2thetaV).toBe(0); // |dB| = 3 < 2 * thetaV
  });

  it("the diff pass counts every column of R6 on a hand-built pair of fields", () => {
    const thr = { thetaB: 2, thetaV: 2 };
    const v0 = voxelAt(1, 1, 0, GS), v1 = voxelAt(9, 1, 1, GS), v2 = voxelAt(12, 12, 0, GS);
    const R = cellsOf(GS, { A: [[v0, 5]], B: [[v0, 10], [v1, 4]], C: [[v1, 2]], P: [[v2, 1]], E: [[v0, 7]] });
    const X = R.slice();
    X[CH.B * NS + v0] += 3; // dB +3 in block 0
    X[CH.B * NS + v1] -= 4; // voxel v1 dies (B + P = 0): living status differs
    X[CH.A * NS + v0] += 1;
    X[CH.E * NS + v0] += 5; // only E differs here besides B and A
    X[CH.S * NS + v2] += 9; // only S differs at v2
    const { row, blocks } = diffCounters(R, X, GS, thr);
    expect(row).toMatchObject({
      n_blk: 2, n_blk2: 1, n_occ: 0, L1c: 7, liveblk_R: 3, n_thetaV: 2, n_2thetaV: 1, n_1: 2, n_live: 1, n_vox: 3,
      L1_A: 1, L1_B: 7, L1_C: 0, L1_P: 0, SB_R: 14, live_R: 3, SB_X: 13, live_X: 2,
    });
    expect(Array.from(blocks.live)).toEqual([1, 1, 0, 1]);
    expect(DIFF_COLUMNS).toHaveLength(18);
    // the voxel L1 saturates at 1023 per voxel
    const big = cellsOf(GS, { B: [[v0, 5000]] });
    const big2 = big.slice();
    big2[CH.B * NS + v0] = 100;
    expect(diffCounters(big, big2, GS, thr).row.L1_B).toBe(1023);
  });

  it("R14 row 44: f = 0.01 / 0.0099 / 0.85 / 0.8499 at T is IN_WINDOW / RELIC / CARPET / IN_WINDOW", () => {
    expect(windowFlag(0.01)).toBe("IN_WINDOW");
    expect(windowFlag(0.0099)).toBe("RELIC");
    expect(windowFlag(0.85)).toBe("CARPET");
    expect(windowFlag(0.8499)).toBe("IN_WINDOW");
  });

  it("R14 row 45: f = 0.80 at T and 0.85 at T + 1,000 is DRIFT and has no class", () => {
    const live = new Array(1001).fill(1000);
    expect(phaseState({ liveR: live, fEnd: 0.85, startFlag: "IN_WINDOW" })).toEqual({ diedInPhase: false, drift: true });
    expect(phaseState({ liveR: live, fEnd: 0.8499, startFlag: "IN_WINDOW" }).drift).toBe(false);
    expect(phaseState({ liveR: live, fEnd: 0.0099, startFlag: "IN_WINDOW" }).drift).toBe(true);
    // a job already outside the window at T keeps its CARPET or RELIC flag and is not DRIFT (resolution W2)
    expect(phaseState({ liveR: live, fEnd: 0.95, startFlag: "CARPET" }).drift).toBe(false);
    const jc = jobClassOf({ fewDoses: false, diedInPhase: false, drift: true, tClass: "CRITICAL", tFrozen: false, dClass: "CRITICAL", stT: 1, stD: true });
    expect(jc.cls).toBeNull();
  });

  it("R14 row 46: live_R = 0 at step 600 of the phase is DIED_IN_PHASE, has no class, and counts with EXTINCT in R8.1", () => {
    const live = Array.from({ length: 1001 }, (_, t) => (t >= 600 ? 0 : 500));
    expect(phaseState({ liveR: live, fEnd: 0, startFlag: "IN_WINDOW" })).toEqual({ diedInPhase: true, drift: false });
    expect(jobClassOf({ fewDoses: false, diedInPhase: true, drift: false, tClass: "CRITICAL", tFrozen: false, dClass: "CRITICAL", stT: 1, stD: true }).cls).toBeNull();
    const dead = [sj({ seed: 101, diedInPhase: true }), sj({ seed: 102, extinct: true }), sj({ seed: 103 })];
    expect(settingStatus(dead)).toBe("UNMETERABLE");
    expect(settingStatus([sj({ seed: 101, diedInPhase: true }), sj({ seed: 102 }), sj({ seed: 103 })])).toBe("WINDOWED");
    expect(settingStatus([sj({ seed: 101, noTarget: true }), sj({ seed: 102, extinct: true }), sj({ seed: 103 })])).toBe("UNMETERABLE");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The fit, the dose table, the kicks

describe("R14 rows 42, 43, 47 to 53: the fit, liveblk floor, overlap, doses, kicks", () => {
  it("R14 row 42: a synthetic r(t_j) = (t_j / 100)^b is fitted back to b to 1e-9", () => {
    for (const b of [-0.3, 0, 0.23, 1, 1.7]) {
      const r = REGIME.TRAJ.map((t) => (t / 100) ** b);
      const fit = fitExponent(r, 16, null);
      expect(Math.abs(fit.b! - b)).toBeLessThan(1e-9);
      expect(fit.points).toBe(8);
    }
    // the floor 1 / (2 m_S) binds when r falls below it: b = -2 reads 0.01 < 1/32 and the slope is no longer -2
    const steep = fitExponent(REGIME.TRAJ.map((t) => (t / 100) ** -2), 16, null);
    expect(steep.b!).toBeGreaterThan(-2);
    // the fit stops before the first saturated grid time; fewer than 3 points leave b NA
    expect(fitExponent(REGIME.TRAJ.map((t) => t / 100), 16, 2).points).toBe(2);
    expect(fitExponent(REGIME.TRAJ.map((t) => t / 100), 16, 2).b).toBeNull();
    expect(fitExponent(REGIME.TRAJ.map((t) => t / 100), 16, 3).b).toBeCloseTo(1, 9);
  });

  it("R14 row 43: an all-zero series is ORDERED with e = -2", () => {
    const s = trajectorySeries({ mS: 16, n0: 16, nDec: new Array(1001).fill(0), liveblk: new Array(1001).fill(300) });
    expect(s.r.every((v) => v === 0)).toBe(true);
    const fit = fitExponent(s.r, 16, s.firstSaturated);
    expect(fit.b).toBeCloseTo(0, 12); // floored: a defined slope
    const cls = classifyTrajectory({ fewSites: false, fewColonies: false, saturated: s.saturated, overlap: false, r1000: s.r[7], b: fit.b, speed: null });
    expect(cls.cls).toBe("ORDERED");
    expect(mapExponent({ saturated: s.saturated, r1000: s.r[7], b: fit.b })).toBe(-2);
    expect(mapExponent({ saturated: true, r1000: 5, b: 1 })).toBe(2);
    expect(mapExponent({ saturated: false, r1000: 5, b: 3.4 })).toBe(2);
    expect(mapExponent({ saturated: false, r1000: 5, b: -3.4 })).toBe(-2);
    expect(mapExponent({ saturated: false, r1000: 5, b: 0.7 })).toBe(0.7);
  });

  it("R14 row 47: liveblk_R = 0 in a quotient is floored at 1: no NaN or Infinity in any column", () => {
    const s = trajectorySeries({ mS: 16, n0: 16, nDec: new Array(1001).fill(4), liveblk: new Array(1001).fill(0) });
    expect(allFinite(s)).toEqual([]);
    expect(s.satFrac[0]).toBe(4);
    expect(windowMeanRatio([6, 6, 6, 6], [0, 0, 0, 0], 2, 3)).toBe(6);
    const der = derridaAnalysis([{ m: 4, n0: 4, nDec: new Array(301).fill(4) }, { m: 8, n0: 8, nDec: new Array(301).fill(8) }], { liveblkT: 0, liveT: 0 });
    expect(allFinite(der)).toEqual([]);
    expect(dustRatio(0, 0, 12)).toBe(0);
    const bank = mkBank({ liveblk: 0, withF: true });
    expect(allFinite(analyzeBank({ ...CORE, liveblkT: 0, liveT: 0 }, bank, "net"))).toEqual([]);
    expect(allFinite(secondColumns({ S: bank.S!.log, N: bank.N!.log, sites: bank.S!.sites, decider: "net" }))).toEqual([]);
    expect(allFinite(censusDivergence({ liveS: 0, liveR: 0, sumBS: 0, sumBR: 0 }))).toEqual([]);
  });

  it("R14 row 48: 4 of 16 sites spread is not OVERLAP, 5 of 16 is (more than a quarter)", () => {
    const rows = (spreadCount: number) => Array.from({ length: 16 }, (_, j) => [4, j < spreadCount ? 20 : 19.5, 3]);
    expect(overlapOf(rows(4)).overlap).toBe(false);
    expect(overlapOf(rows(4)).spreadCount).toBe(4);
    expect(overlapOf(rows(5)).overlap).toBe(true);
    expect(overlapOf(rows(0)).spread.some(Boolean)).toBe(false);
    // 12 sites: 3 is a quarter, 4 is more
    expect(overlapOf(Array.from({ length: 12 }, (_, j) => [j < 3 ? 25 : 1])).overlap).toBe(false);
    expect(overlapOf(Array.from({ length: 12 }, (_, j) => [j < 4 ? 25 : 1])).overlap).toBe(true);
  });

  it("R14 row 49: n0(m) = 0.10 x liveblk_R is run, 0.1001 x is not", () => {
    expect(doseIsRun(8, 1000, 1000, 10000)).toBe(true);
    expect(doseIsRun(8, 1000, 1001, 10000)).toBe(false);
    expect(doseIsRun(8, 1000, 100, 1000)).toBe(true);
    expect(doseIsRun(8, 1000, 101, 1000)).toBe(false);
    expect(fracGT(0, 0, REGIME.UNMET_FRAC)).toBe(false);
  });

  it("R14 row 50: m = N_E / 2 is run, m = N_E / 2 + 1 is not", () => {
    expect(doseIsRun(32, 64, 1, 1000)).toBe(true);
    expect(doseIsRun(33, 64, 1, 1000)).toBe(false);
    expect(doseIsRun(32, 65, 1, 1000)).toBe(true);
    expect(doseIsRun(33, 65, 1, 1000)).toBe(false); // 2 * 33 = 66 > 65
  });

  it("the dose table runs the doses that pass both limits and the origin set is those (R4.5)", () => {
    // N_E = 20 admits m <= 10; liveblk 100 admits n0 <= 10
    const t = doseTable(20, 100, (m) => m);
    expect(t.doses.map((d) => [d.m, d.run])).toEqual([[4, true], [8, true], [16, false], [32, false], [64, false]]);
    expect(t.origin).toEqual([4, 8]);
    expect(doseTable(1000, 50, (m) => m).origin).toEqual([4]);
    expect(kickedBlockIds([voxelAt(0, 0, 0, GS), voxelAt(7, 7, 1, GS), voxelAt(8, 0, 0, GS)], GS)).toEqual([0, 1]);
  });

  it("R14 row 51: an origin set of 1 dose is FEW_DOSES (no D-class, no class); 2 doses give a D-class", () => {
    expect(fewDoses(1)).toBe(true);
    expect(fewDoses(2)).toBe(false);
    const one = analyzeBank(CORE, mkBank({ doses: [4] }), "net");
    expect(one.fewDoses).toBe(true);
    expect(one.dClass).toBeNull();
    expect(one.jobClass).toBeNull();
    expect(one.vote).toBe(false);
    const two = analyzeBank(CORE, mkBank({ doses: [4, 8] }), "net");
    expect(two.fewDoses).toBe(false);
    expect(two.dClass).toBe("CRITICAL");
  });

  it("R14 row 52: a P2 voxel inside three balls with B_R = 10 is kicked once by 5: B_X = 5, never an underflow", () => {
    const g: Geom = { W: 32, H: 32, D: 8 };
    const n = g.W * g.H * g.D;
    const B = new Uint32Array(n).fill(10);
    const c1 = voxelAt(10, 10, 4, g), c2 = voxelAt(12, 10, 4, g), c3 = voxelAt(11, 12, 4, g);
    const v = voxelAt(11, 11, 4, g); // within distance 3 of all three centres
    for (const c of [c1, c2, c3]) expect(ballVoxels(c, g)).toContain(v);
    const plan = kickPlanP2(B, [c1, c2, c3], g);
    const j = Array.from(plan.voxels).indexOf(v);
    expect(plan.amounts[j]).toBe(5);
    const union = new Set([...ballVoxels(c1, g), ...ballVoxels(c2, g), ...ballVoxels(c3, g)]);
    expect(plan.voxels.length).toBe(union.size);
    expect(plan.total).toBe(5 * union.size);
    expect(Array.from(plan.voxels)).toEqual([...union].sort((a, b) => a - b));
    const C = new Uint32Array(n);
    const x = applyKickToChannels(B, C, plan);
    expect(x.B[v]).toBe(5);
    expect(x.C[v]).toBe(5);
    expect(Math.min(...x.B)).toBe(5);
    expect(() => applyKickToChannels(new Uint32Array(n).fill(4), C, plan)).toThrow(/would lose/);
    expect(kickHeat(plan, 10, 2)).toBe(plan.total * 8);
  });

  it("a ball holds at most 123 voxels, wraps in x and y and is clipped at the walls; voxels below B = 3 are not kicked (R4.9)", () => {
    const g: Geom = { W: 32, H: 32, D: 8 };
    expect(ballVoxels(voxelAt(10, 10, 4, g), g)).toHaveLength(123);
    // the disc has 29, 25, 21 and 1 points at |dz| = 0, 1, 2, 3; at the wall z = 0 only dz >= 0 remains: 29 + 25 + 21 + 1
    const wall = ballVoxels(voxelAt(10, 10, 0, g), g);
    expect(wall).toHaveLength(76);
    expect(wall.every((v) => v < 32 * 32 * 4)).toBe(true);
    const wrap = ballVoxels(voxelAt(0, 0, 4, g), g);
    expect(wrap).toContain(voxelAt(31, 31, 4, g));
    expect(wrap).toContain(voxelAt(3, 0, 4, g));
    expect(wrap).not.toContain(voxelAt(4, 0, 4, g));
    const B = new Uint32Array(32 * 32 * 8).fill(2);
    expect(kickPlanP2(B, [voxelAt(10, 10, 4, g)], g).voxels).toHaveLength(0);
    B[voxelAt(10, 10, 4, g)] = 3;
    const plan = kickPlanP2(B, [voxelAt(10, 10, 4, g)], g);
    expect(Array.from(plan.amounts)).toEqual([1]);
  });

  it("R14 row 53: a P2 ball whose voxels all have B between 13 and 15: U kicks 1 at every voxel S kicks, so U is not empty", () => {
    const g: Geom = { W: 32, H: 32, D: 8 };
    const B = new Uint32Array(g.W * g.H * g.D);
    const centre = voxelAt(10, 10, 4, g);
    for (const v of ballVoxels(centre, g)) B[v] = 13 + (v % 3);
    const s = kickPlanP2(B, [centre], g);
    expect(s.voxels).toHaveLength(123);
    const u = unitKickPlan(s, g);
    expect(Array.from(u.voxels)).toEqual(Array.from(s.voxels));
    expect(Array.from(u.amounts).every((a) => a === 1)).toBe(true);
    expect(u.total).toBe(123);
    expect(unitKickAvailable(u.total, s.total)).toBe(true); // 123 of about 800
    // P1: k = 12..15 gives kU = 1, and k = 16 gives 2
    const p1 = kickPlanP1(new Uint32Array(g.W * g.H * g.D).fill(60), [10, 20000], 15, g);
    expect(Array.from(unitKickPlan(p1, g).amounts)).toEqual([1, 1]);
    expect(Array.from(unitKickPlan(kickPlanP1(new Uint32Array(g.W * g.H * g.D).fill(60), [10], 20, g), g).amounts)).toEqual([2]);
    // a ball of voxels at B = 3 (k_v = 1) makes U as big as S: unavailable
    const thin = new Uint32Array(g.W * g.H * g.D);
    for (const v of ballVoxels(centre, g)) thin[v] = 3;
    const ts = kickPlanP2(thin, [centre], g);
    expect(unitKickAvailable(unitKickPlan(ts, g).total, ts.total)).toBe(false);
  });

  it("R4.9 thresholds come from the S twin's kick: thetaB = ceil(M / 2) of the median block sum, thetaV = max(2, ceil(K / 2)) of the median k_v", () => {
    const g: Geom = { W: 32, H: 32, D: 8 };
    const B = new Uint32Array(g.W * g.H * g.D);
    for (const v of ballVoxels(voxelAt(10, 10, 4, g), g)) B[v] = 20; // k_v = 10 at 123 voxels
    const plan = kickPlanP2(B, [voxelAt(10, 10, 4, g)], g);
    const t = thresholdsP2(plan);
    expect(t.thetaV).toBe(5); // K = 10
    const sums = Array.from(plan.blockSums);
    const M = median(sums)!;
    expect(t.thetaB).toBe(Math.ceil(M / 2));
    expect(sums.reduce((a, b) => a + b, 0)).toBe(plan.total);
    // a median of an even count is the mean of the two middle values
    const small = kickPlanP1(new Uint32Array(g.W * g.H * g.D).fill(100), [voxelAt(1, 1, 0, g), voxelAt(20, 20, 0, g)], 12, g);
    expect(thresholdsP2(small)).toEqual({ thetaB: 6, thetaV: 6 });
    expect(thresholdsP2(kickPlanP2(new Uint32Array(g.W * g.H * g.D).fill(4), [voxelAt(5, 5, 0, g)], g)).thetaV).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R6.12 dust, R7 job class, bootstrap, R8 setting class

describe("R14 rows 17 to 32, 73: job class, dust, bootstrap", () => {
  const jc = (o: Partial<Parameters<typeof jobClassOf>[0]>) => jobClassOf({ fewDoses: false, diedInPhase: false, drift: false, tClass: "CRITICAL", tFrozen: false, dClass: "CRITICAL", stT: 1, stD: true, ...o });

  it("R14 row 17: T-class ORDERED frozen with D-class CRITICAL: job class ORDERED, flag FROZEN", () => {
    expect(jc({ tClass: "ORDERED", tFrozen: true, dClass: "CRITICAL" })).toEqual({ cls: "ORDERED", flags: ["FROZEN"] });
  });
  it("R14 row 18: T-class ORDERED frozen with D-class CHAOTIC is MIXED", () => {
    expect(jc({ tClass: "ORDERED", tFrozen: true, dClass: "CHAOTIC" }).cls).toBe("MIXED");
    // a decaying (not frozen) ORDERED T-class does not pair with a CRITICAL D-class
    expect(jc({ tClass: "ORDERED", tFrozen: false, dClass: "CRITICAL" }).cls).toBe("MIXED");
  });
  it("R14 row 19: stT = 0.80 is stable; below it, or stD false, is UNSTABLE, after the FROZEN pairing as well (resolution W3)", () => {
    expect(jc({ stT: 0.8 }).cls).toBe("CRITICAL");
    expect(jc({ stT: 0.7999 }).cls).toBe("UNSTABLE");
    expect(jc({ stD: false }).cls).toBe("UNSTABLE");
    expect(jc({ tClass: "ORDERED", tFrozen: true, dClass: "CRITICAL", stT: 0.5 })).toEqual({ cls: "UNSTABLE", flags: ["FROZEN"] });
    expect(jc({ tClass: "CHAOTIC", dClass: "CHAOTIC" }).cls).toBe("CHAOTIC");
    expect(jc({ tClass: "ORDERED", dClass: "ORDERED" }).cls).toBe("ORDERED");
  });
  it("R14 row 31: a FEW_SITES job with D-class CRITICAL is MIXED, flag D_ONLY", () => {
    expect(jc({ tClass: "NA", dClass: "CRITICAL", stT: null })).toEqual({ cls: "MIXED", flags: ["D_ONLY"] });
    expect(jc({ tClass: "NA", dClass: "CRITICAL", stT: null, stD: false })).toEqual({ cls: "UNSTABLE", flags: ["D_ONLY"] });
    const r = analyzeBank(CORE, mkBank({ mS: 5, withS: false }), "net");
    expect(r.fewSites).toBe(true);
    expect(r.tClass).toBe("NA");
    expect(r.dClass).toBe("CRITICAL");
    expect(r.jobClass).toBe("MIXED");
    expect(r.flags).toEqual(["D_ONLY"]);
  });
  it("R14 row 32: a FEW_SITES job with D-class CHAOTIC and stD: class CHAOTIC, flag D_ONLY, dust UNAVAILABLE (no U twin), no vote", () => {
    expect(jc({ tClass: "NA", dClass: "CHAOTIC", stT: null })).toEqual({ cls: "CHAOTIC", flags: ["D_ONLY"] });
    const r = analyzeBank(CORE, mkBank({ mS: 5, withS: false, s30: 4 }), "net");
    expect(r.jobClass).toBe("CHAOTIC");
    expect(r.flags).toEqual(["D_ONLY"]);
    expect(r.dust).toBe("UNAVAILABLE");
    expect(r.ratioU).toBeNull();
    expect(r.vote).toBe(false);
  });
  it("R14 row 27: ratio_U = 0.2499 / 0.25 / 0.4999 / 0.5 is CLEAR / AMBIG / AMBIG / LIMITED", () => {
    expect([0.2499, 0.25, 0.4999, 0.5].map((x) => dustState(x))).toEqual(["CLEAR", "AMBIG", "AMBIG", "LIMITED"]);
    expect(dustState(null)).toBe("UNAVAILABLE");
  });
  it("R14 row 28: Nbar_S = 0 and Nbar_U = 0 is CLEAR", () => expect(dustState(dustRatio(0, 0, 12))).toBe("CLEAR"));
  it("R14 row 29: Nbar_S = 0 and Nbar_U = 1/(2 m_S) gives ratio_U = 1: LIMITED", () => {
    expect(dustRatio(0, 1 / 24, 12)).toBe(1);
    expect(dustState(dustRatio(0, 1 / 24, 12))).toBe("LIMITED");
  });
  it("R14 row 73: Nbar_U(TAU_DEC) = 0.4999 x Nbar_S(TAU_DEC) is not DUST_LIMITED (AMBIG)", () => {
    expect(dustState(dustRatio(2, 0.4999 * 2, 12))).toBe("AMBIG");
    expect(dustState(dustRatio(2, 0.5 * 2, 12))).toBe("LIMITED");
  });
  it("R14 row 30: a U dose 0.25 x the S dose leaves U available, 0.2501 x makes the dust state UNAVAILABLE", () => {
    expect(unitKickAvailable(25, 100)).toBe(true);
    expect(unitKickAvailable(2501, 10000)).toBe(false);
    const ok = analyzeBank(CORE, { ...mkBank(), U: { ...mkBank().U!, doseU: 36 } }, "net"); // doseS = 12 * 12 = 144: 36 = 0.25 x
    expect(ok.dust).toBe("CLEAR");
    const bad = analyzeBank(CORE, { ...mkBank(), U: { ...mkBank().U!, doseU: 37 } }, "net");
    expect(bad.dust).toBe("UNAVAILABLE");
    expect(bad.ratioU).toBeNull();
    expect(bad.vote).toBe(false);
    expect(bad.jobClass).toBe("CRITICAL"); // the class stands; only the vote is lost
  });

  it("R14 row 20: bootstrap with n_col = 3: resample 0 draws stream positions 0 to 2 and resample 1 positions 3 to 5 (never the same three)", () => {
    const bs = bootstrapSeed(selectionSeed(101, 20000));
    const pos = (u: number) => [0, 1, 2].map((p) => bootstrapDraw(bs, u, p, 3));
    expect(pos(0).map((d) => d.position)).toEqual([0, 1, 2]);
    expect(pos(1).map((d) => d.position)).toEqual([3, 4, 5]);
    expect(pos(0).map((d) => d.colony)).toEqual([0, 1, 2].map((i) => draw(bs, i) % 3));
    expect(pos(1).map((d) => d.colony)).toEqual([3, 4, 5].map((i) => draw(bs, i) % 3));
    expect(bs).toBe(lowbias32((selectionSeed(101, 20000) ^ 0xb007) >>> 0));
    const all = new Set<number>();
    for (let u = 0; u < REGIME.BOOT; u++) for (let p = 0; p < 3; p++) all.add(bootstrapDraw(bs, u, p, 3).position);
    expect(all.size).toBe(REGIME.BOOT * 3);
  });

  it("the bootstrap is deterministic, is 1 for identical colonies, and falls below 1 when a colony disagrees (R7)", () => {
    const h0 = selectionSeed(101, 20000);
    const same = mkBank({ shape: "critical" });
    const ss = siteSeries(same.S!.sites, "net");
    const a = bootstrapStability({ pointClass: "CRITICAL", saturated: false, series: ss, colonies: same.colonies, n0Site: same.n0Site, h0 }, REGIME);
    expect(a).toBe(1);
    // colony 0 (sites 0, 3, 6, 9) dies out after step 200, the other eight sites persist
    const mixed = mkSiteLog(12, (j, t) => (j % 3 === 0 ? Math.max(0, 1.2 - t / 200) : 1), (_, t) => SHAPE.critical.reach(t));
    const sm = siteSeries(mixed, "net");
    const run = () => bootstrapStability({ pointClass: "CRITICAL", saturated: false, series: sm, colonies: same.colonies, n0Site: same.n0Site, h0 }, REGIME);
    const b = run();
    expect(b).toBe(run());
    expect(b!).toBeGreaterThan(0.85);
    expect(b!).toBeLessThan(0.99);
    expect(bootstrapStability({ pointClass: "NA", saturated: false, series: ss, colonies: same.colonies, n0Site: same.n0Site, h0 })).toBeNull();
    // saturation is held at its point value: a saturated point class is CHAOTIC in every resample
    expect(bootstrapStability({ pointClass: "CHAOTIC", saturated: true, series: sm, colonies: same.colonies, n0Site: same.n0Site, h0 })).toBe(1);
  });
});

describe("analyzeBank: one reading of a twin bank", () => {
  const read = (o: BankOpts, decider: "net" | "occ" = "net") => analyzeBank(CORE, mkBank(o), decider);

  it("a flat persistent response that spreads by a block is CRITICAL in both meters and votes", () => {
    const r = read({ shape: "critical" });
    expect(r).toMatchObject({ tClass: "CRITICAL", tFrozen: false, form: "flat", saturated: false, footprint: false, dClass: "CRITICAL", stD: true, stT: 1, dust: "CLEAR", jobClass: "CRITICAL", vote: true, flags: [] });
    expect(r.gridR.every((v) => v === 1)).toBe(true);
    expect(r.b).toBeCloseTo(0, 9);
    expect(r.speed!).toBeGreaterThan(REGIME.SPEED_MIN); // window means of the reach at steps 100 and 1000, about 8.5 voxels over 900 steps
    expect(Math.abs(r.speed! - 8.5 / 900)).toBeLessThan(5e-4);
    expect(r.s30).toBe(1);
    expect(r.s).toEqual([1, 1, 1]);
    expect(r.sS).toEqual([1, 1, 1]);
    expect(r.e).toBeCloseTo(0, 9);
    expect(r.ratioU).toBeCloseTo(0.1, 12);
    expect(r.NbarU).toBeCloseTo(0.1, 12);
  });
  it("a persistent scar that does not spread is ORDERED, form frozen, and pairs with the CRITICAL D-class: ORDERED, flag FROZEN", () => {
    const r = read({ shape: "frozen" });
    expect(r).toMatchObject({ tClass: "ORDERED", tFrozen: true, form: "frozen", dClass: "CRITICAL", jobClass: "ORDERED", flags: ["FROZEN"], vote: true });
  });
  it("damage that dies away is ORDERED (decays) in both meters", () => {
    const r = read({ shape: "ordered", s30: 0.2 });
    expect(r).toMatchObject({ tClass: "ORDERED", tFrozen: false, form: "decays", dClass: "ORDERED", jobClass: "ORDERED", e: -2 });
    expect(r.gridR[7]).toBe(0);
  });
  it("damage growing as t^1 without saturating is CHAOTIC (cone) and, with a CHAOTIC D-class, a CHAOTIC job", () => {
    const r = read({ shape: "chaotic", liveblk: 1e6, s30: 4 });
    expect(r).toMatchObject({ tClass: "CHAOTIC", saturated: false, form: "cone", dClass: "CHAOTIC", jobClass: "CHAOTIC" });
    expect(r.b!).toBeGreaterThan(0.99);
    expect(r.b!).toBeLessThan(1.01);
  });
  it("damage that covers 5 percent of the living blocks and has doubled is saturated: CHAOTIC, e = +2", () => {
    const r = read({ shape: "saturated", s30: 4 });
    expect(r).toMatchObject({ tClass: "CHAOTIC", saturated: true, form: "saturating", e: 2, jobClass: "CHAOTIC" });
  });
  it("a T-class CHAOTIC with a CRITICAL D-class is MIXED and casts no vote", () => {
    const r = read({ shape: "saturated", s30: 1 });
    expect(r).toMatchObject({ tClass: "CHAOTIC", dClass: "CRITICAL", jobClass: "MIXED", vote: false });
  });
  it("dust states follow the ratio of the unit-kick twin: LIMITED and AMBIG jobs keep their class but cast no vote", () => {
    const lim = read({ ratioU: 0.7 });
    expect(lim).toMatchObject({ dust: "LIMITED", jobClass: "CRITICAL", vote: false });
    const amb = read({ ratioU: 0.3 });
    expect(amb).toMatchObject({ dust: "AMBIG", jobClass: "CRITICAL", vote: false });
    expect(marginHits(amb)).toContain("ratioU");
  });
  it("one colony makes the T-class NA (FEW_COLONIES) and the job D_ONLY; a saturated reading is still NA there (R6.4 step 1 comes first)", () => {
    const r = read({ nCol: 1 });
    expect(r).toMatchObject({ fewColonies: true, tClass: "NA", stT: null, dClass: "CRITICAL", jobClass: "MIXED", flags: ["D_ONLY"] });
    expect(read({ nCol: 1, shape: "saturated", s30: 4 })).toMatchObject({ tClass: "NA", jobClass: "CHAOTIC", flags: ["D_ONLY"] });
  });
  it("overlapping damage makes the T-class NA, but a saturated reading stands", () => {
    const bank = mkBank({ shape: "critical" });
    bank.S!.sites = mkSiteLog(12, () => 1, (j, t) => (j < 5 ? 25 : SHAPE.critical.reach(t)));
    expect(analyzeBank(CORE, bank, "net")).toMatchObject({ overlap: true, tClass: "NA", flags: ["D_ONLY"] });
    const sat = mkBank({ shape: "saturated", s30: 4 });
    sat.S!.sites = mkSiteLog(12, (_, t) => t / 50, (j) => (j < 5 ? 25 : 5));
    expect(analyzeBank(CORE, sat, "net")).toMatchObject({ overlap: true, tClass: "CHAOTIC" });
  });
  it("the deciding column is chosen by the decider: net reads n_blk, occ reads n_occ", () => {
    const bank = mkBank();
    bank.S!.log.n_occ = bank.S!.log.n_occ.map((v) => v * 10);
    expect(analyzeBank(CORE, bank, "occ").gridR[0]).toBe(10);
    expect(analyzeBank(CORE, bank, "net").gridR[0]).toBe(1);
    expect(decidingColumn(bank.S!.log, "occ")).toBe(bank.S!.log.n_occ);
  });
  it("the controls: the noise-swapped twin's satFrac at step 100, the frozen pair's class and the damage at step 30", () => {
    const r = read({ withF: true, nSat: 0.5 });
    expect(r.nSat100).toBe(0.5);
    expect(r.fClass).toBe("ORDERED");
    expect(r.nDecF30).toBe(6);
    expect(r.nDecS30).toBe(12);
    expect(r.nDecN30).toBe(150);
    expect(read({ withF: true, fShape: "critical" }).fClass).toBe("CRITICAL");
    expect(read({}).fClass).toBeNull();
    // the F pair is read without the colony clause (resolution W7): one colony still gives a class
    expect(read({ withF: true, nCol: 1 }).fClass).toBe("ORDERED");
  });
  it("go/no-go quantities of the U twin: block-net coverage at TAU_DEC", () => {
    const r = read({ ratioU: 0.1 });
    expect(r.uNetCoverage30).toBeCloseTo((0.1 * 12) / 300, 12);
    expect(r.thetaB).toBe(6);
  });
  it("R6.8 second columns: the non-deciding column, the ceiling ratio and the per-site median and IQR", () => {
    const bank = mkBank({ withF: true });
    const sc = secondColumns({ S: bank.S!.log, N: bank.N!.log, sites: bank.S!.sites, decider: "net" });
    expect(Object.keys(sc.grid)).toContain("n_occ");
    expect(sc.grid.n_occ[0]).toBe(12);
    expect(sc.q[0]).toBeCloseTo(12 / 150, 12);
    expect(sc.siteMedian).toEqual([1, 1, 1]);
    expect(sc.siteIqr).toEqual([0, 0, 0]);
    expect(Object.keys(secondColumns({ S: bank.S!.log, decider: "occ" }).grid)).toContain("n_blk");
  });
});

describe("R14 rows 21 to 26, 65: the setting class", () => {
  const res = (specs: JobSpec[], extended = false) => settingResult(mkJobs("mu30-s8-k256", specs), P1NET, { extended });
  const dusty = (cls: JobClass, dust: DustState, ratioU: number): JobSpec => ({ r: { jobClass: cls, dust, ratioU } });

  it("R14 row 21: 3 seeds ORDERED, ORDERED, MIXED: the setting is ORDERED", () => {
    const r = res(["ORDERED", "ORDERED", "MIXED"]);
    expect(r).toMatchObject({ status: "WINDOWED", cls: "ORDERED", valid: 3, voting: 2, votes: { ORDERED: 2, CRITICAL: 0, CHAOTIC: 0 } });
  });
  it("R14 row 22: 3 seeds ORDERED, CHAOTIC, MIXED: SPLIT", () => expect(res(["ORDERED", "CHAOTIC", "MIXED"]).cls).toBe("SPLIT"));
  it("R14 row 23: 2 valid jobs with equal classes: the setting takes the class", () => {
    const r = res(["CRITICAL", "CRITICAL", "EXTINCT"]);
    expect(r).toMatchObject({ status: "WINDOWED", cls: "CRITICAL", valid: 2 });
  });
  it("R14 row 24: 2 valid jobs with different classes: SPLIT", () => expect(res(["ORDERED", "CHAOTIC", "EXTINCT"]).cls).toBe("SPLIT"));
  it("fewer than 2 valid jobs is INSUFFICIENT, and MIXED and UNSTABLE jobs are valid but cast no vote", () => {
    expect(res(["CRITICAL", "EXTINCT", "CARPET"]).cls).toBe("INSUFFICIENT");
    expect(res(["CRITICAL", "MIXED", "UNSTABLE"])).toMatchObject({ cls: "SPLIT", valid: 3, voting: 1 });
    expect(res(["CRITICAL", "CRITICAL", { diedInPhase: true }]).valid).toBe(2);
    expect(res(["CRITICAL", "CRITICAL", { drift: true }]).valid).toBe(2);
    expect(res(["CRITICAL", "CRITICAL", { invalid: true, invalidChecks: ["C2"] }]).valid).toBe(2);
    expect(res(["CRITICAL", "CRITICAL", { r: { fewDoses: true, jobClass: null } }]).valid).toBe(2);
  });
  it("R14 row 25: 3 valid CRITICAL jobs, two with ratio_U 0.3 and one with 0.1: DUSTY with would-be class CRITICAL", () => {
    const r = res([dusty("CRITICAL", "AMBIG", 0.3), dusty("CRITICAL", "AMBIG", 0.3), "CRITICAL"]);
    expect(r).toMatchObject({ cls: "DUSTY", wouldBe: "CRITICAL", valid: 3, voting: 1 });
  });
  it("R14 row 26: 3 valid CRITICAL jobs, two with ratio_U 0.1 and one with 0.6: the setting is CRITICAL (2 votes)", () => {
    const r = res(["CRITICAL", "CRITICAL", dusty("CRITICAL", "LIMITED", 0.6)]);
    expect(r).toMatchObject({ cls: "CRITICAL", voting: 2, votes: { CRITICAL: 2 } });
  });
  it("two dust-kept jobs make the setting DUSTY even when their classes differ (would-be class SPLIT); one dust-kept job does not (R8.2)", () => {
    expect(res([dusty("CRITICAL", "AMBIG", 0.3), dusty("CHAOTIC", "LIMITED", 0.7), "ORDERED"])).toMatchObject({ cls: "DUSTY", wouldBe: "SPLIT" });
    expect(res([dusty("CRITICAL", "AMBIG", 0.3), "CHAOTIC", "ORDERED"])).toMatchObject({ cls: "SPLIT", wouldBe: "SPLIT" });
    expect(res([dusty("CRITICAL", "UNAVAILABLE", 0.3), dusty("CRITICAL", "UNAVAILABLE", 0.3), "MIXED"])).toMatchObject({ cls: "DUSTY", wouldBe: "CRITICAL" });
  });
  it("the status comes from the first three seeds: UNMETERABLE, then CARPET, then RELIC, else windowed", () => {
    expect(settingStatus(mkJobs("w", ["EXTINCT", "NO_TARGET", "CARPET"]))).toBe("UNMETERABLE");
    expect(settingStatus(mkJobs("w", ["CARPET", "CARPET", "RELIC"]))).toBe("CARPET");
    expect(settingStatus(mkJobs("w", ["RELIC", "RELIC", "CARPET"]))).toBe("RELIC");
    expect(settingStatus(mkJobs("w", ["EXTINCT", "CARPET", "CRITICAL"]))).toBe("WINDOWED");
    expect(settingStatus(mkJobs("w", ["CARPET", "RELIC", "CRITICAL"]))).toBe("WINDOWED");
    expect(settingStatus(mkJobs("w", ["EXTINCT", "CRITICAL", "CRITICAL", "EXTINCT", "EXTINCT", "EXTINCT"]))).toBe("WINDOWED"); // extension seeds do not change it
    const r = res(["CARPET", "CARPET", "CRITICAL"]);
    expect(r.status).toBe("CARPET");
    expect(r.cls).toBeNull();
  });
  it("R14 row 65: with 6 seeds, 6 voting jobs 4-2 give the class, 3-3 gives SPLIT, and 4 voting jobs give SPLIT", () => {
    expect(res(["CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "ORDERED", "ORDERED"], true).cls).toBe("CRITICAL");
    expect(res(["CRITICAL", "CRITICAL", "CRITICAL", "ORDERED", "ORDERED", "ORDERED"], true).cls).toBe("SPLIT");
    expect(res(["CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "EXTINCT", "EXTINCT"], true).cls).toBe("SPLIT");
    // 5 voting jobs: 4-1 gives the class, 3-2 does not
    expect(res(["CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "ORDERED", "EXTINCT"], true).cls).toBe("CRITICAL");
    expect(res(["CRITICAL", "CRITICAL", "CRITICAL", "ORDERED", "ORDERED", "EXTINCT"], true).cls).toBe("SPLIT");
    // two classes at the threshold never pick a class
    expect(res(["CRITICAL", "CRITICAL", "CRITICAL", "ORDERED", "ORDERED", "ORDERED"], false).cls).toBe("SPLIT");
  });
  it("R8.4: ell is the median over the voting jobs of ln(max(s(TAU_DEC), S_FLOOR)), and its values give B0's range", () => {
    const r = res([{ r: { s30: 0.5 } }, { r: { s30: 1 } }, { r: { s30: 2 } }]);
    expect(r.ell).toBeCloseTo(0, 12);
    expect(r.ellVals.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-0.693147, 0, 0.693147]);
    expect(res([{ r: { s30: 0 } }, { r: { s30: 0 } }, "CRITICAL"]).ell).toBeCloseTo(Math.log(0.01), 12);
    expect(res(["EXTINCT", "EXTINCT", "EXTINCT"]).ell).toBeNull();
  });
  it("R10.5 counters over the valid jobs: D_ONLY, those with a U twin, and the AMBIG or LIMITED ones", () => {
    const r = res([{ r: { flags: ["D_ONLY"], dust: "UNAVAILABLE", jobClass: "MIXED" } }, dusty("CRITICAL", "AMBIG", 0.3), dusty("CRITICAL", "LIMITED", 0.7)]);
    expect(r).toMatchObject({ valid: 3, nDonly: 1, nWithU: 2, nAmbigLimited: 2 });
  });
  it("pool and class-bearing predicates: the control is never in the pool; INSUFFICIENT is not; SPLIT and DUSTY are, without a class", () => {
    const rows = table({ [B0_ID]: ["CRITICAL", "CRITICAL", "CRITICAL"], "mu30-s8-k256-nomut": ["CRITICAL", "CRITICAL", "CRITICAL"], "mu20-s8-k256": ["CRITICAL", "EXTINCT", "EXTINCT"], "mu40-s8-k256": ["CRITICAL", "ORDERED", "CHAOTIC"] });
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(isClassBearing(by(B0_ID))).toBe(true);
    expect(isClassBearing(by("mu30-s8-k256-nomut"))).toBe(false);
    expect(by("mu20-s8-k256").result.status).toBe("UNMETERABLE");
    expect(by("mu40-s8-k256").result.cls).toBe("SPLIT");
    expect(isClassBearing(by("mu40-s8-k256"))).toBe(false);
    expect(by("mu30-s12-k256").result.status).toBe("CARPET");
  });
});

describe("R5 validity checks and R10.1", () => {
  const baseSubject = { kind: "slab" as const, seed: 101, dev: false, changedUnvariedKey: false };
  it("R14 row 66: C4 for seed 104, for a group-C or group-D setting, for a development seed: m4Source none, skipped, not counted as passed", () => {
    for (const subject of [{ ...baseSubject, seed: 104 }, { ...baseSubject, changedUnvariedKey: true }, { ...baseSubject, seed: 9001, dev: true }, { ...baseSubject, kind: "2d" as const }]) {
      expect(c4Applicable(subject)).toBe(false);
      const r = checkC4({ subject, cells: 524288, living5k: [1, 2, 3, 4], m4Living5k: [9, 9, 9, 9] });
      expect(r).toMatchObject({ ok: true, applicable: false, mode: "none" });
      expect(c4GateAccepts(r)).toBe(false);
      expect(invalidChecks({ C4: r })).toEqual([]);
    }
    expect(c4Applicable(baseSubject)).toBe(true);
    expect(c4Applicable({ ...baseSubject, seed: 103 })).toBe(true);
  });
  it("C4 compares the living trace exactly (json) and the extinction step; a mismatch makes the job INVALID", () => {
    const ok = checkC4({ subject: baseSubject, cells: 524288, living5k: [100, 200, 300, 400], m4Living5k: [100, 200, 300, 400] });
    expect(ok).toMatchObject({ ok: true, mode: "json" });
    expect(c4GateAccepts(ok)).toBe(true);
    const bad = checkC4({ subject: baseSubject, cells: 524288, living5k: [100, 200, 300, 401], m4Living5k: [100, 200, 300, 400] });
    expect(bad.ok).toBe(false);
    expect(invalidChecks({ C4: bad })).toEqual(["C4"]);
    expect(checkC4({ subject: baseSubject, cells: 524288, living5k: [], m4Living5k: [], extinctAt: 6000, m4ExtinctAt: 6000 }).ok).toBe(true);
    expect(checkC4({ subject: baseSubject, cells: 524288, living5k: [], m4Living5k: [], extinctAt: 6000, m4ExtinctAt: 7000 }).ok).toBe(false);
  });
  it("R14 row 67: C4 with only the TSV is mode tsv-rounded (within 0.00005); the gate refuses it and the sweep counts it separately", () => {
    const ok = checkC4({ subject: baseSubject, mode: "tsv-rounded", cells: 524288, living5k: [1000], m4Tsv5k: [0.0019] });
    expect(ok).toMatchObject({ ok: true, mode: "tsv-rounded" });
    expect(c4GateAccepts(ok)).toBe(false);
    expect(checkC4({ subject: baseSubject, mode: "tsv-rounded", cells: 524288, living5k: [1000], m4Tsv5k: [0.002] }).ok).toBe(false);
  });
  it("the repro line counts exact-JSON comparisons, rounded-TSV comparisons and the jobs C4 does not apply to", () => {
    const j = (mode: "json" | "tsv-rounded" | "none" | undefined, failed = false) => sj({ m4Mode: mode, invalid: failed, invalidChecks: failed ? ["C4"] : [] });
    expect(reproCounts([j("json"), j("json"), j("json", true), j("tsv-rounded"), j("none"), j(undefined)])).toEqual({ json: { passed: 2, total: 3 }, tsv: { passed: 1, total: 1 }, notApplicable: 2 });
    expect(reproCounts([])).toEqual({ json: { passed: 0, total: 0 }, tsv: { passed: 0, total: 0 }, notApplicable: 0 });
  });
  it("R14 row 91: C1 with equal counters but one genome word different at step 100 is INVALID (the full-state hash differs)", () => {
    const zeros = Object.fromEntries(DIFF_COLUMNS.map((k) => [k, new Array(101).fill(0)]));
    expect(checkC1({ counters: zeros, hashZ: "ab12", hashR: "ab12" })).toEqual({ ok: true });
    const r = checkC1({ counters: zeros, hashZ: "ab12", hashR: "ab13" });
    expect(r.ok).toBe(false);
    expect(invalidChecks({ C1: r })).toEqual(["C1"]);
    const nonzero = { ...zeros, n_1: [0, 0, 1, ...new Array(98).fill(0)] };
    expect(checkC1({ counters: nonzero, hashZ: "x", hashR: "x" }).ok).toBe(false);
    expect(checkC1({ counters: { ...zeros, n_vox: undefined }, hashZ: "x", hashR: "x" }).ok).toBe(false);
  });
  it("C2, C3, C5, C6, C7 and C8 on their cases", () => {
    expect(checkC2([{ name: "R", matterStart: "100", matterEnd: "100", residual: "0" }, { name: "S", matterStart: "100", matterEnd: "100", residual: "0" }]).ok).toBe(true);
    expect(checkC2([{ name: "S", matterStart: "100", matterEnd: "99", residual: "0" }]).ok).toBe(false);
    // a kick without its heat entry leaves a residual of exactly -(sum of kicks) * (eB - eC)
    const plan = kickPlanP1(new Uint32Array(SLAB_GEOM.W * SLAB_GEOM.H * SLAB_GEOM.D).fill(50), [10, 3000], 12, SLAB_GEOM);
    expect(checkC2([{ name: "S", matterStart: "5", matterEnd: "5", residual: String(-kickHeat(plan, 10, 2)) }]).ok).toBe(false);
    expect(checkC3([]).ok).toBe(true);
    expect(checkC3(["matter"]).ok).toBe(false);
    const row0 = { n_blk: 2, n_occ: 0, L1c: 24, n_live: 0, L1_A: 0, L1_P: 0, L1_B: 24, L1_C: 24 } as unknown as DiffRow;
    expect(checkC5({ row0, plan, thetaB: 6, rung: "P1" }).ok).toBe(true);
    expect(checkC5({ row0: { ...row0, n_occ: 1 }, plan, thetaB: 6, rung: "P1" }).ok).toBe(false);
    expect(checkC5({ row0: { ...row0, L1_B: 23 }, plan, thetaB: 6, rung: "P1" }).ok).toBe(false);
    expect(checkC5({ row0: { ...row0, n_blk: 1 }, plan, thetaB: 6, rung: "P1" }).ok).toBe(false);
    expect(checkC6({ ruleSha: "a", ruleShaRecorded: "a", codeCommit: "c", srcHash: "s", treeClean: true }).ok).toBe(true);
    expect(checkC6({ ruleSha: "a", ruleShaRecorded: "b", codeCommit: "c", srcHash: "s", treeClean: true }).ok).toBe(false);
    expect(checkC6({ ruleSha: "a", ruleShaRecorded: "a", codeCommit: "c", srcHash: "s", treeClean: false }).ok).toBe(false);
    expect(checkC6({ ruleSha: "a", ruleShaRecorded: "a", srcHash: "s", treeClean: true }).ok).toBe(false);
    expect(checkC7(70600, 70600).ok).toBe(true);
    expect(checkC7(70600, 70601).ok).toBe(false);
    expect(checkC8(["seed"], ["seed"]).ok).toBe(true);
    expect(checkC8(["dtQ", "motility"], ["motility", "dtQ"]).ok).toBe(true);
    expect(checkC8(["seed", "dtQ"], ["seed"]).ok).toBe(false);
    expect(noiseSeed(101)).toBe(lowbias32((101 ^ 0x4e4e4e4e) >>> 0));
  });
  it("R14 row 87: a bank with one INVALID job is INVALID-RUN and the readout exits non-zero; so do mixed stamps; dev jobs are ignored", () => {
    const bad = sj({ invalid: true, invalidChecks: ["C1"], id: "slab-x" });
    const v = validateRun([sj(), bad]);
    expect(v).toMatchObject({ fatal: true, invalid: [{ id: "slab-x", checks: ["C1"] }] });
    const o = outcome(table({}), { validation: v });
    expect(o).toMatchObject({ id: "INVALID-RUN", fatal: true, inference: false });
    expect(validateRun([sj(), sj({ stamps: { ruleSha: "other", codeCommit: "c", srcHash: "s" } })])).toMatchObject({ fatal: true, mixed: { ruleSha: ["other", "r"] } });
    expect(validateRun([sj(), sj({ stamps: { ruleSha: "r", codeCommit: "c2", srcHash: "s" } })]).fatal).toBe(true);
    expect(validateRun([sj(), sj({ stamps: { ruleSha: "r", codeCommit: "c", srcHash: "s2" } })]).fatal).toBe(true);
    expect(validateRun([sj(), sj()]).fatal).toBe(false);
    expect(validateRun([sj(), sj({ dev: true, invalid: true, invalidChecks: ["C1"] })]).fatal).toBe(false);
    // INVALID-RUN comes before every other clause, the gate failure included
    expect(outcome(table({}), { validation: v, gate: { pass: false, causes: [] } }).id).toBe("INVALID-RUN");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R9 The gate and Stage 0

const ALL_KEYS: ComboKey[] = ["P1-net", "P1-occ", "P2-net", "P2-occ"];
const PRESETS = ["spots-m3", "gradient-m3"] as const;
/** The 2D reference worlds are read at T1 and T2 only (R1, R9.1): the registered 2D worlds are still filling at T0 (answer G1 of 2026-10-24). */
const GATE_TIMES = [...refTimes()];
interface GateCtx { key: ComboKey; role: "G2" | "G3"; preset: string; T: number; seed: number }
const CHAOTIC_R: Partial<JobReading> = { jobClass: "CHAOTIC", tClass: "CHAOTIC", dClass: "CHAOTIC", s30: 4 };

/**
 * The jobs of a gate: G1 (three extinct jobs reproducing M4's), G2 (two 2D presets at T1 and T2, three seeds each) and G3 (the carpet, three seeds),
 * each with a reading under every combination. By default the alive worlds read CRITICAL, the carpet CHAOTIC, every dust state is CLEAR and
 * the controls sit at their ends; `f` overrides readings per job and combination.
 */
function gateJobs(f: (c: GateCtx) => Partial<JobReading> | undefined = () => undefined, o: { withG1?: boolean; dev?: boolean; keys?: ComboKey[] } = {}): JobSummary[] {
  const jobs: JobSummary[] = [];
  const seeds = o.dev ? SEEDS.dev : SEEDS.main;
  const keys = o.keys ?? ALL_KEYS;
  if (o.withG1 !== false && !o.dev)
    for (const seed of SEEDS.main) jobs.push(sj({ id: `g1-${seed}`, role: "G1", world: "mu20-s8-k256", seed, extinct: true, extinctAt: 6000, flag: null, readings: {}, m4Mode: "json" }));
  const make = (role: "G2" | "G3", preset: string, T: number, seed: number) => {
    const readings: Partial<Record<ComboKey, JobReading>> = {};
    for (const key of keys) {
      const ctx: GateCtx = { key, role, preset, T, seed };
      const base = role === "G3" ? CHAOTIC_R : {};
      readings[key] = reading({ rung: key.slice(0, 2) as "P1" | "P2", decider: key.slice(3) as "net" | "occ", ...base, ...(f(ctx) ?? {}) });
    }
    jobs.push(sj({ id: `${role}-${preset}-${seed}-t${T}`, role, kind: role === "G2" ? "2d" : "slab", world: preset, seed, T, flag: role === "G3" ? "CARPET" : "IN_WINDOW", dev: !!o.dev, readings }));
  };
  for (const preset of PRESETS) for (const T of GATE_TIMES) for (const seed of seeds) make("G2", preset, T, seed);
  for (const seed of seeds) make("G3", "mu60-s8-k1024", REGIME.T0, seed);
  return jobs;
}
const GATE_OK = { withG1: true };
const codes = (causes: { code: string }[]) => causes.map((c) => c.code);

describe("R14 rows 74 to 81: the held-out gate", () => {
  it("R14 row 74: G1 passes, refClass CRITICAL, carpet CHAOTIC, controls and dust fine: PASS, target CRITICAL", () => {
    const g = evaluateGate(gateJobs(), P1NET, GATE_OK);
    expect(g.pass).toBe(true);
    expect(g.refClass).toBe("CRITICAL");
    expect(g.g3.carpetClass).toBe("CHAOTIC");
    expect(g.causes).toEqual([]);
    expect(g.g1).toEqual({ holds: true, causes: [] });
    expect(Object.values(g.g2.classes)).toEqual(new Array(4).fill("CRITICAL"));
    expect(Object.keys(g.g2.classes)).toEqual(["spots-m3@50000", "spots-m3@100000", "gradient-m3@50000", "gradient-m3@100000"]); // no T0 group (G1)
    expect(ampLabel(gateJobs(), P1NET, "CRITICAL")).toBe("AMP-ROBUST");
  });
  it("G1 needs all three jobs extinct, valid and compared with M4's JSON in mode json", () => {
    expect(evaluateGate(gateJobs((c) => undefined).filter((j) => j.id !== "g1-103"), P1NET, GATE_OK).pass).toBe(false);
    const tsv = gateJobs().map((j) => (j.role === "G1" && j.seed === 102 ? { ...j, m4Mode: "tsv-rounded" as const } : j));
    expect(codes(evaluateGate(tsv, P1NET, GATE_OK).causes)).toEqual(["G1-REPRO-FAIL"]);
    const alive = gateJobs().map((j) => (j.role === "G1" && j.seed === 101 ? { ...j, extinct: false } : j));
    expect(evaluateGate(alive, P1NET, GATE_OK).g1!.holds).toBe(false);
    expect(evaluateGate(gateJobs(undefined, { withG1: false }), P1NET, { withG1: false }).g1).toBeNull();
  });
  it("R14 row 75: a carpet class equal to refClass fails CARPET-NOT-SEPARATED", () => {
    const g = evaluateGate(gateJobs((c) => (c.role === "G3" ? { jobClass: "CRITICAL", tClass: "CRITICAL", dClass: "CRITICAL" } : undefined)), P1NET, GATE_OK);
    expect(g.pass).toBe(false);
    expect(codes(g.causes)).toEqual(["CARPET-NOT-SEPARATED"]);
  });
  it("a carpet with no class held by 2 of 3 jobs fails CARPET-UNDEFINED (also when the carpet is NO_TARGET)", () => {
    const split = gateJobs((c) => (c.role === "G3" ? { jobClass: (["ORDERED", "CRITICAL", "CHAOTIC"] as const)[c.seed - 101], vote: true } : undefined));
    expect(codes(evaluateGate(split, P1NET, GATE_OK).causes)).toEqual(["CARPET-UNDEFINED"]);
    const nt = gateJobs().map((j) => (j.role === "G3" ? { ...j, noTarget: true, flag: null, readings: {} } : j));
    const g = evaluateGate(nt, P1NET, GATE_OK);
    expect(codes(g.causes)).toContain("CARPET-UNDEFINED");
    expect(codes(g.causes)).toContain("DUST-CONTROL-UNAVAILABLE");
  });
  it("the carpet votes whatever the CARPET flag (G3), but the alive worlds must be IN_WINDOW (G2, resolution W4)", () => {
    expect(gateJobs().filter((j) => j.role === "G3").every((j) => j.flag === "CARPET")).toBe(true);
    expect(groupClass(gateJobs().filter((j) => j.role === "G3"), P1NET, "any")).toBe("CHAOTIC");
    expect(groupClass(gateJobs().filter((j) => j.role === "G3"), P1NET, "window")).toBeNull();
    const carpets2d = gateJobs().map((j) => (j.role === "G2" && j.world === "spots-m3" && j.T === REGIME.T2 ? { ...j, flag: "CARPET" as const } : j));
    const g = evaluateGate(carpets2d, P1NET, GATE_OK);
    expect(codes(g.causes)).toContain("REF-UNDEFINED");
    expect(g.g2.classes["spots-m3@100000"]).toBeNull();
  });
  it("R14 row 76: presets reading CRITICAL and CHAOTIC fail REFS-DISAGREE", () => {
    const g = evaluateGate(gateJobs((c) => (c.preset === "gradient-m3" && c.role === "G2" ? CHAOTIC_R : undefined)), P1NET, GATE_OK);
    expect(codes(g.causes)).toEqual(["REFS-DISAGREE"]); // with no refClass the carpet has nothing to be separated from
    expect(g.refClass).toBeNull();
    expect(g.g3.holds).toBe(false);
  });
  it("R14 row 77: spots-m3 CRITICAL at T1 and CHAOTIC at T2 fails REF-UNSTABLE", () => {
    const g = evaluateGate(gateJobs((c) => (c.preset === "spots-m3" && c.T === REGIME.T2 ? CHAOTIC_R : undefined)), P1NET, GATE_OK);
    expect(codes(g.causes)).toEqual(["REF-UNSTABLE"]);
    expect(g.causes[0].where).toEqual(["spots-m3"]);
  });
  it("an ORDERED alive world fails REF-ORDERED, and a group with no class held by 2 jobs fails REF-UNDEFINED", () => {
    const ord = evaluateGate(gateJobs((c) => (c.role === "G2" ? { jobClass: "ORDERED", tClass: "ORDERED", dClass: "ORDERED", s30: 0.2 } : undefined)), P1NET, GATE_OK);
    expect(codes(ord.causes)).toEqual(["REF-ORDERED"]);
    expect(ord.g2.refClass).toBeNull();
    const undef = evaluateGate(gateJobs((c) => (c.role === "G2" && c.preset === "gradient-m3" && c.T === REGIME.T1 ? { jobClass: (["ORDERED", "CRITICAL", "CHAOTIC"] as const)[c.seed - 101] } : undefined)), P1NET, GATE_OK);
    expect(codes(undef.causes)).toContain("REF-UNDEFINED");
    expect(undef.causes.find((x) => x.code === "REF-UNDEFINED")!.where).toEqual(["gradient-m3@50000"]);
  });
  it("R14 row 78: a group with only 1 of 3 jobs DUST_CLEAR fails with the dust states present", () => {
    const dust = (state: DustState) => gateJobs((c) => (c.role === "G2" && c.preset === "spots-m3" && c.T === REGIME.T1 && c.seed !== 101 ? { dust: state, vote: false } : undefined));
    const lim = evaluateGate(dust("LIMITED"), P1NET, GATE_OK);
    expect(codes(lim.g6.causes)).toEqual(["DUST-LIMITED"]);
    expect(lim.g6.causes[0].where).toEqual(["spots-m3@50000"]);
    expect(lim.pass).toBe(false);
    expect(codes(evaluateGate(dust("AMBIG"), P1NET, GATE_OK).g6.causes)).toEqual(["DUST-AMBIGUOUS"]);
    expect(codes(evaluateGate(dust("UNAVAILABLE"), P1NET, GATE_OK).g6.causes)).toEqual(["DUST-CONTROL-UNAVAILABLE"]);
    // mixed states are all printed
    const mixed = gateJobs((c) => (c.role === "G3" && c.seed !== 101 ? { dust: c.seed === 102 ? "LIMITED" : "AMBIG", vote: false } : undefined));
    expect(codes(evaluateGate(mixed, P1NET, GATE_OK).g6.causes)).toEqual(["DUST-LIMITED", "DUST-AMBIGUOUS"]);
    // 2 of 3 CLEAR is enough
    expect(evaluateG6(gateJobs((c) => (c.role === "G3" && c.seed === 101 ? { dust: "LIMITED", vote: false } : undefined)), P1NET).holds).toBe(true);
  });
  it("R14 row 79: the F pair reading CRITICAL in one job fails FROZEN-NOT-ORDERED (an NA class fails too)", () => {
    const one = evaluateGate(gateJobs((c) => (c.role === "G2" && c.preset === "spots-m3" && c.T === REGIME.T1 && c.seed === 102 ? { fClass: "CRITICAL" } : undefined)), P1NET, GATE_OK);
    expect(codes(one.causes)).toEqual(["FROZEN-NOT-ORDERED"]);
    expect(one.causes[0].where).toEqual(["G2-spots-m3-102-t50000"]);
    expect(codes(evaluateGate(gateJobs((c) => (c.role === "G3" && c.seed === 101 ? { fClass: "NA" } : undefined)), P1NET, GATE_OK).causes)).toEqual(["FROZEN-NOT-ORDERED"]);
  });
  it("R14 row 80: the N twin with satFrac 0.04 at step 100 in one job fails N-NOT-SATURATED", () => {
    const g = evaluateGate(gateJobs((c) => (c.role === "G2" && c.preset === "gradient-m3" && c.T === REGIME.T1 && c.seed === 103 ? { nSat100: 0.04 } : undefined)), P1NET, GATE_OK);
    expect(codes(g.causes)).toEqual(["N-NOT-SATURATED"]);
    expect(evaluateG7(gateJobs((c) => (c.seed === 101 ? { nSat100: 0.05 } : undefined)), P1NET).holds).toBe(true);
    expect(evaluateG7(gateJobs((c) => (c.seed === 101 ? { nSat100: null } : undefined)), P1NET).holds).toBe(false);
  });
  it("R14 row 81: n_dec,F(TAU_DEC) >= n_dec,S(TAU_DEC) in one job fails NO-CONTRAST-WITH-CONTROLS (and so does S >= N, and a tie)", () => {
    const f = (o: Partial<JobReading>) => gateJobs((c) => (c.role === "G3" && c.seed === 103 ? o : undefined));
    expect(codes(evaluateGate(f({ nDecF30: 20 }), P1NET, GATE_OK).causes)).toEqual(["NO-CONTRAST-WITH-CONTROLS"]);
    expect(codes(evaluateGate(f({ nDecF30: 25 }), P1NET, GATE_OK).causes)).toEqual(["NO-CONTRAST-WITH-CONTROLS"]);
    expect(codes(evaluateGate(f({ nDecS30: 100 }), P1NET, GATE_OK).causes)).toEqual(["NO-CONTRAST-WITH-CONTROLS"]);
    expect(codes(evaluateGate(f({ nDecN30: null }), P1NET, GATE_OK).causes)).toEqual(["NO-CONTRAST-WITH-CONTROLS"]);
    expect(evaluateGate(f({ nDecF30: 19.999 }), P1NET, GATE_OK).pass).toBe(true);
  });
  it("G5: an INVALID gate job fails the gate with INVALID-JOB; the gate is evaluated per combination", () => {
    const jobs = gateJobs().map((j) => (j.id === "G2-spots-m3-101-t50000" ? { ...j, invalid: true, invalidChecks: ["C2" as const] } : j));
    const g = evaluateGate(jobs, P1NET, GATE_OK);
    expect(codes(g.g5.causes)).toEqual(["INVALID-JOB"]);
    expect(g.pass).toBe(false);
    const by = gateJobs((c) => (c.key === "P1-occ" && c.role === "G3" ? { jobClass: "CRITICAL" } : undefined));
    expect(evaluateGate(by, P1NET, GATE_OK).pass).toBe(true);
    expect(codes(evaluateGate(by, P1OCC, GATE_OK).causes)).toEqual(["CARPET-NOT-SEPARATED"]);
  });
  it("R14 row 106: G8: AMP-ROBUST if the other rung reads refClass in both 2D presets at T1, else AMP-DEPENDENT", () => {
    expect(ampLabel(gateJobs(), P1NET, "CRITICAL")).toBe("AMP-ROBUST");
    const dep = gateJobs((c) => (c.key === "P2-net" && c.role === "G2" && c.preset === "spots-m3" && c.T === REGIME.T1 ? CHAOTIC_R : undefined));
    expect(ampLabel(dep, P1NET, "CRITICAL")).toBe("AMP-DEPENDENT");
    expect(ampLabel(dep, P2NET, "CRITICAL")).toBe("AMP-ROBUST"); // the other rung of (P2, net) is P1, unchanged
    const both = gateJobs((c) => (c.key.startsWith("P2") && c.role === "G2" ? CHAOTIC_R : undefined));
    expect(ampLabel(both, P1NET, "CRITICAL")).toBe("AMP-DEPENDENT");
    expect(ampLabel(both, P1NET, "CHAOTIC")).toBe("AMP-ROBUST");
  });
});

describe("R14 rows 82 to 86: Stage 0", () => {
  const stage = (f?: (c: GateCtx) => Partial<JobReading> | undefined, run = 1, o: { extra?: JobSummary[] } = {}) => stage0([...gateJobs(f, { dev: true }), ...(o.extra ?? [])], run);
  /** `bad` combinations read ORDERED in the alive worlds (REF-ORDERED), the others read as usual. */
  const failing = (bad: ComboKey[], extra?: (c: GateCtx) => Partial<JobReading> | undefined) => (c: GateCtx) =>
    (bad.includes(c.key) && c.role === "G2" ? { jobClass: "ORDERED" as const, tClass: "ORDERED" as const, dClass: "ORDERED" as const, s30: 0.2 } : undefined) ?? extra?.(c);

  it("every metered Stage 0 job is a development job: seeds 9001 to 9003, ids prefixed dev- by the runner", () => {
    const jobs = gateJobs(undefined, { dev: true });
    expect(new Set(jobs.map((j) => j.seed))).toEqual(new Set(SEEDS.dev));
    expect(jobs.every((j) => j.dev)).toBe(true);
    expect(jobs.filter((j) => j.role === "G1")).toHaveLength(0);
    expect(jobId({ dev: true, kind: "2d", world: "spots-m3", seed: 9001, T: 50000, rung: "P1" })).toBe("dev-2d-spots-m3-seed9001-t50000-P1");
    // the 2D reference worlds are read at T1 and T2: no Stage 0 job of a 2D world starts at T0 (answer G1)
    expect(jobs.filter((j) => j.kind === "2d").map((j) => j.T).every((T) => T === REGIME.T1 || T === REGIME.T2)).toBe(true);
    expect(jobs.filter((j) => j.kind === "2d")).toHaveLength(12);
  });
  it("R14 row 82: (P1, net) fails with REF-ORDERED, (P1, occ) passes with a dust ratio 0.30: (P1, occ) is MARGINAL and the next combination in order is tried", () => {
    const r = stage(failing(["P1-net"], (c) => (c.key === "P1-occ" && c.role === "G2" && c.preset === "spots-m3" && c.T === REGIME.T1 && c.seed === 9001 ? { dust: "AMBIG", ratioU: 0.3 } : undefined)));
    const [pn, po, p2n] = r.combos;
    expect(codes(pn.causes)).toContain("REF-ORDERED");
    expect(po.gate.pass).toBe(true);
    expect(po.marginal).toEqual([{ job: "G2-spots-m3-9001-t50000", quantities: ["ratioU"] }]);
    expect(codes(po.causes)).toEqual(["MARGINAL"]);
    expect(po.satisfies).toBe(false);
    expect(p2n.satisfies).toBe(true);
    expect(r.selected).toEqual(P2NET);
    expect(r.outcome).toBe("STAGE0-PASS");
  });
  it("R14 row 83: (P1, net) and (P2, net) both pass with margins: (P1, net) is selected", () => {
    const r = stage(failing(["P1-occ"]));
    expect(r.combos.map((c) => c.satisfies)).toEqual([true, false, true, true]);
    expect(r.selected).toEqual(P1NET);
    expect(r.outcome).toBe("STAGE0-PASS");
  });
  it("each of the four combinations is the first to pass in its own table", () => {
    for (let i = 0; i < 4; i++) {
      const bad = ALL_KEYS.slice(0, i);
      const r = stage(failing(bad));
      expect(r.selected).toEqual(COMBINATIONS[i]);
      expect(r.outcome).toBe("STAGE0-PASS");
    }
    // a later combination passing does not matter if an earlier one is selected
    expect(stage(failing([])).selected).toEqual(P1NET);
  });
  it("R14 row 84: all four fail: run 1 is STAGE0-FAIL, run 3 is STAGE0-CLOSED, with the causes of all four", () => {
    const f = failing(ALL_KEYS);
    const r1 = stage(f, 1);
    expect(r1).toMatchObject({ outcome: "STAGE0-FAIL", selected: null, run: 1 });
    expect(r1.combos.every((c) => codes(c.causes).includes("REF-ORDERED"))).toBe(true);
    expect(stage(f, 2).outcome).toBe("STAGE0-FAIL");
    expect(stage(f, 3)).toMatchObject({ outcome: "STAGE0-CLOSED", selected: null, run: 3 });
  });
  it("a failing control, a dust-limited carpet and an unstable reference fail their combination in Stage 0 as in the gate", () => {
    const ctl = stage((c) => (c.key === "P1-net" && c.role === "G2" && c.seed === 9001 ? { fClass: "CRITICAL" } : undefined));
    expect(codes(ctl.combos[0].causes)).toEqual(["FROZEN-NOT-ORDERED"]);
    expect(ctl.selected).toEqual(P1OCC);
    const dustCarpet = stage((c) => (c.key === "P1-net" && c.role === "G3" && c.seed !== 9001 ? { dust: "LIMITED", vote: false } : undefined));
    expect(codes(dustCarpet.combos[0].causes)).toEqual(["CARPET-UNDEFINED", "DUST-LIMITED"]);
    const unstable = stage((c) => (c.key === "P1-net" && c.preset === "gradient-m3" && c.T === REGIME.T2 ? CHAOTIC_R : undefined));
    expect(codes(unstable.combos[0].causes)).toEqual(["REF-UNSTABLE"]);
    expect(stage().combos[0].gate.g1).toBeNull(); // Stage 0 has no G1
  });
  it("the margin condition covers the pooled ratio, the stability and the saturation grid, on either side of the threshold", () => {
    const m = (o: Partial<JobReading>) => marginHits(reading(o));
    expect(m({})).toEqual([]);
    expect(m({ ratioU: 0.35 })).toEqual(["ratioU"]); // 0.10 above 0.25, inclusive
    expect(m({ ratioU: 0.15 })).toEqual(["ratioU"]); // 0.10 below 0.25, inclusive
    expect(m({ ratioU: 0.149 })).toEqual([]);
    expect(m({ ratioU: 0.6 })).toEqual(["ratioU"]);
    expect(m({ ratioU: 0.7 })).toEqual([]);
    expect(m({ s30: 0.4 })).toEqual(["s30"]); // 0.5 / 1.25
    expect(m({ s30: 0.625 })).toEqual(["s30"]);
    expect(m({ s30: 0.39 })).toEqual([]);
    expect(m({ s30: 1.6 })).toEqual(["s30"]);
    expect(m({ s30: 2.5 })).toEqual(["s30"]);
    expect(m({ s30: 2.6 })).toEqual([]);
    expect(m({ stT: 0.83 })).toEqual(["stT"]);
    expect(m({ stT: 0.76 })).toEqual(["stT"]);
    expect(m({ stT: 0.9 })).toEqual([]);
    const grid = (sf: number, r: number) => m({ gridSatFrac: REGIME.TRAJ.map((_, g) => (g === 3 ? sf : 0.001)), gridR: REGIME.TRAJ.map((_, g) => (g === 3 ? r : 1)) });
    expect(grid(0.05, 2)).toEqual(["grid"]);
    expect(grid(0.05, 1.5)).toEqual([]); // r outside 2 / 1.25 .. 2 * 1.25
    expect(grid(0.07, 2)).toEqual([]);
    expect(grid(0.04, 2.5)).toEqual(["grid"]);
    expect(m({ s30: null, ratioU: null, stT: null, gridR: [null], gridSatFrac: [null] })).toEqual([]);
  });
  it("R14 row 85: the U twin's median |dB_blk| over its nonzero blocks, 6 or 7 with thetaB 6: the threshold trigger is not fired or fired; fired, it fails that rung's two combinations with DUST-THRESHOLD and thetaB is never re-derived (G3)", () => {
    const med = (v: number) => stage((c) => (c.key === "P1-net" && c.role === "G2" && c.seed === 9001 && c.T === REGIME.T1 && c.preset === "spots-m3" ? { uMedianBlock30: v, thetaB: 6 } : undefined));
    const quiet = { fired: false, jobs: [] as string[], byRung: { P1: { fired: false, jobs: [] }, P2: { fired: false, jobs: [] } } };
    expect(med(6).goNoGo.trigger).toEqual(quiet);
    expect(med(6).selected).toEqual(P1NET);
    const r = med(7);
    expect(r.goNoGo.trigger).toEqual({ fired: true, jobs: ["G2-spots-m3-9001-t50000"], byRung: { P1: { fired: true, jobs: ["G2-spots-m3-9001-t50000"] }, P2: { fired: false, jobs: [] } } });
    expect(r.goNoGo.medianBlock.find((m) => m.exceeds)).toMatchObject({ job: "G2-spots-m3-9001-t50000", rung: "P1", median: 7, thetaB: 6 });
    // the P1 bank's trigger fails (P1, net) and (P1, occ) with DUST-THRESHOLD alone (the dust floor held); (P2, net) is selected
    expect(r.combos.map((c) => codes(c.causes))).toEqual([["DUST-THRESHOLD"], ["DUST-THRESHOLD"], [], []]);
    expect(r.combos.map((c) => c.satisfies)).toEqual([false, false, true, true]);
    expect(r.combos.map((c) => c.rung)).toEqual([{ floorOk: true, triggerFired: true }, { floorOk: true, triggerFired: true }, { floorOk: true, triggerFired: false }, { floorOk: true, triggerFired: false }]);
    expect(r).toMatchObject({ outcome: "STAGE0-PASS", selected: P2NET });
  });
  it("R14 row 86: the U twin covering 5 percent of the living blocks passes go/no-go b; 5.01 percent fails DUST-FLOOR and fires the trigger (DUST-THRESHOLD) for that rung's two combinations only (G2, G3)", () => {
    const covF = (v: number, key: ComboKey = "P1-net") => (c: GateCtx) => (c.key === key && c.role === "G3" && c.seed === 9002 ? { uNetCoverage30: v } : undefined);
    const cov = (v: number, run = 1) => stage(covF(v), run);
    const ok = cov(0.05);
    expect(ok.goNoGo.dustFloor).toEqual({ ok: true, jobs: [], byRung: { P1: { ok: true, jobs: [] }, P2: { ok: true, jobs: [] } } });
    expect(ok.goNoGo.trigger.fired).toBe(false);
    expect(ok.selected).toEqual(P1NET);
    const bad = cov(0.0501);
    const job = "G3-mu60-s8-k1024-9002-t20000";
    expect(bad.goNoGo.dustFloor).toEqual({ ok: false, jobs: [job], byRung: { P1: { ok: false, jobs: [job] }, P2: { ok: true, jobs: [] } } });
    expect(bad.goNoGo.trigger.fired).toBe(true);
    // a failure of (b) fires the trigger, so the failing rung shows both causes; the other rung's two combinations are untouched and (P2, net) is selected, on run 3 as on run 1
    expect(bad.combos.map((c) => codes(c.causes))).toEqual([["DUST-FLOOR", "DUST-THRESHOLD"], ["DUST-FLOOR", "DUST-THRESHOLD"], [], []]);
    expect(bad).toMatchObject({ outcome: "STAGE0-PASS", selected: P2NET });
    expect(cov(0.0501, 3)).toMatchObject({ outcome: "STAGE0-PASS", selected: P2NET });
    // the floor in the P2 bank only leaves (P1, net) selected
    const p2 = stage(covF(0.0501, "P2-net"));
    expect(p2.combos.map((c) => codes(c.causes))).toEqual([[], [], ["DUST-FLOOR", "DUST-THRESHOLD"], ["DUST-FLOOR", "DUST-THRESHOLD"]]);
    expect(p2.selected).toEqual(P1NET);
    // both banks over the line: every combination fails, and run 3 closes
    const both = (run: number) => stage((c) => (c.role === "G3" && c.seed === 9002 && (c.key === "P1-net" || c.key === "P2-net") ? { uNetCoverage30: 0.0501 } : undefined), run);
    expect(both(1)).toMatchObject({ outcome: "STAGE0-FAIL", selected: null });
    expect(both(1).combos.every((c) => codes(c.causes).includes("DUST-FLOOR") && codes(c.causes).includes("DUST-THRESHOLD") && !c.satisfies)).toBe(true);
    expect(both(3).outcome).toBe("STAGE0-CLOSED");
  });
  it("R14 row 109: go/no-go a: a Stage 0 job that failed C1 (the Z twin is not zero) is a cause of every combination", () => {
    const jobs = gateJobs(undefined, { dev: true }).map((j) => (j.id === "G2-spots-m3-9001-t50000" ? { ...j, invalid: true, invalidChecks: ["C1" as const] } : j));
    const r = stage0(jobs, 1);
    expect(r.goNoGo.zExact).toEqual({ ok: false, jobs: ["G2-spots-m3-9001-t50000"] });
    expect(r.combos.every((c) => codes(c.causes).includes("Z-NOT-ZERO") && codes(c.causes).includes("INVALID-JOB"))).toBe(true);
    expect(r.selected).toBeNull();
  });
  it("B0 jobs are informational: their quantities are not read by the margin condition", () => {
    const b0 = gateJobs((c) => (c.role === "G2" ? { ratioU: 0.3, dust: "AMBIG" as const, jobClass: "CRITICAL" } : undefined), { dev: true }).filter((j) => j.role === "G2" && j.world === "spots-m3" && j.T === REGIME.T1).map((j) => ({ ...j, role: "B0" as const, id: j.id.replace("G2", "B0") }));
    expect(b0).toHaveLength(3); // not an empty list: the filter finds the three seeds
    const r = stage0([...gateJobs(undefined, { dev: true }), ...b0], 1);
    expect(r.combos[0].marginal).toEqual([]);
    expect(r.selected).toEqual(P1NET);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R10 to R12: outcomes, the late check, the ranking

const BEARING8 = ["mu30-s8-k256", "mu20-s8-k256", "mu40-s8-k256", "mu30-s12-k256", "mu30-s16-k256", "mu30-s20-k256", "mu30-s8-k1024", "mu30-s8-k4096"];
const EXTRA = ["mu30-s8-k256-dA100", "mu30-s8-k256-dA240", "mu30-s8-k256-dC100", "mu30-s8-k256-dC240", "mu30-s8-k256-dS75", "mu30-s8-k256-dS240", "mu30-s8-k256-gK16", "mu30-s8-k256-gK256", "mu30-s8-k256-gK1024"];
const fillWith = (ids: string[], specs: JobSpec[]) => Object.fromEntries(ids.map((id) => [id, specs]));
const lim = (cls: JobClass = "ORDERED"): JobSpec => ({ r: { jobClass: cls, dust: "LIMITED", ratioU: 0.7, tClass: cls === "MIXED" || cls === "UNSTABLE" ? "CRITICAL" : cls, s30: S30_OF[cls] ?? 1 } });
const donly = (cls: RegimeClass = "ORDERED"): JobSpec => ({ r: { jobClass: cls, tClass: "NA", flags: ["D_ONLY"], s30: S30_OF[cls] } });

describe("R14 rows 54 to 59: the pool clauses of R10", () => {
  const unmet = (n: number, pool: Record<string, JobSpec[]> = fillWith(["mu40-s20-k256", "mu40-s16-k256"], ["ORDERED", "ORDERED", "ORDERED"])) => {
    const ids = SPECS.filter((s) => !s.control && !(s.id in pool)).slice(0, n).map((s) => s.id);
    return table({ ...fillWith(ids, ["EXTINCT", "EXTINCT", "CRITICAL"]), ...pool });
  };

  it("R14 row 54: 16 of 31 UNMETERABLE settings is TOO-MANY-UNMETERABLE; 15 is not", () => {
    const o = outcome(unmet(16));
    expect(o).toMatchObject({ id: "TOO-MANY-UNMETERABLE", n: 16, of: 31, inference: false });
    expect(outcome(unmet(15)).id).toBe("THIN-POOL");
    // the control is not counted among the 31
    const t = unmet(15, { ...fillWith(["mu40-s20-k256", "mu40-s16-k256"], ["ORDERED", "ORDERED", "ORDERED"]), "mu30-s8-k256-nomut": ["EXTINCT", "EXTINCT", "EXTINCT"] });
    expect(outcome(t).id).toBe("THIN-POOL");
  });

  it("R14 row 55: 7 class-bearing settings is THIN-POOL; 8 spanning 3 axes passes; 8 spanning 2 axes is THIN-POOL", () => {
    const o7 = outcome(table(fillWith(BEARING8.slice(0, 7), ["ORDERED", "ORDERED", "ORDERED"])));
    expect(o7).toMatchObject({ id: "THIN-POOL", classBearing: 7 });
    const o8 = outcome(table(fillWith(BEARING8, ["ORDERED", "ORDERED", "ORDERED"])));
    expect(o8.id).toBe("NO-BAND");
    const two = ["mu30-s8-k256", "mu20-s8-k256", "mu40-s8-k256", "mu30-s12-k256", "mu30-s16-k256", "mu30-s20-k256", "mu20-s12-k256", "mu40-s12-k256"];
    const o2 = outcome(table(fillWith(two, ["ORDERED", "ORDERED", "ORDERED"])));
    expect(o2).toMatchObject({ id: "THIN-POOL", classBearing: 8, axes: ["mu", "sigma"] });
    expect(axesDiffering(spec("mu20-s12-k256").params)).toEqual(["mu", "sigma"]);
  });

  it("R14 row 56: 9 of 10 class-bearing settings reading refClass is NO-CONTRAST; 8 of 10 is not", () => {
    const ten = [...BEARING8, EXTRA[0], EXTRA[1]];
    const nine = outcome(table({ ...fillWith(ten.slice(0, 9), ["CRITICAL", "CRITICAL", "CRITICAL"]), [ten[9]]: ["ORDERED", "ORDERED", "ORDERED"] }));
    expect(nine).toMatchObject({ id: "NO-CONTRAST", n: 9, of: 10, inference: false });
    expect((nine as { settings: string[] }).settings).toHaveLength(9);
    const eight = outcome(table({ ...fillWith(ten.slice(0, 8), ["CRITICAL", "CRITICAL", "CRITICAL"]), ...fillWith(ten.slice(8), ["ORDERED", "ORDERED", "ORDERED"]) }));
    expect(eight.id).toBe("PENDING-LATE-CHECK");
    // fewer than 8 class-bearing settings never give NO-CONTRAST
    expect(outcome(table(fillWith(BEARING8.slice(0, 7), ["CRITICAL", "CRITICAL", "CRITICAL"]))).id).toBe("PENDING-LATE-CHECK");
  });

  it("R14 row 57: 50 percent of the valid jobs not DUST_CLEAR is not above; 51 percent is SENSITIVE-EVERYWHERE", () => {
    const dustyExtra = fillWith(EXTRA.slice(0, 8), [lim("CRITICAL"), lim("CRITICAL"), lim("CRITICAL")]);
    const half = table({ ...fillWith(BEARING8, ["ORDERED", "ORDERED", "ORDERED"]), ...dustyExtra });
    expect(half.filter((r) => r.result.cls === "DUSTY")).toHaveLength(8);
    const o = outcome(half);
    expect(o.id).toBe("NO-BAND"); // 24 of 48 valid jobs are LIMITED: not above one half
    const over = table({ ...fillWith(BEARING8, ["ORDERED", "ORDERED", "ORDERED"]), "mu40-s8-k256": ["ORDERED", "ORDERED", lim("ORDERED")], ...dustyExtra });
    expect(outcome(over)).toMatchObject({ id: "SENSITIVE-EVERYWHERE", n: 25, of: 48 });
    // jobs without a U twin are in neither count
    const noU = table({ ...fillWith(BEARING8, ["ORDERED", "ORDERED", "ORDERED"]), ...fillWith(EXTRA.slice(0, 8), [{ r: { jobClass: "ORDERED", dust: "UNAVAILABLE" } }, { r: { jobClass: "ORDERED", dust: "UNAVAILABLE" } }, { r: { jobClass: "ORDERED", dust: "UNAVAILABLE" } }]) });
    expect(outcome(noU).id).toBe("NO-BAND");
  });

  it("R14 row 58: 50 percent of the valid jobs D_ONLY is not above; 51 percent is UNDER-SUPPORTED", () => {
    const base = { ...fillWith(BEARING8, [donly(), donly(), donly()]), ...fillWith(EXTRA.slice(0, 8), ["ORDERED", "ORDERED", "ORDERED"]) };
    expect(outcome(table(base)).id).toBe("NO-BAND"); // 24 of 48
    const over = outcome(table({ ...base, [EXTRA[0]]: [donly(), "ORDERED", "ORDERED"] }));
    expect(over).toMatchObject({ id: "UNDER-SUPPORTED", n: 25, of: 48 });
  });

  it("R14 row 59: 50 percent of the pool SPLIT is not above; 51 percent is UNRESOLVED, and UNRESOLVED-FINAL after the extension", () => {
    const split: JobSpec[] = ["ORDERED", "CHAOTIC", "MIXED"];
    const base = { ...fillWith(BEARING8, ["ORDERED", "ORDERED", "ORDERED"]), ...fillWith(EXTRA.slice(0, 8), split) };
    const half = outcome(table(base));
    expect(half.id).toBe("NO-BAND"); // 8 of 16
    const over = table({ ...base, [EXTRA[8]]: split });
    expect(outcome(over)).toMatchObject({ id: "UNRESOLVED", n: 9, pool: 17 });
    expect(outcome(over, { extended: true })).toMatchObject({ id: "UNRESOLVED-FINAL", n: 9, pool: 17 });
  });

  it("EMPTY-WINDOW: no setting has 2 valid in-window jobs", () => {
    expect(outcome(table({}))).toMatchObject({ id: "EMPTY-WINDOW", inference: false, fatal: false });
    expect(outcome(table(fillWith(["mu40-s20-k256"], ["CRITICAL", "CARPET", "CARPET"]))).id).toBe("EMPTY-WINDOW"); // INSUFFICIENT is not in the pool
  });

  it("the clauses are tried in order: NO-CONTRAST before the late check, TARGET0 before the pool clauses, EMPTY-WINDOW before TOO-MANY-UNMETERABLE", () => {
    const allDead = table(fillWith(SPECS.filter((s) => !s.control).map((s) => s.id), ["EXTINCT", "EXTINCT", "EXTINCT"]));
    expect(outcome(allDead).id).toBe("EMPTY-WINDOW");
    expect(outcome(unmet(20, fillWith([B0_ID], ["CRITICAL", "CRITICAL", "CRITICAL"]))).id).toBe("PENDING-LATE-CHECK");
  });
});

describe("R14 rows 60 to 64: the late check", () => {
  const t1 = (world: string, specs: JobSpec[]) => mkJobs(world, specs, REGIME.T1);
  const seedsOf = (ids: string[], n = 3) => Object.fromEntries(ids.map((id) => [id, [101, 102, 103, 104, 105, 106].slice(0, n)]));
  const rows = (ids: string[]) => ids.map((id) => rowOf(id, mkJobs(id, ["CRITICAL", "CRITICAL", "CRITICAL"])));
  const lc = (ids: string[], jobs: JobSummary[], n = 3) => lateCheck({ target0: rows(ids), t1Jobs: jobs, seedsOf: seedsOf(ids, n), refClass: "CRITICAL", combo: P1NET });

  it("R14 row 60: 7 target settings: the first 6 in the order (B0, fewer axes, id) are late-checked, the 7th is UNCHECKED-CAP", () => {
    const seven = ["mu40-s20-k256", "mu40-s12-k256", "mu20-s12-k256", "mu30-s8-k256-dA100", "mu30-s12-k256", "mu20-s8-k256", B0_ID];
    expect(lateOrder(rows(seven)).map((r) => r.id)).toEqual([B0_ID, "mu20-s8-k256", "mu30-s12-k256", "mu30-s8-k256-dA100", "mu20-s12-k256", "mu40-s12-k256", "mu40-s20-k256"]);
    const jobs = seven.flatMap((id) => t1(id, ["CRITICAL", "CRITICAL", "CRITICAL"]));
    const r = lc(seven, jobs);
    expect(r.late0).toHaveLength(6);
    expect(r.late0[0]).toBe(B0_ID);
    expect(r.uncheckedCap).toEqual(["mu40-s20-k256"]);
    expect(r.settings["mu40-s20-k256"].status).toBe("UNCHECKED-CAP");
    expect(r.outcome).toBe("BAND-FOUND");
    expect(r.agrees).toHaveLength(6);
    expect(r.agrees).not.toContain("mu40-s20-k256"); // never agreeing
  });
  it("R14 row 61: one setting AGREES, one is INCONCLUSIVE: BAND-FOUND, the other listed", () => {
    const ids = [B0_ID, "mu30-s12-k256"];
    const r = lc(ids, [...t1(ids[0], ["CRITICAL", "CRITICAL", "CRITICAL"]), ...t1(ids[1], ["CRITICAL", "EXTINCT", "CARPET"])]);
    expect(r.outcome).toBe("BAND-FOUND");
    expect(r.agrees).toEqual([B0_ID]);
    expect(r.inconclusive).toEqual(["mu30-s12-k256"]);
    expect(r.settings["mu30-s12-k256"]).toMatchObject({ status: "INCONCLUSIVE", cls: "INSUFFICIENT", statusAtT1: "WINDOWED" });
  });
  it("R14 row 62: INCONCLUSIVE only is LATE-INCONCLUSIVE (a rerun cannot change it)", () => {
    const r = lc([B0_ID], t1(B0_ID, ["CRITICAL", "EXTINCT", "CARPET"]));
    expect(r.outcome).toBe("LATE-INCONCLUSIVE");
    expect(r.missing).toEqual([]);
  });
  it("R14 row 63: one late job missing is PENDING-LATE-CHECK, listing it", () => {
    const r = lc([B0_ID], t1(B0_ID, ["CRITICAL", "CRITICAL"]));
    expect(r.outcome).toBe("PENDING-LATE-CHECK");
    expect(r.missing).toEqual(["slab-mu30-s8-k256-seed103-t50000-P1-net"]);
    expect(r.settings[B0_ID].status).toBe("PENDING");
    // no late jobs at all: all of the setting's seeds are listed
    expect(lc([B0_ID], []).missing).toHaveLength(3);
    // an INVALID late job is missing too
    const bad = t1(B0_ID, ["CRITICAL", "CRITICAL", { invalid: true, invalidChecks: ["C2"] }]);
    expect(lc([B0_ID], bad).outcome).toBe("PENDING-LATE-CHECK");
  });
  it("R14 row 64: every setting TRANSIENT is TRANSIENT-BAND", () => {
    const ids = [B0_ID, "mu30-s12-k256", "mu20-s8-k256", "mu40-s8-k256"];
    const jobs = [
      ...t1(ids[0], ["ORDERED", "ORDERED", "ORDERED"]), // another class
      ...t1(ids[1], ["CARPET", "CARPET", "CRITICAL"]), // a carpet at T1
      ...t1(ids[2], ["EXTINCT", "EXTINCT", "CRITICAL"]), // unmeterable
      ...t1(ids[3], ["CRITICAL", "ORDERED", "CHAOTIC"]), // SPLIT
    ];
    const r = lc(ids, jobs);
    expect(r.outcome).toBe("TRANSIENT-BAND");
    expect(r.transient).toEqual(ids.slice().sort((a, b) => ids.indexOf(a) - ids.indexOf(b)).filter((id) => lateOrder(rows(ids)).some((x) => x.id === id)).sort((a, b) => lateOrder(rows(ids)).findIndex((x) => x.id === a) - lateOrder(rows(ids)).findIndex((x) => x.id === b)));
    expect(Object.values(r.settings).map((s) => s.statusAtT1).sort()).toEqual(["CARPET", "UNMETERABLE", "WINDOWED", "WINDOWED"]);
    // DUSTY at T1 is TRANSIENT as well
    const dusty = lc([B0_ID], t1(B0_ID, [lim("CRITICAL"), lim("CRITICAL"), "CRITICAL"]));
    expect(dusty.settings[B0_ID]).toMatchObject({ status: "TRANSIENT", cls: "DUSTY" });
  });
  it("the seeds to re-burn come from the setting row (its T0 jobs) unless given; a setting with no known seeds is a contract error, not a silent PENDING with nothing to run", () => {
    const own = rows([B0_ID]);
    expect(own[0].seeds).toEqual([101, 102, 103]);
    expect(lateCheck({ target0: own, t1Jobs: [], refClass: "CRITICAL", combo: P1NET }).missing).toHaveLength(3);
    expect(lateCheck({ target0: own, t1Jobs: [], seedsOf: { [B0_ID]: [101, 102] }, refClass: "CRITICAL", combo: P1NET }).missing).toHaveLength(2);
    expect(() => lateCheck({ target0: [{ ...own[0], seeds: [] }], t1Jobs: [], refClass: "CRITICAL", combo: P1NET })).toThrow(/no seeds known/);
    expect(() => lateCheck({ target0: own, t1Jobs: [], seedsOf: { [B0_ID]: [] }, refClass: "CRITICAL", combo: P1NET })).toThrow(/no seeds known/);
  });
  it("a six-seed setting is late-checked with the same six seeds and the six-seed rule", () => {
    const six = t1(B0_ID, ["CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "ORDERED", "ORDERED"]);
    const r = lc([B0_ID], six, 6);
    expect(r.outcome).toBe("BAND-FOUND");
    expect(lc([B0_ID], six.slice(0, 5), 6).outcome).toBe("PENDING-LATE-CHECK");
    expect(lc([B0_ID], t1(B0_ID, ["CRITICAL", "CRITICAL", "CRITICAL", "ORDERED", "ORDERED", "ORDERED"]), 6).outcome).toBe("TRANSIENT-BAND");
  });
});

describe("outcomes of R10 with the late check, and the inference clause (R12.6)", () => {
  const target = (cls: RegimeClass = "CRITICAL") => table({ [B0_ID]: [cls, cls, cls] });
  const t1 = (world: string, specs: JobSpec[]) => mkJobs(world, specs, REGIME.T1);
  const late = (jobs: JobSummary[]) => ({ t1Jobs: jobs, seedsOf: { [B0_ID]: [101, 102, 103] } });

  it("GATE-FAIL: the selected combination failed the held-out gate: CLOSED, with its causes, and no inference", () => {
    const causes = [{ code: "CARPET-NOT-SEPARATED", where: ["G3-x"] }];
    const o = outcome(target(), { gate: { pass: false, causes } });
    expect(o).toMatchObject({ id: "GATE-FAIL", causes, inference: false, fatal: false });
  });
  it("PENDING-LATE-CHECK: a setting reads refClass at T0 and its late jobs are missing: the missing jobs are listed", () => {
    const o = outcome(target(), { late: late([]) });
    expect(o).toMatchObject({ id: "PENDING-LATE-CHECK", inference: false });
    expect((o as { missing: string[] }).missing).toEqual(["101", "102", "103"].map((s) => `slab-mu30-s8-k256-seed${s}-t50000-P1-net`));
  });
  it("BAND-FOUND (refClass CRITICAL): the setting reads CRITICAL at T0 and T1; the inference is the no-physics-change sentence, and there is no ranking", () => {
    const o = outcome(target(), { late: late(t1(B0_ID, ["CRITICAL", "CRITICAL", "CRITICAL"])) });
    expect(o).toMatchObject({ id: "BAND-FOUND", inference: true, settings: [B0_ID], ranking: null, refClass: "CRITICAL" });
    expect(inferenceSentence(o)).toBe("No physics change is indicated by these meters: at least one swept setting reads like the project's alive 2D worlds at T0 and T1.");
  });
  it("BAND-FOUND (refClass CHAOTIC): alive-like settings found; the sentence is the same and the text will say it does not test criticality", () => {
    const o = outcome(target("CHAOTIC"), { refClass: "CHAOTIC", late: late(t1(B0_ID, ["CHAOTIC", "CHAOTIC", "CHAOTIC"])) });
    expect(o).toMatchObject({ id: "BAND-FOUND", refClass: "CHAOTIC", settings: [B0_ID] });
  });
  it("LATE-INCONCLUSIVE: the T1 evidence is insufficient (fewer than 2 valid jobs): no inference", () => {
    const o = outcome(target(), { late: late(t1(B0_ID, ["CRITICAL", "EXTINCT", "CARPET"])) });
    expect(o).toMatchObject({ id: "LATE-INCONCLUSIVE", inference: false });
  });
  it("TRANSIENT-BAND: the setting reads refClass at T0 but not at T1: a stage of the transient, no inference", () => {
    const o = outcome(target(), { late: late(t1(B0_ID, ["ORDERED", "ORDERED", "ORDERED"])) });
    expect(o).toMatchObject({ id: "TRANSIENT-BAND", inference: false });
  });
  it("only BAND-FOUND, CROSSING-BRACKETED and NO-BAND carry an inference", () => {
    const ids: Record<string, boolean> = {};
    const record = (o: ReturnType<typeof outcome>) => { ids[o.id] = o.inference; };
    record(outcome(target(), { gate: { pass: false, causes: [] } }));
    record(outcome(target(), { late: late([]) }));
    record(outcome(table({})));
    record(outcome(table(fillWith(BEARING8, ["ORDERED", "ORDERED", "ORDERED"]))));
    expect(ids).toEqual({ "GATE-FAIL": false, "PENDING-LATE-CHECK": false, "EMPTY-WINDOW": false, "NO-BAND": true });
    expect(inferenceSentence({ id: "EMPTY-WINDOW", refClass: "CRITICAL", amp: "AMP-ROBUST" })).toBeNull();
    expect(inferenceSentence({ id: "GATE-FAIL", refClass: "CRITICAL", amp: "AMP-ROBUST" })).toBeNull();
  });
});

describe("CROSSING-BRACKETED, NO-BAND and the ranking (R10, R12)", () => {
  /** Eight class-bearing settings over three axes (B0, mu20, mu40, sigma 12, 16, 20, lightK 1024, 4096), each of one class. */
  const classes = (over: Record<string, RegimeClass>, def: RegimeClass = "ORDERED") => Object.fromEntries(BEARING8.map((id) => [id, [over[id] ?? def, over[id] ?? def, over[id] ?? def] as JobSpec[]]));

  it("CROSSING-BRACKETED: two adjacent settings of one axis read ORDERED and CHAOTIC (refClass CRITICAL); the ranking still prints", () => {
    const o = outcome(table(classes({ "mu40-s8-k256": "CHAOTIC" })));
    expect(o).toMatchObject({ id: "CROSSING-BRACKETED", inference: true });
    expect((o as { brackets: unknown }).brackets).toEqual([{ a: "mu30-s8-k256", b: "mu40-s8-k256", axis: "mu" }]);
    expect((o as { ranking: { kind: string } }).ranking.kind).not.toBe("NO-RANKING");
    expect(inferenceSentence(o)).toBe("The critical manifold lies between the two bracketed settings; refine along that axis before any physics change.");
    expect(inferenceSentence({ ...o, amp: "AMP-DEPENDENT" })).toContain("CRITICAL class at this kick scale");
  });
  it("a bracket needs adjacency in the tested list: mu20 and mu40 are not adjacent, and sigma 8 and 16 are not either", () => {
    const rows = table(classes({ "mu40-s8-k256": "CHAOTIC", "mu30-s8-k256": "CHAOTIC", "mu20-s8-k256": "ORDERED" }));
    const pairs = findBrackets(rows).map((b) => `${b.a} ${b.b}`);
    expect(pairs).toContain("mu20-s8-k256 mu30-s8-k256"); // 20 and 30 are adjacent
    expect(pairs.some((p) => p.includes("mu40-s8-k256"))).toBe(false); // 30 and 40 read alike, and 20 and 40 are not adjacent
    const far = table(classes({ "mu40-s8-k256": "CHAOTIC", "mu30-s8-k256": "CRITICAL" }));
    expect(findBrackets(far)).toEqual([]);
    // sigma 8 and 16 are not adjacent (12 lies between): B0 is in no bracket of the sigma 16 setting, whose neighbours 12 and 20 are
    const s16 = findBrackets(table(classes({ "mu30-s16-k256": "CHAOTIC" })));
    expect(s16.map((b) => `${b.a} ${b.b}`)).toEqual(["mu30-s12-k256 mu30-s16-k256", "mu30-s16-k256 mu30-s20-k256"]);
    expect(new Set(findBrackets(table(classes({ "mu30-s12-k256": "CHAOTIC" }))).map((b) => b.axis))).toEqual(new Set(["sigma"]));
    // lightK brackets at equal mu and sigma only
    expect(new Set(findBrackets(table(classes({ "mu30-s8-k1024": "CHAOTIC" }))).map((b) => b.axis))).toEqual(new Set(["lightK"]));
    // two settings that differ in two axes never bracket
    const two = table({ ...classes({}), "mu20-s12-k256": ["CHAOTIC", "CHAOTIC", "CHAOTIC"] });
    const twoPairs = findBrackets(two).map((b) => `${b.a} ${b.b}`);
    expect(twoPairs).not.toContain("mu20-s12-k256 mu30-s8-k256"); // differs from B0 in mu and sigma
    expect(twoPairs).toContain("mu20-s12-k256 mu20-s8-k256"); // sigma 8 and 12 are adjacent at equal mu
    expect(twoPairs).toContain("mu20-s12-k256 mu30-s12-k256"); // mu 20 and 30 are adjacent at equal sigma
  });
  it("a bracket is only sought for refClass CRITICAL; INERT settings form no bracket", () => {
    const rows = table(classes({ "mu40-s8-k256": "CHAOTIC" }));
    // with refClass CHAOTIC the CHAOTIC setting is a target, so the late check comes first and no bracket is looked for
    expect(outcome(rows, { refClass: "CHAOTIC" }).id).toBe("PENDING-LATE-CHECK");
    expect(outcome(rows).id).toBe("CROSSING-BRACKETED");
    expect(outcome(rows, { inert: new Set(["mu40-s8-k256"]) }).id).toBe("NO-BAND");
    expect(findBrackets(rows, new Set(["mu40-s8-k256"]))).toEqual([]);
  });
  it("NO-BAND labels: all-ordered, all-chaotic, scattered; with its inference for refClass CRITICAL and CHAOTIC", () => {
    const ord = outcome(table(classes({})));
    expect(ord).toMatchObject({ id: "NO-BAND", label: "all-ordered", inference: true });
    expect(inferenceSentence(ord)).toBe("A physics change is indicated by these meters: the project's alive 2D worlds read critical and no swept slab setting does.");
    expect(inferenceSentence({ ...ord, amp: "AMP-DEPENDENT" })).toBe("A physics change is indicated by these meters: the project's alive 2D worlds read in the CRITICAL class at this kick scale and no swept slab setting does.");
    expect(outcome(table(classes({}, "CHAOTIC")))).toMatchObject({ id: "NO-BAND", label: "all-chaotic" });
    // one CHAOTIC setting with no ORDERED neighbour one step away in a single axis: no bracket, the label is scattered
    const lone = [...BEARING8.slice(1), EXTRA[0]];
    const scattered = outcome(table({ ...fillWith(lone, ["ORDERED", "ORDERED", "ORDERED"]), "mu40-s8-k256": ["CHAOTIC", "CHAOTIC", "CHAOTIC"] }));
    expect(scattered).toMatchObject({ id: "NO-BAND", label: "scattered" });
    const chaotic = outcome(table(classes({}, "ORDERED")), { refClass: "CHAOTIC" });
    expect(chaotic).toMatchObject({ id: "NO-BAND", label: "all-ordered", refClass: "CHAOTIC" });
    expect(inferenceSentence(chaotic)).toBe("No swept slab setting reads like the project's alive 2D worlds (chaotic-like). This does not test the criticality hypothesis.");
  });

  it("R14 row 68: B0 with class SPLIT gives NO-RANKING", () => {
    const others = [...BEARING8.slice(1), EXTRA[0]];
    const rows = table({ ...fillWith(others, ["ORDERED", "ORDERED", "ORDERED"]), [B0_ID]: ["ORDERED", "CHAOTIC", "MIXED"] });
    expect(rows.find((r) => r.id === B0_ID)!.result.cls).toBe("SPLIT");
    const rk = rankAxes(rows, "CRITICAL");
    expect(rk).toMatchObject({ kind: "NO-RANKING", reason: "B0", rows: [], top: null });
    const o = outcome(rows);
    expect(o).toMatchObject({ id: "NO-BAND" });
    expect((o as { ranking: { kind: string } }).ranking.kind).toBe("NO-RANKING");
    // B0 outside the pool, or with a DUSTY class, is the same
    expect(rankAxes(table({ ...fillWith(others, ["ORDERED", "ORDERED", "ORDERED"]), [B0_ID]: ["CARPET", "CARPET", "CARPET"] }), "CRITICAL").kind).toBe("NO-RANKING");
    expect(rankAxes(table({ ...fillWith(others, ["ORDERED", "ORDERED", "ORDERED"]), [B0_ID]: [lim("ORDERED"), lim("ORDERED"), lim("ORDERED")] }), "CRITICAL").kind).toBe("NO-RANKING"); // DUSTY
  });
  it("R14 row 69: the ranking candidates of an axis are the settings next to B0's value in the tested list: sigma 1, mu 2, dtQ 2, spread 2", () => {
    expect(axisCandidateIds("sigma")).toEqual(["mu30-s12-k256"]);
    expect(axisCandidateIds("mu").sort()).toEqual(["mu20-s8-k256", "mu40-s8-k256"]);
    expect(axisCandidateIds("dtQ").sort()).toEqual(["mu30-s8-k256-dtQ102", "mu30-s8-k256-dtQ26"]);
    expect(axisCandidateIds("spread").sort()).toEqual(["mu30-s8-k256-sp16", "mu30-s8-k256-sp4"]);
    expect(axisCandidateIds("lightK")).toEqual(["mu30-s8-k1024"]);
    expect(axisCandidateIds("diffA").sort()).toEqual(["mu30-s8-k256-dA100", "mu30-s8-k256-dA240"]);
    expect(axisCandidateIds("diffC").sort()).toEqual(["mu30-s8-k256-dC100", "mu30-s8-k256-dC240"]);
    expect(axisCandidateIds("diffS").sort()).toEqual(["mu30-s8-k256-dS240", "mu30-s8-k256-dS75"]);
    expect(axisCandidateIds("gateK").sort()).toEqual(["mu30-s8-k256-gK16", "mu30-s8-k256-gK256"]); // 1024 is not next to 64
    expect(AXES.flatMap((a) => axisCandidateIds(a))).toHaveLength(16);
  });

  // The ranking fixtures: B0 and single-axis candidates with chosen response ratios. refClass CHAOTIC: d(ell) = max(0, ln 2 - ell).
  const sOf = (ell: number) => Math.exp(ell);
  const withEll = (id: string, ell: number | number[]): [string, JobSpec[]] => {
    const e = Array.isArray(ell) ? ell : [ell, ell, ell];
    return [id, e.map((x) => ({ r: { jobClass: "ORDERED", tClass: "ORDERED", s30: sOf(x) } }) as JobSpec)];
  };
  const rankTable = (entries: [string, number | number[]][]) => table({ ...fillWith(BEARING8, ["ORDERED", "ORDERED", "ORDERED"]), ...Object.fromEntries(entries.map(([id, e]) => withEll(id, e))) });
  const near = (x: number | null, y: number) => Math.abs((x as number) - y) < 1e-9;

  it("R12.1: the distance to the target for CRITICAL and for CHAOTIC", () => {
    expect(distanceToTarget(0, "CRITICAL")).toBe(0);
    expect(near(distanceToTarget(Math.log(0.25), "CRITICAL"), Math.log(0.5) - Math.log(0.25))).toBe(true);
    expect(near(distanceToTarget(Math.log(8), "CRITICAL"), Math.log(8) - Math.log(2))).toBe(true);
    expect(distanceToTarget(Math.log(2), "CHAOTIC")).toBe(0);
    expect(distanceToTarget(Math.log(8), "CHAOTIC")).toBe(0);
    expect(near(distanceToTarget(Math.log(0.5), "CHAOTIC"), Math.log(4))).toBe(true);
  });
  it("R12.2 to R12.5: Delta is d(B0) minus the minimum over the adjacent candidates; the best axis is named with its direction", () => {
    const rows = rankTable([[B0_ID, -0.5], ["mu40-s8-k256", -0.1], ["mu20-s8-k256", -0.9], ["mu30-s12-k256", -0.4]]);
    const rk = rankAxes(rows, "CHAOTIC");
    expect(rk.kind).toBe("RANKED");
    expect(near(rk.dB0, Math.log(2) + 0.5)).toBe(true);
    const mu = rk.rows.find((r) => r.axis === "mu")!;
    expect(mu.best).toBe("mu40-s8-k256");
    expect(mu.direction).toBe("raise");
    expect(near(mu.delta, 0.4)).toBe(true);
    expect(mu.candidates).toEqual(["mu40-s8-k256", "mu20-s8-k256"]);
    const sigma = rk.rows.find((r) => r.axis === "sigma")!;
    expect(near(sigma.delta, 0.1)).toBe(true);
    expect(rk.rows.find((r) => r.axis === "dtQ")).toMatchObject({ delta: null, best: null, candidates: [] });
    expect(rk.top!.axis).toBe("mu");
    expect(rk.rows[0].axis).toBe("mu");
    expect(rk.rows[rk.rows.length - 1].delta).toBeNull(); // axes without candidates come last
    // lowering: a candidate below B0 that is closer to the target
    const lower = rankAxes(rankTable([[B0_ID, -1], ["mu20-s8-k256", 0.5], ["mu40-s8-k256", -2]]), "CHAOTIC");
    expect(lower.top).toMatchObject({ axis: "mu", best: "mu20-s8-k256", direction: "lower" });
  });
  it("R14 row 70: a top Delta of 0.40 with NOISE 0.5 is NO-AXIS; with NOISE 0.2 the axis is named", () => {
    const mk = (b0: number[]) => rankAxes(rankTable([[B0_ID, b0], ["mu40-s8-k256", -0.1]]), "CHAOTIC");
    const wide = mk([-0.7, -0.5, -0.2]); // ell = -0.5, range 0.5
    expect(near(wide.noise, 0.5)).toBe(true);
    expect(near(wide.rows[0].delta, 0.4)).toBe(true);
    expect(wide.kind).toBe("NO-AXIS");
    expect(wide.top).toBeNull();
    const narrow = mk([-0.6, -0.5, -0.4]); // ell = -0.5, range 0.2
    expect(near(narrow.noise, 0.2)).toBe(true);
    expect(narrow.kind).toBe("RANKED");
    expect(narrow.top!.axis).toBe("mu");
    // below 0.35 is NO-AXIS whatever the noise
    expect(rankAxes(rankTable([[B0_ID, [-0.5, -0.5, -0.5]], ["mu40-s8-k256", -0.2]]), "CHAOTIC").kind).toBe("NO-AXIS");
    // no candidate anywhere: NO-AXIS
    expect(rankAxes(rankTable([[B0_ID, -0.5]]), "CHAOTIC")).toMatchObject({ kind: "NO-AXIS", top: null });
    // the outcome carries it
    const o = outcome(rankTable([[B0_ID, [-0.7, -0.5, -0.2]], ["mu40-s8-k256", -0.1]]), { refClass: "CHAOTIC" });
    expect(o).toMatchObject({ id: "NO-BAND" });
    expect((o as { ranking: { kind: string } }).ranking.kind).toBe("NO-AXIS");
  });
  it("R14 row 71: two equal minima on one axis go to the smaller abs(log2(x / x_B0)), then to the id", () => {
    // mu 20 and 40 tie at d: 40 is the smaller change (0.415 against 0.585)
    const mu = rankAxes(rankTable([[B0_ID, -1], ["mu20-s8-k256", -0.2], ["mu40-s8-k256", -0.2]]), "CHAOTIC");
    expect(mu.rows.find((r) => r.axis === "mu")).toMatchObject({ best: "mu40-s8-k256", direction: "raise" });
    expect(near(mu.rows.find((r) => r.axis === "mu")!.change, Math.log2(40 / 30))).toBe(true);
    // gateK 16 and 256 are the same distance (a factor 4) from 64: the id decides
    const gk = rankAxes(rankTable([[B0_ID, -1], ["mu30-s8-k256-gK16", -0.2], ["mu30-s8-k256-gK256", -0.2]]), "CHAOTIC");
    expect(gk.rows.find((r) => r.axis === "gateK")).toMatchObject({ best: "mu30-s8-k256-gK16", direction: "lower", change: 2 });
  });
  it("axes within TIE of the top Delta are ordered by the smaller change, then alphabetically", () => {
    // lightK: Delta 0.50 with a change of 2 (256 -> 1024); mu: Delta 0.45 with a change of 0.415: within 0.10, so mu comes first
    const rk = rankAxes(rankTable([[B0_ID, -1], ["mu30-s8-k1024", -0.5], ["mu40-s8-k256", -0.55]]), "CHAOTIC");
    expect(rk.rows.slice(0, 2).map((r) => r.axis)).toEqual(["mu", "lightK"]);
    expect(rk.top!.axis).toBe("mu");
    // outside the tie band the larger Delta stays first
    const far = rankAxes(rankTable([[B0_ID, -1], ["mu30-s8-k1024", -0.5], ["mu40-s8-k256", -0.7]]), "CHAOTIC");
    expect(far.top!.axis).toBe("lightK");
    // an exact tie in Delta and change goes alphabetically: diffA and diffC with the same factor
    const alpha = rankAxes(rankTable([[B0_ID, -1], ["mu30-s8-k256-dC240", -0.4], ["mu30-s8-k256-dA240", -0.4]]), "CHAOTIC");
    expect(alpha.rows.slice(0, 2).map((r) => r.axis)).toEqual(["diffA", "diffC"]);
  });
  it("R14 row 72: a gateK setting whose stateDigestT equals B0's for all seeds is INERT; one differing in one cell for one seed is not; INERT settings are excluded from the ranking", () => {
    const b0 = { 101: "aa", 102: "bb", 103: "cc" };
    expect(isInertGateK({ 101: "aa", 102: "bb", 103: "cc" }, b0)).toBe(true);
    expect(isInertGateK({ 101: "aa", 102: "bX", 103: "cc" }, b0)).toBe(false);
    expect(isInertGateK({ 101: "aa", 102: "bb" }, b0)).toBe(false);
    const rows = rankTable([[B0_ID, -1], ["mu30-s8-k256-gK16", -0.1], ["mu30-s8-k256-gK256", -0.8]]);
    expect(rankAxes(rows, "CHAOTIC").top!.best).toBe("mu30-s8-k256-gK16");
    const without = rankAxes(rows, "CHAOTIC", new Set(["mu30-s8-k256-gK16"]));
    expect(without.rows.find((r) => r.axis === "gateK")).toMatchObject({ best: "mu30-s8-k256-gK256", candidates: ["mu30-s8-k256-gK256"] });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Attribution, per-site counters, the stored steps

describe("R6.2 attribution on the torus and the per-site counters", () => {
  const g: Geom = { W: 64, H: 64, D: 8 };
  const blockAt = (bx: number, by: number) => by * 8 + bx;
  const A = voxelAt(4, 4, 2, g), B = voxelAt(36, 4, 5, g);

  it("a block's centre is the voxel (8 bx + 4, 8 by + 4); the distance is the Chebyshev torus distance in voxels (resolution W9)", () => {
    expect(blockCentre(blockAt(0, 0), g)).toEqual([4, 4]);
    expect(blockCentre(blockAt(7, 7), g)).toEqual([60, 60]);
    expect(nearestSite(blockAt(0, 0), [A, B], g)).toEqual({ site: 0, distance: 0 });
    expect(nearestSite(blockAt(4, 0), [A, B], g)).toEqual({ site: 1, distance: 0 });
    expect(nearestSite(blockAt(3, 0), [A, B], g)).toEqual({ site: 1, distance: 8 }); // centre 28: 24 from A, 8 from B
    expect(nearestSite(blockAt(1, 0), [A, B], g)).toEqual({ site: 0, distance: 8 });
  });
  it("ties go to the lower site index, whatever the order of the list", () => {
    // block 2 has its centre at x = 20: 16 from A (x = 4) and 16 from B (x = 36)
    expect(nearestSite(blockAt(2, 0), [A, B], g)).toEqual({ site: 0, distance: 16 });
    expect(nearestSite(blockAt(2, 0), [B, A], g)).toEqual({ site: 0, distance: 16 });
    // block 6 (centre 52): 16 from B and 16 from A across the wrap (52 -> 64 + 4)
    expect(nearestSite(blockAt(6, 0), [A, B], g)).toEqual({ site: 0, distance: 16 });
    expect(nearestSite(blockAt(6, 0), [B, A], g)).toEqual({ site: 0, distance: 16 });
  });
  it("x and y wrap, z is ignored, and there is no cutoff", () => {
    const farSite = voxelAt(4, 4, 7, g);
    expect(nearestSite(blockAt(7, 7), [farSite], g)).toEqual({ site: 0, distance: 8 }); // (60, 60) is 8 from (4, 4) across both wraps
    expect(nearestSite(blockAt(4, 4), [farSite], g)).toEqual({ site: 0, distance: 32 }); // the farthest block on a 64-wide torus
    expect(nearestSite(blockAt(0, 0), [], g)).toEqual({ site: -1, distance: 0 });
  });
  it("siteCounters attributes net-damaged and occupancy-damaged blocks separately and keeps the largest distance as the reach", () => {
    const nb = 64;
    const net = new Float64Array(nb), occ = new Uint32Array(nb), live = new Uint8Array(nb);
    net[blockAt(0, 0)] = -12; // site 0, distance 0
    net[blockAt(1, 0)] = 7; // site 0, distance 8
    net[blockAt(5, 0)] = -6; // 44 from A (wrap 20), 8 from B... centre 44: to B (36) 8
    net[blockAt(2, 0)] = 5; // below thetaB = 6
    occ[blockAt(2, 0)] = 9; // occupancy-damaged only, tie: site 0 at 16
    occ[blockAt(0, 1)] = 8; // occupancy-damaged, 8 from A
    const r = siteCounters({ net, occ, live }, { thetaB: 6 }, [A, B], g);
    expect(r.n_blk).toEqual([2, 1]);
    expect(r.reach_blk).toEqual([8, 8]);
    expect(r.n_occ).toEqual([2, 0]);
    expect(r.reach_occ).toEqual([16, 0]);
  });
  it("the per-site counts add up to the global ones (N(t) = n_dec(t) / m_S) on a random pair of fields", () => {
    const n = g.W * g.H * g.D;
    const R = new Uint32Array(n * CELL_CHANNELS), X = new Uint32Array(n * CELL_CHANNELS);
    let h = 7;
    for (let v = 0; v < n; v++) {
      h = lowbias32(h + v);
      R[CH.B * n + v] = h % 40;
      X[CH.B * n + v] = R[CH.B * n + v] + (h >>> 8) % 7 - 3;
      if ((h >>> 20) % 11 === 0) X[CH.B * n + v] += 30;
    }
    const sites = [A, B, voxelAt(20, 40, 3, g)];
    const { row, blocks } = diffCounters(R, X, g, { thetaB: 6, thetaV: 3 });
    const sc = siteCounters(blocks, { thetaB: 6 }, sites, g);
    expect(sc.n_blk.reduce((a, b) => a + b, 0)).toBe(row.n_blk);
    expect(sc.n_occ.reduce((a, b) => a + b, 0)).toBe(row.n_occ);
    expect(row.n_blk).toBeGreaterThan(0);
    expect(row.n_occ).toBeGreaterThan(0);
  });
});

describe("the stored steps, settings, job ids and summaries", () => {
  it("the per-site log holds every step of the eight windows and every 10th step to 1000 (R6.5)", () => {
    const s = storedSteps();
    expect(s).toEqual([...s].sort((a, b) => a - b));
    for (const tc of REGIME.TRAJ) {
      const [lo, hi] = windowBounds(tc, 1000);
      for (let t = lo; t <= hi; t++) expect(s).toContain(t);
    }
    for (let t = 10; t <= 1000; t += 10) expect(s).toContain(t);
    expect(s).not.toContain(0);
    expect(s).toContain(995);
    expect(s).toContain(1000);
    expect(s).not.toContain(1001);
    expect(s).not.toContain(106); // between the windows of 100 and 139 only the 10th steps are stored
    expect(s).toContain(110);
  });
  it("windowMeanStored takes the stored steps inside the window", () => {
    const steps = [95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 110];
    const vals = steps.map((t) => t);
    expect(windowMeanStored(steps, vals, 100, 1000)).toBe(100);
    expect(windowMeanStored(steps, vals, 300, 1000)).toBeNull();
    expect(windowMeanStored([10, 20, 30, 40], [1, 2, 3, 4], 30, 1000)).toBe(3);
  });
  it("meanExact returns a constant exactly and compensates a long sum", () => {
    expect(meanExact([0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05])).toBe(0.05);
    expect(meanExact([1, 2, 3, 4])).toBe(2.5);
    expect(meanExact([])).toBeNull();
    expect(meanExact([1e16, 1, -1e16, 1])).toBeCloseTo(0.5, 12);
  });

  it("R2.3: 32 settings (12 + 6 + 9 + 4 and the control), 31 sweep settings, 96 jobs, 54 of them overlaying M4 (groups A and B)", () => {
    const s = sweepSettings();
    expect(s).toHaveLength(32);
    const count = (g: string) => s.filter((x) => x.group === g).length;
    expect([count("A"), count("B"), count("C"), count("D"), count("control")]).toEqual([12, 6, 9, 4, 1]);
    expect(s.filter((x) => !x.control)).toHaveLength(31);
    expect(s.length * 3).toBe(96);
    expect((count("A") + count("B")) * 3).toBe(54);
    expect(new Set(s.map((x) => x.id)).size).toBe(32);
    const ids = s.map((x) => x.id);
    for (const id of [
      "mu30-s8-k256", "mu20-s20-k256", "mu40-s16-k256", "mu30-s8-k1024", "mu30-s16-k4096", "mu30-s20-k1024",
      "mu30-s8-k256-dA100", "mu30-s8-k256-dA240", "mu30-s8-k256-dC100", "mu30-s8-k256-dC240", "mu30-s8-k256-dS75", "mu30-s8-k256-dS240",
      "mu30-s8-k256-gK16", "mu30-s8-k256-gK256", "mu30-s8-k256-gK1024", "mu30-s8-k256-dtQ26", "mu30-s8-k256-dtQ102", "mu30-s8-k256-sp4", "mu30-s8-k256-sp16", "mu30-s8-k256-nomut",
    ]) expect(ids).toContain(id);
    expect(ids).not.toContain("mu30-s8-k256-gK64");
    expect(settingId(B0_PARAMS)).toBe(B0_ID);
    expect(spec(B0_ID).overrides).toEqual({ defaultMu: 30, defaultSigma: 8, lightK: 256 });
    expect(spec("mu30-s8-k256-nomut").overrides).toEqual({ defaultMu: 30, defaultSigma: 8, lightK: 256, mutRate: 0 });
    expect(spec("mu30-s8-k256-dtQ26").overrides).toMatchObject({ dtQ: 26 });
    expect(spec("mu30-s8-k256-gK1024").overrides).toMatchObject({ gateK: 1024 });
    expect(spec("mu30-s16-k4096").overrides).toEqual({ defaultMu: 30, defaultSigma: 16, lightK: 4096 });
    expect(axesDiffering(spec("mu30-s8-k256-nomut").params)).toEqual([]);
    expect(axesDiffering(spec("mu40-s12-k256").params)).toEqual(["mu", "sigma"]);
    // the tested lists contain B0's value and the values of the sweep
    for (const a of AXES) expect(AXIS_LISTS[a]).toContain(B0_PARAMS[a]);
    // the high diffusion is 240, not the range limit 256 (a lattice-parity limit, R2.3)
    expect(Math.max(...AXIS_LISTS.diffA, ...AXIS_LISTS.diffC, ...AXIS_LISTS.diffS)).toBe(240);
  });
  it("R2.4: job ids", () => {
    expect(jobId({ kind: "slab", world: "mu30-s8-k256", seed: 101, T: 20000, rung: "P1", decider: "net" })).toBe("slab-mu30-s8-k256-seed101-t20000-P1-net");
    expect(jobId({ dev: true, kind: "slab", world: "mu60-s8-k1024", seed: 9001, T: 20000, rung: "P2" })).toBe("dev-slab-mu60-s8-k1024-seed9001-t20000-P2");
    expect(jobId({ kind: "2d", world: "spots-m3", seed: 102, T: 100000, rung: "P1" })).toBe("2d-spots-m3-seed102-t100000-P1");
  });

  const goodBank = (o: BankOpts = {}) => mkBank(o);
  const job = (o: Partial<RegimeJob> = {}): RegimeJob => ({
    id: "slab-mu30-s8-k256-seed101-t20000-P1", role: "SWEEP", kind: "slab", world: B0_ID, seed: 101, T: REGIME.T0, extinctAt: null, cells: 524288, living: 60000,
    Bstar: 14, NE: 5000, liveblkT: 300, liveT: 5000, h0: selectionSeed(101, REGIME.T0), liveR: new Array(1001).fill(60000), livingEnd: 61000, bank: goodBank(), checks: { ...OK_CHECKS },
    ruleSha: "r", codeCommit: "c", srcHash: "s", treeClean: true, ...o,
  });
  it("summarizeJob: R3 and R5 around the readings of a bank", () => {
    const ok = summarizeJob(job());
    expect(ok).toMatchObject({ invalid: false, extinct: false, noTarget: false, flag: "IN_WINDOW", diedInPhase: false, drift: false });
    expect(Object.keys(ok.readings).sort()).toEqual(["P1-net", "P1-occ"]);
    expect(ok.readings["P1-net"]!.jobClass).toBe("CRITICAL");
    expect(Object.keys(summarizeJob(job(), ["occ"]).readings)).toEqual(["P1-occ"]);
    expect(isVotingJob(ok, "P1-net")).toBe(true);
    expect(isValidJob(ok, "P1-net")).toBe(true);
    const ext = summarizeJob(job({ extinctAt: 6000, bank: undefined, living: 0 }));
    expect(ext).toMatchObject({ extinct: true, extinctAt: 6000, flag: null, readings: {} });
    expect(isValidJob(ext, "P1-net")).toBe(false);
    expect(summarizeJob(job({ NE: 63, bank: undefined })).noTarget).toBe(true);
    expect(summarizeJob(job({ Bstar: null, NE: 0, bank: undefined })).noTarget).toBe(true);
    const carpet = summarizeJob(job({ living: 480000 }));
    expect(carpet.flag).toBe("CARPET");
    expect(isValidJob(carpet, "P1-net")).toBe(false);
    expect(Object.keys(carpet.readings)).toHaveLength(2); // carpets and relics are still metered
    expect(summarizeJob(job({ living: 3000 })).flag).toBe("RELIC");
    const died = summarizeJob(job({ liveR: Array.from({ length: 1001 }, (_, t) => (t >= 600 ? 0 : 60000)), livingEnd: 0 }));
    expect(died).toMatchObject({ diedInPhase: true, drift: false });
    expect(died.readings["P1-net"]!.jobClass).toBeNull();
    const drift = summarizeJob(job({ livingEnd: 450000 }));
    expect(drift).toMatchObject({ drift: true, diedInPhase: false });
    expect(drift.readings["P1-net"]!.jobClass).toBeNull();
    const bad = summarizeJob(job({ checks: { ...OK_CHECKS, C1: { ok: false }, C4: { ok: true, applicable: false } } }));
    expect(bad).toMatchObject({ invalid: true, invalidChecks: ["C1"] });
  });
  it("a check that is absent was not passed: a METERED job lacking C1 to C8 entries is INVALID, an EXTINCT or NO_TARGET job lacking C2, C4 or C6 too (R5)", () => {
    const { C1: _c1, C7: _c7, ...partial } = OK_CHECKS;
    expect(summarizeJob(job({ checks: partial }))).toMatchObject({ invalid: true, invalidChecks: ["C1", "C7"] });
    expect(summarizeJob(job({ checks: {} })).invalidChecks).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"]);
    expect(summarizeJob(job({ checks: { ...OK_CHECKS, C3: { ok: true, applicable: false } } })).invalid).toBe(false); // not applicable is present
    // extinct and no-target jobs run no twins: C2, C4 and C6 are what they carry
    const dead = { extinctAt: 6000, bank: undefined, living: 0 };
    expect(summarizeJob(job({ ...dead, checks: { C2: { ok: true }, C4: { ok: true }, C6: { ok: true } } })).invalid).toBe(false);
    expect(summarizeJob(job({ ...dead, checks: { C2: { ok: true }, C6: { ok: true } } }))).toMatchObject({ invalid: true, invalidChecks: ["C4"] });
    expect(summarizeJob(job({ NE: 63, bank: undefined, checks: {} })).invalidChecks).toEqual(["C2", "C4", "C6"]);
    expect(missingChecks({ C2: { ok: true } }, "EXTINCT")).toEqual(["C4", "C6"]);
    expect(missingChecks(undefined, "METERED")).toEqual([...REQUIRED_CHECKS.METERED]);
  });
  it("mergeSummaries joins the two rung files of one gate job", () => {
    const p1 = summarizeJob(job({ id: "a-P1" }));
    const p2 = summarizeJob(job({ id: "a-P2", bank: goodBank({ rung: "P2" }), checks: { ...OK_CHECKS, C2: { ok: false } } }));
    const m = mergeSummaries([p1, p2]);
    expect(Object.keys(m.readings).sort()).toEqual(["P1-net", "P1-occ", "P2-net", "P2-occ"]);
    expect(m.invalid).toBe(true);
    expect(m.invalidChecks).toEqual(["C2"]);
    expect(m.id).toBe("a-P1");
  });
  it("sensitivity scenarios move ten constants by 25 percent in the widening and narrowing direction", () => {
    const sc = sensitivityScenarios();
    expect(sc).toHaveLength(20);
    const get = (k: string, d: "widen" | "narrow") => sc.find((s) => s.constant === k && s.direction === d)!.consts as unknown as Record<string, number>;
    expect(get("D_LO", "widen").D_LO).toBeCloseTo(0.375, 12);
    expect(get("D_HI", "widen").D_HI).toBeCloseTo(2.5, 12);
    expect(get("B_LO", "widen").B_LO).toBeCloseTo(-0.625, 12);
    expect(get("SPEED_MIN", "narrow").SPEED_MIN).toBeCloseTo(REGIME.SPEED_MIN * 1.25, 12);
    // a moved constant changes a class: at D_HI = 2.5 an s of 2.2 is CRITICAL, at 2.0 CHAOTIC
    expect(derridaClass(2.2)).toBe("CHAOTIC");
    expect(derridaClass(2.2, get("D_HI", "widen") as never)).toBe("CRITICAL");
    expect(REGIME.D_HI).toBe(2); // the defaults are untouched
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R6.9 entropy, R6.10 divergence (descriptive columns)

describe("R6.9 spatial entropy of B (descriptive)", () => {
  const g = SLAB_GEOM;
  const n = g.W * g.H * g.D;
  const VAL = [0, 2, 8, 20]; // one B value per symbol
  const field = (symbolAt: (x: number, y: number, z: number, v: number) => number) => {
    const B = new Uint32Array(n);
    for (let z = 0; z < g.D; z++) for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) { const v = voxelAt(x, y, z, g); B[v] = VAL[symbolAt(x, y, z, v)]; }
    return B;
  };
  const uniform = (seed: number) => field((_x, _y, _z, v) => lowbias32((v + seed * 7919) >>> 0) >>> 30);
  const H4 = (p: number[]) => -p.reduce((a, x) => a + (x > 0 ? x * Math.log2(x) : 0), 0);
  const h0 = selectionSeed(101, REGIME.T0);

  it("the symbols are the bins {0}, {1..3}, {4..15}, {>=16} (edges 1, 4, 16)", () => {
    expect([0, 1, 3, 4, 15, 16, 400].map((b) => quantiseB([b])[0])).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });
  it("a constant field has 0 bits everywhere", () => {
    const c = field(() => 3);
    const e = spatialEntropy(c, c, g, h0);
    expect(e).toMatchObject({ H0: 0, h_sp: 0, h_z: 0, h_st: 0 });
  });
  it("i.i.d. uniform symbols give 2 bits within the printed bias, and a c_ratio near 1", () => {
    const a = uniform(1);
    const e = spatialEntropy(a, uniform(2), g, h0);
    expect(e.h_sp_bias).toBeCloseTo(0.0011, 4);
    expect(Math.abs(e.H0 - 2)).toBeLessThan(0.001);
    expect(2 - e.h_sp).toBeLessThan(e.h_sp_bias + 0.002);
    expect(e.h_sp).toBeLessThanOrEqual(2 + 1e-9);
    expect(Math.abs(e.h_z! - 2)).toBeLessThan(0.002);
    expect(Math.abs(e.h_st! - 2)).toBeLessThan(0.01); // 28 contexts; the later field is independent of this one
    expect(e.c_ratio!).toBeGreaterThan(0.97);
    expect(e.c_ratio!).toBeLessThan(1.03);
  });
  it("a first-order Markov field along x gives its known entropy rate", () => {
    const P = [[0.7, 0.1, 0.1, 0.1], [0.2, 0.5, 0.2, 0.1], [0.1, 0.1, 0.6, 0.2], [0.05, 0.15, 0.2, 0.6]];
    let pi = [0.25, 0.25, 0.25, 0.25];
    for (let i = 0; i < 500; i++) pi = pi.map((_, j) => pi.reduce((a, p, k) => a + p * P[k][j], 0));
    const rate = pi.reduce((a, p, i) => a + p * H4(P[i]), 0);
    const B = new Uint32Array(n);
    for (let z = 0; z < g.D; z++)
      for (let y = 0; y < g.H; y++) {
        let s = 0;
        for (let x = -30; x < g.W; x++) {
          const u = (lowbias32((voxelAt(Math.max(x, 0), y, z, g) * 31 + x + 77) >>> 0) >>> 0) / 4294967296;
          let acc = 0, nx = 3;
          for (let j = 0; j < 4; j++) { acc += P[s][j]; if (u < acc) { nx = j; break; } }
          s = nx;
          if (x >= 0) B[voxelAt(x, y, z, g)] = VAL[s];
        }
      }
    const e = spatialEntropy(B, null, g, h0);
    expect(rate).toBeLessThan(H4(pi) - 0.1); // the rate is well below the marginal entropy
    expect(Math.abs(e.H0 - H4(pi))).toBeLessThan(0.01);
    expect(Math.abs(e.h_sp - rate)).toBeLessThan(0.02);
    expect(e.h_st).toBeNull();
  });
  it("a striped field is far more compressible than its shuffle: c_ratio far below 1", () => {
    const stripes = field((x) => (Math.floor(x / 16) % 2 === 0 ? 3 : 0));
    const e = spatialEntropy(stripes, null, g, h0);
    expect(e.c_ratio!).toBeLessThan(0.2);
    expect(e.H0).toBeCloseTo(1, 12);
    // within a stripe the neighbours decide the symbol: the conditional entropy is nearly 0 (only the stripe edges are uncertain)
    expect(e.h_sp).toBeLessThan(0.1);
  });
  it("2D worlds have no vertical entropy, and the space-time estimator is 0 for an unchanged field", () => {
    const g2: Geom = { W: 64, H: 64, D: 1 };
    const B = new Uint32Array(64 * 64);
    for (let i = 0; i < B.length; i++) B[i] = VAL[lowbias32(i + 5) >>> 30];
    const e = spatialEntropy(B, B, g2, h0);
    expect(e.h_z).toBeNull();
    expect(e.h_st).toBe(0);
  });
  it("conditional entropy, marginal entropy and the bias bound on small cases", () => {
    expect(marginalEntropy([0, 1, 2, 3], 4)).toBe(2);
    expect(marginalEntropy([1, 1, 1, 1], 4)).toBe(0);
    expect(conditionalEntropy([0, 0, 1, 1], [0, 1, 0, 1], 2, 2)).toBe(1);
    expect(conditionalEntropy([0, 0, 1, 1], [0, 0, 1, 1], 2, 2)).toBe(0);
    expect(conditionalEntropy([0, 1, 0, 1], [0, 0, 1, 1], 2, 2)).toBe(1);
    expect(entropyBiasBound(256, 4, 524288)).toBeCloseTo(0.001057, 6);
  });
  it("the Hilbert order is a permutation whose consecutive cells are neighbours; the shuffle is a seeded permutation", () => {
    for (const [W, H] of [[8, 8], [16, 16], [256, 256]] as const) {
      const o = hilbertOrder(W, H);
      expect(o).toHaveLength(W * H);
      expect(new Set(o).size).toBe(W * H);
      for (let k = 1; k < o.length; k++) {
        const dx = Math.abs((o[k] % W) - (o[k - 1] % W)), dy = Math.abs(Math.floor(o[k] / W) - Math.floor(o[k - 1] / W));
        expect(dx + dy).toBe(1);
      }
    }
    expect(hilbertOrder(10, 6)).toHaveLength(60); // cells of the covering curve outside the grid are skipped
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
    const a = seededShuffle(bytes, 12345), b = seededShuffle(bytes, 12345), c = seededShuffle(bytes, 12346);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    expect(Array.from(a).sort((x, y) => x - y)).toEqual(Array.from(bytes).sort((x, y) => x - y));
    expect(Array.from(a)).not.toEqual(Array.from(bytes));
  });
});

describe("R6.10 genome-set, lineage and census divergence (descriptive)", () => {
  it("J_id is the symmetric difference of the lineage-id sets over their union; an empty union is NA", () => {
    const mk = (ids: number[]) => ({ live: ids.map((x) => (x ? 1 : 0)), idHi: ids.map(() => 0), idLo: ids, fp: ids.map(() => 7) });
    const R = mk([1, 2, 3, 0, 0]);
    expect(lineageDivergence(R, R)).toEqual({ Jid: 0, Jg: 0, ngdiff: 0 });
    // R = {1, 2, 3}, S = {2, 3, 4}: 2 in the symmetric difference of a union of 4
    expect(lineageDivergence(mk([0, 2, 3, 4, 0]), R).Jid).toBe(0.5);
    // the set, not the voxel: two voxels with one id count once
    expect(lineageDivergence(mk([1, 1, 2, 3, 0]), R).Jid).toBe(0);
    expect(lineageDivergence(mk([0, 0, 0, 0, 0]), mk([0, 0, 0, 0, 0])).Jid).toBeNull();
    expect(lineageDivergence(mk([0, 0, 0, 0, 0]), R).Jid).toBe(1);
  });
  it("J_g sees different genomes under equal ids, which J_id cannot; n_gdiff counts the voxels living in both whose fingerprints differ", () => {
    const R = { live: [1, 1, 1, 1], idHi: [0, 0, 0, 0], idLo: [1, 2, 3, 4], fp: [10, 20, 30, 40] };
    const S = { live: [1, 1, 1, 0], idHi: [0, 0, 0, 0], idLo: [1, 2, 3, 4], fp: [10, 21, 31, 40] };
    const d = lineageDivergence(S, R);
    expect(d.Jid).toBe(0.25); // id 4 only in R
    expect(d.ngdiff).toBe(2);
    expect(d.Jg).toBe(5 / 6); // triples: S has 3, R has 4, only (1, 10) is shared: union 6, symmetric difference 5
  });
  it("fingerprints: a chained lowbias32 hash of all genome words of a voxel", () => {
    expect(genomeFingerprint([1, 2, 3])).toBe(genomeFingerprint([1, 2, 3]));
    expect(genomeFingerprint([1, 2, 3])).not.toBe(genomeFingerprint([1, 2, 4]));
    expect(genomeFingerprint([0, 2, 3])).not.toBe(genomeFingerprint([1, 2, 3]));
    expect(genomeFingerprint([1, 2])).not.toBe(genomeFingerprint([1, 2, 0]));
    const n = 3, ch = 4;
    const genome = new Uint32Array(n * ch);
    for (let c = 0; c < ch; c++) for (let v = 0; v < n; v++) genome[c * n + v] = 10 * c + v;
    const fp = genomeFingerprints(genome, n, ch);
    expect(fp[1]).toBe(genomeFingerprint([1, 11, 21, 31]));
  });
  it("census divergence floors its denominators at 1; the scale curve is the relative L1 of the tiled column sums", () => {
    expect(censusDivergence({ liveS: 110, liveR: 100, sumBS: 900, sumBR: 1000 })).toEqual({ dLiving: 0.1, dSumB: 0.1 });
    expect(censusDivergence({ liveS: 5, liveR: 0, sumBS: 3, sumBR: 0 })).toEqual({ dLiving: 5, dSumB: 3 });
    const g: Geom = { W: 8, H: 8, D: 2 };
    const Bref = new Uint32Array(g.W * g.H * g.D).fill(1); // sum 128
    const Bx = Bref.slice();
    Bx[voxelAt(0, 0, 0, g)] += 5; // column (0, 0)
    Bx[voxelAt(1, 0, 1, g)] -= 1; // column (1, 0): another column of the same 2 x 2 tile, other layer
    const curve = scaleCurve(Bref, Bx, g, [1, 2, 4, 8]);
    expect(curve[0]).toBeCloseTo(6 / 128, 12); // per column: |+5| + |-1|
    expect(curve[1]).toBeCloseTo(4 / 128, 12); // the 2 x 2 tile sums +4
    expect(curve[2]).toBeCloseTo(4 / 128, 12);
    expect(curve[3]).toBeCloseTo(4 / 128, 12);
    expect(scaleCurve(Bref, Bref, g)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Array.from(blockNetDiff(Bref, Bx, g)).filter((x) => x !== 0)).toEqual([4]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The simulator's own arithmetic that the rule relies on (the rows marked (code))

describe("R14 rows 88 to 90 (code): integer transport keeps a kick on a low-B voxel", () => {
  /** What a voxel at rest keeps in one step: q minus the 26 shares it sends (step3d.ts: weights 8, 64, 8 over 80 for spread 8). */
  const stay = (q: number) => {
    const w = (o: number) => w1d(0, o, 40);
    let s = q;
    for (let tz = -1; tz <= 1; tz++) for (let ty = -1; ty <= 1; ty++) for (let tx = -1; tx <= 1; tx++) if (tx || ty || tz) s -= share3(q, w(tx), w(ty), w(tz), 80);
    return s;
  };
  it("R14 row 88: the share3 table at rest keeps all of B = 12, 13 and 16", () => {
    expect([w1d(0, -1, 40), w1d(0, 0, 40), w1d(0, 1, 40)]).toEqual([8, 64, 8]);
    expect([12, 13, 16].map(stay)).toEqual([12, 13, 16]);
  });
  it("R14 row 89: at B = 20, 39 and 100 a voxel keeps 18, 29 and 64", () => {
    expect([20, 39, 100].map(stay)).toEqual([18, 29, 64]);
  });

  const slow = process.env.BL_REGIME_SLOW === "1";
  // About two minutes of CPU on a shared Mac, so it is opt-in like the 64 x 64 x 8 pins of golden-hashes.test.ts:
  //   BL_REGIME_SLOW=1 pnpm vitest run packages/metrics/test/regime3.test.ts
  // tests/deno/regime_controls.ts runs the same row on the GPU twin as well.
  it.skipIf(!slow)("R14 row 90: RefSim3 32 x 32 x 8, dtQ 0, motility false: a 12-unit kick on a voxel with B = 13 is still at its block after 100 steps", () => {
    const cfg = defaultConfig({ kernelRadius: 3, tileD: 8, lightK: 1024, lightMode: "uniform", tileW: 32, tileH: 32, dtQ: 0, motility: false, seed: 5 });
    const g: Geom = { W: 32, H: 32, D: 8 };
    const nn = cellCount(cfg);
    const s = buildWorld3(cfg, { nutrient: 32, waste: 0, founders: [{ x: 16, y: 16, z: 4, radius: 3, genome: generalistGenome3(30, 8), biomass: 13, energy: 20 }] });
    const v = voxelAt(16, 16, 4, g);
    s.cells[CH.B * nn + v] = 13;
    const X = cloneState(s);
    X.cells[CH.B * nn + v] -= 12;
    X.cells[CH.C * nn + v] += 12;
    X.heatOut += BigInt(12 * (cfg.eB - cfg.eC));
    const R = new RefSim3(s), Xs = new RefSim3(X);
    const block = blockOfVoxel(v, g);
    for (let step = 1; step <= 100; step++) {
      R.step();
      Xs.step();
      if (step === 1 || step === 10 || step === 30 || step === 100) {
        const d = diffCounters(R.state.cells, Xs.state.cells, g, { thetaB: 6, thetaV: 3 });
        expect(d.row.n_blk).toBe(1); // no other block is damaged: the kick has not moved
        expect(d.blocks.net[block]).toBeLessThanOrEqual(-6); // and its block still misses at least thetaB of biomass
      }
    }
  }, 900_000);
});

// ---------------------------------------------------------------------------------------------------------------------
// Assembly helpers, and the whole chain from twin banks to an outcome

describe("assembly: setting rows, gate report, combination names", () => {
  it("combination keys round-trip", () => {
    for (const c of COMBINATIONS) expect(comboOf(comboKey(c))).toEqual(c);
    expect(comboKey({ rung: "P2", decider: "occ" })).toBe("P2-occ");
  });
  it("buildSettingRows groups jobs by setting, reads a setting with extension seeds by the six-seed rule, and gives an unrun setting INSUFFICIENT", () => {
    const jobs = [
      ...mkJobs(B0_ID, ["CRITICAL", "CRITICAL", "CRITICAL"]),
      ...mkJobs("mu40-s8-k256", ["CRITICAL", "CRITICAL", "CRITICAL", "ORDERED", "ORDERED", "ORDERED"]),
      ...mkJobs("mu20-s8-k256", ["EXTINCT", "EXTINCT", "EXTINCT"]),
    ];
    const rows = buildSettingRows(jobs, P1NET);
    expect(rows).toHaveLength(32);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(B0_ID).result).toMatchObject({ cls: "CRITICAL", extended: false });
    expect(by("mu40-s8-k256").result).toMatchObject({ cls: "SPLIT", extended: true }); // 3-3 with six seeds
    expect(by("mu20-s8-k256").result.status).toBe("UNMETERABLE");
    expect(by("mu30-s16-k256").result.cls).toBe("INSUFFICIENT");
    expect(by("mu30-s8-k256-nomut").control).toBe(true);
    expect(seedsByWorld(jobs)).toMatchObject({ [B0_ID]: [101, 102, 103], "mu40-s8-k256": [101, 102, 103, 104, 105, 106] });
  });
  it("gateReport evaluates the selected combination and the other three for information, with the amplitude label", () => {
    const jobs = gateJobs((c) => (c.key === "P2-occ" && c.role === "G3" ? { jobClass: "CRITICAL" } : undefined));
    const r = gateReport(jobs, P1NET);
    expect(r.selected.pass).toBe(true);
    expect(r.others.map((o) => comboKey(o.combo))).toEqual(["P1-occ", "P2-net", "P2-occ"]);
    expect(r.others.map((o) => o.pass)).toEqual([true, true, false]);
    expect(codes(r.others[2].causes)).toEqual(["CARPET-NOT-SEPARATED"]);
    expect(r.amp).toBe("AMP-ROBUST");
    const failing = gateReport(gateJobs((c) => (c.role === "G2" ? { jobClass: "ORDERED", dClass: "ORDERED", tClass: "ORDERED" } : undefined)), P1NET);
    expect(failing.selected.refClass).toBeNull();
    expect(failing.amp).toBeNull();
  });
  it("GATE-FAIL carries the other combinations' causes through, information only", () => {
    const rep = gateReport(gateJobs((c) => (c.key === "P1-net" && c.role === "G3" ? { jobClass: "CRITICAL" } : undefined)), P1NET);
    const o = outcome(table({}), { gate: { pass: rep.selected.pass, causes: rep.selected.causes, others: rep.others.map((x) => ({ combo: x.combo, causes: x.causes })) } });
    expect(o.id).toBe("GATE-FAIL");
    expect(codes((o as { causes: { code: string }[] }).causes)).toEqual(["CARPET-NOT-SEPARATED"]);
    expect((o as { others: unknown[] }).others).toHaveLength(3);
  });
});

describe("from twin banks to an outcome", () => {
  const rungP2: Combination = P2NET;
  const bankJob = (world: string, seed: number, T: number, o: BankOpts, extra: Partial<RegimeJob> = {}): JobSummary =>
    summarizeJob({
      id: jobId({ kind: "slab", world, seed, T, rung: o.rung ?? "P1", decider: "net" }), role: "SWEEP", kind: "slab", world, seed, T, extinctAt: null, cells: 524288, living: 60000,
      Bstar: 14, NE: 5000, liveblkT: 300, liveT: 5000, h0: selectionSeed(seed, T), liveR: new Array(1001).fill(60000), livingEnd: 60500, bank: mkBank(o), checks: { ...OK_CHECKS },
      ruleSha: "r", codeCommit: "c", srcHash: "s", ...extra,
    }, ["net"]);
  const settingJobs = (world: string, o: BankOpts, T = REGIME.T0) => SEEDS3.map((s) => bankJob(world, s, T, o));

  it("three CRITICAL banks make a CRITICAL setting, and a CRITICAL T1 reading makes BAND-FOUND", () => {
    const t0 = settingJobs(B0_ID, { shape: "critical" });
    const rows = buildSettingRows(t0, P1NET);
    expect(rows[rows.findIndex((r) => r.id === B0_ID)].result).toMatchObject({ cls: "CRITICAL", voting: 3 });
    const t1 = settingJobs(B0_ID, { shape: "critical" }, REGIME.T1);
    const o = decideOutcome({ validation: validateRun([...t0, ...t1]), gate: { pass: true, causes: [] }, rows, refClass: "CRITICAL", amp: "AMP-ROBUST", extended: false, combo: P1NET, late: { t1Jobs: t1, seedsOf: seedsByWorld(t0) } });
    expect(o).toMatchObject({ id: "BAND-FOUND", settings: [B0_ID] });
    // a T1 reading that dies away makes it a transient
    const gone = decideOutcome({ validation: okRun, gate: { pass: true, causes: [] }, rows, refClass: "CRITICAL", amp: "AMP-ROBUST", extended: false, combo: P1NET, late: { t1Jobs: settingJobs(B0_ID, { shape: "ordered", s30: 0.2 }, REGIME.T1), seedsOf: seedsByWorld(t0) } });
    expect(gone.id).toBe("TRANSIENT-BAND");
  });
  it("a frozen scar reads ORDERED (FROZEN) and a saturating bank CHAOTIC, so a CRITICAL target is not reached by either", () => {
    const rows = buildSettingRows([...settingJobs(B0_ID, { shape: "frozen" }), ...settingJobs("mu40-s8-k256", { shape: "saturated", s30: 4 })], P1NET);
    expect(rows.find((r) => r.id === B0_ID)!.result.cls).toBe("ORDERED");
    expect(rows.find((r) => r.id === "mu40-s8-k256")!.result.cls).toBe("CHAOTIC");
    expect(rows.filter(isClassBearing)).toHaveLength(2);
  });
  it("jobs read under rung P2 are keyed P2-net and the bank's own thresholds are reported", () => {
    const j = bankJob(B0_ID, 101, REGIME.T0, { rung: "P2" });
    expect(Object.keys(j.readings)).toEqual(["P2-net"]);
    expect(j.readings["P2-net"]).toMatchObject({ rung: "P2", thetaB: 6 });
    expect(settingResult([j, bankJob(B0_ID, 102, REGIME.T0, { rung: "P2" }), bankJob(B0_ID, 103, REGIME.T0, { rung: "P2" })], rungP2).cls).toBe("CRITICAL");
    expect(settingResult([j], P1NET).valid).toBe(0); // no P1 reading: not valid under that combination
  });
  it("the whole chain is deterministic: the same banks give the same readings", () => {
    const a = analyzeBank(CORE, mkBank({ shape: "critical", withF: true }), "net");
    const b = analyzeBank(CORE, mkBank({ shape: "critical", withF: true }), "net");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(allFinite(a)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Small pieces: speed, logs, exact fractions

describe("R6.11 speed, the log helpers, exact fractions", () => {
  it("speed is the median over the sites that still have damage at step 1000 of the growth of the reach from step 100 to 1000, per step", () => {
    const steps = storedSteps();
    const mk = (n1000: number[], reach100: number[], reach1000: number[]) => ({
      steps,
      nDec: n1000.map((n) => steps.map((t) => (t >= 995 ? n : 1))),
      reach: reach100.map((r, j) => steps.map((t) => (t >= 995 ? reach1000[j] : t >= 95 && t <= 105 ? r : 0))),
    });
    // three surviving sites growing by 9, 18 and 27 voxels; the median is 18 voxels over 900 steps
    expect(siteSpeed(mk([1, 1, 1], [4, 4, 4], [13, 22, 31]))).toBe(18 / 900);
    // a site with no damage at 1000 is not counted (its reach is not a speed), even if its reach was large before
    expect(siteSpeed(mk([1, 0, 1], [4, 4, 4], [13, 100, 31]))).toBe(((13 - 4) / 900 + (31 - 4) / 900) / 2);
    expect(siteSpeed(mk([0, 0], [4, 4], [4, 4]))).toBeNull();
    // the subset (with repeats) is what the bootstrap passes
    expect(siteSpeed(mk([1, 1, 1], [4, 4, 4], [13, 22, 31]), [0, 0, 2])).toBe(9 / 900);
    // the window means: a reach that is 4 at steps 95 to 99 and 6 at 100 to 105 averages 5 (+ the clip of the window)
    const sS = { steps, nDec: [steps.map(() => 1)], reach: [steps.map((t) => (t >= 100 && t <= 105 ? 6 : t >= 95 && t <= 99 ? 4 : t >= 995 ? 14 : 0))] };
    expect(siteSpeed(sS)).toBeCloseTo((14 - (5 * 4 + 6 * 6) / 11) / 900, 12);
  });
  it("diff logs are columns by step: build from rows, read a row back, and pick the deciding and the other column", () => {
    expect(Object.keys(emptyDiffLog())).toEqual([...DIFF_COLUMNS]);
    const rows = [0, 1, 2].map((t) => Object.fromEntries(DIFF_COLUMNS.map((k, i) => [k, 100 * t + i])) as DiffRow);
    const log = diffLogFromRows(rows);
    expect(diffLogLength(log)).toBe(3);
    expect(diffRowAt(log, 2)).toEqual(rows[2]);
    expect(decidingColumn(log, "net")).toBe(log.n_blk);
    expect(decidingColumn(log, "occ")).toBe(log.n_occ);
    expect(otherColumn(log, "net")).toBe(log.n_occ);
    expect(otherColumn(log, "occ")).toBe(log.n_blk);
  });
  it("count fractions are compared exactly by cross-multiplication", () => {
    const tenth = REGIME.DOSE_CAP;
    expect(fracCmp(1, 10, tenth)).toBe(0);
    expect(fracGE(1, 10, tenth)).toBe(true);
    expect(fracLE(1, 10, tenth)).toBe(true);
    expect(fracGT(1, 10, tenth)).toBe(false);
    expect(fracLT(1, 10, tenth)).toBe(false);
    expect(fracGT(1001, 10000, tenth)).toBe(true);
    expect(fracLE(1000, 10000, tenth)).toBe(true);
    expect(fracGE(9, 10, REGIME.NO_CONTRAST)).toBe(true);
    expect(fracGE(8, 10, REGIME.NO_CONTRAST)).toBe(false);
    expect(fracGE(27, 30, REGIME.NO_CONTRAST)).toBe(true); // 0.9 * 30 is not an exact double product, the cross-multiplication is
    expect(fracGT(16, 31, REGIME.UNMET_FRAC)).toBe(true);
    expect(fracGT(15, 31, REGIME.UNMET_FRAC)).toBe(false);
    expect(fracGT(0, 0, REGIME.UNMET_FRAC)).toBe(false);
    expect(fracValue(REGIME.U_MAX)).toBe(0.25);
  });
});

describe("cross-checks of the logs a runner writes", () => {
  it("the per-site log must hold every step of the eight windows, and the per-site counts must add up to the global ones", () => {
    const bank = mkBank({ shape: "critical", withF: true });
    expect(siteLogComplete(bank.S!.sites)).toBe(true);
    expect(siteLogComplete({ ...bank.S!.sites, steps: bank.S!.sites.steps.filter((t) => t !== 140) })).toBe(false);
    expect(siteLogComplete({ ...bank.S!.sites, n_blk: bank.S!.sites.n_blk.map((r) => r.slice(1)) })).toBe(false);
    expect(siteSumsMatchGlobal(bank.S!.log, bank.S!.sites, "net")).toBe(true);
    expect(siteSumsMatchGlobal(bank.S!.log, bank.S!.sites, "occ")).toBe(true);
    const log = mkLog(1001, { n_blk: () => 12, n_occ: () => 12 });
    expect(siteSumsMatchGlobal(log, mkSiteLog(12, () => 1, () => 4), "net")).toBe(true);
    expect(siteSumsMatchGlobal(log, mkSiteLog(12, (j) => (j === 0 ? 2 : 1), () => 4), "net")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Fixes from the build review (runs/regime/review-build/fix-table.md): guards against incomplete or ambiguous input

describe("review fixes: C1 reads steps 1 to 100 in full (CX-F18, CR-F13)", () => {
  const zeros = (n: number) => Object.fromEntries(DIFF_COLUMNS.map((k) => [k, new Array(n).fill(0)]));
  it("a zero control passes; a counter set at step 100, a column that stops short and thirteen empty columns do not", () => {
    expect(checkC1({ counters: zeros(101), hashZ: "ab", hashR: "ab" })).toEqual({ ok: true });
    expect(checkC1({ counters: { ...zeros(101), n_blk: [...new Array(100).fill(0), 1] }, hashZ: "x", hashR: "x" })).toMatchObject({ ok: false, detail: "n_blk[100] = 1" });
    expect(checkC1({ counters: zeros(0), hashZ: "x", hashR: "x" }).ok).toBe(false); // thirteen empty columns are not a zero control
    expect(checkC1({ counters: zeros(100), hashZ: "x", hashR: "x" }).ok).toBe(false); // stops at step 99
    expect(checkC1({ counters: zeros(1), hashZ: "x", hashR: "x" }).ok).toBe(false);
  });
  it("only steps 1 to 100 are read: a longer column (a FEW_SITES job runs Z for 1,000 steps) may differ from step 101 on; step 0 is the pass before step 1", () => {
    expect(checkC1({ counters: { ...zeros(1001), n_vox: [0, ...new Array(100).fill(0), 5, ...new Array(899).fill(0)] }, hashZ: "x", hashR: "x" }).ok).toBe(true);
    expect(checkC1({ counters: { ...zeros(101), n_vox: [3, ...new Array(100).fill(0)] }, hashZ: "x", hashR: "x" }).ok).toBe(true);
  });
  it("two empty hashes are equal and prove nothing: a missing hash fails", () => {
    expect(checkC1({ counters: zeros(101), hashZ: "", hashR: "" }).ok).toBe(false);
    expect(checkC1({ counters: zeros(101), hashZ: "ab", hashR: "" }).ok).toBe(false);
  });
});

describe("review fixes: an incomplete job set never passes (CR-F01, CX-F7, CX-F11)", () => {
  it("the rosters: Stage 0 is 18 jobs on seeds 9001 to 9003, the gate 20 on seeds 101 to 103 (G4 on 101 and 102), the 2D worlds at T1 and T2 only; the sweep is 96", () => {
    const dev = expectedRoster("dev");
    const gate = expectedRoster("gate");
    expect([dev.length, gate.length, sweepRoster().length]).toEqual([18, 20, 96]);
    const by = (xs: ReturnType<typeof expectedRoster>, role: string) => xs.filter((x) => x.role === role);
    expect(["G2", "G3", "B0", "G1", "G4"].map((r) => by(dev, r).length)).toEqual([12, 3, 3, 0, 0]);
    expect(["G2", "G3", "B0", "G1", "G4"].map((r) => by(gate, r).length)).toEqual([12, 3, 0, 3, 2]);
    expect([REGIME.T1, REGIME.T2]).toEqual([...refTimes()]);
    for (const roster of [dev, gate]) {
      expect(new Set(roster.filter((j) => j.kind === "2d").map((j) => j.T))).toEqual(new Set([50000, 100000]));
      expect(roster.filter((j) => j.kind === "slab").every((j) => j.T === 20000)).toBe(true);
    }
    expect(dev.every((j) => j.dev && [9001, 9002, 9003].includes(j.seed))).toBe(true);
    expect(gate.every((j) => !j.dev && [101, 102, 103].includes(j.seed))).toBe(true);
    expect(by(gate, "G4").map((j) => j.seed)).toEqual([101, 102]);
    expect([gateSlabId("G1"), gateSlabId("G3"), gateSlabId("G4")]).toEqual(["mu20-s8-k256", "mu60-s8-k1024", "mu20-s8-k4096"]);
    expect(new Set(sweepRoster().map(rosterKey)).size).toBe(96);
    expect(GATE_GROUP_JOBS).toBe(3);
    // the key joins a job's rung files: kind, world, seed, T and the dev tag
    expect(rosterKey({ kind: "2d", world: "spots-m3", seed: 101, T: 50000 })).toBe("2d|spots-m3|101|50000|main");
    expect(rosterKey({ kind: "2d", world: "spots-m3", seed: 9001, T: 100000, dev: true })).toBe("2d|spots-m3|9001|100000|dev");
  });

  it("G6: one CLEAR job in a group with two missing fails with DUST-CONTROL-UNAVAILABLE (the table of CX-F11, seed 101 only: five jobs now, it had seven when the 2D worlds were also read at T0)", () => {
    const five = gateJobs().filter((j) => (j.role === "G2" || j.role === "G3") && j.seed === 101);
    expect(five).toHaveLength(5);
    const g6 = evaluateG6(five, P1NET);
    expect(g6.holds).toBe(false);
    expect(g6.causes).toHaveLength(1);
    expect(g6.causes[0].code).toBe("DUST-CONTROL-UNAVAILABLE");
    expect(g6.causes[0].where).toHaveLength(5);
    // two CLEAR jobs of a group of two still satisfy the count; the missing third is the roster's cause (INCOMPLETE), not G6's
    expect(evaluateG6(gateJobs().filter((j) => j.seed !== 103), P1NET).holds).toBe(true);
    // an absent job is never CLEAR: one CLEAR and one LIMITED job of a group of two fails with both causes
    const lim = gateJobs((c) => (c.role === "G3" && c.seed === 102 ? { dust: "LIMITED", vote: false } : undefined)).filter((j) => !(j.role === "G3" && j.seed === 103));
    expect(codes(evaluateG6(lim, P1NET).causes)).toEqual(["DUST-LIMITED", "DUST-CONTROL-UNAVAILABLE"]);
  });

  it("a gate with any one job removed fails with INCOMPLETE naming exactly that job, whichever group lost it (CR-F01 a)", () => {
    const full = gateJobs();
    const ok = evaluateGate(full, P1NET, GATE_OK);
    expect(ok.pass).toBe(true);
    expect(ok.roster).toEqual({ holds: true, causes: [] });
    expect(full).toHaveLength(18);
    for (const victim of full) {
      const g = evaluateGate(full.filter((j) => j !== victim), P1NET, GATE_OK);
      expect(g.pass, rosterLabel(victim)).toBe(false);
      expect(g.roster.holds).toBe(false);
      expect(g.causes.find((x) => x.code === "INCOMPLETE")!.where).toEqual([rosterLabel(victim)]);
    }
  });
  it("the case CR-F01 found: the seed-103 G3 job and the spots-m3@50000 seed-103 job removed no longer pass (the case read spots-m3@20000 before the 2D worlds were dropped from T0)", () => {
    const jobs = gateJobs().filter((j) => !(j.role === "G3" && j.seed === 103) && !(j.world === "spots-m3" && j.T === REGIME.T1 && j.seed === 103));
    const g = evaluateGate(jobs, P1NET, GATE_OK);
    expect(g.pass).toBe(false);
    expect(g.causes.find((x) => x.code === "INCOMPLETE")!.where).toEqual(["G3 mu60-s8-k1024 seed 103 T 20000", "G2 spots-m3 seed 103 T 50000"]);
  });
  it("Stage 0 with any one development job removed has no selection: every combination fails with INCOMPLETE", () => {
    const full = gateJobs(undefined, { dev: true });
    expect(full).toHaveLength(15);
    expect(stage0(full, 1).outcome).toBe("STAGE0-PASS");
    expect(gateRosterGaps(full, "dev")).toEqual([]);
    for (const victim of full) {
      const r = stage0(full.filter((j) => j !== victim), 1);
      expect(r.selected, rosterLabel(victim)).toBeNull();
      expect(r.outcome).toBe("STAGE0-FAIL");
      expect(r.combos.every((x) => !x.satisfies && codes(x.causes).includes("INCOMPLETE"))).toBe(true);
    }
    expect(stage0(full.filter((j) => j.seed !== 9003), 3).outcome).toBe("STAGE0-CLOSED");
  });
  it("the gate roster checks G1, G2 and G3 only: a missing G4 or B0 job is not the gate's cause (the reader refuses it)", () => {
    expect(gateRosterGaps(gateJobs(), "gate")).toEqual([]);
    expect(expectedRoster("gate").filter((j) => j.role === "G4")).toHaveLength(2);
    expect(gateRosterGaps(gateJobs(undefined, { dev: true }), "gate").length).toBe(18); // development seeds are not the gate's roster (G1 3, G2 12, G3 3)
  });
});

describe("review fixes: the margin cuts are closed intervals (CX-F12)", () => {
  const m = (o: Partial<JobReading>) => marginHits(reading(o));
  it("a stability exactly 0.05 below or above STABLE is within the margin: 0.75 and 0.85 hit, 0.7499 and 0.8501 do not", () => {
    expect(m({ stT: 0.75 })).toEqual(["stT"]);
    expect(m({ stT: 0.85 })).toEqual(["stT"]);
    expect(m({ stT: 0.7499 })).toEqual([]);
    expect(m({ stT: 0.8501 })).toEqual([]);
    expect(m({ stT: 0.8 })).toEqual(["stT"]);
  });
  it("a dust ratio exactly 0.1 around either line hits: 0.15, 0.35, 0.4 and 0.6; just outside does not", () => {
    for (const v of [0.15, 0.35, 0.4, 0.6]) expect(m({ ratioU: v }), String(v)).toEqual(["ratioU"]);
    for (const v of [0.1499, 0.3501, 0.3999, 0.6001]) expect(m({ ratioU: v }), String(v)).toEqual([]);
  });
});

describe("review fixes: the seed extension is licensed (CX-F8, CX-X2)", () => {
  const input: Omit<OutcomeInput, "rows" | "extended"> = { validation: okRun, gate: { pass: true, causes: [] }, refClass: "CRITICAL", amp: "AMP-ROBUST", combo: P1NET, late: { t1Jobs: [] } };
  const split: JobSpec[] = ["ORDERED", "CHAOTIC", "MIXED"];
  const SPLIT9 = EXTRA.slice(0, 9);
  const t0 = (over: Record<string, JobSpec[]> = {}): JobSummary[] => SPECS.flatMap((s) => mkJobs(s.id, over[s.id] ?? FILL));
  const base = { ...fillWith(BEARING8, ["ORDERED", "ORDERED", "ORDERED"]), ...fillWith(SPLIT9, split) };
  /** The jobs at seeds 104 to 106 of the given settings: `more` are the classes of the three extension seeds. */
  const ext = (ids: string[], more: JobSpec[]): JobSummary[] => ids.flatMap((id) => mkJobs(id, [...split, ...more]).slice(3));
  const rosterOf = (ids: string[]) => SPECS.filter((s) => ids.includes(s.id)).map((s) => s.id);

  it("R10 gives UNRESOLVED on the table of seeds 101 to 103: the extension is licensed for the SPLIT settings, the control excluded, and not yet run", () => {
    const r = sweepWithExtension({ t0: t0({ ...base, "mu30-s8-k256-nomut": split }), combo: P1NET, input });
    expect(r.baseOutcome).toMatchObject({ id: "UNRESOLVED", n: 9, pool: 17 });
    expect(r.ext).toMatchObject({ licensed: true, started: false, complete: false, unlicensed: [], missing: [] });
    expect(r.ext.roster).toEqual(rosterOf(SPLIT9));
    expect(r.outcome.id).toBe("UNRESOLVED"); // not final: the extension has not been run
  });
  it("a complete extension (all of seeds 104 to 106 for every SPLIT setting) is read by the six-seed rule and R10 is read again", () => {
    const r = sweepWithExtension({ t0: [...t0(base), ...ext(SPLIT9, ["ORDERED", "ORDERED", "ORDERED"])], combo: P1NET, input });
    expect(r.ext).toMatchObject({ licensed: true, started: true, complete: true, unlicensed: [], missing: [] });
    expect(r.rows.find((x) => x.id === SPLIT9[0])!.result).toMatchObject({ extended: true, cls: "ORDERED", voting: 5 });
    expect(r.baseRows.find((x) => x.id === SPLIT9[0])!.result.cls).toBe("SPLIT");
    expect(r.outcome).toMatchObject({ id: "NO-BAND", label: "all-ordered" });
  });
  it("UNRESOLVED after a complete extension is UNRESOLVED-FINAL", () => {
    const r = sweepWithExtension({ t0: [...t0(base), ...ext(SPLIT9, ["CHAOTIC", "ORDERED", "CHAOTIC"])], combo: P1NET, input });
    expect(r.ext.complete).toBe(true);
    expect(r.outcome).toMatchObject({ id: "UNRESOLVED-FINAL", n: 9, pool: 17 });
  });
  it("an extension of one SPLIT setting out of nine is incomplete: it is not final, and the 24 missing jobs are named", () => {
    const r = sweepWithExtension({ t0: [...t0(base), ...ext(SPLIT9.slice(0, 1), ["ORDERED", "ORDERED", "ORDERED"])], combo: P1NET, input });
    expect(r.ext).toMatchObject({ licensed: true, started: true, complete: false });
    expect(r.ext.missing).toHaveLength(24);
    expect(r.ext.missing[0]).toEqual({ world: rosterOf(SPLIT9)[1], seed: 104 });
    expect(r.outcome.id).toBe("UNRESOLVED"); // the base outcome: the caller refuses the started and incomplete extension
    // a setting with only two of its three extension seeds is incomplete too
    const two = ext(SPLIT9, ["ORDERED", "ORDERED", "ORDERED"]).filter((j) => !(j.world === SPLIT9[4] && j.seed === 106));
    expect(sweepWithExtension({ t0: [...t0(base), ...two], combo: P1NET, input }).ext.missing).toEqual([{ world: SPLIT9[4], seed: 106 }]);
  });
  it("seed shopping: extension jobs for a setting that was not SPLIT at seeds 101 to 103 are unlicensed (an ORDERED setting turned SPLIT by seeds 104 to 106)", () => {
    const shop = mkJobs("mu20-s8-k256", ["ORDERED", "ORDERED", "ORDERED", "CHAOTIC", "CHAOTIC", "CHAOTIC"]).slice(3);
    const r = sweepWithExtension({ t0: [...t0(base), ...ext(SPLIT9, ["ORDERED", "ORDERED", "ORDERED"]), ...shop], combo: P1NET, input });
    expect(r.ext.unlicensed).toEqual([104, 105, 106].map((seed) => ({ world: "mu20-s8-k256", seed })));
    expect(r.ext.missing).toEqual([]); // the roster's own jobs are all there; the unlicensed ones still stop the read
    expect(r.ext.complete).toBe(false);
    expect(r.outcome.id).toBe("UNRESOLVED"); // the base outcome: the caller refuses the unlicensed jobs and nothing is read from them
    expect(r.rows.find((x) => x.id === "mu20-s8-k256")!.result).toMatchObject({ extended: false, cls: "ORDERED" });
  });
  it("extension jobs when R10 did not call for the extension are all unlicensed (8 of 16 SPLIT is not above half)", () => {
    const eight = { ...fillWith(BEARING8, ["ORDERED", "ORDERED", "ORDERED"]), ...fillWith(EXTRA.slice(0, 8), split) };
    const r = sweepWithExtension({ t0: [...t0(eight), ...ext(EXTRA.slice(0, 8), ["ORDERED", "ORDERED", "ORDERED"])], combo: P1NET, input });
    expect(r.baseOutcome.id).toBe("NO-BAND");
    expect(r.ext).toMatchObject({ licensed: false, complete: false });
    expect(r.ext.unlicensed).toHaveLength(24);
    expect(r.outcome.id).toBe("NO-BAND");
  });
  it("checkExtension on rows: only SPLIT pool settings are on the roster; INSUFFICIENT, DUSTY and the control are not", () => {
    const rows = table({ ...fillWith(["mu20-s8-k256"], split), ...fillWith(["mu40-s8-k256"], ["ORDERED", "CRITICAL", "CARPET"]), ...fillWith(["mu30-s12-k256"], [lim("CRITICAL"), lim("CRITICAL"), lim("CRITICAL")]), "mu30-s8-k256-nomut": split });
    expect(rows.find((r) => r.id === "mu20-s8-k256")!.result.cls).toBe("SPLIT");
    expect(rows.find((r) => r.id === "mu40-s8-k256")!.result.cls).toBe("SPLIT"); // ORDERED, CRITICAL and a carpet leave two valid jobs that disagree
    expect(rows.find((r) => r.id === "mu30-s12-k256")!.result.cls).toBe("DUSTY");
    expect(checkExtension({ baseRows: rows, baseOutcome: "UNRESOLVED", ext: [] }).roster).toEqual(["mu20-s8-k256", "mu40-s8-k256"]);
    expect(checkExtension({ baseRows: rows, baseOutcome: "NO-BAND", ext: [{ world: "mu20-s8-k256", seed: 104 }] })).toMatchObject({ licensed: false, complete: false, started: true });
  });
});

describe("review fixes: the R1 fill and the hash files are read strictly (CX-F9)", () => {
  const rule = (cell: string) => `| name | value | basis |\n|---|---|---|\n| RUNG, DECIDER | ${cell} | J |\n`;
  it("the fill forms are P2, occ and RUNG = P2, DECIDER = occ (a comma; backticks, bold and spaces around , and = are free) and nothing else", () => {
    for (const cell of ["P1, net", "`P2, occ`", "**P1, net**", "RUNG = P2, DECIDER = occ", "RUNG=P1,DECIDER=net", "RUNG = P1, DECIDER = occ", "P2,occ"]) expect(parseCombination(rule(cell)).combo, cell).not.toBeNull();
    expect(parseCombination(rule("RUNG = P2, DECIDER = occ")).combo).toEqual({ rung: "P2", decider: "occ" });
    expect(parseCombination(rule("`P1, net`")).combo).toEqual({ rung: "P1", decider: "net" });
    expect(parseCombination(rule("**RUNG=P2,DECIDER=net**")).combo).toEqual({ rung: "P2", decider: "net" });
  });
  it("final review F5: R1 names two forms and nothing else, so a semicolon, one label without the other and the labels the wrong way round are not fills (each refusal says what the grammar is)", () => {
    for (const cell of ["P2; occ", "**P1; net**", "RUNG = P2; DECIDER = occ", "RUNG=P1; DECIDER=net", "RUNG = P2, occ", "P2, DECIDER = occ", "DECIDER = occ, RUNG = P2", "RUNG = P2 DECIDER = occ", "RUNG = P2, DECIDER = occ;"]) {
      const r = parseCombination(rule(cell));
      expect(r.combo, cell).toBeNull();
      expect(r.why, cell).toContain("a comma between the two, and both labels or neither");
    }
  });
  it("a half fill, a placeholder or any extra text is not a fill, with the reason", () => {
    const half = parseCombination(rule("RUNG = P1; DECIDER is not filled (net is a possibility)"));
    expect(half.combo).toBeNull();
    expect(half.why).toContain("names P1 and net");
    for (const cell of ["**filled in by the finalizer**: `RUNG` in {P1, P2}, `DECIDER` in {net, occ}", "P1, net (selected on run 2)", "P1 or P2, net", "P3, net", "P1, net, occ", "net, P1", "P1", "", "P1,net,"]) expect(parseCombination(rule(cell)).combo, cell).toBeNull();
    expect(parseCombination("# nothing").why).toContain("no R1 row");
    expect(parseCombination(rule("P1 net")).combo).toBeNull(); // the separator is required
  });
  it("hash files: every 64-digit word on a non-comment line, in order, lower-cased; the last is the rule's current hash", () => {
    const a = "a".repeat(64), b = "B".repeat(64);
    expect(parseHashFile(`# ${"c".repeat(64)}\n${a}  file\n${b}\n`)).toEqual([a, "b".repeat(64)]);
    expect(parseHashFile("")).toEqual([]);
    expect(parseHashFile(`x${a}y\n`)).toEqual([]); // a hash inside a longer word is not one
  });
});

describe("review fixes: Stage 0 and gate scope, DRIFT and the F pair on a carpet (CR-F02, CR-F03, CR-F05, CR-F10, CX-F5)", () => {
  const okJob = (seed: number, o: Partial<RegimeJob> = {}): RegimeJob => ({
    id: `slab-mu60-s8-k1024-seed${seed}-t20000-P1`, role: "G3", kind: "slab", world: "mu60-s8-k1024", seed, T: REGIME.T0, extinctAt: null, cells: 524288, living: 500000, Bstar: 14, NE: 5000,
    liveblkT: 300, liveT: 5000, h0: selectionSeed(seed, REGIME.T0), liveR: new Array(1001).fill(500000), livingEnd: 510000, bank: mkBank({ nCol: 1, withF: true, shape: "saturated", s30: 4 }), checks: { ...OK_CHECKS },
    ruleSha: "r", codeCommit: "c", srcHash: "s", treeClean: true, ...o,
  });
  it("a carpet (f >= 0.85 at T and again at T + 1,000) is CARPET and not DRIFT, keeps its class and votes in G3; its F pair is read without the colony clause although it is one colony (R3.7 and R9.2 G7 ii as the code reads them)", () => {
    const jobs = [101, 102, 103].map((s) => summarizeJob(okJob(s), ["net"]));
    for (const j of jobs) {
      const r = j.readings["P1-net"]!;
      expect([j.flag, j.drift, j.diedInPhase]).toEqual(["CARPET", false, false]);
      expect(r).toMatchObject({ fewColonies: true, tClass: "NA", jobClass: "CHAOTIC", flags: ["D_ONLY"], dust: "CLEAR", vote: true, fClass: "ORDERED" });
    }
    const g3 = evaluateG3(jobs, P1NET, "CRITICAL");
    expect(g3).toMatchObject({ holds: true, carpetClass: "CHAOTIC", causes: [] });
    expect(evaluateG7(jobs, P1NET)).toEqual({ holds: true, causes: [] });
    // the same carpet read as DRIFT would have no class: the DRIFT test is for a job that was IN_WINDOW at T
    expect(summarizeJob(okJob(101, { living: 300000, livingEnd: 510000 }), ["net"])).toMatchObject({ flag: "IN_WINDOW", drift: true });
    // a spread FROZEN-free F pair: FEW_SITES still gives the F pair no class (NA fails G7)
    const fs = summarizeJob(okJob(101, { bank: { ...mkBank({ mS: 5, withS: false, withF: true, withN: true }), F: { log: mkBank({ withF: true }).F!.log, sites: mkBank({ withF: true }).F!.sites } } }), ["net"]);
    expect(fs.readings["P1-net"]).toMatchObject({ fewSites: true, fClass: "NA" });
  });

  const asB0 = (jobs: JobSummary[]) => jobs.map((j) => ({ ...j, role: "B0" as const, id: j.id.replace("G2", "B0") }));
  const devJobs = (f?: (c: GateCtx) => Partial<JobReading> | undefined) => gateJobs(f, { dev: true });
  const spotsT1 = (j: JobSummary) => j.role === "G2" && j.world === "spots-m3" && j.T === REGIME.T1;
  it("B0 jobs are informational for the controls and for G8: a B0 job whose N twin does not saturate and whose F pair reads CRITICAL does not fail a combination (R9.2 reads G2 and G3 jobs)", () => {
    const bad = (c: GateCtx) => (c.role === "G2" && c.preset === "spots-m3" && c.T === REGIME.T1 ? { nSat100: 0.001, fClass: "CRITICAL" as const, nDecF30: 99 } : undefined);
    const b0 = asB0(devJobs(bad).filter(spotsT1));
    expect(b0).toHaveLength(3); // not an empty list: the filter finds the three seeds
    const r = stage0([...devJobs(), ...b0], 1);
    expect(r.combos.map((x) => x.satisfies)).toEqual([true, true, true, true]);
    expect(r.selected).toEqual(P1NET);
    // the same readings in G2 jobs do fail
    const g2 = stage0(devJobs(bad), 1);
    expect(g2.combos.every((x) => codes(x.causes).includes("N-NOT-SATURATED") && codes(x.causes).includes("FROZEN-NOT-ORDERED"))).toBe(true);
  });
  it("G1 and G4 jobs are not read by G7: a gate job of role G4 whose controls fail changes nothing", () => {
    const g4 = gateJobs().filter((j) => j.role === "G3" && j.seed === 101).map((j) => ({ ...j, role: "G4" as const, id: "g4-x", readings: { ...j.readings, "P1-net": reading({ nSat100: 0.001, fClass: "CRITICAL", ...CHAOTIC_R }) } }));
    expect(evaluateGate([...gateJobs(), ...g4], P1NET, GATE_OK).pass).toBe(true);
  });
  it("G8 reads the 2D presets at T1 only (the first time they are read): a T2 job reading another class, or a carpet job, does not change the label", () => {
    const t2 = gateJobs((c) => (c.key === "P2-net" && c.role === "G2" && c.T !== REGIME.T1 ? CHAOTIC_R : undefined));
    expect(t2.filter((j) => j.role === "G2" && j.T === REGIME.T2 && j.readings["P2-net"]!.jobClass === "CHAOTIC")).toHaveLength(6); // the T2 jobs do read another class
    expect(ampLabel(t2, P1NET, "CRITICAL")).toBe("AMP-ROBUST");
    const carpet = gateJobs((c) => (c.key === "P2-net" && c.role === "G3" ? { jobClass: "CRITICAL" } : undefined));
    expect(ampLabel(carpet, P1NET, "CRITICAL")).toBe("AMP-ROBUST");
    const t1 = gateJobs((c) => (c.key === "P2-net" && c.role === "G2" && c.T === REGIME.T1 && c.preset === "gradient-m3" ? CHAOTIC_R : undefined));
    expect(ampLabel(t1, P1NET, "CRITICAL")).toBe("AMP-DEPENDENT");
  });
  it("final review F6, the complement of the case above: a reference that matches refClass under the other rung at T2 only (another class at T1) is AMP-DEPENDENT, not AMP-ROBUST", () => {
    const onlyT2 = gateJobs((c) => (c.key === "P2-net" && c.role === "G2" && c.T === REGIME.T1 ? CHAOTIC_R : undefined));
    expect(onlyT2.filter((j) => j.role === "G2" && j.T === REGIME.T2 && j.readings["P2-net"]!.jobClass === "CRITICAL")).toHaveLength(6); // the T2 jobs do read refClass
    expect(onlyT2.filter((j) => j.role === "G2" && j.T === REGIME.T1 && j.readings["P2-net"]!.jobClass === "CHAOTIC")).toHaveLength(6); // the T1 jobs do not
    expect(ampLabel(onlyT2, P1NET, "CRITICAL")).toBe("AMP-DEPENDENT");
    // one preset reads refClass at T1 and the other only at T2
    const mixed = gateJobs((c) => (c.key === "P2-net" && c.role === "G2" && c.T === REGIME.T1 && c.preset === "spots-m3" ? CHAOTIC_R : undefined));
    expect(ampLabel(mixed, P1NET, "CRITICAL")).toBe("AMP-DEPENDENT");
  });

  it("go/no-go (a), (b) and the trigger read every metered Stage 0 job, B0 included, and each rung's bank: a dust floor in the P2 bank of a B0 job fails the two P2 combinations only (W11, G2)", () => {
    const b0 = asB0(devJobs((c) => (c.key === "P2-net" && c.role === "G2" && c.preset === "spots-m3" && c.T === REGIME.T1 && c.seed === 9001 ? { uNetCoverage30: 0.0501 } : undefined)).filter(spotsT1));
    expect(b0).toHaveLength(3);
    const r = stage0([...devJobs(), ...b0], 1);
    expect(r.goNoGo.dustFloor).toEqual({ ok: false, jobs: ["B0-spots-m3-9001-t50000"], byRung: { P1: { ok: true, jobs: [] }, P2: { ok: false, jobs: ["B0-spots-m3-9001-t50000"] } } });
    expect(r.goNoGo.trigger.fired).toBe(true);
    expect(r.combos.map((x) => codes(x.causes))).toEqual([[], [], ["DUST-FLOOR", "DUST-THRESHOLD"], ["DUST-FLOOR", "DUST-THRESHOLD"]]);
    expect(r.combos.map((x) => x.satisfies)).toEqual([true, true, false, false]);
    expect(r.selected).toEqual(P1NET); // the P2 bank's floor is not (P1, net)'s own
    expect(r.combos[2].gate.pass).toBe(true); // the gate conditions of (P2, net) hold; the go/no-go of its bank does not
  });
  it("R14 row 103: (b) always reads the U twin's block-net count, whatever the decider; a trigger fired by (c) alone fails its rung's two combinations with DUST-THRESHOLD, on run 3 as on run 1 (G3)", () => {
    const med = (run: number, key: ComboKey = "P1-net") => stage0(gateJobs((c) => (c.key === key && c.role === "G2" && c.seed === 9001 && c.T === REGIME.T1 && c.preset === "spots-m3" ? { uMedianBlock30: 7, thetaB: 6 } : undefined), { dev: true }), run);
    for (const run of [1, 2, 3]) expect(med(run)).toMatchObject({ outcome: "STAGE0-PASS", selected: P2NET, goNoGo: { trigger: { fired: true } } });
    expect(med(1, "P2-net")).toMatchObject({ outcome: "STAGE0-PASS", selected: P1NET }); // the trigger of the P2 bank leaves (P1, net) alone
    // the trigger in both banks: no combination is left, and run 3 closes (nothing is re-derived to rescue it)
    const both = (run: number) => stage0(gateJobs((c) => ((c.key === "P1-net" || c.key === "P2-net") && c.role === "G2" && c.seed === 9001 && c.T === REGIME.T1 && c.preset === "spots-m3" ? { uMedianBlock30: 7, thetaB: 6 } : undefined), { dev: true }), run);
    expect(both(1)).toMatchObject({ outcome: "STAGE0-FAIL", selected: null });
    expect(both(1).combos.every((x) => codes(x.causes).join() === "DUST-THRESHOLD" && !x.satisfies)).toBe(true);
    expect(both(3).outcome).toBe("STAGE0-CLOSED");
    const occ = stage0(gateJobs((c) => (c.key === "P1-occ" && c.role === "G3" && c.seed === 9002 ? { uNetCoverage30: 0.06 } : undefined), { dev: true }), 1);
    expect(occ.goNoGo.dustFloor.ok).toBe(false); // the (P1, occ) reading's block-net coverage fails (b) for its rung, whichever decider the combination uses
    expect(occ.combos.map((x) => codes(x.causes).includes("DUST-FLOOR"))).toEqual([true, true, false, false]);
  });
});

describe("review fixes: edges of the definitions that no row pinned (CR-F06 to CR-F09, CR-F13)", () => {
  it("R4.1: B* counts the voxels with B = 1 (B >= 1, not B > 1 or B >= 2): the lower median of [1, 1, 5, 9] is 1", () => {
    const B = new Uint32Array(20);
    [0, 1, 1, 5, 9].forEach((v, i) => (B[3 + i] = v));
    expect(scaleOf(B)).toMatchObject({ Bstar: 1, k: 12, thetaB: 6, thetaV: 3 });
    const only1 = new Uint32Array(10).fill(1);
    expect(scaleOf(only1).Bstar).toBe(1);
    // and a voxel with B = 0 is not counted: [0, 0, 0, 7] has B* = 7
    const sparse = new Uint32Array(10);
    sparse[9] = 7;
    expect(scaleOf(sparse).Bstar).toBe(7);
  });
  it("R4.2: eligible means B >= k + 1: B = k is not, B = k + 1 is (k = 12 here)", () => {
    const B = new Uint32Array(20);
    [11, 12, 12, 13, 13, 14].forEach((v, i) => (B[2 + i] = v));
    const s = scaleOf(B);
    expect(s.Bstar).toBe(12);
    expect(s.k).toBe(12);
    expect(Array.from(s.E)).toEqual([5, 6, 7]); // the voxels holding 13, 13 and 14
    expect(s.NE).toBe(3);
  });
  it("R4.6: a P1 site needs B >= k + 1: B = k is refused, B = k + 1 is kicked by k", () => {
    const B = new Uint32Array(SLAB_GEOM.W * SLAB_GEOM.H * SLAB_GEOM.D);
    B[10] = 12;
    B[20] = 13;
    expect(() => kickPlanP1(B, [10], 12, SLAB_GEOM)).toThrow(/needs B >= k \+ 1 = 13/);
    const plan = kickPlanP1(B, [20], 12, SLAB_GEOM);
    expect(Array.from(plan.amounts)).toEqual([12]);
    expect(() => kickPlanP1(B, [20, 20], 12, SLAB_GEOM)).toThrow(/listed twice/);
  });
  it("R4.8: the unit kick is floor(k_v / 8) at least 1: amounts 16 and 24 become 2 and 3 (not floor(a / 9)), 15 and 7 become 1", () => {
    const B = new Uint32Array(SLAB_GEOM.W * SLAB_GEOM.H * SLAB_GEOM.D);
    const vs = [100, 20000, 40000, 60000, 80000].map((v, i) => v + i);
    [32, 48, 31, 14, 17].forEach((b, i) => (B[vs[i]] = b)); // P2 kicks floor(B / 2): 16, 24, 15, 7, 8
    const plan = kickPlanP2(B, vs, SLAB_GEOM);
    expect(Array.from(plan.amounts)).toEqual([16, 24, 15, 7, 8]);
    expect(Array.from(unitKickPlan(plan, SLAB_GEOM).amounts)).toEqual([2, 3, 1, 1, 1]);
    expect(unitKickPlan(plan, SLAB_GEOM).total).toBe(8);
  });

  it("R6.7: stD compares the two largest doses of the origin set with the pooled class, not the smallest: dose 4 reads CHAOTIC, 8 and 16 CRITICAL, stD stays true", () => {
    const dose = (m: number, per: number) => ({ m, n0: m, nDec: Array.from({ length: 301 }, () => per * m) });
    const der = derridaAnalysis([dose(4, 3), dose(8, 1), dose(16, 1)], { liveblkT: 300, liveT: 5000 });
    expect(der.topDoseClasses).toEqual(["CRITICAL", "CRITICAL"]);
    expect(der.sDec).toBeCloseTo(36 / 28, 12);
    expect(der.dClass).toBe("CRITICAL");
    expect(der.stD).toBe(true);
    // the other way round: the two largest disagree with the pooled class, the smallest agrees
    const der2 = derridaAnalysis([dose(4, 1), dose(8, 1), dose(16, 4)], { liveblkT: 300, liveT: 5000 });
    expect(der2.topDoseClasses).toEqual(["CRITICAL", "CHAOTIC"]);
    expect(der2.stD).toBe(false);
  });
  it("R6.7: with fewer than two dose classes read (the largest dose's log is too short for the window at TAU_DEC) stD is unknown, not true", () => {
    const full = { m: 8, n0: 8, nDec: Array.from({ length: 301 }, () => 8) };
    const short = { m: 16, n0: 16, nDec: Array.from({ length: 20 }, () => 16) };
    const der = derridaAnalysis([full, short], { liveblkT: 300, liveT: 5000 });
    expect(der.topDoseClasses).toHaveLength(1);
    expect(der.stD).toBeNull();
    expect(der.dClass).toBeNull();
  });

  it("R6.3 under rung P2: r = Nbar / n0_S with n0_S = n0 / m_S = 3 blocks per site; a bank whose damage is three times the P1 bank's in a ball of three blocks reads the same as the P1 bank", () => {
    const p1 = mkBank({ shape: "critical", withF: true });
    const p2 = mkBank({ shape: "critical", withF: true });
    const x3 = (log: DiffLog): DiffLog => ({ ...log, n_blk: log.n_blk.map((v) => 3 * v), n_occ: log.n_occ.map((v) => 3 * v) });
    p2.n0 = 36;
    p2.n0Site = new Array(12).fill(3);
    p2.doseS = 12 * 36;
    p2.S = { log: x3(p2.S!.log), sites: { ...p2.S!.sites, n_blk: p2.S!.sites.n_blk.map((r) => r.map((v) => 3 * v)), n_occ: p2.S!.sites.n_occ.map((r) => r.map((v) => 3 * v)) } };
    p2.U = { ...p2.U!, log: x3(p2.U!.log) };
    const a = analyzeBank(CORE, p1, "net"), b = analyzeBank(CORE, p2, "net");
    expect(b.gridR).toEqual(a.gridR);
    expect(b.gridR.every((v) => v === 1)).toBe(true);
    expect(b.sS).toEqual([1, 1, 1]);
    expect(b.stT).toBe(a.stT);
    expect(b).toMatchObject({ tClass: a.tClass, jobClass: a.jobClass, saturated: false });
    expect(b.ratioU).toBeCloseTo(a.ratioU!, 12); // the dust ratio is a ratio of two kinds of damage: unchanged by the scale
  });
  it("R7 bootstrap under P2 with unequal colonies and unequal kicked-block counts: n0_S is the mean of the drawn sites' counts in every resample", () => {
    // colony 0: one site with 1 kicked block; colony 1: three sites with 3 each. Every site holds r = 0.09 of its kicked blocks at all times:
    // r(1000) < ORD_R = 0.1 in every resample when n0_S is the drawn sites' mean (ORDERED, as at the point); with n0_S = 1 the colony of three reads 0.27.
    const n0Site = [1, 3, 3, 3];
    const steps = storedSteps();
    const series = { steps, nDec: n0Site.map((n) => steps.map(() => 0.09 * n)), reach: n0Site.map(() => steps.map((t) => (t < 100 ? (4 * t) / 100 : 4 + ((t - 100) * 8.5) / 900))) };
    const h0 = selectionSeed(101, REGIME.T0);
    const right = bootstrapStability({ pointClass: "ORDERED", saturated: false, series, colonies: [[0], [1, 2, 3]], n0Site, h0 }, REGIME);
    expect(right).toBe(1);
    const wrong = bootstrapStability({ pointClass: "ORDERED", saturated: false, series, colonies: [[0], [1, 2, 3]], n0Site: [1, 1, 1, 1], h0 }, REGIME);
    expect(wrong!).toBeLessThan(0.9); // a draw with the colony of three reads r(1000) = 0.27 and is not ORDERED
    // the colony order is the bootstrap's index order: swapping the colonies changes which colony a stream index selects
    const swapped = bootstrapStability({ pointClass: "ORDERED", saturated: false, series, colonies: [[1, 2, 3], [0]], n0Site: [1, 1, 1, 1], h0 }, REGIME);
    expect(swapped!).not.toBe(wrong!);
  });
  it("R7 bootstrap reads r(1000), not r(720): a series that is 0.1 to step 720 and 0.09 at 1000 is ORDERED by the r(1000) test in every resample", () => {
    const steps = storedSteps();
    const series = { steps, nDec: [0, 1, 2, 3].map(() => steps.map((t) => (t < 750 ? 0.1 : 0.09))), reach: [0, 1, 2, 3].map(() => steps.map((t) => (t < 100 ? (4 * t) / 100 : 4 + ((t - 100) * 8.5) / 900))) };
    const h0 = selectionSeed(102, REGIME.T0);
    expect(bootstrapStability({ pointClass: "ORDERED", saturated: false, series, colonies: [[0, 1], [2, 3]], n0Site: [1, 1, 1, 1], h0 }, REGIME)).toBe(1);
    expect(bootstrapStability({ pointClass: "CRITICAL", saturated: false, series, colonies: [[0, 1], [2, 3]], n0Site: [1, 1, 1, 1], h0 }, REGIME)).toBe(0);
  });

  it("R4.4: colonies equal an independent union-find over the right and down neighbours on 150 random wrapped masks (three grid shapes)", () => {
    const find = (p: Int32Array, x: number): number => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; };
    const reference = (mask: Uint8Array, g: Geom): { labels: Int32Array; count: number } => {
      const n = g.W * g.H;
      const p = Int32Array.from({ length: n }, (_, i) => i);
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const i = y * g.W + x;
        if (!mask[i]) continue;
        for (const j of [y * g.W + ((x + 1) % g.W), ((y + 1) % g.H) * g.W + x]) if (mask[j]) p[find(p, i)] = find(p, j);
      }
      const ids = new Map<number, number>();
      const labels = new Int32Array(n).fill(-1);
      for (let i = 0; i < n; i++) if (mask[i]) { const r = find(p, i); if (!ids.has(r)) ids.set(r, ids.size); labels[i] = ids.get(r)!; }
      return { labels, count: ids.size };
    };
    let seed = 12345;
    for (const g of [{ W: 16, H: 16, D: 1 }, { W: 32, H: 16, D: 1 }, { W: 24, H: 40, D: 1 }] as Geom[])
      for (let trial = 0; trial < 50; trial++) {
        const mask = new Uint8Array(g.W * g.H);
        const density = 0.25 + 0.4 * ((trial % 5) / 4);
        for (let i = 0; i < mask.length; i++) { seed = lowbias32((seed + i + 1) >>> 0); mask[i] = seed / 4294967296 < density ? 1 : 0; }
        const got = colonyLabels(mask, g);
        const want = reference(mask, g);
        expect(got.count).toBe(want.count);
        expect(Array.from(got.labels)).toEqual(Array.from(want.labels));
      }
  });
  it("R4.4: an L-shape and a ring that crosses both wraps are one colony each; a diagonal pair is two", () => {
    const g: Geom = { W: 16, H: 16, D: 1 };
    const mk = (cells: [number, number][]) => { const m = new Uint8Array(256); for (const [x, y] of cells) m[y * 16 + x] = 1; return m; };
    expect(colonyLabels(mk([[3, 3], [4, 3], [5, 3], [5, 4], [5, 5]]), g).count).toBe(1); // an L
    const ring: [number, number][] = [];
    for (let k = 0; k < 16; k++) ring.push([k, 15], [k, 0], [15, k], [0, k]); // the frame around the seam: both wraps
    expect(colonyLabels(mk(ring), g).count).toBe(1);
    expect(colonyLabels(mk([[3, 3], [4, 4]]), g).count).toBe(2);
    expect(colonyLabels(mk([[0, 0], [15, 15]]), g).count).toBe(2); // diagonal across both seams
    expect(colonyLabels(mk([[0, 7], [15, 7]]), g).count).toBe(1); // neighbours across the x seam
    expect(colonyLabels(mk([[7, 0], [7, 15]]), g).count).toBe(1); // neighbours across the y seam
  });

  it("R5 C5: any one of n_live, L1_A, L1_P differing before step 1 fails, and a block whose kicks sum to exactly thetaB is counted", () => {
    const plan = kickPlanP1(new Uint32Array(SLAB_GEOM.W * SLAB_GEOM.H * SLAB_GEOM.D).fill(50), [10, 3000], 6, SLAB_GEOM);
    expect(Array.from(plan.blockSums)).toEqual([6, 6]);
    const row0 = { n_blk: 2, n_occ: 0, L1c: 12, n_live: 0, L1_A: 0, L1_P: 0, L1_B: 12, L1_C: 12 } as unknown as DiffRow;
    expect(checkC5({ row0, plan, thetaB: 6, rung: "P1" }).ok).toBe(true); // sum 6 = thetaB: counted
    expect(checkC5({ row0: { ...row0, n_blk: 0 }, plan, thetaB: 6, rung: "P1" }).ok).toBe(false);
    for (const k of ["n_live", "L1_A", "L1_P"] as const) expect(checkC5({ row0: { ...row0, [k]: 1 }, plan, thetaB: 6, rung: "P1" }).ok, k).toBe(false);
    expect(checkC5({ row0: { ...row0, L1_C: 11 }, plan, thetaB: 6, rung: "P1" }).ok).toBe(false);
    expect(checkC5({ row0, plan, thetaB: 7, rung: "P1" }).ok).toBe(false); // thetaB 7: no block counts, n_blk would have to be 0
    expect(checkC5({ row0: { ...row0, n_blk: 0 }, plan, thetaB: 7, rung: "P1" }).ok).toBe(true);
    expect(checkC5({ row0: { ...row0, n_occ: 3 }, plan, thetaB: 6, rung: "P2" }).ok).toBe(true); // n_occ is constrained under P1 only
  });
  it("R5 C4: the extension and the development seeds are not compared; 101, 102 and 103 are; the TSV tolerance is 0.00005", () => {
    const s = { kind: "slab" as const, seed: 101, dev: false, changedUnvariedKey: false };
    for (const seed of [101, 102, 103]) expect(c4Applicable({ ...s, seed }), String(seed)).toBe(true);
    for (const seed of [1, 100, 104, 105, 106, 9001]) expect(c4Applicable({ ...s, seed }), String(seed)).toBe(false);
    const tsv = (v: number) => checkC4({ subject: s, mode: "tsv-rounded", cells: 524288, living5k: [1000], m4Tsv5k: [v] }).ok; // 1000 / 524288 = 0.0019073
    expect(tsv(0.0019)).toBe(true);
    expect(tsv(0.00191)).toBe(true);
    expect(tsv(0.00186)).toBe(true); // 0.000047 below 1000 / 524288 = 0.0019073: within 0.00005 (a 2 percent tolerance would refuse it)
    expect(tsv(0.00185)).toBe(false); // 0.000057 below
    expect(tsv(0.0020)).toBe(false);
  });
  it("R6.3 boundaries: r exactly R_AMP with the coverage is saturated and not a footprint; r1000 exactly ORD_R is not -2 on the map", () => {
    expect(isSaturated(0.05, 2)).toBe(true);
    expect(isFootprint(0.05, 2)).toBe(false);
    expect(isFootprint(0.05, 1.999)).toBe(true);
    expect(mapExponent({ saturated: false, r1000: 0.1, b: 0.3 })).toBe(0.3);
    expect(mapExponent({ saturated: false, r1000: 0.0999, b: 0.3 })).toBe(-2);
    expect(mapExponent({ saturated: false, r1000: 0.5, b: 3 })).toBe(2);
    expect(mapExponent({ saturated: false, r1000: 0.5, b: -5 })).toBe(-2);
    expect(mapExponent({ saturated: true, r1000: 0.001, b: null })).toBe(2);
  });
  it("G7 reads the N twin's coverage at step 100 as the window mean of steps 95 to 105, not 99 or 101", () => {
    const bank = mkBank({ withN: false });
    bank.N = { log: mkLog(301, { n_blk: (t) => t, n_occ: (t) => t }, 1000) };
    expect(analyzeBank(CORE, bank, "net").nSat100).toBeCloseTo(0.1, 12);
    const spike = mkBank({ withN: false });
    spike.N = { log: mkLog(301, { n_blk: (t) => (t === 105 ? 1100 : 0), n_occ: (t) => (t === 105 ? 1100 : 0) }, 1000) };
    expect(analyzeBank(CORE, spike, "net").nSat100).toBeCloseTo(1.1 / 11, 12); // step 105 is inside the window
    spike.N = { log: mkLog(301, { n_blk: (t) => (t === 106 ? 1100 : 0), n_occ: (t) => (t === 106 ? 1100 : 0) }, 1000) };
    expect(analyzeBank(CORE, spike, "net").nSat100).toBe(0);
  });
  it("R10: a pool of exactly 8 class-bearing settings that all read refClass is NO-CONTRAST (8 of 8); 7 of 7 is not", () => {
    const crit = ["CRITICAL", "CRITICAL", "CRITICAL"] as JobSpec[];
    expect(outcome(table(fillWith(BEARING8, crit)))).toMatchObject({ id: "NO-CONTRAST", n: 8, of: 8 });
    expect(outcome(table(fillWith(BEARING8.slice(0, 7), crit))).id).toBe("PENDING-LATE-CHECK");
  });
  it("R11: target settings are late-checked in the order B0, then fewer changed axes, then the id ascending, whatever the order they arrive in", () => {
    const mk = (id: string) => rowOf(id, mkJobs(id, ["CRITICAL", "CRITICAL", "CRITICAL"]));
    const ids = ["mu30-s8-k256-dC240", "mu40-s8-k256", "mu30-s8-k256-dA100", B0_ID, "mu20-s8-k256", "mu30-s12-k256", "mu40-s12-k256"];
    expect(lateOrder(ids.map(mk)).map((r) => r.id)).toEqual([B0_ID, "mu20-s8-k256", "mu30-s12-k256", "mu30-s8-k256-dA100", "mu30-s8-k256-dC240", "mu40-s8-k256", "mu40-s12-k256"]);
    expect(lateOrder([...ids].reverse().map(mk)).map((r) => r.id)).toEqual(lateOrder(ids.map(mk)).map((r) => r.id));
  });
  it("R2.3: every tested value of every axis appears in the catalogue, and every catalogue setting sits on its axes' lists (AXIS_LISTS is the bracket's list)", () => {
    for (const a of AXES) {
      const used = new Set(SPECS.map((s) => s.params[a]));
      expect([...AXIS_LISTS[a]].sort((x, y) => x - y)).toEqual([...used].sort((x, y) => x - y));
      expect([...AXIS_LISTS[a]]).toEqual([...AXIS_LISTS[a]].sort((x, y) => x - y)); // ascending: adjacency is list order
    }
    for (const s of SPECS) for (const a of AXES) expect(AXIS_LISTS[a], `${s.id} ${a}`).toContain(s.params[a]);
  });
  it("R0 arithmetic: window means are Neumaier sums in step order; a window whose exact mean coverage is 0.05 can sit one ulp under SAT and then is not saturated (W23)", () => {
    // 9 steps of 51, then 32 and 59, of 1,000 living blocks: the exact mean of the ratios is 550 / 11000 = 0.05
    const nDec = new Array(1001).fill(0);
    [51, 51, 51, 51, 51, 51, 51, 51, 51, 32, 59].forEach((v, i) => (nDec[95 + i] = v));
    const s = trajectorySeries({ mS: 16, n0: 16, nDec, liveblk: new Array(1001).fill(1000) });
    expect(s.r[0]).toBeCloseTo(50 / 16, 12);
    expect(s.satFrac[0]).toBe(0.049999999999999996);
    expect(s.saturatedAt[0]).toBe(false);
    expect(s.footprint).toBe(false); // below SAT by the rounding: not even a footprint
    // a constant window is its constant exactly: 50 of 1,000 at every step is 0.05 and is saturated at r >= 2
    const flat = trajectorySeries({ mS: 16, n0: 16, nDec: new Array(1001).fill(50), liveblk: new Array(1001).fill(1000) });
    expect(flat.satFrac[0]).toBe(0.05);
    expect(flat.saturatedAt[0]).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The answers of the main session, 2026-10-24 (G1 to G4): the 2D references at T1 and T2, the dust floor per rung, no derived threshold, NO-RANKING

describe("answers of 2026-10-24, G1: the 2D reference worlds are read at T1 and T2 only (R1, R9)", () => {
  const PRESETS3 = SEEDS.main;
  /** 2D jobs at T0 (20,000 steps) for both presets and seeds 101 to 103, with a reading under every combination: what a gate would fail on if it read them. */
  const strayT0 = (over: Partial<JobReading>, flag: "IN_WINDOW" | "CARPET" = "IN_WINDOW"): JobSummary[] =>
    PRESETS.flatMap((preset) =>
      PRESETS3.map((seed) => {
        const readings: Partial<Record<ComboKey, JobReading>> = {};
        for (const key of ALL_KEYS) readings[key] = reading({ rung: key.slice(0, 2) as Rung, decider: key.slice(3) as "net" | "occ", ...over });
        return sj({ id: `G2-${preset}-${seed}-t${REGIME.T0}`, role: "G2", kind: "2d", world: preset, seed, T: REGIME.T0, flag, readings });
      }),
    );
  const ORDERED_CLEAR: Partial<JobReading> = { jobClass: "ORDERED", tClass: "ORDERED", dClass: "ORDERED", s30: 0.2, dust: "CLEAR", vote: true };

  it("R14 row 104: 2D jobs at T0 beside the T1 and T2 jobs are not read: G2, G6 and the amplitude label ignore them, whatever they read", () => {
    const base = gateJobs();
    // the stray jobs would matter if they were read: ORDERED votes make a class, a CARPET flag leaves a group with no vote, LIMITED dust fails G6
    const ordered = strayT0(ORDERED_CLEAR);
    expect(groupClass(ordered.filter((j) => j.world === "spots-m3"), P1NET, "window")).toBe("ORDERED");
    expect(groupClass(strayT0(ORDERED_CLEAR, "CARPET").filter((j) => j.world === "spots-m3"), P1NET, "window")).toBeNull();
    const g2 = evaluateGate([...base, ...ordered], P1NET, GATE_OK);
    expect(g2.g2.classes).toEqual(evaluateGate(base, P1NET, GATE_OK).g2.classes);
    expect(Object.keys(g2.g2.classes).every((k) => !k.endsWith("@20000"))).toBe(true);
    expect(g2).toMatchObject({ pass: true, refClass: "CRITICAL" });
    // the rehearsal's transient: spots-m3 is a carpet at 20,000 steps (0.981 living) and alive later; read at T0 it would be REF-UNDEFINED there
    const carpetT0 = strayT0({ jobClass: "CHAOTIC", tClass: "CHAOTIC", dClass: "CHAOTIC", s30: 4 }, "CARPET");
    expect(evaluateGate([...base, ...carpetT0], P1NET, GATE_OK).pass).toBe(true);
    expect(codes(evaluateGate([...base, ...carpetT0], P1NET, GATE_OK).causes)).toEqual([]);
    // G6 counts T1 and T2 only
    const limited = strayT0({ dust: "LIMITED", vote: false });
    expect(evaluateG6([...base, ...limited], P1NET)).toEqual({ holds: true, causes: [] });
    expect(evaluateG6([...base, ...limited], P1NET)).toEqual(evaluateG6(base, P1NET));
    // G8 reads T1: a T0 job reading another class under the other rung changes nothing
    const other = strayT0({ ...ORDERED_CLEAR, jobClass: "CHAOTIC", tClass: "CHAOTIC", dClass: "CHAOTIC", s30: 4 });
    expect(ampLabel([...base, ...other], P1NET, "CRITICAL")).toBe("AMP-ROBUST");
  });

  it("R14 row 105: a verdict needs the 2D jobs at T1 and at T2 (the roster lists no 2D job at T0): a missing T2 job is named, T0 jobs do not make up for it", () => {
    const base = gateJobs();
    const lost = base.filter((j) => !(j.world === "spots-m3" && j.T === REGIME.T2 && j.seed === 101));
    expect(gateRosterGaps(lost, "gate").map(rosterLabel)).toEqual(["G2 spots-m3 seed 101 T 100000"]);
    const g = evaluateGate([...lost, ...strayT0({})], P1NET, GATE_OK);
    expect(g.pass).toBe(false);
    expect(g.causes.find((x) => x.code === "INCOMPLETE")!.where).toEqual(["G2 spots-m3 seed 101 T 100000"]);
    // 2D jobs at T0 only: all twelve reads are missing
    const t0Only = [...base.filter((j) => j.role !== "G2"), ...strayT0({})];
    expect(gateRosterGaps(t0Only, "gate")).toHaveLength(12);
    expect(gateRosterGaps(t0Only, "gate").every((j) => j.T === REGIME.T1 || j.T === REGIME.T2)).toBe(true);
    // the Stage 0 roster too: G2 and G3 (the B0 jobs are informational and are the reader's business)
    expect(gateRosterGaps(gateJobs(undefined, { dev: true }), "dev")).toEqual([]);
    expect(expectedRoster("dev").filter((j) => j.role === "G2" || j.role === "G3")).toHaveLength(15);
  });

  it("refTimes is T1 and T2, follows the constants it is given, and leaves the slab at T0", () => {
    expect([...refTimes()]).toEqual([50000, 100000]);
    expect([...refTimes({ ...REGIME, T1: 30000, T2: 60000 })]).toEqual([30000, 60000]);
    expect(expectedRoster("gate", { ...REGIME, T1: 30000, T2: 60000 }).filter((j) => j.kind === "2d").every((j) => j.T === 30000 || j.T === 60000)).toBe(true);
    expect(expectedRoster("gate").filter((j) => j.kind === "slab").every((j) => j.T === REGIME.T0)).toBe(true);
    // the slab follows T0 as the 2D references follow T1 and T2 (a roster that hard-coded 20,000 would pass the line above and fail this one)
    const moved = expectedRoster("gate", { ...REGIME, T0: 30000 });
    expect(moved.filter((j) => j.kind === "slab")).toHaveLength(8);
    expect(moved.filter((j) => j.kind === "slab").every((j) => j.T === 30000)).toBe(true);
    expect(expectedRoster("dev", { ...REGIME, T0: 30000 }).filter((j) => j.kind === "slab").every((j) => j.T === 30000)).toBe(true);
  });
});

describe("answers of 2026-10-24, G2 and G3: the dust floor is per rung and thetaB is never re-derived", () => {
  const stage = (f?: (c: GateCtx) => Partial<JobReading> | undefined, run = 1) => stage0(gateJobs(f, { dev: true }), run);
  const floorIn = (keys: ComboKey[]) => (c: GateCtx) => (c.role === "G3" && c.seed === 9002 && keys.includes(c.key) ? { uNetCoverage30: 0.0501 } : undefined);
  const medianIn = (keys: ComboKey[]) => (c: GateCtx) => (keys.includes(c.key) && c.role === "G2" && c.seed === 9001 && c.T === REGIME.T1 && c.preset === "spots-m3" ? { uMedianBlock30: 7, thetaB: 6 } : undefined);

  it("R14 row 107: the U twin of the P1 bank covering 5.01 percent of the living blocks, the P2 bank clean: the two P1 combinations fail with DUST-FLOOR and DUST-THRESHOLD, (P2, net) is selected; both banks over the line fail all four", () => {
    const r = stage(floorIn(["P1-net"]));
    expect(r.combos.map((x) => codes(x.causes))).toEqual([["DUST-FLOOR", "DUST-THRESHOLD"], ["DUST-FLOOR", "DUST-THRESHOLD"], [], []]);
    expect(r).toMatchObject({ outcome: "STAGE0-PASS", selected: P2NET });
    const both = stage(floorIn(["P1-net", "P2-net"]));
    expect(both).toMatchObject({ outcome: "STAGE0-FAIL", selected: null });
    expect(both.combos.every((x) => codes(x.causes).join() === "DUST-FLOOR,DUST-THRESHOLD" && !x.satisfies)).toBe(true);
    expect(stage(floorIn(["P1-net", "P2-net"]), 3).outcome).toBe("STAGE0-CLOSED");
  });

  it("R14 row 108: a median |dB_blk| of 7 against thetaB 6 in both banks (go/no-go c alone): every combination fails with DUST-THRESHOLD only, STAGE0-FAIL on run 1 and STAGE0-CLOSED on run 3; nothing is re-derived", () => {
    const both = (run: number) => stage(medianIn(["P1-net", "P2-net"]), run);
    expect(both(1)).toMatchObject({ outcome: "STAGE0-FAIL", selected: null });
    expect(both(1).combos.map((x) => codes(x.causes))).toEqual(new Array(4).fill(["DUST-THRESHOLD"]));
    expect(both(2).outcome).toBe("STAGE0-FAIL");
    expect(both(3).outcome).toBe("STAGE0-CLOSED");
    // (c) alone leaves the dust floor holding: the cause is the trigger's, the floor's is not raised
    expect(both(1).goNoGo.dustFloor).toEqual({ ok: true, jobs: [], byRung: { P1: { ok: true, jobs: [] }, P2: { ok: true, jobs: [] } } });
    // nothing carries a threshold other than the banks' own: the result has no field for a derived thetaB
    expect(Object.keys(both(1))).toEqual(["run", "outcome", "selected", "combos", "goNoGo"]);
    expect(Object.keys(both(1).goNoGo)).toEqual(["zExact", "dustFloor", "medianBlock", "trigger", "uEvidence"]); // uEvidence records where the U twin was read (final review F2); it carries no threshold
    expect(both(1).goNoGo.medianBlock.every((m) => m.thetaB === 6)).toBe(true);
    // R4.1 stays: thetaB = ceil(k / 2), whatever Stage 0 saw
    expect(scaleFromBstar(30)).toMatchObject({ k: 15, thetaB: 8 });
  });

  it("the Z twin (go/no-go a) is global, the dust floor and the trigger are the rung's: a Z failure fails four combinations, a floor in the P2 bank fails two", () => {
    const z = stage0(gateJobs(undefined, { dev: true }).map((j) => (j.id === "G2-spots-m3-9001-t50000" ? { ...j, invalid: true, invalidChecks: ["C1" as const] } : j)), 1);
    expect(z.combos.every((x) => codes(x.causes).includes("Z-NOT-ZERO"))).toBe(true);
    const floor = stage(floorIn(["P2-occ"]));
    expect(floor.combos.map((x) => codes(x.causes).includes("DUST-FLOOR"))).toEqual([false, false, true, true]);
    expect(floor.combos.map((x) => codes(x.causes).includes("Z-NOT-ZERO"))).toEqual([false, false, false, false]);
    expect(floor.selected).toEqual(P1NET);
  });

  it("the margin condition, the gate conditions and the rung's go/no-go are separate: a rung whose bank fails go/no-go is skipped in the selection order, not reordered", () => {
    // (P1, net) fails by its bank's trigger, (P1, occ) too; (P2, net) passes and is the first in order that does
    const r = stage(medianIn(["P1-net"]));
    expect(r.combos.map((x) => x.satisfies)).toEqual([false, false, true, true]);
    expect(r.selected).toEqual(P2NET);
    // the gate conditions of the failed rung hold: only the bank's own go/no-go removed it
    expect(r.combos[0].gate.pass).toBe(true);
    expect(r.combos[1].gate.pass).toBe(true);
  });
});

describe("answers of 2026-10-24, G4: every Delta NA is NO-RANKING, not NO-AXIS (R12.2, R12.4)", () => {
  /** Class-bearing settings that are no ranking candidate: two or more axes from B0, or one axis but not next to B0's value in the tested list. */
  const NONE = ["mu20-s12-k256", "mu40-s12-k256", "mu20-s16-k256", "mu40-s16-k256", "mu30-s16-k256", "mu30-s20-k256", "mu30-s8-k4096"];
  const ORD3: JobSpec[] = ["ORDERED", "ORDERED", "ORDERED"];

  it("R14 row 110: B0 qualifies but no swept axis has a class-bearing candidate next to B0's value: NO-RANKING with reason NO-CANDIDATE, and NO-BAND carries it", () => {
    expect(AXES.flatMap((a) => axisCandidateIds(a)).some((id) => NONE.includes(id))).toBe(false); // none of them is a candidate of any axis
    const rows = table(fillWith([B0_ID, ...NONE], ORD3));
    const rk = rankAxes(rows, "CRITICAL");
    expect(rk).toMatchObject({ kind: "NO-RANKING", reason: "NO-CANDIDATE", top: null });
    expect(rk.dB0).not.toBeNull(); // B0 qualified: d(B0) and NOISE are defined
    expect(rk.noise).not.toBeNull();
    expect(rk.rows).toHaveLength(AXES.length);
    expect(rk.rows.every((r) => r.delta === null && r.best === null && r.direction === null && r.candidates.length === 0)).toBe(true);
    const o = outcome(rows);
    expect(o).toMatchObject({ id: "NO-BAND", label: "all-ordered", inference: true });
    expect((o as { ranking: { kind: string; reason: string } }).ranking).toMatchObject({ kind: "NO-RANKING", reason: "NO-CANDIDATE" });
    // one candidate present: its Delta is defined, so this is a ranking (here NO-AXIS: ORDERED neighbours are no closer to CRITICAL than B0)
    const one = rankAxes(table(fillWith([B0_ID, ...NONE, "mu40-s8-k256"], ORD3)), "CRITICAL");
    expect(one.kind).toBe("NO-AXIS");
    expect(one.reason).toBeNull();
    expect(one.rows.filter((r) => r.delta !== null).map((r) => r.axis)).toEqual(["mu"]);
    // an INERT candidate is no candidate (R12.3): the only gateK setting next to B0 is excluded, so every Delta is NA again
    const gk = table(fillWith([B0_ID, "mu30-s8-k256-gK16"], ORD3));
    expect(rankAxes(gk, "CRITICAL").kind).not.toBe("NO-RANKING");
    expect(rankAxes(gk, "CRITICAL", new Set(["mu30-s8-k256-gK16"]))).toMatchObject({ kind: "NO-RANKING", reason: "NO-CANDIDATE" });
  });

  it("NO-RANKING keeps two readings: B0 not qualifying (reason B0, no rows) and B0 qualifying with nothing to compare (reason NO-CANDIDATE, a row per axis)", () => {
    const b0Split = table({ ...fillWith(NONE, ORD3), [B0_ID]: ["ORDERED", "CHAOTIC", "MIXED"] });
    expect(rankAxes(b0Split, "CRITICAL")).toMatchObject({ kind: "NO-RANKING", reason: "B0", rows: [], dB0: null, noise: null });
    const b0One = table({ ...fillWith(NONE, ORD3), [B0_ID]: [{ r: { jobClass: "ORDERED", tClass: "ORDERED", s30: 0.2 } }, "EXTINCT", "CARPET"] });
    expect(rankAxes(b0One, "CRITICAL").reason).toBe("B0"); // one valid job: INSUFFICIENT, B0 is not in the pool and cannot anchor a ranking
    expect(rankAxes(table(fillWith([B0_ID], ORD3)), "CHAOTIC")).toMatchObject({ kind: "NO-RANKING", reason: "NO-CANDIDATE" });
    // a ranked or NO-AXIS result has no reason
    const withS = (id: string, ell: number): [string, JobSpec[]] => [id, [0, 1, 2].map(() => ({ r: { jobClass: "ORDERED", tClass: "ORDERED", s30: Math.exp(ell) } }) as JobSpec)];
    const ranked = table({ ...fillWith(BEARING8, ORD3), ...Object.fromEntries([withS(B0_ID, -1), withS("mu40-s8-k256", -0.2)]) });
    expect(rankAxes(ranked, "CHAOTIC")).toMatchObject({ kind: "RANKED", reason: null });
  });
});

describe("final review of 2026-10-24, F1 and F2: a Stage 0 PASS is final, and a missing U twin is neither a pass nor a failure of the dust floor", () => {
  const stage = (f?: (c: GateCtx) => Partial<JobReading> | undefined, run = 1, extra: JobSummary[] = []) => stage0([...gateJobs(f, { dev: true }), ...extra], run);
  const asB0 = (jobs: JobSummary[]) => jobs.map((j) => ({ ...j, role: "B0" as const, id: j.id.replace("G2", "B0") }));
  const spotsT1 = (j: JobSummary) => j.role === "G2" && j.world === "spots-m3" && j.T === REGIME.T1;
  /** A median block difference of 7 against thetaB 6 in the P1 bank of one G2 job: the threshold trigger fires in the P1 bank (go/no-go c alone). */
  const p1Trigger = (c: GateCtx) => (c.key.startsWith("P1") && c.role === "G2" && c.seed === 9001 && c.T === REGIME.T1 && c.preset === "spots-m3" ? { uMedianBlock30: 7, thetaB: 6 } : undefined);

  it("R14 row 111: the trigger fired in the P1 bank beside a satisfying (P2, net): STAGE0-PASS with (P2, net) on run 1, 2 and 3 alike (stage0 keeps no state: the run number only decides FAIL against CLOSED)", () => {
    for (const run of [1, 2, 3]) {
      const r = stage(p1Trigger, run);
      expect(r, `run ${run}`).toMatchObject({ outcome: "STAGE0-PASS", selected: P2NET });
      expect(r.goNoGo.trigger.fired).toBe(true);
      expect(r.goNoGo.trigger.byRung.P1.fired).toBe(true);
      expect(r.goNoGo.trigger.byRung.P2).toEqual({ fired: false, jobs: [] });
      expect(r.combos.map((x) => codes(x.causes))).toEqual([["DUST-THRESHOLD"], ["DUST-THRESHOLD"], [], []]);
    }
    // the run number is what separates FAIL from CLOSED when nothing satisfies
    const none = (run: number) => stage((c) => (c.role === "G2" ? { jobClass: "ORDERED", tClass: "ORDERED", dClass: "ORDERED", s30: 0.2 } : undefined), run);
    expect([1, 2, 3].map((run) => none(run).outcome)).toEqual(["STAGE0-FAIL", "STAGE0-FAIL", "STAGE0-CLOSED"]);
  });

  it("R14 row 112: a metered job with no U twin in a rung's bank (a FEW_SITES B0 job: no S sites, so no U twin) contributes nothing to (b), (c) or the trigger; uEvidence names it and the Stage 0 outcome does not depend on it", () => {
    const noU: Partial<JobReading> = { fewSites: true, tClass: "NA", uNetCoverage30: null, uMedianBlock30: null, dust: "UNAVAILABLE", ratioU: null, NbarU: null, doseU: null, vote: false };
    const base = gateJobs(undefined, { dev: true });
    const b0 = asB0(gateJobs((c) => (c.role === "G2" && c.preset === "spots-m3" && c.T === REGIME.T1 ? noU : undefined), { dev: true }).filter(spotsT1));
    expect(b0).toHaveLength(3);
    const r = stage0([...base, ...b0], 1);
    expect(r.outcome).toBe("STAGE0-PASS");
    expect(r.selected).toEqual(P1NET);
    expect(r.goNoGo.dustFloor).toEqual({ ok: true, jobs: [], byRung: { P1: { ok: true, jobs: [] }, P2: { ok: true, jobs: [] } } });
    expect(r.goNoGo.trigger.fired).toBe(false);
    const absent = ["B0-spots-m3-9001-t50000", "B0-spots-m3-9002-t50000", "B0-spots-m3-9003-t50000"];
    expect(r.goNoGo.uEvidence).toEqual({ P1: { metered: 18, assessed: 15, absent }, P2: { metered: 18, assessed: 15, absent } });
    // the same set without the B0 jobs has nothing absent: the 15 gate-world jobs, both banks
    expect(stage0(base, 1).goNoGo.uEvidence).toEqual({ P1: { metered: 15, assessed: 15, absent: [] }, P2: { metered: 15, assessed: 15, absent: [] } });
    // a missing U twin in one rung's bank only is that bank's
    const p2only = asB0(gateJobs((c) => (c.role === "G2" && c.preset === "spots-m3" && c.T === REGIME.T1 && c.key.startsWith("P2") ? noU : undefined), { dev: true }).filter(spotsT1));
    expect(stage0([...base, ...p2only], 1).goNoGo.uEvidence).toEqual({ P1: { metered: 18, assessed: 18, absent: [] }, P2: { metered: 18, assessed: 15, absent } });
  });

  it("R14 row 113: a U log with no block of nonzero difference has coverage 0 and no median (NA): (b) passes and (c) does not fire; a present U log is read by (b) even when its dose makes the dust state UNAVAILABLE", () => {
    const zero = stage((c) => (c.role === "G3" ? { uNetCoverage30: 0, uMedianBlock30: null } : undefined));
    expect(zero).toMatchObject({ outcome: "STAGE0-PASS", selected: P1NET });
    expect(zero.goNoGo.trigger.fired).toBe(false);
    expect(zero.goNoGo.medianBlock.some((m) => m.job.startsWith("G3"))).toBe(false); // no median to compare
    expect(zero.goNoGo.medianBlock).toHaveLength(24); // the 12 G2 jobs, both banks
    expect(zero.goNoGo.uEvidence.P1).toMatchObject({ metered: 15, assessed: 15, absent: [] }); // a measured zero is evidence, not a gap
    // the U twin's dose is over U_MAX of S's (dust UNAVAILABLE) but its log exists and covers 5.01 percent: the dust floor fails in that bank
    const over = stage((c) => (c.role === "G3" && c.seed === 9002 && c.key.startsWith("P1") ? { dust: "UNAVAILABLE", vote: false, ratioU: null, uNetCoverage30: 0.0501 } : undefined));
    expect(over.goNoGo.dustFloor.byRung).toEqual({ P1: { ok: false, jobs: ["G3-mu60-s8-k1024-9002-t20000"] }, P2: { ok: true, jobs: [] } });
    expect(over.combos.map((x) => codes(x.causes))).toEqual([["DUST-FLOOR", "DUST-THRESHOLD"], ["DUST-FLOOR", "DUST-THRESHOLD"], [], []]);
    expect(over).toMatchObject({ outcome: "STAGE0-PASS", selected: P2NET });
  });
});
