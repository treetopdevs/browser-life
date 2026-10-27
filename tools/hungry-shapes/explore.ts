#!/usr/bin/env node
/**
 * Fixed, replayable evidence for the hungry-shapes food-allocation comparison.
 * Use nvm Node 24.2.0 on PATH: node tools/hungry-shapes/explore.ts --write --seed 1201
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  HungryWorld,
  RULES,
  type DevelopmentCensus,
  type DevelopmentOrganism,
  type DevelopmentSnapshot,
  type FoodMode,
} from '../../apps/lab/src/hungry-shapes/model.ts';

type AnyRecord = Record<string, any>;
type EvidenceSample = { scheduledTick: number; actualTick: number; stateHash: string; census: DevelopmentCensus; environment: AnyRecord };
type LateTick = { tick: number; population: number; births: number; deaths: number; cap48: boolean; nearCap47: boolean; blockedCap: number; blockedSpace: number };

export const MODES: readonly FoodMode[] = ['original', 'uniform', 'patches'];
export const MAX_TICK = 3000;
export const SAMPLE_EVERY = 20;
export const SNAPSHOT_TICKS = [0, 160, 500, 1500, 2500, 3000] as const;
export const LATE_START = 2501;
export const LATE_END = 3000;
export const LATE_DENOMINATOR = LATE_END - LATE_START + 1;
const EXPECTED_NODE = '24.2.0';
const BASELINE_SEEDS = [1201, 1202, 1203] as const;
const CENSUS_FIELDS = ['tick', 'population', 'cells', 'familyCounts', 'births', 'growths', 'deaths', 'effectiveMutations',
  'attemptedMutations', 'maxGeneration', 'totalCells', 'totalEnergy', 'meanBodyCells', 'meanEnergy', 'blockedBirths',
  'blockedSpaceBirths', 'blockedCapBirths', 'ledgerResidual', 'genomeVariantCount'] as const;
const COUNTER_FIELDS = ['births', 'growths', 'deaths', 'effectiveMutations', 'attemptedMutations', 'blockedSpaceBirths', 'blockedCapBirths'] as const;
const BASELINE_URL = new URL('../../docs/creative-prototypes/development-pilot.json', import.meta.url);
const JSON_URL = (seed: number) => new URL(`../../docs/creative-prototypes/hungry-shapes-seed-${seed}.json`, import.meta.url);
const MD_URL = (seed: number) => new URL(`../../docs/creative-prototypes/hungry-shapes-seed-${seed}.md`, import.meta.url);
const SOURCE_PATHS = [
  ['apps/lab/src/development/model.ts', new URL('../../apps/lab/src/development/model.ts', import.meta.url)],
  ['apps/lab/src/hungry-shapes/model.ts', new URL('../../apps/lab/src/hungry-shapes/model.ts', import.meta.url)],
  ['tools/hungry-shapes/explore.ts', new URL('./explore.ts', import.meta.url)],
] as const;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function artifactHash(data: AnyRecord): string {
  const withoutDigest = { ...data };
  delete withoutDigest.dataSha256;
  return canonicalHash(withoutDigest);
}

function sourceHashes(): Record<string, string> {
  return Object.fromEntries(SOURCE_PATHS.map(([path, url]) => [path, createHash('sha256').update(readFileSync(url)).digest('hex')]));
}

/** The disk identity at module load, before asynchronous CLI preflight starts. */
export const LOADED_SOURCE_SHA256 = Object.freeze(sourceHashes());

export function assertSourceIdentity(expected: Record<string, string>, current: Record<string, string> = sourceHashes()): void {
  invariant(sameJSON(expected, current), 'Evidence sources changed since the implementation was loaded; reload and rerun');
}

function assertLoadedSourceIdentity(): void { assertSourceIdentity(LOADED_SOURCE_SHA256); }

