import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMarkdown, runPrebatchFixtures, validateEvidenceStructure } from '../matter/explore.ts';
import { RULES } from '../../apps/lab/src/matter/model.ts';

describe('matter pilot pre-batch evidence', () => {
  it('retains both exact fixtures and every tick-zero-through-final census', () => {
    const fixtures = runPrebatchFixtures();
    expect(fixtures.map((fixture) => fixture.name)).toEqual(['growth-extension', 'empty-physical-continuation']);
    expect(fixtures.every((fixture) => fixture.passed)).toBe(true);
    expect(fixtures.map((fixture) => fixture.samples.length)).toEqual([25, 101]);
    expect(fixtures.map((fixture) => fixture.snapshots.map((row: { scheduledTick: number }) => row.scheduledTick))).toEqual([[0, 24], [0, 100]]);
    expect(fixtures[0]?.actual).toMatchObject({ firstExtensionTick: 12, growth: 36, mortality: 3, spread: 8, colonizedTiles: 2, biomass: 57, activeCells: 3, residual: 0 });
    expect(fixtures[1]?.actual).toMatchObject({ extinctionTick: 0, finalTick: 100, firstImportTick: 8, firstBurialTick: 4, imported: 4, reservoir: 0, recycled: 2, buried: 14, sediment: 14, nutrient: 6, biomass: 0, detritus: 0, residual: 0 });
    expect(fixtures[1]?.finalCensus.tick).toBe(100);
    expect(fixtures[1]?.finalHistory.at(-1)?.tick).toBe(100);
  });

  it('rejects a partial matrix before trying to inspect run payloads', () => {
    expect(() => validateEvidenceStructure(baseEvidence(runPrebatchFixtures(), [{ seed: 1201, mode: 'closed' }]))).toThrow(/run matrix must contain exactly 12 outcomes/);
  });

  it('ties every fixture census row and its gate summary to the retained snapshots', () => {
    const fixtures = runPrebatchFixtures();
    const tampered = structuredClone(fixtures) as Record<string, any>[];
    tampered[1]!.samples[100]!.census.nutrient++;
    expect(() => validateEvidenceStructure(baseEvidence(tampered, []))).toThrow(/matter ledger mismatch/);

    const badSummary = structuredClone(fixtures) as Record<string, any>[];
    badSummary[1]!.actual.nutrient++;
    expect(() => validateEvidenceStructure(baseEvidence(badSummary, []))).toThrow(/measured gate summary does not match retained observations/);
  });

  it('requires each fixture census to carry its exact scheduled tick', () => {
    const fixtures = structuredClone(runPrebatchFixtures()) as Record<string, any>[];
    fixtures[0]!.samples[1]!.census.tick = 0;
    expect(() => validateEvidenceStructure(baseEvidence(fixtures, []))).toThrow(/census tick label disagrees with scheduled tick 1/);
  });

  it('reconciles a validly balanced tick-50 stock census to its retained history row', () => {
    const fixtures = structuredClone(runPrebatchFixtures()) as Record<string, any>[];
    const empty = fixtures[1]!;
    for (let tick = 50; tick <= 55; tick++) {
      const census = empty.samples[tick]!.census;
      census.detritus = 0;
      census.buried = 14;
      census.sediment = 14;
      census.activeMatter = census.nutrient + census.biomass + census.detritus;
      census.residual = census.activeMatter + census.reservoir + census.sediment - census.initialTotal;
    }
    expect(() => validateEvidenceStructure(baseEvidence(fixtures, []))).toThrow(/census sample differs from retained history at tick 50/);
  });

  it('rejects a fabricated cumulative counter that spikes and then drops', () => {
    const fixtures = structuredClone(runPrebatchFixtures()) as Record<string, any>[];
    fixtures[0]!.samples[10]!.census.spread = 100;
    expect(() => validateEvidenceStructure(baseEvidence(fixtures, []))).toThrow(/sample stocks\/counters are not monotone at tick 11/);
  });

  it('does not load an accepted artifact during module setup, but validates it when present', () => {
    const path = new URL('../../docs/creative-prototypes/matter-pilot.json', import.meta.url);
    if (!existsSync(path)) return;
    const evidence = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(() => validateEvidenceStructure(evidence)).not.toThrow();
    expect(buildMarkdown(evidence as any)).toBe(readFileSync(new URL('../../docs/creative-prototypes/matter-pilot.md', import.meta.url), 'utf8'));
  });
});

function baseEvidence(prebatchFixtures: Record<string, any>[], runs: Record<string, unknown>[]) {
  return {
    schemaVersion: 1,
    pilot: 'matter-flow-aquarium-v1',
    runtime: { node: process.versions.node, platform: process.platform, arch: process.arch },
    rules: RULES,
    batch: { seeds: [1201, 1202, 1203], modes: ['closed', 'rain', 'burial', 'rain-burial'], maxTick: 3000, sampleEvery: 50, snapshots: [0, 1000, 2000, 3000], comparisonEvery: 50 },
    interpretation: { standardRainImportedAt3000: 24000, standardRainReservoirAt3000: 8768, standardRainExhaustionTick: 4096, exhaustedByFixedHorizon: false },
    prebatchFixtures,
    batchStatus: 'complete',
    runs,
  };
}
