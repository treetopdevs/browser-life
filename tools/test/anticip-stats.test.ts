import { describe, expect, it } from "vitest";
import { anticipationIndex, bootstrapMeanCI, logCost, medianOf, onesidedWilcoxonNegative, pairSeedCosts, type SeedCost } from "../lib/anticip-stats.ts";

describe("logCost", () => {
  it("ordinary case: log(respSwitch / respContinue)", () => {
    expect(logCost(100, 150)).toEqual({ cost: Math.log(1.5), collapsed: false });
  });

  it("collapses when respContinue <= 0, respSwitch <= 0, or both", () => {
    expect(logCost(0, 150)).toEqual({ cost: null, collapsed: true });
    expect(logCost(-5, 150)).toEqual({ cost: null, collapsed: true });
    expect(logCost(100, 0)).toEqual({ cost: null, collapsed: true });
    expect(logCost(100, -1)).toEqual({ cost: null, collapsed: true });
    expect(logCost(0, 0)).toEqual({ cost: null, collapsed: true });
  });
});

describe("pairSeedCosts", () => {
  it("pairs matching seed sets and sorts by seed regardless of Map insertion order", () => {
    const evolved = new Map([[3, -0.1], [1, -0.2], [2, -0.3]]);
    const founder = new Map([[1, 0.05], [2, 0.02], [3, 0.01]]);
    expect(pairSeedCosts(evolved, founder)).toEqual([
      { seed: 1, costEvolved: -0.2, costFounder: 0.05 },
      { seed: 2, costEvolved: -0.3, costFounder: 0.02 },
      { seed: 3, costEvolved: -0.1, costFounder: 0.01 },
    ]);
  });

  it("throws when the two seed sets differ, naming both seed lists", () => {
    const evolved = new Map([[1, 0], [2, 0]]);
    const founder = new Map([[1, 0], [3, 0]]);
    expect(() => pairSeedCosts(evolved, founder)).toThrow(/evolved=\[1,2\].*founder=\[1,3\]/);
  });

  it("throws when the seed sets differ only in size", () => {
    const evolved = new Map([[1, 0], [2, 0], [3, 0]]);
    const founder = new Map([[1, 0], [2, 0]]);
    expect(() => pairSeedCosts(evolved, founder)).toThrow();
  });
});

describe("anticipationIndex", () => {
  it("is costEvolved - costFounder", () => {
    expect(anticipationIndex({ seed: 1, costEvolved: -0.5, costFounder: 0.2 })).toBeCloseTo(-0.7, 10);
  });
});

describe("onesidedWilcoxonNegative", () => {
  it("hand-checked n=6 all-negative case matches exact combinatorics (1/2^6)", () => {
    const p = onesidedWilcoxonNegative([-1, -2, -3, -4, -5, -6]);
    expect(p).toBeCloseTo(1 / 64, 10);
  });

  it("returns 1 for an all-zero (fully reactive) sample", () => {
    expect(onesidedWilcoxonNegative([0, 0, 0, 0])).toBe(1);
  });
});

describe("medianOf", () => {
  it("odd-length sample: the middle value once sorted", () => {
    expect(medianOf([3, -1, 2])).toBe(2);
  });

  it("even-length sample: the average of the two middle values", () => {
    expect(medianOf([1, 2, 3, 4])).toBeCloseTo(2.5, 10);
  });

  it("empty input returns null (no data), not NaN or a thrown error", () => {
    expect(medianOf([])).toBeNull();
  });
});

describe("estimand mismatch: Wilcoxon's symmetric-location test is not a test of the mean", () => {
  // The counterexample from the review: a zero-mean population with index -1
  // with probability 20/21 and +20 otherwise. Represented exactly as one
  // full cycle of that ratio (20 seed-worlds at -1, 1 at +20), the
  // population/sample mean is exactly 0 -- but the distribution is sharply
  // asymmetric (median -1, mean 0), which is exactly what Wilcoxon's
  // symmetric-location assumption rules out.
  const population = [...Array(20).fill(-1), 20];

  it("mean-vs-median divergence: the median is the majority value (-1) while the mean is exactly 0", () => {
    expect(medianOf(population)).toBe(-1);
    expect(population.reduce((a, b) => a + b, 0) / population.length).toBe(0);
  });

  it("with the rare tail present in the sample, the bootstrap CI of the mean includes 0", () => {
    const ci = bootstrapMeanCI(population, 2000, 1);
    expect(ci.mean).toBe(0);
    expect(ci.status).toBe("ok");
    expect(ci.lo).toBeLessThanOrEqual(0);
    expect(ci.hi).toBeGreaterThanOrEqual(0);
  });

  it("8 draws that miss the tail (probability (20/21)^8 ~ 0.68) mislead both methods: Wilcoxon p ~ 0.0039 and a bootstrap CI of [-1, -1]", () => {
    const eightAllNegativeDraws = Array(8).fill(-1);
    expect(onesidedWilcoxonNegative(eightAllNegativeDraws)).toBeCloseTo(1 / 256, 10);
    const ci = bootstrapMeanCI(eightAllNegativeDraws, 2000, 1, 0.025);
    expect(ci.status).toBe("ok");
    expect([ci.lo, ci.hi]).toEqual([-1, -1]);
  });
});

// Fixed, non-random noise -- deliberately not Math.random, so the fixture is
// reproducible across runs.
const NOISE = [0.1, -0.2, 0.05, 0.3, -0.1, 0.15, 0.2, -0.05, 0.25, -0.15, 0.1, 0.0];
const SYMMETRIC_NOISE = [0.1, -0.1, 0.2, -0.2, 0.05, -0.05, 0.15, -0.15, 0.3, -0.3, 0.02, -0.02];

