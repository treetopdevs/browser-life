import { describe, expect, it } from "vitest";
import { type Census, type CladeOptions, type CladeResult, type Edge, type Params, type RunRecord, binomialUpperBound, CladeTree, cladeMeasures, eligibility, ELIGIBILITY, isUnder, PARAMS, parseEdgeLine, spearman, splitLines, splitRejects } from "../lib/clade-measures.ts";
import { rng } from "../lib/measures6.ts";

const e = (child: string, parent: string): Edge => {
  const [ch, cl] = child.split(":").map(Number), [ph, pl] = parent.split(":").map(Number);
  return { childHi: ch, childLo: cl, parentHi: ph, parentLo: pl };
};
const line = (x: Edge) => `${x.childHi}\t${x.childLo}\t${x.parentHi}\t${x.parentLo}`;
async function* gen<T>(xs: Iterable<T>): AsyncGenerator<T> {
  yield* xs;
}
/** Runs the measures over in-memory censuses and edges (edges sorted by childHi, header line first). */
const measure = (censuses: Iterable<Census>, edges: Edge[], opts: Partial<CladeOptions> & { horizon: number }) =>
  cladeMeasures(gen(censuses), gen(["childHi\tchildLo\tparentHi\tparentLo", ...edges.slice().sort((a, b) => a.childHi - b.childHi).map(line)]), { cadence: 1, ...opts });

/** A history: one census every `every` steps over [from, to], cells from `f(t)` (zero-cell lineages omitted). */
function history(from: number, to: number, every: number, f: (t: number) => Record<string, number>): Census[] {
  const out: Census[] = [];
  for (let t = from; t <= to; t += every) out.push([t, Object.entries(f(t)).filter(([, c]) => c > 0)]);
  return out;
}
/** Linear ramp from a (at t0) to b (at t1), rounded, constant outside. */
const ramp = (t: number, t0: number, t1: number, a: number, b: number) => Math.round(t <= t0 ? a : t >= t1 ? b : a + ((b - a) * (t - t0)) / (t1 - t0));

describe("parseEdgeLine", () => {
  it("skips the header and blank lines, parses rows, throws on malformed rows", () => {
    expect(parseEdgeLine("childHi\tchildLo\tparentHi\tparentLo")).toBeNull();
    expect(parseEdgeLine("")).toBeNull();
    expect(parseEdgeLine("7\t3\t2\t5")).toEqual({ childHi: 7, childLo: 3, parentHi: 2, parentLo: 5 });
    expect(() => parseEdgeLine("7\t3\t2")).toThrow(/malformed/);
    expect(() => parseEdgeLine("7\tx\t2\t5")).toThrow(/malformed/);
    expect(() => parseEdgeLine("7\t3\t-2\t5")).toThrow(/malformed/);
  });
});

describe("splitLines and isUnder", () => {
  it("joins a line split across chunks, drops CR, keeps a final unterminated line", async () => {
    const out: string[] = [];
    for await (const l of splitLines(gen(["childHi\tchi", "ldLo\r\n7\t3\t2", "\t5\r", "\n\n8\t1\t7\t3"]))) out.push(l);
    expect(out).toEqual(["childHi\tchildLo", "7\t3\t2\t5", "", "8\t1\t7\t3"]);
  });
  it("matches a path equal to or under the base, not a sibling with the same prefix", () => {
    expect(isUnder("/a/runs", "/a/runs")).toBe(true);
    expect(isUnder("/a/runs/m4/x", "/a/runs")).toBe(true);
    expect(isUnder("/a/runs-archive", "/a/runs")).toBe(false);
    expect(isUnder("/a", "/a/runs")).toBe(false);
  });
});

