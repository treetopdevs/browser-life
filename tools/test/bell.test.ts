import { describe, expect, it } from "vitest";
import {
  BellScorer,
  GRID,
  PRIMARY,
  RATE_LAG,
  RollingMin,
  SIGNALS,
  SignalExtractor,
  binomialUpperBound,
  checkGroupIdentity,
  corpusRuns,
  defaultOutputs,
  departure,
  dominantShare,
  entryOf,
  finiteOrZero,
  mergeCensuses,
  parseManifest,
  parseSeries,
  planGroup,
  quantileDrop,
  recordRefusal,
  splitLines,
  summarize,
  type CorpusRun,
  type ScoredEntry,
} from "../lib/bell.ts";
import { quantileSorted } from "../lib/measures6.ts";

async function* gen<T>(xs: T[]): AsyncGenerator<T> {
  for (const x of xs) yield x;
}
function prng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const IDX = Object.fromEntries(SIGNALS.map((s, i) => [s.name, i])) as Record<string, number>;
const NS = SIGNALS.length;

describe("signals", () => {
  it("has the thirteen signals of the note with their floors", () => {
    expect(NS).toBe(13);
    expect(SIGNALS.filter((s) => s.kind === "rate").map((s) => s.name)).toEqual(["fissions", "fusions", "buddings", "mutations"]);
    expect(SIGNALS.find((s) => s.name === "dominantShare")!.source).toBe("lineages");
    expect(SIGNALS.filter((s) => s.floor === 0.01).map((s) => s.name)).toEqual(["lineageShannon", "patternEntropy", "bioticRecycling", "dominantShare"]);
    expect(SIGNALS.filter((s) => s.floor === 1).length).toBe(9);
  });
});

describe("quantiles and spread", () => {
  it("quantileDrop equals quantileSorted of the array with the entry filtered out (bit for bit)", () => {
    const r = prng(1);
    for (let trial = 0; trial < 200; trial++) {
      const n = 1 + Math.floor(r() * 12);
      const xs = Array.from({ length: n }, () => Math.round(r() * 20) / 4).sort((a, b) => a - b);
      for (const q of [0.25, 0.5, 0.75]) {
        expect(quantileDrop(xs, Infinity, n, q)).toBe(quantileSorted(xs, q));
        if (n >= 2) {
          for (let k = 0; k < n; k++) {
            const rest = xs.filter((_, i) => i !== k);
            expect(quantileDrop(xs, k, n - 1, q)).toBe(quantileSorted(rest, q));
          }
        }
      }
    }
  });

  it("z uses the IQR/1.349 spread when it is the largest", () => {
    const ref = [0, 10, 20, 30, 40]; // median 20, IQR 20
    const d = departure(50, ref, Infinity, 1);
    expect(d.median).toBe(20);
    expect(d.spread).toBeCloseTo(20 / 1.349, 12);
    expect(d.z).toBeCloseTo(30 / (20 / 1.349), 12);
  });
  it("floors the spread relative to the median (5%)", () => {
    const d = departure(1100, [1000, 1000, 1000], Infinity, 1);
    expect(d.spread).toBe(50);
    expect(d.z).toBe(2);
    // The relative floor uses |median|.
    expect(departure(-1100, [-1000, -1000, -1000], Infinity, 1).spread).toBe(50);
  });
  it("floors the spread at the signal's absolute floor", () => {
    expect(departure(0.5, [0, 0, 0], Infinity, 0.01).spread).toBe(0.01);
    expect(departure(0.5, [0, 0, 0], Infinity, 0.01).z).toBe(50);
    expect(departure(3, [0, 0, 0], Infinity, 1).spread).toBe(1);
    // A median whose 5% is below the floor: the floor wins.
    expect(departure(11, [10, 10, 10], Infinity, 1).spread).toBe(1);
  });
  it("throws when no reference value is left", () => {
    expect(() => departure(1, [5], 0, 1)).toThrow();
  });
});

describe("signal extraction", () => {
  it("counts a missing or non-finite value as 0", () => {
    expect(finiteOrZero(undefined)).toBe(0);
    expect(finiteOrZero(NaN)).toBe(0);
    expect(finiteOrZero(Infinity)).toBe(0);
    expect(finiteOrZero("3")).toBe(0);
    expect(finiteOrZero(-2.5)).toBe(-2.5);
    const x = new SignalExtractor().push({ livingCells: NaN, individuals: 4, meanMass: Infinity }, []);
    expect(x[IDX.livingCells]).toBe(0);
    expect(x[IDX.individuals]).toBe(4);
    expect(x[IDX.meanMass]).toBe(0);
    expect(x[IDX.lineages]).toBe(0);
    expect(x.slice(0, IDX.fissions).every((v) => v !== null)).toBe(true);
  });

  it("dominantShare is the largest lineage over all living cells, 0 for an empty census", () => {
    expect(dominantShare([["a", 30], ["b", 70]])).toBe(0.7);
    expect(dominantShare([])).toBe(0);
    expect(dominantShare([["a", 0], ["b", 0]])).toBe(0);
    expect(dominantShare([["a", NaN], ["b", 5]])).toBe(1);
    const e = new SignalExtractor();
    expect(e.push({}, [])[IDX.dominantShare]).toBe(0);
    expect(e.push({}, [["a", 1], ["b", 3]])[IDX.dominantShare]).toBe(0.75);
  });

  it("rates are the increase over 10 censuses and undefined before the 10th earlier census", () => {
    const e = new SignalExtractor();
    const out: (number | null)[][] = [];
    for (let c = 0; c < 25; c++) out.push(e.push({ fissions: c * c, fusions: 3 * c, buddings: 0, mutations: 5 }, []));
    for (let c = 0; c < RATE_LAG; c++) expect(out[c][IDX.fissions]).toBeNull();
    for (let c = RATE_LAG; c < 25; c++) {
      expect(out[c][IDX.fissions]).toBe(c * c - (c - RATE_LAG) * (c - RATE_LAG));
      expect(out[c][IDX.fusions]).toBe(30);
      expect(out[c][IDX.mutations]).toBe(0);
    }
    // A non-finite cumulative value counts as 0 before differencing.
    const f = new SignalExtractor();
    for (let c = 0; c < RATE_LAG; c++) f.push({ fissions: c === 0 ? NaN : 5 }, []);
    expect(f.push({ fissions: 7 }, [])[IDX.fissions]).toBe(7);
  });
});

describe("RollingMin", () => {
  it("equals the naive minimum of the last W values", () => {
    const r = prng(7);
    for (const W of [1, 2, 5, 17]) {
      const rm = new RollingMin(W);
      const xs: number[] = [];
      for (let i = 0; i < 300; i++) {
        const v = Math.round(r() * 30) / 3 - 5;
        xs.push(v);
        rm.push(i, v);
        expect(rm.min()).toBe(Math.min(...xs.slice(Math.max(0, i - W + 1))));
      }
    }
  });
  it("starts over after clear", () => {
    const rm = new RollingMin(3);
    rm.push(0, -100);
    rm.clear();
    rm.push(1, 4);
    expect(rm.min()).toBe(4);
  });
});

