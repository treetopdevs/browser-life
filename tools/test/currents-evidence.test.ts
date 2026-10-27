import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { buildMarkdown, lateSummary, REPLAY_TICKS, validateEvidenceStructure } from '../currents/explore.ts';
import { CURRENT_CONDITIONS, MATTER_HEIGHT, MATTER_SIZE, MATTER_WIDTH, RULES } from '../../apps/lab/src/currents/model.ts';

const seeds = [1201, 1202, 1203];
const snapshots = [0, 1000, 3000, 4095, 4096, 6000];
const zeros = () => Array(MATTER_SIZE).fill(0);
function census(tick: number, mode: string, current: string) {
  const imported = mode === 'rain' ? Math.min(32768, 64 * Math.floor(tick / 8)) : 0;
  let circulated = 0;
  if (current === 'circulating') for (let p = 4; p <= tick; p += 4) circulated += mode === 'rain' ? Math.min(32768, 64 * Math.floor(p / 8)) : 0;
  return { current, tick, extinctionTick: 0, nutrient: imported, biomass: 0, detritus: 0, activeMatter: imported,
    reservoir: 32768 - imported, sediment: 0, initialTotal: 32768, initialNutrient: 0, initialBiomass: 0, initialDetritus: 0, initialReservoir: 32768,
    residual: 0, activeCells: 0, components: 0, largestComponentCells: 0,
    imported, buried: 0, growth: 0, routineDecay: 0, thresholdLoss: 0, mortality: 0, recycled: 0, relaxed: 0, spread: 0, colonizedTiles: 0, settled: 0, circulated };
}
function state(tick: number, seed: number, mode: string, current: string) {
  const c = census(tick, mode, current);
  const nutrient = zeros(); nutrient[0] = c.nutrient;
  const history = tick === 6000 ? Array.from({ length: 21 }, (_, i) => { const t = 5000 + i * 50; return { ...census(t, mode, current), intervalFromTick: t - 50,
    intervalToTick: t, meanAbsBChange: 0, maskFlipFraction: 0, relaxedInterval: 0, settledInterval: 0 }; }) : [];
  return { schemaVersion: 1, observationOnly: true, description: 'Observation only; not a resumable checkpoint', rules: RULES, runtime: 'Node 24.2.0', seed, mode, current, tick,
    extinctionTick: 0, fields: { nutrient, biomass: zeros(), detritus: zeros(), phases: zeros() },
    reservoir: c.reservoir, sediment: 0, initialNutrient: 0, initialBiomass: 0, initialDetritus: 0, initialReservoir: 32768, initialTotal: 32768,
    counters: { imported: c.imported, buried: 0, growth: 0, routineDecay: 0, thresholdLoss: 0, mortality: 0, recycled: 0, relaxed: 0, spread: 0, colonizedTiles: 0, settled: 0, circulated: c.circulated }, history };
}
function sha(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function syntheticReplayAssets(runs: any[]) {
  const files = new Map<string, Buffer>(), metadata = [];
  for (const seed of seeds) {
    const group = runs.filter((run) => run.seed === seed).sort((a, b) => CURRENT_CONDITIONS.findIndex((c) => c.id === a.conditionId) - CURRENT_CONDITIONS.findIndex((c) => c.id === b.conditionId));
    const raw = Buffer.alloc(MATTER_SIZE * 3 * REPLAY_TICKS.length * 4 * group.length);
    const frameBytes = MATTER_SIZE * 3 * 4;
    for (let ci = 0; ci < group.length; ci++) for (let fi = 0; fi < REPLAY_TICKS.length; fi++) {
      const census = group[ci].replayCensus[fi], frame = (ci * REPLAY_TICKS.length + fi) * frameBytes;
      raw.writeUInt32LE(census.nutrient, frame);
      raw.writeUInt32LE(census.biomass, frame + MATTER_SIZE * 4);
      raw.writeUInt32LE(census.detritus, frame + MATTER_SIZE * 8);
    }
    const compressed = gzipSync(raw, { level: 9 }), file = `currents-replay-${seed}.replay`;
    files.set(file, compressed);
    metadata.push({ seed, file, compressedBytes: compressed.length, uncompressedBytes: raw.length, sha256: sha(raw), compressedSha256: sha(compressed) });
  }
  return { files, metadata };
}
function validateFixture(value: any) { validateEvidenceStructure(value, syntheticReplayAssets(value.runs).files); }
function fixture() {
  const runs: any[] = [];
  for (const seed of seeds) for (const condition of CURRENT_CONDITIONS) {
    const { id, mode, current } = condition;
    const samples = Array.from({ length: 121 }, (_, i) => { const tick = i * 50; return { tick, census: census(tick, mode, current) }; });
    const rs = snapshots.map((tick) => ({ tick, state: state(tick, seed, mode, current) }));
    const replayCensus = REPLAY_TICKS.map((tick) => census(tick, mode, current));
    const start = census(5000, mode, current), end = census(6000, mode, current);
    const counterKeys = ['growth','mortality','recycled','relaxed','circulated'] as const;
    const deltas = Object.fromEntries(counterKeys.map((k) => [k, (end[k] as number) - (start[k] as number)]));
    const late5000To6000 = { fromTick: 5000, toTick: 6000, counterDeltas: deltas, endpointBiomassChange: 0, endpointActiveCellsChange: 0,
      sampledActivityAcrossWindow: { intervalCount: 20, durationTicks: 1000, meanAbsBChangePerTilePerTick: 0, maskFlipFractionPerTick: 0,
        endpointIntervalMeanAbsBChange: 0, endpointIntervalMaskFlipFraction: 0 }, nutrientAtStart: start.nutrient, nutrientAtEnd: end.nutrient,
      nutrientUnitMoves: deltas.relaxed, currentTranslationUnitMoves: deltas.circulated, sampledTicks: Array.from({ length: 21 }, (_, i) => 5000 + i * 50), extinctionTick: 0 };
    runs.push({ seed, conditionId: id, settings: { mode, current, maxTick: 6000, sampleEvery: 50, snapshotTicks: snapshots, comparisonEvery: 100 }, samples, snapshots: rs, replayCensus,
      summary: { extinctionTick: 0, survivalThrough6000: false, sampledPeakBiomass: 0, sampledPeakTick: 0, endpointBiomass: 0, endpointActiveCells: 0, firstPhysicalDivergence: null, firstBiomassDivergence: null,
        firstDivergenceRainVsClosed: mode === 'rain' ? 8 : null, late5000To6000 } });
  }
  const replayAssets = syntheticReplayAssets(runs);
  const replay = { schemaVersion: 1, width: MATTER_WIDTH, height: MATTER_HEIGHT, conditions: CURRENT_CONDITIONS, ticks: REPLAY_TICKS, seeds: replayAssets.metadata };
  return { schemaVersion: 1, sourceSha256: { 'apps/lab/src/currents/model.ts': 'c'.repeat(64), 'apps/lab/src/matter/model.ts': 'd'.repeat(64), 'tools/currents/explore.ts': 'e'.repeat(64) }, rules: RULES, runtime: { node: '24.2.0', platform: 'darwin', arch: 'arm64' }, conditions: CURRENT_CONDITIONS,
    seeds, maxTick: 6000, sampleEvery: 50, snapshotTicks: snapshots, comparisonEvery: 100, runs, replay };
}

describe('current pilot evidence guards', () => {
  it('pins the 109 exact replay ticks and accepts a structurally complete small fixture', () => {
    expect(REPLAY_TICKS).toHaveLength(109);
    expect(REPLAY_TICKS.slice(0, 4)).toEqual([0, 4, 8, 12]);
    expect(REPLAY_TICKS.slice(-3)).toEqual([5800, 5900, 6000]);
    expect(() => validateFixture(fixture())).not.toThrow();
  });

  it('keeps an exact off-cadence extinction interval in late-window activity totals', () => {
    const mode = 'closed', current = 'off';
    const history: any[] = Array.from({ length: 21 }, (_, i) => {
      const tick = 5000 + i * 50;
      return { ...census(tick, mode, current), intervalFromTick: tick - 50, intervalToTick: tick,
        meanAbsBChange: 0, maskFlipFraction: 0, relaxedInterval: 0, settledInterval: 0 };
    });
    history.splice(2, 0, { ...census(5051, mode, current), extinctionTick: 5051, intervalFromTick: 5050, intervalToTick: 5051,
      meanAbsBChange: 0.5, maskFlipFraction: 0.25, relaxedInterval: 0, settledInterval: 0 });
    history[3].intervalFromTick = 5051; history[3].meanAbsBChange = 0.75; history[3].maskFlipFraction = 0.5;
    const final = { ...census(6000, mode, current), extinctionTick: 5051 };
    const late = lateSummary(history, final as any);
    expect(late.sampledTicks).toContain(5051);
    expect(late.sampledActivityAcrossWindow).toMatchObject({ intervalCount: 21, durationTicks: 1000,
      meanAbsBChangePerTilePerTick: 0.00125, maskFlipFractionPerTick: 0.00075 });
  });

  it('rejects a truncated or reordered condition matrix before reading outcomes', () => {
    const bad: any = fixture(); bad.conditions = [...bad.conditions].reverse();
    expect(() => validateFixture(bad)).toThrow(/ordered condition matrix mismatch/);
    const fewer = fixture(); fewer.runs.pop();
    expect(() => validateFixture(fewer)).toThrow(/exactly 12 outcomes/);
  });

  it('rejects inconsistent stock ledgers and snapshot contents', () => {
    const bad = fixture(); bad.runs[0].samples[20].census.nutrient++;
    expect(() => validateFixture(bad)).toThrow(/matter ledger mismatch|pool identity mismatch/);
    const badSnapshot = fixture(); badSnapshot.runs[0].snapshots[2].state.fields.nutrient[0]++;
    expect(() => validateFixture(badSnapshot)).toThrow(/snapshot ledger mismatch|matter ledger mismatch|pool identity mismatch/);
  });

  it('rejects tampered replay sizes and summary claims', () => {
    const badReplay = fixture(); badReplay.replay.seeds[1].uncompressedBytes++;
    expect(() => validateFixture(badReplay)).toThrow(/decoded size mismatch/);
    const badSummary = fixture(); badSummary.runs[0].summary.endpointBiomass = 12;
    expect(() => validateFixture(badSummary)).toThrow(/summary differs from final census/);
  });

  it('renders retained outcomes and late counter deltas in the report', () => {
    const data = fixture();
    const report = buildMarkdown(data);
    expect(report).toContain('| Seed | Condition | Extinction |');
    expect(report).toContain('currents-replay');
    expect(report).toContain('unit-moves');
  });
});
