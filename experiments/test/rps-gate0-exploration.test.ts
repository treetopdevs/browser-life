// Tests of the exploration of Amendment 1 (experiments/3d-rps/RULES.md, after GATE-0-STOP): the readout `readout.ts gate0-exploration`
// (readout-exploration.ts) and the driver `gate0.ts --exploration` (gate0-spike/explore.ts on the loop of driver.ts), with a fake job
// runner that writes the readout's synthetic fixtures. A registered directory is made once, read-only: S0's G0.2 giving G_spread
// [6, 8, 10, 16], as the registered pilot did. No GPU; nothing here is a result.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { publishJob, type KernelJobResult } from "../3d-rps/lib/kernel-job.ts";
import { UsageError, parseArgs, parseCommandLine } from "../3d-rps/gate0-spike/cli.ts";
import { driveWith, type DriverIoOf } from "../3d-rps/gate0-spike/driver.ts";
import { explorationDirsRefusal, explorationDiskIo, explorationHooks, planExploration } from "../3d-rps/gate0-spike/explore.ts";
import { meterDefs, scanDefs, type JobDef } from "../3d-rps/gate0-spike/plan.ts";
import { explorationRefusal } from "../3d-rps/frozen.ts";
import { run, nodeIo } from "../3d-rps/readout.ts";
import { EXPLORATION_HEADER, type ExplorationLabel, type ExplorationResult } from "../3d-rps/readout-exploration.ts";
import { meterJob, rawJob, rowsOf, type ClassSpec, type FixtureJob } from "./rps-fixtures.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rps-gate0-exploration-"));
let counter = 0;
const freshDir = (): string => path.join(tmp, `x${counter++}`);
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ---- a repository root whose RULES.md is frozen and carries Amendment 1 ----

const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const RULES_A1 = "# Rules\n\n### 3.0 Gate 0\n\n## Amendment 1 (2026-10-24, after GATE-0-STOP): an exploration\n";
const RULES_NO_A1 = "# Rules\n\n### 3.0 Gate 0\n\n(no amendment)\n";
function mkRoot(rules: string, frozenHashOf: string | null): string {
  const root = freshDir();
  const d = path.join(root, "experiments", "3d-rps");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "RULES.md"), rules);
  fs.writeFileSync(path.join(d, "FROZEN"), frozenHashOf === null ? "# nothing frozen\n" : `2026-10-24  ${sha(frozenHashOf)}  RULES.md\n`);
  return root;
}

// ---- the registered directory: S0's G0.2 as the registered pilot gave it (G_spread [6, 8, 10, 16]) ----

const CARPETS_A1 = [6, 8, 10, 12, 16, 20, 24, 28];
const DLAB_A1: Record<number, number> = { 6: 0, 8: 0.0157, 10: 0.029, 12: 0.029, 16: 0.0439, 20: 0.029, 24: 0.029, 28: 0.029 };

function writeDef(out: string, d: JobDef, cls: ClassSpec, rows?: ReturnType<typeof rowsOf>, bad: { residual?: string; burnHash?: string } = {}): KernelJobResult {
  let summary: Record<string, unknown>;
  let census: string | null = null;
  if (d.kind === "meter") {
    const mj = meterJob({ rung: d.substrate, spread: d.spread, axis: d.axis!, D: DLAB_A1[d.spread] ?? 0, bMeter: d.bMeter, seed: d.seed }) as FixtureJob;
    summary = { ...mj.raw.summary, id: d.id };
  } else {
    const raw = rawJob({ id: d.id, stage: d.stage, rung: d.rung, kill: d.kill, substrate: d.substrate, seed: d.seed, spread: d.spread, rate: d.rate, nRun: d.runSteps / 1000, cls, stepsPerSec: 700, ...(rows ? { rows } : {}), ...bad });
    summary = raw.summary;
    census = raw.census;
  }
  const files: Record<string, string> = { "summary.json": JSON.stringify(summary) };
  if (census !== null) files["census.tsv"] = census;
  publishJob(out, d.id, files);
  return { status: "done", dir: path.join(out, d.id), summary };
}

