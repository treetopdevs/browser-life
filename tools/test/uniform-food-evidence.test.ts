import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHungryFixture, RULES, type DevelopmentSnapshot } from '../../apps/lab/src/hungry-shapes/model.ts';

// The replays are kept out of git (docs/creative-prototypes/ARTIFACTS.md); restore them to run these checks.
const hasReplays = ['hungry-shapes-seed-1201.json'].every((name) => existsSync(new URL(`../../docs/creative-prototypes/${name}`, import.meta.url)));
const { FIXED_SNAPSHOTS, LOADED_SOURCE_SHA256, WINDOWS, buildMarkdown, evaluateGate, parseArgs, validateEvidenceStructure, validateFrame } = (hasReplays ? await import('../uniform-food/explore.ts') : {}) as typeof import('../uniform-food/explore.ts');

type R = Record<string, any>;
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
function resealFrame(frame: R): void { delete frame.frameSha256; frame.frameSha256 = digest(frame); }
function resealState(data: R, index: number): void {
  const snapshot = data.snapshots[index]; snapshot.stateSha256 = digest({ state: snapshot.state, environment: snapshot.environment });
  const sample = data.samples.find((x: R) => x.tick === snapshot.tick); const frame = data.frames.find((x: R) => x.tick === snapshot.tick);
  sample.stateSha256 = snapshot.stateSha256; frame.stateSha256 = snapshot.stateSha256; resealFrame(frame);
  sample.frameSha256 = frame.frameSha256;
}
function reseal(data: R): void { delete data.dataSha256; data.dataSha256 = digest(data); }

function fixtureArtifact(): R {
  const world = createHungryFixture({ seed: 1202, mutation: true, food: 0,
    founders: Array.from({ length: 12 }, (_, i) => ({ tile: 300 + i * 10, heading: 0,
      genome: { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 }, age: 0, store: 0 })) }, 'uniform');
  const snapshot = (): DevelopmentSnapshot => {
    const state = JSON.parse(JSON.stringify(world.snapshot())) as DevelopmentSnapshot;
    (state as any).runtime = 'Node 24.2.0';
    return state;
  };
  const census = () => world.census();
  const frameAt = (c: ReturnType<typeof world.census>, s: DevelopmentSnapshot) => {
    const base = { tick: s.tick, censusSha256: digest(c), stateSha256: digest({ state: s, environment: world.environment }),
      foodBase64: Buffer.from(s.food).toString('base64'), cells: s.organisms.flatMap((o) => o.cells.map((cell) => [cell.tile, o.id] as [number, number])).sort((a,b) => a[0]-b[0]),
      organisms: s.organisms.map((o) => ({ id: o.id, family: o.family, genome: o.genome })), ledger: s.ledger };
    return { ...base, frameSha256: digest(base) };
  };
  const makeSample = () => {
    const s = snapshot(); const c = census(); const environment = world.environment; const stateSha256 = digest({ state: s, environment });
    const f = frameAt(c, s); f.stateSha256 = stateSha256; resealFrame(f);
    return { sample: { tick: s.tick, census: c, environment, censusSha256: digest(c), stateSha256, frameSha256: f.frameSha256 }, state: s, frame: f };
  };
  const initial = makeSample(); world.step(1); const terminal = makeSample();
  const tickRows = [{ tick: 1, population: 0, cells: 0, births: 0, deaths: 12, blockedCap: 0, blockedSpace: 0, cap48: false, nearCap47: false }];
  const windows = WINDOWS.map((w) => ({ from: w.from, to: w.to, denominatorTicks: 500, executedTicks: 0, zeroOccupancyTicks: 500, births: 0, deaths: 0,
    cap48Ticks: 0, nearCap47Ticks: 0, blockedCapAttempts: 0, blockedSpaceAttempts: 0, minPopulation: null, maxPopulation: null,
    endpoint: { requestedTick: w.to, actualTick: 1, population: 0, cells: 0, familyCounts: [0,0,0], genomeCounts: [] },
    start: { requestedTick: w.from - 1, actualTick: 1, environment: terminal.sample.environment }, endEnvironment: terminal.sample.environment,
    postExtinctionSlots: 500, extinctionTick: 1 }));
  const finalState = terminal.state;
  const data: R = { schemaVersion: 1, kind: 'hungry-shapes-uniform-long-run',
    run: { seed: 1202, mode: 'uniform', mutation: true, maxTick: 6000, finalTick: 1, extinctionTick: 1 },
    runtime: { node: '24.2.0', platform: 'darwin', arch: 'arm64' }, rules: RULES,
    provenance: { sourceSha256: LOADED_SOURCE_SHA256,
      priorArtifactSha256: '2cb6366595e43e2f5f215448bd13a67925e21f2ea11e4747790f6f61470b6520',
      priorDataSha256: '0a99689d96d576e5fff3437c7d31ed6a1e078497fa27b71400deff4823e523c6',
      prefix: { status: 'not-applicable', seed: null, fullStateProof: 'not applicable', comparedSamples: 0, comparedLateTicks: 0, checkpointStateSha256: [] } },
    samples: [initial.sample, terminal.sample], tickRows, frames: [initial.frame, terminal.frame],
    snapshots: [{ tick: 0, terminal: false, environment: initial.sample.environment, state: initial.state, stateSha256: initial.sample.stateSha256 },
      { tick: 1, terminal: true, environment: terminal.sample.environment, state: terminal.state, stateSha256: terminal.sample.stateSha256 }],
    windows, final: { census: terminal.sample.census, environment: terminal.sample.environment, ledger: finalState.ledger, lineage: finalState.lineage,
      deathsByCause: { age: 0, starvation: 12 }, maxEverGeneration: 0, stateSha256: terminal.sample.stateSha256 },
    repeat: { verified: true, comparedThroughTick: 1, stateChecks: 2, frameChecks: 2 },
    numericalGate: { aliveAt6000: false, eachNewWindowHasBirthsAndDeaths: false, eachNewWindowCap48AtMost99: true,
      atLeastTwoFamiliesAt6000: false, numericalPass: false, note: 'Numerical screen only; visual judgment is manual and required for the plan gate.' } };
  data.dataSha256 = digest(data); return data;
}

