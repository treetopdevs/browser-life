// Tests of the Gate-0 spike's pure parts (experiments/3d-rps/gate0-spike/): the shader patch and its kill-form switch (text only, no
// GPU), the worlds, the rungs, the job tables, the planner, the command line, the SHA-256 recipe, and the meter job on the CPU
// reference. The GPU is exercised by the rehearsal (gate0.ts --rehearsal), not here. Nothing here is a result.

import { reactShader3 as nativeReactShader3 } from "../../packages/sim-gpu/src/shaders3d.ts";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { labelMixingW, rpsLabels, rpsMirrorMismatches } from "@bl/metrics";
import { CH, G, MOT_ZERO3, cellCount, stateHash, validateConfig, worldH, worldW, type WorldState } from "@bl/schema";
import { LOST_RACE_PREFIX, StageStop, executeKernelJob, foundingProblems, publishJob, stopRule15, type CensusRead, type KernelSim, type SimContext, type SimFactory } from "../3d-rps/lib/kernel-job.ts";
import { ALL_RUNGS, SPIKE_RECIPE, UsageError, parseArgs, parseSidecar, sha256Hex, sidecarText, spikeHash, spikeListing } from "../3d-rps/gate0-spike/cli.ts";
import { freezeRefusal, gate0Refusal } from "../3d-rps/frozen.ts";
import { runMeterJob, runSpecOf } from "../3d-rps/gate0-spike/jobs.ts";
import { applySettings } from "../3d-rps/gate0-spike/adapter.ts";
import { slabCfg } from "../3d-rps/gate0-spike/lib.ts";
import { plumbingOk, type RehearsalReport } from "../3d-rps/gate0-spike/rehearsal.ts";
import {
  confirmDefs, denseDef, horizonDefs, horizonRungDefs, jobId, meterDefs, mkJobDef, ownerOf, planNext, scanDefs, shareOf, tableDefs, vTableDefs, vcheckDefs,
  type JobDef, type PlanOptions,
} from "../3d-rps/gate0-spike/plan.ts";
import { HORIZON_RUNG_SHAPE, METER_STEPS, METER_ZERO, RUNGS, SHAPE, jobConfig, killSettings, meterConfig, mixParams } from "../3d-rps/gate0-spike/rungs.ts";
import { RPS, reactShader3 } from "../3d-rps/gate0-spike/shaders3d-rps.ts";
import { rpsMix, stripeWorld } from "../3d-rps/gate0-spike/world.ts";
import { evaluateGate0 } from "../3d-rps/readout-gate0.ts";
import { Problems } from "../3d-rps/readout-jobs.ts";
import { loadJobs, nodeIo } from "../3d-rps/readout.ts";
import { meterPoint } from "../3d-rps/readout-gate0.ts";
import { CARPETS_5, DLAB_5, DLAB_3, CARPETS_3, G_3, G_5, denseJob, meterJob, rungJobs, vJobs, vlmh, type RungScenario, type VScenario } from "./rps-fixtures.ts";
import { refCfg } from "./rps-ref-sim.ts";
import type { Job } from "../3d-rps/readout-jobs.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SPIKE = path.join(ROOT, "experiments", "3d-rps", "gate0-spike");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rps-gate0-spike-"));
let dirCounter = 0;
const freshDir = (): string => path.join(tmpRoot, `d${dirCounter++}`);
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** The two arrays the census reads, from a whole state. */
const snapOf = (s: WorldState) => ({ cells: s.cells, genomeHead: s.genome.subarray(0, 4 * cellCount(s.cfg)) });

// ---------------------------------------------------------------------------------------------------------------------
// The shader patch
// ---------------------------------------------------------------------------------------------------------------------

