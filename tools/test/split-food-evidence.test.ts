import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HungryWorld, RULES } from '../../apps/lab/src/split-food/model.ts';

// The replays are kept out of git (docs/creative-prototypes/ARTIFACTS.md); restore them to run these checks.
const hasReplays = ['moving-food-replication-moving-band-seed-1202.json', 'stationary-food-stationary-band-seed-1202.json'].every((name) => existsSync(new URL(`../../docs/creative-prototypes/${name}`, import.meta.url)));
const {
  FIXED_SNAPSHOTS, LOADED_SOURCE_SHA256, MAX_TICK, OUTPUT_PATHS, SPLIT_FOOD_PLAN_SHA256, WINDOWS,
  assertPinnedInputs, assertWorld, baselineData, evaluateGate, evaluateSpatialGate, formatCompletedOutcome,
  occupiedTilesByBand, parseArgs, summarizeWindow,
  validateEvidenceStructure,
} = (hasReplays ? await import('../split-food/explore.ts') : {}) as typeof import('../split-food/explore.ts');

type R = Record<string, any>;
function census(tick: number): R {
  return { tick, population: 2, cells: 4, familyCounts: [1, 1, 0], births: 12, deaths: 10, maxGeneration: 2 };
}
function environment(tick: number): R {
  const pulses = Math.floor(tick / 5);
  return { offered: pulses * 768, accepted: pulses * 600, overflow: pulses * 168, bandColumns: [[0, 23], [48, 71]] };
}
function frame(tick: number, cells: [number, number][]): R {
  const ids = [...new Set(cells.map(([, id]) => id))];
  return { tick, foodBase64: Buffer.alloc(RULES.tileCount).toString('base64'), cells,
    organisms: ids.map((id) => ({ id, family: id === 1 ? 0 : 1, genome: { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 } })) };
}
function passingWindow(from: number, to: number): R {
  return { from, to, denominatorTicks: 500, status: 'complete', executedTicks: 500, births: 3, deaths: 2, cap48Ticks: 0,
    nearCap47Ticks: 0, blockedCapAttempts: 0, blockedSpaceAttempts: 0, minPopulation: 2, maxPopulation: 8 };
}

function structurallyEarlyEvidence(ticks: number[], finalTick: number, extinctionTick: number | null, frameTicks = ticks): R {
  const prior = baselineData();
  return {
    schemaVersion: 1, kind: 'hungry-shapes-split-food-arm',
    run: { seed: 1202, mode: 'split-band', mutation: true, maxTick: 3000, finalTick, extinctionTick },
    runtime: { node: '24.2.0', platform: 'darwin', arch: 'arm64' }, rules: RULES,
    provenance: {
      sourceSha256: { ...LOADED_SOURCE_SHA256 }, planSha256: SPLIT_FOOD_PLAN_SHA256,
      baselineArtifactSha256: '1c85fd8477644da9fb2bd54df0f5c1a463103db6ac49022e2caa2b0611badd39',
      baselineDataSha256: '3c3ee5857d3f1f3f4eb2cad6eed6a1863db324e6bc5ed19635532a69b3f25bcf',
      baselineIndexSha256: '3462a1e0ecd74c98a465395dceebbe4d1c28e19f272a451a8abb3edd18b3ac0c',
      baselineRegression: { status: 'verified', seed: 1202, comparedSamples: 151, comparedFrames: 151, comparedTickRows: 3000,
        comparedSnapshots: 5, checkpoints: prior.snapshots.map((s: R) => ({ tick: s.tick, stateSha256: s.stateSha256, compared: true })) },
    },
    samples: ticks.map((tick) => ({ tick })), frames: frameTicks.map((tick) => ({ tick })), snapshots: [], tickRows: [],
    final: { census: { population: extinctionTick === null ? 1 : 0 }, lineage: [] },
    windows: [], repeat: {}, numericalGate: {}, spatialGate: {}, dataSha256: '0'.repeat(64),
  };
}

