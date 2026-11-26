// Boundary tests for the outcome tables of the readout: every threshold of 4.3, 4.4 and 4.6 with the count just below it, on it and just
// above, 7.3 at a four-label cycle, the two edges of 2.3 and 2.7, the sense of `informative` for every kind of control, and the
// thresholds the first tests left to the middle of their range (conformance review F1 to F4, F10 and F11). Each test names the
// threshold it pins; a mutant of that threshold (one count off, `<` for `<=`) fails it. Nothing here is a result.

import { describe, expect, it } from "vitest";
import { analyzeMutation, analyzeRun, jobBugs, Problems, type Arm, type Job } from "../3d-rps/readout-jobs.ts";
import { evaluateGate0, evaluateMeter } from "../3d-rps/readout-gate0.ts";
import { edgePairs, evaluateCalibration, evaluateSweep, spreadStar, spreadStats, sweepOutcome, type SweepSpread } from "../3d-rps/readout-kernel.ts";
import { evaluateMutation } from "../3d-rps/readout-mutation.ts";
import { analyzePair, evaluateLattice, LAT_M, type LatticeCell } from "../3d-rps/readout-lattice.ts";
import { ARM_ROW, DLAB_5, OP, TEND, calibrationJobs, five, meterJob, mkJob, rowsOf, rungJobs, sweepJobs, type ClassSpec, type RowSpec } from "./rps-fixtures.ts";

const sp = (spread: number, o: Partial<SweepSpread> = {}): SweepSpread => ({
  spread, informative: true, incomplete: false, nTreat: 5, nCtrl: 3, nDyn: 0, nFc: 0, nChurn: 0, nLost: 0, nExt: 0, nSparse: 0, nSig: 0, Tmed: TEND + 1000, ctlKeeps: 3, ctlMedAbsChi: 0.02, ...o,
});
/** n dynamic jobs, the rest churning without a signature. */
const dyn = (n: number, o: Partial<SweepSpread> = {}): Partial<SweepSpread> => ({ nDyn: n, nSig: n, nChurn: 5 - n, ...o });
/** n jobs lost at a median time `tmed`, the rest churning. */
const lost = (n: number, tmed: number, o: Partial<SweepSpread> = {}): Partial<SweepSpread> => ({ nLost: n, nChurn: 5 - n, Tmed: tmed, ...o });
const kinds = (...s: SweepSpread[]) => edgePairs(s, TEND).map((e) => `${e.kind}(${e.a},${e.b})`);
const rowOf = (...s: SweepSpread[]) => sweepOutcome(s, TEND).row;
const EARLY = TEND / 4; // 12,500

describe("4.3 L, the lattice-like cliff: each threshold, below it, on it, above it", () => {
  const L = (a: Partial<SweepSpread>, b: Partial<SweepSpread>, c: Partial<SweepSpread> = {}) => kinds(sp(4, a), sp(8, b), sp(12, c));
  it("n_dyn(a) >= 4: 3 is not enough, 4 and 5 are", () => {
    expect(L(dyn(3), lost(5, 5000))).toEqual([]);
    expect(L(dyn(4), lost(5, 5000))).toEqual(["L(4,8)"]);
    expect(L(dyn(5), lost(5, 5000))).toEqual(["L(4,8)"]);
  });
  it("n_dyn(b) <= 1: 2 is too many, 1 and 0 are fine", () => {
    expect(L(dyn(5), { ...dyn(2), nLost: 3, nChurn: 0, Tmed: 5000 })).toEqual([]);
    expect(L(dyn(5), { ...dyn(1), nLost: 4, nChurn: 0, Tmed: 5000 })).toEqual(["L(4,8)"]);
    expect(L(dyn(5), lost(5, 5000))).toEqual(["L(4,8)"]);
  });
  it("Tmed(b) <= T_end / 4: 12,500 passes, 12,501 does not", () => {
    expect(L(dyn(5), lost(5, EARLY))).toEqual(["L(4,8)"]);
    expect(L(dyn(5), lost(5, EARLY + 1))).toEqual([]);
    expect(L(dyn(5), lost(5, EARLY - 1))).toEqual(["L(4,8)"]);
  });
  it("every informative v > b has n_dyn(v) <= 2: 2 passes, 3 does not; an uninformative v is ignored", () => {
    expect(L(dyn(5), lost(5, 5000), dyn(2))).toEqual(["L(4,8)"]);
    expect(L(dyn(5), lost(5, 5000), dyn(3))).toEqual([]);
    expect(L(dyn(5), lost(5, 5000), { ...dyn(5), informative: false })).toEqual(["L(4,8)"]);
  });
});

