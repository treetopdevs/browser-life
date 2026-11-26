#!/usr/bin/env node
/**
 * Fixed, replayable evidence batch for the version 1 particle motif grammar.
 * Run with Node 24.2.0: node tools/particles/explore-motifs.ts --write
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { ParticleWorld, RULES, recipeForPreset, type Particle } from '../../apps/lab/src/particles/model.ts';
import { motifCatalog, MotifWorld, type MotifSample } from '../../apps/lab/src/particles/motifs.ts';
import { buildOccupancyHistogram, totalVariationDistance, type OccupancyHistogram } from '../../apps/lab/src/particles/motif-observers.ts';

const JSON_URL = new URL('../../docs/creative-prototypes/motifs-pilot.json', import.meta.url);
const MD_URL = new URL('../../docs/creative-prototypes/motifs-pilot.md', import.meta.url);
const SEEDS = [1201, 1202, 1203] as const;
const MAX_TICK = 3000;
const SAMPLE_EVERY = 100;
const PERTURB_TICK = 1500;
const PERTURB_DX = 1 / 12;
const EXPECTED_NODE = '24.2.0';

/** Advance one shared clock tick so no scheduled comparison can stall at a non-sample tick. */
export function nextPairedEvidenceTick(currentTick: number, maxTick = MAX_TICK): number {
  if (!Number.isInteger(currentTick) || !Number.isInteger(maxTick) || currentTick < 0 || currentTick >= maxTick) {
    throw new Error('Paired evidence clock must advance from a tick below its integer limit');
  }
  return currentTick + 1;
}

type AnyRecord = Record<string, unknown>;
type ScalarSample = {
  tick: number;
  actualTick: number;
  population: number;
  families: [number, number, number];
  births: number;
  deaths: number;
  mutations: number;
  maxGeneration: number;
  meanSpeed: number;
  occupiedBins: number;
  textureChange: number | null;
  energyResidual: number;
  stateHash: string;
  gzipBytes: number;
  counts: number[];
};

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function snapshotHash(world: MotifWorld | ParticleWorld): string {
  return canonicalHash(world instanceof MotifWorld ? world.base.snapshot() : world.snapshot());
}

function histogram(particles: readonly Particle[]): OccupancyHistogram {
  // MotifWorld records immutable histograms at the fixed cadence. For the
  // single post-move 1500 observation, the standalone observer is imported
  // directly below rather than changing world history.
  return buildOccupancyHistogram(particles);
}

function assertFiniteWorld(world: MotifWorld | ParticleWorld, label: string): number {
  const base = world instanceof MotifWorld ? world.base : world;
  invariant(base.particles.length <= RULES.populationMax, `${label}: population cap exceeded at ${base.tick}`);
  const census = base.census();
  invariant(census.population === base.particles.length, `${label}: census population mismatch at ${base.tick}`);
  invariant(census.counts.reduce((sum, count) => sum + count, 0) === census.population, `${label}: family counts mismatch at ${base.tick}`);
  invariant(base.particles.every(p => Number.isInteger(p.id) && p.id >= 0 && Number.isInteger(p.family) && p.family >= 0 && p.family <= 2 &&
    Number.isFinite(p.x) && p.x >= 0 && p.x < 1 && Number.isFinite(p.y) && p.y >= 0 && p.y < 1 &&
    Number.isFinite(p.vx) && Number.isFinite(p.vy) && Number.isFinite(p.energy) && p.energy >= 0 && p.energy <= RULES.maxEnergy &&
    Number.isInteger(p.age) && p.age >= 0 && Number.isInteger(p.lifespan) && p.lifespan > 0 && Number.isInteger(p.generation) && p.generation >= 0 &&
    p.traits.length === 3 && p.traits.every(t => Number.isFinite(t) && t >= -1 && t <= 1)), `${label}: invalid particle at tick ${base.tick}`);
  invariant(base.food.every(p => Number.isFinite(p.x) && p.x >= 0 && p.x < 1 && Number.isFinite(p.y) && p.y >= 0 && p.y < 1 && Number.isFinite(p.amount) && p.amount >= 0 && p.amount <= RULES.foodCapacity), `${label}: invalid food at tick ${base.tick}`);
  invariant([census.meanSpeed, census.particleEnergy, census.foodEnergy].every(Number.isFinite), `${label}: non-finite census at tick ${base.tick}`);
  const ledger = base.ledger;
  const residual = ledger.initial + ledger.renewed - ledger.dissipated - ledger.deathLoss - (census.particleEnergy + census.foodEnergy);
  invariant(Number.isFinite(residual) && Math.abs(residual) <= 1e-6, `${label}: energy ledger residual ${residual} at tick ${base.tick}`);
  return residual;
}

