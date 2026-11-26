// WebGPU version of the BFF soup step (tools/soup/bff.ts). One invocation runs
// one pair: load, mutate with the same SplitMix64 keys, evaluate, store. The
// CPU still does the per-epoch shuffle (Soup.prepare), so the GPU soup equals
// the CPU soup byte for byte; tests/deno/soup_gpu.ts compares them. That holds
// only for work the GPU actually runs: it can silently drop work under
// contention, so the experiment CLI uses stepChecked/advance (which redo a short
// batch) and take the one-process lock in tools/soup/device.ts.
import { type Lang, Soup, type SoupParams, STEPS, TAPE } from "./bff.ts";

const WGSL = /* wgsl */ `
struct Params { num: u32, mutp: u32, eh: u32, el: u32, lang: u32, steps: u32, nactive: u32, pad1: u32 }
@group(0) @binding(0) var<storage, read_write> progs: array<u32>;
@group(0) @binding(1) var<storage, read> order: array<u32>;
@group(0) @binding(2) var<uniform> P: Params;
@group(0) @binding(3) var<storage, read_write> ops: array<atomic<u32>>;

var<private> oh: u32;
var<private> ol: u32;
var<private> tape: array<u32, 128>;

fn mul64(ah: u32, al: u32, bh: u32, bl: u32) {
  let a0 = al & 0xffffu; let a1 = al >> 16u; let b0 = bl & 0xffffu; let b1 = bl >> 16u;
  let p00 = a0 * b0; let p01 = a0 * b1; let p10 = a1 * b0; let p11 = a1 * b1;
  let mid = (p00 >> 16u) + (p01 & 0xffffu) + (p10 & 0xffffu);
  ol = (mid << 16u) | (p00 & 0xffffu);
  oh = p11 + (p01 >> 16u) + (p10 >> 16u) + (mid >> 16u) + al * bh + ah * bl;
}

fn splitmix(hi0: u32, lo0: u32) {
  let lo1 = lo0 + 0x7f4a7c15u;
  var hi = hi0 + 0x9e3779b9u + select(0u, 1u, lo1 < lo0);
  var lo = lo1;
  lo = lo ^ ((lo >> 30u) | (hi << 2u)); hi = hi ^ (hi >> 30u);
  mul64(hi, lo, 0xbf58476du, 0x1ce4e5b9u); hi = oh; lo = ol;
  lo = lo ^ ((lo >> 27u) | (hi << 5u)); hi = hi ^ (hi >> 27u);
  mul64(hi, lo, 0x94d049bbu, 0x133111ebu); hi = oh; lo = ol;
  ol = lo ^ ((lo >> 31u) | (hi << 1u)); oh = hi ^ (hi >> 31u);
}

// 1 [  2 ]  3 +  4 -  5 .  6 ,  7 <  8 >  9 {  10 }  0 other
fn opk(c: u32) -> u32 {
  switch c {
    case 91u: { return 1u; } case 93u: { return 2u; }
    case 43u: { return 3u; } case 45u: { return 4u; }
    case 46u: { return 5u; } case 44u: { return 6u; }
    case 60u: { return 7u; } case 62u: { return 8u; }
    case 123u: { return 9u; } case 125u: { return 10u; }
    default: { return 0u; }
  }
}

fn evaluate() -> u32 {
  var h0 = 0u; var h1 = 0u; var pc = 0i;
  if (P.lang == 1u) { h0 = tape[0] % 128u; h1 = tape[1] % 128u; pc = 2i; }
  var i = 0u; var skip = 0u;
  loop {
    if (i >= P.steps) { break; }
    h0 = h0 & 127u; h1 = h1 & 127u;
    switch opk(tape[pc]) {
      case 7u: { h0 = h0 - 1u; }
      case 8u: { h0 = h0 + 1u; }
      case 9u: { h1 = h1 - 1u; }
      case 10u: { h1 = h1 + 1u; }
      case 3u: { tape[h0] = (tape[h0] + 1u) & 255u; }
      case 4u: { tape[h0] = (tape[h0] + 255u) & 255u; }
      case 5u: { tape[h1] = tape[h0]; }
      case 6u: { tape[h0] = tape[h1]; }
      case 1u: {
        if (tape[h0] == 0u) {
          var d = 1i;
          pc = pc + 1i;
          loop {
            if (!(pc < 128i && d > 0i)) { break; }
            let k = opk(tape[pc]);
            if (k == 2u) { d = d - 1i; } else if (k == 1u) { d = d + 1i; }
            pc = pc + 1i;
          }
          pc = pc - 1i;
          if (d != 0i) { pc = 128i; }
        }
      }
      case 2u: {
        if (tape[h0] != 0u) {
          var d = 1i;
          pc = pc - 1i;
          loop {
            if (!(pc >= 0i && d > 0i)) { break; }
            let k = opk(tape[pc]);
            if (k == 2u) { d = d + 1i; } else if (k == 1u) { d = d - 1i; }
            pc = pc - 1i;
          }
          pc = pc + 1i;
          if (d != 0i) { pc = -1i; }
        }
      }
      default: { skip = skip + 1u; }
    }
    i = i + 1u;
    if (pc < 0i) { break; }
    pc = pc + 1i;
    if (pc >= 128i) { break; }
  }
  return i - skip;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let p = g.x;
  if (p >= P.num / 2u) { return; }
  let a = order[2u * p] * 16u;
  let b = order[2u * p + 1u] * 16u;
  for (var w = 0u; w < 16u; w++) {
    let x = progs[a + w]; let y = progs[b + w];
    for (var k = 0u; k < 4u; k++) {
      tape[4u * w + k] = (x >> (8u * k)) & 255u;
      tape[64u + 4u * w + k] = (y >> (8u * k)) & 255u;
    }
  }
  let l = P.el + p;
  let kh = P.eh + select(0u, 1u, l < P.el);
  let bh = (kh << 7u) | (l >> 25u);
  let bl = l << 7u;
  for (var i = 0u; i < 128u; i++) {
    splitmix(bh, bl | i);
    let prob = (ol >> 8u) | ((oh & 0x3fu) << 24u);
    if (prob < P.mutp) { tape[i] = ol & 255u; }
  }
  var n = 0u;
  if (p < P.nactive) { n = evaluate(); } // grid leftovers are mutated, not run
  let old = atomicAdd(&ops[0], n);
  if (old + n < old) { atomicAdd(&ops[1], 1u); } // 64-bit total across epochs
  for (var w = 0u; w < 16u; w++) {
    var x = 0u; var y = 0u;
    for (var k = 0u; k < 4u; k++) {
      x = x | (tape[4u * w + k] << (8u * k));
      y = y | (tape[64u + 4u * w + k] << (8u * k));
    }
    progs[a + w] = x; progs[b + w] = y;
  }
  atomicAdd(&ops[2], 1u); // pairs finished: a short count means the GPU dropped work (see stepChecked)
}
`;

