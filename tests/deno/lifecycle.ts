// Runs a preset and reports inferred individuals and life events over time.
// deno run -A tests/deno/lifecycle.ts [preset=spots] [steps=6000] [censusEvery=25] [seed=1]
import { PRESETS, presetConfig, initWorld } from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { census, individuals, Tracker } from "@bl/metrics";

const preset = PRESETS.find((p) => p.id === (Deno.args[0] ?? "spots"))!;
const steps = Number(Deno.args[1] ?? 6000), every = Number(Deno.args[2] ?? 25), seed = Number(Deno.args[3] ?? 1);
const cfg = presetConfig(preset, seed);
const device = await requestDevice(navigator.gpu, cfg);
const sim = await GpuSim.create(device, initWorld(cfg, preset.init));
const tracker = new Tracker();
const t0 = performance.now();
for (let s = 0; s <= steps; s += every) {
  if (s) sim.run(every);
  const [cells, genomeHead] = await Promise.all([sim.readCells(), sim.readGenomeChannels(0, 4)]);
  const c = census({ cfg, step: sim.step, cells, genomeHead });
  tracker.update(c);
  if (s % 1000 === 0) {
    const ind = individuals(c);
    const meanMass = ind.reduce((a, k) => a + k.mass, 0) / Math.max(1, ind.length);
    console.log(`t=${sim.step} individuals=${ind.length} meanMass=${meanMass.toFixed(0)} lineages=${c.lineages.length} fissions=${tracker.fissions} fusions=${tracker.fusions} deaths=${tracker.history.filter((e) => e.kind === "death").length} births=${tracker.history.filter((e) => e.kind === "birth").length} maxGen=${tracker.maxGeneration()} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  }
}
sim.destroy();