// ---------------------------------------------------------------------------------------------
// Scorer.

/** A signal vector with the livingCells level set and everything else constant; rates null before the 10th census. */
function vec(c: number, living: number, others = 100): (number | null)[] {
  return SIGNALS.map((s) => (s.name === "livingCells" ? living : s.kind === "rate" ? (c < RATE_LAG ? null : 0) : s.name === "dominantShare" ? 0.5 : others));
}
const CAD = 1000; // steps 1000, 2000, ...; burn-in at 10,000 is census index 9
interface Run {
  living: number[]; // per census
}
function scoreSimple(runs: Run[], members: number[], scored: number, opts: { W?: number[]; Z?: number[]; burnIn?: number } = {}) {
  const T = runs[0].living.length;
  const sc = new BellScorer(runs.map((_, i) => `r${i}`), [{ id: "env", members }], [{ id: "s", run: scored, envelope: "env" }], { cadence: CAD, ...opts });
  for (let c = 0; c < T; c++) sc.push(runs.map((r) => ({ step: (c + 1) * CAD, values: vec(c, r.living[c]) })));
  return sc.results()[0];
}
/** Three constant reference runs at 1000 (spread 50) and one scored run with the given levels. */
function against(levels: number[], opts: Parameters<typeof scoreSimple>[3] = {}) {
  const ref = { living: levels.map(() => 1000) };
  return scoreSimple([ref, ref, ref, { living: levels }], [0, 1, 2], 3, opts);
}
const Wi = (w: number) => GRID.W.indexOf(w as never);

