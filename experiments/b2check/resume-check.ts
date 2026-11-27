/**
 * Checks that a run cut into segments and restarted from saved states equals one continuous run: steps the
 * seeded world to `--to` on the GPU in one go and compares the result with the saved `state-<to>.bin`.
 *
 *   deno run -A --no-lock experiments/b2check/resume-check.ts --dir runs/b2check/PHAGE/seed-13 --to 20000
 */

import { DropletKernelRef, type DropletKernelConfig } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { DropletGpuSim } from '../../apps/lab/src/oligomer/droplets-gpu.ts';
import { seedPhageArena } from '../../apps/lab/src/oligomer/droplet-worlds.ts';
import { argOf, assertFrozen } from '../confirm/io.ts';

const dir = argOf('dir');
const to = Number(argOf('to'));
await assertFrozen('droplets');
const segName = [...Deno.readDirSync(dir)].map((e) => e.name).find((n) => n.startsWith('seg-') && n.endsWith('.json'));
if (!segName) throw new Error(`no segment file in ${dir}`);
const meta = JSON.parse(await Deno.readTextFile(`${dir}/${segName}`)).meta as { world: string; seed: number; size: number; cfg: DropletKernelConfig };
const N = meta.size * meta.size;
const bytes = await Deno.readFile(`${dir}/state-${to}.bin`);
const saved = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('No WebGPU adapter available');
const device = await adapter.requestDevice();
const ref = new DropletKernelRef(meta.cfg);
seedPhageArena(ref, meta.size, meta.world === 'SINGLE_WALL' || meta.world.startsWith('ONE64'), 'mixed');
const gpu = new DropletGpuSim(device, meta.cfg);
gpu.uploadFromRef(ref);
gpu.step(to);
const snap = await gpu.readback();
const parts = [snap.A, snap.F, snap.W, snap.P];
let at = 0;
let same = snap.step === to && saved.length === 14 * N;
for (const part of parts) {
  for (let k = 0; k < part.length && same; k++) if (part[k] !== saved[at + k]) same = false;
  at += part.length;
}
console.log(`${meta.world} seed ${meta.seed}: continuous run to step ${to} ${same ? 'equals' : 'DIFFERS FROM'} the saved state reached through restarts`);
gpu.destroy();
device.destroy();
if (!same) Deno.exit(1);
