// Tests of the Gate-0 driver's loop (experiments/3d-rps/gate0-spike/driver.ts) with a fake job runner: the jobs are written as the
// readout's synthetic fixtures (a driver's files, made up to land in a given row), and everything else is real: the planner, the
// readout's loader and Gate-0 evaluation, the file system. This is what makes "resumable, staged, safe to split across two machines"
// a tested statement. No GPU; nothing here is a result.

import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { StageStop, jobExists, publishJob, publishMissing, retainLostRace, type KernelJobResult } from "../3d-rps/lib/kernel-job.ts";
import { ALL_RUNGS } from "../3d-rps/gate0-spike/cli.ts";
import { diskIo, drive, stageStops, vcheckState, type DriverIo } from "../3d-rps/gate0-spike/driver.ts";
import { ownerOf, vcheckDefs, type JobDef } from "../3d-rps/gate0-spike/plan.ts";
import type { SubstrateRung } from "../3d-rps/readout-jobs.ts";
import { CARPETS_3, CARPETS_5, DLAB_3, DLAB_5, G_5, meterJob, rawJob, rowsOf, type ClassSpec, type FixtureJob } from "./rps-fixtures.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rps-gate0-driver-"));
let dirCounter = 0;
const freshDir = (): string => path.join(tmpRoot, `d${dirCounter++}`);
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

interface Scenario {
  carpets: (rung: SubstrateRung) => number[];
  dlab: (rung: SubstrateRung) => Record<number, number>;
  /** Is a nonzero-rate table or confirmation job DC? */
  dc: (d: JobDef) => boolean;
  horizon: (d: JobDef) => ClassSpec;
  /** The vacancy build's V-check census differs from the removal build's. */
  vcheckDiffers?: boolean;
  /** This job's run fails twice with a conservation failure. */
  stopAt?: (d: JobDef) => boolean;
  /** The class of the G0.6 dense job (default CHURN, a carpet). */
  dense?: ClassSpec;
}

const HAPPY: Scenario = { carpets: () => CARPETS_5, dlab: () => DLAB_5, dc: (d) => d.rate >= (d.rung === "V" ? 256 : 16), horizon: () => "CHURN" };
/** S0 has levels but no effect (the kill washes out), S1 is GO. */
const S1_GOES: Scenario = { ...HAPPY, dc: (d) => d.rung === "S1" && d.rate >= 16 };
/** S0 and S1 both have levels and no effect: only V can give GO, on S0's substrate. */
const V_AFTER_TWO: Scenario = { ...HAPPY, dc: (d) => d.rung === "V" && d.rate >= 256 };
/** S0 has levels but no effect (the kill washes out), S1 has too few levels: only V can give GO. */
const ONLY_V: Scenario = { ...HAPPY, carpets: (r) => (r === "S1" ? CARPETS_3 : CARPETS_5), dlab: (r) => (r === "S1" ? DLAB_3 : DLAB_5), dc: (d) => d.rung === "V" && d.rate >= 256 };

function classOf(d: JobDef, sc: Scenario): ClassSpec {
  switch (d.stage) {
    case "g0.scan":
      return sc.carpets(d.substrate).includes(d.spread) ? "CHURN" : "SPARSE";
    case "g0.table":
    case "g0.confirm":
      return d.rate === 0 ? "CHURN" : sc.dc(d) ? "DC" : "CHURN";
    case "g0.horizon":
    case "g0.horizon-rung":
      return sc.horizon(d);
    case "g0.dense":
      return sc.dense ?? "CHURN";
    default:
      return "CHURN";
  }
}

/** What the driver would have written for a job (the readout's synthetic fixtures, under the planner's ids). */
function write(out: string, d: JobDef, sc: Scenario): KernelJobResult {
  if (sc.stopAt?.(d)) {
    const fail = (attempt: number) => ({ attempt, kind: "conservation" as const, message: "energy residual 1 at step 3000", step: 3000, detail: { residual: "1" } });
    publishMissing(out, d.id, { id: d.id, stage: d.stage, seed: d.seed, rung: d.rung, kill: d.kill, spread: d.spread, rpsRate: d.rate }, [fail(1), fail(2)], "");
    throw new Error("publishMissing must throw StageStop");
  }
  let summary: Record<string, unknown>;
  let census: string | null = null;
  if (d.kind === "meter") {
    const mj = meterJob({ rung: d.substrate, spread: d.spread, axis: d.axis!, D: sc.dlab(d.substrate)[d.spread], bMeter: d.bMeter, seed: d.seed }) as FixtureJob;
    summary = { ...mj.raw.summary, id: d.id };
  } else {
    const rows = d.stage === "g0.vcheck" && d.kill === "vacancy" && sc.vcheckDiffers ? (() => { const r = rowsOf("CHURN", 20); r.run[7] = { ...r.run[7], ndom: 151 }; return r; })() : undefined;
    const raw = rawJob({ id: d.id, stage: d.stage, rung: d.rung, kill: d.kill, substrate: d.substrate, seed: d.seed, spread: d.spread, rate: d.rate, nRun: d.runSteps / 1000, cls: classOf(d, sc), stepsPerSec: 700, ...(rows ? { rows } : {}) });
    summary = raw.summary;
    census = raw.census;
  }
  const files: Record<string, string> = { "summary.json": JSON.stringify(summary) };
  if (census !== null) files["census.tsv"] = census;
  publishJob(out, d.id, files);
  return { status: "done", dir: path.join(out, d.id), summary };
}

