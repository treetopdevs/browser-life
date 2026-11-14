// GpuSim3: the WebGPU runner of the slab rules (rung 1b). The API mirrors GpuSim (gpu-sim.ts); the schedule and the
// bindings are docs/3d-rung1b-step-spec.md section 10. lesion, feed and setLight are not defined for a slab in v1.
import {
  CELL_CHANNELS,
  EVENT_WORDS,
  FLAG_EVENTS_SATURATED,
  FLAG_LEDGER_OVERFLOW,
  FLUX_COUNT,
  GENOME_CHANNELS3,
  LEDGER,
  LEDGER_WORDS,
  MAX_STEP,
  ROLE_WORDS,
  cellCount,
  genomeChannels,
  isSlab,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import type { CellProbe, LedgerSnapshot, MutationEvent, StatsSnapshot } from "../../../packages/sim-gpu/src/gpu-sim.ts";
import { tickShader } from "../../../packages/sim-gpu/src/shaders.ts";
import { STATS3, STATS3_WORDS, WG3, WGL3, affinityShader3, flowShader3, lightShader3, reactShader3, statsShader3, transportShader3 } from "./shaders3d-rps.ts";

const STORAGE = 0x80; // GPUBufferUsage.STORAGE
const COPY_SRC = 0x04;
const COPY_DST = 0x08;
const MAP_READ = 0x01;

/** Slab-aware `requestDevice`: sizes the per-buffer need from the 49-word slab genome. */
export async function requestDevice3(gpu: GPU, cfg?: WorldConfig): Promise<GPUDevice> {
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU: no adapter");
  const need = cfg ? cellCount(cfg) * genomeChannels(cfg) * 4 : 0;
  const limits: Record<string, number> = {};
  const aStorage = adapter.limits.maxStorageBufferBindingSize;
  const aBuffer = adapter.limits.maxBufferSize;
  if (need > aStorage || need > aBuffer) throw new Error(`world needs ${need} bytes per buffer; adapter allows ${Math.min(aStorage, aBuffer)}`);
  limits.maxStorageBufferBindingSize = aStorage;
  limits.maxBufferSize = aBuffer;
  limits.maxStorageBuffersPerShaderStage = Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 10);
  const requiredFeatures: GPUFeatureName[] = adapter.features.has("timestamp-query") ? ["timestamp-query"] : [];
  return adapter.requestDevice({ requiredLimits: limits, requiredFeatures });
}

/** Throws if the ledger overflowed or crossed the accepted ceiling (LEDGER_MAX = 2^63). */
function checkLedger(L: Uint32Array): void {
  if (L[LEDGER.FLAGS] & FLAG_LEDGER_OVERFLOW) throw new Error("ledger overflow: a 64-bit total wrapped; the run is invalid");
  if (L[LEDGER.FLAGS] & FLAG_EVENTS_SATURATED) throw new Error("mutation event counter saturated; drain events more often");
  const his = [LEDGER.LIGHT_HI, LEDGER.HEAT_HI, ...Array.from({ length: FLUX_COUNT }, (_, k) => LEDGER.FLUX + 2 * k + 1)];
  for (const h of his) if (L[h] >= 0x80000000) throw new Error("ledger total reached 2^63; the run cannot continue exactly");
}

function fluxOf(L: Uint32Array): bigint[] {
  const out: bigint[] = [];
  for (let k = 0; k < FLUX_COUNT; k++) out.push(BigInt(L[LEDGER.FLUX + 2 * k]) | (BigInt(L[LEDGER.FLUX + 2 * k + 1]) << 32n));
  return out;
}

/** Keys whose values differ between two configs (absent and undefined count as the same). */
export function configDiff(a: WorldConfig, b: WorldConfig): string[] {
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).sort();
}

type PipeName = "affinity" | "flow" | "transport" | "light" | "react" | "tick" | "stats";

