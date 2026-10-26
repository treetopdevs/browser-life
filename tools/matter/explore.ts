#!/usr/bin/env node
/** Fixed, replayable evidence for the matter aquarium. Run with Node 24.2.0. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createMatterFixture,
  MATTER_HEIGHT,
  MATTER_INITIAL_RESERVOIR,
  MATTER_MAX_TOTAL,
  MATTER_SIZE,
  MATTER_WIDTH,
  MatterWorld,
  RULES,
  type MatterCensus,
  type MatterHistorySample,
  type MatterMode,
  type MatterSnapshot,
} from '../../apps/lab/src/matter/model.ts';

const JSON_URL = new URL('../../docs/creative-prototypes/matter-pilot.json', import.meta.url);
const MD_URL = new URL('../../docs/creative-prototypes/matter-pilot.md', import.meta.url);
const MODEL_URL = new URL('../../apps/lab/src/matter/model.ts', import.meta.url);
const RUNNER_URL = new URL('./explore.ts', import.meta.url);
const SOURCE_PATHS = ['apps/lab/src/matter/model.ts', 'tools/matter/explore.ts'] as const;
const EXPECTED_NODE = '24.2.0';
const SEEDS = [1201, 1202, 1203] as const;
const MAX_TICK = 3000;
const SAMPLE_EVERY = 50;
const SNAPSHOT_TICKS = [0, 1000, 2000, 3000] as const;
const ALL_MODES = ['closed', 'rain', 'burial', 'rain-burial'] as const satisfies readonly MatterMode[];
const COUNTERS = ['imported', 'buried', 'growth', 'routineDecay', 'thresholdLoss', 'mortality', 'recycled', 'relaxed', 'spread', 'colonizedTiles', 'settled'] as const;

type AnyRecord = Record<string, any>;
type StoredSample = { scheduledTick: number; actualTick: number; stateHash: string; census: MatterCensus };
type StoredSnapshot = { scheduledTick: number; actualTick: number; stateHash: string; state: AnyRecord };
type FixtureResult = AnyRecord;
type RunResult = AnyRecord;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function record(value: unknown, label: string): asserts value is AnyRecord {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
}
function sameJSON(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function canonicalHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function hashString(value: unknown, label: string): asserts value is string {
  invariant(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), `${label}: expected SHA-256 hex`);
}
function safeInteger(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  invariant(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, `${label}: expected bounded integer`);
}
function sourceHashes(): Record<string, string> {
  const urls = [MODEL_URL, RUNNER_URL];
  return Object.fromEntries(SOURCE_PATHS.map((path, i) => [path, createHash('sha256').update(readFileSync(urls[i]!)).digest('hex')]));
}
function sum(values: ArrayLike<number>): number { let total = 0; for (let i = 0; i < values.length; i++) total += values[i]!; return total; }

/** JSON-safe snapshots preserve arrays explicitly instead of serializing typed arrays as keyed objects. */
function plainSnapshot(snapshot: MatterSnapshot): AnyRecord {
  return {
    ...snapshot,
    fields: {
      nutrient: Array.from(snapshot.fields.nutrient), biomass: Array.from(snapshot.fields.biomass),
      detritus: Array.from(snapshot.fields.detritus), phases: Array.from(snapshot.fields.phases),
    },
    counters: { ...snapshot.counters },
    history: snapshot.history.map((row) => ({ ...row })),
  };
}
function snapshotHash(world: MatterWorld): string { return canonicalHash(plainSnapshot(world.snapshot())); }
function physicalHash(world: MatterWorld): string {
  const fields = world.fields;
  return canonicalHash({ nutrient: Array.from(fields.nutrient), biomass: Array.from(fields.biomass), detritus: Array.from(fields.detritus), reservoir: world.reservoir, sediment: world.sediment });
}
function physicalHashFromState(state: AnyRecord): string {
  return canonicalHash({ nutrient: state.fields.nutrient, biomass: state.fields.biomass, detritus: state.fields.detritus, reservoir: state.reservoir, sediment: state.sediment });
}
function stateSignature(world: MatterWorld): string { return canonicalHash(plainSnapshot(world.snapshot())); }

function assertWorld(world: MatterWorld, label: string, previousExtinct: boolean, previousCensus?: MatterCensus): boolean {
  safeInteger(world.tick, `${label}: tick`, 0, MAX_TICK);
  const fields = world.fields;
  invariant(fields.nutrient.length === MATTER_SIZE && fields.biomass.length === MATTER_SIZE && fields.detritus.length === MATTER_SIZE && fields.phases.length === MATTER_SIZE,
    `${label}: field length mismatch at ${world.tick}`);
  for (let i = 0; i < MATTER_SIZE; i++) {
    invariant(fields.nutrient[i]! <= MATTER_MAX_TOTAL && fields.detritus[i]! <= MATTER_MAX_TOTAL, `${label}: N/D bound at tile ${i}, tick ${world.tick}`);
    invariant(fields.biomass[i]! <= 64, `${label}: biomass bound at tile ${i}, tick ${world.tick}`);
    invariant(fields.phases[i]! <= 3, `${label}: phase bound at tile ${i}, tick ${world.tick}`);
    if (world.tick > 0) invariant(fields.biomass[i] === 0 || fields.biomass[i]! >= 4, `${label}: sub-threshold biomass at tile ${i}, tick ${world.tick}`);
  }
  const census = world.census();
  const n = sum(fields.nutrient), b = sum(fields.biomass), d = sum(fields.detritus);
  invariant(census.tick === world.tick && census.nutrient === n && census.biomass === b && census.detritus === d, `${label}: census stocks mismatch at ${world.tick}`);
  invariant(census.activeMatter === n + b + d && census.residual === 0, `${label}: exact matter residual failed at ${world.tick}`);
  invariant(census.initialTotal === census.initialNutrient + census.initialBiomass + census.initialDetritus + census.initialReservoir,
    `${label}: initial stock total mismatch at ${world.tick}`);
  invariant(census.reservoir === census.initialReservoir - census.imported && census.sediment === census.buried,
    `${label}: source/sediment accounting mismatch at ${world.tick}`);
  invariant(n === census.initialNutrient + census.imported - census.growth + census.recycled,
    `${label}: nutrient identity failed at ${world.tick}`);
  invariant(b === census.initialBiomass + census.growth - census.mortality,
    `${label}: biomass identity failed at ${world.tick}`);
  invariant(d === census.initialDetritus + census.mortality - census.recycled - census.buried,
    `${label}: detritus identity failed at ${world.tick}`);
  invariant(census.mortality === census.routineDecay + census.thresholdLoss, `${label}: mortality decomposition failed at ${world.tick}`);
  for (const key of COUNTERS) safeInteger(census[key], `${label}: ${key} counter`);
  if (previousCensus) {
    invariant(census.reservoir <= previousCensus.reservoir && census.sediment >= previousCensus.sediment, `${label}: source or sediment monotonicity failed at ${world.tick}`);
    for (const key of COUNTERS) invariant(census[key] >= previousCensus[key], `${label}: cumulative ${key} counter decreased at ${world.tick}`);
  }
  invariant(census.initialTotal <= MATTER_MAX_TOTAL && census.reservoir >= 0 && census.sediment >= 0, `${label}: stock bound failed at ${world.tick}`);
  invariant((world.mode === 'rain' || world.mode === 'rain-burial') || census.imported === 0, `${label}: rain-disabled world imported matter`);
  invariant((world.mode === 'burial' || world.mode === 'rain-burial') || census.buried === 0, `${label}: burial-disabled world buried matter`);
  const scheduledImport = world.mode === 'rain' || world.mode === 'rain-burial' ? Math.min(census.initialReservoir, 64 * Math.floor(world.tick / 8)) : 0;
  invariant(census.imported === scheduledImport, `${label}: supplied rain schedule mismatch at ${world.tick}`);
  if (world.extinctionTick !== null) {
    invariant(census.extinctionTick === world.extinctionTick && b === 0, `${label}: extinction marker disagrees with biomass at ${world.tick}`);
    invariant(!previousExtinct || world.tick > 0, `${label}: extinct clock did not advance`);
  } else invariant(b > 0, `${label}: zero biomass has no extinction tick`);
  if (previousExtinct) invariant(b === 0, `${label}: biomass resurrected at ${world.tick}`);
  return world.extinctionTick !== null;
}

