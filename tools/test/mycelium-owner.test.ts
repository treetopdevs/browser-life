// Owner-conduit readouts, sizing arithmetic and the O label step (docs/mycelium-bootstrap-owner-2026-11-15/DESIGN.md sections 2 to 4).
// Readouts are checked on hand-built states and against the rule's own arithmetic; the label step on synthetic cohorts.
import { describe, expect, it } from "vitest";
import {
  addHist, cpubRealisedVoid, edgeHists, effOf, histMedian, HIST_N, matchCpubFromHists, meanEffFromHist, ownerEdgeCensus, ownerGFromX, realisedCpubRatio,
} from "../mycelium/observe-owner.ts";
import { conduitCensus } from "../mycelium/observe-conduit.ts";
import { labelO, meanEdgeRate, meanOwnerEdgeRate, type OInputs } from "../mycelium/observe-bootstrap.ts";
import { armNeeds, armsOf, expandRuns, PROVISIONAL, runConfig, SIZING_FIELDS, type Sizing } from "../mycelium/bootstrap-arms.ts";
import { BOOT_BASE, type Heredity } from "../mycelium/bootstrap-seeds.ts";
import { analyzeO, flagOnTrail, keptO, O_EXTRA_ARMS, ownerImportCoverage, type BranchFile, type RunFile } from "../mycelium/bootstrap-analyze.ts";
import { sizeOwner } from "../mycelium/bootstrap-size.ts";
import { conduitRate, createWorld, defaultConfig, type MyceliumConfig, type MyceliumState, ownerRate, step } from "../mycelium/world.ts";

const TOLL = { moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" } as const;
const small = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ width: 32, height: 32, founders: 256, maxParticles: 2048, ...TOLL, trailOwner: "gid", ...over });
function stepped(over: Partial<MyceliumConfig>, steps: number): MyceliumState { const s = createWorld(small(over)); for (let t = 0; t < steps; t++) step(s); return s; }

