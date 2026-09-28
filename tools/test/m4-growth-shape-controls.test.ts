import {expect,it} from "vitest";
import {analyzeGrowthCurves,lateGrowth,type GrowthCurve} from "../lib/m4-growth.ts";
const curve=(count:(step:number)=>number)=>Array.from({length:10000},(_,i)=>({step:(i+1)*100,cumulativeNew:count((i+1)*100)}));

it("reports no late growth when a bounded process saturated before the declared window",()=>{
 expect(lateGrowth(curve(s=>Math.min(s,250000)/100))).toBe(0);
});
it("retains only the part of a bounded rise inside the window, without calling it open-ended",()=>{
 expect(lateGrowth(curve(s=>Math.min(s,750000)/100))).toBe(500);
 expect(lateGrowth(curve(s=>Math.min(s,2000000)/100))).toBe(1000);
});
it("detects improvement delayed until the final quarter but cannot see improvement after the horizon",()=>{
 expect(lateGrowth(curve(s=>Math.max(0,s-750000)/100))).toBe(500);
 expect(lateGrowth(curve(s=>Math.max(0,s-1100000)/100))).toBe(0);
});
it("separates level, paired heterogeneity and growth despite large baseline differences",()=>{
 const seeds=Array.from({length:64},(_,i)=>i+1);
 const curves:GrowthCurve[]=seeds.flatMap(seed=>(["treatment","neutral","no-mutation"] as const).map(condition=>({seed,condition,points:curve(s=>{
  const baseline=condition==="treatment"?100000+seed*100:seed;
  const late=Math.floor(Math.max(0,s-500000)/100000);
  // Paired differences alternate -1/+1; their mean is zero although levels differ greatly.
  const rate=condition==="treatment"?4+(seed%2?1:-1):4;
  return baseline+rate*late;
 })})));
 const report=analyzeGrowthCurves(curves,seeds);
 expect(report.endpoint2.mean).toBe(0);
 expect(report.endpoint2.supported).toBe(false);
 expect(report.endpoint2.status).toBe("ok");
});
