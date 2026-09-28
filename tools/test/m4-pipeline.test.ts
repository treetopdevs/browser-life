import{expect,it}from"vitest";
import{pipelineJobs,pipelineBudget,foreignGpuWorkers,validatePipelineReceipt,validatePipelineReceiptSequence,admitPipelineReceipt}from"../lib/m4-pipeline.ts";
it("fixes twelve development histories and treats benchmark as a budget gate",()=>{const jobs=pipelineJobs();expect(jobs).toHaveLength(12);expect(new Set(jobs.map(j=>`${j.preset}:${j.condition}:${j.seed}`)).size).toBe(12);expect(pipelineBudget(100,1000,1).affordable).toBe(true);expect(pipelineBudget(100,1400,1).affordable).toBe(false);expect(pipelineBudget(14400,1000,1).remainingSeconds).toBe(0);});
it("excludes owned processes and CPU calibration but detects unrelated GPU runs",()=>{const ps="11 deno run -A tools/assay.ts retest\n12 /opt/homebrew/bin/deno run -A tools/run.ts --seed 1\n13 deno run -A tools/m4-growth-calibration.ts\n14 zsh -lc echo tools/run.ts";expect(foreignGpuWorkers(ps,[12]).map(p=>p.pid)).toEqual([11]);});

it("charges previous failed attempts when forecasting remaining histories",()=>{expect(pipelineBudget(2000,1200,1).affordable).toBe(false);expect(pipelineBudget(12000,1000,10).affordable).toBe(true);});
it("binds receipts to directory, planned input and bundle before fixed-order admission",()=>{const job=pipelineJobs()[0],root="out",directory="job-0-attempt-1";const r={format:"m4-development-pipeline-receipt/v1",planHash:"hash",index:0,attempt:1,job,bundle:`out/${directory}/bundles/m4-growth-development-v1/gradient-m3/treatment/seed-650000001`,wallSeconds:1000,maxSeconds:3600,terminal:true,status:"completed",exitCode:0,failure:null,summary:{steps:1000000,conservationOk:true},bundleManifestSha256:"digest"};expect(validatePipelineReceipt(r,directory,root,"hash").index).toBe(0);for(const patch of [{maxSeconds:0},{maxSeconds:999},{index:1},{attempt:2},{job:{...job,seed:1}},{bundle:"wrong"},{summary:{steps:10,conservationOk:true}},{bundleManifestSha256:null}])expect(()=>validatePipelineReceipt({...r,...patch},directory,root,"hash")).toThrow();});

it("reconstructs attempt caps from ordered prior costs including failed attempts",()=>{
 const first={index:0,attempt:1,status:"completed",wallSeconds:1000,maxSeconds:3600};
 const failed={index:1,attempt:1,status:"incomplete",wallSeconds:100,maxSeconds:13400};
 const retry={index:1,attempt:2,status:"completed",wallSeconds:1000,maxSeconds:13300};
 expect(validatePipelineReceiptSequence([retry,first,failed])).toHaveLength(3);
 expect(()=>validatePipelineReceiptSequence([first,failed,{...retry,maxSeconds:13400}])).toThrow();
 expect(()=>validatePipelineReceiptSequence([first,{...failed,index:2}])).toThrow();
 expect(()=>validatePipelineReceiptSequence([first,{...first,attempt:2}])).toThrow();
});

it("ignores type checks, planner invocations and shells while detecting executing assays",()=>{
 const ps=["21 deno check tools/foundation-serial-transfer-v2.ts","22 deno run -A tools/foundation-serial-transfer-v2.ts --out plan --max-seconds 600","23 deno run -A tools/foundation-serial-transfer-v2.ts --execute --out plan","24 /bin/zsh -c /opt/homebrew/bin/deno run -A tools/run.ts","25 deno run -A tools/foundation-copy-diagnostic.ts --execute --out plan","26 deno run -A tools/foundation-serial-v2-continuation.ts --execute --out plan","27 deno run -A tools/foundation-role-cohort.ts --smoke --plan plan"].join("\n");
 expect(foreignGpuWorkers(ps,[]).map(p=>p.pid)).toEqual([23,25,26,27]);
});
it("admits only the hash-bound incomplete receipt across guard-only revisions",async()=>{
 const encode=(x:any)=>new TextEncoder().encode(JSON.stringify(x));
 const hash=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",b as BufferSource)),v=>v.toString(16).padStart(2,"0")).join("");
 const job=pipelineJobs()[0],directory="job-0-attempt-1",root="out";
 const old={format:"m4-development-pipeline/v1",jobs:pipelineJobs(),outputRoot:root,maxGpuSeconds:14400,maxNewBytes:10*1024**3,seedAudit:{path:"audit",sha256:"same"},sourceHashes:{"tools/lib/m4-pipeline.ts":"old-guard","packages/sim-ref/src/step.ts":"same-physics"}};
 const oldBytes=encode(old),oldHash=await hash(oldBytes);
 const r={format:"m4-development-pipeline-receipt/v1",planHash:oldHash,index:0,attempt:1,job,bundle:`out/${directory}/bundles/m4-growth-development-v1/gradient-m3/treatment/seed-650000001`,wallSeconds:178,maxSeconds:3600,terminal:true,status:"incomplete",failure:"external match",exitCode:143};
 const receiptBytes=encode(r),path=`out/${directory}/receipt.json`;
 const plan={...old,sourceHashes:{...old.sourceHashes,"tools/lib/m4-pipeline.ts":"new-guard"},priorIncompleteReceipt:{planPath:"old.json",planSha256:oldHash,receiptPath:path,receiptSha256:await hash(receiptBytes)}};
 const read=async(p:string)=>p==="old.json"?oldBytes:receiptBytes;
 expect((await admitPipelineReceipt(plan,"new",directory,r,read)).index).toBe(0);
 await expect(admitPipelineReceipt({...plan,sourceHashes:{...plan.sourceHashes,"packages/sim-ref/src/step.ts":"changed"}},"new",directory,r,read)).rejects.toThrow("scientific source");
 await expect(admitPipelineReceipt({...plan,priorIncompleteReceipt:{...plan.priorIncompleteReceipt,receiptSha256:"wrong"}},"new",directory,r,read)).rejects.toThrow("evidence drift");
 await expect(admitPipelineReceipt(plan,"new",directory,{...r,status:"completed"},read)).rejects.toThrow("unapproved");
 await expect(admitPipelineReceipt({...plan,jobs:[]},"new",directory,r,read)).rejects.toThrow("scientific inputs");
});
