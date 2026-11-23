/**
 * Checks on this machine that the GPU kernel the runner uses matches the CPU reference bit for bit, on the
 * three confirmation worlds, seed 13, 128 x 128.
 *
 *   deno run -A --no-lock experiments/b2check/gpu-check.ts [--steps 100]
 */

import { observeDigest } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { DropletGpuSim } from '../../apps/lab/src/oligomer/droplets-gpu.ts';
import { buildDropletWorld } from '../../apps/lab/src/oligomer/droplet-worlds.ts';
import { argOf, assertFrozen } from '../confirm/io.ts';

const steps = Number(argOf('steps', '100'));
if (!Number.isSafeInteger(steps) || steps <= 0) throw new Error(`--steps ${steps} must be a positive whole number`);
await assertFrozen('droplets');
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('No WebGPU adapter available');
const device = await adapter.requestDevice();
let ok = true;
for (const world of ['PHAGE', 'NO_PHAGE', 'SINGLE_WALL']) {
  const { cfg, ref } = buildDropletWorld(world, 128, 13);
  const gpu = new DropletGpuSim(device, cfg);
  gpu.uploadFromRef(ref);
  gpu.step(steps);
  const snap = await gpu.readback();
  for (let k = 0; k < steps; k++) ref.step();
  const same = observeDigest(snap.A, snap.F, snap.W, snap.P) === observeDigest(ref.A, ref.F, ref.W, ref.P);
  console.log(`${world} seed 13, ${steps} steps: GPU ${same ? 'equals' : 'DIFFERS FROM'} CPU reference`);
  if (!same) ok = false;
  gpu.destroy();
}
device.destroy();
if (!ok) Deno.exit(1);