interface Run {
  io: DriverIo;
  ran: JobDef[];
  logs: string[];
}

function mkIo(out: string, sc: Scenario = HAPPY): Run {
  const ran: JobDef[] = [];
  const logs: string[] = [];
  const io: DriverIo = {
    ...diskIo(out, ROOT),
    run: async (d) => {
      ran.push(d);
      return write(out, d, sc);
    },
    log: (l) => logs.push(l),
  };
  return { io, ran, logs };
}

const args = (o: Partial<Parameters<typeof drive>[0]> = {}): Parameters<typeof drive>[0] => ({
  rungs: [...ALL_RUNGS], planAll: false, share: null, reverse: false, dense: false, dryRun: false, only: null, maxJobs: null, ...o,
});
const ids = (ds: readonly JobDef[]) => ds.map((d) => d.id);
const firstIndex = (ds: readonly JobDef[], f: (d: JobDef) => boolean) => ds.findIndex(f);
const lastIndex = (ds: readonly JobDef[], f: (d: JobDef) => boolean) => ds.length - 1 - [...ds].reverse().findIndex(f);

describe("the Gate-0 loop: a single machine", () => {
  it("S0 GO stops: the stages of S0 run in order, each when its inputs are on disk, and then nothing of S1 or V is run (decision O-8)", async () => {
    const out = freshDir();
    const { io, ran, logs } = mkIo(out);
    const r = await drive(args(), io);
    expect(r.code).toBe(0);
    expect(new Set(ids(ran)).size).toBe(ran.length);
    // S0: 12 scans, 24 meters (12 spreads, x and y), 42 table jobs, 3 horizon, 3 confirmation; and nothing else
    expect(ran).toHaveLength(84);
    expect(ran.every((d) => d.rung === "S0")).toBe(true);
    const s0 = ran;
    expect(s0.filter((d) => d.stage === "g0.scan")).toHaveLength(12);
    expect(s0.filter((d) => d.stage === "g0.meter")).toHaveLength(24);
    expect(s0.filter((d) => d.stage === "g0.table")).toHaveLength(42);
    expect(s0.filter((d) => d.stage === "g0.horizon")).toHaveLength(3);
    expect(s0.filter((d) => d.stage === "g0.confirm")).toHaveLength(3);
    // each stage starts after the one it needs has finished
    const of = (stage: string) => (d: JobDef) => d.rung === "S0" && d.stage === stage;
    expect(lastIndex(ran, of("g0.scan"))).toBeLessThan(firstIndex(ran, of("g0.meter")));
    expect(lastIndex(ran, of("g0.meter"))).toBeLessThan(firstIndex(ran, of("g0.table")));
    expect(lastIndex(ran, of("g0.table"))).toBeLessThan(firstIndex(ran, of("g0.horizon")));
    expect(lastIndex(ran, of("g0.horizon"))).toBeLessThan(firstIndex(ran, of("g0.confirm")));
    // the readout's verdict: S1 and V are marked as not run, not as jobs to run
    const res = diskIo(out, ROOT).evaluate();
    expect(res.overall).toEqual({ status: "go", used: "S0" });
    expect(res.rungs.filter((e) => e.rung !== "S0").every((e) => e.notRun === "S0")).toBe(true);
    expect(res.problems.code).toBe(0);
    expect(res.operatingPoint).toMatchObject({ rung: "S0", kill: "removal", substrate: "S0", gSpread: G_5, vCal: 12, kappaW: 16, rCal: [8, 16, 32, 64], h0: 200_000, shape: [128, 128, 4], denseRate: null });
    expect(logs.some((l) => l.startsWith("wave:"))).toBe(true);
    expect(logs.join("\n")).toContain("S1: not planned yet, S0 comes first");
    // a second call has nothing to do
    const again = mkIo(out);
    expect((await drive(args(), again.io)).code).toBe(0);
    expect(again.ran).toEqual([]);
  }, 180_000);

  it("--plan-all runs S1 beside S0 (side by side, D2) and V behind its check, whatever the first GO", async () => {
    const out = freshDir();
    const { io, ran } = mkIo(out);
    const r = await drive(args({ planAll: true }), io);
    expect(r.code).toBe(0);
    expect(new Set(ids(ran)).size).toBe(ran.length);
    expect(ran.filter((d) => d.rung === "S0" && d.stage !== "g0.vcheck")).toHaveLength(84);
    expect(ran.some((d) => d.rung === "S1" && d.stage === "g0.confirm")).toBe(true);
    const iV = firstIndex(ran, (d) => d.rung === "V" && d.stage === "g0.table");
    expect(iV).toBeGreaterThan(-1);
    expect(lastIndex(ran, (d) => d.stage === "g0.vcheck")).toBeLessThan(iV);
    expect(ran.filter((d) => d.stage === "g0.vcheck")).toHaveLength(2);
    const res = diskIo(out, ROOT).evaluate();
    expect(res.overall).toEqual({ status: "go", used: "S0" });
    expect(res.vcheck.state).toBe("identical");
    expect(res.rungs.every((e) => e.notRun === null)).toBe(true);
  }, 240_000);

  it("S0 NO-GO then S1 GO stops before V's own rows: S0 runs to its verdict, then S1, and no V check and no V row is ever run", async () => {
    const out = freshDir();
    const { io, ran } = mkIo(out, S1_GOES);
    const r = await drive(args(), io);
    expect(r.code).toBe(0);
    expect(ran.some((d) => d.rung === "V" || d.stage === "g0.vcheck")).toBe(false);
    expect(ran.some((d) => d.rung === "S1" && d.stage === "g0.confirm")).toBe(true);
    // the queue is in the order of preference: all of S0 (down to its verdict at row 2) before the first job of S1
    expect(lastIndex(ran, (d) => d.rung === "S0")).toBeLessThan(firstIndex(ran, (d) => d.rung === "S1"));
    const res = diskIo(out, ROOT).evaluate();
    expect(res.rungs.map((e) => [e.rung, e.verdict, e.notRun])).toEqual([["S0", "NO-GO: EFFECT", null], ["S1", "GO", null], ["V", null, "S1"]]);
    expect(res.overall).toEqual({ status: "go", used: "S1" });
    expect(res.operatingPoint).toMatchObject({ rung: "S1", kill: "removal" });
    expect(res.problems.code).toBe(0);
  }, 240_000);

  it("S0 and S1 excluded runs V: V's check and rows come after the last job of S1, and V is the answer", async () => {
    const out = freshDir();
    const { io, ran } = mkIo(out, V_AFTER_TWO);
    const r = await drive(args(), io);
    expect(r.code).toBe(0);
    const res = diskIo(out, ROOT).evaluate();
    expect(res.rungs.map((e) => [e.rung, e.verdict])).toEqual([["S0", "NO-GO: EFFECT"], ["S1", "NO-GO: EFFECT"], ["V", "GO"]]);
    expect(res.overall).toEqual({ status: "go", used: "V" });
    // S0's jobs first, S1's next; the V check and the V rows only once both are excluded (S0's shared horizon is a job of V's turn)
    const isShared = (d: JobDef) => d.rung === "S0" && (d.stage === "g0.horizon" || d.stage === "g0.vcheck");
    expect(lastIndex(ran, (d) => d.rung === "S0" && !isShared(d))).toBeLessThan(firstIndex(ran, (d) => d.rung === "S1"));
    expect(lastIndex(ran, (d) => d.rung === "S1")).toBeLessThan(firstIndex(ran, (d) => d.stage === "g0.vcheck" || d.rung === "V" || isShared(d)));
    expect(ran.filter((d) => d.rung === "V" && d.stage === "g0.table")).toHaveLength(36);
    expect(res.vcheck.state).toBe("identical");
  }, 240_000);

  it("--rung names the rungs: S0 alone runs 84 jobs and nothing of S1 or V", async () => {
    const { io, ran } = mkIo(freshDir());
    const r = await drive(args({ rungs: ["S0"] }), io);
    expect(r.code).toBe(0);
    expect(ran).toHaveLength(84);
    expect(ran.every((d) => d.rung === "S0")).toBe(true);
  }, 180_000);

  it("--dry-run lists the wave and runs nothing", async () => {
    const { io, ran, logs } = mkIo(freshDir());
    const r = await drive(args({ dryRun: true }), io);
    expect(ran).toEqual([]);
    expect(r.code).toBe(4);
    // the default takes the rungs in the order S0, S1, S2, V: S1 waits for S0's verdict
    expect(logs.find((l) => l.startsWith("wave:"))).toContain("wave: 12 jobs listed (S0 g0.scan x12)");
    expect(logs.filter((l) => l.includes("would run"))).toHaveLength(12);
    const all = mkIo(freshDir());
    expect((await drive(args({ dryRun: true, planAll: true }), all.io)).code).toBe(4);
    expect(all.logs.find((l) => l.startsWith("wave:"))).toContain("wave: 24 jobs listed (S0 g0.scan x12, S1 g0.scan x12)");
  });

  it("--max-jobs stops after that many jobs, and the next call carries on: the pieces add up to one run", async () => {
    const whole = mkIo(freshDir());
    await drive(args({ rungs: ["S0"] }), whole.io);
    const out = freshDir();
    const ran: JobDef[] = [];
    let calls = 0;
    for (;;) {
      const piece = mkIo(out);
      const r = await drive(args({ rungs: ["S0"], maxJobs: 25 }), piece.io);
      ran.push(...piece.ran);
      calls++;
      if (r.code === 0) break;
      expect(r.code).toBe(4);
      expect(piece.ran).toHaveLength(25);
      expect(calls).toBeLessThan(10);
    }
    expect(calls).toBe(4);
    expect(new Set(ids(ran))).toEqual(new Set(ids(whole.ran)));
    expect(ran).toHaveLength(whole.ran.length);
  }, 180_000);

  it("--only runs the jobs whose id contains the text, --reverse walks the list from the other end", async () => {
    const only = mkIo(freshDir());
    await drive(args({ rungs: ["S0"], only: "sp12-", maxJobs: 100 }), only.io);
    expect(only.ran.length).toBeGreaterThan(0);
    expect(only.ran.every((d) => d.id.includes("sp12-"))).toBe(true);
    const fwd = mkIo(freshDir());
    const rev = mkIo(freshDir());
    await drive(args({ rungs: ["S0"], maxJobs: 12 }), fwd.io);
    await drive(args({ rungs: ["S0"], maxJobs: 12, reverse: true }), rev.io);
    expect(ids(rev.ran)).toEqual(ids(fwd.ran).reverse());
  }, 120_000);

  it("--dense plans the G0.6 job once Gate 0 is GO, and the readout reads its steps per second", async () => {
    const out = freshDir();
    await drive(args({ rungs: ["S0"] }), mkIo(out).io);
    expect(diskIo(out, ROOT).evaluate().dense).toBeNull();
    const dense = mkIo(out);
    expect((await drive(args({ rungs: ["S0"], dense: true }), dense.io)).code).toBe(0);
    expect(dense.ran).toHaveLength(1);
    expect(dense.ran[0]).toMatchObject({ stage: "g0.dense", rung: "S0", seed: 404, spread: 12, rate: 0, runSteps: 20_000 });
    const res = diskIo(out, ROOT).evaluate();
    expect(res.dense?.stepsPerSec).toBe(700);
    expect(res.operatingPoint?.denseRate).toBe(700);
  }, 180_000);

  it("--dense with a dense job that did not start (NOSTART) or is no carpet: the stage stops with code 3, the dense rate stays unavailable, and the registered stages have nothing to key the schedule to (final review, finding 10)", async () => {
    for (const dense of [{ NOSTART: "liv" }, { EXT: 8 }, "SPARSE"] as ClassSpec[]) {
      const out = freshDir();
      await drive(args({ rungs: ["S0"] }), mkIo(out).io);
      const bad = mkIo(out, { ...HAPPY, dense });
      const r = await drive(args({ rungs: ["S0"], dense: true }), bad.io);
      expect(bad.ran.map((d) => d.stage)).toEqual(["g0.dense"]);
      expect(r.code).toBe(3);
      expect(bad.logs.join("\n")).toMatch(/STAGE STOPPED \(rule draft 1\.3, 8\.4\).*exit 3: .*the dense-rate job is not the dense case G0\.6 names/s);
      const res = diskIo(out, ROOT).evaluate();
      expect(res.overall).toEqual({ status: "go", used: "S0" }); // the verdict stands
      expect(res.operatingPoint?.denseRate).toBeNull();
      expect(res.problems.code).toBe(3);
    }
  }, 300_000);

  it("a rung that is not GO leaves the next to run: S0 out on EFFECT and S1 out on levels, and only V gives GO, on S0's substrate", async () => {
    const out = freshDir();
    const { io, ran } = mkIo(out, ONLY_V);
    const r = await drive(args(), io);
    expect(r.code).toBe(0);
    const res = diskIo(out, ROOT).evaluate();
    expect(res.rungs.map((e) => [e.rung, e.verdict])).toEqual([["S0", "NO-GO: EFFECT"], ["S1", "NO-GO: LEVELS"], ["V", "GO"]]);
    expect(res.overall).toEqual({ status: "go", used: "V" });
    expect(res.vcheck.state).toBe("identical");
    expect(res.operatingPoint).toMatchObject({ rung: "V", kill: "vacancy", substrate: "S0", gSpread: G_5, vCal: 12, kappaW: 256, rCal: [128, 256, 512, 1024], h0: 200_000 });
    // V's jobs ran on S0's: its table, its confirmation, behind the V check; the horizon was run once, as an S0 job
    expect(ran.filter((d) => d.rung === "V" && d.stage === "g0.table")).toHaveLength(36);
    expect(ran.filter((d) => d.rung === "V" && d.stage === "g0.confirm")).toHaveLength(3);
    expect(ran.filter((d) => d.stage === "g0.horizon")).toHaveLength(3);
    expect(ran.filter((d) => d.stage === "g0.horizon").every((d) => d.rung === "S0")).toBe(true);
    // S2 was never due: S1 failed on levels but S0 did not
    expect(ran.some((d) => d.rung === "S2")).toBe(false);
  }, 180_000);
});

