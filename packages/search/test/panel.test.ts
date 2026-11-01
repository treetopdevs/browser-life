// Behaviour atlas slice 2 (docs/behaviour-atlas-2026-11-01/PLAN-2.md): the held-out panel is
// separated from every arm, its assays are valid worlds, seeds never collide across arms or splits,
// coverage is scored at a matched size, and the chunked evaluators route genomes and seeds exactly.
import { describe, expect, it } from "vitest";
import { NN_BYTES, defaultConfig, validateConfig, type Genome } from "@bl/schema";
import {
  ARM_INDEX,
  DEFAULT_EVAL,
  HELD_OUT_BASE,
  PANEL_ASSAYS,
  PANEL_V1,
  SCREEN_ASSAY,
  assertSeparated,
  atlasGenomeKey,
  checkSchedule,
  compareArms,
  heldOutEvaluations,
  heldOutSeed,
  matchedCoverage,
  panelAssays,
  perBatch,
  screenEvaluator,
  screenSeed,
  subsample,
  summarizeCoverage,
  type ArmHistory,
  type ArmName,
  type BatchFn,
  type Evaluation,
} from "@bl/search";

const genome = (fill: number, mu = 60): Genome => ({ mu, sigma: 20, motGain: 0, weights: new Int8Array(NN_BYTES).fill(fill) });
const ev = (over: Partial<Evaluation> = {}): Evaluation => ({
  survived: 4, recovered: 0, lightDependent: 0, reps: 4, individuals: 1, meanMass: 256, speed: 0, mass: 256, recovery: 0, regenerated: 0, reproduction: 0, ...over,
});

describe("panel v1", () => {
  it("reads nothing any arm selects on", () => {
    expect(() => assertSeparated(PANEL_V1, ["random-viable", "mass-speed", "physical", "embedding"])).not.toThrow();
    expect(panelAssays(PANEL_V1)).toEqual(["lean-medium", "sweep-light"]);
    // Reproduction is left out: tracker births include fast motion (see panel.ts).
    expect(PANEL_V1.flatMap((t) => t.reads).some((r) => r.endsWith(":reproduction"))).toBe(false);
  });

  it("runs every assay on a valid world that differs from the screen only where declared", () => {
    for (const [id, make] of Object.entries(PANEL_ASSAYS)) {
      const ec = make(HELD_OUT_BASE + 1);
      const cfg = defaultConfig({ ...ec.world, tileW: ec.tile, tileH: ec.tile, tilesX: ec.side, tilesY: ec.side, seed: ec.seed, mutRate: 0 });
      expect(validateConfig(cfg), id).toEqual([]);
      expect({ ...ec, world: undefined, nutrient: undefined, seed: undefined }).toEqual({ ...DEFAULT_EVAL, world: undefined, nutrient: undefined, seed: undefined });
    }
    expect(PANEL_ASSAYS["lean-medium"](5).nutrient).toBe(DEFAULT_EVAL.nutrient / 2);
    expect(PANEL_ASSAYS["sweep-light"](5).world).toMatchObject({ lightMode: "sweep", dayPeriod: 1024 });
    expect(PANEL_ASSAYS[SCREEN_ASSAY](5)).toEqual({ ...DEFAULT_EVAL, seed: 5 });
  });

  it("passes and fails on the thresholds it states", () => {
    const [sweep, lean] = PANEL_V1;
    expect(sweep.passes({ "sweep-light": ev() })).toBe(true);
    expect(sweep.passes({ "sweep-light": ev({ survived: 3 }) })).toBe(false);
    expect(lean.passes({ "lean-medium": ev({ survived: 0, reps: 0 }) })).toBe(false);
  });
});

describe("seeds", () => {
  it("never repeat across histories, arms, batches, chunks or splits", () => {
    const seen = new Set<number>();
    const arms = Object.keys(ARM_INDEX) as (ArmName | "pool")[];
    for (const h of [1, 2, 8999]) for (const a of arms) for (const b of [0, 1, 199]) for (const c of [0, 99]) seen.add(screenSeed(h, a, b, c));
    expect(seen.size).toBe(3 * arms.length * 3 * 2);
    for (const s of seen) expect(s).toBeLessThan(HELD_OUT_BASE);
    const held = new Set<number>();
    for (const h of [1, 2, 8999]) for (const a of [0, 9]) for (const c of [0, 9999]) held.add(heldOutSeed(h, a, c));
    expect(held.size).toBe(12);
    for (const s of held) expect(s).toBeGreaterThanOrEqual(HELD_OUT_BASE);
    expect(Math.max(...held)).toBeLessThan(2 ** 32);
    expect(() => screenSeed(1, "physical", 200, 0)).toThrow(/batch 200/);
    expect(() => screenSeed(0, "physical", 0, 0)).toThrow(/history 0/);
    expect(() => heldOutSeed(1, 10, 0)).toThrow(/assay index 10/);
  });

  it("refuses a schedule that would leave the seed scheme before any evaluation", () => {
    const pool = Array.from({ length: 12 }, () => 0);
    expect(() => checkSchedule({ pool, budget: 64, batchSize: 16, arms: ["a", "b", "c"] })).not.toThrow();
    expect(() => checkSchedule({ pool, budget: 12 + 199 * 16, batchSize: 16, arms: ["a"] })).not.toThrow();
    expect(() => checkSchedule({ pool, budget: 12 + 199 * 16 + 1, batchSize: 16, arms: ["a"] })).toThrow(/200 search batches/);
    expect(() => checkSchedule({ pool, budget: 2000, batchSize: 1601, arms: ["a"] })).toThrow(/more than 100 evaluateBatch chunks/);
    expect(() => perBatch({ ...DEFAULT_EVAL, side: 1, reps: 4 })).toThrow(/holds no genome/);
  });
});

