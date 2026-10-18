import { describe, expect, it } from "vitest";
import { SIGNALS, departure, quantileDrop, type ScoringResult } from "../lib/bell.ts";
import {
  BIN,
  NOTEBOOK_W,
  SIGNAL_TEXT,
  ZTrace,
  armsFromBurnIn,
  checkAgainstRecordCorpus,
  checkCorpusScore,
  checkSignalCells,
  crossCheck,
  falseAlarmSignals,
  fmtValue,
  fmtZ,
  nextUp,
  noteSentence,
  parseBellRecord,
  parseSubjectManifest,
  pictureBins,
  planNotebook,
  rateWindow,
  recordD,
  stretches,
  traceD,
  windowMin,
  zStarFor,
} from "../lib/notebook.ts";
import { renderNotebook } from "../lib/notebook-html.ts";
import { IDX, NS, RECORD_TEXT, excursions, gradientCorpus, harness, harnessModel, manifestFor, prng, record, sampleModel } from "./notebook-fixture.ts";

const cc = (h: ReturnType<typeof harness>, zStar: number, recordDv: number | null = null) => crossCheck(h.result, h.trace, { id: "subject", zStar, zRing: h.zRing, recordD: recordDv });

describe("nextUp", () => {
  it("gives the smallest double above x", () => {
    for (const x of [0, 1, 7.0429124518134785, 11.4665, -3.5, 1e-300, 1e300, Number.MIN_VALUE]) {
      const u = nextUp(x);
      expect(u > x).toBe(true);
      const mid = (x + u) / 2;
      expect(mid === x || mid === u).toBe(true);
    }
    expect(nextUp(0)).toBe(Number.MIN_VALUE);
  });
});

describe("rings and stretches", () => {
  // Envelope constant at 100: median 100, IQR 0, spread max(0, 5, 1) = 5. A subject at 100 + 5k has z = k.
  const env = (sig: number, from: number, to: number, level: number) => (r: number, i: number, s: number) => (r === 5 ? excursions(100, [{ s: sig, from, to, level }])(i, s) : 100);

  it("ring is strict: an exact tie at Z* does not ring", () => {
    const zStar = departure(135, [100, 100, 100, 100, 100], Infinity, SIGNALS[IDX.livingCells].floor).z;
    expect(zStar).toBe(7);
    const h = harness({ nEnv: 5, censuses: 120, zStar, value: env(IDX.livingCells, 0, 119, 135) });
    expect(traceD(h.trace, IDX.livingCells, 0)).toBe(zStar);
    expect(cc(h, zStar)).toEqual([]);
    expect(h.result.receipts).toEqual([]);
    // Just below the tie, it rings.
    const below = 7 - 1e-12;
    const h2 = harness({ nEnv: 5, censuses: 120, zStar: below, value: env(IDX.livingCells, 0, 119, 135) });
    expect(cc(h2, below).map((r) => `${r.signal} ${r.side}`)).toEqual(["livingCells high"]);
  });

  it("stretch needs 50 counted censuses", () => {
    // burn-in at step 1000 = census 9.
    const one = harness({ nEnv: 5, censuses: 200, zStar: 7, value: env(IDX.lineages, 20, 69, 200) });
    const st = stretches(one.trace, IDX.lineages, 0, one.zRing);
    expect(st.length).toBe(1);
    expect(st[0].censuses).toBe(50);
    expect(cc(one, 7).length).toBe(1);
    const short = harness({ nEnv: 5, censuses: 200, zStar: 7, value: env(IDX.lineages, 20, 68, 200) });
    expect(stretches(short.trace, IDX.lineages, 0, short.zRing)).toEqual([]);
    expect(cc(short, 7)).toEqual([]);
    const gap = harness({
      nEnv: 5,
      censuses: 200,
      zStar: 7,
      value: (r, i, s) => (r === 5 && s === IDX.lineages && ((i >= 20 && i <= 68) || (i >= 70 && i <= 118)) ? 200 : 100),
    });
    expect(stretches(gap.trace, IDX.lineages, 0, gap.zRing)).toEqual([]);
    expect(cc(gap, 7)).toEqual([]);
  });

  it("burn-in is not counted", () => {
    const h = harness({ nEnv: 5, censuses: 200, zStar: 7, value: env(IDX.meanMass, 0, 80, 300), burnIn: 1000 });
    const rings = cc(h, 7);
    expect(rings.length).toBe(1);
    expect(rings[0].stretches[0].startStep).toBe(1000);
    expect(rings[0].receipt.startStep).toBe(1000);
    expect(rings[0].stretches[0].censuses).toBe(72);
  });

  it("ongoing flag", () => {
    const h = harness({ nEnv: 5, censuses: 200, zStar: 7, value: env(IDX.individuals, 120, 199, 20) });
    const rings = cc(h, 7);
    expect(rings.map((r) => r.side)).toEqual(["low"]);
    const last = rings[0].stretches.at(-1)!;
    expect(last.ongoing).toBe(true);
    expect(last.endStep).toBe(200 * 100);
    const h2 = harness({ nEnv: 5, censuses: 200, zStar: 7, value: env(IDX.individuals, 120, 198, 20) });
    expect(cc(h2, 7)[0].stretches[0].ongoing).toBe(false);
  });

  it("a ring can have several stretches, the first at the receipt", () => {
    const h = harness({ nEnv: 5, censuses: 300, zStar: 7, value: (r, i, s) => (r === 5 && s === IDX.fissions && ((i >= 20 && i <= 80) || (i >= 150 && i <= 260)) ? 200 : 100) });
    const [ring] = cc(h, 7);
    expect(ring.stretches.map((s) => s.censuses)).toEqual([61, 111]);
    expect(ring.stretches[0].startStep).toBe(ring.receipt.startStep);
  });
});

