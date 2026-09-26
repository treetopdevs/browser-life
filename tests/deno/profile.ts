// Per-pass GPU timings via timestamp queries.
import { PRESETS, presetConfig, initWorld } from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
const size = Number(Deno.args[0] ?? 256);
const p = PRESETS[0];
const cfg = presetConfig(p, 1, { tileW: size, tileH: size });
const device = await requestDevice(navigator.gpu, cfg);
if (!device.features.has("timestamp-query")) { console.log("no timestamp-query"); Deno.exit(0); }
const sim = await GpuSim.create(device, initWorld(cfg, p.init));
sim.run(500);
const steps = 50;
const set = device.createQuerySet({ type: "timestamp", count: steps * 10 });
sim.profile = { set, next: 0 };
const enc = device.createCommandEncoder();
for (let s = 0; s < steps; s++) sim.encodeStep(enc);
const res = device.createBuffer({ size: steps * 10 * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
const rd = device.createBuffer({ size: steps * 10 * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
enc.resolveQuerySet(set, 0, steps * 10, res, 0);
enc.copyBufferToBuffer(res, 0, rd, 0, steps * 10 * 8);
device.queue.submit([enc.finish()]);
await rd.mapAsync(GPUMapMode.READ);
const t = new BigUint64Array(rd.getMappedRange());
const names = ["affinity", "flow", "transport", "react", "tick"];
const tot = [0, 0, 0, 0, 0];
for (let s = 0; s < steps; s++) for (let k = 0; k < 5; k++) tot[k] += Number(t[(s * 5 + k) * 2 + 1] - t[(s * 5 + k) * 2]) / 1e3;
console.log(names.map((n, k) => `${n} ${(tot[k] / steps).toFixed(1)}µs`).join("  "));