describe("the Gate-0 loop: the V check", () => {
  it("a V check whose census files differ stops the driver before any V job", async () => {
    const out = freshDir();
    const { io, ran, logs } = mkIo(out, { ...HAPPY, dc: (d) => d.rung === "V" && d.rate >= 256, vcheckDiffers: true });
    const r = await drive(args(), io);
    expect(r.code).toBe(3);
    expect(logs.some((l) => l.startsWith("V CHECK FAILED"))).toBe(true);
    expect(ran.filter((d) => d.stage === "g0.vcheck")).toHaveLength(2);
    expect(ran.some((d) => d.rung === "V" && d.stage === "g0.table")).toBe(false);
    expect(diskIo(out, ROOT).evaluate().vcheck.state).toBe("different");
  }, 180_000);

  it("a machine that does not hold both V-check jobs does not run V jobs", async () => {
    // S0 is run to its verdict (no effect, so V is due on its substrate) on one machine, its directory copied to another that handles V only
    const done = freshDir();
    await drive(args({ rungs: ["S0"] }), mkIo(done, V_AFTER_TWO).io);
    const [removal, vacancy] = vcheckDefs("S0", 12);
    let n = 2;
    while (ownerOf(removal.id, n) === ownerOf(vacancy.id, n)) n++;
    const mine = ownerOf(removal.id, n) + 1; // owns the removal build's check only
    const out = freshDir();
    fs.cpSync(done, out, { recursive: true });
    const { io, ran, logs } = mkIo(out);
    const r = await drive(args({ rungs: ["V"], share: { i: mine, n } }), io);
    expect(ran.map((d) => d.id)).toContain(removal.id);
    expect(ran.map((d) => d.id)).not.toContain(vacancy.id);
    expect(ran.some((d) => d.rung === "V" && d.stage === "g0.table")).toBe(false);
    expect(logs.some((l) => l.includes("needs the V check"))).toBe(true);
    expect(r.code).toBe(4);
    expect(vcheckState(io, diskIo(out, ROOT).evaluate()).state).toBe("incomplete");
  }, 180_000);
});

