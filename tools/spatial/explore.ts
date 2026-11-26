/** Fixed spatial pilot. Run with Node 24 only after the model/evidence freeze is approved. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpatialWorld, PRESETS, RULES } from '../../apps/lab/src/spatial/model.ts';

export const SEEDS = [1201, 1202, 1203] as const;
export const PRESET_IDS = ['flocks', 'pursuit', 'colonies'] as const;
export const HORIZON = 6000;
export const CENSUS_EVERY = 100;
export const SNAPSHOT_TICKS = [0, 1000, 3000, 6000] as const;
export const LATE_FROM = 5001;
export const LATE_TO = 6000;
export const MAX_RUNTIME_MS = 20 * 60 * 1000;
const OUT_JSON = new URL('../../docs/creative-prototypes/spatial-pilot.json', import.meta.url);
const OUT_MD = new URL('../../docs/creative-prototypes/spatial-pilot.md', import.meta.url);
const FAILURE_JSON = new URL('../../docs/creative-prototypes/spatial-pilot.failure.json', import.meta.url);
const MODEL_PATH = new URL('../../apps/lab/src/spatial/model.ts', import.meta.url);
const RUNNER_PATH = fileURLToPath(import.meta.url);
type Dict = Record<string, any>;
type Preset = typeof PRESET_IDS[number];

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function sourceHashes() {
  return {
    'apps/lab/src/spatial/model.ts': sha(readFileSync(MODEL_PATH)),
    'tools/spatial/explore.ts': sha(readFileSync(RUNNER_PATH)),
  };
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const close = (a: number, b: number, eps = 1e-8) => Math.abs(a - b) <= eps;
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function invariant(world: any, expectedTick: number): number {
  assert(world.tick === expectedTick, `tick discontinuity: expected ${expectedTick}, got ${world.tick}`);
  const cap = RULES.populationMax;
  assert(Array.isArray(world.particles) && world.particles.length <= cap, `population outside 0..${cap}`);
  const ids = new Set<number>();
  for (const p of world.particles) {
    assert([p.x, p.y, p.z, p.vx, p.vy, p.vz, p.energy].every(finite), `non-finite particle state at tick ${world.tick}`);
    assert(p.x >= 0 && p.x < 1 && p.y >= 0 && p.y < 1 && p.z >= 0 && p.z < 1, `position outside unit torus at tick ${world.tick}`);
    assert(p.energy >= -1e-10 && p.energy <= RULES.maxEnergy + 1e-8, `particle energy outside bounds at tick ${world.tick}`);
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
    assert(speed <= RULES.speedMax + 1e-10, `3D speed cap exceeded at tick ${world.tick}`);
    assert(!ids.has(p.id), `duplicate particle id ${p.id} at tick ${world.tick}`); ids.add(p.id);
    assert(Array.isArray(p.traits) && p.traits.length === 3 && p.traits.every((v: unknown) => finite(v) && v >= -1 && v <= 1), `invalid traits at tick ${world.tick}`);
  }
  assert(Array.isArray(world.food) && world.food.length === 8, `expected eight food patches at tick ${world.tick}`);
  for (const food of world.food) assert(finite(food.amount) && food.amount >= -1e-9 && food.amount <= RULES.foodCapacity + 1e-8, `food stock outside bounds at tick ${world.tick}`);
  const c = world.census();
  assert(c.tick === world.tick && c.population === world.particles.length, `census/world mismatch at tick ${world.tick}`);
  for (const key of ['births', 'deaths', 'mutations', 'blockedBirths']) assert(Number.isSafeInteger(c[key]) && c[key] >= 0, `invalid ${key} at tick ${world.tick}`);
  const particleEnergy = world.particles.reduce((sum: number, p: any) => sum + p.energy, 0);
  const foodEnergy = world.food.reduce((sum: number, f: any) => sum + f.amount, 0);
  assert(close(c.particleEnergy, particleEnergy) && close(c.foodEnergy, foodEnergy), `census energy mismatch at tick ${world.tick}`);
  const l = world.ledger;
  const residual = l.initial + l.renewed - l.dissipated - l.deathLoss - particleEnergy - foodEnergy;
  assert(finite(residual) && Math.abs(residual) <= 1e-6, `energy invariant failed at tick ${world.tick}: ${residual}`);
  return Math.abs(residual);
}

function windowAccumulator(fromTick: number, toTick: number) {
  return { fromTick, toTick, executedSteps: 0, livingSteps: 0,
    meanSpeedSum: 0, meanAbsVzSum: 0, meanAbsVxSum: 0, meanAbsVySum: 0,
    occupiedBinsSum: 0, occupiedZBandsSum: 0, minOccupiedZBands: null as number | null, maxOccupiedZBands: null as number | null, minPopulation: null as number | null,
    maxPopulation: null as number | null, finalPopulation: null as number | null,
    capSteps: 0, birthsAtStart: null as number | null, deathsAtStart: null as number | null,
    birthsAtEnd: null as number | null, deathsAtEnd: null as number | null };
}
function accumulateWindow(a: ReturnType<typeof windowAccumulator>, c: Dict) {
  a.executedSteps++;
  a.birthsAtEnd = c.births; a.deathsAtEnd = c.deaths;
  a.minPopulation = a.minPopulation === null ? c.population : Math.min(a.minPopulation, c.population);
  a.maxPopulation = a.maxPopulation === null ? c.population : Math.max(a.maxPopulation, c.population);
  a.finalPopulation = c.population;
  if (c.population <= 0) return;
  a.livingSteps++;
  a.meanSpeedSum += c.meanSpeed; a.meanAbsVzSum += c.meanAbsVz; a.meanAbsVxSum += c.meanAbsVx; a.meanAbsVySum += c.meanAbsVy;
  a.occupiedBinsSum += c.occupiedBins; a.occupiedZBandsSum += c.occupiedZBands;
  a.minOccupiedZBands = a.minOccupiedZBands === null ? c.occupiedZBands : Math.min(a.minOccupiedZBands, c.occupiedZBands);
  a.maxOccupiedZBands = a.maxOccupiedZBands === null ? c.occupiedZBands : Math.max(a.maxOccupiedZBands, c.occupiedZBands);
  a.capSteps += c.population === RULES.populationMax ? 1 : 0;
}
function finishWindow(a: ReturnType<typeof windowAccumulator>) {
  const n = a.livingSteps;
  return { fromTick: a.fromTick, toTick: a.toTick, executedSteps: a.executedSteps, livingSteps: n,
    meanSpeed: n ? a.meanSpeedSum / n : null, meanAbsVz: n ? a.meanAbsVzSum / n : null,
    meanAbsVx: n ? a.meanAbsVxSum / n : null, meanAbsVy: n ? a.meanAbsVySum / n : null,
    zToHorizontalAbsSpeedRatio: n && (a.meanAbsVxSum + a.meanAbsVySum) / (2 * n) > 0
      ? (a.meanAbsVzSum / n) / ((a.meanAbsVxSum + a.meanAbsVySum) / (2 * n)) : null,
    meanOccupiedBins: n ? a.occupiedBinsSum / n : null, meanOccupiedZBands: n ? a.occupiedZBandsSum / n : null,
    minOccupiedZBands: n ? a.minOccupiedZBands : null, maxOccupiedZBands: n ? a.maxOccupiedZBands : null,
    minPopulation: a.executedSteps ? a.minPopulation : null, maxPopulation: a.executedSteps ? a.maxPopulation : null,
    finalPopulation: a.executedSteps ? a.finalPopulation : null, capFraction: n ? a.capSteps / n : null,
    birthsDelta: a.executedSteps ? (a.birthsAtEnd! - a.birthsAtStart!) : null,
    deathsDelta: a.executedSteps ? (a.deathsAtEnd! - a.deathsAtStart!) : null };
}
function snapshotRecord(world: any) {
  const state = world.snapshot();
  return { tick: world.tick, state, sha256: sha(canonical(state)) };
}
function executeOne(preset: Preset, seed: number, deadline = Infinity) {
  const world: any = new SpatialWorld(seed, preset, true);
  const samples: Dict[] = [{ tick: 0, census: world.census() }];
  const snapshots: Dict[] = [snapshotRecord(world)];
    const early = windowAccumulator(1, 1000), late = windowAccumulator(LATE_FROM, LATE_TO);
  const familyExtinctionTicks: (number | null)[] = [null, null, null];
  let maximumLedgerResidual = invariant(world, 0);
  let extinctionTick: number | null = null;
  for (let step = 1; step <= HORIZON; step++) {
    assert(Date.now() <= deadline, 'fixed pilot exceeded its 20-minute runtime budget');
    const priorCensus = world.census();
    if (step === 1) { early.birthsAtStart = priorCensus.births; early.deathsAtStart = priorCensus.deaths; }
    if (step === LATE_FROM) { late.birthsAtStart = priorCensus.births; late.deathsAtStart = priorCensus.deaths; }
    const before = world.tick;
    world.step();
    assert(world.tick === before + 1, `world stopped before extinction at tick ${before}`);
    const residual = invariant(world, world.tick);
    maximumLedgerResidual = Math.max(maximumLedgerResidual, residual);
    const c = world.census();
    for (let family = 0; family < 3; family++) if (familyExtinctionTicks[family] === null && c.counts[family] === 0) familyExtinctionTicks[family] = world.tick;
    if (world.tick % CENSUS_EVERY === 0 || c.population === 0) samples.push({ tick: world.tick, census: c });
    if (world.tick >= early.fromTick && world.tick <= early.toTick) accumulateWindow(early, c);
    if (world.tick >= late.fromTick && world.tick <= late.toTick) accumulateWindow(late, c);
    if ((SNAPSHOT_TICKS as readonly number[]).includes(world.tick) || c.population === 0) {
      if (snapshots.at(-1)?.tick !== world.tick) snapshots.push(snapshotRecord(world));
    }
    if (c.population === 0) { extinctionTick = world.tick; break; }
  }
  const finalCensus = world.census();
  if (snapshots.at(-1)?.tick !== world.tick) snapshots.push(snapshotRecord(world));
  const earlyWindow = finishWindow(early), lateWindow = finishWindow(late);
  return { preset, seed, mutation: true, requestedTicks: HORIZON, ticksCompleted: world.tick, extinctionTick,
    censusSamples: samples, snapshots, earlyWindow, lateWindow, maximumLedgerResidual,
    lateAssayFlags: { allLivingLateStepsOneZBand: lateWindow.livingSteps > 0 && lateWindow.maxOccupiedZBands === 1,
      noLateZMotion: lateWindow.livingSteps > 0 && lateWindow.meanAbsVz === 0 },
    finalCensus, finalSnapshotSha256: snapshots.at(-1)!.sha256,
    familyExtinctionTicks };
}

function repeatRecord(run: Dict) {
  return { ticksCompleted: run.ticksCompleted, extinctionTick: run.extinctionTick, censusSamples: run.censusSamples,
    snapshots: run.snapshots, earlyWindow: run.earlyWindow, lateWindow: run.lateWindow, maximumLedgerResidual: run.maximumLedgerResidual,
    finalCensus: run.finalCensus, finalSnapshotSha256: run.finalSnapshotSha256, familyExtinctionTicks: run.familyExtinctionTicks,
    lateAssayFlags: run.lateAssayFlags };
}

export function runPilot() {
  assert(process.versions.node.split('.')[0] === '24', `fixed pilot requires Node 24; found ${process.version}`);
  const frozenSources = sourceHashes();
  const deadline = Date.now() + MAX_RUNTIME_MS;
  const outcomes: Dict[] = [];
  for (const preset of PRESET_IDS) for (const seed of SEEDS) {
    const first = executeOne(preset, seed, deadline);
    const repeat = executeOne(preset, seed, deadline);
    assert(first.finalSnapshotSha256 === repeat.finalSnapshotSha256, `repeat final snapshot differs: ${preset} seed ${seed}`);
    outcomes.push({ ...first, repeat: repeatRecord(repeat) });
    console.log(`${preset} ${seed}: tick=${first.ticksCompleted}, population=${first.finalCensus.population}, births=${first.finalCensus.births}, deaths=${first.finalCensus.deaths}, late living=${first.lateWindow.livingSteps}/${first.lateWindow.executedSteps}`);
  }
  assert(canonical(sourceHashes()) === canonical(frozenSources), 'model or runner source changed during evidence collection');
  const artifact: Dict = { schemaVersion: 1, kind: 'spatial-particle-pilot', sourceSha256: frozenSources, runtime: { node: process.version, platform: process.platform, arch: process.arch },
    rules: RULES, presets: PRESETS, seeds: [...SEEDS], requestedTicks: HORIZON, mutation: true,
    censusEvery: CENSUS_EVERY, snapshotTicks: [...SNAPSHOT_TICKS], lateWindow: { fromTick: LATE_FROM, toTick: LATE_TO }, outcomes };
  artifact.integritySha256 = sha(canonical(artifact));
  validateEvidenceStructure(artifact);
  writeFileSync(OUT_JSON, JSON.stringify(artifact, null, 2) + '\n');
  writeFileSync(OUT_MD, buildMarkdown(artifact));
  try { unlinkSync(FAILURE_JSON); } catch { /* optional prior failure marker */ }
  return artifact;
}

