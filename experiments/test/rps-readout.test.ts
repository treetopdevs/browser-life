import { describe, expect, it } from "vitest";
import { chirality, correlationLength, encodeRpsFinal, rpsCoexist, rpsIsPresent, rpsLabels } from "@bl/metrics";
import {
  analyzeMutation,
  analyzeRun,
  burnGroupKey,
  canonicalStage,
  fisherOneSided,
  isNoStart,
  jobBugs,
  medianLower,
  medianMean,
  normalizeSummary,
  Problems,
  ReadoutError,
  type Arm,
  type Job,
  type RunAnalysis,
} from "../3d-rps/readout-jobs.ts";
import {
  calibrationJobs,
  CANDIDATE_SPREADS,
  CARPETS_3,
  CARPETS_5,
  denseJob,
  DLAB_3,
  DLAB_5,
  filesOf,
  five,
  G_3,
  G_5,
  latticeCells,
  logisticP,
  meterJob,
  mkJob,
  mkRecord,
  mutationJobs,
  OP,
  rawJob,
  rowsOf,
  rungJobs,
  STEEP,
  sweepJobs,
  TEND,
  vJobs,
  type ClassSpec,
  type FixtureJob,
  type MkJobOpts,
  type MutKind,
  type RowSpec,
  type RungScenario,
  type VScenario,
} from "./rps-fixtures.ts";
import {
  addOneSE,
  analyzePair,
  evaluateLattice,
  LAT_CONTINGENCY_M,
  LAT_M,
  latticeRow,
  parseLatticeCell,
  type LatticeCell,
} from "../3d-rps/readout-lattice.ts";
import {
  evaluateGate0,
  evaluateMeter,
  gridRule,
  horizonOf,
  meterPoint,
  mixingIndex,
  rCalOf,
  scheduleOf,
  vCheckOf,
  verdictRow,
  type Gate0Result,
  type RungEval,
} from "../3d-rps/readout-gate0.ts";
import {
  edgePairs,
  evaluateCalibration,
  evaluateCycles,
  evaluateDeepPrecondition,
  evaluateSweep,
  spreadStar,
  spreadStats,
  sweepOutcome,
  type SweepSpread,
} from "../3d-rps/readout-kernel.ts";
import { ARMS, armMutRate, armVerdict, countClasses, evaluateMutation, horizonVoid, mutRateOk, predictions, type ArmCounts } from "../3d-rps/readout-mutation.ts";
import { createHash } from "node:crypto";
import { CH as CCH, G as GCH } from "@bl/schema";
import { checkFrozen, loadJobs, memIo, operatingPointDiffs, parseArgs, parseFrozen, parseOperatingPoint, run, type Io } from "../3d-rps/readout.ts";
// Every test name starts with the id of the rule row it covers, so `vitest run --reporter=verbose` is the row-to-test map.

const job = (cls: ClassSpec, o: Partial<MkJobOpts> = {}) => mkJob({ stage: "g0.table", seed: 401, spread: 16, rate: 32, cls, ...o });
const analyze = (cls: ClassSpec, o: Partial<MkJobOpts> = {}, expectedRun: number | null = null): RunAnalysis => analyzeRun(job(cls, o), { expectedRun });

describe("rule 0, run classes (the first row that holds)", () => {
  it("0 row NOSTART: liv below 0.50 at the last burn-in census", () => {
    const a = analyze({ NOSTART: "liv" });
    expect(a.cls).toBe("NOSTART");
    expect(a.tcx).toBeNull();
  });
  it("0 row NOSTART: coexist false at the last burn-in census", () => {
    expect(analyze({ NOSTART: "coexist" }).cls).toBe("NOSTART");
  });
  it("0 row NOSTART: liv below 0.01 at any burn-in census, even the first ones", () => {
    expect(analyze({ NOSTART: "early" }).cls).toBe("NOSTART");
    expect(analyze("NOSTART").cls).toBe("NOSTART");
  });
  it("0 NOSTART boundary: liv exactly 0.50 at the last burn-in census starts", () => {
    const rows = rowsOf("DC", 20);
    rows.burn[5] = { ...rows.burn[5], liv: 0.5 };
    expect(analyzeRun(job("DC", { rows }), {}).cls).toBe("DC");
  });
  it("0/1.5 NOSTART is one function, isNoStart, which the kernel-job harness stops a job by (decision O-5): its boundaries", () => {
    const at = (liv: number[], coexist: boolean[] = liv.map(() => true)) => isNoStart(liv.map((l, i) => ({ liv: l, coexist: coexist[i] })));
    const ok = [0.7, 0.8, 0.8, 0.8, 0.8, 0.8];
    expect(at(ok)).toBe(false);
    // the last census: liv 0.50 starts, just below does not; a label missing does not
    expect(at([...ok.slice(0, 5), 0.5])).toBe(false);
    expect(at([...ok.slice(0, 5), 0.4999])).toBe(true);
    expect(at(ok, [true, true, true, true, true, false])).toBe(true);
    // an earlier census: liv 0.01 is alive, just below is extinct, whatever happens later
    expect(at([0.01, 0.8, 0.8, 0.8, 0.8, 0.8])).toBe(false);
    expect(at([0.8, 0.8, 0.0099, 0.8, 0.8, 0.8])).toBe(true);
    // coexist and liv below 0.50 matter at the last census only
    expect(at([0.3, 0.2, 0.4, 0.8, 0.8, 0.8], [false, false, true, false, true, true])).toBe(false);
    // a single census is its own last
    expect(at([0.5])).toBe(false);
    expect(at([0.49])).toBe(true);
  });
  it("0/1.5 isNoStart and the readout's class agree over a sweep of burn-ins (the harness and the readout can never disagree about a start)", () => {
    const levels = [0.0099, 0.01, 0.2, 0.4999, 0.5, 0.9];
    let nostart = 0;
    let started = 0;
    for (const early of levels) {
      for (const last of levels) {
        for (const lostLast of [false, true]) {
          for (const lostEarly of [false, true]) {
            const rows = rowsOf("DC", 20);
            rows.burn[2] = { ...rows.burn[2], liv: early, ...(lostEarly ? { shares: [1, 1, 0] } : {}) };
            rows.burn[5] = { ...rows.burn[5], liv: last, ...(lostLast ? { shares: [1, 1, 0] } : {}) };
            const j = job("DC", { rows });
            const a = analyzeRun(j, {});
            // what the harness sees at a burn-in census: the living fraction and whether every founding label is present
            const burn = j.rows!.slice(0, 6).map((rec) => ({ liv: rec.living / (128 * 128 * 4), coexist: rpsCoexist(rec.cells.map((c) => rpsIsPresent(c, rec.living)), 3) }));
            expect(isNoStart(burn), JSON.stringify({ early, last, lostLast, lostEarly })).toBe(a.cls === "NOSTART");
            if (a.cls === "NOSTART") nostart++;
            else started++;
          }
        }
      }
    }
    expect(nostart).toBeGreaterThan(50);
    expect(started).toBeGreaterThan(5);
  });

  it("0 row EXT: liv below 0.01 at a run census stops the job; T_cx is the stop step", () => {
    const a = analyze({ EXT: 7 });
    expect(a.cls).toBe("EXT");
    expect(a.tcx).toBe(7000);
    expect(a.stopRstep).toBe(7000);
    expect(a.nRun).toBe(7);
  });
  it("0 row EXT boundary: 0.01 of 65,536 cells is 655.36, so 655 living cells are extinct and 656 are only sparse", () => {
    for (const [living, cls] of [[655, "EXT"], [656, "SPARSE"]] as const) {
      const rows = rowsOf("DC", 20);
      rows.run[3] = { ...rows.run[3], liv: living / 65536 };
      expect(analyzeRun(job("DC", { rows }), {}).cls).toBe(cls);
    }
  });
  it("0 row LOSS: coexist false at three consecutive run censuses; T_cx is the first of the three", () => {
    const a = analyze({ LOSS: 5 });
    expect(a.cls).toBe("LOSS");
    expect(a.tcx).toBe(5000);
    expect(a.stopRstep).toBe(7000);
    expect(a.nRun).toBe(7);
  });
  it("0 row LOSS needs three: two missing censuses before the final window do not end the run (inside it they are LATE)", () => {
    const lost = Array.from({ length: 8 }, (_, x) => (x < 2 ? 1 : 0));
    const early = rowsOf("DC", 40);
    early.run[5] = { ...early.run[5], shares: lost };
    early.run[6] = { ...early.run[6], shares: lost };
    const a = analyzeRun(job("DC", { rows: early }), {});
    expect(a.cls).toBe("DC");
    expect(a.nRun).toBe(40);
    const inside = rowsOf("DC", 20);
    inside.run[5] = { ...inside.run[5], shares: lost };
    inside.run[6] = { ...inside.run[6], shares: lost };
    expect(analyzeRun(job("DC", { rows: inside }), {}).cls).toBe("LATE");
  });
  it("0 row EXT beats LOSS when both complete at the same census", () => {
    const rows = rowsOf("DC", 20);
    const lost = Array.from({ length: 8 }, (_, x) => (x < 2 ? 1 : 0));
    rows.run[4] = { ...rows.run[4], shares: lost };
    rows.run[5] = { ...rows.run[5], shares: lost };
    rows.run[6] = { ...rows.run[6], liv: 0.001, shares: lost };
    const a = analyzeRun(job("DC", { rows }), {});
    expect(a.cls).toBe("EXT");
    expect(a.tcx).toBe(7000);
  });
  it("1.5 nothing after the stop census is used: a driver that kept going gives the same class and T_cx", () => {
    const stopped = analyze({ LOSS: 5 });
    const tail = analyze({ LOSS: 5 }, { tail: true, nRun: 30 });
    expect(tail.cls).toBe("LOSS");
    expect(tail.tcx).toBe(stopped.tcx);
    expect(tail.nRun).toBe(7);
    expect(analyze({ EXT: 9 }, { tail: true, nRun: 30 }).tcx).toBe(9000);
  });
  it("0 row SPARSE: not alive (liv below 0.20 somewhere in the final window); T_cx is CENSORED", () => {
    const a = analyze("SPARSE");
    expect(a.cls).toBe("SPARSE");
    expect(a.tcx).toBe("CENSORED");
  });
  it("0 row SPARSE boundary: 0.20 of 65,536 cells is 13,107.2, so 13,107 living cells are sparse and 13,108 are alive", () => {
    for (const [living, cls] of [[13107, "SPARSE"], [13108, "DC"]] as const) {
      const rows = rowsOf("DC", 20);
      rows.run = rows.run.map((r) => ({ ...r, liv: living / 65536 }));
      expect(analyzeRun(job("DC", { rows }), {}).cls).toBe(cls);
    }
  });
  it("0 row LATE: coexist false at one or two censuses of the final window, not three in a row", () => {
    const a = analyze("LATE");
    expect(a.cls).toBe("LATE");
    expect(a.tcx).toBe("CENSORED");
    expect(a.nRun).toBe(20);
  });
  it("0 SPARSE comes before LATE", () => {
    const rows = rowsOf("DC", 20);
    const lost = Array.from({ length: 8 }, (_, x) => (x < 2 ? 1 : 0));
    rows.run = rows.run.map((r, k) => ({ ...r, liv: 0.1, shares: k === 19 ? lost : r.shares }));
    expect(analyzeRun(job("DC", { rows }), {}).cls).toBe("SPARSE");
  });
  it("0 row FC: not dynamic (turnover over the final window below 0.02)", () => {
    const a = analyze("FC");
    expect(a.cls).toBe("FC");
    expect(a.turnoverFw).toBeCloseTo(0.005, 12);
  });
  it("0 row FC boundary: mean turnover exactly 0.02 is dynamic", () => {
    const rows = rowsOf("CHURN", 20);
    rows.run = rows.run.map((r) => ({ ...r, turnover: 0.02 }));
    expect(analyzeRun(job("CHURN", { rows }), {}).cls).toBe("CHURN");
  });
  it("0 row CHURN: dynamic with chi_fw below 0.2 (a coexisting film with no cyclic signature)", () => {
    const a = analyze("CHURN");
    expect(a.cls).toBe("CHURN");
    expect(a.chiFw).toBe(0);
  });
  it("0 row DC: dynamic with chi_fw at least 0.2", () => {
    const a = analyze("DC");
    expect(a.cls).toBe("DC");
    expect(a.chiFw).toBeCloseTo((250 - 50) / 300, 12);
    expect(a.tcx).toBe("CENSORED");
    expect(a.turnoverFw).toBeCloseTo(0.1, 12);
  });
  it("0 DC boundary: chi_fw exactly 0.2 is DC, just under is CHURN", () => {
    const at = rowsOf("DC", 20);
    at.run = at.run.map((r) => ({ ...r, ndom: 60, nanti: 40 }));
    expect(analyzeRun(job("DC", { rows: at }), {}).cls).toBe("DC");
    const under = rowsOf("DC", 20);
    under.run = under.run.map((r) => ({ ...r, ndom: 59, nanti: 41 }));
    expect(analyzeRun(job("DC", { rows: under }), {}).cls).toBe("CHURN");
  });
  it("0 chirality: fewer than 200 changes in the window give chi 0, so a feeble signature is CHURN", () => {
    const rows = rowsOf("DC", 20);
    rows.run = rows.run.map((r) => ({ ...r, ndom: 9, nanti: 0 })); // 180 counted changes over 20 censuses
    const a = analyzeRun(job("DC", { rows }), {});
    expect(a.chiFw).toBe(0);
    expect(a.cls).toBe("CHURN");
    rows.run = rows.run.map((r) => ({ ...r, ndom: 10, nanti: 0 })); // exactly 200
    expect(analyzeRun(job("DC", { rows }), {}).chiFw).toBe(1);
  });
  it("0 the classes are exhaustive and exclusive over a sweep of synthetic jobs", () => {
    const seen = new Set<string>();
    const specs: ClassSpec[] = ["DC", "CHURN", "FC", "SPARSE", "LATE", "NOSTART", { LOSS: 3 }, { EXT: 4 }];
    for (const c of specs) seen.add(analyze(c).cls);
    expect([...seen].sort()).toEqual(["CHURN", "DC", "EXT", "FC", "LATE", "LOSS", "NOSTART", "SPARSE"]);
  });
});

describe("rule 0, windows, chi_fw and chi_all", () => {
  it("chi_fw is 0 for a job that stopped before it had a window; chi_all covers what it ran", () => {
    const a = analyze({ LOSS: 5 });
    expect(a.hasWindow).toBe(false);
    expect(a.chiFw).toBe(0);
    expect(a.chiAll).toBeCloseTo(chirality(250 * 4, 50 * 4), 12); // the four censuses before the loss
  });
  it("chi_all stops at the last census before a sustained loss; chi_fw is the last 20 censuses including the loss", () => {
    const rows = rowsOf({ LOSS: 25 }, 40);
    rows.run = rows.run.map((r, k) => (k < 24 ? { ...r, ndom: 150, nanti: 50 } : { ...r, ndom: 0, nanti: 300 }));
    const a = analyzeRun(job({ LOSS: 25 }, { rows }), {});
    expect(a.cls).toBe("LOSS");
    expect(a.nRun).toBe(27);
    expect(a.chiAll).toBeCloseTo(0.5, 12);
    // rows 8..27: 17 rows of (150, 50) and 3 of (0, 300)
    expect(a.chiFw).toBeCloseTo((2550 - 1750) / 4300, 12);
  });
  it("the window is the last 20 run censuses, counted from the end", () => {
    const rows = rowsOf("DC", 30);
    rows.run = rows.run.map((r, k) => (k < 10 ? { ...r, turnover: 0.9 } : { ...r, turnover: 0.1 }));
    const a = analyzeRun(job("DC", { rows }), {});
    expect(a.turnoverFw).toBeCloseTo(0.1, 12);
    expect(a.nRun).toBe(30);
  });
  it("section 7's window of 50 is a separate option of the same function", () => {
    const a = analyzeRun(job("DC", { nRun: 60 }), { window: 50 });
    expect(a.hasWindow).toBe(true);
  });
  it("a job that ends normally with fewer run censuses than the window is unusable input", () => {
    expect(() => analyzeRun(job("DC", { nRun: 12 }), {})).toThrow(/fewer than the final window/);
  });
  it("a job of another length than the schedule is unusable input", () => {
    expect(() => analyzeRun(job("DC", { nRun: 25 }), { expectedRun: 30 })).toThrow(/the schedule gives 30/);
    expect(analyzeRun(job("DC", { nRun: 30 }), { expectedRun: 30 }).cls).toBe("DC");
    // an early stop is exempt
    expect(analyzeRun(job({ LOSS: 5 }, {}), { expectedRun: 30 }).cls).toBe("LOSS");
  });
  it("empty ndom / nanti in a mutRate-0 job is unusable input", () => {
    const rows = rowsOf("DC", 20);
    rows.run[3] = { ...rows.run[3], ndom: null };
    expect(() => analyzeRun(job("DC", { rows }), {})).toThrow(/ndom is empty/);
  });
  it("an empty turnover in the final window (no cell living at both censuses) stops the readout with code 3 where the class needs it: no row covers it (final review, finding 9)", () => {
    const rows = rowsOf("DC", 20);
    rows.run[10] = { ...rows.run[10], turnover: null };
    let err: unknown = null;
    try {
      analyzeRun(job("DC", { rows }), {});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReadoutError);
    expect((err as ReadoutError).code).toBe(3);
    expect((err as ReadoutError).message).toMatch(/no cell lives at both censuses 16000 and 17000.*undefined.*no row covers this/);
  });
  it("the stored n and Y must agree with the label counts and modal masks", () => {
    const j = job("DC");
    j.rows![9] = { ...j.rows![9], n: 2 };
    expect(() => analyzeRun(j, {})).toThrow(/n is 2/);
    const k = job("DC");
    k.rows![9] = { ...k.rows![9], Y: 0 };
    expect(() => analyzeRun(k, {})).toThrow(/Y is 0/);
  });
  it("census.tsv bookkeeping: rstep = step - 6000, increasing steps, label counts adding up to living", () => {
    const a = job("DC");
    a.rows![8] = { ...a.rows![8], rstep: 7 };
    expect(() => analyzeRun(a, {})).toThrow(/rstep/);
    const b = job("DC");
    b.rows![8] = { ...b.rows![8], step: b.rows![7].step };
    expect(() => analyzeRun(b, {})).toThrow(/not increasing/);
    const c = job("DC");
    c.rows![8] = { ...c.rows![8], living: c.rows![8].living + 1 };
    expect(() => analyzeRun(c, {})).toThrow(/add up/);
  });
  it("summary.json must agree with the file about the steps, and give K0 and a shape", () => {
    const j = job("DC", { extra: { steps: 99000 } });
    expect(() => analyzeRun(j, {})).toThrow(/99000 steps/);
    const noK0 = mkJob({ stage: "g0.table", seed: 401, spread: 16, rate: 32, extra: { init: undefined } });
    expect(() => analyzeRun(noK0, {})).toThrow(/no K0/);
    const noShape = mkJob({ stage: "g0.table", seed: 401, spread: 16, rate: 32, extra: { config: undefined } });
    expect(() => analyzeRun(noShape, {})).toThrow(/no shape/);
  });
  it("a MISSING-marked job has no run class", () => {
    expect(() => analyzeRun(job("DC", { extra: { missing: true } }), {})).toThrow(/MISSING/);
  });
});

describe("summary.json normalisation (the contract with the drivers)", () => {
  it("reads the run-phase config, init params and bookkeeping from the layout a driver writes", () => {
    const { summary } = rawJob({ stage: "g0.table", rung: "S1", kill: "removal", seed: 402, spread: 12, rate: 16, K0: 3, mutRate: 0 });
    const s = normalizeSummary(summary, "x");
    expect(s).toMatchObject({ stage: "g0.table", rung: "S1", kill: "removal", seed: 402, spread: 12, rate: 16, K0: 3, types: 3, mutRate: 0, dims: { W: 128, H: 128, D: 4 }, residual: "0", matterOk: true, missing: false });
    expect(s.burnKey).not.toBeNull();
  });
  it("also reads top-level fields, a shape string, and several spellings of stop and MISSING", () => {
    const s = normalizeSummary({ stage: "sweep", seed: 211, shape: "64x64x4", spread: 8, rpsRate: 3, K0: 4, stop: { reason: "LOSS", rstep: 9000 }, residual: 0 }, "y");
    expect(s).toMatchObject({ dims: { W: 64, H: 64, D: 4 }, spread: 8, rate: 3, K0: 4, stopKind: "loss", stopRstep: 9000, residual: "0" });
    expect(normalizeSummary({ stage: "sweep", seed: 1, status: "missing" }, "z").missing).toBe(true);
    expect(normalizeSummary({ stage: "sweep", seed: 1, stop: "missing" }, "z").missing).toBe(true);
    expect(normalizeSummary({ stage: "sweep", seed: 1, shape: [32, 32, 8] }, "z").dims).toEqual({ W: 32, H: 32, D: 8 });
  });
  it("rejects an unknown stage, a missing seed, a bad rung, kill or arm", () => {
    expect(() => normalizeSummary({ stage: "warmup", seed: 1 }, "a")).toThrow(ReadoutError);
    expect(() => normalizeSummary({ stage: "sweep" }, "a")).toThrow(/no seed/);
    expect(() => normalizeSummary({ stage: "g0.table", seed: 1, rung: "S9" }, "a")).toThrow(/rung/);
    expect(() => normalizeSummary({ stage: "g0.table", seed: 1, kill: "eat" }, "a")).toThrow(/kill/);
    expect(() => normalizeSummary({ stage: "mutation", seed: 1, arm: "Q" }, "a")).toThrow(/arm/);
    expect(() => normalizeSummary(7, "a")).toThrow(/not an object/);
  });
  it("stage aliases", () => {
    expect(canonicalStage("G0.3-Table")).toBe("g0.table");
    expect(canonicalStage("g0_scan")).toBe("g0.scan"); // underscores and spaces are normalised, then the alias table applies
    expect(canonicalStage("sweep-control")).toBe("sweep");
    expect(canonicalStage("mutation")).toBe("mutation");
    expect(canonicalStage("nonsense")).toBeNull();
  });
});

describe("statistics helpers", () => {
  it("medians: the mean of the two middle values, or the lower one", () => {
    expect(medianMean([3, 1, 2])).toBe(2);
    expect(medianMean([4, 1, 2, 3])).toBe(2.5);
    expect(medianLower([4, 1, 2, 3])).toBe(2);
    expect(medianLower([5, 1, 3])).toBe(3);
    expect(medianLower([Infinity, 2, 7])).toBe(7);
    expect(Number.isNaN(medianMean([]))).toBe(true);
  });
  it("7.5 the Fisher rule: gN_L <= g_L - 4 is exactly the one-sided exact test at 0.05 for five runs against five", () => {
    for (let gL = 0; gL <= 5; gL++) {
      for (let gN = 0; gN <= 5; gN++) {
        const p = fisherOneSided(gL, 5 - gL, gN, 5 - gN);
        const rule = gL >= 4 && gN <= gL - 4;
        expect(p < 0.05 && gL > gN).toBe(rule);
      }
    }
    expect(fisherOneSided(4, 1, 0, 5)).toBeCloseTo(6 / 252, 12);
    expect(fisherOneSided(5, 0, 1, 4)).toBeCloseTo(6 / 252, 12);
    expect(fisherOneSided(4, 1, 1, 4)).toBeCloseTo(26 / 252, 12);
    expect(fisherOneSided(5, 0, 2, 3)).toBeCloseTo(21 / 252, 12);
  });
});

describe("8.4 bug indicators common to every stage", () => {
  const check = (jobs: ReturnType<typeof job>[]) => {
    const pr = new Problems();
    jobBugs(jobs, (j) => analyzeRun(j, {}), pr);
    return pr;
  };
  it("8.4 a nonzero energy residual", () => {
    const pr = check([job("DC", { residual: "12" })]);
    expect(pr.code).toBe(3);
    expect(pr.list[0].message).toMatch(/residual 12/);
  });
  it("8.4 a matter change", () => {
    expect(check([job("DC", { matterOk: false })]).code).toBe(3);
  });
  it("8.4 a job that does not report the residual is unusable input", () => {
    const j = job("DC");
    j.s.residual = null;
    expect(check([j]).code).toBe(2);
  });
  it("8.4 jobs of one seed and one burn-in config whose burnHash differ", () => {
    const a = job("DC", { rate: 32, burnHash: "aaaa" });
    const b = job("CHURN", { rate: 0, burnHash: "bbbb", id: "other" });
    expect(burnGroupKey(a.s)).toBe(burnGroupKey(b.s));
    const pr = check([a, b]);
    expect(pr.code).toBe(3);
    expect(pr.list.map((p) => p.message).join()).toMatch(/burnHash differs/);
    // equal hashes, or different seeds, are fine
    expect(check([a, job("CHURN", { rate: 0, burnHash: "aaaa", id: "o2" })]).code).toBe(0);
    expect(check([a, job("CHURN", { rate: 0, seed: 402, burnHash: "bbbb", id: "o3" })]).code).toBe(0);
  });
  it("8.4 burnHash covers the config: jobs with another burn-in config (rpsTypes, rpsFlip) are not compared", () => {
    const a = job("DC", { burnHash: "aaaa" });
    const b = job("DC", { burnHash: "bbbb", types: 5, id: "t5" });
    const c = job("DC", { burnHash: "cccc", flip: 7, id: "f7" });
    expect(burnGroupKey(a.s)).not.toBe(burnGroupKey(b.s));
    expect(burnGroupKey(a.s)).not.toBe(burnGroupKey(c.s));
    expect(check([a, b, c]).code).toBe(0);
  });
  it("8.4 the kill form is not part of the burn-in: a vacancy-kill job and a removal job of one seed must share a burnHash", () => {
    const removal = job("DC", { rung: "S0", kill: "removal", rate: 0, burnHash: "aaaa", id: "removal" });
    const vacancy = job("DC", { rung: "V", kill: "vacancy", rate: 256, burnHash: "bbbb", id: "vacancy", substrate: "S0" });
    expect(burnGroupKey(removal.s)).toBe(burnGroupKey(vacancy.s));
    const pr = check([removal, vacancy]);
    expect(pr.code).toBe(3);
    expect(pr.list.map((p) => p.message).join()).toMatch(/burnHash differs/);
    const same = job("DC", { rung: "V", kill: "vacancy", rate: 256, burnHash: "aaaa", id: "vacancy2", substrate: "S0" });
    expect(check([removal, same]).code).toBe(0);
  });
  it("8.4 a kill-form key in the burn-phase config (the kernel's provisional rpsKill) is left out of the group key", () => {
    const { summary } = rawJob({ stage: "g0.table", rung: "V", kill: "vacancy", seed: 401, spread: 16, rate: 256 });
    const burn = (summary.config as { burn: Record<string, unknown> }).burn;
    const withKey = normalizeSummary({ ...summary, config: { ...(summary.config as object), burn: { ...burn, rpsKill: "vacancy" } } }, "w");
    const without = normalizeSummary(summary, "wo");
    expect(withKey.burnKey).toBe(without.burnKey);
  });
  it("8.4 a control (rate 0) with |chi_fw| above 0.3", () => {
    const rows = rowsOf("DC", 20);
    rows.run = rows.run.map((r) => ({ ...r, ndom: 190, nanti: 10 })); // chi 0.9
    const pr = check([job("DC", { rate: 0, rows })]);
    expect(pr.code).toBe(3);
    expect(pr.list[0].message).toMatch(/control with \|chi_fw\|/);
    // a treatment job with the same signature is the point, not a bug
    expect(check([job("DC", { rate: 32, rows })]).code).toBe(0);
    // and a control at 0.25 is not a bug indicator (informative() will reject the spread instead)
    const mild = rowsOf("DC", 20);
    mild.run = mild.run.map((r) => ({ ...r, ndom: 125, nanti: 75 }));
    expect(check([job("DC", { rate: 0, rows: mild })]).code).toBe(0);
  });
  it("8.4 MISSING-marked jobs and NOSTART jobs raise nothing", () => {
    expect(check([job("DC", { rate: 0, extra: { missing: true }, residual: "7" })]).code).toBe(0);
  });
});

