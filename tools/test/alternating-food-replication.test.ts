import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALTERNATING_BAND_TARGET_COUNT, GENOME_PRESETS, HungryWorld, RULES, SPLIT_BAND_COLUMNS,
  alternatingBandAtPulse, alternatingBandPulseTargetTile,
} from '../../apps/lab/src/alternating-food/model.ts';
import { HungryWorld as HistoricalSplitWorld } from '../../apps/lab/src/split-food/model.ts';

// The replays are kept out of git (docs/creative-prototypes/ARTIFACTS.md); restore them to run these checks.
const hasReplays = ['split-food-seed-1202.json'].every((name) => existsSync(new URL(`../../docs/creative-prototypes/${name}`, import.meta.url)));
const {
  AttemptRecorder, BASELINE_SNAPSHOTS, FIXED_SNAPSHOTS, LOADED_SOURCE_SHA256, SEASONAL_BLOCKS, WINDOWS, baselineData, validateHistoricalReference,
  assertPinnedInputs, evaluateGate, evaluateSeasonalGate, evaluateSpatialGate, expectedSampleTicks, expectedSnapshotTicks,
  parseArgs, summarizeWindow, validateBandAccounting, validateEnvironment, validateEvidenceStructure, validateFrame, validateRepeatProof,
  validateSnapshot, validateTickRows, verifyAttemptReservation,
} = (hasReplays ? await import('../alternating-food-replication/explore.ts') : {}) as typeof import('../alternating-food-replication/explore.ts');

describe('alternating-food schedule', () => {
  it('uses the frozen 100-pulse band blocks and boundary semantics', () => {
    expect([0, 99, 100, 199, 200, 299, 300, 599].map(alternatingBandAtPulse)).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
    expect([500, 505, 1000, 1005, 3000].map((tick) => alternatingBandAtPulse(tick / 5 - 1))).toEqual([0, 1, 1, 0, 1]);
  });

  it('assigns 768 distinct targets inside the active band for all 600 pulses', () => {
    for (let pulse = 0; pulse < 600; pulse++) {
      const targets = Array.from({ length: 768 }, (_, slot) => alternatingBandPulseTargetTile(pulse, slot, 1202));
      expect(new Set(targets).size, `pulse ${pulse}`).toBe(768);
      const band = alternatingBandAtPulse(pulse);
      expect(targets.every((tile) => {
        const column = tile % RULES.width;
        return band === 0 ? column < 24 : column >= 48 && column < 72;
      }), `pulse ${pulse} active band`).toBe(true);
      expect(targets).toEqual(Array.from({ length: 768 }, (_, slot) => alternatingBandPulseTargetTile(pulse, slot, 1202)));
    }
    const offered = [0, 0];
    for (let pulse = 0; pulse < 600; pulse++) offered[alternatingBandAtPulse(pulse)] += 768;
    expect(offered).toEqual([230_400, 230_400]);
    expect(ALTERNATING_BAND_TARGET_COUNT).toBe(2_304);
  });

  it('keeps static split initialization identical while reporting alternating active-target metadata', () => {
    const split = new HungryWorld(1202, true, 'split-band');
    const alternating = new HungryWorld(1202, true, 'alternating-band');
    expect(alternating.snapshot()).toEqual(split.snapshot());
    expect(alternating.environment).toMatchObject({ mode: 'alternating-band', targetCount: 2304, pulses: 0, offered: 0,
      accepted: 0, overflow: 0, bandColumns: SPLIT_BAND_COLUMNS, bandWidth: 24, activeBand: 0,
      bandOffered: [0, 0], bandAccepted: [0, 0], bandOverflow: [0, 0] });
    expect(alternating.foodTargets).toHaveLength(2304);
    expect(alternating.foodTargets.every((tile) => tile % RULES.width < 24)).toBe(true);
    expect(split.environment).toMatchObject({ mode: 'split-band', targetCount: 4608, bandColumns: SPLIT_BAND_COLUMNS, bandWidth: 24 });
    expect(split.environment).not.toHaveProperty('activeBand');
    const historical = new HistoricalSplitWorld(1201, true, 'split-band');
    const isolated = new HungryWorld(1201, true, 'split-band');
    expect(isolated.snapshot()).toEqual(historical.snapshot());
    expect(isolated.environment).toEqual(historical.environment);
  });

  it('switches current band only after supplying the boundary pulse without stepping biology', () => {
    const offeredAt = (tick: number) => {
      const offered = [0, 0];
      for (let pulse = 0; pulse < Math.floor(tick / 5); pulse++) offered[alternatingBandAtPulse(pulse)] += 768;
      return offered;
    };
    expect(alternatingBandAtPulse(Math.floor(500 / 5) - 1)).toBe(0);
    expect(offeredAt(500)).toEqual([76_800, 0]);
    expect(alternatingBandAtPulse(Math.floor(504 / 5) - 1)).toBe(0);
    expect(alternatingBandAtPulse(Math.floor(505 / 5) - 1)).toBe(1);
    expect(offeredAt(505)).toEqual([76_800, 768]);
    expect(Array.from({ length: 768 }, (_, slot) => alternatingBandPulseTargetTile(100, slot, 1202))
      .every((tile) => tile % RULES.width >= 48 && tile % RULES.width < 72)).toBe(true);
  });

  it.skipIf(!hasReplays)('validates synthetic per-band accounting metadata without stepping biology', () => {
    const environment = { version: 1, mode: 'alternating-band', pulseBudget: 768, targetCount: 2304,
      pulses: 101, offered: 77_568, accepted: 50_700, overflow: 26_868, initialFoodPerTile: 20,
      bandColumns: SPLIT_BAND_COLUMNS, bandWidth: 24, activeBand: 1,
      bandOffered: [76_800, 768], bandAccepted: [50_000, 700], bandOverflow: [26_800, 68] };
    expect(() => validateEnvironment(environment, 505, 'tick 505 environment', 'alternating-band')).not.toThrow();
    expect(() => validateEnvironment({ ...environment, bandOffered: [76_800] }, 505, 'bad environment', 'alternating-band')).toThrow(/bandOffered malformed/);
    expect(() => validateEnvironment({ ...environment, activeBand: 0 }, 505, 'bad active band', 'alternating-band')).toThrow(/active band/);
    expect(() => validateBandAccounting({ ...environment, bandAccepted: [-1, 100] } as any, 'negative per-band ledger')).toThrow(/nonnegative safe integers/);
    expect(() => validateBandAccounting({ ...environment, bandOverflow: [76_801, 768] } as any, 'overflow bound')).toThrow(/exceeds offered/);
  });
});

