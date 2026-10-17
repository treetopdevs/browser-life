import { describe, expect, it } from "vitest";
import { UPPER_BAR, SIGNALS, binomialUpperBound, departure, dominantShare, finiteOrZero, mergeCensuses, type Receipt, type ScoringResult } from "../lib/bell.ts";
import { quantileSorted } from "../lib/measures6.ts";
import {
  A1_MAX_RINGS,
  CADENCE,
  DROPPED_SIGNALS,
  EARLY_FROM,
  EARLY_TO,
  ENVELOPE_ID,
  HORIZON,
  HORIZON_CENSUSES,
  PER_ARM,
  PairScorer,
  W_PAIR,
  checkBaseManifest,
  checkCensusStream,
  checkExactManifest,
  checkHorizonIdentity,
  censusProblem,
  checkV0Manifest,
  d11Of,
  deepEqual,
  defaultRecord,
  defaultTwinsPlan,
  freshRuns,
  interventionProblem,
  isV1Signal,
  judgeTwin,
  launchCoverage,
  launchProblem,
  newNullScorer,
  nullCalled,
  nullEntry,
  parseInterventions,
  parseLaunchLog,
  parseNudgeFile,
  planNull,
  recordRefusal1,
  rowsEqual,
  strictCensuses,
  summarizeNull,
  summarizeTwins,
  twinsCalled,
  twinManifestProblem,
  v0Runs,
  voidReasons,
  type Census,
  type NullEntry,
  type NullRun,
  type NullSet,
  type PairResult,
  type TwinInput,
  type TwinOutcome,
} from "../lib/bell1.ts";
import { ARMS, S, STEPS, planJobs, type Arm, type NudgeCentres } from "../lib/bell-v1-jobs.ts";

function prng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
async function* gen<T>(xs: T[]): AsyncGenerator<T> {
  for (const x of xs) yield x;
}
const IDX = Object.fromEntries(SIGNALS.map((s, i) => [s.name, i])) as Record<string, number>;
const nudges: NudgeCentres = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, { nudge: { x: 127, y: 128 }, nudge2: { x: 64, y: 60 } }]));

// ---------------------------------------------------------------------------------------------
// Part A.

describe("the eleven signals and the corpus", () => {
  it("drops maxGeneration and dominantShare from v0's thirteen", () => {
    expect(DROPPED_SIGNALS).toEqual(["maxGeneration", "dominantShare"]);
    expect(SIGNALS.filter((s) => isV1Signal(s.name)).length).toBe(11);
    expect(isV1Signal("maxGeneration")).toBe(false);
    expect(isV1Signal("dominantShare")).toBe(false);
    expect(isV1Signal("fissions")).toBe(true);
  });
  it("takes the 40 + 30 + 10 v0 runs and the 70 fresh seeds 2002..2071", () => {
    const v = v0Runs();
    expect(v.envelope.length).toBe(40);
    expect(v.envelope.every((r) => r.preset === "gradient-m3" && r.condition === "neutral")).toBe(true);
    expect(v.envelope.filter((r) => r.experiment === "replay-calib").map((r) => r.seed)).toEqual(Array.from({ length: 20 }, (_, i) => 1001 + i));
    expect(v.envelope.filter((r) => r.experiment === "replay-m4").map((r) => r.seed)).toEqual(Array.from({ length: 20 }, (_, i) => 1 + i));
    expect(v.spots.length).toBe(30);
    expect(v.spots.every((r) => r.preset === "spots-m3" && r.condition === "neutral")).toBe(true);
    expect(v.treatment.length).toBe(10);
    expect(v.treatment.every((r) => r.experiment === "replay-m4" && r.preset === "gradient-m3" && r.condition === "treatment")).toBe(true);
    const f = freshRuns();
    expect(f.length).toBe(70);
    expect(f[0].rel).toBe("bell-v1-null/gradient-m3/neutral/seed-2002");
    expect(f[69].seed).toBe(2071);
    expect(HORIZON_CENSUSES).toBe(3000);
  });
});

describe("manifest and stream checks", () => {
  const run: NullRun = { id: "bell-v1-null/gradient-m3/neutral/seed-2002", experiment: "bell-v1-null", preset: "gradient-m3", condition: "neutral", seed: 2002, rel: "x", set: "fresh" };
  const man = (over: Record<string, unknown> = {}, spec: Record<string, unknown> = {}) =>
    JSON.stringify({ spec: { experiment: "bell-v1-null", presetId: "gradient-m3", condition: "neutral", seed: 2002, steps: HORIZON, censusEvery: 100, ...spec }, presetIdentity: "pid", summary: { steps: HORIZON }, ...over });
  it("a fresh run needs exactly 300,000 steps and cadence 100; a v0 run needs at least the horizon", () => {
    expect(checkExactManifest(run, man(), HORIZON).presetIdentity).toBe("pid");
    expect(() => checkExactManifest(run, man({}, { steps: 1_000_000 }), HORIZON)).toThrow(/exactly/);
    expect(() => checkExactManifest(run, man({}, { censusEvery: 200 }), HORIZON)).toThrow(/censusEvery/);
    expect(() => checkExactManifest(run, man({ summary: undefined }), HORIZON)).toThrow(/no summary/);
    expect(checkV0Manifest(run, man({}, { steps: 1_000_000 })).spec.steps).toBe(1_000_000);
    expect(() => checkV0Manifest(run, man({}, { steps: 200_000 }))).toThrow(/at least/);
  });
  it("group identity compares preset identity and cadence, not steps", () => {
    checkHorizonIdentity([{ id: "a", presetIdentity: "p", censusEvery: 100 }, { id: "b", presetIdentity: "p", censusEvery: 100 }]);
    expect(() => checkHorizonIdentity([{ id: "a", presetIdentity: "p", censusEvery: 100 }, { id: "b", presetIdentity: "q", censusEvery: 100 }])).toThrow(/b has presetIdentity/);
    expect(() => checkHorizonIdentity([{ id: "a", presetIdentity: "p", censusEvery: 100 }, { id: "b", presetIdentity: "p", censusEvery: 50 }])).toThrow(/censusEvery/);
  });
  const cens = (n: number, stepOf = (i: number) => (i + 1) * 100) => Array.from({ length: n }, (_, i) => ({ rec: { step: stepOf(i) } }));
  it("checkCensusStream: exact count, cadence, and a closed generator", async () => {
    await checkCensusStream("r", gen(cens(5)), 5, 100, true);
    await expect(checkCensusStream("r", gen(cens(4)), 5, 100, true)).rejects.toThrow(/4 censuses, expected 5/);
    await expect(checkCensusStream("r", gen(cens(6)), 5, 100, true)).rejects.toThrow(/more than 5 censuses/);
    await expect(checkCensusStream("r", gen(cens(5, (i) => (i < 3 ? i + 1 : i + 2) * 100)), 5, 100, true)).rejects.toThrow(/census 4 is at step 500/);
  });
  it("checkCensusStream: a horizon cut reads `count` censuses of a longer stream and closes it", async () => {
    let closed = false;
    async function* longer() {
      try {
        for (let i = 1; i <= 50; i++) yield { rec: { step: i * 100 } };
      } finally {
        closed = true;
      }
    }
    await checkCensusStream("v0", longer(), 10, 100, false);
    expect(closed).toBe(true);
    closed = false;
    await expect(checkCensusStream("v0", longer(), 10, 100, true)).rejects.toThrow(/more than 10/);
    expect(closed).toBe(true);
  });
});

