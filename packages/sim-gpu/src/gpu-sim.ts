import {
  CELL_CHANNELS,
  CH,
  EVENT_WORDS,
  GENOME_CHANNELS,
  LEDGER,
  LEDGER_WORDS,
  FLAG_EVENTS_SATURATED,
  FLAG_LEDGER_OVERFLOW,
  MAX_STEP,
  clampLesionRadius,
  feedError,
  feedNutrient,
  type FeedResult,
  validateState,
  FLUX_COUNT,
  ROLE_WORDS,
  cellCount,
  worldH,
  worldW,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { STATS, STATS_WORDS, WG, affinityBlock, affinityShader, flowShader, lesionShader, reactShader, statsShader, tickShader, transportShader } from "./shaders.ts";

export interface MutationEvent {
  childHi: number;
  childLo: number;
  parentHi: number;
  parentLo: number;
}

export interface StatsSnapshot {
  step: number;
  A: bigint;
  B: bigint;
  C: bigint;
  P: bigint;
  E: bigint;
  S: bigint;
  living: number;
  dense: number;
  lightIn: bigint;
  heatOut: bigint;
  flux: bigint[];
}

export interface CellProbe {
  index: number;
  step: number;
  cells: Uint32Array;
  genome: Uint32Array;
}

export interface LedgerSnapshot {
  step: number;
  lightIn: bigint;
  heatOut: bigint;
  events: MutationEvent[];
  dropped: number;
}

const STORAGE = 0x80; // GPUBufferUsage.STORAGE
const COPY_SRC = 0x04;
const COPY_DST = 0x08;
const MAP_READ = 0x01;
const UNIFORM = 0x40;

/** Requests an adapter/device with limits large enough for `cfg`. */
export async function requestDevice(gpu: GPU, cfg?: WorldConfig): Promise<GPUDevice> {
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU: no adapter");
  const need = cfg ? cellCount(cfg) * GENOME_CHANNELS * 4 : 0;
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

export class GpuSim {
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
  readonly ledger: GPUBuffer;
  private readonly events: GPUBuffer;
  /** Diagnostic per-cell role buffer written by the react pass. */
  readonly roles: GPUBuffer;
  private readonly pipes: Record<"affinity" | "flow" | "transport" | "react" | "tick" | "lesion" | "stats", GPUComputePipeline>;
  private readonly groups: {
    affinity: GPUBindGroup[];
    flow: GPUBindGroup[];
    transport: GPUBindGroup[];
    react: GPUBindGroup[];
    tick: GPUBindGroup;
    lesion: GPUBindGroup[];
    stats: GPUBindGroup[];
  };
  private readonly lesionParams: GPUBuffer;
  private readonly statsBuf: GPUBuffer;
  private readonly wgX: number;
  private readonly affX: number;
  private readonly affY: number;
  private readonly wgY: number;
  private destroyed = false;

  private constructor(device: GPUDevice, cfg: WorldConfig, pipes: GpuSim["pipes"]) {
    this.device = device;
    this.cfg = cfg;
    this.n = cellCount(cfg);
    this.pipes = pipes;
    const mk = (size: number, extra = 0, label = "") =>
      device.createBuffer({ size: Math.max(16, size), usage: STORAGE | COPY_SRC | COPY_DST | extra, label });
    this.cells = [mk(this.n * CELL_CHANNELS * 4, 0, "cells0"), mk(this.n * CELL_CHANNELS * 4, 0, "cells1")];
    this.genome = [mk(this.n * GENOME_CHANNELS * 4, 0, "genome0"), mk(this.n * GENOME_CHANNELS * 4, 0, "genome1")];
    this.U = mk(this.n * 4, 0, "U");
    this.disp = mk(this.n * 4, 0, "disp");
    this.ledger = mk(LEDGER_WORDS * 4, 0, "ledger");
    this.events = mk(cfg.eventCap * EVENT_WORDS * 4, 0, "events");
    this.roles = mk(this.n * ROLE_WORDS * 4, 0, "roles");
    this.lesionParams = device.createBuffer({ size: 16, usage: UNIFORM | COPY_DST, label: "lesion" });
    this.statsBuf = mk(STATS_WORDS * 4, 0, "stats");
    this.wgX = Math.ceil(worldW(cfg) / WG);
    this.wgY = Math.ceil(worldH(cfg) / WG);
    const blk = affinityBlock(cfg);
    this.affX = Math.ceil(worldW(cfg) / (WG * blk));
    this.affY = Math.ceil(worldH(cfg) / (WG * blk));

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
      react: [0, 1].map((p) => bg(pipes.react, [c1, g[1 - p], this.U, c0, this.ledger, this.events, this.roles])),
      tick: bg(pipes.tick, [this.ledger]),
      lesion: [0, 1].map((p) => bg(pipes.lesion, [c0, g[p], this.ledger, this.lesionParams])),
      stats: [0, 1].map((p) => bg(pipes.stats, [c0, g[p], this.statsBuf])),
    };
  }

  static async create(device: GPUDevice, state: WorldState): Promise<GpuSim> {
    const errs = validateState(state);
    if (errs.length) throw new Error(`invalid state: ${errs.join("; ")}`);
    const cfg = state.cfg;
    const mod = (code: string, label: string) => device.createShaderModule({ code, label });
    const pipe = async (code: string, label: string) => {
      const module = mod(code, label);
      const info = await module.getCompilationInfo?.();
      const errs = info?.messages.filter((m) => m.type === "error") ?? [];
      if (errs.length) throw new Error(`${label}: ${errs.map((e) => `${e.lineNum}:${e.linePos} ${e.message}`).join("\n")}`);
      return device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" }, label });
    };
    device.pushErrorScope("validation");
    const [affinity, flow, transport, react, tick, lesion, stats] = await Promise.all([
      pipe(affinityShader(cfg), "affinity"),
      pipe(flowShader(cfg), "flow"),
      pipe(transportShader(cfg), "transport"),
      pipe(reactShader(cfg), "react"),
      pipe(tickShader(), "tick"),
      pipe(lesionShader(cfg), "lesion"),
      pipe(statsShader(cfg), "stats"),
    ]);
    const sim = new GpuSim(device, cfg, { affinity, flow, transport, react, tick, lesion, stats });
    sim.upload(state);
    const err = await device.popErrorScope();
    if (err) throw new Error(`WebGPU validation: ${err.message}`);
    return sim;
  }

  upload(state: WorldState): void {
    const errs = validateState(state);
    if (errs.length) throw new Error(`invalid state: ${errs.join("; ")}`);
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
    if (this.destroyed) throw new Error("GpuSim destroyed");
    if (this.step + count > MAX_STEP) throw new Error(`step limit ${MAX_STEP} reached`);
    const enc = this.device.createCommandEncoder();
    for (let s = 0; s < count; s++) this.encodeStep(enc);
    this.device.queue.submit([enc.finish()]);
  }

  /**
   * Profiling hook: when set, each pass of each step is encoded as its own
   * compute pass with begin/end timestamps written at 2*k, 2*k+1.
   */
  profile: { set: GPUQuerySet; next: number } | null = null;

  encodeStep(enc: GPUCommandEncoder): void {
    const p = this.gcur;
    if (this.profile) {
      const prof = this.profile;
      const one = (pipe: GPUComputePipeline, group: GPUBindGroup, wx = this.wgX, wy = this.wgY) => {
        const k = prof.next++;
        const ps = enc.beginComputePass({ timestampWrites: { querySet: prof.set, beginningOfPassWriteIndex: 2 * k, endOfPassWriteIndex: 2 * k + 1 } });
        ps.setPipeline(pipe);
        ps.setBindGroup(0, group);
        ps.dispatchWorkgroups(wx, wy);
        ps.end();
      };
      one(this.pipes.affinity, this.groups.affinity[p], this.affX, this.affY);
      one(this.pipes.flow, this.groups.flow[p]);
      one(this.pipes.transport, this.groups.transport[p]);
      one(this.pipes.react, this.groups.react[p]);
      one(this.pipes.tick, this.groups.tick, 1, 1);
      this.gcur = 1 - p;
      this.step += 1;
      return;
    }
    const pass = enc.beginComputePass();
    const dispatch = (pipe: GPUComputePipeline, group: GPUBindGroup) => {
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(this.wgX, this.wgY);
    };
    pass.setPipeline(this.pipes.affinity);
    pass.setBindGroup(0, this.groups.affinity[p]);
    pass.dispatchWorkgroups(this.affX, this.affY);
    dispatch(this.pipes.flow, this.groups.flow[p]);
    dispatch(this.pipes.transport, this.groups.transport[p]);
    dispatch(this.pipes.react, this.groups.react[p]);
    pass.setPipeline(this.pipes.tick);
    pass.setBindGroup(0, this.groups.tick);
    pass.dispatchWorkgroups(1);
    pass.end();
    this.gcur = 1 - p;
    this.step += 1;
  }

  /** Destroy bound structure in a disc (between steps). Matches sim-ref applyLesion. */
  /** Returns the effective radius (clamped by clampLesionRadius, as in the reference). */
  lesion(cx: number, cy: number, radius: number): number {
    const r = clampLesionRadius(this.cfg, radius);
    this.device.queue.writeBuffer(this.lesionParams, 0, new Uint32Array([cx >>> 0, cy >>> 0, r, 0]));
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipes.lesion);
    pass.setBindGroup(0, this.groups.lesion[this.gcur]);
    const wg = Math.ceil((2 * r + 1) / WG);
    pass.dispatchWorkgroups(wg, wg);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    return r;
  }

  /**
   * Feed or drain nutrient in a disc (between steps), an experimenter intervention that changes the
   * world's total matter: see feed.ts in @bl/schema, whose `feedNutrient` this runs on a readback of
   * the nutrient channel, so it equals the reference (`applyFeed`) by construction. Only that channel
   * is written back: the ledger, the genome and undrained mutation events are untouched. The caller
   * logs the intervention and moves its conservation baselines by the result.
   */
  async feed(cx: number, cy: number, radius: number, amount: number): Promise<FeedResult> {
    const gone = () => { if (this.destroyed) throw new Error("GpuSim destroyed"); };
    gone();
    const err = feedError(this.cfg, amount, radius);
    if (err) throw new Error(err);
    const size = this.n * 4, offset = CH.A * this.n * 4;
    const stats = await this.readStats();
    // The sim can be destroyed while a readback is awaited: nothing may be read from or written to it then.
    gone();
    const st = this.device.createBuffer({ size, usage: MAP_READ | COPY_DST });
    let A: Uint32Array;
    try {
      const enc = this.device.createCommandEncoder();
      enc.copyBufferToBuffer(this.cells[0], offset, st, 0, size);
      this.device.queue.submit([enc.finish()]);
      await st.mapAsync(MAP_READ);
      A = new Uint32Array(st.getMappedRange().slice(0));
      st.unmap();
    } finally {
      st.destroy();
    }
    gone();
    const res = feedNutrient(this.cfg, A, stats.A + stats.B + stats.C + stats.P, cx, cy, radius, amount);
    if (res.matter !== 0) this.device.queue.writeBuffer(this.cells[0], offset, A as BufferSource);
    return res;
  }

  /**
   * Consistent snapshot for censuses: cells, the genome head (lineage and
   * parameter channels), optionally the role buffer, and the ledger, all
   * copied in one submission so they describe the same step.
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
    pass.dispatchWorkgroups(this.wgX, this.wgY);
    pass.end();
    this.device.queue.submit([enc.finish()]);
    const [st, L] = await this.readBuffers([
      { buf: this.statsBuf, size: STATS_WORDS * 4 },
      { buf: this.ledger, size: LEDGER_WORDS * 4 },
    ]);
    checkLedger(L);
    const u64 = (k: number) => BigInt(st[STATS.SUMS + 2 * k]) | (BigInt(st[STATS.SUMS + 2 * k + 1]) << 32n);
    return {
      step: L[LEDGER.STEP],
      A: u64(0),
      B: u64(1),
      C: u64(2),
      P: u64(3),
      E: u64(4),
      S: u64(5),
      living: st[STATS.LIVING],
      dense: st[STATS.DENSE],
      lightIn: BigInt(L[LEDGER.LIGHT_LO]) | (BigInt(L[LEDGER.LIGHT_HI]) << 32n),
      heatOut: BigInt(L[LEDGER.HEAT_LO]) | (BigInt(L[LEDGER.HEAT_HI]) << 32n),
      flux: fluxOf(L),
    };
  }

  /** All channels of one cell. */
  async probe(index: number): Promise<CellProbe> {
    const enc = this.device.createCommandEncoder();
    const words = CELL_CHANNELS + GENOME_CHANNELS + 1;
    const st = this.device.createBuffer({ size: words * 4, usage: MAP_READ | COPY_DST });
    for (let ch = 0; ch < CELL_CHANNELS; ch++) enc.copyBufferToBuffer(this.cells[0], (ch * this.n + index) * 4, st, ch * 4, 4);
    for (let g = 0; g < GENOME_CHANNELS; g++)
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
      { buf: this.genome[this.gcur], size: this.n * GENOME_CHANNELS * 4 },
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

  /** Read a subset of cell channels for the current state. */
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
    for (const b of [...this.cells, ...this.genome, this.U, this.disp, this.ledger, this.events, this.roles, this.lesionParams, this.statsBuf]) b.destroy();
  }
}