describe("matched coverage", () => {
  const hist = (arm: ArmName, history: number, fills: number[]): ArmHistory => {
    const genomes = Object.fromEntries(fills.map((f) => [atlasGenomeKey(genome(f)), genome(f)]));
    return { arm, history, status: "ran", evaluations: 10, selection: Object.keys(genomes).sort(), genomes };
  };
  // Fill f passes sweep when f is even, lean when f % 3 == 0.
  const one = new Map(
    Array.from({ length: 20 }, (_, f) => [atlasGenomeKey(genome(f)), { "sweep-light": ev({ survived: f % 2 ? 0 : 4 }), "lean-medium": ev({ survived: f % 3 ? 1 : 4 }) }]),
  );
  const heldOut = new Map([[1, one]]);

  it("scores every arm at the smallest selection in its history, deterministically", () => {
    const hs = [hist("random-viable", 1, [1, 3, 5, 7, 9, 11, 13, 15]), hist("physical", 1, [0, 3, 10]), hist("mass-speed", 1, [1, 5]), { ...hist("embedding", 1, []), status: "unimplemented" as const }];
    const rows = matchedCoverage(hs, heldOut, PANEL_V1, 7);
    expect(rows.map((r) => [r.arm, r.size, r.k])).toEqual([["random-viable", 8, 2], ["physical", 3, 2], ["mass-speed", 2, 2]]);
    const ms = rows.find((r) => r.arm === "mass-speed")!;
    expect(ms.covered).toBe(0);
    expect(ms.fullRate).toEqual({ "sweep-survival": 0, "lean-survival": 0 });
    const ph = rows.find((r) => r.arm === "physical")!;
    expect(ph.fullRate["sweep-survival"]).toBeCloseTo(2 / 3, 12);
    expect(matchedCoverage(hs, heldOut, PANEL_V1, 7)).toEqual(rows);
    const s = summarizeCoverage(rows, "physical", "mass-speed");
    expect(s.paired.histories).toBe(1);
    expect(s.paired.meanDiff).toBe(ph.covered);
  });

  it("scores each history on its own held-out evaluations, whatever order histories ran in", () => {
    // Genome 0 is selected in both histories; it passes sweep on history 1's seeds and not on history 2's.
    const k0 = atlasGenomeKey(genome(0));
    const h2 = new Map([[k0, { "sweep-light": ev({ survived: 0 }), "lean-medium": ev({ survived: 0 }) }]]);
    const hs = [hist("physical", 1, [0]), hist("mass-speed", 1, [1]), hist("physical", 2, [0]), hist("mass-speed", 2, [1])];
    const both = new Map([[1, one], [2, new Map([...h2, [atlasGenomeKey(genome(1)), one.get(atlasGenomeKey(genome(1)))!]])]]);
    const rows = matchedCoverage(hs, both, PANEL_V1, 3);
    expect(rows.filter((r) => r.arm === "physical").map((r) => r.covered)).toEqual([2, 0]);
    expect(matchedCoverage([...hs].reverse(), both, PANEL_V1, 3).filter((r) => r.arm === "physical").map((r) => [r.history, r.covered])).toEqual([[1, 2], [2, 0]]);
    expect(() => matchedCoverage(hs, new Map([[1, one]]), PANEL_V1, 3)).toThrow(/history 2 has no held-out/);
  });

  it("summarises unconditionally: a history with an empty selection counts as zero", () => {
    const hs = [hist("physical", 1, [0]), hist("mass-speed", 1, [1]), hist("physical", 2, []), hist("mass-speed", 2, [1])];
    const rows = matchedCoverage(hs, new Map([[1, one], [2, one]]), PANEL_V1, 3);
    const s = summarizeCoverage(rows, "physical", "mass-speed");
    expect(s.paired).toEqual({ histories: 2, emptyHistories: 1, meanDiff: 1, diffs: [2, 0] });
    expect(s.mean.physical).toBe(1);
  });

  it("refuses a selection with untested members, and a panel that overlaps a compared arm", () => {
    expect(() => matchedCoverage([hist("physical", 1, [0, 30])], heldOut, PANEL_V1, 1)).toThrow(/no held-out evaluation/);
    const leaky = [{ ...PANEL_V1[0], id: "leak", reads: [`${SCREEN_ASSAY}:regenerated`] }];
    expect(() => matchedCoverage([hist("mass-speed", 1, [0])], heldOut, leaky, 1)).toThrow(/selects on/);
  });

  it("subsamples without replacement, independent of input order", () => {
    const keys = ["a", "b", "c", "d", "e", "f"];
    const s = subsample(keys, 4, 99);
    expect(new Set(s).size).toBe(4);
    expect(subsample([...keys].reverse(), 4, 99)).toEqual(s);
    expect(subsample(keys, 10, 99).sort()).toEqual(keys);
  });
});