describe("the spike's shader patch and the kill-form switch", () => {
  const cfg = slabCfg(128, 128, 4, 50, 12, 16384, 401, { spread: 16, mutRate: 0 });
  const text = (on: boolean, rate: number, min: number, kill: "removal" | "vacancy") => {
    RPS.on = on;
    RPS.rate = rate;
    RPS.min = min;
    RPS.kill = kill;
    return reactShader3(cfg);
  };
  afterEach(() => {
    RPS.on = false;
    RPS.rate = 0;
    RPS.min = 4;
    RPS.kill = "removal";
  });

  it("defaults to the removal kill, so the prototype's own drivers behave as before", () => {
    expect(RPS).toEqual({ on: false, rate: 0, min: 4, kill: "removal" });
  });

  it("the removal form is the prototype's text byte for byte (hashes taken from the original runs/rps/review/proto/shaders3d-rps.ts)", () => {
    expect(sha(text(false, 0, 4, "removal"))).toBe("873ce2918a1f5f746d2bdbc2990249fdd6536fb29e9d0bfa05a52fe7ec6df43d");
    expect(sha(text(true, 0, 4, "removal"))).toBe("eb4f12e95d1db3dbb9ab842a7432e2086504c40e9ea1cf30445796e01122c0fe");
    expect(sha(text(true, 128, 4, "removal"))).toBe("d24ed9b60c885d4a35292f6235d8901e42dbd97a96629b48065e341752b911b6");
    expect(sha(text(true, 64, 16, "removal"))).toBe("065cf60378cceb05ddf953c706d47d0b18b10e721aeb92aa17bef6c84fffcbb1");
  });

  it("with the patch off the shipped shader is returned for either form", () => {
    expect(text(false, 0, 4, "vacancy")).toBe(text(false, 0, 4, "removal"));
  });

  it("pins the vacancy form's text (a change to the V rule must be deliberate)", () => {
    expect(sha(text(true, 0, 4, "vacancy"))).toBe("895ffd7385888e7713ce1e952b9eb94e6a7b6f8d8239a25bbcb7cd811cd72d49");
    expect(sha(text(true, 1024, 4, "vacancy"))).toBe("761c8fdc4526b658fbc7f83cfe7a266c6c3e36e048d5cc1ad43476cec5c29366");
  });

  it("the vacancy kill empties a living cell with a dominant face by the threshold test of 4.3a, as the 2D injury lesion does", () => {
    const v = text(true, 1024, 4, "vacancy");
    // no B > 0 guard, no removal state, no flux booking
    expect(v).toContain("if (living && RPS_RATE > 0u) {");
    expect(v).not.toContain("killq");
    expect(v).not.toContain("qk");
    expect(v).not.toContain("F[FX_BDECAY] = q + ");
    expect(v).toContain("F[FX_BDECAY] = q;");
    // the threshold test: (draw & 0xffff) < min(65536, rate * ndom), slot 40
    expect(v).toContain("const RND_RPS_KILL = 40u;");
    expect(v).toContain("(draw(base, RND_RPS_KILL) & 0xffffu) < min(65536u, RPS_RATE * ndom)");
    // the lesion: heat B (eB - eC) + P (eP - eC) + E, three hadd calls, C += B + P, B = P = E = 0; A and S are not touched
    expect(v).toContain("hadd(B * (E_B - E_C)); hadd(P * (E_P - E_C)); hadd(E);");
    expect(v).toContain("C += B + P; B = 0u; P = 0u; E = 0u;");
    const block = v.slice(v.indexOf("if (living && RPS_RATE > 0u) {"), v.indexOf("    if (living && B > 0u) {\n      var words"));
    expect(block).not.toMatch(/\bA \+?=|\bS \+?=|\bA -=|\bS -=/);
    // the block sits before the controller block and after the pool caps
    expect(v.indexOf("S = POOL_MAX3;")).toBeLessThan(v.indexOf("if (living && RPS_RATE > 0u) {"));
    expect(v.indexOf("if (living && RPS_RATE > 0u) {")).toBeLessThan(v.indexOf("if (living && B > 0u) {\n      var words"));
  });

  it("both forms count the dominant faces with one and the same loop, and carry the mirror OR at the MOT store", () => {
    const loop = (t: string) => t.slice(t.indexOf("let t_own"), t.indexOf("if (ndom > 0u"));
    const r = text(true, 128, 4, "removal");
    const v = text(true, 128, 4, "vacancy");
    expect(loop(r).length).toBeGreaterThan(300);
    expect(loop(v)).toBe(loop(r));
    for (const t of [r, v]) {
      expect(t).toContain("cellsOut[CH_MOT + i] = mot | (mm << 24u);");
      expect(t).toContain("if (jn == OUTSIDE) { continue; }");
      expect(t).toContain("cells[CH_B + jn] >= RPS_MIN");
      expect(t).toContain("((cells[CH_MOT + jn] >> (24u + t_own)) & 1u) == 1u");
    }
  });

  it("bakes the rate and rpsMin into the text", () => {
    expect(text(true, 4096, 16, "vacancy")).toContain("const RPS_RATE = 4096u;\nconst RPS_MIN = 16u;");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Worlds, rungs
// ---------------------------------------------------------------------------------------------------------------------

describe("the rps-mix founding (plan 4.4)", () => {
  const cfg = jobConfig("S0", SHAPE, 16, 401);
  const n = cellCount(cfg);
  const s = rpsMix(cfg, mixParams("S0"));

  it("is the prototype's world: bit for bit the same state (hashes of the prototype's own inline founding, same seed and config)", () => {
    expect(stateHash(s)).toBe("a64f58dd33a0c9c0");
    expect(stateHash(rpsMix(jobConfig("S0", SHAPE, 16, 901), mixParams("S0")))).toBe("f47a91dcd01ee4d9");
    expect(stateHash(rpsMix(jobConfig("S0", SHAPE, 16, 9001), mixParams("S0")))).toBe("c6d2dabdd759e7a0");
  });

  it("is deterministic and depends on the seed", () => {
    expect(stateHash(rpsMix(cfg, mixParams("S0")))).toBe(stateHash(s));
    expect(stateHash(rpsMix(jobConfig("S0", SHAPE, 16, 402), mixParams("S0")))).not.toBe(stateHash(s));
  });

  it("occupies about 75 % of the cells, a column keeps one occupant through its layers, and the labels are about a third each", () => {
    const WH = 128 * 128;
    let occupied = 0;
    const counts = [0, 0, 0];
    for (let c = 0; c < WH; c++) {
      const lin = (z: number) => s.genome[G.LIN_LO * n + z * WH + c];
      for (let z = 1; z < 4; z++) {
        expect(lin(z)).toBe(lin(0));
        expect(s.genome[G.PARAM1 * n + z * WH + c]).toBe(s.genome[G.PARAM1 * n + c]);
      }
      if (lin(0) !== 0) {
        occupied++;
        counts[lin(0) - 1]++;
      }
    }
    expect(occupied / WH).toBeGreaterThan(0.73);
    expect(occupied / WH).toBeLessThan(0.77);
    for (const k of counts) expect(k / occupied).toBeGreaterThan(0.3);
    for (const k of counts) expect(k / occupied).toBeLessThan(0.37);
  });

  it("gives a living cell lineage (0, 1 + type), PARAM1 type and mask, a matching MOT mirror, B up to 2 biomass and E = 2 B; a vacant cell is empty", () => {
    let living = 0;
    let bSum = 0;
    for (let i = 0; i < n; i++) {
      const lo = s.genome[G.LIN_LO * n + i];
      expect(s.cells[CH.A * n + i]).toBe(20);
      if (lo === 0) {
        expect([s.genome[G.LIN_HI * n + i], s.cells[CH.B * n + i], s.cells[CH.E * n + i], s.cells[CH.MOT * n + i]]).toEqual([0, 0, 0, MOT_ZERO3]);
        continue;
      }
      living++;
      const t = lo - 1;
      const p1 = s.genome[G.PARAM1 * n + i];
      expect(s.genome[G.LIN_HI * n + i]).toBe(0);
      expect((p1 >>> 8) & 0xff).toBe(t);
      expect((p1 >>> 16) & 0xff).toBe(1 << ((t + 1) % 3));
      expect(s.cells[CH.MOT * n + i] >>> 24).toBe(1 << ((t + 1) % 3));
      const B = s.cells[CH.B * n + i];
      expect(B).toBeLessThanOrEqual(32);
      expect(s.cells[CH.E * n + i]).toBe(2 * B);
      bSum += B;
    }
    expect(bSum / living).toBeGreaterThan(15);
    expect(bSum / living).toBeLessThan(17);
    expect(rpsMirrorMismatches(snapOf(s), { W: 128, H: 128, D: 4 })).toBe(0);
  });

  it("columns false founds every layer on its own", () => {
    const free = rpsMix(cfg, { ...mixParams("S0"), columns: false });
    let differing = 0;
    for (let c = 0; c < 128 * 128; c++) if (free.genome[G.LIN_LO * n + c] !== free.genome[G.LIN_LO * n + 128 * 128 + c]) differing++;
    expect(differing).toBeGreaterThan(1000);
  });

  it("the rungs found with their own nutrient and biomass", () => {
    for (const r of ["S1", "S2"] as const) {
      const w = rpsMix(jobConfig(r, SHAPE, 16, 401), mixParams(r));
      expect(w.cells[CH.A * n]).toBe(RUNGS[r].nutrient);
      let maxB = 0;
      for (let i = 0; i < n; i++) maxB = Math.max(maxB, w.cells[CH.B * n + i]);
      expect(maxB).toBeGreaterThan(RUNGS[r].biomass * 1.5);
      expect(maxB).toBeLessThanOrEqual(2 * RUNGS[r].biomass);
    }
  });
});

describe("the inert stripe world (3.1)", () => {
  const cfg = meterConfig("S0", SHAPE, 8, 405);
  const n = cellCount(cfg);

  it("is every cell living with B = B_meter, E = 2 B_meter and nothing else; labels 0 and 1 by halves along the axis", () => {
    for (const axis of ["x", "y"] as const) {
      const s = stripeWorld(cfg, axis, 28);
      for (let i = 0; i < n; i++) {
        expect([s.cells[CH.A * n + i], s.cells[CH.B * n + i], s.cells[CH.C * n + i], s.cells[CH.P * n + i], s.cells[CH.E * n + i], s.cells[CH.S * n + i], s.cells[CH.MOT * n + i]]).toEqual([0, 28, 0, 0, 56, 0, MOT_ZERO3]);
      }
      const labels = rpsLabels(snapOf(s), { W: 128, H: 128, D: 4 });
      for (let z = 0; z < 4; z++) for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) expect(labels[(z * 128 + y) * 128 + x]).toBe((axis === "x" ? x : y) < 64 ? 0 : 1);
      // two sharp interfaces: no line is mixed, so the width is 0
      expect(labelMixingW(labels, { W: 128, H: 128, D: 4 }, axis)).toBe(0);
    }
  });

  it("the meter config has every rate constant and dtQ at 0 and no mutation, and validates", () => {
    expect(validateConfig(cfg)).toEqual([]);
    for (const [k, v] of Object.entries(METER_ZERO)) expect((cfg as unknown as Record<string, number>)[k]).toBe(v);
    expect(Object.keys(METER_ZERO)).toHaveLength(14);
    expect(cfg.dtQ).toBe(0);
    expect(cfg.mutRate).toBe(0);
    expect(cfg.seed).toBe(405);
    expect(METER_STEPS).toBe(5000);
  });
});

describe("the rungs (G0.1)", () => {
  it("S0 is the substrate of plan 7.1", () => {
    const c = jobConfig("S0", SHAPE, 16, 401);
    expect(validateConfig(c)).toEqual([]);
    expect([c.tileW, c.tileH, c.tileD, c.kernelRadius, c.lightMode, c.lightBase, c.lightAmp, c.lightK, c.defaultMu, c.defaultSigma, c.mutRate, c.spread, c.seed]).toEqual([128, 128, 4, 3, "uniform", 40, 200, 16384, 50, 12, 0, 16, 401]);
    expect([c.kCatHalf, c.massUnit, c.thetaMass, c.dtQ, c.eventCap]).toEqual([128, 256, 512, 51, 1 << 16]);
    expect(RUNGS.S0).toMatchObject({ scale: 1, nutrient: 20, biomass: 16, rpsMin: 4 });
    expect(mixParams("S0")).toEqual({ K0: 3, occupied: 75, nutrient: 20, biomass: 16, columns: true });
  });

  it("S1 is matter scale 4 and S2 scale 8, with the constants of G0.1", () => {
    const s1 = jobConfig("S1", SHAPE, 16, 401);
    const s2 = jobConfig("S2", SHAPE, 16, 401);
    expect(validateConfig(s1)).toEqual([]);
    expect(validateConfig(s2)).toEqual([]);
    expect([s1.kCatHalf, s1.massUnit, s1.thetaMass]).toEqual([512, 1024, 2048]);
    expect([s2.kCatHalf, s2.massUnit, s2.thetaMass]).toEqual([1024, 2048, 2048]);
    expect(RUNGS.S1).toMatchObject({ scale: 4, nutrient: 80, biomass: 64, rpsMin: 16 });
    expect(RUNGS.S2).toMatchObject({ scale: 8, nutrient: 160, biomass: 128, rpsMin: 32 });
    // everything else is S0's
    const s0 = jobConfig("S0", SHAPE, 16, 401);
    for (const k of Object.keys(s0) as (keyof typeof s0)[]) if (!["kCatHalf", "massUnit", "thetaMass"].includes(k)) expect(s1[k]).toEqual(s0[k]);
  });

  it("the settings outside WorldConfig carry the kill form, the rate and the rung's rpsMin", () => {
    expect(killSettings("removal", 128, "S0")).toEqual({ rpsKill: "removal", rpsRate: 128, rpsMin: 4, rpsTypes: 3, rpsFlip: 0, rpsEdge: 0 });
    expect(killSettings("vacancy", 1024, "S1")).toEqual({ rpsKill: "vacancy", rpsRate: 1024, rpsMin: 16, rpsTypes: 3, rpsFlip: 0, rpsEdge: 0 });
    expect(killSettings("vacancy", 0, "S2").rpsMin).toBe(32);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The job tables
// ---------------------------------------------------------------------------------------------------------------------

describe("the Gate-0 job tables", () => {
  it("G0.2 scan: 12 spreads, rate 0, seed 401, 20,000 steps; meters: x and y per carpet spread, seed 405, 5,000 steps", () => {
    const scan = scanDefs("S0");
    expect(scan.map((d) => d.spread)).toEqual([2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32]);
    expect(scan.every((d) => d.stage === "g0.scan" && d.rate === 0 && d.seed === 401 && d.runSteps === 20_000 && d.rung === "S0" && d.kill === "removal" && d.kind === "run")).toBe(true);
    const m = meterDefs("S1", [4, 8], 112);
    expect(m.map((d) => [d.spread, d.axis])).toEqual([[4, "x"], [4, "y"], [8, "x"], [8, "y"]]);
    expect(m.every((d) => d.kind === "meter" && d.seed === 405 && d.runSteps === 5000 && d.bMeter === 112 && d.rung === "S1")).toBe(true);
  });

  it("G0.3 table of a substrate rung: 42 jobs (the three rate-0 seed-401 cells are the scan jobs), rates 0 8 16 32 64, seeds 401 to 403", () => {
    const t = tableDefs("S0", [4, 12, 28]);
    expect(t).toHaveLength(42);
    expect(t.some((d) => d.rate === 0 && d.seed === 401)).toBe(false);
    expect(new Set(t.map((d) => d.rate))).toEqual(new Set([0, 8, 16, 32, 64]));
    expect(t.filter((d) => d.rate === 0).map((d) => d.seed).sort()).toEqual([402, 402, 402, 403, 403, 403]);
    expect(t.every((d) => d.runSteps === 20_000 && d.stage === "g0.table" && d.rung === "S0")).toBe(true);
  });

  it("G0.3 table of rung V: its own 36 jobs at {64, 256, 1024, 4096}, carrying rung V, the vacancy kill and the substrate", () => {
    const t = vTableDefs("S1", [4, 12, 28]);
    expect(t).toHaveLength(36);
    expect(new Set(t.map((d) => d.rate))).toEqual(new Set([64, 256, 1024, 4096]));
    expect(t.every((d) => d.rung === "V" && d.kill === "vacancy" && d.substrate === "S1" && d.stage === "g0.table")).toBe(true);
  });

  it("the V check is the table's rate-0 job at v_mid, seed 401, with each build", () => {
    const [rem, vac] = vcheckDefs("S0", 12);
    expect([rem.kill, vac.kill]).toEqual(["removal", "vacancy"]);
    expect([rem.rung, vac.rung]).toEqual(["S0", "V"]);
    for (const d of [rem, vac]) expect([d.stage, d.spread, d.rate, d.seed, d.runSteps, d.substrate]).toEqual(["g0.vcheck", 12, 0, 401, 20_000, "S0"]);
    expect(rem.id).not.toBe(vac.id);
  });

  it("G0.4 horizon: three rate-0 jobs at v_mid, 200,000 steps; G0.5 confirmation: v_cal at kappa_w for h0 steps; G0.6: seed 404; the horizon rung: 256 x 256 x 4", () => {
    const h = horizonDefs("S0", 12);
    expect(h.map((d) => [d.seed, d.spread, d.rate, d.runSteps, d.stage])).toEqual([401, 402, 403].map((s) => [s, 12, 0, 200_000, "g0.horizon"]));
    const c = confirmDefs("S0", "S0", 8, 16, 100_000);
    expect(c.map((d) => [d.seed, d.spread, d.rate, d.runSteps, d.stage])).toEqual([401, 402, 403].map((s) => [s, 8, 16, 100_000, "g0.confirm"]));
    const cv = confirmDefs("V", "S0", 8, 256, 50_000);
    expect(cv.every((d) => d.rung === "V" && d.kill === "vacancy" && d.substrate === "S0" && d.rate === 256)).toBe(true);
    const dn = denseDef("S0", "S0", 12);
    expect([dn.seed, dn.rate, dn.runSteps, dn.stage]).toEqual([404, 0, 20_000, "g0.dense"]);
    const hr = horizonRungDefs("S0", 12);
    expect(hr).toHaveLength(3);
    expect(hr.every((d) => d.shape === HORIZON_RUNG_SHAPE && d.stage === "g0.horizon-rung" && d.runSteps === 200_000)).toBe(true);
    expect([...HORIZON_RUNG_SHAPE]).toEqual([256, 256, 4]);
  });

  it("every job has its own directory name", () => {
    const all = [
      ...["S0", "S1", "S2"].flatMap((r) => [...scanDefs(r as "S0"), ...meterDefs(r as "S0", [4, 8, 12], 28), ...tableDefs(r as "S0", [4, 12, 28]), ...horizonDefs(r as "S0", 12), ...confirmDefs(r as "S0", r as "S0", 12, 16, 50_000)]),
      ...vTableDefs("S0", [4, 12, 28]),
      ...vcheckDefs("S0", 12),
      ...confirmDefs("V", "S0", 12, 256, 50_000),
      denseDef("S0", "S0", 12),
      ...horizonRungDefs("S0", 12),
    ];
    expect(new Set(all.map((d) => d.id)).size).toBe(all.length);
    for (const d of all) expect(d.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    expect(jobId(scanDefs("S0")[0])).toBe("g0-scan-S0-sp2-r0-s401");
    expect(mkJobDef({ stage: "g0.meter", kind: "meter", rung: "S0", spread: 8, rate: 0, seed: 405, runSteps: 5000, axis: "y", bMeter: 28 }).id).toBe("g0-meter-S0-sp8-r0-s405-y");
  });
});

describe("the job specs", () => {
  it("a removal table job: the rung's config, a burn-in at rate 0 and the run at the job's rate, the early stop of 1.5", () => {
    const d = tableDefs("S1", [4, 12, 28]).find((x) => x.rate === 32 && x.spread === 12 && x.seed === 402)!;
    const spec = runSpecOf(d, "gate0", { loadavg: [1, 2, 3] });
    expect(spec).toMatchObject({ id: d.id, stage: "g0.table", seed: 402, K0: 3, runSteps: 20_000 });
    expect(spec.stop).toBe(stopRule15);
    // 1.5: a job whose burn-in ends in NOSTART stops at the hand-over census (decision O-5)
    expect(spec.nostartStop).toBe(true);
    expect(spec.burn.settings).toEqual(killSettings("removal", 0, "S1"));
    expect(spec.run.settings).toEqual(killSettings("removal", 32, "S1"));
    expect(spec.run.cfg).toEqual(jobConfig("S1", SHAPE, 12, 402));
    expect(spec.summary).toMatchObject({ rung: "S1", kill: "removal", substrate: "S1", spread: 12, rpsRate: 32, rpsMin: 16, rpsTypes: 3, shape: [128, 128, 4], mode: "gate0", loadavg: [1, 2, 3] });
    const s = spec.found();
    expect(s.step).toBe(0);
    expect(s.cfg).toEqual(spec.run.cfg);
    expect(s.cells[CH.A * cellCount(s.cfg)]).toBe(80);
    expect(spec.burn.init).toEqual({ kind: "rps-mix", founders: 3, occupied: 75, nutrient: 80, biomass: 64, columns: true });
  });

  it("a rung V job: the vacancy form in both phases, the substrate recorded", () => {
    const d = vTableDefs("S0", [4, 12, 28]).find((x) => x.rate === 256)!;
    const spec = runSpecOf(d, "gate0");
    expect(spec.burn.settings.rpsKill).toBe("vacancy");
    expect(spec.run.settings).toEqual(killSettings("vacancy", 256, "S0"));
    expect(spec.summary).toMatchObject({ rung: "V", kill: "vacancy", substrate: "S0", rpsRate: 256 });
  });

  it("the horizon rung runs at 256 x 256 x 4, and a meter def is not a run job", () => {
    const hr = runSpecOf(horizonRungDefs("S0", 12)[0], "gate0");
    expect([hr.run.cfg.tileW, hr.run.cfg.tileH, hr.run.cfg.tileD]).toEqual([256, 256, 4]);
    expect(hr.summary?.shape).toEqual([256, 256, 4]);
    expect(() => runSpecOf(meterDefs("S0", [4], 28)[0], "gate0")).toThrow(/not a run job/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------------------------------------------------

/** What the driver would have on disk if it had written the readout fixtures' jobs: their directory names. */
const idsOf = (jobs: readonly Job[]): Set<string> =>
  new Set(
    jobs.map((j) =>
      jobId({
        stage: j.s.stage,
        rung: j.s.rung ?? "S0",
        kill: j.s.kill ?? "removal",
        substrate: j.s.substrate ?? (j.s.rung === "V" || j.s.rung === null ? "S0" : j.s.rung),
        spread: j.s.spread ?? 0,
        rate: j.s.rate ?? 0,
        seed: j.s.seed,
        axis: j.s.meter?.axis ?? undefined,
      }),
    ),
  );

const OPTS: PlanOptions = { rungs: [...ALL_RUNGS], dense: false, planAll: false };
const planOf = (jobs: Job[], o: Partial<PlanOptions> = {}) => {
  const ids = idsOf(jobs);
  const res = evaluateGate0(jobs);
  return { plan: planNext(res, (id) => ids.has(id), { ...OPTS, ...o }), res, ids };
};
const sc = (rung: "S0" | "S1" | "S2", o: Partial<RungScenario> = {}): RungScenario => ({ rung, carpets: CARPETS_5, dlab: DLAB_5, g: G_5, massPerCell: 28, ...o });
/** The fixtures write meters for the carpet spreads only (all the readout needs); the driver also runs those of the other candidate spreads. */
const allMeters = (jobs: Job[], rung: "S0" | "S1" | "S2", carpets: readonly number[] = CARPETS_5): Job[] => [
  ...jobs,
  ...[2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32].filter((v) => !carpets.includes(v)).flatMap((v) => (["x", "y"] as const).map((axis) => meterJob({ rung, spread: v, axis, D: 0.001, bMeter: 28 }))),
];
const count = (defs: readonly JobDef[], stage: string, rung?: string) => defs.filter((d) => d.stage === stage && (rung === undefined || d.rung === rung)).length;

describe("the planner: what runs next", () => {
  it("on an empty disk, the scans of S0 and nothing else: S1 waits behind S0 in the order, S2 and V wait for their conditions", () => {
    const { plan } = planOf([]);
    expect(plan.defs).toHaveLength(12);
    expect(count(plan.defs, "g0.scan", "S0")).toBe(12);
    expect(plan.notes.join("\n")).toContain("S1: not planned yet, S0 comes first in the order S0, S1, S2, V and is not yet excluded");
    expect(plan.notes.join("\n")).toContain("S2: not run");
    expect(plan.notes.join("\n")).toContain("V: not run");
  });

  it("--plan-all on an empty disk: the scans of S0 and S1 side by side, S0's first (D2)", () => {
    const { plan } = planOf([], { planAll: true });
    expect(plan.defs).toHaveLength(24);
    expect(plan.defs.slice(0, 12).every((d) => d.rung === "S0" && d.stage === "g0.scan")).toBe(true);
    expect(plan.defs.slice(12).every((d) => d.rung === "S1" && d.stage === "g0.scan")).toBe(true);
    expect(plan.notes.join("\n")).not.toContain("not planned");
  });

  it("a partly scanned rung plans the scans still to run, and no meter until all twelve are in", () => {
    const jobs = rungJobs(sc("S0", { noScan: [2, 3, 4], table: null, horizon: null }));
    const { plan } = planOf(jobs.filter((j) => j.s.stage === "g0.scan"));
    expect(plan.defs.filter((d) => d.rung === "S0").map((d) => d.spread)).toEqual([2, 3, 4]);
    expect(plan.defs.some((d) => d.stage === "g0.meter")).toBe(false);
  });

  it("all scans in: the meters of all twelve candidate spreads (x and y) with B_meter from the scan", () => {
    const jobs = rungJobs(sc("S0", { noMeter: CARPETS_5, table: null })).filter((j) => j.s.stage === "g0.scan");
    const { plan } = planOf(jobs);
    const meters = plan.defs.filter((d) => d.rung === "S0" && d.stage === "g0.meter");
    expect(meters).toHaveLength(24);
    expect(new Set(meters.map((d) => d.spread))).toEqual(new Set([2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32]));
    expect(meters.every((d) => d.bMeter === 28 && d.seed === 405)).toBe(true);
    // no table yet: G_spread is not known
    expect(plan.defs.some((d) => d.stage === "g0.table")).toBe(false);
  });

  it("meters in: the table at v_lo, v_mid, v_hi of G_spread (42 jobs) and nothing of V or S1 (they come after S0 in the order)", () => {
    const jobs = allMeters(rungJobs(sc("S0", { table: null })), "S0");
    const { plan } = planOf(jobs);
    const [lo, mid, hi] = vlmh(G_5);
    const table = plan.defs.filter((d) => d.rung === "S0" && d.stage === "g0.table");
    expect(table).toHaveLength(42);
    expect(new Set(table.map((d) => d.spread))).toEqual(new Set([lo, mid, hi]));
    expect(plan.defs).toHaveLength(42);
    expect(count(plan.defs, "g0.vcheck")).toBe(0);
    expect(count(plan.defs, "g0.table", "V")).toBe(0);
    expect(count(plan.defs, "g0.scan", "S1")).toBe(0);
  });

  it("--plan-all, meters in: rung V's check and 36 jobs and S1's scan beside the table, in the order S0, S1, V with the V check first among V's", () => {
    const jobs = allMeters(rungJobs(sc("S0", { table: null })), "S0");
    const { plan } = planOf(jobs, { planAll: true });
    expect(count(plan.defs, "g0.table", "S0")).toBe(42);
    expect(count(plan.defs, "g0.vcheck")).toBe(2);
    expect(count(plan.defs, "g0.table", "V")).toBe(36);
    expect(count(plan.defs, "g0.scan", "S1")).toBe(12);
    const iCheck = Math.max(...plan.defs.map((d, i) => (d.stage === "g0.vcheck" ? i : -1)));
    const iFirstV = plan.defs.findIndex((d) => d.rung === "V" && d.stage === "g0.table");
    expect(iCheck).toBeLessThan(iFirstV);
    // S0's jobs, then S1's, then V's (the removal build of the V check carries S0's rung but belongs to V's turn in the queue)
    const turn = (d: JobDef) => (d.stage === "g0.vcheck" ? 3 : ({ S0: 0, S1: 1, S2: 2, V: 3 })[d.rung]);
    expect(plan.defs.map(turn)).toEqual([...plan.defs.map(turn)].sort((a, b) => a - b));
    expect(turn(plan.defs[0])).toBe(0);
  });

  it("a rung with fewer than five levels plans nothing beyond its meters; with S0 and S1 both out on levels, S2 appears", () => {
    const lev3 = (r: "S0" | "S1") => allMeters(rungJobs(sc(r, { carpets: CARPETS_3, dlab: DLAB_3, g: G_3, table: null, horizon: null })), r, CARPETS_3);
    const { plan, res } = planOf([...lev3("S0"), ...lev3("S1")]);
    expect(res.rungs.map((e) => e.verdict)).toEqual(["NO-GO: LEVELS", "NO-GO: LEVELS", null]);
    expect(plan.defs.filter((d) => d.rung === "S0" || d.rung === "S1")).toEqual([]);
    expect(count(plan.defs, "g0.scan", "S2")).toBe(12);
    expect(plan.defs).toHaveLength(12);
  });

  it("the table in: the horizon at v_mid (shared by the substrate and V) once kappa_w exists", () => {
    const jobs = rungJobs(sc("S0", { horizon: null }));
    const { plan, res } = planOf(jobs);
    expect(res.rungs[0].kappaW).toBe(16);
    const h = plan.defs.filter((d) => d.stage === "g0.horizon");
    expect(h.map((d) => [d.rung, d.spread, d.rate, d.seed, d.runSteps])).toEqual([401, 402, 403].map((s) => ["S0", 12, 0, s, 200_000]));
  });

  it("the horizon in: the confirmation at v_cal and kappa_w for h0 steps", () => {
    const jobs = rungJobs(sc("S0", { horizon: ["CHURN", "CHURN", "CHURN"] }));
    const { plan, res } = planOf(jobs);
    expect(res.rungs[0].horizon?.h0).toBe(200_000);
    const c = plan.defs.filter((d) => d.stage === "g0.confirm" && d.rung === "S0");
    expect(c.map((d) => [d.spread, d.rate, d.seed, d.runSteps])).toEqual([401, 402, 403].map((s) => [res.rungs[0].vCal, 16, s, 200_000]));
  });

  it("a horizon with no h0 (NO-GO: HORIZON) plans no confirmation", () => {
    const jobs = rungJobs(sc("S0", { horizon: ["LOSS", "LOSS", "LOSS"].map((_, k) => ({ LOSS: 5 + k })) as never }));
    const { plan, res } = planOf(jobs);
    expect(res.rungs[0].horizon?.h0).toBeNull();
    expect(plan.defs.some((d) => d.stage === "g0.confirm" && d.rung === "S0")).toBe(false);
  });

  const GO_JOBS = () => allMeters(rungJobs(sc("S0", { horizon: ["CHURN", "CHURN", "CHURN"], confirm: { vCal: 12, rate: 16, h0: 200_000, classes: ["DC", "DC", "DC"] } })), "S0");

  it("--plan-all plans every rung, whatever the first GO: S0 and S1 are both run, and V on the first rung to pass row 1 (the literal D2 mode)", () => {
    const a = planOf(GO_JOBS(), { planAll: true });
    expect(a.res.overall).toEqual({ status: "go", used: "S0" });
    expect(count(a.plan.defs, "g0.scan", "S1")).toBe(12);
    expect(count(a.plan.defs, "g0.vcheck")).toBe(2);
    expect(count(a.plan.defs, "g0.table", "V")).toBe(36);
    expect(a.plan.notes.join("\n")).not.toContain("not planned");
  });

  it("S0 GO stops (decision O-8): a rung that is GO decides it, the rungs after it are not planned, even when named, and the dense job only with --dense", () => {
    const go = GO_JOBS();
    const a = planOf(go);
    expect(a.res.overall).toEqual({ status: "go", used: "S0" });
    expect(a.plan.defs).toEqual([]);
    expect(a.plan.notes.join("\n")).toContain("S1: not planned, S0 already gives GO and the rungs after the first GO of the order S0, S1, S2, V are not run");
    expect(a.plan.notes.join("\n")).toContain("V: not planned, S0 already gives GO");
    // naming a rung does not plan it: it comes after a GO
    expect(planOf(go, { rungs: ["S1"] }).plan.defs).toEqual([]);
    expect(planOf(go, { rungs: ["V"] }).plan.defs).toEqual([]);
    // only --plan-all plans it
    const named = planOf(go, { rungs: ["S1"], planAll: true });
    expect(count(named.plan.defs, "g0.scan", "S1")).toBe(12);
    // dense
    const dense = planOf(go, { dense: true });
    expect(dense.plan.defs).toHaveLength(1);
    expect(dense.plan.defs[0]).toMatchObject({ stage: "g0.dense", rung: "S0", seed: 404, spread: 12, rate: 0, runSteps: 20_000 });
    // the dense job on disk: nothing left
    const done = planOf([...go, denseJob({ rung: "S0", spread: 12, stepsPerSec: 700 })], { dense: true });
    expect(done.plan.defs).toEqual([]);
    expect(done.res.dense?.stepsPerSec).toBe(700);
  });

  it("S0 out on EFFECT and S1 in progress: S1 is next in the order, and V's own rows wait until S1 is excluded too", () => {
    const s0 = rungJobs(sc("S0", { table: () => ["CHURN", "CHURN", "CHURN"] as never, horizon: null }));
    const { plan, res } = planOf(s0);
    expect(res.rungs.find((e) => e.rung === "S0")?.verdict).toBe("NO-GO: EFFECT");
    // V could run on S0's G_spread (S0 passed row 1), but S1 comes first: only S1's scan is planned
    expect(count(plan.defs, "g0.scan", "S1")).toBe(12);
    expect(plan.defs).toHaveLength(12);
    expect(plan.notes.join("\n")).toContain("V: not planned yet, S1 comes first in the order S0, S1, S2, V and is not yet excluded");
  });

  it("--plan-all, S0 out on EFFECT and S1 in progress: V runs on the first rung that passed row 1, beside S1 (D2)", () => {
    const s0 = rungJobs(sc("S0", { table: () => ["CHURN", "CHURN", "CHURN"] as never, horizon: null }));
    const { plan } = planOf(s0, { planAll: true });
    expect(count(plan.defs, "g0.vcheck")).toBe(2);
    expect(count(plan.defs, "g0.table", "V")).toBe(36);
    expect(count(plan.defs, "g0.scan", "S1")).toBe(12);
    // no S0 horizon yet: neither S0 nor V has passed row 2
    expect(count(plan.defs, "g0.horizon")).toBe(0);
  });

  it("S0 NO-GO then S1 GO stops before V's own rows: with S1 GO the plan has no V job at all, and says why", () => {
    const s1go = rungJobs(sc("S1", { horizon: ["CHURN", "CHURN", "CHURN"], confirm: { vCal: 12, rate: 16, h0: 200_000, classes: ["DC", "DC", "DC"] } }));
    const jobs = allMeters([...rungJobs(sc("S0", { table: () => ["CHURN", "CHURN", "CHURN"] as never, horizon: null })), ...s1go], "S1");
    const { plan, res } = planOf(jobs);
    expect(res.overall).toEqual({ status: "go", used: "S1" });
    expect(plan.defs).toEqual([]);
    expect(plan.notes.join("\n")).toContain("V: not planned, S1 already gives GO");
  });

  it("S1 GO behind a pending S0: S0's wave only (S0 may still be the answer), and nothing for V", () => {
    const s0 = allMeters(rungJobs(sc("S0", { horizon: null, confirm: null })), "S0");
    const s1 = allMeters(rungJobs(sc("S1", { horizon: ["CHURN", "CHURN", "CHURN"], confirm: { vCal: 12, rate: 16, h0: 200_000, classes: ["DC", "DC", "DC"] } })), "S1");
    const { plan, res } = planOf([...s0, ...s1]);
    expect(res.overall).toEqual({ status: "pending", waitingFor: ["S0"] });
    expect(plan.defs.map((d) => [d.rung, d.stage])).toEqual([["S0", "g0.horizon"], ["S0", "g0.horizon"], ["S0", "g0.horizon"]]);
    expect(plan.notes.join("\n")).toContain("V: not planned, S1 already gives GO");
  });

  it("S0 and S1 excluded runs V: V's check and 36 rows are planned, and the horizon V shares with its host carries the host's rung", () => {
    const s0 = allMeters(rungJobs(sc("S0", { table: () => ["CHURN", "CHURN", "CHURN"] as never, horizon: null })), "S0");
    const s1 = allMeters(rungJobs(sc("S1", { table: () => ["CHURN", "CHURN", "CHURN"] as never, horizon: null })), "S1");
    const first = planOf([...s0, ...s1]);
    expect(first.res.overall).toEqual({ status: "pending", waitingFor: ["V"] });
    expect(count(first.plan.defs, "g0.vcheck")).toBe(2);
    expect(count(first.plan.defs, "g0.table", "V")).toBe(36);
    expect(first.plan.defs).toHaveLength(38);
    expect(first.plan.defs.some((d) => d.rung === "S1")).toBe(false);
    // V passes row 2: the shared horizon is planned as a job of the host, S0
    const second = planOf([...s0, ...s1, ...vJobs({ host: "S0", g: G_5, substrate: "S0" })]);
    expect(second.plan.defs.filter((d) => d.stage === "g0.horizon").map((d) => [d.rung, d.spread])).toEqual([["S0", 12], ["S0", 12], ["S0", 12]]);
    expect(count(second.plan.defs, "g0.vcheck")).toBe(0);
  });

  it("the queue is in the order of preference: a wave lists S0's jobs, then S1's, then V's (--plan-all, where several rungs are due at once)", () => {
    const s0 = allMeters(rungJobs(sc("S0", { table: () => ["CHURN", "CHURN", "CHURN"] as never, horizon: null })), "S0");
    const { plan } = planOf(s0, { planAll: true });
    const turn = (d: JobDef) => (d.stage === "g0.vcheck" ? 3 : ({ S0: 0, S1: 1, S2: 2, V: 3 })[d.rung]);
    expect(plan.defs.map(turn)).toEqual([...plan.defs.map(turn)].sort((a, b) => a - b));
    expect(new Set(plan.defs.map(turn))).toEqual(new Set([1, 3]));
  });

  it("V passing row 2 plans the shared horizon on its host (jobs that carry the substrate rung), then its own confirmation", () => {
    // V is next in the order once S0 and S1 are excluded (neither kill washes out in S1's table here either)
    const s1 = allMeters(rungJobs(sc("S1", { table: () => ["CHURN", "CHURN", "CHURN"] as never, horizon: null })), "S1");
    const host = [...allMeters(rungJobs(sc("S0", { table: () => ["CHURN", "CHURN", "CHURN"] as never, horizon: null })), "S0"), ...s1];
    const v: VScenario = { host: "S0", g: G_5, substrate: "S0" };
    const a = planOf([...host, ...vJobs(v)]);
    expect(a.res.rungs.find((e) => e.rung === "V")?.kappaW).toBe(256);
    expect(a.plan.defs.filter((d) => d.stage === "g0.horizon").map((d) => [d.rung, d.spread])).toEqual([["S0", 12], ["S0", 12], ["S0", 12]]);
    const withHorizon = [...allMeters(rungJobs(sc("S0", { table: () => ["CHURN", "CHURN", "CHURN"] as never, horizon: ["CHURN", "CHURN", "CHURN"] })), "S0"), ...s1];
    const b = planOf([...withHorizon, ...vJobs(v)]);
    const c = b.plan.defs.filter((d) => d.stage === "g0.confirm");
    expect(c).toHaveLength(3);
    expect(c.every((d) => d.rung === "V" && d.kill === "vacancy" && d.substrate === "S0" && d.rate === 256 && d.runSteps === 200_000)).toBe(true);
  });

  it("only HORIZON failures: after the stop the horizon rung (256 x 256 x 4, G0.4 alone) is planned for the first such rung", () => {
    const loss = (k: number) => ({ LOSS: 3 + k });
    const out = (r: "S0" | "S1") => rungJobs(sc(r, { horizon: [loss(0), loss(1), loss(2)] as never }));
    const v = vJobs({ host: "S0", g: G_5, substrate: "S0", confirm: null });
    const { plan, res } = planOf([...out("S0"), ...out("S1"), ...v]);
    expect(res.overall).toMatchObject({ status: "stop", onlyHorizon: true });
    const hr = plan.defs.filter((d) => d.stage === "g0.horizon-rung");
    expect(hr).toHaveLength(3);
    expect(hr.every((d) => d.rung === "S0" && d.spread === 12 && d.shape[0] === 256)).toBe(true);
  });

  it("--rung limits the jobs to the named rungs; shared jobs belong to the substrate rung", () => {
    const jobs = rungJobs(sc("S0", { table: null }));
    // a process given only S1 works down the rungs it was given: S1 is its first, whatever S0 (on another machine, D2) is doing
    const s1 = planOf(jobs, { rungs: ["S1"] });
    expect(s1.plan.defs.every((d) => d.rung === "S1")).toBe(true);
    expect(s1.plan.defs).toHaveLength(12);
    const v = planOf(jobs, { rungs: ["V"] });
    expect(v.plan.defs.every((d) => d.rung === "V" || d.stage === "g0.vcheck")).toBe(true);
    expect(v.plan.defs).toHaveLength(38);
  });

  it("a job whose directory exists is not planned again", () => {
    const jobs = rungJobs(sc("S0", { table: null }));
    const first = planOf(jobs);
    const ids = new Set([...idsOf(jobs), ...first.plan.defs.slice(0, 5).map((d) => d.id)]);
    const again = planNext(first.res, (id) => ids.has(id), OPTS);
    expect(again.defs).toHaveLength(first.plan.defs.length - 5);
    expect(again.defs.map((d) => d.id)).toEqual(first.plan.defs.slice(5).map((d) => d.id));
  });
});

describe("--machine-share", () => {
  const defs = [...scanDefs("S0"), ...scanDefs("S1"), ...tableDefs("S0", [4, 12, 28]), ...tableDefs("S1", [4, 12, 28]), ...vTableDefs("S0", [4, 12, 28])];
  it("gives every job to exactly one of the machines, whatever the number", () => {
    expect(defs.length).toBe(144);
    for (const n of [1, 2, 3, 5]) {
      const parts = Array.from({ length: n }, (_, k) => shareOf(defs, k + 1, n));
      expect(parts.flat().map((d) => d.id).sort()).toEqual(defs.map((d) => d.id).sort());
      for (const p of parts) expect(new Set(p.map((d) => d.id)).size).toBe(p.length);
    }
  });
  it("is balanced enough for two machines, and keeps the queue order within a share", () => {
    for (const k of [1, 2]) {
      const mine = shareOf(defs, k, 2);
      expect(mine.length / defs.length).toBeGreaterThan(0.4);
      expect(mine.length / defs.length).toBeLessThan(0.6);
      const idx = mine.map((d) => defs.indexOf(d));
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
  });
  it("is a function of the job alone: removing other jobs from the list changes nobody's owner", () => {
    const half = defs.filter((_, k) => k % 3 !== 0);
    for (const d of half) expect(shareOf([d], 1, 2).length === 1).toBe(shareOf(defs, 1, 2).includes(d));
    expect(ownerOf("g0-scan-S0-sp2-r0-s401", 2)).toBe(ownerOf("g0-scan-S0-sp2-r0-s401", 2));
    expect(ownerOf("g0-scan-S0-sp2-r0-s401", 7)).toBeLessThan(7);
  });
  it("refuses a share that is not 1 <= i <= n", () => {
    expect(() => shareOf(defs, 0, 2)).toThrow(/not valid/);
    expect(() => shareOf(defs, 3, 2)).toThrow(/not valid/);
    expect(() => shareOf(defs, 1, 0)).toThrow(/not valid/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The command line and the SHA-256
// ---------------------------------------------------------------------------------------------------------------------

describe("the command line", () => {
  it("parses a Gate-0 run", () => {
    const a = parseArgs(["--gate0", "--out=runs/rps/gate0/jobs", "--rung=S0,V", "--machine-share=2/3", "--reverse", "--dense", "--max-jobs=4", "--only=table"]);
    expect(a).toMatchObject({ mode: "gate0", out: "runs/rps/gate0/jobs", rungs: ["S0", "V"], planAll: false, share: { i: 2, n: 3 }, reverse: true, dense: true, maxJobs: 4, only: "table", dryRun: false, draft: false });
  });
  it("defaults to every rung, unnamed", () => {
    const a = parseArgs(["--gate0", "--out=x", "--dry-run"]);
    expect(a.rungs).toEqual(["S0", "S1", "S2", "V"]);
    expect(a.planAll).toBe(false);
    expect(parseArgs(["--gate0", "--out=x", "--plan-all"]).planAll).toBe(true);
    expect(() => parseArgs(["--gate0", "--out=x", "--plan-all=1"])).toThrow(/takes no value/);
    // the economy of the earlier draft is the default now; the old flag says so instead of being an unknown option
    expect(() => parseArgs(["--gate0", "--out=x", "--stop-after-go"])).toThrow(/default now.*--plan-all/);
    expect(a.dryRun).toBe(true);
    expect(a.share).toBeNull();
  });
  it("--draft is for --table only: a registered Gate-0 run reads the frozen rules and starts after the freeze", () => {
    expect(parseArgs(["--table", "--out=x", "--draft"]).draft).toBe(true);
    expect(parseArgs(["--table", "--out=x"]).draft).toBe(false);
    for (const m of ["--gate0 --out=x", "--rehearsal", "--hash"]) expect(() => parseArgs([...m.split(" "), "--draft"]), m).toThrow(/--draft is for --table only/);
    expect(() => parseArgs(["--table", "--out=x", "--draft=1"])).toThrow(/takes no value/);
  });
  it("needs exactly one mode, and an output directory for the registered modes", () => {
    expect(() => parseArgs([])).toThrow(UsageError);
    expect(() => parseArgs(["--gate0", "--rehearsal", "--out=x"])).toThrow(/exactly one/);
    expect(() => parseArgs(["--gate0"])).toThrow(/needs --out/);
    expect(() => parseArgs(["--table"])).toThrow(/needs --out/);
    expect(parseArgs(["--rehearsal"]).out).toBeNull();
    expect(parseArgs(["--hash", "--write"]).write).toBe(true);
  });
  it("refuses what it does not know", () => {
    expect(() => parseArgs(["--gate0", "--out=x", "--rung=S3"])).toThrow(/--rung/);
    expect(() => parseArgs(["--gate0", "--out=x", "--machine-share=3/2"])).toThrow(/machine-share/);
    expect(() => parseArgs(["--gate0", "--out=x", "--machine-share=1-2"])).toThrow(/machine-share/);
    expect(() => parseArgs(["--gate0", "--out=x", "--max-jobs=0"])).toThrow(/max-jobs/);
    expect(() => parseArgs(["--gate0", "--out=x", "--frobnicate"])).toThrow(/unknown option/);
    expect(() => parseArgs(["--gate0", "--out"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--gate0=1", "--out=x"])).toThrow(/takes no value/);
    expect(() => parseArgs(["gate0"])).toThrow(/unexpected argument/);
  });
});

describe("applySettings: the kill rate stays inside the plan's bounds (spike check A6)", () => {
  afterEach(() => {
    RPS.on = false;
    RPS.rate = 0;
    RPS.min = 4;
    RPS.kill = "removal";
  });
  const apply = (rpsKill: string, rpsRate: number, rpsMin = 4) => applySettings({ rpsKill, rpsRate, rpsMin });
  it("the removal kill accepts 10,922 (6 x 10,922 < 2^16) and refuses 10,923", () => {
    apply("removal", 10_922);
    expect(RPS).toMatchObject({ on: true, kill: "removal", rate: 10_922 });
    expect(() => apply("removal", 10_923)).toThrow(/rpsRate 10923 is above 10922, the bound of the removal kill/);
  });
  it("the vacancy kill accepts 16,384 (6 x 16,384 < 2^17) and refuses 16,385", () => {
    apply("vacancy", 16_384);
    expect(RPS).toMatchObject({ on: true, kill: "vacancy", rate: 16_384 });
    expect(() => apply("vacancy", 16_385)).toThrow(/rpsRate 16385 is above 16384, the bound of the vacancy kill/);
    expect(() => apply("vacancy", 2 ** 30)).toThrow(/above 16384/);
  });
  it("every rate of the Gate-0 tables is inside: 0 to 64 for removal, 0 to 4096 for vacancy, R_cal of V up to its cap", () => {
    for (const r of [0, 8, 16, 32, 64]) apply("removal", r);
    for (const r of [0, 64, 256, 1024, 4096, 8192, 16_384]) apply("vacancy", r);
  });
  it("still refuses a negative, fractional or unknown setting", () => {
    expect(() => apply("removal", -1)).toThrow(/non-negative integer/);
    expect(() => apply("removal", 1.5)).toThrow(/non-negative integer/);
    expect(() => apply("eat", 1)).toThrow(/rpsKill/);
    expect(() => apply("removal", 1, 0)).toThrow(/rpsMin/);
  });
});

describe("the rehearsal's pass condition (Codex finding 11)", () => {
  const good = (): RehearsalReport => ({
    seed: 901,
    jobs: [{ id: "a", kill: "removal", rate: 0, status: "done", steps: 9000, stop: "end", stepsPerSec: 500, matterOk: true, residual: "0", burnHash: "h", endHash: "e", living: [1], changes: { ndom: 0, nanti: 0, chi: 0 } }],
    vcheck: { identical: true, endHashEqual: true, burnHashEqual: true, bytes: 1 },
    burnHashesEqual: true,
    handOver: { continuousHash: "x", jobHash: "x", steps: 1, equal: true },
    audit: { shape: [64, 64, 4], step: 500, rate: 8192, living: 1, withDominant: 1, predictedKilled: 1, observedChanged: 1, indistinguishable: 0, mismatches: 0, mismatchSample: [], emptyViolations: 0, matterOk: true, residual: "0/0", heatExtra: "0", byNdom: [] },
    meter: [{ spread: 8, Dx: 0.01, Dy: 0.01, Dlab: 0.01, W: { x: 1, y: 1 }, stepsPerSec: 1 }],
    readout: { loaded: 1, problems: [] },
  });
  it("passes when every check holds", () => {
    expect(plumbingOk(good())).toBe(true);
  });
  it("fails on a nonzero energy residual in either one-step audit run, although the matter is exact and no cell mismatches", () => {
    for (const residual of ["1/0", "0/1", "-3/-3", "unknown"]) {
      const r = good();
      r.audit.residual = residual;
      expect(plumbingOk(r), residual).toBe(false);
    }
  });
  it("fails on each of the other checks", () => {
    const breakers: ((r: RehearsalReport) => void)[] = [
      (r) => { r.vcheck.identical = false; },
      (r) => { r.vcheck.endHashEqual = false; },
      (r) => { r.handOver.equal = false; },
      (r) => { r.burnHashesEqual = false; },
      (r) => { r.audit.mismatches = 1; },
      (r) => { r.audit.emptyViolations = 1; },
      (r) => { r.audit.matterOk = false; },
      (r) => { r.meter[0].Dlab = 0; },
      (r) => { r.meter[0].Dlab = null; },
      (r) => { r.readout.problems = ["exit 2: x"]; },
      (r) => { r.jobs[0].matterOk = false; },
      (r) => { r.jobs[0].residual = "2"; },
    ];
    breakers.forEach((b, k) => {
      const r = good();
      b(r);
      expect(plumbingOk(r), `breaker ${k}`).toBe(false);
    });
  });
});

describe("the spike's SHA-256 (rule draft 3.0)", () => {
  const files = [
    { path: "b.ts", bytes: new TextEncoder().encode("export const b = 2;\n") },
    { path: "A.ts", bytes: new TextEncoder().encode("export const a = 1;\n") },
    { path: "dir/z.ts", bytes: new TextEncoder().encode("z\n") },
  ];

  it("is the SHA-256 of the sorted per-file listing (`<sha256>  <path>` lines, bytewise path order)", () => {
    const listing = spikeListing(files);
    expect(listing.split("\n").filter(Boolean).map((l) => l.split("  ")[1])).toEqual(["A.ts", "b.ts", "dir/z.ts"]);
    expect(listing).toBe(`${sha("export const a = 1;\n")}  A.ts\n${sha("export const b = 2;\n")}  b.ts\n${sha("z\n")}  dir/z.ts\n`);
    expect(spikeHash(files)).toBe(sha(listing));
    expect(spikeHash([...files].reverse())).toBe(spikeHash(files));
    expect(spikeHash(files.slice(1))).not.toBe(spikeHash(files));
  });

  it("equals the shell recipe of the rule draft on a git directory", () => {
    const dir = freshDir();
    fs.mkdirSync(path.join(dir, "dir"), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(dir, f.path), f.bytes);
    let shell: string;
    try {
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["add", "-A"], { cwd: dir });
      shell = execFileSync("sh", ["-c", "git ls-files | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256"], { cwd: dir, encoding: "utf8" }).split(/\s+/)[0];
    } catch {
      return; // no git or shasum here: the listing test above stands
    }
    expect(spikeHash(files)).toBe(shell);
  });

  it("the sidecar text starts with the bare hash, says how it was taken, and lists the files it is the hash of", () => {
    const text = sidecarText(files);
    const lines = text.split("\n");
    expect(lines[0]).toBe(spikeHash(files));
    expect(lines[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(text).toContain(SPIKE_RECIPE);
    expect(text).toContain("over exactly the 3 files listed below");
    const parsed = parseSidecar(text);
    expect(parsed.hash).toBe(spikeHash(files));
    expect(parsed.listing.map((l) => l.path)).toEqual(["A.ts", "b.ts", "dir/z.ts"]);
    // the listing in the file is the listing that was hashed
    expect(parsed.listingText).toBe(spikeListing(files));
    expect(sha256Hex(parsed.listingText)).toBe(parsed.hash);
    expect(() => parseSidecar(`${"0".repeat(64)}\n\nThe listing that was hashed:\nnot a line\n`)).toThrow(/not a listing line/);
  });
});

// F13: the committed spike holds only what Gate 0 uses, and its recorded SHA-256 is the one of the files that are there
describe("the spike directory and its recorded SHA-256 (decision F13)", () => {
  const SIDECAR = path.join(ROOT, "experiments", "3d-rps", "gate0-spike.sha256");
  const listFiles = (dir: string, prefix = ""): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), `${prefix}${e.name}/`) : e.name === ".DS_Store" ? [] : [`${prefix}${e.name}`]));
  const onDisk = listFiles(SPIKE).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

  it("the sidecar records the SHA-256 of exactly the files in the directory, with the listing beside it", () => {
    const parsed = parseSidecar(fs.readFileSync(SIDECAR, "utf8"));
    expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/);
    // the file list is the directory's: nothing missing, nothing extra (an out/ directory, a snapshot or a scratch script would show here)
    expect(parsed.listing.map((l) => l.path)).toEqual(onDisk);
    // each file is the one that was hashed, and the hash is the hash of the listing
    for (const l of parsed.listing) expect(sha256Hex(fs.readFileSync(path.join(SPIKE, l.path))), l.path).toBe(l.sha256);
    expect(sha256Hex(parsed.listingText)).toBe(parsed.hash);
    expect(spikeHash(onDisk.map((p) => ({ path: p, bytes: new Uint8Array(fs.readFileSync(path.join(SPIKE, p))) })))).toBe(parsed.hash);
  });

  it("re-record after a change with: deno run -A --no-lock experiments/3d-rps/gate0-spike/gate0.ts --hash --write (the sidecar says how it was taken)", () => {
    const text = fs.readFileSync(SIDECAR, "utf8");
    expect(text).toContain(SPIKE_RECIPE);
    expect(text).toMatch(/over exactly the \d+ files listed below/);
  });

  it("the directory holds sources and the README only: no shell or python script, no out/ directory, no snapshot", () => {
    for (const f of onDisk) {
      expect(f, f).toMatch(/^(README\.md|[A-Za-z0-9._-]+\.ts)$/);
      expect(f, f).not.toMatch(/^(proto|proto2|meter)\.ts$/);
    }
    expect(onDisk.some((f) => f.includes("/"))).toBe(false);
  });

  it("every source is used by Gate 0: each .ts file is reachable from gate0.ts through relative imports", () => {
    const imports = (file: string): string[] =>
      [...fs.readFileSync(path.join(SPIKE, file), "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.\/[^"']+)["']/g)].map((m) => m[1].replace(/^\.\//, ""));
    const seen = new Set<string>();
    const walk = (f: string) => {
      if (seen.has(f)) return;
      seen.add(f);
      for (const i of imports(f)) walk(i);
    };
    walk("gate0.ts");
    const sources = onDisk.filter((f) => f.endsWith(".ts"));
    expect(sources.filter((f) => !seen.has(f)), "scratch that Gate 0 never imports").toEqual([]);
    for (const f of seen) expect(onDisk, `${f} is imported but missing`).toContain(f);
  });
});

// F12: RULES.md is frozen before Gate 0 and the lattice sweep; a registered Gate-0 run refuses to start before the freeze
describe("a registered Gate-0 run starts only after the freeze (decision F12)", () => {
  const rules = new TextEncoder().encode("rules v1\n");
  const frozen = `${sha("rules v1\n")}  RULES.md\n`;
  it("refuses without RULES.md, without FROZEN, and with a RULES.md that FROZEN does not record; accepts a recorded one", () => {
    expect(gate0Refusal(rules, frozen)).toBeNull();
    expect(gate0Refusal(null, frozen)).toMatch(/a registered Gate-0 run starts only after the freeze, and experiments\/3d-rps\/RULES\.md does not exist/);
    expect(gate0Refusal(rules, null)).toMatch(/experiments\/3d-rps\/FROZEN does not exist/);
    expect(gate0Refusal(new TextEncoder().encode("rules v2\n"), frozen)).toMatch(/starts only after the freeze: RULES\.md has sha256/);
    expect(gate0Refusal(rules, "")).toMatch(/FROZEN has no hash for RULES\.md/);
  });
  it("needs RULES.md's hash only: the Gate-0 record does not exist yet, and its own hash is appended afterwards (a dated line)", () => {
    expect(gate0Refusal(rules, `# 2026-10-26 frozen\n${sha("rules v1\n")}  RULES.md\n`)).toBeNull();
    expect(gate0Refusal(rules, `2026-10-26  ${sha("rules v1\n")}  RULES.md\n2026-11-02  ${sha("record")}  GATE0-RECORD.md\n`)).toBeNull();
    expect(gate0Refusal(rules, `2026-11-02  ${sha("rules v1\n")}  GATE0-RECORD.md\n`)).toMatch(/FROZEN has no hash for RULES\.md/);
  });
  it("is the same check as the sweep's, with its own words", () => {
    expect(freezeRefusal("a registered sweep", "use --rehearsal for plumbing", rules, frozen)).toBeNull();
    expect(freezeRefusal("x", "y", null, frozen)).toBe("x starts only after the freeze, and experiments/3d-rps/RULES.md does not exist (y)");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// D16: where the spike may import from
// ---------------------------------------------------------------------------------------------------------------------

const tsFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tsFiles(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));

describe("D16: the copy and the packages", () => {
  const importsOf = (file: string): string[] => [...fs.readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

  it("the spike and the harness import nothing from runs/", () => {
    const files = [...tsFiles(SPIKE), ...tsFiles(path.join(ROOT, "experiments", "3d-rps", "lib"))];
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      for (const spec of importsOf(f)) {
        if (!spec.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(f), spec);
        expect(resolved.startsWith(path.join(ROOT, "runs") + path.sep), `${path.relative(ROOT, f)} imports ${spec}`).toBe(false);
        expect(fs.existsSync(resolved), `${path.relative(ROOT, f)} imports ${spec}, which does not exist`).toBe(true);
      }
    }
  });

  it("nothing in packages/ imports the spike or the experiments", () => {
    const pkgs = fs.readdirSync(path.join(ROOT, "packages"), { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const p of pkgs) {
      const src = path.join(ROOT, "packages", p.name, "src");
      if (!fs.existsSync(src)) continue;
      for (const f of tsFiles(src)) {
        const text = fs.readFileSync(f, "utf8");
        expect(text.includes("gate0-spike"), path.relative(ROOT, f)).toBe(false);
        expect(importsOf(f).some((s) => /experiments|3d-rps/.test(s)), path.relative(ROOT, f)).toBe(false);
      }
    }
  });

  it("Amendment 3: key-absent generated shader still carries no RPS constants", () => {
    const shaders = nativeReactShader3(jobConfig("S0", [128, 128, 4], 16, 401));
    expect(shaders).not.toContain("RPS_RATE");
    expect(shaders).not.toContain("RND_RPS_KILL");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The meter job, on the CPU reference
// ---------------------------------------------------------------------------------------------------------------------

describe("the meter job (G0.2)", () => {
  /**
   * A stand-in simulator for the stripe world: nothing moves, but after `run` every 11th cell carries the other label, so the interface
   * width is positive and known. (The CPU reference refuses a state with type bytes while the RPS keys do not exist, so the meter job's
   * own code is run against this; its physics is the transport the spike's GPU simulator runs, exercised by the rehearsal.)
   */
  const mixingFactory = (): ((ctx: SimContext, state: WorldState) => KernelSim) => (_ctx, state) => {
    const n = cellCount(state.cfg);
    let step = state.step;
    const head = (): Uint32Array => {
      const h = state.genome.slice(0, 4 * n);
      for (let i = 0; i < n; i += 11) {
        const p1 = h[G.PARAM1 * n + i];
        h[G.PARAM1 * n + i] = ((p1 & ~0xff00) | ((1 - ((p1 >>> 8) & 0xff)) << 8)) >>> 0;
      }
      return h;
    };
    return {
      run: (count: number) => {
        step += count;
      },
      census: () => ({ step, cells: state.cells, genomeHead: head(), lightIn: state.lightIn, heatOut: state.heatOut, events: 0 }),
      readState: () => ({ ...state, step, cells: state.cells.slice(), genome: state.genome.slice() }),
      destroy: () => {},
    };
  };
  const small = (d: JobDef, steps: number): JobDef => ({ ...d, shape: [8, 8, 4] as const, runSteps: steps });

  it("runs the inert stripes, checks conservation, writes W for the readout, and the readout turns it into D = pi W^2 / (8 t)", async () => {
    const out = freshDir();
    const deps = { makeSim: mixingFactory(), host: "test-host", device: "scripted" };
    for (const axis of ["x", "y"] as const) {
      const d = small(meterDefs("S0", [16], 28).find((x) => x.axis === axis)!, 30);
      expect((await runMeterJob(d, deps, out, "rehearsal")).status).toBe("done");
    }
    const pr = new Problems();
    const jobs = loadJobs(nodeIo(ROOT), out, pr);
    expect(pr.list).toEqual([]);
    expect(jobs).toHaveLength(2);
    for (const j of jobs) {
      expect(j.s).toMatchObject({ stage: "g0.meter", rung: "S0", kill: "removal", spread: 16, seed: 405, steps: 30, matterOk: true, residual: "0" });
      expect(j.s.meter?.t).toBe(30);
      expect(j.s.meter?.bMeter).toBe(28);
      expect(j.s.meter?.W).toBeGreaterThan(0);
    }
    // W by hand: 8 lines of 32 cells; every 11th cell (index i = 0, 11, 22, ...) has the other label
    const wOf = (axis: "x" | "y") => {
      const flipped = new Map<number, number>();
      for (let i = 0; i < 256; i += 11) {
        const y = Math.floor((i % 64) / 8);
        const x = i % 8;
        const u = axis === "x" ? x : y;
        flipped.set(u, (flipped.get(u) ?? 0) + 1);
      }
      let w = 0;
      for (let u = 0; u < 8; u++) {
        const base = u < 4 ? 0 : 1;
        const flips = flipped.get(u) ?? 0;
        const m = base === 1 ? 1 - flips / 32 : flips / 32;
        w += m * (1 - m);
      }
      return w;
    };
    for (const axis of ["x", "y"] as const) {
      const rec = jobs.find((j) => j.s.meter?.axis === axis)!.s.meter!;
      expect(rec.W).toBeCloseTo(wOf(axis), 12);
    }
    const pt = meterPoint(16, jobs);
    const wx = jobs.find((j) => j.s.meter?.axis === "x")!.s.meter!.W!;
    expect(pt.Dx).toBeCloseTo((Math.PI * wx * wx) / (8 * 30), 12);
    expect(pt.Dlab).not.toBeNull();
  });

  it("the same job twice gives the same record (a determinism witness), a job that exists is skipped, and a crashing simulator is retried once and marked MISSING", async () => {
    const d = small(meterDefs("S0", [8], 28)[0], 10);
    const deps = { makeSim: mixingFactory(), host: "h", device: "d" };
    const a = freshDir();
    const b = freshDir();
    await runMeterJob(d, deps, a, "rehearsal");
    await runMeterJob(d, deps, b, "rehearsal");
    const rd = (o: string) => JSON.parse(fs.readFileSync(path.join(o, d.id, "summary.json"), "utf8")) as Record<string, unknown>;
    const strip = (s: Record<string, unknown>) => {
      const { seconds: _a, stepsPerSec: _b, ...rest } = s;
      return rest;
    };
    expect(strip(rd(a))).toEqual(strip(rd(b)));
    expect(rd(a).endHash).toMatch(/^[0-9a-f]{16}$/);
    expect((await runMeterJob(d, deps, a, "rehearsal")).status).toBe("exists");
    const c = freshDir();
    let calls = 0;
    const crashing = {
      ...deps,
      makeSim: () => {
        calls++;
        throw new Error("no device");
      },
    };
    expect((await runMeterJob(d, crashing as never, c, "rehearsal")).status).toBe("missing");
    expect(calls).toBe(2);
    expect(rd(c)).toMatchObject({ missing: true, id: d.id, stage: "g0.meter" });
  });

  it("a matter change in the stripe world is a conservation failure that stops the stage", async () => {
    const d = small(meterDefs("S0", [8], 28)[1], 10);
    const inner = mixingFactory();
    const leaky: SimFactory = (ctx, state) => {
      const sim = inner(ctx, state);
      return { ...sim, census: () => { const c = sim.census() as CensusRead; const cells = c.cells.slice(); cells[CH.A * cellCount(state.cfg)] += 1; return { ...c, cells }; } };
    };
    await expect(runMeterJob(d, { makeSim: leaky, host: "h", device: "d" }, freshDir(), "rehearsal")).rejects.toBeInstanceOf(StageStop);
  });

  it("runs the inert world: the recorded config has dtQ 0 and every rate constant 0 (the meter config, not the job config; conformance F11 q03)", async () => {
    const out = freshDir();
    const d = small(meterDefs("S0", [16], 28)[0], 10);
    await runMeterJob(d, { makeSim: mixingFactory(), host: "h", device: "d" }, out, "rehearsal");
    const cfg = (JSON.parse(fs.readFileSync(path.join(out, d.id, "summary.json"), "utf8")) as { config: { run: Record<string, number> } }).config.run;
    for (const k of Object.keys(METER_ZERO)) expect(cfg[k], k).toBe(0);
    expect(cfg.mutRate).toBe(0);
    expect(cfg.spread).toBe(16);
    // the job config of the same spread is not inert
    const live = jobConfig("S0", [8, 8, 4], 16, 405);
    expect(live.dtQ).toBeGreaterThan(0);
    expect(live.kPhoto).toBeGreaterThan(0);
  });

  it("a failed attempt stays in the summary (`retried`): a crash is a trace, a conservation failure also a bug indicator for the readout (Codex finding 1)", async () => {
    const d = small(meterDefs("S0", [8], 28)[0], 10);
    const inner = mixingFactory();
    const crashOnce: SimFactory = (ctx, state) => {
      if (ctx.attempt === 1) throw new Error("no device");
      return inner(ctx, state);
    };
    const leakOnce: SimFactory = (ctx, state) => {
      const sim = inner(ctx, state);
      if (ctx.attempt > 1) return sim;
      return { ...sim, census: () => { const c = sim.census() as CensusRead; const cells = c.cells.slice(); cells[CH.A * cellCount(state.cfg)] += 1; return { ...c, cells }; } };
    };
    const a = freshDir();
    expect((await runMeterJob(d, { makeSim: crashOnce, host: "h", device: "d" }, a, "rehearsal")).status).toBe("done");
    const sa = JSON.parse(fs.readFileSync(path.join(a, d.id, "summary.json"), "utf8")) as { attempts: number; retried: { kind: string }[] };
    expect(sa.attempts).toBe(2);
    expect(sa.retried.map((f) => f.kind)).toEqual(["crash"]);
    const b = freshDir();
    expect((await runMeterJob(d, { makeSim: leakOnce, host: "h", device: "d" }, b, "rehearsal")).status).toBe("done");
    const jobs = loadJobs(nodeIo(ROOT), b, new Problems());
    expect(jobs[0].s.attemptFailures.map((f) => f.kind)).toEqual(["conservation"]);
    const clean = freshDir();
    await runMeterJob(d, { makeSim: inner, host: "h", device: "d" }, clean, "rehearsal");
    expect(JSON.parse(fs.readFileSync(path.join(clean, d.id, "summary.json"), "utf8"))).not.toHaveProperty("retried");
  });

  it("a meter job whose rerun passes but loses the publish race with a conservation failure behind it stops the stage and keeps the failures in a hidden file; the published job stands (final review, finding 1)", async () => {
    const d = small(meterDefs("S0", [8], 28)[0], 10);
    const inner = mixingFactory();
    const winnerDir = freshDir();
    await runMeterJob(d, { makeSim: inner, host: "h", device: "d" }, winnerDir, "rehearsal");
    const winner = fs.readFileSync(path.join(winnerDir, d.id, "summary.json"), "utf8");
    const out = freshDir();
    const racing: SimFactory = (ctx, state) => {
      const sim = inner(ctx, state);
      if (ctx.attempt === 2) publishJob(out, d.id, { "summary.json": winner }); // the other process finishes first
      if (ctx.attempt > 1) return sim;
      return { ...sim, census: () => { const c = sim.census() as CensusRead; const cells = c.cells.slice(); cells[CH.A * cellCount(state.cfg)] += 1; return { ...c, cells }; } };
    };
    const err = (await runMeterJob(d, { makeSim: racing, host: "h", device: "d" }, out, "rehearsal").catch((e) => e)) as StageStop;
    expect(err).toBeInstanceOf(StageStop);
    expect(err.lostRace).toBe(true);
    expect(err.failures.map((f) => f.kind)).toEqual(["conservation"]);
    expect(fs.readFileSync(path.join(out, d.id, "summary.json"), "utf8")).toBe(winner);
    const traces = fs.readdirSync(out).filter((n) => n.startsWith(LOST_RACE_PREFIX));
    expect(traces).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(out, traces[0]), "utf8"))).toMatchObject({ id: d.id, lostRace: true, retried: [{ kind: "conservation" }], loser: { attempts: 2 } });
    expect(loadJobs(nodeIo(ROOT), out, new Problems())).toHaveLength(1);
    const seen = new Problems();
    loadJobs(nodeIo(ROOT), out, seen);
    expect(seen.code).toBe(3);
    // after a plain crash the same race is only 'exists'
    const out2 = freshDir();
    const crashRacing: SimFactory = (ctx, state) => {
      if (ctx.attempt === 1) throw new Error("no device");
      publishJob(out2, d.id, { "summary.json": winner });
      return inner(ctx, state);
    };
    expect((await runMeterJob(d, { makeSim: crashRacing, host: "h", device: "d" }, out2, "rehearsal")).status).toBe("exists");
    expect(fs.readdirSync(out2)).toEqual([d.id]);
  });

  it("is checked against the config before anything runs", () => {
    expect(refCfg(405).tileW).toBe(8);
    expect(cellCount(meterConfig("S0", [8, 8, 4], 16, 405))).toBe(256);
    expect(worldW(meterConfig("S0", [8, 8, 4], 16, 405)) * worldH(meterConfig("S0", [8, 8, 4], 16, 405))).toBe(64);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The final review of Part A (Codex, 2026-10-24): the founding totals and the horizon rung on S2 (finding 6)
// ---------------------------------------------------------------------------------------------------------------------

describe("the founding of every rung against the kernel's total-world matter bound (final review, finding 6)", () => {
  // total matter (A + B + C + P) of the rps-mix founding, by rung, shape and seed, pinned: the numbers of rule draft 3.0 (horizon rung)
  const TOTALS: Record<string, readonly number[]> = {
    "S0 128x128x4": [2_100_742, 2_100_996, 2_097_922, 2_101_525, 2_099_398],
    "S0 256x256x4": [8_392_801, 8_390_454, 8_389_337, 8_393_626, 8_391_030],
    "S1 128x128x4": [8_396_251, 8_400_021, 8_399_263, 8_395_894, 8_404_705],
    "S1 256x256x4": [33_543_385, 33_580_032, 33_568_250, 33_573_160, 33_585_693],
    "S2 128x128x4": [16_784_807, 16_804_560, 16_816_637, 16_789_828, 16_790_041],
    "S2 256x256x4": [67_136_207, 67_102_423, 67_140_915, 67_174_386, 67_153_970],
  };
  const SEEDS = [401, 402, 403, 404, 405];
  const MATTER_MAX = 2 ** 26;

  it("pins the founding totals for the three rungs, both shapes and seeds 401 to 405, and S2 at 256 x 256 x 4 is over the bound for 401, 403, 404 and 405 and under it for 402", () => {
    for (const [key, totals] of Object.entries(TOTALS)) {
      const [rung, dims] = key.split(" ") as ["S0" | "S1" | "S2", string];
      const shape = dims.split("x").map(Number) as [number, number, number];
      SEEDS.forEach((seed, k) => {
        const cfg = jobConfig(rung, shape, 16, seed);
        const st = rpsMix(cfg, mixParams(rung));
        let matter = 0;
        for (const ch of [CH.A, CH.B, CH.C, CH.P]) for (let i = ch * cellCount(cfg); i < (ch + 1) * cellCount(cfg); i++) matter += st.cells[i];
        expect([key, seed, matter]).toEqual([key, seed, totals[k]]);
        const bad = foundingProblems(st);
        if (totals[k] > MATTER_MAX) expect(bad).toEqual([`total matter ${totals[k]} exceeds ${MATTER_MAX}`]);
        else expect([key, seed, bad]).toEqual([key, seed, []]);
      });
    }
    // the expectation of the founding at S2 and 256 x 256 x 4 is 2^26 exactly: 262,144 cells x (160 + 0.75 x 128)
    expect(256 * 256 * 4 * (160 + 0.75 * 128)).toBe(MATTER_MAX);
    // every shape that a Gate-0 job is registered at (128 x 128 x 4 for every rung; 256 x 256 x 4 for S0 and S1 only) is inside the bound
    for (const key of Object.keys(TOTALS)) if (key !== "S2 256x256x4") for (const t of TOTALS[key]) expect(t).toBeLessThan(MATTER_MAX);
  });

  it("a Gate-0 job of S2 at 256 x 256 x 4 with seed 401 or 403 is an invariant failure of the harness before any step: both attempts fail, the stage stops, and no simulator is built", async () => {
    const out = freshDir();
    let built = 0;
    const deps = {
      makeSim: (() => {
        built++;
        throw new Error("a simulator must not be built");
      }) as SimFactory,
      host: "h",
      device: "d",
    };
    for (const seed of [401, 403]) {
      const d = { ...horizonRungDefs("S2", 12)[seed - 401], runSteps: 1000 };
      const err = (await executeKernelJob(runSpecOf(d, "gate0"), deps, out).catch((e) => e)) as StageStop;
      expect(err).toBeInstanceOf(StageStop);
      expect(err.failures.map((f) => f.kind)).toEqual(["invariant", "invariant"]);
      expect(err.failures[0].message).toMatch(/the founding is not a valid world state: total matter 671(36207|40915) exceeds 67108864/);
    }
    expect(built).toBe(0);
    // seed 402 of the same job passes the check (it is the pin above that makes the rule say 401 and 403)
    const ok = runSpecOf(horizonRungDefs("S2", 12)[1], "gate0");
    expect(foundingProblems(ok.found())).toEqual([]);
  });

  it("the planner asks for no horizon-rung job on S2, nor for V on S2: GATE-0-STOP stands without them; on S0 and S1 it still does", () => {
    const loss = (k: number) => ({ LOSS: 3 + k });
    const hz = [loss(0), loss(1), loss(2)] as never;
    const lv = (r: "S0" | "S1") => rungJobs({ rung: r, carpets: CARPETS_3, dlab: DLAB_3, g: G_3, table: null, horizon: null, confirm: null });
    const onS2 = [...lv("S0"), ...lv("S1"), ...rungJobs(sc("S2", { horizon: hz })), ...vJobs({ host: "S2", g: G_5, substrate: "S2", table: () => ["CHURN", "CHURN", "CHURN"] as never, confirm: null })];
    const { plan, res } = planOf(onS2);
    expect(res.overall).toEqual({ status: "stop", onlyHorizon: true, horizonRung: null });
    expect(plan.defs.filter((d) => d.stage === "g0.horizon-rung")).toEqual([]);
    expect(plan.defs).toEqual([]); // nothing at all is asked for
    expect(res.problems.code).toBe(0);
    // the same failures on S0: the three horizon-rung jobs
    const onS0 = planOf([...rungJobs(sc("S0", { horizon: hz })), ...rungJobs(sc("S1", { horizon: hz })), ...vJobs({ host: "S0", g: G_5, substrate: "S0", confirm: null })]);
    expect(onS0.plan.defs.filter((d) => d.stage === "g0.horizon-rung")).toHaveLength(3);
  });
});
