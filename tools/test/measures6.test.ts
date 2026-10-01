import { describe, expect, it } from "vitest";
import {
  binom,
  chiSquareSf,
  profileMeasuresV2,
  quantileSorted,
  rankUniformity,
  realTurnover,
  rng,
  runInputDifferences,
  shadowExcessReference,
  shadowExcessStream,
  tieBrokenRanks,
  type Census,
  type ProfileRow,
  type RunInput,
} from "../lib/measures6.ts";

async function* gen<T>(xs: T[]): AsyncGenerator<T> {
  for (const x of xs) yield x;
}
const asMap = (rows: [string, number][]) => new Map(rows);

describe("realTurnover", () => {
  it("is 0 for identical censuses and 1 for disjoint ones", () => {
    expect(realTurnover(asMap([["a", 50], ["b", 50]]), [["a", 50], ["b", 50]])).toBe(0);
    expect(realTurnover(asMap([["a", 50], ["b", 50]]), [["c", 60], ["d", 40]])).toBe(1);
  });
  it("counts the replaced fraction of the previous cells", () => {
    // One of two equal keys halves and a newcomer takes the freed cells: 25 of 100 cells replaced.
    expect(realTurnover(asMap([["a", 50], ["b", 50]]), [["a", 25], ["b", 50], ["c", 25]])).toBe(0.25);
    // One of two equal keys vanishes with nothing in its place: the same quarter by the formula (50 / (2 * 100)).
    expect(realTurnover(asMap([["a", 50], ["b", 50]]), [["b", 50]])).toBe(0.25);
  });
  it("is 1 without a previous census, clamps at 1, and ignores empty rows", () => {
    expect(realTurnover(null, [["a", 10]])).toBe(1);
    expect(realTurnover(asMap([["a", 10]]), [["b", 10], ["c", 100]])).toBe(1);
    expect(realTurnover(asMap([["a", 10]]), [["a", 10], ["b", 0]])).toBe(0);
  });
});

/** The original tools/foundations.ts shadowExcess loop, copied verbatim over an in-memory stream (the oracle for "full" mode). */
function originalShadowExcess(censuses: Census[], threshold: number, k = 20, seed = 4_500_001) {
  const r = rng(seed);
  let prev = new Set<string>();
  const real = new Map<string, { act: number; crossed: boolean }>();
  let realNew = 0;
  const sh = Array.from({ length: k }, () => ({ counts: [] as number[], act: [] as number[], crossed: [] as boolean[], cumNew: 0 }));
  for (const [, rows] of censuses) {
    const now = new Set<string>();
    let total = 0, bornCells = 0;
    const births: number[] = [];
    for (const [key, c] of rows) {
      if (c <= 0) continue;
      now.add(key);
      total += c;
      let v = real.get(key);
      if (!v) real.set(key, (v = { act: 0, crossed: false }));
      v.act += c;
      if (!v.crossed && v.act > threshold) {
        v.crossed = true;
        realNew++;
      }
      if (!prev.has(key)) {
        births.push(c);
        bornCells += c;
      }
    }
    for (const key of [...real.keys()]) if (!now.has(key)) real.delete(key);
    prev = now;
    const rest = Math.max(0, total - bornCells);
    for (const x of sh) {
      const mass = x.counts.reduce((s, c) => s + c, 0);
      let n = mass > 0 ? rest : 0, left = mass;
      const counts: number[] = [], act: number[] = [], crossed: boolean[] = [];
      for (let i = 0; i < x.counts.length && n > 0; i++) {
        const c = binom(n, x.counts[i] / left, r);
        left -= x.counts[i];
        n -= c;
        if (c > 0) {
          counts.push(c);
          act.push(x.act[i] + c);
          crossed.push(x.crossed[i]);
        }
      }
      for (const b of births) {
        counts.push(b);
        act.push(b);
        crossed.push(false);
      }
      for (let i = 0; i < act.length; i++)
        if (!crossed[i] && act[i] > threshold) {
          crossed[i] = true;
          x.cumNew++;
        }
      [x.counts, x.act, x.crossed] = [counts, act, crossed];
    }
  }
  const shadows = sh.map((x) => x.cumNew).sort((p, q) => p - q);
  return { real: realNew, shadowMedian: quantileSorted(shadows, 0.5), shadowMax: shadows[shadows.length - 1], excess: realNew - quantileSorted(shadows, 0.5), flagged: realNew > shadows[shadows.length - 1] };
}