function assertFiniteTree(value: any, label: string) {
  if (typeof value === 'number') assert(Number.isFinite(value), `${label} contains non-finite number`);
  else if (Array.isArray(value)) value.forEach((v, i) => assertFiniteTree(v, `${label}[${i}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => assertFiniteTree(v, `${label}.${k}`));
}
function validateCensus(c: Dict, tick: number, label: string) {
  assert(c?.tick === tick && Number.isInteger(c.population) && c.population >= 0 && c.population <= RULES.populationMax, `${label} census extent invalid`);
  assert(Array.isArray(c.counts) && c.counts.length === 3 && c.counts.every((n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0) && c.counts.reduce((sum: number, n: number) => sum + n, 0) === c.population, `${label} family census invalid`);
  for (const k of ['births', 'deaths', 'mutations', 'blockedBirths', 'maxGeneration']) assert(Number.isSafeInteger(c[k]) && c[k] >= 0, `${label} census ${k} invalid`);
  for (const k of ['meanSpeed', 'meanAbsVx', 'meanAbsVy', 'meanAbsVz', 'traitSpread', 'particleEnergy', 'foodEnergy']) assert(finite(c[k]) && c[k] >= 0, `${label} census ${k} invalid`);
  assert(Number.isInteger(c.occupiedBins) && c.occupiedBins >= 0 && c.occupiedBins <= 125 && Number.isInteger(c.occupiedZBands) && c.occupiedZBands >= 0 && c.occupiedZBands <= 5, `${label} occupancy census invalid`);
}
function validateSnapshot(state: Dict, tick: number, preset: string, seed: number, label: string) {
  assert(state?.kind === 'spatial-world-observation' && typeof state.description === 'string' && state.description.includes('Observation only'), `${label} is not a full observation snapshot`);
  assert(canonical(state.rules) === canonical(RULES), `${label} snapshot rules mismatch`);
  assert(state.settings?.seed === seed && state.settings?.preset === preset && state.settings?.mutation === true, `${label} snapshot settings mismatch`);
  validateCensus(state.current, tick, label);
  assert(Array.isArray(state.particles) && state.particles.length === state.current.population, `${label} snapshot particle inventory missing or inconsistent`);
  assert(Array.isArray(state.food) && state.food.length === 8 && Array.isArray(state.history), `${label} snapshot food/history missing`);
  const counts = [0, 0, 0], bins = new Set<number>(), bands = new Set<number>(), ids = new Set<number>();
  let particleEnergy = 0, speed = 0, absX = 0, absY = 0, absZ = 0;
  for (const p of state.particles) {
    assert([p.x,p.y,p.z,p.vx,p.vy,p.vz,p.energy].every(finite) && p.x >= 0 && p.x < 1 && p.y >= 0 && p.y < 1 && p.z >= 0 && p.z < 1 && p.energy >= 0 && p.energy <= RULES.maxEnergy, `${label} snapshot particle invalid`);
    assert(Number.isSafeInteger(p.id) && p.id >= 0 && !ids.has(p.id), `${label} snapshot particle id invalid or duplicated`); ids.add(p.id);
    assert(Number.isInteger(p.family) && p.family >= 0 && p.family <= 2, `${label} snapshot family invalid`);
    assert(Number.isSafeInteger(p.age) && p.age >= 0 && Number.isSafeInteger(p.lifespan) && p.lifespan > 0 && p.age <= p.lifespan && Number.isSafeInteger(p.generation) && p.generation >= 0, `${label} snapshot particle lifecycle invalid`);
    assert(Array.isArray(p.traits) && p.traits.length === 3 && p.traits.every((v: unknown) => finite(v) && v >= -1 && v <= 1), `${label} snapshot particle traits invalid`);
    assert(Math.sqrt(p.vx*p.vx+p.vy*p.vy+p.vz*p.vz) <= RULES.speedMax + 1e-10, `${label} snapshot particle speed invalid`);
    counts[p.family]++; particleEnergy += p.energy;
    speed += Math.sqrt(p.vx*p.vx+p.vy*p.vy+p.vz*p.vz); absX += Math.abs(p.vx); absY += Math.abs(p.vy); absZ += Math.abs(p.vz);
    bins.add(Math.floor(p.x*5)+5*Math.floor(p.y*5)+25*Math.floor(p.z*5)); bands.add(Math.floor(p.z*5));
  }
  let foodEnergy = 0;
  for (const f of state.food) { assert([f.x,f.y,f.z,f.radius,f.amount].every(finite) && f.x >= 0 && f.x < 1 && f.y >= 0 && f.y < 1 && f.z >= 0 && f.z < 1 && f.amount >= 0 && f.amount <= RULES.foodCapacity, `${label} snapshot food invalid`); foodEnergy += f.amount; }
  const c = state.current;
  assert(c.counts.every((n: number, i: number) => n === counts[i]) && close(c.particleEnergy, particleEnergy) && close(c.foodEnergy, foodEnergy), `${label} snapshot census energy/family mismatch`);
  assert(c.occupiedBins === bins.size && c.occupiedZBands === bands.size, `${label} snapshot census occupancy mismatch`);
  if (c.population) assert(close(c.meanSpeed, speed/c.population) && close(c.meanAbsVx, absX/c.population) && close(c.meanAbsVy, absY/c.population) && close(c.meanAbsVz, absZ/c.population), `${label} snapshot census motion mismatch`);
  const ledger = state.ledger;
  assert(ledger && ['initial','renewed','consumed','dissipated','deathLoss'].every(k => finite(ledger[k]) && ledger[k] >= 0), `${label} snapshot ledger missing`);
  assert(Math.abs(ledger.initial + ledger.renewed - ledger.dissipated - ledger.deathLoss - particleEnergy - foodEnergy) <= 1e-6, `${label} snapshot ledger residual invalid`);
}
function validateOutcome(run: Dict, expectedPreset: string, expectedSeed: number, label: string) {
  assert(run.preset === expectedPreset && run.seed === expectedSeed && run.mutation === true, `${label} matrix identity mismatch`);
  assert(run.requestedTicks === HORIZON && Number.isInteger(run.ticksCompleted) && run.ticksCompleted > 0 && run.ticksCompleted <= HORIZON, `${label} tick extent invalid`);
  assert(run.extinctionTick === null ? run.ticksCompleted === HORIZON : run.extinctionTick === run.ticksCompleted, `${label} extinction extent mismatch`);
  assert(Array.isArray(run.censusSamples) && run.censusSamples.length > 0, `${label} census samples missing`);
  assert(run.censusSamples[0].tick === 0, `${label} missing initial census`);
  const expectedSampleTicks = [0];
  for (let tick = CENSUS_EVERY; tick <= run.ticksCompleted; tick += CENSUS_EVERY) expectedSampleTicks.push(tick);
  if (expectedSampleTicks.at(-1) !== run.ticksCompleted) expectedSampleTicks.push(run.ticksCompleted);
  assert(canonical(run.censusSamples.map((s: Dict) => s.tick)) === canonical(expectedSampleTicks), `${label} incomplete or extra census cadence`);
  let previous = -1;
  for (const sample of run.censusSamples) {
    assert(Number.isInteger(sample.tick) && sample.tick > previous && (sample.tick % CENSUS_EVERY === 0 || sample.tick === run.ticksCompleted), `${label} census cadence invalid`);
    assert(sample.tick <= run.ticksCompleted && sample.census?.tick === sample.tick, `${label} census tick mismatch`);
    validateCensus(sample.census, sample.tick, `${label} sample`);
    previous = sample.tick;
  }
  assert(run.censusSamples.at(-1).tick === run.ticksCompleted, `${label} missing final census`);
  assert(Array.isArray(run.snapshots) && run.snapshots.length >= 1 && run.snapshots[0].tick === 0, `${label} initial full snapshot missing`);
  const snapshotTicks = run.snapshots.map((s: Dict) => s.tick);
  assert(snapshotTicks.includes(0), `${label} snapshot zero missing`);
  for (const t of SNAPSHOT_TICKS) if (t <= run.ticksCompleted) assert(snapshotTicks.includes(t), `${label} required full snapshot ${t} missing`);
  if (run.extinctionTick !== null) assert(snapshotTicks.includes(run.extinctionTick), `${label} exact extinction snapshot missing`);
  previous = -1;
  for (const s of run.snapshots) {
    assert(Number.isInteger(s.tick) && s.tick > previous && s.tick <= run.ticksCompleted, `${label} snapshot ordering invalid`);
    validateSnapshot(s.state, s.tick, expectedPreset, expectedSeed, `${label} snapshot ${s.tick}`);
    assert(s.sha256 === sha(canonical(s.state)), `${label} full snapshot hash mismatch at ${s.tick}`);
    const sampled = run.censusSamples.find((sample: Dict) => sample.tick === s.tick);
    if (sampled) assert(canonical(s.state.current) === canonical(sampled.census), `${label} snapshot census differs from sampled census at ${s.tick}`);
    previous = s.tick;
  }
  const last = run.snapshots.at(-1);
  assert(run.finalSnapshotSha256 === last.sha256 && last.tick === run.ticksCompleted, `${label} final snapshot reference mismatch`);
  assert(run.finalCensus?.tick === run.ticksCompleted && canonical(run.finalCensus) === canonical(run.censusSamples.at(-1).census), `${label} final census differs from sample`);
  assert(finite(run.maximumLedgerResidual) && run.maximumLedgerResidual >= 0 && run.maximumLedgerResidual <= 1e-6, `${label} ledger residual invalid`);
  validateWindow(run.earlyWindow, 1, 1000, run.ticksCompleted, `${label} early window`);
  validateWindow(run.lateWindow, LATE_FROM, LATE_TO, run.ticksCompleted, `${label} late window`);
  assert(Array.isArray(run.familyExtinctionTicks) && run.familyExtinctionTicks.length === 3 && run.familyExtinctionTicks.every((t: unknown) => t === null || (Number.isInteger(t) && Number(t) > 0 && Number(t) <= run.ticksCompleted)), `${label} family extinction ticks invalid`);
  assert(run.lateAssayFlags?.allLivingLateStepsOneZBand === (run.lateWindow.livingSteps > 0 && run.lateWindow.maxOccupiedZBands === 1) && run.lateAssayFlags?.noLateZMotion === (run.lateWindow.livingSteps > 0 && run.lateWindow.meanAbsVz === 0), `${label} late assay flags mismatch`);
  assertFiniteTree(run, label);
}
function validateWindow(w: Dict, fromTick: number, toTick: number, ticksCompleted: number, label: string) {
  assert(w.fromTick === fromTick && w.toTick === toTick, `${label} boundaries invalid`);
  const executed = Math.max(0, Math.min(toTick, ticksCompleted) - fromTick + 1);
  assert(w.executedSteps === executed, `${label} executed coverage mismatch`);
  assert(Number.isInteger(w.livingSteps) && w.livingSteps >= 0 && w.livingSteps <= executed, `${label} living coverage invalid`);
  const livingMetrics = ['meanSpeed','meanAbsVz','meanAbsVx','meanAbsVy','zToHorizontalAbsSpeedRatio','meanOccupiedBins','meanOccupiedZBands','minOccupiedZBands','maxOccupiedZBands','capFraction'];
  for (const k of livingMetrics) {
    if (w.livingSteps === 0) assert(w[k] === null, `${label} metric ${k} must be null without living steps`);
    else if (k === 'zToHorizontalAbsSpeedRatio' && w[k] === null) continue;
    else assert(finite(w[k]), `${label} metric ${k} coverage mismatch`);
  }
  for (const k of ['minPopulation','maxPopulation','finalPopulation','birthsDelta','deathsDelta']) assert(w[k] === null ? w.executedSteps === 0 : finite(w[k]), `${label} metric ${k} execution coverage mismatch`);
  if (w.livingSteps > 0) assert(w.capFraction >= 0 && w.capFraction <= 1 && w.minOccupiedZBands >= 0 && w.maxOccupiedZBands <= 5 && w.minOccupiedZBands <= w.maxOccupiedZBands, `${label} summary bounds invalid`);
  if (w.executedSteps > 0) assert(w.minPopulation <= w.maxPopulation, `${label} population range invalid`);
}

export function validateEvidenceStructure(value: Dict, options: { sources?: Dict; rules?: Dict } = {}) {
  assert(value?.schemaVersion === 1 && value.kind === 'spatial-particle-pilot', 'invalid evidence schema');
  assert(canonical(value.seeds) === canonical(SEEDS) && value.requestedTicks === HORIZON && value.mutation === true, 'pilot settings mismatch');
  assert(value.censusEvery === CENSUS_EVERY && canonical(value.snapshotTicks) === canonical(SNAPSHOT_TICKS), 'sampling schedule mismatch');
  assert(canonical(value.presets.map((p: Dict) => p.id)) === canonical(PRESET_IDS), 'ordered preset matrix mismatch');
  assert(canonical(value.rules) === canonical(RULES), 'evidence rules differ from frozen model');
  if (options.rules) assert(canonical(value.rules) === canonical(options.rules), 'evidence rules differ from expected rules');
  if (options.sources) assert(canonical(value.sourceSha256) === canonical(options.sources), 'evidence source hashes are stale');
  assert(value.runtime?.node?.startsWith('v24.'), 'evidence runtime is not Node 24');
  assert(Array.isArray(value.outcomes) && value.outcomes.length === 9, 'pilot must contain exactly nine primary outcomes');
  let index = 0;
  for (const preset of PRESET_IDS) for (const seed of SEEDS) {
    const run = value.outcomes[index++]; validateOutcome(run, preset, seed, `${preset}/${seed}`);
    const repeat = run.repeat;
    assert(repeat && repeat.ticksCompleted === run.ticksCompleted && repeat.extinctionTick === run.extinctionTick, `${preset}/${seed} repeat extent mismatch`);
    validateOutcome({ ...repeat, preset, seed, mutation: true, requestedTicks: HORIZON }, preset, seed, `${preset}/${seed} repeat`);
    assert(repeat.finalSnapshotSha256 === run.finalSnapshotSha256, `${preset}/${seed} independent repeat final snapshot differs`);
  }
  const copy = { ...value }; delete copy.integritySha256;
  assert(value.integritySha256 === sha(canonical(copy)), 'artifact integrity hash mismatch');
  return true;
}

export function buildMarkdown(data: Dict) {
  const outcomeRows = data.outcomes.map((r: Dict) => `| ${r.preset} | ${r.seed} | ${r.ticksCompleted} | ${r.extinctionTick ?? '—'} | ${r.finalCensus.population} | ${r.finalCensus.births} / ${r.finalCensus.deaths} | ${r.familyExtinctionTicks.map((t: number | null) => t ?? '—').join(', ')} | ${r.maximumLedgerResidual.toExponential(3)} |`).join('\n');
  const summaryRows = data.outcomes.flatMap((r: Dict) => ['earlyWindow', 'lateWindow'].map((key: string) => {
    const w = r[key]; const name = key === 'earlyWindow' ? 'early (1–1,000)' : 'late (5,001–6,000)';
    const show = (n: number | null, digits = 4) => n === null ? '—' : n.toFixed(digits);
    return `| ${r.preset} | ${r.seed} | ${name} | ${w.livingSteps}/${w.executedSteps} | ${show(w.meanSpeed, 6)} | ${show(w.meanAbsVz, 6)} | ${show(w.zToHorizontalAbsSpeedRatio, 4)} | ${show(w.meanOccupiedBins, 2)} | ${w.minOccupiedZBands ?? '—'}–${w.maxOccupiedZBands ?? '—'} | ${w.minPopulation ?? '—'}–${w.maxPopulation ?? '—'} (${w.finalPopulation ?? '—'}) | ${show(w.capFraction, 4)} | ${w.birthsDelta ?? '—'} / ${w.deathsDelta ?? '—'} |`;
  })).join('\n');
  const flagRows = data.outcomes.filter((r: Dict) => r.lateAssayFlags.allLivingLateStepsOneZBand || r.lateAssayFlags.noLateZMotion)
    .map((r: Dict) => `| ${r.preset} | ${r.seed} | ${r.lateAssayFlags.allLivingLateStepsOneZBand ? 'all living late steps occupied one z band' : ''}${r.lateAssayFlags.allLivingLateStepsOneZBand && r.lateAssayFlags.noLateZMotion ? '; ' : ''}${r.lateAssayFlags.noLateZMotion ? 'no late z motion' : ''} |`).join('\n');
  return `# Spatial particle worlds pilot\n\nFixed matrix: three presets × seeds ${SEEDS.join(', ')} × up to ${HORIZON.toLocaleString('en-US')} ticks; mutation enabled. Each outcome was independently repeated and its full final snapshot compared. Node ${data.runtime.node}; rules version ${RULES.version}; model SHA-256 \`${data.sourceSha256['apps/lab/src/spatial/model.ts']}\`.\n\n| Preset | Seed | Ticks | Extinction tick | Final population | Births / deaths | Family extinction ticks (0, 1, 2) | Max ledger residual |\n|---|---:|---:|---:|---:|---:|---|---:|\n${outcomeRows}\n\n## Early and late observations\n\n| Preset | Seed | Window | Living / executed steps | Mean speed | Mean absolute vz | z / horizontal ratio | Mean occupied bins | Occupied z band min–max | Population min–max (final) | Cap fraction | Births / deaths delta |\n|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${summaryRows}\n\n- Early summaries cover ticks 1–1,000. Late summaries cover ticks ${LATE_FROM.toLocaleString('en-US')}–${LATE_TO.toLocaleString('en-US')}. Motion and occupancy means use living steps; population range and turnover include every executed step, including the extinction step. Unavailable metrics are null.\n- Late assay flags prompt scrutiny when every living late step occupies one z band or mean absolute vz is zero:${flagRows ? `\n\n| Preset | Seed | Flag |\n|---|---:|---|\n${flagRows}` : ' none were flagged.'}\n- Spatial occupancy and movement are descriptive observations, not success thresholds. Food is engineered renewable energy; pursuit is not predation. A population cap can constrain births. The outcomes do not establish adaptation, evolution, or persistence beyond the recorded horizon.\n- The JSON retains every 100-tick census, full snapshots at 0/1,000/3,000/6,000 when reached and at exact extinction, plus each independent repeat. Replay is same-runtime only.\n\nCheck the recorded batch without simulation: \`node tools/spatial/explore.ts --check\`. Reproduce every run and repeat: \`node tools/spatial/explore.ts --replay-check\`.\n`;
}

function checkSaved() {
  const data = JSON.parse(readFileSync(OUT_JSON, 'utf8'));
  validateEvidenceStructure(data, { sources: sourceHashes(), rules: RULES });
  assert(readFileSync(OUT_MD, 'utf8') === buildMarkdown(data), 'Markdown report differs from retained JSON');
  assertNoFailureRecord();
  console.log('Spatial pilot source hashes, rules, matrix, outcomes, and Markdown are current. No simulation was run.');
}
function assertNoFailureRecord() {
  try { readFileSync(FAILURE_JSON); throw new Error('a failure record invalidates this evidence batch'); }
  catch (error: any) { if (error.message.includes('invalidates')) throw error; }
}
function replayCheck() {
  assert(process.versions.node.split('.')[0] === '24', `replay check requires Node 24; found ${process.version}`);
  const deadline = Date.now() + MAX_RUNTIME_MS;
  const data = JSON.parse(readFileSync(OUT_JSON, 'utf8'));
  validateEvidenceStructure(data, { sources: sourceHashes(), rules: RULES });
  assert(readFileSync(OUT_MD, 'utf8') === buildMarkdown(data), 'Markdown report differs from retained JSON');
  assertNoFailureRecord();
  const frozenSources = sourceHashes();
  for (const expected of data.outcomes) {
    const actual = executeOne(expected.preset, expected.seed, deadline);
    assert(canonical(actual) === canonical(Object.fromEntries(Object.entries(expected).filter(([k]) => k !== 'repeat'))), `replayed primary differs for ${expected.preset}/${expected.seed}`);
    const repeated = executeOne(expected.preset, expected.seed, deadline);
    assert(canonical(repeatRecord(repeated)) === canonical(expected.repeat), `replayed repeat differs for ${expected.preset}/${expected.seed}`);
  }
  assert(canonical(sourceHashes()) === canonical(frozenSources) && canonical(frozenSources) === canonical(data.sourceSha256), 'model or runner source changed during replay check');
  console.log('All nine outcomes and independent repeats reproduce exactly in this Node runtime.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !['--check', '--replay-check'].includes(args[0]))) throw new Error('Usage: node tools/spatial/explore.ts [--check|--replay-check]');
  if (!args[0] && process.versions.node.split('.')[0] !== '24') throw new Error(`fixed pilot requires Node 24; found ${process.version}`);
  if (args[0] === '--check') checkSaved();
  else if (args[0] === '--replay-check') replayCheck();
  else {
    try { runPilot(); }
    catch (error) {
      const failure = { kind: 'spatial-particle-pilot-failure', schemaVersion: 1, timestamp: new Date().toISOString(), runtime: process.version,
        sourceSha256: sourceHashes(), message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : null,
        invalidatesBatch: true };
      mkdirSync(dirname(fileURLToPath(FAILURE_JSON)), { recursive: true });
      writeFileSync(FAILURE_JSON, JSON.stringify(failure, null, 2) + '\n');
      throw error;
    }
  }
}
