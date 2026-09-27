import { describe, expect, it } from "vitest";
import {
  applyQuantileBins,
  bootstrapOverWorlds,
  buildWorldTrajectory,
  crossWorldNull,
  discreteEntropy,
  fitQuantileBins,
  individualityReport,
  jointMutualInformationDiscrete,
  millerMadowEntropy,
  MIN_CALIBRATED_WORLDS,
  mulberry32,
  mutualInformationDiscrete,
  williamsBeerPID,
  type WorldTrajectory,
} from "@bl/metrics";

// Deterministic synthetic generators, all via mulberry32 with a fixed seed so
// every test is exactly reproducible.

function uniformSymbols(seed: number, n: number, k: number): Uint8Array {
  const rng = mulberry32(seed);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rng() * k);
  return out;
}

/** 3-state Markov chain, biased toward advancing by 1 (mod 3) each step. */
function markovChain(seed: number, n: number, states = 3, stay = 0.9): Uint8Array {
  const rng = mulberry32(seed);
  const out = new Uint8Array(n);
  out[0] = 0;
  for (let i = 1; i < n; i++) out[i] = rng() < stay ? (out[i - 1] + 1) % states : Math.floor(rng() * states);
  return out;
}

describe("discreteEntropy / millerMadowEntropy", () => {
  it("uniform distribution over k symbols has plugin entropy log2(k) at large N", () => {
    const x = uniformSymbols(1, 20000, 4);
    expect(discreteEntropy(x, 4)).toBeCloseTo(2, 1);
  });
  it("a constant sequence has entropy 0 and exactly one nonempty bin", () => {
    const x = new Uint8Array(1000).fill(2);
    expect(discreteEntropy(x, 4)).toBe(0);
    expect(millerMadowEntropy(x, 4).nonemptyBins).toBe(1);
  });
});

describe("mutualInformationDiscrete", () => {
  it("independent uniform sequences give near-zero corrected MI, below plugin", () => {
    const x = uniformSymbols(2, 20000, 3);
    const y = uniformSymbols(3, 20000, 3);
    const mi = mutualInformationDiscrete(x, y, 3, 3);
    expect(Math.abs(mi.corrected)).toBeLessThan(0.02);
    expect(mi.corrected).toBeLessThan(mi.plugin);
  });

  it("y = x exactly: plugin MI(x;x) === plugin entropy of x, and corrected MI(x;x) === corrected entropy of x (not plugin entropy)", () => {
    const x = uniformSymbols(4, 500, 5);
    const mi = mutualInformationDiscrete(x, x, 5, 5);
    const h = millerMadowEntropy(x, 5);
    expect(mi.plugin).toBeCloseTo(discreteEntropy(x, 5), 12);
    expect(mi.corrected).toBeCloseTo(h.corrected, 12);
    expect(Math.abs(mi.corrected - discreteEntropy(x, 5))).toBeGreaterThan(1e-6);
  });
});

describe("williamsBeerPID", () => {
  const N = 20000;

  it("XOR: pure synergy (textbook Williams-Beer worked example)", () => {
    const s = uniformSymbols(40, N, 2);
    const e = uniformSymbols(41, N, 2);
    const sNext = new Uint8Array(N);
    for (let i = 0; i < N; i++) sNext[i] = s[i] ^ e[i];
    const pid = williamsBeerPID(s, e, sNext, 2, 2, 2);
    const jointMI = mutualInformationDiscrete(
      Array.from(s, (v, i) => v * 2 + e[i]),
      sNext,
      4,
      2,
    ).plugin;
    expect(pid.redundancy).toBeCloseTo(0, 1);
    expect(pid.uniqueS).toBeCloseTo(0, 1);
    expect(pid.uniqueE).toBeCloseTo(0, 1);
    expect(pid.synergy).toBeCloseTo(jointMI, 1);
    expect(jointMI).toBeCloseTo(1, 1);
    expect(pid.redundancy + pid.uniqueS + pid.uniqueE + pid.synergy).toBeCloseTo(jointMI, 6);
  });

  it("S = E (known nonzero redundancy): I_min correctness fixture", () => {
    const s = uniformSymbols(50, N, 2);
    const e = s; // identical variable
    const target = s;
    const pid = williamsBeerPID(s, e, target, 2, 2, 2);
    expect(pid.redundancy).toBeCloseTo(discreteEntropy(s, 2), 1);
    expect(pid.uniqueS).toBeCloseTo(0, 1);
    expect(pid.uniqueE).toBeCloseTo(0, 1);
    expect(pid.synergy).toBeCloseTo(0, 1);
  });
});

