// The spike's simulator as a KernelSim: GpuSim3 (the copy bound to the patched shaders) with the kill's settings baked into the
// shader text at creation. `RPS` is module state read when the shaders are built, so a simulator is created with the settings of its
// phase set immediately before `GpuSim3.create`, and only one simulator is created at a time.
import type { WorldState } from "@bl/schema";
import type { CensusRead, KernelSim, SimContext, SimFactory } from "../lib/kernel-job.ts";
import { RATE_MAX_REMOVAL, RATE_MAX_VACANCY } from "../readout-kernel.ts";
import { GpuSim3 } from "./gpu-sim3-rps.ts";
import { RPS, type KillForm } from "./shaders3d-rps.ts";

/** Steps per GPU submission (the prototype's). */
export const SUBMIT_STEPS = 100;

/** Sets the patch from a phase's settings (`rpsKill`, `rpsRate`, `rpsMin`). The patch is on for every Gate-0 phase, so the mirror is live in a control too (rule draft 1.3). */
export function applySettings(settings: Record<string, unknown>): void {
  const kill = settings.rpsKill;
  if (kill !== "removal" && kill !== "vacancy") throw new Error(`settings.rpsKill must be removal or vacancy, got ${JSON.stringify(kill)}`);
  const rate = settings.rpsRate;
  const min = settings.rpsMin;
  if (!Number.isInteger(rate) || (rate as number) < 0 || (rate as number) > 0xffff_ffff) throw new Error(`settings.rpsRate must be a non-negative integer, got ${JSON.stringify(rate)}`);
  // the bounds of plan 5: the shader forms `RPS_RATE * ndom` in u32, and the removal kill's `mul_frac` needs 6 * rate < 2^16 (rate at most
  // 10,922), the vacancy test 6 * rate < 2^17 (at most 16,384); a larger rate wraps silently, and the kill stops being monotone in it
  const cap = kill === "vacancy" ? RATE_MAX_VACANCY : RATE_MAX_REMOVAL;
  if ((rate as number) > cap) throw new Error(`settings.rpsRate ${rate} is above ${cap}, the bound of the ${kill} kill (plan 5)`);
  if (!Number.isInteger(min) || (min as number) < 1 || (min as number) > 255) throw new Error(`settings.rpsMin must be 1 to 255, got ${JSON.stringify(min)}`);
  RPS.on = true;
  RPS.kill = kill as KillForm;
  RPS.rate = rate as number;
  RPS.min = min as number;
}

/** Wraps a GpuSim3: `run` submits in batches, `census` drains the ledger and reads the snapshot at the same step. */
export function gpuKernelSim(sim: GpuSim3): KernelSim {
  return {
    run: (count) => {
      for (let b = 0; b < count; b += SUBMIT_STEPS) sim.run(Math.min(SUBMIT_STEPS, count - b));
    },
    census: async (): Promise<CensusRead> => {
      const led = await sim.drainLedger();
      const snap = await sim.readSnapshot(false);
      return { step: snap.step, cells: snap.cells, genomeHead: snap.genomeHead, lightIn: led.lightIn, heatOut: led.heatOut, events: led.events.length + led.dropped };
    },
    readState: () => sim.readState(),
    destroy: () => sim.destroy(),
  };
}

/** The factory the harness uses on the GPU. `getDevice` hands out the device for a simulator (a rerun may be given a fresh one). */
export function gpuFactory(getDevice: (ctx: SimContext) => Promise<GPUDevice>): SimFactory {
  return async (ctx, state: WorldState) => {
    const device = await getDevice(ctx);
    applySettings(ctx.settings);
    return gpuKernelSim(await GpuSim3.create(device, state));
  };
}
