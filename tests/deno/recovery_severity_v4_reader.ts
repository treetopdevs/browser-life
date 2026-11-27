// Filesystem-level independent-reader regression against a saved-only v4 projection.
// This only reads saved files and creates small adversarial envelopes in a temp dir.
import { readStage0, readStage0Branch } from "../../experiments/recovery-severity/read-stage0.ts";
import { jsonBytes, objectDigest, pinBytes } from "../../experiments/recovery-severity/branch-record.ts";
const [out,budgetPath]=Deno.args;
if(Deno.args.length!==2)throw Error("usage: recovery_severity_v4_reader.ts SAVED_V4_OUT SHARED_BUDGET_JSON");
const path="2026102402-mutant-mass-targeted-diagnostic.json";
const verdict=await readStage0Branch(out,path);
if(verdict.status!=="TECHNICAL-STOP"||verdict.globalStage0Pass||verdict.mode!=="saved-trace-reanalysis"||verdict.diagnostic.endpoint.T!==2025||verdict.diagnostic.endpoint.cleanRecovery!==false)throw Error("saved failure was rescued");
const rejection=async(work:()=>Promise<unknown>,message:string)=>{try{await work();}catch(e){if(String(e).includes(message))return;throw e;}throw Error("accepted invalid evidence");};
await rejection(()=>readStage0(out,budgetPath),"incomplete/failed attempt");
const dir=await Deno.makeTempDir();
try {
 const artifacts=[];
 for(const name of ["manifest.json","inputs.json"]) {
  const b=await Deno.readFile(`${out}/${name}`);await Deno.writeFile(`${dir}/${name}`,b);artifacts.push(await pinBytes(name,b));
 }
 // Recomputing an apparently successful outer envelope cannot upgrade saved-only evidence.
 const result={status:"STAGE0-PARITY-PASS",scientificSeedsRun:0,artifacts,results:Array(12).fill({}),elapsedMs:0,writtenBytes:artifacts.reduce((sum,p)=>sum+p.bytes,0)};
 await Deno.writeFile(`${dir}/result.json`,jsonBytes(result));await Deno.writeFile(`${dir}/result-digest.json`,jsonBytes({sha256:await objectDigest(result)}));
 await rejection(()=>readStage0(dir,budgetPath),"saved reanalysis is not an engineering pass");
 await Deno.writeTextFile(`${dir}/pending.tmp`,"");
 await rejection(()=>readStage0Branch(dir,path),"incomplete branch evidence");
 console.log("PASS failed branch independently readable; failure/root upgrade/saved-only upgrade/partial publication rejected; zero simulation steps");
}finally{await Deno.remove(dir,{recursive:true});}
