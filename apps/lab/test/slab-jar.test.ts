// The slab viewer's jar settings against the jar levers screen they re-run (experiments/3d-slab/jar-levers-arms.ts).
import { describe, expect, it } from "vitest";
import { initWorld, stateHash, validateConfig } from "@bl/schema";
import { JAR_ARMS, jarArmConfig, jarArmInit } from "../../../experiments/3d-slab/jar-levers-arms.ts";
import { CANOPY_OPTIONS, ECO_OPTIONS, ECO_SIZES, JAR_OPTIONS, JAR_SIZES, ecoConfig, ecoInit, ecoOption, ecoRecordId, isCanopy, isJar, sizesFor } from "../src/slab/settings.ts";

describe("jar settings", () => {
  it("cover every arm of the screen once, and build exactly the screen's config and start for each seed", () => {
    expect(JAR_OPTIONS.map((o) => o.arm).sort()).toEqual(Object.keys(JAR_ARMS).sort());
    for (const o of JAR_OPTIONS) for (const seed of [101, 102]) {
      const choice = { size: [64, 64, 64] as const, option: o.id, seed };
      expect(ecoConfig(choice)).toEqual(jarArmConfig(o.arm, seed));
      expect(ecoInit(choice)).toEqual(jarArmInit(o.arm));
      expect(validateConfig(ecoConfig(choice))).toEqual([]);
      expect(ecoRecordId(choice)).toBeNull();
      expect([o.mu, o.sigma, o.lightK, o.nutrient]).toEqual([50, 8, 4096, 24]);
      expect(ecoOption(o.id)).toBe(o);
    }
  });

  it("the baseline arm is the jar light screen's 4096 / N 24 world, and the arms differ from it", () => {
    const base = ecoConfig({ size: [64, 64, 64], option: "jar-base", seed: 101 });
    expect([base.tileW, base.tileH, base.tileD, base.lightK, base.defaultMu, base.defaultSigma]).toEqual([64, 64, 64, 4096, 50, 8]);
    expect(ecoInit({ size: [64, 64, 64], option: "jar-base", seed: 101 }).nutrient).toBe(24);
    const h = (id: string) => stateHash(initWorld(ecoConfig({ size: [64, 64, 64], option: id, seed: 101 }), ecoInit({ size: [64, 64, 64], option: id, seed: 101 })));
    const hashes = JAR_OPTIONS.map((o) => h(o.id));
    expect(new Set(hashes).size).toBe(JAR_OPTIONS.length);
  });

  it("run only at the jar size, kept apart from the slab options", () => {
    for (const o of JAR_OPTIONS) {
      expect(isJar(o.id)).toBe(true);
      expect(isCanopy(o.id)).toBe(false);
      expect(sizesFor(o.id)).toBe(JAR_SIZES);
    }
    for (const o of [...ECO_OPTIONS, ...CANOPY_OPTIONS]) expect(sizesFor(o.id)).toBe(ECO_SIZES);
  });

  it("explain themselves in plain words, with no hype and no labels the slab e2e finds radios by", () => {
    for (const o of JAR_OPTIONS) {
      expect(o.text.length).toBeGreaterThan(150);
      expect(o.title).toMatch(/^Jar: /);
      expect(o.title + o.text).not.toMatch(/\b(amazing|stunning|revolutionary|breakthrough|incredible|magical)\b/i);
      expect(o.title + o.text).not.toMatch(/Combined|One layer|Slab ecology|Cyclic competition|Fastest|Removal kill|Kill on from step 0|Canopy over a dark floor/);
    }
  });
});