describe("the strict census rule (finite fields, exact lineage match)", () => {
  const ROWS2: [string, number][] = [["a", 3], ["b", 1]];
  const good = { step: 100, livingCells: 4, lineages: 2 };
  it("passes an exact census, an extinct one with no rows, and refuses every departure", () => {
    expect(censusProblem(good, ROWS2)).toBeNull();
    expect(censusProblem({ step: 100, livingCells: 0, lineages: 0 }, [])).toBeNull();
    expect(censusProblem({ step: 100, livingCells: 4 }, ROWS2)).toMatch(/lineages is missing/);
    expect(censusProblem({ step: 100, lineages: 2 }, ROWS2)).toMatch(/livingCells is missing/);
    expect(censusProblem({ step: 100, livingCells: Number.NaN, lineages: 2 }, ROWS2)).toMatch(/livingCells is null, not a finite/); // JSON has no NaN; JSON.stringify(NaN) is "null"
    expect(censusProblem({ step: 100, livingCells: null, lineages: 2 }, ROWS2)).toMatch(/livingCells is null/);
    expect(censusProblem({ step: 100, livingCells: 4, lineages: "2" }, ROWS2)).toMatch(/lineages is "2"/);
    expect(censusProblem({ step: 100, livingCells: Infinity, lineages: 2 }, ROWS2)).toMatch(/livingCells/);
    expect(censusProblem({ step: 100, livingCells: 5, lineages: 2 }, ROWS2)).toMatch(/sum to 4 cells but livingCells is 5/);
    expect(censusProblem({ step: 100, livingCells: 4, lineages: 3 }, ROWS2)).toMatch(/2 lineage rows but lineages is 3/);
    expect(censusProblem({ step: 100, livingCells: 4, lineages: 2 }, [])).toMatch(/truncated/);
    expect(censusProblem({ step: 100, livingCells: 0, lineages: 0 }, [["a", 0]])).toMatch(/1 lineage rows but lineages is 0/);
    expect(censusProblem({ step: 100, livingCells: 0, lineages: 1 }, [["a", 0]])).toBeNull(); // consistent: a row, a lineage count of 1, no cells
  });
  // The stream the finding described: a series with no livingCells or lineages and an empty lineages.tsv. v0's mergeCensuses accepts it.
  const series = (recs: Record<string, unknown>[]) => gen(recs as (Record<string, unknown> & { step: number })[]);
  const noLineages = () => gen<readonly [number, [string, number][]]>([]);
  const drain = async (it: AsyncGenerator<unknown>) => {
    const out: unknown[] = [];
    for await (const x of it) out.push(x);
    return out;
  };
  it("mergeCensuses lets a series with missing fields and an empty lineages.tsv through; strictCensuses does not", async () => {
    const recs = () => [{ step: 100 }, { step: 200 }];
    expect((await drain(mergeCensuses("r", series(recs()), noLineages()))).length).toBe(2);
    await expect(drain(strictCensuses("r", mergeCensuses("r", series(recs()), noLineages())))).rejects.toThrow(/^r: step 100: livingCells is missing/);
  });
  it("refuses a null field, and an empty lineages.tsv under a nonzero livingCells (mergeCensuses itself catches the latter when the series states it)", async () => {
    const s = (recs: Record<string, unknown>[], lin: [number, [string, number][]][] = []) => strictCensuses("r", mergeCensuses("r", series(recs), gen(lin)));
    await expect(drain(s([{ step: 100, livingCells: null, lineages: "7" }]))).rejects.toThrow(/livingCells is null/);
    await expect(drain(s([{ step: 100, livingCells: 4, lineages: 2 }, { step: 200, livingCells: 4, lineages: 2 }], [[100, ROWS2]]))).rejects.toThrow(/step 200 lineage rows sum to 0 cells but series.jsonl says livingCells 4/);
    // a good stream passes through unchanged, in order
    const ok = await drain(s([{ step: 100, livingCells: 4, lineages: 2 }, { step: 200, livingCells: 0, lineages: 0 }], [[100, ROWS2]]));
    expect(ok.length).toBe(2);
  });
  it("closes the source on a failure and on an early return", async () => {
    let closed = 0;
    async function* src() {
      try {
        yield { rec: { step: 100, livingCells: 4, lineages: 2 }, rows: ROWS2 };
        yield { rec: { step: 200, livingCells: 9, lineages: 2 }, rows: ROWS2 };
      } finally {
        closed++;
      }
    }
    await expect(drain(strictCensuses("r", src()))).rejects.toThrow(/step 200/);
    expect(closed).toBe(1);
    const it = strictCensuses("r", src());
    await it.next();
    await it.return(undefined);
    expect(closed).toBe(2);
  });
  it("a fresh-run check (checkCensusStream over strictCensuses) does not load a stream with a missing field", async () => {
    const mk = (extra: Record<string, unknown>) => strictCensuses("r", gen(Array.from({ length: 5 }, (_, i) => ({ rec: { step: (i + 1) * 100, livingCells: 4, lineages: 2, ...extra }, rows: ROWS2 }))));
    await checkCensusStream("r", mk({}), 5, 100, true);
    await expect(checkCensusStream("r", mk({ livingCells: undefined }), 5, 100, true)).rejects.toThrow(/livingCells is missing/);
  });
});

describe("the launch log", () => {
  it("takes the last line for an id; a non-zero exit and an unlisted job are both problems", () => {
    const log = parseLaunchLog(['{"id":"null-2002","exit":1,"seconds":5}', '{"id":"null-2002","exit":0,"seconds":9}', '{"id":"twin-f-1","exit":137,"seconds":3}', ""].join("\n"));
    expect(log.get("null-2002")).toEqual({ exit: 0, seconds: 9 });
    expect(launchProblem(log, "null-2002")).toBeNull();
    expect(launchProblem(log, "twin-f-1")).toMatch(/exited 137/);
    expect(launchProblem(log, "twin-l96-1")).toMatch(/not listed/); // never finished (or never launched): it does not count
    expect(launchProblem(null, "twin-f-1")).toBeNull(); // only a --plan smoke test runs without a log
    expect(launchCoverage(log, ["null-2002", "twin-f-1", "twin-l96-1"])).toEqual({ expected: 3, listed: 2, exit0: 1 });
    expect(() => parseLaunchLog("not json")).toThrow(/line 1/);
    expect(() => parseLaunchLog('{"id":"a"}')).toThrow(/no id and exit/);
  });
});

// A scorer run on synthetic constant runs: with a constant series the window minimum is the z itself, so D is exact.
function constantRun(values: Record<string, number>, rows: [string, number][], n: number): { step: number; rec: Record<string, unknown> & { step: number }; rows: [string, number][] }[] {
  return Array.from({ length: n }, (_, i) => ({ step: (i + 1) * 100, rec: { step: (i + 1) * 100, ...values } as Record<string, unknown> & { step: number }, rows }));
}
import { SignalExtractor } from "../lib/bell.ts";
function scoreConstant(runs: { values: Record<string, number>; rows: [string, number][] }[], plan: ReturnType<typeof planNull>, n = 160) {
  const scorer = newNullScorer(plan);
  const series = runs.map((r) => constantRun(r.values, r.rows, n));
  const ext = runs.map(() => new SignalExtractor());
  for (let c = 0; c < n; c++) scorer.push(series.map((s, i) => ({ step: s[c].step, values: ext[i].push(s[c].rec, s[c].rows) })));
  return scorer.results();
}
const BASE_VALUES = { livingCells: 100, individuals: 50, meanMass: 10, lineages: 2, lineageShannon: 0.5, patternEntropy: 0.5, bioticRecycling: 0.5, maxGeneration: 5, fissions: 0, fusions: 0, buddings: 0, mutations: 0 };
const ROWS: [string, number][] = [["a", 3], ["b", 1]];
const fakeRun = (id: string, set: NullSet = "fresh"): NullRun => ({ id, experiment: "x", preset: "gradient-m3", condition: "neutral", seed: 0, rel: id, set });