function countsFrom(sample: MotifSample): number[] { return [...sample.histogram.counts]; }

function gzipCountBytes(counts: readonly number[]): number {
  invariant(counts.length === 432 && counts.every(n => Number.isInteger(n) && n >= 0 && n <= 255), 'Expected 432 occupancy counts in [0,255]');
  // Node's gzip wrapper writes a zero timestamp; pin level and runtime below.
  return gzipSync(Uint8Array.from(counts.map(count => Math.min(255, count))), { level: 9 }).byteLength;
}

function scalarSample(tick: number, world: MotifWorld, previous: MotifSample | undefined): ScalarSample {
  const sample = world.sampledObservations.at(-1);
  invariant(sample?.tick === tick, `Missing wrapper sample at ${tick}`);
  const census = sample.census;
  const residual = assertFiniteWorld(world, `${world.motif.id}/${world.base.seed}`);
  return {
    tick,
    actualTick: world.tick,
    population: census.population,
    families: [...census.counts],
    births: census.births,
    deaths: census.deaths,
    mutations: census.mutations,
    maxGeneration: census.maxGeneration,
    meanSpeed: census.meanSpeed,
    occupiedBins: sample.occupiedBins,
    textureChange: previous ? totalVariationDistance(sample.histogram, previous.histogram) : null,
    energyResidual: residual,
    stateHash: snapshotHash(world),
    gzipBytes: gzipCountBytes(countsFrom(sample)),
    counts: countsFrom(sample),
  };
}

function heldScalarSample(tick: number, world: MotifWorld): ScalarSample {
  invariant(world.extinctionTick !== null && world.tick === world.extinctionTick, 'Held samples require an exactly extinct world');
  const sample = world.sampledObservations.at(-1)!;
  const census = world.base.census();
  const residual = assertFiniteWorld(world, `${world.motif.id}/${world.base.seed}/held`);
  const counts = [...sample.histogram.counts];
  return {
    tick,
    actualTick: world.tick,
    population: census.population,
    families: [...census.counts],
    births: census.births,
    deaths: census.deaths,
    mutations: census.mutations,
    maxGeneration: census.maxGeneration,
    meanSpeed: census.meanSpeed,
    occupiedBins: sample.occupiedBins,
    textureChange: 0,
    energyResidual: residual,
    stateHash: snapshotHash(world),
    gzipBytes: gzipCountBytes(counts),
    counts,
  };
}

function initialGeometryHash(world: MotifWorld): string {
  const state = world.base.snapshot();
  const particles = world.base.particles.map(({ traits: _traits, ...particle }) => particle);
  return canonicalHash({ seed: world.base.seed, particles, food: world.base.food, ledger: world.base.ledger, tick: world.tick,
    history: world.base.history.map(({ traitSpread: _spread, ...census }) => census), rules: state.rules });
}

function sameInitialGeometry(a: MotifWorld, b: MotifWorld): boolean {
  return initialGeometryHash(a) === initialGeometryHash(b);
}

function recordAt(records: readonly ScalarSample[], tick: number): ScalarSample {
  const found = records.find(record => record.tick === tick);
  invariant(found, `Missing evidence sample at tick ${tick}`);
  return found;
}