describe.skipIf(!hasReplays)('uniform-food evidence contract', () => {
  it('accepts a rehashed fixture artifact without running a pilot', () => {
    const data = fixtureArtifact();
    expect(() => validateEvidenceStructure(data, LOADED_SOURCE_SHA256)).not.toThrow();
    expect(buildMarkdown(data)).toContain('2501–3000');
    expect(FIXED_SNAPSHOTS).toEqual([0, 3000, 4000, 5000, 6000]);
  });

  it('rejects a rehashed population transition contradiction', () => {
    const data = fixtureArtifact(); data.tickRows[0].population = 1; reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/population transition mismatch/);
  });

  it('binds every death delta to complete lineage events', () => {
    const data = fixtureArtifact(); data.tickRows[0].deaths = 11; data.tickRows[0].population = 1; reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/lineage event delta mismatch/);
  });

  it('rejects altered food bytes even after frame and artifact resealing', () => {
    const data = fixtureArtifact(); const bytes = Buffer.from(data.frames[0].foodBase64, 'base64'); bytes[0]++;
    data.frames[0].foodBase64 = bytes.toString('base64'); resealFrame(data.frames[0]);
    data.samples[0].frameSha256 = data.frames[0].frameSha256; reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/energy bounds|energy mismatch|projection mismatch/);
  });

  it('rejects body IDs missing their declared organism palette', () => {
    const data = fixtureArtifact(); data.frames[0].cells[0][1] = 900; resealFrame(data.frames[0]);
    data.samples[0].frameSha256 = data.frames[0].frameSha256; reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/cell has no organism palette/);
  });

  it('joins every recorded body ID and palette to the living final lineage', () => {
    const data = fixtureArtifact(); const frame = data.frames[0]; const oldId = frame.organisms[0].id;
    frame.organisms[0].id = 900;
    for (const cell of frame.cells) if (cell[1] === oldId) cell[1] = 900;
    resealFrame(frame); data.samples[0].frameSha256 = frame.frameSha256; reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/frame body IDs\/family\/genome differ from living lineage/);
  });

  it('joins every retained snapshot history row to its census sample', () => {
    const data = fixtureArtifact(); data.snapshots[1].state.history[0].attemptedMutations = 1;
    resealState(data, 1); reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/snapshot history\/sample mismatch/);
  });

  it('projects final lineage back to every snapshot tick', () => {
    const data = fixtureArtifact(); data.snapshots[0].state.lineage[0].family = 2;
    resealState(data, 0); reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/snapshot lineage differs from final lineage projection/);
  });

  it('requires parentRecordDropped and integral growth cursors after resealing', () => {
    const missing = fixtureArtifact(); delete missing.final.lineage[0].parentRecordDropped; reseal(missing);
    expect(() => validateEvidenceStructure(missing)).toThrow(/required fields mismatch/);

    const fractional = fixtureArtifact(); fractional.snapshots[0].state.organisms[0].growthCursor = 0.5;
    resealState(fractional, 0); reseal(fractional);
    expect(() => validateEvidenceStructure(fractional)).toThrow(/growth queue/);
  });

  it('rejects extinction metadata with a living terminal census', () => {
    const data = fixtureArtifact(); data.final.census = { ...data.final.census, population: 1 }; reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/extinct run has living terminal population/);
  });

  it('rejects missing required snapshot counters after all hashes are recomputed', () => {
    const data = fixtureArtifact(); delete data.snapshots[1].state.counters.attemptedMutations; resealState(data, 1); reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/required fields mismatch/);
  });

  it('requires the full off-cadence terminal sample and frame', () => {
    const data = fixtureArtifact(); data.frames.pop(); reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/frame cadence\/terminal mismatch/);
  });

  it('uses the frozen inclusive 99/100 cap boundary', () => {
    const census = { population: 2, familyCounts: [1, 1, 0] } as any;
    const good = [2501, 3501, 4501, 5501].map((from) => ({ from, births: 1, deaths: 1, cap48Ticks: 99 }));
    const bad = structuredClone(good); bad[1]!.cap48Ticks = 100;
    expect(evaluateGate(6000, census, good).numericalPass).toBe(true);
    expect(evaluateGate(6000, census, bad).numericalPass).toBe(false);
  });

  it('allows stored body energy in the exact frame/census energy identity', () => {
    const base: R = { tick: 0, censusSha256: 'a'.repeat(64), stateSha256: 'b'.repeat(64), foodBase64: Buffer.alloc(RULES.tileCount).toString('base64'),
      cells: [[7, 1]], organisms: [{ id: 1, family: 0, genome: { turnEvery: 4, turn: 0, branchEvery: 4, maxCells: 24 } }],
      ledger: { initialEnergy: 5, supplied: 0, dissipated: 0, deathLoss: 0, expected: 5, actual: 5, residual: 0 } };
    base.frameSha256 = digest(base);
    expect(() => validateFrame(base)).not.toThrow();
    expect(0 + 1 * RULES.structurePerCell).toBeLessThan(base.ledger.actual);
  });

  it('rejects a zero-residual ledger with unequal actual and expected energy', () => {
    const data = fixtureArtifact(); data.snapshots[1].state.ledger.actual += 1;
    data.snapshots[1].stateSha256 = digest({ state: data.snapshots[1].state, environment: data.snapshots[1].environment });
    data.samples[1].stateSha256 = data.snapshots[1].stateSha256; data.frames[1].stateSha256 = data.snapshots[1].stateSha256;
    data.frames[1].ledger = data.snapshots[1].state.ledger; resealFrame(data.frames[1]); data.samples[1].frameSha256 = data.frames[1].frameSha256;
    reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/energy conservation|energy bounds/);
  });

  it('rejects a rehashed dissipated-energy contradiction on an intermediate frame', () => {
    const data = fixtureArtifact(); const ledger = data.frames[0].ledger;
    ledger.dissipated += 1; ledger.expected -= 1; ledger.residual = 0;
    resealFrame(data.frames[0]); data.samples[0].frameSha256 = data.frames[0].frameSha256; reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/frame energy bounds/);
  });

  it('requires seed1201 prefix evidence and validates source/pilot identities', () => {
    const missing = fixtureArtifact(); missing.run.seed = 1201; reseal(missing);
    expect(() => validateEvidenceStructure(missing)).toThrow(/seed1201 prefix proof missing/);
    const altered = fixtureArtifact(); altered.provenance.priorArtifactSha256 = 'f'.repeat(64); reseal(altered);
    expect(() => validateEvidenceStructure(altered)).toThrow(/pinned prior identity mismatch/);
  });

  it('requires one explicit supported seed and one action', () => {
    expect(() => parseArgs(['--write'])).toThrow(/explicit --seed/);
    expect(() => parseArgs(['--write', '--check', '--seed', '1201'])).toThrow(/exactly one/);
    expect(parseArgs(['--check', '--seed', '1202'])).toEqual({ mode: '--check', seed: 1202 });
    expect(() => parseArgs(['--check', '--seed', '1204'])).toThrow(/invalid integer/);
  });
});