describe("the departure score", () => {
  it("requires W consecutive censuses: 49 at +4 sigma do not ring at W=50, 50 do", () => {
    const T = 9 + 55; // first counted census is index 9 (step 10,000)
    const lv = (n: number, from = 9) => Array.from({ length: T }, (_, c) => (c >= from && c < from + n ? 1200 : 1000));
    const r49 = against(lv(49));
    expect(r49.D[Wi(50)]).toBeLessThan(PRIMARY.Z);
    expect(r49.receipts.filter((x) => x.Z === 4 && x.W === 50)).toEqual([]);
    const r50 = against(lv(50));
    expect(r50.D[Wi(50)]).toBe(4);
    const ring = r50.receipts.filter((x) => x.Z === 4 && x.W === 50);
    expect(ring.length).toBe(1);
    expect(ring[0]).toMatchObject({ signal: "livingCells", side: "high", startStep: 10_000, endStep: 10_000 + 49 * CAD, minAbsZ: 4, value: 1200, median: 1000 });
  });

  it("a sign flip breaks the window", () => {
    const T = 9 + 120;
    const lv = Array.from({ length: T }, (_, c) => (c < 9 ? 1000 : c === 9 + 40 ? 800 : 1200));
    const r = against(lv);
    // 40 at +4 sigma, one at -4 sigma, 79 at +4: the longest same-side run is 79, so W=50 rings through the second stretch only.
    expect(r.D[Wi(50)]).toBe(4);
    const ring = r.receipts.find((x) => x.Z === 4 && x.W === 50 && x.signal === "livingCells" && x.side === "high")!;
    expect(ring.startStep).toBe(10_000 + 41 * CAD);
    const lowSide = r.receipts.filter((x) => x.signal === "livingCells" && x.side === "low");
    expect(lowSide).toEqual([]);
    // With the flip in the middle of every possible 50-window nothing rings.
    const lv2 = Array.from({ length: 9 + 90 }, (_, c) => (c < 9 ? 1000 : (c - 9) % 45 === 44 ? 800 : 1200));
    expect(against(lv2).D[Wi(50)]).toBeLessThan(4);
  });

  it("reports the low side too", () => {
    const lv = Array.from({ length: 9 + 50 }, (_, c) => (c < 9 ? 1000 : 800));
    const r = against(lv);
    expect(r.D[Wi(50)]).toBe(4);
    expect(r.receipts.find((x) => x.Z === 4 && x.W === 50)!).toMatchObject({ side: "low", value: 800, median: 1000 });
  });

  it("never counts a window that starts before step 10,000", () => {
    // Elevated from index 8 (step 9,000) for 50 censuses: only 49 of them are at or after step 10,000.
    const T = 8 + 50;
    const lv = Array.from({ length: T }, (_, c) => (c >= 8 ? 1200 : 1000));
    expect(against(lv).D[Wi(50)]).toBeLessThan(4);
    // Elevated the whole time with total length 9 + 49 counted censuses: still short; and one more makes it ring.
    expect(against(Array.from({ length: 9 + 49 }, () => 1200)).D[Wi(50)]).toBeLessThan(4);
    const r = against(Array.from({ length: 9 + 50 }, () => 1200));
    expect(r.D[Wi(50)]).toBe(4);
    expect(r.receipts.find((x) => x.W === 50 && x.Z === 4)!.startStep).toBe(10_000);
    // The burn-in is an option for the tests only; the default is the note's 10,000.
    expect(against(Array.from({ length: 50 }, () => 1200), { burnIn: 0 }).D[Wi(50)]).toBe(4);
  });

  it("a run shorter than a window has no counted window and D = 0", () => {
    const r = against(Array.from({ length: 12 }, () => 1200));
    expect(r.D[Wi(200)]).toBe(0);
    expect(r.windows[Wi(200)]).toBe(0);
    expect(r.windows[Wi(10)]).toBe(0);
  });

  it("rates start late: a rate cannot ring before it is defined", () => {
    // Fed through the extractor, as the CLI does. The scored run's cumulative counter is already large at census 0 and the
    // references' is 0, so a rate that were read from census 0 (or from a missing earlier census as 0) would ring at index 0.
    // Defined only from the 10th earlier census, the first possible rate window (burn-in 0, W = 10) starts at index 10.
    const T = 40, W = 10;
    const sc = new BellScorer(["a", "b", "c", "x"], [{ id: "e", members: [0, 1, 2] }], [{ id: "s", run: 3, envelope: "e" }], { cadence: CAD, burnIn: 0, W: [W], Z: [3] });
    const ex = [0, 1, 2, 3].map(() => new SignalExtractor());
    for (let c = 0; c < T; c++) {
      const rec = (hi: boolean) => ({ fissions: hi ? 1000 + 100 * c : 0 });
      sc.push([0, 1, 2, 3].map((r) => ({ step: (c + 1) * CAD, values: ex[r].push(rec(r === 3), []) })));
    }
    const r = sc.results()[0];
    const fis = r.receipts.filter((x) => x.signal === "fissions");
    expect(fis.length).toBe(1);
    expect(fis[0].startStep).toBe((RATE_LAG + 1) * CAD); // index 10
    expect(fis[0].endStep).toBe((RATE_LAG + W) * CAD);
    expect(fis[0].value).toBe(1000); // 10 censuses x 100
    // Nothing at all starts before the rate is defined, and the window count of the rate is T - RATE_LAG - W + 1.
    expect(r.receipts.every((x) => x.startStep >= (RATE_LAG + 1) * CAD)).toBe(true);
    const bySig = r.dBySignal.filter((d) => d.signal === "fissions" && d.side === "high")[0];
    expect(bySig.D).toBeGreaterThanOrEqual(3);
  });

  it("receipts stay right past the 256-census history ring: W = 10, 50 and 200 over a long run", () => {
    // 1000 censuses; the scored run climbs from 1200 at index 517 (not a multiple of the ring size) for 250 censuses, then falls back.
    // Against three constant references at 1000 (spread 50) z = 4 + k/50 at the k-th elevated census.
    const T = 1000, s0 = 517, len = 250;
    const lv = Array.from({ length: T }, (_, c) => (c >= s0 && c < s0 + len ? 1200 + (c - s0) : 1000));
    const r = against(lv, { Z: [3, 4, 6] });
    const rc = (Z: number, W: number) => r.receipts.find((x) => x.signal === "livingCells" && x.side === "high" && x.Z === Z && x.W === W);
    for (const W of [10, 50, 200]) {
      for (const Z of [3, 4]) {
        expect(rc(Z, W), `Z=${Z} W=${W}`).toMatchObject({ startStep: (s0 + 1) * CAD, endStep: (s0 + W) * CAD, value: 1200, median: 1000 });
      }
    }
    // Z = 6 first holds at k = 100 (z = 6): windows of 10 and 50 fit in the 250 elevated censuses, a window of 200 does not.
    expect(rc(6, 10)).toMatchObject({ startStep: (s0 + 100 + 1) * CAD, endStep: (s0 + 100 + 10) * CAD, value: 1300, median: 1000 });
    expect(rc(6, 50)).toMatchObject({ startStep: (s0 + 100 + 1) * CAD, endStep: (s0 + 100 + 50) * CAD, value: 1300 });
    expect(rc(6, 200)).toBeUndefined();
    // D is the best window's smallest z: the last window of W inside the stretch starts at k = len - W.
    expect(r.D[Wi(10)]).toBeCloseTo(4 + (len - 10) / 50, 12);
    expect(r.D[Wi(50)]).toBeCloseTo(4 + (len - 50) / 50, 12);
    expect(r.D[Wi(200)]).toBeCloseTo(4 + (len - 200) / 50, 12);
  });

  it("scores a reference member leave-one-out, never against itself", () => {
    // Two runs only: run 0 at 1200, run 1 at 1000. Scored against {0, 1} leaving itself out the reference is run 1 alone: median 1000.
    const T = 9 + 50;
    const a = { living: Array.from({ length: T }, () => 1200) };
    const b = { living: Array.from({ length: T }, () => 1000) };
    const loo = scoreSimple([a, b], [0, 1], 0);
    expect(loo.D[Wi(50)]).toBe(4);
    // Scored as a non-member (envelope = run 1 only) it is the same number.
    expect(scoreSimple([a, b], [1], 0).D[Wi(50)]).toBe(4);
    // With itself included the median would be 1100 and the score would differ.
    const c = { living: Array.from({ length: T }, () => 1200) };
    expect(scoreSimple([a, b, c], [0, 1, 2], 0).D[Wi(50)]).toBeLessThan(4);
  });

  it("refuses an envelope that would be empty after leaving the run out", () => {
    expect(() => new BellScorer(["a"], [{ id: "e", members: [0] }], [{ id: "s", run: 0, envelope: "e" }])).toThrow(/no reference run/);
  });

  it("a treatment run never enters an envelope it is not a member of: changing it does not move the neutrals", () => {
    const T = 9 + 60;
    const r = prng(5);
    const base = Array.from({ length: 4 }, () => Array.from({ length: T }, () => 1000 + Math.round(r() * 100)));
    const run = (treat: number[]) => {
      const living = [...base, treat];
      const sc = new BellScorer(["n0", "n1", "n2", "n3", "t"], [{ id: "e", members: [0, 1, 2, 3] }], [0, 1, 2, 3, 4].map((i) => ({ id: `s${i}`, run: i, envelope: "e" })), { cadence: CAD });
      for (let c = 0; c < T; c++) sc.push(living.map((l) => ({ step: (c + 1) * CAD, values: vec(c, l[c]) })));
      return sc.results();
    };
    const a = run(Array.from({ length: T }, () => 5000));
    const b = run(Array.from({ length: T }, () => 1050));
    for (let i = 0; i < 4; i++) expect(a[i]).toEqual(b[i]);
    expect(a[4].D[Wi(50)]).toBeGreaterThan(b[4].D[Wi(50)]);
  });
});

/** Independent implementation: z by filtering and sorting, windows by brute force. */
function naive(vals: (number | null)[][][], steps: number[], members: number[], run: number, ws: number[], burnIn: number) {
  const T = steps.length;
  const D = ws.map(() => 0);
  const bySig: Record<string, number> = {};
  for (let s = 0; s < NS; s++) {
    const z: (number | null)[] = [];
    for (let t = 0; t < T; t++) {
      if (vals[run][t][s] === null) {
        z.push(null);
        continue;
      }
      const ref = members.filter((m) => m !== run).map((m) => vals[m][t][s] as number).sort((a, b) => a - b);
      const m = quantileSorted(ref, 0.5);
      const spread = Math.max((quantileSorted(ref, 0.75) - quantileSorted(ref, 0.25)) / 1.349, 0.05 * Math.abs(m), SIGNALS[s].floor);
      z.push(((vals[run][t][s] as number) - m) / spread);
    }
    ws.forEach((W, wi) => {
      for (const side of [1, -1]) {
        for (let j = 0; j + W <= T; j++) {
          if (steps[j] < burnIn) continue;
          let ok = true, mn = Infinity;
          for (let k = j; k < j + W; k++) {
            if (z[k] === null) ok = false;
            else mn = Math.min(mn, side * (z[k] as number));
          }
          if (!ok) continue;
          D[wi] = Math.max(D[wi], mn);
          bySig[`${SIGNALS[s].name}/${side}/${W}`] = Math.max(bySig[`${SIGNALS[s].name}/${side}/${W}`] ?? 0, mn);
        }
      }
    });
  }
  return { D, bySig };
}