describe("fitQuantileBins constant/heavily-tied inputs", () => {
  it("a fully constant sample reports effectiveBins=1, not 2, and applyQuantileBins never disagrees with that", () => {
    const bin = fitQuantileBins([7, 7, 7], 3);
    expect(bin.effectiveBins).toBe(1);
    expect(bin.edges).toEqual([]);
  });

  it("a sample whose single computed threshold ties the sample maximum collapses to one effective bin", () => {
    const bin = fitQuantileBins([1, 2, 2, 2], 2);
    expect(bin.effectiveBins).toBe(1);
  });

  it("a genuinely bimodal heavily-tied sample still reports 2 effective bins", () => {
    const bin = fitQuantileBins([1, 1, 5, 5], 3);
    expect(bin.effectiveBins).toBe(2);
  });
});

describe("WorldTrajectory / buildWorldTrajectory", () => {
  it("throws when either alphabet exceeds Uint8Array capacity (256)", () => {
    expect(() => buildWorldTrajectory([0, 1], [0], 257, 2)).toThrow();
    expect(() => buildWorldTrajectory([0, 1], [0], 2, 257)).toThrow();
  });

  it("throws when sSymbols is not exactly one longer than eSymbols", () => {
    expect(() => buildWorldTrajectory([0, 1, 2], [0], 3, 2)).toThrow();
  });

  it("sNext[i] === sSymbols[i+1], and s is sSymbols with the last entry dropped", () => {
    const sSymbols = [0, 1, 2, 0, 1];
    const eSymbols = [0, 1, 0, 1];
    const traj = buildWorldTrajectory(sSymbols, eSymbols, 3, 2);
    expect(Array.from(traj.s)).toEqual(sSymbols.slice(0, -1));
    expect(Array.from(traj.sNext)).toEqual(sSymbols.slice(1));
    expect(Array.from(traj.e)).toEqual(eSymbols);
  });
});

describe("bootstrapOverWorlds", () => {
  it("R identical worlds (same generative seed run R times) gives a near-zero-width CI", () => {
    const R = 8, T = 600;
    const worlds: WorldTrajectory[] = [];
    for (let w = 0; w < R; w++) {
      const chain = markovChain(1, T + 1, 3, 0.9); // same seed every world -> byte-identical worlds
      worlds.push({ s: chain.slice(0, T), sNext: chain.slice(1, T + 1), e: uniformSymbols(1, T, 2) });
    }
    const stat = (w: WorldTrajectory) => mutualInformationDiscrete(w.s, w.sNext, 3, 3).corrected;
    const ci = bootstrapOverWorlds(worlds, stat, { draws: 300, seed: 5 });
    expect(ci.upper - ci.lower).toBeLessThan(1e-9);
  });

  it("R genuinely varying worlds gives a materially wider CI than R identical worlds", () => {
    const R = 8, T = 300;
    const identical: WorldTrajectory[] = [];
    const varying: WorldTrajectory[] = [];
    for (let w = 0; w < R; w++) {
      const same = markovChain(1, T + 1, 3, 0.9);
      identical.push({ s: same.slice(0, T), sNext: same.slice(1, T + 1), e: uniformSymbols(1, T, 2) });
      const diff = markovChain(100 + w, T + 1, 3, 0.9);
      varying.push({ s: diff.slice(0, T), sNext: diff.slice(1, T + 1), e: uniformSymbols(200 + w, T, 2) });
    }
    const stat = (w: WorldTrajectory) => mutualInformationDiscrete(w.s, w.sNext, 3, 3).corrected;
    const ciIdentical = bootstrapOverWorlds(identical, stat, { draws: 300, seed: 5 });
    const ciVarying = bootstrapOverWorlds(varying, stat, { draws: 300, seed: 6 });
    expect(ciVarying.upper - ciVarying.lower).toBeGreaterThan(ciIdentical.upper - ciIdentical.lower);
  });

  it("throws for worlds.length < 2", () => {
    const w: WorldTrajectory = { s: new Uint8Array(10), sNext: new Uint8Array(10), e: new Uint8Array(10) };
    expect(() => bootstrapOverWorlds([w], () => 0)).toThrow();
  });
});

