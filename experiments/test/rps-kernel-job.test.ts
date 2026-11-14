// Tests of the two-phase kernel job (experiments/3d-rps/lib/kernel-job.ts): rule draft 1.3, 1.5 and Appendix B. Two kinds of
// simulator stand in for the spike, so the harness is tested without it: a scripted one (labels are a function of the step, so every
// stop rule, fault and file format can be hit exactly and fast) and the CPU reference RefSim3 on a plain slab with no RPS keys
// (hand-over exactness, determinism, conservation on the real rules; a few tens of steps, seeds 900 and up). Nothing here is a result.

import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { RPS_CENSUS_HEADER, RPS_CENSUS_COLUMNS, parseRpsCensusTsv, parseRpsFinal } from "@bl/metrics";
import { CH, FLUX_COUNT, G, GENOME_CHANNELS3, MATTER_MAX, MOT_ZERO3, POOL_MAX3, buildWorld3, defaultConfig, generalistGenome3, stateHash, totalsOf, type WorldConfig, type WorldState } from "@bl/schema";
import { RefSim3 } from "@bl/sim-ref";
import { refCfg, refFactory as refSimFactory } from "./rps-ref-sim.ts";
import {
  LOST_RACE_PREFIX,
  StageStop,
  checkFounding,
  cleanStaleTmp,
  executeKernelJob,
  foundingProblems,
  jobExists,
  publishJob,
  publishMissing,
  readSummary,
  retainLostRace,
  stopNever,
  stopRule15,
  stopRule72a,
  type CensusRead,
  type JobFailure,
  type KernelJobDeps,
  type KernelJobSpec,
  type KernelSim,
  type RunPoint,
  type SimFactory,
} from "../3d-rps/lib/kernel-job.ts";
import { B_IN, Problems, analyzeRun, canonicalJson, jobBugs } from "../3d-rps/readout-jobs.ts";
import { loadJobs, nodeIo } from "../3d-rps/readout.ts";
import { diskIo, stageStops } from "../3d-rps/gate0-spike/driver.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rps-kernel-job-"));
let dirCounter = 0;
const freshDir = (): string => path.join(tmpRoot, `d${dirCounter++}`);
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

// ---------------------------------------------------------------------------------------------------------------------
// The stop rules
// ---------------------------------------------------------------------------------------------------------------------

const pt = (rstep: number, o: Partial<RunPoint> = {}): RunPoint => ({ rstep, liv: 0.9, coexist: true, n: 3, ...o });
const hist = (...flags: (Partial<RunPoint> | undefined)[]): RunPoint[] => flags.map((f, k) => pt(1000 * (k + 1), f));

describe("1.5 early stop (stopRule15)", () => {
  it("does not stop while every label is present", () => {
    expect(stopRule15(hist(undefined, undefined, undefined, undefined))).toBeNull();
  });
  it("stops at the census that completes three in a row without coexist, not at two", () => {
    const lost = { coexist: false };
    expect(stopRule15(hist(undefined, lost, lost))).toBeNull();
    expect(stopRule15(hist(undefined, lost, lost, lost))).toBe("loss");
    expect(stopRule15(hist(lost, lost, lost))).toBe("loss");
  });
  it("a census with coexist resets the count", () => {
    const lost = { coexist: false };
    expect(stopRule15(hist(lost, lost, undefined, lost, lost))).toBeNull();
    expect(stopRule15(hist(lost, lost, undefined, lost, lost, lost))).toBe("loss");
  });
  it("stops at an EXT census (liv < 0.01), and EXT wins over a loss completing at the same census", () => {
    expect(stopRule15(hist(undefined, { liv: 0.0099, coexist: false, n: 0 }))).toBe("ext");
    expect(stopRule15(hist(undefined, { liv: 0.01 }))).toBeNull();
    const lost = { coexist: false };
    expect(stopRule15(hist(lost, lost, { liv: 0, coexist: false, n: 0 }))).toBe("ext");
  });
  it("has nothing to say before the first run census", () => {
    expect(stopRule15([])).toBeNull();
    expect(stopNever(hist({ liv: 0, coexist: false }))).toBeNull();
  });
});

