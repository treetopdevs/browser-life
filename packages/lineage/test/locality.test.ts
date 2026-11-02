import { describe, expect, it } from "vitest";
import { G, NN_BYTES, NN_H, NN_I, NN_O, IN, OUT, defaultConfig, w1, w2, stateHash, buildWorld, decodeGenome, cellCount } from "@bl/schema";
import { RefSim, mutateInPlace } from "@bl/sim-ref";
import {
  ALLOC_M3, ASSAY, AssayCache, GENERALIST_ROLES, GRID_POINTS, NEIGHBOURHOOD, PROBE_AXES, applyOperator, assertIntegers, buildNeighbourhood, bytesChanged, decide, deadHidden, degreeMatchedNull,
  describeEdit, describeProbes, drawAssaySubset, editFromSlots, genomeHash, generalistStart, median2, nonzeroCounts, permuteHidden, permuteSensors, probeGenome, responses, runAssay, strataKey, sum, tau, weightL1,
  weightsOf, withWeights, withinStructural, zeroSlot, m3Start, slotValue, SCENARIO_IDS, outcomeOf, qualify, tally, ipwPermille, readoutFor, type GenomeVerdictInputs, type Row, type AssayRecord, type GenomeRecord,
} from "@bl/lineage";

const gen = generalistStart().words;
const cfg = defaultConfig();
const P = (w: Uint32Array) => probeGenome(w);

describe("neighbourhood", () => {
  it("is deterministic and keyed on genome and index", () => {
    const a = buildNeighbourhood(gen, "g"), b = buildNeighbourhood(gen, "g"), c = buildNeighbourhood(gen, "other");
    expect(JSON.stringify(a.edits)).toBe(JSON.stringify(b.edits));
    expect(a.words.every((w, i) => genomeHash(w) === genomeHash(b.words[i]))).toBe(true);
    expect(JSON.stringify(a.edits.map((e) => e.slots.map((s) => s.slot)))).not.toBe(JSON.stringify(c.edits.map((e) => e.slots.map((s) => s.slot))));
    expect(() => assertIntegers(a.edits)).not.toThrow();
    expect(a.edits.length).toBe(2 * (10 + 4 + 10 + 4 + 3) + 4 * NEIGHBOURHOOD.drawsPerMulti);
  });

  it("single-locus edits are exactly mutateInPlace", () => {
    const nb = buildNeighbourhood(gen, "g");
    for (const [i, e] of nb.edits.entries()) {
      if (e.k !== 1) continue;
      const w = gen.slice();
      mutateInPlace(w, 1, 0, cfg, e.slots[0].slot, e.slots[0].opDelta + cfg.mutStep);
      expect(Array.from(nb.words[i])).toEqual(Array.from(w));
    }
    expect(new Set(nb.edits.filter((e) => e.k === 1).map((e) => e.kind))).toEqual(new Set(["w1", "b1", "w2", "b2", "physics"]));
  });

  it("separates unchanged, boundary-clamped and genuine edits, and sigma scaling is not clamping", () => {
    const at = (slot: number, v: number) => { const wb = weightsOf(gen); wb[slot] = v; return withWeights(gen, wb); };
    const s = 5;
    expect(editFromSlots(at(s, 127), "a", "single24", "w1", [{ slot: s, opDelta: 24 }]).edit.cls).toBe("unchanged");
    const clamped = editFromSlots(at(s, 120), "b", "single24", "w1", [{ slot: s, opDelta: 24 }]).edit;
    expect(clamped.cls).toBe("boundary-clamped");
    expect(clamped.slots[0]).toMatchObject({ expected: 24, applied: 7 });
    expect(editFromSlots(at(s, 3), "c", "single24", "w1", [{ slot: s, opDelta: 24 }]).edit.cls).toBe("genuine");
    const sig = editFromSlots(gen, "d", "single6", "physics", [{ slot: NN_BYTES + 1, opDelta: 6 }]).edit.slots[0];
    expect(sig).toMatchObject({ expected: 1, applied: 1, cls: "genuine" });
    expect(editFromSlots(gen, "e", "single6", "physics", [{ slot: NN_BYTES + 1, opDelta: -6 }]).edit.slots[0]).toMatchObject({ expected: -2, applied: -2, cls: "genuine" });
  });

  it("multi-locus edits match total requested magnitude and record realised magnitude", () => {
    const nb = buildNeighbourhood(gen, "g");
    for (const e of nb.edits.filter((x) => x.family === "multi2" || x.family === "multi4")) {
      expect(e.requestedL1).toBe(24);
      expect(new Set(e.slots.map((s) => s.slot)).size).toBe(e.k);
      expect(e.slots.every((s) => s.slot < NN_BYTES)).toBe(true);
    }
    for (const e of nb.edits.filter((x) => x.family === "multi2x24" || x.family === "multi4x24")) expect(e.requestedL1).toBe(24 * e.k);
    expect(nb.edits.filter((x) => x.family === "multi2x24").map((x) => x.slots.map((s) => s.slot))).toEqual(nb.edits.filter((x) => x.family === "multi2").map((x) => x.slots.map((s) => s.slot)));
    const wb = weightsOf(gen); wb[5] = 127; wb[9] = 120;
    const e = editFromSlots(withWeights(gen, wb), "m", "multi2", "multi", [{ slot: 5, opDelta: 12 }, { slot: 9, opDelta: 12 }]).edit;
    expect(e.requestedL1).toBe(24);
    expect(e.realisedL1).toBe(7);
    expect(e.cls).toBe("boundary-clamped");
  });

  it("one-step undo is exact for weights and not claimed for sigma or clamped bytes", () => {
    const nb = buildNeighbourhood(gen, "g");
    for (const [i, e] of nb.edits.entries()) {
      const undo = nb.words[i].slice();
      for (let j = e.slots.length - 1; j >= 0; j--) applyOperator(undo, e.slots[j].slot, -e.slots[j].opDelta);
      expect(e.undoExact).toBe(genomeHash(undo) === genomeHash(gen));
      if (e.cls === "genuine" && e.slots.every((s) => s.slot < NN_BYTES)) expect(e.undoExact).toBe(true);
    }
    expect(editFromSlots(gen, "s", "single6", "physics", [{ slot: NN_BYTES + 1, opDelta: 6 }]).edit.undoExact).toBe(false);
    const wb = weightsOf(gen); wb[5] = 120;
    expect(editFromSlots(withWeights(gen, wb), "c", "single24", "w1", [{ slot: 5, opDelta: 24 }]).edit.undoExact).toBe(false);
  });

  it("the stratified assay subset follows the frozen allocation and excludes duplicates and non-genuine edits", () => {
    const nb = buildNeighbourhood(m3Start(4, "m3-sparse").words, "m3-c4");
    const { chosen, strata } = drawAssaySubset(nb, ALLOC_M3);
    expect(chosen.length).toBe(24);
    for (const i of chosen) { expect(nb.edits[i].cls).toBe("genuine"); expect(nb.edits[i].dupOf).toBeNull(); expect(ALLOC_M3[strataKey(nb.edits[i])]).toBeGreaterThan(0); }
    expect(Object.values(strata).every((s) => s.chosen <= s.population)).toBe(true);
    expect(drawAssaySubset(nb, ALLOC_M3).chosen).toEqual(chosen);
  });
});