describe("7.3 mutation run classes", () => {
  // five-label rows: labels 0..4 present, the 5-cycle masks (Y = 5), or three labels in a cycle (Y = 3), or a hierarchy (Y = 0)
  const five: RowSpec = { liv: 0.9, shares: [1, 1, 1, 1, 1], modal: [2, 4, 8, 16, 1], supply: 5 };
  const three: RowSpec = { liv: 0.9, shares: [1, 1, 1], supply: 5 };
  const hier: RowSpec = { liv: 0.9, shares: [1, 1, 1], modal: [6, 4, 0], supply: 5 }; // 0 -> 1, 0 -> 2, 1 -> 2: no cycle
  const two: RowSpec = { liv: 0.9, shares: [1, 1], supply: 5 };
  const one: RowSpec = { liv: 0.9, shares: [1], supply: 5 };
  const mut = (run: RowSpec[], arm: "Z" | "A" | "B" | "C" | "N" | "W" = "C", expectedRun: number | null = null) =>
    analyzeMutation(mkJob({ stage: "mutation", arm, seed: 251, spread: 16, rate: 32, mutRate: 42950, rows: { burn: rowsOf("DC", 1).burn, run } }), arm, { expectedRun });
  const rep = (r: RowSpec, n: number) => Array.from({ length: n }, () => ({ ...r }));

  it("7.3 row LONG: Y_c at least 4 at every census of the final window (the last 50)", () => {
    const a = mut(rep(five, 60));
    expect(a.cls).toBe("LONG");
    expect(a.maxY).toBe(5);
    expect(a.everLong).toBe(true);
  });
  it("7.3 LONG needs every census of the window: one census with Y = 3 in the last 50 makes it THREE or LOOSE, not LONG", () => {
    const run = [...rep(five, 59), { ...three }];
    expect(mut(run).cls).not.toBe("LONG");
    // the dip is in the window, so the window is not all Y >= 4; it is not all Y = 3 either
    expect(mut(run).cls).toBe("LOOSE");
  });
  it("7.3 row THREE: Y_c = 3 at every census of the final window", () => {
    expect(mut(rep(three, 60)).cls).toBe("THREE");
  });
  it("7.3 row LOOSE: n_c at least 2 at every census of the final window", () => {
    expect(mut(rep(hier, 60)).cls).toBe("LOOSE");
    expect(mut(rep(two, 60)).cls).toBe("LOOSE");
  });
  it("7.3 row MONO: some census of the final window has n_c at most 1", () => {
    expect(mut([...rep(three, 59), { ...one }], "C").cls).toBe("MONO");
  });
  it("7.3 row EXTINCT: liv below 0.01 at some census (first row of the table)", () => {
    const a = mut([...rep(five, 30), { liv: 0.001, shares: [1, 1, 1], supply: 5 }, ...rep(five, 5)]);
    expect(a.cls).toBe("EXTINCT");
    expect(a.nRun).toBe(31);
    expect(a.stoppedEarly).toBe(true);
  });
  it("7.2a early stop: arms Z, A and W stop at three consecutive censuses with n_c <= 1 and are MONO", () => {
    const run = [...rep(three, 10), ...rep(one, 3), ...rep(three, 60)];
    for (const arm of ["Z", "A", "W"] as const) {
      const a = mut(run, arm);
      expect(a.cls).toBe("MONO");
      expect(a.nRun).toBe(13);
      expect(a.stoppedEarly).toBe(true);
    }
  });
  it("7.2a arms B, C and N run to T_end7: a type change can bring a label back, so a dip does not stop them", () => {
    const run = [...rep(three, 10), ...rep(one, 3), ...rep(three, 60)];
    for (const arm of ["B", "C", "N"] as const) {
      const a = mut(run, arm);
      expect(a.stoppedEarly).toBe(false);
      expect(a.nRun).toBe(73);
      expect(a.cls).toBe("THREE");
    }
  });
  it("7.2a a stop for two such censuses is not enough", () => {
    expect(mut([...rep(three, 10), ...rep(one, 2), ...rep(three, 60)], "Z").stoppedEarly).toBe(false);
  });
  it("7.3 EVER-LONG is a stretch of 20 consecutive censuses with Y_c >= 4 anywhere, and the first step with n_c >= 4 is recorded", () => {
    const withStretch = [...rep(three, 5), ...rep(five, 20), ...rep(three, 60)];
    const a = mut(withStretch);
    expect(a.everLong).toBe(true);
    expect(a.cls).toBe("THREE");
    expect(a.firstN4).toBe(6000 + 1000 * 6 - 6000 + 6000 - 6000); // run step of the sixth run census
    expect(a.firstN4).toBe(6000);
    const nineteen = mut([...rep(three, 5), ...rep(five, 19), ...rep(three, 60)]);
    expect(nineteen.everLong).toBe(false);
    expect(nineteen.maxY).toBe(5);
    expect(mut(rep(three, 60)).firstN4).toBeNull();
  });
  it("7.3 supply is the largest value over the censuses; an empty supply column is unusable input", () => {
    const a = mut([...rep({ ...three, supply: 2 }, 30), ...rep({ ...three, supply: 70 }, 5), ...rep({ ...three, supply: 3 }, 30)]);
    expect(a.supplyMax).toBe(70);
    expect(() => mut(rep({ ...three, supply: null }, 60))).toThrow(/supply is empty/);
  });
  it("7.3 a run that ends normally with fewer than 50 censuses is unusable input", () => {
    expect(() => mut(rep(three, 30))).toThrow(/fewer than the final window of 50/);
  });
  it("7.3 the run length follows the schedule", () => {
    expect(() => mut(rep(three, 60), "C", 100)).toThrow(/the schedule gives 100/);
    expect(mut(rep(three, 60), "C", 60).cls).toBe("THREE");
  });
  it("mkRecord is consistent: n and Y of a five-cycle row", () => {
    const r = mkRecord(7000, five, 3);
    expect([r.n, r.Y]).toEqual([5, 5]);
  });
});

// ===================================================================================================================
// 2. the lattice (rule draft 2.2 to 2.7)
// ===================================================================================================================


/** Hand-built cells for the pair (20, 30): `k20` and `k30` give k at each of the 11 values of M (R = 600). */
const pairCells = (k20: number[], k30: number[]): Map<string, LatticeCell> => {
  const m = new Map<string, LatticeCell>();
  LAT_M.forEach((M, iM) => {
    m.set(`20:${iM}`, { L: 20, iM, M, R: 600, k: k20[iM] });
    m.set(`30:${iM}`, { L: 30, iM, M, R: 600, k: k30[iM] });
  });
  return m;
};

describe("2.2 add-one errors", () => {
  it("2.2 SE of the add-one estimate is never 0, even for a count of 0 or R", () => {
    expect(addOneSE(0, 600)).toBeCloseTo(Math.sqrt(((1 / 602) * (601 / 602)) / 602), 12);
    expect(addOneSE(0, 600)).toBeGreaterThan(0);
    expect(addOneSE(600, 600)).toBeCloseTo(addOneSE(0, 600), 12);
    expect(addOneSE(300, 600)).toBeCloseTo(Math.sqrt(0.25 / 602), 12); // p' = 301 / 602 = 0.5
    expect(addOneSE(300, 600)).toBeCloseTo(0.0204, 3);
  });
});

describe("2.3 the crossing", () => {
  const flatTop = (v: number) => new Array(11).fill(v);
  it("2.3 a supported sign change: negative lobe, positive lobe, and the zero of the line in log10 M", () => {
    // L1 sits at 300; L2 is 264 (D = -0.06) up to M = 2e-4, 282 (D = -0.03) at 3e-4, 354 (D = +0.09) at 4e-4, then 336 (D = +0.06)
    const k30 = [264, 264, 264, 264, 282, 354, 336, 336, 336, 336, 336];
    const r = analyzePair(20, 30, pairCells(flatTop(300), k30), LAT_M);
    expect(r.valid).toBe(true);
    expect(r.crossing).toMatchObject({ ia: 4, Ma: 3e-4, Mb: 4e-4, supported: true });
    const xa = Math.log10(3e-4);
    const xb = Math.log10(4e-4);
    expect(r.estimate).toBeCloseTo(10 ** (xa + 0.25 * (xb - xa)), 12);
    expect(r.points[4].D).toBeCloseTo(-0.03, 12);
    expect(r.points[5].D).toBeCloseTo(0.09, 12);
  });
  it("2.3 D(Ma) = 0 gives Ma itself as the estimate", () => {
    const k30 = [264, 264, 264, 264, 300, 336, 336, 336, 336, 336, 336];
    const r = analyzePair(20, 30, pairCells(flatTop(300), k30), LAT_M);
    expect(r.valid).toBe(true);
    expect(r.estimate).toBe(3e-4);
  });
  it("2.3 a bare step from 0 to positive, which two counts of zero make, is not a crossing (no negative lobe)", () => {
    const k20 = flatTop(0);
    const k30 = [0, 0, 0, 0, 0, 0, 120, 120, 120, 120, 120];
    const r = analyzePair(20, 30, pairCells(k20, k30), LAT_M);
    expect(r.signChanges.length).toBe(1);
    expect(r.signChanges[0].supported).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.estimate).toBeNull();
  });
  it("2.3 a negative lobe that is not 2 SE_D deep does not support the sign change; a positive lobe that is not 2 SE_D high does not either", () => {
    // D = -0.04 (below 2 SE_D = 0.0577) before, +0.09 after: negative lobe too shallow
    const shallowNeg = [276, 276, 276, 276, 288, 354, 354, 354, 354, 354, 354];
    expect(analyzePair(20, 30, pairCells(flatTop(300), shallowNeg), LAT_M).valid).toBe(false);
    const shallowPos = [264, 264, 264, 264, 282, 318, 318, 318, 318, 318, 318]; // D = +0.03 after
    expect(analyzePair(20, 30, pairCells(flatTop(300), shallowPos), LAT_M).valid).toBe(false);
  });
  it("2.3 the lobes are on the right sides: a deep negative value AFTER the sign change does not count for condition (i)", () => {
    // D positive early, one deep negative lobe late: the only sign change at the start has no negative M <= Ma
    const k30 = [336, 336, 300, 300, 300, 264, 264, 336, 336, 336, 336];
    const r = analyzePair(20, 30, pairCells(flatTop(300), k30), LAT_M);
    expect(r.valid).toBe(r.signChanges.some((s) => s.supported));
    // the change at (iM 6 -> 7) is the one with a negative lobe before it and a positive lobe after it
    expect(r.signChanges.map((s) => [s.ia, s.supported])).toEqual([[6, true]]);
  });
  it("2.3 the crossing is the supported sign change with the lowest Ma", () => {
    // two sign changes, both supported: ... -, +, -, + ...
    const k30 = [264, 264, 336, 264, 264, 336, 336, 336, 336, 336, 336];
    const r = analyzePair(20, 30, pairCells(flatTop(300), k30), LAT_M);
    expect(r.signChanges.map((s) => s.ia)).toEqual([1, 4]);
    expect(r.crossing!.ia).toBe(1);
  });
  it("2.3 D(M) is the exact difference (0.3 - 0.1 style rounding does not move it)", () => {
    const r = analyzePair(20, 30, pairCells(flatTop(60), flatTop(180)), LAT_M);
    expect(r.points[0].D).toBe(0.2);
  });
});

describe("2.6 the outcome table", () => {
  it("2.6 row 1 LAT-PASS: V >= 4, M_c in [3e-4, 6e-4], R3 (synthetic curves crossing at 3.5e-4)", () => {
    const r = evaluateLattice(latticeCells(logisticP(3.5e-4, STEEP)));
    expect(r.status).toBe("final");
    expect(r.main!.V).toBeGreaterThanOrEqual(4);
    expect(r.main!.Mc!).toBeGreaterThanOrEqual(3e-4);
    expect(r.main!.Mc!).toBeLessThanOrEqual(6e-4);
    expect(r.main!.r3).toBe(true);
    expect(r.main!.outcome).toEqual({ row: 1, name: "LAT-PASS" });
    expect(r.name).toBe("LAT-PASS");
    expect(r.problems.code).toBe(0);
  });
  it("2.6 row 2 LAT-CAVEAT: M_c in [2.25e-4, 9e-4] but not in the narrow band (crossings at 2.5e-4 and at 7e-4)", () => {
    for (const Mc of [2.5e-4, 7e-4]) {
      const r = evaluateLattice(latticeCells(logisticP(Mc, STEEP)));
      expect(r.main!.V).toBeGreaterThanOrEqual(4);
      expect(r.main!.outcome.name).toBe("LAT-CAVEAT");
      expect(r.name).toBe("LAT-CAVEAT");
      expect(r.status).toBe("final");
    }
  });
  it("2.6 row 3 LAT-OFFSET: V >= 4 and R3 but M_c outside [2.25e-4, 9e-4]; the contingency of 2.7 is then due", () => {
    for (const Mc of [1.5e-4, 1.2e-3]) {
      const r = evaluateLattice(latticeCells(logisticP(Mc, STEEP)));
      expect(r.main!.V).toBeGreaterThanOrEqual(4);
      expect(r.main!.r3).toBe(true);
      expect(r.main!.outcome).toEqual({ row: 3, name: "LAT-OFFSET" });
      expect(r.status).toBe("contingency-required");
      expect(r.name).toBeNull();
      expect(r.problems.code).toBe(4);
    }
  });
  it("2.6 row 4 LAT-TREND: V >= 4 but not R3 (curves that cross without a rising P_ext), even with M_c inside the narrow band", () => {
    const bs = [-0.36, -0.24, -0.12, 0];
    const rot = (L: number, M: number) => 0.5 + bs[[20, 30, 40, 60].indexOf(L)] * Math.tanh(1.5 * (Math.log10(M) - Math.log10(4.5e-4)));
    const r = evaluateLattice(latticeCells(rot));
    expect(r.main!.V).toBeGreaterThanOrEqual(4);
    expect(r.main!.r3).toBe(false);
    expect(r.main!.Mc!).toBeGreaterThan(3e-4);
    expect(r.main!.Mc!).toBeLessThan(6e-4);
    expect(r.main!.outcome).toEqual({ row: 4, name: "LAT-TREND" });
    expect(r.status).toBe("contingency-required");
  });
  it("2.6 row 5 LAT-NOCROSS: V < 4 (the same curve at every size gives D = 0 everywhere)", () => {
    const same = (_L: number, M: number) => logisticP(4.5e-4, STEEP)(60, M);
    const r = evaluateLattice(latticeCells(same));
    expect(r.main!.V).toBe(0);
    expect(r.main!.Mc).toBeNull();
    expect(r.main!.r3).toBe(true);
    expect(r.main!.outcome).toEqual({ row: 5, name: "LAT-NOCROSS" });
    expect(r.status).toBe("contingency-required");
  });
  it("2.6 the table as a function: bands are closed intervals and the first row that holds wins", () => {
    const row = (V: number, Mc: number | null, r3: boolean) => latticeRow(V, Mc, r3).row;
    expect(row(4, 3e-4, true)).toBe(1);
    expect(row(4, 6e-4, true)).toBe(1);
    expect(row(4, 2.999e-4, true)).toBe(2);
    expect(row(4, 6.001e-4, true)).toBe(2);
    expect(row(4, 2.25e-4, true)).toBe(2);
    expect(row(4, 9e-4, true)).toBe(2);
    expect(row(4, 2.249e-4, true)).toBe(3);
    expect(row(4, 9.001e-4, true)).toBe(3);
    expect(row(4, 4.5e-4, false)).toBe(4);
    expect(row(3, 4.5e-4, true)).toBe(5);
    expect(row(0, null, false)).toBe(5);
    expect(row(10, 4.5e-4, true)).toBe(1);
  });
  it("2.6 V = 4 is enough; V = 3 is not", () => {
    expect(latticeRow(4, 4e-4, true).row).toBe(1);
    expect(latticeRow(3, 4e-4, true).row).toBe(5);
  });
  it("2.3 M_c is the median of the valid pairs' estimates: the mean of the two middle values for an even V, the middle one for an odd V", () => {
    const even = evaluateLattice(latticeCells(logisticP(3.5e-4, STEEP)));
    expect(even.main!.V % 2).toBe(0);
    const e = even.main!.estimates;
    expect(even.main!.Mc).toBeCloseTo((e[e.length / 2 - 1] + e[e.length / 2]) / 2, 15);
    const odd = evaluateLattice(latticeCells(logisticP(1.2e-3, STEEP)));
    expect(odd.main!.V % 2).toBe(1);
    expect(odd.main!.Mc).toBe(odd.main!.estimates[(odd.main!.V - 1) / 2]);
  });
  it("2.4 R3 is P_ext(60, 2e-3) - P_ext(60, 1e-5) >= 0.20, exactly: 120 of 600 passes, 119 does not", () => {
    for (const [diff, ok] of [[120, true], [119, false]] as const) {
      const cells = latticeCells((L, M) => (L === 60 ? (M === 2e-3 ? (60 + diff) / 600 : M === 1e-5 ? 60 / 600 : 0.3) : 0.3));
      const r = evaluateLattice(cells);
      expect(r.main!.r3).toBe(ok);
    }
  });
  it("2.6 the report numbers: M_c / 4.5e-4 and the spread of the valid estimates", () => {
    const r = evaluateLattice(latticeCells(logisticP(4.5e-4, STEEP)));
    expect(r.main!.McOverPaper).toBeCloseTo(r.main!.Mc! / 4.5e-4, 12);
    expect(r.main!.estimates).toEqual([...r.main!.estimates].sort((a, b) => a - b));
  });
});

describe("2.7 the contingency", () => {
  it("2.7 rows 3 to 5 without the L = 100 cells: jobs missing (exit 4), the row of the main grid still reported", () => {
    const r = evaluateLattice(latticeCells(logisticP(1.2e-3, STEEP)));
    expect(r.status).toBe("contingency-required");
    expect(r.main!.outcome.row).toBe(3);
    expect(r.missing).toHaveLength(6);
    expect(r.problems.list[0].message).toMatch(/L = 100/);
  });
  it("2.7 a partial L = 100 set is still missing", () => {
    const cells = latticeCells(logisticP(1.2e-3, STEEP), (M) => logisticP(1.2e-3, STEEP)(100, M));
    const partial = cells.filter((c) => !(c.L === 100 && c.iM === 8));
    const r = evaluateLattice(partial);
    expect(r.status).toBe("contingency-required");
    expect(r.missing).toHaveLength(1);
  });
  it("2.7 LAT-FAIL: still in rows 3 to 5 after the L = 100 pairs are added", () => {
    const r = evaluateLattice(latticeCells(logisticP(1.2e-3, STEEP), (M) => logisticP(1.2e-3, STEEP)(100, M)));
    expect(r.status).toBe("final");
    expect(r.main!.outcome.row).toBe(3);
    expect(r.contingency!.outcome.row).toBe(3);
    expect(r.contingency!.pairs).toHaveLength(10);
    expect(r.name).toBe("LAT-FAIL");
    expect(r.problems.code).toBe(0);
  });
  it("2.7 the pairs (L, 100) are tested on the six values of M and V, M_c are recomputed over all valid pairs: row 5 can become row 1", () => {
    const same = (_L: number, M: number) => logisticP(4.5e-4, STEEP)(60, M);
    const r = evaluateLattice(latticeCells(same, (M) => logisticP(4.5e-4, STEEP)(100, M)));
    expect(r.main!.outcome.row).toBe(5);
    expect(r.contingency!.V).toBe(4);
    expect(r.contingency!.pairs.slice(6).every((p) => p.L2 === 100 && p.points.length === 6)).toBe(true);
    expect(r.contingency!.outcome.row).toBe(1);
    expect(r.name).toBe("LAT-PASS");
    expect(r.status).toBe("final");
  });
  it("2.7 a main-grid result in rows 1 or 2 never needs the contingency, and L = 100 cells given anyway are not used", () => {
    const r = evaluateLattice(latticeCells(logisticP(3.5e-4, STEEP), (M) => logisticP(3.5e-4, STEEP)(100, M)));
    expect(r.contingency).toBeNull();
    expect(r.name).toBe("LAT-PASS");
  });
});

describe("B.4 lattice result files", () => {
  const raw = { L: 20, M: 1e-5, iM: 0, N: 400, epsilon: 0.002, epsOverN: 5e-6, twoEpsOverN: 1e-5, R: 600, k: 12, pExt: 0.02, absorbedBy: [], seeds: [2_000_000, 2_000_599], seconds: 3, eventsPerSecond: 1e7 };
  it("accepts a well-formed file", () => {
    expect(parseLatticeCell(raw, "f")).toEqual({ L: 20, iM: 0, M: 1e-5, R: 600, k: 12 });
  });
  it("checks the seed formula of Appendix A: 2,000,000 + 100,000 iL + 1,000 iM + r", () => {
    expect(() => parseLatticeCell({ ...raw, seeds: [900, 1499] }, "f")).toThrow(/Appendix A/);
    expect(parseLatticeCell({ ...raw, L: 60, iM: 4, M: 3e-4, seeds: [2_000_000 + 300_000 + 4_000, 2_000_000 + 300_000 + 4_000 + 599] }, "f").L).toBe(60);
    expect(parseLatticeCell({ ...raw, L: 100, iM: 3, M: 2e-4, R: 300, k: 5, pExt: 5 / 300, seeds: [2_400_000 + 3_000, 2_400_000 + 3_000 + 299] }, "f").R).toBe(300);
  });
  it("rejects rehearsal data and inconsistent files (wrong R, M off the grid, pExt not k / R, k out of range, unknown L)", () => {
    expect(() => parseLatticeCell({ ...raw, R: 50, seeds: undefined }, "f")).toThrow(/R is 50/);
    expect(() => parseLatticeCell({ ...raw, L: 100 }, "f")).toThrow(/R is 600/);
    expect(() => parseLatticeCell({ ...raw, M: 2e-5 }, "f")).toThrow(/grid value/);
    expect(() => parseLatticeCell({ ...raw, pExt: 0.5 }, "f")).toThrow(/pExt/);
    expect(() => parseLatticeCell({ ...raw, k: 601 }, "f")).toThrow(/outside/);
    expect(() => parseLatticeCell({ ...raw, L: 50 }, "f")).toThrow(/L 50/);
    expect(() => parseLatticeCell(null, "f")).toThrow(ReadoutError);
  });
  it("duplicates are unusable input (exit 2); missing main-grid cells are exit 4", () => {
    const cells = latticeCells(logisticP(3.5e-4, STEEP));
    const dup = evaluateLattice([...cells, cells[0]]);
    expect(dup.problems.has(2)).toBe(true);
    const missing = evaluateLattice(cells.slice(1));
    expect(missing.status).toBe("incomplete");
    expect(missing.main).toBeNull();
    expect(missing.problems.code).toBe(4);
  });
});

// ===================================================================================================================
// 3.0 Gate 0 and 3.1 the meter
// ===================================================================================================================


describe("3.1 the meter formulas", () => {
  it("3.1 D = pi W^2 / (8 t)", () => {
    expect(mixingIndex(10, 5000)).toBeCloseTo((Math.PI * 100) / 40000, 12);
    expect(mixingIndex(0, 5000)).toBe(0);
  });
  it("3.1 D_lab is the mean of the x-stripe and y-stripe values; each axis from W and t, from D, or from one record with both", () => {
    const x = meterJob({ spread: 8, axis: "x", D: 0.02 });
    const y = meterJob({ spread: 8, axis: "y", D: 0.04 });
    const p = meterPoint(8, [x, y]);
    expect(p.Dx).toBeCloseTo(0.02, 12);
    expect(p.Dy).toBeCloseTo(0.04, 12);
    expect(p.Dlab).toBeCloseTo(0.03, 12);
    expect(p.ratio).toBeCloseTo(2, 12);
    const direct = meterPoint(8, [meterJob({ spread: 8, axis: "x", D: 0.02, useD: true }), meterJob({ spread: 8, axis: "y", D: 0.04, useD: true })]);
    expect(direct.Dlab).toBeCloseTo(0.03, 12);
    const one = { ...x, s: { ...x.s, meter: { ...x.s.meter!, axis: null, W: null, Wx: Math.sqrt((8 * 5000 * 0.02) / Math.PI), Wy: Math.sqrt((8 * 5000 * 0.04) / Math.PI), t: 5000 } } };
    expect(meterPoint(8, [one]).Dlab).toBeCloseTo(0.03, 12);
  });
  it("3.1 anisotropic: the axes differ by more than a factor 2, or one is 0 and the other is not; a factor of exactly 2 is not", () => {
    const pt = (dx: number, dy: number) => meterPoint(8, [meterJob({ spread: 8, axis: "x", D: dx, useD: true }), meterJob({ spread: 8, axis: "y", D: dy, useD: true })]);
    expect(pt(0.02, 0.0401).anisotropic).toBe(true);
    expect(pt(0.02, 0.04).anisotropic).toBe(false);
    expect(pt(0, 0.035).anisotropic).toBe(true); // scratch: spread 8 at 28 quanta has D_x 0 and D_y 0.035
    expect(pt(0, 0.035).ratio).toBe(Infinity);
    expect(pt(0, 0).anisotropic).toBe(false);
    expect(pt(0, 0).ratio).toBe(1);
  });
  it("3.1 flat: D_lab below 0.005", () => {
    const pt = (d: number) => meterPoint(2, [meterJob({ spread: 2, axis: "x", D: d, useD: true }), meterJob({ spread: 2, axis: "y", D: d, useD: true })]);
    expect(pt(0.00499).flat).toBe(true);
    expect(pt(0.005).flat).toBe(false);
  });
  it("3.1 a missing axis leaves D_lab undefined", () => {
    const p = meterPoint(8, [meterJob({ spread: 8, axis: "x", D: 0.02 })]);
    expect(p.Dlab).toBeNull();
    expect(p.Dx).not.toBeNull();
    expect(p.flat).toBe(false);
  });
});

describe("3.1 the registered meter and the ordering check", () => {
  const meter = (ds: Record<number, number>) => Object.entries(ds).flatMap(([v, d]) => (["x", "y"] as const).map((axis) => meterJob({ stage: "meter", spread: Number(v), axis, D: d, seed: 205 })));
  it("3.1 D_lab per spread of G_spread", () => {
    const r = evaluateMeter(meter({ 4: 0.01, 8: 0.02, 12: 0.04 }), [4, 8, 12]);
    expect(r.points.map((p) => p.Dlab!.toFixed(3))).toEqual(["0.010", "0.020", "0.040"]);
    expect(r.problems.code).toBe(0);
  });
  it("3.1 ordering: a consecutive pair with D_lab(next) < D_lab(previous) / 1.3 exits with code 3", () => {
    const r = evaluateMeter(meter({ 4: 0.01, 8: 0.02, 12: 0.0153 }), [4, 8, 12]); // 0.02 / 1.3 = 0.01538
    expect(r.problems.code).toBe(3);
    expect(r.problems.list[0].message).toMatch(/mobility rises along G_spread/);
  });
  it("3.1 ordering boundary: exactly D_lab(previous) / 1.3 passes, a hair below fails", () => {
    const ok = evaluateMeter(meter({ 4: 0.02, 8: 0.02 / 1.3 }), [4, 8]);
    expect(ok.problems.code).toBe(0);
    const bad = evaluateMeter(meter({ 4: 0.02, 8: 0.02 / 1.3 - 1e-6 }), [4, 8]);
    expect(bad.problems.code).toBe(3);
  });
  it("3.1 a fall that is within 1.3 is fine (the grid rule only takes rising values, but the registered meter is another seed)", () => {
    expect(evaluateMeter(meter({ 4: 0.02, 8: 0.016 }), [4, 8]).problems.code).toBe(0);
  });
  it("3.1 missing meter jobs of a spread of G_spread are exit 4", () => {
    const r = evaluateMeter(meter({ 4: 0.01, 8: 0.02 }), [4, 8, 12]);
    expect(r.problems.code).toBe(4);
  });
});

