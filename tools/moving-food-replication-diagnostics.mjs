/** Saved-evidence only: no world construction or simulation. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const PLAN_SHA256='72f651acc7f221991b0ce89f7264eed9dd47df54e955d3d164406b4d0a17cc47';
const sha256=x=>createHash('sha256').update(x).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function overlap(a,b){const A=new Set(a.cells.map(c=>c[0])),B=new Set(b.cells.map(c=>c[0]));const shared=[...A].filter(t=>B.has(t)).length;return {occupiedA:A.size,occupiedB:B.size,sharedTiles:shared,unionTiles:A.size+B.size-shared,jaccard:shared/(A.size+B.size-shared||1)};}
function jsonFile(path,label){const raw=readFileSync(path);let value;try{value=JSON.parse(raw.toString('utf8'));}catch{throw new Error(`${label} is not valid JSON`);}return {raw,value};}
function requireCommittedReceipt(root,path,raw){
  let committed;try{committed=execFileSync('git',['show',`HEAD:${relative(root,path)}`],{cwd:root,stdio:['ignore','pipe','ignore']});}
  catch{throw new Error('Visual receipt must already be committed unchanged');}
  if(!Buffer.from(raw).equals(committed))throw new Error('Visual receipt must already be committed unchanged');
}
function validateReceipt(receipt,seed,index){
  const allowed=['seed','uniformArtifactSha256','movingBandArtifactSha256','visualComparisons','lateWithinMoving','visualReviewedBeforeOverlapDiagnostics','reviewedAtUTC'];
  if(!receipt||Object.keys(receipt).some(key=>!allowed.includes(key))||receipt.seed!==seed||
    receipt.uniformArtifactSha256!==index.arms.uniform.rawSha256||receipt.movingBandArtifactSha256!==index.arms.movingBand.rawSha256||
    receipt.visualReviewedBeforeOverlapDiagnostics!==true||
    (receipt.reviewedAtUTC!==undefined&&typeof receipt.reviewedAtUTC!=='string')||
    !Array.isArray(receipt.visualComparisons)||!same(receipt.visualComparisons.map(x=>x?.tick),[1500,2500,3000])||
    receipt.visualComparisons.some(x=>typeof x.pass!=='boolean'||typeof x.observation!=='string'||!x.observation.trim())||
    !receipt.lateWithinMoving||receipt.lateWithinMoving.from!==2500||receipt.lateWithinMoving.to!==3000||
    typeof receipt.lateWithinMoving.pass!=='boolean'||typeof receipt.lateWithinMoving.observation!=='string'||!receipt.lateWithinMoving.observation.trim()){
    throw new Error('Visual receipt identity or observations mismatch');
  }
}
function validateIndex(index,seed,arms,receiptSha){
  const receiptUrl=`moving-food-replication-visual-receipt-${seed}.json`;
  if(!index||index.schemaVersion!==1||index.kind!=='hungry-shapes-moving-food-pair'||index.seed!==seed||index.planSha256!==PLAN_SHA256||
    Object.keys(index).sort().join('|')!=='arms|decision|kind|planSha256|schemaVersion|seed'||
    !index.arms||Object.keys(index.arms).sort().join('|')!=='movingBand|uniform')throw new Error('Replication pair manifest identity mismatch');
  const expected=[['uniform',index.arms.uniform,'uniform'],['movingBand',index.arms.movingBand,'moving-band']];
  for(const [key,entry,mode] of expected){
    const bytes=arms[key];const file=`moving-food-replication-${mode}-seed-${seed}.json`;
    if(!entry||entry.mode!==mode||entry.url!==file||entry.rawSha256!==sha256(bytes))throw new Error(`${mode} pair-manifest binding mismatch`);
    const data=JSON.parse(bytes.toString('utf8'));
    if(data.run?.seed!==seed||data.run?.mode!==mode||data.provenance?.planSha256!==PLAN_SHA256)throw new Error(`${mode} arm seed, mode, or plan binding mismatch`);
  }
  const decision=index.decision;
  const allowedDecisionKeys=['status','title','summary','uniformArtifactSha256','movingBandArtifactSha256','visualReceiptUrl','visualReceiptSha256'];
  if(!decision||Object.keys(decision).some(key=>!allowedDecisionKeys.includes(key))||!['promising','stop'].includes(decision.status)||
    typeof decision.summary!=='string'||!decision.summary.trim()||decision.uniformArtifactSha256!==index.arms.uniform.rawSha256||
    decision.movingBandArtifactSha256!==index.arms.movingBand.rawSha256||decision.visualReceiptUrl!==receiptUrl||decision.visualReceiptSha256!==receiptSha){
    throw new Error('Pair decision must bind both arms and the canonical committed visual receipt');
  }
  return receiptUrl;
}
export function diagnostics(seed,root=ROOT){
  if(![1202,1203].includes(seed))throw new Error('Explicit replication seed1202 or1203 required');
  const docs=resolve(root,'docs/creative-prototypes');
  const indexPath=resolve(docs,`moving-food-replication-index-${seed}.json`);
  const {value:index}=jsonFile(indexPath,'Replication pair manifest');
  const armBytes={
    uniform:readFileSync(resolve(docs,`moving-food-replication-uniform-seed-${seed}.json`)),
    movingBand:readFileSync(resolve(docs,`moving-food-replication-moving-band-seed-${seed}.json`)),
  };
  const receiptPath=resolve(docs,`moving-food-replication-visual-receipt-${seed}.json`);
  const {raw:receiptRaw,value:receipt}=jsonFile(receiptPath,'Visual receipt');
  requireCommittedReceipt(root,receiptPath,receiptRaw);
  validateIndex(index,seed,armBytes,sha256(receiptRaw));
  validateReceipt(receipt,seed,index);
  const [uniform,movingBand]=[JSON.parse(armBytes.uniform.toString('utf8')),JSON.parse(armBytes.movingBand.toString('utf8'))];
  const at=(arm,tick)=>arm.frames.find(x=>x.tick===tick);
  const comparisons=[1500,2500,3000].map(tick=>{
    const a=at(uniform,tick),b=at(movingBand,tick),receiptEntry=receipt.visualComparisons.find(x=>x.tick===tick);
    if(!a||!b){if(receiptEntry.pass!==false)throw new Error(`Visual receipt must mark unavailable frame comparison at ${tick} as failed`);return {comparison:'uniform-vs-moving-band',tick,available:false};}
    return {comparison:'uniform-vs-moving-band',tick,...overlap(a,b)};
  });
  const a=at(movingBand,2500),b=at(movingBand,3000);
  if(!a||!b){if(receipt.lateWithinMoving.pass!==false)throw new Error('Visual receipt must mark unavailable late moving comparison as failed');
    comparisons.push({comparison:'moving-band-late',from:2500,to:3000,available:false});}
  else comparisons.push({comparison:'moving-band-late',from:2500,to:3000,...overlap(a,b)});
  return {seed,planSha256:PLAN_SHA256,visualReceiptSha256:sha256(receiptRaw),overlapDiagnosticsAfterVisualReview:comparisons};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){if(process.argv.length!==3)throw new Error('Usage: node tools/moving-food-replication-diagnostics.mjs 1202|1203');process.stdout.write(JSON.stringify(diagnostics(Number(process.argv[2])),null,2)+'\n');}
