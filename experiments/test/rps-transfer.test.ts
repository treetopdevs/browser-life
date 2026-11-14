import { describe, it, expect } from 'vitest';
import { CH,G,MOT_ZERO3,cellCount,validateConfig,validateState,encodeGenome3,decodeGenome3,genomeHex3,genomeFromHex3,generalistGenome3 } from '@bl/schema';
import { RefSim3 } from '@bl/sim-ref';
import { jobConfig, mixParams } from '../3d-rps/gate0-spike/rungs';
import { rpsMix } from '../3d-rps/gate0-spike/world';
import { baselineOf, conservationOf } from '../3d-rps/lib/kernel-job';
const config=()=>({...jobConfig('S0',[16,16,4],8,9001),rpsTypes:3,rpsRate:64,rpsMin:4,rpsKill:'vacancy' as const});
const world=()=>rpsMix(config(),mixParams('S0'));
describe('Amendment 3 vacancy transfer boundaries',()=>{
 it('requires a complete explicit mutation-disabled slab configuration',()=>{
  expect(validateConfig(config())).toEqual([]);
  for(const key of ['rpsTypes','rpsRate','rpsMin','rpsKill'] as const){const c:Partial<ReturnType<typeof config>>=config();delete c[key];expect(validateConfig(c as ReturnType<typeof config>).length).toBeGreaterThan(0);}
  for(const override of [{rpsTypes:2},{rpsTypes:9},{rpsRate:-1},{rpsRate:16385},{rpsRate:0.5},{rpsMin:0},{rpsMin:256},{mutRate:1},{rpsKill:'removal'},{rpsFlip:0},{rpsEdge:0}])expect(validateConfig({...config(),...override} as ReturnType<typeof config>).length).toBeGreaterThan(0);
  const c=config();delete (c as Partial<typeof c>).tileD;delete (c as Partial<typeof c>).lightK;expect(validateConfig(c).length).toBeGreaterThan(0);
 });
 it('keeps strict genome decoding unless RPS is explicitly requested',()=>{
  for(const type of [0,1,7]){
   const g={...generalistGenome3(50,12),rpsType:type,rpsMask:type===7?1:128};
   const words=encodeGenome3(g,0,1);
   expect(()=>decodeGenome3(words)).toThrow();
   expect(decodeGenome3(words,{rps:true})).toEqual(g);
   expect(genomeFromHex3(genomeHex3(g),{rps:true})).toEqual(g);
  }
 });
 it('rejects wrong mirrors, type/mask bounds and unowned biomass',()=>{
  expect(validateState(world())).toEqual([]);
  for(const alter of [
   (s:ReturnType<typeof world>,i:number,n:number)=>{s.cells[CH.MOT*n+i]=MOT_ZERO3;},
   (s:ReturnType<typeof world>,i:number,n:number)=>{s.genome[G.PARAM1*n+i]|=3<<8;},
   (s:ReturnType<typeof world>,i:number,n:number)=>{s.genome[G.PARAM1*n+i]|=128<<16;},
   (s:ReturnType<typeof world>,i:number,n:number)=>{const t=(s.genome[G.PARAM1*n+i]>>>8)&255;s.genome[G.PARAM1*n+i]|=(1<<t)<<16;},
   (s:ReturnType<typeof world>,i:number,n:number)=>{s.genome[G.PARAM1*n+i]|=1<<24;},
   (s:ReturnType<typeof world>,i:number,n:number)=>{s.genome[G.LIN_LO*n+i]=0;s.cells[CH.B*n+i]=1;},
  ]){const s=world(),n=cellCount(s.cfg);const i=Array.from({length:n},(_,i)=>i).find(i=>s.genome[G.LIN_LO*n+i]!==0)!;alter(s,i,n);expect(validateState(s).length).toBeGreaterThan(0);}
 });
 it('conserves exact matter and energy and preserves invariants under repeated kills',()=>{
  for(const seed of [9001,9002,9003])for(const rate of [0,64,16384]){
   const s=rpsMix({...config(),seed,rpsRate:rate},mixParams('S0')),b=baselineOf(s),sim=new RefSim3(s);
   for(let i=0;i<10;i++){sim.run(1);expect(validateState(sim.state)).toEqual([]);expect(conservationOf(s.cfg,b,sim.state)).toEqual({matter:b.matter,residual:0n});}
  }
 });
});
