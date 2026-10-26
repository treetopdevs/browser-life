/** Bounded seasonal descriptive evidence. Node 24.2.0; --check never simulates or writes. */
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { ParticleWorld, RULES, renewalMultiplier, seasonalPhase } from '../../apps/lab/src/particles/model.ts';
import type { ParticleEnvironment } from '../../apps/lab/src/particles/model.ts';

const seeds = [1201, 1202, 1203] as const;
const duration = 10800;
const censusEvery = 100;
const environments: { label: string; environment: ParticleEnvironment }[] = [
  { label: 'still', environment: { kind: 'still' } },
  { label: 'seasonal-600', environment: { kind: 'seasonal', period: 600 } },
  { label: 'seasonal-1800', environment: { kind: 'seasonal', period: 1800 } },
];
const sourceFiles = ['apps/lab/src/particles/model.ts', 'tools/particles/explore-seasons.ts'];
const sourceHashes = Object.fromEntries(sourceFiles.map(path => [path, createHash('sha256').update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest('hex')]));
const output = new URL('../../docs/creative-prototypes/seasons-pilot.json', import.meta.url);
const report = new URL('../../docs/creative-prototypes/seasons-pilot.md', import.meta.url);
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--check')) throw new Error('Usage: node tools/particles/explore-seasons.ts [--check]');
if (args[0] === '--check') {
  const saved = JSON.parse(readFileSync(output, 'utf8'));
  if (saved.runtime !== process.version) throw new Error(`Season evidence runtime is stale: ${saved.runtime} != ${process.version}`);
  if (saved.rulesVersion !== RULES.version) throw new Error(`Season evidence model version is stale: ${saved.rulesVersion} != ${RULES.version}`);
  deepStrictEqual(saved.sourceHashes, sourceHashes, 'Season evidence is stale: model or runner source changed');
  deepStrictEqual(saved.settings, { seeds, duration, censusEvery, preset: 'flocks', mutation: true, environments }, 'Season evidence settings are stale');
  if (saved.results?.length !== 9) throw new Error('Season evidence expected nine runs');
  deepStrictEqual([...new Set(saved.results.map((r: { seed: number }) => r.seed))].sort(), [...seeds], 'Season evidence seed set is incomplete');
  deepStrictEqual([...new Set(saved.results.map((r: { label: string }) => r.label))].sort(), environments.map(e => e.label).sort(), 'Season evidence environment set is incomplete');
  const matrix = saved.results.map((r: { label: string; seed: number }) => `${r.label}/${r.seed}`).sort();
  const expectedMatrix = environments.flatMap(({ label }) => seeds.map(seed => `${label}/${seed}`)).sort();
  deepStrictEqual(matrix, expectedMatrix, 'Season evidence must contain each seed/environment pair exactly once');
  console.log(`Season evidence source hashes, model version ${RULES.version}, runtime ${process.version}, settings, and 3×3 run matrix match. No simulation or writes.`);
  process.exit(0);
}

