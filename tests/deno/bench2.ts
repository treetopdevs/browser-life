import { PRESETS, presetConfig, initWorld } from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
const size = Number(Deno.args[0] ?? 256), R = Number(Deno.args[1] ?? 9), steps = Number(Deno.args[2] ?? 2000);
const p = PRESETS[0];
const cfg = presetConfig(p, 1, { tileW: size, tileH: size, kernelRadius: R });
const device = await requestDevice(navigator.gpu, cfg);
const sim = await GpuSim.create(device, initWorld(cfg, p.init));
sim.run(100); await device.queue.onSubmittedWorkDone();
const t0 = performance.now();
for (let s = 0; s < steps; s += 100) { sim.run(100); await device.queue.onSubmittedWorkDone(); }
const dt = (performance.now() - t0) / 1000;
console.log(`${size}² R=${R}: ${(steps / dt).toFixed(0)} steps/s`);
