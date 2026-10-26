/** Fixed descriptive bond pilot. Node 24.2.0; --check validates saved evidence without simulation or writes. */
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { ParticleWorld, RULES } from '../../apps/lab/src/particles/model.ts';
import { BondedWorld, BOND_RULES } from '../../apps/lab/src/particles/bonded-model.ts';
import type { BondMode } from '../../apps/lab/src/particles/bonded-model.ts';

const seeds = [1201, 1202, 1203] as const;
const modes: BondMode[] = ['none', 'chains', 'mesh'];
const duration = 6000, sampleEvery = 100;
const preset = 'pursuit' as const, mutation = true;
const sourceFiles = ['apps/lab/src/particles/model.ts', 'apps/lab/src/particles/bonded-model.ts', 'tools/particles/explore-bonds.ts'];
const sourceHashes = Object.fromEntries(sourceFiles.map(path => [path, createHash('sha256').update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest('hex')]));
const output = new URL('../../docs/creative-prototypes/bonds-pilot.json', import.meta.url);
const report = new URL('../../docs/creative-prototypes/bonds-pilot.md', import.meta.url);
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--check')) throw new Error('Usage: node tools/particles/explore-bonds.ts [--check]');
const settings = { seeds, modes, duration, sampleEvery, preset, mutation, sameFood: { kind: 'still' } };

if (args[0] === '--check') {
  const saved = JSON.parse(readFileSync(output, 'utf8'));
  if (saved.runtime !== process.version) throw new Error(`Bond evidence runtime is stale: ${saved.runtime} != ${process.version}`);
  if (saved.rulesVersion !== RULES.version) throw new Error(`Base model version is stale: ${saved.rulesVersion} != ${RULES.version}`);
  deepStrictEqual(saved.sourceHashes, sourceHashes, 'Bond evidence is stale: model, wrapper, or runner source changed');
  deepStrictEqual(saved.baseRules, RULES, 'Bond evidence is stale: base rules changed');
  deepStrictEqual(saved.bondRules, BOND_RULES, 'Bond evidence is stale: wrapper rules changed');
  deepStrictEqual(saved.settings, settings, 'Bond evidence settings changed');
  if (!Array.isArray(saved.results) || saved.results.length !== 9) throw new Error('Bond evidence expected exactly nine runs');
  deepStrictEqual([...new Set(saved.results.map((r: { seed: number }) => r.seed))].sort(), [...seeds], 'Bond evidence seed set is incomplete');
  deepStrictEqual([...new Set(saved.results.map((r: { mode: BondMode }) => r.mode))].sort(), [...modes].sort(), 'Bond evidence mode set is incomplete');
  const matrix = saved.results.map((r: { mode: BondMode; seed: number }) => `${r.mode}/${r.seed}`).sort();
  deepStrictEqual(matrix, modes.flatMap(mode => seeds.map(seed => `${mode}/${seed}`)).sort(), 'Bond evidence must contain each seed/mode pair exactly once');
  if (new Set(matrix).size !== 9) throw new Error('Bond evidence contains duplicate seed/mode pairs');
  console.log(`Bond evidence hashes, base version ${RULES.version}, runtime ${process.version}, rules, settings, and exact 3×3 matrix match. No simulation or writes.`);
  process.exit(0);
}