export class GpuSim3 {
  readonly device: GPUDevice;
  readonly cfg: WorldConfig;
  readonly n: number;
  step = 0;
  /** Index (0/1) of the genome buffer holding the current state. */
  private gcur = 0;
  readonly cells: GPUBuffer[];
  readonly genome: GPUBuffer[];
  readonly U: GPUBuffer;
  private readonly disp: GPUBuffer;
  /** Per-cell light of the step (derived each step, never part of the state). */
  readonly light: GPUBuffer;
  readonly ledger: GPUBuffer;
  private readonly events: GPUBuffer;
  /** Diagnostic per-cell role buffer written by the react pass. */
  readonly roles: GPUBuffer;
  private readonly pipes: Record<PipeName, GPUComputePipeline>;
  private readonly groups: Record<Exclude<PipeName, "tick" | "light">, GPUBindGroup[]> & { tick: GPUBindGroup; light: GPUBindGroup };
  private readonly statsBuf: GPUBuffer;
  private readonly wgX: number;
  private readonly wgY: number;
  private readonly wgZ: number;
  private readonly lgX: number;
  private readonly lgY: number;
  private destroyed = false;

  private constructor(device: GPUDevice, cfg: WorldConfig, pipes: Record<PipeName, GPUComputePipeline>) {
    this.device = device;
    this.cfg = cfg;
    this.n = cellCount(cfg);
    this.pipes = pipes;
    // Every buffer is tracked so a constructor that fails part-way releases what it allocated.
    const allocated: GPUBuffer[] = [];
    const mk = (size: number, label = "") => {
      const b = device.createBuffer({ size: Math.max(16, size), usage: STORAGE | COPY_SRC | COPY_DST, label });
      allocated.push(b);
      return b;
    };
    try {
      this.cells = [mk(this.n * CELL_CHANNELS * 4, "cells0"), mk(this.n * CELL_CHANNELS * 4, "cells1")];
      this.genome = [mk(this.n * GENOME_CHANNELS3 * 4, "genome0"), mk(this.n * GENOME_CHANNELS3 * 4, "genome1")];
      this.U = mk(this.n * 4, "U");
      this.disp = mk(this.n * 4, "disp");
      this.light = mk(this.n * 4, "light");
      this.ledger = mk(LEDGER_WORDS * 4, "ledger");
      this.events = mk(cfg.eventCap * EVENT_WORDS * 4, "events");
      this.roles = mk(this.n * ROLE_WORDS * 4, "roles");
      this.statsBuf = mk(STATS3_WORDS * 4, "stats");
      this.wgX = Math.ceil(cfg.tileW / WG3[0]);
      this.wgY = Math.ceil(cfg.tileH / WG3[1]);
      this.wgZ = Math.ceil(cfg.tileD! / WG3[2]);
      this.lgX = Math.ceil(cfg.tileW / WGL3[0]);
      this.lgY = Math.ceil(cfg.tileH / WGL3[1]);

      const bg = (p: GPUComputePipeline, bufs: GPUBuffer[]) =>
        device.createBindGroup({
          layout: p.getBindGroupLayout(0),
          entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })),
        });
      const [c0, c1] = this.cells;
      const g = this.genome;
      this.groups = {
        affinity: [0, 1].map((p) => bg(pipes.affinity, [c0, g[p], this.U])),
        flow: [0, 1].map((p) => bg(pipes.flow, [c0, g[p], this.U, this.disp])),
        transport: [0, 1].map((p) => bg(pipes.transport, [c0, g[p], this.disp, c1, g[1 - p], this.ledger])),
        light: bg(pipes.light, [c1, this.light, this.ledger]),
        react: [0, 1].map((p) => bg(pipes.react, [c1, g[1 - p], this.U, c0, this.ledger, this.events, this.roles, this.light])),
        tick: bg(pipes.tick, [this.ledger]),
        stats: [0, 1].map((p) => bg(pipes.stats, [c0, g[p], this.statsBuf])),
      };
    } catch (e) {
      for (const b of allocated) b.destroy();
      throw e;
    }
  }

  static async create(device: GPUDevice, state: WorldState): Promise<GpuSim3> {
    if (!isSlab(state.cfg)) throw new Error("GpuSim3 runs the slab rules: a 2D config (no tileD) needs GpuSim");
    const cfg = state.cfg;
    const pipe = async (code: string, label: string) => {
      const module = device.createShaderModule({ code, label });
      const info = await module.getCompilationInfo?.();
      const cerrs = info?.messages.filter((m) => m.type === "error") ?? [];
      if (cerrs.length) throw new Error(`${label}: ${cerrs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join("\n")}`);
      return device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" }, label });
    };
    device.pushErrorScope("validation");
    let sim: GpuSim3 | null = null;
    let scopeErr: GPUError | null = null;
    try {
      const [affinity, flow, transport, light, react, tick, stats] = await Promise.all([
        pipe(affinityShader3(cfg), "affinity3"),
        pipe(flowShader3(cfg), "flow3"),
        pipe(transportShader3(cfg), "transport3"),
        pipe(lightShader3(cfg), "light3"),
        pipe(reactShader3(cfg), "react3"),
        pipe(tickShader(), "tick"),
        pipe(statsShader3(cfg), "stats3"),
      ]);
      sim = new GpuSim3(device, cfg, { affinity, flow, transport, light, react, tick, stats });
      sim.upload(state);
    } catch (e) {
      sim?.destroy();
      throw e;
    } finally {
      // The scope is popped whatever happened above, so a rejected shader never leaves one open on the device.
      scopeErr = await device.popErrorScope();
    }
    if (scopeErr) {
      sim.destroy();
      throw new Error(`WebGPU validation: ${scopeErr.message}`);
    }
    return sim;
  }

  upload(state: WorldState): void {
    if (!isSlab(state.cfg)) throw new Error("GpuSim3 runs the slab rules: a 2D config (no tileD) needs GpuSim");
    // The pipelines bake the config's constants (seed, lightK, kernel taps, ...) into the shaders, and readState()
    // reports this.cfg: a world with any other config would run under the wrong rules. Build a new GpuSim3 for it.
    const diff = configDiff(this.cfg, state.cfg);
    if (diff.length) throw new Error(`upload: config differs from the one this GpuSim3 was built with (${diff.join(", ")}); create a new GpuSim3 for it`);
    const q = this.device.queue;
    q.writeBuffer(this.cells[0], 0, state.cells as BufferSource);
    // Both genome buffers: transport skips copies when the destination already
    // holds the winner's lineage, so stale ids from another world must not survive.
    q.writeBuffer(this.genome[0], 0, state.genome as BufferSource);
    q.writeBuffer(this.genome[1], 0, state.genome as BufferSource);
    this.gcur = 0;
    this.step = state.step;
    const L = new Uint32Array(LEDGER_WORDS);
    L[LEDGER.LIGHT_LO] = Number(state.lightIn & 0xffffffffn);
    L[LEDGER.LIGHT_HI] = Number(state.lightIn >> 32n);
    L[LEDGER.HEAT_LO] = Number(state.heatOut & 0xffffffffn);
    L[LEDGER.HEAT_HI] = Number(state.heatOut >> 32n);
    L[LEDGER.STEP] = state.step;
    state.flux.forEach((f, k) => {
      L[LEDGER.FLUX + 2 * k] = Number(f & 0xffffffffn);
      L[LEDGER.FLUX + 2 * k + 1] = Number(f >> 32n);
    });
    q.writeBuffer(this.ledger, 0, L as BufferSource);
  }

  /** Encode `count` steps into one submission. */
  run(count: number): void {
    if (this.destroyed) throw new Error("GpuSim3 destroyed");
    if (this.step + count > MAX_STEP) throw new Error(`step limit ${MAX_STEP} reached`);
    const enc = this.device.createCommandEncoder();
    for (let s = 0; s < count; s++) this.encodeStep(enc);
    this.device.queue.submit([enc.finish()]);
  }

  /**
   * Profiling hook: when set, each pass of each step is encoded as its own compute pass with begin/end
   * timestamps written at 2*k, 2*k+1. Six passes per step: affinity, flow, transport, light, react, tick.
   */
  profile: { set: GPUQuerySet; next: number } | null = null;

  encodeStep(enc: GPUCommandEncoder): void {
    const p = this.gcur;
    const cell: [number, number, number] = [this.wgX, this.wgY, this.wgZ];
    const col: [number, number, number] = [this.lgX, this.lgY, 1];
    if (this.profile) {
      const prof = this.profile;
      const one = (pipe: GPUComputePipeline, group: GPUBindGroup, dim: [number, number, number]) => {
        const k = prof.next++;
        const ps = enc.beginComputePass({ timestampWrites: { querySet: prof.set, beginningOfPassWriteIndex: 2 * k, endOfPassWriteIndex: 2 * k + 1 } });
        ps.setPipeline(pipe);
        ps.setBindGroup(0, group);
        ps.dispatchWorkgroups(dim[0], dim[1], dim[2]);
        ps.end();
      };
      one(this.pipes.affinity, this.groups.affinity[p], cell);
      one(this.pipes.flow, this.groups.flow[p], cell);
      one(this.pipes.transport, this.groups.transport[p], cell);
      one(this.pipes.light, this.groups.light, col);
      one(this.pipes.react, this.groups.react[p], cell);
      one(this.pipes.tick, this.groups.tick, [1, 1, 1]);
      this.gcur = 1 - p;
      this.step += 1;
      return;
    }
    const pass = enc.beginComputePass();
    const dispatch = (pipe: GPUComputePipeline, group: GPUBindGroup, dim: [number, number, number]) => {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(dim[0], dim[1], dim[2]);
    };
    dispatch(this.pipes.affinity, this.groups.affinity[p], cell);
    dispatch(this.pipes.flow, this.groups.flow[p], cell);
    dispatch(this.pipes.transport, this.groups.transport[p], cell);
    dispatch(this.pipes.light, this.groups.light, col);
    dispatch(this.pipes.react, this.groups.react[p], cell);
    dispatch(this.pipes.tick, this.groups.tick, [1, 1, 1]);
    pass.end();
    this.gcur = 1 - p;
    this.step += 1;
  }

  /**
   * Consistent snapshot for censuses: cells, the genome head (lineage and parameter channels, words 0..3),
   * optionally the role buffer, and the ledger, all copied in one submission so they describe the same step.
   */
  async readSnapshot(withRoles = false): Promise<{ step: number; cells: Uint32Array; genomeHead: Uint32Array; roles?: Uint32Array; flux: bigint[] }> {
    const enc = this.device.createCommandEncoder();
    const mk = (size: number) => this.device.createBuffer({ size, usage: MAP_READ | COPY_DST });
    const cells = mk(this.n * CELL_CHANNELS * 4);
    const head = mk(this.n * 4 * 4);
    const ledger = mk(LEDGER_WORDS * 4);
    const roles = withRoles ? mk(this.n * ROLE_WORDS * 4) : null;
    enc.copyBufferToBuffer(this.cells[0], 0, cells, 0, this.n * CELL_CHANNELS * 4);
    enc.copyBufferToBuffer(this.genome[this.gcur], 0, head, 0, this.n * 4 * 4);
    enc.copyBufferToBuffer(this.ledger, 0, ledger, 0, LEDGER_WORDS * 4);
    if (roles) enc.copyBufferToBuffer(this.roles, 0, roles, 0, this.n * ROLE_WORDS * 4);
    this.device.queue.submit([enc.finish()]);
    const read = async (b: GPUBuffer) => {
      await b.mapAsync(MAP_READ);
      const out = new Uint32Array(b.getMappedRange().slice(0));
      b.unmap();
      b.destroy();
      return out;
    };
    const [c, g, L, r] = await Promise.all([read(cells), read(head), read(ledger), roles ? read(roles) : Promise.resolve(undefined)]);
    checkLedger(L);
    return { step: L[LEDGER.STEP], cells: c, genomeHead: g, roles: r, flux: fluxOf(L) };
  }

  async readStats(): Promise<StatsSnapshot> {
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.statsBuf);
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipes.stats);
    pass.setBindGroup(0, this.groups.stats[this.gcur]);
    pass.dispatchWorkgroups(this.wgX, this.wgY, this.wgZ);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    const [st, L] = await this.readBuffers([
      { buf: this.statsBuf, size: STATS3_WORDS * 4 },
      { buf: this.ledger, size: LEDGER_WORDS * 4 },
    ]);
    checkLedger(L);
    const u64 = (k: number) => BigInt(st[STATS3.SUMS + 2 * k]) | (BigInt(st[STATS3.SUMS + 2 * k + 1]) << 32n);
    return {
      step: L[LEDGER.STEP],
      A: u64(0),
      B: u64(1),
      C: u64(2),
      P: u64(3),
      E: u64(4),
      S: u64(5),
      living: st[STATS3.LIVING],
      dense: st[STATS3.DENSE],
      lightIn: BigInt(L[LEDGER.LIGHT_LO]) | (BigInt(L[LEDGER.LIGHT_HI]) << 32n),
      heatOut: BigInt(L[LEDGER.HEAT_LO]) | (BigInt(L[LEDGER.HEAT_HI]) << 32n),
      flux: fluxOf(L),
    };
  }

  /** All channels of one cell (7 cell words, GENOME_CHANNELS3 genome words). */
  async probe(index: number): Promise<CellProbe> {
    const enc = this.device.createCommandEncoder();
    const words = CELL_CHANNELS + GENOME_CHANNELS3 + 1;
    const st = this.device.createBuffer({ size: words * 4, usage: MAP_READ | COPY_DST });
    for (let ch = 0; ch < CELL_CHANNELS; ch++) enc.copyBufferToBuffer(this.cells[0], (ch * this.n + index) * 4, st, ch * 4, 4);
    for (let g = 0; g < GENOME_CHANNELS3; g++)
      enc.copyBufferToBuffer(this.genome[this.gcur], (g * this.n + index) * 4, st, (CELL_CHANNELS + g) * 4, 4);
    enc.copyBufferToBuffer(this.ledger, LEDGER.STEP * 4, st, (words - 1) * 4, 4);
    this.device.queue.submit([enc.finish()]);
    await st.mapAsync(MAP_READ);
    const all = new Uint32Array(st.getMappedRange().slice(0));
    st.unmap();
    st.destroy();
    return { index, step: all[words - 1], cells: all.subarray(0, CELL_CHANNELS), genome: all.subarray(CELL_CHANNELS, words - 1) };
  }

  /** Current genome buffer (for rendering and readback). */
  get currentGenome(): GPUBuffer {
    return this.genome[this.gcur];
  }

  private async readBuffers(srcs: { buf: GPUBuffer; size: number }[], after?: (enc: GPUCommandEncoder) => void): Promise<Uint32Array[]> {
    const enc = this.device.createCommandEncoder();
    const stages = srcs.map(({ buf, size }) => {
      const st = this.device.createBuffer({ size, usage: MAP_READ | COPY_DST });
      enc.copyBufferToBuffer(buf, 0, st, 0, size);
      return st;
    });
    after?.(enc);
    this.device.queue.submit([enc.finish()]);
    return Promise.all(
      stages.map(async (st) => {
        await st.mapAsync(MAP_READ);
        const out = new Uint32Array(st.getMappedRange().slice(0));
        st.unmap();
        st.destroy();
        return out;
      }),
    );
  }

  async readState(): Promise<WorldState> {
    const [cells, genome, L] = await this.readBuffers([
      { buf: this.cells[0], size: this.n * CELL_CHANNELS * 4 },
      { buf: this.genome[this.gcur], size: this.n * GENOME_CHANNELS3 * 4 },
      { buf: this.ledger, size: LEDGER_WORDS * 4 },
    ]);
    checkLedger(L);
    return {
      cfg: this.cfg,
      step: L[LEDGER.STEP],
      cells,
      genome,
      lightIn: BigInt(L[LEDGER.LIGHT_LO]) | (BigInt(L[LEDGER.LIGHT_HI]) << 32n),
      heatOut: BigInt(L[LEDGER.HEAT_LO]) | (BigInt(L[LEDGER.HEAT_HI]) << 32n),
      flux: fluxOf(L),
    };
  }

  async readRoles(): Promise<Uint32Array> {
    const [r] = await this.readBuffers([{ buf: this.roles, size: this.n * ROLE_WORDS * 4 }]);
    return r;
  }

  /** The light of the last step's react pass, one word per cell (derived; for diagnostics and tests). */
  async readLight(): Promise<Uint32Array> {
    const [l] = await this.readBuffers([{ buf: this.light, size: this.n * 4 }]);
    return l;
  }

  /** Read all cell channels of the current state. */
  async readCells(): Promise<Uint32Array> {
    const [cells] = await this.readBuffers([{ buf: this.cells[0], size: this.n * CELL_CHANNELS * 4 }]);
    return cells;
  }

  async readGenomeChannels(first: number, count: number): Promise<Uint32Array> {
    const enc = this.device.createCommandEncoder();
    const size = this.n * count * 4;
    const st = this.device.createBuffer({ size, usage: MAP_READ | COPY_DST });
    enc.copyBufferToBuffer(this.genome[this.gcur], first * this.n * 4, st, 0, size);
    this.device.queue.submit([enc.finish()]);
    await st.mapAsync(MAP_READ);
    const out = new Uint32Array(st.getMappedRange().slice(0));
    st.unmap();
    st.destroy();
    return out;
  }

  /** Read the ledger and drain the event buffer (the count is reset in the same submission). */
  async drainLedger(): Promise<LedgerSnapshot> {
    const [L, ev] = await this.readBuffers(
      [
        { buf: this.ledger, size: LEDGER_WORDS * 4 },
        { buf: this.events, size: this.cfg.eventCap * EVENT_WORDS * 4 },
      ],
      (enc) => enc.clearBuffer(this.ledger, LEDGER.EVENTS * 4, 8),
    );
    checkLedger(L);
    const count = Math.min(L[LEDGER.EVENTS], this.cfg.eventCap);
    const events: MutationEvent[] = [];
    for (let k = 0; k < count; k++) {
      const o = k * EVENT_WORDS;
      events.push({ childHi: ev[o], childLo: ev[o + 1], parentHi: ev[o + 2], parentLo: ev[o + 3] });
    }
    events.sort((a, b) => a.childHi - b.childHi || a.childLo - b.childLo);
    return {
      step: L[LEDGER.STEP],
      lightIn: BigInt(L[LEDGER.LIGHT_LO]) | (BigInt(L[LEDGER.LIGHT_HI]) << 32n),
      heatOut: BigInt(L[LEDGER.HEAT_LO]) | (BigInt(L[LEDGER.HEAT_HI]) << 32n),
      events,
      dropped: L[LEDGER.EVENTS_DROPPED],
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const b of [...this.cells, ...this.genome, this.U, this.disp, this.light, this.ledger, this.events, this.roles, this.statsBuf]) b.destroy();
  }
}
