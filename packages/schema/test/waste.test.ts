import { describe, expect, it } from "vitest";
import { CH, buildWorld, cellCount, defaultConfig, generalistGenome, initWorld, PRESETS, presetConfig, presetIdentity, validateState } from "@bl/schema";

describe("InitSpec.waste", () => {
  it("fills channel C uniformly and leaves A as nutrient; absent waste leaves C at 0", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32 });
    const n = cellCount(cfg);
    const withWaste = buildWorld(cfg, { nutrient: 8, waste: 24, founders: [] });
    expect(validateState(withWaste)).toEqual([]);
    for (let i = 0; i < n; i++) {
      expect(withWaste.cells[CH.A * n + i]).toBe(8);
      expect(withWaste.cells[CH.C * n + i]).toBe(24);
    }
    const plain = buildWorld(cfg, { nutrient: 8, founders: [] });
    for (let i = 0; i < n; i++) expect(plain.cells[CH.C * n + i]).toBe(0);
  });

  it("rejects waste that pushes total matter past MATTER_MAX via validateState", () => {
    const cfg = defaultConfig({ tileW: 64, tileH: 64 });
    // 64² = 4096 cells; huge A+C overflows MATTER_MAX.
    expect(() => buildWorld(cfg, { nutrient: 1 << 20, waste: 1 << 20, founders: [] })).toThrow(/matter/);
  });

  it("gradient-m3-waste preset stocks C and keeps gradient-m3 identity pinned", () => {
    const waste = PRESETS.find((p) => p.id === "gradient-m3-waste")!;
    const base = PRESETS.find((p) => p.id === "gradient-m3")!;
    expect(waste).toBeDefined();
    expect(waste.init.waste).toBe(24);
    expect(waste.init.nutrient).toBe(8);
    expect(presetIdentity(base)).toBe("e1c93a9384b5d921");
    expect(presetIdentity(waste)).not.toBe(presetIdentity(base));
    const s = initWorld(presetConfig(waste, 1), waste.init);
    expect(validateState(s)).toEqual([]);
    const n = cellCount(s.cfg);
    expect(s.cells[CH.C * n]).toBe(24);
    expect(s.cells[CH.A * n]).toBe(8);
  });
});

describe("buildWorld without waste is unchanged for a founder disc", () => {
  it("still places biomass only on B and leaves C empty", () => {
    const cfg = defaultConfig({ tileW: 32, tileH: 32 });
    const n = cellCount(cfg);
    const s = buildWorld(cfg, {
      nutrient: 16,
      founders: [{ x: 16, y: 16, radius: 4, genome: generalistGenome(60, 20), biomass: 64, energy: 128 }],
    });
    expect(validateState(s)).toEqual([]);
    expect(s.cells.subarray(CH.C * n, (CH.C + 1) * n).every((v) => v === 0)).toBe(true);
    expect(s.cells.subarray(CH.B * n, (CH.B + 1) * n).some((v) => v > 0)).toBe(true);
  });
});