describe("fixtures", () => {
  it("hidden-unit permutation keeps the probe byte-identical while the naive byte distance is large", () => {
    const p = permuteHidden(gen, 0, 1);
    expect(bytesChanged(gen, p)).toBeGreaterThanOrEqual(8);
    expect(weightL1(gen, p)).toBeGreaterThan(1000);
    const d = describeProbes(P(gen), P(p));
    expect(d.totalChanged).toBe(0);
    expect(Array.from(P(gen).outs)).toEqual(Array.from(P(p).outs));
    const dense = m3Start(9, "m3-dense").words, q = permuteHidden(dense, 1, 5);
    expect(describeProbes(P(dense), P(q)).totalChanged).toBe(0);
    expect(bytesChanged(dense, q)).toBeGreaterThan(20);
  });

  it("dead-hidden edit changes bytes but not outputs", () => {
    const dead = deadHidden(gen)[0];
    const wb = weightsOf(gen); wb[0 * NN_H + dead] = 24;
    const e = withWeights(gen, wb);
    expect(bytesChanged(gen, e)).toBe(1);
    expect(describeProbes(P(gen), P(e)).totalChanged).toBe(0);
  });

  it("shuffled sensor labels follow the pinned fixture-specific table and sensor attribution relabels as expected", () => {
    const sh = permuteSensors(gen, IN.P, IN.LIGHT);
    expect(describeProbes(P(gen), P(sh))).toMatchObject({ changed: [26244, 0, 0, 0, 0, 0, 0, 0], maxDelta: [102, 0, 0, 0, 0, 0, 0, 0], sensorReach: 2, sensorMask: 40 });
    // the same w2 h1->photo +6 edit, before and after the shuffle (pinned; no breadth invariant is promised)
    const edit = (w: Uint32Array) => { const e = editFromSlots(w, "x", "single6", "w2", [{ slot: GENERALIST_ROLES.photoFromH1, opDelta: 6 }]); return describeEdit(e.edit, w, e.words, P(w), P(e.words)); };
    expect(edit(gen)).toMatchObject({ changed: [26244, 0, 0, 0, 0, 0, 0, 0], participation: 1, sensorMask: 32 });
    expect(edit(sh)).toMatchObject({ changed: [13122, 0, 0, 0, 0, 0, 0, 0], participation: 0, sensorMask: 8 });
    // attribution: an edit at w1 in=k on the original is the edit at w1 in=pi(k) on the shuffled controller, as a pure relabelling
    for (const j of [0, 1, 2]) {
      const a = gen.slice(); applyOperator(a, w1(IN.LIGHT, j), 24);
      const b = sh.slice(); applyOperator(b, w1(IN.P, j), 24);
      expect(Array.from(permuteSensors(a, IN.P, IN.LIGHT))).toEqual(Array.from(b));
    }
  });

  it("generalist localisation matches the documented roles", () => {
    const e = editFromSlots(gen, "x", "single24", "w2", [{ slot: GENERALIST_ROLES.photoFromH1, opDelta: -24 }]);
    const d = describeEdit(e.edit, gen, e.words, P(gen), P(e.words));
    expect(d.changed.map((c) => c > 0)).toEqual([true, false, false, false, false, false, false, false]);
    expect(d.sensorMask).toBe(1 << IN.LIGHT);
    expect(d.breadth).toBe(1);
    expect(d.expression).toBe("controller");
  });

  it("breadth and reach never exceed structural reach on the generalist and an M3 genome", () => {
    for (const base of [gen, m3Start(4, "m3-sparse").words]) {
      const nb = buildNeighbourhood(base, "g");
      const pb = P(base);
      nb.edits.forEach((e, i) => { if (e.cls !== "genuine" || i % 4 !== 0) return; expect(withinStructural(describeEdit(e, base, nb.words[i], pb, P(nb.words[i])))).toBe(true); });
    }
  }, 180_000);

  it("degree-matched null preserves nonzero counts per layer", () => {
    const m = m3Start(9, "m3-dense").words;
    const n = degreeMatchedNull(m, 7);
    expect(nonzeroCounts(n)).toEqual(nonzeroCounts(m));
    expect(genomeHash(n)).not.toBe(genomeHash(m));
    expect(degreeMatchedNull(m, 7)).toEqual(n);
  });

  it("grid size equals the product of PROBE_AXES lengths", () => {
    expect(GRID_POINTS).toBe(PROBE_AXES.reduce((p, a) => p * a.length, 1));
    expect(GRID_POINTS).toBe(26244);
    expect(P(gen).outs.length).toBe(GRID_POINTS * NN_O);
    expect(PROBE_AXES.length).toBe(NN_I);
  });
});