let REG = "";
let ROOT = "";
beforeAll(() => {
  REG = freshDir();
  for (const d of scanDefs("S0")) writeDef(REG, d, CARPETS_A1.includes(d.spread) ? "CHURN" : "SPARSE");
  for (const d of meterDefs("S0", [2, 3, 4, ...CARPETS_A1, 32], 28)) writeDef(REG, d, "CHURN");
  ROOT = mkRoot(RULES_A1, RULES_A1);
});

/** Every file of a directory with its size, mtime and SHA-256. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) visit(p);
      else {
        const st = fs.statSync(p);
        out.push(`${path.relative(dir, p)} ${st.size} ${st.mtimeMs} ${sha(fs.readFileSync(p))}`);
      }
    }
  };
  visit(dir);
  return out.sort();
}

// ---- scenarios: which exploration jobs land in which class ----

interface Scenario {
  /** Is a nonzero-rate table job of this rung DC? */
  s0dc: (d: JobDef) => boolean;
  vdc: (d: JobDef) => boolean;
  horizon: ClassSpec;
  /** The class of a confirmation job. */
  confirm: (d: JobDef) => ClassSpec;
  vcheckDiffers?: boolean;
  /** This job reports a nonzero energy residual (a conservation bug). */
  residualAt?: (d: JobDef) => boolean;
  /** This job's burn-in hash differs from its burn-in group's (a bug indicator only the readout sees). */
  burnHashAt?: (d: JobDef) => boolean;
}

const WORKS: Scenario = { s0dc: (d) => d.rate >= 16, vdc: (d) => d.rate >= 256, horizon: "CHURN", confirm: () => "DC" };

function classOf(d: JobDef, sc: Scenario): ClassSpec {
  if (d.stage === "g0.horizon") return sc.horizon;
  if (d.stage === "g0.confirm") return sc.confirm(d);
  if (d.rate === 0) return "CHURN";
  return (d.rung === "V" ? sc.vdc(d) : sc.s0dc(d)) ? "DC" : "CHURN";
}

function writeExp(out: string, d: JobDef, sc: Scenario): KernelJobResult {
  // the vacancy build of the V check: the registered scan job's rows (CHURN, 20 run censuses), one census changed if it is to differ
  const rows = d.stage === "g0.vcheck" && sc.vcheckDiffers ? (() => { const r = rowsOf("CHURN", 20); r.run[7] = { ...r.run[7], ndom: 151 }; return r; })() : undefined;
  return writeDef(out, d, classOf(d, sc), rows, { ...(sc.residualAt?.(d) ? { residual: "1" } : {}), ...(sc.burnHashAt?.(d) ? { burnHash: "f".repeat(16) } : {}) });
}

interface Run {
  io: DriverIoOf<ExplorationResult>;
  ran: JobDef[];
  logs: string[];
}

function mkIo(out: string, sc: Scenario = WORKS): Run {
  const ran: JobDef[] = [];
  const logs: string[] = [];
  const io: DriverIoOf<ExplorationResult> = {
    ...explorationDiskIo(out, REG, ROOT),
    run: async (d) => {
      ran.push(d);
      return writeExp(out, d, sc);
    },
    log: (l) => logs.push(l),
  };
  return { io, ran, logs };
}

const args = (o: Partial<Parameters<typeof driveWith>[0]> = {}): Parameters<typeof driveWith>[0] => ({ share: null, reverse: false, dryRun: false, only: null, maxJobs: null, ...o });

/** Writes every job the planner asks for, wave by wave, without the loop's V-check gate (for job sets the loop would not finish). */
function writeAllPlanned(out: string, sc: Scenario): void {
  const io = mkIo(out, sc).io;
  for (;;) {
    const plan = planExploration(io.evaluate(), (id) => io.jobExists(id));
    if (plan.defs.length === 0) return;
    for (const d of plan.defs) writeExp(out, d, sc);
  }
}

