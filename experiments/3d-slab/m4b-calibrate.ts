// Rung 1b M4b calibration (docs/3d-rung1b-plan-2026-10-23.md, "Amendment 2026-10-24: re-rule M4 with nutrient per
// cell as the knob"). The grid and job ids come from m4b-rule.ts: nutrient {8,12,16,20,24} x mu {30,40,50,60} x
// sigma {8,16} x lightK {64,256}, seeds 101-103, 50,000 steps, slab-spots with nutrient as an init override and mu,
// sigma, lightK as config overrides. m4-calibrate.ts is left as it was, so the M4 results stay reproducible.
//
// One JSON result per job under --out (default runs/m4b-calibration). A job whose result file exists is skipped only
// if the stored job description matches; a mismatch stops the queue (exit 2) and is never overwritten. Two machines
// can share one queue (--reverse walks it from the other end; results are synced between them). A run stops early
// only on extinction. A conservation failure stops the queue (exit 1). Neutral runs (the neutral stage) are run with
// --condition=neutral --jobs=<ids printed by m4b-pick.ts>.
//
// Run: deno run -A --no-lock experiments/3d-slab/m4b-calibrate.ts [--out=<dir>] [--reverse] [--condition=neutral --jobs=a,b]
//      [--only=<job id>] [--steps=<n>, for smoke tests only: the picker refuses results that are not 50,000 steps]
import { GpuSim3, requestDevice3 } from "@bl/sim-gpu";
import { G, cellCount, initWorld, ledgerResidual, presetById, RULE_VERSION, totalsOf, CH } from "@bl/schema";
import { CELLS, D, expectedConfig, expectedInit, gridSettings, jobsFor, PLANE, PRESET_ID, RULE_VERSION as RULE_EXPECTED, STEPS, validate, type Condition, type Job } from "./m4b-rule.ts";

const arg = (k: string) => Deno.args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = arg("out") ?? "runs/m4b-calibration";
const steps = Number(arg("steps") ?? STEPS);
if (!Number.isSafeInteger(steps) || steps <= 0 || steps % 1000 !== 0) throw new Error(`--steps must be a positive multiple of 1000, got ${arg("steps")}`);
const condition = (arg("condition") ?? "treatment") as Condition;
if (condition !== "treatment" && condition !== "neutral") throw new Error(`--condition must be treatment or neutral`);
if (RULE_VERSION !== RULE_EXPECTED) throw new Error(`RULE_VERSION is ${RULE_VERSION}; the M4b rule was fixed at ${RULE_EXPECTED}`);

let jobs: Job[] = jobsFor(condition, gridSettings());
const wanted = arg("jobs")?.split(",").filter(Boolean);
if (wanted) {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const bad = wanted.filter((id) => !byId.has(id));
  if (bad.length) throw new Error(`not ${condition} jobs of the M4b grid: ${bad.join(", ")}`);
  jobs = wanted.map((id) => byId.get(id)!);
} else if (condition === "neutral") throw new Error("neutral runs need --jobs (the neutral stage's ids, from m4b-pick.ts)");
if (Deno.args.includes("--reverse")) jobs.reverse();
const only = arg("only");
Deno.mkdirSync(OUT, { recursive: true });
/** The parsed file, `undefined` only when there is no file; unparseable text comes back as a string (and fails validation). */
const readJson = (p: string): unknown => {
  let text: string;
  try { text = Deno.readTextFileSync(p); } catch (e) { if (e instanceof Deno.errors.NotFound) return undefined; throw e; }
  try { return JSON.parse(text); } catch { return `unparseable: ${text.slice(0, 80)}`; }
};

const preset = presetById(PRESET_ID)!;
if (preset.init.kind !== "slab-spots") throw new Error("slab-spots preset changed");
const adapter = await navigator.gpu.requestAdapter();
const info = (adapter as unknown as { info?: { description?: string } }).info;
const host = Deno.hostname();
let device: GPUDevice | null = null;

