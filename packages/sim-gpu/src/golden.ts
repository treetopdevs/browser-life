// Cross-implementation golden test: the CPU reference and the GPU kernels
// must produce bit-identical state, ledger and mutation events. Runs in any
// WebGPU host (Chrome/Dawn, Safari, Firefox/wgpu, Deno/wgpu).

import {
  CH,
  MATTER_MAX,
  POOL_MAX,
  buildWorld,
  cloneState,
  defaultConfig,
  generalistWorld,
  soupWorld,
  stateHash,
  totalsOf,
  ledgerResidual,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim, applyLesion } from "@bl/sim-ref";
import { GpuSim } from "./gpu-sim.ts";

export interface GoldenCase {
  name: string;
  cfg: WorldConfig;
  init: (c: WorldConfig) => WorldState;
  steps: number;
  every: number;
  /** Lesion (x, y, r) applied after the first checkpoint. */
  lesion?: [number, number, number];
}

export interface GoldenResult {
  name: string;
  ok: boolean;
  steps: number;
  hash: string;
  detail: string;
  events: number;
}

export function goldenCases(): GoldenCase[] {
  const base = { tileW: 40, tileH: 40, kernelRadius: 5 };
  return [
    { name: "soup", cfg: defaultConfig({ ...base, seed: 11 }), init: (c) => soupWorld(c, 6), steps: 120, every: 20 },
    {
      name: "tiled+mutation-heavy",
      cfg: defaultConfig({ tileW: 24, tileH: 24, tilesX: 2, tilesY: 2, kernelRadius: 4, seed: 5, mutRate: 60_000_000 }),
      init: (c) => soupWorld(c, 8),
      steps: 120,
      every: 30,
    },
    {
      name: "patches+seasons",
      cfg: defaultConfig({ ...base, seed: 99, lightMode: "patches", lightBase: 20, lightAmp: 150, seasonPeriod: 37, seasonAmp: 60 }),
      init: (c) => generalistWorld(c, 4),
      steps: 120,
      every: 40,
    },
    {
      name: "lesion+stats",
      cfg: defaultConfig({ ...base, seed: 3, defaultMu: 60, defaultSigma: 20 }),
      init: (c) => generalistWorld(c, 5, 32, 64),
      steps: 90,
      every: 30,
      lesion: [20, 20, 12],
    },
    {
      name: "blocked-affinity",
      cfg: defaultConfig({ tileW: 32, tileH: 48, tilesX: 2, kernelRadius: 7, seed: 8, defaultMu: 60, defaultSigma: 20 }),
      init: (c) => soupWorld(c, 6, 32, 96),
      steps: 90,
      every: 45,
    },
    {
      // Review regression: state at the arithmetic bounds (total matter at
      // MATTER_MAX, E at POOL_MAX, maximal leak and decay) must keep the ledger
      // exact and the per-workgroup 64-bit reductions carry-correct.
      name: "extremes",
      cfg: defaultConfig({ tileW: 16, tileH: 16, kernelRadius: 3, seed: 13, kELeak: 65535, kBDecay: 65535, kAbio: 65535, eB: 30, eP: 31, eC: 1 }),
      init: (c) => {
        const s = buildWorld(c, { nutrient: 0, founders: [] });
        const n = 256;
        const per = Math.floor(MATTER_MAX / 64);
        for (let y = 4; y < 12; y++)
          for (let x = 4; x < 12; x++) {
            const i = y * 16 + x;
            s.cells[CH.B * n + i] = per;
            s.cells[CH.E * n + i] = POOL_MAX;
            s.cells[CH.S * n + i] = POOL_MAX;
          }
        return s;
      },
      steps: 20,
      every: 5,
    },
    {
      name: "neutral-shadow",
      cfg: defaultConfig({ ...base, seed: 21, neutral: true, mutRate: 20_000_000, defaultMu: 60, defaultSigma: 20 }),
      init: (c) => soupWorld(c, 6, 32, 64),
      steps: 90,
      every: 30,
    },
    {
      // Review regression: mutCap = floor(U32_MAX / mutRate) = 1, so a cell
      // synthesising exactly one quantum mutates with probability ~1/2 and
      // only larger syntheses saturate.
      name: "mutation-boundary",
      cfg: defaultConfig({ tileW: 24, tileH: 24, kernelRadius: 4, seed: 17, mutRate: 0x80000001 }),
      init: (c) => soupWorld(c, 6),
      steps: 40,
      every: 10,
    },
  ];
}