describe("CladeTree", () => {
  it("refuses an unknown parent, a parent not older than its child, a repeated child and childHi going backwards", () => {
    expect(() => new CladeTree().addEdge(e("5:1", "3:2"))).toThrow(/not a known living lineage/);
    expect(() => new CladeTree().addEdge(e("2:1", "2:3"))).toThrow(/not older/);
    const t = new CladeTree();
    t.addEdge(e("2:5", "0:1"));
    expect(() => t.addEdge(e("2:5", "0:1"))).toThrow(/repeats/);
    t.addEdge(e("4:1", "0:1"));
    expect(() => t.addEdge(e("3:1", "0:1"))).toThrow(/ordered by childHi/);
  });

  it("refuses an unknown living key, a repeated key, a key before its birth and a census that does not advance", () => {
    expect(() => new CladeTree().observe(10, [["5:5", 3]])).toThrow(/not a known living lineage/);
    const t = new CladeTree();
    expect(() => t.observe(10, [["0:1", 3], ["0:1", 2]])).toThrow(/repeats/);
    const u = new CladeTree();
    u.addEdge(e("12:1", "0:1"));
    expect(() => u.observe(10, [["12:1", 3]])).toThrow(/before its birth/);
    const v = new CladeTree();
    v.observe(10, [["0:1", 3]]);
    expect(() => v.observe(10, [["0:1", 3]])).toThrow(/follows/);
    expect(() => v.addEdge(e("9:1", "0:1"))).toThrow(/after census/);
  });

  it("computes ancestry, clade shares and the majority path, then prunes dead clades", () => {
    const t = new CladeTree();
    for (const x of [e("2:5", "0:1"), e("4:9", "0:1"), e("7:3", "2:5")]) t.addEdge(x);
    t.observe(10, [["7:3", 6], ["4:9", 4]]);
    expect(t.share("2:5")).toBeCloseTo(0.6, 12);
    expect(t.share("0:1")).toBe(1);
    expect(t.share("4:9")).toBeCloseTo(0.4, 12);
    expect(t.ancestorPresentAt("7:3", 5)).toBe("2:5");
    expect(t.ancestorPresentAt("7:3", 7)).toBe("7:3");
    expect(t.ancestorPresentAt("7:3", 1)).toBe("0:1");
    expect(t.majorityPath()).toEqual(["0:1", "2:5", "7:3"]);
    expect(t.birth("7:3")).toBe(6);
    expect(t.retained).toBe(4);
    t.observe(20, [["7:3", 6]]);
    expect(t.retained).toBe(3);
    expect(t.peakRetained).toBe(4);
    expect(() => t.addEdge(e("25:1", "4:9"))).toThrow(/not a known living lineage/);
  });

  it("puts a clade at exactly 95% on the MRCA95 walk and one at exactly 50% off the majority path", () => {
    const t = new CladeTree();
    t.addEdge(e("2:5", "0:1"));
    t.observe(10, [["2:5", 95], ["0:2", 5]]);
    expect(t.mrca()).toBe("2:5");
    t.observe(20, [["2:5", 95], ["0:2", 6]]);
    expect(t.mrca()).toBeNull();
    const u = new CladeTree();
    u.observe(10, [["0:1", 50], ["0:2", 50]]);
    expect(u.majorityPath()).toEqual([]);
    u.observe(20, [["0:1", 51], ["0:2", 49]]);
    expect(u.majorityPath()).toEqual(["0:1"]);
    const w = new CladeTree();
    w.addEdge(e("2:5", "0:1"));
    w.observe(10, [["2:5", 50], ["0:1", 50]]);
    expect(w.majorityPath()).toEqual(["0:1"]);
    w.observe(20, [["2:5", 51], ["0:1", 49]]);
    expect(w.majorityPath()).toEqual(["0:1", "2:5"]);
  });

  it("keeps shares, MRCA and the majority path right after pruning", () => {
    const t = new CladeTree();
    for (const x of [e("2:1", "0:1"), e("3:1", "0:1"), e("4:1", "2:1"), e("5:1", "3:1"), e("6:1", "3:1")]) t.addEdge(x);
    t.observe(10, [["4:1", 10], ["5:1", 10], ["6:1", 10]]);
    t.observe(20, [["5:1", 30], ["6:1", 60]]); // 2:1 and 4:1 pruned
    expect(t.retained).toBe(4);
    expect([...t.all()].map((n) => n.key)).toEqual(["0:1", "3:1", "5:1", "6:1"]);
    expect(t.share("3:1")).toBe(1);
    expect(t.share("6:1")).toBeCloseTo(2 / 3, 12);
    expect(t.mrca()).toBe("3:1");
    expect(t.majorityPath()).toEqual(["0:1", "3:1", "6:1"]);
    t.observe(30, [["6:1", 90]]);
    expect([...t.all()].map((n) => n.key)).toEqual(["0:1", "3:1", "6:1"]);
    expect(t.share("3:1")).toBe(1);
    expect(t.mrca()).toBe("6:1");
  });

  it("refuses a lineage that holds cells again after a census without any", () => {
    const t = new CladeTree();
    t.addEdge(e("2:5", "0:1"));
    t.addEdge(e("3:1", "2:5"));
    t.observe(10, [["2:5", 4], ["3:1", 4]]);
    t.observe(20, [["3:1", 8]]);
    expect(() => t.observe(30, [["2:5", 1], ["3:1", 8]])).toThrow(/holds cells again/);
  });

  it("does not revive a founder whose clade died out", () => {
    const t = new CladeTree();
    t.observe(10, [["0:1", 5], ["0:2", 5]]);
    t.observe(20, [["0:1", 5]]);
    expect(() => t.observe(30, [["0:2", 5]])).toThrow(/died out/);
  });
});

const TOY: Params = { x: 0.01, y: 0.5, W: 500, delta: 500, cut: 0.95 };

