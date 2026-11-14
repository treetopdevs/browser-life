// Scratch smoke test for GpuSim3 (rung 1b M2): pipelines compile, a slab steps without GPU errors,
// matter is exactly conserved and the energy residual is 0.
// Run: deno run -A --no-lock experiments/3d-slab/gpu3-smoke.ts [W] [H] [D] [steps]
import { GpuSim3, requestDevice3 } from "@bl/sim-gpu";
import { defaultConfig, generalistGenome3, slabSpotsWorld, totalsOf, ledgerResidual, stateHash } from "@bl/schema";

const [W, H, D, STEPS] = [32, 32, 8, 200].map((v, k) => Number(Deno.args[k] ?? v));
// VARIANT: base | season | neutral | uniform | stress (strong flow: dtQ high, spread low)
const variant = Deno.env.get("VARIANT") ?? "base";
const extra: Record<string, object> = {
  base: {}, season: { seasonPeriod: 60, seasonAmp: 40 }, neutral: { neutral: true }, uniform: { lightMode: "uniform" },
  stress: { dtQ: 255, spread: 4, thetaMass: 64 }, nomot: { motility: false },
};
const cfg = defaultConfig({ tileW: W, tileH: H, tileD: D, lightK: 1024, kernelRadius: 3, seed: 7, mutRate: 4_294_967, lightMode: "gradient", eventCap: 4096, ...extra[variant] });
console.log("variant", variant);
const state = slabSpotsWorld(cfg, generalistGenome3(cfg.defaultMu, cfg.defaultSigma), 24, 48, 64);
const start = totalsOf(cfg, state.cells);

const device = await requestDevice3(navigator.gpu, cfg);
let uncaptured = 0;
device.addEventListener?.("uncapturederror", (e) => { uncaptured++; console.error("uncaptured:", (e as GPUUncapturedErrorEvent).error.message); });
const t0 = performance.now();
const sim = await GpuSim3.create(device, state);
console.log(`created ${W}x${H}x${D} in ${(performance.now() - t0).toFixed(0)} ms; matter ${start.matter} energy ${start.energy}`);

let ok = true;
const t1 = performance.now();
let events = 0;
for (let s = 0; s < STEPS; s += 20) {
  device.pushErrorScope("validation");
  sim.run(20);
  const st = await sim.readStats();
  const err = await device.popErrorScope();
  if (err) { console.error("validation:", err.message); ok = false; }
  const matter = st.A + st.B + st.C + st.P;
  const cur = await sim.readState();
  const res = ledgerResidual(start, cur);
  events += (await sim.drainLedger()).events.length;
  const line = `step ${st.step}: matter ${matter} (d=${matter - start.matter}) residual ${res} living ${st.living} B ${st.B} P ${st.P}`;
  console.log(line);
  if (matter !== start.matter || res !== 0n) ok = false;
}
console.log(`${STEPS} steps in ${(performance.now() - t1).toFixed(0)} ms; mutation events ${events}; hash ${stateHash(await sim.readState())}; uncaptured ${uncaptured}`);
const snap = await sim.readSnapshot(true);
console.log(`snapshot step ${snap.step}, roles ${snap.roles?.length}, head ${snap.genomeHead.length}`);
const light = await sim.readLight();
let mono = true;
for (let z = 1; z < D; z++) for (let c = 0; c < W * H; c++) if (light[z * W * H + c] > light[(z - 1) * W * H + c]) mono = false;
console.log(`light monotone in z: ${mono}; surface ${light[0]}..${light[W * H - 1]}`);
if (!mono) ok = false;
sim.destroy();
console.log(ok && uncaptured === 0 ? "PASS" : "FAIL");
Deno.exit(ok && uncaptured === 0 ? 0 : 1);