describe("owner edge arithmetic", () => {
  it("effOf is the rule's own extra rate (ownerRate and conduitRate minus the base) for every x and a spread of g", () => {
    for (const De of [0, 40, 100]) for (const g of [0, 1, 15, 16, 32, 255]) for (let x = 0; x <= 300; x++) {
      expect(effOf(x, g, De)).toBe(ownerRate(De, g, 255, 7, 7, x, x + 3) - De);
      expect(effOf(x, g, De)).toBe(conduitRate(De, g, 255, x + 1, x) - De);
    }
    expect(effOf(9, 16, 40)).toBe(9);
    expect(effOf(200, 255, 40)).toBe(88);   // at the 128 limit
  });
  it("edgeHists counts same-owner edges by min(Q, Q) and all edges by min(P, P), clamped at 255", () => {
    const s = createWorld(small());
    s.P.fill(0); s.Z!.fill(0); s.Q!.fill(0);
    // Cells 0 and 1 share owner 5 (Q 3 and 9); cell 2 has another owner; cell 40 holds trail 700 next to cell 41 with 300.
    s.Z![0] = 5; s.Q![0] = 3; s.P[0] = 3; s.Z![1] = 5; s.Q![1] = 9; s.P[1] = 9; s.Z![2] = 6; s.Q![2] = 4; s.P[2] = 4;
    s.P[40] = 700; s.P[41] = 300;
    const h = edgeHists(s);
    expect(h.edges).toBe(4 * 32 * 32);
    expect(h.own.reduce((t, v) => t + v, 0)).toBe(2);   // 0 -> 1 and 1 -> 0
    expect(h.own[3]).toBe(2);
    expect(h.pub[3]).toBe(2);                            // the 0-1 edge both ways (min 3)
    expect(h.pub[4]).toBe(2);                            // the 1-2 edge both ways (min 4)
    expect(h.pub[255]).toBe(2);                          // 40-41: min 300, clamped
    expect(h.pub.reduce((t, v) => t + v, 0)).toBe(h.edges);
    expect(h.own.length).toBe(HIST_N);
    expect(addHist(h.own, h.own)[3]).toBe(4);
  });
  it("the histogram means equal the direct edge means on a lived-in owner world (owner and public, base subtracted)", () => {
    const s = stepped({ ownerDefend: 4 }, 400);
    const h = edgeHists(s), De = s.config.diffA;
    expect(h.own.reduce((t, v) => t + v, 0)).toBeGreaterThan(0);
    for (const g of [1, 16, 48, 255]) {
      expect(meanEffFromHist(h.own, h.edges, g, De)).toBeCloseTo(meanOwnerEdgeRate(s, g, 255) - De, 9);
      expect(meanEffFromHist(h.pub, h.edges, g, De)).toBeCloseTo(meanEdgeRate(s, g, 255) - De, 9);
      expect(ownerEdgeCensus(s, g, 255).meanEff).toBeCloseTo(meanOwnerEdgeRate(s, g, 255) - De, 9);
    }
    expect(meanEffFromHist(new Array(HIST_N).fill(0), 0, 16, De)).toBe(0);
  });
  it("with one owner everywhere and Q = P the owner census is the public conduit census", () => {
    const s = stepped({}, 300);
    s.Z!.fill(9); for (let k = 0; k < s.P.length; k++) s.Q![k] = s.P[k];
    const o = ownerEdgeCensus(s, 24, 255), c = conduitCensus(s, 24, 255);
    expect(o.csat).toBe(c.csat); expect(o.effP10).toBe(c.effP10); expect(o.effP50).toBe(c.effP50); expect(o.effP90).toBe(c.effP90);
    expect(o.impLayer).toBe(c.impLayer); expect(o.impNon).toBe(c.impNon); expect(o.impAll).toBe(c.impAll);
    expect(o.occx).toBe(c.occx); expect(o.occxShift).toBe(c.occxShift);
    expect(o.sameOcc).toBe(1);
  });
  it("no owner anywhere: nothing is live, the mean is 0 and residence is undefined-as-1", () => {
    const s = stepped({}, 50);
    s.Z!.fill(0); s.Q!.fill(0);
    const o = ownerEdgeCensus(s, 255, 255);
    expect(o.live).toBe(0); expect(o.csat).toBe(0); expect(o.meanEff).toBe(0); expect(o.xP50).toBeNull(); expect(o.sameOcc).toBe(0);
    expect(() => ownerEdgeCensus(createWorld(defaultConfig({ width: 16, height: 16, founders: 8, maxParticles: 64 })), 16, 255)).toThrow(/owner planes/);
  });
  it("OWN and not-OWN import groups split the particles by the tag of the cell they stand on", () => {
    const s = stepped({ ownerDefend: 4 }, 400);
    const o = ownerEdgeCensus(s, 16, 255);
    expect(o.nOwn + o.nOther).toBe(s.n); expect(o.nLayer + o.nNon).toBe(s.n);
  });
});

