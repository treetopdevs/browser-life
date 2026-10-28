import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HungryWorld } from '../../apps/lab/src/moving-food/model.ts';

// The replays are kept out of git (docs/creative-prototypes/ARTIFACTS.md); restore them to run these checks.
const hasReplays = ['hungry-shapes-seed-1201.json', 'uniform-endurance-seed-1201.json', 'moving-food-uniform-seed-1201.json', 'moving-food-moving-band-seed-1201.json'].every((name) => existsSync(new URL(`../../docs/creative-prototypes/${name}`, import.meta.url)));
const {
  LOADED_SOURCE_SHA256, assertPinnedInputs, evaluateGate, expectedSampleTicks, expectedSnapshotTicks,
  maxEverGenerationAt, parseArgs, validateEnvironment, validateFrame, validateFrameEnergy, validateFrameLineage,
  validateEvidenceStructure, validateLineage, validatePrefixRecord, validateSnapshot, validateSnapshotHistoryBindings, validateSnapshotLineageProjection,
} = (hasReplays ? await import('../moving-food/explore.ts') : {}) as typeof import('../moving-food/explore.ts');

type R = Record<string, any>;
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture() { return new HungryWorld(1_201, true, 'uniform'); }
let acceptedArms: { uniform: R; movingBand: R } | undefined;
function acceptedArm(mode: 'uniform' | 'moving-band'): R {
  acceptedArms ??= {
    uniform: JSON.parse(readFileSync(new URL('../../docs/creative-prototypes/moving-food-uniform-seed-1201.json', import.meta.url), 'utf8')) as R,
    movingBand: JSON.parse(readFileSync(new URL('../../docs/creative-prototypes/moving-food-moving-band-seed-1201.json', import.meta.url), 'utf8')) as R,
  };
  return structuredClone(mode === 'uniform' ? acceptedArms.uniform : acceptedArms.movingBand);
}
function resealArtifact(data: R): void { delete data.dataSha256; data.dataSha256 = digest(data); }
function frameFor(world: HungryWorld): R {
  const census = world.census(); const state = world.snapshot(); const environment = world.environment;
  const cells = world.organisms.flatMap((o) => o.cells.map((c) => [c.tile, o.id] as [number, number])).sort((a, b) => a[0] - b[0]);
  const base = { tick: world.tick, censusSha256: digest(census), stateSha256: digest({ state, environment }), foodBase64: Buffer.from(world.food).toString('base64'),
    cells, organisms: world.organisms.map(({ id, family, genome }) => ({ id, family, genome })), ledger: world.ledger };
  return { ...base, frameSha256: digest(base) };
}