function sameJSON(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function record(value: unknown, label: string): asserts value is AnyRecord {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label}: expected object`);
}

function safeInteger(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number {
  invariant(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, `${label}: expected bounded integer`);
}

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

/** Full per-tick safety checks used before any evidence is accepted. */
export function assertWorld(world: HungryWorld, label = 'world'): void {
  const organisms = world.organisms;
  const food = world.food;
  const occupancy = world.occupancy;
  invariant(Number.isSafeInteger(world.tick) && world.tick >= 0 && world.tick <= MAX_TICK, `${label}: invalid tick`);
  invariant(food.length === RULES.tileCount && [...food].every((v) => Number.isInteger(v) && v >= 0 && v <= RULES.maxFood), `${label}: food out of bounds`);
  invariant(occupancy.length === RULES.tileCount && [...occupancy].every((id) => Number.isInteger(id) && id >= 0), `${label}: invalid occupancy`);
  invariant(organisms.length <= RULES.maxOrganisms, `${label}: population cap exceeded at ${world.tick}`);
  invariant(organisms.reduce((sum, organism) => sum + organism.cells.length, 0) <= RULES.maxOccupied, `${label}: occupied-cell cap exceeded at ${world.tick}`);
  const ids = new Set<number>();
  const seenTiles = new Set<number>();
  const lineage = new Map(world.lineage.map((node) => [node.id, node]));
  for (const organism of organisms) {
    invariant(Number.isSafeInteger(organism.id) && organism.id > 0 && !ids.has(organism.id), `${label}: invalid or duplicate ID`);
    ids.add(organism.id);
    safeInteger(organism.family, `${label}: family`, 0, 2);
    safeInteger(organism.generation, `${label}: generation`);
    invariant(organism.parentID === null || (Number.isSafeInteger(organism.parentID) && organism.parentID > 0), `${label}: invalid parent ID`);
    safeInteger(organism.age, `${label}: age`, 0, RULES.maxAge - 1);
    safeInteger(organism.store, `${label}: store`, 0, RULES.storeCap);
    safeInteger(organism.births, `${label}: births`);
    safeInteger(organism.genome.turnEvery, `${label}: turnEvery`, 2, 8);
    invariant(organism.genome.turn >= -1 && organism.genome.turn <= 1, `${label}: invalid turn gene`);
    safeInteger(organism.genome.branchEvery, `${label}: branchEvery`, 2, 6);
    safeInteger(organism.genome.maxCells, `${label}: maxCells`, 16, RULES.maxCellsPerOrganism);
    invariant(organism.cells.length > 0 && organism.cells.length <= RULES.maxCellsPerOrganism && organism.cells.length <= organism.genome.maxCells,
      `${label}: body size out of bounds`);
    invariant(Array.isArray(organism.growthQueue) && Number.isSafeInteger(organism.growthCursor) && organism.growthCursor >= 0 && organism.growthCursor <= organism.growthQueue.length &&
      organism.growthQueue.length <= organism.cells.length * 3 && organism.growthQueue.every((attempt: DevelopmentOrganism['growthQueue'][number]) =>
        Number.isSafeInteger(attempt.parentCell) && attempt.parentCell >= 0 && attempt.parentCell < organism.cells.length &&
        Number.isInteger(attempt.direction) && attempt.direction >= 0 && attempt.direction < RULES.directions), `${label}: invalid growth queue`);
    const node = lineage.get(organism.id);
    invariant(node && node.deathTick === null && node.parentID === organism.parentID && node.family === organism.family &&
      node.generation === organism.generation && sameJSON(node.genome, organism.genome), `${label}: living organism differs from lineage`);
    invariant(connected(organism), `${label}: disconnected body ${organism.id} at ${world.tick}`);
    for (const cell of organism.cells) {
      safeInteger(cell.tile, `${label}: cell tile`, 0, RULES.tileCount - 1);
      safeInteger(cell.heading, `${label}: heading`, 0, 3);
      safeInteger(cell.depth, `${label}: depth`);
      invariant(!seenTiles.has(cell.tile) && occupancy[cell.tile] === organism.id, `${label}: overlap or occupancy mismatch`);
      seenTiles.add(cell.tile);
    }
  }
  for (let tile = 0; tile < occupancy.length; tile++) {
    const id = occupancy[tile]!;
    invariant(id === 0 ? !seenTiles.has(tile) : ids.has(id) && seenTiles.has(tile), `${label}: occupancy points to no body`);
  }
  const census = world.census();
  const ledger = world.ledger;
  invariant(census.population === organisms.length && census.cells === seenTiles.size, `${label}: census/body mismatch`);
  invariant(census.familyCounts.reduce((sum, n) => sum + n, 0) === census.population, `${label}: family count mismatch`);
  invariant([census.totalEnergy, ledger.actual, ledger.expected, ledger.supplied, ledger.dissipated, ledger.deathLoss].every(Number.isSafeInteger), `${label}: non-integer energy account`);
  invariant(ledger.residual === 0 && census.ledgerResidual === 0, `${label}: nonzero energy residual`);
  invariant(Object.values(world.countersView).every((v) => Number.isSafeInteger(v) && v >= 0), `${label}: invalid counters`);
  const env = world.environment;
  invariant(env.accepted === ledger.supplied && env.offered === env.accepted + env.overflow, `${label}: food ledger identity mismatch`);
  const expectedPulses = Math.floor(world.tick / RULES.foodSupplyEvery);
  invariant(env.pulses === expectedPulses, `${label}: executed pulse count mismatch at ${world.tick}`);
  invariant(env.offered === env.pulses * env.pulseBudget, `${label}: offered food does not match executed pulse budget`);
  invariant(lineage.size === organisms.length + world.lineage.filter((node) => node.deathTick !== null).length &&
    world.lineage.filter((node) => node.deathTick === null).length === organisms.length, `${label}: live lineage IDs do not match organisms`);
  invariant(world.lineage.length <= RULES.maxLineage && world.snapshot().droppedLineage === 0 && world.snapshot().droppedHistory === 0, `${label}: dropped history or lineage`);
  validateLineage(world.lineage, world.tick, label);
}

function validateLineage(nodes: readonly DevelopmentSnapshot['lineage'][number][], tick: number, label: string): void {
  const byID = new Map(nodes.map((node) => [node.id, node]));
  invariant(byID.size === nodes.length, `${label}: duplicate lineage node`);
  for (const node of nodes) {
    safeInteger(node.id, `${label}: lineage ID`, 1);
    safeInteger(node.family, `${label}: lineage family`, 0, 2);
    safeInteger(node.generation, `${label}: lineage generation`);
    safeInteger(node.birthTick, `${label}: lineage birth tick`, 0, tick);
    safeInteger(node.genome.turnEvery, `${label}: lineage turnEvery`, 2, 8);
    invariant(node.genome.turn >= -1 && node.genome.turn <= 1, `${label}: lineage turn outside bounds`);
    safeInteger(node.genome.branchEvery, `${label}: lineage branchEvery`, 2, 6);
    safeInteger(node.genome.maxCells, `${label}: lineage maxCells`, 16, RULES.maxCellsPerOrganism);
    invariant(node.deathTick === null || Number.isSafeInteger(node.deathTick) && node.deathTick >= node.birthTick && node.deathTick <= tick,
      `${label}: invalid lineage death tick`);
    invariant(node.deathTick === null ? node.deathCause === null : node.deathCause === 'age' || node.deathCause === 'starvation', `${label}: invalid death cause`);
    if (node.parentID === null) invariant(node.generation === 0 && node.mutation === null && !node.parentRecordDropped, `${label}: invalid founder generation`);
    else {
      const parent = byID.get(node.parentID);
      invariant(parent !== undefined && !node.parentRecordDropped, `${label}: missing lineage parent ${node.parentID}`);
      invariant(node.generation === parent.generation + 1 && node.family === parent.family, `${label}: parent generation/family mismatch`);
      const changed = (['turnEvery', 'turn', 'branchEvery', 'maxCells'] as const).filter((field) => node.genome[field] !== parent.genome[field]);
      if (node.mutation === null) invariant(changed.length === 0, `${label}: genome changed without mutation record`);
      else invariant(changed.length === 1 && changed[0] === node.mutation.field &&
        node.mutation.from === parent.genome[node.mutation.field] && node.mutation.to === node.genome[node.mutation.field] &&
        node.mutation.from !== node.mutation.to, `${label}: mutation record does not match lineage genomes`);
    }
  }
}

function exactKeys(value: AnyRecord, expected: readonly string[], label: string): void {
  invariant(Object.keys(value).sort().join('|') === [...expected].sort().join('|'), `${label}: required fields mismatch`);
}

function validateCensusRow(value: unknown, label: string, maxTick: number): asserts value is DevelopmentCensus {
  record(value, label);
  exactKeys(value, CENSUS_FIELDS, label);
  safeInteger(value.tick, `${label}: tick`, 0, maxTick);
  safeInteger(value.population, `${label}: population`, 0, RULES.maxOrganisms);
  safeInteger(value.cells, `${label}: cells`, 0, RULES.maxOccupied);
  invariant(Array.isArray(value.familyCounts) && value.familyCounts.length === 3, `${label}: family counts missing`);
  value.familyCounts.forEach((count: unknown, index: number) => safeInteger(count, `${label}: family count ${index}`, 0, RULES.maxOrganisms));
  invariant(value.familyCounts.reduce((sum: number, count: number) => sum + count, 0) === value.population, `${label}: family counts do not sum to population`);
  for (const field of ['births', 'growths', 'deaths', 'effectiveMutations', 'attemptedMutations', 'maxGeneration', 'totalCells',
    'totalEnergy', 'blockedBirths', 'blockedSpaceBirths', 'blockedCapBirths', 'genomeVariantCount'] as const) {
    safeInteger(value[field], `${label}: ${field}`, 0);
  }
  safeInteger(value.totalCells, `${label}: totalCells`, 0, RULES.maxOccupied);
  safeInteger(value.genomeVariantCount, `${label}: genomeVariantCount`, 0, value.population);
  invariant(value.totalCells === value.cells && value.blockedBirths === value.blockedSpaceBirths + value.blockedCapBirths &&
    value.effectiveMutations <= value.attemptedMutations && value.effectiveMutations <= value.births,
  `${label}: census counters/aggregates inconsistent`);
  invariant(Number.isFinite(value.meanBodyCells) && value.meanBodyCells >= 0 && Number.isFinite(value.meanEnergy) && value.meanEnergy >= 0 &&
    value.meanBodyCells === (value.population ? value.cells / value.population : 0) &&
    value.meanEnergy === (value.population ? value.totalEnergy / value.population : 0), `${label}: invalid census means`);
  invariant(value.ledgerResidual === 0, `${label}: nonzero census ledger residual`);
}

function censusFromSnapshot(state: DevelopmentSnapshot): DevelopmentCensus {
  const familyCounts: [number, number, number] = [0, 0, 0];
  let cells = 0;
  let totalEnergy = 0;
  let maxGeneration = 0;
  const variants = new Set<string>();
  for (const organism of state.organisms) {
    familyCounts[organism.family]++;
    cells += organism.cells.length;
    totalEnergy += organism.store + RULES.structurePerCell * organism.cells.length;
    maxGeneration = Math.max(maxGeneration, organism.generation);
    variants.add(JSON.stringify([organism.genome.turnEvery, organism.genome.turn, organism.genome.branchEvery, organism.genome.maxCells]));
  }
  const counters = state.counters;
  return {
    tick: state.tick,
    population: state.organisms.length,
    cells,
    familyCounts,
    births: counters.births,
    growths: counters.growths,
    deaths: counters.deaths,
    effectiveMutations: counters.effectiveMutations,
    attemptedMutations: counters.attemptedMutations,
    maxGeneration,
    totalCells: cells,
    totalEnergy,
    meanBodyCells: state.organisms.length ? cells / state.organisms.length : 0,
    meanEnergy: state.organisms.length ? totalEnergy / state.organisms.length : 0,
    blockedBirths: counters.blockedSpaceBirths + counters.blockedCapBirths,
    blockedSpaceBirths: counters.blockedSpaceBirths,
    blockedCapBirths: counters.blockedCapBirths,
    ledgerResidual: state.ledger.residual,
    genomeVariantCount: variants.size,
  };
}

function validateRecordedSnapshot(value: unknown, expected: { seed: number; actualTick: number; extinctionTick: number | null }, label: string): asserts value is DevelopmentSnapshot {
  record(value, label);
  const state = value as unknown as DevelopmentSnapshot;
  const required = ['schemaVersion', 'description', 'runtime', 'rules', 'seed', 'mutation', 'tick', 'extinctionTick', 'food', 'occupancy',
    'organisms', 'ledger', 'counters', 'history', 'droppedHistory', 'lineage', 'droppedLineage'].sort();
  invariant(Object.keys(value).sort().join('|') === required.join('|'), `${label}: snapshot schema fields mismatch`);
  invariant(state.schemaVersion === 1 && state.description === 'observation only; not a resume checkpoint' &&
    state.runtime === `Node ${EXPECTED_NODE}` && sameJSON(state.rules, RULES), `${label}: snapshot metadata mismatch`);
  invariant(state.seed === expected.seed && state.mutation === true && state.tick === expected.actualTick &&
    state.extinctionTick === expected.extinctionTick, `${label}: snapshot identity/tick mismatch`);
  invariant(Array.isArray(state.food) && state.food.length === RULES.tileCount &&
    state.food.every((amount) => Number.isSafeInteger(amount) && amount >= 0 && amount <= RULES.maxFood), `${label}: invalid food array`);
  invariant(Array.isArray(state.occupancy) && state.occupancy.length === RULES.tileCount &&
    state.occupancy.every((id) => Number.isSafeInteger(id) && id >= 0), `${label}: invalid occupancy array`);
  invariant(Array.isArray(state.organisms) && state.organisms.length <= RULES.maxOrganisms, `${label}: invalid organism list`);
  invariant(Array.isArray(state.lineage), `${label}: lineage missing`);
  const byID = new Map(state.lineage.map((node) => [node.id, node]));
  const ids = new Set<number>();
  const tiles = new Set<number>();
  let occupiedCells = 0;
  for (const organism of state.organisms) {
    invariant(Number.isSafeInteger(organism.id) && organism.id > 0 && !ids.has(organism.id), `${label}: duplicate/invalid organism ID`);
    ids.add(organism.id);
    safeInteger(organism.family, `${label}: organism family`, 0, 2);
    safeInteger(organism.generation, `${label}: organism generation`);
    safeInteger(organism.age, `${label}: organism age`, 0, RULES.maxAge - 1);
    safeInteger(organism.store, `${label}: organism store`, 0, RULES.storeCap);
    invariant(organism.parentID === null || Number.isSafeInteger(organism.parentID) && organism.parentID > 0, `${label}: invalid organism parent ID`);
    safeInteger(organism.genome.turnEvery, `${label}: organism turnEvery`, 2, 8);
    invariant(organism.genome.turn >= -1 && organism.genome.turn <= 1, `${label}: organism turn outside bounds`);
    safeInteger(organism.genome.branchEvery, `${label}: organism branchEvery`, 2, 6);
    safeInteger(organism.genome.maxCells, `${label}: organism maxCells`, 16, RULES.maxCellsPerOrganism);
    invariant(Array.isArray(organism.cells) && organism.cells.length > 0 && organism.cells.length <= organism.genome.maxCells &&
      organism.cells.length <= RULES.maxCellsPerOrganism, `${label}: invalid organism cells`);
    safeInteger(organism.births, `${label}: organism births`);
    invariant(Array.isArray(organism.growthQueue) && Number.isSafeInteger(organism.growthCursor) && organism.growthCursor >= 0 && organism.growthCursor <= organism.growthQueue.length &&
      organism.growthQueue.length <= organism.cells.length * 3 && organism.growthQueue.every((attempt: DevelopmentOrganism['growthQueue'][number]) =>
        Number.isSafeInteger(attempt.parentCell) && attempt.parentCell >= 0 && attempt.parentCell < organism.cells.length &&
        Number.isInteger(attempt.direction) && attempt.direction >= 0 && attempt.direction < RULES.directions), `${label}: invalid snapshot growth queue`);
    invariant(connected(organism), `${label}: disconnected organism ${organism.id}`);
    const node = byID.get(organism.id);
    invariant(node && node.deathTick === null && node.parentID === organism.parentID && node.family === organism.family &&
      node.generation === organism.generation && sameJSON(node.genome, organism.genome), `${label}: organism/lineage mismatch`);
    for (const cell of organism.cells) {
      safeInteger(cell.tile, `${label}: cell tile`, 0, RULES.tileCount - 1);
      safeInteger(cell.heading, `${label}: cell heading`, 0, 3);
      safeInteger(cell.depth, `${label}: cell depth`);
      invariant(!tiles.has(cell.tile) && state.occupancy[cell.tile] === organism.id, `${label}: overlapping cell or occupancy mismatch`);
      tiles.add(cell.tile);
    }
    occupiedCells += organism.cells.length;
  }
  invariant(occupiedCells <= RULES.maxOccupied, `${label}: occupied-cell cap exceeded`);
  for (let tile = 0; tile < state.occupancy.length; tile++) {
    const id = state.occupancy[tile]!;
    invariant(id === 0 ? !tiles.has(tile) : ids.has(id) && tiles.has(tile), `${label}: occupancy references no cell`);
  }
  validateLineage(state.lineage, state.tick, label);
  invariant(state.lineage.filter((node) => node.deathTick === null).length === ids.size &&
    state.lineage.every((node) => node.deathTick !== null || ids.has(node.id)), `${label}: live lineage/body mismatch`);
  invariant(state.droppedHistory === 0 && state.droppedLineage === 0, `${label}: dropped records`);
  const counters = state.counters;
  record(counters, `${label}: counters`);
  exactKeys(counters, COUNTER_FIELDS, `${label}: counters`);
  invariant(Object.values(counters).every((n) => Number.isSafeInteger(n) && n >= 0), `${label}: invalid counters`);
  invariant(counters.births === state.lineage.filter((node) => node.parentID !== null).length &&
    counters.deaths === state.lineage.filter((node) => node.deathTick !== null).length &&
    counters.effectiveMutations === state.lineage.filter((node) => node.mutation !== null).length, `${label}: counters disagree with lineage`);
  record(state.ledger, `${label}: ledger`);
  const foodTotal = state.food.reduce((sum, amount) => sum + amount, 0);
  const bodyEnergy = state.organisms.reduce((sum, organism) => sum + organism.store + RULES.structurePerCell * organism.cells.length, 0);
  const expectedEnergy = state.ledger.initialEnergy + state.ledger.supplied - state.ledger.dissipated - state.ledger.deathLoss;
  invariant([state.ledger.initialEnergy, state.ledger.supplied, state.ledger.dissipated, state.ledger.deathLoss, state.ledger.expected,
    state.ledger.actual, state.ledger.residual].every(Number.isSafeInteger) &&
    [state.ledger.initialEnergy, state.ledger.supplied, state.ledger.dissipated, state.ledger.deathLoss, state.ledger.expected, state.ledger.actual].every((n) => n >= 0) &&
    state.ledger.actual === foodTotal + bodyEnergy &&
    state.ledger.expected === expectedEnergy && state.ledger.residual === state.ledger.actual - state.ledger.expected && state.ledger.residual === 0,
  `${label}: energy ledger does not reconcile`);
  const historyTicks = [0];
  for (let tick = RULES.historyEvery; tick <= state.tick; tick += RULES.historyEvery) historyTicks.push(tick);
  if (state.extinctionTick !== null && !historyTicks.includes(state.extinctionTick)) historyTicks.push(state.extinctionTick);
  historyTicks.sort((a, b) => a - b);
  invariant(Array.isArray(state.history) && state.history.map((row) => row.tick).join(',') === historyTicks.join(','), `${label}: history tick schedule mismatch`);
  for (const row of state.history) validateCensusRow(row, `${label}: history ${row.tick}`, state.tick);
  invariant(sameJSON(state.history.at(-1), censusFromSnapshot(state)), `${label}: final history census mismatch`);
}

function sample(world: HungryWorld, scheduledTick: number): EvidenceSample {
  const state = world.snapshot();
  const environment = world.environment;
  return { scheduledTick, actualTick: world.tick, stateHash: canonicalHash({ state, environment }), census: world.census(), environment };
}

function lateTick(world: HungryWorld, previous: DevelopmentCensus, census: DevelopmentCensus): LateTick {
  return {
    tick: census.tick,
    population: census.population,
    births: census.births - previous.births,
    deaths: census.deaths - previous.deaths,
    cap48: census.population === RULES.maxOrganisms,
    nearCap47: census.population >= RULES.maxOrganisms - 1,
    blockedCap: census.blockedCapBirths - previous.blockedCapBirths,
    blockedSpace: census.blockedSpaceBirths - previous.blockedSpaceBirths,
  };
}

function runMode(seed: number, mode: FoodMode): AnyRecord {
  const primary = new HungryWorld(seed, true, mode);
  const replay = new HungryWorld(seed, true, mode);
  invariant(sameJSON(primary.snapshot(), replay.snapshot()), `${mode}: independent initial states differ`);
  const initialSnapshot = primary.snapshot();
  const samples: EvidenceSample[] = [sample(primary, 0)];
  const snapshots: AnyRecord[] = [{ scheduledTick: 0, actualTick: 0, stateHash: samples[0]!.stateHash,
    environment: primary.environment, state: initialSnapshot }];
  const baselineCheckpoints: AnyRecord[] = [];
  const baselineRun = mode === 'original' ? baselineForSeed(seed) : null;
  if (baselineRun) {
    const baselineHistory = new Map((baselineRun.history as DevelopmentCensus[]).map((row) => [row.tick, row]));
    invariant(sameJSON(primary.census(), baselineHistory.get(0)), `Original mode differs from retained development census at tick 0`);
    const oldInitial = baselineRun.snapshots.find((row: AnyRecord) => row.scheduledTick === 0);
    invariant(oldInitial && sameJSON(initialSnapshot, oldInitial.state), 'Original mode differs from retained development snapshot at tick 0');
    baselineCheckpoints.push({ tick: 0, state: initialSnapshot });
  }
  const lateTicks: LateTick[] = [];
  let previousPrimary = primary.census();
  let previousExtinctHash: string | null = null;
  let extinctionTick: number | null = null;
  let aliveAt2500: DevelopmentCensus | null = primary.tick === 2500 ? primary.census() : null;

  for (let scheduledTick = 1; scheduledTick <= MAX_TICK; scheduledTick++) {
    if (primary.extinctionTick === null) primary.step(1);
    if (replay.extinctionTick === null) replay.step(1);
    assertWorld(primary, `${mode}-primary`);
    assertWorld(replay, `${mode}-replay`);
    const census = primary.census();
    const replayCensus = replay.census();
    invariant(primary.tick === replay.tick && sameJSON(census, replayCensus) && sameJSON(primary.environment, replay.environment),
      `${mode}: repeat census/environment mismatch at scheduled tick ${scheduledTick}`);
    invariant(primary.extinctionTick === replay.extinctionTick, `${mode}: repeat extinction mismatch`);
    if (baselineRun && scheduledTick % SAMPLE_EVERY === 0) {
      const oldCensus = (baselineRun.history as DevelopmentCensus[]).find((row) => row.tick === scheduledTick);
      invariant(oldCensus && sameJSON(census, oldCensus), `Original mode differs from retained development census at tick ${scheduledTick}`);
    }
    if (baselineRun && [1000, 2000, 3000].includes(scheduledTick)) {
      const expected = (baselineRun.snapshots as AnyRecord[]).find((row) => row.scheduledTick === scheduledTick);
      const actual = primary.snapshot();
      invariant(expected && sameJSON(actual, expected.state), `Original mode differs from retained development pilot at tick ${scheduledTick}`);
      baselineCheckpoints.push({ tick: scheduledTick, state: actual });
    }
    if (primary.extinctionTick !== null) {
      extinctionTick ??= primary.extinctionTick;
      invariant(primary.tick === extinctionTick && replay.tick === extinctionTick, `${mode}: extinct clock advanced`);
      const hash = canonicalHash({ state: primary.snapshot(), environment: primary.environment });
      previousExtinctHash ??= hash;
      invariant(hash === previousExtinctHash, `${mode}: extinct world changed after tick ${extinctionTick}`);
    } else invariant(primary.tick === scheduledTick && replay.tick === scheduledTick, `${mode}: live world failed to advance`);
    if (scheduledTick === 2500 && primary.extinctionTick === null) aliveAt2500 = census;
    if (primary.tick >= LATE_START && primary.tick <= LATE_END && primary.tick === scheduledTick) lateTicks.push(lateTick(primary, previousPrimary, census));
    if (primary.tick !== previousPrimary.tick) {
      previousPrimary = census;
      if (scheduledTick % SAMPLE_EVERY === 0 || primary.extinctionTick === scheduledTick) samples.push(sample(primary, scheduledTick));
      if ((SNAPSHOT_TICKS as readonly number[]).includes(scheduledTick) && primary.extinctionTick !== scheduledTick) {
        const state = primary.snapshot();
        snapshots.push({ scheduledTick, actualTick: primary.tick, stateHash: canonicalHash({ state, environment: primary.environment }),
          environment: primary.environment, state });
      }
      if (primary.extinctionTick === scheduledTick) {
        const state = primary.snapshot();
        snapshots.push({ scheduledTick: null, actualTick: primary.tick, terminal: true,
          stateHash: canonicalHash({ state, environment: primary.environment }), environment: primary.environment, state });
      }
      if (scheduledTick === 2500 && primary.extinctionTick === scheduledTick) aliveAt2500 = census;
    }
    // Compare complete repeat outputs at retained checkpoints only. The full
    // per-tick state is still checked for invariants on both independent runs.
    if (primary.tick === scheduledTick && (scheduledTick % SAMPLE_EVERY === 0 || (SNAPSHOT_TICKS as readonly number[]).includes(scheduledTick))) {
      invariant(sameJSON(primary.snapshot(), replay.snapshot()), `${mode}: repeat full state mismatch at ${scheduledTick}`);
    }
  }

  const finalState = primary.snapshot();
  const replayState = replay.snapshot();
  invariant(sameJSON(finalState, replayState) && sameJSON(primary.environment, replay.environment), `${mode}: final independent state/accounting differs`);
  invariant(primary.tick === (extinctionTick ?? MAX_TICK), `${mode}: final actual tick mismatch`);
  const finalCensus = primary.census();
  const startBirths = aliveAt2500?.births ?? 0;
  const lateSummary = {
    fromTick: LATE_START,
    toTick: LATE_END,
    denominatorTicks: LATE_DENOMINATOR,
    executedTicks: lateTicks.length,
    births: extinctionTick !== null && extinctionTick < LATE_START ? 0 : finalCensus.births - startBirths,
    deaths: lateTicks.reduce((sum, row) => sum + row.deaths, 0),
    cap48Ticks: lateTicks.filter((row) => row.cap48).length,
    nearCap47Ticks: lateTicks.filter((row) => row.nearCap47).length,
    capBlockedTicks: lateTicks.filter((row) => row.blockedCap > 0).length,
    capBlockedAttempts: lateTicks.reduce((sum, row) => sum + row.blockedCap, 0),
    spaceBlockedAttempts: lateTicks.reduce((sum, row) => sum + row.blockedSpace, 0),
    cap48FractionOfFixedWindow: lateTicks.filter((row) => row.cap48).length / LATE_DENOMINATOR,
  };
  const lineage = primary.lineage;
  const deathsByCause = { age: lineage.filter((node) => node.deathCause === 'age').length,
    starvation: lineage.filter((node) => node.deathCause === 'starvation').length };
  return {
    seed, mode, mutation: true,
    outcome: extinctionTick === null ? 'alive-at-3000' : 'extinct',
    finalTick: primary.tick,
    extinctionTick,
    initialStateHash: canonicalHash(initialSnapshot),
    finalStateHash: canonicalHash({ state: finalState, environment: primary.environment }),
    samples, snapshots, lateTicks, lateSummary,
    lineage,
    maxEverGeneration: Math.max(0, ...lineage.map((node) => node.generation)),
    deathsByCause,
    finalCensus,
    finalLedger: primary.ledger,
    finalEnvironment: primary.environment,
    repeatVerified: true,
    baselineCheckpoints,
  };
}

function runtimeInfo(): AnyRecord { return { node: process.versions.node, platform: process.platform, arch: process.arch }; }

function baselineForSeed(seed: number): AnyRecord | null {
  const baseline = JSON.parse(readFileSync(BASELINE_URL, 'utf8')) as AnyRecord;
  const prior = baseline.runs.find((run: AnyRecord) => run.seed === seed && run.mutation === true);
  invariant(prior !== undefined || !BASELINE_SEEDS.includes(seed as typeof BASELINE_SEEDS[number]),
    `Retained development baseline is missing seed ${seed}`);
  return prior ?? null;
}

export function buildArtifact(seed: number): AnyRecord {
  assertLoadedSourceIdentity();
  invariant(process.versions.node === EXPECTED_NODE, `Evidence requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  safeInteger(seed, 'seed', 1, 0x7fffffff);
  const runs = MODES.map((mode) => runMode(seed, mode));
  delete runs[0]!.baselineCheckpoints;
  const data: AnyRecord = {
    schemaVersion: 1,
    pilot: 'hungry-shapes-v1',
    batch: { seed, modes: [...MODES], mutation: true, maxTick: MAX_TICK, sampleEvery: SAMPLE_EVERY,
      snapshotTicks: [...SNAPSHOT_TICKS], lateWindow: { from: LATE_START, to: LATE_END, denominatorTicks: LATE_DENOMINATOR } },
    runtime: runtimeInfo(),
    rules: RULES,
    sourceSha256: LOADED_SOURCE_SHA256,
    runs,
  };
  data.dataSha256 = artifactHash(data);
  validateEvidenceStructure(data);
  assertLoadedSourceIdentity();
  return data;
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const matrix = [headers, ...rows];
  const widths = headers.map((_h, index) => Math.max(3, ...matrix.map((row) => (row[index] ?? '').length)));
  const render = (row: readonly string[]) => `| ${row.map((cell, index) => cell.padEnd(widths[index]!)).join(' | ')} |`;
  return [render(headers), `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`, ...rows.map(render)].join('\n');
}

