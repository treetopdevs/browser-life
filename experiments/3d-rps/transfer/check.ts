// Amendment 3: engineering replay only. Run baseline against an untouched source checkout first.
// deno run -A --no-lock experiments/3d-rps/transfer/check.ts baseline <old-root> <report.json> [small|large]
// deno run -A --no-lock experiments/3d-rps/transfer/check.ts kernel <old-root> <report.json> [small|large]
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { baselineOf, conservationOf } from '../lib/kernel-job.ts';
import { canonicalGenome, GENOME_CHANNELS3, validateState, type WorldState } from '@bl/schema';
import { RefSim3 } from '@bl/sim-ref';
import { GpuSim3, requestDevice3 } from '../../../packages/sim-gpu/src/gpu-sim3.ts';

const [mode, source, output, size = 'small'] = Deno.args;
if (!['baseline', 'kernel'].includes(mode) || !source || !output || !['small', 'large'].includes(size)) throw Error('Usage: baseline|kernel source output small|large');
const load = (file: string) => import(pathToFileURL(resolve(source, file)).href);
const { GpuSim3: Spike } = await load('experiments/3d-rps/gate0-spike/gpu-sim3-rps.ts');
const { RPS } = await load('experiments/3d-rps/gate0-spike/shaders3d-rps.ts');
const { jobConfig, mixParams } = await load('experiments/3d-rps/gate0-spike/rungs.ts');
const { rpsMix } = await load('experiments/3d-rps/gate0-spike/world.ts');
const git = (args: string[]) => new TextDecoder().decode(new Deno.Command('git', {args:['-C',source,...args]}).outputSync().stdout).trim();
if (git(['rev-parse','HEAD']) !== '7bb61be2014621b020968e6b60b8246b33990e04' || git(['status','--porcelain','--untracked-files=no'])) throw Error('Comparator must be clean 7bb61be2');
const hash = (a: Uint32Array) => createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const digest = (s: WorldState) => ({step:s.step,cells:hash(s.cells),genome:hash(s.genome),lightIn:String(s.lightIn),heatOut:String(s.heatOut),flux:s.flux.map(String)});
const rows: unknown[] = [];
const expected = mode==='kernel' ? JSON.parse(fs.readFileSync(output,'utf8')) : null;
if (mode==='baseline' && fs.existsSync(output)) throw Error('Refusing to overwrite comparator');
const shape = size==='small' ? [16,16,4] : [256,256,4];
const seeds = size==='small' ? [9001] : [401,402,403];
const rates = size==='small' ? [0,64,16384] : [0,64];
const device=await requestDevice3(navigator.gpu,jobConfig('S0',shape,8,seeds[0]));
try {
 for (const seed of seeds) for (const rate of rates) {
  const cfg=jobConfig('S0',shape,8,seed);
  let state: WorldState=rpsMix(cfg,mixParams('S0'));
  const base=baselineOf(state);
  const points: unknown[]=[];
  const phases=size==='small'?[{rate,steps:[1,10,30]}]:[{rate:0,steps:[6000]},{rate,steps:[7000,8000]}];
  for (const phase of phases) {
   if(mode==='kernel') state.cfg={...cfg,rpsTypes:3,rpsMin:4,rpsRate:phase.rate,rpsKill:'vacancy'};
   else Object.assign(RPS,{on:true,kill:'vacancy',rate:phase.rate,min:4});
   const sim=await (mode==='kernel'?GpuSim3:Spike).create(device,state);
   const cpu=mode==='kernel'&&size==='small'?new RefSim3(structuredClone(state)):null;
   try {
    for(const step of phase.steps) {
     let remaining=step-state.step;
     if(cpu)cpu.run(remaining);
     while(remaining>0){const n=Math.min(100,remaining);sim.run(n);remaining-=n;}
     state=await sim.readState();
     if(mode==='kernel') {
      const ledger=await sim.drainLedger();
      if(ledger.events.length || ledger.dropped)throw Error('Unexpected mutation events');
     }
     const conservation=conservationOf(state.cfg,base,state);
     if(conservation.matter!==base.matter||conservation.residual!==0n)throw Error(`Conservation failed seed ${seed} rate ${rate} step ${step}`);
     if(mode==='kernel') {const errors=validateState(state);if(errors.length)throw Error(errors.join('; '));}
     const point=digest(state);
     if(cpu&&JSON.stringify({...point,genome:hash(canonicalGenome(state.genome,GENOME_CHANNELS3))})!==JSON.stringify({...digest(cpu.state),genome:hash(canonicalGenome(cpu.state.genome,GENOME_CHANNELS3))}))throw Error(`CPU/GPU mismatch ${seed}/${rate}/${step}`);
     points.push(point);
    }
   }finally{sim.destroy();}
  }
  const row={seed,rate,cfg,founding:mixParams('S0'),points}; rows.push(row);
  if(expected&&JSON.stringify(row)!==JSON.stringify(expected.rows[rows.length-1]))throw Error(`Spike/kernel mismatch ${seed}/${rate}`);
  console.log(`${mode} ${size} seed=${seed} rate=${rate}: PASS`);
 }
 const report={source:git(['rev-parse','HEAD']),size,rows};
 if(expected&&expected.rows.length!==rows.length)throw Error('Comparator row count mismatch');
 const dest=mode==='baseline'?output:output.replace(/\.json$/,'.kernel.json');
 fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
} catch(e) {
 fs.writeFileSync(output+`.${mode}-failure-${Date.now()}.json`,JSON.stringify({error:String(e),rows},null,2)+'\n');throw e;
} finally {device.destroy();}