describe("G0.2 the grid rule", () => {
  const dl = (o: Record<number, number>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  it("G0.2 takes the first carpet spread and then each v with D_lab at least max(1.3 times the last taken, 0.005)", () => {
    expect(gridRule(CARPETS_5, dl(DLAB_5))).toEqual(G_5);
    expect(gridRule(CARPETS_3, dl(DLAB_3))).toEqual(G_3);
  });
  it("G0.2 the first carpet spread is taken whatever its D_lab, even a flat one; the floor of 0.005 then applies", () => {
    expect(gridRule([2, 4, 8], dl({ 2: 0.001, 4: 0.004, 8: 0.006 }))).toEqual([2, 8]);
    expect(gridRule([2, 4], dl({ 2: 0, 4: 0.0049 }))).toEqual([2]);
    expect(gridRule([2, 4], dl({ 2: 0, 4: 0.005 }))).toEqual([2, 4]);
  });
  it("G0.2 at most 8 spreads are kept", () => {
    const spreads = [2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32];
    const rising = Object.fromEntries(spreads.map((v, i) => [v, 0.01 * 1.5 ** i]));
    expect(gridRule(spreads, dl(rising))).toEqual(spreads.slice(0, 8));
  });
  it("G0.2 a non-monotone D_lab skips the spreads that fall below the last taken (the plateau and the dips of the scratch meter)", () => {
    expect(gridRule([8, 12, 16, 24, 32], dl({ 8: 0.018, 12: 0.041, 16: 0.039, 24: 0.041, 32: 0.031 }))).toEqual([8, 12]);
  });
  it("G0.2 the ratio test is >= : exactly 1.3 times the last taken passes", () => {
    expect(gridRule([4, 8], dl({ 4: 0.1, 8: 1.3 * 0.1 }))).toEqual([4, 8]);
    expect(gridRule([4, 8], dl({ 4: 0.1, 8: 1.3 * 0.1 - 1e-9 }))).toEqual([4]);
  });
  it("G0.2 the input order does not matter (increasing spread order is imposed)", () => {
    expect(gridRule([28, 4, 12, 8, 20], dl(DLAB_5))).toEqual([4, 8, 12, 20, 28]);
  });
});

describe("G0.1 R_cal, G0.4 h0, 1.2 the reduced schedule", () => {
  it("G0.1 R_cal = {kappa_w / 2, kappa_w, 2 kappa_w, 4 kappa_w}, rounded, at least 1", () => {
    expect(rCalOf(8, false)).toEqual([4, 8, 16, 32]);
    expect(rCalOf(64, false)).toEqual([32, 64, 128, 256]);
    expect(rCalOf(5, false)).toEqual([3, 5, 10, 20]);
    expect(rCalOf(1, false)).toEqual([1, 2, 4]); // 0.5 rounds to 1; duplicates are dropped
  });
  it("G0.1 at rung V R_cal is capped at 16,384", () => {
    expect(rCalOf(4096, true)).toEqual([2048, 4096, 8192, 16384]);
    expect(rCalOf(8192, true)).toEqual([4096, 8192, 16384]); // 4 x 8192 and 2 x 8192 both reach the cap
    expect(rCalOf(64, true)).toEqual([32, 64, 128, 256]);
    expect(rCalOf(1024, true)).toEqual([512, 1024, 2048, 4096]);
  });
  it("G0.4 h0 is the largest of 50,000, 100,000 and 200,000 at most T_ctl / 4; none below 50,000", () => {
    expect(horizonOf(200_000)).toBe(50_000);
    expect(horizonOf(399_999)).toBe(50_000);
    expect(horizonOf(400_000)).toBe(100_000);
    expect(horizonOf(800_000)).toBe(200_000);
    expect(horizonOf(Infinity)).toBe(200_000);
    expect(horizonOf(199_999)).toBeNull();
    expect(horizonOf(150_000)).toBeNull();
  });
  it("1.2 the reduced schedule: below 600 steps/s the budgets halve at most", () => {
    expect(scheduleOf(200_000, 600)).toEqual({ tEnd: 200_000, tEnd7: 1_000_000, reduced: false });
    expect(scheduleOf(200_000, 599.9)).toEqual({ tEnd: 100_000, tEnd7: 500_000, reduced: true });
    expect(scheduleOf(50_000, 300)).toEqual({ tEnd: 50_000, tEnd7: 250_000, reduced: true });
    expect(scheduleOf(100_000, 900)).toEqual({ tEnd: 100_000, tEnd7: 500_000, reduced: false });
  });
});

describe("3.0 the verdict table as a function (the first row that holds)", () => {
  it("3.0 row 1 NO-GO: LEVELS", () => {
    expect(verdictRow({ levels: 4, kappaW: 16, h0: 200_000, confirmDC: 3 })).toEqual({ row: 1, verdict: "NO-GO: LEVELS" });
    expect(verdictRow({ levels: 0, kappaW: null, h0: null, confirmDC: null }).row).toBe(1);
  });
  it("3.0 row 2 NO-GO: EFFECT", () => {
    expect(verdictRow({ levels: 5, kappaW: null, h0: 200_000, confirmDC: 3 })).toEqual({ row: 2, verdict: "NO-GO: EFFECT" });
  });
  it("3.0 row 3 NO-GO: HORIZON", () => {
    expect(verdictRow({ levels: 5, kappaW: 16, h0: null, confirmDC: 3 })).toEqual({ row: 3, verdict: "NO-GO: HORIZON" });
  });
  it("3.0 row 4 NO-GO: CONFIRM (fewer than 2 of the 3 confirmation jobs are DC)", () => {
    expect(verdictRow({ levels: 5, kappaW: 16, h0: 100_000, confirmDC: 1 })).toEqual({ row: 4, verdict: "NO-GO: CONFIRM" });
    expect(verdictRow({ levels: 5, kappaW: 16, h0: 100_000, confirmDC: 2 }).row).toBe(5);
  });
  it("3.0 row 5 GO", () => {
    expect(verdictRow({ levels: 5, kappaW: 16, h0: 100_000, confirmDC: 3 })).toEqual({ row: 5, verdict: "GO" });
  });
  it("3.0 V is judged from row 2: levels null skips row 1", () => {
    expect(verdictRow({ levels: null, kappaW: null, h0: null, confirmDC: null }).row).toBe(2);
    expect(verdictRow({ levels: null, kappaW: 256, h0: 200_000, confirmDC: 3 }).row).toBe(5);
  });
});

// ---- one substrate rung, every verdict row from synthetic jobs ----

const S0_GO: RungScenario = { rung: "S0", carpets: CARPETS_5, dlab: DLAB_5, g: G_5, confirm: { vCal: 12, rate: 16, h0: 200_000, classes: ["DC", "DC", "DC"] }, horizon: ["CHURN", "CHURN", "CHURN"] };
const gate0 = (...sets: Job[][]): Gate0Result => evaluateGate0(sets.flat());
const rungOf = (r: Gate0Result, rung: string): RungEval => r.rungs.find((x) => x.rung === rung)!;
const S1_NONE = (): Job[] => []; // S1 not run yet: a pending rung

describe("3.0 verdict rows, one substrate rung (S0), from synthetic jobs", () => {
  it("3.0 row 5 GO: grid, table, horizon and confirmation all pass; the record is fixed", () => {
    const r = gate0(rungJobs(S0_GO));
    const s0 = rungOf(r, "S0");
    expect(s0.state).toBe("done");
    expect(s0.row).toBe(5);
    expect(s0.verdict).toBe("GO");
    expect(s0.gSpread).toEqual(G_5);
    expect(s0.levels).toBe(5);
    expect(s0.bMeter).toBe(28);
    expect(s0.table!.spreads).toEqual([4, 12, 28]);
    expect(s0.kappaW).toBe(16);
    expect(s0.vCal).toBe(12); // works at all three spreads: the middle one
    expect(s0.horizon).toMatchObject({ spread: 12, Tctl: Infinity, h0: 200_000 });
    expect(s0.confirm).toMatchObject({ spread: 12, rate: 16, steps: 200_000, nDC: 3 });
    // S0 GO is the answer even though S1 has not run: the order is S0 first
    expect(r.overall).toEqual({ status: "go", used: "S0" });
    expect(r.operatingPoint).toMatchObject({ rung: "S0", kill: "removal", substrate: "S0", gSpread: G_5, vCal: 12, kappaW: 16, rCal: [8, 16, 32, 64], h0: 200_000, shape: [128, 128, 4], denseRate: null });
    expect(r.problems.code).toBe(0);
  });

  it("3.0 row 1 NO-GO: LEVELS (fewer than 5 distinct mobilities); no table is needed", () => {
    const r = gate0(rungJobs({ rung: "S0", carpets: CARPETS_3, dlab: DLAB_3, g: G_3, table: null, horizon: null, confirm: null }));
    const s0 = rungOf(r, "S0");
    expect(s0.state).toBe("done");
    expect(s0.row).toBe(1);
    expect(s0.verdict).toBe("NO-GO: LEVELS");
    expect(s0.levels).toBe(3);
    expect(s0.gSpread).toEqual(G_3);
    expect(s0.table).toBeNull();
  });
  it("3.0 row 1 LEVELS also when too few spreads are carpets at all, and when none is (no meter is needed for non-carpets)", () => {
    const four = gate0(rungJobs({ rung: "S0", carpets: [4, 6, 8, 12], dlab: { 4: 0.01, 6: 0.02, 8: 0.03, 12: 0.05 }, g: [4, 6, 8, 12], table: null, horizon: null, confirm: null }));
    expect(rungOf(four, "S0").verdict).toBe("NO-GO: LEVELS");
    expect(rungOf(four, "S0").levels).toBe(4);
    const none = gate0(rungJobs({ rung: "S0", carpets: [], dlab: {}, g: [4, 8, 12], table: null, horizon: null, confirm: null }));
    expect(rungOf(none, "S0").verdict).toBe("NO-GO: LEVELS");
    expect(rungOf(none, "S0").levels).toBe(0);
    expect(rungOf(none, "S0").bMeter).toBeNull();
  });
  it("3.0 levels is exactly 5 at the boundary (G_spread of 5 passes row 1) and the grid rule keeps 6 or more as well", () => {
    expect(rungOf(gate0(rungJobs(S0_GO)), "S0").levels).toBe(5);
  });

  it("3.0 row 2 NO-GO: EFFECT (no rate works at 2 or more of v_lo, v_mid, v_hi)", () => {
    const r = gate0(rungJobs({ ...S0_GO, table: () => ["CHURN", "CHURN", "CHURN"], horizon: null, confirm: null }));
    const s0 = rungOf(r, "S0");
    expect(s0.row).toBe(2);
    expect(s0.verdict).toBe("NO-GO: EFFECT");
    expect(s0.kappaW).toBeNull();
    expect(s0.vCal).toBeNull();
    expect(s0.horizon).toBeNull();
  });
  it("3.0 row 3 NO-GO: HORIZON (T_ctl / 4 below 50,000: the neutral control loses labels too soon)", () => {
    const r = gate0(rungJobs({ ...S0_GO, horizon: [{ LOSS: 150 }, { LOSS: 150 }, { LOSS: 150 }], confirm: null }));
    const s0 = rungOf(r, "S0");
    expect(s0.row).toBe(3);
    expect(s0.verdict).toBe("NO-GO: HORIZON");
    expect(s0.horizon).toMatchObject({ Tctl: 150_000, h0: null });
    expect(s0.horizon!.tctl).toEqual([150_000, 150_000, 150_000]);
  });
  it("3.0 row 4 NO-GO: CONFIRM (only one of the three confirmation jobs holds the cycle for the horizon)", () => {
    const r = gate0(rungJobs({ ...S0_GO, confirm: { vCal: 12, rate: 16, h0: 200_000, classes: ["DC", { LOSS: 120 }, { LOSS: 80 }] } }));
    const s0 = rungOf(r, "S0");
    expect(s0.row).toBe(4);
    expect(s0.verdict).toBe("NO-GO: CONFIRM");
    expect(s0.confirm!.nDC).toBe(1);
    expect(s0.confirm!.classes).toEqual(["DC", "LOSS", "LOSS"]);
  });
  it("3.0 row 5 needs only 2 of 3 confirmation jobs", () => {
    const r = gate0(rungJobs({ ...S0_GO, confirm: { vCal: 12, rate: 16, h0: 200_000, classes: ["DC", "DC", { LOSS: 80 }] } }));
    expect(rungOf(r, "S0").verdict).toBe("GO");
  });
  it("G0.4 h0 follows T_ctl: horizon controls lost at run steps 220,000... are infinite; a median loss at 250 censuses gives 50,000 and confirmation runs h0 steps", () => {
    // horizon jobs of 200 censuses; a loss at run census 190 gives T_ctl 190,000, below 200,000: h0 none. Use the median of 3 with one infinite
    const r = gate0(rungJobs({ ...S0_GO, horizon: [{ LOSS: 190 }, "CHURN", "CHURN"], confirm: { vCal: 12, rate: 16, h0: 200_000, classes: ["DC", "DC", "DC"] } }));
    expect(rungOf(r, "S0").horizon).toMatchObject({ Tctl: Infinity, h0: 200_000 });
  });
  it("G0.4 T_ctl is the median of the first-loss steps; EXT counts as its stop step, SPARSE and LATE as infinite, NOSTART is left out", () => {
    const base = { ...S0_GO, confirm: null };
    const med = (hz: ClassSpec[]) => rungOf(gate0(rungJobs({ ...base, horizon: hz })), "S0").horizon!.Tctl;
    expect(med([{ LOSS: 100 }, { LOSS: 160 }, { LOSS: 40 }])).toBe(100_000);
    expect(med([{ EXT: 60 }, { LOSS: 180 }, "CHURN"])).toBe(180_000);
    expect(med(["SPARSE", "LATE", { LOSS: 70 }])).toBe(Infinity);
    expect(med(["NOSTART", { LOSS: 50 }, { LOSS: 90 }])).toBe(50_000); // two usable jobs: the lower middle
  });
  it("3.0 a horizon with every control NOSTART has no T_ctl: no row covers it (exit 3)", () => {
    const r = gate0(rungJobs({ ...S0_GO, horizon: ["NOSTART", "NOSTART", "NOSTART"], confirm: null }));
    expect(r.problems.code).toBe(3);
    expect(rungOf(r, "S0").state).toBe("pending");
  });
});

describe("G0.3 the rate table: what works, kappa_w, v_cal", () => {
  const tbl = (f: (v: number, rate: number) => ClassSpec[], extra: Partial<RungScenario> = {}) => rungOf(gate0(rungJobs({ ...S0_GO, table: f, horizon: null, confirm: null, ...extra })), "S0");
  const DCs: ClassSpec[] = ["DC", "DC", "DC"];
  const none: ClassSpec[] = ["CHURN", "CHURN", "CHURN"];
  it("G0.3 kappa_w is the smallest rate that works at 2 or more of the three spreads; v_cal the median of those spreads", () => {
    const e = tbl((v, rate) => (rate === 16 ? (v === 28 ? none : DCs) : rate >= 32 ? DCs : none));
    expect(e.kappaW).toBe(16);
    expect(e.vCal).toBe(4); // works at 4 and 12: the lower middle of two
    expect(e.table!.cells.filter((c) => c.rate === 16).map((c) => c.works)).toEqual([true, true, false]);
  });
  it("G0.3 v_cal is the middle spread when kappa_w works at all three", () => {
    expect(tbl((v, rate) => (rate >= 16 ? DCs : none)).vCal).toBe(12);
  });
  it("G0.3 works at the middle and the high spread: v_cal is the lower of the two", () => {
    expect(tbl((v, rate) => (rate >= 16 && v !== 4 ? DCs : none)).vCal).toBe(12);
  });
  it("G0.3 a rate that works at only one spread is not kappa_w; a larger rate that works at two is", () => {
    const e = tbl((v, rate) => (rate === 8 ? (v === 4 ? DCs : none) : rate === 32 ? DCs : none));
    expect(e.kappaW).toBe(32);
  });
  it("G0.3 a cell works only with at least 2 of its 3 jobs DC", () => {
    const e = tbl((v, rate) => (rate >= 16 ? ["DC", "CHURN", "CHURN"] : none));
    expect(e.row).toBe(2);
    const f = tbl((v, rate) => (rate >= 16 ? ["DC", "DC", "CHURN"] : none));
    expect(f.kappaW).toBe(16);
  });
  it("G0.3 a NOSTART job is left out of the count; a MISSING-marked job counts as not DC and is listed", () => {
    const withNostart = tbl((v, rate) => (rate >= 16 ? ["DC", "DC", "NOSTART"] : none));
    expect(withNostart.kappaW).toBe(16);
    expect(withNostart.listed.some((l) => /NOSTART/.test(l))).toBe(true);
    const jobs = rungJobs({ ...S0_GO, table: (v, rate) => (rate >= 16 ? DCs : none), horizon: null, confirm: null });
    const k = jobs.findIndex((j) => j.s.stage === "g0.table" && j.s.spread === 4 && j.s.rate === 16 && j.s.seed === 402);
    jobs[k] = mkJob({ stage: "g0.table", rung: "S0", kill: "removal", seed: 402, spread: 4, rate: 16, cls: "DC", extra: { missing: true } });
    jobs[jobs.findIndex((j) => j.s.stage === "g0.table" && j.s.spread === 4 && j.s.rate === 16 && j.s.seed === 403)] = mkJob({ stage: "g0.table", rung: "S0", kill: "removal", seed: 403, spread: 4, rate: 16, cls: "CHURN" });
    const e = rungOf(evaluateGate0(jobs), "S0");
    expect(e.table!.cells.find((c) => c.spread === 4 && c.rate === 16)).toMatchObject({ nDC: 1, works: false, classes: ["DC", "MISSING", "CHURN"] });
    expect(e.listed.some((l) => /MISSING/.test(l))).toBe(true);
  });
  it("G0.3 the rate-0 jobs of the spread must be informative: a control that loses labels, or churns with a signature, makes no rate work there", () => {
    // control at every spread loses a label in all three seeds: nothing is informative, nothing works
    const lost = rungOf(gate0(rungJobs({ ...S0_GO, control: () => [{ LOSS: 5 }, { LOSS: 5 }, { LOSS: 5 }], horizon: null, confirm: null })), "S0");
    expect(lost.row).toBe(2);
    expect([...lost.controls.values()].every((c) => !c.informative)).toBe(true);
    // one spread's control is bad (v_lo): the other two still carry kappa_w
    const oneBad = rungOf(gate0(rungJobs({ ...S0_GO, control: (v) => (v === 4 ? [{ LOSS: 5 }, { LOSS: 5 }, "CHURN"] : ["CHURN", "CHURN", "CHURN"]), horizon: null, confirm: null })), "S0");
    expect(oneBad.controls.get(4)!.informative).toBe(false);
    expect(oneBad.kappaW).toBe(16);
    expect(oneBad.vCal).toBe(12); // works at 12 and 28
  });
  it("G0.3 informative needs the median |chi_fw| of the rate-0 jobs at most 0.1 (a control with a weak cyclic signature is not a control)", () => {
    const sig: RowSpec = { liv: 0.9, turnover: 0.3, ndom: 125, nanti: 75 }; // chi 0.25: class DC, below the bug bar of 0.3
    const mkSig = { custom: () => sig, nRun: 20 } as const;
    const r = gate0(rungJobs({ ...S0_GO, control: () => [mkSig, mkSig, mkSig], horizon: null, confirm: null }));
    const e = rungOf(r, "S0");
    expect(e.controls.get(12)).toMatchObject({ finished: 3, keeps: 3, informative: false });
    expect(e.controls.get(12)!.medAbsChi).toBeCloseTo(0.25, 12);
    expect(e.row).toBe(2);
    expect(r.problems.has(3)).toBe(false); // 0.25 is below the bug bar of 0.3: the spread is uninformative, not the stage broken
  });
  it("G0.3 informative needs 2 of the 3 controls alive with every label; 2 of 3 passes, 1 of 3 does not", () => {
    const two = rungOf(gate0(rungJobs({ ...S0_GO, control: () => ["CHURN", "CHURN", { LOSS: 5 }], horizon: null, confirm: null })), "S0");
    expect(two.controls.get(12)).toMatchObject({ finished: 3, keeps: 2, informative: true });
    const one = rungOf(gate0(rungJobs({ ...S0_GO, control: () => ["CHURN", { LOSS: 5 }, { LOSS: 5 }], horizon: null, confirm: null })), "S0");
    expect(one.controls.get(12)).toMatchObject({ keeps: 1, informative: false });
  });
  it("G0.2/G0.3 the seed-401 rate-0 cell is the scan job; a table-stage copy of it is accepted too and not a duplicate", () => {
    const shared = rungOf(gate0(rungJobs({ ...S0_GO, horizon: null, confirm: null })), "S0");
    const both = rungOf(gate0(rungJobs({ ...S0_GO, horizon: null, confirm: null, duplicateRate0: true })), "S0");
    expect(both.kappaW).toBe(shared.kappaW);
    expect(both.state).toBe("pending"); // horizon not run in this scenario
    expect(both.table!.cells.find((c) => c.rate === 0 && c.spread === 12)!.classes).toEqual(["CHURN", "CHURN", "CHURN"]);
  });
  it("G0.2 B_meter is the median over the carpet jobs of (B + P) per living cell, rounded; a meter that used another B is noted", () => {
    const e = rungOf(gate0(rungJobs({ ...S0_GO, massPerCell: 27.6, horizon: null, confirm: null })), "S0");
    expect(e.bMeter).toBe(28);
    const f = rungOf(gate0(rungJobs({ ...S0_GO, massPerCell: 31.4, horizon: null, confirm: null })), "S0");
    expect(f.bMeter).toBe(31);
  });
  it("G0.2 non-carpet spreads (a sparse film, an extinct one) are not in the grid", () => {
    const e = rungOf(gate0(rungJobs({ ...S0_GO, horizon: null, confirm: null })), "S0");
    expect(e.scan.filter((x) => !x.carpet).map((x) => x.spread)).toEqual([2, 3, 32]);
    expect(e.gSpread.every((v) => e.scan.find((x) => x.spread === v)!.carpet)).toBe(true);
    expect(CANDIDATE_SPREADS).toHaveLength(12);
  });
  it("G0.2 carpet needs liv >= 0.50 at every run census, not just the last: a dip below 0.5 once makes a spread a non-carpet", () => {
    const dip = rungJobs({ ...S0_GO, horizon: null, confirm: null });
    const k = dip.findIndex((j) => j.s.stage === "g0.scan" && j.s.spread === 12);
    const rows = rowsOf("CHURN", 20);
    rows.run[9] = { ...rows.run[9], liv: 0.45 };
    dip[k] = mkJob({ stage: "g0.scan", rung: "S0", kill: "removal", seed: 401, spread: 12, rate: 0, rows });
    const e = rungOf(evaluateGate0(dip), "S0");
    expect(e.scan.find((x) => x.spread === 12)!.carpet).toBe(false);
    expect(e.gSpread).not.toContain(12);
  });
});

describe("3.0 incomplete rungs are exit 4, named by what to run next", () => {
  it("3.0 missing scan jobs: the rung is pending and lists them", () => {
    const r = gate0(rungJobs({ ...S0_GO, noScan: [6, 16], table: null, horizon: null, confirm: null }));
    const s0 = rungOf(r, "S0");
    expect(s0.state).toBe("pending");
    expect(s0.missing).toEqual(["g0.scan S0 spread 6 seed 401", "g0.scan S0 spread 16 seed 401"]);
    expect(r.overall.status).toBe("pending");
    expect(r.problems.code).toBe(4); // jobs still to run
    expect(r.problems.list[0].message).toMatch(/Gate 0 is incomplete: rung S0 has 2 jobs to run \(g0\.scan S0 spread 6 seed 401; g0\.scan S0 spread 16 seed 401\)/);
  });
  it("3.0 missing meter jobs of a carpet spread: pending", () => {
    const s0 = rungOf(gate0(rungJobs({ ...S0_GO, noMeter: [12], table: null, horizon: null, confirm: null })), "S0");
    expect(s0.state).toBe("pending");
    expect(s0.missing[0]).toMatch(/g0\.meter S0 spread 12/);
  });
  it("3.0 (G0.2) a MISSING meter job of a carpet spread leaves it without D_lab: exit 3 naming the marker, not an exit 4 that no driver can clear (final review, own-3)", () => {
    const marker = (axis: "x" | "y"): Job => {
      const id = `g0.meter-S0-sp12-${axis}`;
      const raw = { id, stage: "g0.meter", rung: "S0", kill: "removal", seed: 405, spread: 12, shape: [128, 128, 4], missing: true, status: "missing", stop: "missing", attempts: 2 };
      return { s: normalizeSummary(raw, id), rows: null, censusText: null, finalPath: null, dir: null } as Job;
    };
    const r = gate0(rungJobs({ ...S0_GO, noMeter: [12], table: null, horizon: null, confirm: null }), [marker("x"), marker("y")]);
    const s0 = rungOf(r, "S0");
    expect(s0.state).toBe("pending");
    expect(r.problems.code).toBe(3);
    expect(r.problems.list.map((p) => p.message).join()).toMatch(/g0\.meter-S0-sp12-x, g0\.meter-S0-sp12-y: the meter job of carpet spread 12 is MISSING \(failed twice\), so D_lab is unavailable for it; no row of 3\.0 covers that/);
    expect(s0.missing.join()).toMatch(/g0\.meter S0 spread 12 .*a MISSING marker is there, not to be rerun/);
    // a marker for a spread that is no carpet changes nothing (the grid rule looks at the carpet spreads only)
    const sparse = gate0(rungJobs({ ...S0_GO, table: null, horizon: null, confirm: null }), [{ ...marker("x"), s: { ...marker("x").s, spread: 2, id: "g0.meter-S0-sp2-x" } }]);
    expect(sparse.problems.code).toBe(4);
  });
  it("3.0 a rung that passed row 1 with no table yet: pending, listing the 42 table jobs (seed-401 rate-0 cells are the scan jobs)", () => {
    const s0 = rungOf(gate0(rungJobs({ ...S0_GO, table: null, horizon: null, confirm: null })), "S0");
    expect(s0.state).toBe("pending");
    expect(s0.levels).toBe(5);
    expect(s0.missing).toHaveLength(42);
  });
  it("3.0 horizon and confirmation jobs missing: pending, and the later stage is not asked for before the earlier passes", () => {
    const noHorizon = rungOf(gate0(rungJobs({ ...S0_GO, horizon: null, confirm: null })), "S0");
    expect(noHorizon.missing).toHaveLength(3);
    expect(noHorizon.missing[0]).toMatch(/g0\.horizon S0 spread 12 rate 0 seed 401/);
    const noConfirm = rungOf(gate0(rungJobs({ ...S0_GO, confirm: null })), "S0");
    expect(noConfirm.missing).toHaveLength(3);
    expect(noConfirm.missing[0]).toMatch(/g0\.confirm S0 spread 12 rate 16 seed 401/);
  });
  it("3.0 a Gate-0 job without rung, kill, spread or rate is unusable input", () => {
    const jobs = rungJobs(S0_GO);
    jobs[0].s.rate = null;
    expect(evaluateGate0(jobs).problems.code).toBe(2);
  });
  it("3.0 a job run for the wrong length is unusable input", () => {
    const jobs = rungJobs(S0_GO);
    const k = jobs.findIndex((j) => j.s.stage === "g0.table");
    jobs[k] = mkJob({ stage: "g0.table", rung: "S0", kill: "removal", seed: jobs[k].s.seed, spread: jobs[k].s.spread!, rate: jobs[k].s.rate!, nRun: 30, cls: "DC" });
    expect(evaluateGate0(jobs).problems.code).toBe(2);
  });
  void S1_NONE;
});

// ---- several rungs: the order S0, S1, S2, V; rung V; the V check; GATE-0-STOP ----

const NONE: ClassSpec[] = ["CHURN", "CHURN", "CHURN"];
const DC3: ClassSpec[] = ["DC", "DC", "DC"];
const goOf = (rung: "S0" | "S1" | "S2"): RungScenario => ({ ...S0_GO, rung });
const effectOf = (rung: "S0" | "S1" | "S2", withHorizon = false): RungScenario => ({ ...S0_GO, rung, table: () => NONE, horizon: withHorizon ? NONE : null, confirm: null });
const levelsOf = (rung: "S0" | "S1" | "S2"): RungScenario => ({ rung, carpets: CARPETS_3, dlab: DLAB_3, g: G_3, table: null, horizon: null, confirm: null });
const horizonFail = (rung: "S0" | "S1" | "S2"): RungScenario => ({ ...S0_GO, rung, horizon: [{ LOSS: 150 }, { LOSS: 150 }, { LOSS: 150 }], confirm: null });
const V_GO: VScenario = { host: "S0", g: G_5, confirm: { vCal: 12, rate: 256, h0: 200_000, classes: DC3 } };

describe("3.0 D2: S0 and S1 as written; the rung used is the first of S0, S1, S2, V with GO", () => {
  it("3.0 S0 GO and S1 GO: S0 is used", () => {
    const r = gate0(rungJobs(goOf("S0")), rungJobs(goOf("S1")));
    expect(rungOf(r, "S0").verdict).toBe("GO");
    expect(rungOf(r, "S1").verdict).toBe("GO");
    expect(r.overall).toEqual({ status: "go", used: "S0" });
    expect(r.operatingPoint!.rung).toBe("S0");
  });
  it("3.0 kappa_w is the smallest rate of the grid that works at 2 or more of the three spreads: 8, the smallest, counts like the others (conformance F11, g84)", () => {
    const r = gate0(rungJobs({ ...S0_GO, table: (_v, rate) => (rate >= 8 ? DC3 : NONE), confirm: { vCal: 12, rate: 8, h0: 200_000, classes: DC3 } }));
    const s0 = rungOf(r, "S0");
    expect(s0.kappaW).toBe(8);
    expect(s0.vCal).toBe(12);
    expect(s0.verdict).toBe("GO");
    expect(r.operatingPoint).toMatchObject({ kappaW: 8, vCal: 12, rCal: [4, 8, 16, 32] });
    // a rate that works at one spread only is not kappa_w: 8 works at v_lo alone, 16 at all three
    const one = gate0(rungJobs({ ...S0_GO, table: (v, rate) => (rate >= 16 || (rate === 8 && v === 4) ? DC3 : NONE) }));
    expect(rungOf(one, "S0").kappaW).toBe(16);
    // at two spreads of three it does count, and v_cal is the median (lower middle) of the two
    const two = gate0(rungJobs({ ...S0_GO, table: (v, rate) => (rate >= 16 || (rate === 8 && v !== 12) ? DC3 : NONE), confirm: { vCal: 4, rate: 8, h0: 200_000, classes: DC3 } }));
    expect(rungOf(two, "S0").kappaW).toBe(8);
    expect(rungOf(two, "S0").vCal).toBe(4); // works at 4 and 28: the lower of the two middle values
  });
  it("3.0 S0 NO-GO: EFFECT and S1 GO: S1 is used", () => {
    const r = gate0(rungJobs(effectOf("S0")), rungJobs(goOf("S1")));
    expect(rungOf(r, "S0").verdict).toBe("NO-GO: EFFECT");
    expect(r.overall).toEqual({ status: "go", used: "S1" });
    expect(r.operatingPoint).toMatchObject({ rung: "S1", substrate: "S1", kill: "removal" });
  });
  it("3.0 S0 not finished (jobs still to run): the answer waits for S0 even though S1 is GO", () => {
    const r = gate0(rungJobs({ ...goOf("S0"), noScan: [6] }), rungJobs(goOf("S1")));
    expect(rungOf(r, "S0").state).toBe("pending");
    expect(r.overall).toEqual({ status: "pending", waitingFor: ["S0"] });
    expect(r.operatingPoint).toBeNull();
  });
  it("3.0 S1 not run yet and S0 NO-GO: pending", () => {
    const r = gate0(rungJobs(effectOf("S0")));
    expect(r.overall.status).toBe("pending");
    expect(r.rungs.map((x) => x.rung)).toContain("S1");
  });
  it("3.0 S2 is run only if S0 and S1 both end NO-GO: LEVELS; then it can give GO", () => {
    const r = gate0(rungJobs(levelsOf("S0")), rungJobs(levelsOf("S1")), rungJobs(goOf("S2")));
    expect(rungOf(r, "S2").verdict).toBe("GO");
    expect(r.overall).toEqual({ status: "go", used: "S2" });
    expect(r.operatingPoint).toMatchObject({ rung: "S2", substrate: "S2" });
  });
  it("3.0 S2 jobs when S0 and S1 are LEVELS and S2 has not run: pending for S2", () => {
    const r = gate0(rungJobs(levelsOf("S0")), rungJobs(levelsOf("S1")));
    expect(r.overall).toEqual({ status: "pending", waitingFor: ["S2"] });
  });
  it("3.0 S2 jobs are ignored (with a note) when S1 did not end NO-GO: LEVELS", () => {
    const r = gate0(rungJobs(levelsOf("S0")), rungJobs(goOf("S1")), rungJobs(goOf("S2")));
    expect(r.rungs.map((x) => x.rung)).not.toContain("S2");
    expect(r.overall).toEqual({ status: "go", used: "S1" });
    expect(r.notes.join()).toMatch(/S2 jobs are present/);
  });
  it("3.0 S0 LEVELS, S1 EFFECT: S2 is not run (S2 answers a LEVELS failure of both)", () => {
    const r = gate0(rungJobs(levelsOf("S0")), rungJobs(effectOf("S1")));
    expect(r.rungs.map((x) => x.rung)).not.toContain("S2");
  });
});

// decision O-8: Gate 0 takes the rungs in the order S0, S1, S2, V and stops when the highest-preference rung not yet excluded gives GO;
// the rungs after it are not run, and the overall verdict stays pending until that holds or every rung is excluded
describe("3.0 (O-8) the rungs in preference order: S0 GO stops, S0 NO-GO then S1 GO stops before V's own rows, S0 and S1 excluded runs V", () => {
  it("S0 GO stops: S1 and V were never run, the answer is S0 (exit 0), and the rungs after it are marked as not run, not as jobs to run", () => {
    const r = gate0(rungJobs(goOf("S0")));
    expect(r.overall).toEqual({ status: "go", used: "S0" });
    expect(r.problems.code).toBe(0);
    expect(r.rungs.map((e) => [e.rung, e.state, e.notRun])).toEqual([["S0", "done", null], ["S1", "pending", "S0"], ["V", "pending", "S0"]]);
    expect(r.operatingPoint).toMatchObject({ rung: "S0" });
  });
  it("S0 GO stops even when S1 and V jobs are on disk part way: they are not waited for, and a finished S1 is not the rung used", () => {
    const part = rungJobs({ ...goOf("S1"), confirm: null, horizon: null });
    const r = gate0(rungJobs(goOf("S0")), part);
    expect(r.overall).toEqual({ status: "go", used: "S0" });
    expect(rungOf(r, "S1").notRun).toBe("S0");
    expect(r.problems.code).toBe(0);
  });
  it("S0 NO-GO then S1 GO stops before V's own rows: the answer is S1 and V (whose host S0 passed row 1) is not run", () => {
    const r = gate0(rungJobs(effectOf("S0", true)), rungJobs(goOf("S1")));
    expect(rungOf(r, "S0").verdict).toBe("NO-GO: EFFECT");
    expect(r.overall).toEqual({ status: "go", used: "S1" });
    expect(r.problems.code).toBe(0);
    const v = rungOf(r, "V");
    expect([v.state, v.notRun, v.substrate]).toEqual(["pending", "S1", "S0"]);
    // its 36 table jobs and the V check are not asked for
    expect(v.missing.length).toBeGreaterThan(0);
    expect(r.operatingPoint).toMatchObject({ rung: "S1", kill: "removal" });
  });
  it("a rung ahead of a GO that has jobs to run holds the answer: the overall verdict is pending and names that rung only, not the rungs after the GO", () => {
    // S0 has its horizon and confirmation to run, S1 is GO, and V (host S0) is not needed whatever S0 does
    const r = gate0(rungJobs({ ...goOf("S0"), horizon: null, confirm: null }), rungJobs(goOf("S1")));
    expect(rungOf(r, "S0").state).toBe("pending");
    expect(rungOf(r, "S1").verdict).toBe("GO");
    expect(r.overall).toEqual({ status: "pending", waitingFor: ["S0"] });
    expect(rungOf(r, "V").notRun).toBe("S1");
    expect(r.operatingPoint).toBeNull();
    expect(r.problems.code).toBe(4);
    expect(r.problems.list.filter((p) => p.code === 4).map((p) => p.message)).toEqual([expect.stringMatching(/rung S0 has \d+ jobs? to run/)]);
  });
  it("S0 and S1 excluded runs V: the answer waits for V's own rows, then V is used", () => {
    const before = gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")));
    expect(before.overall).toEqual({ status: "pending", waitingFor: ["V"] });
    expect(rungOf(before, "V").notRun).toBeNull();
    expect(rungOf(before, "V").missing).toHaveLength(36);
    const after = gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")), vJobs(V_GO));
    expect(after.overall).toEqual({ status: "go", used: "V" });
    expect(rungOf(after, "V").notRun).toBeNull();
  });
  it("every rung excluded: GATE-0-STOP, and no rung is marked as not run", () => {
    const r = gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")), vJobs({ ...V_GO, table: () => NONE, confirm: null }));
    expect(r.overall.status).toBe("stop");
    expect(r.rungs.every((e) => e.notRun === null)).toBe(true);
  });
  it("a GO that is not the answer is flagged on its rung, in the output: provisional while a rung ahead of it is pending, 'not the rung used' behind a GO", () => {
    const pending = cli(["gate0", "--jobs", "/jobs", "--draft"], { ...DRAFT_FILE, ...filesOf([...rungJobs({ ...goOf("S0"), noScan: [6] }), ...rungJobs(goOf("S1"))]) });
    expect(pending.code).toBe(4);
    expect(pending.out).not.toMatch(/\*\*GO:/);
    expect(pending.out).toMatch(/\*\*pending\*\*: waiting for rung S0/);
    expect(pending.out).toMatch(/### Rung S1: GO \(row 5\)/);
    expect(pending.out).toMatch(/provisional: rung S0 comes first in the order and still has jobs to run, so this GO is not the answer yet/);
    const both = cli(["gate0", "--jobs", "/jobs", "--draft"], { ...DRAFT_FILE, ...filesOf([...rungJobs(goOf("S0")), ...rungJobs(goOf("S1"))]) });
    expect(both.code).toBe(0);
    expect(both.out).toMatch(/\*\*GO: rung S0\*\*/);
    expect(both.out).toMatch(/not the rung used: rung S0 comes first in the order/);
  });
  it("a GO line is never printed as final while a higher-preference rung is pending: S0 and S1 pending, S2 and V in no state to answer", () => {
    for (const jobs of [
      [...rungJobs({ ...goOf("S0"), noScan: [6] }), ...rungJobs(goOf("S1"))],
      [...rungJobs({ ...goOf("S0"), horizon: null, confirm: null }), ...rungJobs(goOf("S1"))],
      [...rungJobs(effectOf("S0", true)), ...rungJobs({ ...goOf("S1"), confirm: null })],
      [...rungJobs(effectOf("S0", true)), ...rungJobs(effectOf("S1")), ...vJobs(V_GO).filter((j) => j.s.stage !== "g0.confirm")],
      [...rungJobs(levelsOf("S0")), ...rungJobs(levelsOf("S1")), ...rungJobs({ ...goOf("S2"), confirm: null })],
    ]) {
      const r = cli(["gate0", "--jobs", "/jobs", "--draft"], { ...DRAFT_FILE, ...filesOf(jobs) });
      expect(r.out, r.out).not.toMatch(/\*\*GO: rung/);
      expect(r.out).toMatch(/\*\*pending\*\*/);
      expect(r.code).toBe(4);
    }
  });
});

describe("3.0 rung V: the vacancy kill on the substrate of the first rung that passes row 1", () => {
  const withV = (v: VScenario = V_GO, host = effectOf("S0", true), s1 = effectOf("S1")) => gate0(rungJobs(host), rungJobs(s1), vJobs(v));

  it("3.0 V row 5 GO: judged from row 2 on the host's G_spread, with the host's rate-0 jobs; it is used when S0, S1 (and S2) are NO-GO", () => {
    const r = withV();
    const v = rungOf(r, "V");
    expect(v.state).toBe("done");
    expect(v.verdict).toBe("GO");
    expect(v.substrate).toBe("S0");
    expect(v.kill).toBe("vacancy");
    expect(v.levels).toBe(5); // the host's
    expect(v.gSpread).toEqual(G_5);
    expect(v.kappaW).toBe(256);
    expect(v.vCal).toBe(12);
    expect(v.table!.rates).toEqual([0, 64, 256, 1024, 4096]);
    // the rate-0 cells are the host's jobs
    expect(v.table!.cells.filter((c) => c.rate === 0)).toEqual(rungOf(r, "S0").table!.cells.filter((c) => c.rate === 0));
    expect(v.table!.cells.filter((c) => c.rate > 0)).toHaveLength(12);
    expect(v.horizon).toMatchObject({ spread: 12, Tctl: Infinity, h0: 200_000 }); // the horizon jobs are the host's, run once
    expect(r.overall).toEqual({ status: "go", used: "V" });
    expect(r.operatingPoint).toMatchObject({ rung: "V", kill: "vacancy", substrate: "S0", gSpread: G_5, vCal: 12, kappaW: 256, rCal: [128, 256, 512, 1024], h0: 200_000 });
    expect(r.vcheck.state).toBe("identical");
    expect(r.problems.code).toBe(0);
  });
  it("3.0 V's rate grid is {0, 64, 256, 1024, 4096}: V's nonzero table jobs are 4 rates x 3 spreads x 3 seeds = 36", () => {
    const jobs = vJobs(V_GO).filter((j) => j.s.stage === "g0.table");
    expect(jobs).toHaveLength(36);
    expect(new Set(jobs.map((j) => j.s.rate))).toEqual(new Set([64, 256, 1024, 4096]));
  });
  it("3.0 V's R_cal is capped at 16,384 (kappa_w 4096 gives {2048, 4096, 8192, 16384})", () => {
    const r = withV({ ...V_GO, table: (_v, rate) => (rate === 4096 ? DC3 : NONE), confirm: { vCal: 12, rate: 4096, h0: 200_000, classes: DC3 } });
    expect(r.operatingPoint!.rCal).toEqual([2048, 4096, 8192, 16384]);
  });
  it("3.0 V row 2 NO-GO: EFFECT (no vacancy rate works at 2 or more spreads)", () => {
    const r = withV({ ...V_GO, table: () => NONE, confirm: null });
    const v = rungOf(r, "V");
    expect(v.row).toBe(2);
    expect(v.verdict).toBe("NO-GO: EFFECT");
    expect(r.overall).toEqual({ status: "stop", onlyHorizon: false, horizonRung: null });
  });
  it("3.0 V row 3 NO-GO: HORIZON uses the host's horizon jobs (the shared G0.4)", () => {
    const r = withV(V_GO, { ...effectOf("S0"), horizon: [{ LOSS: 150 }, { LOSS: 150 }, { LOSS: 150 }] });
    const v = rungOf(r, "V");
    expect(v.row).toBe(3);
    expect(v.verdict).toBe("NO-GO: HORIZON");
    expect(v.horizon).toMatchObject({ Tctl: 150_000, h0: null });
  });
  it("3.0 V row 4 NO-GO: CONFIRM uses V's own confirmation jobs", () => {
    const r = withV({ ...V_GO, confirm: { vCal: 12, rate: 256, h0: 200_000, classes: ["DC", { LOSS: 100 }, { LOSS: 100 }] } });
    expect(rungOf(r, "V").row).toBe(4);
    expect(rungOf(r, "V").verdict).toBe("NO-GO: CONFIRM");
  });
  it("3.0 V's own table jobs are asked for once the host passed row 1; V waits for the host's table and horizon jobs", () => {
    const noV = gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")));
    expect(rungOf(noV, "V").state).toBe("pending");
    expect(rungOf(noV, "V").missing).toHaveLength(36);
    expect(noV.overall).toEqual({ status: "pending", waitingFor: ["V"] });
    const noHorizon = gate0(rungJobs(effectOf("S0", false)), rungJobs(effectOf("S1")), vJobs(V_GO));
    expect(rungOf(noHorizon, "V").missing[0]).toMatch(/g0\.horizon S0/);
  });
  it("3.0 the host is the first of S0, S1, S2 that passes row 1: S0 LEVELS, S1 passes -> V runs on S1", () => {
    const r = gate0(rungJobs(levelsOf("S0")), rungJobs(effectOf("S1", true)), vJobs({ ...V_GO, host: "S1" }));
    expect(rungOf(r, "V").substrate).toBe("S1");
    expect(rungOf(r, "V").verdict).toBe("GO");
    expect(r.operatingPoint).toMatchObject({ rung: "V", substrate: "S1" });
  });
  it("3.0 the order: S0 GO beats V GO; V is used only when S0, S1 (and S2 if run) are NO-GO", () => {
    const r = gate0(rungJobs(goOf("S0")), rungJobs(effectOf("S1")), vJobs(V_GO));
    expect(rungOf(r, "V").verdict).toBe("GO");
    expect(r.overall).toEqual({ status: "go", used: "S0" });
    const r1 = gate0(rungJobs(effectOf("S0", true)), rungJobs(goOf("S1")), vJobs(V_GO));
    expect(r1.overall).toEqual({ status: "go", used: "S1" });
  });
  it("3.0 V jobs on a substrate other than the first to pass row 1 are no row's case (exit 3)", () => {
    const r = withV({ ...V_GO, substrate: "S1" });
    expect(r.problems.code).toBe(3);
    expect(r.problems.list.map((p) => p.message).join()).toMatch(/V ran on S1/);
  });
  it("3.0 V jobs but no substrate rung with levels >= 5: no row covers it (exit 3)", () => {
    const r = gate0(rungJobs(levelsOf("S0")), rungJobs(levelsOf("S1")), rungJobs(levelsOf("S2")), vJobs(V_GO));
    expect(r.problems.code).toBe(3);
    expect(r.problems.list.map((p) => p.message).join()).toMatch(/no substrate rung passed row 1/);
    expect(r.overall.status).toBe("stop");
  });
});

describe("G0.1 the V check (8.4)", () => {
  it("G0.1 identical census files for the V build and the removal build of one rate-0 job: recorded, no problem", () => {
    const r = gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")), vJobs({ ...V_GO, vcheck: "identical" }));
    expect(r.vcheck.state).toBe("identical");
    expect(r.problems.code).toBe(0);
  });
  it("G0.1/8.4 files that differ are a bug in the V switch: exit 3, and no V job counts", () => {
    const r = gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")), vJobs({ ...V_GO, vcheck: "different" }));
    expect(r.vcheck.state).toBe("different");
    expect(r.problems.code).toBe(3);
    expect(r.problems.list.map((p) => p.message).join()).toMatch(/V check failed/);
  });
  it("G0.1/8.4 a V check that is absent when V was run is a bug indicator (exit 3)", () => {
    const r = gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")), vJobs({ ...V_GO, vcheck: "absent" }));
    expect(r.vcheck.state).toBe("absent");
    expect(r.problems.code).toBe(3);
  });
  it("G0.1/8.4 only one of the two builds is also a bug indicator when V was run", () => {
    const r = gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")), vJobs({ ...V_GO, vcheck: "half" }));
    expect(r.vcheck.state).toBe("incomplete");
    expect(r.problems.code).toBe(3);
  });
  it("G0.1 no V jobs and no V check: nothing to report", () => {
    const r = gate0(rungJobs(goOf("S0")));
    expect(r.vcheck.state).toBe("absent");
    expect(r.problems.code).toBe(0);
  });
  it("G0.1 vCheckOf compares the raw census text byte for byte", () => {
    const pr = new Problems();
    const a = vJobs({ ...V_GO, vcheck: "identical" }).filter((j) => j.s.stage === "g0.vcheck");
    expect(vCheckOf(a, true, pr).state).toBe("identical");
    a[0] = { ...a[0], censusText: a[0].censusText + " " };
    expect(vCheckOf(a, true, new Problems()).state).toBe("different");
  });
});

describe("G0.1/8.4 no V job counts when the V check is not identical (conformance F9)", () => {
  const onlyV = (vcheck: "identical" | "different" | "absent" | "half") => gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")), vJobs({ ...V_GO, vcheck }));
  it("an identical check: V counts and is used when S0 and S1 are NO-GO", () => {
    const r = onlyV("identical");
    expect(rungOf(r, "V").voided).toBe(false);
    expect(r.overall).toEqual({ status: "go", used: "V" });
    expect(r.operatingPoint).toMatchObject({ rung: "V" });
  });
  for (const mode of ["different", "absent", "half"] as const) {
    it(`a ${mode} check: V's verdict is printed and flagged void, it never decides, there is no operating point, and the exit code is 3`, () => {
      const r = onlyV(mode);
      const v = rungOf(r, "V");
      expect(v.verdict).toBe("GO");
      expect(v.voided).toBe(true);
      expect(r.overall).toEqual({ status: "stop", onlyHorizon: false, horizonRung: null });
      expect(r.operatingPoint).toBeNull();
      expect(r.problems.code).toBe(3);
    });
  }
  it("a failed check does not take away a GO of S0: S0 is still the rung used (exit 3 asks the main session to look)", () => {
    const r = gate0(rungJobs(goOf("S0")), rungJobs(effectOf("S1")), vJobs({ ...V_GO, vcheck: "different" }));
    expect(r.overall).toEqual({ status: "go", used: "S0" });
    expect(rungOf(r, "V").voided).toBe(true);
    expect(r.problems.code).toBe(3);
  });
  it("a void V is not waited for: S0 and S1 NO-GO and V void is a stop, not 'pending for V'", () => {
    const r = onlyV("different");
    expect(r.overall.status).toBe("stop");
  });
  it("the two V-check jobs alone (V's table not yet run) are not 'V was run': one build is only a check still to finish, not a bug indicator", () => {
    const check = vJobs({ ...V_GO, vcheck: "half" }).filter((j) => j.s.stage === "g0.vcheck");
    const r = gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")), check);
    expect(r.vcheck.state).toBe("incomplete");
    expect(rungOf(r, "V").voided).toBe(false);
    expect(r.problems.list.map((p) => p.message).join()).not.toMatch(/rung V was run/);
    expect(r.problems.code).toBe(4);
  });
  it("no V jobs at all: nothing to void", () => {
    const r = gate0(rungJobs(goOf("S0")));
    expect(r.rungs.every((e) => !e.voided)).toBe(true);
  });
});

describe("3.0/4.1/5 the settings of the jobs are checked against the rules (conformance F13, Codex finding 10)", () => {
  const msgs = (r: { problems: Problems }) => r.problems.list.map((p) => p.message).join(" | ");
  const patched = (patch: Record<string, unknown>, pred: (j: Job) => boolean = (j) => j.s.stage === "g0.table") => {
    const jobs = rungJobs(S0_GO);
    Object.assign(jobs.find(pred)!.s, patch);
    return evaluateGate0(jobs);
  };
  it("a Gate-0 job with mutRate above 0, rpsTypes other than 3 or K0 other than 3 is unusable input", () => {
    expect(evaluateGate0(rungJobs(S0_GO)).problems.code).toBe(0);
    expect(patched({ mutRate: 5 }).problems.code).toBe(2);
    expect(msgs(patched({ mutRate: 5 }))).toMatch(/mutRate is 5, but Gate 0 runs with 0/);
    expect(msgs(patched({ types: 5 }))).toMatch(/rpsTypes is 5, but Gate 0 runs with 3/);
    expect(msgs(patched({ K0: 4 }))).toMatch(/K0 is 4, but Gate 0 runs with 3/);
  });
  it("a meter job with mutation is unusable input too", () => {
    const jobs = rungJobs(S0_GO);
    Object.assign(jobs.find((j) => j.s.stage === "g0.meter")!.s, { mutRate: 7 });
    expect(evaluateGate0(jobs).problems.code).toBe(2);
  });
  it("a rung-V job built with the removal kill is unusable input", () => {
    const v = vJobs(V_GO);
    v.find((j) => j.s.stage === "g0.table")!.s.kill = "removal";
    const r = gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")), v);
    expect(msgs(r)).toMatch(/rung V is the vacancy kill, but the job is built with the removal kill/);
    expect(r.problems.code).toBe(2);
  });
  it("a nonzero-rate job of a substrate rung built with the vacancy kill is unusable input; a shared rate-0 job may carry either kill", () => {
    const jobs = rungJobs(S0_GO);
    jobs.find((j) => j.s.stage === "g0.table" && j.s.rate! > 0)!.s.kill = "vacancy";
    expect(msgs(evaluateGate0(jobs))).toMatch(/rung S0 is the removal kill, but the job \(rate \d+\) is built with the vacancy kill/);
    const rate0 = rungJobs(S0_GO);
    rate0.find((j) => j.s.stage === "g0.scan")!.s.kill = "vacancy";
    expect(evaluateGate0(rate0).problems.code).toBe(0);
  });
  it("a calibration, sweep or cycles job with the wrong settings is unusable input", () => {
    const cal = calibrationJobs({ 8: ["CHURN", "CHURN"], 16: ["DC", "DC"], 32: ["DC", "DC"], 64: ["DC", "DC"] });
    Object.assign(cal[2].s, { mutRate: 3 });
    expect(evaluateCalibration(cal, OP).problems.code).toBe(2);
    const sw = sweepJobs({ 4: { treat: five("DC") } });
    Object.assign(sw[0].s, { types: 5 });
    expect(msgs(evaluateSweep(sw, OP))).toMatch(/rpsTypes is 5, but the sweep \(4\.1\) runs with 3/);
    const cy = mkJob({ stage: "cycles", seed: 241, spread: 4, rate: 32, K0: 4, types: 3, nRun: 50, cls: "DC" });
    expect(msgs(evaluateCycles([cy], evaluateSweep(sweepJobs({ 4: { treat: five("DC") }, 8: { treat: five("DC") }, 12: { treat: five("DC") }, 20: { treat: five("DC") }, 28: { treat: five({ LOSS: 5 }) } }), OP)))).toMatch(/rpsTypes is 3, but longer cycles \(5\) runs with 4/);
  });
});

describe("3.0 GATE-0-STOP and the horizon rung", () => {
  const confirmFail = (rung: "S0" | "S1"): RungScenario => ({ ...S0_GO, rung, confirm: { vCal: 12, rate: 16, h0: 200_000, classes: [{ LOSS: 100 }, { LOSS: 100 }, { LOSS: 100 }] } });
  const vEffect = (host: "S0" | "S1" = "S0") => vJobs({ ...V_GO, host, table: () => NONE, confirm: null });
  it("3.0 GATE-0-STOP when every rung ends NO-GO for mixed reasons: a verdict (exit 0); no further rung is pre-registered", () => {
    // S0 failed at row 4 (CONFIRM) and S1 at row 3 (HORIZON): a rung that passed rows 1 and 2 did not fail at row 3 only, so no horizon rung
    const r = gate0(rungJobs(confirmFail("S0")), rungJobs(horizonFail("S1")), vEffect());
    expect(r.rungs.map((x) => x.verdict)).toEqual(["NO-GO: CONFIRM", "NO-GO: HORIZON", "NO-GO: EFFECT"]);
    expect(r.overall).toEqual({ status: "stop", onlyHorizon: false, horizonRung: null });
    expect(r.problems.code).toBe(0);
    expect(r.operatingPoint).toBeNull();
  });
  it("3.0 GATE-0-STOP when no rung reached row 3 (LEVELS and EFFECT only): no horizon rung", () => {
    const r = gate0(rungJobs(levelsOf("S0")), rungJobs(levelsOf("S1")), rungJobs(levelsOf("S2")));
    expect(r.overall).toEqual({ status: "stop", onlyHorizon: false, horizonRung: null });
    const e = gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")), vEffect());
    expect(e.overall).toEqual({ status: "stop", onlyHorizon: false, horizonRung: null });
    expect(e.problems.code).toBe(0);
  });
  it("3.0 GATE-0-STOP with only HORIZON failures: the horizon rung (256 x 256 x 4, G0.4 alone) is due at the first such rung, and is exit 4 until it has run", () => {
    const hz = (rung: "S0" | "S1") => horizonFail(rung);
    const r = gate0(rungJobs(hz("S0")), rungJobs(hz("S1")), vJobs({ ...V_GO, host: "S0" }));
    expect(r.rungs.map((x) => x.verdict)).toEqual(["NO-GO: HORIZON", "NO-GO: HORIZON", "NO-GO: HORIZON"]);
    expect(r.overall.status).toBe("stop");
    if (r.overall.status !== "stop") throw new Error();
    expect(r.overall.onlyHorizon).toBe(true);
    expect(r.overall.horizonRung).toMatchObject({ rung: "S0", state: "pending" });
    expect(r.overall.horizonRung!.missing).toHaveLength(3);
    expect(r.problems.code).toBe(4);
  });
  it("3.0 the horizon rung is diagnostic only: after its G0.4 jobs Gate 0 remains GATE-0-STOP and the readout exits 0, whatever the jobs say (final review, finding 5)", () => {
    const hzJobs = (cls: ClassSpec) => TABLE_SEEDS3.map((sd) => mkJob({ stage: "g0.horizon-rung", rung: "S0", kill: "removal", seed: sd, spread: 12, rate: 0, nRun: 200, cls }));
    // the larger controls keep every label (T_ctl infinite, h0 200,000): the case that used to have no row; and controls that lose them early (h0 none)
    for (const [cls, want] of [["CHURN", { Tctl: Infinity, h0: 200_000 }], [{ LOSS: 100 }, { Tctl: 100_000, h0: null }]] as const) {
      const r = gate0(rungJobs(horizonFail("S0")), rungJobs(horizonFail("S1")), vJobs(V_GO), hzJobs(cls));
      if (r.overall.status !== "stop") throw new Error(JSON.stringify(r.overall));
      expect(r.overall.onlyHorizon).toBe(true);
      expect(r.overall.horizonRung).toMatchObject({ rung: "S0", state: "done" });
      expect(r.overall.horizonRung!.horizon).toMatchObject(want);
      expect(r.problems.code).toBe(0);
      expect(r.operatingPoint).toBeNull();
    }
    // through the command line: the table says GATE-0-STOP and that the horizon rung is a diagnostic, and the exit code is 0 (a verdict)
    const cl = cli(["gate0", "--jobs", "/jobs"], { ...frozen(), ...filesOf([...rungJobs(horizonFail("S0")), ...rungJobs(horizonFail("S1")), ...vJobs(V_GO), ...hzJobs("CHURN")]) });
    expect(cl.code).toBe(0);
    expect(cl.out).toMatch(/\*\*GATE-0-STOP\*\*: the only failures were HORIZON/);
    expect(cl.out).toMatch(/horizon rung \(rung S0, 256 x 256 x 4\): T_ctl inf, h0 200000; diagnostic only \(3\.0\): GATE-0-STOP stands whatever this says/);
    expect(cl.out).not.toMatch(/operating point \(for the Gate-0 record\)/);
  });
  it("3.0 the horizon rung is not run on S2, nor on V when V ran on S2: its founding at 256 x 256 x 4 exceeds the kernel's matter bound; GATE-0-STOP stands and no jobs are asked for (final review, finding 6)", () => {
    // S0 and S1 end LEVELS, so S2 runs and V runs on S2 (the first rung to pass row 1)
    const onS2 = (s2: RungScenario, v: VScenario) => gate0(rungJobs(levelsOf("S0")), rungJobs(levelsOf("S1")), rungJobs(s2), vJobs(v));
    const hz = onS2(horizonFail("S2"), { ...V_GO, host: "S2", table: () => NONE, confirm: null });
    expect(hz.rungs.map((x) => x.verdict)).toEqual(["NO-GO: LEVELS", "NO-GO: LEVELS", "NO-GO: HORIZON", "NO-GO: EFFECT"]);
    expect(hz.overall).toEqual({ status: "stop", onlyHorizon: true, horizonRung: null });
    expect(hz.problems.code).toBe(0); // not exit 4: nothing is asked for
    expect(hz.notes.join(" ")).toMatch(/the horizon rung is not run on S2 \(3\.0\).*seeds 401 and 403.*dated amendment/);
    // S2 fails at EFFECT and V (on S2) at HORIZON: the first rung that reached row 3 is V, whose substrate is S2: the same
    const viaV = onS2({ ...effectOf("S2"), horizon: [{ LOSS: 150 }, { LOSS: 150 }, { LOSS: 150 }] }, { ...V_GO, host: "S2" });
    expect(viaV.rungs.map((x) => x.verdict)).toEqual(["NO-GO: LEVELS", "NO-GO: LEVELS", "NO-GO: EFFECT", "NO-GO: HORIZON"]);
    expect(viaV.overall).toMatchObject({ status: "stop", onlyHorizon: true, horizonRung: null });
    expect(viaV.problems.code).toBe(0);
    // through the command line it is a plain GATE-0-STOP with the note
    const cl = cli(["gate0", "--jobs", "/jobs"], { ...frozen(), ...filesOf([...rungJobs(levelsOf("S0")), ...rungJobs(levelsOf("S1")), ...rungJobs(horizonFail("S2")), ...vJobs({ ...V_GO, host: "S2", table: () => NONE, confirm: null })]) });
    expect(cl.code).toBe(0);
    expect(cl.out).toMatch(/\*\*GATE-0-STOP\*\*: the only failures were HORIZON/);
    expect(cl.out).toMatch(/note: the horizon rung is not run on S2/);
    expect(cl.out).not.toMatch(/jobs to run: g0\.horizon-rung/);
  });
  // decision O-1: the horizon rung is tried when every rung that passed rows 1 and 2 failed at row 3. A rung that failed at row 1 or 2
  // (LEVELS, EFFECT) is out for another reason and does not count either way.
  it("3.0 (O-1) S0 EFFECT, S1 HORIZON and V EFFECT: the only rung that reached row 3 failed there, so the horizon rung is due, at S1", () => {
    const r = gate0(rungJobs(effectOf("S0", true)), rungJobs(horizonFail("S1")), vEffect());
    expect(r.rungs.map((x) => x.verdict)).toEqual(["NO-GO: EFFECT", "NO-GO: HORIZON", "NO-GO: EFFECT"]);
    if (r.overall.status !== "stop") throw new Error(JSON.stringify(r.overall));
    expect(r.overall.onlyHorizon).toBe(true);
    expect(r.overall.horizonRung).toMatchObject({ rung: "S1", state: "pending" });
    expect(r.overall.horizonRung!.missing).toHaveLength(3);
    expect(r.problems.code).toBe(4);
  });
  it("3.0 (O-1) S0 LEVELS, S1 and V HORIZON: the horizon rung is due at the first such rung, S1", () => {
    const r = gate0(rungJobs(levelsOf("S0")), rungJobs(horizonFail("S1")), vJobs({ ...V_GO, host: "S1", confirm: null }));
    expect(r.rungs.map((x) => [x.rung, x.verdict])).toEqual([["S0", "NO-GO: LEVELS"], ["S1", "NO-GO: HORIZON"], ["V", "NO-GO: HORIZON"]]);
    if (r.overall.status !== "stop") throw new Error(JSON.stringify(r.overall));
    expect(r.overall.onlyHorizon).toBe(true);
    expect(r.overall.horizonRung).toMatchObject({ rung: "S1", state: "pending" });
    // the jobs asked for are the horizon rung's, at the host's v_mid, 256 x 256 x 4 (the planner reads rung and the host's table)
    expect(r.overall.horizonRung!.missing.join()).toMatch(/g0\.horizon-rung S1 spread 12/);
  });
  it("3.0 (O-1) S0 HORIZON and S1 CONFIRM: a rung that reached row 3 failed later, so no horizon rung", () => {
    const r = gate0(rungJobs(horizonFail("S0")), rungJobs(confirmFail("S1")), vEffect());
    expect(r.rungs.map((x) => x.verdict)).toEqual(["NO-GO: HORIZON", "NO-GO: CONFIRM", "NO-GO: EFFECT"]);
    expect(r.overall).toEqual({ status: "stop", onlyHorizon: false, horizonRung: null });
  });
  it("3.0 (O-1) the rungs that failed at row 1 or 2 are neither for nor against: S0 EFFECT and S1 HORIZON give the same answer as S0 HORIZON and S1 HORIZON (V EFFECT in both)", () => {
    const withEffect = gate0(rungJobs(effectOf("S0", true)), rungJobs(horizonFail("S1")), vEffect());
    const bothHorizon = gate0(rungJobs(horizonFail("S0")), rungJobs(horizonFail("S1")), vJobs({ ...V_GO, table: () => NONE, confirm: null }));
    for (const r of [withEffect, bothHorizon]) {
      if (r.overall.status !== "stop") throw new Error(JSON.stringify(r.overall));
      expect(r.overall.onlyHorizon).toBe(true);
    }
  });
});
const TABLE_SEEDS3 = [401, 402, 403];

describe("G0.6 the dense rate and the operating point", () => {
  it("G0.6 the dense rate is the stepsPerSec of the seed-404 rate-0 job at v_mid of the rung used", () => {
    const r = gate0(rungJobs(goOf("S0")), [denseJob({ rung: "S0", spread: 12, stepsPerSec: 612.4 })]);
    expect(r.dense).toMatchObject({ stepsPerSec: 612.4 });
    expect(r.operatingPoint!.denseRate).toBe(612.4);
    expect(r.notes).toEqual([]);
  });
  it("G0.6 a dense job that did not run on the M3 Pro is noted, not rejected", () => {
    const r = gate0(rungJobs(goOf("S0")), [denseJob({ rung: "S0", spread: 12, stepsPerSec: 450, host: "M1 Max" })]);
    expect(r.operatingPoint!.denseRate).toBe(450);
    expect(r.notes.join()).toMatch(/idle M3 Pro/);
  });
  it("G0.6 not yet run: the record has denseRate null (the verdict stands)", () => {
    const r = gate0(rungJobs(goOf("S0")));
    expect(r.operatingPoint!.denseRate).toBeNull();
    expect(r.dense).toBeNull();
  });
  it("G0.6 at rung V the dense job counts for V's substrate", () => {
    const r = gate0(rungJobs(effectOf("S0", true)), rungJobs(effectOf("S1")), vJobs(V_GO), [denseJob({ rung: "V", spread: 12, stepsPerSec: 700 })]);
    expect(r.operatingPoint!.denseRate).toBe(700);
  });
  it("G0.6 two dense jobs, or one without a rate, are unusable input", () => {
    const two = gate0(rungJobs(goOf("S0")), [denseJob({ rung: "S0", spread: 12, stepsPerSec: 600 }), { ...denseJob({ rung: "S0", spread: 12, stepsPerSec: 610 }), dir: "other" }]);
    expect(two.problems.code).toBe(2);
    const bad = denseJob({ rung: "S0", spread: 12, stepsPerSec: 600 });
    bad.s.stepsPerSec = null;
    expect(gate0(rungJobs(goOf("S0")), [bad]).problems.code).toBe(2);
  });
  it("G0.6 the dense job counts only as the dense case it names, a rate-0 carpet that ran its 20 run censuses: NOSTART, EXT, LOSS, SPARSE or a census below 0.50 living leave the dense rate unavailable, with exit 3 and the verdict standing (final review, finding 10)", () => {
    const cases: [string, ClassSpec][] = [
      ["NOSTART", { NOSTART: "liv" }],
      ["NOSTART", { NOSTART: "coexist" }],
      ["EXT", { EXT: 8 }],
      ["LOSS", { LOSS: 8 }],
      ["SPARSE", "SPARSE"],
      ["CHURN", { custom: (k) => ({ liv: k === 7 ? 0.4 : 0.9, turnover: 0.3, ndom: 150, nanti: 150 }) }], // alive, but not a carpet at census 8
    ];
    for (const [name, cls] of cases) {
      const r = gate0(rungJobs(goOf("S0")), [denseJob({ rung: "S0", spread: 12, stepsPerSec: 1500, cls })]);
      expect([name, r.dense, r.operatingPoint?.denseRate]).toEqual([name, null, null]);
      expect([name, r.overall]).toEqual([name, { status: "go", used: "S0" }]);
      expect([name, r.problems.code]).toEqual([name, 3]);
      expect(r.problems.list.map((p) => p.message).join()).toMatch(/the dense-rate job is not the dense case G0\.6 names \(class \w+, \d+ of 20 run censuses.*no dense rate; no row covers that, and a repeat measurement is a dated amendment/s);
    }
    // a loss that completes at the last census (20 of 20 run censuses, a carpet throughout) is still LOSS, and a carpet run at a nonzero
    // rate is not the rate-0 case: both the same (verification round, findings 2a and 2b)
    const lossAt20 = denseJob({ rung: "S0", spread: 12, stepsPerSec: 1500, cls: { LOSS: 18 } });
    const rated = denseJob({ rung: "S0", spread: 12, stepsPerSec: 1500 });
    rated.s.rate = 16;
    for (const [name, j, cls] of [["LOSS at census 20", lossAt20, "LOSS"], ["rate 16", rated, "CHURN"]] as const) {
      const r = gate0(rungJobs(goOf("S0")), [j]);
      expect([name, r.dense, r.operatingPoint?.denseRate, r.problems.code]).toEqual([name, null, null, 3]);
      expect([name, r.overall]).toEqual([name, { status: "go", used: "S0" }]);
      expect([name, r.jobs.find((x) => x.job.s.stage === "g0.dense")!.a?.cls, r.jobs.find((x) => x.job.s.stage === "g0.dense")!.a?.nRun]).toEqual([name, cls, 20]);
      expect(r.problems.list.map((p) => p.message).join()).toMatch(new RegExp(`the dense-rate job is not the dense case G0\\.6 names \\(class ${cls}, 20 of 20 run censuses${name === "rate 16" ? ", rate 16 instead of 0" : ""}\\)`));
    }
    // a dense job that failed twice is a MISSING marker: the same
    const missing = denseJob({ rung: "S0", spread: 12, stepsPerSec: 600 });
    missing.s.missing = true;
    const m = gate0(rungJobs(goOf("S0")), [missing]);
    expect(m.operatingPoint!.denseRate).toBeNull();
    expect(m.problems.code).toBe(3);
    expect(m.problems.list.map((p) => p.message).join()).toMatch(/dense-rate job \(G0\.6\) is MISSING/);
    // a carpet that lost a label at the end (LATE), froze (FC) or churned (CHURN) is still the dense case
    for (const cls of ["LATE", "FC", "CHURN"] as const) {
      const r = gate0(rungJobs(goOf("S0")), [denseJob({ rung: "S0", spread: 12, stepsPerSec: 640, cls })]);
      expect([cls, r.operatingPoint!.denseRate, r.problems.code]).toEqual([cls, 640, 0]);
    }
    // the job is analysed like any other: a census that does not follow the schedule is unusable input, whatever its timing
    expect(gate0(rungJobs(goOf("S0")), [denseJob({ rung: "S0", spread: 12, stepsPerSec: 700, nRun: 15 })]).problems.code).toBe(2);
    // and its class is in the job list of 8.5
    const ok = gate0(rungJobs(goOf("S0")), [denseJob({ rung: "S0", spread: 12, stepsPerSec: 700 })]);
    expect(ok.jobs.find((x) => x.job.s.stage === "g0.dense")!.a?.cls).toBe("CHURN");
  });
  it("8.5 every Gate-0 job is listed with its class", () => {
    const r = gate0(rungJobs(goOf("S0")));
    expect(r.jobs.length).toBe(rungJobs(goOf("S0")).length);
    expect(r.jobs.filter((x) => x.job.s.stage === "g0.confirm").every((x) => x.a?.cls === "DC")).toBe(true);
    expect(r.jobs.filter((x) => x.job.s.stage === "g0.meter").every((x) => x.a === null)).toBe(true);
  });
  it("8.4 a nonzero residual in a Gate-0 job stops the stage (exit 3) whatever the verdict", () => {
    const jobs = rungJobs(goOf("S0"));
    const k = jobs.findIndex((j) => j.s.stage === "g0.table");
    jobs[k] = mkJob({ stage: "g0.table", rung: "S0", kill: "removal", seed: jobs[k].s.seed, spread: jobs[k].s.spread!, rate: jobs[k].s.rate!, cls: "CHURN", residual: "1" });
    const r = evaluateGate0(jobs);
    expect(r.problems.code).toBe(3);
    expect(r.problems.list[0].message).toMatch(/residual 1/);
  });
});

// ===================================================================================================================
// 3.2 kill-rate calibration
// ===================================================================================================================


describe("3.2 kill-rate calibration", () => {
  const D2: [ClassSpec, ClassSpec] = ["DC", "DC"];
  const N2: [ClassSpec, ClassSpec] = ["CHURN", "CHURN"];
  const cal = (per: Record<number, [ClassSpec, ClassSpec]>, controls?: [ClassSpec, ClassSpec], livLast?: Record<number, number>) => evaluateCalibration(calibrationJobs(per, controls, OP, livLast), OP);

  it("3.2 kappa* is the smallest rate that qualifies in both seeds", () => {
    const r = cal({ 8: N2, 16: D2, 32: D2, 64: D2 });
    expect(r.status).toBe("done");
    expect(r.verdict).toBe("KAPPA");
    expect(r.kappaStar).toBe(16);
    expect(r.rows.map((x) => x.qualifies)).toEqual([false, true, true, true]);
    expect(r.problems.code).toBe(0);
  });
  it("3.2 a rate must be DC in BOTH seeds", () => {
    const r = cal({ 8: ["DC", "SPARSE"], 16: ["LATE", "DC"], 32: D2, 64: D2 });
    expect(r.kappaStar).toBe(32);
    expect(r.rows[0].why[0]).toMatch(/seed 202: class SPARSE, not DC/);
  });
  it("3.2 (b) liv at least 0.50 at the last census: a DC job with liv 0.45 at the end does not qualify", () => {
    const r = cal({ 8: N2, 16: D2, 32: D2, 64: D2 }, undefined, { 16: 0.45 });
    expect(r.rows[1].qualifies).toBe(false);
    expect(r.rows[1].why.join()).toMatch(/liv 0\.450/);
    expect(r.kappaStar).toBe(32);
  });
  it("3.2 (b) liv exactly 0.50 at the last census qualifies", () => {
    const r = cal({ 8: N2, 16: D2, 32: D2, 64: D2 }, undefined, { 16: 0.5 });
    expect(r.kappaStar).toBe(16);
  });
  it("3.2 (c) the paired rate-0 control must be alive with every label kept: a control that loses a label disqualifies every rate at that seed", () => {
    const r = cal({ 8: D2, 16: D2, 32: D2, 64: D2 }, ["CHURN", { LOSS: 6 }]);
    expect(r.verdict).toBe("KAPPA-NONE");
    expect(r.kappaStar).toBeNull();
    expect(r.rows.every((x) => !x.qualifies && x.why.join().includes("control"))).toBe(true);
  });
  it("3.2 (c) the control's |chi_fw| must be at most 0.1: a control with chi 0.25 is not a control", () => {
    const sig = { custom: () => ({ liv: 0.9, turnover: 0.3, ndom: 125, nanti: 75 }), nRun: 20 } as const;
    const r = cal({ 8: D2, 16: D2, 32: D2, 64: D2 }, [sig, "CHURN"]);
    expect(r.verdict).toBe("KAPPA-NONE");
    expect(r.rows[0].why.join()).toMatch(/0\.250 above 0\.1/);
    // chi exactly 0.1 is allowed
    const edge = { custom: () => ({ liv: 0.9, turnover: 0.3, ndom: 110, nanti: 90 }), nRun: 20 } as const;
    expect(cal({ 8: D2, 16: D2, 32: D2, 64: D2 }, [edge, "CHURN"]).kappaStar).toBe(8);
  });
  it("3.2 a NOSTART control, or a NOSTART treatment job, disqualifies", () => {
    expect(cal({ 8: D2, 16: D2, 32: D2, 64: D2 }, ["NOSTART", "CHURN"]).verdict).toBe("KAPPA-NONE");
    expect(cal({ 8: ["NOSTART", "DC"], 16: D2, 32: D2, 64: D2 }).kappaStar).toBe(16);
  });
  it("3.2 KAPPA-NONE when no rate qualifies; the table has the class, chi_fw, turnover and liv per rate and seed with the paired control", () => {
    const r = cal({ 8: N2, 16: N2, 32: N2, 64: N2 });
    expect(r.verdict).toBe("KAPPA-NONE");
    expect(r.rows).toHaveLength(4);
    expect(r.rows[0].jobs[0]).toMatchObject({ seed: 201, cls: "CHURN" });
    expect(r.rows[0].controls[0]).toMatchObject({ seed: 201, cls: "CHURN" });
    expect(r.rows[0].jobs[0].turnoverFw).toBeCloseTo(0.3, 12);
    expect(r.problems.code).toBe(0); // a verdict, not a missing job
  });
  it("3.2 jobs still to run are exit 4 and are listed", () => {
    const jobs = calibrationJobs({ 8: N2, 16: D2, 32: D2, 64: D2 }).filter((j) => !(j.s.rate === 32 && j.s.seed === 202));
    const r = evaluateCalibration(jobs, OP);
    expect(r.status).toBe("pending");
    expect(r.missing).toEqual(["calibration spread 12 rate 32 seed 202"]);
    expect(r.problems.code).toBe(4);
  });
});

// ===================================================================================================================
// 4 the sweep
// ===================================================================================================================

const sp = (spread: number, o: Partial<SweepSpread> = {}): SweepSpread => ({
  spread,
  informative: true,
  incomplete: false,
  nTreat: 5,
  nCtrl: 3,
  nDyn: 0,
  nFc: 0,
  nChurn: 0,
  nLost: 0,
  nExt: 0,
  nSparse: 0,
  nSig: 0,
  Tmed: TEND + 1000,
  ctlKeeps: 3,
  ctlMedAbsChi: 0.02,
  ...o,
});
const dyn5 = { nDyn: 5, nSig: 5 };
const early = { nLost: 5, Tmed: 5000 }; // a collapse in the first quarter (T_end / 4 = 12,500)
const fc5 = { nFc: 5 };
const grid = [4, 8, 12, 20, 28];
const outcome = (...spreads: SweepSpread[]) => sweepOutcome(spreads, TEND);
const row = (...spreads: SweepSpread[]) => outcome(...spreads).row;

describe("4.2 per-spread quantities from the jobs", () => {
  const mk = (treat: ClassSpec[], ctrl: ClassSpec[] = ["CHURN", "CHURN", "CHURN"]) => {
    const jobs = sweepJobs({ 12: { treat, ctrl } });
    const analysis = (rate: number) => jobs.filter((j) => j.s.rate === rate).map((j) => analyzeRun(j, {}));
    return spreadStats(12, analysis(32), analysis(0), TEND);
  };
  it("4.2 class counts add up to the finished treatment jobs; n_lost is LOSS and LATE", () => {
    const s = mk(["DC", "FC", "CHURN", { LOSS: 8 }, "LATE"]);
    expect(s).toMatchObject({ nDyn: 1, nFc: 1, nChurn: 1, nLost: 2, nExt: 0, nSparse: 0, nTreat: 5, informative: true });
    const t = mk(["EXT" as never, "SPARSE", "DC", "DC", "DC"].map((c) => (c === "EXT" ? { EXT: 9 } : c)) as ClassSpec[]);
    expect(t).toMatchObject({ nExt: 1, nSparse: 1, nDyn: 3 });
    expect(t.nDyn + t.nFc + t.nChurn + t.nLost + t.nExt + t.nSparse).toBe(t.nTreat);
  });
  it("4.2 n_sig counts treatment jobs with chi_all or chi_fw at least 0.2, whatever their class", () => {
    // a LOSS job with a cyclic signature before the loss, a CHURN job without, a SPARSE one with
    const s = mk([{ LOSS: 8 }, "CHURN", "SPARSE", "FC", "DC"]);
    expect(s.nSig).toBe(3); // LOSS (chi_all 0.667), SPARSE (0.667), DC
  });
  it("4.2 Tmed: the lower middle of the T_cx values, CENSORED counted as T_end + 1,000, an EXT job at its stop step", () => {
    expect(mk(["DC", "DC", "DC", "DC", "DC"]).Tmed).toBe(TEND + 1000);
    expect(mk([{ LOSS: 5 }, { LOSS: 9 }, { LOSS: 7 }, "DC", "DC"]).Tmed).toBe(9000);
    expect(mk([{ EXT: 6 }, { LOSS: 9 }, { LOSS: 7 }, { LOSS: 20 }, "DC"]).Tmed).toBe(9000); // 6000, 7000, 9000, 20000, 51000
    expect(mk([{ LOSS: 5 }, { LOSS: 9 }, { LOSS: 7 }, { LOSS: 20 }, "NOSTART"]).Tmed).toBe(7000); // four finished: the lower of the two middles
  });
  it("4.2 informative: at least 2 of 3 controls alive with every label and a median |chi_fw| of at most 0.1; NOSTART jobs are not counted", () => {
    expect(mk(five("DC")).informative).toBe(true);
    expect(mk(five("DC"), ["CHURN", "CHURN", { LOSS: 5 }]).informative).toBe(true);
    expect(mk(five("DC"), ["CHURN", { LOSS: 5 }, { LOSS: 5 }]).informative).toBe(false);
    expect(mk(five("DC"), ["CHURN", "CHURN", "NOSTART"]).informative).toBe(true); // two finished controls, both fine
    expect(mk(five("DC"), ["CHURN", "NOSTART", "NOSTART"]).informative).toBe(false); // fewer than 2 finished controls: incomplete
    expect(mk(five("DC"), ["CHURN", "NOSTART", "NOSTART"]).incomplete).toBe(true);
  });
  it("4.2 fewer than 4 finished treatment jobs is incomplete and counts as not informative", () => {
    const s = mk(["DC", "DC", "DC", "NOSTART", "NOSTART"]);
    expect(s.incomplete).toBe(true);
    expect(s.informative).toBe(false);
    expect(mk(["DC", "DC", "DC", "DC", "NOSTART"]).informative).toBe(true);
  });
  it("4.2 a spread whose controls churn with a signature (median |chi_fw| above 0.1) is not informative", () => {
    const sig = { custom: () => ({ liv: 0.9, turnover: 0.3, ndom: 125, nanti: 75 }), nRun: TEND / 1000 } as const;
    expect(mk(five("DC"), [sig, sig, sig]).informative).toBe(false);
  });
});

describe("4.3 edge pairs", () => {
  it("4.3 L: a lattice-like cliff (at least 4 dynamic below, at most 1 above, an early collapse above, nothing returns)", () => {
    const e = edgePairs([sp(4, dyn5), sp(8, dyn5), sp(12, dyn5), sp(20, dyn5), sp(28, early)], TEND);
    expect(e).toEqual([{ kind: "L", a: 20, b: 28 }]);
  });
  it("4.3 L needs the collapse to be early: Tmed(b) at most T_end / 4", () => {
    const late = { nLost: 5, Tmed: 12_501 };
    expect(edgePairs([sp(4, dyn5), sp(8, late)], TEND)).toEqual([]);
    expect(edgePairs([sp(4, dyn5), sp(8, { nLost: 5, Tmed: 12_500 })], TEND)).toEqual([{ kind: "L", a: 4, b: 8 }]);
  });
  it("4.3 L: 'every informative v > b has n_dyn <= 2': a revival above the pair spoils it", () => {
    expect(edgePairs([sp(4, dyn5), sp(8, early), sp(12, { nDyn: 3 })], TEND)).toEqual([]);
    expect(edgePairs([sp(4, dyn5), sp(8, early), sp(12, { nDyn: 2 })], TEND)).toEqual([{ kind: "L", a: 4, b: 8 }]);
  });
  it("4.3 I: an inverted cliff (at most 1 dynamic with an early collapse below, at least 4 above, nothing below revives)", () => {
    expect(edgePairs([sp(4, early), sp(8, dyn5), sp(12, dyn5)], TEND)).toEqual([{ kind: "I", a: 4, b: 8 }]);
    expect(edgePairs([sp(4, { nDyn: 3 }), sp(8, early), sp(12, dyn5), sp(20, dyn5)], TEND)).toEqual([{ kind: "I", a: 8, b: 12 }].filter(() => false)); // a lone 3 below blocks it
    expect(edgePairs([sp(4, { nDyn: 2 }), sp(8, early), sp(12, dyn5), sp(20, dyn5)], TEND)).toEqual([{ kind: "I", a: 8, b: 12 }]);
  });
  it("4.3 I needs an early loss at a: a frozen film at a is the F kind, not I", () => {
    expect(edgePairs([sp(4, fc5), sp(8, dyn5)], TEND)).toEqual([{ kind: "F", a: 4, b: 8 }]);
  });
  it("4.3 F: a freeze edge (at least 4 frozen at a, at least 4 dynamic at b, nothing dynamic below a)", () => {
    expect(edgePairs([sp(4, fc5), sp(8, dyn5), sp(12, dyn5)], TEND)).toEqual([{ kind: "F", a: 4, b: 8 }]);
    expect(edgePairs([sp(4, { nDyn: 2 }), sp(8, fc5), sp(12, dyn5)], TEND)).toEqual([]); // n_dyn(4) = 2 > 1 spoils F at (8, 12)
    expect(edgePairs([sp(4, { nDyn: 1 }), sp(8, fc5), sp(12, dyn5)], TEND)).toEqual([{ kind: "F", a: 8, b: 12 }]);
  });
  it("4.3 both members of a pair must be informative; the pair is of consecutive values of G_spread", () => {
    expect(edgePairs([sp(4, dyn5), sp(8, { ...early, informative: false })], TEND)).toEqual([]);
    expect(edgePairs([sp(4, dyn5), sp(8, { nDyn: 4 }), sp(12, early)], TEND)).toEqual([{ kind: "L", a: 8, b: 12 }]);
    // an uninformative spread between a and b makes them non-consecutive neighbours: no pair spans it
    expect(edgePairs([sp(4, dyn5), sp(8, { informative: false }), sp(12, early)], TEND)).toEqual([]);
  });
  it("4.3 a pair is of one kind only (the kinds exclude each other), over every consistent combination of counts", () => {
    // Tmed is the median T_cx of five jobs: it is early only when at least 3 of them were lost, so it follows from the counts
    const spec = (spread: number, nDyn: number, nFc: number) => sp(spread, { nDyn, nFc, nLost: 5 - nDyn - nFc, Tmed: 5 - nDyn - nFc >= 3 ? 5000 : TEND + 1000 });
    let pairs = 0;
    for (let aDyn = 0; aDyn <= 5; aDyn++) for (let aFc = 0; aFc <= 5 - aDyn; aFc++) {
      for (let bDyn = 0; bDyn <= 5; bDyn++) for (let bFc = 0; bFc <= 5 - bDyn; bFc++) {
        const e = edgePairs([spec(4, aDyn, aFc), spec(8, bDyn, bFc)], TEND);
        expect(e.length).toBeLessThanOrEqual(1);
        pairs += e.length;
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });
});

describe("4.4 the outcome table (the first row that holds; the order is A7, A9, A1, A2, A8, A3, A11, A6, A10, A4, A5)", () => {
  it("4.4 A7 UNINFORMATIVE: fewer than 4 informative spreads, whatever else would hold", () => {
    const r = outcome(sp(4, dyn5), sp(8, dyn5), sp(12, { ...dyn5, informative: false }), sp(20, { ...early, informative: false }), sp(28, dyn5));
    expect(r.row).toBe("A7");
    expect(r.name).toBe("UNINFORMATIVE");
    expect(r.go).toBe(false);
    expect(r.I).toBe(3);
  });
  it("4.4 A7 boundary: exactly 4 informative spreads is enough", () => {
    expect(row(sp(4, dyn5), sp(8, dyn5), sp(12, dyn5), sp(20, dyn5, ), sp(28, { informative: false }))).toBe("A3");
  });
  it("4.4 A9 DYNAMIC WINDOW: one F pair, one L pair, no I pair, b1 <= a2, and n_dyn >= 3 between", () => {
    const r = outcome(sp(4, fc5), sp(8, { nDyn: 4 }), sp(12, { nDyn: 3 }), sp(20, { nDyn: 4 }), sp(28, early));
    expect(r.row).toBe("A9");
    expect(r.name).toBe("DYNAMIC WINDOW");
    expect(r.go).toBe(true);
    expect(r.edges).toEqual([{ kind: "F", a: 4, b: 8 }, { kind: "L", a: 20, b: 28 }]);
  });
  it("4.4 A9 fails when the window has a spread with n_dyn below 3, which falls through to A5", () => {
    expect(row(sp(4, fc5), sp(8, { nDyn: 4 }), sp(12, { nDyn: 2 }), sp(20, { nDyn: 4 }), sp(28, early))).toBe("A5");
  });
  it("4.4 A1 CLIFF, lattice-like orientation: exactly one L pair, no F or I pair", () => {
    const r = outcome(sp(4, dyn5), sp(8, dyn5), sp(12, dyn5), sp(20, dyn5), sp(28, early));
    expect(r.row).toBe("A1");
    expect(r.name).toBe("CLIFF, lattice-like orientation");
    expect(r.go).toBe(true);
  });
  it("4.4 A2 CLIFF, inverted orientation: exactly one I pair, no F or L pair", () => {
    const r = outcome(sp(4, early), sp(8, dyn5), sp(12, dyn5), sp(20, dyn5), sp(28, dyn5));
    expect(r.row).toBe("A2");
    expect(r.name).toBe("CLIFF, inverted orientation");
    expect(r.go).toBe(true);
  });
  it("4.4 A8 FREEZE EDGE: exactly one F pair, no L or I pair, and n_dyn >= 3 for every informative v >= b", () => {
    const r = outcome(sp(4, fc5), sp(8, { nDyn: 4 }), sp(12, { nDyn: 4 }), sp(20, dyn5), sp(28, { nDyn: 3 }));
    expect(r.row).toBe("A8");
    expect(r.name).toBe("FREEZE EDGE");
    expect(r.go).toBe(true);
  });
  it("4.4 A8 needs the dynamic region to hold from b up: a spread above with n_dyn 2 makes it ragged (A5)", () => {
    expect(row(sp(4, fc5), sp(8, { nDyn: 4 }), sp(12, { nDyn: 4 }), sp(20, dyn5), sp(28, { nDyn: 2 }))).toBe("A5");
  });
  it("4.4 A3 COEXISTENCE THROUGHOUT: no edge pair and n_dyn >= 4 at every informative spread", () => {
    const r = outcome(sp(4, { nDyn: 4 }), sp(8, dyn5), sp(12, dyn5), sp(20, { nDyn: 4 }), sp(28, dyn5));
    expect(r.row).toBe("A3");
    expect(r.go).toBe(true);
    expect(r.consequence).toMatch(/not evidence of stable coexistence/);
  });
  it("4.4 A3 uses only the informative spreads", () => {
    expect(row(sp(4, dyn5), sp(8, dyn5), sp(12, dyn5), sp(20, dyn5), sp(28, { informative: false, nDyn: 0 }))).toBe("A3");
  });
  it("4.4 A11 NO DETECTABLE PREDATION EFFECT: no edge pair, n_sig at most 1 everywhere, and n_churn >= 4 somewhere", () => {
    const r = outcome(sp(4, { nChurn: 5 }), sp(8, { nChurn: 4, nFc: 1 }), sp(12, { nChurn: 5 }), sp(20, { nChurn: 3, nSig: 1, nFc: 2 }), sp(28, { nChurn: 5 }));
    expect(r.row).toBe("A11");
    expect(r.name).toBe("NO DETECTABLE PREDATION EFFECT");
    expect(r.go).toBe(false);
  });
  it("4.4 A11 boundary: n_sig = 2 at one spread breaks it (the cyclic signature is there somewhere), falling to a later row or A5", () => {
    expect(row(sp(4, { nChurn: 5 }), sp(8, { nChurn: 5, nSig: 2 }), sp(12, { nChurn: 5 }), sp(20, { nChurn: 5 }), sp(28, { nChurn: 5 }))).toBe("A5");
  });
  it("4.4 A6 FROZEN COEXISTENCE ONLY: no edge pair, n_dyn <= 1 everywhere, and n_fc >= 4 somewhere", () => {
    const r = outcome(sp(4, fc5), sp(8, { nFc: 4, nChurn: 1 }), sp(12, { nFc: 3, nChurn: 2 }), sp(20, fc5), sp(28, { nFc: 4, nDyn: 1 }));
    expect(r.row).toBe("A6");
    expect(r.name).toBe("FROZEN COEXISTENCE ONLY");
  });
  it("4.4 A10 SPARSE FILM: no edge pair, n_dyn <= 1 everywhere, n_sparse >= 3 somewhere (and no frozen or churning majority)", () => {
    const r = outcome(sp(4, { nSparse: 4, nLost: 1 }), sp(8, { nSparse: 3, nLost: 2 }), sp(12, { nSparse: 5 }), sp(20, { nSparse: 3, nFc: 2 }), sp(28, { nSparse: 4, nExt: 1 }));
    expect(r.row).toBe("A10");
    expect(r.name).toBe("SPARSE FILM");
  });
  it("4.4 A4 LABEL LOSS THROUGHOUT: no edge pair, n_dyn <= 1, n_fc <= 3 and n_lost + n_ext >= 3 at every informative spread", () => {
    const r = outcome(sp(4, { nLost: 5 }), sp(8, { nLost: 4, nExt: 1 }), sp(12, { nExt: 5 }), sp(20, { nLost: 3, nFc: 2 }), sp(28, { nLost: 3, nDyn: 1, nSparse: 1 }));
    expect(r.row).toBe("A4");
    expect(r.name).toBe("LABEL LOSS THROUGHOUT");
    expect(r.go).toBe(false);
  });
  it("4.4 A4 needs every informative spread: one spread with n_lost + n_ext = 2 makes it A5", () => {
    expect(row(sp(4, { nLost: 5 }), sp(8, { nLost: 4, nExt: 1 }), sp(12, { nLost: 2, nChurn: 3 }), sp(20, { nLost: 5 }), sp(28, { nLost: 5 }))).toBe("A5");
  });
  it("4.4 A5 RAGGED OR GRADUAL: anything else (other combinations of edge pairs, or mixed values)", () => {
    const r = outcome(sp(4, { nDyn: 3, nChurn: 2 }), sp(8, { nDyn: 2, nFc: 3 }), sp(12, { nDyn: 4, nLost: 1 }), sp(20, { nDyn: 1, nLost: 4 }), sp(28, { nDyn: 3, nSparse: 2 }));
    expect(r.row).toBe("A5");
    expect(r.go).toBe(false);
    expect(r.consequence).toMatch(/do not run/);
  });
  it("4.4 A5 also for two F pairs' worth of structure, or an L pair together with an I pair", () => {
    expect(row(sp(4, early), sp(8, dyn5), sp(12, dyn5), sp(20, dyn5), sp(28, early))).toBe("A5"); // I pair and L pair
  });
  it("4.4 the rows are tried in the order of the table: A6 before A10 when both hold, A11 before A6", () => {
    // frozen at 4 and 8 (n_fc 5), sparse at 12 (n_sparse 5): A6 and A10 both hold -> A6
    expect(row(sp(4, fc5), sp(8, fc5), sp(12, { nSparse: 5 }), sp(20, { nSparse: 4, nLost: 1 }), sp(28, fc5))).toBe("A6");
    // churn 5 at one spread, frozen 5 at another, n_sig <= 1 everywhere: A11 and A6 both hold -> A11
    expect(row(sp(4, fc5), sp(8, { nChurn: 5 }), sp(12, fc5), sp(20, { nChurn: 5 }), sp(28, fc5))).toBe("A11");
  });
  it("4.4 go rows are A1, A2, A3, A8 and A9 and no others", () => {
    const rows = [
      outcome(sp(4, dyn5), sp(8, dyn5), sp(12, dyn5), sp(20, dyn5), sp(28, early)),
      outcome(sp(4, early), sp(8, dyn5), sp(12, dyn5), sp(20, dyn5), sp(28, dyn5)),
      outcome(sp(4, dyn5), sp(8, dyn5), sp(12, dyn5), sp(20, dyn5), sp(28, dyn5)),
      outcome(sp(4, fc5), sp(8, dyn5), sp(12, dyn5), sp(20, dyn5), sp(28, dyn5)),
      outcome(sp(4, fc5), sp(8, { nDyn: 4 }), sp(12, { nDyn: 3 }), sp(20, { nDyn: 4 }), sp(28, early)),
    ];
    expect(rows.map((r) => [r.row, r.go])).toEqual([["A1", true], ["A2", true], ["A3", true], ["A8", true], ["A9", true]]);
  });
});

describe("4.6 spread*", () => {
  it("4.6 the smallest v with n_dyn >= 4 whose informative neighbours all have n_dyn >= 3", () => {
    expect(spreadStar([sp(4, dyn5), sp(8, dyn5), sp(12, dyn5), sp(20, dyn5), sp(28, early)])).toBe(4);
    expect(spreadStar([sp(4, fc5), sp(8, { nDyn: 4 }), sp(12, { nDyn: 4 }), sp(20, dyn5), sp(28, { nDyn: 3 })])).toBe(12); // 8 has a frozen neighbour (n_dyn 0)
  });
  it("4.6 if there is none, the smallest v with n_dyn >= 4", () => {
    expect(spreadStar([sp(4, { nDyn: 4 }), sp(8, { nDyn: 2 }), sp(12, dyn5), sp(20, dyn5), sp(28, { nDyn: 0 })])).toBe(4);
  });
  it("4.6 an uninformative neighbour is ignored", () => {
    expect(spreadStar([sp(4, dyn5), sp(8, { informative: false, nDyn: 0 }), sp(12, dyn5)])).toBe(4);
  });
  it("4.6 v itself must be informative (decision O-2): an uninformative spread is never spread*, whatever its n_dyn", () => {
    // 4 has n_dyn 5 but its controls lost a label: it is passed over for 8, the smallest informative spread with n_dyn >= 4
    expect(spreadStar([sp(4, { ...dyn5, informative: false }), sp(8, dyn5), sp(12, dyn5)])).toBe(8);
    // ... and in the fallback (no spread has informative neighbours that all have n_dyn >= 3): 4 is passed over for 12
    expect(spreadStar([sp(4, { ...dyn5, informative: false }), sp(8, { nDyn: 2 }), sp(12, dyn5)])).toBe(12);
    // ... and in the first pass, where 12 qualifies through a neighbour with n_dyn 3
    expect(spreadStar([sp(4, { ...dyn5, informative: false }), sp(8, { nDyn: 3 }), sp(12, dyn5)])).toBe(12);
    // the case of the review (Codex 5): grid [4, 8, 12, 20, 28], dynamic coexistence everywhere, the controls failing at 4 only
    const grid = [4, 8, 12, 20, 28].map((v) => sp(v, v === 4 ? { ...dyn5, informative: false } : dyn5));
    expect(spreadStar(grid)).toBe(8);
    // an uninformative neighbour is still ignored (it does not block an informative v) and an uninformative v is skipped by both passes
    expect(spreadStar([sp(4, dyn5), sp(8, { ...dyn5, informative: false }), sp(12, dyn5)])).toBe(4);
    expect(spreadStar([sp(4, { ...dyn5, informative: false }), sp(8, { ...dyn5, informative: false })])).toBeNull();
  });
  it("4.6 no spread with n_dyn >= 4: null", () => {
    expect(spreadStar([sp(4, { nDyn: 3 }), sp(8, { nDyn: 2 })])).toBeNull();
  });
});

describe("4 the sweep end to end, from synthetic jobs", () => {
  const A1: Record<number, { treat: ClassSpec[] }> = {
    4: { treat: five("DC") },
    8: { treat: five("DC") },
    12: { treat: five("DC") },
    20: { treat: five("DC") },
    28: { treat: five({ LOSS: 5 }) },
  };
  it("4 A1 from five spreads of jobs, with Tmed from the collapse step", () => {
    const r = evaluateSweep(sweepJobs(A1), OP);
    expect(r.status).toBe("done");
    expect(r.tEnd).toBe(50_000);
    expect(r.reduced).toBe(false);
    expect(r.I).toBe(5);
    expect(r.outcome).toMatchObject({ row: "A1", go: true });
    expect(r.edges).toEqual([{ kind: "L", a: 20, b: 28 }]);
    expect(r.spreads.find((s) => s.spread === 28)).toMatchObject({ nLost: 5, Tmed: 5000, nDyn: 0 });
    expect(r.spreadStar).toBe(4);
    expect(r.problems.code).toBe(0);
  });
  it("4 A2 from jobs: an early collapse at the low end, dynamic coexistence above", () => {
    const r = evaluateSweep(sweepJobs({ 4: { treat: five({ LOSS: 4 }) }, 8: A1[8], 12: A1[12], 20: A1[20], 28: A1[28].treat ? { treat: five("DC") } : A1[28] }), OP);
    expect(r.outcome!.row).toBe("A2");
  });
  it("4 A7 from jobs: three of five spreads have controls that lose labels", () => {
    const bad: ClassSpec[] = [{ LOSS: 5 }, { LOSS: 5 }, { LOSS: 5 }];
    const r = evaluateSweep(sweepJobs({ 4: { treat: five("DC") }, 8: { treat: five("DC"), ctrl: bad }, 12: { treat: five("DC"), ctrl: bad }, 20: { treat: five("DC"), ctrl: bad }, 28: { treat: five("DC") } }), OP);
    expect(r.I).toBe(2);
    expect(r.outcome!.row).toBe("A7");
    expect(r.spreadStar).toBeNull();
  });
  it("4 A3, A6, A11 from jobs", () => {
    const all = (c: ClassSpec) => Object.fromEntries(grid.map((v) => [v, { treat: five(c) }]));
    expect(evaluateSweep(sweepJobs(all("DC")), OP).outcome!.row).toBe("A3");
    expect(evaluateSweep(sweepJobs(all("FC")), OP).outcome!.row).toBe("A6");
    expect(evaluateSweep(sweepJobs(all("CHURN")), OP).outcome!.row).toBe("A11");
    expect(evaluateSweep(sweepJobs(all("SPARSE")), OP).outcome!.row).toBe("A10"); // n_dyn 0, n_sparse 5; A11 fails on n_sig 5 (the sparse fixtures carry a signature) and A6 on n_fc 0
  });
  it("4 jobs still to run are exit 4 and listed; the partial table is still returned", () => {
    const jobs = sweepJobs(A1).filter((j) => !(j.s.spread === 12 && j.s.seed === 214 && j.s.rate === 32));
    const r = evaluateSweep(jobs, OP);
    expect(r.status).toBe("pending");
    expect(r.outcome).toBeNull();
    expect(r.missing).toEqual(["sweep spread 12 rate 32 seed 214"]);
    expect(r.problems.code).toBe(4);
    expect(r.spreads).toHaveLength(5);
  });
  it("4 a NOSTART treatment job is listed and not counted; a MISSING-marked one is listed too", () => {
    const r = evaluateSweep(sweepJobs({ ...A1, 12: { treat: ["DC", "DC", "DC", "DC", "NOSTART"] } }), OP);
    expect(r.spreads.find((s) => s.spread === 12)).toMatchObject({ nTreat: 4, nDyn: 4, informative: true });
    expect(r.listed.some((l) => /NOSTART/.test(l))).toBe(true);
  });
  it("4.1 the rate arms are reported beside the table and never block it", () => {
    const rateArmJobs = [8, 128].flatMap((rate) => [231, 232, 233].map((sd) => mkJob({ stage: "rate-arm", seed: sd, spread: 12, rate, nRun: 50, cls: "DC" })));
    const r = evaluateSweep([...sweepJobs(A1), ...rateArmJobs], OP);
    expect(r.rateArms).toHaveLength(6);
    expect(r.rateArms.map((a) => [a.rate, a.cls])).toEqual([[8, "DC"], [8, "DC"], [8, "DC"], [128, "DC"], [128, "DC"], [128, "DC"]]);
    const none = evaluateSweep(sweepJobs(A1), OP);
    expect(none.rateArms.every((a) => a.cls === null)).toBe(true);
    expect(none.status).toBe("done");
  });
  it("4.1 a sweep treatment job at a rate other than kappa* is unusable input", () => {
    const jobs = sweepJobs(A1);
    jobs.push(mkJob({ stage: "sweep", seed: 214, spread: 12, rate: 99, nRun: 50, cls: "DC", id: "wrong-rate" }));
    expect(evaluateSweep(jobs, OP).problems.code).toBe(2);
  });
  it("1.2 the step budgets come from h0 and the dense rate; without the dense rate the schedule is not decided (exit 2)", () => {
    const reduced = evaluateSweep(sweepJobs(A1), { ...OP, h0: 200_000, denseRate: 599 });
    expect(reduced.tEnd).toBe(100_000);
    expect(reduced.problems.code).toBe(2); // jobs of 100 censuses are needed and the fixtures have 50: a job of the wrong length is unusable input
    const r = evaluateSweep(sweepJobs(A1), { ...OP, denseRate: null });
    expect(r.problems.code).toBe(2);
  });
  it("4 kappa* is read from the operating point, else from the treatment jobs' one nonzero rate", () => {
    const noStar = evaluateSweep(sweepJobs(A1), { ...OP, kappaStar: undefined });
    expect(noStar.kappaStar).toBe(32);
    expect(noStar.outcome!.row).toBe("A1");
  });
  it("8.4 a control with a strong cyclic signature in the sweep is a bug indicator (exit 3)", () => {
    const rows = rowsOf("DC", 50);
    rows.run = rows.run.map((r) => ({ ...r, ndom: 190, nanti: 10 }));
    const jobs = sweepJobs(A1);
    const k = jobs.findIndex((j) => j.s.stage === "sweep" && j.s.rate === 0 && j.s.spread === 12 && j.s.seed === 211);
    jobs[k] = mkJob({ stage: "sweep", seed: 211, spread: 12, rate: 0, nRun: 50, rows });
    expect(evaluateSweep(jobs, OP).problems.code).toBe(3);
  });
});

describe("5 longer cycles and 6.1 the deep-volume precondition", () => {
  const A1: Record<number, { treat: ClassSpec[] }> = {
    4: { treat: five("DC") },
    8: { treat: five("DC") },
    12: { treat: five("DC") },
    20: { treat: five("DC") },
    28: { treat: five({ LOSS: 5 }) },
  };
  const cycleJob = (K0: 4 | 5, sd: number, o: { cls?: ClassSpec; breakY?: boolean } = {}) => {
    const rows = rowsOf(o.cls ?? "DC", 50, K0);
    if (o.breakY) rows.run[30] = { ...rows.run[30], modal: [2 | 8, 4, 8, 1, 0, 0, 0, 0] }; // 0 -> 1 and 0 -> 3 with 3 -> 0: a mutual pair, Y = 0
    return mkJob({ stage: "cycles", seed: sd, spread: 4, rate: 32, K0, types: K0, nRun: 50, rows });
  };
  const sweep = () => evaluateSweep(sweepJobs(A1), OP);

  it("5 VIABLE: class DC and Y_c = K0 at every census of the final window; an arm is viable with at least 2 of its 3 jobs", () => {
    const jobs = [cycleJob(4, 241), cycleJob(4, 242), cycleJob(4, 243, { breakY: true }), cycleJob(5, 244), cycleJob(5, 245, { cls: "CHURN" }), cycleJob(5, 246, { cls: "CHURN" })];
    const r = evaluateCycles(jobs, sweep());
    expect(r.status).toBe("done");
    expect(r.jobs.filter((j) => j.K0 === 4).map((j) => j.viable)).toEqual([true, true, false]);
    expect(r.jobs.filter((j) => j.K0 === 5).map((j) => j.viable)).toEqual([true, false, false]);
    expect(r.arms[4]).toEqual({ viable: 2, armViable: true });
    expect(r.arms[5]).toEqual({ viable: 1, armViable: false });
  });
  it("5 Y_c = K0 outside the final window does not matter; inside it does", () => {
    const rows = rowsOf("DC", 50, 4);
    rows.run[5] = { ...rows.run[5], modal: [2 | 8, 4, 8, 1, 0, 0, 0, 0] };
    const early = mkJob({ stage: "cycles", seed: 241, spread: 4, rate: 32, K0: 4, types: 4, nRun: 50, rows });
    const r = evaluateCycles([early, cycleJob(4, 242), cycleJob(4, 243), cycleJob(5, 244), cycleJob(5, 245), cycleJob(5, 246)], sweep());
    expect(r.jobs[0].viable).toBe(true);
  });
  it("5 runs only when 4.4 gave a go row: otherwise the section is closed; jobs missing are exit 4", () => {
    const closed = evaluateCycles([], evaluateSweep(sweepJobs(Object.fromEntries(grid.map((v) => [v, { treat: five("FC" as ClassSpec) }]))), OP));
    expect(closed.status).toBe("closed");
    const partial = evaluateCycles([cycleJob(4, 241)], sweep());
    expect(partial.status).toBe("pending");
    expect(partial.problems.code).toBe(4);
    expect(partial.missing).toHaveLength(5);
  });

  const measure = (xis: Record<string, number | null>) => (j: Job) => (j.s.id in xis ? { xi: xis[j.s.id], zcoh: 0.3 } : null);
  const dcIds = (s: ReturnType<typeof sweep>) => s.jobs.filter(({ job, a }) => job.s.spread === s.spreadStar && job.s.rate === 32 && a?.cls === "DC").map(({ job }) => job.s.id);
  it("6.1 holds: a go row, at least 4 DC treatment jobs at spread*, median xi at least 6", () => {
    const s = sweep();
    const ids = dcIds(s);
    expect(ids).toHaveLength(5);
    const r = evaluateDeepPrecondition(s, measure(Object.fromEntries(ids.map((id, k) => [id, [8, 7, 6, 5, 9][k]]))));
    expect(r.status).toBe("done");
    expect(r.holds).toBe(true);
    expect(r.medianXi).toBe(7);
    expect(r.dcJobs).toHaveLength(5);
  });
  it("6.1 median xi below 6 fails, and names the condition; exactly 6 passes", () => {
    const s = sweep();
    const ids = dcIds(s);
    const low = evaluateDeepPrecondition(s, measure(Object.fromEntries(ids.map((id) => [id, 2]))));
    expect(low.holds).toBe(false);
    expect(low.reason).toMatch(/median xi 2\.00/);
    const six = evaluateDeepPrecondition(s, measure(Object.fromEntries(ids.map((id) => [id, 6]))));
    expect(six.holds).toBe(true);
  });
  it("6.1 an even number of xi values (4 DC jobs): the median is the mean of the two middle values", () => {
    const jobs = sweepJobs({ ...A1, 4: { treat: ["DC", "DC", "DC", "DC", "CHURN"] } });
    const s = evaluateSweep(jobs, OP);
    expect(s.spreadStar).toBe(4);
    const ids = dcIds(s);
    expect(ids).toHaveLength(4);
    const r = evaluateDeepPrecondition(s, measure(Object.fromEntries(ids.map((id, k) => [id, [1, 5, 7, 20][k]]))));
    expect(r.medianXi).toBe(6);
    expect(r.holds).toBe(true);
  });
  it("6.1 a final snapshot that is missing is unusable input (exit 2)", () => {
    const s = sweep();
    const r = evaluateDeepPrecondition(s, () => null);
    expect(r.problems.code).toBe(2);
    expect(r.holds).toBe(false);
  });
  it("6.1 closed when 4.4 gave no go row; pending when the sweep is incomplete", () => {
    const closed = evaluateDeepPrecondition(evaluateSweep(sweepJobs(Object.fromEntries(grid.map((v) => [v, { treat: five("FC" as ClassSpec) }]))), OP), () => null);
    expect(closed.status).toBe("closed");
    expect(closed.reason).toMatch(/not a go row/);
    const pending = evaluateDeepPrecondition(evaluateSweep([], OP), () => null);
    expect(pending.status).toBe("pending");
    expect(pending.problems.code).toBe(4);
  });
});

// ===================================================================================================================
// 7 the mutation arms
// ===================================================================================================================


const cnt = (gL = 0, gT = 0, gLo = 0, gM = 0, gE = 0): ArmCounts => ({ gL, gT, gLo, gM, gE });

describe("7.5 arm verdicts, the table as a function (the first row that holds)", () => {
  it("7.5 row 1 GROWS: arm C, g_L >= 4, gN_L <= g_L - 4, median supply >= 1 (4 against 0, 5 against 0, 5 against 1)", () => {
    expect(armVerdict("C", cnt(4, 1), { gNL: 0, uC: 1 })).toEqual({ row: 1, verdict: "GROWS" });
    expect(armVerdict("C", cnt(5), { gNL: 0, uC: 12 })).toEqual({ row: 1, verdict: "GROWS" });
    expect(armVerdict("C", cnt(5), { gNL: 1, uC: 12 })).toEqual({ row: 1, verdict: "GROWS" });
  });
  it("7.5 row 1 fails for 4 against 1 and 5 against 2 (Fisher p 0.103 and 0.083), which are row 2", () => {
    expect(armVerdict("C", cnt(4, 1), { gNL: 1, uC: 12 })).toEqual({ row: 2, verdict: "UNDISTINGUISHED" });
    expect(armVerdict("C", cnt(5), { gNL: 2, uC: 12 })).toEqual({ row: 2, verdict: "UNDISTINGUISHED" });
  });
  it("7.5 row 1 needs mutants to have reached 64 cells: median supply below 1 makes it UNDISTINGUISHED", () => {
    expect(armVerdict("C", cnt(5), { gNL: 0, uC: 0 })).toEqual({ row: 2, verdict: "UNDISTINGUISHED" });
    expect(armVerdict("C", cnt(5), { gNL: 0, uC: 0.5 })).toEqual({ row: 2, verdict: "UNDISTINGUISHED" });
  });
  it("7.5 row 2 UNDISTINGUISHED: arm C, g_L >= 3 and not row 1", () => {
    expect(armVerdict("C", cnt(3, 2), { gNL: 0, uC: 5 })).toEqual({ row: 2, verdict: "UNDISTINGUISHED" });
    expect(armVerdict("C", cnt(2, 3), { gNL: 0, uC: 5 }).row).toBe(4); // g_L = 2: no row 2; k_s = 5 -> STABLE
  });
  it("7.5 row 3 COLLAPSE: k_c = g_M + g_E >= 3, for any arm", () => {
    for (const arm of ARMS) expect(armVerdict(arm, cnt(0, 2, 0, 2, 1), { gNL: 0, uC: 0 })).toEqual({ row: 3, verdict: "COLLAPSE" });
    expect(armVerdict("A", cnt(0, 0, 0, 3, 0), { gNL: null, uC: null }).verdict).toBe("COLLAPSE");
    expect(armVerdict("A", cnt(0, 0, 0, 0, 3), { gNL: null, uC: null }).verdict).toBe("COLLAPSE");
    expect(armVerdict("A", cnt(0, 3, 0, 1, 1), { gNL: null, uC: null }).verdict).toBe("STABLE"); // k_c = 2: no collapse
  });
  it("7.5 row 4 STABLE: k_s = g_T + g_L >= 3 (a clean 3-cycle or longer in most seeds)", () => {
    expect(armVerdict("Z", cnt(0, 3, 2), { gNL: null, uC: null })).toEqual({ row: 4, verdict: "STABLE" });
    expect(armVerdict("W", cnt(1, 2, 2), { gNL: null, uC: null }).verdict).toBe("STABLE");
    expect(armVerdict("N", cnt(2, 1, 2), { gNL: null, uC: null }).verdict).toBe("STABLE");
  });
  it("7.5 row 5 INCONCLUSIVE: otherwise", () => {
    expect(armVerdict("A", cnt(0, 2, 2, 1, 0), { gNL: null, uC: null })).toEqual({ row: 5, verdict: "INCONCLUSIVE" });
    expect(armVerdict("B", cnt(0, 0, 5), { gNL: null, uC: null }).row).toBe(5);
    expect(armVerdict("C", cnt(2, 0, 2, 1), { gNL: 0, uC: 5 }).row).toBe(5);
  });
  it("7.5 rows 3 and 4 cannot both hold with five runs (3 + 3 > 5), and rows 1 and 2 are for arm C only", () => {
    for (let t = 0; t <= 5; t++) for (let l = 0; l + t <= 5; l++) for (let m = 0; m + l + t <= 5; m++) {
      const e = 5 - t - l - m;
      const c = cnt(l, t, 0, m, e);
      expect(c.gM + c.gE >= 3 && c.gT + c.gL >= 3).toBe(false);
    }
    expect(armVerdict("B", cnt(5), { gNL: 0, uC: 9 }).verdict).toBe("STABLE"); // not GROWS: arm B is not tested for growth
    expect(armVerdict("A", cnt(4, 1), { gNL: 0, uC: 9 }).verdict).toBe("STABLE");
  });
  it("7.5 arm C needs arm N's LONG count and the median supply", () => {
    expect(() => armVerdict("C", cnt(5), { gNL: null, uC: null })).toThrow(/needs arm N/);
  });
  it("7.3/7.5 countClasses and the horizon check of 7.4: void iff g_M + g_E >= 3 in arm Z", () => {
    expect(countClasses([{ cls: "LONG" }, { cls: "THREE" }, { cls: "THREE" }, { cls: "MONO" }, { cls: "EXTINCT" }])).toEqual({ gL: 1, gT: 2, gLo: 0, gM: 1, gE: 1 });
    expect(horizonVoid(cnt(0, 2, 0, 2, 1))).toBe(true);
    expect(horizonVoid(cnt(0, 3, 0, 1, 1))).toBe(false);
    expect(horizonVoid(cnt(0, 0, 0, 0, 3))).toBe(true);
  });
});

describe("7 the mutation stage end to end, from synthetic jobs", () => {
  // a sweep with a go row (A1) whose spread* is 4
  const goSweep = () => evaluateSweep(sweepJobs({ 4: { treat: five("DC") }, 8: { treat: five("DC") }, 12: { treat: five("DC") }, 20: { treat: five("DC") }, 28: { treat: five({ LOSS: 5 }) } }), OP);
  const T5: MutKind[] = ["THREE", "THREE", "THREE", "THREE", "THREE"];
  const L5: MutKind[] = ["LOOSE", "LOOSE", "LOOSE", "LOOSE", "LOOSE"];
  const run = (kinds: Partial<Record<Arm, MutKind[]>>, o: Parameters<typeof mutationJobs>[1] = {}) => evaluateMutation(mutationJobs(kinds, { spreadStar: 4, ...o }), OP, goSweep());
  const verdictOf = (r: ReturnType<typeof run>, arm: Arm) => r.arms.find((a) => a.arm === arm)!.verdict;
  const FULL: Partial<Record<Arm, MutKind[]>> = { Z: T5, A: T5, B: L5, C: ["LONG", "LONG", "LONG", "LONG", "THREE"], N: L5, W: T5 };

  it("7.1 closed when 4.4 gave no go row: 'mutation runs not made: gate closed'", () => {
    const closed = evaluateMutation([], OP, evaluateSweep(sweepJobs(Object.fromEntries(grid.map((v) => [v, { treat: five("FC" as ClassSpec) }]))), OP));
    expect(closed.status).toBe("closed");
    expect(closed.problems.code).toBe(0);
  });
  it("7.1 pending while the sweep is incomplete (exit 4)", () => {
    const r = evaluateMutation([], OP, evaluateSweep([], OP));
    expect(r.status).toBe("pending");
    expect(r.problems.code).toBe(4);
  });
  describe("7.2 an arm is its settings: a mislabelled file is unusable input (Codex finding 10, conformance F13)", () => {
    const msgs = (r: { problems: Problems }) => r.problems.list.map((p) => p.message).join(" | ");
    const withPatch = (arm: Arm, patch: Record<string, unknown>, o: { op?: typeof OP; scale?: number } = {}) => {
      const jobs = mutationJobs({ Z: T5, [arm]: T5 }, { spreadStar: 4, scale: o.scale });
      Object.assign(jobs.find((j) => j.s.arm === arm)!.s, patch);
      return evaluateMutation(jobs, o.op ?? OP, goSweep());
    };
    it("the arms of the 7.2 table, as the fixtures write them, are accepted", () => {
      expect(run(FULL).problems.code).toBe(0);
    });
    it("a run labelled Z that was run with mutation is not the unmutated horizon control", () => {
      const r = withPatch("Z", { mutRate: 42950 });
      expect(r.problems.code).toBe(2);
      expect(msgs(r)).toMatch(/arm Z is not run as 7\.2 says: mutRate is 42950, the table gives floor\(0 \/ 1\) = 0/);
    });
    it("rpsTypes, rpsFlip and rpsEdge must be the arm's", () => {
      expect(msgs(withPatch("A", { edge: 128 }))).toMatch(/arm A is not run as 7\.2 says: rpsEdge is 128, the table gives 256/);
      expect(msgs(withPatch("B", { types: 3 }))).toMatch(/rpsTypes is 3, the table gives 5/);
      expect(msgs(withPatch("C", { flip: 0 }))).toMatch(/rpsFlip is 0, the table gives 4294967295/);
      expect(msgs(withPatch("W", { mutRate: 42950 }))).toMatch(/mutRate is 42950, the table gives floor\(429497 \/ 1\) = 429497/);
    });
    it("a setting the summary does not record cannot be checked and is unusable input", () => {
      expect(msgs(withPatch("A", { flip: null }))).toMatch(/rpsFlip is not recorded/);
      expect(msgs(withPatch("C", { mutRate: null }))).toMatch(/mutRate is not recorded/);
    });
    it("K0 is 3 in every arm", () => {
      expect(msgs(withPatch("A", { K0: 4 }))).toMatch(/K0 is 4, but section 7 runs with 3/);
    });
    it("at a substrate of matter scale s each arm uses floor(S0 rate / s) (S1: 4, S2: 8), W included: exactly that integer and no neighbour (final review, finding 7)", () => {
      const s1 = { ...OP, rung: "S1" as const, substrate: "S1" as const };
      const jobs = mutationJobs(FULL, { spreadStar: 4, scale: 4 });
      expect(evaluateMutation(jobs, s1, goSweep()).problems.code).toBe(0);
      // the unscaled rate on a scale-4 substrate is the wrong rate
      expect(msgs(evaluateMutation(mutationJobs(FULL, { spreadStar: 4 }), s1, goSweep()))).toMatch(/mutRate is 42950, the table gives floor\(42950 \/ 4\) = 10737 \(matter scale of S1\)/);
      const accepted = (arm: Arm, got: number, op: typeof OP, scale: number) => {
        const j = mutationJobs({ Z: T5, [arm]: T5 }, { spreadStar: 4, scale });
        Object.assign(j.find((x) => x.s.arm === arm)!.s, { mutRate: got });
        return !evaluateMutation(j, op, goSweep()).problems.has(2); // the other arms are still to run (exit 4); only the settings are in question
      };
      // S1: 42,950 / 4 = 10,737.5 and 429,497 / 4 = 107,374.25
      expect([10736, 10737, 10738].map((got) => accepted("A", got, s1, 4))).toEqual([false, true, false]);
      expect([107373, 107374, 107375].map((got) => accepted("W", got, s1, 4))).toEqual([false, true, false]);
      // S2: 42,950 / 8 = 5,368.75 and 429,497 / 8 = 53,687.125
      const s2 = { ...OP, rung: "S2" as const, substrate: "S2" as const };
      expect(evaluateMutation(mutationJobs(FULL, { spreadStar: 4, scale: 8 }), s2, goSweep()).problems.code).toBe(0);
      expect([5367, 5368, 5369].map((got) => accepted("C", got, s2, 8))).toEqual([false, true, false]);
      expect([53686, 53687, 53688].map((got) => accepted("W", got, s2, 8))).toEqual([false, true, false]);
      expect([armMutRate("A", 1), armMutRate("A", 4), armMutRate("A", 8), armMutRate("W", 4), armMutRate("W", 8), armMutRate("Z", 4)]).toEqual([42950, 10737, 5368, 107374, 53687, 0]);
      expect(mutRateOk(10737, "N", 4)).toBe(true);
      expect(mutRateOk(10738, "N", 4)).toBe(false);
    });
    it("rung V takes the scale of its substrate", () => {
      const v = { ...OP, rung: "V" as const, kill: "vacancy" as const, substrate: "S1" as const };
      expect(evaluateMutation(mutationJobs(FULL, { spreadStar: 4, scale: 4 }), v, goSweep()).problems.code).toBe(0);
    });
  });
  it("7.4 arm Z needs all five runs: with fewer, the readout exits with code 4", () => {
    const r = run({ Z: ["THREE", "THREE", "THREE", "THREE"] });
    expect(r.status).toBe("pending");
    expect(r.problems.code).toBe(4);
    expect(r.missing[0]).toMatch(/arm Z: 1 of 5 runs missing/);
  });
  it("7.4 HORIZON-VOID: at least 3 of arm Z's 5 runs are MONO or EXTINCT; the other arms need not run (exit 0)", () => {
    const r = run({ Z: ["MONO", "MONO", "EXTINCT", "THREE", "THREE"] });
    expect(r.horizonVoid).toBe(true);
    expect(r.status).toBe("done");
    expect(r.problems.code).toBe(0);
    expect(r.arms.find((a) => a.arm === "Z")!.counts).toEqual({ gL: 0, gT: 2, gLo: 0, gM: 2, gE: 1 });
  });
  it("7.4 HORIZON-VOID: arms that already ran are printed with their verdicts marked void; a partial arm does not block", () => {
    const r = run({ Z: ["MONO", "MONO", "MONO", "THREE", "THREE"], A: T5, B: ["LOOSE", "LOOSE"] });
    expect(r.horizonVoid).toBe(true);
    expect(r.status).toBe("done");
    expect(verdictOf(r, "A")!.verdict).toBe("STABLE"); // computed, and void in the report
    expect(verdictOf(r, "B")).toBeNull();
    expect(r.missing).toEqual([]);
  });
  it("7.4 two MONO runs of five are not void", () => {
    const r = run({ Z: ["MONO", "MONO", "THREE", "THREE", "THREE"] });
    expect(r.horizonVoid).toBe(false);
    expect(r.status).toBe("pending"); // the other arms are due
    expect(r.problems.code).toBe(4);
    expect(r.missing.join()).toMatch(/arm A: not run/);
  });
  it("7.1 the other five arms are queued only if the horizon check passed: a passed check with arms missing is exit 4", () => {
    const r = run({ Z: T5 });
    expect(r.horizonVoid).toBe(false);
    expect(r.missing).toHaveLength(5);
    expect(r.status).toBe("pending");
  });
  it("7.5 the full table: STABLE for Z, A and W; INCONCLUSIVE for B (all LOOSE); GROWS for C against a null that never forms a long cycle", () => {
    const r = run(FULL);
    expect(r.status).toBe("done");
    expect(r.problems.code).toBe(0);
    expect(r.horizonVoid).toBe(false);
    expect(verdictOf(r, "Z")).toEqual({ row: 4, verdict: "STABLE" });
    expect(verdictOf(r, "A")).toEqual({ row: 4, verdict: "STABLE" });
    expect(verdictOf(r, "W")).toEqual({ row: 4, verdict: "STABLE" });
    expect(verdictOf(r, "B")).toEqual({ row: 5, verdict: "INCONCLUSIVE" });
    expect(verdictOf(r, "C")).toEqual({ row: 1, verdict: "GROWS" });
    expect(verdictOf(r, "N")).toEqual({ row: 5, verdict: "INCONCLUSIVE" });
    const c = r.arms.find((a) => a.arm === "C")!;
    expect(c.counts).toEqual({ gL: 4, gT: 1, gLo: 0, gM: 0, gE: 0 });
    expect(c.medianSupply).toBe(5);
    expect(c.fisherP).toBeCloseTo(6 / 252, 12);
  });
  it("7.5 row 1 for 5 against 1 and not for 4 against 1: the Fisher rule through the jobs", () => {
    const five_ = run({ ...FULL, C: ["LONG", "LONG", "LONG", "LONG", "LONG"], N: ["LONG", "LOOSE", "LOOSE", "LOOSE", "LOOSE"] });
    expect(verdictOf(five_, "C")!.verdict).toBe("GROWS");
    const four = run({ ...FULL, N: ["LONG", "LOOSE", "LOOSE", "LOOSE", "LOOSE"] });
    expect(verdictOf(four, "C")!.verdict).toBe("UNDISTINGUISHED");
    expect(four.arms.find((a) => a.arm === "C")!.fisherP).toBeGreaterThan(0.05);
  });
  it("7.5 row 1 needs the median supply of arm C's runs to be at least 1", () => {
    const r = run(FULL, { supply: { C: [0, 0, 0, 5, 7] } });
    expect(r.arms.find((a) => a.arm === "C")!.medianSupply).toBe(0);
    expect(verdictOf(r, "C")!.verdict).toBe("UNDISTINGUISHED");
    const ok = run(FULL, { supply: { C: [0, 0, 1, 5, 7] } });
    expect(verdictOf(ok, "C")!.verdict).toBe("GROWS");
  });
  it("7.5 row 3 COLLAPSE and row 5 INCONCLUSIVE through the jobs (MONO, EXTINCT and LOOSE)", () => {
    const r = run({ ...FULL, A: ["MONO", "MONO", "EXTINCT", "THREE", "THREE"], B: ["THREE", "LOOSE", "LOOSE", "MONO", "EXTINCT"] });
    expect(verdictOf(r, "A")).toEqual({ row: 3, verdict: "COLLAPSE" });
    expect(verdictOf(r, "B")).toEqual({ row: 5, verdict: "INCONCLUSIVE" });
  });
  it("7.5 arm C's rows 1 and 2 need all five runs of arm N: with fewer, exit 4", () => {
    const r = run({ ...FULL, N: ["LOOSE", "LOOSE", "LOOSE", "LOOSE"] });
    expect(r.status).toBe("pending");
    expect(r.problems.code).toBe(4);
    expect(r.missing.join()).toMatch(/arm N: 1 of 5 runs missing/);
    expect(verdictOf(r, "C")).toBeNull();
  });
  it("7.5 LONG cannot occur in arms Z, A, B or W: if it does, exit 3 (a bug in the operator or the readout)", () => {
    for (const arm of ["Z", "A", "B", "W"] as const) {
      const r = run({ ...FULL, [arm]: ["LONG", "THREE", "THREE", "THREE", "THREE"] });
      expect(r.problems.code).toBe(3);
      expect(r.problems.list.map((p) => p.message).join()).toMatch(new RegExp(`class LONG in arm ${arm}`));
    }
  });
  it("7.6 through the jobs: arm Z of five LOOSE runs is INCONCLUSIVE and not void, and arm C of five THREE runs is STABLE and meets its prediction (final review, finding 8)", () => {
    const r = run({ ...FULL, Z: L5, C: T5 });
    expect(r.horizonVoid).toBe(false);
    expect(verdictOf(r, "Z")).toEqual({ row: 5, verdict: "INCONCLUSIVE" });
    expect(verdictOf(r, "C")).toEqual({ row: 4, verdict: "STABLE" });
    expect(r.predictions.find((x) => x.arm === "Z")!.hit).toBe(false);
    expect(r.predictions.find((x) => x.arm === "C")!.hit).toBe(true);
    expect(r.predictions.find((x) => x.arm === "W")!.hit).toBe(true);
  });
  it("7.5 LONG is fine in arms C and N", () => {
    const r = run({ ...FULL, N: ["LONG", "LOOSE", "LOOSE", "LOOSE", "LOOSE"] });
    expect(r.problems.code).toBe(0);
  });
  it("7.2 each arm runs at spread* with kappa* (arm N with predation off): other values are unusable input", () => {
    expect(run(FULL, { spreadStar: 8 }).problems.code).toBe(2);
    expect(run(FULL, { kappa: 16 }).problems.code).toBe(2);
    const noArm = mutationJobs({ Z: T5 }, { spreadStar: 4 });
    noArm[0].s.arm = null;
    expect(evaluateMutation(noArm, OP, goSweep()).problems.code).toBe(2);
  });
  it("7.2 the length of a run follows T_end7 = 5 T_end: a run of another length is unusable input", () => {
    expect(run({ Z: T5 }, { n: 100 }).problems.code).toBe(2);
  });
  it("7.3 the supply is the run's largest value, and arm C's median is over its five runs", () => {
    const r = run(FULL, { supply: { C: [3, 9, 2, 100, 40] } });
    expect(r.arms.find((a) => a.arm === "C")!.medianSupply).toBe(9);
  });
});

describe("7.6 the registered predictions, checked against the verdicts", () => {
  const v = (entries: [Arm, VerdictId, ArmCounts][]) => new Map(entries.map(([a, verdict, counts]) => [a, { v: verdict, counts }]));
  type VerdictId = "GROWS" | "UNDISTINGUISHED" | "COLLAPSE" | "STABLE" | "INCONCLUSIVE";
  const hit = (p: ReturnType<typeof predictions>, arm: Arm) => p.find((x) => x.arm === arm)?.hit;
  it("7.6 Z: STABLE; W: STABLE if Z is not void; A: STABLE or COLLAPSE; C: not GROWS", () => {
    const p = predictions(v([["Z", "STABLE", cnt(0, 5)], ["W", "STABLE", cnt(0, 5)], ["A", "COLLAPSE", cnt(0, 0, 0, 5)], ["C", "UNDISTINGUISHED", cnt(3, 2)]]), false);
    expect([hit(p, "Z"), hit(p, "W"), hit(p, "A"), hit(p, "C")]).toEqual([true, true, true, true]);
    const miss = predictions(v([["Z", "COLLAPSE", cnt(0, 0, 0, 5)], ["W", "COLLAPSE", cnt(0, 0, 0, 5)], ["A", "INCONCLUSIVE", cnt(0, 2, 2, 1)], ["C", "GROWS", cnt(5)]]), false);
    expect([hit(miss, "Z"), hit(miss, "W"), hit(miss, "A"), hit(miss, "C")]).toEqual([false, false, false, false]);
  });
  it("7.6 W's prediction is not evaluated when the section is void", () => {
    const p = predictions(v([["Z", "COLLAPSE", cnt(0, 0, 0, 5)], ["W", "STABLE", cnt(0, 5)]]), true);
    expect(hit(p, "W")).toBeNull();
  });
  it("7.6 B: COLLAPSE, or INCONCLUSIVE with LOOSE the strictly commonest class", () => {
    expect(hit(predictions(v([["B", "COLLAPSE", cnt(0, 0, 0, 3, 2)]]), false), "B")).toBe(true);
    expect(hit(predictions(v([["B", "INCONCLUSIVE", cnt(0, 1, 3, 1, 0)]]), false), "B")).toBe(true);
    expect(hit(predictions(v([["B", "INCONCLUSIVE", cnt(0, 2, 2, 1, 0)]]), false), "B")).toBe(false); // LOOSE ties THREE: not strictly commonest
    expect(hit(predictions(v([["B", "STABLE", cnt(0, 3, 2)]]), false), "B")).toBe(false);
  });
  it("7.6 B: a tie for the commonest class (two LOOSE, two THREE, one MONO) is a miss, and the registered text says 'strictly more frequent than every other class' (final review, finding 8)", () => {
    const tie = cnt(0, 2, 2, 1, 0);
    expect(armVerdict("B", tie, { gNL: null, uC: null })).toEqual({ row: 5, verdict: "INCONCLUSIVE" });
    const p = predictions(v([["B", "INCONCLUSIVE", tie]]), false);
    expect(hit(p, "B")).toBe(false);
    expect(p[0].text).toBe("COLLAPSE, or INCONCLUSIVE with LOOSE strictly more frequent than every other class");
  });
  it("7.6 Z: STABLE alone, the section being void only by the horizon check of 7.4: five LOOSE runs are INCONCLUSIVE, not void, and a miss (final review, finding 8)", () => {
    const zLoose = cnt(0, 0, 5);
    expect(horizonVoid(zLoose)).toBe(false);
    expect(armVerdict("Z", zLoose, { gNL: null, uC: null })).toEqual({ row: 5, verdict: "INCONCLUSIVE" });
    const p = predictions(v([["Z", "INCONCLUSIVE", zLoose], ["W", "STABLE", cnt(0, 5)]]), horizonVoid(zLoose));
    expect(hit(p, "Z")).toBe(false);
    expect(hit(p, "W")).toBe(true); // Z is not void, so W's prediction is evaluated
    expect(p.find((x) => x.arm === "Z")!.text).toBe("STABLE; the section is void only when the horizon check of 7.4 says so");
    // the void case (three of the five MONO or EXTINCT) is a COLLAPSE of arm Z: a miss, and W is not evaluated
    const zVoid = cnt(0, 2, 0, 3);
    expect(horizonVoid(zVoid)).toBe(true);
    expect(hit(predictions(v([["Z", "COLLAPSE", zVoid], ["W", "STABLE", cnt(0, 5)]]), true), "Z")).toBe(false);
  });
  it("7.6 C: not GROWS, and STABLE is among the other verdicts: five THREE runs of arm C are a hit (final review, finding 8)", () => {
    const cThree = cnt(0, 5);
    expect(armVerdict("C", cThree, { gNL: 0, uC: 3 })).toEqual({ row: 4, verdict: "STABLE" });
    const p = predictions(v([["C", "STABLE", cThree]]), false);
    expect(hit(p, "C")).toBe(true);
    expect(p[0].text).toBe("not GROWS (UNDISTINGUISHED, COLLAPSE, STABLE or INCONCLUSIVE)");
    expect(hit(predictions(v([["C", "GROWS", cnt(5)]]), false), "C")).toBe(false);
  });
});

// ===================================================================================================================
// the command line: the frozen rules, --draft, the loaders and the exit codes
// ===================================================================================================================


const ROOT = "/repo";
const RULES = "frozen rules text\n";
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const frozen = (extra: Record<string, string | Uint8Array> = {}): Record<string, string | Uint8Array> => ({
  [`${ROOT}/experiments/3d-rps/RULES.md`]: RULES,
  [`${ROOT}/experiments/3d-rps/FROZEN`]: `${sha(RULES)}  RULES.md\n`,
  ...extra,
});
const DRAFT_FILE = { [`${ROOT}/runs/rps/rule-draft.md`]: "draft rules\n" };
const OP_FILE = { "/op.json": JSON.stringify({ operatingPoint: OP }) };
/** The Gate-0 record of the tests: Markdown with the operating point of `OP` in a json block, but for `kappaStar`, which only the calibration gives. */
const RECORD = `# Gate-0 record (a test fixture)\n\nGO: rung S0.\n\n\`\`\`json\n${JSON.stringify({ operatingPoint: { ...OP, kappaStar: undefined } }, null, 2)}\n\`\`\`\n`;
const RECORD_PATH = `${ROOT}/experiments/3d-rps/GATE0-RECORD.md`;
const FROZEN_PATH = `${ROOT}/experiments/3d-rps/FROZEN`;
/** RULES.md frozen, and the Gate-0 record present with its hash recorded in a dated line: what a registered Part B readout needs (8.5). */
const registered = (extra: Record<string, string | Uint8Array> = {}, record: string = RECORD): Record<string, string | Uint8Array> => ({
  ...frozen(),
  [RECORD_PATH]: record,
  [FROZEN_PATH]: `${sha(RULES)}  RULES.md\n2026-10-26  ${sha(record)}  GATE0-RECORD.md\n`,
  ...extra,
});
const A1_JOBS = () =>
  sweepJobs({
    4: { treat: five("DC") },
    8: { treat: five("DC") },
    12: { treat: five("DC") },
    20: { treat: five("DC") },
    28: { treat: five({ LOSS: 5 }) },
  });
const SWEEP_ARGS = ["sweep", "--jobs", "/jobs", "--op", "/op.json"];
const cli = (argv: string[], files: Record<string, string | Uint8Array>) => run(argv, memIo(ROOT, files));

describe("the frozen rules (FROZEN, RULES.md)", () => {
  it("FROZEN formats: a bare hash line (like experiments/FROZEN), 'hash  file', 'file: hash', comments and blank lines", () => {
    const a = sha("a");
    const b = sha("b");
    const c = sha("c");
    const e = parseFrozen(`# frozen 2026-10-25\n\n${a}\n${b}  RULES.md\n${c} *GATE0-RECORD.md\nRULES.md: ${a.toUpperCase()}  # amended\nnot a hash\n`);
    expect(e).toEqual([
      { hash: a, file: null },
      { hash: b, file: "RULES.md" },
      { hash: c, file: "GATE0-RECORD.md" },
      { hash: a, file: "RULES.md" },
    ]);
  });
  it("FROZEN lines may be dated, before or after the hash, or carry words of prose: the file is the word that ends in .md (the Gate-0 record is appended in a dated line)", () => {
    const a = sha("a");
    const b = sha("b");
    const c = sha("c");
    const d = sha("d");
    const e = parseFrozen(
      [
        `2026-10-26  ${a}  GATE0-RECORD.md`,
        `${b}  GATE0-RECORD.md  2026-10-26`,
        `GATE0-RECORD.md: ${c} (2026-10-26)`,
        `2026-10-26T09:30:00Z ${d} Gate-0 record GATE0-RECORD.md`,
        `${a}  RULES.md  # frozen 2026-10-25`,
        `2026-10-25 ${b}`,
        `2026-10-27 amendment 1 ${c}`,
      ].join("\n"),
    );
    expect(e).toEqual([
      { hash: a, file: "GATE0-RECORD.md" },
      { hash: b, file: "GATE0-RECORD.md" },
      { hash: c, file: "GATE0-RECORD.md" },
      { hash: d, file: "GATE0-RECORD.md" },
      { hash: a, file: "RULES.md" },
      { hash: b, file: null },
      { hash: c, file: null },
    ]);
    // so a dated line records the Gate-0 record for the readout's check, and a dated bare hash is a bare hash
    const record = new TextEncoder().encode("# Gate-0 record\n");
    expect(checkFrozen(record, `2026-10-26  ${sha("# Gate-0 record\n")}  GATE0-RECORD.md\n`, "GATE0-RECORD.md").ok).toBe(true);
    expect(checkFrozen(record, `2026-10-26  ${sha("# Gate-0 record\n")}  RULES.md\n`, "GATE0-RECORD.md").ok).toBe(false);
  });
  it("8.3 the rules file must have a recorded hash: recorded passes, changed text is refused", () => {
    const ok = checkFrozen(new TextEncoder().encode(RULES), `${sha(RULES)}  RULES.md\n`);
    expect(ok.ok).toBe(true);
    expect(ok.sha256).toBe(sha(RULES));
    const bad = checkFrozen(new TextEncoder().encode(RULES + "an edit\n"), `${sha(RULES)}  RULES.md\n`);
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/does not record/);
  });
  it("8.3 a dated amendment that records its new hash keeps the readout working (any recorded hash of the file counts)", () => {
    const v2 = RULES + "amendment 2026-11-01\n";
    const text = `${sha(RULES)}  RULES.md\n${sha(v2)}  RULES.md\n`;
    expect(checkFrozen(new TextEncoder().encode(v2), text).ok).toBe(true);
    expect(checkFrozen(new TextEncoder().encode(RULES), text).ok).toBe(true);
  });
  it("8.3 a hash recorded for another file does not freeze this one; a bare hash does", () => {
    expect(checkFrozen(new TextEncoder().encode(RULES), `${sha(RULES)}  GATE0-RECORD.md\n`).ok).toBe(false);
    expect(checkFrozen(new TextEncoder().encode(RULES), `${sha(RULES)}\n`).ok).toBe(true);
    expect(checkFrozen(new TextEncoder().encode(RULES), "").message).toMatch(/FROZEN has no hash for RULES\.md/);
  });
  it("the readout runs when RULES.md is frozen, and says so", () => {
    const r = cli(SWEEP_ARGS, { ...registered(), ...filesOf(A1_JOBS()), ...OP_FILE });
    expect(r.code).toBe(0);
    expect(r.draft).toBe(false);
    expect(r.out).toMatch(/rules: RULES\.md sha256 [0-9a-f]{64} is recorded in FROZEN/);
    expect(r.out).toMatch(/row A1: CLIFF, lattice-like orientation/);
    expect(r.out).not.toMatch(/DRAFT/);
  });
  it("8.3 refuses (exit 2) when RULES.md differs from FROZEN, and does not read the jobs", () => {
    const r = cli(SWEEP_ARGS, { ...registered({ [`${ROOT}/experiments/3d-rps/RULES.md`]: RULES + "edited\n" }), ...filesOf(A1_JOBS()), ...OP_FILE });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/refusing to apply the rules/);
    expect(r.out).not.toMatch(/row A1/);
  });
  it("without RULES.md or without FROZEN the rules are not frozen: exit 2 and a pointer to --draft", () => {
    const noFrozen = cli(SWEEP_ARGS, { [`${ROOT}/experiments/3d-rps/RULES.md`]: RULES, ...filesOf(A1_JOBS()), ...OP_FILE });
    expect(noFrozen.code).toBe(2);
    expect(noFrozen.out).toMatch(/FROZEN not found.*--draft/);
    const none = cli(SWEEP_ARGS, { ...filesOf(A1_JOBS()), ...OP_FILE });
    expect(none.code).toBe(2);
    expect(none.out).toMatch(/RULES\.md not found/);
  });
  it("8.5 a registered Part B readout needs the Gate-0 record, completed and hashed in FROZEN (final review, finding 4)", () => {
    for (const cmd of ["meter", "calibration", "sweep", "cycles", "deep", "mutation"]) {
      const argv = [cmd, "--jobs", "/jobs", "--op", "/op.json"];
      // no record at all: exit 2, and the message says what is missing
      const none = cli(argv, { ...frozen(), ...filesOf(A1_JOBS()), ...OP_FILE });
      expect([cmd, none.code]).toEqual([cmd, 2]);
      expect(none.out).toMatch(/needs the Gate-0 record experiments\/3d-rps\/GATE0-RECORD\.md, which does not exist/);
      // a record whose hash is not recorded in FROZEN
      const unhashed = cli(argv, { ...frozen({ [RECORD_PATH]: RECORD }), ...filesOf(A1_JOBS()), ...OP_FILE });
      expect([cmd, unhashed.code]).toEqual([cmd, 2]);
      expect(unhashed.out).toMatch(/GATE0-RECORD\.md has sha256 [0-9a-f]{64}, which FROZEN does not record/);
    }
    // with the record hashed (a dated line, as 8.3 has it) the sweep runs, and says which record it used
    const ok = cli(SWEEP_ARGS, { ...registered(), ...filesOf(A1_JOBS()), ...OP_FILE });
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/Gate-0 record: GATE0-RECORD\.md sha256 [0-9a-f]{64} is recorded in FROZEN/);
    // a record edited after it was hashed is refused like RULES.md
    expect(cli(SWEEP_ARGS, { ...registered({ [RECORD_PATH]: RECORD + "an edit\n" }), ...filesOf(A1_JOBS()), ...OP_FILE }).code).toBe(2);
  });
  it("8.5 an unhashed Gate-0 record is provisional: the Gate-0 table and the lattice run on RULES.md alone and say so, so G0.6 can complete the record before its hash is taken (final review, finding 4)", () => {
    const withRecord = frozen({ [RECORD_PATH]: RECORD });
    const g = cli(["gate0", "--jobs", "/jobs"], { ...withRecord, ...filesOf(rungJobs(S0_GO)) });
    expect(g.code).toBe(0);
    expect(g.out).toMatch(/Gate-0 record: present, and its sha256 [0-9a-f]{64} is not \(yet\) recorded in FROZEN: provisional/);
    expect(g.out).toMatch(/\*\*GO: rung S0\*\*/);
    // the lattice never looks at the record
    const lat = cli(["lattice", "--lattice", "/lat"], { ...withRecord, "/lat/x.json": "{}" });
    expect(lat.out).not.toMatch(/GATE0-RECORD/);
    // once the record is hashed, the table says so; before the record exists, RULES.md alone is enough: Gate 0 itself runs on the frozen rules
    expect(cli(["gate0", "--jobs", "/jobs"], { ...registered(), ...filesOf(rungJobs(S0_GO)) }).out).toMatch(/Gate-0 record: GATE0-RECORD\.md sha256 [0-9a-f]{64} is recorded in FROZEN/);
    expect(cli(["gate0", "--jobs", "/jobs"], { ...frozen(), ...filesOf(rungJobs(S0_GO)) }).code).toBe(0);
    // an unrecorded RULES.md is still refused for the Gate-0 table
    expect(cli(["gate0", "--jobs", "/jobs"], { ...withRecord, [`${ROOT}/experiments/3d-rps/RULES.md`]: RULES + "edited\n", ...filesOf(rungJobs(S0_GO)) }).code).toBe(2);
  });
  it("8.5 a registered readout takes its operating point from the hashed record: a --op file that differs in a field the record holds is refused (final review, finding 2)", () => {
    const withOp = (o: Record<string, unknown>) => ({ "/op.json": JSON.stringify({ operatingPoint: { ...OP, ...o } }) });
    const sweep = (o: Record<string, unknown>, files = registered()) => cli(SWEEP_ARGS, { ...files, ...filesOf(A1_JOBS()), ...withOp(o) });
    expect(sweep({}).code).toBe(0);
    // kappa* is the calibration's addition: the record holds none, so the file may carry any (here none, and the sweep's one rate stands in)
    expect(sweep({ kappaStar: undefined }).code).toBe(0);
    // the scenario of the review: the record's grid has five spreads and the file only the first four (A3 instead of A1), or another h0, rate, spread or dense rate
    for (const [field, value] of [["gSpread", G_5.slice(0, 4)], ["vCal", G_5[0]], ["kappaW", 8], ["rCal", [8, 16, 32]], ["h0", 100_000], ["denseRate", 500], ["rung", "S1"], ["kill", "vacancy"], ["shape", [256, 256, 4]]] as const) {
      const r = sweep({ [field]: value });
      expect([field, r.code]).toEqual([field, 2]);
      expect(r.out).toMatch(new RegExp(`is not the operating point of the hashed Gate-0 record \\(8\\.5\\):.*${field}: --op has`));
      expect(r.out).not.toMatch(/row A/);
    }
    // a record that holds a kappa* must agree with the file on it
    const star = (k: number) => `# Gate-0 record\n\n\`\`\`json\n${JSON.stringify({ operatingPoint: { ...OP, kappaStar: k } })}\n\`\`\`\n`;
    expect(sweep({}, registered({}, star(32))).code).toBe(0);
    const bad = sweep({}, registered({}, star(16)));
    expect(bad.code).toBe(2);
    expect(bad.out).toMatch(/kappaStar: --op has 32, the record has 16/);
    // a GATE-0-STOP record holds no operating point: the registered kernel stages have nothing to run on
    const stop = "# Gate-0 record\n\nGATE-0-STOP: no rung gives GO; the operating point and the dense rate are not applicable.\n";
    const none = sweep({}, registered({}, stop));
    expect(none.code).toBe(2);
    expect(none.out).toMatch(/holds no usable operating point/);
    // the same binding for every registered command
    for (const cmd of ["meter", "calibration", "cycles", "deep", "mutation"]) {
      const r = cli([cmd, "--jobs", "/jobs", "--op", "/op.json"], { ...registered(), ...filesOf(A1_JOBS()), ...withOp({ kappaW: 8 }) });
      expect([cmd, r.code]).toEqual([cmd, 2]);
      expect(r.out).toMatch(/kappaW: --op has 8, the record has 16/);
    }
    // --draft is a look before the freeze and needs no record
    expect(cli([...SWEEP_ARGS, "--draft"], { ...DRAFT_FILE, ...filesOf(A1_JOBS()), ...withOp({ kappaW: 8 }) }).code).toBe(0);
  });
  it("8.5 operatingPointDiffs lists the fields in which two operating points differ, and none for kappaStar when the record holds none", () => {
    expect(operatingPointDiffs(OP, { ...OP, kappaStar: null })).toEqual([]);
    expect(operatingPointDiffs({ ...OP, kappaStar: undefined }, OP)).toHaveLength(1);
    expect(operatingPointDiffs({ ...OP, gSpread: [4, 8], kappaW: 8 }, { ...OP, kappaStar: null }).map((d) => d.split(":")[0])).toEqual(["gSpread", "kappaW"]);
  });
  it("--draft reads runs/rps/rule-draft.md, needs no FROZEN, and labels every heading and the exit line DRAFT", () => {
    const r = cli([...SWEEP_ARGS, "--draft"], { ...DRAFT_FILE, ...filesOf(A1_JOBS()), ...OP_FILE });
    expect(r.code).toBe(0);
    expect(r.draft).toBe(true);
    expect(r.out).toMatch(/\*\*DRAFT rules\*\* .*rule-draft\.md, sha256 [0-9a-f]{64}/);
    const headings = r.out.split("\n").filter((l) => l.startsWith("#"));
    expect(headings.length).toBeGreaterThan(0);
    expect(headings.every((h) => h.includes("[DRAFT]"))).toBe(true);
    expect(r.out).toMatch(/exit code 0: a verdict \[DRAFT\]/);
  });
  it("--draft without runs/rps/rule-draft.md is exit 2", () => {
    expect(cli([...SWEEP_ARGS, "--draft"], { ...filesOf(A1_JOBS()), ...OP_FILE }).code).toBe(2);
  });
  it("--json prints the structured result, labelled DRAFT or FROZEN", () => {
    const j = JSON.parse(cli([...SWEEP_ARGS, "--json"], { ...registered(), ...filesOf(A1_JOBS()), ...OP_FILE }).out);
    expect(j).toMatchObject({ code: 0, status: "FROZEN", draft: false, problems: [], result: { status: "done", outcome: { row: "A1" }, spreadStar: 4 } });
    const d = JSON.parse(cli([...SWEEP_ARGS, "--json", "--draft"], { ...DRAFT_FILE, ...filesOf(A1_JOBS()), ...OP_FILE }).out);
    expect(d.status).toBe("DRAFT");
    expect(d.result.jobs).toHaveLength(40); // one compact row per job: no census rows, no prepared rows
    expect(d.result.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ stage: "sweep", class: "DC", spread: 4, rate: 32, seed: 211 })]));
    expect(JSON.stringify(d)).not.toMatch(/burnLast|"rows"/);
    const g = JSON.parse(cli(["gate0", "--jobs", "/jobs", "--json"], { ...frozen(), ...filesOf(rungJobs(S0_GO)) }).out);
    // nothing the rules need is lost from the JSON: the table cells with their works flags, the grid, the horizon, the verdict
    expect(g.result.rungs[0].table.cells).toHaveLength(15);
    expect(g.result.rungs[0].table.cells.filter((c: { works: boolean }) => c.works)).toHaveLength(9);
    expect(g.result.rungs[0].gSpread).toEqual(G_5);
    expect(g.result.rungs[0].controls["12"]).toMatchObject({ informative: true });
    expect(g.result.rungs[0].horizon.Tctl).toBe("Infinity");
    expect(g.result.overall).toEqual({ status: "go", used: "S0" });
    const c = JSON.parse(cli(["calibration", "--jobs", "/jobs", "--op", "/op.json", "--json"], { ...registered(), ...filesOf(calibrationJobs({ 8: ["CHURN", "CHURN"], 16: ["DC", "DC"], 32: ["DC", "DC"], 64: ["DC", "DC"] })), ...OP_FILE }).out);
    expect(c.result.rows).toHaveLength(4);
    expect(c.result.kappaStar).toBe(16);
    const lat = JSON.parse(cli(["lattice", "--lattice", "/lat", "--json"], { ...frozen(), "/lat/x.json": "{}" }).out);
    expect(lat.code).toBe(2);
    expect(g.result.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ stage: "g0.scan", rung: "S0", spread: 12, class: "CHURN" })]));
    expect(g.result.operatingPoint).toMatchObject({ rung: "S0", kappaW: 16 });
    expect(JSON.stringify(g)).not.toMatch(/burnLast|"rows"|censusText/);
  });
});