const voter = (o: Partial<GenomeVerdictInputs>): GenomeVerdictInputs => ({ genome: "x", assayedGenuine: 24, A: 10, C: 2, K: 8, underpowered: false, medianBreadth2: 4, nullMedian2: 4, multiClean: { clean: 4, n: 6 }, singleClean: { clean: 4, n: 8 }, ...o });
describe("decision rule", () => {
  it("zero improvements gives underpowered, never a collateral verdict", () => {
    const v = decide({ voters: [voter({ genome: "a", A: 0, C: 0, K: 0, underpowered: true }), voter({ genome: "b", A: 0, C: 0, K: 0, underpowered: true })], sensitivityOk: true, neutralOk: true, slotsFilled: 2 });
    expect(v.kind).toBe("inconclusive");
    expect(v.reasons.join(" ")).toMatch(/below 5/);
  });
  it("calls broadly useful, entanglement, single-genome and measurement-limited as stated", () => {
    const ok = { sensitivityOk: true, neutralOk: true, slotsFilled: 2 };
    expect(decide({ ...ok, voters: [voter({ genome: "a" }), voter({ genome: "b" })] }).kind).toBe("broadly-useful");
    const ent = (g: string) => voter({ genome: g, A: 10, C: 7, K: 3, medianBreadth2: 10, nullMedian2: 6 });
    expect(decide({ ...ok, voters: [ent("a"), ent("b")] }).kind).toBe("entanglement-signal");
    expect(decide({ ...ok, voters: [voter({ genome: "a" }), ent("b")] }).kind).toBe("inconclusive");
    const one = decide({ ...ok, voters: [voter({ genome: "a" })] });
    expect(one.kind).toBe("inconclusive");
    expect(one.singleGenome).toBe(true);
    expect(decide({ ...ok, voters: [] }).kind).toBe("measurement-limited");
    expect(decide({ ...ok, sensitivityOk: false, voters: [voter({ genome: "a" }), voter({ genome: "b" })] }).kind).toBe("measurement-limited");
    expect(decide({ ...ok, neutralOk: false, voters: [voter({ genome: "a" }), voter({ genome: "b" })] }).kind).toBe("measurement-limited");
    // multi-locus clean share more than 5 points below single-locus blocks "broadly useful"
    expect(decide({ ...ok, voters: [voter({ genome: "a", multiClean: { clean: 0, n: 6 }, singleClean: { clean: 4, n: 8 } }), voter({ genome: "b" })] }).kind).toBe("inconclusive");
  });
  it("median2 keeps medians integer", () => { expect(median2([1, 2, 3])).toBe(4); expect(median2([1, 2, 3, 10])).toBe(5); expect(median2([])).toBe(0); });
});