describe("owner sizing rules", () => {
  it("histMedian is the lower median and null when empty", () => {
    const h = new Array(HIST_N).fill(0);
    expect(histMedian(h)).toBeNull();
    h[2] = 1; h[5] = 1; h[9] = 1; expect(histMedian(h)).toBe(5);
    h[1] = 10; expect(histMedian(h)).toBe(1);
  });
  it("O1: g = round(480 / x), clamped, with the no-bite fallback", () => {
    expect(ownerGFromX([15, 15, 15, 15])).toEqual({ g: 32, x: 15, noBiteLikely: false });
    expect(ownerGFromX([1, 1, 1, 1]).g).toBe(255);            // 480, clamped
    expect(ownerGFromX([14, 15, 15, 16]).g).toBe(32);
    expect(ownerGFromX([14, 15, 16, 17]).g).toBe(31);          // median 15.5: 960 / 31 = 30.97
    expect(ownerGFromX([255, 255, 255, 255]).g).toBe(2);
    expect(ownerGFromX([null, 3, 3, 3])).toEqual({ g: 255, x: null, noBiteLikely: true });   // a run with no same-owner edge: nothing is sized on the rest
    expect(ownerGFromX([0, 0, 0, 0]).noBiteLikely).toBe(true);
  });
  it("O3 matches EXTRA rates: a ratio of rates that include the base would call a far-off strength matched", () => {
    const own = new Array(HIST_N).fill(0), pub = new Array(HIST_N).fill(0);
    own[16] = 100; pub[4] = 1000;                      // 100 owner edges at x 16, every one of 1000 edges public at x 4
    const m = matchCpubFromHists([{ own, pub, edges: 1000 }], 32, 40);
    // owner mean extra = 100 * 32 / 1000 = 3.2; public mean extra = (4 g') >> 4: g' 12 gives 3, g' 16 gives 4.
    expect(m.g).toBe(12); expect(m.ratio).toBeCloseTo(3 / 3.2, 9); expect(m.void).toBe(false);
    // With the base included, g' 1 would read (40 + 0) / 43.2 = 0.93, "matched": the extra-rate ratio at g' 1 is 0.
    expect(m.perG.find((p) => p.g === 1)!.ratio).toBe(0);
    const far = matchCpubFromHists([{ own, pub: new Array(HIST_N).fill(0), edges: 1000 }], 32, 40);
    expect(far.void).toBe(true);                       // no public trail: nothing matches
    const none = matchCpubFromHists([{ own: new Array(HIST_N).fill(0), pub, edges: 1000 }], 32, 40);
    expect(none.void).toBe(true); expect(none.ratio).toBeNull();   // no owner conduction: nothing to match
  });
  it("the realised C-pub check voids a missing or off-band ratio", () => {
    expect(realisedCpubRatio(3, 3.2)).toBeCloseTo(0.9375, 9);
    expect(realisedCpubRatio(3, 0)).toBeNull(); expect(realisedCpubRatio(null, 2)).toBeNull();
    expect(cpubRealisedVoid([0.95, 1.0, 1.05])).toBe(false);
    expect(cpubRealisedVoid([0.5, 0.6, 2.0])).toBe(true);
    expect(cpubRealisedVoid([1, null, 1])).toBe(true);
    expect(cpubRealisedVoid([])).toBe(true);
  });
});

describe("arms of the owner addendum", () => {
  it("S5 is two toll gid arms on the first four dev slots, the gated one at theta mid", () => {
    const sz: Sizing = { ...PROVISIONAL, theta: { lo: 2, mid: 4, hi: 8 } };
    const arms = armsOf("S5", sz);
    expect(arms.map((a) => a.id)).toEqual(["pass", "E"]);
    expect(arms[0].over).toMatchObject({ trailOwner: "gid", moveCost: 12 }); expect(arms[0].over.ownerDefend).toBeUndefined();
    expect(arms[1].over.ownerDefend).toBe(4);
    const runs = expandRuns("S5", sz, BOOT_BASE);
    expect(runs.length).toBe(8);
    expect(new Set(runs.map((r) => r.slot))).toEqual(new Set(expandRuns("S4", sz, BOOT_BASE).map((r) => r.slot)));
    expect(armNeeds("S5", "E")).toEqual(["theta"]); expect(armNeeds("S5", "pass")).toEqual([]);
  });
  it("T-C-pas is a core conduit-only arm at gPassive and needs only that field", () => {
    const sz: Sizing = { ...PROVISIONAL, gPassive: 255, gOwner: { lo: 8, mid: 32, hi: 128 } };
    const a = armsOf("O", sz).find((x) => x.id === "T-C-pas")!;
    expect(a.over.ownerConduit).toBe(255); expect(a.over.ownerDefend).toBeUndefined(); expect(a.gated).toBeUndefined();
    expect(armsOf("O", sz).find((x) => x.id === "T-C")!.over.ownerConduit).toBe(32);
    expect(armNeeds("O", "T-C-pas")).toEqual(["gPassive"]); expect(armNeeds("O", "T-EC")).toEqual(["theta", "gOwner", "gCpub"]);
    expect(SIZING_FIELDS).toContain("gPassive");
    expect(expandRuns("O", sz, BOOT_BASE).length).toBe(88);                       // 64 core + 16 anchors + 8 T-C-pas
    expect(expandRuns("O", sz, BOOT_BASE, { extras: true }).length).toBe(176);
  });
});

// ---- the label step on synthetic cohorts -------------------------------------------------------------------------------