describe("D equals brute force", () => {
  it("over random series, several W, leave-one-out for members and plain for non-members", () => {
    const r = prng(99);
    let nonzero = 0, ringsSeen = 0, loo = 0;
    for (let trial = 0; trial < 6; trial++) {
      const R = 6, T = 60 + Math.floor(r() * 30);
      const ws = [2, 5, 13, 40];
      const burnIn = 5 * CAD;
      // Slowly wandering levels so that windows on one side actually occur; a few ties and zeros on purpose.
      const vals: (number | null)[][][] = Array.from({ length: R }, (_, run) => {
        const level = SIGNALS.map((s, i) => (s.floor >= 1 ? 100 : 1) * (1 + run * 0.1 * r()) + i);
        return Array.from({ length: T }, (_, t) =>
          SIGNALS.map((s, i) => {
            if (s.kind === "rate" && t < 3) return null;
            const wander = Math.sin(t / (6 + i) + run) * level[i] * 0.4 * r() * (r() < 0.1 ? 0 : 1);
            return r() < 0.05 ? level[i] : Math.max(0, level[i] + wander);
          })
        );
      });
      const steps = Array.from({ length: T }, (_, t) => (t + 1) * CAD);
      const members = [0, 1, 2, 3, 4];
      const scored = [0, 2, 5]; // two members (LOO) and one non-member
      const sc = new BellScorer(
        vals.map((_, i) => `r${i}`),
        [{ id: "e", members }],
        scored.map((i) => ({ id: `s${i}`, run: i, envelope: "e" })),
        { cadence: CAD, burnIn, W: ws, Z: [1, 2] },
      );
      for (let t = 0; t < T; t++) sc.push(vals.map((v) => ({ step: steps[t], values: v[t] })));
      const res = sc.results();
      scored.forEach((run, k) => {
        const want = naive(vals, steps, members, run, ws, burnIn);
        expect(res[k].D).toEqual(want.D);
        nonzero += want.D.filter((d) => d > 0).length;
        ringsSeen += res[k].receipts.length;
        if (members.includes(run)) loo++;
        for (const e of res[k].dBySignal) expect(e.D).toBe(want.bySig[`${e.signal}/${e.side === "high" ? 1 : -1}/${e.W}`] ?? 0);
      });
    }
    // The property test is not vacuous: windows counted, rings seen, members scored leave-one-out.
    expect(nonzero).toBeGreaterThan(20);
    expect(ringsSeen).toBeGreaterThan(5);
    expect(loo).toBe(12);
  });
});

describe("lockstep", () => {
  const mk = (n: number) => new BellScorer(Array.from({ length: n }, (_, i) => `run-${i}`), [{ id: "e", members: [0] }], [{ id: "s", run: 1, envelope: "e" }], { cadence: CAD });
  const v = (c: number) => vec(c, 1);
  it("throws naming the run whose step differs", () => {
    const s = mk(3);
    expect(() => s.push([{ step: CAD, values: v(0) }, { step: CAD, values: v(0) }, { step: 2 * CAD, values: v(0) }])).toThrow(/run-2.*step 2000.*run-0.*step 1000/);
  });
  it("throws on a missing census (cadence gap) and on steps that do not advance", () => {
    const s = mk(2);
    s.push([{ step: CAD, values: v(0) }, { step: CAD, values: v(0) }]);
    expect(() => s.push([{ step: 3 * CAD, values: v(1) }, { step: 3 * CAD, values: v(1) }])).toThrow(/cadence/);
    const t = new BellScorer(["a", "b"], [{ id: "e", members: [0] }], [{ id: "s", run: 1, envelope: "e" }]);
    t.push([{ step: 5, values: v(0) }, { step: 5, values: v(0) }]);
    expect(() => t.push([{ step: 5, values: v(1) }, { step: 5, values: v(1) }])).toThrow(/does not follow/);
  });
  it("throws if the first census is not at the cadence, or if the run count is wrong", () => {
    expect(() => mk(2).push([{ step: 2 * CAD, values: v(0) }, { step: 2 * CAD, values: v(0) }])).toThrow(/cadence/);
    expect(() => mk(2).push([{ step: CAD, values: v(0) }])).toThrow(/1 censuses for 2 runs/);
  });
  it("throws when a rate is undefined for some runs and not others", () => {
    const s = mk(2);
    const a = v(0), b = v(0);
    b[IDX.fissions] = 0;
    expect(() => s.push([{ step: CAD, values: a }, { step: CAD, values: b }])).toThrow(/fissions is undefined for run-0/);
  });
  it("checkGroupIdentity names the run that differs in preset identity, steps or cadence", () => {
    const ok = { presetIdentity: "p", steps: 1000, censusEvery: 100 };
    expect(() => checkGroupIdentity([{ id: "a", ...ok }, { id: "b", ...ok }])).not.toThrow();
    expect(() => checkGroupIdentity([{ id: "a", ...ok }, { id: "b", ...ok, presetIdentity: "q" }])).toThrow(/b has presetIdentity "q"/);
    expect(() => checkGroupIdentity([{ id: "a", ...ok }, { id: "b", ...ok, steps: 2000 }])).toThrow(/b has steps 2000/);
    expect(() => checkGroupIdentity([{ id: "a", ...ok }, { id: "b", ...ok, censusEvery: 50 }])).toThrow(/b has censusEvery 50/);
    expect(() => checkGroupIdentity([{ id: "a", ...ok, steps: 1050 }])).toThrow(/whole number of censuses/);
  });
  const ser = (step: number, livingCells = 0, lineages = 0) => ({ step, livingCells, lineages });
  const lin = (...xs: [number, [string, number][]][]) => gen<[number, [string, number][]]>(xs);
  const drain = async (it: AsyncIterable<unknown>) => {
    const out: unknown[] = [];
    for await (const x of it) out.push(x);
    return out;
  };
  it("mergeCensuses gives an empty census no rows and throws on a lineage census the series lacks", async () => {
    const series = [ser(100, 1, 1), ser(200), ser(300, 2, 1)];
    const out = [];
    for await (const x of mergeCensuses("r", gen(series), lin([100, [["a", 1]]], [300, [["b", 2]]]))) out.push(x.rows);
    expect(out).toEqual([[["a", 1]], [], [["b", 2]]]);
    await expect(drain(mergeCensuses("run-x", gen([ser(100), ser(200), ser(300)]), lin([150, [["a", 1]]])))).rejects.toThrow(/run-x.*step 150/);
    await expect(drain(mergeCensuses("run-y", gen([ser(100), ser(200), ser(300)]), lin([400, [["a", 1]]])))).rejects.toThrow(/run-y.*step 400/);
  });
  it("mergeCensuses does not take a truncated lineages.tsv for an extinct world", async () => {
    // lineages.tsv stops after step 200 while the series says 1000 cells are alive through step 400.
    const series = [ser(100, 1000, 1), ser(200, 1000, 1), ser(300, 1000, 1), ser(400, 1000, 1)];
    await expect(drain(mergeCensuses("run-t", gen(series), lin([100, [["a", 1000]]], [200, [["a", 1000]]])))).rejects.toThrow(/run-t.*step 300.*sum to 0 cells.*livingCells 1000.*truncated/);
    // Empty lineages.tsv altogether.
    await expect(drain(mergeCensuses("run-e", gen(series), lin()))).rejects.toThrow(/run-e.*step 100.*truncated/);
    // A genuinely extinct tail (series livingCells 0) is fine.
    const ok = await drain(mergeCensuses("run-ok", gen([ser(100, 5, 1), ser(200), ser(300)]), lin([100, [["a", 5]]])));
    expect(ok.length).toBe(3);
  });
  it("mergeCensuses checks the lineage census against the series: living cells and lineage count", async () => {
    await expect(drain(mergeCensuses("run-s", gen([ser(100, 10, 2)]), lin([100, [["a", 3], ["b", 4]]])))).rejects.toThrow(/run-s.*step 100.*sum to 7 cells.*livingCells 10/);
    await expect(drain(mergeCensuses("run-n", gen([ser(100, 7, 3)]), lin([100, [["a", 3], ["b", 4]]])))).rejects.toThrow(/run-n.*step 100.*2 lineage rows.*lineages 3/);
    // Rows although the series says nobody is alive.
    await expect(drain(mergeCensuses("run-z", gen([ser(100, 0, 0)]), lin([100, [["a", 3]]])))).rejects.toThrow(/run-z.*3 cells.*livingCells 0/);
    // No rows, yet the series says lineages are alive (Codex review): the lineage count is checked on empty censuses too.
    await expect(drain(mergeCensuses("run-l", gen([ser(100, 0, 7)]), lin()))).rejects.toThrow(/run-l.*step 100.*0 lineage rows.*lineages 7/);
  });
  it("mergeCensuses cross-checks only fields the series states: a missing field counts as 0 for the signal, not as a mismatch", async () => {
    const out = await drain(mergeCensuses("run-m", gen([{ step: 100, livingCells: 7 }, { step: 200 }, { step: 300, lineages: 1, livingCells: Number.NaN }]), lin([100, [["a", 7]]], [200, [["a", 2], ["b", 3]]], [300, [["a", 4]]])));
    expect(out.length).toBe(3);
  });
  it("mergeCensuses closes the lineage iterator on every exit", async () => {
    const track = (xs: [number, [string, number][]][]) => {
      let closed = 0;
      const it: AsyncIterable<readonly [number, [string, number][]]> = {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            next: async () => (i < xs.length ? { done: false, value: xs[i++] } : { done: true, value: undefined }),
            return: async () => {
              closed++;
              return { done: true, value: undefined };
            },
          };
        },
      };
      return { it, closed: () => closed };
    };
    // Normal end.
    const a = track([[100, [["a", 1]]]]);
    await drain(mergeCensuses("r", gen([ser(100, 1, 1)]), a.it));
    expect(a.closed()).toBe(1);
    // A throw inside the merge.
    const b = track([[150, [["a", 1]]]]);
    await expect(drain(mergeCensuses("r", gen([ser(100), ser(200)]), b.it))).rejects.toThrow();
    expect(b.closed()).toBe(1);
    // The consumer stops early.
    const c = track([[100, [["a", 1]]], [200, [["a", 1]]], [300, [["a", 1]]]]);
    for await (const _ of mergeCensuses("r", gen([ser(100, 1, 1), ser(200, 1, 1), ser(300, 1, 1)]), c.it)) break;
    expect(c.closed()).toBe(1);
  });
});

