import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMarkdown, expectedSnapshotExtinctionTick, validateEvidenceStructure, validateMilestoneSnapshot } from '../development/explore.ts';

const acceptedEvidence = JSON.parse(readFileSync(new URL('../../docs/creative-prototypes/development-pilot.json', import.meta.url), 'utf8')) as Record<string, any>;

function copyEvidence(): Record<string, any> {
  return structuredClone(acceptedEvidence) as Record<string, any>;
}

describe('development pilot evidence structure', () => {
  it('accepts the complete retained artifact', () => {
    expect(() => validateEvidenceStructure(acceptedEvidence)).not.toThrow();
  });

  it('rejects duplicate rows in place of the ordered 3×2 matrix', () => {
    const tampered = copyEvidence();
    tampered.runs = Array.from({ length: 6 }, () => structuredClone(acceptedEvidence.runs[0]));
    expect(() => validateEvidenceStructure(tampered)).toThrow(/matrix order\/pair mismatch/);
  });

  it('rejects a missing census schedule', () => {
    const tampered = copyEvidence();
    tampered.runs[0].samples = [];
    expect(() => validateEvidenceStructure(tampered)).toThrow(/census schedule has missing or extra rows/);
  });

  it('rejects missing birth records even when the run row remains present', () => {
    const tampered = copyEvidence();
    tampered.runs[0].births = [];
    expect(() => validateEvidenceStructure(tampered)).toThrow(/birth records do not match lineage/);
  });

  it('rejects milestone labels without a full state snapshot', () => {
    const tampered = copyEvidence();
    tampered.runs[0].snapshots[1].state = undefined;
    expect(() => validateEvidenceStructure(tampered)).toThrow(/full state missing at milestone/);
  });

  it('rejects a milestone state hash that does not cover the retained state', () => {
    const tampered = copyEvidence();
    tampered.runs[0].snapshots[1].stateHash = '0'.repeat(64);
    expect(() => validateEvidenceStructure(tampered)).toThrow(/state hash mismatch/);
  });

  it('rejects final census values that disagree with the final full snapshot', () => {
    const tampered = copyEvidence();
    tampered.runs[0].finalCensus.population++;
    expect(() => validateEvidenceStructure(tampered)).toThrow(/final census does not match final snapshot/);
  });

  it('rejects sampled census contents that differ from the hash-covered history', () => {
    const tampered = copyEvidence();
    tampered.runs[0].samples[1].census.population++;
    expect(() => validateEvidenceStructure(tampered)).toThrow(/sample census differs from hash-covered history/);
  });

  it('rejects snapshot birth counters that disagree with retained lineage records', () => {
    for (const counter of ['births', 'deaths', 'effectiveMutations']) {
      const tampered = copyEvidence();
      const runIndex = counter === 'effectiveMutations' ? 1 : 0;
      tampered.runs[runIndex].snapshots[1].state.counters[counter]++;
      expect(() => validateEvidenceStructure(tampered)).toThrow(/birth, death or effective mutation counters disagree with lineage/);
    }
  });

  it('rejects live organism genomes that differ from their lineage record', () => {
    const tampered = copyEvidence();
    tampered.runs[0].snapshots[1].state.organisms[0].genome.turn = tampered.runs[0].snapshots[1].state.organisms[0].genome.turn === 1 ? 0 : 1;
    expect(() => validateEvidenceStructure(tampered)).toThrow(/differs from its lineage record/);
  });

  it('rejects invalid bounds in a live organism genome', () => {
    const tampered = copyEvidence();
    tampered.runs[0].snapshots[1].state.organisms[0].genome.turnEvery = 99;
    expect(() => validateEvidenceStructure(tampered)).toThrow(/genome outside bounded integer settings/);
  });

  it('rejects an assay summary that no longer matches its per-tick trajectory', () => {
    const tampered = copyEvidence();
    tampered.assay.results[0].firstBirthTick++;
    expect(() => validateEvidenceStructure(tampered)).toThrow(/summary disagrees with its trajectory/);
  });

  it('accepts and preserves a failed distinct-shape gate without running the batch', () => {
    const stopped = copyEvidence();
    stopped.assay.results[1].footprintAt144 = stopped.assay.results[0].footprintAt144;
    stopped.assay.distinctFootprints = 2;
    stopped.assay.passed = false;
    stopped.batchStatus = 'stopped-after-assay-failure';
    stopped.runs = [];
    expect(() => validateEvidenceStructure(stopped)).not.toThrow();
  });

  it('keeps pre-extinction milestone snapshots alive while freezing later snapshots at extinction', () => {
    const run = acceptedEvidence.runs[0];
    const extinctRun = { seed: run.seed, mutation: run.mutation, extinctionTick: 1000 };
    expect(expectedSnapshotExtinctionTick(0, 1000)).toBeNull();
    expect(expectedSnapshotExtinctionTick(1000, 1000)).toBe(1000);
    expect(expectedSnapshotExtinctionTick(2000, 1000)).toBe(1000);
    expect(() => validateMilestoneSnapshot(run.snapshots[0], extinctRun, 0, 'pre-extinction regression')).not.toThrow();
  });

  it('rejects mutation activity recorded in a mutation-off condition', () => {
    const tampered = copyEvidence();
    tampered.runs[0].snapshots[1].state.counters.attemptedMutations = 1;
    expect(() => validateEvidenceStructure(tampered)).toThrow(/mutation-off snapshot has mutation counters/);
  });

  it('rejects a mutation-off lineage whose genome is outside the supplied programs', () => {
    const tampered = copyEvidence();
    tampered.runs[0].snapshots[1].state.lineage[0].genome.maxCells = 16;
    expect(() => validateEvidenceStructure(tampered)).toThrow(/mutation-off snapshot has a mutation or non-founder program/);
  });

  it('recognizes marked missing parents while still rejecting pruning in this fixed pilot', () => {
    const tampered = copyEvidence();
    const state = tampered.runs[0].snapshots[1].state;
    const removedID = state.lineage.find((node: Record<string, unknown>) => node.parentID === null).id;
    state.lineage = state.lineage.filter((node: Record<string, unknown>) => node.id !== removedID);
    for (const node of state.lineage) if (node.parentID === removedID) node.parentRecordDropped = true;
    state.droppedLineage = 1;
    expect(() => validateEvidenceStructure(tampered)).toThrow(/dropped observation records/);
  });

  it('reports cap pressure, living variants, and death causes from each run lineage', () => {
    const markdown = buildMarkdown(acceptedEvidence);
    const lines = markdown.split('\n');
    const headerIndex = lines.findIndex((line) => line.startsWith('| Seed |'));
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    const headers = lines[headerIndex]!.split('|').slice(1, -1).map((cell) => cell.trim());
    expect(headers).toContain('Cap-blocked births');
    expect(headers).toContain('Living variants');
    expect(headers).toContain('Age deaths');
    expect(headers).toContain('Starvation deaths');
    const tableRows = lines.slice(headerIndex + 2).filter((line) => line.startsWith('|')).map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
    for (const run of acceptedEvidence.runs) {
      const cells = tableRows.find((row) => row[headers.indexOf('Seed')] === String(run.seed) && row[headers.indexOf('Mutation')] === (run.mutation ? 'on' : 'off'));
      expect(cells).toBeDefined();
      const ageDeaths = run.lineage.filter((node: Record<string, unknown>) => node.deathCause === 'age').length;
      const starvationDeaths = run.lineage.filter((node: Record<string, unknown>) => node.deathCause === 'starvation').length;
      const expected: Record<string, string> = {
        Seed: String(run.seed),
        Mutation: run.mutation ? 'on' : 'off',
        Outcome: run.extinctionTick === null ? 'alive at 3000' : `extinct at ${run.extinctionTick}`,
        Births: String(run.finalCensus.births),
        'Effective mutations': String(run.finalCensus.effectiveMutations),
        Population: String(run.finalCensus.population),
        Cells: String(run.finalCensus.cells),
        'Max generation': String(run.finalCensus.maxGeneration),
        'Cap-blocked births': String(run.finalCensus.blockedCapBirths),
        'Living variants': String(run.finalCensus.genomeVariantCount),
        'Age deaths': String(ageDeaths),
        'Starvation deaths': String(starvationDeaths),
        'Ledger residual': String(run.finalCensus.ledgerResidual),
      };
      for (const [column, value] of Object.entries(expected)) expect(cells?.[headers.indexOf(column)]).toBe(value);
    }
  });
});
