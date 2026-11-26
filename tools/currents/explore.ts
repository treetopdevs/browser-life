#!/usr/bin/env node
/** Fixed, replayable evidence for the nutrient-current pilot. Run with Node 24.2.0. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { rename, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  CURRENT_CONDITIONS, MATTER_HEIGHT, MATTER_INITIAL_RESERVOIR, MATTER_MAX_TOTAL, MATTER_SIZE, MATTER_WIDTH,
  MatterWorld, RULES, type CurrentMode, type MatterCensus, type MatterHistorySample, type MatterMode,
} from '../../apps/lab/src/currents/model.ts';
import { MatterWorld as LegacyMatterWorld } from '../../apps/lab/src/matter/model.ts';

const JSON_URL = new URL('../../docs/creative-prototypes/current-pilot.json', import.meta.url);
const MD_URL = new URL('../../docs/creative-prototypes/current-pilot.md', import.meta.url);
const MODEL_URL = new URL('../../apps/lab/src/currents/model.ts', import.meta.url);
const LEGACY_URL = new URL('../../apps/lab/src/matter/model.ts', import.meta.url);
const RUNNER_URL = new URL('./explore.ts', import.meta.url);
const SOURCE_PATHS = ['apps/lab/src/currents/model.ts', 'apps/lab/src/matter/model.ts', 'tools/currents/explore.ts'] as const;
const SOURCES = [MODEL_URL, LEGACY_URL, RUNNER_URL] as const;
const EXPECTED_NODE = '24.2.0';
const SEEDS = [1201, 1202, 1203] as const;
const MAX_TICK = 6000;
const BATCH_LIMIT_MS = 20 * 60 * 1000;
const SAMPLE_EVERY = 50;
const SNAPSHOT_TICKS = [0, 1000, 3000, 4095, 4096, 6000] as const;
const COMPARE_EVERY = 100;
const REPLAY_TICKS = Object.freeze(Array.from(new Set([...Array.from({ length: 61 }, (_, i) => i * 100), ...Array.from({ length: 51 }, (_, i) => i * 4)])).sort((a, b) => a - b));
const COUNTERS = ['imported', 'buried', 'growth', 'routineDecay', 'thresholdLoss', 'mortality', 'recycled', 'relaxed', 'spread', 'colonizedTiles', 'settled', 'circulated'] as const;
const POOLS = ['nutrient', 'biomass', 'detritus'] as const;
type AnyRecord = Record<string, any>;
type StoredSnapshot = { tick: number; state: AnyRecord };
type Run = AnyRecord;
let batchProgress: AnyRecord = { phase: 'not-started', seed: null, conditionId: null, tick: 0 };

function invariant(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function record(value: unknown, label: string): asserts value is AnyRecord { invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`); }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sha(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function safe(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number { invariant(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, `${label}: invalid safe integer`); }
function sum(values: ArrayLike<number>): number { let n = 0; for (let i = 0; i < values.length; i++) n += values[i]!; return n; }
function sourceHashes(): Record<string, string> { return Object.fromEntries(SOURCE_PATHS.map((p, i) => [p, sha(readFileSync(SOURCES[i]!))])); }
function plainSnapshot<T extends { fields: { nutrient: ArrayLike<number>; biomass: ArrayLike<number>; detritus: ArrayLike<number>; phases: ArrayLike<number> }; counters: object; history: readonly object[] }>(s: T): AnyRecord {
  return { ...s, fields: { nutrient: Array.from(s.fields.nutrient), biomass: Array.from(s.fields.biomass), detritus: Array.from(s.fields.detritus), phases: Array.from(s.fields.phases) },
    counters: { ...s.counters }, history: s.history.map((r) => ({ ...r })) };
}
function physicalState(world: MatterWorld): AnyRecord {
  const s = plainSnapshot(world.snapshot());
  return { fields: { nutrient: s.fields.nutrient, biomass: s.fields.biomass, detritus: s.fields.detritus, phases: s.fields.phases }, reservoir: s.reservoir, sediment: s.sediment,
    tick: s.tick, extinctionTick: s.extinctionTick, counters: s.counters };
}
function normalizeLegacyState(snapshot: AnyRecord): AnyRecord {
  const s = structuredClone(snapshot);
  delete s.current; delete s.rules.current; delete s.counters.circulated;
  for (const row of s.history ?? []) { delete row.current; delete row.circulated; }
  return s;
}
function censusState(world: MatterWorld): MatterCensus { return world.census(); }
function sample(world: MatterWorld): AnyRecord { return { tick: world.tick, census: censusState(world) }; }
function snapshot(world: MatterWorld): StoredSnapshot { return { tick: world.tick, state: plainSnapshot(world.snapshot()) }; }

function assertWorld(world: MatterWorld, label: string, previous: MatterCensus | null, previousFields?: AnyRecord): void {
  const c = world.census(), f = world.fields;
  safe(world.tick, `${label} tick`, 0, MAX_TICK);
  invariant(f.nutrient.length === MATTER_SIZE && f.biomass.length === MATTER_SIZE && f.detritus.length === MATTER_SIZE && f.phases.length === MATTER_SIZE, `${label}: field length mismatch`);
  for (let i = 0; i < MATTER_SIZE; i++) {
    invariant(f.nutrient[i]! <= MATTER_MAX_TOTAL && f.detritus[i]! <= MATTER_MAX_TOTAL && f.biomass[i]! <= 64 && f.phases[i]! <= 3, `${label}: field bound at ${i}/${world.tick}`);
    invariant(world.tick === 0 || f.biomass[i] === 0 || f.biomass[i]! >= 4, `${label}: subthreshold biomass at ${i}/${world.tick}`);
    if (previousFields) invariant(previousFields.phases[i] === f.phases[i], `${label}: immutable phase changed at ${i}/${world.tick}`);
  }
  const n = sum(f.nutrient), b = sum(f.biomass), d = sum(f.detritus);
  invariant(c.tick === world.tick && c.current === world.current && c.nutrient === n && c.biomass === b && c.detritus === d, `${label}: census stocks mismatch at ${world.tick}`);
  invariant(c.activeMatter === n + b + d && c.residual === 0 && c.sediment === 0 && c.buried === 0, `${label}: global matter ledger mismatch at ${world.tick}`);
  invariant(c.initialTotal === c.initialNutrient + c.initialBiomass + c.initialDetritus + c.initialReservoir && c.initialReservoir === MATTER_INITIAL_RESERVOIR, `${label}: immutable initial ledger mismatch`);
  invariant(c.reservoir === c.initialReservoir - c.imported && n === c.initialNutrient + c.imported - c.growth + c.recycled,
    `${label}: nutrient identity failed at ${world.tick}`);
  invariant(b === c.initialBiomass + c.growth - c.mortality && d === c.initialDetritus + c.mortality - c.recycled, `${label}: biomass/detritus identity failed at ${world.tick}`);
  invariant(c.mortality === c.routineDecay + c.thresholdLoss && c.activeCells <= MATTER_SIZE, `${label}: counter decomposition/activity mismatch`);
  for (const k of COUNTERS) safe(c[k], `${label} ${k}`);
  invariant(c.imported === (world.mode === 'rain' ? Math.min(c.initialReservoir, 64 * Math.floor(world.tick / 8)) : 0), `${label}: import schedule mismatch at ${world.tick}`);
  invariant(c.extinctionTick === world.extinctionTick && (b === 0 ? world.extinctionTick !== null : world.extinctionTick === null), `${label}: extinction state mismatch`);
  if (previous) {
    invariant(c.reservoir <= previous.reservoir, `${label}: reservoir increased at ${world.tick}`);
    for (const k of COUNTERS) invariant(c[k] >= previous[k], `${label}: ${k} counter decreased at ${world.tick}`);
    invariant(previous.extinctionTick === null || (b === 0 && world.extinctionTick === previous.extinctionTick), `${label}: biomass resurrected at ${world.tick}`);
    const delta = c.circulated - previous.circulated;
    if (world.current === 'off') invariant(delta === 0, `${label}: current-off circulation counter changed`);
    else if (world.tick % 4 !== 0) invariant(delta === 0, `${label}: circulation outside pulse tick ${world.tick}`);
    else {
      const postRainN = previous.nutrient + (world.mode === 'rain' && world.tick % 8 === 0 ? Math.min(64, previous.reservoir) : 0);
      invariant(delta === postRainN, `${label}: translation ledger does not equal post-rain nutrient stock at ${world.tick}`);
    }
  }
}
function assertRepeat(a: MatterWorld, b: MatterWorld, label: string): void { invariant(same(plainSnapshot(a.snapshot()), plainSnapshot(b.snapshot())), `${label}: complete repeated state differs at tick ${a.tick}`); }
function currentFieldDelta(a: MatterWorld, b: MatterWorld): number { const x = a.fields, y = b.fields; for (const p of POOLS) for (let i = 0; i < MATTER_SIZE; i++) if (x[p][i] !== y[p][i]) return 1; return 0; }
function physicalDiff(a: MatterWorld, b: MatterWorld): boolean { return currentFieldDelta(a, b) !== 0 || a.reservoir !== b.reservoir || a.sediment !== b.sediment; }
function firstDiff(a: readonly (string | null)[], b: readonly (string | null)[]): number | null { for (let t = 0; t < a.length; t++) if (a[t] !== b[t]) return t; return null; }
function worldPhysicalHash(world: MatterWorld): string { const s = physicalState(world); return hash({ fields: s.fields, reservoir: s.reservoir, sediment: s.sediment }); }
function runReplayFrame(world: MatterWorld): { n: Uint32Array; b: Uint32Array; d: Uint32Array } { const f = world.fields; return { n: f.nutrient, b: f.biomass, d: f.detritus }; }
function encodeFrames(frames: readonly { n: Uint32Array; b: Uint32Array; d: Uint32Array }[]): Buffer {
  const out = Buffer.allocUnsafe(frames.length * MATTER_SIZE * 3 * 4); let offset = 0;
  for (const frame of frames) for (const field of [frame.n, frame.b, frame.d]) for (const value of field) { out.writeUInt32LE(value, offset); offset += 4; }
  return out;
}
function makeReplayFiles(runs: readonly Run[]): { replay: AnyRecord; bytes: Map<string, Buffer> } {
  const files = new Map<string, Buffer>(), seeds = [];
  for (const seed of SEEDS) {
    const group = runs.filter((r) => r.seed === seed).sort((a, b) => conditionIndex(a.conditionId) - conditionIndex(b.conditionId));
    invariant(group.length === 4, `replay: seed ${seed} lacks four conditions`);
    const rawParts: Buffer[] = [];
    for (const run of group) {
      invariant(run._replayFrames.length === REPLAY_TICKS.length, `replay frame count mismatch ${seed}/${run.conditionId}`);
      rawParts.push(encodeFrames(run._replayFrames)); delete run._replayFrames; delete run._physicalHashes;
    }
    const raw = Buffer.concat(rawParts), compressed = gzipSync(raw, { level: 9 });
    const deterministicCheck = gzipSync(raw, { level: 9 });
    invariant(compressed.equals(deterministicCheck) && compressed.readUInt32LE(4) === 0, `gzip output is not deterministic with a zero timestamp for seed ${seed}`);
    const file = `currents-replay-${seed}.replay`; files.set(file, compressed);
    seeds.push({ seed, file, compressedBytes: compressed.byteLength, uncompressedBytes: raw.byteLength, sha256: sha(raw), compressedSha256: sha(compressed) });
  }
  return { replay: { schemaVersion: 1, width: MATTER_WIDTH, height: MATTER_HEIGHT, conditions: CURRENT_CONDITIONS, ticks: [...REPLAY_TICKS], seeds }, bytes: files };
}
function conditionIndex(id: string): number { return CURRENT_CONDITIONS.findIndex((c) => c.id === id); }

function lateSummary(history: readonly MatterHistorySample[], final: MatterCensus): AnyRecord {
  const start = history.find((r) => r.tick === 5000), end = history.find((r) => r.tick === 6000);
  invariant(start && end, 'late summary requires history endpoints at 5000 and 6000');
  const deltas = Object.fromEntries(['growth', 'mortality', 'recycled', 'relaxed', 'circulated'].map((k) => [k, end[k as keyof MatterHistorySample] as number - (start[k as keyof MatterHistorySample] as number)]));
  const sampled = history.filter((r) => r.tick >= 5000 && r.tick <= 6000);
  invariant(sampled[0]?.tick === 5000 && sampled.at(-1)?.tick === 6000 && sampled.length >= 21 && sampled.length <= 22,
    'late summary must cover ticks 5000 through 6000 with scheduled samples and an optional extinction sample');
  for (let i = 0; i < sampled.length; i++) {
    const row = sampled[i]!;
    const isScheduled = row.tick % SAMPLE_EVERY === 0;
    const isExactExtinction = row.tick === final.extinctionTick && row.tick > 5000 && row.tick < 6000;
    invariant(isScheduled || isExactExtinction, `late summary contains an unexpected tick ${row.tick}`);
    if (i > 0) invariant(row.intervalFromTick === sampled[i - 1]!.tick && row.intervalToTick === row.tick,
      `late summary interval endpoints disagree at tick ${row.tick}`);
  }
  const intervals = sampled.slice(1);
  const durationTicks = intervals.reduce((n, row, i) => n + (row.tick - sampled[i]!.tick), 0);
  invariant(durationTicks === 1000, `late summary intervals span ${durationTicks}, expected 1000 ticks`);
  const meanAbsBChangeTotal = intervals.reduce((n, r) => n + (r.meanAbsBChange ?? 0), 0);
  const maskFlipTotal = intervals.reduce((n, r) => n + (r.maskFlipFraction ?? 0), 0);
  return { fromTick: 5000, toTick: 6000, counterDeltas: deltas,
    endpointBiomassChange: end.biomass - start.biomass, endpointActiveCellsChange: end.activeCells - start.activeCells,
    sampledActivityAcrossWindow: { intervalCount: intervals.length, durationTicks,
      meanAbsBChangePerTilePerTick: meanAbsBChangeTotal / durationTicks, maskFlipFractionPerTick: maskFlipTotal / durationTicks,
      endpointIntervalMeanAbsBChange: end.meanAbsBChange, endpointIntervalMaskFlipFraction: end.maskFlipFraction },
    nutrientAtStart: start.nutrient, nutrientAtEnd: end.nutrient, nutrientUnitMoves: deltas.relaxed, currentTranslationUnitMoves: deltas.circulated,
    sampledTicks: sampled.map((r) => r.tick), extinctionTick: final.extinctionTick };
}
function runOne(seed: number, condition: typeof CURRENT_CONDITIONS[number], baseline: LegacyMatterWorld, originalsChecked: Set<number>, deadline: number): Run {
  const mode = condition.mode as MatterMode, current = condition.current as CurrentMode;
  const world = new MatterWorld(seed, mode, current), repeat = new MatterWorld(seed, mode, current);
  const samples = [sample(world)], snapshots = [snapshot(world)], replayCensus = [world.census()];
  const hashes: (string | null)[] = [worldPhysicalHash(world)];
  const replayFrames = new Map<number, ReturnType<typeof runReplayFrame>>([[0, runReplayFrame(world)]]);
  let previous = world.census(), previousFields = world.fields;
  let firstPhysicalDivergence: number | null = null, firstBDivergence: number | null = null;
  const stillSibling = new MatterWorld(seed, mode, 'off');
  for (let tick = 1; tick <= MAX_TICK; tick++) {
    batchProgress = { phase: 'fixed-batch', seed, conditionId: condition.id, tick };
    if (tick % COMPARE_EVERY === 0 && Date.now() > deadline) throw new Error(`fixed pilot exceeded its 20-minute deadline at ${seed}/${condition.id}/${tick}`);
    world.step(); repeat.step();
    if (current === 'off') baseline.step();
    if (condition.id.endsWith('current')) stillSibling.step();
    assertWorld(world, `${seed}/${condition.id}`, previous, previousFields);
    assertWorld(repeat, `${seed}/${condition.id}/repeat`, previous, previousFields);
    if (tick % COMPARE_EVERY === 0 || tick === MAX_TICK) assertRepeat(world, repeat, `${seed}/${condition.id}`);
    if (current === 'off' && (tick % COMPARE_EVERY === 0 || tick === MAX_TICK)) {
      const old = baseline.snapshot();
      invariant(same(normalizeLegacyState(plainSnapshot(world.snapshot())), normalizeLegacyState(plainSnapshot(old))), `legacy stepper compatibility differs at ${seed}/${mode}/${tick}`);
      if (tick === MAX_TICK) originalsChecked.add(seed * 10 + (mode === 'rain' ? 1 : 0));
    }
    if (condition.id.endsWith('current')) {
      if (tick < 4) invariant(same(physicalState(world), physicalState(stillSibling)), `${seed}/${condition.id}: current pair diverged before tick 4`);
      if (firstPhysicalDivergence === null && physicalDiff(world, stillSibling)) firstPhysicalDivergence = tick;
      const a = world.fields.biomass, b = stillSibling.fields.biomass;
      if (firstBDivergence === null) for (let i = 0; i < MATTER_SIZE; i++) if (a[i] !== b[i]) { firstBDivergence = tick; break; }
    }
    const c = world.census();
    if (tick % SAMPLE_EVERY === 0 || c.extinctionTick === tick) samples.push(sample(world));
    if ((SNAPSHOT_TICKS as readonly number[]).includes(tick)) snapshots.push(snapshot(world));
    if ((REPLAY_TICKS as readonly number[]).includes(tick)) replayCensus.push(c);
    hashes.push(worldPhysicalHash(world));
    if ((REPLAY_TICKS as readonly number[]).includes(tick)) replayFrames.set(tick, runReplayFrame(world));
    previous = c; previousFields = world.fields;
    invariant(world.tick === tick, `${seed}/${condition.id}: clock failed to reach ${tick}`);
  }
  invariant(snapshots.map((s) => s.tick).join(',') === SNAPSHOT_TICKS.join(','), `${seed}/${condition.id}: snapshots incomplete`);
  invariant(replayCensus.length === REPLAY_TICKS.length, `${seed}/${condition.id}: replay census schedule must cover all exact replay frames`);
  const finalCensus = world.census(), finalState = snapshot(world);
  invariant(finalState.tick === MAX_TICK && same(snapshots.at(-1), finalState), `${seed}/${condition.id}: retained final snapshot mismatch`);
  invariant(finalCensus.extinctionTick === world.extinctionTick, `${seed}/${condition.id}: final extinction mismatch`);
  const sampledPeaks = samples.map((r) => r.census.biomass);
  const history = world.history;
  const summary = { extinctionTick: world.extinctionTick, survivalThrough6000: world.extinctionTick === null, sampledPeakBiomass: Math.max(...sampledPeaks),
    sampledPeakTick: samples.find((r) => r.census.biomass === Math.max(...sampledPeaks))?.tick ?? 0,
    endpointBiomass: finalCensus.biomass, endpointActiveCells: finalCensus.activeCells, firstPhysicalDivergence, firstBiomassDivergence: firstBDivergence,
    late5000To6000: lateSummary(history, finalCensus), replayFrames: replayFrames.size };
  return { seed, conditionId: condition.id, settings: { mode, current, maxTick: MAX_TICK, sampleEvery: SAMPLE_EVERY, snapshotTicks: [...SNAPSHOT_TICKS], comparisonEvery: COMPARE_EVERY },
    samples, snapshots, replayCensus, summary, _physicalHashes: hashes,
    _replayFrames: REPLAY_TICKS.map((t) => replayFrames.get(t)!) };
}

function buildArtifact(): { data: AnyRecord; replayBytes: Map<string, Buffer> } {
  invariant(process.versions.node === EXPECTED_NODE, `Evidence requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  const deadline = Date.now() + BATCH_LIMIT_MS;
  const frozen = sourceHashes();
  const runs: Run[] = [], originalMatches = new Set<number>();
  for (const seed of SEEDS) {
    const legacyClosed = new LegacyMatterWorld(seed, 'closed');
    const legacyRain = new LegacyMatterWorld(seed, 'rain');
    for (const condition of CURRENT_CONDITIONS) {
      const baseline = condition.current === 'off' ? (condition.mode === 'rain' ? legacyRain : legacyClosed) : new LegacyMatterWorld(seed, condition.mode as MatterMode);
      runs.push(runOne(seed, condition, baseline, originalMatches, deadline));
    }
    for (const current of ['off', 'circulating'] as const) {
      const closed = runs.find((r) => r.seed === seed && r.conditionId === `closed-${current === 'off' ? 'still' : 'current'}`)!;
      const rain = runs.find((r) => r.seed === seed && r.conditionId === `rain-${current === 'off' ? 'still' : 'current'}`)!;
      rain.summary.firstDivergenceRainVsClosed = firstDiff(closed._physicalHashes, rain._physicalHashes);
      closed.summary.firstDivergenceRainVsClosed = null;
    }
  }
  invariant(originalMatches.size === 6, `only ${originalMatches.size}/6 current-off/original long baseline comparisons passed`);
  invariant(Date.now() <= deadline, 'fixed pilot exceeded its 20-minute deadline after simulation');
  invariant(same(frozen, sourceHashes()), 'source freeze changed during batch; discard results and rerun');
  batchProgress = { phase: 'validation-and-replay-encoding', seed: null, conditionId: null, tick: MAX_TICK };
  const replay = makeReplayFiles(runs);
  const data = { schemaVersion: 1, sourceSha256: frozen, rules: RULES, runtime: { node: process.versions.node, platform: process.platform, arch: process.arch },
    conditions: CURRENT_CONDITIONS, seeds: [...SEEDS], maxTick: MAX_TICK, sampleEvery: SAMPLE_EVERY, snapshotTicks: [...SNAPSHOT_TICKS], comparisonEvery: COMPARE_EVERY,
    runs, replay: replay.replay };
  validateEvidenceStructure(data, replay.bytes);
  invariant(Date.now() <= deadline, 'fixed pilot exceeded its 20-minute deadline during evidence validation');
  invariant(Buffer.byteLength(JSON.stringify(data)) <= 16 * 1024 * 1024, 'JSON evidence exceeds 16 MiB budget');
  invariant([...replay.bytes.values()].reduce((n, b) => n + b.length, 0) <= 64 * 1024 * 1024, 'replay assets exceed 64 MiB budget');
  return { data, replayBytes: replay.bytes };
}

function validateCensus(c: AnyRecord, label: string): void {
  record(c, label); safe(c.tick, `${label}.tick`, 0, MAX_TICK);
  for (const k of ['nutrient','biomass','detritus','activeMatter','reservoir','sediment','initialTotal','initialNutrient','initialBiomass','initialDetritus','initialReservoir','activeCells','components','largestComponentCells', ...COUNTERS]) safe(c[k], `${label}.${k}`);
  invariant(c.residual === 0 && c.activeMatter === c.nutrient + c.biomass + c.detritus && c.sediment === 0 && c.buried === 0, `${label}: matter ledger mismatch`);
  invariant(c.reservoir === c.initialReservoir - c.imported && c.nutrient === c.initialNutrient + c.imported - c.growth + c.recycled &&
    c.biomass === c.initialBiomass + c.growth - c.mortality && c.detritus === c.initialDetritus + c.mortality - c.recycled, `${label}: pool identity mismatch`);
  invariant(c.mortality === c.routineDecay + c.thresholdLoss && (c.current === 'off' || c.current === 'circulating'), `${label}: census current malformed`);
  invariant(c.extinctionTick === null ? c.biomass > 0 : c.biomass === 0 && c.extinctionTick <= c.tick, `${label}: extinction mismatch`);
}
function validateEvidenceStructure(value: unknown, replayBytes?: Map<string, Buffer>, requireReplayFiles = false): void {
  record(value, 'current pilot'); const data = value;
  invariant(data.schemaVersion === 1 && same(data.rules, RULES) && same(data.conditions, CURRENT_CONDITIONS), 'schema, rules or ordered condition matrix mismatch');
  record(data.sourceSha256, 'source hashes');
  invariant(SOURCE_PATHS.every((p) => /^[a-f0-9]{64}$/.test(data.sourceSha256[p])) && Object.keys(data.sourceSha256).length === SOURCE_PATHS.length, 'source SHA-256 manifest malformed');
  record(data.runtime, 'runtime'); invariant(typeof data.runtime.node === 'string' && typeof data.runtime.platform === 'string' && typeof data.runtime.arch === 'string', 'runtime metadata malformed');
  invariant(same(data.seeds, SEEDS) && data.maxTick === MAX_TICK && data.sampleEvery === SAMPLE_EVERY && same(data.snapshotTicks, SNAPSHOT_TICKS) && data.comparisonEvery === COMPARE_EVERY, 'fixed pilot schedule mismatch');
  invariant(Array.isArray(data.runs) && data.runs.length === 12, 'run matrix must contain exactly 12 outcomes');
  const expectedKeys = SEEDS.flatMap((seed) => CURRENT_CONDITIONS.map((c) => `${seed}/${c.id}`));
  invariant(data.runs.map((r: AnyRecord) => `${r.seed}/${r.conditionId}`).join('|') === expectedKeys.join('|'), 'run matrix identity/order mismatch');
  for (const run of data.runs as Run[]) {
    const label = `${run.seed}/${run.conditionId}`;
    const condition = CURRENT_CONDITIONS[conditionIndex(run.conditionId)]!;
    invariant(same(run.settings, { mode: CURRENT_CONDITIONS[conditionIndex(run.conditionId)]!.mode, current: CURRENT_CONDITIONS[conditionIndex(run.conditionId)]!.current,
      maxTick: MAX_TICK, sampleEvery: SAMPLE_EVERY, snapshotTicks: [...SNAPSHOT_TICKS], comparisonEvery: COMPARE_EVERY }), `${label}: settings mismatch`);
    const ext = run.summary?.extinctionTick;
    invariant(Array.isArray(run.samples) && run.samples.length >= 121 && run.samples[0].tick === 0 && run.samples.at(-1).tick === MAX_TICK, `${label}: census sample schedule incomplete`);
    let prev: AnyRecord | null = null;
    for (const row of run.samples) {
      invariant(Number.isSafeInteger(row.tick) && row.census.tick === row.tick, `${label}: scheduled census tick mismatch`); validateCensus(row.census, `${label}@${row.tick}`);
      invariant(row.census.current === condition.current, `${label}@${row.tick}: current metadata mismatch`);
      const expectedImport = condition.mode === 'rain' ? Math.min(row.census.initialReservoir, 64 * Math.floor(row.tick / 8)) : 0;
      invariant(row.census.imported === expectedImport, `${label}@${row.tick}: rain schedule mismatch`);
      if (prev) {
        invariant(row.tick > prev.tick && row.census.reservoir <= prev.reservoir, `${label}: sample order/reservoir monotonicity mismatch`);
        for (const k of COUNTERS) invariant(row.census[k] >= prev[k], `${label}: sampled ${k} counter decreased`);
        if (prev.extinctionTick !== null) invariant(row.census.biomass === 0 && row.census.extinctionTick === prev.extinctionTick, `${label}: resurrection`);
      }
      prev = row.census;
    }
    const sampleTicks = run.samples.map((r: AnyRecord) => r.tick), expected = [0, ...Array.from({ length: 120 }, (_, i) => (i + 1) * 50)];
    if (ext !== null && ext % 50 !== 0 && ext !== 0) expected.push(ext);
    invariant(same(sampleTicks, [...new Set(expected)].sort((a,b)=>a-b)), `${label}: sample schedule differs from every 50 plus exact extinction`);
    invariant(Array.isArray(run.snapshots) && same(run.snapshots.map((s: AnyRecord) => s.tick), SNAPSHOT_TICKS), `${label}: required snapshots missing`);
    for (let j = 0; j < run.snapshots.length; j++) {
      const row = run.snapshots[j], t = SNAPSHOT_TICKS[j]!; record(row.state, `${label} snapshot ${t}`);
      invariant(row.tick === t && row.state.tick === t && row.state.seed === run.seed && row.state.mode === run.settings.mode && row.state.current === run.settings.current && same(row.state.rules, RULES), `${label}@${t}: snapshot identity mismatch`);
      invariant(row.state.fields?.nutrient?.length === MATTER_SIZE && row.state.fields?.biomass?.length === MATTER_SIZE && row.state.fields?.detritus?.length === MATTER_SIZE && row.state.fields?.phases?.length === MATTER_SIZE, `${label}@${t}: full fields missing`);
      for (let i = 0; i < MATTER_SIZE; i++) {
        invariant(Number.isSafeInteger(row.state.fields.nutrient[i]) && row.state.fields.nutrient[i] >= 0 && row.state.fields.nutrient[i] <= MATTER_MAX_TOTAL &&
          Number.isSafeInteger(row.state.fields.biomass[i]) && row.state.fields.biomass[i] >= 0 && row.state.fields.biomass[i] <= 64 &&
          Number.isSafeInteger(row.state.fields.detritus[i]) && row.state.fields.detritus[i] >= 0 && row.state.fields.detritus[i] <= MATTER_MAX_TOTAL &&
          Number.isInteger(row.state.fields.phases[i]) && row.state.fields.phases[i] >= 0 && row.state.fields.phases[i] <= 3, `${label}@${t}: snapshot field bound failed at ${i}`);
        if (t > 0) invariant(row.state.fields.biomass[i] === 0 || row.state.fields.biomass[i] >= 4, `${label}@${t}: subthreshold biomass at ${i}`);
      }
      const c = row.state.counters; invariant(c && c.circulated >= 0, `${label}@${t}: counters missing`);
      if (j > 0) invariant(same(run.snapshots[0].state.fields.phases, row.state.fields.phases), `${label}@${t}: phases changed`);
      const snapshotCensus = censusForSnapshot(row.state);
      validateCensus(snapshotCensus, `${label}@${t} snapshot ledger`);
      if (row.state.history?.some((h: AnyRecord) => h.tick === t)) {
        const h = row.state.history.find((h: AnyRecord) => h.tick === t);
        invariant(same(stripActivity(h), snapshotCensus), `${label}@${t}: snapshot history ledger mismatch`);
      }
    }
    invariant(Array.isArray(run.replayCensus) && run.replayCensus.length === REPLAY_TICKS.length && run.replayCensus.every((c: AnyRecord, i: number) => c.tick === REPLAY_TICKS[i]), `${label}: replay census ticks mismatch`);
    run.replayCensus.forEach((c: AnyRecord, i: number) => {
      validateCensus(c, `${label} replay census ${REPLAY_TICKS[i]}`);
      const s=run.samples.find((x: AnyRecord)=>x.tick===REPLAY_TICKS[i]);
      if (s) invariant(same(s.census,c), `${label}: replay census differs from sample at ${REPLAY_TICKS[i]}`);
    });
    const final = run.samples.at(-1).census;
    invariant(run.summary.extinctionTick === final.extinctionTick && run.summary.survivalThrough6000 === (final.extinctionTick === null) && run.summary.endpointBiomass === final.biomass && run.summary.endpointActiveCells === final.activeCells,
      `${label}: summary differs from final census`);
    const peak = run.samples.reduce((a: AnyRecord,b: AnyRecord)=>b.census.biomass>a.census.biomass?b:a,run.samples[0]);
    invariant(run.summary.sampledPeakBiomass === peak.census.biomass && run.summary.sampledPeakTick === peak.tick, `${label}: sampled peak summary mismatch`);
    const finalSnapshot = run.snapshots.at(-1).state;
    invariant(Array.isArray(finalSnapshot.history), `${label}: final observer history missing`);
    for (const h of finalSnapshot.history as AnyRecord[]) {
      const stored = run.samples.find((row: AnyRecord) => row.tick === h.tick);
      if (stored) invariant(same(stripActivity(h), stored.census), `${label}: final history differs from census sample at ${h.tick}`);
    }
    const lateTruth = lateSummary(finalSnapshot.history as MatterHistorySample[], final);
    invariant(same(run.summary.late5000To6000, lateTruth), `${label}: late activity summary differs from retained history: ${JSON.stringify({ expected: lateTruth, actual: run.summary.late5000To6000 })}`);
    invariant(run.summary.firstPhysicalDivergence === null || Number.isInteger(run.summary.firstPhysicalDivergence) && run.summary.firstPhysicalDivergence >= 4,
      `${label}: physical divergence precedes current onset`);
    invariant(run.summary.firstBiomassDivergence === null || Number.isInteger(run.summary.firstBiomassDivergence) &&
      run.summary.firstBiomassDivergence >= (run.summary.firstPhysicalDivergence ?? 0), `${label}: biomass divergence precedes physical divergence`);
    const rainVsClosed = run.settings.mode === 'rain';
    invariant(rainVsClosed
      ? Number.isInteger(run.summary.firstDivergenceRainVsClosed) && run.summary.firstDivergenceRainVsClosed >= 8
      : run.summary.firstDivergenceRainVsClosed === null, `${label}: rain/closed paired divergence mismatch`);
  }
  for (const seed of SEEDS) {
    const group = (data.runs as Run[]).filter((r) => r.seed === seed);
    const initial = group[0]!.snapshots[0].state;
    for (const run of group.slice(1)) {
      const other = run.snapshots[0].state;
      invariant(same(initial.fields, other.fields) && initial.reservoir === other.reservoir && initial.sediment === other.sediment &&
        initial.initialTotal === other.initialTotal && initial.initialNutrient === other.initialNutrient && initial.initialBiomass === other.initialBiomass &&
        initial.initialDetritus === other.initialDetritus && initial.initialReservoir === other.initialReservoir,
      `seed ${seed}: four conditions do not share one initial physical state`);
    }
  }
  validateReplayMeta(data.replay, replayBytes, data.runs, requireReplayFiles);
}
function censusForSnapshot(s: AnyRecord): AnyRecord {
  const f=s.fields,c=s.counters,n=sum(f.nutrient),b=sum(f.biomass),d=sum(f.detritus);
  const { components, largest } = componentStats(f.biomass);
  return { current:s.current,tick:s.tick,extinctionTick:s.extinctionTick,nutrient:n,biomass:b,detritus:d,activeMatter:n+b+d,reservoir:s.reservoir,sediment:s.sediment,
    initialTotal:s.initialTotal,initialNutrient:s.initialNutrient,initialBiomass:s.initialBiomass,initialDetritus:s.initialDetritus,initialReservoir:s.initialReservoir,
    residual:n+b+d+s.reservoir+s.sediment-s.initialTotal,activeCells:f.biomass.filter((v:number)=>v>=4).length,components,largestComponentCells:largest,...c };
}
function stripActivity(row: AnyRecord): AnyRecord { const c={...row}; delete c.intervalFromTick; delete c.intervalToTick; delete c.meanAbsBChange; delete c.maskFlipFraction; delete c.relaxedInterval; delete c.settledInterval; return c; }
function componentStats(b: readonly number[]): { components: number; largest: number } {
  const seen = new Uint8Array(MATTER_SIZE), queue = new Int32Array(MATTER_SIZE); let components = 0, largest = 0;
  for (let start = 0; start < MATTER_SIZE; start++) if (b[start]! >= 4 && !seen[start]) {
    components++; let head=0,tail=0,size=0; queue[tail++]=start;seen[start]=1;
    while(head<tail){const i=queue[head++]!,x=i%MATTER_WIDTH,y=Math.floor(i/MATTER_WIDTH);size++;
      const ns=[(x+1)%MATTER_WIDTH+y*MATTER_WIDTH,(x+MATTER_WIDTH-1)%MATTER_WIDTH+y*MATTER_WIDTH,...(y>0?[i-MATTER_WIDTH]:[]),...(y+1<MATTER_HEIGHT?[i+MATTER_WIDTH]:[])];
      for(const n of ns)if(b[n]!>=4&&!seen[n]){seen[n]=1;queue[tail++]=n;}}
    largest=Math.max(largest,size);
  }
  return {components,largest};
}
function validateReplayMeta(replay: AnyRecord, replayBytes?: Map<string, Buffer>, runs?: Run[], requireReplayFiles = false): void {
  record(replay, 'replay'); invariant(replay.schemaVersion===1 && replay.width===MATTER_WIDTH && replay.height===MATTER_HEIGHT && same(replay.conditions,CURRENT_CONDITIONS) && same(replay.ticks,REPLAY_TICKS), 'replay metadata matrix/ticks mismatch');
  invariant(Array.isArray(replay.seeds)&&replay.seeds.length===3, 'replay seed metadata incomplete');
  for(let i=0;i<SEEDS.length;i++) {
    const m=replay.seeds[i]; invariant(m.seed===SEEDS[i]&&m.file===`currents-replay-${SEEDS[i]}.replay`, 'replay seed/file order mismatch');
    safe(m.compressedBytes,'compressed size');safe(m.uncompressedBytes,'raw size');invariant(m.uncompressedBytes===MATTER_SIZE*3*REPLAY_TICKS.length*4*4, 'replay decoded size mismatch');
    invariant(/^[a-f0-9]{64}$/.test(m.sha256)&&/^[a-f0-9]{64}$/.test(m.compressedSha256), 'replay hashes malformed');
    let compressed = replayBytes?.get(m.file);
    if (!compressed) {
      const path=new URL(`../../docs/creative-prototypes/${m.file}`,import.meta.url);
      if (existsSync(path)) compressed=readFileSync(path);
      else invariant(!requireReplayFiles, `accepted replay asset missing: ${m.file}`);
    }
    if(compressed) {
      invariant(compressed.length===m.compressedBytes&&sha(compressed)===m.compressedSha256,'replay compressed bytes/hash mismatch');
      const raw=gunzipSync(compressed); invariant(raw.length===m.uncompressedBytes&&sha(raw)===m.sha256,'replay decompressed bytes/hash mismatch');
      invariant(runs, 'replay run records missing'); validateReplayAgainstRuns(raw, m.seed, runs, replay.ticks);
    }
  }
}
function validateReplayAgainstRuns(raw: Buffer, seed: number, runs: readonly Run[], ticks: readonly number[]): void {
  const frameBytes = MATTER_SIZE * 3 * 4;
  const selected = runs.filter((r) => r.seed === seed).sort((a, b) => conditionIndex(a.conditionId) - conditionIndex(b.conditionId));
  invariant(selected.length === 4, `decoded replay lacks four conditions for seed ${seed}`);
  for (let ci = 0; ci < selected.length; ci++) {
    const run = selected[ci]!;
    for (let fi = 0; fi < ticks.length; fi++) {
      const tick = ticks[fi]!, census = run.replayCensus[fi];
      let offset = (ci * ticks.length + fi) * frameBytes;
      const arrays: number[][] = [];
      for (const [field, censusKey] of [['nutrient','nutrient'],['biomass','biomass'],['detritus','detritus']] as const) {
        let total = 0; const values = new Array<number>(MATTER_SIZE);
        for (let i = 0; i < MATTER_SIZE; i++, offset += 4) { const value = raw.readUInt32LE(offset); values[i] = value; total += value; }
        invariant(total === census[censusKey], `decoded replay census mismatch at ${seed}/${run.conditionId}/${tick}/${field}`);
        arrays.push(values);
      }
      const retained = run.snapshots.find((s: AnyRecord) => s.tick === tick);
      if (retained) for (let i = 0; i < 3; i++) {
        const field = ['nutrient','biomass','detritus'][i]!;
        invariant(same(arrays[i], retained.state.fields[field]), `decoded replay field differs from snapshot at ${seed}/${run.conditionId}/${tick}/${field}`);
      }
    }
  }
}

function buildMarkdown(data: AnyRecord): string {
  const rows = data.runs.map((r: AnyRecord) => `| ${r.seed} | ${r.conditionId} | ${r.summary.extinctionTick ?? 'alive at 6000'} | ${r.summary.sampledPeakBiomass} @ ${r.summary.sampledPeakTick} | ${r.summary.endpointBiomass} / ${r.summary.endpointActiveCells} | ${r.summary.firstPhysicalDivergence ?? 'none'} | ${r.summary.firstBiomassDivergence ?? 'none'} | ${r.summary.firstDivergenceRainVsClosed ?? 'none'} | ${JSON.stringify(r.summary.late5000To6000.counterDeltas)} |`).join('\n');
  return `# Nutrient current pilot evidence\n\nGenerated fixed evidence from ${data.runtime.node} on ${data.runtime.platform}/${data.runtime.arch}. The engineered current permutes nutrient only every fourth tick on the fixed paired-column conveyor. Its circulated counter records total nutrient translated at each pulse; it is not net delivery. Rain is added before a same-tick current pulse. All four conditions share seeded initial stocks and phases, and all worlds continue through tick 6000 after extinction.\n\nThe batch retains three seeds and every outcome. Censuses are stored every 50 ticks plus exact extinction, snapshots at ${SNAPSHOT_TICKS.join(', ')}, and replay frames only at the exact ticks listed in JSON. No frame interpolation is used as physical evidence. Current-off worlds were compared against the original matter stepper through tick 6000 at every 100 ticks and at the endpoint. Repeated current-model states were compared in full at every 100 ticks and at the endpoint.\n\nSamples show sampled peak biomass and endpoint activity; late counter deltas are cumulative changes from tick 5000 through 6000. Biomass endpoint difference can hide turnover between observations. Nutrient unit-moves and translated nutrient units do not establish useful supply or growth. Rain exhausts at tick 4096 under the fixed source schedule. No survival benefit or adaptation claim is made.\n\n| Seed | Condition | Extinction | Sampled peak | Endpoint biomass / active cells | First physical divergence from still sibling | First biomass divergence | First rain/closed divergence | Late counter deltas (5000–6000) |\n|---:|---|---:|---:|---:|---:|---:|---:|---|\n${rows}\n\nReplay assets: ${data.replay.seeds.map((s: AnyRecord) => s.file).join(', ')}. Source SHA-256 values and replay asset hashes are in the JSON manifest. Run node tools/currents/explore.ts --check to verify the source freeze, matrix, snapshots, ledgers, summaries, replay hashes and this report. Run --replay-check to rerun the exact fixed batch and compare every retained outcome.\n`;
}
async function writeArtifact(): Promise<void> {
  const { data, replayBytes } = buildArtifact();
  invariant(same(sourceHashes(), data.sourceSha256), 'source freeze changed before writing');
  const jsonTmp = new URL('../../docs/creative-prototypes/current-pilot.json.tmp', import.meta.url), mdTmp = new URL('../../docs/creative-prototypes/current-pilot.md.tmp', import.meta.url);
  const writes: Promise<void>[] = [];
  for (const [name, bytes] of replayBytes) { const tmp = new URL(`../../docs/creative-prototypes/${name}.tmp`, import.meta.url); writes.push(writeFile(tmp, bytes).then(()=>rename(tmp,new URL(`../../docs/creative-prototypes/${name}`,import.meta.url)))); }
  await Promise.all(writes);
  await writeFile(jsonTmp, `${JSON.stringify(data)}\n`); await writeFile(mdTmp, buildMarkdown(data));
  await rename(jsonTmp, JSON_URL); await rename(mdTmp, MD_URL);
  process.stdout.write(`Wrote fixed current pilot evidence and ${replayBytes.size} deterministic replay assets.\n`);
}
async function writeFailureRecord(error: unknown): Promise<void> {
  const failure = { schemaVersion: 1, status: 'failed', sourceSha256: sourceHashes(), progress: batchProgress,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), recordedAt: new Date().toISOString() };
  const target = new URL('../../docs/creative-prototypes/current-pilot.failure.json', import.meta.url);
  const temporary = new URL('../../docs/creative-prototypes/current-pilot.failure.json.tmp', import.meta.url);
  await writeFile(temporary, `${JSON.stringify(failure, null, 2)}\n`); await rename(temporary, target);
}
async function checkArtifact(): Promise<void> {
  invariant(process.versions.node===EXPECTED_NODE,`Evidence check requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  const data=JSON.parse(await readFile(JSON_URL,'utf8')) as AnyRecord;
  invariant(same(data.runtime,{node:process.versions.node,platform:process.platform,arch:process.arch}),'runtime metadata mismatch');
  invariant(same(data.sourceSha256,sourceHashes()),'source hash mismatch; accepted evidence must be reviewed after source changes');
  validateEvidenceStructure(data, undefined, true);
  invariant(await readFile(MD_URL,'utf8')===buildMarkdown(data),'generated report differs from accepted JSON');
  process.stdout.write('Current evidence source freeze, matrix, ledgers, snapshots, summaries, replay hashes and report passed.\n');
}
async function replayCheck(): Promise<void> {
  invariant(process.versions.node===EXPECTED_NODE,`Replay check requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  const prior=JSON.parse(await readFile(JSON_URL,'utf8')) as AnyRecord, fresh=buildArtifact();
  invariant(same(prior,fresh.data),'full fixed-batch replay differs from accepted JSON');
  for(const [name,bytes] of fresh.replayBytes) invariant(sha(bytes)===prior.replay.seeds.find((s:AnyRecord)=>s.file===name)?.compressedSha256,`rerun replay asset differs: ${name}`);
  invariant(await readFile(MD_URL,'utf8')===buildMarkdown(fresh.data),'replayed report differs from accepted Markdown');
  process.stdout.write('All 12 fixed runs, repeated states, legacy baselines, replay censuses and compressed assets exactly match accepted evidence.\n');
}
export { buildMarkdown, lateSummary, validateEvidenceStructure, REPLAY_TICKS };
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const arg=process.argv[2];
  if(arg==='--write') { try { await writeArtifact(); } catch (error) { await writeFailureRecord(error); throw error; } }
  else if(arg==='--check') await checkArtifact(); else if(arg==='--replay-check') await replayCheck();
  else throw new Error('Usage: node tools/currents/explore.ts --write | --check | --replay-check');
}
