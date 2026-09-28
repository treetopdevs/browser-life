/** Passive GPU copy-path audit. This shader reads physical state; it writes only assay buffers. */
import { CH, G, MAX_STEP, canonicalConfig, cellCount, stateHash, validateState, worldH, worldW,
  type WorldState } from "@bl/schema";
import { GpuSim } from "@bl/sim-gpu";
import { prelude, WG } from "../../packages/sim-gpu/src/shaders.ts";

export const RESET_DIAGNOSTIC_WORDS = 10;
export const RESET_GPU_MAX_BATCH = 256;
export interface ResetGpuSnapshot {
  step: number; referenceStep: number;
  /** Per-site 1-based source index at the last tag reset, or zero if unavailable. */
  tags: Uint32Array;
  /** Ten channel-major audit words per site, indexed with `diagnosticWord`. */
  diagnostics: Uint32Array;
}
export const diagnosticWord = (row: Uint32Array, n: number, channel: number, site: number) =>
  row[channel * n + site];

function shader(cfg: WorldState["cfg"]): string {
  return /* wgsl */ `${prelude(cfg)}
@group(0) @binding(0) var<storage, read> beforeCells: array<u32>;
@group(0) @binding(1) var<storage, read> beforeGenome: array<u32>;
@group(0) @binding(2) var<storage, read> actualDisp: array<u32>;
@group(0) @binding(3) var<storage, read> afterCells: array<u32>;
@group(0) @binding(4) var<storage, read> afterGenome: array<u32>;
@group(0) @binding(5) var<storage, read> tagBefore: array<u32>;
@group(0) @binding(6) var<storage, read_write> tagAfter: array<u32>;
@group(0) @binding(7) var<storage, read_write> auditOut: array<u32>;
struct AuditParams { step: u32, };
@group(0) @binding(8) var<uniform> params: AuditParams;

fn w1d(d: i32, o: i32) -> u32 {
  let lo = max(d - HW, 64 * o - 32);
  let hi = min(d + HW, 64 * o + 32);
  return u32(max(hi - lo, 0));
}

fn share(q: u32, w: u32) -> u32 {
  return (q / D2) * w + ((q % D2) * w) / D2;
}
@compute @workgroup_size(${WG}, ${WG})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= WORLD_W || gid.y >= WORLD_H) { return; }
  let x = gid.x;
  let y = gid.y;
  let i = y * WORLD_W + x;
  var inB = 0u;
  var inP = 0u;
  var inE = 0u;
  var srcs: array<u32, 9>;
  var lot: array<u32, 9>;
  var k = 0u;
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let s = nb(x, y, ox, oy);
      srcs[k] = s;
      let d = actualDisp[s];
      let dx = i32(d & 0xffu) - 64;
      let dy = i32((d >> 8u) & 0xffu) - 64;
      let qB = beforeCells[CH_B + s];
      let qP = beforeCells[CH_P + s];
      let qE = beforeCells[CH_E + s];
      var sB: u32;
      var sP: u32;
      var sE: u32;
      if (ox == 0 && oy == 0) {
        sB = qB; sP = qP; sE = qE;
        for (var ty = -1; ty <= 1; ty++) {
          for (var tx = -1; tx <= 1; tx++) {
            if (tx == 0 && ty == 0) { continue; }
            let w = w1d(dx, tx) * w1d(dy, ty);
            if (w == 0u) { continue; }
            sB -= share(qB, w);
            sP -= share(qP, w);
            sE -= share(qE, w);
          }
        }
      } else {
        let w = w1d(dx, -ox) * w1d(dy, -oy);
        sB = share(qB, w);
        sP = share(qP, w);
        sE = share(qE, w);
      }
      inB += sB;
      inP += sP;
      inE += sE;
      lot[k] = sB + sP;
      k++;
    }
  }
  let total = inB + inP;
  var winner = 0xffffffffu;
  if (total > 0u) {
    let r = draw(cell_base(params.step, i), RND_LOTTERY) % total;
    var cumulative = 0u;
    for (var j = 0u; j < 9u; j++) {
      cumulative += lot[j];
      if (cumulative > r) { winner = srcs[j]; break; }
    }
  }
  var carried = 0u;
  var parentHi = 0u;
  var parentLo = 0u;
  var changed = 0u;
  if (winner != 0xffffffffu) {
    parentHi = beforeGenome[G_LIN_HI + winner];
    parentLo = beforeGenome[G_LIN_LO + winner];
    if (afterCells[CH_B + i] + afterCells[CH_P + i] > 0u && (parentHi | parentLo) != 0u) {
      carried = tagBefore[winner];
      if (afterGenome[G_LIN_HI + i] != parentHi || afterGenome[G_LIN_LO + i] != parentLo) {
        for (var g = 2u; g < GENOME_CH; g++) {
          if (afterGenome[g * N + i] != beforeGenome[g * N + winner]) { changed = 1u; break; }
        }
      }
    }
  }
  tagAfter[i] = carried;
  auditOut[0u * N + i] = winner;
  auditOut[1u * N + i] = inB;
  auditOut[2u * N + i] = inP;
  auditOut[3u * N + i] = inE;
  auditOut[4u * N + i] = carried;
  auditOut[5u * N + i] = changed;
  auditOut[6u * N + i] = parentHi;
  auditOut[7u * N + i] = parentLo;
  auditOut[8u * N + i] = afterGenome[G_LIN_HI + i];
  auditOut[9u * N + i] = afterGenome[G_LIN_LO + i];
}`;
}

