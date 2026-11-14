// GPU BFF soup (tools/soup/gpu.ts) vs the CPU port (tools/soup/bff.ts), byte
// for byte and in instruction counts, for both languages and a grid soup, and a
// competition race (runAssayGpu vs runAssay). Needs a real GPU.
//   deno run -A --no-lock tests/deno/soup_gpu.ts
import { Soup } from "../../tools/soup/bff.ts";
import { soupDevice } from "../../tools/soup/device.ts";
import { GpuSoup } from "../../tools/soup/gpu.ts";
import { type AssayJob, runAssay } from "../../tools/soup/evo.ts";
import { runAssayGpu } from "../../tools/soup/evo-gpu.ts";

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
// A race (runAssay) on the GPU path equals the CPU race, result for result:
// a copier pair from run 1 (wm2), a short race with an extra validity epoch.
{
  const A = ["dd25a937145b6ea14f1fb6a1f53cb6a12c4c4c7d52b4cc2836362f36365d5d36363636362826b4e67d4c7c2ca1b63cf5a1b61f4fa16e5b123dc9a1333b08333f", "3f33083b33a1c93d125b6ea14f1fb6a1f53cb6a12c7c4c7de6b4262836363636365d5d36362f363628ccb4527d4c4c2ca1b63cf5a1b61f4fa16e5b1437a925dd"];
  const job: AssayJob = { id: "gpu-race-check", kind: "pair", lineage: "t", rare: "a", common: "rand", rareForms: A, commonForms: [A[0].replace(/^dd25/, "0000")], seed: 12345, num: 2048, rareCount: 256, epochs: 96, every: 32, validAt: [48] };
  const cpu = JSON.stringify(runAssay(job)), gpu = JSON.stringify(await runAssayGpu(job, dev));
  const ok = cpu === gpu;
  console.log(`${ok ? "PASS" : "FAIL"} race: GPU result ${ok ? "equals" : "differs from"} CPU result`);
  failed ||= !ok;
}
// Checked steps: forced short counts make advance() undo and redo batches; the
// result must still equal the CPU soup in bytes, epoch, runs and instructions.
{
  const p = { num: 4096, seed: 11, mutation: 1 << 24 };
  const cpu = new Soup(p);
  for (let e = 0; e < 100; e++) cpu.step();
  const gpu = await GpuSoup.create(dev, p);
  gpu.dropForTest = 3;
  const r = await gpu.advance(100, 32); // batches 32, 32, 32, 4; the first three are each redone once
  let diff = 0;
  for (let i = 0; i < cpu.programs.length; i++) if (cpu.programs[i] !== gpu.cpu.programs[i]) diff++;
  const ok = diff === 0 && r.retries === 3 && gpu.cpu.epoch === cpu.epoch && gpu.cpu.runs === cpu.runs && r.ops === cpu.ops;
  console.log(`${ok ? "PASS" : "FAIL"} checked steps: ${diff} differing bytes, ${r.retries} redone, epoch ${gpu.cpu.epoch}/${cpu.epoch}, runs ${gpu.cpu.runs}/${cpu.runs}, ops ${r.ops}/${cpu.ops}`);
  failed ||= !ok;
}
Deno.exit(failed ? 1 : 0);
