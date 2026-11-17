/** Offline only: diagnose-cadence.ts ATTEMPT_DIR V1_DIR [--assert-concordant]. */
import { canonicalObserverJSON } from "@bl/schema";
import { compareTraces, returnTime, type branchTrace } from "./parity.ts";
import { validateTrack } from "./continuity.ts";
type Trace=Awaited<ReturnType<typeof branchTrace>>;
const [out,source,assertion,...extra]=Deno.args;
if(!out||!source||extra.length||(assertion!==undefined&&assertion!=="--assert-concordant"))throw Error("usage: diagnose-cadence.ts ATTEMPT_DIR V1_DIR [--assert-concordant]");
const id="2026102402-mutant-mass-targeted";
const read=async(path:string)=>JSON.parse(await Deno.readTextFile(path));
const sha=async(b:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",b as Uint8Array<ArrayBuffer>))].map(x=>x.toString(16).padStart(2,"0")).join("");
const inventory=await read("docs/recovery-severity-2026-10-24/STAGE0-AUDIT.json");
const inputBytes=await Deno.readFile(`${out}/inputs.json`),inputHash=await sha(inputBytes);
const inputPin=inventory.artifacts.find((a:{path:string})=>a.path==="inputs.json");
if(!inputPin||inputPin.sha256!==inputHash||inputPin.bytes!==inputBytes.length)throw Error("input evidence inventory mismatch");
const inputs=JSON.parse(new TextDecoder().decode(inputBytes)),caseId="science-mutant-2026102402";
const c=await read(`${source}/cases/${caseId}/case.json`);
const caseHash=await sha(new TextEncoder().encode(canonicalObserverJSON(c)));
if(caseHash!==inputs.find((e:{id:string})=>e.id===caseId)?.caseSha256)throw Error("original target identity mismatch");
const traces:Trace[]=[],sources=[{path:"inputs.json",bytes:inputBytes.length,sha256:inputHash}];
for(const suffix of ["cpu25","gpu25","gpu50"]) {
 const path=`${id}-${suffix}.json`,bytes=await Deno.readFile(`${out}/${path}`),sha256=await sha(bytes);
 const pin=inventory.artifacts.find((a:{path:string})=>a.path===path);
 if(!pin||pin.sha256!==sha256||pin.bytes!==bytes.length)throw Error(`saved trace identity mismatch: ${path}`);
 const t:Trace=JSON.parse(new TextDecoder().decode(bytes));
 validateTrack(t.track,c.observation.target.mass,t.cadence,3000);
 if(t.rows.length!==t.track.history.length+1||t.rows[0].label!==t.track.initialLabel||t.rows[0].mass!==t.initialMass)throw Error("initial row mismatch");
 t.track.history.forEach((h,i)=>{const r=t.rows[i+1];if(r.offset!==h.step-3000||r.label!==h.label||r.mass!==h.mass)throw Error("row/evidence mismatch");});
 traces.push(t);sources.push({path,bytes:bytes.length,sha256});
}
const [cpu,fast,slow]=traces;compareTraces(cpu,fast);
const differences=[];
for(const s of slow.rows) {
 const f=fast.rows.find(r=>r.offset===s.offset);
 if(!f||f.identity!==s.identity)throw Error(`physical disagreement at ${s.offset}`);
 if(f.label!==s.label||f.mass!==s.mass)differences.push({offset:s.offset,fast:{label:f.label,mass:f.mass},slow:{label:s.label,mass:s.mass}});
}
const first=(t:Trace,key:"split"|"merged"|"lost")=>{const row=t.track.history.find(r=>r[key]);return row?row.step-3000:null;};
const rows=(t:Trace)=>t.track.history.filter(r=>r.step>=3050&&r.step<=3100).map(r=>({offset:r.step-3000,label:r.label,mass:r.mass,edges:r.edges,split:r.split,merged:r.merged,lost:r.lost}));
const report={version:"recovery-severity-cadence-diagnosis-v1",scope:"saved-evidence-only",id,sources,originalTargetMass:c.observation.target.mass,
 physicalStatesAgreeAtAllSharedObservations:true,cpu25AndGpu25Agree:true,continuityEvidenceValid:true,
 differences,window:{fast:rows(fast),slow:rows(slow)},events:{fast:{split:first(fast,"split"),merged:first(fast,"merged"),lost:first(fast,"lost")},slow:{split:first(slow,"split"),merged:first(slow,"merged"),lost:first(slow,"lost")}},
 frozenOutcome:{T:returnTime(fast,slow,c.observation.target.mass,3000),cleanRecoveryEligible:false,stage0Pass:false},
 limitation:"Compact edges show eligible spatial overlap, not material ancestry or a motion/threshold decomposition.",simulationStepsRun:0,scientificSeedsRun:0};
console.log(JSON.stringify(report,null,2));
if(assertion==="--assert-concordant"&&differences.length)Deno.exitCode=3;