function fixtureInput(kind: 'growth-extension' | 'empty-physical-continuation') {
  const nutrient = new Uint32Array(MATTER_SIZE);
  const biomass = new Uint32Array(MATTER_SIZE);
  const detritus = new Uint32Array(MATTER_SIZE);
  const phases = new Uint8Array(MATTER_SIZE);
  if (kind === 'growth-extension') {
    nutrient.fill(16); biomass[12 * MATTER_WIDTH + 8] = 24;
  } else detritus[47 * MATTER_WIDTH] = 16;
  return { seed: 0, mode: kind === 'growth-extension' ? 'closed' as const : 'rain-burial' as const,
    nutrient, biomass, detritus, phases, reservoir: kind === 'growth-extension' ? 0 : 4 };
}
function fixtureExpected(kind: 'growth-extension' | 'empty-physical-continuation'): AnyRecord {
  return kind === 'growth-extension'
    ? { finalTick: 24, firstExtensionTick: 12, growth: 36, routineDecay: 3, thresholdLoss: 0, mortality: 3, spread: 8, colonizedTiles: 2, biomass: 57, activeCells: 3,
      activeTileIndices: [12 * MATTER_WIDTH + 7, 12 * MATTER_WIDTH + 8, 13 * MATTER_WIDTH + 8], imported: 0, buried: 0, residual: 0 }
    : { finalTick: 100, extinctionTick: 0, imported: 4, firstImportTick: 8, reservoir: 0, recycled: 2, buried: 14, firstBurialTick: 4, sediment: 14,
      nutrient: 6, biomass: 0, detritus: 0, residual: 0 };
}
function runFixture(kind: 'growth-extension' | 'empty-physical-continuation'): FixtureResult {
  const world = createMatterFixture(fixtureInput(kind));
  const expected = fixtureExpected(kind);
  const snapshots: StoredSnapshot[] = [{ scheduledTick: 0, actualTick: 0, stateHash: snapshotHash(world), state: plainSnapshot(world.snapshot()) }];
  const samples: AnyRecord[] = [{ scheduledTick: 0, census: world.census() }];
  let firstExtensionTick: number | null = null;
  let firstImportTick: number | null = null;
  let firstBurialTick: number | null = null;
  let wasExtinct = world.extinctionTick !== null;
  let previousCensus = world.census();
  assertWorld(world, `fixture-${kind}`, false);
  for (let tick = 1; tick <= expected.finalTick; tick++) {
    world.step(1);
    wasExtinct = assertWorld(world, `fixture-${kind}`, wasExtinct, previousCensus);
    const c = world.census();
    previousCensus = c;
    if (kind === 'growth-extension' && firstExtensionTick === null && c.spread > 0) firstExtensionTick = tick;
    if (kind === 'empty-physical-continuation' && firstImportTick === null && c.imported > 0) firstImportTick = tick;
    if (kind === 'empty-physical-continuation' && firstBurialTick === null && c.buried > 0) firstBurialTick = tick;
    samples.push({ scheduledTick: tick, census: c });
    if (tick === expected.finalTick) snapshots.push({ scheduledTick: tick, actualTick: tick, stateHash: snapshotHash(world), state: plainSnapshot(world.snapshot()) });
  }
  const census = world.census(), fields = world.fields;
  const actual: AnyRecord = kind === 'growth-extension'
    ? { finalTick: world.tick, firstExtensionTick, growth: census.growth, routineDecay: census.routineDecay, thresholdLoss: census.thresholdLoss, mortality: census.mortality,
      spread: census.spread, colonizedTiles: census.colonizedTiles, biomass: census.biomass, activeCells: census.activeCells,
      activeTileIndices: Array.from(fields.biomass, (value, i) => value >= 4 ? i : -1).filter((i) => i >= 0), imported: census.imported, buried: census.buried, residual: census.residual }
    : { finalTick: world.tick, extinctionTick: world.extinctionTick, imported: census.imported, firstImportTick, reservoir: census.reservoir,
      recycled: census.recycled, buried: census.buried, firstBurialTick, sediment: census.sediment, nutrient: census.nutrient, biomass: census.biomass, detritus: census.detritus, residual: census.residual };
  const passed = sameJSON(actual, expected);
  return { name: kind, seed: 0, mode: world.mode, expected, actual, passed, samples, snapshots, finalCensus: census, finalHistory: world.history, droppedSamples: world.droppedSamples };
}

export function runPrebatchFixtures(): FixtureResult[] {
  return [runFixture('growth-extension'), runFixture('empty-physical-continuation')];
}

function sampleRow(world: MatterWorld, scheduledTick: number): StoredSample {
  return { scheduledTick, actualTick: world.tick, stateHash: snapshotHash(world), census: world.census() };
}
function snapshotRow(world: MatterWorld, scheduledTick: number): StoredSnapshot {
  const state = plainSnapshot(world.snapshot());
  return { scheduledTick, actualTick: world.tick, stateHash: canonicalHash(state), state };
}
function withoutMode(snapshot: AnyRecord): AnyRecord { const copy = structuredClone(snapshot); delete copy.mode; return copy; }
function withoutRuntime(snapshot: AnyRecord): AnyRecord { const copy = structuredClone(snapshot); delete copy.runtime; return copy; }
function firstDifferentHash(left: readonly string[], right: readonly string[]): number | null {
  invariant(left.length === MAX_TICK + 1 && right.length === MAX_TICK + 1, 'physical state timelines must cover tick zero through 3000');
  for (let tick = 1; tick <= MAX_TICK; tick++) if (left[tick] !== right[tick]) return tick;
  return null;
}