describe("TMRCA95", () => {
  it("is t minus the 95% ancestor's birth step", async () => {
    const r = await measure([[1000, [["7:3", 50], ["8:1", 50]]]], [e("2:5", "0:1"), e("7:3", "2:5"), e("8:1", "2:5")], { horizon: 1000, params: TOY });
    expect(r.tmrca95Final).toBe(999);
    expect(r.tmrcaAllFinal).toBe(999);
    expect(r.flaggedTmrca).toBe(false);
    expect(r.firstMonophyly95).toBe(1000);
  });

  it("is censored at t while two founders share the population, and defined once one dies out", async () => {
    const two = history(100, 1000, 100, () => ({ "0:1": 50, "0:2": 50 }));
    const r = await measure(two, [], { horizon: 1000, params: TOY });
    expect(r.tmrca95Final).toBe(1000);
    expect(r.tmrca95Median2).toBe(800); // t > 500: 600..1000
    expect(r.firstMonophyly95).toBeNull();
    const dies = history(100, 1000, 100, (t) => ({ "0:1": 50, "0:2": t < 600 ? 50 : 0 }));
    const d = await measure(dies, [], { horizon: 1000, params: TOY });
    expect(d.firstMonophyly95).toBe(600);
    expect(d.tmrca95Final).toBe(1000);
  });

  it("flags a final 95% ancestor born after horizon/2, not one born at it", async () => {
    const at = await measure([[1000, [["501:1", 100]]]], [e("501:1", "0:1")], { horizon: 1000, params: TOY });
    expect(at.tmrca95Final).toBe(500);
    expect(at.flaggedTmrca).toBe(false);
    const after = await measure([[1000, [["502:1", 100]]]], [e("502:1", "0:1")], { horizon: 1000, params: TOY });
    expect(after.tmrca95Final).toBe(499);
    expect(after.flaggedTmrca).toBe(true);
  });

  it("ignores a 4% relic lineage, which the exact MRCA does not", async () => {
    const r = await measure([[1000, [["2:5", 96], ["0:2", 4]]]], [e("2:5", "0:1")], { horizon: 1000, params: TOY });
    expect(r.tmrca95Final).toBe(999);
    expect(r.tmrcaAllFinal).toBe(1000);
    const flag = await measure([[1000, [["700:5", 96], ["0:2", 4]]]], [e("700:5", "0:1")], { horizon: 1000, params: TOY });
    expect(flag.tmrca95Final).toBe(301);
    expect(flag.flaggedTmrca).toBe(true);
  });
});

// Sweep histories: censuses every 1,000 steps from 2e5 (so no founder counts as newly born) to 1e6, 1,000 cells.
const SW = { horizon: 1_000_000, censusEvery: 1000 };
const sweepRun = (f: (t: number) => Record<string, number>, edges: Edge[], extra: Partial<CladeOptions> = {}) => measure(history(200_000, 1_000_000, 1000, f), edges, { ...SW, ...extra });