describe("4.3 I, the inverted cliff: each threshold", () => {
  const I = (below: Partial<SweepSpread> | null, a: Partial<SweepSpread>, b: Partial<SweepSpread>) => (below === null ? kinds(sp(8, a), sp(12, b)) : kinds(sp(4, below), sp(8, a), sp(12, b)));
  it("n_dyn(a) <= 1: 2 is too many, 1 passes", () => {
    expect(I(null, { ...dyn(2), nLost: 3, nChurn: 0, Tmed: 5000 }, dyn(5))).toEqual([]);
    expect(I(null, { ...dyn(1), nLost: 4, nChurn: 0, Tmed: 5000 }, dyn(5))).toEqual(["I(8,12)"]);
    expect(I(null, lost(5, 5000), dyn(5))).toEqual(["I(8,12)"]);
  });
  it("n_dyn(b) >= 4: 3 is not enough, 4 passes", () => {
    expect(I(null, lost(5, 5000), dyn(3))).toEqual([]);
    expect(I(null, lost(5, 5000), dyn(4))).toEqual(["I(8,12)"]);
  });
  it("Tmed(a) <= T_end / 4 strictly in the early direction: 12,500 passes, 12,501 and T_end / 3 do not", () => {
    expect(I(null, lost(5, EARLY), dyn(5))).toEqual(["I(8,12)"]);
    expect(I(null, lost(5, EARLY + 1), dyn(5))).toEqual([]);
    expect(I(null, lost(5, Math.floor(TEND / 3)), dyn(5))).toEqual([]); // 16,666
  });
  it("every informative v < a has n_dyn(v) <= 2: 2 passes, 3 does not", () => {
    expect(I(dyn(2), lost(5, 5000), dyn(5))).toEqual(["I(8,12)"]);
    expect(I(dyn(3), lost(5, 5000), dyn(5))).toEqual([]);
  });
});

describe("4.3 F, the freeze edge: each threshold", () => {
  const F = (below: Partial<SweepSpread> | null, a: Partial<SweepSpread>, b: Partial<SweepSpread>) => (below === null ? kinds(sp(8, a), sp(12, b)) : kinds(sp(4, below), sp(8, a), sp(12, b)));
  it("n_fc(a) >= 4: 3 is not enough, 4 passes", () => {
    expect(F(null, { nFc: 3, nChurn: 2 }, dyn(5))).toEqual([]);
    expect(F(null, { nFc: 4, nChurn: 1 }, dyn(5))).toEqual(["F(8,12)"]);
    expect(F(null, { nFc: 5 }, dyn(5))).toEqual(["F(8,12)"]);
  });
  it("n_dyn(b) >= 4: 3 is not enough, 4 passes", () => {
    expect(F(null, { nFc: 5 }, dyn(3))).toEqual([]);
    expect(F(null, { nFc: 5 }, dyn(4))).toEqual(["F(8,12)"]);
  });
  it("every informative v < a has n_dyn(v) <= 1: 1 passes, 2 does not", () => {
    expect(F(dyn(1, { nFc: 4, nChurn: 0 }), { nFc: 5 }, dyn(5))).toEqual(["F(8,12)"]);
    expect(F(dyn(2, { nFc: 3, nChurn: 0 }), { nFc: 5 }, dyn(5))).toEqual([]);
  });
});

