// Scoring, with hand-computed expectations (PLAN.md, section 8).
import { describe, expect, it } from "vitest";
import type { Direction3 } from "../lib/prediction/envelope.ts";
import { MIN_FAMILIES_FOR_INTERVALS, brierOf, costPerUseful, familyBootstrap, familyMeans, matchedCoverageSet, reliabilityTable, scoreProposer, signAgreement, type ScoredCase } from "../lib/prediction/score.ts";
import type { Prediction, Probs } from "../lib/prediction/validate.ts";

const pred = (probs: Probs): Prediction => ({ version: 1, caseId: "x", envelopeHash: "h", task: {} as never, probs, abstain: false });
const mk = (i: number, outcome: Direction3, probs: Probs | null, status: ScoredCase["status"] = probs ? "answered" : "abstained", family = `f${i % 3}`): ScoredCase => ({ caseId: `c${i}`, familyId: family, outcome, prediction: probs ? pred(probs) : null, status });
const PRIOR: Probs = { up: 200, down: 300, none: 500 };

describe("multiclass Brier", () => {
  it("uniform = 2/3, perfect = 0, confidently wrong = 2", () => {
    expect(brierOf({ up: 333, down: 333, none: 334 }, "up")).toBeCloseTo(2 / 3, 2);
    expect(brierOf({ up: 1000, down: 0, none: 0 }, "up")).toBe(0);
    expect(brierOf({ up: 0, down: 1000, none: 0 }, "up")).toBe(2);
  });
  it("matches a hand-computed 6-case table", () => {
    // per case: sum (p - o)^2
    const table: [Direction3, Probs][] = [
      ["up", { up: 600, down: 200, none: 200 }], // .16+.04+.04 = .24
      ["down", { up: 100, down: 700, none: 200 }], // .01+.09+.04 = .14
      ["none", { up: 0, down: 0, none: 1000 }], // 0
      ["none", { up: 500, down: 0, none: 500 }], // .25+0+.25 = .5
      ["up", { up: 0, down: 500, none: 500 }], // 1+.25+.25 = 1.5
      ["down", { up: 300, down: 300, none: 400 }], // .09+.49+.16 = .74
    ];
    const cs = table.map(([o, p], i) => mk(i, o, p));
    const s = scoreProposer("t", cs, PRIOR);
    expect(s.brierImputed).toBeCloseTo((0.24 + 0.14 + 0 + 0.5 + 1.5 + 0.74) / 6, 10);
    expect(s.brierAnswered).toBeCloseTo(s.brierImputed!, 10);
    // argmax with ties none > down > up: up (hit), down (hit), none (hit), none (tie none/up, hit), none (tie down/none, outcome up: miss), none (outcome down: miss)
    expect(s.directionalAccuracy).toBeCloseTo(4 / 6, 10);
  });
  it("scores a majority-class forecast on an imbalanced set as computed", () => {
    const cs = [...Array(9)].map((_, i) => mk(i, "none", { up: 0, down: 0, none: 1000 })).concat([mk(9, "up", { up: 0, down: 0, none: 1000 })]);
    const s = scoreProposer("alwaysNone", cs, PRIOR);
    expect(s.brierImputed).toBeCloseTo((9 * 0 + 2) / 10, 10);
    expect(s.directionalAccuracy).toBe(0.9);
    // balanced accuracy exposes it: recall(none) = 1, recall(up) = 0, two classes present.
    expect(s.balancedAccuracy).toBe(0.5);
    expect(s.balancedClasses).toBe(2);
  });
});

describe("abstention, invalid and missing", () => {
  it("are imputed with the dev prior, so abstaining cannot beat the prior", () => {
    const outcomes: Direction3[] = ["none", "none", "down", "up", "none", "down"];
    const prior = outcomes.map((o, i) => mk(i, o, PRIOR));
    const abst = outcomes.map((o, i) => mk(i, o, null, "abstained"));
    const inv = outcomes.map((o, i) => mk(i, o, null, "invalid"));
    const sp = scoreProposer("prior", prior, PRIOR), sa = scoreProposer("abstain", abst, PRIOR), si = scoreProposer("inv", inv, PRIOR);
    expect(sa.brierImputed).toBeCloseTo(sp.brierImputed!, 12);
    expect(si.brierImputed).toBeCloseTo(sp.brierImputed!, 12);
    expect(sa.coverage).toBe(0);
    expect(sa.abstentionRate).toBe(1);
    expect(si.invalid).toBe(6);
    expect(sa.brierAnswered).toBeNull();
    expect(sa.directionalAccuracy).toBeNull();
  });
  it("matched coverage restricts to the cases every comparator answered", () => {
    const full = [mk(0, "up", { up: 1000, down: 0, none: 0 }), mk(1, "down", { up: 1000, down: 0, none: 0 }), mk(2, "none", { up: 0, down: 0, none: 1000 })];
    const part = [mk(0, "up", { up: 1000, down: 0, none: 0 }), mk(1, "down", null, "abstained"), mk(2, "none", null, "abstained")];
    const set = matchedCoverageSet({ full, part });
    expect([...set]).toEqual(["c0"]);
    expect(scoreProposer("full", full, PRIOR, set).directionalAccuracy).toBe(1);
    expect(scoreProposer("full", full, PRIOR).directionalAccuracy).toBeCloseTo(2 / 3, 10);
  });
});

describe("reliability, cost, stability, intervals", () => {
  it("bins sum to the answered count", () => {
    const cs = [mk(0, "up", { up: 900, down: 50, none: 50 }), mk(1, "none", { up: 340, down: 330, none: 330 }), mk(2, "up", null, "abstained"), mk(3, "down", { up: 100, down: 600, none: 300 })];
    const r = reliabilityTable(cs);
    expect(r.reduce((s, b) => s + b.n, 0)).toBe(3);
    expect(r).toHaveLength(5);
  });
  it("costPerUseful is null when no case is non-null, else cell-steps over non-null cases", () => {
    expect(costPerUseful(1000, ["none", "none"])).toBeNull();
    expect(costPerUseful(1000, ["up", "none", "down", "none"])).toBe(500);
  });
  it("signAgreement counts matching labels", () => {
    expect(signAgreement(["up", "none", "down"], ["up", "down", "down"])).toEqual({ n: 3, agree: 2, rate: 2 / 3 });
    expect(signAgreement([], []).rate).toBeNull();
  });
  it("the bootstrap resamples families, and is skipped below the family minimum", () => {
    const rows = (k: number) => Array.from({ length: k * 2 }, (_, i) => ({ familyId: `f${i % k}`, v: i % k }));
    expect(familyBootstrap(familyMeans(rows(MIN_FAMILIES_FOR_INTERVALS - 1)), 200, 1)).toBeNull();
    const iv = familyBootstrap(familyMeans(rows(12)), 500, 1)!;
    expect(iv.mean).toBeCloseTo(5.5, 10);
    expect(iv.lo).toBeLessThan(iv.mean);
    expect(iv.hi).toBeGreaterThan(iv.mean);
    expect(familyBootstrap(familyMeans(rows(12)), 500, 1)).toEqual(iv);
  });
});
