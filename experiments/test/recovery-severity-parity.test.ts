import { expect, it } from "vitest";
import { allocState, CH, cellCount, cloneState, defaultConfig, stateHash } from "@bl/schema";
import { applyLesion, RefSim } from "@bl/sim-ref";
import { RemnantTrack } from "../recovery-accessibility/observer.ts";
import { assertConserved, branchTrace, compareTraces, returnTime, sustainedReturn, type Factory } from "../recovery-severity/parity.ts";

function fixture() {
  const state=allocState({...defaultConfig(),tileW:64,tileH:64,tilesX:1,tilesY:1,mutRate:0});
  const cells=Array.from({length:10},(_,x)=>20*64+20+x),n=cellCount(state.cfg);
  for(const i of cells) {state.cells[CH.B*n+i]=60;state.cells[CH.P*n+i]=40;}
  return {state,target:{cells,mass:1000},disc:{center:cells[0],radius:3}};
}
// A static synthetic body isolates observation scheduling from simulation dynamics.
const staticBackend:Factory=async input=>{
 const state=cloneState(input);
 return {run:n=>{state.step+=n;},lesion:(x,y,r)=>applyLesion(new RefSim(state),x,y,r),readState:async()=>cloneState(state),destroy(){}};
};
it("conserves matter and energy while destroying both bound channels, preserving the source and remnant",async()=>{
 const {state,target,disc}=fixture(),before=stateHash(state);
 const trace=await branchTrace(staticBackend,state,target,disc,25);
 expect(trace.initialMass).toBe(600); expect(trace.rows[0].label).not.toBeNull();
 expect(trace.track.lost).toBe(false); expect(trace.track.merged).toBe(false);
 expect(trace.track.mass).toBe(600); expect(stateHash(state)).toBe(before);
 const post=cloneState(state);applyLesion(new RefSim(post),20,20,3);assertConserved(state,post);
 const n=cellCount(state.cfg);expect(post.cells[CH.B*n+target.cells[0]]).toBe(0);expect(post.cells[CH.P*n+target.cells[0]]).toBe(0);
 post.cells[CH.A*n]++;expect(()=>assertConserved(state,post)).toThrow(/conservation/);
});
it("sham skips the lesion call and agrees physically and by retained label on shared observations",async()=>{
 const {state,target}=fixture();let called=false;
 const factory:Factory=async s=>{const b=await staticBackend(s);return {...b,lesion:()=>{called=true;throw Error("sham lesion");}};};
 const fast=await branchTrace(factory,state,target,null,25),slow=await branchTrace(factory,state,target,null,50);
 expect(called).toBe(false);compareTraces(fast,slow);expect(returnTime(fast,slow,1000,0)).toBe(0);
 slow.rows[1].label=99;expect(()=>compareTraces(fast,slow)).toThrow(/component/);
 slow.rows[1].identity="bad";expect(()=>compareTraces(fast,slow)).toThrow(/physical/);
});
it("detects a GPU-style lesion no-op immediately and always destroys the backend",async()=>{
 const {state,target,disc}=fixture();let destroyed=false;
 const broken:Factory=async s=>({...await staticBackend(s),lesion(){},destroy(){destroyed=true;}});
 await expect(branchTrace(broken,state,target,disc,25)).rejects.toThrow(/intervention/);expect(destroyed).toBe(true);
});
function track(cadence:25|50,massAt:(step:number)=>number) {
 const history=Array.from({length:2000/cadence},(_,i)=>({step:(i+1)*cadence,mass:massAt((i+1)*cadence),label:0 as number|null,edges:[{from:0,to:0,cells:1}],split:false,merged:false,lost:false}));
 return {initialLabel:0 as number|null,recovered:true,retained:true,merged:false,lost:false,mass:history.at(-1)!.mass,history};
}
it("calculates sustained return independently on each grid, requires 200 steps and rejects missing evidence",()=>{
 const mass=(step:number)=>step>=275?900:600;
 const fast=track(25,mass),slow=track(50,mass);
 expect(sustainedReturn(fast,slow,1000,0)).toBe(275);
 expect(sustainedReturn(track(25,s=>s>=1825?900:600),track(50,s=>s>=1825?900:600),1000,0)).toBe(2025);
 fast.history[39].mass=899;expect(sustainedReturn(fast,slow,1000,0)).toBe(1025);
 fast.history.pop();expect(()=>sustainedReturn(fast,slow,1000,0)).toThrow(/incomplete/);
});
it("disqualifies shared-label disagreement, matching null labels, fusion and permanent continuity loss",()=>{
 const fast=track(25,()=>1000),slow=track(50,()=>1000);
 for(let i=0;i<slow.history.length;i++){slow.history[i].label=1;slow.history[i].edges=[{from:i===0?0:1,to:1,cells:1}];}
 expect(sustainedReturn(fast,slow,1000,0)).toBe(2025);
 const lost=(cadence:25|50)=>{const t=track(cadence,()=>0);t.initialLabel=null;t.lost=true;t.retained=false;t.recovered=false;for(const r of t.history){r.label=null;r.edges=[];r.lost=true;}return t;};
 expect(sustainedReturn(lost(25),lost(50),1000,0)).toBe(2025);
 const fused=track(25,()=>1000);fused.history[0].edges.push({from:1,to:0,cells:1});
 for(const row of fused.history)row.merged=true;
 fused.merged=true;fused.recovered=false;
 expect(sustainedReturn(fused,track(50,()=>1000),1000,0)).toBe(2025);
});
it("tracks a fragmented body's retained daughter without summing it, and refuses replacement or incoming fusion",async()=>{
 const {state,target}=fixture();
 const { census }=await import("@bl/metrics");
 const frame=(s:typeof state)=>census({cfg:s.cfg,step:s.step,cells:s.cells,genomeHead:s.genome},{threshold:48,minMass:128});
 const start=frame(state),t=new RemnantTrack(start,0,1000),split=cloneState(state),n=cellCount(state.cfg);
 split.cells[CH.B*n+target.cells[4]]=0;split.cells[CH.P*n+target.cells[4]]=0;split.step=50;t.update(frame(split));
 expect(t.result().mass).toBe(500);expect(t.result().recovered).toBe(false);
 const gone=cloneState(split);gone.cells.fill(0);gone.step=100;t.update(frame(gone));
 const back=cloneState(state);back.step=150;t.update(frame(back));expect(t.result().lost).toBe(true);expect(t.result().mass).toBe(0);
 const incoming=new RemnantTrack(frame(split),0,1000);incoming.update(frame(back));expect(incoming.result().merged).toBe(true);
});

