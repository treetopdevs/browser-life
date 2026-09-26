// μ/σ sweep: one tile per (mu, sigma) founder. Global overrides via JSON.
// deno run -A tests/deno/sweep.ts <out.png> <steps> '<cfg json>' '<mus csv>' '<sigmas csv>' [tile=64] [biomass=256] [radius=12]
import { defaultConfig, buildWorld, generalistGenome, CH, cellCount, type Founder } from "@bl/schema";
import { GpuSim, requestDevice } from "@bl/sim-gpu";
import { renderRGBA, imageSize } from "@bl/metrics";
import { encodePNG } from "./png.ts";

const [out, stepsS, json, musS, sigS, tileS, bioS, radS, nutS] = Deno.args;
const mus = musS.split(",").map(Number), sigmas = sigS.split(",").map(Number);
const tile = Number(tileS ?? 64);
const cfg = defaultConfig({ tileW: tile, tileH: tile, tilesX: mus.length, tilesY: sigmas.length, ...JSON.parse(json || "{}") });
const founders: Founder[] = [];
for (let ty = 0; ty < sigmas.length; ty++)
  for (let tx = 0; tx < mus.length; tx++)
    founders.push({ x: tx * tile + tile / 2, y: ty * tile + tile / 2, radius: Number(radS ?? 12), genome: generalistGenome(mus[tx], sigmas[ty]), biomass: Number(bioS ?? 256), energy: 512 });
const init = buildWorld(cfg, { nutrient: Number(nutS ?? 256), founders });
const device = await requestDevice(navigator.gpu, cfg);
const sim = await GpuSim.create(device, init);
for (let s = 0; s < Number(stepsS); s += 200) {
  sim.run(Math.min(200, Number(stepsS) - s));
  await device.queue.onSubmittedWorkDone();
}
const st = await sim.readState();
const [w, h] = imageSize(st);
await Deno.writeFile(out, await encodePNG(renderRGBA(st, "lineage"), w, h, 2));
const n = cellCount(cfg);
const rows: string[] = [];
for (let ty = 0; ty < sigmas.length; ty++) {
  const row: string[] = [];
  for (let tx = 0; tx < mus.length; tx++) {
    let m = 0, occ = 0;
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) {
      const i = (ty * tile + y) * w + tx * tile + x;
      const b = st.cells[CH.B * n + i] + st.cells[CH.P * n + i];
      m += b; if (b > 64) occ++;
    }
    row.push(`${(m / 256).toFixed(0)}/${occ}`);
    void 0;
  }
  rows.push(`σ=${sigmas[ty]}: ` + row.join("  "));
}
console.log(`mass(units)/occupied cells, mus=${mus.join(",")}\n` + rows.join("\n"));
sim.destroy();
