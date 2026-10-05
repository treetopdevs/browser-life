import { buildWorld, cellCount, CH, G, defaultConfig, FLUX_NAMES, founderGenome, M3_FOUNDERS, packLineageLo, PRESETS, presetConfig, DEFAULT_RULE_VERSION, stateHash, validateState, type Genome, type WorldConfig, type WorldState } from '@bl/schema';
import { GpuSim, requestDevice } from '@bl/sim-gpu';
import { fromHex, toHex } from './lib/selection-funnel-audit.ts';
import { sha256 } from './lib/founder-policy.ts';

export interface Unit { id:string; subject:string; hex:string|null; environment:'waste'|'background'|'gradient'; seed:number }
export interface Design { ruleVersion:number; inputs:Record<string,string>; sources:Record<string,string>; units:Unit[]; background:GenomeJSON; configs:Record<string,WorldConfig>; times:number[]; criterion:string }
interface GenomeJSON { mu:number; sigma:number; motGain:number; weights:number[] }
const decode=(hex:string):Genome=>{const g=fromHex(hex);return {...g,weights:Int8Array.from(g.weights)}};
export function initial(design:Design, unit:Unit):{state:WorldState;candidateLo:number|null;backgroundLo:number|null} {
  const cfg={...design.configs[unit.environment],seed:unit.seed};
  const mid=cfg.tileW/2, founders=[];
  if(unit.environment==='background') founders.push({x:mid,y:mid,radius:Math.floor(cfg.tileW/3),biomass:64,energy:128,genome:{...design.background,weights:Int8Array.from(design.background.weights)}});
  const backgroundLo=founders.length?packLineageLo(cfg,1):null;
  if(unit.hex) founders.push({x:mid,y:mid,radius:unit.environment==='gradient'?12:Math.floor(cfg.tileW/6),biomass:64,energy:128,genome:decode(unit.hex)});
  const candidateLo=unit.hex?packLineageLo(cfg,founders.length):null;
  const state=buildWorld(cfg,{nutrient:unit.environment==='waste'?8:32,founders});
  if(unit.environment==='waste') {const n=cellCount(cfg);state.cells.fill(24,CH.C*n,(CH.C+1)*n)}
  const errors=validateState(state);if(errors.length)throw Error(errors.join(';'));
  return {state,candidateLo,backgroundLo};
}
export function masses(state:WorldState,candidateLo:number|null,backgroundLo:number|null) {
  const n=cellCount(state.cfg);let candidate=0,background=0,unassociated=0,unknown=0;
  for(let i=0;i<n;i++) {const m=state.cells[CH.B*n+i]+state.cells[CH.P*n+i], hi=state.genome[G.LIN_HI*n+i],lo=state.genome[G.LIN_LO*n+i];
    if(hi===0 && lo===candidateLo)candidate+=m;
    else if(hi===0 && lo===backgroundLo)background+=m;
    else if(hi===0 && lo===0)unassociated+=m;
    else unknown+=m;
  }
  return {candidate,background,unassociated,unknown};
}
export function continuation(samples:{step:number;mass:{candidate:number};flux:string[]}[],supported:boolean):boolean|null {
  if(samples.map(s=>s.step).join(',')!=='0,1000,3000,10000')throw Error('Incomplete exact-time samples');
  if(supported)return null; // Whole-world synthesis cannot identify the candidate's activity.
  return samples[0].mass.candidate>0 && samples[2].mass.candidate>=samples[0].mass.candidate && samples[3].mass.candidate>=samples[0].mass.candidate && BigInt(samples[3].flux[FLUX_NAMES.indexOf('grow')])>BigInt(samples[2].flux[FLUX_NAMES.indexOf('grow')]);
}
async function sourceFiles():Promise<Record<string,string>> {
  const files:Record<string,string>={};
  async function walk(dir:string){for await(const entry of Deno.readDir(dir)){const p=`${dir}/${entry.name}`;if(entry.isDirectory)await walk(p);else if(p.endsWith('.ts'))files[p]=sha256(await Deno.readFile(p));}}
  for(const p of ['packages/schema/src','packages/sim-gpu/src','packages/sim-ref/src','packages/runner/src','packages/metrics/src'])await walk(p);
  for(const p of ['deno.json','tools/discovery_capability.ts','tools/lib/founder-policy.ts','tools/lib/selection-funnel-audit.ts'])files[p]=sha256(await Deno.readFile(p));
  return Object.fromEntries(Object.entries(files).sort());
}
async function verify(design:Design){for(const [p,h] of Object.entries({...design.inputs,...design.sources}))if(sha256(await Deno.readFile(p))!==h)throw Error(`Frozen source/input drift: ${p}`);if(design.ruleVersion!==DEFAULT_RULE_VERSION)throw Error('Rule version drift')}
async function plan(root:string){
  const input=`${root}/candidates.json`, inv=`${root}/initial-inventory/inventory.json`;
  const roster=JSON.parse(await Deno.readTextFile(input)), inventory=JSON.parse(await Deno.readTextFile(inv));
  if(sha256(await Deno.readFile(inv))!==roster.inventorySha256)throw Error('Inventory drift');
  for(const [rel,v] of Object.entries(inventory.files) as [string,{sha256:string}][])if(sha256(await Deno.readFile(`${root}/initial-inventory/${rel}`))!==v.sha256)throw Error(`Inventory drift: ${rel}`);
  const bgPath=`${root}/initial-inventory/bootstrap-medium-background/archive.json`;
  const raw=JSON.parse(await Deno.readTextFile(bgPath)).eval.medium.background;
  const background={...raw,weights:Array.from({length:160},(_,i)=>raw.weights[i])};
  const base=defaultConfig({tileW:64,tileH:64,tilesX:1,tilesY:1,defaultMu:60,defaultSigma:20,kernelRadius:9,lightMode:'uniform',lightBase:40,lightAmp:160,mutRate:0});
  const gradient={...presetConfig(PRESETS.find(p=>p.id==='gradient-m3')!,1),mutRate:0};
  const subjects: {subject:string;hex:string|null;environments:Unit['environment'][]}[]=[];
  for(const study of roster.studies){const source=study.name.endsWith('waste')?'waste':'background';for(const [i,c] of study.selected.entries())subjects.push({subject:`${source}-${i}`,hex:c.hex,environments:[source,'gradient']});}
  for(const i of [0,2,5,9]){const g=founderGenome(M3_FOUNDERS[i]);subjects.push({subject:`historical-${i}`,hex:toHex({...g,weights:Array.from(g.weights)}),environments:['waste','background','gradient']});}
  subjects.push({subject:'no-candidate',hex:null,environments:['waste','background','gradient']});
  const units:Unit[]=[];
  for(const s of subjects)for(const environment of s.environments)for(const seed of [6300001,6300002,6300003,6300004])units.push({id:`${s.subject}-${environment}-${seed}`,subject:s.subject,hex:s.hex,environment,seed});
  const design:Design={ruleVersion:DEFAULT_RULE_VERSION,inputs:{[input]:sha256(await Deno.readFile(input)),[inv]:sha256(await Deno.readFile(inv)),[bgPath]:sha256(await Deno.readFile(bgPath))},sources:await sourceFiles(),units,background,configs:{waste:base,background:base,gradient},times:[0,1000,3000,10000],criterion:'Exploratory standalone continuation: associated B/P at 3000 and 10000 >= initial; positive whole-world grow flux between 3000 and 10000; at least 3/4 seeds. Background supported continuation is descriptive only; no attribution of whole-world flux to candidate. No adaptation or reproduction conclusion.'};
  for(const unit of units)initial(design,unit);
  await Deno.writeTextFile(`${root}/capability-design.json`,JSON.stringify(design,null,2)+'\n',{createNew:true});console.log(JSON.stringify({units:units.length,seeds:[6300001,6300002,6300003,6300004],paidUSD:0}));
}
async function run(root:string,seconds:number){
  if(!(seconds>0&&seconds<=600))throw Error('Runtime tranche must be 1..600 seconds');
  const designText=await Deno.readTextFile(`${root}/capability-design.json`), design:Design=JSON.parse(designText), designHash=sha256(designText);
  await verify(design);const dir=`${root}/capability-results`;await Deno.mkdir(dir,{recursive:true});
  const lock=await Deno.open(`${dir}/RUNNING`,{write:true,createNew:true});await lock.write(new TextEncoder().encode(String(Deno.pid)));lock.close();
  const start=performance.now();let completed=0;
  try {const device=await requestDevice(navigator.gpu);
    try{for(const unit of design.units){const path=`${dir}/${unit.id}.json`;try{const saved=JSON.parse(await Deno.readTextFile(path));if(saved.designHash!==designHash||JSON.stringify(saved.unit)!==JSON.stringify(unit)||saved.samples.map((s:{step:number})=>s.step).join(',')!=='0,1000,3000,10000')throw Error(`Receipt drift: ${unit.id}`);continue;}catch(e){if(!(e instanceof Deno.errors.NotFound))throw e;}
      if(performance.now()-start>=seconds*1000)break;
      const init=initial(design,unit), sim=await GpuSim.create(device,init.state), samples=[];let state=init.state;
      const unitStart=performance.now();
      try {for(const end of design.times){for(let t=state.step;t<end;t+=100){sim.run(Math.min(100,end-t));await device.queue.onSubmittedWorkDone();}if(end>0)state=await sim.readState();if(state.step!==end)throw Error('Sample time mismatch');const mass=masses(state,init.candidateLo,init.backgroundLo);if(mass.unknown)throw Error('Unresolved copy lineage mass');samples.push({step:end,mass,flux:state.flux.map(String),stateHash:stateHash(state)});}
        const result={designHash,unit,samples,standaloneContinuation:continuation(samples,unit.environment==='background'),elapsedSeconds:(performance.now()-unitStart)/1000};await Deno.writeTextFile(path,JSON.stringify(result)+'\n',{createNew:true});completed++;console.log(JSON.stringify({id:unit.id,finalMass:samples[3].mass.candidate,seconds:result.elapsedSeconds}));
      }finally{sim.destroy();}
    }}finally{device.destroy();}
  }finally{await Deno.remove(`${dir}/RUNNING`);}
  console.log(JSON.stringify({completed,elapsedSeconds:(performance.now()-start)/1000}));
}
if(import.meta.main){const [stage,root,seconds]=Deno.args;if(stage==='plan')await plan(root);else if(stage==='run')await run(root,Number(seconds??300));else throw Error('usage: discovery_capability.ts plan|run ROOT [SECONDS]');}
