import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assaySeed } from "../lib/ponds.ts";
import { ASSAY_COLUMNS, assayJson, assayLine, checkAssaySeeds, checkDonorSeed, decodeAssaySeed, donorSeedOf, parseAssayLabels, type Planted } from "../lib/pond-assay.ts";
import {
  DECISION_TABLE,
  R1_EXPECTED,
  R2_EXPECTED,
  R3_EXPECTED,
  assayLabels,
  assayRow,
  assaySensitivity,
  competence,
  decide,
  founderRank,
  highShare,
  highShareCounts,
  icc1,
  lineageFounder,
  mainRunOf,
  median,
  olsResiduals,
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
  permutationP,
  populationCv,
  r1Evaluate,
  r1History,
  r1Verdict,
  r2Evaluate,
  r2Verdict,
  r3Evaluate,
  r3Verdict,
  r4RowsOf,
  r4Table,
  readTsv,
  runStatus,
  setKey,
  shareDelta,
  summariseHistory,
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
