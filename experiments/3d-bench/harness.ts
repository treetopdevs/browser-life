// Rung 1a (throwaway): device setup, buffers, timing and stats. No Deno-only APIs.
import { type Fill } from "./kernel3d.ts";
import { affinity3dShader, type Aff3Opts, transport27Shader, CELL_CH, GENOME_CH } from "./shader3d.ts";

export const BU = { STORAGE: 0x80, COPY_SRC: 0x04, COPY_DST: 0x08, MAP_READ: 0x01, QUERY_RESOLVE: 0x200 };

export interface Env {
  adapter: string; features: string[]; timestamps: boolean;
  maxComputeWorkgroupStorageSize: number; maxComputeInvocationsPerWorkgroup: number;
}

export async function getDevice(gpu: GPU): Promise<{ device: GPUDevice; env: Env }> {
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("no adapter");
  const limits: Record<string, number> = {
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBuffersPerShaderStage: Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 10),
    // raised so the literal 8x8x8 (512 invocation) workgroup of the plan can be tried
    maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
    maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
    maxComputeWorkgroupSizeY: adapter.limits.maxComputeWorkgroupSizeY,
    maxComputeWorkgroupSizeZ: adapter.limits.maxComputeWorkgroupSizeZ,
    maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
  };
  const ts = adapter.features.has("timestamp-query");
  const device = await adapter.requestDevice({ requiredLimits: limits, requiredFeatures: ts ? ["timestamp-query"] : [] });
  const info = (adapter as any).info ?? (await (adapter as any).requestAdapterInfo?.()) ?? {};
  return {
    device,
    env: {
      adapter: `${info.vendor ?? "?"} / ${info.architecture ?? "?"} / ${info.device ?? ""} / ${info.description ?? ""}`,
      features: [...adapter.features], timestamps: ts,
      maxComputeWorkgroupStorageSize: device.limits.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup: device.limits.maxComputeInvocationsPerWorkgroup,
    },
  };
}

export interface Variant {
  name: string;
  taps: number;
  cells: number;
  pipeline?: GPUComputePipeline;
  bind?: GPUBindGroup;
  uBuf?: GPUBuffer;
  dispatch: [number, number, number];
  note?: string;
  /** Custom timing source (the real GpuSim profile hook): returns per-dispatch ns. */
  custom?: (iters: number) => Promise<number[]>;
}

export async function compile(device: GPUDevice, code: string, label: string): Promise<GPUComputePipeline> {
  device.pushErrorScope("validation");
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo?.();
  const errs = info?.messages.filter((m) => m.type === "error") ?? [];
  if (errs.length) throw new Error(`${label}: ${errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join("\n")}`);
  const p = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" }, label });
  const err = await device.popErrorScope();
  if (err) throw new Error(`${label}: ${err.message}`);
  return p;
}

export function buf(device: GPUDevice, bytes: number, usage: number, label: string): GPUBuffer {
  return device.createBuffer({ size: Math.max(16, Math.ceil(bytes / 4) * 4), usage, label });
}

/** Writes B, P channels and the three genome head channels from a Fill into fresh buffers (rest zero). */
export function makeWorldBuffers(device: GPUDevice, n: number, fill: Fill) {
  const cells = buf(device, CELL_CH * n * 4, BU.STORAGE | BU.COPY_DST | BU.COPY_SRC, "cells");
  const genome = buf(device, GENOME_CH * n * 4, BU.STORAGE | BU.COPY_DST, "genome");
  const U = buf(device, n * 4, BU.STORAGE | BU.COPY_SRC | BU.COPY_DST, "U");
  const q = device.queue;
  q.writeBuffer(cells, 1 * n * 4, fill.B as BufferSource);
  q.writeBuffer(cells, 3 * n * 4, fill.P as BufferSource);
  q.writeBuffer(genome, 0, fill.linHi as BufferSource);
  q.writeBuffer(genome, 1 * n * 4, fill.linLo as BufferSource);
  q.writeBuffer(genome, 2 * n * 4, fill.param0 as BufferSource);
  return { cells, genome, U };
}