describe("exit codes 0, 2, 3 and 4 (8.4)", () => {
  const files = (jobs: readonly Job[] = A1_JOBS()) => ({ ...registered(), ...filesOf(jobs), ...OP_FILE });
  it("8.4 exit 0: a verdict", () => {
    expect(cli(SWEEP_ARGS, files()).code).toBe(0);
  });
  it("8.4 exit 4: jobs still missing (the partial table is printed and the jobs to run are named)", () => {
    const jobs = A1_JOBS().filter((j) => !(j.s.spread === 8 && j.s.seed === 213 && j.s.rate === 32));
    const r = cli(SWEEP_ARGS, files(jobs));
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/jobs to run \(1\): sweep spread 8 rate 32 seed 213/);
    expect(r.out).toMatch(/exit code 4: jobs still missing/);
  });
  it("8.4 exit 3: a bug indicator (nonzero residual)", () => {
    const jobs = A1_JOBS();
    jobs[3] = mkJob({ stage: "sweep", seed: jobs[3].s.seed, spread: jobs[3].s.spread!, rate: jobs[3].s.rate!, nRun: 50, cls: "DC", residual: "9" });
    const r = cli(SWEEP_ARGS, files(jobs));
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/nonzero energy residual 9/);
  });
  it("8.4 exit 2: unusable input (a malformed summary.json, an unknown stage, a broken census.tsv, no jobs at all)", () => {
    const base = files();
    const firstKey = Object.keys(base).find((k) => k.endsWith("summary.json"))!;
    expect(cli(SWEEP_ARGS, { ...base, [firstKey]: "{not json" }).code).toBe(2);
    expect(cli(SWEEP_ARGS, { ...base, [firstKey]: JSON.stringify({ stage: "warmup", seed: 1 }) }).code).toBe(2);
    const censusKey = Object.keys(base).find((k) => k.endsWith("census.tsv"))!;
    expect(cli(SWEEP_ARGS, { ...base, [censusKey]: "phase\tstep\n" }).out).toMatch(/no turnover column|census\.tsv/);
    expect(cli(SWEEP_ARGS, { ...base, [censusKey]: "phase\tstep\n" }).code).toBe(2);
    expect(cli(SWEEP_ARGS, { ...registered(), ...OP_FILE }).code).toBe(2);
  });
  it("8.4 priority: unusable input (2) before a bug indicator (3) before missing jobs (4)", () => {
    const jobs = A1_JOBS().slice(2); // the jobs of seeds 211 and 212 at spread 4 are missing: 4
    const bug = mkJob({ stage: "sweep", seed: 211, spread: 4, rate: 32, nRun: 50, cls: "DC", residual: "3", id: "bug" }); // seed 211 is back, with a residual: 3
    expect(cli(SWEEP_ARGS, files([...jobs, bug])).code).toBe(3);
    const base = files([...jobs, bug]);
    const key = Object.keys(base).find((k) => k.endsWith("summary.json") && !k.includes("bug"))!;
    expect(cli(SWEEP_ARGS, { ...base, [key]: "{" }).code).toBe(2);
  });
  it("exit 2 for a bad command line: unknown command, missing --jobs, missing --op, unknown option, an option without a value", () => {
    expect(cli(["frobnicate"], frozen()).code).toBe(2);
    expect(cli([], frozen()).code).toBe(2);
    expect(cli(["sweep", "--op", "/op.json"], files()).code).toBe(2);
    expect(cli(["sweep", "--jobs", "/jobs"], files()).out).toMatch(/needs --op/);
    expect(cli([...SWEEP_ARGS, "--bogus", "1"], files()).code).toBe(2);
    expect(cli(["sweep", "--jobs"], files()).code).toBe(2);
    expect(cli(["sweep", "--jobs", "/jobs", "--op", "/nope.json"], files()).code).toBe(2);
  });
  it("a situation no row covers exits 3 (Gate 0: rung V jobs with no substrate rung that passed row 1)", () => {
    const jobs = [...rungJobs(levelsOf("S0")), ...rungJobs(levelsOf("S1")), ...rungJobs(levelsOf("S2")), ...vJobs(V_GO)];
    const r = cli(["gate0", "--jobs", "/jobs"], { ...frozen(), ...filesOf(jobs) });
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/no substrate rung passed row 1/);
  });
  it("the gate0 command prints the verdict, the operating point as JSON, and every job", () => {
    const r = cli(["gate0", "--jobs", "/jobs"], { ...frozen(), ...filesOf(rungJobs(S0_GO)) });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\*\*GO: rung S0\*\*/);
    const block = /```json\n([\s\S]*?)\n```/.exec(r.out)![1];
    expect(JSON.parse(block).operatingPoint).toMatchObject({ rung: "S0", kappaW: 16, vCal: 12, gSpread: G_5 });
    // the printed operating point is accepted as the --op of the later stages
    expect(parseOperatingPoint(block, "gate0-output.json").rCal).toEqual([8, 16, 32, 64]);
    expect(r.out).toMatch(/### Gate-0 jobs \(8\.5\)/);
  });
  it("the gate0 command prints a void V as void (the heading and the verdict say so), exits 3 and prints no operating point from it (G0.1, conformance F9)", () => {
    const jobs = [...rungJobs(effectOf("S0", true)), ...rungJobs(effectOf("S1")), ...vJobs({ ...V_GO, vcheck: "different" })];
    const r = cli(["gate0", "--jobs", "/jobs"], { ...frozen(), ...filesOf(jobs) });
    expect(r.code).toBe(3);
    expect(r.out).toMatch(/### Rung V \(vacancy kill on S0\): GO \(row 5\) VOID: no V job counts \(the V check is different, G0\.1\)/);
    expect(r.out).toMatch(/rung V is void \(the V check is different\): its verdict above never decides/);
    expect(r.out).toMatch(/\*\*GATE-0-STOP\*\*/);
    expect(r.out).not.toMatch(/operating point \(for the Gate-0 record\)/);
    // an identical check prints no such marker, and V is used
    const ok = cli(["gate0", "--jobs", "/jobs"], { ...frozen(), ...filesOf([...rungJobs(effectOf("S0", true)), ...rungJobs(effectOf("S1")), ...vJobs(V_GO)]) });
    expect(ok.code).toBe(0);
    expect(ok.out).not.toMatch(/VOID/);
    expect(ok.out).toMatch(/\*\*GO: rung V\*\*/);
  });
  it("the gate0 command: exit 4 while a rung has jobs to run, naming them", () => {
    const r = cli(["gate0", "--jobs", "/jobs"], { ...frozen(), ...filesOf(rungJobs({ ...S0_GO, noScan: [6] })) });
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/jobs to run .*g0\.scan S0 spread 6/);
    expect(r.out).toMatch(/\*\*pending\*\*/);
  });
});

