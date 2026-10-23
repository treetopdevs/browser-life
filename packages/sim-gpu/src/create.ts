// Factory over the two GPU simulators: a slab config (tileD set) runs GpuSim3, anything else GpuSim.
import { isSlab, type WorldConfig, type WorldState } from "@bl/schema";
import { GpuSim, requestDevice } from "./gpu-sim.ts";
import { GpuSim3, requestDevice3 } from "./gpu-sim3.ts";

export function createSim(device: GPUDevice, state: WorldState): Promise<GpuSim | GpuSim3> {
  return isSlab(state.cfg) ? GpuSim3.create(device, state) : GpuSim.create(device, state);
}

/** A device sized for `cfg`: `requestDevice3` for a slab (49 genome words per cell), `requestDevice` otherwise. */
export function requestDeviceFor(gpu: GPU, cfg: WorldConfig): Promise<GPUDevice> {
  return isSlab(cfg) ? requestDevice3(gpu, cfg) : requestDevice(gpu, cfg);
}
