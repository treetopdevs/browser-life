// Unit tests for the conduit screen's section 7 labels (docs/mycelium-conduit-2026-11-14/DESIGN.md), which until now were only exercised by
// re-running `conduit-screen.ts --label` on the finished runs. The rules live in tools/mycelium/conduit-labels.ts.
import { describe, expect, it } from "vitest";
import { type Branch, branchRates, diffusionControlHolds, doseOrdered, seedPredicates, type StrengthCounts, strengthLabel } from "../mycelium/conduit-labels.ts";

const counts = (o: Partial<StrengthCounts> = {}): StrengthCounts => ({
  complete: true, nTot: 4, nK: 4, na: 4, nb: 4, nc: 4, nd: 4, nHnoG: 0, e: true, fOk: true, ...o,
});

describe("strengthLabel", () => {
  it("refuses to label an incomplete cohort, before any other rule", () => {
    expect(strengthLabel(counts({ complete: false, nK: 0 }))).toMatch(/^INCOMPLETE/);
    expect(strengthLabel(counts({ complete: false }))).toMatch(/^INCOMPLETE/);
  });
  it("PURGED when at most a quarter of the seeds keep trail", () => {
    expect(strengthLabel(counts({ nK: 0 }))).toBe("PURGED");
    expect(strengthLabel(counts({ nK: 1 }))).toBe("PURGED");
    expect(strengthLabel(counts({ nTot: 8, nK: 2 }))).toBe("PURGED");
    expect(strengthLabel(counts({ nTot: 8, nK: 3, na: 3, nb: 3, nc: 3, nd: 3 }))).not.toBe("PURGED");
  });
  it("an even split asks for the 8-seed extension", () => {
    expect(strengthLabel(counts({ nK: 2 }))).toBe("INCONCLUSIVE (extend to 8 seeds)");
    expect(strengthLabel(counts({ nTot: 8, nK: 4 }))).toBe("INCONCLUSIVE (extend to 8 seeds)");
  });
  it("KEPT-AND-USED needs (a)-(d) on at least 3 of 4 seeds, the dose order and the diffusion control", () => {
    expect(strengthLabel(counts({ nK: 3, na: 3, nb: 3, nc: 3, nd: 3 }))).toBe("KEPT-AND-USED");
    // the threshold is a share of all seeds (ceil(0.75 n)), not of the kept ones
    expect(strengthLabel(counts({ nTot: 8, nK: 6, na: 6, nb: 6, nc: 6, nd: 6 }))).toBe("KEPT-AND-USED");
    expect(strengthLabel(counts({ nTot: 8, nK: 6, na: 5, nb: 6, nc: 6, nd: 6 }))).toBe("KEPT-BY-PRESENCE-ONLY (failing: (a))");
  });
  it("KEPT-STATIC-SPONGE when behaviour (c) fails but H holds without G", () => {
    expect(strengthLabel(counts({ nc: 0, nHnoG: 3 }))).toBe("KEPT-STATIC-SPONGE");
    expect(strengthLabel(counts({ nc: 0, nHnoG: 2 }))).toBe("KEPT-BY-PRESENCE-ONLY (failing: (c))");
  });
  it("a sponge still needs the dose order and the control", () => {
    expect(strengthLabel(counts({ nc: 0, nHnoG: 4, e: false }))).toBe("KEPT-BY-PRESENCE-ONLY (failing: (c), (e))");
    expect(strengthLabel(counts({ nc: 0, nHnoG: 4, fOk: false }))).toBe("KEPT-BY-PRESENCE-ONLY (failing: (c), (f))");
  });
  it("names every failing condition, in order", () => {
    expect(strengthLabel(counts({ nK: 3, na: 0, nb: 0, nc: 0, nd: 0, e: false, fOk: false })))
      .toBe("KEPT-BY-PRESENCE-ONLY (failing: (a), (b), (c), (d), (e), (f))");
  });
  it("reproduces the screen's recorded labels (SCREEN.md: PURGED at c2, c8, c32, c128)", () => {
    const rec = [
      { nK: 1, na: 0, nb: 0, nc: 0, nd: 1, e: true },
      { nK: 1, na: 0, nb: 0, nc: 0, nd: 1, e: false },
      { nK: 0, na: 0, nb: 0, nc: 0, nd: 0, e: true },
      { nK: 1, na: 0, nb: 1, nc: 0, nd: 1, e: false },
    ];
    for (const r of rec) expect(strengthLabel(counts({ ...r, nHnoG: 0 }))).toBe("PURGED");
  });
});

