/**
 * Confirmation runner for the Reef. Uses the frozen kernel untouched, writes one row per census,
 * and skips runs that already finished.
 *
 *   deno run -A --no-lock experiments/confirm/run-reef.ts --out <dir> --seeds 5-12
 *   deno run -A --no-lock experiments/confirm/run-reef.ts --out <dir> --seeds 1-4 --steps 20000
 */

import { defaultReefConfig, type ReefConfig, ReefWorld } from '../../apps/lab/src/reef/model.ts';
import { observeBodies, observeMatter, observeNiches } from '../../apps/lab/src/reef/observe.ts';
import { argOf, assertFrozen, assertRunMeta, exists, parseSeeds, reefMeta, runPath, writeRun } from './io.ts';
import { REEF_CENSUS, REEF_STEPS, type ReefRow } from './rule.ts';

const ARMS: { name: string; overrides: Partial<ReefConfig> }[] = [
  { name: 'GRAZE_FULL', overrides: { shadows: true, gravity: true, bonds: true, grazing: true, swimming: true } },
  { name: 'SWIM_NO_GRAZE', overrides: { shadows: true, gravity: true, bonds: true, grazing: false, swimming: true } },
  { name: 'GRAZE_NO_SWIM', overrides: { shadows: true, gravity: true, bonds: true, grazing: true, swimming: false } },
];

const out = argOf('out');
const seeds = parseSeeds(argOf('seeds'));
const steps = Number(argOf('steps', String(REEF_STEPS)));
const onlyArm = argOf('arm', '');
const frozen = await assertFrozen('reef');

for (const seed of seeds) {
  for (const arm of ARMS) {
    if (onlyArm && arm.name !== onlyArm) continue;
    const path = runPath(out, arm.name, seed);
    const meta = reefMeta(arm.name, seed, steps, frozen);
    if (await exists(path)) {
      await assertRunMeta(path, meta);
      continue;
    }
    const t0 = performance.now();
    const world = new ReefWorld(defaultReefConfig({ gw: 40, gh: 20, seed, ...arm.overrides }));
    world.seedDefaultFounders(24);
    const rows: ReefRow[] = [];
    for (let t = REEF_CENSUS; t <= steps; t += REEF_CENSUS) {
      world.stepN(REEF_CENSUS);
      const m = observeMatter(world);
      const b = observeBodies(world);
      const n = observeNiches(world);
      rows.push({
        t,
        cells: n.cells,
        mc: b.multicellCellShare,
        meanSz: b.meanBodySize,
        maxSz: b.maxBodySize,
        ph: n.phototrophShare,
        gr: n.grazerShare,
        arm: n.meanArmor,
        res: m.residual,
      });
    }
    await writeRun(path, meta, rows);
    console.log(`${arm.name} s${seed} done in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
}