describe("scoring: 11 signals against 13, leave-one-out against non-member", () => {
  it("a run where only maxGeneration departs rings the 13-signal rule and not the 11-signal rule", () => {
    const env = [0, 1, 2, 3, 4].map((i) => ({ values: { ...BASE_VALUES, livingCells: 100 + i }, rows: ROWS }));
    const departed = { values: { ...BASE_VALUES, livingCells: 102, maxGeneration: 500 }, rows: ROWS };
    const plan = planNull(["e0", "e1", "e2", "e3", "e4"], ["x"]);
    const res = scoreConstant([...env, departed], plan);
    const x = res[5];
    const entry = nullEntry(fakeRun("x"), x);
    expect(entry.D13).toBeGreaterThan(100);
    expect(entry.D11).toBe(0);
    expect(entry.ring13).toBe(true);
    expect(entry.ring11).toBe(false);
    expect(entry.firstRing13?.signal).toBe("maxGeneration");
    expect(entry.firstRing11).toBeNull();
    expect(d11Of(x)).toBe(0);
  });
  it("a run where only dominantShare departs does the same", () => {
    const env = [0, 1, 2, 3, 4].map((i) => ({ values: { ...BASE_VALUES, livingCells: 100 + i }, rows: ROWS })); // share 0.75
    const departed = { values: { ...BASE_VALUES, livingCells: 102 }, rows: [["a", 100], ["b", 1]] as [string, number][] }; // share ~0.99
    const res = scoreConstant([...env, departed], planNull(["e0", "e1", "e2", "e3", "e4"], ["x"]));
    const entry = nullEntry(fakeRun("x"), res[5]);
    expect(entry.D13).toBeGreaterThan(4);
    expect(entry.ring13).toBe(true);
    expect(entry.ring11).toBe(false);
  });
  it("a kept signal that departs rings both rules, and the 11-signal first ring skips a dropped signal that rang earlier", () => {
    const mk = (signal: string, endStep: number): Receipt => ({ signal, side: "high", Z: 4, W: 50, startStep: endStep - 4900, endStep, minAbsZ: 5, value: 1, median: 0 });
    const res = {
      id: "x", run: 0, envelope: ENVELOPE_ID, D: [9], windows: [10], censuses: 3000,
      dBySignal: [{ signal: "maxGeneration", side: "high", W: 50, D: 9 }, { signal: "livingCells", side: "low", W: 50, D: 4.5 }, { signal: "dominantShare", side: "high", W: 50, D: 6 }],
      receipts: [mk("maxGeneration", 20_000), mk("dominantShare", 21_000), mk("livingCells", 30_000)],
    } as unknown as ScoringResult;
    const e = nullEntry(fakeRun("x"), res);
    expect(e.D13).toBe(9);
    expect(e.D11).toBe(4.5);
    expect(e.firstRing13?.signal).toBe("maxGeneration");
    expect(e.firstRing11?.signal).toBe("livingCells");
    // D >= Z rings: exactly Z counts.
    const at = { ...res, D: [4], dBySignal: [{ signal: "livingCells", side: "high", W: 50, D: 4 }] } as unknown as ScoringResult;
    expect(nullEntry(fakeRun("x"), at).ring11).toBe(true);
  });
  it("a member is scored leave-one-out, a fresh clone of it against all members (brute force with departure)", () => {
    const levels = [100, 110, 120, 130, 200];
    const env = levels.map((lc) => ({ values: { ...BASE_VALUES, livingCells: lc }, rows: ROWS }));
    const clone = { values: { ...BASE_VALUES, livingCells: 200 }, rows: ROWS };
    const plan = planNull(["e0", "e1", "e2", "e3", "e4"], ["clone"]);
    expect(plan.envelopes).toEqual([{ id: ENVELOPE_ID, members: [0, 1, 2, 3, 4] }]);
    expect(plan.scorings.map((s) => s.run)).toEqual([0, 1, 2, 3, 4, 5]);
    const res = scoreConstant([...env, clone], plan);
    const sorted = [...levels].sort((a, b) => a - b);
    const loo = departure(200, sorted, 4, 1).z; // the member at sorted index 4 leaves itself out
    const all = departure(200, sorted, Infinity, 1).z; // the clone is not a member
    expect(loo).not.toBe(all);
    expect(res[4].D[0]).toBeCloseTo(loo, 10);
    expect(res[5].D[0]).toBeCloseTo(all, 10);
    // every other signal is identical across runs: z is 0
    const other = res[4].dBySignal.filter((d) => d.signal !== "livingCells");
    expect(other.every((d) => d.D === 0)).toBe(true);
  });
  it("the burn-in and the 300,000 horizon: no window before step 10,000 counts", () => {
    // 3000 censuses, a departure only in the first 9,900 steps never counts; from step 10,000 on for 50 censuses it does
    const n = 120;
    const early = (c: number) => (c < 99 ? 500 : 100); // steps 100..9,900 depart
    const scorer = newNullScorer(planNull(["e0", "e1", "e2"], ["x"]));
    const ext = [0, 1, 2, 3].map(() => new SignalExtractor());
    for (let c = 0; c < n; c++) {
      const step = (c + 1) * 100;
      const mk = (lc: number) => ({ step, values: undefined as unknown as (number | null)[], rec: { step, ...BASE_VALUES, livingCells: lc } as Record<string, unknown> & { step: number } });
      const lcs = [100, 101, 102, early(c)];
      scorer.push(lcs.map((lc, i) => ({ step, values: ext[i].push(mk(lc).rec, ROWS) })));
    }
    expect(scorer.results()[3].D[0]).toBe(0);
  });
});

