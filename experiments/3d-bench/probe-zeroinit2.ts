import { buf, BU, compile, getDevice, median, timeVariant, type Variant } from "./harness.ts";
const { device } = await getDevice(navigator.gpu);
async function mk(name: string, decl: string, body: string): Promise<Variant> {
  const code = `${decl}
@group(0) @binding(0) var<storage, read_write> o: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) w: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  ${body}
}`;
  const pipeline = await compile(device, code, name);
  const o = buf(device, 4096 * 64 * 4, BU.STORAGE, "o");
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: o } }] });
  return { name, taps: 0, cells: 0, pipeline, bind, dispatch: [512, 1, 1] };
}
const vs = [
  await mk("16KB vec4 array", "var<workgroup> sm: array<vec4<u32>, 1024>;", "sm[li] = vec4<u32>(li); workgroupBarrier(); o[w.x*64u+li] = sm[(li+1u)%64u].x;"),
  await mk("16KB struct of 2 arrays", "struct T { a: array<u32, 2048>, b: array<u32, 2048> }; var<workgroup> sm: T;", "sm.a[li] = li; sm.b[li]=li; workgroupBarrier(); o[w.x*64u+li] = sm.a[(li+1u)%64u]+sm.b[li];"),
  await mk("16KB array<array<u32,256>,16>", "var<workgroup> sm: array<array<u32, 256>, 16>;", "sm[li%16u][li] = li; workgroupBarrier(); o[w.x*64u+li] = sm[(li+1u)%16u][li];"),
  await mk("16KB array<u32>, 1 array", "var<workgroup> sm: array<u32, 4096>;", "sm[li] = li; workgroupBarrier(); o[w.x*64u+li] = sm[(li+1u)%64u];"),
];
for (const v of vs) {
  await timeVariant(device, v, 20, "timestamp");
  const t: number[] = [];
  for (let i = 0; i < 7; i++) t.push(median(await timeVariant(device, v, 50, "timestamp")));
  console.log(`${v.name}: ${(median(t) / 1e3).toFixed(1)} us`);
}
Deno.exit(0);
