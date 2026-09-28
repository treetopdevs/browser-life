export const PIPELINE_CONDITIONS=["treatment","neutral","no-mutation"] as const;
export function pipelineJobs(){return ["gradient-m3","spots-m3"].flatMap(preset=>PIPELINE_CONDITIONS.flatMap(condition=>[650000001,650000002].map(seed=>({preset,condition,seed,steps:1000000,censusEvery:100,deepEvery:10})))).map((job,index)=>({index,...job}));}
export function pipelineBudget(priorSeconds:number,benchmarkSeconds:number|null,completedCount:number){
 if(!Number.isFinite(priorSeconds)||priorSeconds<0||!Number.isInteger(completedCount)||completedCount<0||completedCount>12||benchmarkSeconds!==null&&(!Number.isFinite(benchmarkSeconds)||benchmarkSeconds<=0)||completedCount>0&&benchmarkSeconds===null)throw new Error("invalid budget evidence");
 const remainingSeconds=Math.max(0,14400-priorSeconds),projectedRemainingSeconds=benchmarkSeconds===null?null:(12-completedCount)*benchmarkSeconds;
 return {remainingSeconds,projectedRemainingSeconds,forecastSeconds:projectedRemainingSeconds===null?null:priorSeconds+projectedRemainingSeconds,affordable:remainingSeconds>0&&(projectedRemainingSeconds===null||projectedRemainingSeconds<=remainingSeconds)};
}
export function validatePipelineReceipt(r:any,directory:string,root:string,planHash:string){
 const m=/^job-(\d+)-attempt-(\d+)$/.exec(directory);
 if(!m)throw new Error("invalid receipt directory");
 const index=Number(m[1]),attempt=Number(m[2]),job=pipelineJobs()[index];
 const bundle=`${root}/${directory}/bundles/m4-growth-development-v1/${job?.preset}/${job?.condition}/seed-${job?.seed}`;
 if(!job||r.format!=="m4-development-pipeline-receipt/v1"||r.planHash!==planHash||r.index!==index||r.attempt!==attempt||attempt<1||attempt>3||JSON.stringify(r.job)!==JSON.stringify(job)||r.bundle!==bundle||!Number.isFinite(r.wallSeconds)||r.wallSeconds<0||r.terminal!==true||!["completed","incomplete"].includes(r.status))throw new Error("misbound or invalid pipeline receipt");
 if(!Number.isFinite(r.maxSeconds)||r.maxSeconds<=0||r.maxSeconds>14400||index===0&&r.maxSeconds>3600)throw new Error("invalid attempt cap");
 if(r.status==="completed"&&(r.wallSeconds>r.maxSeconds||r.exitCode!==0||r.failure!==null||r.summary?.steps!==1000000||r.summary?.conservationOk!==true||typeof r.bundleManifestSha256!=="string"))throw new Error("invalid completed receipt");
 if(r.status==="incomplete"&&(typeof r.failure!=="string"||!r.failure))throw new Error("incomplete receipt lacks reason");
 return {index,attempt,job,bundle};
}
export function foreignGpuWorkers(ps:string,ownedPids:number[]){
 return ps.split("\n").flatMap(line=>{const m=/^\s*(\d+)\s+(.+)$/.exec(line);if(!m)return[];const pid=Number(m[1]),command=m[2];
  if(ownedPids.includes(pid)||!/^(?:[^\s]*\/)?deno\s+run(?:\s|$)/.test(command))return[];
  const executes=/(?:^|\s)--execute(?:\s|$)/.test(command)||/tools\/foundation-role-cohort\.ts/.test(command)&&/(?:^|\s)--smoke(?:\s|$)/.test(command);
  if(/tools\/foundation-(?:role-cohort|copy-(?:ancestry|diagnostic)|serial-(?:transfer[^ /]*|v2-continuation))\.ts/.test(command)&&!executes)return[];
  return /tools\/(?:run\.ts|assay\.ts|foundation-(?:role-cohort|copy-(?:ancestry|diagnostic)|serial-(?:transfer[^ /]*|v2-continuation)|competition|validation)\.ts)/.test(command)&&!command.includes(" --analyze ")&&!command.includes(" --plan-only ")?[{pid,command}]:[];
 });
}

/** Normalize receipt order and rebuild its global budget, never trusting claimed cumulative fields. */
export function validatePipelineReceiptSequence(receipts:any[]){
 const ordered=receipts.sort((a,b)=>a.index-b.index||a.attempt-b.attempt);
 const prior:any[]=[];
 for(const r of ordered){
  const sameJob=prior.filter(p=>p.index===r.index);
  if(r.attempt!==sameJob.length+1||sameJob.some(p=>p.status==="completed")||pipelineJobs().slice(0,r.index).some(j=>!prior.some(p=>p.index===j.index&&p.status==="completed")))throw new Error("invalid global attempt order");
  const complete=prior.filter(p=>p.status==="completed"),cost=prior.reduce((s,p)=>s+p.wallSeconds,0);
  const budget=pipelineBudget(cost,complete.find(p=>p.index===0)?.wallSeconds??null,complete.length);
  const expectedCap=Math.min(budget.remainingSeconds,r.index===0?3600:budget.remainingSeconds);
  if(!budget.affordable||r.maxSeconds!==expectedCap)throw new Error("receipt attempt cap differs from prior budget");
  prior.push(r);
 }
 return ordered;
}

/** Admit the one preserved incomplete attempt across a reviewed guard-only revision. */
export async function admitPipelineReceipt(plan:any,planHash:string,directory:string,r:any,read:(path:string)=>Promise<Uint8Array>){
 const root=plan.outputRoot;
 if(r.planHash===planHash)return validatePipelineReceipt(r,directory,root,planHash);
 const recovery=plan.priorIncompleteReceipt;
 const path=`${root}/${directory}/receipt.json`;
 if(!recovery||path!==recovery.receiptPath||r.status!=="incomplete"||r.planHash!==recovery.planSha256)throw new Error("unapproved prior-plan receipt");
 const digest=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",b as BufferSource)),v=>v.toString(16).padStart(2,"0")).join("");
 const oldBytes=await read(recovery.planPath),receiptBytes=await read(path);
 if(await digest(oldBytes)!==recovery.planSha256||await digest(receiptBytes)!==recovery.receiptSha256)throw new Error("prior attempt evidence drift");
 const old=JSON.parse(new TextDecoder().decode(oldBytes));
 if(JSON.stringify(JSON.parse(new TextDecoder().decode(receiptBytes)))!==JSON.stringify(r))throw new Error("prior receipt changed while loading");
 for(const key of ["format","jobs","outputRoot","maxGpuSeconds","maxNewBytes","seedAudit"])if(JSON.stringify(old[key])!==JSON.stringify(plan[key]))throw new Error("technical recovery changed scientific inputs or limits");
 const allowed=new Set(["tools/m4-growth-pilot.ts","tools/lib/m4-pipeline.ts","docs/m4-growth-pipeline.md"]);
 if(JSON.stringify(Object.keys(old.sourceHashes).sort())!==JSON.stringify(Object.keys(plan.sourceHashes).sort()))throw new Error("technical recovery changed source closure");
 for(const [p,h]of Object.entries(old.sourceHashes))if(!allowed.has(p)&&plan.sourceHashes[p]!==h)throw new Error(`technical recovery changed scientific source ${p}`);
 return validatePipelineReceipt(r,directory,root,recovery.planSha256);
}
