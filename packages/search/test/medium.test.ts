import { describe, expect, it } from "vitest";
import { CELL_CHANNELS, CH, G, M3_FOUNDERS, cellCount, defaultConfig, founderGenome, packLineageLo, worldW } from "@bl/schema";
import { BACKGROUND_ENCODING, DEFAULT_EVAL, checkConfirmResumable, lineageMass, quality, qualityMaintenance, reviveEvalConfig, type EvalConfig, type Evaluation } from "@bl/search";

const ev = (partial: Partial<Evaluation>): Evaluation => ({
  survived: 4,
  recovered: 4,
  lightDependent: 4,
  reps: 4,
  individuals: 1,
  meanMass: 256,
  speed: 1,
  mass: 256,
  recovery: 1,
  regenerated: 4,
  reproduction: 0,
  ...partial,
});

describe("qualityMaintenance", () => {
  it("is zero when nothing survived", () => {
    expect(qualityMaintenance(ev({ survived: 0, recovery: 0, recovered: 0, lightDependent: 0, regenerated: 0 }))).toBe(0);
  });

  it("weights recovery and light dependence, ignoring regeneration", () => {
    const base = ev({ survived: 4, recovered: 2, recovery: 0.5, lightDependent: 4, regenerated: 0 });
    // survived/reps=1, (0.5*0.5 + 0.5*0.5)=0.5, (0.5+0.5*1)=1 → 0.5
    expect(qualityMaintenance(base)).toBeCloseTo(0.5);
    const withRegen = ev({ ...base, regenerated: 4 });
    expect(qualityMaintenance(withRegen)).toBe(qualityMaintenance(base));
    expect(quality(withRegen)).toBeGreaterThan(quality(base));
  });
});

describe("lineageMass", () => {
  it("sums B+P only for cells of the given founder raw id", () => {
    const cfg = defaultConfig({ tileW: 8, tileH: 8, tilesX: 2, tilesY: 1 });
    const n = cellCount(cfg);
    const W = worldW(cfg);
    const cells = new Uint32Array(n * CELL_CHANNELS);
    const genomeHead = new Uint32Array(n * 4);
    // Tile 0 cell (2,2): lineage rawId 1, mass 10+5
    const i0 = 2 * W + 2;
    cells[CH.B * n + i0] = 10;
    cells[CH.P * n + i0] = 5;
    genomeHead[G.LIN_LO * n + i0] = packLineageLo(cfg, 1);
    // Tile 1 cell: lineage rawId 2, mass 7
    const i1 = 2 * W + 10;
    cells[CH.B * n + i1] = 7;
    genomeHead[G.LIN_LO * n + i1] = packLineageLo(cfg, 2);
    // Same tile 0, different lineage: ignored for rawId 1
    const i2 = 3 * W + 3;
    cells[CH.B * n + i2] = 100;
    genomeHead[G.LIN_LO * n + i2] = packLineageLo(cfg, 9);

    const m1 = lineageMass(cfg, cells, genomeHead, 1);
    expect(m1[0]).toBe(15);
    expect(m1[1]).toBe(0);
    const m2 = lineageMass(cfg, cells, genomeHead, 2);
    expect(m2[0]).toBe(0);
    expect(m2[1]).toBe(7);
  });
});

describe("DEFAULT_EVAL", () => {
  it("has no medium key so existing evaluations stay byte-identical", () => {
    expect("medium" in DEFAULT_EVAL).toBe(false);
    expect(JSON.stringify(DEFAULT_EVAL)).not.toMatch(/medium/);
  });
});

describe("reviveEvalConfig", () => {
  it("rebuilds a background genome that went through JSON as an Int8Array with the same values", () => {
    const g = founderGenome(M3_FOUNDERS[0]);
    const ec: EvalConfig = { ...DEFAULT_EVAL, medium: { background: g }, darkSteps: 4000 };
    const back = reviveEvalConfig(JSON.parse(JSON.stringify(ec)));
    expect(back.medium!.background!.weights).toBeInstanceOf(Int8Array);
    expect(Array.from(back.medium!.background!.weights)).toEqual(Array.from(g.weights));
    expect(JSON.stringify(back)).toBe(JSON.stringify(ec));
  });
  it("returns a config without a background unchanged", () => {
    const ec = JSON.parse(JSON.stringify({ ...DEFAULT_EVAL, nutrient: 8, medium: { waste: 24 } }));
    expect(reviveEvalConfig(ec)).toEqual(ec);
  });
  it("throws on a missing weight", () => {
    const ec = JSON.parse(JSON.stringify({ ...DEFAULT_EVAL, medium: { background: founderGenome(M3_FOUNDERS[0]) } }));
    delete ec.medium.background.weights["3"];
    expect(() => reviveEvalConfig(ec)).toThrow(/weight 3/);
  });
});

describe("checkConfirmResumable", () => {
  const withBg = (): EvalConfig => ({ ...DEFAULT_EVAL, medium: { background: founderGenome(M3_FOUNDERS[0]) }, darkSteps: 4000 });
  it("allows a fresh start and confirmations without a background genome", () => {
    expect(() => checkConfirmResumable(undefined, "confirm.json")).not.toThrow();
    expect(() => checkConfirmResumable({ eval: DEFAULT_EVAL }, "confirm.json")).not.toThrow();
    expect(() => checkConfirmResumable({ eval: { ...DEFAULT_EVAL, nutrient: 8, medium: { waste: 24 } } }, "confirm.json")).not.toThrow();
  });
  it("refuses to extend a background confirmation from before the by-index encoding", () => {
    const legacy = JSON.parse(JSON.stringify({ eval: withBg() }));
    expect(() => checkConfirmResumable(legacy, "runs/x/confirm.json")).toThrow(/runs\/x\/confirm\.json was confirmed before background genomes were encoded by index/);
  });
  it("allows a background confirmation that carries the marker", () => {
    const marked = JSON.parse(JSON.stringify({ eval: withBg(), backgroundEncoding: BACKGROUND_ENCODING }));
    expect(() => checkConfirmResumable(marked, "confirm.json")).not.toThrow();
  });
});
