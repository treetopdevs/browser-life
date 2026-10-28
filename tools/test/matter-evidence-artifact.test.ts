import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMarkdown, validateEvidenceStructure } from '../matter/explore.ts';

const evidenceUrl = new URL('../../docs/creative-prototypes/matter-pilot.json', import.meta.url);
const markdownUrl = new URL('../../docs/creative-prototypes/matter-pilot.md', import.meta.url);
const hasAcceptedArtifact = existsSync(evidenceUrl);
function accepted(): Record<string, any> {
  if (!hasAcceptedArtifact) throw new Error('accepted matter pilot JSON is not available');
  return JSON.parse(readFileSync(evidenceUrl, 'utf8')) as Record<string, any>;
}
function copyAccepted(): Record<string, any> { return structuredClone(accepted()); }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function editFinalHistory(run: Record<string, any>, tick: number, edit: (row: Record<string, any>) => void): void {
  const row = run.finalHistory.find((item: Record<string, any>) => item.tick === tick);
  const snapshot = run.snapshots.at(-1);
  const snapshotRow = snapshot.state.history.find((item: Record<string, any>) => item.tick === tick);
  edit(row); edit(snapshotRow);
  snapshot.stateHash = hash(snapshot.state);
  run.finalStateHash = snapshot.stateHash;
  const finalSample = run.samples.find((item: Record<string, any>) => item.scheduledTick === 3000);
  finalSample.stateHash = snapshot.stateHash;
}

describe.skipIf(!hasAcceptedArtifact)('retained matter pilot evidence', () => {
  it('renders the accepted result as the exact saved Markdown report', () => {
    const markdown = buildMarkdown(accepted());
    expect(markdown).toBe(readFileSync(markdownUrl, 'utf8'));
    const table = markdown.split('## Fixed batch\n\n')[1]!.split('\n\nFirst physical divergence')[0]!;
    expect(table.match(/\bn\/a\b/g)?.length).toBe(9);
    expect(markdown).toMatch(/\n\nFirst physical divergence compares/);
  });

  it('rejects a duplicated or reordered outcome in the twelve-run matrix', () => {
    const changed = copyAccepted();
    changed.runs[1] = structuredClone(changed.runs[0]);
    expect(() => validateEvidenceStructure(changed)).toThrow(/matrix order\/mode mismatch/);
  });

  it('rejects a missing census sample', () => {
    const changed = copyAccepted();
    changed.runs[0].samples.splice(1, 1);
    expect(() => validateEvidenceStructure(changed)).toThrow(/census schedule has missing\/extra rows/);
  });

  it('rejects a changed snapshot pool even if its state hash is recomputed', () => {
    const changed = copyAccepted();
    const snapshot = changed.runs[0].snapshots[1];
    snapshot.state.fields.nutrient[0]++;
    snapshot.stateHash = hash(snapshot.state);
    expect(() => validateEvidenceStructure(changed)).toThrow(/matter ledger mismatch|pool identity mismatch/);
  });

  it('checks non-milestone census rows against the snapshot history', () => {
    const changed = copyAccepted();
    const row = changed.runs[0].samples.find((sample: Record<string, any>) => sample.scheduledTick === 50);
    row.census.activeCells++;
    expect(() => validateEvidenceStructure(changed)).toThrow(/snapshot history differs from retained census sample at 50|sample census differs from retained history at 50/);
  });

  it('rejects altered late activity and counter summaries', () => {
    const changed = copyAccepted();
    changed.runs[0].lateActivity.meanAbsBChangePerTilePerTick = -99;
    changed.runs[0].lateActivity.counterDeltas.growth = 999999999;
    expect(() => validateEvidenceStructure(changed)).toThrow(/late activity summary differs from its retained interval history/);
  });

  it('rejects invalid activity values or interval endpoints after their enclosing snapshot is rehashed', () => {
    const changed = copyAccepted();
    const run = changed.runs[0];
    editFinalHistory(run, 2050, (row) => { row.meanAbsBChange = -99; });
    expect(() => validateEvidenceStructure(changed)).toThrow(/invalid sampled activity at tick 2050/);

    const badInterval = copyAccepted();
    editFinalHistory(badInterval.runs[0], 2050, (row) => { row.intervalFromTick = 7; });
    expect(() => validateEvidenceStructure(badInterval)).toThrow(/interval endpoints disagree at tick 2050/);
  });

  it('derives exact divergence markers from paired physical timelines', () => {
    const changed = copyAccepted();
    const rain = changed.runs.find((run: Record<string, any>) => run.seed === 1201 && run.mode === 'rain');
    rain.firstPhysicalDivergenceFromClosed = null;
    expect(() => validateEvidenceStructure(changed)).toThrow(/first physical divergence marker disagrees with paired timelines/);

    const wrongTick = copyAccepted();
    const burial = wrongTick.runs.find((run: Record<string, any>) => run.seed === 1201 && run.mode === 'burial');
    burial.firstBurialDivergenceFromControl = burial.firstBurialDivergenceFromControl === null ? 1 : burial.firstBurialDivergenceFromControl + 1;
    expect(() => validateEvidenceStructure(wrongTick)).toThrow(/first burial\/control divergence marker disagrees with paired timelines/);
  });

  it('ties fixture census and pass summaries to the retained fixture observations', () => {
    const changed = copyAccepted();
    changed.prebatchFixtures[1].samples[100].census.nutrient = 999999;
    expect(() => validateEvidenceStructure(changed)).toThrow(/matter ledger mismatch/);

    const badSummary = copyAccepted();
    badSummary.prebatchFixtures[1].actual.nutrient = 999999;
    expect(() => validateEvidenceStructure(badSummary)).toThrow(/measured gate summary does not match retained observations/);
  });

  it('enforces fixed phases and the first-extinction relationship across observations', () => {
    const changed = copyAccepted();
    const run = changed.runs[0];
    const snapshot = run.snapshots[1];
    snapshot.state.fields.phases[0] = (snapshot.state.fields.phases[0] + 1) % 4;
    snapshot.stateHash = hash(snapshot.state);
    run.samples.find((sample: Record<string, any>) => sample.scheduledTick === 1000).stateHash = snapshot.stateHash;
    expect(() => validateEvidenceStructure(changed)).toThrow(/phases changed between retained snapshots/);

    const badExtinction = copyAccepted();
    badExtinction.runs[0].samples[0].census.extinctionTick = 0;
    expect(() => validateEvidenceStructure(badExtinction)).toThrow(/extinction marker does not match the first zero-biomass tick/);
  });

  it('checks sample-level mode truth against the prescribed rain trajectory', () => {
    const changed = copyAccepted();
    const rain = changed.runs.find((run: Record<string, any>) => run.seed === 1201 && run.mode === 'rain');
    rain.samples.find((sample: Record<string, any>) => sample.scheduledTick === 50).census.imported = 0;
    expect(() => validateEvidenceStructure(changed)).toThrow(/rain exchange does not match the supplied schedule/);
  });

  it('reconstructs tick-zero state from the seeded constructor', () => {
    const changed = copyAccepted();
    const run = changed.runs[0];
    const initial = run.snapshots[0];
    initial.state.fields.phases[0] = (initial.state.fields.phases[0] + 1) % 4;
    initial.stateHash = hash(initial.state);
    run.initialStateHash = hash(Object.fromEntries(Object.entries(initial.state).filter(([key]) => key !== 'mode')));
    run.samples[0].stateHash = initial.stateHash;
    expect(() => validateEvidenceStructure(changed)).toThrow(/tick-zero snapshot differs from the seeded constructor/);
  });
});