/** Five censuses over three lineages (a persists, b fades, c is born at the third census), with a low threshold so crossings happen. */
const HAND: Census[] = [
  [100, [["a", 40], ["b", 40], ["c0", 20]]],
  [200, [["a", 45], ["b", 35], ["c0", 20]]],
  [300, [["a", 50], ["b", 20], ["c0", 20], ["c", 10]]],
  [400, [["a", 55], ["b", 15], ["c0", 15], ["c", 15]]],
  [500, [["a", 60], ["b", 10], ["c", 30]]],
];
const key = (x: Awaited<ReturnType<typeof shadowExcessStream>>) => JSON.stringify(x);

describe("shadowExcessStream, full mode", () => {
  it("is deterministic given the seed and changes with another seed", async () => {
    const a = await shadowExcessStream(gen(HAND), 200, 20, 4_500_001, "full");
    const b = await shadowExcessStream(gen(HAND), 200, 20, 4_500_001, "full");
    expect(key(b)).toBe(key(a));
    expect(a.k).toBe(20);
    expect(a.rank).toBeGreaterThanOrEqual(0);
    expect(a.rank).toBeLessThanOrEqual(20);
    // Another seed moves at least one of a handful of summary values.
    const others = await Promise.all([1, 2, 3, 4, 5].map((s) => shadowExcessStream(gen(HAND), 200, 20, s, "full")));
    expect(others.some((o) => key(o) !== key(a))).toBe(true);
  });
  it("reproduces the original shadowExcess loop exactly (k = 20, same seed)", async () => {
    // A bigger stream than HAND: 40 censuses, 12 lineages of mixed sizes, births every fifth census.
    const r = rng(77);
    const stream: Census[] = [];
    let live: [string, number][] = Array.from({ length: 12 }, (_, i) => [`L${i}`, 5 + Math.floor(r() * 80)] as [string, number]);
    let id = 12;
    for (let t = 0; t < 40; t++) {
      stream.push([100 * (t + 1), live]);
      live = live.map(([k, c]) => [k, Math.max(0, c + Math.floor(r() * 21) - 10)] as [string, number]);
      if (t % 5 === 4) live.push([`L${id++}`, 20 + Math.floor(r() * 30)]);
    }
    for (const threshold of [300, 1000]) {
      const want = originalShadowExcess(stream, threshold);
      const got = await shadowExcessStream(gen(stream), threshold, 20, 4_500_001, "full");
      const { rank, k, ties, ...rest } = got;
      expect(rest).toEqual(want);
      expect(k).toBe(20);
      expect(rank).toBeGreaterThanOrEqual(0);
      expect(ties).toBeGreaterThanOrEqual(0);
      expect(rank + ties).toBeLessThanOrEqual(20);
    }
  });
  it("defines rank as the number of shadows strictly exceeded, so flagged is rank === k", async () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const threshold of [60, 100, 200]) {
        const res = await shadowExcessStream(gen(HAND), threshold, 9, seed, "full");
        expect(res.flagged).toBe(res.rank === 9);
        expect(res.rank).toBeLessThanOrEqual(9);
        expect(res.ties).toBeGreaterThanOrEqual(0);
        expect(res.rank + res.ties).toBeLessThanOrEqual(9);
        if (res.rank === 9) expect(res.real).toBeGreaterThan(res.shadowMax);
        if (res.rank === 0) expect(res.real).toBeLessThanOrEqual(res.shadowMedian);
      }
    }
  });
});

/** A random census stream: `lineages` lineages of mixed sizes (some large), noisy counts, churn and births. */
function randomStream(seed: number, censuses: number, lineages: number, big: number): Census[] {
  const r = rng(seed);
  const out: Census[] = [];
  let live: [string, number][] = Array.from({ length: lineages }, (_, i) => [`L${i}`, 1 + Math.floor(r() * (i % 5 === 0 ? big : 40))] as [string, number]);
  let id = lineages;
  for (let t = 0; t < censuses; t++) {
    out.push([100 * (t + 1), live.map(([k, c]) => [k, c] as [string, number])]);
    const wobble = r() < 0.3 ? 40 : 6; // some censuses change a lot, most little
    live = live.map(([k, c]) => [k, r() < 0.04 ? 0 : Math.max(0, c + Math.floor(r() * (2 * wobble + 1)) - wobble)] as [string, number]);
    for (let b = Math.floor(r() * 4); b > 0; b--) live.push([`L${id++}`, 1 + Math.floor(r() * 30)]);
  }
  return out;
}