export function buildMarkdown(data: AnyRecord): string {
  const rows = (data.runs as AnyRecord[]).map((run) => [run.mode, run.outcome, String(run.finalTick),
    String(run.finalCensus.population), String(run.finalCensus.cells), String(run.maxEverGeneration), String(run.lateSummary.births),
    String(run.lateSummary.cap48Ticks), `${(run.lateSummary.cap48FractionOfFixedWindow * 100).toFixed(1)}%`,
    String(run.lateSummary.nearCap47Ticks), String(run.lateSummary.capBlockedAttempts),
    String(run.lateSummary.spaceBlockedAttempts), String(run.deathsByCause.starvation), String(run.deathsByCause.age),
    String(run.finalEnvironment.offered), String(run.finalEnvironment.accepted), String(run.finalEnvironment.overflow), String(run.finalLedger.residual)]);
  return `# Hungry shapes pilot evidence\n\n` +
    `Fixed descriptive evidence for seed ${data.batch.seed}, mutation on, generated by Node ${data.runtime.node} on ${data.runtime.platform}/${data.runtime.arch}.\n\n` +
    `The three worlds share founder setup and initial food. Scarce modes offer 768 food units per five-tick pulse; original mode keeps its existing supply. Pulse 0 executes at tick 5 before feeding. Offered food is budget times executed pulses; overflow is not deferred. Worlds stop advancing at extinction.\n\n` +
    `Censuses are retained every 20 actual ticks and at extinction. Full states are retained at milestone ticks while alive, plus the terminal state at its actual tick. Per-tick late-window rows are retained only for executed ticks 2501–3000; the cap fraction uses a fixed 500-tick denominator with post-extinction ticks counted as zero cap occupancy.\n\n` +
    `Each mode was run from two independent initializations. Full state, census, and food accounting match at every retained census/milestone and at the end. Both runs received per-tick safety validation for body connectivity, occupancy, caps, integer bounds, lineage, energy conservation, and food accounting. Original mode is checked against the retained development pilot at ticks 0, 1000, 2000, and 3000 when that seed is available.\n\n` +
    `The visual comparison is a manual parent decision using fixed-camera frames at 500, 1500, 3000 (or actual terminal tick), checking occupied space, patch-mask occupancy, clusters/separated bodies, and gaps. This artifact does not automatically promote or extend any condition.\n\n` +
    `## Outcomes\n\n` + table(['Mode', 'Outcome', 'End tick', 'Population', 'Cells', 'Max generation', 'Late births', 'Cap48 ticks', 'Cap48% fixed window', 'Near-cap47 ticks', 'Cap-blocked attempts', 'Space-blocked attempts', 'Starvation deaths', 'Age deaths', 'Offered', 'Accepted', 'Overflow', 'Ledger residual'], rows) +
    `\n\nAll outcomes are descriptive for this seed and engineered rules. Food placement is deliberately founder-centered in patches; it is not discovered by the organisms. Retain failures and do not infer adaptation or a general survival benefit.\n`;
}