const energyResidual = (world: ParticleWorld) => {
  const c = world.census();
  return c.particleEnergy + c.foodEnergy + world.ledger.dissipated + world.ledger.deathLoss - world.ledger.initial - world.ledger.renewed;
};
function assertHealthy(world: BondedWorld) {
  const base = world.base, finite = Number.isFinite;
  if (base.particles.length > RULES.populationMax) throw new Error(`Population cap exceeded at tick ${base.tick}: ${base.particles.length}`);
  for (const p of base.particles) {
    if (![p.x, p.y, p.vx, p.vy, p.energy].every(finite) || p.x < 0 || p.x >= 1 || p.y < 0 || p.y >= 1 || p.energy < 0 || p.energy > RULES.maxEnergy || Math.hypot(p.vx, p.vy) > RULES.speedMax + 1e-12) throw new Error(`Particle bounds/finite check failed at tick ${base.tick}, id ${p.id}`);
  }
  for (const [index, p] of base.food.entries()) {
    if (![p.x, p.y, p.radius, p.amount].every(finite) || p.x < 0 || p.x >= 1 || p.y < 0 || p.y >= 1 || p.radius <= 0 || p.amount < 0 || p.amount > RULES.foodCapacity + 1e-9) throw new Error(`Food stock/position bounds check failed at tick ${base.tick}, patch ${index}`);
  }
  for (const [name, value] of Object.entries(base.ledger)) if (!finite(value) || value < 0) throw new Error(`Ledger finite/non-negative check failed at tick ${base.tick}, ${name}`);
  const residual = energyResidual(base);
  if (!finite(residual) || Math.abs(residual) > 1e-6) throw new Error(`Energy residual ${residual} exceeds 1e-6 at tick ${base.tick}`);
  const byId = new Map(base.particles.map(p => [p.id, p]));
  const degree = new Map<number, number>();
  const pairs = new Set<string>();
  const cap = world.mode === 'chains' ? BOND_RULES.chainsDegreeMax : world.mode === 'mesh' ? BOND_RULES.meshDegreeMax : 0;
  for (const edge of world.bonds) {
    if (!Number.isSafeInteger(edge.a) || !Number.isSafeInteger(edge.b) || !Number.isSafeInteger(edge.bornTick) || edge.a >= edge.b || edge.bornTick < 1 || edge.bornTick > base.tick) throw new Error(`Invalid bond record at tick ${base.tick}`);
    const a = byId.get(edge.a), b = byId.get(edge.b);
    if (!a || !b) throw new Error(`Bond has a dead/missing endpoint at tick ${base.tick}: ${edge.a}:${edge.b}`);
    if (a.family !== b.family) throw new Error(`Cross-family bond at tick ${base.tick}: ${edge.a}:${edge.b}`);
    const key = `${edge.a}:${edge.b}`;
    if (pairs.has(key)) throw new Error(`Duplicate bond at tick ${base.tick}: ${key}`);
    pairs.add(key);
    degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
    degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
  }
  for (const [id, value] of degree) if (value > cap) throw new Error(`Degree ${value} exceeds cap ${cap} at tick ${base.tick}, id ${id}`);
  if (world.mode === 'none' && world.bonds.length) throw new Error(`None mode has edges at tick ${base.tick}`);
  const summary = world.graphSummary();
  if (!Object.values(summary).every(value => typeof value !== 'number' || finite(value))) throw new Error(`Graph summary has a nonfinite number at tick ${base.tick}`);
  return Math.abs(residual);
}
const sample = (world: BondedWorld) => {
  const graph = world.graphSummary();
  return { tick: world.tick, census: world.census(), graph, liveEdgeFraction: graph.population ? (graph.nodes - graph.isolatedParticles) / graph.population : null };
};