describe("4.4 the outcome table: each count on both sides of its threshold", () => {
  it("A9: a freeze edge and a lattice-like edge that share the spread b1 = a2 (b1 <= a2, not <)", () => {
    expect(kinds(sp(2, { nFc: 5 }), sp(4, { nFc: 5 }), sp(8, dyn(4)), sp(12, lost(5, 5000)))).toEqual(["F(4,8)", "L(8,12)"]);
    expect(rowOf(sp(2, { nFc: 5 }), sp(4, { nFc: 5 }), sp(8, dyn(4)), sp(12, lost(5, 5000)))).toBe("A9");
    expect(rowOf(sp(2, { nFc: 5 }), sp(4, { nFc: 5 }), sp(8, dyn(5)), sp(12, lost(5, 5000)))).toBe("A9");
    // and a spread between with n_dyn 2 breaks the window
    expect(rowOf(sp(4, { nFc: 5 }), sp(8, dyn(4)), sp(12, dyn(2)), sp(20, dyn(4)), sp(28, lost(5, 5000)))).toBe("A5");
    expect(rowOf(sp(4, { nFc: 5 }), sp(8, dyn(4)), sp(12, dyn(3)), sp(20, dyn(4)), sp(28, lost(5, 5000)))).toBe("A9");
  });
  it("A3: n_dyn >= 4 at every informative spread; a single spread with 3 makes it A5", () => {
    expect(rowOf(sp(4, dyn(5)), sp(8, dyn(4)), sp(12, dyn(5)), sp(20, dyn(5)), sp(28, dyn(5)))).toBe("A3");
    expect(rowOf(sp(4, dyn(5)), sp(8, dyn(3)), sp(12, dyn(5)), sp(20, dyn(5)), sp(28, dyn(5)))).toBe("A5");
  });
  it("A11: n_churn >= 4 somewhere: 4 passes, 3 everywhere does not", () => {
    const base = { nFc: 2, nChurn: 3 };
    expect(rowOf(sp(4, { nFc: 1, nChurn: 4 }), sp(8, base), sp(12, base), sp(20, base), sp(28, base))).toBe("A11");
    expect(rowOf(sp(4, base), sp(8, base), sp(12, base), sp(20, base), sp(28, base))).toBe("A5");
  });
  it("A11: n_sig <= 1 at every informative spread: 1 passes, 2 does not", () => {
    expect(rowOf(sp(4, { nChurn: 5, nSig: 1 }), sp(8, { nChurn: 5 }), sp(12, { nChurn: 5 }), sp(20, { nChurn: 5 }))).toBe("A11");
    expect(rowOf(sp(4, { nChurn: 5, nSig: 2 }), sp(8, { nChurn: 5 }), sp(12, { nChurn: 5 }), sp(20, { nChurn: 5 }))).toBe("A5");
  });
  it("A6: n_fc >= 4 somewhere: 4 passes, 3 everywhere does not", () => {
    const base = { nFc: 3, nChurn: 2 };
    expect(rowOf(sp(4, { nFc: 4, nChurn: 1 }), sp(8, base), sp(12, base), sp(20, base))).toBe("A6");
    expect(rowOf(sp(4, base), sp(8, base), sp(12, base), sp(20, base))).toBe("A5");
  });
  it("A6: n_dyn <= 1 at every informative spread: 1 passes, 2 does not", () => {
    expect(rowOf(sp(4, { nFc: 4, nDyn: 1 }), sp(8, { nFc: 4, nDyn: 1 }), sp(12, { nFc: 4, nDyn: 1 }), sp(20, { nFc: 4, nDyn: 1 }))).toBe("A6");
    expect(rowOf(sp(4, { nFc: 4, nChurn: 1 }), sp(8, { nFc: 3, nDyn: 2 }), sp(12, { nFc: 4, nChurn: 1 }), sp(20, { nFc: 4, nChurn: 1 }))).toBe("A5");
  });
  it("A10: n_sparse >= 3 somewhere: 3 passes, 2 everywhere does not (A4 takes it when the rest are lost)", () => {
    expect(rowOf(sp(4, { nSparse: 3, nLost: 2 }), sp(8, { nSparse: 2, nLost: 3 }), sp(12, { nSparse: 2, nLost: 3 }), sp(20, { nSparse: 2, nLost: 3 }))).toBe("A10");
    expect(rowOf(sp(4, { nSparse: 2, nLost: 3 }), sp(8, { nSparse: 2, nLost: 3 }), sp(12, { nSparse: 2, nLost: 3 }), sp(20, { nSparse: 2, nLost: 3 }))).toBe("A4");
  });
  it("A10: n_dyn <= 1 at every informative spread: a spread with 2 makes it A5", () => {
    expect(rowOf(sp(4, { nSparse: 3, nDyn: 1, nLost: 1 }), sp(8, { nSparse: 3, nLost: 2 }), sp(12, { nSparse: 3, nLost: 2 }), sp(20, { nSparse: 3, nLost: 2 }))).toBe("A10");
    expect(rowOf(sp(4, { nSparse: 3, nDyn: 2 }), sp(8, { nSparse: 3, nLost: 2 }), sp(12, { nSparse: 3, nLost: 2 }), sp(20, { nSparse: 3, nLost: 2 }))).toBe("A5");
  });
  it("A4: n_dyn <= 1 at every informative spread: 1 passes, 2 does not; n_lost + n_ext >= 3: 3 passes, 2 does not", () => {
    const lost3 = { nLost: 3, nChurn: 2 };
    expect(rowOf(sp(4, { nLost: 3, nDyn: 1, nChurn: 1 }), sp(8, lost3), sp(12, lost3), sp(20, lost3))).toBe("A4");
    expect(rowOf(sp(4, { nLost: 3, nDyn: 2 }), sp(8, lost3), sp(12, lost3), sp(20, lost3))).toBe("A5");
    expect(rowOf(sp(4, { nLost: 2, nExt: 1, nChurn: 2 }), sp(8, lost3), sp(12, lost3), sp(20, lost3))).toBe("A4");
    expect(rowOf(sp(4, { nLost: 2, nChurn: 3 }), sp(8, lost3), sp(12, lost3), sp(20, lost3))).toBe("A5");
  });
});

describe("4.6 spread*: the neighbours' n_dyn >= 3 and the spread's own n_dyn >= 4", () => {
  it("a neighbour with n_dyn 3 passes, 2 blocks (and 4 is not required of it)", () => {
    // 4 has a neighbour (8) with n_dyn 2; 12 too; 28's only neighbour 20 has exactly 3
    expect(spreadStar([sp(4, dyn(4)), sp(8, dyn(2)), sp(12, dyn(5)), sp(20, dyn(3)), sp(28, dyn(4))])).toBe(28);
    // with 20 at 2 as well, nobody qualifies and the fallback is the smallest v with n_dyn >= 4
    expect(spreadStar([sp(4, dyn(4)), sp(8, dyn(2)), sp(12, dyn(5)), sp(20, dyn(2)), sp(28, dyn(4))])).toBe(4);
  });
  it("the spread's own n_dyn >= 4: 3 is not chosen, 4 is", () => {
    expect(spreadStar([sp(4, dyn(3)), sp(8, dyn(4)), sp(12, dyn(5))])).toBe(8);
    expect(spreadStar([sp(4, dyn(4)), sp(8, dyn(5)), sp(12, dyn(5))])).toBe(4);
  });
  it("the spread's own informative: n_dyn 4 on an uninformative spread is passed over, n_dyn 4 on an informative one is not (decision O-2)", () => {
    expect(spreadStar([sp(4, { ...dyn(4), informative: false }), sp(8, dyn(4)), sp(12, dyn(5))])).toBe(8);
    expect(spreadStar([sp(4, { ...dyn(4), informative: true }), sp(8, dyn(4)), sp(12, dyn(5))])).toBe(4);
  });
});