describe("the Gate-0 loop: two machines", () => {
  it("two machines with --machine-share and an rsync between rounds run every job once, and both end with the same results", async () => {
    const A = freshDir();
    const B = freshDir();
    const sync = () => {
      for (const [from, to] of [[A, B], [B, A]]) {
        for (const id of fs.readdirSync(from)) if (!id.startsWith(".") && !fs.existsSync(path.join(to, id))) fs.cpSync(path.join(from, id), path.join(to, id), { recursive: true });
      }
    };
    const a = mkIo(A);
    const b = mkIo(B);
    let rounds = 0;
    for (;;) {
      const ra = await drive(args({ rungs: ["S0"], share: { i: 1, n: 2 } }), a.io);
      const rb = await drive(args({ rungs: ["S0"], share: { i: 2, n: 2 } }), b.io);
      sync();
      rounds++;
      if (ra.code === 0 && rb.code === 0) break;
      expect([ra.code, rb.code].every((c) => c === 0 || c === 4)).toBe(true);
      expect(rounds).toBeLessThan(12);
    }
    const all = [...a.ran, ...b.ran];
    expect(all).toHaveLength(84);
    expect(new Set(ids(all)).size).toBe(84);
    expect(a.ran.length).toBeGreaterThan(20);
    expect(b.ran.length).toBeGreaterThan(20);
    expect(a.ran.every((d) => ownerOf(d.id, 2) === 0)).toBe(true);
    expect(b.ran.every((d) => ownerOf(d.id, 2) === 1)).toBe(true);
    expect(fs.readdirSync(A).sort()).toEqual(fs.readdirSync(B).sort());
    expect(diskIo(A, ROOT).evaluate().overall).toEqual({ status: "go", used: "S0" });
    expect(rounds).toBeGreaterThanOrEqual(5);
  }, 240_000);

  it("a machine alone with half the work waits for the other half: exit 4, nothing of the other share run", async () => {
    const out = freshDir();
    const { io, ran } = mkIo(out);
    const r = await drive(args({ rungs: ["S0"], share: { i: 1, n: 2 } }), io);
    expect(r.code).toBe(4);
    expect(r.waiting).toBeGreaterThan(0);
    expect(ran).toHaveLength(12 - r.waiting);
    expect(ran.every((d) => ownerOf(d.id, 2) === 0 && d.stage === "g0.scan")).toBe(true);
  });
});

