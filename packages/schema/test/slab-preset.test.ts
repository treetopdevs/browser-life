import { describe, expect, it } from "vitest";
import { PRESETS, SLAB_PRESETS, defaultConfig, generalistGenome3, initWorld, presetById, presetConfig, presetIdentity, slabSpotsWorld, stateHash, validateConfig } from "@bl/schema";

const slab = SLAB_PRESETS.find((p) => p.id === "slab-spots")!;

describe("slab-spots preset", () => {
  it("is not in the lab's catalogue, but presetById finds it and the 2D presets", () => {
    expect(PRESETS.some((p) => p.id === "slab-spots")).toBe(false);
    expect(presetById("slab-spots")).toBe(slab);
    expect(presetById("spots")?.id).toBe("spots");
    expect(presetById("nope")).toBeUndefined();
  });

  it("reproduces the M3 timing gate's config and world exactly", () => {
    const m3 = defaultConfig({
      tileW: 256, tileH: 256, tileD: 8, lightK: 1024, kernelRadius: 3, seed: 101,
      defaultMu: 60, defaultSigma: 20, lightMode: "uniform", lightBase: 40, lightAmp: 200,
    });
    const cfg = presetConfig(slab, 101);
    expect(cfg).toEqual(m3);
    expect(validateConfig(cfg)).toEqual([]);
    expect(stateHash(initWorld(cfg, slab.init))).toBe(stateHash(slabSpotsWorld(m3, generalistGenome3(60, 20), 8, 32, 64)));
  });

  it("founds from the preset's own mu and sigma, so an override changes the world", () => {
    const a = presetConfig(slab, 5, { defaultMu: 70, defaultSigma: 25 });
    const b = presetConfig(slab, 5);
    expect(stateHash(initWorld(a, slab.init))).not.toBe(stateHash(initWorld(b, slab.init)));
    expect(stateHash(initWorld(a, slab.init))).toBe(stateHash(slabSpotsWorld(a, generalistGenome3(70, 25), 8, 32, 64)));
  });

  it("has a stable identity, different from every catalogue preset", () => {
    expect(presetIdentity(slab)).toBe(presetIdentity(slab));
    expect(presetIdentity(slab)).toMatch(/^[0-9a-f]{16}$/);
    for (const p of PRESETS) expect(presetIdentity(p)).not.toBe(presetIdentity(slab));
  });
});
