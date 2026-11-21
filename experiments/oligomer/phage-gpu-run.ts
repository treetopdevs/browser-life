/**
 * Phase B2 WebGPU Experiment Runner: Large-Arena (128x128 / 256x256, 100+ droplets)
 * Conserved Obligate Phage (Kill-the-Winner) on Pointer-Free Zwicker Active Droplets.
 *
 * Uses native WebGPU (`DropletGpuSim`, bit-exact twin of `DropletKernelRef`), exact integer
 * matter conservation (res = 0).
 *
 * Usage:
 *   deno run -A experiments/oligomer/phage-gpu-run.ts --size 128 --steps 20000 --seeds 4
 *   deno run -A experiments/oligomer/phage-gpu-run.ts --size 256 --steps 10000 --seeds 1 --arm PHAGE --trace
 */

import {
  DropletKernelRef,
  KERNEL_MOTIFS,
  defaultDropletKernelConfig,
  observeFindDroplets,
  observeMotifStats,
  observeTotalMatter,
} from '../../apps/lab/src/oligomer/droplets-kernel.ts';
import { DropletGpuSim } from '../../apps/lab/src/oligomer/droplets-gpu.ts';
import { phageArms, seedPhageArena } from '../../apps/lab/src/oligomer/droplet-worlds.ts';

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n;
  my /= n;
  let num = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx > 1e-12 && vy > 1e-12 ? num / Math.sqrt(vx * vy) : null;
}

