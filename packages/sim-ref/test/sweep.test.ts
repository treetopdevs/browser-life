// lightMode "sweep" (sandbox): a tent of light centred on a meridian that
// crosses the tile along x once every dayPeriod steps.
import { describe, expect, it } from "vitest";
import { defaultConfig, generalistWorld, validateConfig } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";

const cfg = (extra = {}) => defaultConfig({ tileW: 64, tileH: 64, kernelRadius: 5, lightMode: "sweep", lightBase: 20, lightAmp: 200, ...extra });

describe("sweep light", () => {
  it("peaks at the sun's meridian and falls linearly to the antipode", () => {
    const sim = new RefSim(generalistWorld(cfg({ dayPeriod: 1000 }), 1));
    expect(sim.light(0, 5, 0)).toBe(220);
    expect(sim.light(16, 5, 0)).toBe(120);
    expect(sim.light(48, 5, 0)).toBe(120);
    expect(sim.light(32, 5, 0)).toBe(20);
  });

  it("moves the meridian across the tile once per dayPeriod", () => {
    const sim = new RefSim(generalistWorld(cfg({ dayPeriod: 1000 }), 1));
    expect(sim.light(32, 0, 500)).toBe(220);
    expect(sim.light(16, 0, 250)).toBe(220);
    expect(sim.light(0, 0, 1000)).toBe(220);
    // Every column's light over a day averages to about the gradient's mean.
    let sum = 0;
    for (let x = 0; x < 64; x++) sum += sim.light(x, 0, 123);
    expect(Math.abs(sum / 64 - 120)).toBeLessThan(2);
  });

  it("stands still without dayPeriod", () => {
    const sim = new RefSim(generalistWorld(cfg(), 1));
    expect(sim.light(0, 0, 0)).toBe(sim.light(0, 0, 777_777));
    expect(sim.light(0, 0, 0)).toBe(220);
  });

  it("validates dayPeriod and its u32 bound", () => {
    expect(validateConfig(cfg({ dayPeriod: 16_000 }))).toEqual([]);
    expect(validateConfig(cfg({ dayPeriod: -1 })).length).toBeGreaterThan(0);
    expect(validateConfig(defaultConfig({ tileW: 4096, tileH: 8, kernelRadius: 2, lightMode: "sweep", dayPeriod: 2_000_000 }))).toContain("dayPeriod * tileW must be below 2^32");
  });

  it("validates the optional signalGain", () => {
    expect(validateConfig(cfg({ signalGain: 1 }))).toEqual([]);
    expect(validateConfig(cfg({ signalGain: 127 }))).toEqual([]);
    expect(validateConfig(cfg({ signalGain: 0 })).length).toBeGreaterThan(0);
    expect(validateConfig(cfg({ signalGain: 128 })).length).toBeGreaterThan(0);
  });

  it("wanders: the meridian swings out by wanderAmp and back each wanderPeriod", () => {
    const sim = new RefSim(generalistWorld(cfg({ dayPeriod: 0, wanderPeriod: 1024, wanderAmp: 48 }), 1));
    expect(sim.light(0, 0, 0)).toBe(220); // tri 0: meridian at 0
    expect(sim.light(24, 0, 256)).toBe(220); // quarter period: tri 128/256 -> 24 cells
    expect(sim.light(48, 0, 512)).toBe(220); // half period: full amplitude
    expect(sim.light(24, 0, 768)).toBe(220); // coming back
    expect(sim.light(0, 0, 1024)).toBe(220);
  });

  it("wander is absent by default and validated", () => {
    expect(validateConfig(cfg({ wanderPeriod: 65_536, wanderAmp: 512 }))).toEqual([]);
    expect(validateConfig(cfg({ wanderAmp: 5000 })).length).toBeGreaterThan(0);
  });
});
