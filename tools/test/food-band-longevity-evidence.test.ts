import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HungryWorld, RULES } from '../../apps/lab/src/stationary-food/model.ts';

// The replays are kept out of git (docs/creative-prototypes/ARTIFACTS.md); restore them to run these checks.
const hasReplays = ['hungry-shapes-seed-1201.json', 'moving-food-moving-band-seed-1201.json', 'moving-food-replication-moving-band-seed-1203.json', 'moving-food-uniform-seed-1201.json', 'stationary-food-replication-moving-band-seed-1201.json', 'stationary-food-replication-stationary-band-seed-1201.json', 'uniform-endurance-seed-1201.json', 'uniform-endurance-seed-1202.json', 'uniform-endurance-seed-1203.json'].every((name) => existsSync(new URL(`../../docs/creative-prototypes/${name}`, import.meta.url)));
const {
  BASELINE_FRAME_COUNT, BASELINE_MAX_TICK, BASELINE_SAMPLE_COUNT, BASELINE_SNAPSHOT_COUNT, BASELINE_TICKROW_COUNT,
  FIXED_SNAPSHOTS, FOOD_BAND_LONGEVITY_PLAN_SHA256, LOADED_SOURCE_SHA256, MAX_TICK, OUTPUT_PATHS, WINDOWS,
  assertPinnedInputs, baselineData, evaluateGate, expectedSampleTicks, expectedSnapshotTicks, makeSample, parseArgs, summarizeWindow, validateHistoricalIndexBinding,
  validatePrefixInitial, validatePrefixRecord, validatePrefixSample, validatePrefixSnapshot, validatePrefixTick,
} = (hasReplays ? await import('../food-band-longevity/explore.ts') : {}) as typeof import('../food-band-longevity/explore.ts');