describe("physical assays (slow)", () => {
  const cache = new AssayCache();
  it("generalist baseline separates light from dark across the frozen seeds, and zeroing w2 h1->photo moves light-growth by more than tau", () => {
    const lg = responses(cache, gen, "light-growth"), dp = responses(cache, gen, "dark-persistence"), dt = responses(cache, gen, "dim-transfer");
    expect(Math.min(...lg)).toBeGreaterThan(ASSAY.gate.lightGrowthFloor);
    expect(Math.min(...lg.map((v, i) => v - dp[i]))).toBeGreaterThan(ASSAY.gate.lightOverDarkMargin);
    expect(dt.length).toBe(2);
    const t = tau(lg, lg);
    expect(sum(responses(cache, zeroSlot(gen, GENERALIST_ROLES.photoFromH1), "light-growth")) - sum(lg)).toBeLessThan(-t);
  }, 120_000);

  it("neutral edits give zero effect under the assay", () => {
    const dead = deadHidden(gen)[0];
    const wb = weightsOf(gen); wb[dead] = 24;
    const neutral = [permuteHidden(gen, 0, 1), withWeights(gen, wb), (() => { const x = gen.slice(); applyOperator(x, GENERALIST_ROLES.epbToH0, 24); return x; })(), gen.slice()];
    for (const w of neutral) for (const sc of SCENARIO_IDS) for (const seed of ASSAY.seeds) {
      const a = cache.get(gen, sc, seed), b = cache.get(w, sc, seed);
      expect([b.B1, b.P1, b.E1, b.A1, b.C1]).toEqual([a.B1, a.P1, a.E1, a.A1, a.C1]);
    }
    // seed sensitivity is real and measured on the baseline, separately
    expect(cache.get(gen, "light-growth", 1).B1).not.toBe(cache.get(gen, "light-growth", 2).B1);
  }, 120_000);

  it("physical assay does not mutate during the run", () => {
    const r = runAssay(gen, "light-growth", 1, 40);
    expect(r.events).toBe(0);
    expect(ASSAY.mutRate).toBe(0);
  });

  it("assay leaves the input genome untouched and an observed run equals a plain run", () => {
    const before = gen.slice();
    runAssay(gen, "dim-transfer", 1, 20);
    expect(Array.from(gen)).toEqual(Array.from(before));
    const mk = () => { const s = defaultConfig({ seed: 1, tileW: 16, tileH: 16, kernelRadius: 3, mutRate: 0, lightMode: "uniform" }); return new RefSim(buildWorld(s, { nutrient: 32, founders: [{ x: 8, y: 8, radius: 6, biomass: 64, energy: 128, genome: decodeGenome(gen.slice()) }] })); };
    const plain = mk(), observed = mk();
    plain.run(20);
    for (let i = 0; i < 20; i++) { observed.step(); probeGenome(gen); void cellCount(observed.cfg); }
    expect(stateHash(observed.state)).toBe(stateHash(plain.state));
  });

  it("genome words and slot reads agree", () => {
    expect(slotValue(gen, w1(IN.EPB, 0))).toBe(127);
    expect(slotValue(gen, w2(1, OUT.PHOTO))).toBe(110);
    expect(gen[G.LIN_HI]).toBe(0);
  });
});

