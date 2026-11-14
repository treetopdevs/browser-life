// Tests of the exploration of Amendment 2 (experiments/3d-rps/RULES.md, after Amendment 1 read EXPLORATION-NO-HORIZON): persistence at
// 256 x 256 x 4. The readout `readout.ts gate0-exploration-2` (readout-exploration-2.ts) and the driver `gate0.ts --exploration-2`
// (gate0-spike/explore.ts on the loop of driver.ts), with a fake job runner that writes the readout's synthetic fixtures at 256 x 256 x 4.
// No GPU; nothing here is a result.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { worldH, worldW } from "@bl/schema";
import { publishJob, stopRule15, type KernelJobResult } from "../3d-rps/lib/kernel-job.ts";
import { UsageError, parseCommandLine } from "../3d-rps/gate0-spike/cli.ts";
import { driveWith, type DriverIoOf } from "../3d-rps/gate0-spike/driver.ts";
import { exploration2DiskIo, exploration2Hooks, planExploration2 } from "../3d-rps/gate0-spike/explore.ts";
import { runSpecOf } from "../3d-rps/gate0-spike/jobs.ts";
import type { JobDef } from "../3d-rps/gate0-spike/plan.ts";
import { exploration2Refusal } from "../3d-rps/frozen.ts";
import { run, nodeIo } from "../3d-rps/readout.ts";
import { EXPLORATION_2_HEADER, type Exploration2Label, type Exploration2Result } from "../3d-rps/readout-exploration-2.ts";
import { rawJob, type ClassSpec } from "./rps-fixtures.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rps-gate0-exploration-2-"));
let counter = 0;
const freshDir = (): string => path.join(tmp, `x${counter++}`);
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const RULES_A2 = "# Rules\n\n## Amendment 1 (2026-10-24): an exploration\n\n## Amendment 2 (2026-10-24, after Amendment 1 read EXPLORATION-NO-HORIZON): persistence\n";
const RULES_A1_ONLY = "# Rules\n\n## Amendment 1 (2026-10-24): an exploration\n";
function mkRoot(rules: string, frozenHashOf: string | null): string {
  const root = freshDir();
  const d = path.join(root, "experiments", "3d-rps");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "RULES.md"), rules);
  fs.writeFileSync(path.join(d, "FROZEN"), frozenHashOf === null ? "# nothing frozen\n" : `2026-10-24  ${sha(frozenHashOf)}  RULES.md\n`);
  return root;
}
let ROOT = "";
beforeAll(() => {
  ROOT = mkRoot(RULES_A2, RULES_A2);
});

// ---- scenarios ----

interface Scenario {
  horizon: (seed: number) => ClassSpec;
  confirm: (d: JobDef) => ClassSpec;
  /** Write this job with another shape, or a nonzero residual. */
  shape?: (d: JobDef) => [number, number, number] | undefined;
  residualAt?: (d: JobDef) => boolean;
}
const PERSISTS: Scenario = { horizon: () => "CHURN", confirm: () => "DC" };

function writeA2(out: string, d: JobDef, sc: Scenario): KernelJobResult {
  const cls = d.stage === "g0.horizon-rung" ? sc.horizon(d.seed) : sc.confirm(d);
  const raw = rawJob({ id: d.id, stage: d.stage, rung: d.rung, kill: d.kill, substrate: d.substrate, seed: d.seed, spread: d.spread, rate: d.rate, nRun: d.runSteps / 1000, cls, stepsPerSec: 300, dims: sc.shape?.(d) ?? [256, 256, 4], ...(sc.residualAt?.(d) ? { residual: "1" } : {}) });
  publishJob(out, d.id, { "summary.json": JSON.stringify(raw.summary), "census.tsv": raw.census });
  return { status: "done", dir: path.join(out, d.id), summary: raw.summary };
}

function mkIo(out: string, sc: Scenario = PERSISTS): { io: DriverIoOf<Exploration2Result>; ran: JobDef[]; logs: string[] } {
  const ran: JobDef[] = [];
  const logs: string[] = [];
  const io: DriverIoOf<Exploration2Result> = {
    ...exploration2DiskIo(out, ROOT),
    run: async (d) => {
      ran.push(d);
      return writeA2(out, d, sc);
    },
    log: (l) => logs.push(l),
  };
  return { io, ran, logs };
}
const args = (o: Partial<Parameters<typeof driveWith>[0]> = {}): Parameters<typeof driveWith>[0] => ({ share: null, reverse: false, dryRun: false, only: null, maxJobs: null, ...o });
const readout = (out: string, root = ROOT, extra: string[] = []) => run(["gate0-exploration-2", "--jobs", out, "--root", root, ...extra], nodeIo(root));
const labels = (r: Exploration2Result): Record<string, Exploration2Label | null> => Object.fromEntries(r.forms.map((f) => [f.kill, f.label]));

