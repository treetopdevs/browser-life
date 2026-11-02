import { describe, expect, it } from "vitest";
import { bootstrapLowerBound2, decideSchedule, medianTimes2, signP, verdictOf, type BlockNumbers } from "../src/movinglight/decision.ts";
import { PLANTED_FLOORS, plantedTable } from "../src/movinglight/fixtures.ts";

const F = PLANTED_FLOORS;
const FS = { fixed: F, paused: F, reversed: F, wandering: F };
const arm = (g: number, d: number, covG = 0, covD = 0, sg = 600_000, sd = 600_000) => ({ grouped: { capturePpm: g, survivalPpm: sg, cov: covG }, dispersed: { capturePpm: d, survivalPpm: sd, cov: covD } });
const block = (o: Partial<Record<string, ReturnType<typeof arm>>> = {}): BlockNumbers => ({ sense: arm(300_000, 300_000), "sense-nosig": arm(300_000, 300_000), "sense-nomot": arm(300_000, 300_000), drift: arm(300_000, 300_000), still: arm(300_000, 300_000), ...o });
const eight = (f: (i: number) => BlockNumbers) => Array.from({ length: 8 }, (_, i) => f(i));
const benefit = (i: number) => block({ sense: arm(700_000 + i, 300_000, 9000, 0) });

