import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALTERNATING_BAND_TARGET_COUNT, GENOME_PRESETS, HungryWorld, RULES, SPLIT_BAND_COLUMNS,
  alternatingBandAtPulse, alternatingBandPulseTargetTile, footholdBandAtSlot, footholdBandPulseTargetTile,
} from '../../apps/lab/src/food-band-foothold/model.ts';
import { HungryWorld as HistoricalAlternatingWorld } from '../../apps/lab/src/alternating-food/model.ts';

// The replays are kept out of git (docs/creative-prototypes/ARTIFACTS.md); restore them to run these checks.
const hasReplays = ['food-band-foothold-seed-1202.json'].every((name) => existsSync(new URL(`../../docs/creative-prototypes/${name}`, import.meta.url)));
const {
  AttemptRecorder, BASELINE_SNAPSHOTS, FIXED_SNAPSHOTS, LOADED_SOURCE_SHA256, SEASONAL_BLOCKS, WINDOWS, baselineData, validateHistoricalReference,
  assertPinnedInputs, evaluateGate, evaluateSeasonalGate, evaluateSpatialGate, expectedSampleTicks, expectedSnapshotTicks,
  parseArgs, summarizeWindow, validateBandAccounting, validateBandProgress, validateEnvironment, validateEvidenceStructure, validateFrame, validateRepeatProof,
  validateSnapshot, validateTickRows, verifyAttemptReservation, validatePrefixPayload, makePrefixProof, sealPrefixBarrier, verifyPrefixBarrier, summarizeRecovery,
} = (hasReplays ? await import('../food-floor-longevity-replication/explore.ts') : {}) as typeof import('../food-floor-longevity-replication/explore.ts');

describe('food-floor longevity schedule', () => {
  it('uses the frozen majority boundaries without stepping biology', () => {
    expect([0,99,100,199,200,299,300,599].map(alternatingBandAtPulse)).toEqual([0,0,1,1,0,0,1,1]);
    expect([500,504,505,1000,1005,3000].map((t)=>alternatingBandAtPulse(Math.floor(t/5)-1))).toEqual([0,0,1,1,0,1]);
    expect([0,95,96,191,192,767].map(j=>footholdBandAtSlot(0,j))).toEqual([0,0,1,1,0,0]);
    expect([0,95,96,191,192,767].map(j=>footholdBandAtSlot(100,j))).toEqual([0,0,1,1,1,1]);
  });

  it('checks all 1200 pulse allocations, exact ranks, and limited reachable coverage', () => {
    const union=[new Set<number>(),new Set<number>()],floor=[new Set<number>(),new Set<number>()],offered=[0,0];
    for(let pulse=0;pulse<1200;pulse++){
      const targets=Array.from({length:768},(_,slot)=>footholdBandPulseTargetTile(pulse,slot,1202));
      expect(new Set(targets).size,`distinct pulse ${pulse}`).toBe(768);
      const count=[0,0],majority=alternatingBandAtPulse(pulse);
      for(let slot=0;slot<768;slot++){
        const band=footholdBandAtSlot(pulse,slot),tile=targets[slot]!;
        const rank=((pulse*768+slot)*2053+1202%2304)%2304;
        const expected=Math.floor(rank/24)*96+(rank%24)+(band===0?0:48);
        expect(tile).toBe(expected);count[band]++;offered[band]++;union[band]!.add(tile);if(slot<192)floor[band]!.add(tile);
      }
      expect(count).toEqual(majority===0?[672,96]:[96,672]);
    }
    expect(offered).toEqual([460800,460800]);
    expect(floor.map(x=>x.size)).toEqual([288,288]);
    expect(union.map(x=>x.size)).toEqual([2016,2016]);
    expect(new Set([...union[0]!,...union[1]!]).size).toBe(4032);
    expect(()=>footholdBandAtSlot(0,768)).toThrow(RangeError);
    expect(()=>footholdBandPulseTargetTile(-1,0,1202)).toThrow(RangeError);
    expect(()=>footholdBandPulseTargetTile(0,0,-1)).toThrow(RangeError);
  });

  it('preserves initialization for existing modes and reports the new geometric metadata', () => {
    for(const mode of ['original','uniform','patches','moving-band','stationary-band','split-band','alternating-band'] as const){
      const historical=new HistoricalAlternatingWorld(1202,true,mode),isolated=new HungryWorld(1202,true,mode);
      expect(isolated.snapshot()).toEqual(historical.snapshot());expect(isolated.environment).toEqual(historical.environment);
      expect(isolated.foodTargets).toEqual(historical.foodTargets);
    }
    const foothold=new HungryWorld(1202,true,'foothold-band'),historical=new HistoricalAlternatingWorld(1202,true,'alternating-band');
    expect(foothold.snapshot()).toEqual(historical.snapshot());
    expect(foothold.environment).toEqual({version:1,mode:'foothold-band',pulseBudget:768,targetCount:4608,pulses:0,offered:0,accepted:0,overflow:0,initialFoodPerTile:20,bandColumns:SPLIT_BAND_COLUMNS,bandWidth:24,activeBand:0,floorPerBand:96,alternatingBudget:576,bandOffered:[0,0],bandAccepted:[0,0],bandOverflow:[0,0]});
    expect(foothold.foodTargets.length).toBe(4608);
  });

  it('checks cumulative floor and majority offers at the switch without biological stepping',()=>{
    const offeredAt=(tick:number)=>{const offered=[0,0];for(let p=0;p<Math.floor(tick/5);p++)for(let j=0;j<768;j++)offered[footholdBandAtSlot(p,j)]++;return offered;};
    expect(offeredAt(500)).toEqual([67200,9600]);expect(offeredAt(504)).toEqual([67200,9600]);expect(offeredAt(505)).toEqual([67296,10272]);
  });

  it.skipIf(!hasReplays)('validates synthetic per-band accounting and rejects bad floor metadata',()=>{
    const environment={version:1,mode:'foothold-band',pulseBudget:768,targetCount:4608,pulses:101,offered:77568,accepted:57000,overflow:20568,initialFoodPerTile:20,bandColumns:SPLIT_BAND_COLUMNS,bandWidth:24,activeBand:1,floorPerBand:96,alternatingBudget:576,bandOffered:[67296,10272],bandAccepted:[50000,7000],bandOverflow:[17296,3272]};
    expect(()=>validateEnvironment(environment,505,'environment','foothold-band')).not.toThrow();
    expect(()=>validateEnvironment({...environment,floorPerBand:95},505,'bad floor','foothold-band')).toThrow(/floor\/allocation/);
    expect(()=>validateEnvironment({...environment,bandOffered:[67296]},505,'bad ledger','foothold-band')).toThrow(/bandOffered malformed/);
    expect(()=>validateEnvironment({...environment,activeBand:0},505,'bad majority','foothold-band')).toThrow(/majority band/);
    expect(()=>validateBandAccounting({...environment,bandAccepted:[-1,7000]} as any)).toThrow(/nonnegative safe integers/);
    expect(()=>validateBandAccounting({...environment,bandOverflow:[67297,10272]} as any)).toThrow(/exceeds offered/);
  });
});