describe("the trace against the bell", () => {
  // Random envelope with drifting subjects, rates undefined for the first 10 censuses.
  function randomRun(member: number | undefined, seed: number) {
    const r = prng(seed);
    const nEnv = 9, censuses = 400;
    const nRuns = nEnv + (member === undefined ? 1 : 0);
    const walk = Array.from({ length: nRuns }, () => Array.from({ length: NS }, () => 100 + r() * 20));
    const vals: (number | null)[][][] = [];
    for (let i = 0; i < censuses; i++) {
      vals.push(walk.map((w, k) => w.map((v, s) => {
        w[s] = Math.max(0, v + (r() - 0.5) * 6 + (k === (member ?? nEnv) ? 0.4 : 0));
        if (SIGNALS[s].kind === "rate" && i < 10) return null;
        return s % 3 === 0 ? Math.round(w[s]) : w[s] / 100;
      })));
    }
    return { nEnv, censuses, value: (k: number, i: number, s: number) => vals[i][k][s] };
  }

  for (const member of [undefined, 3]) {
    it(`trace D equals bell D on all 26 pairs (${member === undefined ? "non-member" : "member, leave-one-out"})`, () => {
      for (const seed of [1, 2, 3]) {
        const g = randomRun(member, seed);
        const h = harness({ ...g, member, zStar: 1e9 });
        for (let s = 0; s < NS; s++)
          for (const si of [0, 1] as const) {
            const bell = h.result.dBySignal.find((d) => d.signal === SIGNALS[s].name && d.side === (si ? "low" : "high") && d.W === NOTEBOOK_W)!.D;
            expect(traceD(h.trace, s, si)).toBe(bell);
          }
        // A threshold low enough to ring: the full cross-check (receipts, stretches) passes.
        const z = 1.5;
        const h2 = harness({ ...g, member, zStar: z });
        const rings = cc(h2, z);
        for (const ring of rings) {
          const s = IDX[ring.signal], si = ring.side === "high" ? 0 : 1;
          const f = ring.stretches[0];
          expect(f.startStep).toBe(ring.receipt.startStep);
          expect(windowMin(h2.trace, s, si, f.startIdx)).toBe(ring.receipt.minAbsZ);
          expect(h2.trace.x[f.startIdx * NS + s]).toBe(ring.receipt.value);
          expect(h2.trace.median[f.startIdx * NS + s]).toBe(ring.receipt.median);
        }
        if (seed === 1) expect(rings.length).toBeGreaterThan(0);
      }
    });
  }

  it("leave-one-out filter equals the bell's skip", () => {
    const g = randomRun(3, 9);
    const h = harness({ ...g, member: 3, zStar: 1e9 });
    for (const i of [15, 100, 399]) {
      for (let s = 0; s < NS; s++) {
        const all = Array.from({ length: g.nEnv }, (_, k) => ({ k, v: g.value(k, i, s) as number })).sort((a, b) => a.v - b.v || a.k - b.k);
        const skip = all.findIndex((e) => e.k === 3);
        const d = departure(g.value(3, i, s) as number, all.map((e) => e.v), skip, SIGNALS[s].floor);
        expect(h.trace.z[i * NS + s]).toBe(d.z);
        expect(h.trace.median[i * NS + s]).toBe(quantileDrop(all.map((e) => e.v), skip, g.nEnv - 1, 0.5));
      }
    }
  });

  it("crossCheck stops on a tampered receipt or D, naming it", () => {
    const h = harness({ nEnv: 5, censuses: 200, zStar: 7, value: (r, i, s) => (r === 5 && s === IDX.lineages && i >= 20 && i <= 120 ? 100 + 5 * (8 + (i % 7)) : 100) });
    expect(cc(h, 7).length).toBe(1);
    const tamper = (f: (r: ScoringResult) => void) => {
      const r = structuredClone(h.result);
      f(r);
      return () => crossCheck(r, h.trace, { id: "subject", zStar: 7, zRing: h.zRing, recordD: null });
    };
    expect(tamper((r) => (r.receipts[0].startStep += 100))).toThrow(/starts at step/);
    expect(tamper((r) => (r.receipts[0].endStep += 100))).toThrow(/window ends/);
    expect(tamper((r) => (r.receipts[0].minAbsZ += 1e-9))).toThrow(/window minimum/);
    expect(tamper((r) => (r.receipts[0].value += 1))).toThrow(/value/);
    expect(tamper((r) => (r.receipts[0].median += 1))).toThrow(/median/);
    expect(tamper((r) => (r.dBySignal.find((d) => d.signal === "lineages" && d.side === "high")!.D += 1e-9))).toThrow(/D on lineages high/);
    expect(tamper((r) => (r.dBySignal.find((d) => d.signal === "fusions" && d.side === "low")!.D = 1))).toThrow(/D on fusions low/);
    expect(tamper((r) => (r.D[0] += 1))).toThrow(/largest of the 26/);
    expect(tamper((r) => (r.receipts = []))).toThrow(/differ from the bell's receipts/);
    expect(() => cc(h, 7, h.result.D[0] + 1e-12)).toThrow(/record D mismatch/);
    expect(() => cc(h, 7, h.result.D[0])).not.toThrow();
  });
});

describe("the record", () => {
  const mutate = (f: (r: Record<string, any>) => void) => {
    const r = JSON.parse(RECORD_TEXT);
    f(r);
    return () => parseBellRecord(JSON.stringify(r));
  };
  it("reads the committed record", () => {
    const r = record();
    expect(zStarFor(r, "gradient-m3")).toBe(7.0429124518134785);
    expect(zStarFor(r, "spots-m3")).toBe(11.4665);
    expect(recordD(r, "replay-m4/gradient-m3/neutral/seed-15")).toBe(7.1946666666666665);
    expect(recordD(r, "replay-m4/gradient-m3/treatment/seed-1")).toBe(74.195);
    expect(recordD(r, "replay-m4/gradient-m3/neutral/seed-12")).toBe(3.049913043478261);
    expect(() => zStarFor(r, "pond-m3")).toThrow(/no calibrated threshold for pond-m3/);
  });
  it("refuses what it cannot ring from", () => {
    expect(mutate((r) => (r.complete = false))).toThrow(/complete is not true/);
    expect(mutate((r) => (r.summary.secondary.status = "not-called"))).toThrow(/not "called"/);
    expect(mutate((r) => (r.summary.secondary.W = 10))).toThrow(/W = 10/);
    expect(mutate((r) => (r.summary.secondary.perPreset["spots-m3"].zStar = null))).toThrow(/spots-m3 has no finite zStar/);
    expect(mutate((r) => (r.parameters.signals[2].floor = 2))).toThrow(/signals differ/);
    expect(mutate((r) => r.parameters.signals.pop())).toThrow(/signals differ/);
    expect(mutate((r) => (r.version = 1))).toThrow(/version 1/);
    expect(mutate((r) => (r.rule = "other"))).toThrow(/rule/);
    expect(mutate((r) => (r.corpus[3].presetIdentity = "ffff"))).toThrow(/two presetIdentity values/);
    expect(mutate((r) => (r.parameters.primary.Z = "<script>"))).toThrow(/parameters.primary/);
    expect(() => parseBellRecord("{")).toThrow(/not JSON/);
  });
});

describe("planNotebook", () => {
  const rec = record();
  const at = (id: string) => ({ dir: `/base/${id}/`, real: `/base/${id}`, manifest: manifestFor(id, 10_000) });
  it("places corpus members, other corpus runs and outside bundles", () => {
    const plan = planNotebook({
      preset: "gradient-m3",
      record: rec,
      corpus: gradientCorpus(),
      subjects: [at("replay-m4/gradient-m3/neutral/seed-15"), at("replay-m4/gradient-m3/treatment/seed-1"), at("replay-calib/gradient-m3/neutral/seed-1001"), { dir: "x", real: "/elsewhere/x", manifest: manifestFor("sandbox/gradient-m3/treatment/seed-3", 10_000) }],
    });
    expect(plan.envelope.length).toBe(40);
    expect(plan.zStar).toBe(7.0429124518134785);
    expect(plan.zRing).toBe(nextUp(7.0429124518134785));
    const [n15, t1, c1001, out] = plan.subjects;
    expect(n15.member).toBe(true);
    expect(plan.runs[n15.run].id).toBe("replay-m4/gradient-m3/neutral/seed-15");
    expect(n15.recordD).toBe(7.1946666666666665);
    expect(t1.member).toBe(false);
    expect(t1.run).toBe(40);
    expect(t1.recordD).toBe(74.195);
    expect(c1001.calibration).toBe(true);
    expect(out.corpusRun).toBe(null);
    expect(out.recordD).toBe(null);
    expect(out.run).toBe(41);
    expect(plan.subjects.map((s) => s.outName)).toEqual(["replay-m4-gradient-m3-neutral-seed-15", "replay-m4-gradient-m3-treatment-seed-1", "replay-calib-gradient-m3-neutral-seed-1001", "sandbox-gradient-m3-treatment-seed-3"]);
  });
  it("refuses a missing envelope run", () => {
    const corpus = gradientCorpus().map((c) => (c.run.id === "replay-m4/gradient-m3/neutral/seed-7" ? { ...c, real: null } : c));
    expect(() => planNotebook({ preset: "gradient-m3", record: rec, corpus, subjects: [at("replay-m4/gradient-m3/neutral/seed-15")] })).toThrow(/1 of the 40 gradient-m3 neutral runs .* missing .*seed-7/);
  });
  it("refuses a presetIdentity that is not the record's", () => {
    const s = at("replay-m4/gradient-m3/treatment/seed-1");
    s.manifest.presetIdentity = "0000000000000000";
    expect(() => planNotebook({ preset: "gradient-m3", record: rec, corpus: gradientCorpus(), subjects: [s] })).toThrow(/presetIdentity 0000000000000000/);
  });
  it("refuses a copy of an envelope run stored elsewhere, and a corpus directory naming another run", () => {
    const copy = { dir: "/tmp/copy", real: "/tmp/copy", manifest: manifestFor("replay-m4/gradient-m3/neutral/seed-15", 10_000) };
    expect(() => planNotebook({ preset: "gradient-m3", record: rec, corpus: gradientCorpus(), subjects: [copy] })).toThrow(/scored against its own copy/);
    const wrong = { ...at("replay-m4/gradient-m3/neutral/seed-15"), manifest: manifestFor("replay-m4/gradient-m3/neutral/seed-16", 10_000) };
    expect(() => planNotebook({ preset: "gradient-m3", record: rec, corpus: gradientCorpus(), subjects: [wrong] })).toThrow(/manifest says/);
    expect(() => planNotebook({ preset: "gradient-m3", record: rec, corpus: gradientCorpus(), subjects: [at("replay-m4/gradient-m3/neutral/seed-15"), at("replay-m4/gradient-m3/neutral/seed-15")] })).toThrow(/listed twice/);
  });
  it("refuses a preset with no calibrated threshold", () => {
    expect(() => planNotebook({ preset: "pond-m3", record: rec, corpus: [], subjects: [] })).toThrow(/no calibrated threshold/);
  });
});

describe("the model", () => {
  it("groups rings that start together, by start step, then by smallest |z|", () => {
    const m = sampleModel("rings");
    expect(m.entries.map((e) => e.startStep)).toEqual([15_100, 30_100]);
    expect(m.entries[0].notes.map((n) => n.signal)).toEqual(["individuals", "livingCells"]);
    expect(m.entries[0].notes[0].receipt.minAbsZ).toBeGreaterThan(m.entries[0].notes[1].receipt.minAbsZ);
    expect(m.entries[1].notes.map((n) => `${n.signal} ${n.side}`)).toEqual(["meanMass low"]);
    expect(m.entries[1].notes[0].stretches[0].ongoing).toBe(true);
    expect(m.quiet.length).toBe(26);
    expect(m.quiet.filter((q) => q.rang).length).toBe(3);
    expect(m.rings).toBe(3);
    expect(m.run.leftOut).toBe(false);
    expect(m.run.inCorpus).toBe(false);
  });
  it("pictures bin 25 censuses and hide no census", () => {
    const m = sampleModel("rings");
    const p = m.entries[0].notes[0].picture;
    expect(p.length).toBe(400 / BIN);
    expect(Math.max(...p.map((b) => b.hi))).toBe(4000);
    expect(Math.min(...p.map((b) => b.lo))).toBe(1000);
    expect(p[0].bandHi).toBeGreaterThan(p[0].median);
  });
  it("a calibration run's page says it cannot ring by construction", () => {
    const m = sampleModel("calibration");
    expect(m.run.calibration).toBe(true);
    expect(m.run.leftOut).toBe(true);
    expect(m.run.envelopeSize).toBe(39);
    expect(renderNotebook(m)).toContain("cannot ring here by construction");
  });
});

describe("words and numbers", () => {
  it("formats counts, shares and three significant figures", () => {
    expect(fmtValue("livingCells", 33684)).toBe("33,684");
    expect(fmtValue("livingCells", 248.5)).toBe("249");
    expect(fmtValue("dominantShare", 0.4123)).toBe("41%");
    expect(fmtValue("bioticRecycling", 0.9054)).toBe("91%");
    expect(fmtValue("meanMass", 7598.875)).toBe("7,600");
    expect(fmtValue("lineageShannon", 3.581452455808059)).toBe("3.58");
    expect(fmtValue("patternEntropy", 0.0123456)).toBe("0.0123");
    expect(fmtValue("meanMass", 9.996)).toBe("10.0");
    expect(fmtValue("maxGeneration", 43)).toBe("43");
    expect(fmtValue("fissions", 1234567)).toBe("1,234,567");
    expect(fmtZ(4.196888888888889)).toBe("4.20");
    expect(fmtZ(-1.234)).toBe("−1.23");
    expect(rateWindow(100)).toBe("in the last 1,000 steps");
    expect(rateWindow(200)).toBe("in the last 2,000 steps");
  });
  it("has a fixed text for each of the 13 signals, with its source", () => {
    expect(SIGNAL_TEXT.map((t) => t.name)).toEqual(SIGNALS.map((s) => s.name));
    for (const t of SIGNAL_TEXT) expect(t.source).toMatch(/^(packages|tools)\/.+\.ts:\d+/);
    expect(SIGNAL_TEXT.filter((t) => t.format === "share").map((t) => t.name)).toEqual(["bioticRecycling", "dominantShare"]);
    expect(SIGNAL_TEXT.filter((t) => t.format === "sig3").map((t) => t.name)).toEqual(["meanMass", "lineageShannon", "patternEntropy"]);
  });
  it("templates fill every slot, in British spelling with curly quotes", () => {
    for (const d of SIGNALS)
      for (const side of ["high", "low"] as const) {
        const s = noteSentence(d.name, side, { value: 12.5, median: 10, censuses: 64, startStep: 51_700, endStep: 58_000, minAbsZ: 7.2, censusEvery: 100 });
        expect(s).not.toMatch(/[<>]|undefined|NaN|\{|\}/);
        expect(s).not.toMatch(/['"]/);
        expect(s).not.toMatch(/behavior|color|center|favor/i);
        expect(s).toContain(`: ${fmtValue(d.name, 12.5)} at step 51,700, against a neutral median there of ${fmtValue(d.name, 10)}. `);
        expect(s).toContain("Beyond Z* for 64 censuses in a row, from step 51,700 to step 58,000; the weakest of them was 7.20 spreads");
        expect(s).toContain(side === "high" ? "above the median" : "below the median");
        if (d.kind === "rate") expect(s).toContain("in the last 1,000 steps:");
      }
    for (const t of SIGNAL_TEXT) for (const s of [t.meaning, t.high, t.low, t.label]) expect(s).not.toMatch(/['"]|behavior|color\b|center/);
    expect(noteSentence("livingCells", "low", { value: 21452, median: 33684, censuses: 120, startStep: 14_500, endStep: 26_400, minAbsZ: 7.1, censusEvery: 100 })).toBe(
      "Fewer living cells: 21,452 at step 14,500, against a neutral median there of 33,684. Beyond Z* for 120 censuses in a row, from step 14,500 to step 26,400; the weakest of them was 7.10 spreads below the median.",
    );
  });
});

describe("the record holds together", () => {
  const mutate = (f: (r: Record<string, any>) => void) => {
    const r = JSON.parse(RECORD_TEXT);
    f(r);
    return () => parseBellRecord(JSON.stringify(r));
  };
  const neutralRun = (r: Record<string, any>, id: string) => r.runs.find((x: any) => x.id === id && x.envelope === "all-neutral");
  it("refuses a preliminary or partial record", () => {
    expect(mutate((r) => (r.preliminaryOnly = true))).toThrow(/preliminaryOnly is not false/);
    expect(mutate((r) => delete r.preliminaryOnly)).toThrow(/preliminaryOnly is not false/);
    expect(mutate((r) => (r.missing = ["replay-m4/gradient-m3/neutral/seed-3"]))).toThrow(/missing is/);
    expect(mutate((r) => (r.corpus[0].steps = "1e6"))).toThrow(/numeric steps and censusEvery/);
    expect(mutate((r) => (r.parameters.primary.W = 200))).toThrow(/primary W is 200; the notebook holds the record's rings to the data only at W = 50/);
  });
  it("refuses counts that do not follow from its D values", () => {
    expect(mutate((r) => (r.summary.secondary.perPreset["gradient-m3"].zStar = 1))).toThrow(/gradient-m3 zStar 1 is not the largest of its 20 calibration D values \(7.0429124518134785\)/);
    expect(mutate((r) => (neutralRun(r, "replay-calib/gradient-m3/neutral/seed-1001").D["50"] = 8))).toThrow(/zStar 7.0429124518134785 is not the largest/);
    expect(mutate((r) => (r.summary.secondary.perPreset["spots-m3"].calibRuns = 19))).toThrow(/calibRuns 19/);
    expect(mutate((r) => (neutralRun(r, "replay-m4/gradient-m3/neutral/seed-12").D["50"] = 9))).toThrow(/held out .*recounted 2 of 20/);
    expect(mutate((r) => (r.summary.secondary.perPreset["gradient-m3"].heldOutNeutral.k = 0))).toThrow(/recounted 1 of 20/);
    expect(mutate((r) => (r.summary.secondary.perPreset["gradient-m3"].expected = 1))).toThrow(/expected 1, recounted/);
    expect(mutate((r) => (r.summary.secondary.heldOutNeutralTotal.k = 2))).toThrow(/heldOutNeutralTotal 2 of 30/);
    expect(mutate((r) => (r.summary.secondary.heldOutNeutralTotal.expected = 1.5))).toThrow(/heldOutNeutralTotal/);
    expect(mutate((r) => (r.summary.criterion1.k = 29))).toThrow(/criterion1 29 of 70, recounted 30 of 70/);
    expect(mutate((r) => (r.summary.criterion1.n = 71))).toThrow(/criterion1 30 of 71/);
    expect(mutate((r) => (neutralRun(r, "replay-calib/gradient-m3/neutral/seed-1002").rings = []))).toThrow(/seed-1002 lists 0 ring\(s\) at Z = 4, W = 50 with D 5.65/);
    expect(mutate((r) => delete r.summary.secondary.heldOutNeutralTotal)).toThrow(/heldOutNeutralTotal/);
    expect(mutate((r) => (r.summary.criterion1 = { status: "fail" }))).toThrow(/criterion1 has no k and n/);
  });
  it("checks rings run by run, not only in aggregate", () => {
    // Codex pass 2: move seed-1002's one ring to seed-1001 (D 3.51) as livingCells; 30 runs still list rings.
    const moved = mutate((r) => {
      const from = neutralRun(r, "replay-calib/gradient-m3/neutral/seed-1002"), to = neutralRun(r, "replay-calib/gradient-m3/neutral/seed-1001");
      to.rings = [{ ...from.rings[0], signal: "livingCells" }];
      from.rings = [];
    });
    expect(moved).toThrow(/seed-100[12] lists [01] ring\(s\) at Z = 4, W = 50 with D/);
    const ring = (f: (g: Record<string, any>) => void) => mutate((r) => f(neutralRun(r, "replay-calib/gradient-m3/neutral/seed-1002").rings[0]));
    expect(ring((g) => (g.signal = "weather"))).toThrow(/lists a ring .* the bell cannot write/);
    expect(ring((g) => (g.side = "up"))).toThrow(/the bell cannot write/);
    expect(ring((g) => (g.minAbsZ = 6))).toThrow(/smallest side·z 6, outside \[4, D 5.65/);
    expect(ring((g) => (g.minAbsZ = 3.9))).toThrow(/smallest side·z 3.9, outside/);
    expect(ring((g) => (g.startStep = 9_900))).toThrow(/spans steps 9900 to/);
    expect(ring((g) => (g.Z = 3))).toThrow(/lists rings at other than Z = 4, W = 50/);
    expect(mutate((r) => neutralRun(r, "replay-calib/gradient-m3/neutral/seed-1002").rings.push({ ...neutralRun(r, "replay-calib/gradient-m3/neutral/seed-1002").rings[0] }))).toThrow(/the bell cannot write/);
    expect(mutate((r) => (neutralRun(r, "replay-calib/gradient-m3/neutral/seed-1002").flagged = false))).toThrow(/flagged false with D 5.65/);
    expect(mutate((r) => (neutralRun(r, "replay-calib/gradient-m3/neutral/seed-1002").D_primary = 5))).toThrow(/D_primary 5 is not its D at W = 50/);
    expect(mutate((r) => (neutralRun(r, "replay-calib/gradient-m3/neutral/seed-1002").rings = [null]))).toThrow(/a ring that is not an object/);
  });
  it("holds a corpus run scored on disk to its record entry: D and every ring field", () => {
    const r = record();
    const id = "replay-calib/gradient-m3/neutral/seed-1002";
    const e = r.runs.find((x) => x.id === id && x.envelope === "all-neutral")!;
    const res = (D: number, receipts: unknown[]) => ({ D: [D], receipts }) as unknown as ScoringResult;
    const atZ = (Z: number) => e.rings.map((g) => ({ ...g, Z }));
    // Receipts at other Zs (the notebook's own zRing) are ignored; the primary Z's must be the record's exactly.
    expect(() => checkCorpusScore(r, id, res(e.D["50"], [...atZ(7.5), ...e.rings]))).not.toThrow();
    expect(() => checkCorpusScore(r, id, res(e.D["50"] + 1e-12, e.rings))).toThrow(/STOP: replay-calib\/gradient-m3\/neutral\/seed-1002: on disk it scores D .* the bell record says 5.65/);
    expect(() => checkCorpusScore(r, id, res(e.D["50"], []))).toThrow(/on disk its rings at Z = 4, W = 50 are none; the bell record lists/);
    expect(() => checkCorpusScore(r, id, res(e.D["50"], [{ ...e.rings[0], value: e.rings[0].value + 1e-9 }]))).toThrow(/on disk its rings/);
    expect(() => checkCorpusScore(r, id, res(e.D["50"], [...e.rings, { ...e.rings[0], signal: "fissions" }]))).toThrow(/on disk its rings/);
    expect(() => checkCorpusScore(r, "sandbox/gradient-m3/neutral/seed-1", res(0, []))).toThrow(/no all-neutral entry/);
  });
  it("gives the false alarms by signal and the arms from burn-in, from the rings", () => {
    const r = record();
    expect(falseAlarmSignals(r)).toEqual([
      { signal: "maxGeneration", side: "high", runs: 20 },
      { signal: "dominantShare", side: "high", runs: 16 },
      { signal: "fissions", side: "high", runs: 1 },
    ]);
    expect(armsFromBurnIn(r)).toEqual({ k: 14, of: 15 });
  });
  it("matches a run's manifest to its corpus entry", () => {
    const r = record();
    const ok = { id: "replay-m4/gradient-m3/neutral/seed-15", presetIdentity: "e1c93a9384b5d921", steps: 1_000_000, censusEvery: 100 };
    expect(() => checkAgainstRecordCorpus(r, ok)).not.toThrow();
    expect(() => checkAgainstRecordCorpus(r, { ...ok, steps: 20_000 })).toThrow(/manifest steps 20000, the bell record's corpus has 1000000/);
    expect(() => checkAgainstRecordCorpus(r, { ...ok, censusEvery: 200 })).toThrow(/censusEvery 200/);
    expect(() => checkAgainstRecordCorpus(r, { ...ok, presetIdentity: "x" })).toThrow(/presetIdentity "x"/);
    expect(() => checkAgainstRecordCorpus(r, { ...ok, id: "sandbox/gradient-m3/neutral/seed-1" })).toThrow(/not in the bell record's corpus/);
  });
});

describe("only measured values", () => {
  const good = () => Object.fromEntries([["step", 500], ...SIGNALS.filter((d) => d.source === "series").map((d) => [d.name, 3])]) as Record<string, unknown> & { step: number };
  it("refuses a missing, non-numeric or non-finite cell, naming run, step and signal", () => {
    expect(() => checkSignalCells("r", good())).not.toThrow();
    for (const [v, shown] of [["broken", `"broken"`], [null, "null"], [undefined, "missing"], [Infinity, "Infinity"], [JSON.parse("1e400"), "Infinity"], [NaN, "NaN"], [true, "true"]] as const) {
      const rec = good();
      if (v === undefined) delete rec.individuals;
      else rec.individuals = v;
      expect(() => checkSignalCells("replay-m4/x", rec)).toThrow(`STOP: replay-m4/x: series.jsonl step 500 has individuals ${shown}, not a finite number`);
    }
  });
  it("ZTrace refuses scores that overflow, and its own guards", () => {
    const vec = (v: number) => Array.from({ length: NS }, () => v);
    const t = new ZTrace(2, [0, 1, 2], 3);
    expect(() => t.push(100, [vec(1e308), vec(1e308), vec(1e308), vec(-1e308)])).toThrow(/out of range for a finite score/);
    const t2 = new ZTrace(1, [0, 1], 2);
    expect(() => t2.push(100, [vec(1), vec(Infinity), vec(1)])).toThrow(/envelope run 1 has livingCells Infinity/);
    expect(() => t2.push(100, [vec(1), vec(1), vec(NaN)])).toThrow(/the bundle has livingCells NaN/);
    const t3 = new ZTrace(1, [0, 1], 2);
    t3.push(100, [vec(1), vec(1), vec(1)]);
    expect(() => t3.push(200, [vec(1), vec(1), vec(1)])).toThrow(/more than 1 censuses/);
    expect(() => new ZTrace(5, [3], 3)).toThrow(/no reference run left/);
  });
});

describe("pictures", () => {
  it("bins take the run's range, and the median and band at the column's last census", () => {
    // Every run, envelope and subject, at 100 + i: median 100 + i, spread 5% of it.
    const h = harness({ nEnv: 5, censuses: 60, zStar: 7, value: (_r, i, s) => (SIGNALS[s].kind === "rate" && i < 10 ? null : 100 + i) });
    const s = IDX.meanMass;
    const p = pictureBins(h.trace, s, 7);
    expect(p.map((b) => [b.from, b.to])).toEqual([[0, 24], [25, 49], [50, 59]]);
    expect(p[0].lo).toBe(100);
    expect(p[0].hi).toBe(124);
    expect(p[0].median).toBe(124);
    expect(p[0].bandLo).toBeCloseTo(124 - 7 * 6.2, 9);
    expect(p[0].bandHi).toBeCloseTo(124 + 7 * 6.2, 9);
    expect(p[2].median).toBe(159);
    // A rate is undefined for its first 10 censuses: the first column starts with the first defined one.
    const r = pictureBins(h.trace, IDX.fissions, 7);
    expect([r[0].lo, r[0].hi, r[0].median]).toEqual([110, 124, 124]);
  });
});

describe("failure paths", () => {
  const rec = record();
  const at = (id: string) => ({ dir: `/base/${id}`, real: `/base/${id}`, manifest: manifestFor(id, 10_000) });
  it("parseSubjectManifest refuses what it cannot place", () => {
    const m = (o: Record<string, unknown>) => JSON.stringify({ spec: { experiment: "e", presetId: "gradient-m3", condition: "neutral", seed: 1, steps: 100, censusEvery: 100 }, cfg: { neutral: true }, presetIdentity: "x", summary: {}, ...o });
    // The condition must be the physics: a "neutral" run whose config is not neutral (or the reverse), or one with overrides, is refused.
    expect(() => parseSubjectManifest("d", m({ cfg: { neutral: false } }))).toThrow(/d: manifest condition neutral but cfg.neutral false/);
    expect(() => parseSubjectManifest("d", m({ cfg: undefined }))).toThrow(/no cfg.neutral flag/);
    expect(() => parseSubjectManifest("d", m({ cfg: { neutral: "yes" } }))).toThrow(/no cfg.neutral flag/);
    expect(() => parseSubjectManifest("d", m({ spec: { experiment: "e", presetId: "gradient-m3", condition: "neutral", seed: 1, steps: 100, censusEvery: 100, overrides: { neutral: false } } }))).toThrow(/spec has overrides \{"neutral":false\}/);
    expect(() => parseSubjectManifest("d", m({ spec: { experiment: "e", presetId: "gradient-m3", condition: "treatment", seed: 1, steps: 100, censusEvery: 100 } }))).toThrow(/condition treatment but cfg.neutral true/);
    expect(parseSubjectManifest("d", m({ spec: { experiment: "e", presetId: "gradient-m3", condition: "treatment", seed: 1, steps: 100, censusEvery: 100, overrides: null }, cfg: { neutral: false } })).cfg.neutral).toBe(false);
    expect(parseSubjectManifest("d", m({})).spec.seed).toBe(1);
    expect(() => parseSubjectManifest("d", "{")).toThrow(/d: manifest.json is not JSON/);
    expect(() => parseSubjectManifest("d", m({ summary: undefined }))).toThrow(/no summary \(unfinished run\)/);
    expect(() => parseSubjectManifest("d", m({ presetIdentity: "" }))).toThrow(/no presetIdentity/);
    expect(() => parseSubjectManifest("d", m({ spec: { experiment: "e", presetId: "gradient-m3", condition: "neutral", seed: "1", steps: 100, censusEvery: 100 } }))).toThrow(/no numeric seed/);
    expect(() => parseSubjectManifest("d", m({ spec: { experiment: "", presetId: "gradient-m3", condition: "neutral", seed: 1, steps: 100, censusEvery: 100 } }))).toThrow(/no experiment/);
    expect(() => parseSubjectManifest("d", m({ spec: null }))).toThrow(/no spec object/);
  });
  it("planNotebook refuses another preset, a record with no identity or D, and two pages with one name", () => {
    expect(() => planNotebook({ preset: "gradient-m3", record: rec, corpus: gradientCorpus(), subjects: [{ dir: "/base/x", real: "/base/x", manifest: manifestFor("sandbox/spots-m3/neutral/seed-1", 10_000) }] })).toThrow(/preset spots-m3, planned with gradient-m3/);
    const noIdent = { ...rec, corpus: rec.corpus.filter((c) => !c.id.includes("/gradient-m3/")) };
    expect(() => planNotebook({ preset: "gradient-m3", record: noIdent, corpus: gradientCorpus(), subjects: [] })).toThrow(/lists no gradient-m3 run/);
    const noD = { ...rec, runs: rec.runs.filter((x) => x.id !== "replay-m4/gradient-m3/treatment/seed-1") };
    expect(() => planNotebook({ preset: "gradient-m3", record: noD, corpus: gradientCorpus(), subjects: [at("replay-m4/gradient-m3/treatment/seed-1")] })).toThrow(/no all-neutral D at W = 50/);
    const a = { dir: "/a", real: "/a", manifest: manifestFor("sandbox/gradient-m3/treatment/seed-3", 10_000) };
    const b = { dir: "/b", real: "/b", manifest: manifestFor("sandbox/gradient-m3/treatment/seed-3", 10_000) };
    expect(() => planNotebook({ preset: "gradient-m3", record: rec, corpus: gradientCorpus(), subjects: [a, b] })).toThrow(/two bundles would write sandbox-gradient-m3-treatment-seed-3.html/);
  });
});

describe("the wiring from trace to note", () => {
  // Envelope constant at 100 (spread 5), except lineages, at 200 (spread 10) after census 20. The subject, run 5:
  //   lineages high: z = 10..12 over censuses 20..69 (the receipt's window, smallest 10; 15 at census 60, the stretch's strongest),
  //   then z = 8..9 over 70..130 (the stretch's weakest 8), and z = 9 again over 145..199 (a second stretch of 55, still going);
  //   meanMass low (z = -9) over 20..80 and high (z = 9) over 120..180, so its timeline row needs sorting.
  const zOf = (i: number, s: number): number => {
    if (s === IDX.lineages) {
      if (i === 60) return 15;
      if (i >= 20 && i <= 69) return 10 + (i % 3);
      if (i >= 70 && i <= 130) return 8 + (i % 2);
      if (i >= 145) return 9;
    }
    if (s === IDX.meanMass) {
      if (i >= 20 && i <= 80) return -9;
      if (i >= 120 && i <= 180) return 9;
    }
    return 0;
  };
  const level = (i: number, s: number) => (s === IDX.lineages && i > 20 ? 200 : 100);
  const h = harness({ nEnv: 5, censuses: 200, zStar: 7, value: (r, i, s) => (r === 5 ? level(i, s) + (level(i, s) / 20) * zOf(i, s) : level(i, s)) });
  const m = harnessModel(h, { zStar: 7, nEnv: 5, censuses: 200 });
  const notes = m.entries.flatMap((e) => e.notes);
  const lin = notes.find((n) => n.signal === "lineages")!;
  const html = renderNotebook(m);
  it("the sentence carries the first census's value and median, and the stretch's length and weakest |z|", () => {
    expect(lin.receipt.minAbsZ).toBe(10);
    expect(lin.stretches.map((s) => [s.censuses, s.minAbsZ, s.maxAbsZ, s.ongoing])).toEqual([[111, 8, 15, false], [55, 9, 9, true]]);
    expect(lin.sentence).toBe("More lineages: 160 at step 2,100, against a neutral median there of 100. Beyond Z* for 111 censuses in a row, from step 2,100 to step 13,100; the weakest of them was 8.00 spreads above the median.");
    expect(lin.spread).toBe(5);
    expect(html).toContain(`<p>${lin.sentence}</p>`);
  });
  it("prints each receipt number in its own row", () => {
    expect(html).toContain(`<dt>Smallest |z| in that window</dt><dd class="mono">10</dd><dt>Value at its first census</dt><dd class="mono">160</dd><dt>Neutral median there</dt><dd class="mono">100</dd><dt>Spread there</dt><dd class="mono">5</dd><dt>D on this signal and side</dt><dd class="mono">${lin.D}</dd>`.replaceAll("</dd><dt>", "</dd>\n<dt>"));
  });
  it("stretch tables say which stretch is still going", () => {
    const mm = notes.filter((n) => n.signal === "meanMass");
    expect(mm.map((n) => n.side).sort()).toEqual(["high", "low"]);
    expect(html).toContain(`<tr><td class="num">2,100</td><td class="num">13,100</td><td class="num">111</td><td class="num">8.00</td><td class="num">15.00</td><td>no</td></tr>`);
    const ongoing = harnessModel(harness({ nEnv: 5, censuses: 200, zStar: 7, value: (r, i, s) => (r === 5 && s === IDX.individuals && i >= 120 ? 200 : 100) }), { zStar: 7, nEnv: 5, censuses: 200 });
    expect(renderNotebook(ongoing)).toContain(`<td class="num">20,000</td><td class="num">80</td><td class="num">20.00</td><td class="num">20.00</td><td>yes, at the last census</td></tr>`);
  });
  it("the quiet table gives Z* − D and marks exactly the rings", () => {
    for (const q of m.quiet) expect(q.gap).toBe(7 - q.D);
    expect(m.quiet.filter((q) => q.rang).map((q) => `${q.signal} ${q.side}`).sort()).toEqual(["lineages high", "meanMass high", "meanMass low"]);
    expect(html).toContain(`<tr><td>Lineages</td><td>high</td><td class="num">${fmtZ(lin.D)}</td><td class="num">${fmtZ(7 - lin.D)}</td><td>rang</td></tr>`);
    expect(html).toContain(`<tr><td>Lineages</td><td>low</td><td class="num">0.00</td><td class="num">7.00</td><td>quiet</td></tr>`);
  });
  it("every note card carries both chips", () => {
    const cards = html.match(/<article class="card">[\s\S]*?<\/article>/g)!;
    expect(cards.length).toBe(notes.length);
    for (const c of cards) {
      expect(c).toContain(`<span class="state measured">Measured</span><span class="fine">the numbers</span>`);
      expect(c).toContain(`<span class="state pending">Unclear</span><span class="fine">what it means</span>`);
    }
  });
  it("the timeline draws each stretch where it is, high on top, low below, after the burn-in", () => {
    const row = (label: string) => html.match(new RegExp(`<div class="tl-label">${label}[^]*?</svg>`))![0];
    const bars = (svg: string) => [...svg.matchAll(/<rect class="bar" x="([\d.]+)" y="(\d+)" width="([\d.]+)"/g)].map((x) => ({ x: Number(x[1]), y: Number(x[2]), w: Number(x[3]) }));
    const xOf = (i: number) => Math.round((i / 200) * 720 * 10) / 10;
    const lb = bars(row("Lineages"));
    expect(lb).toEqual(lin.stretches.map((s) => ({ x: xOf(s.startIdx), y: 2, w: Math.round(((s.endIdx + 1 - s.startIdx) / 200) * 720 * 10) / 10 })));
    const mb = bars(row("Mean body mass"));
    expect(mb.map((b) => [b.x, b.y])).toEqual([[xOf(20), 13], [xOf(120), 2]]);
    expect(m.timeline.find((t) => t.signal === "meanMass")!.stretches.map((s) => s.side)).toEqual(["low", "high"]);
    expect(bars(row("Fusions"))).toEqual([]);
    // Burn-in at step 1,000 is census 9: the shaded rect ends there.
    expect(row("Lineages")).toContain(`<rect class="burn" x="1" y="1" width="${(Math.round((xOf(9) - 1) * 10) / 10).toFixed(1)}"`);
  });
  it("a note's picture shades its stretches and draws the band around the median, the run's line from low to high", () => {
    const card = html.match(/<article class="card">[\s\S]*?<\/article>/g)!.find((c) => c.includes("Lineages, high side"))!;
    const spans = [...card.matchAll(/<rect class="span" x="([\d.]+)"/g)].map((x) => Number(x[1]));
    expect(spans).toEqual(lin.stretches.map((s) => Math.round((s.startIdx / 200) * 720 * 10) / 10));
    const nums = (cls: string) => [...card.match(new RegExp(`<path class="${cls}" d="([^"]+)"`))![1].matchAll(/-?[\d.]+/g)].map(Number);
    const med = nums("med"), band = nums("band");
    const nb = lin.picture.length;
    for (let b = 0; b < nb; b++) {
      const yMed = med[2 * b + 1], yHi = band[2 * b + 1], yLo = band[2 * (2 * nb - 1 - b) + 1];
      expect(yHi).toBeLessThan(yMed); // higher on the page
      expect(yLo).toBeGreaterThan(yMed);
    }
    // The run's line in a column with an excursion spans from its lowest (below) to its highest value (above).
    const hist = [...card.match(/<path class="hist" d="([^"]+)"/)![1].matchAll(/M([\d.]+) ([\d.]+)V([\d.]+)/g)].map((x) => [Number(x[2]), Number(x[3])]);
    expect(hist.length).toBe(nb);
    const col = lin.picture.findIndex((b) => b.from <= 20 && b.to >= 20);
    expect(lin.picture[col].hi).toBeGreaterThan(lin.picture[col].lo);
    expect(hist[col][0]).toBeLessThan(hist[col][1]);
  });
});
