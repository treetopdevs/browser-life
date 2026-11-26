import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HungryWorld, RULES, splitBandPulseTargetTile } from '../../apps/lab/src/split-food/model.ts';

// The replays are kept out of git (docs/creative-prototypes/ARTIFACTS.md); restore them to run these checks.
const hasReplays = ['hungry-shapes-seed-1201.json', 'moving-food-moving-band-seed-1201.json', 'moving-food-replication-moving-band-seed-1203.json', 'moving-food-uniform-seed-1201.json', 'stationary-food-replication-moving-band-seed-1203.json', 'stationary-food-replication-stationary-band-seed-1203.json', 'uniform-endurance-seed-1201.json', 'uniform-endurance-seed-1202.json', 'uniform-endurance-seed-1203.json'].every((name) => existsSync(new URL(`../../docs/creative-prototypes/${name}`, import.meta.url)));
const {
  FIXED_SNAPSHOTS, LOADED_SOURCE_SHA256, MAX_TICK, OUTPUT_PATHS, SPLIT_FOOD_REPLICATION_PLAN_SHA256, WINDOWS,
  assertPinnedInputs, assertWorld, baselineData, evaluateGate, evaluateSpatialGate, formatCompletedOutcome,
  occupiedTilesByBand, parseArgs, summarizeWindow, validateEvidenceStructure, validateHistoricalIndex,
} = (hasReplays ? await import('../split-food-replication/explore.ts') : {}) as typeof import('../split-food-replication/explore.ts');

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
    schemaVersion: 1, kind: 'hungry-shapes-split-food-replication-arm',
    run: { seed: 1203, mode: 'split-band', mutation: true, maxTick: 3000, finalTick, extinctionTick },
    runtime: { node: '24.2.0', platform: 'darwin', arch: 'arm64' }, rules: RULES,
    provenance: {
      sourceSha256: { ...LOADED_SOURCE_SHA256 }, planSha256: SPLIT_FOOD_REPLICATION_PLAN_SHA256,
      baselineArtifactSha256: '234c3c0eb54b5d6875f400e155b95f9afaa20638b511c0a4285305c9aac2ba7c',
      baselineDataSha256: '236e98377fd6795236f2b6ecf3907bb637324866791e12c478e63ac7e9664ba7',
      baselineIndexSha256: '73cf2ebfa0ab266d716d48f1c6b966872ad7cc2a68d7d95fe51729cfab6a16b3',
      baselineRegression: { status: 'verified', seed: 1203, comparedSamples: 151, comparedFrames: 151, comparedTickRows: 3000,
        comparedSnapshots: 5, checkpoints: prior.snapshots.map((s: R) => ({ tick: s.tick, stateSha256: s.stateSha256, compared: true })) },
    },
    samples: ticks.map((tick) => ({ tick })), frames: frameTicks.map((tick) => ({ tick })), snapshots: [], tickRows: [],
    final: { census: { population: extinctionTick === null ? 1 : 0 }, lineage: [] },
    windows: [], repeat: {}, numericalGate: {}, spatialGate: {}, dataSha256: '0'.repeat(64),
  };
}

