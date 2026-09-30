// Exploratory interpretation alongside (never replacing) the frozen grow-only screen.
import { FLUX_NAMES } from '@bl/schema';
import { type Design } from './discovery_capability.ts';
import { validateReceipt } from './lib/discovery-receipt-validation.ts';
import { sha256 } from './lib/founder-policy.ts';
const [root,validationPath,out]=Deno.args;
if(!root||!validationPath||!out)throw Error('usage: discovery_activity.ts ROOT COMPLETE_VALIDATION NEW_REPORT');
const text=await Deno.readTextFile(`${root}/capability-design.json`),design:Design=JSON.parse(text),hash=sha256(text);
const validation=JSON.parse(await Deno.readTextFile(validationPath));
if(validation.status!=='complete'||validation.designHash!==hash||validation.units.length!==design.units.length)throw Error('Complete strict validation required');
for(const [p,h] of Object.entries({...design.inputs,...design.sources}))if(sha256(await Deno.readFile(p))!==h)throw Error(`Source/input drift ${p}`);
const groups=new Map<string,{subject:string;environment:string;hex:string|null;rows:unknown[];originalPasses:number;broaderPasses:number|null}>();
for(const unit of design.units){
  const raw=await Deno.readTextFile(`${root}/capability-results/${unit.id}.json`),record=validation.units.find((r:{id:string})=>r.id===unit.id);
  if(!record||record.status!=='valid'||record.sha256!==sha256(raw))throw Error(`Receipt drift ${unit.id}`);
  const r=validateReceipt(JSON.parse(raw),design,hash,unit),late=r.samples[3],early=r.samples[2],first=r.samples[0];
  const photo=BigInt(late.flux[FLUX_NAMES.indexOf('photo')])-BigInt(early.flux[FLUX_NAMES.indexOf('photo')]);
  const grow=BigInt(late.flux[FLUX_NAMES.indexOf('grow')])-BigInt(early.flux[FLUX_NAMES.indexOf('grow')]);
  const retained=first.mass.candidate>0&&early.mass.candidate>=first.mass.candidate&&late.mass.candidate>=first.mass.candidate;
  const broader=unit.environment==='background'?null:retained&&(photo+grow>0n);
  const key=`${unit.subject}/${unit.environment}`;
  if(!groups.has(key))groups.set(key,{subject:unit.subject,environment:unit.environment,hex:unit.hex,rows:[],originalPasses:0,broaderPasses:unit.environment==='background'?null:0});
  const g=groups.get(key)!;
  if(r.standaloneContinuation)g.originalPasses++;
  if(broader)g.broaderPasses!++;
  g.rows.push({unitId:unit.id,seed:unit.seed,initialMass:first.mass.candidate,finalMass:late.mass.candidate,latePhoto:photo.toString(),lateGrow:grow.toString(),originalPass:r.standaloneContinuation,broaderActivityPass:broader});
}
for(const g of groups.values())if(g.rows.length!==4)throw Error('Incomplete group');
const report={designHash:hash,strictValidationSha256:sha256(await Deno.readFile(validationPath)),status:'complete',interpretation:'Exploratory amendment after partial data were observed: photo and grow both synthesize B. Frozen grow-only classifications remain unchanged. Broader eligibility is candidate generation, requiring fresh independent confirmation in the subsequent assay before evolution. Supported whole-world flux is not candidate-specific.',groups:[...groups.values()].map(g=>({...g,originalEligible:g.environment==='background'||g.hex===null?null:g.originalPasses>=3,broaderEligible:g.broaderPasses===null||g.hex===null?null:g.broaderPasses>=3}))};
await Deno.writeTextFile(out,JSON.stringify(report,null,2)+'\n',{createNew:true});
console.log(JSON.stringify({groups:report.groups.length,broaderEligibleGradientCandidates:report.groups.filter(g=>g.environment==='gradient'&&!g.subject.startsWith('historical-')&&g.broaderEligible).length}));
