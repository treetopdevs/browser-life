/** Descriptive follow-up to the single-seed flock recording. Node24; --check does not run/write. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { ParticleWorld, RULES } from '../../apps/lab/src/particles/model.ts';
import type { ParticleEnvironment } from '../../apps/lab/src/particles/model.ts';
const output = new URL('../../docs/creative-prototypes/oases-flocks.json', import.meta.url);
const sourceHashes = Object.fromEntries([
  ['model', new URL('../../apps/lab/src/particles/model.ts', import.meta.url)],
  ['runner', new URL('./explore-oases-flocks.ts', import.meta.url)],
].map(([name,path]) => [String(name), createHash('sha256').update(readFileSync(path)).digest('hex')]));
const args = process.argv.slice(2);
if (args.length) {
  if (args.length !== 1 || args[0] !== '--check') throw new Error('Usage: node tools/particles/explore-oases-flocks.ts [--check]');
  const saved = JSON.parse(readFileSync(output,'utf8'));
  if (JSON.stringify(saved.sourceHashes) !== JSON.stringify(sourceHashes) || saved.rulesVersion !== RULES.version) throw new Error('Flock follow-up evidence is stale');
  console.log('Flock follow-up source hashes and rules version match. No simulation or writes.'); process.exit(0);
}
const environments: ParticleEnvironment[] = [{kind:'still'},{kind:'travelling',speed:.0001},{kind:'travelling',speed:.00025}];
const results = [];
for (const seed of [1201,1202,1203]) for (const environment of environments) {
  const world = new ParticleWorld(seed,'flocks',true,undefined,environment);
  const history = [world.census()]; let extinctionTick: number|null = null;
  for(let tick=1;tick<=6000;tick++) {
    world.step();
    if(tick%100===0 || !world.particles.length) history.push(world.census());
    if(!world.particles.length){extinctionTick=world.tick;break;}
  }
  const final = world.census();
  results.push({seed,environment,final,extinctionTick,history});
  console.log(`${seed} ${environment.kind==='still'?'still':environment.speed}: population${final.population} families${final.counts.join('/')} extinction${extinctionTick??'none'}`);
}
writeFileSync(output,JSON.stringify({kind:'oases-flocks-descriptive-followup',runtime:process.version,rulesVersion:RULES.version,sourceHashes,settings:{seeds:[1201,1202,1203],preset:'flocks',mutation:true,ticks:6000,censusEvery:100},reason:'Single-seed browser recording suggested lower flock populations under moving food. This fixed three-seed follow-up retains all outcomes; no tuning or adaptation claim.',results})+'\n');