function energyResidual(world: ParticleWorld) {
  const c = world.census();
  return c.particleEnergy + c.foodEnergy + world.ledger.dissipated + world.ledger.deathLoss - world.ledger.initial - world.ledger.renewed;
}
function assertHealthy(world: ParticleWorld) {
  const finite = (value: number) => Number.isFinite(value);
  for (const p of world.particles) {
    if (![p.x,p.y,p.vx,p.vy,p.energy].every(finite) || p.x < 0 || p.x >= 1 || p.y < 0 || p.y >= 1 || p.energy < 0 || p.energy > RULES.maxEnergy || Math.hypot(p.vx,p.vy) > RULES.speedMax + 1e-12) throw new Error(`Particle bounds/finite check failed at tick ${world.tick}, id ${p.id}`);
  }
  for (const [index,p] of world.food.entries()) {
    if (![p.x,p.y,p.radius,p.amount].every(finite) || p.x < 0 || p.x >= 1 || p.y < 0 || p.y >= 1 || p.radius <= 0 || p.amount < 0 || p.amount > RULES.foodCapacity) throw new Error(`Food stock/position bounds check failed at tick ${world.tick}, patch ${index}`);
  }
  for (const [name,value] of Object.entries(world.ledger)) if (!finite(value) || value < 0) throw new Error(`Ledger finite/non-negative check failed at tick ${world.tick}, ${name}`);
  const residual = energyResidual(world);
  if (!finite(residual) || Math.abs(residual) > 1e-6) throw new Error(`Energy residual ${residual} exceeds 1e-6 at tick ${world.tick}`);
  return Math.abs(residual);
}
function offeredAtStep(environment: ParticleEnvironment, step: number, renewal: number) {
  if (environment.kind !== 'seasonal') return 9 * renewal;
  let sum = 0;
  for (let patch = 0; patch < 9; patch++) sum += renewal * renewalMultiplier(environment, step, patch);
  return sum;
}
function sampledLowRebounds(history: { tick: number; counts: [number, number, number] }[]) {
  return [0, 1, 2].map(family => {
    const episodes: { lowTick: number; lowCount: number; reboundTick: number; reboundCount: number }[] = [];
    let low: { tick: number; count: number } | null = null;
    for (const census of history) {
      const count = census.counts[family];
      if (low === null) {
        if (count >= 1 && count <= 9) low = { tick: census.tick, count };
      } else if (count >= 20) {
        episodes.push({ lowTick: low.tick, lowCount: low.count, reboundTick: census.tick, reboundCount: count });
        low = null;
      } else if (count === 0) {
        low = null;
      }
    }
    return episodes;
  });
}
function stockObservation(world: ParticleWorld) {
  const phase = world.environment.kind === 'seasonal' ? seasonalPhase(world.environment, Math.max(1, world.tick)) : null;
  return { tick: world.tick, phase: phase?.phase ?? null,
    nextChangeTick: phase && world.particles.length ? phase.nextChangeTick : null,
    patches: world.food.map((p, index) => ({ index, x: p.x, y: p.y, radius: p.radius, stock: p.amount })) };
}

const results = [];
for (const { label, environment } of environments) for (const seed of seeds) {
  const world = new ParticleWorld(seed, 'flocks', true, undefined, environment);
  const initial = world.census();
  const initialStock = stockObservation(world);
  const history = [{ ...initial, phase: initialStock.phase, nextChangeTick: initialStock.nextChangeTick, patches: initialStock.patches }];
  const tickTransitions: [number, number, number, number][] = [];
  const intervals: { startTick: number; endTick: number; ledgerRenewedDelta: number; offeredRenewal: number; realizedOfferedRatio: number | null; maximumAbsEnergyResidual: number; capTicks: number }[] = [];
  const initialResidual = assertHealthy(world);
  let intervalStart = 1, intervalLedgerBaseline = world.ledger.renewed, intervalOffered = 0, intervalMaxResidual = initialResidual, intervalCapTicks = 0;
  let totalOffered = 0, maximumAbsEnergyResidual = intervalMaxResidual, capTicks = 0;
  let min = [...initial.counts] as [number, number, number], max = [...initial.counts] as [number, number, number];
  const firstLossTick: (number | null)[] = initial.counts.map(n => n === 0 ? 0 : null);
  let extinctionTick: number | null = null;
  let priorCounts = [...initial.counts] as [number, number, number];
  for (let tick = 1; tick <= duration; tick++) {
    if (!world.particles.length) break;
    world.step();
    const census = world.census();
    const offered = offeredAtStep(environment, tick, world.recipe.foodRenewal);
    intervalOffered += offered; totalOffered += offered;
    tickTransitions.push([world.tick, census.counts[0], census.counts[1], census.counts[2]]);
    for (let family = 0; family < 3; family++) {
      min[family] = Math.min(min[family], census.counts[family]);
      max[family] = Math.max(max[family], census.counts[family]);
      if (firstLossTick[family] === null && priorCounts[family] > 0 && census.counts[family] === 0) firstLossTick[family] = world.tick;
    }
    priorCounts = [...census.counts] as [number, number, number];
    const residual = assertHealthy(world);
    maximumAbsEnergyResidual = Math.max(maximumAbsEnergyResidual, residual);
    intervalMaxResidual = Math.max(intervalMaxResidual, residual);
    const atCap = census.population === RULES.populationMax;
    if (atCap) { capTicks++; intervalCapTicks++; }
    const phaseChanged = environment.kind === 'seasonal' && census.tick > 1 && seasonalPhase(environment, census.tick).phase !== seasonalPhase(environment, census.tick - 1).phase;
    if (census.tick % censusEvery === 0 || phaseChanged || census.tick === duration || census.population === 0) {
      const stock = stockObservation(world);
      history.push({ ...census, phase: stock.phase, nextChangeTick: stock.nextChangeTick, patches: stock.patches });
      const ledgerRenewedDelta = world.ledger.renewed - intervalLedgerBaseline;
      intervals.push({ startTick: intervalStart, endTick: census.tick, ledgerRenewedDelta, offeredRenewal: intervalOffered,
        realizedOfferedRatio: intervalOffered === 0 ? null : ledgerRenewedDelta / intervalOffered,
        maximumAbsEnergyResidual: intervalMaxResidual, capTicks: intervalCapTicks });
      intervalLedgerBaseline = world.ledger.renewed;
      intervalStart = census.tick + 1; intervalOffered = 0; intervalMaxResidual = residual; intervalCapTicks = 0;
    }
    if (census.population === 0) { extinctionTick = census.tick; break; }
  }
  if (intervalStart <= world.tick) {
    const ledgerDelta = world.ledger.renewed - intervalLedgerBaseline;
    intervals.push({ startTick: intervalStart, endTick: world.tick, ledgerRenewedDelta: ledgerDelta, offeredRenewal: intervalOffered,
      realizedOfferedRatio: intervalOffered === 0 ? null : ledgerDelta / intervalOffered, maximumAbsEnergyResidual: intervalMaxResidual, capTicks: intervalCapTicks });
  }
  const final = world.census();
  const run = { label, environment: world.environment, seed, preset: 'flocks', mutation: true, scheduledTargetTick: duration, finishedTick: world.tick, extinctionTick,
    familyPopulationMin: min, familyPopulationMax: max, firstFamilyLossTick: firstLossTick, sampledLowReboundEpisodes: sampledLowRebounds(history),
    capTicks, capTickFraction: world.tick ? capTicks / world.tick : null, maximumAbsEnergyResidual, offeredRenewalTotal: totalOffered,
    realizedRenewalTotal: world.ledger.renewed, realizedOfferedRatio: totalOffered ? world.ledger.renewed / totalOffered : null,
    birthCount: world.births, deathCount: world.deaths, final, ledger: { ...world.ledger }, history,
    tickFamilyCounts: tickTransitions, intervals };
  results.push(run);
  console.log(`${label} seed ${seed}: finished=${world.tick} families=${final.counts.join('/')} loss=${firstLossTick.join('/')} reboundEpisodes=${run.sampledLowReboundEpisodes.map(x => x.length).join('/')} extinct=${extinctionTick ?? 'no'}`);
}

