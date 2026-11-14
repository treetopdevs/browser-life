// Tests added with the fixes to the three reviews of Part A (the conformance review, the Codex review and the spike check). Every test
// names the finding it covers, so `vitest run --reporter=verbose` is the finding-to-test map. Nothing here is a result: every number is
// made up to land in a given row of a rule table.

import { describe, expect, it } from "vitest";
import { controlInfo, evaluateGate0 } from "../3d-rps/readout-gate0.ts";
import { Problems, analyzeRun, jobBugs, medianLower, medianMean, normalizeSummary, type Job } from "../3d-rps/readout-jobs.ts";
import { loadJobs, memIo, run } from "../3d-rps/readout.ts";
import { CARPETS_5, DLAB_5, G_5, filesOf, mkJob, rungJobs, type ClassSpec, type RowSpec } from "./rps-fixtures.ts";

const LOST = [1, 1, 0, 0, 0, 0, 0, 0]; // two of the three founding labels: coexist is false
const OK_ROW: RowSpec = { liv: 0.9, turnover: 0.1, ndom: 50, nanti: 50 };
const seq = (rows: RowSpec[]): ClassSpec => ({ custom: (k) => rows[k], nRun: rows.length });
const job = (cls: ClassSpec, o: Partial<Parameters<typeof mkJob>[0]> = {}) => mkJob({ stage: "g0.table", seed: 401, spread: 16, rate: 32, cls, ...o });

describe("0 chi_all stops before a sustained loss whatever the run class (Codex finding 6)", () => {
  it("an EXT census that completes three censuses without coexist: the class is EXT, and chi_all leaves the three out", () => {
    const rows = seq([OK_ROW, OK_ROW, OK_ROW, OK_ROW, { liv: 0.9, shares: LOST, ndom: 200, nanti: 0 }, { liv: 0.9, shares: LOST, ndom: 200, nanti: 0 }, { liv: 0.001, shares: LOST, ndom: 200, nanti: 0 }]);
    const a = analyzeRun(job(rows), {});
    expect(a.cls).toBe("EXT");
    expect(a.tcx).toBe(7000);
    // the first four censuses only: (200 - 200) / 400; with all seven it would be (800 - 200) / 1000 = 0.6, a false n_sig
    expect(a.chiAll).toBe(0);
  });
  it("an EXT census with only two censuses without coexist is no sustained loss: chi_all keeps every census", () => {
    const rows = seq([OK_ROW, OK_ROW, OK_ROW, OK_ROW, { liv: 0.9, shares: LOST, ndom: 200, nanti: 0 }, { liv: 0.001, shares: LOST, ndom: 200, nanti: 0 }]);
    const a = analyzeRun(job(rows), {});
    expect(a.cls).toBe("EXT");
    expect(a.chiAll).toBeCloseTo((400 + 200 - 200) / (400 + 200 + 200), 12); // dom 600, anti 200
  });
  it("an EXT census at which every label is still present counts in chi_all (no loss at all)", () => {
    const rows = seq([OK_ROW, OK_ROW, OK_ROW, OK_ROW, OK_ROW, { liv: 0.001, ndom: 500, nanti: 0 }]);
    const a = analyzeRun(job(rows), {});
    expect(a.cls).toBe("EXT");
    expect(a.chiAll).toBeCloseTo((750 - 250) / (750 + 250), 12);
  });
  it("a LOSS job is cut as before", () => {
    const rows = seq([OK_ROW, OK_ROW, OK_ROW, { liv: 0.9, shares: LOST, ndom: 400, nanti: 0 }, { liv: 0.9, shares: LOST, ndom: 400, nanti: 0 }, { liv: 0.9, shares: LOST, ndom: 400, nanti: 0 }]);
    const a = analyzeRun(job(rows), {});
    expect(a.cls).toBe("LOSS");
    expect(a.tcx).toBe(4000);
    expect(a.chiAll).toBe(0); // the first three censuses only: 150 against 150, 300 changes (above the floor of 200), symmetric
  });
});