function rebaseShader(n: number): string {
  return /* wgsl */ `
const N = ${n}u;
const CH_B = ${CH.B * n}u;
const CH_P = ${CH.P * n}u;
const LIN_HI = ${G.LIN_HI * n}u;
const LIN_LO = ${G.LIN_LO * n}u;
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> genome: array<u32>;
@group(0) @binding(2) var<storage, read_write> tags: array<u32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= N) { return; }
  let bound = cells[CH_B + i] + cells[CH_P + i];
  tags[i] = select(0u, i + 1u, bound > 0u &&
    (genome[LIN_HI + i] | genome[LIN_LO + i]) != 0u);
}`;
}

export class ResetGpuCopyAudit {
  private readonly sim: GpuSim;
  private readonly beforeCells: GPUBuffer;
  private readonly tags: [GPUBuffer, GPUBuffer];
  private readonly diagnostic: GPUBuffer;
  private readonly params: GPUBuffer;
  private readonly pipe: GPUComputePipeline;
  private readonly rebasePipe: GPUComputePipeline;
  private current = 0;
  private step: number;
  private referenceStep: number;
  private batchIndex = 0;

  private constructor(sim: GpuSim, pipe: GPUComputePipeline, beforeCells: GPUBuffer,
    tags: [GPUBuffer, GPUBuffer], diagnostic: GPUBuffer, params: GPUBuffer,
    rebasePipe: GPUComputePipeline, step: number) {
    this.sim = sim; this.pipe = pipe; this.rebasePipe = rebasePipe;
    this.beforeCells = beforeCells;
    this.tags = tags; this.diagnostic = diagnostic; this.params = params;
    this.step = step; this.referenceStep = step;
  }

  static async create(sim: GpuSim, initial: WorldState): Promise<ResetGpuCopyAudit> {
    const errors = validateState(initial);
    if (errors.length || sim.step !== initial.step || cellCount(initial.cfg) !== sim.n ||
        canonicalConfig(sim.cfg) !== canonicalConfig(initial.cfg))
      throw new Error("GPU copy audit initial state differs from simulator");
    if (stateHash(await sim.readState()) !== stateHash(initial))
      throw new Error("GPU copy audit initial physics differs from supplied state");
    const device = sim.device, n = sim.n;
    const module = device.createShaderModule({ code: shader(initial.cfg), label: "reset-passive-copy-audit" });
    const info = await module.getCompilationInfo?.();
    const shaderErrors = info?.messages.filter(m => m.type === "error") ?? [];
    if (shaderErrors.length) throw new Error(`reset passive shader: ${shaderErrors.map(m => m.message).join("; ")}`);
    const pipe = await device.createComputePipelineAsync({ layout: "auto",
      compute: { module, entryPoint: "main" }, label: "reset-passive-copy-audit" });
    const rebaseModule = device.createShaderModule({ code: rebaseShader(n),
      label: "reset-passive-copy-rebase" });
    const rebaseInfo = await rebaseModule.getCompilationInfo?.();
    const rebaseErrors = rebaseInfo?.messages.filter(m => m.type === "error") ?? [];
    if (rebaseErrors.length) throw new Error(`reset rebase shader: ${rebaseErrors.map(m => m.message).join("; ")}`);
    const rebasePipe = await device.createComputePipelineAsync({ layout: "auto",
      compute: { module: rebaseModule, entryPoint: "main" }, label: "reset-passive-copy-rebase" });
    const mk = (size: number, label: string) => device.createBuffer({ size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, label });
    const beforeCells = mk(n * 7 * 4, "reset-before-cells");
    const tags: [GPUBuffer, GPUBuffer] = [mk(n * 4, "reset-tags-0"), mk(n * 4, "reset-tags-1")];
    const diagnostic = mk(n * RESET_DIAGNOSTIC_WORDS * 4, "reset-diagnostics");
    const params = device.createBuffer({ size: RESET_GPU_MAX_BATCH * 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: "reset-audit-step-params" });
    const seed = new Uint32Array(n);
    for (let i = 0; i < n; i++) if (initial.cells[CH.B * n + i] + initial.cells[CH.P * n + i] > 0 &&
        (initial.genome[G.LIN_HI * n + i] | initial.genome[G.LIN_LO * n + i]) !== 0) seed[i] = i + 1;
    device.queue.writeBuffer(tags[0], 0, seed);
    return new ResetGpuCopyAudit(sim, pipe, beforeCells, tags, diagnostic, params,
      rebasePipe, initial.step);
  }

