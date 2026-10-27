/** Node 24: node tools/particles/explore-oases.ts [--check]. Fixed descriptive sweep; no tuning. */
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ParticleWorld, RULES, torusDelta } from '../../apps/lab/src/particles/model.ts';
import type { ParticleEnvironment } from '../../apps/lab/src/particles/model.ts';

const duration = 6000, sampleEvery = 100, seeds = [1201, 1202, 1203];
const environments: { label: string; environment: ParticleEnvironment }[] = [
  { label: 'still', environment: { kind: 'still' } },
  { label: 'slow', environment: { kind: 'travelling', speed: .0001 } },
  { label: 'faster', environment: { kind: 'travelling', speed: .00025 } },
];
const files = ['apps/lab/src/particles/model.ts', 'tools/particles/explore-oases.ts'];
const helper = 'apps/lab/src/particles/environment.ts';
if (existsSync(new URL(`../../${helper}`, import.meta.url))) files.push(helper);
const sourceHashes = Object.fromEntries(files.map(path => [path, createHash('sha256').update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest('hex')]));
const output = new URL('../../docs/creative-prototypes/oases-pilot.json', import.meta.url);
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--check')) throw new Error('Usage: node tools/particles/explore-oases.ts [--check]');
if (args[0] === '--check') {
  const saved = JSON.parse(readFileSync(output, 'utf8'));
  deepStrictEqual(saved.sourceHashes, sourceHashes, 'Oases evidence is stale: source changed');
  deepStrictEqual(saved.rules, RULES, 'Oases evidence is stale: rules changed');
  console.log('Oases source hashes and rules match. No simulation or file writes.');
  process.exit(0);
}
function contains(p: { x: number; y: number }, patch: ParticleWorld['food'][number]) {
  const dx = torusDelta(p.x - patch.x), dy = torusDelta(p.y - patch.y);
  return dx * dx + dy * dy <= patch.radius * patch.radius;
}
function patchIndex(world: ParticleWorld, p: { x: number; y: number }) { return world.food.findIndex(patch => contains(p, patch)); }
function observation(world: ParticleWorld) {
  return {
    ...world.census(),
    patches: world.food.map((patch, index) => ({ index, x: patch.x, y: patch.y, radius: patch.radius, stock: patch.amount, occupancy: world.particles.filter(p => contains(p, patch)).length })),
    fractionInsideAnyPatch: world.particles.length ? world.particles.filter(p => patchIndex(world, p) !== -1).length / world.particles.length : null,
  };
}
function interval(startTick: number) { return { startTick, endTick: startTick, matchedPairs: 0, displacementSum: 0, contactChanges: 0, entries: 0, exits: 0, switches: 0, transitions: Array.from({ length: 10 }, () => Array<number>(10).fill(0)) }; }
const results = [];
for (const { label, environment } of environments) for (const seed of seeds) {
  const world = new ParticleWorld(seed, 'pursuit', true, undefined, environment);
  const history = [observation(world)];
  const intervals = [];
  let currentInterval = interval(1);
  const transitions = Array.from({ length: 10 }, () => Array<number>(10).fill(0));
  let matchedPairs = 0, displacementSum = 0, contactChanges = 0, capTicks = 0, maximumEnergyResidual = 0;
  let minimumPopulation = world.particles.length, maximumPopulation = world.particles.length;
  let after1000: { minimum: number; maximum: number; sampledTicks: number } | null = null;
  let extinctionTick: number | null = null;
  for (let scheduledTick = 1; scheduledTick <= duration; scheduledTick++) {
    const before = new Map(world.particles.map(p => [p.id, { x: p.x, y: p.y, patch: patchIndex(world, p) }]));
    world.step();
    let pairs = 0, distance = 0, changes = 0, entries = 0, exits = 0, switches = 0;
    for (const p of world.particles) {
      const previous = before.get(p.id);
      if (!previous) continue;
      pairs++;
      distance += Math.hypot(torusDelta(p.x - previous.x), torusDelta(p.y - previous.y));
      const next = patchIndex(world, p);
      transitions[previous.patch + 1][next + 1]++;
      currentInterval.transitions[previous.patch + 1][next + 1]++;
      if (previous.patch !== next) {
        changes++;
        if (previous.patch === -1) entries++;
        else if (next === -1) exits++;
        else switches++;
      }
    }
    const population = world.particles.length, atCap = Number(population === RULES.populationMax);
    currentInterval.endTick = world.tick;
    currentInterval.matchedPairs += pairs; currentInterval.displacementSum += distance;
    currentInterval.contactChanges += changes; currentInterval.entries += entries; currentInterval.exits += exits; currentInterval.switches += switches;
    matchedPairs += pairs; displacementSum += distance; contactChanges += changes; capTicks += atCap;
    minimumPopulation = Math.min(minimumPopulation, population); maximumPopulation = Math.max(maximumPopulation, population);
    if (world.tick > 1000) {
      if (!after1000) after1000 = { minimum: population, maximum: population, sampledTicks: 0 };
      after1000.minimum = Math.min(after1000.minimum, population); after1000.maximum = Math.max(after1000.maximum, population); after1000.sampledTicks++;
    }
    const census = world.census();
    const residual = census.particleEnergy + census.foodEnergy + world.ledger.dissipated + world.ledger.deathLoss - world.ledger.initial - world.ledger.renewed;
    maximumEnergyResidual = Math.max(maximumEnergyResidual, Math.abs(residual));
    if (world.tick % sampleEvery === 0 || !population) {
      history.push(observation(world));
      const { transitions: matrix, ...values } = currentInterval;
      intervals.push({ ...values, meanMinimumImageDisplacement: values.matchedPairs ? values.displacementSum / values.matchedPairs : null, contactChangeFraction: values.matchedPairs ? values.contactChanges / values.matchedPairs : null, contactTransitions: matrix.flatMap((row, from) => row.flatMap((count, to) => count ? [[from - 1, to - 1, count]] : [])) });
      currentInterval = interval(world.tick + 1);
    }
    if (!population) { extinctionTick = world.tick; break; }
  }
  const result = {
    label, environment: world.environment, seed, scheduledTargetTick: duration, finishedTick: world.tick, extinctionTick,
    populationRange: { minimum: minimumPopulation, maximum: maximumPopulation }, populationRangeAfter1000: after1000,
    matchedSurvivingIdPairs: matchedPairs, displacementSum, meanMinimumImageDisplacement: matchedPairs ? displacementSum / matchedPairs : null,
    contactChanges, contactChangeFraction: matchedPairs ? contactChanges / matchedPairs : null, contactTransitions: transitions,
    capTicks, capTickFraction: world.tick ? capTicks / world.tick : null, maximumEnergyResidual,
    final: observation(world), ledger: { ...world.ledger }, history, intervals,
  };
  results.push(result);
  console.log(`${label} seed ${seed}: finished=${world.tick}, population=${world.particles.length}, range=${minimumPopulation}-${maximumPopulation}, after1000=${after1000?.minimum ?? 'none'}-${after1000?.maximum ?? 'none'}, contactChanges=${contactChanges}/${matchedPairs}, extinct=${extinctionTick ?? 'no'}`);
}
const moving = results.filter(r => r.environment.kind === 'travelling');
const allMovingExtinctBefore1000 = moving.every(r => r.extinctionTick !== null && r.extinctionTick < 1000);
const artifact = {
  kind: 'particle-oases-descriptive-pilot', runtime: process.version, sourceHashes, rules: RULES,
  settings: { seeds, duration, sampleEvery, preset: 'pursuit', mutation: true, environments },
  definitions: {
    occupancy: 'Geometric containment by minimum-image squared distance <= radius squared. Each patch counts independently; overlaps double-count. fractionInsideAnyPatch counts the union once, null for an empty population.',
    displacement: 'Each tick compares pre-step and post-step positions of IDs present at both endpoints, excluding births and deaths. Minimum-image Euclidean displacement in world widths. The aggregate weights each surviving-ID pair equally; null when no pairs.',
    contacts: 'First geometrically containing patch in fixed food-array order, or outside (-1). This matches feeding patch priority but does not assert food was consumed. Entries, exits and switches compare surviving IDs before and after a tick, including patch motion. Contact changes do not establish regrouping or following.',
    intervalStorage: 'Motion and contact measures are computed every tick, then stored as consecutive 100-tick interval sums and matched-pair weighted means; the final interval ends at extinction if earlier. Interval contactTransitions are sparse [priorPatchIndex, nextPatchIndex, count] triples with -1 for outside. No per-tick rows are retained.',
    contactTransitions: '10x10 aggregate matrix: row is prior contact, column is new contact. Index 0 means outside; indices 1-9 mean patch indices 0-8. Includes unchanged contacts. Sum equals matchedSurvivingIdPairs.',
    populationRange: 'Overall includes tick zero. After1000 includes completed ticks strictly greater than 1000, null if none. Ranges include an extinction tick when reached.',
    clocks: 'scheduledTargetTick is 6000. Each run stops at extinction; finishedTick and patches freeze there. Histories include tick zero, every100 completed ticks, and extinction. No synthetic later zero samples.',
    caps: 'Ending population equals the fixed population cap at a completed tick. Cap fraction divides by completed ticks.',
    interpretation: 'Supplied food steering and moving patches are engineered. These descriptive measures do not prove adaptation, autonomous following, or group regrouping. Replay promises apply within one runtime only.',
  },
  stops: { allMovingExtinctBefore1000, speedReductionApplied: false }, results,
};
writeFileSync(output, JSON.stringify(artifact) + '\n');
const rows = results.map(r => `| ${r.label} | ${r.seed} | ${r.finishedTick} | ${r.final.population} | ${r.populationRange.minimum}–${r.populationRange.maximum} | ${r.populationRangeAfter1000 ? `${r.populationRangeAfter1000.minimum}–${r.populationRangeAfter1000.maximum}` : '—'} | ${r.meanMinimumImageDisplacement?.toFixed(6) ?? '—'} | ${r.contactChangeFraction?.toFixed(4) ?? '—'} | ${r.capTicks} | ${r.extinctionTick ?? '—'} |`).join('\n');
writeFileSync(new URL('../../docs/creative-prototypes/oases-pilot.md', import.meta.url), `# Travelling oases descriptive pilot\n\nNine fixed runs: pursuit, mutation enabled, seeds 1201–1203, still / slow (0.0001) / faster (0.00025), target 6,000 ticks. No interventions or tuning. Runtime ${process.version}; toy rules version ${RULES.version}.\n\n| Environment | Seed | Completed | Final population | Overall range | Range after 1000 | Mean displacement | Contact-change fraction | Cap ticks | Extinction tick |\n|---|---:|---:|---:|---|---|---:|---:|---:|---:|\n${rows}\n\nDisplacement is minimum-image distance for IDs surviving each tick, excluding births/deaths; the aggregate weights surviving-ID pairs equally. Contact-change fraction counts first-containing-patch changes among those pairs, including entry/exit and motion of the patches. Neither quantity establishes regrouping or following. Patch occupancy is geometric and double-counts overlaps; inside-any-patch fraction counts their union once. Supplied nearest-patch steering influences motion.\n\nAll moving runs extinct before tick 1000: **${allMovingExtinctBefore1000 ? 'yes' : 'no'}**. No speed reduction applied. Maximum absolute energy-accounting residual: ${Math.max(...results.map(r => r.maximumEnergyResidual)).toExponential(3)}. Population cap pressure is reported, not treated as success.\n\nFull 100-tick censuses, patch stocks/occupancies, 100-tick interval aggregates of every-tick matched-ID displacement and contact counts, contact-transition matrices and exact source hashes are in [oases-pilot.json](oases-pilot.json). The evidence uses its own full history, not the page's rolling 3,000-tick chart. Replay is promised only within one runtime. The [visual inspection](oases-visual-check.md) records screenshot observations and local recording paths; those gitignored recordings are not shipped in this PR.\n\nReproduce: \`node tools/particles/explore-oases.ts\`. The [compatibility receipt](oases-still-compatibility.jsonl) is the stdout of \`node tools/particles/check-still-compatibility.ts\`; it verifies complete preserved v2 outcomes and the still-arm census prefix. Freshness check without simulation/writes: \`node tools/particles/explore-oases.ts --check\`.\n`);