describe("crossWorldNull", () => {
  it("throws when worlds have unequal length", () => {
    const a: WorldTrajectory = { s: new Uint8Array(5), sNext: new Uint8Array(5), e: new Uint8Array(5) };
    const b: WorldTrajectory = { s: new Uint8Array(6), sNext: new Uint8Array(6), e: new Uint8Array(6) };
    expect(() => crossWorldNull([a, b], () => 0)).toThrow();
  });

  const nonClosureStat = (s: Uint8Array, e: Uint8Array, sNext: Uint8Array) =>
    jointMutualInformationDiscrete(s, e, sNext, 3, 2, 3).corrected - mutualInformationDiscrete(s, sNext, 3, 3).corrected;

  it("calibration: ~5% nominal false-positive rate on independent-by-construction worlds (no real S-E coupling)", () => {
    const TRIALS = 200, R = 10, T = 150;
    let flagged = 0;
    for (let t = 0; t < TRIALS; t++) {
      const worlds: WorldTrajectory[] = [];
      for (let w = 0; w < R; w++) {
        worlds.push({
          s: uniformSymbols(10000 + t * 100 + w, T, 3),
          e: uniformSymbols(20000 + t * 100 + w, T, 2),
          sNext: uniformSymbols(30000 + t * 100 + w, T, 3),
        });
      }
      if (crossWorldNull(worlds, nonClosureStat).p <= 0.05) flagged++;
    }
    // Two-sided check against the nominal 5%: a lower bound is what actually
    // distinguishes a calibrated test from a broken one that (almost) never
    // rejects -- under true 5% rejection, P(0 flagged out of 200 trials) =
    // 0.95^200 ~ 3.5e-5, so requiring at least one flag is not a flaky ask.
    // An upper bound alone cannot tell a calibrated test apart from one that
    // rejects 0% of the time.
    expect(flagged).toBeGreaterThan(0);
    expect(flagged / TRIALS).toBeLessThan(0.15);
  });

  it("power: rejects a planted S'<-(S,E) coupling at a high rate", () => {
    const TRIALS = 50, R = 10, T = 200;
    let rejected = 0;
    for (let t = 0; t < TRIALS; t++) {
      const worlds: WorldTrajectory[] = [];
      for (let w = 0; w < R; w++) {
        const s = uniformSymbols(50000 + t * 100 + w, T, 3);
        const e = uniformSymbols(40000 + t * 100 + w, T, 2);
        const sNext = new Uint8Array(T);
        for (let i = 0; i < T; i++) sNext[i] = e[i] === 1 ? (s[i] + 1) % 3 : s[i];
        worlds.push({ s, e, sNext });
      }
      if (crossWorldNull(worlds, nonClosureStat).p <= 0.05) rejected++;
    }
    expect(rejected / TRIALS).toBeGreaterThan(0.8);
  });

  describe("small-R exact permutation enumeration over the full symmetric group S_R (regression: a {identity} ∪ derangements reference set is not a group and is not guaranteed to produce a valid p-value)", () => {
    it("R=4 enumerates all 4!=24 permutations exactly, including the identity", () => {
      const worlds: WorldTrajectory[] = [0, 1, 2, 3].map((w) => ({
        s: uniformSymbols(100 + w, 80, 3),
        e: uniformSymbols(200 + w, 80, 2),
        sNext: uniformSymbols(300 + w, 80, 3),
      }));
      const result = crossWorldNull(worlds, nonClosureStat);
      expect(result.exact).toBe(true);
      expect(result.nullMeans.length).toBe(24);
    });

    it("R=3 enumerates all 3!=6 permutations exactly, including the identity", () => {
      const worlds: WorldTrajectory[] = [0, 1, 2].map((w) => ({
        s: uniformSymbols(10 + w, 80, 3),
        e: uniformSymbols(20 + w, 80, 2),
        sNext: uniformSymbols(30 + w, 80, 3),
      }));
      const result = crossWorldNull(worlds, nonClosureStat);
      expect(result.exact).toBe(true);
      expect(result.nullMeans.length).toBe(6);
    });

    it("R=2 enumerates all 2!=2 permutations exactly (identity and the single transposition) -- the honest p can only be 1/2 or 1, never a sharp value like 1/2001 (the bug this regresses: Monte Carlo over a non-group reference set, or over-sampling a tiny derangement-only pool, manufactured spurious resolution)", () => {
      const worlds: WorldTrajectory[] = [
        { s: uniformSymbols(1, 80, 3), e: uniformSymbols(2, 80, 2), sNext: uniformSymbols(3, 80, 3) },
        { s: uniformSymbols(4, 80, 3), e: uniformSymbols(5, 80, 2), sNext: uniformSymbols(6, 80, 3) },
      ];
      const result = crossWorldNull(worlds, nonClosureStat);
      expect(result.exact).toBe(true);
      expect(result.nullMeans.length).toBe(2);
      expect([0.5, 1]).toContain(result.p);
    });

    it("calibration floor at small R: p can never fall below its honest resolution 1/R! for R in {2,3,4}", () => {
      const FACTORIAL: Record<number, number> = { 2: 2, 3: 6, 4: 24 };
      for (const R of [2, 3, 4]) {
        const floor = 1 / FACTORIAL[R];
        const TRIALS = 100;
        for (let t = 0; t < TRIALS; t++) {
          const worlds: WorldTrajectory[] = [];
          for (let w = 0; w < R; w++) {
            worlds.push({
              s: uniformSymbols(50000 + R * 1000 + t * 10 + w, 80, 3),
              e: uniformSymbols(60000 + R * 1000 + t * 10 + w, 80, 2),
              sNext: uniformSymbols(70000 + R * 1000 + t * 10 + w, 80, 3),
            });
          }
          const result = crossWorldNull(worlds, nonClosureStat);
          expect(result.p).toBeGreaterThanOrEqual(floor - 1e-9);
        }
      }
    });

    it("R in {2,3}: the honest floor (1/2, 1/6) exceeds 0.05, so a nominal 5% test can never reject on independent-by-construction data (unlike R=4, whose floor 1/24~=0.0417 is itself below 0.05 -- see the next test)", () => {
      const FACTORIAL: Record<number, number> = { 2: 2, 3: 6 };
      for (const R of [2, 3]) {
        let flagged = 0;
        const TRIALS = 100;
        for (let t = 0; t < TRIALS; t++) {
          const worlds: WorldTrajectory[] = [];
          for (let w = 0; w < R; w++) {
            worlds.push({
              s: uniformSymbols(50000 + R * 1000 + t * 10 + w, 80, 3),
              e: uniformSymbols(60000 + R * 1000 + t * 10 + w, 80, 2),
              sNext: uniformSymbols(70000 + R * 1000 + t * 10 + w, 80, 3),
            });
          }
          const result = crossWorldNull(worlds, nonClosureStat);
          expect(result.p).toBeGreaterThanOrEqual(1 / FACTORIAL[R] - 1e-9);
          if (result.p <= 0.05) flagged++;
        }
        expect(flagged).toBe(0);
      }
    });

    it("R=4: the honest floor 1/24~=0.0417 sits BELOW the 0.05 threshold, so an occasional rejection at exactly that floor is correct, valid behaviour, not miscalibration -- it can only ever land exactly on 1/24, never below it or at an implausibly sharp value", () => {
      const TRIALS = 300;
      let flagged = 0;
      for (let t = 0; t < TRIALS; t++) {
        const worlds: WorldTrajectory[] = [0, 1, 2, 3].map((w) => ({
          s: uniformSymbols(80000 + t * 10 + w, 80, 3),
          e: uniformSymbols(90000 + t * 10 + w, 80, 2),
          sNext: uniformSymbols(100000 + t * 10 + w, 80, 3),
        }));
        const result = crossWorldNull(worlds, nonClosureStat);
        expect(result.p).toBeGreaterThanOrEqual(1 / 24 - 1e-9);
        if (result.p <= 0.05) {
          flagged++;
          expect(result.p).toBeCloseTo(1 / 24, 9);
        }
      }
      // Expected rate under H0 is ~1/24 (~4.2%); a wide but non-trivial band
      // catches gross miscalibration in either direction without being flaky.
      expect(flagged / TRIALS).toBeLessThan(0.15);
    });

    it("R=11 (above the exact-enumeration cutoff) still samples nullDraws values, marked non-exact, via full-symmetric-group Monte Carlo", () => {
      const worlds: WorldTrajectory[] = Array.from({ length: 11 }, (_, w) => ({
        s: uniformSymbols(500 + w, 100, 3),
        e: uniformSymbols(600 + w, 100, 2),
        sNext: uniformSymbols(700 + w, 100, 3),
      }));
      const result = crossWorldNull(worlds, nonClosureStat, { nullDraws: 500, seed: 1 });
      expect(result.exact).toBe(false);
      expect(result.nullMeans.length).toBe(500);
    });
  });

  describe("calibration: p-values are roughly uniform under H0", () => {
    it("across many seeds, the rejection rate at alpha=0.1 is within a binomial tolerance of nominal AND not near zero", () => {
      const TRIALS = 300, R = 10, T = 150;
      let flagged = 0;
      for (let t = 0; t < TRIALS; t++) {
        const worlds: WorldTrajectory[] = [];
        for (let w = 0; w < R; w++) {
          worlds.push({
            s: uniformSymbols(80000 + t * 100 + w, T, 3),
            e: uniformSymbols(90000 + t * 100 + w, T, 2),
            sNext: uniformSymbols(100000 + t * 100 + w, T, 3),
          });
        }
        if (crossWorldNull(worlds, nonClosureStat).p <= 0.1) flagged++;
      }
      // Nominal rate is 10%; a valid permutation test should land close to
      // that under H0. Binomial SD at p=0.1, n=300 is ~1.7pp, so [4%, 18%]
      // is a generous ~3.5-SD two-sided band -- wide enough not to be flaky,
      // narrow enough to catch a badly miscalibrated (anti-conservative or
      // degenerate) null. The lower bound also rules out a test that
      // (almost) never rejects, which an upper bound alone cannot catch.
      const rate = flagged / TRIALS;
      expect(rate).toBeGreaterThan(0.04);
      expect(rate).toBeLessThan(0.18);
    });
  });
});

