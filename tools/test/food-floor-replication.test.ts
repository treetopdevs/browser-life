import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALTERNATING_BAND_TARGET_COUNT, GENOME_PRESETS, HungryWorld, RULES, SPLIT_BAND_COLUMNS,
  alternatingBandAtPulse, alternatingBandPulseTargetTile, footholdBandAtSlot, footholdBandPulseTargetTile,
} from '../../apps/lab/src/food-band-foothold/model.ts';
import { HungryWorld as HistoricalAlternatingWorld } from '../../apps/lab/src/alternating-food/model.ts';
import {
  AttemptRecorder, BASELINE_SNAPSHOTS, FIXED_SNAPSHOTS, LOADED_SOURCE_SHA256, SEASONAL_BLOCKS, WINDOWS, baselineData, validateHistoricalReference,
  assertPinnedInputs, evaluateGate, evaluateSeasonalGate, evaluateSpatialGate, expectedSampleTicks, expectedSnapshotTicks,
  parseArgs, summarizeWindow, validateBandAccounting, validateBandProgress, validateEnvironment, validateEvidenceStructure, validateFrame, validateRepeatProof,
  validateSnapshot, validateTickRows, verifyAttemptReservation,
} from '../food-floor-replication/explore.ts';

describe('food-floor replication schedule', () => {
  it('uses the frozen majority boundaries without stepping biology', () => {
    expect([0,99,100,199,200,299,300,599].map(alternatingBandAtPulse)).toEqual([0,0,1,1,0,0,1,1]);
    expect([500,504,505,1000,1005,3000].map((t)=>alternatingBandAtPulse(Math.floor(t/5)-1))).toEqual([0,0,1,1,0,1]);
    expect([0,95,96,191,192,767].map(j=>footholdBandAtSlot(0,j))).toEqual([0,0,1,1,0,0]);
    expect([0,95,96,191,192,767].map(j=>footholdBandAtSlot(100,j))).toEqual([0,0,1,1,1,1]);
  });

  it('checks all 600 pulse allocations, exact ranks, and limited reachable coverage', () => {
    const union=[new Set<number>(),new Set<number>()],floor=[new Set<number>(),new Set<number>()],offered=[0,0];
    for(let pulse=0;pulse<600;pulse++){
      const targets=Array.from({length:768},(_,slot)=>footholdBandPulseTargetTile(pulse,slot,1203));
      expect(new Set(targets).size,`distinct pulse ${pulse}`).toBe(768);
      const count=[0,0],majority=alternatingBandAtPulse(pulse);
      for(let slot=0;slot<768;slot++){
        const band=footholdBandAtSlot(pulse,slot),tile=targets[slot]!;
        const rank=((pulse*768+slot)*2053+1203%2304)%2304;
        const expected=Math.floor(rank/24)*96+(rank%24)+(band===0?0:48);
        expect(tile).toBe(expected);count[band]++;offered[band]++;union[band]!.add(tile);if(slot<192)floor[band]!.add(tile);
      }
      expect(count).toEqual(majority===0?[672,96]:[96,672]);
    }
    expect(offered).toEqual([230400,230400]);
    expect(floor.map(x=>x.size)).toEqual([288,288]);
    expect(union.map(x=>x.size)).toEqual([2016,2016]);
    expect(new Set([...union[0]!,...union[1]!]).size).toBe(4032);
    expect(()=>footholdBandAtSlot(0,768)).toThrow(RangeError);
    expect(()=>footholdBandPulseTargetTile(-1,0,1203)).toThrow(RangeError);
    expect(()=>footholdBandPulseTargetTile(0,0,-1)).toThrow(RangeError);
  });

  it('preserves initialization for existing modes and reports the new geometric metadata', () => {
    for(const mode of ['original','uniform','patches','moving-band','stationary-band','split-band','alternating-band'] as const){
      const historical=new HistoricalAlternatingWorld(1203,true,mode),isolated=new HungryWorld(1203,true,mode);
      expect(isolated.snapshot()).toEqual(historical.snapshot());expect(isolated.environment).toEqual(historical.environment);
      expect(isolated.foodTargets).toEqual(historical.foodTargets);
    }
    const foothold=new HungryWorld(1203,true,'foothold-band'),historical=new HistoricalAlternatingWorld(1203,true,'alternating-band');
    expect(foothold.snapshot()).toEqual(historical.snapshot());
    expect(foothold.environment).toEqual({version:1,mode:'foothold-band',pulseBudget:768,targetCount:4608,pulses:0,offered:0,accepted:0,overflow:0,initialFoodPerTile:20,bandColumns:SPLIT_BAND_COLUMNS,bandWidth:24,activeBand:0,floorPerBand:96,alternatingBudget:576,bandOffered:[0,0],bandAccepted:[0,0],bandOverflow:[0,0]});
    expect(foothold.foodTargets.length).toBe(4608);
  });

  it('checks cumulative floor and majority offers at the switch without biological stepping',()=>{
    const offeredAt=(tick:number)=>{const offered=[0,0];for(let p=0;p<Math.floor(tick/5);p++)for(let j=0;j<768;j++)offered[footholdBandAtSlot(p,j)]++;return offered;};
    expect(offeredAt(500)).toEqual([67200,9600]);expect(offeredAt(504)).toEqual([67200,9600]);expect(offeredAt(505)).toEqual([67296,10272]);
  });

  it('validates synthetic per-band accounting and rejects bad floor metadata',()=>{
    const environment={version:1,mode:'foothold-band',pulseBudget:768,targetCount:4608,pulses:101,offered:77568,accepted:57000,overflow:20568,initialFoodPerTile:20,bandColumns:SPLIT_BAND_COLUMNS,bandWidth:24,activeBand:1,floorPerBand:96,alternatingBudget:576,bandOffered:[67296,10272],bandAccepted:[50000,7000],bandOverflow:[17296,3272]};
    expect(()=>validateEnvironment(environment,505,'environment','foothold-band')).not.toThrow();
    expect(()=>validateEnvironment({...environment,floorPerBand:95},505,'bad floor','foothold-band')).toThrow(/floor\/allocation/);
    expect(()=>validateEnvironment({...environment,bandOffered:[67296]},505,'bad ledger','foothold-band')).toThrow(/bandOffered malformed/);
    expect(()=>validateEnvironment({...environment,activeBand:0},505,'bad majority','foothold-band')).toThrow(/majority band/);
    expect(()=>validateBandAccounting({...environment,bandAccepted:[-1,7000]} as any)).toThrow(/nonnegative safe integers/);
    expect(()=>validateBandAccounting({...environment,bandOverflow:[67297,10272]} as any)).toThrow(/exceeds offered/);
  });
});

