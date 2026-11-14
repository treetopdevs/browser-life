// Rung 1b M3 timing gate, with the protocol fixed in docs/3d-rung1b-plan-2026-10-23.md §6 (M3):
// slab-spots (plan §5.1) at 256x256x8, seed 101, mu 60, sigma 20, lightK 1024, evolving arm.
// 2,000 warm-up steps, then 5 trials of 1,000 steps, submitted in batches of 100 and timed by wall clock to
// onSubmittedWorkDone. Deciding statistic: median steps/s of the 5 trials (Deno, M3 Pro); gate >= 100.
// Per-pass timestamps are reported for information only.
// Run: deno run -A --no-lock experiments/3d-slab/m3-timing.ts [--json=out.json]
import { GpuSim3, requestDevice3 } from "@bl/sim-gpu";
import { defaultConfig, generalistGenome3, ledgerResidual, slabSpotsWorld, totalsOf } from "@bl/schema";

const cfg = defaultConfig({
  tileW: 256, tileH: 256, tileD: 8, lightK: 1024, kernelRadius: 3, seed: 101,
  defaultMu: 60, defaultSigma: 20, lightMode: "uniform", lightBase: 40, lightAmp: 200,
});
const state = slabSpotsWorld(cfg, generalistGenome3(60, 20), 8, 32, 64); // plan §5.1: 8 balls, nutrient 32, biomass 64
const start = totalsOf(cfg, state.cells);
const adapter = await navigator.gpu.requestAdapter();
const device = await requestDevice3(navigator.gpu, cfg);
const sim = await GpuSim3.create(device, state);
const done = () => device.queue.onSubmittedWorkDone();

const WARM = 2000, TRIALS = 5, STEPS = 1000, BATCH = 100;
for (let s = 0; s < WARM; s += BATCH) sim.run(BATCH);
await done();
await sim.drainLedger();

const rates: number[] = [];
for (let t = 0; t < TRIALS; t++) {
  const t0 = performance.now();
  for (let s = 0; s < STEPS; s += BATCH) sim.run(BATCH);
  await done();
  const sec = (performance.now() - t0) / 1000;
  rates.push(STEPS / sec);
  await sim.drainLedger(); // outside the timed span, as a runner drains per census
  console.log(`trial ${t + 1}: ${(STEPS / sec).toFixed(1)} steps/s (${(sec * 1000).toFixed(0)} ms)`);
}
const sorted = [...rates].sort((a, b) => a - b);
const median = sorted[Math.floor(TRIALS / 2)];

// Informational: per-pass GPU time over 20 profiled steps (affinity, flow, transport, light, react, tick).
let perPass: number[] | null = null;
if (device.features.has("timestamp-query")) {
  const N = 20, cnt = N * 6 * 2;
  const set = device.createQuerySet({ type: "timestamp", count: cnt });
  const res = device.createBuffer({ size: cnt * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  const rd = device.createBuffer({ size: cnt * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  sim.profile = { set, next: 0 };
  const enc = device.createCommandEncoder();
  for (let s = 0; s < N; s++) sim.encodeStep(enc);
  sim.profile = null;
  enc.resolveQuerySet(set, 0, cnt, res, 0);
  enc.copyBufferToBuffer(res, 0, rd, 0, cnt * 8);
  device.queue.submit([enc.finish()]);
  await rd.mapAsync(GPUMapMode.READ);
  const ts = new BigUint64Array(rd.getMappedRange().slice(0));
  rd.unmap();
  perPass = [0, 1, 2, 3, 4, 5].map((k) => {
    const v: number[] = [];
    for (let s = 0; s < N; s++) v.push(Number(ts[(s * 6 + k) * 2 + 1] - ts[(s * 6 + k) * 2]) / 1000);
    v.sort((a, b) => a - b);
    return v[N >> 1];
  });
}
const end = await sim.readState();
const t = totalsOf(cfg, end.cells);
const residual = ledgerResidual(start, end);
const living = (await sim.readStats()).living;
const info = (adapter as unknown as { info?: { description?: string; architecture?: string } }).info;
const out = {
  device: info?.description || info?.architecture || "unknown", step: end.step, trials: rates.map((r) => +r.toFixed(1)),
  medianStepsPerSec: +median.toFixed(1), gate: 100, pass: median >= 100,
  minutesPer300k: +(300000 / median / 60).toFixed(1), perPassMedianUs: perPass?.map((x) => +x.toFixed(1)) ?? null,
  passes: ["affinity", "flow", "transport", "light", "react", "tick"], matterDelta: String(BigInt(t.matter) - BigInt(start.matter)), energyResidual: String(residual), living: String(living),
};
console.log(JSON.stringify(out, null, 2));
console.log(`M3 GATE: median ${median.toFixed(1)} steps/s vs 100 -> ${median >= 100 ? "PASS" : "FAIL"}`);
const j = Deno.args.find((a) => a.startsWith("--json="));
if (j) Deno.writeTextFileSync(j.slice(7), JSON.stringify(out, null, 2) + "\n");
if (BigInt(t.matter) !== BigInt(start.matter) || residual !== 0n) { console.error("CONSERVATION FAILURE"); Deno.exit(1); }
sim.destroy();
