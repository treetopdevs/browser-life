// Analyze a complete fixed development matrix directly from immutable attempt bundles.
// deno run -A tools/analyze-m4-pipeline.ts --plan <pipeline plan> --analysis-sources <source freeze> --out <new report>
import {parseArgs} from "jsr:@std/cli@1/parse-args";
import {loadRun,ensembleProblems,provenanceProblems} from "./lib/bundle.ts";
import {pipelineJobs,admitPipelineReceipt,validatePipelineReceiptSequence} from "./lib/m4-pipeline.ts";
import {analyzeGrowthRuns} from "./lib/m4-growth-runs.ts";
const a=parseArgs(Deno.args,{string:["plan","analysis-sources","out"]});
if(!a.plan||!a["analysis-sources"]||!a.out)throw new Error("--plan, --analysis-sources and --out required");
const sha=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",b as BufferSource)),v=>v.toString(16).padStart(2,"0")).join("");
const sourceRecordPath=a["analysis-sources"];
const sourcePaths=["tools/analyze-m4-pipeline.ts","tools/lib/m4-growth-runs.ts","tools/lib/m4-growth.ts","experiments/amendments/m4-growth-v1.ts"];
const sourceBytes=await Deno.readFile(sourceRecordPath),sourceRecord=JSON.parse(new TextDecoder().decode(sourceBytes)),analysisSourceRecordSha256=await sha(sourceBytes);
if(sourceRecord.format!=="m4-pipeline-analysis-source/v1"||sourceRecord.status!=="before-development-outcomes"||JSON.stringify(Object.keys(sourceRecord.sources??{}).sort())!==JSON.stringify([...sourcePaths].sort()))throw new Error("invalid analysis source freeze");
const verifyAnalysis=async()=>{if(await sha(await Deno.readFile(sourceRecordPath))!==analysisSourceRecordSha256)throw new Error("analysis source record drift");for(const path of sourcePaths)if(await sha(await Deno.readFile(path))!==sourceRecord.sources[path])throw new Error(`analysis source drift ${path}`);};
await verifyAnalysis();
const bytes=await Deno.readFile(a.plan),plan=JSON.parse(new TextDecoder().decode(bytes)),planHash=await sha(bytes);
if(plan.format!=="m4-development-pipeline/v1"||JSON.stringify(plan.jobs)!==JSON.stringify(pipelineJobs()))throw new Error("invalid fixed development matrix");
for(const [path,hash]of Object.entries(plan.sourceHashes))if(await sha(await Deno.readFile(path))!==hash)throw new Error(`source drift ${path}`);
if(await sha(await Deno.readFile(plan.seedAudit.path))!==plan.seedAudit.sha256)throw new Error("seed audit drift");
const receipts:any[]=[];
for await(const e of Deno.readDir(plan.outputRoot))if(e.isDirectory&&/^job-\d+-attempt-\d+$/.test(e.name)){
 const r=JSON.parse(await Deno.readTextFile(`${plan.outputRoot}/${e.name}/receipt.json`));
 await admitPipelineReceipt(plan,planHash,e.name,r,p=>Deno.readFile(p));receipts.push(r);
}
validatePipelineReceiptSequence(receipts);
const runs=[];
for(const job of pipelineJobs()){
 const attempts=receipts.filter(r=>r.index===job.index).sort((a,b)=>a.attempt-b.attempt);
 if(attempts.some((r,i)=>r.attempt!==i+1||r.status==="completed"&&i!==attempts.length-1)||attempts.at(-1)?.status!=="completed")throw new Error(`incomplete or invalid attempt sequence for job ${job.index}`);
 const r=attempts.at(-1)!;
 if(await sha(await Deno.readFile(`${r.bundle}/manifest.json`))!==r.bundleManifestSha256)throw new Error("bundle manifest drift");
 const run=await loadRun(r.bundle,job.condition,job.seed);
 if(!run||JSON.stringify(run.manifest.summary)!==JSON.stringify(r.summary)||ensembleProblems([run]).length||provenanceProblems([run],job.preset).length)throw new Error("invalid completed bundle");
 runs.push(run);
}
const reports=[];
for(const preset of ["gradient-m3","spots-m3"])reports.push(await analyzeGrowthRuns(runs.filter(r=>r.manifest.spec.presetId===preset),[650000001,650000002],{kind:"real"}));
await verifyAnalysis();
const analysisSourceHashes=sourceRecord.sources;
const report={format:"m4-development-pipeline-analysis/v1",purpose:"development-only",planHash,analysisSourceRecordSha256,analysisSourceHashes,totalAttemptWallSeconds:receipts.reduce((s,r)=>s+r.wallSeconds,0),histories:runs.length,reports,m4:"not-evaluated",limitation:"Two seeds per preset rehearse execution; they do not establish power or confirm M4."};
await Deno.writeTextFile(a.out,JSON.stringify(report,null,2)+"\n",{createNew:true});
console.log(JSON.stringify({histories:runs.length,m4:report.m4,out:a.out}));
