// The transition hunt's conditions (docs/scaffold-transition-hunt-v1.md, "The current: arms nat and shuf"):
// pond-nat and pond-shuf set the arm and the current's two keys on the ponds preset, need a pond cycle, and
// leave room for the hunt's overrides (e = 1 fallback, mutation off) to win.
import { describe, expect, it } from "vitest";
import { PRESETS, presetConfig, validateConfig } from "@bl/schema";
import { conditionById, specConfig, type RunSpec } from "@bl/runner";

const preset = (id: string) => PRESETS.find((p) => p.id === id)!;
const spec = (condition: string, overrides?: RunSpec["overrides"], presetId = "ponds"): RunSpec => ({
  experiment: "hunt",
  presetId,
  condition,
  seed: 4_900_001,
  steps: 0,
  censusEvery: 1000,
  deepEvery: 10,
  checkpointEvery: 0,
  ...(overrides ? { overrides } : {}),
});

describe("pond-nat and pond-shuf", () => {
  it("set the arm, pondDeath 32,768 and pondExport 28 on the ponds preset", () => {
    const base = presetConfig(preset("ponds"), 1);
    expect(conditionById("pond-nat").apply(base)).toEqual({ pondArm: "nat", pondDeath: 32_768, pondExport: 28 });
    expect(conditionById("pond-shuf").apply(base)).toEqual({ pondArm: "shuf", pondDeath: 32_768, pondExport: 28 });
    for (const condition of ["pond-nat", "pond-shuf"]) {
      const cfg = specConfig(spec(condition));
      expect(validateConfig(cfg)).toEqual([]);
      expect([cfg.pondPeriod, cfg.pondK, cfg.pondDeath, cfg.pondExport]).toEqual([10_000, 8, 32_768, 28]);
    }
    expect(specConfig(spec("pond-nat")).pondArm).toBe("nat");
    expect(specConfig(spec("pond-shuf")).pondArm).toBe("shuf");
  });

  it("throw on a preset without the pond cycle", () => {
    for (const id of ["pond-nat", "pond-shuf"]) {
      expect(() => conditionById(id).apply(presetConfig(preset("spots"), 1))).toThrow(/needs a preset with the pond cycle/);
      expect(() => specConfig(spec(id, undefined, "spots"))).toThrow(/needs a preset with the pond cycle/);
    }
  });

  it("let RunSpec.overrides win: the e = 1 fallback and mutation off", () => {
    const fallback = specConfig(spec("pond-nat", { pondDeath: 65_536 }));
    expect(validateConfig(fallback)).toEqual([]);
    expect([fallback.pondArm, fallback.pondDeath, fallback.pondExport]).toEqual(["nat", 65_536, 28]);
    const quiet = specConfig(spec("pond-shuf", { mutRate: 0, pondDeath: 65_536 }));
    expect(validateConfig(quiet)).toEqual([]);
    expect([quiet.pondArm, quiet.pondDeath, quiet.mutRate]).toEqual(["shuf", 65_536, 0]);
    expect(specConfig(spec("pond-nat", { mutRate: 0 })).pondDeath).toBe(32_768);
  });

  it("leave every other config exactly the preset's, and the other conditions without the new keys", () => {
    const base = presetConfig(preset("ponds"), 4_900_001);
    for (const condition of ["pond-nat", "pond-shuf"]) {
      const { pondArm: _a, pondDeath: _d, pondExport: _e, ...rest } = specConfig(spec(condition));
      const { pondArm: _b, ...baseRest } = base;
      expect(rest).toEqual(baseRest);
    }
    for (const condition of ["treatment", "pond-rand", "pond-cont"]) {
      const cfg = specConfig(spec(condition));
      expect("pondDeath" in cfg).toBe(false);
      expect("pondExport" in cfg).toBe(false);
    }
  });
});