describe("7.3 a four-label clean cycle (Y = 4) is LONG: the threshold that separates LONG from THREE (conformance F2)", () => {
  const FOUR: RowSpec = { liv: 0.9, shares: [1, 1, 1, 1], modal: [2, 4, 8, 1], supply: 2 };
  const FOUR_BAD: RowSpec = { liv: 0.9, shares: [1, 1, 1, 1], modal: [2 | 8, 4, 8, 1], supply: 2 }; // 0 -> 1, 0 -> 3 and 3 -> 0: a mutual pair, Y = 0
  const THREE: RowSpec = { liv: 0.9, shares: [1, 1, 1], supply: 2 };
  const rep = (r: RowSpec, n: number) => Array.from({ length: n }, () => r);
  const job = (run: RowSpec[], arm: Arm = "C") =>
    mkJob({ stage: "mutation", arm, seed: 251, spread: 4, rate: 32, mutRate: ARM_ROW[arm].mutRate, types: ARM_ROW[arm].types, flip: ARM_ROW[arm].flip, edge: ARM_ROW[arm].edge, rows: { burn: rowsOf("DC", 1).burn, run } });
  const analyze = (run: RowSpec[], arm: Arm = "C") => analyzeMutation(job(run, arm), arm, {});

  it("Y = 4 at every census: LONG, EVER-LONG, max Y 4, the first n_c >= 4 census is the first", () => {
    const a = analyze(rep(FOUR, 60));
    expect(a).toMatchObject({ cls: "LONG", everLong: true, maxY: 4, firstN4: 1000 });
  });
  it("the final window is the last 50: a three-cycle census inside it makes the run LOOSE, one just outside it still LONG", () => {
    const at = (k: number) => [...rep(FOUR, k), THREE, ...rep(FOUR, 59 - k)];
    expect(analyze(at(10)).cls).toBe("LOOSE"); // census index 10 is the first of the last 50
    expect(analyze(at(9)).cls).toBe("LONG"); // index 9 is just before it
    expect(analyze(at(59)).cls).toBe("LOOSE");
  });
  it("THREE needs Y = 3 at every census of the window: four labels in a clean cycle is not THREE, and 3 against 4 mixed is LOOSE", () => {
    expect(analyze(rep(THREE, 60)).cls).toBe("THREE");
    expect(analyze([...rep(THREE, 30), ...rep(FOUR, 30)]).cls).toBe("LOOSE");
    // the window is the last 50 of 60: four-label censuses at its start make it mixed, outside it they do not
    expect(analyze([...rep(FOUR, 30), ...rep(THREE, 30)]).cls).toBe("LOOSE");
    expect(analyze([...rep(FOUR, 10), ...rep(THREE, 50)]).cls).toBe("THREE");
  });
  it("EVER-LONG is a stretch of 20 censuses with Y >= 4: 19 is not enough, 20 is, and it can be anywhere", () => {
    expect(analyze([...rep(FOUR, 19), ...rep(THREE, 51)])).toMatchObject({ cls: "THREE", everLong: false, maxY: 4 });
    expect(analyze([...rep(FOUR, 20), ...rep(THREE, 50)])).toMatchObject({ cls: "THREE", everLong: true });
    expect(analyze([...rep(THREE, 15), ...rep(FOUR, 20), ...rep(THREE, 50)])).toMatchObject({ everLong: true });
    expect(analyze([...rep(FOUR, 10), THREE, ...rep(FOUR, 10), ...rep(THREE, 50)])).toMatchObject({ cls: "THREE", everLong: false });
  });
  it("the first census with n_c >= 4 is recorded whether or not the cycle is clean", () => {
    const a = analyze([...rep(THREE, 5), ...rep(FOUR_BAD, 5), ...rep(THREE, 50)]);
    expect(a).toMatchObject({ firstN4: 6000, maxY: 3 });
    expect(analyze([...rep(THREE, 7), ...rep(FOUR, 53)]).firstN4).toBe(8000);
    expect(analyze(rep(THREE, 60)).firstN4).toBeNull();
  });
  it("arm C with five runs of Y = 4 against five three-cycle runs of arm N is GROWS (a four-cycle counts as long)", () => {
    const sweep = evaluateSweep(sweepJobs({ 4: { treat: five("DC") }, 8: { treat: five("DC") }, 12: { treat: five("DC") }, 20: { treat: five("DC") }, 28: { treat: five({ LOSS: 5 }) } }), OP);
    const arm = (a: Arm, run: RowSpec[]) => [0, 1, 2, 3, 4].map((k) => mkJob({ stage: "mutation", arm: a, seed: 251 + k, spread: 4, rate: a === "N" ? 0 : 32, mutRate: ARM_ROW[a].mutRate, types: ARM_ROW[a].types, flip: ARM_ROW[a].flip, edge: ARM_ROW[a].edge, rows: { burn: rowsOf("DC", 1).burn, run } }));
    const r = evaluateMutation([...arm("Z", rep(THREE, 250)), ...arm("C", rep(FOUR, 250)), ...arm("N", rep(THREE, 250))], OP, sweep);
    const c = r.arms.find((x) => x.arm === "C")!;
    expect(c.counts).toMatchObject({ gL: 5, gT: 0 });
    expect(c.verdict).toEqual({ row: 1, verdict: "GROWS" });
    expect(r.problems.has(2)).toBe(false);
  });
});
describe("2.3 a sign change is supported by a deep negative value at Ma itself; 2.7 a result in row 2 after the contingency is not LAT-FAIL (conformance F3)", () => {
  const cellsOf = (k: number[][], k100?: number[]): LatticeCell[] => {
    const out: LatticeCell[] = [];
    [20, 30, 40, 60].forEach((L, i) => LAT_M.forEach((M, iM) => out.push({ L, iM, M, R: 600, k: k[i][iM] })));
    if (k100) [3, 4, 5, 6, 7, 8].forEach((iM, j) => out.push({ L: 100, iM, M: LAT_M[iM], R: 300, k: k100[j] }));
    return out;
  };
  const mapOf = (cells: LatticeCell[]) => new Map(cells.map((c) => [`${c.L}:${c.iM}`, c]));

  it("the only deep negative value of the pair is D(Ma): the crossing is supported", () => {
    // D = (k30 - k20) / 600: 0 up to index 3, -0.1 at index 4 (Ma = 3e-4), +1/600 at 5 and 6 (not deep), +0.1 from index 7 on
    const k20 = Array(11).fill(300);
    const k30 = [300, 300, 300, 300, 240, 301, 301, 360, 360, 360, 360];
    const p = analyzePair(20, 30, mapOf(cellsOf([k20, k30, k20, k20])), LAT_M);
    expect(p.points[4].D).toBeCloseTo(-0.1, 12);
    expect(p.points.slice(0, 4).every((q) => q.D === 0)).toBe(true);
    expect(p.signChanges.map((s) => [s.Ma, s.Mb, s.supported])).toEqual([[3e-4, 4e-4, true]]);
    expect(p.valid).toBe(true);
    expect(p.crossing!.Ma).toBe(3e-4);
    expect(p.estimate!).toBeGreaterThan(3.9e-4);
    expect(p.estimate!).toBeLessThan(4e-4);
  });
  it("a negative lobe that is not deep enough at Ma (-1.5 SE) supports nothing", () => {
    const k20 = Array(11).fill(300);
    const k30 = [300, 300, 300, 300, 280, 301, 301, 360, 360, 360, 360]; // D(Ma) = -0.0333 > -2 SE_D (-0.0577)
    const p = analyzePair(20, 30, mapOf(cellsOf([k20, k30, k20, k20])), LAT_M);
    expect(p.signChanges.map((s) => s.supported)).toEqual([false]);
    expect(p.valid).toBe(false);
  });
  it("2.7 main grid in row 5, then L = 100 gives a crossing in the caveat band: the outcome is LAT-CAVEAT, not LAT-FAIL (made-up counts)", () => {
    const k = [
      [85, 122, 196, 232, 238, 266, 261, 285, 312, 320, 393],
      [32, 81, 133, 190, 230, 236, 233, 309, 332, 332, 421],
      [5, 12, 66, 148, 194, 231, 287, 264, 385, 386, 484],
      [66, 115, 179, 224, 266, 272, 279, 302, 312, 346, 360],
    ];
    const r = evaluateLattice(cellsOf(k, [1, 8, 26, 88, 130, 260]));
    expect(r.main!.outcome.name).toBe("LAT-NOCROSS");
    expect(r.contingency!.outcome).toEqual({ row: 2, name: "LAT-CAVEAT" });
    expect(r.contingency!.Mc!).toBeGreaterThan(6e-4);
    expect(r.contingency!.Mc!).toBeLessThan(9e-4);
    expect(r.name).toBe("LAT-CAVEAT");
    expect(r.status).toBe("final");
  });
  it("2.7 and one that lands in row 1 after the contingency is LAT-PASS (made-up counts)", () => {
    const k = [
      [8, 79, 110, 203, 239, 266, 287, 293, 336, 328, 428],
      [102, 141, 201, 219, 249, 296, 289, 309, 327, 337, 376],
      [46, 111, 138, 236, 232, 271, 288, 301, 331, 383, 410],
      [46, 45, 161, 206, 258, 304, 284, 305, 332, 352, 429],
    ];
    const r = evaluateLattice(cellsOf(k, [5, 10, 48, 97, 170, 256]));
    expect(r.main!.outcome.row).toBeGreaterThanOrEqual(3);
    expect(r.contingency!.outcome).toEqual({ row: 1, name: "LAT-PASS" });
    expect(r.name).toBe("LAT-PASS");
  });
  it("2.7 and a contingency that is still in rows 3 to 5 is LAT-FAIL", () => {
    const flat = Array(11).fill(300);
    const r = evaluateLattice(cellsOf([flat, flat, flat, flat], [150, 150, 150, 150, 150, 150]));
    expect(r.name).toBe("LAT-FAIL");
  });
});

