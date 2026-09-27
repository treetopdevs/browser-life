import { describe, expect, it } from "vitest";
import { lightAt, realizedLightMean, type LightCfg } from "../lib/light.ts";

// P=4, seasonAmp=200, lightBase=10, lightAmp=0, uniform mode: the triangle's
// integer phase steps (ph = 128 * (t % 4)) land exactly on 0/128/256/384, so
// every value below is computed by hand, not just re-derived from the code
// under test.
const cfg: LightCfg = { lightMode: "uniform", lightBase: 10, lightAmp: 0, seasonPeriod: 4, seasonAmp: 200 };

describe("lightAt", () => {
  it("matches a hand-computed triangle wave exactly", () => {
    expect(lightAt(cfg, 0)).toBe(210); // ph=0,   tri=256, 200*256>>8=200
    expect(lightAt(cfg, 1)).toBe(110); // ph=128, tri=128, 200*128>>8=100
    expect(lightAt(cfg, 2)).toBe(10); // ph=256, tri=0
    expect(lightAt(cfg, 3)).toBe(110); // ph=384, tri=128, same as step 1
    expect(lightAt(cfg, 4)).toBe(210); // wraps: step 4 === step 0 mod period
  });

  it("adds lightAmp under uniform mode and clamps to 0..255", () => {
    const bright: LightCfg = { lightMode: "uniform", lightBase: 40, lightAmp: 160, seasonPeriod: 0, seasonAmp: 0 };
    expect(lightAt(bright, 0)).toBe(200);
    const saturating: LightCfg = { lightMode: "uniform", lightBase: 250, lightAmp: 50, seasonPeriod: 0, seasonAmp: 0 };
    expect(lightAt(saturating, 0)).toBe(255);
  });

  it("seasonPeriod: 0 disables the cycle entirely (constant light)", () => {
    const flat: LightCfg = { lightMode: "uniform", lightBase: 30, lightAmp: 0, seasonPeriod: 0, seasonAmp: 200 };
    expect(lightAt(flat, 0)).toBe(30);
    expect(lightAt(flat, 999)).toBe(30);
  });
});

describe("realizedLightMean", () => {
  it("equals the hand-computed mean over exactly one period", () => {
    // (210 + 110 + 10 + 110) / 4 = 110
    expect(realizedLightMean(cfg, 0, 4)).toBe(110);
  });

  it("is invariant to which period-aligned step it starts from", () => {
    expect(realizedLightMean(cfg, 4, 4)).toBe(110);
    expect(realizedLightMean(cfg, 400, 4)).toBe(110);
  });

  it("returns 0 for a non-positive step count", () => {
    expect(realizedLightMean(cfg, 0, 0)).toBe(0);
  });

  it("over a non-period-aligned window, matches a direct sum of lightAt", () => {
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += lightAt(cfg, 5 + i);
    expect(realizedLightMean(cfg, 5, 7)).toBe(sum / 7);
  });
});
