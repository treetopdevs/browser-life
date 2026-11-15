// Bootstrap-screen readouts, sizing rules, vote rule, labels, arms and seed audit (docs/mycelium-bootstrap-2026-11-14/DESIGN.md sections 7 to 11).
// Every readout is checked on a hand-built state or snapshot list with a known answer; the label functions on synthetic inputs for every label;
// the intake identity exactly, on CPU runs, against an independent route (the matter ledger).
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aliveAndWindow, atMost, branchWindows, chooseV, colMin, colWindow, defenceCurve, emptyCols, freeCeiling, freeStrengths, ghostCorrP, gRising, half,
  independentIntakeProblem, intakeBetween, intakesOf, joint, judge, labelD, labelF, labelO, labelT, matchCpub, matterIntake, meanEdgeRate, meanOwnerEdgeRate, need, noiseFloor, noTollLabel,
  observerView, ownerCensus, xMedOccupied, DEF_THETAS, BOOT_KEYS, ownerEdgeCorr, ownerGStrengths, plateauDd, pushCols, relOf, relsOf, roadCensus, settleT0, snapOf, telescopeProblem, thetaR6, tmSplit, vote, windowSide,
  xflux, ratesOf, type FInputs, type OInputs, type Snap,
} from "../mycelium/observe-bootstrap.ts";
import {
  armNeeds, armsOf, expandRuns, lowDoseF, PROVISIONAL, rateFromLog, resumeProblem, runConfig, runSummary, schedule, SIZING_FIELDS, sizingStamp, specConfig, unmeasuredNeeds, variantState, type Sizing,
} from "../mycelium/bootstrap-arms.ts";
import {
  allSeeds, auditTable, BASE_CANDIDATES, BOOT_BASE, HEREDITIES, nullSeedA, nullSeedB, proposeBase, slotsOf, tableRows, TABLE_SIZE, worldSeed, type RegisteredSet,
} from "../mycelium/bootstrap-seeds.ts";
import { analyzeD, analyzeD0, analyzeF, analyzeT, branchPairs, dampOnTrail, importCoverage, keptClass, mainGhostVoid, labelRows, payOnTrail, plannedAt, type BranchFile, type RunFile } from "../mycelium/bootstrap-analyze.ts";
import { sizeFromS } from "../mycelium/bootstrap-size.ts";
import { depositMeasure } from "../mycelium/observe-r2b.ts";
import { createWorld, defaultConfig, type MyceliumConfig, type MyceliumState, step, validateConfig, validateState } from "../mycelium/world.ts";

const small = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ width: 48, height: 48, founders: 256, maxParticles: 2048, ...over });
const cell = (x: number, y: number, W = 48) => y * W + x;
/** Put particle i inside cell (cx, cy). */
function put(s: MyceliumState, i: number, cx: number, cy: number) { s.x[i] = cx * 256 + 10; s.y[i] = cy * 256 + 10; }

// ---- exact intake -----------------------------------------------------------------------------------------------------

describe("intake identity", () => {
  const configs: Record<string, Partial<MyceliumConfig>> = {
    keyless: {},
    "light gradient": { lightPattern: "gradient" },
    "prelaid rows + conduit": { trailInit: 16, trailInitPattern: "rows", trailConduit: 255, trailConduitCap: 2, lightPattern: "gradient" },
    "free layer + ghost": { trailFreeLayer: 16, trailConduit: 30, trailConduitGhost: 7 },
    "owner EC": { trailOwner: "gid", ownerDefend: 4, ownerConduit: 16, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" },
  };
  for (const [name, over] of Object.entries(configs)) {
    it(`is exact at every step and telescopes (${name})`, () => {
      const s = createWorld(small(over));
      const snaps: Snap[] = [snapOf(s)];
      const light = (x: MyceliumState) => ({ C: x.C.slice(), P: x.P.slice(), M: x.M.slice(), n: x.n, totals: { lightIn: x.totals.lightIn }, config: { eA: x.config.eA } }) as unknown as MyceliumState;
      let total = 0, prev = light(s);
      for (let t = 0; t < 200; t++) {
        step(s);
        const cur = snapOf(s);
        const a = intakeBetween(snaps[snaps.length - 1], cur, s.config.eA);
        // The independent route: matter ledger (light units + dC + dP + dM).
        expect(a).toBe(matterIntake(prev, s));
        expect(Number.isInteger(a) && a >= 0).toBe(true);
        total += a;
        snaps.push(cur);
        prev = light(s);
      }
      expect(total).toBeGreaterThan(0);
      expect(intakeBetween(snaps[0], snaps[snaps.length - 1], s.config.eA)).toBe(total);
      expect(telescopeProblem(snaps, s.config.eA)).toBeNull();
      expect(validateState(s)).toEqual([]);
    });
  }
  it("rejects light energy that is not a whole number of units, and a broken telescope", () => {
    const a: Snap = { step: 0, n: 1, births: 0, deaths: 0, lightIn: 0, sumA: 100, sumP: 0 };
    expect(() => intakeBetween(a, { ...a, step: 1, lightIn: 3 }, 4)).toThrow(/whole number/);
    expect(intakeBetween(a, { ...a, step: 1, lightIn: 8, sumA: 95 }, 4)).toBe(7);
    // A negative per-interval intake (A grew without light) is a problem the telescope check names.
    const grown: Snap[] = [a, { ...a, step: 1, sumA: 120 }, { ...a, step: 2, sumA: 100 }];
    expect(telescopeProblem(grown, 4)).toMatch(/non-negative integer/);
  });
});

describe("windowed pair statistics", () => {
  // n 100, 100, 120, 120 over steps 0, 10, 20, 30; births and deaths cumulative; A falls as it is eaten, light adds 8 energy (2 units) per 10 steps.
  const snaps: Snap[] = [
    { step: 0, n: 100, births: 0, deaths: 0, lightIn: 0, sumA: 1000, sumP: 0 },
    { step: 10, n: 100, births: 6, deaths: 2, lightIn: 8, sumA: 950, sumP: 0 },
    { step: 20, n: 120, births: 16, deaths: 4, lightIn: 16, sumA: 900, sumP: 0 },
    { step: 30, n: 120, births: 18, deaths: 10, lightIn: 24, sumA: 880, sumP: 0 },
  ];
  it("gives births, deaths, trapezoid population and intake of a window", () => {
    const w = windowSide(snaps, 10, 30, 4)!;
    expect(w.births).toBe(12);
    expect(w.deaths).toBe(8);
    // trapezoid: (100+120)/2 * 10 + (120+120)/2 * 10 = 1100 + 1200
    expect(w.nSum).toBe(2300);
    // 950 + (24-8)/4 - 880 = 74
    expect(w.intake).toBe(74);
    expect(windowSide(snaps, 0, 30, 4)!.intake).toBe(1000 + 6 - 880);
    expect(intakesOf(snaps, 4)).toEqual([1000 + 2 - 950, 950 + 2 - 900, 900 + 2 - 880]);
    expect(windowSide(snaps, 5, 30, 4)).toBeNull();
    expect(windowSide(snaps, 30, 10, 4)).toBeNull();
    const r = ratesOf(w);
    expect(r.b).toBeCloseTo(12 / 2300, 12); expect(r.d).toBeCloseTo(8 / 2300, 12); expect(r.i).toBeCloseTo(74 / 2300, 12); expect(r.N).toBe(115);
    expect(r.free).toBeNull();
  });
  it("carries the exact free and paid unit deltas when the world has the free layer", () => {
    const f: Snap[] = [{ ...snaps[0], free: 5, paid: 1 }, { ...snaps[1], free: 9, paid: 4 }];
    const w = windowSide(f, 0, 10, 4)!;
    expect(w.free).toBe(4); expect(w.paid).toBe(3);
    expect(ratesOf(w).free).toBeCloseTo(4 / 1000, 12);
    const s = createWorld(small({ trailFreeLayer: 8 }));
    expect(snapOf(s).free).toBe(0);
  });
  it("relative differences, noise floor and the PAY, DAMP, HARM rules at the stated thresholds", () => {
    expect(relOf(110, 100)).toBeCloseTo(0.1, 12); expect(relOf(0, 0)).toBe(0); expect(relOf(1, 0)).toBeNull();
    const on = windowSide(snaps, 0, 30, 4)!;
    const comp = { ...on, intake: on.intake / 1.1 };
    const rels = relsOf(on, comp);
    expect(rels.i).toBeCloseTo(0.1, 9); expect(rels.N).toBe(0); expect(rels.d).toBe(0); expect(rels.b).toBe(0);
    const nf0 = noiseFloor([{ i: 0.004, N: 0, d: 0.001, b: 0.002, bd: 0 }, { i: -0.01, N: 0.002, d: 0, b: 0, bd: 0 }]);
    expect(nf0.i).toBe(0.01);
    // thr_i = max(3%, 2 nf_i): 10% intake gain with floor 3% -> PAY.
    const v = judge(rels, nf0);
    expect(v.thrI).toBeCloseTo(0.03, 12); expect(v.pay).toBe(true); expect(v.damp).toBe(false); expect(v.harm).toBe(false); expect(v.payStrong).toBe(false);
    // thr_i rises with the noise: nf_i 0.06 -> thr 0.12 > 0.10: unresolved (null), never false.
    const noisy = judge(rels, { ...nf0, i: 0.06 });
    expect(noisy.pay).toBeNull(); expect(noisy.unresolved).toMatch(/thr_i/);
    // A noisy safeguard (above 10%) is unresolved; below it the fixed 3% margin is NOT widened by noise.
    expect(judge(rels, { ...nf0, d: 0.2 }).pay).toBeNull();
    const dUp = judge({ ...rels, d: 0.04 }, { ...nf0, d: 0.09 });
    expect(dUp.pay).toBe(false);
    // Each safeguard blocks PAY at its edge: N down 3.1%, b down 3.1%, d up 3.1%.
    expect(judge({ ...rels, N: -0.031 }, nf0).pay).toBe(false);
    expect(judge({ ...rels, N: -0.03 }, nf0).pay).toBe(true);
    expect(judge({ ...rels, b: -0.031 }, nf0).pay).toBe(false);
    expect(judge({ ...rels, d: 0.031 }, nf0).pay).toBe(false);
    // PAY-STRONG needs population up by 3%.
    expect(judge({ ...rels, N: 0.03 }, nf0).payStrong).toBe(true);
    // DAMP: turnover down 3% and intake not up by thr_i; HARM: population down 3%.
    const damp = judge({ i: 0.01, N: 0, d: -0.05, b: -0.05, bd: -0.05 }, nf0);
    expect(damp.damp).toBe(true); expect(damp.pay).toBe(false);
    expect(judge({ i: 0.2, N: 0, d: -0.05, b: -0.05, bd: -0.05 }, nf0).damp).toBe(false);
    expect(judge({ i: 0, N: -0.05, d: 0, b: 0, bd: 0 }, nf0).harm).toBe(true);
    // An undefined relative difference is unresolved.
    expect(judge({ ...rels, b: null }, nf0).unresolved).toMatch(/undefined/);
    expect(judge(rels, noiseFloor([])).unresolved).toMatch(/undefined/);
  });
  it("branch windows are the quarters, halves, the whole and the last half", () => {
    expect(branchWindows(2000)).toEqual({ q1: [0, 500], q2: [500, 1000], h2: [1000, 2000], whole: [0, 2000], last: [1000, 2000] });
  });
});

// ---- vote rule ----------------------------------------------------------------------------------------------------------

describe("vote rule", () => {
  const seeds = (y: number, n: number, u = 0) => [...Array(y).fill(true), ...Array(n).fill(false), ...Array(u).fill(null)] as (boolean | null)[];
  it("Y at 6 of 8, N at 6 of 8, I otherwise; unresolved never fails a seed", () => {
    expect(need(8)).toBe(6); expect(atMost(8)).toBe(2); expect(half(8)).toBe(4);
    expect(vote(seeds(6, 2))).toBe("Y"); expect(vote(seeds(5, 3))).toBe("I"); expect(vote(seeds(2, 6))).toBe("N"); expect(vote(seeds(3, 5))).toBe("I");
    expect(vote(seeds(5, 0, 3))).toBe("I");
    expect(vote(seeds(0, 5, 3))).toBe("I");
    expect(vote(seeds(6, 0, 2))).toBe("Y");
  });
  it("thresholds scale with n (16 seeds after an extension)", () => {
    expect(need(16)).toBe(12); expect(atMost(16)).toBe(4); expect(half(16)).toBe(8);
    expect(vote(seeds(12, 4))).toBe("Y"); expect(vote(seeds(11, 5))).toBe("I"); expect(vote(seeds(4, 12))).toBe("N");
    expect(need(4)).toBe(3);
  });
  it("a joint vote is a per-seed conjunction", () => {
    const a = [true, true, true, true, true, true, false, false], b = [false, false, true, true, true, true, true, true];
    expect(vote(a)).toBe("Y"); expect(vote(b)).toBe("Y");
    // Both pass 6 of 8 separately, but only 4 seeds pass both.
    expect(joint(a, b).filter((x) => x === true).length).toBe(4);
    expect(vote(joint(a, b))).toBe("I");
    expect(joint([true, null], [true, true])).toEqual([true, null]);
    expect(joint([true, null], [false, true])).toEqual([false, null]);
  });
});

// ---- field readouts on hand-built states ----------------------------------------------------------------------------------

describe("roadCensus", () => {
  const roadWorld = () => {
    const s = createWorld(small({ trailInit: 16, trailInitPattern: "rows", founders: 4, maxParticles: 64, diffA: 40 }));
    return s;
  };
  it("counts laid cells, edges and the road share with known answers", () => {
    const s = roadWorld();
    // rows pitch 8 on 48 x 48: 6 laid rows of 48 = 288 cells; each has two laid east/west neighbours: 576 directed edges; N/S neighbours are 1 row away (not laid).
    for (let i = 0; i < 4; i++) put(s, i, 3 + i, 8 * (i < 2 ? 1 : 0) + (i < 2 ? 0 : 1)); // p0 (3,8) laid, p1 (4,8) laid, p2 (5,1) not, p3 (6,1) not
    const r = roadCensus(s)!;
    expect(r.laidCells).toBe(288); expect(r.laidEdges).toBe(576);
    expect(r.laidArea).toBeCloseTo(288 / 2304, 12);
    expect(r.xMed).toBe(16); expect(r.xGe1).toBe(1); expect(r.xGe2).toBe(1); expect(r.xGe3).toBe(1);
    expect(r.laidA8).toBe(1);  // A = 48 - 16 = 32 on laid cells
    expect(r.onLaid).toBe(0.5);
    expect(r.road).toBeCloseTo(0.5 - 0.125, 12);
    expect(r.desert).toBe(0);
    // P = 16 on every laid cell: edge x = min(16, 16, q = 2) = 2 -> Dd = 40 + 31 = 71; every other edge (P = 0) is 40.
    expect(r.meanDd2).toBeCloseTo((576 * 71 + (9216 - 576) * 40) / 9216, 9);
    expect(r.meanDd1).toBeCloseTo((576 * (40 + 15) + (9216 - 576) * 40) / 9216, 9);
    expect(meanEdgeRate(s, 255, 2)).toBeCloseTo(r.meanDd2, 12);
  });
  it("reads a damaged road: a hole, half the laid cells without food, a particle in a desert", () => {
    const s = roadWorld();
    s.P[cell(0, 0)] = 0;              // a hole in row 0: 4 directed edges (2 out, 2 in) at x = 0
    let k = 0;
    for (let x = 0; x < 48; x++) for (const y of [0, 8, 16]) { if (k++ % 2 === 0) s.A[cell(x, y)] = 0; } // half of 144 cells
    put(s, 0, 0, 0); // standing on the hole, whose A is 0 (k = 0 was zeroed): a desert cell
    const r = roadCensus(s)!;
    expect(r.xGe1).toBeCloseTo(572 / 576, 12);
    expect(r.xGe2).toBeCloseTo(572 / 576, 12);
    expect(r.laidA8).toBeCloseTo((288 - 72) / 288, 12);
    expect(r.desert).toBeGreaterThan(0);
  });
  it("is null when nothing is laid", () => { expect(roadCensus(createWorld(small()))).toBeNull(); });
  it("agrees with the rule's laid geometry per pattern", () => {
    for (const [p, cells] of [["rows", 288], ["cols", 288], ["lattice", 540], ["patches", 576]] as const) {
      const s = createWorld(small({ trailInit: 4, trailInitPattern: p, trailInitPitch: p === "patches" ? 8 : 8 }));
      expect(roadCensus(s)!.laidCells).toBe(cells);
    }
  });
});

describe("xflux", () => {
  it("sums eff * (A east - A west) / 1024 over the mid-column edges", () => {
    const s = createWorld(small({ trailConduit: 255, trailConduitCap: 2, founders: 4, maxParticles: 64 }));
    s.P.fill(16);
    for (let y = 0; y < 48; y++) { s.A[cell(24, y)] = 50; s.A[cell(23, y)] = 20; s.A[cell(30, y)] = 3; }
    // x = min(16, 16, 2) = 2: eff = 31 on every edge; 48 edges, each 31 * 30 / 1024.
    expect(xflux(s, 255, 2)).toBeCloseTo((48 * 31 * 30) / 1024, 9);
    expect(xflux(s, 0, 2)).toBe(0);  // g = 0: no extra conductance
    s.P[cell(24, 5)] = 0;            // one edge loses its conductance (x = 0)
    expect(xflux(s, 255, 2)).toBeCloseTo((47 * 31 * 30) / 1024, 9);
  });
});

describe("tmSplit", () => {
  it("separates trail above and inside the free layer, per particle, and for thin cells only", () => {
    const s = createWorld(small({ founders: 4, maxParticles: 64 }));
    s.P.fill(0);
    s.P[cell(5, 5)] = 40; s.P[cell(9, 9)] = 10;
    put(s, 0, 5, 5); put(s, 1, 9, 9); put(s, 2, 9, 9); put(s, 3, 9, 9);
    const t = tmSplit(s, 16);
    expect(t.tm).toBe(50 / 4);
    expect(t.tmAbove).toBe(24 / 4);       // only cell (5,5): 40 - 16
    expect(t.tmFree).toBe(26 / 4);        // 16 + 10
    // Thin cells (at most two particles): only (5,5), one particle.
    expect(t.particles2).toBe(1); expect(t.tmAbove2).toBe(24); expect(t.tmFree2).toBe(16);
    const none = tmSplit(createWorld(small({ founders: 1, maxParticles: 8 })), 16);
    expect(none.tmAbove).toBe(0);
  });
});

describe("owner census", () => {
  const world = () => {
    const s = createWorld(small({ trailOwner: "id", ownerDefend: 4, founders: 4, maxParticles: 64 }));
    s.nextId = 100;                      // tags are id + 1: p0..p3 -> 1..4
    put(s, 0, 10, 10); put(s, 1, 11, 10); put(s, 2, 20, 20); put(s, 3, 30, 30);
    s.P.fill(0);
    const setC = (x: number, y: number, z: number, q: number) => { s.Z![cell(x, y)] = z; s.Q![cell(x, y)] = q; s.P[cell(x, y)] = q; };
    setC(10, 10, 1, 6);   // p0 stands on its own cell
    setC(11, 10, 1, 5);   // p1 (tag 2) on a stranger's cell with Q 5 >= 4: defended against it
    setC(20, 20, 9, 2);   // p2 (tag 3) on a stranger's cell with Q 2 < 4: open
    setC(40, 40, 7, 9);   // a defended cell whose tag 7 matches no live particle (dead fence), nobody on it
    return s;
  };
  it("class shares, owned shares, Q percentiles, same-owner edges and the dead fence", () => {
    const s = world();
    const o = ownerCensus(s);
    expect(o.own).toBe(0.25); expect(o.foreignDefended).toBe(0.25); expect(o.open).toBe(0.5);
    expect(o.ownedCells).toBe(4);
    expect(o.ownedOccupied).toBe(3 / 4);       // 4 occupied cells, 3 owned (30,30 is not owned)
    expect(o.ownedShareP).toBe(1);             // sum Q = sum P by construction
    expect(o.qP50).toBe(6);                    // sorted Q 2, 5, 6, 9: index floor(0.5 * 4) = 2
    expect(o.qP10).toBe(2); expect(o.qP99).toBe(9);
    expect(o.sameEdge).toBeCloseTo(2 / (4 * 2304), 12);   // (10,10) and (11,10) share tag 1: two directed edges
    // Defended cells (Q >= 4): (10,10) tag 1 live, (11,10) tag 1 live, (40,40) tag 7 dead: 1 of 3.
    expect(o.deadFence).toBeCloseTo(1 / 3, 12);
  });
  it("defence curve per theta", () => {
    const s = world();
    const c = defenceCurve(s, [1, 5, 6, 10]);
    expect(c.map((x) => x.particles)).toEqual([0.5, 0.25, 0, 0]);          // theta 1: p1 and p2; theta 5: p1; above 5: none (own cell does not count)
    expect(c.map((x) => x.cells)).toEqual([3 / 4, 2 / 4, 1 / 4, 0]);       // occupied owned cells with Q >= theta
  });
  it("no defence key: nothing is defended against", () => {
    const s = createWorld(small({ trailOwner: "id", founders: 2, maxParticles: 8 }));
    put(s, 0, 1, 1); s.Z![cell(1, 1)] = 5; s.Q![cell(1, 1)] = 9; s.P[cell(1, 1)] = 9;
    expect(ownerCensus(s).foreignDefended).toBe(0);
  });
  it("owner edge conductance and the ghost's edge-map correlation (a constant map is void, not zero)", () => {
    const s = world();
    expect(meanOwnerEdgeRate(createWorld(small({ trailOwner: "id", ownerConduit: 16 })), 16, 255)).toBe(40);   // no owners: every edge at the base rate
    // Tag 1 on two adjacent cells with Q 6 and 5: min 5, ext (5 * 16) >> 4 = 5, rate 45 on the two directed edges between them.
    s.Z![cell(10, 10)] = 1; s.Q![cell(10, 10)] = 6; s.Z![cell(11, 10)] = 1; s.Q![cell(11, 10)] = 5;
    s.Z![cell(20, 20)] = 0; s.Q![cell(20, 20)] = 0; s.Z![cell(40, 40)] = 0; s.Q![cell(40, 40)] = 0;
    const cfg = { ...s.config, ownerConduit: 16, ownerGhost: 7 };
    const s2 = { ...s, config: cfg };
    expect(meanOwnerEdgeRate(s2, 16, 255)).toBeCloseTo(40 + (2 * 5) / 9216, 9);
    const corr = ownerEdgeCorr(s2, 16, 255, 7);
    expect(corr).not.toBeNull();
    expect(Math.abs(corr!)).toBeLessThan(0.1);   // one conducting pair against a displaced image of itself
    expect(ownerEdgeCorr(createWorld(small({ trailOwner: "id", ownerConduit: 16, ownerGhost: 7 })), 16, 255, 7)).toBeNull();
  });
  it("ghost correlation of P: 1 at shift 0 of a smooth field, null for a constant field", () => {
    const s = createWorld(small({ founders: 1, maxParticles: 8 }));
    expect(ghostCorrP(s, 3)).toBeNull();
    for (let k = 0; k < s.P.length; k++) s.P[k] = (Math.imul(k ^ (k >>> 7), 2654435761) >>> 20) % 97;
    const c = ghostCorrP(s, 5)!;
    expect(Math.abs(c)).toBeLessThan(0.2);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) s.P[cell(x, y)] = 10 + (x % 12);   // period 12: shift 12 maps onto itself
    expect(ghostCorrP(s, 12)).toBeCloseTo(1, 9);
  });
});

