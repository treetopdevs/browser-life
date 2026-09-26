// Throughput + long-run conservation check on native WebGPU.
// deno run -A tests/deno/bench.ts [size=256] [steps=2000] [batch=100]
import { defaultConfig, generalistWorld, ledgerResidual, totalsOf } from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";

const size = Number(Deno.args[0] ?? 256);
const steps = Number(Deno.args[1] ?? 2000);
const batch = Number(Deno.args[2] ?? 100);
const cfg = defaultConfig({ tileW: size, tileH: size, seed: 42 });
const init = generalistWorld(cfg, 12);
const start = totalsOf(cfg, init.cells);
const device = await requestDevice(navigator.gpu, cfg);
const sim = await GpuSim.create(device, init);
await device.queue.onSubmittedWorkDone();
const t0 = performance.now();
let lastCheck = t0;
for (let s = 0; s < steps; s += batch) {
  sim.run(Math.min(batch, steps - s));
  if (performance.now() - lastCheck > 5000 || s + batch >= steps) {
    const st = await sim.readState();
    const t = totalsOf(cfg, st.cells);
    const resid = ledgerResidual(start, st);
    const living = st.genome.subarray(0, size * size).reduce((a, v, i) => a + ((v | st.genome[size * size + i]) ? 1 : 0), 0);
    console.log(`step ${st.step} matterΔ=${t.matter - start.matter} energyResidual=${resid} B=${t.B} P=${t.P} living=${living} ${((st.step * 1000) / (performance.now() - t0)).toFixed(0)} steps/s`);
    if (t.matter !== start.matter || resid !== 0n) { console.error("CONSERVATION FAILURE"); Deno.exit(1); }
    lastCheck = performance.now();
  }
}
await device.queue.onSubmittedWorkDone();
const dt = (performance.now() - t0) / 1000;
console.log(`${size}x${size}: ${steps} steps in ${dt.toFixed(2)}s = ${(steps / dt).toFixed(0)} steps/s`);
sim.destroy();
