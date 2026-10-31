// GPU BFF soup (tools/soup/gpu.ts) vs the CPU port (tools/soup/bff.ts), byte
// for byte and in instruction counts, for both languages and a grid soup. Needs a real GPU.
//   deno run -A --no-lock tests/deno/soup_gpu.ts
import { Soup } from "../../tools/soup/bff.ts";
import { GpuSoup, soupDevice } from "../../tools/soup/gpu.ts";

const dev = await soupDevice();
let failed = false;
const cases = [
  { name: "noheads", p: { num: 4096, seed: 7, lang: "noheads" as const, mutation: 1 << 24 } },
  { name: "heads", p: { num: 4096, seed: 7, lang: "heads" as const, mutation: 1 << 24 } },
  { name: "grid 64x64", p: { num: 4096, seed: 7, mutation: 1 << 24, grid: { width: 64, height: 64, radius: 2 } } },
];
for (const { name: lang, p } of cases) {
  // A high mutation rate (1/64) exercises far more code paths per epoch.
  const cpu = new Soup(p);
  const gpu = await GpuSoup.create(dev, p);
  for (let e = 0; e < 40; e++) cpu.step();
  gpu.step(25);
  let ops = await gpu.read();
  gpu.step(15); // two batches, so read() between them is covered too
  ops += await gpu.read();
  let diff = 0;
  for (let i = 0; i < cpu.programs.length; i++) if (cpu.programs[i] !== gpu.cpu.programs[i]) diff++;
  const ok = diff === 0 && ops === cpu.ops;
  console.log(`${ok ? "PASS" : "FAIL"} ${lang}: ${diff} differing bytes, ops cpu ${cpu.ops} gpu ${ops}`);
  failed ||= !ok;
}
Deno.exit(failed ? 1 : 0);