describe.skipIf(!hasReplays)('moving-food evidence primitives', () => {
  it('pins source inputs and admits only the reviewed first-seed runner action', () => {
    expect(() => assertPinnedInputs()).not.toThrow();
    expect(LOADED_SOURCE_SHA256['apps/lab/src/moving-food/model.ts']).toMatch(/^[a-f0-9]{64}$/);
    expect(LOADED_SOURCE_SHA256['tools/moving-food/explore.ts']).toMatch(/^[a-f0-9]{64}$/);
    expect(parseArgs(['--check', '--seed', '1201'])).toEqual({ mode: '--check', seed: 1201 });
    expect(() => parseArgs(['--check', '--seed', '1202'])).toThrow(/frozen to seed 1201/);
    expect(() => parseArgs(['--write'])).toThrow(/explicit --seed/);
    expect(() => parseArgs(['--check', '--replay-check', '--seed', '1201'])).toThrow(/exactly one/);
  });

  it('accepts both saved first-seed arm artifacts through the full structural validator', () => {
    expect(() => validateEvidenceStructure(acceptedArm('uniform'), LOADED_SOURCE_SHA256)).not.toThrow();
    expect(() => validateEvidenceStructure(acceptedArm('moving-band'), LOADED_SOURCE_SHA256)).not.toThrow();
  });

  it('rejects re-sealed window-generation and moving-band-position contradictions', () => {
    const generation = acceptedArm('uniform');
    generation.windows[0].endpoint.maxEverGeneration++;
    resealArtifact(generation);
    expect(() => validateEvidenceStructure(generation, LOADED_SOURCE_SHA256)).toThrow(/window 1501-2000 differs/);

    const geometry = acceptedArm('moving-band');
    geometry.samples[0].environment.bandLeft = 1;
    resealArtifact(geometry);
    expect(() => validateEvidenceStructure(geometry, LOADED_SOURCE_SHA256)).toThrow(/band position\/width/);
  });

  it('rejects a re-sealed false uniform-prefix comparison claim', () => {
    const data = acceptedArm('uniform');
    data.provenance.prefix.comparedSamples = 150;
    resealArtifact(data);
    expect(() => validateEvidenceStructure(data, LOADED_SOURCE_SHA256)).toThrow(/uniform baseline prefix proof missing/);
  });

  it('proves the uniform prefix using the pinned baseline without normalizing any state', () => {
    const prior = JSON.parse(readFileSync(new URL('../../docs/creative-prototypes/uniform-endurance-seed-1201.json', import.meta.url), 'utf8')) as R;
    const firstSample = prior.samples[0];
    const evidence = { run: { mode: 'uniform' }, rules: prior.rules, samples: prior.samples.slice(0, 151),
      frames: prior.frames.slice(0, 151), tickRows: prior.tickRows.slice(0, 3_000), snapshots: prior.snapshots.filter((s: R) => s.tick === 0),
      provenance: { prefix: { status: 'verified', seed: 1_201, normalization: 'none; maxHistory 451 is unchanged',
        comparedSamples: 151, comparedFrames: 151, comparedTickRows: 3_000, comparedSnapshots: 1,
        checkpoints: [{ tick: 0, stateSha256: firstSample.stateSha256, compared: true }] } } } as R;
    expect(() => validatePrefixRecord(evidence, prior)).not.toThrow();
    const changed = structuredClone(evidence); changed.samples[75].stateSha256 = 'f'.repeat(64);
    expect(() => validatePrefixRecord(changed, prior)).toThrow(/uniform prefix sample\/hash mismatch/);
    expect(() => validatePrefixRecord({ ...evidence, provenance: {} }, prior)).toThrow();
    expect(() => validatePrefixRecord(evidence, { ...prior, run: { ...prior.run, seed: 1_202 } })).toThrow(/baseline prefix is incomplete/);
    const movingPrefix = { provenance: { prefix: { status: 'not-applicable', seed: null,
      normalization: 'none; moving-band is not the uniform control', comparedSamples: 0, comparedFrames: 0,
      comparedTickRows: 0, comparedSnapshots: 0, checkpoints: [] } }, run: { mode: 'moving-band' } };
    expect(() => validatePrefixRecord(movingPrefix, {})).not.toThrow();
  });

  it('keeps uniform environment fields exact and validates mode-specific moving geometry', () => {
    const uniform = fixture();
    expect(() => validateEnvironment(uniform.environment, 0, 'uniform', 'uniform')).not.toThrow();
    const extra = { ...uniform.environment, bandWidth: 48 };
    expect(() => validateEnvironment(extra, 0, 'uniform', 'uniform')).toThrow(/required fields mismatch/);
    expect(() => validateEnvironment({ ...uniform.environment, mode: 'moving-band', targetCount: 4_608, bandLeft: 0, bandWidth: 48 }, 0, 'moving', 'moving-band')).not.toThrow();
    expect(() => validateEnvironment({ ...uniform.environment, mode: 'moving-band', targetCount: 4_608, bandLeft: 1, bandWidth: 48 }, 0, 'moving', 'moving-band')).toThrow(/band position/);
  });

  it('binds frame body IDs and genomes to lineage at that frame tick', () => {
    const world = fixture(); const frame = frameFor(world); const census = world.census();
    expect(() => validateFrame(frame)).not.toThrow();
    expect(() => validateFrameLineage(frame, world.lineage, census)).not.toThrow();
    const swapped = structuredClone(frame); swapped.organisms[0]!.id = 99_999;
    expect(() => validateFrameLineage(swapped, world.lineage, census)).toThrow(/body IDs\/family\/genome/);
    const changedLineage = structuredClone(world.lineage) as R[]; changedLineage[0]!.family = (changedLineage[0]!.family + 1) % 3;
    expect(() => validateFrameLineage(frame, changedLineage, census)).toThrow(/body IDs\/family\/genome/);
  });

  it('binds food, stored energy, structures, and the conservation ledger exactly', () => {
    const world = fixture(); const frame = frameFor(world); const census = world.census();
    expect(census.totalEnergy).toBeGreaterThan(census.cells * 4);
    expect(() => validateFrameEnergy(frame, census, world.environment)).not.toThrow();
    expect(() => validateFrameEnergy(frame, { ...census, totalEnergy: census.totalEnergy + 1 }, world.environment)).toThrow(/energy mismatch/);
    const invalid = structuredClone(frame); invalid.ledger.expected++;
    delete invalid.frameSha256; invalid.frameSha256 = digest(invalid);
    expect(() => validateFrame(invalid)).toThrow(/frame energy ledger/);
  });

  it('joins snapshot history and as-of lineage to samples and rejects missing parent records', () => {
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

  it('rejects fractional growth cursors and false extinction metadata', () => {
    const world = fixture(); const fractional = structuredClone(world.snapshot()) as R;
    fractional.organisms[0].growthCursor = 0.5;
    expect(() => validateSnapshot(fractional, { seed: 1_201, tick: 0, extinctionTick: null })).toThrow(/growth queue/);
    expect(() => validateSnapshot(world.snapshot(), { seed: 1_201, tick: 0, extinctionTick: 0 })).toThrow(/state identity/);
  });

  it('handles boundary ticks, extinction cadence, and gates tied to a live 3,000 endpoint', () => {
    expect(expectedSampleTicks(37, 37)).toEqual([0, 20, 37]);
    expect(expectedSnapshotTicks(37, 37)).toEqual([0, 37]);
    expect(expectedSampleTicks(3_000, null)).toHaveLength(151);
    const windows = [{ status: 'complete', executedTicks: 500, births: 1, deaths: 1, cap48Ticks: 99 },
      { status: 'complete', executedTicks: 500, births: 1, deaths: 1, cap48Ticks: 99 },
      { status: 'complete', executedTicks: 500, births: 1, deaths: 1, cap48Ticks: 99 }];
    const census = { population: 2, familyCounts: [1, 1, 0] } as any;
    expect(evaluateGate(3_000, census, windows).numericalPass).toBe(true);
    expect(evaluateGate(2_999, census, windows)).toMatchObject({ aliveAt3000: false, atLeastTwoFamiliesAt3000: false, numericalPass: false });
    expect(evaluateGate(3_000, { ...census, population: 0, familyCounts: [0, 0, 0] }, windows)).toMatchObject({ aliveAt3000: false, atLeastTwoFamiliesAt3000: false });
    const incomplete = structuredClone(windows); incomplete[2]!.status = 'not-reached'; incomplete[2]!.executedTicks = 0;
    expect(evaluateGate(3_000, census, incomplete).allWindowsReached).toBe(false);
    const fullCap = structuredClone(windows); fullCap[1]!.cap48Ticks = 100;
    expect(evaluateGate(3_000, census, fullCap).eachNewWindowCap48AtMost99).toBe(false);
    const noBirths = structuredClone(windows); noBirths[0]!.births = 0;
    const noDeaths = structuredClone(windows); noDeaths[2]!.deaths = 0;
    expect(evaluateGate(3_000, census, noBirths).eachNewWindowHasBirthsAndDeaths).toBe(false);
    expect(evaluateGate(3_000, census, noDeaths).eachNewWindowHasBirthsAndDeaths).toBe(false);
  });
});