type R = Record<string, any>;
type Mode = 'moving-band' | 'stationary-band';
const REFERENCES: Record<Mode, R> = hasReplays ? {
  'moving-band': baselineData('moving-band'),
  'stationary-band': baselineData('stationary-band'),
} : ({} as Record<Mode, R>);
const HASHES = {
  index: 'd3d7abd9478c4c2a44fb338dd6ef8a1fabcf85ffe633f943c3ddc194b7ab5fbf',
  moving: '570aba2c02c52b7f949c60990b8bf33aa929a5352728c75d01d547666299c294',
  stationary: '65e160a97cd829b6e740db757eaee7364228c4890116a8cb2422f56795675d2b',
};
const INDEX_PATH = new URL('../../docs/creative-prototypes/stationary-food-replication-index-1201.json', import.meta.url);
const ARTIFACT_PATHS: Record<Mode, URL> = {
  'moving-band': new URL('../../docs/creative-prototypes/stationary-food-replication-moving-band-seed-1201.json', import.meta.url),
  'stationary-band': new URL('../../docs/creative-prototypes/stationary-food-replication-stationary-band-seed-1201.json', import.meta.url),
};
function checkpointProof(prior: R): R {
  return {
    status: 'verified', seed: 1201,
    normalization: 'none; exact historical 3,000-tick prefix payload; no normalization',
    comparedSamples: BASELINE_SAMPLE_COUNT, comparedFrames: BASELINE_FRAME_COUNT,
    comparedTickRows: BASELINE_TICKROW_COUNT, comparedSnapshots: BASELINE_SNAPSHOT_COUNT,
    checkpoints: prior.snapshots.map((s: R) => ({ tick: s.tick, stateSha256: s.stateSha256, compared: true })),
  };
}
function prefixRecord(mode: Mode): R {
  const prior = REFERENCES[mode];
  const afterPrefixSample = { tick: 3020 };
  const afterPrefixFrame = { tick: 3020 };
  const afterPrefixRow = { tick: 3001 };
  const afterPrefixSnapshot = { tick: 4500 };
  const laterWindows = WINDOWS.map((w) => ({ from: w.from, to: w.to }));
  return {
    run: { seed: 1201, mode, mutation: true, maxTick: MAX_TICK, finalTick: MAX_TICK, extinctionTick: null },
    rules: structuredClone(prior.rules), provenance: { prefix: checkpointProof(prior) },
    samples: [...structuredClone(prior.samples), afterPrefixSample],
    frames: [...structuredClone(prior.frames), afterPrefixFrame],
    tickRows: [...structuredClone(prior.tickRows), afterPrefixRow],
    snapshots: [...structuredClone(prior.snapshots), afterPrefixSnapshot],
    windows: [...structuredClone(prior.windows), ...laterWindows],
  };
}
function syntheticCensus(tick: number): R {
  return { tick, population: 2, cells: 2, familyCounts: [1, 1, 0], births: 10, deaths: 8,
    maxGeneration: 1, genomeVariantCount: 2 };
}
function syntheticEnvironment(tick: number): R {
  const pulses = Math.floor(tick / 5);
  return { offered: pulses * 768, accepted: pulses * 500, overflow: pulses * 268, bandLeft: Math.floor(tick / 50) % 96 };
}
function windowFixtures(): R[] {
  const rows: R[] = [];
  const samples: R[] = [];
  const frames: R[] = [];
  const endpointTicks = [4500, 5000, 5500, 6000];
  for (const tick of endpointTicks) {
    samples.push({ tick, census: syntheticCensus(tick), environment: syntheticEnvironment(tick) });
    frames.push({ tick, foodBase64: Buffer.alloc(RULES.tileCount).toString('base64'), cells: [], organisms: [] });
  }
  for (const w of WINDOWS) {
    for (let tick = w.from; tick <= w.to; tick++) rows.push({ tick, population: 2, births: 1, deaths: 1,
      cap48: false, nearCap47: false, blockedCap: 0, blockedSpace: 0 });
  }
  return WINDOWS.map((w, i) => summarizeWindow(w, rows as any, samples as any, frames as any, [], i === 0 ? 'moving-band' : 'stationary-band'));
}
function passingWindow(start: number, end: number): R {
  return { from: start + 1, to: end, denominatorTicks: 500, status: 'complete', executedTicks: 500, births: 1, deaths: 1,
    cap48Ticks: 0, nearCap47Ticks: 0, blockedCapAttempts: 0, blockedSpaceAttempts: 0,
    minPopulation: 1, maxPopulation: 2, food: { offered: 76800, accepted: 50000, overflow: 26800 },
    endpoint: { requestedTick: end, actualTick: end, population: 2, cells: 2, familyCounts: [1, 1, 0], genomeCounts: [],
      maxGeneration: 1, maxEverGeneration: 1, foodRemaining: 0, bandLeft: 0, occupiedBandCells: 0, occupiedBandShare: 0 } };
}

 describe.skipIf(!hasReplays)('food-band longevity evidence helpers', () => {
  it('pins the unchanged model, historical runner and references, with seed 1201 only', () => {
    expect(() => assertPinnedInputs()).not.toThrow();
    expect(BASELINE_MAX_TICK).toBe(3000);
    expect(MAX_TICK).toBe(6000);
    expect(FIXED_SNAPSHOTS).toEqual([0, 500, 1500, 2500, 3000, 4500, 5500, 6000]);
    expect(LOADED_SOURCE_SHA256['apps/lab/src/stationary-food/model.ts']).toBe('7bd5af02243cb0629547a20d889a05cd904246a16227f58df4e420edc84a859f');
    expect(LOADED_SOURCE_SHA256['tools/stationary-food-replication/explore.ts']).toBe('18d9c74da2cd2d803923a544c2b717b06976909738699756e16abaa832b316f4');
    expect(LOADED_SOURCE_SHA256['docs/creative-prototypes/food-band-longevity-plan.md']).toBe(FOOD_BAND_LONGEVITY_PLAN_SHA256);
    expect(parseArgs(['--write', '--seed', '1201'])).toEqual({ mode: '--write', seed: 1201 });
    expect(() => parseArgs(['--check', '--seed', '1202'])).toThrow(/frozen to seed 1201/);
    expect(OUTPUT_PATHS).toEqual({
      'moving-band': { json: 'docs/creative-prototypes/food-band-longevity-moving-band-seed-1201.json', markdown: 'docs/creative-prototypes/food-band-longevity-moving-band-seed-1201.md' },
      'stationary-band': { json: 'docs/creative-prototypes/food-band-longevity-stationary-band-seed-1201.json', markdown: 'docs/creative-prototypes/food-band-longevity-stationary-band-seed-1201.md' },
    });
  });

  it.each(['moving-band', 'stationary-band'] as const)('validates pinned PR106 %s reference and pair-index binding', (mode) => {
    const prior = REFERENCES[mode];
    expect(prior.kind).toBe('hungry-shapes-stationary-food-replication-arm');
    expect(prior.run).toMatchObject({ seed: 1201, mode, mutation: true, maxTick: 3000, finalTick: 3000, extinctionTick: null });
    expect(prior.samples).toHaveLength(151);
    expect(prior.frames).toHaveLength(151);
    expect(prior.tickRows).toHaveLength(3000);
    expect(prior.snapshots.map((s: R) => s.tick)).toEqual([0, 500, 1500, 2500, 3000]);
    expect(prior.dataSha256).toBe(mode === 'moving-band' ? '458b26047456f6e67fda40e321a11ba88987bdca769190bd08fc0cbd226d5995' : '9b171b58172aff8149da51521e7311aadbd7351c7526e80c852e754326aa194e');
    const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
    const rawByMode = { 'moving-band': HASHES.moving, 'stationary-band': HASHES.stationary };
    expect(() => validateHistoricalIndexBinding(index, rawByMode)).not.toThrow();
    expect(() => validateHistoricalIndexBinding({ ...index, seed: 1203 }, rawByMode)).toThrow(/identity mismatch/);
    const wrongArm = structuredClone(index); wrongArm.arms[mode === 'moving-band' ? 'movingBand' : 'stationaryBand'].rawSha256 = '0'.repeat(64);
    expect(() => validateHistoricalIndexBinding(wrongArm, rawByMode)).toThrow(/index binding mismatch/);
    expect(ARTIFACT_PATHS[mode].pathname).toContain(`stationary-food-replication-${mode}-seed-1201.json`);
  });

  it.each(['moving-band', 'stationary-band'] as const)('requires exact full 0–3000 prefix projections for %s', (mode) => {
    const prior = REFERENCES[mode];
    const extended = prefixRecord(mode);
    expect(() => validatePrefixRecord(extended, prior)).not.toThrow();
    expect(() => validatePrefixInitial(prior.samples[0], prior.snapshots[0].state,
      prior.frames[0], prior)).not.toThrow();
    expect(() => validatePrefixSample(prior.samples.at(-1), prior.frames.at(-1), prior)).not.toThrow();
    expect(() => validatePrefixTick(3000, prior.tickRows[2999], prior)).not.toThrow();
    expect(() => validatePrefixSnapshot(prior.snapshots.at(-1), prior)).not.toThrow();

    const wrongSample = structuredClone(extended); wrongSample.samples[150].frameSha256 = '0'.repeat(64);
    expect(() => validatePrefixRecord(wrongSample, prior)).toThrow(/prefix payload mismatch/);
    const wrongFrame = structuredClone(extended); wrongFrame.frames[150].foodBase64 = 'AA==';
    expect(() => validatePrefixRecord(wrongFrame, prior)).toThrow(/prefix payload mismatch/);
    const wrongRow = structuredClone(extended); wrongRow.tickRows[2999].cells++;
    expect(() => validatePrefixRecord(wrongRow, prior)).toThrow(/prefix payload mismatch/);
    const wrongSnapshot = structuredClone(extended); wrongSnapshot.snapshots.find((s: R) => s.tick === 3000).state.food[0]++;
    expect(() => validatePrefixRecord(wrongSnapshot, prior)).toThrow(/prefix payload mismatch/);
    const wrongTerminal = structuredClone(extended); wrongTerminal.snapshots.find((s: R) => s.tick === 3000).terminal = true;
    expect(() => validatePrefixRecord(wrongTerminal, prior)).toThrow(/prefix payload mismatch/);
    const wrongRun = structuredClone(extended); wrongRun.run.mode = mode === 'moving-band' ? 'stationary-band' : 'moving-band';
    expect(() => validatePrefixRecord(wrongRun, prior)).toThrow(/reference is incomplete/);
  });

  it.each(['moving-band', 'stationary-band'] as const)('builds an actual tick-0 sample/frame/snapshot matching PR106 for %s without stepping', (mode) => {
    const world = new HungryWorld(1201, true, mode);
    const { sample, state, frame } = makeSample(world);
    expect(world.tick).toBe(0);
    validatePrefixInitial(sample, state, frame, REFERENCES[mode]);
    validatePrefixSnapshot({ tick: 0, terminal: false, environment: world.environment, state, stateSha256: sample.stateSha256 }, REFERENCES[mode]);
  });

  it('summarizes complete, partial and unreached late windows from their start sample and endpoint frame', () => {
    const windows = windowFixtures();
    expect(windows.map((w) => [w.from, w.to, w.executedTicks, w.status])).toEqual([
      [4501, 5000, 500, 'complete'], [5001, 5500, 500, 'complete'], [5501, 6000, 500, 'complete'],
    ]);
    expect(windows[0].food.offered).toBe(100 * 768);
    const w = WINDOWS[0];
    const partialRows = Array.from({ length: 200 }, (_, i) => ({ tick: w.from + i, population: 2, births: 1, deaths: 1,
      cap48: false, nearCap47: false, blockedCap: 0, blockedSpace: 0 }));
    const start = { tick: w.from - 1, census: syntheticCensus(w.from - 1), environment: syntheticEnvironment(w.from - 1) };
    const endTick = w.from + 199;
    const end = { tick: endTick, census: syntheticCensus(endTick), environment: syntheticEnvironment(endTick) };
    const frame = { tick: endTick, foodBase64: Buffer.alloc(RULES.tileCount).toString('base64'), cells: [], organisms: [] };
    const partial = summarizeWindow(w, partialRows as any, [start, end] as any, [frame] as any, [], 'moving-band');
    expect(partial).toMatchObject({ status: 'partial', executedTicks: 200, endpoint: { requestedTick: 5000, actualTick: endTick } });
    const missing = summarizeWindow(w, [] as any, [] as any, [] as any, [], 'moving-band');
    expect(missing).toMatchObject({ status: 'not-reached', executedTicks: 0, births: null, deaths: null, food: { offered: null } });
  });

  it('keeps an off-cadence extinction terminal and a fixed-snapshot extinction exactly once', () => {
    const offCadence = expectedSampleTicks(5111, 5111);
    expect(offCadence.at(-1)).toBe(5111);
    expect(offCadence.at(-2)).toBe(5100);
    expect(offCadence).toHaveLength(257);
    expect(expectedSnapshotTicks(5111, 5111)).toEqual([0, 500, 1500, 2500, 3000, 4500, 5111]);
    expect(expectedSampleTicks(5500, 5500).at(-1)).toBe(5500);
    expect(expectedSnapshotTicks(5500, 5500)).toEqual([0, 500, 1500, 2500, 3000, 4500, 5500]);
    expect(expectedSnapshotTicks(6000, null)).toEqual([...FIXED_SNAPSHOTS]);
  });

  it('gates only live 6,000-tick endpoints and complete late windows, failing partial, zero-turnover and saturation cases', () => {
    const windows = [passingWindow(4500, 5000), passingWindow(5000, 5500), passingWindow(5500, 6000)];
    const census = { population: 2, familyCounts: [1, 1, 0] };
    expect(evaluateGate(6000, census as any, windows).numericalPass).toBe(true);
    const zeroBirth = structuredClone(windows); zeroBirth[1].births = 0;
    expect(evaluateGate(6000, census as any, zeroBirth).eachNewWindowHasBirthsAndDeaths).toBe(false);
    const zeroDeath = structuredClone(windows); zeroDeath[2].deaths = 0;
    expect(evaluateGate(6000, census as any, zeroDeath).eachNewWindowHasBirthsAndDeaths).toBe(false);
    const saturated = structuredClone(windows); saturated[0].cap48Ticks = 100;
    expect(evaluateGate(6000, census as any, saturated).eachNewWindowCap48AtMost99).toBe(false);
    const partial = structuredClone(windows); partial[2].status = 'partial'; partial[2].executedTicks = 499;
    expect(evaluateGate(6000, census as any, partial).allWindowsReached).toBe(false);
    expect(evaluateGate(6000, { population: 0, familyCounts: [0, 0, 0] } as any, windows).aliveAt6000).toBe(false);
    expect(evaluateGate(6000, { population: 2, familyCounts: [2, 0, 0] } as any, windows).atLeastTwoFamiliesAt6000).toBe(false);
    expect(evaluateGate(5999, census as any, windows).numericalPass).toBe(false);
  });
});
