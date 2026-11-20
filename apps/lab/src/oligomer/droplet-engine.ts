/**
 * Two engines for the droplet worlds behind one interface. Both end up exposing the same exact integer
 * layout (A, F, W, P) through a DropletSource, so the render and observer code does not care which runs.
 * The GPU engine never lets two readbacks overlap and never frees buffers while one is pending.
 */

import { DropletGpuSim, type DropletGpuSnapshot } from './droplets-gpu.ts';
import type { DropletKernelConfig, DropletKernelRef } from './droplets-kernel.ts';
import { type DropletSource, SnapshotHolder, dropletSourceOfRef } from './droplet-render.ts';

export type EngineKind = 'gpu' | 'cpu';
export type EngineMode = 'auto' | 'cpu';

export const ENGINE_SIZES: Record<EngineKind, { readonly sizes: readonly number[]; readonly default: number }> = {
  gpu: { sizes: [64, 128, 256], default: 128 },
  cpu: { sizes: [32, 48, 64], default: 48 },
};
/** Steps per frame. Every GPU option divides 100, and the run clips each frame to the next multiple of 100. */
export const ENGINE_PACES: Record<EngineKind, { readonly paces: readonly number[]; readonly default: number }> = {
  gpu: { paces: [10, 25, 100], default: 25 },
  cpu: { paces: [1, 4, 10], default: 10 },
};
/** CPU frames stop early after this many milliseconds. */
export const CPU_BUDGET_MS = 12;

export interface DropletEngine {
  readonly kind: EngineKind;
  readonly width: number;
  readonly height: number;
  readonly initTotalMatter: bigint;
  /** Re-reads the current arrays on every access. */
  readonly source: DropletSource;
  /** Step of the state `source` shows. */
  readonly step: number;
  /** The device a GPU engine runs on (for device-loss handling). */
  readonly device: GPUDevice | null;
  /** Resolves with steps taken, once `source` shows that state. */
  advance(n: number, budgetMs?: number): Promise<number>;
  /** Waits for the in-flight advance (its errors are swallowed), then frees buffers. Idempotent. */
  destroy(): Promise<void>;
}

export class CpuDropletEngine implements DropletEngine {
  readonly kind = 'cpu' as const;
  readonly width: number;
  readonly height: number;
  readonly initTotalMatter: bigint;
  readonly source: DropletSource;
  readonly device = null;
  private readonly ref: DropletKernelRef;
  constructor(ref: DropletKernelRef) {
    this.ref = ref;
    this.width = ref.cfg.width;
    this.height = ref.cfg.height;
    this.initTotalMatter = ref.initTotalMatter;
    this.source = dropletSourceOfRef(ref);
  }
  get step(): number { return this.ref.stepCount; }
  advance(n: number, budgetMs = Infinity): Promise<number> {
    const t0 = performance.now();
    let k = 0;
    while (k < n) {
      this.ref.step();
      k++;
      if (performance.now() - t0 >= budgetMs) break;
    }
    return Promise.resolve(k);
  }
  destroy(): Promise<void> { return Promise.resolve(); }
}

/** What GpuDropletEngine needs from a simulator (DropletGpuSim, or a fake in tests). */
export interface SimLike {
  uploadFromRef(ref: DropletKernelRef): void;
  step(n: number): void;
  readback(): Promise<DropletGpuSnapshot>;
  destroy(): void;
}
export type MakeSim = (device: GPUDevice, cfg: DropletKernelConfig) => SimLike;
export const realSim: MakeSim = (device, cfg) => new DropletGpuSim(device, cfg);

export class GpuDropletEngine implements DropletEngine {
  readonly kind = 'gpu' as const;
  readonly width: number;
  readonly height: number;
  readonly initTotalMatter: bigint;
  readonly device: GPUDevice;
  private readonly sim: SimLike;
  private readonly holder: SnapshotHolder;
  private inflight: Promise<unknown> | null = null;
  private dead = false;
  private destroying: Promise<void> | null = null;

  private constructor(device: GPUDevice, sim: SimLike, holder: SnapshotHolder, initTotal: bigint) {
    this.device = device;
    this.sim = sim;
    this.holder = holder;
    this.width = holder.width;
    this.height = holder.height;
    this.initTotalMatter = initTotal;
  }

  /** Builds the sim, uploads the seeded reference (which is then dropped) and reads the first snapshot. */
  static async create(device: GPUDevice, ref: DropletKernelRef, makeSim: MakeSim = realSim): Promise<GpuDropletEngine> {
    const sim = makeSim(device, ref.cfg);
    try {
      sim.uploadFromRef(ref);
      const snap = await sim.readback();
      return new GpuDropletEngine(device, sim, new SnapshotHolder(ref.cfg.width, ref.cfg.height, snap), ref.initTotalMatter);
    } catch (e) {
      try { sim.destroy(); } catch { /* already gone */ }
      throw e;
    }
  }