import { validateTrack } from "../recovery-severity/continuity.ts";
it("independently rejects contradictory overlap, continuity flags and trace rows",async()=>{
 const {state,target}=fixture();const trace=await branchTrace(staticBackend,state,target,null,25);
 validateTrack(trace.track,target.mass,25,0);
 const forged=structuredClone(trace.track);
 forged.history[0].edges.push({from:1,to:forged.initialLabel!,cells:1});
 expect(()=>validateTrack(forged,target.mass,25,0)).toThrow(/flags/);
 const wrong=structuredClone(trace.track);wrong.history[0].label=999;
 expect(()=>validateTrack(wrong,target.mass,25,0)).toThrow(/continuation/);
});

it("detects cadence loss when intermediate overlaps bridge a moving component",async()=>{
 const { census }=await import("@bl/metrics");const {state,target}=fixture();
 const frame=(offset:number)=>{const s=cloneState(state),n=cellCount(s.cfg);s.cells.fill(0);s.step=offset*25;for(const i of target.cells.slice(0,2))s.cells[CH.B*n+i+offset]=100;return census({cfg:s.cfg,step:s.step,cells:s.cells,genomeHead:s.genome},{threshold:48,minMass:128});};
 // Shift one cell per observation: overlap exists through the intermediate frame,
 // while the shared endpoint has no overlap with the original component.
 const a=frame(0),b=frame(1),c=frame(2);
 const fast=new RemnantTrack(a,0,200),slow=new RemnantTrack(a,0,200);
 fast.update(b);fast.update(c);slow.update(c);
 expect(fast.result().lost).toBe(false);expect(slow.result().lost).toBe(true);
});
it("rejects a saved row that disagrees with its continuity evidence",async()=>{
 const {state,target}=fixture();const fast=await branchTrace(staticBackend,state,target,null,25),slow=await branchTrace(staticBackend,state,target,null,50);
 slow.rows[1].mass++;
 expect(()=>returnTime(fast,slow,target.mass,0)).toThrow(/trace\/history/);
});

it("records an initially ineligible remnant as the tracker actually does: null identity and zero retained mass",async()=>{
 const state=allocState({...defaultConfig(),tileW:64,tileH:64,tilesX:1,tilesY:1,mutRate:0}),n=cellCount(state.cfg),a=20*64+20;
 state.cells[CH.B*n+a]=100;state.cells[CH.B*n+a+1]=100;
 const t=await branchTrace(staticBackend,state,{cells:[a,a+1],mass:200},{center:a-1,radius:1},25);
 expect(t.initialMass).toBe(0);expect(t.rows[0].label).toBeNull();expect(t.track.initialLabel).toBeNull();expect(t.track.lost).toBe(true);
 validateTrack(t.track,200,25,0);
});