function validateLateTicks(run: AnyRecord, label: string): void {
  invariant(Array.isArray(run.lateTicks), `${label}: late per-tick records missing`);
  const ticks = run.lateTicks as LateTick[];
  const expected = run.extinctionTick === null ? LATE_DENOMINATOR : Math.max(0, Math.min(LATE_END, run.extinctionTick) - LATE_START + 1);
  invariant(ticks.length === expected, `${label}: late-tick record count mismatch`);
  invariant(ticks.every((row, i) => row.tick === LATE_START + i && row.tick <= run.finalTick && Number.isSafeInteger(row.population) &&
    Number.isSafeInteger(row.births) && row.births >= 0 && Number.isSafeInteger(row.deaths) && row.deaths >= 0 &&
    Number.isSafeInteger(row.blockedCap) && row.blockedCap >= 0 && Number.isSafeInteger(row.blockedSpace) && row.blockedSpace >= 0 &&
    row.cap48 === (row.population === RULES.maxOrganisms) && row.nearCap47 === (row.population >= RULES.maxOrganisms - 1)), `${label}: invalid late-tick observation`);
  const summary = run.lateSummary;
  invariant(summary.denominatorTicks === LATE_DENOMINATOR && summary.executedTicks === ticks.length &&
    summary.cap48Ticks === ticks.filter((row) => row.cap48).length && summary.nearCap47Ticks === ticks.filter((row) => row.nearCap47).length &&
    summary.capBlockedTicks === ticks.filter((row) => row.blockedCap > 0).length && summary.capBlockedAttempts === ticks.reduce((n, row) => n + row.blockedCap, 0) &&
    summary.spaceBlockedAttempts === ticks.reduce((n, row) => n + row.blockedSpace, 0) &&
    summary.cap48FractionOfFixedWindow === summary.cap48Ticks / LATE_DENOMINATOR, `${label}: late summary differs from retained rows`);
  const start = (run.samples as EvidenceSample[]).find((row) => row.actualTick === 2500);
  const expectedBirths = run.extinctionTick !== null && run.extinctionTick < LATE_START ? 0 : run.finalCensus.births - (start?.census.births ?? 0);
  invariant(summary.births === expectedBirths && summary.births === ticks.reduce((sum, row) => sum + row.births, 0) &&
    summary.deaths === ticks.reduce((sum, row) => sum + row.deaths, 0),
    `${label}: late birth/death totals differ from retained samples`);
}

