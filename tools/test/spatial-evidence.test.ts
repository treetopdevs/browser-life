import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildMarkdown, HORIZON, PRESET_IDS, SEEDS, SNAPSHOT_TICKS, validateEvidenceStructure } from '../spatial/explore.ts';
import { PRESETS, RULES } from '../../apps/lab/src/spatial/model.ts';

const canonical = (value: any): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
function reseal(value: any) { delete value.integritySha256; value.integritySha256 = hash(canonical(value)); return value; }
function census(tick: number, population = 120) {
  return { tick, population, counts: population ? [40, 40, 40] : [0, 0, 0], births: tick, deaths: 0, mutations: 0, blockedBirths: 0,
    maxGeneration: 0, meanSpeed: population ? .001 : 0, meanAbsVx: population ? .001 : 0, meanAbsVy: 0, meanAbsVz: 0,
    traitSpread: 0, particleEnergy: population * 4, foodEnergy: 240, occupiedBins: population ? 75 : 0, occupiedZBands: population ? 5 : 0 };
}
function snapshotState(tick: number, population = 120, preset = 'flocks', seed = 1201) {
  const current = census(tick, population);
  const particles = Array.from({ length: population }, (_, i) => ({ id: i, family: i % 3,
    x: ((i % 15) % 5 + .1) / 5, y: (Math.floor((i % 15) / 5) + .1) / 5,
    z: (Math.floor((i % 75) / 15) + .1) / 5, vx: .001, vy: 0, vz: 0,
    energy: 4, age: Math.min(tick, 100), lifespan: 1400, generation: 0, traits: [0, 0, 0] }));
  const food = Array.from({ length: 8 }, (_, i) => ({ x: i % 2 ? .75 : .25, y: i % 4 >= 2 ? .75 : .25,
    z: i >= 4 ? .75 : .25, radius: .3, amount: 30 }));
  return { kind: 'spatial-world-observation', description: 'Observation only; not a resumable checkpoint', rules: RULES,
    settings: { seed, preset, mutation: true, recipe: {} }, current,
    ledger: { initial: 720, renewed: 0, consumed: 0, dissipated: 0, deathLoss: population ? 0 : 480 },
    particles, food, history: [census(0)] };
}
function window(fromTick: number, toTick: number, executedSteps: number, livingSteps = executedSteps, extinct = false) {
  return { fromTick, toTick, executedSteps, livingSteps, meanSpeed: livingSteps ? .001 : null,
    meanAbsVz: livingSteps ? 0 : null, meanAbsVx: livingSteps ? .001 : null, meanAbsVy: livingSteps ? 0 : null,
    zToHorizontalAbsSpeedRatio: livingSteps ? 0 : null, meanOccupiedBins: livingSteps ? 75 : null,
    meanOccupiedZBands: livingSteps ? 5 : null, minOccupiedZBands: livingSteps ? 5 : null, maxOccupiedZBands: livingSteps ? 5 : null,
    minPopulation: executedSteps ? (extinct ? 0 : 100) : null, maxPopulation: executedSteps ? 120 : null,
    finalPopulation: executedSteps ? (extinct ? 0 : 120) : null,
    capFraction: livingSteps ? 0 : null, birthsDelta: executedSteps ? executedSteps : null, deathsDelta: executedSteps ? (extinct ? 1 : 0) : null };
}
function run(preset: string, seed: number) {
  const censusSamples = Array.from({ length: HORIZON / 100 + 1 }, (_, i) => ({ tick: i * 100, census: census(i * 100) }));
  const snapshots = SNAPSHOT_TICKS.map(tick => {
    const state = snapshotState(tick, 120, preset, seed);
    return { tick, state, sha256: hash(canonical(state)) };
  });
  const finalCensus = census(HORIZON);
  const earlyWindow = window(1, 1000, 1000), lateWindow = window(5001, 6000, 1000);
  const result = { preset, seed, mutation: true, requestedTicks: HORIZON, ticksCompleted: HORIZON, extinctionTick: null,
    censusSamples, snapshots, earlyWindow, lateWindow, lateAssayFlags: { allLivingLateStepsOneZBand: false, noLateZMotion: true },
    maximumLedgerResidual: 0, finalCensus,
    finalSnapshotSha256: snapshots.at(-1)!.sha256, familyExtinctionTicks: [null, null, null] };
  return { ...result, repeat: { ticksCompleted: HORIZON, extinctionTick: null, censusSamples, snapshots, earlyWindow, lateWindow,
    lateAssayFlags: result.lateAssayFlags, familyExtinctionTicks: result.familyExtinctionTicks,
    maximumLedgerResidual: 0, finalCensus, finalSnapshotSha256: result.finalSnapshotSha256 } };
}
function fixture() {
  const value: any = { schemaVersion: 1, kind: 'spatial-particle-pilot',
    sourceSha256: { 'apps/lab/src/spatial/model.ts': 'a'.repeat(64), 'tools/spatial/explore.ts': 'b'.repeat(64) },
    runtime: { node: 'v24.0.0', platform: 'darwin', arch: 'arm64' }, rules: RULES, presets: PRESETS,
    seeds: [...SEEDS], requestedTicks: HORIZON, mutation: true, censusEvery: 100, snapshotTicks: [...SNAPSHOT_TICKS],
    lateWindow: { fromTick: 5001, toTick: 6000 }, outcomes: [] };
  for (const preset of PRESET_IDS) for (const seed of SEEDS) value.outcomes.push(run(preset, seed));
  value.integritySha256 = hash(canonical(value));
  return value;
}