export async function runGolden(device: GPUDevice, log: (s: string) => void = () => {}): Promise<GoldenResult[]> {
  const results: GoldenResult[] = [];
  for (const gc of goldenCases()) {
    const init = gc.init(gc.cfg);
    const start = totalsOf(gc.cfg, init.cells);
    const ref = new RefSim(cloneState(init));
    const gpu = await GpuSim.create(device, cloneState(init));
    let ok = true;
    let detail = "";
    let refEvents: string[] = [];
    let gpuEvents: string[] = [];
    let hash = "";
    try {
      for (let s = 0; s < gc.steps && ok; s += gc.every) {
        for (let k = 0; k < gc.every; k++) for (const e of ref.step().events) refEvents.push(`${e.childHi}:${e.childLo}<${e.parentHi}:${e.parentLo}`);
        gpu.run(gc.every);
        const snap = await gpu.drainLedger();
        for (const e of snap.events) gpuEvents.push(`${e.childHi}:${e.childLo}<${e.parentHi}:${e.parentLo}`);
        const g = await gpu.readState();
        const hr = stateHash(ref.state);
        const hg = stateHash(g);
        hash = hg;
        const resid = ledgerResidual(start, g);
        if (hr !== hg) {
          ok = false;
          detail = `hash mismatch at step ${ref.state.step}: ref ${hr} gpu ${hg}; ${firstDiff(ref.state, g)}`;
        } else if (g.lightIn !== ref.state.lightIn || g.heatOut !== ref.state.heatOut) {
          ok = false;
          detail = `ledger mismatch at step ${ref.state.step}: light ${ref.state.lightIn}/${g.lightIn} heat ${ref.state.heatOut}/${g.heatOut}`;
        } else if (g.flux.some((f, k) => f !== ref.state.flux[k])) {
          ok = false;
          detail = `flux mismatch at step ${ref.state.step}: ref ${ref.state.flux.join(",")} gpu ${g.flux.join(",")}`;
        } else if (!sameWords(await gpu.readRoles(), ref.roles)) {
          ok = false;
          detail = `role buffer mismatch at step ${ref.state.step}`;
        } else if (resid !== 0n) {
          ok = false;
          detail = `energy residual ${resid} at step ${ref.state.step}`;
        } else if (snap.dropped > 0) {
          ok = false;
          detail = `dropped ${snap.dropped} events`;
        } else {
          const t = totalsOf(gc.cfg, ref.state.cells);
          const st = await gpu.readStats();
          if (st.A !== t.A || st.B !== t.B || st.C !== t.C || st.P !== t.P || st.E !== t.E || st.S !== t.S) {
            ok = false;
            detail = `stats reduction mismatch at step ${ref.state.step}`;
          }
        }
        if (ok && gc.lesion && s === 0) {
          const [lx, ly, lr] = gc.lesion;
          applyLesion(ref, lx, ly, lr);
          gpu.lesion(lx, ly, lr);
        }
      }
      refEvents = refEvents.sort();
      gpuEvents = gpuEvents.sort();
      if (ok && refEvents.join() !== gpuEvents.join()) {
        ok = false;
        detail = `event mismatch: ref ${refEvents.length} gpu ${gpuEvents.length}`;
      }
    } finally {
      gpu.destroy();
    }
    const r = { name: gc.name, ok, steps: gc.steps, hash, detail: detail || "bit-exact", events: refEvents.length };
    log(`${ok ? "PASS" : "FAIL"} ${gc.name} (${gc.steps} steps, ${r.events} mutations, hash ${hash}) ${detail}`);
    results.push(r);
  }
  return results;
}

function sameWords(a: Uint32Array, b: Uint32Array): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
}

function firstDiff(a: WorldState, b: WorldState): string {
  const n = a.cells.length / 7;
  for (let k = 0; k < a.cells.length; k++)
    if (a.cells[k] !== b.cells[k]) return `cells ch${Math.floor(k / n)} cell ${k % n}: ${a.cells[k]} vs ${b.cells[k]}`;
  for (let k = 0; k < a.genome.length; k++)
    if (a.genome[k] !== b.genome[k]) return `genome ch${Math.floor(k / n)} cell ${k % n}: ${a.genome[k]} vs ${b.genome[k]}`;
  return "no cell diff (step counter?)";
}
