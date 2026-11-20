/**
 * Phase B2: WebGPU Compute Runner for Pointer-Free Zwicker Active Droplets + Conserved Obligate Phage.
 *
 * Matches `DropletKernelRef` (`droplets-kernel.ts`) bit for bit on any WebGPU host (Deno native wgpu,
 * Chrome/Safari/Firefox WebGPU). Uses only 4 storage buffers (universal WebGPU limit is 8).
 */

import {
  KERNEL_MOTIFS,
  packKernelParams,
  type DropletKernelConfig,
  type DropletKernelRef,
  type PackedKernelParams,
} from './droplets-kernel.ts';
import { DROPLET_SHADER_WGSL, DROPLET_WG } from './droplets-shaders.ts';

export interface DropletGpuSnapshot {
  readonly step: number;
  readonly A: Uint32Array;
  readonly F: Uint32Array;
  readonly W: Uint32Array;
  readonly P: Uint32Array;
}

export class DropletGpuSim {
  readonly device: GPUDevice;
  readonly cfg: DropletKernelConfig;
  readonly p: PackedKernelParams;
  readonly nTiles: number;
  private readonly wgCount: number;
  private readonly stateWords: number;

  private readonly paramsBuf: GPUBuffer;
  private readonly stepBuf: GPUBuffer;
  private readonly stateBuf: GPUBuffer;
  private readonly state2Buf: GPUBuffer;
  private readonly scratchBuf: GPUBuffer;

  private readonly stageStep: GPUBuffer;
  private readonly stageState: GPUBuffer;

  private readonly p0Tick: GPUComputePipeline;
  private readonly p1Chem: GPUComputePipeline;
  private readonly p2Mu: GPUComputePipeline;
  private readonly p3Flux: GPUComputePipeline;
  private readonly p4Apply: GPUComputePipeline;
  private readonly p5MutCopy: GPUComputePipeline;
  private readonly bindGroup: GPUBindGroup;

  constructor(device: GPUDevice, cfg: DropletKernelConfig) {
    this.device = device;
    this.cfg = cfg;
    this.p = packKernelParams(cfg);
    this.nTiles = cfg.width * cfg.height;
    this.wgCount = Math.ceil(this.nTiles / DROPLET_WG);
    // Packed state layout: A (N), F (N), W (6N), P (6N) = 14N u32s
    this.stateWords = (2 + 2 * KERNEL_MOTIFS) * this.nTiles;

    const stateBytes = this.stateWords * 4;
    const scratchBytes = 3 * KERNEL_MOTIFS * this.nTiles * 4;
    const rwUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const scratchUsage = GPUBufferUsage.STORAGE;
    const stageUsage = GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;

    const paramsArr = new Uint32Array([
      this.p.width,
      this.p.height,
      this.p.seed,
      this.p.bulkBQ16,
      this.p.kappa6Q16,
      this.p.chiQ16,
      this.p.mobQ16,
      this.p.diffWQ16,
      this.p.noiseQ8,
      this.p.diffFQ16,
      this.p.diffAQ16,
      this.p.kLightQ16,
      this.p.kSynQ16,
      this.p.kDegQ16,
      this.p.mutMotifU32,
      this.p.coreMinInt,
      this.p.kInfectQ16,
      this.p.neutralPhage,
      this.p.phageYieldQ16,
      this.p.diffPQ16,
      this.p.kDecayPQ16,
      this.p.mutPhageU32,
      0,
      0,
    ]);
    this.paramsBuf = device.createBuffer({
      size: paramsArr.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.paramsBuf, 0, paramsArr);

    this.stepBuf = device.createBuffer({ size: 4, usage: rwUsage });
    this.stateBuf = device.createBuffer({ size: stateBytes, usage: rwUsage });
    this.state2Buf = device.createBuffer({ size: stateBytes, usage: scratchUsage });
    this.scratchBuf = device.createBuffer({ size: scratchBytes, usage: scratchUsage });

    this.stageStep = device.createBuffer({ size: 4, usage: stageUsage });
    this.stageState = device.createBuffer({ size: stateBytes, usage: stageUsage });

    const module = device.createShaderModule({ code: DROPLET_SHADER_WGSL });
    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });

    const mkPipe = (entryPoint: string) =>
      device.createComputePipeline({ layout, compute: { module, entryPoint } });

    this.p0Tick = mkPipe('pass0_tick');
    this.p1Chem = mkPipe('pass1_chem');
    this.p2Mu = mkPipe('pass2_mu');
    this.p3Flux = mkPipe('pass3_flux');
    this.p4Apply = mkPipe('pass4_apply_diff');
    this.p5MutCopy = mkPipe('pass5_mut_motif_copy');

    this.bindGroup = device.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuf } },
        { binding: 1, resource: { buffer: this.stepBuf } },
        { binding: 2, resource: { buffer: this.stateBuf } },
        { binding: 3, resource: { buffer: this.state2Buf } },
        { binding: 4, resource: { buffer: this.scratchBuf } },
      ],
    });
  }

  /** Upload exact integer state from a CPU `DropletKernelRef` (e.g. after seeding). */
  uploadFromRef(ref: DropletKernelRef): void {
    const N = this.nTiles;
    const packed = new Uint32Array(this.stateWords);
    packed.set(ref.A, 0);
    packed.set(ref.F, N);
    packed.set(ref.W, 2 * N);
    packed.set(ref.P, 8 * N);
    const q = this.device.queue;
    q.writeBuffer(this.stepBuf, 0, new Uint32Array([ref.stepCount >>> 0]));
    q.writeBuffer(this.stateBuf, 0, packed);
  }

  /** Advance `steps` iterations on GPU in chunks of `chunkSize` steps per command buffer. */
  step(steps = 1, chunkSize = 128): void {
    let left = steps;
    while (left > 0) {
      const batch = Math.min(left, chunkSize);
      const enc = this.device.createCommandEncoder();
      const dispatch = (pipe: GPUComputePipeline, wg: number) => {
        const pass = enc.beginComputePass();
        pass.setBindGroup(0, this.bindGroup);
        pass.setPipeline(pipe);
        pass.dispatchWorkgroups(wg);
        pass.end();
      };
      for (let s = 0; s < batch; s++) {
        dispatch(this.p0Tick, 1);
        dispatch(this.p1Chem, this.wgCount);
        dispatch(this.p2Mu, this.wgCount);
        dispatch(this.p3Flux, this.wgCount);
        dispatch(this.p4Apply, this.wgCount);
        dispatch(this.p5MutCopy, this.wgCount);
      }
      this.device.queue.submit([enc.finish()]);
      left -= batch;
    }
  }

  /** Read back exact integer state (A, F, W, P, step) from GPU. */
  async readback(): Promise<DropletGpuSnapshot> {
    const N = this.nTiles;
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.stepBuf, 0, this.stageStep, 0, 4);
    enc.copyBufferToBuffer(this.stateBuf, 0, this.stageState, 0, this.stateWords * 4);
    this.device.queue.submit([enc.finish()]);

    await Promise.all([
      this.stageStep.mapAsync(GPUMapMode.READ),
      this.stageState.mapAsync(GPUMapMode.READ),
    ]);

    const step = new Uint32Array(this.stageStep.getMappedRange())[0];
    const packed = new Uint32Array(this.stageState.getMappedRange().slice(0));
    this.stageStep.unmap();
    this.stageState.unmap();

    return {
      step,
      A: packed.subarray(0, N),
      F: packed.subarray(N, 2 * N),
      W: packed.subarray(2 * N, 8 * N),
      P: packed.subarray(8 * N, 14 * N),
    };
  }

  destroy(): void {
    this.paramsBuf.destroy();
    this.stepBuf.destroy();
    this.stateBuf.destroy();
    this.state2Buf.destroy();
    this.scratchBuf.destroy();
    this.stageStep.destroy();
    this.stageState.destroy();
  }
}
