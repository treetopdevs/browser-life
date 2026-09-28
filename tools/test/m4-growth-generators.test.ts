import { expect, it } from "vitest";
import { growthGenerator, GROWTH_SCENARIOS } from "../lib/m4-growth-generators.ts";
import { makeSpec, type Identity } from "../lib/nullgen.ts";
import { activities } from "../lib/bundle.ts";
import { lateGrowth } from "../lib/m4-growth.ts";
it("abstract planted count contrasts survive actual threshold construction and extinction", async () => {
  for (const scenario of GROWTH_SCENARIOS) {
    const id:Identity={masterSeed:650009001,nullId:scenario,windowSteps:1000000,replicateIndex:999,condition:"treatment",seedIndex:0};
    const t=growthGenerator(scenario,id,makeSpec("fixture","treatment",900001,1000000,100,10));
    const n=growthGenerator(scenario,{...id,condition:"neutral"},makeSpec("fixture","neutral",900001,1000000,100,10));
    const ts=(await activities(t,10008)).snaps, ns=(await activities(n,10008)).snaps;
    expect(lateGrowth(ts)-lateGrowth(ns)).toBeCloseTo(t.manifest.nullcal.generatorParams.difference/5,10);
    expect(ts.at(-1)!.cumulativeNew).toBe(t.manifest.nullcal.generatorParams.baseline+t.manifest.nullcal.generatorParams.late);
    if(scenario==="extinctionBoundary") expect(ts.slice(7500).every(x=>x.diversity===0)).toBe(true);
    expect(growthGenerator(scenario,id,makeSpec("fixture","treatment",900001,1000000,100,10)).manifest).toEqual(t.manifest);
  }
});