describe("summarizeNull: A1 and the reported items", () => {
  const e = (set: NullSet, i: number, D11: number, D13 = D11): NullEntry => ({
    id: `${set}-${i}`, set, preset: set === "v0-spots" ? "spots-m3" : "gradient-m3", seed: i, D11, D13, ring11: D11 >= 4, ring13: D13 >= 4, firstRing11: null, firstRing13: null,
  });
  const corpus = (opts: { freshRings?: number; fresh?: number; freshD13Extra?: number[] } = {}): NullEntry[] => [
    ...Array.from({ length: 40 }, (_, i) => e("v0-gradient", i, i === 0 ? 3.9 : 1, i === 0 ? 3.9 : i === 1 ? 7 : 1)),
    ...Array.from({ length: 30 }, (_, i) => e("v0-spots", i, i < 2 ? 5 : 1)),
    ...Array.from({ length: 10 }, (_, i) => e("treatment", i, 9)),
    ...Array.from({ length: opts.fresh ?? 70 }, (_, i) => e("fresh", i, i < (opts.freshRings ?? 0) ? 4 : 1, opts.freshD13Extra?.[i] ?? (i < (opts.freshRings ?? 0) ? 4 : 1))),
  ];
  it("A1 is met at 2 of 70 and missed at 3 (the bar and the binomial bound agree)", () => {
    expect(binomialUpperBound(A1_MAX_RINGS, 70)).toBeLessThan(UPPER_BAR);
    expect(binomialUpperBound(A1_MAX_RINGS + 1, 70)).toBeGreaterThanOrEqual(UPPER_BAR);
    const s2 = summarizeNull(corpus({ freshRings: 2 }), { complete: true });
    expect(s2.A1).toMatchObject({ status: "met", k: 2, n: 70, reading: "quiet on fresh drift (exploratory)" });
    const s3 = summarizeNull(corpus({ freshRings: 3 }), { complete: true });
    expect(s3.A1).toMatchObject({ status: "missed", k: 3, reading: "still rings on drift" });
  });
  it("is not called unless all 70 count, nothing failed and the corpus is complete", () => {
    expect(summarizeNull(corpus({ fresh: 69 }), { complete: true }).A1.status).toBe("not-called");
    expect(summarizeNull(corpus({ fresh: 69 }), { complete: true, freshFailed: [{ id: "x", reason: "short" }] }).A1.reading).toBe("not called");
    expect(summarizeNull(corpus(), { complete: false }).A1.status).toBe("not-called");
    expect(summarizeNull(corpus({ freshRings: 0 }), { complete: true }).A1.status).toBe("met");
  });
  it("reports v1 on v0's 70 (per preset), v0's rule on the fresh runs, treatment and the calibrated Z*", () => {
    // fresh: 2 ring on the 13-signal rule only (D13 high, D11 low); one fresh has D13 exactly Z* = 7 (not above)
    const entries = corpus({ freshRings: 0, freshD13Extra: [7, 7.5, 9, ...Array(67).fill(1)] });
    const s = summarizeNull(entries, { complete: true });
    expect(s.reported.v1OnV0.gradient).toEqual({ k: 0, of: 40 });
    expect(s.reported.v1OnV0.spots).toEqual({ k: 2, of: 30 });
    expect(s.reported.v1OnV0.total.k).toBe(2);
    expect(s.reported.v1OnV0.total.of).toBe(70);
    expect(s.reported.v0RuleOnFresh).toMatchObject({ k: 3, of: 70 });
    expect(s.reported.calibrated.zStar).toBe(7); // the largest 13-signal D among the 40 envelope runs
    expect(s.reported.calibrated.fresh).toEqual({ k: 2, of: 70 }); // 7.5 and 9; 7 is not above (strict)
    expect(s.reported.calibrated.treatment).toEqual({ k: 10, of: 10 });
    expect(s.reported.treatment.rings11).toEqual({ k: 10, of: 10 });
    expect(s.reported.treatment.effect11).toBe(1);
  });
});

describe("records", () => {
  it("never overwrites a complete record without --force, and writes nothing when nothing was scored", () => {
    expect(recordRefusal1(null, { scored: 5 })).toBeNull();
    expect(recordRefusal1(JSON.stringify({ complete: true }), { scored: 5 })).toMatch(/already holds a complete record/);
    expect(recordRefusal1(JSON.stringify({ complete: true }), { scored: 5, force: true })).toBeNull();
    expect(recordRefusal1(JSON.stringify({ complete: false }), { scored: 5 })).toBeNull();
    // a complete record that called nothing (taken while jobs were still running) does not block the proper run; a called one does
    expect(recordRefusal1(JSON.stringify({ complete: true, called: false }), { scored: 5 })).toBeNull();
    expect(recordRefusal1(JSON.stringify({ complete: true, called: true }), { scored: 5 })).toMatch(/already holds a complete record/);
    expect(recordRefusal1(JSON.stringify({ complete: false, called: true }), { scored: 5 })).toBeNull();
    expect(recordRefusal1("{broken", { scored: 5 })).toBeNull();
    expect(recordRefusal1(null, { scored: 0 })).toMatch(/nothing to record/);
    expect(defaultRecord("null", true)).toBe("experiments/naturalist/bell-v1-null.json");
    expect(defaultRecord("twins", false)).toBe("experiments/naturalist/bell-v1-twins.incomplete.json");
  });
});

// ---------------------------------------------------------------------------------------------
// Part B.