describe("chunked evaluators", () => {
  /** A fake evaluateBatch that records its calls and returns survival from the genome's first weight. */
  // It emits no growth censuses, so descriptors stay undefined (the atlas then inserts nothing).
  const fakeBatch = (calls: { seed: number; n: number; nutrient: number; lightMode: string | undefined }[]): BatchFn => async (gs, ec) => {
    calls.push({ seed: ec.seed, n: gs.length, nutrient: ec.nutrient, lightMode: ec.world.lightMode });
    if (gs.length > perBatch(ec)) throw new Error("too many genomes for one batch");
    return gs.map((g) => ev({ survived: g.weights[0] & 3, reproduction: g.weights[0] & 1 }));
  };

  it("splits screening requests into evaluateBatch-sized chunks on their own seeds", async () => {
    const calls: Parameters<typeof fakeBatch>[0] = [];
    const evaluate = screenEvaluator(fakeBatch(calls));
    const res = await evaluate(Array.from({ length: 40 }, (_, i) => genome(i)), { history: 3, arm: "physical", batch: 5 });
    expect(res).toHaveLength(40);
    expect(calls.map((c) => [c.seed, c.n])).toEqual([[screenSeed(3, "physical", 5, 0), 16], [screenSeed(3, "physical", 5, 1), 16], [screenSeed(3, "physical", 5, 2), 8]]);
    expect(res[5].eval.survived).toBe(1);
    expect(res[5].descriptors).toBeUndefined();
  });

  it("evaluates each selected genome once per assay, on held-out seeds, shared across arms", async () => {
    const calls: Parameters<typeof fakeBatch>[0] = [];
    const g = (f: number) => genome(f);
    const mk = (arm: ArmName, fills: number[]): ArmHistory => ({ arm, history: 2, status: "ran", evaluations: 1, selection: fills.map((f) => atlasGenomeKey(g(f))).sort(), genomes: Object.fromEntries(fills.map((f) => [atlasGenomeKey(g(f)), g(f)])) });
    const out = await heldOutEvaluations(fakeBatch(calls), 2, [mk("physical", [1, 2, 3]), mk("mass-speed", [3, 4]), { ...mk("random-viable", [9]), history: 1 }], PANEL_V1);
    expect([...out.keys()].sort()).toEqual([1, 2, 3, 4].map((f) => atlasGenomeKey(g(f))).sort());
    expect(calls.map((c) => [c.seed, c.n])).toEqual([[heldOutSeed(2, 0, 0), 4], [heldOutSeed(2, 1, 0), 4]]);
    expect(calls.map((c) => c.nutrient)).toEqual([16, 32]);
    expect(calls[1].lightMode).toBe("sweep");
    expect(Object.keys(out.get(atlasGenomeKey(g(3)))!).sort()).toEqual(panelAssays(PANEL_V1));
  });

  it("drive a whole comparison end to end without a GPU", async () => {
    const calls: Parameters<typeof fakeBatch>[0] = [];
    const evaluate = screenEvaluator(fakeBatch(calls));
    const hs = await compareArms({ arms: ["random-viable", "mass-speed", "physical"], histories: [1], pool: [genome(1), genome(2, 61)], budget: 20, batchSize: 8, randomFraction: 0.25 }, evaluate);
    // Without descriptors the physical arm inserts nothing; the readout must then report k = 0, not fail.
    expect(hs.find((h) => h.arm === "physical")!.selection).toEqual([]);
    const held = await heldOutEvaluations(fakeBatch([]), 1, hs, PANEL_V1);
    const rows = matchedCoverage(hs, new Map([[1, held]]), PANEL_V1, 1);
    expect(rows.every((r) => r.k === 0 && r.covered === 0)).toBe(true);
    expect(summarizeCoverage(rows, "physical", "mass-speed").paired).toMatchObject({ histories: 1, emptyHistories: 1, meanDiff: 0 });
  });
});
