import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HungryWorld, RULES, type DevelopmentSnapshot } from '../../apps/lab/src/uniform-endurance/model.ts';
import {
  FIXED_SNAPSHOTS, LOADED_SOURCE_SHA256, WINDOWS, assertPinnedInputs, evaluateGate, expectedSampleTicks, expectedSnapshotTicks, normalizePrefixState,
  normalizedFrameDigest, parseArgs, validateFrame, validateFrameLineage, validateLineage,
  validateEvidenceStructure, validatePrefixRecord, validatePrefixTick, validateSnapshot, validateSnapshotHistoryBindings, validateSnapshotLineageProjection,
} from '../uniform-endurance/explore.ts';

type R = Record<string, any>;
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
let accepted1203: R | undefined;
function acceptedArtifact(): R {
  accepted1203 ??= JSON.parse(readFileSync(new URL('../../docs/creative-prototypes/uniform-endurance-seed-1203.json', import.meta.url), 'utf8'));
  return structuredClone(accepted1203);
}
function resealArtifact(data: R): void { delete data.dataSha256; data.dataSha256 = digest(data); }
function stateAtZero(): { world: HungryWorld; state: DevelopmentSnapshot } {
  const world = new HungryWorld(1203, true, 'uniform');
  const state = JSON.parse(JSON.stringify(world.snapshot())) as DevelopmentSnapshot & { runtime: string };
  state.runtime = 'Node 24.2.0';
  return { world, state };
}
function makeFrame(world: HungryWorld): R {
  const { state } = stateAtZero();
  const census = world.census(); const environment = world.environment;
  const stateSha256 = digest({ state, environment });
  const normalizedStateSha256 = digest({ state: normalizePrefixState(state), environment });
  const cells = world.organisms.flatMap((o) => o.cells.map((c) => [c.tile, o.id] as [number, number])).sort((a, b) => a[0] - b[0]);
  const base: R = { tick: world.tick, censusSha256: digest(census), stateSha256, normalizedStateSha256, normalizedFrameSha256: null,
    foodBase64: Buffer.from(world.food).toString('base64'), cells,
    organisms: world.organisms.map((o) => ({ id: o.id, family: o.family, genome: o.genome })), ledger: world.ledger };
  base.normalizedFrameSha256 = normalizedFrameDigest(base, normalizedStateSha256);
  base.frameSha256 = digest(base);
  return base;
}

