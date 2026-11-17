/** Audit retained TECHNICAL-STOP evidence without resuming or accepting a run. */
import { canonicalObserverJSON, decodeCheckpoint, cloneState, worldW } from "@bl/schema";
import { compareTraces, stateIdentity, assertConserved, type branchTrace } from "./parity.ts";
import { validateRoleTraces } from "./audit-traces.ts";
import { RefSim, applyLesion } from "@bl/sim-ref";
import { enumerateCandidatesDetailed, selectPair } from "./selector.ts";
import type { Target } from "../recovery-accessibility/observer.ts";
type Trace=Awaited<ReturnType<typeof branchTrace>>;
const [out,source,budgetPath]=Deno.args;
if(Deno.args.length!==3)throw Error("usage: audit-attempt.ts OUT V1_DIR SHARED_BUDGET_JSON");
const read=async(p:string)=>JSON.parse(await Deno.readTextFile(p));
const sha=async(b:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",b as Uint8Array<ArrayBuffer>))].map(x=>x.toString(16).padStart(2,"0")).join("");
const stable=canonicalObserverJSON;
const failure=await read(`${out}/failure.json`);
if(failure.status!=="TECHNICAL-STOP")throw Error("not a stopped engineering attempt");
const budget=await read(budgetPath);
try{await Deno.stat(`${budgetPath}.lock`);throw Error("unsettled budget lock");}catch(e){if(!(e instanceof Deno.errors.NotFound))throw e;}
const debit=budget.attempts.find((a:{out:string})=>a.out===out);
if(!debit || debit.elapsedMs<failure.elapsedMs || budget.spentMs>1200000 || budget.spentBytes>536870912)throw Error("invalid aggregate accounting");
const manifest=await read(`${out}/manifest.json`);
for(const s of manifest.sources) {
 let bytes=await Deno.readFile(s.path);
 if(await sha(bytes)!==s.sha256) {
  const name=s.path.split("/").at(-1);
  bytes=await Deno.readFile(`${out}/execution-source/${name}`);
  if(await sha(bytes)!==s.sha256)throw Error(`missing executed source: ${s.path}`);
 }
}
const evidence=await read(`${out}/inputs.json`),cases=new Map<string,{mass:number;target:Target;state:ReturnType<typeof decodeCheckpoint>["state"]}>();
for(const e of evidence) {
 const c=await read(`${source}/cases/${e.id}/case.json`);
 if(await sha(new TextEncoder().encode(stable(c)))!==e.caseSha256)throw Error("input case mismatch");
 const b=await Deno.readFile(`${source}/cases/${e.id}/grown.blck`);
 if(await sha(b)!==e.checkpointSha256)throw Error("input checkpoint mismatch");
 const grown=decodeCheckpoint(b).state;
 cases.set(e.id,{mass:c.observation.target.mass,target:c.observation.target,state:grown});
}
const selections=[];
for(const seed of [2026102401,2026102402]) {
 const p=cases.get(`science-parent-${seed}`)!,m=cases.get(`science-mutant-${seed}`)!;
 const pc=enumerateCandidatesDetailed(p.state,p.target),mc=enumerateCandidatesDetailed(m.state,m.target);
 const selected=selectPair(pc.candidates,mc.candidates);
 if(!selected)throw Error("engineering prescription no longer reproducible");
 selections.push({seed,parent:pc.counts,mutant:mc.counts,selected});
}
const audited=[],missing=[],disagreements:unknown[]=[];
const present=async(p:string)=>{try{await Deno.stat(p);return true;}catch(e){if(e instanceof Deno.errors.NotFound)return false;throw e;}};
for(const seed of [2026102401,2026102402])for(const subject of ["parent","mutant"])for(const arm of ["legacy","mass-targeted","sham"]) {
 const id=`${seed}-${subject}-${arm}`,original=cases.get(`science-${subject}-${seed}`)!;
 const traces:Trace[]=[];
 const have=await Promise.all(["cpu25","gpu25","gpu50"].map(n=>present(`${out}/${id}-${n}.json`)));
 if(have.every(h=>!h)){
  const leftovers=[];for await(const e of Deno.readDir(out))if(e.name.startsWith(`${id}-`))leftovers.push(e.name);
  if(leftovers.length)throw Error(`traces absent but other evidence retained for ${id}: ${leftovers.join(",")}`);
  missing.push(id);continue;}
 if(!have.every(Boolean))throw Error(`incomplete retained evidence for ${id}`);
 for(const name of ["cpu25","gpu25","gpu50"])traces.push(await read(`${out}/${id}-${name}.json`));
 // Cadence is fixed by the file's role, so a copied gpu50 trace cannot stand in for a 25-step one.
 validateRoleTraces(traces,original.mass,original.state.step);
 compareTraces(traces[0],traces[1]);
 for(const slow of traces[2].rows) {
  const fast=traces[1].rows.find(r=>r.offset===slow.offset)!;
  if(fast.identity!==slow.identity)throw Error(`physical mismatch ${id}/${slow.offset}`);
  if(fast.label!==slow.label||fast.mass!==slow.mass)disagreements.push({id,offset:slow.offset,fast:{label:fast.label,mass:fast.mass},slow:{label:slow.label,mass:slow.mass}});
 }
 for(const phase of ["post","final"]) {
  const saved=decodeCheckpoint(await Deno.readFile(`${out}/${id}-${phase}.blck`)).state;assertConserved(original.state,saved);
  if(phase==="post") {
   const expected=cloneState(original.state),disc=arm==="sham"?null:arm==="legacy"?original.target.lesion:selections.find(p=>p.seed===seed)!.selected![subject as "parent"|"mutant"];
   if(disc)applyLesion(new RefSim(expected),disc.center%worldW(expected.cfg),Math.floor(disc.center/worldW(expected.cfg)),disc.radius);
   if(stateIdentity(saved)!==stateIdentity(expected))throw Error("saved intervention/sham mismatch");
  }
  if(stateIdentity(saved)!==(phase==="post"?traces[1].rows[0]:traces[1].rows.at(-1)!).identity)throw Error("saved checkpoint mismatch");
 }
 if(seed===2026102401)for(const [cadence,index] of [[25,1],[50,2]])if(stable(await read(`${out}/${id}-replay${cadence}.json`))!==stable(traces[index]))throw Error("replay mismatch");
 audited.push(id);
}
const artifacts:{path:string;bytes:number;sha256:string}[]=[];
const inventory=async(path:string,prefix="")=>{for await(const e of Deno.readDir(path)) {
 if(e.isDirectory)await inventory(`${path}/${e.name}`,`${prefix}${e.name}/`);
 else {const b=await Deno.readFile(`${path}/${e.name}`);artifacts.push({path:`${prefix}${e.name}`,bytes:b.length,sha256:await sha(b)});}
}};
await inventory(out);
const retainedBytes=artifacts.reduce((n,a)=>n+a.bytes,0);
const nat=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=0;
if(![debit.bytes,debit.elapsedMs,budget.spentBytes,budget.spentMs].every(nat))throw Error("malformed accounting fields");
if(debit.bytes<retainedBytes||budget.spentBytes<debit.bytes||budget.spentMs<debit.elapsedMs)throw Error(`undercharged accounting: debit ${debit.bytes} < retained ${retainedBytes}, or aggregate below debit`);
console.log(JSON.stringify({status:"TECHNICAL-STOP-AUDITED",failure,selections,auditedBranches:audited,missingBranches:missing,cadenceDisagreements:disagreements,physicalAgreement:true,continuityEvidenceValidated:true,firstPairReplayAgreement:true,artifacts,aggregateSpentMs:budget.spentMs,aggregateSpentBytes:budget.spentBytes,scientificSeedsRun:0},null,2));
