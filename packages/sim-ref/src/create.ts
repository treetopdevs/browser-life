// Factory over the two CPU references: a slab config (tileD set) runs RefSim3, anything else RefSim.
import { isSlab, type WorldState } from "@bl/schema";
import { RefSim } from "./step.ts";
import { RefSim3 } from "./step3d.ts";

export function createSim(state: WorldState): RefSim | RefSim3 {
  return isSlab(state.cfg) ? new RefSim3(state) : new RefSim(state);
}
