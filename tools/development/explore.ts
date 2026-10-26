#!/usr/bin/env node
/**
 * Fixed, replayable evidence for the inherited developmental-program pilot.
 * Run with Node 24.2.0: node tools/development/explore.ts --write
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createDevelopmentFixture,
  DevelopmentWorld,
  GENOME_PRESETS,
  RULES,
  type DevelopmentCensus,
  type DevelopmentOrganism,
  type DevelopmentSnapshot,
} from '../../apps/lab/src/development/model.ts';

const JSON_URL = new URL('../../docs/creative-prototypes/development-pilot.json', import.meta.url);
const MD_URL = new URL('../../docs/creative-prototypes/development-pilot.md', import.meta.url);
const SEEDS = [1201, 1202, 1203] as const;
const CONDITIONS = [false, true] as const;
const MAX_TICK = 3000;
const SAMPLE_EVERY = 20;
const SNAPSHOT_TICKS = [0, 1000, 2000, 3000] as const;
const EXPECTED_NODE = '24.2.0';
const MODEL_SOURCE = new URL('../../apps/lab/src/development/model.ts', import.meta.url);
const RUNNER_SOURCE = new URL('./explore.ts', import.meta.url);
const SOURCE_PATHS = ['apps/lab/src/development/model.ts', 'tools/development/explore.ts'] as const;
const GENOME_FIELDS = ['turnEvery', 'turn', 'branchEvery', 'maxCells'] as const;

type AnyRecord = Record<string, unknown>;
type RunCondition = { seed: number; mutation: boolean };
type EvidenceSample = {
  scheduledTick: number;
  actualTick: number;
  stateHash: string;
  census: DevelopmentCensus;
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sourceHashes(): Record<string, string> {
  return Object.fromEntries(SOURCE_PATHS.map((path, index) => {
    const url = index === 0 ? MODEL_SOURCE : RUNNER_SOURCE;
    const bytes = requireSource(url);
    return [path, createHash('sha256').update(bytes).digest('hex')];
  }));
}

// Source files are small; synchronous reads keep the hash capture atomic with
// respect to this process and avoid introducing asynchronous batch boundaries.
function requireSource(url: URL): Uint8Array {
  // `readFileSync` is loaded statically below through a local helper import.
  return readSource(url);
}

function readSource(url: URL): Uint8Array {
  return readFileSync(url);
}

function sameJSON(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function snapshotHash(world: DevelopmentWorld): string { return canonicalHash(world.snapshot()); }

function connected(organism: DevelopmentOrganism): boolean {
  if (organism.cells.length <= 1) return true;
  const tiles = new Set(organism.cells.map((cell) => cell.tile));
  if (tiles.size !== organism.cells.length) return false;
  const reached = new Set<number>([organism.cells[0]!.tile]);
  const pending = [organism.cells[0]!.tile];
  while (pending.length) {
    const tile = pending.pop()!;
    const x = tile % RULES.width;
    const y = Math.floor(tile / RULES.width);
    const neighbors = [
      (x + 1) % RULES.width + y * RULES.width,
      ((x + RULES.width - 1) % RULES.width) + y * RULES.width,
      x + ((y + 1) % RULES.height) * RULES.width,
      x + ((y + RULES.height - 1) % RULES.height) * RULES.width,
    ];
    for (const next of neighbors) if (tiles.has(next) && !reached.has(next)) { reached.add(next); pending.push(next); }
  }
  return reached.size === tiles.size;
}

function assertWorld(world: DevelopmentWorld, label: string): void {
  const organisms = world.organisms;
  const food = world.food;
  const occupancy = world.occupancy;
  invariant(Number.isSafeInteger(world.tick) && world.tick >= 0 && world.tick <= MAX_TICK, `${label}: invalid tick`);
  invariant(food.length === RULES.tileCount && [...food].every((value) => Number.isInteger(value) && value >= 0 && value <= RULES.maxFood), `${label}: food outside integer bounds at ${world.tick}`);
  invariant(occupancy.length === RULES.tileCount && [...occupancy].every((id) => Number.isInteger(id) && id >= 0), `${label}: invalid occupancy array at ${world.tick}`);
  invariant(organisms.length <= RULES.maxOrganisms, `${label}: population cap exceeded at ${world.tick}`);
  invariant(organisms.reduce((sum, organism) => sum + organism.cells.length, 0) <= RULES.maxOccupied, `${label}: occupied-cell cap exceeded at ${world.tick}`);
  const ids = new Set<number>();
  const seenTiles = new Set<number>();
  for (const organism of organisms) {
    invariant(Number.isSafeInteger(organism.id) && organism.id > 0 && !ids.has(organism.id), `${label}: invalid or duplicate organism ID at ${world.tick}`);
    ids.add(organism.id);
    invariant(organism.family >= 0 && organism.family <= 2 && Number.isInteger(organism.family), `${label}: invalid family at ${world.tick}`);
    invariant(Number.isSafeInteger(organism.generation) && organism.generation >= 0, `${label}: invalid generation at ${world.tick}`);
    invariant(organism.parentID === null || (Number.isSafeInteger(organism.parentID) && organism.parentID > 0), `${label}: invalid parent ID at ${world.tick}`);
    invariant(Number.isSafeInteger(organism.age) && organism.age >= 0 && organism.age < RULES.maxAge, `${label}: invalid age at ${world.tick}`);
    invariant(Number.isSafeInteger(organism.store) && organism.store >= 0 && organism.store <= RULES.storeCap, `${label}: invalid store at ${world.tick}`);
    invariant(Number.isSafeInteger(organism.births) && organism.births >= 0 &&
      Number.isSafeInteger(organism.growthCursor) && organism.growthCursor >= 0 && organism.growthCursor <= organism.growthQueue.length &&
      organism.growthQueue.length <= organism.cells.length * 3 &&
      organism.growthQueue.every((attempt) => Number.isSafeInteger(attempt.parentCell) && attempt.parentCell >= 0 && attempt.parentCell < organism.cells.length &&
        Number.isInteger(attempt.direction) && attempt.direction >= 0 && attempt.direction < 4), `${label}: invalid growth state at ${world.tick}`);
    invariant(organism.cells.length > 0 && organism.cells.length <= RULES.maxCellsPerOrganism && organism.cells.length <= organism.genome.maxCells, `${label}: body size out of bounds at ${world.tick}`);
    const genome = organism.genome;
    invariant(Object.keys(genome).sort().join(',') === 'branchEvery,maxCells,turn,turnEvery', `${label}: genome has unexpected fields at ${world.tick}`);
    invariant(Number.isInteger(genome.turnEvery) && genome.turnEvery >= 2 && genome.turnEvery <= 8 &&
      Number.isInteger(genome.turn) && genome.turn >= -1 && genome.turn <= 1 &&
      Number.isInteger(genome.branchEvery) && genome.branchEvery >= 2 && genome.branchEvery <= 6 &&
      Number.isInteger(genome.maxCells) && genome.maxCells >= 16 && genome.maxCells <= RULES.maxCellsPerOrganism,
    `${label}: genome outside integer bounds at ${world.tick}`);
    invariant(connected(organism), `${label}: disconnected body ${organism.id} at ${world.tick}`);
    for (const cell of organism.cells) {
      invariant(Number.isSafeInteger(cell.tile) && cell.tile >= 0 && cell.tile < RULES.tileCount &&
        Number.isInteger(cell.heading) && cell.heading >= 0 && cell.heading < 4 && Number.isSafeInteger(cell.depth) && cell.depth >= 0,
      `${label}: invalid body cell at ${world.tick}`);
      invariant(!seenTiles.has(cell.tile), `${label}: overlapping body cells at ${world.tick}`);
      seenTiles.add(cell.tile);
      invariant(occupancy[cell.tile] === organism.id, `${label}: occupancy does not match body ${organism.id} at ${world.tick}`);
    }
  }
  for (let tile = 0; tile < occupancy.length; tile++) {
    const id = occupancy[tile]!;
    invariant(id === 0 ? !seenTiles.has(tile) : ids.has(id) && seenTiles.has(tile), `${label}: occupancy references missing/incorrect body at ${world.tick}`);
  }
  const census = world.census();
  const ledger = world.ledger;
  invariant(census.population === organisms.length && census.cells === seenTiles.size, `${label}: census/body mismatch at ${world.tick}`);
  invariant(census.familyCounts.reduce((sum, value) => sum + value, 0) === census.population, `${label}: family counts mismatch at ${world.tick}`);
  invariant(Number.isSafeInteger(census.totalEnergy) && Number.isSafeInteger(ledger.actual) && Number.isSafeInteger(ledger.expected) &&
    Number.isSafeInteger(ledger.supplied) && Number.isSafeInteger(ledger.dissipated) && Number.isSafeInteger(ledger.deathLoss), `${label}: non-integer energy account at ${world.tick}`);
  invariant(ledger.residual === 0 && census.ledgerResidual === 0, `${label}: exact energy residual ${ledger.residual} at ${world.tick}`);
  invariant(Number.isSafeInteger(census.births) && Number.isSafeInteger(census.deaths) && Number.isSafeInteger(census.effectiveMutations) &&
    Number.isSafeInteger(census.growths) && Number.isSafeInteger(census.attemptedMutations) && Number.isSafeInteger(census.blockedBirths), `${label}: non-integer counter at ${world.tick}`);
  const counters = world.countersView;
  invariant(Object.values(counters).every((value) => Number.isSafeInteger(value) && value >= 0), `${label}: invalid cumulative counter at ${world.tick}`);
  validateLineage(world, label);
}

function normalizedFootprint(organism: DevelopmentOrganism): string {
  const root = organism.cells[0]!.tile;
  const rx = root % RULES.width;
  const ry = Math.floor(root / RULES.width);
  const offsets = organism.cells.map((cell) => {
    let dx = cell.tile % RULES.width - rx;
    let dy = Math.floor(cell.tile / RULES.width) - ry;
    if (dx > RULES.width / 2) dx -= RULES.width;
    if (dx < -RULES.width / 2) dx += RULES.width;
    if (dy > RULES.height / 2) dy -= RULES.height;
    if (dy < -RULES.height / 2) dy += RULES.height;
    return [dx, dy] as const;
  }).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return JSON.stringify(offsets);
}

function runAssay(): AnyRecord {
  const results = GENOME_PRESETS.map((genome, index) => {
    const world = createDevelopmentFixture({
      seed: 7100,
      mutation: false,
      food: RULES.maxFood,
      founders: [{ tile: 48 * RULES.width + 48, heading: 0, genome, age: 0, store: 24 }],
    });
    const trajectory: AnyRecord[] = [];
    let footprintAt144: string | null = null;
    let firstBirthTick: number | null = null;
    for (let tick = 0; tick <= 240; tick++) {
      if (tick > 0) world.step(1);
      assertWorld(world, `assay-${index}`);
      const founder = world.organisms.find((organism) => organism.id === 1);
      if (tick === 144 && founder) footprintAt144 = normalizedFootprint(founder);
      if (firstBirthTick === null && world.census().births > 0) firstBirthTick = tick;
      trajectory.push({ tick, population: world.census().population, cells: founder?.cells.length ?? 0,
        founderAge: founder?.age ?? null, births: world.census().births, ledgerResidual: world.census().ledgerResidual });
    }
    const maxFounderCells = Math.max(...trajectory.map((row) => row.cells as number));
    const result = { index, genome, foodPerTile: RULES.maxFood, seed: 7100, originTile: 48 * RULES.width + 48, heading: 0,
      trajectory, footprintAt144, firstBirthTick, maxFounderCells,
      passed: maxFounderCells >= 18 && firstBirthTick !== null && firstBirthTick <= 240 && footprintAt144 !== null };
    return result;
  });
  const uniqueFootprints = new Set(results.map((result) => result.footprintAt144));
  const passed = results.every((result) => result.passed) && uniqueFootprints.size === GENOME_PRESETS.length;
  return { foodPerTile: RULES.maxFood, seed: 7100, tickLimit: 240, footprintTick: 144, results, distinctFootprints: uniqueFootprints.size, passed };
}

function withoutMutationFlag(snapshot: DevelopmentSnapshot): AnyRecord {
  const copy = JSON.parse(JSON.stringify(snapshot)) as AnyRecord;
  delete copy.mutation;
  return copy;
}

function validateLineage(world: DevelopmentWorld, label: string): void {
  const nodes = world.lineage;
  const byID = new Map(nodes.map((node) => [node.id, node]));
  invariant(byID.size === nodes.length, `${label}: duplicate lineage node`);
  for (const node of nodes) {
    invariant(Number.isSafeInteger(node.id) && node.id > 0 && Number.isSafeInteger(node.generation) && node.generation >= 0 &&
      Number.isInteger(node.family) && node.family >= 0 && node.family <= 2 && Number.isSafeInteger(node.birthTick) && node.birthTick >= 0 && node.birthTick <= world.tick,
    `${label}: invalid lineage bounds for ${node.id}`);
    invariant(Number.isInteger(node.genome.turnEvery) && node.genome.turnEvery >= 2 && node.genome.turnEvery <= 8 &&
      Number.isInteger(node.genome.turn) && node.genome.turn >= -1 && node.genome.turn <= 1 &&
      Number.isInteger(node.genome.branchEvery) && node.genome.branchEvery >= 2 && node.genome.branchEvery <= 6 &&
      Number.isInteger(node.genome.maxCells) && node.genome.maxCells >= 16 && node.genome.maxCells <= RULES.maxCellsPerOrganism,
    `${label}: invalid lineage genome for ${node.id}`);
    invariant(node.deathTick === null || (Number.isSafeInteger(node.deathTick) && node.deathTick >= node.birthTick && node.deathTick <= world.tick),
      `${label}: invalid lineage death tick for ${node.id}`);
    invariant(node.deathTick === null ? node.deathCause === null : node.deathCause === 'starvation' || node.deathCause === 'age',
      `${label}: invalid lineage death cause for ${node.id}`);
    invariant(node.parentID === null || byID.has(node.parentID), `${label}: missing parent node for ${node.id}`);
    if (node.parentID === null) {
      invariant(node.generation === 0 && node.mutation === null, `${label}: founder lineage metadata is invalid`);
      continue;
    }
    const parent = byID.get(node.parentID)!;
    invariant(node.generation === parent.generation + 1 && node.family === parent.family, `${label}: parent link/family mismatch for ${node.id}`);
    const changed = GENOME_FIELDS.filter((field) => node.genome[field] !== parent.genome[field]);
    if (node.mutation === null) invariant(changed.length === 0, `${label}: child ${node.id} changed genome without a mutation record`);
    else {
      invariant(changed.length === 1 && changed[0] === node.mutation.field, `${label}: mutation field truth mismatch for ${node.id}`);
      invariant(node.mutation.from === parent.genome[node.mutation.field] && node.mutation.to === node.genome[node.mutation.field],
        `${label}: mutation values mismatch for ${node.id}`);
      invariant(node.mutation.to !== node.mutation.from, `${label}: neutral change marked effective for ${node.id}`);
    }
  }
}

function sample(world: DevelopmentWorld, scheduledTick: number): EvidenceSample {
  return { scheduledTick, actualTick: world.tick, stateHash: snapshotHash(world), census: world.census() };
}

function runCondition(condition: RunCondition): AnyRecord {
  const primary = new DevelopmentWorld(condition.seed, condition.mutation);
  const replay = new DevelopmentWorld(condition.seed, condition.mutation);
  invariant(snapshotHash(primary) === snapshotHash(replay), `Initial replay mismatch ${condition.seed}/${condition.mutation}`);
  const initialSnapshot = primary.snapshot();
  const samples: EvidenceSample[] = [sample(primary, 0)];
  const snapshots: AnyRecord[] = [{ scheduledTick: 0, actualTick: primary.tick, stateHash: snapshotHash(primary), state: initialSnapshot }];
  let previousExtinctionHash: string | null = null;
  let extinctionTick: number | null = null;
  for (let scheduledTick = 1; scheduledTick <= MAX_TICK; scheduledTick++) {
    if (primary.extinctionTick === null) primary.step(1);
    if (replay.extinctionTick === null) replay.step(1);
    assertWorld(primary, `run-${condition.seed}-${Number(condition.mutation)}`);
    assertWorld(replay, `replay-${condition.seed}-${Number(condition.mutation)}`);
    const primaryHash = snapshotHash(primary);
    const replayHash = snapshotHash(replay);
    invariant(primaryHash === replayHash, `Full-state replay mismatch ${condition.seed}/${condition.mutation} at ${scheduledTick}`);
    if (primary.extinctionTick !== null) {
      extinctionTick ??= primary.extinctionTick;
      invariant(primary.tick === extinctionTick && replay.tick === extinctionTick, `Extinct run clock moved ${condition.seed}/${condition.mutation}`);
      previousExtinctionHash ??= primaryHash;
      invariant(primaryHash === previousExtinctionHash && replayHash === previousExtinctionHash, `Extinct state changed after tick ${extinctionTick}`);
    } else invariant(primary.tick === scheduledTick && replay.tick === scheduledTick, `Live run failed to advance at ${scheduledTick}`);
    if (scheduledTick % SAMPLE_EVERY === 0 || primary.extinctionTick === scheduledTick) samples.push(sample(primary, scheduledTick));
    if ((SNAPSHOT_TICKS as readonly number[]).includes(scheduledTick)) {
      snapshots.push({ scheduledTick, actualTick: primary.tick, stateHash: primaryHash, state: primary.snapshot() });
    }
  }
  invariant(primary.tick === (extinctionTick ?? MAX_TICK), `Wrong final actual tick ${condition.seed}/${condition.mutation}`);
  invariant(snapshots.length === SNAPSHOT_TICKS.length, `Missing full snapshots for ${condition.seed}/${condition.mutation}`);
  validateLineage(primary, `run-${condition.seed}-${Number(condition.mutation)}`);
  const history = primary.history;
  const finalSnapshot = primary.snapshot();
  invariant(finalSnapshot.droppedLineage === 0 && finalSnapshot.droppedHistory === 0 && (history.length === Math.floor(MAX_TICK / SAMPLE_EVERY) + 1 || primary.extinctionTick !== null),
    `Unexpected history retention for ${condition.seed}/${condition.mutation}`);
  const births = primary.lineage.filter((node) => node.parentID !== null);
  const final = primary.census();
  return {
    seed: condition.seed,
    mutation: condition.mutation,
    outcome: extinctionTick === null ? 'alive-at-3000' : 'extinct',
    finalTick: primary.tick,
    extinctionTick,
    initialStateHash: canonicalHash(withoutMutationFlag(initialSnapshot)),
    finalStateHash: snapshotHash(primary),
    samples,
    snapshots,
    births,
    lineage: primary.lineage,
    history,
    droppedHistory: finalSnapshot.droppedHistory,
    droppedLineage: finalSnapshot.droppedLineage,
    finalCensus: final,
    finalLedger: primary.ledger,
    repeatVerified: true,
  };
}

function runBatch(): AnyRecord[] {
  const runs: AnyRecord[] = [];
  for (const seed of SEEDS) for (const mutation of CONDITIONS) runs.push(runCondition({ seed, mutation }));
  for (const seed of SEEDS) {
    const off = runs.find((run) => run.seed === seed && run.mutation === false)!;
    const on = runs.find((run) => run.seed === seed && run.mutation === true)!;
    invariant(off.initialStateHash === on.initialStateHash, `Shared initialization mismatch for seed ${seed}`);
    invariant((off.initialStateHash as string).length === 64, `Invalid normalized initial state hash for seed ${seed}`);
  }
  return runs;
}

function runtimeInfo(): AnyRecord {
  return { node: process.versions.node, platform: process.platform, arch: process.arch };
}

function buildArtifact(): AnyRecord {
  invariant(process.versions.node === EXPECTED_NODE, `Evidence requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  const capturedSources = sourceHashes();
  const assay = runAssay();
  invariant(JSON.stringify(sourceHashes()) === JSON.stringify(capturedSources), 'Evidence sources changed during assay; discard and rerun');
  const runs = assay.passed ? runBatch() : [];
  invariant(JSON.stringify(sourceHashes()) === JSON.stringify(capturedSources), 'Evidence sources changed during fixed batch; discard and rerun');
  return {
    schemaVersion: 1,
    pilot: 'developmental-programs-v1',
    batch: { seeds: [...SEEDS], mutation: [...CONDITIONS], maxTick: MAX_TICK, sampleEvery: SAMPLE_EVERY,
      snapshots: [...SNAPSHOT_TICKS], assayTickLimit: 240, assayFootprintTick: 144 },
    runtime: runtimeInfo(),
    rules: RULES,
    genomes: GENOME_PRESETS,
    sourceSha256: capturedSources,
    assay,
    runs,
    batchStatus: assay.passed ? 'complete' : 'stopped-after-assay-failure',
  };
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const matrix = [headers, ...rows];
  const widths = headers.map((_header, index) => Math.max(3, ...matrix.map((row) => (row[index] ?? '').length)));
  const render = (row: readonly string[]) => `| ${row.map((cell, index) => cell.padEnd(widths[index]!)).join(' | ')} |`;
  const header = render(headers);
  const separator = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
  const renderedRows = rows.map(render);
  for (const row of [header, separator, ...renderedRows]) {
    invariant(row.split('|').length - 2 === headers.length, 'Markdown table has an inconsistent column count');
    invariant(row.length === header.length, 'Markdown table column widths differ');
  }
  return [header, separator, ...renderedRows].join('\n');
}

function buildMarkdown(data: AnyRecord): string {
  const batch = data.batch as AnyRecord;
  const runtime = data.runtime as AnyRecord;
  const assay = data.assay as AnyRecord;
  const assayRows = (assay.results as AnyRecord[]).map((item) => [
    String(Number(item.index) + 1), Object.entries(item.genome as AnyRecord).map(([key, value]) => `${key}=${value}`).join(', '),
    String(item.maxFounderCells), item.firstBirthTick === null ? 'none' : String(item.firstBirthTick),
    item.passed ? 'pass' : 'fail',
  ]);
  const runRows = (data.runs as AnyRecord[]).map((run) => {
    const final = run.finalCensus as DevelopmentCensus;
    const mutationLabel = run.mutation ? 'on' : 'off';
    const outcome = run.extinctionTick === null ? 'alive at 3000' : `extinct at ${run.extinctionTick}`;
    return [String(run.seed), mutationLabel, outcome, String(final.births), String(final.effectiveMutations),
      String(final.population), String(final.cells), String(final.maxGeneration), String(final.ledgerResidual)];
  });
  const assayTable = table(['Program', 'Genome', 'Max cells by 240', 'First birth tick', 'Gate'], assayRows);
  const runsTable = table(['Seed', 'Mutation', 'Outcome', 'Births', 'Effective mutations', 'Population', 'Cells', 'Max generation', 'Ledger residual'], runRows);
  const complete = data.batchStatus === 'complete';
  const empty = (data.runs as unknown[]).length === 0;
  return `# Developmental programs pilot evidence\n\n` +
`Fixed descriptive evidence for the explicit inherited developmental toy, generated by Node ${runtime.node} on ${runtime.platform}/${runtime.arch}.\n\n` +
`## Method\n\n` +
`Before the fixed batch, the runner tests each supplied genome in the same single-founder fixture at tile ${48 * RULES.width + 48}, heading east, with food at ${RULES.maxFood} per tile. It records the founder's body size at every tick through 240, first birth tick, and normalized footprint at tick 144. The assay passes only when all three founders reach at least 18 cells, each gives birth by tick 240, and their tick-144 footprints are distinct. The assay checks that the specified ingredients operate; it does not test emergence or adaptation.\n\n` +
`The fixed batch is seeds ${(batch.seeds as number[]).join(', ')} crossed with mutation ${(batch.mutation as boolean[]).map((value: boolean) => value ? 'on' : 'off').join(' and ')} through ${batch.maxTick} scheduled ticks. Each condition is run with an independently initialized full repeat. Full snapshots are compared every live tick; snapshots are retained at scheduled ticks ${(batch.snapshots as number[]).join(', ')}. Every live tick checks integer bounds, body connectivity, unique occupancy, population/body caps, parent and genome mutation truth, no revival, and an exact zero energy-ledger residual. Census records are retained every ${batch.sampleEvery} ticks and at exact extinction. After extinction the comparison clock continues through the fixed horizon while the world state remains frozen.\n\n` +
`All six outcomes remain in the record. If all worlds are extinct before tick 500, the fixed slice stops at its specified horizon and is not extended or tuned. Parent ordering, age, and reproductive thresholds are engineered properties of this model.\n\n` +
`Source SHA-256 values were captured before the assay and verified again at the end. The JSON stores the exact rules, genome programs, runtime, all census rows, birth and lineage records, and complete milestone snapshots. No survival benefit or adaptation claim is made.\n\n` +
`## Ample-food assay\n\n` + assayTable + `\n\n` +
`Unique normalized footprints at tick 144: ${assay.distinctFootprints} of 3. Assay status: **${assay.passed ? 'pass' : 'fail'}**.\n\n` +
`## Fixed batch\n\n` + (empty ? `The batch did not run because the required pre-batch assay failed. All assay trajectories and failures are retained; no program was tuned.\n\n` :
`Retained ${((data.runs as unknown[]).length)} outcomes: ${(data.runs as AnyRecord[]).filter((run) => run.extinctionTick === null).length} alive at tick 3000 and ${(data.runs as AnyRecord[]).filter((run) => run.extinctionTick !== null).length} extinct. Batch status: **${complete ? 'complete' : String(data.batchStatus)}**.\n\n` + runsTable + `\n\n`) +
`## Interpretation limits\n\n` +
`This is a descriptive record of one engineered toy, three seeds, and two mutation settings. Connected bodies, growth, reproduction, inheritance, food supply, and mutation are explicit model mechanisms. The results do not show natural emergence, adaptation, selection benefit, or general survival. Differences between mutation settings are not a survival-benefit estimate. The age and size thresholds, growth queue, founder ordering, and cap create fixed demographic biases; those rules were not adjusted after seeing the batch.\n\n` +
`The fixed evidence is complete for its stated horizon. Verify accepted JSON and Markdown with --check; rerun and compare the full batch, including snapshots, with --replay-check.\n`;
}

async function writeEvidence(): Promise<void> {
  const data = buildArtifact();
  await writeFile(JSON_URL, `${JSON.stringify(data)}\n`);
  await writeFile(MD_URL, buildMarkdown(data));
  process.stdout.write(`Wrote developmental pilot JSON and Markdown (${(JSON.stringify(data).length / 1024 / 1024).toFixed(2)} MiB JSON).\n`);
}

async function checkEvidence(): Promise<void> {
  invariant(process.versions.node === EXPECTED_NODE, `Evidence check requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  const data = JSON.parse(await readFile(JSON_URL, 'utf8')) as AnyRecord;
  invariant(sameJSON(data.rules, RULES), 'Recorded rules differ from current model rules');
  invariant(sameJSON(data.genomes, GENOME_PRESETS), 'Recorded genome programs differ from current model programs');
  invariant(sameJSON(data.runtime, runtimeInfo()), 'Recorded runtime differs from current Node/platform');
  invariant(sameJSON(data.sourceSha256, sourceHashes()), 'Source hash mismatch; regenerate evidence after reviewing changed sources');
  invariant(sameJSON(data.batch, { seeds: [...SEEDS], mutation: [...CONDITIONS], maxTick: MAX_TICK, sampleEvery: SAMPLE_EVERY,
    snapshots: [...SNAPSHOT_TICKS], assayTickLimit: 240, assayFootprintTick: 144 }), 'Recorded batch settings differ');
  const assay = data.assay as AnyRecord;
  invariant((assay.results as unknown[]).length === 3 && typeof assay.passed === 'boolean', 'Malformed assay matrix');
  invariant(data.batchStatus === (assay.passed ? 'complete' : 'stopped-after-assay-failure'), 'Batch status conflicts with assay gate');
  invariant(assay.passed ? (data.runs as unknown[]).length === 6 : (data.runs as unknown[]).length === 0, 'Batch condition count conflicts with assay gate');
  for (const row of data.runs as AnyRecord[]) {
    invariant(row.repeatVerified === true && Array.isArray(row.samples) && Array.isArray(row.snapshots) && Array.isArray(row.births), `Incomplete run evidence ${row.seed}/${row.mutation}`);
    invariant((row.snapshots as AnyRecord[]).map((item) => item.scheduledTick).join(',') === SNAPSHOT_TICKS.join(','), `Missing milestone snapshot ${row.seed}/${row.mutation}`);
  }
  const markdown = await readFile(MD_URL, 'utf8');
  invariant(markdown === buildMarkdown(data), 'Markdown does not match accepted JSON evidence or table column widths');
  process.stdout.write('Evidence rules, settings, source hashes, full condition matrix, snapshot coverage, and exact Markdown checks passed.\n');
}

async function replayCheck(): Promise<void> {
  invariant(process.versions.node === EXPECTED_NODE, `Replay check requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  const prior = JSON.parse(await readFile(JSON_URL, 'utf8')) as AnyRecord;
  const current = buildArtifact();
  invariant(JSON.stringify(prior) === JSON.stringify(current), 'Full fixed-batch replay differs from accepted JSON evidence');
  invariant((await readFile(MD_URL, 'utf8')) === buildMarkdown(current), 'Regenerated Markdown differs from accepted evidence');
  process.stdout.write('Full assay and fixed-batch replay exactly match JSON and Markdown evidence.\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv[2];
  if (mode === '--write') await writeEvidence();
  else if (mode === '--check') await checkEvidence();
  else if (mode === '--replay-check') await replayCheck();
  else throw new Error('Usage: node tools/development/explore.ts --write | --check | --replay-check');
}
