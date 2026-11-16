// Step A1 of the 3D plan (docs/3d-expansion-plan-2026-11-15.md, Phase 1, "jar shapes and their own calibration"):
// timing of jar shapes, a light screen of the 64-cube jar, and long runs of the 8-layer M4b canopy. Exploration, judged
// by eye plus descriptive numbers: no gate, no pass/fail window. Every run is slab-spots (eight generalist balls of
// radius 3, biomass 64, uniform light 240) with the shape, nutrient, mu, sigma and lightK as overrides.
//
//   --mode=time   --shape=64x64x64   the rung 1b M3 protocol (m3-timing.ts) on a shape: 2,000 warm-up steps, then
//                                    5 trials of 1,000 steps in batches of 100, wall clock to onSubmittedWorkDone
//   --mode=screen                    lightK {256, 1024, 4096, 16384} x nutrient {12, 24} at 64^3, mu 50, sigma 8,
//                                    seed 101 (--seeds=101,102 and --only=<setting key> for the second seed)
//   --mode=long                      256 x 256 x 8, nutrient 12, mu 50, sigma 8, lightK 64, seeds 101-103
//
// Results go under --out (default runs/jar-light-screen or runs/jar-canopy-long). A screen result that exists is
// skipped; a long run appends one JSON line per 10,000 steps to <id>.jsonl so a crash loses at most 10k steps (a long
// run whose file ends at its last step is skipped). A conservation failure stops with exit 1.
//
// Run: deno run -A --no-lock experiments/3d-slab/jar-screen.ts --mode=<time|screen|long> [--steps=<n>] [--out=<dir>]
import { GpuSim3, requestDevice3 } from "@bl/sim-gpu";
import { CH, G, RULE_VERSION, cellCount, initWorld, ledgerResidual, lowbias32, draw, presetById, presetConfig, totalsOf, type InitParams, type WorldConfig } from "@bl/schema";

const arg = (k: string) => Deno.args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const mode = arg("mode");
const preset = presetById("slab-spots")!;
if (preset.init.kind !== "slab-spots") throw new Error("slab-spots preset changed");

interface Job { id: string; W: number; H: number; D: number; nutrient: number; mu: number; sigma: number; lightK: number; seed: number }
const cfgOf = (j: Job): WorldConfig => presetConfig(preset, j.seed, { tileW: j.W, tileH: j.H, tileD: j.D, defaultMu: j.mu, defaultSigma: j.sigma, lightK: j.lightK });
const initOf = (j: Job): InitParams => ({ ...preset.init, nutrient: j.nutrient });
const key = (j: Omit<Job, "id" | "seed">) => `${j.W}x${j.H}x${j.D}-n${j.nutrient}-mu${j.mu}-s${j.sigma}-k${j.lightK}`;
const mkJob = (j: Omit<Job, "id">): Job => ({ ...j, id: `${key(j)}-seed${j.seed}` });
/** The founders' z, as slabSpotsWorld places them (world3.ts). */
const founderZ = (cfg: WorldConfig, count: number) => Array.from({ length: count }, (_, i) => draw(lowbias32(cfg.seed * 313 + i), 7) % cfg.tileD!);

const adapter = await navigator.gpu.requestAdapter();
const info = (adapter as unknown as { info?: { description?: string } }).info;
const loadavg = () => { try { return Deno.loadavg().map((x) => +x.toFixed(0)); } catch { return null; } };

/**
 * Per-layer living, mass, nutrient, light (over all cells and over living cells) and activity (the four role counts of
 * the last step), from one end-of-run readback, plus a side view: bound mass B + P summed over y for each (x, z).
 */
async function layers(sim: GpuSim3, cfg: WorldConfig) {
  const n = cellCount(cfg), W = cfg.tileW, D = cfg.tileD!, plane = n / D;
  const [L, roles, snap] = [await sim.readLight(), await sim.readRoles(), await sim.readSnapshot(false)];
  const zeros = () => new Array(D).fill(0);
  const living = zeros(), mass = zeros(), nutrientByLayer = zeros(), light = zeros(), lightLiving = zeros(), activity = zeros();
  const side = new Array(W * D).fill(0);
  for (let i = 0; i < n; i++) {
    const z = Math.floor(i / plane);
    light[z] += L[i];
    const m = snap.cells[CH.B * n + i] + snap.cells[CH.P * n + i];
    if ((snap.genomeHead[G.LIN_HI * n + i] | snap.genomeHead[G.LIN_LO * n + i]) !== 0) { living[z]++; lightLiving[z] += L[i]; }
    mass[z] += m;
    nutrientByLayer[z] += snap.cells[CH.A * n + i];
    side[z * W + (i % W)] += m;
    const w0 = roles[2 * i], w1 = roles[2 * i + 1];
    activity[z] += (w0 & 0xffff) + (w0 >>> 16) + (w1 & 0xffff) + (w1 >>> 16);
  }
  return { plane, living, mass, nutrientByLayer, light, lightLiving, activity, side };
}