/** No verdict of Gate 0 anywhere: no GO (nor NO-GO), and GATE-0 only in the header line. */
function expectNoVerdict(out: string): void {
  const lines = out.split("\n");
  expect(lines[0]).toBe(EXPLORATION_2_HEADER);
  expect(lines.filter((l) => /\bGO\b/.test(l))).toEqual([]);
  expect(lines.slice(1).filter((l) => l.includes("GATE-0"))).toEqual([]);
  expect(lines.filter((l) => /^### Verdict/.test(l))).toEqual([]);
}

// ---- the planner ----

describe("Amendment 2's planner", () => {
  it("the first wave is exactly the three A2.2 horizon jobs: 256 x 256 x 4, S0, removal, spread 8, rate 0, 200,000 run steps", async () => {
    const out = freshDir();
    const { io, ran, logs } = mkIo(out);
    expect((await driveWith(args({ dryRun: true }), io, exploration2Hooks)).code).toBe(4);
    expect(ran).toEqual([]);
    expect(fs.existsSync(out)).toBe(false);
    const plan = planExploration2(io.evaluate(), (id) => io.jobExists(id));
    expect(plan.defs.map((d) => d.id)).toEqual(["g2-horizon-S0-sp8-r0-s401", "g2-horizon-S0-sp8-r0-s402", "g2-horizon-S0-sp8-r0-s403"]);
    for (const d of plan.defs) {
      expect(d).toMatchObject({ stage: "g0.horizon-rung", kind: "run", rung: "S0", kill: "removal", substrate: "S0", spread: 8, rate: 0, runSteps: 200_000, shape: [256, 256, 4] });
      // what the job runs and records: the shape, the mode, the amendment, the burn-in, the early stop of 1.5
      const spec = runSpecOf(d, "exploration-2", { amendment: 2 });
      expect([worldW(spec.run.cfg), worldH(spec.run.cfg), spec.run.cfg.tileD]).toEqual([256, 256, 4]);
      expect(spec.summary).toMatchObject({ mode: "exploration-2", amendment: 2, shape: [256, 256, 4], rung: "S0", kill: "removal", spread: 8, rpsRate: 0, rpsMin: 4, rpsTypes: 3 });
      expect(spec.burn.settings).toMatchObject({ rpsRate: 0 });
      expect(spec.stop).toBe(stopRule15);
      expect(spec.run.cfg.mutRate).toBe(0);
    }
    expect(logs[0]).toContain("wave: 3 jobs listed");
  });

  it("the confirmations come only once the horizon gives h0: 6 jobs (both kill forms, rate 64, spread 8), h0 run steps, g2- ids", () => {
    const out = freshDir();
    const io = mkIo(out, { horizon: (sd) => (sd === 403 ? "CHURN" : { EXT: 200 }), confirm: () => "DC" }).io;
    const first = planExploration2(io.evaluate(), (id) => io.jobExists(id));
    // two of three horizon jobs on disk: still no confirmation
    for (const d of first.defs.slice(0, 2)) writeA2(out, d, { horizon: () => ({ EXT: 200 }), confirm: () => "DC" });
    expect(planExploration2(io.evaluate(), (id) => io.jobExists(id)).defs.map((d) => d.id)).toEqual(["g2-horizon-S0-sp8-r0-s403"]);
    writeA2(out, first.defs[2], { horizon: () => "CHURN", confirm: () => "DC" });
    const res = io.evaluate();
    // T_ctl = lower middle of [200,000, 200,000, inf] = 200,000, so h0 = 50,000 (the largest of 50k, 100k, 200k at most T_ctl / 4)
    expect(res.horizon?.Tctl).toBe(200_000);
    expect(res.horizon?.h0).toBe(50_000);
    const conf = planExploration2(res, (id) => io.jobExists(id)).defs;
    expect(conf.map((d) => d.id).sort()).toEqual(["g2-confirm-S0-sp8-r64-s401", "g2-confirm-S0-sp8-r64-s402", "g2-confirm-S0-sp8-r64-s403", "g2-confirm-V-sp8-r64-s401", "g2-confirm-V-sp8-r64-s402", "g2-confirm-V-sp8-r64-s403"]);
    for (const d of conf) {
      expect(d).toMatchObject({ stage: "g0.confirm", substrate: "S0", spread: 8, rate: 64, runSteps: 50_000, shape: [256, 256, 4] });
      expect(d.kill).toBe(d.rung === "V" ? "vacancy" : "removal");
      expect(d.id.startsWith("g2-")).toBe(true);
    }
  });
});

// ---- the labels (A2.4) ----

describe("Amendment 2's labels", () => {
  it("both forms persist: the horizon, then 6 confirmations, and the readout exits 0 with EXPLORATION-2-PERSISTS twice", async () => {
    const out = freshDir();
    const m = mkIo(out);
    expect((await driveWith(args(), m.io, exploration2Hooks)).code).toBe(0);
    expect(m.ran).toHaveLength(9);
    expect(m.ran.slice(0, 3).every((d) => d.stage === "g0.horizon-rung")).toBe(true);
    expect(m.ran.slice(3).every((d) => d.stage === "g0.confirm" && d.runSteps === 200_000)).toBe(true);
    expect(labels(m.io.evaluate())).toEqual({ removal: "EXPLORATION-2-PERSISTS", vacancy: "EXPLORATION-2-PERSISTS" });
    const ro = readout(out);
    expect(ro.code).toBe(0);
    expectNoVerdict(ro.out);
    expect(ro.out).toContain("- Removal kill (rung S0): **EXPLORATION-2-PERSISTS**");
    expect(ro.out).toContain("- Vacancy kill (rung V on S0): **EXPLORATION-2-PERSISTS**");
    expect(ro.out).toContain("T_ctl inf; h0 200000");
  }, 120_000);

  it("one form confirms and the other not (each way round): EXPLORATION-2-PERSISTS beside EXPLORATION-2-NO-CONFIRM", async () => {
    const out = freshDir();
    const m = mkIo(out, { horizon: () => "CHURN", confirm: (d) => (d.kill === "vacancy" ? (d.seed === 401 ? "DC" : { LOSS: 120 }) : "DC") });
    expect((await driveWith(args(), m.io, exploration2Hooks)).code).toBe(0);
    expect(labels(m.io.evaluate())).toEqual({ removal: "EXPLORATION-2-PERSISTS", vacancy: "EXPLORATION-2-NO-CONFIRM" });
    const out2 = freshDir();
    const m2 = mkIo(out2, { horizon: () => "CHURN", confirm: (d) => (d.kill === "removal" ? "CHURN" : d.seed === 403 ? "CHURN" : "DC") });
    expect((await driveWith(args(), m2.io, exploration2Hooks)).code).toBe(0);
    expect(labels(m2.io.evaluate())).toEqual({ removal: "EXPLORATION-2-NO-CONFIRM", vacancy: "EXPLORATION-2-PERSISTS" });
    const ro = readout(out2);
    expect(ro.code).toBe(0);
    expectNoVerdict(ro.out);
  }, 120_000);

  it("h0 none: both forms read EXPLORATION-2-NO-HORIZON and no confirmation is run", async () => {
    const out = freshDir();
    const m = mkIo(out, { horizon: () => ({ LOSS: 150 }), confirm: () => "DC" });
    expect((await driveWith(args(), m.io, exploration2Hooks)).code).toBe(0);
    expect(m.ran.map((d) => d.stage)).toEqual(["g0.horizon-rung", "g0.horizon-rung", "g0.horizon-rung"]);
    expect(labels(m.io.evaluate())).toEqual({ removal: "EXPLORATION-2-NO-HORIZON", vacancy: "EXPLORATION-2-NO-HORIZON" });
    const ro = readout(out);
    expect(ro.code).toBe(0);
    expectNoVerdict(ro.out);
  });

  it("the [50,000, Infinity] median case (one control NOSTART): T_ctl 50,000, h0 none, both forms NO-HORIZON", async () => {
    const out = freshDir();
    const m = mkIo(out, { horizon: (sd) => (sd === 401 ? { LOSS: 50 } : sd === 402 ? "CHURN" : "NOSTART"), confirm: () => "DC" });
    expect((await driveWith(args(), m.io, exploration2Hooks)).code).toBe(0);
    const res = m.io.evaluate();
    expect(res.horizon?.tctl).toEqual([50_000, Infinity, null]);
    expect(res.horizon?.Tctl).toBe(50_000);
    expect(res.horizon?.h0).toBeNull();
    expect(labels(res)).toEqual({ removal: "EXPLORATION-2-NO-HORIZON", vacancy: "EXPLORATION-2-NO-HORIZON" });
    expect(m.ran.some((d) => d.stage === "g0.confirm")).toBe(false);
  });

  it("jobs still to run: exit 4 with the jobs listed; an empty directory lists the horizon", () => {
    const empty = freshDir();
    fs.mkdirSync(empty);
    const ro = readout(empty);
    expect(ro.code).toBe(4);
    expectNoVerdict(ro.out);
    expect(ro.out).toContain("the removal kill has 3 jobs to run (g0.horizon-rung S0 spread 8 rate 0 seed 401");
    const out = freshDir();
    const io = mkIo(out).io;
    for (const d of planExploration2(io.evaluate(), () => false).defs) writeA2(out, d, PERSISTS);
    const conf = planExploration2(io.evaluate(), (id) => io.jobExists(id)).defs;
    for (const d of conf.filter((x) => x.id !== "g2-confirm-V-sp8-r64-s402")) writeA2(out, d, PERSISTS);
    const ro2 = readout(out);
    expect(ro2.code).toBe(4);
    expectNoVerdict(ro2.out);
    expect(ro2.out).toContain("the vacancy kill has 1 job to run (g0.confirm V (vacancy kill) spread 8 rate 64 seed 402 (200000 run steps))");
    expect(ro2.out).toContain("- Removal kill (rung S0): **EXPLORATION-2-PERSISTS**");
  });
});

// ---- bug indicators and refusals ----

describe("Amendment 2's bug indicators and refusals", () => {
  it("a job of the wrong shape or settings, and a conservation failure, are bug indicators (exit 3)", async () => {
    const wrongShape = freshDir();
    const m = mkIo(wrongShape, { ...PERSISTS, shape: (d) => (d.seed === 402 ? [128, 128, 4] : undefined) });
    for (const d of planExploration2(m.io.evaluate(), () => false).defs) writeA2(wrongShape, d, { ...PERSISTS, shape: (x) => (x.seed === 402 ? [128, 128, 4] : undefined) });
    const ro = readout(wrongShape);
    expect(ro.code).toBe(3);
    expectNoVerdict(ro.out);
    expect(ro.out).toContain("shape 128x128x4 instead of 256x256x4");
    // the loop refuses to plan more on top of it
    expect((await driveWith(args(), m.io, exploration2Hooks)).code).toBe(3);
    expect(m.ran).toEqual([]);
    // a horizon job at another rate (a wrong setting)
    const wrongRate = freshDir();
    const d0 = planExploration2(mkIo(wrongRate).io.evaluate(), () => false).defs[0];
    writeA2(wrongRate, { ...d0, rate: 8 }, PERSISTS);
    expect(readout(wrongRate).code).toBe(3);
    // a nonzero residual stops the loop at that job
    const bad = freshDir();
    const mb = mkIo(bad, { ...PERSISTS, residualAt: (d) => d.id === "g2-horizon-S0-sp8-r0-s402" });
    expect((await driveWith(args(), mb.io, exploration2Hooks)).code).toBe(3);
    expect(mb.ran.map((d) => d.id)).toEqual(["g2-horizon-S0-sp8-r0-s401", "g2-horizon-S0-sp8-r0-s402"]);
    expect(readout(bad).code).toBe(3);
  });

  it("every Amendment 2 job is on S0's substrate: a horizon or a removal confirmation recorded on S1 or S2 is a bug indicator (exit 3)", () => {
    // a horizon job recorded on S1 (A2.1: the world is rung S0's substrate)
    const s1 = freshDir();
    for (const d of planExploration2(mkIo(s1).io.evaluate(), () => false).defs) writeA2(s1, d.seed === 401 ? ({ ...d, substrate: "S1" } as JobDef) : d, PERSISTS);
    const r1 = readout(s1);
    expect(r1.code).toBe(3);
    expectNoVerdict(r1.out);
    expect(r1.out).toContain("substrate S1 instead of S0");
    // removal confirmations recorded on S2, after a clean horizon
    const s2 = freshDir();
    const m = mkIo(s2);
    for (const d of planExploration2(m.io.evaluate(), () => false).defs) writeA2(s2, d, PERSISTS);
    const conf = planExploration2(m.io.evaluate(), () => false).defs.filter((d) => d.stage === "g0.confirm");
    expect(conf.length).toBe(6);
    for (const d of conf) writeA2(s2, d.kill === "removal" ? ({ ...d, substrate: "S2" } as JobDef) : d, PERSISTS);
    const r2 = readout(s2);
    expect(r2.code).toBe(3);
    expectNoVerdict(r2.out);
    expect(r2.out).toContain("substrate S2 instead of S0");
  });

  it("the readout refuses without the Amendment 2 heading, or without RULES.md's hash in FROZEN, and still starts with the header", () => {
    const out = freshDir();
    fs.mkdirSync(out);
    const noA2 = readout(out, mkRoot(RULES_A1_ONLY, RULES_A1_ONLY));
    expect(noA2.code).toBe(2);
    expect(noA2.out.split("\n")[0]).toBe(EXPLORATION_2_HEADER);
    expect(noA2.out).toContain("Amendment 2");
    const notFrozen = readout(out, mkRoot(RULES_A2, null));
    expect(notFrozen.code).toBe(2);
    expect(notFrozen.out.split("\n")[0]).toBe(EXPLORATION_2_HEADER);
    expect(notFrozen.out).toContain("which FROZEN does not record");
    expect(readout(out).code).toBe(4);
    const draft = readout(out, ROOT, ["--draft"]);
    expect(draft.code).toBe(2);
    expect(draft.out.split("\n")[0]).toBe(EXPLORATION_2_HEADER);
    // the driver's check is the same function
    expect(exploration2Refusal(new TextEncoder().encode(RULES_A2), `2026-10-24  ${sha(RULES_A2)}  RULES.md\n`)).toBeNull();
    expect(exploration2Refusal(new TextEncoder().encode(RULES_A1_ONLY), `2026-10-24  ${sha(RULES_A1_ONLY)}  RULES.md\n`)).toMatch(/Amendment 2/);
    expect(exploration2Refusal(new TextEncoder().encode(RULES_A2), "# nothing\n")).toMatch(/FROZEN does not record/);
  });

  it("gate0.ts --exploration-2 prints its header before parsing; it needs --out and takes no --registered, --rung, --plan-all or --dense", () => {
    for (const argv of [["--exploration-2"], ["--exploration-2", "--out=x", "--registered=y"], ["--exploration-2", "--out=x", "--rung=S0"], ["--exploration-2", "--out=x", "--plan-all"], ["--exploration-2", "--out=x", "--dense"]]) {
      const lines: string[] = [];
      expect(() => parseCommandLine(argv, (l) => lines.push(l))).toThrow(UsageError);
      expect(lines).toEqual([EXPLORATION_2_HEADER]);
    }
    const ok: string[] = [];
    expect(parseCommandLine(["--exploration-2", "--out=x", "--dry-run", "--machine-share=2/2"], (l) => ok.push(l))).toMatchObject({ mode: "exploration-2", out: "x", dryRun: true, share: { i: 2, n: 2 } });
    expect(ok).toEqual([EXPLORATION_2_HEADER]);
  });

  it("--machine-share splits the horizon wave between two machines", async () => {
    const seen: string[] = [];
    for (const i of [1, 2]) {
      const m = mkIo(freshDir());
      await driveWith(args({ dryRun: true, share: { i, n: 2 } }), m.io, exploration2Hooks);
      seen.push(...m.logs.filter((l) => l.includes("would run")));
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });
});

// ---- the Amendment 1 path on the work Mac's files, where this checkout has them (runs/ is not in the repository) ----

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const A1_JOBS = path.join(REPO, "runs", "rps", "gate0-exp-workmac", "gate0-exp");
const A1_REG = path.join(REPO, "runs", "rps", "gate0-workmac", "gate0");
describe("the Amendment 1 path is unchanged", () => {
  it.skipIf(!fs.existsSync(A1_JOBS) || !fs.existsSync(A1_REG))("readout.ts gate0-exploration on the work Mac's files still gives both kills EXPLORATION-NO-HORIZON", () => {
    const ro = run(["gate0-exploration", "--jobs", A1_JOBS, "--registered", A1_REG], nodeIo(REPO));
    expect(ro.code).toBe(0);
    expect(ro.out).toContain("- Rung S0 (removal kill): **EXPLORATION-NO-HORIZON (row 3)**");
    expect(ro.out).toContain("- Rung V (vacancy kill on S0): **EXPLORATION-NO-HORIZON (row 3)**");
  });
});