for (const j of jobs) {
  if (only && j.id !== only) continue;
  const file = `${OUT}/${j.id}.json`;
  // An existing result (ours from an earlier run, or synced from the other machine) is skipped only if it is a valid
  // result of exactly this job; anything else stops the queue and is never overwritten.
  const existing = (): boolean => {
    const old = readJson(file);
    if (old === undefined) return false;
    const errs = validate(old, j, steps);
    if (errs.length) { console.error(`${file} exists but is not a valid result of this job; stopping (never overwritten):\n  ${errs.join("\n  ")}`); Deno.exit(2); }
    return true;
  };
  if (existing()) continue;
  const cfg = expectedConfig(j);
  const init = expectedInit(j);
  const state = initWorld(cfg, init);
  const start = totalsOf(cfg, state.cells);
  device ??= await requestDevice3(navigator.gpu, cfg);
  const sim = await GpuSim3.create(device, state);
  const t0 = performance.now();
  let living = 0, extinctAt: number | null = null;
  const trace: number[] = [], dense: number[] = [];
  for (let s = 0; s < steps; s += 1000) {
    for (let b = 0; b < 1000; b += 100) sim.run(100);
    await sim.drainLedger();
    const st = await sim.readStats();
    living = st.living;
    if ((s + 1000) % 5000 === 0) { trace.push(st.living); dense.push(st.dense); }
    if (living === 0) { extinctAt = s + 1000; break; }
  }
  const sec = (performance.now() - t0) / 1000;
  const L = await sim.readLight();
  const roles = await sim.readRoles();
  const end = await sim.readState();
  const t = totalsOf(cfg, end.cells);
  const residual = ledgerResidual(start, end);
  sim.destroy();
  const n = cellCount(cfg);
  if (n !== CELLS) throw new Error(`cell count ${n}, the rule expects ${CELLS}`);
  const lightLayerSum = new Array(D).fill(0), livingByLayer = new Array(D).fill(0), massByLayer = new Array(D).fill(0), activityByLayer = new Array(D).fill(0);
  for (let i = 0; i < n; i++) {
    const z = Math.floor(i / PLANE);
    lightLayerSum[z] += L[i];
    if ((end.genome[G.LIN_HI * n + i] | end.genome[G.LIN_LO * n + i]) !== 0) livingByLayer[z]++;
    massByLayer[z] += end.cells[CH.B * n + i] + end.cells[CH.P * n + i];
    const w0 = roles[2 * i], w1 = roles[2 * i + 1];
    activityByLayer[z] += (w0 & 0xffff) + (w0 >>> 16) + (w1 & 0xffff) + (w1 >>> 16);
  }
  const res = {
    id: j.id, condition, neutral: condition === "neutral", presetId: PRESET_ID, init, cfg, ruleVersion: RULE_VERSION,
    nutrient: j.nutrient, mu: j.mu, sigma: j.sigma, lightK: j.lightK, seed: j.seed,
    requestedSteps: steps, step: end.step, extinctAt, living, livingFrac: living / n,
    livingTrace5k: trace, denseTrace5k: dense, lightLayerSum, lightRatio: lightLayerSum[0] > 0 ? lightLayerSum[D - 1] / lightLayerSum[0] : null,
    livingByLayer, massByLayer, activityByLayer,
    matterOk: BigInt(t.matter) === BigInt(start.matter), energyResidual: String(residual),
    seconds: +sec.toFixed(1), stepsPerSec: +(end.step / sec).toFixed(1), host, device: info?.description ?? "unknown",
  };
  const own = validate(JSON.parse(JSON.stringify(res)), j, steps);
  if (own.length) { console.error(`${j.id}: this run's own result fails validation:\n  ${own.join("\n  ")}`); Deno.exit(1); }
  // Publish without replacing: a unique temporary, then a hard link that fails if the result already exists
  // (the other machine finished the same job while this one ran: keep theirs if it is valid).
  const tmp = `${file}.${host}.${Deno.pid}.tmp`;
  Deno.writeTextFileSync(tmp, JSON.stringify(res, null, 2) + "\n");
  try { Deno.linkSync(tmp, file); } catch (err) { if (!(err instanceof Deno.errors.AlreadyExists)) throw err; Deno.removeSync(tmp); existing(); console.log(`${j.id}: already finished elsewhere; kept that result`); continue; }
  Deno.removeSync(tmp);
  console.log(`${j.id}: living ${(100 * res.livingFrac).toFixed(1)}% dense ${dense.at(-1) ?? "-"} light7/0 ${res.lightRatio?.toFixed(3)} ${extinctAt ? `EXTINCT@${extinctAt} ` : ""}${res.stepsPerSec} steps/s${res.matterOk && residual === 0n ? "" : " CONSERVATION FAILURE"}`);
  if (!res.matterOk || residual !== 0n) Deno.exit(1);
}
console.log("queue done");