function validatePairedGeometry(seedWorlds: readonly MotifWorld[], seed: number): string {
  const expected = initialGeometryHash(seedWorlds[0]);
  invariant(seedWorlds.every(world => world.base.seed === seed && initialGeometryHash(world) === expected), `Initial geometry mismatch for seed ${seed}`);
  return expected;
}

function checkKnownPreset(motif: MotifWorld, old: ParticleWorld, tick: number, label: string): void {
  invariant(motif.tick === old.tick && snapshotHash(motif) === snapshotHash(old), `${label}: known preset full snapshot mismatch at ${tick}`);
}

function runPair(motifId: string, seed: number, geometryHash: string): AnyRecord {
  const compiled = motifCatalog().find(item => item.id === motifId);
  invariant(compiled, `Unknown motif id: ${motifId}`);
  const baseline = new MotifWorld(seed, compiled);
  const replay = new MotifWorld(seed, compiled);
  invariant(sameInitialGeometry(baseline, replay), `${motifId}/${seed}: matched initial geometry failed`);
  const basePreset = compiled.sentence.interaction === 'chase' ? 'pursuit' : 'flocks';
  const known = compiled.sentence.habitat === 'still' && compiled.sentence.coordination === (basePreset === 'pursuit' ? 'independent' : 'aligned')
    ? new ParticleWorld(seed, basePreset, true, recipeForPreset(basePreset), { kind: 'still' }) : null;

  const initialRecord = scalarSample(0, baseline, undefined);
  const samples: ScalarSample[] = [initialRecord];
  const replaySamples: { tick: number; actualTick: number; stateHash: string }[] = [];
  const initialReplayHash = snapshotHash(replay);
  invariant(initialRecord.stateHash === initialReplayHash, `${motifId}/${seed}: tick-0 replay mismatch`);
  replaySamples.push({ tick: 0, actualTick: 0, stateHash: initialReplayHash });
  let last = 0;
  let prior: MotifSample | undefined = baseline.sampledObservations[0];
  while (baseline.tick < MAX_TICK && baseline.extinctionTick === null) {
    baseline.step(1);
    replay.step(1);
    if (known) known.step(1);
    assertFiniteWorld(baseline, `${motifId}/${seed}/baseline`);
    assertFiniteWorld(replay, `${motifId}/${seed}/replay`);
    if (known) invariant(known.particles.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.energy)), `${motifId}/${seed}/known preset invalid at ${known.tick}`);
    const current = baseline.tick;
    if (current % SAMPLE_EVERY === 0 || baseline.extinctionTick !== null) {
      const currentHash = snapshotHash(baseline);
      const replayHash = snapshotHash(replay);
      invariant(currentHash === replayHash, `${motifId}/${seed}: full replay mismatch at tick ${current}`);
      if (known) checkKnownPreset(baseline, known, current, `${motifId}/${seed}/${basePreset}`);
      const wrapperSample = baseline.sampledObservations.at(-1)!;
      const prevSample = prior;
      invariant(wrapperSample.tick === current, `${motifId}/${seed}: missing sample ${current}`);
      const record = scalarSample(current, baseline, prevSample);
      samples.push(record);
      prior = wrapperSample;
      last = current;
      replaySamples.push({ tick: current, actualTick: replay.tick, stateHash: replayHash });
    }
  }
  if (baseline.extinctionTick !== null) {
    const heldHash = snapshotHash(baseline);
    const heldReplayHash = snapshotHash(replay);
    invariant(heldHash === heldReplayHash, `${motifId}/${seed}: extinct replay state mismatch`);
    const frozenTick = baseline.tick;
    baseline.step(MAX_TICK - baseline.tick);
    replay.step(MAX_TICK - replay.tick);
    invariant(baseline.tick === frozenTick && replay.tick === frozenTick && snapshotHash(baseline) === heldHash && snapshotHash(replay) === heldReplayHash,
      `${motifId}/${seed}: extinct replay changed after its terminal tick`);
    for (let scheduledTick = Math.ceil((frozenTick + 1) / SAMPLE_EVERY) * SAMPLE_EVERY; scheduledTick <= MAX_TICK; scheduledTick += SAMPLE_EVERY) {
      samples.push(heldScalarSample(scheduledTick, baseline));
      replaySamples.push({ tick: scheduledTick, actualTick: replay.tick, stateHash: snapshotHash(replay) });
    }
  }
  invariant(baseline.tick === replay.tick && baseline.extinctionTick === replay.extinctionTick, `${motifId}/${seed}: replay termination mismatch`);
  invariant(last === baseline.tick || baseline.tick < MAX_TICK && baseline.extinctionTick === baseline.tick, `${motifId}/${seed}: final state was not recorded`);
  invariant(baseline.droppedSamples === 0 && replay.droppedSamples === 0, `${motifId}/${seed}: wrapper dropped samples`);

  const perturb = new MotifWorld(seed, compiled);
  const perturbSamples: AnyRecord[] = [];
  while (perturb.tick < PERTURB_TICK && perturb.extinctionTick === null) {
    perturb.step(1);
    assertFiniteWorld(perturb, `${motifId}/${seed}/perturb-replay`);
  }
  let perturbStatus: AnyRecord;
  if (perturb.extinctionTick !== null) {
    perturbStatus = { status: 'not-applicable', reason: 'world extinct before displacement at tick 1500', extinctAt: perturb.extinctionTick, records: [] };
  } else {
    const controlAt1500 = recordAt(samples, PERTURB_TICK);
    const preHash = snapshotHash(perturb);
    invariant(preHash === controlAt1500.stateHash, `${motifId}/${seed}: perturbation replay does not match at tick 1500`);
    const preHistogram = histogram(perturb.base.particles);
    const selected = perturb.base.particles.reduce<Particle | null>((smallest, particle) => smallest === null || particle.id < smallest.id ? particle : smallest, null);
    invariant(selected, `${motifId}/${seed}: perturbation has no living particle at 1500`);
    const beforePosition = { x: selected.x, y: selected.y };
    selected.x = ((selected.x + PERTURB_DX) % 1 + 1) % 1;
    const afterMovePosition = { x: selected.x, y: selected.y };
    const afterHistogram = histogram(perturb.base.particles);
    const postHash = snapshotHash(perturb);
    perturbSamples.push({ phase: 'before', tick: PERTURB_TICK, actualTick: perturb.tick, selectedId: selected.id,
      position: beforePosition, stateHash: preHash, fullStateHashMatch: preHash === controlAt1500.stateHash,
      textureChange: null, gzipBytes: gzipCountBytes([...preHistogram.counts]), counts: [...preHistogram.counts] });
    perturbSamples.push({ phase: 'after', tick: PERTURB_TICK, actualTick: perturb.tick, selectedId: selected.id,
      position: { x: selected.x, y: selected.y }, stateHash: postHash, fullStateHashMatch: postHash === controlAt1500.stateHash,
      textureChange: totalVariationDistance(afterHistogram, preHistogram), gzipBytes: gzipCountBytes([...afterHistogram.counts]), counts: [...afterHistogram.counts] });
    let comparisonTick = PERTURB_TICK;
    let pairIterations = 0;
    while (comparisonTick < MAX_TICK) {
      const nextTick = nextPairedEvidenceTick(comparisonTick);
      pairIterations++;
      invariant(pairIterations <= MAX_TICK - PERTURB_TICK, 'Paired evidence clock stopped advancing');
      if (perturb.extinctionTick === null && perturb.tick < nextTick) perturb.step(1);
      assertFiniteWorld(perturb, `${motifId}/${seed}/perturbed`);
      if (nextTick % SAMPLE_EVERY === 0) {
        const baselineRecord = recordAt(samples, nextTick);
        const baseHist: OccupancyHistogram = { population: baselineRecord.population, counts: baselineRecord.counts };
        const perturbHist = histogram(perturb.base.particles);
        const bHash = baselineRecord.stateHash;
        const pHash = snapshotHash(perturb);
        const tv = totalVariationDistance(perturbHist, baseHist);
        perturbSamples.push({ phase: 'after', tick: nextTick, baselineActualTick: baselineRecord.actualTick, perturbedActualTick: perturb.tick,
          selectedId: selected.id, stateHash: pHash, baselineStateHash: bHash, fullStateHashMatch: pHash === bHash,
          textureChange: tv, gzipBytes: gzipCountBytes([...perturbHist.counts]), baselineGzipBytes: gzipCountBytes([...baseHist.counts]),
          counts: [...perturbHist.counts], baselineCounts: [...baseHist.counts] });
      } else {
        // If an outcome freezes between samples, the held state is still
        // compared at the next shared scheduled time.
      }
      comparisonTick = nextTick;
    }
    invariant(pairIterations === MAX_TICK - PERTURB_TICK, 'Paired evidence did not visit every clock tick');
    perturbStatus = { status: 'perturbed', tick: PERTURB_TICK, displacementX: PERTURB_DX, selectedId: selected.id,
      beforePosition, afterPosition: afterMovePosition, records: perturbSamples };
  }
  invariant(perturb.droppedSamples === 0, `${motifId}/${seed}: perturbation wrapper dropped samples`);

  const baselineLateSamples = samples.filter(sample => sample.tick >= 2000 && sample.tick <= MAX_TICK && sample.tick % SAMPLE_EVERY === 0);
  invariant(baselineLateSamples.length === 11, `${motifId}/${seed}: expected all 11 late-range baseline observations`);
  const lateTexture = baselineLateSamples.map(sample => sample.textureChange).filter((value): value is number => value !== null);
  const lateGzip = baselineLateSamples.map(sample => sample.gzipBytes);
  const baselineLateSummary = {
    fromTick: 2000,
    toTick: MAX_TICK,
    observationCount: baselineLateSamples.length,
    textureChangeMean: lateTexture.reduce((sum, value) => sum + value, 0) / lateTexture.length,
    gzipBytes: { min: Math.min(...lateGzip), max: Math.max(...lateGzip) },
  };
  return {
    id: motifId,
    seed,
    initialGeometryHash: geometryHash,
    outcome: baseline.extinctionTick === null ? 'alive-at-3000' : 'extinct',
    finalTick: baseline.tick,
    extinctionTick: baseline.extinctionTick,
    wrapperDroppedSamples: baseline.droppedSamples,
    samples,
    baselineLateSummary,
    independentReplay: { matched: true, throughTick: baseline.tick, samples: replaySamples },
    knownPresetControl: known ? { preset: basePreset, matchedFullSnapshots: true, throughTick: baseline.tick } : null,
    pairedPerturbation: perturbStatus,
  };
}

