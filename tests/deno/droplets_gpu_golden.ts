/**
 * Phase B2 Golden Test: Bit-for-Bit CPU (`DropletKernelRef`) vs Native WebGPU (`DropletGpuSim`).
 *
 * Usage:
 *   deno run -A tests/deno/droplets_gpu_golden.ts
 */

import {
  DropletKernelRef,
  defaultDropletKernelConfig,
  observeDigest,
  observeTotalMatter,
  type DropletKernelConfig,
} from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { DropletGpuSim } from '../../apps/lab/src/oligomer/droplets-gpu.ts';

async function getDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter available');
  const device = await adapter.requestDevice();
  device.addEventListener?.('uncapturederror', (e) => {
    console.error('WebGPU uncaptured error:', (e as GPUUncapturedErrorEvent).error.message);
  });
  return device;
}

interface GoldenCase {
  name: string;
  cfg: DropletKernelConfig;
  steps: number;
  seedFn: (ref: DropletKernelRef) => void;
}

const cases: GoldenCase[] = [
  {
    name: 'multi-motif droplets (no phage, no mut)',
    cfg: defaultDropletKernelConfig({ width: 32, height: 32, seed: 1, kInfect: 0, mutMotif: 0, mutPhage: 0 }),
    steps: 300,
    seedFn: (r) => {
      r.seedDroplet(10, 16, 3, 0, 0.85);
      r.seedDroplet(22, 16, 3, 1, 0.85);
    },
  },
  {
    name: 'specialist PHAGE + high mutMotif + mutPhage',
    cfg: defaultDropletKernelConfig({
      width: 32,
      height: 32,
      seed: 7,
      kInfect: 0.34,
      kDecayP: 0.02,
      diffP: 0.22,
      mutMotif: 0.001,
      mutPhage: 0.002,
      neutralPhage: false,
    }),
    steps: 300,
    seedFn: (r) => {
      r.seedDroplet(9, 10, 3, 0, 0.85);
      r.seedDroplet(23, 10, 3, 2, 0.85);
      r.seedDroplet(16, 22, 3, 4, 0.85);
      r.seedPhage(9, 10, 0, 30);
    },
  },
  {
    name: 'NEUTRAL_PHAGE + high mutMotif + mutPhage',
    cfg: defaultDropletKernelConfig({
      width: 32,
      height: 32,
      seed: 13,
      kInfect: 0.34,
      kDecayP: 0.02,
      diffP: 0.22,
      mutMotif: 0.001,
      mutPhage: 0.002,
      neutralPhage: true,
    }),
    steps: 300,
    seedFn: (r) => {
      r.seedDroplet(9, 16, 3, 1, 0.85);
      r.seedDroplet(23, 16, 3, 3, 0.85);
      r.seedPhage(9, 16, 0, 30);
    },
  },
  {
    name: 'dark world dissolution (kLight=0)',
    cfg: defaultDropletKernelConfig({ width: 24, height: 24, seed: 5, kLight: 0, kInfect: 0.34, mutMotif: 0, mutPhage: 0 }),
    steps: 200,
    seedFn: (r) => {
      r.seedDroplet(12, 12, 3, 0, 0.85);
      r.seedPhage(12, 12, 0, 25);
    },
  },
  {
    name: 'large-arena 128x128 PHAGE + mutMotif parity',
    cfg: defaultDropletKernelConfig({
      width: 128,
      height: 128,
      seed: 19,
      kInfect: 0.34,
      kDecayP: 0.02,
      diffP: 0.22,
      mutMotif: 0.0001,
      mutPhage: 0.0002,
      neutralPhage: false,
    }),
    steps: 40,
    seedFn: (r) => {
      for (let m = 0; m < 6; m++) {
        r.seedDroplet(20 + m * 16, 64, 3, m, 0.85);
      }
      r.seedPhage(20, 64, 0, 40);
    },
  },
];

const device = await getDevice();
let failed = 0;

for (const tc of cases) {
  const ref = new DropletKernelRef(tc.cfg);
  tc.seedFn(ref);

  const gpu = new DropletGpuSim(device, tc.cfg);
  gpu.uploadFromRef(ref);

  for (let t = 0; t < tc.steps; t++) ref.step();
  gpu.step(tc.steps);
  const snap = await gpu.readback();
  gpu.destroy();

  const cpuDigest = observeDigest(ref.A, ref.F, ref.W, ref.P);
  const gpuDigest = observeDigest(snap.A, snap.F, snap.W, snap.P);
  const cpuMatter = observeTotalMatter(ref.A, ref.F, ref.W, ref.P);
  const gpuMatter = observeTotalMatter(snap.A, snap.F, snap.W, snap.P);

  let firstDiff = '';
  const checkArr = (label: string, a: Uint32Array, b: Uint32Array) => {
    if (firstDiff) return;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        firstDiff = `${label}[${i}] cpu=${a[i]} gpu=${b[i]}`;
        return;
      }
    }
  };
  checkArr('A', ref.A, snap.A);
  checkArr('F', ref.F, snap.F);
  checkArr('W', ref.W, snap.W);
  checkArr('P', ref.P, snap.P);

  const ok =
    snap.step === ref.stepCount &&
    cpuDigest === gpuDigest &&
    cpuMatter === ref.initTotalMatter &&
    gpuMatter === ref.initTotalMatter &&
    firstDiff === '';

  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${tc.name} | steps=${tc.steps} | digest=${cpuDigest.toString(16).padStart(8, '0')} | res=${gpuMatter - ref.initTotalMatter}${firstDiff ? ' | ' + firstDiff : ''}`,
  );
  if (!ok) failed++;
}

device.destroy();
Deno.exit(failed > 0 ? 1 : 0);
