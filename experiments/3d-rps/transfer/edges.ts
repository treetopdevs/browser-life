// Tiny deterministic correctness fixtures. No ecological inference.
import { CH,G,MOT_ZERO3,FLUX_COUNT,digestWords,GENOME_CHANNELS3,allocState3,cellBase,cellCount,draw,encodeGenome3,generalistGenome3,canonicalGenome,validateState,encodeCheckpoint,decodeCheckpoint } from '@bl/schema';
import { RefSim3 } from '@bl/sim-ref';
import { GpuSim3,requestDevice3 } from '../../../packages/sim-gpu/src/gpu-sim3.ts';
import { reactShader3 } from '../../../packages/sim-gpu/src/shaders3d.ts';
import { jobConfig,METER_ZERO } from '../gate0-spike/rungs.ts';
import { baselineOf,conservationOf } from '../lib/kernel-job.ts';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const [source,output]=Deno.args;
if(!source||!output)throw Error('source and output required');
const old=await import(pathToFileURL(resolve(source,'packages/sim-gpu/src/shaders3d.ts')).href);
const assert=(b:unknown,m:string)=>{if(!b)throw Error(m);};
const equal=(a:Uint32Array,b:Uint32Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const points=[];
for(const spread of [0,8,32])for(const seed of [1,9001]){
 const cfg=jobConfig('S0',[16,16,4],spread,seed);
 assert(reactShader3(cfg)===old.reactShader3(cfg),'default shader changed');
}
const i=3*16+3;
let seed=9001;while((draw(cellBase(seed,0,i),40)&65535)>=16384)seed++;
const cfg={...jobConfig('S0',[16,16,4],0,seed),...METER_ZERO,diffA:0,diffC:0,diffS:0,lightBase:0,lightAmp:0,rpsTypes:8,rpsRate:16384,rpsMin:4,rpsKill:'vacancy' as const};
const device=await requestDevice3(navigator.gpu,cfg);
try {
 for(const minimum of [1,4,255]) for(const kind of ['saturated','below-min','closed-z','one-face','rate-zero'] as const){
  const c={...cfg,rpsMin:minimum,rpsRate:kind==='rate-zero'?0:16384};
  const s=allocState3(c),n=cellCount(c);s.cells.fill(MOT_ZERO3,CH.MOT*n,(CH.MOT+1)*n);
  const put=(at:number,type:number,mask:number,B:number,P:number)=>{
   const g=encodeGenome3({...generalistGenome3(50,12),rpsType:type,rpsMask:mask},0,type+1);
   for(let k=0;k<g.length;k++)s.genome[k*n+at]=g[k];
   s.cells[CH.B*n+at]=B;s.cells[CH.P*n+at]=P;s.cells[CH.E*n+at]=7;
   s.cells[CH.S*n+at]=11;s.cells[CH.A*n+at]=13;s.cells[CH.C*n+at]=17;
   s.cells[CH.MOT*n+at]=(MOT_ZERO3|(mask<<24))>>>0;
  };
  put(i,7,0,0,5);
  const faces=kind==='closed-z'?[i+3*256]:kind==='one-face'?[i+1]:[i-1,i+1,i-16,i+16];
  for(const j of faces)put(j,0,128,kind==='below-min'?minimum-1:minimum,0);
  assert(validateState(s).length===0,'fixture invalid');
  const ref=new RefSim3(structuredClone(s));const b=baselineOf(s);ref.run(1);
  const killed=kind==='saturated'||kind==='one-face';
  assert(ref.state.cells[CH.P*n+i]===(killed?0:5),'hand oracle: victim P');
  assert(ref.state.cells[CH.C*n+i]===(killed?22:17),'hand oracle: victim C');
  assert(ref.state.cells[CH.A*n+i]===13&&ref.state.cells[CH.S*n+i]===11,'hand oracle: A/S preserved');
  assert(ref.state.genome[G.LIN_LO*n+i]===(killed?0:8),'hand oracle: lineage');
  assert(ref.state.flux.every(v=>v===0n),'vacancy must book no flux');
  const sim=await GpuSim3.create(device,s);
  try {
   sim.run(1);const gpu=await sim.readState();
   assert(equal(gpu.cells,ref.state.cells),'GPU cells');
   assert(equal(canonicalGenome(gpu.genome,GENOME_CHANNELS3),canonicalGenome(ref.state.genome,GENOME_CHANNELS3)),'GPU genomes');
   assert(gpu.heatOut===ref.state.heatOut&&gpu.lightIn===ref.state.lightIn&&gpu.flux.every((v,k)=>v===ref.state.flux[k]),'GPU accounting');
   assert(validateState(gpu).length===0,'GPU state');
   const bal=conservationOf(c,b,gpu);assert(bal.matter===b.matter&&bal.residual===0n,'conservation');
   const cp=decodeCheckpoint(encodeCheckpoint(gpu));assert(equal(cp.state.cells,gpu.cells),'checkpoint roundtrip');
   const invalid=structuredClone(s);invalid.cells[CH.MOT*n+(faces[0])]=MOT_ZERO3;
   let rejected=false;try{sim.upload(invalid);}catch{rejected=true;}assert(rejected,'upload accepted bad mirror');
   rejected=false;try{await GpuSim3.create(device,invalid);}catch{rejected=true;}assert(rejected,'create accepted bad mirror');
   rejected=false;try{new RefSim3(invalid);}catch{rejected=true;}assert(rejected,'CPU accepted bad mirror');
   const encoded=encodeCheckpoint(s), words=new Uint32Array(encoded.buffer.slice(encoded.byteOffset,encoded.byteOffset+encoded.byteLength));
   const header=10+2*FLUX_COUNT, cellStart=header+Math.ceil(words[header-1]/4)+1;
   words[cellStart+CH.MOT*n+faces[0]]=MOT_ZERO3;
   const checks=digestWords(words.subarray(0,words.length-2));words[words.length-2]=checks[0];words[words.length-1]=checks[1];
   rejected=false;try{decodeCheckpoint(new Uint8Array(words.buffer));}catch{rejected=true;}assert(rejected,'checkpoint loader accepted bad mirror with valid checksum');
   const led=await sim.drainLedger();assert(!led.events.length&&!led.dropped,'unexpected events');
   points.push({kind,minimum,seed,killed,conserved:true,gpuEqual:true,checkpoint:true,invalidRejected:true});console.log(kind+': PASS');
  }finally{sim.destroy();}
 }
 // An inert optional configuration must not change a key-absent world.
 const {rpsMix}=await import('../gate0-spike/world.ts');
 const {mixParams}=await import('../gate0-spike/rungs.ts');
 const plain=rpsMix(jobConfig('S0',[16,16,4],8,9001),mixParams('S0'));
 const count=cellCount(plain.cfg);
 for(let k=0;k<count;k++){plain.genome[G.PARAM1*count+k]&=255;plain.cells[CH.MOT*count+k]&=0xffffff;}
 const inert=structuredClone(plain);inert.cfg={...inert.cfg,rpsTypes:3,rpsRate:0,rpsMin:4,rpsKill:'vacancy'};
 const a=await GpuSim3.create(device,plain),b=await GpuSim3.create(device,inert);
 try {let prior=0;for(const step of [1,10,30]){
  a.run(step-prior);b.run(step-prior);prior=step;
  const x=await a.readState(),y=await b.readState();
  assert(equal(x.cells,y.cells)&&equal(x.genome,y.genome)&&x.lightIn===y.lightIn&&x.heatOut===y.heatOut&&x.flux.every((v,k)=>v===y.flux[k]),'inert optional config changed state');
 }}finally{a.destroy();b.destroy();}
 writeFileSync(output,JSON.stringify({defaultShadersUnchanged:true,inertGpuEqual:true,points},null,2)+'\n',{flag:'wx'});
}finally{device.destroy();}
