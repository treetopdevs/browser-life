import { expect, it } from "vitest";
import { allocState, defaultConfig, cellCount, CH, G } from "@bl/schema";
import { census, ActivityTracker } from "@bl/metrics";
import { ACTIVITY_THRESHOLDS } from "../../experiments/endpoints.ts";

it("constructed census worlds distinguish accumulation, disappearance and recurring identity", () => {
  // Prescribed static snapshots, not a claim of dynamically generated organisms.
  const state=allocState(defaultConfig({tileW:8,tileH:8,tilesX:1,tilesY:1,kernelRadius:2}));
  const n=cellCount(state.cfg);
  const occupy=(yes:boolean)=>{for(let i=0;i<n;i++){state.cells[CH.B*n+i]=yes?48:0;state.cells[CH.A*n+i]=yes?0:48;state.genome[G.LIN_LO*n+i]=yes?1:0;}};
  for(const preset of ["gradient-m3","spots-m3"]){
    const threshold=ACTIVITY_THRESHOLDS[preset].value!;
    const tracker=new ActivityTracker(threshold);
    const observe=()=>{state.step+=100;const c=census({cfg:state.cfg,step:state.step,cells:state.cells,genomeHead:state.genome});return tracker.update(state.step,c.lineages.map(l=>[l.key,l.cells]));};
    occupy(true);
    for(let i=0;i<Math.floor(threshold/n);i++)expect(observe().cumulativeNew).toBe(0);
    expect(observe().cumulativeNew).toBe(1);
    expect(observe().cumulativeNew).toBe(1);
    occupy(false);expect(observe().cumulativeNew).toBe(1);
    occupy(true);
    for(let i=0;i<Math.floor(threshold/n);i++)expect(observe().cumulativeNew).toBe(1);
    expect(observe().cumulativeNew).toBe(2); // same key, new crossing episode
  }
});
