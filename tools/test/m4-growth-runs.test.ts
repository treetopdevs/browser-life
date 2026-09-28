import { describe, expect, it } from "vitest";
import { PRESETS, initWorld, stateHash } from "@bl/schema";
import { specConfig } from "@bl/runner";
import { buildManifest, makeSpec } from "../lib/nullgen.ts";
import { analyzeGrowthRuns } from "../lib/m4-growth-runs.ts";
import type { Run } from "../lib/bundle.ts";
function runs(): Run[] {
  return [900001,900002].flatMap((seed) => ["treatment","neutral","no-mutation"].map((condition) => {
    const spec = makeSpec("growth-fixture",condition,seed,1000000,100,10);
    return { seed, condition, dir: "synthetic", manifest: buildManifest(spec,"fixture",1000000,0,{}), series: Array.from({length:10000},(_,i)=>({step:(i+1)*100})), lineages:new Map<number,[string,number][]>([[100,[["one",10009]]]]) };
  }));
}
describe("M4 activity/provenance path", () => {
  it("uses frozen threshold even with synthetic neutral distribution", async () => {
    const report = await analyzeGrowthRuns(runs(),[900001,900002],{kind:"synthetic",generatorIdentity:"fixture-v1"});
    expect(report.threshold.threshold).toBe(10008);
    expect(report.threshold.mode).toBe("frozen");
    expect(report.endpoint2.mean).toBe(0);
    expect(report.provenance.kind).toBe("synthetic");
    expect(report.endpoint1.kind).toBe("test");
    expect(report.endpoint1.rows).toHaveLength(2);
    expect(report.endpoint1.rows.every(row=>row.p===1&&!row.supported)).toBe(true);
    expect(report.endpoint1Method).toBe("exact-midrank-permutation");
    expect(report.jointPerPresetObserved).toBe(false);
  });
  it("refuses synthetic data in real mode and missing/synthetic-mixed provenance", async () => {
    await expect(analyzeGrowthRuns(runs(),[900001,900002],{kind:"real"})).rejects.toThrow();
    const r=runs(); r[0].manifest.initHash="pretend";
    await expect(analyzeGrowthRuns(r,[900001,900002],{kind:"synthetic",generatorIdentity:"fixture"})).rejects.toThrow("synthetic provenance");
  });
  it("refuses missing data, conservation failure and pilot seed overlap", async () => {
    const p={kind:"synthetic",generatorIdentity:"fixture"} as const;
    await expect(analyzeGrowthRuns(runs().slice(1),[900001,900002],p)).rejects.toThrow("missing");
    const r=runs();r[0].manifest.summary.conservationOk=false;
    await expect(analyzeGrowthRuns(r,[900001,900002],p)).rejects.toThrow("conservation");
    await expect(analyzeGrowthRuns(runs(),[1001,1002],p)).rejects.toThrow();
  });
  it("confirms both presets initialize matched physical worlds", () => {
    for (const presetId of ["gradient-m3","spots-m3"]) {
      const preset=PRESETS.find(p=>p.id===presetId)!;
      const base={...makeSpec("pair-proof","treatment",650000001,1000000,100,10),presetId};
      const t=initWorld(specConfig(base),preset.init);
      const n=initWorld(specConfig({...base,condition:"neutral"}),preset.init);
      expect(stateHash({...n,cfg:t.cfg})).toBe(stateHash(t));
      expect(n.cells).toEqual(t.cells);
      expect(n.genome).toEqual(t.genome);
    }
  });
});