  /** Reset to actual current GPU sites after caller has saved the prior tag snapshot. */
  rebaseFromCurrentGpu(expectedStep: number): void {
    if (!Number.isSafeInteger(expectedStep) || expectedStep !== this.step ||
        this.sim.step !== expectedStep)
      throw new Error("GPU copy-tag rebase step differs from current physics");
    const device = this.sim.device, enc = device.createCommandEncoder();
    const buffers = [this.sim.cells[0], this.sim.currentGenome, this.tags[this.current]];
    const group = device.createBindGroup({ layout: this.rebasePipe.getBindGroupLayout(0),
      entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const pass = enc.beginComputePass({ label: "reset-passive-copy-rebase" });
    pass.setPipeline(this.rebasePipe); pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(this.sim.n / 256)); pass.end();
    device.queue.submit([enc.finish()]);
    this.referenceStep = expectedStep;
  }

  /** Rebase source-site tags at an authenticated physical census; this does not touch the sim. */
  async resetToPhysicalCensus(censusState: WorldState): Promise<void> {
    const expectedStep = censusState.step;
    const errors = validateState(censusState);
    if (errors.length || expectedStep !== this.step || this.sim.step !== expectedStep ||
        canonicalConfig(censusState.cfg) !== canonicalConfig(this.sim.cfg))
      throw new Error("copy-tag census reset has invalid physical identity");
    const expectedHash = stateHash(censusState);
    if (stateHash(await this.sim.readState()) !== expectedHash ||
        stateHash(censusState) !== expectedHash ||
        this.sim.step !== expectedStep || this.step !== expectedStep)
      throw new Error("copy-tag census reset differs from current GPU physics");
    const seed = new Uint32Array(this.sim.n);
    for (let i = 0; i < this.sim.n; i++)
      if (censusState.cells[CH.B * this.sim.n + i] +
          censusState.cells[CH.P * this.sim.n + i] > 0 &&
          (censusState.genome[G.LIN_HI * this.sim.n + i] |
            censusState.genome[G.LIN_LO * this.sim.n + i]) !== 0)
        seed[i] = i + 1;
    this.sim.device.queue.writeBuffer(this.tags[this.current], 0, seed);
    this.referenceStep = expectedStep;
  }

  /** Encode one unchanged physical step followed by one read-only audit dispatch. */
  private encodeStep(encoder: GPUCommandEncoder): void {
    if (this.sim.step !== this.step) throw new Error("passive copy audit step desynchronized");
    if (this.batchIndex >= RESET_GPU_MAX_BATCH) throw new Error("passive copy audit batch is full");
    const paramOffset = this.batchIndex++ * 256;
    this.sim.device.queue.writeBuffer(this.params, paramOffset, new Uint32Array([this.step]));
    const oldGenome = this.sim.currentGenome;
    encoder.copyBufferToBuffer(this.sim.cells[0], 0, this.beforeCells, 0, this.sim.n * 7 * 4);
    this.sim.encodeStep(encoder);
    const buffers = [this.beforeCells, oldGenome, this.sim.displacement, this.sim.cells[0],
      this.sim.currentGenome, this.tags[this.current], this.tags[1 - this.current],
      this.diagnostic];
    const group = this.sim.device.createBindGroup({ layout: this.pipe.getBindGroupLayout(0),
      entries: [...buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
        { binding: 8, resource: { buffer: this.params, offset: paramOffset, size: 256 } }] });
    const pass = encoder.beginComputePass({ label: "reset-passive-copy-audit" });
    pass.setPipeline(this.pipe); pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(worldW(this.sim.cfg) / WG), Math.ceil(worldH(this.sim.cfg) / WG));
    pass.end();
    this.current = 1 - this.current;
    this.step++;
  }

  run(count: number): void {
    if (!Number.isSafeInteger(count) || count < 1 || count > RESET_GPU_MAX_BATCH)
      throw new Error("invalid passive step count");
    if (this.step + count > MAX_STEP) throw new Error(`step limit ${MAX_STEP} reached`);
    this.batchIndex = 0;
    const enc = this.sim.device.createCommandEncoder();
    for (let i = 0; i < count; i++) this.encodeStep(enc);
    this.sim.device.queue.submit([enc.finish()]);
  }

  async readSnapshot(): Promise<ResetGpuSnapshot> {
    const device = this.sim.device, n = this.sim.n;
    // Both copies are enqueued before awaiting; retain the state they describe if run() advances.
    const sampledStep = this.step;
    const referenceStep = this.referenceStep;
    const read = async (source: GPUBuffer, size: number): Promise<Uint32Array> => {
      const stage = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(source, 0, stage, 0, size);
      device.queue.submit([enc.finish()]);
      await stage.mapAsync(GPUMapMode.READ);
      const words = new Uint32Array(stage.getMappedRange().slice(0));
      stage.unmap(); stage.destroy(); return words;
    };
    const [tags, diagnostics] = await Promise.all([
      read(this.tags[this.current], n * 4), read(this.diagnostic, n * RESET_DIAGNOSTIC_WORDS * 4),
    ]);
    return { step: sampledStep, referenceStep, tags, diagnostics };
  }

  destroy(): void {
    this.beforeCells.destroy(); this.tags[0].destroy(); this.tags[1].destroy();
    this.diagnostic.destroy(); this.params.destroy();
  }
}