describe("text and manifest parsing", () => {
  async function* chunks(...xs: string[]) {
    for (const x of xs) yield x;
  }
  const lines = async (...xs: string[]) => {
    const out: string[] = [];
    for await (const l of splitLines(chunks(...xs))) out.push(l);
    return out;
  };
  it("splitLines handles LF, CRLF, a split CRLF, chunk boundaries inside a line and no trailing newline", async () => {
    expect(await lines("a\nb\nc\n")).toEqual(["a", "b", "c"]);
    expect(await lines("a\r\nb\r\nc")).toEqual(["a", "b", "c"]);
    expect(await lines("ab", "c\n", "d", "e", "f\n", "g")).toEqual(["abc", "def", "g"]);
    expect(await lines("a\r", "\nb\r", "\n")).toEqual(["a", "b"]);
    expect(await lines("")).toEqual([]);
    expect(await lines("a\n\nb\n")).toEqual(["a", "", "b"]);
    expect(await lines('{"step":1}\n{"st', 'ep":2}')).toEqual(['{"step":1}', '{"step":2}']);
  });
  it("parseSeries yields objects with a numeric step and names the run for everything else", async () => {
    const run = async (...ls: string[]) => {
      const out = [];
      for await (const r of parseSeries("run-p", chunks(...ls))) out.push(r);
      return out;
    };
    expect(await run('{"step":100,"livingCells":3}', "", '{"step":200}')).toEqual([{ step: 100, livingCells: 3 }, { step: 200 }]);
    await expect(run('{"step":100}', "{not json")).rejects.toThrow(/run-p.*line 2.*not JSON/);
    await expect(run("null")).rejects.toThrow(/run-p.*line 1.*not a JSON object/);
    await expect(run("12")).rejects.toThrow(/run-p.*line 1.*not a JSON object/);
    await expect(run("[1]")).rejects.toThrow(/run-p.*not a JSON object/);
    await expect(run('{"step":"100"}')).rejects.toThrow(/run-p.*line 1.*numeric step/);
  });
  it("parseManifest names the run for empty, corrupt, spec-less and mismatched manifests", () => {
    const r = corpusRuns().find((x) => x.id === "replay-m4/gradient-m3/treatment/seed-2")!;
    const good = { spec: { experiment: "replay-m4", presetId: "gradient-m3", condition: "treatment", seed: 2, steps: 1000, censusEvery: 100 }, presetIdentity: "p", summary: {} };
    expect(parseManifest(r, JSON.stringify(good)).spec.seed).toBe(2);
    expect(() => parseManifest(r, "")).toThrow(new RegExp(`${r.id}.*not JSON`));
    expect(() => parseManifest(r, "null")).toThrow(new RegExp(`${r.id}.*no spec`));
    expect(() => parseManifest(r, "{}")).toThrow(new RegExp(`${r.id}.*no spec`));
    expect(() => parseManifest(r, JSON.stringify({ ...good, spec: { ...good.spec, seed: 3 } }))).toThrow(new RegExp(`${r.id}: manifest says .*seed-3`));
    expect(() => parseManifest(r, JSON.stringify({ ...good, summary: undefined }))).toThrow(new RegExp(`${r.id}.*no summary`));
    expect(() => parseManifest(r, JSON.stringify({ ...good, presetIdentity: undefined }))).toThrow(new RegExp(`${r.id}.*no presetIdentity`));
    expect(() => parseManifest(r, JSON.stringify({ ...good, presetIdentity: "" }))).toThrow(new RegExp(`${r.id}.*no presetIdentity`));
  });
});

