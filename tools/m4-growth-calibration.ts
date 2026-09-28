// Stream existing null-generator histories through the production amendment path.
// --manifest <frozen JSON> --out <new directory>; output is append-only per trial.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { trialKey, validateTrialPrefix, validateResumeReport } from "./lib/m4-calibration-checkpoint.ts";
import { binomialLowerBound } from "@bl/metrics";
import { analyzeGrowthRuns } from "./lib/m4-growth-runs.ts";
import { makeSpec, buildManifest, runNullGenerator, boundedTreatmentVsFlat, NULL_GENERATOR_IDS, type Identity, type NullGeneratorId } from "./lib/nullgen.ts";
import { GROWTH_SCENARIOS, growthGenerator, type GrowthScenario } from "./lib/m4-growth-generators.ts";
import type { Run } from "./lib/bundle.ts";
import { M4_GROWTH_V1 as C } from "../experiments/amendments/m4-growth-v1.ts";
const args=parseArgs(Deno.args,{string:["manifest","out","max-trials"],boolean:["resume"]});
const maxTrials=args["max-trials"]===undefined?Infinity:Number(args["max-trials"]);
if(maxTrials!==Infinity&&(!Number.isSafeInteger(maxTrials)||maxTrials<1))throw new Error("--max-trials must be a positive integer");
if(!args.manifest||!args.out) throw new Error("--manifest and --out required");
const manifestText=await Deno.readTextFile(args.manifest);
const m=JSON.parse(manifestText);
const allScenarios=[...NULL_GENERATOR_IDS,"boundedTreatmentVsFlat",...GROWTH_SCENARIOS];
if(!["development","validation"].includes(m.phase)||!Number.isInteger(m.trials)||m.trials<1||m.trials>500||m.pairs!==C.candidatePairs||!Number.isInteger(m.masterSeed)||!Number.isFinite(m.capSeconds)||m.capSeconds<=0||m.capSeconds>28800)throw new Error("invalid calibration manifest");
if(!Array.isArray(m.strata)||m.strata.length<1||m.strata.length>10||new Set(m.strata.map((x:any)=>`${x.scenario}:${x.preset}`)).size!==m.strata.length||m.strata.some((x:any)=>!allScenarios.includes(x.scenario)||!C.presets.includes(x.preset)))throw new Error("invalid strata");
if(m.masterSeed!==(m.phase==="development"?C.syntheticDevelopmentMaster:C.syntheticValidationMaster))throw new Error("wrong phase master seed");
const validationScenarios=["pairedEndpoint1Null","boundaryRareNegative","extinctionBoundary","meanAlternative","longPeriodLoop"];
const requiredStrata=validationScenarios.flatMap(scenario=>C.presets.map(preset=>`${scenario}:${preset}`)).sort();
const acceptance={nullOneSided95UpperMax:0.025,nominalPerPresetAlpha:0.005,alternativeOneSided95PowerLowerMin:0.8,alternativeMeanConfidenceMarginMax:2,unavailable:"Report separately and include as non-support in unconditional procedure operating characteristics; never claim available inference for them."};
if(m.phase==="validation"&&(m.trials!==200||JSON.stringify(m.strata.map((x:any)=>`${x.scenario}:${x.preset}`).sort())!==JSON.stringify(requiredStrata)||!m.acceptance||Object.entries(acceptance).some(([key,value])=>m.acceptance[key]!==value)||Object.keys(m.acceptance).length!==Object.keys(acceptance).length))throw new Error("validation must match all ten frozen strata, 200 trials, and exact acceptance policy");
const requiredSources=["tools/lib/m4-calibration-checkpoint.ts","tools/m4-growth-calibration.ts","tools/lib/m4-growth-generators.ts","tools/lib/m4-growth-runs.ts","tools/lib/m4-growth.ts","tools/lib/nullgen.ts","tools/lib/idhash.ts","tools/lib/bundle.ts","tools/lib/threshold.ts","experiments/amendments/m4-growth-v1.ts","experiments/endpoints.ts","deno.json","deno.lock"];
for(const dir of ["packages/schema/src","packages/runner/src","packages/metrics/src"]){
  for await(const entry of Deno.readDir(dir)) if(entry.isFile&&entry.name.endsWith(".ts")) requiredSources.push(`${dir}/${entry.name}`);
}
if(!m.sourceHashes||requiredSources.some(p=>typeof m.sourceHashes[p]!=="string"))throw new Error("canonical complete source hashes required");
const sha=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes as BufferSource)),x=>x.toString(16).padStart(2,"0")).join("");
const verifySources=async()=>{for(const [path,expected] of Object.entries(m.sourceHashes))if(await sha(await Deno.readFile(path))!==expected)throw new Error(`source drift: ${path}`);};
await verifySources();
const manifestHash=await sha(new TextEncoder().encode(manifestText));
let attempt=1,priorWallSeconds=0;
let completedRows:any[]=[];
const logPath=`${args.out}/trials.jsonl`;
if(args.resume){
  if(await Deno.readTextFile(`${args.out}/manifest.json`)!==manifestText)throw new Error("resume manifest bytes changed");
  const reports:number[]=[];
  for await(const entry of Deno.readDir(args.out)){const match=/^attempt-(\d+)\.json$/.exec(entry.name);if(match)reports.push(Number(match[1]));}
  reports.sort((a,b)=>a-b);
  if(!reports.length||reports.some((n,i)=>n!==i+1))throw new Error("resume requires contiguous terminal attempt records");
  const log=await Deno.readTextFile(logPath);
  if(log&&!log.endsWith("\n"))throw new Error("partial trial log; refuse unauthenticated recovery");
  completedRows=log.split("\n").filter(Boolean).map(line=>JSON.parse(line));
  const previous=JSON.parse(await Deno.readTextFile(`${args.out}/attempt-${reports.at(-1)}.json`));
  if(previous.attempt!==reports.length)throw new Error("attempt identity mismatch");
  priorWallSeconds=validateResumeReport(previous,manifestHash,await sha(new TextEncoder().encode(log)),m.capSeconds);
  attempt=reports.length+1;
}else{
  await Deno.mkdir(args.out);
  await Deno.writeTextFile(`${args.out}/manifest.json`,manifestText,{createNew:true});
  await Deno.writeTextFile(logPath,"",{createNew:true});
}
const prior=validateTrialPrefix(completedRows,m,manifestHash);
const lockPath=`${args.out}/writer.lock`;
await Deno.writeTextFile(lockPath,JSON.stringify({pid:Deno.pid,attempt,manifestHash}),{createNew:true});
await Deno.writeTextFile(`${args.out}/runtime-${attempt}.json`,JSON.stringify({deno:Deno.version,build:Deno.build,startedAt:new Date().toISOString(),attempt,priorWallSeconds},null,2)+"\n",{createNew:true});
const start=performance.now();
const elapsed=()=>priorWallSeconds+(performance.now()-start)/1000;
let newTrials=0;
const results:any[]=[];
let stopped=false;
let failure:string|null=null;
try {
for(const stratum of m.strata){
  const tally={...stratum,n:0,supported:0,endpoint1Supported:0,jointSupported:0,unavailable:0,wallSeconds:0,means:[] as number[],margins:[] as number[]};
  for(let trial=0;trial<m.trials;trial++){
    let row=prior.get(trialKey({...stratum,trial}));
    if(!row){
    if(elapsed()>=m.capSeconds||newTrials>=maxTrials){stopped=true;break;}
    await verifySources();
    const begun=performance.now();
    const seeds=Array.from({length:m.pairs},(_,i)=>900000000+i);
    async function* generated():AsyncGenerator<Run>{
      for(const condition of C.conditions)for(let seedIndex=0;seedIndex<seeds.length;seedIndex++){
        const id:Identity={masterSeed:m.masterSeed,nullId:`${stratum.scenario}:${stratum.preset}`,windowSteps:C.horizon,replicateIndex:trial,condition,seedIndex};
        const spec={...makeSpec(`m4-${m.phase}`,condition,seeds[seedIndex],C.horizon,C.censusEvery,C.deepEvery),presetId:stratum.preset};
        if(elapsed()>=m.capSeconds) throw new Error("CPU budget exhausted inside trial; preserve manifest and partial outputs");
        if((GROWTH_SCENARIOS as readonly string[]).includes(stratum.scenario)) { yield growthGenerator(stratum.scenario as GrowthScenario,id,spec); continue; }
        const bundle=stratum.scenario==="boundedTreatmentVsFlat"?boundedTreatmentVsFlat(id,spec):runNullGenerator(stratum.scenario as NullGeneratorId,id,spec);
        const lineages=new Map<number,[string,number][]>();
        for(const row of bundle.lineages){let rows=lineages.get(row.step);if(!rows){rows=[];lineages.set(row.step,rows);}rows.push([row.key,row.cells]);}
        yield{condition,seed:seeds[seedIndex],dir:"synthetic",series:bundle.series, lineages,manifest:buildManifest(spec,stratum.scenario,C.horizon,trial,{...bundle.generatorParams,masterSeed:m.masterSeed,seedIndex,preset:stratum.preset})};
      }
    }
    const report=await analyzeGrowthRuns(generated(),seeds,{kind:"synthetic",generatorIdentity:`${m.phase}:${m.masterSeed}:${stratum.scenario}:${stratum.preset}:${trial}`});
    await verifySources();
    const wallSeconds=(performance.now()-begun)/1000;
    row={...stratum,trial,manifestHash,identity:report.provenance,endpoint2:report.endpoint2,endpoint1:report.endpoint1,endpoint1Method:report.endpoint1Method,jointPerPresetObserved:report.jointPerPresetObserved,threshold:report.threshold.threshold,wallSeconds};
    await Deno.writeTextFile(logPath,JSON.stringify(row)+"\n",{append:true});
    newTrials++;
    console.log(JSON.stringify({scenario:stratum.scenario,preset:stratum.preset,trial,wallSeconds,supported:report.endpoint2.supported,status:report.endpoint2.status}));
    }
    const report=row; const wallSeconds=row.wallSeconds;
    tally.endpoint1Supported+=Number(report.endpoint1.complete&&report.endpoint1.rows.every((row:any)=>row.supported));tally.jointSupported+=Number(report.jointPerPresetObserved);
    tally.n++;tally.wallSeconds+=wallSeconds;tally.supported+=Number(report.endpoint2.supported);tally.unavailable+=Number(report.endpoint2.status!=="ok");tally.means.push(report.endpoint2.mean);
    if(report.endpoint2.lowerBound!==null)tally.margins.push(report.endpoint2.mean-report.endpoint2.lowerBound);
  }
  const n=tally.n,k=tally.supported;
  const lower95=n?binomialLowerBound(k,n,.05):null,upper95=n?1-binomialLowerBound(n-k,n,.05):null;
  const endpoint1Upper95=n?1-binomialLowerBound(n-tally.endpoint1Supported,n,.05):null;
  const meanMargin=tally.margins.length?tally.margins.reduce((a:number,b:number)=>a+b,0)/tally.margins.length:null;
  const alternative=["boundedTreatmentVsFlat","meanAlternative"].includes(stratum.scenario);
  const endpoint1Null=["pairedEndpoint1Null","longPeriodLoop"].includes(stratum.scenario);
  const decision=m.phase!=="validation"||n!==m.trials?null:
    (alternative?lower95!==null&&lower95>acceptance.alternativeOneSided95PowerLowerMin&&meanMargin!==null&&meanMargin<=acceptance.alternativeMeanConfidenceMarginMax:upper95!==null&&upper95<=acceptance.nullOneSided95UpperMax)&&
    (!endpoint1Null||endpoint1Upper95!==null&&endpoint1Upper95<=acceptance.nullOneSided95UpperMax);
  results.push({...tally,lower95,upper95,endpoint1Upper95,meanMargin,endpoint1Interpretation:endpoint1Null?"null-size":"alternative diagnostic; not a size estimate",interpretation:alternative?"real-bounded-alternative":"null-size",acceptancePass:decision,complete:n===m.trials});
  if(stopped)break;
}
} catch(error) { stopped=true;failure=String(error);console.error(failure); }
if(elapsed()>m.capSeconds){stopped=true;failure??="CPU wall-time cap exceeded";}
const trialLogSha256=await sha(await Deno.readFile(logPath));
const finalReport={phase:m.phase,attempt,terminal:true,newTrials,retainedTrials:prior.size,trialLogSha256,acceptance:m.phase==="validation"?acceptance:null,calibrationPass:m.phase==="validation"?(!stopped&&results.length===requiredStrata.length&&results.every(x=>x.acceptancePass===true)):null,manifestHash,wallSeconds:(performance.now()-start)/1000,cumulativeWallSeconds:elapsed(),stopped,failure,complete:!stopped&&results.length===m.strata.length&&results.every(x=>x.complete),results,scope:"activity construction and original endpoint1 plus amended endpoint2; synthetic calibration is not milestone confirmation"};
await Deno.writeTextFile(`${args.out}/attempt-${attempt}.json`,JSON.stringify(finalReport,null,2)+"\n",{createNew:true});
await Deno.writeTextFile(`${args.out}/${attempt===1?"report.json":`report-resume-${attempt}.json`}`,JSON.stringify(finalReport,null,2)+"\n",{createNew:true});
await Deno.remove(lockPath);
if(failure) Deno.exitCode=1;