// Error scopes belong to a device, so checked/read operations cannot overlap
// even when callers have separate soups on that device.
const busyDevices = new WeakSet<GPUDevice>();

export class GpuSoup {
  private busy = false;
  private unusable = false;
  private assertIdle(): void {
    if (this.unusable) throw new Error("GPU soup instance is unusable after destruction or GPU error");
    if (this.busy || busyDevices.has(this.device)) throw new Error("GPU soup operation in progress");
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    this.assertIdle(); this.busy = true; busyDevices.add(this.device);
    try { return await work(); } finally { this.busy = false; busyDevices.delete(this.device); }
  }
  readonly cpu: Soup; // holds seed, epoch and the shuffle; programs are synced on read()
  private readonly progs: GPUBuffer;
  private readonly orderBuf: GPUBuffer;
  private readonly params: GPUBuffer;
  private readonly opsBuf: GPUBuffer;
  private readonly pipeline: GPUComputePipeline;
  private readonly bind: GPUBindGroup;
  private readonly lang: Lang;

  constructor(readonly device: GPUDevice, p: SoupParams) {
    this.cpu = new Soup(p);
    this.lang = this.cpu.lang;
    const d = device;
    this.progs = d.createBuffer({ size: p.num * TAPE, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.orderBuf = d.createBuffer({ size: p.num * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.params = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.opsBuf = d.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.pipeline = d.createComputePipeline({ layout: "auto", compute: { module: d.createShaderModule({ code: WGSL }), entryPoint: "main" } });
    this.bind = d.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [this.progs, this.orderBuf, this.params, this.opsBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.upload();
  }

  /** Builds a GpuSoup and throws if the shader or pipeline failed validation (WebGPU otherwise fails silently). */
  static async create(device: GPUDevice, p: SoupParams): Promise<GpuSoup> {
    if (busyDevices.has(device)) throw new Error("GPU soup operation in progress");
    // Pop synchronously before yielding: creation errors cannot consume another
    // soup's scopes. Validate OOM/internal errors as well as shader validation.
    for (const filter of ["validation", "out-of-memory", "internal"] as GPUErrorFilter[]) device.pushErrorScope(filter);
    let g: GpuSoup | undefined, problem: unknown;
    try { g = new GpuSoup(device, p); } catch (error) { problem = error; }
    const scopes = [device.popErrorScope(), device.popErrorScope(), device.popErrorScope()];
    for (const result of await Promise.allSettled(scopes)) {
      if (result.status === "rejected") problem ??= result.reason;
      else if (result.value) problem ??= new Error(`soup shader: ${result.value.message}`);
    }
    if (problem !== undefined) { g?.destroy(); throw problem; }
    return g!;
  }

  get epoch(): number { return this.cpu.epoch; }

  /** Frees the GPU buffers; the soup cannot step afterwards. */
  destroy(): void {
    if (this.busy || busyDevices.has(this.device)) throw new Error("GPU soup operation in progress");
    this.unusable = true;
    for (const b of [this.progs, this.orderBuf, this.params, this.opsBuf]) b.destroy();
  }

  /** Sends the CPU soup's programs to the GPU (after construction, plant() or a load). */
  upload(): void { this.assertIdle(); this.uploadState(); }
  /** Validate and settle a starting/resumed checkpoint before attesting its bytes. */
  uploadChecked(): Promise<void> {
    return this.exclusive(() => this.gpuErrors(async () => {
      if (this.pendingEpochs) throw new Error("read pending unchecked work before upload");
      const before = this.cpu.programs.slice();
      this.uploadState();
      await this.device.queue.onSubmittedWorkDone();
      await this.verifyUpload(before);
    }));
  }
  private uploadState(): void {
    if (this.unusable) throw new Error("GPU soup instance is unusable");
    try { this.device.queue.writeBuffer(this.progs, 0, this.cpu.programs); }
    catch (error) { this.unusable = true; throw error; }
  }

  /** Queues `n` epochs. Returns once they are submitted, not finished. */
  step(n = 1): void { this.assertIdle(); this.submit(n); }
  private submit(n: number): void {
    if (this.unusable) throw new Error("GPU soup instance is unusable");
    try {
    const q = this.device.queue;
    for (let k = 0; k < n; k++) {
      const { order, eh, el, active } = this.cpu.prepare();
      q.writeBuffer(this.orderBuf, 0, order);
      q.writeBuffer(this.params, 0, new Uint32Array([this.cpu.num, this.cpu.mutation, eh, el, this.lang === "heads" ? 1 : 0, STEPS, active, 0]));
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bind);
      pass.dispatchWorkgroups(Math.ceil(this.cpu.num / 2 / 64));
      pass.end();
      q.submit([enc.finish()]);
      this.cpu.epoch++;
      this.pendingEpochs++;
      this.cpu.runs += active;
    }
    } catch (error) { this.unusable = true; throw error; }
  }

  /** Pairs finished in the epochs since the last read() (set by read()). */
  lastDone = 0;
  private pendingEpochs = 0;
  readonly integrity = { checkedEpochs: 0, acceptedBatches: 0, rejectedBatches: 0, completedPairs: 0 };
  onIncompleteBatch?: (event: { epoch: number; epochs: number; attempt: number; expectedPairs: number; completedPairs: number }) => void;
  /** Tests only: the next this many read()s report one pair short, as if the GPU had dropped work. */
  dropForTest = 0;

  /** Waits for queued work, copies programs into cpu.programs, and returns instructions executed since the last read. */
  read(): Promise<number> { return this.exclusive(() => this.readback()); }
  private async readback(): Promise<number> {
    let staging: GPUBuffer | undefined, opsStaging: GPUBuffer | undefined;
    try {
    const d = this.device;
    staging = d.createBuffer({ size: this.cpu.num * TAPE, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    opsStaging = d.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = d.createCommandEncoder();
    enc.copyBufferToBuffer(this.progs, 0, staging, 0, this.cpu.num * TAPE);
    enc.copyBufferToBuffer(this.opsBuf, 0, opsStaging, 0, 16);
    d.queue.submit([enc.finish()]);
    d.queue.writeBuffer(this.opsBuf, 0, new Uint32Array([0, 0, 0, 0]));
    await Promise.all([staging.mapAsync(GPUMapMode.READ), opsStaging.mapAsync(GPUMapMode.READ)]);
    this.cpu.programs.set(new Uint8Array(staging.getMappedRange()));
    const o = new Uint32Array(opsStaging.getMappedRange());
    const ops = o[0] + o[1] * 2 ** 32;
    this.lastDone = o[2];
    this.pendingEpochs = 0;
    if (this.dropForTest > 0) { this.dropForTest--; this.lastDone--; }
    return ops;
    } catch (error) { this.unusable = true; throw error; }
    finally { staging?.destroy(); opsStaging?.destroy(); }
  }

  /** Verify uploads independently of the pair-completion counter. */
  private async verifyUpload(before: Uint8Array): Promise<void> {
    const drops = this.dropForTest; this.dropForTest = 0;
    try {
      const ops = await this.readback();
      if (ops !== 0 || this.lastDone !== 0 || this.cpu.programs.some((v, i) => v !== before[i])) {
        throw new Error("GPU soup: checkpoint upload readback mismatch");
      }
    } finally { this.dropForTest = drops; this.cpu.programs.set(before); }
  }

  /**
   * Runs `n` epochs and reads back, checking that every pair of every epoch
   * finished. The GPU can silently drop work (other GPU processes, or the
   * desktop, competing for it; found 2026-11-01), which leaves the count short;
   * then the batch is undone from cpu.programs (the state before it) and run
   * again, up to `tries` times. Returns instructions executed and retries used.
   */
  stepChecked(n: number, tries = 20): Promise<{ ops: number; retries: number }> {
    return this.exclusive(() => this.checked(n, tries));
  }
  // Error scopes cover WebGPU validation/OOM/internal failures that do not
  // throw JS exceptions. This CLI owns its GPUDevice during checked execution.
  private async gpuErrors<T>(work: () => Promise<T>): Promise<T> {
    for (const filter of ["validation", "out-of-memory", "internal"] as GPUErrorFilter[]) this.device.pushErrorScope(filter);
    let value: T | undefined, problem: unknown;
    try { value = await work(); } catch (error) { problem = error; }
    for (let i = 0; i < 3; i++) {
      try {
        const error = await this.device.popErrorScope();
        if (error) problem ??= new Error(`GPU soup: ${error.message}`);
      } catch (error) { problem ??= error; }
    }
    if (problem !== undefined) { this.unusable = true; throw problem; }
    return value as T;
  }
  private async checked(n: number, tries: number): Promise<{ ops: number; retries: number }> {
    if (!Number.isSafeInteger(n) || n < 0 || n * (this.cpu.num / 2) > 0xffffffff) throw new Error("checked epoch count must fit the u32 completion counter");
    if (!Number.isSafeInteger(tries) || tries < 1) throw new Error("tries must be a positive integer");
    if (this.pendingEpochs) throw new Error("read pending unchecked work before checked stepping");
    if (n === 0) return { ops: 0, retries: 0 };
    const before = this.cpu.programs.slice(), epoch = this.cpu.epoch, runs = this.cpu.runs;
    for (let t = 0; t < tries; t++) {
      let ops: number;
      try { ops = await this.gpuErrors(async () => { this.submit(n); return await this.readback(); }); }
      catch (error) {
        this.cpu.programs.set(before); this.cpu.epoch = epoch; this.cpu.runs = runs;
        this.unusable = true; // GPU state is unknown; never resume this instance
        throw error;
      }
      if (this.lastDone === n * (this.cpu.num / 2)) {
        this.integrity.checkedEpochs += n; this.integrity.acceptedBatches++;
        this.integrity.completedPairs += this.lastDone;
        return { ops, retries: t };
      }
      this.integrity.rejectedBatches++;
      const event = { epoch, epochs: n, attempt: t + 1, expectedPairs: n * (this.cpu.num / 2), completedPairs: this.lastDone };
      this.cpu.programs.set(before); this.cpu.epoch = epoch; this.cpu.runs = runs;
      try {
        this.onIncompleteBatch?.(event);
        await this.gpuErrors(async () => {
          this.uploadState();
          await this.device.queue.onSubmittedWorkDone();
          await this.verifyUpload(before);
        });
      } catch (error) { this.unusable = true; throw error; }
    }
    throw new Error(`GPU soup: ${n} epochs from ${epoch} dropped work ${tries} times`);
  }

  /** stepChecked over `n` epochs in batches of at most `batch`; returns instructions executed and retries used. */
  advance(n: number, batch = 64): Promise<{ ops: number; retries: number }> {
    return this.exclusive(async () => {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("epochs must be a non-negative integer");
    if (!Number.isSafeInteger(batch) || batch < 1 || batch * (this.cpu.num / 2) > 0xffffffff) throw new Error("batch must be positive and fit the completion counter");
    let ops = 0, retries = 0;
    for (let left = n; left > 0; left -= batch) {
      const r = await this.checked(Math.min(batch, left), 20);
      ops += r.ops; retries += r.retries;
    }
    return { ops, retries };
    });
  }
}
