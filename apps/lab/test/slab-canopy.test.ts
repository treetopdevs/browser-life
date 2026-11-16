// The slab viewer's canopy setting against the M4b calibration it re-runs (experiments/3d-slab/m4b-rule.ts and m4b-results.tsv).
import { describe, expect, it } from "vitest";
import { presetById } from "@bl/schema";
import { expectedConfig, expectedInit, jobId } from "../../../experiments/3d-slab/m4b-rule.ts";
import m4b from "../../../experiments/3d-slab/m4b-results.tsv?raw";
import { CANOPY_OPTIONS, DEFAULT_ECO, ECO_OPTIONS, ecoConfig, ecoInit, ecoOption, ecoRecordId, isCanopy } from "../src/slab/settings.ts";

describe("canopy setting", () => {
  const c = CANOPY_OPTIONS[0]!;
  it("is nutrient 12, mu 50, sigma 8, lightK 64, and its config and start equal what the M4b calibration ran, per seed", () => {
    expect([c.id, c.nutrient, c.mu, c.sigma, c.lightK]).toEqual(["n12-mu50-s8-k64", 12, 50, 8, 64]);
    for (const seed of [101, 102, 103]) {
      const job = { id: jobId("treatment", { nutrient: 12, mu: 50, sigma: 8, lightK: 64 }, seed), condition: "treatment" as const, seed, nutrient: 12, mu: 50, sigma: 8, lightK: 64 };
      const choice = { size: [256, 256, 8] as const, option: c.id, seed };
      expect(ecoConfig(choice)).toEqual(expectedConfig(job));
      expect(ecoInit(choice)).toEqual(expectedInit(job));
      expect(ecoRecordId(choice)).toBe(job.id);
      expect(m4b.split("\n").some((l) => l.startsWith(`${job.id}\t`)), job.id).toBe(true);
    }
  });

  it("is kept apart from the M4 options, leaves their start alone, and is not a recorded run at another size or seed", () => {
    expect(ECO_OPTIONS.some((o) => o.id === c.id)).toBe(false);
    expect(isCanopy(c.id)).toBe(true);
    expect(isCanopy(DEFAULT_ECO.option)).toBe(false);
    expect(ecoOption(c.id)).toBe(c);
    expect(ecoInit(DEFAULT_ECO)).toBe(presetById("slab-spots")!.init);
    expect(ecoRecordId({ size: [128, 128, 8], option: c.id, seed: 101 })).toBeNull();
    expect(ecoRecordId({ size: [256, 256, 8], option: c.id, seed: 7 })).toBeNull();
  });

  it("explains itself in plain words, says it is a re-run and not a recorded state, and names no hype", () => {
    expect(c.title).toMatch(/re-run/i);
    expect(c.text).toMatch(/re-runs the setting from step 0/);
    expect(c.text.length).toBeGreaterThan(200);
    expect(c.title + c.text).not.toMatch(/\b(amazing|stunning|revolutionary|breakthrough|incredible|magical)\b/i);
    // must not collide with the labels the slab e2e spec finds radios by
    expect(c.title + c.text).not.toMatch(/Combined|One layer|Slab ecology|Cyclic competition|Fastest|Removal kill|Kill on from step 0/);
  });
});
