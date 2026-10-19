import { describe, expect, it } from "vitest";
import { PRESETS, SUN_PERCENTS, defaultConfig, sameLight, sunConfig, sunError, sunLight, validateConfig, worldLight, type WorldConfig } from "@bl/schema";

const preset = (id: string): WorldConfig => defaultConfig(PRESETS.find((p) => p.id === id)!.cfg);
const storm = preset("wild-storm-large");

describe("the sun's light (sun.ts)", () => {
  it("sunConfig floors base, amp and season and leaves every other key", () => {
    expect([storm.lightBase, storm.lightAmp, storm.seasonAmp]).toEqual([20, 170, 60]);
    const before = JSON.stringify(storm);
    const s75 = sunConfig(storm, 75);
    expect(worldLight(s75)).toEqual({ lightBase: 15, lightAmp: 127, seasonAmp: 45 });
    expect(sunLight(storm, 150)).toEqual({ lightBase: 30, lightAmp: 255, seasonAmp: 90 });
    expect(sunLight(storm, 50)).toEqual({ lightBase: 10, lightAmp: 85, seasonAmp: 30 });
    expect(JSON.stringify(storm)).toBe(before);
    const { lightBase: _a, lightAmp: _b, seasonAmp: _c, ...rest } = s75;
    const { lightBase: _d, lightAmp: _e, seasonAmp: _f, ...own } = storm;
    expect(rest).toEqual(own);
    for (const p of PRESETS) {
      const cfg = defaultConfig(p.cfg);
      for (const pct of SUN_PERCENTS) if (sunError(cfg, pct) === null) expect(validateConfig(sunConfig(cfg, pct))).toEqual([]);
    }
  });

  it("sunError refuses a percent outside the set and any scaled light a config cannot hold", () => {
    for (const bad of [0, 100, 99, 200, -50, 0.5, NaN]) expect(sunError(storm, bad)).toMatch(/one of 50, 75, 125, 150/);
    const gradient = preset("gradient");
    expect([gradient.lightBase, gradient.lightAmp]).toEqual([20, 220]);
    expect(sunError(gradient, 125)).toMatch(/lightAmp would be 275, above 255/);
    expect(sunError(gradient, 50)).toBeNull();
    // The storm's season makes any brightening exceed the sum rule (20 + 170 + 60 = 250).
    expect(sunError(storm, 125)).toMatch(/add up to 312, above 255/);
    expect(sunError(storm, 150)).toMatch(/lightAmp would be 255|above 255/);
    expect(sunError(storm, 50)).toBeNull();
    expect(sunError(storm, 75)).toBeNull();
    // Even light (40 + 160) takes a quarter more but not a half more.
    const spots = preset("spots");
    expect(sunError(spots, 125)).toBeNull();
    expect(sunError(spots, 150)).toMatch(/add up to 300/);
  });

  it("sameLight compares the three values, null only with null", () => {
    expect(sameLight(null, null)).toBe(true);
    expect(sameLight(sunLight(storm, 50), null)).toBe(false);
    expect(sameLight(sunLight(storm, 50), sunLight(storm, 50))).toBe(true);
    expect(sameLight(sunLight(storm, 50), sunLight(storm, 75))).toBe(false);
  });
});
