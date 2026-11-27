/**
 * Confirmation runner for the droplet worlds. Uses the frozen kernel untouched, writes one row per census,
 * and skips runs that already finished.
 *
 *   deno run -A --no-lock experiments/confirm/run-droplets.ts --out <dir> --seeds 5-12
 *   deno run -A --no-lock experiments/confirm/run-droplets.ts --out <dir> --seeds 1-4 --steps 20000
 */

import { defaultDropletKernelConfig, DropletKernelRef, observeFindDroplets, observeMotifStats, observeTotalMatter } from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { DropletGpuSim } from '../../apps/lab/src/oligomer/droplets-gpu.ts';
import { PHAGE_RUN_DEFAULTS, phageArms, seedPhageArena } from '../../apps/lab/src/oligomer/droplet-worlds.ts';
import { argOf, assertFrozen, assertRunMeta, dropletMeta, exists, parseSeeds, runPath, writeRun } from './io.ts';
import { DROPLET_CENSUS, DROPLET_STEPS, type DropletRow } from './rule.ts';

const SIZE = 128;
const out = argOf('out');
const seeds = parseSeeds(argOf('seeds'));
const steps = Number(argOf('steps', String(DROPLET_STEPS)));
const onlyArm = argOf('arm', '');
const frozen = await assertFrozen('droplets');

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('No WebGPU adapter available');
const device = await adapter.requestDevice();
let gpuError: string | null = null;
device.addEventListener?.('uncapturederror', (e) => {
  gpuError = (e as GPUUncapturedErrorEvent).error.message;
});

for (const seed of seeds) {
  for (const arm of phageArms(PHAGE_RUN_DEFAULTS)) {
    if (onlyArm && arm.name !== onlyArm) continue;
    const path = runPath(out, arm.name, seed);
    const meta = dropletMeta(arm.name, seed, steps, frozen);
    if (await exists(path)) {
      await assertRunMeta(path, meta);
      continue;
    }
    const t0 = performance.now();
    const cfg = defaultDropletKernelConfig({ width: SIZE, height: SIZE, seed, ...arm.ov });
    const ref = new DropletKernelRef(cfg);
    seedPhageArena(ref, SIZE, arm.single, 'mixed');
    const gpu = new DropletGpuSim(device, cfg);
    gpu.uploadFromRef(ref);
    const rows: DropletRow[] = [];
    for (let done = 0; done < steps;) {
      const dt = Math.min(DROPLET_CENSUS, steps - done);
      gpu.step(dt);
      done += dt;
      const snap = await gpu.readback();
      if (gpuError) throw new Error(`WebGPU error in ${arm.name} seed ${seed}: ${gpuError}`);
      const st = observeMotifStats(snap.W, snap.P);
      rows.push({
        t: done,
        drop: observeFindDroplets(snap.W, SIZE, SIZE, 0.20).length,
        d1: st.hillD1,
        dom: st.dominant,
        domShare: st.dominantShare,
        phage: Number(st.phageTotals.reduce((a, b) => a + b, 0)),
        res: Number(observeTotalMatter(snap.A, snap.F, snap.W, snap.P) - ref.initTotalMatter),
      });
    }
    gpu.destroy();
    await writeRun(path, meta, rows);
    console.log(`${arm.name} s${seed} done in ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
}
device.destroy();
