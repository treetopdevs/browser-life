// The matched-null amendment (docs/clade-measures-2026-10-18.md, "Amendment: a null matched on demography").
import { describe, expect, it } from "vitest";
import { type RunRecord, type V1Rules, logRatios, MATCHING, matchedReadout, matchingTable, matchRuns, signTestP, withinSetEffect } from "../lib/clade-measures.ts";

type Set = RunRecord["set"];
/** A run with covariates (cells, living lineages, mutation rows) and measure scalars. */
const run = (set: Set, preset: string, i: number, cov: [number, number, number], s: Partial<Record<"tmrca95Median2" | "mutantSweeps" | "grossReplacement2", number | null>> = {}, flags: { flaggedTmrca?: boolean; flaggedSweeps?: boolean } = {}): RunRecord => ({
  set, preset, seed: i, dir: `runs/${set}/${preset}/seed-${String(i).padStart(2, "0")}`,
  meanCells2: cov[0], livingLast: cov[1], mutationsPer1e5_2: cov[2],
  tmrca95Median2: 100, mutantSweeps: 5, grossReplacement2: 0.5, flaggedTmrca: false, flaggedSweeps: false, complete: true,
  ...s, ...flags,
});
const G = "gradient-m3", S = "spots-m3";
const PASSING: V1Rules = { complete: true, separation: false, nullFlags: null, splits: true, sanity: true };
const RULE3_FAILS: V1Rules = { complete: true, separation: false, nullFlags: false, splits: true, sanity: true };
const V1 = { tmrca95: RULE3_FAILS, mutantSweeps: RULE3_FAILS, grossReplacement: PASSING };

/** A full synthetic corpus: 20/10 treatment, 40/30 neutral; treatment run i is matchable iff i < matchedG (or matchedS). */
function corpus(o: { matchedG: number; matchedS: number; tGross: (preset: string, i: number) => number; tTmrca?: (preset: string, i: number) => number }) {
  const rs: RunRecord[] = [];
  for (const [p, nT, nN, m] of [[G, 20, 40, o.matchedG], [S, 10, 30, o.matchedS]] as const) {
    for (let j = 0; j < nN; j++) rs.push(run("neutral", p, j, [1000 + j, 100, 5000], { grossReplacement2: 0.5, tmrca95Median2: 100 }));
    for (let i = 0; i < nT; i++) {
      const cov: [number, number, number] = i < m ? [1000 + i, 100, 5000] : [1000, 400, 5000]; // 4x lineages: unmatchable
      rs.push(run("treatment", p, i, cov, { grossReplacement2: o.tGross(p, i), tmrca95Median2: o.tTmrca ? o.tTmrca(p, i) : 100 }));
    }
  }
  return rs;
}
const preset = (r: ReturnType<typeof matchedReadout>, m: string, p: string) => (r.measures[m] as any).presets[p];

