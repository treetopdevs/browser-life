/** Node 24: node tools/particles/explore.ts. Nine unchanged-rule creative pilot runs. */
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ParticleWorld, PRESETS, RULES } from '../../apps/lab/src/particles/model.ts';

const duration = 3000;
const sampleEvery = 100;
const seeds = [1201, 1202, 1203];
const binsPerAxis = 10;
const modelPath = new URL('../../apps/lab/src/particles/model.ts', import.meta.url);
const sourceSha256 = createHash('sha256').update(readFileSync(modelPath)).digest('hex');
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--check')) throw new Error('Usage: node tools/particles/explore.ts [--check]');
if (args[0] === '--check') {
  const saved = JSON.parse(readFileSync(new URL('../../docs/creative-prototypes/pilot.json', import.meta.url), 'utf8'));
  if (saved.sourceSha256 !== sourceSha256) throw new Error('Pilot evidence is stale: model source changed; rerun tools/particles/explore.ts');
  deepStrictEqual(saved.rules, RULES, 'Pilot evidence is stale: rule settings changed; rerun tools/particles/explore.ts');
  console.log('Pilot source hash and rules match the current model. No simulation or file writes.');
  process.exit(0);
}
function observation(world: ParticleWorld) {
  const occupiedBins = new Set(world.particles.map(p => Math.floor(p.x * binsPerAxis) + binsPerAxis * Math.floor(p.y * binsPerAxis))).size;
  return { ...world.census(), occupiedBins };
}
const results = [];
for (const preset of PRESETS) for (const seed of seeds) {
  const world = new ParticleWorld(seed, preset.id, true);
  const history = [observation(world)];
  let extinctionTick: number | null = null;
  let speedSum = 0, capTicks = 0, maximumEnergyResidual = 0;
  for (let tick = 1; tick <= duration; tick++) {
    world.step();
    const census = world.census();
    speedSum += census.meanSpeed;
    if (census.population === RULES.populationMax) capTicks++;
    const residual = census.particleEnergy + census.foodEnergy + world.ledger.dissipated + world.ledger.deathLoss - world.ledger.initial - world.ledger.renewed;
    maximumEnergyResidual = Math.max(maximumEnergyResidual, Math.abs(residual));
    if (world.tick % sampleEvery === 0 || census.population === 0) history.push(observation(world));
    if (census.population === 0) { extinctionTick = world.tick; break; }
  }
  const final = observation(world);
  const result = { preset: preset.id, seed, ticksCompleted: world.tick, extinctionTick, meanPerTickSpeed: speedSum / world.tick, capTicks, maximumEnergyResidual, final, ledger: { ...world.ledger }, history };
  results.push(result);
  console.log(`${preset.id} ${seed}: population=${final.population}, births=${final.births}, deaths=${final.deaths}, mutations=${final.mutations}, generation=${final.maxGeneration}, occupied=${final.occupiedBins}, speed=${result.meanPerTickSpeed.toFixed(6)}, capTicks=${capTicks}`);
}
const artifact = { kind: 'particle-playground-pilot', sourceSha256, runtime: process.version, rules: RULES, settings: { seeds, duration, mutation: true, sampleEvery, binsPerAxis }, definitions: { meanPerTickSpeed: 'Mean of the population mean speed at every completed tick, in world widths per tick. Motion is not evidence of adaptation.', occupiedBins: 'Number of occupied cells in a fixed 10 by 10 grid of the unit torus at census time.', capTicks: 'Number of completed ticks whose ending population equals the configured hard cap.', maxGeneration: 'Maximum generation among particles alive at this census, not the historical maximum.', traitSpread: 'Population-wide standard deviation across attraction coordinates, including differences between founding families.', blockedBirths: 'Repeated eligible birth attempts denied by the population cap, not unique parents.', maximumEnergyResidual: 'Maximum absolute sum(particles + food + metabolic losses + death losses - initial energy - renewed food) over completed ticks.' }, results };
writeFileSync(new URL('../../docs/creative-prototypes/pilot.json', import.meta.url), JSON.stringify(artifact, null, 2) + '\n');
const rows = results.map(r => `| ${r.preset} | ${r.seed} | ${r.final.population} | ${r.final.births} / ${r.final.deaths} | ${r.final.mutations} | ${r.final.maxGeneration} | ${r.final.occupiedBins} | ${r.meanPerTickSpeed.toFixed(6)} | ${r.capTicks} | ${r.extinctionTick ?? '—'} |`).join('\n');
const extinctPresets = PRESETS.filter(p => results.filter(r => r.preset === p.id).every(r => r.extinctionTick !== null)).map(p => p.id);
const noMotionPresets = PRESETS.filter(p => results.filter(r => r.preset === p.id).every(r => r.meanPerTickSpeed < 1e-8)).map(p => p.id);
const flocks = results.filter(r => r.preset === 'flocks');
const pursuit = results.filter(r => r.preset === 'pursuit');
const concentratedFlocks = Math.max(...flocks.map(r => r.meanPerTickSpeed)) < Math.min(...pursuit.map(r => r.meanPerTickSpeed)) && Math.max(...flocks.map(r => r.final.occupiedBins)) < Math.min(...pursuit.map(r => r.final.occupiedBins));
const motionComparison = concentratedFlocks
  ? 'In this recorded pilot, flocks are a lower-motion, concentrated comparison to pursuit: the table shows slower average speed and fewer occupied bins. This is a descriptive comparison, not a settled-state score or new success threshold.'
  : 'The flocks/pursuit comparison has changed; inspect the table for speed and spatial occupancy. No settled-state score or new success threshold is inferred.';
const report = `# Particle playground pilot\n\nThree presets × seeds 1201, 1202, 1203 × up to 3,000 ticks. Mutation enabled; no interventions or tuning during this sweep. Same runtime: ${process.version}. Toy rules version ${RULES.version}; model SHA-256: \`${sourceSha256}\`.\n\n| Preset | Seed | Final population | Births / deaths | Mutated births | Living max generation | Occupied bins / 100 | Mean speed | Ticks at cap | Extinction tick |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows}\n\n## Interpretation and limits\n\n- Presets extinct on all three seeds: ${extinctPresets.join(', ') || 'none'}. Presets with no motion on all three seeds: ${noMotionPresets.join(', ') || 'none'}.\n- These totals describe turnover, inheritance and motion under engineered rules. They do not establish adaptation, open-ended evolution, or long-term persistence. Visual watchability needs the separately recorded browser inspection.\n- ${motionComparison}\n- Saturation is reported, not treated as success. The hard cap can influence competition; blocked birth attempts are retained in the JSON.\n- Speed is averaged over every completed tick. Occupancy is a spatial summary at each 100-tick census, not a count of organisms or colonies. Trait spread includes founding-family differences.\n- Maximum absolute energy-accounting residual across all runs: ${Math.max(...results.map(r => r.maximumEnergyResidual)).toExponential(3)} (floating-point arithmetic).\n\nFull census histories and ledger totals: [pilot.json](pilot.json). Check evidence freshness without simulation or writes: \`node tools/particles/explore.ts --check\`. Reproduce with Node 24: \`node tools/particles/explore.ts\`.\n`;
writeFileSync(new URL('../../docs/creative-prototypes/pilot.md', import.meta.url), report);
console.log(`Saved ${fileURLToPath(new URL('../../docs/creative-prototypes/pilot.json', import.meta.url))}`);
