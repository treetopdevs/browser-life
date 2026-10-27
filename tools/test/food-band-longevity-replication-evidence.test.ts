import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HungryWorld, RULES } from '../../apps/lab/src/stationary-food/model.ts';
import {
  BASELINE_FRAME_COUNT, BASELINE_MAX_TICK, BASELINE_SAMPLE_COUNT, BASELINE_SNAPSHOT_COUNT, BASELINE_TICKROW_COUNT,
  FIXED_SNAPSHOTS, FOOD_BAND_LONGEVITY_PLAN_SHA256, LOADED_SOURCE_SHA256, MAX_TICK, OUTPUT_PATHS, WINDOWS,
  assertPinnedInputs, baselineData, evaluateGate, expectedSampleTicks, expectedSnapshotTicks, formatCompletedArmDisclosure, makeSample, parseArgs,
  summarizeWindow, validateHistoricalIndexBinding, validatePrefixInitial, validatePrefixRecord, validatePrefixSample,
  validatePrefixSnapshot, validatePrefixTick,
} from '../food-band-longevity-replication/explore.ts';

type R = Record<string, any>;
type Mode = 'moving-band' | 'stationary-band';
type Seed = 1202 | 1203;
const SEEDS: Seed[] = [1202, 1203];
const REFERENCES: Record<Seed, Record<Mode, R>> = Object.fromEntries(SEEDS.map((seed) => [seed, {
  'moving-band': baselineData(seed, 'moving-band'), 'stationary-band': baselineData(seed, 'stationary-band'),
}])) as Record<Seed, Record<Mode, R>>;
const HASHES: Record<Seed, { index: string; moving: string; stationary: string; kind: string }> = {
  1202: { index: '3462a1e0ecd74c98a465395dceebbe4d1c28e19f272a451a8abb3edd18b3ac0c',
    moving: '1ba5caec32d22feef2482e13eab9550552bec974a6f9f7791c21714d375e598a', stationary: '1c85fd8477644da9fb2bd54df0f5c1a463103db6ac49022e2caa2b0611badd39', kind: 'hungry-shapes-stationary-food-arm' },
  1203: { index: '73cf2ebfa0ab266d716d48f1c6b966872ad7cc2a68d7d95fe51729cfab6a16b3',
    moving: '000e1ce6a3a60ab216707136ba97edf97bdcde826a63af2d3c27bf54e7810e3d', stationary: '234c3c0eb54b5d6875f400e155b95f9afaa20638b511c0a4285305c9aac2ba7c', kind: 'hungry-shapes-stationary-food-replication-arm' },
};
const indexPath = (seed: Seed) => new URL(`../../docs/creative-prototypes/${seed === 1202 ? 'stationary-food-index-1202.json' : 'stationary-food-replication-index-1203.json'}`, import.meta.url);
function checkpointProof(seed: Seed, prior: R): R {
  return { status: 'verified', seed, normalization: 'none; exact historical 3,000-tick prefix payload; no normalization',
    comparedSamples: BASELINE_SAMPLE_COUNT, comparedFrames: BASELINE_FRAME_COUNT,
    comparedTickRows: BASELINE_TICKROW_COUNT, comparedSnapshots: BASELINE_SNAPSHOT_COUNT,
    checkpoints: prior.snapshots.map((s: R) => ({ tick: s.tick, stateSha256: s.stateSha256, compared: true })) };
}
function prefixRecord(seed: Seed, mode: Mode): R {
  const prior = REFERENCES[seed][mode];
  return {
    run: { seed, mode, mutation: true, maxTick: MAX_TICK, finalTick: MAX_TICK, extinctionTick: null },
    rules: structuredClone(prior.rules), provenance: { prefix: checkpointProof(seed, prior) },
    samples: [...structuredClone(prior.samples), { tick: 3020 }], frames: [...structuredClone(prior.frames), { tick: 3020 }],
    tickRows: [...structuredClone(prior.tickRows), { tick: 3001 }], snapshots: [...structuredClone(prior.snapshots), { tick: 4500 }],
  };
}
function syntheticCensus(tick: number): R {
  return { tick, population: 2, cells: 2, familyCounts: [1, 1, 0], births: 10, deaths: 8, maxGeneration: 1, genomeVariantCount: 2 };
}
function syntheticEnvironment(tick: number): R {
  const pulses = Math.floor(tick / 5);
  return { offered: pulses * 768, accepted: pulses * 500, overflow: pulses * 268, bandLeft: Math.floor(tick / 50) % 96 };
}
function passingWindow(start: number, end: number): R {
  return { from: start + 1, to: end, denominatorTicks: 500, status: 'complete', executedTicks: 500, births: 1, deaths: 1,
    cap48Ticks: 0, nearCap47Ticks: 0, blockedCapAttempts: 0, blockedSpaceAttempts: 0, minPopulation: 1, maxPopulation: 2,
    food: { offered: 76800, accepted: 50000, overflow: 26800 },
    endpoint: { requestedTick: end, actualTick: end, population: 2, cells: 2, familyCounts: [1, 1, 0], genomeCounts: [],
      maxGeneration: 1, maxEverGeneration: 1, foodRemaining: 0, bandLeft: 0, occupiedBandCells: 0, occupiedBandShare: 0 } };
}

