// Plumbing rehearsal of the Gate-0 driver (seeds 900 and up; a few thousand steps at 128 x 128 x 4). Not a result, and nothing it
// writes is read as one: every summary carries mode "rehearsal".
//
// It runs, through the same harness and the same job specs as the pilot:
//   1. a removal job at a nonzero rate and a vacancy job at a nonzero rate (the same seed and spread, so one burn-in);
//   2. the V check of rule draft G0.1 at rate 0: the removal build and the vacancy build, census.tsv compared byte for byte;
//   3. the hand-over check: a two-phase rate-0 job against one continuous run of the same world (end-state hash);
//   4. an exact audit of the vacancy rule on the GPU. With dtQ 0 and spread 0 transport is the identity, so the cells the rule empties
//      in one step can be predicted on the host from the state before the step (ndom from B and the mirror, the kill draw from
//      cellBase and draw, slot 40) and compared with what the vacancy build did against the rate-0 build from the same state;
//   5. the mobility meter of 3.1 at spreads 8 and 16 (the full 5,000 steps), whose values the review's scratch runs measured.
import { chirality, parseRpsCensusTsv, type RpsCensusRecord } from "@bl/metrics";
import { CH, G, MOT_ZERO3, cellBase, cellCount, draw, stateHash, worldH, worldW, type WorldState } from "@bl/schema";
import * as fs from "node:fs";
import * as path from "node:path";
import { baselineOf, conservationOf, executeKernelJob, type KernelJobDeps, type KernelJobResult, type SimFactory } from "../lib/kernel-job.ts";
import { meterPoint } from "../readout-gate0.ts";
import { loadJobs, nodeIo } from "../readout.ts";
import { Problems } from "../readout-jobs.ts";
import { runMeterJob, runSpecOf } from "./jobs.ts";
import { mkJobDef, type JobDef } from "./plan.ts";
import { METER_STEPS, jobConfig, killSettings, mixParams } from "./rungs.ts";
import { rpsMix } from "./world.ts";

export const REHEARSAL_SEED = 901;
/** The meter rehearsal: seed 905 (the pilot's is 405), the spreads whose scratch values the review has. */
export const REHEARSAL_METER_SEED = 905;
export const REHEARSAL_METER_SPREADS = [8, 16];
export const REHEARSAL_STEPS = 3000;
export const REHEARSAL_SPREAD = 16;
/** Removal: a fraction of B in 1/65536 per dominant face, the scratch regime (spread 16, rate 128). */
export const REHEARSAL_REMOVAL_RATE = 128;
/** Vacancy: probability in 1/65536 per dominant face; 1,024 is a point of rung V's grid. */
export const REHEARSAL_VACANCY_RATE = 1024;
/** The audit's rate: one dominant face empties a cell with probability 1/8, so a few hundred cells go in one step. */
export const AUDIT_RATE = 8192;

export interface JobLine {
  id: string;
  kill: string;
  rate: number;
  status: string;
  steps: number | null;
  stop: unknown;
  stepsPerSec: unknown;
  matterOk: unknown;
  residual: unknown;
  burnHash: unknown;
  endHash: unknown;
  living: (number | null)[];
  /** The cyclic signature over the run censuses: ndom and nanti summed, and chi (0 below 200 changes). */
  changes: { ndom: number; nanti: number; chi: number };
}

export interface MeterLine {
  spread: number;
  Dx: number | null;
  Dy: number | null;
  Dlab: number | null;
  W: { x: number | null; y: number | null };
  stepsPerSec: number | null;
}

export interface AuditReport {
  shape: [number, number, number];
  step: number;
  rate: number;
  living: number;
  withDominant: number;
  predictedKilled: number;
  observedChanged: number;
  /** Cells the model predicts emptied whose end state is the same without the kill: the cell was dying anyway (B 1, nothing to spare), so nothing tells the builds apart there. */
  indistinguishable: number;
  mismatches: number;
  mismatchSample: number[];
  emptyViolations: number;
  matterOk: boolean;
  residual: string;
  heatExtra: string;
  byNdom: { ndom: number; cells: number; killed: number; expected: number }[];
}

export interface RehearsalReport {
  seed: number;
  jobs: JobLine[];
  vcheck: { identical: boolean; endHashEqual: boolean; burnHashEqual: boolean; bytes: number };
  burnHashesEqual: boolean;
  handOver: { continuousHash: string; jobHash: string; steps: number; equal: boolean };
  audit: AuditReport;
  /** The mobility meter (3.1) at two spreads, 5,000 steps, B_meter 28, seed 905: plumbing; the review's scratch measured about 0.04 at spread 16. */
  meter: MeterLine[];
  readout: { loaded: number; problems: string[] };
}