describe("4.2 informative(v) for every kind of control, and the 0.1 chirality bar (conformance F4)", () => {
  const chiCtl = (d: number, a: number): ClassSpec => ({ custom: () => ({ liv: 0.9, turnover: 0.3, ndom: d, nanti: a }), nRun: TEND / 1000 });
  const stats = (ctrl: ClassSpec[], treat: ClassSpec[] = five("DC")) => {
    const jobs = sweepJobs({ 12: { treat, ctrl } });
    const an = (rate: number) => jobs.filter((j) => j.s.rate === rate).map((j) => analyzeRun(j, {}));
    return spreadStats(12, an(32), an(0), TEND);
  };
  it("controls at a frozen spread (FC) keep their labels: the spread stays informative", () => {
    expect(stats(["FC", "FC", "FC"]).informative).toBe(true);
    expect(stats(["FC", "FC", { LOSS: 5 }]).informative).toBe(true);
    expect(stats(["FC", { LOSS: 5 }, { LOSS: 5 }]).informative).toBe(false);
  });
  it("a control of class LATE (a label missing in the final window) does not keep its labels", () => {
    expect(stats(["LATE", "CHURN", "CHURN"]).informative).toBe(true);
    expect(stats(["LATE", "LATE", "CHURN"]).informative).toBe(false);
  });
  it("a control that is not alive (SPARSE) does not keep its labels either", () => {
    expect(stats(["SPARSE", "SPARSE", "CHURN"]).informative).toBe(false);
    expect(stats(["SPARSE", "CHURN", "CHURN"]).informative).toBe(true);
  });
  it("the median |chi_fw| of the controls must be at most 0.1: 0.09 and 0.10 pass, 0.11 does not", () => {
    expect(stats([chiCtl(109, 91), chiCtl(109, 91), chiCtl(109, 91)]).ctlMedAbsChi!).toBeCloseTo(0.09, 12);
    expect(stats([chiCtl(109, 91), chiCtl(109, 91), chiCtl(109, 91)]).informative).toBe(true);
    expect(stats([chiCtl(110, 90), chiCtl(110, 90), chiCtl(110, 90)]).ctlMedAbsChi).toBe(0.1);
    expect(stats([chiCtl(110, 90), chiCtl(110, 90), chiCtl(110, 90)]).informative).toBe(true);
    expect(stats([chiCtl(111, 89), chiCtl(111, 89), chiCtl(111, 89)]).informative).toBe(false);
  });
  it("it is the absolute value: a control with chi_fw -0.15 is not informative", () => {
    expect(stats([chiCtl(85, 115), chiCtl(85, 115), chiCtl(85, 115)]).ctlMedAbsChi!).toBeCloseTo(0.15, 12);
    expect(stats([chiCtl(85, 115), chiCtl(85, 115), chiCtl(85, 115)]).informative).toBe(false);
  });
  it("it is the median: one control with a large chi among two without is still informative", () => {
    expect(stats([chiCtl(100, 100), chiCtl(100, 100), chiCtl(130, 70)]).informative).toBe(true);
    expect(stats([chiCtl(100, 100), chiCtl(130, 70), chiCtl(130, 70)]).informative).toBe(false);
  });

  describe("3.2 (c) the paired control's bar |chi_fw| <= 0.1, and (b) liv >= 0.50 at the last census", () => {
    const ctl20 = (d: number, a: number): ClassSpec => ({ custom: () => ({ liv: 0.9, turnover: 0.3, ndom: d, nanti: a }), nRun: 20 });
    const table = { 8: ["CHURN", "CHURN"], 16: ["DC", "DC"], 32: ["DC", "DC"], 64: ["DC", "DC"] } as Record<number, [ClassSpec, ClassSpec]>;
    it("controls with |chi_fw| 0.09 and 0.10 qualify, 0.11 do not (KAPPA-NONE)", () => {
      expect(evaluateCalibration(calibrationJobs(table, [ctl20(109, 91), ctl20(109, 91)]), OP).kappaStar).toBe(16);
      expect(evaluateCalibration(calibrationJobs(table, [ctl20(110, 90), ctl20(110, 90)]), OP).kappaStar).toBe(16);
      const none = evaluateCalibration(calibrationJobs(table, [ctl20(111, 89), ctl20(111, 89)]), OP);
      expect(none.verdict).toBe("KAPPA-NONE");
      expect(none.rows[1].why.join()).toMatch(/with \|chi_fw\| 0\.110 above 0\.1/);
    });
    it("liv exactly 0.5 at the last census qualifies, one cell less does not", () => {
      expect(evaluateCalibration(calibrationJobs(table, ["CHURN", "CHURN"], OP, { 16: 0.5 }), OP).kappaStar).toBe(16);
      const r = evaluateCalibration(calibrationJobs(table, ["CHURN", "CHURN"], OP, { 16: 32767 / 65536 }), OP);
      expect(r.rows[1].qualifies).toBe(false);
      expect(r.kappaStar).toBe(32);
    });
  });
});

