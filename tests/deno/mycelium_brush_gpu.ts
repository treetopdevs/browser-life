// GPU read -> brush -> upload against the CPU reference: the page's stroke path (apps/lab/src/mycelium/page.ts) on the
// GPU engine. A CPU world and a GPU world run side by side; at each stroke the GPU state is read back, brushed with
// applyBrush, validated and uploaded, while the CPU world is brushed in place. Both must report the same stroke, hold
// the same digest right after, and stay identical to the end (so upload() restored everything the next steps need).
//
//   deno run -A --no-lock tests/deno/mycelium_brush_gpu.ts
//
// Needs a real GPU (native WebGPU). Exits non-zero on any mismatch.
import { applyBrush } from "../../tools/mycelium/brush.ts";
import { GpuMycelium, myceliumDevice } from "../../tools/mycelium/gpu.ts";
import { createWorld, defaultConfig, energyTotal, matterTotal, stateDigest, step, validateState } from "../../tools/mycelium/world.ts";

const dev = await myceliumDevice();
type Stroke = ["wound" | "scrape", number, number, number];
const strokes: Stroke[] = [["wound", 10, 10, 9], ["scrape", 40, 30, 12], ["wound", 63, 0, 20], ["wound", 5, 5, 100]];
const arms = [
  { name: "inherit, uniform", over: {} },
  { name: "blocked", over: { heredity: "blocked" as const } },
  { name: "gradient, 96 x 64", over: { lightPattern: "gradient" as const, width: 96, height: 64 } },
];
let failed = 0;
const fail = (msg: string) => { failed++; console.error(`FAIL ${msg}`); };

for (const arm of arms) {
  const cfg = defaultConfig({ width: 64, height: 64, founders: 600, maxParticles: 4096, ...arm.over });
  const cpu = createWorld(cfg);
  const gpu = await GpuMycelium.create(dev, createWorld(cfg));
  let t = 0;
  for (const [kind, x, y, r] of strokes) {
    for (let k = 0; k < 40; k++) step(cpu);
    gpu.step(40); t += 40;
    const s = await gpu.read();
    if (stateDigest(s) !== stateDigest(cpu)) { fail(`${arm.name}: pre-stroke state differs at step ${t}`); break; }
    const rc = applyBrush(cpu, kind, x, y, r), rg = applyBrush(s, kind, x, y, r);
    if (JSON.stringify(rc) !== JSON.stringify(rg)) { fail(`${arm.name}: stroke reports differ (${kind} at ${x},${y} r${r})`); break; }
    const bad = validateState(s);
    if (bad.length) { fail(`${arm.name}: brushed state invalid: ${bad[0]}`); break; }
    gpu.upload(s);
    const back = await gpu.read(); // what the page shows after a stroke: the GPU's own state, read after the upload
    if (stateDigest(back) !== stateDigest(cpu)) { fail(`${arm.name}: GPU after upload differs from CPU (${kind} at ${x},${y} r${r})`); break; }
    if (matterTotal(back) !== back.matter0 || energyTotal(back) !== back.energy0 + back.totals.lightIn - back.totals.heat) { fail(`${arm.name}: residual after upload`); break; }
    console.log(`  ${arm.name}: ${kind} (${x},${y}) r${r}: n ${cpu.n}, moved ${rc.matterMoved}, removed ${rc.removed}`);
  }
  for (let k = 0; k < 60; k++) step(cpu);
  gpu.step(60);
  const fin = await gpu.read();
  if (stateDigest(fin) !== stateDigest(cpu)) fail(`${arm.name}: final state differs after 60 more steps`);
  if (validateState(fin).length) fail(`${arm.name}: final state invalid`);
  console.log(`${failed ? "FAIL" : "ok"} ${arm.name}: n ${fin.n}, step ${fin.step}`);
  gpu.destroy();
}
if (failed) { console.error(`${failed} failure(s)`); Deno.exit(1); }
console.log("all brush/upload cases match the CPU reference");