describe("shadowExcessStream equals the plain reference implementation", () => {
  for (const mode of ["full", "observed"] as const)
    it(`in ${mode} mode, including every field and the rank, on random streams`, async () => {
      for (const [seed, censuses, lineages, big, threshold, k] of [[1, 60, 15, 400, 500, 8], [2, 80, 40, 150, 800, 12], [3, 50, 8, 2000, 3000, 6], [4, 120, 25, 60, 300, 20]] as const) {
        const stream = randomStream(seed, censuses, lineages, big);
        const want = await shadowExcessReference(gen(stream), threshold, k, 4_500_001 + seed, mode);
        const got = await shadowExcessStream(gen(stream), threshold, k, 4_500_001 + seed, mode);
        expect(got).toEqual(want);
      }
    });
  it("reproduces the original shadowExcess loop exactly on the real-data scale of k = 20", async () => {
    const stream = randomStream(9, 150, 30, 300);
    const want = originalShadowExcess(stream, 600);
    const { rank, k, ties, ...rest } = await shadowExcessStream(gen(stream), 600, 20, 4_500_001, "full");
    expect(rest).toEqual(want);
    expect(k).toBe(20);
    expect(rank).toBeGreaterThanOrEqual(0);
    expect(ties).toBeGreaterThanOrEqual(0);
    expect(rank + ties).toBeLessThanOrEqual(20);
  });
});

describe("shadowExcessStream, observed mode", () => {
  it("equals full mode when everything turns over, and keeps lineages when nothing does", async () => {
    // Disjoint censuses: tau = 1 at every census, so no cells are kept and the draw sequence is the full one.
    const disjoint: Census[] = Array.from({ length: 12 }, (_, t) => [100 * (t + 1), [[`x${t}a`, 60], [`x${t}b`, 40]]] as Census);
    const f = await shadowExcessStream(gen(disjoint), 150, 8, 5, "full");
    const o = await shadowExcessStream(gen(disjoint), 150, 8, 5, "observed");
    expect(key(o)).toBe(key(f));
    // A static world: tau = 0 after the first census, so a shadow component keeps all its cells and the shadow stays
    // equal to the real run (the real run crosses at the same census as every shadow: rank 0, nothing exceeded).
    const still: Census[] = Array.from({ length: 12 }, (_, t) => [100 * (t + 1), [["a", 60], ["b", 40]]] as Census);
    const s = await shadowExcessStream(gen(still), 150, 8, 5, "observed");
    expect(s.real).toBe(2);
    expect(s.shadowMedian).toBe(2);
    expect(s.shadowMax).toBe(2);
    expect(s.flagged).toBe(false);
    expect(s.rank).toBe(0);
    // Every shadow equals the real value: all k = 8 are ties.
    expect(s.ties).toBe(8);
  });
});

/**
 * A neutral Wright-Fisher run that matches the "full" shadow model: `cells` cells in `lineages` lineages; at every
 * census all cells except the freshly injected ones are resampled from the previous abundances (same sampler as the
 * shadow), and `births` new lineages of `size` cells enter.
 */
async function* neutralRun(seed: number, o: { lineages: number; cells: number; censuses: number; births: number; size: number }): AsyncGenerator<Census> {
  const r = rng(seed);
  let counts: [string, number][] = Array.from({ length: o.lineages }, (_, i) => [`L${i}`, o.cells / o.lineages] as [string, number]);
  let id = o.lineages;
  for (let t = 0; t < o.censuses; t++) {
    yield [100 * (t + 1), counts];
    let n = o.cells - o.births * o.size, left = counts.reduce((s, [, c]) => s + c, 0);
    const next: [string, number][] = [];
    for (let i = 0; i < counts.length && n > 0; i++) {
      const c = binom(n, counts[i][1] / left, r);
      left -= counts[i][1];
      n -= c;
      if (c > 0) next.push([counts[i][0], c]);
    }
    for (let b = 0; b < o.births; b++) next.push([`L${id++}`, o.size]);
    counts = next;
  }
}