describe("sweeps", () => {
  it("counts a mutant clade rising from 0.5% to 60% within 5e4 steps", async () => {
    const r = await sweepRun((t) => {
      const m = ramp(t, 300_000, 350_000, 5, 600);
      return { "0:1": 1000 - m, "2:5": m };
    }, [e("2:5", "0:1")]);
    expect(r.mutantSweeps).toBe(1);
    expect(r.founderSweeps).toBe(0);
    expect(r.flaggedSweeps).toBe(true);
    expect(r.sweeps[0].clade).toBe("2:5");
    expect(r.sweeps[0].step).toBeGreaterThan(340_000);
    expect(r.sweeps[0].step).toBeLessThanOrEqual(350_000);
  });

  it("does not count the same rise spread over 2e5 steps", async () => {
    const r = await sweepRun((t) => {
      const m = ramp(t, 300_000, 500_000, 5, 600);
      return { "0:1": 1000 - m, "2:5": m };
    }, [e("2:5", "0:1")]);
    expect(r.mutantSweeps).toBe(0);
    expect(r.flaggedSweeps).toBe(false);
  });

  it("refines an event when a nested descendant crosses within W of it", async () => {
    const r = await sweepRun((t) => {
      const m = ramp(t, 300_000, 350_000, 5, 600);
      const n = Math.min(m - 1, t < 380_000 ? 5 : ramp(t, 380_000, 400_000, 5, 600));
      return { "0:1": 1000 - m, "2:5": m - n, "3:1": n };
    }, [e("2:5", "0:1"), e("3:1", "2:5")]);
    expect(r.mutantSweeps).toBe(1);
    expect(r.sweeps[0].clade).toBe("3:1");
  });

  it("counts a rise reaching 60% exactly W after the last census below 1%, not 1,000 steps later", async () => {
    // 5 cells (0.5%) up to 3e5, then 20 (2%), then 600 from `top`.
    const run = (top: number) => sweepRun((t) => {
      const m = t <= 300_000 ? 5 : t < top ? 20 : 600;
      return { "0:1": 1000 - m, "2:5": m };
    }, [e("2:5", "0:1")]);
    expect((await run(400_000)).mutantSweeps).toBe(1);
    expect((await run(401_000)).mutantSweeps).toBe(0);
  });

  it("reads 1% exactly as not below x", async () => {
    const r = await sweepRun((t) => {
      const m = t <= 300_000 ? 10 : 600;
      return { "0:1": 1000 - m, "2:5": m };
    }, [e("2:5", "0:1")]);
    expect(r.mutantSweeps).toBe(0);
  });

  it("counts a mutant as newly born only when born less than W before it crosses", async () => {
    // Born at 250,000 holding 2% (never below x); 60% from `top`.
    const run = (top: number) => sweepRun((t) => {
      const m = t < 251_000 ? 0 : t < top ? 20 : 600;
      return { "0:1": 1000 - m, "250001:5": m };
    }, [e("250001:5", "0:1")]);
    expect((await run(349_000)).mutantSweeps).toBe(1);
    expect((await run(350_000)).mutantSweeps).toBe(0);
  });

  it("counts a disjoint clade crossing within W of an event as a new event, not a refinement", async () => {
    const r = await sweepRun((t) => {
      const a = t < 352_000 ? ramp(t, 300_000, 350_000, 5, 600) : ramp(t, 352_000, 360_000, 600, 5);
      const b = t < 360_000 ? 5 : ramp(t, 360_000, 380_000, 5, 600);
      return { "0:1": 1000 - a - b, "2:5": a, "3:1": b };
    }, [e("2:5", "0:1"), e("3:1", "0:1")]);
    expect(r.mutantSweeps).toBe(2);
    expect(r.sweeps[1].step - r.sweeps[0].step).toBeLessThanOrEqual(100_000);
    expect(r.sweeps.map((s) => s.clade)).toEqual(["2:5", "3:1"]);
  });

  it("does not refine with a nested clade crossing more than W after the event", async () => {
    const r = await sweepRun((t) => {
      const m = ramp(t, 300_000, 350_000, 5, 600);
      const n = Math.min(m - 1, t < 500_000 ? 5 : ramp(t, 500_000, 520_000, 5, 600));
      return { "0:1": 1000 - m, "2:5": m - n, "3:1": n };
    }, [e("2:5", "0:1"), e("3:1", "2:5")]);
    expect(r.mutantSweeps).toBe(2);
    expect(r.sweeps.map((s) => s.clade)).toEqual(["2:5", "3:1"]);
  });

  it("evaluates every 10th census at cadence 10 and finds the same slow sweep", async () => {
    const f = (t: number) => {
      const m = ramp(t, 300_000, 360_000, 5, 600);
      return { "0:1": 1000 - m, "2:5": m };
    };
    const one = await sweepRun(f, [e("2:5", "0:1")]);
    const ten = await sweepRun(f, [e("2:5", "0:1")], { cadence: 10 });
    expect(ten.censuses).toBe(one.censuses);
    expect(one.evaluated).toBe(801);
    expect(ten.evaluated).toBe(81);
    expect(ten.mutantSweeps).toBe(1);
    expect(ten.sweeps[0].step % 10_000).toBe(0);
    expect(ten.meanCells2).toBe(one.meanCells2);
  });

  it("counts founder sweeps from the start-of-run birth clause apart from founder sweeps from below x", async () => {
    // From step 1,000 one founder of twelve (~8%) takes 60% within W: the birth clause counts it, though it was never below 1%.
    const early = await measure(history(1000, 1_000_000, 1000, (t) => {
      const a = ramp(t, 1000, 50_000, 84, 600);
      return Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`0:${i + 1}`, i ? Math.round((1000 - a) / 11) : a]));
    }), [], SW);
    expect(early.founderSweeps).toBe(1);
    expect(early.founderSweepsFromLow).toBe(0);
    const low = await sweepRun((t) => {
      const a = ramp(t, 300_000, 350_000, 5, 600);
      return { "0:1": a, "0:2": 1000 - a };
    }, []);
    expect(low.founderSweepsFromLow).toBe(1);
  });

  it("counts two disjoint clades sweeping in turn more than W apart", async () => {
    const r = await sweepRun((t) => {
      const a = t < 400_000 ? ramp(t, 300_000, 350_000, 5, 600) : ramp(t, 400_000, 450_000, 600, 5);
      const b = ramp(t, 600_000, 650_000, 5, 600);
      return { "0:1": 1000 - a - b, "2:5": a, "3:1": b };
    }, [e("2:5", "0:1"), e("3:1", "0:1")]);
    expect(r.mutantSweeps).toBe(2);
    expect(r.sweeps.map((s) => s.clade)).toEqual(["2:5", "3:1"]);
  });

  it("counts a founder's drop and rise as a founder sweep, not a mutant one", async () => {
    const r = await sweepRun((t) => {
      const a = ramp(t, 300_000, 350_000, 5, 600);
      return { "0:1": a, "0:2": 1000 - a };
    }, []);
    expect(r.founderSweeps).toBe(1);
    expect(r.mutantSweeps).toBe(0);
    expect(r.flaggedSweeps).toBe(false);
  });

  it("counts a newly born mutant as below x at its birth", async () => {
    const r = await sweepRun((t) => {
      const m = t < 300_000 ? 0 : ramp(t, 300_000, 360_000, 20, 600);
      return { "0:1": 1000 - m, "299001:5": m };
    }, [e("299001:5", "0:1")]);
    expect(r.mutantSweeps).toBe(1);
    expect(r.sweeps[0].from).toBe(299_000);
  });
});

// Replacement: censuses every 1e4 steps, Δ = 1e4.
const GR = { censusEvery: 10_000, params: { ...PARAMS } };
describe("gross clade replacement", () => {
  it("is 0 for a static composition", async () => {
    const r = await measure(history(10_000, 40_000, 10_000, () => ({ "0:1": 500, "0:2": 500 })), [], { horizon: 40_000, ...GR });
    expect(r.grossReplacement2).toBe(0);
    expect(r.netReplacement2).toBe(0);
    expect(r.intervals).toBe(3);
  });

  it("is 0.5 when one clade dies out and the other doubles; net matches over one interval", async () => {
    const r = await measure([[10_000, [["0:1", 500], ["0:2", 500]]], [20_000, [["0:2", 1000]]]], [], { horizon: 20_000, ...GR });
    expect(r.grossReplacement2).toBe(0.5);
    expect(r.netReplacement2).toBe(0.5);
  });

  it("adds up oscillations that the net change cancels", async () => {
    const cells = [500, 900, 500];
    const r = await measure(history(20_000, 40_000, 10_000, (t) => ({ "0:1": cells[t / 10_000 - 2], "0:2": 1000 - cells[t / 10_000 - 2] })), [], { horizon: 40_000, ...GR });
    expect(r.grossReplacement2).toBeCloseTo(0.4, 12);
    expect(r.netReplacement2).toBe(0);
    expect(r.grossReplacement2!).toBeGreaterThan(r.netReplacement2!);
  });

  it("is 0 when a mutant minted inside a clade takes all of its cells", async () => {
    const r = await measure([[10_000, [["0:1", 500], ["0:2", 500]]], [20_000, [["15000:7", 500], ["0:2", 500]]]], [e("15000:7", "0:1")], { horizon: 20_000, ...GR });
    expect(r.grossReplacement2).toBe(0);
  });
});