describe('food-band longevity replication evidence helpers', () => {
  it('pins both historical lineages, sources, the unchanged model and seed-scoped output paths', () => {
    expect(() => assertPinnedInputs()).not.toThrow();
    expect(BASELINE_MAX_TICK).toBe(3000); expect(MAX_TICK).toBe(6000);
    expect(FIXED_SNAPSHOTS).toEqual([0, 500, 1500, 2500, 3000, 4500, 5500, 6000]);
    expect(LOADED_SOURCE_SHA256['apps/lab/src/stationary-food/model.ts']).toBe('7bd5af02243cb0629547a20d889a05cd904246a16227f58df4e420edc84a859f');
    expect(LOADED_SOURCE_SHA256['docs/creative-prototypes/food-band-longevity-replication-plan.md']).toBe(FOOD_BAND_LONGEVITY_PLAN_SHA256);
    expect(parseArgs(['--write', '--seed', '1202'])).toEqual({ mode: '--write', seed: 1202 });
    expect(parseArgs(['--check', '--seed', '1203'])).toEqual({ mode: '--check', seed: 1203 });
    expect(() => parseArgs(['--check', '--seed', '1201'])).toThrow(/frozen to seeds 1202 and 1203/);
    for (const seed of SEEDS) for (const mode of ['moving-band', 'stationary-band'] as const) {
      expect(OUTPUT_PATHS[seed][mode].json).toBe(`docs/creative-prototypes/food-band-longevity-replication-${mode}-seed-${seed}.json`);
      expect(OUTPUT_PATHS[seed][mode].markdown).toBe(`docs/creative-prototypes/food-band-longevity-replication-${mode}-seed-${seed}.md`);
    }
  });

  it.each(SEEDS)('validates seed %s historical pair index and distinct artifact schema', (seed) => {
    for (const mode of ['moving-band', 'stationary-band'] as const) {
      const prior = REFERENCES[seed][mode];
      expect(prior.kind).toBe(HASHES[seed].kind);
      expect(prior.run).toMatchObject({ seed, mode, mutation: true, maxTick: 3000, finalTick: 3000, extinctionTick: null });
      expect(prior.samples).toHaveLength(151); expect(prior.frames).toHaveLength(151);
      expect(prior.tickRows).toHaveLength(3000); expect(prior.snapshots.map((s: R) => s.tick)).toEqual([0, 500, 1500, 2500, 3000]);
    }
    const index = JSON.parse(readFileSync(indexPath(seed), 'utf8'));
    const rawByMode = { 'moving-band': HASHES[seed].moving, 'stationary-band': HASHES[seed].stationary };
    expect(() => validateHistoricalIndexBinding(seed, index, rawByMode)).not.toThrow();
    expect(() => validateHistoricalIndexBinding(seed === 1202 ? 1203 : 1202, index, rawByMode)).toThrow(/identity mismatch/);
    const forged = structuredClone(index); forged.arms.movingBand.rawSha256 = '0'.repeat(64);
    expect(() => validateHistoricalIndexBinding(seed, forged, rawByMode)).toThrow(/index binding mismatch/);
    expect(HASHES[seed].index).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(SEEDS.flatMap((seed) => (['moving-band', 'stationary-band'] as const).map((mode) => [seed, mode] as const)))
    ('requires exact 0–3000 prefix projections for seed %s %s', (seed, mode) => {
      const prior = REFERENCES[seed][mode]; const extended = prefixRecord(seed, mode);
      expect(() => validatePrefixRecord(extended, prior)).not.toThrow();
      expect(() => validatePrefixInitial(prior.samples[0], prior.snapshots[0].state, prior.frames[0], prior)).not.toThrow();
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
      const wrongSeed = structuredClone(extended); wrongSeed.run.seed = seed === 1202 ? 1203 : 1202;
      expect(() => validatePrefixRecord(wrongSeed, prior)).toThrow(/prefix proof missing/);
    });

  it.each(SEEDS.flatMap((seed) => (['moving-band', 'stationary-band'] as const).map((mode) => [seed, mode] as const)))
    ('builds tick-0 full-state evidence for seed %s %s without stepping', (seed, mode) => {
      const world = new HungryWorld(seed, true, mode); const { sample, state, frame } = makeSample(world);
      expect(world.tick).toBe(0); validatePrefixInitial(sample, state, frame, REFERENCES[seed][mode]);
      validatePrefixSnapshot({ tick: 0, terminal: false, environment: world.environment, state, stateSha256: sample.stateSha256 }, REFERENCES[seed][mode]);
    });

  it('summarizes complete, partial and unreached windows and binds actual endpoints', () => {
    const rows: R[] = [];
    const windows = summarizeWindow;
    for (const w of WINDOWS) for (let tick = w.from; tick <= w.to; tick++) rows.push({ tick, population: 2, births: 1, deaths: 1,
      cap48: false, nearCap47: false, blockedCap: 0, blockedSpace: 0 });
    const samples = [4500, 4501, 4700, 5000, 5500, 6000].map((tick) => ({ tick, census: syntheticCensus(tick), environment: syntheticEnvironment(tick) }));
    const frames = [4501, 4700, 5000, 5500, 6000].map((tick) => ({ tick, foodBase64: Buffer.alloc(RULES.tileCount).toString('base64'), cells: [], organisms: [] }));
    const complete = windows(WINDOWS[0]!, rows, samples, frames, [], 'moving-band');
    expect(complete).toMatchObject({ from: 4501, to: 5000, status: 'complete', executedTicks: 500, endpoint: { actualTick: 5000 } });
    expect(complete.food.offered).toBe(100 * 768);
    const partialRows = rows.filter((r) => r.tick <= 4700);
    const partial = windows(WINDOWS[0]!, partialRows, samples, frames, [], 'moving-band');
    expect(partial).toMatchObject({ status: 'partial', executedTicks: 200, endpoint: { requestedTick: 5000, actualTick: 4700 } });
    expect(windows(WINDOWS[0]!, [], [], [], [], 'moving-band')).toMatchObject({ status: 'not-reached', executedTicks: 0, births: null, deaths: null, food: { offered: null } });
  });

  it('keeps fixed and off-cadence terminal ticks in sample/snapshot schedules', () => {
    expect(expectedSampleTicks(5111, 5111).slice(-2)).toEqual([5100, 5111]);
    expect(expectedSnapshotTicks(5111, 5111)).toEqual([0, 500, 1500, 2500, 3000, 4500, 5111]);
    expect(expectedSampleTicks(5500, 5500).at(-1)).toBe(5500);
    expect(expectedSnapshotTicks(5500, 5500)).toEqual([0, 500, 1500, 2500, 3000, 4500, 5500]);
    expect(expectedSnapshotTicks(6000, null)).toEqual([...FIXED_SNAPSHOTS]);
  });

  it('requires both living founders and full late windows with turnover and low cap pressure', () => {
    const windows = [passingWindow(4500, 5000), passingWindow(5000, 5500), passingWindow(5500, 6000)];
    const census = { population: 2, familyCounts: [1, 1, 0] };
    expect(evaluateGate(6000, census as any, windows).numericalPass).toBe(true);
    expect(evaluateGate(6000, { population: 0, familyCounts: [0, 0, 0] } as any, windows).aliveAt6000).toBe(false);
    const noBirth = structuredClone(windows); noBirth[1].births = 0;
    expect(evaluateGate(6000, census as any, noBirth).eachNewWindowHasBirthsAndDeaths).toBe(false);
    const noDeath = structuredClone(windows); noDeath[2].deaths = 0;
    expect(evaluateGate(6000, census as any, noDeath).eachNewWindowHasBirthsAndDeaths).toBe(false);
    const overCap = structuredClone(windows); overCap[0].cap48Ticks = 100;
    expect(evaluateGate(6000, census as any, overCap).eachNewWindowCap48AtMost99).toBe(false);
    const partial = structuredClone(windows); partial[2].status = 'partial'; partial[2].executedTicks = 499;
    expect(evaluateGate(6000, census as any, partial).allWindowsReached).toBe(false);
    expect(evaluateGate(6000, { population: 2, familyCounts: [2, 0, 0] } as any, windows).atLeastTwoFamiliesAt6000).toBe(false);
    expect(evaluateGate(5999, census as any, windows).numericalPass).toBe(false);
  });

  it('formats the full validated arm outcome before the next arm starts', () => {
    const windows = [passingWindow(4500, 5000), passingWindow(5000, 5500), passingWindow(5500, 6000)];
    const census = { tick: 6000, population: 2, familyCounts: [1, 1, 0], births: 45, deaths: 43 };
    const environment = { mode: 'moving-band', bandLeft: 24, offered: 921600, accepted: 700000, overflow: 221600 };
    const numericalGate = evaluateGate(6000, census as any, windows);
    const data = { run: { seed: 1202, mode: 'moving-band', finalTick: 6000, extinctionTick: null },
      final: { census, environment }, windows, numericalGate, dataSha256: 'a'.repeat(64) };
    const disclosure = JSON.parse(formatCompletedArmDisclosure(data));
    expect(disclosure).toEqual({ seed: 1202, mode: 'moving-band', finalTick: 6000, extinctionTick: null,
      census, environment, numericalGate, windows, dataSha256: 'a'.repeat(64) });
    expect(disclosure.numericalGate).toMatchObject({ aliveAt6000: true, atLeastTwoFamiliesAt6000: true,
      allWindowsReached: true, eachNewWindowHasBirthsAndDeaths: true, eachNewWindowCap48AtMost99: true, numericalPass: true });
    expect(disclosure.windows.map((window: R) => [window.from, window.to, window.status, window.births, window.deaths, window.cap48Ticks]))
      .toEqual([[4501, 5000, 'complete', 1, 1, 0], [5001, 5500, 'complete', 1, 1, 0], [5501, 6000, 'complete', 1, 1, 0]]);
  });
});
