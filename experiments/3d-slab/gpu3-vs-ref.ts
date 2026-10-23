// Scratch: GpuSim3 vs RefSim3 step by step (reports the first diverging channel). Needs sim-ref/step3d.ts.
// Run: VARIANT=base deno run -A --no-lock experiments/3d-slab/gpu3-vs-ref.ts [W] [H] [D] [steps]
import { GpuSim3, requestDevice3 } from "@bl/sim-gpu";
import { RefSim3 } from "@bl/sim-ref";
import { defaultConfig, generalistGenome3, slabSpotsWorld, stateHash, CELL_CHANNELS, GENOME_CHANNELS3 } from "@bl/schema";

const [W, H, D, STEPS] = [32, 32, 8, 30].map((v, k) => Number(Deno.args[k] ?? v));
const variant = Deno.env.get("VARIANT") ?? "base";
const extra: Record<string, object> = {
  base: {}, season: { lightBase: 30, seasonPeriod: 60, seasonAmp: 10 }, neutral: { neutral: true }, uniform: { lightMode: "uniform", lightAmp: 150 },
  stress: { dtQ: 255, spread: 4, thetaMass: 64 }, nomot: { motility: false },
};
const cfg = defaultConfig({ tileW: W, tileH: H, tileD: D, lightK: 1024, kernelRadius: 3, seed: 7, mutRate: 4_294_967, lightMode: "gradient", eventCap: 4096, ...extra[variant] });
const state = slabSpotsWorld(cfg, generalistGenome3(cfg.defaultMu, cfg.defaultSigma), 24, 48, 64);
const ref = new RefSim3(structuredClone(state) as typeof state);
const device = await requestDevice3(navigator.gpu, cfg);
const gpu = await GpuSim3.create(device, state);
const n = W * H * D;
let bad = false;
for (let s = 1; s <= STEPS && !bad; s++) {
  ref.step();
  gpu.run(1);
  const g = await gpu.readState();
  const r = ref.state;
  for (let ch = 0; ch < CELL_CHANNELS && !bad; ch++)
    for (let i = 0; i < n; i++) if (g.cells[ch * n + i] !== r.cells[ch * n + i]) {
      console.log(`${variant} step ${s}: cells ch ${ch} cell ${i} (z ${Math.floor(i / (W * H))}) gpu ${g.cells[ch * n + i]} ref ${r.cells[ch * n + i]}`); bad = true; break;
    }
  if (!bad) for (let gg = 0; gg < GENOME_CHANNELS3 && !bad; gg++)
    for (let i = 0; i < n; i++) {
      const living = (r.genome[i] | r.genome[n + i]) !== 0;
      if ((gg < 2 || living) && g.genome[gg * n + i] !== r.genome[gg * n + i]) { console.log(`${variant} step ${s}: genome word ${gg} cell ${i} gpu ${g.genome[gg * n + i]} ref ${r.genome[gg * n + i]}`); bad = true; break; }
    }
  if (!bad && (g.lightIn !== r.lightIn || g.heatOut !== r.heatOut || g.flux.some((f, k) => f !== r.flux[k]))) { console.log(`${variant} step ${s}: ledger differs`); bad = true; }
}
console.log(bad ? `${variant} MISMATCH` : `${variant} MATCH ${STEPS} steps; hashes ${stateHash(await gpu.readState())} ${stateHash(ref.state)}`);
Deno.exit(bad ? 1 : 0);
