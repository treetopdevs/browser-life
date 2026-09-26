// Regenerates apps/coordinator/test/fixtures/small.blck (run from the repo root).
import { defaultConfig, soupWorld, encodeCheckpoint, stateHash } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
const cfg = defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 3, seed: 7 });
const sim = new RefSim(soupWorld(cfg, 2, 32, 64));
sim.run(12);
await Deno.writeFile("apps/coordinator/test/fixtures/small.blck", encodeCheckpoint(sim.state));
console.log(JSON.stringify({ step: sim.state.step, hash: stateHash(sim.state), seed: cfg.seed }));