describe("the corpus and the plan", () => {
  it("is the 70 neutral runs of test 6 plus 10 treatment and 5 no-mutation", () => {
    const runs = corpusRuns();
    const n = (f: (r: CorpusRun) => boolean) => runs.filter(f).length;
    expect(n((r) => r.condition === "neutral")).toBe(70);
    expect(n((r) => r.condition === "treatment")).toBe(10);
    expect(n((r) => r.condition === "no-mutation")).toBe(5);
    expect(n((r) => r.condition === "neutral" && r.preset === "gradient-m3")).toBe(40);
    expect(n((r) => r.condition === "neutral" && r.preset === "spots-m3")).toBe(30);
    expect(n((r) => r.experiment === "replay-calib")).toBe(40);
    expect(new Set(runs.map((r) => r.id)).size).toBe(85);
    expect(runs[0].id).toBe("replay-calib/gradient-m3/neutral/seed-1001");
  });
  it("plans gradient-m3 with two envelopes and spots-m3 with one", () => {
    const runs = corpusRuns();
    const g = planGroup(runs.filter((r) => r.preset === "gradient-m3"));
    expect(g.runs.length).toBe(55);
    expect(g.envelopes.map((e) => [e.id, e.members.length])).toEqual([["all-neutral", 40], ["m4-neutral", 20]]);
    expect(g.scorings.filter((s) => s.envelope === "all-neutral").length).toBe(55);
    expect(g.scorings.filter((s) => s.envelope === "m4-neutral").length).toBe(35);
    // Calibration neutrals are not scored against the preliminary envelope.
    for (const s of g.scorings.filter((s) => s.envelope === "m4-neutral")) expect(g.runs[s.run].experiment).toBe("replay-m4");
    const sp = planGroup(runs.filter((r) => r.preset === "spots-m3"));
    expect(sp.envelopes.map((e) => [e.id, e.members.length])).toEqual([["all-neutral", 30]]);
    expect(sp.scorings.length).toBe(30);
  });
  it("preliminary-only reads just the replay-m4 gradient-m3 runs", () => {
    const runs = corpusRuns();
    const g = planGroup(runs.filter((r) => r.preset === "gradient-m3"), { preliminaryOnly: true });
    expect(g.runs.length).toBe(35);
    expect(g.envelopes.map((e) => e.id)).toEqual(["m4-neutral"]);
    expect(g.scorings.length).toBe(35);
    expect(planGroup(runs.filter((r) => r.preset === "spots-m3"), { preliminaryOnly: true }).runs).toEqual([]);
  });
  it("planned scorings drive a scorer end to end: the elevated run, and only it, has D > 0, under its own id", () => {
    const runs = corpusRuns().filter((r) => r.preset === "spots-m3");
    const p = planGroup(runs);
    const pick = 7;
    const picked = p.runs[pick];
    const sc = new BellScorer(p.runs.map((r) => r.id), p.envelopes, p.scorings, { cadence: CAD, burnIn: 0, W: [10], Z: [4] });
    // 29 constant references at 1000 (spread 50); the picked run sits at 1200 for all 15 censuses: z = 4 exactly.
    for (let c = 0; c < 15; c++) sc.push(p.runs.map((_, i) => ({ step: (c + 1) * CAD, values: vec(c, i === pick ? 1200 : 1000) })));
    const res = sc.results();
    expect(res.length).toBe(30);
    const hot = res.filter((r) => r.D[0] > 0);
    expect(hot.map((r) => r.id)).toEqual([`${picked.id}@all-neutral`]);
    expect(hot[0].D).toEqual([4]);
    expect(hot[0].receipts.find((x) => x.signal === "livingCells")).toMatchObject({ side: "high", Z: 4, W: 10, value: 1200, median: 1000 });
    // Every other result is scored against the right envelope (the other 29 runs), so the picked run's 1200 does not move their median.
    for (const r of res) expect(p.runs[r.run].id + "@all-neutral").toBe(r.id);
    expect(JSON.parse(JSON.stringify(res)).length).toBe(30);
  });
  it("skips scorings with no reference left instead of crashing: 0 or 1 neutral run in a group", () => {
    const all = corpusRuns();
    const grad = all.filter((r) => r.preset === "gradient-m3");
    const neutrals = grad.filter((r) => r.condition === "neutral");
    const treatment = grad.filter((r) => r.condition === "treatment");
    // No neutral run at all: nothing to read.
    const none = planGroup(treatment);
    expect(none.runs).toEqual([]);
    expect(none.envelopes).toEqual([]);
    expect(none.scorings).toEqual([]);
    // One neutral run alone: scored against nobody once itself is left out.
    const lone = planGroup([neutrals[0]]);
    expect(lone.scorings).toEqual([]);
    expect(lone.runs).toEqual([]);
    // One neutral run and a treatment run: the treatment run is scored against it, the neutral run is not scored.
    const pair = planGroup([neutrals[0], treatment[0]]);
    expect(pair.scorings.map((s) => s.id)).toEqual([`${treatment[0].id}@all-neutral`]);
    expect(pair.envelopes.map((e) => [e.id, e.members.length])).toEqual([["all-neutral", 1]]);
    expect(pair.runs.length).toBe(2);
    // The scorer accepts what the plan gives.
    expect(() => new BellScorer(pair.runs.map((r) => r.id), pair.envelopes, pair.scorings)).not.toThrow();
    // Preliminary-only with a single m4 neutral run and its treatment run, likewise.
    const m4n = neutrals.find((r) => r.experiment === "replay-m4")!;
    const pre = planGroup([m4n, treatment[0]], { preliminaryOnly: true });
    expect(pre.scorings.map((s) => s.id)).toEqual([`${treatment[0].id}@m4-neutral`]);
    // A second neutral run makes the first scorable again.
    const two = planGroup([neutrals[0], neutrals[1]]);
    expect(two.scorings.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------
// Summary.

let uid = 0;
function mk(experiment: string, preset: string, condition: ScoredEntry["condition"], envelope: ScoredEntry["envelope"], d: number | { 10?: number; 50: number; 200?: number }): ScoredEntry {
  const D = typeof d === "number" ? { 10: d, 50: d, 200: d } : { 10: d[10] ?? d[50], 50: d[50], 200: d[200] ?? d[50] };
  return { id: `${experiment}/${preset}/${condition}/${uid++}`, experiment, preset, condition, envelope, D: { "10": D[10], "50": D[50], "200": D[200] } };
}
/** The full corpus with the given D at W=50: `neutralD(i)` for neutral run i of 70, treatment and no-mutation constants. */
function corpus(opts: { neutral?: (i: number) => number; treatment?: number; noMutation?: number; omitNeutral?: number } = {}) {
  const out: ScoredEntry[] = [];
  let i = 0;
  const nd = opts.neutral ?? (() => 1);
  const add = (experiment: string, preset: string, n: number) => {
    for (let k = 0; k < n; k++) {
      const idx = i++;
      if (opts.omitNeutral !== undefined && idx < opts.omitNeutral) continue;
      out.push(mk(experiment, preset, "neutral", "all-neutral", nd(idx)));
    }
  };
  add("replay-calib", "gradient-m3", 20);
  add("replay-calib", "spots-m3", 20);
  add("replay-m4", "gradient-m3", 20);
  add("replay-m4", "spots-m3", 10);
  for (let k = 0; k < 10; k++) out.push(mk("replay-m4", "gradient-m3", "treatment", "all-neutral", opts.treatment ?? 10));
  for (let k = 0; k < 5; k++) out.push(mk("replay-m4", "gradient-m3", "no-mutation", "all-neutral", opts.noMutation ?? 1));
  return out;
}

describe("binomial bar", () => {
  it("matches test 6: 2 of 70 passes, 3 of 70 fails", () => {
    expect(binomialUpperBound(2, 70)).toBeLessThan(0.1);
    expect(binomialUpperBound(3, 70)).toBeGreaterThanOrEqual(0.1);
    expect(binomialUpperBound(0, 70)).toBeLessThan(0.1);
  });
});

describe("criteria and reading", () => {
  it("clapper: at most 2 of 70 neutral ring and treatment separates", () => {
    const s = summarize(corpus({ neutral: (i) => (i < 2 ? 5 : 1) }));
    expect(s.criterion1).toMatchObject({ status: "pass", k: 2, n: 70 });
    expect(s.criterion2.status).toBe("pass");
    expect(s.criterion2.effect).toBe(1);
    expect(s.reading).toBe("clapper");
    expect(s.reported.treatmentRings).toEqual({ k: 10, of: 10 });
    expect(s.reported.noMutationVsNeutral.rings).toEqual({ k: 0, of: 5 });
  });
  it("rings on drift: 3 of 70 neutral ring, whatever criterion 2 says", () => {
    const s = summarize(corpus({ neutral: (i) => (i < 3 ? 5 : 1) }));
    expect(s.criterion1.status).toBe("fail");
    expect(s.criterion2.status).toBe("pass");
    expect(s.reading).toBe("rings on drift");
    expect(summarize(corpus({ neutral: (i) => (i < 3 ? 5 : 1), treatment: 0.5 })).reading).toBe("rings on drift");
  });
  it("quiet but deaf: no false alarms and no separation", () => {
    const s = summarize(corpus({ treatment: 0.5 }));
    expect(s.criterion1.status).toBe("pass");
    expect(s.criterion2.status).toBe("fail");
    expect(s.criterion2.effect!).toBeLessThan(0.8);
    expect(s.reading).toBe("quiet but deaf");
  });
  it("criterion 2 bar is P >= 0.8 with ties half", () => {
    // 40 gradient neutral at 1 and treatment at 1 too: all ties, effect 0.5.
    expect(summarize(corpus({ treatment: 1 })).criterion2.effect).toBe(0.5);
    // Treatment above 8 of the 10... neutral all equal, so 10 treatment above give 1; make 2 of 10 tie (0.5): effect 0.9 -> pass.
    const es = corpus({ treatment: 10 });
    es.filter((e) => e.condition === "treatment").slice(0, 2).forEach((e) => (e.D["50"] = 1));
    expect(summarize(es).criterion2.effect).toBeCloseTo(0.9, 12);
    es.filter((e) => e.condition === "treatment").slice(2, 6).forEach((e) => (e.D["50"] = 1));
    expect(summarize(es).criterion2.effect).toBeCloseTo(0.7, 12);
    expect(summarize(es).criterion2.status).toBe("fail");
  });
  it("refuses criterion 1 (and the label) when fewer than 70 neutral runs load", () => {
    const s = summarize(corpus({ omitNeutral: 1 }));
    expect(s.criterion1.status).toBe("not-called");
    expect(s.criterion1.reason).toMatch(/69 neutral runs/);
    expect(s.reading).toBe("not called");
    // Even when the 69 are clean and even when drift is obvious.
    expect(summarize(corpus({ omitNeutral: 1, neutral: () => 9 })).reading).toBe("not called");
  });
  it("refuses everything when the corpus is flagged incomplete, even with 70 neutral runs", () => {
    const s = summarize(corpus(), { complete: false });
    expect(s.criterion1.status).toBe("not-called");
    expect(s.criterion2.status).toBe("not-called");
    expect(s.reading).toBe("not called");
    expect(s.secondary.status).toBe("not-called");
  });
  it("does not call criterion 2 without 10 treatment and 40 gradient-m3 neutral runs", () => {
    const es = corpus().filter((e, i) => !(e.condition === "treatment" && i % 2 === 0));
    const s = summarize(es);
    expect(s.criterion1.status).toBe("pass");
    expect(s.criterion2.status).toBe("not-called");
    expect(s.reading).toBe("not called");
  });
  it("only the primary cell decides; the grid reports all nine", () => {
    // Neutral runs ring at W=10, Z=3 only.
    const es = corpus().map((e) => (e.condition === "neutral" ? { ...e, D: { ...e.D, "10": 3.5 } } : e));
    const s = summarize(es);
    expect(s.reading).toBe("clapper");
    expect(s.grid.length).toBe(9);
    expect(s.grid.map((c) => [c.Z, c.W])).toEqual([[3, 10], [4, 10], [6, 10], [3, 50], [4, 50], [6, 50], [3, 200], [4, 200], [6, 200]]);
    const c = s.grid.find((c) => c.Z === 3 && c.W === 10)!;
    expect(c.falseAlarms).toMatchObject({ k: 70, of: 70 });
    expect(c.falseAlarms.upper95).toBeGreaterThan(0.9);
    expect(s.grid.find((c) => c.Z === 4 && c.W === 10)!.falseAlarms.k).toBe(0);
    expect(s.grid.find((c) => c.Z === 3 && c.W === 50)!.falseAlarms.k).toBe(0);
  });
  it("reports the preliminary 20-seed numbers from the m4-neutral envelope", () => {
    const es = corpus();
    for (let k = 0; k < 20; k++) es.push(mk("replay-m4", "gradient-m3", "neutral", "m4-neutral", k < 3 ? 4 : 1));
    for (let k = 0; k < 10; k++) es.push(mk("replay-m4", "gradient-m3", "treatment", "m4-neutral", 8));
    for (let k = 0; k < 5; k++) es.push(mk("replay-m4", "gradient-m3", "no-mutation", "m4-neutral", 1));
    const s = summarize(es);
    expect(s.reported.preliminary.falseAlarms).toEqual({ k: 3, of: 20 });
    expect(s.reported.preliminary.treatmentRings).toEqual({ k: 10, of: 10 });
    expect(s.reported.preliminary.noMutationRings).toEqual({ k: 0, of: 5 });
    expect(s.reported.preliminary.effectTreatmentVsNeutral).toBe(1);
    // The decision does not use them.
    expect(s.criterion1).toMatchObject({ k: 0, n: 70, status: "pass" });
  });
});

describe("calibrated held-out readout", () => {
  it("uses strict > against the largest calibration D of the preset", () => {
    const es: ScoredEntry[] = [];
    // gradient-m3: calibration D from 1 to 20 (max 20); held-out neutrals: one equal to 20, one at 20.5, the rest low.
    for (let k = 1; k <= 20; k++) es.push(mk("replay-calib", "gradient-m3", "neutral", "all-neutral", k));
    es.push(mk("replay-m4", "gradient-m3", "neutral", "all-neutral", 20));
    es.push(mk("replay-m4", "gradient-m3", "neutral", "all-neutral", 20.5));
    for (let k = 0; k < 18; k++) es.push(mk("replay-m4", "gradient-m3", "neutral", "all-neutral", 3));
    // spots-m3: calibration max 7; held-out at 7 (not above), 7.1 (above), and 8 more at 1.
    for (let k = 0; k < 20; k++) es.push(mk("replay-calib", "spots-m3", "neutral", "all-neutral", k === 5 ? 7 : 2));
    es.push(mk("replay-m4", "spots-m3", "neutral", "all-neutral", 7), mk("replay-m4", "spots-m3", "neutral", "all-neutral", 7.1));
    for (let k = 0; k < 8; k++) es.push(mk("replay-m4", "spots-m3", "neutral", "all-neutral", 1));
    // Treatment: one at exactly 20 (not above), two above; no-mutation one above.
    es.push(mk("replay-m4", "gradient-m3", "treatment", "all-neutral", 20), mk("replay-m4", "gradient-m3", "treatment", "all-neutral", 21), mk("replay-m4", "gradient-m3", "treatment", "all-neutral", 99));
    es.push(mk("replay-m4", "gradient-m3", "no-mutation", "all-neutral", 20.01), mk("replay-m4", "gradient-m3", "no-mutation", "all-neutral", 0));
    const s = summarize(es).secondary;
    expect(s.status).toBe("called");
    expect(s.perPreset["gradient-m3"]).toMatchObject({ calibRuns: 20, zStar: 20, heldOutNeutral: { k: 1, of: 20 } });
    expect(s.perPreset["gradient-m3"].expected).toBeCloseTo(20 / 21, 12);
    expect(s.perPreset["spots-m3"]).toMatchObject({ calibRuns: 20, zStar: 7, heldOutNeutral: { k: 1, of: 10 } });
    expect(s.heldOutNeutralTotal.k).toBe(2);
    expect(s.heldOutNeutralTotal.of).toBe(30);
    expect(s.heldOutNeutralTotal.expected).toBeCloseTo(30 / 21, 12);
    expect(s.treatment).toEqual({ k: 2, of: 3, zStar: 20 });
    expect(s.noMutation).toEqual({ k: 1, of: 2, zStar: 20 });
  });
  it("is not called when a whole preset is absent, or the held-out count is not the note's", () => {
    const gradOnly = corpus().filter((e) => e.preset === "gradient-m3");
    expect(summarize(gradOnly).secondary.status).toBe("not-called");
    expect(summarize(gradOnly).secondary.perPreset["spots-m3"]).toMatchObject({ calibRuns: 0, zStar: null });
    // Even with the call's default complete = true, nothing is called without the full set.
    expect(summarize(gradOnly, {}).reading).toBe("not called");
    const short = corpus();
    short.splice(short.findIndex((e) => e.experiment === "replay-m4" && e.preset === "spots-m3"), 1);
    expect(summarize(short).secondary.status).toBe("not-called");
    expect(summarize(corpus()).secondary.status).toBe("called");
  });
  it("is not called when a preset lacks its 20 calibration runs", () => {
    const lost = corpus();
    const idx = lost.findIndex((e) => e.experiment === "replay-calib" && e.preset === "spots-m3");
    lost.splice(idx, 1);
    expect(summarize(lost).secondary.status).toBe("not-called");
  });
});

describe("where records go", () => {
  it("only a complete readout gets the official paths", () => {
    expect(defaultOutputs({ complete: true, preliminaryOnly: false })).toEqual({ record: "experiments/naturalist/bell-v0.json", out: "runs/naturalist/bell-v0" });
    const pre = defaultOutputs({ complete: false, preliminaryOnly: true });
    const inc = defaultOutputs({ complete: false, preliminaryOnly: false });
    expect(pre).toEqual({ record: "experiments/naturalist/bell-v0.preliminary.json", out: "runs/naturalist/bell-v0.preliminary" });
    expect(inc).toEqual({ record: "experiments/naturalist/bell-v0.incomplete.json", out: "runs/naturalist/bell-v0.incomplete" });
  });
  it("refuses to record nothing, and to replace a complete record with an incomplete one unless forced", () => {
    const complete = JSON.stringify({ complete: true });
    expect(recordRefusal(null, { complete: true, scored: 0 })).toMatch(/nothing to record/);
    expect(recordRefusal(complete, { complete: false, scored: 10 })).toMatch(/complete readout/);
    expect(recordRefusal(complete, { complete: false, scored: 10, force: true })).toBeNull();
    expect(recordRefusal(complete, { complete: true, scored: 85 })).toBeNull();
    expect(recordRefusal(null, { complete: false, scored: 10 })).toBeNull();
    expect(recordRefusal(JSON.stringify({ complete: false }), { complete: false, scored: 10 })).toBeNull();
    expect(recordRefusal("{truncated", { complete: false, scored: 10 })).toBeNull();
    expect(recordRefusal(complete, { complete: false, scored: 0, force: true })).toMatch(/nothing to record/);
  });
});

describe("records", () => {
  it("entryOf keys D by W and the summary is JSON-safe", () => {
    const run = corpusRuns()[0];
    const e = entryOf(run, { id: "x", run: 0, envelope: "all-neutral", D: [1, 2, 3], windows: [1, 1, 1], dBySignal: [], receipts: [], censuses: 1 });
    expect(e.D).toEqual({ "10": 1, "50": 2, "200": 3 });
    expect(e).toMatchObject({ id: run.id, preset: "gradient-m3", condition: "neutral", experiment: "replay-calib" });
    const s = summarize(corpus());
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
