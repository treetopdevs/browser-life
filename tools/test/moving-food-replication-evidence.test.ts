import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HungryWorld, RULES } from '../../apps/lab/src/moving-food/model.ts';
import {
  LOADED_SOURCE_SHA256, assertPinnedInputs, evaluateGate, expectedSampleTicks, expectedSnapshotTicks,
  maxEverGenerationAt, parseArgs, validateEnvironment, validateEvidenceStructure, validateFrame, validateFrameEnergy,
  validateFrameLineage, validateLineage, validatePrefixRecord, validateSnapshot, validateSnapshotHistoryBindings,
  validateSnapshotLineageProjection,
} from '../moving-food-replication/explore.ts';

type R = Record<string, any>;
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(seed: 1202 | 1203 = 1202) { return new HungryWorld(seed, true, 'uniform'); }
function baseline(seed: 1202 | 1203): R {
  return JSON.parse(readFileSync(new URL(`../../docs/creative-prototypes/uniform-endurance-seed-${seed}.json`, import.meta.url), 'utf8')) as R;
}
function prefixEvidence(seed: 1202 | 1203, prior: R): R {
  const firstSample = prior.samples[0];
  return { run: { seed, mode: 'uniform' }, rules: prior.rules, samples: prior.samples.slice(0, 151),
    frames: prior.frames.slice(0, 151), tickRows: prior.tickRows.slice(0, 3_000), snapshots: prior.snapshots.filter((s: R) => s.tick === 0),
    provenance: { prefix: { status: 'verified', seed, normalization: 'none; maxHistory 451 is unchanged',
      comparedSamples: 151, comparedFrames: 151, comparedTickRows: 3_000, comparedSnapshots: 1,
      checkpoints: [{ tick: 0, stateSha256: firstSample.stateSha256, compared: true }] } } };
}
function frameFor(world: HungryWorld): R {
  const census = world.census(); const state = world.snapshot(); const environment = world.environment;
  const cells = world.organisms.flatMap((o) => o.cells.map((c) => [c.tile, o.id] as [number, number])).sort((a, b) => a[0] - b[0]);
  const base = { tick: world.tick, censusSha256: digest(census), stateSha256: digest({ state, environment }), foodBase64: Buffer.from(world.food).toString('base64'),
    cells, organisms: world.organisms.map(({ id, family, genome }) => ({ id, family, genome })), ledger: world.ledger };
  return { ...base, frameSha256: digest(base) };
}