const directBySeed = new Map<number, ParticleWorld>();
const initialSnapshots = new Map<number, unknown>();
for (const seed of seeds) {
  const initialWorld = new ParticleWorld(seed, preset, mutation);
  directBySeed.set(seed, new ParticleWorld(seed, preset, mutation));
  initialSnapshots.set(seed, initialWorld.snapshot());
}
const results = [];
for (const mode of modes) for (const seed of seeds) {
  const world = new BondedWorld(seed, preset, mutation, mode);
  const direct = directBySeed.get(seed)!;
  deepStrictEqual(world.base.snapshot(), initialSnapshots.get(seed), `Initial base state differs within seed ${seed}/${mode}`);
  let initialResidual = assertHealthy(world);
  const history = [sample(world)];
  const lifetimeGroups = Object.fromEntries(['stretchBreak/beforeStep', 'stretchBreak/afterDeath', 'deathRemoval/beforeStep', 'deathRemoval/afterDeath'].map(key => [key, { count: 0, sum: 0, histogram: new Map<number, number>() }])) as Record<string, { count: number; sum: number; histogram: Map<number, number> }>;
  const intervalRows: { startTick: number; endTick: number; formations: number; stretchBreaks: number; deathRemovals: number; suppliedNetImpulseMagnitude: number }[] = [];
  let intervalStart = 1, intervalFormations = 0, intervalStretch = 0, intervalDeath = 0, intervalImpulseBase = 0;
  let maximumAbsEnergyResidual = initialResidual, minimumPopulation = world.particles.length, maximumPopulation = world.particles.length;
  let minimumComponentCount = world.graphSummary().linkedComponents, maximumComponentCount = minimumComponentCount;
  let largestComponentEver = world.graphSummary().largestComponent;
  let capTicks = 0, extinctionTick: number | null = null, equalNoneSnapshots = mode === 'none' ? 1 : 0;
  let previousImpulse = world.graphSummary().netImpulseMagnitude;
  let seenRemovalEventCount = 0;
  for (let scheduledTick = 1; scheduledTick <= duration; scheduledTick++) {
    if (!world.particles.length) break;
    const before = world.graphSummary();
    world.step(1);
    if (mode === 'none') {
      direct.step(1);
      if (world.tick % sampleEvery === 0 || !world.particles.length || world.tick === duration) {
        deepStrictEqual(world.base.snapshot(), direct.snapshot(), `None-mode full base snapshot differs at seed ${seed}, tick ${world.tick}`);
        equalNoneSnapshots++;
      }
    }
    const residual = assertHealthy(world);
    maximumAbsEnergyResidual = Math.max(maximumAbsEnergyResidual, residual);
    const summary = world.graphSummary();
    intervalFormations += summary.formations - before.formations;
    intervalStretch += summary.stretchBreaks - before.stretchBreaks;
    intervalDeath += summary.deathRemovals - before.deathRemovals;
    intervalImpulseBase += summary.netImpulseMagnitude - previousImpulse;
    previousImpulse = summary.netImpulseMagnitude;
    const events = world.removalEvents;
    const eventCount = world.removalEventCount;
    const newEvents = eventCount - seenRemovalEventCount;
    if (newEvents < 0 || newEvents > events.length) throw new Error(`Removal event stream lost data at tick ${world.tick}`);
    for (const event of events.slice(events.length - newEvents)) {
      const group = lifetimeGroups[`${event.cause}/${event.stage}`];
      if (!group || !Number.isSafeInteger(event.completedTicks) || event.completedTicks < 0) throw new Error(`Invalid edge-removal event at tick ${world.tick}`);
      group.count++; group.sum += event.completedTicks;
      group.histogram.set(event.completedTicks, (group.histogram.get(event.completedTicks) ?? 0) + 1);
    }
    seenRemovalEventCount = eventCount;
    minimumPopulation = Math.min(minimumPopulation, summary.population);
    maximumPopulation = Math.max(maximumPopulation, summary.population);
    minimumComponentCount = Math.min(minimumComponentCount, summary.linkedComponents);
    maximumComponentCount = Math.max(maximumComponentCount, summary.linkedComponents);
    largestComponentEver = Math.max(largestComponentEver, summary.largestComponent);
    if (summary.population === RULES.populationMax) capTicks++;
    if (world.tick % sampleEvery === 0 || !summary.population) {
      history.push(sample(world));
      intervalRows.push({ startTick: intervalStart, endTick: world.tick, formations: intervalFormations, stretchBreaks: intervalStretch, deathRemovals: intervalDeath, suppliedNetImpulseMagnitude: intervalImpulseBase });
      intervalStart = world.tick + 1; intervalFormations = 0; intervalStretch = 0; intervalDeath = 0; intervalImpulseBase = 0;
    }
    if (!summary.population) { extinctionTick = world.tick; break; }
  }
  if (intervalStart <= world.tick && (intervalStart <= 6000)) intervalRows.push({ startTick: intervalStart, endTick: world.tick, formations: intervalFormations, stretchBreaks: intervalStretch, deathRemovals: intervalDeath, suppliedNetImpulseMagnitude: intervalImpulseBase });
  const final = sample(world);
  if (!history.some(row => row.tick === world.tick)) history.push(final);
  const removedEdgeLifetimeByCauseAndStage = Object.fromEntries(Object.entries(lifetimeGroups).map(([key, group]) => {
    let remaining = (group.count - 1) / 2, median = 0;
    for (const [age, frequency] of [...group.histogram].sort((a, b) => a[0] - b[0])) {
      if (remaining < frequency) { median = age; break; }
      if (remaining === frequency - 0.5) { median = age; break; }
      remaining -= frequency;
    }
    // Correct the even-count median from the two central order statistics.
    if (group.count && group.count % 2 === 0) {
      const ordered = [...group.histogram].sort((a, b) => a[0] - b[0]);
      let loIndex = group.count / 2 - 1, hiIndex = group.count / 2, lo = 0, hi = 0, index = 0;
      for (const [age, frequency] of ordered) for (let n = 0; n < frequency; n++, index++) { if (index === loIndex) lo = age; if (index === hiIndex) hi = age; }
      median = (lo + hi) / 2;
    }
    return [key, { count: group.count, meanCompletedTicks: group.count ? group.sum / group.count : null, medianCompletedTicks: group.count ? median : null }];
  }));
  const result = {
    mode, seed, preset, mutation, scheduledTargetTick: duration, finishedTick: world.tick, extinctionTick,
    initialConditionsEqualWithinSeed: true,
    noneFullSnapshotComparisons: mode === 'none' ? equalNoneSnapshots : null,
    populationRange: { minimum: minimumPopulation, maximum: maximumPopulation },
    linkedComponentCountRange: { minimum: minimumComponentCount, maximum: maximumComponentCount }, largestComponentEver,
    capTicks, capTickFraction: world.tick ? capTicks / world.tick : null, maximumAbsEnergyResidual,
    cumulative: final.graph ? { formations: final.graph.formations, stretchBreaks: final.graph.stretchBreaks, deathRemovals: final.graph.deathRemovals, netImpulseMagnitude: final.graph.netImpulseMagnitude } : null,
    removedEdgeLifetimeByCauseAndStage, final, history, intervals: intervalRows, ledger: { ...world.base.ledger },
  };
  results.push(result);
  console.log(`${mode} seed ${seed}: finished=${world.tick}, population=${final.census.population}, edges=${final.graph.edgeCount}, components=${final.graph.linkedComponents}, largest=${final.graph.largestComponent}, extinct=${extinctionTick ?? 'no'}`);
}