export function bindWorld(device: GPUDevice, pipeline: GPUComputePipeline, w: { cells: GPUBuffer; genome: GPUBuffer; U: GPUBuffer }): GPUBindGroup {
  return device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: w.cells } }, { binding: 1, resource: { buffer: w.genome } }, { binding: 2, resource: { buffer: w.U } }] });
}

export async function makeAff3(device: GPUDevice, name: string, o: Aff3Opts, fill: Fill, env: Env): Promise<Variant> {
  const sh = affinity3dShader(o);
  if (sh.smWords * 4 > env.maxComputeWorkgroupStorageSize) throw new Error(`${name}: tile ${sh.smWords * 4} B > workgroup storage limit ${env.maxComputeWorkgroupStorageSize}`);
  if (sh.threads > env.maxComputeInvocationsPerWorkgroup) throw new Error(`${name}: ${sh.threads} invocations over limit`);
  const pipeline = await compile(device, sh.code, name);
  const w = makeWorldBuffers(device, sh.cells, fill);
  return { name, taps: sh.taps, cells: sh.cells, pipeline, bind: bindWorld(device, pipeline, w), uBuf: w.U, dispatch: sh.dispatch, note: `tile ${sh.smWords * 4} B, ${sh.threads} thr, ${sh.dispatch.join("x")} wg` };
}

export async function makeTransport27(device: GPUDevice, name: string, sx: number, sy: number, sz: number): Promise<Variant> {
  const sh = transport27Shader(sx, sy, sz);
  const pipeline = await compile(device, sh.code, name);
  const src = buf(device, sh.cells * 4, BU.STORAGE | BU.COPY_DST, "src");
  const dst = buf(device, sh.cells * 4, BU.STORAGE, "dst");
  device.queue.writeBuffer(src, 0, new Uint32Array(sh.cells).map((_, i) => Math.imul(i, 2654435761) >>> 0));
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: src } }, { binding: 1, resource: { buffer: dst } }] });
  return { name, taps: 27, cells: sh.cells, pipeline, bind, dispatch: sh.dispatch };
}

export async function readU(device: GPUDevice, v: Variant): Promise<Int32Array> {
  const rd = buf(device, v.cells * 4, BU.MAP_READ | BU.COPY_DST, "rd");
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(v.uBuf!, 0, rd, 0, v.cells * 4);
  device.queue.submit([enc.finish()]);
  await rd.mapAsync(1);
  const out = new Int32Array(rd.getMappedRange().slice(0));
  rd.unmap(); rd.destroy();
  return out;
}

export async function dispatchOnce(device: GPUDevice, v: Variant): Promise<void> {
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(v.pipeline!); pass.setBindGroup(0, v.bind!);
  pass.dispatchWorkgroups(...v.dispatch);
  pass.end();
  device.queue.submit([enc.finish()]);
  await device.queue.onSubmittedWorkDone();
}

// Metal runs out of counter sample buffers if query sets are created per batch, so one set is reused.
const tsCache = new WeakMap<GPUDevice, { count: number; set: GPUQuerySet; res: GPUBuffer; rd: GPUBuffer }>();
function tsResources(device: GPUDevice, iters: number) {
  let c = tsCache.get(device);
  if (!c || c.count < iters) {
    const count = Math.max(iters, 400);
    c = { count, set: device.createQuerySet({ type: "timestamp", count: count * 2 }), res: buf(device, count * 16, BU.QUERY_RESOLVE | BU.COPY_SRC, "res"), rd: buf(device, count * 16, BU.MAP_READ | BU.COPY_DST, "rd") };
    tsCache.set(device, c);
  }
  return c;
}

export type Method = "timestamp" | "wall";

/** Timing-validity bookkeeping: how many timestamp batches were rejected and replaced by wall-clock batches. */
export const timingStats = { timestampBatches: 0, fallbackBatches: 0, fallbackNames: new Set<string>(), droppedSamples: 0 };

/** Throws when a timestamp batch is unusable: any zero/negative duration, or durations quantised to a coarse grid. */
export function validateTimestamps(name: string, d: bigint[]): number[] {
  const out = d.map(Number);
  const bad = out.filter((x) => !(x > 0)).length;
  if (bad > 0) { timingStats.droppedSamples += bad; throw new Error(`${name}: ${bad}/${out.length} zero or negative durations`); }
  const distinct = new Set(out).size;
  if (out.length >= 20 && distinct < 4) throw new Error(`${name}: only ${distinct} distinct durations in ${out.length} samples (quantised timestamps)`);
  return out;
}

