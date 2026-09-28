// One frozen development history per invocation; repeat only exact inputs after a technical failure.
// deno run -A tools/m4-growth-pilot.ts --plan <json> --index 0
import {parseArgs} from "jsr:@std/cli@1/parse-args";
import {loadRun,ensembleProblems,provenanceProblems} from "./lib/bundle.ts";
import {pipelineJobs,pipelineBudget,foreignGpuWorkers,admitPipelineReceipt,validatePipelineReceiptSequence} from "./lib/m4-pipeline.ts";
const a=parseArgs(Deno.args,{string:["plan","index"]});
if(!a.plan||a.index===undefined)throw new Error("--plan and --index required");
const planText=await Deno.readTextFile(a.plan),plan=JSON.parse(planText),index=Number(a.index),jobs=pipelineJobs();
if(plan.format!=="m4-development-pipeline/v1"||JSON.stringify(plan.jobs)!==JSON.stringify(jobs)||plan.maxGpuSeconds!==14400||plan.maxNewBytes!==10*1024**3||plan.outputRoot!=="runs/foundations-next/m4-pipeline-v1"||!Number.isInteger(index)||index<0||index>=12)throw new Error("invalid fixed pipeline plan");
const sha=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",b as BufferSource)),v=>v.toString(16).padStart(2,"0")).join("");
const planHash=await sha(new TextEncoder().encode(planText));
const required=["docs/m4-growth-pipeline.md","tools/lib/bundle.ts","tools/m4-growth-pilot.ts","tools/lib/m4-pipeline.ts","tools/run.ts","deno.json","deno.lock"];
for(const directory of ["schema","sim-ref","sim-gpu","metrics","runner"]){for await(const e of Deno.readDir(`packages/${directory}/src`))if(e.isFile&&e.name.endsWith(".ts"))required.push(`packages/${directory}/src/${e.name}`);}
if(!plan.sourceHashes||required.some(p=>!plan.sourceHashes[p]))throw new Error("canonical pipeline source map missing");
const verify=async()=>{for(const [path,hash]of Object.entries(plan.sourceHashes))if(await sha(await Deno.readFile(path))!==hash)throw new Error(`source drift ${path}`);if(await sha(await Deno.readFile(plan.seedAudit.path))!==plan.seedAudit.sha256)throw new Error("seed audit drift");};
await verify();
const ps=async()=>new TextDecoder().decode((await new Deno.Command("ps",{args:["-axo","pid=,command="],stdout:"piped"}).output()).stdout);
if(foreignGpuWorkers(await ps(),[Deno.pid]).length)throw new Error("known external GPU worker active; no history started");
const root=plan.outputRoot;
await Deno.mkdir(root,{recursive:true});
const receipts:any[]=[];
for await(const e of Deno.readDir(root)){if(/^job-\d+-attempt-\d+$/.test(e.name)&&e.isDirectory){
 const report=JSON.parse(await Deno.readTextFile(`${root}/${e.name}/receipt.json`));
 const binding=await admitPipelineReceipt(plan,planHash,e.name,report,p=>Deno.readFile(p));
 if(report.status==="completed"){
  if(await sha(await Deno.readFile(`${binding.bundle}/manifest.json`))!==report.bundleManifestSha256)throw new Error("completed bundle manifest drift");
  const run=await loadRun(binding.bundle,binding.job.condition,binding.job.seed);
  if(!run||JSON.stringify(run.manifest.summary)!==JSON.stringify(report.summary)||ensembleProblems([run]).length||provenanceProblems([run],binding.job.preset).length)throw new Error("completed receipt has no valid matching full bundle");
 }
 receipts.push(report);
}}
validatePipelineReceiptSequence(receipts);
const complete=receipts.filter(r=>r.status==="completed");
if(complete.some(r=>r.index===index))throw new Error("history already completed");
if(jobs.slice(0,index).some(j=>!complete.some(r=>r.index===j.index)))throw new Error("earlier frozen history incomplete; no reordered selection");
const attempt=receipts.filter(r=>r.index===index).length+1;
if(attempt>3)throw new Error("maximum three identical-input technical attempts reached");
const budget=pipelineBudget(receipts.reduce((s,r)=>s+r.wallSeconds,0),complete.find(r=>r.index===0)?.wallSeconds??null,complete.length);
if(!budget.affordable)throw new Error("four-hour matrix not affordable from benchmark or cumulative budget");
const directory=`${root}/job-${index}-attempt-${attempt}`;
await Deno.mkdir(directory); // Refuse an existing attempt, including an interrupted writer.
const job=jobs[index];
const bundleRoot=`${directory}/bundles`,experiment="m4-growth-development-v1";
const bundle=`${bundleRoot}/${experiment}/${job.preset}/${job.condition}/seed-${job.seed}`;
const lock=`${root}/worker.lock`;
await Deno.writeTextFile(lock,JSON.stringify({pid:Deno.pid,index,attempt,planHash}),{createNew:true});
await Deno.writeTextFile(`${directory}/start.json`,JSON.stringify({planHash,job,attempt,startedAt:new Date().toISOString(),runtime:Deno.version,budget},null,2),{createNew:true});
const command=["run","-A","tools/run.ts","--experiment",experiment,"--preset",job.preset,"--conditions",job.condition,"--seeds",String(job.seed),"--steps",String(job.steps),"--census","100","--deep","10","--checkpoint","0","--out",bundleRoot];
async function size(path:string):Promise<number>{let total=0;for await(const e of Deno.readDir(path)){const p=`${path}/${e.name}`;if(e.isDirectory)total+=await size(p);else if(e.isFile)total+=(await Deno.stat(p)).size;}return total;}
const storageStopBytes=plan.maxNewBytes-256*1024**2; // Leave headroom for writes between two-second checks.
const start=performance.now();
let detectedForeignWorkers:{pid:number;command:string}[]=[];
let failure:string|null=null,summary:any=null,exitCode:number|null=null,bundleManifestSha256:string|null=null;
let child:Deno.ChildProcess|undefined;
const maxSeconds=Math.min(budget.remainingSeconds,index===0?3600:budget.remainingSeconds);
try{
 if(await size("runs/foundations-next")>=storageStopBytes)throw new Error("new-output storage cap reached");
 child=new Deno.Command(Deno.execPath(),{args:command,stdout:"piped",stderr:"piped"}).spawn();
 const stdout=await Deno.open(`${directory}/stdout.log`,{write:true,createNew:true});
 const stderr=await Deno.open(`${directory}/stderr.log`,{write:true,createNew:true});
 const drains=Promise.all([child.stdout.pipeTo(stdout.writable),child.stderr.pipeTo(stderr.writable)]);
 let done=false;child.status.then(s=>{done=true;exitCode=s.code;});
 let lastNotice=0;
 while(!done){
  await Promise.race([child.status,new Promise(resolve=>setTimeout(resolve,2000))]);
  const elapsed=(performance.now()-start)/1000;
  if(!done){
   const currentBytes=await size("runs/foundations-next");
   detectedForeignWorkers=foreignGpuWorkers(await ps(),[Deno.pid,child.pid]);
   if(elapsed>=maxSeconds||currentBytes>=storageStopBytes||detectedForeignWorkers.length){
    failure=elapsed>=maxSeconds?"GPU wall-time cap":currentBytes>=storageStopBytes?"storage headroom stop":"external GPU worker appeared";child.kill("SIGTERM");break;
   }
  }
  if(elapsed-lastNotice>=60){console.log(JSON.stringify({index,attempt,elapsedSeconds:elapsed,bundle}));lastNotice=elapsed;}
 }
 await child.status;await drains;
 if(exitCode!==0)failure??=`run exited ${exitCode}`;
 if(!failure){
  await verify();
  const manifest=JSON.parse(await Deno.readTextFile(`${bundle}/manifest.json`));
  if(manifest.summary?.steps!==job.steps||manifest.summary?.conservationOk!==true||manifest.spec?.seed!==job.seed||manifest.spec?.condition!==job.condition||manifest.spec?.presetId!==job.preset)throw new Error("missing/invalid full-horizon bundle");
  summary=manifest.summary;bundleManifestSha256=await sha(await Deno.readFile(`${bundle}/manifest.json`));
 }
}catch(error){failure=String(error);if(child){try{child.kill("SIGTERM");}catch{/* already terminal */}await child.status;}}
const finalNewBytes=await size("runs/foundations-next");
if(finalNewBytes>=plan.maxNewBytes)failure??="new-output storage cap exceeded at completion";
const wallSeconds=(performance.now()-start)/1000;
if(wallSeconds>maxSeconds)failure??="attempt GPU wall-time cap exceeded";
if(wallSeconds>budget.remainingSeconds)failure??="cumulative GPU cap exceeded";
const receipt={format:"m4-development-pipeline-receipt/v1",planHash,index,attempt,job,bundle,command,terminal:true,status:failure?"incomplete":"completed",failure,detectedForeignWorkers,wallSeconds,maxSeconds,finalNewBytes,cumulativeGpuSeconds:14400-budget.remainingSeconds+wallSeconds,summary,exitCode,bundleManifestSha256};
await Deno.writeTextFile(`${directory}/receipt.json`,JSON.stringify(receipt,null,2)+"\n",{createNew:true});
await Deno.remove(lock);
console.log(JSON.stringify(receipt));
if(failure)Deno.exitCode=1;