/** The six face directions; a missing z neighbour is absent (it never preys). */
const FACES: readonly (readonly [number, number, number])[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** ndom of every cell of `s`, from the state itself (valid as the post-transport state only when transport is the identity). */
export function dominantFaces(s: WorldState, rpsMin: number): Uint8Array {
  const n = cellCount(s.cfg);
  const W = worldW(s.cfg);
  const H = worldH(s.cfg);
  const D = s.cfg.tileD!;
  const out = new Uint8Array(n);
  for (let z = 0; z < D; z++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (z * H + y) * W + x;
        if ((s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) === 0) continue;
        const t = (s.genome[G.PARAM1 * n + i] >>> 8) & 0xff;
        let nd = 0;
        for (const [dx, dy, dz] of FACES) {
          const zz = z + dz;
          if (zz < 0 || zz >= D) continue;
          const j = (zz * H + ((y + dy + H) % H)) * W + ((x + dx + W) % W);
          if (s.cells[CH.B * n + j] >= rpsMin && ((s.cells[CH.MOT * n + j] >>> (24 + t)) & 1) === 1) nd++;
        }
        out[i] = nd;
      }
    }
  }
  return out;
}

/** Is the cell empty the way the vacancy kill leaves it: B = P = E = 0, both lineage words 0, MOT at rest (mirror included)? */
const isEmptied = (s: WorldState, i: number): boolean => {
  const n = cellCount(s.cfg);
  return (
    s.cells[CH.B * n + i] === 0 && s.cells[CH.P * n + i] === 0 && s.cells[CH.E * n + i] === 0 &&
    s.genome[G.LIN_HI * n + i] === 0 && s.genome[G.LIN_LO * n + i] === 0 && s.cells[CH.MOT * n + i] === MOT_ZERO3
  );
};

async function oneStep(make: SimFactory, state: WorldState, settings: Record<string, unknown>, id: string): Promise<WorldState> {
  const sim = await make({ jobId: id, attempt: 1, phase: "run", cfg: state.cfg, settings }, state);
  try {
    await sim.run(1);
    return await sim.readState();
  } finally {
    sim.destroy();
  }
}

/** Audit 4: the vacancy rule against its host model, one step from a settled state. */
export async function auditVacancy(make: SimFactory, log: (l: string) => void): Promise<AuditReport> {
  const shape: [number, number, number] = [64, 64, 4];
  const seed = 902;
  // dtQ 0 and spread 0: a cell at rest exports nothing and no flow displaces it, so transport is the identity
  const cfg = { ...jobConfig("S0", shape, 0, seed), dtQ: 0 };
  const mix = mixParams("S0");
  const rpsMin = killSettings("vacancy", 0, "S0").rpsMin as number;
  const settle = await make({ jobId: "audit-settle", attempt: 1, phase: "burn", cfg, settings: killSettings("removal", 0, "S0") }, rpsMix(cfg, mix));
  let S: WorldState;
  try {
    await settle.run(500);
    S = await settle.readState();
  } finally {
    settle.destroy();
  }
  const n = cellCount(cfg);
  const baseline = baselineOf(S);
  const A = await oneStep(make, S, killSettings("vacancy", 0, "S0"), "audit-rate0");
  const B = await oneStep(make, S, killSettings("vacancy", AUDIT_RATE, "S0"), "audit-vacancy");
  const nd = dominantFaces(S, rpsMin);
  let living = 0;
  let withDominant = 0;
  let predictedKilled = 0;
  let observedChanged = 0;
  let indistinguishable = 0;
  let mismatches = 0;
  let emptyViolations = 0;
  const sample: number[] = [];
  const byN = new Map<number, { cells: number; killed: number }>();
  for (let i = 0; i < n; i++) {
    const isLiving = (S.genome[G.LIN_HI * n + i] | S.genome[G.LIN_LO * n + i]) !== 0;
    if (isLiving) living++;
    const d = nd[i];
    if (d > 0) withDominant++;
    const predicted = isLiving && d >= 1 && (draw(cellBase(seed, S.step, i), 40) & 0xffff) < Math.min(65536, AUDIT_RATE * d);
    let changed = false;
    for (let ch = 0; ch < 7 && !changed; ch++) changed = A.cells[ch * n + i] !== B.cells[ch * n + i];
    for (let g = 0; g < 4 && !changed; g++) changed = A.genome[g * n + i] !== B.genome[g * n + i];
    if (isLiving) {
      const e = byN.get(d) ?? { cells: 0, killed: 0 };
      e.cells++;
      if (predicted) e.killed++;
      byN.set(d, e);
    }
    if (predicted) predictedKilled++;
    if (changed) observedChanged++;
    if (changed !== predicted) {
      const dyingAnyway = predicted && !changed && A.cells[CH.B * n + i] === 0 && A.cells[CH.P * n + i] === 0 && (A.genome[G.LIN_HI * n + i] | A.genome[G.LIN_LO * n + i]) === 0;
      if (dyingAnyway) indistinguishable++;
      else {
        mismatches++;
        if (sample.length < 8) sample.push(i);
      }
    }
    if (predicted && !isEmptied(B, i)) emptyViolations++;
  }
  const cons = conservationOf(cfg, baseline, { cells: B.cells, lightIn: B.lightIn, heatOut: B.heatOut });
  const consA = conservationOf(cfg, baseline, { cells: A.cells, lightIn: A.lightIn, heatOut: A.heatOut });
  const report: AuditReport = {
    shape,
    step: S.step,
    rate: AUDIT_RATE,
    living,
    withDominant,
    predictedKilled,
    observedChanged,
    indistinguishable,
    mismatches,
    mismatchSample: sample,
    emptyViolations,
    matterOk: cons.matter === baseline.matter && consA.matter === baseline.matter,
    residual: `${cons.residual}/${consA.residual}`,
    heatExtra: String(B.heatOut - A.heatOut),
    byNdom: [...byN.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => ({ ndom: k, cells: v.cells, killed: v.killed, expected: Math.min(1, (AUDIT_RATE * k) / 65536) })),
  };
  log(`audit: step ${S.step}, ${living} living, ${withDominant} with a dominant face, predicted ${predictedKilled} emptied, observed ${observedChanged} changed (${indistinguishable} predicted cells were dying anyway), ${mismatches} mismatches, ${emptyViolations} not emptied as the lesion leaves a cell`);
  return report;
}