async function wallBatch(device: GPUDevice, v: Variant, iters: number): Promise<number[]> {
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(v.pipeline!); pass.setBindGroup(0, v.bind!);
  for (let i = 0; i < iters; i++) pass.dispatchWorkgroups(...v.dispatch);
  pass.end();
  const cmd = enc.finish();
  await device.queue.onSubmittedWorkDone();
  const t0 = performance.now();
  device.queue.submit([cmd]);
  await device.queue.onSubmittedWorkDone();
  return [((performance.now() - t0) * 1e6) / iters];
}

/** Per-dispatch ns for `iters` dispatches. timestamp: one pass each with begin/end stamps (validated; a bad batch falls back to wall time); wall: one pass, onSubmittedWorkDone. */
export async function timeVariant(device: GPUDevice, v: Variant, iters: number, method: Method): Promise<number[]> {
  if (v.custom) return v.custom(iters);
  if (method === "wall") return wallBatch(device, v, iters);
  timingStats.timestampBatches++;
  try {
    const { set, res, rd } = tsResources(device, iters);
    const enc = device.createCommandEncoder();
    for (let i = 0; i < iters; i++) {
      const pass = enc.beginComputePass({ timestampWrites: { querySet: set, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 } });
      pass.setPipeline(v.pipeline!); pass.setBindGroup(0, v.bind!);
      pass.dispatchWorkgroups(...v.dispatch);
      pass.end();
    }
    enc.resolveQuerySet(set, 0, iters * 2, res, 0);
    enc.copyBufferToBuffer(res, 0, rd, 0, iters * 16);
    device.queue.submit([enc.finish()]);
    await rd.mapAsync(1);
    const t = new BigUint64Array(rd.getMappedRange().slice(0, iters * 16));
    rd.unmap();
    const d: bigint[] = [];
    for (let i = 0; i < iters; i++) d.push(t[2 * i + 1] - t[2 * i]);
    return validateTimestamps(v.name, d);
  } catch (e) {
    timingStats.fallbackBatches++; timingStats.fallbackNames.add(v.name);
    console.warn(`timestamp batch rejected, using wall time: ${String(e).slice(0, 140)}`);
    return wallBatch(device, v, iters);
  }
}

export const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

export interface Result { name: string; taps: number; cells: number; trials: number[]; med: number; min: number; p10: number; p90: number; spread: number; gtaps: number }

export function summarise(v: Pick<Variant, "name" | "taps" | "cells">, trials: number[]): Result {
  const med = median(trials), p10 = pct(trials, 0.1), p90 = pct(trials, 0.9);
  return { name: v.name, taps: v.taps, cells: v.cells, trials, med, min: Math.min(...trials), p10, p90, spread: p90 / p10, gtaps: (v.taps * v.cells) / med };
}

/**
 * ABBA-interleaved trials; each trial = one batch of dispatches reduced to its median ns. Untimed warmup first.
 * Batches are capped to ~`maxBatchMs` of GPU time (a command buffer of seconds can hang the Metal queue), so slow
 * variants run fewer than `iters` dispatches per batch (printed).
 */
export async function runInterleaved(device: GPUDevice, vs: Variant[], trials: number, iters: number, method: Method, warm = 50, maxBatchMs = 120): Promise<Result[]> {
  const per = new Map<string, number>();
  for (const v of vs) {
    const w = median(await timeVariant(device, v, warm, method));
    const ms = w / 1e6;
    per.set(v.name, Math.max(5, Math.min(iters, Math.floor(maxBatchMs / Math.max(ms, 1e-3)))));
  }
  console.log("batch sizes:", vs.map((v) => `${v.name}=${per.get(v.name)}`).join(", "));
  const acc = new Map<string, number[]>(vs.map((v) => [v.name, []]));
  for (let t = 0; t < trials; t++) {
    const order = t % 2 === 0 ? vs : [...vs].reverse();
    for (const v of order) acc.get(v.name)!.push(median(await timeVariant(device, v, per.get(v.name)!, method)));
  }
  return vs.map((v) => summarise(v, acc.get(v.name)!));
}
const Deno_dbg = false;
