// Skeptic re-measure: pure wall-clock, differential (T(2N)-T(N))/N so fixed submit/sync overhead cancels.
// Also varies batching (one pass vs many passes vs many submits) and adds an 8x8x8 workgroup variant.
import { defaultConfig, generalistWorld } from "@bl/schema";
import { affinityShader } from "@bl/sim-gpu";
import { makeFill } from "./kernel3d.ts";
import { affinity3dShader } from "./shader3d.ts";
import { BU, bindWorld, buf, compile, makeWorldBuffers, median } from "./harness.ts";

const adapter = (await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }))!;
const device = await adapter.requestDevice({ requiredLimits: {
  maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize,
  maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup, maxComputeWorkgroupSizeX: 1024, maxComputeWorkgroupSizeY: 1024, maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize } });
console.log("storage limit", device.limits.maxComputeWorkgroupStorageSize, "inv", device.limits.maxComputeInvocationsPerWorkgroup);

interface V { name: string; p: GPUComputePipeline; bg: GPUBindGroup; d: [number, number, number]; taps: number; cells: number }
const cfg = defaultConfig({ tileW: 256, tileH: 256, seed: 42 });
const w2 = generalistWorld(cfg, 12);
const n2 = 65536;
async function v2d(allAlive: boolean): Promise<V> {
  const p = await compile(device, affinityShader(cfg), "2d");
  const cells = buf(device, w2.cells.byteLength, BU.STORAGE | BU.COPY_DST, "c");
  const gen = w2.genome.slice();
  if (allAlive) { gen.fill(1, 1 * n2, 2 * n2); gen.fill((cfg.defaultMu | (cfg.defaultSigma << 16)) >>> 0, 2 * n2, 3 * n2); }
  const genome = buf(device, gen.byteLength, BU.STORAGE | BU.COPY_DST, "g");
  const U = buf(device, n2 * 4, BU.STORAGE | BU.COPY_SRC, "U");
  device.queue.writeBuffer(cells, 0, w2.cells as BufferSource); device.queue.writeBuffer(genome, 0, gen as BufferSource);
  return { name: allAlive ? "2D R9 256^2 all-alive" : "2D R9 256^2 generalist", p, bg: bindWorld(device, p, { cells, genome, U }), d: [16, 16, 1], taps: 224, cells: n2 };
}
async function v3d(name: string, sx: number, sy: number, sz: number, R: number, wg: [number, number, number], block: number, split?: number): Promise<V> {
  const sh = affinity3dShader({ sx, sy, sz, radius: R, wg, block, split, massUnit: cfg.massUnit, defMu: cfg.defaultMu, defSigma: cfg.defaultSigma });
  const p = await compile(device, sh.code, name);
  const w = makeWorldBuffers(device, sh.cells, makeFill(sh.cells, 5, true));
  return { name: `${name} [tile ${sh.smWords * 4}B thr ${sh.threads}]`, p, bg: bindWorld(device, p, w), d: sh.dispatch, taps: sh.taps, cells: sh.cells };
}

type Batching = "onepass" | "passes" | "submits";
async function wall(v: V, n: number, mode: Batching): Promise<number> {
  await device.queue.onSubmittedWorkDone();
  const t0 = performance.now();
  if (mode === "submits") {
    for (let i = 0; i < n; i++) {
      const e = device.createCommandEncoder(); const ps = e.beginComputePass(); ps.setPipeline(v.p); ps.setBindGroup(0, v.bg); ps.dispatchWorkgroups(...v.d); ps.end(); device.queue.submit([e.finish()]);
    }
  } else {
    const e = device.createCommandEncoder();
    if (mode === "onepass") { const ps = e.beginComputePass(); ps.setPipeline(v.p); ps.setBindGroup(0, v.bg); for (let i = 0; i < n; i++) ps.dispatchWorkgroups(...v.d); ps.end(); }
    else for (let i = 0; i < n; i++) { const ps = e.beginComputePass(); ps.setPipeline(v.p); ps.setBindGroup(0, v.bg); ps.dispatchWorkgroups(...v.d); ps.end(); }
    device.queue.submit([e.finish()]);
  }
  await device.queue.onSubmittedWorkDone();
  return (performance.now() - t0) * 1e3; // us total
}
/** differential per-dispatch us, median over trials */
async function perDispatch(v: V, mode: Batching, N: number, trials: number): Promise<{ med: number; lo: number; hi: number }> {
  await wall(v, 10, mode);
  const xs: number[] = [];
  for (let t = 0; t < trials; t++) { const a = await wall(v, N, mode), b = await wall(v, 3 * N, mode); xs.push((b - a) / (2 * N)); }
  xs.sort((x, y) => x - y);
  return { med: median(xs), lo: xs[0], hi: xs[xs.length - 1] };
}

const base = await v2d(false);
const baseAll = await v2d(true);
device.addEventListener("uncapturederror", (e: any) => console.error("GPU ERR", String(e.error?.message).slice(0, 200)));
const vs: V[] = [
  await v3d("3D64 R4 4x4x4 b2 split", 64, 64, 64, 4, [4, 4, 4], 2, 2048),
  await v3d("3D64 R4 8x8x8 b1 (PLAN doc WG=8 style)", 64, 64, 64, 4, [8, 8, 8], 1),
  await v3d("3D64 R4 8x8x8 b1 split", 64, 64, 64, 4, [8, 8, 8], 1, 2048),
  await v3d("3D64 R4 8x4x4 b1", 64, 64, 64, 4, [8, 4, 4], 1),
  await v3d("3D64 R4 8x4x4 b1 split", 64, 64, 64, 4, [8, 4, 4], 1, 2048),
  await v3d("3D64 R4 8x8x4 b1 split", 64, 64, 64, 4, [8, 8, 4], 1, 2048),
  await v3d("3D64 R4 4x4x4 b1 split", 64, 64, 64, 4, [4, 4, 4], 1, 2048),
  await v3d("3D64 R3 8x8x8 b1", 64, 64, 64, 3, [8, 8, 8], 1),
  await v3d("3D64 R3 8x8x4 b1", 64, 64, 64, 3, [8, 8, 4], 1),
  await v3d("3D64 R3 4x4x4 b2 split", 64, 64, 64, 3, [4, 4, 4], 2, 2048),
];
const TR = 15;
for (const mode of ["onepass"] as Batching[]) {
  const N = mode === "submits" ? 40 : 100;
  console.log(`\n== batching ${mode}, N=${N}, ${TR} trials, differential ==`);
  // interleave: measure base before and after the set to detect drift
  const b1 = await perDispatch(base, mode, N, TR);
  const ba = await perDispatch(baseAll, mode, N, TR);
  console.log(`${base.name}: ${b1.med.toFixed(1)} us [${b1.lo.toFixed(1)}..${b1.hi.toFixed(1)}]  | all-alive ${ba.med.toFixed(1)}`);
  for (const v of vs) {
    const r = await perDispatch(v, mode, Math.max(10, Math.floor(N * (v.taps * v.cells > 3e7 ? 0.1 : 1))), TR);
    console.log(`${v.name}: ${r.med.toFixed(1)} us [${r.lo.toFixed(1)}..${r.hi.toFixed(1)}]  ratio vs generalist ${(r.med / b1.med).toFixed(2)}  vs all-alive ${(r.med / ba.med).toFixed(2)}  (pred ${(v.taps * v.cells / (224 * 65536)).toFixed(2)})`);
  }
  const b2 = await perDispatch(base, mode, N, TR);
  console.log(`base after: ${b2.med.toFixed(1)} us`);
}
Deno.exit(0);