describe("observerView", () => {
  const ownerWorld = () => {
    const s = createWorld(small({ trailOwner: "gid", ownerDefend: 4, ownerConduit: 16, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" }));
    for (let t = 0; t < 150; t++) step(s);
    return s;
  };
  it("protects the owner planes from observe-r2b's depositMeasure, which steps a clone that shares them", () => {
    const s = ownerWorld();
    const q0 = s.Q!.slice(), z0 = s.Z!.slice();
    expect(validateState(s)).toEqual([]);
    depositMeasure(observerView(s));
    expect(s.Q).toEqual(q0); expect(s.Z).toEqual(z0);
    expect(validateState(s)).toEqual([]);
  });
  it("documents the upstream defect the view works around: on the raw state the live Q is rewritten", () => {
    const s = ownerWorld();
    const q0 = s.Q!.slice();
    depositMeasure(s);
    // If observe-r2b.ts's cloneNoDecay is ever fixed to copy Z and Q, this expectation flips and the view becomes a no-op worth removing.
    expect(Array.from(s.Q!)).not.toEqual(Array.from(q0));
    expect(validateState(s).length).toBeGreaterThan(0);
  });
  it("a census taken on the pristine state is unchanged by what the observers do to their view", () => {
    const s = ownerWorld();
    const before = JSON.stringify(ownerCensus(s));
    depositMeasure(observerView(s));
    expect(JSON.stringify(ownerCensus(s))).toBe(before);
    // The failure the advisor named: a census read from the view the observer stepped is a different census.
    const v = observerView(s);
    depositMeasure(v);
    expect(JSON.stringify(ownerCensus(v))).not.toBe(before);
  });
  it("is the state itself when there are no owner planes", () => {
    const s = createWorld(small());
    expect(observerView(s)).toBe(s);
  });
});

describe("column series", () => {
  it("pushes, windows and minima", () => {
    const c = emptyCols(["a", "b"]);
    pushCols(c, 500, { a: 1, b: null }); pushCols(c, 1000, { a: 3, b: 5 }); pushCols(c, 1500, { a: 8, b: 7 });
    expect(colWindow(c, 500, 1500)).toEqual({ a: 5.5, b: 6 });
    expect(colWindow(c, 1500, 2000)).toEqual({ a: null, b: null });
    expect(colMin(c, "a", 0, 1500)).toBe(1); expect(colMin(c, "b", 0, 1500)).toBe(5); expect(colMin(c, "a", 2000, 3000)).toBeNull();
    expect(() => pushCols(c, 1500, { a: 0, b: 0 })).toThrow(/increase/);
    expect(() => pushCols(c, 2000, { a: 0 } as never)).toThrow(/missing/);
  });
});

// ---- sizing rules -----------------------------------------------------------------------------------------------------------

describe("sizing rules R1 to R6", () => {
  it("R1: t0 is the first multiple of 50 whose block means have settled", () => {
    // n = 1000 until step 150 then 700 flat: block means 1000 for t <= 150, 700 from t = 200. Change at t = 150 is 0 (1000 vs 1000), at 200: |m(200) - m(100)| = |850?|
    const flat = (cut: number) => Array.from({ length: 400 }, (_, k) => (k + 1 <= cut ? 1000 : 700));
    const r = settleT0([flat(100), flat(100), flat(100)]);
    // m(150) = mean over (100,150] = 700, m(50) = 1000: 30%; m(200) = 700, m(100) = 1000 (steps 51..100): 30%; m(250) vs m(150): 0 -> t0 250.
    expect(r.t0).toBe(250); expect(r.failed).toBe(false);
    expect(r.changes[0]).toEqual({ t: 150, median: expect.closeTo(0.3, 9) });
    // Never settled: n halves every 50 steps.
    const dec = Array.from({ length: 400 }, (_, k) => 1000 * Math.pow(0.8, Math.floor(k / 50)));
    const f = settleT0([dec]);
    expect(f.failed).toBe(true); expect(f.t0).toBe(400);
    // The median over seeds: two settled seeds outvote one that is not.
    expect(settleT0([flat(100), flat(100), dec]).t0).toBe(250);
  });
  it("R2: v is the smallest per-pattern maximum; the fallback is 16", () => {
    const ok = { rows: { 16: 0.9, 24: 0.8, 32: 0.7, 48: 0.2 }, carpet: { 16: 0.9, 24: 0.6, 32: 0.4, 48: 0.1 } };
    expect(chooseV(ok)).toEqual({ v: 24, fallback: false, perPattern: { rows: 32, carpet: 24 } });
    const bad = { rows: { 16: 0.9, 24: 0.8, 32: 0.7, 48: 0.2 }, carpet: { 16: 0.4, 24: 0.3, 32: 0.2, 48: 0.1 } };
    expect(chooseV(bad)).toMatchObject({ v: 16, fallback: true });
    expect(chooseV({ rows: { 48: 0.5 } }).v).toBe(48);
  });
  it("R3: plateau strengths and the primary window", () => {
    expect([1, 2, 3].map((q) => plateauDd(40, q).ext)).toEqual([15, 31, 47]);
    expect([1, 2, 3].map((q) => plateauDd(40, q).dd)).toEqual([55, 71, 87]);
    expect(plateauDd(40, 1).headroomShare).toBeCloseTo(15 / 88, 12);
    expect(plateauDd(120, 3).dd).toBe(128);
    const reads = [{ step: 10, xMed: 30 }, { step: 100, xMed: 20 }, { step: 300, xMed: 2.5 }, { step: 350, xMed: 1 }, { step: 400, xMed: 0 }];
    expect(aliveAndWindow(reads, 2, 100)).toEqual({ tAlive: 300, pw: [100, 300], len: 200, unreadable: false });
    expect(aliveAndWindow(reads, 1, 100).tAlive).toBe(350);
    expect(aliveAndWindow(reads, 3, 100)).toMatchObject({ tAlive: 100, len: 0, unreadable: true });
    expect(aliveAndWindow(reads, 2, 200)).toMatchObject({ len: 100, unreadable: true });   // under 150 steps
    expect(aliveAndWindow(reads, 40, 0)).toMatchObject({ tAlive: null, pw: null, unreadable: true });
    expect(aliveAndWindow([{ step: 2000, xMed: 5 }], 2, 0).pw).toEqual([0, 1000]);          // capped at 1,000
  });
  it("R4: rising strength is round(493 / v), clamped", () => {
    expect([16, 24, 32, 48].map(gRising)).toEqual([31, 21, 15, 10]);
    expect(gRising(1)).toBe(255);
  });
  it("R5: F strengths from x_med, the ceiling halving, and the no-bite fallback", () => {
    expect(freeStrengths(10)).toEqual({ lo: 24, mid: 48, hi: 96, noBiteLikely: false });
    expect(freeStrengths(0)).toMatchObject({ mid: 1, noBiteLikely: true });
    expect(freeStrengths(null)).toMatchObject({ mid: 1, noBiteLikely: true });
    expect(freeStrengths(1)).toMatchObject({ mid: 255, hi: 255 });
    expect(freeStrengths(480)).toMatchObject({ lo: 1, mid: 1, hi: 2 });
    expect(freeCeiling(64)).toBe(8); expect(freeCeiling(63.9)).toBe(16); expect(freeCeiling(null)).toBe(16);
  });
  it("R6: theta levels and the owner conduit strengths", () => {
    const shares = { 1: 0.9, 2: 0.7, 4: 0.45, 8: 0.2, 16: 0.08, 32: 0.05 };
    expect(thetaR6(shares)).toEqual({ lo: 4, mid: 8, hi: 16, distinct: [4, 8, 16] });
    expect(thetaR6({ 1: 0.2, 2: 0.2 })).toMatchObject({ lo: 1, mid: 1, hi: undefined, distinct: [1] });
    expect(thetaR6({ 1: 0.9 }).distinct).toEqual([]);
    expect(ownerGStrengths(16)).toEqual({ lo: 4, mid: 16, hi: 64 }); expect(ownerGStrengths(100)).toEqual({ lo: 25, mid: 100, hi: 255 }); expect(ownerGStrengths(2).lo).toBe(1);
    // C-pub match: owner headroom 10; the public headroom at g is g * 0.5.
    expect(matchCpub(8, (g) => g * 0.5)).toEqual({ g: 16, ratio: 1, void: false });
    expect(matchCpub(10, (g) => g * 0.5)).toMatchObject({ g: 16, void: true });   // 0.8 and 1.2 are both 20 percent off
  });
});

// ---- labels, every one -------------------------------------------------------------------------------------------------------

describe("T labels", () => {
  const base = { readable: true, payRows: "Y", payCarpet: "Y", dampRows: "N", grad: "Y", payDiffA: "N", mech: true, payD0: "N" } as const;
  it("every label, in order", () => {
    expect(labelT({ ...base, readable: false }).label).toBe("UNREADABLE");
    expect(labelT({ ...base, payRows: "N", payCarpet: "N", dampRows: "N" })).toEqual({ label: "NO-PAY", note: null });
    expect(labelT({ ...base, payRows: "N", payCarpet: "N", dampRows: "I" }).label).toBe("NO-PAY");      // DAMP not Y
    expect(labelT({ ...base, payRows: "N", payCarpet: "N", dampRows: "Y" }).label).toBe("DAMPS-ONLY");
    expect(labelT({ ...base, payRows: "N", payCarpet: "Y" }).label).toBe("CEILING-ONLY");
    expect(labelT({ ...base, payRows: "I" }).label).toBe("INCONCLUSIVE");
    expect(labelT({ ...base, payRows: "N", payCarpet: "I" }).label).toBe("INCONCLUSIVE");
    expect(labelT({ ...base, grad: "N" }).label).toBe("UNIFORM-PUMP");
    expect(labelT({ ...base, payDiffA: "Y" }).label).toBe("UNIFORM-PUMP");
    expect(labelT({ ...base, grad: "N", payDiffA: "I" }).label).toBe("UNIFORM-PUMP");
    expect(labelT({ ...base, grad: "I" }).label).toBe("INCONCLUSIVE");
    expect(labelT({ ...base, payDiffA: "I" }).label).toBe("INCONCLUSIVE");
    expect(labelT({ ...base, mech: false }).label).toBe("PAY-NO-FLUX");
    expect(labelT(base).label).toBe("TRANSIENT");
  });
  it("NO-PAY and DAMPS-ONLY are final only if V(PAY-D0) = N", () => {
    const n = { ...base, payRows: "N", payCarpet: "N" } as const;
    expect(labelT({ ...n, payD0: "N" }).note).toBeNull();
    expect(labelT({ ...n, payD0: "Y" }).note).toMatch(/short-window only/);
    expect(labelT({ ...n, payD0: "I", dampRows: "Y" }).note).toMatch(/short-window only/);
  });
});

describe("D labels", () => {
  const ok = { payD1: "Y", payD2: "Y", persist: "Y", grad: "Y", select: "Y" } as const;
  it("every refinement, first match", () => {
    expect(labelD({ ...ok, payD1: "I" }).label).toBe("INCONCLUSIVE-D");
    expect(labelD({ ...ok, persist: "I" }).label).toBe("INCONCLUSIVE-D");
    expect(labelD({ ...ok, payD1: "N", persist: "Y" }).label).toBe("STARTUP-ONLY");
    expect(labelD({ ...ok, payD1: "N", persist: "N" }).label).toBe("STARTUP-ONLY");
    expect(labelD({ ...ok, persist: "N" }).label).toBe("ROAD-FADES");
    expect(labelD(ok).label).toBe("PAYS-AND-SELECTED");
    expect(labelD({ ...ok, select: "N" }).label).toBe("PAYS-AND-PERSISTS");
    expect(labelD({ ...ok, select: "I" }).label).toBe("PAYS-AND-PERSISTS");
    expect(labelD({ ...ok, payD2: "N" }).label).toBe("PAY-PARTIAL");
    expect(labelD({ ...ok, grad: "N" }).label).toBe("PAY-PARTIAL");
    expect(labelD({ ...ok, payD1: "Y", persist: "Y", payD2: "I" }).label).toBe("PAY-PARTIAL");
  });
});

describe("F labels", () => {
  const n = 8;
  const all = (v: boolean | null) => Array(n).fill(v) as (boolean | null)[];
  const good: FInputs = {
    n, cls: Array(n).fill("K"), a: all(true), aDamp: all(false), b: all(true), c: all(true), d: all(true), H: all(true), G: all(true), fLed: all(false),
    e: true, f: true, anchor: "YES", extras: true,
  };
  const withCls = (c: ("K" | "S" | "NB" | "L")[]): FInputs => ({ ...good, cls: c });
  it("every label, in order", () => {
    expect(labelF(withCls(["NB", "NB", "NB", "NB", "NB", "NB", "S", "L"])).label).toBe("NO-BITE");
    expect(labelF(withCls(["S", "S", "S", "S", "S", "S", "K", "L"])).label).toBe("SUBSIDY-ONLY");
    expect(labelF(withCls(["K", "K", "L", "L", "L", "L", "L", "L"])).label).toBe("PURGED-ABOVE-LAYER");
    expect(labelF(withCls(["K", "K", "K", "K", "L", "L", "L", "L"])).label).toBe("INCONCLUSIVE");
    expect(labelF({ ...good, extras: false })).toMatchObject({ label: "INCOMPLETE" });
    expect(labelF({ ...good, fLed: [true, true, true, true, false, false, false, false] }).label).toBe("SUBSIDY-CARRIED");
    expect(labelF({ ...good, aDamp: all(true), a: all(false) }).label).toBe("KEPT-DAMPS");
    expect(labelF(good).label).toBe("KEPT-AND-PAYS");
    // The anchor must be YES: MIXED and NO-DAMPS drop to the next line.
    expect(labelF({ ...good, anchor: "MIXED" }).label).toBe("KEPT-BY-PRESENCE-ONLY");
    expect(labelF({ ...good, anchor: "NO-DAMPS" }).note).toMatch(/anchor NO-DAMPS/);
    expect(labelF({ ...good, c: all(false), H: all(true), G: all(false) }).label).toBe("KEPT-STATIC-SPONGE");
    expect(labelF({ ...good, c: all(false), H: all(false), G: all(true) }).label).toBe("KEPT-BY-PRESENCE-ONLY");
    expect(labelF({ ...good, e: false }).note).toMatch(/\(e\) dose/);
    expect(labelF({ ...good, f: false }).note).toMatch(/\(f\) controls/);
  });
  it("the joint vote needs one seed passing all of (a)(b)(c)(d)", () => {
    const a = [true, true, true, true, true, true, false, false], b = [false, false, true, true, true, true, true, true];
    expect(labelF({ ...good, a, b }).label).toBe("KEPT-BY-PRESENCE-ONLY");   // 6 of 8 each, only 4 jointly
  });
  it("K classes: kept above the layer, subsidy-only, no bite, lost", () => {
    const run = (above: number, tm: number): RunFile => ({ late: { boot: { tmAbove: above, tm }, conduit: {}, r4: null, runValues: {} } } as unknown as RunFile);
    expect(keptClass(run(0.5, 1), run(0.1, 0.5))).toBe("K");
    expect(keptClass(run(0.5, 1), run(0.4, 0.5))).toBe("S");   // free-only keeps more than half as much above the layer
    expect(keptClass(run(0.05, 0.05), run(0, 0.02))).toBe("NB");
    expect(keptClass(run(0.05, 0.05), run(0, 0.5))).toBe("L");
  });
});

describe("O labels", () => {
  const n = 8;
  const all = (v: boolean | null) => Array(n).fill(v) as (boolean | null)[];
  const good: OInputs = {
    n, e: all(true), kEC: Array(n).fill(true), kE: Array(n).fill(false), payECvsCoff: "Y", payAll: "Y", harmOrDamp: false,
    b: all(true), c: all(true), d: all(true), H: all(true), G: all(true), f: true, g: true, payCpub: "N", stopRule: false, extras: true,
  };
  it("every label, in order", () => {
    expect(labelO({ ...good, stopRule: true }).label).toBe("INCOMPLETE");
    expect(labelO({ ...good, e: [false, false, false, false, false, false, true, true] }).label).toBe("TERRITORY-COLLAPSE");
    expect(labelO({ ...good, kEC: [true, true, false, false, false, false, false, false] }).label).toBe("PURGED");
    expect(labelO({ ...good, kEC: [true, true, true, true, false, false, false, false] }).label).toBe("INCONCLUSIVE");
    expect(labelO({ ...good, extras: false }).label).toBe("INCOMPLETE");
    expect(labelO({ ...good, kE: Array(n).fill(true), payECvsCoff: "N" }).label).toBe("ENCLOSURE-ONLY");
    expect(labelO({ ...good, payAll: "N", harmOrDamp: true }).label).toBe("KEPT-UNPAID");
    expect(labelO({ ...good, payAll: "N", harmOrDamp: false }).label).toBe("KEPT-BY-PRESENCE-ONLY");
    expect(labelO({ ...good, c: all(false), H: all(true), G: all(false) }).label).toBe("OWNER-STATIC-SPONGE");
    expect(labelO(good)).toEqual({ label: "KEPT-AND-USED", note: null });
    expect(labelO({ ...good, payCpub: "Y" })).toEqual({ label: "KEPT-AND-USED", note: "OWNER-SPECIFIC" });
    expect(labelO({ ...good, c: all(false), H: all(false), G: all(true) }).label).toBe("CONDUIT-PAYS-NOT-USED");
    expect(labelO({ ...good, g: false }).label).toBe("KEPT-BY-PRESENCE-ONLY");           // a void C-pub control can never satisfy (g)
    expect(labelO({ ...good, g: false }).note).toMatch(/\(g\)/);
    expect(labelO({ ...good, f: false }).note).toMatch(/\(f\)/);
  });
  it("no-toll substrate: BOOTSTRAPS or FLOOR", () => {
    expect(noTollLabel(Array(8).fill(true), true)).toBe("BOOTSTRAPS");
    expect(noTollLabel(Array(8).fill(true), false)).toBe("FLOOR");
    expect(noTollLabel([true, true, true, true, true, false, false, false], true)).toBe("FLOOR");
  });
});

// ---- arms, seeds, audit --------------------------------------------------------------------------------------------------------

describe("arms and run counts match the design", () => {
  const sz = PROVISIONAL;
  const count = (series: string, o: { extras?: boolean } = {}) => expandRuns(series, sz, BOOT_BASE, o).length;
  it("run counts", () => {
    expect(count("T")).toBe(208);
    expect(count("D0")).toBe(24);
    expect(count("D")).toBe(88);
    expect(count("B")).toBe(32);
    expect(count("F")).toBe(88);
    expect(count("F", { extras: true })).toBe(88 + 64);
    expect(count("O")).toBe(80);
    expect(count("O", { extras: true })).toBe(80 + 88);
    expect(count("S2")).toBe(40);
    expect(armsOf("T", sz).length).toBe(26);
  });
  it("every run config validates, ids are unique, seeds are table rows, and arms of a heredity share a world seed per slot", () => {
    const rows = new Set(allSeeds(BOOT_BASE).filter((x) => !x.derived).map((x) => x.seed));
    for (const series of ["S1", "S2", "S2d", "S3", "S4", "T", "D0", "D", "B", "F", "O", "R7"]) {
      const runs = expandRuns(series, sz, BOOT_BASE, { held: true, extras: true });
      expect(new Set(runs.map((r) => r.runId)).size).toBe(runs.length);
      for (const r of runs) {
        expect(validateConfig(specConfig(r)), r.runId).toEqual([]);
        expect(rows.has(r.seed), r.runId).toBe(true);
        expect(specConfig(r).seed).toBe(worldSeed(r.slot, r.hered1));
      }
    }
  });
  it("the T design: butterflies only on off-twins, the diffA twin, and the unlaid base0 arms", () => {
    const arms = armsOf("T", sz);
    for (const a of arms.filter((x) => x.butterfly)) { expect(a.over.trailConduit).toBeUndefined(); expect(a.over.trailInit).toBe(sz.v); }
    expect(arms.filter((x) => x.butterfly).map((x) => x.id)).toEqual(["carpet-U.bf", "carpet-G.bf", "rows-G.bf", "cols-G.bf"]);
    expect(arms.find((x) => x.id === "rows-G.diffA")!.over.diffA).toBe(sz.diffA);
    expect(arms.filter((x) => x.role === "base0").every((x) => x.over.trailInit === undefined)).toBe(true);
    expect(arms.find((x) => x.id === "phys-rows-G.on-P2")!.hered).toEqual(["physarum"]);
    const rowsOn = arms.find((x) => x.id === "rows-G.on-P2")!;
    expect(rowsOn.over).toMatchObject({ trailInit: 32, trailInitPattern: "rows", trailInitPitch: 8, trailConduit: 255, trailConduitCap: 2 });
    expect(arms.find((x) => x.id === "pat-G.on-P2")!.over.trailInitPitch).toBe(16);
    expect(arms.find((x) => x.id === "carpet-G.on-P2")!.over.trailInitPitch).toBeUndefined();
    // D arms are durable (pDecay 66) and B adds the free layer on the D slots.
    expect(armsOf("D", sz).every((x) => x.over.pDecay === 66)).toBe(true);
    expect(armsOf("B", sz).every((x) => x.over.trailFreeLayer === sz.Fstar && x.slotSeries === "D")).toBe(true);
  });
  it("every new key stays out of defaultConfig and a keyless arm's config", () => {
    const keyless = specConfig(expandRuns("F", sz, BOOT_BASE).find((r) => r.id === "base")!);
    for (const k of ["trailInit", "trailFreeLayer", "trailOwner", "ownerDefend", "ownerConduit", "trailConduitGhost"]) { expect(k in keyless).toBe(false); expect(k in defaultConfig()).toBe(false); }
    expect(runConfig({}, "U", "inherit", 1)).toEqual(defaultConfig({ heredity: "inherit", seed: 1 }));
  });
});

describe("branch variants", () => {
  const sz = PROVISIONAL;
  const big = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ founders: 64, maxParticles: 256, ...over });
  it("each variant changes exactly what it says and validates", () => {
    const s = createWorld(big({ trailFreeLayer: 16, trailConduit: 30 }));
    const v = (name: string) => variantState(s, name, sz);
    expect(v("on")!.state.config).toEqual(s.config);
    expect(v("noconduit")!.state.config.trailConduit).toBeUndefined();
    expect(v("ghost")!.state.config.trailConduitGhost).toBe(64);
    const nofree = v("nofree")!.state;
    expect(nofree.config.trailFreeLayer).toBeUndefined(); expect(nofree.config.trailConduit).toBe(30);
    expect("freeUnits" in nofree.totals).toBe(false); expect("freeUnits" in s.totals).toBe(true);   // the source state is not edited
    expect(v("nullA")!.state.config.seed).toBe(nullSeedA(s.config.seed)); expect(v("nullB")!.state.config.seed).toBe(nullSeedB(s.config.seed));
    expect(v("coff")).toBeNull(); expect(v("cpub")).toBeNull();
    expect(() => v("bogus")).toThrow(/unknown branch variant/);
    expect(v("nullA")!.state.step).toBe(s.step);
    // A ghost world has no ghost variant, a world with no conduit has no conduit-off.
    const g = createWorld(big({ trailFreeLayer: 16, trailConduit: 30, trailConduitGhost: 9 }));
    expect(variantState(g, "ghost", sz)).toBeNull();
    expect(variantState(createWorld(big()), "noconduit", sz)).toBeNull();
    expect(variantState(createWorld(big()), "nofree", sz)).toBeNull();
  });
  it("owner variants", () => {
    const s = createWorld(big({ trailOwner: "gid", ownerDefend: 8, ownerConduit: 16, ownerGhost: 4 }));
    expect(variantState(s, "coff", sz)!.state.config.ownerConduit).toBe(0);
    expect(variantState(s, "eoff", sz)!.state.config.ownerDefend).toBeUndefined();
    const both = variantState(s, "both", sz)!.state.config;
    expect(both.ownerConduit).toBe(0); expect(both.ownerDefend).toBeUndefined(); expect(both.trailOwner).toBe("gid");
    const cp = variantState(s, "cpub", sz)!.state.config;
    expect(cp.ownerConduit).toBeUndefined(); expect(cp.ownerGhost).toBeUndefined(); expect(cp.trailConduit).toBe(sz.gCpub); expect(cp.ownerDefend).toBe(8);
    expect(variantState(s, "oghost", sz)).toBeNull();   // already has a ghost
    const r = variantState(s, "relax-coff", sz)!;
    expect(r.len).toBe(5000); expect(r.state.config.ownerConduit).toBe(0);
  });
});

describe("seed table and audit", () => {
  const clean: RegisteredSet[] = [{ name: "empty", seeds: [] }, { name: "far", seeds: [1, 2, 3] }];
  it("the table has the stated blocks, a screen and a held half, and one slot each", () => {
    const rows = tableRows(8209);
    expect(rows.length).toBe(TABLE_SIZE); expect(TABLE_SIZE).toBe(76);
    expect(slotsOf(8209, "S", "all")).toEqual([8209, 8210, 8211, 8212, 8213, 8214, 8215, 8216]);
    expect(slotsOf(8209, "T", "screen")).toEqual([8217, 8218, 8219, 8220, 8221, 8222, 8223, 8224]);
    expect(slotsOf(8209, "T", "held")[0]).toBe(8225);
    expect(slotsOf(8209, "O", "all").at(-1)).toBe(8280);
    expect(slotsOf(8209, "SMOKE", "smoke")).toEqual([8281, 8282, 8283, 8284]);
    expect(new Set(rows.map((r) => r.slot)).size).toBe(76);
    expect(worldSeed(8217, "physarum")).toBe(8617);
    expect(allSeeds(8209).length).toBe(76 * 4 * 3);
  });
  it("a clean table audits clean", () => {
    const r = auditTable(8209, clean, { bootLogSeeds: [8217, 8417, 8617] });
    expect(r.problems).toEqual([]);
    expect(r.report.join("\n")).toMatch(/0 world and 0 derived collisions/);
  });
  it("rejects a world seed collision, a derived seed collision and a collision in a range", () => {
    expect(auditTable(8209, [{ name: "reg", seeds: [8417] }]).problems.join()).toMatch(/reg: 8417/);
    const d = nullSeedA(8217);
    expect(auditTable(8209, [{ name: "reg", seeds: [d] }]).problems.join()).toMatch(/nullA/);
    expect(auditTable(8209, [{ name: "scratch", range: [8400, 8500] }]).problems.length).toBe(1);
    expect(auditTable(8209, [{ name: "scratch", range: [100000, 200000] }]).problems).toEqual([]);
  });
  it("rejects stray bootstrap-log seeds, run.ts refusals and a seed at or above 9001", () => {
    expect(auditTable(8209, clean, { bootLogSeeds: [8217, 12345] }).problems.join()).toMatch(/not table rows: 12345/);
    expect(auditTable(8209, clean, { refuse: (s) => (s === 8230 ? "embargoed" : null) }).problems.join()).toMatch(/refuse: 8230/);
    // A base high enough to push images to 9001 or more.
    expect(auditTable(8400, clean).problems.join()).toMatch(/not below 9001/);
  });
  it("a table whose images overlap each other is impossible by the 200-slot span rule", () => {
    expect(auditTable(8209, clean).report.join()).toMatch(/span 76/);
    expect(HEREDITIES.length).toBe(4);
  });
  it("propose returns the first clean candidate and skips a colliding one", () => {
    expect(proposeBase(BASE_CANDIDATES, clean).base).toBe(8209);
    const hit: RegisteredSet[] = [{ name: "hit", seeds: [worldSeed(8250, "inherit")] }];
    const r = proposeBase(BASE_CANDIDATES, hit);
    expect(r.base).toBe(7209); expect(r.tried[0]).toEqual({ base: 8209, problems: 1 });
    expect(proposeBase([8209], hit).base).toBeNull();
  });
  it("derived null seeds are distinct from every world seed and inside the u32 seed range", () => {
    const all = allSeeds(8209);
    const w = new Set(all.filter((x) => !x.derived).map((x) => x.seed));
    for (const d of all.filter((x) => x.derived)) { expect(w.has(d.seed)).toBe(false); expect(d.seed).toBeGreaterThanOrEqual(0); expect(d.seed).toBeLessThanOrEqual(0xffffffff); }
  });
  it("the leaf module owns every slot: no other bootstrap source holds a slot literal", () => {
    const dir = new URL("../mycelium/", import.meta.url).pathname;
    const files = readdirSync(dir).filter((f) => f.startsWith("bootstrap-") && f.endsWith(".ts") && f !== "bootstrap-seeds.ts").concat(["observe-bootstrap.ts"]);
    for (const f of files) expect(readFileSync(dir + f, "utf8"), f).not.toMatch(/\b8[2-8][0-9]{2}\b/);
    expect(readFileSync(dir + "bootstrap-seeds.ts", "utf8")).not.toMatch(/^import /m);   // no imports: a leaf
  });
});

// ---- analysis on synthetic run files ---------------------------------------------------------------------------------------------

/** A run file whose cumulative totals follow constant rates: population n, births, deaths and intake per step. */
function mkRun(series: string, armId: string, slot: number, r: { n?: number; b?: number; d?: number; i?: number; flux?: number; road?: number; heredity?: string; steps?: number }): RunFile {
  const steps = r.steps ?? 3000, n = r.n ?? 1000, b = r.b ?? 0.01, d = r.d ?? 0.01, i = r.i ?? 2;
  const reads = [0, ...Array.from({ length: 400 }, (_, k) => k + 1), ...Array.from({ length: (steps - 400) / 50 }, (_, k) => 450 + 50 * k)];
  const snaps: Snap[] = reads.map((t) => ({ step: t, n, births: Math.round(b * n * t), deaths: Math.round(d * n * t), lightIn: 4 * 10 * t, sumA: 1_000_000 + 10 * t - Math.round(i * t), sumP: 0 }));
  const road = emptyCols(["laidA8", "desert", "xMed", "xGe1", "xGe2", "xGe3", "onLaid", "road", "meanDd1", "meanDd2", "meanDd3", "xflux", "n"]);
  for (const t of reads.filter((x) => x > 0 && x % 50 === 0)) pushCols(road, t, { laidA8: 1, desert: 0, xMed: 5, xGe1: 1, xGe2: 1, xGe3: 1, onLaid: 0.3, road: r.road ?? 0, meanDd1: 40, meanDd2: 41, meanDd3: 42, xflux: r.flux ?? 0, n });
  return {
    id: `${series}.${armId}.${r.heredity ?? "inherit"}.${slot}`, series, armId, heredity: r.heredity ?? "inherit", slot, worldSeed: slot, steps,
    config: { eA: 4, diffA: 40 }, ledgerChecks: 30, ledgerBadChecks: 0, minN: n, snaps, telescope: null, roadSeries: road, bootSeries: emptyCols(["tm"]),
    late: { runValues: {}, r4: null, conduit: {}, boot: {} }, branches: [],
  };
}
const fakeSz: Sizing = { ...PROVISIONAL, provisional: false, t0: 200, tAlive: { 1: 450, 2: 450, 3: 450 } };

describe("analyzeT on synthetic runs", () => {
  /** Intake rates are per step per 1000 particles scaled so the window intake is a known multiple. */
  const build = (rowsOn: number, colsOn: number, carpetOn: number, diffA: number, fluxRows: number, fluxCols: number, slots = 8) => {
    const rows: RunFile[] = [];
    for (let s = 1; s <= slots; s++) {
      const off = { i: 100 };
      const mk = (arm: string, v: Partial<Parameters<typeof mkRun>[3]>) => rows.push(mkRun("T", arm, s, { ...off, ...v }));
      mk("rows-G.on-P1", { i: rowsOn }); mk("rows-G.on-P2", { i: rowsOn, flux: fluxRows, road: 0.1 }); mk("rows-G.on-P3", { i: rowsOn }); mk("rows-G.on-R", { i: rowsOn });
      mk("rows-G.off", { road: 0 }); mk("rows-G.bf", {}); mk("rows-G.diffA", { i: diffA });
      mk("cols-G.on-P2", { i: colsOn, flux: fluxCols }); mk("cols-G.off", {}); mk("cols-G.bf", {});
      mk("carpet-G.on-P2", { i: carpetOn }); mk("carpet-G.off", {}); mk("carpet-G.bf", {});
      mk("carpet-U.on-P2", { i: 100 }); mk("carpet-U.off", {}); mk("carpet-U.bf", {});
      mk("lat-G.on-P2", { i: 100 }); mk("lat-G.off", {}); mk("pat-G.on-P2", { i: 100 }); mk("pat-G.off", {});
      mk("phys-rows-G.on-P2", { i: 100, heredity: "physarum" }); mk("phys-rows-G.off", { heredity: "physarum" });
    }
    return rows;
  };
  it("a road that pays only along the gradient reads TRANSIENT", () => {
    const rep = analyzeT(build(130, 100, 100, 100, 5, -1), fakeSz, null);
    expect(rep.inputs).toMatchObject({ readable: true, payRows: "Y", payCarpet: "N", grad: "Y", payDiffA: "N", mech: true, dampRows: "N" });
    expect(rep.label!.label).toBe("TRANSIENT");
    expect(rep.perStrength.P2.pw).toEqual([200, 450]);
  });
  it("review round 2: a diffA twin more than 15 percent from the realised on-twin Dd is void, so the label cannot be TRANSIENT", () => {
    const withTwin = (diffA: number) => build(130, 100, 100, 100, 5, -1).map((r) => (r.armId === "rows-G.diffA" ? { ...r, config: { ...r.config, diffA } } : r));
    expect(analyzeT(withTwin(40), fakeSz, null).label!.label).toBe("TRANSIENT");           // realised on-twin mean Dd 41: 2.4 percent off
    expect(analyzeT(withTwin(36), fakeSz, null).label!.label).toBe("TRANSIENT");           // 12 percent: inside
    const void_ = analyzeT(withTwin(34), fakeSz, null);                                    // 17 percent: void
    expect(void_.inputs!.payDiffA).toBe("I");
    expect(void_.label!.label).toBe("INCONCLUSIVE");
    expect(void_.lines.join("\n")).toMatch(/TWIN VOID/);
    // No realised-Dd reading at all (no road series) is unverified, never a pass.
    const noRoad = build(130, 100, 100, 100, 5, -1).map((r) => (r.armId === "rows-G.on-P2" ? { ...r, roadSeries: null } : r));
    expect(analyzeT(noRoad, fakeSz, null).inputs!.payDiffA).toBe("I");
  });
  it("Astra P2: a missing cols flux does not satisfy MECH, and an unreadable butterfly twin leaves the noise floor unresolved", () => {
    const noColsFlux = build(130, 100, 100, 100, 5, -1).map((r) => (r.armId === "cols-G.on-P2" ? { ...r, roadSeries: null } : r));
    expect(analyzeT(noColsFlux, fakeSz, null).inputs!.mech).toBe(false);                     // old code: true (fCols === null accepted)
    // One rows-G butterfly twin stops before the window: its slot has no twin reading, so no verdict rests on the other seven.
    const shortTwin = build(130, 100, 100, 100, 5, -1).map((r) => (r.armId === "rows-G.bf" && r.slot === 8 ? { ...r, snaps: r.snaps.filter((x) => x.step < 300) } : r));
    expect(analyzeT(shortTwin, fakeSz, null).inputs!.payRows).not.toBe("Y");                 // old code: Y from 7 twins
  });
  it("the same gain on the orthogonal columns is a uniform pump, not a network", () => {
    expect(analyzeT(build(130, 130, 100, 100, 5, 5), fakeSz, null).label!.label).toBe("UNIFORM-PUMP");
  });
  it("a gain the diffusion twin reproduces is a uniform pump; no gain anywhere is NO-PAY", () => {
    expect(analyzeT(build(130, 100, 100, 130, 5, -1), fakeSz, null).label!.label).toBe("UNIFORM-PUMP");
    const none = analyzeT(build(100, 100, 100, 100, 0, 0), fakeSz, null);
    expect(none.label!.label).toBe("NO-PAY");
    expect(none.label!.note).toMatch(/short-window only/);            // D0 not run: not final
    expect(analyzeT(build(100, 100, 100, 100, 0, 0), fakeSz, "N").label!.note).toBeNull();
  });
  it("rows that pay without flux are PAY-NO-FLUX, and a pay only at the carpet ceiling is CEILING-ONLY", () => {
    expect(analyzeT(build(130, 100, 100, 100, 0, 0), fakeSz, null).label!.label).toBe("PAY-NO-FLUX");
    expect(analyzeT(build(100, 100, 130, 100, 0, 0), fakeSz, null).label!.label).toBe("CEILING-ONLY");
  });
  it("a window shorter than 150 steps is UNREADABLE and says so", () => {
    const rep = analyzeT(build(130, 100, 100, 100, 5, -1), { ...fakeSz, tAlive: { 1: 300, 2: 300, 3: 300 } }, null);
    expect(rep.perStrength.P2.unreadable).toBe(true);
    expect(rep.label!.label).toBe("UNREADABLE");
  });
  it("D0 votes on (t0, t0 + 2000] with the butterfly noise floor", () => {
    const rows: RunFile[] = [];
    for (let s = 1; s <= 8; s++) for (const [arm, i] of [["rows-G.on-P2", 125], ["rows-G.off", 100], ["rows-G.bf", 100]] as const) rows.push(mkRun("D0", arm, s, { i, steps: 3000 }));
    expect(analyzeD0(rows, fakeSz).vote).toBe("Y");
    expect(analyzeD0([], fakeSz).vote).toBe("I");
  });
});

describe("branchPairs", () => {
  const side = (sumEnd: number, births: number): { snaps: Snap[]; ledgerBad: number; nEnd: number } => ({
    snaps: [0, 25, 50, 75, 100].map((t) => ({ step: t * 20, n: 100, births: Math.round((births * t) / 100), deaths: Math.round((20 * t) / 100), lightIn: 0, sumA: 1000 - Math.round(((1000 - sumEnd) * t) / 100), sumP: 0 })),
    ledgerBad: 0, nEnd: 100,
  });
  const b = (variant: ReturnType<typeof side>): BranchFile => ({ at: 100, len: 2000, variants: { on: side(880, 40), nullA: side(880, 40), nullB: side(880, 40), noconduit: variant } });
  it("PAY when on gains intake over the variant with equal births and deaths", () => {
    const p = branchPairs(b(side(900, 40)), 4).find((x) => x.variant === "noconduit")!;
    expect(p.relWhole!.i).toBeCloseTo(120 / 100 - 1, 12);   // intake 120 against 100
    expect(p.whole.thrI).toBe(0.03); expect(p.whole.pay).toBe(true); expect(p.last.pay).toBe(true);
    expect(p.whole.unresolved).toBeNull();
  });
  it("DAMP when the variant has more births and deaths and no intake gain; HARM is not set at equal population", () => {
    const v = side(880, 52);
    v.snaps = v.snaps.map((s) => ({ ...s, deaths: Math.round((s.deaths * 1.3)) }));
    const p = branchPairs(b(v), 4).find((x) => x.variant === "noconduit")!;
    expect(p.whole.damp).toBe(true); expect(p.whole.pay).toBe(false); expect(p.whole.harm).toBe(false);
  });
  it("a missing null run leaves the pair unresolved, not false", () => {
    const f = b(side(900, 40)); delete f.variants.nullB;
    const p = branchPairs(f, 4)[0];
    expect(p.whole.pay).toBeNull(); expect(p.whole.unresolved).toMatch(/missing/);
  });
});

describe("sizeFromS on synthetic S runs", () => {
  it("reads t0, v, t_alive and the diffA match from S1 and S2 rows", () => {
    const rows: RunFile[] = [];
    // S1: n settles at step 200 (1000 -> 700 at step 100).
    for (const light of ["U", "G"]) for (let s = 1; s <= 4; s++) {
      const r = mkRun("S1", `base0-${light}`, s, { steps: 1000 });
      r.snaps = r.snaps.map((x) => ({ ...x, n: x.step <= 100 ? 1000 : 700 }));
      rows.push(r);
    }
    // S2: laid-A share at step 10: carpet fails above v 24; rows xMed decays 40 -> 0 over the reads.
    const sh: Record<string, Record<number, number>> = { rows: { 16: 1, 24: 1, 32: 1, 48: 0.2 }, carpet: { 16: 1, 24: 0.9, 32: 0.3, 48: 0.1 }, cols: { 16: 1, 24: 1, 32: 1, 48: 1 }, lattice: { 16: 1, 24: 1, 32: 1, 48: 1 }, patches: { 16: 1, 24: 1, 32: 1, 48: 1 } };
    for (const [p, byV] of Object.entries(sh)) for (const [v, share] of Object.entries(byV)) for (let s = 1; s <= 2; s++) {
      const r = mkRun("S2", `${p}-v${v}`, s, { steps: 1000 });
      const road = emptyCols(["laidA8", "desert", "xMed", "xGe1", "xGe2", "xGe3", "onLaid", "road", "meanDd1", "meanDd2", "meanDd3", "xflux", "n"]);
      for (const t of [10, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500]) pushCols(road, t, { laidA8: t === 10 ? share : 1, desert: 0, xMed: Math.max(0, 40 - t / 10), xGe1: 1, xGe2: 1, xGe3: 1, onLaid: 0, road: 0, meanDd1: 50, meanDd2: 60, meanDd3: 70, xflux: 0, n: 900 });
      r.roadSeries = road;
      rows.push(r);
    }
    const z = sizeFromS(rows);
    expect(z.sizing.v).toBe(24);          // carpet binds: v = min(32 rows, 24 carpet, 48 others)
    expect(z.sizing.gR).toBe(21);
    expect(z.sizing.t0).toBe(250);
    // x_e(t) = 40 - t / 10: at least 1 until t = 390 (read 350), at least 2 until 380 (read 350), at least 3 until 370 (read 350).
    expect(z.sizing.tAlive).toEqual({ 1: 350, 2: 350, 3: 350 });
    expect(z.sizing.diffA).toBe(60);
    expect((z.sizing.measured as string[]).sort()).toEqual(["diffA", "gR", "t0", "tAlive", "v"]);
        expect(sizeFromS([]).lines.join()).toMatch(/no S1 runs/);
  });
});

describe("fail-closed labels", () => {
  const sz8 = fakeSz;
  it("one seed gets no T label", () => {
    const rows: RunFile[] = [];
    for (const [arm, i] of [["rows-G.on-P2", 130], ["rows-G.off", 100], ["rows-G.bf", 100], ["rows-G.diffA", 100], ["cols-G.on-P2", 100], ["cols-G.off", 100], ["cols-G.bf", 100], ["carpet-G.on-P2", 100], ["carpet-G.off", 100], ["carpet-G.bf", 100]] as const) rows.push(mkRun("T", arm, 1, { i, flux: 5 }));
    const rep = analyzeT(rows, sz8, null);
    expect(rep.label!.label).toBe("INCOMPLETE");
    expect(rep.label!.note).toMatch(/cohort of 1 seeds/);
  });
  it("a missing control twin gets no T label", () => {
    const rows: RunFile[] = [];
    for (let s = 1; s <= 8; s++) for (const [arm, i] of [["rows-G.on-P2", 130], ["rows-G.off", 100], ["rows-G.bf", 100], ["cols-G.on-P2", 100], ["cols-G.off", 100], ["cols-G.bf", 100], ["carpet-G.on-P2", 100], ["carpet-G.off", 100], ["carpet-G.bf", 100]] as const) rows.push(mkRun("T", arm, s, { i, flux: 5 }));
    const rep = analyzeT(rows, sz8, null);   // no rows-G.diffA
    expect(rep.label!.label).toBe("INCOMPLETE");
    expect(rep.label!.note).toMatch(/diffA-matched twin missing/);
  });
  it("F needs the FREE-ONLY control for every slot, and a full cohort", () => {
    const mkF = (arm: string, slot: number, h = "inherit"): RunFile => {
      const r = mkRun("F", arm, slot, { steps: 1000, heredity: h });
      r.late = { runValues: {}, r4: { speed: 0.1 }, conduit: { csat: 0.1 }, boot: { tmAbove: 0.5, tm: 1 } };
      return r;
    };
    const rows: RunFile[] = [];
    for (let s = 1; s <= 8; s++) rows.push(mkF("T-16-mid", s), mkF("T-16-mid", s, "blocked"), mkF("GHOST", s), mkF("DIFF", s));   // no FREE-16
    const rep = analyzeF(rows, { ...fakeSz, Fstar: 16 }, );
    expect(rep.label!.label).toBe("INCOMPLETE");
    expect(rep.label!.note).toMatch(/FREE-ONLY missing/);
    expect(analyzeF(rows.filter((r) => r.slot <= 3), { ...fakeSz, Fstar: 16 }).label!.note).toMatch(/cohort of 3 seeds/);
  });
  it("D's SELECT is unresolved without the blocked arms and Y only when deposit lift, K and the blocked no-lift all hold", () => {
    const mkD = (arm: string, slot: number, d: number, tm: number, h = "inherit"): RunFile => {
      const r = mkRun("D", arm, slot, { steps: 3000, heredity: h });
      r.late = { runValues: { d, TM: tm }, r4: null, conduit: {}, boot: {} };
      return r;
    };
    const build = (withBlocked: boolean, blockedLift: boolean): RunFile[] => {
      const rows: RunFile[] = [];
      for (let s = 1; s <= 8; s++) {
        rows.push(mkD("rows-G.on-P2", s, 2, 0.5), mkD("rows-G.off", s, 1, 0.01), mkD("rows-G.bf", s, 1, 0.01), mkD("cols-G.on-R", s, 1, 0.01), mkD("cols-G.off", s, 1, 0.01), mkD("base-G", s, 1, 0.01));
        if (withBlocked) rows.push(mkD("rows-G.on-R", s, blockedLift ? 2 : 1, 0.01, "blocked"), mkD("rows-G.off", s, 1, 0.01, "blocked"));
      }
      return rows;
    };
    expect(analyzeD(build(true, false), fakeSz).inputs!.select).toBe("Y");
    expect(analyzeD(build(true, true), fakeSz).inputs!.select).toBe("N");      // the blocked arm lifts too: survival, not selection
    expect(analyzeD(build(false, false), fakeSz).inputs!.select).toBe("I");    // no blocked arm: never Y
    const unreadCtl = build(true, false).map((r) => (r.armId === "rows-G.off" || r.armId === "base-G" ? { ...r, late: { ...r.late, runValues: { ...r.late.runValues, TM: null } } } : r));
    expect(analyzeD(unreadCtl, fakeSz).inputs!.select).toBe("N");              // an unread control counts as K there: never helps SELECT (old code read null as 0 and said Y)
    const noK = build(true, false).map((r) => (r.armId === "rows-G.on-P2" ? { ...r, late: { ...r.late, runValues: { d: 2, TM: 0.01 } } } : r));
    expect(analyzeD(noK, fakeSz).inputs!.select).toBe("N");                    // no kept trail: not selected
  });
});

describe("sizing from the pilots, and the gates", () => {
  const withLate = (series: string, arm: string, slot: number, late: Partial<RunFile["late"]>): RunFile => {
    const r = mkRun(series, arm, slot, { steps: 1000 });
    r.late = { runValues: {}, r4: null, conduit: {}, boot: {}, ...late } as RunFile["late"];
    return r;
  };
  it("R5 and R6 and the F diffA are assembled from S3 and S4 runs", () => {
    const rows: RunFile[] = [];
    for (let s = 1; s <= 4; s++) {   // S3 runs 2 seeds and S4 runs 4: a rule reads a pilot only when every seed of it is there
      rows.push(withLate("S3", "free16", s, { conduit: { pcP50: 20 }, boot: { xMedOcc: 10 } }));
      rows.push(withLate("S3", "T-16-mid", s, { boot: { meanEdge: 47.4 } }));
      const def: Record<string, number> = {}; const shares = [0.9, 0.7, 0.45, 0.2, 0.08, 0.05, 0.02, 0.01, 0];
      DEF_THETAS.forEach((th, k) => { def[`def${th}`] = shares[k]; });
      rows.push(withLate("S4", "pass-toll-gid", s, { boot: { ownedOccupied: 0.8, ...def } }));
    }
    const z = sizeFromS(rows);
    expect(z.sizing).toMatchObject({ Fstar: 16, Fg: { lo: 24, mid: 48, hi: 96 }, diffAF: 47, theta: { lo: 4, mid: 8, hi: 16 } });
    expect((z.sizing.measured as string[]).sort()).toEqual(["Fg", "Fstar", "diffAF", "theta"]);
    expect(z.sizing.ownerStopRule).toBeUndefined();
    // A carpet FREE-ONLY(16) halves the ceiling; few owned cells fire the stop rule.
    const carpet = rows.map((r) => (r.armId === "free16" ? withLate("S3", "free16", r.slot, { conduit: { pcP50: 70 }, boot: { xMedOcc: 10 } }) : r.armId === "pass-toll-gid" ? withLate("S4", "pass-toll-gid", r.slot, { boot: { ownedOccupied: 0.3, def1: 0.9 } }) : r));
    const z2 = sizeFromS(carpet);
    expect(z2.sizing.Fstar).toBe(8); expect(z2.sizing.ownerStopRule).toBe(true);
  });
  it("a real run is refused unless the sizing measured every field its arms are built from", () => {
    const rows = (series: string) => expandRuns(series, PROVISIONAL, BOOT_BASE);
    expect(unmeasuredNeeds(PROVISIONAL, rows("S1"))).toEqual([]);
    expect(unmeasuredNeeds(PROVISIONAL, rows("S4"))).toEqual([]);
    expect(unmeasuredNeeds(PROVISIONAL, rows("S3")).sort()).toEqual(["Fg"]);       // the treated pilot arm needs the sized strength; FREE-ONLY does not
    expect(unmeasuredNeeds(PROVISIONAL, rows("T")).sort()).toEqual(["diffA", "gR", "t0", "tAlive", "v"]);
    expect(unmeasuredNeeds({ ...PROVISIONAL, measured: ["v", "gR", "diffA", "t0", "tAlive"] }, rows("T"))).toEqual([]);
    expect(unmeasuredNeeds({ ...PROVISIONAL, measured: ["v", "gR", "diffA", "t0", "tAlive"] }, rows("O")).sort()).toEqual(["gCpub", "gOwner", "theta"]);
    expect(armNeeds("F", "base")).toEqual(["Fstar", "Fg", "diffAF"]);
    expect(SIZING_FIELDS.length).toBe(11);
  });
  it("the read schedule includes every window edge", () => {
    const dense = schedule("dense", 3000, [276, 3000]);
    expect(dense.slice(0, 5)).toEqual([1, 2, 3, 4, 5]); expect(dense).toContain(400); expect(dense).toContain(450); expect(dense).toContain(276); expect(dense.at(-1)).toBe(3000);
    const std = schedule("std", 50_000, [250, 2000, 2250, 5000, 10_000]);
    expect(std).toContain(250); expect(std).toContain(2250); expect(std).toContain(100); expect(std.filter((x) => x % 100 !== 0).sort((a, b) => a - b)).toEqual([250, 2250]);
    expect(schedule("road", 1000, []).slice(0, 3)).toEqual([10, 50, 100]);
    expect(schedule("std", 2000, [5000])).not.toContain(5000);   // beyond the run
  });
  it("xMedOccupied and the stored column keys", () => {
    const s = createWorld(small({ founders: 3, maxParticles: 16 }));
    s.P.fill(0);
    put(s, 0, 5, 5); put(s, 1, 6, 5); put(s, 2, 30, 30);
    s.P[cell(5, 5)] = 12; s.P[cell(6, 5)] = 20;
    // Occupied neighbours: (5,5)-(6,5) only, two directed edges, both min(12, 20) = 12.
    expect(xMedOccupied(s)).toBe(12);
    s.P[cell(6, 5)] = 4;
    expect(xMedOccupied(s)).toBe(4);
    put(s, 1, 40, 40);
    expect(xMedOccupied(s)).toBeNull();
    expect(BOOT_KEYS).toContain("def255"); expect(BOOT_KEYS).toContain("xMedOcc"); expect(BOOT_KEYS).toContain("meanEdge");
  });
});


// ---- review round (14 Nov 2026): one test per finding, each of which fails on the code before the fix ----------------

describe("review round", () => {
  const sideOf = (sumEnd: number, births: number, extra: Partial<{ ledgerBad: number; error: string }> = {}) => ({
    snaps: [0, 25, 50, 75, 100].map((t) => ({ step: t * 20, n: 100, births: Math.round((births * t) / 100), deaths: Math.round((20 * t) / 100), lightIn: 0, sumA: 1000 - Math.round(((1000 - sumEnd) * t) / 100), sumP: 0 })),
    ledgerBad: 0, nEnd: 100, ...extra,
  });
  /** A checkpoint where `on` beats noconduit and ghost (pays) and the null seeds equal `on`. */
  const payingBranch = (at: number): BranchFile => ({ at, len: 2000, variants: { on: sideOf(880, 40), nullA: sideOf(880, 40), nullB: sideOf(880, 40), noconduit: sideOf(900, 40), ghost: { ...sideOf(900, 40), ghostCorr: 0.1 } } });
  const withBranches = (branches: BranchFile[], steps = 100_000): RunFile => ({ ...mkRun("F", "T-16-mid", 1, { steps: 3000 }), steps, branches });

  it("P2 payOnTrail: a planned checkpoint with no branch is unresolved, never silently dropped", () => {
    const one = withBranches([payingBranch(50_000)]);
    expect(payOnTrail(one, ["noconduit", "ghost"], [50_000, 100_000])).toBeNull();          // 100,000 missing: old code returned true from one checkpoint
    expect(payOnTrail(withBranches([payingBranch(50_000), payingBranch(100_000)]), ["noconduit", "ghost"], [50_000, 100_000])).toBe(true);
    expect(payOnTrail(one, ["noconduit", "ghost"], null)).toBeNull();
    expect(payOnTrail(withBranches([]), ["noconduit"], [50_000])).toBeNull();
    const failing: BranchFile = { ...payingBranch(50_000), variants: { ...payingBranch(50_000).variants, noconduit: sideOf(880, 40) } };
    expect(payOnTrail(withBranches([failing]), ["noconduit"], [50_000, 100_000])).toBe(false);   // one failing read is a failure whatever is missing
    expect(dampOnTrail(one, [50_000, 100_000])).toBe(false);                                   // a paying checkpoint is not damping
    expect(dampOnTrail(withBranches([]), [50_000])).toBeNull();
  });
  it("P2 plannedAt takes the stored plan, else the arm definition (a truncated run branches once, at its length)", () => {
    const sz = { ...fakeSz, Fstar: 16 };
    expect(plannedAt({ ...withBranches([]), branchAt: [7] }, sz)).toEqual([7]);
    expect(plannedAt(withBranches([]), sz)).toEqual([50_000, 100_000]);
    expect(plannedAt({ ...withBranches([]), steps: 2000 }, sz)).toEqual([2000]);
    expect(plannedAt({ ...withBranches([]), armId: "nonesuch" }, sz)).toBeNull();
  });

  /** A full F cohort of 8 slots with every control; `anchors` physarum and blind runs that pay on trail. */
  const buildF = (anchors: number, boot: (arm: string) => Record<string, number | null>, conduit: (arm: string, h: string) => Record<string, number | null> = () => ({ csat: 0.1 }), acute: (arm: string, h: string) => number = () => 0.2): RunFile[] => {
    const mkF = (arm: string, slot: number, h = "inherit", steps = 3000, branches: BranchFile[] = []): RunFile => {
      const r = mkRun("F", arm, slot, { steps, heredity: h });
      r.late = { runValues: {}, r4: { speed: 0.1, acute: acute(arm, h) }, conduit: conduit(arm, h), boot: boot(arm) };
      r.branches = branches; r.steps = steps;
      return r;
    };
    const rows: RunFile[] = [];
    for (let s = 1; s <= 8; s++) {
      rows.push(mkF("T-16-mid", s), mkF("T-16-mid", s, "blocked"), mkF("FREE-16", s), mkF("GHOST", s), mkF("DIFF", s));
      for (const nm of ["FREE-4", "T-4-mid", "T-16-lo", "T-16-hi"]) rows.push(mkF(nm, s));
      if (s <= anchors) {
        rows.push(mkF("anchor-phys-T-16-mid", s, "physarum", 40_000, [payingBranch(20_000), payingBranch(40_000)]));
        rows.push(mkF("anchor-blind-T-16-mid", s, "blind", 40_000, [payingBranch(20_000), payingBranch(40_000)]));
      }
    }
    return rows;
  };
  const kept = (arm: string) => ({ tmAbove: arm.startsWith("FREE") ? 0.05 : 0.5, tm: 1, tmAboveStar: 0.4, ghostCorr: 0.1 });
  it("P2 the anchor verdict needs the whole cohort: one finished pair reads INCOMPLETE, not YES", () => {
    const sz = { ...fakeSz, Fstar: 16 };
    const one = analyzeF(buildF(1, kept), sz);
    expect(one.lines.join("\n")).toMatch(/anchor verdict INCOMPLETE/);   // old code: need(1) = 1, so one passing pair gave YES
    expect(one.label!.label).toBe("KEPT-BY-PRESENCE-ONLY");
    expect(one.label!.note).toMatch(/anchor INCOMPLETE/);
    expect(analyzeF(buildF(8, kept), sz).lines.join("\n")).toMatch(/anchor verdict YES/);
  });
  it("P2 (e) dose compares trail above one ceiling (F*), not each arm's own ceiling", () => {
    const sz = { ...fakeSz, Fstar: 16 };
    // Trail above the arm's own ceiling is larger for the F = 4 arms (0.9 against 0.5) by construction; above F* the doses rise as they should.
    const doses = (arm: string) => ({ tmAbove: arm.includes("-4-") ? 0.9 : arm.startsWith("FREE") ? 0.05 : 0.5, tm: 1, tmAboveStar: arm.includes("-4-") ? 0.2 : arm.endsWith("-lo") ? 0.3 : 0.5 });
    expect(analyzeF(buildF(8, doses), sz).lines.join("\n")).toMatch(/\(e\) dose holds/);
    const flat = (arm: string) => ({ tmAbove: 0.5, tm: 1, tmAboveStar: arm.includes("-4-") ? 0.9 : 0.5 });   // the low dose keeps MORE above F*: not a dose response
    expect(analyzeF(buildF(8, flat), sz).lines.join("\n")).toMatch(/\(e\) dose does not hold/);
    expect(analyzeF(buildF(8, (arm) => ({ ...kept(arm), tmAboveStar: null })), sz).lines.join("\n")).toMatch(/\(e\) dose does not hold/);   // an unread column never passes
  });
  it("P2 the low dose arm is F*/4 (2 when F* is 8), named from the sizing", () => {
    expect(lowDoseF(16)).toBe(4); expect(lowDoseF(8)).toBe(2); expect(lowDoseF(2)).toBe(1);
    const ids = armsOf("F", { ...PROVISIONAL, Fstar: 8 }).map((a) => a.id);
    expect(ids).toContain("FREE-2"); expect(ids).toContain("T-2-mid"); expect(ids).not.toContain("T-4-mid");
    expect(armsOf("F", PROVISIONAL).map((a) => a.id)).toContain("T-4-mid");
  });
  it("P3 H takes the sens and acute branches too, and an unreadable branch makes the seed unresolved", () => {
    const sz = { ...fakeSz, Fstar: 16 };
    // occx identical to blocked (branch i false); sensLevel carries it: at least 0.005 and twice blocked's.
    const mk = (sens: number, sensB: number) => (_arm: string, h: string) => ({ csat: 0.1, occx: 1, occxShift: 1, sensLevel: h === "blocked" ? sensB : sens, sensNut: 0 });
    expect(analyzeF(buildF(8, kept, mk(0.02, 0.005)), sz).lines.join("\n")).toMatch(/H \(occx, sens or acute branch\) in 8\/8/);
    expect(analyzeF(buildF(8, kept, mk(0.02, 0.015)), sz).lines.join("\n")).toMatch(/in 0\/8/);   // not twice blocked's
    // Branch (iii): acute above blocked's by half the anchors' median. With acute 0 everywhere (R4 gives 0 when no particle qualifies) the threshold is 0 and
    // treated = blocked must NOT pass (old code: 0 >= 0 was true, H 8/8).
    const noSens = mk(0, 0);
    expect(analyzeF(buildF(8, kept, noSens, () => 0), sz).lines.join("\n")).toMatch(/H \(occx, sens or acute branch\) in 0\/8/);
    expect(analyzeF(buildF(8, kept, noSens, (arm, h) => (h === "inherit" && arm === "T-16-mid" ? 0.5 : 0.2)), sz).lines.join("\n")).toMatch(/in 8\/8/);
    expect(analyzeF(buildF(8, kept, noSens, () => 0.2), sz).lines.join("\n")).toMatch(/in 0\/8/);   // equal to blocked: no excess
  });
  it("P2 an unread control never helps its own predicate: GHOST and DIFF with null trail do not hold (f)", () => {
    const sz = { ...fakeSz, Fstar: 16 };
    expect(analyzeF(buildF(8, kept), sz).lines.join("\n")).toMatch(/GHOST kept 8\/8/);    // kept() gives every non-FREE arm 0.5: the controls kept, (f) fails
    const lowCtl = (arm: string) => (arm === "GHOST" || arm === "DIFF" ? { tmAbove: 0.01, tm: 1, tmAboveStar: 0.4, ghostCorr: 0.1 } : kept(arm));
    expect(analyzeF(buildF(8, lowCtl), sz).lines.join("\n")).toMatch(/GHOST kept 0\/8.*-> holds/);
    const unread = (arm: string) => (arm === "GHOST" || arm === "DIFF" ? { tmAbove: null, tm: null, tmAboveStar: null, ghostCorr: 0.1 } : kept(arm));
    expect(analyzeF(buildF(8, unread), sz).lines.join("\n")).toMatch(/GHOST kept 8\/8.*does not hold/);   // old code: null read as 0, 'not kept', (f) held
  });
  it("P2 labelF: every KEPT-AND-PAYS predicate with an unfinished anchor cohort is INCOMPLETE, not a lesser label", () => {
    const yes = Array(8).fill(true);
    const f = (anchor: FInputs["anchor"]): FInputs => ({ n: 8, cls: Array(8).fill("K"), a: yes, aDamp: Array(8).fill(false), b: yes, c: yes, d: yes, H: yes, G: yes, fLed: Array(8).fill(false), e: true, f: true, anchor, extras: true });
    expect(labelF(f("YES")).label).toBe("KEPT-AND-PAYS");
    expect(labelF(f("INCOMPLETE")).label).toBe("INCOMPLETE");
    expect(labelF(f("INCOMPLETE")).note).toMatch(/anchor cohort is unfinished/);
    expect(labelF(f("MIXED")).label).toBe("KEPT-BY-PRESENCE-ONLY");   // a finished anchor set that does not pay is a real reading
  });

  it("P2 D0: a partial cohort or a missing butterfly twin is an unresolved vote, so a T NO-PAY stays 'short-window only'", () => {
    const d0 = (slots: number, withBf = true) => {
      const rows: RunFile[] = [];
      for (let s = 1; s <= slots; s++) for (const [arm, i] of [["rows-G.on-P2", 100], ["rows-G.off", 100], ["rows-G.bf", 100]] as const) if (withBf || arm !== "rows-G.bf" || s > 1) rows.push(mkRun("D0", arm, s, { i, steps: 3000 }));
      return rows;
    };
    expect(analyzeD0(d0(8), fakeSz).vote).toBe("N");              // the full cohort: a real N
    expect(analyzeD0(d0(2), fakeSz).vote).toBe("I");              // old code: need(2) = 2, so two flat seeds read N
    expect(analyzeD0(d0(2), fakeSz).lines.join()).toMatch(/INCOMPLETE/);
    expect(analyzeD0(d0(8, false), fakeSz).vote).toBe("I");       // one twin missing shrinks the noise floor
  });

  it("P2 D1 GRAD compares rows and cols at the same strength (R), not rows P2 against cols R", () => {
    const build = (rowsR: number) => {
      const rows: RunFile[] = [];
      const mk = (arm: string, s: number, i: number, h = "inherit") => { const r = mkRun("D", arm, s, { steps: 3000, i, heredity: h }); r.late = { runValues: { d: 1, TM: 0.01 }, r4: null, conduit: {}, boot: {} }; return r; };
      for (let s = 1; s <= 8; s++) rows.push(mk("rows-G.on-P2", s, 130), mk("rows-G.on-R", s, rowsR), mk("rows-G.off", s, 100), mk("rows-G.bf", s, 100), mk("cols-G.on-R", s, 100), mk("cols-G.off", s, 100), mk("base-G", s, 100));
      return rows;
    };
    // P2 pays strongly but at R rows equal cols: no gradient effect. Old code read rel(P2) - rel(cols R) and called GRAD Y.
    expect(analyzeD(build(100), fakeSz).inputs!.grad).toBe("N");
    expect(analyzeD(build(130), fakeSz).inputs!.grad).toBe("Y");
  });

  it("P2 keptClass: an unread run is U, never 'no bite'; U neither passes K nor fails it", () => {
    const run = (b: Record<string, number | null>): RunFile => { const r = mkRun("F", "x", 1, { steps: 1000 }); r.late = { runValues: {}, r4: null, conduit: {}, boot: b }; return r; };
    expect(keptClass(run({ tmAbove: null, tm: null }), run({ tmAbove: 0.01, tm: 0.01 }))).toBe("U");   // old code: 0 and 0 -> NB
    expect(keptClass(run({ tmAbove: 0, tm: 0.01 }), run({ tmAbove: null, tm: null }))).toBe("U");
    expect(keptClass(run({ tmAbove: 0, tm: 0.01 }), run({ tmAbove: 0, tm: 0.01 }))).toBe("NB");
    expect(keptClass(run({ tmAbove: 0.5, tm: 1 }), run({ tmAbove: 0.1, tm: 1 }))).toBe("K");
    expect(keptClass(run({ tmAbove: 0.5, tm: 1 }), run({ tmAbove: 0.4, tm: 1 }))).toBe("S");
    const f = (cls: FInputs["cls"]): FInputs => ({ n: 8, cls, a: [], aDamp: [], b: [], c: [], d: [], H: [], G: [], fLed: [], e: true, f: true, anchor: "YES", extras: true });
    expect(labelF(f(Array(8).fill("U"))).label).toBe("INCONCLUSIVE");                       // extinct everywhere is not NO-BITE and not PURGED
    expect(labelF(f([...Array(5).fill("NB"), "U", "U", "U"])).label).toBe("INCONCLUSIVE");  // U does not count toward NB's 6 of 8
    expect(labelF(f(Array(8).fill("NB"))).label).toBe("NO-BITE");
  });

  it("P2 a branch variant with a ledger residual or an error is unresolved, and smoke rows never reach a label", () => {
    const base = (v: ReturnType<typeof sideOf>): BranchFile => ({ at: 100, len: 2000, variants: { on: sideOf(880, 40), nullA: sideOf(880, 40), nullB: sideOf(880, 40), noconduit: v } });
    expect(branchPairs(base(sideOf(900, 40)), 4).find((x) => x.variant === "noconduit")!.whole.pay).toBe(true);
    const bad = branchPairs(base(sideOf(900, 40, { ledgerBad: 2 })), 4).find((x) => x.variant === "noconduit")!;
    expect(bad.whole.pay).toBeNull(); expect(bad.whole.unresolved).toMatch(/ledger residual or failed/);
    const err = branchPairs(base({ ...sideOf(900, 40), snaps: [], error: "config bug" }), 4).find((x) => x.variant === "noconduit")!;
    expect(err.whole.pay).toBeNull();
    const onBad = branchPairs({ ...base(sideOf(900, 40)), variants: { ...base(sideOf(900, 40)).variants, on: sideOf(880, 40, { ledgerBad: 1 }) } }, 4);
    expect(onBad.every((p) => p.whole.pay === null)).toBe(true);   // a broken `on` spoils every pair it enters
    // Smoke rows: the same 8 slots flagged smoke give no label; unflagged they do.
    const rows = (smoke: boolean): RunFile[] => { const r: RunFile[] = []; for (let s = 1; s <= 8; s++) for (const [arm, i] of [["rows-G.on-P2", 130], ["rows-G.off", 100], ["rows-G.bf", 100]] as const) r.push({ ...mkRun("T", arm, s, { i, flux: 5 }), smoke }); return r; };
    expect(analyzeT(rows(false), fakeSz, null).perStrength.P2.pw).not.toBeUndefined();
    expect(analyzeT(rows(true), fakeSz, null).label).toBeNull();
    expect(analyzeT(rows(true), fakeSz, null).lines.join()).toMatch(/no T label can be issued|none/);
    expect(labelRows([...rows(true), { ...mkRun("T", "a", 1, {}), ledgerBadChecks: 1 }]).notes.join()).toMatch(/24 smoke rows.*1 runs carry ledger residuals/s);
  });

  it("P2 --slots can never turn a dev (S) or smoke slot into a series cohort", () => {
    const sSlots = slotsOf(BOOT_BASE, "S", "screen"), smoke = slotsOf(BOOT_BASE, "SMOKE", "smoke"), tSlots = slotsOf(BOOT_BASE, "T", "screen"), held = slotsOf(BOOT_BASE, "T", "held");
    expect(expandRuns("T", PROVISIONAL, BOOT_BASE, { slots: sSlots })).toEqual([]);                           // old code: every arm took them
    expect(expandRuns("T", PROVISIONAL, BOOT_BASE, { slots: smoke })).toEqual([]);
    expect(expandRuns("T", PROVISIONAL, BOOT_BASE, { slots: [tSlots[0], sSlots[0]] }).every((r) => r.slot === tSlots[0])).toBe(true);
    expect(expandRuns("T", PROVISIONAL, BOOT_BASE, { slots: held })).toEqual([]);                              // held slots need --held
    expect(expandRuns("T", PROVISIONAL, BOOT_BASE, { slots: held, held: true }).length).toBeGreaterThan(0);
    const sm = expandRuns("T", PROVISIONAL, BOOT_BASE, { slots: [smoke[0], tSlots[0]], smoke: true });
    expect(sm.length).toBeGreaterThan(0); expect(sm.every((r) => r.slot === smoke[0])).toBe(true);
    expect(expandRuns("R7", PROVISIONAL, BOOT_BASE, { slots: smoke, smoke: true }).length).toBeGreaterThan(0);
  });

  it("P2 resume: a different t0, t_alive, config, smoke flag or length is refused; residuals and failed variants too", () => {
    const r = expandRuns("T", { ...PROVISIONAL, measured: ["v"] }, BOOT_BASE, { slots: [slotsOf(BOOT_BASE, "T", "screen")[0]] })[0];
    const sz = { ...PROVISIONAL, measured: ["t0", "v", "gR", "diffA", "tAlive"] };
    const want = { steps: r.steps, smoke: false, config: specConfig(r), sizing: sizingStamp(sz, "T") };
    const done = { steps: r.steps, smoke: false, config: JSON.parse(JSON.stringify(specConfig(r))), sizing: sizingStamp(sz, "T"), ledgerBadChecks: 0, branchErrors: 0 };
    expect(resumeProblem(done, want)).toBeNull();
    const v24 = specConfig({ ...r, over: { ...r.over, trailInit: 24 } });
    expect(resumeProblem({ ...done, config: JSON.parse(JSON.stringify(v24)) }, want)).toMatch(/different config/);        // sizing A (v 32) rerun as sizing B (v 24)
    expect(resumeProblem({ ...done, sizing: sizingStamp({ ...sz, t0: 250 }, "T") }, want)).toMatch(/different t0/);
    expect(resumeProblem({ ...done, sizing: sizingStamp({ ...sz, tAlive: { 1: 1, 2: 2, 3: 3 } }, "T") }, want)).toMatch(/different t0/);
    expect(resumeProblem({ ...done, smoke: true }, want)).toMatch(/smoke run/);
    expect(resumeProblem({ ...done, steps: 50 }, want)).toMatch(/50 steps/);
    expect(resumeProblem({ ...done, ledgerBadChecks: 1 }, want)).toMatch(/ledger residuals/);
    expect(resumeProblem({ ...done, branchErrors: 2 }, want)).toMatch(/failed branch variants/);
  });
  it("P2 resume: later pilots rewriting the sizing file (more measured fields, new F and theta) do not strand finished T runs", () => {
    const r = expandRuns("T", { ...PROVISIONAL, measured: ["v"] }, BOOT_BASE, { slots: [slotsOf(BOOT_BASE, "T", "screen")[0]] })[0];
    const early = { ...PROVISIONAL, measured: ["t0", "v", "gR", "diffA", "tAlive"] };                                   // S1 and S2 only
    const later = { ...early, measured: [...early.measured, "Fstar", "Fg", "diffAF", "theta"], Fstar: 8, Fg: { lo: 1, mid: 2, hi: 4 }, theta: { lo: 1, mid: 2, hi: 3 }, diffAF: 3 };
    const done = { steps: r.steps, smoke: false, config: JSON.parse(JSON.stringify(specConfig(r))), sizing: sizingStamp(early, "T"), ledgerBadChecks: 0, branchErrors: 0 };
    expect(resumeProblem(done, { steps: r.steps, smoke: false, config: specConfig(r), sizing: sizingStamp(later, "T") })).toBeNull();
    // F stamps F* (it sets tmAboveStar); S runs stamp nothing.
    expect(sizingStamp(early, "F")).not.toBe(sizingStamp(later, "F"));
    expect(sizingStamp(early, "S1")).toBe(""); expect(sizingStamp(later, "R7")).toBe("");
  });
  it("P2 a run skipped on a claim file is an unfinished run: the summary is not clean and the exit code is not 0", () => {
    expect(runSummary({ failures: 0, fatal: 0, skippedClaims: 0 })).toEqual({ message: "all ledgers exact, intake identity exact", code: 0 });
    const s = runSummary({ failures: 0, fatal: 0, skippedClaims: 3 });
    expect(s.code).toBe(1); expect(s.message).toMatch(/3 runs NOT run/); expect(s.message).not.toMatch(/all ledgers exact/);
    expect(runSummary({ failures: 1, fatal: 1, skippedClaims: 0 }).code).toBe(2);
  });

  it("P2 sizing: a partial S set measures nothing it cannot measure, and smoke rows are ignored", () => {
    const rowsS1 = (lights: string[], seeds: number): RunFile[] => { const out: RunFile[] = []; for (const light of lights) for (let s = 1; s <= seeds; s++) { const r = mkRun("S1", `base0-${light}`, s, { steps: 1000 }); r.snaps = r.snaps.map((x) => ({ ...x, n: x.step <= 100 ? 1000 : 700 })); out.push(r); } return out; };
    expect(sizeFromS(rowsS1(["U", "G"], 4)).sizing.t0).toBe(250);
    expect(sizeFromS(rowsS1(["G"], 4)).sizing.t0).toBeUndefined();            // one light: old code took t0 from G alone
    expect(sizeFromS(rowsS1(["U", "G"], 2)).sizing.t0).toBeUndefined();       // under 4 seeds
    expect(sizeFromS(rowsS1(["U", "G"], 4).map((r) => ({ ...r, smoke: true }))).sizing.t0).toBeUndefined();
    const s2 = (patterns: string[]): RunFile[] => {
      const out: RunFile[] = [];
      for (const p of patterns) for (const v of [16, 24, 32, 48]) for (let s = 1; s <= 2; s++) {
        const r = mkRun("S2", `${p}-v${v}`, s, { steps: 1000 });
        const road = emptyCols(["laidA8", "desert", "xMed", "xGe1", "xGe2", "xGe3", "onLaid", "road", "meanDd1", "meanDd2", "meanDd3", "xflux", "n"]);
        for (const t of [10, 50, 100, 150, 200]) pushCols(road, t, { laidA8: 1, desert: 0, xMed: 9, xGe1: 1, xGe2: 1, xGe3: 1, onLaid: 0, road: 0, meanDd1: 50, meanDd2: 60, meanDd3: 70, xflux: 0, n: 900 });
        r.roadSeries = road; out.push(r);
      }
      return out;
    };
    const part = sizeFromS(s2(["rows", "cols", "lattice", "patches"]));          // no carpet, the pattern that binds
    expect(part.sizing.v).toBeUndefined(); expect(part.sizing.gR).toBeUndefined(); expect(part.sizing.tAlive).toBeUndefined();
    expect(part.lines.join()).toMatch(/R2 NOT applied/);
    expect(sizeFromS(s2(["rows", "cols", "lattice", "patches", "carpet"])).sizing.v).toBe(48);
  });

  it("P3 the intake cross-check is a second route: it fails where the telescoping sum cannot", () => {
    const s = createWorld(small({ trailFreeLayer: 16, trailConduit: 30 }));
    const a = { ...s, A: s.A.slice(), C: s.C.slice(), P: s.P.slice(), M: s.M.slice(), totals: { ...s.totals } } as MyceliumState, sa = snapOf(s);
    for (let t = 0; t < 20; t++) step(s);
    const sb = snapOf(s);
    expect(independentIntakeProblem(a, s, sa, sb)).toBeNull();
    expect(telescopeProblem([sa, sb], s.config.eA)).toBeNull();
    // A field that loses a unit of A without eating it (a readout fault): the telescoping sum still telescopes, the matter route disagrees.
    const k = s.A.findIndex((x) => x > 0);
    const t = { ...s, A: s.A.slice() } as MyceliumState; t.A[k]--;
    const sc = snapOf(t);
    expect(telescopeProblem([sa, sc], s.config.eA)).toBeNull();
    expect(independentIntakeProblem(a, t, sa, sc)).toMatch(/from the A field/);
  });
  it("P3 rate from the log: smoke lines count only for R7, stand-in sizing never, residuals never", () => {
    const line = (o: Record<string, unknown>) => JSON.stringify({ state: "finished", series: "T", seconds: 100, plannedSteps: 10_000, jobs: 1, ...o });
    const txt = [line({ seconds: 100 }), line({ smoke: true, seconds: 1 }), line({ standIn: true, seconds: 1 }), line({ ledgerBadChecks: 2, seconds: 1 }), line({ series: "R7", smoke: true, seconds: 300 }), line({ plannedSteps: 100, seconds: 1 })].join("\n");
    expect(rateFromLog(txt, "T")!.rate).toBeCloseTo(10, 9);                    // only the clean T line: 100 s per 10,000 steps = 10 s per 1000
    expect(rateFromLog(txt, "T")!.lines).toBe(1);
    expect(rateFromLog(txt, "O")!.lines).toBe(2);                              // no O line: the clean T line and the R7 smoke
    expect(rateFromLog(line({ smoke: true }), "T")).toBeNull();
  });
});

describe("review round 2 (14 Nov 2026): each test fails on the code before its fix", () => {
  const sideOf = (sumEnd: number, births: number, extra: Partial<{ ghostCorr: number | null }> = {}) => ({
    snaps: [0, 25, 50, 75, 100].map((t) => ({ step: t * 20, n: 100, births: Math.round((births * t) / 100), deaths: Math.round((20 * t) / 100), lightIn: 0, sumA: 1000 - Math.round(((1000 - sumEnd) * t) / 100), sumP: 0 })),
    ledgerBad: 0, nEnd: 100, ...extra,
  });
  const branch = (len: number, ghostCorr: number | null | undefined, name = "ghost"): BranchFile => ({
    at: 100, len, variants: { on: sideOf(880, 40), nullA: sideOf(880, 40), nullB: sideOf(880, 40), noconduit: sideOf(900, 40), [name]: { ...sideOf(900, 40), ...(ghostCorr === undefined ? {} : { ghostCorr }) } },
  });
  const runWith = (branches: BranchFile[]): RunFile => ({ ...mkRun("F", "T-16-mid", 1, { steps: 3000 }), steps: 100_000, branches });

  it("P2 a ghost whose displaced field correlates above 0.5 (or has no correlation) is void: PAY against it is unresolved", () => {
    const ok = branchPairs(branch(2000, 0.3), 4).find((x) => x.variant === "ghost")!;
    expect(ok.whole.pay).toBe(true);
    for (const c of [0.9, 0.51, null, undefined]) {
      const p = branchPairs(branch(2000, c), 4).find((x) => x.variant === "ghost")!;
      expect(p.whole.pay, String(c)).toBeNull(); expect(p.last.pay).toBeNull(); expect(p.whole.unresolved).toMatch(/ghost control void/);
    }
    expect(payOnTrail(runWith([branch(2000, 0.9)]), ["noconduit", "ghost"], [100])).toBeNull();      // old code: true (ghostCorr ignored)
    const two = (c: number) => runWith([branch(2000, c), { ...branch(2000, c), at: 200 }]);
    expect(payOnTrail(two(0.3), ["noconduit", "ghost"], [100, 200])).toBe(true);
    expect(payOnTrail(two(0.9), ["noconduit", "ghost"], [100, 200])).toBeNull();
    // Astra P2: one passing checkpoint is not "both checkpoints" (a run made with a short --steps plans only one): unresolved, never true.
    expect(payOnTrail(runWith([branch(2000, 0.3)]), ["noconduit", "ghost"], [100])).toBeNull();
    expect(branchPairs(branch(2000, 0.9, "oghost"), 4).find((x) => x.variant === "oghost")!.whole.pay).toBeNull();   // the owner ghost too
    expect(mainGhostVoid(0.9)).toBe(true); expect(mainGhostVoid(null)).toBe(true); expect(mainGhostVoid(0.1)).toBe(false);
  });
  it("P2 a main-run GHOST arm with a correlated field counts as a kept (void) control for (f)", () => {
    // buildF-like cohort, built here: 8 slots, GHOST not kept (low trail) so (f) holds when the ghost is valid, fails when it is void.
    const mkF = (arm: string, slot: number, boot: Record<string, number | null>): RunFile => { const r = mkRun("F", arm, slot, { steps: 3000 }); r.late = { runValues: {}, r4: { speed: 0.1, acute: 0.2 }, conduit: { csat: 0.1 }, boot }; return r; };
    const rows = (corr: number | null): RunFile[] => { const r: RunFile[] = []; for (let s = 1; s <= 8; s++) r.push(mkF("T-16-mid", s, { tmAbove: 0.5, tm: 1 }), { ...mkF("T-16-mid", s, { tmAbove: 0.5, tm: 1 }), heredity: "blocked" }, mkF("FREE-16", s, { tmAbove: 0.05, tm: 1 }), mkF("GHOST", s, { tmAbove: 0.01, tm: 1, ghostCorr: corr }), mkF("DIFF", s, { tmAbove: 0.01, tm: 1 })); return r; };
    const sz = { ...fakeSz, Fstar: 16 };
    expect(analyzeF(rows(0.1), sz).lines.join("\n")).toMatch(/GHOST kept 0\/8.*-> holds/);
    expect(analyzeF(rows(0.9), sz).lines.join("\n")).toMatch(/GHOST kept 8\/8.*does not hold/);
    expect(analyzeF(rows(null), sz).lines.join("\n")).toMatch(/GHOST kept 8\/8/);
  });
  it("P2 a branch shorter than 2,000 steps cannot support a pay vote", () => {
    for (const len of [100, 1999]) {
      const p = branchPairs(branch(len, 0.1), 4).find((x) => x.variant === "noconduit")!;
      expect(p.whole.pay, String(len)).toBeNull(); expect(p.whole.unresolved).toMatch(/under the 2000/);
    }
    expect(branchPairs(branch(2000, 0.1), 4).find((x) => x.variant === "noconduit")!.whole.pay).toBe(true);
    expect(payOnTrail(runWith([branch(100, 0.1), branch(100, 0.1)].map((b, k) => ({ ...b, at: k ? 200 : 100 }))), ["noconduit"], [100, 200])).toBeNull();
    expect(dampOnTrail(runWith([branch(100, 0.1)]), [100])).toBeNull();
  });

  it("P2 joint votes need the SAME seeds: (a)(b)(d) on seeds 1-6 with (H, not G) on 3-8 is not KEPT-STATIC-SPONGE", () => {
    const on = (lo: number, hi: number) => Array.from({ length: 8 }, (_, k) => k >= lo && k <= hi);
    const f = (a: boolean[], hh: boolean[]): FInputs => ({
      n: 8, cls: Array(8).fill("K"), a, aDamp: Array(8).fill(false), b: a, c: Array(8).fill(false), d: a, H: hh, G: Array(8).fill(false), fLed: Array(8).fill(false), e: true, f: true, anchor: "YES", extras: true,
    });
    expect(labelF(f(on(0, 5), on(2, 7))).label).toBe("KEPT-BY-PRESENCE-ONLY");        // only seeds 2-5 (four) satisfy both: old code counted 6 and 6
    expect(labelF(f(on(0, 5), on(0, 5))).label).toBe("KEPT-STATIC-SPONGE");
  });
  it("P2 joint votes need the SAME seeds: K on 1-6 with (b)(c)(d) on 3-8 is not KEPT-AND-USED", () => {
    const on = (lo: number, hi: number) => Array.from({ length: 8 }, (_, k) => k >= lo && k <= hi);
    const o = (kEC: boolean[], bcd: boolean[]): OInputs => ({
      n: 8, e: Array(8).fill(true), kEC, kE: Array(8).fill(false), payECvsCoff: "Y", payAll: "Y", harmOrDamp: false,
      b: bcd, c: bcd, d: bcd, H: Array(8).fill(false), G: Array(8).fill(false), f: true, g: true, payCpub: "N", stopRule: false, extras: true,
    });
    expect(labelO(o(on(0, 5), on(2, 7))).label).toBe("KEPT-BY-PRESENCE-ONLY");        // old code: KEPT-AND-USED
    expect(labelO(o(on(2, 7), on(2, 7))).label).toBe("KEPT-AND-USED");
    // The sponge too: K and d with (H and not G) on different seeds is not OWNER-STATIC-SPONGE.
    const sp = (kEC: boolean[], dh: boolean[]): OInputs => ({ ...o(kEC, Array(8).fill(false)), d: dh, H: dh, G: Array(8).fill(false) });
    expect(labelO(sp(on(0, 5), on(2, 7))).label).not.toBe("OWNER-STATIC-SPONGE");
    expect(labelO(sp(on(0, 5), on(0, 5))).label).toBe("OWNER-STATIC-SPONGE");
  });

  it("P2 D's blocked no-lift needs every inherit slot's blocked pair: one pair of eight cannot establish SELECT", () => {
    const mkD = (arm: string, slot: number, d: number, tm: number, h = "inherit"): RunFile => { const r = mkRun("D", arm, slot, { steps: 3000, heredity: h }); r.late = { runValues: { d, TM: tm }, r4: null, conduit: {}, boot: {} }; return r; };
    const rows = (blockedSlots: number[]): RunFile[] => {
      const out: RunFile[] = [];
      for (let s = 1; s <= 8; s++) {
        out.push(mkD("rows-G.on-P2", s, 2, 0.5), mkD("rows-G.off", s, 1, 0.01), mkD("rows-G.bf", s, 1, 0.01), mkD("cols-G.on-R", s, 1, 0.01), mkD("cols-G.off", s, 1, 0.01), mkD("base-G", s, 1, 0.01), mkD("rows-G.on-R", s, 1, 0.01));
        if (blockedSlots.includes(s)) out.push(mkD("rows-G.on-R", s, 2, 0.01, "blocked"), mkD("rows-G.off", s, 1, 0.01, "blocked"));
      }
      return out;
    };
    const all = analyzeD(rows([1, 2, 3, 4, 5, 6, 7, 8]), fakeSz);
    expect(all.inputs!.select).toBe("N");                       // every blocked pair lifts
    const lift = rows([1, 2, 3, 4, 5, 6, 7, 8]).map((r) => (r.heredity === "blocked" && r.armId === "rows-G.on-R" ? { ...r, late: { ...r.late, runValues: { ...r.late.runValues, d: 1 } } } : r));
    expect(analyzeD(lift, fakeSz).inputs!.select).toBe("Y");    // all eight lift-free
    const one = analyzeD(lift.filter((r) => r.heredity !== "blocked" || r.slot === 1), fakeSz);
    expect(one.inputs!.select).toBe("I");                       // old code: Y from the single pair
    expect(one.label!.label).toBe("INCOMPLETE"); expect(one.label!.note).toMatch(/blocked rows-G on-R missing/);
    const unread = lift.map((r) => (r.heredity === "blocked" && r.slot === 3 && r.armId === "rows-G.off" ? { ...r, late: { ...r.late, runValues: { ...r.late.runValues, d: null } } } : r));
    expect(analyzeD(unread, fakeSz).inputs!.select).toBe("I");  // an unread blocked reading is not a no-lift
  });

  it("P2 F import (b) needs 20-particle groups in at least half the late heavy censuses, not a mean over the one that qualified", () => {
    const run = (cover: number): RunFile => {
      const r = mkRun("F", "T-16-mid", 1, { steps: 3000 }); r.steps = 3000;
      const step: number[] = [], il: (number | null)[] = [], inn: (number | null)[] = [];
      for (let k = 1; k <= 100; k++) { step.push(1500 + 15 * k); il.push(k <= cover ? 1 : null); inn.push(k <= cover ? 0 : null); }
      r.conduitSeries = { step, cols: { impLayer: il, impNon: inn } };
      return r;
    };
    expect(importCoverage(run(1))).toBeCloseTo(0.01, 12);
    expect(importCoverage(run(50))).toBe(0.5);
    expect(importCoverage({ ...run(50), conduitSeries: undefined })).toBeNull();
    // Through analyzeF: the (b) count is 0 of 8 when coverage is 1 of 100, 8 of 8 at half, whatever the window means say.
    const cohort = (cover: number): RunFile[] => {
      const out: RunFile[] = [];
      for (let s = 1; s <= 8; s++) for (const [arm, h] of [["T-16-mid", "inherit"], ["T-16-mid", "blocked"], ["FREE-16", "inherit"], ["GHOST", "inherit"], ["DIFF", "inherit"]] as const) {
        const r = run(cover); r.slot = s; r.armId = arm; r.heredity = h; r.id = `F.${arm}.${h}.${s}`;
        r.late = { runValues: {}, r4: { speed: 0.1, acute: 0.2 }, conduit: { csat: 0.1, impLayer: 1, impNon: 0 }, boot: { tmAbove: arm === "FREE-16" ? 0.05 : 0.5, tm: 1, ghostCorr: 0.1 } };
        out.push(r);
      }
      return out;
    };
    const sz = { ...fakeSz, Fstar: 16 };
    expect(analyzeF(cohort(1), sz).lines.join("\n")).toMatch(/\(b\) import.* in 0\/8/);
    expect(analyzeF(cohort(50), sz).lines.join("\n")).toMatch(/\(b\) import.* in 8\/8/);
  });

  it("P2 resume: a run finished with --no-branch (or other branch settings) is not skipped by a default rerun", () => {
    const r = expandRuns("F", { ...PROVISIONAL, measured: ["v", "Fstar", "Fg", "diffAF"] }, BOOT_BASE, { slots: [slotsOf(BOOT_BASE, "F", "screen")[0]] }).find((x) => x.branch)!;
    const sz = { ...PROVISIONAL, measured: ["Fstar", "Fg", "diffAF"] };
    const at = [50_000, 100_000];
    const cfg = JSON.parse(JSON.stringify(specConfig(r)));
    const done = { steps: r.steps, smoke: false, config: cfg, sizing: sizingStamp(sz, r.series), ledgerBadChecks: 0, branchErrors: 0, branchAt: at, branchLen: 2000, branchGrid: 25 };
    const want = { steps: r.steps, smoke: false, config: specConfig(r), sizing: sizingStamp(sz, r.series), branchAt: at, branchLen: 2000, branchGrid: 25 };
    expect(resumeProblem(done, want)).toBeNull();
    expect(resumeProblem({ ...done, branchAt: [] }, want)).toMatch(/branch checkpoints \[\], not \[50000,100000\]/);        // finished with --no-branch
    expect(resumeProblem(done, { ...want, branchAt: [] })).toMatch(/branch checkpoints/);                                    // the other way round
    expect(resumeProblem({ ...done, branchLen: 500 }, want)).toMatch(/branches of 500 steps, not 2000/);
    expect(resumeProblem({ ...done, branchGrid: 50 }, want)).toMatch(/read grid of 50, not 25/);
    expect(resumeProblem({ ...done, branchAt: undefined }, want)).toMatch(/without a stored branch plan/);
    // With no branches planned the length and grid do not matter.
    expect(resumeProblem({ ...done, branchAt: [], branchLen: 500, branchGrid: 50 }, { ...want, branchAt: [] })).toBeNull();
  });
});

void [vote, validateConfig];
