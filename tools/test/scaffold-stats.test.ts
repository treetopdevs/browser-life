import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assaySeed } from "../lib/ponds.ts";
import { ASSAY_COLUMNS, M_ASSAY, TAU_LABELS, assayJson, assayLine, censusSteps, checkAssaySeeds, checkDonorSeed, decodeAssaySeed, donorSeedOf, parseAssayLabels, parseR1PrimeLabels, r1PrimeH, r1PrimeSeed, r1dPrimeIdOf, r1dPrimeLabelsOf, r1dPrimeSeed, traitsTable, type Planted, type R1dPrimeProvenance } from "../lib/pond-assay.ts";
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
  type ReplayCheck,
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