function runSeed(seed: number): RunResult[] {
  const worlds = ALL_MODES.map((mode) => new MatterWorld(seed, mode));
  const repeats = ALL_MODES.map((mode) => new MatterWorld(seed, mode));
  const runs: RunResult[] = ALL_MODES.map((mode, i) => {
    const world = worlds[i]!;
    invariant(canonicalHash(withoutMode(plainSnapshot(world.snapshot()))) === canonicalHash(withoutMode(plainSnapshot(repeats[i]!.snapshot()))), `initial repeat mismatch ${seed}/${mode}`);
    const samples = [sampleRow(world, 0)];
    const snapshots = [snapshotRow(world, 0)];
    return { seed, mode, initialStateHash: canonicalHash(withoutMode(plainSnapshot(world.snapshot()))), samples, snapshots,
      physicalHashes: [physicalHash(world)],
      firstPhysicalDivergenceFromClosed: null as number | null, firstBurialDivergenceFromControl: null as number | null };
  });
  let wasExtinct = worlds.map((world) => world.extinctionTick !== null);
  let previousCensus = worlds.map((world) => world.census());
  for (let tick = 1; tick <= MAX_TICK; tick++) {
    for (let i = 0; i < ALL_MODES.length; i++) {
      worlds[i]!.step(1); repeats[i]!.step(1);
      wasExtinct[i] = assertWorld(worlds[i]!, `run-${seed}-${ALL_MODES[i]}`, wasExtinct[i]!, previousCensus[i]!);
      assertWorld(repeats[i]!, `repeat-${seed}-${ALL_MODES[i]}`, wasExtinct[i]!, previousCensus[i]!);
      previousCensus[i] = worlds[i]!.census();
      runs[i]!.physicalHashes.push(physicalHash(worlds[i]!));
    }
    for (let i = 0; i < ALL_MODES.length; i++) if (tick % SAMPLE_EVERY === 0 || worlds[i]!.extinctionTick === tick) runs[i]!.samples.push(sampleRow(worlds[i]!, tick));
    if ((SNAPSHOT_TICKS as readonly number[]).includes(tick)) {
      for (let i = 0; i < ALL_MODES.length; i++) runs[i]!.snapshots.push(snapshotRow(worlds[i]!, tick));
    }
    if (tick % SAMPLE_EVERY === 0 || tick === MAX_TICK) {
      for (let i = 0; i < ALL_MODES.length; i++) invariant(stateSignature(worlds[i]!) === stateSignature(repeats[i]!), `repeat state mismatch ${seed}/${ALL_MODES[i]} at tick ${tick}`);
    }
    // Clock always advances through the full horizon, even after biomass reaches zero.
    invariant(worlds.every((world) => world.tick === tick), `comparison clock stopped at tick ${tick}`);
  }
  for (let i = 0; i < runs.length; i++) {
    const world = worlds[i]!;
    const finalSnapshot = snapshotRow(world, MAX_TICK);
    invariant(sameJSON(runs[i]!.snapshots.at(-1), finalSnapshot), `final snapshot differs from retained tick 3000 snapshot for ${seed}/${world.mode}`);
    runs[i] = { ...runs[i], finalCensus: world.census(), finalStateHash: finalSnapshot.stateHash, finalHistory: world.history,
      droppedSamples: world.droppedSamples, extinctionTick: world.extinctionTick, finalTick: world.tick, repeatVerified: true };
  }
  const closed = runs[0]!;
  for (const run of runs) invariant(run.initialStateHash === closed.initialStateHash, `modes do not share initial physical state for seed ${seed}`);
  for (let i = 1; i < runs.length; i++) runs[i]!.firstPhysicalDivergenceFromClosed = firstDifferentHash(runs[i]!.physicalHashes, runs[0]!.physicalHashes);
  runs[2]!.firstBurialDivergenceFromControl = firstDifferentHash(runs[2]!.physicalHashes, runs[0]!.physicalHashes);
  runs[3]!.firstBurialDivergenceFromControl = firstDifferentHash(runs[3]!.physicalHashes, runs[1]!.physicalHashes);
  for (const mode of ['rain', 'rain-burial'] as const) {
    const rain = runs.find((run) => run.mode === mode)!.finalCensus as MatterCensus;
    invariant(rain.imported === 24000 && rain.reservoir === 8768, `seed ${seed}/${mode} rain schedule differs from the fixed trajectory`);
    invariant(rain.reservoir > 0, `seed ${seed}/${mode}: standard rain unexpectedly exhausted by tick 3000`);
  }
  return runs;
}

function lateActivity(history: readonly MatterHistorySample[]): AnyRecord {
  const rows = history.filter((row) => row.tick >= 2000 && row.tick <= 3000);
  const intervals = rows.slice(1).map((to, i) => ({ from: rows[i]!, to }));
  invariant(rows[0]?.tick === 2000 && rows.at(-1)?.tick === 3000, 'late activity requires retained endpoint samples 2000 and 3000');
  invariant(intervals.every(({ from, to }) => from.tick < to.tick), 'late activity history is not strictly ordered');
  const duration = intervals.reduce((s, pair) => s + pair.to.tick - pair.from.tick, 0);
  invariant(duration === 1000, `late activity window spans ${duration}, expected 1000 ticks`);
  const start = intervals[0]!.from, endpoint = intervals.at(-1)!.to;
  const deltas = Object.fromEntries(['growth', 'mortality', 'recycled', 'relaxed', 'settled'].map((key) => [key, endpoint[key as keyof MatterHistorySample] as number - (start[key as keyof MatterHistorySample] as number)]));
  return {
    fromTick: 2000, toTick: 3000, intervalCount: intervals.length, durationTicks: duration,
    meanAbsBChangePerTilePerTick: intervals.reduce((s, { to }) => s + (to.meanAbsBChange ?? 0), 0) / duration,
    maskFlipFractionPerTick: intervals.reduce((s, { to }) => s + (to.maskFlipFraction ?? 0), 0) / duration,
    counterDeltas: deltas,
    relaxedUnitMoves: endpoint.relaxed - start.relaxed,
    settledUnitMoves: endpoint.settled - start.settled,
    sampledBiomassActivityIsEndpointChange: true,
  };
}

function completeBatch(fixtures: readonly FixtureResult[]): RunResult[] {
  invariant(fixtures.length === 2 && fixtures.every((fixture) => fixture.passed), 'pre-batch fixture failed; batch stopped without partial matrix');
  const runs: RunResult[] = [];
  for (const seed of SEEDS) runs.push(...runSeed(seed));
  for (const run of runs) run.lateActivity = lateActivity(run.finalHistory as MatterHistorySample[]);
  return runs;
}

function runtimeInfo(): AnyRecord { return { node: process.versions.node, platform: process.platform, arch: process.arch }; }
function batchSettings(): AnyRecord { return { seeds: [...SEEDS], modes: [...ALL_MODES], maxTick: MAX_TICK, sampleEvery: SAMPLE_EVERY, snapshots: [...SNAPSHOT_TICKS], comparisonEvery: SAMPLE_EVERY }; }

