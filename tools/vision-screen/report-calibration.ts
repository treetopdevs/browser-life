/** Validate actual scored pixels and preserve even a failed vision gate. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { calibrationFixtures, rasterFrame, PROMPTS } from '../../apps/lab/src/vision-screen/core.ts';
const root=resolve(import.meta.dirname,'../..');
const hash=(data:string|Uint8Array)=>createHash('sha256').update(data).digest('hex');
const read=(path:string)=>readFileSync(resolve(root,path));
const fixtures=calibrationFixtures();
const raw=read('runs/vision-screen/calibration/scores.json');
const scores=JSON.parse(raw.toString());
const manifest=read('runs/vision-screen/calibration/manifest.json');
if(scores.schemaVersion!==1||JSON.stringify(scores.prompts)!==JSON.stringify(PROMPTS.map(p=>p.text))||scores.provenance.manifestSha256!==hash(manifest)||scores.provenance.scorerSourceSha256!==hash(read('tools/vision-screen/score.py')))throw Error('Scorer provenance mismatch');
if(!Array.isArray(scores.items)||scores.items.length!==fixtures.length+1)throw Error('Wrong scored matrix');
const expectedIds=[...fixtures.map(f=>f.id),'frozen-repeat'];
if(JSON.stringify(scores.items.map((r:any)=>r.id))!==JSON.stringify(expectedIds))throw Error('Scored IDs/order mismatch');
for(const row of scores.items){
  if(!Array.isArray(row.frames)||row.frames.length!==(row.id==='frozen-repeat'?2:1))throw Error('Wrong frame count');
  const fixture=row.id==='frozen-repeat'?fixtures.find(f=>f.count===120&&f.layout===0&&f.group==='12')!:fixtures.find(f=>f.id===row.id)!;
  for(const frame of row.frames){
    for(const key of ['targetCosine','oneCosine','uniformCosine','margin'])if(typeof frame[key]!=='number'||!Number.isFinite(frame[key]))throw Error('Invalid score');
    if(frame.sha256!==hash(rasterFrame(fixture.frame)))throw Error('Scored pixels do not match fixture');
    if(Math.abs(frame.margin-(frame.targetCosine-Math.max(frame.oneCosine,frame.uniformCosine)))>1e-12)throw Error('Incorrect margin');
  }
  const mean=row.frames.reduce((n:number,f:any)=>n+f.margin,0)/row.frames.length;
  const sd=Math.sqrt(row.frames.reduce((n:number,f:any)=>n+(f.margin-mean)**2,0)/row.frames.length);
  if(Math.abs(mean-row.meanMargin)>1e-12||Math.abs(sd-row.stdMargin)>1e-12)throw Error('Incorrect summary');
}
const byId=new Map<string,any>(scores.items.map((r:any)=>[r.id,r]));
const scoredFixtures=fixtures.map(f=>({...f,rgbSha256:hash(rasterFrame(f.frame)),scores:byId.get(f.id).frames[0]}));
const controls=scoredFixtures.filter(f=>f.group==='blank'||f.group==='one');
const comparisons=[];
for(const target of scoredFixtures.filter(f=>['6','12','seam6'].includes(f.group))){
 const negatives=[...scoredFixtures.filter(f=>f.count===target.count&&f.layout===target.layout&&['1','uniform'].includes(f.group)),...controls];
 for(const negative of negatives)comparisons.push({targetId:target.id,negativeId:negative.id,difference:target.scores.margin-negative.scores.margin,pass:target.scores.margin>negative.scores.margin});
}
const reference=byId.get('cal-120-layout0-12').frames[0];
const repeated=byId.get('frozen-repeat').frames;
const repeatMaxDifference=Math.max(...repeated.flatMap((f:any)=>['targetCosine','oneCosine','uniformCosine'].map(k=>Math.abs(f[k]-reference[k]))));
const passed=comparisons.every(c=>c.pass)&&repeatMaxDifference<=1e-6;
const artifact={schemaVersion:1,kind:'targeted-vision-calibration',status:passed?'calibration-passed':'stopped-calibration',reason:passed?'Calibration passed; candidate selection not yet run.':'Fixed judge/target calibration failed. No simulation selection or prompt tuning performed.',prompts:PROMPTS,sourceSha256:Object.fromEntries(['apps/lab/src/vision-screen/core.ts','tools/vision-screen/calibrate.ts','tools/vision-screen/score.py','tools/vision-screen/report-calibration.ts'].map(p=>[p,hash(read(p))])),runtime:{node:process.version,platform:process.platform,arch:process.arch},scoreFileSha256:hash(raw),provenance:scores.provenance,fixtures:scoredFixtures,comparisons,repeatFrames:repeated,repeatMaxDifference,searchRuns:[]};
const json=JSON.stringify(artifact,null,2)+'\n';
if(Buffer.byteLength(json)>32*1024*1024)throw Error('Artifact too large');
const dest=resolve(root,'docs/creative-prototypes/vision-calibration.json');
writeFileSync(dest+'.tmp',json);renameSync(dest+'.tmp',dest);
const failed=comparisons.filter(c=>!c.pass);
const report=`# Targeted vision calibration\n\nStatus: **${artifact.status}**. ${artifact.reason}\n\nActual local CLIP ViT-B/32 inference on 54 fixed layouts, blank and one-dot controls, plus two duplicate frames. ${comparisons.length-failed.length}/${comparisons.length} required ordering comparisons pass. Duplicate-frame maximum cosine difference: ${repeatMaxDifference}.\n\nThese are image/text resemblance scores, not motion recognition or proof of evolution. All failed comparisons and exact pixel inputs are retained in [the artifact](vision-calibration.json). The local model revision and file hashes are recorded there.\n\n| Target | Negative | Margin difference |\n|---|---|---:|\n${failed.map(c=>`| ${c.targetId} | ${c.negativeId} | ${c.difference.toFixed(6)} |`).join('\n')}\n`;
writeFileSync(resolve(root,'docs/creative-prototypes/vision-calibration.md'),report);
console.log(`${artifact.status}: ${comparisons.length-failed.length}/${comparisons.length} required comparisons; repeat difference ${repeatMaxDifference}`);