const bondedRuns = results.filter(r => r.mode !== 'none');
const allBondedExtinctBefore1000 = bondedRuns.length === 6 && bondedRuns.every(r => r.extinctionTick !== null && r.extinctionTick < 1000);
const artifact = {
  kind: 'particle-bonded-shapes-descriptive-pilot', runtime: process.version, rulesVersion: RULES.version, baseRules: RULES, bondRules: BOND_RULES, sourceHashes, settings,
  definitions: {
    graph: 'Nodes are living particles; linkedComponents count connected components of size >=2; isolatedParticles are unlinked living particles; largestComponent is 0 when there are no edges. Graph components are not organisms, offspring, or mutation units.',
    isolatedFraction: 'isolatedParticles divided by population; null at zero population. liveEdgeFraction is (nodes - isolatedParticles) / population, the living-particle share incident to at least one live edge; null at zero population.',
    meanDegree: '2 × live edge count / living population; null at zero population. Median live-edge age uses completed-tick convention age = currentTick - bornTick + 1; null when no edge exists.',
    edgeLifetimes: 'Removal event records include cause and stage. completedTicks is the number of completed ticks for which the edge existed: stretch/dead-end removals before a step use the prior completed tick; death cleanup after base.step includes the tick where endpoint death occurred.',
    thresholds: 'For descriptive labels only, a median live-edge age >= 100 ticks is persistent at the sampling interval scale; a median completed lifetime < 100 ticks among removed edges is rapid churn. Null medians mean there is no basis for the label.',
    suppliedSteering: 'netImpulseMagnitude is the cumulative sum over ticks of each particle’s magnitude of its net added velocity impulse. It is supplied steering, not physical work, energy, or an energy-ledger term. Interval rows store cumulative differences.',
    ledger: 'Residual = particleEnergy + foodEnergy + dissipated + deathLoss - initial - renewed. It is checked each tick against absolute tolerance 1e-6. It excludes steering by design.',
    checks: 'Every tick validates finite particle/food/ledger/summary values, positions in [0,1), particle speed <= base speedMax + 1e-12 after the base step, particle energy in [0,maxEnergy], population <= 240, food stock in [0,35] with 1e-9 tolerance, edge endpoint/self/duplicate/family/degree rules, and absolute ledger residual <=1e-6.',
    sampling: 'Base census and graphSummary are stored at tick 0, each 100 completed ticks, and exact extinction. Per-tick checks and cumulative impulse differences run every living tick. None mode full base snapshots are compared with a directly stepped ParticleWorld at tick 0 and every sampled/final point.',
    comparison: 'Within each seed, none/chains/mesh share the same initial base snapshot. Different seeds are independent. None-mode snapshots are full exact snapshot comparisons to a direct ParticleWorld; extension metadata is not compared.',
    stops: 'All six bonded runs extinct before tick 1000 is recorded as the prespecified early-collapse stop. All nine fixed runs are retained. Invalid invariant data aborts the batch; no tuning, rescue, or parameter search is performed.',
    limits: 'Descriptive engineered toy evidence. Bonds are supplied nearest-first engineering with deterministic tie breaks; they are not emergent organisms. Same-runtime seeded replay only. This artifact does not include a visual judgment.',
  },
  stops: { allBondedExtinctBefore1000, stopTriggered: allBondedExtinctBefore1000, noTuningPerformed: true, invalidDataPolicy: 'abort batch and discard evidence' }, results,
};
writeFileSync(output, JSON.stringify(artifact) + '\n');
const rows = results.map(r => {
  const g = r.final.graph;
  return `| ${r.mode} | ${r.seed} | ${r.finishedTick} | ${r.extinctionTick ?? '—'} | ${r.populationRange.minimum}–${r.populationRange.maximum} | ${g.edgeCount} | ${g.linkedComponents} (${r.linkedComponentCountRange.minimum}–${r.linkedComponentCountRange.maximum}) | ${r.largestComponentEver} | ${r.final.liveEdgeFraction?.toFixed(3) ?? '—'} | ${g.isolatedFraction?.toFixed(3) ?? '—'} | ${g.meanDegree?.toFixed(3) ?? '—'} | ${g.liveEdgeAgeMedian?.toFixed(1) ?? '—'} | ${g.formations}/${g.stretchBreaks}/${g.deathRemovals} | ${g.lifetimes.stretchBreak.medianCompletedTicks?.toFixed(1) ?? '—'}/${g.lifetimes.deathRemoval.medianCompletedTicks?.toFixed(1) ?? '—'} | ${r.maximumAbsEnergyResidual.toExponential(2)} |`;
}).join('\n');
const earlyText = allBondedExtinctBefore1000 ? 'yes' : 'no';
const md = `# Bonded particle shapes pilot\n\nNine fixed runs: pursuit, mutation enabled, still food, seeds 1201–1203 × none/chains/mesh, target 6,000 ticks. No interventions or tuning. Runtime ${process.version}; base rules version ${RULES.version}; bond wrapper version ${BOND_RULES.version}.\n\n| Mode | Seed | Completed | Extinction tick | Population range | Live edges | Linked components final (range) | Largest component ever | Live-edge fraction | Isolated fraction | Mean degree | Median live-edge age | Formed/stretch/death removed | Median lifetime stretch/death | Max abs ledger residual |\n|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows}\n\nAll six bonded runs extinct before tick 1000: **${earlyText}**. All nine outcomes are retained. No rescue, retuning, or parameter search was performed. If all six bonded runs cross the early-collapse stop, interpret the bonded arm as an early collapse and do not continue by changing parameters.\n\nEdge labels use a fixed 100-tick reference, one census interval: median live-edge age ≥100 ticks is called persistent at this descriptive scale; median completed lifetime <100 among removed edges is rapid churn. The table reports actual medians rather than replacing them with labels. “Live-edge fraction” is the share of living particles incident to at least one live edge; “isolated fraction” is its unlinked counterpart; “mean degree” is 2E/N. Component counts include only connected groups of at least two particles; largest component is zero without edges. Population ranges and component-count ranges are retained per run to show whether populations emptied and graph groups grew, shrank, or stayed stable; components are not organisms. Null metrics mean the denominator or edge set is empty.\n\nLifetime records distinguish stretch breaks and dead-end cleanup before a step from endpoint death cleanup after a base step. A pre-step removal counts completed ticks through the prior state; a post-death removal includes the just-completed tick. Edge age is current tick − born tick + 1. The cumulative impulse counter sums each living particle’s net added velocity-impulse magnitude per tick. It is supplied steering, not work or energy, and is excluded from the base ledger.\n\nWithin each seed only, all three modes share an exactly equal initial base snapshot. None mode was compared as a full base snapshot against a directly stepped ParticleWorld at tick 0 and every 100 ticks plus extinction/final; comparison counts are in the JSON. Every living tick checks particle/food bounds, finite state, population and degree caps, edge validity, and ledger residual ≤1e-6. Maximum residual across all runs: ${Math.max(...results.map(r => r.maximumAbsEnergyResidual)).toExponential(3)}.\n\nThe full artifact contains sampled base censuses and graph summaries, every-tick invariant checks that abort on the first failure, cumulative formation/break/death and steering totals, removed-edge lifetime summaries by cause and removal stage, 100-tick deltas, ledgers, runtime/rules/source hashes, and the complete 3×3 matrix: [bonds-pilot.json](bonds-pilot.json). These are descriptive engineered-world outcomes; supplied bonds are not emergent organisms. Visual comparison is documented separately after the fixed-age browser captures are inspected.\n\nReproduce with node tools/particles/explore-bonds.ts. Freshness validation without simulation or writes: node tools/particles/explore-bonds.ts --check.\n`;
writeFileSync(report, md);
console.log(`Wrote ${results.length} fixed outcomes to bonds-pilot.json and bonds-pilot.md; all-six-early-extinction=${allBondedExtinctBefore1000}.`);
