/**
 * Checks that the SPOT6 runner with no overrides (setting B2) reproduces experiments/confirm/run-droplets.ts:
 * the same seven fields at every census, on all four arms.
 *
 *   deno run -A --no-lock experiments/confirm/run-droplets.ts --out runs/spot6/parity/confirm --seeds 1 --steps 5000
 *   for a in PHAGE NO_PHAGE SINGLE_WALL NEUTRAL_PHAGE; do
 *     deno run -A --no-lock experiments/spot6/run.ts --setting B2 --arm $a --seed 1 --out runs/spot6/parity/spot6 --steps 5000 --track 0-2500
 *   done
 *   deno run -A --no-lock experiments/spot6/parity.ts --confirm runs/spot6/parity/confirm --spot6 runs/spot6/parity/spot6 --seed 1 --steps 5000
 */

import { defaultDropletKernelConfig } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { PHAGE_RUN_DEFAULTS, phageArms } from '../../apps/lab/src/oligomer/droplet-worlds.ts';
import { argOf, runPath } from '../confirm/io.ts';
import type { DropletRow } from '../confirm/rule.ts';
import type { SegmentFile } from './rule.ts';
import { buildSpec, CENSUS } from './settings.ts';

const confirm = argOf('confirm');
const spot6 = argOf('spot6');
const seed = Number(argOf('seed'));
const steps = Number(argOf('steps'));
const FIELDS = ['t', 'drop', 'd1', 'dom', 'domShare', 'phage', 'res'] as const;
let ok = true;
for (const arm of phageArms(PHAGE_RUN_DEFAULTS)) {
  // The config: key for key the confirmation's.
  const theirs = defaultDropletKernelConfig({ width: 128, height: 128, seed, ...arm.ov });
  const mine = buildSpec('B2', arm.name, seed).cfg;
  const sameCfg = JSON.stringify(theirs) === JSON.stringify(mine);
  const lines = (await Deno.readTextFile(runPath(confirm, arm.name, seed))).trim().split('\n');
  const want = lines.slice(1).map((l) => JSON.parse(l) as DropletRow);
  const dir = `${spot6}/B2/${arm.name}/seed-${seed}`;
  const got: DropletRow[] = [];
  const names = [...Deno.readDirSync(dir)].map((e) => e.name).filter((n) => n.startsWith('seg-') && n.endsWith('.json'));
  names.sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
  for (const name of names) got.push(...(JSON.parse(await Deno.readTextFile(`${dir}/${name}`)) as SegmentFile).rows);
  let same = sameCfg && want.length === steps / CENSUS && got.length === want.length;
  let firstDiff = '';
  for (let k = 0; k < want.length && same; k++) {
    for (const f of FIELDS) {
      if (want[k][f] !== got[k][f]) {
        same = false;
        firstDiff = ` (first difference: census ${want[k].t}, ${f}: ${want[k][f]} against ${got[k][f]})`;
        break;
      }
    }
  }
  console.log(`${arm.name} seed ${seed}, ${steps} steps, ${want.length} censuses: config ${sameCfg ? 'equal' : 'DIFFERENT'}; rows ${same ? 'equal on every field' : 'DIFFER'}${firstDiff}`);
  if (!same) ok = false;
}
if (!ok) Deno.exit(1);