const seasonalRuns = results.filter(r => r.environment.kind === 'seasonal');
const allSeasonalArmsExtinctBefore1800 = seasonalRuns.length === 6 && seasonalRuns.every(r => r.extinctionTick !== null && r.extinctionTick < 1800);
const artifact = {
  kind: 'particle-seasons-descriptive-pilot', runtime: process.version, rulesVersion: RULES.version, sourceHashes,
  settings: { seeds, duration, censusEvery, preset: 'flocks', mutation: true, environments },
  definitions: {
    offeredRenewal: 'Sum of the nine patch renewal requests for each completed live tick, using recipe.foodRenewal and renewalMultiplier; it excludes ticks after extinction. Realized renewal is the per-interval ledger.renewed delta. Ratio is realized/offered and can be below one when stock is at capacity.',
    familyRange: 'Per-family minima and maxima include tick zero and update after every tick, including the exact first-zero tick. First loss is the first exact tick a previously present family reaches zero.',
    sampledRebounds: 'One episode starts at a sampled census with 1–9 members and ends at a later sampled census with at least 20. Episodes for a family do not overlap; zero cancels a pending episode. Exact family loss is measured every tick. These are demographic observations, not fitness or adaptation.',
    sampling: 'Censuses and patch stock are retained at tick zero, every 100 ticks, every exact phase-change tick, and extinction. At a phase boundary, tick k*period (for example 600) closes the ending phase interval; tick k*period+1 (for example 601) is the first step in the new phase and closes its one-tick interval. tickFamilyCounts stores [tick,family0,family1,family2] for every completed tick; each row transitions from the preceding tick row or the initial census.',
    accounting: 'Every tick checks particleEnergy + foodEnergy + dissipated + deathLoss - initial - renewed. Cap ticks count completed ticks at populationMax. Interval offered and realized values, ratio, cap ticks, and maximum absolute residual accompany each sampled interval.',
    clocks: 'Live results stop at extinction; finishedTick is the exact extinction tick or the 10,800 target. Extinct worlds receive no renewal, rescue, or synthetic later samples.',
    limits: 'Descriptive engineered toy only. Within each seed, arms share the same initial state; all arms share phase order and initial stock, with row 0 rich first. The world states of seasonal-600 and seasonal-1800 are bit-identical through tick 600, then diverge at tick 601 when the short-phase arm enters phase 1. Arms diverge in their random trajectories once food changes. Nearest-patch steering ignores stock. No paired significance or adaptation claim.',
  },
  stops: { allSeasonalArmsExtinctBefore1800, stopTriggered: allSeasonalArmsExtinctBefore1800, noTuningPerformed: true }, results,
};
writeFileSync(output, JSON.stringify(artifact) + '\n');
const rows = results.map(r => `| ${r.label} | ${r.seed} | ${r.finishedTick} | ${r.final.counts.join('/')} | ${r.familyPopulationMin.join('/')} | ${r.familyPopulationMax.join('/')} | ${r.firstFamilyLossTick.map(t => t ?? '—').join('/')} | ${r.sampledLowReboundEpisodes.map(e => e.length).join('/')} | ${r.realizedOfferedRatio?.toFixed(4) ?? '—'} | ${r.maximumAbsEnergyResidual.toExponential(3)} | ${r.extinctionTick ?? '—'} |`).join('\n');
const markdown = `# Seasonal food patches: bounded descriptive evidence

Nine fixed runs: flocks, mutation enabled, seeds 1201–1203, still / 600-tick phases / 1,800-tick phases, target 10,800 ticks. No interventions, rescue, or tuning. Runtime ${process.version}; toy rules version ${RULES.version}.

| Environment | Seed | Finished tick | Final family counts | Per-family min | Per-family max | First family loss tick | Sampled low→rebound episodes | Realized/offered renewal | Max abs residual | World extinction |
|---|---:|---:|---|---|---|---|---|---:|---:|---:|
${rows}

No seasonal run was extinct before tick 1,800, so the six-arm early-extinction stop rule did not trigger. No tuning was performed in this slice. The fixed sweep retains all outcomes. Total population-cap ticks by environment: ${environments.map(({label}) => `${label} ${results.filter(r=>r.label===label).reduce((n,r)=>n+r.capTicks,0)}`).join(', ')}. Maximum absolute energy residual across all runs: ${Math.max(...results.map(r=>r.maximumAbsEnergyResidual)).toExponential(3)}.

Family lows are sampled at censuses with 1–9 members and end at a later sampled census with at least 20; episodes cannot overlap, and a family that reaches zero cannot rebound. Per-family extrema and loss ticks are checked every tick. These are visible demographic swings, not fitness, adaptation, or independent recovery.

Censuses and patch stocks include tick 0, every 100 ticks, exact phase changes, and extinction. For period 600, tick 600 closes phase 0, then tick 601 is the first step of phase 1 and closes its one-tick interval; the same applies at tick 1800/1801 for period 1800. Within each seed, the world states of seasonal-600 and seasonal-1800 are bit-identical through tick 600 and diverge at tick 601. The machine-readable artifact includes every tick's family counts, interval ledger renewal deltas, offered renewal, realized/offered ratios, cap counts, residuals, stocks, regime, and transitions.

Within each seed, arms begin with the same state; all arms share phase order and initial stock, with row 0 rich first. Their later random trajectories diverge. Offered renewal can exceed realized renewal when patches are full. Food seeking steers toward the nearest patch regardless of stock, so clustering at a depleted patch is possible. These runs support no paired significance claim and no claim of adaptation.

The [season evidence](seasons-pilot.json) is compact JSON. Freshness check without simulation or writes: \`node tools/particles/explore-seasons.ts --check\`. The [compatibility receipt](seasons-compatibility.jsonl) records complete v3 artifact comparisons and the still-flock census prefix.
`;
writeFileSync(report, markdown);
console.log(`Wrote ${results.length} runs to docs/creative-prototypes/seasons-pilot.json and seasons-pilot.md; all-six-early-extinction=${allSeasonalArmsExtinctBefore1800}.`);

