import { expect,it } from "vitest";
import {validateTrialPrefix,validateResumeReport}from"../lib/m4-calibration-checkpoint.ts";
const schedule={phase:"development",masterSeed:7,pairs:64,trials:2,strata:[{scenario:"null",preset:"p"}]};
const row=(trial:number)=>({scenario:"null",preset:"p",trial,manifestHash:"abc",identity:{kind:"synthetic",generatorIdentity:`development:7:null:p:${trial}`},endpoint2:{n:64,mean:0,supported:false,status:"ok"},endpoint1:{kind:"test",rows:[{},{}]},wallSeconds:1});
it("accepts only the exact authenticated prefix, never duplicate or changed identities",()=>{
 expect(validateTrialPrefix([row(0)],schedule,"abc").size).toBe(1);
 expect(()=>validateTrialPrefix([row(1)],schedule,"abc")).toThrow();
 expect(()=>validateTrialPrefix([row(0),row(0)],schedule,"abc")).toThrow();
 expect(()=>validateTrialPrefix([row(0)],schedule,"changed")).toThrow();
 expect(()=>validateTrialPrefix([{...row(0),identity:{kind:"synthetic",generatorIdentity:"other"}}],schedule,"abc")).toThrow();
});
it("requires a terminal same-manifest attempt and carries forward its budget",()=>{
 const report={manifestHash:"abc",trialLogSha256:"log",terminal:true,cumulativeWallSeconds:12,attempt:1,complete:false};
 expect(validateResumeReport(report,"abc","log",60)).toBe(12);
 for(const patch of [{terminal:false},{complete:true},{manifestHash:"other"},{trialLogSha256:"tampered"},{cumulativeWallSeconds:60}])expect(()=>validateResumeReport({...report,...patch},"abc","log",60)).toThrow();
});