describe("the Gate-0 loop: what is on disk is checked before more jobs are planned (Codex finding 3, spike check A5)", () => {
  const put = (out: string, o: Parameters<typeof rawJob>[0], tweak: (s: Record<string, unknown>) => void = () => {}) => {
    const raw = rawJob(o);
    tweak(raw.summary);
    publishJob(out, o.id!, { "summary.json": JSON.stringify(raw.summary), "census.tsv": raw.census });
  };
  const scan = { id: "a", stage: "g0.scan" as const, rung: "S0" as const, kill: "removal" as const, seed: 401, spread: 16, rate: 0, nRun: 20, cls: "CHURN" as const };

  it("jobs of one seed and one burn-in config whose burnHash differ: the loop stops at once and plans nothing", async () => {
    const out = freshDir();
    put(out, { ...scan, burnHash: "aaaaaaaaaaaaaaaa" });
    put(out, { ...scan, id: "b", stage: "g0.table", rate: 32, cls: "DC", burnHash: "bbbbbbbbbbbbbbbb" });
    const { io, ran, logs } = mkIo(out);
    const r = await drive(args(), io);
    expect(r.code).toBe(3);
    expect(ran).toEqual([]);
    expect(logs.join("\n")).toMatch(/STAGE STOPPED \(rule draft 1\.3, 8\.4\): the readout finds a problem in the jobs on disk/);
    expect(logs.join("\n")).toMatch(/exit 3: burnHash differs/);
    expect(logs.join("\n")).not.toMatch(/wave:/);
  });

  it("a dry run stops the same way: its wave would not be trustworthy", async () => {
    const out = freshDir();
    put(out, { ...scan, burnHash: "aaaaaaaaaaaaaaaa" });
    put(out, { ...scan, id: "b", stage: "g0.table", rate: 32, cls: "DC", burnHash: "bbbbbbbbbbbbbbbb" });
    const { io, logs } = mkIo(out);
    expect((await drive(args({ dryRun: true }), io)).code).toBe(3);
    expect(logs.join("\n")).not.toMatch(/would run/);
  });

  it("a summary.json that cannot be read in a started directory is unusable input: the loop stops (an empty directory is only the start)", async () => {
    const out = freshDir();
    fs.mkdirSync(path.join(out, "junk"), { recursive: true });
    fs.writeFileSync(path.join(out, "junk", "summary.json"), "{not json");
    const { io, ran, logs } = mkIo(out);
    const r = await drive(args(), io);
    expect(r.code).toBe(3);
    expect(ran).toEqual([]);
    expect(logs.join("\n")).toMatch(/exit 2: .*summary\.json/);
  });

  it("a directory with only hidden entries, a notes file or an empty subdirectory is still the start of a run", async () => {
    for (const setup of [
      (out: string) => fs.mkdirSync(path.join(out, ".tmp-old"), { recursive: true }),
      (out: string) => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "notes.md"), "pilot notes\n"); },
      (out: string) => { fs.mkdirSync(path.join(out, "logs"), { recursive: true }); fs.writeFileSync(path.join(out, "logs", "run.txt"), "x\n"); },
    ]) {
      const out = freshDir();
      setup(out);
      const { io, logs } = mkIo(out);
      const r = await drive(args({ dryRun: true }), io);
      expect(r.code).toBe(4);
      expect(logs.join("\n")).toMatch(/wave: 12 jobs listed/);
    }
  });

  it("a job that passed on a rerun after a conservation failure stops the stage, as a MISSING marker with one would", async () => {
    const out = freshDir();
    put(out, scan, (s) => {
      s.attempts = 2;
      s.retried = [{ attempt: 1, kind: "conservation", step: 8000, message: "matter changed", detail: {} }];
    });
    const { io, ran, logs } = mkIo(out);
    const r = await drive(args(), io);
    expect(r.code).toBe(3);
    expect(ran).toEqual([]);
    expect(logs[0]).toMatch(/STAGE STOPPED \(rule draft 1\.3\): a: an earlier attempt failed a conservation check \(the rerun passed\)/);
  });

  it("a rerun that passed but lost the publish race with a conservation failure behind it stops the stage, and the stop is durable: the next run refuses on the hidden file alone (final review, finding 1)", async () => {
    const out = freshDir();
    const logs: string[] = [];
    const ran: JobDef[] = [];
    const io: DriverIo = {
      ...diskIo(out, ROOT),
      run: async (d) => {
        ran.push(d);
        write(out, d, HAPPY); // the other process published the job first
        retainLostRace(out, d.id, [{ attempt: 1, kind: "conservation", message: "matter changed", step: 8000, detail: {} }], { attempts: 2 }); // throws StageStop
        throw new Error("retainLostRace must throw StageStop");
      },
      log: (l) => logs.push(l),
    };
    const r = await drive(args(), io);
    expect(r.code).toBe(3);
    expect(ran).toHaveLength(1);
    expect(logs.join("\n")).toMatch(/STAGE STOPPED \(rule draft 1\.3\): stage stopped: job g0-scan-S0-sp2-r0-s401 passed on the rerun but another process had published it first/);
    expect(logs.join("\n")).toMatch(/Another process published the job; the failures of this process's earlier attempt are in the hidden \.retried-\*\.json file/);
    // the next run, on the directory alone: it plans nothing and says why
    const again = mkIo(out);
    const r2 = await drive(args(), again.io);
    expect(r2.code).toBe(3);
    expect(again.ran).toEqual([]);
    expect(again.logs[0]).toMatch(/STAGE STOPPED \(rule draft 1\.3\): \.retried-g0-scan-S0-sp2-r0-s401-\d+-\d+\.json: an earlier attempt failed a conservation check, and the rerun that passed lost the publish race to another process/);
    // a dry run refuses in the same way
    expect((await drive(args({ dryRun: true }), mkIo(out).io)).code).toBe(3);
  });

  it("a job that failed twice with a conservation failure while another process published it cleanly stops the stage, and a fresh invocation still stops on the hidden marker (verification round, finding 1)", async () => {
    const out = freshDir();
    const logs: string[] = [];
    const ran: JobDef[] = [];
    const io: DriverIo = {
      ...diskIo(out, ROOT),
      run: async (d) => {
        ran.push(d);
        write(out, d, HAPPY); // the other process published a clean job first
        const fail = (attempt: number) => ({ attempt, kind: "conservation" as const, message: "energy residual 1 at step 3000", step: 3000, detail: { residual: "1" } });
        publishMissing(out, d.id, { id: d.id, stage: d.stage, seed: d.seed, rung: d.rung, kill: d.kill, spread: d.spread, rpsRate: d.rate }, [fail(1), fail(2)], ""); // throws StageStop
        throw new Error("publishMissing must throw StageStop");
      },
      log: (l) => logs.push(l),
    };
    const r = await drive(args(), io);
    expect(r.code).toBe(3);
    expect(ran).toHaveLength(1);
    expect(logs.join("\n")).toMatch(/STAGE STOPPED \(rule draft 1\.3\): stage stopped: job g0-scan-S0-sp2-r0-s401 failed twice .*another process had published it first, so its MISSING marker is in \.retried-g0-scan-S0-sp2-r0-s401-\d+-\d+\.json/);
    expect(logs.join("\n")).toMatch(/this process's MISSING marker, with its failures, is in the hidden \.retried-g0-scan-S0-sp2-r0-s401-\d+-\d+\.json beside the jobs/);
    // the published job is the clean one; the next invocation, on the directory alone, plans nothing and says why
    expect(jobExists(out, "g0-scan-S0-sp2-r0-s401")).toBe(true);
    const again = mkIo(out);
    const r2 = await drive(args(), again.io);
    expect(r2.code).toBe(3);
    expect(again.ran).toEqual([]);
    expect(again.logs[0]).toMatch(/STAGE STOPPED \(rule draft 1\.3\): \.retried-g0-scan-S0-sp2-r0-s401-\d+-\d+\.json: matter changed/);
    expect((await drive(args({ dryRun: true }), mkIo(out).io)).code).toBe(3);
  });

  it("a crash on the first attempt does not", async () => {
    const out = freshDir();
    put(out, scan, (s) => {
      s.attempts = 2;
      s.retried = [{ attempt: 1, kind: "crash", step: null, message: "device lost", detail: {} }];
    });
    const { io, logs } = mkIo(out);
    expect((await drive(args({ dryRun: true }), io)).code).toBe(4);
    expect(logs.join("\n")).not.toMatch(/STAGE STOPPED/);
  });

  it("a stray .tmp- copy of a finished job is not read: no duplicate, no stop", async () => {
    const out = freshDir();
    put(out, scan);
    fs.cpSync(path.join(out, "a"), path.join(out, ".tmp-a-1234-0"), { recursive: true });
    const res = diskIo(out, ROOT).evaluate();
    expect(res.jobs).toHaveLength(1);
    expect(res.problems.list.filter((p) => p.code === 2 || p.code === 3)).toEqual([]);
    expect(diskIo(out, ROOT).rawSummaries().map((x) => x.dir)).toEqual(["a"]);
  });
});

