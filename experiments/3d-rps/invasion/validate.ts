import {CH,G,MOT_ZERO3,GENOME_CHANNELS3,allocState3,cellCount,canonicalGenome,encodeGenome3,generalistGenome3,stateHash,validateState} from '@bl/schema';
import {RefSim3} from '@bl/sim-ref';
import {GpuSim3,requestDevice3} from '../../../packages/sim-gpu/src/gpu-sim3.ts';
import {jobConfig,mixParams,METER_ZERO} from '../gate0-spike/rungs.ts';
import {rpsMix} from '../gate0-spike/world.ts';
import {sites,inoculate,census,MARKERS} from './assay.ts';
const check=(v:unknown,m:string)=>{if(!v)throw Error(m);};
const equal=(a:Uint32Array,b:Uint32Array)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const cfg={...jobConfig('S0',[32,32,4],8,9101),rpsTypes:5,rpsMin:4,rpsRate:0,rpsKill:'vacancy' as const};
const device=await requestDevice3(navigator.gpu,cfg);
try{
 for(const marker of MARKERS){
  const source=rpsMix(cfg,mixParams('S0')),selected=sites(source,9101);
  const states=[inoculate(source,selected,marker,true),inoculate(source,selected,marker,false),inoculate(source,selected,marker,false)];
  const sims=await Promise.all(states.map(s=>GpuSim3.create(device,s)));
  try{
   for(const sim of sims)sim.run(30);
   const [a,b,c]=await Promise.all(sims.map(s=>s.readState()));
   check(equal(a.cells,b.cells),'rate-0 cells differ');
   const originalSites=new Set(selected),nn=cellCount(cfg);
   const descendants=Array.from({length:nn},(_,i)=>i).filter(i=>a.genome[G.LIN_HI*nn+i]===0&&a.genome[G.LIN_LO*nn+i]===marker&&a.cells[CH.B*nn+i]+a.cells[CH.P*nn+i]>0);
   check(descendants.length>0&&descendants.some(i=>!originalSites.has(i)),'no inherited marker beyond original sites');
   check(descendants.every(i=>((a.genome[G.PARAM1*nn+i]>>>8)&255)===3&&((a.genome[G.PARAM1*nn+i]>>>16)&255)===2),'descendant metadata lost');
   const n=cellCount(cfg),ag=canonicalGenome(a.genome,GENOME_CHANNELS3),bg=canonicalGenome(b.genome,GENOME_CHANNELS3);
   for(let i=0;i<n;i++)if(ag[G.LIN_LO*n+i]===marker)ag[G.PARAM1*n+i]&=0xffff00ff;
   check(equal(ag,bg),'rate-0 inheritance differs beyond type');
   check(a.lightIn===b.lightIn&&a.heatOut===b.heatOut&&a.flux.every((v,k)=>v===b.flux[k]),'rate-0 accounting differs');
   check(stateHash(b)===stateHash(c),'neutral replay differs');
   check(JSON.stringify(census(b,marker))===JSON.stringify(census(c,marker)),'neutral endpoint differs');
   for(const sim of sims){const l=await sim.drainLedger();check(!l.events.length&&!l.dropped,'events');}
  }finally{sims.forEach(s=>s.destroy());}
 }
 // Guaranteed direct protection: four type-2 faces kill type 0 with probability 1, but none attacks type 3.
 for(const immune of [false,true]){
  const c={...cfg,...METER_ZERO,spread:0,diffA:0,diffC:0,diffS:0,lightBase:0,lightAmp:0,rpsRate:16384};
  const s=allocState3(c),n=cellCount(c),i=3*32+3;s.cells.fill(MOT_ZERO3,CH.MOT*n,(CH.MOT+1)*n);
  const put=(j:number,type:number,mask:number,id:number)=>{const g=encodeGenome3({...generalistGenome3(50,12),rpsType:type,rpsMask:mask},0,id);for(let k=0;k<g.length;k++)s.genome[k*n+j]=g[k];s.cells[CH.B*n+j]=4;s.cells[CH.E*n+j]=8;s.cells[CH.MOT*n+j]=(MOT_ZERO3|(mask<<24))>>>0;};
  put(i,immune?3:0,2,4);for(const j of [i-1,i+1,i-32,i+32])put(j,2,1,3);
  check(!validateState(s).length,'fixture invalid');const ref=new RefSim3(structuredClone(s));ref.run(1);const gpu=await GpuSim3.create(device,s);
  try{gpu.run(1);const a=await gpu.readState();check(equal(a.cells,ref.state.cells),'protection CPU/GPU differs');check(a.cells[CH.B*n+i]===(immune?4:0),'protection oracle failed');}finally{gpu.destroy();}
 }
 console.log(JSON.stringify({protection:true,rateZeroPhysics:true,neutralReplay:true,markerChecks:2,mutation:false}));
}finally{device.destroy();}