const livingSeries = (rows: RpsCensusRecord[]): (number | null)[] => rows.map((r) => r.living);

/**
 * The pass condition of the rehearsal: every plumbing check holds. The audit's two one-step runs (the vacancy build and the rate-0
 * build) must close the energy ledger exactly as well as keep matter (`residual` is "a/b" for the two), and the loader must read the
 * files without a problem.
 */
export function plumbingOk(rep: RehearsalReport): boolean {
  const au = rep.audit;
  return (
    rep.vcheck.identical &&
    rep.vcheck.endHashEqual &&
    rep.handOver.equal &&
    rep.burnHashesEqual &&
    au.mismatches === 0 &&
    au.emptyViolations === 0 &&
    au.matterOk &&
    au.residual === "0/0" &&
    rep.meter.every((m) => m.Dlab !== null && m.Dlab > 0) &&
    rep.readout.problems.length === 0 &&
    rep.jobs.every((j) => j.matterOk === true && j.residual === "0")
  );
}

export interface RehearsalOptions {
  out: string;
  /** The repository root (the readout's loader is given it). */
  root: string;
  makeSim: SimFactory;
  host: string;
  device: string;
  log: (line: string) => void;
}

/** The four rehearsal jobs. */
export function rehearsalDefs(): { control: JobDef; vacancyBuild: JobDef; removal: JobDef; vacancy: JobDef } {
  const base = { spread: REHEARSAL_SPREAD, seed: REHEARSAL_SEED, runSteps: REHEARSAL_STEPS };
  return {
    control: mkJobDef({ stage: "g0.vcheck", rung: "S0", kill: "removal", substrate: "S0", rate: 0, ...base }),
    vacancyBuild: mkJobDef({ stage: "g0.vcheck", rung: "V", kill: "vacancy", substrate: "S0", rate: 0, ...base }),
    removal: mkJobDef({ stage: "g0.table", rung: "S0", rate: REHEARSAL_REMOVAL_RATE, ...base }),
    vacancy: mkJobDef({ stage: "g0.table", rung: "V", substrate: "S0", rate: REHEARSAL_VACANCY_RATE, ...base }),
  };
}