export function validateEvidenceStructure(value: unknown, sources?: Record<string, string>): asserts value is AnyRecord {
  record(value, 'evidence');
  invariant(value.schemaVersion === 1 && value.pilot === 'hungry-shapes-v1', 'unsupported evidence schema');
  invariant(sameJSON(value.batch, { seed: value.batch.seed, modes: [...MODES], mutation: true, maxTick: MAX_TICK, sampleEvery: SAMPLE_EVERY,
    snapshotTicks: [...SNAPSHOT_TICKS], lateWindow: { from: LATE_START, to: LATE_END, denominatorTicks: LATE_DENOMINATOR } }), 'batch settings or mode order mismatch');
  safeInteger(value.batch.seed, 'batch seed', 1, 0x7fffffff);
  invariant(sameJSON(value.rules, RULES), 'recorded rules differ from current hungry model');
  invariant(typeof value.runtime?.node === 'string' && typeof value.runtime?.platform === 'string' && typeof value.runtime?.arch === 'string', 'runtime metadata missing');
  record(value.sourceSha256, 'source hashes');
  invariant(SOURCE_PATHS.every(([path]) => typeof value.sourceSha256[path] === 'string' && /^[a-f0-9]{64}$/.test(value.sourceSha256[path])), 'source hash set is incomplete');
  if (sources) invariant(sameJSON(value.sourceSha256, sources), 'source hashes are stale');
  invariant(Array.isArray(value.runs) && value.runs.length === MODES.length && value.runs.map((run: AnyRecord) => run.mode).join(',') === MODES.join(','), 'run mode order/matrix mismatch');
  for (const run of value.runs as AnyRecord[]) {
    const label = `${run.mode}/${value.batch.seed}`;
    invariant(run.seed === value.batch.seed && run.mutation === true && run.repeatVerified === true, `${label}: run identity or repeat proof mismatch`);
    invariant(run.extinctionTick === null || Number.isSafeInteger(run.extinctionTick) && run.extinctionTick > 0 && run.extinctionTick <= MAX_TICK, `${label}: invalid extinction tick`);
    invariant(run.finalTick === (run.extinctionTick ?? MAX_TICK) && run.outcome === (run.extinctionTick === null ? 'alive-at-3000' : 'extinct'), `${label}: final outcome/tick mismatch`);
    invariant(Array.isArray(run.samples) && run.samples.length > 0 && run.samples[0].actualTick === 0, `${label}: initial sample missing`);
    invariant(run.samples.every((row: EvidenceSample, index: number) => index === 0 ? row.scheduledTick === 0 :
      row.actualTick === row.scheduledTick && (row.scheduledTick % SAMPLE_EVERY === 0 || row.actualTick === run.extinctionTick)), `${label}: census cadence or actual tick mismatch`);
    const expectedSampleTicks = [0];
    for (let tick = SAMPLE_EVERY; tick <= run.finalTick; tick += SAMPLE_EVERY) expectedSampleTicks.push(tick);
    if (run.extinctionTick !== null && !expectedSampleTicks.includes(run.extinctionTick)) expectedSampleTicks.push(run.extinctionTick);
    expectedSampleTicks.sort((a, b) => a - b);
    invariant(run.samples.map((row: EvidenceSample) => row.actualTick).join(',') === expectedSampleTicks.join(','), `${label}: census sample coverage mismatch`);
    invariant(run.samples.every((row: EvidenceSample) => {
      const env = row.environment;
      validateCensusRow(row.census, `${label}: sample census`, row.actualTick);
      return row.actualTick <= run.finalTick && /^[a-f0-9]{64}$/.test(row.stateHash) && row.census.tick === row.actualTick &&
        env.mode === run.mode && env.initialFoodPerTile === RULES.initialFood &&
        env.pulseBudget === (run.mode === 'original' ? RULES.tileCount : 768) && env.targetCount === (run.mode === 'patches' ? 972 : RULES.tileCount) &&
        Number.isSafeInteger(env.accepted) && Number.isSafeInteger(env.offered) && Number.isSafeInteger(env.overflow) &&
        env.accepted + env.overflow === env.offered && env.pulses === Math.floor(row.actualTick / RULES.foodSupplyEvery) &&
        env.offered === env.pulses * env.pulseBudget;
    }), `${label}: invalid retained sample or food accounting`);
    invariant(Array.isArray(run.snapshots) && run.snapshots.length > 0, `${label}: snapshots missing`);
    for (const item of run.snapshots as AnyRecord[]) {
      invariant(item.actualTick <= run.finalTick && item.state?.tick === item.actualTick && /^[a-f0-9]{64}$/.test(item.stateHash), `${label}: snapshot identity/hash malformed`);
      invariant(item.stateHash === canonicalHash({ state: item.state, environment: item.environment }), `${label}: snapshot state hash mismatch`);
      invariant(item.scheduledTick === null ? item.terminal === true && item.actualTick === run.extinctionTick : item.terminal !== true && item.scheduledTick === item.actualTick,
        `${label}: terminal snapshot is mislabeled`);
      const stateExtinction = item.terminal === true ? run.extinctionTick : null;
      invariant(item.state.extinctionTick === stateExtinction && item.state.seed === run.seed && item.state.mutation === true, `${label}: snapshot provenance mismatch`);
      validateRecordedSnapshot(item.state, { seed: run.seed, actualTick: item.actualTick, extinctionTick: stateExtinction }, `${label}: snapshot ${item.actualTick}`);
      invariant(item.environment.mode === run.mode && item.environment.accepted === item.state.ledger.supplied &&
        item.environment.offered === item.environment.accepted + item.environment.overflow &&
        item.environment.pulses === Math.floor(item.actualTick / RULES.foodSupplyEvery) &&
        item.environment.offered === item.environment.pulses * item.environment.pulseBudget &&
        item.environment.pulseBudget === (run.mode === 'original' ? RULES.tileCount : 768) &&
        item.environment.targetCount === (run.mode === 'patches' ? 972 : RULES.tileCount),
      `${label}: snapshot food environment differs from its state`);
    }
    const expectedMilestones = SNAPSHOT_TICKS.filter((tick) => run.extinctionTick === null || tick < run.extinctionTick);
    invariant(run.snapshots.filter((item: AnyRecord) => item.scheduledTick !== null).map((item: AnyRecord) => item.scheduledTick).join(',') === expectedMilestones.join(','),
      `${label}: scheduled milestone coverage mismatch`);
    invariant(run.snapshots[0].actualTick === 0 && run.snapshots[0].stateHash === run.samples[0].stateHash, `${label}: initial retained state mismatch`);
    const lastSnapshot = run.snapshots.at(-1);
    invariant(lastSnapshot.actualTick === run.finalTick && lastSnapshot.state.droppedLineage === 0 && lastSnapshot.state.droppedHistory === 0,
      `${label}: final snapshot missing or dropped observations`);
    invariant(sameJSON(run.finalCensus, censusFromSnapshot(lastSnapshot.state)), `${label}: final census differs from terminal snapshot`);
    invariant(sameJSON(run.finalLedger, lastSnapshot.state.ledger), `${label}: final ledger differs from terminal snapshot`);
    invariant(sameJSON(run.lineage, lastSnapshot.state.lineage), `${label}: exported lineage differs from terminal snapshot`);
    invariant(run.finalStateHash === lastSnapshot.stateHash, `${label}: final state hash differs from terminal snapshot`);
    invariant(sameJSON(run.finalEnvironment, lastSnapshot.environment), `${label}: final environment differs from terminal snapshot`);
    validateLateTicks(run, label);
    validateCensusRow(run.finalCensus, `${label}: final census`, run.finalTick);
    invariant(run.finalCensus.tick === run.finalTick && run.finalCensus.ledgerResidual === 0 && run.finalLedger.residual === 0,
      `${label}: final census/ledger mismatch`);
    invariant(run.finalEnvironment.accepted === run.finalLedger.supplied && run.finalEnvironment.offered === run.finalEnvironment.accepted + run.finalEnvironment.overflow &&
      run.finalEnvironment.pulses === Math.floor(run.finalTick / RULES.foodSupplyEvery) &&
      run.finalEnvironment.offered === run.finalEnvironment.pulseBudget * run.finalEnvironment.pulses,
    `${label}: final food accounting mismatch`);
    const expectedBudget = run.mode === 'original' ? RULES.tileCount : 768;
    const expectedTargets = run.mode === 'patches' ? 972 : RULES.tileCount;
    invariant(run.finalEnvironment.mode === run.mode && run.finalEnvironment.pulseBudget === expectedBudget &&
      run.finalEnvironment.targetCount === expectedTargets && run.finalEnvironment.version === 1 &&
      run.finalEnvironment.initialFoodPerTile === RULES.initialFood, `${label}: food mode parameters mismatch`);
    invariant(sameJSON(run.finalEnvironment, run.samples.at(-1).environment), `${label}: final environment differs from terminal sample`);
    invariant(run.finalCensus.births === run.lineage.filter((node: AnyRecord) => node.parentID !== null).length &&
      run.finalCensus.deaths === run.lineage.filter((node: AnyRecord) => node.deathTick !== null).length &&
      run.maxEverGeneration === Math.max(0, ...run.lineage.map((node: AnyRecord) => node.generation)), `${label}: lineage summary mismatch`);
    invariant(run.deathsByCause.age === run.lineage.filter((node: AnyRecord) => node.deathCause === 'age').length &&
      run.deathsByCause.starvation === run.lineage.filter((node: AnyRecord) => node.deathCause === 'starvation').length &&
      run.deathsByCause.age + run.deathsByCause.starvation === run.finalCensus.deaths, `${label}: death-cause summary mismatch`);
    const finalHistory = new Map((lastSnapshot.state.history as DevelopmentCensus[]).map((row) => [row.tick, row]));
    let previousCensus: DevelopmentCensus | null = null;
    let previousAccepted = -1;
    for (const row of run.samples as EvidenceSample[]) {
      invariant(finalHistory.has(row.actualTick) && sameJSON(row.census, finalHistory.get(row.actualTick)),
        `${label}: sample census differs from terminal-state history at ${row.actualTick}`);
      if (previousCensus) invariant(row.census.births >= previousCensus.births && row.census.deaths >= previousCensus.deaths &&
        row.census.growths >= previousCensus.growths && row.census.effectiveMutations >= previousCensus.effectiveMutations,
      `${label}: cumulative census counters decreased`);
      invariant(row.environment.accepted >= previousAccepted, `${label}: accepted food decreased`);
      previousCensus = row.census;
      previousAccepted = row.environment.accepted;
    }
    invariant(run.samples.at(-1).stateHash === lastSnapshot.stateHash, `${label}: terminal sample hash differs from terminal snapshot`);
  }
  invariant(typeof value.dataSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.dataSha256) && value.dataSha256 === artifactHash(value),
    'artifact integrity hash mismatch');
}

