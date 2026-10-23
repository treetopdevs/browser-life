// Probe: minimal kernels (shared write, barrier, shared read, one output write; NOT empty) with one vs several workgroup declarations.
// deno run -A --no-lock experiments/3d-bench/probe-zeroinit.ts
import { buf, BU, compile, getDevice, median, timeVariant, type Variant } from "./harness.ts";
const { device, env } = await getDevice(navigator.gpu);
console.log(env.adapter);
const N = 512 * 512; // 512 workgroups x 64 threads worth of work: 4096 groups of 64
async function mk(words: number, parts: number): Promise<Variant> {
  const per = words / parts;
  const decl = Array.from({ length: parts }, (_, k) => `var<workgroup> sm${k}: array<u32, ${per}>;`).join("\n");
  const code = `
${decl}
@group(0) @binding(0) var<storage, read_write> o: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) w: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  ${Array.from({ length: parts }, (_, k) => `sm${k}[li] = li;`).join(" ")}
  workgroupBarrier();
  o[w.x * 64u + li] = ${Array.from({ length: parts }, (_, k) => `sm${k}[(li + 1u) % 64u]`).join(" + ")};
}`;
  const pipeline = await compile(device, code, `zi-${words}`);
  const o = buf(device, 4096 * 64 * 4, BU.STORAGE, "o");
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: o } }] });
  return { name: `tile ${words * 4} B in ${parts} array(s)`, taps: 0, cells: 0, pipeline, bind, dispatch: [512, 1, 1] };
}
for (const [w, parts] of [[2048, 1], [2744, 1], [2744, 2], [4096, 1], [4096, 2], [4096, 4], [4096, 8]]) {
  const v = await mk(w, parts);
  await timeVariant(device, v, 20, "timestamp");
  const t: number[] = [];
  for (let i = 0; i < 7; i++) t.push(median(await timeVariant(device, v, 50, "timestamp")));
  console.log(`${v.name}: ${(median(t) / 1e3).toFixed(1)} us for 512 workgroups`);
}
Deno.exit(0);