describe("shadowExcessStream calibration", () => {
  /** Full mode against `runs` exchangeable neutral runs: flag fraction, mean rank / k and the rank-uniformity test. */
  const calibrate = async (threshold: number, runs: number, K: number) => {
    let flagged = 0, rankSum = 0;
    const ranks: number[] = [];
    for (let i = 0; i < runs; i++) {
      const res = await shadowExcessStream(neutralRun(9_000 + i, { lineages: 50, cells: 2000, censuses: 200, births: 5, size: 10 }), threshold, K, 123_456 + i, "full");
      if (res.flagged) flagged++;
      rankSum += res.rank / K;
      ranks.push(res.rank);
    }
    const u = rankUniformity(ranks, K, 10);
    console.log(`calibration (threshold ${threshold}): ${runs} runs, flagged ${flagged} (${(flagged / runs).toFixed(3)}), mean rank/k ${(rankSum / runs).toFixed(3)}, chi2 ${u.chi2.toFixed(1)} p ${u.p.toFixed(3)} bins ${u.bins.join(",")}`);
    return { frac: flagged / runs, meanRank: rankSum / runs, p: u.p };
  };
  it("flags about 1/(k+1) of exchangeable neutral runs and ranks them about uniformly (plan parameters, threshold 3000, k = 19)", async () => {
    // About 15 crossings per run, so ties between the real run and shadows are common and strict ranks lean low
    // (flag fraction 0.023 against the window [0.02, 0.09], mean rank 0.44 against [0.4, 0.6]).
    const { frac, meanRank } = await calibrate(3000, 300, 19);
    expect(frac).toBeGreaterThanOrEqual(0.02);
    expect(frac).toBeLessThanOrEqual(0.09);
    expect(meanRank).toBeGreaterThanOrEqual(0.4);
    expect(meanRank).toBeLessThanOrEqual(0.6);
  });
  it("is closer to nominal with fewer ties (threshold 800: about 130 crossings per run, 150 runs)", async () => {
    const { frac, meanRank, p } = await calibrate(800, 150, 19);
    expect(frac).toBeGreaterThanOrEqual(0.02);
    expect(frac).toBeLessThanOrEqual(0.09);
    expect(meanRank).toBeGreaterThanOrEqual(0.45);
    expect(meanRank).toBeLessThanOrEqual(0.55);
    expect(p).toBeGreaterThan(0.01);
  });
});

describe("chi-square survival function and rank uniformity", () => {
  it("matches tabulated values", () => {
    expect(chiSquareSf(16.919, 9)).toBeCloseTo(0.05, 4);
    expect(chiSquareSf(21.666, 9)).toBeCloseTo(0.01, 4);
    expect(chiSquareSf(9, 9)).toBeCloseTo(0.4373, 3);
    expect(chiSquareSf(3.841, 1)).toBeCloseTo(0.05, 4);
    expect(chiSquareSf(0, 9)).toBe(1);
  });
  it("bins the k + 1 ranks into equal bins and tests uniformity", () => {
    const k = 99;
    const flat = Array.from({ length: 70 }, (_, i) => Math.floor((i * (k + 1)) / 70));
    const u = rankUniformity(flat, k, 10);
    expect(u.bins.reduce((s, x) => s + x, 0)).toBe(70);
    expect(u.expected.every((e) => Math.abs(e - 7) < 1e-12)).toBe(true);
    expect(u.p).toBeGreaterThan(0.9);
    const spike = rankUniformity(Array.from({ length: 70 }, () => k), k, 10);
    expect(spike.bins[9]).toBe(70);
    expect(spike.p).toBeLessThan(1e-20);
    // k = 199: 200 ranks, 20 per bin.
    expect(rankUniformity([0, 19, 20, 199], 199, 10).bins).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
  });
});

describe("runInputDifferences", () => {
  const input: RunInput = { runId: "replay-m4/spots-m3/neutral/seed-1", initHash: "63266cb8fead45a5", finalHash: "91d64e06f31fb420", steps: 1_000_000, metricsVersion: 2, lineagesBytes: 20_889_522, profilesBytes: 4_957_384 };
  it("is empty for equal inputs, including a missing table on both sides", () => {
    expect(runInputDifferences(input, { ...input })).toEqual([]);
    expect(runInputDifferences({ ...input, profilesBytes: null }, { ...input, profilesBytes: null })).toEqual([]);
  });
  it("names every differing field with the cached and the current value, in field order", () => {
    const now: RunInput = { ...input, finalHash: "0000000000000000", lineagesBytes: 1_000_000, profilesBytes: null };
    expect(runInputDifferences(input, now)).toEqual([
      "finalHash: cached 91d64e06f31fb420, now 0000000000000000",
      "lineagesBytes: cached 20889522, now 1000000",
      "profilesBytes: cached 4957384, now null",
    ]);
  });
  it("treats a field missing from the cached record as different", () => {
    const { steps: _steps, ...rest } = input;
    expect(runInputDifferences(rest as RunInput, input)).toEqual(["steps: cached undefined, now 1000000"]);
  });
});