describe.skipIf(!hasReplays)('food-floor longevity assay gates and CLI', () => {
  it('checks the pinned historical artifact raw, index, and parsed-data digests', () => {
    const baseline=baselineData();
    expect(baseline).toMatchObject({kind:'hungry-shapes-food-band-foothold-arm',run:{seed:1202,mode:'foothold-band'},dataSha256:'f815bdbeb3e9fc5fdb4b27ebaad87486f5011fde1e06e3e39842a89b739fe0c4'});
    const bytes=readFileSync('docs/creative-prototypes/food-band-foothold-seed-1202.json');
    const indexBytes=readFileSync('docs/creative-prototypes/food-band-foothold-index-1202.json');
    const index=JSON.parse(indexBytes.toString('utf8'));
    expect(()=>validateHistoricalReference(baseline,{...index,kind:'hungry-shapes-food-band-foothold-replication-pair'},bytes,indexBytes)).toThrow(/index binding mismatch/);
    for(const [key,bad] of [['kind','hungry-shapes-food-floor-replication-arm'],['mode','alternating-band'],['url','food-floor-replication-seed-1203.json']]){
      const wrong=structuredClone(index);wrong.arms.alternating[key!]=bad;
      expect(()=>validateHistoricalReference(baseline,wrong,bytes,indexBytes)).toThrow(/index binding mismatch/);
    }
    expect(()=>validateHistoricalReference(baseline,{...index,seed:1203},bytes,indexBytes)).toThrow(/index binding mismatch/);
    const tampered=structuredClone(baseline);tampered.dataSha256='0'.repeat(64);
    expect(()=>validateHistoricalReference(tampered,JSON.parse(indexBytes.toString('utf8')),bytes,indexBytes)).toThrow(/internal hash mismatch/);
  });

  it('rejects individually valid ledgers that move cumulative food between bands',()=>{
    const env=(pulses:number,offers:[number,number],accepted:[number,number])=>({version:1 as const,mode:'foothold-band' as const,pulseBudget:768,targetCount:4608,pulses,offered:offers[0]+offers[1],accepted:accepted[0]+accepted[1],overflow:offers[0]+offers[1]-accepted[0]-accepted[1],initialFoodPerTile:20,bandColumns:SPLIT_BAND_COLUMNS,bandWidth:24,activeBand:(pulses<=100?0:1) as 0|1,floorPerBand:96 as const,alternatingBudget:576 as const,bandOffered:offers,bandAccepted:accepted,bandOverflow:[offers[0]-accepted[0],offers[1]-accepted[1]] as [number,number]});
    const before=env(100,[67200,9600],[50000,5000]);
    const good=env(104,[67584,12288],[50100,5100]);
    const acceptedBackwards=env(104,[67584,12288],[49999,5201]);
    const overflowBackwards=env(104,[67584,12288],[50385,5215]);
    for(const value of [before,good,acceptedBackwards,overflowBackwards])expect(()=>validateEnvironment(value,value.pulses*5,'valid individual ledger','foothold-band')).not.toThrow();
    expect(()=>validateBandProgress(before,good)).not.toThrow();
    expect(()=>validateBandProgress(before,acceptedBackwards)).toThrow(/cumulative per-band accepted\/overflow decreased/);
    expect(()=>validateBandProgress(before,overflowBackwards)).toThrow(/cumulative per-band accepted\/overflow decreased/);
  });

  it('keeps exact seven-snapshot baseline and outcome schedules', () => {
    expect(BASELINE_SNAPSHOTS).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000]);
    expect(FIXED_SNAPSHOTS).toEqual(Array.from({length:13},(_,i)=>i*500));
  });

  it('applies the seasonal screen to each specified block and boundary', () => {
    expect(SEASONAL_BLOCKS).toEqual([{ from: 4500, to: 5000, fedBand: 1 }, { from: 5000, to: 5500, fedBand: 0 }, { from: 5500, to: 6000, fedBand: 1 }]);
    const gate = evaluateSeasonalGate([
      { fromOccupiedTilesByBand: [100, 100], toOccupiedTilesByBand: [80, 121] },
      { fromOccupiedTilesByBand: [100, 100], toOccupiedTilesByBand: [120, 80] },
      { fromOccupiedTilesByBand: [100, 100], toOccupiedTilesByBand: [119, 81] },
    ]);
    expect(gate.blocks.map((b: any) => b.deltasByBand)).toEqual([[-20, 21], [20, -20], [19, -19]]);
    expect(gate.blocks.map((b: any) => b.pass)).toEqual([true, true, false]);
    expect(gate.pass).toBe(true);
    expect(evaluateSeasonalGate([{ fromOccupiedTilesByBand: null, toOccupiedTilesByBand: null }]).pass).toBe(false);
  });

  it('fails activity gates on extinction and keeps true terminal evidence only', () => {
    const windows = WINDOWS.map((w) => ({ from: w.from, to: w.to, status: 'complete', executedTicks: 500, births: 2, deaths: 2, cap48Ticks: 0 }));
    expect(evaluateGate(6000, { population: 2, familyCounts: [1, 1, 0] } as any, windows).numericalPass).toBe(true);
    expect(evaluateGate(1500, { population: 0, familyCounts: [0, 0, 0] } as any, windows).numericalPass).toBe(false);
    expect(expectedSampleTicks(103, 103)).toEqual([0, 20, 40, 60, 80, 100, 103]);
    expect(expectedSnapshotTicks(103, 103)).toEqual([0, 103]);
  });

  it('rejects malformed evidence and incomplete repeat proof', () => {
    expect(() => validateEvidenceStructure({ schemaVersion: 1 })).toThrow(/required fields mismatch/);
    expect(() => validateRepeatProof({ verified: true, comparedThroughTick: 3000, stateChecks: 151, frameChecks: 150 }, 3000, 151, 151)).toThrow(/repeat proof mismatch/);
    expect(() => validateRepeatProof({ verified: true, comparedThroughTick: 101, stateChecks: 6, frameChecks: 6 }, 103, 7, 7)).toThrow(/repeat proof mismatch/);
  });

  it('covers activity, cap, spatial, and early-window gate boundaries', () => {
    const passing = WINDOWS.map((w) => ({ from:w.from,to:w.to,status:'complete',executedTicks:500,births:1,deaths:1,cap48Ticks:99 }));
    const aliveTwoFamilies = { population:2,familyCounts:[1,1,0] } as any;
    expect(evaluateGate(6000,aliveTwoFamilies,passing).numericalPass).toBe(true);
    const cap100 = structuredClone(passing); cap100[1]!.cap48Ticks=100;
    expect(evaluateGate(6000,aliveTwoFamilies,cap100).eachNewWindowCap48AtMost99).toBe(false);
    const zeroBirths = structuredClone(passing); zeroBirths[0]!.births=0;
    expect(evaluateGate(6000,aliveTwoFamilies,zeroBirths).eachNewWindowHasBirthsAndDeaths).toBe(false);
    const zeroDeaths = structuredClone(passing); zeroDeaths[2]!.deaths=0;
    expect(evaluateGate(6000,aliveTwoFamilies,zeroDeaths).eachNewWindowHasBirthsAndDeaths).toBe(false);
    expect(evaluateGate(6000,{population:2,familyCounts:[2,0,0]} as any,passing).atLeastTwoFamiliesAt6000).toBe(false);
    expect(evaluateGate(6000,{population:0,familyCounts:[0,0,0]} as any,passing).aliveAt6000).toBe(false);
    expect(evaluateSpatialGate([{tick:5500,occupiedTilesByBand:[9,10]},{tick:6000,occupiedTilesByBand:[10,10]}]).pass).toBe(false);
    expect(evaluateSpatialGate([{tick:5500,occupiedTilesByBand:[10,10]},{tick:6000,occupiedTilesByBand:[10,10]}]).pass).toBe(true);
    expect(evaluateSpatialGate([{tick:5500,occupiedTilesByBand:[10,10]},{tick:6000,occupiedTilesByBand:null}]).pass).toBe(false);
    expect(summarizeWindow(WINDOWS[0]!,[],[],[],[])).toMatchObject({status:'not-reached',executedTicks:0,endpoint:{actualTick:null}});
  });

  it('rejects a rehashed non-snapshot frame with a disconnected body or excess cells', () => {
    const food=Buffer.alloc(RULES.tileCount, RULES.initialFood);
    const makeFrame=(tiles:number[])=>{
      const cells=tiles.map((tile)=>[tile,1] as [number,number]).sort((a,b)=>a[0]-b[0]);
      const actual=food.reduce((sum,n)=>sum+n,0)+cells.length*RULES.structurePerCell;
      const base={tick:520,censusSha256:'1'.repeat(64),stateSha256:'2'.repeat(64),foodBase64:food.toString('base64'),cells,
        organisms:[{id:1,family:0,genome:GENOME_PRESETS[0]}],ledger:{initialEnergy:actual,supplied:0,dissipated:0,deathLoss:0,expected:actual,actual,residual:0}};
      return {...base,frameSha256:createHash('sha256').update(JSON.stringify(base)).digest('hex')};
    };
    expect(()=>validateFrame(makeFrame([0,1]))).not.toThrow();
    expect(()=>validateFrame(makeFrame([0,2]))).toThrow(/disconnected body/);
    expect(()=>validateFrame(makeFrame(Array.from({length:25},(_,i)=>i)))).toThrow(/body cell cap/);
  });

  it('rejects malformed frame, snapshot, tick rows, and stale pins', () => {
    expect(() => validateFrame({tick:0})).toThrow(/required fields mismatch/);
    expect(() => validateSnapshot({} as any,{seed:1202,tick:0,extinctionTick:null})).toThrow(/required fields mismatch/);
    expect(() => validateTickRows([{}],1,null,[],[])).toThrow(/required fields mismatch/);
    expect(() => assertPinnedInputs()).not.toThrow();
    expect(LOADED_SOURCE_SHA256).toHaveProperty('tools/food-floor-longevity-replication/launch.sh');
    expect(LOADED_SOURCE_SHA256).not.toHaveProperty('runs/food-floor-longevity-replication/run-attempt.sh');
    expect(() => assertPinnedInputs({...LOADED_SOURCE_SHA256,'docs/creative-prototypes/food-floor-longevity-replication-plan.md':'0'.repeat(64)})).toThrow(/Pinned input changed/);
  });

  it('reserves the synthetic attempt with empty launcher logs and rejects retry after failure', () => {
    const temporary=mkdtempSync(join(tmpdir(),'food-band-foothold-attempt-'));
    const attemptsRoot=join(temporary,'attempts'),runId='synthetic-1',attemptDir=join(attemptsRoot,`run-${runId}`),prelaunchUtc='2026-10-27T00:00:00Z';
    try {
      mkdirSync(join(attemptsRoot,'reservation.lock'),{recursive:true});mkdirSync(attemptDir);
      const intent={schemaVersion:1,status:'intent-recorded-before-launch',runId,gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),prelaunchUtc,
        intentDurability:'fsynced-before-runner',seed:1202,mode:'foothold-band',maxTick:6000,stop:'actual extinction or tick 6000',
        planSha256:LOADED_SOURCE_SHA256['docs/creative-prototypes/food-floor-longevity-replication-plan.md'],
        modelSha256:LOADED_SOURCE_SHA256['apps/lab/src/food-band-foothold/model.ts'],runnerSha256:LOADED_SOURCE_SHA256['tools/food-floor-longevity-replication/explore.ts'],
        packageJsonSha256:createHash('sha256').update(readFileSync('package.json')).digest('hex'),pnpmLockSha256:createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'),
        historicalArtifactSha256:'eb8da3c6df9e52d5a4d35a34837c611f737f9fa696fdc1fdbe982fd157803bad',historicalDataSha256:'f815bdbeb3e9fc5fdb4b27ebaad87486f5011fde1e06e3e39842a89b739fe0c4',
        historicalIndexSha256:'a6b4591cc590a7ed61d1eb2ef21be6d06f9f3c7c3e69b754f0a1368a5a932de5',historicalValidationSha256:LOADED_SOURCE_SHA256['docs/creative-prototypes/food-band-foothold-validation.md'],
        historicalModelSha256:LOADED_SOURCE_SHA256['apps/lab/src/food-band-foothold/model.ts'],historicalRunnerSha256:LOADED_SOURCE_SHA256['tools/food-band-foothold/explore.ts'],
        launcherSha256:LOADED_SOURCE_SHA256['tools/food-floor-longevity-replication/launch.sh'],nodeVersion:'24.2.0',environment:{NODE_NO_WARNINGS:'1'},command:[process.execPath,'--experimental-strip-types','tools/food-floor-longevity-replication/explore.ts','--write','--seed','1202','--attempt-dir',attemptDir]};
      const intentBytes=`${JSON.stringify(intent)}\n`;writeFileSync(join(attemptDir,'intent.json'),intentBytes);writeFileSync(join(attemptDir,'stdout.log'),'');writeFileSync(join(attemptDir,'stderr.log'),'');
      writeFileSync(join(attemptsRoot,'reservation.json'),JSON.stringify({schemaVersion:1,status:'reserved',runId,attemptDir:`run-${runId}`,prelaunchUtc,gitHead:intent.gitHead,intentSha256:createHash('sha256').update(intentBytes).digest('hex')}));
      const recorder=verifyAttemptReservation(attemptDir,attemptsRoot);recorder.append('ticks.jsonl',{tick:1,synthetic:true});recorder.failure('synthetic-test',new Error('mocked validation failure'),{tick:1});
      expect(() => verifyAttemptReservation(attemptDir,attemptsRoot)).toThrow(/unexpected or prior-run files|already started/);
    } finally { rmSync(temporary,{recursive:true,force:true}); }
  });

  it('requires explicit seed and only supports read-only check or write actions', () => {
    expect(parseArgs(['--check', '--seed', '1202'])).toEqual({ mode: '--check', seed: 1202 });
    expect(parseArgs(['--write', '--seed', '1202', '--attempt-dir', '/tmp/attempt'])).toEqual({ mode: '--write', seed: 1202, attemptDir: '/tmp/attempt' });
    expect(() => parseArgs(['--write', '--seed', '1202'])).toThrow(/durable --attempt-dir/);
    expect(() => parseArgs(['--write', '--seed', '1203', '--attempt-dir', '/tmp/attempt'])).toThrow(/frozen to seed 1202/);
    expect(() => parseArgs(['--write', '--seed=1202'])).toThrow(/explicit --seed/);
  });
});

