/** Node24: node tools/particles/explore-picker.ts. Scripted choices, not a fitness search. */
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { ParticleWorld, RULES } from '../../apps/lab/src/particles/model.ts';
import { createExploration, keepFavorite, recipeNode, serializeExploration, parseExploration } from '../../apps/lab/src/particles/comparison.ts';

const seeds = [1201,1202,1203];
const duration = 1000;
const picks = [1,2,0] as const;
const sourceHashes = Object.fromEntries(['model.ts','comparison.ts'].map(name => [name,createHash('sha256').update(readFileSync(new URL(`../../apps/lab/src/particles/${name}`,import.meta.url))).digest('hex')]));
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--check')) throw new Error('Usage: node tools/particles/explore-picker.ts [--check]');
if (args[0] === '--check') {
  const saved = JSON.parse(readFileSync(new URL('../../docs/creative-prototypes/picker-pilot.json', import.meta.url), 'utf8'));
  deepStrictEqual(saved.sourceHashes, sourceHashes, 'Picker pilot is stale: model or comparison source changed; rerun tools/particles/explore-picker.ts');
  if (saved.rulesVersion !== RULES.version) throw new Error('Picker pilot is stale: rules version changed; rerun tools/particles/explore-picker.ts');
  console.log('Picker pilot source hashes and rules version match. No simulation or file writes.');
  process.exit(0);
}
const runs = [];
for (const seed of seeds) {
  let session = createExploration(seed,'pursuit',true);
  const rounds = [];
  for (let round=0; round<picks.length; round++) {
    const candidates = session.slate.map(id => {
      const node = recipeNode(session,id);
      const world = new ParticleWorld(seed,session.preset,session.mutation,node.recipe);
      const history = [world.census()];
      for(let tick=1;tick<=duration;tick++){world.step();if(tick%100===0)history.push(world.census());}
      const occupiedBins = new Set(world.particles.map(p=>Math.floor(p.x*10)+10*Math.floor(p.y*10))).size;
      return {id,recipe:node.recipe,final:world.census(),occupiedBins,history};
    });
    const slot=picks[round];
    const chosen=JSON.stringify(candidates[slot].recipe);
    session=keepFavorite(session,slot,duration,'Scripted branch coverage; this is not a preference or fitness judgment.');
    if(JSON.stringify(recipeNode(session,session.slate[0]).recipe)!==chosen)throw new Error('Kept recipe changed');
    if(serializeExploration(parseExploration(serializeExploration(session)))!==serializeExploration(session))throw new Error('Session round-trip changed');
    rounds.push({round,evaluationTick:duration,chosenSlot:slot,candidates});
    console.log(`Seed${seed} round${round}: populations${candidates.map(c=>c.final.population).join('/')} kept slot${slot}`);
  }
  runs.push({seed,rounds,session});
}
const report={kind:'particle-picker-scripted-pilot',runtime:process.version,rulesVersion:RULES.version,sourceHashes,settings:{seeds,duration,picks},interpretation:'The choices are scripted to exercise ancestry and variants, not selected for survival or watchability. Motion and turnover are not proof of adaptation.',runs};
writeFileSync(new URL('../../docs/creative-prototypes/picker-pilot.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