describe("tieBrokenRanks", () => {
  const items = [{ rank: 0, ties: 99 }, { rank: 40, ties: 0 }, { rank: 10, ties: 5 }, { rank: 99, ties: 0 }, { rank: 3, ties: 7 }, { rank: 0, ties: 0 }];
  it("is deterministic for a seed and changes with another seed", () => {
    const a = tieBrokenRanks(items, 4_500_201);
    expect(tieBrokenRanks(items, 4_500_201)).toEqual(a);
    expect(tieBrokenRanks(items, 4_500_202)).not.toEqual(a);
  });
  it("stays within [rank, rank + ties] and equals the rank when there are no ties", () => {
    for (const seed of [1, 2, 3, 4_500_201, 4_500_202]) {
      const t = tieBrokenRanks(items, seed);
      expect(t).toHaveLength(items.length);
      items.forEach((x, i) => {
        expect(Number.isInteger(t[i])).toBe(true);
        expect(t[i]).toBeGreaterThanOrEqual(x.rank);
        expect(t[i]).toBeLessThanOrEqual(x.rank + x.ties);
        if (x.ties === 0) expect(t[i]).toBe(x.rank);
      });
    }
  });
  it("draws once per item even without ties, so the sequence is fixed by list order", () => {
    // Item 1 (ties = 0) still consumes a draw: item 2 gets the third draw of the stream either way.
    const r = rng(7);
    const draws = [r(), r(), r()];
    const t = tieBrokenRanks([{ rank: 0, ties: 9 }, { rank: 5, ties: 0 }, { rank: 0, ties: 9 }], 7);
    expect(t).toEqual([Math.floor(draws[0] * 10), 5, Math.floor(draws[2] * 10)]);
  });
  it("repairs the review's scenario: 70 runs that tie all 99 shadows are not evidence against the null", () => {
    const k = 99;
    const tied = Array.from({ length: 70 }, () => ({ rank: 0, ties: 99 }));
    // Strict ranks: all 70 land in the lowest bin (chi2 = 630, 9 df).
    const strict = rankUniformity(tied.map((x) => x.rank), k, 10);
    expect(strict.p).toBeLessThan(1e-50);
    // Tie-broken ranks are uniform on 0..99 under exchangeability, and the test no longer rejects.
    const broken = rankUniformity(tieBrokenRanks(tied, 4_500_201), k, 10);
    expect(broken.n).toBe(70);
    expect(broken.p).toBeGreaterThan(0.01);
  });
});

/** Rows of one deep census: `spec` lists (lineage, cells, flux) triples; `flux` = [photo, grow, decomp, resp]. */
const row = (step: number, lineage: string, cells: number, flux: number[], role = "phototroph", mu = 20, sigma = 10): ProfileRow => ({
  step, lineage, cells, photo: flux[0], grow: flux[1], decomp: flux[2], resp: flux[3], role, mu, sigma,
});

describe("persistentNoveltyV2", () => {
  /** Censuses every 1000 steps from 100 to 500,100; a steady background in one bin, plus (from..to) a new bin held by a different lineage each census. */
  const stream = (share: number, from: number, to: number): ProfileRow[] => {
    const out: ProfileRow[] = [];
    for (let step = 100; step <= 500_100; step += 1000) {
      const cells = step >= from && step <= to ? Math.round(share * 1000) : 0;
      out.push(row(step, "bg", 1000 - cells, [10, 0, 0, 5], "phototroph", 20, 10));
      if (cells) out.push(row(step, `fresh-${step}`, cells, [0, 0, 10, 5], "decomposer", 60, 30));
    }
    return out;
  };
  it("counts a bin held across different short-lived lineages at 2% of cells", async () => {
    const res = await profileMeasuresV2(gen(stream(0.02, 200_100, 400_100)), 1_000_000);
    expect(res.persistentNoveltyV2).toBe(1);
    expect(res.novelty).toBeGreaterThanOrEqual(1);
  });
  it("does not count the same stream at 0.5% of cells", async () => {
    const res = await profileMeasuresV2(gen(stream(0.005, 200_100, 400_100)), 1_000_000);
    expect(res.persistentNoveltyV2).toBe(0);
    expect(res.novelty).toBe(0);
  });
  it("needs a span of 1e5 steps: 99,000 steps is not persistent, 100,000 is", async () => {
    expect((await profileMeasuresV2(gen(stream(0.02, 200_100, 299_100)), 1_000_000)).persistentNoveltyV2).toBe(0);
    expect((await profileMeasuresV2(gen(stream(0.02, 200_100, 300_100)), 1_000_000)).persistentNoveltyV2).toBe(1);
  });
  it("does not count bins that were already held by 1e5 steps, nor a streak broken by one census", async () => {
    expect((await profileMeasuresV2(gen(stream(0.02, 100, 400_100)), 1_000_000)).persistentNoveltyV2).toBe(0);
    const broken = stream(0.02, 200_100, 400_100).filter((x) => x.step !== 300_100 || x.lineage === "bg");
    expect((await profileMeasuresV2(gen(broken), 1_000_000)).persistentNoveltyV2).toBe(0);
  });
});