describe.skipIf(!hasReplays)('alternating-food assay gates and CLI', () => {
  it('checks the pinned historical artifact raw, index, and parsed-data digests', () => {
    const baseline=baselineData();
    expect(baseline).toMatchObject({kind:'hungry-shapes-split-food-arm',run:{seed:1202,mode:'split-band'},dataSha256:'1379b36370340873e531443ab8f9176a19a69d88b942d20e4d982ed81a81a349'});
    const bytes=readFileSync('docs/creative-prototypes/split-food-seed-1202.json');
    const indexBytes=readFileSync('docs/creative-prototypes/split-food-index-1202.json');
    const tampered=structuredClone(baseline);tampered.dataSha256='0'.repeat(64);
    expect(()=>validateHistoricalReference(tampered,JSON.parse(indexBytes.toString('utf8')),bytes,indexBytes)).toThrow(/internal hash mismatch/);
  });

  it('keeps baseline and outcome snapshot schedules distinct', () => {
    expect(BASELINE_SNAPSHOTS).toEqual([0, 500, 1500, 2500, 3000]);
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
    expect(() => validateSnapshot({} as any,{seed:1202,tick:0,extinctionTick:null})).toThrow(/required fields mismatch/);
    expect(() => validateTickRows([{}],1,null,[],[])).toThrow(/required fields mismatch/);
    expect(() => assertPinnedInputs()).not.toThrow();
    expect(LOADED_SOURCE_SHA256).toHaveProperty('tools/alternating-food-replication/launch.sh');
    expect(LOADED_SOURCE_SHA256).not.toHaveProperty('runs/alternating-food-replication/run-attempt.sh');
    expect(() => assertPinnedInputs({...LOADED_SOURCE_SHA256,'docs/creative-prototypes/alternating-food-replication-plan.md':'0'.repeat(64)})).toThrow(/Pinned input changed/);
  });

  it('reserves the synthetic attempt with empty launcher logs and rejects retry after failure', () => {
    const temporary=mkdtempSync(join(tmpdir(),'alternating-food-attempt-'));
    const attemptsRoot=join(temporary,'attempts'),runId='synthetic-1',attemptDir=join(attemptsRoot,`run-${runId}`),prelaunchUtc='2026-10-27T00:00:00Z';
    try {
      mkdirSync(join(attemptsRoot,'reservation.lock'),{recursive:true});mkdirSync(attemptDir);
      const intent={schemaVersion:1,status:'intent-recorded-before-launch',runId,gitHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),prelaunchUtc,
        intentDurability:'fsynced-before-runner',seed:1202,mode:'alternating-band',maxTick:3000,stop:'actual extinction or tick 3000',
        planSha256:LOADED_SOURCE_SHA256['docs/creative-prototypes/alternating-food-replication-plan.md'],
        modelSha256:LOADED_SOURCE_SHA256['apps/lab/src/alternating-food/model.ts'],runnerSha256:LOADED_SOURCE_SHA256['tools/alternating-food-replication/explore.ts'],
        packageJsonSha256:createHash('sha256').update(readFileSync('package.json')).digest('hex'),pnpmLockSha256:createHash('sha256').update(readFileSync('pnpm-lock.yaml')).digest('hex'),
        historicalArtifactSha256:'3f99cf98531a9908a1a2ab9adb7ce2dd6566d2edd08afb4855d99267fbee033b',historicalDataSha256:'1379b36370340873e531443ab8f9176a19a69d88b942d20e4d982ed81a81a349',
        historicalIndexSha256:'e3e3aa26ace9722ca15175d208ba0d5e2aaa09608e03af072695066c14089afc',historicalValidationSha256:LOADED_SOURCE_SHA256['docs/creative-prototypes/split-food-validation.md'],
        copySourceModelSha256:LOADED_SOURCE_SHA256['apps/lab/src/split-food/model.ts'],historicalRunnerSha256:LOADED_SOURCE_SHA256['tools/split-food/explore.ts'],
        launcherSha256:LOADED_SOURCE_SHA256['tools/alternating-food-replication/launch.sh'],nodeVersion:'24.2.0',environment:{NODE_NO_WARNINGS:'1'},command:[process.execPath,'--experimental-strip-types','tools/alternating-food-replication/explore.ts','--write','--seed','1202','--attempt-dir',attemptDir]};
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