function buildArtifact(): AnyRecord {
  invariant(process.versions.node === EXPECTED_NODE, `Evidence requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  const captured = sourceHashes();
  const fixtures = runPrebatchFixtures();
  invariant(sameJSON(sourceHashes(), captured), 'Evidence sources changed during pre-batch fixtures; discard and rerun');
  let runs: RunResult[] = [];
  let batchStatus = 'stopped-after-fixture-failure';
  if (fixtures.every((fixture) => fixture.passed)) { runs = completeBatch(fixtures); batchStatus = 'complete'; }
  invariant(sameJSON(sourceHashes(), captured), 'Evidence sources changed during fixed batch; discard and rerun');
  const data = { schemaVersion: 1, pilot: 'matter-flow-aquarium-v1', runtime: runtimeInfo(), rules: RULES, initialReservoir: MATTER_INITIAL_RESERVOIR,
    maxTotal: MATTER_MAX_TOTAL, batch: batchSettings(), sourceSha256: captured, prebatchFixtures: fixtures, batchStatus, runs,
    interpretation: { standardRainImportedAt3000: 24000, standardRainReservoirAt3000: 8768, standardRainExhaustionTick: 4096, exhaustedByFixedHorizon: false } };
  validateEvidenceStructure(data);
  return data;
}

function expectedSamples(extinctionTick: number | null, throughTick = MAX_TICK): number[] {
  const ticks = [0];
  for (let tick = SAMPLE_EVERY; tick <= throughTick; tick += SAMPLE_EVERY) ticks.push(tick);
  if (extinctionTick !== null && extinctionTick <= throughTick && extinctionTick % SAMPLE_EVERY !== 0 && extinctionTick !== 0) ticks.push(extinctionTick);
  return ticks.sort((a, b) => a - b);
}
function validateSnapshot(snapshotValue: unknown, run: AnyRecord, scheduled: number, label: string, expectedRuntime: string): AnyRecord {
  record(snapshotValue, label);
  const row = snapshotValue;
  invariant(row.scheduledTick === scheduled && row.actualTick === scheduled, `${label}: snapshot schedule mismatch`);
  record(row.state, `${label}: state`);
  hashString(row.stateHash, `${label}: hash`);
  invariant(canonicalHash(row.state) === row.stateHash, `${label}: state hash mismatch`);
  const state = row.state as AnyRecord;
  invariant(state.schemaVersion === 1 && state.observationOnly === true && state.runtime === expectedRuntime && state.tick === scheduled && state.seed === run.seed && state.mode === run.mode && sameJSON(state.rules, RULES), `${label}: state identity/rules mismatch`);
  invariant(state.fields?.nutrient?.length === MATTER_SIZE && state.fields?.biomass?.length === MATTER_SIZE && state.fields?.detritus?.length === MATTER_SIZE && state.fields?.phases?.length === MATTER_SIZE,
    `${label}: full physical fields missing`);
  for (let i = 0; i < MATTER_SIZE; i++) {
    invariant(Number.isInteger(state.fields.nutrient[i]) && state.fields.nutrient[i] >= 0 && state.fields.nutrient[i] <= MATTER_MAX_TOTAL &&
      Number.isInteger(state.fields.biomass[i]) && state.fields.biomass[i] >= 0 && state.fields.biomass[i] <= 64 &&
      Number.isInteger(state.fields.detritus[i]) && state.fields.detritus[i] >= 0 && state.fields.detritus[i] <= MATTER_MAX_TOTAL &&
      Number.isInteger(state.fields.phases[i]) && state.fields.phases[i] >= 0 && state.fields.phases[i] <= 3, `${label}: field bound failed at tile ${i}`);
    if (scheduled > 0) invariant(state.fields.biomass[i] === 0 || state.fields.biomass[i] >= 4, `${label}: sub-threshold biomass at tile ${i}`);
  }
  const census = censusFromState(state);
  validateCensus(census, `${label}: census`);
  validateModeTruth(census, run.mode as MatterMode, `${label}: census`);
  assertExtinctionAt(census, run.extinctionTick ?? null, scheduled, label);
  const snapshotHistory = validateHistory(state.history, `${label}: history`, run.extinctionTick ?? null, expectedSamples(run.extinctionTick ?? null, scheduled), run.mode as MatterMode);
  if (Array.isArray(run.samples)) for (const row of snapshotHistory) {
    const sample = run.samples.find((item: AnyRecord) => item.scheduledTick === row.tick);
    invariant(sample && sameJSON(sample.census, stripHistoryActivity(row)), `${label}: snapshot history differs from retained census sample at ${row.tick}`);
  }
  invariant(state.initialTotal === state.initialNutrient + state.initialBiomass + state.initialDetritus + state.initialReservoir,
    `${label}: immutable initial stock metadata mismatch`);
  return state;
}
function censusFromState(state: AnyRecord): MatterCensus {
  const N = state.fields.nutrient as number[], B = state.fields.biomass as number[], D = state.fields.detritus as number[];
  const c = state.counters as AnyRecord;
  const { components, largest } = componentStats(B);
  return { tick: state.tick, extinctionTick: state.extinctionTick, nutrient: sum(N), biomass: sum(B), detritus: sum(D), activeMatter: sum(N) + sum(B) + sum(D),
    reservoir: state.reservoir, sediment: state.sediment, initialTotal: state.initialTotal, initialNutrient: state.initialNutrient,
    initialBiomass: state.initialBiomass, initialDetritus: state.initialDetritus, initialReservoir: state.initialReservoir,
    residual: sum(N) + sum(B) + sum(D) + state.reservoir + state.sediment - state.initialTotal,
    activeCells: B.filter((v) => v >= 4).length, components, largestComponentCells: largest, ...c } as MatterCensus;
}
function componentStats(b: readonly number[]): { components: number; largest: number } {
  const seen = new Uint8Array(MATTER_SIZE), queue = new Int32Array(MATTER_SIZE);
  let components = 0, largest = 0;
  for (let start = 0; start < MATTER_SIZE; start++) if (b[start]! >= 4 && !seen[start]) {
    components++; let head = 0, tail = 0, size = 0; queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const i = queue[head++]!, x = i % MATTER_WIDTH, y = Math.floor(i / MATTER_WIDTH); size++;
      const neighbors = [(x + 1) % MATTER_WIDTH + y * MATTER_WIDTH, (x + MATTER_WIDTH - 1) % MATTER_WIDTH + y * MATTER_WIDTH,
        ...(y > 0 ? [i - MATTER_WIDTH] : []), ...(y + 1 < MATTER_HEIGHT ? [i + MATTER_WIDTH] : [])];
      for (const n of neighbors) if (b[n]! >= 4 && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
    }
    largest = Math.max(largest, size);
  }
  return { components, largest };
}
function validateCensus(value: unknown, label: string): asserts value is MatterCensus {
  record(value, label);
  const c = value as MatterCensus;
  safeInteger(c.tick, `${label}: tick`, 0, MAX_TICK);
  safeInteger(c.residual, `${label}: residual`, -MATTER_MAX_TOTAL, MATTER_MAX_TOTAL);
  invariant(c.extinctionTick === null || (Number.isSafeInteger(c.extinctionTick) && c.extinctionTick >= 0 && c.extinctionTick <= c.tick), `${label}: invalid extinction tick`);
  for (const key of ['nutrient', 'biomass', 'detritus', 'activeMatter', 'reservoir', 'sediment', 'initialTotal', 'initialNutrient', 'initialBiomass', 'initialDetritus', 'initialReservoir', 'activeCells', 'components', 'largestComponentCells', ...COUNTERS]) safeInteger(c[key as keyof MatterCensus], `${label}: ${key}`);
  invariant(c.residual === 0 && c.activeMatter === c.nutrient + c.biomass + c.detritus, `${label}: matter ledger mismatch`);
  invariant(c.reservoir === c.initialReservoir - c.imported && c.sediment === c.buried, `${label}: source/sediment mismatch`);
  invariant(c.initialTotal === c.initialNutrient + c.initialBiomass + c.initialDetritus + c.initialReservoir, `${label}: initial stocks mismatch`);
  invariant(c.nutrient === c.initialNutrient + c.imported - c.growth + c.recycled && c.biomass === c.initialBiomass + c.growth - c.mortality &&
    c.detritus === c.initialDetritus + c.mortality - c.recycled - c.buried, `${label}: pool identity mismatch`);
  invariant(c.mortality === c.routineDecay + c.thresholdLoss, `${label}: mortality components mismatch`);
  invariant(c.activeCells <= MATTER_SIZE && c.largestComponentCells <= c.activeCells && c.components <= c.activeCells && (c.activeCells === 0 ? c.components === 0 && c.largestComponentCells === 0 : c.components > 0 && c.largestComponentCells > 0),
    `${label}: active-area census mismatch`);
}

function validateModeTruth(census: MatterCensus, mode: MatterMode, label: string): void {
  const rainEnabled = mode === 'rain' || mode === 'rain-burial';
  const burialEnabled = mode === 'burial' || mode === 'rain-burial';
  const expectedImported = rainEnabled ? Math.min(census.initialReservoir, 64 * Math.floor(census.tick / 8)) : 0;
  invariant(census.imported === expectedImported, `${label}: rain exchange does not match the supplied schedule for ${mode}`);
  if (!burialEnabled) invariant(census.buried === 0 && census.sediment === 0, `${label}: burial disabled but matter was buried in ${mode}`);
}

function assertExtinctionAt(census: MatterCensus, finalExtinctionTick: number | null, observedTick: number, label: string): void {
  const expected = finalExtinctionTick !== null && observedTick >= finalExtinctionTick ? finalExtinctionTick : null;
  invariant(census.extinctionTick === expected, `${label}: extinction marker does not match the first zero-biomass tick`);
  invariant(expected === null ? census.biomass > 0 : census.biomass === 0, `${label}: biomass and extinction marker disagree`);
}

function validateHistory(historyValue: unknown, label: string, extinctionTick: number | null, expectedTicks: readonly number[], mode: MatterMode): AnyRecord[] {
  invariant(Array.isArray(historyValue) && historyValue.length === expectedTicks.length, `${label}: history row count mismatch`);
  const history = historyValue as AnyRecord[];
  for (let i = 0; i < expectedTicks.length; i++) {
    const row = history[i]!, tick = expectedTicks[i]!;
    invariant(row.tick === tick, `${label}: history tick mismatch at row ${i}`);
    const census = stripHistoryActivity(row) as MatterCensus;
    validateCensus(census, `${label}: history census ${tick}`);
    validateModeTruth(census, mode, `${label}: history ${tick}`);
    assertExtinctionAt(census, extinctionTick, tick, `${label}: history ${tick}`);
    if (i === 0) {
      invariant(row.intervalFromTick === null && row.intervalToTick === null && row.meanAbsBChange === null && row.maskFlipFraction === null &&
        row.relaxedInterval === null && row.settledInterval === null, `${label}: tick-zero interval fields must be null`);
      continue;
    }
    const previous = history[i - 1]!;
    invariant(row.intervalFromTick === previous.tick && row.intervalToTick === tick, `${label}: interval endpoints disagree at tick ${tick}`);
    invariant(typeof row.meanAbsBChange === 'number' && Number.isFinite(row.meanAbsBChange) && row.meanAbsBChange >= 0 && row.meanAbsBChange <= 64 &&
      typeof row.maskFlipFraction === 'number' && Number.isFinite(row.maskFlipFraction) && row.maskFlipFraction >= 0 && row.maskFlipFraction <= 1,
    `${label}: invalid sampled activity at tick ${tick}`);
    invariant(row.relaxedInterval === row.relaxed - previous.relaxed && row.settledInterval === row.settled - previous.settled &&
      row.relaxedInterval >= 0 && row.settledInterval >= 0, `${label}: interval unit-move counters mismatch at tick ${tick}`);
    invariant(row.reservoir <= previous.reservoir && row.sediment >= previous.sediment && COUNTERS.every((key) => row[key] >= previous[key]),
      `${label}: stocks/counters are not monotone at tick ${tick}`);
  }
  return history;
}

function fixtureHistoryTicks(finalTick: number, extinctionTick: number | null): number[] {
  const ticks = [0];
  for (let tick = SAMPLE_EVERY; tick <= finalTick; tick += SAMPLE_EVERY) ticks.push(tick);
  if (extinctionTick !== null && extinctionTick > 0 && extinctionTick <= finalTick && extinctionTick % SAMPLE_EVERY !== 0) ticks.push(extinctionTick);
  return ticks.sort((a, b) => a - b);
}
function firstCounterIncrease(samples: readonly AnyRecord[], counter: string): number | null {
  for (let i = 1; i < samples.length; i++) if (samples[i]!.census[counter] > samples[i - 1]!.census[counter]) return samples[i]!.scheduledTick;
  return null;
}
function validateFixtureEvidence(fixture: AnyRecord, expectedRuntime: string): void {
  const kind = fixture.name as 'growth-extension' | 'empty-physical-continuation';
  const expected = fixtureExpected(kind);
  invariant(sameJSON(fixture.expected, expected), `${kind}: expected recipe/result differs`);
  invariant(fixture.seed === 0 && fixture.mode === (kind === 'growth-extension' ? 'closed' : 'rain-burial'), `${kind}: fixture identity mismatch`);
  invariant(Array.isArray(fixture.samples) && fixture.samples.length === expected.finalTick + 1, `${kind}: every census tick must be retained`);
  const extinctionTick = kind === 'empty-physical-continuation' ? 0 : null;
  let previousCensus: MatterCensus | null = null;
  for (let i = 0; i < fixture.samples.length; i++) {
    const sample = fixture.samples[i] as AnyRecord;
    invariant(sample.scheduledTick === i, `${kind}: census tick missing or out of order at ${i}`);
    invariant(sample.census?.tick === sample.scheduledTick, `${kind}: census tick label disagrees with scheduled tick ${i}`);
    validateModeTruth(sample.census, fixture.mode, `${kind}: sample ${i}`);
    validateCensus(sample.census, `${kind}: sample ${i}`);
    assertExtinctionAt(sample.census, extinctionTick, i, `${kind}: sample ${i}`);
    if (previousCensus) {
      invariant(sample.census.reservoir <= previousCensus.reservoir && sample.census.sediment >= previousCensus.sediment &&
        COUNTERS.every((key) => sample.census[key] >= previousCensus![key]), `${kind}: sample stocks/counters are not monotone at tick ${i}`);
    }
    previousCensus = sample.census as MatterCensus;
  }
  const finalTick = expected.finalTick;
  const expectedHistory = fixtureHistoryTicks(finalTick, extinctionTick);
  const meta = { seed: 0, mode: fixture.mode, extinctionTick };
  invariant(Array.isArray(fixture.snapshots) && fixture.snapshots.length === 2, `${kind}: initial/final snapshots missing`);
  const initial = validateSnapshot(fixture.snapshots[0], meta, 0, `${kind}@0`, expectedRuntime);
  const final = validateSnapshot(fixture.snapshots[1], meta, finalTick, `${kind}@${finalTick}`, expectedRuntime);
  invariant(sameJSON(initial.fields.phases, final.fields.phases), `${kind}: phases changed between retained observations`);
  const recipe = fixtureInput(kind);
  for (const field of ['nutrient', 'biomass', 'detritus', 'phases'] as const) {
    invariant(sameJSON(initial.fields[field], Array.from(recipe[field])), `${kind}: tick-zero ${field} does not match its fixed recipe`);
  }
  invariant(initial.reservoir === recipe.reservoir && initial.sediment === 0, `${kind}: initial source/sediment mismatch`);
  invariant(sameJSON(fixture.samples[0]!.census, censusFromState(initial)), `${kind}: tick-zero census differs from initial snapshot`);
  invariant(sameJSON(fixture.samples.at(-1)!.census, censusFromState(final)), `${kind}: final census sample differs from final snapshot`);
  validateCensus(fixture.finalCensus, `${kind}: final census`);
  invariant(sameJSON(fixture.finalCensus, censusFromState(final)), `${kind}: final summary census differs from final snapshot`);
  invariant(sameJSON(fixture.finalHistory, final.history) && fixture.droppedSamples === final.droppedSamples, `${kind}: final history differs from final snapshot`);
  validateHistory(fixture.finalHistory, `${kind}: history`, extinctionTick, expectedHistory, fixture.mode);
  for (const sample of fixture.samples) {
    const historyRow = fixture.finalHistory.find((row: AnyRecord) => row.tick === sample.scheduledTick);
    if (historyRow) invariant(sameJSON(sample.census, stripHistoryActivity(historyRow)), `${kind}: census sample differs from retained history at tick ${sample.scheduledTick}`);
  }
  const census = fixture.finalCensus as MatterCensus;
  const actual: AnyRecord = kind === 'growth-extension'
    ? { finalTick, firstExtensionTick: firstCounterIncrease(fixture.samples, 'spread'), growth: census.growth, routineDecay: census.routineDecay,
      thresholdLoss: census.thresholdLoss, mortality: census.mortality, spread: census.spread, colonizedTiles: census.colonizedTiles,
      biomass: census.biomass, activeCells: census.activeCells, activeTileIndices: Array.from(final.fields.biomass as number[], (v, i) => v >= 4 ? i : -1).filter((i) => i >= 0),
      imported: census.imported, buried: census.buried, residual: census.residual }
    : { finalTick, extinctionTick, imported: census.imported, firstImportTick: firstCounterIncrease(fixture.samples, 'imported'), reservoir: census.reservoir,
      recycled: census.recycled, buried: census.buried, firstBurialTick: firstCounterIncrease(fixture.samples, 'buried'), sediment: census.sediment,
      nutrient: census.nutrient, biomass: census.biomass, detritus: census.detritus, residual: census.residual };
  invariant(sameJSON(fixture.actual, actual), `${kind}: measured gate summary does not match retained observations`);
  invariant(fixture.passed === sameJSON(actual, expected), `${kind}: gate result does not match its exact expected values`);
}

/** Structural validator used by --check and focused tampering tests. */
export function validateEvidenceStructure(value: unknown): void {
  record(value, 'pilot evidence');
  const data = value;
  invariant(data.schemaVersion === 1 && data.pilot === 'matter-flow-aquarium-v1', 'pilot schema/version mismatch');
  invariant(sameJSON(data.rules, RULES) && sameJSON(data.batch, batchSettings()), 'rules or fixed batch settings differ');
  record(data.runtime, 'runtime');
  invariant(typeof data.runtime.node === 'string' && typeof data.runtime.platform === 'string' && typeof data.runtime.arch === 'string', 'runtime metadata is malformed');
  const recordedRuntime = `Node ${data.runtime.node}`;
  invariant(data.interpretation?.standardRainImportedAt3000 === 24000 && data.interpretation?.standardRainReservoirAt3000 === 8768 &&
    data.interpretation?.standardRainExhaustionTick === 4096 && data.interpretation?.exhaustedByFixedHorizon === false, 'standard rain schedule interpretation mismatch');
  invariant(Array.isArray(data.prebatchFixtures) && data.prebatchFixtures.length === 2, 'exact two pre-batch fixtures are required');
  invariant(data.prebatchFixtures[0]?.name === 'growth-extension' && data.prebatchFixtures[1]?.name === 'empty-physical-continuation', 'pre-batch fixture order/name mismatch');
  invariant(data.prebatchFixtures.every((f: AnyRecord) => typeof f.passed === 'boolean'), 'pre-batch fixture result flag missing');
  for (const fixture of data.prebatchFixtures) validateFixtureEvidence(fixture, recordedRuntime);
  const fixturesPassed = data.prebatchFixtures.every((f: AnyRecord) => f.passed);
  if (!fixturesPassed) {
    invariant(data.batchStatus === 'stopped-after-fixture-failure' && Array.isArray(data.runs) && data.runs.length === 0,
      'failed pre-batch fixture must stop before the matrix without partial outcomes');
    return;
  }
  invariant(data.batchStatus === 'complete' && Array.isArray(data.runs), 'accepted evidence must contain the complete run matrix');
  const expectedPairs = SEEDS.flatMap((seed) => ALL_MODES.map((mode) => ({ seed, mode })));
  invariant(data.runs.length === expectedPairs.length, 'run matrix must contain exactly 12 outcomes');
  const initialBySeed = new Map<number, string>();
  for (let index = 0; index < expectedPairs.length; index++) {
    const expected = expectedPairs[index]!, run = data.runs[index] as AnyRecord;
    invariant(run.seed === expected.seed && run.mode === expected.mode, `matrix order/mode mismatch at row ${index + 1}`);
    invariant(run.repeatVerified === true && run.finalTick === MAX_TICK, `${run.seed}/${run.mode}: repeat or full horizon missing`);
    safeInteger(run.seed, 'seed', 0, 0xffff_ffff);
    invariant(run.extinctionTick === null || (Number.isSafeInteger(run.extinctionTick) && run.extinctionTick >= 0 && run.extinctionTick <= MAX_TICK), `${run.seed}/${run.mode}: invalid extinction tick`);
    const init = initialBySeed.get(run.seed);
    if (init === undefined) initialBySeed.set(run.seed, run.initialStateHash);
    else invariant(init === run.initialStateHash, `${run.seed}: mode pair initial state mismatch`);
    hashString(run.initialStateHash, `${run.seed}/${run.mode}: initial hash`);
    const scheduled = expectedSamples(run.extinctionTick);
    invariant(Array.isArray(run.samples) && run.samples.length === scheduled.length, `${run.seed}/${run.mode}: census schedule has missing/extra rows`);
    for (let i = 0; i < scheduled.length; i++) {
      const row = run.samples[i] as AnyRecord, tick = scheduled[i]!;
      invariant(row.scheduledTick === tick && row.actualTick === tick, `${run.seed}/${run.mode}: sample schedule/actual tick mismatch at ${tick}`);
      hashString(row.stateHash, `${run.seed}/${run.mode}: sample hash at ${tick}`);
      validateModeTruth(row.census, run.mode, `${run.seed}/${run.mode}: census at ${tick}`);
      validateCensus(row.census, `${run.seed}/${run.mode}: census at ${tick}`);
      invariant(row.census.tick === tick, `${run.seed}/${run.mode}: census tick mismatch at ${tick}`);
      assertExtinctionAt(row.census, run.extinctionTick, tick, `${run.seed}/${run.mode}: sample ${tick}`);
    }
    invariant(Array.isArray(run.snapshots) && run.snapshots.length === SNAPSHOT_TICKS.length, `${run.seed}/${run.mode}: required snapshots absent`);
    const states: AnyRecord[] = [];
    for (let i = 0; i < SNAPSHOT_TICKS.length; i++) {
      const tick = SNAPSHOT_TICKS[i]!, state = validateSnapshot(run.snapshots[i], run, tick, `${run.seed}/${run.mode}@${tick}`, recordedRuntime);
      states.push(state);
      const matching = run.samples.find((sample: AnyRecord) => sample.scheduledTick === tick);
      invariant(matching && matching.stateHash === run.snapshots[i].stateHash && sameJSON(matching.census, censusFromState(state)), `${run.seed}/${run.mode}: snapshot/sample census or hash mismatch at ${tick}`);
    }
    invariant(canonicalHash(withoutMode(states[0]!)) === run.initialStateHash, `${run.seed}/${run.mode}: initial snapshot hash mismatch`);
    const seededInitial = plainSnapshot(new MatterWorld(run.seed, run.mode).snapshot());
    invariant(sameJSON(withoutRuntime(states[0]!), withoutRuntime(seededInitial)), `${run.seed}/${run.mode}: tick-zero snapshot differs from the seeded constructor`);
    invariant(run.finalStateHash === run.snapshots.at(-1).stateHash, `${run.seed}/${run.mode}: final snapshot hash mismatch`);
    invariant(run.extinctionTick === run.finalCensus?.extinctionTick, `${run.seed}/${run.mode}: final extinction marker mismatch`);
    for (const state of states.slice(1)) {
      invariant(sameJSON(state.fields.phases, states[0]!.fields.phases), `${run.seed}/${run.mode}: phases changed between retained snapshots`);
      for (const key of ['initialNutrient', 'initialBiomass', 'initialDetritus', 'initialReservoir', 'initialTotal']) {
        invariant(state[key] === states[0]![key], `${run.seed}/${run.mode}: immutable initial stock ${key} changed`);
      }
    }
    validateCensus(run.finalCensus, `${run.seed}/${run.mode}: final census`);
    invariant(sameJSON(run.finalCensus, censusFromState(states.at(-1)!)), `${run.seed}/${run.mode}: final census differs from final snapshot`);
    invariant(sameJSON(run.finalHistory, states.at(-1)!.history) && run.droppedSamples === states.at(-1)!.droppedSamples, `${run.seed}/${run.mode}: history retention differs from final snapshot`);
    validateHistory(run.finalHistory, `${run.seed}/${run.mode}: retained`, run.extinctionTick, scheduled, run.mode);
    for (const sample of run.samples) {
      const historyRow = run.finalHistory.find((row: AnyRecord) => row.tick === sample.actualTick);
      invariant(historyRow && sameJSON(sample.census, stripHistoryActivity(historyRow)), `${run.seed}/${run.mode}: sample census differs from retained history at ${sample.actualTick}`);
    }
    invariant(sameJSON(run.lateActivity, lateActivity(run.finalHistory)), `${run.seed}/${run.mode}: late activity summary differs from its retained interval history`);
    invariant(Array.isArray(run.physicalHashes) && run.physicalHashes.length === MAX_TICK + 1, `${run.seed}/${run.mode}: physical timeline must retain ticks 0 through 3000`);
    for (let tick = 0; tick <= MAX_TICK; tick++) hashString(run.physicalHashes[tick], `${run.seed}/${run.mode}: physical hash ${tick}`);
    for (let i = 0; i < SNAPSHOT_TICKS.length; i++) {
      const tick = SNAPSHOT_TICKS[i]!;
      invariant(run.physicalHashes[tick] === physicalHashFromState(states[i]!), `${run.seed}/${run.mode}: physical hash differs from full snapshot at tick ${tick}`);
    }
  }
  for (const seed of SEEDS) {
    const set = data.runs.filter((r: AnyRecord) => r.seed === seed);
    invariant(set.length === 4, `seed ${seed}: incomplete paired mode set`);
    const closed = set.find((r: AnyRecord) => r.mode === 'closed')!;
    invariant(set.every((r: AnyRecord) => r.physicalHashes[0] === closed.physicalHashes[0]), `seed ${seed}: mode initial physical hashes differ`);
    for (const run of set) {
      const expectedClosed = run.mode === 'closed' ? null : firstDifferentHash(run.physicalHashes, closed.physicalHashes);
      invariant(run.firstPhysicalDivergenceFromClosed === expectedClosed, `seed ${seed}/${run.mode}: first physical divergence marker disagrees with paired timelines`);
      const controlMode = run.mode === 'burial' ? 'closed' : run.mode === 'rain-burial' ? 'rain' : null;
      const expectedBurial = controlMode === null ? null : firstDifferentHash(run.physicalHashes, set.find((r: AnyRecord) => r.mode === controlMode)!.physicalHashes);
      invariant(run.firstBurialDivergenceFromControl === expectedBurial, `seed ${seed}/${run.mode}: first burial/control divergence marker disagrees with paired timelines`);
    }
    for (const mode of ['rain', 'rain-burial']) {
      const rain = set.find((r: AnyRecord) => r.mode === mode)!.finalCensus;
      invariant(rain.imported === 24000 && rain.reservoir === 8768, `seed ${seed}/${mode}: standard rain endpoint mismatch`);
    }
  }
}
function stripHistoryActivity(row: AnyRecord): AnyRecord {
  const copy = { ...row };
  delete copy.meanAbsBChange; delete copy.maskFlipFraction; delete copy.relaxedInterval; delete copy.settledInterval;
  delete copy.intervalFromTick; delete copy.intervalToTick;
  return copy;
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const matrix = [headers, ...rows];
  const widths = headers.map((_h, i) => Math.max(3, ...matrix.map((row) => (row[i] ?? '').length)));
  const render = (row: readonly string[]) => `| ${row.map((cell, i) => cell.padEnd(widths[i]!)).join(' | ')} |`;
  const head = render(headers), sep = `| ${widths.map((n) => '-'.repeat(n)).join(' | ')} |`;
  const body = rows.map(render);
  for (const line of [head, sep, ...body]) invariant(line.length === head.length && line.split('|').length - 2 === headers.length, 'Markdown table layout mismatch');
  return [head, sep, ...body].join('\n');
}
export function buildMarkdown(data: AnyRecord): string {
  const fixtures = (data.prebatchFixtures as AnyRecord[]).map((f) => [String(f.name), f.passed ? 'pass' : 'fail', String(f.expected.finalTick), String(f.actual.residual)]);
  const rows = (data.runs as AnyRecord[]).map((run) => {
    const c = run.finalCensus as MatterCensus, late = run.lateActivity as AnyRecord;
    const physicalDivergence = run.mode === 'closed' ? 'n/a' : String(run.firstPhysicalDivergenceFromClosed ?? 'none');
    const burialControlApplies = run.mode === 'burial' || run.mode === 'rain-burial';
    const burialDivergence = burialControlApplies ? String(run.firstBurialDivergenceFromControl ?? 'none') : 'n/a';
    return [String(run.seed), run.mode, run.extinctionTick === null ? 'biomass present at 3000' : `extinct at ${run.extinctionTick}`,
      String(c.nutrient), String(c.biomass), String(c.detritus), String(c.reservoir), String(c.sediment), String(c.imported), String(c.buried),
      String(c.activeCells), String(late.meanAbsBChangePerTilePerTick), String(late.maskFlipFractionPerTick),
      ['growth', 'mortality', 'recycled', 'relaxed', 'settled'].map((key) => `${key}:${late.counterDeltas[key]}`).join(', '),
      physicalDivergence, burialDivergence];
  });
  const fixtureTable = table(['Pre-batch fixture', 'Gate', 'Horizon', 'Residual'], fixtures);
  const runTable = table(['Seed', 'Mode', 'Outcome', 'N', 'B', 'D', 'Reservoir', 'Sediment', 'Imported', 'Buried', 'Active cells', 'Late absolute B change/tile/tick', 'Late mask flips/tick', 'Late counter differences', 'First physical divergence vs closed', 'First burial/control divergence'], rows);
  const burialCount = (data.runs as AnyRecord[]).filter((r) => (r.finalCensus as MatterCensus).buried > 0).length;
  const burialInert = burialCount === 0 && (data.runs as AnyRecord[]).filter((r) => ['burial', 'rain-burial'].includes(r.mode)).every((r) => r.firstBurialDivergenceFromControl === null);
  return `# Matter flow aquarium pilot evidence\n\n` +
`Fixed descriptive evidence for a deliberately engineered integer-matter toy. Generated with Node ${data.runtime.node} on ${data.runtime.platform}/${data.runtime.arch}.\n\n` +
`## Method\n\n` +
`The pre-batch gate retains exactly two specified fixtures. The growth/extension recipe runs seed 0, closed mode, N=16 per tile, one B=24 patch at (8,12), zero D, zero phases, and no reservoir for 24 ticks. The empty-biomass continuation recipe runs seed 0, rain+burial mode, only D=16 at bottom tile (0,47), zero N/B and phases, and reservoir 4 through 100 ticks. Their expected values are fixed by the reviewed plan; a mismatch stops the batch without tuning.\n\n` +
`The batch crosses seeds ${SEEDS.join(', ')} with all four modes (${ALL_MODES.join(', ')}) through ${MAX_TICK} ticks, retaining all 12 outcomes. Modes share the same seeded initial physical state. Bounds, exact pool identities, cumulative counters, exchange switches, and no-resurrection are checked every tick. Independent repeats are compared as complete state hashes every ${SAMPLE_EVERY} ticks and at the final tick. Clocks and physical fields continue to update after biomass reaches zero. Census is retained every ${SAMPLE_EVERY} ticks and at exact extinction; full snapshots are retained at ${SNAPSHOT_TICKS.join(', ')}.\n\n` +
`Late activity is computed from consecutive retained sample intervals within 2000–3000. It reports endpoint biomass change per tile per tick and changed active-cell mask fraction per tick, plus exact growth, mortality, recycled, relaxed and settled counter differences. Those counter differences are unit counts across the 1,000-tick window, not rates. Endpoint activity can miss turnover that cancels between samples; zero biomass activity alone does not establish physical quiescence. Relaxed and settled totals are unit-moves, not net pool conversions.\n\n` +
`Rain follows a prescribed source schedule. At tick 3000 it has imported 24,000 units and retains 8,768 in its reservoir; exhaustion is scheduled at tick 4096. This pilot does not observe standard-rain exhaustion or its aftermath. Rain import is a supplied schedule, not an ecological result.\n\n` +
`Source hashes were captured before the fixtures and checked again before persistence. Every unfavorable outcome remains in the JSON. No survival benefit, adaptation, or general ecological claim is made.\n\n` +
`## Pre-batch fixtures\n\n` + fixtureTable + `\n\n` +
`## Fixed batch\n\n` + (data.batchStatus === 'complete' ? runTable : 'The batch stopped because a required pre-batch fixture did not match its fixed expected result. No batch outcomes were run or retained.\n\n') + `\n\n` +
`First physical divergence compares N/B/D/reservoir/sediment against Closed for that seed. First burial/control divergence compares Burial with Closed and Rain+burial with Rain. For an applicable comparison, “none” means exact equality persisted through tick 3000; “n/a” means the comparison does not apply to that mode. ${burialInert ? 'Burial was inert in this fixed slice: no material was buried and burial-enabled worlds matched their controls.' : `${burialCount} of 12 outcomes recorded burial; report the paired differences without tuning.`}\n\n` +
`Interpretation is limited to this engineered toy, its fixed rules, three seeds, and 3,000-tick horizon. Run \`--check\` to verify source hashes, the exact matrix, observation schedules, snapshot stocks, history consistency, and generated Markdown; \`--replay-check\` compares a full rerun with the retained artifact.\n`;
}

async function writeEvidence(): Promise<void> {
  const data = buildArtifact();
  const markdown = buildMarkdown(data);
  const hashes = sourceHashes();
  invariant(sameJSON(hashes, data.sourceSha256), 'source files changed before persistence; discard evidence');
  await writeFile(JSON_URL, `${JSON.stringify(data)}\n`);
  await writeFile(MD_URL, markdown);
  process.stdout.write(`Wrote matter pilot evidence (${(JSON.stringify(data).length / 1024 / 1024).toFixed(2)} MiB JSON).\n`);
}
async function checkEvidence(): Promise<void> {
  invariant(process.versions.node === EXPECTED_NODE, `Evidence check requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  const data = JSON.parse(await readFile(JSON_URL, 'utf8')) as AnyRecord;
  invariant(sameJSON(data.runtime, runtimeInfo()), 'runtime mismatch');
  invariant(sameJSON(data.sourceSha256, sourceHashes()), 'source hash mismatch; review changed sources before regeneration');
  validateEvidenceStructure(data);
  invariant((await readFile(MD_URL, 'utf8')) === buildMarkdown(data), 'generated Markdown differs from accepted JSON');
  process.stdout.write('Matter evidence hashes, rules, fixed matrix, schedules, snapshots, history and Markdown passed.\n');
}
async function replayCheck(): Promise<void> {
  invariant(process.versions.node === EXPECTED_NODE, `Replay check requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  const prior = JSON.parse(await readFile(JSON_URL, 'utf8')) as AnyRecord;
  const current = buildArtifact();
  invariant(JSON.stringify(prior) === JSON.stringify(current), 'full fixed-batch replay differs from accepted evidence');
  invariant((await readFile(MD_URL, 'utf8')) === buildMarkdown(current), 'replayed Markdown differs from accepted evidence');
  process.stdout.write('Matter pre-batch gates and full 12-condition replay exactly match JSON and Markdown.\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv[2];
  if (mode === '--write') await writeEvidence();
  else if (mode === '--check') await checkEvidence();
  else if (mode === '--replay-check') await replayCheck();
  else throw new Error('Usage: node tools/matter/explore.ts --write | --check | --replay-check');
}