async function writeEvidence(seed: number): Promise<void> {
  assertLoadedSourceIdentity();
  const jsonURL = JSON_URL(seed);
  const mdURL = MD_URL(seed);
  for (const url of [jsonURL, mdURL]) {
    try {
      await readFile(url);
      throw new Error(`Refusing to overwrite existing evidence for seed ${seed}; preserve prior results explicitly`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const data = buildArtifact(seed);
  assertLoadedSourceIdentity();
  const markdown = buildMarkdown(data);
  await writeFile(jsonURL, `${JSON.stringify(data)}\n`, { flag: 'wx' });
  try { await writeFile(mdURL, markdown, { flag: 'wx' }); }
  catch (error) { throw new Error(`JSON evidence was written but Markdown was not; retain both states and investigate: ${String(error)}`); }
  process.stdout.write(`Wrote seed ${seed} evidence JSON and Markdown.\n`);
}

async function checkEvidence(seed: number): Promise<void> {
  assertLoadedSourceIdentity();
  const data = JSON.parse(await readFile(JSON_URL(seed), 'utf8')) as AnyRecord;
  assertLoadedSourceIdentity();
  validateEvidenceStructure(data, LOADED_SOURCE_SHA256);
  invariant(data.batch.seed === seed && sameJSON(data.runtime, runtimeInfo()), 'recorded seed/runtime differs');
  invariant((await readFile(MD_URL(seed), 'utf8')) === buildMarkdown(data), 'Markdown differs from accepted JSON');
  process.stdout.write(`Seed ${seed} schema, accounting, source hashes, and Markdown checks passed.\n`);
}

async function replayCheck(seed: number): Promise<void> {
  assertLoadedSourceIdentity();
  const prior = JSON.parse(await readFile(JSON_URL(seed), 'utf8')) as AnyRecord;
  const current = buildArtifact(seed);
  invariant(sameJSON(prior, current), 'Full independent replay differs from accepted evidence');
  invariant((await readFile(MD_URL(seed), 'utf8')) === buildMarkdown(current), 'Replay Markdown differs from accepted evidence');
  process.stdout.write(`Seed ${seed} full independent replay matches accepted evidence.\n`);
}

export function parseArgs(argv: string[]): { mode: '--write' | '--check' | '--replay-check'; seed: number } {
  const mode = argv.find((arg) => ['--write', '--check', '--replay-check'].includes(arg));
  invariant(mode !== undefined, 'Usage: node tools/hungry-shapes/explore.ts --write|--check|--replay-check --seed N');
  invariant(argv.filter((arg) => ['--write', '--check', '--replay-check'].includes(arg)).length === 1, 'Choose exactly one of --write, --check, --replay-check');
  const seedIndex = argv.indexOf('--seed');
  invariant(seedIndex >= 0 && argv[seedIndex + 1] && /^\d+$/.test(argv[seedIndex + 1]!), 'An explicit positive --seed N is required');
  invariant(argv.every((arg, index) => index === seedIndex || index === seedIndex + 1 || ['--write', '--check', '--replay-check'].includes(arg)), 'Unknown CLI argument');
  const seed = Number(argv[seedIndex + 1]);
  safeInteger(seed, 'seed', 1, 0x7fffffff);
  return { mode: mode as '--write' | '--check' | '--replay-check', seed };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { mode, seed } = parseArgs(process.argv.slice(2));
  if (mode === '--write') await writeEvidence(seed);
  else if (mode === '--check') await checkEvidence(seed);
  else await replayCheck(seed);
}
