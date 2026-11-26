/** Static artifact check only: does not rerun CLIP or require local weights. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {calibrationFixtures,rasterFrame,PROMPTS} from '../../apps/lab/src/vision-screen/core.ts';
const root=resolve(import.meta.dirname,'../..');
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const a=JSON.parse(readFileSync(resolve(root,process.argv[2]??'docs/creative-prototypes/vision-calibration.json'),'utf8'));
function requireTruth(value:boolean,message:string){if(!value)throw Error(message);}
requireTruth(a.schemaVersion===1&&a.kind==='targeted-vision-calibration','Wrong artifact kind');
requireTruth(JSON.stringify(a.prompts)===JSON.stringify(PROMPTS),'Prompts changed');
const sources=['apps/lab/src/vision-screen/core.ts','tools/vision-screen/calibrate.ts','tools/vision-screen/score.py','tools/vision-screen/report-calibration.ts'];
requireTruth(a.sourceSha256&&JSON.stringify(Object.keys(a.sourceSha256).sort())===JSON.stringify([...sources].sort()),'Missing or unexpected source hashes');
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
requireTruth(sha(a.scoreFileSha256)&&a.runtime?.node==='v24.2.0'&&typeof a.runtime.platform==='string'&&typeof a.runtime.arch==='string','Missing runtime or score hash');
const p=a.provenance;
requireTruth(p&&p.modelRepository==='openai/clip-vit-base-patch32'&&p.modelRevision==='3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268'&&p.device==='cpu'&&p.dtype==='float32'&&p.remoteCode===false&&p.weightsOnly===true,'Missing pinned model provenance');
requireTruth(sha(p.manifestSha256)&&p.scorerSourceSha256===a.sourceSha256['tools/vision-screen/score.py']&&typeof p.python==='string'&&typeof p.architecture==='string','Missing scoring provenance');
const assets=['config.json','merges.txt','preprocessor_config.json','pytorch_model.bin','special_tokens_map.json','tokenizer.json','tokenizer_config.json','vocab.json'];
requireTruth(p.modelAssetSha256&&JSON.stringify(Object.keys(p.modelAssetSha256).sort())===JSON.stringify(assets.sort())&&Object.values(p.modelAssetSha256).every(sha)&&p.modelAssetSha256['pytorch_model.bin']==='a63082132ba4f97a80bea76823f544493bffa8082296d62d71581a4feff1576f','Missing model asset hashes');
requireTruth(p.packages&&['torch','transformers','Pillow','safetensors'].every(k=>typeof p.packages[k]==='string'&&p.packages[k].length>0),'Missing package versions');
requireTruth(p.processor?.inputColorMode==='RGB'&&p.processor.resize?.shortestEdge===224&&p.processor.resize.interpolation==='bicubic'&&p.processor.centerCrop?.height===224&&p.processor.centerCrop.width===224&&p.processor.normalize?.mean?.length===3&&p.processor.normalize?.std?.length===3&&p.limits?.batchSize===8,'Missing processor or limit provenance');
const scorerText=readFileSync(resolve(root,'tools/vision-screen/score.py'),'utf8');
const assetBlock=scorerText.split('MODEL_ASSETS = {')[1]?.split('}')[0]??'';
const expectedAssets=Object.fromEntries([...assetBlock.matchAll(/"([^"\n]+)": "([a-f0-9]{64})"/g)].map(m=>[m[1],m[2]]));
requireTruth(Object.keys(expectedAssets).length===8&&Object.entries(expectedAssets).every(([name,value])=>p.modelAssetSha256[name]===value),'Model asset pins differ from scorer');
const expectedProcessor={inputColorMode:'RGB',resize:{enabled:true,shortestEdge:224,interpolation:'bicubic'},centerCrop:{enabled:true,height:224,width:224},rescale:{enabled:true,factor:1/255},normalize:{enabled:true,mean:[0.48145466,0.4578275,0.40821073],std:[0.26862954,0.26130258,0.27577711]}};
requireTruth(JSON.stringify(p.processor)===JSON.stringify(expectedProcessor),'Processor configuration differs');
for(const [path,digest] of Object.entries(a.sourceSha256))requireTruth(hash(readFileSync(resolve(root,path)))===digest,`Source stale: ${path}`);
const expected=calibrationFixtures();
requireTruth(a.fixtures.length===expected.length,'Wrong fixture matrix');
for(let i=0;i<expected.length;i++){
 const f=a.fixtures[i], original=expected[i];
 for(const key of ['id','label','count','layout','group','frame'] as const)requireTruth(JSON.stringify(f[key])===JSON.stringify(original[key]),`Fixture mismatch ${original.id}/${key}`);
 requireTruth(f.rgbSha256===hash(rasterFrame(original.frame))&&f.scores.sha256===f.rgbSha256,'Pixel hash mismatch');
 for(const key of ['targetCosine','oneCosine','uniformCosine'])requireTruth(Number.isFinite(f.scores[key])&&Math.abs(f.scores[key])<=1.000001,'Invalid cosine');
 requireTruth(Math.abs(f.scores.margin-(f.scores.targetCosine-Math.max(f.scores.oneCosine,f.scores.uniformCosine)))<1e-12,'Wrong margin');
}
const checks=[];
for(const target of a.fixtures.filter((f:any)=>['6','12','seam6'].includes(f.group))){
 const negatives=[...a.fixtures.filter((f:any)=>f.count===target.count&&f.layout===target.layout&&['1','uniform'].includes(f.group)),...a.fixtures.filter((f:any)=>['blank','one'].includes(f.group))];
 for(const negative of negatives)checks.push({targetId:target.id,negativeId:negative.id,difference:target.scores.margin-negative.scores.margin,pass:target.scores.margin>negative.scores.margin});
}
requireTruth(JSON.stringify(a.comparisons)===JSON.stringify(checks),'Gate comparisons differ');
const reference=a.fixtures.find((f:any)=>f.id==='cal-120-layout0-12').scores;
requireTruth(a.repeatFrames.length===2,'Missing repeat evidence');
for(const f of a.repeatFrames)requireTruth(f.sha256===reference.sha256,'Repeat pixels differ');
const max=Math.max(...a.repeatFrames.flatMap((f:any)=>['targetCosine','oneCosine','uniformCosine'].map(k=>Math.abs(f[k]-reference[k]))));
requireTruth(Number.isFinite(max)&&max===a.repeatMaxDifference,'Wrong repeat evidence');
const pass=checks.every(c=>c.pass)&&max<=1e-6;
requireTruth(a.status===(pass?'calibration-passed':'stopped-calibration'),'Gate status differs');
requireTruth(a.searchRuns.length===0,'Calibration artifact unexpectedly claims search');
const reason=pass?'Calibration passed; candidate selection not yet run.':'Fixed judge/target calibration failed. No simulation selection or prompt tuning performed.';
requireTruth(a.reason===reason,'Unexpected interpretation');
const failed=checks.filter(c=>!c.pass);
const expectedMarkdown=`# Targeted vision calibration\n\nStatus: **${a.status}**. ${a.reason}\n\nActual local CLIP ViT-B/32 inference on 54 fixed layouts, blank and one-dot controls, plus two duplicate frames. ${checks.length-failed.length}/${checks.length} required ordering comparisons pass. Duplicate-frame maximum cosine difference: ${max}.\n\nThese are image/text resemblance scores, not motion recognition or proof of evolution. All failed comparisons and exact pixel inputs are retained in [the artifact](vision-calibration.json). The local model revision and file hashes are recorded there.\n\n| Target | Negative | Margin difference |\n|---|---|---:|\n${failed.map(c=>`| ${c.targetId} | ${c.negativeId} | ${c.difference.toFixed(6)} |`).join('\n')}\n`;
requireTruth(readFileSync(resolve(root,'docs/creative-prototypes/vision-calibration.md'),'utf8')===expectedMarkdown,'Markdown differs from JSON');
console.log(`Static source, pixels, scores and gate check passed (${checks.filter(c=>c.pass).length}/${checks.length}). No inference rerun.`);