describe("thresholds of the run classes and the bug bar, close to their values (conformance F10)", () => {
  const withTurnover = (t: number, o: { rate?: number } = {}) => mkJob({ stage: "g0.table", seed: 401, spread: 16, rate: o.rate ?? 32, cls: { custom: () => ({ liv: 0.9, turnover: t, ndom: 250, nanti: 50 }), nRun: 20 } });
  it("0 FC: the mean turnover of the final window against 0.02 (not 0.01, not 0.03)", () => {
    expect(analyzeRun(withTurnover(0.015), {}).cls).toBe("FC");
    expect(analyzeRun(withTurnover(0.015625), {}).cls).toBe("FC");
    expect(analyzeRun(withTurnover(0.0199), {}).cls).toBe("FC");
    expect(analyzeRun(withTurnover(0.0201), {}).cls).toBe("DC");
    expect(analyzeRun(withTurnover(0.03125), {}).cls).toBe("DC");
  });
  it("0 the carpet test of G0.2 is liv >= 0.50 at every run census: exactly half the cells passes, one cell less at one census does not", () => {
    const scan = (liv: (k: number) => number) => mkJob({ stage: "g0.scan", rung: "S0", kill: "removal", seed: 401, spread: 4, rate: 0, cls: { custom: (k) => ({ liv: liv(k), turnover: 0.3, ndom: 150, nanti: 150 }), nRun: 20 } });
    expect(analyzeRun(scan(() => 0.5), {}).carpetAll).toBe(true);
    expect(analyzeRun(scan((k) => (k === 7 ? 32767 / 65536 : 0.5)), {}).carpetAll).toBe(false);
    expect(analyzeRun(scan(() => 0.9), {}).carpetAll).toBe(true);
  });
  it("8.4 a control's |chi_fw| above 0.3 is a bug indicator: 0.28 and 0.30 are not, 0.32 is, in either direction", () => {
    const control = (d: number, a: number) => mkJob({ stage: "g0.table", seed: 401, spread: 16, rate: 0, cls: { custom: () => ({ liv: 0.9, turnover: 0.3, ndom: d, nanti: a }), nRun: 20 } });
    const bug = (d: number, a: number) => {
      const pr = new Problems();
      jobBugs([control(d, a)], (j: Job) => analyzeRun(j, {}), pr);
      return pr.code;
    };
    expect(bug(128, 72)).toBe(0); // 0.28
    expect(bug(130, 70)).toBe(0); // 0.30 exactly
    expect(bug(132, 68)).toBe(3); // 0.32
    expect(bug(68, 132)).toBe(3); // -0.32
  });
  it("4.2 n_sig counts a job whose signature is only in the final window and one whose signature is only before it", () => {
    // 50 run censuses, the final window the last 20: [first 30 censuses] then [last 20]
    const split = (early: [number, number], late: [number, number]): ClassSpec => ({ custom: (k) => ({ liv: 0.9, turnover: 0.3, ndom: (k < 30 ? early : late)[0], nanti: (k < 30 ? early : late)[1] }), nRun: TEND / 1000 });
    const onlyFw = split([95, 105], [150, 50]);
    const onlyAll = split([150, 50], [100, 100]);
    const none = split([100, 100], [100, 100]);
    const a = analyzeRun(mkJob({ stage: "sweep", seed: 211, spread: 12, rate: 32, cls: onlyFw, nRun: 50 }), {});
    expect(a.chiFw).toBeCloseTo(0.5, 12);
    expect(a.chiAll).toBeLessThan(0.2); // 2,850 + 3,000 against 3,150 + 1,000: 0.17
    const b = analyzeRun(mkJob({ stage: "sweep", seed: 211, spread: 12, rate: 32, cls: onlyAll, nRun: 50 }), {});
    expect(b.chiFw).toBe(0);
    expect(b.chiAll).toBeGreaterThanOrEqual(0.2); // 4,500 + 2,000 against 1,500 + 2,000: 0.33
    // spreadStats counts each of them once, and a job with neither not at all
    const jobs = sweepJobs({ 12: { treat: [onlyFw, onlyAll, none, none, none] } });
    const an = (rate: number) => jobs.filter((j) => j.s.rate === rate).map((j) => analyzeRun(j, {}));
    expect(spreadStats(12, an(32), an(0), TEND).nSig).toBe(2);
  });
});