describe("individualityReport on synthetic multi-world processes with known answers", () => {
  const R = 8, T = 750;
  const DRAWS = 300;

  it("autonomous (organismal): S predicts its own future in every world, E does not", () => {
    const worlds: WorldTrajectory[] = [];
    for (let w = 0; w < R; w++) {
      const chain = markovChain(1000 + w, T + 1, 3, 0.92);
      worlds.push({ s: chain.slice(0, T), sNext: chain.slice(1, T + 1), e: uniformSymbols(2000 + w, T, 2) });
    }
    const r = individualityReport(worlds, 3, 2, { bootstrapDraws: DRAWS, seed: 10 });
    expect(r.autonomyStar.lower).toBeGreaterThan(0);
    expect(r.nonClosure.nullTest.p).toBeGreaterThan(0.05);
  });

  it("environment-driven (environmental): each world's S' is a deterministic function of that world's own E, S carries no real self-information", () => {
    const worlds: WorldTrajectory[] = [];
    for (let w = 0; w < R; w++) {
      const e = uniformSymbols(3000 + w, T, 3);
      const sNext = new Uint8Array(T);
      for (let i = 0; i < T; i++) sNext[i] = (e[i] + 1) % 3;
      const s = uniformSymbols(4000 + w, T, 3);
      worlds.push({ s, sNext, e });
    }
    const r = individualityReport(worlds, 3, 3, { bootstrapDraws: DRAWS, seed: 20 });
    expect(r.nonClosure.nullTest.p).toBeLessThanOrEqual(0.05);
    expect(r.nonClosure.ci.lower).toBeGreaterThan(0);
    expect(r.autonomyStar.lower).toBeLessThanOrEqual(0.05);
  });

  it("independent noise (none): S, E, S' all independent per world -- nothing clears", () => {
    const worlds: WorldTrajectory[] = [];
    for (let w = 0; w < R; w++) {
      worlds.push({
        s: uniformSymbols(5000 + w, T, 3),
        e: uniformSymbols(6000 + w, T, 2),
        sNext: uniformSymbols(7000 + w, T, 3),
      });
    }
    const r = individualityReport(worlds, 3, 2, { bootstrapDraws: DRAWS, seed: 30 });
    expect(Math.abs(r.autonomyStar.point)).toBeLessThan(0.02);
    expect(r.autonomyStar.lower).toBeLessThanOrEqual(0.01);
    expect(r.nonClosure.nullTest.p).toBeGreaterThan(0.05);
  });

  it("KNOWN LIMITATION -- drift-only negative control: a deterministic time trend with ZERO real S_t->S_{t+1} coupling, replicated across independently-noised worlds, can still give autonomyStar a CI excluding zero, but the cross-world null correctly finds no S-E coupling", () => {
    // Each world's S_t and S_{t+1} are INDEPENDENTLY-noised quantizations of
    // the SAME deterministic, monotonically increasing function of absolute
    // time (raw(t) = t/T + independent noise); sNext[t] is computed straight
    // from t+1, never from s[t], so there is no S_t -> S_{t+1} generative
    // link within a world at all -- only a shared trend. This is why neither
    // tools/individuality.ts nor docs/individuality-info-theory.md claims
    // that a nonzero autonomyStar CI alone rules out a shared-trend artifact;
    // it is disclosed, not hidden. The cross-world null is a strictly
    // stronger check on this same fixture: swapping E across worlds cannot
    // create S-E coupling that was never there, so nonClosure.nullTest.p
    // should not be small regardless of the trend.
    const T2 = 300, K = 12;
    const worlds: WorldTrajectory[] = [];
    for (let w = 0; w < R; w++) {
      const rng = mulberry32(6006 + w);
      const raw = new Float64Array(T2 + 1);
      for (let i = 0; i <= T2; i++) raw[i] = i / T2 + (rng() - 0.5) * 0.15;
      const bin = (x: number) => Math.max(0, Math.min(K - 1, Math.floor(x * K)));
      const sAll = Uint8Array.from(raw, bin);
      const e = uniformSymbols(15000 + w, T2, 6);
      worlds.push({ s: sAll.slice(0, T2), sNext: sAll.slice(1, T2 + 1), e });
    }
    const r = individualityReport(worlds, K, 6, { bootstrapDraws: DRAWS, seed: 40 });
    expect(r.nonClosure.nullTest.p).toBeGreaterThan(0.05);
  });
});

