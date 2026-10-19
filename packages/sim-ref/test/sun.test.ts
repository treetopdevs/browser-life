import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUN_PERCENTS, defaultConfig, generalistWorld, ledgerResidual, stateHash, sunConfig, sunError, sunLight, totalsOf, type WorldConfig } from "@bl/schema";
import { RefSim, SunRefSim } from "@bl/sim-ref";

// A small sweep world with a wandering sun and a season, so every term of the light is live.
const cfg: WorldConfig = defaultConfig({
  tileW: 48, tileH: 48, kernelRadius: 5, seed: 11,
  lightMode: "sweep", lightBase: 20, lightAmp: 170, dayPeriod: 0, wanderPeriod: 640, wanderAmp: 40, seasonPeriod: 400, seasonAmp: 60,
});
const K = 10;
// The machine running these may be loaded: CPU physics on a 48² world takes its time.
const SLOW = 600_000;

// Every light mode, each under every percent its light takes (the sweep and the gradient take 50 and 75, even light 125 too),
// on smaller worlds: the formula is the spec's own, so this guards the routing of the sun config, not a copy of the formula.
const MODES: WorldConfig[] = [
  cfg,
  defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 12, lightMode: "uniform", lightBase: 40, lightAmp: 160 }),
  defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 13, lightMode: "gradient", lightBase: 20, lightAmp: 220 }),
  defaultConfig({ tileW: 32, tileH: 32, kernelRadius: 4, seed: 14, lightMode: "patches", lightBase: 40, lightAmp: 160, seasonPeriod: 300, seasonAmp: 20 }),
];

describe("SunRefSim", () => {
  it("under a sun steps as a RefSim built on the sun config, in every light mode and at every percent it takes", () => {
    const runs: string[] = [];
    for (const c of MODES) for (const pct of SUN_PERCENTS.filter((p) => sunError(c, p) === null)) {
      runs.push(`${c.lightMode} ${pct}`);
      const a = new SunRefSim(generalistWorld(c, 4));
      a.setLightNow(sunLight(c, pct));
      const s = generalistWorld(c, 4);
      const b = new RefSim({ ...s, cfg: sunConfig(c, pct) });
      for (let i = 0; i < (c === cfg ? K : 6); i++) {
        a.step();
        b.step();
      }
      expect(a.state.cells).toEqual(b.state.cells);
      expect(a.state.genome).toEqual(b.state.genome);
      expect(a.state.lightIn).toBe(b.state.lightIn);
      expect(a.state.heatOut).toBe(b.state.heatOut);
      expect(a.state.flux).toEqual(b.state.flux);
    }
    expect(runs).toEqual(["sweep 50", "sweep 75", "uniform 50", "uniform 75", "uniform 125", "gradient 50", "gradient 75", "patches 50", "patches 75"]);
  }, SLOW);

  it("cfg and state.cfg stay the world's own through a span", async () => {
    const s = generalistWorld(cfg, 4);
    const sim = new SunRefSim(s);
    await sim.setLight(sunLight(cfg, 50));
    for (let i = 0; i < 8; i++) {
      sim.step();
      expect(sim.cfg).toBe(s.cfg);
      expect(sim.state.cfg).toBe(s.cfg);
    }
    // And the sun did act: the same steps under the world's own light end elsewhere.
    const own = new RefSim(generalistWorld(cfg, 4));
    own.run(8);
    expect(stateHash(sim.state)).not.toBe(stateHash(own.state));
  }, SLOW);

  it("rests on two facts of the spec: RefSim.light reads nothing of `this` but cfg, and nothing else in step.ts reads the light keys", () => {
    // SunRefSim runs RefSim.prototype.light with the sun config as its `this`; a kernel edit (the gene v2 peer holds step.ts) that read
    // other state there, or the light keys elsewhere, would make SunRefSim and GpuSim.setLight diverge from a sun config silently.
    const body = RefSim.prototype.light.toString();
    expect(body.match(/\bthis\.\w+/g)!.every((m) => m === "this.cfg")).toBe(true);
    const src = readFileSync(new URL("../src/step.ts", import.meta.url), "utf8");
    const start = src.indexOf("  light(x: number, y: number, step: number): number {");
    const end = src.indexOf("\n  }\n", start);
    expect(start).toBeGreaterThan(0);
    const outside = src.slice(0, start) + src.slice(end);
    expect(outside.match(/\b(lightBase|lightAmp|seasonAmp|lightMode|seasonPeriod|dayPeriod|wanderPeriod|wanderAmp)\b/g)).toBeNull();
  });

  it("setLight(null) restores the world's light", () => {
    const sim = new SunRefSim(generalistWorld(cfg, 4));
    const ref = new RefSim(generalistWorld(cfg, 4));
    sim.setLightNow(sunLight(cfg, 75));
    expect(sim.activeLight).toEqual(sunLight(cfg, 75));
    expect(sim.light(10, 10, 123)).not.toBe(ref.light(10, 10, 123));
    sim.setLightNow(null);
    expect(sim.activeLight).toBeNull();
    for (const [x, y, t] of [[0, 0, 0], [10, 10, 123], [47, 3, 999], [24, 40, 5000]]) expect(sim.light(x, y, t)).toBe(ref.light(x, y, t));
  }, SLOW);

  it("a sun changes lightIn and the state", () => {
    const a = new SunRefSim(generalistWorld(cfg, 4));
    const b = new SunRefSim(generalistWorld(cfg, 4));
    a.setLightNow(sunLight(cfg, 50));
    a.run(K);
    b.run(K);
    expect(a.state.lightIn).toBeLessThan(b.state.lightIn);
    expect(stateHash(a.state)).not.toBe(stateHash(b.state));
  }, SLOW);

  it("matter and the energy residual stay exact", () => {
    const s = generalistWorld(cfg, 4);
    const start = totalsOf(cfg, s.cells);
    const sim = new SunRefSim(s);
    for (let i = 0; i < K; i++) {
      if (i === 5) sim.setLightNow(sunLight(cfg, 50));
      if (i === 15) sim.setLightNow(null);
      sim.step();
      expect(totalsOf(cfg, sim.state.cells).matter).toBe(start.matter);
      expect(ledgerResidual(start, sim.state)).toBe(0n);
    }
  }, SLOW);
});