describe("matching", () => {
  it("caliper is inclusive: a ratio of exactly 1.10 either way is admissible, 1.1001 is not, on any single covariate", () => {
    const at = (c: number, v: number): [number, number, number] => [0, 1, 2].map((i) => (i === c ? v : 100)) as [number, number, number];
    const admits = (t: [number, number, number], n: [number, number, number]) => matchRuns([run("treatment", G, 0, t)], [run("neutral", G, 1, n)], 1.1, 3)[0].neutrals.length === 1;
    for (const c of [0, 1, 2]) {
      expect(admits(at(c, 100), at(c, 110))).toBe(true);
      expect(admits(at(c, 110), at(c, 100))).toBe(true);
      expect(admits(at(c, 100), at(c, 110.01))).toBe(false);
      expect(admits(at(c, 110.01), at(c, 100))).toBe(false);
    }
    expect(admits([100, 100, 100], [110, 110, 110])).toBe(true);
    expect(admits([110, 110, 110], [100, 100, 100])).toBe(true);
    expect(MATCHING.caliperRatio).toBe(1.1);
  });

  it("d_c is symmetric to the last bit", () => {
    const a = run("treatment", G, 0, [110, 37, 9001]), b = run("neutral", G, 1, [100, 41, 8999]);
    expect(logRatios(a, b, MATCHING.covariates)!.d).toEqual(logRatios(b, a, MATCHING.covariates)!.d);
    expect(logRatios(a, b, MATCHING.covariates)!.d[0]).toBeCloseTo(Math.log(1.1), 15);
  });

  it("matches within preset only", () => {
    const T = run("treatment", G, 0, [100, 100, 100]);
    expect(matchRuns([T], [run("neutral", S, 1, [100, 100, 100])], 1.1, 3)[0].neutrals).toEqual([]);
    expect(matchRuns([T], [run("neutral", S, 1, [100, 100, 100]), run("neutral", G, 2, [105, 100, 100])], 1.1, 3)[0].neutrals.map((n) => n.dir)).toEqual(["runs/neutral/gradient-m3/seed-02"]);
  });

  it("takes the k nearest by Euclidean norm, equal norms ordered by directory", () => {
    const T = run("treatment", G, 0, [100, 100, 100]);
    const N = [run("neutral", G, 5, [108, 100, 100]), run("neutral", G, 4, [100, 102, 100]), run("neutral", G, 3, [100, 100, 102]), run("neutral", G, 2, [102, 100, 100]), run("neutral", G, 1, [100, 100, 101])];
    // Norms: seed-01 ln 1.01; seed-02, -03, -04 ln 1.02 (tied); seed-05 ln 1.08.
    expect(matchRuns([T], N, 1.1, 3)[0].neutrals.map((n) => n.dir)).toEqual(["runs/neutral/gradient-m3/seed-01", "runs/neutral/gradient-m3/seed-02", "runs/neutral/gradient-m3/seed-03"]);
    expect(matchRuns([T], N, 1.1, 10)[0].neutrals).toHaveLength(5);
  });

  it("matches with replacement: two treatment runs share one neutral run", () => {
    const rs = [run("treatment", G, 0, [100, 100, 100]), run("treatment", G, 1, [101, 100, 100]), run("neutral", G, 9, [100, 100, 100])];
    const m = matchRuns(rs.slice(0, 2), rs.slice(2), 1.1, 3);
    expect(m.map((x) => x.neutrals.map((n) => n.dir))).toEqual([["runs/neutral/gradient-m3/seed-09"], ["runs/neutral/gradient-m3/seed-09"]]);
  });

  it("leaves a treatment run unmatched with no admissible neutral or a missing covariate; a neutral with a missing covariate is never admissible", () => {
    const T = run("treatment", G, 0, [100, 100, 100]);
    expect(matchRuns([T], [run("neutral", G, 1, [100, 200, 100])], 1.1, 3)[0].neutrals).toEqual([]);
    expect(matchRuns([{ ...T, livingLast: null }], [run("neutral", G, 1, [100, 100, 100])], 1.1, 3)[0].neutrals).toEqual([]);
    expect(matchRuns([T], [{ ...run("neutral", G, 1, [100, 100, 100]), mutationsPer1e5_2: undefined }], 1.1, 3)[0].neutrals).toEqual([]);
    expect(matchRuns([T], [run("neutral", G, 1, [0, 100, 100])], 1.1, 3)[0].neutrals).toEqual([]);
  });

  it("matchingTable reports the nearest neutral run by largest ratio whatever the caliper", () => {
    const rs = [run("treatment", G, 0, [100, 300, 100]), run("neutral", G, 1, [100, 100, 100]), run("neutral", G, 2, [100, 150, 100]), run("treatment", S, 0, [1, 1, 1])];
    const t = matchingTable(rs);
    expect(t[G][0].neutrals).toEqual([]);
    expect(t[G][0].nearest).toEqual({ dir: "runs/neutral/gradient-m3/seed-02", maxRatio: 2 });
    expect(t[S][0].nearest).toBeNull();
  });
});