describe("movinglight decision", () => {
  it("needs raw S, B, sign test, delta floor, bootstrap bound, residual, survival and B_drift all together", () => {
    const ok = decideSchedule(eight(benefit), F, true);
    expect(ok.criteria.map((c) => c.id)).toEqual(["i", "ii", "iii", "iv", "v", "vi"]);
    expect(ok.criteria.every((c) => c.pass)).toBe(true);
    const noResidual = decideSchedule(eight((i) => block({ sense: arm(700_000 + i, 300_000, 0, 0) })), F, true);
    expect(noResidual.criteria.find((c) => c.id === "iv")!.pass).toBe(false);
    const drifterEqual = decideSchedule(eight((i) => block({ sense: arm(700_000 + i, 300_000, 9000, 0), drift: arm(700_000 + i, 300_000) })), F, true);
    expect(drifterEqual.criteria.find((c) => c.id === "vi")!.pass).toBe(false);
    const worseSurvival = decideSchedule(eight((i) => block({ sense: arm(700_000 + i, 300_000, 9000, 0, 100_000, 900_000) })), F, true);
    expect(worseSurvival.criteria.find((c) => c.id === "v")!.pass).toBe(false);
    const withinFloor = decideSchedule(eight((i) => block({ sense: arm(310_000 + i, 300_000, 9000, 0) })), F, true);
    expect(withinFloor.criteria.find((c) => c.id === "ii")!.pass).toBe(false);
  });
  it("positive B with negative S is not supported", () => {
    // S = -50k, N = -200k: B = +150k, but grouped sensing is worse than dispersed sensing.
    const d = decideSchedule(eight(() => block({ sense: arm(250_000, 300_000, 9000, 0), "sense-nosig": arm(100_000, 300_000) })), F, true);
    expect(d.B.positives).toBe(8);
    expect(d.S.positives).toBe(0);
    expect(d.criteria.find((c) => c.id === "i")!.pass).toBe(false);
    expect(d.nonPositive).toBe(true);
  });
  it("7 of 8 gives p = 9/256", () => {
    expect(signP(7, 8)).toBe("9/256");
    expect(signP(8, 8)).toBe("1/256");
    expect(9 / 256).toBeLessThan(1 / 20);
    expect(signP(6, 8)).toBe("37/256");
  });
  it("zeros count as not positive", () => {
    const d = decideSchedule(eight((i) => block({ sense: arm(i < 6 ? 700_000 : 300_000, 300_000, 9000, 0) })), F, true);
    expect(d.S.positives).toBe(6);
    expect(d.criteria.find((c) => c.id === "i")!.pass).toBe(false);
  });
  it("extinct arms keep terminal outcomes and blocks are not dropped", () => {
    // An extinct dispersed sense arm has capture and survival of its own terminal outcome (here zero), and still counts as a block.
    const blocks = eight((i) => block({ sense: arm(700_000, i === 0 ? 0 : 300_000, 9000, 0, 600_000, 0) }));
    const d = decideSchedule(blocks, F, true);
    expect(d.complete).toBe(8);
    expect(d.S.of).toBe(8);
    const missing = decideSchedule([...blocks.slice(0, 7), {}], F, true);
    expect(missing.complete).toBe(7);
    expect(missing.criteria.find((c) => c.id === "i")!.pass).toBe(false);
    // Seven uniformly passing blocks are not eight: the frozen block count is the denominator.
    const seven = decideSchedule(eight(benefit).slice(0, 7), F, true);
    expect(seven.blocks).toBe(8);
    expect(seven.complete).toBe(7);
    expect(seven.criteria.every((c) => c.pass)).toBe(false);
  });
  it("paused control with a benefit gives inconclusive-confounded", () => {
    const t = plantedTable({ fixed: 600_000, paused: 600_000, reversed: 600_000, wandering: 600_000 }, 1);
    const d = (s: string, full: boolean) => decideSchedule(t[s], F, full);
    const v = verdictOf({ fixed: d("fixed", true), paused: d("paused", false), reversed: d("reversed", false), wandering: d("wandering", false), floors: FS, insensitive: false, invalidBlocks: 0, blocks: 8 });
    expect(v.label).toBe("inconclusive-confounded");
  });
  it("floors come from noise seeds only", () => {
    // The tool's floors are computed by floorsFromNoise from the replicate-noise blocks only; the decision takes them as an argument.
    expect(decideSchedule.length).toBeGreaterThanOrEqual(3);
    expect(medianTimes2([1, 5, 3, 7])).toBe(8);
    expect(bootstrapLowerBound2([5, 5, 5, 5, 5, 5, 5, 5], 200, 1, 100_000)).toBe(10);
    expect(bootstrapLowerBound2([1, 2, 3], 200, 7, 100_000)).toBe(bootstrapLowerBound2([1, 2, 3], 200, 7, 100_000));
  });
  it("ties at zero with a positive majority are inconclusive, negative comparators disagreeing are confounded", () => {
    // S and B tie at zero in the median but five of eight blocks are positive: neither pass nor fail.
    const tie = decideSchedule(eight((i) => block({ sense: arm(300_000 + (i < 5 ? 1 : i < 6 ? 0 : -1), 300_000, 9000, 0) })), F, true);
    expect(tie.nonPositive).toBe(false);
    const v = verdictOf({ fixed: tie, paused: tie, reversed: tie, wandering: tie, floors: FS, insensitive: false, invalidBlocks: 0, blocks: 8 });
    expect(v.label).toBe("inconclusive");
    // Negative B (sense worse than its silent twin) but positive B_drift (better than the drifter): the comparators disagree.
    const dis = decideSchedule(eight(() => block({ sense: arm(300_000, 300_000), "sense-nosig": arm(600_000, 300_000), drift: arm(0, 300_000) })), F, true);
    expect(dis.B.median2!).toBeLessThan(0);
    const vd = verdictOf({ fixed: dis, paused: dis, reversed: dis, wandering: dis, floors: FS, insensitive: false, invalidBlocks: 0, blocks: 8 });
    expect(vd.label).toBe("inconclusive-confounded");
  });
  it("paused control is judged against its own floor", () => {
    const small = { cap: 100_000, res: 2_000 };
    const t = plantedTable({ fixed: 600_000, paused: 150_000, reversed: 600_000, wandering: 600_000 }, 2);
    const d = (s: string, full: boolean, f: typeof F) => decideSchedule(t[s], f, full);
    const mk = (pausedFloor: typeof F) => verdictOf({ fixed: d("fixed", true, F), paused: d("paused", false, pausedFloor), reversed: d("reversed", false, F), wandering: d("wandering", false, F), floors: { ...FS, paused: pausedFloor }, insensitive: false, invalidBlocks: 0, blocks: 8 }).label;
    expect(mk(small)).toBe("inconclusive-confounded");
    expect(mk({ cap: 1_000_000, res: 2_000 })).toBe("supported");
  });
  it("insensitive assay is unsupported-measurement, not no benefit", () => {
    const d = decideSchedule(eight(() => block()), F, true);
    const v = verdictOf({ fixed: d, paused: d, reversed: d, wandering: d, floors: FS, insensitive: true, invalidBlocks: 0, blocks: 8 });
    expect(v.label).toBe("unsupported-measurement");
    expect(verdictOf({ fixed: d, paused: d, reversed: d, wandering: d, floors: FS, insensitive: false, invalidBlocks: 0, blocks: 8 }).label).toBe("unsupported-within-tested-domain");
  });
});