describe("G0.3/G0.2 the middle of an even grid, the meter ordering, the median of the carpets (conformance F11)", () => {
  const rung = (carpets: number[], dlab: Record<number, number>, g: number[]) => evaluateGate0(rungJobs({ rung: "S0", carpets, dlab, g, horizon: ["CHURN", "CHURN", "CHURN"], confirm: { vCal: g[(g.length - 1) >> 1], rate: 16, h0: 200_000, classes: ["DC", "DC", "DC"] } })).rungs[0];
  it("G0.3 v_mid is the lower middle of an even G_spread: six levels give the third, eight the fourth", () => {
    const six = rung([4, 6, 8, 10, 12, 16], { 4: 0.008, 6: 0.0108, 8: 0.01458, 10: 0.0197, 12: 0.0266, 16: 0.0359 }, [4, 6, 8, 10, 12, 16]);
    expect(six.gSpread).toEqual([4, 6, 8, 10, 12, 16]);
    expect(six.table!.spreads).toEqual([4, 8, 16]);
    const eight = rung([2, 3, 4, 6, 8, 10, 12, 16], { 2: 0.008, 3: 0.0112, 4: 0.01568, 6: 0.02195, 8: 0.03073, 10: 0.04302, 12: 0.06023, 16: 0.08432 }, [2, 3, 4, 6, 8, 10, 12, 16]);
    expect(eight.gSpread).toEqual([2, 3, 4, 6, 8, 10, 12, 16]);
    expect(eight.table!.spreads).toEqual([2, 6, 16]);
  });
  it("G0.2 B_meter is the median of the carpets' (B + P) per living cell, the mean of the two middle values for an even count, rounded", () => {
    const jobs = rungJobs({ rung: "S0", carpets: [4, 6, 8, 10, 12, 16, 20, 24], dlab: DLAB_5, g: [4, 8, 12, 20], table: null, horizon: null, confirm: null });
    const masses: Record<number, number> = { 4: 20, 6: 22, 8: 24, 10: 28, 12: 29, 16: 31, 20: 33, 24: 35 };
    for (const j of jobs.filter((x) => x.s.stage === "g0.scan" && x.s.spread! in masses)) {
      const last = j.rows![j.rows!.length - 1];
      last.mass = last.cells.map((c) => c * masses[j.s.spread!]);
    }
    const e = evaluateGate0(jobs).rungs[0];
    expect(e.scan.filter((x) => x.carpet).map((x) => x.massPerCell)).toEqual([20, 22, 24, 28, 29, 31, 33, 35]);
    // the middle two are 28 and 29: the mean 28.5 rounds to 29 (the lower middle would give 28, a floor 28)
    expect(e.bMeter).toBe(29);
  });
  it("3.1 the ordering check fails when D_lab falls by more than a factor 1.3 between consecutive spreads of G_spread (1.25 passes, 1.35 fails)", () => {
    const pts = (a: number, b: number) =>
      evaluateMeter(
        [4, 8].flatMap((v) => (["x", "y"] as const).map((axis) => meterJob({ stage: "meter", spread: v, axis, D: v === 4 ? a : b, seed: 205, useD: true }))),
        [4, 8],
      ).problems.code;
    expect(pts(0.04, 0.04 / 1.25)).toBe(0);
    expect(pts(0.04, 0.04 / 1.35)).toBe(3);
    expect(pts(0.04, 0.05)).toBe(0);
  });
});