describe("second-half windows", () => {
  // Composition changes in the interval ending at horizon/2 = 20,000 (excluded); cells double after it.
  const cs: Census[] = [[10_000, [["0:1", 500], ["0:2", 500]]], [20_000, [["0:2", 1000]]], [30_000, [["0:2", 2000]]], [40_000, [["0:2", 2000]]]];
  it("uses intervals, censuses and mutation rows strictly after horizon/2", async () => {
    const r = await measure(cs, [e("20000:1", "0:2"), e("20001:1", "0:2")], { horizon: 40_000, ...GR });
    expect(r.intervals).toBe(3);
    expect(r.grossReplacement2).toBe(0);
    expect(r.netReplacement2).toBe(0);
    expect(r.meanCells2).toBe(2000);
    expect(r.mutationRows).toBe(2);
    expect(r.mutationsPer1e5_2).toBe(5); // 1 row over 2e4 steps
  });
});

describe("completeness", () => {
  const two = (to: number) => history(100, to, 100, () => ({ "0:1": 50, "0:2": 50 }));
  it("nulls the final-census values of a run that stops before the horizon", async () => {
    const r = await measure(two(900), [], { horizon: 1000, params: TOY });
    expect(r.complete).toBe(false);
    expect(r.lastCensus).toBe(900);
    expect([r.tmrca95Final, r.flaggedTmrca, r.tmrcaAllFinal, r.netReplacement2]).toEqual([null, null, null, null]);
    const full = await measure(two(1000), [], { horizon: 1000, params: TOY });
    expect(full.complete).toBe(true);
    expect(full.tmrca95Final).toBe(1000);
  });

  it("is not complete when a census is missing inside the run", async () => {
    const gap = two(1000).filter(([t]) => t !== 500);
    expect((await measure(gap, [], { horizon: 1000, params: TOY, expectedCensuses: 10 })).complete).toBe(false);
    expect((await measure(two(1000), [], { horizon: 1000, params: TOY, expectedCensuses: 10 })).complete).toBe(true);
  });

  it("is not complete when an off-grid census stands in for a missing one (same count, same last step)", async () => {
    const shifted = two(1000).map(([t, rows]): Census => [t === 600 ? 601 : t, rows]);
    const r = await measure(shifted, [], { horizon: 1000, params: TOY, expectedCensuses: 10 });
    expect(r.censuses).toBe(10);
    expect(r.lastCensus).toBe(1000);
    expect(r.complete).toBe(false);
    expect(r.tmrca95Final).toBeNull();
  });

  it("nulls the sweep flag of an incomplete run, so it leaves the flag rate's denominator", async () => {
    // A mutant of 0:1 born at step 101 takes 0:1's cells: it is born within W and its clade holds all cells, so it sweeps.
    const cs = history(100, 900, 100, (t): Record<string, number> => (t === 100 ? { "0:1": 50, "0:2": 50 } : { "101:1": 100 }));
    const short = await measure(cs, [e("101:1", "0:1")], { horizon: 1000, params: TOY });
    expect(short.mutantSweeps).toBe(1);
    expect(short.complete).toBe(false);
    expect(short.flaggedSweeps).toBeNull();
    const full = await measure([...cs, [1000, [["101:1", 100]]]], [e("101:1", "0:1")], { horizon: 1000, params: TOY });
    expect(full.complete).toBe(true);
    expect(full.flaggedSweeps).toBe(true);
  });

  it("counts edges after the last census without adding them, even with a pruned parent", async () => {
    const cs: Census[] = [[100, [["0:1", 5], ["0:2", 5]]], [200, [["0:1", 10]]]];
    const r = await measure(cs, [e("150:1", "0:1"), e("250:1", "0:2"), e("260:1", "250:1")], { horizon: 1000, censusEvery: 100, params: { ...TOY, W: 100, delta: 100 } });
    expect(r.trailingEdges).toBe(2);
    expect(r.mutationRows).toBe(3);
    expect(r.complete).toBe(false);
  });
});

