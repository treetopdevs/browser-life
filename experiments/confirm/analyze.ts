/**
 * Applies the frozen rule to finished runs and prints the decision. Refuses runs whose header does not match
 * the frozen code, and incomplete or non-conserving runs.
 *
 *   deno run -A --no-lock experiments/confirm/analyze.ts --out <dir> [--json <file>]
 */

import { argOf, assertFrozen, dropletMeta, readRows, reefMeta, runPath } from './io.ts';
import { CONFIRM_SEEDS, decide, DROPLET_STEPS, type DropletRow, judgeDroplets, judgeReef, REEF_STEPS, type ReefRow, type WorldVerdict } from './rule.ts';

async function load<T>(dir: string, arms: readonly string[], metaOf: (arm: string, seed: number) => unknown) {
  const runs: Record<string, Record<number, T[]>> = {};
  for (const arm of arms) {
    runs[arm] = {};
    for (const s of CONFIRM_SEEDS) runs[arm][s] = await readRows<T>(runPath(dir, arm, s), metaOf(arm, s));
  }
  return runs;
}

const out = argOf('out');
const frozenD = await assertFrozen('droplets');
const frozenR = await assertFrozen('reef');
const droplets = judgeDroplets(
  await load<DropletRow>(`${out}/droplets`, ['PHAGE', 'NO_PHAGE', 'SINGLE_WALL', 'NEUTRAL_PHAGE'], (a, s) => dropletMeta(a, s, DROPLET_STEPS, frozenD)),
);
const reef = judgeReef(
  await load<ReefRow>(`${out}/reef`, ['GRAZE_FULL', 'SWIM_NO_GRAZE', 'GRAZE_NO_SWIM'], (a, s) => reefMeta(a, s, REEF_STEPS, frozenR)),
);
const decision = decide(droplets, reef);

function show(v: WorldVerdict) {
  console.log(`\n${v.world.toUpperCase()}: ${v.pass ? 'PASS' : 'FAIL'}`);
  for (const e of v.endpoints) console.log(`  ${e.pass ? 'pass' : 'FAIL'} ${e.wins}/${e.of}  ${e.id}`);
  for (const [k, d] of Object.entries(v.direction)) console.log(`  direction ${k}: ${d.headline} (${Object.values(d.perSeed).join(', ')})`);
}
show(droplets);
show(reef);
console.log(`\nDECISION: ${decision.winner}. ${decision.reason}`);

const json = argOf('json', '');
if (json) await Deno.writeTextFile(json, JSON.stringify({ droplets, reef, decision }, null, 2));
