// The two simulator adapters of the slab viewer behind one interface. Cyclic competition uses the Gate-0 spike's own simulator,
// settings setter and founding (imported, never copied or patched); the slab ecology uses the stock GpuSim3 of @bl/sim-gpu.
// `RPS` in the spike's shaders is module state baked into the shader text when a simulator is created, so at most one
// patched simulator exists at a time: the page destroys the old one before creating the next.
import { CH, G, initWorld, presetById, type WorldConfig } from "@bl/schema";
import { GpuSim3 as StockSim3 } from "@bl/sim-gpu";
import { rpsLabels } from "@bl/metrics";
import { applySettings, SUBMIT_STEPS } from "../../../../experiments/3d-rps/gate0-spike/adapter.ts";
import { GpuSim3 as RpsSim3, requestDevice3 } from "../../../../experiments/3d-rps/gate0-spike/gpu-sim3-rps.ts";
import { jobConfig, mixParams } from "../../../../experiments/3d-rps/gate0-spike/rungs.ts";
import { rpsMix } from "../../../../experiments/3d-rps/gate0-spike/world.ts";
import type { CyclicChoice, EcoChoice } from "./settings.ts";
import { BURN_IN, SPREAD, cyclicSettings, ecoConfig } from "./settings.ts";
import type { CyclicFrame, EcoFrame, Frame } from "./render.ts";

export interface WorldSim {
  readonly step: number;
  /** "burn" while the kill is off for the recorded burn-in, "run" after (always "run" for the ecology). */
  readonly phase: "burn" | "run";
  /** Advances exactly `count` steps (cuts at the hand-over step), without reading back. */
  advance(count: number): Promise<void>;
  frame(): Promise<Frame>;
  /** The quantity the M4 calibration used (`readStats().living`), ecology only. */
  living?(): Promise<number>;
  destroy(): void;
}

let sharedDevice: Promise<GPUDevice> | null = null;
/** One device per page load, sized for the largest world (256 x 256 x 8 slab genome), reused across restarts. */
export function getDevice(onLost: (reason: string) => void): Promise<GPUDevice> {
  sharedDevice ??= (async () => {
    if (!navigator.gpu) throw new Error("WebGPU is not available in this browser");
    const d = await requestDevice3(navigator.gpu, ecoConfig({ size: [256, 256, 8], option: "mu40-s20-k1024", seed: 101 }));
    void d.lost.then((i) => { sharedDevice = null; onLost(`The GPU device was lost (${i.reason}): ${i.message}`); });
    return d;
  })();
  sharedDevice.catch(() => { sharedDevice = null; });
  return sharedDevice;
}

/** Batches of at most SUBMIT_STEPS, like the harness. */
function runBatches(run: (n: number) => void, count: number) {
  for (let b = 0; b < count; b += SUBMIT_STEPS) run(Math.min(SUBMIT_STEPS, count - b));
}

export async function createCyclic(device: GPUDevice, choice: CyclicChoice): Promise<WorldSim> {
  const cfg = jobConfig("S0", choice.size, SPREAD, choice.seed);
  const dims = { W: cfg.tileW, H: cfg.tileH, D: cfg.tileD! };
  const build = async (phase: "burn" | "run", state: Awaited<ReturnType<typeof rpsMix>>) => {
    applySettings(cyclicSettings(choice, phase));
    return RpsSim3.create(device, state);
  };
  const burn = choice.burnIn;
  let sim = await build(burn ? "burn" : "run", rpsMix(cfg, mixParams("S0")));
  let phase: "burn" | "run" = burn ? "burn" : "run";
  const self: WorldSim = {
    get step() { return sim.step; },
    get phase() { return phase; },
    async advance(count: number) {
      while (count > 0) {
        const toHand = phase === "burn" ? BURN_IN - sim.step : Infinity;
        const n = Math.min(count, toHand);
        runBatches((k) => sim.run(k), n);
        count -= n;
        if (phase === "burn" && sim.step === BURN_IN) {
          // the harness's hand-over: read the state, destroy, build again with the kill's settings, continue from the same step
          const state = await sim.readState();
          sim.destroy();
          sim = await build("run", state);
          phase = "run";
        }
      }
    },
    async frame(): Promise<CyclicFrame> {
      const snap = await sim.readSnapshot(false);
      return { kind: "cyclic", step: snap.step, dims, labels: rpsLabels({ cells: snap.cells, genomeHead: snap.genomeHead }, dims) };
    },
    destroy() { sim.destroy(); },
  };
  return self;
}

export async function createEco(device: GPUDevice, choice: EcoChoice): Promise<WorldSim> {
  const cfg: WorldConfig = ecoConfig(choice);
  const dims = { W: cfg.tileW, H: cfg.tileH, D: cfg.tileD! };
  const n = dims.W * dims.H * dims.D;
  const state = initWorld(cfg, presetById("slab-spots")!.init);
  const sim = await StockSim3.create(device, state);
  return {
    get step() { return sim.step; },
    phase: "run",
    async advance(count: number) { runBatches((k) => sim.run(k), count); },
    async frame(): Promise<EcoFrame> {
      const cells = await sim.readCells();
      const lin = await sim.readGenomeChannels(G.LIN_HI, 2);
      return {
        kind: "eco", step: sim.step, dims,
        B: cells.subarray(CH.B * n, (CH.B + 1) * n), P: cells.subarray(CH.P * n, (CH.P + 1) * n), A: cells.subarray(CH.A * n, (CH.A + 1) * n),
        hi: lin.subarray(0, n), lo: lin.subarray(n, 2 * n),
      };
    },
    async living() { return (await sim.readStats()).living; },
    destroy() { sim.destroy(); },
  };
}