describe("0 the census schedule is checked, not only that the steps increase (Codex finding 7)", () => {
  it("a missing step-6,000 burn-in row can no longer turn a NOSTART job into a started one", () => {
    const j = job({ NOSTART: "liv" });
    expect(analyzeRun(j, {}).cls).toBe("NOSTART");
    j.rows!.splice(5, 1);
    expect(() => analyzeRun(j, {})).toThrow(/census at step 7000 where the schedule has step 6000/);
  });
  it("a gap among the run censuses is unusable input", () => {
    const j = job("DC", { nRun: 30 });
    j.rows!.splice(10, 1);
    expect(() => analyzeRun(j, {})).toThrow(/census at step 12000 where the schedule has step 11000/);
  });
  it("a file that does not start at step 1,000 is unusable input", () => {
    const j = job("DC");
    j.rows!.splice(0, 1);
    expect(() => analyzeRun(j, {})).toThrow(/census at step 2000 where the schedule has step 1000/);
  });
  it("fewer than six burn-in censuses is unusable input", () => {
    const j = job("DC");
    j.rows = j.rows!.slice(0, 5);
    expect(() => analyzeRun(j, {})).toThrow(/5 burn-in censuses, the schedule gives 6/);
  });
  it("the complete schedule is accepted, short or long", () => {
    expect(analyzeRun(job("DC", { nRun: 20 }), {}).nRun).toBe(20);
    expect(analyzeRun(job("DC", { nRun: 200 }), {}).nRun).toBe(200);
    expect(analyzeRun(job({ LOSS: 5 }), {}).cls).toBe("LOSS");
  });
});

describe("the loader skips hidden directories: a .tmp- copy is not a job (Codex finding 2, conformance F8, spike check A5)", () => {
  const j = job("DC");
  const files = filesOf([j], "/jobs");
  const stray = Object.fromEntries(Object.entries(files).map(([p, t]) => [p.replace(`/jobs/${j.s.id}/`, `/jobs/.tmp-${j.s.id}-1234-0/`), t]));
  it("a populated .tmp- directory beside the published job is ignored", () => {
    const pr = new Problems();
    expect(loadJobs(memIo("/repo", { ...files, ...stray }), "/jobs", pr)).toHaveLength(1);
    expect(pr.list).toEqual([]);
  });
  it("alone it is no job at all: nothing to read", () => {
    const pr = new Problems();
    expect(loadJobs(memIo("/repo", stray), "/jobs", pr)).toHaveLength(0);
    expect(pr.code).toBe(2);
  });
  it("only the path below the job directory counts: a job directory under a dot directory loads", () => {
    const dir = "/home/me/.claude/worktrees/x/jobs";
    const pr = new Problems();
    expect(loadJobs(memIo("/repo", filesOf([j], dir)), dir, pr)).toHaveLength(1);
    expect(pr.list).toEqual([]);
  });
  it("through the command: a stray copy of a published job leaves the exit code where it was", () => {
    const scan = mkJob({ stage: "g0.scan", rung: "S0", kill: "removal", seed: 401, spread: 4, rate: 0, cls: "CHURN" });
    const base = { "/repo/runs/rps/rule-draft.md": "draft", ...filesOf([scan], "/jobs") };
    const copy = Object.fromEntries(Object.entries(filesOf([scan], "/jobs")).map(([p, t]) => [p.replace(`/jobs/${scan.s.id}/`, `/jobs/.tmp-${scan.s.id}-9-0/`), t]));
    const alone = run(["gate0", "--jobs", "/jobs", "--draft"], memIo("/repo", base));
    const withStray = run(["gate0", "--jobs", "/jobs", "--draft"], memIo("/repo", { ...base, ...copy }));
    expect(alone.code).toBe(4);
    expect(withStray.code).toBe(4);
    expect(withStray.problems.map((p) => p.message)).toEqual(alone.problems.map((p) => p.message));
  });
});