function fmtR(r: number | null): string {
  if (r === null) return '  n/a';
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}`;
}

const args = parseArgs(Deno.args);
const size = Number(args.size ?? 128);
const steps = Number(args.steps ?? 20000);
const seeds = Number(args.seeds ?? 4);
const censusEvery = Number(args.census ?? 1000);
const initMode = (args.init ?? 'mixed') as 'single' | 'mixed';
const onlyArm = args.arm;
const trace = args.trace === 'true';
const kInfect = Number(args.kInfect ?? 0.34);
const kDecayP = Number(args.kDecayP ?? 0.020);
const diffP = Number(args.diffP ?? 0.22);
const mutPhage = Number(args.mutPhage ?? 0.00001);
const mutMotif = Number(args.mutMotif ?? 0.00002);

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error('No WebGPU adapter available');
const device = await adapter.requestDevice();
device.addEventListener?.('uncapturederror', (e) => {
  console.error('WebGPU error:', (e as GPUUncapturedErrorEvent).error.message);
});

const arms = phageArms({ kInfect, kDecayP, diffP, mutPhage, mutMotif });

console.log(
  `=== Phase B2 WebGPU Droplets | init=${initMode} | size=${size}x${size} | steps=${steps} | seeds=${seeds} | kInfect=${kInfect} kDecayP=${kDecayP} ===`,
);

for (const arm of arms) {
  if (onlyArm && arm.name !== onlyArm) continue;
  for (let seed = 1; seed <= seeds; seed++) {
    const t0 = performance.now();
    const cfg = defaultDropletKernelConfig({ width: size, height: size, seed, ...arm.ov });
    const ref = new DropletKernelRef(cfg);

    // Seed a grid of droplets scaled to arena size (spacing ~20 tiles)
    seedPhageArena(ref, size, arm.single, initMode);

    const gpu = new DropletGpuSim(device, cfg);
    gpu.uploadFromRef(ref);

    const lateFrom = Math.floor(steps * 0.4);
    let switchesLate = 0;
    let sweepsLate = 0;
    let prevDom = -1;
    let prevMajorDom = -1;
    let d1Sum = 0;
    let dropSum = 0;
    let maxDomLate = 0;
    let lateCount = 0;

    const motifHist: number[][] = [];
    const phageHist: number[][] = [];
    let lastSnap = await gpu.readback();

    for (let done = 0; done < steps; ) {
      const dt = Math.min(censusEvery, steps - done);
      gpu.step(dt);
      done += dt;
      const t = done;
      const snap = await gpu.readback();
      lastSnap = snap;

      const st = observeMotifStats(snap.W, snap.P);
      const ds = observeFindDroplets(snap.W, size, size, 0.20);
      const pSum = st.phageTotals.reduce((a, b) => a + b, 0);
      const pShares = st.phageTotals.map((v) => (pSum > 0 ? v / pSum : 0));

      if (trace) {
        const sh = st.shares.map((s, m) => `m${m}:${(s * 100).toFixed(0)}%`).join(' ');
        const ph = st.phageTotals.map((v, m) => (v > 0 ? `P${m}:${v}` : '')).filter(Boolean).join(' ');
        console.log(
          `  t=${String(t).padStart(5)} drop=${String(ds.length).padStart(3)} D1=${st.hillD1.toFixed(2)} | ${sh} | ${ph}`,
        );
      }

      if (t >= lateFrom) {
        if (prevDom >= 0 && st.dominant >= 0 && st.dominant !== prevDom) switchesLate++;
        prevDom = st.dominant;
        if (st.dominant >= 0 && st.dominantShare >= 0.25) {
          if (prevMajorDom >= 0 && st.dominant !== prevMajorDom) sweepsLate++;
          prevMajorDom = st.dominant;
        }
        d1Sum += st.hillD1;
        dropSum += ds.length;
        if (st.dominantShare > maxDomLate) maxDomLate = st.dominantShare;
        lateCount++;
        motifHist.push(st.shares);
        phageHist.push(pShares);
      }
    }

    gpu.destroy();

    const lagCorrTimeShift = (tShift: number): number | null => {
      const xs: number[] = [];
      const ys: number[] = [];
      const T = motifHist.length;
      if (T < 3) return null;
      const pairs = tShift === 1 ? T - 1 : T;
      for (let m = 0; m < KERNEL_MOTIFS; m++) {
        let mx = 0;
        let my = 0;
        for (let k = 0; k < pairs; k++) {
          mx += motifHist[k][m];
          my += phageHist[(k + tShift) % T][m];
        }
        mx /= pairs;
        my /= pairs;
        for (let k = 0; k < pairs; k++) {
          xs.push(motifHist[k][m] - mx);
          ys.push(phageHist[(k + tShift) % T][m] - my);
        }
      }
      return pearson(xs, ys);
    };
    const lagCorr = lagCorrTimeShift(1);
    // Independent circular half-period time-shift null (avoids compositional -lagR/5 dependence)
    const lagNull = motifHist.length >= 6 ? lagCorrTimeShift(Math.floor(motifHist.length / 2)) : null;

    const nfX: number[] = [];
    const nfY: number[] = [];
    for (let k = 0; k + 1 < motifHist.length; k++) {
      for (let m = 0; m < KERNEL_MOTIFS; m++) {
        if (motifHist[k][m] > 0.01) {
          nfX.push(motifHist[k][m]);
          nfY.push(motifHist[k + 1][m] - motifHist[k][m]);
        }
      }
    }
    const nfdsR = pearson(nfX, nfY);

    const st = observeMotifStats(lastSnap.W, lastSnap.P);
    const ds = observeFindDroplets(lastSnap.W, size, size, 0.20);
    const res = observeTotalMatter(lastSnap.A, lastSnap.F, lastSnap.W, lastSnap.P) - ref.initTotalMatter;
    const ms = Math.round(performance.now() - t0);
    const sps = Math.round((steps / ms) * 1000);
    const shStr = st.shares.map((s, m) => `m${m}:${(s * 100).toFixed(0)}%`).join(' ');
    console.log(
      `${arm.name.padEnd(13)} s${seed} | drop=${String(ds.length).padStart(3)} (late ${(dropSum / lateCount).toFixed(1).padStart(5)}) ` +
        `| D1=${(d1Sum / lateCount).toFixed(2)} sw=${String(switchesLate).padStart(2)} sw25=${String(sweepsLate).padStart(2)} maxM=${(maxDomLate * 100).toFixed(0).padStart(3)}% ` +
        `| lagR=${fmtR(lagCorr)} (null ${fmtR(lagNull)}) nfds=${fmtR(nfdsR)} res=${res} | ${ms}ms (${sps} step/s)`,
    );
    console.log(`              motifs: ${shStr}`);
  }
}

device.destroy();