describe("equality, interventions, nudge file, manifests", () => {
  it("deepEqual ignores key order and compares values strictly; rowsEqual compares in file order", () => {
    expect(deepEqual({ a: 1, b: { c: [1, 2, { d: null }] } }, { b: { c: [1, 2, { d: null }] }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual({ a: undefined }, { b: undefined })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(rowsEqual([["a", 1], ["b", 2]], [["a", 1], ["b", 2]])).toBe(true);
    expect(rowsEqual([["a", 1], ["b", 2]], [["b", 2], ["a", 1]])).toBe(false);
    expect(rowsEqual([["a", 1]], [["a", 2]])).toBe(false);
  });
  const jobs = planJobs(nudges);
  const job = (arm: string, seed = 1) => jobs.find((j) => j.arm === arm && j.seed === seed)!;
  it("interventions.jsonl must hold exactly the scheduled entry", () => {
    expect(interventionProblem(job("l96"), `{"step":${S},"kind":"lesion","x":128,"y":128,"r":96}\n`)).toBeNull();
    expect(interventionProblem(job("f"), `{"step":${S},"kind":"feed","x":128,"y":128,"r":32,"amount":64,"matter":205376}`)).toBeNull();
    expect(interventionProblem(job("l96"), null)).toMatch(/holds 0 entries/);
    expect(interventionProblem(job("l96"), `{"step":${S},"kind":"lesion","x":128,"y":128,"r":64}`)).toMatch(/not exactly the scheduled lesion 128,128,96/);
    expect(interventionProblem(job("l96"), `{"step":${S},"kind":"lesion","x":128,"y":128,"r":96}\n{"step":${S},"kind":"lesion","x":128,"y":128,"r":96}`)).toMatch(/holds 2 entries/);
    expect(interventionProblem(job("l96"), "{oops")).toMatch(/line 1/);
    expect(parseInterventions('{"a":1}\n\n{"b":2}\n').length).toBe(2);
  });
  it("reads the nudge file the launcher writes, and refuses a missing seed, a duplicate or a bad centre", () => {
    const centres = (skip?: string) =>
      Array.from({ length: 10 }, (_, i) => (["nudge", "nudge2"] as const).map((arm) => ({ seed: i + 1, arm, target: [128, 128], x: 100 + i, y: 50, d2: 1, B: 3 }))).flat().filter((c) => `${c.seed}${c.arm}` !== skip);
    const ok = parseNudgeFile(JSON.stringify({ rule: "r", centres: centres() }));
    expect(ok[3].nudge).toEqual({ x: 102, y: 50 });
    expect(Object.keys(ok).length).toBe(10);
    expect(() => parseNudgeFile(JSON.stringify({ centres: centres("7nudge2") }))).toThrow(/no nudge2 centre for seed 7/);
    expect(() => parseNudgeFile(JSON.stringify({ centres: [...centres(), { seed: 1, arm: "nudge", x: 1, y: 1 }] }))).toThrow(/duplicate/);
    expect(() => parseNudgeFile(JSON.stringify({ centres: [{ seed: 1, arm: "l96", x: 1, y: 1 }] }))).toThrow(/bad centre/);
    expect(() => parseNudgeFile("nope")).toThrow(/not JSON/);
    expect(() => parseNudgeFile("{}")).toThrow(/no centres/);
  });
  it("the real plan: 10 bases, 50 twins, each paired with its seed's base, distinct directories", () => {
    const p = defaultTwinsPlan("/r", "/b", nudges);
    expect(p.S).toBe(200_000);
    expect(p.steps).toBe(300_000);
    expect(p.bases.map((b) => b.dir)).toEqual(Array.from({ length: 10 }, (_, i) => `/b/replay-m4/gradient-m3/treatment/seed-${i + 1}`));
    expect(p.twins.length).toBe(50);
    expect(new Set(p.twins.map((t) => t.dir)).size).toBe(50);
    const t = p.twins.find((x) => x.id === "twin-l96-4")!;
    expect(t.base).toBe(3);
    expect(t.dir).toBe("/r/bell-v1-twins-l96/gradient-m3/treatment/seed-4");
    expect(t.spec).toEqual({ experiment: "bell-v1-twins-l96", presetId: "gradient-m3", condition: "treatment", seed: 4 });
    expect(t.job.expected).toMatchObject({ step: 200_000, kind: "lesion", r: 96 });
    for (const arm of ARMS) expect(p.twins.filter((x) => x.arm === arm).length).toBe(10);
  });
  it("manifest checks for bases and twins", () => {
    const p = defaultTwinsPlan("/r", "/b", nudges);
    const t = p.twins.find((x) => x.id === "twin-f-2")!;
    const man = (spec: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
      JSON.stringify({ spec: { ...t.spec, steps: STEPS, censusEvery: 100, ...spec }, presetIdentity: "pid", summary: { steps: STEPS }, ...over });
    expect(twinManifestProblem(t, man(), STEPS, "pid")).toBeNull();
    expect(twinManifestProblem(t, man(), STEPS, "other")).toMatch(/differs from its base/);
    expect(twinManifestProblem(t, man({ steps: 1_000_000 }), STEPS, "pid")).toMatch(/exactly/);
    expect(twinManifestProblem(t, man({ experiment: "bell-v1-twins-l96" }), STEPS, "pid")).toMatch(/manifest says/);
    expect(twinManifestProblem(t, man({}, { summary: undefined }), STEPS, "pid")).toMatch(/no summary/);
    expect(twinManifestProblem(t, "{", STEPS, "pid")).toMatch(/not JSON/);
    const b = p.bases[1];
    const bman = (steps: number) => JSON.stringify({ spec: { ...b.spec, steps, censusEvery: 100 }, presetIdentity: "pid", summary: { steps } });
    expect(checkBaseManifest(b, bman(1_000_000), STEPS).presetIdentity).toBe("pid");
    expect(() => checkBaseManifest(b, bman(200_000), STEPS)).toThrow(/at least/);
  });
});

// A synthetic world: random-walk levels and cumulative counters, one run per base.
type Rec = Record<string, unknown> & { step: number };
function makeRun(r: () => number, n: number, level: number): Census[] {
  let cells = level, ind = level / 100, mass = 50, lin = 20, cum = [0, 0, 0, 0], gen = 3;
  const out: Census[] = [];
  for (let k = 1; k <= n; k++) {
    cells = Math.max(1, cells + Math.round((r() - 0.5) * 60));
    ind = Math.max(1, ind + Math.round((r() - 0.5) * 4));
    mass = Math.max(1, mass + (r() - 0.5) * 3);
    lin = Math.max(1, lin + Math.round((r() - 0.5) * 3));
    gen = Math.max(0, gen + Math.round((r() - 0.4) * 2));
    cum = cum.map((c) => c + Math.floor(r() * 4));
    const rec: Rec = {
      step: k * 100, livingCells: cells, individuals: ind, meanMass: mass, lineages: lin, lineageShannon: r() * 3, patternEntropy: r(), bioticRecycling: r(),
      maxGeneration: gen, fissions: cum[0], fusions: cum[1], buddings: cum[2], mutations: cum[3],
    };
    const a = Math.max(1, Math.round(cells * (0.3 + r() * 0.5)));
    out.push({ rec, rows: [["a", a], ["b", Math.max(1, cells - a)]] });
  }
  return out;
}
/** The pair score from first principles: nothing shared with PairScorer but the signal definitions. */
function bruteForce(S: number, bases: Census[][], twinBase: number, twin: Census[]) {
  const n = twin.length;
  const value = (run: Census[], k: number, s: number): number | null => {
    const d = SIGNALS[s];
    if (d.source === "lineages") return dominantShare(run[k].rows);
    const v = finiteOrZero(run[k].rec[d.name]);
    if (d.kind === "level") return v;
    return k >= 10 ? v - finiteOrZero(run[k - 10].rec[d.name]) : null;
  };
  const z = (k: number, s: number): number => {
    const xt = value(twin, k, s), xb = value(bases[twinBase], k, s);
    if (xt === null || xb === null) return 0;
    const ref = bases.map((b) => value(b, k, s) as number).sort((p, q) => p - q);
    const m = quantileSorted(ref, 0.5);
    const spread = Math.max((quantileSorted(ref, 0.75) - quantileSorted(ref, 0.25)) / 1.349, 0.05 * Math.abs(m), SIGNALS[s].floor);
    return (xt - xb) / spread;
  };
  const Z = SIGNALS.map((_, s) => Array.from({ length: n }, (_, k) => z(k, s)));
  const windowMax: number[] = [];
  let D = 0;
  const bySignal: number[] = [];
  for (let f = S + 100; f <= S + 5000; f += 100) {
    const k0 = f / 100 - 1; // census index of step f
    let wmax = -Infinity;
    for (let s = 0; s < SIGNALS.length; s++) {
      for (const side of [1, -1]) {
        let m = Infinity;
        for (let j = 0; j < 10; j++) m = Math.min(m, side * Z[s][k0 + j]);
        wmax = Math.max(wmax, m);
        const idx = s * 2 + (side === 1 ? 0 : 1);
        bySignal[idx] = Math.max(bySignal[idx] ?? 0, m);
        D = Math.max(D, m);
      }
    }
    windowMax.push(wmax);
  }
  return { D, windowMax, bySignal };
}
const spec = (id: string, base = 0) => ({ id, arm: "l96", seed: 1, base });
const asInputs = (cs: Census[][], k: number): TwinInput[] => cs.map((c) => c[k]);

describe("PairScorer: D_pair against a brute-force computation", () => {
  it("matches window by window and signal by signal on random worlds", () => {
    for (const seed of [1, 2, 3, 4]) {
      const r = prng(seed);
      const S0 = 2000, n = 80;
      const bases = Array.from({ length: 10 }, (_, i) => makeRun(r, n, 3000 + 150 * i));
      // twin: base 0 up to S, then a drifted copy with random persistent offsets
      const off = { cells: (r() - 0.5) * 400, ind: (r() - 0.5) * 8, mass: (r() - 0.5) * 20, lin: Math.round((r() - 0.5) * 12), gen: Math.round((r() - 0.5) * 6), fis: Math.floor(r() * 3), ent: (r() - 0.3) * 1.5 };
      const twin: Census[] = bases[0].map(({ rec, rows }, k) => {
        if ((k + 1) * 100 <= S0) return { rec: { ...rec }, rows: rows.map((x) => [...x] as [string, number]) };
        const j = k + 1 - S0 / 100;
        const noise = (r() - 0.5) * 30;
        return {
          rec: {
            ...rec, livingCells: Math.max(1, (rec.livingCells as number) + off.cells + noise), individuals: Math.max(1, (rec.individuals as number) + off.ind), meanMass: Math.max(1, (rec.meanMass as number) + off.mass),
            lineages: Math.max(1, (rec.lineages as number) + off.lin), maxGeneration: Math.max(0, (rec.maxGeneration as number) + off.gen), fissions: (rec.fissions as number) + j * off.fis,
            patternEntropy: (rec.patternEntropy as number) + off.ent * (k % 3 === 0 ? 0.2 : 1),
          },
          rows: [["a", rows[0][1] + Math.round(off.cells / 4)], ["b", rows[1][1]]],
        };
      });
      const ps = new PairScorer(S0, 10, [spec("t")]);
      for (let k = 0; k < n; k++) ps.push(asInputs(bases, k) as Census[], [twin[k]]);
      const got = ps.results()[0];
      const want = bruteForce(S0, bases, 0, twin);
      expect(got.failed).toBeNull();
      expect(got.windowMax.length).toBe(50);
      got.windowMax.forEach((m, i) => expect(m).toBeCloseTo(want.windowMax[i], 9));
      expect(got.D).toBeCloseTo(want.D, 9);
      got.dBySignal.forEach((d, i) => expect(d.D).toBeCloseTo(want.bySignal[i], 9));
      expect(got.D).toBeGreaterThan(0);
      expect(got.diffAtOrBeforeS).toBeNull();
      expect(got.firstDiffStep).toBe(S0 + 100);
    }
  });
});

describe("PairScorer: window edges, sides, strictness and the spread", () => {
  // Ten bases whose livingCells are 1000, 1020, ..., 1180 at every census: median 1090, IQR 90, spread 90/1.349.
  const SP = 90 / 1.349;
  const S0 = 1000, n = 80; // steps 100..8000; S + 5900 = 6900
  const baseRec = (i: number, k: number): Census => ({
    rec: { step: (k + 1) * 100, livingCells: 1000 + 20 * i, individuals: 50, meanMass: 10, lineages: 5, lineageShannon: 1, patternEntropy: 1, bioticRecycling: 0.5, maxGeneration: 4, fissions: 0, fusions: 0, buddings: 0, mutations: 0 },
    rows: [["a", 600 + 20 * i], ["b", 400]],
  });
  const bases = Array.from({ length: 10 }, (_, i) => Array.from({ length: n }, (_, k) => baseRec(i, k)));
  /** A twin of base 0 whose livingCells is shifted by `delta(step)` (undefined: unchanged); its rows follow so only that field differs. */
  const twinShift = (delta: (step: number) => number | undefined): Census[] =>
    bases[0].map((c) => {
      const d = delta(c.rec.step);
      return d === undefined ? { rec: { ...c.rec }, rows: c.rows.map((x) => [...x] as [string, number]) } : { rec: { ...c.rec, livingCells: (c.rec.livingCells as number) + d }, rows: c.rows.map((x) => [...x] as [string, number]) };
    });
  const score = (twin: Census[], base = 0): PairResult => {
    const ps = new PairScorer(S0, 10, [spec("t", base)]);
    for (let k = 0; k < n; k++) ps.push(bases.map((b) => b[k]), [twin[k]]);
    return ps.results()[0];
  };
  const zOf = (delta: number) => Math.abs(delta) / SP;
  const between = (lo: number, hi: number, d: number) => (step: number) => (step >= lo && step <= hi ? d : undefined);

  it("a persistent shift scores shift / spread, and the spread is v0's over the ten bases", () => {
    const r = score(twinShift((step) => (step >= S0 + 100 ? 400 : undefined)));
    expect(r.D).toBeCloseTo(zOf(400), 9);
    expect(r.signal).toBe("livingCells");
    expect(r.side).toBe("high");
    expect(r.firstDiffStep).toBe(S0 + 100);
    expect(r.firstSignalDiffStep).toBe(S0 + 100);
    expect(r.diffAtOrBeforeS).toBeNull();
    expect(r.windowMax[0]).toBeCloseTo(zOf(400), 9);
    expect(r.dose).toEqual({ step: S0 + 100, twin: 1400, base: 1000, delta: 400 });
  });
  it("a shift below the base takes the low side", () => {
    const r = score(twinShift((step) => (step >= S0 + 100 ? -400 : undefined)));
    expect(r.D).toBeCloseTo(zOf(400), 9);
    expect(r.side).toBe("low");
  });
  it("needs ten consecutive censuses: nine do not count, ten do", () => {
    expect(score(twinShift(between(S0 + 100, S0 + 900, 400))).D).toBe(0);
    expect(score(twinShift(between(S0 + 100, S0 + 1000, 400))).D).toBeCloseTo(zOf(400), 9);
  });
  it("the first counted window starts at S + 100: a census at S is not part of a counted window", () => {
    // shift on S .. S+900 (ten censuses): the only window containing all ten starts at S, which is not counted
    const early = score(twinShift(between(S0, S0 + 900, 400)));
    expect(early.D).toBe(0);
    expect(early.diffAtOrBeforeS).toBe(S0); // and the twin differs at S: void
    // shift on S .. forever: windows from S+100 are full
    expect(score(twinShift((step) => (step >= S0 ? 400 : undefined))).D).toBeCloseTo(zOf(400), 9);
  });
  it("the last counted window starts at S + 5000: ten censuses from there count, from S + 5100 they do not", () => {
    expect(score(twinShift(between(S0 + 5000, S0 + 5900, 400))).D).toBeCloseTo(zOf(400), 9);
    expect(score(twinShift(between(S0 + 5100, S0 + 6000, 400))).D).toBe(0);
    // a shift from S + 4900 holds the window starting at S + 4900 (and S + 5000): counted
    expect(score(twinShift(between(S0 + 4900, S0 + 5800, 400))).D).toBeCloseTo(zOf(400), 9);
    // a long shift that starts after S+5000 is a late divergence: nothing counts
    expect(score(twinShift((step) => (step >= S0 + 5100 ? 400 : undefined))).D).toBe(0);
    expect(score(twinShift((step) => (step >= S0 + 5100 ? 400 : undefined))).firstDiffStep).toBe(S0 + 5100);
  });
  it("a window with a census on the other side is worth 0 on a side, and mixed signs score 0", () => {
    const mixed = score(twinShift((step) => (step >= S0 + 100 && step <= S0 + 1500 ? (Math.floor(step / 100) % 2 ? 400 : -400) : undefined)));
    expect(mixed.D).toBe(0);
    const dipThenHold = score(twinShift((step) => (step === S0 + 600 ? 0 : step >= S0 + 100 ? 400 : undefined)));
    expect(dipThenHold.D).toBeCloseTo(zOf(400), 9); // later windows are full of 400
  });
  it("is floored at 0 and only counts early windows even if the divergence is huge later", () => {
    const r = score(twinShift((step) => (step >= S0 + 6000 ? 4000 : undefined)));
    expect(r.D).toBe(0);
    expect(r.windowMax.every((m) => m <= 0)).toBe(true);
  });
  it("takes the base's own series for the difference, not another base's", () => {
    // twin of base 3 (1060) shifted by 400 scores the same shift / spread; its dose compares against base 3
    const twin: Census[] = bases[3].map((c) => ({ rec: { ...c.rec, livingCells: (c.rec.livingCells as number) + ((c.rec.step as number) >= S0 + 100 ? 400 : 0) }, rows: c.rows.map((x) => [...x] as [string, number]) }));
    const r = score(twin, 3);
    expect(r.D).toBeCloseTo(zOf(400), 9);
    expect(r.dose).toMatchObject({ twin: 1460, base: 1060, delta: 400 });
  });
  it("uses the spread of the bases, never the twin: a twin far outside them does not change the unit", () => {
    const a = score(twinShift((step) => (step >= S0 + 100 ? 400 : undefined)));
    const ps = new PairScorer(S0, 10, [spec("t1"), spec("t2")]);
    const t1 = twinShift((step) => (step >= S0 + 100 ? 400 : undefined)), t2 = twinShift((step) => (step >= S0 + 100 ? 100000 : undefined));
    for (let k = 0; k < n; k++) ps.push(bases.map((b) => b[k]), [t1[k], t2[k]]);
    const [r1, r2] = ps.results();
    expect(r1.D).toBe(a.D);
    expect(r2.D).toBeCloseTo(zOf(100000), 6);
  });
  it("a rate is read from each run's own counters over ten censuses", () => {
    const tw = bases[0].map((c, k) => ({ rec: { ...c.rec, mutations: (k + 1) * 20 }, rows: c.rows })); // +20 a census; bases have 0
    // base mutations are 0 and flat: spread = max(0, 0.05*0, floor 1) = 1; twin's rate (10 censuses) = 200
    const r = score(tw);
    const mutS = r.dBySignal.find((d) => d.signal === "mutations" && d.side === "high")!;
    expect(mutS.D).toBe(200);
    expect(r.D).toBe(200);
  });
});

describe("PairScorer: lockstep, failure isolation and validity", () => {
  const mk = (n: number) => {
    const r = prng(9);
    const bases = Array.from({ length: 3 }, (_, i) => makeRun(r, n, 2000 + 100 * i));
    return bases;
  };
  const copy = (c: Census): Census => ({ rec: { ...c.rec }, rows: c.rows.map((x) => [...x] as [string, number]) });
  it("a twin that fails is dropped and the others go on", () => {
    const bases = mk(20);
    const ps = new PairScorer(1000, 3, [spec("good"), spec("bad"), spec("short")]);
    for (let k = 0; k < 20; k++) {
      const good = copy(bases[0][k]);
      const bad: TwinInput = k === 5 ? { fail: "boom" } : copy(bases[0][k]);
      const short: TwinInput = k >= 12 ? { fail: "ended after 12 censuses" } : copy(bases[0][k]);
      ps.push(bases.map((b) => b[k]), [good, bad, short]);
    }
    const [g, b, s] = ps.results();
    expect(g.failed).toBeNull();
    expect(g.censuses).toBe(20);
    expect(b.failed).toBe("boom");
    expect(b.censuses).toBe(5);
    expect(s.failed).toMatch(/ended after 12/);
    ps.fail(0, "more than 20 censuses");
    expect(ps.results()[0].failed).toBe("more than 20 censuses");
  });
  it("a twin census off cadence fails the twin, a base off cadence stops the run", () => {
    const bases = mk(5);
    const ps = new PairScorer(1000, 3, [spec("t")]);
    ps.push(bases.map((b) => b[0]), [copy(bases[0][0])]);
    ps.push(bases.map((b) => b[1]), [copy(bases[0][2])]); // the twin skips a census
    expect(ps.results()[0].failed).toMatch(/expects 200/);
    expect(() => ps.push(bases.map((b) => b[3]), [copy(bases[0][2])])).toThrow(/base 0 is at step 400 where cadence 100 expects 300/);
    expect(() => ps.push(bases.slice(1).map((b) => b[2]), [copy(bases[0][2])])).toThrow(/2 base censuses for 3 bases/);
  });
  it("records the first difference at or before S, and after S, separately", () => {
    const bases = mk(30);
    const ps = new PairScorer(1000, 3, [spec("rowsEarly"), spec("recLate"), spec("rowsLate"), spec("never")]);
    for (let k = 0; k < 30; k++) {
      const step = (k + 1) * 100;
      const a = copy(bases[0][k]), b = copy(bases[0][k]), c = copy(bases[0][k]), d = copy(bases[0][k]);
      if (step === 500) a.rows = [[a.rows[0][0], a.rows[0][1] + 1], ...a.rows.slice(1)]; // only the lineage rows, before S
      if (step === 1000) b.rec.individuals = (b.rec.individuals as number) + 1; // at S: still "at or before"
      if (step === 1500) c.rows = [...c.rows, ["z", 1]]; // lineage rows, after S
      ps.push(bases.map((x) => x[k]), [a, b, c, d]);
    }
    const [a, b, c, d] = ps.results();
    expect(a.diffAtOrBeforeS).toBe(500);
    expect(b.diffAtOrBeforeS).toBe(1000);
    expect(b.firstDiffStep).toBeNull();
    expect(c.diffAtOrBeforeS).toBeNull();
    expect(c.firstDiffStep).toBe(1500);
    expect(d.diffAtOrBeforeS).toBeNull();
    expect(d.firstDiffStep).toBeNull();
  });
  it("voidReasons: a valid twin has none; each rule of the note voids it", () => {
    const base: PairResult = { id: "t", arm: "l96", seed: 1, failed: null, censuses: 3000, diffAtOrBeforeS: null, firstDiffStep: 200_100, firstSignalDiffStep: 200_100, D: 3, signal: "livingCells", side: "low", dBySignal: [], windowMax: [], dose: { step: 200_100, twin: 1, base: 2, delta: -1 } };
    expect(voidReasons(base, S, {})).toEqual([]);
    expect(voidReasons({ ...base, diffAtOrBeforeS: 150_000 }, S, {})).toEqual([expect.stringMatching(/differs from its base at step 150000, at or before S/)]);
    expect(voidReasons({ ...base, firstDiffStep: null }, S, {})).toEqual([expect.stringMatching(/no difference from its base after S/)]);
    expect(voidReasons({ ...base, failed: "ended after 2999 censuses, expected 3000" }, S, {})).toEqual(["stream: ended after 2999 censuses, expected 3000"]);
    expect(voidReasons(base, S, { missing: true, manifest: "no summary (unfinished run)", launch: "launch log: twin-l96-1 exited 1", interventions: "interventions.jsonl holds 0 entries" }).length).toBe(4);
    const o = judgeTwin({ ...base, firstDiffStep: null }, S, {}, null);
    expect(o.valid).toBe(false);
    expect(judgeTwin(base, S, {}, 205_376)).toMatchObject({ valid: true, interventionMatter: 205_376 });
  });
});

describe("summarizeTwins: B2, B3, the reading table", () => {
  const out = (arm: Arm, seed: number, D: number, o: { valid?: boolean; windowMax?: number[]; firstDiff?: number } = {}): TwinOutcome => ({
    id: `twin-${arm}-${seed}`, arm, seed, failed: null, censuses: 3000, diffAtOrBeforeS: null, firstDiffStep: o.firstDiff ?? S + 100, firstSignalDiffStep: S + 100, D, signal: D > 0 ? "livingCells" : null, side: D > 0 ? "low" : null,
    dBySignal: D > 0 ? [{ signal: "livingCells", side: "low", D }] : [], windowMax: o.windowMax ?? Array(50).fill(D), dose: { step: S + 100, twin: 90, base: 100, delta: -10 },
    valid: o.valid ?? true, voidReasons: o.valid === false ? ["bundle missing"] : [], interventionMatter: null,
  });
  const seeds = Array.from({ length: 10 }, (_, i) => i + 1);
  // nudge D = 0.1 .. 1.0, so Z*_pair = 1.0
  const nudgeD = (seed: number) => seed / 10;
  const arm = (a: Arm, hits: number, o: { tie?: number } = {}) => seeds.map((s) => out(a, s, s <= hits ? 2 + s / 10 : s <= hits + (o.tie ?? 0) ? 1.0 : 0.5));
  const base = (b2l96: number, b2f: number, b3: number, extra: TwinOutcome[] = []) => [
    ...seeds.map((s) => out("nudge", s, nudgeD(s))),
    ...arm("nudge2", b3), ...arm("l64", 6), ...arm("l96", b2l96), ...arm("f", b2f), ...extra,
  ];
  const sum = (os: TwinOutcome[], complete = true) => summarizeTwins(os, { S, complete });

  it("Z*_pair is the largest nudge D and a tie at Z* is not a hit (strict)", () => {
    const s = sum(base(8, 8, 0, []).map((o) => o));
    expect(s.zStarPair).toEqual({ value: 1, n: 10, called: true });
    const tied = sum([...seeds.map((x) => out("nudge", x, nudgeD(x))), ...arm("nudge2", 0), ...arm("l64", 0), ...arm("l96", 5, { tie: 5 }), ...arm("f", 0)]);
    expect(tied.arms.l96.hits).toEqual({ k: 5, of: 10 }); // 5 above, 5 exactly at Z*
    expect(tied.twins.filter((t) => t.arm === "l96").map((t) => t.hit)).toEqual([true, true, true, true, true, false, false, false, false, false]);
  });
  it("B2: 8 of 10 meets it, 7 of 10 misses it", () => {
    const s = sum(base(8, 7, 0));
    expect(s.B2.l96).toMatchObject({ called: true, met: true, k: 8, n: 10 });
    expect(s.B2.f).toMatchObject({ called: true, met: false, k: 7 });
    expect(s.B2.l96.bound95).toBeCloseTo(0.49, 1); // the note: one-sided 95% lower bound of about 0.49
    expect(s.B2_l64).toMatchObject({ called: true, met: false, k: 6 });
  });
  it("B3: at most 2 of 10 nudge2 above Z* holds out, 3 does not; reported with the binomial upper bound", () => {
    expect(sum(base(9, 9, 2)).B3).toMatchObject({ called: true, met: true, k: 2 });
    expect(sum(base(9, 9, 2)).B3.bound95).toBeCloseTo(binomialUpperBound(2, 10), 12);
    expect(sum(base(9, 9, 3)).B3).toMatchObject({ called: true, met: false, k: 3 });
  });
  it("the reading table", () => {
    expect(sum(base(9, 9, 1)).reading).toBe("hears events (exploratory)");
    const some = sum(base(9, 5, 1));
    expect(some.reading).toBe("hears some events");
    expect(some.armsMet).toEqual(["L96"]);
    expect(sum(base(5, 9, 0)).armsMet).toEqual(["F"]);
    expect(sum(base(5, 5, 0)).reading).toBe("did not meet the exploratory bar");
    // B3 missed overrides a B2 pass on both arms
    expect(sum(base(10, 10, 3)).reading).toBe("its threshold does not hold out");
    // B3 missed overrides even a failed B2
    expect(sum(base(0, 0, 4)).reading).toBe("its threshold does not hold out");
  });
  it("a void twin means the arm is not called; a void nudge means nothing is called", () => {
    const os = base(9, 9, 0).map((o) => (o.id === "twin-l96-4" ? { ...o, valid: false, voidReasons: ["bundle missing"] } : o));
    const s = sum(os);
    expect(s.B2.l96).toMatchObject({ called: false, met: null });
    expect(s.B2.l96.reason).toMatch(/9 of 10 l96 twins/);
    expect(s.B2.f.called).toBe(true);
    expect(s.reading).toBe("not called");
    expect(s.arms.l96.voidSeeds).toEqual([4]);
    expect(s.arms.l96.hits).toEqual({ k: 8, of: 9 });
    const noNudge = sum(base(9, 9, 0).map((o) => (o.id === "twin-nudge-2" ? { ...o, valid: false } : o)));
    expect(noNudge.zStarPair.called).toBe(false);
    expect(noNudge.B2.l96.called).toBe(false);
    expect(noNudge.B3.called).toBe(false);
    expect(noNudge.reading).toBe("not called");
    // B3 needs all 10 nudge2: 9 valid leaves it uncalled, and the reading cannot say "does not hold out"
    const no2 = sum(base(9, 9, 3).map((o) => (o.id === "twin-nudge2-9" ? { ...o, valid: false } : o)));
    expect(no2.B3.called).toBe(false);
    expect(no2.reading).toBe("not called");
  });
  it("`complete` is only a record flag: one twin void for a missing bundle withholds only the criteria that need it", () => {
    // the finding: the f twin of seed 3 never wrote a bundle. B2 for F is not called (9 of 10 valid); the nudge, nudge2 and L96 twins are all valid.
    const os = base(9, 9, 1).map((o) => (o.id === "twin-f-3" ? { ...o, valid: false, voidReasons: ["bundle missing"] } : o));
    const s = sum(os, false);
    expect(s.complete).toBe(false);
    expect(s.zStarPair).toEqual({ value: 1, n: 10, called: true });
    expect(s.B2.l96).toMatchObject({ called: true, met: true });
    expect(s.B2.f).toMatchObject({ called: false, met: null });
    expect(s.B2.f.reason).toMatch(/9 of 10 f twins/);
    expect(s.B2_l64.called).toBe(true);
    expect(s.B3).toMatchObject({ called: true, met: true, k: 1 });
    expect(s.reading).toBe("not called"); // L96 met and F uncalled: "hears events" or "hears some events", not decidable
    expect(twinsCalled(s)).toBe(true);
    // B3 missed is final whatever B2 says, even with F uncalled
    expect(sum(base(9, 9, 3).map((o) => (o.id === "twin-f-3" ? { ...o, valid: false } : o)), false).reading).toBe("its threshold does not hold out");
    // a complete:false flag with every twin valid changes no call
    expect(sum(base(9, 9, 0), false).reading).toBe("hears events (exploratory)");
    // nothing valid: nothing called
    expect(twinsCalled(sum(base(9, 9, 0).map((o) => ({ ...o, valid: false })), false))).toBe(false);
  });
  it("reports the effect against the nudges, the first window above Z*, the nudges' median D and first differences", () => {
    const wm = (first: number) => Array.from({ length: 50 }, (_, i) => (i >= first ? 3 : 0.2));
    const os = base(9, 9, 0).map((o) => (o.arm === "l96" ? { ...o, windowMax: wm(o.seed), firstDiff: S + 100 } : o.arm === "nudge" ? { ...o, firstDiffStep: S + 100 * o.seed } : o));
    const s = sum(os);
    // nine l96 twins sit above every nudge; the tenth (0.5) beats nudges 0.1..0.4 and ties 0.5: (90 + 4.5) / 100
    expect(s.arms.l96.effectVsNudge).toEqual({ effect: 0.945, nArm: 10, nNudge: 10 });
    expect(s.arms.nudge.effectVsNudge.effect).toBe(0.5);
    expect(s.nudge.medianD).toBeCloseTo(0.55, 12);
    expect(s.nudge.firstDiffSteps).toEqual(seeds.map((x) => S + 100 * x));
    const hit4 = s.twins.find((t) => t.id === "twin-l96-4")!;
    expect(hit4.hit).toBe(true);
    expect(hit4.firstWindowAboveZ).toBe(S + EARLY_FROM + 4 * CADENCE); // window index 4 starts at S + 500
    expect(s.twins.find((t) => t.id === "twin-l96-10")!.hit).toBe(false);
    expect(s.twins.find((t) => t.id === "twin-l96-10")!.firstWindowAboveZ).toBeNull();
    expect(s.twins.find((t) => t.id === "twin-l96-1")!.dose).toMatchObject({ twin: 90, base: 100, delta: -10, interventionMatter: null });
  });
  it("sets the constants of the note", () => {
    expect([W_PAIR, EARLY_FROM, EARLY_TO, PER_ARM, CADENCE]).toEqual([10, 100, 5000, 10, 100]);
  });
});