describe("the Gate-0 loop: the rungs in the order S0, S1, S2, V, and every rung only with --plan-all (decision O-8; Codex finding 4, conformance F7)", () => {
  it("with S0 done and GO, the default plans nothing and says why; --plan-all plans S1 and V as well", async () => {
    const out = freshDir();
    expect((await drive(args({ rungs: ["S0"] }), mkIo(out).io)).code).toBe(0);
    expect(diskIo(out, ROOT).evaluate().overall).toEqual({ status: "go", used: "S0" });
    const economy = mkIo(out);
    const e = await drive(args({ dryRun: true }), economy.io);
    expect(e.code).toBe(0);
    expect(economy.logs.join("\n")).toContain("S1: not planned, S0 already gives GO");
    expect(economy.logs.join("\n")).toContain("V: not planned, S0 already gives GO");
    expect(economy.logs.some((l) => l.includes("would run"))).toBe(false);
    const every = mkIo(out);
    const r = await drive(args({ dryRun: true, planAll: true }), every.io);
    expect(r.code).toBe(4);
    expect(every.logs.find((l) => l.startsWith("wave:"))).toContain("S1 g0.scan x12");
  }, 120_000);

  it("S1 and V wait for S0's verdict: with S0 part way, a wave has S0's jobs only, even when S1 is named", async () => {
    const out = freshDir();
    await drive(args({ rungs: ["S0"], maxJobs: 12 }), mkIo(out).io); // S0's twelve scans
    const some = mkIo(out);
    await drive(args({ dryRun: true }), some.io);
    const wave = some.logs.find((l) => l.startsWith("wave:"))!;
    expect(wave).toContain("S0 g0.meter x24");
    expect(wave).not.toContain("S1");
    expect(wave).not.toContain("V ");
    // a process given S1 alone works on S1 (side by side with S0 on another machine, D2): its own first rung
    const other = mkIo(out);
    await drive(args({ dryRun: true, rungs: ["S1"] }), other.io);
    expect(other.logs.find((l) => l.startsWith("wave:"))).toContain("wave: 12 jobs listed (S1 g0.scan x12)");
  }, 120_000);
});