describe("the other commands through the command line", () => {
  const files = (jobs: readonly Job[], extra: Record<string, string | Uint8Array> = {}) => ({ ...registered(), ...filesOf(jobs), ...OP_FILE, ...extra });
  const latFiles = (cells: ReturnType<typeof latticeCells>): Record<string, string> =>
    Object.fromEntries(
      cells.map((c) => {
        const iL = [20, 30, 40, 60, 100].indexOf(c.L);
        const first = 2_000_000 + 100_000 * iL + 1_000 * c.iM;
        return [`/lat/L${c.L}-iM${c.iM}.json`, JSON.stringify({ L: c.L, M: c.M, iM: c.iM, N: c.L * c.L, epsilon: (c.M * c.L * c.L) / 2, epsOverN: c.M / 2, twoEpsOverN: c.M, R: c.R, k: c.k, pExt: c.k / c.R, absorbedBy: [], seeds: [first, first + c.R - 1], seconds: 1, eventsPerSecond: 1e7 })];
      }),
    );
  it("lattice: LAT-PASS from the per-(L, M) files; the report has the P_ext table, the pairs and the row", () => {
    const r = cli(["lattice", "--lattice", "/lat"], { ...frozen(), ...latFiles(latticeCells(logisticP(3.5e-4, STEEP))) });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\*\*row 1: LAT-PASS\*\*/);
    expect(r.out).toMatch(/P_ext = k \/ R/);
    expect(r.out).toMatch(/R3: P_ext\(60, 2e-3\)/);
  });
  it("lattice: rows 3 to 5 without the L = 100 cells is exit 4 (the contingency of 2.7 is due); with them, LAT-FAIL is a verdict", () => {
    const main = latticeCells(logisticP(1.2e-3, STEEP));
    const r = cli(["lattice", "--lattice", "/lat"], { ...frozen(), ...latFiles(main) });
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/LAT-OFFSET/);
    const all = latticeCells(logisticP(1.2e-3, STEEP), (M) => logisticP(1.2e-3, STEEP)(100, M));
    expect(all.filter((c) => c.L === 100)).toHaveLength(LAT_CONTINGENCY_M.length);
    const f = cli(["lattice", "--lattice", "/lat"], { ...frozen(), ...latFiles(all) });
    expect(f.code).toBe(0);
    expect(f.out).toMatch(/outcome after the contingency: LAT-FAIL/);
  });
  it("lattice: the sweep driver's own files are read as they are: chunk files and other JSON are not cells, se and mode are checked", () => {
    const cells = latticeCells(logisticP(3.5e-4, STEEP));
    const withExtras = latFiles(cells);
    for (const [k, v] of Object.entries(withExtras)) {
      const o = JSON.parse(v);
      withExtras[k] = JSON.stringify({ ...o, format: "rmf-cell/1", mode: "sweep", se: addOneSE(o.k, o.R), pAddOne: (o.k + 1) / (o.R + 2), host: "x" });
    }
    withExtras["/lat/chunks/L20-iM0-r000-600.json"] = JSON.stringify({ L: 20, iM: 0, rStart: 0, rEnd: 600, k: 12 });
    withExtras["/lat/manifest.json"] = JSON.stringify({ note: "not a cell" });
    const r = cli(["lattice", "--lattice", "/lat"], { ...frozen(), ...withExtras });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/LAT-PASS/);
    // a rehearsal cell, or a cell whose stored se disagrees with the add-one error, is unusable input
    const key = Object.keys(withExtras).find((k) => k.endsWith("L20-iM0.json"))!;
    expect(cli(["lattice", "--lattice", "/lat"], { ...frozen(), ...withExtras, [key]: withExtras[key].replace('"mode":"sweep"', '"mode":"rehearsal"') }).code).toBe(2);
    expect(cli(["lattice", "--lattice", "/lat"], { ...frozen(), ...withExtras, [key]: JSON.stringify({ ...JSON.parse(withExtras[key]), se: 0.5 }) }).code).toBe(2);
    expect(cli(["lattice", "--lattice", "/lat"], { ...frozen(), "/lat/manifest.json": "{}" }).code).toBe(2);
  });
  it("lattice: bad files are exit 2 (rehearsal data with R = 50, or an empty directory)", () => {
    const bad = latFiles(latticeCells(logisticP(3.5e-4, STEEP)));
    const key = Object.keys(bad)[0];
    bad[key] = bad[key].replace('"R":600', '"R":50');
    expect(cli(["lattice", "--lattice", "/lat"], { ...frozen(), ...bad }).code).toBe(2);
    expect(cli(["lattice", "--lattice", "/lat"], frozen()).code).toBe(2);
    expect(cli(["lattice"], frozen()).out).toMatch(/needs --lattice/);
  });
  it("meter: D_lab over G_spread and the ordering check", () => {
    const meters = [4, 8, 12, 20, 28].flatMap((v, k) => (["x", "y"] as const).map((axis) => meterJob({ stage: "meter", spread: v, axis, D: 0.01 * (k + 1), seed: 205 })));
    const r = cli(["meter", "--jobs", "/jobs"].concat(["--op", "/op.json"]), files(meters));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Mobility meter \(rules 3\.1\)/);
    const down = [4, 8, 12, 20, 28].flatMap((v, k) => (["x", "y"] as const).map((axis) => meterJob({ stage: "meter", spread: v, axis, D: k === 2 ? 0.001 : 0.01 * (k + 1), seed: 205 })));
    expect(cli(["meter", "--jobs", "/jobs", "--op", "/op.json"], files(down)).code).toBe(3);
  });
  it("calibration: kappa* or KAPPA-NONE, and the table", () => {
    const r = cli(["calibration", "--jobs", "/jobs", "--op", "/op.json"], files(calibrationJobs({ 8: ["CHURN", "CHURN"], 16: ["DC", "DC"], 32: ["DC", "DC"], 64: ["DC", "DC"] })));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\*\*kappa\* = 16\*\*/);
    const none = cli(["calibration", "--jobs", "/jobs", "--op", "/op.json"], files(calibrationJobs({ 8: ["CHURN", "CHURN"], 16: ["CHURN", "CHURN"], 32: ["CHURN", "CHURN"], 64: ["CHURN", "CHURN"] })));
    expect(none.code).toBe(0);
    expect(none.out).toMatch(/\*\*KAPPA-NONE\*\*/);
  });
  it("cycles: the gate and the VIABLE table", () => {
    const cyc = (K0: 4 | 5, sd: number) => mkJob({ stage: "cycles", seed: sd, spread: 4, rate: 32, K0, types: K0, nRun: 50, cls: "DC" });
    const r = cli(["cycles", "--jobs", "/jobs", "--op", "/op.json"], files([...A1_JOBS(), cyc(4, 241), cyc(4, 242), cyc(4, 243), cyc(5, 244), cyc(5, 245), cyc(5, 246)]));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/K0 = 4: 3 of 3 VIABLE, arm viable; K0 = 5: 3 of 3 VIABLE, arm viable/);
  });
  it("mutation: HORIZON-VOID is printed and the other arms are not required", () => {
    const jobs = [...A1_JOBS(), ...mutationJobs({ Z: ["MONO", "MONO", "MONO", "THREE", "THREE"] }, { spreadStar: 4 })];
    const r = cli(["mutation", "--jobs", "/jobs", "--op", "/op.json"], files(jobs));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\*\*HORIZON-VOID\*\*/);
  });
  it("mutation: the full table with the GROWS verdict and the registered predictions", () => {
    const FULLK: Partial<Record<Arm, MutKind[]>> = { Z: ["THREE", "THREE", "THREE", "THREE", "THREE"], A: ["THREE", "THREE", "THREE", "THREE", "THREE"], B: ["LOOSE", "LOOSE", "LOOSE", "LOOSE", "LOOSE"], C: ["LONG", "LONG", "LONG", "LONG", "THREE"], N: ["LOOSE", "LOOSE", "LOOSE", "LOOSE", "LOOSE"], W: ["THREE", "THREE", "THREE", "THREE", "THREE"] };
    const r = cli(["mutation", "--jobs", "/jobs", "--op", "/op.json"], files([...A1_JOBS(), ...mutationJobs(FULLK, { spreadStar: 4 })]));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/GROWS \(row 1\)/);
    expect(r.out).toMatch(/arm C: not GROWS .*: miss/);
  });

  // ---- deep: the xi of final.bin ----
  /** A W x W x 1 final snapshot whose label at (x, y) is `f(x, y)` (0 or 1). */
  const pattern = (W: number, f: (x: number, y: number) => number) => {
    const n = W * W;
    const cells = new Uint32Array(7 * n);
    const genomeHead = new Uint32Array(4 * n);
    for (let i = 0; i < n; i++) {
      const t = f(i % W, Math.floor(i / W));
      genomeHead[GCH.LIN_LO * n + i] = 1;
      genomeHead[GCH.PARAM1 * n + i] = (t << 8) | (((1 << ((t + 1) % 2)) & 0xff) << 16);
      cells[CCH.B * n + i] = 10;
    }
    return { W, H: W, D: 1, K0: 3, cells, genomeHead };
  };
  const withFinals = (finalBytes: Uint8Array | null, xiInSummary?: number) => {
    const jobs = A1_JOBS();
    const extra: Record<string, Uint8Array> = {};
    for (const j of jobs) {
      if (j.s.spread === 4 && j.s.rate === 32) {
        const f = j as FixtureJob;
        if (finalBytes) {
          f.raw.summary.final = "final.bin";
          extra[`/jobs/${j.s.id}/final.bin`] = finalBytes;
        }
        if (xiInSummary !== undefined) f.raw.summary.xi = xiInSummary;
      }
    }
    return files(jobs, extra);
  };
  it("6.1 deep: xi is computed from final.bin (B.1) for the DC treatment jobs at spread*; wide stripes hold", () => {
    const snap = pattern(64, (x) => Math.floor(x / 32) % 2); // vertical stripes of width 32
    const expected = correlationLength(rpsLabels(snap, snap), snap).xi!;
    expect(expected).toBeGreaterThan(6);
    const r = cli(["deep", "--jobs", "/jobs", "--op", "/op.json"], withFinals(encodeRpsFinal(snap)));
    expect(r.code).toBe(0);
    expect((r.result as { medianXi: number }).medianXi).toBeCloseTo(expected, 12);
    expect(r.out).toMatch(/6\.1 holds/);
  });
  it("6.1 deep: a checkerboard (noise-scale domains in both directions) fails with the reason named", () => {
    const snap = pattern(64, (x, y) => (x + y) % 2);
    const r = cli(["deep", "--jobs", "/jobs", "--op", "/op.json"], withFinals(encodeRpsFinal(snap)));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/does not hold: median xi .* is below 6 cells/);
  });
  it("6.1 deep: without final.bin the xi the driver stored in summary.json is used; without either it is unusable input", () => {
    expect(cli(["deep", "--jobs", "/jobs", "--op", "/op.json"], withFinals(null, 9)).out).toMatch(/6\.1 holds/);
    expect(cli(["deep", "--jobs", "/jobs", "--op", "/op.json"], withFinals(null, 2)).out).toMatch(/does not hold/);
    expect(cli(["deep", "--jobs", "/jobs", "--op", "/op.json"], withFinals(null)).code).toBe(2);
  });
  it("6.1 deep: a corrupt final.bin is exit 2", () => {
    expect(cli(["deep", "--jobs", "/jobs", "--op", "/op.json"], withFinals(new Uint8Array(40))).code).toBe(2);
  });
});