function seedCosts(evolvedCosts: number[], founderCosts: number[]): SeedCost[] {
  return evolvedCosts.map((costEvolved, i) => ({ seed: i, costEvolved, costFounder: founderCosts[i] }));
}

describe("planted anticipator (evolved pays a reliably larger cost)", () => {
  const sc = seedCosts(NOISE.map((v) => v - 0.4), NOISE);
  const indices = sc.map(anticipationIndex);

  it("is detected: small one-sided p-value and a CI excluding 0", () => {
    expect(onesidedWilcoxonNegative(indices)).toBeLessThan(0.01);
    expect(bootstrapMeanCI(indices, 2000, 1).hi).toBeLessThan(0);
  });
});

describe("reactive-only fixture (equal costs in both arms)", () => {
  const sc = seedCosts(NOISE, NOISE);
  const indices = sc.map(anticipationIndex);

  it("every index is exactly 0", () => {
    for (const idx of indices) expect(idx).toBe(0);
  });

  it("is not detected: wilcoxonSignedRank's degenerate all-zero result (p=1)", () => {
    expect(onesidedWilcoxonNegative(indices)).toBe(1);
  });

  it("the bootstrap CI is degenerate at 0", () => {
    const ci = bootstrapMeanCI(indices, 2000, 1);
    expect(ci.lo).toBeLessThanOrEqual(0);
    expect(ci.hi).toBeGreaterThanOrEqual(0);
  });
});

describe("noisy anticipator (real effect plus non-degenerate per-seed noise)", () => {
  // Unlike the planted-anticipator fixture above, the per-seed noise does
  // *not* cancel in the subtraction here: costEvolved carries its own,
  // independent noise draw, so the index varies seed to seed around -0.4
  // instead of being a constant. This exercises onesidedWilcoxonNegative/
  // bootstrapMeanCI on a genuinely non-degenerate, non-constant sample with a
  // real but imperfect signal -- the case closest to real experimental data.
  const sc = seedCosts(
    NOISE.map((v, i) => v - 0.4 + SYMMETRIC_NOISE[i]),
    NOISE,
  );
  const indices = sc.map(anticipationIndex);

  it("indices are non-constant", () => {
    expect(new Set(indices).size).toBeGreaterThan(1);
  });

  it("is still detected: small one-sided p-value and a CI excluding 0", () => {
    expect(onesidedWilcoxonNegative(indices)).toBeLessThan(0.05);
    const ci = bootstrapMeanCI(indices, 2000, 1);
    expect(ci.status).toBe("ok");
    expect(ci.hi).toBeLessThan(0);
  });
});

describe("noisy-but-null fixture (symmetric per-seed noise, no systematic shift)", () => {
  const sc = seedCosts(NOISE.map((v, i) => v + SYMMETRIC_NOISE[i]), NOISE);
  const indices = sc.map(anticipationIndex); // === SYMMETRIC_NOISE

  it("the CI still contains 0 and the p-value is not small", () => {
    const ci = bootstrapMeanCI(indices, 2000, 3);
    expect(ci.lo).toBeLessThanOrEqual(0);
    expect(ci.hi).toBeGreaterThanOrEqual(0);
    expect(onesidedWilcoxonNegative(indices)).toBeGreaterThan(0.2);
  });
});

describe("bootstrapMeanCI", () => {
  it("is deterministic: identical seed -> identical {lo, hi, mean} across two calls", () => {
    const indices = [-0.3, 0.1, -0.2, 0.4, -0.5, 0.05];
    const a = bootstrapMeanCI(indices, 500, 7);
    const b = bootstrapMeanCI(indices, 500, 7);
    expect(b).toEqual(a);
  });

  it("n=1 reports insufficient-replication with null bounds, not a zero-width CI -- but the point estimate (mean/meanIndex) is still present", () => {
    const ci = bootstrapMeanCI([-0.42], 500, 1);
    expect(ci).toEqual({ lo: null, hi: null, mean: -0.42, status: "insufficient-replication" });
  });

  it("n=0 reports insufficient-replication with a NaN mean, without throwing", () => {
    const ci = bootstrapMeanCI([], 500, 1);
    expect(ci.mean).toBeNaN();
    expect(ci.status).toBe("insufficient-replication");
    expect(ci.lo).toBeNull();
    expect(ci.hi).toBeNull();
  });

  it("n=2 is enough replication to produce a real CI", () => {
    const ci = bootstrapMeanCI([-0.3, 0.1], 500, 1);
    expect(ci.status).toBe("ok");
    expect(ci.lo).not.toBeNull();
    expect(ci.hi).not.toBeNull();
  });

  it("reps=1 reports insufficient-reps with null bounds, not a spuriously narrow CI -- but the point estimate (mean/meanIndex) is still present", () => {
    // A single resample of a sample whose true mean is 0 would otherwise
    // report a one-point "CI" that excludes 0 purely by which resample was
    // drawn -- e.g. [-1, 1] with reps=1 can land entirely on -1.
    const ci = bootstrapMeanCI([-1, 1], 1, 2);
    expect(ci).toEqual({ lo: null, hi: null, mean: 0, status: "insufficient-reps" });
  });

  it("reps below the floor reports insufficient-reps even with plenty of seed-worlds", () => {
    const ci = bootstrapMeanCI([-0.3, 0.1, -0.2, 0.4, -0.5, 0.05, -0.1, 0.2], 50, 1);
    expect(ci.status).toBe("insufficient-reps");
    expect(ci.lo).toBeNull();
    expect(ci.hi).toBeNull();
  });
});