describe("sanity control in unit form", () => {
  const f = (t: number) => {
    const m = ramp(t, 300_000, 350_000, 5, 600);
    const n = Math.min(m - 1, t < 380_000 ? 5 : ramp(t, 380_000, 400_000, 5, 600));
    const b = t < 700_000 ? 0 : ramp(t, 700_000, 900_000, 3, 300);
    return { "0:1": 1000 - m - b, "2:5": m - n, "3:1": n, "699001:2": b };
  };
  const edges = [e("2:5", "0:1"), e("3:1", "2:5"), e("699001:2", "0:1")];
  const scalars = (r: CladeResult) => ({ ...r, meanCells2: 0, retainedByDecile: [], livingByDecile: [], depthByDecile: [], peakRetained: 0 });

  it("is unchanged when every cell count is multiplied by 7", async () => {
    const a = await sweepRun(f, edges);
    const b = await sweepRun((t) => Object.fromEntries(Object.entries(f(t)).map(([k, c]) => [k, 7 * c])), edges);
    expect(a.mutantSweeps).toBe(1);
    expect(a.grossReplacement2!).toBeGreaterThan(0);
    expect(scalars(b)).toEqual(scalars(a));
    expect(b.meanCells2).toBeCloseTo(7 * a.meanCells2!, 6);
  });

  it("is unchanged by 1,000 extra short-lived mutants inside one clade, while the mutation rate changes", async () => {
    // Each extra mutant holds one of the founder's own cells at one census that is not a multiple of Δ, so no clade total changes.
    const extra: { t: number; key: string }[] = [];
    for (let t = 201_000; extra.length < 1000; t += 1000) if (t % 10_000) for (const lo of [101, 102]) if (extra.length < 1000) extra.push({ t, key: `${t - 500}:${lo}` });
    const at = new Map<number, string[]>();
    for (const x of extra) at.set(x.t, [...(at.get(x.t) ?? []), x.key]);
    const g = (t: number) => {
      const base = f(t), ks = at.get(t) ?? [];
      const out: Record<string, number> = { ...base, "0:1": base["0:1"] - ks.length };
      for (const k of ks) out[k] = 1;
      return out;
    };
    const a = await sweepRun(f, edges);
    const b = await sweepRun(g, [...edges, ...extra.map((x) => e(x.key, "0:1"))]);
    for (const k of ["tmrca95Median2", "tmrca95Final", "tmrcaAllFinal", "firstMonophyly95", "mutantSweeps", "founderSweeps", "sweeps", "grossReplacement2", "netReplacement2"] as const) expect(b[k]).toEqual(a[k]);
    expect(b.mutationRows).toBe(a.mutationRows + 1000);
    expect(b.mutationsPer1e5_2).toBeGreaterThan(a.mutationsPer1e5_2);
  });
});

/** A synthetic stream: 2e4 censuses 100 steps apart, 5 births per interval (1e5 edges), each lineage alive for 10 censuses. */
function stream() {
  const r = rng(7);
  const born: { key: string; i: number }[] = [];
  const edges: Edge[] = [];
  const censuses: Census[] = [];
  let start = 0;
  for (let i = 1; i <= 20_000; i++) {
    while (start < born.length && born[start].i + 10 <= i - 2) start++;
    const prev = i === 1 ? [{ key: "0:1", i: 0 }] : born.slice(start).filter((b) => b.i <= i - 1 && i - 1 < b.i + 10);
    for (let j = 0; j < 5; j++) {
      const p = prev[Math.floor(r() * prev.length)];
      const key = `${100 * (i - 1) + 1 + j}:${j}`;
      edges.push(e(key, p.key));
      born.push({ key, i });
    }
    const now = born.slice(start).filter((b) => b.i <= i && i < b.i + 10);
    censuses.push([100 * i, now.map((b, k) => [b.key, 1 + ((i + k) % 7)] as [string, number])]);
  }
  return { edges, censuses };
}

describe("streaming bound", () => {
  it("retains exactly the living lineages' ancestor paths, with correct shares after pruning", () => {
    const { edges, censuses } = stream();
    expect(edges.length).toBe(100_000);
    const parent = new Map<string, string>();
    const tree = new CladeTree();
    let k = 0, checked = 0;
    for (const [t, rows] of censuses) {
      for (; k < edges.length && edges[k].childHi <= t; k++) {
        tree.addEdge(edges[k]);
        parent.set(`${edges[k].childHi}:${edges[k].childLo}`, `${edges[k].parentHi}:${edges[k].parentLo}`);
      }
      tree.observe(t, rows);
      if (t % 100_000) continue;
      // Independently: the union of ancestor paths and every clade's cells, from the plain parent map.
      const sub = new Map<string, number>();
      for (const [key, c] of rows) for (let x: string | undefined = key; x; x = parent.get(x)) sub.set(x, (sub.get(x) ?? 0) + c);
      expect(tree.retained).toBe(sub.size);
      const total = rows.reduce((s, [, c]) => s + c, 0);
      for (const n of tree.all()) expect(n.sub).toBe(sub.get(n.key));
      for (const [key, c] of sub) expect(tree.share(key)).toBeCloseTo(c / total, 12);
      checked++;
    }
    expect(checked).toBe(20);
    expect(tree.peakRetained).toBeLessThan(edges.length / 10);
  });

  it("does not keep pruned ancestry alive through recorded sweep events", async () => {
    // Twenty disjoint 50-node chains each sweep to 60% and die while the founder survives.
    const edges: Edge[] = [];
    const f = new Map<number, [string, number][]>();
    for (let b = 0; b < 20; b++) {
      const t0 = 200_000 + b * 30_000;
      let p = "0:1";
      for (let d = 0; d < 50; d++) {
        const key = `${t0 - 5000 + d + 1}:${b}`;
        edges.push(e(key, p));
        p = key;
      }
      for (let t = t0 - 4000; t < t0 + 20_000; t += 1000) f.set(t, [[p, t < t0 ? 2 : 600]]);
    }
    const cs = history(195_000, 1_000_000, 1000, (t) => {
      const leaf = f.get(t);
      return leaf ? { "0:1": 1000 - leaf[0][1], [leaf[0][0]]: leaf[0][1] } : { "0:1": 1000 };
    });
    const r = await measure(cs, edges, SW);
    expect(r.mutantSweeps).toBe(20);
    expect(r.retainedLast).toBe(1);
    expect(r.peakRetained).toBeLessThanOrEqual(51);
  });
});