describe("loaders and arguments", () => {
  it("parseArgs: --key value, --key=value, flags, one positional command; anything else is an error", () => {
    expect(parseArgs(["sweep", "--jobs", "a", "--op=b", "--draft", "--json"])).toEqual({ command: "sweep", jobs: "a", lattice: null, op: "b", root: null, draft: true, json: true });
    expect(() => parseArgs(["sweep", "extra"])).toThrow(/unexpected argument/);
    expect(() => parseArgs(["--jobs"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--what", "x"])).toThrow(/unknown option --what/);
  });
  it("parseOperatingPoint: JSON, the wrapper that gate0 prints, or the ```json block of the Gate-0 record (GATE0-RECORD.md)", () => {
    const point = { ...OP };
    expect(parseOperatingPoint(JSON.stringify(point), "op.json")).toMatchObject({ rung: "S0", gSpread: G_5, h0: 50_000, denseRate: 700, kappaStar: 32 });
    expect(parseOperatingPoint(JSON.stringify({ operatingPoint: point }), "op.json").vCal).toBe(12);
    const md = `# Gate 0\n\nprose\n\n\`\`\`json\n{"unrelated": 1}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({ operatingPoint: point })}\n\`\`\`\n`;
    expect(parseOperatingPoint(md, "GATE0-RECORD.md").kappaW).toBe(16);
  });
  it("parseOperatingPoint rejects what the later stages cannot use", () => {
    const bad = (o: Record<string, unknown>) => () => parseOperatingPoint(JSON.stringify({ ...OP, ...o }), "op.json");
    expect(bad({ rung: "S9" })).toThrow(/rung/);
    expect(bad({ gSpread: [] })).toThrow(/gSpread/);
    expect(bad({ vCal: 7 })).toThrow(/vCal is not in gSpread/);
    expect(bad({ h0: 123 })).toThrow(/h0/);
    expect(bad({ shape: [1, 2] })).toThrow(/shape/);
    expect(bad({ rCal: "x" })).toThrow(/rCal/);
    expect(() => parseOperatingPoint("not json", "op.json")).toThrow(/op\.json/);
    expect(() => parseOperatingPoint("no block", "GATE0-RECORD.md")).toThrow(/gSpread/);
    expect(bad({ rung: "V", kill: "vacancy", substrate: undefined })).toThrow(/substrate/);
    expect(parseOperatingPoint(JSON.stringify({ ...OP, rung: "V", kill: "vacancy", substrate: "S1" }), "op.json").substrate).toBe("S1");
  });
  it("loadJobs: walks directories, parses census.tsv, keeps census text only for the V check, resolves final paths", () => {
    const io: Io = memIo("/repo", filesOf([...rungJobs({ ...S0_GO, horizon: null, confirm: null }).slice(0, 3), ...vJobs(V_GO).filter((j) => j.s.stage === "g0.vcheck")]));
    const pr = new Problems();
    const jobs = loadJobs(io, "/jobs", pr);
    expect(pr.code).toBe(0);
    expect(jobs).toHaveLength(5);
    expect(jobs.filter((j) => j.censusText !== null).map((j) => j.s.stage)).toEqual(["g0.vcheck", "g0.vcheck"]);
    expect(jobs[0].rows!.length).toBe(26);
    expect(jobs[0].dir).toMatch(/^\/jobs\//);
  });
  it("loadJobs: a missing directory, no summary.json, a job without census.tsv (rows null) are reported or tolerated as designed", () => {
    const pr = new Problems();
    expect(loadJobs(memIo("/repo", {}), "/nowhere", pr)).toEqual([]);
    expect(pr.code).toBe(2);
    const noCensus = memIo("/repo", { "/jobs/a/summary.json": JSON.stringify({ stage: "meter", seed: 205, spread: 4, meter: { axis: "x", W: 3, t: 5000 } }) });
    const pr2 = new Problems();
    const jobs = loadJobs(noCensus, "/jobs", pr2);
    expect(pr2.code).toBe(0);
    expect(jobs[0].rows).toBeNull();
  });
});