export async function rehearse(o: RehearsalOptions): Promise<RehearsalReport> {
  fs.mkdirSync(o.out, { recursive: true });
  const deps: KernelJobDeps = { makeSim: o.makeSim, host: o.host, device: o.device, log: o.log, logEvery: 3 };
  const defs = rehearsalDefs();
  const results = new Map<string, KernelJobResult>();
  for (const d of [defs.control, defs.vacancyBuild, defs.removal, defs.vacancy]) {
    results.set(d.id, await executeKernelJob(runSpecOf(d, "rehearsal"), deps, o.out));
    o.log(`rehearsal job ${d.id}: ${results.get(d.id)!.status}`);
  }
  const read = (d: JobDef) => {
    const dir = path.join(o.out, d.id);
    return { summary: JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8")) as Record<string, unknown>, text: fs.readFileSync(path.join(dir, "census.tsv"), "utf8") };
  };
  const lines: JobLine[] = [];
  const data = new Map<string, ReturnType<typeof read>>();
  for (const d of [defs.control, defs.vacancyBuild, defs.removal, defs.vacancy]) {
    const r = read(d);
    data.set(d.id, r);
    const rows = parseRpsCensusTsv(r.text).filter((x) => x.phase === "run");
    const ndom = rows.reduce((a, x) => a + (x.ndom ?? 0), 0);
    const nanti = rows.reduce((a, x) => a + (x.nanti ?? 0), 0);
    lines.push({
      id: d.id,
      kill: d.kill,
      rate: d.rate,
      status: results.get(d.id)!.status,
      steps: r.summary.steps as number,
      stop: r.summary.stop,
      stepsPerSec: r.summary.stepsPerSec,
      matterOk: r.summary.matterOk,
      residual: r.summary.residual,
      burnHash: r.summary.burnHash,
      endHash: r.summary.endHash,
      living: livingSeries(parseRpsCensusTsv(r.text)),
      changes: { ndom, nanti, chi: chirality(ndom, nanti) },
    });
  }
  const c = data.get(defs.control.id)!;
  const v = data.get(defs.vacancyBuild.id)!;
  const vcheck = {
    identical: c.text === v.text,
    endHashEqual: c.summary.endHash === v.summary.endHash,
    burnHashEqual: c.summary.burnHash === v.summary.burnHash,
    bytes: c.text.length,
  };
  const burnHashesEqual = new Set(lines.map((l) => l.burnHash)).size === 1;

  // 3. hand-over: one continuous run of the control world against the two-phase job
  const controlCfg = jobConfig("S0", defs.control.shape, REHEARSAL_SPREAD, REHEARSAL_SEED);
  const steps = c.summary.steps as number;
  const cont = await o.makeSim({ jobId: "handover-continuous", attempt: 1, phase: "burn", cfg: controlCfg, settings: killSettings("removal", 0, "S0") }, rpsMix(controlCfg, mixParams("S0")));
  let continuousHash: string;
  try {
    for (let k = 0; k < steps; k += 1000) await cont.run(Math.min(1000, steps - k));
    continuousHash = stateHash(await cont.readState());
  } finally {
    cont.destroy();
  }
  const handOver = { continuousHash, jobHash: String(c.summary.endHash), steps, equal: continuousHash === c.summary.endHash };
  o.log(`hand-over: continuous ${continuousHash} job ${handOver.jobHash} (${handOver.equal ? "equal" : "DIFFERENT"})`);

  // 4. the audit
  const audit = await auditVacancy(o.makeSim, o.log);

  // 5. the mobility meter at two spreads (the full 5,000 steps: a few seconds each)
  const meter: MeterLine[] = [];
  for (const v of REHEARSAL_METER_SPREADS) {
    for (const axis of ["x", "y"] as const) {
      const d = mkJobDef({ stage: "g0.meter", kind: "meter", rung: "S0", spread: v, rate: 0, seed: REHEARSAL_METER_SEED, runSteps: METER_STEPS, axis, bMeter: 28 });
      const r = await runMeterJob(d, deps, o.out, "rehearsal");
      o.log(`rehearsal meter ${d.id}: ${r.status}`);
    }
    const pr = new Problems();
    const mj = loadJobs(nodeIo(o.root), o.out, pr).filter((j) => j.s.stage === "g0.meter" && j.s.spread === v && j.s.seed === REHEARSAL_METER_SEED);
    const pt = meterPoint(v, mj);
    const w = (axis: "x" | "y") => mj.find((j) => j.s.meter?.axis === axis)?.s.meter?.W ?? null;
    meter.push({ spread: v, Dx: pt.Dx, Dy: pt.Dy, Dlab: pt.Dlab, W: { x: w("x"), y: w("y") }, stepsPerSec: mj[0]?.s.stepsPerSec ?? null });
    o.log(`meter spread ${v}: D_x ${pt.Dx?.toFixed(4)} D_y ${pt.Dy?.toFixed(4)} D_lab ${pt.Dlab?.toFixed(4)}`);
  }

  const report: RehearsalReport = { seed: REHEARSAL_SEED, jobs: lines, vcheck, burnHashesEqual, handOver, audit, meter, readout: { loaded: 0, problems: [] } };
  return report;
}