describe("eligibility", () => {
  /** A synthetic corpus in the shape of the real one; `f` overrides one record. */
  function corpus(opts: { flagged?: number; spotsOverlap?: boolean; correlated?: boolean; drop?: boolean; f?: (recs: RunRecord[]) => void } = {}): RunRecord[] {
    const r = rng(11);
    const recs: RunRecord[] = [];
    const add = (set: RunRecord["set"], preset: string, seeds: number[]) => {
      for (const seed of seeds) {
        const t = set === "treatment", cells = 900 + Math.floor(r() * 200), muts = 4000 + Math.floor(r() * 2000);
        const overlap = opts.spotsOverlap && preset === "spots-m3";
        recs.push({
          set, preset, seed, dir: `${set}/${preset}/seed-${seed}`,
          tmrca95Median2: t && !overlap ? 50_000 + r() * 1e5 : 400_000 + r() * 4e5,
          flaggedTmrca: false,
          mutantSweeps: t && !overlap ? 3 + Math.floor(r() * 4) : 0,
          flaggedSweeps: t && !overlap,
          grossReplacement2: t && !overlap ? 0.2 + r() * 0.1 : 0.01 + r() * 0.05,
          meanCells2: cells,
          mutationsPer1e5_2: muts,
        });
      }
    };
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    add("treatment", "gradient-m3", range(1, 20));
    add("treatment", "spots-m3", range(1, 10));
    add("neutral", "gradient-m3", [...range(1001, 1020), ...range(1, 20)]);
    add("neutral", "spots-m3", [...range(1001, 1020), ...range(1, 10)]);
    add("noMutation", "gradient-m3", range(1, 20));
    add("noMutation", "spots-m3", range(1, 10));
    const neutral = recs.filter((x) => x.set === "neutral");
    for (let i = 0; i < (opts.flagged ?? 0); i++) (neutral[i * 7].flaggedSweeps = true), (neutral[i * 7].mutantSweeps = 1);
    if (opts.correlated) for (const x of neutral) if (x.preset === "gradient-m3") x.grossReplacement2 = (x.meanCells2 as number) / 1e5;
    if (opts.drop) recs.splice(recs.findIndex((x) => x.set === "treatment" && x.preset === "spots-m3"), 1);
    opts.f?.(recs);
    return recs;
  }

  it("passes a clean corpus and reads the null flag bar as at most 2 of 70", () => {
    expect(binomialUpperBound(2, 70)).toBeLessThan(0.1);
    expect(binomialUpperBound(3, 70)).toBeGreaterThan(0.1);
    const two = eligibility(corpus({ flagged: 2 }));
    expect(two.complete).toBe(true);
    expect(two.eligible).toEqual({ tmrca95: true, mutantSweeps: true, grossReplacement: true });
    const three = eligibility(corpus({ flagged: 3 }));
    expect(three.eligible.mutantSweeps).toBe(false);
    expect((three.measures.mutantSweeps as any).nullFlags).toMatchObject({ flagged: 3, of: 70, passes: false });
  });

  it("needs the effect in both presets", () => {
    const x = eligibility(corpus({ spotsOverlap: true }));
    expect(x.eligible).toEqual({ tmrca95: false, mutantSweeps: false, grossReplacement: false });
    expect((x.measures.tmrca95 as any).separation["gradient-m3"]).toBe(1);
    expect((x.measures.tmrca95 as any).separation["spots-m3"]).toBeLessThan(0.8);
  });

  it("fails a measure that is a monotone function of population size in the neutral runs", () => {
    const x = eligibility(corpus({ correlated: true }));
    expect(x.eligible.grossReplacement).toBe(false);
    expect((x.measures.grossReplacement as any).sanity["gradient-m3"].meanCells2).toBeCloseTo(1, 12);
    expect(x.eligible.tmrca95).toBe(true);
  });

  it("reads incomplete when a run is missing, and never applies the flag rule to replacement", () => {
    const x = eligibility(corpus({ drop: true }));
    expect(x.complete).toBe(false);
    expect(x.eligible).toEqual({ tmrca95: "incomplete", mutantSweeps: "incomplete", grossReplacement: "incomplete" });
    expect((eligibility(corpus()).measures.grossReplacement as any).nullFlags).toBeNull();
    expect((eligibility(corpus()).measures.grossReplacement as any).rules.nullFlags).toBeNull();
  });

  it("keeps the splits of tools/t6v2.ts: 1,000 per preset, each a rate", () => {
    const x = eligibility(corpus()).measures.tmrca95 as any;
    expect(ELIGIBILITY.nSplits).toBe(1000);
    expect(x.splits["gradient-m3"]).toBeGreaterThanOrEqual(0);
    expect(x.splits["gradient-m3"]).toBeLessThanOrEqual(0.1);
    expect(x.splits["spots-m3"]).toBeLessThanOrEqual(0.1);
  });

  const neutralOf = (recs: RunRecord[], preset: string) => recs.filter((x) => x.set === "neutral" && x.preset === preset);

  it("fails a measure that is a monotone function of the mutation rate, and one correlated in spots only", () => {
    const muts = eligibility(corpus({ f: (rs) => neutralOf(rs, "gradient-m3").forEach((x) => (x.grossReplacement2 = (x.mutationsPer1e5_2 as number) / 1e5)) }));
    expect(muts.eligible.grossReplacement).toBe(false);
    expect((muts.measures.grossReplacement as any).sanity["gradient-m3"].mutationsPer1e5_2).toBeCloseTo(1, 12);
    const spots = eligibility(corpus({ f: (rs) => neutralOf(rs, "spots-m3").forEach((x) => (x.tmrca95Median2 = 4e5 + (x.meanCells2 as number) * 100)) }));
    expect(spots.eligible.tmrca95).toBe(false);
    expect((spots.measures.tmrca95 as any).rules).toMatchObject({ separation: true, sanity: false });
  });

  it("applies the ρ bar as given (|ρ| ≥ bar fails)", () => {
    // A partial correlation with population size: half the runs follow it, half are noise.
    const rs = corpus({ f: (rs) => neutralOf(rs, "gradient-m3").forEach((x, i) => i % 2 || (x.grossReplacement2 = (x.meanCells2 as number) / 1e5)) });
    const rho = Math.abs((eligibility(rs).measures.grossReplacement as any).sanity["gradient-m3"].meanCells2);
    expect(rho).toBeGreaterThan(0.2);
    expect(rho).toBeLessThan(0.9);
    expect(eligibility(rs).eligible.grossReplacement).toBe(true);
    expect(eligibility(rs, { ...ELIGIBILITY, rhoBar: rho }).eligible.grossReplacement).toBe(false);
    expect(eligibility(rs, { ...ELIGIBILITY, rhoBar: rho + 1e-9 }).eligible.grossReplacement).toBe(true);
  });

  it("passes rule 5 for a scalar constant over the neutral runs (ρ undefined), as the note states", () => {
    const x = eligibility(corpus({ f: (rs) => rs.filter((r) => r.set === "neutral").forEach((r) => (r.mutantSweeps = 0)) }));
    expect((x.measures.mutantSweeps as any).sanity["spots-m3"]).toEqual({ meanCells2: null, mutationsPer1e5_2: null });
    expect((x.measures.mutantSweeps as any).rules.sanity).toBe(true);
    expect(x.eligible.mutantSweeps).toBe(true);
  });

  it("reads incomplete for a missing scalar, an incomplete run or a missing no-mutation run", () => {
    const nul = eligibility(corpus({ f: (rs) => (neutralOf(rs, "gradient-m3")[3].tmrca95Median2 = null) }));
    expect(nul.eligible).toEqual({ tmrca95: "incomplete", mutantSweeps: true, grossReplacement: true });
    const ext = eligibility(corpus({ f: (rs) => (neutralOf(rs, "spots-m3")[0].complete = false) }));
    expect(ext.eligible).toEqual({ tmrca95: "incomplete", mutantSweeps: "incomplete", grossReplacement: "incomplete" });
    expect(ext.incompleteRuns).toEqual(["neutral/spots-m3/seed-1001"]);
    const nm = eligibility(corpus({ f: (rs) => rs.splice(rs.findIndex((x) => x.set === "noMutation"), 1) }));
    expect(nm.complete).toBe(false);
    expect(nm.eligible.tmrca95).toBe("incomplete");
  });

  it("needs a flag on every one of the 70 neutral runs", () => {
    const x = eligibility(corpus({ f: (rs) => (neutralOf(rs, "gradient-m3")[0].flaggedTmrca = null) }));
    expect((x.measures.tmrca95 as any).nullFlags).toMatchObject({ flagged: 0, of: 69, passes: false });
    expect(x.eligible.tmrca95).toBe(false);
  });

  it("splits: A takes the treatment role, in the measure's expected direction, and the bar gates", () => {
    const lo = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], hi = lo.map((v) => v + 100);
    expect(splitRejects(hi, lo, "treatment")).toBe(true);
    expect(splitRejects(lo, hi, "treatment")).toBe(false);
    expect(splitRejects(lo, hi, "neutral")).toBe(true);
    expect(splitRejects(hi, lo, "neutral")).toBe(false);
    const rs = corpus();
    const rate = (eligibility(rs).measures.grossReplacement as any).splits["gradient-m3"];
    expect(rate).toBeGreaterThan(0);
    const x = eligibility(rs, { ...ELIGIBILITY, splitBar: rate / 2 });
    expect((x.measures.grossReplacement as any).rules.splits).toBe(false);
    expect(x.eligible.grossReplacement).toBe(false);
  });

  it("spearman: 1 for a monotone relation, null for a constant", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 35, 1000])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    expect(spearman([1, 2, 3], [5, 5, 5])).toBeNull();
  });
});
