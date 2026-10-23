// Factory over the two GPU simulators: a slab config (tileD set) runs GpuSim3, anything else GpuSim.
import { isSlab, type WorldState } from "@bl/schema";
import { GpuSim } from "./gpu-sim.ts";
import { GpuSim3 } from "./gpu-sim3.ts";

export function createSim(device: GPUDevice, state: WorldState): Promise<GpuSim | GpuSim3> {
  return isSlab(state.cfg) ? GpuSim3.create(device, state) : GpuSim.create(device, state);
}