describe('split-food replication evidence contract', () => {
  it.skipIf(!hasReplays)('pins the isolated model, PR106 historical reference and output route without running outcomes', () => {
    expect(() => assertPinnedInputs()).not.toThrow();
    expect(LOADED_SOURCE_SHA256['apps/lab/src/split-food/model.ts']).toMatch(/^[a-f0-9]{64}$/);
    expect(LOADED_SOURCE_SHA256['docs/creative-prototypes/split-food-replication-plan.md']).toBe(SPLIT_FOOD_REPLICATION_PLAN_SHA256);
    expect(baselineData()).toMatchObject({ kind: 'hungry-shapes-stationary-food-replication-arm', run: { seed: 1203, mode: 'stationary-band', finalTick: 3000 } });
    expect(MAX_TICK).toBe(3000); expect(FIXED_SNAPSHOTS).toEqual([0, 500, 1500, 2500, 3000]);
    expect(OUTPUT_PATHS).toEqual({ json: 'docs/creative-prototypes/split-food-replication-seed-1203.json', markdown: 'docs/creative-prototypes/split-food-replication-seed-1203.md' });
    expect(parseArgs(['--write', '--seed', '1203'])).toEqual({ mode: '--write', seed: 1203 });
    expect(parseArgs(['--check', '--seed', '1203'])).toEqual({ mode: '--check', seed: 1203 });
    expect(() => parseArgs(['--write', '--seed', '1202'])).toThrow(/frozen to seed 1203/);
  });

  it('checks all 600 scheduled pulses for 768 distinct offers and 384 targets per band', () => {
    const targets = Array.from({ length: RULES.tileCount }, (_, tile) => tile)
      .filter((tile) => { const column = tile % RULES.width; return column < 24 || (column >= 48 && column < 72); });
    expect(targets).toHaveLength(4608);
    for (let pulse = 0; pulse < 600; pulse++) {
      const seen = new Set<number>(); const perBand = [0, 0];
      for (let slot = 0; slot < 768; slot++) {
        const tile = splitBandPulseTargetTile(pulse, slot, 1203);
        expect(tile).toBe(targets[((pulse * 768 + slot) * 2053 + (1203 % 4608)) % 4608]);
        expect(seen.has(tile)).toBe(false); seen.add(tile);
        const column = tile % RULES.width;
        if (column < 24) perBand[0]++; else if (column >= 48 && column < 72) perBand[1]++; else throw new Error('food target landed in a gap');
      }
      expect(seen.size).toBe(768); expect(perBand).toEqual([384, 384]);
    }
  });

  it.skipIf(!hasReplays)('requires the PR106 stationary-replication index schema and binding', () => {
    const raw = '234c3c0eb54b5d6875f400e155b95f9afaa20638b511c0a4285305c9aac2ba7c';
    const index = { schemaVersion: 1, kind: 'hungry-shapes-stationary-food-replication-pair', seed: 1203,
      planSha256: '74dc68201c7fb51ed9a87ba75d13e0ad79b171ff0d73d7929af4ba4f03fa114a',
      arms: { movingBand: { mode: 'moving-band', url: 'stationary-food-replication-moving-band-seed-1203.json',
        rawSha256: '000e1ce6a3a60ab216707136ba97edf97bdcde826a63af2d3c27bf54e7810e3d' },
        stationaryBand: { mode: 'stationary-band', url: 'stationary-food-replication-stationary-band-seed-1203.json', rawSha256: raw } },
      decision: { status: 'both', stationaryBandArtifactSha256: raw,
        movingBandArtifactSha256: '000e1ce6a3a60ab216707136ba97edf97bdcde826a63af2d3c27bf54e7810e3d' } };
    expect(() => validateHistoricalIndex(index, raw)).not.toThrow();
    expect(() => validateHistoricalIndex({ ...index, kind: 'hungry-shapes-stationary-food-pair' }, raw))
      .toThrow(/PR106 stationary pair identity mismatch/);
  });

  it.skipIf(!hasReplays)('rejects a structurally stale source map before accepting saved evidence', () => {
    const fixture = structurallyEarlyEvidence([0], 3000, null);
    fixture.provenance.sourceSha256['apps/lab/src/split-food/model.ts'] = '0'.repeat(64);
    expect(() => validateEvidenceStructure(fixture)).toThrow(/stale source hash/);
  });

  it.skipIf(!hasReplays)('rejects a missing off-cadence extinction frame even when its terminal sample exists', () => {
    const ticks = Array.from({ length: 16 }, (_, index) => index * 20).concat(302);
    const fixture = structurallyEarlyEvidence(ticks, 302, 302, ticks.slice(0, -1));
    expect(() => validateEvidenceStructure(fixture)).toThrow(/frame cadence\/terminal mismatch/);
  });

  it.skipIf(!hasReplays)('rejects missing off-cadence extinction terminal observations', () => {
    const ticks = Array.from({ length: 16 }, (_, index) => index * 20);
    const fixture = structurallyEarlyEvidence(ticks, 303, 303);
    expect(() => validateEvidenceStructure(fixture)).toThrow(/sample cadence\/terminal mismatch/);
  });

  it.skipIf(!hasReplays)('validates a real split-band tick-zero state without stepping', () => {
    const world = new HungryWorld(1203, true, 'split-band');
    expect(world.tick).toBe(0);
    expect(world.foodTargets).toHaveLength(4608);
    expect(world.environment).toMatchObject({ mode: 'split-band', targetCount: 4608, pulseBudget: 768, pulses: 0,
      offered: 0, accepted: 0, overflow: 0, bandColumns: [[0, 23], [48, 71]], bandWidth: 24 });
    expect(world.food[0]).toBe(RULES.initialFood);
    expect(world.food[24]).toBe(RULES.initialFood);
    expect(() => assertWorld(world, 'tick-zero split fixture')).not.toThrow();
  });

  it.skipIf(!hasReplays)('counts occupied tiles in each exact split band and ignores the gaps', () => {
    const saved = frame(2500, [[0, 1], [23, 1], [24, 2], [47, 2], [48, 3], [71, 3], [72, 4], [95, 4]]);
    expect(occupiedTilesByBand(saved as any)).toEqual([2, 2]);
    expect(evaluateSpatialGate([{ tick: 2500, occupiedTilesByBand: [10, 10] }, { tick: 3000, occupiedTilesByBand: [11, 12] }]).pass).toBe(true);
    expect(evaluateSpatialGate([{ tick: 2500, occupiedTilesByBand: [10, 9] }, { tick: 3000, occupiedTilesByBand: [11, 12] }]).pass).toBe(false);
    expect(evaluateSpatialGate([{ tick: 2500, occupiedTilesByBand: [11, 12] }, { tick: 3000, occupiedTilesByBand: null }]).pass).toBe(false);
  });

  it.skipIf(!hasReplays)('summarizes complete, partial and missing late windows from actual rows', () => {
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

  it.skipIf(!hasReplays)('gates only full turnover windows and live two-family 3,000 endpoint', () => {
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

  it.skipIf(!hasReplays)('formats complete validated arm criteria for immediate outcome disclosure', () => {
    const windows = [passingWindow(1501, 2000), passingWindow(2001, 2500), passingWindow(2501, 3000)];
    const censusValue = { tick: 3000, population: 2, familyCounts: [1, 1, 0], births: 21, deaths: 19 };
    const environmentValue = { mode: 'split-band', bandColumns: [[0, 23], [48, 71]], bandWidth: 24,
      targetCount: 4608, offered: 460800, accepted: 400000, overflow: 60800 };
    const data = { run: { seed: 1203, mode: 'split-band', finalTick: 3000, extinctionTick: null }, final: { census: censusValue, environment: environmentValue },
      numericalGate: evaluateGate(3000, censusValue as any, windows), spatialGate: evaluateSpatialGate([{ tick: 2500, occupiedTilesByBand: [12, 10] },
        { tick: 3000, occupiedTilesByBand: [11, 13] }]), windows, dataSha256: 'a'.repeat(64) };
    expect(JSON.parse(formatCompletedOutcome(data))).toEqual({ seed: 1203, mode: 'split-band', finalTick: 3000, extinctionTick: null,
      census: censusValue, environment: environmentValue, numericalGate: data.numericalGate, spatialGate: data.spatialGate,
      windows, dataSha256: 'a'.repeat(64) });
  });
});
