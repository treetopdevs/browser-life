import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HungryWorld, RULES } from '../../apps/lab/src/stationary-food/model.ts';
import {
  FIXED_SNAPSHOTS, LOADED_SOURCE_SHA256, assertPinnedInputs, evaluateGate, expectedSampleTicks,
  expectedSnapshotTicks, parseArgs, validateEnvironment, validateFrame, validateFrameEnergy,
  validatePrefixRecord,
} from '../stationary-food/explore.ts';

type R = Record<string, any>;
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
function movingReference(): R {
  return JSON.parse(readFileSync(new URL('../../docs/creative-prototypes/moving-food-replication-moving-band-seed-1202.json', import.meta.url), 'utf8')) as R;
}
function prefixProof(reference: R): R {
  const checkpoints = reference.snapshots.map((snapshot: R) => ({
    tick: snapshot.tick,
    stateSha256: snapshot.stateSha256,
    compared: true,
  }));
  return {
    schemaVersion: 1,
    kind: 'hungry-shapes-stationary-food-arm',
    run: { seed: 1202, mode: 'moving-band' },
    rules: reference.rules,
    samples: structuredClone(reference.samples),
    frames: structuredClone(reference.frames),
    tickRows: structuredClone(reference.tickRows),
    snapshots: structuredClone(reference.snapshots),
    provenance: { prefix: {
      status: 'verified', seed: 1202,
      normalization: 'none; exact moving-band prefix; no normalization',
      comparedSamples: 151, comparedFrames: 151, comparedTickRows: 3_000,
      comparedSnapshots: 5, checkpoints,
    } },
  };
}
function frameFor(world: HungryWorld): R {
  const census = world.census();
  const state = world.snapshot();
  const environment = world.environment;
  const cells = world.organisms.flatMap((o) => o.cells.map((c) => [c.tile, o.id] as [number, number])).sort((a, b) => a[0] - b[0]);
  const base = { tick: world.tick, censusSha256: digest(census), stateSha256: digest({ state, environment }),
    foodBase64: Buffer.from(world.food).toString('base64'), cells,
    organisms: world.organisms.map(({ id, family, genome }) => ({ id, family, genome })), ledger: world.ledger };
  return { ...base, frameSha256: digest(base) };
}