const readout = (out: string, root = ROOT, extra: string[] = []) => run(["gate0-exploration", "--jobs", out, "--registered", REG, "--root", root, ...extra], nodeIo(root));
const labels = (r: ExplorationResult): Record<string, ExplorationLabel | null> => Object.fromEntries(r.rungs.map((e) => [e.rung, e.label]));

/** No verdict of Gate 0 anywhere: no GO (nor NO-GO), and GATE-0 only in the header line. */
function expectNoVerdict(out: string): void {
  const lines = out.split("\n");
  expect(lines[0]).toBe(EXPLORATION_HEADER);
  expect(lines.filter((l) => /\bGO\b/.test(l))).toEqual([]);
  expect(lines.slice(1).filter((l) => l.includes("GATE-0"))).toEqual([]);
  expect(lines.filter((l) => /^### Verdict/.test(l))).toEqual([]);
}

// ---- the planner ----

describe("the exploration's first wave (A1.2)", () => {
  const expectedFirstWave = (): string[] => {
    const ids: string[] = ["g0-vcheck-vacancy-S0-sp8-r0-s401"];
    for (const v of [6, 8, 16]) for (const rate of [0, 8, 16, 32, 64]) for (const sd of [401, 402, 403]) if (!(rate === 0 && sd === 401)) ids.push(`g0-table-S0-sp${v}-r${rate}-s${sd}`);
    for (const v of [6, 8, 16]) for (const rate of [64, 256, 1024, 4096]) for (const sd of [401, 402, 403]) ids.push(`g0-table-V-sp${v}-r${rate}-s${sd}`);
    return ids;
  };

  it("is the V check's vacancy build, S0's G0.3 without the three registered rate-0 seed-401 cells, and V's G0.3: 79 jobs", async () => {
    const out = freshDir();
    const { io, ran, logs } = mkIo(out);
    const r = await driveWith(args({ dryRun: true }), io, explorationHooks);
    expect(r.code).toBe(4);
    expect(ran).toEqual([]);
    const plan = planExploration(io.evaluate(), (id) => io.jobExists(id));
    expect(plan.defs).toHaveLength(79);
    expect(plan.defs.map((d) => d.id).sort()).toEqual(expectedFirstWave().sort());
    // the V check comes first: V's own jobs run only behind it
    expect(plan.defs[0].id).toBe("g0-vcheck-vacancy-S0-sp8-r0-s401");
    expect(logs[0]).toContain("wave: 79 jobs listed");
    // a dry run writes nothing
    expect(fs.existsSync(out)).toBe(false);
  });

  it("--machine-share splits the wave between two machines, every job owned once", async () => {
    const a = await (async () => { const m = mkIo(freshDir()); await driveWith(args({ dryRun: true, share: { i: 1, n: 2 } }), m.io, explorationHooks); return m.logs.filter((l) => l.includes("would run")); })();
    const b = await (async () => { const m = mkIo(freshDir()); await driveWith(args({ dryRun: true, share: { i: 2, n: 2 } }), m.io, explorationHooks); return m.logs.filter((l) => l.includes("would run")); })();
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(new Set([...a, ...b]).size).toBe(79);
    expect(a.length + b.length).toBe(79);
  });
});

// ---- the loop and the labels ----

describe("the exploration run and its labels (A1.4)", () => {
  it("both rungs work: every stage of both rungs runs, the horizon once, and the registered directory is never written", async () => {
    const before = snapshot(REG);
    const out = freshDir();
    const { io, ran } = mkIo(out);
    const r = await driveWith(args(), io, explorationHooks);
    expect(r.code).toBe(0);
    expect(new Set(ran.map((d) => d.id)).size).toBe(ran.length);
    // 79 + 3 horizon (shared, once) + 3 confirmations per rung
    expect(ran).toHaveLength(79 + 3 + 6);
    expect(ran.filter((d) => d.stage === "g0.horizon")).toHaveLength(3);
    expect(ran.filter((d) => d.stage === "g0.confirm" && d.rung === "S0")).toHaveLength(3);
    expect(ran.filter((d) => d.stage === "g0.confirm" && d.rung === "V")).toHaveLength(3);
    expect(ran.some((d) => d.stage === "g0.scan" || d.stage === "g0.meter")).toBe(false);
    const res = io.evaluate();
    expect(labels(res)).toEqual({ S0: "EXPLORATION-WORKS", V: "EXPLORATION-WORKS" });
    expect(res.rungs.map((e) => [e.rung, e.kappaW, e.vCal])).toEqual([["S0", 16, 8], ["V", 256, 8]]);
    expect(res.vcheck.state).toBe("identical");
    const ro = readout(out);
    expect(ro.code).toBe(0);
    expectNoVerdict(ro.out);
    expect(ro.out).toContain("- Rung S0 (removal kill): **EXPLORATION-WORKS (row 5)**");
    expect(ro.out).toContain("- Rung V (vacancy kill on S0): **EXPLORATION-WORKS (row 5)**");
    // the registered directory: same files, same bytes, same mtimes; no exploration job in it
    expect(snapshot(REG)).toEqual(before);
    expect(fs.readdirSync(REG).some((n) => n.startsWith("g0-table") || n.startsWith("g0-vcheck") || n.startsWith("g0-horizon") || n.startsWith("g0-confirm"))).toBe(false);
  }, 240_000);

  it("both rungs are evaluated in full when one works: S0 works and V still gets its confirmation and its own label", async () => {
    const sc: Scenario = { ...WORKS, confirm: (d) => (d.rung === "V" ? { LOSS: 120 } : "DC") };
    const out = freshDir();
    const { io, ran } = mkIo(out, sc);
    expect((await driveWith(args(), io, explorationHooks)).code).toBe(0);
    expect(ran.filter((d) => d.stage === "g0.confirm" && d.rung === "V")).toHaveLength(3);
    expect(labels(io.evaluate())).toEqual({ S0: "EXPLORATION-WORKS", V: "EXPLORATION-NO-CONFIRM" });
    // and the other way round: V works, S0 does not confirm
    const sc2: Scenario = { ...WORKS, confirm: (d) => (d.rung === "S0" ? { LOSS: 120 } : "DC") };
    const out2 = freshDir();
    const m2 = mkIo(out2, sc2);
    expect((await driveWith(args(), m2.io, explorationHooks)).code).toBe(0);
    expect(labels(m2.io.evaluate())).toEqual({ S0: "EXPLORATION-NO-CONFIRM", V: "EXPLORATION-WORKS" });
    const ro = readout(out2);
    expect(ro.code).toBe(0);
    expectNoVerdict(ro.out);
  }, 240_000);

  it("NO-EFFECT for each rung: a rung whose kill works at no two spreads ends at row 2, and the other runs on", async () => {
    const out = freshDir();
    const m = mkIo(out, { ...WORKS, s0dc: () => false });
    expect((await driveWith(args(), m.io, explorationHooks)).code).toBe(0);
    expect(labels(m.io.evaluate())).toEqual({ S0: "EXPLORATION-NO-EFFECT", V: "EXPLORATION-WORKS" });
    expect(m.ran.some((d) => d.stage === "g0.confirm" && d.rung === "S0")).toBe(false);
    const out2 = freshDir();
    const m2 = mkIo(out2, { ...WORKS, vdc: () => false });
    expect((await driveWith(args(), m2.io, explorationHooks)).code).toBe(0);
    expect(labels(m2.io.evaluate())).toEqual({ S0: "EXPLORATION-WORKS", V: "EXPLORATION-NO-EFFECT" });
    expect(m2.ran.some((d) => d.stage === "g0.confirm" && d.rung === "V")).toBe(false);
    // neither: no horizon is run
    const out3 = freshDir();
    const m3 = mkIo(out3, { ...WORKS, s0dc: () => false, vdc: () => false });
    expect((await driveWith(args(), m3.io, explorationHooks)).code).toBe(0);
    expect(labels(m3.io.evaluate())).toEqual({ S0: "EXPLORATION-NO-EFFECT", V: "EXPLORATION-NO-EFFECT" });
    expect(m3.ran.some((d) => d.stage === "g0.horizon")).toBe(false);
    const ro = readout(out3);
    expect(ro.code).toBe(0);
    expectNoVerdict(ro.out);
    expect(ro.out).toContain("(row 2: no rate works at 2 or more spreads: EXPLORATION-NO-EFFECT)");
  }, 240_000);

  it("NO-HORIZON for each rung that passed row 2: the shared horizon loses labels too soon (T_ctl / 4 below 50,000)", async () => {
    const out = freshDir();
    const m = mkIo(out, { ...WORKS, horizon: { LOSS: 150 } });
    expect((await driveWith(args(), m.io, explorationHooks)).code).toBe(0);
    expect(labels(m.io.evaluate())).toEqual({ S0: "EXPLORATION-NO-HORIZON", V: "EXPLORATION-NO-HORIZON" });
    expect(m.ran.some((d) => d.stage === "g0.confirm")).toBe(false);
    // only V passed row 2: the horizon is still run (for V), and S0 keeps its row-2 label
    const out2 = freshDir();
    const m2 = mkIo(out2, { ...WORKS, s0dc: () => false, horizon: { LOSS: 150 } });
    expect((await driveWith(args(), m2.io, explorationHooks)).code).toBe(0);
    expect(labels(m2.io.evaluate())).toEqual({ S0: "EXPLORATION-NO-EFFECT", V: "EXPLORATION-NO-HORIZON" });
    expect(m2.ran.filter((d) => d.stage === "g0.horizon")).toHaveLength(3);
    const ro = readout(out2);
    expect(ro.code).toBe(0);
    expectNoVerdict(ro.out);
  }, 240_000);

  it("V-VOID: a V check whose census differs voids V (exit 3) and S0 is still evaluated in full", async () => {
    const out = freshDir();
    writeAllPlanned(out, { ...WORKS, vcheckDiffers: true });
    // writeAllPlanned stops planning V once its check fails; V's own table jobs on disk as well (a V that ran):
    const full = freshDir();
    writeAllPlanned(full, WORKS);
    for (const n of fs.readdirSync(full)) if (!fs.existsSync(path.join(out, n))) fs.cpSync(path.join(full, n), path.join(out, n), { recursive: true });
    const res = mkIo(out).io.evaluate();
    expect(res.vcheck.state).toBe("different");
    expect(labels(res)).toEqual({ S0: "EXPLORATION-WORKS", V: "EXPLORATION-V-VOID" });
    const ro = readout(out);
    expect(ro.code).toBe(3);
    expectNoVerdict(ro.out);
    expect(ro.out).toContain("- Rung V (vacancy kill on S0): **EXPLORATION-V-VOID**");
  }, 240_000);

  it("a failed V check voids V only: the loop runs no V job behind it, S0 runs on to its label, and the run ends with exit 3", async () => {
    const out = freshDir();
    const m = mkIo(out, { ...WORKS, vcheckDiffers: true });
    expect((await driveWith(args(), m.io, explorationHooks)).code).toBe(3);
    expect(m.ran.some((d) => d.rung === "V" && d.stage !== "g0.vcheck")).toBe(false);
    // S0 in full: its table, the shared horizon and its confirmation (A1.1)
    expect(m.ran.filter((d) => d.rung === "S0" && d.stage === "g0.table")).toHaveLength(42);
    expect(m.ran.filter((d) => d.stage === "g0.horizon")).toHaveLength(3);
    expect(m.ran.filter((d) => d.rung === "S0" && d.stage === "g0.confirm")).toHaveLength(3);
    expect(labels(m.io.evaluate())).toEqual({ S0: "EXPLORATION-WORKS", V: "EXPLORATION-V-VOID" });
    const ro = readout(out);
    expect(ro.code).toBe(3);
    expectNoVerdict(ro.out);
    // a second invocation has nothing to run and still ends with exit 3
    const again = mkIo(out, { ...WORKS, vcheckDiffers: true });
    expect((await driveWith(args(), again.io, explorationHooks)).code).toBe(3);
    expect(again.ran).toEqual([]);
  }, 240_000);

  it("every other stage stop still stops everything, also beside a void V: a conservation failure, or unusable input", async () => {
    // a nonzero residual in an S0 table job: the loop stops at once, before the horizon
    const out = freshDir();
    const m = mkIo(out, { ...WORKS, vcheckDiffers: true, residualAt: (d) => d.id === "g0-table-S0-sp8-r16-s402" });
    expect((await driveWith(args(), m.io, explorationHooks)).code).toBe(3);
    expect(m.ran[m.ran.length - 1].id).toBe("g0-table-S0-sp8-r16-s402");
    expect(m.ran.some((d) => d.stage === "g0.horizon" || d.stage === "g0.confirm")).toBe(false);
    // a resumed run refuses to plan anything while that job is on disk
    const again = mkIo(out, WORKS);
    expect((await driveWith(args(), again.io, explorationHooks)).code).toBe(3);
    expect(again.ran).toEqual([]);
    // a bug indicator only the readout sees (a burn-in hash that differs within its group, here from the registered scan job's) beside a
    // failed V check: the loop stops after that job, before the horizon
    const out3 = freshDir();
    const m3 = mkIo(out3, { ...WORKS, vcheckDiffers: true, burnHashAt: (d) => d.id === "g0-table-S0-sp8-r0-s402" });
    expect((await driveWith(args(), m3.io, explorationHooks)).code).toBe(3);
    expect(m3.ran.some((d) => d.stage === "g0.horizon" || d.stage === "g0.confirm")).toBe(false);
    expect(m3.logs.join("\n")).toContain("burnHash differs within one burn-in group");
    // unusable input (a scan job in the exploration directory) beside a failed V check: nothing more runs
    const out2 = freshDir();
    const first = mkIo(out2, { ...WORKS, vcheckDiffers: true });
    await driveWith(args({ maxJobs: 1 }), first.io, explorationHooks);
    expect(first.ran.map((d) => d.id)).toEqual(["g0-vcheck-vacancy-S0-sp8-r0-s401"]);
    writeDef(out2, scanDefs("S0")[5], "CHURN");
    const m2 = mkIo(out2, WORKS);
    expect((await driveWith(args(), m2.io, explorationHooks)).code).toBe(3);
    expect(m2.ran).toEqual([]);
    expect(m2.logs.join("\n")).toContain("does not belong in the exploration directory");
  }, 240_000);

  it("V-VOID: V jobs on disk without a V check void V too (G0.1: an absent check)", () => {
    const out = freshDir();
    writeAllPlanned(out, WORKS);
    fs.rmSync(path.join(out, "g0-vcheck-vacancy-S0-sp8-r0-s401"), { recursive: true });
    const res = mkIo(out).io.evaluate();
    expect(res.vcheck.state).toBe("absent");
    expect(labels(res)).toEqual({ S0: "EXPLORATION-WORKS", V: "EXPLORATION-V-VOID" });
    expect(res.problems.code).toBe(3);
  });

  it("jobs still to run: exit 4, the jobs listed per rung", () => {
    const out = freshDir();
    writeAllPlanned(out, WORKS);
    fs.rmSync(path.join(out, "g0-table-V-sp16-r1024-s402"), { recursive: true });
    const ro = readout(out);
    expect(ro.code).toBe(4);
    expectNoVerdict(ro.out);
    expect(ro.out).toContain("rung V has 1 job to run (g0.table V (on S0) spread 16 rate 1024 seed 402)");
    expect(ro.out).toContain("- Rung S0 (removal kill): **EXPLORATION-WORKS (row 5)**");
    // an exploration directory with no job yet: exit 4 too, with the first wave to run
    const empty = freshDir();
    fs.mkdirSync(empty);
    const ro2 = readout(empty);
    expect(ro2.code).toBe(4);
    expectNoVerdict(ro2.out);
    expect(ro2.out).toContain("rung S0 has 42 jobs to run");
  });
});

// ---- refusals ----

describe("the exploration's refusals", () => {
  it("the readout refuses without Amendment 1 in RULES.md, or without RULES.md's hash in FROZEN, and still starts with the header", () => {
    const out = freshDir();
    fs.mkdirSync(out);
    const noA1 = readout(out, mkRoot(RULES_NO_A1, RULES_NO_A1));
    expect(noA1.code).toBe(2);
    expect(noA1.out.split("\n")[0]).toBe(EXPLORATION_HEADER);
    expect(noA1.out).toContain("Amendment 1");
    expect(noA1.out).toContain("heading");
    const notFrozen = readout(out, mkRoot(RULES_A1, null));
    expect(notFrozen.code).toBe(2);
    expect(notFrozen.out.split("\n")[0]).toBe(EXPLORATION_HEADER);
    expect(notFrozen.out).toContain("which FROZEN does not record");
    // with both, the same directory reads (exit 4: jobs to run)
    expect(readout(out).code).toBe(4);
    // --draft is not an exploration
    const draft = readout(out, ROOT, ["--draft"]);
    expect(draft.code).toBe(2);
    expect(draft.out.split("\n")[0]).toBe(EXPLORATION_HEADER);
  });

  it("the driver's check refuses the same way (dry run included: gate0.ts calls it before anything else)", () => {
    expect(explorationRefusal(new TextEncoder().encode(RULES_A1), `2026-10-24  ${sha(RULES_A1)}  RULES.md\n`)).toBeNull();
    expect(explorationRefusal(new TextEncoder().encode(RULES_NO_A1), `2026-10-24  ${sha(RULES_NO_A1)}  RULES.md\n`)).toMatch(/Amendment 1/);
    expect(explorationRefusal(new TextEncoder().encode(RULES_A1), "# nothing\n")).toMatch(/FROZEN does not record/);
    expect(explorationRefusal(null, "")).toMatch(/RULES.md does not exist/);
  });

  it("the two directories must be separate: never the registered one, nor one inside the other", () => {
    expect(explorationDirsRefusal("/a/runs/exp", "/a/runs/gate0")).toBeNull();
    expect(explorationDirsRefusal("/a/runs/gate0", "/a/runs/gate0")).toMatch(/neither inside the other/);
    expect(explorationDirsRefusal("/a/runs/gate0/exp", "/a/runs/gate0")).toMatch(/neither inside the other/);
    expect(explorationDirsRefusal("/a/runs", "/a/runs/gate0")).toMatch(/neither inside the other/);
    const ro = run(["gate0-exploration", "--jobs", REG, "--registered", REG, "--root", ROOT], nodeIo(ROOT));
    expect(ro.code).toBe(2);
    expect(ro.out.split("\n")[0]).toBe(EXPLORATION_HEADER);
  });

  it("the isolation check resolves symlinks: an --out under an alias of the registered directory is refused (driver and readout)", () => {
    const base = freshDir();
    fs.mkdirSync(base);
    const alias = path.join(base, "alias");
    fs.symlinkSync(REG, alias);
    // an output leaf that does not exist yet, under the alias, lands inside the registered tree
    expect(explorationDirsRefusal(path.join(alias, "exploration"), REG)).toMatch(/neither inside the other/);
    expect(explorationDirsRefusal(alias, REG)).toMatch(/neither inside the other/);
    expect(explorationDirsRefusal(path.join(base, "exploration", "deeper"), alias)).toBeNull();
    // the registered directory named through an alias of the parent of --out
    const parentAlias = path.join(base, "up");
    fs.symlinkSync(path.dirname(REG), parentAlias);
    expect(explorationDirsRefusal(path.join(path.dirname(REG), "x-new"), path.join(parentAlias, path.basename(REG)))).toBeNull();
    expect(explorationDirsRefusal(path.join(REG, "new"), path.join(parentAlias, path.basename(REG)))).toMatch(/neither inside the other/);
    const ro = run(["gate0-exploration", "--jobs", path.join(alias, "exploration"), "--registered", REG, "--root", ROOT], nodeIo(ROOT));
    expect(ro.code).toBe(2);
    expect(ro.out.split("\n")[0]).toBe(EXPLORATION_HEADER);
    expect(ro.out).toContain("neither inside the other");
  });

  it("the isolation check reads a child whose name starts with two dots as inside, and a real parent step as outside (driver and readout)", () => {
    const base = freshDir();
    fs.mkdirSync(base);
    const reg = path.join(base, "registered");
    fs.mkdirSync(reg);
    // a child named "..exploration" is inside the registered directory, not a step up out of it
    expect(explorationDirsRefusal(path.join(reg, "..exploration"), reg)).toMatch(/neither inside the other/);
    expect(explorationDirsRefusal(path.join(reg, "..exploration", "deeper"), reg)).toMatch(/neither inside the other/);
    fs.mkdirSync(path.join(reg, "..existing"));
    expect(explorationDirsRefusal(path.join(reg, "..existing"), reg)).toMatch(/neither inside the other/);
    // a sibling whose name starts with two dots is outside; the parent contains the registered directory
    expect(explorationDirsRefusal(path.join(base, "..sibling"), reg)).toBeNull();
    expect(explorationDirsRefusal(path.join(reg, ".."), reg)).toMatch(/neither inside the other/);
    const ro = run(["gate0-exploration", "--jobs", path.join(REG, "..exploration"), "--registered", REG, "--root", ROOT], nodeIo(ROOT));
    expect(ro.code).toBe(2);
    expect(ro.out.split("\n")[0]).toBe(EXPLORATION_HEADER);
    expect(ro.out).toContain("neither inside the other");
  });

  it("gate0.ts prints the exploration header before parsing, so an argument refusal starts with it too", () => {
    for (const argv of [["--exploration", "--out=x"], ["--exploration", "--out=x", "--registered=y", "--rung=S1"], ["--exploration", "--out=x", "--registered=y", "--plan-all"], ["--exploration", "--out=x", "--registered=y", "--dense"]]) {
      const lines: string[] = [];
      expect(() => parseCommandLine(argv, (l) => lines.push(l))).toThrow(UsageError);
      expect(lines).toEqual([EXPLORATION_HEADER]);
    }
    const ok: string[] = [];
    expect(parseCommandLine(["--exploration", "--out=x", "--registered=y"], (l) => ok.push(l)).mode).toBe("exploration");
    expect(ok).toEqual([EXPLORATION_HEADER]);
    // the registered run prints no exploration header
    const reg: string[] = [];
    expect(parseCommandLine(["--gate0", "--out=x"], (l) => reg.push(l)).mode).toBe("gate0");
    expect(reg).toEqual([]);
  });

  it("the command line: --exploration needs --out and --registered, and --registered is for --exploration only", () => {
    expect(parseArgs(["--exploration", "--out=x", "--registered=y", "--dry-run", "--machine-share=1/2"])).toMatchObject({ mode: "exploration", out: "x", registered: "y", dryRun: true, share: { i: 1, n: 2 } });
    expect(() => parseArgs(["--exploration", "--out=x"])).toThrow(UsageError);
    expect(() => parseArgs(["--exploration", "--registered=y"])).toThrow(UsageError);
    expect(() => parseArgs(["--gate0", "--out=x", "--registered=y"])).toThrow(UsageError);
    expect(() => parseArgs(["--exploration", "--out=x", "--registered=y", "--rung=S1"])).toThrow(UsageError);
  });
});