const sideOf = (sumEnd: number, births = 40, extra: Record<string, unknown> = {}) => ({
  snaps: [0, 25, 50, 75, 100].map((t) => ({ step: t * 20, n: 100, births: Math.round((births * t) / 100), deaths: Math.round((20 * t) / 100), lightIn: 0, sumA: 1000 - Math.round(((1000 - sumEnd) * t) / 100), sumP: 0 })),
  ledgerBad: 0, nEnd: 100, ...extra,
});
/** One checkpoint: `on` eats 120; a variant in `beaten` eats 100 (on pays against it), every other variant eats 120 (no gain). */
const branchAt = (at: number, beaten: readonly string[]): BranchFile => ({
  at, len: 2000,
  variants: Object.fromEntries(["on", "nullA", "nullB", "coff", "eoff", "both", "oghost", "cpub"].map((v) => [v, { ...sideOf(beaten.includes(v) ? 900 : 880), ...(v === "oghost" ? { ghostCorr: 0.1 } : {}) }])),
});
const hist = (x: number, count: number) => { const h = new Array(HIST_N).fill(0); h[x] = count; return h; };
interface Shape { tm?: number | null; n?: number; own?: number; live?: number; csat?: number; effP50?: number; impLayer?: number; impNon?: number; occx?: number; speed?: number; acute?: number; beaten?: readonly string[]; pubX?: number }
const SZ: Sizing = { ...PROVISIONAL, provisional: false, measured: [...SIZING_FIELDS], theta: { lo: 2, mid: 4, hi: 8 }, gOwner: { lo: 8, mid: 32, hi: 128 }, gCpub: 12, gPassive: 255 };
function mkO(arm: string, slot: number, h: string, sh: Shape): RunFile {
  const over = armsOf("O", SZ).find((a) => a.id === arm)!;
  const anchor = arm.startsWith("anchor"), steps = anchor ? 30_000 : 100_000;
  const stepsCol = Array.from({ length: 10 }, (_, k) => (steps / 10) * (k + 1));
  const withBranch = arm === "T-EC" || anchor;
  return {
    id: `O.${arm}.${h}.${slot}`, series: "O", armId: arm, heredity: h, slot, worldSeed: slot, steps,
    config: runConfig(over.over, over.light, h as Heredity, slot) as unknown as RunFile["config"],
    ledgerChecks: 1, ledgerBadChecks: 0, minN: 100, snaps: [{ step: 0, n: sh.n ?? 1000, births: 0, deaths: 0, lightIn: 0, sumA: 0, sumP: 0 }], telescope: null, roadSeries: null, bootSeries: { step: [], cols: {} },
    late: {
      runValues: { meanN: sh.n ?? 1000 }, r4: { speed: sh.speed ?? 0.1, acute: sh.acute ?? 0.2 }, conduit: { sensLevel: 0, sensNut: 0 },
      boot: { tm: sh.tm === undefined ? 90 : sh.tm, own: sh.own ?? 0.9, open: 0.05, sameEdge: 0.7, ownerGhostCorr: arm === "T-EC-ghost" ? 0.1 : null },
      owner: { live: sh.live ?? 0.6, csat: sh.csat ?? 0.1, effP50: sh.effP50 ?? 30, sameOcc: 0.7, xP50: 15, impLayer: sh.impLayer ?? 0.2, impNon: sh.impNon ?? 0.1, impOwn: 0.2, impOther: 0.1, impAll: 0.15, occx: sh.occx ?? 1.5, occxShift: 1 },
    },
    ownerSeries: { step: stepsCol, cols: { impLayer: stepsCol.map(() => 0.2), impNon: stepsCol.map(() => 0.1) } },
    ownerHist: { own: hist(16, 100), pub: hist(sh.pubX ?? 4, 1000), edges: 1000, censuses: 1 }, ownerG: 32,
    branches: withBranch ? (anchor ? [20_000, 30_000] : [60_000, 100_000]).map((at) => branchAt(at, sh.beaten ?? [])) : [],
  };
}
/** A full O cohort (core, anchors, extras when asked); `shape` gives each arm's readings. */
function cohort(shape: (arm: string, h: string, slot: number) => Shape, extras = true): RunFile[] {
  const rows: RunFile[] = [];
  for (let s = 1; s <= 8; s++) {
    for (const arm of ["T-P", "T-E", "T-C", "T-C-pas", "T-EC", "T-EC-ghost", "T-C-pub", "T-base", "N-base"]) rows.push(mkO(arm, s, "inherit", shape(arm, "inherit", s)));
    rows.push(mkO("anchor-phys-EC", s, "physarum", shape("anchor-phys-EC", "physarum", s)), mkO("anchor-blind-EC", s, "blind", shape("anchor-blind-EC", "blind", s)));
    if (extras) for (const [arm, h] of O_EXTRA_ARMS) rows.push(mkO(arm, s, h, shape(arm, h, s)));
  }
  return rows;
}
const ALL = ["coff", "eoff", "both", "oghost"];
/** A world where only the owner rules keep trail and the conduit pays against every comparator. */
const used = (arm: string, h: string): Shape => {
  const keeps = ["T-EC", "T-EC-ghost", "T-EC-thLo", "T-EC-thHi", "T-EC-gLo", "T-EC-gHi", "T-EC-lowmut", "T-EC-id", "blk-id-T-EC"].includes(arm);
  return { tm: keeps ? (arm === "T-EC-thLo" || arm === "T-EC-gLo" ? 80 : 90) : 0.01, beaten: [...ALL, "cpub"], occx: h === "blocked" ? 1.0 : 1.6 };
};