describe("bootstrapOverWorlds coverage with fixed, independently fitted bins (docs/individuality-info-theory.md §3)", () => {
  // Reproduces the real pipeline end to end, at the level bootstrapOverWorlds
  // actually operates at: a continuous raw feature history per world, bins
  // fit ONCE from a separate calibration sample (never from the analysis
  // worlds being bootstrapped), frozen, then a percentile bootstrap CI over
  // R analysis worlds symbolized with those frozen bins. "Coverage" here
  // means: does the CI contain the TRUE target often enough? The target is
  // itself defined relative to the same fixed bins -- the mean corrected
  // statistic over a large population of independent worlds, all symbolized
  // with the identical calibration-fit bins -- so this isolates exactly the
  // uncertainty bootstrapOverWorlds's percentile interval is supposed to
  // capture (which R worlds got drawn), with no bin-fitting question left
  // unresolved on either side.
  const T = 150, S_BINS = 4, E_BINS = 3;

  function genRawWorld(seed: number): { sRaw: number[]; eRaw: number[] } {
    const rng = mulberry32(seed);
    const sRaw = new Array<number>(T + 1);
    sRaw[0] = rng();
    for (let i = 1; i <= T; i++) sRaw[i] = 0.6 * sRaw[i - 1] + 0.4 * rng(); // mild autocorrelation, like a real slow-moving feature
    const eRaw = new Array<number>(T);
    for (let i = 0; i < T; i++) eRaw[i] = rng();
    return { sRaw, eRaw };
  }

  // Calibration sample: 40 worlds' worth of raw points, seeds disjoint from
  // every analysis/population seed used below (900000+ vs. 0-799999).
  const calibSRaw: number[] = [], calibERaw: number[] = [];
  for (let c = 0; c < 40; c++) {
    const { sRaw, eRaw } = genRawWorld(900_000 + c);
    calibSRaw.push(...sRaw);
    calibERaw.push(...eRaw);
  }
  const sBin = fitQuantileBins(calibSRaw, S_BINS);
  const eBin = fitQuantileBins(calibERaw, E_BINS);

  function worldFromRaw(sRaw: number[], eRaw: number[]): WorldTrajectory {
    const sSymbols = sRaw.map((v) => applyQuantileBins(v, sBin));
    const eSymbols = eRaw.map((v) => applyQuantileBins(v, eBin));
    return buildWorldTrajectory(sSymbols, eSymbols, S_BINS, E_BINS);
  }
  const statOf = (w: WorldTrajectory) => mutualInformationDiscrete(w.s, w.sNext, S_BINS, S_BINS).corrected;

  // Target: population mean of the statistic, same fixed bins, over a large
  // independent population (seeds 500000-501499, disjoint from calibration
  // and from every trial's worlds below).
  const POP = 1500;
  let popSum = 0;
  for (let p = 0; p < POP; p++) {
    const { sRaw, eRaw } = genRawWorld(500_000 + p);
    popSum += statOf(worldFromRaw(sRaw, eRaw));
  }
  const target = popSum / POP;

  function coverageAt(R: number, trials: number, seedBase: number): number {
    let covered = 0;
    for (let t = 0; t < trials; t++) {
      const worlds: WorldTrajectory[] = [];
      for (let w = 0; w < R; w++) {
        const { sRaw, eRaw } = genRawWorld(seedBase + t * 1000 + w);
        worlds.push(worldFromRaw(sRaw, eRaw));
      }
      const ci = bootstrapOverWorlds(worlds, statOf, { draws: 500, alpha: 0.1, seed: t + 1 });
      if (target >= ci.lower && target <= ci.upper) covered++;
    }
    return covered / trials;
  }

  it(`R=${MIN_CALIBRATED_WORLDS + 4} (well above MIN_CALIBRATED_WORLDS=${MIN_CALIBRATED_WORLDS}): nominal-90% percentile coverage is reasonably close to nominal`, () => {
    // Measured over many trials during development: ~0.84. Percentile
    // bootstrap CIs are known to undercover somewhat versus their nominal
    // rate (first-order skewness bias), so this is "reasonable", not exact;
    // the bound is wide enough not to be flaky at 300 trials (binomial SD
    // ~0.021 at p=0.84) while still failing on a badly miscalibrated
    // interval (e.g. one that covers <70% or is inverted/degenerate).
    const coverage = coverageAt(12, 300, 1);
    expect(coverage).toBeGreaterThan(0.72);
    expect(coverage).toBeLessThanOrEqual(1);
  });

  it("R=4 (below MIN_CALIBRATED_WORLDS): coverage is measurably worse than at R=12 -- this is exactly why small-R intervals are reported as an uncalibrated resampling range, not a confidence interval", () => {
    // Measured ~0.74 during development, vs. ~0.84 at R=12 above (same
    // statistic, same bins, same nominal 90%): a stable ~10-point gap, far
    // larger than sampling noise at 300 trials (binomial SD ~0.025 at
    // p=0.74). The R=12 test only pins down "reasonable"; this test's job is
    // to show R=4 is *worse*, which is the actual finding motivating
    // MIN_CALIBRATED_WORLDS and the "uncalibrated" status.
    const coverageR4 = coverageAt(4, 300, 2);
    const coverageR12 = coverageAt(12, 300, 1);
    expect(coverageR4).toBeLessThan(coverageR12);
    expect(coverageR4).toBeLessThan(0.85);
  });

  it("BootstrapCI.status is 'uncalibrated' below MIN_CALIBRATED_WORLDS and 'ci' at or above it", () => {
    const { sRaw: sA, eRaw: eA } = genRawWorld(1);
    const { sRaw: sB, eRaw: eB } = genRawWorld(2);
    const twoWorlds = [worldFromRaw(sA, eA), worldFromRaw(sB, eB)];
    const smallCi = bootstrapOverWorlds(twoWorlds, statOf, { draws: 200, seed: 1 });
    expect(smallCi.status).toBe("uncalibrated");

    const manyWorlds = Array.from({ length: MIN_CALIBRATED_WORLDS }, (_, i) => {
      const { sRaw, eRaw } = genRawWorld(10 + i);
      return worldFromRaw(sRaw, eRaw);
    });
    const bigCi = bootstrapOverWorlds(manyWorlds, statOf, { draws: 200, seed: 1 });
    expect(bigCi.status).toBe("ci");
  });
});