if (mode === "time") {
  const [W, H, D] = (arg("shape") ?? "64x64x64").split("x").map(Number);
  // The M3 protocol's world: mu 60, sigma 20, nutrient 32; lightK from --lightK (default 4096, the rung 2 plan's J2).
  const j = mkJob({ W, H, D, nutrient: 32, mu: 60, sigma: 20, lightK: Number(arg("lightK") ?? 4096), seed: 101 });
  const cfg = cfgOf(j);
  const state = initWorld(cfg, initOf(j));
  const start = totalsOf(cfg, state.cells);
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
    await sim.drainLedger();
    console.log(`trial ${t + 1}: ${(STEPS / sec).toFixed(1)} steps/s`);
  }
  const median = [...rates].sort((a, b) => a - b)[TRIALS >> 1];
  const end = await sim.readState();
  const residual = ledgerResidual(start, end);
  const matterOk = BigInt(totalsOf(cfg, end.cells).matter) === BigInt(start.matter);
  const out = { job: j, cells: cellCount(cfg), device: info?.description ?? "unknown", loadavg: loadavg(), trials: rates.map((r) => +r.toFixed(1)), medianStepsPerSec: +median.toFixed(1), cellStepsPerSec: +(median * cellCount(cfg)).toExponential(3), matterOk, energyResidual: String(residual), living: (await sim.readStats()).living };
  console.log(JSON.stringify(out));
  const o = arg("json");
  if (o) Deno.writeTextFileSync(o, JSON.stringify(out, null, 2) + "\n");
  sim.destroy();
  if (!matterOk || residual !== 0n) { console.error("CONSERVATION FAILURE"); Deno.exit(1); }
} else if (mode === "screen") {
  const OUT = arg("out") ?? "runs/jar-light-screen";
  const steps = Number(arg("steps") ?? 30_000);
  const seeds = (arg("seeds") ?? "101").split(",").map(Number);
  const only = arg("only")?.split(",");
  Deno.mkdirSync(OUT, { recursive: true });
  const jobs: Job[] = [];
  for (const lightK of [256, 1024, 4096, 16384]) for (const nutrient of [12, 24]) for (const seed of seeds) jobs.push(mkJob({ W: 64, H: 64, D: 64, nutrient, mu: 50, sigma: 8, lightK, seed }));
  let device: GPUDevice | null = null;
  for (const j of jobs) {
    if (only && !only.includes(key(j))) continue;
    const file = `${OUT}/${j.id}.json`;
    let existing: { requestedSteps?: number } | null = null;
    try { existing = JSON.parse(Deno.readTextFileSync(file)); } catch { /* not run yet */ }
    if (existing) {
      if (existing.requestedSteps !== steps) throw new Error(`${file} holds a ${existing.requestedSteps}-step run, not ${steps}: move it or use another --out`);
      console.log(`${j.id}: exists (${steps} steps), skipped`);
      continue;
    }
    const cfg = cfgOf(j);
    const state = initWorld(cfg, initOf(j));
    const start = totalsOf(cfg, state.cells);
    device ??= await requestDevice3(navigator.gpu, cfg);
    const sim = await GpuSim3.create(device, state);
    const n = cellCount(cfg);
    const trace5k: number[] = [];
    let extinctAt: number | null = null;
    const t0 = performance.now();
    for (let s = 0; s < steps; s += 1000) {
      for (let b = 0; b < 1000; b += 100) sim.run(100);
      await sim.drainLedger();
      const st = await sim.readStats();
      if ((s + 1000) % 5000 === 0) trace5k.push(st.living);
      if (st.living === 0) { extinctAt = s + 1000; break; }
    }
    const sec = (performance.now() - t0) / 1000;
    const lay = await layers(sim, cfg);
    const end = await sim.readState();
    const residual = ledgerResidual(start, end);
    const matterOk = BigInt(totalsOf(cfg, end.cells).matter) === BigInt(start.matter);
    sim.destroy();
    const res = {
      ...j, ruleVersion: RULE_VERSION, cfg, init: initOf(j), founderZ: founderZ(cfg, preset.init.founders ?? 8), requestedSteps: steps, step: end.step, extinctAt,
      livingFrac: lay.living.reduce((a, b) => a + b, 0) / n, livingTrace5k: trace5k, ...lay,
      matterOk, energyResidual: String(residual), seconds: +sec.toFixed(1), stepsPerSec: +(end.step / sec).toFixed(1), loadavg: loadavg(), device: info?.description ?? "unknown",
    };
    Deno.writeTextFileSync(file, JSON.stringify(res) + "\n");
    console.log(`${j.id}: living ${(100 * res.livingFrac).toFixed(1)}% floor/top light ${(lay.light[63] / Math.max(1, lay.light[0])).toFixed(3)} ${res.stepsPerSec} steps/s${matterOk && residual === 0n ? "" : " CONSERVATION FAILURE"}`);
    if (!matterOk || residual !== 0n) Deno.exit(1);
  }
  console.log("screen done");
} else if (mode === "long") {
  const OUT = arg("out") ?? "runs/jar-canopy-long";
  const steps = Number(arg("steps") ?? 150_000);
  const seeds = (arg("seeds") ?? "101,102,103").split(",").map(Number);
  Deno.mkdirSync(OUT, { recursive: true });
  let device: GPUDevice | null = null;
  for (const seed of seeds) {
    const j = mkJob({ W: 256, H: 256, D: 8, nutrient: 12, mu: 50, sigma: 8, lightK: 64, seed });
    const file = `${OUT}/${j.id}.jsonl`;
    let prior: string[] = [];
    try { prior = Deno.readTextFileSync(file).trim().split("\n").filter(Boolean); } catch { /* new */ }
    if (prior.length && JSON.parse(prior.at(-1)!).step >= steps) { console.log(`${j.id}: done, skipped`); continue; }
    if (prior.length) { console.error(`${file} is partial; move it away to rerun`); Deno.exit(2); }
    const cfg = cfgOf(j);
    const state = initWorld(cfg, initOf(j));
    const start = totalsOf(cfg, state.cells);
    device ??= await requestDevice3(navigator.gpu, cfg);
    const sim = await GpuSim3.create(device, state);
    const n = cellCount(cfg);
    Deno.writeTextFileSync(file, JSON.stringify({ header: true, ...j, cfg, init: initOf(j), founderZ: founderZ(cfg, 8), ruleVersion: RULE_VERSION, device: info?.description ?? "unknown" }) + "\n");
    const t0 = performance.now();
    let trace1k: number[] = [];
    for (let s = 0; s < steps; s += 1000) {
      for (let b = 0; b < 1000; b += 100) sim.run(100);
      await sim.drainLedger();
      const st = await sim.readStats();
      trace1k.push(st.living);
      if ((s + 1000) % 10_000 === 0 || st.living === 0) {
        const lay = await layers(sim, cfg);
        const end = await sim.readState();
        const residual = ledgerResidual(start, end);
        const matterOk = BigInt(totalsOf(cfg, end.cells).matter) === BigInt(start.matter);
        const row = {
          step: end.step, living: st.living, livingFrac: st.living / n, dense: st.dense, living1k: trace1k, livingByLayer: lay.living, massByLayer: lay.mass,
          lightByLayer: lay.light, activityByLayer: lay.activity, matterOk, energyResidual: String(residual), seconds: +((performance.now() - t0) / 1000).toFixed(1), loadavg: loadavg(),
        };
        trace1k = [];
        Deno.writeTextFileSync(file, JSON.stringify(row) + "\n", { append: true });
        console.log(`${j.id} step ${row.step}: living ${(100 * row.livingFrac).toFixed(2)}% by layer ${lay.living.map((v) => (100 * v / lay.plane).toFixed(0)).join("/")}`);
        if (!matterOk || residual !== 0n) { console.error("CONSERVATION FAILURE"); Deno.exit(1); }
        if (st.living === 0) break;
      }
    }
    sim.destroy();
  }
  console.log("long runs done");
} else throw new Error("--mode must be time, screen or long");