describe('uniform-endurance evidence primitives', () => {
  it('pins the isolated observation-copy and restores only maxHistory', () => {
    expect(() => assertPinnedInputs()).not.toThrow();
    const { state } = stateAtZero(); const before = structuredClone(state);
    const normalized = normalizePrefixState(state);
    expect(state.rules.maxHistory).toBe(451);
    expect(normalized.rules.maxHistory).toBe(301);
    expect({ ...normalized.rules, maxHistory: 451 }).toEqual(state.rules);
    expect(state).toEqual(before);
    const changed = structuredClone(normalized); changed.organisms[0]!.age++;
    expect(changed).not.toEqual(normalized);
    expect(LOADED_SOURCE_SHA256['tools/uniform-endurance/explore.ts']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a normalized prefix record joined to a different seed', () => {
    const proof = { status: 'verified', seed: 1201,
      normalization: 'For ticks <=6000, copy new state and set only rules.maxHistory 451->301; hash SHA256(JSON.stringify({state,environment})). Compare all retained samples, frames, tick rows, and old snapshots.',
      comparedSamples: 301, comparedFrames: 301, comparedTickRows: 6000, comparedSnapshots: 5, checkpoints: [] };
    const evidence = { run: { seed: 1201 }, provenance: { prefix: proof } } as R;
    const prior = { run: { seed: 1202, finalTick: 6000 }, samples: Array(301), frames: Array(301), tickRows: Array(6000) };
    expect(() => validatePrefixRecord(evidence, prior)).toThrow(/wrong-seed or incomplete pinned prefix/);
  });

  it('compares prefix tick 6,000 and stops prefix access at 6,001', () => {
    const prior = JSON.parse(readFileSync(new URL('../../docs/creative-prototypes/uniform-food-seed-1203.json', import.meta.url), 'utf8'));
    const atEnd = prior.samples.find((x: R) => x.tick === 6000);
    const row = prior.tickRows[5999];
    const before = { ...atEnd.census, tick: 5999, population: atEnd.census.population - row.births + row.deaths,
      cells: prior.tickRows[5998].cells, births: atEnd.census.births - row.births, deaths: atEnd.census.deaths - row.deaths,
      blockedCapBirths: atEnd.census.blockedCapBirths - row.blockedCap, blockedSpaceBirths: atEnd.census.blockedSpaceBirths - row.blockedSpace };
    const state = prior.snapshots.find((x: R) => x.tick === 6000).state;
    const world = { snapshot: () => state, environment: atEnd.environment };
    const checkpoints: R[] = [];
    expect(() => validatePrefixTick(6000, before, atEnd.census, world as any, prior, checkpoints as any)).not.toThrow();
    expect(checkpoints).toEqual([{ tick: 6000, normalizedStateSha256: atEnd.stateSha256, compared: true }]);
    expect(() => validatePrefixTick(6001, null as any, null as any, null as any, null as any, [])).not.toThrow();
  });

  it('validates normalized and raw frame digests while allowing stored body energy', () => {
    const food = Buffer.alloc(RULES.tileCount);
    const base: R = { tick: 0, censusSha256: 'a'.repeat(64), stateSha256: 'b'.repeat(64), normalizedStateSha256: 'c'.repeat(64),
      normalizedFrameSha256: '', foodBase64: food.toString('base64'), cells: [[7, 1]],
      organisms: [{ id: 1, family: 0, genome: { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 } }],
      ledger: { initialEnergy: 40, supplied: 0, dissipated: 0, deathLoss: 0, expected: 40, actual: 40, residual: 0 } };
    base.normalizedFrameSha256 = normalizedFrameDigest(base, base.normalizedStateSha256);
    base.frameSha256 = digest(base);
    expect(() => validateFrame(base)).not.toThrow();
    expect(food.reduce((a, b) => a + b, 0) + RULES.structurePerCell).toBeLessThan(base.ledger.actual);

    const badLedger = structuredClone(base); badLedger.ledger.expected = 41; badLedger.ledger.residual = 0; badLedger.frameSha256 = digest(badLedger);
    expect(() => validateFrame(badLedger)).toThrow(/frame energy ledger/);
    const badNormalization = structuredClone(base); badNormalization.normalizedStateSha256 = 'd'.repeat(64);
    delete badNormalization.frameSha256; badNormalization.frameSha256 = digest(badNormalization);
    expect(() => validateFrame(badNormalization)).toThrow(/normalized frame digest/);
  });

  it('binds sampled body IDs to the final lineage, not merely the palette', () => {
    const world = new HungryWorld(1203, true, 'uniform'); const frame = makeFrame(world);
    const census = world.census();
    expect(() => validateFrameLineage(frame, world.lineage, census)).not.toThrow();
    const changedFinal = structuredClone(world.lineage); changedFinal[0]!.family = (changedFinal[0]!.family + 1) % 3;
    expect(() => validateFrameLineage(frame, changedFinal, census)).toThrow(/frame body IDs\/family\/genome differ/);
  });

  it('joins retained snapshot history to samples and rejects missing lineage parents', () => {
    const { world, state } = stateAtZero(); const sample = { tick: 0, census: world.census() };
    expect(() => validateSnapshotHistoryBindings(state, [sample] as any)).not.toThrow();
    const wrong = structuredClone(sample); wrong.census.population++;
    expect(() => validateSnapshotHistoryBindings(state, [wrong] as any)).toThrow(/snapshot history\/sample mismatch/);

    const lineage = structuredClone(state.lineage) as R[];
    delete lineage[0]!.parentRecordDropped;
    expect(() => validateLineage(lineage, 0)).toThrow(/required fields mismatch/);
  });

  it('checks snapshot lineage as of its tick and integral retained growth cursors', () => {
    const { world, state } = stateAtZero();
    expect(() => validateSnapshotLineageProjection(state, world.lineage)).not.toThrow();
    const changed = structuredClone(world.lineage) as R[]; changed[0]!.family = (changed[0]!.family + 1) % 3;
    expect(() => validateSnapshotLineageProjection(state, changed)).toThrow(/snapshot lineage differs/);

    const fractional = structuredClone(state) as R; fractional.organisms[0].growthCursor = 0.5;
    expect(() => validateSnapshot(fractional, { seed: 1203, tick: 0, extinctionTick: null })).toThrow(/growth queue/);
  });

  it('does not accept extinction metadata while organisms remain alive', () => {
    const { state } = stateAtZero();
    expect(() => validateSnapshot(state, { seed: 1203, tick: 0, extinctionTick: 0 })).toThrow(/state identity/);
    const dropped = structuredClone(state) as R; dropped.droppedHistory = 1;
    expect(() => validateSnapshot(dropped, { seed: 1203, tick: 0, extinctionTick: null })).toThrow(/dropped observations/);
  });

  it('keeps the 9,000-tick living and family gates tied to endpoint population', () => {
    const windows = WINDOWS.map((w) => ({ from: w.from, births: 1, deaths: 1, cap48Ticks: 99 }));
    const alive = { population: 2, familyCounts: [1, 1, 0] } as any;
    expect(evaluateGate(9000, alive, windows)).toMatchObject({ aliveAt9000: true, atLeastTwoFamiliesAt9000: true, numericalPass: true });
    expect(evaluateGate(9000, { ...alive, population: 0, familyCounts: [0, 0, 0] }, windows)).toMatchObject({ aliveAt9000: false, atLeastTwoFamiliesAt9000: false, numericalPass: false });
    const capFail = structuredClone(windows); capFail[1]!.cap48Ticks = 100;
    expect(evaluateGate(9000, alive, capFail).numericalPass).toBe(false);
    const noBirths = structuredClone(windows); noBirths[2]!.births = 0;
    const noDeaths = structuredClone(windows); noDeaths[3]!.deaths = 0;
    expect(evaluateGate(9000, alive, noBirths).eachNewWindowHasBirthsAndDeaths).toBe(false);
    expect(evaluateGate(9000, alive, noDeaths).eachNewWindowHasBirthsAndDeaths).toBe(false);
    expect(FIXED_SNAPSHOTS).toEqual([0, 6000, 7000, 8000, 9000]);
  });

  it('keeps an off-cadence extinction tick as the terminal sample and snapshot', () => {
    expect(expectedSampleTicks(37, 37)).toEqual([0, 20, 37]);
    expect(expectedSnapshotTicks(37, 37)).toEqual([0, 37]);
  });

  it('accepts the pinned 1203 endurance artifact before corruption cases', () => {
    expect(() => validateEvidenceStructure(acceptedArtifact(), LOADED_SOURCE_SHA256)).not.toThrow();
  });

  it('rejects a missing prefix proof after outer-artifact resealing', () => {
    const data = acceptedArtifact(); delete data.provenance.prefix; resealArtifact(data);
    expect(() => validateEvidenceStructure(data, LOADED_SOURCE_SHA256)).toThrow(/provenance: required fields mismatch/);
  });

  it('rejects an unrecognized extra normalized field after outer-artifact resealing', () => {
    const data = acceptedArtifact(); data.samples[0].normalizedFrameSha256 = 'a'.repeat(64); resealArtifact(data);
    expect(() => validateEvidenceStructure(data, LOADED_SOURCE_SHA256)).toThrow(/sample\[0\]: required fields mismatch/);
  });

  it('rejects a changed prefix biological state after all related hashes are recomputed', () => {
    const data = acceptedArtifact();
    const snapshot = data.snapshots.find((x: R) => x.tick === 6000); const sample = data.samples.find((x: R) => x.tick === 6000);
    const frame = data.frames.find((x: R) => x.tick === 6000); const organism = snapshot.state.organisms[0];
    organism.age = organism.age === 0 ? 1 : organism.age - 1;
    snapshot.stateSha256 = digest({ state: snapshot.state, environment: snapshot.environment }); sample.stateSha256 = snapshot.stateSha256;
    const normalized = structuredClone(snapshot.state); normalized.rules.maxHistory = 301;
    const normalizedSha = digest({ state: normalized, environment: snapshot.environment });
    sample.normalizedStateSha256 = normalizedSha; frame.stateSha256 = sample.stateSha256; frame.normalizedStateSha256 = normalizedSha;
    frame.normalizedFrameSha256 = normalizedFrameDigest(frame, normalizedSha);
    delete frame.frameSha256; frame.frameSha256 = digest(frame); sample.frameSha256 = frame.frameSha256;
    resealArtifact(data);
    expect(() => validateEvidenceStructure(data, LOADED_SOURCE_SHA256)).toThrow(/prefix sample mismatch at 6000/);
  });

  it('rejects a changed tick 5,999 observation against the exact historical prefix', () => {
    const data = acceptedArtifact(); data.tickRows[5998].cells++; resealArtifact(data);
    expect(() => validateEvidenceStructure(data, LOADED_SOURCE_SHA256)).toThrow(/prefix tick rows mismatch/);
  });

  it('requires one explicit supported seed and one runner action', () => {
    expect(() => parseArgs(['--write'])).toThrow(/explicit --seed/);
    expect(() => parseArgs(['--write', '--check', '--seed', '1201'])).toThrow(/exactly one/);
    expect(parseArgs(['--check', '--seed', '1203'])).toEqual({ mode: '--check', seed: 1203 });
    expect(() => parseArgs(['--check', '--seed', '1204'])).toThrow(/invalid integer/);
  });
});
