import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { GENOME_CHANNELS, allocState, encodeCheckpoint, stateHash } from "@bl/schema";
import { mannWhitney } from "@bl/metrics";
import { assaySeed, pondConfig, randomKey } from "../lib/ponds.ts";
import {
  ASSAY_COLUMNS,
  M_ASSAY,
  R3REP_SHA256,
  R3REP_SWAP_AE_WORDS,
  TAU_LABELS,
  assayJson,
  assayLine,
  censusSteps,
  checkAssaySeeds,
  checkDonorSeed,
  decodeAssaySeed,
  donorSeedOf,
  parseAssayLabels,
  parseR1PrimeLabels,
  r1PrimeH,
  r1PrimeSeed,
  r1dPrimeIdOf,
  r1dPrimeLabelsOf,
  r1dPrimeSeed,
  r3RepContinuationOf,
  r3RepContinuationPathOf,
  r3RepContinueSeed,
  r3RepDominantRecord,
  r3RepExpectedSets,
  r3RepHistoryOf,
  r3RepIdOf,
  r3RepLabelsOf,
  r3RepRunDirOf,
  r3RepSeed,
  r3RepSeedHOf,
  r3RepSeedOf,
  r3RepSetIdOf,
  r3RepUnavailableOf,
  r3RepWorldSeedOf,
  traitsTable,
  type Planted,
  type R1dPrimeProvenance,
  type R3RepCheckpoint,
  type R3RepDominant,
  type R3RepInoculum,
  type R3RepLabelSet,
  type R3RepOrigin,
  type R3RepProvenance,
} from "../lib/pond-assay.ts";
import {
  DECISION_TABLE,
  NO_REPLAY_CHECK,
  R1DP_CENSORED,
  R1DP_DEGENERATE_ABSOLUTE,
  R1DP_DEGENERATE_RELATIVE,
  R1DP_TAU,
  R1DP_THRESHOLD,
  R1_EXPECTED,
  R2_EXPECTED,
  R3_EXPECTED,
  assayLabels,
  assayRow,
  assaySensitivity,
  competence,
  crossingTime,
  decide,
  founderRank,
  gridOfJson,
  highShare,
  highShareCounts,
  icc1,
  lineageFounder,
  mainRunOf,
  median,
  olsResiduals,
  oneWayAnova,
  atLeastFourOfSix,
  p1Calibrate,
  p1Choose,
  p1Ref,
  p1Regimes,
  p1RunOf,
  p1Seed,
  p1Sensitivity,
  p1Truncation,
  p2Evaluate,
  p2Replicate,
  p2RunProblems,
  p2Sensitivity,
  parseReplayCheck,
  permutationP,
  populationCv,
  r1dPrimeDegeneracy,
  r1dPrimeEvaluate,
  r1dPrimeRunOf,
  r1dPrimeScreen,
  r1dPrimeStat,
  r1dPrimeVerdict,
  r1Evaluate,
  r1History,
  r1PrimeEvaluate,
  r1PrimeScreen,
  r1PrimeStat,
  r1PrimeVerdict,
  r1Test,
  r1Verdict,
  r2Evaluate,
  r2Verdict,
  r3Evaluate,
  r3RepEvaluate,
  r3RepRunOf,
  r3RepRunsSummary,
  r3RepScreen,
  r3RepSideBySide,
  r3RepTrajectory,
  RecipientGuard,
  REG1_REPORT_CONDITIONS,
  REG1_REPORT_PROTOCOL,
  REG1_REPORT_SEEDS,
  binomialUpperTail,
  reg1ReportBootstrapMedian,
  reg1ReportBundleProblems,
  reg1ReportBundleRoleOf,
  reg1ReportCompetenceSeed,
  reg1ReportContinuationSeed,
  reg1ReportDeviceCheck,
  reg1ReportExpectedRuns,
  reg1ReportExpectedSet,
  reg1ReportExpectedSets,
  reg1ReportGardenSeed,
  reg1ReportH,
  reg1ReportPickBundle,
  reg1ReportHereditySeed,
  reg1ReportHistoryId,
  reg1ReportLabelProblems,
  reg1ReportProtocolProblems,
  reg1ReportQueueCheck,
  reg1ReportReadout,
  reg1ReportReproducibility,
  reg1ReportReproSelection,
  reg1ReportScreen,
  reg1ReportSetIdOf,
  reg1ReportSignTest,
  reg1ReportTrajectory,
  reg1ReportWorldSeed,
  r3Verdict,
  r4RowsOf,
  r4Table,
  readTraits,
  reachesThreshold,
  readTsv,
  runStatus,
  setKey,
  shareDelta,
  summariseHistory,
  tauJsonProblems,
  tauRule,
  tauScreen,
  truncationOf,
  tsvRows,
  validateAssayDirs,
  type AssayDir,
  type AssayKey,
  type AssayRow,
  type AssaySet,
  type HistoryTruncation,
  type P1Choice,
  type P1Row,
  type P1Run,
  type R1PrimeFragment,
  type R1PrimeSet,
  type R1dPrimeEntry,
  type R1dPrimeFragment,
  type R1dPrimeRun,
  type R1dPrimeSet,
  type R3RepReload,
  type R3RepRun,
  type ReplayCheck,
  type Reg1ReportArm,
  type Reg1ReportDevice,
  type Reg1ReportExpectedSet,
  type Reg1ReportReproducibility,
  type Reg1ReportRun,
  type Reg1ReportSet,
  type Reg1ReportSetDir,
  type TraitSetDir,
} from "../lib/scaffold-stats.ts";

/** Deterministic pseudo-random values in [0, 1) so the "null" fixtures are fixed data, not flaky draws. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("streaming TSV", () => {
  it("keys rows by the header, skips blank lines and strips CR", async () => {
    const rows = await collect(tsvRows(["a\tb\r", "1\t2\r", "", "3\t4", ""]));
    expect(rows).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
  });

  it("accepts an async line source and throws on a short row", async () => {
    async function* lines() {
      yield "a\tb";
      yield "1";
    }
    await expect(collect(tsvRows(lines()))).rejects.toThrow(/1 fields/);
  });

  it("streams a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scaffold-stats-"));
    const path = join(dir, "t.tsv");
    writeFileSync(path, "x\ty\n1\t2\n3\t4\n");
    expect(await collect(readTsv(path))).toEqual([{ x: "1", y: "2" }, { x: "3", y: "4" }]);
  });
});

describe("numerics", () => {
  it("median averages the middle pair; CV is population and 0 at mean 0", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(populationCv([2, 4])).toBeCloseTo(1 / 3, 12); // sd 1, mean 3
    expect(populationCv([0, 0, 0])).toBe(0);
  });
});

describe("ICC(1)", () => {
  it("equals 1 when all variance is between families", () => {
    const y = [1, 1, 1, 5, 5, 5, 9, 9, 9];
    expect(icc1(y, [0, 0, 0, 1, 1, 1, 2, 2, 2])).toBeCloseTo(1, 12);
  });

  it("matches a hand computation with unequal family sizes", () => {
    // families {1,2} and {3,4,5}: MSB 7.5, MSW 2.5/3, n0 2.4 -> 10/13
    expect(icc1([1, 2, 3, 4, 5], [7, 7, 9, 9, 9])).toBeCloseTo(10 / 13, 12);
  });

  it("is -1 when every family has the same spread and mean (no family effect, n = 2)", () => {
    expect(icc1([1, 3, 1, 3, 1, 3], [0, 0, 1, 1, 2, 2])).toBeCloseTo(-1, 12);
  });

  it("is near 0 with no family effect", () => {
    const r = lcg(7);
    const y = Array.from({ length: 120 }, () => r());
    const fam = Array.from({ length: 120 }, (_, i) => i % 30);
    expect(Math.abs(icc1(y, fam)!)).toBeLessThan(0.25);
  });

  it("depends on the partition, not the label names", () => {
    const y = [1, 2, 3, 4, 5, 9];
    expect(icc1(y, [0, 0, 1, 1, 2, 2])).toBe(icc1(y, [5, 5, 3, 3, 0, 0]));
  });

  it("is null without two families or within-family freedom, and 0 for constant values", () => {
    expect(icc1([1, 2, 3], [0, 0, 0])).toBeNull();
    expect(icc1([1, 2], [0, 1])).toBeNull();
    expect(icc1([4, 4, 4, 4], [0, 0, 1, 1])).toBe(0);
  });
});

describe("OLS residuals", () => {
  it("matches the hand computation y = -0.5 + 2.2 x", () => {
    // x = 1..4, y = 2,4,5,9: mean x 2.5, mean y 5, Sxx 5, Sxy 11 -> slope 2.2, intercept -0.5
    const r = olsResiduals([2, 4, 5, 9], [[1, 2, 3, 4]]);
    const want = [2 - 1.7, 4 - 3.9, 5 - 6.1, 9 - 8.3];
    r.forEach((v, i) => expect(v).toBeCloseTo(want[i], 10));
  });

  it("removes an exact two-covariate linear signal and centres an intercept-only fit", () => {
    const x1 = [0, 1, 2, 3, 4, 5];
    const x2 = [1, 0, 3, 1, 0, 2];
    const y = x1.map((v, i) => 3 + 2 * v - 4 * x2[i]);
    olsResiduals(y, [x1, x2]).forEach((v) => expect(Math.abs(v)).toBeLessThan(1e-9));
    const c = olsResiduals([1, 2, 6], []);
    expect(c.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
    expect(c[2]).toBeCloseTo(3, 12);
  });

  it("drops constant and collinear covariates instead of failing", () => {
    const y = [2, 4, 5, 9];
    const base = olsResiduals(y, [[1, 2, 3, 4]]);
    const extra = olsResiduals(y, [[1, 2, 3, 4], [0, 0, 0, 0], [2, 4, 6, 8]]);
    extra.forEach((v, i) => expect(v).toBeCloseTo(base[i], 9));
  });
});

describe("permutation p", () => {
  const sigma = assaySeed(1, 0, 1, 0, 8);
  const fam = Array.from({ length: 128 }, (_, i) => (i % 64) % 16);

  it("is the smallest attainable p for a strong family effect", () => {
    const r = lcg(3);
    const y = fam.map((f) => f * 10 + r());
    const res = permutationP(y, fam, sigma)!;
    expect(res.icc).toBeGreaterThan(0.99);
    expect(res.p).toBeCloseTo(1 / 1001, 12);
  });

  it("is large for a null effect, and lies on the 1/1001 grid", () => {
    const r = lcg(11);
    const y = fam.map(() => r());
    const res = permutationP(y, fam, sigma)!;
    expect(res.p).toBeGreaterThan(0.05);
    expect(Math.round(res.p * 1001)).toBeCloseTo(res.p * 1001, 9);
  });

  it("is deterministic in the sigma and changes with it", () => {
    const r = lcg(5);
    const y = fam.map((f) => f + 8 * r());
    const a = permutationP(y, fam, sigma, 200)!;
    expect(permutationP(y, fam, sigma, 200)).toEqual(a);
    expect(permutationP(y, fam, assaySeed(1, 1, 1, 0, 8), 200)!.icc).toBe(a.icc);
  });

  it("is null when the ICC is undefined", () => {
    expect(permutationP([1, 2, 3], [0, 0, 0], sigma)).toBeNull();
  });
});

// ---- P1 ----------------------------------------------------------------------------------------

interface RunSpec {
  k?: number;
  period?: number;
  seed?: number;
  ponds?: number;
  cycles?: number;
  /** Last cycle that has rows (the history ended there); default: all. */
  lastCycle?: number;
  /** Pre-cycle trait of pond r at boundary b. */
  trait?: (b: number, r: number) => number;
  /** Retained landed B+P of recipient r in cycle b. */
  ret?: (b: number, r: number) => number;
  /** Whether recipient r's packet in cycle b was truncated. */
  truncated?: (b: number, r: number) => boolean;
  conservationOk?: boolean;
}

function mkRun(spec: RunSpec = {}): P1Run {
  const ponds = spec.ponds ?? 4;
  const cycles = spec.cycles ?? 5;
  const last = spec.lastCycle ?? cycles;
  const rows: P1Row[] = [];
  for (let b = 1; b <= last; b++) {
    for (let r = 0; r < ponds; r++) {
      rows.push({ cycle: b, recipient: r, retMass: spec.ret?.(b, r) ?? 5, recipientTrait: (spec.trait ?? defaultTrait)(b, r), truncated: spec.truncated?.(b, r) ? 1 : 0 });
    }
  }
  return { k: spec.k ?? 3, period: spec.period ?? 1000, seed: spec.seed ?? 4_800_001, ponds, cycles, conservationOk: spec.conservationOk ?? true, rows };
}

/** Traits 200/100/50/0 at every boundary: 25% ineligible, CV > 0.1, ref = median of boundary 1 = 75. */
const defaultTrait = (_b: number, r: number) => [200, 100, 50, 0][r];

/** Two seeds of one regime, both passing (or both failing exactness). */
const regimeRuns = (k: number, period: number, pass: boolean, base: number): P1Run[] =>
  [0, 1].map((s) => mkRun({ k, period, seed: base + s, conservationOk: pass }));

/** Every (k, period) of the grid `ks`, passing where `pass` says so. */
const grid = (ks: number[], pass: (k: number, p: number) => boolean, base: number) =>
  ks.flatMap((k, i) => [1000, 3000, 10000].flatMap((p, j) => regimeRuns(k, p, pass(k, p), base + 1000 * i + 100 * j)));

describe("P1", () => {
  it("pools boundary-1 traits over every run of a period, whatever k and seed", () => {
    const a = mkRun({ k: 3, seed: 1, trait: (b, r) => (b === 1 ? [10, 20, 30, 40][r] : 0) });
    const b = mkRun({ k: 5, seed: 2, trait: (b, r) => (b === 1 ? [50, 60, 70, 80][r] : 0) });
    const c = mkRun({ k: 3, period: 3000, seed: 3, trait: (b, r) => (b === 1 ? [1, 1, 1, 1][r] : 0) });
    const refs = p1Ref([a, b, c]);
    expect(refs.get(1000)).toBe(45); // median of 10..80 step 10
    expect(refs.get(3000)).toBe(1);
  });

  it("passes a healthy seed and reports its metrics", () => {
    const res = p1Seed(mkRun(), 75);
    // recipients: 16 scheduled; per boundary ponds with trait 200, 100 succeed, 50 does not reach 0.25*75=18.75? it does
    // (50 >= 18.75 and 50 >= 4*5), only the empty pond fails: 3 of 4.
    expect(res.scheduled).toBe(16);
    expect(res.successes).toBe(12);
    expect(res.successFraction).toBe(0.75);
    expect(res.meanIneligible).toBe(0.25);
    expect(res.meanCv).toBeGreaterThan(0.1);
    expect(res.criteria).toEqual({ a: true, b: true, c: true, d: true });
    expect(res.pass).toBe(true);
    expect(res.s).toBe(0);
  });

  it("requires regrowth: trait >= 4x the retained landed mass", () => {
    const res = p1Seed(mkRun({ ret: () => 20 }), 75); // 4 * 20 = 80 > 50: pond 2 persists, not regrows
    expect(res.successes).toBe(8); // ponds 0 and 1 only
    expect(res.successFraction).toBe(0.5);
  });

  it("requires trait >= 0.25 ref", () => {
    const res = p1Seed(mkRun(), 1000); // threshold 250: nothing reaches it
    expect(res.successes).toBe(0);
    expect(res.criteria.a).toBe(false);
  });

  it("bounds the success fraction on both sides, inclusively", () => {
    const all = p1Seed(mkRun({ trait: () => 100 }), 100); // 100% success
    expect(all.successFraction).toBe(1);
    expect(all.criteria.a).toBe(false);
    // 30% exactly: 40 recipients (10 ponds x 4 cycles), 12 succeed
    const low = p1Seed(mkRun({ ponds: 10, trait: (_b, r) => (r < 3 ? 100 : 0) }), 100);
    expect(low.successFraction).toBe(0.3);
    expect(low.criteria.a).toBe(true);
  });

  it("treats a history that ended as failures, with missing boundaries fully ineligible at CV 0", () => {
    // ends at cycle 3 (its boundary-3 traits are all zero); cycles 4 and 5 are missing
    const run = mkRun({ lastCycle: 3, trait: (b, r) => (b >= 3 ? 0 : defaultTrait(b, r)) });
    const res = p1Seed(run, 75);
    expect(res.scheduled).toBe(16);
    expect(res.successes).toBe(3); // cycle 1's recipients into boundary 2 only
    // boundaries 2..5: 0.25, then 1, 1, 1 (zero traits, then two missing)
    expect(res.meanIneligible).toBeCloseTo((0.25 + 1 + 1 + 1) / 4, 12);
    // CV: boundary 2 contributes the healthy value, the other three 0
    const cv2 = populationCv([200, 100, 50, 0]);
    expect(res.meanCv).toBeCloseTo(cv2 / 4, 12);
    expect(res.criteria.b).toBe(false);
  });

  it("counts a boundary with mean trait 0 as CV 0 and fails on ref = 0", () => {
    const zero = p1Seed(mkRun({ trait: (b, r) => (b === 1 ? [200, 100, 50, 0][r] : 0) }), 75);
    expect(zero.meanCv).toBe(0);
    expect(zero.criteria.c).toBe(false);
    const noRef = p1Seed(mkRun(), 0);
    expect(noRef.successes).toBe(0);
    expect(noRef.pass).toBe(false);
  });

  it("fails on inexact conservation and on too many ineligible ponds", () => {
    expect(p1Seed(mkRun({ conservationOk: false }), 75).pass).toBe(false);
    const res = p1Seed(mkRun({ trait: (_b, r) => (r === 0 ? 100 : 0) }), 100);
    expect(res.meanIneligible).toBe(0.75);
    expect(res.criteria.b).toBe(false);
  });

  it("derives s from the seed", () => {
    expect(p1Seed(mkRun({ seed: 4_800_001 + 100 * 4 + 1 }), 75).s).toBe(1);
  });

  it("judges each seed of a regime separately", () => {
    const good = (seed: number) => mkRun({ seed });
    const bad = mkRun({ seed: 4_800_002, conservationOk: false });
    const { regimes } = p1Regimes([good(4_800_001), bad]);
    expect(regimes).toHaveLength(1);
    expect(regimes[0].seeds.map((s) => s.pass)).toEqual([true, false]);
    expect(regimes[0].pass).toBe(false);
    expect(p1Regimes([good(4_800_001), good(4_800_002)]).regimes[0].pass).toBe(true);
  });

  it("does not pass a regime with too few seeds", () => {
    const { regimes } = p1Regimes([mkRun()]);
    expect(regimes[0].complete).toBe(false);
    expect(regimes[0].pass).toBe(false);
  });

  it("chooses the smallest passing k, then the shortest passing period", () => {
    const runs = [
      ...regimeRuns(3, 1000, false, 100),
      ...regimeRuns(3, 3000, false, 110),
      ...regimeRuns(3, 10000, false, 120),
      ...regimeRuns(5, 10000, true, 130),
      ...regimeRuns(5, 3000, true, 140),
      ...regimeRuns(5, 1000, false, 150),
      ...regimeRuns(8, 1000, true, 160),
      ...regimeRuns(8, 3000, true, 170),
      ...regimeRuns(8, 10000, true, 180),
    ];
    const choice = p1Choose(p1Regimes(runs).regimes);
    expect(choice.stage).toBe("primary");
    expect(choice.chosen).toEqual({ k: 5, period: 3000 });
    expect(choice.verdict).toBe(true);
    expect(choice.primaryComplete).toBe(true);
    expect(choice.passing[0]).toEqual({ k: 5, period: 3000 });
  });

  it("consults the fallback grid only when nothing in the primary grid passes, and is undecided until it runs", () => {
    const primary = grid([3, 5, 8], () => false, 1000);
    expect(p1Choose(p1Regimes(primary).regimes)).toMatchObject({ stage: null, chosen: null, verdict: null, primaryComplete: true });
    const failedFallback = grid([12, 16], () => false, 9000);
    expect(p1Choose(p1Regimes([...primary, ...failedFallback]).regimes).verdict).toBe(false);
    const okFallback = grid([12, 16], (k, p) => k === 12 && p === 3000, 7000);
    const choice = p1Choose(p1Regimes([...primary, ...okFallback]).regimes);
    expect(choice).toMatchObject({ stage: "fallback", chosen: { k: 12, period: 3000 }, verdict: true, fallbackComplete: true });
  });

  it("does not choose while a smaller regime has not run: verdict stays null with the candidate reported", () => {
    // only k=5 present and (5, 1000) passes: k=3 could still pass and win
    const partial = p1Choose(p1Regimes(grid([5], (_k, p) => p === 1000, 100)).regimes);
    expect(partial).toMatchObject({ stage: "primary", chosen: null, candidate: { k: 5, period: 1000 }, primaryComplete: false, verdict: null });
    // k=3 fails, the rest of the primary grid has not run, k=12 passes: primary is open, so no fallback choice
    const early = p1Choose(p1Regimes([...grid([3], () => false, 100), ...regimeRuns(12, 1000, true, 500)]).regimes);
    expect(early).toMatchObject({ chosen: null, verdict: null });
    // primary complete and empty, fallback partly run with a pass: the fallback grid must be complete too
    const midFallback = p1Choose(p1Regimes([...grid([3, 5, 8], () => false, 1000), ...regimeRuns(12, 1000, true, 500)]).regimes);
    expect(midFallback).toMatchObject({ stage: "fallback", chosen: null, candidate: { k: 12, period: 1000 }, primaryComplete: true, fallbackComplete: false, verdict: null });
  });
});

describe("P1 truncation rule", () => {
  it("flags a history with more than 1% truncated recipient rows, exactly", () => {
    // 4 ponds x 25 cycles = 100 rows: 1 truncated is 1% (not flagged), 2 is flagged
    const one = mkRun({ cycles: 25, truncated: (b, r) => b === 1 && r === 0 });
    expect(p1Truncation(one)).toMatchObject({ truncated: 1, rows: 100, flagged: false });
    const two = mkRun({ cycles: 25, truncated: (b, r) => b === 1 && r < 2 });
    expect(p1Truncation(two)).toMatchObject({ truncated: 2, rows: 100, flagged: true });
  });

  it("repeats the choice without the flagged histories and calls the result sensitive when it changes", () => {
    const runs = (flag: boolean): P1Run[] => [
      ...[0, 1].map((s) => mkRun({ k: 3, period: 1000, seed: 100 + s, truncated: flag && s === 1 ? () => true : undefined })),
    ];
    const ok = (k: number, p: number, base: number) => regimeRuns(k, p, true, base);
    // every regime passes; (3, 1000) has a flagged seed s = 1
    const all = [3, 5, 8].flatMap((k, i) => [1000, 3000, 10000].flatMap((p, j) => (k === 3 && p === 1000 ? runs(true) : ok(k, p, 1000 * (i + 1) + 100 * j))));
    const sens = p1Sensitivity(all);
    expect(sens.flagged).toHaveLength(1);
    expect(sens.flagged[0]).toMatchObject({ k: 3, period: 1000, seed: 101, flagged: true });
    expect(sens.full.chosen).toEqual({ k: 3, period: 1000 });
    // the unflagged seed of (3, 1000) still passes, so leaving the flagged history out changes nothing
    expect(sens.without?.chosen).toEqual({ k: 3, period: 1000 });
    expect(sens.sensitive).toBe(false);
    // (3, 1000) fails on its flagged seed only: leaving that history out moves the choice back to (3, 1000)
    const moved = [3, 5, 8].flatMap((k, i) =>
      [1000, 3000, 10000].flatMap((p, j) =>
        k === 3 && p === 1000
          ? [mkRun({ k, period: p, seed: 100 }), mkRun({ k, period: p, seed: 101, conservationOk: false, truncated: () => true })]
          : ok(k, p, 1000 * (i + 1) + 100 * j),
      ),
    );
    const s2 = p1Sensitivity(moved);
    expect(s2.full.chosen).toEqual({ k: 3, period: 3000 });
    expect(s2.without?.chosen).toEqual({ k: 3, period: 1000 });
    expect(s2.sensitive).toBe(true);
  });

  it("is not sensitive, and has no second choice, when nothing is flagged", () => {
    const sens = p1Sensitivity(regimeRunsAll());
    expect(sens).toMatchObject({ flagged: [], without: null, sensitive: false });
  });

  function regimeRunsAll(): P1Run[] {
    return [3, 5, 8].flatMap((k, i) => [1000, 3000, 10000].flatMap((p, j) => [0, 1].map((s) => mkRun({ k, period: p, seed: 1000 * (i + 1) + 100 * j + s }))));
  }
});

describe("P1 calibration", () => {
  const choice = (over: Partial<P1Choice>): P1Choice => ({
    stage: "primary",
    chosen: { k: 3, period: 1000 },
    candidate: { k: 3, period: 1000 },
    primaryComplete: true,
    fallbackComplete: false,
    verdict: true,
    passing: [
      { k: 3, period: 3000 },
      { k: 5, period: 1000 },
    ],
    ...over,
  });
  const calSet = (k: number, period: number, cal: 1 | 2, frac: number, retMass = 100): AssaySet => ({
    labels: assayLabels({ arm: "ancestor", timing: "a", calibration: cal, k, period, ref: 10 }),
    rows: Array.from({ length: 100 }, (_, i) => fragRow({ assay: "competence", inoculum: cal === 1 ? "fragment" : "quenched", pond: i, replicate: i % 2, retMass, success: i < Math.round(frac * 100) ? 1 : 0 })),
  });

  it("takes the first passing regime whose ancestor competence is in [0.2, 0.9] and quenched at most 0.05", () => {
    const r = p1Calibrate(choice({}), [calSet(3, 3000, 1, 0.5), calSet(3, 3000, 2, 0.05), calSet(5, 1000, 1, 0.5), calSet(5, 1000, 2, 0)]);
    expect(r).toMatchObject({ verdict: true, chosen: { k: 3, period: 3000 } });
    expect(r.regimes).toHaveLength(1);
  });

  it("tries the next passing regime when calibration fails, at either bound", () => {
    for (const [anc, q] of [[0.15, 0], [0.95, 0], [0.5, 0.06]]) {
      const r = p1Calibrate(choice({}), [calSet(3, 3000, 1, anc), calSet(3, 3000, 2, q), calSet(5, 1000, 1, 0.5), calSet(5, 1000, 2, 0)]);
      expect(r).toMatchObject({ verdict: true, chosen: { k: 5, period: 1000 } });
      expect(r.regimes[0].pass).toBe(false);
    }
    expect(p1Calibrate(choice({}), [calSet(3, 3000, 1, 0.2), calSet(3, 3000, 2, 0.05)]).chosen).toEqual({ k: 3, period: 3000 });
    expect(p1Calibrate(choice({}), [calSet(3, 3000, 1, 0.9), calSet(3, 3000, 2, 0.05)]).chosen).toEqual({ k: 3, period: 3000 });
  });

  it("pairs the two calibrations by regime and needs the quenched control to hold the ancestor's fragments", () => {
    // each regime reads only its own pair: a passing k 5 pair is not spoiled by the k 3 sets
    const r = p1Calibrate(choice({}), [calSet(3, 3000, 1, 0.05), calSet(3, 3000, 2, 0), calSet(5, 1000, 1, 0.5), calSet(5, 1000, 2, 0)]);
    expect(r.regimes.map((x) => [x.k, x.period, x.paired, x.pass])).toEqual([[3, 3000, true, false], [5, 1000, true, true]]);
    // a separately drawn quenched control (other retained masses) is not a matched control: the regime is not decided
    const unpaired = p1Calibrate(choice({}), [calSet(3, 3000, 1, 0.5), calSet(3, 3000, 2, 0, 90)]);
    expect(unpaired).toMatchObject({ verdict: null, chosen: null });
    expect(unpaired.regimes[0]).toMatchObject({ ancestor: 0.5, quenched: 0, paired: false, pass: null });
    // a missing control leaves pairing unknown
    expect(p1Calibrate(choice({}), [calSet(3, 3000, 1, 0.5)]).regimes[0]).toMatchObject({ paired: null, pass: null });
  });

  it("stays open while a regime's calibration has not run, and is false only when every passing regime failed with both grids complete", () => {
    expect(p1Calibrate(choice({}), [calSet(3, 3000, 1, 0.5)])).toMatchObject({ verdict: null, chosen: null });
    const failing = [calSet(3, 3000, 1, 0.05), calSet(3, 3000, 2, 0), calSet(5, 1000, 1, 0.05), calSet(5, 1000, 2, 0)];
    expect(p1Calibrate(choice({}), failing).verdict).toBeNull(); // the fallback grid has not run
    expect(p1Calibrate(choice({ fallbackComplete: true }), failing).verdict).toBe(false);
    expect(p1Calibrate(choice({ verdict: false, chosen: null }), []).verdict).toBe(false);
    expect(p1Calibrate(choice({ verdict: null, chosen: null }), failing).verdict).toBeNull();
  });
});

// ---- P2 ----------------------------------------------------------------------------------------

describe("P2", () => {
  it("ranks founders by pooled mean trait, ties to the smaller index, with exact fractions", () => {
    const obs: { founder: number; trait: number }[] = [];
    for (let f = 0; f < 12; f++) obs.push({ founder: f, trait: 100 });
    // founders 3 and 9 are strictly better; 0..11 otherwise tie
    obs.push({ founder: 3, trait: 300 }, { founder: 9, trait: 200 });
    const { scores, high } = founderRank(obs);
    expect(scores[3]).toMatchObject({ n: 2, sum: 400, mean: 200 });
    expect(high).toEqual([0, 1, 2, 3, 4, 9]); // 3 and 9 (means 200, 150), then ties 0,1,2,4 by index
  });

  it("compares unequal counts exactly and ranks a founder without ponds last", () => {
    const obs = [
      { founder: 0, trait: 10 },
      { founder: 0, trait: 11 }, // 10.5
      { founder: 1, trait: 21 }, // 21
      { founder: 2, trait: 31 },
      { founder: 2, trait: 32 },
      { founder: 2, trait: 31 }, // 31.33
    ];
    expect(founderRank(obs, 4, 2).high).toEqual([1, 2]);
    expect(founderRank(obs, 4, 4).high).toEqual([0, 1, 2, 3]);
    expect(founderRank(obs, 4, 3).high).toEqual([0, 1, 2]);
  });

  it("maps lineage ids through the planting map", () => {
    const map = [0, 1, 2, 0, 1, 2];
    expect(lineageFounder(0, 1, map)).toBe(0);
    expect(lineageFounder(0, 6, map)).toBe(2);
    expect(lineageFounder(0, 7, map)).toBe(-1);
    expect(lineageFounder(1, 1, map)).toBe(-1);
    expect(lineageFounder(0, 0, map)).toBe(-1);
  });

  it("streams lineages.tsv into high-set mass per boundary and ignores other boundaries", async () => {
    const rows = tsvRows([
      "boundary\tstep\tpond\thi\tlo\tmass",
      "1\t100\t0\t0\t1\t60", // founder 0 (high)
      "1\t100\t1\t0\t2\t40", // founder 1
      "20\t200\t0\t0\t1\t30",
      "20\t200\t1\t0\t2\t10",
      "20\t200\t2\t0\t1\t20",
      "7\t70\t0\t0\t1\t999",
    ]);
    const c = await highShareCounts(rows, new Set([0]), [0, 1], [1, 20]);
    expect(c.get(1)).toEqual({ high: 60, total: 100 });
    expect(c.get(20)).toEqual({ high: 50, total: 60 });
    expect(highShare(c.get(1)!)).toBe(0.6);
    expect(highShare({ high: 0, total: 0 })).toBe(0);
  });

  /** Integer trait masses out of 100 at boundary 1 and at the last boundary, e.g. arm(40, 55, ...) is share 0.40 then 0.55. */
  const arm = (high1: number, highEnd: number, traitSum: number) => ({ high1, total1: 100, highEnd, totalEnd: 100, traitSum, ponds: 64 });

  it("passes when scaf's delta is >= 0.10 and beats rand and its trait is higher, in both seeds", () => {
    const res = p2Evaluate([0, 1].map((s) => ({ s, scaf: arm(40, 55, 5000), rand: arm(40, 42, 4000) })));
    expect(res.pass).toBe(true);
    expect(res.seeds[0].deltaScaf).toBeCloseTo(0.15, 12);
  });

  it("fails on each criterion and on either seed", () => {
    const ok = { scaf: arm(40, 55, 5000), rand: arm(40, 42, 4000) };
    const smallDelta = p2Evaluate([{ s: 0, ...ok }, { s: 1, scaf: arm(40, 49, 5000), rand: arm(40, 30, 4000) }]);
    expect(smallDelta.pass).toBe(false);
    expect(smallDelta.seeds[1].criteria).toEqual({ deltaAtLeast: false, deltaBeatsRand: true, traitHigher: true });
    const randBeats = p2Evaluate([{ s: 0, scaf: arm(40, 55, 5000), rand: arm(40, 60, 4000) }]);
    expect(randBeats.seeds[0].criteria.deltaBeatsRand).toBe(false);
    const lowTrait = p2Evaluate([{ s: 0, scaf: arm(40, 55, 4000), rand: arm(40, 42, 4000) }]);
    expect(lowTrait.seeds[0].criteria.traitHigher).toBe(false); // strictly higher
    expect(lowTrait.pass).toBe(false);
  });

  it("compares deltas exactly: 0.3 - 0.2 is 0.10, and equal deltas do not beat each other", () => {
    expect(0.3 - 0.2).toBeLessThan(0.1); // the float trap the integer masses avoid
    const rand = arm(40, 42, 4000);
    const exact = p2Evaluate([{ s: 0, scaf: arm(20, 30, 5000), rand }]);
    expect(exact.seeds[0].criteria.deltaAtLeast).toBe(true);
    expect(exact.seeds[0].deltaScafExact).toBe("1000/10000");
    expect(p2Evaluate([{ s: 0, scaf: arm(20, 29, 5000), rand }]).seeds[0].criteria.deltaAtLeast).toBe(false);
    // 0.4 - 0.3 is above 0.3 - 0.2 in floats; exactly both are 1/10, so neither beats the other
    const tie = p2Evaluate([{ s: 0, scaf: arm(30, 40, 5000), rand: arm(20, 30, 4000) }]);
    expect(tie.seeds[0].criteria).toEqual({ deltaAtLeast: true, deltaBeatsRand: false, traitHigher: true });
    expect(p2Evaluate([{ s: 0, scaf: arm(30, 41, 5000), rand: arm(20, 30, 4000) }]).seeds[0].criteria.deltaBeatsRand).toBe(true);
  });

  it("takes shares over unequal totals, a world without mass as share 0, and refuses non-integer masses", () => {
    // 1/5 -> 3/10 is exactly 0.10
    expect(shareDelta({ high1: 1, total1: 5, highEnd: 3, totalEnd: 10, traitSum: 0, ponds: 1 })).toEqual({ n: 5n, d: 50n });
    const p = p2Evaluate([{ s: 0, scaf: { high1: 1, total1: 5, highEnd: 3, totalEnd: 10, traitSum: 9000, ponds: 64 }, rand: { ...arm(40, 42, 4000), highEnd: 0, totalEnd: 0 } }]);
    expect(p.seeds[0].criteria).toEqual({ deltaAtLeast: true, deltaBeatsRand: true, traitHigher: true });
    expect(shareDelta({ high1: 0, total1: 0, highEnd: 0, totalEnd: 0, traitSum: 0, ponds: 1 }).n).toBe(0n);
    expect(() => shareDelta({ high1: 0.4, total1: 1, highEnd: 0, totalEnd: 1, traitSum: 0, ponds: 1 })).toThrow(/integers/);
  });

  it("fails a seed missing an arm, and an empty evaluation", () => {
    expect(p2Evaluate([{ s: 0, scaf: arm(40, 60, 5000), rand: null }]).pass).toBe(false);
    expect(p2Evaluate([]).pass).toBe(false);
  });

  it("treats a missing seed as pending, not dropped: one passing seed of two is not a pass", () => {
    const good = { scaf: arm(40, 55, 5000), rand: arm(40, 42, 4000) };
    const one = p2Evaluate([{ s: 0, ...good }]);
    expect(one.pass).toBe(false);
    expect(one.verdict).toBeNull();
    expect(one.seeds).toHaveLength(2);
    expect(one.seeds[1]).toMatchObject({ s: 1, present: false, pass: false });
    expect(p2Evaluate([{ s: 0, ...good }, { s: 1, ...good }])).toMatchObject({ pass: true, verdict: true });
    // a seed that fails settles the verdict even while the other is missing
    expect(p2Evaluate([{ s: 0, scaf: arm(40, 42, 5000), rand: arm(40, 42, 4000) }]).verdict).toBe(false);
    // seeds outside the expected list are ignored
    expect(p2Evaluate([{ s: 0, ...good }, { s: 1, ...good }, { s: 2, scaf: null, rand: null }]).seeds).toHaveLength(2);
  });

  it("requires two ranking seeds when the caller says how many there are", () => {
    const obs = [{ founder: 0, trait: 1 }];
    expect(() => founderRank(obs, 12, 6, 1)).toThrow(/2 seeds/);
    expect(founderRank(obs, 12, 6, 2).high).toHaveLength(6);
    expect(founderRank(obs).high).toHaveLength(6);
  });

  it("repeats the verdict without the seeds a flagged run belongs to", () => {
    const good = { scaf: arm(40, 55, 5000), rand: arm(40, 42, 4000) };
    const bad = { scaf: arm(40, 42, 5000), rand: arm(40, 42, 4000) };
    const perSeed = [{ s: 0, ...good }, { s: 1, ...bad }];
    expect(p2Sensitivity(perSeed, [])).toEqual({ flagged: [], verdict: false, without: false, sensitive: false });
    // seed 1 is flagged: the verdict without it (seed 0 alone) is true, so the result is sensitive
    expect(p2Sensitivity(perSeed, [1])).toEqual({ flagged: [1], verdict: false, without: true, sensitive: true });
    expect(p2Sensitivity(perSeed, [0, 1]).without).toBeNull();
  });
});

// ---- Assays: R1 - R4 -----------------------------------------------------------------------------

const fragRow = (over: Partial<AssayRow>): AssayRow => ({
  assay: "transmission",
  source: "s",
  replicate: 0,
  pond: 0,
  family: -1,
  inoculum: "fragment",
  reqMass: 100,
  retMass: 100,
  reqE: 200,
  retE: 200,
  truncated: null,
  endTrait: 0,
  success: -1,
  ...over,
});

/** 128 pooled fragments: replicate 0 then 1, 64 ponds each, 16 donor families. */
function transmissionRows(trait: (family: number, f: number) => number): AssayRow[] {
  const rows: AssayRow[] = [];
  const r = lcg(21);
  for (let rep = 0; rep < 2; rep++) {
    for (let f = 0; f < 64; f++) {
      rows.push(fragRow({ replicate: rep, pond: f, family: f % 16, retMass: 50 + Math.floor(r() * 50), retE: 100 + Math.floor(r() * 100), endTrait: trait(f % 16, f) }));
    }
  }
  return rows;
}

describe("R1", () => {
  it("demonstrates heredity for a strong family effect", () => {
    const r = lcg(2);
    const res = r1History(transmissionRows((fam) => 1000 + 300 * fam + Math.floor(r() * 20)), 0, 1);
    expect(res.n).toBe(128);
    expect(res.families).toBe(16);
    expect(res.covariates).toEqual(["log1p(retMass)", "log1p(retE)"]);
    expect(res.icc!).toBeGreaterThan(0.9);
    expect(res.p!).toBeCloseTo(1 / 1001, 12);
    expect(res.demonstrated).toBe(true);
  });

  it("does not for a null effect", () => {
    const r = lcg(99);
    const res = r1History(transmissionRows(() => Math.floor(r() * 1000)), 0, 1);
    expect(res.p!).toBeGreaterThan(0.05);
    expect(res.demonstrated).toBe(false);
  });

  it("is deterministic", () => {
    const rows = transmissionRows((_fam, f) => (f * 37) % 101);
    expect(r1History(rows, 2, 1)).toEqual(r1History(rows, 2, 1));
  });

  it("refuses a table without retained E rather than fit another model, and reports insufficient histories as not demonstrated", () => {
    const rows = transmissionRows((fam) => 100 * fam).map((r) => ({ ...r, retE: null }));
    expect(() => r1History(rows, 0, 1)).toThrow(/retE/);
    const ins = r1History([], 0, 1, true);
    expect(ins).toMatchObject({ demonstrated: false, icc: null, insufficient: true });
  });

  it("requires 4 of 6 scaf histories at C, and a verdict stays open while histories are missing", () => {
    const strong = (i: number, t: number): AssaySet => {
      const r = lcg(40 + i);
      return { labels: assayLabels({ arm: "scaf", history: i, time: t }), rows: transmissionRows((fam) => 500 * fam + Math.floor(r() * 10)) };
    };
    const weak = (i: number): AssaySet => {
      const r = lcg(60 + i);
      return { labels: assayLabels({ arm: "scaf", history: i, time: 1 }), rows: transmissionRows(() => Math.floor(r() * 1000)) };
    };
    const four = r1Evaluate([0, 1, 2, 3].map((i) => strong(i, 1)));
    expect(four.arms.scaf).toEqual({ demonstratedAtC: 4, demonstrated: true });
    expect(r1Verdict(four)).toBe(true);
    const two = r1Evaluate([strong(0, 1), strong(1, 1), weak(2), weak(3), weak(4), weak(5)]);
    expect(two.arms.scaf.demonstrated).toBe(false);
    expect(r1Verdict(two)).toBe(false);
    expect(r1Verdict(r1Evaluate([strong(0, 1), weak(1)]))).toBeNull();
    // time 0 does not count
    expect(r1Evaluate([0, 1, 2, 3].map((i) => strong(i, 0))).arms.scaf.demonstratedAtC).toBe(0);
    expect(four.histories.map((h) => h.history)).toEqual([0, 1, 2, 3]);
  });
});

const gardenRows = (inoculum: string, values: number[]): AssayRow[] => values.map((v, i) => fragRow({ assay: "garden", pond: i, inoculum, endTrait: v }));

function garden(arm: "scaf" | "rand", history: number, time: 0 | 1, disc: number[], raw: number[] = [1]): AssaySet {
  return { labels: assayLabels({ arm, history, time }), rows: [...gardenRows("disc", disc), ...gardenRows("fragment", raw)] };
}

describe("R2", () => {
  const build = (scafGain: number[], randGain: number[]): AssaySet[] => [
    ...scafGain.flatMap((g, i) => [garden("scaf", i, 0, [100, 100]), garden("scaf", i, 1, [100 + g, 100 + g])]),
    ...randGain.flatMap((g, i) => [garden("rand", i, 0, [100]), garden("rand", i, 1, [100 + g])]),
  ];

  it("shows adaptation when scaf gains > 0 in 4 of 6 and its median beats rand's", () => {
    const res = r2Evaluate(build([10, 20, 30, 40, -5, -5], [0, 5, 5, -5, 0, 0]));
    expect(res.scafPositive).toBe(4);
    expect(res.medianGain).toEqual({ scaf: 15, rand: 0 });
    expect(res.shown).toBe(true);
    expect(r2Verdict(res)).toBe(true);
  });

  it("is not shown with only 3 positive scaf histories or when rand's median is at least as high", () => {
    const three = r2Evaluate(build([10, 20, 30, -1, -1, -1], [0, 0, 0, 0, 0, 0]));
    expect(three.shown).toBe(false);
    expect(r2Verdict(three)).toBe(false);
    const randHigh = r2Evaluate(build([10, 10, 10, 10, 10, 10], [10, 10, 10, 10, 10, 10]));
    expect(randHigh.shown).toBe(false); // equal medians are not "above"
  });

  it("does not return a verdict on partial data that later histories could flip", () => {
    // 4 scaf histories gain +10 and one rand history loses 50: shown on this data, but not final
    const partial = r2Evaluate(build([10, 10, 10, 10], [-50]));
    expect(partial.shown).toBe(true);
    expect(r2Verdict(partial)).toBeNull();
    // the remaining 2 scaf (-10) and 5 rand (+100) histories reverse it
    const full = r2Evaluate(build([10, 10, 10, 10, -10, -10], [-50, 100, 100, 100, 100, 100]));
    expect(full.shown).toBe(false);
    expect(r2Verdict(full)).toBe(false);
    // only complete data give true
    expect(r2Verdict(r2Evaluate(build([10, 10, 10, 10, -10, -10], [-50, -50, -50, -50, -50, -50])))).toBe(true);
  });

  it("is false early when fewer than 4 scaf gains could still be positive", () => {
    // 3 histories present, all negative: 0 positive + 3 missing < 4
    expect(r2Verdict(r2Evaluate(build([-1, -1, -1], [])))).toBe(false);
    // 2 negative present, 4 missing: 0 + 4 >= 4, still open
    expect(r2Verdict(r2Evaluate(build([-1, -1], [])))).toBeNull();
  });

  it("leaves the verdict open while gains are missing and reports the raw inoculum alongside", () => {
    const res = r2Evaluate(build([10, 10], [1]));
    expect(res.shown).toBe(false);
    expect(r2Verdict(res)).toBeNull();
    const sets = [garden("scaf", 0, 0, [10], [1, 3]), garden("scaf", 0, 1, [30], [5, 9])];
    const h = r2Evaluate(sets).histories[0];
    expect(h.standardised.gain).toBe(20);
    expect(h.raw).toEqual({ t0: 2, tC: 7, gain: 5 });
  });
});

/** A competence source: `successes` of `n` fragment rows succeed, plus optional variant rows. */
function source(arm: "scaf" | "rand" | "cont" | "ancestor", history: number, timing: "a" | "b", frac: number, extra: Record<string, number> = {}): AssaySet {
  const rows = (inoculum: string, f: number): AssayRow[] =>
    Array.from({ length: 100 }, (_, i) => fragRow({ assay: "competence", inoculum, pond: i, success: i < Math.round(f * 100) ? 1 : 0 }));
  return {
    labels: assayLabels({ arm, ...(arm === "ancestor" ? {} : { history }), timing }),
    rows: [...rows("fragment", frac), ...Object.entries(extra).flatMap(([k, f]) => rows(k, f))],
  };
}

/** Sources for scaf histories 0..5 plus rand, cont and ancestor at both timings. */
function r3World(over: { scaf?: (i: number, t: "a" | "b") => number; other?: number; anc?: number; swapEa?: (i: number) => number; quench?: number | null; quenchAt?: (i: number, t: "a" | "b") => number } = {}): AssaySet[] {
  const sets: AssaySet[] = [];
  for (let i = 0; i < 6; i++) {
    for (const t of ["a", "b"] as const) {
      const extra: Record<string, number> = {};
      if (t === "a") {
        extra["swap-ea"] = over.swapEa?.(i) ?? 0.6;
        extra["swap-ae"] = 0.1;
      }
      if (over.quench !== null) extra.quenched = over.quenchAt?.(i, t) ?? over.quench ?? 0.02;
      sets.push(source("scaf", i, t, over.scaf?.(i, t) ?? 0.8, extra));
      sets.push(source("rand", i, t, over.other ?? 0.3));
      sets.push(source("cont", i, t, over.other ?? 0.3));
    }
  }
  sets.push(source("ancestor", -1, "a", over.anc ?? 0.4), source("ancestor", -1, "b", over.anc ?? 0.4));
  return sets;
}

/**
 * Loaded evolution runs for every (arm, history) of `expected` (what a full `--runs` gives the sensitivity);
 * `flagged` lists the "arm-i" identities whose run had over 1% truncated recipient rows.
 */
function evoCover(expected: readonly AssayKey[], flagged: readonly string[] = []): HistoryTruncation[] {
  const ids = new Map(expected.filter((k) => k.arm !== "ancestor").map((k) => [`${k.arm}-${k.history}`, k]));
  return [...ids].map(([id, k]) => ({ arm: k.arm as "scaf" | "rand" | "cont", history: k.history, truncated: flagged.includes(id) ? 5 : 0, rows: 100, fraction: flagged.includes(id) ? 0.05 : 0, flagged: flagged.includes(id) }));
}

describe("R3", () => {
  it("computes competence from success flags, or recomputes it from ref when the flag is -1", () => {
    const rows = [
      fragRow({ endTrait: 100, retMass: 10, success: -1 }), // 4*100 >= 200, 100 >= 40
      fragRow({ endTrait: 100, retMass: 30, success: -1 }), // 100 < 120
      fragRow({ endTrait: 10, retMass: 0, success: -1 }), // 40 < 200
      fragRow({ success: 1 }),
    ];
    expect(competence(rows, 200)).toEqual({ n: 4, successes: 2, value: 0.5 });
    expect(competence([], 200).value).toBeNull();
    expect(() => competence(rows, null)).toThrow(/no ref/);
  });

  it("is decisive when advantage and swap criteria hold in at least 4 of 6 histories and the quenched control is clean", () => {
    // adv vs ancestor = 0.4, swap ea 0.6 vs ancestor 0.4 -> 0.2 >= 0.5 * 0.4
    const res = r3Evaluate(r3World());
    expect(res.advantageHistories).toBe(6);
    expect(res.swapHistories).toBe(6);
    expect(res.quenched).toMatchObject({ n: 12, max: 0.02, unreliable: false });
    expect(res.decisive).toBe(true);
    expect(r3Verdict(res)).toBe(true);
    expect(res.histories[0].a).toMatchObject({ scaf: 0.8, rand: 0.3, ancestor: 0.4 });
    expect(res.histories[0].a.advAncestor).toBeCloseTo(0.4, 12);
  });

  it("needs advantage at both timings against every comparator", () => {
    const b = (i: number, t: "a" | "b") => (t === "b" && i >= 3 ? 0.25 : 0.8); // histories 3-5 lose to controls at (b)
    const res = r3Evaluate(r3World({ scaf: b }));
    expect(res.advantageHistories).toBe(3);
    expect(res.decisive).toBe(false);
    expect(r3Verdict(res)).toBe(false);
    // a tie is not an advantage
    const tie = r3Evaluate(r3World({ anc: 0.8 }));
    expect(tie.advantageHistories).toBe(0);
  });

  it("needs the matched-swap criterion in 4 of 6 histories", () => {
    const res = r3Evaluate(r3World({ swapEa: (i) => (i < 3 ? 0.6 : 0.5) })); // 0.5 - 0.4 = 0.1 < 0.2
    expect(res.advantageHistories).toBe(6);
    expect(res.swapHistories).toBe(3);
    expect(res.decisive).toBe(false);
    expect(res.histories[3].swapCriterion).toBe(false);
  });

  it("is unreliable, and not decisive, when the quenched control exceeds 0.05 or is missing", () => {
    const loud = r3Evaluate(r3World({ quench: 0.1 }));
    expect(loud.quenched.unreliable).toBe(true);
    expect(loud.decisive).toBe(false);
    const missing = r3Evaluate(r3World({ quench: null }));
    expect(missing.quenched).toMatchObject({ n: 0, unreliable: true });
    expect(missing.decisive).toBe(false);
    expect(r3Verdict(missing)).toBeNull(); // not certifiable yet, so still open
    expect(r3Evaluate(r3World({ quench: 0.05 })).quenched.unreliable).toBe(false); // at most 0.05
  });

  it("counts a history with a missing source as failing, and reports retained-mass distributions", () => {
    const sets = r3World().filter((s) => !(s.labels.arm === "cont" && s.labels.history === 2));
    const res = r3Evaluate(sets);
    expect(res.histories[2].advantage).toBe(false);
    expect(res.advantageHistories).toBe(5);
    expect(res.decisive).toBe(true); // 5 of 6 still meets "at least 4"
    const sparse = r3Evaluate(r3World().filter((s) => !(s.labels.arm === "cont" && s.labels.history >= 2)));
    expect(sparse.decisive).toBe(false);
    expect(r3Verdict(sparse)).toBeNull(); // missing sources leave the verdict open
    expect(res.unmatched[0].retMass).toMatchObject({ n: 100, mean: 100 });
  });
});

describe("R3 verdict", () => {
  it("is true only with every source, swap and quenched control present", () => {
    expect(r3Evaluate(r3World()).complete).toBe(true);
    // scaf_5 at (b) has no quenched control: decisive on the data so far, but not certifiable
    const noQ = r3World().map((s) => (s.labels.arm === "scaf" && s.labels.history === 5 && s.labels.timing === "b" ? { ...s, rows: s.rows.filter((r) => r.inoculum !== "quenched") } : s));
    const r = r3Evaluate(noQ);
    expect(r.decisive).toBe(true);
    expect(r.complete).toBe(false);
    expect(r3Verdict(r)).toBeNull();
    // a missing Ga-on-Fe also leaves it open
    const noAe = r3World().map((s) => (s.labels.arm === "scaf" && s.labels.history === 0 && s.labels.timing === "a" ? { ...s, rows: s.rows.filter((r) => r.inoculum !== "swap-ae") } : s));
    expect(r3Verdict(r3Evaluate(noAe))).toBeNull();
  });

  it("does not let a later scaf source flip a premature true: one clean quenched set is not enough", () => {
    // only scaf_0 at (a) so far: its quenched control is clean, but nothing else has arrived
    const early = r3Evaluate(r3World().filter((s) => (s.labels.arm === "scaf" ? s.labels.history === 0 && s.labels.timing === "a" : false)));
    expect(early.quenched.unreliable).toBe(false);
    expect(early.decisive).toBe(false);
    expect(r3Verdict(early)).not.toBe(true);
    // a noisy quenched control arriving later makes the result false for good
    const loud = r3World().map((s) => (s.labels.arm === "scaf" && s.labels.history === 3 && s.labels.timing === "b" ? { ...s, rows: [...s.rows.filter((r) => r.inoculum !== "quenched"), ...source("scaf", 3, "b", 0, { quenched: 0.2 }).rows.filter((r) => r.inoculum === "quenched")] } : s));
    expect(r3Verdict(r3Evaluate(loud))).toBe(false);
  });

  it("is false as soon as a 4-of-6 count cannot be reached, even with sources missing", () => {
    // histories 2-5 lose to the ancestor at (a): 2 possible advantage histories, whatever else arrives
    const partial = r3World({ scaf: (i, t) => (i >= 2 && t === "a" ? 0.1 : 0.8) }).filter((s) => s.labels.arm !== "cont");
    const r = r3Evaluate(partial);
    expect(r.advantagePossible).toBe(2);
    expect(r3Verdict(r)).toBe(false);
    // missing inputs keep a history possible
    expect(r3Evaluate(r3World().filter((s) => s.labels.arm !== "cont")).advantagePossible).toBe(6);
    expect(r3Verdict(r3Evaluate(r3World().filter((s) => s.labels.arm !== "cont")))).toBeNull();
  });

  it("is false once the swap criterion is out of reach in 3 histories", () => {
    const r = r3Evaluate(r3World({ swapEa: (i) => (i < 2 ? 0.6 : 0.4) }).filter((s) => s.labels.arm !== "cont"));
    expect(r.swapPossible).toBe(2);
    expect(r3Verdict(r)).toBe(false);
  });
});

describe("assay truncation rule", () => {
  const withTruncated = (set: AssaySet, n: number): AssaySet => ({ ...set, rows: set.rows.map((r, i) => ({ ...r, truncated: i < n ? 1 : 0 })) });

  it("flags a set with more than 1% truncated rows and repeats the verdict without it", () => {
    const sets = r3World();
    const noTrunc = sets.map((s) => withTruncated(s, 0));
    const r3 = (x: readonly AssaySet[], e: Parameters<typeof r3Verdict>[1]) => r3Verdict(r3Evaluate(x), e);
    expect(assaySensitivity(noTrunc, r3, R3_EXPECTED, evoCover(R3_EXPECTED), true)).toMatchObject({ flagged: [], known: true, evolutionKnown: true, verdict: true, without: true, sensitive: false });
    // scaf_1 at (a): 300 rows in the set (fragment, swap-ea, swap-ae, quenched -> 400), 5 truncated is > 1%
    const flaggedSets = noTrunc.map((s) => (s.labels.arm === "scaf" && s.labels.history === 1 && s.labels.timing === "a" ? withTruncated(s, 5) : s));
    const res = assaySensitivity(flaggedSets, r3, R3_EXPECTED, evoCover(R3_EXPECTED), true);
    expect(res.flagged).toHaveLength(1);
    expect(res.flagged[0]).toMatchObject({ arm: "scaf", history: 1, timing: "a", truncated: 5 });
    // the left-out history is not missing data: the other 5 histories still decide it, and 4 of 5 is needed
    expect(res).toMatchObject({ verdict: true, without: true, sensitive: false, inconclusive: false });
  });

  it("is not sensitive when the flagged set does not change the verdict, and reports unknown columns", () => {
    const sets = r3World().map((s) => withTruncated(s, 0));
    // R1 needs 4 of 6 histories: a fifth, flagged one changes nothing when left out
    const r1 = (i: number, trunc: number): AssaySet => {
      const r = lcg(40 + i);
      const rows = transmissionRows((fam) => 500 * fam + Math.floor(r() * 10)).map((row, j) => ({ ...row, truncated: j < trunc ? 1 : 0 }));
      return { labels: assayLabels({ arm: "scaf", history: i, time: 1 }), rows };
    };
    const five = [0, 1, 2, 3, 4].map((i) => r1(i, i === 4 ? 10 : 0));
    const res = assaySensitivity(five, (x, e) => r1Verdict(r1Evaluate(x), e), R1_EXPECTED, evoCover(R1_EXPECTED));
    expect(res).toMatchObject({ verdict: true, without: true, sensitive: false });
    expect(res.flagged.map((f) => f.history)).toEqual([4]);
    // rows without the column cannot be flagged and are reported as not known
    expect(assaySensitivity(sets.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r, truncated: null })) })), (x, e) => r3Verdict(r3Evaluate(x), e), R3_EXPECTED, evoCover(R3_EXPECTED), true).known).toBe(false);
  });

  it("judges R2 without a flagged history against the histories that remain, not as missing data", () => {
    // all 6 scaf gains +100, rand gains 0: the rule clearly holds; flag one rand set (2 of its 3 rows truncated)
    const sets = [0, 1, 2, 3, 4, 5].flatMap((i) => [garden("scaf", i, 0, [100]), garden("scaf", i, 1, [200]), garden("rand", i, 0, [100]), garden("rand", i, 1, [100])]);
    const flag = (x: AssaySet[]) => x.map((s) => (s.labels.arm === "rand" && s.labels.history === 3 && s.labels.time === 1 ? { ...s, rows: s.rows.map((r, j) => ({ ...r, truncated: j < 2 ? 1 : 0 })) } : { ...s, rows: s.rows.map((r) => ({ ...r, truncated: 0 })) }));
    const res = assaySensitivity(flag(sets), (x, e) => r2Verdict(r2Evaluate(x), e), R2_EXPECTED, evoCover(R2_EXPECTED));
    expect(res.flagged).toHaveLength(1);
    expect(res).toMatchObject({ verdict: true, without: true, sensitive: false, inconclusive: false });
  });

  it("is sensitive when leaving the flagged history out flips a decided verdict, and inconclusive when nothing is left to judge", () => {
    // R1 with 5 histories: 4 demonstrated (incl. flagged h4), h5 weak. Full: 4 of 6 -> true.
    const strong = (i: number, trunc: number): AssaySet => {
      const r = lcg(40 + i);
      return { labels: assayLabels({ arm: "scaf", history: i, time: 1 }), rows: transmissionRows((fam) => 500 * fam + Math.floor(r() * 10)).map((row, j) => ({ ...row, truncated: j < trunc ? 1 : 0 })) };
    };
    const weak = (i: number, seed: number): AssaySet => {
      const r = lcg(seed);
      return { labels: assayLabels({ arm: "scaf", history: i, time: 1 }), rows: transmissionRows(() => Math.floor(r() * 1000)).map((row) => ({ ...row, truncated: 0 })) };
    };
    const r1 = (x: readonly AssaySet[], e: Parameters<typeof r1Verdict>[1]) => r1Verdict(r1Evaluate(x), e);
    const sets = [strong(0, 0), strong(1, 0), strong(2, 0), strong(3, 10), weak(4, 64), weak(5, 62)];
    // dropping strong h3 leaves 3 of 5 (need 4): true -> false
    expect(assaySensitivity(sets, r1, R1_EXPECTED, evoCover(R1_EXPECTED))).toMatchObject({ verdict: true, without: false, sensitive: true, inconclusive: false });
    // every history flagged: nothing remains to judge
    const all = [0, 1, 2, 3, 4, 5].map((i) => strong(i, 10));
    expect(assaySensitivity(all, r1, R1_EXPECTED, evoCover(R1_EXPECTED))).toMatchObject({ verdict: true, without: null, sensitive: false, inconclusive: true });
  });

  it("scales 4 of 6 to the histories that remain", () => {
    expect([6, 5, 4, 3, 2, 1, 0].map(atLeastFourOfSix)).toEqual([4, 4, 3, 2, 2, 1, 0]);
  });

  it("keys a set by time, or by timing", () => {
    expect(setKey(assayLabels({ arm: "scaf", history: 2, time: 1 }))).toEqual({ arm: "scaf", history: 2, time: 1 });
    expect(setKey(assayLabels({ arm: "ancestor", timing: "a" }))).toEqual({ arm: "ancestor", history: -1, time: 0 });
  });
});

describe("assay CLI output through the report's readers", () => {
  const planted = (over: Partial<Planted> = {}): Planted => ({ reqMass: 300, retMass: 250, reqE: 900, retE: 800, landed: 9, truncated: true, ...over });

  it("reads assay.tsv lines back with reqE, retE and truncated", async () => {
    const lines = [ASSAY_COLUMNS.join("\t"), assayLine({ assay: "transmission", source: "src", replicate: 1, pond: 3, family: 7, inoculum: "fragment", planted: planted(), endTrait: 1234, success: -1 })];
    const rows = await collect(tsvRows(lines));
    expect(assayRow(rows[0])).toMatchObject({ assay: "transmission", family: 7, reqMass: 300, retMass: 250, reqE: 900, retE: 800, truncated: 1, endTrait: 1234, success: -1 });
    expect(ASSAY_COLUMNS.slice(0, 10)).toEqual(["assay", "source", "replicate", "pond", "family", "inoculum", "reqMass", "retMass", "endTrait", "success"]);
  });

  /** The assay.json runAssay writes, round-tripped through JSON, read by assayLabels. */
  const written = (assay: "competence" | "transmission" | "garden", flags: Parameters<typeof parseAssayLabels>[1], inoculum: string, seed: number, extra: Record<string, unknown> = {}, ref: number | null = 40) => {
    const labels = parseAssayLabels(assay, flags);
    const json = assayJson({
      protocolSha256: "0".repeat(64),
      assay,
      source: "ckpt",
      tag: "t",
      k: 5,
      period: 3000,
      ref,
      side: 8,
      replicates: 2,
      censusEvery: 100,
      inoculum,
      seeds: [{ physics: seed, fragment: seed }, { physics: seed + 1, fragment: seed + 1 }],
      labels,
      extra,
      summary: { rows: 128 },
      wallSeconds: 1,
    });
    return { labels, parsed: JSON.parse(JSON.stringify(json)) as Record<string, unknown> };
  };

  it("labels every assay kind so assayLabels accepts it", () => {
    const comp = written("competence", { arm: "scaf", history: "2", timing: "b" }, "fragment", assaySeed(3, 2, 1, 0, 0));
    expect(assayLabels(comp.parsed)).toMatchObject({ arm: "scaf", history: 2, time: 1, timing: "b", ref: 40, k: 5, period: 3000, calibration: null });
    const tr = written("transmission", { arm: "rand", history: "4", time: "1" }, "fragment", assaySeed(1, 10, 1, 0, 0), { donors: [1, 2], insufficient: false });
    expect(assayLabels(tr.parsed)).toMatchObject({ arm: "rand", history: 4, time: 1, insufficient: false });
    const ga = written("garden", { arm: "scaf", history: "0", time: "0" }, "disc", assaySeed(2, 0, 0, 1, 0));
    expect(assayLabels(ga.parsed)).toMatchObject({ arm: "scaf", history: 0, time: 0, timing: "a" });
    const anc = written("competence", { arm: "ancestor", timing: "a" }, "fragment", assaySeed(3, 18, 0, 0, 0));
    expect(assayLabels(anc.parsed)).toMatchObject({ arm: "ancestor", history: -1, timing: "a" });
    const ins = written("transmission", { arm: "scaf", history: "1", time: "0" }, "fragment", assaySeed(1, 1, 0, 0, 0), { insufficient: true });
    expect(assayLabels(ins.parsed).insufficient).toBe(true);
  });

  it("labels the calibration sets, which share the ancestor's seed 4,802,011", () => {
    const one = written("competence", { arm: "ancestor", timing: "a", calibration: "1" }, "fragment", 4_802_011);
    expect(assayLabels(one.parsed)).toMatchObject({ arm: "ancestor", calibration: 1, k: 5, period: 3000 });
    const two = written("competence", { arm: "ancestor", timing: "a", calibration: "2" }, "quenched", 4_802_011);
    expect(assayLabels(two.parsed).calibration).toBe(2);
  });

  it("checks the labels against the decoded seeds, with the swap-ea exception", () => {
    const labels = (o: Parameters<typeof parseAssayLabels>[1]) => parseAssayLabels("competence", o);
    const ok = (l: ReturnType<typeof labels>, inoc: string, seed: number) => checkAssaySeeds("competence", l, inoc, { physics: seed, fragment: seed });
    // scaf history 2 at (b): h = 2, t = 1
    expect(() => ok(labels({ arm: "scaf", history: "2", timing: "b" }), "fragment", assaySeed(3, 2, 1, 0, 0))).not.toThrow();
    expect(() => ok(labels({ arm: "scaf", history: "2", timing: "b" }), "fragment", assaySeed(3, 3, 1, 0, 0))).toThrow(/h 3, want 2/);
    expect(() => ok(labels({ arm: "scaf", history: "2", timing: "a" }), "fragment", assaySeed(3, 2, 1, 0, 0))).toThrow(/t 1, want 0/);
    expect(() => ok(labels({ arm: "rand", history: "2", timing: "a" }), "fragment", assaySeed(3, 2, 0, 0, 0))).toThrow(/h 2, want 8/);
    expect(() => ok(labels({ arm: "scaf", history: "2", timing: "a" }), "fragment", assaySeed(1, 2, 0, 0, 0))).toThrow(/r 1, want 3/);
    expect(() => ok(labels({ arm: "scaf", history: "2", timing: "a" }), "fragment", assaySeed(3, 2, 0, 0, 1))).toThrow(/s 1/);
    // Ge-on-Fa: ancestor fragments (h = 18), labelled with the scaf history it tests
    const ea = labels({ arm: "scaf", history: "2", timing: "a" });
    expect(() => ok(ea, "swap-ea", assaySeed(3, 18, 0, 0, 0))).not.toThrow();
    expect(() => ok(ea, "swap-ea", assaySeed(3, 2, 0, 0, 0))).toThrow(/h 2, want 18/);
    // Ga-on-Fe uses the history's own fragments
    expect(() => ok(ea, "swap-ae", assaySeed(3, 2, 0, 0, 0))).not.toThrow();
    // R2's disc inoculum has v = 1 for physics and v = 0 for fragments
    const g = parseAssayLabels("garden", { arm: "scaf", history: "0", time: "0" });
    expect(() => checkAssaySeeds("garden", g, "disc", { physics: assaySeed(2, 0, 0, 1, 0), fragment: assaySeed(2, 0, 0, 0, 0) })).not.toThrow();
    expect(() => checkAssaySeeds("garden", g, "disc", { physics: assaySeed(2, 0, 0, 0, 0), fragment: assaySeed(2, 0, 0, 0, 0) })).toThrow(/v 0, want 1/);
    // calibration: the quenched control takes the ancestor's streams; 1 and 2 are labels only
    const cal = labels({ arm: "ancestor", timing: "a", calibration: "2" });
    expect(() => ok(cal, "quenched", 4_802_011)).not.toThrow();
    expect(() => ok(labels({ arm: "ancestor", timing: "a", calibration: "1" }), "fragment", 4_802_011)).not.toThrow();
    expect(() => checkAssaySeeds("competence", cal, "quenched", { physics: 4_802_012, fragment: 4_802_012 }, 1)).not.toThrow();
    expect(() => checkAssaySeeds("competence", cal, "quenched", { physics: 4_802_011, fragment: 4_802_011 }, 1)).toThrow(/needs seed 4802012/);
    // the legacy separately seeded quenched control is refused with its reason, not a crash
    expect(() => ok(cal, "quenched", 4_802_021)).toThrow(/legacy separately seeded quenched control.*not a decision input/);
    expect(() => ok(labels({ arm: "ancestor", timing: "a", calibration: "1" }), "fragment", 4_802_021)).toThrow(/needs seed 4802011/);
    expect(() => ok(cal, "quenched", 4_802_001)).toThrow(/needs seed 4802011/);
  });

  it("checks replicate s against s, and derives R1's donor seed from the labels", () => {
    const l = parseAssayLabels("transmission", { arm: "rand", history: "3", time: "0" });
    const at = (s: number) => ({ physics: assaySeed(1, 9, 0, 0, s), fragment: assaySeed(1, 9, 0, 0, s) });
    expect(() => checkAssaySeeds("transmission", l, "fragment", at(1), 1)).not.toThrow();
    expect(() => checkAssaySeeds("transmission", l, "fragment", at(0), 1)).toThrow(/s 0, want 1/);
    expect(donorSeedOf(l)).toBe(assaySeed(1, 9, 0, 0, 9));
    expect(donorSeedOf(parseAssayLabels("transmission", { arm: "scaf", history: "2", time: "1" }))).toBe(assaySeed(1, 2, 1, 0, 9));
    expect(() => checkDonorSeed(l, assaySeed(1, 9, 0, 0, 9))).not.toThrow();
    expect(() => checkDonorSeed(l, assaySeed(1, 9, 0, 0, 8))).toThrow(/donor seed/); // the permutation stream, not the donors
    expect(() => checkDonorSeed(l, assaySeed(1, 3, 0, 0, 9))).toThrow(/donor seed/);
    expect(() => donorSeedOf(parseAssayLabels("competence", { arm: "cont", history: "1", timing: "a" }))).toThrow(/scaf or rand/);
  });

  it("refuses incomplete or inconsistent labels", () => {
    expect(() => parseAssayLabels("competence", { timing: "a" })).toThrow(/--arm/);
    expect(() => parseAssayLabels("competence", { arm: "scaf", timing: "a" })).toThrow(/--history/);
    expect(() => parseAssayLabels("competence", { arm: "scaf", history: "1" })).toThrow(/--time/);
    expect(() => parseAssayLabels("competence", { arm: "scaf", history: "1", time: "0", timing: "b" })).toThrow(/disagree/);
    expect(() => parseAssayLabels("competence", { arm: "ancestor", history: "1", timing: "a" })).toThrow(/ancestor/);
    expect(() => parseAssayLabels("transmission", { arm: "cont", history: "1", time: "0" })).toThrow(/--arm/);
    expect(() => parseAssayLabels("competence", { arm: "scaf", history: "1", timing: "a", calibration: "1" })).toThrow(/ancestor/);
    expect(() => parseAssayLabels("competence", { arm: "scaf", history: "6", timing: "a" })).toThrow(/0-5/);
  });

  it("inverts assaySeed", () => {
    for (const [r, h, t, v, s] of [[0, 0, 0, 0, 0], [4, 18, 1, 4, 9], [3, 7, 1, 2, 5], [1, 18, 0, 0, 9]]) expect(decodeAssaySeed(assaySeed(r, h, t, v, s))).toEqual({ r, h, t, v, s });
    expect(() => decodeAssaySeed(4_800_001)).toThrow();
    expect(() => decodeAssaySeed(4_802_011)).toThrow();
  });
});

describe("P2 run validation", () => {
  const regime = { k: 8, period: 10000 };
  const planting = Array.from({ length: 64 }, (_, t) => t % 12);
  const meta = (role: "rank" | "scaf" | "rand", over: Record<string, unknown> = {}) => ({
    arm: role === "rank" ? "cont" : role,
    init: "founders",
    mutRate: 0,
    side: 8,
    k: role === "rank" ? 0 : 8,
    period: 10000,
    cycles: role === "rank" ? 1 : 20,
    seed: role === "rank" ? 4_805_001 : role === "scaf" ? 4_805_101 : 4_805_111,
    plantingToFounder: planting,
    ...over,
  });

  it("accepts the protocol's ranking and selection runs", () => {
    expect(p2RunProblems(meta("rank"), "rank", regime)).toEqual([]);
    expect(p2RunProblems(meta("rank", { seed: 4_805_002 }), "rank", regime)).toEqual([]);
    expect(p2RunProblems(meta("scaf", { seed: 4_805_102 - 1 }), "scaf", regime)).toEqual([]);
    expect(p2RunProblems(meta("rand", { seed: 4_805_112 }), "rand", regime)).toEqual([]);
    expect(p2Replicate(4_805_111, "rand")).toBe(0);
    expect(p2Replicate(4_805_102, "scaf")).toBe(1);
    expect(p2Replicate(4_805_103, "scaf")).toBeNull();
    expect(p2Replicate(4_805_101, "rand")).toBeNull();
  });

  it("names every way a run is not the protocol's", () => {
    const why = (role: "rank" | "scaf" | "rand", over: Record<string, unknown>) => p2RunProblems(meta(role, over), role, regime).join("; ");
    expect(why("rank", { arm: "scaf" })).toMatch(/arm "scaf", want "cont"/);
    expect(why("scaf", { arm: "rand" })).toMatch(/arm "rand", want "scaf"/);
    expect(why("rank", { init: "clone" })).toMatch(/init "clone", want "founders"/);
    expect(why("scaf", { mutRate: 429_497 })).toMatch(/mutRate 429497, want 0/);
    expect(why("scaf", { side: 4 })).toMatch(/side 4, want 8/);
    expect(why("scaf", { cycles: 15 })).toMatch(/cycles 15, want 20/);
    expect(why("rank", { cycles: 2 })).toMatch(/cycles 2, want 1/);
    expect(why("scaf", { k: 5 })).toMatch(/k 5, want 8/);
    expect(why("scaf", { period: 3000 })).toMatch(/period 3000, want 10000/);
    expect(why("rank", { period: 3000 })).toMatch(/period 3000, want 10000/);
    expect(why("rank", { seed: 4_805_003 })).toMatch(/seed 4805003, want 4805001 \+ s/);
    expect(why("rand", { seed: 4_805_101 })).toMatch(/seed 4805101, want 4805111 \+ s/);
    expect(why("scaf", { seed: 4_805_111 })).toMatch(/seed 4805111, want 4805101 \+ s/);
    expect(why("scaf", { plantingToFounder: planting.slice(1) })).toMatch(/round-robin/);
    expect(why("scaf", { plantingToFounder: undefined })).toMatch(/round-robin/);
    expect(why("scaf", { plantingToFounder: planting.map((f) => (f + 1) % 12) })).toMatch(/round-robin/);
    // k does not apply to the no-cycle ranking run
    expect(why("rank", { k: 99 })).toBe("");
  });
});

describe("main-run histories", () => {
  const meta = (over: Record<string, unknown> = {}) => ({ arm: "rand", init: "clone", mutRate: 429_497, side: 8, k: 8, period: 10000, cycles: 100, seed: 4_810_104, ...over });

  it("reads the (arm, history) of a main run and explains anything else", () => {
    expect(mainRunOf(meta(), null)).toEqual({ key: { arm: "rand", history: 3 }, why: [] });
    expect(mainRunOf(meta({ arm: "scaf", seed: 4_810_001 }), { k: 8, period: 10000 }).key).toEqual({ arm: "scaf", history: 0 });
    expect(mainRunOf(meta({ arm: "cont", seed: 4_810_206, k: 0 }), { k: 8, period: 10000 }).key).toEqual({ arm: "cont", history: 5 });
    const why = (over: Record<string, unknown>, regime: { k: number; period: number } | null = null) => mainRunOf(meta(over), regime).why.join("; ");
    expect(mainRunOf(meta({ seed: 4_805_101 }), null).key).toBeNull();
    expect(why({ seed: 4_810_107 })).toMatch(/not 4810001 \+ 100 arm \+ i/);
    expect(why({ seed: 4_810_003 })).toMatch(/for arm rand/);
    expect(why({ side: 4 })).toMatch(/side 4, want 8/);
    expect(why({ init: "founders" })).toMatch(/init "founders"/);
    expect(why({ mutRate: 0 })).toMatch(/mutation off/);
    expect(why({ cycles: 20 })).toMatch(/cycles 20, want 100/);
    expect(why({ k: 5 }, { k: 8, period: 10000 })).toMatch(/k 5, want 8/);
    expect(why({ period: 1000, cycles: 1000 }, { k: 8, period: 10000 })).toMatch(/period 1000, want 10000/);
  });

  const tsv = (rows: { cycle: number; recipient: number; donor: number; ret: number; trait: number; truncated?: number }[]) =>
    tsvRows(["cycle\trecipient\tdonor\tretMass\trecipientTrait\ttruncated", ...rows.map((r) => `${r.cycle}\t${r.recipient}\t${r.donor}\t${r.ret}\t${r.trait}\t${r.truncated ?? 0}`)]);

  /** 8 recipients per cycle; donor 0 seeds recipients 0-3, donor 1 seeds 4-7; `next(b, r, ret)` is the trait at boundary b (pre-cycle). */
  const history = (cycles: number, traitAt: (cycle: number, r: number, ret: number) => number, lastCycle = cycles) => {
    const rows = [];
    for (let cycle = 1; cycle <= lastCycle; cycle++)
      for (let r = 0; r < 8; r++) {
        const ret = 10 + ((r * 7 + cycle * 3) % 11);
        rows.push({ cycle, recipient: r, donor: r < 4 ? 0 : 1, ret, trait: traitAt(cycle, r, ret) });
      }
    return rows;
  };
  const noise = lcg(7);

  it("reports the donor-family ICC of next-boundary traits for every cycle with a next boundary, and the mean over all and over the last half", async () => {
    // the donor sets the trait from boundary 4 on (boundaries 2 and 3 carry noise only), so the early cycles b = 1, 2 show no donor effect
    const rows = history(6, (c, r) => (c >= 4 ? 1000 * (r < 4 ? 1 : 0) : 0) + Math.floor(noise() * 400));
    const { repeatability, truncation } = await summariseHistory(tsv(rows), 6, true);
    expect(truncation).toMatchObject({ truncated: 0, rows: 48, flagged: false });
    // C = 6: every cycle 1..5 has a next boundary; the last half is b > 3
    const r = repeatability!;
    expect(r.perCycle.map((c) => [c.cycle, c.n, c.families])).toEqual([[1, 8, 2], [2, 8, 2], [3, 8, 2], [4, 8, 2], [5, 8, 2]]);
    const icc = r.perCycle.map((c) => c.icc!);
    expect(r.all.cycles).toBe(5);
    expect(r.all.mean!).toBeCloseTo(icc.reduce((a, x) => a + x, 0) / 5, 12);
    expect(r.lastHalf.cycles).toBe(2);
    expect(r.lastHalf.mean!).toBeCloseTo((icc[3] + icc[4]) / 2, 12);
    expect(r.lastHalf.mean!).toBeGreaterThan(0.5); // the retained-mass fit takes a little of a donor effect
    expect(r.all.mean!).toBeLessThan(r.lastHalf.mean!); // the omitted early cycles would have changed the mean
  });

  it("removes the within-cycle dependence on retained B+P before the ICC", async () => {
    // the next trait depends on retained mass only; donors differ in mass, so the raw ICC is large and the residual one is not
    const rows = history(6, (_c, r, ret) => Math.round(300 * Math.log1p(ret) * 50) + Math.floor(noise() * 3) * (r % 2 ? 1 : -1));
    // give the donors different retained mass: donor 1's recipients retain more
    const skewed = rows.map((x) => ({ ...x, ret: x.donor === 1 ? x.ret + 400 : x.ret, trait: Math.round(15000 * Math.log1p(x.donor === 1 ? x.ret + 400 : x.ret)) + (x.recipient % 3) }));
    const { repeatability } = await summariseHistory(tsv(skewed), 6, true);
    expect(repeatability!.all.mean!).toBeLessThan(0.3);
    expect(repeatability!.lastHalf.mean!).toBeLessThan(0.3);
    const raw = icc1(skewed.filter((x) => x.cycle === 5).map((x) => x.trait), skewed.filter((x) => x.cycle === 5).map((x) => x.donor));
    expect(raw!).toBeGreaterThan(0.9);
  });

  it("stops at the last cycle with a next boundary when a history ended, skips donors for cont, and flags over 1% truncated rows exactly", async () => {
    // the history ended at cycle 5 of 6: cycle 5 has no next boundary, so b = 1..4 count and only b = 4 is in the last half
    const ended = history(6, (_c, r) => 1000 * (r < 4 ? 1 : 0) + Math.floor(noise() * 20), 5);
    const e = (await summariseHistory(tsv(ended), 6, true)).repeatability!;
    expect(e.perCycle.map((c) => c.cycle)).toEqual([1, 2, 3, 4]);
    expect(e.all.cycles).toBe(4);
    expect(e.lastHalf.cycles).toBe(1);
    // a complete history stops at C - 1
    expect((await summariseHistory(tsv(history(6, () => 1)), 6, true)).repeatability!.perCycle.map((c) => c.cycle)).toEqual([1, 2, 3, 4, 5]);
    expect((await summariseHistory(tsv(ended), 6, false)).repeatability).toBeNull();
    await expect(summariseHistory(tsv([...history(3, () => 1)].reverse()), 3, true)).rejects.toThrow(/must ascend/);
    const hundred = history(100, () => 1).slice(0, 100);
    expect((await summariseHistory(tsv(hundred.map((r, i) => ({ ...r, truncated: i < 1 ? 1 : 0 }))), 100, false)).truncation).toMatchObject({ truncated: 1, rows: 100, flagged: false });
    expect((await summariseHistory(tsv(hundred.map((r, i) => ({ ...r, truncated: i < 2 ? 1 : 0 }))), 100, false)).truncation).toMatchObject({ truncated: 2, rows: 100, flagged: true });
  });

  it("refuses a ponds.tsv whose recipients repeat or have gaps at a cycle, whatever the row count (RecipientGuard)", async () => {
    const good = history(4, () => 100);
    expect((await summariseHistory(tsv(good), 4, true)).truncation.rows).toBe(32);
    // Cycle 3's recipient 7 row replaced by a copy of recipient 0's: still 8 rows, only 7 ponds. Without the check the mean
    // trait of that cycle silently changes (the probe that found this).
    const dup = good.map((r) => (r.cycle === 3 && r.recipient === 7 ? { ...r, recipient: 0 } : r));
    await expect(summariseHistory(tsv(dup), 4, true)).rejects.toThrow(/two rows for cycle 3, recipient 0/);
    await expect(summariseHistory(tsv(dup), 4, false)).rejects.toThrow(/two rows for cycle 3, recipient 0/);
    // A gap without a repeat: recipients 0..6 and 8.
    const gap = good.map((r) => (r.cycle === 2 && r.recipient === 7 ? { ...r, recipient: 8 } : r));
    await expect(summariseHistory(tsv(gap), 4, true)).rejects.toThrow(/cycle 2 has 8 rows but none for recipient 7/);
    // A blank cell is not pond 0, even where pond 0's own row is the blanked one.
    const lines = ["cycle\trecipient\tdonor\tretMass\trecipientTrait\ttruncated", "1\t\t0\t5\t10\t0", "1\t1\t0\t5\t10\t0"];
    await expect(summariseHistory(tsvRows(lines), 1, false)).rejects.toThrow(/recipient "" is not a pond index/);
    await expect(r3RepTrajectory(tsvRows(lines))).rejects.toThrow(/recipient "" is not a pond index/);
    await expect(r3RepTrajectory(tsv(dup))).rejects.toThrow(/two rows for cycle 3, recipient 0/);
    // p1RunOf, whose rows are numbers by then
    const p1 = dup.map((r) => ({ cycle: r.cycle, recipient: r.recipient, retMass: r.ret, recipientTrait: r.trait, truncated: 0 }));
    expect(() => p1RunOf({ k: 8, period: 10000, seed: 1, side: 3, cycles: 4 }, { conservationOk: true, cycles: 4, ended: false } as never, p1)).toThrow(/two rows for cycle 3, recipient 0/);
  });

  it("RecipientGuard holds only the recipients of each cycle and accepts any order", () => {
    const g = new RecipientGuard();
    for (const [c, r] of [[1, 2], [1, 0], [1, 1], [2, 1], [2, 0]]) g.add(c, r);
    expect(() => g.finish()).not.toThrow();
    expect(() => g.add(2, -1)).toThrow(/not a pond index/);
    expect(() => g.add(2, 0.5)).toThrow(/not a pond index/);
    expect(() => new RecipientGuard().addRow({ cycle: "1", recipient: "x" })).toThrow(/"x" is not a pond index/);
    expect(() => new RecipientGuard().addRow({ cycle: "1" })).toThrow(/undefined is not a pond index/);
  });
});

describe("evolution truncation in the assay sensitivity", () => {
  const r1 = (x: readonly AssaySet[], e: Parameters<typeof r1Verdict>[1]) => r1Verdict(r1Evaluate(x), e);
  const r3 = (x: readonly AssaySet[], e: Parameters<typeof r3Verdict>[1]) => r3Verdict(r3Evaluate(x), e);
  const withT = (sets: AssaySet[]) => sets.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r, truncated: 0 })) }));
  const strong = (i: number, t: 0 | 1): AssaySet => {
    const r = lcg(40 + i);
    return { labels: assayLabels({ arm: "scaf", history: i, time: t }), rows: transmissionRows((fam) => 500 * fam + Math.floor(r() * 10)).map((row) => ({ ...row, truncated: 0 })) };
  };
  const weak = (i: number, seed: number): AssaySet => {
    const r = lcg(seed);
    return { labels: assayLabels({ arm: "scaf", history: i, time: 1 }), rows: transmissionRows(() => Math.floor(r() * 1000)).map((row) => ({ ...row, truncated: 0 })) };
  };

  it("leaves a history whose evolution run was truncated out of the sensitivity, though its assay fragments fit", () => {
    // 4 strong histories (assay rows untruncated), 2 weak: 4 of 6 demonstrate, so the verdict is true
    const sets = [strong(0, 1), strong(1, 1), strong(2, 1), strong(3, 1), weak(4, 64), weak(5, 62)];
    const plain = assaySensitivity(sets, r1, R1_EXPECTED, evoCover(R1_EXPECTED));
    expect(plain).toMatchObject({ flagged: [], evolutionKnown: true, evolutionMissing: [], evolutionFlagged: [], verdict: true, without: true, sensitive: false });
    // history 3's ponds.tsv had more than 1% truncated recipients: without it 3 of 5 demonstrate (need 4)
    const res = assaySensitivity(sets, r1, R1_EXPECTED, evoCover(R1_EXPECTED, ["scaf-3"]));
    expect(res).toMatchObject({ flagged: [], known: true, evolutionKnown: true, verdict: true, without: false, sensitive: true });
    expect(res.evolutionFlagged.map((h) => [h.arm, h.history])).toEqual([["scaf", 3]]);
    // decisions still use every history
    expect(res.verdict).toBe(plain.verdict);
    // another arm's flagged history does not touch scaf's R1 (its scaf_3 comparator is in the list, unflagged)
    expect(assaySensitivity(sets, r1, R1_EXPECTED, evoCover(R1_EXPECTED, ["rand-3"]))).toMatchObject({ without: true, sensitive: false });
  });

  it("is pending, never 'nothing flagged', unless every (arm, history) of the readout has a loaded evolution run", () => {
    const sets = [strong(0, 1), strong(1, 1), strong(2, 1), strong(3, 1), weak(4, 64), weak(5, 62)];
    const missingIds = (r: ReturnType<typeof assaySensitivity>) => r.evolutionMissing.map((m) => `${m.arm}-${m.history}`);
    // no --runs, or an empty list: every identity is missing
    for (const none of [null, []]) {
      const r = assaySensitivity(sets, r1, R1_EXPECTED, none);
      expect(r).toMatchObject({ verdict: true, evolutionKnown: false, without: null, sensitive: null, inconclusive: false });
      expect(missingIds(r)).toEqual(["scaf", "rand"].flatMap((arm) => [0, 1, 2, 3, 4, 5].map((i) => `${arm}-${i}`)));
    }
    // one history absent (missing, rejected or unfinished): pending, and named
    const partial = evoCover(R1_EXPECTED).filter((h) => !(h.arm === "rand" && h.history === 2));
    const r = assaySensitivity(sets, r1, R1_EXPECTED, partial);
    expect(r).toMatchObject({ evolutionKnown: false, without: null, sensitive: null });
    expect(missingIds(r)).toEqual(["rand-2"]);
    // even with a flagged history in the list the result stays pending
    expect(assaySensitivity(sets, r1, R1_EXPECTED, partial.map((h) => (h.history === 3 ? { ...h, flagged: true, truncated: 5 } : h)))).toMatchObject({ without: null, sensitive: null });
    // a run with no rows has no known truncation flag
    const empty = evoCover(R1_EXPECTED).map((h) => (h.arm === "scaf" && h.history === 0 ? { ...h, rows: 0 } : h));
    expect(missingIds(assaySensitivity(sets, r1, R1_EXPECTED, empty))).toEqual(["scaf-0"]);
    // the cont histories are needed only where the readout compares them (R3), not for R1
    expect(assaySensitivity(sets, r1, R1_EXPECTED, evoCover(R1_EXPECTED)).evolutionKnown).toBe(true);
    expect(assaySensitivity(withT(r3World()), r3, R3_EXPECTED, evoCover(R1_EXPECTED), true)).toMatchObject({ evolutionKnown: false, without: null, sensitive: null });
    expect(missingIds(assaySensitivity(withT(r3World()), r3, R3_EXPECTED, evoCover(R1_EXPECTED), true))).toEqual([0, 1, 2, 3, 4, 5].map((i) => `cont-${i}`));
  });

  it("drops the flagged history at both times and every variant, and its comparators' sources from R3", () => {
    // histories 4 and 5 lose to their controls at both timings: 4 of 6 advantage histories, decisive
    const sets = withT(r3World({ scaf: (i) => (i >= 4 ? 0.2 : 0.8) }));
    const plain = assaySensitivity(sets, r3, R3_EXPECTED, evoCover(R3_EXPECTED), true);
    expect(plain).toMatchObject({ verdict: true, without: true, sensitive: false });
    // flagging history 0 (both its timings and variants go) leaves 3 of 5 (need 4): true becomes false
    for (const arm of ["scaf", "rand", "cont"] as const) {
      expect(assaySensitivity(sets, r3, R3_EXPECTED, evoCover(R3_EXPECTED, [`${arm}-0`]), true)).toMatchObject({ verdict: true, without: false, sensitive: true });
    }
    // flagging a history that lost to its controls anyway leaves 4 of 4
    expect(assaySensitivity(sets, r3, R3_EXPECTED, evoCover(R3_EXPECTED, ["scaf-5"]), true)).toMatchObject({ verdict: true, without: true, sensitive: false });
  });

  it("removes a whole excluded R3 comparison, its quenched control included, so it cannot veto the rest", () => {
    // Astra's case: scaf_0's quenched control is loud (0.2 > 0.05), so the full R3 is not decisive (verdict false) ...
    const sets = withT(r3World({ quenchAt: (i) => (i === 0 ? 0.2 : 0.02) }));
    expect(r3(sets, R3_EXPECTED)).toBe(false);
    // ... but rand_0 is flagged by its evolution run: comparison 0 leaves as a whole (scaf_0, rand_0, cont_0, swaps, quenched),
    // and the five remaining comparisons all hold, so the verdict without it is true
    for (const arm of ["rand", "scaf", "cont"] as const) {
      const res = assaySensitivity(sets, r3, R3_EXPECTED, evoCover(R3_EXPECTED, [`${arm}-0`]), true);
      expect(res).toMatchObject({ verdict: false, without: true, sensitive: true, inconclusive: false });
    }
    // the same when the truncated set is an assay set of comparison 0 (here rand_0 at (b))
    const assayFlag = sets.map((s) => (s.labels.arm === "rand" && s.labels.history === 0 && s.labels.timing === "b" ? { ...s, rows: s.rows.map((r, j) => ({ ...r, truncated: j < 5 ? 1 : 0 })) } : s));
    expect(assaySensitivity(assayFlag, r3, R3_EXPECTED, evoCover(R3_EXPECTED), true)).toMatchObject({ verdict: false, without: true, sensitive: true });
    // a loud control of a retained comparison still vetoes
    const loud1 = withT(r3World({ quenchAt: (i) => (i === 0 || i === 1 ? 0.2 : 0.02) }));
    expect(assaySensitivity(loud1, r3, R3_EXPECTED, evoCover(R3_EXPECTED, ["rand-0"]), true)).toMatchObject({ verdict: false, without: false, sensitive: false });
    // the verdict itself reads the quenched veto over the comparisons it is expected to judge, with every set still present
    const without0 = R3_EXPECTED.filter((k) => k.history !== 0);
    expect(r3(sets, without0)).toBe(true);
    expect(r3(loud1, without0)).toBe(false);
    expect(r3Evaluate(sets).histories.map((h) => [h.quenched.a, h.quenched.b])[0]).toEqual([0.2, 0.2]);
  });

  it("combines assay-row flags and evolution flags", () => {
    const sets = [strong(0, 1), strong(1, 1), strong(2, 1), strong(3, 1), weak(4, 64), weak(5, 62)].map((s, i) => (i === 0 ? { ...s, rows: s.rows.map((r, j) => ({ ...r, truncated: j < 10 ? 1 : 0 })) } : s));
    const res = assaySensitivity(sets, r1, R1_EXPECTED, evoCover(R1_EXPECTED, ["scaf-1"]));
    expect(res.flagged).toHaveLength(1);
    expect(res.evolutionFlagged).toHaveLength(1);
    expect(res).toMatchObject({ verdict: true, without: false, sensitive: true }); // histories 0 and 1 out: 2 of 4
  });
});

describe("assayLabels", () => {
  it("reads flat and nested labels, h = 6 arm + i, and time-to-timing", () => {
    expect(assayLabels({ arm: "scaf", history: 2, time: "C", ref: 40 })).toEqual({ arm: "scaf", history: 2, time: 1, timing: "b", ref: 40, insufficient: false, calibration: null, k: null, period: null });
    expect(assayLabels({ labels: { arm: "rand", h: 9, timing: "a" }, insufficient: true })).toMatchObject({ arm: "rand", history: 3, time: null, timing: "a", insufficient: true });
    expect(assayLabels({ arm: "ancestor", timing: "b" })).toMatchObject({ history: -1, timing: "b" });
    expect(() => assayLabels({ arm: "nope" })).toThrow();
    expect(() => assayLabels({ arm: "scaf" })).toThrow(/history/);
  });
});

describe("R4", () => {
  it("passes rows through and summarises each arm's numeric columns", () => {
    const rows = [
      { arm: "scaf", history: 0, quality: 2, regeneration: 0.5 },
      { arm: "scaf", history: 1, quality: 4, regeneration: 0.7 },
      { arm: "ancestor", quality: 3, regeneration: 0.9, note: "text" },
    ];
    const t = r4Table(rows);
    expect(t.rows).toEqual(rows);
    expect(t.arms.scaf.n).toBe(2);
    expect(t.arms.scaf.measures.quality).toMatchObject({ mean: 3, median: 3, min: 2, max: 4 });
    expect(Object.keys(t.arms.ancestor.measures)).toEqual(["quality", "regeneration"]);
  });
});

describe("R4 rows from scaffold-assays capability", () => {
  // the assay.json `capability` writes: one flat row per source, labelled with its arm
  const capabilityJson = {
    tool: "scaffold-assays",
    assay: "capability",
    seed: 4_824_001,
    capability: [
      { arm: "scaf", history: 0, tag: "s0", source: "a.blck.gz", dominant: "0:5", evaluated: true, reps: 8, regenerated: 6, recovery: 0.9, quality: 0.5 },
      { arm: "scaf", history: 1, tag: "s1", source: "b.blck.gz", dominant: "0:9", evaluated: true, reps: 8, regenerated: 4, recovery: 0.7, quality: 0.3 },
      { arm: "ancestor", tag: "anc", source: "c.blck.gz", dominant: "0:2", evaluated: true, reps: 8, regenerated: 8, recovery: 1, quality: 0.9 },
      { arm: "rand", history: 0, tag: "r0", source: "d.blck.gz", dominant: "0:0", evaluated: false },
    ],
  };

  it("reads the capability rows and tabulates them per arm", () => {
    const t = r4Table(r4RowsOf(capabilityJson));
    expect(Object.keys(t.arms).sort()).toEqual(["ancestor", "rand", "scaf"]);
    expect(t.arms.scaf.n).toBe(2);
    expect(t.arms.scaf.measures.quality).toMatchObject({ n: 2, mean: 0.4 });
    expect(t.arms.scaf.measures.regenerated).toMatchObject({ mean: 5, min: 4, max: 6 });
    expect(t.arms.ancestor.measures.recovery.mean).toBe(1);
    expect(t.arms.rand.measures).toEqual({});
  });

  it("also reads a bare array, `rows`, and `sources` that carry an arm, and refuses rows without one", () => {
    expect(r4RowsOf([{ arm: "scaf", quality: 1 }])).toHaveLength(1);
    expect(r4RowsOf({ rows: [{ arm: "cont", quality: 1 }] })).toHaveLength(1);
    const old = r4RowsOf({ sources: [{ arm: "scaf", tag: "t", hi: 0, lo: 3, evaluation: { quality: 2, recovery: 0.5 } }] });
    expect(old[0]).toMatchObject({ arm: "scaf", recovery: 0.5 });
    expect(() => r4RowsOf({ sources: [{ tag: "t", evaluation: { recovery: 0.5 } }] })).toThrow(/no arm/);
    expect(r4RowsOf({ assay: "competence" })).toEqual([]);
  });
});

describe("decision table", () => {
  it("returns the first matching row for every row", () => {
    expect(decide({ p1: false })).toMatchObject({ row: 1, disposition: DECISION_TABLE[0] });
    expect(decide({ p1: true, p2: false })).toMatchObject({ row: 2 });
    expect(decide({ p1: true, p2: true, r1: false })).toMatchObject({ row: 3 });
    expect(decide({ p1: true, p2: true, r1: true, r2: false })).toMatchObject({ row: 4 });
    expect(decide({ p1: true, p2: true, r1: true, r2: true, r3: false })).toMatchObject({ row: 5 });
    expect(decide({ p1: true, p2: true, r1: true, r2: true, r3: true })).toMatchObject({ row: 6 });
    expect(DECISION_TABLE).toHaveLength(6);
    expect(DECISION_TABLE[4]).toMatch(/^B:/);
    expect(DECISION_TABLE[5]).toMatch(/^C:/);
  });

  it("takes an earlier failing row over later ones, whatever they say", () => {
    expect(decide({ p1: false, p2: true, r1: true, r2: true, r3: true }).row).toBe(1);
    expect(decide({ p1: true, p2: false, r1: true, r2: true, r3: true }).row).toBe(2);
    expect(decide({ p1: true, p2: true, r1: false, r2: true, r3: true }).row).toBe(3);
    expect(decide({ p1: true, p2: true, r1: true, r2: false, r3: true }).row).toBe(4);
  });

  it("is pending at the first missing verdict, but a decided row needs nothing after it", () => {
    expect(decide({})).toMatchObject({ row: null, pending: "p1" });
    expect(decide({ p1: null })).toMatchObject({ row: null, pending: "p1" });
    expect(decide({ p1: true })).toMatchObject({ row: null, pending: "p2" });
    expect(decide({ p1: true, p2: true, r1: true })).toMatchObject({ row: null, pending: "r2" });
    expect(decide({ p1: true, p2: true, r1: true, r2: true })).toMatchObject({ row: null, pending: "r3" });
    expect(decide({ p1: true, p2: false })).toMatchObject({ row: 2, pending: null });
  });
});

// ---- unfinished runs -----------------------------------------------------------------------------

describe("unfinished runs", () => {
  it("classifies a run by its done.json", () => {
    expect(runStatus(null, 5)).toBe("unfinished");
    expect(runStatus({ ok: true, conservationOk: true, cycles: 5, ended: false }, 5)).toBe("finished");
    expect(runStatus({ ok: true, conservationOk: true, cycles: 3, ended: true, endedAt: 3 }, 5)).toBe("finished");
    // stopped short without ending: a resume is pending
    expect(runStatus({ ok: false, conservationOk: true, cycles: 3, ended: false }, 5)).toBe("unfinished");
    // a real violation is a result, at any cycle count
    expect(runStatus({ ok: false, conservationOk: false, cycles: 2, ended: false, error: "matter" }, 5)).toBe("violated");
    expect(runStatus({} as never, 5)).toBe("unfinished");
  });

  it("leaves an unfinished run out of P1, so a smaller unfinished k keeps the verdict open instead of losing to k = 5", () => {
    const finished = { ok: true, conservationOk: true, cycles: 5, ended: false };
    const meta = (k: number, period: number, seed: number) => ({ k, period, seed, side: 2, cycles: 5 });
    const runs: P1Run[] = [];
    for (const [i, k] of [3, 5, 8].entries()) {
      for (const [j, period] of [1000, 3000, 10000].entries()) {
        for (const s of [0, 1]) {
          const base = mkRun({ k, period, seed: 4_800_001 + 1000 * i + 100 * j + s });
          // every k = 3 run is still going: no done.json
          const run = p1RunOf(meta(k, period, base.seed), k === 3 ? null : finished, base.rows.map((r) => ({ ...r })));
          if (k === 3) expect(run).toBeNull();
          if (run) runs.push({ ...run, ponds: 4 });
        }
      }
    }
    const choice = p1Choose(p1Regimes(runs).regimes);
    expect(choice.candidate).toEqual({ k: 5, period: 1000 });
    expect(choice.primaryComplete).toBe(false);
    expect(choice.verdict).toBeNull();
    expect(choice.chosen).toBeNull();
  });

  it("still fails criterion (d) for a run whose done.json records a violation, whatever its cycle count", () => {
    const rows = mkRun().rows;
    const run = p1RunOf({ k: 3, period: 1000, seed: 4_800_001, side: 2, cycles: 5 }, { ok: false, conservationOk: false, cycles: 2, ended: false }, rows);
    expect(run).not.toBeNull();
    expect(p1Seed(run!, 75).criteria.d).toBe(false);
  });
});

// ---- assay directory screening -------------------------------------------------------------------

const BASE_JSON = { protocolSha256: "0".repeat(64), source: "ckpt", tag: "t", ref: 40, censusEvery: 100, summary: {}, wallSeconds: 1, extra: {} };

/** An assay directory as scaffold-assays writes it, for the report's screening. */
function assayDirFixture(o: {
  assay?: "competence" | "transmission" | "garden";
  flags: Parameters<typeof parseAssayLabels>[1];
  inoculum?: string;
  seed: number;
  side?: number;
  replicates?: number;
  k?: number;
  period?: number;
  rows?: number;
  dir?: string;
  insufficient?: boolean;
  /** The recorded R1 donor seed: default assaySeed(1, h, t, 0, 9); null leaves it out. */
  donorSeed?: number | null;
  /** The recorded replicate seeds, replacing seed + s. */
  seeds?: { physics: number; fragment: number }[];
  /** The success flag of row i (default 1). */
  success?: (i: number) => number;
}): AssayDir & { text: string } {
  const assay = o.assay ?? "transmission";
  const inoculum = o.inoculum ?? "fragment";
  const replicates = o.replicates ?? 2;
  const labels = parseAssayLabels(assay, o.flags);
  const json = JSON.parse(
    JSON.stringify(
      assayJson({
        ...BASE_JSON,
        assay,
        k: o.k ?? 5,
        period: o.period ?? 3000,
        side: o.side ?? 8,
        replicates,
        inoculum,
        seeds: o.seeds ?? Array.from({ length: replicates }, (_, s) => ({ physics: o.seed + s, fragment: o.seed + s })),
        labels,
        extra: { ...(o.insufficient ? { insufficient: true } : {}), ...(assay === "transmission" && o.donorSeed !== null ? { donorSeed: o.donorSeed ?? donorSeedOf(labels) } : {}) },
      }),
    ),
  ) as Record<string, unknown>;
  const n = o.rows ?? (o.insufficient ? 0 : 128);
  const planted: Planted = { reqMass: 100, retMass: 100, reqE: 200, retE: 200, landed: 9, truncated: false };
  const lines = [ASSAY_COLUMNS.join("\t"), ...Array.from({ length: n }, (_, i) => assayLine({ assay, source: "t", replicate: i >= 64 ? 1 : 0, pond: i % 64, family: assay === "transmission" ? (i % 64) % 16 : -1, inoculum, planted, endTrait: 100 + ((i * 37) % 101), success: o.success?.(i) ?? 1 }))];
  const rows = Array.from({ length: n }, (_, i) => fragRow({ assay, inoculum, replicate: i >= 64 ? 1 : 0, pond: i % 64, success: o.success?.(i) ?? 1 }));
  return { dir: o.dir ?? `d-${o.seed}`, json, labels: assayLabels(json), rows, text: lines.join("\n") + "\n" };
}
const scafR1 = (i: number, extra: Partial<Parameters<typeof assayDirFixture>[0]> = {}) => assayDirFixture({ flags: { arm: "scaf", history: String(i), time: "1" }, seed: assaySeed(1, i, 1, 0, 0), ...extra });

describe("assay directory screening", () => {
  const regime = [{ k: 5, period: 3000 }];

  it("accepts a sound directory and reports its regime", () => {
    const r = validateAssayDirs([scafR1(0), scafR1(1)], regime);
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected).toEqual([]);
    expect(r.regime).toEqual({ k: 5, period: 3000 });
  });

  it("rejects a smoke set (side 2, 8 rows, arbitrary seeds) and wrong replicates, with the reasons", () => {
    const smoke = assayDirFixture({ flags: { arm: "scaf", history: "0", time: "1" }, seed: 4_000_000, side: 2, rows: 8, dir: "smoke" });
    const three = scafR1(2, { replicates: 3, dir: "three" });
    const r = validateAssayDirs([scafR1(1), smoke, three], regime);
    expect(r.accepted.map((d) => d.dir)).toEqual(["d-" + assaySeed(1, 1, 1, 0, 0)]);
    expect(r.rejected.map((x) => x.dir)).toEqual(["smoke", "three"]);
    expect(r.rejected[0].reasons.join(" ")).toMatch(/side 2/);
    expect(r.rejected[0].reasons.join(" ")).toMatch(/8 rows/);
    expect(r.rejected[0].reasons.join(" ")).toMatch(/not an assay seed/);
    expect(r.rejected[1].reasons.join(" ")).toMatch(/replicates 3/);
  });

  it("rejects seeds that do not decode to the labels", () => {
    const wrong = scafR1(0, { seed: assaySeed(1, 3, 1, 0, 0), dir: "wrong" }); // history 0 label, history 3 seed
    expect(validateAssayDirs([wrong], regime).rejected[0].reasons.join(" ")).toMatch(/h 3, want 0/);
  });

  it("rejects a set outside the given regime, and throws on mixed regimes when none is given", () => {
    const off = scafR1(0, { k: 3, dir: "k3" });
    expect(validateAssayDirs([off, scafR1(1)], regime).rejected[0].reasons.join(" ")).toMatch(/k 3 period 3000, want k 5 period 3000/);
    expect(() => validateAssayDirs([off, scafR1(1)], null)).toThrow(/mix regimes/);
    expect(validateAssayDirs([scafR1(0), scafR1(1)], null).regime).toEqual({ k: 5, period: 3000 });
  });

  it("throws on two directories with the same label, however many there are", () => {
    const four = [0, 1, 2, 3].map((i) => scafR1(0, { dir: `dup${i}` }));
    expect(() => validateAssayDirs(four, regime)).toThrow(/same assay set/);
    // different inocula of one history and time are different sets (R2's fragment and disc)
    const frag = assayDirFixture({ assay: "garden", flags: { arm: "scaf", history: "0", time: "0" }, seed: assaySeed(2, 0, 0, 0, 0), dir: "f" });
    const disc = assayDirFixture({ assay: "garden", flags: { arm: "scaf", history: "0", time: "0" }, seed: assaySeed(2, 0, 0, 1, 0), inoculum: "disc", dir: "d" });
    // disc's fragment seed is v = 0 but assayDirFixture gives both the same seed; fix the fragment field
    (disc.json.seeds as { physics: number; fragment: number }[]).forEach((s) => (s.fragment = s.physics - 20));
    expect(validateAssayDirs([frag, disc], regime).accepted).toHaveLength(2);
  });

  it("accepts an insufficient R1 set with no rows, and checks calibration sets against the ancestor's seeds", () => {
    const ins = scafR1(4, { insufficient: true, rows: 0 });
    expect(validateAssayDirs([ins], regime).accepted).toHaveLength(1);
    const cal = assayDirFixture({ assay: "competence", flags: { arm: "ancestor", timing: "a", calibration: "1" }, seed: 4_802_011 });
    expect(validateAssayDirs([cal], regime).accepted).toHaveLength(1);
    const badCal = assayDirFixture({ assay: "competence", flags: { arm: "ancestor", timing: "a", calibration: "1" }, seed: 4_802_021, dir: "bad" });
    expect(validateAssayDirs([badCal], regime).rejected[0].reasons.join(" ")).toMatch(/needs seed 4802011/);
  });

  it("pairs the quenched calibration with the ancestor's seeds, and rejects a legacy separately seeded set as a non-decision", () => {
    const cal = (n: 1 | 2, seed: number, dir: string) => assayDirFixture({ assay: "competence", flags: { arm: "ancestor", timing: "a", calibration: String(n) as "1" | "2" }, inoculum: n === 1 ? "fragment" : "quenched", seed, dir });
    const r = validateAssayDirs([cal(1, 4_802_011, "anc"), cal(2, 4_802_011, "quench")], regime);
    expect(r.accepted.map((d) => d.dir)).toEqual(["anc", "quench"]);
    const legacy = validateAssayDirs([cal(1, 4_802_011, "anc"), cal(2, 4_802_021, "legacy")], regime);
    expect(legacy.accepted.map((d) => d.dir)).toEqual(["anc"]);
    expect(legacy.rejected).toEqual([{ dir: "legacy", reasons: [expect.stringMatching(/legacy separately seeded quenched control.*not a decision input/)] }]);
  });

  it("keeps the regime in a calibration set's identity, and still rejects a true duplicate within a regime", () => {
    const cal = (n: 1 | 2, k: number, period: number, dir: string) => assayDirFixture({ assay: "competence", flags: { arm: "ancestor", timing: "a", calibration: String(n) as "1" | "2" }, inoculum: n === 1 ? "fragment" : "quenched", seed: 4_802_011, k, period, dir });
    const regimes = [{ k: 3, period: 3000 }, { k: 5, period: 1000 }];
    // two regimes, each with both calibrations, are four distinct sets
    const four = [cal(1, 3, 3000, "a1"), cal(2, 3, 3000, "a2"), cal(1, 5, 1000, "b1"), cal(2, 5, 1000, "b2")];
    expect(validateAssayDirs(four, regimes).accepted).toHaveLength(4);
    expect(() => validateAssayDirs([...four, cal(2, 5, 1000, "b2-again")], regimes)).toThrow(/same assay set/);
    // other sets still ignore the regime in their identity: a duplicate R1 set at another regime is caught by the regime check
    expect(() => validateAssayDirs([scafR1(0, { dir: "x" }), scafR1(0, { dir: "y" })], [{ k: 5, period: 3000 }])).toThrow(/same assay set/);
  });

  it("validates every replicate's seeds and R1's donor seed, not only replicate 0", () => {
    const regime1 = [{ k: 5, period: 3000 }];
    const s0 = assaySeed(1, 2, 1, 0, 0);
    const ok = scafR1(2);
    // replicate 1 carries history 3's seed
    const bad1 = scafR1(2, { dir: "bad1", seeds: [{ physics: s0, fragment: s0 }, { physics: assaySeed(1, 3, 1, 0, 1), fragment: s0 + 1 }] });
    // replicate 1 repeats replicate 0's seed
    const again = scafR1(2, { dir: "again", seeds: [{ physics: s0, fragment: s0 }, { physics: s0, fragment: s0 + 1 }] });
    const few = scafR1(2, { dir: "few", seeds: [{ physics: s0, fragment: s0 }] });
    const r = validateAssayDirs([ok, bad1, again, few], regime1);
    expect(r.accepted.map((d) => d.dir)).toEqual([ok.dir]);
    expect(r.rejected.find((x) => x.dir === "bad1")!.reasons.join(" ")).toMatch(/h 3, want 2/);
    expect(r.rejected.find((x) => x.dir === "again")!.reasons.join(" ")).toMatch(/s 0, want 1/);
    expect(r.rejected.find((x) => x.dir === "few")!.reasons.join(" ")).toMatch(/1 seeds, want 2/);
    // the donor seed must be assaySeed(1, h, t, 0, 9) of the labelled history and time
    const wrong = (i: number, donorSeed: number | null, dir: string) => scafR1(i, { dir, donorSeed });
    const d = validateAssayDirs([wrong(0, assaySeed(1, 1, 1, 0, 9), "other-history"), wrong(1, assaySeed(1, 1, 1, 0, 8), "perm-stream"), wrong(2, assaySeed(1, 2, 0, 0, 9), "other-time"), wrong(3, null, "missing"), wrong(4, assaySeed(1, 4, 1, 0, 9), "right")], regime1);
    expect(d.accepted.map((x) => x.dir)).toEqual(["right"]);
    expect(d.rejected.map((x) => x.dir)).toEqual(["other-history", "perm-stream", "other-time", "missing"]);
    expect(d.rejected[0].reasons.join(" ")).toMatch(/donor seed .* want assaySeed\(1, h, t, 0, 9\)/);
    expect(d.rejected[3].reasons.join(" ")).toMatch(/no donorSeed/);
  });
});

// ---- the CLI end to end (a real `deno run`, over fixture directories) ------------------------------

const REPORT = fileURLToPath(new URL("../scaffold-report.ts", import.meta.url));
const report = (...args: string[]): Record<string, any> => JSON.parse(execFileSync("deno", ["run", "-A", REPORT, ...args], { stdio: "pipe", encoding: "utf8" }));

function writeAssayDir(root: string, name: string, d: ReturnType<typeof assayDirFixture>) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "assay.json"), JSON.stringify(d.json));
  writeFileSync(join(dir, "assay.tsv"), d.text);
}

type RunRow = { cycle: number; recipient: number; trait: number; ret?: number; donor?: number; truncated?: number };

function writeRunDir(root: string, name: string, meta: Record<string, unknown>, rows: RunRow[], done: Record<string, unknown> | null, lineages?: [number, number, number, number][]) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta));
  writeFileSync(join(dir, "ponds.tsv"), ["cycle\trecipient\tdonor\tretMass\trecipientTrait\ttruncated", ...rows.map((r) => `${r.cycle}\t${r.recipient}\t${r.donor ?? -1}\t${r.ret ?? 5}\t${r.trait}\t${r.truncated ?? 0}`)].join("\n") + "\n");
  if (lineages) writeFileSync(join(dir, "lineages.tsv"), ["boundary\tstep\tpond\thi\tlo\tmass", ...lineages.map(([b, pond, lo, mass]) => `${b}\t${b * 1000}\t${pond}\t0\t${lo}\t${mass}`)].join("\n") + "\n");
  if (done) writeFileSync(join(dir, "done.json"), JSON.stringify(done));
}

describe("scaffold-report CLI", () => {
  const scratch = () => mkdtempSync(join(tmpdir(), "scaffold-report-"));
  const finished = (cycles: number) => ({ ok: true, conservationOk: true, cycles, ended: false, wallSeconds: 1 });

  /** A P1 run as tools/scaffold.ts writes it: the ancestor clone under rand with mutation on, 16 ponds (side 4). */
  const p1Meta = (k: number, period: number, seed: number, over: Record<string, unknown> = {}) => ({ tool: "scaffold", arm: "rand", init: "clone", mutRate: 429_497, k, period, seed, side: 4, cycles: 5, ...over });
  const p1Rows = (k: number, period: number, cycles = 5) =>
    mkRun({ k, period, cycles, ponds: 16, trait: (b, r) => defaultTrait(b, r % 4) }).rows.map((r) => ({ cycle: r.cycle, recipient: r.recipient, trait: r.recipientTrait, ret: r.retMass }));

  it("p1: unfinished k = 3 runs do not let k = 5 win; the verdict stays null and they are listed", () => {
    const root = scratch();
    const cycles = 5;
    let n = 0;
    for (const [i, k] of [3, 5, 8].entries()) {
      for (const [j, period] of [1000, 3000, 10000].entries()) {
        for (const s of [0, 1]) {
          writeRunDir(root, `r${n++}`, p1Meta(k, period, 4_800_001 + 1000 * i + 100 * j + s), p1Rows(k, period), k === 3 ? null : finished(cycles));
        }
      }
    }
    const out = report("p1", "--runs", root);
    expect(out.skipped).toEqual([]);
    expect(out.unfinished).toHaveLength(6);
    expect(out.runs).toBe(12);
    expect(out.verdict).toBeNull();
    expect(out.choice.candidate).toEqual({ k: 5, period: 1000 });
    // finishing them lets k = 3 win
    for (let m = 0; m < 6; m++) writeFileSync(join(root, `r${m}`, "done.json"), JSON.stringify(finished(cycles)));
    const done = report("p1", "--runs", root);
    expect(done.unfinished).toEqual([]);
    expect(done.verdict).toBe(true);
    expect(done.choice.chosen).toEqual({ k: 3, period: 1000 });
  });

  it("p1: lists runs that are not P1 (arm, init, mutation, side) with their reasons and never pools them", () => {
    const root = scratch();
    const good = (name: string, seed: number, over: Record<string, unknown> = {}) => writeRunDir(root, name, p1Meta(3, 1000, seed, over), p1Rows(3, 1000), finished(5));
    good("good0", 4_800_001);
    good("good1", 4_800_002);
    good("scaf", 4_800_003, { arm: "scaf" });
    good("cont", 4_800_004, { arm: "cont" });
    good("founders", 4_800_005, { init: "founders" });
    good("mutoff", 4_800_006, { mutRate: 0 });
    good("side8", 4_800_007, { side: 8 });
    good("side2", 4_800_008, { side: 2 });
    const out = report("p1", "--runs", root);
    expect(out.runs).toBe(2);
    expect(Object.fromEntries(out.skipped.map((x: { dir: string; why: string }) => [x.dir.replace(/^.*\//, ""), x.why]))).toEqual({
      scaf: "arm scaf",
      cont: "arm cont",
      founders: "init founders",
      mutoff: "mutation off",
      side8: "side 8",
      side2: "side 2",
    });
    expect(out.regimes).toHaveLength(1);
    expect(out.regimes[0].seeds.map((x: { seed: number }) => x.seed)).toEqual([4_800_001, 4_800_002]);
    // --allow-any-seed admits other sides (smoke runs) but not another arm
    const smoke = report("p1", "--runs", root, "--allow-any-seed");
    expect(smoke.runs).toBe(4);
    expect(smoke.skipped.map((x: { why: string }) => x.why).sort()).toEqual(["arm cont", "arm scaf", "init founders", "mutation off"]);
  });

  it("p1: two runs with one k/period/seed are an error, not a pooled duplicate", () => {
    const root = scratch();
    writeRunDir(root, "a", p1Meta(3, 1000, 4_800_001), p1Rows(3, 1000), finished(5));
    writeRunDir(root, "b", p1Meta(3, 1000, 4_800_001), p1Rows(3, 1000), finished(5));
    expect(() => report("p1", "--runs", root)).toThrow(/share k\/period\/seed 3\/1000\/4800001/);
    // the same seed at another regime is a different run
    const ok = scratch();
    writeRunDir(ok, "a", p1Meta(3, 1000, 4_800_001), p1Rows(3, 1000), finished(5));
    writeRunDir(ok, "b", p1Meta(3, 3000, 4_800_001), p1Rows(3, 3000), finished(5));
    expect(report("p1", "--runs", ok).runs).toBe(2);
  });

  // ---- P2 fixtures: 64 ponds (side 8), 12 founders round-robin, regime k 8 period 10000
  const P = 64;
  const P2_REGIME = ["--regime", "8", "10000"];
  const founderOf = (t: number) => t % 12;
  const planting = Array.from({ length: P }, (_, t) => founderOf(t));
  const p2Meta = (over: Record<string, unknown>) => ({ tool: "scaffold", init: "founders", mutRate: 0, side: 8, period: 10000, plantingToFounder: planting, ...over });
  const rankMeta = (s: number, over: Record<string, unknown> = {}) => p2Meta({ arm: "cont", k: 0, cycles: 1, seed: 4_805_001 + s, ...over });
  const selMeta = (arm: 0 | 1, s: number, over: Record<string, unknown> = {}) => p2Meta({ arm: arm === 0 ? "scaf" : "rand", k: 8, cycles: 20, seed: 4_805_101 + 10 * arm + s, ...over });
  const rankRows = Array.from({ length: P }, (_, pond) => ({ cycle: 1, recipient: pond, trait: founderOf(pond) < 6 ? 100 : 10 }));
  /** scaf ends with only the high founders (founders 0-5), rand keeps the initial mix; scaf's last-boundary traits are doubled. */
  const writeSel = (root: string, name: string, meta: Record<string, unknown>, scaf: boolean, done: object | null, cycles = 20) => {
    const rows = Array.from({ length: cycles }, (_, b) => b + 1).flatMap((b) => Array.from({ length: P }, (_, pond) => ({ cycle: b, recipient: pond, trait: scaf && b === cycles ? 80 : 40 })));
    const lin: [number, number, number, number][] = [];
    for (const b of [1, cycles]) for (let pond = 0; pond < P; pond++) if (!scaf || b === 1 || founderOf(pond) < 6) lin.push([b, pond, pond + 1, 40]);
    writeRunDir(root, name, meta, rows, done, lin);
  };

  it("p2: an unfinished selection or ranking run keeps the verdict null instead of scoring 0", () => {
    const root = scratch();
    for (const s of [0, 1]) writeRunDir(root, `rank${s}`, rankMeta(s), rankRows, finished(1));
    for (const s of [0, 1]) writeSel(root, `rand${s}`, selMeta(1, s), false, finished(20));
    writeSel(root, "scaf0", selMeta(0, 0), true, finished(20));
    writeSel(root, "scaf1", selMeta(0, 1), true, null); // scaf s = 1 is still running
    const args = ["p2", "--rank", join(root, "rank0"), join(root, "rank1"), "--scaf", join(root, "scaf0"), join(root, "scaf1"), "--rand", join(root, "rand0"), join(root, "rand1"), ...P2_REGIME];
    const open = report(...args);
    expect(open.verdict).toBeNull();
    expect(open.seeds.map((x: { present: boolean }) => x.present)).toEqual([true, false]);
    expect(open.notRead).toHaveLength(1);
    expect(open.skipped).toEqual([]);
    writeSel(root, "scaf1", selMeta(0, 1), true, finished(20));
    const closed = report(...args);
    expect(closed.notRead).toEqual([]);
    expect(closed.verdict).toBe(true);
    expect(closed.seeds[0].deltaScafExact).toMatch(/^\d+\/\d+$/);
    // an unfinished ranking run leaves too few ranking seeds
    execFileSync("rm", [join(root, "rank1", "done.json")]);
    const noRank = report(...args);
    expect(noRank.verdict).toBeNull();
    expect(noRank.reason).toMatch(/2 finished seeds/);
    // the regime can come from a calibrate or p1 output instead of --regime
    const p1Json = join(root, "calibrated.json");
    writeFileSync(p1Json, JSON.stringify({ stage: "calibrate", verdict: true, chosen: { k: 8, period: 10000 } }));
    execFileSync("rm", [join(root, "rank1", "meta.json")]);
    writeRunDir(root, "rank1", rankMeta(1), rankRows, finished(1));
    expect(report(...args.slice(0, -3), "--p1", p1Json).verdict).toBe(true);
    writeFileSync(p1Json, JSON.stringify({ stage: "p1", verdict: true, choice: { chosen: { k: 3, period: 1000 } } }));
    const other = report(...args.slice(0, -3), "--p1", p1Json); // the k 3 / period 1000 regime matches none of the runs
    expect(other.verdict).toBeNull();
    expect(other.skipped).toHaveLength(2);
    expect(other.skipped[0].why).toMatch(/period 10000, want 1000/);
  });

  it("p2: pools only the protocol's runs at the frozen regime and lists the rest with reasons", () => {
    const root = scratch();
    for (const s of [0, 1]) writeRunDir(root, `rank${s}`, rankMeta(s), rankRows, finished(1));
    for (const s of [0, 1]) {
      writeSel(root, `rand${s}`, selMeta(1, s), false, finished(20));
      writeSel(root, `scaf${s}`, selMeta(0, s), true, finished(20));
    }
    // strays under the same paths: a third ranking seed, a mutating ranking run, an old 15-cycle scaf run, another regime's k, an arm in the wrong flag, a smoke side
    writeRunDir(root, "rank-s2", rankMeta(2), rankRows, finished(1));
    writeRunDir(root, "rank-mut", rankMeta(0, { mutRate: 429_497, seed: 4_805_001 }), rankRows, finished(1));
    writeSel(root, "scaf-15", selMeta(0, 0, { cycles: 15, seed: 4_805_103 }), true, finished(15), 15);
    writeSel(root, "scaf-k5", selMeta(0, 1, { k: 5 }), true, finished(20));
    writeSel(root, "scaf-is-rand", selMeta(1, 0, { seed: 4_805_101 }), false, finished(20));
    writeRunDir(root, "rank-side4", rankMeta(1, { side: 4 }), rankRows.slice(0, 16), finished(1));
    const args = ["p2", "--rank", root, "--scaf", root, "--rand", root, ...P2_REGIME];
    // the same directory can be the rank, scaf and rand path: each role keeps only its own runs
    const out = report(...args);
    expect(out.verdict).toBe(true);
    const why = (name: string) => out.skipped.filter((x: { dir: string }) => x.dir.endsWith(`/${name}`)).map((x: { why: string }) => x.why).join(" | ");
    expect(why("rank-s2")).toMatch(/seed 4805003, want 4805001/);
    expect(why("rank-mut")).toMatch(/mutRate 429497, want 0/);
    expect(why("scaf-15")).toMatch(/cycles 15, want 20/);
    expect(why("scaf-15")).toMatch(/seed 4805103/);
    expect(why("scaf-k5")).toMatch(/k 5, want 8/);
    expect(why("scaf-is-rand")).toMatch(/arm "rand", want "scaf"/);
    expect(why("rank-side4")).toMatch(/side 4, want 8/);
    // none of them was pooled: the high set is the clean ranking's, and only s = 0, 1 of each arm were scored
    expect(out.highSet).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.seeds.map((x: { s: number; present: boolean }) => [x.s, x.present])).toEqual([[0, true], [1, true]]);
    // two valid runs with one seed are an error
    writeSel(root, "scaf0-again", selMeta(0, 0), true, finished(20));
    expect(() => report(...args)).toThrow(/two scaf runs share seed 4805101/);
    // a missing regime is refused
    expect(() => report("p2", "--rank", root, "--scaf", root, "--rand", root)).toThrow(/frozen regime/);
  });

  it("p2: a selection run with no rows at boundary 20 is skipped unless its history ended", () => {
    const root = scratch();
    for (const s of [0, 1]) writeRunDir(root, `rank${s}`, rankMeta(s), rankRows, finished(1));
    for (const s of [0, 1]) writeSel(root, `rand${s}`, selMeta(1, s), false, finished(20));
    writeSel(root, "scaf0", selMeta(0, 0), true, finished(20));
    // scaf s = 1 claims 20 cycles but stopped at 12 without ending: a truncated table is not scored
    writeSel(root, "scaf1", selMeta(0, 1), true, finished(20), 12);
    const args = ["p2", "--rank", join(root, "rank0"), join(root, "rank1"), "--scaf", join(root, "scaf0"), join(root, "scaf1"), "--rand", join(root, "rand0"), join(root, "rand1"), ...P2_REGIME];
    const out = report(...args);
    expect(out.skipped.map((x: { why: string }) => x.why).join(" ")).toMatch(/boundary 20 has 0 ponds, want 64/);
    expect(out.seeds[1].present).toBe(false);
    expect(out.verdict).toBeNull();
    // an ended history has no boundary-20 rows and counts as share 0, a failed seed
    writeSel(root, "scaf1", selMeta(0, 1), true, { ok: true, conservationOk: true, cycles: 12, ended: true, endedAt: 12 }, 12);
    const ended = report(...args);
    expect(ended.seeds[1]).toMatchObject({ present: true, pass: false });
    expect(ended.verdict).toBe(false);
  });

  it("r1: drops a smoke set with the reasons and throws on duplicate labels", () => {
    const root = scratch();
    for (const i of [0, 1, 2]) writeAssayDir(root, `h${i}`, scafR1(i));
    writeAssayDir(root, "smoke", assayDirFixture({ flags: { arm: "scaf", history: "3", time: "1" }, seed: 4_000_000, side: 2, rows: 8 }));
    const out = report("r1", "--assays", root, "--regime", "5", "3000");
    expect(out.histories).toHaveLength(3);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].reasons.join(" ")).toMatch(/side 2/);
    expect(out.regime).toEqual({ k: 5, period: 3000 });
    // a set at another regime is dropped too
    writeAssayDir(root, "k3", scafR1(4, { k: 3 }));
    expect(report("r1", "--assays", root, "--regime", "5", "3000").rejected).toHaveLength(2);
    // four copies of one history: refused, not counted four times
    const dup = scratch();
    for (const i of [0, 1, 2, 3]) writeAssayDir(dup, `c${i}`, scafR1(0));
    expect(() => report("r1", "--assays", dup, "--regime", "5", "3000")).toThrow(/same assay set/);
  });

  it("calibrate: reads several regimes together, pairs the two calibrations by regime, and rejects the legacy quenched set", () => {
    const root = scratch();
    const cal = (n: 1 | 2, k: number, period: number, dir: string, frac: number, seed = 4_802_011) =>
      writeAssayDir(root, dir, assayDirFixture({ assay: "competence", flags: { arm: "ancestor", timing: "a", calibration: String(n) as "1" | "2" }, inoculum: n === 1 ? "fragment" : "quenched", seed, k, period, dir, success: (i) => (i < Math.round(frac * 128) ? 1 : 0) }));
    cal(1, 3, 3000, "anc-k3", 0.1); // k 3 fails the ancestor band
    cal(2, 3, 3000, "que-k3", 0);
    cal(1, 5, 1000, "anc-k5", 0.5);
    cal(2, 5, 1000, "que-k5", 0);
    cal(2, 5, 1000, "que-k5-legacy", 0, 4_802_021); // separately seeded: not a decision input
    const choice = { stage: "primary", chosen: { k: 3, period: 3000 }, candidate: { k: 3, period: 3000 }, primaryComplete: true, fallbackComplete: false, verdict: true, passing: [{ k: 3, period: 3000 }, { k: 5, period: 1000 }] };
    const p1Json = join(root, "p1.json");
    writeFileSync(p1Json, JSON.stringify({ stage: "p1", verdict: true, choice }));
    const out = report("calibrate", "--p1", p1Json, "--assays", root);
    expect(out).toMatchObject({ verdict: true, chosen: { k: 5, period: 1000 } });
    expect(out.regimes.map((x: { k: number; ancestor: number; quenched: number; paired: boolean; pass: boolean }) => [x.k, x.ancestor, x.quenched, x.paired, x.pass])).toEqual([[3, 0.1015625, 0, true, false], [5, 0.5, 0, true, true]]);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].dir).toMatch(/que-k5-legacy$/);
    expect(out.rejected[0].reasons.join(" ")).toMatch(/legacy separately seeded quenched control/);
    // two quenched sets of one regime (both validly seeded) are a duplicate
    cal(2, 5, 1000, "que-k5-again", 0);
    expect(() => report("calibrate", "--p1", p1Json, "--assays", root)).toThrow(/same assay set/);
  });

  it("r1: --runs flags a history with over 1% truncated evolution rows, stays pending until every history is loaded, and reports donor repeatability descriptively", () => {
    const period = 100_000; // C = ceil(10^6 / period) = 10 cycles keeps the fixtures small
    const cycles = 10;
    const assays = scratch();
    for (const i of [0, 1, 2, 3, 4, 5]) writeAssayDir(assays, `h${i}`, assayDirFixture({ flags: { arm: "scaf", history: String(i), time: "1" }, seed: assaySeed(1, i, 1, 0, 0), k: 5, period, dir: `s${i}` }));
    const runs = scratch();
    const run = (arm: "scaf" | "rand", i: number, truncatedPerCycle = 0, done: object | null = finished(cycles)) => {
      const rows: RunRow[] = [];
      for (let cycle = 1; cycle <= cycles; cycle++)
        for (let r = 0; r < 64; r++) rows.push({ cycle, recipient: r, donor: r % 16, ret: 10 + ((r * 7 + cycle) % 13), trait: 1000 * (r % 16) + ((r * 31 + cycle) % 17), truncated: r < truncatedPerCycle ? 1 : 0 });
      writeRunDir(runs, `${arm}${i}`, { tool: "scaffold", arm, init: "clone", mutRate: 429_497, side: 8, k: 5, period, cycles, seed: 4_810_001 + (arm === "scaf" ? 0 : 100) + i }, rows, done);
    };
    const args = ["r1", "--assays", assays, "--regime", "5", String(period)];
    // three of the twelve histories, one flagged (2 of 64 truncated per cycle is 3.1%), one still running, one not a main run
    run("scaf", 0);
    run("scaf", 3, 2);
    run("rand", 1);
    run("scaf", 4, 0, null);
    writeRunDir(runs, "stray", { tool: "scaffold", arm: "rand", init: "clone", mutRate: 429_497, side: 4, k: 3, period: 1000, cycles: 15, seed: 4_800_001 }, [], finished(15));
    const part = report(...args, "--runs", runs);
    expect(part.evolution.loaded).toBe(true);
    expect(part.evolution.histories.map((h: { arm: string; history: number; flagged: boolean }) => [h.arm, h.history, h.flagged])).toEqual([["rand", 1, false], ["scaf", 0, false], ["scaf", 3, true]]);
    expect(part.evolution.notRead).toHaveLength(1);
    expect(part.evolution.skipped).toHaveLength(1);
    expect(part.evolution.skipped[0].why).toMatch(/side 4/);
    // nine of the twelve (arm, history) identities have no loaded run: the sensitivity is pending, and says which
    expect(part.truncation).toMatchObject({ evolutionKnown: false, without: null, sensitive: null });
    expect(part.truncation.evolutionMissing.map((m: { arm: string; history: number }) => `${m.arm}-${m.history}`)).toEqual(["scaf-1", "scaf-2", "scaf-4", "scaf-5", "rand-0", "rand-2", "rand-3", "rand-4", "rand-5"]);
    expect(part.truncation.evolutionFlagged.map((h: { arm: string; history: number }) => [h.arm, h.history])).toEqual([["scaf", 3]]);
    // the repeatability is descriptive: every cycle with a next boundary (1-9), and no verdict reads it
    const rep = part.descriptive.donorRepeatability;
    expect(rep.map((h: { arm: string; history: number }) => [h.arm, h.history])).toEqual([["rand", 1], ["scaf", 0], ["scaf", 3]]);
    expect(rep[0].perCycle.map((c: { cycle: number }) => c.cycle)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rep[0].all.cycles).toBe(9);
    expect(rep[0].lastHalf.cycles).toBe(4); // b = 6..9
    expect(rep[0].all.mean).toBeGreaterThan(0.9); // donors set the next trait here
    expect(part.descriptive.note).toMatch(/no verdict reads it/);
    // without --runs nothing is loaded and the sensitivity is pending
    const none = report(...args);
    expect(none.evolution).toEqual({ loaded: false });
    expect(none.truncation).toMatchObject({ evolutionKnown: false, without: null, sensitive: null });
    expect(none.truncation.evolutionMissing).toHaveLength(12);
    expect(none.descriptive.donorRepeatability).toBeNull();
    expect(none.verdict).toBe(part.verdict);
    // every history loaded: known, and the flagged one is left out of the sensitivity
    for (const i of [1, 2, 4, 5]) run("scaf", i);
    for (const i of [0, 2, 3, 4, 5]) run("rand", i);
    const full = report(...args, "--runs", runs);
    expect(full.truncation).toMatchObject({ evolutionKnown: true, evolutionMissing: [] });
    expect(full.truncation.evolutionFlagged.map((h: { arm: string; history: number }) => [h.arm, h.history])).toEqual([["scaf", 3]]);
    expect(typeof full.truncation.sensitive).toBe("boolean");
    expect(full.verdict).toBe(part.verdict);
  });

  it("r4: reads the capability assay.json that scaffold-assays writes, by --assays and by --in", () => {
    const root = scratch();
    const json = {
      tool: "scaffold-assays",
      assay: "capability",
      seed: 4_824_001,
      capability: [
        { arm: "scaf", history: 0, tag: "s0", source: "a", dominant: "0:5", evaluated: true, reps: 8, regenerated: 6, recovery: 0.9, quality: 0.5 },
        { arm: "ancestor", tag: "anc", source: "c", dominant: "0:2", evaluated: true, reps: 8, regenerated: 8, recovery: 1, quality: 0.9 },
      ],
    };
    mkdirSync(join(root, "cap"), { recursive: true });
    writeFileSync(join(root, "cap", "assay.json"), JSON.stringify(json));
    const byDir = report("r4", "--assays", root);
    expect(Object.keys(byDir.arms).sort()).toEqual(["ancestor", "scaf"]);
    expect(byDir.arms.scaf.measures.quality.mean).toBe(0.5);
    const byFile = report("r4", "--in", join(root, "cap", "assay.json"));
    expect(byFile.arms.ancestor.measures.regenerated.mean).toBe(8);
  });
});

// ---- Amendment 2: the tau calibration and R1' ------------------------------------------------------

describe("one-way ANOVA", () => {
  it("gives the mean squares, n0 and the family means, and icc1 is built on it", () => {
    const y = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const fam = [0, 0, 0, 1, 1, 1, 2, 2, 2];
    const an = oneWayAnova(y, fam)!;
    expect(an).toEqual({ a: 3, N: 9, means: [2, 5, 8], msb: 27, msw: 1, n0: 3 });
    expect((an.msb - an.msw) / an.n0).toBeCloseTo(26 / 3, 12);
    expect(icc1(y, fam)).toBe((27 - 1) / (27 + 2 * 1));
    // a negative between-family component is kept as it is
    const flat = oneWayAnova([1, 3, 1, 3, 1, 3], [0, 0, 1, 1, 2, 2])!;
    expect((flat.msb - flat.msw) / flat.n0).toBe(-1);
    expect(oneWayAnova([1, 2, 3], [0, 0, 0])).toBeNull();
    expect(oneWayAnova([1, 2], [0, 1])).toBeNull();
  });
});

describe("traits.tsv reader", () => {
  const text = traitsTable([
    { replicate: 0, steps: [100, 200], traits: [[10, 20], [11, 21]] },
    { replicate: 1, steps: [100, 200], traits: [[30, 40], [31, 41]] },
  ]);

  it("streams the writer's output, counting every step and keeping the steps asked for", async () => {
    const all = await readTraits(tsvRows(text.split("\n")));
    expect([...all.counts]).toEqual([[100, 4], [200, 4]]);
    expect(all.rows.get(200)!.map((r) => [r.replicate, r.pond, r.trait])).toEqual([[0, 0, 11], [0, 1, 21], [1, 0, 31], [1, 1, 41]]);
    const some = await readTraits(tsvRows(text.split("\n")), new Set([200]));
    expect([...some.counts]).toEqual([[100, 4], [200, 4]]);
    expect([...some.rows.keys()]).toEqual([200]);
    const none = await readTraits(tsvRows(text.split("\n")), new Set());
    expect(none.rows.size).toBe(0);
    expect(none.counts.size).toBe(2);
  });

  it("counts the rows that repeat a (replicate, pond) of their step or lie outside the grid, when given one", async () => {
    const grid = { replicates: 2, ponds: 2 };
    expect([...(await readTraits(tsvRows(text.split("\n")), undefined, grid)).invalid]).toEqual([]);
    const lines = text.trimEnd().split("\n");
    // a repeated row (replacing another one) at step 200, and a pond outside the grid at step 100
    const bad = lines.map((l) => (l === "0\t1\t200\t21" ? "0\t0\t200\t11" : l === "1\t1\t100\t40" ? "1\t2\t100\t40" : l));
    const read = await readTraits(tsvRows(bad), undefined, grid);
    expect([...read.invalid].sort(([x], [y]) => x - y)).toEqual([[100, 1], [200, 1]]);
    expect([...read.counts]).toEqual([[100, 4], [200, 4]]);
    expect(gridOfJson({ side: 8, replicates: 2 })).toEqual({ replicates: 2, ponds: 64 });
    expect(gridOfJson({ side: 8 })).toBeNull();
    expect(gridOfJson({ side: 0, replicates: 2 })).toBeNull();
  });

  it("reads a file from disk and refuses a malformed value", async () => {
    const dir = mkdtempSync(join(tmpdir(), "traits-"));
    writeFileSync(join(dir, "traits.tsv"), text);
    expect((await readTraits(readTsv(join(dir, "traits.tsv")))).counts.get(100)).toBe(4);
    await expect(readTraits(tsvRows(["replicate\tpond\tstep\ttrait", "0\t0\t100\tx"]))).rejects.toThrow(/not a number/);
  });
});

describe("tau rule", () => {
  const medians = (m: Record<number, number>) => new Map(Object.entries(m).map(([step, v]) => [Number(step), [v - 1, v, v + 1]] as [number, number[]]));

  it("is the first census step at which the median trait reaches 0.25 ref, whatever order the steps arrive in", () => {
    const r = tauRule(new Map([[300, [20, 20, 20]], [100, [5, 5, 5]], [200, [12, 12, 12]]]), 40);
    expect(r).toMatchObject({ tau: 200, crossed: true, threshold: 10, medianAtTau: 12 });
    expect(r.curve).toEqual([{ step: 100, n: 3, median: 5 }, { step: 200, n: 3, median: 12 }, { step: 300, n: 3, median: 20 }]);
  });

  it("crosses at equality (>=), exactly, with the frozen ref 103,058 (0.25 ref = 25,764.5)", () => {
    const at = (m: number) => tauRule(new Map([[100, [m, m]], [200, [30_000, 30_000]]]), 103_058);
    expect(at(25_764.5).tau).toBe(100);
    expect(at(25_764).tau).toBe(200);
    expect(at(25_764).threshold).toBe(25_764.5);
    // the median of an even count is the mean of the middle two
    expect(tauRule(new Map([[100, [1, 2]]]), 6)).toMatchObject({ tau: 100, crossed: true, medianAtTau: 1.5 });
    expect(tauRule(new Map([[100, [1, 1.5]], [200, [9, 9]]]), 6).tau).toBe(200);
  });

  it("falls back to 10,000 (or the given period) when no census reaches it", () => {
    const never = new Map([[100, [1, 2, 3]], [200, [4, 5, 6]], [10_000, [9, 9, 9]]]);
    expect(tauRule(never, 103_058)).toMatchObject({ tau: 10_000, crossed: false, medianAtTau: 9 });
    const short = tauRule(new Map([[100, [1]], [300, [2]]]), 103_058);
    expect(short).toMatchObject({ tau: 10_000, crossed: false, medianAtTau: null });
    expect(tauRule(new Map([[100, [1]], [300, [2]]]), 103_058, 300)).toMatchObject({ tau: 300, crossed: false, medianAtTau: 2 });
    expect(() => tauRule(never, 0)).toThrow(/positive ref/);
  });

  it("takes the median over every fragment, not the mean", () => {
    // mean 30,000 but median 10
    const skew = new Map([[100, [10, 10, 10, 10, 10, 10, 10, 200_000]]]);
    expect(tauRule(skew, 103_058).crossed).toBe(false);
    expect(tauRule(medians({ 100: 26_000 }), 103_058).tau).toBe(100);
  });
});

// ---- fixtures: tau calibration and R1' sets as scaffold-assays --traits writes them

const PRIME_STEPS = [100, 200, 300];
const PRIME_PERIOD = 300;
const PRIME_TAU = 200;
const PRIME_REGIME = [{ k: 8, period: PRIME_PERIOD }];

const strongTau = (donor: number, u: number) => 1000 + 300 * donor + Math.floor(u * 20);
const weakTau = (_donor: number, u: number) => Math.floor(u * 1000);

interface SetFixture {
  json: Record<string, unknown>;
  rows: AssayRow[];
  assayText: string;
  traitsText: string;
  /** Per fragment (replicate 0 then 1): its trait at each of PRIME_STEPS. */
  series: number[][];
}

/** One census-series of 128 fragments (replicate 0 then 1, 64 ponds): the trait at step c of fragment j. */
function fixtureText(assay: string, rows: AssayRow[], series: number[][], insufficient: boolean, steps: readonly number[] = PRIME_STEPS): { assayText: string; traitsText: string } {
  const planted = (r: AssayRow): Planted => ({ reqMass: r.retMass, retMass: r.retMass, reqE: r.retE ?? 0, retE: r.retE ?? 0, landed: 9, truncated: false });
  const assayText =
    [ASSAY_COLUMNS.join("\t"), ...rows.map((r) => assayLine({ assay, source: "t", replicate: r.replicate, pond: r.pond, family: r.family, inoculum: "fragment", planted: planted(r), endTrait: r.endTrait, success: r.success }))].join("\n") + "\n";
  const traitsText = traitsTable(
    insufficient || rows.length === 0
      ? []
      : [0, 1].map((replicate) => ({ replicate, steps, traits: steps.map((_, c) => Array.from({ length: 64 }, (_, pond) => series[replicate * 64 + pond][c])) })),
  );
  return { assayText, traitsText };
}

/** An R1' set at t' with `tau` giving the trait at step 200 of a fragment of donor 0-15 (strong donor effect by default); the end trait (step 300) is saturated (above 80% of the budget), as in R1. */
function primeFixture(o: { arm?: "scaf" | "rand"; i: number; t?: 0 | 1 | 2; tau?: (donor: number, u: number) => number; insufficient?: boolean; json?: Record<string, unknown> }): SetFixture {
  const arm = o.arm ?? "scaf";
  const t = o.t ?? 0;
  const labels = parseR1PrimeLabels({ arm, history: String(o.i), time: String(t) });
  const seed = r1PrimeSeed(r1PrimeH(labels), t, 0);
  const json = JSON.parse(
    JSON.stringify({
      ...assayJson({
        ...BASE_JSON,
        assay: "transmission",
        k: 8,
        period: PRIME_PERIOD,
        side: 8,
        replicates: 2,
        inoculum: "fragment",
        seeds: [0, 1].map((s) => ({ physics: seed + s, fragment: seed + s })),
        labels,
        extra: { donorSeed: seed + 9, donors: [], eligible: o.insufficient ? 1 : 64, insufficient: !!o.insufficient, traitsRecorded: true },
      }),
      ...o.json,
    }),
  ) as Record<string, unknown>;
  const n = o.insufficient ? 0 : 128;
  const r = lcg(1000 + 37 * o.i + 11 * t + (arm === "rand" ? 500 : 0));
  const series: number[][] = [];
  const rows = Array.from({ length: n }, (_, j) => {
    const donor = (j % 64) % 16;
    const tauTrait = (o.tau ?? strongTau)(donor, r());
    const endTrait = 140_000 + Math.floor(r() * 3000);
    series.push([Math.floor(tauTrait / 2), tauTrait, endTrait]);
    return fragRow({ replicate: j >= 64 ? 1 : 0, pond: j % 64, family: 100 + donor, retMass: 50 + Math.floor(r() * 50), retE: 100 + Math.floor(r() * 100), endTrait, truncated: 0 });
  });
  return { json, rows, series, ...fixtureText("transmission", rows, series, !!o.insufficient) };
}

/**
 * The tau calibration set: 128 ancestor fragments whose median trait is `curve` at each census step of `period` (default 300;
 * a function of the step, or an array indexed by step / 100 - 1).
 */
function tauFixture(curve: number[] | ((step: number) => number), o: { ref?: number; period?: number; json?: Record<string, unknown> } = {}): SetFixture {
  const period = o.period ?? PRIME_PERIOD;
  const steps = censusSteps(period, 100);
  const at = typeof curve === "function" ? curve : (step: number) => curve[step / 100 - 1];
  const json = JSON.parse(
    JSON.stringify({
      ...assayJson({
        ...BASE_JSON,
        assay: "competence",
        k: 8,
        period,
        side: 8,
        replicates: 2,
        inoculum: "fragment",
        ref: o.ref ?? 40,
        seeds: [0, 1].map((s) => ({ physics: 4_849_001 + s, fragment: 4_849_001 + s })),
        labels: TAU_LABELS,
        extra: { quench: false, swap: null, traitsRecorded: true },
      }),
      ...o.json,
    }),
  ) as Record<string, unknown>;
  // j % 3 shifts by -1, 0, +1 (43, 43, 42 fragments of 128): the median is the curve value.
  const series = Array.from({ length: 128 }, (_, j) => steps.map((st) => at(st) + ((j % 3) - 1)));
  const rows = Array.from({ length: 128 }, (_, j) => fragRow({ assay: "competence", replicate: j >= 64 ? 1 : 0, pond: j % 64, endTrait: series[j][series[j].length - 1], success: 1, truncated: 0 }));
  return { json, rows, series, ...fixtureText("competence", rows, series, false, steps) };
}

const FROZEN_SOURCE = "runs/scaffold/calib/source/ckpt/b1-pre.blck.gz";

/** Amendment 2's tau calibration as the tool writes it: ref 103,058, k 8, period 10,000 (100 census steps), the ancestor source; the median reaches 0.25 ref (25,764.5) at step 2,600 by default. */
const frozenTau = (curve: number[] | ((step: number) => number) = (step) => step * 10, json: Record<string, unknown> = {}): SetFixture =>
  tauFixture(curve, { ref: 103_058, period: 10_000, json: { source: FROZEN_SOURCE, ...json } });

/** The same set cut to `ponds` ponds of one replicate (smoke-sized, side 2): the rows and traits that fit. */
function smallOf(f: SetFixture, ponds = 4): SetFixture {
  const rows = f.rows.filter((r) => r.replicate === 0 && r.pond < ponds);
  const lines = f.traitsText.trimEnd().split("\n");
  const traitsText = [lines[0], ...lines.slice(1).filter((l) => l.split("\t")[0] === "0" && Number(l.split("\t")[1]) < ponds)].join("\n") + "\n";
  const series = f.series.slice(0, ponds);
  const assay = String(f.json.assay);
  // fixtureText lays out 2 x 64 traits; only its assay.tsv is wanted here (the traits are the filtered lines above).
  return { json: { ...f.json, side: Math.sqrt(ponds), replicates: 1 }, rows, series, traitsText, assayText: fixtureText(assay, rows, series, true).assayText };
}

const dirOf = async (f: SetFixture, name = "d", withTraits = true): Promise<TraitSetDir> => ({ dir: name, json: f.json, rows: f.rows, traits: withTraits ? await readTraits(tsvRows(f.traitsText.split("\n")), undefined, gridOfJson(f.json)) : null });

describe("tau screening", () => {
  const frozen = { regimes: [{ k: 8, period: 10_000 }] };
  const why = async (f: SetFixture, o: Parameters<typeof tauScreen>[1] = { regimes: null }) => {
    const r = tauScreen([await dirOf(f)], o);
    return { accepted: r.accepted.length, reasons: r.rejected.flatMap((x) => x.reasons).join(" | ") };
  };

  it("accepts Amendment 2's calibration in strict mode and reads tau from its traits", async () => {
    const d = await dirOf(frozenTau());
    const r = tauScreen([d], frozen);
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    const byStep = new Map([...d.traits!.rows].map(([step, rows]) => [step, rows.map((t) => t.trait)]));
    expect(byStep.size).toBe(100);
    expect(byStep.get(100)).toHaveLength(128);
    expect(tauRule(byStep, d.json.ref as number, 10_000)).toMatchObject({ tau: 2600, medianAtTau: 26_000, crossed: true });
  });

  it("binds tau to the frozen calibration: ref, regime, size, ancestor source, labels, seeds and census", async () => {
    const strict = async (json: Record<string, unknown>, o: Parameters<typeof tauScreen>[1] = { regimes: null }) => why(frozenTau(undefined, json), o);
    expect((await strict({ ref: 40 })).reasons).toMatch(/ref 40, want 103058/);
    expect((await strict({ ref: 103_059 })).reasons).toMatch(/ref 103059, want 103058/);
    expect((await strict({ ref: null })).reasons).toMatch(/ref null, want a positive number.*ref null, want 103058/);
    expect((await strict({ k: 5 })).reasons).toMatch(/k 5, want 8/);
    expect((await strict({ period: 3000 })).reasons).toMatch(/period 3000, want 10000/);
    expect((await strict({ side: 2 })).reasons).toMatch(/side 2, want 8/);
    expect((await strict({ replicates: 3 })).reasons).toMatch(/replicates 3, want 2/);
    expect((await strict({ censusEvery: 50 })).reasons).toMatch(/censusEvery 50/);
    expect((await strict({ source: "runs/scaffold/calib/ancestor/b1-pre.blck.gz" })).reasons).toMatch(/source .*want a path ending in calib\/source\/ckpt\/b1-pre\.blck\.gz/);
    expect((await strict({ source: undefined })).reasons).toMatch(/want a path ending in calib/);
    expect((await strict({ source: "b1-pre.blck.gz" })).reasons).toMatch(/want a path ending in calib/);
    expect((await strict({ labels: { arm: "scaf", time: 0, timing: "a" } })).reasons).toMatch(/labels\.tauCalibration is not true.*labels\.arm "scaf", want ancestor/);
    expect((await strict({ labels: { arm: "ancestor", time: 0, timing: "a", calibration: 1 } })).reasons).toMatch(/labels\.tauCalibration is not true/);
    expect((await strict({ inoculum: "quenched" })).reasons).toMatch(/inoculum "quenched"/);
    expect((await strict({ seeds: [{ physics: 4_802_011, fragment: 4_802_011 }, { physics: 4_802_012, fragment: 4_802_012 }] })).reasons).toMatch(/needs seed 4849001/);
    expect((await strict({ seeds: [{ physics: 4_849_001, fragment: 4_849_001 }] })).reasons).toMatch(/1 seeds, want 2/);
    expect((await strict({ assay: "transmission" })).reasons).toMatch(/want competence/);
    expect((await strict({}, { regimes: [{ k: 8, period: 3000 }] })).reasons).toMatch(/period 10000, want k 8 period 3000/);
    const short = frozenTau();
    expect((await why({ ...short, rows: short.rows.slice(1) })).reasons).toMatch(/127 rows, want 128/);
    // the strict calibration itself passes
    expect(await why(frozenTau(), frozen)).toMatchObject({ accepted: 1, reasons: "" });
  });

  it("rejects a set whose traits are missing or incomplete", async () => {
    const f = frozenTau();
    const r = tauScreen([await dirOf(f, "d", false)], { regimes: null });
    expect(r.rejected[0].reasons.join(" ")).toMatch(/no traits\.tsv/);
    expect((await why({ ...f, json: { ...f.json, traitsRecorded: undefined } })).reasons).toMatch(/does not say traitsRecorded/);
    // the last census is missing
    const lines = f.traitsText.split("\n").filter((l) => !l.includes("\t10000\t"));
    expect((await why({ ...f, traitsText: lines.join("\n") })).reasons).toMatch(/99 census steps \(100\.\.9900\), want 100 \(100\.\.10000\)/);
    // a step short of rows
    const thin = f.traitsText.split("\n");
    thin.splice(5, 1);
    expect((await why({ ...f, traitsText: thin.join("\n") })).reasons).toMatch(/without 128 rows/);
  });

  it("rejects a set whose (replicate, pond) grid is not filled exactly once, in assay.tsv or at any census step", async () => {
    const f = frozenTau();
    // a row repeated in place of another: 128 rows, but a fragment is missing
    const dup = { ...f, rows: f.rows.map((r, j) => (j === 5 ? { ...r, replicate: f.rows[0].replicate, pond: f.rows[0].pond } : r)) };
    expect(await why(dup, frozen)).toMatchObject({ accepted: 0 });
    expect((await why(dup, frozen)).reasons).toBe("assay.tsv repeats a (replicate, pond) in 1 rows");
    const outside = { ...f, rows: f.rows.map((r, j) => (j === 5 ? { ...r, pond: 64 } : r)) };
    expect((await why(outside, frozen)).reasons).toMatch(/assay\.tsv has 1 rows outside the 2 x 64/);
    const other = { ...f, rows: f.rows.map((r, j) => (j === 5 ? { ...r, inoculum: "disc" } : r)) };
    expect((await why(other, frozen)).reasons).toMatch(/1 assay\.tsv rows are not fragment rows/);
    // traits.tsv: at one census step a fragment's row replaces another's
    const lines = f.traitsText.trimEnd().split("\n");
    const first = lines.findIndex((l) => l.startsWith("0\t0\t5000\t"));
    const second = lines.findIndex((l) => l.startsWith("0\t1\t5000\t"));
    const twice = lines.map((l, k) => (k === second ? lines[first] : l)).join("\n") + "\n";
    expect((await why({ ...f, traitsText: twice }, frozen)).reasons).toBe("traits.tsv has 1 census steps with a repeated or out-of-grid (replicate, pond) (step 5000: 1 rows)");
    const grown = lines.map((l, k) => (k === second ? l.replace("\t1\t5000\t", "\t64\t5000\t") : l)).join("\n") + "\n";
    expect((await why({ ...f, traitsText: grown }, frozen)).reasons).toMatch(/repeated or out-of-grid/);
    // both tables fill the grid: accepted
    expect((await why(f, frozen)).accepted).toBe(1);
  });

  it("--allow-any-seed waives the frozen binding of a smoke set and holds it to the grid it declares, and still needs the traits", async () => {
    const smoke = tauFixture([5, 12, 20], { json: { seeds: [{ physics: 1, fragment: 1 }, { physics: 2, fragment: 2 }], source: "ckpt" } });
    expect((await why(smoke)).accepted).toBe(0);
    expect((await why(smoke, { regimes: [{ k: 1, period: 1 }], allowAnySeed: true })).accepted).toBe(1);
    // a side-2, one-replicate set fills the 1 x 4 grid it declares
    const small = smallOf(tauFixture([5, 12, 20], { json: { seeds: [{ physics: 1, fragment: 1 }], source: "ckpt" } }));
    expect((await why(small, { regimes: null, allowAnySeed: true })).accepted).toBe(1);
    expect((await why(small)).accepted).toBe(0);
    // 3 rows where the declared grid has 4
    expect((await why({ ...small, rows: small.rows.slice(1) }, { regimes: null, allowAnySeed: true })).reasons).toMatch(/3 rows, want 4/);
    expect((await why({ ...smoke, json: { ...smoke.json, traitsRecorded: undefined } }, { regimes: null, allowAnySeed: true })).accepted).toBe(0);
    expect((await why({ ...smoke, rows: smoke.rows.slice(0, 127) }, { regimes: null, allowAnySeed: true })).accepted).toBe(0);
    expect((await why({ ...smoke, json: { ...smoke.json, labels: { arm: "ancestor", time: 0, timing: "a" } } }, { regimes: null, allowAnySeed: true })).reasons).toMatch(/labels\.tauCalibration is not true/);
  });
});

describe("tau.json as r1prime's input", () => {
  const good = () => ({
    stage: "tau",
    validated: true,
    tau: 2600,
    provenance: { source: FROZEN_SOURCE, ref: 103_058, k: 8, period: 10_000, side: 8, replicates: 2, seeds: [{ physics: 4_849_001, fragment: 4_849_001 }, { physics: 4_849_002, fragment: 4_849_002 }], labels: { arm: "ancestor", time: 0, timing: "a", tauCalibration: true } },
  });

  it("accepts validated strict calibration output", () => {
    expect(tauJsonProblems(good())).toEqual([]);
    expect(tauJsonProblems({ ...good(), tau: 10_000 })).toEqual([]);
  });

  it("refuses everything else: unvalidated, a smoke run, a wrong provenance or a tau that is not a census step", () => {
    const why = (o: Record<string, unknown>) => tauJsonProblems({ ...good(), ...o }).join(" | ");
    expect(why({ validated: false })).toMatch(/not validated strict calibration output/);
    expect(why({ validated: undefined })).toMatch(/not validated/);
    expect(why({ stage: "r1prime" })).toMatch(/stage "r1prime", want tau/);
    expect(why({ tau: null })).toMatch(/tau null, want a positive integer/);
    expect(why({ tau: 250 })).toMatch(/tau 250 is not a census step/);
    expect(why({ tau: 10_100 })).toMatch(/tau 10100 is not a census step/);
    expect(why({ provenance: undefined })).toMatch(/no provenance/);
    expect(why({ provenance: { ...good().provenance, ref: 40 } })).toMatch(/provenance\.ref 40, want 103058/);
    expect(why({ provenance: { ...good().provenance, period: 300 } })).toMatch(/provenance\.period 300, want 10000/);
    expect(why({ provenance: { ...good().provenance, source: "elsewhere/b1-pre.blck.gz" } })).toMatch(/provenance\.source/);
    expect(why({ provenance: { ...good().provenance, seeds: [{ physics: 1, fragment: 1 }] } })).toMatch(/provenance\.seeds/);
    expect(why({ provenance: { ...good().provenance, labels: {} } })).toMatch(/provenance\.labels\.tauCalibration/);
  });
});

describe("R1' screening", () => {
  const screen = async (f: SetFixture, o: Partial<Parameters<typeof r1PrimeScreen>[1]> = {}, withTraits = true) => {
    const r = r1PrimeScreen([await dirOf(f, "d", withTraits)], { tau: PRIME_TAU, regimes: PRIME_REGIME, ...o });
    return { ...r, reasons: r.rejected.flatMap((x) => x.reasons).join(" | ") };
  };

  it("accepts a sound set and carries each fragment's trait at tau and at the end of the period", async () => {
    const f = primeFixture({ i: 2, t: 1 });
    const r = await screen(f);
    expect(r.rejected).toEqual([]);
    expect(r.regime).toEqual({ k: 8, period: PRIME_PERIOD });
    expect(r.accepted).toHaveLength(1);
    const set = r.accepted[0];
    expect(set).toMatchObject({ arm: "scaf", history: 2, tPrime: 1, insufficient: false });
    expect(set.fragments).toHaveLength(128);
    // fragments are in R1's order, replicate 0's f = 0..63 then replicate 1's
    set.fragments.forEach((fr, j) => {
      expect(fr).toMatchObject({ family: f.rows[j].family, retMass: f.rows[j].retMass, retE: f.rows[j].retE, endTrait: f.series[j][2], tauTrait: f.series[j][1], truncated: false });
    });
  });

  it("takes the trait at whichever census step tau names", async () => {
    const f = primeFixture({ i: 0 });
    expect((await screen(f, { tau: 100 })).accepted[0].fragments[5].tauTrait).toBe(f.series[5][0]);
    expect((await screen(f, { tau: 300 })).accepted[0].fragments[5].tauTrait).toBe(f.series[5][2]);
    expect((await screen(f, { tau: 250 })).reasons).toMatch(/tau 250 is not a census step/);
  });

  it("accepts an insufficient set (no fragments, no traits) as a valid one", async () => {
    const r = await screen(primeFixture({ i: 3, insufficient: true }));
    expect(r.rejected).toEqual([]);
    expect(r.accepted[0]).toMatchObject({ arm: "scaf", history: 3, tPrime: 0, insufficient: true, fragments: [] });
  });

  it("rejects wrong seeds, donor seed, size, regime and labels, with the reasons", async () => {
    const base = primeFixture({ i: 1, t: 2 });
    const seed = r1PrimeSeed(1, 2, 0);
    expect((await screen(primeFixture({ i: 1, t: 2, json: { seeds: [{ physics: seed, fragment: seed }, { physics: seed, fragment: seed + 1 }] } }))).reasons).toMatch(/does not match the R1' labels.*r1PrimeSeed\(h, t', 1\) = /);
    expect((await screen(primeFixture({ i: 1, t: 2, json: { seeds: [{ physics: 4_820_001 + 5000 + 250 + 100, fragment: seed }, { physics: seed + 1, fragment: seed + 1 }] } }))).reasons).toMatch(/seed 4825351/);
    expect((await screen(primeFixture({ i: 1, t: 2, json: { donorSeed: seed + 8 } }))).reasons).toMatch(/donor seed .* want r1PrimeSeed\(h, t', 9\)/);
    expect((await screen(primeFixture({ i: 1, t: 2, json: { donorSeed: undefined } }))).reasons).toMatch(/no donorSeed/);
    expect((await screen(primeFixture({ i: 1, t: 2, json: { side: 2 } }))).reasons).toMatch(/side 2/);
    expect((await screen(primeFixture({ i: 1, t: 2, json: { replicates: 1 } }))).reasons).toMatch(/replicates 1/);
    expect((await screen(base, { regimes: [{ k: 5, period: PRIME_PERIOD }] })).reasons).toMatch(/regime k 8 period 300, want k 5 period 300/);
    expect((await screen({ ...base, rows: base.rows.slice(2) })).reasons).toMatch(/126 rows, want 128/);
    expect((await screen(primeFixture({ i: 1, t: 2, json: { assay: "garden" } }))).reasons).toMatch(/want transmission/);
    // labels that are not an R1' history: rejected without a key
    const bad = r1PrimeScreen([await dirOf(primeFixture({ i: 1, t: 2, json: { labels: { arm: "cont", history: 1, r1prime: true, timePrime: 0 } } }))], { tau: PRIME_TAU, regimes: PRIME_REGIME });
    expect(bad.rejected[0]).toMatchObject({ key: null });
    expect(bad.rejected[0].reasons[0]).toMatch(/labels\.arm "cont"/);
    const r1set = r1PrimeScreen([await dirOf(primeFixture({ i: 1, t: 2, json: { labels: { arm: "scaf", history: 1, time: 1, timing: "b" } } }))], { tau: PRIME_TAU, regimes: PRIME_REGIME });
    expect(r1set.rejected[0].reasons[0]).toMatch(/labels\.r1prime is not true/);
    const badT = r1PrimeScreen([await dirOf(primeFixture({ i: 1, t: 2, json: { labels: { arm: "scaf", history: 1, r1prime: true, timePrime: 3 } } }))], { tau: PRIME_TAU, regimes: PRIME_REGIME });
    expect(badT.rejected[0].reasons[0]).toMatch(/timePrime 3/);
    // a rejected set keeps its key, so the stage can say why that history is unavailable
    expect((await screen(primeFixture({ i: 1, t: 2, json: { side: 2 } }))).rejected[0].key).toEqual({ arm: "scaf", history: 1, tPrime: 2 });
  });

  it("rejects missing, incomplete or inconsistent traits", async () => {
    const f = primeFixture({ i: 0 });
    expect((await screen(f, {}, false)).reasons).toMatch(/no traits\.tsv/);
    expect((await screen({ ...f, json: { ...f.json, traitsRecorded: undefined } })).reasons).toMatch(/traitsRecorded/);
    expect((await screen({ ...f, traitsText: f.traitsText.split("\n").filter((l) => !l.includes("\t200\t")).join("\n") })).reasons).toMatch(/2 census steps/);
    // the end trait of assay.tsv is the last census: a different one is refused
    const moved = { ...f, rows: f.rows.map((r, j) => (j === 7 ? { ...r, endTrait: r.endTrait + 1 } : r)) };
    expect((await screen(moved)).reasons).toMatch(/disagrees with assay\.tsv for 1 fragments/);
    // a fragment's row at tau repeated in place of another's: the counts agree, the fragments do not
    const lines = f.traitsText.trimEnd().split("\n");
    const first = lines.findIndex((l) => l.startsWith("0\t0\t200\t"));
    const second = lines.findIndex((l) => l.startsWith("0\t1\t200\t"));
    const twice = lines.map((l, k) => (k === second ? lines[first] : l)).join("\n") + "\n";
    expect((await screen({ ...f, traitsText: twice })).reasons).toMatch(/1 census steps with a repeated or out-of-grid \(replicate, pond\) \(step 200: 1 rows\)/);
    // the same in a table read without a grid is still caught when the fragments are joined
    const bare = r1PrimeScreen([{ ...(await dirOf({ ...f, traitsText: twice })), traits: await readTraits(tsvRows(twice.split("\n"))) }], { tau: PRIME_TAU, regimes: PRIME_REGIME });
    expect(bare.rejected[0].reasons.join(" ")).toMatch(/two rows for replicate 0 pond 0 at step 200/);
    // a row more at one step is a count mismatch
    expect((await screen({ ...f, traitsText: [...lines.slice(0, first + 1), lines[first], ...lines.slice(first + 1)].join("\n") + "\n" })).reasons).toMatch(/step 200 has 129/);
  });

  it("rejects a set whose assay.tsv does not fill the (replicate, pond) grid exactly once", async () => {
    const f = primeFixture({ i: 0 });
    // 128 rows, one repeated in place of another
    const dup = { ...f, rows: f.rows.map((r, j) => (j === 5 ? { ...r, replicate: f.rows[0].replicate, pond: f.rows[0].pond } : r)) };
    const r = await screen(dup);
    expect(r.accepted).toHaveLength(0);
    expect(r.reasons).toBe("assay.tsv repeats a (replicate, pond) in 1 rows");
    expect(r.rejected[0].key).toEqual({ arm: "scaf", history: 0, tPrime: 0 });
    expect((await screen({ ...f, rows: f.rows.map((r, j) => (j === 70 ? { ...r, replicate: 2 } : r)) })).reasons).toMatch(/1 rows outside the 2 x 64/);
    expect((await screen({ ...f, rows: f.rows.map((r, j) => (j === 3 ? { ...r, inoculum: "disc" } : r)) })).reasons).toMatch(/1 assay\.tsv rows are not fragment rows/);
    // an insufficient set has none
    const ins = primeFixture({ i: 1, insufficient: true });
    expect((await screen({ ...ins, rows: f.rows.slice(0, 2) })).reasons).toMatch(/2 rows, want 0/);
  });

  it("rejects, rather than throws on, a table without retE: another model is not fitted", async () => {
    const f = primeFixture({ i: 0 });
    const r = await screen({ ...f, rows: f.rows.map((r) => ({ ...r, retE: null })) });
    expect(r.accepted).toHaveLength(0);
    expect(r.reasons).toMatch(/no retE column/);
    expect(r.rejected[0].key).toEqual({ arm: "scaf", history: 0, tPrime: 0 });
  });

  it("rejects both of two sets with one (arm, history, t') without throwing, and refuses mixed regimes", async () => {
    const a = await dirOf(primeFixture({ i: 0 }), "a");
    const b = await dirOf(primeFixture({ i: 0 }), "b");
    const c = await dirOf(primeFixture({ i: 1 }), "c");
    const twin = r1PrimeScreen([a, b, c], { tau: PRIME_TAU, regimes: PRIME_REGIME });
    expect(twin.accepted.map((x) => x.dir)).toEqual(["c"]);
    expect(twin.rejected.map((x) => [x.dir, x.key])).toEqual([["a", { arm: "scaf", history: 0, tPrime: 0 }], ["b", { arm: "scaf", history: 0, tPrime: 0 }]]);
    expect(twin.rejected[0].reasons[0]).toMatch(/same R1' set \(scaf-i0-t0\) as b; a stage would count both/);
    const other = await dirOf(primeFixture({ i: 1, json: { k: 5 } }), "c");
    expect(() => r1PrimeScreen([a, other], { tau: PRIME_TAU, regimes: null })).toThrow(/mix regimes/);
    expect(r1PrimeScreen([a], { tau: PRIME_TAU, regimes: null }).regime).toEqual({ k: 8, period: PRIME_PERIOD });
  });

  it("--allow-any-seed waives the size, regime and seed checks of a smoke set, not the traits or the label", async () => {
    const smoke = primeFixture({ i: 0, json: { side: 2, replicates: 2, seeds: [{ physics: 1, fragment: 1 }, { physics: 2, fragment: 2 }], donorSeed: 3 } });
    expect((await screen(smoke)).accepted).toHaveLength(0);
    expect((await screen(smoke, { allowAnySeed: true, regimes: [{ k: 1, period: 1 }] })).accepted).toHaveLength(0); // 128 rows, but side 2 x 2 replicates is 8
    // 4 ponds, replicate 0 only: rows 0-3 of replicate 0 and the matching traits
    const four = smallOf(smoke);
    expect(four.traitsText.trimEnd().split("\n")).toHaveLength(1 + 4 * 3);
    const ok = await screen(four, { allowAnySeed: true, regimes: [{ k: 1, period: 1 }] });
    expect(ok.reasons).toBe("");
    expect(ok.accepted[0].fragments).toHaveLength(4);
    expect((await screen({ ...four, json: { ...four.json, traitsRecorded: undefined } }, { allowAnySeed: true })).accepted).toHaveLength(0);
  });
});

describe("R1' statistic", () => {
  it("is R1's: the same OLS, ICC and permutation code, with the stream r1PrimeSeed(h, t', 8)", () => {
    const r = lcg(5);
    const frags: R1PrimeFragment[] = Array.from({ length: 128 }, (_, j) => ({ family: 100 + ((j % 64) % 16), retMass: 50 + Math.floor(r() * 50), retE: 100 + Math.floor(r() * 100), truncated: false, endTrait: 120_000, tauTrait: strongTau((j % 64) % 16, r()) }));
    const sigma = r1PrimeSeed(3, 1, 8);
    const st = r1PrimeStat(frags, (f) => f.tauTrait, sigma);
    // the same numbers by hand through R1's pieces
    const resid = olsResiduals(frags.map((f) => f.tauTrait), [frags.map((f) => Math.log1p(f.retMass)), frags.map((f) => Math.log1p(f.retE))]);
    const ref = permutationP(resid, frags.map((f) => f.family), sigma, 1000)!;
    expect(st.icc).toBe(ref.icc);
    expect(st.p).toBe(ref.p);
    expect(st.p).toBeCloseTo(1 / 1001, 12);
    expect(st.demonstrated).toBe(true);
    // and R1's own history function gives the same ICC (a different permutation stream moves only p)
    const asRows = frags.map((f, j) => fragRow({ replicate: j >= 64 ? 1 : 0, pond: j % 64, family: f.family, retMass: f.retMass, retE: f.retE, endTrait: f.tauTrait }));
    expect(r1History(asRows, 3, 1).icc).toBe(st.icc);
    expect(r1Test(frags.map((f) => f.tauTrait), frags.map((f) => f.retMass), frags.map((f) => f.retE), frags.map((f) => f.family), sigma)).toMatchObject({ icc: st.icc, p: st.p, demonstrated: true });
    // a different stream gives the same ICC and (the p-value being a count of 1001) possibly another p
    expect(r1PrimeStat(frags, (f) => f.tauTrait, r1PrimeSeed(3, 1, 9)).icc).toBe(st.icc);
  });

  it("reports the between-donor variance component (negative kept), the raw family-mean variance and the saturation share", () => {
    // 9 fragments, 3 donors; constant covariates drop out of the OLS, so the adjusted trait is the centred trait
    const mk = (family: number, tauTrait: number, endTrait: number): R1PrimeFragment => ({ family, retMass: 100, retE: 200, truncated: false, tauTrait, endTrait });
    const frags = [mk(0, 1, 121_241), mk(0, 2, 121_242), mk(0, 3, 150_000), mk(1, 4, 0), mk(1, 5, 0), mk(1, 6, 0), mk(2, 7, 0), mk(2, 8, 0), mk(2, 9, 0)];
    const tau = r1PrimeStat(frags, (f) => f.tauTrait, 1);
    expect(tau.varianceComponent!).toBeCloseTo(26 / 3, 9);
    expect(tau.rawFamilyMeanVariance!).toBeCloseTo(9, 12); // means 2, 5, 8
    expect(tau.meanTrait).toBe(5);
    expect(tau.saturation).toBe(0);
    // 121,241 x 5 = 606,205 < 4 M_ASSAY = 606,208 <= 121,242 x 5: the 80% line is between them
    const end = r1PrimeStat(frags, (f) => f.endTrait, 1);
    expect(end.saturation).toBeCloseTo(2 / 9, 12);
    expect(M_ASSAY * 4).toBe(606_208);
    // a negative component stays negative
    const flat = [mk(0, 1, 0), mk(0, 3, 0), mk(1, 1, 0), mk(1, 3, 0), mk(2, 1, 0), mk(2, 3, 0)];
    const neg = r1PrimeStat(flat, (f) => f.tauTrait, 1);
    expect(neg.varianceComponent).toBe(-1);
    expect(neg.demonstrated).toBe(false);
    expect(neg.icc!).toBeLessThan(0);
  });

  it("has null variances and ICC when the donors cannot be told apart from one fragment each", () => {
    const one: R1PrimeFragment[] = [0, 1, 2].map((i) => ({ family: i, retMass: 100, retE: 200, truncated: false, tauTrait: i, endTrait: i }));
    expect(r1PrimeStat(one, (f) => f.tauTrait, 1)).toMatchObject({ icc: null, p: null, demonstrated: false, varianceComponent: null });
  });
});

describe("replay check", () => {
  const mc = (over: Record<string, unknown> = {}) => ({ passed: true, "scaf-i0": { replay: "aa11", saved: "aa11" }, "rand-i0": { replay: "bb22", saved: "bb22" }, ...over });

  it("reads the coordinator's format: a mechanism check with its hash pairs, the valid history-times and the failures", () => {
    const r = parseReplayCheck({ mechanismCheck: mc(), valid: ["scaf-i0-t0", "scaf-i0-t1", "rand-i3-t0"], failed: [{ id: "scaf-i3-t1", why: "row 4 differs" }, "rand-i2-t0", { id: "rand-i5-t1", reason: "x" }] });
    expect(r).toEqual({
      given: true,
      mechanismPassed: true,
      mechanismWhy: null,
      valid: ["scaf-i0-t0", "scaf-i0-t1", "rand-i3-t0"],
      failed: [{ id: "scaf-i3-t1", why: "row 4 differs" }, { id: "rand-i2-t0", why: null }, { id: "rand-i5-t1", why: "x" }],
    });
  });

  it("does not take a missing, false or contradicted mechanism check as passed", () => {
    const why = (json: unknown) => {
      const r = parseReplayCheck(json);
      return [r.given, r.mechanismPassed, r.mechanismWhy] as const;
    };
    expect(why({})).toEqual([true, false, "the replay check has no mechanismCheck object"]);
    expect(why({ valid: ["scaf-i0-t0"] })[1]).toBe(false);
    expect(why({ mechanismCheck: true })[1]).toBe(false); // passed must be the object's own `passed: true`
    expect(why({ mechanismCheck: "passed" })[1]).toBe(false);
    expect(why({ mechanismCheck: null })[1]).toBe(false);
    expect(why({ mechanismCheck: { passed: false } })).toEqual([true, false, "mechanismCheck.passed is not true"]);
    expect(why({ mechanismCheck: { passed: "true" } })[1]).toBe(false);
    expect(why({ mechanismCheck: {} })[1]).toBe(false);
    expect(why({ mechanismCheck: mc() })).toEqual([true, true, null]);
    expect(why({ mechanismCheck: { passed: true } })[1]).toBe(true);
    // passed is true but a replayed state does not equal the saved one
    const bad = why({ mechanismCheck: mc({ "rand-i0": { replay: "bb22", saved: "cc33" } }) });
    expect(bad[1]).toBe(false);
    expect(bad[2]).toMatch(/hashes of rand-i0 differ or are missing/);
    expect(why({ mechanismCheck: mc({ "scaf-i0": { replay: "aa11" } }) })[1]).toBe(false);
    expect(why({ mechanismCheck: mc({ "scaf-i0": { replay: 7, saved: 7 } }) })[1]).toBe(false);
  });

  it("is not a replay check at all without one, so nothing is valid", () => {
    expect(NO_REPLAY_CHECK).toMatchObject({ given: false, mechanismPassed: false, valid: [], failed: [] });
    expect(NO_REPLAY_CHECK.mechanismWhy).toMatch(/no replay check was given/);
  });

  it("refuses what it cannot read instead of ignoring a failure or a valid entry", () => {
    expect(() => parseReplayCheck(null)).toThrow(/want an object/);
    expect(() => parseReplayCheck(["scaf-i0-t0"])).toThrow(/want an object/);
    expect(() => parseReplayCheck({ valid: "scaf-i0-t0" })).toThrow(/valid must be an array/);
    expect(() => parseReplayCheck({ valid: ["scaf-i0"] })).toThrow(/unrecognised valid entry/);
    expect(() => parseReplayCheck({ valid: ["cont-i0-t0"] })).toThrow(/unrecognised valid entry/);
    expect(() => parseReplayCheck({ valid: ["scaf-i6-t0"] })).toThrow(/unrecognised valid entry/);
    expect(() => parseReplayCheck({ valid: [7] })).toThrow(/unrecognised valid entry/);
    expect(() => parseReplayCheck({ failed: "scaf-i0-t0" })).toThrow(/failed must be an array/);
    expect(() => parseReplayCheck({ failed: ["scaf-0-0"] })).toThrow(/unrecognised failed entry/);
    expect(() => parseReplayCheck({ failed: [{ id: "scaf-i0-t3" }] })).toThrow(/unrecognised failed entry/);
    expect(() => parseReplayCheck({ failed: [{ arm: "scaf", history: 0, tPrime: 1 }] })).toThrow(/unrecognised failed entry/);
    expect(() => parseReplayCheck({ failed: [null] })).toThrow(/unrecognised failed entry/);
  });
});

describe("R1' rule (Amendment 2)", () => {
  /** A screened set from a fixture. */
  const setOf = async (o: Parameters<typeof primeFixture>[0]): Promise<R1PrimeSet> => {
    const r = r1PrimeScreen([await dirOf(primeFixture(o))], { tau: PRIME_TAU, regimes: PRIME_REGIME });
    expect(r.rejected).toEqual([]);
    return r.accepted[0];
  };
  const strong = (i: number, extra: Partial<Parameters<typeof primeFixture>[0]> = {}) => setOf({ i, tau: strongTau, ...extra });
  const weak = (i: number, extra: Partial<Parameters<typeof primeFixture>[0]> = {}) => setOf({ i, tau: weakTau, ...extra });
  const at = (r: ReturnType<typeof r1PrimeEvaluate>, arm: "scaf" | "rand", i: number, t: 0 | 1 | 2 = 0) => r.histories.find((x) => x.arm === arm && x.history === i && x.tPrime === t)!;
  /** A replay check whose mechanism check passed and that lists every replayed history-time (t' = 0, 1; both arms) as valid. */
  const REPLAYED = (["scaf", "rand"] as const).flatMap((arm) => [0, 1, 2, 3, 4, 5].flatMap((i) => [0, 1].map((t) => `${arm}-i${i}-t${t}`)));
  const ok = (over: Partial<ReplayCheck> = {}): ReplayCheck => ({ given: true, mechanismPassed: true, mechanismWhy: null, valid: REPLAYED, failed: [], ...over });
  const without = (...ids: string[]) => ok({ valid: REPLAYED.filter((id) => !ids.includes(id)) });

  it("lists every (arm, history, t') and runs R1's statistic on the trait at tau and on the end trait", async () => {
    const r = r1PrimeEvaluate([await strong(0), await weak(1)], ok());
    expect(r.histories).toHaveLength(36);
    expect(r.histories.slice(0, 4).map((h) => [h.arm, h.history, h.tPrime, h.h, h.boundary])).toEqual([["scaf", 0, 0, 0, 34], ["scaf", 0, 1, 0, 67], ["scaf", 0, 2, 0, 100], ["scaf", 1, 0, 1, 34]]);
    expect(r.histories.filter((h) => h.arm === "rand")[0]).toMatchObject({ arm: "rand", history: 0, tPrime: 0, h: 6 });
    const a = at(r, "scaf", 0);
    expect(a).toMatchObject({ available: true, why: null, insufficient: false, n: 128, families: 16, demonstrated: true, covariates: ["log1p(retMass)", "log1p(retE)"] });
    expect(a.atTau!.icc!).toBeGreaterThan(0.9);
    expect(a.atTau!.p!).toBeCloseTo(1 / 1001, 12);
    expect(a.atTau!.varianceComponent!).toBeGreaterThan(0);
    expect(a.atTau!.saturation).toBe(0);
    expect(a.atEnd!.saturation).toBe(1); // end traits 140,000-143,000 are above 0.8 x 151,552 = 121,241.6
    expect(a.atEnd!.demonstrated).toBe(false);
    // the weak history has no donor effect at tau
    expect(at(r, "scaf", 1).demonstrated).toBe(false);
    expect(at(r, "scaf", 1).atTau!.p!).toBeGreaterThan(0.05);
    // every other key has no set
    expect(at(r, "scaf", 2)).toMatchObject({ available: false, why: "no assay set", n: 0, atTau: null, atEnd: null, demonstrated: false });
  });

  it("is true with at least 4 of 6 scaf histories demonstrated at t' = 0, and false with 3: the 4-of-6 edge", async () => {
    const four = r1PrimeEvaluate([await strong(0), await strong(1), await strong(2), await strong(3), await weak(4), await weak(5)], ok());
    expect(four.arms.scaf).toMatchObject({ verdict: true, valid: 6, demonstrated: 4 });
    expect(four.verdict).toBe(true);
    const three = r1PrimeEvaluate([await strong(0), await strong(1), await strong(2), await weak(3), await weak(4), await weak(5)], ok());
    expect(three.arms.scaf).toMatchObject({ verdict: false, valid: 6, demonstrated: 3 });
    expect(three.verdict).toBe(false);
  });

  it("is uninformative with fewer than 4 valid scaf histories at t' = 0, however many are demonstrated", async () => {
    const three = r1PrimeEvaluate([await strong(0), await strong(1), await strong(2)], ok());
    expect(three.arms.scaf).toMatchObject({ verdict: "uninformative", valid: 3, demonstrated: 3 });
    expect(three.verdict).toBe("uninformative");
    expect(r1PrimeEvaluate([], ok()).verdict).toBe("uninformative");
    // four valid is enough to be informative, and four demonstrated is true
    expect(r1PrimeEvaluate([await strong(0), await strong(1), await strong(2), await strong(3)], ok()).verdict).toBe(true);
    // t' = 1 and 2 sets do not make t' = 0 valid
    expect(r1PrimeEvaluate([await strong(0), await strong(1), await strong(2), await strong(3, { t: 1 }), await strong(4, { t: 2 })], ok()).verdict).toBe("uninformative");
  });

  it("makes every replayed history-time unavailable without a replay check: the verdict is uninformative, never true", async () => {
    const six = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => strong(i)));
    const t1 = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => strong(i, { t: 1 })));
    const t2 = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => strong(i, { t: 2 })));
    expect(r1PrimeEvaluate(six, ok()).verdict).toBe(true);
    for (const r of [r1PrimeEvaluate([...six, ...t1, ...t2]), r1PrimeEvaluate([...six, ...t1, ...t2], NO_REPLAY_CHECK)]) {
      expect(r.verdict).toBe("uninformative");
      expect(r.arms.scaf).toMatchObject({ verdict: "uninformative", valid: 0, demonstrated: 0 });
      expect(at(r, "scaf", 0).why).toBe("no replay evidence: no replay check was given (--replay)");
      expect(at(r, "scaf", 0, 1)).toMatchObject({ available: false, atTau: null });
      // t' = 2 is the original b100-pre checkpoint: it needs no replay evidence
      expect(at(r, "scaf", 0, 2)).toMatchObject({ available: true, why: null });
      expect(r.arms.scaf.byTime.map((b) => [b.tPrime, b.valid])).toEqual([[0, 0], [1, 0], [2, 6]]);
    }
  });

  it("makes t' = 0 and 1 unavailable when the mechanism check did not pass, but not the existing boundary-100 checkpoint", async () => {
    const six = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => strong(i)));
    const t2 = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => strong(i, { t: 2 })));
    // mechanismCheck.passed false (or contradicted, or missing) with every history-time listed as valid
    for (const mechanismWhy of ["mechanismCheck.passed is not true", "the replay check has no mechanismCheck object"]) {
      const r = r1PrimeEvaluate([...six, ...t2], ok({ mechanismPassed: false, mechanismWhy }));
      expect(r.verdict).toBe("uninformative");
      expect(at(r, "scaf", 0).why).toBe(`no replay evidence: ${mechanismWhy}`);
      expect(at(r, "scaf", 0, 1).available).toBe(false);
      expect(at(r, "scaf", 0, 2).available).toBe(true);
      expect(r.arms.scaf.byTime.map((b) => [b.tPrime, b.valid])).toEqual([[0, 0], [1, 0], [2, 6]]);
    }
  });

  it("needs the replay check to list a history-time as valid: a missing entry makes it unavailable, and failed wins", async () => {
    const six = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => strong(i)));
    // two entries missing from `valid`: 4 valid, 4 demonstrated
    const two = r1PrimeEvaluate(six, without("scaf-i0-t0", "scaf-i1-t0"));
    expect(two.arms.scaf).toMatchObject({ verdict: true, valid: 4, demonstrated: 4 });
    expect(at(two, "scaf", 0)).toMatchObject({ available: false, why: "no replay evidence: the replay check does not list it as valid", demonstrated: false, atTau: null });
    expect(at(two, "scaf", 2).available).toBe(true);
    // three missing: only 3 valid, uninformative although all 3 that remain are demonstrated
    expect(r1PrimeEvaluate(six, without("scaf-i0-t0", "scaf-i1-t0", "scaf-i2-t0")).verdict).toBe("uninformative");
    // an empty valid list is no evidence
    expect(r1PrimeEvaluate(six, ok({ valid: [] })).verdict).toBe("uninformative");
    // the id must match: another arm's or another boundary's entry is not this history-time's
    expect(r1PrimeEvaluate(six, ok({ valid: REPLAYED.filter((id) => id.startsWith("rand") || id.endsWith("t1")) })).verdict).toBe("uninformative");
    // failed wins over valid, and says why
    const failed = r1PrimeEvaluate(six, ok({ failed: [{ id: "scaf-i0-t0", why: "row 12 differs" }, { id: "scaf-i1-t0", why: null }] }));
    expect(at(failed, "scaf", 0)).toMatchObject({ available: false, why: "replay check failed: row 12 differs" });
    expect(at(failed, "scaf", 1).why).toBe("replay check failed");
    expect(failed.arms.scaf).toMatchObject({ verdict: true, valid: 4, demonstrated: 4 });
    // a failed t' = 2 is unavailable too, although it needs no evidence
    const t2 = await strong(0, { t: 2 });
    expect(at(r1PrimeEvaluate([t2], ok({ failed: [{ id: "scaf-i0-t2", why: null }] })), "scaf", 0, 2).available).toBe(false);
    expect(at(r1PrimeEvaluate([t2], ok()), "scaf", 0, 2).available).toBe(true);
  });

  it("counts a technically unavailable history as not demonstrated, and as not valid, with availability judged first", async () => {
    const six = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => strong(i)));
    // an unavailable history is not demonstrated: 3 demonstrated of 4 valid is false, not uninformative
    const mixed = [await strong(0), await strong(1), await strong(2), await weak(3), await strong(4), await strong(5)];
    const f = r1PrimeEvaluate(mixed, ok({ failed: [{ id: "scaf-i4-t0", why: null }, { id: "scaf-i5-t0", why: null }] }));
    expect(f.arms.scaf).toMatchObject({ verdict: false, valid: 4, demonstrated: 3 });
    // missing sets are unavailable, with the reason of a rejected one when it carried the key
    const some = r1PrimeEvaluate(six.slice(0, 5), ok(), [{ key: { arm: "scaf", history: 5, tPrime: 0 }, reasons: ["side 2, want 8"] }]);
    expect(at(some, "scaf", 5).why).toBe("set rejected: side 2, want 8");
    expect(at(some, "scaf", 5, 1).why).toBe("no assay set");
    expect(some.arms.scaf).toMatchObject({ verdict: true, valid: 5, demonstrated: 5 });
    // a rejected set whose directory could not be read is the same: unavailable, and the others go on
    const unreadable = r1PrimeEvaluate(six.slice(1), ok(), [{ key: { arm: "scaf", history: 0, tPrime: 0 }, reasons: ["could not read the set: ENOENT"] }]);
    expect(at(unreadable, "scaf", 0).why).toBe("set rejected: could not read the set: ENOENT");
    expect(unreadable.arms.scaf).toMatchObject({ verdict: true, valid: 5, demonstrated: 5 });
    // an analysis that throws makes that history-time unavailable instead of stopping the stage
    const boom = { ...six[0], get fragments(): R1PrimeFragment[] { throw new Error("boom"); } };
    const broken = r1PrimeEvaluate([boom, ...six.slice(1)], ok());
    expect(at(broken, "scaf", 0)).toMatchObject({ available: false, why: "analysis failed: boom" });
    expect(broken.arms.scaf).toMatchObject({ verdict: true, valid: 5, demonstrated: 5 });
  });

  it("treats fewer than 2 eligible donors as a valid, not demonstrated history (biological, not technical)", async () => {
    const ins = await setOf({ i: 3, insufficient: true });
    const r = r1PrimeEvaluate([await strong(0), await strong(1), await strong(2), ins], ok());
    expect(at(r, "scaf", 3)).toMatchObject({ available: true, insufficient: true, demonstrated: false, n: 0, atTau: null, atEnd: null, why: null });
    // 4 valid (one insufficient): informative, 3 demonstrated of 6 -> false
    expect(r.arms.scaf).toMatchObject({ verdict: false, valid: 4, demonstrated: 3 });
    // with the insufficient one, 3 strong and 3 more strong is still true
    const r2 = r1PrimeEvaluate([await strong(0), await strong(1), await strong(2), await strong(4), ins], ok());
    expect(r2.arms.scaf).toMatchObject({ verdict: true, valid: 5, demonstrated: 4 });
    // it still needs the replay evidence like any replayed history-time
    expect(at(r1PrimeEvaluate([ins], ok({ valid: [] })), "scaf", 3)).toMatchObject({ available: false, insufficient: false });
  });

  it("applies the rule to scaf and reports it for rand, and reads t' = 1 and 2 descriptively only", async () => {
    const sets = [
      ...(await Promise.all([0, 1, 2, 3, 4, 5].map((i) => weak(i)))),
      ...(await Promise.all([0, 1, 2, 3, 4, 5].map((i) => strong(i, { arm: "rand" })))),
      ...(await Promise.all([0, 1, 2, 3, 4, 5].map((i) => strong(i, { t: 1 })))),
    ];
    const r = r1PrimeEvaluate(sets, ok());
    expect(r.verdict).toBe(false);
    expect(r.arms.scaf.verdict).toBe(false);
    expect(r.arms.rand.verdict).toBe(true);
    expect(r.arms.rand.demonstrated).toBe(6);
    expect(r.arms.scaf.byTime.map((b) => [b.tPrime, b.boundary, b.valid, b.demonstratedAtTau])).toEqual([[0, 34, 6, 0], [1, 67, 6, 6], [2, 100, 0, 0]]);
    // the end trait is saturated and carries no donor effect: it is read apart from the trait at tau
    expect(r.arms.scaf.byTime[1].demonstratedAtEnd).toBeLessThan(6);
    expect(r.arms.scaf.byTime[1].meanSaturationAtTau).toBe(0);
    expect(r.arms.scaf.byTime[1].meanSaturationAtEnd).toBe(1);
    expect(r.arms.scaf.byTime[2].meanSaturationAtTau).toBeNull();
  });

  it("is deterministic", async () => {
    const sets = [await strong(0), await weak(1)];
    expect(r1PrimeEvaluate(sets, ok())).toEqual(r1PrimeEvaluate(sets, ok()));
  });

  it("takes the verdict from t' = 0 histories of the arm's own", () => {
    const h = (arm: "scaf" | "rand", tPrime: 0 | 1 | 2, available: boolean, demonstrated: boolean) => ({ arm, history: 0, tPrime, h: 0, boundary: 34, available, why: null, insufficient: false, n: 0, families: 0, truncatedRows: 0, covariates: [], demonstrated, atTau: null, atEnd: null });
    const four = (arm: "scaf" | "rand") => [0, 1, 2, 3].map(() => h(arm, 0, true, true));
    expect(r1PrimeVerdict(four("scaf"), "scaf")).toBe(true);
    expect(r1PrimeVerdict(four("scaf"), "rand")).toBe("uninformative");
    expect(r1PrimeVerdict([...four("scaf"), h("scaf", 1, true, false)], "scaf")).toBe(true);
    expect(r1PrimeVerdict([...four("scaf").slice(0, 3), h("scaf", 0, true, false)], "scaf")).toBe(false);
  });
});

// ---- the CLI end to end for tau and r1prime --------------------------------------------------------

function writeTraitDir(root: string, name: string, f: SetFixture, withTraits = true) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "assay.json"), JSON.stringify(f.json));
  writeFileSync(join(dir, "assay.tsv"), f.assayText);
  if (withTraits) writeFileSync(join(dir, "traits.tsv"), f.traitsText);
  return dir;
}

describe("scaffold-report tau and r1prime", () => {
  const scratch = () => mkdtempSync(join(tmpdir(), "scaffold-r1prime-"));
  const regime = ["--regime", "8", String(PRIME_PERIOD)];
  const frozenRegime = ["--regime", "8", "10000"];
  const find = (out: Record<string, any>, arm: string, history: number, tPrime: number) => out.histories.find((x: { arm: string; history: number; tPrime: number }) => x.arm === arm && x.history === history && x.tPrime === tPrime);
  /** What the tau stage writes for the strict calibration (tau at a census step of the 10,000-step period). */
  const tauFile = (root: string, tau: number, over: Record<string, unknown> = {}) => {
    const path = join(root, "tau.json");
    const f = frozenTau();
    const { source, ref, k, period, side, replicates, seeds, labels } = f.json;
    writeFileSync(path, JSON.stringify({ stage: "tau", verdict: null, validated: true, provenance: { source, ref, k, period, side, replicates, seeds, labels }, tau, ...over }));
    return path;
  };
  /** A replay-check.json whose mechanism check passed and that lists `valid`. */
  const replayFile = (root: string, valid: string[], over: Record<string, unknown> = {}) => {
    const path = join(root, "replay-check.json");
    writeFileSync(path, JSON.stringify({ mechanismCheck: { passed: true, "scaf-i0": { replay: "h1", saved: "h1" }, "rand-i0": { replay: "h2", saved: "h2" } }, valid, failed: [], ...over }));
    return path;
  };
  const ids = (arm: string, t: number, histories = [0, 1, 2, 3, 4, 5]) => histories.map((i) => `${arm}-i${i}-t${t}`);

  it("tau: reads the calibration's traits.tsv, prints tau with the median curve and records the provenance it validated", () => {
    const root = scratch();
    writeTraitDir(root, "tau", frozenTau());
    // other sets under the same root are skipped
    writeTraitDir(root, "prime", primeFixture({ i: 0 }));
    const out = report("tau", "--assays", root, ...frozenRegime);
    expect(out).toMatchObject({ stage: "tau", verdict: null, validated: true, tau: 2600, crossed: true, medianAtTau: 26_000, threshold: 25_764.5, ref: 103_058, fragments: 128, period: 10_000, skipped: 1, rejected: [] });
    expect(out.curve).toHaveLength(100);
    expect(out.curve[25]).toEqual({ step: 2600, n: 128, median: 26_000 });
    expect(out.provenance).toMatchObject({ source: FROZEN_SOURCE, ref: 103_058, k: 8, period: 10_000, side: 8, replicates: 2, seeds: [{ physics: 4_849_001, fragment: 4_849_001 }, { physics: 4_849_002, fragment: 4_849_002 }], labels: { arm: "ancestor", tauCalibration: true } });
    // never reaching 0.25 ref gives the whole period
    const never = scratch();
    writeTraitDir(never, "tau", frozenTau(() => 1000));
    expect(report("tau", "--assays", never, ...frozenRegime)).toMatchObject({ validated: true, tau: 10_000, crossed: false, medianAtTau: 1000 });
    // two calibration sets are an error
    writeTraitDir(root, "tau2", frozenTau());
    expect(() => report("tau", "--assays", root, ...frozenRegime)).toThrow(/2 tau calibration sets/);
  });

  it("tau: a calibration that is not Amendment 2's is refused, in strict mode, with the reasons; smoke runs are labelled unvalidated", () => {
    const root = scratch();
    // the wrong ref, a calibration at another source, and a smoke-sized set
    writeTraitDir(root, "wrong-ref", frozenTau(undefined, { ref: 40 }));
    const bad = report("tau", "--assays", root, ...frozenRegime);
    expect(bad).toMatchObject({ stage: "tau", verdict: null, validated: false, tau: null });
    expect(bad.rejected[0].reasons.join(" ")).toMatch(/ref 40, want 103058/);
    const other = scratch();
    writeTraitDir(other, "tau", frozenTau(undefined, { source: "runs/scaffold/main/scaf/i0/ckpt/b100-pre.blck.gz" }));
    expect(report("tau", "--assays", other).rejected[0].reasons.join(" ")).toMatch(/want a path ending in calib\/source\/ckpt\/b1-pre\.blck\.gz/);
    const smoke = scratch();
    writeTraitDir(smoke, "tau", tauFixture([5, 12, 20], { json: { side: 2, seeds: [{ physics: 1, fragment: 1 }, { physics: 2, fragment: 2 }] } }));
    const s = report("tau", "--assays", smoke, ...regime);
    expect(s).toMatchObject({ stage: "tau", verdict: null, validated: false, tau: null });
    expect(s.rejected[0].reasons.join(" ")).toMatch(/side 2/);
    // --allow-any-seed reads a smoke calibration, but its tau.json is not validated
    const free = scratch();
    writeTraitDir(free, "tau", tauFixture([5, 12, 20], { json: { seeds: [{ physics: 1, fragment: 1 }, { physics: 2, fragment: 2 }], source: "ckpt" } }));
    const f = report("tau", "--assays", free, "--allow-any-seed");
    expect(f).toMatchObject({ stage: "tau", validated: false, tau: 200, crossed: true, medianAtTau: 12, period: PRIME_PERIOD, rejected: [] });
  });

  it("tau: a calibration with a missing or malformed table is rejected with the reason, not a crash", () => {
    const root = scratch();
    const noTsv = writeTraitDir(root, "tau", frozenTau());
    execFileSync("rm", [join(noTsv, "assay.tsv")]);
    const r = report("tau", "--assays", root, ...frozenRegime);
    expect(r).toMatchObject({ validated: false, tau: null });
    expect(r.rejected[0].reasons[0]).toMatch(/could not read the set/);
    const bad = scratch();
    const f = frozenTau();
    writeTraitDir(bad, "tau", { ...f, traitsText: f.traitsText.replace("0\t0\t100\t", "0\t0\t100\tx") });
    expect(report("tau", "--assays", bad, ...frozenRegime).rejected[0].reasons[0]).toMatch(/could not read the set.*not a number/);
  });

  it("r1prime: refuses a tau.json that is not validated strict calibration output", () => {
    const root = scratch();
    for (const i of [0, 1, 2, 3]) writeTraitDir(root, `scaf-i${i}-t0`, primeFixture({ i }));
    const args = (tau: string, ...more: string[]) => ["r1prime", "--assays", root, "--tau", tau, ...regime, ...more];
    const good = tauFile(root, PRIME_TAU);
    expect(report(...args(good)).tauValidated).toBe(true);
    // a hand-written or smoke tau.json
    writeFileSync(join(root, "plain.json"), JSON.stringify({ stage: "tau", tau: PRIME_TAU }));
    expect(() => report(...args(join(root, "plain.json")))).toThrow(/cannot fix tau for R1'.*not validated strict calibration output/);
    expect(() => report(...args(tauFile(root, PRIME_TAU, { validated: false })))).toThrow(/not validated/);
    expect(() => report(...args(tauFile(root, PRIME_TAU, { tau: null })))).toThrow(/tau null, want a positive integer/);
    expect(() => report(...args(tauFile(root, 250)))).toThrow(/tau 250 is not a census step/);
    const wrongRef = tauFile(root, PRIME_TAU, { provenance: { ...JSON.parse(readFileSync(good, "utf8")).provenance, ref: 40 } });
    expect(() => report(...args(wrongRef))).toThrow(/provenance\.ref 40, want 103058/);
    // the smoke flag reads it, and says it is unvalidated
    const smoke = report(...args(join(root, "plain.json"), "--allow-any-seed"));
    expect(smoke).toMatchObject({ stage: "r1prime", tau: PRIME_TAU, tauValidated: false });
    writeFileSync(join(root, "plain.json"), JSON.stringify({ stage: "tau", tau: null }));
    expect(() => report(...args(join(root, "plain.json"), "--allow-any-seed"))).toThrow(/tau null, want a positive integer/);
    expect(() => report("r1prime", "--assays", root, ...regime)).toThrow();
  });

  it("r1prime: without --replay every t' = 0 and 1 history is unavailable and the verdict is uninformative; t' = 2 needs no replay", () => {
    const root = scratch();
    for (const i of [0, 1, 2, 3, 4, 5]) writeTraitDir(root, `scaf-i${i}-t0`, primeFixture({ i, tau: strongTau }));
    for (const i of [0, 1]) writeTraitDir(root, `scaf-i${i}-t2`, primeFixture({ i, t: 2, tau: strongTau }));
    const tau = tauFile(root, PRIME_TAU);
    const out = report("r1prime", "--assays", root, "--tau", tau, ...regime);
    expect(out).toMatchObject({ stage: "r1prime", verdict: "uninformative", tau: PRIME_TAU, tauValidated: true, regime: { k: 8, period: PRIME_PERIOD }, rejected: [], skipped: 0 });
    expect(out.replay).toMatchObject({ given: false, mechanismPassed: false, valid: [], failed: [] });
    expect(out.arms.scaf).toMatchObject({ verdict: "uninformative", valid: 0, demonstrated: 0 });
    expect(find(out, "scaf", 0, 0)).toMatchObject({ available: false, atTau: null });
    expect(find(out, "scaf", 0, 0).why).toMatch(/^no replay evidence: no replay check was given/);
    expect(find(out, "scaf", 0, 2)).toMatchObject({ available: true });
    expect(out.histories).toHaveLength(36);
    // with the evidence the same sets give the verdict
    const replay = replayFile(root, ids("scaf", 0));
    expect(report("r1prime", "--assays", root, "--tau", tau, ...regime, "--replay", replay)).toMatchObject({ verdict: true });
    // mechanismCheck false, or a valid list that leaves histories out, is uninformative again
    expect(report("r1prime", "--assays", root, "--tau", tau, ...regime, "--replay", replayFile(root, ids("scaf", 0), { mechanismCheck: { passed: false } })).verdict).toBe("uninformative");
    expect(report("r1prime", "--assays", root, "--tau", tau, ...regime, "--replay", replayFile(root, ids("scaf", 0, [0, 1, 2]))).verdict).toBe("uninformative");
    const partial = report("r1prime", "--assays", root, "--tau", tau, ...regime, "--replay", replayFile(root, ids("scaf", 0, [0, 1, 2, 3])));
    expect(partial.arms.scaf).toMatchObject({ verdict: true, valid: 4, demonstrated: 4 });
    expect(find(partial, "scaf", 4, 0).why).toBe("no replay evidence: the replay check does not list it as valid");
  });

  it("r1prime: the rule, --replay, rejected sets, and the descriptive columns, through files", () => {
    const root = scratch();
    // scaf t' = 0: 4 strong + 2 weak histories; scaf t' = 1 strong; rand t' = 0 strong
    for (const i of [0, 1, 2, 3]) writeTraitDir(root, `scaf-i${i}-t0`, primeFixture({ i, tau: strongTau }));
    for (const i of [4, 5]) writeTraitDir(root, `scaf-i${i}-t0`, primeFixture({ i, tau: weakTau }));
    for (const i of [0, 1]) writeTraitDir(root, `scaf-i${i}-t1`, primeFixture({ i, t: 1, tau: strongTau }));
    for (const i of [0, 1, 2, 3, 4, 5]) writeTraitDir(root, `rand-i${i}-t0`, primeFixture({ arm: "rand", i, tau: strongTau }));
    // a set that is not an R1' set is skipped; a smoke R1' set is rejected and its history is unavailable
    writeTraitDir(root, "tau", tauFixture([5, 12, 20]));
    writeTraitDir(root, "smoke", primeFixture({ i: 0, t: 2, json: { side: 2 } }));
    const tau = tauFile(root, PRIME_TAU);
    const everything = [...ids("scaf", 0), ...ids("scaf", 1), ...ids("rand", 0)];
    const replay = replayFile(root, everything);
    const args = ["r1prime", "--assays", root, "--tau", tau, ...regime, "--replay", replay];
    const out = report(...args);
    expect(out.verdict).toBe(true);
    expect(out.skipped).toBe(1);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].key).toEqual({ arm: "scaf", history: 0, tPrime: 2 });
    expect(out.arms.scaf).toMatchObject({ verdict: true, valid: 6, demonstrated: 4 });
    expect(out.arms.rand).toMatchObject({ verdict: true, valid: 6, demonstrated: 6 });
    expect(out.arms.scaf.byTime.map((b: { valid: number }) => b.valid)).toEqual([6, 2, 0]);
    const h = find(out, "scaf", 0, 0);
    expect(h.atTau).toMatchObject({ demonstrated: true });
    expect(Object.keys(h.atTau)).toEqual(["icc", "p", "demonstrated", "varianceComponent", "rawFamilyMeanVariance", "meanTrait", "saturation"]);
    expect(h.atEnd.demonstrated).toBe(false);
    expect(find(out, "scaf", 0, 2).why).toMatch(/^set rejected: side 2/);
    expect(out.replay).toMatchObject({ given: true, mechanismPassed: true, mechanismWhy: null });
    expect(out.replay.valid).toEqual(everything);

    // failures listed in the replay: two failed histories leave 4 valid with 2 demonstrated -> false, not uninformative; 3 -> uninformative
    const failed = report(...args.slice(0, -1), replayFile(root, everything, { failed: ["scaf-i0-t0", { id: "scaf-i1-t0", why: "row 7 differs" }] }));
    expect(failed.arms.scaf).toMatchObject({ verdict: false, valid: 4, demonstrated: 2 });
    expect(find(failed, "scaf", 1, 0).why).toBe("replay check failed: row 7 differs");
    const three = report(...args.slice(0, -1), replayFile(root, everything, { failed: ["scaf-i0-t0", "scaf-i1-t0", "scaf-i2-t0"] }));
    expect(three.verdict).toBe("uninformative");
    expect(() => report(...args.slice(0, -1), replayFile(root, everything, { failed: ["nonsense"] }))).toThrow(/unrecognised failed entry/);
  });

  it("r1prime: a missing, malformed or incomplete set becomes unavailable with its reason while the others continue", () => {
    const root = scratch();
    for (const i of [0, 1, 2, 3, 4, 5]) writeTraitDir(root, `scaf-i${i}-t0`, primeFixture({ i, tau: strongTau }));
    const tau = tauFile(root, PRIME_TAU);
    const replay = replayFile(root, ids("scaf", 0));
    const args = ["r1prime", "--assays", root, "--tau", tau, ...regime, "--replay", replay];
    expect(report(...args)).toMatchObject({ verdict: true, rejected: [] });
    // i0: no assay.tsv; i1: a non-numeric trait in traits.tsv; the other four still give the verdict
    execFileSync("rm", [join(root, "scaf-i0-t0", "assay.tsv")]);
    const f1 = primeFixture({ i: 1, tau: strongTau });
    writeTraitDir(root, "scaf-i1-t0", { ...f1, traitsText: f1.traitsText.replace("0\t0\t100\t", "0\t0\t100\tx") });
    const two = report(...args);
    expect(two.verdict).toBe(true);
    expect(two.arms.scaf).toMatchObject({ verdict: true, valid: 4, demonstrated: 4 });
    expect(two.rejected.map((r: { key: unknown }) => r.key)).toEqual([{ arm: "scaf", history: 0, tPrime: 0 }, { arm: "scaf", history: 1, tPrime: 0 }]);
    expect(find(two, "scaf", 0, 0)).toMatchObject({ available: false });
    expect(find(two, "scaf", 0, 0).why).toMatch(/^set rejected: could not read the set/);
    expect(find(two, "scaf", 1, 0).why).toMatch(/^set rejected: could not read the set.*not a number/);
    // i2: an assay.tsv without the retE column; only 3 histories are valid now, so availability makes it uninformative
    const f2 = primeFixture({ i: 2, tau: strongTau });
    const cut = f2.assayText.trimEnd().split("\n").map((l) => l.split("\t").filter((_, c) => c !== ASSAY_COLUMNS.indexOf("retE")).join("\t")).join("\n") + "\n";
    writeTraitDir(root, "scaf-i2-t0", { ...f2, assayText: cut });
    const three = report(...args);
    expect(three.verdict).toBe("uninformative");
    expect(three.arms.scaf).toMatchObject({ verdict: "uninformative", valid: 3, demonstrated: 3 });
    expect(find(three, "scaf", 2, 0).why).toMatch(/no retE column/);
    // an unreadable assay.json is reported too (no key to attribute it to), and a traits.tsv that is simply absent
    writeFileSync(join(root, "scaf-i3-t0", "assay.json"), "{ not json");
    execFileSync("rm", [join(root, "scaf-i4-t0", "traits.tsv")]);
    const more = report(...args);
    expect(more.verdict).toBe("uninformative");
    expect(more.rejected.find((r: { key: unknown }) => r.key === null).reasons[0]).toMatch(/^assay\.json:/);
    expect(find(more, "scaf", 4, 0).why).toMatch(/no traits\.tsv/);
    expect(more.arms.scaf).toMatchObject({ valid: 1 });
  });

  it("r1prime: a duplicate fragment grid is rejected and its history-time is unavailable", () => {
    const root = scratch();
    for (const i of [0, 1, 2, 3, 4]) writeTraitDir(root, `scaf-i${i}-t0`, primeFixture({ i, tau: strongTau }));
    // scaf i5: assay.tsv repeats a fragment in place of another
    const f5 = primeFixture({ i: 5, tau: strongTau });
    const lines = f5.assayText.trimEnd().split("\n");
    lines[6] = lines[1];
    writeTraitDir(root, "scaf-i5-t0", { ...f5, assayText: lines.join("\n") + "\n" });
    const tau = tauFile(root, PRIME_TAU);
    const replay = replayFile(root, ids("scaf", 0));
    const out = report("r1prime", "--assays", root, "--tau", tau, ...regime, "--replay", replay);
    expect(out.arms.scaf).toMatchObject({ verdict: true, valid: 5, demonstrated: 5 });
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].reasons.join(" ")).toMatch(/assay\.tsv repeats a \(replicate, pond\) in 1 rows/);
    expect(find(out, "scaf", 5, 0)).toMatchObject({ available: false });
    // traits.tsv: a census step with a repeated fragment
    const f4 = primeFixture({ i: 4, tau: strongTau });
    const t = f4.traitsText.trimEnd().split("\n");
    const first = t.findIndex((l) => l.startsWith("0\t0\t200\t"));
    writeTraitDir(root, "scaf-i4-t0", { ...f4, traitsText: t.map((l, k) => (k === first + 3 ? t[first] : l)).join("\n") + "\n" });
    const again = report("r1prime", "--assays", root, "--tau", tau, ...regime, "--replay", replay);
    expect(again.arms.scaf).toMatchObject({ verdict: true, valid: 4, demonstrated: 4 });
    expect(find(again, "scaf", 4, 0).why).toMatch(/repeated or out-of-grid/);
    // the same history-time twice: neither set is used
    writeTraitDir(root, "scaf-i0-t0-copy", primeFixture({ i: 0, tau: strongTau }));
    const twice = report("r1prime", "--assays", root, "--tau", tau, ...regime, "--replay", replay);
    expect(twice.arms.scaf).toMatchObject({ valid: 3 });
    expect(twice.verdict).toBe("uninformative");
    expect(find(twice, "scaf", 0, 0).why).toMatch(/same R1' set \(scaf-i0-t0\)/);
  });

  it("tau stage: a duplicate fragment grid in the calibration is rejected", () => {
    const root = scratch();
    const f = frozenTau();
    const lines = f.assayText.trimEnd().split("\n");
    lines[3] = lines[2];
    writeTraitDir(root, "tau", { ...f, assayText: lines.join("\n") + "\n" });
    const out = report("tau", "--assays", root, ...frozenRegime);
    expect(out).toMatchObject({ tau: null, validated: false });
    expect(out.rejected[0].reasons.join(" ")).toMatch(/assay\.tsv repeats a \(replicate, pond\) in 1 rows/);
  });

  it("r1, r2, r3 and calibrate leave R1' and tau directories out (counted as skipped), so existing readouts do not change", () => {
    const root = scratch();
    for (const i of [0, 1, 2]) writeAssayDir(root, `h${i}`, scafR1(i));
    const before = report("r1", "--assays", root, "--regime", "5", "3000");
    writeTraitDir(root, "prime", primeFixture({ i: 3 }));
    writeTraitDir(root, "tau", tauFixture([5, 12, 20]));
    const after = report("r1", "--assays", root, "--regime", "5", "3000");
    expect(after.skipped).toBe(before.skipped + 2);
    expect(after.rejected).toEqual(before.rejected);
    expect({ ...after, skipped: 0 }).toEqual({ ...before, skipped: 0 });
    const p = join(root, "p1.json");
    writeFileSync(p, JSON.stringify({ stage: "p1", choice: { passing: [{ k: 8, period: 300 }] } }));
    expect(report("r3", "--assays", root, "--regime", "8", "300").skipped).toBe(5);
  });

  it("r1prime --allow-any-seed reads a smoke-sized set (4 ponds x 1 replicate), and the stage still refuses missing traits", () => {
    const root = scratch();
    const small = smallOf(primeFixture({ i: 0, json: { seeds: [{ physics: 1, fragment: 1 }], donorSeed: 2 } }));
    writeTraitDir(root, "smoke", small);
    const tau = tauFile(root, PRIME_TAU);
    const strict = report("r1prime", "--assays", root, "--tau", tau, ...regime);
    expect(strict.rejected).toHaveLength(1);
    const smoke = report("r1prime", "--assays", root, "--tau", tau, "--allow-any-seed");
    expect(smoke.rejected).toEqual([]);
    expect(smoke.histories[0]).toMatchObject({ available: false });
    expect(smoke.verdict).toBe("uninformative");
    // with the replay evidence the set is read: 4 fragments
    const withReplay = report("r1prime", "--assays", root, "--tau", tau, "--allow-any-seed", "--replay", replayFile(root, ids("scaf", 0)));
    expect(withReplay.histories[0]).toMatchObject({ available: true, n: 4 });
    expect(withReplay.verdict).toBe("uninformative");
  });
});

// ---- R1'': the crossing-time replication (docs/scaffold-heredity-replication-v1.md) ---------------------

describe("R1'' crossing time", () => {
  const at = (...pairs: [number, number][]) => pairs;

  it("is the first census step at which the trait reaches m* = 25,764.5, whatever order the steps arrive in", () => {
    expect(R1DP_THRESHOLD).toBe(25_764.5);
    expect(R1DP_THRESHOLD).toBe(0.25 * 103_058);
    const series = at([100, 10], [200, 25_000], [300, 26_000], [400, 30_000]);
    expect(crossingTime(series)).toBe(300);
    expect(crossingTime([...series].reverse())).toBe(300);
    expect(crossingTime([series[3], series[1], series[2], series[0]])).toBe(300);
  });

  it("is 10,100 when the trait never gets there, dead or alive", () => {
    expect(R1DP_CENSORED).toBe(10_100);
    expect(crossingTime(at([100, 10], [200, 20_000], [10_000, 25_764]))).toBe(10_100);
    expect(crossingTime(at([100, 0], [200, 0], [10_000, 0]))).toBe(10_100); // a pond that died out
    expect(crossingTime([])).toBe(10_100);
    expect(crossingTime(at([100, 0]), 300)).toBe(300); // another period's censored value
  });

  it("is 100 when the first census is already at or above m*", () => {
    expect(crossingTime(at([100, 40_000], [200, 50_000], [300, 60_000]))).toBe(100);
    expect(crossingTime(at([100, 25_765]))).toBe(100);
    expect(crossingTime(at([300, 60_000], [100, 40_000], [200, 50_000]))).toBe(100);
  });

  it("crosses at m* exactly (the traits are integers: 25,765 reaches 25,764.5, 25,764 does not), and the first crossing counts even if the trait falls back", () => {
    expect(reachesThreshold(25_765)).toBe(true);
    expect(reachesThreshold(25_764)).toBe(false);
    expect(reachesThreshold(0)).toBe(false);
    expect(crossingTime(at([100, 25_764], [200, 25_765]))).toBe(200);
    expect(crossingTime(at([100, 1], [200, 30_000], [300, 5], [400, 30_000]))).toBe(200);
    expect(crossingTime(at([10_000, 30_000]))).toBe(10_000); // crossing at the very last census is a crossing
  });

  it("reads the trait at tau = 4,100", () => {
    expect(R1DP_TAU).toBe(4100);
  });
});

// ---- fixtures: R1'' sets as scaffold-assays --r1dprime --traits writes them

const DP_PERIOD = 10_000;
const DP_STEPS = censusSteps(DP_PERIOD, 100);
const DP_SHA = "ab".repeat(32);
const DP_MUT = 429_497;

/** What the assay records about its source for set h: the protocol's world (a fresh history at step 340,000, a control at b1-pre). */
function dpProvenance(h: number): R1dPrimeProvenance {
  const l = r1dPrimeLabelsOf(h);
  const world = l.arm === "control" ? { seed: (l.control === "positive" ? 4_805_001 : 4_811_201) + l.history, mutRate: 0, step: 10_000, distinctGenomes: l.control === "positive" ? 12 : 1 } : { seed: 4_811_001 + 100 * (l.arm === "scaf" ? 0 : 1) + l.history, mutRate: DP_MUT, step: 340_000, distinctGenomes: 1019 };
  // the phase of a grown pre-cycle state: C and S held, bound mass far outside the landing windows
  const phase = { totalC: 85_566, totalS: 204_772, carrying: 94_592, outsideWindow: 92_766, postCycle: false };
  return { source: `runs/scaffold/rep/${l.arm}/ckpt/b${l.arm === "control" ? 1 : 34}-pre.blck.gz`, stateHash: "0123456789abcdef", tilesX: 8, tilesY: 8, ...world, phase };
}

/** A strong donor effect on the crossing step (donors 300 steps apart, a little within), and none (independent of the donor, 100-10,100). */
const strongCross = (donor: number, u: number) => 500 + 300 * donor + 100 * Math.floor(u * 3);
const weakCross = (_donor: number, u: number) => 100 * (1 + Math.floor(u * 101));

/**
 * An R1'' set of 128 fragments (replicate 0 then 1, 64 ponds, donor 0-15): a fragment's trait is 5 per 100 steps (far below m*)
 * until its crossing step `cross(donor, u, j)` and 30,000 or more from then on (a step above the last census never crosses); `dead`
 * fragments have trait 0 throughout. `donorCovariates` makes the retained B+P and E depend on the donor (as they do in a real set, since a
 * donor's fragments are alike), not random.
 */
function dpFixture(o: { h: number; cross?: (donor: number, u: number, j: number) => number; insufficient?: boolean; dead?: (j: number) => boolean; donorCovariates?: boolean; json?: Record<string, unknown> }): SetFixture {
  const labels = r1dPrimeLabelsOf(o.h);
  const seed = r1dPrimeSeed(o.h, 0);
  const json = JSON.parse(
    JSON.stringify({
      ...assayJson({
        ...BASE_JSON,
        source: dpProvenance(o.h).source,
        assay: "transmission",
        k: 8,
        period: DP_PERIOD,
        side: 8,
        replicates: 2,
        inoculum: "fragment",
        seeds: [0, 1].map((s) => ({ physics: seed + s, fragment: seed + s })),
        labels,
        extra: { donorSeed: seed + 9, donors: [], eligible: o.insufficient ? 1 : 64, insufficient: !!o.insufficient, traitsRecorded: true, provenance: dpProvenance(o.h), protocolSha256R1dp: DP_SHA },
      }),
      ...o.json,
    }),
  ) as Record<string, unknown>;
  const n = o.insufficient ? 0 : 128;
  const r = lcg(7000 + 31 * o.h);
  const series: number[][] = [];
  const rows = Array.from({ length: n }, (_, j) => {
    const donor = (j % 64) % 16;
    const T = (o.cross ?? strongCross)(donor, r(), j);
    // a dead pond has no trait at any census
    const trait = DP_STEPS.map((step) => (o.dead?.(j) ? 0 : step >= T ? 30_000 + 10 * ((step / 100) % 7) : (5 * step) / 100));
    series.push(trait);
    const [retMass, retE] = o.donorCovariates ? [50 + 17 * donor, 100 + 31 * donor] : [50 + Math.floor(r() * 50), 100 + Math.floor(r() * 100)];
    return fragRow({ replicate: j >= 64 ? 1 : 0, pond: j % 64, family: 100 + donor, retMass, retE, endTrait: trait[trait.length - 1], truncated: 0 });
  });
  return { json, rows, series, ...fixtureText("transmission", rows, series, !!o.insufficient, DP_STEPS) };
}

const dpDir = async (f: SetFixture, name = "d"): Promise<TraitSetDir> => dirOf(f, name);

/** The screened set of a fixture (strict mode: the protocol's seeds, regime, provenance and grid). */
async function dpSetOf(o: Parameters<typeof dpFixture>[0]): Promise<R1dPrimeSet> {
  const r = r1dPrimeScreen([await dpDir(dpFixture(o), `h${o.h}`)], { regimes: [{ k: 8, period: DP_PERIOD }] });
  expect(r.rejected).toEqual([]);
  return r.accepted[0];
}

const dpCache = new Map<string, Promise<R1dPrimeSet>>();
/** `dpSetOf` for the default strong or weak fixture of h, kept (the sets are never mutated). */
const dpKind = (h: number, kind: "strong" | "weak"): Promise<R1dPrimeSet> => {
  const key = `${h}|${kind}`;
  if (!dpCache.has(key)) dpCache.set(key, dpSetOf({ h, cross: kind === "strong" ? strongCross : weakCross }));
  return dpCache.get(key)!;
};

describe("R1'' screening", () => {
  const screen = async (f: SetFixture, o: Partial<Parameters<typeof r1dPrimeScreen>[1]> = {}) => {
    const r = r1dPrimeScreen([await dpDir(f)], { regimes: [{ k: 8, period: DP_PERIOD }], ...o });
    return { ...r, reasons: r.rejected.flatMap((x) => x.reasons).join(" | ") };
  };

  it("accepts a sound set and carries each fragment's T, its end trait and its trait at tau = 4,100", async () => {
    // fragment 0 is at m* by the first census, 1 never gets there, 2 crosses at tau, 3 just after it, 4 at the last census
    const special = [100, 10_100, 4100, 4200, 10_000];
    const f = dpFixture({ h: 3, cross: (donor, u, j) => (j < special.length ? special[j] : strongCross(donor, u)) });
    const r = await screen(f);
    expect(r.rejected).toEqual([]);
    expect(r.regime).toEqual({ k: 8, period: DP_PERIOD });
    expect(r.accepted).toHaveLength(1);
    const set = r.accepted[0];
    expect(set).toMatchObject({ h: 3, insufficient: false, censored: 10_100, protocolSha256R1dp: DP_SHA, provenance: dpProvenance(3) });
    expect(set.fragments).toHaveLength(128);
    expect(set.fragments.slice(0, 5).map((fr) => fr.T)).toEqual(special);
    // the trait at tau: at m* from 4,100 on for fragment 2, not yet for fragment 3
    expect(set.fragments.slice(0, 5).map((fr) => fr.tauTrait! >= 25_765)).toEqual([true, false, true, false, false]);
    // fragments are in R1's order, replicate 0's f = 0..63 then replicate 1's, with R1's columns
    set.fragments.forEach((fr, j) => {
      expect(fr).toMatchObject({ family: f.rows[j].family, retMass: f.rows[j].retMass, retE: f.rows[j].retE, endTrait: f.series[j][99], tauTrait: f.series[j][40], truncated: false });
    });
    // T is the first of the fragment's own census steps at or above m*, from the whole 2 x 64 x 100 grid
    set.fragments.forEach((fr, j) => expect(fr.T).toBe(crossingTime(DP_STEPS.map((step, c) => [step, f.series[j][c]] as [number, number]))));
  });

  it("accepts an insufficient set (no fragments, no traits) as a valid one", async () => {
    const r = await screen(dpFixture({ h: 4, insufficient: true }));
    expect(r.rejected).toEqual([]);
    expect(r.accepted[0]).toMatchObject({ h: 4, insufficient: true, fragments: [] });
  });

  it("rejects wrong seeds, donor seed, size, regime and labels, with the reasons", async () => {
    const seed = r1dPrimeSeed(1, 0);
    const base = dpFixture({ h: 1 });
    expect((await screen(dpFixture({ h: 1, json: { seeds: [{ physics: seed, fragment: seed }, { physics: seed, fragment: seed + 1 }] } }))).reasons).toMatch(/does not match the R1'' labels \(h 1\).*r1dPrimeSeed\(h, 1\) = /);
    expect((await screen(dpFixture({ h: 1, json: { seeds: [{ physics: assaySeed(1, 1, 0, 0, 0), fragment: seed }, { physics: seed + 1, fragment: seed + 1 }] } }))).reasons).toMatch(/seed 4825251/);
    expect((await screen(dpFixture({ h: 1, json: { seeds: [{ physics: seed, fragment: seed }] } }))).reasons).toMatch(/1 seeds, want 2/);
    expect((await screen(dpFixture({ h: 1, json: { donorSeed: seed + 8 } }))).reasons).toMatch(/donor seed .* want r1dPrimeSeed\(h, 9\)/);
    expect((await screen(dpFixture({ h: 1, json: { donorSeed: undefined } }))).reasons).toMatch(/no donorSeed/);
    expect((await screen(dpFixture({ h: 1, json: { side: 2 } }))).reasons).toMatch(/side 2, want 8/);
    expect((await screen(dpFixture({ h: 1, json: { replicates: 1 } }))).reasons).toMatch(/replicates 1, want 2/);
    expect((await screen(dpFixture({ h: 1, json: { censusEvery: 50 } }))).reasons).toMatch(/censusEvery 50, want 100/);
    expect((await screen(dpFixture({ h: 1, json: { k: 5 } }))).reasons).toMatch(/k 5, want 8/);
    expect((await screen(dpFixture({ h: 1, json: { period: 3000 } }))).reasons).toMatch(/period 3000, want 10000/);
    expect((await screen(base, { regimes: [{ k: 5, period: DP_PERIOD }] })).reasons).toMatch(/regime k 8 period 10000, want k 5 period 10000/);
    expect((await screen({ ...base, rows: base.rows.slice(2) })).reasons).toMatch(/126 rows, want 128/);
    expect((await screen(dpFixture({ h: 1, json: { assay: "garden" } }))).reasons).toMatch(/want transmission/);
    expect((await screen(dpFixture({ h: 1, json: { inoculum: "disc" } }))).reasons).toMatch(/inoculum "disc"/);
    // labels that are not an R1'' set's: rejected without an h, and with the reason
    const noLabel = await screen(dpFixture({ h: 1, json: { labels: { arm: "scaf", history: 1, r1prime: true, timePrime: 0 } } }));
    expect(noLabel.rejected[0]).toMatchObject({ h: null });
    expect(noLabel.reasons).toMatch(/labels\.r1dprime is not true/);
    expect((await screen(dpFixture({ h: 1, json: { labels: { arm: "rand", history: 1, r1dprime: true, h: 1 } } }))).reasons).toMatch(/labels\.arm "rand", want "scaf" for h 1/);
    expect((await screen(dpFixture({ h: 1, json: { labels: { arm: "scaf", history: 1, r1dprime: true, h: 18 } } }))).reasons).toMatch(/labels\.h 18, want 0-17/);
    expect((await screen(dpFixture({ h: 12, json: { labels: { arm: "control", history: 0, r1dprime: true, h: 12, control: "negative" } } }))).reasons).toMatch(/labels\.control "negative", want "positive" for h 12/);
    // a rejected set keeps its h, so the stage can say why that set is unavailable
    expect((await screen(dpFixture({ h: 1, json: { side: 2 } }))).rejected[0].h).toBe(1);
  });

  it("rejects a source that is not the protocol's for its labels, or whose provenance or protocol hash was not recorded", async () => {
    const prov = (h: number, over: Record<string, unknown>) => dpFixture({ h, json: { provenance: { ...dpProvenance(h), ...over } } });
    expect((await screen(prov(0, { seed: 4_811_002 }))).reasons).toMatch(/source seed 4811002, want 4811001/);
    expect((await screen(prov(0, { step: 1_000_000 }))).reasons).toMatch(/source step 1000000, want 340000/);
    expect((await screen(prov(0, { mutRate: 0 }))).reasons).toMatch(/source mutRate 0, want 429497/);
    expect((await screen(prov(6, { seed: 4_811_001 }))).reasons).toMatch(/source seed 4811001, want 4811101/);
    expect((await screen(prov(12, { distinctGenomes: 1 }))).reasons).toMatch(/1 distinct genomes, want more than 1/);
    expect((await screen(prov(13, { seed: 4_805_001 }))).reasons).toMatch(/source seed 4805001, want 4805002/);
    expect((await screen(prov(14, { mutRate: DP_MUT }))).reasons).toMatch(/source mutRate 429497, want 0/);
    expect((await screen(prov(15, { distinctGenomes: 12 }))).reasons).toMatch(/12 distinct genomes, want 1 \(a clone world\)/);
    expect((await screen(prov(17, { seed: 4_811_201 }))).reasons).toMatch(/source seed 4811201, want 4811204/);
    expect((await screen(dpFixture({ h: 0, json: { provenance: undefined } }))).reasons).toMatch(/no provenance of the source checkpoint/);
    // the checkpoint phase: b34-post has b34-pre's seed, mutation rate and step, so its path and its content are what say it is not the pre-cycle state
    const post = { totalC: 0, totalS: 0, carrying: 2014, outsideWindow: 0, postCycle: true };
    const at = (h: number, source: string, phase = dpProvenance(h).phase) => dpFixture({ h, json: { source, provenance: { ...dpProvenance(h), source, phase } } });
    expect((await screen(at(0, "runs/scaffold/rep/main/scaf/i0/ckpt/b34-post.blck.gz"))).reasons).toMatch(/does not end in ckpt\/b34-pre\.blck\.gz/);
    expect((await screen(at(0, "runs/scaffold/rep/main/scaf/i0/ckpt/b34-pre.blck.gz", post))).reasons).toMatch(/source looks post-cycle \(C 0, S 0; 0 of 2014 cells/);
    expect((await screen(at(0, "runs/scaffold/rep/main/scaf/i0/ckpt/b34-pre.blck.gz", { ...post, postCycle: false }))).reasons).toMatch(/phase flag postCycle false disagrees with its measures \(true\)/);
    expect((await screen(at(12, "runs/scaffold/p2/rank/s0/ckpt/b34-pre.blck.gz"))).reasons).toMatch(/does not end in ckpt\/b1-pre\.blck\.gz/);
    expect((await screen(at(14, "runs/scaffold/rep/neg/j0/ckpt/b1-pre.blck.gz", post))).reasons).toMatch(/looks post-cycle/);
    expect((await screen(at(0, "runs/scaffold/rep/main/scaf/i0/ckpt/b34-pre.blck.gz"))).rejected).toEqual([]);
    // no phase check recorded (an assay from before it), or one that is not a phase
    const { phase: _phase, ...noPhase } = dpProvenance(0);
    expect((await screen(dpFixture({ h: 0, json: { provenance: noPhase } }))).reasons).toMatch(/no provenance of the source checkpoint with its phase check/);
    expect((await screen(dpFixture({ h: 0, json: { provenance: { ...dpProvenance(0), phase: { ...dpProvenance(0).phase, postCycle: "no" } } } }))).reasons).toMatch(/no provenance/);
    expect((await screen(dpFixture({ h: 0, json: { provenance: { ...dpProvenance(0), phase: { ...dpProvenance(0).phase, totalC: 1.5 } } } }))).reasons).toMatch(/no provenance/);
    // the provenance is of the assay's own source
    expect((await screen(dpFixture({ h: 0, json: { source: "runs/scaffold/rep/main/scaf/i1/ckpt/b34-pre.blck.gz" } }))).reasons).toMatch(/provenance\.source ".*scaf\/ckpt\/b34-pre\.blck\.gz" is not the assay's source ".*i1/);
    expect((await screen(prov(0, { stateHash: 7 }))).reasons).toMatch(/no provenance/);
    expect((await screen(dpFixture({ h: 0, json: { protocolSha256R1dp: undefined } }))).reasons).toMatch(/no protocolSha256R1dp/);
    expect((await screen(dpFixture({ h: 0, json: { protocolSha256R1dp: "abc" } }))).reasons).toMatch(/no protocolSha256R1dp/);
    // the sound ones pass, every kind of source
    for (const h of [0, 5, 6, 11, 12, 13, 14, 15, 16, 17]) expect((await screen(dpFixture({ h }))).rejected).toEqual([]);
  });

  it("rejects missing, incomplete or inconsistent traits, and a table that does not fill the grid", async () => {
    const f = dpFixture({ h: 0 });
    const noTraits = r1dPrimeScreen([{ ...(await dpDir(f)), traits: null }], { regimes: null });
    expect(noTraits.rejected[0].reasons.join(" ")).toMatch(/no traits\.tsv/);
    expect((await screen({ ...f, json: { ...f.json, traitsRecorded: undefined } })).reasons).toMatch(/traitsRecorded/);
    // one census step missing: 99 steps, not 100
    expect((await screen({ ...f, traitsText: f.traitsText.split("\n").filter((l) => !l.includes("\t200\t")).join("\n") })).reasons).toMatch(/99 census steps/);
    // the end trait of assay.tsv is the last census: a different one is refused
    expect((await screen({ ...f, rows: f.rows.map((r, j) => (j === 7 ? { ...r, endTrait: r.endTrait + 1 } : r)) })).reasons).toMatch(/disagrees with assay\.tsv for 1 fragments/);
    // a fragment's row repeated in place of another's at one census step
    const lines = f.traitsText.trimEnd().split("\n");
    const first = lines.findIndex((l) => l.startsWith("0\t0\t200\t"));
    const second = lines.findIndex((l) => l.startsWith("0\t1\t200\t"));
    const twice = lines.map((l, k) => (k === second ? lines[first] : l)).join("\n") + "\n";
    expect((await screen({ ...f, traitsText: twice })).reasons).toMatch(/1 census steps with a repeated or out-of-grid \(replicate, pond\) \(step 200: 1 rows\)/);
    // assay.tsv that does not fill the grid exactly once
    expect((await screen({ ...f, rows: f.rows.map((r, j) => (j === 5 ? { ...r, replicate: f.rows[0].replicate, pond: f.rows[0].pond } : r)) })).reasons).toBe("assay.tsv repeats a (replicate, pond) in 1 rows");
    expect((await screen({ ...f, rows: f.rows.map((r) => ({ ...r, retE: null })) })).reasons).toMatch(/no retE column/);
    const ins = dpFixture({ h: 1, insufficient: true });
    expect((await screen({ ...ins, rows: f.rows.slice(0, 2) })).reasons).toMatch(/2 rows, want 0/);
  });

  it("rejects both of two sets with one h without throwing", async () => {
    const a = await dpDir(dpFixture({ h: 0 }), "a");
    const b = await dpDir(dpFixture({ h: 0 }), "b");
    const c = await dpDir(dpFixture({ h: 1 }), "c");
    const twin = r1dPrimeScreen([a, b, c], { regimes: [{ k: 8, period: DP_PERIOD }] });
    expect(twin.accepted.map((x) => x.dir)).toEqual(["c"]);
    expect(twin.rejected.map((x) => [x.dir, x.h])).toEqual([["a", 0], ["b", 0]]);
    expect(twin.rejected[0].reasons[0]).toMatch(/same R1'' set \(scaf-i0\) as b; a stage would count both/);
  });

  it("--allow-any-seed waives the size, regime, seed and provenance checks of a smoke set, not the traits or the label", async () => {
    const f = dpFixture({ h: 12, json: { side: 2, replicates: 1, seeds: [{ physics: 1, fragment: 1 }], donorSeed: 3, provenance: undefined, protocolSha256R1dp: undefined, period: DP_PERIOD } });
    expect((await screen(f)).accepted).toHaveLength(0);
    const small = smallOf(f);
    expect((await screen(small)).accepted).toHaveLength(0);
    const ok = await screen(small, { allowAnySeed: true, regimes: null });
    expect(ok.reasons).toBe("");
    expect(ok.accepted[0].fragments).toHaveLength(4);
    expect(ok.accepted[0]).toMatchObject({ h: 12, provenance: null, protocolSha256R1dp: null });
    expect((await screen({ ...small, json: { ...small.json, traitsRecorded: undefined } }, { allowAnySeed: true })).accepted).toHaveLength(0);
    expect((await screen({ ...small, json: { ...small.json, labels: { arm: "scaf" } } }, { allowAnySeed: true })).reasons).toMatch(/labels\.r1dprime is not true/);
    // smoke sets of another regime do not mix
    const other = await dpDir(smallOf(dpFixture({ h: 13, json: { side: 2, replicates: 1, k: 5 } })), "other");
    const mine = await dpDir(small, "a");
    expect(() => r1dPrimeScreen([mine, other], { regimes: null, allowAnySeed: true })).toThrow(/mix regimes/);
  });
});

describe("R1'' statistic", () => {
  const mk = (family: number, T: number, over: Partial<R1dPrimeFragment> = {}): R1dPrimeFragment => ({ family, retMass: 100, retE: 200, truncated: false, T, endTrait: 120_000, tauTrait: 0, ...over });

  it("is R1's, unchanged, on log T: the same OLS, ICC and permutation code, with the stream r1dPrimeSeed(h, 8)", async () => {
    const set = await dpKind(3, "strong");
    const sigma = r1dPrimeSeed(3, 8);
    expect(sigma).toBe(4_812_001 + 750 + 8);
    const st = r1dPrimeStat(set.fragments, sigma);
    // the same numbers by hand through R1's pieces
    const y = set.fragments.map((f) => Math.log(f.T));
    const resid = olsResiduals(y, [set.fragments.map((f) => Math.log1p(f.retMass)), set.fragments.map((f) => Math.log1p(f.retE))]);
    const ref = permutationP(resid, set.fragments.map((f) => f.family), sigma, 1000)!;
    expect(st.icc).toBe(ref.icc);
    expect(st.p).toBe(ref.p);
    expect(st.p).toBeCloseTo(1 / 1001, 12);
    expect(st.demonstrated).toBe(true);
    expect(st.icc!).toBeGreaterThan(0.9);
    expect(st.meanLogT).toBeCloseTo(y.reduce((a, v) => a + v, 0) / y.length, 12);
    expect(r1Test(y, set.fragments.map((f) => f.retMass), set.fragments.map((f) => f.retE), set.fragments.map((f) => f.family), sigma)).toMatchObject({ icc: st.icc, p: st.p, demonstrated: true });
    // R1's own history function gives the same ICC on the same scores (another stream moves only p)
    const asRows = set.fragments.map((f, j) => fragRow({ replicate: j >= 64 ? 1 : 0, pond: j % 64, family: f.family, retMass: f.retMass, retE: f.retE, endTrait: Math.log(f.T) }));
    expect(r1History(asRows, 3, 0).icc).toBe(st.icc);
    expect(r1dPrimeStat(set.fragments, r1dPrimeSeed(3, 9)).icc).toBe(st.icc);
  });

  it("scores log T: the endpoints T = 100 and T = 10,100 enter as log 100 and log 10,100", () => {
    const frags = [mk(0, 100), mk(0, 200), mk(1, 400), mk(1, 400), mk(2, 10_100), mk(2, 5000)];
    const st = r1dPrimeStat(frags, 1);
    expect(st.meanLogT).toBeCloseTo((Math.log(100) + Math.log(200) + 2 * Math.log(400) + Math.log(10_100) + Math.log(5000)) / 6, 12);
  });

  it("has the between-donor variance component (negative kept) and the raw family-mean variance, and undefined ICC with one fragment per donor", () => {
    // 9 fragments, 3 donors; constant covariates drop out of the OLS, so the adjusted score is the centred log T
    const L = (x: number) => Math.exp(x);
    const frags = [mk(0, L(5)), mk(0, L(6)), mk(0, L(7)), mk(1, L(8)), mk(1, L(9)), mk(1, L(10)), mk(2, L(11)), mk(2, L(12)), mk(2, L(13))];
    const st = r1dPrimeStat(frags, 1);
    expect(st.varianceComponent!).toBeCloseTo(26 / 3, 9); // donor means 6, 9, 12 around 9; msb 27, msw 1, n0 3
    expect(st.rawFamilyMeanVariance!).toBeCloseTo(9, 9);
    const flat = [mk(0, L(1)), mk(0, L(3)), mk(1, L(1)), mk(1, L(3)), mk(2, L(1)), mk(2, L(3))];
    const neg = r1dPrimeStat(flat, 1);
    expect(neg.varianceComponent!).toBeCloseTo(-1, 9);
    expect(neg.demonstrated).toBe(false);
    expect(neg.icc!).toBeLessThan(0);
    expect(r1dPrimeStat([mk(0, 100), mk(1, 200), mk(2, 300)], 1)).toMatchObject({ icc: null, p: null, demonstrated: false, varianceComponent: null });
  });

  it("does not test constant scores: 128 fragments all at one T are ICC 0, p 1, not demonstrated, whatever the retained mass and energy do by donor", () => {
    const donorCovariates = (family: number) => ({ retMass: 50 + 17 * family, retE: 100 + 31 * family });
    for (const T of [10_100, 100, 4100, 5000]) {
      const frags = Array.from({ length: 128 }, (_, j) => mk((j % 64) % 16, T, donorCovariates((j % 64) % 16)));
      // the OLS leaves only roundoff of the constant scores (ICC of that is a ratio of roundoff errors, which can come out near 1)
      const y = frags.map((f) => Math.log(f.T));
      const resid = olsResiduals(y, [frags.map((f) => Math.log1p(f.retMass)), frags.map((f) => Math.log1p(f.retE))]);
      expect(resid.reduce((a, r) => a + r * r, 0)).toBeLessThan(1e-12);
      const st = r1dPrimeStat(frags, r1dPrimeSeed(0, 8));
      expect(st).toMatchObject({ icc: 0, p: 1, demonstrated: false, degenerate: "constant score", varianceComponent: 0, rawFamilyMeanVariance: 0 });
      expect(st.meanLogT).toBeCloseTo(Math.log(T), 12);
      expect(r1dPrimeDegeneracy(frags.map((f) => f.T), resid, y)).toBe("constant score");
    }
  });

  it("still analyses a single non-constant value normally", () => {
    const donorCovariates = (family: number) => ({ retMass: 50 + 17 * family, retE: 100 + 31 * family });
    const sigma = r1dPrimeSeed(0, 8);
    // 127 fragments at 10,100 and one that crossed at the first census, or by 10,000 (the least a score can differ)
    for (const odd of [100, 10_000]) {
      const frags = Array.from({ length: 128 }, (_, j) => mk((j % 64) % 16, j === 5 ? odd : 10_100, donorCovariates((j % 64) % 16)));
      const st = r1dPrimeStat(frags, sigma);
      expect(st.degenerate).toBeNull();
      expect(st.icc).toEqual(expect.any(Number));
      expect(st.p!).toBeGreaterThanOrEqual(1 / 1001);
      expect(st.p!).toBeLessThanOrEqual(1);
      expect(st.icc!).toBeLessThan(0.5);
      // it is R1's statistic, run: the same ICC and p as r1Test's on the same scores
      const y = frags.map((f) => Math.log(f.T));
      const t = r1Test(y, frags.map((f) => f.retMass), frags.map((f) => f.retE), frags.map((f) => f.family), sigma);
      expect(st).toMatchObject({ icc: t.icc, p: t.p, demonstrated: t.demonstrated });
      expect(st.rawFamilyMeanVariance!).toBeGreaterThan(0);
    }
    // a set with an ordinary spread is untouched: degenerate null, and the same numbers as before the guard
    const spread = Array.from({ length: 128 }, (_, j) => mk((j % 64) % 16, 500 + 300 * ((j % 64) % 16) + 100 * (j % 3)));
    expect(r1dPrimeStat(spread, sigma)).toMatchObject({ degenerate: null, demonstrated: true });
  });

  it("treats residuals at roundoff level as degenerate too: at most 1e-9 of the scores' total sum of squares, or at most 1e-12", () => {
    const values = [1, 2, 3, 4, 5, 6]; // not constant: sst = 17.5
    expect(R1DP_DEGENERATE_RELATIVE).toBe(1e-9);
    expect(R1DP_DEGENERATE_ABSOLUTE).toBe(1e-12);
    const resid = (rss: number) => [Math.sqrt(rss), 0, 0, 0, 0, 0];
    expect(r1dPrimeDegeneracy(values, resid(1e-13))).toBe("negligible residual variance"); // absolute
    expect(r1dPrimeDegeneracy(values, resid(1e-12))).toBe("negligible residual variance"); // at the line
    expect(r1dPrimeDegeneracy(values, resid(1e-8))).toBe("negligible residual variance"); // relative: 1e-9 x 17.5 = 1.75e-8
    expect(r1dPrimeDegeneracy(values, resid(17.5 * 1e-9))).toBe("negligible residual variance"); // at the line
    expect(r1dPrimeDegeneracy(values, resid(1e-7))).toBeNull();
    expect(r1dPrimeDegeneracy(values, resid(1e-3))).toBeNull();
    // the relative line follows the scores' own scale
    const big = values.map((v) => v * 1000); // sst = 1.75e7: 1e-9 x sst = 1.75e-2
    expect(r1dPrimeDegeneracy(big, resid(1e-2))).toBe("negligible residual variance");
    expect(r1dPrimeDegeneracy(big, resid(1e-1))).toBeNull();
    // the sum of squares is about the scores' mean, not about 0: a large constant offset does not raise the line
    const offset = values.map((v) => v + 1e6);
    expect(r1dPrimeDegeneracy(offset, resid(1e-5))).toBeNull();
    // constant values win over everything, compared exactly (T values are integers: 10,100 is 10,100)
    expect(r1dPrimeDegeneracy([10_100, 10_100, 10_100], [5, -5, 0])).toBe("constant score");
    expect(r1dPrimeDegeneracy([10_100, 10_100, 10_099], [5, -5, 0])).toBeNull();
    // a score that is a transform of the values: constancy is the values', the sum of squares the scores'
    expect(r1dPrimeDegeneracy([100, 100], [3, -3], [Math.log(100), Math.log(100)])).toBe("constant score");
    expect(r1dPrimeDegeneracy([100, 200], [3e-5, -3e-5], [Math.log(100), Math.log(200)])).toBeNull();
  });
});

describe("R1'' run directories", () => {
  const meta = (over: Record<string, unknown> = {}) => ({ tool: "scaffold", arm: "scaf", k: 8, period: 10_000, cycles: 34, side: 8, seed: 4_811_001, mutRate: 429_497, init: "clone", ...over });

  it("reads the arm and history of a fresh-history run, 4,811,001 + 100 arm + i with 34 cycles", () => {
    expect(r1dPrimeRunOf(meta())).toEqual({ key: { arm: "scaf", history: 0 }, why: [] });
    expect(r1dPrimeRunOf(meta({ arm: "rand", seed: 4_811_106 })).key).toEqual({ arm: "rand", history: 5 });
    expect(r1dPrimeRunOf(meta({ seed: 4_811_007 })).key).toBeNull(); // i = 5 is the last
    expect(r1dPrimeRunOf(meta({ arm: "rand", seed: 4_811_001 })).key).toBeNull(); // the scaf seed under a rand label
  });

  it("refuses the other runs of the sandbox, with the reasons: the main run, controls, other regimes", () => {
    const why = (over: Record<string, unknown>) => r1dPrimeRunOf(meta(over)).why.join(" | ");
    expect(why({ seed: 4_810_001, cycles: 100 })).toMatch(/seed 4810001 is not 4811001 \+ 100 arm \+ i.*cycles 100, want 34/);
    expect(why({ arm: "cont" })).toMatch(/arm "cont", want scaf or rand/);
    expect(why({ side: 4 })).toMatch(/side 4, want 8/);
    expect(why({ init: "founders" })).toMatch(/init "founders"/);
    expect(why({ mutRate: 0 })).toMatch(/mutation off/);
    expect(why({ k: 5 })).toMatch(/k 5, want 8/);
    expect(why({ period: 3000 })).toMatch(/period 3000, want 10000/);
    // the negative-control worlds: mutation-off clone, arm cont
    expect(why({ arm: "cont", seed: 4_811_201, mutRate: 0, cycles: 1, k: 0 })).toMatch(/arm "cont".*mutation off.*k 0.*cycles 1/);
  });
});

describe("R1'' rule", () => {
  const run = (arm: "scaf" | "rand", history: number, over: Partial<R1dPrimeRun> = {}): R1dPrimeRun => ({ arm, history, dir: `${arm}/i${history}`, status: "finished", ended: false, endedAt: null, ...over });
  const strong = (...hs: number[]) => Promise.all(hs.map((h) => dpKind(h, "strong")));
  const weak = (...hs: number[]) => Promise.all(hs.map((h) => dpKind(h, "weak")));
  const entry = (r: ReturnType<typeof r1dPrimeEvaluate>, h: number) => r.histories.find((x) => x.h === h)!;
  /** Controls that pass: both positive worlds strong, the negative worlds with no donor effect. */
  const controlsOk = async () => [...(await strong(12, 13)), ...(await weak(14, 15, 16, 17))];

  it("lists the 18 sets: scaf and rand histories, then the controls by name", async () => {
    const r = r1dPrimeEvaluate([...(await controlsOk()), ...(await strong(0))]);
    expect(r.histories.map((x) => x.id)).toEqual(["scaf-i0", "scaf-i1", "scaf-i2", "scaf-i3", "scaf-i4", "scaf-i5", "rand-i0", "rand-i1", "rand-i2", "rand-i3", "rand-i4", "rand-i5"]);
    expect(r.controls.positive.map((x) => [x.h, x.id, x.world])).toEqual([[12, "pos-s0", 0], [13, "pos-s1", 1]]);
    expect(r.controls.negative.map((x) => [x.h, x.id, x.world])).toEqual([[14, "neg-j0", 0], [15, "neg-j1", 1], [16, "neg-j2", 2], [17, "neg-j3", 3]]);
    expect(entry(r, 0)).toMatchObject({ outcome: "analysed", valid: true, why: null, n: 128, families: 16, demonstrated: true, covariates: ["log1p(retMass)", "log1p(retE)"] });
    expect(entry(r, 0).icc!).toBeGreaterThan(0.9);
    expect(entry(r, 0).p!).toBeCloseTo(1 / 1001, 12);
    expect(entry(r, 1)).toMatchObject({ outcome: "unavailable", valid: false, why: "no assay set", n: 0, icc: null, p: null, demonstrated: false });
  });

  it("the 4-of-6 edge: true with 4 of 6 scaf histories demonstrated, false with 3", async () => {
    const ok = await controlsOk();
    const four = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 3)), ...(await weak(4, 5))]);
    expect(four.arms.scaf).toMatchObject({ verdict: true, valid: 6, demonstrated: 4, ended: 0, donors: 0, unavailable: 0 });
    expect(four.controls).toMatchObject({ positivePassed: true, nullGatePassed: true });
    expect(four.verdict).toBe(true);
    expect(entry(four, 4).demonstrated).toBe(false);
    expect(entry(four, 4).p!).toBeGreaterThan(0.05);
    const three = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2)), ...(await weak(3, 4, 5))]);
    expect(three.arms.scaf).toMatchObject({ verdict: false, valid: 6, demonstrated: 3 });
    expect(three.verdict).toBe(false);
    const six = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 3, 4, 5))]);
    expect(six.verdict).toBe(true);
    expect(six.arms.scaf.demonstrated).toBe(6);
  });

  it("applies the rule to scaf only, and reports rand with the same statistic", async () => {
    const ok = await controlsOk();
    const r = r1dPrimeEvaluate([...ok, ...(await weak(0, 1, 2, 3, 4, 5)), ...(await strong(6, 7, 8, 9, 10, 11))]);
    expect(r.verdict).toBe(false);
    expect(r.arms.scaf).toMatchObject({ verdict: false, demonstrated: 0 });
    expect(r.arms.rand).toMatchObject({ verdict: true, valid: 6, demonstrated: 6 });
    expect(entry(r, 6)).toMatchObject({ arm: "rand", history: 0, demonstrated: true });
    // the same histories under the other arm's labels change nothing about the verdict
    const flip = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 3, 4, 5)), ...(await weak(6, 7, 8, 9, 10, 11))]);
    expect(flip.verdict).toBe(true);
    expect(flip.arms.rand.verdict).toBe(false);
  });

  it("controls come first: a positive control that fails makes the verdict uninformative, however many scaf histories are demonstrated", async () => {
    const six = await strong(0, 1, 2, 3, 4, 5);
    const weakPositive = r1dPrimeEvaluate([...six, ...(await strong(12)), ...(await weak(13)), ...(await weak(14, 15, 16, 17))]);
    expect(weakPositive.controls.positivePassed).toBe(false);
    expect(weakPositive.controls.positive.map((c) => c.demonstrated)).toEqual([true, false]);
    expect(weakPositive.controls.nullGatePassed).toBe(true);
    expect(weakPositive.verdict).toBe("uninformative");
    // the arm's own rule still reads true: only the stage's verdict is held back
    expect(weakPositive.arms.scaf.verdict).toBe(true);
    // a positive control that is missing has not passed
    const missing = r1dPrimeEvaluate([...six, ...(await strong(12)), ...(await weak(14, 15, 16, 17))]);
    expect(missing.controls.positive[1]).toMatchObject({ h: 13, outcome: "unavailable", demonstrated: false });
    expect(missing.controls.positivePassed).toBe(false);
    expect(missing.verdict).toBe("uninformative");
    // no controls at all
    expect(r1dPrimeEvaluate(six).verdict).toBe("uninformative");
    // both pass: the rule is read
    expect(r1dPrimeEvaluate([...six, ...(await controlsOk())]).verdict).toBe(true);
  });

  it("the null gate: at most 1 of the 4 negative controls significant; 2 of 4 makes the verdict uninformative", async () => {
    const six = await strong(0, 1, 2, 3, 4, 5);
    const pos = await strong(12, 13);
    const one = r1dPrimeEvaluate([...six, ...pos, ...(await strong(14)), ...(await weak(15, 16, 17))]);
    expect(one.controls.negative.map((c) => c.significant)).toEqual([true, false, false, false]);
    expect(one.controls).toMatchObject({ nullGatePassed: true, positivePassed: true });
    expect(one.verdict).toBe(true);
    const two = r1dPrimeEvaluate([...six, ...pos, ...(await strong(14, 15)), ...(await weak(16, 17))]);
    expect(two.controls.negative.map((c) => c.significant)).toEqual([true, true, false, false]);
    expect(two.controls.nullGatePassed).toBe(false);
    expect(two.controls.positivePassed).toBe(true);
    expect(two.verdict).toBe("uninformative");
    const four = r1dPrimeEvaluate([...six, ...pos, ...(await strong(14, 15, 16, 17))]);
    expect(four.controls.nullGatePassed).toBe(false);
    expect(four.verdict).toBe("uninformative");
    // none significant passes too
    expect(r1dPrimeEvaluate([...six, ...pos, ...(await weak(14, 15, 16, 17))]).controls.nullGatePassed).toBe(true);
  });

  it("the null gate needs all four negatives tested: a missing one, or one with fewer than 2 donors, leaves it unmet", async () => {
    const six = await strong(0, 1, 2, 3, 4, 5);
    const pos = await strong(12, 13);
    const three = r1dPrimeEvaluate([...six, ...pos, ...(await weak(14, 15, 16))]);
    expect(three.controls.negative[3]).toMatchObject({ h: 17, outcome: "unavailable", tested: false, significant: false });
    expect(three.controls.nullGatePassed).toBe(false);
    expect(three.verdict).toBe("uninformative");
    const few = r1dPrimeEvaluate([...six, ...pos, ...(await weak(14, 15, 16)), await dpSetOf({ h: 17, insufficient: true })]);
    expect(few.controls.negative[3]).toMatchObject({ outcome: "donors", tested: false, icc: null });
    expect(few.controls.nullGatePassed).toBe(false);
    expect(few.verdict).toBe("uninformative");
  });

  it("availability: a missing, rejected or failed set is unavailable and not demonstrated; fewer than 4 valid scaf histories is uninformative", async () => {
    const ok = await controlsOk();
    // three valid, all demonstrated: uninformative (availability before the rule)
    const three = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2))]);
    expect(three.arms.scaf).toMatchObject({ verdict: "uninformative", valid: 3, demonstrated: 3, unavailable: 3 });
    expect(three.verdict).toBe("uninformative");
    expect(r1dPrimeEvaluate([...ok]).arms.scaf).toMatchObject({ verdict: "uninformative", valid: 0, unavailable: 6 });
    // four valid are enough, and four demonstrated is true
    const four = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 3))]);
    expect(four.arms.scaf).toMatchObject({ verdict: true, valid: 4, demonstrated: 4, unavailable: 2 });
    expect(four.verdict).toBe(true);
    // 3 demonstrated of 4 valid is false, not uninformative
    expect(r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2)), ...(await weak(3))]).arms.scaf).toMatchObject({ verdict: false, valid: 4, demonstrated: 3 });
    // rand's sets do not make scaf valid
    expect(r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 6, 7))]).verdict).toBe("uninformative");
    // a rejected set carries its reasons; a set no one rejected is "no assay set"
    const rej = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 3))], null, [{ h: 4, reasons: ["side 2, want 8"] }, { h: 5, reasons: ["could not read the set: ENOENT"] }, { h: null, reasons: ["assay.json: not json"] }]);
    expect(entry(rej, 4)).toMatchObject({ outcome: "unavailable", valid: false, why: "set rejected: side 2, want 8" });
    expect(entry(rej, 5).why).toBe("set rejected: could not read the set: ENOENT");
    expect(rej.arms.scaf).toMatchObject({ verdict: true, valid: 4, unavailable: 2 });
    // an analysis that throws makes that set unavailable instead of stopping the stage
    const [s0, ...rest] = await strong(0, 1, 2, 3, 4);
    const boom = { ...s0, get fragments(): R1dPrimeFragment[] { throw new Error("boom"); } };
    const broken = r1dPrimeEvaluate([...ok, boom, ...rest]);
    expect(entry(broken, 0)).toMatchObject({ outcome: "unavailable", valid: false, why: "analysis failed: boom" });
    expect(broken.arms.scaf).toMatchObject({ verdict: true, valid: 4, demonstrated: 4 });
  });

  it("a history that ended before boundary 34 is a valid biological outcome that is not demonstrated", async () => {
    const ok = await controlsOk();
    const runs = [run("scaf", 4, { ended: true, endedAt: 20 }), run("scaf", 5, { ended: true, endedAt: 33 })];
    // 4 demonstrated, 2 ended: 6 valid, 4 of 6 -> true
    const r = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 3))], runs);
    expect(entry(r, 4)).toMatchObject({ outcome: "ended", valid: true, demonstrated: false, n: 0, icc: null });
    expect(entry(r, 4).why).toBe("the run ended at cycle 20, before boundary 34: no pre-cycle state to assay");
    expect(r.arms.scaf).toMatchObject({ verdict: true, valid: 6, demonstrated: 4, ended: 2, unavailable: 0 });
    expect(r.verdict).toBe(true);
    // the same histories without the run records are missing sets: unavailable, 4 valid, still true
    const without = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 3))]);
    expect(without.arms.scaf).toMatchObject({ verdict: true, valid: 4, ended: 0, unavailable: 2 });
    // 3 demonstrated + 3 ended: 6 valid, 3 of 6 -> false (valid, not demonstrated), not uninformative
    const three = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2))], [3, 4, 5].map((i) => run("scaf", i, { ended: true, endedAt: 12 })));
    expect(three.arms.scaf).toMatchObject({ verdict: false, valid: 6, demonstrated: 3, ended: 3 });
    expect(three.verdict).toBe(false);
    // the controls come first all the same
    expect(r1dPrimeEvaluate([...(await strong(0, 1, 2, 3, 12)), ...(await weak(13, 14, 15, 16, 17))], runs).verdict).toBe("uninformative");
    // a history that ended at boundary 34 itself has a pre-cycle state: its set is read (a missing one is unavailable)
    const at34 = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 3))], [run("scaf", 4, { ended: true, endedAt: 34 })]);
    expect(entry(at34, 4)).toMatchObject({ outcome: "unavailable", why: "no assay set" });
    // a run that is not finished explains a missing set, and an unfinished one that did not end is not extinct
    const pending = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 3))], [run("scaf", 4, { status: "unfinished" })]);
    expect(entry(pending, 4)).toMatchObject({ outcome: "unavailable", why: "no assay set (the run is unfinished)" });
    // the rule reads scaf's runs only for scaf: rand's extinction is rand's
    const randEnded = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 3))], [run("rand", 0, { ended: true, endedAt: 3 })]);
    expect(randEnded.arms.rand).toMatchObject({ ended: 1, valid: 1 });
    expect(randEnded.arms.scaf).toMatchObject({ ended: 0, valid: 4 });
  });

  it("fewer than 2 eligible donors is a valid biological outcome that is not demonstrated", async () => {
    const ok = await controlsOk();
    const ins = await dpSetOf({ h: 3, insufficient: true });
    const r = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2)), ins]);
    expect(entry(r, 3)).toMatchObject({ outcome: "donors", valid: true, why: "fewer than 2 eligible donors", demonstrated: false, n: 0 });
    // 4 valid (one with too few donors): informative, 3 demonstrated -> false
    expect(r.arms.scaf).toMatchObject({ verdict: false, valid: 4, demonstrated: 3, donors: 1, unavailable: 2 });
    expect(r.verdict).toBe(false);
    const r2 = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 4)), ins]);
    expect(r2.arms.scaf).toMatchObject({ verdict: true, valid: 5, demonstrated: 4, donors: 1 });
  });

  it("is deterministic", async () => {
    const sets = [...(await controlsOk()), ...(await strong(0, 1)), ...(await weak(2))];
    expect(r1dPrimeEvaluate(sets)).toEqual(r1dPrimeEvaluate(sets));
  });

  it("takes the rule from the arm's own histories", () => {
    const e = (arm: "scaf" | "rand", valid: boolean, demonstrated: boolean, history = 0): R1dPrimeEntry => ({ h: 0, id: "x", arm, control: null, history, outcome: valid ? "analysed" : "unavailable", valid, why: null, n: 0, families: 0, truncatedRows: 0, covariates: [], icc: null, p: null, demonstrated, degenerate: null });
    const four = (arm: "scaf" | "rand") => [0, 1, 2, 3].map((i) => e(arm, true, true, i));
    expect(r1dPrimeVerdict(four("scaf"), "scaf")).toBe(true);
    expect(r1dPrimeVerdict(four("scaf"), "rand")).toBe("uninformative");
    expect(r1dPrimeVerdict([...four("scaf"), e("rand", true, true)], "scaf")).toBe(true);
    expect(r1dPrimeVerdict([...four("scaf").slice(0, 3), e("scaf", true, false)], "scaf")).toBe(false);
    expect(r1dPrimeVerdict([...four("scaf").slice(0, 3), e("scaf", false, false)], "scaf")).toBe("uninformative");
  });
});

describe("R1'' degenerate sets", () => {
  /** A set of 128 fragments that all reach m* at the same census (T = 10,100: never), with the retained B+P and E depending on the donor. */
  const constant = (h: number, T: number) => dpSetOf({ h, cross: () => T, donorCovariates: true });
  const strong = (...hs: number[]) => Promise.all(hs.map((h) => dpKind(h, "strong")));
  const weak = (...hs: number[]) => Promise.all(hs.map((h) => dpKind(h, "weak")));
  const controlsOk = async () => [...(await strong(12, 13)), ...(await weak(14, 15, 16, 17))];

  it("a set whose fragments all have T = 10,100 (or all 100) is analysed as ICC 0, p 1, not demonstrated, flagged degenerate", async () => {
    for (const T of [10_100, 100]) {
      const set = await constant(0, T);
      expect(new Set(set.fragments.map((f) => f.T))).toEqual(new Set([T]));
      expect(new Set(set.fragments.map((f) => f.retMass)).size).toBe(16); // donor-dependent covariates
      const r = r1dPrimeEvaluate([...(await controlsOk()), set]);
      const e = r.histories[0];
      expect(e).toMatchObject({ outcome: "analysed", valid: true, n: 128, families: 16, icc: 0, p: 1, demonstrated: false, degenerate: "constant score" });
      expect(r.arms.scaf).toMatchObject({ valid: 1, demonstrated: 0 });
      const d = r.descriptive.sets.find((x) => x.h === 0)!;
      expect(d).toMatchObject({ n: 128, fractionAt100: T === 100 ? 1 : 0, fractionCensored: T === 10_100 ? 1 : 0, varianceComponent: 0, rawFamilyMeanVariance: 0 });
      // the trait columns are read through the same guard: this fixture's end trait and trait at tau are constant too
      expect(d.atEnd).toMatchObject({ icc: 0, p: 1, demonstrated: false, degenerate: "constant score" });
      expect(d.atTau).toMatchObject({ icc: 0, p: 1, demonstrated: false, degenerate: "constant score" });
    }
  });

  it("is not demonstrated in the rule: constant scaf histories do not count towards the 4 of 6, and are valid", async () => {
    const ok = await controlsOk();
    const six = await Promise.all([0, 1, 2, 3, 4, 5].map((h) => constant(h, 10_100)));
    const none = r1dPrimeEvaluate([...ok, ...six]);
    expect(none.arms.scaf).toMatchObject({ verdict: false, valid: 6, demonstrated: 0 });
    expect(none.verdict).toBe(false);
    expect(none.histories.slice(0, 6).every((x) => x.degenerate === "constant score" && !x.demonstrated)).toBe(true);
    // 4 strong + 2 constant is still 4 of 6; 3 strong + 3 constant is not
    expect(r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2, 3)), six[4], six[5]]).verdict).toBe(true);
    const three = r1dPrimeEvaluate([...ok, ...(await strong(0, 1, 2)), six[3], six[4], six[5]]);
    expect(three.arms.scaf).toMatchObject({ verdict: false, demonstrated: 3 });
    expect(three.histories.map((x) => x.degenerate)).toEqual([null, null, null, "constant score", "constant score", "constant score", null, null, null, null, null, null]);
  });

  it("a constant control can show nothing: a positive one is not demonstrated, a negative one is not tested", async () => {
    const six = await strong(0, 1, 2, 3, 4, 5);
    const positive = r1dPrimeEvaluate([...six, ...(await strong(12)), await constant(13, 10_100), ...(await weak(14, 15, 16, 17))]);
    expect(positive.controls.positive[1]).toMatchObject({ outcome: "analysed", icc: 0, p: 1, demonstrated: false, degenerate: "constant score", tested: false });
    expect(positive.controls.positivePassed).toBe(false);
    expect(positive.verdict).toBe("uninformative");
    const negative = r1dPrimeEvaluate([...six, ...(await strong(12, 13)), ...(await weak(14, 15, 16)), await constant(17, 100)]);
    expect(negative.controls.negative[3]).toMatchObject({ outcome: "analysed", icc: 0, p: 1, significant: false, degenerate: "constant score", tested: false });
    expect(negative.controls.nullGatePassed).toBe(false);
    expect(negative.verdict).toBe("uninformative");
    // the others of its kind stay tested
    expect(negative.controls.negative.slice(0, 3).map((c) => [c.tested, c.degenerate])).toEqual([[true, null], [true, null], [true, null]]);
  });
});

describe("R1'' descriptive output", () => {
  it("reports each set's fractions at T = 100 and T = 10,100, its end trait and trait at tau, the donor variance components and the extinct fragments", async () => {
    // fragments 0-31 cross at the first census, 32-63 are dead ponds (never cross), 64-127 cross by donor
    const cross = (donor: number, u: number, j: number) => (j < 32 ? 100 : j < 64 ? 10_100 : strongCross(donor, u));
    const set = await dpSetOf({ h: 0, cross, dead: (j) => j >= 32 && j < 64 });
    const ok = [...(await Promise.all([12, 13].map((h) => dpKind(h, "strong")))), ...(await Promise.all([14, 15, 16, 17].map((h) => dpKind(h, "weak"))))];
    const r = r1dPrimeEvaluate([...ok, set]);
    const d = r.descriptive.sets.find((x) => x.h === 0)!;
    expect(d).toMatchObject({ id: "scaf-i0", n: 128, fractionAt100: 0.25, fractionCensored: 0.25, extinctFragments: 32 });
    expect(d.varianceComponent).toEqual(expect.any(Number));
    expect(d.rawFamilyMeanVariance).toEqual(expect.any(Number));
    expect(d.meanLogT).toBeCloseTo((32 * Math.log(100) + 32 * Math.log(10_100) + set.fragments.slice(64).reduce((a, fr) => a + Math.log(fr.T), 0)) / 128, 9);
    // the end trait and the trait at tau go through R1's statistic, the R1' way
    expect(Object.keys(d.atEnd)).toEqual(["icc", "p", "demonstrated", "varianceComponent", "rawFamilyMeanVariance", "meanTrait", "saturation", "degenerate"]);
    expect(d.atEnd.degenerate).toBeNull();
    expect(d.atTau!.degenerate).toBeNull();
    expect(d.atTau).not.toBeNull();
    expect(d.atEnd.meanTrait).toBeCloseTo(set.fragments.reduce((a, fr) => a + fr.endTrait, 0) / 128, 9);
    expect(d.atTau!.meanTrait).toBeCloseTo(set.fragments.reduce((a, fr) => a + fr.tauTrait!, 0) / 128, 9);
    // only analysed sets have a descriptive row: the controls have theirs
    expect(r.descriptive.sets.map((x) => x.h)).toEqual([0, 12, 13, 14, 15, 16, 17]);
    expect(r.descriptive.extinction.scaf).toEqual({ histories: 6, ended: 0, donors: 0, fragments: 128, extinctFragments: 32 });
    expect(r.descriptive.extinction.rand).toEqual({ histories: 6, ended: 0, donors: 0, fragments: 0, extinctFragments: 0 });
  });

  it("counts the histories that ended before boundary 34 and those with fewer than 2 donors, per arm", async () => {
    const ins = await dpSetOf({ h: 7, insufficient: true });
    const runs: R1dPrimeRun[] = [{ arm: "scaf", history: 2, dir: "x", status: "finished", ended: true, endedAt: 9 }, { arm: "rand", history: 3, dir: "y", status: "finished", ended: true, endedAt: 33 }];
    const r = r1dPrimeEvaluate([ins], runs);
    expect(r.descriptive.extinction.scaf).toMatchObject({ ended: 1, donors: 0 });
    expect(r.descriptive.extinction.rand).toMatchObject({ ended: 1, donors: 1 });
  });
});

// ---- the CLI end to end for r1dprime ------------------------------------------------------------------

describe("scaffold-report r1dprime", () => {
  const scratch = () => mkdtempSync(join(tmpdir(), "scaffold-r1dprime-"));
  const finished = { ok: true, conservationOk: true, cycles: 34, ended: false, wallSeconds: 1 };
  const runMeta = (arm: "scaf" | "rand", i: number) => ({ tool: "scaffold", arm, k: 8, period: 10_000, cycles: 34, side: 8, seed: 4_811_001 + 100 * (arm === "scaf" ? 0 : 1) + i, mutRate: DP_MUT, init: "clone" });
  const names = (h: number): string => r1dPrimeIdOf(r1dPrimeLabelsOf(h));
  /** Writes sets h = `hs` into `root`: strong for h in `strongs`, otherwise no donor effect. */
  const writeSets = (root: string, hs: number[], strongs: number[]) => {
    for (const h of hs) writeTraitDir(root, names(h), dpFixture({ h, cross: strongs.includes(h) ? strongCross : weakCross }));
  };
  const writeRuns = (root: string, done: (arm: "scaf" | "rand", i: number) => Record<string, unknown> | null = () => finished) => {
    for (const arm of ["scaf", "rand"] as const) for (let i = 0; i < 6; i++) writeRunDir(root, `${arm}-i${i}`, runMeta(arm, i), [], done(arm, i));
  };
  const all = Array.from({ length: 18 }, (_, h) => h);

  it("reads the 18 sets and the run directories: controls, availability and the rule, with the descriptive columns", () => {
    const root = scratch();
    const runs = scratch();
    writeSets(root, all, [0, 1, 2, 3, 12, 13, 6, 7, 8, 9, 10, 11]);
    writeRuns(runs);
    // a set that is not an R1'' set is skipped
    writeTraitDir(root, "tau", tauFixture([5, 12, 20]));
    const out = report("r1dprime", "--assays", root, "--runs", runs, ...["--regime", "8", "10000"]);
    expect(out).toMatchObject({ stage: "r1dprime", verdict: true, regime: { k: 8, period: 10_000 }, skipped: 1, rejected: [] });
    expect(out.controls).toMatchObject({ positivePassed: true, nullGatePassed: true });
    expect(out.controls.positive.map((c: { id: string; demonstrated: boolean }) => [c.id, c.demonstrated])).toEqual([["pos-s0", true], ["pos-s1", true]]);
    expect(out.controls.negative.map((c: { id: string; significant: boolean }) => [c.id, c.significant])).toEqual([["neg-j0", false], ["neg-j1", false], ["neg-j2", false], ["neg-j3", false]]);
    expect(out.arms.scaf).toMatchObject({ verdict: true, valid: 6, demonstrated: 4 });
    expect(out.arms.rand).toMatchObject({ verdict: true, valid: 6, demonstrated: 6 });
    expect(out.histories).toHaveLength(12);
    expect(out.histories[0]).toMatchObject({ id: "scaf-i0", outcome: "analysed", demonstrated: true });
    expect(out.runs).toMatchObject({ loaded: true, skipped: [] });
    expect(out.runs.histories).toHaveLength(12);
    expect(out.descriptive.sets).toHaveLength(18);
    expect(out.descriptive.sets[0]).toMatchObject({ id: "scaf-i0", n: 128, fractionAt100: 0, fractionCensored: 0 });
    expect(out.descriptive.note).toMatch(/fractionAt100/);
    expect(out.sources).toHaveLength(18);
    expect(out.sources[0]).toMatchObject({ h: 0, protocolSha256R1dp: DP_SHA, provenance: { seed: 4_811_001, step: 340_000, mutRate: DP_MUT } });

    // a positive control that is missing, and then one that fails: uninformative either way
    execFileSync("rm", ["-r", join(root, "pos-s1")]);
    const missing = report("r1dprime", "--assays", root, "--runs", runs);
    expect(missing).toMatchObject({ verdict: "uninformative", controls: { positivePassed: false, nullGatePassed: true } });
    expect(missing.controls.positive[1]).toMatchObject({ outcome: "unavailable", why: "no assay set" });
    writeTraitDir(root, "pos-s1", dpFixture({ h: 13, cross: weakCross }));
    expect(report("r1dprime", "--assays", root, "--runs", runs)).toMatchObject({ verdict: "uninformative", controls: { positivePassed: false } });
  });

  it("without --runs a missing set is unavailable; with it, a history that ended before boundary 34 is valid and not demonstrated", () => {
    const root = scratch();
    const runs = scratch();
    // scaf histories 0-3 strong; 4 and 5 ended in their runs (no sets); controls pass
    writeSets(root, [0, 1, 2, 3, 12, 13, 14, 15, 16, 17], [0, 1, 2, 3, 12, 13]);
    writeRuns(runs, (arm, i) => (arm === "scaf" && i >= 4 ? { ok: true, conservationOk: true, cycles: 20 + i, ended: true, endedAt: 20 + i } : finished));
    const without = report("r1dprime", "--assays", root);
    expect(without.runs).toEqual({ loaded: false });
    expect(without.arms.scaf).toMatchObject({ verdict: true, valid: 4, ended: 0, unavailable: 2 });
    const withRuns = report("r1dprime", "--assays", root, "--runs", runs);
    expect(withRuns.arms.scaf).toMatchObject({ verdict: true, valid: 6, demonstrated: 4, ended: 2, unavailable: 0 });
    expect(withRuns.histories[4]).toMatchObject({ outcome: "ended", valid: true });
    expect(withRuns.histories[4].why).toMatch(/ended at cycle 24, before boundary 34/);
    expect(withRuns.descriptive.extinction.scaf).toMatchObject({ ended: 2, donors: 0 });
    // runs that are not fresh-history runs are listed and never read; two runs of one history throw
    writeRunDir(runs, "main-i0", { ...runMeta("scaf", 0), seed: 4_810_001, cycles: 100 }, [], finished);
    const listed = report("r1dprime", "--assays", root, "--runs", runs).runs.skipped;
    expect(listed).toHaveLength(1);
    expect(listed[0].dir).toBe(join(runs, "main-i0"));
    expect(listed[0].why).toMatch(/seed 4810001 is not 4811001/);
    writeRunDir(runs, "scaf-i0-again", runMeta("scaf", 0), [], finished);
    expect(() => report("r1dprime", "--assays", root, "--runs", runs)).toThrow(/two runs are history scaf-i0/);
  });

  it("reports a set with constant scores as degenerate: ICC 0, p 1, not demonstrated", () => {
    const root = scratch();
    writeTraitDir(root, "scaf-i0", dpFixture({ h: 0, cross: () => 10_100, donorCovariates: true }));
    writeTraitDir(root, "pos-s0", dpFixture({ h: 12, cross: strongCross }));
    const out = report("r1dprime", "--assays", root);
    expect(out.rejected).toEqual([]);
    expect(out.histories[0]).toMatchObject({ id: "scaf-i0", outcome: "analysed", icc: 0, p: 1, demonstrated: false, degenerate: "constant score" });
    expect(out.controls.positive[0]).toMatchObject({ id: "pos-s0", demonstrated: true, degenerate: null });
    expect(out.descriptive.sets.find((d: { h: number }) => d.h === 0)).toMatchObject({ fractionCensored: 1, varianceComponent: 0 });
  });

  it("rejects a b34-post checkpoint (the same seed, mutation rate and step as b34-pre) by its name and by its content", () => {
    const root = scratch();
    const at = (name: string, source: string, phase: R1dPrimeProvenance["phase"]) => {
      const f = dpFixture({ h: 0, cross: strongCross, json: { source, provenance: { ...dpProvenance(0), source, phase } } });
      writeTraitDir(root, name, f);
    };
    at("by-name", "runs/scaffold/rep/main/scaf/i0/ckpt/b34-post.blck.gz", dpProvenance(0).phase);
    const out = report("r1dprime", "--assays", root);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].reasons.join(" ")).toMatch(/does not end in ckpt\/b34-pre\.blck\.gz/);
    expect(out.histories[0]).toMatchObject({ outcome: "unavailable", valid: false });
    const content = scratch();
    writeTraitDir(content, "by-content", dpFixture({ h: 0, cross: strongCross, json: { provenance: { ...dpProvenance(0), phase: { totalC: 0, totalS: 0, carrying: 2014, outsideWindow: 0, postCycle: true } } } }));
    const post = report("r1dprime", "--assays", content);
    expect(post.rejected[0].reasons.join(" ")).toMatch(/looks post-cycle \(C 0, S 0; 0 of 2014 cells/);
    expect(post.histories[0].why).toMatch(/^set rejected: .*looks post-cycle/);
    // --allow-any-seed waives it (smoke runs)
    expect(report("r1dprime", "--assays", content, "--allow-any-seed").rejected).toEqual([]);
  });

  it("is uninformative when 2 of the 4 negative controls are significant, though every scaf history is demonstrated", () => {
    const root = scratch();
    writeSets(root, all, [0, 1, 2, 3, 4, 5, 12, 13, 14, 15]);
    const out = report("r1dprime", "--assays", root);
    expect(out.controls.negative.map((c: { significant: boolean }) => c.significant)).toEqual([true, true, false, false]);
    expect(out).toMatchObject({ verdict: "uninformative", controls: { positivePassed: true, nullGatePassed: false } });
    expect(out.arms.scaf).toMatchObject({ verdict: true, demonstrated: 6 });
  });

  it("a missing, malformed or incomplete set becomes unavailable with its reason while the others continue", () => {
    const root = scratch();
    writeSets(root, all, [0, 1, 2, 3, 4, 5, 12, 13]);
    expect(report("r1dprime", "--assays", root)).toMatchObject({ verdict: true, rejected: [] });
    // scaf-i0: no assay.tsv; scaf-i1: a non-numeric trait; scaf-i2: a smoke-sized set; the other three still give the verdict
    execFileSync("rm", [join(root, "scaf-i0", "assay.tsv")]);
    const f1 = dpFixture({ h: 1, cross: strongCross });
    writeTraitDir(root, "scaf-i1", { ...f1, traitsText: f1.traitsText.replace("0\t0\t100\t", "0\t0\t100\tx") });
    writeTraitDir(root, "scaf-i2", dpFixture({ h: 2, cross: strongCross, json: { side: 2 } }));
    const three = report("r1dprime", "--assays", root);
    expect(three.arms.scaf).toMatchObject({ verdict: "uninformative", valid: 3, demonstrated: 3, unavailable: 3 });
    expect(three.verdict).toBe("uninformative");
    expect(three.rejected.map((r: { h: number | null }) => r.h).sort()).toEqual([0, 1, 2]);
    expect(three.histories[0].why).toMatch(/^set rejected: could not read the set/);
    expect(three.histories[1].why).toMatch(/^set rejected: could not read the set.*not a number/);
    expect(three.histories[2].why).toMatch(/^set rejected: .*side 2, want 8/);
    // an unreadable assay.json is reported too, with no h to attribute it to; a missing traits.tsv is an incomplete set
    writeFileSync(join(root, "scaf-i3", "assay.json"), "{ not json");
    execFileSync("rm", [join(root, "scaf-i4", "traits.tsv")]);
    const more = report("r1dprime", "--assays", root);
    expect(more.rejected.find((r: { h: number | null }) => r.h === null).reasons[0]).toMatch(/^assay\.json:/);
    expect(more.histories[4].why).toMatch(/no traits\.tsv/);
    expect(more.arms.scaf.valid).toBe(1);
  });

  it("--allow-any-seed reads a smoke-sized set (4 ponds x 1 replicate) without crashing, and the verdict is uninformative", () => {
    const root = scratch();
    writeTraitDir(root, "smoke", smallOf(dpFixture({ h: 12, cross: strongCross, json: { side: 2, replicates: 1, seeds: [{ physics: 1, fragment: 1 }], donorSeed: 2, provenance: undefined, protocolSha256R1dp: undefined } })));
    const strict = report("r1dprime", "--assays", root);
    expect(strict.rejected).toHaveLength(1);
    expect(strict.verdict).toBe("uninformative");
    const smoke = report("r1dprime", "--assays", root, "--allow-any-seed");
    expect(smoke.rejected).toEqual([]);
    expect(smoke.verdict).toBe("uninformative");
    expect(smoke.controls.positive[0]).toMatchObject({ h: 12, outcome: "analysed", n: 4 });
    expect(smoke.controls.positivePassed).toBe(false);
    expect(smoke.sources[0]).toMatchObject({ h: 12, provenance: null, protocolSha256R1dp: null });
  });

  it("the other stages skip R1'' directories and read exactly what they read without them", () => {
    // R1, R2 and R3 (regime k 5 / period 3000), calibrate, tau and R1' (its own regimes) in one root
    const root = scratch();
    for (const i of [0, 1, 2]) writeAssayDir(root, `r1-h${i}`, scafR1(i));
    writeAssayDir(root, "r2-frag", assayDirFixture({ assay: "garden", flags: { arm: "scaf", history: "0", time: "0" }, seed: assaySeed(2, 0, 0, 0, 0), dir: "g" }));
    for (const [n, dir] of [[1, "cal-anc"], [2, "cal-que"]] as const) {
      writeAssayDir(root, dir, assayDirFixture({ assay: "competence", flags: { arm: "ancestor", timing: "a", calibration: String(n) as "1" | "2" }, inoculum: n === 1 ? "fragment" : "quenched", seed: 4_802_011, k: 5, period: 3000, dir, success: (i) => (i < 64 ? 1 : 0) }));
    }
    writeTraitDir(root, "tau-cal", frozenTau());
    for (const i of [0, 1, 2, 3]) writeTraitDir(root, `prime-${i}`, primeFixture({ i }));
    const p1Json = join(root, "p1.json");
    writeFileSync(p1Json, JSON.stringify({ stage: "p1", verdict: true, choice: { stage: "primary", chosen: { k: 5, period: 3000 }, candidate: { k: 5, period: 3000 }, primaryComplete: true, fallbackComplete: false, verdict: true, passing: [{ k: 5, period: 3000 }] } }));
    const tau = join(root, "tau.json");
    const { source, ref, k, period, side, replicates, seeds, labels } = frozenTau().json;
    writeFileSync(tau, JSON.stringify({ stage: "tau", verdict: null, validated: true, provenance: { source, ref, k, period, side, replicates, seeds, labels }, tau: PRIME_TAU }));
    const replay = join(root, "replay-check.json");
    writeFileSync(replay, JSON.stringify({ mechanismCheck: { passed: true }, valid: [0, 1, 2, 3, 4, 5].map((i) => `scaf-i${i}-t0`), failed: [] }));
    const stages = (): Record<string, any> => ({
      r1: report("r1", "--assays", root, "--regime", "5", "3000"),
      r2: report("r2", "--assays", root, "--regime", "5", "3000"),
      r3: report("r3", "--assays", root, "--regime", "5", "3000"),
      calibrate: report("calibrate", "--p1", p1Json, "--assays", root),
      tau: report("tau", "--assays", root, "--regime", "8", "10000"),
      r1prime: report("r1prime", "--assays", root, "--tau", tau, "--regime", "8", String(PRIME_PERIOD), "--replay", replay),
    });
    const before = stages();
    // the stages do read something here
    expect(before.r1.histories).toHaveLength(3);
    expect(before.tau).toMatchObject({ validated: true, tau: 2600 });
    expect(before.r1prime.arms.scaf).toMatchObject({ valid: 4 });
    expect(before.calibrate.regimes.length).toBeGreaterThan(0);
    // R1'' sets of every kind (fresh histories, controls) beside them
    const added = [0, 1, 6, 12, 14];
    writeSets(root, added, [0, 12]);
    const after = stages();
    for (const stage of Object.keys(before)) expect({ stage, ...after[stage], skipped: 0 }).toEqual({ stage, ...before[stage], skipped: 0 });
    for (const stage of ["r1", "r2", "r3", "calibrate"]) expect(after[stage].skipped).toBe(before[stage].skipped + added.length);
    // tau and r1prime skip anything that is not theirs, so the new sets are counted there too
    for (const stage of ["tau", "r1prime"]) expect(after[stage].skipped).toBe(before[stage].skipped + added.length);
    // and the new stage skips theirs
    // and the new stage skips theirs: 3 R1 sets, 1 R2, 2 calibrations, the tau calibration and 4 R1' sets
    const dp = report("r1dprime", "--assays", root);
    expect(dp.skipped).toBe(11);
    expect(dp.histories.filter((x: { outcome: string }) => x.outcome === "analysed")).toHaveLength(3);
  });
});

// ---- the R3 replication (docs/scaffold-r3-replication-v1.md) ---------------------------------------

const RR_V1 = "1".repeat(64); // protocol v1's SHA-256, as a run's meta.json records it
const RR_SHA = "3".repeat(64); // the replication protocol's
const RR_SHAS = { protocol: RR_V1, r3rep: RR_SHA };
/** A root no test machine has, so the CLI cannot reach (or re-hash) the recorded checkpoints. */
const RR_ROOT = "/nonexistent-r3rep-fixture/runs/scaffold";
const RR_DOMINANT = r3RepDominantRecord({ hi: 7, lo: 42, words: new Uint32Array(GENOME_CHANNELS).fill(0xab) })!;

/** State hashes by h, for fixtures whose recorded checkpoints are real (`writeCheckpoints`); any other h records a made-up one. */
type RrHashes = Readonly<Record<number, string>>;

/** A timing (a) source of h as the assay records it: b100-pre (b1-pre for the ancestor), or the terminal b<e>-pre of a history that ended at e. */
function rrOrigin(h: number, endedAt?: number, root = RR_ROOT, sha = RR_V1, hashes: RrHashes = {}): R3RepOrigin {
  const l = r3RepHistoryOf(h);
  const ancestor = l.arm === "ancestor";
  const N = endedAt ?? (ancestor ? 1 : 100);
  const seed = r3RepWorldSeedOf(h);
  return {
    source: `${root}/${r3RepRunDirOf(h)}/ckpt/b${N}-pre.blck.gz`,
    stateHash: hashes[h] ?? `a${h}`.padEnd(16, "0"),
    seed,
    mutRate: DP_MUT,
    step: N * 10_000,
    tilesX: 8,
    tilesY: 8,
    run: {
      meta: { arm: ancestor ? "cont" : l.arm, k: l.arm === "scaf" || l.arm === "rand" ? 8 : 0, period: 10_000, cycles: ancestor ? 1 : 100, side: 8, seed, mutRate: DP_MUT, init: "clone", censusEvery: 100, protocolSha256: sha },
      done: endedAt === undefined ? { ok: true, conservationOk: true, cycles: ancestor ? 1 : 100, ended: false } : { ok: true, conservationOk: true, cycles: endedAt, ended: true, endedAt },
    },
  };
}

/** The provenance the assay records for a set: the timing (a) origin (the ancestor's for Ge-on-Fa), or the continuation with its sidecar; Ge-on-Fa's donor. */
function rrProvenance(labels: R3RepLabelSet, inoculum: R3RepInoculum, o: { endedAt?: number; dominant?: R3RepDominant | null; root?: string; sha?: typeof RR_SHAS; hashes?: RrHashes } = {}): R3RepProvenance {
  const root = o.root ?? RR_ROOT;
  const sha = o.sha ?? RR_SHAS;
  let p: R3RepProvenance;
  if (labels.timing === "a") p = rrOrigin(r3RepSeedHOf(labels, inoculum), inoculum === "swap-ea" ? undefined : o.endedAt, root, sha.protocol, o.hashes);
  else {
    const from = rrOrigin(labels.h, o.endedAt, root, sha.protocol, o.hashes);
    const end = { source: `${root}/${r3RepContinuationPathOf(labels.h)}`, stateHash: `e${labels.h}`.padEnd(16, "0"), seed: r3RepContinueSeed(labels.h), mutRate: DP_MUT, step: from.step + 200_000, tilesX: 8, tilesY: 8 };
    p = { ...end, continuation: r3RepContinuationOf({ h: labels.h, origin: from, end, steps: 200_000, protocolSha256R3rep: sha.r3rep }), origin: from };
  }
  if (inoculum === "swap-ea") p.donor = { ...rrOrigin(labels.h, o.endedAt, root, sha.protocol, o.hashes), dominant: o.dominant === undefined ? RR_DOMINANT : o.dominant };
  return p;
}

interface RrFixture {
  json: Record<string, unknown>;
  rows: AssayRow[];
  text: string;
}

/** Successes out of 128 by default: scaf 0.8, rand and cont 0.3, the ancestor 0.4, Ge-on-Fa 0.6, Ga-on-Fe 0.1, quenched 0 (decisive in every history, swap margin +0.5). */
const rrDefault = (labels: R3RepLabelSet, inoculum: R3RepInoculum): number =>
  inoculum === "quenched" ? 0 : inoculum === "swap-ea" ? 77 : inoculum === "swap-ae" ? 13 : labels.arm === "scaf" ? 102 : labels.arm === "ancestor" ? 51 : 38;

/** The `swap` competence --r3rep records for a variant: Ge-on-Fa its donor's dominant genome (words null for the biological record), Ga-on-Fe M3_FOUNDERS[2]. */
function rrSwap(inoculum: R3RepInoculum, provenance: R3RepProvenance): Record<string, unknown> | null {
  if (inoculum === "swap-ae") return { label: "swap-ae", from: "M3_FOUNDERS[2]", words: R3REP_SWAP_AE_WORDS };
  if (inoculum !== "swap-ea") return null;
  const d = provenance.donor!;
  return d.dominant === null ? { label: "swap-ea", from: d.source, words: null } : { label: "swap-ea", from: `${d.source} (dominant ${d.dominant.id})`, words: d.dominant.words };
}

/**
 * One set as `competence --r3rep` writes it: 128 rows of `inoculum` (replicate 0 then 1, 64 ponds), the first `successes` succeeding
 * (or `success(j)`), the protocol's regime, seeds, treatment and provenance. `biological` writes Ge-on-Fa's record instead (no rows, donor with no dominant genome).
 */
function rrFixture(h: number, timing: "a" | "b", inoculum: R3RepInoculum, o: { successes?: number; success?: (j: number) => number; biological?: boolean; endedAt?: number; root?: string; sha?: typeof RR_SHAS; hashes?: RrHashes; json?: Record<string, unknown> } = {}): RrFixture {
  const labels = r3RepLabelsOf(h, timing);
  const sha = o.sha ?? RR_SHAS;
  const provenance = rrProvenance(labels, inoculum, { endedAt: o.endedAt, dominant: o.biological ? null : undefined, root: o.root, sha, hashes: o.hashes });
  const successes = o.successes ?? rrDefault(labels, inoculum);
  const n = o.biological ? 0 : 128;
  const success = o.success ?? ((j: number) => (j < successes ? 1 : 0));
  const rows = Array.from({ length: n }, (_, j) => fragRow({ assay: "competence", replicate: j >= 64 ? 1 : 0, pond: j % 64, inoculum, retMass: 90 + (j % 7), retE: 180 + (j % 5), truncated: 0, endTrait: success(j) ? 120_000 : 100, success: success(j) }));
  const json = JSON.parse(
    JSON.stringify({
      ...assayJson({
        ...BASE_JSON,
        protocolSha256: sha.protocol,
        assay: "competence",
        source: provenance.source,
        tag: r3RepIdOf(labels),
        k: 8,
        period: 10_000,
        ref: 103_058,
        side: 8,
        replicates: 2,
        inoculum,
        seeds: [0, 1].map((s) => ({ physics: r3RepSeedOf(labels, inoculum, s), fragment: r3RepSeedOf(labels, inoculum, s) })),
        labels,
        extra: { quench: inoculum === "quenched", swap: rrSwap(inoculum, provenance), provenance, protocolSha256R3rep: sha.r3rep, ...(o.biological ? { biologicallyUnavailable: r3RepUnavailableOf(provenance.donor!) } : {}) },
        summary: { rows: n },
      }),
      ...o.json,
    }),
  ) as Record<string, unknown>;
  const planted = (r: AssayRow): Planted => ({ reqMass: r.retMass, retMass: r.retMass, reqE: r.retE ?? 0, retE: r.retE ?? 0, landed: 9, truncated: false });
  const text = [ASSAY_COLUMNS.join("\t"), ...rows.map((r) => assayLine({ assay: "competence", source: "t", replicate: r.replicate, pond: r.pond, family: -1, inoculum, planted: planted(r), endTrait: r.endTrait, success: r.success }))].join("\n") + "\n";
  return { json, rows, text };
}

/** The 62 sets of the replication by id, with `over` changing (or `drop` leaving out) any of them. */
function rrWorld(o: { over?: Record<string, Parameters<typeof rrFixture>[3]>; drop?: string[]; root?: string; sha?: typeof RR_SHAS; hashes?: RrHashes } = {}): Map<string, RrFixture> {
  const out = new Map<string, RrFixture>();
  for (const { labels, inoculum } of r3RepExpectedSets()) {
    const id = r3RepSetIdOf(labels, inoculum);
    if (o.drop?.includes(id)) continue;
    out.set(id, rrFixture(labels.h, labels.timing, inoculum, { root: o.root, sha: o.sha, hashes: o.hashes, ...o.over?.[id] }));
  }
  return out;
}

const rrDir = (id: string, f: RrFixture) => ({ dir: id, json: f.json, rows: f.rows });

/** A recorded checkpoint's record, without its run directory or dominant genome. */
const rrRecord = (x: R3RepCheckpoint): R3RepCheckpoint => ({ source: x.source, stateHash: x.stateHash, seed: x.seed, mutRate: x.mutRate, step: x.step, tilesX: x.tilesX, tilesY: x.tilesY });

/**
 * What a reader that reached every checkpoint the sets `fs` record would reload: each as recorded, a donor with its recorded dominant
 * genome (none for a biological record), so a biological record is verified.
 */
function rrReloaded(...fs: RrFixture[]): Map<string, R3RepReload> {
  const out = new Map<string, R3RepReload>();
  for (const f of fs) {
    const p = f.json.provenance as R3RepProvenance;
    for (const x of [p, p.origin]) if (x && !out.has(x.source)) out.set(x.source, { record: rrRecord(x), dominant: null });
    if (p.donor) out.set(p.donor.source, { record: rrRecord(p.donor), dominant: p.donor.dominant });
  }
  return out;
}

/** Screens `world` (strict unless said) with the checkpoints `reloaded` holds, and evaluates it, with the rejected sets carried into availability. */
function rrEvaluate(world: Map<string, RrFixture>, extra: { dir: string; json: Record<string, unknown>; rows: AssayRow[] }[] = [], reloaded?: ReadonlyMap<string, R3RepReload>) {
  const screened = r3RepScreen([...[...world].map(([id, f]) => rrDir(id, f)), ...extra], { sha: RR_SHAS, reloaded });
  return { screened, ...r3RepEvaluate(screened.accepted, screened.rejected) };
}

describe("R3 replication screening", () => {
  const screenOne = (f: RrFixture, o: Partial<Parameters<typeof r3RepScreen>[1]> = {}) => {
    const r = r3RepScreen([rrDir("d", f)], { sha: RR_SHAS, ...o });
    return { ...r, reasons: r.rejected.flatMap((x) => x.reasons).join(" | ") };
  };

  it("accepts the 62 protocol sets, every variant, with the recorded checkpoints it could not reach listed as unverifiable", () => {
    const r = r3RepScreen([...rrWorld()].map(([id, f]) => rrDir(id, f)), { sha: RR_SHAS });
    expect(r.rejected).toEqual([]);
    expect(r.accepted.map((s) => s.id)).toEqual(r3RepExpectedSets().map(({ labels, inoculum }) => r3RepSetIdOf(labels, inoculum)));
    const ea = r.accepted.find((s) => s.id === "scaf-i2-a-swap-ea")!;
    expect(ea).toMatchObject({ labels: { arm: "scaf", history: 2, timing: "a", h: 2 }, inoculum: "swap-ea", biological: false, ref: 103_058 });
    expect(ea.unverifiable).toEqual([`source ${RR_ROOT}/r3rep/anc/ckpt/b1-pre.blck.gz`, `donor ${RR_ROOT}/r3rep/main/scaf/i2/ckpt/b100-pre.blck.gz`]);
    expect(r.accepted.find((s) => s.id === "cont-i3-b")!.unverifiable).toEqual([`source ${RR_ROOT}/r3rep/cont200k/cont-i3.blck.gz`, `continuation source ${RR_ROOT}/r3rep/main/cont/i3/ckpt/b100-pre.blck.gz`]);
    // an ended history's terminal pre-cycle state is its source, at (a) and through its continuation at (b)
    for (const timing of ["a", "b"] as const) expect(screenOne(rrFixture(4, timing, "fragment", { endedAt: 61 })).rejected).toEqual([]);
  });

  it("checks the seeds against the formula, with Ge-on-Fa on the ancestor's h = 18", () => {
    const at = (seed: number) => [0, 1].map((s) => ({ physics: seed + s, fragment: seed + s }));
    expect(screenOne(rrFixture(3, "a", "swap-ea", { json: { seeds: at(r3RepSeed(3, 0, 0)) } })).reasons).toMatch(/want r3RepSeed\(18, 0, 0\) = 4818101/);
    expect(screenOne(rrFixture(3, "a", "swap-ea", { json: { seeds: at(r3RepSeed(18, 0, 0)) } })).rejected).toEqual([]);
    expect(screenOne(rrFixture(3, "a", "swap-ae", { json: { seeds: at(r3RepSeed(18, 0, 0)) } })).reasons).toMatch(/want r3RepSeed\(3, 0, 0\) = 4816601/);
    expect(screenOne(rrFixture(8, "b", "fragment", { json: { seeds: at(r3RepSeed(8, 0, 0)) } })).reasons).toMatch(/want r3RepSeed\(8, 1, 0\)/);
    expect(screenOne(rrFixture(8, "b", "fragment", { json: { seeds: [{ physics: r3RepSeed(8, 1, 0), fragment: r3RepSeed(8, 1, 1) }, { physics: r3RepSeed(8, 1, 1), fragment: r3RepSeed(8, 1, 1) }] } })).reasons).toMatch(/fragment seed 4817112/);
    expect(screenOne(rrFixture(8, "b", "fragment", { json: { seeds: at(r3RepSeed(8, 1, 0)).slice(0, 1) } })).reasons).toMatch(/1 seeds, want 2/);
    // the quenched control and Ga-on-Fe share their scaf source's seeds (common random numbers)
    expect(screenOne(rrFixture(0, "b", "quenched", { json: { seeds: at(r3RepSeed(0, 1, 0)) } })).rejected).toEqual([]);
  });

  it("rejects the wrong regime, protocol hash, labels or variant, with the reasons", () => {
    const f = (json: Record<string, unknown>, h = 1, timing: "a" | "b" = "a", inoculum: R3RepInoculum = "fragment") => screenOne(rrFixture(h, timing, inoculum, { json }));
    expect(f({ k: 5 }).reasons).toMatch(/k 5, want 8/);
    expect(f({ period: 3000 }).reasons).toMatch(/period 3000, want 10000/);
    expect(f({ ref: 40 }).reasons).toMatch(/ref 40, want 103058/);
    expect(f({ censusEvery: 50 }).reasons).toMatch(/censusEvery 50, want 100/);
    expect(f({ side: 4 }).reasons).toMatch(/side 4, want 8/);
    expect(f({ replicates: 1 }).reasons).toMatch(/replicates 1, want 2/);
    expect(f({ protocolSha256R3rep: "4".repeat(64) }).reasons).toMatch(/protocolSha256R3rep "4{64}" is not the pinned SHA-256 of docs\/scaffold-r3-replication-v1\.md/);
    expect(f({ protocolSha256R3rep: undefined }).reasons).toMatch(/protocolSha256R3rep undefined/);
    expect(f({ assay: "garden" }).reasons).toMatch(/assay "garden", want competence/);
    // labels that are not this block's: no id to attribute them to
    const noLabel = f({ labels: { arm: "scaf", history: 1, timing: "a", h: 1 } });
    expect(noLabel.rejected[0]).toMatchObject({ id: null, reasons: ["labels.r3rep is not true"] });
    expect(f({ labels: { arm: "rand", history: 1, timing: "a", r3rep: true, h: 1 } }).reasons).toMatch(/labels\.arm "rand", want "scaf" for h 1/);
    expect(f({ labels: { arm: "scaf", history: 1, timing: "c", r3rep: true, h: 1 } }).reasons).toMatch(/labels\.timing "c"/);
    // variants the protocol does not have
    expect(f({}, 7, "a", "quenched").reasons).toMatch(/quenched labels a scaf history, not rand/);
    expect(f({}, 1, "b", "swap-ae").reasons).toMatch(/swap-ae runs at timing a only/);
    expect(f({ inoculum: "disc" }).reasons).toMatch(/inoculum "disc"/);
    // a rejected set keeps its id, so the stage can say why that set is unavailable
    expect(f({ side: 4 }).rejected[0].id).toBe("scaf-i1-a");
  });

  it("rejects a source that is not the protocol's: path, seed, step, protocol hash, ended history, continuation", () => {
    const labels = r3RepLabelsOf(0, "a");
    const prov = (over: Record<string, unknown>, timing: "a" | "b" = "a", h = 0) => {
      const p = { ...rrProvenance(r3RepLabelsOf(h, timing), "fragment"), ...over };
      return screenOne(rrFixture(h, timing, "fragment", { json: { provenance: p, source: p.source } })).reasons;
    };
    expect(prov({ seed: 4_811_002 })).toMatch(/source seed 4811002, want 4811001/);
    expect(prov({ step: 990_000 })).toMatch(/source step 990000, want 1000000/);
    expect(prov({ mutRate: 0 })).toMatch(/source mutRate 0, want 429497/);
    expect(prov({ source: `${RR_ROOT}/r3rep/main/scaf/i0/ckpt/b100-post.blck.gz` })).toMatch(/does not end in r3rep\/main\/scaf\/i0\/ckpt\/b<N>-pre\.blck\.gz/);
    expect(prov({ source: `${RR_ROOT}/rep/main/scaf/i0/ckpt/b100-pre.blck.gz` })).toMatch(/does not end in r3rep\/main\/scaf\/i0/);
    // b<N>-pre with N < 100 is the source only of a history that ended there
    expect(prov({ source: `${RR_ROOT}/r3rep/main/scaf/i0/ckpt/b61-pre.blck.gz`, step: 610_000 })).toMatch(/b61-pre, but the history did not end/);
    const ended = rrOrigin(0, 61);
    expect(prov({ ...ended, run: { ...ended.run, done: { ...ended.run.done, endedAt: 60 } } })).toMatch(/ended at boundary 60, but the source is b61-pre/);
    expect(prov({ run: { ...rrOrigin(0).run, meta: { ...rrOrigin(0).run.meta, protocolSha256: "f".repeat(64) } } })).toMatch(/run meta\.json protocolSha256 "f{64}", want "1{64}"/);
    expect(prov({ run: { meta: null, done: null } })).toMatch(/not inside a run directory with a readable meta\.json/);
    // the provenance is of the assay's own source
    const own = rrProvenance(labels, "fragment");
    expect(screenOne(rrFixture(0, "a", "fragment", { json: { source: "elsewhere.blck.gz", provenance: own } })).reasons).toMatch(/provenance\.source ".*b100-pre\.blck\.gz" is not the assay's source "elsewhere\.blck\.gz"/);
    expect(screenOne(rrFixture(0, "a", "fragment", { json: { provenance: undefined } })).reasons).toMatch(/no provenance of its source/);
    // timing (b): the continuation's sidecar must name this history's (a) source, its seed and 2 x 10^5 steps
    const b = rrProvenance(r3RepLabelsOf(13, "b"), "fragment") as R3RepProvenance & { continuation: Record<string, unknown> };
    expect(prov({ continuation: { ...b.continuation, seed: 4_818_300 } }, "b", 13)).toMatch(/continuation seed 4818300, want 4818314/);
    expect(prov({ continuation: { ...b.continuation, steps: 100_000, endStep: b.step - 100_000 } }, "b", 13)).toMatch(/continuation steps 100000, want 200000/);
    expect(prov({ continuation: undefined }, "b", 13)).toMatch(/no continuation sidecar/);
    expect(prov({ source: `${RR_ROOT}/r3rep/cont200k/cont-i2.blck.gz` }, "b", 13)).toMatch(/does not end in r3rep\/cont200k\/cont-i1\.blck\.gz/);
    // Ge-on-Fa names the labelled scaf history as its donor, with a dominant-genome record
    const ea = rrProvenance(r3RepLabelsOf(2, "a"), "swap-ea");
    const eaWith = (donor: unknown) => screenOne(rrFixture(2, "a", "swap-ea", { json: { provenance: { ...ea, donor } } })).reasons;
    expect(eaWith(rrOrigin(3))).toMatch(/donor seed 4811004, want 4811003/);
    expect(eaWith({ ...ea.donor, dominant: { id: "1:2" } })).toMatch(/is not a dominant genome record/);
  });

  it("rejects an assay.tsv that does not fill the grid with the variant's rows", () => {
    const f = rrFixture(0, "a", "fragment");
    expect(screenOne({ ...f, rows: f.rows.slice(1) }).reasons).toBe("127 rows, want 128");
    expect(screenOne({ ...f, rows: f.rows.map((r, j) => (j === 5 ? { ...r, pond: 0 } : r)) }).reasons).toBe("assay.tsv repeats a (replicate, pond) in 1 rows");
    expect(screenOne({ ...f, rows: f.rows.map((r, j) => (j === 5 ? { ...r, replicate: 2 } : r)) }).reasons).toMatch(/1 rows outside the 2 x 64/);
    expect(screenOne({ ...f, rows: f.rows.map((r, j) => (j < 3 ? { ...r, inoculum: "quenched" } : r)) }).reasons).toBe("3 assay.tsv rows are not fragment rows");
    expect(screenOne({ ...f, rows: f.rows.map((r, j) => (j < 2 ? { ...r, success: -1 } : r)) }).reasons).toBe("2 assay.tsv rows have no success flag (0 or 1)");
    expect(screenOne({ ...f, rows: f.rows.map((r, j) => (j < 1 ? { ...r, assay: "garden" } : r)) }).reasons).toBe("1 assay.tsv rows are not competence rows");
    expect(screenOne({ ...f, json: { ...f.json, ref: null } }).reasons).toMatch(/ref null: competence needs a positive ref/);
  });

  it("re-hashes every recorded checkpoint it can reach, and lists the others as unverifiable", () => {
    const f = rrFixture(2, "b", "fragment");
    const p = f.json.provenance as R3RepProvenance;
    const record = (x: R3RepCheckpoint): R3RepCheckpoint => ({ source: x.source, stateHash: x.stateHash, seed: x.seed, mutRate: x.mutRate, step: x.step, tilesX: x.tilesX, tilesY: x.tilesY });
    const both = new Map<string, R3RepReload>([[p.source, { record: record(p), dominant: null }], [p.origin!.source, { record: record(p.origin!), dominant: RR_DOMINANT }]]);
    const ok = screenOne(f, { reloaded: both });
    expect(ok.rejected).toEqual([]);
    expect(ok.accepted[0].unverifiable).toEqual([]);
    // only the continued checkpoint reachable
    expect(screenOne(f, { reloaded: new Map([...both].slice(0, 1)) }).accepted[0].unverifiable).toEqual([`continuation source ${p.origin!.source}`]);
    // a checkpoint that changed since the assay, or that no longer reads
    const changed = new Map(both).set(p.origin!.source, { record: { ...record(p.origin!), stateHash: "ffffffffffffffff" }, dominant: null });
    expect(screenOne(f, { reloaded: changed }).reasons).toMatch(/^continuation source .*b100-pre\.blck\.gz has stateHash "ffffffffffffffff" now, but the assay recorded "a2000000/);
    const moved = new Map(both).set(p.source, { record: { ...record(p), step: 1_000_000 }, dominant: null });
    expect(screenOne(f, { reloaded: moved }).reasons).toMatch(/^source .*scaf-i2\.blck\.gz has step 1000000 now, but the assay recorded 1200000/);
    expect(screenOne(f, { reloaded: new Map(both).set(p.source, { error: "incorrect header check" }) }).reasons).toMatch(/source .* could not be read: incorrect header check/);
    // Ge-on-Fa's donor must still give the recorded dominant genome
    const ea = rrFixture(2, "a", "swap-ea");
    const donor = (ea.json.provenance as R3RepProvenance).donor!;
    const other = r3RepDominantRecord({ hi: 7, lo: 43, words: new Uint32Array(GENOME_CHANNELS) });
    expect(screenOne(ea, { reloaded: new Map([[donor.source, { record: record(donor), dominant: RR_DOMINANT }]]) }).rejected).toEqual([]);
    expect(screenOne(ea, { reloaded: new Map([[donor.source, { record: record(donor), dominant: other }]]) }).reasons).toMatch(/donor .* has dominant genome 7:43, but the assay recorded 7:42/);
    expect(screenOne(ea, { reloaded: new Map([[donor.source, { record: record(donor), dominant: null }]]) }).reasons).toMatch(/has dominant genome none \(no eligible cell\), but the assay recorded 7:42/);
  });

  it("accepts a biological Ge-on-Fa record only for swap-ea, and only if its checkpoints are reachable and its donor indeed has no dominant genome", () => {
    const f = rrFixture(1, "a", "swap-ea", { biological: true, endedAt: 37 });
    const p = f.json.provenance as R3RepProvenance;
    const donor = p.donor!;
    const unreachable = "a biologically unavailable record needs its checkpoints verified, but these are not reachable from here: ";
    // reachable, and the donor with no eligible cell: verified
    const near = screenOne(f, { reloaded: rrReloaded(f) });
    expect(near.rejected).toEqual([]);
    expect(near.accepted[0]).toMatchObject({ id: "scaf-i1-a-swap-ea", biological: true, ref: null, rows: [], unverifiable: [] });
    // strict mode never takes "no dominant genome" from the record alone: an unreachable donor, or source, rejects it
    expect(screenOne(f).reasons).toBe(`${unreachable}source ${RR_ROOT}/r3rep/anc/ckpt/b1-pre.blck.gz; donor ${donor.source}`);
    expect(screenOne(f, { reloaded: new Map([[p.source, { record: rrRecord(p), dominant: null }]]) }).reasons).toBe(`${unreachable}donor ${donor.source}`);
    expect(screenOne(f, { reloaded: new Map([[donor.source, { record: rrRecord(donor), dominant: null }]]) }).reasons).toBe(`${unreachable}source ${p.source}`);
    // a smoke run (--allow-any-seed) lets it stand on its record, listed as unverifiable
    const smoke = screenOne(f, { allowAnySeed: true });
    expect(smoke.rejected).toEqual([]);
    expect(smoke.accepted[0]).toMatchObject({ biological: true, unverifiable: [`source ${p.source}`, `donor ${donor.source}`] });
    // reachable and with a dominant genome: the record is false
    expect(screenOne(f, { reloaded: rrReloaded(f).set(donor.source, { record: rrRecord(donor), dominant: RR_DOMINANT }) }).reasons).toBe(`donor ${donor.source} has a dominant genome (7:42), so its Ge-on-Fa set is not biologically unavailable`);
    // only Ge-on-Fa can be biologically unavailable, and it has no rows
    const q = rrFixture(1, "a", "quenched");
    expect(screenOne({ ...q, json: { ...q.json, biologicallyUnavailable: f.json.biologicallyUnavailable } }).reasons).toMatch(/only Ge-on-Fa \(swap-ea\) can be biologically unavailable/);
    expect(screenOne({ ...f, rows: rrFixture(1, "a", "swap-ea").rows }).reasons).toMatch(/128 rows, want 0/);
    expect(screenOne({ ...f, json: { ...f.json, biologicallyUnavailable: { ...(f.json.biologicallyUnavailable as object), donorStateHash: "x" } } }).reasons).toMatch(/biologicallyUnavailable .* want/);
  });

  it("checks each variant's recorded treatment: Ge-on-Fa's words are its donor's dominant genome, Ga-on-Fe's M3_FOUNDERS[2]'s", () => {
    const ea = rrProvenance(r3RepLabelsOf(2, "a"), "swap-ea");
    const nullDonor = { ...ea, donor: { ...ea.donor!, dominant: null } };
    const record = (x: R3RepCheckpoint): R3RepCheckpoint => ({ source: x.source, stateHash: x.stateHash, seed: x.seed, mutRate: x.mutRate, step: x.step, tilesX: x.tilesX, tilesY: x.tilesY });
    // (A) a Ge-on-Fa set with rows whose donor records no dominant genome: not the biological record, and not a swap of anything;
    // a reachable donor with none agrees with the record, so only the treatment check catches it
    for (const words of [RR_DOMINANT.words, null]) {
      const a = rrFixture(2, "a", "swap-ea", { json: { provenance: nullDonor, swap: { label: "swap-ea", from: "x", words } } });
      expect(screenOne(a).reasons).toMatch(/provenance\.donor\.dominant null: a Ge-on-Fa set with rows plants its donor's dominant genome/);
      expect(screenOne(a, { reloaded: new Map([[ea.donor!.source, { record: record(ea.donor!), dominant: null }]]) }).accepted).toEqual([]);
      expect(screenOne(a, { allowAnySeed: true }).accepted).toEqual([]);
    }
    // (B) planted words that are not the donor's dominant genome: rejected, so the history is unavailable and fails the swap criterion
    const other = r3RepDominantRecord({ hi: 7, lo: 42, words: new Uint32Array(GENOME_CHANNELS).fill(0xcd) })!.words;
    const b = rrFixture(2, "a", "swap-ea", { json: { swap: { label: "swap-ea", from: "x", words: other } } });
    expect(screenOne(b).reasons).toBe("swap words are not the donor's dominant genome 7:42 (provenance.donor.dominant.words)");
    const r = rrEvaluate(rrWorld({ over: { "scaf-i2-a-swap-ea": { json: { swap: { label: "swap-ea", from: "x", words: other } } } } }));
    expect(r.histories[2]).toMatchObject({ available: false, missing: [{ id: "scaf-i2-a-swap-ea", why: "set rejected: swap words are not the donor's dominant genome 7:42 (provenance.donor.dominant.words)" }] });
    expect(r.counts).toMatchObject({ availableHistories: 5, swapHistories: 5 });
    // Ga-on-Fe plants the ancestor and nothing else
    expect(screenOne(rrFixture(0, "a", "swap-ae", { json: { swap: { label: "swap-ae", from: "M3_FOUNDERS[1]", words: other } } })).reasons).toBe("swap words are not M3_FOUNDERS[2]'s: Ga-on-Fe plants the ancestor's genome and nothing else");
    expect(screenOne(rrFixture(0, "a", "swap-ae", { json: { swap: null } })).reasons).toMatch(/^swap null, want the swap-ae genome it planted/);
    expect(screenOne(rrFixture(2, "a", "swap-ea", { json: { swap: { label: "swap-ae", from: "M3_FOUNDERS[2]", words: R3REP_SWAP_AE_WORDS } } })).reasons).toMatch(/want the swap-ea genome it planted/);
    // the quenched control is quenched and unswapped; the source's own fragments neither
    expect(screenOne(rrFixture(0, "b", "quenched", { json: { quench: false } })).reasons).toBe("quench false, want true for quenched");
    expect(screenOne(rrFixture(0, "b", "quenched", { json: { swap: { label: "swap-ae", from: "M3_FOUNDERS[2]", words: R3REP_SWAP_AE_WORDS } } })).reasons).toMatch(/^swap .*, want null: quenched plants no swapped genome/);
    expect(screenOne(rrFixture(7, "a", "fragment", { json: { quench: true } })).reasons).toBe("quench true, want false for fragment");
    expect(screenOne(rrFixture(7, "a", "fragment", { json: { swap: { label: "swap-ea", from: "x", words: other } } })).reasons).toMatch(/^swap .*, want null: fragment plants no swapped genome/);
    expect(screenOne(rrFixture(7, "a", "fragment", { json: { quench: undefined } })).reasons).toBe("quench undefined, want false for fragment");
    // the biological record plants nothing (its checkpoints reached, so that is the only problem)
    const planted = rrFixture(1, "a", "swap-ea", { biological: true, json: { swap: { label: "swap-ea", from: "x", words: RR_DOMINANT.words } } });
    expect(screenOne(planted, { reloaded: rrReloaded(planted) }).reasons).toBe("swap words are recorded, but a biologically unavailable record plants no genome (words null)");
    // as the tool writes them, every variant passes (the 62-set world above), smoke sets included
    for (const inoculum of ["fragment", "quenched", "swap-ea", "swap-ae"] as const) expect(screenOne(rrFixture(0, "a", inoculum), { allowAnySeed: true }).rejected).toEqual([]);
  });

  it("(vii) rejects every one of two sets for one (arm, history, timing, variant), without throwing", () => {
    const a = rrDir("a", rrFixture(0, "a", "quenched"));
    const b = rrDir("b", rrFixture(0, "a", "quenched"));
    const c = rrDir("c", rrFixture(0, "b", "quenched"));
    const r = r3RepScreen([a, b, c], { sha: RR_SHAS });
    expect(r.accepted.map((x) => x.dir)).toEqual(["c"]);
    expect(r.rejected.map((x) => [x.dir, x.id])).toEqual([["a", "scaf-i0-a-quenched"], ["b", "scaf-i0-a-quenched"]]);
    expect(r.rejected[0].reasons[0]).toMatch(/same R3-replication set \(scaf-i0-a-quenched\) as b; a stage would count both/);
    // a failed attempt beside a sound one is not a duplicate: the sound one stands
    const failed = rrDir("failed", rrFixture(0, "a", "quenched", { json: { side: 4 } }));
    expect(r3RepScreen([failed, a], { sha: RR_SHAS }).accepted.map((x) => x.dir)).toEqual(["a"]);
  });

  it("--allow-any-seed waives the regime, seeds, hash and provenance of a smoke set, not its labels, variant or grid", () => {
    const f = rrFixture(0, "a", "fragment", { json: { side: 2, replicates: 1, period: 300, seeds: [{ physics: 1, fragment: 1 }], provenance: undefined, protocolSha256R3rep: undefined } });
    const small = { ...f, rows: f.rows.filter((r) => r.replicate === 0 && r.pond < 4) };
    expect(screenOne(small).rejected).toHaveLength(1);
    const ok = screenOne(small, { allowAnySeed: true });
    expect(ok.reasons).toBe("");
    expect(ok.accepted[0].rows).toHaveLength(4);
    expect(screenOne({ ...small, rows: small.rows.slice(1) }, { allowAnySeed: true }).reasons).toBe("3 rows, want 4");
    expect(screenOne({ ...small, json: { ...small.json, labels: { arm: "scaf" } } }, { allowAnySeed: true }).reasons).toMatch(/labels\.r3rep is not true/);
    expect(screenOne({ ...small, json: { ...small.json, inoculum: "swap-ea" } }, { allowAnySeed: true }).reasons).toMatch(/3 assay\.tsv rows are not swap-ea rows|4 assay\.tsv rows are not swap-ea rows/);
  });
});

describe("R3 replication rule", () => {
  it("(i) replicates when decisive: advantage and swap criterion in at least 4 of 6, every set available, no quenched control above 0.05", () => {
    const r = rrEvaluate(rrWorld());
    expect(r.screened.rejected).toEqual([]);
    expect(r).toMatchObject({ outcome: "replicates", failed: [] });
    expect(r.reasons[0]).toMatch(/^decisive: advantage .* in 6 of 6 histories, the swap criterion in 6 of 6/);
    expect(r.counts).toEqual({ evaluated: true, availableHistories: 6, advantageHistories: 6, swapHistories: 6, need: 4, decisive: true });
    expect(r.availability).toMatchObject({ expected: 62, available: 62, biological: 0, unavailable: 0, ancestor: { a: true, b: true }, availableHistories: 6 });
    expect(r.quenched).toMatchObject({ limit: 0.05, available: 12, max: 0, allAvailable: true, unreliable: false });
    expect(r.histories[0]).toMatchObject({ history: 0, available: true, missing: [], biologicalSwapEa: false, advantage: true, swapCriterion: true, swapEa: 77 / 128, swapAe: 13 / 128, quenched: { a: 0, b: 0 } });
    // margins in fragments of 128, exact: adv over rand 102 - 38, over the ancestor 102 - 51; swap (77 - 51) - 0.5 (102 - 51)
    expect(r.histories[0].margins).toEqual({ a: { rand: 64, cont: 64, ancestor: 51 }, b: { rand: 64, cont: 64, ancestor: 51 }, swap: 0.5 });
    // the 4-of-6 edge: two histories losing to rand at (b) and two others failing the swap criterion still replicate
    const edge = rrEvaluate(rrWorld({ over: { "rand-i0-b": { successes: 102 }, "rand-i1-b": { successes: 110 }, "scaf-i2-a-swap-ea": { successes: 76 }, "scaf-i3-a-swap-ea": { successes: 60 } } }));
    expect(edge.counts).toMatchObject({ advantageHistories: 4, swapHistories: 4 });
    expect(edge.outcome).toBe("replicates");
    expect(edge.histories[2].margins.swap).toBe(-0.5);
    expect(edge.histories[0].margins.b.rand).toBe(0); // a tie is not an advantage
    const three = rrEvaluate(rrWorld({ over: { "rand-i0-b": { successes: 102 }, "rand-i1-b": { successes: 110 }, "cont-i2-a": { successes: 102 } } }));
    expect(three).toMatchObject({ outcome: "does not replicate", failed: ["advantage"] });
    expect(three.reasons[0]).toMatch(/^not decisive \(advantage failed\): advantage .* in 3 of 6 histories, the swap criterion in 6 of 6/);
  });

  it("(ii) the quenched veto comes first and beats any missing set, an ancestor set included", () => {
    const r = rrEvaluate(rrWorld({ over: { "scaf-i3-b-quenched": { successes: 7 } }, drop: ["ancestor-a", "rand-i2-b", "scaf-i0-a-quenched"] }));
    expect(r).toMatchObject({ outcome: "does not replicate", failed: ["quenched"], counts: { evaluated: false } });
    expect(r.quenched).toMatchObject({ unreliable: true, allAvailable: false, available: 11 });
    expect(r.quenched.max).toBeCloseTo(7 / 128, 12);
    expect(r.reasons[0]).toMatch(/^unreliable: scaf-i3-b-quenched has competence 0\.0546875, above 0\.05/);
    expect(r.availability.ancestor).toEqual({ a: false, b: true });
    // at most 0.05 is clean: 6 of 128 is 0.047
    expect(rrEvaluate(rrWorld({ over: { "scaf-i3-b-quenched": { successes: 6 } } })).outcome).toBe("replicates");
    // a rejected quenched set is not available, so its competence cannot veto
    const rejectedLoud = rrEvaluate(rrWorld({ over: { "scaf-i3-b-quenched": { successes: 30, json: { k: 5 } } } }));
    expect(rejectedLoud).toMatchObject({ outcome: "uninformative", failed: [] });
  });

  it("(iii) a missing quenched control with no veto is uninformative, however the rest reads", () => {
    const r = rrEvaluate(rrWorld({ drop: ["scaf-i5-b-quenched"] }));
    expect(r).toMatchObject({ outcome: "uninformative", failed: [], counts: { evaluated: false } });
    expect(r.reasons).toEqual(["quenched controls unavailable: scaf-i5-b-quenched (no assay set)"]);
    // the reason a rejected one is unavailable is carried
    const rej = rrEvaluate(rrWorld({ over: { "scaf-i5-b-quenched": { json: { side: 4 } } } }));
    expect(rej.reasons[0]).toMatch(/^quenched controls unavailable: scaf-i5-b-quenched \(set rejected: side 4, want 8/);
    expect(rej.availability.sets.find((x) => x.id === "scaf-i5-b-quenched")).toMatchObject({ status: "unavailable", dir: null });
  });

  it("(ii) the veto reads every available quenched control, one in an otherwise unavailable history included, and comes before the history count", () => {
    // history 3 lacks rand-i3-a, but its quenched control at (b) is available, and it is the only loud one
    const r = rrEvaluate(rrWorld({ over: { "scaf-i3-b-quenched": { successes: 7 } }, drop: ["rand-i3-a"] }));
    expect(r.histories[3]).toMatchObject({ available: false, missing: [{ id: "rand-i3-a", why: "no assay set" }] });
    expect(r.availability.sets.find((x) => x.id === "scaf-i3-b-quenched")).toMatchObject({ status: "available" });
    expect(r).toMatchObject({ outcome: "does not replicate", failed: ["quenched"], counts: { evaluated: false, availableHistories: 5 } });
    expect(r.quenched).toMatchObject({ available: 12, allAvailable: true, unreliable: true });
    expect(r.reasons).toEqual(["unreliable: scaf-i3-b-quenched has competence 0.0546875, above 0.05"]);
    // fewer than 4 histories available would be uninformative, but a loud control, in an available history or not, vetoes first
    for (const loud of ["scaf-i4-a-quenched", "scaf-i0-b-quenched"]) {
      const few = rrEvaluate(rrWorld({ over: { [loud]: { successes: 7 } }, drop: ["rand-i0-a", "cont-i1-b", "scaf-i2-a-swap-ae"] }));
      expect(few).toMatchObject({ outcome: "does not replicate", failed: ["quenched"], counts: { evaluated: false, availableHistories: 3 } });
      expect(few.reasons).toEqual([`unreliable: ${loud} has competence 0.0546875, above 0.05`]);
    }
  });

  it("(iv) a biological Ge-on-Fa record keeps its history available, failing the swap criterion with the advantage evaluated", () => {
    const world = rrWorld({ over: { "scaf-i1-a-swap-ea": { biological: true } } });
    // strict mode: its source and donor reached, the donor with no eligible cell
    const one = rrEvaluate(world, [], rrReloaded(world.get("scaf-i1-a-swap-ea")!));
    expect(one.screened.rejected).toEqual([]);
    expect(one.histories[1]).toMatchObject({ available: true, biologicalSwapEa: true, advantage: true, swapCriterion: false, swapEa: null });
    expect(one.histories[1].margins.swap).toBeNull();
    expect(one.availability).toMatchObject({ available: 61, biological: 1, unavailable: 0, availableHistories: 6 });
    expect(one.availability.sets.find((x) => x.id === "scaf-i1-a-swap-ea")).toMatchObject({ status: "biological", why: "Ge-on-Fa: the donor has no dominant genome (no eligible cell)" });
    expect(one).toMatchObject({ outcome: "replicates", counts: { advantageHistories: 6, swapHistories: 5 } });
    const ids = [0, 2, 4].map((i) => `scaf-i${i}-a-swap-ea`);
    const threeWorld = rrWorld({ over: Object.fromEntries(ids.map((id) => [id, { biological: true }])) });
    const three = rrEvaluate(threeWorld, [], rrReloaded(...ids.map((id) => threeWorld.get(id)!)));
    expect(three).toMatchObject({ outcome: "does not replicate", failed: ["swap"], counts: { availableHistories: 6, advantageHistories: 6, swapHistories: 3 } });
  });

  it("(iv) in strict mode a biological record whose donor is unreachable is rejected: its history is unavailable and fails both criteria", () => {
    const world = rrWorld({ over: { "scaf-i1-a-swap-ea": { biological: true } } });
    const f = world.get("scaf-i1-a-swap-ea")!;
    const donor = (f.json.provenance as R3RepProvenance).donor!.source;
    // its source (the ancestor's b1-pre) reached, its donor not
    const reloaded = rrReloaded(f);
    reloaded.delete(donor);
    const r = rrEvaluate(world, [], reloaded);
    const why = `a biologically unavailable record needs its checkpoints verified, but these are not reachable from here: donor ${donor}`;
    expect(r.screened.rejected).toEqual([{ dir: "scaf-i1-a-swap-ea", id: "scaf-i1-a-swap-ea", reasons: [why] }]);
    expect(r.histories[1]).toMatchObject({ available: false, missing: [{ id: "scaf-i1-a-swap-ea", why: `set rejected: ${why}` }], biologicalSwapEa: false, advantage: false, swapCriterion: false });
    expect(r.availability).toMatchObject({ available: 61, biological: 0, unavailable: 1, availableHistories: 5 });
    expect(r).toMatchObject({ outcome: "replicates", counts: { availableHistories: 5, advantageHistories: 5, swapHistories: 5 } });
    // with nothing reachable both checkpoints are named; two more such records leave 3 histories, uninformative
    expect(rrEvaluate(world).screened.rejected[0].reasons).toEqual([`a biologically unavailable record needs its checkpoints verified, but these are not reachable from here: source ${RR_ROOT}/r3rep/anc/ckpt/b1-pre.blck.gz; donor ${donor}`]);
    const three = rrEvaluate(rrWorld({ over: Object.fromEntries([1, 3, 5].map((i) => [`scaf-i${i}-a-swap-ea`, { biological: true }])) }));
    expect(three).toMatchObject({ outcome: "uninformative", reasons: ["3 of 6 histories available, need 4"], counts: { availableHistories: 3 } });
  });

  it("(v) fewer than 4 available histories is uninformative", () => {
    const r = rrEvaluate(rrWorld({ drop: ["rand-i0-a", "cont-i1-b", "scaf-i2-a-swap-ae"] }));
    expect(r).toMatchObject({ outcome: "uninformative", reasons: ["3 of 6 histories available, need 4"], counts: { evaluated: false, availableHistories: 3 } });
    expect(r.availability.histories.slice(0, 3)).toEqual([
      { history: 0, available: false, missing: ["rand-i0-a"] },
      { history: 1, available: false, missing: ["cont-i1-b"] },
      { history: 2, available: false, missing: ["scaf-i2-a-swap-ae"] },
    ]);
    expect(r.histories[2]).toMatchObject({ available: false, missing: [{ id: "scaf-i2-a-swap-ae", why: "no assay set" }] });
    // 4 available is enough to apply the rule
    expect(rrEvaluate(rrWorld({ drop: ["rand-i0-a", "cont-i1-b"] })).counts).toMatchObject({ evaluated: true, availableHistories: 4 });
  });

  it("(vi) a missing ancestor set is uninformative", () => {
    const r = rrEvaluate(rrWorld({ drop: ["ancestor-b"] }));
    expect(r).toMatchObject({ outcome: "uninformative", reasons: ["ancestor sets unavailable: ancestor-b (no assay set)"], availability: { ancestor: { a: true, b: false } } });
    expect(rrEvaluate(rrWorld({ over: { "ancestor-a": { json: { seeds: [{ physics: 1, fragment: 1 }, { physics: 2, fragment: 2 }] } } } })).reasons[0]).toMatch(/^ancestor sets unavailable: ancestor-a \(set rejected: seed 1 does not match/);
  });

  it("(vii) duplicate sets make that set, and so its history, unavailable", () => {
    const world = rrWorld();
    const r = rrEvaluate(world, [rrDir("again", world.get("cont-i4-a")!)]);
    expect(r.screened.rejected.map((x) => x.dir)).toEqual(["cont-i4-a", "again"]);
    expect(r.availability.histories[4]).toEqual({ history: 4, available: false, missing: ["cont-i4-a"] });
    expect(r.availability.sets.find((x) => x.id === "cont-i4-a")!.why).toMatch(/^set rejected: the same R3-replication set \(cont-i4-a\) as again; .*; the same R3-replication set \(cont-i4-a\) as cont-i4-a/);
    expect(r).toMatchObject({ outcome: "replicates", counts: { availableHistories: 5, advantageHistories: 5, swapHistories: 5 } });
  });

  it("(viii) an unavailable history counts as failing both criteria, though its remaining sets would pass", () => {
    // histories 4 and 5 each miss one set; 0-3 pass both criteria: exactly 4 of 6
    const r = rrEvaluate(rrWorld({ drop: ["cont-i4-b", "rand-i5-a"] }));
    expect(r.counts).toEqual({ evaluated: true, availableHistories: 4, advantageHistories: 4, swapHistories: 4, need: 4, decisive: true });
    expect(r.outcome).toBe("replicates");
    expect(r.histories[4]).toMatchObject({ available: false, advantage: false, swapCriterion: false, swapEa: null, a: { scaf: null } });
    // the descriptive evaluation still reads its remaining sets: the swap criterion would hold there
    expect(r.descriptive.histories[4]).toMatchObject({ swapCriterion: true, swapEa: 77 / 128, advantage: false });
    // one more history failing either criterion makes it not decisive
    const lost = rrEvaluate(rrWorld({ drop: ["cont-i4-b", "rand-i5-a"], over: { "scaf-i3-a-swap-ea": { successes: 60 } } }));
    expect(lost).toMatchObject({ outcome: "does not replicate", failed: ["swap"], counts: { advantageHistories: 4, swapHistories: 3 } });
  });

  it("reports every competence, each replicate alone, the unmatched retained mass and the truncated rows, none of it a decision input", () => {
    // scaf-i0-a: replicate 0 all succeed, replicate 1 none
    const r = rrEvaluate(rrWorld({ over: { "scaf-i0-a": { success: (j) => (j < 64 ? 1 : 0) } } }));
    const c = r.descriptive.competences.find((x) => x.id === "scaf-i0-a")!;
    expect(c).toMatchObject({ inoculum: "fragment", status: "available", n: 128, successes: 64, competence: 0.5, truncatedRows: 0 });
    expect(c.perReplicate).toEqual([{ replicate: 0, n: 64, successes: 64, competence: 1 }, { replicate: 1, n: 64, successes: 0, competence: 0 }]);
    expect(r.descriptive.competences).toHaveLength(62);
    expect(r.descriptive.perReplicate.map((x) => x.replicate)).toEqual([0, 1]);
    expect(r.descriptive.perReplicate[1].histories[0]).toMatchObject({ history: 0, advantage: false });
    expect(r.descriptive.perReplicate[0].histories[0].margins.a.rand).toBe(128 - 2 * 38);
    // the unmatched comparison: the 38 sources' retained B+P and E
    expect(r.descriptive.unmatched).toHaveLength(38);
    expect(r.descriptive.unmatched[0]).toMatchObject({ id: "scaf-i0-a", retMass: { n: 128, min: 90, max: 96 }, retE: { n: 128, min: 180, max: 184 } });
    expect(r.descriptive.truncation).toEqual({ rows: 62 * 128, truncatedRows: 0, flagged: [] });
    // more than 1% truncated rows flags a set (2 of 128), and changes nothing else
    const world = rrWorld();
    const f = world.get("rand-i3-a")!;
    world.set("rand-i3-a", { ...f, rows: f.rows.map((row, j) => (j < 2 ? { ...row, truncated: 1 } : row)) });
    const trunc = rrEvaluate(world);
    expect(trunc.descriptive.truncation).toEqual({ rows: 62 * 128, truncatedRows: 2, flagged: ["rand-i3-a"] });
    expect(trunc.descriptive.competences.find((x) => x.id === "rand-i3-a")!.truncatedRows).toBe(2);
    expect(trunc.outcome).toBe("replicates");
  });
});

describe("R3 replication runs and the v1 side-by-side", () => {
  const meta = (arm: "scaf" | "rand" | "cont", i: number, over: Record<string, unknown> = {}) => ({ tool: "scaffold", arm, k: arm === "cont" ? 0 : 8, period: 10_000, cycles: 100, side: 8, seed: r3RepWorldSeedOf(6 * ["scaf", "rand", "cont"].indexOf(arm) + i), mutRate: DP_MUT, init: "clone", ...over });

  it("knows a replication history's run directory by its meta.json", () => {
    expect(r3RepRunOf(meta("scaf", 0))).toEqual({ key: { arm: "scaf", history: 0, h: 0 }, why: [] });
    expect(r3RepRunOf(meta("rand", 5))).toEqual({ key: { arm: "rand", history: 5, h: 11 }, why: [] });
    expect(r3RepRunOf(meta("cont", 2))).toEqual({ key: { arm: "cont", history: 2, h: 14 }, why: [] });
    expect(meta("cont", 2).seed).toBe(4_811_303);
    // the R1'' copies before the extension (34 cycles), v1's main run, the ancestor world, the formula's unused arm-2 seeds
    expect(r3RepRunOf(meta("scaf", 0, { cycles: 34 })).why).toEqual(["cycles 34, want 100"]);
    expect(r3RepRunOf(meta("scaf", 0, { seed: 4_810_001 })).why[0]).toMatch(/seed 4810001 is not 4811001 \+ i/);
    expect(r3RepRunOf(meta("cont", 0, { seed: 4_811_201 })).why[0]).toMatch(/seed 4811201 is not 4811301 \+ i/);
    expect(r3RepRunOf(meta("cont", 0, { seed: 4_818_401, cycles: 1 })).why).toEqual(["seed 4818401 is the ancestor world, not a history", "cycles 1, want 100"]);
    expect(r3RepRunOf(meta("scaf", 0, { side: 2, k: 5, period: 300, mutRate: 0, init: "founders" })).why).toEqual(["side 2, want 8", 'init "founders", want "clone"', "mutation off", "period 300, want 10000", "k 5, want 8"]);
    expect(r3RepRunOf({ ...meta("scaf", 0), arm: "anc" }).why[0]).toMatch(/arm "anc"/);
  });

  it("streams ponds.tsv into the mean pond trait and the extinct ponds per boundary, and summarises them per arm", async () => {
    const lines = ["cycle\trecipient\tdonor\tretMass\trecipientTrait\ttruncated", "1\t0\t1\t5\t100\t0", "1\t1\t0\t5\t300\t1", "100\t0\t1\t5\t0\t0", "100\t1\t0\t5\t600\t0", "50\t0\t1\t5\t0\t0", "50\t1\t1\t5\t0\t0"];
    const t = await r3RepTrajectory(tsvRows(lines));
    expect(t.boundaries).toEqual([{ boundary: 1, n: 2, meanTrait: 200, extinct: 0 }, { boundary: 50, n: 2, meanTrait: 0, extinct: 2 }, { boundary: 100, n: 2, meanTrait: 300, extinct: 1 }]);
    expect(t.truncation).toMatchObject({ truncated: 1, rows: 6, flagged: true });
    const ended = await r3RepTrajectory(tsvRows(lines.slice(0, 3)));
    const run = (arm: "scaf" | "rand" | "cont", history: number, trajectory: typeof t | null, over: Partial<R3RepRun> = {}): R3RepRun => ({ arm, history, h: 6 * ["scaf", "rand", "cont"].indexOf(arm) + history, dir: `${arm}/i${history}`, status: "finished", ended: false, endedAt: null, trajectory, ...over });
    const s = r3RepRunsSummary([run("scaf", 1, ended, { ended: true, endedAt: 61 }), run("scaf", 0, t), run("cont", 0, null, { status: "unfinished" })]);
    expect(s.histories.map((h) => [h.id, h.extinctAt100, h.lastBoundary, h.status])).toEqual([["scaf-i0", 1, 100, "finished"], ["scaf-i1", null, 1, "finished"], ["cont-i0", null, null, "unfinished"]]);
    expect(s.histories[1]).toMatchObject({ ended: true, endedAt: 61 });
    expect(s.arms.scaf[0]).toEqual({ boundary: 1, histories: 2, medianMeanTrait: 200, medianExtinct: 0 });
    expect(s.arms.scaf[5]).toEqual({ boundary: 100, histories: 1, medianMeanTrait: 300, medianExtinct: 1 });
    expect(s.arms.cont[0]).toEqual({ boundary: 1, histories: 0, medianMeanTrait: null, medianExtinct: null });
  });

  it("puts v1's R3 numbers beside the replication's", () => {
    const rep = rrEvaluate(rrWorld({ over: { "scaf-i2-a-swap-ea": { successes: 76 } } }));
    const v1 = { stage: "r3", advantageHistories: 5, swapHistories: 4, quenched: { n: 12, max: 0 }, histories: r3Evaluate(r3World()).histories };
    const s = r3RepSideBySide(v1, rep.evaluation, rep.quenched.max);
    expect(s.counts).toEqual({ v1: { advantageHistories: 5, swapHistories: 4, quenchedMax: 0 }, replication: { advantageHistories: 6, swapHistories: 5, quenchedMax: 0 } });
    expect(s.histories[2].replication).toMatchObject({ advantage: true, swapCriterion: false, scafA: 102 / 128, ancestorA: 51 / 128, margins: { swap: -0.5 } });
    expect(s.histories[0].v1).toMatchObject({ advantage: true, swapCriterion: true, scafA: 0.8 });
    expect(() => r3RepSideBySide({ stage: "r1", histories: [] }, rep.evaluation)).toThrow(/not an r3 stage output/);
  });
});

describe("scaffold-report r3rep", () => {
  const scratch = () => mkdtempSync(join(tmpdir(), "scaffold-r3rep-"));
  const docSha = (name: string) => createHash("sha256").update(readFileSync(fileURLToPath(new URL(`../../docs/${name}`, import.meta.url)))).digest("hex");
  /** The pinned SHA-256s the report checks (not the documents as they are now), so the fixtures pass in strict mode. */
  const shas = () => R3REP_SHA256;
  const writeSet = (root: string, id: string, f: RrFixture) => {
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "assay.json"), JSON.stringify(f.json));
    writeFileSync(join(dir, "assay.tsv"), f.text);
  };
  const writeWorld = (root: string, o: Parameters<typeof rrWorld>[0] = {}) => {
    for (const [id, f] of rrWorld({ sha: shas(), ...o })) writeSet(root, id, f);
  };
  /**
   * Real checkpoints, under a scratch root, at the paths the fixtures record: the ancestor's b1-pre and scaf history i's b100-pre for
   * each i in `scaf`. Each is an empty 8 x 8 pond grid (24 x 24 ponds, the smallest the kernel allows) with the world seed, mutation
   * rate and step recorded, so it has no dominant genome. Returns the root and their state hashes by h, for the fixtures to record.
   */
  const writeCheckpoints = (scaf: number[]): { root: string; hashes: Record<number, string> } => {
    const root = join(scratch(), "runs", "scaffold");
    const hashes: Record<number, string> = {};
    for (const [h, N] of [[18, 1], ...scaf.map((i) => [i, 100])]) {
      const state = allocState({ ...pondConfig(8, r3RepWorldSeedOf(h)), tileW: 24, tileH: 24 });
      state.step = N * 10_000;
      const path = `${root}/${r3RepRunDirOf(h)}/ckpt/b${N}-pre.blck.gz`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, gzipSync(encodeCheckpoint(state)));
      hashes[h] = stateHash(state);
    }
    return { root, hashes };
  };

  it("reads the 62 sets: availability, the rule and the descriptive part, with the unreachable checkpoints unverifiable", () => {
    const root = scratch();
    writeWorld(root);
    // a set of another stage is skipped, and listed
    writeAssayDir(root, "r1-h0", scafR1(0));
    const out = report("r3rep", "--assays", root);
    expect(out).toMatchObject({ stage: "r3rep", outcome: "replicates", failed: [], validated: true, protocolSha256R3rep: shas().r3rep, protocolSha256: shas().protocol, rejected: [] });
    // the documents as they are now are reported beside the pins, never checked
    expect(out.protocolNow).toEqual({
      r3rep: { doc: "docs/scaffold-r3-replication-v1.md", sha256: docSha("scaffold-r3-replication-v1.md"), pinnedTextIntact: true },
      protocol: { doc: "docs/scaffold-protocol-v1.md", sha256: docSha("scaffold-protocol-v1.md"), pinnedTextIntact: true },
    });
    expect(out.skipped).toEqual([{ dir: join(root, "r1-h0"), why: "not an R3-replication set (labels.r3rep is not true)" }]);
    expect(out.counts).toMatchObject({ evaluated: true, availableHistories: 6, advantageHistories: 6, swapHistories: 6 });
    expect(out.availability).toMatchObject({ expected: 62, available: 62, unavailable: 0 });
    expect(out.histories).toHaveLength(6);
    expect(out.histories[0].margins.swap).toBe(0.5);
    expect(out.checkpoints).toMatchObject({ reloaded: 0, unreadable: [] });
    expect(out.checkpoints.unverifiable).toHaveLength(62);
    expect(out.descriptive.competences).toHaveLength(62);
    expect(out.descriptive.runs).toEqual({ loaded: false });
    expect(out.descriptive.v1).toBeNull();
    expect(out.descriptive.note).toMatch(/never a decision input/);
  });

  it("still accepts every set after the protocol documents gain a dated amendment (the readout can be regenerated after the results)", () => {
    // a copy of the report and what it reads, with an amendment at the end of each document, as recording the results would add
    const repo = fileURLToPath(new URL("../../", import.meta.url));
    const tree = scratch();
    for (const path of ["deno.json", "deno.lock", "tools/scaffold-report.ts", "tools/lib", "docs/scaffold-protocol-v1.md", "docs/scaffold-r3-replication-v1.md"]) cpSync(join(repo, path), join(tree, path), { recursive: true });
    for (const pkg of readdirSync(join(repo, "packages"))) cpSync(join(repo, "packages", pkg, "src"), join(tree, "packages", pkg, "src"), { recursive: true });
    for (const doc of ["scaffold-protocol-v1.md", "scaffold-r3-replication-v1.md"]) appendFileSync(join(tree, "docs", doc), "\n## Results (2026-10-02)\n\nRecorded after the runs.\n");
    const root = scratch();
    writeWorld(root);
    const out = JSON.parse(execFileSync("deno", ["run", "-A", join(tree, "tools/scaffold-report.ts"), "r3rep", "--assays", root], { cwd: tree, stdio: "pipe", encoding: "utf8" }));
    expect(out).toMatchObject({ outcome: "replicates", rejected: [], protocolSha256R3rep: R3REP_SHA256.r3rep, protocolSha256: R3REP_SHA256.protocol });
    expect(out.availability).toMatchObject({ available: 62, unavailable: 0 });
    expect(out.protocolNow.r3rep).toMatchObject({ pinnedTextIntact: true });
    expect(out.protocolNow.r3rep.sha256).not.toBe(R3REP_SHA256.r3rep);
    expect(out.protocolNow.protocol.sha256).not.toBe(R3REP_SHA256.protocol);
  });

  it("collects unreadable and unsound sets as unavailable while the others continue, and applies the rule in order", () => {
    const root = scratch();
    // the biological record's source and donor are real checkpoints, so strict mode can verify it
    const ckpts = writeCheckpoints([2]);
    writeWorld(root, { ...ckpts, over: { "scaf-i2-a-swap-ea": { biological: true } } });
    execFileSync("rm", [join(root, "rand-i0-a", "assay.tsv")]);
    writeFileSync(join(root, "cont-i1-b", "assay.json"), "{ not json");
    const out = report("r3rep", "--assays", root);
    expect(out.rejected.map((r: { id: string | null }) => r.id)).toEqual([null, "rand-i0-a"]);
    expect(out.rejected[1].reasons[0]).toMatch(/^could not read the set/);
    expect(out.availability.sets.find((x: { id: string }) => x.id === "rand-i0-a").why).toMatch(/^set rejected: could not read the set/);
    expect(out.availability.sets.find((x: { id: string }) => x.id === "cont-i1-b").why).toBe("no assay set");
    expect(out.availability.sets.find((x: { id: string }) => x.id === "scaf-i2-a-swap-ea").status).toBe("biological");
    expect(out.checkpoints).toMatchObject({ reloaded: 2, unreadable: [] });
    expect(out.descriptive.competences.find((c: { id: string }) => c.id === "scaf-i2-a-swap-ea")).toMatchObject({ status: "biological", n: 0, unverifiable: [] });
    // histories 0 and 1 unavailable, 2 valid but failing the swap criterion: 4 advantage, 3 swap
    expect(out).toMatchObject({ outcome: "does not replicate", failed: ["swap"], counts: { availableHistories: 4, advantageHistories: 4, swapHistories: 3 } });
    // without its donor checkpoint the record cannot be verified: rejected, so history 2 is unavailable too, and 3 of 6 is uninformative
    const donor = `${ckpts.root}/r3rep/main/scaf/i2/ckpt/b100-pre.blck.gz`;
    execFileSync("rm", [donor]);
    const gone = report("r3rep", "--assays", root);
    expect(gone.rejected.map((r: { id: string | null }) => r.id)).toEqual([null, "rand-i0-a", "scaf-i2-a-swap-ea"]);
    expect(gone.rejected[2].reasons).toEqual([`a biologically unavailable record needs its checkpoints verified, but these are not reachable from here: donor ${donor}`]);
    expect(gone.availability.histories[2]).toEqual({ history: 2, available: false, missing: ["scaf-i2-a-swap-ea"] });
    expect(gone).toMatchObject({ outcome: "uninformative", reasons: ["3 of 6 histories available, need 4"], counts: { availableHistories: 3 } });
    // the sets that took the donor's checkpoint as their source stand on their records, unverifiable
    expect(gone.checkpoints.unverifiable.find((x: { id: string }) => x.id === "scaf-i2-a").checkpoints).toEqual([`source ${donor}`]);
  });

  it("with --runs adds the trajectories and extinct ponds; --v1 the side-by-side", () => {
    const root = scratch();
    const runs = scratch();
    writeWorld(root);
    const finished = { ok: true, conservationOk: true, cycles: 100, ended: false };
    const rows = (traits: number[]): RunRow[] => [1, 100].flatMap((cycle) => traits.map((trait, recipient) => ({ cycle, recipient, trait: cycle === 1 ? 100_000 : trait })));
    writeRunDir(runs, "scaf-i0", { arm: "scaf", k: 8, period: 10_000, cycles: 100, side: 8, seed: 4_811_001, mutRate: DP_MUT, init: "clone" }, rows([0, 0, 120_000, 140_000]), finished);
    writeRunDir(runs, "cont-i0", { arm: "cont", k: 0, period: 10_000, cycles: 100, side: 8, seed: 4_811_301, mutRate: DP_MUT, init: "clone" }, rows([90_000, 0, 0, 0]), finished);
    writeRunDir(runs, "rep-scaf-i0", { arm: "scaf", k: 8, period: 10_000, cycles: 34, side: 8, seed: 4_811_001, mutRate: DP_MUT, init: "clone" }, [], finished);
    const v1 = join(runs, "r3.json");
    writeFileSync(v1, readFileSync(fileURLToPath(new URL("../../experiments/scaffold/readouts/r3.json", import.meta.url))));
    const out = report("r3rep", "--assays", root, "--runs", runs, "--v1", v1);
    expect(out.outcome).toBe("replicates");
    const r = out.descriptive.runs;
    expect(r.loaded).toBe(true);
    expect(r.skipped.map((x: { dir: string }) => x.dir)).toEqual([join(runs, "rep-scaf-i0")]);
    expect(r.histories.map((h: { id: string; extinctAt100: number }) => [h.id, h.extinctAt100])).toEqual([["scaf-i0", 2], ["cont-i0", 3]]);
    expect(r.histories[0].trajectory).toEqual([{ boundary: 1, n: 4, meanTrait: 100_000, extinct: 0 }, { boundary: 100, n: 4, meanTrait: 65_000, extinct: 2 }]);
    expect(r.arms.cont[5]).toEqual({ boundary: 100, histories: 1, medianMeanTrait: 22_500, medianExtinct: 3 });
    expect(out.descriptive.v1).toMatchObject({ from: v1, counts: { v1: { advantageHistories: 5, swapHistories: 4, quenchedMax: 0 }, replication: { advantageHistories: 6, swapHistories: 6, quenchedMax: 0 } } });
    expect(out.descriptive.v1.histories).toHaveLength(6);
    // two runs of one history: neither is summarised, both are listed under skipped, and the readout stands
    writeRunDir(runs, "scaf-i0-again", { arm: "scaf", k: 8, period: 10_000, cycles: 100, side: 8, seed: 4_811_001, mutRate: DP_MUT, init: "clone" }, [], finished);
    const twice = report("r3rep", "--assays", root, "--runs", runs);
    expect(twice.outcome).toBe("replicates");
    expect(twice.descriptive.runs.histories.map((h: { id: string }) => h.id)).toEqual(["cont-i0"]);
    expect(twice.descriptive.runs.arms.scaf[5]).toMatchObject({ boundary: 100, histories: 0 });
    expect(twice.descriptive.runs.skipped.map((x: { dir: string }) => x.dir).sort()).toEqual([join(runs, "rep-scaf-i0"), join(runs, "scaf-i0"), join(runs, "scaf-i0-again")].sort());
    const whys = twice.descriptive.runs.skipped.map((x: { why: string }) => x.why);
    expect(whys).toContain("a second run of history scaf-i0; neither is summarised");
    expect(whys).toContain("the first run of history scaf-i0, which has a second; neither is summarised");
  });

  it("with --runs lists a run it cannot read under skipped, and still gives the outcome", () => {
    const root = scratch();
    const runs = scratch();
    writeWorld(root);
    const finished = { ok: true, conservationOk: true, cycles: 100, ended: false };
    const meta = (arm: "scaf" | "rand" | "cont", i: number) => ({ arm, k: arm === "cont" ? 0 : 8, period: 10_000, cycles: 100, side: 8, seed: r3RepWorldSeedOf(6 * ["scaf", "rand", "cont"].indexOf(arm) + i), mutRate: DP_MUT, init: "clone" });
    const rows: RunRow[] = [1, 100].flatMap((cycle) => [0, 1].map((recipient) => ({ cycle, recipient, trait: 100_000 })));
    for (const [arm, i] of [["scaf", 0], ["rand", 1], ["cont", 2]] as const) writeRunDir(runs, `${arm}-i${i}`, meta(arm, i), rows, finished);
    writeFileSync(join(runs, "rand-i1", "done.json"), "{ not json");
    writeFileSync(join(runs, "cont-i2", "meta.json"), "{ not json");
    const out = report("r3rep", "--assays", root, "--runs", runs);
    expect(out).toMatchObject({ outcome: "replicates", rejected: [] });
    const r = out.descriptive.runs;
    expect(r.loaded).toBe(true);
    expect(r.histories.map((h: { id: string }) => h.id)).toEqual(["scaf-i0"]);
    expect(r.skipped.map((x: { dir: string }) => x.dir)).toEqual([join(runs, "cont-i2"), join(runs, "rand-i1")]);
    for (const x of r.skipped) expect(x.why).toMatch(/^could not be read: .*JSON/);
    // A missing root and an empty root beside the valid one are listed too; the readout still stands.
    const empty = scratch();
    const missing = join(runs, "no-such-dir");
    const more = report("r3rep", "--assays", root, "--runs", runs, missing, empty);
    expect(more).toMatchObject({ outcome: "replicates", rejected: [] });
    expect(more.descriptive.runs.histories.map((h: { id: string }) => h.id)).toEqual(["scaf-i0"]);
    const whyOf = (d: string) => more.descriptive.runs.skipped.find((x: { dir: string }) => x.dir === d)?.why;
    expect(whyOf(missing)).toMatch(/^no run directory|^could not be walked/);
    expect(whyOf(empty)).toBe("no run directory (meta.json) under it");
    // Only missing or empty roots: no run is summarised, and the outcome is still given.
    const none = report("r3rep", "--assays", root, "--runs", missing);
    expect(none).toMatchObject({ outcome: "replicates", rejected: [] });
    expect(none.descriptive.runs.histories).toEqual([]);
  });

  it("--allow-any-seed reads a smoke-sized set the strict screen rejects", () => {
    const root = scratch();
    const f = rrFixture(18, "a", "fragment", { sha: shas(), json: { side: 2, replicates: 1, period: 300, seeds: [{ physics: 1, fragment: 1 }] } });
    const rows = f.rows.filter((r) => r.replicate === 0 && r.pond < 4);
    writeSet(root, "smoke", { ...f, rows, text: [f.text.split("\n")[0], ...f.text.split("\n").slice(1, 5)].join("\n") + "\n" });
    const strict = report("r3rep", "--assays", root);
    expect(strict).toMatchObject({ outcome: "uninformative", validated: true });
    expect(strict.rejected[0].reasons.join(" ")).toMatch(/period 300, want 10000/);
    const smoke = report("r3rep", "--assays", root, "--allow-any-seed");
    expect(smoke).toMatchObject({ outcome: "uninformative", validated: false, rejected: [] });
    expect(smoke.availability.sets.find((x: { id: string }) => x.id === "ancestor-a").status).toBe("available");
    expect(smoke.descriptive.competences[0]).toMatchObject({ id: "ancestor-a", n: 4 });
  });

  it("the other stages skip R3-replication directories and read exactly what they read without them", () => {
    // the same root as the R1'' check: R1, R2 and R3 (regime k 5 / period 3000), calibrate, tau, R1' and R1''
    const root = scratch();
    for (const i of [0, 1, 2]) writeAssayDir(root, `r1-h${i}`, scafR1(i));
    writeAssayDir(root, "r2-frag", assayDirFixture({ assay: "garden", flags: { arm: "scaf", history: "0", time: "0" }, seed: assaySeed(2, 0, 0, 0, 0), dir: "g" }));
    for (const [n, dir] of [[1, "cal-anc"], [2, "cal-que"]] as const) {
      writeAssayDir(root, dir, assayDirFixture({ assay: "competence", flags: { arm: "ancestor", timing: "a", calibration: String(n) as "1" | "2" }, inoculum: n === 1 ? "fragment" : "quenched", seed: 4_802_011, k: 5, period: 3000, dir, success: (i) => (i < 64 ? 1 : 0) }));
    }
    // a v1 R3 set of history 0, so r3 reads something
    writeAssayDir(root, "r3-scaf-a", assayDirFixture({ assay: "competence", flags: { arm: "scaf", history: "0", timing: "a" }, seed: assaySeed(3, 0, 0, 0, 0), dir: "r3" }));
    writeTraitDir(root, "tau-cal", frozenTau());
    for (const i of [0, 1, 2, 3]) writeTraitDir(root, `prime-${i}`, primeFixture({ i }));
    writeTraitDir(root, "dp-0", dpFixture({ h: 0, cross: strongCross }));
    const p1Json = join(root, "p1.json");
    writeFileSync(p1Json, JSON.stringify({ stage: "p1", verdict: true, choice: { stage: "primary", chosen: { k: 5, period: 3000 }, candidate: { k: 5, period: 3000 }, primaryComplete: true, fallbackComplete: false, verdict: true, passing: [{ k: 5, period: 3000 }] } }));
    const tau = join(root, "tau.json");
    const { source, ref, k, period, side, replicates, seeds, labels } = frozenTau().json;
    writeFileSync(tau, JSON.stringify({ stage: "tau", verdict: null, validated: true, provenance: { source, ref, k, period, side, replicates, seeds, labels }, tau: PRIME_TAU }));
    const replay = join(root, "replay-check.json");
    writeFileSync(replay, JSON.stringify({ mechanismCheck: { passed: true }, valid: [0, 1, 2, 3, 4, 5].map((i) => `scaf-i${i}-t0`), failed: [] }));
    const stages = (): Record<string, any> => ({
      r1: report("r1", "--assays", root, "--regime", "5", "3000"),
      r2: report("r2", "--assays", root, "--regime", "5", "3000"),
      r3: report("r3", "--assays", root, "--regime", "5", "3000"),
      calibrate: report("calibrate", "--p1", p1Json, "--assays", root),
      tau: report("tau", "--assays", root, "--regime", "8", "10000"),
      r1prime: report("r1prime", "--assays", root, "--tau", tau, "--regime", "8", String(PRIME_PERIOD), "--replay", replay),
      r1dprime: report("r1dprime", "--assays", root),
    });
    const before = stages();
    expect(before.r3.histories[0].a.scaf).toBe(1);
    expect(before.r1dprime.histories[0]).toMatchObject({ outcome: "analysed" });
    // R3-replication sets of every kind beside them: sources at both timings, both swaps, quenched, the ancestor, a biological record
    // (whose source and donor are real checkpoints, so the r3rep stage can verify it)
    const o = { sha: shas(), ...writeCheckpoints([2]) };
    const added: [string, RrFixture][] = [
      ["rr-scaf-i0-a", rrFixture(0, "a", "fragment", o)],
      ["rr-cont-i0-b", rrFixture(12, "b", "fragment", o)],
      ["rr-ea", rrFixture(1, "a", "swap-ea", o)],
      ["rr-ea-bio", rrFixture(2, "a", "swap-ea", { ...o, biological: true })],
      ["rr-ae", rrFixture(0, "a", "swap-ae", o)],
      ["rr-q", rrFixture(0, "b", "quenched", o)],
      ["rr-anc", rrFixture(18, "a", "fragment", o)],
    ];
    for (const [id, f] of added) writeSet(root, id, f);
    const after = stages();
    for (const stage of Object.keys(before)) expect({ stage, ...after[stage], skipped: 0 }).toEqual({ stage, ...before[stage], skipped: 0 });
    for (const stage of Object.keys(before)) expect(after[stage].skipped).toBe(before[stage].skipped + added.length);
    // and the new stage reads only its own: 3 R1 sets, 1 R2, 2 calibrations, 1 R3, the tau calibration, 4 R1' sets and 1 R1'' set
    const rr = report("r3rep", "--assays", root);
    expect(rr.skipped).toHaveLength(13);
    expect(rr.rejected).toEqual([]);
    expect(rr.checkpoints).toMatchObject({ reloaded: 2, unreadable: [] });
    const ids = new Set(["scaf-i0-a", "cont-i0-b", "scaf-i1-a-swap-ea", "scaf-i2-a-swap-ea", "scaf-i0-a-swap-ae", "scaf-i0-b-quenched", "ancestor-a"]);
    expect(rr.descriptive.competences.map((c: { id: string }) => c.id)).toEqual(r3RepExpectedSets().map(({ labels, inoculum }) => r3RepSetIdOf(labels, inoculum)).filter((id) => ids.has(id)));
  });
});

// ---- the scaffolding registration (docs/scaffold-registration-v1.md): reg1 ------------------------------------------------

/**
 * A crafted registration: every competence set's successes, every garden set's end trait, every S3 set's crossing-time pattern, the
 * Ge-on-Fa records without a dominant genome and the sets that are missing. The default confirms H1 and H2: scaf 200 + i of 256 at both
 * timings against rand 100 + i, cont 90 + i and the ancestor 80 + i; Ge-on-Fa 300 + i against Ga-on-Fa 280 + i of 512 (g > 0 in every
 * history, but under half the advantage, so S1 fails); every quenched set 0; S2's disc gains 1000 + i (scaf) and 200 + i (rand); S3 strong
 * in scaf and the positive controls, flat in rand and the negative controls.
 */
interface Reg1Plan {
  successes: (id: string) => number;
  gardenTrait: (id: string) => number;
  heredity: (id: string) => "strong" | "flat" | "insufficient";
  bio: ReadonlySet<string>;
  missing: ReadonlySet<string>;
}

function reg1Successes(id: string): number {
  const m = /^(scaf|rand|cont|ancestor)-i(\d\d)-(.+)$/.exec(id);
  if (!m) throw new Error(`not a competence set: ${id}`);
  const i = Number(m[2]);
  if (m[3] === "a" || m[3] === "b") return { scaf: 200, rand: 100, cont: 90, ancestor: 80 }[m[1] as Reg1ReportArm] + i;
  if (m[3] === "ge-on-fa") return 300 + i;
  if (m[3] === "ga-on-fa") return 280 + i;
  if (m[3] === "ga-on-fe") return 100;
  return 0;
}

function reg1GardenTrait(id: string): number {
  const m = /^garden-(scaf|rand)-i(\d\d)-t([01])-(raw|disc)$/.exec(id)!;
  return m[3] === "0" ? 1000 : (m[1] === "scaf" ? 2000 : 1200) + Number(m[2]);
}

const reg1Plan = (o: Partial<Reg1Plan> = {}): Reg1Plan => ({
  successes: reg1Successes,
  gardenTrait: reg1GardenTrait,
  heredity: (id) => (id.startsWith("heredity-scaf") || id.startsWith("heredity-pos") ? "strong" : "flat"),
  bio: new Set(),
  missing: new Set(),
  ...o,
});

/** Override some values of a plan function by id. */
const reg1Over = <T,>(base: (id: string) => T, over: Record<string, T>) => (id: string): T => (id in over ? over[id] : base(id));

/**
 * S3's crossing times on 128 fragments of 16 donor families: "strong" gives each family its own T (100 (f + 1)) with covariates that
 * vary, so the ICC is high and p = 1/1001; "flat" gives every family the same T's (100..800) with constant covariates, so the family
 * means are equal and the ICC is negative (tested, not significant).
 */
function reg1HeredityFragments(kind: "strong" | "flat"): R1dPrimeFragment[] {
  return Array.from({ length: 128 }, (_, k) => {
    const T = kind === "strong" ? 100 * (1 + (k % 16)) : 100 * (1 + Math.floor(k / 16));
    return { family: k % 16, retMass: kind === "strong" ? 1000 + ((k * 37) % 500) : 1000, retE: kind === "strong" ? 50 + ((k * 13) % 40) : 50, truncated: false, T, endTrait: 30_000, tauTrait: T <= 4100 ? 30_000 : 0 };
  });
}

/** A set's rows: replicate s's ponds 0..63 in order, the first `successes` rows succeeding (S2's rows carry no flag). */
function reg1Rows(o: { assay: string; inoculum: string; replicates: number; successes?: number; endTrait?: (k: number) => number; family?: (k: number) => number; retMass?: (k: number) => number; retE?: (k: number) => number }): AssayRow[] {
  return Array.from({ length: o.replicates * 64 }, (_, k) => ({
    assay: o.assay,
    source: "t",
    replicate: Math.floor(k / 64),
    pond: k % 64,
    family: o.family?.(k) ?? -1,
    inoculum: o.inoculum,
    reqMass: 100,
    retMass: o.retMass?.(k) ?? 100 + 50 * (k % 7),
    reqE: 200,
    retE: o.retE?.(k) ?? 50 + (k % 5),
    truncated: 0,
    endTrait: o.endTrait?.(k) ?? 0,
    success: o.successes === undefined ? -1 : k < o.successes ? 1 : 0,
  }));
}

const REG1_INOCULUM: Record<string, string> = { source: "fragment", quench: "quenched", "ge-on-fa": "swap-ea", "ga-on-fa": "swap-aa", "ga-on-fe": "swap-ae", "garden-raw": "fragment", "garden-disc": "disc", heredity: "fragment" };
/** A dominant evolved genome's words (any 8-hex-digit words other than the ancestor's). */
const REG1_EA_WORDS = (R3REP_SWAP_AE_WORDS[0] === "0" ? "1" : "0") + R3REP_SWAP_AE_WORDS.slice(1);
/** Stand-in state hashes of the bundles' checkpoints, the same in the manifests and in the sets' provenance. */
const reg1Hash = (bundle: string, checkpoint: string) => `${bundle}-${checkpoint}`;

/** A set's rows under a plan (S3's from its fragments). */
function reg1PlanRows(w: Reg1ReportExpectedSet, plan: Reg1Plan): AssayRow[] {
  const kind = w.labels.set;
  if (kind === "heredity") {
    const h = plan.heredity(w.id);
    if (h === "insufficient") return [];
    const f = reg1HeredityFragments(h);
    return reg1Rows({ assay: "transmission", inoculum: "fragment", replicates: 2, family: (k) => f[k].family, retMass: (k) => f[k].retMass, retE: (k) => f[k].retE, endTrait: (k) => f[k].endTrait });
  }
  if (plan.bio.has(w.id)) return [];
  if (w.assay === "garden") return reg1Rows({ assay: "garden", inoculum: REG1_INOCULUM[kind], replicates: w.replicates, endTrait: () => plan.gardenTrait(w.id) });
  return reg1Rows({ assay: "competence", inoculum: REG1_INOCULUM[kind], replicates: w.replicates, successes: plan.successes(w.id) });
}

/** S3's sets by id and pattern, shared between readouts: a screened set is never changed, and the rule keeps R1''s statistic per set object. */
const reg1HereditySets = new Map<string, Reg1ReportSet>();

/** The screened sets of a plan, built directly (the rule's input without the screen). */
function reg1Sets(plan: Reg1Plan): Reg1ReportSet[] {
  return reg1ReportExpectedSets()
    .filter((w) => !plan.missing.has(w.id))
    .map((w) => {
      const kind = w.labels.set;
      const h = kind === "heredity" ? plan.heredity(w.id) : null;
      const key = `${w.id}|${h}`;
      if (h !== null && reg1HereditySets.has(key)) return reg1HereditySets.get(key)!;
      const set: Reg1ReportSet = {
        id: w.id,
        dir: `/assays/${w.id}`,
        expected: w,
        biological: plan.bio.has(w.id),
        rows: reg1PlanRows(w, plan),
        heredity: h === null ? null : h === "insufficient" ? { insufficient: true, censored: 10_100, fragments: [] } : { insufficient: false, censored: 10_100, fragments: reg1HeredityFragments(h) },
      };
      if (h !== null) reg1HereditySets.set(key, set);
      return set;
    });
}

/** The hosts of the device check: the Mac (the reference) and instances 1-3, which ran i = 0-7, 8-15 and 16-23. */
const REG1_HOSTS = {
  mac: { host: "deno 2.5.2 darwin-aarch64", adapter: "apple m2" },
  1: { host: "deno 2.5.2 linux-x86_64", adapter: "nvidia a10g (1)" },
  2: { host: "deno 2.5.2 linux-x86_64", adapter: "nvidia a10g (2)" },
  3: { host: "deno 2.5.2 linux-x86_64", adapter: "nvidia a10g (3)" },
} as const;
const reg1InstanceOf = (i: number): 1 | 2 | 3 => (i < 8 ? 1 : i < 16 ? 2 : 3);

/** Every expected run bundle, resolved with stand-in hashes and an untruncated ponds.tsv, except those named. */
function reg1RunsFixture(o: { unresolved?: ReadonlySet<string>; flagged?: ReadonlySet<string> } = {}): Reg1ReportRun[] {
  return reg1ReportExpectedRuns().map(({ id, arm, history }) => {
    const bad = o.unresolved?.has(id) ?? false;
    const rows = arm === "ancestor" ? 64 : 6400;
    return {
      id,
      arm,
      history,
      dir: bad ? null : `/runs/${id}`,
      resolved: !bad,
      why: bad ? ["no run bundle"] : [],
      hashes: { b001: reg1Hash(id, "b001"), b034: reg1Hash(id, "b034"), b100: reg1Hash(id, "b100"), init: reg1Hash(id, "init") },
      censusEvery: 1000,
      host: bad ? null : REG1_HOSTS[reg1InstanceOf(history)],
      trajectory: bad ? null : { boundaries: [{ boundary: arm === "ancestor" ? 1 : 100, n: 64, meanTrait: 5000, extinct: 2 }], truncation: truncationOf(o.flagged?.has(id) ? Math.floor(rows / 100) + 1 : 0, rows), endedAt: null },
    };
  });
}

const REG1_DEVICE_OK: Reg1ReportDevice = { passed: true, reasons: [], finalHash: "f", mac: "/mac", bundles: [], uncovered: [] };
const REG1_REPRO_OK: Reg1ReportReproducibility = { passed: true, reasons: [], draws: [], histories: [], skipped: [] };

function reg1Readout(o: { plan?: Partial<Reg1Plan>; runs?: Reg1ReportRun[]; device?: Reg1ReportDevice | null; repro?: Reg1ReportReproducibility; budgetStopped?: boolean; queue?: ReturnType<typeof reg1ReportQueueCheck> } = {}): Record<string, any> {
  return reg1ReportReadout({ sets: reg1Sets(reg1Plan(o.plan)), rejected: [], runs: o.runs ?? reg1RunsFixture(), device: o.device === undefined ? REG1_DEVICE_OK : o.device, reproducibility: o.repro ?? REG1_REPRO_OK, budgetStopped: o.budgetStopped, queue: o.queue });
}

/** An assay.json as scaffold-assays --reg1 is to write it for `w` (the fields the screen reads), with its provenance recorded. */
function reg1SetJson(w: Reg1ReportExpectedSet, o: { rows: number; bio?: boolean; insufficient?: boolean; hash?: (bundle: string, checkpoint: string) => string } = { rows: 0 }): Record<string, any> {
  const kind = w.labels.set;
  const inoculum = REG1_INOCULUM[kind];
  const hash = o.hash ?? reg1Hash;
  /** A bundle's checkpoint as the assay records it; a continuation with its sidecar and origin, as continue --reg1 writes them. */
  const src = (x: Reg1ReportExpectedSet["sources"][number]): Record<string, unknown> => {
    if (x.checkpoint !== "continuation") return { source: `/runs/${x.bundle}/${x.checkpoint}`, stateHash: hash(x.bundle, x.checkpoint) };
    const arm = x.bundle.slice(0, x.bundle.indexOf("-i")) as Reg1ReportArm;
    const history = Number(x.bundle.slice(-2));
    const boundary = arm === "ancestor" ? 1 : 100;
    const mutRate = pondConfig(8, 0).mutRate;
    const origin = { source: `/runs/${x.bundle}/b${String(boundary).padStart(3, "0")}`, boundary, stateHash: hash(x.bundle, arm === "ancestor" ? "b001" : "b100"), seed: reg1ReportWorldSeed(arm, history), step: boundary * 10_000 };
    const end = { source: `/runs/scaffold/reg1/cont200k/${x.bundle}.blck.gz`, stateHash: `${x.bundle}-cont200k`, seed: reg1ReportContinuationSeed(w.labels.h), mutRate, step: origin.step + 200_000, tilesX: 8, tilesY: 8 };
    const continuation = { reg1: true, arm, history, h: w.labels.h, boundary, source: origin.source, sourceStateHash: origin.stateHash, sourceSeed: origin.seed, sourceStep: origin.step, seed: end.seed, steps: 200_000, mutRate, censusEvery: 100, endStateHash: end.stateHash, endStep: end.step, protocolSha256Reg1: REG1_REPORT_PROTOCOL.sha256 };
    return { ...end, origin, continuation };
  };
  /** An S3 control's world as R1'' records it: the P2 ranking world s or the clone world j at b1-pre, before its cycle. */
  const control = (h: number) => {
    const positive = h < 50;
    const world = positive ? h - 48 : h - 50;
    const phase = { postCycle: false, totalC: 5, totalS: 5, carrying: 10, outsideWindow: 3 };
    return { source: positive ? `/runs/scaffold/p2/rank/s${world}/ckpt/b1-pre.blck.gz` : `/runs/scaffold/reg1/neg/j${world}/ckpt/b1-pre.blck.gz`, stateHash: "control", seed: positive ? 4_805_001 + world : 4_880_001 + world, mutRate: 0, step: 10_000, tilesX: 8, tilesY: 8, distinctGenomes: positive ? 12 : 1, phase };
  };
  const provenance = w.sources.length === 0 ? control(w.labels.h) : { ...src(w.sources[0]), ...(w.sources[1] ? { donor: { ...src(w.sources[1]), dominant: o.bio ? null : { id: "1:2", hi: 1, lo: 2, words: REG1_EA_WORDS } } } : {}) };
  return {
    tool: "scaffold-assays",
    assay: w.assay,
    source: provenance.source,
    k: 8,
    period: 10_000,
    ref: w.assay === "transmission" ? null : 103_058,
    side: 8,
    replicates: w.replicates,
    mutRate: 0,
    censusEvery: 100,
    inoculum,
    seeds: w.seeds,
    labels: w.labels,
    ...(w.assay === "competence" ? { quench: kind === "quench", swap: kind === "source" || kind === "quench" ? null : { label: inoculum, from: "x", words: kind === "ge-on-fa" ? (o.bio ? null : REG1_EA_WORDS) : R3REP_SWAP_AE_WORDS } } : {}),
    ...(w.assay === "transmission" ? { donorSeed: w.donorSeed, traitsRecorded: true, ...(o.insufficient ? { insufficient: true } : {}) } : {}),
    ...(o.bio ? { biologicallyUnavailable: { reason: "no dominant genome", donor: src(w.sources[1]).source, donorStateHash: hash(w.sources[1].bundle, "b100") } } : {}),
    provenance,
    protocolSha256Reg1: REG1_REPORT_PROTOCOL.sha256,
    summary: { rows: o.rows },
  };
}

/** traits.tsv for an S3 set's rows: every fragment's trait at every census step, 30,000 from its crossing time on. */
function reg1TraitsText(rows: readonly AssayRow[], kind: "strong" | "flat" | "insufficient"): string {
  const lines = ["replicate\tpond\tstep\ttrait"];
  if (kind !== "insufficient") {
    const f = reg1HeredityFragments(kind);
    for (let step = 100; step <= 10_000; step += 100) rows.forEach((r, k) => lines.push(`${r.replicate}\t${r.pond}\t${step}\t${step >= f[k].T ? 30_000 : 0}`));
  }
  return lines.join("\n") + "\n";
}

const reg1RowsText = (rows: readonly AssayRow[]): string => [ASSAY_COLUMNS.join("\t"), ...rows.map((r) => ASSAY_COLUMNS.map((c) => String(r[c])).join("\t"))].join("\n") + "\n";

/** A screen input for `id` under a plan: its assay.json (with `json` merged over) and rows; S3's traits read as the CLI reads them. */
async function reg1Dir(id: string, o: { plan?: Partial<Reg1Plan>; json?: Record<string, unknown>; dir?: string } = {}): Promise<Reg1ReportSetDir> {
  const plan = reg1Plan(o.plan);
  const w = reg1ReportExpectedSet(id)!;
  const rows = reg1PlanRows(w, plan);
  const h = w.labels.set === "heredity" ? plan.heredity(id) : null;
  const json = { ...reg1SetJson(w, { rows: rows.length, bio: plan.bio.has(id), insufficient: h === "insufficient" }), ...o.json };
  const traits = h === null ? null : await readTraits(tsvRows(reg1TraitsText(rows, h).split("\n")), undefined, { replicates: 2, ponds: 64 });
  return { dir: o.dir ?? `/assays/${id}`, json, rows, traits };
}

/** A run bundle's manifest.json as tools/run.ts writes it for the registration (`over` merged over it). */
function reg1Manifest(kind: "hist" | "anc" | "repro" | "device", arm: Reg1ReportArm, i: number, hashes: Record<string, string> = {}, over: Record<string, unknown> = {}): Record<string, any> {
  const shape = { hist: { steps: 1_000_000, pre: [34, 100] }, anc: { steps: 10_000, pre: [1] }, repro: { steps: 340_000, pre: [34] }, device: { steps: 20_000, pre: null } }[kind];
  const condition = kind === "device" ? "treatment" : REG1_REPORT_CONDITIONS[arm];
  const seed = kind === "device" ? REG1_REPORT_SEEDS.device : reg1ReportWorldSeed(arm, i);
  const id = reg1ReportHistoryId(arm, i);
  const b = (x: number) => `b${String(x).padStart(3, "0")}`;
  return {
    runId: `${kind}/ponds/${condition}/seed-${seed}`,
    spec: { experiment: kind, presetId: "ponds", condition, seed, steps: shape.steps, censusEvery: 1000, deepEvery: 10, checkpointEvery: 0, ...(shape.pre ? { preCycleCheckpoints: shape.pre } : {}) },
    cfg: { mutRate: 429_497, pondPeriod: 10_000, tilesX: 8, tilesY: 8, pondArm: kind === "device" ? "scaf" : arm === "ancestor" ? "cont" : arm },
    presetIdentity: "56526b894cfccf3f",
    initHash: hashes.init ?? reg1Hash(id, "init"),
    host: kind === "repro" ? REG1_HOSTS.mac : kind === "device" ? REG1_HOSTS[1] : REG1_HOSTS[reg1InstanceOf(i)],
    startStep: 0,
    checkpoints: [],
    ...(shape.pre ? { preCycleCheckpoints: shape.pre.map((x) => ({ boundary: x, step: x * 10_000, file: `checkpoints/${b(x)}-pre.blck`, hash: hashes[b(x)] ?? reg1Hash(id, b(x)) })) } : {}),
    summary: { steps: shape.steps, finalHash: "final", conservationOk: true },
    finishedAt: "2026-10-02T00:00:00.000Z",
    ...over,
  };
}

describe("reg1 seeds and sets", () => {
  it("follows the document's seed formulas at their corners, with its maxima and range checks", () => {
    expect([reg1ReportWorldSeed("scaf", 0), reg1ReportWorldSeed("rand", 0), reg1ReportWorldSeed("cont", 23), reg1ReportWorldSeed("ancestor", 0), reg1ReportWorldSeed("ancestor", 23)]).toEqual([4_850_001, 4_850_101, 4_850_224, 4_850_401, 4_850_424]);
    expect([reg1ReportH("scaf", 0), reg1ReportH("rand", 0), reg1ReportH("cont", 23), reg1ReportH("ancestor", 0), reg1ReportH("ancestor", 23)]).toEqual([0, 24, 71, 72, 95]);
    expect([reg1ReportContinuationSeed(0), reg1ReportContinuationSeed(95)]).toEqual([4_850_501, 4_850_596]);
    expect([reg1ReportCompetenceSeed(0, 0, 0), reg1ReportCompetenceSeed(95, 1, 3), reg1ReportCompetenceSeed(95, 0, 7)]).toEqual([4_851_001, 4_860_514, 4_860_508]);
    expect([reg1ReportGardenSeed(0, 0, 0, 0), reg1ReportGardenSeed(47, 1, 1, 1)]).toEqual([4_861_001, 4_865_732]);
    expect([reg1ReportHereditySeed(0, 0), reg1ReportHereditySeed(53, 9)]).toEqual([4_866_001, 4_879_260]);
    // s 4-7 only for the swap pair (h 72-95 at timing a)
    for (const bad of [() => reg1ReportCompetenceSeed(0, 0, 4), () => reg1ReportCompetenceSeed(72, 1, 4), () => reg1ReportCompetenceSeed(96, 0, 0), () => reg1ReportCompetenceSeed(0, 2, 0)]) expect(bad).toThrow(/reg1ReportCompetenceSeed/);
    for (const bad of [() => reg1ReportGardenSeed(48, 0, 0, 0), () => reg1ReportGardenSeed(0, 0, 0, 2), () => reg1ReportHereditySeed(54, 0), () => reg1ReportHereditySeed(0, 2), () => reg1ReportContinuationSeed(96), () => reg1ReportWorldSeed("scaf", 24)]) expect(bad).toThrow();
  });

  it("lists the 558 sets, each named by its own labels, every seed in the block and none colliding across formulas", () => {
    const sets = reg1ReportExpectedSets();
    expect(sets).toHaveLength(558);
    const count = (kind: string) => sets.filter((w) => w.labels.set === kind).length;
    expect([count("source"), count("ge-on-fa"), count("ga-on-fa"), count("ga-on-fe"), count("quench"), count("garden-raw"), count("garden-disc"), count("heredity")]).toEqual([192, 24, 24, 24, 48, 96, 96, 54]);
    expect(new Set(sets.map((w) => w.id)).size).toBe(558);
    for (const w of sets) {
      expect(reg1ReportSetIdOf(w.labels)).toEqual({ id: w.id });
      expect(reg1ReportLabelProblems(w.labels as unknown as Record<string, unknown>, w)).toEqual([]);
      expect(w.seeds).toHaveLength(w.replicates);
    }
    // the swap pair: h = 72 + i, 8 replicates, the first four the ancestor's own fragments at (a)
    const ge = reg1ReportExpectedSet("scaf-i05-ge-on-fa")!;
    expect(ge.labels).toMatchObject({ arm: "scaf", history: 5, timing: "a", h: 77 });
    expect(ge.seeds.slice(0, 4)).toEqual(reg1ReportExpectedSet("ancestor-i05-a")!.seeds);
    expect(reg1ReportExpectedSet("scaf-i05-ga-on-fa")!.seeds).toEqual(ge.seeds);
    expect(reg1ReportExpectedSet("scaf-i05-ga-on-fe")!.seeds).toEqual(reg1ReportExpectedSet("scaf-i05-a")!.seeds);
    expect(reg1ReportExpectedSet("scaf-i05-quench-b")!.seeds).toEqual(reg1ReportExpectedSet("scaf-i05-b")!.seeds);
    // S2: both inocula sample their fragments with v = 0; S3: donors on s = 9
    expect(reg1ReportExpectedSet("garden-rand-i02-t1-disc")!.seeds[1]).toEqual({ physics: reg1ReportGardenSeed(26, 1, 1, 1), fragment: reg1ReportGardenSeed(26, 1, 0, 1) });
    expect(reg1ReportExpectedSet("heredity-neg-j3")!).toMatchObject({ labels: { arm: "control", control: "negative", h: 53, history: null }, donorSeed: 4_879_260 });
    // every seed in the reserved block, and the formulas' ranges disjoint from each other and from the single draws
    const all = sets.flatMap((w) => [...w.seeds.flatMap((x) => [x.physics, x.fragment]), ...(w.donorSeed === null ? [] : [w.donorSeed])]);
    expect(Math.min(...all)).toBeGreaterThanOrEqual(4_850_001);
    expect(Math.max(...all)).toBeLessThanOrEqual(4_899_999);
    const ranges = [[4_850_001, 4_850_224], [4_850_401, 4_850_424], [4_850_501, 4_850_596], [4_851_001, 4_860_514], [4_861_001, 4_865_732], [4_866_001, 4_879_260], [4_880_001, 4_880_004]];
    for (let a = 0; a < ranges.length; a++) for (let b = a + 1; b < ranges.length; b++) expect(ranges[a][1] < ranges[b][0] || ranges[b][1] < ranges[a][0]).toBe(true);
    for (const draw of [REG1_REPORT_SEEDS.reproducibility, REG1_REPORT_SEEDS.bootstrap, REG1_REPORT_SEEDS.device]) expect(ranges.some(([lo, hi]) => draw >= lo && draw <= hi)).toBe(false);
  });

  it("names a set only from labels that agree with it in full", () => {
    expect(reg1ReportSetIdOf({ reg1: true, set: "source", arm: "cont", history: 7, timing: "b", time: null, h: 55, control: null })).toEqual({ id: "cont-i07-b" });
    expect(reg1ReportSetIdOf({ reg1: true, set: "heredity", arm: "control", history: null, h: 49, control: "positive" })).toEqual({ id: "heredity-pos-s1" });
    expect(reg1ReportSetIdOf({ reg1: true, set: "ge-on-fa", arm: "rand", history: 1, timing: "a", h: 73 })).toMatchObject({ error: expect.stringMatching(/labels scaf history/) });
    expect(reg1ReportSetIdOf({ r3rep: true })).toEqual({ error: "labels.reg1 is not true" });
    // the swap pair's h is 72 + i, not the history's own
    const w = reg1ReportExpectedSet("scaf-i03-ga-on-fa")!;
    expect(reg1ReportLabelProblems({ ...w.labels, h: 3 }, w)).toEqual(["labels.h 3, want 75 for scaf-i03-ga-on-fa"]);
  });
});

describe("reg1 exact tests against brute force", () => {
  /** Midranks of `xs` (1-based, ties averaged). */
  const midranks = (xs: number[]) => {
    const order = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };

  it("mannWhitney(…, 'exact').pGreater with ties equals the full enumeration of label permutations", () => {
    const cases: [number[], number[]][] = [
      [[3, 1, 2, 2], [2, 0, 1, 1, 2]],
      [[0.5, 0.5, 0.25], [0.5, 0.25, 0.25, 0]],
      [[1, 1, 1], [1, 1]],
      [[5, 4], [3, 2, 1, 1]],
      [[60 / 256, 61 / 256, 61 / 256, 70 / 256, 58 / 256], [61 / 256, 58 / 256, 50 / 256, 61 / 256, 49 / 256, 70 / 256]],
    ];
    for (const [a, b] of cases) {
      const all = [...a, ...b];
      const r2 = midranks(all).map((x) => Math.round(2 * x));
      const obs = r2.slice(0, a.length).reduce((s, x) => s + x, 0);
      let total = 0;
      let ge = 0;
      // every way to label a.length of the values as group a
      for (let mask = 0; mask < 1 << all.length; mask++) {
        let bits = 0;
        let sum = 0;
        for (let i = 0; i < all.length; i++) if (mask & (1 << i)) {
          bits++;
          sum += r2[i];
        }
        if (bits !== a.length) continue;
        total++;
        if (sum >= obs) ge++;
      }
      expect(mannWhitney(a, b, "exact").pGreater).toBeCloseTo(ge / total, 12);
    }
  });

  it("the sign test is the binomial tail at one half, over every sign assignment; 19 of 24 gives 0.0033 and 18 gives 0.011", () => {
    for (let n = 1; n <= 12; n++) {
      for (let k = 0; k <= n + 1; k++) {
        let ge = 0;
        for (let mask = 0; mask < 1 << n; mask++) {
          let bits = 0;
          for (let i = 0; i < n; i++) if (mask & (1 << i)) bits++;
          if (bits >= k) ge++;
        }
        expect(reg1ReportSignTest(k, n)).toBe(ge / 2 ** n);
      }
    }
    expect(reg1ReportSignTest(19, 24)).toBe(55_455 / 2 ** 24);
    expect(reg1ReportSignTest(19, 24)).toBeCloseTo(0.0033, 4);
    expect(reg1ReportSignTest(18, 24)).toBeCloseTo(0.011, 3);
  });

  it("S3's binomial tail under 0.05 per history equals the enumeration of outcomes; 5 of 24 gives 0.006 and 6 gives 0.001", () => {
    const n = 4;
    const counts = new Array<number>(n + 1).fill(0);
    // each history draws one of 20 equally likely outcomes, outcome 0 being significant
    for (let x = 0; x < 20 ** n; x++) {
      let hits = 0;
      for (let v = x, i = 0; i < n; i++, v = Math.floor(v / 20)) if (v % 20 === 0) hits++;
      counts[hits]++;
    }
    for (let k = 0; k <= n + 1; k++) expect(binomialUpperTail(k, n, 1, 20)).toBeCloseTo(counts.slice(k).reduce((s, c) => s + c, 0) / 20 ** n, 15);
    expect(binomialUpperTail(5, 24, 1, 20)).toBeCloseTo(0.006, 3);
    expect(binomialUpperTail(6, 24, 1, 20)).toBeCloseTo(0.001, 3);
    expect(() => binomialUpperTail(1, 2, 3, 2)).toThrow();
  });
});

describe("reg1 run bundles", () => {
  it("knows a bundle by its seed and checks its manifest: experiment, runId and path, spec, identity, config and pre-cycle checkpoints", () => {
    const m = reg1Manifest("hist", "rand", 4);
    const role = reg1ReportBundleRoleOf(m);
    expect(role).toEqual({ role: { role: "history", arm: "rand", history: 4, id: "rand-i04" } });
    if (!("role" in role)) throw new Error("no role");
    expect(reg1ReportBundleProblems(m, role.role, "/x/runs/scaffold/reg1/hist/ponds/pond-rand/seed-4850105")).toEqual([]);
    expect(reg1ReportBundleRoleOf(reg1Manifest("anc", "ancestor", 3))).toEqual({ role: { role: "ancestor", arm: "ancestor", history: 3, id: "ancestor-i03" } });
    expect(reg1ReportBundleRoleOf(reg1Manifest("repro", "scaf", 14))).toEqual({ role: { role: "repro", arm: "scaf", history: 14, id: "scaf-i14" } });
    expect(reg1ReportBundleRoleOf(reg1Manifest("device", "scaf", 0))).toEqual({ role: { role: "device" } });
    expect(reg1ReportBundleRoleOf({ spec: { seed: 4_811_001 } })).toMatchObject({ why: expect.stringMatching(/not a registration history/) });
    const problems = (over: Record<string, unknown>, dir?: string) => reg1ReportBundleProblems({ ...m, ...over }, role.role, dir).join("; ");
    const { summary: _s, ...unfinished } = m;
    expect(reg1ReportBundleProblems(unfinished, role.role).join("; ")).toMatch(/did not finish/);
    expect(problems({ summary: { ...m.summary, conservationOk: false } })).toMatch(/conservationOk false/);
    expect(problems({ spec: { ...m.spec, experiment: "scaffold/reg1/hist" } })).toMatch(/spec.experiment "scaffold\/reg1\/hist", want hist or hist-c100/);
    // census 100 only under hist-c100, the repeat of a run that stopped on an event-buffer overflow
    expect(problems({ spec: { ...m.spec, censusEvery: 100 } })).toMatch(/spec.censusEvery 100, want 1000 under experiment hist/);
    const c100 = { spec: { ...m.spec, experiment: "hist-c100", censusEvery: 100 }, runId: "hist-c100/ponds/pond-rand/seed-4850105" };
    expect(problems(c100, "/x/runs/scaffold/reg1/hist-c100/ponds/pond-rand/seed-4850105")).toBe("");
    expect(problems({ ...c100, spec: { ...c100.spec, censusEvery: 1000 } })).toMatch(/spec.censusEvery 1000, want 100 under experiment hist-c100/);
    expect(problems({ spec: { ...m.spec, censusEvery: 500 } })).toMatch(/spec.censusEvery 500/);
    expect(problems({ spec: { ...m.spec, condition: "treatment" } })).toMatch(/spec.condition "treatment", want "pond-rand"/);
    expect(problems({ spec: { ...m.spec, overrides: { mutRate: 0 } } })).toMatch(/spec.overrides is set/);
    expect(problems({ cfg: { ...m.cfg, mutRate: 0 } })).toMatch(/cfg.mutRate 0, want 429497/);
    expect(problems({ presetIdentity: "x" })).toMatch(/presetIdentity "x"/);
    expect(problems({ preCycleCheckpoints: m.preCycleCheckpoints.slice(0, 1) })).toMatch(/lists 1 preCycleCheckpoints, want 2/);
    expect(problems({ preCycleCheckpoints: [m.preCycleCheckpoints[0], { ...m.preCycleCheckpoints[1], step: 990_000 }] })).toMatch(/preCycleCheckpoints\[1\]/);
    expect(problems({}, "/x/runs/scaffold/reg1/hist/ponds/pond-rand/seed-4850106")).toMatch(/does not end in hist\/ponds\/pond-rand\/seed-4850105/);
  });

  it("takes the one finished bundle of a history: a census-100 repeat supersedes the overflowed run, and two finished ones are refused", () => {
    const hist = { dir: "/r/hist/ponds/treatment/seed-4850001", manifest: reg1Manifest("hist", "scaf", 0) };
    const { summary: _s, finishedAt: _f, ...overflowed } = hist.manifest;
    const stopped = { dir: hist.dir, manifest: overflowed };
    const c100 = { dir: "/r/hist-c100/ponds/treatment/seed-4850001", manifest: { ...hist.manifest, runId: "hist-c100/ponds/treatment/seed-4850001", spec: { ...hist.manifest.spec, experiment: "hist-c100", censusEvery: 100 } } };
    expect(reg1ReportPickBundle([stopped, c100])).toEqual({ pick: c100, superseded: [stopped], why: null });
    expect(reg1ReportPickBundle([hist])).toEqual({ pick: hist, superseded: [], why: null });
    expect(reg1ReportPickBundle([stopped])).toEqual({ pick: stopped, superseded: [], why: null });
    expect(reg1ReportPickBundle([hist, c100]).why).toBe(`2 finished run bundles (${hist.dir}, ${c100.dir}); neither is used`);
    expect(reg1ReportPickBundle([stopped, { ...stopped, dir: c100.dir }]).why).toMatch(/^2 unfinished run bundles .* and none finished$/);
    expect(reg1ReportPickBundle([])).toEqual({ pick: null, superseded: [], why: "no run bundle" });
  });

  it("streams ponds.tsv into the trajectory, requiring one row per pond at every boundary, and finds where a history ended", async () => {
    const lines = (cycles: number[], ponds: number, donor: (c: number) => number = () => 0) => ["cycle\trecipient\tdonor\ttruncated\trecipientTrait", ...cycles.flatMap((c) => Array.from({ length: ponds }, (_, r) => `${c}\t${r}\t${donor(c)}\t${r === 0 && c === 1 ? 1 : 0}\t${r === 1 ? 0 : 100 * c}`))];
    const t = await reg1ReportTrajectory(tsvRows(lines([1, 2, 3], 4, (c) => (c >= 2 ? -1 : 2))), { ponds: 4, cycles: 3 }, true);
    expect(t.boundaries).toEqual([{ boundary: 1, n: 4, meanTrait: 75, extinct: 1 }, { boundary: 2, n: 4, meanTrait: 150, extinct: 1 }, { boundary: 3, n: 4, meanTrait: 225, extinct: 1 }]);
    expect(t.truncation).toMatchObject({ truncated: 1, rows: 12, flagged: true });
    expect(t.endedAt).toBe(2);
    expect((await reg1ReportTrajectory(tsvRows(lines([1], 4, () => -1)), { ponds: 4, cycles: 1 }, false)).endedAt).toBeNull();
    await expect(reg1ReportTrajectory(tsvRows(lines([1, 2], 4)), { ponds: 4, cycles: 3 }, true)).rejects.toThrow(/cycle 3 has 0 rows, want 4/);
    await expect(reg1ReportTrajectory(tsvRows(lines([1, 2, 3], 3)), { ponds: 4, cycles: 3 }, true)).rejects.toThrow(/cycle 1 has 3 rows, want 4/);
    await expect(reg1ReportTrajectory(tsvRows(lines([1, 2, 3, 4], 4)), { ponds: 4, cycles: 3 }, true)).rejects.toThrow(/has cycle 4, want only cycles 1..3/);
    // without `expect` the guard keeps its old behaviour: a short cycle passes
    const g = new RecipientGuard();
    g.add(1, 0);
    expect(() => g.finish()).not.toThrow();
  });

  it("the device check: four distinct bundles, the Mac's the one darwin host, one finalHash, and every run bundle's host among them", () => {
    const at = (dir: string, host: { host: string; adapter: string }, over: Record<string, unknown> = {}) => ({ dir: `/${dir}/device/ponds/treatment/seed-4880301`, manifest: reg1Manifest("device", "scaf", 0, {}, { host, ...over }) });
    const four = [at("mac", REG1_HOSTS.mac), at("i1", REG1_HOSTS[1]), at("i2", REG1_HOSTS[2]), at("i3", REG1_HOSTS[3])];
    const runs = reg1RunsFixture();
    expect(reg1ReportDeviceCheck(four, runs)).toMatchObject({ passed: true, reasons: [], finalHash: "final", mac: "/mac/device/ponds/treatment/seed-4880301", uncovered: [] });
    const fails = (bundles: ReturnType<typeof at>[], r: Parameters<typeof reg1ReportDeviceCheck>[1] = runs) => {
      const d = reg1ReportDeviceCheck(bundles, r);
      expect(d.passed).toBe(false);
      return d.reasons.join("; ");
    };
    expect(fails([four[0], four[1], four[2], at("i3", REG1_HOSTS[3], { summary: { steps: 20_000, finalHash: "other", conservationOk: true } })])).toMatch(/finalHash differs/);
    expect(fails(four.slice(0, 3))).toMatch(/^3 device check bundles, want 4: the Mac's and one per instance/);
    expect(fails([...four, at("i4", REG1_HOSTS[1])])).toMatch(/^5 device check bundles, want 4/);
    expect(fails([four[0], four[1], four[2], four[2]])).toMatch(/device check bundles share a directory: \/i2/);
    expect(fails([at("mac", REG1_HOSTS[1]), four[1], four[2], four[3]])).toMatch(/0 device check bundles ran on a host naming darwin, want exactly 1/);
    expect(fails([four[0], at("i1", REG1_HOSTS.mac), four[2], four[3]])).toMatch(/2 device check bundles ran on a host naming darwin/);
    expect(fails([four[0], four[1], four[2], { dir: "/i3", manifest: reg1Manifest("hist", "scaf", 0) }])).toMatch(/is not the device check's/);
    expect(fails([four[0], four[1], four[2], at("i3", REG1_HOSTS[3], { spec: { ...reg1Manifest("device", "scaf", 0).spec, steps: 10_000 } })])).toMatch(/spec.steps 10000/);
    // a run made on a host or adapter no device check reports
    const odd = runs.map((r) => (r.id === "rand-i09" ? { ...r, host: { host: REG1_HOSTS[2].host, adapter: "another gpu" } } : r));
    const d = reg1ReportDeviceCheck(four, odd);
    expect(d).toMatchObject({ passed: false, uncovered: ["rand-i09"] });
    expect(d.reasons[0]).toBe('1 run bundles ran on a host and adapter no device check reports (rand-i09; rand-i09 on "deno 2.5.2 linux-x86_64" with "another gpu")');
    // without the runs (nothing is analysed) only the device bundles are compared
    expect(reg1ReportDeviceCheck(four).passed).toBe(true);
  });

  it("selects the reproducibility histories by the draw, never replaced, and compares their b034-pre hashes", () => {
    // the first two distinct values of randomKey(4,880,101, 0, k, 0) mod 72
    const values: number[] = [];
    for (let k = 0; values.length < 2; k++) {
      const v = randomKey(4_880_101, 0, k, 0) % 72;
      if (!values.includes(v)) values.push(v);
    }
    const ids = values.map((v) => reg1ReportHistoryId((["scaf", "rand", "cont"] as const)[Math.floor(v / 24)], v % 24));
    const sel = reg1ReportReproSelection();
    expect(sel.selected.map((s) => s.id)).toEqual(ids);
    expect(ids).toEqual(["scaf-i14", "rand-i17"]);
    const runs = new Map(reg1RunsFixture().map((r) => [r.id, r]));
    const rerun = (id: string, hash = reg1Hash(id, "b034"), over: Record<string, unknown> = {}) => {
      const [arm, i] = [id.slice(0, 4) as Reg1ReportArm, Number(id.slice(-2))];
      const manifest = reg1Manifest("repro", arm, i, { b034: hash }, over);
      return { dir: `/mac/${manifest.runId}`, manifest };
    };
    const ok = reg1ReportReproducibility(runs, [rerun("scaf-i14"), rerun("rand-i17"), rerun("cont-i02")]);
    expect(ok).toMatchObject({ passed: true, reasons: [] });
    expect(ok.histories.map((h) => [h.id, h.passed, h.instanceHash, h.rerunHash])).toEqual([["scaf-i14", true, "scaf-i14-b034", "scaf-i14-b034"], ["rand-i17", true, "rand-i17-b034", "rand-i17-b034"]]);
    expect(ok.skipped).toEqual([{ dir: "/mac/repro/ponds/pond-cont/seed-4850203", why: "cont-i02 is not a selected history (scaf-i14, rand-i17)" }]);
    const fails = (reruns: ReturnType<typeof rerun>[], r = runs) => reg1ReportReproducibility(r, reruns).reasons.join("; ");
    expect(fails([rerun("scaf-i14", "other"), rerun("rand-i17")])).toMatch(/the rerun's b034-pre hash other is not the instance's scaf-i14-b034/);
    expect(fails([rerun("scaf-i14")])).toMatch(/no rerun of rand-i17/);
    expect(fails([rerun("scaf-i14"), rerun("rand-i17"), rerun("rand-i17")])).toMatch(/2 reruns of rand-i17/);
    expect(fails([rerun("scaf-i14", undefined, { summary: { steps: 340_000, finalHash: "x", conservationOk: false } }), rerun("rand-i17")])).toMatch(/the rerun of scaf-i14 is not valid: summary.conservationOk false/);
    // a rerun made anywhere but the Mac
    expect(fails([rerun("scaf-i14", undefined, { host: REG1_HOSTS[1] }), rerun("rand-i17")])).toMatch(/the rerun of scaf-i14 is not valid: it ran on host "deno 2.5.2 linux-x86_64", not the Mac's \(darwin\)/);
    // an unresolved selected history is never replaced: the check cannot be made
    const gone = new Map(reg1RunsFixture({ unresolved: new Set(["rand-i17"]) }).map((r) => [r.id, r]));
    expect(fails([rerun("scaf-i14"), rerun("rand-i17")], gone)).toMatch(/rand-i17 is unresolved, so the check cannot be made/);
  });
});

describe("reg1 screening", () => {
  const sha = REG1_REPORT_PROTOCOL.sha256;
  const screen = (dirs: Reg1ReportSetDir[], o: Partial<Parameters<typeof reg1ReportScreen>[1]> = {}) => reg1ReportScreen(dirs, { sha, ...o });

  it("accepts a set of every kind, S3's with its crossing times", async () => {
    const ids = ["scaf-i03-a", "ancestor-i03-b", "scaf-i03-ge-on-fa", "scaf-i03-ga-on-fa", "scaf-i03-ga-on-fe", "scaf-i03-quench-b", "garden-rand-i03-t0-raw", "garden-scaf-i03-t1-disc", "heredity-scaf-i03", "heredity-neg-j2"];
    const { accepted, rejected } = screen(await Promise.all(ids.map((id) => reg1Dir(id))));
    expect(rejected).toEqual([]);
    expect(accepted.map((s) => s.id)).toEqual(ids);
    const s3 = accepted.find((s) => s.id === "heredity-scaf-i03")!;
    expect(s3.heredity!.fragments.map((f) => f.T)).toEqual(reg1HeredityFragments("strong").map((f) => f.T));
    const none = screen([await reg1Dir("heredity-rand-i01", { plan: { heredity: () => "insufficient" } })]);
    expect(none.accepted[0].heredity).toEqual({ insufficient: true, censored: 10_100, fragments: [] });
  });

  it("refuses mis-seeded sets, a wrong h, the wrong replicates, a wrong protocol hash or source, and both of two sets for one id", async () => {
    const reasons = async (id: string, json: Record<string, unknown>, o: Partial<Parameters<typeof reg1ReportScreen>[1]> = {}) => screen([await reg1Dir(id, { json })], o).rejected.flatMap((r) => r.reasons).join("; ");
    const w = reg1ReportExpectedSet("scaf-i03-ge-on-fa")!;
    const seeds = w.seeds.map((x, s) => (s === 2 ? { ...x, physics: x.physics + 1 } : x));
    expect(await reasons("scaf-i03-ge-on-fa", { seeds })).toMatch(/seeds\[2\] .* do not match scaf-i03-ge-on-fa: want .*σ\(75, 0, s\)/);
    // the swap pair seeded as the scaf history's own sets (h = i): the labels and every seed are wrong
    expect(await reasons("scaf-i03-ga-on-fa", { labels: { ...w.labels, set: "ga-on-fa", h: 3 }, seeds: reg1ReportExpectedSet("scaf-i03-a")!.seeds })).toMatch(/labels.h 3, want 75 .*assay.json has 4 seeds, want 8/);
    expect(await reasons("garden-scaf-i00-t1-disc", { seeds: reg1ReportExpectedSet("garden-scaf-i00-t1-raw")!.seeds })).toMatch(/seeds\[0\]/);
    expect(await reasons("heredity-scaf-i00", { donorSeed: 4_866_001 + 8 })).toMatch(/donorSeed 4866009, want 4866010/);
    expect(await reasons("scaf-i03-a", { replicates: 2 })).toMatch(/replicates 2, want 4/);
    expect(await reasons("scaf-i03-a", { period: 3000, mutRate: 429_497 })).toMatch(/period 3000, want 10000; mutRate 429497, want 0/);
    expect(await reasons("scaf-i03-a", { protocolSha256Reg1: "0".repeat(64) })).toMatch(/protocolSha256Reg1 .* is not the pinned SHA-256/);
    expect(await reasons("scaf-i03-quench-a", { quench: false })).toMatch(/quench false, want true for quench/);
    expect(await reasons("scaf-i03-ga-on-fe", { swap: { label: "swap-ae", words: REG1_EA_WORDS } })).toMatch(/ga-on-fe plants the ancestor's genome/);
    // the recorded source must be the one its bundle's manifest records, once that bundle is resolved
    const bundles = new Map([["scaf-i03", { resolved: true, hashes: { b100: "elsewhere" } }]]);
    expect(await reasons("scaf-i03-ge-on-fa", {}, { bundles })).toMatch(/provenance.donor stateHash scaf-i03-b100 is not scaf-i03's b100-pre hash elsewhere/);
    expect(await reasons("scaf-i03-a", { provenance: { source: "x" } })).toMatch(/provenance records no stateHash/);
    // --allow-any-seed waives the seeds, regime, hash and provenance, not the labels
    expect(screen([await reg1Dir("scaf-i03-ge-on-fa", { json: { seeds, protocolSha256Reg1: "x" } })], { allowAnySeed: true }).rejected).toEqual([]);
    expect(screen([await reg1Dir("scaf-i03-a", { json: { labels: { reg1: true, set: "source", arm: "scaf", history: 3, timing: "a", h: 4 } } })], { allowAnySeed: true }).rejected[0].reasons).toEqual(["labels.h 4, want 3 for scaf-i03-a"]);
    // duplicates: neither is used
    const twice = screen([await reg1Dir("rand-i09-b", { dir: "/one" }), await reg1Dir("rand-i09-b", { dir: "/two" })]);
    expect(twice.accepted).toEqual([]);
    expect(twice.rejected.map((r) => [r.dir, r.id, r.reasons[0]])).toEqual([
      ["/one", "rand-i09-b", "the same registration set (rand-i09-b) as /two; a stage would count both"],
      ["/two", "rand-i09-b", "the same registration set (rand-i09-b) as /one; a stage would count both"],
    ]);
    // labels that name no set
    expect(screen([await reg1Dir("scaf-i03-a", { json: { labels: { reg1: true, set: "swap" } } })]).rejected[0]).toMatchObject({ id: null, reasons: [expect.stringMatching(/name no registration set/)] });
  });

  it("checks a timing (b) set's continuation (path, sidecar, origin), an S3 control's world and Ge-on-Fa's planted words against its donor", async () => {
    const reasons = async (id: string, edit: (j: Record<string, any>) => void, o: Partial<Parameters<typeof reg1ReportScreen>[1]> = {}) => {
      const d = await reg1Dir(id);
      edit(d.json);
      return screen([d], o).rejected.flatMap((r) => r.reasons).join("; ");
    };
    const bundles = new Map([["scaf-i03", { resolved: true, hashes: { b100: "scaf-i03-b100" } }], ["ancestor-i03", { resolved: true, hashes: { b001: "ancestor-i03-b001" } }]]);
    expect(await reasons("scaf-i03-b", () => {}, { bundles })).toBe("");
    expect(await reasons("ancestor-i03-b", () => {}, { bundles })).toBe("");
    expect(await reasons("scaf-i03-quench-b", () => {}, { bundles })).toBe("");
    expect(await reasons("scaf-i03-b", (j) => (j.provenance.source = "/elsewhere/scaf-i03.blck.gz"))).toMatch(/provenance source "\/elsewhere\/scaf-i03.blck.gz" does not end in scaffold\/reg1\/cont200k\/scaf-i03.blck.gz/);
    expect(await reasons("scaf-i03-b", (j) => Object.assign(j.provenance.continuation, { steps: 300, allowAnySeed: true }))).toMatch(/continuation steps 300, want 200000.*written under --allow-any-seed/);
    expect(await reasons("scaf-i03-b", (j) => (j.provenance.continuation.endStateHash = "x"))).toMatch(/the continued checkpoint's stateHash "scaf-i03-cont200k" is not the continuation's endStateHash "x"/);
    expect(await reasons("scaf-i03-b", (j) => (j.provenance.origin.stateHash = j.provenance.continuation.sourceStateHash = "y"), { bundles })).toMatch(/provenance.origin stateHash "y" is not scaf-i03's b100-pre hash scaf-i03-b100 in its manifest/);
    expect(await reasons("ancestor-i03-b", (j) => (j.provenance.origin.stateHash = j.provenance.continuation.sourceStateHash = "y"), { bundles })).toMatch(/is not ancestor-i03's b001-pre hash ancestor-i03-b001/);
    // S3's controls: their world's record, as R1'' checks its controls
    expect(await reasons("heredity-pos-s1", () => {})).toBe("");
    expect(await reasons("heredity-neg-j2", (j) => Object.assign(j.provenance, { step: 300, tilesX: 2 }))).toMatch(/source step 300, want 10000.*source has 2 x 8 ponds/);
    expect(await reasons("heredity-neg-j2", (j) => (j.provenance.distinctGenomes = 7))).toMatch(/source holds 7 distinct genomes, want 1 \(a clone world\)/);
    expect(await reasons("heredity-neg-j2", (j) => (j.source = "/other"))).toMatch(/is not the assay's source "\/other"/);
    expect(await reasons("heredity-pos-s0", (j) => delete j.provenance.phase)).toMatch(/no provenance of the control world with its phase check/);
    // Ge-on-Fa plants its donor's recorded dominant genome; a record without one names its donor's state
    expect(await reasons("scaf-i03-ge-on-fa", (j) => (j.provenance.donor.dominant.words = R3REP_SWAP_AE_WORDS))).toMatch(/swap words are not the donor's dominant genome/);
    const donors = new Map([["scaf-i03", { stateHash: "scaf-i03-b100", dominant: false }]]);
    const bio = async (edit: (j: Record<string, any>) => void) => {
      const d = await reg1Dir("scaf-i03-ge-on-fa", { plan: { bio: new Set(["scaf-i03-ge-on-fa"]) } });
      edit(d.json);
      return screen([d], { donors }).rejected.flatMap((r) => r.reasons).join("; ");
    };
    expect(await bio(() => {})).toBe("");
    expect(await bio((j) => (j.provenance.donor.dominant = { id: "1:2", hi: 1, lo: 2, words: REG1_EA_WORDS }))).toMatch(/provenance.donor.dominant .*want null/);
    expect(await bio((j) => (j.provenance.donor.stateHash = "z"))).toMatch(/donorStateHash scaf-i03-b100 is not provenance.donor.stateHash "z"/);
  });

  it("believes a Ge-on-Fa record without a dominant genome only once its donor is reloaded and seen to have none", async () => {
    const bio = await reg1Dir("scaf-i04-ge-on-fa", { plan: { bio: new Set(["scaf-i04-ge-on-fa"]) } });
    expect(bio.rows).toEqual([]);
    expect(screen([bio]).rejected[0].reasons).toEqual([expect.stringMatching(/needs its donor scaf-i04's b100-pre reloaded/)]);
    expect(screen([bio], { donors: new Map([["scaf-i04", { stateHash: "scaf-i04-b100", dominant: false }]]) })).toMatchObject({ rejected: [], accepted: [{ id: "scaf-i04-ge-on-fa", biological: true }] });
    expect(screen([bio], { donors: new Map([["scaf-i04", { stateHash: "scaf-i04-b100", dominant: true }]]) }).rejected[0].reasons).toEqual(["donor scaf-i04 has a dominant genome, so its Ge-on-Fa set is not biologically unavailable"]);
    expect(screen([bio], { donors: new Map([["scaf-i04", { error: "gone" }]]) }).rejected[0].reasons).toEqual(["donor scaf-i04's b100-pre could not be read: gone"]);
    // only Ge-on-Fa can be one
    const notSwap = await reg1Dir("scaf-i04-ga-on-fa", { json: { biologicallyUnavailable: { reason: "no dominant genome", donor: "x", donorStateHash: "y" } } });
    expect(screen([{ ...notSwap, rows: [] }]).rejected[0].reasons.join("; ")).toMatch(/only Ge-on-Fa can be biologically unavailable/);
  });
});

describe("reg1 decision procedure", () => {
  const range = (n: number, from = 0) => Array.from({ length: n }, (_, k) => from + k);
  /** Ge-on-Fa equal to Ga-on-Fa (g = 0, not positive) in the histories named. */
  const noGain = (is: number[]) => reg1Over(reg1Successes, Object.fromEntries(is.map((i) => [`${reg1ReportHistoryId("scaf", i)}-ge-on-fa`, 280 + i])));
  /** rand at (b) as competent as scaf, so scaf > rand at (b) fails. */
  const randLikeScaf = (base: (id: string) => number = reg1Successes) => reg1Over(base, Object.fromEntries(range(24).map((i) => [`${reg1ReportHistoryId("rand", i)}-b`, 200 + i])));

  it("H1 and H2 confirmed, with the secondaries beside the row", () => {
    const r = reg1Readout();
    expect(r).toMatchObject({ outcome: "H1 and H2 confirmed", withheld: false, withheldReason: null, budgetStopped: false, row: { outcome: "H1 and H2 confirmed", next: expect.stringMatching(/withdrawal ladder/) } });
    expect(r.primary.h1).toMatchObject({ status: "confirmed" });
    expect(r.primary.h1.p).toBeCloseTo(1 / 32_247_603_683_100, 25);
    expect(r.primary.h1.comparisons.map((c: any) => [c.other, c.timing, c.established, c.n])).toEqual((["a", "b"] as const).flatMap((t) => ["rand", "cont", "ancestor"].map((o) => [o, t, true, { scaf: 24, other: 24 }])));
    expect(r.primary.h2).toMatchObject({ status: "confirmed", positive: 24, n: 24, p: 2 ** -24 });
    const s = r.secondary;
    // S1 fails as the document expects: g = 20/512 is under half of the advantage 120/256
    expect(s.s1).toMatchObject({ status: "not confirmed", positive: 0, n: 24, ratio: { available: true, excluded: { unresolved: 0, noDominantGenome: 0, nonPositiveDenominator: 0 } } });
    expect(s.s1.ratio.median).toBeCloseTo(20 / 512 / (120 / 256), 12);
    expect(s.s1.ratio.interval).toEqual({ lower: s.s1.ratio.median, upper: s.s1.ratio.median, resamples: 10_000 });
    expect(s.s2a).toMatchObject({ status: "confirmed", positive: 24 });
    expect(s.s2b).toMatchObject({ status: "confirmed", n: { scaf: 24, rand: 24 }, unresolved: [], medians: { scaf: 1011.5, rand: 211.5 } });
    expect(s.s3).toMatchObject({ status: "confirmed", gates: { positivePassed: true, nullGatePassed: true }, arms: { scaf: { n: 24, demonstrated: 24 }, rand: { n: 24, demonstrated: 0 } } });
    expect(s.s3.p).toBe(binomialUpperTail(24, 24, 1, 20));
    expect(s.heritable).toBe(true);
    expect(r.validity).toMatchObject({ quenched: { max: 0, failed: false }, unresolved: { uninformative: false, arms: { scaf: { unresolved: 0 }, ancestor: { histories: 24, unresolved: 0 } } } });
    expect(r.truncation).toMatchObject({ flagged: [], unknown: [], sensitive: false, without: { outcome: "H1 and H2 confirmed" } });
    expect(r.availability).toMatchObject({ expected: 558, measured: 558, biological: 0, unresolved: 0 });
    expect(r.descriptive.competences).toHaveLength(312);
    expect(r.descriptive.competences.find((c: any) => c.id === "scaf-i02-ge-on-fa")).toMatchObject({ n: 512, successes: 302, perReplicate: [{ replicate: 0, n: 64, successes: 64 }, ...range(3, 1).map((replicate) => ({ replicate, n: 64, successes: 64 })), { replicate: 4, n: 64, successes: 46 }, ...range(3, 5).map((replicate) => ({ replicate, n: 64, successes: 0 }))] });
    expect(r.descriptive.gaOnFe[0]).toEqual({ id: "scaf-i00-ga-on-fe", status: "measured", successes: 100, n: 256, competence: 100 / 256 });
    expect(r.descriptive.garden.disc[0]).toEqual({ id: "scaf-i00", t0: 1000, tC: 2000, gain: 1000 });
    expect(r.descriptive.massBins.find((b: any) => b.arm === "scaf" && b.timing === "a").bins.map((b: any) => b.bin)).toEqual(["[64, 128)", "[128, 256)", "[256, 512)"]);
    // the side-by-side medians are over each arm's own sources only (not its quenched controls or swaps)
    expect(r.descriptive.sideBySide).toEqual({
      reg1: { histories: 24, a: { scaf: 211.5 / 256, rand: 111.5 / 256, cont: 101.5 / 256, ancestor: 91.5 / 256 }, b: { scaf: 211.5 / 256, rand: 111.5 / 256, cont: 101.5 / 256, ancestor: 91.5 / 256 }, geOnFaMinusAncestor: 128.5 / 512, g: 20 / 512, quenchedMax: 0 },
      v1: null,
      r3rep: null,
    });
  });

  it("H1 confirmed, H2 not: 18 of 24 genomes gain (p 0.011)", () => {
    const r = reg1Readout({ plan: { successes: noGain(range(6)) } });
    expect(r.outcome).toBe("H1 confirmed, H2 not");
    expect(r.primary.h2).toMatchObject({ status: "not confirmed", positive: 18 });
    expect(r.primary.h2.holm).toBeCloseTo(reg1ReportSignTest(18, 24), 15);
  });

  it("H2 confirmed, H1 not: scaf does not rank above rand at (b), and that comparison is named", () => {
    const r = reg1Readout({ plan: { successes: randLikeScaf() } });
    expect(r.outcome).toBe("H2 confirmed, H1 not");
    expect(r.primary.h1.status).toBe("not confirmed");
    expect(r.primary.h1.comparisons.filter((c: any) => !c.established).map((c: any) => [c.other, c.timing, c.uninformative])).toEqual([["rand", "b", false]]);
    expect(r.primary.h1.p).toBe(r.primary.h1.comparisons.find((c: any) => c.other === "rand" && c.timing === "b").p);
  });

  it("neither", () => {
    expect(reg1Readout({ plan: { successes: randLikeScaf(noGain(range(6))) } }).outcome).toBe("Neither");
  });

  it("invalid: a failed device check, a quenched set above 0.05 (13 of 256, not 12) or a failed reproducibility check, whatever else holds", () => {
    const device = reg1Readout({ device: { ...REG1_DEVICE_OK, passed: false, reasons: ["finalHash differs between the device check bundles"], finalHash: null } });
    // the row is settled by validity: no test statistic is printed and no truncation verdict; the validity, availability and descriptive parts stay
    expect(device).toMatchObject({ outcome: "Invalid", withheld: true, withheldReason: "the row is Invalid (Report; no claim): no test statistic is reported", primary: null, secondary: null, availability: { expected: 558 } });
    expect(device.descriptive.competences).toHaveLength(312);
    expect(device.truncation).toEqual({ limit: 0.01, flagged: [], unknown: [], without: null, sensitive: null });
    expect(device.reasons).toEqual(["device check failed: finalHash differs between the device check bundles"]);
    const quench = (n: number) => reg1Readout({ plan: { successes: reg1Over(reg1Successes, { "scaf-i03-quench-b": n }) } });
    expect(quench(12)).toMatchObject({ outcome: "H1 and H2 confirmed", validity: { quenched: { max: 12 / 256, failed: false } } });
    expect(quench(13)).toMatchObject({ outcome: "Invalid", withheld: true, primary: null, secondary: null, validity: { quenched: { max: 13 / 256, failed: true } } });
    expect(quench(13).reasons).toEqual(["quenched control scaf-i03-quench-b has competence 13/256, above 0.05"]);
    const repro = reg1Readout({ repro: { ...REG1_REPRO_OK, passed: false, reasons: ["no rerun of rand-i17"] } });
    expect(repro).toMatchObject({ outcome: "Invalid", withheld: true, primary: null });
    expect(repro.reasons).toEqual(["reproducibility check failed: no rerun of rand-i17"]);
    // invalid comes before uninformative in the table
    const both = reg1Readout({ plan: { successes: reg1Over(reg1Successes, { "scaf-i03-quench-a": 20 }), missing: new Set(range(7).map((i) => `${reg1ReportHistoryId("scaf", i)}-a`)) } });
    expect(both.outcome).toBe("Invalid");
    expect(both.validity.unresolved.uninformative).toBe(true);
  });

  it("uninformative: more than 6 unresolved histories in an arm, or in the ancestor worlds, or the budget stop", () => {
    const seven = reg1Readout({ plan: { missing: new Set(range(7).map((i) => `garden-rand-i${String(i).padStart(2, "0")}-t1-disc`)) } });
    expect(seven).toMatchObject({ outcome: "Uninformative", withheld: true, withheldReason: "the row is Uninformative (Report; decide whether to complete or rerun): no test statistic is reported", primary: null, secondary: null, truncation: { without: null, sensitive: null }, validity: { unresolved: { uninformative: true, arms: { rand: { unresolved: 7 } } } } });
    expect(seven.reasons).toEqual([expect.stringMatching(/^rand has 7 unresolved histories, more than 6 \(rand-i00, .*rand-i06\)/)]);
    const runs = reg1RunsFixture({ unresolved: new Set(range(7).map((i) => reg1ReportHistoryId("ancestor", i))) });
    const anc = reg1Readout({ runs });
    expect(anc.outcome).toBe("Uninformative");
    expect(anc.reasons.join("; ")).toMatch(/the ancestor worlds have 7 unresolved histories/);
    // the ancestor world's bundle is a source of its sets and of scaf_i's swap pair: all of them are unresolved
    expect(anc.availability.histories.find((h: any) => h.id === "ancestor-i00").unresolved).toEqual(["ancestor-i00 run", "ancestor-i00-a", "ancestor-i00-b"]);
    expect(anc.availability.histories.find((h: any) => h.id === "scaf-i00").unresolved).toEqual(["scaf-i00-ge-on-fa", "scaf-i00-ga-on-fa"]);
    // six is not too many
    expect(reg1Readout({ plan: { missing: new Set(range(6).map((i) => `heredity-rand-i${String(i).padStart(2, "0")}`)) } }).outcome).toBe("H1 and H2 confirmed");
    const stopped = reg1Readout({ budgetStopped: true });
    expect(stopped).toMatchObject({ outcome: "Uninformative", budgetStopped: true, withheld: true, withheldReason: "the budget stopped the queue: nothing is analysed", primary: null, secondary: null, descriptive: null, row: { next: "Report; decide whether to complete or rerun." } });
    expect(stopped.reasons).toEqual(["the budget stopped the queue: nothing is analysed (no partial ensemble is ever analysed)"]);
    expect(reg1Readout({ budgetStopped: true, device: null }).outcome).toBe("Uninformative");
    expect(reg1Readout({ budgetStopped: true, device: { ...REG1_DEVICE_OK, passed: false, reasons: ["x"], finalHash: null } }).outcome).toBe("Invalid");
  });

  it("a queue that has not completed is analysed by nothing: the outcome is incomplete, which is no row of the table", () => {
    const queue = { commands: [{ id: "device-1", instance: 1 }, { id: "hist-scaf-i00", instance: 1 }, { id: "hist-scaf-i08", instance: 2 }] };
    const done = reg1ReportQueueCheck(queue, [{ instance: 1, commands: { "device-1": "done", "hist-scaf-i00": "fail" } }, { instance: 2, commands: { "hist-scaf-i08": "done" } }]);
    expect(done).toEqual({ complete: true, commands: 3, done: 2, failed: 1, pending: [], reasons: [] });
    // a command's state counts only from its own instance's status file
    const open = reg1ReportQueueCheck(queue, [{ instance: 1, commands: { "device-1": "done", "hist-scaf-i08": "done", "hist-scaf-i00": "running" } }]);
    expect(open).toMatchObject({ complete: false, pending: ["hist-scaf-i00", "hist-scaf-i08"], reasons: ["the queue has not completed: 2 of 3 commands have no terminal state (hist-scaf-i00, hist-scaf-i08)"] });
    for (const bad of [() => reg1ReportQueueCheck({ commands: [{ id: 1 }] }, []), () => reg1ReportQueueCheck(queue, [{ instance: 1, commands: {} }, { instance: 1, commands: {} }]), () => reg1ReportQueueCheck({ commands: [queue.commands[0], queue.commands[0]] }, [])]) expect(bad).toThrow();
    const r = reg1Readout({ queue: open });
    expect(r).toMatchObject({ outcome: "incomplete", row: null, withheld: true, withheldReason: "the queue has not completed: nothing is analysed", queue: open, primary: null, secondary: null, truncation: null, availability: null, descriptive: null });
    expect(r.reasons).toEqual([open.reasons[0], "nothing is analysed (no partial ensemble is ever analysed)"]);
    // the budget stop comes first, and a complete queue is reported beside the readout
    expect(reg1Readout({ queue: open, budgetStopped: true }).outcome).toBe("Uninformative");
    expect(reg1Readout({ queue: done })).toMatchObject({ outcome: "H1 and H2 confirmed", queue: { complete: true } });
  });

  it("an unresolved value entering an H1 comparison makes H1 uninformative (Holm slot 1), reported as uninformative, not as not confirmed", () => {
    const r = reg1Readout({ plan: { missing: new Set(["rand-i05-a"]) } });
    expect(r.outcome).toBe("H2 confirmed, H1 not");
    expect(r.primary.h1).toMatchObject({ status: "uninformative", p: null, slot: 1 });
    const c = r.primary.h1.comparisons.find((x: any) => x.other === "rand" && x.timing === "a");
    expect(c).toMatchObject({ uninformative: true, p: null, established: null, unresolved: ["rand-i05-a"] });
    expect(r.primary.h1.comparisons.filter((x: any) => x.uninformative)).toHaveLength(1);
    expect(r.reasons[0]).toBe("H1 uninformative (an unresolved value enters scaf > rand at (a)): Holm slot p = 1; uninformative; counts as not confirmed for the table");
    // under "H2 confirmed, H1 not" the comparisons that did not establish higher scaf competence are named, the uninformative one marked
    expect(r.reasons[2]).toBe("comparisons that did not establish higher scaf competence: scaf > rand at (a) (uninformative)");
    expect(r.row.note).toMatch(/marks it uninformative rather than not confirmed/);
    // H2's Holm slot is tested beside p = 1
    expect(r.primary.h2.holm).toBe(Math.min(1, 2 * 2 ** -24));
  });

  it("an unresolved history counts as not positive in every sign test, whichever of its sets is unresolved, and an unresolved gain makes S2b uninformative", () => {
    // four swap pairs and one S2 set of scaf histories missing: five unresolved scaf histories, none positive in H2, S1 or S2a
    const missing = new Set([...range(4).map((i) => `${reg1ReportHistoryId("scaf", i)}-ga-on-fa`), "garden-rand-i03-t0-disc", "garden-scaf-i09-t1-disc"]);
    const r = reg1Readout({ plan: { missing } });
    expect(r.outcome).toBe("H1 and H2 confirmed");
    expect(r.primary.h2).toMatchObject({ positive: 19, n: 24, p: reg1ReportSignTest(19, 24) });
    expect(r.primary.h2.terms[0]).toMatchObject({ id: "scaf-i00", status: "unresolved", positive: false, value: null, why: "scaf-i00 is unresolved (scaf-i00-ga-on-fa)" });
    expect(r.primary.h2.terms[9]).toMatchObject({ id: "scaf-i09", status: "unresolved", positive: false, why: "scaf-i09 is unresolved (garden-scaf-i09-t1-disc)" });
    expect(r.secondary.s1.ratio.excluded).toEqual({ unresolved: 5, noDominantGenome: 0, nonPositiveDenominator: 0 });
    expect(r.secondary.s2a).toMatchObject({ positive: 19, n: 24 });
    expect(r.secondary.s2a.terms[0]).toMatchObject({ status: "unresolved", why: "scaf-i00 is unresolved (scaf-i00-ga-on-fa)" });
    // the rank test reads values: scaf-i00's disc gain is measured, scaf-i09's and rand-i03's are not
    expect(r.secondary.s2b).toMatchObject({ status: "uninformative", p: null, slot: 1, unresolved: ["scaf-i09", "rand-i03"] });
    expect(r.validity.unresolved.arms.scaf).toEqual({ histories: 24, unresolved: 5, ids: ["scaf-i00", "scaf-i01", "scaf-i02", "scaf-i03", "scaf-i09"] });
    expect(r.definitions.unresolved).toMatch(/^A history is unresolved when its run bundle or any of its sets is/);
  });

  it("a missing quenched control: its history is not positive in H2, every one of its values is unresolved, so H1 is uninformative and the row Neither", () => {
    // 19 of 24 genomes gain (i 0-18), and scaf-i00's quench-a is missing
    const successes = reg1Over(reg1Successes, Object.fromEntries(range(5, 19).map((i) => [`${reg1ReportHistoryId("scaf", i)}-ge-on-fa`, 280 + i])));
    expect(reg1Readout({ plan: { successes } })).toMatchObject({ outcome: "H1 and H2 confirmed", primary: { h2: { positive: 19 } } });
    const r = reg1Readout({ plan: { successes, missing: new Set(["scaf-i00-quench-a"]) } });
    expect(r.outcome).toBe("Neither");
    expect(r.primary.h2).toMatchObject({ positive: 18, status: "not confirmed" });
    expect(r.primary.h2.terms[0]).toMatchObject({ status: "unresolved", why: "scaf-i00 is unresolved (scaf-i00-quench-a)" });
    expect(r.primary.h1.status).toBe("uninformative");
    expect(r.primary.h1.comparisons.every((c: any) => c.uninformative && c.unresolved[0] === `scaf-i00-${c.timing}`)).toBe(true);
    expect(r.secondary.s2b).toMatchObject({ status: "uninformative", unresolved: ["scaf-i00"] });
    expect(r.validity.unresolved.arms.scaf).toMatchObject({ unresolved: 1, ids: ["scaf-i00"] });
  });

  it("a missing S3 set: its history is not positive in H2 or significant in S3, and H1 is unaffected", () => {
    const r = reg1Readout({ plan: { missing: new Set(["heredity-scaf-i04"]) } });
    expect(r.outcome).toBe("H1 and H2 confirmed");
    expect(r.primary.h1).toMatchObject({ status: "confirmed" });
    expect(r.primary.h1.comparisons.every((c: any) => !c.uninformative)).toBe(true);
    expect(r.primary.h2).toMatchObject({ positive: 23, n: 24 });
    expect(r.primary.h2.terms[4]).toMatchObject({ id: "scaf-i04", status: "unresolved", positive: false, why: "scaf-i04 is unresolved (heredity-scaf-i04)" });
    expect(r.secondary.s3.arms.scaf).toMatchObject({ demonstrated: 23, n: 24 });
  });

  it("a missing dominant genome is a measured failure, not unresolved", () => {
    const r = reg1Readout({ plan: { bio: new Set(["scaf-i00-ge-on-fa", "scaf-i01-ge-on-fa"]) } });
    expect(r.primary.h2).toMatchObject({ positive: 22, n: 24 });
    expect(r.primary.h2.terms[0]).toMatchObject({ status: "no dominant genome", positive: false });
    expect(r.secondary.s1.terms[1]).toMatchObject({ status: "no dominant genome", positive: false });
    expect(r.secondary.s1.ratio.excluded).toEqual({ unresolved: 0, noDominantGenome: 2, nonPositiveDenominator: 0 });
    expect(r.secondary.s1.ratio.eligible).toHaveLength(22);
    expect(r.availability).toMatchObject({ biological: 2, unresolved: 0 });
    expect(r.validity.unresolved.arms.scaf.unresolved).toBe(0);
    expect(r.descriptive.competences.find((c: any) => c.id === "scaf-i00-ge-on-fa")).toMatchObject({ status: "biological", n: 0, competence: null });
  });

  it("S3's gates: a failed positive control or two significant negatives make S3 uninformative with slot p = 1; an unresolved history is not significant", () => {
    const heredity = (over: Record<string, "strong" | "flat" | "insufficient">) => reg1Over(reg1Plan().heredity, over);
    const pos = reg1Readout({ plan: { heredity: heredity({ "heredity-pos-s1": "flat" }) } }).secondary.s3;
    expect(pos).toMatchObject({ status: "uninformative", p: null, slot: 1, gates: { positivePassed: false, nullGatePassed: true } });
    const neg = reg1Readout({ plan: { heredity: heredity({ "heredity-neg-j0": "strong", "heredity-neg-j2": "strong" }) } });
    expect(neg.secondary.s3).toMatchObject({ status: "uninformative", gates: { nullGatePassed: false } });
    expect(neg.secondary.heritable).toBe(false);
    expect(neg.outcome).toBe("H1 and H2 confirmed"); // the secondaries never change the row
    expect(reg1Readout({ plan: { heredity: heredity({ "heredity-neg-j3": "strong" }) } }).secondary.s3).toMatchObject({ status: "confirmed", gates: { nullGatePassed: true } });
    // every negative must be tested: one with fewer than 2 donors, or missing, leaves the gate unmet
    expect(reg1Readout({ plan: { heredity: heredity({ "heredity-neg-j1": "insufficient" }) } }).secondary.s3.gates.nullGatePassed).toBe(false);
    expect(reg1Readout({ plan: { missing: new Set(["heredity-neg-j1"]) } }).secondary.s3.gates.nullGatePassed).toBe(false);
    // 5 of 24 scaf histories significant: p 0.006 before Holm; unresolved and donor-less histories count as not significant
    const five = Object.fromEntries(range(24).map((i) => [`heredity-scaf-i${String(i).padStart(2, "0")}`, (i < 5 ? "strong" : i < 10 ? "insufficient" : "flat") as "strong" | "flat" | "insufficient"]));
    const r = reg1Readout({ plan: { heredity: heredity(five), missing: new Set(["heredity-scaf-i20"]) } }).secondary.s3;
    expect(r.arms.scaf).toEqual({ n: 24, demonstrated: 5, p: binomialUpperTail(5, 24, 1, 20) });
    expect(r.p).toBeCloseTo(0.006, 3);
    expect(r.histories.find((x: any) => x.id === "heredity-scaf-i07")).toMatchObject({ outcome: "donors", demonstrated: false });
    expect(r.histories.find((x: any) => x.id === "heredity-scaf-i20")).toMatchObject({ outcome: "unresolved", demonstrated: false, why: "scaf-i20 is unresolved (heredity-scaf-i20)" });
  });

  it("truncation: the row without the flagged histories is reported beside it, and called sensitive when it changes", () => {
    // 19 of 24 genomes gain: H2 confirmed (p 0.0033)
    const plan = { successes: noGain(range(5, 19)) };
    const flip = reg1Readout({ plan, runs: reg1RunsFixture({ flagged: new Set(["scaf-i00", "scaf-i01", "scaf-i02"]) }) });
    expect(flip.outcome).toBe("H1 and H2 confirmed");
    expect(flip.truncation.flagged.map((f: any) => f.id)).toEqual(["scaf-i00", "scaf-i01", "scaf-i02"]);
    expect(flip.truncation).toMatchObject({ sensitive: true, without: { outcome: "H1 confirmed, H2 not", excluded: ["scaf-i00", "scaf-i01", "scaf-i02"], h2: { positive: 16, n: 21 } } });
    expect(flip.truncation.without.h2.p).toBe(reg1ReportSignTest(16, 21));
    expect(flip.reasons.at(-1)).toBe("sensitive to truncation: without the 3 flagged histories the row would be H1 confirmed, H2 not");
    const steady = reg1Readout({ plan, runs: reg1RunsFixture({ flagged: new Set(["scaf-i23", "rand-i04"]) }) });
    expect(steady.truncation).toMatchObject({ sensitive: false, without: { outcome: "H1 and H2 confirmed", h2: { positive: 19, n: 23 } } });
    // the sensitivity re-runs the tests only: no validity check is part of it
    expect(Object.keys(flip.truncation.without)).toEqual(["outcome", "reasons", "excluded", "h1", "h2", "secondary"]);
    // under a row the validity checks settle there is no sensitivity verdict, though the flagged histories are listed: a quenched control
    // above 0.05 in a flagged history stays Invalid, as does more than 6 unresolved with one of them flagged
    const settled = reg1Readout({ plan: { successes: reg1Over(reg1Successes, { "scaf-i02-quench-a": 30 }) }, runs: reg1RunsFixture({ flagged: new Set(["scaf-i02"]) }) });
    expect(settled).toMatchObject({ outcome: "Invalid", withheld: true, primary: null, secondary: null });
    expect(settled.truncation).toMatchObject({ flagged: [{ id: "scaf-i02" }], without: null, sensitive: null });
    expect(settled.reasons).toEqual(["quenched control scaf-i02-quench-a has competence 30/256, above 0.05"]);
    expect(JSON.stringify(settled)).not.toMatch(/"(holm|slot)"/);
    const seven = reg1Readout({ plan: { missing: new Set(range(7).map((i) => `garden-scaf-i0${i}-t0-raw`)) }, runs: reg1RunsFixture({ flagged: new Set(["scaf-i06"]) }) });
    expect(seven).toMatchObject({ outcome: "Uninformative", truncation: { flagged: [{ id: "scaf-i06" }], without: null, sensitive: null } });
    // an unreadable bundle's truncation is unknown, and listed
    expect(reg1Readout({ runs: reg1RunsFixture({ unresolved: new Set(["cont-i03"]) }) }).truncation.unknown).toEqual(["cont-i03"]);
  });

  it("S1's bootstrap: reproducible, nearest-rank percentiles of 10,000 resample medians drawn by randomKey(4,880,201, r, j, 0), and unavailable at m = 0", () => {
    const xs = [0.3, 0.1, 0.25, 0.6, 0.05];
    const a = reg1ReportBootstrapMedian(xs)!;
    expect(reg1ReportBootstrapMedian(xs)).toEqual(a);
    const medians: number[] = [];
    for (let r = 0; r < 10_000; r++) medians.push(median(xs.map((_, j) => xs[randomKey(4_880_201, r, j, 0) % xs.length])));
    medians.sort((p, q) => p - q);
    expect(a).toEqual({ m: 5, median: 0.25, lower: medians[249], upper: medians[9749], resamples: 10_000 });
    expect(reg1ReportBootstrapMedian([])).toBeNull();
    const none = reg1Readout({ plan: { bio: new Set(range(24).map((i) => `${reg1ReportHistoryId("scaf", i)}-ge-on-fa`)) } });
    expect(none.secondary.s1.ratio).toMatchObject({ available: false, median: null, interval: null, eligible: [], excluded: { noDominantGenome: 24 }, method: "nearest-rank percentiles 250/9750 of 10,000 sorted medians; eligible histories in ascending i" });
    expect(none.outcome).toBe("H1 confirmed, H2 not");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(reg1Readout())).toBe(JSON.stringify(reg1Readout()));
  });
});

describe("scaffold-report reg1", () => {
  const scratch = () => mkdtempSync(join(tmpdir(), "scaffold-reg1-"));
  /** The readout runs to a few MB (every set, bundle and trajectory), past execFileSync's default buffer. */
  const report = (...args: string[]): Record<string, any> => JSON.parse(execFileSync("deno", ["run", "-A", REPORT, ...args], { stdio: "pipe", encoding: "utf8", maxBuffer: 1 << 28 }));
  /**
   * The registration's files under a scratch root: every assay set of `plan` (assays/<id>), the 96 bundles at their production paths
   * (runs/hist|anc/ponds/<condition>/seed-<n>, ponds.tsv with the columns the report reads), the four device checks, the two reruns on the
   * Mac and a completed queue (queue.json, status-<n>.json). Ge-on-Fa records without a dominant genome get a real (empty) b100-pre
   * checkpoint in their donor's bundle, whose hash the manifest records.
   */
  const writeWorld = (plan: Reg1Plan): string => {
    const root = scratch();
    const realHash = new Map<string, string>();
    for (const id of plan.bio) {
      const donor = reg1ReportExpectedSet(id)!.sources[1].bundle;
      const i = Number(donor.slice(-2));
      const state = allocState({ ...pondConfig(8, reg1ReportWorldSeed("scaf", i)), tileW: 24, tileH: 24 });
      state.step = 1_000_000;
      const dir = join(root, "runs", "hist", "ponds", "treatment", `seed-${reg1ReportWorldSeed("scaf", i)}`, "checkpoints");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "b100-pre.blck"), encodeCheckpoint(state));
      realHash.set(donor, stateHash(state));
    }
    const hash = (bundle: string, checkpoint: string) => (checkpoint === "b100" && realHash.has(bundle) ? realHash.get(bundle)! : reg1Hash(bundle, checkpoint));
    for (const w of reg1ReportExpectedSets()) {
      if (plan.missing.has(w.id)) continue;
      const rows = reg1PlanRows(w, plan);
      const h = w.labels.set === "heredity" ? plan.heredity(w.id) : null;
      const dir = join(root, "assays", w.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "assay.json"), JSON.stringify(reg1SetJson(w, { rows: rows.length, bio: plan.bio.has(w.id), insufficient: h === "insufficient", hash })));
      writeFileSync(join(dir, "assay.tsv"), reg1RowsText(rows));
      if (h !== null) writeFileSync(join(dir, "traits.tsv"), reg1TraitsText(rows, h));
    }
    const bundle = (base: string, manifest: Record<string, any>, cycles: number) => {
      const dir = join(base, manifest.runId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
      if (cycles === 0) return;
      const lines = ["cycle\trecipient\tdonor\ttruncated\trecipientTrait"];
      for (let c = 1; c <= cycles; c++) for (let r = 0; r < 64; r++) lines.push(`${c}\t${r}\t${manifest.cfg.pondArm === "cont" ? -1 : (r * 5) % 64}\t0\t${r < 2 ? 0 : 5000 + r}`);
      writeFileSync(join(dir, "ponds.tsv"), lines.join("\n") + "\n");
    };
    for (const { id, arm, history } of reg1ReportExpectedRuns()) {
      const hashes = { b001: hash(id, "b001"), b034: hash(id, "b034"), b100: hash(id, "b100"), init: hash(id, "init") };
      bundle(join(root, "runs"), reg1Manifest(arm === "ancestor" ? "anc" : "hist", arm, history, hashes), arm === "ancestor" ? 1 : 100);
    }
    for (const where of ["mac", 1, 2, 3] as const) bundle(join(root, "devices", String(where)), reg1Manifest("device", "scaf", 0, {}, { host: REG1_HOSTS[where] }), 0);
    const commands = reg1ReportExpectedSets().map((w) => ({ id: w.id, instance: reg1InstanceOf(w.labels.history ?? 0) }));
    writeFileSync(join(root, "queue.json"), JSON.stringify({ commands }));
    for (const n of [1, 2, 3]) writeFileSync(join(root, `status-${n}.json`), JSON.stringify({ instance: n, commands: Object.fromEntries(commands.filter((c) => c.instance === n).map((c) => [c.id, "done"])) }));
    for (const id of ["scaf-i14", "rand-i17"]) bundle(join(root, "runs"), reg1Manifest("repro", id.slice(0, 4) as Reg1ReportArm, Number(id.slice(-2)), { b034: reg1Hash(id, "b034") }), 0);
    return root;
  };
  /** S3 analysed in the controls and three histories, the others without enough donors (light fixtures). */
  const plan = (o: Partial<Reg1Plan> = {}) =>
    reg1Plan({
      heredity: (id) => (id.startsWith("heredity-pos") || id === "heredity-scaf-i00" || id === "heredity-scaf-i01" ? "strong" : id.startsWith("heredity-neg") || id === "heredity-rand-i00" ? "flat" : "insufficient"),
      ...o,
    });
  const devices = (root: string) => ["mac", "1", "2", "3"].map((where) => join(root, "devices", where));
  const queue = (root: string) => ["--queue", join(root, "queue.json"), "--status", ...[1, 2, 3].map((n) => join(root, `status-${n}.json`))];
  const args = (root: string) => ["--assays", join(root, "assays"), "--runs", join(root, "runs"), "--device", ...devices(root), "--repro", join(root, "runs", "repro"), ...queue(root)];

  it("reads the sets and bundles: validity, the tests and the row, a verified missing dominant genome, the bundles it does not take listed", () => {
    const root = writeWorld(plan({ bio: new Set(["scaf-i06-ge-on-fa"]) }));
    // another stage's set beside them is skipped and listed
    writeAssayDir(join(root, "assays"), "r1-h0", scafR1(0));
    // R4's capability set (descriptive): DEFAULT_EVAL's own seed 1 and 4 replicates, a row per genome
    mkdirSync(join(root, "assays", "capability"));
    // an unavailable source is a row that was not evaluated; h labels the source and is not a measure
    const capability = [{ arm: "scaf", history: 0, h: 0, evaluated: true, quality: 0.5 }, { arm: "scaf", history: 1, h: 1, evaluated: false, unavailable: "no eligible cell" }, { arm: "ancestor", history: 0, h: 72, evaluated: true, quality: 0.4 }];
    writeFileSync(join(root, "assays", "capability", "assay.json"), JSON.stringify({ assay: "capability", seed: 1, eval: { reps: 4, seed: 1 }, labels: { reg1: true, set: "capability", arm: null, history: null, timing: null, time: null, h: null, control: null }, capability }));
    const readout = (name: string) => fileURLToPath(new URL(`../../experiments/scaffold/readouts/${name}`, import.meta.url));
    const out = report("reg1", ...args(root), "--v1", readout("r3.json"), "--r3rep", readout("r3rep.json"));
    expect(Object.keys(out)).toEqual(["stage", "protocolSha256Reg1", "protocolNow", "validated", "outcome", "row", "reasons", "budgetStopped", "withheld", "withheldReason", "definitions", "queue", "validity", "primary", "secondary", "truncation", "availability", "descriptive", "rejected", "skipped"]);
    expect(out.queue).toEqual({ complete: true, commands: 558, done: 558, failed: 0, pending: [], reasons: [] });
    expect(out).toMatchObject({ stage: "reg1", outcome: "H1 and H2 confirmed", validated: true, rejected: [], protocolSha256Reg1: REG1_REPORT_PROTOCOL.sha256 });
    expect(out.protocolNow).toEqual({ doc: "docs/scaffold-registration-v1.md", sha256: createHash("sha256").update(readFileSync(fileURLToPath(new URL("../../docs/scaffold-registration-v1.md", import.meta.url)))).digest("hex"), pinnedTextIntact: true });
    expect(out.validity.device).toMatchObject({ passed: true, finalHash: "final", mac: join(root, "devices", "mac", "device/ponds/treatment/seed-4880301"), uncovered: [] });
    expect(out.validity.device.bundles).toHaveLength(4);
    expect(out.validity.reproducibility).toMatchObject({ passed: true, histories: [{ id: "scaf-i14", passed: true }, { id: "rand-i17", passed: true }] });
    expect(out.availability).toMatchObject({ expected: 558, measured: 557, biological: 1, unresolved: 0 });
    expect(out.primary.h2).toMatchObject({ positive: 23, n: 24, status: "confirmed" });
    expect(out.primary.h2.terms[6]).toMatchObject({ id: "scaf-i06", status: "no dominant genome" });
    expect(out.secondary.s3).toMatchObject({ status: "not confirmed", gates: { positivePassed: true, nullGatePassed: true }, arms: { scaf: { demonstrated: 2 } } });
    expect(out.truncation).toMatchObject({ flagged: [], unknown: [], sensitive: false });
    expect(out.descriptive.runs.histories.find((h: any) => h.id === "scaf-i00")).toMatchObject({ resolved: true, lastBoundary: 100, extinctAt100: 2, endedAt: null, truncation: { rows: 6400, truncated: 0 } });
    expect(out.descriptive.runs.histories.find((h: any) => h.id === "ancestor-i00")).toMatchObject({ lastBoundary: 1, extinctAt100: null });
    expect(out.descriptive.runs.arms.cont[5]).toEqual({ boundary: 100, histories: 24, medianMeanTrait: (62 * 5000 + (2 + 63) * 31) / 64, medianExtinct: 2 });
    expect(out.descriptive.capability).toMatchObject({ given: true, rows: [{ arm: "scaf", history: 0 }, { arm: "scaf", history: 1 }, { arm: "ancestor", history: 0 }], arms: { scaf: { n: 1, measures: { quality: { n: 1, mean: 0.5 } } } } });
    expect(Object.keys(out.descriptive.capability.arms.scaf.measures)).toEqual(["quality"]);
    expect(out.descriptive.capability.counts.scaf).toEqual({ rows: 2, evaluated: 1, unavailable: [{ history: 1, why: "no eligible cell" }] });
    expect(out.descriptive.sideBySide.v1).toMatchObject({ histories: 6, quenchedMax: 0 });
    expect(out.descriptive.sideBySide.r3rep).toMatchObject({ histories: 6, quenchedMax: 0 });
    expect(out.descriptive.sideBySide.reg1.a.scaf).toBe(211.5 / 256);
    expect(out.skipped.map((s: any) => s.why)).toEqual(["a reproducibility rerun of rand-i17 (340,000 steps): give it with --repro", "a reproducibility rerun of scaf-i14 (340,000 steps): give it with --repro", "not a registration set (labels.reg1 is not true)"]);
  });

  it("collects unreadable and unsound sets and bundles as unresolved, and stops at nothing", () => {
    const root = writeWorld(plan());
    rmSync(join(root, "assays", "rand-i00-a", "assay.tsv"));
    writeFileSync(join(root, "assays", "cont-i01-b", "assay.json"), "{ not json");
    const anc = join(root, "runs", "anc", "ponds", "pond-cont", `seed-${reg1ReportWorldSeed("ancestor", 2)}`);
    writeFileSync(join(anc, "ponds.tsv"), "cycle\trecipient\tdonor\ttruncated\trecipientTrait\n1\t0\t-1\t0\t5\n");
    // rand-i05 stopped on an event-buffer overflow and was repeated at census 100 (hist-c100): the repeat is taken; cont-i04 finished under both: refused
    const repeat = (cond: string, seed: number, finishedBoth: boolean) => {
      const first = join(root, "runs", "hist", "ponds", cond, `seed-${seed}`);
      const m = JSON.parse(readFileSync(join(first, "manifest.json"), "utf8"));
      const { summary: _s, finishedAt: _f, ...stopped } = m;
      if (!finishedBoth) writeFileSync(join(first, "manifest.json"), JSON.stringify(stopped));
      const again = join(root, "runs", "hist-c100", "ponds", cond, `seed-${seed}`);
      mkdirSync(again, { recursive: true });
      writeFileSync(join(again, "manifest.json"), JSON.stringify({ ...m, runId: `hist-c100/ponds/${cond}/seed-${seed}`, spec: { ...m.spec, experiment: "hist-c100", censusEvery: 100 } }));
      cpSync(join(first, "ponds.tsv"), join(again, "ponds.tsv"));
      return [first, again];
    };
    const [overflowed, repeated] = repeat("pond-rand", reg1ReportWorldSeed("rand", 5), false);
    const twice = repeat("pond-cont", reg1ReportWorldSeed("cont", 4), true);
    const out = report("reg1", ...args(root));
    const run = (id: string) => out.availability.runs.find((h: any) => h.id === id);
    expect(run("rand-i05")).toEqual({ id: "rand-i05", dir: repeated, resolved: true, why: [], censusEvery: 100 });
    expect(out.skipped).toContainEqual({ dir: overflowed, why: `an unfinished run of rand-i05, superseded by the finished ${repeated}` });
    expect(run("cont-i04")).toMatchObject({ resolved: false, why: [`2 finished run bundles (${twice[0]}, ${twice[1]}); neither is used`] });
    expect(out.rejected.map((r: any) => r.id)).toEqual([null, "rand-i00-a"]);
    const status = (id: string) => out.availability.sets.find((s: any) => s.id === id);
    expect(status("rand-i00-a").why).toMatch(/^set rejected: could not read the set/);
    expect(status("cont-i01-b").why).toBe("no assay set");
    expect(status("ancestor-i02-a").why).toMatch(/its source bundle ancestor-i02 \(unresolved\) is not resolved/);
    expect(out.availability.runs.find((h: any) => h.id === "ancestor-i02")).toMatchObject({ resolved: false, why: [expect.stringMatching(/^ponds.tsv: ponds.tsv cycle 1 has 1 rows, want 64/)] });
    // four comparisons take an unresolved value: H1 is uninformative
    expect(out).toMatchObject({ outcome: "H2 confirmed, H1 not", primary: { h1: { status: "uninformative", slot: 1 } } });
    expect(out.truncation.unknown).toEqual(["cont-i04", "ancestor-i02"]);
  });

  it("--budget-stopped analyses nothing; --allow-any-seed waives the sets' seeds, not their labels", () => {
    const root = writeWorld(plan());
    const stopped = report("reg1", "--budget-stopped", "--device", ...devices(root));
    expect(stopped).toMatchObject({ outcome: "Uninformative", budgetStopped: true, withheld: true, primary: null, secondary: null, validity: { device: { passed: true } } });
    const set = join(root, "assays", "scaf-i02-a", "assay.json");
    const json = JSON.parse(readFileSync(set, "utf8"));
    writeFileSync(set, JSON.stringify({ ...json, seeds: json.seeds.map((x: any) => ({ physics: x.physics + 1, fragment: x.fragment })) }));
    const strict = report("reg1", ...args(root));
    expect(strict.rejected).toEqual([{ dir: join(root, "assays", "scaf-i02-a"), id: "scaf-i02-a", reasons: [expect.stringMatching(/^seeds\[0\]/), expect.stringMatching(/^seeds\[1\]/), expect.stringMatching(/^seeds\[2\]/), expect.stringMatching(/^seeds\[3\]/)] }]);
    expect(strict.primary.h1.status).toBe("uninformative");
    const smoke = report("reg1", ...args(root), "--allow-any-seed");
    expect(smoke).toMatchObject({ validated: false, rejected: [], outcome: "H1 and H2 confirmed" });
    // strict mode refuses to run without the queue; a queue with a command pending is analysed by nothing
    const noQueue = args(root).slice(0, args(root).indexOf("--queue"));
    expect(() => execFileSync("deno", ["run", "-A", REPORT, "reg1", ...noQueue], { stdio: "pipe", encoding: "utf8" })).toThrow(/reg1 needs --queue/);
    const status = join(root, "status-2.json");
    const st = JSON.parse(readFileSync(status, "utf8"));
    delete st.commands["rand-i09-b"];
    writeFileSync(status, JSON.stringify(st));
    const open = report("reg1", ...args(root));
    expect(open).toMatchObject({ outcome: "incomplete", row: null, withheld: true, queue: { complete: false, pending: ["rand-i09-b"] }, primary: null, secondary: null, truncation: null, availability: null, descriptive: null, validity: { device: { passed: true } } });
  });

  it("the other stages skip registration directories and read exactly what they read without them", () => {
    const root = scratch();
    writeAssayDir(root, "r3-scaf-a", assayDirFixture({ assay: "competence", flags: { arm: "scaf", history: "0", timing: "a" }, seed: assaySeed(3, 0, 0, 0, 0), dir: "r3" }));
    for (const i of [0, 1, 2]) writeAssayDir(root, `r1-h${i}`, scafR1(i));
    const stages = () => ({ r1: report("r1", "--assays", root, "--regime", "5", "3000"), r3: report("r3", "--assays", root, "--regime", "5", "3000"), r3rep: report("r3rep", "--assays", root) });
    const before = stages();
    for (const id of ["scaf-i00-a", "heredity-pos-s0"]) {
      const w = reg1ReportExpectedSet(id)!;
      const rows = reg1PlanRows(w, reg1Plan());
      mkdirSync(join(root, id));
      writeFileSync(join(root, id, "assay.json"), JSON.stringify(reg1SetJson(w, { rows: rows.length })));
      writeFileSync(join(root, id, "assay.tsv"), reg1RowsText(rows));
    }
    const after = stages();
    for (const stage of ["r1", "r3"] as const) {
      expect({ ...after[stage], skipped: 0 }).toEqual({ ...before[stage], skipped: 0 });
      expect(after[stage].skipped).toBe(before[stage].skipped + 2);
    }
    expect(after.r3rep.skipped).toHaveLength(before.r3rep.skipped.length + 2);
    expect({ ...after.r3rep, skipped: 0 }).toEqual({ ...before.r3rep, skipped: 0 });
  });
});
