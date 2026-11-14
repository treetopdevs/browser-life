// The CPU reference slab as a KernelSim, for the tests of the kernel-job harness and the Gate-0 spike's job code. The reference
// simulator is slow (about 15 ms a step on the smallest slab), so tests that use it run a few tens of steps.
import { cloneState, defaultConfig, type WorldConfig } from "@bl/schema";
import { RefSim3 } from "@bl/sim-ref";
import type { SimFactory } from "../3d-rps/lib/kernel-job.ts";

/** A smallest-slab config (8 x 8 x 4) with no mutation, as the Gate-0 jobs have. */
export const refCfg = (seed: number, o: Partial<WorldConfig> = {}): WorldConfig =>
  defaultConfig({ kernelRadius: 3, tileD: 4, tileW: 8, tileH: 8, lightK: 1024, lightMode: "uniform", mutRate: 0, seed, ...o });

/** RefSim3 as a KernelSim: the census reads its arrays in place (valid until the next run), readState is a copy. */
export const refFactory: SimFactory = (_ctx, state) => {
  const sim = new RefSim3(cloneState(state));
  const n = state.cells.length / 7;
  let events = 0;
  return {
    run: (count: number) => {
      events += sim.run(count).length;
    },
    census: () => {
      const e = events;
      events = 0;
      return { step: sim.state.step, cells: sim.state.cells, genomeHead: sim.state.genome.subarray(0, 4 * n), lightIn: sim.state.lightIn, heatOut: sim.state.heatOut, events: e };
    },
    readState: () => cloneState(sim.state),
    destroy: () => {},
  };
};