describe("the Gate-0 loop: a stopped stage", () => {
  it("a conservation failure stops the stage at once, and the next call refuses to run anything until the job is dealt with", async () => {
    const out = freshDir();
    const stop = (d: JobDef) => d.rung === "S0" && d.stage === "g0.table" && d.spread === 12 && d.rate === 16 && d.seed === 402;
    const first = mkIo(out, { ...HAPPY, stopAt: stop });
    const r = await drive(args({ rungs: ["S0"] }), first.io);
    expect(r.code).toBe(3);
    expect(first.logs.some((l) => l.startsWith("STAGE STOPPED"))).toBe(true);
    expect(first.ran.at(-1)!.id).toBe("g0-table-S0-sp12-r16-s402");
    const marker = JSON.parse(fs.readFileSync(path.join(out, "g0-table-S0-sp12-r16-s402", "summary.json"), "utf8")) as Record<string, unknown>;
    expect(marker).toMatchObject({ missing: true, matterOk: false });
    expect(stageStops(diskIo(out, ROOT).rawSummaries())).toHaveLength(1);
    const second = mkIo(out);
    const r2 = await drive(args({ rungs: ["S0"] }), second.io);
    expect(r2.code).toBe(3);
    expect(second.ran).toEqual([]);
    expect(second.logs[0]).toContain("STAGE STOPPED");
    expect(jobExists(out, "g0-table-S0-sp12-r16-s402")).toBe(true);
  }, 180_000);

  it("stageStops reads a nonzero residual, a matter change and a non-crash failure from the summaries, and not a plain MISSING crash", () => {
    const sums = [
      { dir: "a", s: { matterOk: true, residual: "0" } },
      { dir: "b", s: { matterOk: false, residual: "0" } },
      { dir: "c", s: { matterOk: true, residual: "7" } },
      { dir: "d", s: { missing: true, failures: [{ kind: "crash" }, { kind: "crash" }] } },
      { dir: "e", s: { missing: true, failures: [{ kind: "crash" }, { kind: "invariant" }] } },
      { dir: "f", s: { missing: true, matterOk: false, residual: "1", failures: [{ kind: "conservation" }] } },
      { dir: "g", s: { matterOk: true, residual: "0", attempts: 2, retried: [{ kind: "conservation" }] } },
      { dir: "h", s: { matterOk: true, residual: "0", attempts: 2, retried: [{ kind: "crash" }] } },
    ];
    expect(stageStops(sums).map((x) => x.split(":")[0])).toEqual(["b", "c", "e", "f", "g"]);
    expect(() => {
      throw new StageStop("x", []);
    }).toThrow(StageStop);
  });
});