const side = (births: number, n: number[], o: Partial<Branch["on"]> = {}) =>
  ({ nStart: n, births, deaths: 0, intake: births * 10, ledgerBad: 0, first: { births: 0, deaths: 0, intake: 0, n: n[0] }, nEnd: n[n.length - 1], ...o });

describe("branchRates", () => {
  it("is null without a branch", () => expect(branchRates(null)).toBeNull());
  it("divides births by particle-steps and gives the relative on-minus-off change", () => {
    const r = branchRates({ steps: 2, on: side(10, [50, 50]), off: side(8, [50, 50]) })!;
    expect(r.bOn).toBeCloseTo(0.1);
    expect(r.bOff).toBeCloseTo(0.08);
    expect(r.rel).toBeCloseTo(0.2);
  });
  it("rel is null when the conduit side has no births", () => {
    expect(branchRates({ steps: 1, on: side(0, [10]), off: side(3, [10]) })!.rel).toBeNull();
  });
});

// A minimal run row with every field seedPredicates reads.
const row = (o: { TM?: number | null; branch?: Branch | null; impLayer?: (number | null)[]; impNon?: (number | null)[]; layer?: number | null; non?: number | null;
  occx?: number; occxShift?: number; sensLevel?: number | null; sensNut?: number | null; acute?: number; speed?: number; csat?: number | null; csatCap?: number | null } = {}) => {
  const impLayer = o.impLayer ?? [0.2, 0.2, 0.2, 0.2], impNon = o.impNon ?? [0.1, 0.1, 0.1, 0.1];
  return {
    steps: 4000,
    branch: o.branch === undefined ? { steps: 200, on: side(12, [100, 100]), off: side(10, [100, 100]) } : o.branch,
    conduitSeries: { step: [1000, 2000, 3000, 4000], cols: { impLayer, impNon } },
    late: {
      runValues: { TM: o.TM === undefined ? 1 : o.TM },
      conduit: { impLayer: o.layer === undefined ? 0.2 : o.layer, impNon: o.non === undefined ? 0.1 : o.non, occx: o.occx ?? 0, occxShift: o.occxShift ?? 0,
        sensLevel: o.sensLevel ?? null, sensNut: o.sensNut ?? null, csat: o.csat === undefined ? 0.1 : o.csat, csatCap: o.csatCap === undefined ? 0.1 : o.csatCap },
      r4: { acute: o.acute ?? 0, speed: o.speed ?? 0.2 },
    },
  };
};

