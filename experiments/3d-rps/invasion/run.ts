// Frozen Amendment 4 assay. Run only after validate.ts and review have passed.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import {encodeCheckpoint,stateHash,validateState,type WorldState} from '@bl/schema';
import {GpuSim3,requestDevice3} from '../../../packages/sim-gpu/src/gpu-sim3.ts';
import {jobConfig,mixParams} from '../gate0-spike/rungs.ts';
import {rpsMix} from '../gate0-spike/world.ts';
import {baselineOf,conservationOf} from '../lib/kernel-job.ts';
import {SEEDS,MARKERS,BURN,HORIZON,EVERY,census,sites,hasPredator,inoculate,verdict,type Census} from './assay.ts';
const [out]=Deno.args;if(!out)throw Error('Usage: run.ts <new-output-directory>');
const root=process.cwd(),dir=path.resolve(out),started=Date.now();
const sha=(x:Uint8Array|string)=>createHash('sha256').update(x).digest('hex');
const manifestPath='experiments/3d-rps/invasion/MANIFEST.json';
let manifestBytes:Buffer,manifest:{sha256:Record<string,string>};
const checkSources=()=>{for(const [file,digest]of Object.entries(manifest.sha256))if(sha(fs.readFileSync(path.resolve(root,file)))!==digest)throw Error('Source changed: '+file);};
fs.mkdirSync(dir);let bytes=0;
let active:{phase:string;step:number}|null=null;
const save=(name:string,value:unknown)=>{
 const data=value instanceof Uint8Array?value:Buffer.from(JSON.stringify(value,null,2)+'\n');
 if(bytes+data.length>2*1024**3)throw Error('INCOMPLETE: output budget');
 fs.writeFileSync(path.join(dir,name),data,{flag:'wx'});bytes+=data.length;return sha(data);
};
const progress=(state:WorldState,marker?:number)=>{
 const data=Buffer.from(JSON.stringify({active,step:state.step,stateHash:stateHash(state),...(marker===undefined?{}:{census:census(state,marker)})})+'\n');
 if(bytes+data.length>2*1024**3)throw Error('INCOMPLETE: output budget');
 fs.appendFileSync(path.join(dir,'progress.jsonl'),data);bytes+=data.length;
};
const limit=()=>{if(Date.now()-started>90*60*1000)throw Error('INCOMPLETE: wall-clock budget');};
const cfg=(seed:number,rate:number)=>({...jobConfig('S0',[256,256,4],8,seed),rpsTypes:5,rpsMin:4,rpsRate:rate,rpsKill:'vacancy' as const});
const results:{seed:number;marker:number;immune:boolean;rows:Census[]}[]=[];
let device:GPUDevice|undefined;
const watchdog=setTimeout(()=>{
 fs.writeFileSync(path.join(dir,'STOP.json'),JSON.stringify({label:'INCOMPLETE',error:'wall-clock deadline during pending work',active,completed:results.length})+'\n',{flag:'wx'});
 try{device?.destroy();}finally{Deno.exit(2);}
},90*60*1000);
try{
 manifestBytes=fs.readFileSync(manifestPath);manifest=JSON.parse(manifestBytes.toString());
 if(!fs.readFileSync('experiments/3d-rps/FROZEN','utf8').split('\n').some(line=>line.includes(sha(manifestBytes)+'  invasion/MANIFEST.json')))throw Error('Manifest is not frozen');
 checkSources();
 save('manifest.json',manifest);save('provenance.json',{manifestSha256:sha(manifestBytes),started:new Date(started).toISOString(),seeds:SEEDS,markers:MARKERS,burn:BURN,horizon:HORIZON,independentSeeds:4});
 device=await requestDevice3(navigator.gpu,cfg(SEEDS[0],0));
 async function advance(sim:GpuSim3,state:WorldState,count:number,base:ReturnType<typeof baselineOf>){
  limit();for(let n=0;n<count;n+=100)sim.run(Math.min(100,count-n));
  const next=await sim.readState(),ledger=await sim.drainLedger();
  if(next.step!==state.step+count)throw Error('Step mismatch');
  const errors=validateState(next);if(errors.length)throw Error(errors.join('; '));
  const balance=conservationOf(next.cfg,base,next);
  if(balance.matter!==base.matter||balance.residual!==0n)throw Error('Conservation failure');
  if(ledger.events.length||ledger.dropped)throw Error('Unexpected mutation/overflow');
  limit();return next;
 }
 for(const seed of SEEDS){
  checkSources();let state=rpsMix(cfg(seed,0),mixParams('S0'));const base=baselineOf(state);active={phase:`burn-${seed}`,step:0};progress(state);
  const burn=await GpuSim3.create(device,state);
  try{for(let n=0;n<BURN;n+=EVERY){state=await advance(burn,state,EVERY,base);active.step=state.step;progress(state);}}finally{burn.destroy();}
  const burnHash=save(`seed-${seed}-burn.blck`,encodeCheckpoint(state));
  const selected=sites(state,seed),background=census(state,4),exposedSites=selected.filter(i=>hasPredator(state,i)).length;
  save(`seed-${seed}-sites.json`,{seed,burnHash,sites:selected,background,exposedSites});
  if(background.types.some((v,i)=>i<3&&v<100)||exposedSites===0)throw Error('SETUP-STOP: inadequate founding types or no sampled predator exposure');
  for(const marker of MARKERS){
   // Reverse treatment order on alternating seeds/markers; no results-based scheduling.
   const order=(seed+marker)%2?[true,false]:[false,true];
   for(const immune of order){
    checkSources();limit();let s=inoculate(state,selected,marker,immune);s.cfg=cfg(seed,64);
    const errors=validateState(s);if(errors.length)throw Error(errors.join('; '));
    const id=`s${seed}-m${marker}-${immune?'immune':'neutral'}`,inputHash=stateHash(s),b=baselineOf(s),rows=[census(s,marker)];
    active={phase:id,step:s.step};progress(s,marker);
    const sim=await GpuSim3.create(device,s);
    try{for(let n=0;n<HORIZON;n+=EVERY){s=await advance(sim,s,EVERY,b);rows.push(census(s,marker));active.step=s.step;progress(s,marker);}}
    finally{sim.destroy();}
    const outputHash=save(id+'.blck',encodeCheckpoint(s));
    const result={seed,marker,immune,rows};
    save(id+'.json',{...result,inputHash,outputHash,endStateHash:stateHash(s),burnHash,conserved:true,mutationEvents:0});results.push(result);
    console.log(`${id}: ${rows[0].frequency.toFixed(6)} -> ${rows.at(-1)!.frequency.toFixed(6)}; ${rows.at(-1)!.marked} marked cells`);
   }
  }
 }
 checkSources();limit();const decision=verdict(results);save('RESULT.json',{...decision,wallSeconds:(Date.now()-started)/1000,bytesBeforeResult:bytes,manifestSha256:sha(manifestBytes)});console.log(JSON.stringify(decision));
}catch(error){
 const msg=String(error);fs.writeFileSync(path.join(dir,'STOP.json'),JSON.stringify({label:msg.includes('INCOMPLETE')?'INCOMPLETE':msg.includes('SETUP-STOP')?'SETUP-STOP':'TECHNICAL-STOP',error:msg,completed:results.length,active,wallSeconds:(Date.now()-started)/1000},null,2)+'\n',{flag:'wx'});throw error;
}finally{clearTimeout(watchdog);device?.destroy();}