// Hand-built inputs for the measurement functions, so a wrong rule cannot hide behind a byte-equal regeneration.
const TAU: [number, number, number] = [10, 20, 30];
const assay = (dev: [number, number, number], sums: [number, number, number] = [3000, 3000, 3000]): AssayRecord => ({ sums, dev, stocks: { B0: 0, B1: 0, P0: 0, P1: 0, E0: 0, E1: 0 } });
const row = (o: Partial<Row>): Row => ({ genome: "g", id: "x", family: "single24", kind: "w1", k: 1, cls: "genuine", slots: [], requestedL1: 0, realisedL1: 0, undoExact: true, dupOf: null, hash: "h", expression: "controller", changed: [], maxDelta: [], breadth: 2, participation: 0, sensorReach: 1, sensorMask: 0, structActuators: 0, structSensors: 0, withinStructural: true, assayed: true, assay: null, ...o });
const rec = (o: Partial<Row>, a: AssayRecord | null) => row({ ...o, assay: a, assayed: a !== null });

describe("measurement rules on hand-built inputs", () => {
  it("outcomeOf is strict at tau on both sides", () => {
    const at = outcomeOf(assay([10, 20, 30]), { tau: TAU });
    expect(at.improves).toEqual([false, false, false]);
    expect(outcomeOf(assay([11, 0, 0]), { tau: TAU }).improves).toEqual([true, false, false]);
    expect(outcomeOf(assay([-10, -20, -30]), { tau: TAU }).harms).toEqual([false, false, false]);
    expect(outcomeOf(assay([0, 0, -31]), { tau: TAU }).harms).toEqual([false, false, true]);
  });

  it("outcomeOf classes collateral, clean, transfer and viability", () => {
    const clean = outcomeOf(assay([11, 0, 31]), { tau: TAU });
    expect(clean).toMatchObject({ improvesAny: true, collateral: false, clean: true, lgTransfer: true, viable: true });
    const coll = outcomeOf(assay([11, -21, 0]), { tau: TAU });
    expect(coll).toMatchObject({ collateral: true, clean: false, lgTransfer: false });
    expect(outcomeOf(assay([0, -21, 0]), { tau: TAU })).toMatchObject({ improvesAny: false, collateral: false, clean: false });
    const seeds = ASSAY.seeds.length;
    expect(outcomeOf(assay([0, 0, 0], [ASSAY.viableFloor * seeds, 3000, 3000]), { tau: TAU }).viable).toBe(true);
    expect(outcomeOf(assay([0, 0, 0], [ASSAY.viableFloor * seeds - 1, 3000, 3000]), { tau: TAU }).viable).toBe(false);
  });

  it("qualify applies the floor and the margin at their boundaries", () => {
    const { lightGrowthFloor: F, lightOverDarkMargin: M } = ASSAY.gate;
    const b = (lg: number, dp: number) => ({ lg: [lg, lg + 100], dp: [dp, dp + 100], dt: [0, 0] });
    expect(qualify(b(F, F - M)).pass).toBe(true);
    expect(qualify(b(F - 1, 0)).pass).toBe(false);
    expect(qualify(b(F, F - M + 1)).pass).toBe(false);
    expect(qualify(b(F, F - M + 1)).minLightOverDark).toBe(M - 1);
    // the worst seed decides, not the mean
    expect(qualify({ lg: [F + 500, F - 1], dp: [0, 0], dt: [0, 0] }).pass).toBe(false);
    expect(qualify(b(F - 1, F + 5)).reasons.length).toBe(2);
    // the worst margin decides too: the average gap here is above the margin, the minimum is one short
    expect(qualify({ lg: [1500, 1500], dp: [1251, 1000], dt: [0, 0] })).toMatchObject({ pass: false, minLightOverDark: M - 1 });
  });

  it("tally separates unchanged, clamped and genuine edits and only counts assayed genuine ones", () => {
    const rows = [
      row({ cls: "unchanged", assay: assay([99, 0, 0]), assayed: true }),
      row({ cls: "boundary-clamped", assay: assay([99, 0, 0]), assayed: true }),
      rec({ expression: "probe-silent", undoExact: false }, assay([11, 0, 0])),
      rec({ expression: "controller" }, assay([11, -21, 0])),
      rec({ expression: "physics" }, assay([0, 0, 0])),
      rec({ expression: "controller" }, null),
    ];
    const t = tally(rows, { tau: TAU });
    expect(t).toMatchObject({ edits: 6, unchanged: 1, boundaryClamped: 1, genuine: 4, probeSilent: 1, controller: 2, physics: 1, undoExactOfGenuine: 3, assayedGenuine: 3, improving: 2, collateral: 1, clean: 1, lgImproving: 2, viable: 3 });
  });

  it("ipwPermille weights each stratum by population over chosen, and a dropped stratum changes it", () => {
    const strata = { "single24/w1": { population: 10, chosen: 2 }, "single24/b1": { population: 20, chosen: 4 } };
    const hit = assay([11, 0, 0]), miss = assay([0, 0, 0]);
    const rows = [
      rec({ kind: "w1" }, hit), rec({ kind: "w1" }, miss),
      rec({ kind: "b1" }, hit), rec({ kind: "b1" }, miss), rec({ kind: "b1" }, miss), rec({ kind: "b1" }, miss),
    ];
    const imp = (r: Row) => outcomeOf(r.assay!, { tau: TAU }).improvesAny;
    // 10 * 1/2 + 20 * 1/4 = 10 improving of 30 genuine: 333 permille
    expect(ipwPermille(rows, strata, imp)).toBe(333);
    expect(ipwPermille(rows, strata, () => true)).toBe(1000);
    expect(ipwPermille(rows, { "single24/w1": strata["single24/w1"] }, imp)).toBe(500);
    expect(ipwPermille(rows, {}, imp)).toBeNull();
    // unequal weights separate weighting from plain averaging: populations 10 and 30, one selected each, only the first improving
    const uneven = { "single24/w1": { population: 10, chosen: 1 }, "single24/b1": { population: 30, chosen: 1 } };
    expect(ipwPermille([rec({ kind: "w1" }, hit), rec({ kind: "b1" }, miss)], uneven, imp)).toBe(250);
    // clamped or unassayed rows never enter
    expect(ipwPermille([...rows, rec({ kind: "w1", cls: "boundary-clamped" }, hit)], strata, imp)).toBe(333);
  });

  it("readoutFor uses only its own genome's rows and reports the weighted estimate", () => {
    const g = { id: "g", tau: TAU } as unknown as GenomeRecord;
    const rows = [rec({ kind: "w1" }, assay([11, 0, 0])), rec({ kind: "w1" }, assay([0, 0, 0])), rec({ genome: "other", kind: "w1" }, assay([11, 0, 0]))];
    const out = readoutFor(g, rows, { "single24/w1": { population: 4, chosen: 2 } }, 6);
    expect(out.overall).toMatchObject({ edits: 2, assayedGenuine: 2, improving: 1 });
    expect(out.ipw.improvingPermille).toBe(500);
    expect(out.nullMedian2).toBe(6);
  });

  it("the assay draw never includes duplicates, unchanged or clamped edits", () => {
    for (const w of [gen, m3Start(4, "m3-sparse").words]) {
      const nb = buildNeighbourhood(w, "dup-test");
      const { chosen, strata } = drawAssaySubset(nb, ALLOC_M3);
      for (const i of chosen) { expect(nb.edits[i].cls).toBe("genuine"); expect(nb.edits[i].dupOf).toBeNull(); }
      const pops: Record<string, number> = {};
      for (const e of nb.edits) if (e.cls === "genuine" && e.dupOf === null) pops[strataKey(e)] = (pops[strataKey(e)] ?? 0) + 1;
      for (const [k, v] of Object.entries(strata)) { expect(v.population).toBe(pops[k] ?? 0); expect(v.chosen).toBeLessThanOrEqual(v.population); }
    }
    // a hand-made duplicate is recorded against its first occurrence
    const nb = buildNeighbourhood(gen, "dup-test");
    const seen = new Map<string, string>([[nb.baseHash, "baseline"]]);
    for (const e of nb.edits) { if (seen.has(e.hash)) expect(e.dupOf).toBe(seen.get(e.hash)); else { seen.set(e.hash, e.id); expect(e.dupOf).toBeNull(); } }
    expect(nb.edits.some((e) => e.dupOf !== null)).toBe(true);
  });
});