describe("seedPredicates", () => {
  const blk = row({ TM: 0, speed: 0.2 });
  it("K is the 0.1 trail-per-particle keep line; a missing TM counts as not kept", () => {
    expect(seedPredicates(row({ TM: 0.1 }), blk, null).K).toBe(true);
    expect(seedPredicates(row({ TM: 0.099 }), blk, null).K).toBe(false);
    expect(seedPredicates(row({ TM: null }), blk, null).K).toBe(false);
  });
  it("(a) needs a 5% birth gain from the conduit, a clean ledger and particles left on both sides", () => {
    expect(seedPredicates(row(), blk, null).a).toBe(true); // rel = (0.06 - 0.05) / 0.06
    expect(seedPredicates(row({ branch: { steps: 200, on: side(100, [1000, 1000]), off: side(99, [1000, 1000]) } }), blk, null).a).toBe(false);
    expect(seedPredicates(row({ branch: { steps: 200, on: side(12, [100, 100], { ledgerBad: 1 }), off: side(10, [100, 100]) } }), blk, null).a).toBe(false);
    expect(seedPredicates(row({ branch: { steps: 200, on: side(12, [100, 100]), off: side(10, [100, 100], { nEnd: 0 }) } }), blk, null).a).toBe(false);
    expect(seedPredicates(row({ branch: null }), blk, null).a).toBe(false);
  });
  it("(b) needs both import groups in at least half the late censuses and layer import above non-layer", () => {
    expect(seedPredicates(row(), blk, null).b).toBe(true);
    // late window is step > 2000: censuses 3000 and 4000; one of the two missing is still half
    expect(seedPredicates(row({ impNon: [0.1, 0.1, null, 0.1] }), blk, null).b).toBe(true);
    expect(seedPredicates(row({ impNon: [0.1, 0.1, null, null] }), blk, null).b).toBe(false);
    expect(seedPredicates(row({ layer: 0.1, non: 0.1 }), blk, null).b).toBe(false);
    expect(seedPredicates(row({ layer: 0, non: -1 }), blk, null).b).toBe(false);
  });
  it("H has three routes, all against the blocked partner, and is false without one", () => {
    expect(seedPredicates(row({ occx: 0.5, occxShift: 0.2 }), blk, null).hCases.occx).toBe(true);
    expect(seedPredicates(row({ occx: 0.4, occxShift: 0.2 }), blk, null).hCases.occx).toBe(false);
    expect(seedPredicates(row({ sensLevel: 0.01 }), row({ sensLevel: 0.005 }), null).hCases.sens).toBe(true);
    expect(seedPredicates(row({ sensLevel: 0.01 }), row({ sensLevel: 0.006 }), null).hCases.sens).toBe(false);
    expect(seedPredicates(row({ sensNut: 0.004 }), blk, null).hCases.sens).toBe(false);
    expect(seedPredicates(row({ sensNut: 0.006 }), row({ sensNut: 0.003 }), null).hCases.sens).toBe(true);
    // the blocked partner's occupancy contrast is subtracted
    expect(seedPredicates(row({ occx: 0.5, occxShift: 0.2 }), row({ occx: 0.3, occxShift: 0.2 }), null).hCases.occx).toBe(false);
    expect(seedPredicates(row({ occx: 0.7, occxShift: 0.2 }), row({ occx: 0.3, occxShift: 0.2 }), null).hCases.occx).toBe(true);
    expect(seedPredicates(row({ acute: 0.3 }), row({ acute: 0.1 }), 0.3).hCases.acute).toBe(true);
    expect(seedPredicates(row({ acute: 0.3 }), row({ acute: 0.1 }), null).hCases.acute).toBe(false);
    const solo = seedPredicates(row({ occx: 1, sensLevel: 1, acute: 1 }), undefined, 0.1);
    expect(solo.H).toBe(false);
    expect(solo.G).toBe(false);
  });
  it("a missing blocked-side sensitivity fails the route instead of counting as zero", () => {
    expect(seedPredicates(row({ sensLevel: 0.01 }), row({ sensLevel: null }), null).hCases.sens).toBe(false);
    expect(seedPredicates(row({ sensNut: 0.01 }), row({ sensNut: null }), null).hCases.sens).toBe(false);
    expect(seedPredicates(row({ sensLevel: 0.01 }), row({ sensLevel: null }), null).H).toBe(false);
  });
  it("G needs speed at least 0.05 and at least half the blocked partner's", () => {
    expect(seedPredicates(row({ speed: 0.1 }), row({ speed: 0.2 }), null).G).toBe(true);
    expect(seedPredicates(row({ speed: 0.09 }), row({ speed: 0.2 }), null).G).toBe(false);
    expect(seedPredicates(row({ speed: 0.04 }), row({ speed: 0.01 }), null).G).toBe(false);
  });
  it("c is H and G together", () => {
    const p = seedPredicates(row({ occx: 1, speed: 0.2 }), blk, null);
    expect([p.H, p.G, p.c]).toEqual([true, true, true]);
    expect(seedPredicates(row({ occx: 1, speed: 0.01 }), blk, null).c).toBe(false);
  });
  it("(d) needs both saturation shares at most one half, and present", () => {
    expect(seedPredicates(row({ csat: 0.5, csatCap: 0.5 }), blk, null).d).toBe(true);
    expect(seedPredicates(row({ csat: 0.51 }), blk, null).d).toBe(false);
    expect(seedPredicates(row({ csatCap: null }), blk, null).d).toBe(false);
  });
});

describe("doseOrdered (e)", () => {
  const med = (v: Record<string, number>) => (k: string) => v[k];
  it("c2 has nothing below it", () => expect(doseOrdered("c2", med({}))).toBe(true));
  it("c8 must not fall below c2", () => {
    expect(doseOrdered("c8", med({ c2: 1, c8: 1 }))).toBe(true);
    expect(doseOrdered("c8", med({ c2: 1, c8: 0.99 }))).toBe(false);
  });
  it("c32 and c128 may fall to 0.8 of the strength below", () => {
    expect(doseOrdered("c32", med({ c8: 1, c32: 0.8 }))).toBe(true);
    expect(doseOrdered("c32", med({ c8: 1, c32: 0.79 }))).toBe(false);
    expect(doseOrdered("c128", med({ c32: 1, c128: 0.8 }))).toBe(true);
    expect(doseOrdered("c128", med({ c32: 1, c128: 0.79 }))).toBe(false);
  });
});

describe("diffusionControlHolds (f)", () => {
  it("at most one kept seed at every bracket value", () => {
    expect(diffusionControlHolds([{ kept: 0 }, { kept: 1 }, { kept: 1 }])).toBe(true);
    expect(diffusionControlHolds([{ kept: 0 }, { kept: 2 }, { kept: 0 }])).toBe(false);
  });
});
