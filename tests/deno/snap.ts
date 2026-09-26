// Run a world and write PNG snapshots + a stats timeline.
// deno run -A tests/deno/snap.ts <outdir> <steps> <every> '<json cfg overrides>' [init=generalist|soup]
import { defaultConfig, generalistWorld, soupWorld, totalsOf, CH, G, cellCount } from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { renderRGBA, imageSize } from "@bl/metrics";
import { encodePNG } from "./png.ts";

const [outdir, stepsS, everyS, json, initKind, nutS, bioS] = Deno.args;
const cfg = defaultConfig({ tileW: 192, tileH: 192, ...(json ? JSON.parse(json) : {}) });
const nut = Number(nutS ?? 256), bio = Number(bioS ?? 256);
const init = initKind === "soup" ? soupWorld(cfg, 20, nut, bio) : generalistWorld(cfg, 6, nut, bio);
await Deno.mkdir(outdir, { recursive: true });
const device = await requestDevice(navigator.gpu, cfg);
const sim = await GpuSim.create(device, init);
const steps = Number(stepsS ?? 2000), every = Number(everyS ?? 500);
const n = cellCount(cfg);
for (let s = 0; s <= steps; s += every) {
  for (let k = 0; k < (s > 0 ? every : 0); k += 200) {
    sim.run(Math.min(200, every - k));
    await device.queue.onSubmittedWorkDone();
  }
  const st = await sim.readState();
  const t = totalsOf(cfg, st.cells);
  let living = 0, maxB = 0;
  const lins = new Set<string>();
  for (let i = 0; i < n; i++) {
    const hi = st.genome[G.LIN_HI * n + i], lo = st.genome[G.LIN_LO * n + i];
    if (hi | lo) { living++; lins.add(hi + ":" + lo); }
    maxB = Math.max(maxB, st.cells[CH.B * n + i]);
  }
  console.log(`t=${st.step} A=${t.A} B=${t.B} C=${t.C} P=${t.P} E=${t.E} S=${t.S} living=${living} lineages=${lins.size} maxB=${maxB}`);
  const [w, h] = imageSize(st);
  const comp = renderRGBA(st, "composite");
  const lin = renderRGBA(st, "lineage");
  const both = new Uint8ClampedArray(w * 2 * h * 4);
  for (let y = 0; y < h; y++) {
    both.set(comp.subarray(y * w * 4, (y + 1) * w * 4), y * 2 * w * 4);
    both.set(lin.subarray(y * w * 4, (y + 1) * w * 4), (y * 2 * w + w) * 4);
  }
  await Deno.writeFile(`${outdir}/t${String(st.step).padStart(6, "0")}.png`, await encodePNG(both, w * 2, h, 2));
}
sim.destroy();