describe("7.2a early stop (stopRule72a)", () => {
  const mono = { n: 1, coexist: false };
  it("arms Z, A and W stop at the third consecutive census with n_c <= 1 (MONO)", () => {
    for (const arm of ["Z", "A", "W"] as const) {
      expect(stopRule72a(arm)(hist(mono, mono))).toBeNull();
      expect(stopRule72a(arm)(hist(mono, mono, mono))).toBe("mono");
      expect(stopRule72a(arm)(hist(mono, undefined, mono, mono))).toBeNull();
      expect(stopRule72a(arm)(hist({ n: 0, coexist: false }, mono, { n: 1 }))).toBe("mono");
    }
  });
  it("MONO needs n_c <= 1: three censuses in a row with two labels do not stop arms Z, A and W (conformance F11, h04)", () => {
    const two = { n: 2, coexist: false };
    for (const arm of ["Z", "A", "W"] as const) {
      expect(stopRule72a(arm)(hist(two, two, two))).toBeNull();
      expect(stopRule72a(arm)(hist(two, two, two, two, two))).toBeNull();
      // ... and a census with one label among them does not complete a run of three
      expect(stopRule72a(arm)(hist({ n: 1 }, two, { n: 1 }))).toBeNull();
    }
  });
  it("arms B, C and N run to the end: a type change can bring a label back", () => {
    for (const arm of ["B", "C", "N"] as const) expect(stopRule72a(arm)(hist(mono, mono, mono, mono))).toBeNull();
  });
  it("every arm stops at an EXTINCT census", () => {
    for (const arm of ["Z", "A", "B", "C", "N", "W"] as const) expect(stopRule72a(arm)(hist(undefined, { liv: 0.005, n: 0, coexist: false }))).toBe("ext");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// A scripted simulator: labels are a function of the step
// ---------------------------------------------------------------------------------------------------------------------

const W = 16;
const H = 16;
const D = 4;
const N = W * H * D;
const slabConfig = (seed: number, o: Partial<WorldConfig> = {}): WorldConfig =>
  defaultConfig({ kernelRadius: 3, tileD: D, tileW: W, tileH: H, lightK: 1024, lightMode: "uniform", mutRate: 0, seed, ...o });

type Labels = Int8Array;

/** Cells and genome words for a label field: a living cell has B 10 and a lineage, a dead one has C 10 (so matter is 10 per cell whatever the labels). */
function arraysOf(labels: Labels, badMirror = false): { cells: Uint32Array; genome: Uint32Array } {
  const cells = new Uint32Array(7 * N);
  const genome = new Uint32Array(GENOME_CHANNELS3 * N);
  for (let i = 0; i < N; i++) {
    const t = labels[i];
    cells[CH.MOT * N + i] = MOT_ZERO3;
    if (t < 0) {
      cells[CH.C * N + i] = 10;
      continue;
    }
    const mask = 1 << ((t + 1) % 3);
    cells[CH.B * N + i] = 10;
    cells[CH.MOT * N + i] = (MOT_ZERO3 | ((badMirror && i === 0 ? mask ^ 1 : mask) << 24)) >>> 0;
    genome[G.LIN_HI * N + i] = 0;
    genome[G.LIN_LO * N + i] = 1 + t;
    genome[G.PARAM1 * N + i] = ((t << 8) | (mask << 16)) >>> 0;
  }
  return { cells, genome };
}

const stateOf = (labels: Labels, cfg: WorldConfig, step = 0): WorldState => {
  const { cells, genome } = arraysOf(labels);
  return { cfg, step, cells, genome, lightIn: 0n, heatOut: 0n, flux: new Array<bigint>(FLUX_COUNT).fill(0n) };
};

const baseLabel = (i: number): number => (i % 4 === 3 ? -1 : (i + (i >> 2)) % 3);
const mapLabels = (f: (i: number, b: number) => number): Labels => Int8Array.from({ length: N }, (_, i) => (baseLabel(i) < 0 ? -1 : f(i, baseLabel(i))));

/** Static through the burn-in; afterwards every even living cell steps to the label that kills it, once per census: all changes are "dom". */
function dcScript(step: number): Labels {
  const k = Math.max(0, step / 1000 - 6);
  return mapLabels((i, b) => (i % 2 === 0 ? (((b - k) % 3) + 3) % 3 : b));
}
/** DC until run census 4, then label 2 is gone (cells of label 2 become label 0): coexist fails from run census 5. */
const lossScript = (step: number): Labels => Int8Array.from(dcScript(step), (l) => (step >= 11_000 && l === 2 ? 0 : l));
/** DC until run census 3, then nothing lives. */
const extScript = (step: number): Labels => (step >= 10_000 ? new Int8Array(N).fill(-1) : dcScript(step));
/** Every census has its own half of the cells living and the next census the other half: no cell lives at two consecutive censuses, so the turnover is undefined. */
const disjointScript = (step: number): Labels => {
  const k = step / 1000;
  return Int8Array.from({ length: N }, (_, i) => ((i + k) % 2 === 0 ? (i >> 1) % 3 : -1));
};
/** A full carpet through the burn-in (static labels), then one cell in eight living, a different eighth at every census (a sparse film with an empty turnover). */
const sparseDisjointScript = (step: number): Labels => {
  const k = step / 1000;
  return Int8Array.from({ length: N }, (_, i) => (k <= 6 || (i + k) % 8 === 0 ? (i >> 1) % 3 : -1));
};
/** DC until run census 2, then every living cell has label 0 (n = 1). */
const monoScript = (step: number): Labels => Int8Array.from(dcScript(step), (l) => (step >= 9000 && l >= 0 ? 0 : l));

interface Faults {
  /** `run` throws when it would cross this step. */
  crashAt?: number;
  /** One more unit of A appears at this census. */
  matterAt?: number;
  /** heatOut is one too high at this census. */
  heatAt?: number;
  /** One cell's mirror disagrees with its genome from this census on. */
  mirrorAt?: number;
}

class ScriptedSim implements KernelSim {
  step: number;
  destroyed = false;
  constructor(
    private readonly script: (step: number) => Labels,
    startStep: number,
    private readonly e0: bigint,
    private readonly cfg: WorldConfig,
    private readonly faults: Faults,
    private readonly eventsPerCensus: number,
  ) {
    this.step = startStep;
  }
  run(count: number): void {
    const target = this.step + count;
    if (this.faults.crashAt !== undefined && this.step < this.faults.crashAt && target >= this.faults.crashAt) throw new Error("scripted crash");
    this.step = target;
  }
  private read(): { cells: Uint32Array; genome: Uint32Array; lightIn: bigint; heatOut: bigint } {
    const { cells, genome } = arraysOf(this.script(this.step), this.faults.mirrorAt !== undefined && this.step >= this.faults.mirrorAt);
    if (this.faults.matterAt === this.step) cells[CH.A * N] += 1;
    const diff = totalsOf(this.cfg, cells).energy - this.e0;
    // the ledger closes by construction: energy gained came from light, energy lost left as heat
    let lightIn = diff > 0n ? diff : 0n;
    let heatOut = diff < 0n ? -diff : 0n;
    if (this.faults.heatAt === this.step) heatOut += 1n;
    return { cells, genome, lightIn, heatOut };
  }
  census(): CensusRead {
    const r = this.read();
    return { step: this.step, cells: r.cells, genomeHead: r.genome.subarray(0, 4 * N), lightIn: r.lightIn, heatOut: r.heatOut, events: this.eventsPerCensus };
  }
  readState(): WorldState {
    const r = this.read();
    return { cfg: this.cfg, step: this.step, cells: r.cells, genome: r.genome, lightIn: r.lightIn, heatOut: r.heatOut, flux: new Array<bigint>(FLUX_COUNT).fill(0n) };
  }
  destroy(): void {
    this.destroyed = true;
  }
}

interface Call {
  jobId: string;
  attempt: number;
  phase: string;
  step: number;
  mutRate: number;
  settings: Record<string, unknown>;
  cells: Uint32Array;
}

function scriptedDeps(script: (step: number) => Labels, o: { faults?: (attempt: number) => Faults; events?: number; clock?: () => number } = {}): { deps: KernelJobDeps; calls: Call[]; sims: ScriptedSim[]; log: string[] } {
  const calls: Call[] = [];
  const sims: ScriptedSim[] = [];
  const log: string[] = [];
  const e0 = totalsOf(slabConfig(1), arraysOf(script(0)).cells).energy;
  const makeSim: SimFactory = (ctx, state) => {
    calls.push({ jobId: ctx.jobId, attempt: ctx.attempt, phase: ctx.phase, step: state.step, mutRate: ctx.cfg.mutRate, settings: ctx.settings, cells: state.cells });
    const sim = new ScriptedSim(script, state.step, e0, ctx.cfg, o.faults?.(ctx.attempt) ?? {}, o.events ?? 0);
    sims.push(sim);
    return sim;
  };
  return { deps: { makeSim, host: "test-host", device: "test-gpu", clock: o.clock, log: (l) => log.push(l), logEvery: 5 }, calls, sims, log };
}

const SETTINGS = { rpsKill: "removal", rpsRate: 0, rpsMin: 4, rpsTypes: 3, rpsFlip: 0, rpsEdge: 0 };
const INIT = { kind: "rps-mix", founders: 3, occupied: 75, nutrient: 20, biomass: 16, columns: true };

function scriptedSpec(id: string, script: (step: number) => Labels, o: Partial<KernelJobSpec> & { seed?: number; runCfg?: Partial<WorldConfig> } = {}): KernelJobSpec {
  const seed = o.seed ?? 900;
  const cfg = slabConfig(seed);
  const { runCfg, ...rest } = o;
  return {
    id,
    stage: "g0.table",
    seed,
    K0: 3,
    found: () => stateOf(script(0), cfg),
    burn: { settings: SETTINGS, init: INIT },
    run: { cfg: { ...cfg, ...runCfg }, settings: { ...SETTINGS, rpsRate: 128 }, init: INIT },
    runSteps: 20_000,
    summary: { rung: "S0", kill: "removal", spread: 16, rpsRate: 128, rpsTypes: 3, shape: [W, H, D] },
    ...rest,
  };
}

const run = async (spec: KernelJobSpec, deps: KernelJobDeps, out = freshDir()) => ({ out, result: await executeKernelJob(spec, deps, out) });
const rowsOf = (out: string, id: string) => parseRpsCensusTsv(fs.readFileSync(path.join(out, id, "census.tsv"), "utf8"));

describe("the two-phase job (scripted simulator)", () => {
  it("writes the census of B.2: header, then 6 burn-in rows and 20 run rows with job step, run step and phase", async () => {
    const { deps } = scriptedDeps(dcScript);
    const { out, result } = await run(scriptedSpec("dc", dcScript), deps);
    expect(result.status).toBe("done");
    const text = fs.readFileSync(path.join(out, "dc", "census.tsv"), "utf8");
    expect(text.startsWith(RPS_CENSUS_HEADER)).toBe(true);
    expect(RPS_CENSUS_HEADER.trimEnd().split("\t")).toEqual([...RPS_CENSUS_COLUMNS]);
    const rows = parseRpsCensusTsv(text);
    expect(rows).toHaveLength(26);
    expect(rows.map((r) => r.step)).toEqual(Array.from({ length: 26 }, (_, k) => 1000 * (k + 1)));
    expect(rows.map((r) => r.rstep)).toEqual(Array.from({ length: 26 }, (_, k) => 1000 * (k + 1) - B_IN));
    expect(rows.slice(0, 6).every((r) => r.phase === "burn")).toBe(true);
    expect(rows.slice(6).every((r) => r.phase === "run")).toBe(true);
    // the last burn-in row has rstep 0 and phase burn; the first run row is at run step 1,000
    expect(rows[5].rstep).toBe(0);
    expect(rows[6].rstep).toBe(1000);
  });

  it("the first row has no turnover or change counts; later rows count only changes between labels that kill each other", async () => {
    const { deps } = scriptedDeps(dcScript);
    const { out } = await run(scriptedSpec("dc", dcScript), deps);
    const rows = rowsOf(out, "dc");
    expect(rows[0].turnover).toBeNull();
    expect(rows[0].ndom).toBeNull();
    expect(rows[0].nanti).toBeNull();
    // burn-in: nothing changes
    for (const r of rows.slice(1, 6)) expect([r.turnover, r.ndom, r.nanti]).toEqual([0, 0, 0]);
    // run: every even living cell (512 of the 768: indices 4k and 4k + 2) steps to its killer's label, once per census
    for (const r of rows.slice(6)) {
      expect(r.nanti).toBe(0);
      expect(r.ndom).toBe(512);
      expect(r.turnover).toBeCloseTo(2 / 3, 12);
      expect(r.n).toBe(3);
      expect(r.Y).toBe(3);
      expect(r.cells.reduce((a, b) => a + b, 0)).toBe(r.living);
      expect(r.mass.slice(0, 3).reduce((a, b) => a + b, 0)).toBe(10 * r.living);
    }
  });

  it("builds the burn-in simulator at step 0 with the burn settings, then a NEW one at step 6,000 from the read-back state with the run settings", async () => {
    const { deps, calls, sims } = scriptedDeps(dcScript);
    await run(scriptedSpec("dc", dcScript, { runCfg: { mutRate: 0 } }), deps);
    expect(calls.map((c) => [c.phase, c.attempt, c.step])).toEqual([["burn", 1, 0], ["run", 1, B_IN]]);
    expect(calls[0].settings).toEqual({ ...SETTINGS, rpsRate: 0 });
    expect(calls[1].settings.rpsRate).toBe(128);
    // the second simulator starts from exactly what the first one reported at step 6,000
    expect(calls[1].cells).toEqual(arraysOf(dcScript(B_IN)).cells);
    // the burn-in simulator is destroyed at the hand-over, the run simulator at the end
    expect(sims).toHaveLength(2);
    expect(sims.every((s) => s.destroyed)).toBe(true);
    expect(sims[0].step).toBe(B_IN);
    expect(sims[1].step).toBe(B_IN + 20_000);
  });

  it("burnHash is the stateHash of the burn-end state, equal for one seed and one burn config whatever the run settings; endHash differs", async () => {
    const a = scriptedDeps(dcScript);
    const b = scriptedDeps(dcScript);
    const specA = scriptedSpec("a", dcScript);
    const specB = scriptedSpec("b", dcScript, { runCfg: { mutRate: 429_497 } });
    const ra = await run(specA, a.deps);
    const rb = await run(specB, b.deps);
    const sa = (ra.result as { summary: Record<string, unknown> }).summary;
    const sb = (rb.result as { summary: Record<string, unknown> }).summary;
    const expected = stateHash({ ...stateOf(dcScript(B_IN), slabConfig(900), B_IN), lightIn: 0n, heatOut: 0n });
    expect(sa.burnHash).toBe(expected);
    expect(sb.burnHash).toBe(expected);
    expect(sa.endHash).not.toBe(sb.endHash);
    // a different seed is a different burn-in config
    const c = scriptedDeps(dcScript);
    const rc = await run(scriptedSpec("c", dcScript, { seed: 901 }), c.deps);
    expect((rc.result as { summary: Record<string, unknown> }).summary.burnHash).not.toBe(expected);
  });

  it("stops at the census that completes a sustained loss (LOSS): the file ends there and nothing after is written", async () => {
    const { deps, calls } = scriptedDeps(lossScript);
    const { out, result } = await run(scriptedSpec("loss", lossScript), deps);
    expect(result.status).toBe("done");
    const rows = rowsOf(out, "loss");
    // run censuses 5, 6, 7 have no label 2: the job stops at run census 7
    expect(rows).toHaveLength(6 + 7);
    expect(rows[rows.length - 1].rstep).toBe(7000);
    const s = readSummary(out, "loss")!;
    expect([s.stop, s.stopRstep, s.steps]).toEqual(["loss", 7000, 13_000]);
    expect(calls).toHaveLength(2);
  });

  it("stops at an EXT census", async () => {
    const { deps } = scriptedDeps(extScript);
    const { out } = await run(scriptedSpec("ext", extScript), deps);
    const rows = rowsOf(out, "ext");
    expect(rows).toHaveLength(6 + 4);
    const s = readSummary(out, "ext")!;
    expect([s.stop, s.stopRstep, s.extinctAt]).toEqual(["ext", 4000, 10_000]);
  });

  it("uses the stop rule of the spec (7.2a MONO for arm Z; none)", async () => {
    const z = scriptedDeps(monoScript);
    const rz = await run(scriptedSpec("z", monoScript, { stop: stopRule72a("Z") }), z.deps);
    expect(readSummary(rz.out, "z")!.stop).toBe("mono");
    expect(rowsOf(rz.out, "z")).toHaveLength(6 + 5);
    const n = scriptedDeps(lossScript);
    const rn = await run(scriptedSpec("never", lossScript, { stop: stopNever }), n.deps);
    expect(readSummary(rn.out, "never")!.stop).toBe("end");
    expect(rowsOf(rn.out, "never")).toHaveLength(26);
  });

  it("a job that runs to its end says so: stop end at the scheduled run step", async () => {
    const { deps } = scriptedDeps(dcScript);
    const { out } = await run(scriptedSpec("dc", dcScript), deps);
    const s = readSummary(out, "dc")!;
    expect([s.stop, s.stopRstep, s.steps, s.runStepsScheduled, s.burnSteps, s.censusEvery]).toEqual(["end", 20_000, 26_000, 20_000, 6000, 1000]);
  });

  it("jobs with mutation leave ndom and nanti empty and fill the supply column; others leave supply empty", async () => {
    const m = scriptedDeps(dcScript);
    const rm = await run(scriptedSpec("mut", dcScript, { runCfg: { mutRate: 429_497 }, supply: true, runSteps: 3000 }), m.deps);
    for (const r of rowsOf(rm.out, "mut")) {
      expect([r.ndom, r.nanti]).toEqual([null, null]);
      expect(r.supply).toBe(0);
      expect(r.turnover === null).toBe(r.step === 1000);
    }
    const p = scriptedDeps(dcScript);
    const rp = await run(scriptedSpec("plain", dcScript, { runSteps: 3000 }), p.deps);
    for (const r of rowsOf(rp.out, "plain")) expect(r.supply).toBeNull();
  });

  it("counts the mutation events of every census", async () => {
    const { deps } = scriptedDeps(dcScript, { events: 3 });
    const { out } = await run(scriptedSpec("ev", dcScript, { runSteps: 4000 }), deps);
    expect(readSummary(out, "ev")!.events).toBe(3 * 10);
  });

  it("measures steps per second over the time spent stepping and reading (an injected clock)", async () => {
    let t = 0;
    const clock = () => (t += 10);
    const { deps } = scriptedDeps(dcScript, { clock });
    const { out } = await run(scriptedSpec("rate", dcScript, { runSteps: 4000 }), deps);
    const s = readSummary(out, "rate")!;
    // 10 censuses x 10 ms + the hand-over read (10 ms) + the end read (10 ms)
    expect(s.seconds).toBe(0.1);
    expect(s.stepsPerSec).toBe(Math.round((10_000 / 0.12) * 10) / 10);
  });

  it("writes final.bin (the last census's arrays) when asked, and names it in summary.json", async () => {
    const { deps } = scriptedDeps(dcScript);
    const { out } = await run(scriptedSpec("fin", dcScript, { runSteps: 2000, final: true }), deps);
    const f = parseRpsFinal(new Uint8Array(fs.readFileSync(path.join(out, "fin", "final.bin"))));
    expect([f.W, f.H, f.D, f.K0]).toEqual([W, H, D, 3]);
    const want = arraysOf(dcScript(8000));
    expect(f.cells).toEqual(want.cells);
    expect(f.genomeHead).toEqual(want.genome.subarray(0, 4 * N));
    expect(readSummary(out, "fin")!.final).toBe("final.bin");
    expect(readSummary(out, "dc-none") ?? null).toBeNull();
    const nofin = await run(scriptedSpec("nofin", dcScript, { runSteps: 1000 }), scriptedDeps(dcScript).deps);
    expect(readSummary(nofin.out, "nofin")!.final).toBeNull();
    expect(fs.existsSync(path.join(nofin.out, "nofin", "final.bin"))).toBe(false);
  });

  it("progress lines come every logEvery censuses and at the end", async () => {
    const { deps, log } = scriptedDeps(dcScript);
    await run(scriptedSpec("log", dcScript, { runSteps: 4000 }), deps);
    expect(log.length).toBe(2);
    expect(log[0]).toContain("log step 5000 burn");
    expect(log[1]).toContain("log step 10000 run");
  });
});

describe("summary.json (B.3) and the readout's contract", () => {
  it("carries the fields of B.3 and the ones the readout reads", async () => {
    const { deps } = scriptedDeps(dcScript);
    const { out } = await run(scriptedSpec("dc", dcScript, { runCfg: { mutRate: 0 } }), deps);
    const s = readSummary(out, "dc")!;
    expect(s).toMatchObject({
      id: "dc", stage: "g0.table", seed: 900, K0: 3, rung: "S0", kill: "removal", spread: 16, rpsRate: 128, rpsTypes: 3, shape: [W, H, D],
      steps: 26_000, stop: "end", host: "test-host", device: "test-gpu", matterOk: true, residual: "0", extinctAt: null, events: 0, final: null, attempts: 1,
      mirrorMismatches: 0,
    });
    const cfg = s.config as { burn: Record<string, unknown>; run: Record<string, unknown> };
    expect(cfg.burn.rpsRate).toBe(0);
    expect(cfg.run.rpsRate).toBe(128);
    expect(cfg.burn.tileW).toBe(W);
    expect(cfg.run.mutRate).toBe(0);
    expect((s.init as { burn: unknown; run: unknown }).burn).toEqual(INIT);
    expect((s.killParams as { burn: unknown }).burn).toEqual(SETTINGS);
    expect(typeof s.burnHash).toBe("string");
    expect(typeof s.endHash).toBe("string");
    expect(typeof s.stepsPerSec).toBe("number");
  });

  it("is read by the readout: the loader accepts the job and the classes come out as the scripts say", async () => {
    const out = freshDir();
    const cases: [string, (s: number) => Labels, string, number | "CENSORED"][] = [
      ["j-dc", dcScript, "DC", "CENSORED"],
      ["j-loss", lossScript, "LOSS", 5000],
      ["j-ext", extScript, "EXT", 4000],
    ];
    for (const [id, script] of cases) {
      const { deps } = scriptedDeps(script);
      expect((await executeKernelJob(scriptedSpec(id, script), deps, out)).status).toBe("done");
    }
    const pr = new Problems();
    const jobs = loadJobs(nodeIo(ROOT), out, pr);
    expect(pr.list).toEqual([]);
    expect(jobs).toHaveLength(3);
    for (const [id, , cls, tcx] of cases) {
      const job = jobs.find((j) => j.s.id === id)!;
      expect(job.s.dims).toEqual({ W, H, D });
      expect(job.s.K0).toBe(3);
      expect(job.s.burnKey).not.toBeNull();
      const a = analyzeRun(job, { expectedRun: 20 });
      expect([a.cls, a.tcx]).toEqual([cls, tcx]);
      if (cls === "DC") {
        expect(a.chiFw).toBe(1);
        expect(a.turnoverFw).toBeCloseTo(2 / 3, 12);
      }
    }
    // jobs of one seed and one burn-in config share a burn key and a burnHash
    const [x, y] = jobs.filter((j) => j.s.id !== "j-ext");
    expect(x.s.burnKey).toBe(y.s.burnKey);
    expect(x.s.burnHash).toBe(y.s.burnHash);
  });

  it("the burn key ignores the run settings and the kill form, and sees the burn-in's", async () => {
    const out = freshDir();
    for (const [id, o] of [
      ["k-a", {}],
      ["k-b", { runCfg: { mutRate: 429_497 } }],
    ] as const) {
      const { deps } = scriptedDeps(dcScript);
      await executeKernelJob(scriptedSpec(id, dcScript, { ...o, runSteps: 1000 }), deps, out);
    }
    const { deps } = scriptedDeps(dcScript);
    const vacancy = scriptedSpec("k-v", dcScript, { runSteps: 1000, burn: { settings: { ...SETTINGS, rpsKill: "vacancy" }, init: INIT } });
    await executeKernelJob(vacancy, deps, out);
    const other = scriptedSpec("k-s", dcScript, { runSteps: 1000, burn: { settings: { ...SETTINGS, rpsMin: 16 }, init: INIT } });
    await executeKernelJob(other, scriptedDeps(dcScript).deps, out);
    const pr = new Problems();
    const keys = new Map(loadJobs(nodeIo(ROOT), out, pr).map((j) => [j.s.id, j.s.burnKey]));
    expect(pr.list).toEqual([]);
    expect(keys.get("k-a")).toBe(keys.get("k-b"));
    expect(keys.get("k-a")).toBe(keys.get("k-v"));
    expect(keys.get("k-a")).not.toBe(keys.get("k-s"));
  });

  it("refuses summary fields the harness writes itself, a bad id, and steps that are not multiples of the census interval", async () => {
    const { deps } = scriptedDeps(dcScript);
    const out = freshDir();
    await expect(executeKernelJob(scriptedSpec("x", dcScript, { summary: { steps: 1 } }), deps, out)).rejects.toThrow(/written by the harness/);
    // `retried` is the harness's too: a driver may not write a summary that looks as if an attempt had failed
    await expect(executeKernelJob(scriptedSpec("x", dcScript, { summary: { retried: [] } }), deps, out)).rejects.toThrow(/summary field "retried" is written by the harness/);
    await expect(executeKernelJob(scriptedSpec("../x", dcScript), deps, out)).rejects.toThrow(/safe directory name/);
    await expect(executeKernelJob(scriptedSpec("x", dcScript, { runSteps: 1500 }), deps, out)).rejects.toThrow(/multiple of censusEvery/);
    await expect(executeKernelJob(scriptedSpec("x", dcScript, { burnSteps: 5500 }), deps, out)).rejects.toThrow(/multiple of censusEvery/);
    await expect(executeKernelJob(scriptedSpec("x", dcScript, { K0: 2 }), deps, out)).rejects.toThrow(/K0/);
    await expect(executeKernelJob(scriptedSpec("x", dcScript, { stage: "g0.bogus" }), deps, out)).rejects.toThrow(/not a stage name/);
    await expect(executeKernelJob(scriptedSpec("x", dcScript, { stage: "g0.2-scan" }), deps, out)).rejects.toThrow(/not a stage name/);
    expect(fs.existsSync(out) ? fs.readdirSync(out) : []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// 1.5: a job whose burn-in ends in NOSTART stops at the hand-over census (decision O-5)
// ---------------------------------------------------------------------------------------------------------------------

/** Through the burn-in the world is the DC script's; at the last burn-in census (and after) only every fourth cell lives: 25 % living, all labels present. */
const nostartLiv = (step: number): Labels => (step >= B_IN ? mapLabels((i, b) => (i % 4 === 0 ? b : -1)) : dcScript(step));
/** Label 2 is gone from the last burn-in census on: 75 % living, `coexist` false. */
const nostartCoexist = (step: number): Labels => Int8Array.from(dcScript(step), (l) => (step >= B_IN && l === 2 ? 0 : l));
/** The world is extinct at job step 3,000 and healthy again by step 4,000: NOSTART although the last burn-in census is fine. */
const nostartEarly = (step: number): Labels => (step === 3000 ? new Int8Array(N).fill(-1) : dcScript(step));

describe("1.5 a job whose burn-in ends in NOSTART stops at the hand-over census", () => {
  const cases: [string, (step: number) => Labels][] = [
    ["liv below 0.50 at the last burn-in census", nostartLiv],
    ["a founding label missing at the last burn-in census", nostartCoexist],
    ["liv below 0.01 at an earlier burn-in census", nostartEarly],
  ];
  for (const [what, script] of cases) {
    it(`${what}: six burn-in rows, stop "nostart" at run step 0, no run simulator`, async () => {
      const { deps, calls, sims, log } = scriptedDeps(script);
      const { out, result } = await run(scriptedSpec("ns", script), deps);
      expect(result.status).toBe("done");
      const rows = rowsOf(out, "ns");
      expect(rows).toHaveLength(6);
      expect(rows.every((r) => r.phase === "burn")).toBe(true);
      expect(rows[5]).toMatchObject({ step: 6000, rstep: 0 });
      const s = readSummary(out, "ns")!;
      expect(s).toMatchObject({ steps: 6000, stop: "nostart", stopRstep: 0, attempts: 1, matterOk: true, residual: "0", runStepsScheduled: 20_000 });
      // the burn-in simulator only: the run simulator of the hand-over is never built, and the one that was is destroyed
      expect(calls.map((c) => [c.phase, c.step])).toEqual([["burn", 0]]);
      expect(sims).toHaveLength(1);
      expect(sims[0].destroyed).toBe(true);
      expect(log.join("\n")).toMatch(/the burn-in ended in NOSTART/);
      // burnHash is the hash of the state read back at the hand-over, and the end state of the job is that state: the same job run on
      // (nostartStop false) has the same burnHash, which is what makes a NOSTART job a witness for the burn-in group of its seed
      expect(s.endHash).toBe(s.burnHash);
      const on = await run(scriptedSpec("ns-on", script, { nostartStop: false, runSteps: 2000 }), scriptedDeps(script).deps);
      expect(readSummary(on.out, "ns-on")!.burnHash).toBe(s.burnHash);
      expect(readSummary(on.out, "ns-on")!.endHash).not.toBe(s.burnHash);
      expect(s).not.toHaveProperty("retried");
    });
    it(`${what}: the readout classes it NOSTART from the six rows alone, and raises nothing`, async () => {
      const out = freshDir();
      await executeKernelJob(scriptedSpec("ns", script), scriptedDeps(script).deps, out);
      const pr = new Problems();
      const jobs = loadJobs(nodeIo(ROOT), out, pr);
      expect(pr.list).toEqual([]);
      const a = analyzeRun(jobs[0], { expectedRun: 20 });
      expect([a.cls, a.tcx, a.nRun]).toEqual(["NOSTART", null, 0]);
      const bugs = new Problems();
      jobBugs(jobs, (j) => analyzeRun(j, { expectedRun: 20 }), bugs);
      expect(bugs.list).toEqual([]);
    });
  }

  it("a job that starts is not stopped: the same specs with a healthy burn-in run to their end", async () => {
    const { deps, calls } = scriptedDeps(dcScript);
    const { out } = await run(scriptedSpec("fine", dcScript), deps);
    expect(readSummary(out, "fine")).toMatchObject({ steps: 26_000, stop: "end" });
    expect(calls.map((c) => c.phase)).toEqual(["burn", "run"]);
  });

  it("the boundary is the readout's: liv exactly 0.50 at the last burn-in census starts, liv just below does not", async () => {
    // 768 of the 1,024 cells live in the base layout: keep exactly 512 (0.50) or 511 of them
    const keep = (n: number) => (step: number): Labels => {
      if (step < B_IN) return dcScript(step);
      let kept = 0;
      return mapLabels((_i, b) => (kept++ < n ? b : -1));
    };
    // the label field must keep all three labels at 2 % or more: kept cells follow the base layout in index order, so they do
    const half = await run(scriptedSpec("half", keep(512)), scriptedDeps(keep(512)).deps);
    expect(readSummary(half.out, "half")).toMatchObject({ stop: expect.not.stringMatching(/nostart/) });
    const below = await run(scriptedSpec("below", keep(511)), scriptedDeps(keep(511)).deps);
    expect(readSummary(below.out, "below")).toMatchObject({ stop: "nostart", steps: 6000 });
  });

  it("nostartStop false (section 7, which has no NOSTART class) runs the job on, and the readout still classes it NOSTART", async () => {
    const { deps, calls } = scriptedDeps(nostartLiv);
    const { out } = await run(scriptedSpec("ns-off", nostartLiv, { nostartStop: false }), deps);
    expect(calls.map((c) => c.phase)).toEqual(["burn", "run"]);
    const s = readSummary(out, "ns-off")!;
    expect(s.steps).toBe(26_000);
    expect(s.stop).not.toBe("nostart");
    const pr = new Problems();
    const job = loadJobs(nodeIo(ROOT), out, pr)[0];
    expect(analyzeRun(job, { expectedRun: 20 }).cls).toBe("NOSTART");
  });

  it("final.bin is not written for a NOSTART job, whatever the spec asks", async () => {
    const { out } = await run(scriptedSpec("ns-fin", nostartLiv, { final: true }), scriptedDeps(nostartLiv).deps);
    expect(readSummary(out, "ns-fin")!.final).toBeNull();
    expect(fs.existsSync(path.join(out, "ns-fin", "final.bin"))).toBe(false);
  });

  it("a rerun after a crash decides NOSTART again from the same burn-in: the summary says nostart, attempts 2", async () => {
    const { deps } = scriptedDeps(nostartLiv, { faults: (a) => (a === 1 ? { crashAt: 3000 } : {}) });
    const { out } = await run(scriptedSpec("ns-retry", nostartLiv), deps);
    expect(readSummary(out, "ns-retry")).toMatchObject({ stop: "nostart", attempts: 2, steps: 6000 });
  });
});

describe("failed jobs (1.3)", () => {
  it("a crash is rerun once from step 0 with the same seed; the second try's files are the job's", async () => {
    const { deps, calls } = scriptedDeps(dcScript, { faults: (a) => (a === 1 ? { crashAt: 9000 } : {}) });
    const { out, result } = await run(scriptedSpec("crash", dcScript, { runSteps: 4000 }), deps);
    expect(result.status).toBe("done");
    expect(calls.map((c) => [c.attempt, c.phase, c.step])).toEqual([[1, "burn", 0], [1, "run", B_IN], [2, "burn", 0], [2, "run", B_IN]]);
    const s = readSummary(out, "crash")!;
    expect(s.attempts).toBe(2);
    expect(s.seed).toBe(900);
    expect(s.missing).toBeUndefined();
    expect(rowsOf(out, "crash")).toHaveLength(10);
  });

  it("a second crash marks the job MISSING (summary.json with missing true and both failures), without stopping the stage", async () => {
    const { deps, sims } = scriptedDeps(dcScript, { faults: () => ({ crashAt: 9000 }) });
    const { out, result } = await run(scriptedSpec("crash2", dcScript, { runSteps: 4000 }), deps);
    expect(result.status).toBe("missing");
    const s = readSummary(out, "crash2")!;
    expect(s).toMatchObject({ missing: true, status: "missing", stop: "missing", attempts: 2, id: "crash2", seed: 900 });
    expect((s.failures as { kind: string; message: string; step: number | null }[]).map((f) => [f.kind, f.message, f.step])).toEqual([["crash", "scripted crash", 8000], ["crash", "scripted crash", 8000]]);
    expect(fs.existsSync(path.join(out, "crash2", "census.tsv"))).toBe(false);
    expect(parseRpsCensusTsv(fs.readFileSync(path.join(out, "crash2", "census.partial.tsv"), "utf8"))).toHaveLength(8);
    // every simulator a failed attempt built was destroyed
    expect(sims.every((x) => x.destroyed)).toBe(true);
    // the readout lists it as MISSING
    const pr = new Problems();
    const job = loadJobs(nodeIo(ROOT), out, pr)[0];
    expect(pr.list).toEqual([]);
    expect(job.s.missing).toBe(true);
  });

  it("a matter change is a bug: rerun once, and when it happens again the job is marked MISSING and the stage stops", async () => {
    const { deps, calls } = scriptedDeps(dcScript, { faults: () => ({ matterAt: 3000 }) });
    const out = freshDir();
    const err = await executeKernelJob(scriptedSpec("matter", dcScript, { runSteps: 2000 }), deps, out).catch((e) => e);
    expect(err).toBeInstanceOf(StageStop);
    expect((err as StageStop).jobId).toBe("matter");
    expect((err as StageStop).failures.map((f) => [f.attempt, f.kind, f.step])).toEqual([[1, "conservation", 3000], [2, "conservation", 3000]]);
    expect(calls.filter((c) => c.phase === "burn").map((c) => c.attempt)).toEqual([1, 2]);
    const s = readSummary(out, "matter")!;
    expect(s).toMatchObject({ missing: true, matterOk: false });
    expect(parseRpsCensusTsv(fs.readFileSync(path.join(out, "matter", "census.partial.tsv"), "utf8"))).toHaveLength(2);
  });

  it("a nonzero energy residual likewise, and the residual is recorded", async () => {
    const { deps } = scriptedDeps(dcScript, { faults: () => ({ heatAt: 7000 }) });
    const out = freshDir();
    const err = (await executeKernelJob(scriptedSpec("energy", dcScript, { runSteps: 2000 }), deps, out).catch((e) => e)) as StageStop;
    expect(err).toBeInstanceOf(StageStop);
    expect(err.failures[0].kind).toBe("conservation");
    expect(err.failures[0].message).toContain("energy residual 1");
    expect(readSummary(out, "energy")).toMatchObject({ missing: true, matterOk: false, residual: "1" });
  });

  it("a failure that does not come back is not the end: the rerun's files are used, and the failure stays in the summary (`retried`)", async () => {
    const { deps } = scriptedDeps(dcScript, { faults: (a) => (a === 1 ? { matterAt: 8000 } : {}) });
    const { out, result } = await run(scriptedSpec("flaky", dcScript, { runSteps: 4000 }), deps);
    expect(result.status).toBe("done");
    expect(readSummary(out, "flaky")).toMatchObject({ attempts: 2, matterOk: true, residual: "0", retried: [{ attempt: 1, kind: "conservation", step: 8000 }] });
    if (result.status === "done") expect(result.summary.retried).toHaveLength(1);
  });

  it("1.3/8.4 that trace is a bug indicator for the readout (exit 3) and stops the Gate-0 driver, although the rerun passed (Codex finding 1, conformance F12)", async () => {
    const { deps } = scriptedDeps(dcScript, { faults: (a) => (a === 1 ? { matterAt: 8000 } : {}) });
    const { out } = await run(scriptedSpec("flaky2", dcScript, { runSteps: 4000 }), deps);
    const pr = new Problems();
    const jobs = loadJobs(nodeIo(ROOT), out, pr);
    expect(pr.list).toEqual([]);
    const bugs = new Problems();
    jobBugs(jobs, (j) => analyzeRun(j, {}), bugs);
    expect(bugs.code).toBe(3);
    expect(bugs.list.map((p) => p.message).join()).toMatch(/attempt 1 failed a conservation check at step 8000/);
    const stops = stageStops([{ dir: "flaky2", s: readSummary(out, "flaky2")! }]);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatch(/an earlier attempt failed a conservation check \(the rerun passed\)/);
  });

  it("a crash that does not come back leaves its trace too, but it is no bug indicator and no stage stop", async () => {
    const { deps } = scriptedDeps(dcScript, { faults: (a) => (a === 1 ? { crashAt: 9000 } : {}) });
    const { out, result } = await run(scriptedSpec("flaky3", dcScript, { runSteps: 4000 }), deps);
    expect(result.status).toBe("done");
    const s = readSummary(out, "flaky3")!;
    expect((s.retried as { kind: string }[]).map((f) => f.kind)).toEqual(["crash"]);
    const bugs = new Problems();
    jobBugs(loadJobs(nodeIo(ROOT), out, new Problems()), (j) => analyzeRun(j, {}), bugs);
    expect(bugs.code).toBe(0);
    expect(stageStops([{ dir: "flaky3", s }])).toEqual([]);
  });

  it("a rerun that passes but loses the publish race with a conservation failure behind it stops the stage, keeps the failures in a hidden file, and leaves the published job as it is (final review, finding 1; D22)", async () => {
    // a clean job of the same id, finished elsewhere: this is what the other process publishes while our rerun is under way
    const winnerDir = freshDir();
    await executeKernelJob(scriptedSpec("raced", dcScript, { runSteps: 4000 }), scriptedDeps(dcScript).deps, winnerDir);
    const winner = { "census.tsv": fs.readFileSync(path.join(winnerDir, "raced", "census.tsv"), "utf8"), "summary.json": fs.readFileSync(path.join(winnerDir, "raced", "summary.json"), "utf8") };
    const out = freshDir();
    const { deps } = scriptedDeps(dcScript, { faults: (a) => (a === 1 ? { matterAt: 8000 } : {}) });
    const racing: KernelJobDeps = {
      ...deps,
      makeSim: (ctx, state) => {
        if (ctx.attempt === 2 && ctx.phase === "burn") publishJob(out, "raced", winner);
        return deps.makeSim(ctx, state);
      },
    };
    const err = (await executeKernelJob(scriptedSpec("raced", dcScript, { runSteps: 4000 }), racing, out).catch((e) => e)) as StageStop;
    expect(err).toBeInstanceOf(StageStop);
    expect(err.lostRace).toBe(true);
    expect(err.jobId).toBe("raced");
    expect(err.failures.map((f) => [f.attempt, f.kind, f.step])).toEqual([[1, "conservation", 8000]]);
    expect(err.message).toMatch(/passed on the rerun but another process had published it first, and an earlier attempt failed \(attempt 1: conservation/);
    // the published job is the winner's, byte for byte, and the rerun's files were not mixed in
    expect(fs.readFileSync(path.join(out, "raced", "summary.json"), "utf8")).toBe(winner["summary.json"]);
    expect(fs.readFileSync(path.join(out, "raced", "census.tsv"), "utf8")).toBe(winner["census.tsv"]);
    expect(fs.readdirSync(path.join(out, "raced")).sort()).toEqual(["census.tsv", "summary.json"]);
    // the failures are in a hidden file beside the jobs, with the summary the rerun would have published
    const traces = fs.readdirSync(out).filter((n) => n.startsWith(LOST_RACE_PREFIX));
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatch(/^\.retried-raced-\d+-\d+\.json$/);
    const trace = JSON.parse(fs.readFileSync(path.join(out, traces[0]), "utf8")) as { id: string; lostRace: boolean; retried: { kind: string; step: number }[]; loser: { attempts: number } };
    expect(trace).toMatchObject({ id: "raced", lostRace: true, loser: { attempts: 2 } });
    expect(trace.retried.map((f) => [f.kind, f.step])).toEqual([["conservation", 8000]]);
    expect(fs.readdirSync(out).filter((n) => n.startsWith(".tmp-"))).toEqual([]);
    // the loader sees the one published job, and the trace is a bug indicator of the readout (exit 3)
    const pr = new Problems();
    const jobs = loadJobs(nodeIo(ROOT), out, pr);
    expect(jobs).toHaveLength(1);
    expect(pr.list.filter((p) => p.code === 2)).toEqual([]);
    expect(pr.list.map((p) => p.message).join()).toMatch(/\.retried-raced-\d+-\d+\.json: a rerun that passed lost the publish race.*conservation or invariant/);
    expect(pr.code).toBe(3);
    // the Gate-0 driver keeps the stage stopped on a later run, on the file alone
    const stops = stageStops(diskIo(out, ROOT).rawSummaries());
    expect(stops.some((m) => /an earlier attempt failed a conservation check, and the rerun that passed lost the publish race to another process/.test(m))).toBe(true);
  });

  it("a rerun that loses the publish race after a plain crash, or after nothing, is only 'exists': no stop, no trace (final review, finding 1)", async () => {
    for (const fault of [{ crashAt: 9000 }, {}]) {
      const winnerDir = freshDir();
      await executeKernelJob(scriptedSpec("raced2", dcScript, { runSteps: 4000 }), scriptedDeps(dcScript).deps, winnerDir);
      const out = freshDir();
      const { deps } = scriptedDeps(dcScript, { faults: (a) => (a === 1 ? fault : {}) });
      const racing: KernelJobDeps = {
        ...deps,
        makeSim: (ctx, state) => {
          if (ctx.attempt === (fault.crashAt === undefined ? 1 : 2) && ctx.phase === "burn") publishJob(out, "raced2", { "summary.json": fs.readFileSync(path.join(winnerDir, "raced2", "summary.json"), "utf8"), "census.tsv": fs.readFileSync(path.join(winnerDir, "raced2", "census.tsv"), "utf8") });
          return deps.makeSim(ctx, state);
        },
      };
      expect((await executeKernelJob(scriptedSpec("raced2", dcScript, { runSteps: 4000 }), racing, out)).status).toBe("exists");
      expect(fs.readdirSync(out)).toEqual(["raced2"]);
      expect(loadJobs(nodeIo(ROOT), out, new Problems())).toHaveLength(1);
    }
  });

  it("retainLostRace writes nothing for a plain crash and stops the stage for an invariant failure too (final review, finding 1)", () => {
    const out = freshDir();
    const crash: JobFailure = { attempt: 1, kind: "crash", message: "x", step: null, detail: {} };
    const inv: JobFailure = { attempt: 1, kind: "invariant", message: "mirror", step: 8000, detail: {} };
    expect(() => retainLostRace(out, "j", [crash], {})).not.toThrow();
    expect(fs.existsSync(out) ? fs.readdirSync(out) : []).toEqual([]);
    expect(() => retainLostRace(out, "j", [crash, inv], { attempts: 2 })).toThrow(StageStop);
    expect(fs.readdirSync(out).filter((n) => n.startsWith(LOST_RACE_PREFIX))).toHaveLength(1);
    // an unreadable trace still stops the stage when the driver looks at the directory
    fs.writeFileSync(path.join(out, `${LOST_RACE_PREFIX}other-1-9.json`), "{not json");
    expect(stageStops(diskIo(out, ROOT).rawSummaries()).length).toBeGreaterThanOrEqual(2);
  });

  it("the founding must pass the schema's validator before any step (bar the RPS genome bytes): matter above MATTER_MAX, or E or S above the pool, is an invariant failure (final review, finding 6)", () => {
    const base = (): WorldState => stateOf(dcScript(0), slabConfig(900));
    expect(foundingProblems(base())).toEqual([]);
    const exact = base();
    exact.cells[CH.A * N] = MATTER_MAX - 10 * N; // the founding's 10 per cell plus this is exactly MATTER_MAX
    expect(foundingProblems(exact)).toEqual([]);
    const over = base();
    over.cells[CH.A * N] = MATTER_MAX - 10 * N + 1;
    expect(foundingProblems(over)).toEqual([`total matter ${MATTER_MAX + 1} exceeds ${MATTER_MAX}`]);
    const hot = base();
    hot.cells[CH.E * N + 5] = POOL_MAX3 + 1;
    expect(foundingProblems(hot)).toEqual([`E at cell 5 exceeds ${POOL_MAX3}`]);
    const salty = base();
    salty.cells[CH.S * N + 7] = POOL_MAX3 + 1;
    expect(foundingProblems(salty)).toEqual([`S at cell 7 exceeds ${POOL_MAX3}`]);
    let thrown: unknown = null;
    try {
      checkFounding(over, "census\n");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ kind: "invariant", partialCensus: "census\n" });
  });

  it("a job whose founding breaks the bounds is an invariant failure of both attempts: the stage stops, a MISSING marker is left, and no simulator is ever built (final review, finding 6)", async () => {
    const { deps, calls } = scriptedDeps(dcScript);
    const out = freshDir();
    const spec = scriptedSpec("overfull", dcScript, {
      found: () => {
        const st = stateOf(dcScript(0), slabConfig(900));
        st.cells[CH.A * N] = MATTER_MAX; // with the 10 per cell of the scripted world: over by 10 N
        return st;
      },
    });
    const err = (await executeKernelJob(spec, deps, out).catch((e) => e)) as StageStop;
    expect(err).toBeInstanceOf(StageStop);
    expect(err.lostRace).toBe(false);
    expect(err.failures.map((f) => [f.attempt, f.kind])).toEqual([[1, "invariant"], [2, "invariant"]]);
    expect(err.failures[0].message).toMatch(/the founding is not a valid world state: total matter \d+ exceeds 67108864/);
    expect(calls).toHaveLength(0);
    expect(readSummary(out, "overfull")).toMatchObject({ missing: true });
  });

  it("a film in which no cell lives at two consecutive censuses writes an empty turnover, and the readout stops with code 3 where the class needs it, end to end (final review, finding 9)", async () => {
    const { deps } = scriptedDeps(disjointScript);
    const { out, result } = await run(scriptedSpec("disjoint", disjointScript, { runSteps: 20_000 }), deps);
    expect(result.status).toBe("done");
    const rows = rowsOf(out, "disjoint");
    expect(rows).toHaveLength(26);
    expect(rows.every((r) => r.turnover === null)).toBe(true); // the first row has no previous census, every other row no cell living at both
    expect(rows.every((r) => r.living === N / 2)).toBe(true);
    expect(rows.slice(6).every((r) => r.n === 3 && r.ndom === 0 && r.nanti === 0)).toBe(true);
    const pr = new Problems();
    const jobs = loadJobs(nodeIo(ROOT), out, pr);
    expect(pr.list).toEqual([]);
    let err: unknown = null;
    try {
      analyzeRun(jobs[0], { expectedRun: 20 });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: 3 });
    expect((err as Error).message).toMatch(/no cell lives at both censuses 6000 and 7000, so the turnover of that census is undefined, and the class \(FC, CHURN or DC\) needs it: no row covers this/);
    // the whole readout: exit 3, not a class
    const bugs = new Problems();
    expect(bugs.guard(() => analyzeRun(jobs[0], { expectedRun: 20 }))).toBeNull();
    expect(bugs.code).toBe(3);
  });

  it("a sparse film with an empty turnover is still SPARSE: the class is decided without the turnover (final review, finding 9)", async () => {
    const { deps } = scriptedDeps(sparseDisjointScript);
    const { out, result } = await run(scriptedSpec("sparse-disjoint", sparseDisjointScript, { runSteps: 20_000 }), deps);
    expect(result.status).toBe("done");
    const rows = rowsOf(out, "sparse-disjoint");
    expect(rows[6].turnover).not.toBeNull(); // the first run census still shares the carpet's cells
    expect(rows.slice(7).every((r) => r.turnover === null)).toBe(true);
    const jobs = loadJobs(nodeIo(ROOT), out, new Problems());
    const a = analyzeRun(jobs[0], { expectedRun: 20 });
    expect(a.cls).toBe("SPARSE");
    expect(a.turnoverFw).toBeNull();
  });

  it("a job that passed the first time has no `retried` field", async () => {
    const { deps } = scriptedDeps(dcScript);
    const { out } = await run(scriptedSpec("clean", dcScript, { runSteps: 2000 }), deps);
    expect(readSummary(out, "clean")).not.toHaveProperty("retried");
  });

  it("a MOT mirror that disagrees with the genome is an invariant failure, handled like a conservation failure", async () => {
    const { deps } = scriptedDeps(dcScript, { faults: () => ({ mirrorAt: 8000 }) });
    const err = (await executeKernelJob(scriptedSpec("mirror", dcScript, { runSteps: 4000 }), deps, freshDir()).catch((e) => e)) as StageStop;
    expect(err).toBeInstanceOf(StageStop);
    expect(err.failures[0]).toMatchObject({ kind: "invariant", step: 8000 });
    expect(err.failures[0].message).toContain("1 cells whose MOT mirror disagrees");
  });

  it("the mirror check can be turned off", async () => {
    const { deps } = scriptedDeps(dcScript, { faults: () => ({ mirrorAt: 8000 }) });
    const { result } = await run(scriptedSpec("nomirror", dcScript, { runSteps: 4000, checkMirror: false }), deps);
    expect(result.status).toBe("done");
  });

  it("a founding that cannot be built is a crash", async () => {
    const { deps } = scriptedDeps(dcScript);
    const spec = scriptedSpec("nofound", dcScript, {
      found: () => {
        throw new Error("no founding");
      },
    });
    const { out, result } = await run(spec, deps);
    expect(result.status).toBe("missing");
    expect(readSummary(out, "nofound")!.config).toMatchObject({ burn: null });
  });

  it("skips a job whose directory exists, and leaves no temporary directory behind", async () => {
    const { deps, calls } = scriptedDeps(dcScript);
    const out = freshDir();
    const spec = scriptedSpec("once", dcScript, { runSteps: 2000 });
    expect((await executeKernelJob(spec, deps, out)).status).toBe("done");
    const nCalls = calls.length;
    expect((await executeKernelJob(spec, deps, out)).status).toBe("exists");
    expect(calls).toHaveLength(nCalls);
    expect(jobExists(out, "once")).toBe(true);
    expect(fs.readdirSync(out).sort()).toEqual(["once"]);
    expect(fs.readdirSync(path.join(out, "once")).sort()).toEqual(["census.tsv", "summary.json"]);
  });
});

describe("files", () => {
  it("publishJob loses gracefully to a job that appeared meanwhile and cleans up", () => {
    const out = freshDir();
    expect(publishJob(out, "j", { "summary.json": "{}\n" })).toBe(true);
    expect(publishJob(out, "j", { "summary.json": '{"other":1}\n' })).toBe(false);
    expect(fs.readFileSync(path.join(out, "j", "summary.json"), "utf8")).toBe("{}\n");
    expect(fs.readdirSync(out)).toEqual(["j"]);
  });

  it("publishMissing stops the stage after a conservation failure also when another process published the job directory first (Codex finding 1)", () => {
    const out = freshDir();
    publishJob(out, "j", { "summary.json": "{}\n" });
    const fail = (attempt: number, kind: JobFailure["kind"]): JobFailure => ({ attempt, kind, message: "x", step: 3000, detail: {} });
    expect(() => publishMissing(out, "j", { id: "j" }, [fail(1, "conservation"), fail(2, "conservation")], "")).toThrow(StageStop);
    expect(() => publishMissing(out, "j", { id: "j" }, [fail(1, "crash"), fail(2, "invariant")], "")).toThrow(StageStop);
    // a plain crash is not a stage stop: the lost race only returns false, and the published job stays
    expect(publishMissing(out, "j", { id: "j" }, [fail(1, "crash"), fail(2, "crash")], "")).toBe(false);
    expect(fs.readFileSync(path.join(out, "j", "summary.json"), "utf8")).toBe("{}\n");
    // the two stops kept their markers in hidden files (verification round, finding 1); the crash left none
    expect(fs.readdirSync(out).filter((n) => !n.startsWith(LOST_RACE_PREFIX))).toEqual(["j"]);
    expect(fs.readdirSync(out).filter((n) => n.startsWith(LOST_RACE_PREFIX))).toHaveLength(2);
  });

  it("publishMissing keeps the MISSING marker of a conservation or invariant failure in a hidden file when a clean job was published first, so the stop outlives the process (verification round, finding 1)", () => {
    const out = freshDir();
    publishJob(out, "j", { "summary.json": '{"id":"j","clean":true}\n' });
    const fail = (attempt: number, kind: JobFailure["kind"]): JobFailure => ({ attempt, kind, message: "energy residual 1", step: 3000, detail: { residual: "1" } });
    let err: unknown = null;
    try {
      publishMissing(out, "j", { id: "j", stage: "g0.scan" }, [fail(1, "conservation"), fail(2, "conservation")], "rstep\tliv\n0\t0.9\n");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StageStop);
    const stop = err as StageStop;
    expect(stop.lostRace).toBe(false);
    const traces = fs.readdirSync(out).filter((n) => n.startsWith(LOST_RACE_PREFIX));
    expect(traces).toHaveLength(1);
    expect(stop.markerFile).toBe(traces[0]);
    expect(stop.message).toMatch(/failed twice .*another process had published it first, so its MISSING marker is in \.retried-j-\d+-\d+\.json/);
    expect(JSON.parse(fs.readFileSync(path.join(out, traces[0]), "utf8"))).toMatchObject({
      id: "j",
      stage: "g0.scan",
      missing: true,
      lostRace: true,
      matterOk: false,
      residual: "1",
      failures: [{ kind: "conservation" }, { kind: "conservation" }],
      partialCensus: "rstep\tliv\n0\t0.9\n",
    });
    // the clean job stands; the readout reports the file as a bug indicator with what it holds, and the driver's listing stops on it
    expect(fs.readFileSync(path.join(out, "j", "summary.json"), "utf8")).toBe('{"id":"j","clean":true}\n');
    const pr = new Problems();
    loadJobs(nodeIo(ROOT), out, pr);
    expect(pr.list.filter((p) => p.code === 3).map((p) => p.message).join()).toMatch(/\.retried-j-\d+-\d+\.json: a job that failed twice, a conservation or invariant check among the failures, lost the publish of its MISSING marker/);
    expect(stageStops(diskIo(out, ROOT).rawSummaries()).join()).toMatch(/\.retried-j-\d+-\d+\.json: matter changed/);
    // a MISSING marker this process did publish stays in its directory alone
    const won = freshDir();
    expect(() => publishMissing(won, "j", { id: "j" }, [fail(1, "invariant"), fail(2, "invariant")], "")).toThrow(StageStop);
    expect(fs.readdirSync(won)).toEqual(["j"]);
  });

  it("cleanStaleTmp removes old .tmp- directories and keeps fresh ones and jobs", () => {
    const out = freshDir();
    publishJob(out, "keep", { "summary.json": "{}\n" });
    fs.mkdirSync(path.join(out, ".tmp-old"));
    fs.mkdirSync(path.join(out, ".tmp-new"));
    const old = new Date(Date.now() - 2 * 3600 * 1000);
    fs.utimesSync(path.join(out, ".tmp-old"), old, old);
    expect(cleanStaleTmp(out)).toBe(1);
    expect(fs.readdirSync(out).sort()).toEqual([".tmp-new", "keep"]);
    expect(cleanStaleTmp(path.join(out, "nope"))).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The CPU reference on a plain slab (no RPS keys): the hand-over is exact
// ---------------------------------------------------------------------------------------------------------------------

const refWorld = (cfg: WorldConfig, founders = true): WorldState =>
  buildWorld3(cfg, {
    nutrient: 32,
    founders: founders ? [{ x: 4, y: 4, z: 0, radius: 2, genome: generalistGenome3(cfg.defaultMu, cfg.defaultSigma), biomass: 20, energy: 40 }] : [],
  });

const refFactory = refSimFactory;

const refDeps = (): KernelJobDeps => ({ makeSim: refFactory, host: "test-host", device: "reference" });

function refSpec(id: string, seed: number, o: Partial<KernelJobSpec> & { runCfg?: Partial<WorldConfig>; founders?: boolean } = {}): KernelJobSpec {
  const cfg = refCfg(seed);
  const { runCfg, founders, ...rest } = o;
  return {
    id,
    stage: "g0.table",
    seed,
    K0: 3,
    found: () => refWorld(cfg, founders !== false),
    burn: { settings: {}, init: { kind: "plain-slab" } },
    run: { cfg: { ...cfg, ...runCfg }, settings: {}, init: { kind: "plain-slab" } },
    burnSteps: 40,
    censusEvery: 20,
    runSteps: 60,
    stop: stopNever,
    // a plain slab with one founding ball is never a started carpet with K0 labels (1.5, NOSTART): these tests are about the hand-over
    // and the stop rules, not about the start
    nostartStop: false,
    summary: { rung: "S0", kill: "removal", spread: cfg.spread, rpsRate: 0, shape: [8, 8, 4] },
    ...rest,
  };
}

describe("the two-phase job on the CPU reference slab (no RPS keys)", () => {
  it("is exact: burn-in, read-back and a new simulator give the state of one continuous run (matter exact, residual 0)", async () => {
    const out = freshDir();
    const res = await executeKernelJob(refSpec("ref", 900), refDeps(), out);
    expect(res.status).toBe("done");
    const s = readSummary(out, "ref")!;
    expect(s).toMatchObject({ steps: 100, stop: "end", matterOk: true, residual: "0", events: 0, attempts: 1 });
    // one continuous run of the same world for the same 100 steps
    const cfg = refCfg(900);
    const cont = new RefSim3(refWorld(cfg));
    let burnHash = "";
    cont.run(40);
    burnHash = stateHash(cont.state);
    cont.run(60);
    expect(s.burnHash).toBe(burnHash);
    expect(s.endHash).toBe(stateHash(cont.state));
    const rows = rowsOf(out, "ref");
    expect(rows.map((r) => [r.phase, r.step, r.rstep])).toEqual([["burn", 20, -20], ["burn", 40, 0], ["run", 60, 20], ["run", 80, 40], ["run", 100, 60]]);
    // every census agrees with the continuous run's matter: the founders' ball lives and holds the biomass
    const t = totalsOf(cfg, cont.state.cells);
    expect(rows[4].living).toBeGreaterThan(0);
    expect(t.matter).toBe(totalsOf(cfg, refWorld(cfg).cells).matter);
  }, 60_000);

  it("is deterministic: the same job twice gives the same census.tsv, burnHash and endHash", async () => {
    const a = freshDir();
    const b = freshDir();
    await executeKernelJob(refSpec("ref", 901), refDeps(), a);
    await executeKernelJob(refSpec("ref", 901), refDeps(), b);
    expect(fs.readFileSync(path.join(a, "ref", "census.tsv"), "utf8")).toBe(fs.readFileSync(path.join(b, "ref", "census.tsv"), "utf8"));
    const sa = readSummary(a, "ref")!;
    const sb = readSummary(b, "ref")!;
    for (const k of ["burnHash", "endHash", "steps", "residual"]) expect(sa[k]).toBe(sb[k]);
  }, 60_000);

  it("jobs of one seed share the burn-in hash whatever the run phase does; the run phase's own settings take effect after the hand-over", async () => {
    const out = freshDir();
    await executeKernelJob(refSpec("same", 902), refDeps(), out);
    await executeKernelJob(refSpec("lit", 902, { runCfg: { lightBase: 100, lightAmp: 100 } }), refDeps(), out);
    const a = readSummary(out, "same")!;
    const b = readSummary(out, "lit")!;
    expect(a.burnHash).toBe(b.burnHash);
    expect(a.endHash).not.toBe(b.endHash);
    expect((b.config as { burn: { lightBase: number }; run: { lightBase: number } }).burn.lightBase).toBe(refCfg(902).lightBase);
    expect((b.config as { run: { lightBase: number } }).run.lightBase).toBe(100);
  }, 60_000);

  it("a plain slab has one label, so with K0 = 3 the default early stop ends the job at the third run census; an empty slab is EXT at the first", async () => {
    const loss = freshDir();
    await executeKernelJob(refSpec("plain", 903, { stop: stopRule15 }), refDeps(), loss);
    expect(readSummary(loss, "plain")).toMatchObject({ stop: "loss", stopRstep: 60, steps: 100 });
    const empty = freshDir();
    await executeKernelJob(refSpec("empty", 904, { stop: stopRule15, founders: false }), refDeps(), empty);
    expect(readSummary(empty, "empty")).toMatchObject({ stop: "ext", stopRstep: 20, steps: 60, extinctAt: 20 });
    expect(rowsOf(empty, "empty").map((r) => r.living)).toEqual([0, 0, 0]);
  }, 60_000);
});

describe("canonical summaries", () => {
  it("the same job gives the same summary apart from timing (so two machines' records can be compared)", async () => {
    const strip = (s: Record<string, unknown>) => {
      const { seconds: _s, stepsPerSec: _r, host: _h, device: _d, ...rest } = s;
      return canonicalJson(rest);
    };
    const a = await run(scriptedSpec("c", dcScript, { runSteps: 3000 }), scriptedDeps(dcScript).deps);
    const b = await run(scriptedSpec("c", dcScript, { runSteps: 3000 }), scriptedDeps(dcScript).deps);
    expect(strip(readSummary(a.out, "c")!)).toBe(strip(readSummary(b.out, "c")!));
  });
});