function sourceHashes(): Record<string, string> {
  const paths = [
    'apps/lab/src/particles/model.ts',
    'apps/lab/src/particles/motifs.ts',
    'apps/lab/src/particles/motif-observers.ts',
    'tools/particles/explore-motifs.ts',
  ];
  const result: Record<string, string> = {};
  for (const path of paths) {
    const fsPath = new URL(`../../${path}`, import.meta.url);
    // sourceHashes is synchronous by design so the manifest is exactly stable.
    // These files are small, and the read occurs only before/after a fixed run.
    result[path] = createHash('sha256').update(readFileSync(fsPath)).digest('hex');
  }
  return result;
}

function expectedMatrix(): AnyRecord[] {
  return motifCatalog().map(motif => ({ id: motif.id, sentence: motif.sentence, recipe: motif.recipe, environment: motif.environment }));
}

function runtimeInfo() {
  return { node: process.versions.node, zlib: process.versions.zlib };
}

function buildMarkdown(data: AnyRecord): string {
  const runs = data.runs as AnyRecord[];
  const columns = ['Recipe', 'Seed', 'Outcome (actual tick)', 'Population at 1500', 'Population at 3000', 'Occupied bins', 'Gzip bytes at 3000', 'Mean baseline TV 2000–3000', 'Baseline gzip min–max 2000–3000', 'Post-move TV at 1500', 'Max paired TV from 2000'];
  const tableHeader = `| ${columns.join(' | ')} |`;
  const tableSeparator = `|${columns.map((_, index) => index === 0 || index === 2 ? '---' : '---:').join('|')}|`;
  const rows = runs.map(run => {
    const samples = run.samples as ScalarSample[];
    const at1500 = samples.find(sample => sample.tick === PERTURB_TICK);
    const at3000 = samples.find(sample => sample.tick === MAX_TICK) ?? samples.at(-1);
    const perturb = run.pairedPerturbation as AnyRecord;
    const perturbRecords = perturb.records as AnyRecord[] | undefined;
    const post1500 = perturbRecords?.find(record => record.phase === 'after' && record.tick === PERTURB_TICK);
    const late = perturbRecords?.filter(record => record.phase === 'after' && Number(record.tick) >= 2000) ?? [];
    const maxLateTV = late.length ? Math.max(...late.map(record => Number(record.textureChange))) : null;
    const baselineLate = run.baselineLateSummary as AnyRecord;
    const lateCompression = baselineLate.gzipBytes as AnyRecord;
    return `| ${run.id} | ${run.seed} | ${run.outcome} (${run.finalTick}) | ${at1500?.population ?? '—'} | ${at3000?.population ?? '—'} | ${at3000?.occupiedBins ?? '—'} | ${at3000?.gzipBytes ?? '—'} | ${Number(baselineLate.textureChangeMean).toFixed(4)} | ${lateCompression.min}–${lateCompression.max} | ${post1500?.textureChange ?? '—'} | ${maxLateTV ?? '—'} |`;
  });
  const extinct = runs.filter(run => run.outcome === 'extinct').length;
  const alive = runs.length - extinct;
  const familyNames = ['Mint', 'Amber', 'Lilac'];
  const familyAbsences = runs.flatMap(run => {
    const finalSample = (run.samples as ScalarSample[]).find(sample => sample.tick === MAX_TICK);
    invariant(finalSample, `${run.id}/${run.seed}: missing nominal tick-3000 sample`);
    return finalSample.families.flatMap((count, family) => count === 0 ? [`${run.id}/${run.seed}: ${familyNames[family]}`] : []);
  });
  for (const row of [tableHeader, tableSeparator, ...rows]) {
    invariant(row.split('|').length - 2 === columns.length, `Markdown evidence row has ${row.split('|').length - 2} cells; expected ${columns.length}`);
  }
  return `# Motif composition pilot evidence\n\n` +
`Fixed descriptive batch, grammar version ${data.grammarVersion}, generated by Node ${((data.runtime as AnyRecord).node)} / zlib ${((data.runtime as AnyRecord).zlib)}.\n\n` +
`## Method\n\n` +
`The complete matrix contains all 12 canonical recipes crossed with seeds 1201, 1202, and 1203. Each baseline and an independently initialized full replay advances through tick 3000 or freezes at exact extinction. Baseline state hashes are compared at tick 0, every 100 ticks, and exact extinction. The replay must match at every recorded point. Each world is checked every tick for finite bounded positions and energy, population at or below ${RULES.populationMax}, consistent family counts, and energy-ledger residual at most 1e-6.\n\n` +
`At tick 1500, a separately initialized perturbation replay must match the baseline full snapshot before the smallest living particle ID is moved by +1/12 in x with torus wrapping. The ordinary tick-1500 sample is pre-move. The evidence stores separate before and after records at tick 1500, then paired comparisons every 100 ticks through 3000. Every paired record includes histogram total variation and a full snapshot hash comparison. If a world becomes extinct, its state freezes and its actual tick remains visible.\n\n` +
`Initial geometry hashes exclude inherited attraction rows. Across the grammar, seed, positions, velocities, ages, lifespan, energy and food geometry are shared; the initial attraction traits intentionally vary with interaction. The two still/aligned-or-independent preset controls compare full base snapshots against the existing pursuit or flocks preset. The preset controls validate the composition mapping and observation path, not new physics.\n\n` +
`Occupancy uses 12×12 periodic bins and three families, stored as 432 integer counts at each baseline and perturbation sample. TV globally normalizes by each world's population and uses the observer's empty-population convention. The compression proxy is gzip level 9 over those 432 count bytes, with the 255 cap applied; it is coarse fixed-resolution compressibility and largely tracks occupied cells. The record contains scalar trajectories, histogram counts, state hashes, and paired perturbation evidence, without per-tick snapshots.\n\n` +
`## Outcomes\n\n` +
`Retained all ${runs.length} outcomes: ${alive} remained alive at tick 3000 and ${extinct} became extinct. No seed was replaced and no recipe was tuned. At nominal tick 3000, family absence occurred in ${familyAbsences.length ? familyAbsences.join("; ") : "no runs"}; this is distinct from whole-world extinction. Population, occupied spatial bins and gzip bytes are reported at nominal ticks 1500 and 3000, even when an extinct world is held at its earlier actual tick. Baseline late-range columns cover nominal ticks 2000–3000; the tick-1500 perturbation TV is measured immediately after the move. The late paired TV column is the maximum observed from tick 2000 onward; it is descriptive and does not indicate evolution or a stability threshold.\n\n` +
`${tableHeader}\n${tableSeparator}\n${rows.join('\n')}\n\n` +
`## Interpretation limits\n\n` +
`These results describe this fixed batch and the existing engineered toy model. A motif names initial composition: individual attraction rows can mutate and be inherited, while coordination and habitat remain supplied recipe settings. Chase does not mean predation. Seasonal and still worlds have the same offered food renewal total; capacity clipping can change realized input. Population survival, texture change, and gzip size do not establish adaptation, evolution, increasing complexity, criticality, or general survival. Post-perturbation divergence combines motion and demographic changes; because births consume sequence-based random draws, different birth paths can desynchronize subsequent random draws. Equal TV does not imply equal full state. No monotonic-growth assumption or watchability score is used.\n\n` +
`The batch is complete through 3000 ticks (or exact extinction) and is not extended before review. Node and zlib versions plus source hashes are recorded in the JSON. Regenerate the Markdown from that JSON with \`--check\`; \`--replay-check\` reruns the fixed batch and compares the full output.\n`;
}