describe('food-floor replication assay gates and CLI', () => {
  it('checks the pinned historical artifact raw, index, and parsed-data digests', () => {
    const baseline=baselineData();
    expect(baseline).toMatchObject({kind:'hungry-shapes-alternating-food-arm',run:{seed:1203,mode:'alternating-band'},dataSha256:'5f958ff21d67940e8d92c345de4b2fff58c74368ddaea7227cab98e7cbfc63e4'});
    const bytes=readFileSync('docs/creative-prototypes/alternating-food-seed-1203.json');
    const indexBytes=readFileSync('docs/creative-prototypes/alternating-food-index-1203.json');
    const index=JSON.parse(indexBytes.toString('utf8'));
    expect(()=>validateHistoricalReference(baseline,{...index,kind:'hungry-shapes-alternating-food-replication-pair'},bytes,indexBytes)).toThrow(/index binding mismatch/);
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
    expect(FIXED_SNAPSHOTS).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000]);
  });

  it('applies the seasonal screen to each specified block and boundary', () => {
    expect(SEASONAL_BLOCKS).toEqual([{ from: 1500, to: 2000, fedBand: 1 }, { from: 2000, to: 2500, fedBand: 0 }, { from: 2500, to: 3000, fedBand: 1 }]);
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
    expect(evaluateGate(3000, { population: 2, familyCounts: [1, 1, 0] } as any, windows).numericalPass).toBe(true);
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
    expect(evaluateGate(3000,aliveTwoFamilies,passing).numericalPass).toBe(true);
    const cap100 = structuredClone(passing); cap100[1]!.cap48Ticks=100;
    expect(evaluateGate(3000,aliveTwoFamilies,cap100).eachNewWindowCap48AtMost99).toBe(false);
    const zeroBirths = structuredClone(passing); zeroBirths[0]!.births=0;
    expect(evaluateGate(3000,aliveTwoFamilies,zeroBirths).eachNewWindowHasBirthsAndDeaths).toBe(false);
    const zeroDeaths = structuredClone(passing); zeroDeaths[2]!.deaths=0;
    expect(evaluateGate(3000,aliveTwoFamilies,zeroDeaths).eachNewWindowHasBirthsAndDeaths).toBe(false);
    expect(evaluateGate(3000,{population:2,familyCounts:[2,0,0]} as any,passing).atLeastTwoFamiliesAt3000).toBe(false);
    expect(evaluateGate(3000,{population:0,familyCounts:[0,0,0]} as any,passing).aliveAt3000).toBe(false);
    expect(evaluateSpatialGate([{tick:2500,occupiedTilesByBand:[9,10]},{tick:3000,occupiedTilesByBand:[10,10]}]).pass).toBe(false);
    expect(evaluateSpatialGate([{tick:2500,occupiedTilesByBand:[10,10]},{tick:3000,occupiedTilesByBand:[10,10]}]).pass).toBe(true);
    expect(evaluateSpatialGate([{tick:2500,occupiedTilesByBand:[10,10]},{tick:3000,occupiedTilesByBand:null}]).pass).toBe(false);
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
    expect(() => validateSnapshot({} as any,{seed:1203,tick:0,extinctionTick:null})).toThrow(/required fields mismatch/);
    expect(() => validateTickRows([{}],1,null,[],[])).toThrow(/required fields mismatch/);
    expect(() => assertPinnedInputs()).not.toThrow();
    expect(LOADED_SOURCE_SHA256).toHaveProperty('tools/food-floor-replication/launch.sh');
    expect(LOADED_SOURCE_SHA256).not.toHaveProperty('runs/food-floor-replication/run-attempt.sh');
    expect(() => assertPinnedInputs({...LOADED_SOURCE_SHA256,'docs/creative-prototypes/food-floor-replication-plan.md':'0'.repeat(64)})).toThrow(/Pinned input changed/);
  });

  it('reserves the synthetic attempt with empty launcher logs and rejects retry after failure', () => {
    const temporary=mkdtempSync(join(tmpdir(),'alternating-food-attempt-'));
    const attemptsRoot=join(temporary,'attempts'),runId='synthetic-1',attemptDir=join(attemptsRoot,`run-${runId}`),prelaunchUtc='2026-10-27T00:00:00Z';
    try {
      mkdirSync(join(attemptsRoot,'reservation.lock'),{recursive:true});mkdirSync(attemptDir);
      const intent={schemaVersion:1,status:'intent-recorded-before-launch',runId,gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),prelaunchUtc,
        intentDurability:'fsynced-before-runner',seed:1203,mode:'foothold-band',maxTick:3000,stop:'actual extinction or tick 3000',
        planSha256:LOADED_SOURCE_SHA256['docs/creative-prototypes/food-floor-replication-plan.md'],
        modelSha256:LOADED_SOURCE_SHA256['apps/lab/src/food-band-foothold/model.ts'],runnerSha256:LOADED_SOURCE_SHA256['tools/food-floor-replication/explore.ts'],
        packageJsonSha256:createHash('sha256').update(readFileSync('package.json')).digest('hex'),pnpmLockSha256:createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'),
        historicalArtifactSha256:'f4f5e28294c4806b2b31b4776dbdd42ab9cf70d4307279787c2649298d34123b',historicalDataSha256:'5f958ff21d67940e8d92c345de4b2fff58c74368ddaea7227cab98e7cbfc63e4',
        historicalIndexSha256:'aa6979c401989913ab5b6f69aa7db0e778ca493dbaf1f6261b529da33ae26915',historicalValidationSha256:LOADED_SOURCE_SHA256['docs/creative-prototypes/alternating-food-validation.md'],
        historicalModelSha256:LOADED_SOURCE_SHA256['apps/lab/src/alternating-food/model.ts'],historicalRunnerSha256:LOADED_SOURCE_SHA256['tools/alternating-food/explore.ts'],
        launcherSha256:LOADED_SOURCE_SHA256['tools/food-floor-replication/launch.sh'],nodeVersion:'24.2.0',environment:{NODE_NO_WARNINGS:'1'},command:[process.execPath,'--experimental-strip-types','tools/food-floor-replication/explore.ts','--write','--seed','1203','--attempt-dir',attemptDir]};
      const intentBytes=`${JSON.stringify(intent)}\n`;writeFileSync(join(attemptDir,'intent.json'),intentBytes);writeFileSync(join(attemptDir,'stdout.log'),'');writeFileSync(join(attemptDir,'stderr.log'),'');
      writeFileSync(join(attemptsRoot,'reservation.json'),JSON.stringify({schemaVersion:1,status:'reserved',runId,attemptDir:`run-${runId}`,prelaunchUtc,gitHead:intent.gitHead,intentSha256:createHash('sha256').update(intentBytes).digest('hex')}));
      const recorder=verifyAttemptReservation(attemptDir,attemptsRoot);recorder.append('ticks.jsonl',{tick:1,synthetic:true});recorder.failure('synthetic-test',new Error('mocked validation failure'),{tick:1});
      expect(() => verifyAttemptReservation(attemptDir,attemptsRoot)).toThrow(/unexpected or prior-run files|already started/);
    } finally { rmSync(temporary,{recursive:true,force:true}); }
  });

  it('requires explicit seed and only supports read-only check or write actions', () => {
    expect(parseArgs(['--check', '--seed', '1203'])).toEqual({ mode: '--check', seed: 1203 });
    expect(parseArgs(['--write', '--seed', '1203', '--attempt-dir', '/tmp/attempt'])).toEqual({ mode: '--write', seed: 1203, attemptDir: '/tmp/attempt' });
    expect(() => parseArgs(['--write', '--seed', '1203'])).toThrow(/durable --attempt-dir/);
    expect(() => parseArgs(['--write', '--seed', '1202', '--attempt-dir', '/tmp/attempt'])).toThrow(/frozen to seed 1203/);
    expect(() => parseArgs(['--write', '--seed=1203'])).toThrow(/explicit --seed/);
  });
});