describe("withinSetEffect and signTestP", () => {
  it("scores the expected direction, ties as 0.5", () => {
    expect(withinSetEffect(5, [1, 5, 9], "treatment")).toBeCloseTo(0.5, 15);
    expect(withinSetEffect(5, [6, 7, 8], "neutral")).toBe(1);
    expect(withinSetEffect(5, [6, 7, 8], "treatment")).toBe(0);
    expect(withinSetEffect(5, [5], "neutral")).toBe(0.5);
    expect(() => withinSetEffect(5, [], "neutral")).toThrow();
  });

  it("is the exact one-sided binomial tail", () => {
    expect(signTestP(5, 5)).toBe(1 / 32);
    expect(signTestP(4, 5)).toBe(6 / 32);
    expect(signTestP(0, 0)).toBe(1);
    expect(signTestP(0, 7)).toBe(1);
    expect(signTestP(15, 20)).toBeCloseTo((15504 + 4845 + 1140 + 190 + 20 + 1) / 2 ** 20, 15);
    expect(() => signTestP(6, 5)).toThrow();
  });
});

describe("matchedReadout", () => {
  it("is unmatchable below the floor: 9 of 20 gradient fails, 5 of 10 spots is matchable", () => {
    const r = matchedReadout(corpus({ matchedG: 9, matchedS: 5, tGross: () => 0.9 }), V1);
    const g = preset(r, "grossReplacement", G), s = preset(r, "grossReplacement", S);
    expect([g.status, g.matched, g.needed]).toEqual(["unmatchable", 9, 10]);
    expect([s.status, s.matched, s.needed]).toEqual(["pass", 5, 5]);
    expect(s.pSign).toBe(1 / 32);
    expect(r.matchedSeparation.grossReplacement).toBe(false);
    expect(r.matchedCandidate.grossReplacement).toBe(false);
  });

  it("passes in both presets: gross replacement becomes a matched candidate, TMRCA95 does not because v1 rule 3 failed", () => {
    const rs = corpus({ matchedG: 10, matchedS: 5, tGross: () => 0.9, tTmrca: () => 10 });
    const r = matchedReadout(rs, V1);
    for (const m of ["grossReplacement", "tmrca95"]) for (const p of [G, S]) expect(preset(r, m, p).status).toBe("pass");
    expect(r.matchedSeparation).toEqual({ tmrca95: true, mutantSweeps: false, grossReplacement: true });
    expect(r.matchedCandidate).toEqual({ tmrca95: false, mutantSweeps: false, grossReplacement: true });
    const g = preset(r, "grossReplacement", G);
    expect([g.meanE, g.positives, g.negatives, g.ties, g.nPrime]).toEqual([1, 10, 0, 0, 10]);
    expect(g.medianDiff).toBeCloseTo(0.4, 12);
    // Treatment run i (i < 10) has cells 1000 + i; nearest neutrals are 1000 + i and its neighbours within 1.10.
    expect(g.matchedSets).toHaveLength(10);
    expect(g.distinctNeutrals).toBeGreaterThanOrEqual(3);
    expect(g.balance.livingLast).toBe(0);
    // Mutant sweeps tie everywhere (all 5): every e_i is 0.5, n' = 0, so it fails.
    const ms = preset(r, "mutantSweeps", G);
    expect([ms.status, ms.ties, ms.nPrime, ms.pSign]).toEqual(["fail", 10, 0, 1]);
    expect(ms.matchedNeutralFlags).toEqual({ flagged: 0, of: ms.distinctNeutrals });
  });

  it("fails when matched but the effect is small, and reads mixed as not separated", () => {
    // Gradient: half the matched runs above, half below -> mean e 0.5, fail. Spots: pass.
    const rs = corpus({ matchedG: 10, matchedS: 5, tGross: (p, i) => (p === S ? 0.9 : i % 2 ? 0.9 : 0.1) });
    const r = matchedReadout(rs, V1);
    expect(preset(r, "grossReplacement", G).status).toBe("fail");
    expect(preset(r, "grossReplacement", G).meanE).toBe(0.5);
    expect(preset(r, "grossReplacement", S).status).toBe("pass");
    expect(r.matchedSeparation.grossReplacement).toBe(false);
    expect(r.matchedCandidate.grossReplacement).toBe(false);
  });

  it("fails with mean e at the bar but n' below 5 (ties dropped)", () => {
    // Spots: 5 matched, 4 beat their neutrals, 1 ties -> mean e 0.9 but n' = 4 < 5.
    const rs = corpus({ matchedG: 10, matchedS: 5, tGross: (p, i) => (p === S && i === 0 ? 0.5 : 0.9) });
    const s = preset(matchedReadout(rs, V1), "grossReplacement", S);
    expect([s.status, s.meanE, s.nPrime, s.ties]).toEqual(["fail", 0.9, 4, 1]);
  });

  it("fails when mean e is below the 0.8 bar although the sign test passes, and passes exactly at 0.8", () => {
    // Spots, 10 matched runs: all beat their 3 neutrals but one set loses 1 of 3 (e = 2/3) -> still above; use e = 0.75 via 2 neutrals.
    const mk = (eForRuns: (i: number) => number) => {
      const rs = corpus({ matchedG: 10, matchedS: 10, tGross: (p, i) => (p === S ? eForRuns(i) : 0.9) });
      return preset(matchedReadout(rs, V1), "grossReplacement", S);
    };
    // Neutral gross = 0.5. A run at 0.9 scores 1; at 0.1 scores 0. 8 of 10 high -> mean e 0.8 (the bar, inclusive), n' = 10, p = 0.0547.
    const atBar = mk((i) => (i < 8 ? 0.9 : 0.1));
    expect([atBar.meanE, atBar.positives, atBar.negatives]).toEqual([0.8, 8, 2]);
    expect(atBar.pSign).toBeCloseTo(56 / 1024, 12);
    expect(atBar.status).toBe("fail"); // p >= 0.05 although the bar is met
    // 9 of 10 high -> mean 0.9, p = 11/1024 -> pass; 7 of 10 -> mean 0.7 < bar even though p would be 0.17 anyway.
    expect(mk((i) => (i < 9 ? 0.9 : 0.1)).status).toBe("pass");
    expect(mk((i) => (i < 7 ? 0.9 : 0.1)).status).toBe("fail");
  });

  it("is order-free and exact with matched sets of different sizes and fractional effects", () => {
    // Every treatment run here has 6 admissible neutrals and keeps the 3 nearest (ties by directory); set sizes 1-3 are covered by withinSetEffect below.
    const mkRecs = () => {
      const rs: RunRecord[] = [];
      for (let j = 0; j < 6; j++) rs.push(run("neutral", G, j, [1000, 100, 5000], { grossReplacement2: j / 10 }));
      for (let i = 0; i < 20; i++) rs.push(run("treatment", G, i, [1000, 100, 5000], { grossReplacement2: 0.25 }));
      for (let j = 0; j < 30; j++) rs.push(run("neutral", S, j, [1000, 100, 5000]));
      for (let i = 0; i < 10; i++) rs.push(run("treatment", S, i, [1000, 100, 5000]));
      return rs;
    };
    const a = matchedReadout(mkRecs(), V1), b = matchedReadout(mkRecs().reverse(), V1);
    const ga = preset(a, "grossReplacement", G), gb = preset(b, "grossReplacement", G);
    // Each treatment run has the 3 nearest of 6 neutrals (values 0, .1, .2 by directory tiebreak); 0.25 beats all: e = 1.
    expect(ga.meanE).toBe(1);
    expect(gb.meanE).toBe(ga.meanE);
    expect(gb.matchedSets.map((x: any) => x.dir).sort()).toEqual(ga.matchedSets.map((x: any) => x.dir).sort());
    expect(withinSetEffect(0.25, [0.4], "treatment")).toBe(0);
    // Mixed sizes: e = 1 (k=1), 0.5 (k=2: one win one loss), 1/3 (k=3) -> exact sum is order-free.
    const es = [withinSetEffect(2, [1], "treatment"), withinSetEffect(2, [1, 3], "treatment"), withinSetEffect(2, [1, 3, 4], "treatment")];
    expect(es).toEqual([1, 0.5, 1 / 3]);
  });

  it("drops a neutral run with a missing scalar from that measure's pool only", () => {
    const rs = corpus({ matchedG: 10, matchedS: 5, tGross: () => 0.9 });
    const target = rs.find((x) => x.set === "neutral" && x.preset === G && x.seed === 0)!;
    target.grossReplacement2 = null;
    const r = matchedReadout(rs, V1);
    const setOf = (m: string) => preset(r, m, G).matchedSets.find((x: any) => x.dir === "runs/treatment/gradient-m3/seed-00").neutrals;
    expect(setOf("tmrca95")).toContain(target.dir);
    expect(setOf("grossReplacement")).not.toContain(target.dir);
    expect(setOf("grossReplacement")).toHaveLength(3);
    expect(matchingTable(rs)[G][0].neutrals.map((n) => n.dir)).toContain(target.dir);
    expect(preset(r, "grossReplacement", G).status).toBe("pass");
  });

  it("leaves a treatment run with a missing scalar out of that measure, counting it in n_T", () => {
    const rs = corpus({ matchedG: 10, matchedS: 5, tGross: () => 0.9 });
    rs.find((x) => x.set === "treatment" && x.preset === S && x.seed === 0)!.grossReplacement2 = null;
    const r = matchedReadout(rs, V1);
    expect([preset(r, "grossReplacement", S).status, preset(r, "grossReplacement", S).matched, preset(r, "grossReplacement", S).treatmentRuns]).toEqual(["unmatchable", 4, 10]);
    expect(preset(r, "tmrca95", S).matched).toBe(5);
  });

  it("reports a ladder that never decreases as the caliper widens, and per-covariate block counts", () => {
    const rs: RunRecord[] = [];
    for (let j = 0; j < 30; j++) rs.push(run("neutral", G, j, [100, 100, 100]));
    // Treatment lineages at ratios 1.03, 1.08, 1.15, 1.4, 2 ... (cells and mutation rows always match).
    const ratios = [1.03, 1.08, 1.15, 1.4, 2, 1.03, 1.08, 1.15, 1.4, 2, 1.03, 1.08, 1.15, 1.4, 2, 1.03, 1.08, 1.15, 1.4, 2];
    ratios.forEach((x, i) => rs.push(run("treatment", G, i, [100, 100 * x, 100])));
    for (let j = 0; j < 30; j++) rs.push(run("neutral", S, j, [100, 100, 100]));
    for (let i = 0; i < 10; i++) rs.push(run("treatment", S, i, [100, 100, 100]));
    const g = preset(matchedReadout(rs, V1), "tmrca95", G);
    expect(g.ladder).toEqual({ "1.05": 4, "1.1": 8, "1.2": 12, "1.5": 16 });
    const counts = Object.values(g.ladder) as number[];
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(g.perCovariate).toEqual({ meanCells2: 20, livingLast: 8, mutationsPer1e5_2: 20 });
    expect([g.status, g.matched]).toEqual(["unmatchable", 8]);
  });

  it("throws without v1 rules for a measure", () => {
    expect(() => matchedReadout(corpus({ matchedG: 10, matchedS: 5, tGross: () => 0.9 }), { tmrca95: PASSING, mutantSweeps: PASSING } as any)).toThrow(/no v1 rules/);
  });
});