describe("4.1 the rate arms stay inside the key's range: 10,922 for removal, 16,384 for the vacancy kill (conformance F11, k91)", () => {
  it("the upper arm is min(max, 4 kappa*): 10,922 at S0, 16,384 at V", () => {
    const grid = { 4: { treat: five("DC") }, 8: { treat: five("DC") }, 12: { treat: five("DC") }, 20: { treat: five("DC") }, 28: { treat: five({ LOSS: 5 }) } };
    const removal = { ...OP, kappaStar: 5000 };
    const vacancy = { ...OP, rung: "V" as const, kill: "vacancy" as const, kappaStar: 5000 };
    expect(evaluateSweep(sweepJobs(grid, removal), removal).rateArms.map((a) => a.rate)).toEqual([1250, 1250, 1250, 10_922, 10_922, 10_922]);
    expect(evaluateSweep(sweepJobs(grid, vacancy), vacancy).rateArms.map((a) => a.rate)).toEqual([1250, 1250, 1250, 16_384, 16_384, 16_384]);
    // below the caps the arm is 4 kappa*, and the lower arm is kappa* / 4 floored, at least 1
    const small = { ...OP, kappaStar: 10 };
    expect(evaluateSweep(sweepJobs(grid, small), small).rateArms.map((a) => a.rate)).toEqual([2, 2, 2, 40, 40, 40]);
    const one = { ...OP, kappaStar: 3 };
    expect(evaluateSweep(sweepJobs(grid, one), one).rateArms.map((a) => a.rate)).toEqual([1, 1, 1, 12, 12, 12]);
  });
});

describe("7.2a MONO needs n_c <= 1 for three censuses in a row: two labels do not stop a run of arm Z (conformance F11, j56)", () => {
  const two: RowSpec = { liv: 0.9, shares: [1, 1], supply: 2 };
  const one: RowSpec = { liv: 0.9, shares: [1], supply: 2 };
  const three: RowSpec = { liv: 0.9, shares: [1, 1, 1], supply: 2 };
  const z = (run: RowSpec[]) => mkJob({ stage: "mutation", arm: "Z", seed: 251, spread: 4, rate: 32, mutRate: 0, types: 3, flip: 0, edge: 0, rows: { burn: rowsOf("DC", 1).burn, run } });
  it("three censuses with two labels: LOOSE at the end of a 60-census run, not an early MONO stop", () => {
    const a = analyzeMutation(z([...Array(30).fill(three), ...Array(3).fill(two), ...Array(27).fill(two)]), "Z", {});
    expect(a).toMatchObject({ cls: "LOOSE", stoppedEarly: false, nRun: 60 });
  });
  it("three censuses with one label: the run stops there as MONO", () => {
    const a = analyzeMutation(z([...Array(30).fill(three), ...Array(3).fill(one)]), "Z", {});
    expect(a).toMatchObject({ cls: "MONO", stoppedEarly: true, nRun: 33 });
  });
  it("two censuses with one label and then two labels again: no stop", () => {
    const a = analyzeMutation(z([...Array(30).fill(three), ...Array(2).fill(one), ...Array(28).fill(three)]), "Z", {});
    expect(a.stoppedEarly).toBe(false);
  });
});
