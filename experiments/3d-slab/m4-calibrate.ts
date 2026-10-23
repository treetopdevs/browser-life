// Rung 1b M4 calibration, fixed in docs/3d-rung1b-plan-2026-10-23.md §6 (M4):
//   grid mu ∈ {20,30,40,50,60} × sigma ∈ {8,12,16,20} × lightK ∈ {256,1024,4096}, 50,000 steps, seeds 101-103,
//   evolving arm (condition "treatment") of the slab-spots preset, with the three values as overrides.
// One JSON result per (setting, seed) under --out; a job whose result exists is skipped, so the script resumes and
// two machines can share one queue (--reverse walks it from the other end; results are synced between them).
// A run stops early only on extinction (no living cell: nothing in the rules creates life, so it stays at 0).
// Pick rule (applied by m4-pick.ts, not here): qualify iff all 3 seeds end with 1% <= living <= 50% of cells and
// 5% <= mean light(layer 7) / mean light(layer 0) <= 80%; highest median living wins; ties: larger lightK, larger
// sigma, smaller mu.
// Run: deno run -A --no-lock experiments/3d-slab/m4-calibrate.ts --out=<dir> [--reverse] [--steps=50000] [--only=<job>]
import { GpuSim3, requestDevice3 } from "@bl/sim-gpu";
import { cellCount, initWorld, ledgerResidual, presetById, presetConfig, totalsOf } from "@bl/schema";

const arg = (k: string) => Deno.args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = arg("out") ?? "runs/m4-calibration";
const STEPS = Number(arg("steps") ?? 50000);
const MUS = [20, 30, 40, 50, 60], SIGMAS = [8, 12, 16, 20], KS = [256, 1024, 4096], SEEDS = [101, 102, 103];
type Job = { id: string; mu: number; sigma: number; lightK: number; seed: number };
const jobs: Job[] = [];
for (const lightK of KS) for (const sigma of SIGMAS) for (const mu of MUS) for (const seed of SEEDS)
  jobs.push({ id: `mu${mu}-s${sigma}-k${lightK}-seed${seed}`, mu, sigma, lightK, seed });
if (Deno.args.includes("--reverse")) jobs.reverse();
const only = arg("only");
Deno.mkdirSync(OUT, { recursive: true });
const exists = (p: string) => { try { Deno.statSync(p); return true; } catch { return false; } };

const preset = presetById("slab-spots")!;
const adapter = await navigator.gpu.requestAdapter();
const info = (adapter as unknown as { info?: { description?: string } }).info;
const host = Deno.hostname();
let device: GPUDevice | null = null;

for (const j of jobs) {
  if (only && j.id !== only) continue;
  const file = `${OUT}/${j.id}.json`;
  if (exists(file)) continue;
  const cfg = presetConfig(preset, j.seed, { defaultMu: j.mu, defaultSigma: j.sigma, lightK: j.lightK });
  const state = initWorld(cfg, preset.init);
  const start = totalsOf(cfg, state.cells);
  device ??= await requestDevice3(navigator.gpu, cfg);
  const sim = await GpuSim3.create(device, state);
  const t0 = performance.now();
  let living = 0, extinctAt: number | null = null;
  const trace: number[] = [];
  for (let s = 0; s < STEPS; s += 1000) {
    const n = Math.min(1000, STEPS - s);
    for (let b = 0; b < n; b += 100) sim.run(Math.min(100, n - b));
    await sim.drainLedger();
    living = (await sim.readStats()).living;
    if ((s + n) % 5000 === 0) trace.push(living);
    if (living === 0) { extinctAt = s + n; break; }
  }
  const sec = (performance.now() - t0) / 1000;
  const W = cfg.tileW, H = cfg.tileH, D = cfg.tileD!, plane = W * H;
  const L = await sim.readLight();
  const layerMean = Array.from({ length: D }, (_, z) => { let a = 0; for (let i = z * plane; i < (z + 1) * plane; i++) a += L[i]; return a / plane; });
  const end = await sim.readState();
  const t = totalsOf(cfg, end.cells);
  const residual = ledgerResidual(start, end);
  sim.destroy();
  const cells = cellCount(cfg);
  const res = {
    ...j, step: end.step, steps: STEPS, extinctAt, living, livingFrac: living / cells,
    lightLayerMean: layerMean.map((x) => +x.toFixed(3)), lightRatio: layerMean[0] > 0 ? layerMean[D - 1] / layerMean[0] : null,
    livingTrace5k: trace, seconds: +sec.toFixed(1), stepsPerSec: +((end.step) / sec).toFixed(1),
    matterOk: BigInt(t.matter) === BigInt(start.matter), energyResidual: String(residual), host, device: info?.description ?? "unknown",
  };
  Deno.writeTextFileSync(`${file}.tmp`, JSON.stringify(res, null, 2) + "\n");
  Deno.renameSync(`${file}.tmp`, file);
  console.log(`${j.id}: living ${(100 * res.livingFrac).toFixed(1)}% light7/0 ${res.lightRatio?.toFixed(3)} ${extinctAt ? `EXTINCT@${extinctAt} ` : ""}${res.stepsPerSec} steps/s${res.matterOk && residual === 0n ? "" : " CONSERVATION FAILURE"}`);
  if (!res.matterOk || residual !== 0n) Deno.exit(1);
}
console.log("queue done");