describe("roleClustersV2", () => {
  const P = [1, 0, 0, 0], Q = [0, 0, 1, 0];
  /** One census at step 600,000 (after horizon / 2 = 500,000), 1000 cells in all. */
  const census = (parts: { n: number; cells: number; flux: number[] }[], rest = 0): ProfileRow[] => {
    const out: ProfileRow[] = [];
    let id = 0;
    for (const p of parts) for (let i = 0; i < p.n; i++) out.push(row(600_000, `l${id++}`, p.cells, p.flux, "phototroph", 10 + id, 10));
    if (rest) out.push(row(600_000, "zero", rest, [0, 0, 0, 0], "chemotroph", 0, 0));
    return out;
  };
  it("is 1 for one profile spread over many 0.1% lineages summing to 60%", async () => {
    const rows = census([{ n: 600, cells: 1, flux: P }, { n: 400, cells: 1, flux: [0, 0, 0, 0] }]);
    const res = await profileMeasuresV2(gen(rows), 1_000_000);
    expect(res.roleClustersV2).toBe(1);
    expect(res.zeroFluxShare).toBeCloseTo(0.4, 12);
  });
  it("is 2 for two distinct profiles at 30% each", async () => {
    const rows = census([{ n: 30, cells: 10, flux: P }, { n: 30, cells: 10, flux: Q }, { n: 40, cells: 10, flux: [0, 0, 0, 0] }]);
    // 600 of 1000 cells have flux, 400 are zero-flux: two clusters of 30% each.
    expect((await profileMeasuresV2(gen(rows), 1_000_000)).roleClustersV2).toBe(2);
  });
  it("still gives 2 when zero-flux rows hold 40%, with zeroFluxShare near 0.4", async () => {
    const rows = census([{ n: 3, cells: 100, flux: P }, { n: 3, cells: 100, flux: Q }], 400);
    const res = await profileMeasuresV2(gen(rows), 1_000_000);
    expect(res.roleClustersV2).toBe(2);
    expect(res.zeroFluxShare).toBeCloseTo(0.4, 12);
  });
  it("links profiles closer than 0.2 (L1) and splits farther ones, on the 0.02 grid", async () => {
    const near = census([{ n: 1, cells: 300, flux: [100, 0, 0, 0] }, { n: 1, cells: 300, flux: [91, 9, 0, 0] }]); // L1 = 0.18
    expect((await profileMeasuresV2(gen(near), 1_000_000)).roleClustersV2).toBe(1);
    const far = census([{ n: 1, cells: 300, flux: [100, 0, 0, 0] }, { n: 1, cells: 300, flux: [90, 10, 0, 0] }]); // L1 = 0.2: not linked
    expect((await profileMeasuresV2(gen(far), 1_000_000)).roleClustersV2).toBe(2);
  });
  it("uses the share of all living cells, including zero-flux rows, for the 5% bar and reports null before the second half", async () => {
    // 4% of cells in a profile: not a cluster.
    const rows = census([{ n: 1, cells: 40, flux: P }], 960);
    expect((await profileMeasuresV2(gen(rows), 1_000_000)).roleClustersV2).toBe(0);
    const early = rows.map((x) => ({ ...x, step: 400_000 }));
    const res = await profileMeasuresV2(gen(early), 1_000_000);
    expect(res.roleClustersV2).toBeNull();
    expect(res.rolesPresent).toBeNull();
  });
  it("counts roles with summed share >= 5% as before", async () => {
    const rows = [row(600_000, "a", 500, P, "phototroph"), row(600_000, "b", 300, Q, "decomposer"), row(600_000, "c", 30, Q, "mixed"), row(600_000, "d", 170, P, "phototroph")];
    expect((await profileMeasuresV2(gen(rows), 1_000_000)).rolesPresent).toBe(2);
  });
});