describe("1.3/8.4 a conservation failure of an earlier attempt leaves a trace and is a bug indicator (Codex finding 1, conformance F12)", () => {
  const fail = (kind: string, attempt = 1) => ({ attempt, kind, step: 8000, message: kind === "crash" ? "scripted crash" : "matter 100 at step 8000, 99 at the start", detail: {} });
  const bugs = (jobs: Job[]) => {
    const pr = new Problems();
    jobBugs(jobs, (j) => analyzeRun(j, {}), pr);
    return pr;
  };
  it("normalizeSummary reads `retried` (a job that passed on the rerun) and `failures` (a MISSING marker)", () => {
    const a = job("DC", { extra: { retried: [fail("conservation")] } });
    expect(a.s.attemptFailures).toEqual([{ attempt: 1, kind: "conservation", step: 8000, message: "matter 100 at step 8000, 99 at the start" }]);
    const b = normalizeSummary({ stage: "sweep", seed: 1, missing: true, failures: [fail("invariant", 1), fail("crash", 2)] }, "x");
    expect(b.attemptFailures.map((f) => f.kind)).toEqual(["invariant", "crash"]);
    expect(job("DC").s.attemptFailures).toEqual([]);
    expect(normalizeSummary({ stage: "sweep", seed: 1, retried: "nope", failures: [null, 3, { message: "no kind" }] }, "x").attemptFailures).toEqual([]);
  });
  it("a job that passed on the rerun after a conservation failure is exit 3", () => {
    const pr = bugs([job("DC", { extra: { retried: [fail("conservation")], attempts: 2 } })]);
    expect(pr.code).toBe(3);
    expect(pr.list[0].message).toMatch(/attempt 1 failed a conservation check at step 8000 \(matter 100 at step 8000, 99 at the start\): a bug, not a result, whether or not the rerun passed/);
  });
  it("an invariant failure counts the same way; a crash alone does not", () => {
    expect(bugs([job("DC", { extra: { retried: [fail("invariant")] } })]).code).toBe(3);
    expect(bugs([job("DC", { extra: { retried: [fail("crash")] } })]).code).toBe(0);
  });
  it("a MISSING marker with a conservation failure behind it is exit 3 as well (the residual checks skip MISSING jobs)", () => {
    const m = job("DC", { extra: { missing: true, failures: [fail("conservation", 1), fail("conservation", 2)] } });
    const pr = bugs([m]);
    expect(pr.code).toBe(3);
    expect(pr.list).toHaveLength(2);
  });
  it("the Gate-0 evaluation reports it too (jobs and meter jobs)", () => {
    const jobs = rungJobs({ rung: "S0", carpets: CARPETS_5, dlab: DLAB_5, g: G_5, table: null, horizon: null, confirm: null });
    expect(evaluateGate0(jobs).problems.list.some((p) => p.code === 3)).toBe(false);
    const k = jobs.findIndex((x) => x.s.stage === "g0.scan");
    jobs[k].s.attemptFailures = [{ attempt: 1, kind: "conservation", step: 8000, message: "x" }];
    expect(evaluateGate0(jobs).problems.list.some((p) => p.code === 3 && /conservation check/.test(p.message))).toBe(true);
    const m = rungJobs({ rung: "S0", carpets: CARPETS_5, dlab: DLAB_5, g: G_5, table: null, horizon: null, confirm: null });
    const km = m.findIndex((x) => x.s.stage === "g0.meter");
    m[km].s.attemptFailures = [{ attempt: 1, kind: "invariant", step: 5000, message: "meter" }];
    expect(evaluateGate0(m).problems.list.some((p) => p.code === 3 && /invariant check/.test(p.message))).toBe(true);
  });
});

describe("the median of an even count, ratified (decision O-3; Codex finding 8): the mean of the two middle values, the lower middle for Tmed, v_mid, v_cal and T_ctl", () => {
  // T_ctl of G0.4 is "the median run step of the first sustained loss"; the rule (section 0, Median, and G0.4) takes the lower of the two
  // middle values, a control that keeps every label counting as infinite: [50,000, Infinity] gives 50,000, not Infinity, and h0 is none.
  it("G0.4 two usable horizon controls, one lost at 50,000 and one that kept every label: T_ctl is 50,000 and h0 is none", () => {
    const mk = (classes: ClassSpec[]) => evaluateGate0(rungJobs({ rung: "S0", carpets: CARPETS_5, dlab: DLAB_5, g: G_5, confirm: null, horizon: classes })).rungs[0];
    const e = mk([{ LOSS: 50 }, "CHURN", "NOSTART"]);
    expect(e.horizon!.tctl).toEqual([50_000, Infinity, null]);
    expect(e.horizon!.Tctl).toBe(50_000);
    expect(e.horizon!.h0).toBeNull();
    expect(e.verdict).toBe("NO-GO: HORIZON");
    // three usable controls: the median is the middle one under any convention
    expect(mk([{ LOSS: 50 }, "CHURN", { LOSS: 200 }]).horizon!.Tctl).toBe(200_000);
  });
  it("the helpers: lower middle against mean of the two middle values", () => {
    expect(medianLower([50_000, Infinity])).toBe(50_000);
    expect(medianMean([50_000, Infinity])).toBe(Infinity);
  });
  // 4.2/G0.3: "the median of the |chi_fw| of all the finished control jobs is at most 0.1": the general convention, the mean of the two
  // middle values for an even count.
  it("4.2 two finished controls with |chi_fw| 0.01 and 0.2: the mean of the two middle values is 0.105, so the spread is not informative", () => {
    const control = (d: number, a: number) => analyzeRun(job({ custom: () => ({ liv: 0.9, turnover: 0.3, ndom: d, nanti: a }), nRun: 20 }, { rate: 0 }), {});
    const low = control(101, 99); // chi 0.01
    const high = control(120, 80); // chi 0.2
    expect(low.chiFw).toBeCloseTo(0.01, 12);
    expect(high.chiFw).toBeCloseTo(0.2, 12);
    const info = controlInfo([low, high]);
    expect(info.medAbsChi).toBeCloseTo(0.105, 12);
    expect(info.informative).toBe(false);
  });
});
