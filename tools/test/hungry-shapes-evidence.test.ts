import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { LATE_DENOMINATOR, LOADED_SOURCE_SHA256, MODES, SAMPLE_EVERY, SNAPSHOT_TICKS, assertSourceIdentity, buildMarkdown, parseArgs, validateEvidenceStructure } from '../hungry-shapes/explore.ts';
import { RULES } from '../../apps/lab/src/hungry-shapes/model.ts';

type AnyRecord = Record<string, any>;

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function emptyCensus(tick: number): AnyRecord {
  return { tick, population: 0, cells: 0, familyCounts: [0, 0, 0], births: 0, growths: 0, deaths: 0, effectiveMutations: 0,
    attemptedMutations: 0, maxGeneration: 0, totalCells: 0, totalEnergy: 0, meanBodyCells: 0, meanEnergy: 0,
    blockedBirths: 0, blockedSpaceBirths: 0, blockedCapBirths: 0, ledgerResidual: 0, genomeVariantCount: 0 };
}

function syntheticEvidence(): AnyRecord {
  const seed = 1201;
  const runs = MODES.map((mode) => {
    const pulseBudget = mode === 'original' ? RULES.tileCount : 768;
    const targetCount = mode === 'patches' ? 972 : RULES.tileCount;
    const censusAt = (tick: number) => emptyCensus(tick);
    const ledger = { initialEnergy: RULES.tileCount * RULES.initialFood, supplied: 0, dissipated: 0, deathLoss: 0,
      expected: RULES.tileCount * RULES.initialFood, actual: RULES.tileCount * RULES.initialFood, residual: 0 };
    const environmentAt = (tick: number) => {
      const pulses = tick / RULES.foodSupplyEvery;
      const offered = pulses * pulseBudget;
      return { version: 1, mode, pulseBudget, targetCount, pulses, offered, accepted: 0, overflow: offered, initialFoodPerTile: RULES.initialFood };
    };
    const stateAt = (tick: number, extinctionTick: number | null = null) => {
      const ticks = [0];
      for (let at = RULES.historyEvery; at <= tick; at += RULES.historyEvery) ticks.push(at);
      if (extinctionTick !== null && !ticks.includes(extinctionTick)) ticks.push(extinctionTick);
      ticks.sort((a, b) => a - b);
      return { schemaVersion: 1, description: 'observation only; not a resume checkpoint', runtime: 'Node 24.2.0', rules: RULES,
        seed, mutation: true, tick, extinctionTick, food: new Array(RULES.tileCount).fill(RULES.initialFood),
        occupancy: new Array(RULES.tileCount).fill(0), organisms: [], ledger: { ...ledger },
        counters: { births: 0, growths: 0, deaths: 0, effectiveMutations: 0, attemptedMutations: 0, blockedSpaceBirths: 0, blockedCapBirths: 0 },
        history: ticks.map(emptyCensus), droppedHistory: 0, lineage: [], droppedLineage: 0 };
    };
    const samples = Array.from({ length: 3000 / SAMPLE_EVERY + 1 }, (_unused, index) => {
      const tick = index * SAMPLE_EVERY;
      return { scheduledTick: tick, actualTick: tick, stateHash: 'a'.repeat(64), census: censusAt(tick), environment: environmentAt(tick) };
    });
    const snapshots = SNAPSHOT_TICKS.map((tick) => {
      const state = stateAt(tick);
      const snapshotEnvironment = environmentAt(tick);
      return { scheduledTick: tick, actualTick: tick, stateHash: digest({ state, environment: snapshotEnvironment }),
        environment: snapshotEnvironment, state };
    });
    samples[0]!.stateHash = snapshots[0]!.stateHash;
    samples.at(-1)!.stateHash = snapshots.at(-1)!.stateHash;
    const lateTicks = Array.from({ length: LATE_DENOMINATOR }, (_unused, index) => ({ tick: 2501 + index, population: 0,
      births: 0, deaths: 0, cap48: false, nearCap47: false, blockedCap: 0, blockedSpace: 0 }));
    return {
      seed, mode, mutation: true, outcome: 'alive-at-3000', finalTick: 3000, extinctionTick: null,
      initialStateHash: 'a'.repeat(64), finalStateHash: snapshots.at(-1)!.stateHash, samples, snapshots, lateTicks,
      lateSummary: { fromTick: 2501, toTick: 3000, denominatorTicks: 500, executedTicks: 500, births: 0, deaths: 0,
        cap48Ticks: 0, nearCap47Ticks: 0, capBlockedTicks: 0, capBlockedAttempts: 0, spaceBlockedAttempts: 0, cap48FractionOfFixedWindow: 0 },
      lineage: [], maxEverGeneration: 0, deathsByCause: { age: 0, starvation: 0 },
      finalCensus: censusAt(3000), finalLedger: { ...ledger }, finalEnvironment: environmentAt(3000), repeatVerified: true,
    };
  });
  const data: AnyRecord = {
    schemaVersion: 1, pilot: 'hungry-shapes-v1',
    batch: { seed, modes: [...MODES], mutation: true, maxTick: 3000, sampleEvery: SAMPLE_EVERY,
      snapshotTicks: [...SNAPSHOT_TICKS], lateWindow: { from: 2501, to: 3000, denominatorTicks: LATE_DENOMINATOR } },
    runtime: { node: '24.2.0', platform: 'test', arch: 'test' }, rules: RULES,
    sourceSha256: { 'apps/lab/src/development/model.ts': 'b'.repeat(64), 'apps/lab/src/hungry-shapes/model.ts': 'c'.repeat(64), 'tools/hungry-shapes/explore.ts': 'd'.repeat(64) },
    runs,
  };
  data.dataSha256 = digest(data);
  return data;
}