  get source(): DropletSource { return this.holder; }
  get step(): number { return this.holder.current.step; }

  advance(n: number): Promise<number> {
    if (this.inflight) throw new Error('advance while a readback is in flight');
    if (this.dead) return Promise.reject(new Error('engine destroyed'));
    const p = (async () => {
      this.sim.step(n);
      const snap = await this.sim.readback();
      if (this.dead) return 0;
      this.holder.current = snap;
      return n;
    })();
    this.inflight = p;
    const clear = () => { if (this.inflight === p) this.inflight = null; };
    p.then(clear, clear);
    return p;
  }

  destroy(): Promise<void> {
    if (this.destroying) return this.destroying;
    this.dead = true;
    this.destroying = (async () => {
      if (this.inflight) { try { await this.inflight; } catch { /* the readback failed; free anyway */ } }
      try { this.sim.destroy(); } catch { /* ignore */ }
    })();
    return this.destroying;
  }
}

// ---- device -------------------------------------------------------------------------------------

let devicePromise: Promise<GPUDevice | null> | null = null;
let lostListeners: ((device: GPUDevice, reason: string) => void)[] = [];
let errorListeners: ((device: GPUDevice, message: string) => void)[] = [];
export const onDeviceLost = (cb: (device: GPUDevice, reason: string) => void): void => { lostListeners = [...lostListeners, cb]; };
export const onDeviceError = (cb: (device: GPUDevice, message: string) => void): void => { errorListeners = [...errorListeners, cb]; };
let unloading = false;
if (typeof addEventListener === 'function') addEventListener('pagehide', () => { unloading = true; });

/** The page's one WebGPU device, requested lazily and memoised; null when there is no adapter or the request fails. */
export function acquireDevice(): Promise<GPUDevice | null> {
  if (devicePromise) return devicePromise;
  const p: Promise<GPUDevice | null> = (async () => {
    try {
      const gpu = (globalThis as { navigator?: { gpu?: GPU } }).navigator?.gpu;
      if (!gpu) return null;
      const adapter = await gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      device.lost.then((info) => {
        if (devicePromise === p) devicePromise = null;
        if (info.reason === 'destroyed' || unloading) return;
        for (const cb of lostListeners) cb(device, info.message || info.reason);
      });
      device.addEventListener('uncapturederror', (e) => {
        for (const cb of errorListeners) cb(device, (e as GPUUncapturedErrorEvent).error.message);
      });
      return device;
    } catch {
      return null;
    }
  })();
  devicePromise = p;
  return p;
}

export interface BuiltEngine {
  readonly engine: DropletEngine;
  /** The "Running on" sentence. */
  readonly text: string;
}

export const ENGINE_TEXT = {
  gpu: 'Running on: graphics card (WebGPU)',
  noGpu: 'Running on: processor (this browser has no usable WebGPU)',
  chosen: 'Running on: processor (you chose processor only)',
  restarted: 'Running on: processor (the graphics card stopped; restarted this world from step 0 on the processor)',
  failedStart: (why: string) => `Running on: processor (the graphics card failed to start: ${why.slice(0, 120)})`,
};

/** Builds the engine for a seeded reference: the graphics card when allowed and working, else the processor. */
export async function createEngine(
  mode: EngineMode,
  ref: DropletKernelRef,
  opts: { restarted?: boolean; getDevice?: () => Promise<GPUDevice | null>; makeSim?: MakeSim } = {},
): Promise<BuiltEngine> {
  const cpu = (text: string): BuiltEngine => ({ engine: new CpuDropletEngine(ref), text });
  if (opts.restarted) return cpu(ENGINE_TEXT.restarted);
  if (mode === 'cpu') return cpu(ENGINE_TEXT.chosen);
  const device = await (opts.getDevice ?? acquireDevice)();
  if (!device) return cpu(ENGINE_TEXT.noGpu);
  let engine: GpuDropletEngine | null = null;
  let failure = '';
  device.pushErrorScope('validation');
  try {
    engine = await GpuDropletEngine.create(device, ref, opts.makeSim ?? realSim);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }
  const scopeErr = await device.popErrorScope();
  if (scopeErr && !failure) failure = scopeErr.message;
  if (failure) {
    if (engine) await engine.destroy();
    return cpu(ENGINE_TEXT.failedStart(failure));
  }
  return { engine: engine as GpuDropletEngine, text: ENGINE_TEXT.gpu };
}
