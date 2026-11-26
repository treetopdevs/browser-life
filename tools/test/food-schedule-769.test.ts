import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HungryWorld, RULES, schedule769PulseTargetTile, footholdBandAtSlot, footholdBandPulseTargetTile, alternatingBandAtPulse } from '../../apps/lab/src/food-schedule-769/model.ts';
import { HungryWorld as OldWorld } from '../../apps/lab/src/food-band-foothold/model.ts';
import { FOOTHOLD_PLAN_SHA256, LOADED_SOURCE_SHA256, assertPinnedInputs, assertSourceIdentity, baselineData, checkHistoricalReferences, claimAttemptStart, evaluateGate, evaluateSpatialGate, evaluateSeasonalGate, gateWindows, gateBlocks, validateGateReceipt, assertContinuationReady, awaitGateReceipt, assertCommittedPath, validateEnvironment, validateBandProgress, validateSnapshot, validateFrame, expectedSampleTicks, expectedSnapshotTicks, parseArgs } from '../food-schedule-769/explore.ts';
const sha=(x:string)=>createHash('sha256').update(x).digest('hex');
const copy=<T>(x:T):T=>JSON.parse(JSON.stringify(x));
function gateFixture(){
 const windows=[0,1,2].map(()=>({status:'complete',executedTicks:500,births:2,deaths:1,cap48Ticks:0}));
 const numericalGate=evaluateGate(3000,{population:10,familyCounts:[5,5,0]} as any,windows,3000);
 const spatialGate=evaluateSpatialGate([{tick:2500,occupiedTilesByBand:[60,80]},{tick:3000,occupiedTilesByBand:[30,120]}],3000);
 const seasonalGate=evaluateSeasonalGate([{fromOccupiedTilesByBand:[90,30],toOccupiedTilesByBand:[60,80]},{fromOccupiedTilesByBand:[60,80],toOccupiedTilesByBand:[60,80]},{fromOccupiedTilesByBand:[60,80],toOccupiedTilesByBand:[30,120]}],3000);
 const gate={provenance:{runId:'fixture',intentSha256:sha('intent'),sourceSha256:LOADED_SOURCE_SHA256},numericalGate,spatialGate,seasonalGate};
 const receipt={schemaVersion:1,kind:'hungry-shapes-food-schedule-769-gate-receipt',seed:1202,runId:'fixture',intentSha256:sha('intent'),gateArtifactSha256:sha('gate'),planSha256:FOOTHOLD_PLAN_SHA256,sourceSha256:LOADED_SOURCE_SHA256,ages:[1500,2000,2500,3000],numericalGate,spatialGate,seasonalGate,manual:{notBlind:true,blocks:seasonalGate.blocks.map((b:any)=>({from:b.from,to:b.to,fedBand:b.fedBand,numericalPass:b.pass,visualPass:b.pass,observation:'Synthetic body-only fixture observation, not an outcome.'})),ownChange:{from:2500,to:3000,pass:true,observation:'Synthetic changed occupied cells fixture, not an outcome.'},pass:true},decision:'continue'};
 return {gate,receipt};
}
describe('schedule769 pure validation; never advance biology',()=>{
 it('uses exact seasonal boundaries and slot allocation',()=>{
  expect([0,99,100,199,200,599,600,1199].map(alternatingBandAtPulse)).toEqual([0,0,1,1,0,1,0,1]);
  for(const p of [0,99,100,599,600,1199]){const counts=[0,0];for(let j=0;j<768;j++)counts[footholdBandAtSlot(p,j)]++;expect(counts).toEqual(alternatingBandAtPulse(p)===0?[672,96]:[96,672]);}
 });
 it('enumerates all1200 pulses, exact floor/total coverage and no duplicates',()=>{
  const floor=[new Set<number>(),new Set<number>()],total=[new Set<number>(),new Set<number>()],oldFloor=[new Set<number>(),new Set<number>()],oldTotal=[new Set<number>(),new Set<number>()],offered=[0,0];
  for(let p=0;p<1200;p++){const seen=new Set<number>();for(let j=0;j<768;j++){const b=footholdBandAtSlot(p,j),tile=schedule769PulseTargetTile(p,j,1202),old=footholdBandPulseTargetTile(p,j,1202);expect(seen.has(tile)).toBe(false);seen.add(tile);expect(Number.isSafeInteger(tile)&&tile>=0&&tile<9216).toBe(true);expect(b===0?tile%96<24:tile%96>=48&&tile%96<72).toBe(true);total[b]!.add(tile);oldTotal[b]!.add(old);offered[b]++;if(j<192){floor[b]!.add(tile);oldFloor[b]!.add(old);}}
   if(p===599){expect(floor.map(x=>x.size)).toEqual([2079,2079]);expect(total.map(x=>x.size)).toEqual([2304,2304]);expect(offered).toEqual([230400,230400]);}}
  expect(floor.map(x=>x.size)).toEqual([2304,2304]);expect(total.map(x=>x.size)).toEqual([2304,2304]);expect(oldFloor.map(x=>x.size)).toEqual([288,288]);expect(oldTotal.map(x=>x.size)).toEqual([2016,2016]);expect(offered).toEqual([460800,460800]);
 });
 it('rejects invalid targets and preserves old initialization exactly',()=>{
  expect(()=>schedule769PulseTargetTile(-1,0,1202)).toThrow();expect(()=>schedule769PulseTargetTile(0,768,1202)).toThrow();expect(()=>schedule769PulseTargetTile(0,0,-1)).toThrow();
  for(const mode of ['original','uniform','patches','moving-band','stationary-band','split-band','alternating-band','foothold-band'] as const){const old=new OldWorld(1202,true,mode),fresh=new HungryWorld(1202,true,mode);expect(fresh.snapshot()).toEqual(old.snapshot());expect(fresh.environment).toEqual(old.environment);expect(fresh.foodTargets).toEqual(old.foodTargets);}
  const fresh=new HungryWorld(1202,true,'schedule-769'),old=new OldWorld(1202,true,'foothold-band');expect(fresh.snapshot()).toEqual(old.snapshot());expect(fresh.environment).toEqual({...old.environment,mode:'schedule-769',pulseAdvance:769});
 });
 it('pins historical bytes and correct PR116 wrapper without stepping',()=>{assertPinnedInputs();const historical=baselineData();expect(historical.run.finalTick).toBe(6000);expect(historical.kind).toBe('hungry-shapes-food-floor-longevity-replication-arm');expect(historical.frames).toHaveLength(301);expect(historical.final.census.population).toBe(11);});
 it('checks source/dependency/test drift',()=>{for(const p of ['package.json','pnpm-lock.yaml','tools/test/food-schedule-769.test.ts'])expect(LOADED_SOURCE_SHA256[p]).toMatch(/^[a-f0-9]{64}$/);assertSourceIdentity();expect(()=>assertSourceIdentity(LOADED_SOURCE_SHA256,{...LOADED_SOURCE_SHA256,'package.json':sha('changed')})).toThrow();expect(()=>assertSourceIdentity(LOADED_SOURCE_SHA256,{...LOADED_SOURCE_SHA256,'tools/test/food-schedule-769.test.ts':sha('changed')})).toThrow();});
 it('translates same activity thresholds to each horizon',()=>{const wins=[0,1,2].map(()=>({status:'complete',executedTicks:500,births:1,deaths:1,cap48Ticks:99}));for(const h of [3000,6000] as const){expect(evaluateGate(h,{population:2,familyCounts:[1,1,0]} as any,wins,h).numericalPass).toBe(true);expect(evaluateGate(h,{population:1,familyCounts:[1,0,0]} as any,wins,h).numericalPass).toBe(false);expect(evaluateGate(h,{population:2,familyCounts:[1,1,0]} as any,[...wins.slice(0,2),{...wins[2],cap48Ticks:100}],h).numericalPass).toBe(false);expect(evaluateGate(h-1,{population:2,familyCounts:[1,1,0]} as any,wins,h).numericalPass).toBe(false);}});
 it('requires both bands at both correct checkpoints',()=>{expect(evaluateSpatialGate([{tick:2500,occupiedTilesByBand:[10,10]},{tick:3000,occupiedTilesByBand:[10,10]}],3000).pass).toBe(true);expect(evaluateSpatialGate([{tick:2500,occupiedTilesByBand:[9,100]},{tick:3000,occupiedTilesByBand:[10,10]}],3000).pass).toBe(false);expect(evaluateSpatialGate([{tick:2500,occupiedTilesByBand:[10,10]},{tick:3000,occupiedTilesByBand:[10,10]}],6000).pass).toBe(false);});
 it('needs same seasonal block gain20 and loss20',()=>{expect(evaluateSeasonalGate([{fromOccupiedTilesByBand:[50,50],toOccupiedTilesByBand:[30,70]}],3000).pass).toBe(true);expect(evaluateSeasonalGate([{fromOccupiedTilesByBand:[50,50],toOccupiedTilesByBand:[31,70]}],3000).pass).toBe(false);expect(gateBlocks(3000).map(x=>x.fedBand)).toEqual([1,0,1]);expect(gateWindows(6000)).toEqual([{from:4501,to:5000},{from:5001,to:5500},{from:5501,to:6000}]);});
 it('requires correctly bound manual receipt',()=>{const {gate,receipt}=gateFixture();expect(()=>validateGateReceipt(receipt,gate,sha('gate'))).not.toThrow();for(const patch of [{runId:'stale'},{gateArtifactSha256:sha('stale')},{intentSha256:sha('stale')},{planSha256:sha('stale')},{ages:[1500,2000,2500]},{decision:'stop'}])expect(()=>validateGateReceipt({...receipt,...patch},gate,sha('gate'))).toThrow();expect(()=>validateGateReceipt(null,gate,sha('gate'))).toThrow();});
 it('manual false is Stop and cannot be overridden',()=>{const {gate,receipt}=gateFixture();const r=copy(receipt);r.manual.ownChange.pass=false;r.manual.pass=false;r.decision='stop';expect(()=>validateGateReceipt(r,gate,sha('gate'))).not.toThrow();expect(()=>validateGateReceipt({...r,decision:'continue'},gate,sha('gate'))).toThrow();});
 it('rejects missing/numerically inconsistent/manual nonmatching blocks',()=>{const {gate,receipt}=gateFixture();const r=copy(receipt);r.manual.blocks[0]!.visualPass=false;r.manual.blocks[2]!.visualPass=false;expect(()=>validateGateReceipt(r,gate,sha('gate'))).toThrow();const r2=copy(receipt);r2.manual.blocks[0]!.numericalPass=false;expect(()=>validateGateReceipt(r2,gate,sha('gate'))).toThrow();});
 it('continuation rejects missing/false/changed states and repeated approval',()=>{const {gate,receipt}=gateFixture(),args={gate,receipt,artifactSha256:sha('gate'),currentStateHashes:[sha('state'),sha('state')],savedStateHashes:[sha('state'),sha('state')],alreadyContinued:false};expect(()=>assertContinuationReady(args)).not.toThrow();expect(()=>assertContinuationReady({...args,alreadyContinued:true})).toThrow();expect(()=>assertContinuationReady({...args,currentStateHashes:[sha('changed'),sha('state')]})).toThrow();const before=JSON.stringify(args);assertContinuationReady(args);expect(JSON.stringify(args)).toBe(before);});
 it('actual wait barrier makes no fixture step until bound receipt and commit exist',async()=>{
  const {gate,receipt}=gateFixture();let clock=0,stepCalls=0,sourceChecks=0,waits=0;
  const decision=await awaitGateReceipt(gate,sha('gate'),{read:()=>waits===0?null:JSON.stringify(receipt),committed:()=>waits<2?null:'a'.repeat(40),assertSources:()=>{sourceChecks++;},now:()=>clock,wait:async()=>{expect(stepCalls).toBe(0);waits++;clock++;}},10);
  expect(waits).toBe(2);expect(sourceChecks).toBe(3);expect(decision.receiptCommit).toBe('a'.repeat(40));
  const args={gate,receipt:decision.receipt,artifactSha256:sha('gate'),currentStateHashes:[sha('s'),sha('s')],savedStateHashes:[sha('s'),sha('s')],alreadyContinued:false};assertContinuationReady(args);stepCalls++;expect(stepCalls).toBe(1);expect(()=>assertContinuationReady({...args,alreadyContinued:true})).toThrow();
 });
 it('barrier timeout or source changes never reach fixture continuation',async()=>{
  const {gate,receipt}=gateFixture();let clock=0,steps=0;
  await expect(awaitGateReceipt(gate,sha('gate'),{read:()=>null,committed:()=>null,assertSources:()=>{},now:()=>clock,wait:async()=>{clock++;}},2).then(()=>{steps++;})).rejects.toThrow(/timeout/);expect(steps).toBe(0);
  await expect(awaitGateReceipt(gate,sha('gate'),{read:()=>JSON.stringify(receipt),committed:()=>null,assertSources:()=>{throw Error('source changed');},now:()=>0,wait:async()=>{}},2)).rejects.toThrow(/source changed/);
 });
 it('committed receipt helper rejects untracked and dirty files, accepts exact commit',()=>{
  const dir=mkdtempSync(join(tmpdir(),'schedule769-commit-')),previous=process.cwd();try{
   execFileSync('git',['init','-q',dir]);process.chdir(dir);writeFileSync('receipt.json','{}');expect(()=>assertCommittedPath('receipt.json')).toThrow();
   execFileSync('git',['add','receipt.json']);execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);expect(assertCommittedPath('receipt.json')).toMatch(/^[a-f0-9]{40}$/);writeFileSync('receipt.json','{"changed":true}');expect(()=>assertCommittedPath('receipt.json')).toThrow();
  }finally{process.chdir(previous);rmSync(dir,{recursive:true,force:true});}
 });
 it('checks exact new environment and per-band monotonic ledger',()=>{const w=new HungryWorld(1202,true,'schedule-769'),env=w.environment;expect(()=>validateEnvironment(env,0,'init','schedule-769')).not.toThrow();expect(()=>validateEnvironment({...env,pulseAdvance:768},0,'bad','schedule-769')).toThrow();expect(()=>validateBandProgress({...env,bandAccepted:[1,0]} as any,env)).toThrow();});
 it('validates initialization snapshots and rejects excess food',()=>{const w=new HungryWorld(1202,true,'schedule-769');expect(()=>validateSnapshot(w.snapshot(),{seed:1202,tick:0,extinctionTick:null})).not.toThrow();const bad=copy(w.snapshot());bad.food[0]=41;expect(()=>validateSnapshot(bad,{seed:1202,tick:0,extinctionTick:null})).toThrow();});
 it('retains off-cadence actual terminals and never fabricates a tail',()=>{expect(expectedSampleTicks(23,23)).toEqual([0,20,23]);expect(expectedSnapshotTicks(23,23)).toEqual([0,23]);expect(expectedSampleTicks(3000,null)).toHaveLength(151);expect(expectedSnapshotTicks(3000,null)).toHaveLength(7);});
 it('reserves sticky start marker and refuses restart without simulation',()=>{const dir=mkdtempSync(join(tmpdir(),'schedule769-'));try{writeFileSync(join(dir,'intent.json'),'{}');claimAttemptStart(dir);expect(()=>claimAttemptStart(dir)).toThrow();}finally{rmSync(dir,{recursive:true,force:true});}});
 it('requires explicit scheduledseed and durable attempt path',()=>{expect(parseArgs(['--check','--seed','1202']).seed).toBe(1202);expect(()=>parseArgs(['--write','--seed','1202'])).toThrow();expect(()=>parseArgs(['--check','--seed','1203'])).toThrow();});
});