async function generateArtifact(): Promise<AnyRecord> {
  invariant(process.versions.node === EXPECTED_NODE, `Evidence requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  const sourcesAtStart = sourceHashes();
  const motifs = motifCatalog();
  invariant(motifs.length === 12 && new Set(motifs.map(m => m.id)).size === 12, 'Grammar catalog is not the exact 12-recipe matrix');
  const geometryBySeed = new Map<number, { hash: string; worlds: MotifWorld[] }>();
  for (const seed of SEEDS) {
    const worlds = motifs.map(motif => new MotifWorld(seed, motif));
    const hash = validatePairedGeometry(worlds, seed);
    geometryBySeed.set(seed, { hash, worlds });
  }
  const runs: AnyRecord[] = [];
  for (const motif of motifs) {
    for (const seed of SEEDS) {
      const geometry = geometryBySeed.get(seed)!.hash;
      runs.push(runPair(motif.id, seed, geometry));
    }
  }
  invariant(JSON.stringify(sourceHashes()) === JSON.stringify(sourcesAtStart), 'Evidence sources changed during the run; discard this batch and rerun');
  const data: AnyRecord = {
    schemaVersion: 1,
    grammarVersion: 1,
    batch: { recipeCount: 12, seeds: [...SEEDS], maxTick: MAX_TICK, sampleEvery: SAMPLE_EVERY, perturbTick: PERTURB_TICK, perturbDx: PERTURB_DX },
    runtime: runtimeInfo(),
    rules: RULES,
    matrix: expectedMatrix(),
    geometryBySeed: Object.fromEntries([...geometryBySeed].map(([seed, value]) => [seed, value.hash])),
    sourceSha256: sourcesAtStart,
    runs,
  };
  return data;
}

async function writeEvidence(): Promise<void> {
  const data = await generateArtifact();
  await writeFile(JSON_URL, `${JSON.stringify(data)}\n`);
  await writeFile(MD_URL, buildMarkdown(data));
  process.stdout.write(`Wrote ${JSON_URL.pathname} and ${MD_URL.pathname} (${(JSON.stringify(data).length / 1024 / 1024).toFixed(2)} MiB JSON).\n`);
}

async function checkEvidence(): Promise<void> {
  invariant(process.versions.node === EXPECTED_NODE, `Evidence check requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  const raw = await readFile(JSON_URL, 'utf8');
  const data = JSON.parse(raw) as AnyRecord;
  invariant(JSON.stringify(data.rules) === JSON.stringify(RULES), 'Recorded rules differ from the current model rules');
  invariant(JSON.stringify(data.matrix) === JSON.stringify(expectedMatrix()), 'Recorded grammar settings/matrix differ from current compilation');
  invariant(JSON.stringify(data.runtime) === JSON.stringify(runtimeInfo()), 'Recorded Node/zlib runtime differs from current runtime');
  invariant(JSON.stringify(data.sourceSha256) === JSON.stringify(sourceHashes()), 'Source hash mismatch; regenerate evidence after reviewing the changed source');
  invariant(JSON.stringify(data.batch) === JSON.stringify({ recipeCount: 12, seeds: [...SEEDS], maxTick: MAX_TICK, sampleEvery: SAMPLE_EVERY, perturbTick: PERTURB_TICK, perturbDx: PERTURB_DX }), 'Recorded evidence settings/matrix differ');
  invariant((data.runs as unknown[]).length === 36, 'Expected all 36 recipe/seed outcomes');
  const ids = motifCatalog().map(motif => motif.id);
  for (const id of ids) for (const seed of SEEDS) invariant((data.runs as AnyRecord[]).some(run => run.id === id && run.seed === seed), `Missing ${id}/${seed}`);
  const markdown = await readFile(MD_URL, 'utf8');
  invariant(markdown === buildMarkdown(data), 'Markdown does not match the accepted JSON evidence');
  process.stdout.write('Evidence freshness, runtime, rule settings, full matrix, and Markdown checks passed.\n');
}

async function replayCheck(): Promise<void> {
  invariant(process.versions.node === EXPECTED_NODE, `Replay check requires Node ${EXPECTED_NODE}; found ${process.versions.node}`);
  const prior = JSON.parse(await readFile(JSON_URL, 'utf8')) as AnyRecord;
  const current = await generateArtifact();
  invariant(JSON.stringify(prior) === JSON.stringify(current), 'Full fixed-batch replay differs from the accepted JSON evidence');
  invariant((await readFile(MD_URL, 'utf8')) === buildMarkdown(current), 'Regenerated Markdown differs from accepted evidence');
  process.stdout.write('Full fixed-batch replay exactly matches JSON and Markdown evidence.\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv[2];
  if (mode === '--write') await writeEvidence();
  else if (mode === '--check') await checkEvidence();
  else if (mode === '--replay-check') await replayCheck();
  else throw new Error('Usage: node tools/particles/explore-motifs.ts --write | --check | --replay-check');
}

