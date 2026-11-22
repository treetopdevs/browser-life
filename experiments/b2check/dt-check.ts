/**
 * Checks whether the tracker's frame spacing loses ids. Restarts one finished run from a saved state and follows
 * the same stretch of the same (deterministic) world at several frame spacings. If ids were being lost because
 * objects move too far between frames, the "kept id" shares would rise as the spacing shrinks.
 *
 *   deno run -A --no-lock experiments/b2check/dt-check.ts --dir runs/b2check/PHAGE/seed-13 --from 60000 [--steps 5000] [--dts 1,2,5,10]
 */

import { DropletKernelRef, type DropletKernelConfig } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { DropletGpuSim } from '../../apps/lab/src/oligomer/droplets-gpu.ts';
import { argOf, assertFrozen } from '../confirm/io.ts';
import { ObjectTracker } from './observe.ts';
import { windowReadouts } from './readouts.ts';

const dir = argOf('dir');
const from = Number(argOf('from'));
const steps = Number(argOf('steps', '5000'));
const dts = argOf('dts', '1,2,5,10').split(',').map(Number);
await assertFrozen('droplets');
const segName = [...Deno.readDirSync(dir)].map((e) => e.name).find((n) => n.startsWith('seg-') && n.endsWith('.json'));
if (!segName) throw new Error(`no segment file in ${dir}`);
const meta = JSON.parse(await Deno.readTextFile(`${dir}/${segName}`)).meta as { world: string; seed: number; size: number; cfg: DropletKernelConfig };
const N = meta.size * meta.size;
const bytes = await Deno.readFile(`${dir}/state-${from}.bin`);
const packed = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
if (packed.length !== 14 * N) throw new Error('bad state file');

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('No WebGPU adapter available');
const device = await adapter.requestDevice();
const pct = (x: number | null) => (x === null ? 'n/a' : `${(100 * x).toFixed(1)}%`);
console.log(`${meta.world} seed ${meta.seed}, steps ${from} to ${from + steps}`);
console.log('| Frame spacing (steps) | Objects sampled | Kept id +100 | Kept id +500 | Kept id +1,000 | Tiles kept +1,000 (same id) | Tiles still wall +1,000 (no tracking) | Births per object per 1,000 steps |');
console.log('|---|---|---|---|---|---|---|---|');
for (const dt of dts) {
  if (!Number.isInteger(dt) || dt <= 0 || 100 % dt !== 0) throw new Error(`dt ${dt} must be a positive whole number that divides 100`);
  const ref = new DropletKernelRef(meta.cfg);
  ref.A.set(packed.subarray(0, N));
  ref.F.set(packed.subarray(N, 2 * N));
  ref.W.set(packed.subarray(2 * N, 8 * N));
  ref.P.set(packed.subarray(8 * N, 14 * N));
  ref.stepCount = from;
  const gpu = new DropletGpuSim(device, meta.cfg);
  gpu.uploadFromRef(ref);
  const tracker = new ObjectTracker(meta.size, meta.size, { sampleEvery: 500 });
  tracker.observe(from, ref.W, ref.P);
  for (let t = from; t < from + steps;) {
    gpu.step(dt);
    t += dt;
    const snap = await gpu.readback();
    tracker.observe(t, snap.W, snap.P);
  }
  gpu.destroy();
  const r = windowReadouts(tracker.finish(), [], dt);
  console.log(`| ${dt} | ${r.samples} | ${pct(r.surv100)} | ${pct(r.surv500)} | ${pct(r.surv1000)} | ${pct(r.keepUid1000)} | ${pct(r.keepMask1000)} | ${r.birthRate.toFixed(2)} |`);
}
device.destroy();
