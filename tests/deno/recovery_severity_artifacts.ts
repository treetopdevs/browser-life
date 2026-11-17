// Synthetic smoke checks for the independent evidence reader; no simulations.
// LIMIT: the baseline is a synthetic unversioned bundle that the reader already
// rejects for its version, so the later cases show only that no tampered or
// marker-bearing bundle is accepted, not which check fired. Per-check tamper
// coverage is in experiments/test/recovery-severity-v4.test.ts.
import { canonicalObserverJSON } from "@bl/schema";
import { readStage0 } from "../../experiments/recovery-severity/read-stage0.ts";
const dir=await Deno.makeTempDir(),enc=new TextEncoder();
const sha=async(b:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",b as Uint8Array<ArrayBuffer>))].map(x=>x.toString(16).padStart(2,"0")).join("");
const rejected=async()=>{try{await readStage0(dir);}catch{return;}throw Error("accepted corrupt/incomplete evidence");};
try {
 const artifacts=[];
 for(const path of ["manifest.json","inputs.json","trace.json","final.blck"]) {
  const b=enc.encode("{}");await Deno.writeFile(`${dir}/${path}`,b);artifacts.push({path,bytes:b.length,sha256:await sha(b)});
 }
 const result={status:"STAGE0-PARITY-PASS",scientificSeedsRun:0,results:Array(12).fill({}),artifacts};
 await Deno.writeTextFile(`${dir}/result.json`,JSON.stringify(result));
 await Deno.writeTextFile(`${dir}/result-digest.json`,JSON.stringify({sha256:await sha(enc.encode(canonicalObserverJSON(result)))}));
 await rejected(); // Unversioned synthetic success must not bypass v4 checks.
 for(const path of ["manifest.json","trace.json","final.blck"]) {
  await Deno.writeTextFile(`${dir}/${path}`,"xx");await rejected();await Deno.writeTextFile(`${dir}/${path}`,"{}");
 }
 for(const marker of ["failure.json","pending.tmp"]) {
  await Deno.writeTextFile(`${dir}/${marker}`,"{}");await rejected();await Deno.remove(`${dir}/${marker}`);
 }
 result.scientificSeedsRun=1;await Deno.writeTextFile(`${dir}/result.json`,JSON.stringify(result));await rejected();
 console.log("PASS synthetic bundle never accepted: unversioned, tampered files, failure/tmp markers and altered result (rejection reason not asserted)");
}finally{await Deno.remove(dir,{recursive:true});}