describe('moving-food replication evidence primitives', () => {
  it('pins the frozen implementation and accepts only the two scheduled seeds', () => {
    expect(() => assertPinnedInputs()).not.toThrow();
    expect(LOADED_SOURCE_SHA256['apps/lab/src/moving-food/model.ts']).toMatch(/^[a-f0-9]{64}$/);
    expect(LOADED_SOURCE_SHA256['tools/moving-food/explore.ts']).toMatch(/^[a-f0-9]{64}$/);
    expect(LOADED_SOURCE_SHA256['tools/moving-food-replication/explore.ts']).toMatch(/^[a-f0-9]{64}$/);
    expect(parseArgs(['--check', '--seed', '1202'])).toEqual({ mode: '--check', seed: 1202 });
    expect(parseArgs(['--write', '--seed', '1203'])).toEqual({ mode: '--write', seed: 1203 });
    for (const seed of ['1201', '1204']) expect(() => parseArgs(['--check', '--seed', seed])).toThrow(/frozen to seeds 1202 and 1203/);
    expect(() => parseArgs(['--check', '--seed', 'NaN'])).toThrow(/explicit --seed/);
    expect(() => parseArgs(['--write'])).toThrow(/explicit --seed/);
    expect(() => parseArgs(['--check', '--replay-check', '--seed', '1202'])).toThrow(/exactly one/);
  });

  it.each([1202, 1203] as const)('compares the uniform prefix exactly against its own seed %i baseline', (seed) => {
    const prior = baseline(seed); const evidence = prefixEvidence(seed, prior);
    expect(() => validatePrefixRecord(evidence, prior)).not.toThrow();
    const changedSample = structuredClone(evidence); changedSample.samples[75].stateSha256 = 'f'.repeat(64);
    expect(() => validatePrefixRecord(changedSample, prior)).toThrow(/uniform prefix sample\/hash mismatch/);
    const changedRow = structuredClone(evidence); changedRow.tickRows[2_999].cells++;
    expect(() => validatePrefixRecord(changedRow, prior)).toThrow(/uniform prefix tick rows mismatch/);
    expect(() => validatePrefixRecord(evidence, baseline(seed === 1202 ? 1203 : 1202))).toThrow(/baseline prefix is incomplete/);
    expect(() => validatePrefixRecord({ ...evidence, provenance: {} }, prior)).toThrow();
  });

  it('does not accept seed 1201 or an unsupported seed in a full evidence envelope', () => {
    const skeleton = (seed: number) => ({ schemaVersion: 1, kind: 'hungry-shapes-moving-food-arm',
      run: { seed, mode: 'uniform', mutation: true, maxTick: 3_000, finalTick: 3_000, extinctionTick: null },
      runtime: {}, rules: RULES, provenance: {}, samples: [], tickRows: [], frames: [], snapshots: [], windows: [], final: {}, repeat: {}, numericalGate: {}, dataSha256: '' });
    expect(() => validateEvidenceStructure(skeleton(1201))).toThrow(/run settings mismatch/);
    expect(() => validateEvidenceStructure(skeleton(1204))).toThrow(/run settings mismatch/);
  });

  it('keeps moving-band prefix explicitly not applicable and rejects false proof values', () => {
    const evidence = { run: { mode: 'moving-band' }, provenance: { prefix: { status: 'not-applicable', seed: null,
      normalization: 'none; moving-band is not the uniform control', comparedSamples: 0, comparedFrames: 0,
      comparedTickRows: 0, comparedSnapshots: 0, checkpoints: [] } } };
    expect(() => validatePrefixRecord(evidence as R, {})).not.toThrow();
    const falseProof = structuredClone(evidence); falseProof.provenance.prefix.comparedFrames = 1;
    expect(() => validatePrefixRecord(falseProof as R, {})).toThrow(/must be not-applicable/);
  });

  it('keeps uniform environment fields exact and validates mode-specific moving geometry', () => {
    const uniform = fixture();
    expect(() => validateEnvironment(uniform.environment, 0, 'uniform', 'uniform')).not.toThrow();
    expect(() => validateEnvironment({ ...uniform.environment, bandWidth: 48 }, 0, 'uniform', 'uniform')).toThrow(/required fields mismatch/);
    expect(() => validateEnvironment({ ...uniform.environment, mode: 'moving-band', targetCount: 4_608, bandLeft: 0, bandWidth: 48 }, 0, 'moving', 'moving-band')).not.toThrow();
    expect(() => validateEnvironment({ ...uniform.environment, mode: 'moving-band', targetCount: 4_608, bandLeft: 1, bandWidth: 48 }, 0, 'moving', 'moving-band')).toThrow(/band position/);
  });

  it('binds frame body IDs and genomes to lineage at that frame tick', () => {
    const world = fixture(); const frame = frameFor(world); const census = world.census();
    expect(() => validateFrame(frame)).not.toThrow();
    expect(() => validateFrameLineage(frame, world.lineage, census)).not.toThrow();
    const changed = structuredClone(frame); changed.organisms[0]!.id = 99_999;
    expect(() => validateFrameLineage(changed, world.lineage, census)).toThrow(/body IDs\/family\/genome/);
    const changedLineage = structuredClone(world.lineage) as R[]; changedLineage[0]!.family = (changedLineage[0]!.family + 1) % 3;
    expect(() => validateFrameLineage(frame, changedLineage, census)).toThrow(/body IDs\/family\/genome/);
  });

  it('binds food, stored energy, structures, and conservation exactly', () => {
    const world = fixture(); const frame = frameFor(world); const census = world.census();
    expect(census.totalEnergy).toBeGreaterThan(census.cells * RULES.structurePerCell);
    expect(() => validateFrameEnergy(frame, census, world.environment)).not.toThrow();
    expect(() => validateFrameEnergy(frame, { ...census, totalEnergy: census.totalEnergy + 1 }, world.environment)).toThrow(/energy mismatch/);
    const invalid = structuredClone(frame); invalid.ledger.expected++;
    delete invalid.frameSha256; invalid.frameSha256 = digest(invalid);
    expect(() => validateFrame(invalid)).toThrow(/frame energy ledger/);
  });

  it('joins snapshot history and as-of lineage and rejects missing lineage parents', () => {
    const world = fixture(); const state = world.snapshot(); const sample = { tick: 0, census: world.census() };
    expect(() => validateSnapshotHistoryBindings(state, [sample] as any)).not.toThrow();
    expect(() => validateSnapshotHistoryBindings(state, [{ ...sample, census: { ...sample.census, population: 99 } }] as any)).toThrow(/history\/sample mismatch/);
    expect(() => validateSnapshotLineageProjection(state, world.lineage)).not.toThrow();
    const wrongLineage = structuredClone(world.lineage) as R[]; wrongLineage[0]!.family = (wrongLineage[0]!.family + 1) % 3;
    expect(() => validateSnapshotLineageProjection(state, wrongLineage)).toThrow(/lineage differs/);
    const missingParent = structuredClone(world.lineage) as R[]; missingParent[0]!.parentID = 999_999; missingParent[0]!.generation = 1;
    expect(() => validateLineage(missingParent, 0)).toThrow(/missing lineage parent|parent lineage mismatch/);
  });

  it('retains extinct generations in endpoint maximum-ever-generation counts', () => {
    const lineage = [{ id: 1, parentID: null, family: 0, generation: 0, birthTick: 0, deathTick: 1 },
      { id: 2, parentID: 1, family: 0, generation: 8, birthTick: 4, deathTick: 9 }] as any;
    expect(maxEverGenerationAt(lineage, 3)).toBe(0);
    expect(maxEverGenerationAt(lineage, 20)).toBe(8);
    expect(maxEverGenerationAt(lineage, null)).toBeNull();
  });

  it('rejects fractional growth cursors and false extinction metadata for the selected seed', () => {
    const world = fixture(1203); const fractional = structuredClone(world.snapshot()) as R;
    fractional.organisms[0].growthCursor = 0.5;
    expect(() => validateSnapshot(fractional, { seed: 1203, tick: 0, extinctionTick: null })).toThrow(/growth queue/);
    expect(() => validateSnapshot(world.snapshot(), { seed: 1203, tick: 0, extinctionTick: 0 })).toThrow(/state identity/);
  });

  it('handles boundary ticks and gates tied to actual living endpoints', () => {
    expect(expectedSampleTicks(37, 37)).toEqual([0, 20, 37]);
    expect(expectedSnapshotTicks(37, 37)).toEqual([0, 37]);
    const windows = [{ status: 'complete', executedTicks: 500, births: 1, deaths: 1, cap48Ticks: 99 },
      { status: 'complete', executedTicks: 500, births: 1, deaths: 1, cap48Ticks: 99 },
      { status: 'complete', executedTicks: 500, births: 1, deaths: 1, cap48Ticks: 99 }];
    const census = { population: 2, familyCounts: [1, 1, 0] } as any;
    expect(evaluateGate(3_000, census, windows).numericalPass).toBe(true);
    expect(evaluateGate(2_999, census, windows)).toMatchObject({ aliveAt3000: false, atLeastTwoFamiliesAt3000: false, numericalPass: false });
    expect(evaluateGate(3_000, { ...census, population: 0, familyCounts: [0, 0, 0] }, windows)).toMatchObject({ aliveAt3000: false, atLeastTwoFamiliesAt3000: false });
    const fullCap = structuredClone(windows); fullCap[1]!.cap48Ticks = 100;
    expect(evaluateGate(3_000, census, fullCap).eachNewWindowCap48AtMost99).toBe(false);
    const noBirths = structuredClone(windows); noBirths[0]!.births = 0;
    const noDeaths = structuredClone(windows); noDeaths[2]!.deaths = 0;
    expect(evaluateGate(3_000, census, noBirths).eachNewWindowHasBirthsAndDeaths).toBe(false);
    expect(evaluateGate(3_000, census, noDeaths).eachNewWindowHasBirthsAndDeaths).toBe(false);
  });
});