describe.skipIf(!hasReplays)('split-food evidence contract', () => {
  it('pins the isolated model, historical reference and output route without running outcomes', () => {
    expect(() => assertPinnedInputs()).not.toThrow();
    expect(LOADED_SOURCE_SHA256['apps/lab/src/split-food/model.ts']).toMatch(/^[a-f0-9]{64}$/);
    expect(LOADED_SOURCE_SHA256['docs/creative-prototypes/split-food-plan.md']).toBe(SPLIT_FOOD_PLAN_SHA256);
    expect(baselineData()).toMatchObject({ kind: 'hungry-shapes-stationary-food-arm', run: { seed: 1202, mode: 'stationary-band', finalTick: 3000 } });
    expect(MAX_TICK).toBe(3000); expect(FIXED_SNAPSHOTS).toEqual([0, 500, 1500, 2500, 3000]);
    expect(OUTPUT_PATHS).toEqual({ json: 'docs/creative-prototypes/split-food-seed-1202.json', markdown: 'docs/creative-prototypes/split-food-seed-1202.md' });
    expect(parseArgs(['--write', '--seed', '1202'])).toEqual({ mode: '--write', seed: 1202 });
    expect(parseArgs(['--check', '--seed', '1202'])).toEqual({ mode: '--check', seed: 1202 });
    expect(() => parseArgs(['--write', '--seed', '1203'])).toThrow(/frozen to seed 1202/);
  });

  it('rejects a structurally stale source map before accepting saved evidence', () => {
    const fixture = structurallyEarlyEvidence([0], 3000, null);
    fixture.provenance.sourceSha256['apps/lab/src/split-food/model.ts'] = '0'.repeat(64);
    expect(() => validateEvidenceStructure(fixture)).toThrow(/stale source hash/);
  });

  it('rejects a missing off-cadence extinction frame even when its terminal sample exists', () => {
    const ticks = Array.from({ length: 16 }, (_, index) => index * 20).concat(302);
    const fixture = structurallyEarlyEvidence(ticks, 302, 302, ticks.slice(0, -1));
    expect(() => validateEvidenceStructure(fixture)).toThrow(/frame cadence\/terminal mismatch/);
  });

  it('rejects missing off-cadence extinction terminal observations', () => {
    const ticks = Array.from({ length: 16 }, (_, index) => index * 20);
    const fixture = structurallyEarlyEvidence(ticks, 303, 303);
    expect(() => validateEvidenceStructure(fixture)).toThrow(/sample cadence\/terminal mismatch/);
  });

  it('validates a real split-band tick-zero state without stepping', () => {
    const world = new HungryWorld(1202, true, 'split-band');
    expect(world.tick).toBe(0);
    expect(world.foodTargets).toHaveLength(4608);
    expect(world.environment).toMatchObject({ mode: 'split-band', targetCount: 4608, pulseBudget: 768, pulses: 0,
      offered: 0, accepted: 0, overflow: 0, bandColumns: [[0, 23], [48, 71]], bandWidth: 24 });
    expect(world.food[0]).toBe(RULES.initialFood);
    expect(world.food[24]).toBe(RULES.initialFood);
    expect(() => assertWorld(world, 'tick-zero split fixture')).not.toThrow();
  });

  it('counts occupied tiles in each exact split band and ignores the gaps', () => {
    const saved = frame(2500, [[0, 1], [23, 1], [24, 2], [47, 2], [48, 3], [71, 3], [72, 4], [95, 4]]);
    expect(occupiedTilesByBand(saved as any)).toEqual([2, 2]);
    expect(evaluateSpatialGate([{ tick: 2500, occupiedTilesByBand: [10, 10] }, { tick: 3000, occupiedTilesByBand: [11, 12] }]).pass).toBe(true);
    expect(evaluateSpatialGate([{ tick: 2500, occupiedTilesByBand: [10, 9] }, { tick: 3000, occupiedTilesByBand: [11, 12] }]).pass).toBe(false);
    expect(evaluateSpatialGate([{ tick: 2500, occupiedTilesByBand: [11, 12] }, { tick: 3000, occupiedTilesByBand: null }]).pass).toBe(false);
  });

  it('summarizes complete, partial and missing late windows from actual rows', () => {
    const rows: R[] = [];
    for (const window of WINDOWS) for (let tick = window.from; tick <= window.to; tick++) rows.push({ tick, population: 2,
      births: 1, deaths: 1, cap48: false, nearCap47: false, blockedCap: 0, blockedSpace: 0 });
    const samples = [1500, 2000, 2500, 3000].map((tick) => ({ tick, census: census(tick), environment: environment(tick) }));
    const cells: [number, number][] = Array.from({ length: 10 }, (_, i) => [[i, 1], [48 + i, 2]] as [number, number][]).flat();
    const frames = [2000, 2500, 3000].map((tick) => frame(tick, cells));
    const complete = summarizeWindow(WINDOWS[0]!, rows as any, samples as any, frames as any, []);
    expect(complete).toMatchObject({ status: 'complete', executedTicks: 500, endpoint: { actualTick: 2000, occupiedTilesByBand: [10, 10] } });
    const partialSamples = [...samples, { tick: 1700, census: census(1700), environment: environment(1700) }];
    const partial = summarizeWindow(WINDOWS[0]!, rows.filter((row) => row.tick <= 1700) as any, partialSamples as any,
      [frame(1700, cells)] as any, []);
    expect(partial).toMatchObject({ status: 'partial', executedTicks: 200, endpoint: { actualTick: 1700 } });
    expect(summarizeWindow(WINDOWS[0]!, [] as any, [] as any, [] as any, [])).toMatchObject({ status: 'not-reached', executedTicks: 0,
      births: null, deaths: null, endpoint: { actualTick: null, occupiedTilesByBand: null } });
  });

  it('gates only full turnover windows and live two-family 3,000 endpoint', () => {
    const windows = [passingWindow(1501, 2000), passingWindow(2001, 2500), passingWindow(2501, 3000)];
    expect(evaluateGate(3000, { population: 2, familyCounts: [1, 1, 0] } as any, windows).numericalPass).toBe(true);
    const partial = structuredClone(windows); partial[2].status = 'partial'; partial[2].executedTicks = 499;
    expect(evaluateGate(3000, { population: 2, familyCounts: [1, 1, 0] } as any, partial).allWindowsReached).toBe(false);
    const noDeaths = structuredClone(windows); noDeaths[1].deaths = 0;
    expect(evaluateGate(3000, { population: 2, familyCounts: [1, 1, 0] } as any, noDeaths).eachNewWindowHasBirthsAndDeaths).toBe(false);
    const tooManyCaps = structuredClone(windows); tooManyCaps[0].cap48Ticks = 100;
    expect(evaluateGate(3000, { population: 2, familyCounts: [1, 1, 0] } as any, tooManyCaps).eachNewWindowCap48AtMost99).toBe(false);
    expect(evaluateGate(3000, { population: 0, familyCounts: [0, 0, 0] } as any, windows).aliveAt3000).toBe(false);
    expect(evaluateGate(3000, { population: 2, familyCounts: [2, 0, 0] } as any, windows).atLeastTwoFamiliesAt3000).toBe(false);
  });

  it('formats complete validated arm criteria for immediate outcome disclosure', () => {
    const windows = [passingWindow(1501, 2000), passingWindow(2001, 2500), passingWindow(2501, 3000)];
    const censusValue = { tick: 3000, population: 2, familyCounts: [1, 1, 0], births: 21, deaths: 19 };
    const environmentValue = { mode: 'split-band', bandColumns: [[0, 23], [48, 71]], bandWidth: 24,
      targetCount: 4608, offered: 460800, accepted: 400000, overflow: 60800 };
    const data = { run: { seed: 1202, mode: 'split-band', finalTick: 3000, extinctionTick: null }, final: { census: censusValue, environment: environmentValue },
      numericalGate: evaluateGate(3000, censusValue as any, windows), spatialGate: evaluateSpatialGate([{ tick: 2500, occupiedTilesByBand: [12, 10] },
        { tick: 3000, occupiedTilesByBand: [11, 13] }]), windows, dataSha256: 'a'.repeat(64) };
    expect(JSON.parse(formatCompletedOutcome(data))).toEqual({ seed: 1202, mode: 'split-band', finalTick: 3000, extinctionTick: null,
      census: censusValue, environment: environmentValue, numericalGate: data.numericalGate, spatialGate: data.spatialGate,
      windows, dataSha256: 'a'.repeat(64) });
  });
});