describe('spatial pilot evidence guards', () => {
  it('accepts the complete ordered 3 × 3 matrix and renders the retained outcomes', () => {
    const data = fixture();
    expect(() => validateEvidenceStructure(data)).not.toThrow();
    const report = buildMarkdown(data);
    expect(report).toContain('flocks | 1201 | 6000');
    expect(report).toContain('Living / executed steps');
    expect(report).toContain('engineered renewable energy');
  });

  it('rejects missing, reordered, or duplicate matrix outcomes', () => {
    const missing = fixture(); missing.outcomes.pop();
    expect(() => validateEvidenceStructure(missing)).toThrow(/exactly nine primary outcomes|integrity hash/);
    const reordered = fixture(); reordered.outcomes.reverse();
    expect(() => validateEvidenceStructure(reordered)).toThrow(/matrix identity mismatch/);
  });

  it('checks exact census cadence, snapshot hashes, and repeat agreement', () => {
    const badCensus = fixture(); badCensus.outcomes[0].censusSamples[2].tick = 201;
    expect(() => validateEvidenceStructure(badCensus)).toThrow(/integrity hash|census cadence/);
    const skippedCensus = fixture(); skippedCensus.outcomes[0].censusSamples.splice(2, 1);
    expect(() => validateEvidenceStructure(skippedCensus)).toThrow(/incomplete or extra census cadence/);
    const badSnapshot = fixture(); badSnapshot.outcomes[0].snapshots[1].state.current.population++;
    expect(() => validateEvidenceStructure(badSnapshot)).toThrow(/integrity hash|snapshot hash mismatch|family census invalid/);
    const badRepeat = fixture(); badRepeat.outcomes[0].repeat.finalSnapshotSha256 = 'f'.repeat(64);
    expect(() => validateEvidenceStructure(badRepeat)).toThrow(/integrity hash|snapshot reference mismatch|repeat final snapshot differs/);
  });

  it('rejects a repeat that omits its own census and snapshot records', () => {
    const incomplete = fixture();
    const primary = incomplete.outcomes[0];
    primary.repeat = { ticksCompleted: primary.ticksCompleted, extinctionTick: primary.extinctionTick,
      finalSnapshotSha256: primary.finalSnapshotSha256 };
    reseal(incomplete);
    expect(() => validateEvidenceStructure(incomplete)).toThrow(/repeat census samples missing/);
  });

  it('requires full snapshots at scheduled ticks and the exact extinction tick', () => {
    const missingScheduled = fixture(); missingScheduled.outcomes[0].snapshots.splice(1, 1);
    expect(() => validateEvidenceStructure(missingScheduled)).toThrow(/integrity hash|full snapshot 1000 missing/);
    const censusOnly = fixture();
    delete censusOnly.outcomes[0].snapshots[0].state.particles;
    censusOnly.outcomes[0].snapshots[0].sha256 = hash(canonical(censusOnly.outcomes[0].snapshots[0].state));
    reseal(censusOnly);
    expect(() => validateEvidenceStructure(censusOnly)).toThrow(/snapshot particle inventory missing/);
    for (const field of ['id', 'traits', 'age', 'lifespan', 'generation']) {
      const incompleteParticle = fixture();
      delete incompleteParticle.outcomes[0].snapshots[0].state.particles[0][field];
      incompleteParticle.outcomes[0].snapshots[0].sha256 = hash(canonical(incompleteParticle.outcomes[0].snapshots[0].state));
      reseal(incompleteParticle);
      expect(() => validateEvidenceStructure(incompleteParticle)).toThrow(/particle id invalid|particle lifecycle invalid|particle traits invalid/);
    }
    const extinct = fixture();
    const r = extinct.outcomes[0]; r.ticksCompleted = r.extinctionTick = 5051;
    r.censusSamples = r.censusSamples.filter((s: any) => s.tick < 5100);
    const final = { ...census(5051, 0), counts: [0, 0, 0], particleEnergy: 0, foodEnergy: 240 };
    r.censusSamples.push({ tick: 5051, census: final }); r.finalCensus = final;
    r.snapshots = r.snapshots.filter((s: any) => s.tick <= 3000);
    const state = snapshotState(5051, 0, r.preset, r.seed);
    state.current = final;
    const record = { tick: 5051, state, sha256: hash(canonical(state)) }; r.snapshots.push(record); r.finalSnapshotSha256 = record.sha256;
    r.lateWindow = window(5001, 6000, 51, 50, true);
    r.lateWindow.minPopulation = 0; r.lateWindow.finalPopulation = 0;
    r.lateAssayFlags = { allLivingLateStepsOneZBand: false, noLateZMotion: true };
    r.familyExtinctionTicks = [5051, 5051, 5051];
    r.repeat = { ...r.repeat, ticksCompleted: 5051, extinctionTick: 5051, censusSamples: r.censusSamples, snapshots: r.snapshots,
      finalCensus: final, finalSnapshotSha256: record.sha256, lateWindow: r.lateWindow, lateAssayFlags: r.lateAssayFlags,
      familyExtinctionTicks: r.familyExtinctionTicks };
    reseal(extinct);
    expect(() => validateEvidenceStructure(extinct)).not.toThrow();
    r.repeat.snapshots.pop();
    expect(() => validateEvidenceStructure(extinct)).toThrow(/integrity hash|exact extinction snapshot missing/);
  });

  it('rejects stale source hashes and unavailable late metrics represented as zero', () => {
    const data = fixture();
    expect(() => validateEvidenceStructure(data, { sources: { ...data.sourceSha256, 'apps/lab/src/spatial/model.ts': 'c'.repeat(64) } })).toThrow(/source hashes are stale/);
    const noLateLife = fixture();
    const r = noLateLife.outcomes[0]; r.ticksCompleted = r.extinctionTick = 4000;
    r.censusSamples = r.censusSamples.filter((s: any) => s.tick < 4000);
    r.finalCensus = census(4000, 0); r.censusSamples.push({ tick: 4000, census: r.finalCensus });
    r.snapshots = r.snapshots.filter((s: any) => s.tick <= 3000);
    r.lateWindow = window(5001, 6000, 0, 0);
    r.snapshots.push({ tick: 4000, state: snapshotState(4000, 0, r.preset, r.seed), sha256: '' });
    r.snapshots.at(-1).state.current = r.finalCensus;
    r.snapshots.at(-1).sha256 = hash(canonical(r.snapshots.at(-1).state));
    r.finalSnapshotSha256 = r.snapshots.at(-1).sha256;
    r.familyExtinctionTicks = [4000, 4000, 4000];
    r.repeat = { ...r.repeat, ticksCompleted: 4000, extinctionTick: 4000, censusSamples: r.censusSamples, snapshots: r.snapshots,
      finalCensus: r.finalCensus, finalSnapshotSha256: r.finalSnapshotSha256, lateWindow: r.lateWindow,
      familyExtinctionTicks: r.familyExtinctionTicks, lateAssayFlags: { allLivingLateStepsOneZBand: false, noLateZMotion: false } };
    r.lateAssayFlags = { allLivingLateStepsOneZBand: false, noLateZMotion: false };
    r.lateWindow.meanSpeed = 0;
    r.lateAssayFlags = { allLivingLateStepsOneZBand: false, noLateZMotion: false };
    r.repeat.lateAssayFlags = r.lateAssayFlags;
    reseal(noLateLife);
    expect(() => validateEvidenceStructure(noLateLife)).toThrow(/metric meanSpeed must be null without living steps/);
  });
});