describe("analyzeO", () => {
  it("says so when O was not run, was run before the addendum, or at stand-in strengths", () => {
    expect(analyzeO([], SZ).lines).toEqual(["O: not run"]);
    const old = cohort(used).map((r) => ({ ...r, ownerHist: undefined, late: { ...r.late, owner: undefined } }));
    expect(analyzeO(old, SZ).label).toMatchObject({ label: "INCOMPLETE" });
    expect(analyzeO(old, SZ).label!.note).toMatch(/no owned-edge readouts/);
    const standIn = analyzeO(cohort(used), { ...SZ, measured: SZ.measured.filter((k) => k !== "gOwner") });
    expect(standIn.label!.label).toBe("INCOMPLETE"); expect(standIn.label!.note).toMatch(/did not measure gOwner/);
    expect(analyzeO(cohort(used).filter((r) => r.slot <= 3), SZ).label!.note).toMatch(/cohort of 3 seeds/);
    expect(analyzeO(cohort(used).filter((r) => r.armId !== "T-C-pub"), SZ).label!.note).toMatch(/T-C-pub missing/);
    expect(analyzeO(cohort(used), { ...SZ, gOwner: { lo: 4, mid: 16, hi: 64 } }).label!.note).toMatch(/not run at the sized/);
    expect(analyzeO(cohort(used), { ...SZ, ownerStopRule: true }).label!.note).toMatch(/stop rule/);
  });
  it("KEPT-AND-USED with OWNER-SPECIFIC when every predicate holds and the matched public conduit loses its trail", () => {
    const r = analyzeO(cohort(used), SZ);
    expect(r.label).toEqual({ label: "KEPT-AND-USED", note: "OWNER-SPECIFIC" });
    expect(r.qualifiers).toEqual([]);
    expect(r.lines.join("\n")).toMatch(/realised ratio public\/owner \(median over slots\) 0\.938/);
    expect(r.lines.join("\n")).toMatch(/ANCHOR-PAYS/);
  });
  it("without the extras a K = Y cohort is INCOMPLETE, never a positive label", () => {
    expect(analyzeO(cohort(used, false), SZ).label!.label).toBe("INCOMPLETE");
  });
  it("the toll world: every arm keeps trail and the conduit does not pay: ENCLOSURE-ONLY, qualified TOLL-HELD", () => {
    const r = analyzeO(cohort(() => ({ tm: 95, beaten: [] })), SZ);
    expect(r.label!.label).toBe("ENCLOSURE-ONLY");
    expect(r.qualifiers).toEqual(["TOLL-HELD"]);
    expect(r.lines.join("\n")).toMatch(/kept 8\/8 -> does not hold/);      // (g): the public conduit keeps too
  });
  it("PURGED when T-EC falls under half the passive arm's trail; TERRITORY-COLLAPSE when the population halves", () => {
    expect(analyzeO(cohort((arm) => ({ tm: arm === "T-EC" ? 20 : 95 })), SZ).label!.label).toBe("PURGED");
    expect(analyzeO(cohort((arm) => ({ tm: 95, n: arm === "T-EC" ? 300 : 1000 })), SZ).label!.label).toBe("TERRITORY-COLLAPSE");
  });
  it("CONDUIT-IDLE and OUT-OF-BAND are printed and never change the label", () => {
    const idle = analyzeO(cohort((arm) => ({ tm: 95, beaten: [], live: arm === "T-EC" ? 0.05 : 0.6, effP50: 0 })), SZ);
    expect(idle.label!.label).toBe("ENCLOSURE-ONLY");
    expect(idle.qualifiers).toEqual(["TOLL-HELD", "CONDUIT-IDLE", "OUT-OF-BAND"]);
  });
  it("a void C-pub (sizing, or realised ratio off band) fails (g): the label cannot reach KEPT-AND-USED", () => {
    const voidSizing = analyzeO(cohort(used), { ...SZ, cpubVoid: true });
    expect(voidSizing.label!.label).toBe("KEPT-BY-PRESENCE-ONLY"); expect(voidSizing.label!.note).toMatch(/\(g\)/);
    const offBand = analyzeO(cohort((arm, h) => ({ ...used(arm, h), pubX: arm === "T-C-pub" ? 40 : 4 })), SZ);   // public mean extra 30 against owner 3.2
    expect(offBand.label!.label).toBe("KEPT-BY-PRESENCE-ONLY"); expect(offBand.lines.join("\n")).toMatch(/VOID/);
  });
  it("PAYALL needs every comparator: beating conduit-off alone is not payment; with damping it is KEPT-UNPAID", () => {
    const partial = analyzeO(cohort((arm, h) => ({ ...used(arm, h), beaten: ["coff"] })), SZ);
    expect(partial.label!.label).toBe("KEPT-BY-PRESENCE-ONLY"); expect(partial.label!.note).toMatch(/PAYALL/);
  });
  it("(c) is read within id: without a behaviour excess over blocked-id the conduit pays but is not used", () => {
    const flat = analyzeO(cohort((arm, h) => ({ ...used(arm, h), occx: 1.2 })), SZ);
    expect(flat.label!.label).toBe("CONDUIT-PAYS-NOT-USED");
  });
  it("review: a run that went extinct is unread for K even when its window mean still holds trail", () => {
    const p = mkO("T-P", 1, "inherit", { tm: 90 });
    expect(keptO({ ...mkO("T-EC", 1, "inherit", { tm: 80 }), minN: 0 }, p)).toBeNull();
    expect(keptO(mkO("T-EC", 1, "inherit", { tm: 80 }), { ...p, minN: 0 })).toBeNull();
    // Six T-EC runs extinct: K is unread on them, so the label is INCONCLUSIVE, never a "kept" label.
    const rows = cohort(() => ({ tm: 95, beaten: [] })).map((r) => (r.armId === "T-EC" && r.slot <= 6 ? { ...r, minN: 0 } : r));
    expect(analyzeO(rows, SZ).label!.label).toBe("INCONCLUSIVE");
  });
  it("review: stand-in files and unread dose slots cannot satisfy the extras or (f)", () => {
    const standIn = cohort(used).map((r) => (r.armId === "T-EC-gLo" ? { ...r, config: { ...r.config, ownerConduit: 4 } } : r));
    const a = analyzeO(standIn, SZ);
    expect(a.label!.label).toBe("INCOMPLETE"); expect(a.lines.join("\n")).toMatch(/8 O rows are not at this sizing's strengths/);
    const unread = cohort(used).map((r) => (r.armId === "T-EC-thLo" && r.slot <= 7 ? { ...r, late: { ...r.late, boot: { ...r.late.boot, tm: null } } } : r));
    const u = analyzeO(unread, SZ);
    // An unread dose median is unresolved, never a failed (f) (Sol round 2).
    expect(u.label!.label).toBe("INCONCLUSIVE"); expect(u.label!.note).toMatch(/\(f\)/);
    // A key the arm does not define (an extra subsidy) makes the file not this arm's run.
    const extraKey = cohort(used).map((r) => (r.armId === "T-EC" ? { ...r, config: { ...r.config, trailFreeLayer: 16 } } : r));
    expect(analyzeO(extraKey, SZ).label!.label).toBe("INCOMPLETE");
  });
  it("review 2: (e) and T-E's K join the same-seed votes; an unresolved (e) is INCONCLUSIVE", () => {
    const T = Array(8).fill(true) as (boolean | null)[], first6 = T.map((_, j) => j < 6), last6 = T.map((_, j) => j >= 2);
    const all: OInputs = { n: 8, e: T, kEC: T, kE: T.map(() => false), payECvsCoff: "Y", payAll: "Y", payAllS: T, harmOrDamp: false, b: T, c: T, d: T, H: T, G: T, f: true, g: true, payCpub: "N", stopRule: false, extras: true };
    expect(labelO(all).label).toBe("KEPT-AND-USED");
    // K, PAYALL, (b)(c)(d) on slots 1-6 and (e) on 3-8: only four seeds pass jointly.
    expect(labelO({ ...all, kEC: first6, payAllS: first6, b: first6, e: last6 }).label).toBe("INCONCLUSIVE");
    // (e) four true, four false: V(e) is I, so no negative label.
    expect(labelO({ ...all, e: T.map((_, j) => j < 4) })).toEqual({ label: "INCONCLUSIVE", note: expect.stringMatching(/\(e\)/) });
    // A definite failure still gives the negative label, with the open predicates named.
    expect(labelO({ ...all, g: false, f: null }).note).toMatch(/failing: \(g\) C-pub control; unresolved: \(f\) dose/);
    // ENCLOSURE-ONLY: T-EC kept on 1-6 and T-E on 3-8 is not a joint Y.
    expect(labelO({ ...all, kEC: first6, kE: last6, payECvsCoff: "N", payAll: "N", payAllS: T.map(() => false) }).label).not.toBe("ENCLOSURE-ONLY");
    expect(labelO({ ...all, kE: T, payECvsCoff: "N", payAll: "N", payAllS: T.map(() => false) }).label).toBe("ENCLOSURE-ONLY");
  });
  it("review: the acute branch needs the whole physarum anchor cohort; unresolved PAYALL or (c) is INCONCLUSIVE", () => {
    // Behaviour excess only through acute (occx flat): with one anchor left its value is not the cohort median, so H is unread.
    const acuteOnly = (arm: string, h: string): Shape => ({ ...used(arm, h), occx: 1.2, acute: arm === "T-EC-id" ? 0.5 : arm.startsWith("anchor") ? 0.2 : 0.1 });
    expect(analyzeO(cohort(acuteOnly), SZ).label!.label).toBe("KEPT-AND-USED");
    const partial = cohort(acuteOnly).filter((r) => !(r.armId === "anchor-phys-EC" && r.slot > 1));
    expect(analyzeO(partial, SZ).label!.label).toBe("INCONCLUSIVE");
    const noGhost = cohort(used).map((r) => (r.armId === "T-EC" ? { ...r, branches: r.branches.map((b) => { const v = { ...b.variants }; delete v.oghost; return { ...b, variants: v }; }) } : r));
    const g = analyzeO(noGhost, SZ);
    expect(g.label!.label).toBe("INCONCLUSIVE"); expect(g.label!.note).toMatch(/unresolved: PAYALL/);
  });
  it("keptO, coverage and flagOnTrail read unread inputs as unread", () => {
    const p = mkO("T-P", 1, "inherit", { tm: 90 });
    expect(keptO(mkO("T-EC", 1, "inherit", { tm: 50 }), p)).toBe(true);
    expect(keptO(mkO("T-EC", 1, "inherit", { tm: 44 }), p)).toBe(false);
    expect(keptO(mkO("T-EC", 1, "inherit", { tm: 0.05 }), p)).toBe(false);
    expect(keptO(mkO("T-EC", 1, "inherit", { tm: null }), p)).toBeNull();
    expect(keptO(mkO("T-EC", 1, "inherit", { tm: 50 }), mkO("T-P", 1, "inherit", { tm: null }))).toBeNull();
    expect(keptO(undefined, p)).toBeNull();
    const ec = mkO("T-EC", 1, "inherit", { beaten: ALL });
    expect(ownerImportCoverage(ec)).toBe(1);
    expect(ownerImportCoverage({ ...ec, ownerSeries: null })).toBeNull();
    expect(flagOnTrail(ec, "coff", "damp", [60_000, 100_000])).toBe(false);
    expect(flagOnTrail(ec, "nonesuch", "harm", [60_000, 100_000])).toBeNull();
    expect(flagOnTrail(ec, "coff", "harm", null)).toBeNull();
  });
});

describe("sizeOwner", () => {
  const s5 = (arm: string, slot: number, x: number | null, over: Partial<RunFile> = {}): RunFile => ({
    ...mkO("T-P", slot, "inherit", {}), id: `S5L.${arm}.inherit.${slot}`, series: "S5L", armId: arm, steps: 100_000,
    config: { eA: 1, diffA: 40, trailOwner: "gid", ...(arm === "E" ? { ownerDefend: 4 } : {}) } as RunFile["config"],
    ownerHist: { own: x === null ? new Array(HIST_N).fill(0) : hist(x, 100), pub: hist(4, 1000), edges: 1000, censuses: 20 }, ...over,
  });
  const rows = (xE: number, xP: number | null) => [1, 2, 3, 4].flatMap((s) => [s5("E", s, xE), s5("pass", s, xP)]);
  it("sizes gOwner on the gated worlds, gPassive on the passive ones, and the matched public strength", () => {
    const r = sizeOwner(rows(16, 1), SZ);
    expect(r.measured).toEqual(["gOwner", "gPassive", "gCpub"]);
    expect(r.sizing).toMatchObject({ gOwner: { lo: 7, mid: 30, hi: 120 }, gPassive: 255, gCpub: 12 });
    expect(r.sizing!.cpubVoid).toBeUndefined();
    expect(r.lines.join("\n")).toMatch(/extra rate at the median x and gOwner.mid: 30 of headroom 88/);
  });
  it("refuses an incomplete or mismatched sizing set", () => {
    expect(sizeOwner(rows(16, 1).slice(0, 6), SZ).sizing).toBeNull();
    expect(sizeOwner(rows(16, 1).map((r) => ({ ...r, steps: 2000 })), SZ).sizing).toBeNull();           // shortened pilots
    expect(sizeOwner(rows(16, 1), { ...SZ, theta: { lo: 2, mid: 8, hi: 32 } }).sizing).toBeNull();        // E runs at another theta
    expect(sizeOwner(rows(16, 1).map((r) => ({ ...r, ownerHist: null })), SZ).sizing).toBeNull();
    expect(sizeOwner(rows(16, 1).map((r) => ({ ...r, series: "S5", steps: 20_000 })), SZ).sizing).toBeNull();   // the 20,000-step first pilot sizes nothing
  });
  it("two-state gated world: only the territorial runs size the strength; fewer than two falls back to every run, flagged", () => {
    // Two territorial runs (x 16 on 600 of 1000 edges) and two passive-like ones (x 1 on 20 edges).
    const mix = [1, 2, 3, 4].flatMap((s) => [s5("E", s, 16, s <= 2 ? { ownerHist: { own: hist(16, 600), pub: hist(4, 1000), edges: 1000, censuses: 1 } } : { ownerHist: { own: hist(1, 20), pub: hist(4, 1000), edges: 1000, censuses: 1 } }), s5("pass", s, 1)]);
    const r = sizeOwner(mix, SZ);
    expect(r.sizing).toMatchObject({ gOwner: { lo: 7, mid: 30, hi: 120 }, ownerSizing: { territorialRuns: 2, fallbackAllRuns: false, gAllRuns: 56 } });   // every run: median x 8.5
    const one = mix.map((x) => (x.armId === "E" && x.slot === 2 ? { ...x, ownerHist: { own: hist(1, 20), pub: hist(4, 1000), edges: 1000, censuses: 1 } } : x));
    const f = sizeOwner(one, SZ);
    expect(f.sizing).toMatchObject({ gOwner: { mid: 255 }, ownerSizing: { territorialRuns: 1, fallbackAllRuns: true } });
    expect(f.lines.join("\n")).toMatch(/FLAGGED/);
  });
  it("no same-owner edge on passive worlds: gPassive 255, flagged", () => {
    const r = sizeOwner(rows(16, null), SZ);
    expect(r.sizing!.gPassive).toBe(255); expect(r.lines.join("\n")).toMatch(/O2.*NO-BITE-LIKELY/);
  });
});