function reseal(data: AnyRecord): void {
  delete data.dataSha256;
  data.dataSha256 = digest(data);
}

function resealSnapshot(run: AnyRecord, index: number): void {
  const item = run.snapshots[index];
  item.stateHash = digest({ state: item.state, environment: item.environment });
  if (index === run.snapshots.length - 1) run.finalStateHash = item.stateHash;
}

describe('hungry-shapes evidence contract', () => {
  it('accepts a complete synthetic three-mode artifact', () => {
    expect(() => validateEvidenceStructure(syntheticEvidence())).not.toThrow();
    const markdown = buildMarkdown(syntheticEvidence());
    expect(markdown).toContain('\n| Mode');
    expect(markdown).toContain('Cap48 ticks');
    expect(markdown).not.toContain('\\n| Mode');
  });

  it('rejects altered late cap counts even when the artifact is re-sealed', () => {
    const data = syntheticEvidence();
    data.runs[2].lateSummary.cap48Ticks = 100;
    reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/late summary differs/);
  });

  it('rejects padded or mislabeled census rows', () => {
    const data = syntheticEvidence();
    data.runs[0].samples[1].actualTick = 19;
    reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/census cadence or actual tick mismatch/);
  });

  it('rejects inconsistent food overflow accounting', () => {
    const data = syntheticEvidence();
    const run = data.runs[1];
    run.finalEnvironment.overflow++;
    run.samples.at(-1).environment.overflow++;
    run.snapshots.at(-1).environment.overflow++;
    resealSnapshot(run, run.snapshots.length - 1);
    reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/invalid retained sample or food accounting|final food accounting mismatch/);
  });

  it('keeps pre-extinction milestones alive and records only the terminal extinction state', () => {
    const data = syntheticEvidence();
    const run = data.runs[1];
    const tick = 155;
    const pulses = Math.floor(tick / RULES.foodSupplyEvery);
    const finalEnvironment = { ...run.finalEnvironment, pulses, offered: pulses * run.finalEnvironment.pulseBudget,
      overflow: pulses * run.finalEnvironment.pulseBudget };
    run.extinctionTick = tick;
    run.finalTick = tick;
    run.outcome = 'extinct';
    run.samples = run.samples.filter((row: AnyRecord) => row.actualTick <= 140);
    run.finalCensus = emptyCensus(tick);
    run.samples.push({ scheduledTick: tick, actualTick: tick, stateHash: 'b'.repeat(64), census: { ...run.finalCensus },
      environment: finalEnvironment });
    run.lateTicks = [];
    run.lateSummary.executedTicks = 0;
    const initial = run.snapshots[0];
    const terminalState = structuredClone(run.snapshots[1].state);
    terminalState.tick = tick;
    terminalState.extinctionTick = tick;
    terminalState.history = terminalState.history.filter((row: AnyRecord) => row.tick <= 140);
    terminalState.history.push(emptyCensus(tick));
    run.snapshots = [initial, { scheduledTick: null, actualTick: tick, terminal: true, state: terminalState,
      environment: finalEnvironment, stateHash: digest({ state: terminalState, environment: finalEnvironment }) }];
    run.samples.at(-1).stateHash = run.snapshots.at(-1).stateHash;
    run.finalEnvironment = finalEnvironment;
    run.finalStateHash = run.snapshots[1].stateHash;
    reseal(data);
    expect(() => validateEvidenceStructure(data)).not.toThrow();
  });

  it('rejects stale sources and tampered artifact digests', () => {
    const data = syntheticEvidence();
    expect(() => validateEvidenceStructure(data, { ...data.sourceSha256, 'apps/lab/src/hungry-shapes/model.ts': 'e'.repeat(64) })).toThrow(/source hashes are stale/);
    data.runs[0].initialStateHash = 'f'.repeat(64);
    expect(() => validateEvidenceStructure(data)).toThrow(/artifact integrity hash mismatch/);
  });

  it('rejects rehashed final census contradictions and malformed retained state', () => {
    const censusTamper = syntheticEvidence();
    censusTamper.runs[0].finalCensus.population = 49;
    reseal(censusTamper);
    expect(() => validateEvidenceStructure(censusTamper)).toThrow(/final census differs from terminal snapshot/);

    const missingFood = syntheticEvidence();
    const run = missingFood.runs[1];
    run.snapshots.at(-1).state.food = [];
    resealSnapshot(run, run.snapshots.length - 1);
    reseal(missingFood);
    expect(() => validateEvidenceStructure(missingFood)).toThrow(/invalid food array/);

    const excessPopulation = syntheticEvidence();
    const over = excessPopulation.runs[2];
    over.snapshots.at(-1).state.organisms = new Array(RULES.maxOrganisms + 1).fill({});
    resealSnapshot(over, over.snapshots.length - 1);
    reseal(excessPopulation);
    expect(() => validateEvidenceStructure(excessPopulation)).toThrow(/invalid organism list/);
  });

  it('rejects missing nested counters and incomplete history rows after rehashing', () => {
    const data = syntheticEvidence();
    const run = data.runs[0];
    const index = run.snapshots.findIndex((item: AnyRecord) => item.scheduledTick === 160);
    const state = run.snapshots[index].state;
    delete state.counters.attemptedMutations;
    delete state.history.at(-1).attemptedMutations;
    resealSnapshot(run, index);
    reseal(data);
    expect(() => validateEvidenceStructure(data)).toThrow(/required fields mismatch/);

    const missingHistoryField = syntheticEvidence();
    const historyRun = missingHistoryField.runs[0];
    const historyIndex = historyRun.snapshots.findIndex((item: AnyRecord) => item.scheduledTick === 160);
    delete historyRun.snapshots[historyIndex].state.history.at(-1).attemptedMutations;
    resealSnapshot(historyRun, historyIndex);
    reseal(missingHistoryField);
    expect(() => validateEvidenceStructure(missingHistoryField)).toThrow(/required fields mismatch/);
  });

  it('detects a source edit after module-load identity capture without running worlds', () => {
    const editedFixtureCopy = { ...LOADED_SOURCE_SHA256, 'apps/lab/src/hungry-shapes/model.ts': 'f'.repeat(64) };
    expect(() => assertSourceIdentity(LOADED_SOURCE_SHA256, editedFixtureCopy)).toThrow(/changed since the implementation was loaded/);
  });

  it('rejects a copied model changed after runner import before any simulation', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'hungry-source-guard-'));
    const copies = [
      ['tools/hungry-shapes/explore.ts', new URL('../hungry-shapes/explore.ts', import.meta.url)],
      ['apps/lab/src/development/model.ts', new URL('../../apps/lab/src/development/model.ts', import.meta.url)],
      ['apps/lab/src/hungry-shapes/model.ts', new URL('../../apps/lab/src/hungry-shapes/model.ts', import.meta.url)],
    ] as const;
    try {
      for (const [relative, source] of copies) {
        const target = join(fixture, relative);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
      }
      const runnerPath = join(fixture, 'tools/hungry-shapes/explore.ts');
      const modelPath = join(fixture, 'apps/lab/src/hungry-shapes/model.ts');
      const script = `
        import { appendFileSync } from 'node:fs';
        import { pathToFileURL } from 'node:url';
        const runner = await import(pathToFileURL(process.env.HUNGRY_RUNNER_COPY).href);
        appendFileSync(process.env.HUNGRY_MODEL_COPY, '\\n// changed after runner module load\\n');
        try { runner.buildArtifact(1201); throw new Error('source mutation was not rejected'); }
        catch (error) {
          if (!String(error).includes('changed since the implementation was loaded')) throw error;
          process.stdout.write('source guard passed');
        }
      `;
      const output = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
        encoding: 'utf8', env: { ...process.env, HUNGRY_RUNNER_COPY: runnerPath, HUNGRY_MODEL_COPY: modelPath },
      });
      expect(output).toBe('source guard passed');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('requires one explicit seed and one action without starting work on import', () => {
    expect(() => parseArgs(['--write'])).toThrow(/explicit positive --seed/);
    expect(() => parseArgs(['--write', '--check', '--seed', '1201'])).toThrow(/exactly one/);
    expect(parseArgs(['--check', '--seed', '1201'])).toEqual({ mode: '--check', seed: 1201 });
  });
});
