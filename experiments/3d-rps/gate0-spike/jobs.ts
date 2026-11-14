// From a planned job (plan.ts) to what the harness runs: the KernelJobSpec of a two-phase job, and the mobility-meter job of G0.2
// (an inert stripe world, no burn-in, no census). Pure and simulator-agnostic: the simulator comes in through the SimFactory, so the
// tests run these on the CPU reference and the driver on the spike's GPU simulator.
import { rpsLabels, labelMixingW } from "@bl/metrics";
import { stateHash, worldH, worldW, type WorldState } from "@bl/schema";
import {
  KernelJobError,
  assertConserved,
  baselineOf,
  checkFounding,
  conservationOf,
  jobDir,
  jobExists,
  publishJob,
  publishMissing,
  retainLostRace,
  stopRule15,
  withRetry,
  type KernelJobDeps,
  type KernelJobResult,
  type KernelJobSpec,
  type KernelSim,
} from "../lib/kernel-job.ts";
import type { JobDef } from "./plan.ts";
import { RUNGS, jobConfig, killSettings, meterConfig, mixParams } from "./rungs.ts";
import { rpsMix, stripeWorld } from "./world.ts";

/** InitParams of the rps-mix founding, as summary.json records them. */
export function initOf(d: Pick<JobDef, "substrate">): Record<string, unknown> {
  const m = mixParams(d.substrate);
  return { kind: "rps-mix", founders: m.K0, occupied: m.occupied, nutrient: m.nutrient, biomass: m.biomass, columns: m.columns };
}

/**
 * The two-phase job of a planned run job: the rung's config at the job's spread and seed, the rps-mix founding, a burn-in at rate 0
 * and the run at the job's rate, with the early stop of 1.5. `mode` ("gate0" or "rehearsal") and `extra` go into summary.json.
 */
export function runSpecOf(d: JobDef, mode: string, extra: Record<string, unknown> = {}): KernelJobSpec {
  if (d.kind !== "run") throw new Error(`${d.id}: not a run job`);
  const cfg = jobConfig(d.substrate, d.shape, d.spread, d.seed);
  const mix = mixParams(d.substrate);
  const init = initOf(d);
  return {
    id: d.id,
    stage: d.stage,
    seed: d.seed,
    K0: mix.K0,
    found: () => rpsMix(cfg, mix),
    burn: { settings: killSettings(d.kill, 0, d.substrate), init },
    run: { cfg, settings: killSettings(d.kill, d.rate, d.substrate), init },
    runSteps: d.runSteps,
    stop: stopRule15,
    // 1.5: a job whose burn-in ends in NOSTART stops at the hand-over census (the readout excludes it from every count)
    nostartStop: true,
    summary: { rung: d.rung, kill: d.kill, substrate: d.substrate, spread: d.spread, rpsRate: d.rate, rpsMin: RUNGS[d.substrate].rpsMin, rpsTypes: mix.K0, shape: [...d.shape], mode, ...extra },
  };
}

export interface MeterDeps extends Pick<KernelJobDeps, "makeSim" | "host" | "device" | "clock" | "log"> {}

/**
 * G0.2 / 3.1: one meter job, the x- or y-stripes of one spread. The inert stripe world is run for `d.runSteps` (5,000) steps with
 * every rate constant and `dtQ` at 0; the interface width is `W = sum over lines of m (1 - m)` (the census module's `labelMixingW`)
 * and the readout turns it into `D = pi W^2 / (8 t)`. Matter and the energy residual are checked at the end. No census.tsv.
 * Retries and failure markers as for any job (1.3).
 */
export async function runMeterJob(d: JobDef, deps: MeterDeps, outDir: string, mode: string, extra: Record<string, unknown> = {}): Promise<KernelJobResult> {
  if (d.kind !== "meter" || d.axis === undefined || d.bMeter === undefined) throw new Error(`${d.id}: not a meter job`);
  const axis = d.axis;
  const bMeter = d.bMeter;
  const dir = jobDir(outDir, d.id);
  if (jobExists(outDir, d.id)) return { status: "exists", dir };
  const cfg = meterConfig(d.substrate, d.shape, d.spread, d.seed);
  const settings = killSettings(d.kill, 0, d.substrate);
  const init = { kind: "stripes", axis, bMeter, labels: [0, 1] };
  const clock = deps.clock ?? (() => performance.now());
  const base = {
    ...extra,
    id: d.id,
    stage: d.stage,
    rung: d.rung,
    kill: d.kill,
    substrate: d.substrate,
    seed: d.seed,
    spread: d.spread,
    rpsRate: 0,
    shape: [...d.shape],
    mode,
    config: { run: { ...cfg, ...settings } },
    init: { run: init },
    host: deps.host,
    device: deps.device,
  };
  const r = await withRetry(
    d.id,
    async (attempt) => {
      const state0: WorldState = stripeWorld(cfg, axis, bMeter);
      checkFounding(state0, "");
      const baseline = baselineOf(state0);
      let sim: KernelSim | null = null;
      try {
        sim = await deps.makeSim({ jobId: d.id, attempt, phase: "run", cfg, settings }, state0);
        const t0 = clock();
        await sim.run(d.runSteps);
        const read = await sim.census();
        const seconds = (clock() - t0) / 1000;
        if (read.step !== d.runSteps) throw new KernelJobError("invariant", `meter census at step ${read.step}, expected ${d.runSteps}`, read.step, {}, "");
        assertConserved(baseline, conservationOf(cfg, baseline, read), read.step, "");
        const dims = { W: worldW(cfg), H: worldH(cfg), D: cfg.tileD ?? 1 };
        const W = labelMixingW(rpsLabels(read, dims), dims, axis);
        const end = await sim.readState();
        return {
          ...base,
          steps: d.runSteps,
          stop: "end",
          meter: { axis, W, t: d.runSteps, bMeter },
          stepsPerSec: Math.round((d.runSteps / Math.max(1e-9, seconds)) * 10) / 10,
          seconds: Math.round(seconds * 10) / 10,
          matterOk: true,
          residual: "0",
          endHash: stateHash(end),
          attempts: attempt,
        } as Record<string, unknown>;
      } finally {
        try {
          sim?.destroy();
        } catch {
          // not a second failure
        }
      }
    },
    { log: deps.log },
  );
  if (r.ok) {
    // the failures of earlier attempts stay in the summary (`retried`), as for a two-phase job
    const summary = r.failures.length > 0 ? { ...r.value, retried: r.failures } : r.value;
    if (publishJob(outDir, d.id, { "summary.json": `${JSON.stringify(summary, null, 2)}\n` })) return { status: "done", dir, summary };
    // another process published the job first: its files stand, and the failures behind our rerun are kept and stop the stage (D22)
    retainLostRace(outDir, d.id, r.failures, summary);
    return { status: "exists", dir };
  }
  return publishMissing(outDir, d.id, base, r.failures, r.partialCensus) ? { status: "missing", dir, failures: r.failures } : { status: "exists", dir };
}
