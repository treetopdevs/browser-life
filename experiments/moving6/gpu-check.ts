/**
 * Checks on this machine that the GPU kernel the MOVING6 runner uses matches the CPU reference value for value
 * at this line's settings, seed 1, 128 x 128, after 100 steps. A copy of experiments/spot6/gpu-check.ts with
 * this line's `buildSpec` (the earlier one refuses `MIX12` and `MIX37`).
 *
 *   deno run -A --no-lock experiments/moving6/gpu-check.ts --settings MIX25,MIX12,MIX37 --arms PHAGE,NO_PHAGE,NEUTRAL_PHAGE,SINGLE_WALL
 *   deno run -A --no-lock experiments/moving6/gpu-check.ts --settings PH_LONG@MIX25 --arms PHAGE,NO_PHAGE,NEUTRAL_PHAGE,SINGLE_WALL   # a phage variant, before its first run
 *
 * `--seed` (default 1) must be a seed the line allows: a later confirmation, whose allowed seeds are 33 to 40, passes 33.
 */

import { DropletKernelRef } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { DropletGpuSim } from '../../apps/lab/src/oligomer/droplets-gpu.ts';
import { seedPhageArena } from '../../apps/lab/src/oligomer/droplet-worlds.ts';
import { argOf, assertFrozen } from '../confirm/io.ts';
import { buildSpec } from './settings.ts';

const steps = Number(argOf('steps', '100'));
const seed = Number(argOf('seed', '1'));
const settings = argOf('settings').split(',');
const arms = argOf('arms').split(',');
await assertFrozen('droplets');
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('No WebGPU adapter available');
const device = await adapter.requestDevice();
let ok = true;
for (const setting of settings) {
  for (const arm of arms) {
    const spec = buildSpec(setting, arm, seed);
    const ref = new DropletKernelRef(spec.cfg);
    seedPhageArena(ref, spec.size, spec.single, 'mixed');
    const gpu = new DropletGpuSim(device, spec.cfg);
    gpu.uploadFromRef(ref);
    gpu.step(steps);
    const snap = await gpu.readback();
    for (let k = 0; k < steps; k++) ref.step();
    // Every element of every field, and the step counters: a digest could collide.
    let diff = snap.step === ref.stepCount ? '' : `step counter ${snap.step} against ${ref.stepCount}`;
    const fields: [string, Uint32Array, Uint32Array][] = [['A', snap.A, ref.A], ['F', snap.F, ref.F], ['W', snap.W, ref.W], ['P', snap.P, ref.P]];
    let compared = 0;
    for (const [name, g, c] of fields) {
      if (diff) break;
      if (g.length !== c.length) diff = `${name} has ${g.length} elements against ${c.length}`;
      for (let k = 0; k < g.length && !diff; k++) if (g[k] !== c[k]) diff = `${name}[${k}] is ${g[k]} on the GPU and ${c[k]} on the CPU`;
      compared += g.length;
    }
    console.log(`${setting} ${arm} seed ${seed}, ${steps} steps: GPU ${diff ? `DIFFERS FROM CPU reference (${diff})` : `equals CPU reference on all ${compared} values and the step counter`}`);
    if (diff) ok = false;
    gpu.destroy();
  }
}
device.destroy();
if (!ok) Deno.exit(1);
