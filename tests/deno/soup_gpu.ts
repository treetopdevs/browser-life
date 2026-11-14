// GPU BFF soup (tools/soup/gpu.ts) vs the CPU port (tools/soup/bff.ts), byte
// for byte and in instruction counts, for both languages and a grid soup. Needs a real GPU.
//   deno run -A --no-lock tests/deno/soup_gpu.ts
import { Soup } from "../../tools/soup/bff.ts";
import { GpuSoup } from "../../tools/soup/gpu.ts";
import { soupDevice } from "../../tools/soup/device.ts";
import { strict as assert } from "node:assert";

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
  let ops = (await gpu.advance(25)).ops;
  ops += (await gpu.advance(15)).ops;
  let diff = 0;
  for (let i = 0; i < cpu.programs.length; i++) if (cpu.programs[i] !== gpu.cpu.programs[i]) diff++;
  const ok = diff === 0 && ops === cpu.ops;
  console.log(`${ok ? "PASS" : "FAIL"} ${lang}: ${diff} differing bytes, ops cpu ${cpu.ops} gpu ${ops}`);
  failed ||= !ok;
  gpu.destroy();
}
// A short completion count must roll state/counters back, not simply run more
// epochs. The injection changes the reported count after a real GPU execution.
{
  const p = { num: 4096, seed: 11, mutation: 1 << 24 };
  const cpu = new Soup(p);
  for (let i = 0; i < 100; i++) cpu.step();
  const gpu = await GpuSoup.create(dev, p);
  gpu.dropForTest = 3;
  const pending = gpu.advance(100, 32);
  assert.throws(() => gpu.step(1), /operation in progress/);
  assert.throws(() => gpu.upload(), /operation in progress/);
  assert.throws(() => gpu.destroy(), /operation in progress/);
  await assert.rejects(gpu.read(), /operation in progress/);
  const result = await pending;
  assert.deepEqual(gpu.cpu.programs, cpu.programs);
  assert.equal(result.ops, cpu.ops);
  assert.equal(result.retries, 3);
  assert.equal(gpu.cpu.epoch, cpu.epoch);
  assert.equal(gpu.cpu.runs, cpu.runs);
  assert.deepEqual(gpu.integrity, { checkedEpochs: 100, acceptedBatches: 4, rejectedBatches: 3, completedPairs: 100 * 2048 });
  gpu.destroy();
  console.log("PASS injected short counts: rollback/retry matches CPU bytes, epoch, runs, instructions");
}
{
  const gpu = await GpuSoup.create(dev, { num: 4096, seed: 11 });
  const before = gpu.cpu.programs.slice();
  gpu.dropForTest = 2;
  await assert.rejects(gpu.stepChecked(5, 2), /dropped work 2 times/);
  assert.deepEqual(gpu.cpu.programs, before);
  assert.equal(gpu.cpu.epoch, 0);
  assert.equal(gpu.cpu.runs, 0);
  assert.equal(await gpu.read(), 0);
  assert.deepEqual(gpu.cpu.programs, before); // GPU rollback too
  await assert.rejects(gpu.advance(1, 0), /batch/);
  await assert.rejects(gpu.stepChecked(2 ** 32), /completion counter/);
  await assert.rejects(gpu.stepChecked(1, 0), /tries/);
  gpu.step(1);
  await assert.rejects(gpu.stepChecked(1), /pending unchecked/);
  await gpu.read();
  gpu.destroy();
  console.log("PASS exhausted retries restore state; invalid counts and pending unchecked work rejected");
}
// Exercise evolved high-instruction tapes at historical population size, not
// only initially random programs. Read-only optional historical snapshot.
if (Deno.args[0]) {
  assert.match(Deno.args[0], /(?:^|\/)soup-12609\.bin$/, "optional fixture must be the raw historical seed-2 epoch-12609 snapshot");
  const bytes = await Deno.readFile(Deno.args[0]);
  assert.equal(bytes.length, 131072 * 64, "historical fixture must have 131072 raw programs");
  const p = { num: bytes.length / 64, seed: 2 };
  const cpu = new Soup(p);
  cpu.programs.set(bytes); cpu.epoch = 12609;
  const gpu = await GpuSoup.create(dev, p);
  gpu.cpu.programs.set(bytes); gpu.cpu.epoch = cpu.epoch; gpu.upload();
  cpu.step();
  const result = await gpu.advance(1);
  assert.deepEqual(gpu.cpu.programs, cpu.programs);
  assert.equal(result.ops, cpu.ops);
  console.log(`PASS historical seed-2 12609 → 12610: ${p.num} programs, ops ${result.ops}`);
  gpu.destroy();
}
{
  const badDevice = await soupDevice();
  badDevice.addEventListener("uncapturederror", e => e.preventDefault());
  const gpu = await GpuSoup.create(badDevice, { num: 4096, seed: 3 });
  const before = gpu.cpu.programs.slice();
  badDevice.destroy();
  await assert.rejects(gpu.stepChecked(2));
  assert.deepEqual(gpu.cpu.programs, before);
  assert.equal(gpu.cpu.epoch, 0);
  assert.equal(gpu.cpu.runs, 0);
  await assert.rejects(gpu.advance(1), /unusable/);
  gpu.destroy();
  console.log("PASS device failure restores CPU checkpoint and poisons the instance");
}
{
  const gpu = await GpuSoup.create(dev, { num: 4096, seed: 3 });
  const before = gpu.cpu.programs.slice();
  const invalid = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM }); // no COPY_DST
  (gpu as unknown as { uploadState: () => void }).uploadState = () => dev.queue.writeBuffer(invalid, 0, new Uint32Array(4));
  gpu.dropForTest = 1;
  await assert.rejects(gpu.stepChecked(2), /GPU soup:/);
  assert.deepEqual(gpu.cpu.programs, before);
  assert.equal(gpu.integrity.acceptedBatches, 0);
  await assert.rejects(gpu.advance(1), /unusable/);
  invalid.destroy(); gpu.destroy();
  console.log("PASS non-throwing WebGPU rollback validation error is captured; retry cannot succeed");
}
// A silently omitted rollback upload must not be mistaken for a valid retry.
{
  const gpu = await GpuSoup.create(dev, { num: 4096, seed: 3 });
  const before = gpu.cpu.programs.slice();
  (gpu as unknown as { uploadState: () => void }).uploadState = () => {};
  gpu.dropForTest = 1;
  await assert.rejects(gpu.stepChecked(2), /checkpoint upload readback mismatch/);
  assert.deepEqual(gpu.cpu.programs, before);
  assert.equal(gpu.integrity.acceptedBatches, 0);
  await assert.rejects(gpu.advance(1), /unusable/);
  gpu.destroy();
  console.log("PASS silent rollback upload omission is detected before retry");
}
{
  const gpu = await GpuSoup.create(dev, { num: 4096, seed: 3 });
  gpu.cpu.programs.fill(37); // a resumed checkpoint different from the GPU state
  const before = gpu.cpu.programs.slice();
  (gpu as unknown as { uploadState: () => void }).uploadState = () => {};
  await assert.rejects(gpu.uploadChecked(), /checkpoint upload readback mismatch/);
  assert.deepEqual(gpu.cpu.programs, before);
  await assert.rejects(gpu.advance(1), /unusable/);
  gpu.destroy();
  console.log("PASS silently omitted checkpoint upload cannot attest CPU-only bytes");
}
// A non-throwing initial/resume upload error must fail before evidence starts.
{
  const gpu = await GpuSoup.create(dev, { num: 4096, seed: 3 });
  const invalid = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM });
  (gpu as unknown as { uploadState: () => void }).uploadState = () => dev.queue.writeBuffer(invalid, 0, new Uint32Array(4));
  await assert.rejects(gpu.uploadChecked(), /GPU soup:/);
  await assert.rejects(gpu.advance(1), /unusable/);
  invalid.destroy(); gpu.destroy();
  console.log("PASS non-throwing checkpoint upload failure rejects checked resume");
}
{
  const a = await GpuSoup.create(dev, { num: 512, seed: 3 });
  const b = await GpuSoup.create(dev, { num: 512, seed: 4 });
  const pending = a.advance(2);
  await assert.rejects(b.advance(2), /operation in progress/);
  assert.throws(() => b.upload(), /operation in progress/);
  assert.throws(() => b.step(), /operation in progress/);
  await assert.rejects(GpuSoup.create(dev, { num: 512, seed: 5 }), /operation in progress/);
  await pending;
  await b.advance(2);
  a.destroy(); b.destroy();
  console.log("PASS shared-device soups cannot overlap checked error scopes");
}
dev.destroy();
Deno.exit(failed ? 1 : 0);