describe.skipIf(!hasReplays)('longevity prefix barrier and descriptive recovery',()=>{
  it('requires exact rows, samples, frames and snapshots before sealing the durable prefix barrier',()=>{
    const prior=baselineData();expect(()=>validatePrefixPayload(prior,prior)).not.toThrow();
    const temporary=mkdtempSync(join(tmpdir(),'floor-prefix-barrier-'));
    const recorder=new AttemptRecorder(temporary);
    try{
      for(const key of ['tickRows','samples','frames','snapshots']){
        const changed=structuredClone(prior);changed[key][1].tick++;
        expect(()=>sealPrefixBarrier(changed,prior,recorder)).toThrow(/historical prefix/);
      }
      expect(()=>readFileSync(join(temporary,'prefix-verified.json'))).toThrow();
      const proof=sealPrefixBarrier(prior,prior,recorder);
      expect(proof).toEqual(makePrefixProof(prior));expect(()=>verifyPrefixBarrier(recorder,proof)).not.toThrow();
      writeFileSync(join(temporary,'prefix-verified.json'),JSON.stringify({...proof,comparedTickRows:2999}));
      expect(()=>verifyPrefixBarrier(recorder,proof)).toThrow(/barrier mismatch/);
      expect(()=>sealPrefixBarrier(prior,prior,recorder)).toThrow(/EEXIST/);
    }finally{rmSync(temporary,{recursive:true,force:true});}
  });

  function fixture(finalTick:number,population:(tick:number)=>number){
    const rows=Array.from({length:finalTick-3000},(_,i)=>({tick:3001+i,population:population(3001+i),cells:0,births:0,deaths:0,blockedCap:0,blockedSpace:0,cap48:false,nearCap47:false}));
    // Deliberate historical high population must not count as new threshold attainment.
    rows.unshift({tick:3000,population:48,cells:0,births:0,deaths:0,blockedCap:0,blockedSpace:0,cap48:false,nearCap47:false});
    const ticks=[3000,...Array.from({length:6},(_,i)=>3500+i*500).filter(t=>t<=finalTick)];if(!ticks.includes(finalTick))ticks.push(finalTick);
    const samples=ticks.map(tick=>({tick,census:{tick,population:population(tick),cells:0,familyCounts:[0,1,1],maxGeneration:0},environment:{offered:0,accepted:0,overflow:0}})) as any;
    const frames=ticks.map(tick=>({tick,cells:[],organisms:[],foodBase64:Buffer.alloc(RULES.tileCount).toString('base64')})) as any;
    return summarizeRecovery(rows,samples,frames,[]);
  }
  it('reports all six partial/unreached windows and excludes historical threshold attainment',()=>{
    const result=fixture(3003,()=>16);
    expect(result.windows.map((w:any)=>w.status)).toEqual(['partial','not-reached','not-reached','not-reached','not-reached','not-reached']);
    expect(result.windows[0]).toMatchObject({executedTicks:3,meanPopulation:16,endpoint:{actualTick:3003}});
    expect(result.windows[1]).toMatchObject({executedTicks:0,meanPopulation:null,endpoint:{actualTick:null}});
    expect(result.firstPost3000TickAtLeast32).toBe(null);
    expect(result.last500Executed).toEqual({from:3001,to:3003,executedTicks:3,meanPopulation:16,isComplete5501To6000:false,meanAtLeast32:false});
    expect(result.sustainedPopulationSummary).toBe(false);
  });
  it('separates transient threshold attainment from sustained late population and rejects exact-horizon extinction',()=>{
    const healthy=fixture(6000,t=>t===4500||t===4501?5:34);
    expect(healthy).toMatchObject({populationThreshold:32,thresholdInterpretation:'attainment-not-rebound',baselinePopulation:34,firstPost3000TickAtLeast32:3001,tailMinimum:{population:5,tick:4500},tailEndpoint:{population:34,tick:6000}});
    expect(healthy.populationPath).toHaveLength(3000);expect(healthy.populationPath[0]).toEqual({tick:3001,population:34});
    const spike=fixture(6000,t=>t===3002?32:16);
    expect(spike.firstPost3000TickAtLeast32).toBe(3002);expect(spike.sustainedPopulationSummary).toBe(false);
    expect(spike.windows).toHaveLength(6);expect(spike.last500Executed).toMatchObject({from:5501,to:6000,executedTicks:500,meanPopulation:16,isComplete5501To6000:true});
    const sustained=fixture(6000,t=>t>=5501?32:16);expect(sustained.firstPost3000TickAtLeast32).toBe(5501);expect(sustained.sustainedPopulationSummary).toBe(true);
    const extinct=fixture(5700,()=>0);expect(extinct.last500Executed.isComplete5501To6000).toBe(false);expect(extinct.windows[5].status).toBe('partial');
    const passing=WINDOWS.map(()=>({status:'complete',executedTicks:500,births:1,deaths:1,cap48Ticks:0}));
    expect(evaluateGate(6000,{population:0,familyCounts:[0,0,0]} as any,passing).numericalPass).toBe(false);
  });
});
