// Read-only capability analysis: every frozen unit remains in the denominator.
import { continuation, initial, type Design, type Unit } from './discovery_capability.ts';
import { sha256 } from './lib/founder-policy.ts';
import { stateHash } from '@bl/schema';
const [root,out]=Deno.args;
if(!root||!out)throw Error('usage: discovery_capability_analyze.ts ROOT NEW_REPORT');
const raw=await Deno.readTextFile(`${root}/capability-design.json`),design:Design=JSON.parse(raw),hash=sha256(raw);
const groups=new Map<string,{subject:string;environment:string;requested:number;available:number;passed:number;rows:unknown[]}>();
const missing:string[]=[];
let emptyControlFailures=0;
for(const unit of design.units){
  const key=`${unit.subject}/${unit.environment}`;
  if(!groups.has(key))groups.set(key,{subject:unit.subject,environment:unit.environment,requested:0,available:0,passed:0,rows:[]});
  const g=groups.get(key)!;g.requested++;
  let r;try{r=JSON.parse(await Deno.readTextFile(`${root}/capability-results/${unit.id}.json`))}catch(e){if(!(e instanceof Deno.errors.NotFound))throw e;missing.push(unit.id);continue;}
  if(r.designHash!==hash||JSON.stringify(r.unit)!==JSON.stringify(unit))throw Error(`Receipt identity mismatch ${unit.id}`);
  if(r.samples.map((s:{step:number})=>s.step).join(',')!==design.times.join(','))throw Error('Exact-time roster mismatch');
  const start=initial(design,unit);if(r.samples[0].stateHash!==stateHash(start.state))throw Error('Initial-state mismatch');
  for(const s of r.samples){for(const v of Object.values(s.mass))if(!Number.isSafeInteger(v)||Number(v)<0)throw Error('Invalid mass');if(s.mass.unknown!==0)throw Error('Unresolved copy ancestry');}
  const pass=continuation(r.samples,unit.environment==='background');if(pass!==r.standaloneContinuation)throw Error('Classification mismatch');
  if(unit.hex===null&&r.samples.some((s:{mass:{candidate:number}})=>s.mass.candidate!==0))emptyControlFailures++;
  const first=r.samples[0].mass.candidate,last=r.samples[3].mass.candidate;
  g.available++;if(pass)g.passed++;
  g.rows.push({id:unit.id,seed:unit.seed,initialMass:first,finalMass:last,ratio:first?last/first:null,standaloneContinuation:pass,receiptSha256:sha256(await Deno.readFile(`${root}/capability-results/${unit.id}.json`))});
}
const result={designHash:hash,status:missing.length?'incomplete':emptyControlFailures?'control-failure':'complete',requested:design.units.length,available:design.units.length-missing.length,missing,emptyControlFailures,groups:[...groups.values()].map(g=>({...g,capable:g.available<g.requested||g.environment==='background'||g.subject==='no-candidate'?null:g.passed>=3})),interpretation:'Exploratory capability screen only. Whole-world synthesis in supported worlds is not attributed to the candidate. No claim of adaptation, evolvability, reproduction, or superiority of a selection policy.'};
await Deno.writeTextFile(out,JSON.stringify(result,null,2)+'\n',{createNew:true});
console.log(JSON.stringify({status:result.status,requested:result.requested,available:result.available,capable:result.groups.filter(g=>g.capable).length}));