describe('stationary-food evidence primitives', () => {
  it('pins the isolated model, reviewed plan, historical source, and accepts only seed 1202', () => {
    expect(() => assertPinnedInputs()).not.toThrow();
    expect(Object.keys(LOADED_SOURCE_SHA256)).toContain('apps/lab/src/stationary-food/model.ts');
    expect(Object.keys(LOADED_SOURCE_SHA256)).toContain('tools/stationary-food/explore.ts');
    expect(LOADED_SOURCE_SHA256['apps/lab/src/moving-food/model.ts']).toBe('b7aa0a3f1a0183d574e152e16b7f12c24fc0c9a201e7ddfae6d576915f10d8b0');
    expect(LOADED_SOURCE_SHA256['tools/moving-food/explore.ts']).toBe('b77c58eca007727beeca81b1a797978a8ddfbacaa4d3192a094164bf868df63a');
    expect(parseArgs(['--check', '--seed', '1202'])).toEqual({ mode: '--check', seed: 1202 });
    expect(parseArgs(['--write', '--seed', '1202'])).toEqual({ mode: '--write', seed: 1202 });
    for (const seed of ['1201', '1203']) expect(() => parseArgs(['--check', '--seed', seed])).toThrow(/frozen to seed 1202/);
    expect(() => parseArgs(['--check', '--replay-check', '--seed', '1202'])).toThrow(/exactly one/);
  });

  it('accepts the pinned moving prefix and rejects re-sealed sample, tick-row, and checkpoint contradictions', () => {
    const reference = movingReference();
    const evidence = prefixProof(reference);
    expect(() => validatePrefixRecord(evidence, reference)).not.toThrow();

    const badSample = structuredClone(evidence);
    badSample.samples[75].stateSha256 = 'f'.repeat(64);
    expect(() => validatePrefixRecord(badSample, reference)).toThrow(/moving-band prefix sample\/hash mismatch/);

    const badRow = structuredClone(evidence);
    badRow.tickRows[2_999].cells++;
    expect(() => validatePrefixRecord(badRow, reference)).toThrow(/moving-band prefix tick rows mismatch/);

    const badCheckpoint = structuredClone(evidence);
    badCheckpoint.snapshots.find((s: R) => s.tick === 500).state.population = 999;
    expect(() => validatePrefixRecord(badCheckpoint, reference)).toThrow(/moving-band prefix full snapshot mismatch/);

    const wrongSeed = structuredClone(evidence);
    wrongSeed.provenance.prefix.seed = 1203;
    expect(() => validatePrefixRecord(wrongSeed, reference)).toThrow(/moving-band baseline prefix proof missing/);
  });

  it('requires stationary prefix to be explicitly not applicable', () => {
    const proof = { run: { mode: 'stationary-band' }, provenance: { prefix: {
      status: 'not-applicable', seed: null,
      normalization: 'none; stationary-band has no moving-reference prefix',
      comparedSamples: 0, comparedFrames: 0, comparedTickRows: 0, comparedSnapshots: 0, checkpoints: [],
    } } };
    expect(() => validatePrefixRecord(proof as R, {})).not.toThrow();
    const falseProof = structuredClone(proof);
    falseProof.provenance.prefix.comparedFrames = 151;
    expect(() => validatePrefixRecord(falseProof as R, {})).toThrow(/stationary-band prefix must be not-applicable/);
  });

  it('checks mode-specific environment geometry and sample/snapshot schedules', () => {
    const moving = new HungryWorld(1202, true, 'moving-band');
    const stationary = new HungryWorld(1202, true, 'stationary-band');
    expect(() => validateEnvironment(moving.environment, 0, 'moving', 'moving-band')).not.toThrow();
    expect(() => validateEnvironment(stationary.environment, 0, 'stationary', 'stationary-band')).not.toThrow();
    expect(() => validateEnvironment({ ...stationary.environment, bandLeft: 1 }, 0, 'stationary', 'stationary-band')).toThrow(/band position/);
    expect(() => validateEnvironment({ ...moving.environment, bandLeft: 1 }, 0, 'moving', 'moving-band')).toThrow(/band position/);
    expect(() => validateEnvironment({ ...stationary.environment, targetCount: 4_607 }, 0, 'stationary', 'stationary-band')).toThrow(/mode parameters/);
    expect(FIXED_SNAPSHOTS).toEqual([0, 500, 1_500, 2_500, 3_000]);
    expect(expectedSampleTicks(3_000, null)).toHaveLength(151);
    expect(expectedSnapshotTicks(3_000, null)).toEqual([0, 500, 1_500, 2_500, 3_000]);
  });

  it('binds initial frame energy to full census energy, including organism stores', () => {
    const world = new HungryWorld(1202, true, 'stationary-band');
    const frame = frameFor(world);
    expect(world.census().totalEnergy).toBeGreaterThan(world.census().cells * RULES.structurePerCell);
    expect(() => validateFrame(frame)).not.toThrow();
    expect(() => validateFrameEnergy(frame, world.census(), world.environment)).not.toThrow();
    const corrupt = structuredClone(frame);
    corrupt.ledger.actual++;
    corrupt.ledger.expected++;
    corrupt.ledger.residual = 0;
    corrupt.frameSha256 = digest(Object.fromEntries(Object.entries(corrupt).filter(([key]) => key !== 'frameSha256')));
    expect(() => validateFrame(corrupt)).toThrow(/frame energy ledger/);
  });

  it('requires the late-window numerical gate for both band arms', () => {
    const passingWindows = [1, 2, 3].map((index) => ({ from: index, to: index, status: 'complete', executedTicks: 500, births: 1, deaths: 1, cap48Ticks: 0 }));
    const passing = evaluateGate(3_000, { population: 1, familyCounts: [1, 1, 0] } as any, passingWindows);
    expect(passing.numericalPass).toBe(true);
    expect(evaluateGate(3_000, { population: 0, familyCounts: [0, 0, 0] } as any, passingWindows).numericalPass).toBe(false);
    expect(evaluateGate(3_000, { population: 1, familyCounts: [1, 1, 0] } as any, [{ ...passingWindows[0], births: 0 }, ...passingWindows.slice(1)]).numericalPass).toBe(false);
  });
});
