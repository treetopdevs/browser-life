// Tests of the regime reader (experiments/3d-slab/regime-readout.ts) and the companion page builder (regime-html.ts), plan section 8.5 and 8.6.
// The decisions themselves are tested in packages/metrics/test/regime3.test.ts; here every outcome string of R13 and every gate and Stage 0
// cause is produced from synthetic job files (the shape the runner writes) and read back through the reader: the files are loaded, joined,
// summarized by the M0 functions, decided, worded and written. Nothing here reads runs/ or any frozen rule of the repo; the file tests build
// a temporary tree.
import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { B0_ID, REGIME, sweepSettings } from "@bl/metrics";
import type { Combination, Decider, DiffLog, TwinBank } from "@bl/metrics";
import {
  ReaderError, bundleJobs, constantScreenLines, evaluateDev, evaluateGateJobs, evaluateSweepJobs, extractDevLog, fmt, loadRule, main, parseArgs, parseCombination, parseHashFile,
  pathsFor, selectedCombination, sha256Hex, stage0Text, thresholdTriggerLine, JOB_COLUMNS, SETTING_COLUMNS,
} from "../3d-slab/regime-readout.ts";
import type { ConstantScreen, GateFile, JobBundle, JobFile, ResultsJson, RuleInfo, SweepOptions, SweepResult } from "../3d-slab/regime-readout.ts";
import { assertRoster, checkBundleRoster, checkGateFile, checkSweepRoster, footerLine } from "../3d-slab/regime-readout.ts";
import {
  allSaturated, buildPage, foldJobIds, htmlMain, jsonForScript, pageLabel, synthBank, syntheticDevJobs, syntheticGateJobs, syntheticResults, syntheticRule, synthJob,
} from "../3d-slab/regime-html.ts";
import type { SynthGateOpts, SynthJobOpts, SynthRegime } from "../3d-slab/regime-html.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures

const P1NET: Combination = { rung: "P1", decider: "net" };
const RULE: RuleInfo = syntheticRule();
const asFiles = (jobs: JobFile[]) => jobs.map((job) => ({ file: `${job.id}.json`, job }));
/** The tests read the synthetic jobs with 20 bootstrap resamples instead of 1,000 (the classes are the same: every resample of these banks reproduces its class; the bootstrap itself is tested in regime3.test.ts); the file tests go through `main` with the real constants. */
const FAST = { ...REGIME, BOOT: 20 };
const bundleMemo = new WeakMap<JobFile, Map<string, JobBundle>>();
/** `bundleJobs` with a memo per job object and deciders: the same synthetic job analysed in two tests is analysed once. */
function bundles(jobs: JobFile[], deciders: Decider[] = ["net"], rule: RuleInfo | null = null): JobBundle[] {
  if (rule) return bundleJobs(asFiles(jobs), deciders, rule, FAST);
  const dk = deciders.join();
  const groups = new Map<string, JobFile[]>();
  for (const j of jobs) {
    const k = `${j.kind}|${j.world}|${j.seed}|${j.T}|${j.dev ? "dev" : "main"}`;
    groups.set(k, [...(groups.get(k) ?? []), j]);
  }
  const out: JobBundle[] = [];
  for (const [, g] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (g.length > 1) { out.push(...bundleJobs(asFiles(g), deciders, null, FAST)); continue; }
    const cache = bundleMemo.get(g[0]) ?? new Map<string, JobBundle>();
    bundleMemo.set(g[0], cache);
    let b = cache.get(dk);
    if (!b) { b = bundleJobs(asFiles(g), deciders, null, FAST)[0]; cache.set(dk, b); }
    out.push(b);
  }
  return out;
}
/** The bundles of a passing base with the ones of the jobs a tweak re-built put in their place. */
const withFresh = (base: JobBundle[], fresh: JobFile[]): JobBundle[] => {
  const f = bundles(fresh, ["net", "occ"]);
  const keys = new Set(f.map((b) => b.key));
  return [...base.filter((b) => !keys.has(b.key)), ...f];
};

/** A regime for a class label (every job of it is dust-clear unless said otherwise). */
const REG: Record<string, SynthRegime> = {
  ORDERED: { z: -1.6, ratioU: 0.1 }, CRITICAL: { z: 0, ratioU: 0.1 }, CHAOTIC: { z: 1.6, ratioU: 0.1 }, MIXED: { z: 0.9, ratioU: 0.1 },
  DUSTY: { z: 0, ratioU: 0.6 }, AMBIG: { z: 0, ratioU: 0.35 },
};
type Spec = string | Partial<SynthJobOpts>;
const SEEDS = [101, 102, 103, 104, 105, 106];
/** The jobs of one setting at seeds 101, 102, ...: a class name is a metered job of that class; EXTINCT, NO_TARGET, CARPET, RELIC, DRIFT and ONECOL:<class> are what they say. */
const jobMemo = new Map<string, JobFile[]>();
function jobsOf(world: string, specs: Spec[], T = REGIME.T0, salt = 0): JobFile[] {
  const memoKey = JSON.stringify([world, specs, T, salt]);
  const hit = jobMemo.get(memoKey);
  if (hit) return hit;
  const built = buildJobs(world, specs, T, salt);
  jobMemo.set(memoKey, built);
  return built;
}
function buildJobs(world: string, specs: Spec[], T: number, salt: number): JobFile[] {
  return specs.flatMap((sp, i) => {
    const base: SynthJobOpts = { world, seed: SEEDS[i], T, decider: "net" };
    const bank = (cls: string, extra: Partial<Parameters<typeof synthBank>[0]> = {}) => ({ P1: { net: REG[cls], salt: salt + i * 7 + 1, ...extra } });
    if (typeof sp !== "string") return synthJob({ ...base, ...sp });
    if (sp === "EXTINCT") return synthJob({ ...base, status: "extinct" });
    if (sp === "NO_TARGET") return synthJob({ ...base, status: "notarget", f: 0.2 });
    if (sp === "CARPET") return synthJob({ ...base, f: 0.95, banks: bank("CHAOTIC", { nCol: 1 }) });
    if (sp === "RELIC") return synthJob({ ...base, f: 0.004, banks: bank("CRITICAL") });
    if (sp === "DRIFT") return synthJob({ ...base, f: 0.3, fEnd: 0.9, banks: bank("CRITICAL") });
    if (sp.startsWith("ONECOL:")) return synthJob({ ...base, f: 0.3, banks: bank(sp.slice(7), { nCol: 1 }) });
    return synthJob({ ...base, f: 0.3, banks: bank(sp) });
  });
}
const sweep = (table: Record<string, Spec[]>, T = REGIME.T0): JobFile[] => Object.entries(table).flatMap(([w, specs]) => jobsOf(w, specs, T));
const THREE = (c: string): Spec[] => [c, c, c];
const NEIGHBOURS = [
  "mu30-s8-k256-dA100", "mu30-s8-k256-dA240", "mu30-s8-k256-dC100", "mu30-s8-k256-dC240", "mu30-s8-k256-dS75", "mu30-s8-k256-dS240", "mu30-s8-k256-dtQ26",
  "mu30-s8-k256-dtQ102", "mu30-s8-k256-sp4", "mu30-s8-k256-sp16", "mu30-s8-k256-gK16", "mu30-s8-k256-gK256",
];
/** B0 and its neighbours with the classes given in order (B0 first); extra settings can be added. */
const ring = (classes: string[], extra: Record<string, Spec[]> = {}): Record<string, Spec[]> => ({
  [B0_ID]: THREE(classes[0]), ...Object.fromEntries(NEIGHBOURS.slice(0, classes.length - 1).map((id, i) => [id, THREE(classes[i + 1])])), ...extra,
});

const GATE_BASE = bundles(syntheticGateJobs(), ["net", "occ"]);
const DEV_BASE = bundles(syntheticDevJobs(), ["net", "occ"]);
const PASS_GATE: GateFile = evaluateGateJobs(GATE_BASE, RULE, P1NET, "SYNTHETIC").gate;
const gateWith = (o: Partial<GateFile> = {}): GateFile => ({ ...PASS_GATE, ...o });

/**
 * The decisions of R10 to R12 on a partial table (a few settings, not the 96 jobs): `roster: false` skips the check that the T0 jobs are the whole
 * catalogue. The roster checks themselves are tested below with the default (on), which is what the CLI always uses.
 */
function read(jobs: JobFile[], gate: GateFile = PASS_GATE, combo: Combination = P1NET, extra: Partial<SweepOptions> = {}): SweepResult {
  return evaluateSweepJobs(bundles(jobs, [combo.decider]), RULE, gate, combo, { label: "SYNTHETIC", screen: null, capturesDir: null, sensitivity: false, roster: false, ...extra });
}
const late = (ids: string[], c: string): JobFile[] => sweep(Object.fromEntries(ids.map((id) => [id, THREE(c)])), REGIME.T1);

// ---------------------------------------------------------------------------------------------------------------------
describe("the fixtures themselves", () => {
  it("a synthetic class label reads as that class, dust clear, and votes", () => {
    const r = read(sweep({ [B0_ID]: ["ORDERED", "CRITICAL", "CHAOTIC"] }));
    const jobs = r.results.settings.find((s) => s.id === B0_ID)!.jobs;
    expect(jobs.map((j) => j.jobClass)).toEqual(["ORDERED", "CRITICAL", "CHAOTIC"]);
    expect(jobs.every((j) => j.dust === "CLEAR" && j.vote)).toBe(true);
  });
  it("the passing gate passes with refClass CRITICAL and the label AMP-ROBUST", () => {
    expect(PASS_GATE.pass).toBe(true);
    expect([PASS_GATE.refClass, PASS_GATE.amp]).toEqual(["CRITICAL", "AMP-ROBUST"]);
    expect(PASS_GATE.conditions.map((c) => c.id)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]);
    expect(Object.keys(PASS_GATE.m4Manifest).length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
const first = (r: SweepResult) => r.text;
/** Eight class-bearing settings (the third job of each is dust-ambiguous) and `k` dusty ones: 8 + 3k of 24 + 3k valid jobs are not DUST_CLEAR. */
const dustyTable = (k: number, cls = ["CHAOTIC", "CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED", "CHAOTIC"]) => {
  const amb = (c: string): Spec => ({ f: 0.3, banks: { P1: { net: { ...REG[c], ratioU: 0.35 }, salt: 99 } } });
  const t = ring(cls);
  for (const [i, id] of Object.keys(t).entries()) t[id] = [cls[i], cls[i], amb(cls[i])];
  return { ...t, ...Object.fromEntries(NEIGHBOURS.slice(8, 8 + k).map((id) => [id, THREE("DUSTY")])) };
};
describe("R10 outcomes through the reader (every R13 string)", () => {
  it("INVALID-RUN: a job that failed a check names the job and the check, and the exit is 1 (R14 row 87)", () => {
    const bad: Spec = { f: 0.3, banks: { P1: { net: REG.CRITICAL } }, checks: { C2: { ok: false, detail: "ledger residual 5" } } };
    const r = read(sweep({ ...ring(["CRITICAL"]), "mu30-s8-k256-dA100": [bad, "CRITICAL", "CRITICAL"] }));
    expect(r.outcomeId).toBe("INVALID-RUN");
    expect(r.exit).toBe(1);
    expect(first(r)).toBe("INVALID RUN: slab-mu30-s8-k256-dA100-seed101-t20000-P1-net failed C2. No outcome. Fix the cause and rerun those jobs.");
    expect(r.details).toContain("slab-mu30-s8-k256-dA100-seed101-t20000-P1-net: C2 (ledger residual 5)");
    expect(r.results.outcome.fatal).toBe(true);
    expect(r.results.cards).toEqual([]);
  });

  it.each(["ruleSha", "codeCommit", "srcHash"] as const)("INVALID-RUN: jobs that carry mixed %s (R10.1)", (key) => {
    const jobs = sweep(ring(["CRITICAL", "CRITICAL"]));
    jobs[3] = { ...jobs[3], [key]: "another" };
    const r = read(jobs);
    expect(r.outcomeId).toBe("INVALID-RUN");
    expect(r.exit).toBe(1);
    expect(first(r)).toBe(`INVALID RUN: the jobs carry mixed ${key}. No outcome. Fix the cause and rerun those jobs.`);
    expect(r.details.some((d) => d.startsWith(`mixed ${key}: `))).toBe(true);
  });

  it("GATE-FAIL: a failed gate.json is the outcome and no sweep is read (R9.4)", () => {
    const text = "GATE FAIL. Selected combination (P1, net), causes: REF-UNSTABLE. Other combinations, information only: (P1, occ) none; (P2, net) none; (P2, occ) none. CLOSED: candidate 8 ends here.";
    const r = read(sweep(ring(["CRITICAL"])), gateWith({ pass: false, refClass: null, amp: null, text, details: ["Control failure N-NOT-SATURATED in x."], causes: [{ code: "REF-UNSTABLE", where: ["spots-m3"] }], others: [] }));
    expect(r.outcomeId).toBe("GATE-FAIL");
    expect(r.exit).toBe(0);
    expect(first(r)).toBe(text);
    expect(r.details).toEqual(["Control failure N-NOT-SATURATED in x."]);
    expect(r.results.cards).toEqual([]);
  });

  it("NO-CONTRAST: 9 of 10 class-bearing settings read refClass (R14 row 56 side)", () => {
    const r = read(sweep(ring(["CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "ORDERED"])));
    expect(r.outcomeId).toBe("NO-CONTRAST");
    expect(first(r)).toBe("NO CONTRAST: 9 of 10 class-bearing settings read CRITICAL; the meters do not separate these settings from one another. No inference. The settings are listed.");
    expect(r.details[0]).toMatch(/^Settings reading CRITICAL: mu30-s8-k256, /);
  });

  it("PENDING-LATE-CHECK: 8 of 10 do not trip NO-CONTRAST; the first six targets (B0, then fewest axes, then id) are listed with their missing T1 jobs", () => {
    const r = read(sweep(ring(["CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "ORDERED", "ORDERED"])));
    expect(r.outcomeId).toBe("PENDING-LATE-CHECK");
    const targets = [B0_ID, ...NEIGHBOURS.slice(0, 8).sort()].slice(0, 6);
    const missing = targets.flatMap((id) => [101, 102, 103].map((s) => `slab-${id}-seed${s}-t50000-P1-net`));
    expect(first(r)).toBe(`PENDING: run the late check for ${targets.join(", ")} (jobs ${missing.join(", ")}).`);
    expect(r.details[1]).toBe(`Unchecked (cap): ${NEIGHBOURS.slice(0, 8).sort().slice(5).join(", ")}`);
  });

  const targetsAt = ["CRITICAL", "CRITICAL", "CRITICAL", "ORDERED", "CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED", "CHAOTIC"];
  const t0 = () => sweep(ring(targetsAt));
  it("BAND-FOUND (refClass CRITICAL, AMP-ROBUST): the T1 reading agrees for B0; the sentence of R12.6 follows, no ranking", () => {
    const r = read([...t0(), ...late([B0_ID], "CRITICAL"), ...late(["mu30-s8-k256-dA100", "mu30-s8-k256-dA240"], "CHAOTIC")]);
    expect(r.outcomeId).toBe("BAND-FOUND");
    expect(first(r)).toMatch(/^BAND FOUND: critical class at T0 and T1 in mu30-s8-k256 \(at this kick scale; AMP-ROBUST\)\. The project's alive 2D worlds read critical\. No physics change is indicated by these meters: at least one swept setting reads like the project's alive 2D worlds at T0 and T1\. Next: look by eye inside the band \(job ids slab-mu30-s8-k256-seed101-t20000-P1-net, .*t50000.*\)\.$/);
    expect(r.results.outcome.ranking).toBeNull();
    expect(r.details[0]).toContain("transient mu30-s8-k256-dA100, mu30-s8-k256-dA240");
  });
  it("BAND-FOUND (AMP-DEPENDENT): the criticality words become 'in the CRITICAL class at this kick scale' (R12.6)", () => {
    const r = read([...t0(), ...late([B0_ID], "CRITICAL"), ...late(["mu30-s8-k256-dA100", "mu30-s8-k256-dA240"], "CHAOTIC")], gateWith({ amp: "AMP-DEPENDENT" }));
    expect(first(r)).toMatch(/^BAND FOUND: CRITICAL class at T0 and T1 in mu30-s8-k256 \(at this kick scale; AMP-DEPENDENT\)\. The project's alive 2D worlds read in the CRITICAL class at this kick scale\. /);
  });
  it("BAND-FOUND with refClass CHAOTIC: 'alive-like settings found', and it does not test the criticality hypothesis", () => {
    const jobs = sweep(ring(["CHAOTIC", "CHAOTIC", "ORDERED", "ORDERED", "ORDERED", "ORDERED", "ORDERED", "ORDERED", "ORDERED"]));
    const r = read([...jobs, ...late([B0_ID, "mu30-s8-k256-dA100"], "CHAOTIC")], gateWith({ refClass: "CHAOTIC" }));
    expect(r.outcomeId).toBe("BAND-FOUND");
    expect(first(r)).toMatch(/^ALIVE-LIKE SETTINGS FOUND: mu30-s8-k256, mu30-s8-k256-dA100 read chaotic at T0 and T1, like the project's alive 2D worlds\. This does not test the criticality hypothesis\. No physics change is indicated/);
  });

  it("TRANSIENT-BAND: every late-checked setting reads another class at T1; the unchecked ones (cap) are listed", () => {
    const many = ring(["CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "ORDERED", "CHAOTIC", "ORDERED"]);
    const ids = [B0_ID, ...NEIGHBOURS.slice(0, 6).sort()];
    const r = read([...sweep(many), ...late(ids.slice(0, 6), "CHAOTIC")]);
    expect(r.outcomeId).toBe("TRANSIENT-BAND");
    expect(first(r)).toMatch(new RegExp(`^TRANSIENT BAND: ${ids.slice(0, 6).join(", ")} read CRITICAL at T0 but not at T1\\. A stage of the transient, not a standing band\\. Look by eye at the T0 states \\(job ids slab-`));
    expect(r.details[0]).toBe(`Unchecked (cap): ${ids[6]}`);
  });

  it("LATE-INCONCLUSIVE: fewer than 2 valid jobs at T1 after every late job ran (R11)", () => {
    const t1 = [...jobsOf(B0_ID, ["CRITICAL", "DRIFT", "DRIFT"], REGIME.T1), ...late(["mu30-s8-k256-dA100", "mu30-s8-k256-dA240"], "CHAOTIC")];
    const r = read([...t0(), ...t1]);
    expect(r.outcomeId).toBe("LATE-INCONCLUSIVE");
    expect(first(r)).toBe("LATE INCONCLUSIVE: mu30-s8-k256 read CRITICAL at T0 and their T1 evidence was insufficient (fewer than 2 valid jobs after all late jobs ran). No inference. Transient: mu30-s8-k256-dA100, mu30-s8-k256-dA240. Unchecked (cap): none.");
  });

  it("EMPTY-WINDOW: no setting has 2 valid in-window jobs", () => {
    const r = read(sweep({ [B0_ID]: ["CRITICAL", "EXTINCT", "EXTINCT"] }));
    expect(r.outcomeId).toBe("EMPTY-WINDOW");
    expect(first(r)).toBe("EMPTY WINDOW: no setting had 2 valid in-window jobs. Re-centre the sweep on the livable region before drawing anything.");
  });

  it("TOO-MANY-UNMETERABLE: 16 of 31 settings are unmeterable, 15 are not (R14 row 54)", () => {
    const ids = sweepSettings().filter((s) => !s.control && s.id !== B0_ID).map((s) => s.id);
    const dead = (n: number) => Object.fromEntries(ids.slice(0, n).map((id) => [id, THREE("EXTINCT")]));
    const r16 = read(sweep({ [B0_ID]: THREE("CHAOTIC"), ...dead(16) }));
    expect(r16.outcomeId).toBe("TOO-MANY-UNMETERABLE");
    expect(first(r16)).toBe("TOO MANY UNMETERABLE: 16 of 31 settings were extinct or had no target in 2 of 3 seeds. No inference. The livable settings are listed.");
    const r15 = read(sweep({ [B0_ID]: THREE("CHAOTIC"), ...dead(15) }));
    expect(r15.outcomeId).not.toBe("TOO-MANY-UNMETERABLE");
  });

  const eight = ["mu30-s8-k256", "mu30-s12-k256", "mu30-s16-k256", "mu30-s20-k256", "mu40-s8-k256", "mu40-s12-k256", "mu40-s16-k256", "mu40-s20-k256"];
  it("THIN-POOL: 8 class-bearing settings that span only 2 axes, and 7 that span 3 (R14 row 55)", () => {
    const r = read(sweep(Object.fromEntries(eight.map((id, i) => [id, THREE(i % 2 ? "ORDERED" : "CHAOTIC")]))));
    expect(r.outcomeId).toBe("THIN-POOL");
    expect(first(r)).toBe("THIN POOL: 8 class-bearing settings spanning 2 swept axes (the rule needs 8 and 3). No inference.");
    const seven = read(sweep(ring(["CHAOTIC", "CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED"])));
    expect(first(seven)).toBe("THIN POOL: 7 class-bearing settings spanning 3 swept axes (the rule needs 8 and 3). No inference.");
  });

  it("SENSITIVE-EVERYWHERE: more than half of the pool's valid jobs that have a U twin are dust-ambiguous or limited, 50 percent is not (R14 row 57)", () => {
    const r = read(sweep(dustyTable(3)));
    expect(r.outcomeId).toBe("SENSITIVE-EVERYWHERE");
    expect(first(r)).toBe("SENSITIVE EVERYWHERE: 17 of 33 valid jobs were not DUST_CLEAR (observed dose insensitivity at step 30). No band can be read or excluded here. The would-be classes are listed.");
    expect(r.details[0]).toContain("mu30-s8-k256-gK16: DUSTY, would-be CRITICAL");
    expect(read(sweep(dustyTable(2))).outcomeId).not.toBe("SENSITIVE-EVERYWHERE");
  });

  it("UNDER-SUPPORTED: more than half of the pool's valid jobs lack a trajectory meter (R14 row 58)", () => {
    const cls = ["CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED"];
    const t = ring(cls);
    for (const id of Object.keys(t)) t[id] = THREE("ONECOL:" + cls[Object.keys(t).indexOf(id)]);
    const r = read(sweep(t));
    expect(r.outcomeId).toBe("UNDER-SUPPORTED");
    expect(first(r)).toBe("UNDER-SUPPORTED: 24 of 24 valid jobs were D_ONLY (too few sites or colonies, or overlapping damage), so the trajectory meter could not certify a band. No inference.");
  });

  const splitRing = (nSplit: number) => {
    const cls = ["CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED"];
    const split = sweepSettings().filter((s) => !s.control && !s.id.startsWith("mu30-s8-k256")).slice(0, nSplit).map((s) => s.id);
    return { cls, split };
  };
  it("UNRESOLVED: more than half of the pool splits across seeds; the extension jobs are named (R8.5)", () => {
    const { cls, split } = splitRing(9);
    const r = read(sweep({ ...ring(cls), ...Object.fromEntries(split.map((id) => [id, ["ORDERED", "CRITICAL", "CHAOTIC"]])) }));
    expect(r.outcomeId).toBe("UNRESOLVED");
    expect(first(r)).toBe("UNRESOLVED: 9 of 17 settings split across seeds. The meters are too noisy at these settings. No inference.");
    expect(r.details[1]).toMatch(/^Next \(R8\.5\): run the extension once, seeds 104 to 106 at T0 under \(P1, net\), jobs slab-/);
    expect(r.results.outcome.jobIds.length).toBe(27);
  });
  it("UNRESOLVED-FINAL: the same after the seed extension (R10 5.6)", () => {
    const { cls, split } = splitRing(9);
    const base = sweep({ ...ring(cls), ...Object.fromEntries(split.map((id) => [id, ["ORDERED", "CRITICAL", "CHAOTIC"]])) });
    const extJobs = split.flatMap((id) => [104, 105, 106].flatMap((seed, i) => synthJob({ world: id, seed, decider: "net", f: 0.3, banks: { P1: { net: REG[["ORDERED", "CRITICAL", "CHAOTIC"][i]], salt: seed } } })));
    const r = read([...base, ...extJobs]);
    expect(r.outcomeId).toBe("UNRESOLVED-FINAL");
    expect(first(r)).toBe("UNRESOLVED-FINAL: 9 of 17 settings split across seeds after the seed extension. The meters are too noisy at these settings. No inference.");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("R10 5.7 and 5.8 and R12 through the reader: brackets, NO-BAND, the axis ranking", () => {
  const zJob = (z: number, salt = 0, extra: Partial<SynthJobOpts> = {}): Spec => ({ f: 0.3, banks: { P1: { net: { z, ratioU: 0.1 }, salt } }, ...extra });
  const zs = (z: number | number[]): Spec[] => (Array.isArray(z) ? z : [z, z, z]).map((v, i) => zJob(v, i));
  /** B0 and its neighbours with the latent z of each (all three seeds alike unless an array is given). */
  const ringZ = (zlist: (number | number[])[], extra: Record<string, Spec[]> = {}): Record<string, Spec[]> => ({
    [B0_ID]: zs(zlist[0]), ...Object.fromEntries(NEIGHBOURS.slice(0, zlist.length - 1).map((id, i) => [id, zs(zlist[i + 1])])), ...extra,
  });
  const axisRow = (r: SweepResult, axis: string) => r.results.outcome.ranking!.rows.find((x) => x.axis === axis)!;

  it("CROSSING-BRACKETED: adjacent settings along one axis read ORDERED and CHAOTIC (refClass CRITICAL), and the ranking follows", () => {
    const r = read(sweep(dustyTable(0)));
    expect(r.outcomeId).toBe("CROSSING-BRACKETED");
    expect(first(r)).toBe("CROSSING BRACKETED between mu30-s8-k256 (CHAOTIC) and mu30-s8-k256-dA240 (ORDERED) along diffA. The critical manifold lies between the two bracketed settings; refine along that axis before any physics change.");
    expect(r.details[0]).toBe("Also bracketed: mu30-s8-k256 (CHAOTIC) and mu30-s8-k256-dC240 (ORDERED) along diffC.");
    expect(r.details.some((d) => d.startsWith("Axis ranking:") || d.startsWith("NO-AXIS:"))).toBe(true);
    expect(r.results.outcome.brackets.length).toBe(3);
  });
  it("CROSSING-BRACKETED with AMP-DEPENDENT does not say 'critical manifold' (R12.6, resolution W12)", () => {
    const r = read(sweep(dustyTable(0)), gateWith({ amp: "AMP-DEPENDENT" }));
    expect(first(r)).toContain("The boundary of the CRITICAL class at this kick scale lies between the two bracketed settings");
  });
  it("an INERT gateK setting forms no bracket and is no ranking candidate (R12.3; R14 row 72)", () => {
    const digest = (seed: number) => sha256Hex(`${B0_ID}|${seed}|digest`).slice(0, 16);
    const inert = (z: number): Spec[] => [101, 102, 103].map((seed, i) => zJob(z, i, { extras: { stateDigestT: digest(seed) } }));
    const t = ringZ([2.4, 2.2, 2.2, 2.2, 2.2, 2.2, 2.2, 2.2], { "mu30-s8-k256-gK16": zs(2.2), "mu30-s8-k256-gK256": inert(1.3), "mu30-s8-k256-gK1024": zs(2.2) });
    const r = read(sweep(t));
    const s = (id: string) => r.results.settings.find((x) => x.id === id)!;
    expect(s("mu30-s8-k256-gK256").inert).toBe(true);
    expect(s("mu30-s8-k256-gK16").inert).toBe(false);
    expect(r.outcomeId).toBe("NO-BAND");
    expect(axisRow(r, "gateK").candidates).not.toContain("mu30-s8-k256-gK256");
    expect(axisRow(r, "gateK").best).toBe("mu30-s8-k256-gK16");
    // one seed whose digest differs: not inert
    const notInert = [zJob(1.3, 0, { extras: { stateDigestT: digest(101) } }), zJob(1.3, 1, { extras: { stateDigestT: digest(102) } }), zJob(1.3, 2, { extras: { stateDigestT: "0000000000000000" } })];
    const r2 = read(sweep({ ...t, "mu30-s8-k256-gK256": notInert }));
    expect(r2.results.settings.find((x) => x.id === "mu30-s8-k256-gK256")!.inert).toBe(false);
    expect(axisRow(r2, "gateK").best).toBe("mu30-s8-k256-gK256");
  });

  it("NO-BAND (all-chaotic) with a ranked axis: dtQ lowered is named first, with its Delta (R12.2 to R12.5)", () => {
    const r = read(sweep(ringZ([2.4, 2.2, 2.0, 2.4, 2.4, 2.4, 2.4, 1.3])));
    expect(r.outcomeId).toBe("NO-BAND");
    expect(r.results.outcome.label).toBe("all-chaotic");
    expect(first(r)).toMatch(/^NO BAND \(all-chaotic\)\. A physics change is indicated by these meters: the project's alive 2D worlds read critical and no swept slab setting does\. Axis ranking: 1\. dtQ lower to 26 \(Delta 0\.7\d\); 2\. diffA raise to 240 \(Delta 0\.2\d\);/);
    const rk = r.results.outcome.ranking!;
    expect(rk.kind).toBe("RANKED");
    expect(rk.top!.axis).toBe("dtQ");
    expect(rk.top!.direction).toBe("lower");
    expect(axisRow(r, "diffA").best).toBe("mu30-s8-k256-dA240");
  });
  it("NO-BAND under AMP-DEPENDENT says 'in the CRITICAL class at this kick scale' instead of critical", () => {
    const r = read(sweep(ringZ([2.4, 2.2, 2.0, 2.4, 2.4, 2.4, 2.4, 1.3])), gateWith({ amp: "AMP-DEPENDENT" }));
    expect(first(r)).toContain("the project's alive 2D worlds read in the CRITICAL class at this kick scale and no swept slab setting does");
  });
  it("NO-BAND (all-ordered)", () => {
    const r = read(sweep(ringZ([-1.6, -1.6, -1.6, -1.6, -1.6, -1.6, -1.6, -1.6])));
    expect(r.outcomeId).toBe("NO-BAND");
    expect(r.results.outcome.label).toBe("all-ordered");
    expect(first(r)).toMatch(/^NO BAND \(all-ordered\)\. /);
  });
  it("NO-BAND (scattered): ORDERED and CHAOTIC settings that are never adjacent along one axis", () => {
    const t = ringZ([1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6], { "mu30-s16-k256": zs(-1.6), "mu30-s20-k256": zs(-1.6), "mu30-s8-k4096": zs(-1.6) });
    const r = read(sweep(t));
    expect(r.outcomeId).toBe("NO-BAND");
    expect(r.results.outcome.label).toBe("scattered");
    expect(first(r)).toMatch(/^NO BAND \(scattered\)\. /);
  });
  it("NO-BAND with refClass CHAOTIC (nothing reads chaotic): the sentence says no swept setting reads like the alive worlds and does not test criticality", () => {
    const r = read(sweep(ringZ([-1.6, -1.6, -1.6, -1.6, -1.6, -1.6, -1.6, -1.6])), gateWith({ refClass: "CHAOTIC" }));
    expect(r.outcomeId).toBe("NO-BAND");
    expect(first(r)).toMatch(/^NO BAND \(all-ordered\)\. No swept slab setting reads like the project's alive 2D worlds \(chaotic-like\)\. This does not test the criticality hypothesis\. /);
  });

  it("NO-AXIS: the top Delta is below NO_AXIS (R14 row 69 side), and the constants not swept and the constant screen are listed (R12.4)", () => {
    const r = read(sweep(ringZ([1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.4])));
    expect(r.outcomeId).toBe("NO-BAND");
    expect(r.results.outcome.ranking!.kind).toBe("NO-AXIS");
    expect(first(r)).toMatch(/NO-AXIS: no swept constant moves the meters toward the target by more than a factor 1\.4 or by more than B0's own seed-to-seed spread \(top Delta 0\.1\d+, threshold 0\.35\), so the levers are among the constants not swept \(R2\.3\) or in the structure \(kernel radius, topology\)\.$/);
    expect(r.details[0]).toMatch(/^Constants not swept: kernelRadius .*tileD\.$/);
    expect(r.details[1]).toMatch(/^Constant screen: not run/);
  });
  it("NO-AXIS also when the top Delta is below B0's own seed-to-seed range (NOISE), and the axis is named when it is above it", () => {
    const noisy = read(sweep(ringZ([[2.0, 2.6, 3.2], 2.2, 2.2, 2.2, 2.2, 2.2, 2.2, 1.6])));
    expect(noisy.results.outcome.ranking!.kind).toBe("NO-AXIS");
    expect(noisy.results.outcome.ranking!.noise!).toBeGreaterThan(0.8);
    const calm = read(sweep(ringZ([[2.35, 2.4, 2.45], 2.2, 2.2, 2.2, 2.2, 2.2, 2.2, 1.3])));
    expect(calm.results.outcome.ranking!.kind).toBe("RANKED");
    expect(calm.results.outcome.ranking!.top!.axis).toBe("dtQ");
  });
  it("the constant screen of Stage 0 is printed under NO-AXIS when it exists", () => {
    const screen: ConstantScreen = { seed: 9001, setting: B0_ID, T: 20000, rung: "P1", decider: "net", base: { nDecS30: 10, n1_100: 200 }, rows: [{ key: "dtQ", factor: 0.5, value: 26, nDecS30: 5, n1_100: 100 }] };
    const r = evaluateSweepJobs(bundles(sweep(ringZ([1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.4])), ["net"]), RULE, PASS_GATE, P1NET, { label: "SYNTHETIC", screen, capturesDir: null, sensitivity: false, roster: false });
    expect(r.details.join("\n")).toContain("| dtQ | 0.5 | 26 | 0.5 | 0.5 |");
  });
  it("NO-RANKING: B0 has no class (it splits), so no axis is ranked (R14 row 68)", () => {
    const r = read(sweep({ ...ringZ([1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6]), [B0_ID]: ["ORDERED", "CRITICAL", "CHAOTIC"] }));
    expect(r.outcomeId).toBe("NO-BAND");
    expect(r.results.outcome.ranking).toMatchObject({ kind: "NO-RANKING", reason: "B0", rows: [] });
    expect(first(r)).toMatch(/NO-RANKING: mu30-s8-k256 is not in the pool with a class and at least two voting jobs, so no axis can be ranked\.$/);
  });
  it("NO-RANKING when every Delta is NA (R14 row 110): B0 qualifies, no class-bearing setting sits next to B0 on any axis, so no constant was compared: not NO-AXIS (answer G4)", () => {
    // eight class-bearing settings over three axes, none of them a candidate: two axes from B0, or one axis but not next to B0's value in the list
    const none = ["mu20-s12-k256", "mu40-s12-k256", "mu20-s16-k256", "mu40-s16-k256", "mu30-s16-k256", "mu30-s20-k256", "mu30-s8-k4096"];
    const r = read(sweep(Object.fromEntries([B0_ID, ...none].map((id) => [id, zs(-1.6)]))));
    expect(r.outcomeId).toBe("NO-BAND");
    expect(r.results.outcome.ranking).toMatchObject({ kind: "NO-RANKING", reason: "NO-CANDIDATE", top: null });
    expect(r.results.outcome.ranking!.rows).toHaveLength(9);
    expect(first(r)).toMatch(/^NO BAND \(all-ordered\)\. A physics change is indicated by these meters: the project's alive 2D worlds read critical and no swept slab setting does\. NO-RANKING: no swept axis has a class-bearing setting next to mu30-s8-k256 on its tested list \(every Delta is NA\), so no constant was compared and no axis can be ranked or excluded\.$/);
    expect(first(r)).not.toContain("NO-AXIS");
    expect(r.details.join("\n")).not.toContain("Constants not swept"); // that list belongs to NO-AXIS
    const md = r.md.join("\n");
    expect(md).toContain("kind NO-RANKING (NO-CANDIDATE)");
    expect(md).toContain("no candidate");
    // one candidate present: the Delta of its axis is defined, so this is a ranking again (here NO-AXIS)
    const one = read(sweep(Object.fromEntries([B0_ID, ...none, "mu40-s8-k256"].map((id) => [id, zs(-1.6)]))));
    expect(one.results.outcome.ranking!.kind).toBe("NO-AXIS");
    expect(first(one)).toContain("NO-AXIS: no swept constant moves the meters");
  });
  it("a tie within 0.10 names both axes, smaller change first; equal minima on one axis go to the smaller |log2(x / x_B0)| (R14 rows 70 and 71)", () => {
    const r = read(sweep(ringZ([2.4, 2.0, 2.0, 2.4, 2.4, 2.4, 2.4, 1.3], { "mu30-s8-k256-sp4": zs(1.3) })));
    expect(r.outcomeId).toBe("NO-BAND");
    const rk = r.results.outcome.ranking!;
    expect(rk.rows.slice(0, 2).map((x) => x.axis)).toEqual(["dtQ", "spread"]);
    expect(first(r)).toContain("Axes within 0.1 of the top are tied and ordered by the smaller change of the constant: dtQ, spread.");
    expect(axisRow(r, "diffA").best).toBe("mu30-s8-k256-dA240");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the held-out gate through the reader (R9, R13 GATE FAIL and its sentences)", () => {
  const gateOf = (o: SynthGateOpts = {}, combo: Combination = P1NET) => evaluateGateJobs(withFresh(GATE_BASE, syntheticGateJobs({ ...o, touchedOnly: true })), RULE, combo, "SYNTHETIC");
  const causes = (r: ReturnType<typeof gateOf>) => r.gate.causes.map((c) => c.code);
  const where = (r: ReturnType<typeof gateOf>, code: string) => r.gate.causes.find((c) => c.code === code)?.where ?? [];
  const alive = (c: { role: string; world: string; T: number; seed: number }, preset?: string, T?: number) => c.role === "G2" && (!preset || c.world === preset) && (T === undefined || c.T === T);
  const set = (net: SynthRegime, extra: Record<string, unknown> = {}) => ({ net, occ: net, ...extra });

  it("PASS: G1, G2, G3, G5, G6 and G7 hold; refClass and the amplitude label are in gate.json with the M4 manifest and the development-log hash (R9.3, R9.5)", () => {
    const r = gateOf();
    expect(r.gate.pass).toBe(true);
    expect(r.exit).toBe(0);
    expect(r.gate.text).toBe("GATE PASS. Selected combination (P1, net); refClass CRITICAL (AMP-ROBUST); G1, G2, G3, G5, G6 and G7 hold. The sweep may run.");
    expect(r.gate.details[0]).toMatch(/^The project's alive 2D worlds read critical at this kick scale and at the other scale/);
    expect(r.gate.devLogSha).toBe(RULE.devLogSha);
    expect(Object.keys(r.gate.m4Manifest).length).toBe(3 + 3 + 2);
    // the 2D reference worlds are read at T1 and T2 only (R1, R9.1): no group at 20,000 steps
    expect(r.gate.groups.map((g) => g.label)).toEqual(["spots-m3@50000", "spots-m3@100000", "gradient-m3@50000", "gradient-m3@100000", "carpet"]);
    expect(r.gate.conditions.find((c) => c.id === "G2")!.what).toContain("the same at T1, T2 and for both presets");
    // the dose curves of the gate worlds: the 2D jobs at T1 (the first time they are read) and the carpet
    expect(r.gate.curves.length).toBe(2 * 3 + 3);
    expect(r.gate.curves.filter((c) => c.role === "G2").every((c) => c.T === REGIME.T1)).toBe(true);
  });
  it("PASS under AMP-DEPENDENT: the other rung reads another class, so the criticality wording is withheld (R9.8)", () => {
    const r = gateOf({ bank: (c) => (c.rung === "P2" && alive(c, undefined, REGIME.T1) ? set({ z: 1.6, ratioU: 0.1 }, { withF: true, withN: true, nCol: 3 }) : undefined) });
    expect(r.gate.pass).toBe(true);
    expect(r.gate.amp).toBe("AMP-DEPENDENT");
    expect(r.gate.details[0]).toContain("AMP-DEPENDENT");
    expect(r.gate.details[0]).toContain("the criticality wording is withheld (R9.8)");
  });
  it("PASS with refClass CHAOTIC: the target is called chaotic-like and the criticality hypothesis is not tested", () => {
    const r = gateOf({
      bank: (c) => (alive(c) ? set({ z: 1.6, ratioU: 0.1 }, { withF: true, withN: true, nCol: 3 }) : c.role === "G3" ? set({ z: -1.6, ratioU: 0.1 }, { withF: true, withN: true, nCol: 1 }) : undefined),
    });
    expect(r.gate.pass).toBe(true);
    expect(r.gate.refClass).toBe("CHAOTIC");
    expect(r.gate.details[0]).toContain("chaotic-like");
    expect(r.gate.details[0]).toContain("This does not test the criticality hypothesis.");
  });

  it("GATE FAIL REF-ORDERED under net: the other combinations are listed as information only, and the net wording follows (R9.6)", () => {
    const r = gateOf({ bank: (c) => (c.rung === "P1" && alive(c) ? { net: { z: -1.6, ratioU: 0.1 } } : undefined) });
    expect(r.gate.pass).toBe(false);
    expect(causes(r)).toEqual(["REF-ORDERED"]);
    expect(r.gate.text).toBe("GATE FAIL. Selected combination (P1, net), causes: REF-ORDERED. Other combinations, information only: (P1, occ) none; (P2, net) none; (P2, occ) none. CLOSED: candidate 8 ends here.");
    // ORDERED also reads a persistent scar that does not spread (FROZEN), so the sentence says what was read, not that the damage healed (CX-F15)
    expect(r.gate.details).toEqual(["The alive reference worlds read ORDERED under the selected block decider (net) at this kick scale; their decay, frozen-scar, trajectory and dose readings are listed. Reference jobs with the FROZEN flag (a scar that persists without spreading): 0 of 12."]);
    expect(r.gate.details.join(" ")).not.toContain("heals");
    expect(r.gate.others.find((o) => o.combo === "P1-occ")!.pass).toBe(true);
  });
  it("GATE FAIL REF-ORDERED under occ: the same neutral sentence, naming the occupancy decider", () => {
    const r = gateOf({ bank: (c) => (c.rung === "P1" && alive(c) ? { occ: { z: -1.6, ratioU: 0.1 } } : undefined) }, { rung: "P1", decider: "occ" });
    expect(causes(r)).toEqual(["REF-ORDERED"]);
    expect(r.gate.details).toEqual(["The alive reference worlds read ORDERED under the selected block decider (occ) at this kick scale; their decay, frozen-scar, trajectory and dose readings are listed. Reference jobs with the FROZEN flag (a scar that persists without spreading): 0 of 12."]);
  });
  it("GATE FAIL REF-ORDERED where some ordered readings are frozen scars: the FROZEN jobs are counted beside the sentence", () => {
    const ordered = withFresh(GATE_BASE, syntheticGateJobs({ bank: (c) => (c.rung === "P1" && alive(c) ? { net: { z: -1.6, ratioU: 0.1 } } : undefined), touchedOnly: true }));
    let n = 0;
    const bs = ordered.map((b) => {
      const r = b.summary.readings["P1-net"];
      if (b.summary.role !== "G2" || !r || n >= 5) return b;
      n++;
      return { ...b, summary: { ...b.summary, readings: { ...b.summary.readings, "P1-net": { ...r, flags: ["FROZEN" as const] } } } };
    });
    const g = evaluateGateJobs(bs, RULE, P1NET, "SYNTHETIC");
    expect(g.gate.causes.map((c) => c.code)).toEqual(["REF-ORDERED"]);
    expect(g.gate.details[0]).toMatch(/Reference jobs with the FROZEN flag \(a scar that persists without spreading\): 5 of 12\.$/);
  });
  it("GATE FAIL REF-UNDEFINED: a preset has no class held by 2 of its 3 jobs at some time", () => {
    const r = gateOf({ bank: (c) => (alive(c, "spots-m3", REGIME.T1) ? set({ z: -1.0, ratioU: 0.1 }, { withF: true, withN: true, nCol: 3 }) : undefined) });
    expect(causes(r)).toEqual(["REF-UNDEFINED"]);
    expect(where(r, "REF-UNDEFINED")).toEqual(["spots-m3@50000"]);
  });
  it("GATE FAIL REF-UNSTABLE: a preset's class changes between T1 and T2, and REFS-DISAGREE is not also raised for it (R14 row 76, W22)", () => {
    const r = gateOf({ bank: (c) => (alive(c, "spots-m3", REGIME.T2) ? set({ z: 1.6, ratioU: 0.1 }, { withF: true, withN: true, nCol: 3 }) : undefined) });
    expect(causes(r)).toEqual(["REF-UNSTABLE"]);
    expect(where(r, "REF-UNSTABLE")).toEqual(["spots-m3"]);
  });
  it("GATE FAIL REFS-DISAGREE: the two presets read different classes (R14 row 75)", () => {
    const r = gateOf({ bank: (c) => (alive(c, "gradient-m3") ? set({ z: 1.6, ratioU: 0.1 }, { withF: true, withN: true, nCol: 3 }) : undefined) });
    expect(causes(r)).toEqual(["REFS-DISAGREE"]);
  });
  it("GATE FAIL CARPET-UNDEFINED: the carpet holds no class", () => {
    const r = gateOf({ bank: (c) => (c.role === "G3" ? set({ z: 0.9, ratioU: 0.1 }, { withF: true, withN: true, nCol: 1 }) : undefined) });
    expect(causes(r)).toEqual(["CARPET-UNDEFINED"]);
  });
  it("GATE FAIL CARPET-NOT-SEPARATED: the carpet reads the same class as the alive worlds (R14 row 74 side)", () => {
    const r = gateOf({ bank: (c) => (c.role === "G3" ? set({ z: 0, ratioU: 0.1 }, { withF: true, withN: true, nCol: 3 }) : undefined) });
    expect(causes(r)).toEqual(["CARPET-NOT-SEPARATED"]);
  });

  it("GATE FAIL DUST-LIMITED: a much smaller kick left at least half of the damage; the sentence lists the group, the seeds, the states and the ratios (R9.6)", () => {
    const r = gateOf({ bank: (c) => (alive(c, "spots-m3", REGIME.T1) ? set({ z: 0, ratioU: 0.6 }, { withF: true, withN: true, nCol: 3 }) : undefined) });
    expect(causes(r)).toEqual(["REF-UNDEFINED", "DUST-LIMITED"]);
    expect(r.gate.details[0]).toBe("Observed dose insensitivity: a much smaller kick left at least half (DUST-LIMITED) or a quarter to a half (DUST-AMBIGUOUS) of the damage at step 30 in spots-m3@50000: seeds 101 (LIMITED, ratio 0.6), 102 (LIMITED, ratio 0.6), 103 (LIMITED, ratio 0.6); this comparison does not say whether the cause is rounding dust or sensitive dependence.");
  });
  it("GATE FAIL DUST-AMBIGUOUS: between a quarter and a half", () => {
    const r = gateOf({ bank: (c) => (alive(c, "gradient-m3", REGIME.T1) ? set({ z: 0, ratioU: 0.35 }, { withF: true, withN: true, nCol: 3 }) : undefined) });
    expect(causes(r)).toEqual(["REF-UNDEFINED", "DUST-AMBIGUOUS"]);
    expect(r.gate.details[0]).toContain("in gradient-m3@50000: seeds 101 (AMBIG, ratio 0.35)");
  });
  it("GATE FAIL DUST-CONTROL-UNAVAILABLE: no U twin in a group (R14 row 78 side)", () => {
    const r = gateOf({ bank: (c) => (c.role === "G3" ? set({ z: 2.2, ratioU: 0.12 }, { withF: true, withN: true, nCol: 1, withU: false }) : undefined) });
    expect(causes(r)).toContain("DUST-CONTROL-UNAVAILABLE");
    expect(where(r, "DUST-CONTROL-UNAVAILABLE")).toEqual(["carpet"]);
  });

  it("GATE FAIL N-NOT-SATURATED: the noise-swapped twin damages under 5 percent of the living blocks by step 100 (R14 row 79)", () => {
    const r = gateOf({ bank: (c) => (c.role === "G2" && c.world === "gradient-m3" && c.T === REGIME.T1 && c.seed === 101 ? { nSat: 0.04 } : undefined) });
    expect(causes(r)).toEqual(["N-NOT-SATURATED"]);
    expect(r.gate.details).toEqual(["Control failure N-NOT-SATURATED in 2d-gradient-m3-seed101-t50000."]);
  });
  it("GATE FAIL FROZEN-NOT-ORDERED: the F pair reads CRITICAL in one job (R14 row 78)", () => {
    const r = gateOf({ bank: (c) => (c.role === "G2" && c.world === "spots-m3" && c.T === REGIME.T1 && c.seed === 102 ? { fRegime: { z: 0, ratioU: 0.1 } } : undefined) });
    expect(causes(r)).toEqual(["FROZEN-NOT-ORDERED"]);
    expect(r.gate.details).toEqual(["Control failure FROZEN-NOT-ORDERED in 2d-spots-m3-seed102-t50000."]);
  });
  it("GATE FAIL NO-CONTRAST-WITH-CONTROLS: the frozen twin does as much damage as the world (R14 row 80)", () => {
    const r = gateOf({ bank: (c) => (c.role === "G2" && c.world === "spots-m3" && c.T === REGIME.T2 && c.seed === 103 ? { fLevel: 2 } : undefined) });
    expect(causes(r)).toEqual(["NO-CONTRAST-WITH-CONTROLS"]);
    expect(r.gate.details).toEqual(["Control failure NO-CONTRAST-WITH-CONTROLS in 2d-spots-m3-seed103-t100000."]);
  });
  it("GATE FAIL G1-REPRO-FAIL: a dead-world job compared with M4's rounded TSV does not satisfy the gate (R9.2, R5 C4)", () => {
    const r = gateOf({ job: (c) => (c.role === "G1" && c.seed === 102 ? { m4: { mode: "tsv-rounded" } } : undefined) });
    expect(causes(r)).toEqual(["G1-REPRO-FAIL"]);
  });

  it("INVALID-RUN at the gate: a failed check makes the gate say so, exit 1, and pass false so that no stale file lets the runner start (R10.1, R14 row 87)", () => {
    const r = gateOf({ job: (c) => (c.role === "G2" && c.world === "spots-m3" && c.T === REGIME.T1 && c.seed === 101 ? { checks: { C1: { ok: false, detail: "n_blk[3] = 1" } } } : undefined) });
    expect(r.exit).toBe(1);
    expect(r.gate.invalidRun).toBe(true);
    expect(r.gate.pass).toBe(false);
    expect(r.gate.text).toBe("INVALID RUN: 2d-spots-m3-seed101-t50000 failed C1. No outcome. Fix the cause and rerun those jobs.");
    expect(r.gate.details).toContain("2d-spots-m3-seed101-t50000: C1 (n_blk[3] = 1)");
  });
  it("INVALID-RUN at the gate: mixed code hashes among the gate jobs", () => {
    const r = gateOf({ job: (c) => (c.role === "G3" && c.seed === 101 ? { stamps: { codeCommit: "other" } } : undefined) });
    expect(r.exit).toBe(1);
    expect(r.gate.text).toBe("INVALID RUN: the jobs carry mixed codeCommit. No outcome. Fix the cause and rerun those jobs.");
  });
  it("a gate with no job refuses; a G4 relic that failed is informational only", () => {
    expect(() => evaluateGateJobs([], RULE, P1NET, "SYNTHETIC")).toThrow(ReaderError);
    const r = gateOf({ job: (c) => (c.role === "G4" ? { checks: { C7: { ok: true } } } : undefined) });
    expect(r.gate.conditions.find((c) => c.id === "G4")!.info).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("Stage 0 through the reader (R9.0, R13 STAGE 0 strings)", () => {
  const devOf = (o: SynthGateOpts = {}, run = 1, screen: ConstantScreen | null = null) => evaluateDev(withFresh(DEV_BASE, syntheticDevJobs({ ...o, touchedOnly: true })), run, RULE, screen, "SYNTHETIC");
  const codes = (r: ReturnType<typeof devOf>, combo: string) => r.result.combos.find((x) => `${x.combo.rung}-${x.combo.decider}` === combo)!.causes.map((c) => c.code);

  it("STAGE 0 PASS: when every combination passes with margins, (P1, net) is selected, first in order (R14 row 83)", () => {
    const r = devOf();
    expect(r.text).toBe("STAGE 0 PASS (run 1 of 3): combination (P1, net) selected on seeds 9001 to 9003; write it into R1.");
    expect(r.triggerLine).toBe("Threshold trigger: not fired.");
    expect(r.json.outcome).toBe("STAGE0-PASS");
    expect(r.lines.join("\n")).toContain("Write (P1, net) into R1 (RUNG, DECIDER) in the form `P1, net`");
  });
  it("(P1, net) fails with REF-ORDERED and (P1, occ) passes G6 with a dust ratio 0.20, which is within 0.10 of the clear line: MARGINAL, so (P2, net) is selected (R14 row 82; a ratio of 0.30 would be DUST_AMBIG and fail G6)", () => {
    const r = devOf({ bank: (c) => (c.rung === "P1" && c.role === "G2" ? { net: { z: -1.6, ratioU: 0.1 }, occ: { z: 0, ratioU: 0.2 } } : undefined) });
    expect(codes(r, "P1-net")).toContain("REF-ORDERED");
    expect(codes(r, "P1-occ")).toEqual(["MARGINAL"]);
    expect(r.result.combos.find((x) => x.combo.rung === "P1" && x.combo.decider === "occ")!.marginal[0].quantities).toContain("ratioU");
    expect(r.text).toBe("STAGE 0 PASS (run 1 of 3): combination (P2, net) selected on seeds 9001 to 9003; write it into R1.");
  });
  it("STAGE 0 FAIL on run 1 prints the causes of all four combinations; STAGE 0 CLOSED on run 3 (R14 row 84)", () => {
    const allOrdered = { bank: (c: { role: string }) => (c.role === "G2" ? { net: { z: -1.6, ratioU: 0.1 }, occ: { z: -1.6, ratioU: 0.1 } } : undefined) };
    const fail = devOf(allOrdered, 1);
    expect(fail.text).toBe("STAGE 0 FAIL (run 1 of 3). Causes by combination: (P1, net) REF-ORDERED; (P1, occ) REF-ORDERED; (P2, net) REF-ORDERED; (P2, occ) REF-ORDERED.");
    expect(fail.json.outcome).toBe("STAGE0-FAIL");
    expect(fail.lines.join("\n")).toContain("may change J constants (R1) and rerun Stage 0, at most 2 more time(s)");
    const closed = devOf(allOrdered, 3);
    expect(closed.text).toBe("STAGE 0 CLOSED after 3 runs: candidate 8 ends here.");
    expect(closed.json.outcome).toBe("STAGE0-CLOSED");
    expect(closed.lines.join("\n")).toContain("Causes by combination, in detail:");
  });
  it("Z-NOT-ZERO: a Stage 0 job whose zero control failed is a cause of every combination (go/no-go a)", () => {
    const r = devOf({ job: (c) => (c.role === "G2" && c.world === "spots-m3" && c.T === REGIME.T1 && c.seed === 9001 ? { checks: { C1: { ok: false, detail: "n_blk[3] = 1" } } } : undefined) });
    for (const k of ["P1-net", "P1-occ", "P2-net", "P2-occ"]) expect(codes(r, k)).toContain("Z-NOT-ZERO");
    expect(r.result.goNoGo.zExact.ok).toBe(false);
    expect(r.text).toMatch(/^STAGE 0 FAIL \(run 1 of 3\)\./);
  });
  it("DUST-FLOOR and the threshold trigger: the unit-kick twin covers more than 5 percent of the living blocks, 5.01 against 5 percent, in both banks (R14 rows 85 and 86)", () => {
    const at = (level: number) => devOf({ bank: (c) => (c.role === "G2" ? { uNetLevel: level } : undefined) });
    const ok = at(51.2);
    expect(ok.result.goNoGo.dustFloor.ok).toBe(true);
    expect(ok.triggerLine).toBe("Threshold trigger: not fired.");
    expect(ok.rungLine).toBe("By rung (a failure fails that rung's two combinations only; thetaB is never re-derived): P1 bank: dust floor holds, trigger not fired; P2 bank: dust floor holds, trigger not fired.");
    const fires = at(51.3);
    expect(fires.result.goNoGo.dustFloor.ok).toBe(false);
    expect(fires.triggerLine).toMatch(/^Threshold trigger: fired in dev-2d-/);
    // both banks over the line (the synthetic bank also lets the unit kick do as much as the full one, so dust causes come with it): every combination fails and thetaB is not rescued by a derived threshold
    for (const k of ["P1-net", "P1-occ", "P2-net", "P2-occ"]) expect(codes(fires, k).slice(-2)).toEqual(["DUST-FLOOR", "DUST-THRESHOLD"]);
    expect(fires.text).toMatch(/^STAGE 0 FAIL \(run 1 of 3\)\. Causes by combination: \(P1, net\) [^;]*DUST-FLOOR, DUST-THRESHOLD; \(P1, occ\) [^;]*DUST-FLOOR, DUST-THRESHOLD; \(P2, net\) [^;]*DUST-FLOOR, DUST-THRESHOLD; \(P2, occ\) [^;]*DUST-FLOOR, DUST-THRESHOLD\.$/);
    expect(fires.result.selected).toBeNull();
  });
  it("the dust floor is the rung's: over the line in the P1 bank only (a B0 job: go/no-go reads B0), the two P1 combinations fail and (P2, net) is selected; in the P2 bank only, (P1, net) is selected (answer G2)", () => {
    const p1 = devOf({ bank: (c) => (c.role === "B0" && c.rung === "P1" ? { uNetLevel: 51.3 } : undefined) });
    expect(codes(p1, "P1-net")).toEqual(["DUST-FLOOR", "DUST-THRESHOLD"]);
    expect(codes(p1, "P1-occ")).toEqual(["DUST-FLOOR", "DUST-THRESHOLD"]);
    expect(codes(p1, "P2-net")).toEqual([]);
    expect(codes(p1, "P2-occ")).toEqual([]);
    expect(p1.text).toBe("STAGE 0 PASS (run 1 of 3): combination (P2, net) selected on seeds 9001 to 9003; write it into R1.");
    expect(p1.rungLine).toMatch(/^By rung \(.*\): P1 bank: DUST-FLOOR in dev-slab-mu30-s8-k256-seed9001-t20000, .*trigger fired in dev-slab-mu30-s8-k256-seed9001-t20000, .* \(DUST-THRESHOLD\); P2 bank: dust floor holds, trigger not fired\.$/);
    expect(p1.lines.join("\n")).toContain("(b) the dust floor");
    expect(p1.lines.join("\n")).toContain("NO, DUST-FLOOR in the P1 bank (");
    expect(p1.result.combos.map((x) => x.rung)).toEqual([{ floorOk: false, triggerFired: true }, { floorOk: false, triggerFired: true }, { floorOk: true, triggerFired: false }, { floorOk: true, triggerFired: false }]);
    expect(p1.json.outcome).toBe("STAGE0-PASS");
    const p2 = devOf({ bank: (c) => (c.role === "B0" && c.rung === "P2" ? { uNetLevel: 51.3 } : undefined) });
    expect(p2.text).toBe("STAGE 0 PASS (run 1 of 3): combination (P1, net) selected on seeds 9001 to 9003; write it into R1.");
    expect([codes(p2, "P1-net"), codes(p2, "P1-occ"), codes(p2, "P2-net"), codes(p2, "P2-occ")]).toEqual([[], [], ["DUST-FLOOR", "DUST-THRESHOLD"], ["DUST-FLOOR", "DUST-THRESHOLD"]]);
  });
  it("the threshold trigger also fires when the median block difference of the U twin exceeds thetaB: 7 against 6; fired in one bank it fails that rung's two combinations with DUST-THRESHOLD, fired in both it fails all four", () => {
    const med = (m: number, rung?: string) => devOf({ bank: (c) => (c.role === "G3" && (rung === undefined || c.rung === rung) ? { uMedianBlock: m } : undefined) });
    expect(med(6).triggerLine).toBe("Threshold trigger: not fired.");
    const both = med(7);
    expect(both.triggerLine).toMatch(/^Threshold trigger: fired in dev-slab-mu60-s8-k1024-seed900\d-t20000/);
    expect(both.text).toBe("STAGE 0 FAIL (run 1 of 3). Causes by combination: (P1, net) DUST-THRESHOLD; (P1, occ) DUST-THRESHOLD; (P2, net) DUST-THRESHOLD; (P2, occ) DUST-THRESHOLD.");
    expect(both.result.goNoGo.dustFloor.ok).toBe(true); // (c) alone: the floor holds, only the trigger is raised
    const one = med(7, "P1");
    expect(one.text).toBe("STAGE 0 PASS (run 1 of 3): combination (P2, net) selected on seeds 9001 to 9003; write it into R1.");
    expect([codes(one, "P1-net"), codes(one, "P1-occ"), codes(one, "P2-net"), codes(one, "P2-occ")]).toEqual([["DUST-THRESHOLD"], ["DUST-THRESHOLD"], [], []]);
    expect(one.rungLine).toMatch(/P1 bank: dust floor holds, trigger fired in dev-slab-mu60-s8-k1024-seed900\d-t20000.* \(DUST-THRESHOLD\); P2 bank: dust floor holds, trigger not fired\.$/);
    // run 3 is no different: nothing is re-derived to rescue a failing rung
    expect(devOf({ bank: (c) => (c.role === "G3" ? { uMedianBlock: 7 } : undefined) }, 3).text).toBe("STAGE 0 CLOSED after 3 runs: candidate 8 ends here.");
  });
  it("the margin condition: a pooled ratio within a factor 1.25 of the edge of the window makes the combination MARGINAL", () => {
    const r = devOf({ bank: (c) => (c.role === "G2" && c.world === "spots-m3" && c.T === REGIME.T1 && c.seed === 9001 ? { net: { z: 0, s30: 1.8, ratioU: 0.1 }, occ: { z: 0, s30: 1.8, ratioU: 0.1 } } : undefined) });
    expect(codes(r, "P1-net")).toEqual(["MARGINAL"]);
    expect(r.lines.join("\n")).toContain("Margin condition, (P1, net): dev-2d-spots-m3-seed9001-t50000 (s30)");
  });
  it("the report: MIXED and UNSTABLE rate, B0 informational, the constant screen and its absence", () => {
    const none = devOf();
    expect(none.lines.join("\n")).toContain("Constant screen: not run");
    expect(none.lines.join("\n")).toContain("MIXED and UNSTABLE rate among the metered gate jobs");
    expect(none.lines.join("\n")).toContain("## mu30-s8-k256 (informational");
    const screen: ConstantScreen = { seed: 9001, setting: B0_ID, T: 20000, rung: "P1", decider: "net", base: { nDecS30: 10, n1_100: 200 }, rows: [{ key: "dtQ", factor: 0.5, value: 26, nDecS30: 2, n1_100: 400 }, { key: "spread", factor: 2, value: 16, nDecS30: 0, n1_100: 0 }] };
    const lines = constantScreenLines(screen).join("\n");
    expect(lines).toContain("| dtQ | 0.5 | 26 | 0.2 | 2 |");
    expect(lines).toContain("| spread | 2 | 16 | 0 | 0 |");
    expect(stage0Text(none.result)).toBe(none.text);
    expect(thresholdTriggerLine(none.result)).toBe("Threshold trigger: not fired.");
  });
  it("the run number defaults to 1 and says so", () => {
    const r = evaluateDev(DEV_BASE, 1, RULE, null, "SYNTHETIC", true);
    expect(r.lines.join("\n")).toContain("The run number defaulted to 1");
  });

  // ---- the final review of 2026-10-24 (F1, F2, F3): R14 rows 111 to 114 ----
  const allOrdered = { bank: (c: { role: string }) => (c.role === "G2" ? { net: { z: -1.6, ratioU: 0.1 }, occ: { z: -1.6, ratioU: 0.1 } } : undefined) };
  const devPatched = (pick: (f: JobFile) => boolean, patch: (f: JobFile) => JobFile, run = 1) =>
    evaluateDev(withFresh(DEV_BASE, syntheticDevJobs().filter(pick).map(patch)), run, RULE, null, "SYNTHETIC");

  it("R14 row 111 (final review F1): a STAGE 0 PASS is final, also when the threshold trigger fired in the other rung's bank: the Next line says no further Stage 0 run is permitted and stage0.json says final; a FAIL licenses the reruns that are left, the third run is CLOSED", () => {
    const plain = devOf();
    expect(plain.lines.join("\n")).toContain("then run the held-out gate. This PASS is final (R9.0 Repetition): no further Stage 0 run is permitted.");
    expect(plain.lines.join("\n")).toContain("The constants Stage 0 read stand unchanged to the freeze (R9.0).");
    expect(plain.json).toMatchObject({ outcome: "STAGE0-PASS", final: true, rerunsLeft: 0 });
    for (const run of [1, 2, 3]) {
      const trig = devOf({ bank: (c) => (c.role === "G3" && c.rung === "P1" ? { uMedianBlock: 7 } : undefined) }, run);
      expect(trig.text, `run ${run}`).toBe(`STAGE 0 PASS (run ${run} of 3): combination (P2, net) selected on seeds 9001 to 9003; write it into R1.`);
      expect(trig.lines.join("\n")).toMatch(/This PASS is final \(R9\.0 Repetition\): no further Stage 0 run is permitted although the threshold trigger fired in the other rung's bank \(dev-slab-mu60-s8-k1024-seed900\d-t20000/);
      expect(trig.json).toMatchObject({ outcome: "STAGE0-PASS", final: true, rerunsLeft: 0 });
    }
    const runs = [1, 2, 3].map((run) => devOf(allOrdered, run));
    expect(runs.map((r) => [r.json.outcome, r.json.final, r.json.rerunsLeft])).toEqual([["STAGE0-FAIL", false, 2], ["STAGE0-FAIL", false, 1], ["STAGE0-CLOSED", true, 0]]);
    expect(runs[0].lines.join("\n")).toContain("rerun Stage 0, at most 2 more time(s)");
    expect(runs[1].lines.join("\n")).toContain("rerun Stage 0, at most 1 more time(s)");
    expect(runs[0].lines.join("\n")).toContain("Declining to rerun closes the candidate (STAGE0-CLOSED, recorded in that log).");
    expect(runs[2].lines.join("\n")).toContain("Candidate 8 ends here.");
    expect(runs[2].lines.join("\n")).not.toContain("may change J constants");
  });

  it("R14 row 112 (final review F2): B0 jobs with no U twin (FEW_SITES in both banks) do not make the dust floor hold 'in every metered job': the PASS stands, the readout says in how many jobs the U twin was read and names the others", () => {
    const r = devOf({ bank: (c) => (c.role === "B0" ? { mS: 5, withS: false } : undefined) });
    expect(r.result.outcome).toBe("STAGE0-PASS");
    expect(r.result.goNoGo.dustFloor.ok).toBe(true);
    const text = r.lines.join("\n");
    expect(text).toContain("at most SAT = 0.05 in every metered job that has a U twin (a job without one is named below and counts as neither a pass nor a failure)");
    expect(text).not.toContain("in every metered job, read in each rung's bank");
    const ids = [9001, 9002, 9003].map((s) => `dev-slab-mu30-s8-k256-seed${s}-t20000`);
    expect(text).toContain(`U twin read (R9.0 missing evidence): P1 bank 15 of 18 metered jobs, P2 bank 15 of 18 metered jobs; no U twin (a FEW_SITES job runs no S or U twin, so there is nothing to read for (b), (c) or the trigger): P1 bank ${ids.join(", ")}; P2 bank ${ids.join(", ")}.`);
    expect(r.json.goNoGo).toMatchObject({ uEvidence: { P1: { metered: 18, assessed: 15, absent: ids }, P2: { metered: 18, assessed: 15, absent: ids } } });
    expect(r.rungLine).toBe("By rung (a failure fails that rung's two combinations only; thetaB is never re-derived): P1 bank: dust floor holds, trigger not fired; P2 bank: dust floor holds, trigger not fired.");
    // with every U twin present the line says so and names nothing
    expect(devOf().lines.join("\n")).toContain("U twin read (R9.0 missing evidence): P1 bank 18 of 18 metered jobs, P2 bank 18 of 18 metered jobs.");
    // a U log that exists is read even though its dose makes the job's dust state UNAVAILABLE: B0's P1 bank, U dose over U_MAX of S's, covering more than SAT
    const over = devOf({ bank: (c) => (c.role === "B0" && c.rung === "P1" ? { uDoseFrac: 0.3, uNetLevel: 51.3 } : undefined) });
    expect(over.lines.join("\n")).toContain("UNAVAILABLE ratio");
    expect(over.result.goNoGo.dustFloor.byRung.P1.ok).toBe(false);
    expect(over.result.goNoGo.uEvidence.P1).toMatchObject({ metered: 18, assessed: 18, absent: [] });
    expect(over.text).toBe("STAGE 0 PASS (run 1 of 3): combination (P2, net) selected on seeds 9001 to 9003; write it into R1.");
  });

  it("R14 row 114 (final review F3): an INVALID Stage 0 job (a failed C2, a check the file does not record, rung files with different codeCommit) is the cause INVALID-JOB of every combination, listed with its failed check, and the run counts: FAIL on run 1, CLOSED on run 3 (R5 at Stage 0)", () => {
    const failC2 = (f: JobFile): JobFile => ({ ...f, checks: { ...f.checks, C2: { ok: false, detail: "residual 12" } } });
    const dropC2 = (f: JobFile): JobFile => { const { C2: _c2, ...rest } = f.checks; return { ...f, checks: rest }; };
    const split = (f: JobFile): JobFile => (f.id.endsWith("-P2") ? { ...f, codeCommit: "other" } : f);
    const g3of9002 = (f: JobFile) => f.role === "G3" && f.seed === 9002;
    const id = "dev-slab-mu60-s8-k1024-seed9002-t20000";
    const cases: [string, (f: JobFile) => JobFile, string][] = [
      ["a failed C2", failC2, `${id}: C2 (residual 12)`],
      ["a C2 the file does not record", dropC2, `${id}: C2 (the check is missing from the job file)`],
      ["rung files with different codeCommit", split, `${id}: its rung files carry different codeCommit: synthetic and other`],
    ];
    for (const [name, patch, why] of cases) {
      const r1 = devPatched(g3of9002, patch, 1);
      expect(r1.result.outcome, name).toBe("STAGE0-FAIL");
      for (const k of ["P1-net", "P1-occ", "P2-net", "P2-occ"]) expect(codes(r1, k), `${name} ${k}`).toContain("INVALID-JOB");
      expect(r1.result.combos.every((x) => x.causes.find((c) => c.code === "INVALID-JOB")!.where.join() === id), name).toBe(true);
      const text = r1.lines.join("\n");
      expect(text, name).toContain("Invalid Stage 0 jobs (R5; each is the cause INVALID-JOB of every combination, G5, and the readout exits 0 whatever the outcome");
      expect(text, name).toContain(`- ${why}`);
      expect(r1.invalid, name).toContain(why);
      expect(r1.result.goNoGo.zExact.ok, name).toBe(true); // only a failed C1 is also go/no-go (a)
      const r3 = devPatched(g3of9002, patch, 3);
      expect(r3.result.outcome, name).toBe("STAGE0-CLOSED");
      expect(r3.text).toBe("STAGE 0 CLOSED after 3 runs: candidate 8 ends here.");
    }
    // the jobs of a Stage 0 run are not compared with one another for stamps (answer D11): a whole job, both rung files, stamped otherwise is no failure
    const elsewhere = devPatched(g3of9002, (f) => ({ ...f, codeCommit: "elsewhere", srcHash: "elsewhere" }));
    expect(elsewhere.result.outcome).toBe("STAGE0-PASS");
    expect(elsewhere.lines.join("\n")).not.toContain("Invalid Stage 0 jobs");
    expect(elsewhere.invalid).toEqual([]);
    // a failed C1 stays go/no-go (a): the cause Z-NOT-ZERO beside INVALID-JOB, in every combination
    const c1 = devPatched(g3of9002, (f) => ({ ...f, checks: { ...f.checks, C1: { ok: false, detail: "n_blk[3] = 1" } } }));
    for (const k of ["P1-net", "P1-occ", "P2-net", "P2-occ"]) expect(codes(c1, k)).toEqual(expect.arrayContaining(["INVALID-JOB", "Z-NOT-ZERO"]));
    expect(c1.invalid).toContain(`${id}: C1 (n_blk[3] = 1)`);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the rule file, the hashes and the arguments", () => {
  const roots: string[] = [];
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), "regime-readout-"));
    roots.push(d);
    return d;
  };
  afterAll(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });
  const ruleText = (r1: string) =>
    ["# Regime meters: pre-stated rule (test copy)", "", "## R0 How to read this file", "", "- **Normative.** text", "- **R0.2 Development data and the development log.** What shaped this rule.", "  1. run dir `runs/regime/dev`, 2026-10-24, nothing changed", "", "## R1 Constants", "",
      "| name | value | basis | used in |", "|---|---|---|---|", "| T0 | 20,000 | J | R2 |", `| RUNG, DECIDER | ${r1} | J | R4, R6, R9 |`, "", "## R2 Worlds", ""].join("\n");
  const PLACEHOLDER = "**filled in by the finalizer from Stage 0 (R9.0) before the freeze**: `RUNG` in {P1, P2}, `DECIDER` in {net, occ}";
  const put = (root: string, rel: string, text: string) => { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), text); };
  /** A tree with a frozen rule (hash recorded in both places) and, optionally, a draft. */
  const tree = (text = ruleText("P1, net")) => {
    const root = tmp();
    const sha = sha256Hex(text);
    put(root, "experiments/3d-slab/regime-rule.md", text);
    put(root, "experiments/3d-slab/REGIME-FROZEN", `# frozen ${new Date(0).toISOString()}\n${sha}\n`);
    put(root, "runs/regime/RULE.sha256", `${sha}  regime-rule.md\n`);
    put(root, "runs/regime/rule-draft.md", ruleText(PLACEHOLDER));
    return { root, sha, text };
  };

  it("R1's RUNG and DECIDER: filled iff the value cell names exactly one rung and one decider", () => {
    expect(parseCombination(ruleText("P1, net")).combo).toEqual({ rung: "P1", decider: "net" });
    expect(parseCombination(ruleText("RUNG = P2, DECIDER = occ")).combo).toEqual({ rung: "P2", decider: "occ" });
    const open = parseCombination(ruleText(PLACEHOLDER));
    expect(open.combo).toBeNull();
    expect(open.why).toContain("must name exactly one of P1, P2 and one of net, occ");
    expect(parseCombination("# nothing").why).toContain("no R1 row");
  });
  it("the development log is the R0.2 block; its hash is what gate.json records (R9.5)", () => {
    const t = ruleText("P1, net");
    expect(extractDevLog(t)).toBe("- **R0.2 Development data and the development log.** What shaped this rule.\n  1. run dir `runs/regime/dev`, 2026-10-24, nothing changed");
    expect(extractDevLog("no log")).toBe("");
  });
  it("hash files: comment lines are skipped, case is folded, the order is kept", () => {
    const a = "a".repeat(64), b = "B".repeat(64);
    expect(parseHashFile(`# ${"c".repeat(64)}\n${a}  file\n${b}\n`)).toEqual([a, "b".repeat(64)]);
  });
  it("frozen: the rule is read when its SHA-256 is the last in REGIME-FROZEN and equals RULE.sha256", () => {
    const { root, sha } = tree();
    const r = loadRule(pathsFor({ root }), false);
    expect(r.status).toBe("FROZEN");
    expect(r.sha256).toBe(sha);
    expect(r.combo).toEqual({ rung: "P1", decider: "net" });
    expect(selectedCombination(r, undefined)).toEqual({ rung: "P1", decider: "net" });
    expect(() => selectedCombination(r, "P1-net")).toThrow(/only allowed with --draft/);
  });
  it("frozen: a rule whose hash differs from REGIME-FROZEN is refused, naming both hashes (the instruction of plan 8.5)", () => {
    const { root, sha } = tree();
    writeFileSync(join(root, "experiments/3d-slab/regime-rule.md"), ruleText("P1, net") + "\nan edit after the freeze\n");
    expect(() => loadRule(pathsFor({ root }), false)).toThrow(ReaderError);
    try { loadRule(pathsFor({ root }), false); } catch (e) { expect((e as Error).message).toContain(`REGIME-FROZEN records ${sha}`); expect((e as ReaderError).exit).toBe(2); }
  });
  it("frozen: an older hash in REGIME-FROZEN does not count (the rule was amended since); a missing record, a missing rule and a differing RULE.sha256 are refused", () => {
    const { root, sha } = tree();
    put(root, "experiments/3d-slab/REGIME-FROZEN", `${sha}\n${"1".repeat(64)}\n`);
    expect(() => loadRule(pathsFor({ root }), false)).toThrow(/REGIME-FROZEN records 1{64}/);
    put(root, "experiments/3d-slab/REGIME-FROZEN", `${"1".repeat(64)}\n${sha}\n`);
    expect(loadRule(pathsFor({ root }), false).sha256).toBe(sha);
    rmSync(join(root, "experiments/3d-slab/REGIME-FROZEN"));
    expect(() => loadRule(pathsFor({ root }), false)).toThrow(/REGIME-FROZEN is missing|is missing/);
    put(root, "experiments/3d-slab/REGIME-FROZEN", `${sha}\n`);
    put(root, "runs/regime/RULE.sha256", `${"2".repeat(64)}\n`);
    expect(() => loadRule(pathsFor({ root }), false)).toThrow(/RULE\.sha256 does not equal/);
    rmSync(join(root, "experiments/3d-slab/regime-rule.md"));
    expect(() => loadRule(pathsFor({ root }), false)).toThrow(/is frozen after Stage 0|use --draft/);
  });
  it("frozen: RULE.sha256 is read by its last hash too (an amended rule appends): an older hash first is fine, an older hash last is refused (CX-F9)", () => {
    const { root, sha } = tree();
    put(root, "runs/regime/RULE.sha256", `${"3".repeat(64)}\n${sha}  regime-rule.md\n`);
    expect(loadRule(pathsFor({ root }), false).sha256).toBe(sha);
    put(root, "runs/regime/RULE.sha256", `${sha}  regime-rule.md\n${"3".repeat(64)}\n`);
    expect(() => loadRule(pathsFor({ root }), false)).toThrow(/RULE\.sha256 does not equal/);
  });
  it("draft: the draft rule is read without a hash check, labelled DRAFT; --combo fills R1 in but may not contradict it", () => {
    const { root } = tree();
    const r = loadRule(pathsFor({ root }), true);
    expect(r.status).toBe("DRAFT");
    expect(r.combo).toBeNull();
    expect(() => selectedCombination(r, undefined)).toThrow(/R1 does not hold RUNG and DECIDER yet/);
    expect(selectedCombination(r, "P2-occ")).toEqual({ rung: "P2", decider: "occ" });
    expect(() => selectedCombination(r, "P3-net")).toThrow(/expected P1-net/);
    put(root, "runs/regime/rule-draft.md", ruleText("P1, net"));
    const filled = loadRule(pathsFor({ root }), true);
    expect(() => selectedCombination(filled, "P2-occ")).toThrow(/disagrees with R1/);
  });
  it("arguments: exactly one mode, known options only, --run from 1 to 3", () => {
    expect(parseArgs(["--sweep", "--draft", "--combo=P1-net", "--no-sensitivity"]).opts).toMatchObject({ draft: true, combo: "P1-net", noSensitivity: true });
    expect(() => parseArgs([])).toThrow(/exactly one of/);
    expect(() => parseArgs(["--dev", "--gate"])).toThrow(/exactly one of/);
    expect(() => parseArgs(["--gate", "--bogus"])).toThrow(/unknown option --bogus/);
    expect(() => parseArgs(["--gate", "oops"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--dev", "--run=4"])).toThrow(/--run must be an integer from 1 to 3/);
    expect(parseArgs(["--dev", "--run=3"]).opts.run).toBe(3);
  });
  it("cell formatting: six significant digits, empty for null and non-finite, yes and no for booleans, no tabs or newlines", () => {
    expect(fmt(0.123456789)).toBe("0.123457");
    expect(fmt(1234567)).toBe("1234570");
    expect([fmt(null), fmt(undefined), fmt(NaN), fmt(Infinity)]).toEqual(["", "", "", ""]);
    expect([fmt(true), fmt(false)]).toEqual(["yes", "no"]);
    expect(fmt("a\tb\nc")).toBe("a b c");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the CLI on files: --dev, --gate, --sweep, exit codes, labels and refusals", () => {
  const roots: string[] = [];
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), "regime-readout-cli-"));
    roots.push(d);
    return d;
  };
  afterAll(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });
  const RULE_TEXT = ["# test rule", "", "- **R0.2 Development data and the development log.** log", "  1. one", "", "## R1 Constants", "", "| name | value | basis | used in |", "|---|---|---|---|", "| RUNG, DECIDER | P1, net | J | R4 |", ""].join("\n");
  const SHA = sha256Hex(RULE_TEXT);
  const DEVLOG = "- **R0.2 Development data and the development log.** log\n  1. one";
  const put = (root: string, rel: string, text: string) => { mkdirSync(join(root, rel, ".."), { recursive: true }); writeFileSync(join(root, rel), text); };
  /** The gate file `--gate` writes for the passing synthetic gate under the frozen test rule (the sweep tests start from it instead of re-running the gate). */
  const writeGate = (root: string, patch: Record<string, unknown> = {}) => put(root, "runs/regime/gate.json", JSON.stringify({ ...PASS_GATE, ruleSha: SHA, devLogSha: sha256Hex(DEVLOG), draft: false, synthetic: false, label: "", ...patch }));
  const writeJobs = (dir: string, jobs: JobFile[]) => { mkdirSync(dir, { recursive: true }); for (const j of jobs) writeFileSync(join(dir, `${j.id}.json`), JSON.stringify(j)); };
  /** Stamps a job as the runner would under the frozen rule, and drops the synthetic mark (so that the outputs are not labelled SYNTHETIC). */
  const real = (jobs: JobFile[], sha = SHA): JobFile[] => jobs.map((j) => ({ ...j, ruleSha: sha, codeCommit: "c0ffee", srcHash: "5eed", treeClean: true, synthetic: false }));
  const frozenRoot = () => {
    const root = tmp();
    put(root, "experiments/3d-slab/regime-rule.md", RULE_TEXT);
    put(root, "experiments/3d-slab/REGIME-FROZEN", `${SHA}\n`);
    put(root, "runs/regime/RULE.sha256", `${SHA}\n`);
    return root;
  };
  const run = (argv: string[]) => {
    const out: string[] = [], err: string[] = [];
    const code = main(argv, { log: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  const smallSweep = (): JobFile[] => sweep({ [B0_ID]: THREE("CRITICAL"), "mu30-s8-k256-dA100": THREE("CRITICAL"), "mu30-s8-k256-dA240": THREE("CHAOTIC"), "mu20-s8-k256": THREE("EXTINCT") });
  /** The CLI refuses an incomplete sweep; these small tables declare the 28 settings they did not run, as a trimmed sweep would (R2.3, plan section 9). */
  const SMALL_IDS = [B0_ID, "mu30-s8-k256-dA100", "mu30-s8-k256-dA240", "mu20-s8-k256"];
  const TRIM_SMALL = `--allow-missing=${sweepSettings().map((s) => s.id).filter((id) => !SMALL_IDS.includes(id)).join(",")}`;

  it("frozen, end to end: --gate writes gate.json (no label), --sweep writes the four files and prints the outcome with exit 0", () => {
    const root = frozenRoot();
    writeJobs(join(root, "runs/regime/jobs"), real([...syntheticGateJobs(), ...smallSweep()]));
    const g = run(["--gate", `--root=${root}`]);
    expect(g.code).toBe(0);
    expect(g.out).toContain("OUTCOME: GATE-PASS");
    const gate = json(join(root, "runs/regime/gate.json"));
    expect(gate).toMatchObject({ schema: "regime-gate/1", pass: true, rung: "P1", decider: "net", refClass: "CRITICAL", amp: "AMP-ROBUST", ruleSha: SHA, draft: false, label: "" });
    expect(gate.devLogSha).toBe(sha256Hex("- **R0.2 Development data and the development log.** log\n  1. one"));
    expect(existsSync(join(root, "runs/regime/gate.DRAFT.json"))).toBe(false);
    const refused = run(["--sweep", `--root=${root}`, "--no-sensitivity"]);
    expect(refused.code).toBe(2); // 12 of the 96 jobs: a verdict needs the complete roster
    expect(refused.err).toContain("not the registered set of jobs");
    expect(existsSync(join(root, "runs/regime/regime-results.json"))).toBe(false);
    const s = run(["--sweep", `--root=${root}`, "--no-sensitivity", TRIM_SMALL]);
    expect(s.code).toBe(0);
    expect(s.out).toMatch(/OUTCOME: (PENDING-LATE-CHECK|THIN-POOL|EMPTY-WINDOW|NO-CONTRAST)/);
    expect(s.out).toContain("Trimmed settings (declared with --allow-missing");
    for (const f of ["regime-results.tsv", "regime-settings.tsv", "regime-readout.md", "regime-results.json"]) expect(existsSync(join(root, "runs/regime", f))).toBe(true);
    const rows = readFileSync(join(root, "runs/regime/regime-results.tsv"), "utf8").trim().split("\n");
    expect(rows[0].split("\t")).toEqual([...JOB_COLUMNS]);
    expect(rows.length).toBe(1 + 12);
    expect(rows[1].split("\t").length).toBe(JOB_COLUMNS.length);
    const settings = readFileSync(join(root, "runs/regime/regime-settings.tsv"), "utf8").trim().split("\n");
    expect(settings[0].split("\t")).toEqual([...SETTING_COLUMNS]);
    expect(settings.length).toBe(1 + 32);
    const res: ResultsJson = json(join(root, "runs/regime/regime-results.json"));
    expect(res).toMatchObject({ schema: "regime-results/1", synthetic: false, draft: false, label: "" });
    expect(res.rule.sha256).toBe(SHA);
    expect(res.stamps).toEqual({ ruleSha: [SHA], codeCommit: ["c0ffee"], srcHash: ["5eed"] });
    expect(readFileSync(join(root, "runs/regime/regime-readout.md"), "utf8")).toContain("## Development log (R0.2)");
  }, 120_000);

  it("frozen: jobs stamped with another rule hash are INVALID by C6 (the reader checks the stamp itself), the exit is 1 and the files still say so", () => {
    const root = frozenRoot();
    writeGate(root);
    const bad = real(smallSweep());
    bad[0] = { ...bad[0], ruleSha: "f".repeat(64) };
    writeJobs(join(root, "runs/regime/jobs"), bad);
    const s = run(["--sweep", `--root=${root}`, "--no-sensitivity", TRIM_SMALL]);
    expect(s.code).toBe(1);
    expect(s.out).toContain("OUTCOME: INVALID-RUN");
    expect(s.out).toContain("INVALID RUN: slab-mu30-s8-k256-seed101-t20000-P1-net failed C6; the jobs carry mixed ruleSha. No outcome. Fix the cause and rerun those jobs.");
    expect(json(join(root, "runs/regime/regime-results.json")).outcome).toMatchObject({ id: "INVALID-RUN", fatal: true });
  }, 120_000);

  it("frozen: a rule edited after the freeze is refused with exit 2 in every mode", () => {
    const root = frozenRoot();
    writeFileSync(join(root, "experiments/3d-slab/regime-rule.md"), RULE_TEXT + "\nedit\n");
    for (const mode of ["--dev", "--gate", "--sweep"]) {
      const r = run([mode, `--root=${root}`]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("REFUSED");
    }
  });

  it("draft: --gate without --combo refuses while R1 is unfilled; with it, every output is labelled DRAFT and gate.json is not written", () => {
    const root = tmp();
    put(root, "runs/regime/rule-draft.md", RULE_TEXT.replace("P1, net", "**filled in by the finalizer**: `RUNG` in {P1, P2}, `DECIDER` in {net, occ}"));
    writeJobs(join(root, "runs/regime/jobs"), real(syntheticGateJobs()));
    const none = run(["--gate", "--draft", `--root=${root}`]);
    expect(none.code).toBe(2);
    expect(none.err).toContain("R1 does not hold RUNG and DECIDER yet");
    const g = run(["--gate", "--draft", "--combo=P1-net", `--root=${root}`]);
    expect(g.code).toBe(0);
    expect(g.out.split("\n")[0]).toMatch(/^DRAFT: the rule was not frozen/);
    expect(existsSync(join(root, "runs/regime/gate.json"))).toBe(false);
    const gate = json(join(root, "runs/regime/gate.DRAFT.json"));
    expect(gate).toMatchObject({ draft: true, label: "DRAFT", pass: true });
    expect(readFileSync(join(root, "runs/regime/gate-readout.DRAFT.md"), "utf8").split("\n")[0]).toMatch(/^DRAFT: /);
    writeJobs(join(root, "runs/regime/jobs"), real(smallSweep()));
    const s = run(["--sweep", "--draft", "--combo=P1-net", `--root=${root}`, "--no-sensitivity", TRIM_SMALL]);
    expect(s.code).toBe(0);
    const tsvRows = readFileSync(join(root, "runs/regime/regime-results.DRAFT.tsv"), "utf8").trim().split("\n");
    expect(tsvRows[1].split("\t")[JOB_COLUMNS.indexOf("rule")]).toBe("DRAFT");
    expect(json(join(root, "runs/regime/regime-results.DRAFT.json"))).toMatchObject({ draft: true, label: "DRAFT", synthetic: false });
    expect(existsSync(join(root, "runs/regime/regime-results.json"))).toBe(false);
    // the runner reads gate.json only: a frozen --sweep finds no gate
    const frozenSweep = run(["--sweep", `--root=${root}`]);
    expect(frozenSweep.code).toBe(2);
  }, 120_000);

  it("synthetic jobs are labelled SYNTHETIC in every output and never mix with real ones", () => {
    const root = tmp();
    put(root, "runs/regime/rule-draft.md", RULE_TEXT);
    writeJobs(join(root, "runs/regime/jobs"), syntheticGateJobs());
    expect(run(["--gate", "--draft", `--root=${root}`]).out.split("\n")[0]).toMatch(/^SYNTHETIC: not a result/);
    expect(existsSync(join(root, "runs/regime/gate.SYNTHETIC.json"))).toBe(true);
    const mixed = syntheticGateJobs().map((j, i) => (i === 0 ? { ...j, synthetic: false } : j));
    rmSync(join(root, "runs/regime/jobs"), { recursive: true });
    writeJobs(join(root, "runs/regime/jobs"), mixed);
    const r = run(["--gate", "--draft", `--root=${root}`]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("synthetic and real job files are mixed");
  }, 120_000);

  it("--sweep refuses a gate file of another combination, another rule hash or another development log, and a missing gate file", () => {
    const root = frozenRoot();
    writeJobs(join(root, "runs/regime/jobs"), real(smallSweep()));
    expect(run(["--sweep", `--root=${root}`]).err).toContain("run --gate first");
    writeGate(root);
    const path = join(root, "runs/regime/gate.json");
    const original = json(path);
    const tamper = (patch: Record<string, unknown>) => { writeFileSync(path, JSON.stringify({ ...original, ...patch })); return run(["--sweep", `--root=${root}`, "--no-sensitivity"]); };
    expect(tamper({ rung: "P2" }).err).toContain("REFUSED: gate.json was read for (P2, net)");
    expect(tamper({ ruleSha: "e".repeat(64) }).err).toContain("REFUSED: gate.json carries rule hash");
    expect(tamper({ devLogSha: "0".repeat(64) }).err).toContain("development log (R0.2) changed after the gate ran");
    expect(tamper({ invalidRun: true }).err).toContain("the gate run was INVALID");
    expect(tamper({ draft: true }).err).toContain("REFUSED: gate file draft=true");
    expect(tamper({ schema: "x" }).err).toContain("is not a gate file");
  }, 120_000);

  it("--sweep with a failed gate prints GATE-FAIL and exits 0: the failure is the outcome", () => {
    const root = frozenRoot();
    writeJobs(join(root, "runs/regime/jobs"), real(smallSweep()));
    writeGate(root);
    const path = join(root, "runs/regime/gate.json");
    const text = "GATE FAIL. Selected combination (P1, net), causes: REF-ORDERED. Other combinations, information only: (P1, occ) none; (P2, net) none; (P2, occ) none. CLOSED: candidate 8 ends here.";
    writeFileSync(path, JSON.stringify({ ...json(path), pass: false, refClass: null, amp: null, text, details: [], causes: [{ code: "REF-ORDERED", where: ["spots-m3@50000"] }] }));
    const s = run(["--sweep", `--root=${root}`, "--no-sensitivity"]);
    expect(s.code).toBe(0);
    expect(s.out).toContain("OUTCOME: GATE-FAIL");
    expect(s.out).toContain(text);
  }, 120_000);

  it("malformed inputs are refusals (exit 2): bad JSON, a file that is not a job, duplicate ids, Stage 0 or 2D jobs among the sweep, a job under another rung, a start step or a setting that does not exist", () => {
    const root = frozenRoot();
    const jobsDir = join(root, "runs/regime/jobs");
    writeGate(root);
    const base = real(smallSweep());
    const attempt = (extra: JobFile[], name: string, text?: string) => {
      rmSync(jobsDir, { recursive: true, force: true });
      writeJobs(jobsDir, [...base, ...extra]);
      if (text !== undefined) writeFileSync(join(jobsDir, name), text);
      return run(["--sweep", `--root=${root}`, "--no-sensitivity"]);
    };
    expect(attempt([], "bad.json", "{ not json").err).toContain("is not valid JSON");
    expect(attempt([], "other.json", JSON.stringify({ hello: 1 })).err).toContain("is not a job file");
    expect(attempt([], "dup.json", JSON.stringify(base[0])).err).toContain("appears in both");
    expect(attempt(real(syntheticDevJobs().slice(0, 1)), "").err).toContain("Stage 0 (dev) jobs are among the jobs in");
    expect(attempt(real(syntheticGateJobs().filter((j) => j.kind === "2d").slice(0, 1).map((j) => ({ ...j, role: "SWEEP" as const }))), "").err).toMatch(/2D job is among the sweep jobs|appears in both/);
    expect(attempt(real(synthJob({ world: B0_ID, seed: 104, decider: "net", f: 0.3, banks: { P2: { net: REG.CRITICAL } } })), "").err).toContain("was run under rung P2, but the selected combination is (P1, net)");
    expect(attempt(real(synthJob({ world: B0_ID, seed: 104, decider: "net", T: 30000, f: 0.3, banks: { P1: { net: REG.CRITICAL } } })), "").err).toContain("is neither T0 20000 nor T1 50000");
    expect(attempt(real(synthJob({ world: "mu99-s8-k256", seed: 104, decider: "net", f: 0.3, banks: { P1: { net: REG.CRITICAL } } })), "").err).toContain("is not a setting of the catalogue");
    const noBank = real(synthJob({ world: B0_ID, seed: 104, decider: "net", f: 0.3 }));
    expect(attempt(noBank, "").err).toContain("was metered at T but has no twin bank");
    const rehearsal = real(synthJob({ world: B0_ID, seed: 104, decider: "net", f: 0.3, banks: { P1: { net: REG.CRITICAL } } })).map((j) => ({ ...j, rehearsal: true }));
    expect(attempt(rehearsal, "").err).toContain("slab-mu30-s8-k256-seed104-t20000-P1-net is a rehearsal (written by the runner's --dev flag): rehearsals never enter a readout");
    expect(attempt(rehearsal, "").code).toBe(2);
  }, 120_000);

  it("--dev: writes stage0.json and the readout, prints the STAGE 0 string and the trigger line; a Stage 0 directory with a non-dev job is refused", () => {
    const root = tmp();
    put(root, "runs/regime/rule-draft.md", RULE_TEXT);
    writeJobs(join(root, "runs/regime/dev"), real(syntheticDevJobs()));
    put(root, "runs/regime/dev/constant-screen.json", JSON.stringify({ seed: 9001, setting: B0_ID, T: 20000, rung: "P1", decider: "net", base: { nDecS30: 10, n1_100: 100 }, rows: [{ key: "dtQ", factor: 2, value: 102, nDecS30: 20, n1_100: 50 }] }));
    const r = run(["--dev", "--draft", "--run=2", `--root=${root}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("OUTCOME: STAGE0-PASS");
    expect(r.out).toContain("STAGE 0 PASS (run 2 of 3): combination (P1, net) selected on seeds 9001 to 9003; write it into R1.");
    expect(r.out).toContain("Threshold trigger: not fired.");
    const st = json(join(root, "runs/regime/dev/stage0.DRAFT.json"));
    expect(st).toMatchObject({ schema: "regime-stage0/1", run: 2, outcome: "STAGE0-PASS", draft: true });
    expect(st.constantScreen.rows[0].key).toBe("dtQ");
    expect(readFileSync(join(root, "runs/regime/dev/stage0-readout.DRAFT.md"), "utf8")).toContain("| dtQ | 2 | 102 | 2 | 0.5 |");
    writeJobs(join(root, "runs/regime/dev"), real(synthJob({ world: B0_ID, seed: 101, decider: "net", f: 0.3, banks: { P1: { net: REG.CRITICAL } } })));
    expect(run(["--dev", "--draft", `--root=${root}`]).err).toContain("holds a job that is not a Stage 0 job");
    // a runner rehearsal (--dev) in the Stage 0 directory is refused too, whatever its other tags
    rmSync(join(root, "runs/regime/dev"), { recursive: true });
    writeJobs(join(root, "runs/regime/dev"), real(syntheticDevJobs().slice(0, 2)).map((j) => ({ ...j, rehearsal: true })));
    const reh = run(["--dev", "--draft", `--root=${root}`]);
    expect(reh.code).toBe(2);
    expect(reh.err).toContain("is a rehearsal (written by the runner's --dev flag)");
  }, 120_000);

  it("final review F3: --dev with an INVALID Stage 0 job exits 0 (R5 at Stage 0), prints the outcome and the failed check, and compares no stamps across the jobs of the run", () => {
    const root = tmp();
    put(root, "runs/regime/rule-draft.md", RULE_TEXT);
    const jobs = real(syntheticDevJobs()).map((j) => {
      if (j.role === "G2" && j.seed === 9001) return { ...j, codeCommit: "aaaa", srcHash: "bbbb" }; // a whole job stamped otherwise: not compared with the other jobs
      if (j.role === "G3" && j.seed === 9002) return { ...j, checks: { ...j.checks, C2: { ok: false, detail: "residual 12" } } };
      return j;
    });
    writeJobs(join(root, "runs/regime/dev"), jobs);
    const r = run(["--dev", "--draft", "--run=3", `--root=${root}`]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("OUTCOME: STAGE0-CLOSED");
    expect(r.out).toContain("STAGE 0 CLOSED after 3 runs: candidate 8 ends here.");
    expect(r.out).toContain("Invalid Stage 0 job(s), the cause INVALID-JOB of every combination (R5 at Stage 0; the exit code stays 0):");
    expect(r.out).toContain("dev-slab-mu60-s8-k1024-seed9002-t20000: C2 (residual 12)");
    expect(r.out).not.toContain("mixed");
    const st = json(join(root, "runs/regime/dev/stage0.DRAFT.json"));
    expect(st).toMatchObject({ outcome: "STAGE0-CLOSED", final: true, rerunsLeft: 0, invalid: ["dev-slab-mu60-s8-k1024-seed9002-t20000: C2 (residual 12)"] });
    // the same jobs without the failed check: stamps that differ between jobs are no failure and the run is a PASS (exit 0, nothing listed)
    writeJobs(join(root, "runs/regime/dev"), jobs.map((j) => (j.role === "G3" && j.seed === 9002 ? { ...j, checks: { ...j.checks, C2: { ok: true } } } : j)));
    const ok = run(["--dev", "--draft", "--run=1", `--root=${root}`]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("OUTCOME: STAGE0-PASS");
    expect(ok.out).not.toContain("Invalid Stage 0 job(s)");
    expect(json(join(root, "runs/regime/dev/stage0.DRAFT.json"))).toMatchObject({ outcome: "STAGE0-PASS", final: true, rerunsLeft: 0, invalid: [] });
  }, 240_000);

  it("--help prints the usage and exits 0; an unknown mode exits 2", () => {
    const h = run(["--help"]);
    expect(h.code).toBe(0);
    expect(h.out).toContain("usage: regime-readout.ts");
    expect(run(["--nope"]).code).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("the companion page (plan 8.6): labelling, refusal, content", () => {
  let cached: ReturnType<typeof syntheticResults> | null = null;
  const synth = () => (cached ??= syntheticResults({ sensitivity: false, boot: 20 }));
  const FROZEN = "a".repeat(64);
  const asReal = (r: ResultsJson, sha = FROZEN): ResultsJson => ({
    ...r, synthetic: false, draft: false, label: "", rule: { ...r.rule, status: "FROZEN", sha256: sha }, gate: { ...r.gate, ruleSha: sha },
  });
  const dataOf = (html: string) => {
    const m = /<script type="application\/json" id="data">([\s\S]*?)<\/script>/.exec(html);
    expect(m).not.toBeNull();
    return JSON.parse(m![1]);
  };

  it("the synthetic sweep runs through the real reader: a passing gate, the late check, TRANSIENT-BAND, three cards with series and captures", () => {
    const b = synth();
    expect(b.gate.pass).toBe(true);
    expect(b.results.synthetic).toBe(true);
    expect(b.results.label).toBe("SYNTHETIC");
    expect(b.results.outcome.id).toBe("TRANSIENT-BAND");
    expect(b.results.settings.length).toBe(32);
    expect(b.results.cards.map((c) => c.slot)).toEqual(["ORDERED", "CRITICAL", "CHAOTIC"]);
    expect(b.results.cards.every((c) => c.series && c.series.t.length >= 15 && c.series.t[0] >= 10)).toBe(true);
    expect(Object.keys(b.captures).sort()).toEqual(b.results.cards.map((c) => c.id as string).sort());
    expect(b.results.t1Jobs.length).toBe(18);
    expect(Object.keys(b.results.curves).length).toBeGreaterThan(60);
  });

  it("pageLabel: synthetic and draft results label themselves; a result needs the frozen rule's hash, or the builder refuses (the instruction of plan 8.6)", () => {
    const r = synth().results;
    expect(pageLabel(r, null)).toBe("synthetic");
    expect(pageLabel({ ...r, synthetic: false, draft: true }, null)).toBe("draft");
    expect(pageLabel(asReal(r), FROZEN)).toBe("result");
    expect(() => pageLabel(asReal(r), "b".repeat(64))).toThrow(/REFUSED: the results carry rule hash aaaaaaaaaaaa, the frozen rule is bbbbbbbbbbbb/);
    expect(() => pageLabel(asReal(r), null)).toThrow(/REFUSED: these results claim a frozen rule/);
    expect(() => pageLabel({ ...asReal(r), gate: { ...r.gate, ruleSha: "c".repeat(64) } }, FROZEN)).toThrow(/gate behind these results does not carry the frozen rule's hash/);
    expect(() => pageLabel({ ...r, outcome: { ...r.outcome, id: "INVALID-RUN" } }, null)).toThrow(/REFUSED: the results are an INVALID-RUN/);
    expect(() => pageLabel({ ...r, schema: "x" as "regime-results/1" }, null)).toThrow(/not a regime-results\/1 file/);
    // a result that says synthetic can never become a result by claiming a frozen rule
    expect(pageLabel({ ...asReal(r), synthetic: true }, FROZEN)).toBe("synthetic");
  });

  it("the synthetic page says 'synthetic: not a result' in the title, the eyebrow, the banner, the verdict and the footer", () => {
    const b = synth();
    const html = buildPage({ results: b.results, label: "synthetic", captures: b.captures, m4Labels: {} });
    expect(html).toContain("<title>Regime meters map (synthetic)</title>");
    expect(html.match(/synthetic: not a result/gi)!.length).toBeGreaterThanOrEqual(5);
    expect(html).toContain('class="banner synth"');
    expect(html).toContain("Transient band");
    expect(html).toContain("TRANSIENT BAND: mu30-s8-k256");
  });
  it("a result page carries no synthetic wording and no banner; a draft page says DRAFT", () => {
    const b = synth();
    const html = buildPage({ results: asReal(b.results), label: "result", captures: {}, m4Labels: {} });
    expect(html).not.toMatch(/synthetic: not a result|class="banner/);
    expect(html).toContain("<title>Regime meters map</title>");
    expect(html).toContain("Frozen rule aaaaaaaaaaaa");
    const draft = buildPage({ results: { ...b.results, synthetic: false, draft: true }, label: "draft", captures: {}, m4Labels: {} });
    expect(draft).toContain("DRAFT: the rule was not frozen");
    expect(draft).toContain("<title>Regime meters map (draft)</title>");
  });
  it("the page is self-contained: no network, one inlined data tag that parses and cannot close its script, light and dark tokens, 16 px gutters, a viewport", () => {
    const b = synth();
    const html = buildPage({ results: b.results, label: "synthetic", captures: b.captures, m4Labels: { [B0_ID]: "transient" } });
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet|<img |fetch\(|XMLHttpRequest|@import|url\(http/);
    expect(html.match(/https?:\/\/[^"'\s)]+/g)!.filter((u) => u !== "http://www.w3.org/2000/svg")).toEqual([]);
    const data = dataOf(html);
    expect(data.results.outcome.id).toBe("TRANSIENT-BAND");
    expect(data.m4[B0_ID]).toBe("transient");
    expect(Object.keys(data.captures).length).toBe(3);
    expect(html.indexOf("</script>")).toBeGreaterThan(html.indexOf('id="data"'));
    expect((html.match(/<script/g) ?? []).length).toBe(2);
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).toContain("padding: 0 16px 64px");
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html.match(/--cold:/g)!.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("localStorage.getItem(\"bl-theme\")");
  });
  it("the verdict and the gate are server-rendered: the outcome string, the eight gate rows and the reading scale", () => {
    const b = synth();
    const html = buildPage({ results: b.results, label: "synthetic", captures: {}, m4Labels: {} });
    expect(html).toContain("Reading scale: finite-amplitude response to P1 kicks");
    for (const id of ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]) expect(html).toContain(`<td class="mono">${id}</td>`);
    expect(html).toContain("AMP-ROBUST");
    expect(html).toContain('<details class="ids"><summary>job ids (18)</summary>');
    expect(html).toContain('id="map"');
    expect(html).toContain('id="runs"');
    expect(html).toContain('id="curve"');
    expect((html.match(/<article class="card runcard/g) ?? []).length).toBe(3);
  });
  it("a failed gate builds a page without a map, an INVALID-RUN refuses, and outcome strings are escaped", () => {
    const b = synth();
    const failed: ResultsJson = { ...b.results, gate: { ...b.results.gate, pass: false }, outcome: { ...b.results.outcome, id: "GATE-FAIL", text: "GATE FAIL. <b>x</b> & causes", details: [], footer: "" }, cards: [] };
    const html = buildPage({ results: failed, label: "synthetic", captures: {}, m4Labels: {} });
    expect(html).toContain("No sweep was read");
    expect(html).not.toContain('id="map"');
    expect(html).toContain("GATE FAIL. &lt;b&gt;x&lt;/b&gt; &amp; causes");
    expect(html).toContain("Gate failed");
  });
  it("the saturated-map fallback: the page is told when every metered setting reads e = +2 (it then colours by ln s(30) and says so)", () => {
    const r = synth().results;
    expect(allSaturated(r)).toBe(false);
    const hot: ResultsJson = { ...r, settings: r.settings.map((s) => (s.eMed === null ? s : { ...s, eMed: 2 })) };
    expect(allSaturated(hot)).toBe(true);
    expect(dataOf(buildPage({ results: hot, label: "synthetic", captures: {}, m4Labels: {} })).allSaturated).toBe(true);
    expect(dataOf(buildPage({ results: r, label: "synthetic", captures: {}, m4Labels: {} })).allSaturated).toBe(false);
    expect(allSaturated({ ...r, settings: r.settings.map((s) => ({ ...s, eMed: null })) })).toBe(false);
    expect(allSaturated({ ...r, settings: r.settings.map((s) => (s.id === B0_ID ? { ...s, eMed: 1.99 } : s.eMed === null ? s : { ...s, eMed: 2 })) })).toBe(false);
  });
  it("helpers: foldJobIds, jsonForScript, packCapture", () => {
    expect(foldJobIds("TRANSIENT BAND: a read X (job ids j1, j2).")).toEqual({ head: "TRANSIENT BAND: a read X", ids: ["j1", "j2"], tail: "." });
    expect(foldJobIds("PENDING: run for a (jobs j1).").ids).toEqual(["j1"]);
    expect(foldJobIds("no list here").ids).toEqual([]);
    expect(jsonForScript({ a: "</script><!--" })).not.toContain("<");
    expect(JSON.parse(jsonForScript({ a: "</script>" })).a).toBe("</script>");
  });

  it("htmlMain: results claiming a frozen rule without its hash are refused (exit 2) and no page is written; with the hash a page is written", () => {
    const root = mkdtempSync(join(tmpdir(), "regime-html-"));
    try {
      const rulePath = join(root, "experiments/3d-slab/regime-rule.md");
      mkdirSync(join(root, "experiments/3d-slab"), { recursive: true });
      writeFileSync(rulePath, "frozen text\n");
      const sha = sha256Hex("frozen text\n");
      writeFileSync(join(root, "experiments/3d-slab/REGIME-FROZEN"), `${sha}\n`);
      const results = synth().results;
      mkdirSync(join(root, "runs/regime"), { recursive: true });
      writeFileSync(join(root, "runs/regime/RULE.sha256"), `${sha}\n`);
      const file = join(root, "runs/regime/regime-results.json");
      writeFileSync(file, JSON.stringify(asReal(results, "d".repeat(64))));
      const out = join(root, "docs/page.html");
      const logs: string[] = [];
      expect(htmlMain([`--results=${file}`, `--out=${out}`, `--root=${root}`], (s) => logs.push(s))).toBe(2);
      expect(existsSync(out)).toBe(false);
      writeFileSync(file, JSON.stringify(asReal(results, sha)));
      expect(htmlMain([`--results=${file}`, `--out=${out}`, `--root=${root}`], (s) => logs.push(s))).toBe(0);
      expect(readFileSync(out, "utf8")).toContain("<title>Regime meters map</title>");
      expect(logs.join("\n")).toContain("labelled result");
      // both records must carry the rule's hash (the reader and the runner read them the same way): RULE.sha256 alone differing is a refusal too
      writeFileSync(join(root, "runs/regime/RULE.sha256"), `${"2".repeat(64)}\n`);
      expect(htmlMain([`--results=${file}`, `--out=${out}`, `--root=${root}`], () => {})).toBe(2);
      writeFileSync(join(root, "runs/regime/RULE.sha256"), `${sha}\n`);
      expect(htmlMain([`--results=${file}`, `--out=${out}`, `--root=${root}`], () => {})).toBe(0);
      writeFileSync(join(root, "experiments/3d-slab/REGIME-FROZEN"), `${"1".repeat(64)}\n`);
      expect(htmlMain([`--results=${file}`, `--out=${out}`, `--root=${root}`], () => {})).toBe(2);
      expect(htmlMain([], () => {})).toBe(2);
      expect(htmlMain(["--results=x", "--synthetic"], () => {})).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
  it("htmlMain --synthetic --quick builds the labelled page from the reader's own pipeline, and --keep leaves the synthetic jobs where the CLI can read them", () => {
    const root = mkdtempSync(join(tmpdir(), "regime-html-"));
    try {
      const out = join(root, "page.html");
      const logs: string[] = [];
      expect(htmlMain(["--synthetic", "--quick", `--out=${out}`, `--root=${root}`, `--keep=${join(root, "keep")}`], (s) => logs.push(s))).toBe(0);
      expect(logs.join("\n")).toContain("labelled synthetic");
      expect(readFileSync(out, "utf8")).toContain("synthetic: not a result");
      expect(existsSync(join(root, "keep/regime-results.SYNTHETIC.json"))).toBe(true);
      expect(existsSync(join(root, "keep/gate.SYNTHETIC.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 90_000);
  it("--stage0-figures only adds the pilot section: removing the section and its CSS gives the page without the flag, the label stays synthetic, and refusals are unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "regime-html-"));
    try {
      const plain = join(root, "plain.html"), flagged = join(root, "flagged.html");
      const logs: string[] = [];
      expect(htmlMain(["--synthetic", "--quick", `--out=${plain}`], () => {})).toBe(0);
      expect(htmlMain(["--synthetic", "--quick", "--stage0-figures", `--out=${flagged}`], (l) => logs.push(l))).toBe(0);
      expect(logs.join("\n")).toContain("labelled synthetic");
      const a = readFileSync(plain, "utf8");
      let b = readFileSync(flagged, "utf8");
      expect(a).not.toContain('id="stage0"');
      expect(b).toContain("<title>Regime meters map (synthetic)</title>");
      expect(b).toContain("Stage 0 run 1 (pilot, candidate closed)");
      expect(b.indexOf('id="gate"')).toBeLessThan(b.indexOf('id="stage0"'));
      expect(b.indexOf('id="stage0"')).toBeLessThan(b.indexOf('id="map"'));
      const s0 = b.indexOf('<section id="stage0"');
      const s1 = b.indexOf("</section>\n", s0) + "</section>\n".length;
      b = b.slice(0, s0) + b.slice(s1);
      const c0 = b.indexOf("\n.stage0 {");
      const c1 = b.indexOf("</style>");
      b = b.slice(0, c0) + b.slice(c1 - 1);
      // the one other difference: the synthetic banner is scoped to the sections outside the pilot section
      expect(a).toContain("<p>Every number, class and outcome on this page was generated by <code>regime-html.ts --synthetic</code>");
      expect(a).not.toContain("outside the section");
      expect(b).toContain("outside the section");
      const bn0 = b.indexOf('<div class="banner synth"');
      const bn1 = b.indexOf("</div>", bn0) + "</div>".length;
      const an0 = a.indexOf('<div class="banner synth"');
      const an1 = a.indexOf("</div>", an0) + "</div>".length;
      b = b.slice(0, bn0) + a.slice(an0, an1) + b.slice(bn1);
      expect(b).toBe(a);
      // refusals with the flag present: frozen claim without the hash
      mkdirSync(join(root, "experiments/3d-slab"), { recursive: true });
      writeFileSync(join(root, "experiments/3d-slab/regime-rule.md"), "frozen text\n");
      const sha = sha256Hex("frozen text\n");
      writeFileSync(join(root, "experiments/3d-slab/REGIME-FROZEN"), `${sha}\n`);
      mkdirSync(join(root, "runs/regime"), { recursive: true });
      writeFileSync(join(root, "runs/regime/RULE.sha256"), `${sha}\n`);
      const file = join(root, "runs/regime/regime-results.json");
      writeFileSync(file, JSON.stringify(asReal(synth().results, "d".repeat(64))));
      // valid Stage 0 inputs are present, so the only possible reason for exit 2 is the hash refusal
      for (const f of ["regime-stage0-run1-damage.tsv", "m4-results.tsv"]) writeFileSync(join(root, "experiments/3d-slab", f), readFileSync(join(import.meta.dirname, "..", "3d-slab", f)));
      const out = join(root, "docs/page.html");
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(htmlMain([`--results=${file}`, "--stage0-figures", `--out=${out}`, `--root=${root}`], () => {})).toBe(2);
        expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/REFUSED: the results carry rule hash/);
      } finally { err.mockRestore(); }
      expect(existsSync(out)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------------------
describe("what the reader writes besides the string: cards, results JSON, footer, sensitivity", () => {
  const zJob = (z: number, salt = 0): Spec => ({ f: 0.3, banks: { P1: { net: { z, ratioU: 0.1 }, salt } } });
  const zs = (z: number): Spec[] => [zJob(z, 0), zJob(z, 1), zJob(z, 2)];

  it("the example cards: the class job is picked by the plan's rule, and the fallbacks are labelled (plan 8.6 item 2)", () => {
    // ORDERED: the lowest e; CRITICAL: e nearest 0; CHAOTIC: the highest e
    const t = sweep({ [B0_ID]: zs(0.1), "mu30-s8-k256-dA100": zs(-1.4), "mu30-s8-k256-dA240": zs(-1.9), "mu30-s8-k256-dC100": zs(1.5), "mu30-s8-k256-dC240": zs(2.5) });
    const r = read(t);
    const [o, c, x] = r.results.cards;
    expect([o.kind, c.kind, x.kind]).toEqual(["class", "class", "class"]);
    expect(o.id).toMatch(/^slab-mu30-s8-k256-dA(100|240)-seed10\d-t20000-P1-net$/);
    expect(o.jobClass).toBe("ORDERED");
    expect(c.setting).toBe(B0_ID);
    expect(Math.abs(c.e!)).toBeLessThan(0.1);
    expect(x.jobClass).toBe("CHAOTIC");
    expect(o.series!.t.length).toBeGreaterThan(10);
    expect(o.series!.S.length).toBe(o.series!.t.length);
    expect(o.series!.ordN).toBeCloseTo(0.1, 6);
    expect(c.capture).toBeNull();
  });
  it("a card with no job of its class says 'none' and shows the nearest job by e; with no CRITICAL job the one whose s(30) is nearest the band is shown", () => {
    const r = read(sweep({ [B0_ID]: zs(2.4), "mu30-s8-k256-dA100": zs(1.4), "mu30-s8-k256-dA240": zs(2.0) }));
    const [o, c, x] = r.results.cards;
    expect(o).toMatchObject({ kind: "nearest-e", jobClass: "CHAOTIC" });
    expect(o.note).toMatch(/^none: no ORDERED pool job has an e; the pool job with the lowest e is shown$/);
    expect(c.kind).toBe("nearest-band");
    expect(c.setting).toBe("mu30-s8-k256-dA100");
    expect(c.note).toBe("no CRITICAL pool job: the pool job whose s(30) is nearest the band is shown");
    expect(x.kind).toBe("class");
  });
  it("no pool, no cards' jobs: all three read 'none' and carry no series", () => {
    const r = read(sweep({ [B0_ID]: ["CRITICAL", "EXTINCT", "EXTINCT"] }));
    expect(r.results.cards.map((c) => [c.kind, c.id])).toEqual([["none", null], ["none", null], ["none", null]]);
    expect(r.results.cards.every((c) => c.series === null)).toBe(true);
  });
  it("captures are looked up by job id in the captures directory; a card says whether its capture is there", () => {
    const dir = mkdtempSync(join(tmpdir(), "regime-captures-"));
    try {
      const t = sweep({ [B0_ID]: zs(0.1), "mu30-s8-k256-dA100": zs(-1.4), "mu30-s8-k256-dA240": zs(2.4) });
      const bs = bundles(t, ["net"]);
      const first = evaluateSweepJobs(bs, RULE, PASS_GATE, P1NET, { label: "SYNTHETIC", screen: null, capturesDir: dir, sensitivity: false, roster: false });
      expect(first.results.cards.map((c) => c.capture!.present)).toEqual([false, false, false]);
      writeFileSync(join(dir, `${first.results.cards[1].id}.json`), "{}");
      const again = evaluateSweepJobs(bs, RULE, PASS_GATE, P1NET, { label: "SYNTHETIC", screen: null, capturesDir: dir, sensitivity: false, roster: false });
      expect(again.results.cards.map((c) => c.capture!.present)).toEqual([false, true, false]);
      expect(again.md.join("\n")).toContain("Captures to run (about 6 minutes):");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("results JSON: the setting rows the page reads (e, ln s(30), classes, the late check, brackets), the dose curves and the counts", () => {
    const t = sweep({ [B0_ID]: zs(0.1), "mu30-s8-k256-dA100": zs(-1.4), "mu30-s8-k256-dA240": zs(2.4) });
    const r = read([...t, ...late([B0_ID], "CRITICAL")]);
    const res = r.results;
    expect(res.axes.map((a) => a.name)).toEqual(["mu", "sigma", "lightK", "diffA", "diffC", "diffS", "gateK", "dtQ", "spread"]);
    expect(res.axes.find((a) => a.name === "gateK")!.values).toEqual([16, 64, 256, 1024]);
    const b0 = res.settings.find((s) => s.id === B0_ID)!;
    expect(b0).toMatchObject({ status: "WINDOWED", cls: "CRITICAL", target: true, control: false, group: "A", voting: 3, valid: 3 });
    expect(b0.t1).toMatchObject({ status: "AGREES", cls: "CRITICAL" });
    expect(Math.abs(b0.eMed!)).toBeLessThan(0.1);
    expect(Math.abs(b0.lnS30Med!)).toBeLessThan(0.1);
    expect(b0.brackets).toEqual([]);
    expect(b0.jobs.map((j) => j.seed)).toEqual([101, 102, 103]);
    const bracketed = res.settings.find((s) => s.id === "mu30-s8-k256-dA100")!;
    expect(bracketed).toMatchObject({ cls: "ORDERED", target: false });
    expect(res.settings.length).toBe(32);
    expect(res.settings.filter((s) => s.control).map((s) => s.id)).toEqual(["mu30-s8-k256-nomut"]);
    const jobId = b0.jobs[0].id;
    expect(res.curves[jobId].m).toEqual([4, 8, 16]);
    expect(res.curves[jobId].s.length).toBe(3);
    expect(res.curves[jobId].pooled[0]).toBeCloseTo(Math.exp(0.07) * 0.937, 1);
    expect(res.counts).toEqual({ jobs: 12, t0: 9, t1: 3, extension: 0, invalid: 0 });
    expect(res.t1Jobs.length).toBe(3);
    expect(res.combo).toEqual({ rung: "P1", decider: "net" });
    expect(res.gate.pass).toBe(true);
    expect(res.outcome).toMatchObject({ id: "BAND-FOUND", refClass: "CRITICAL", amp: "AMP-ROBUST", fatal: false });
  });

  it("the reading scale ends every outcome string: kick size, macro divergences from the S log and J_g, the dust count and the repro line with its modes (R13 footer)", () => {
    const withM4 = (cls: string, mode: "json" | "tsv-rounded"): Spec[] => [101, 102, 103].map((_, i) => ({ f: 0.3, banks: { P1: { net: REG[cls], salt: i } }, m4: { mode } }));
    const r = read(sweep({ ...ring(["CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "ORDERED"]), [B0_ID]: withM4("CRITICAL", "json"), "mu30-s8-k256-dA100": withM4("CRITICAL", "tsv-rounded") }));
    expect(r.outcomeId).toBe("NO-CONTRAST");
    expect(r.footer).toMatch(/^Reading scale: finite-amplitude response to P1 kicks \(k = 12\), blocks 8x8x8, same noise, decided at step 30, trajectory 100 to 1000\. Macro at step 1000 \(median over the settings named\): living-count divergence \d+\.\d+ percent, biomass divergence \d+\.\d+ percent, genome-set divergence \d+\.\d+ percent\. Jobs that cast no vote because of the dust control: 0 of 27\. repro: 3 of 3 M4 comparisons by exact JSON, 3 by rounded TSV, 24 not applicable\.$/);
  });
  it("every non-fatal sweep outcome string carries the footer in the results; INVALID-RUN carries none (it names no setting)", () => {
    expect(read(sweep({ [B0_ID]: THREE("CHAOTIC") })).footer).toMatch(/^Reading scale: /);
    expect(read(sweep(ring(["CRITICAL", "CRITICAL"])).map((j, i) => (i === 0 ? { ...j, checks: { C3: { ok: false } } } : j))).footer).toBe("");
  });

  it("the sensitivity table: one class letter per setting and per moved constant, ten constants widened and narrowed (R13)", () => {
    const bs = bundles(sweep({ [B0_ID]: THREE("CRITICAL"), "mu30-s8-k256-dA100": THREE("CHAOTIC"), "mu20-s8-k256": THREE("EXTINCT"), "mu40-s8-k256": THREE("CARPET") }), ["net"]);
    const rows = read(sweep({ [B0_ID]: THREE("CRITICAL") })).results.settings.length;
    expect(rows).toBe(32);
    const t0 = bs.filter((b) => b.summary.T === REGIME.T0);
    const base = evaluateSweepJobs(bs, RULE, PASS_GATE, P1NET, { label: "SYNTHETIC", screen: null, capturesDir: null, sensitivity: true, roster: false });
    const md = base.md.join("\n");
    expect(md).toContain("## Sensitivity table (printed, never used)");
    expect(md).toMatch(/\| setting \| base \| D_LO w \| D_LO n \| D_HI w \| D_HI n \| B_LO w \| B_LO n \| B_HI w \| B_HI n \| ORD_R w \| ORD_R n \| SAT w \| SAT n \| R_AMP w \| R_AMP n \| DUST_CLEAR w \| DUST_CLEAR n \| DUST_LIM w \| DUST_LIM n \| SPEED_MIN w \| SPEED_MIN n \|/);
    expect(md).toMatch(/\| mu30-s8-k256 \| C \| (C \| ){19}C \|/);
    expect(md).toMatch(/\| mu20-s8-k256 \| U \| (U \| ){19}U \|/);
    expect(md).toMatch(/\| mu40-s8-k256 \| K \|/);
    expect(t0.length).toBe(12);
  }, 60_000);

  describe("the seed extension (R8.5) is read once, for the SPLIT settings, and only when R10 calls for it (CX-F8, CX-X2)", () => {
    const cls8 = ["CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED", "CHAOTIC", "ORDERED"];
    const split9 = sweepSettings().filter((s) => !s.control && !s.id.startsWith("mu30-s8-k256")).slice(0, 9).map((s) => s.id);
    const SPLIT3: Spec[] = ["ORDERED", "CRITICAL", "CHAOTIC"];
    const base = () => sweep({ ...ring(cls8), ...Object.fromEntries(split9.map((id) => [id, SPLIT3])) });
    /** The jobs at seeds 104 to 106 of the given settings; `classes` are the three seeds' classes. */
    const ext = (ids: string[], classes: string[] = SPLIT3 as string[]): JobFile[] => ids.flatMap((id) => [104, 105, 106].flatMap((seed, i) => synthJob({ world: id, seed, decider: "net", f: 0.3, banks: { P1: { net: REG[classes[i]], salt: seed } } })));
    it("R10 gives UNRESOLVED on seeds 101 to 103 and names the nine extension jobs per SPLIT setting to run", () => {
      const r = read(base());
      expect(r.outcomeId).toBe("UNRESOLVED");
      expect(r.details.join("\n")).toContain(`slab-${split9[0]}-seed104-t20000-P1-net`);
      expect(r.results.outcome.jobIds).toHaveLength(27);
    });
    it("a complete extension is read by the six-seed rule: UNRESOLVED again is UNRESOLVED-FINAL", () => {
      const r = read([...base(), ...ext(split9)]);
      expect(r.outcomeId).toBe("UNRESOLVED-FINAL");
      expect(r.results.counts.extension).toBe(27);
      expect(r.results.settings.find((s) => s.id === split9[0])!.seeds).toEqual([101, 102, 103, 104, 105, 106]);
    });
    it("an extension that resolves the SPLIT settings gives another outcome: the extension is read, not skipped (the nine settings turn ORDERED beside CHAOTIC ones: a bracket)", () => {
      const r = read([...base(), ...ext(split9, ["ORDERED", "ORDERED", "ORDERED"])]);
      expect(r.outcomeId).toBe("CROSSING-BRACKETED");
    });
    it("an extension of one SPLIT setting out of nine is refused (exit 2), naming the 24 jobs still to run: it is not final", () => {
      expect(() => read([...base(), ...ext(split9.slice(0, 1))])).toThrow(/the seed extension \(R8\.5\) is incomplete: 24 job\(s\) missing/);
      try { read([...base(), ...ext(split9.slice(0, 1))]); } catch (e) { expect((e as ReaderError).exit).toBe(2); expect((e as Error).message).toContain(`slab-${split9[1]}-seed104-t20000-P1-net`); }
    });
    it("extension jobs for a setting that was not SPLIT at seeds 101 to 103, or when R10 did not call for the extension, are refused", () => {
      expect(() => read([...base(), ...ext(split9), ...ext([B0_ID])])).toThrow(/extension job\(s\) that R8\.5 does not license.*seed104/);
      const eight = sweep({ ...ring(cls8), ...Object.fromEntries(split9.slice(0, 8).map((id) => [id, SPLIT3])) });
      expect(read(eight).outcomeId).not.toBe("UNRESOLVED");
      expect(() => read([...eight, ...ext(split9.slice(0, 8))])).toThrow(/does not license.*it gave /);
    });
  });

  describe("late-check jobs exist only for LATE0 (R11)", () => {
    it("a T1 job of a setting that is not a target, or of a target beyond the cap, is refused; a missing LATE0 job is PENDING, not a refusal", () => {
      const t0 = sweep(ring(["CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "CRITICAL", "ORDERED", "ORDERED"]));
      expect(read(t0).outcomeId).toBe("PENDING-LATE-CHECK");
      const neighbours = [...NEIGHBOURS.slice(0, 8)].sort();
      const late0 = [B0_ID, ...neighbours].slice(0, 6);
      expect(read([...t0, ...late(late0.slice(0, 2), "CRITICAL")]).outcomeId).toBe("PENDING-LATE-CHECK");
      expect(() => read([...t0, ...late([NEIGHBOURS[9]], "CRITICAL")])).toThrow(/late-check job\(s\) that R11 does not list.*dC240|late-check job/); // an ORDERED setting is not a target
      expect(() => read([...t0, ...late([neighbours[6]], "CRITICAL")])).toThrow(/late-check job\(s\) that R11 does not list/); // the 7th target is beyond the cap
      expect(read([...t0, ...late(late0, "CRITICAL")]).outcomeId).toBe("BAND-FOUND");
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Fixes from the build review (runs/regime/review-build/fix-table.md)

describe("review fixes: a verdict needs the complete, registered roster (CR-F01, CX-F7)", () => {
  /** Job bundles reduced to what the roster check reads (key and file ids): the roster is a property of the file set, not of the analysis. */
  const stubs = (jobs: JobFile[]): JobBundle[] => {
    const m = new Map<string, { key: string; files: JobFile[]; names: string[]; summary: { id: string } }>();
    for (const j of jobs) {
      const key = `${j.kind}|${j.world}|${j.seed}|${j.T}|${j.dev ? "dev" : "main"}`;
      const g = m.get(key) ?? { key, files: [], names: [], summary: { id: j.id.replace(/-P[12]$/, "") } };
      g.files.push(j);
      m.set(key, g);
    }
    return [...m.values()] as unknown as JobBundle[];
  };
  const gateFiles = () => syntheticGateJobs();
  const devFiles = () => syntheticDevJobs();
  const gateRead = (jobs: JobFile[]) => evaluateGateJobs(bundles(jobs, ["net", "occ"]), RULE, P1NET, "SYNTHETIC");
  const devRead = (jobs: JobFile[]) => evaluateDev(bundles(jobs, ["net", "occ"]), 1, RULE, null, "SYNTHETIC");

  it("the gate is 20 jobs in 40 rung files and Stage 0 is 18 jobs in 36 (the 2D worlds at T1 and T2 only); the complete sets pass the check", () => {
    expect(gateFiles()).toHaveLength(40);
    expect(devFiles()).toHaveLength(36);
    expect(checkBundleRoster("gate", stubs(gateFiles()))).toEqual({ missing: [], unexpected: [] });
    expect(gateFiles().filter((j) => j.kind === "2d").every((j) => j.T === REGIME.T1 || j.T === REGIME.T2)).toBe(true);
    expect(gateFiles().filter((j) => j.kind === "2d")).toHaveLength(24);
  });
  it("the synthetic Stage 0 set is the registered roster: 18 jobs (G2 12, G3 3, B0 3), both rungs", () => {
    expect(devFiles().filter((j) => j.role === "B0")).toHaveLength(6);
    expect(devFiles().filter((j) => j.role === "G2")).toHaveLength(24);
    expect(checkBundleRoster("dev", stubs(devFiles()))).toEqual({ missing: [], unexpected: [] });
  });
  it("any one rung file of the gate missing is named: 40 cases, each reports exactly that file", () => {
    const all = gateFiles();
    for (const victim of all) {
      const rep = checkBundleRoster("gate", stubs(all.filter((j) => j !== victim)));
      expect(rep.missing, victim.id).toEqual([victim.id]);
      expect(rep.unexpected).toEqual([]);
    }
  });
  it("the same for Stage 0: any one of its 36 rung files missing is named", () => {
    const all = devFiles();
    for (const victim of all) expect(checkBundleRoster("dev", stubs(all.filter((j) => j !== victim))).missing, victim.id).toEqual([victim.id]);
  });
  it("a job the roster does not list (a fourth gate seed, a gate job at an unlisted time) is reported as unexpected", () => {
    const extra = synthJob({ role: "G3", world: "mu60-s8-k1024", seed: 104, banks: { P1: { net: REG.CHAOTIC }, P2: { net: REG.CHAOTIC } } });
    expect(checkBundleRoster("gate", stubs([...gateFiles(), ...extra])).unexpected).toEqual(["slab-mu60-s8-k1024-seed104-t20000"]);
    const odd = synthJob({ role: "G2", kind: "2d", world: "spots-m3", seed: 101, T: 30000, banks: { P1: { net: REG.CRITICAL }, P2: { net: REG.CRITICAL } } });
    expect(checkBundleRoster("gate", stubs([...gateFiles(), ...odd])).unexpected).toEqual(["2d-spots-m3-seed101-t30000"]);
  });
  it("a 2D reference job at T0 (20,000 steps) is not on the roster: the registered 2D worlds are still filling there, so the reader refuses it in the gate and in Stage 0 (answer G1)", () => {
    const t0 = (dev: boolean, seed: number) => synthJob({ role: "G2", kind: "2d", world: "spots-m3", seed, T: REGIME.T0, dev, f: 0.98, banks: { P1: { net: REG.CRITICAL }, P2: { net: REG.CRITICAL } } });
    expect(checkBundleRoster("gate", stubs([...gateFiles(), ...t0(false, 101)])).unexpected).toEqual(["2d-spots-m3-seed101-t20000"]);
    expect(checkBundleRoster("dev", stubs([...devFiles(), ...t0(true, 9001)])).unexpected).toEqual(["dev-2d-spots-m3-seed9001-t20000"]);
    expect(() => gateRead([...gateFiles(), ...t0(false, 101)])).toThrow(/the roster does not list: 2d-spots-m3-seed101-t20000/);
    // and a gate with the T0 reads in place of the T1 reads is missing twelve jobs, twice
    const swapped = [...gateFiles().filter((j) => !(j.kind === "2d" && j.T === REGIME.T1)), ...["spots-m3", "gradient-m3"].flatMap((w) => [101, 102, 103].flatMap((seed) => synthJob({ role: "G2", kind: "2d", world: w, seed, T: REGIME.T0, banks: { P1: { net: REG.CRITICAL }, P2: { net: REG.CRITICAL } } })))];
    expect(() => gateRead(swapped)).toThrow(/12 job file\(s\) missing: 2d-spots-m3-seed101-t50000-P1/);
  });
  it("evaluateGateJobs refuses (exit 2) a gate that lacks a job, naming it: the case CR-F01 found (seed 103 of the carpet and of spots-m3@50000 removed; it read spots-m3@20000 before the 2D worlds left T0) no longer passes", () => {
    const cut = gateFiles().filter((j) => !(j.seed === 103 && (j.role === "G3" || (j.world === "spots-m3" && j.T === REGIME.T1))));
    expect(() => gateRead(cut)).toThrow(ReaderError);
    try { gateRead(cut); } catch (e) {
      expect((e as ReaderError).exit).toBe(2);
      expect((e as Error).message).toContain("the gate job set is not the registered set of jobs");
      expect((e as Error).message).toContain("4 job file(s) missing");
      expect((e as Error).message).toContain("slab-mu60-s8-k1024-seed103-t20000-P1");
      expect((e as Error).message).toContain("2d-spots-m3-seed103-t50000-P2");
    }
  });
  it("a gate without its G4 jobs, without one rung file of a job, or with an extra job is refused; the complete gate is read", () => {
    expect(() => gateRead(gateFiles().filter((j) => j.role !== "G4"))).toThrow(/4 job file\(s\) missing: slab-mu20-s8-k4096-seed101-t20000-P1/);
    expect(() => gateRead(gateFiles().filter((j) => !(j.id === "2d-gradient-m3-seed102-t100000-P2")))).toThrow(/1 job file\(s\) missing: 2d-gradient-m3-seed102-t100000-P2/);
    expect(() => gateRead([...gateFiles(), ...synthJob({ role: "G4", world: "mu20-s8-k4096", seed: 103, f: 0.02, banks: { P1: { net: REG.CRITICAL }, P2: { net: REG.CRITICAL } } })])).toThrow(/the roster does not list: slab-mu20-s8-k4096-seed103-t20000/);
    expect(gateRead(gateFiles()).gate.pass).toBe(true);
  });
  it("Stage 0 refuses a missing development job, a missing rung file and an extra job, and reads the complete set", () => {
    expect(() => devRead(devFiles().filter((j) => !(j.role === "B0" && j.seed === 9003)))).toThrow(/2 job file\(s\) missing: dev-slab-mu30-s8-k256-seed9003-t20000-P1/);
    expect(() => devRead(devFiles().filter((j) => j.id !== "dev-slab-mu60-s8-k1024-seed9002-t20000-P2"))).toThrow(/1 job file\(s\) missing: dev-slab-mu60-s8-k1024-seed9002-t20000-P2/);
    expect(() => devRead([...devFiles(), ...synthJob({ role: "G3", world: "mu60-s8-k1024", seed: 9004, dev: true, banks: { P1: { net: REG.CHAOTIC }, P2: { net: REG.CHAOTIC } } })])).toThrow(/the roster does not list: dev-slab-mu60-s8-k1024-seed9004-t20000/);
    expect(devRead(devFiles()).text).toContain("STAGE 0 PASS");
  });
  it("assertRoster names at most twelve jobs and counts the rest", () => {
    const missing = Array.from({ length: 30 }, (_, i) => `job-${i}`);
    // the call must refuse (a regression that returned normally would otherwise skip every assertion); then the message is read from the captured error
    let refusal: unknown = null;
    expect(() => { try { assertRoster({ missing, unexpected: [] }, "the test set"); } catch (e) { refusal = e; throw e; } }).toThrow(ReaderError);
    expect((refusal as ReaderError).exit).toBe(2);
    expect((refusal as Error).message).toContain("30 job file(s) missing: job-0, job-1");
    expect((refusal as Error).message).toContain("job-11, and 18 more");
    expect((refusal as Error).message).not.toContain("job-12");
    expect(() => assertRoster({ missing: [], unexpected: [] }, "x")).not.toThrow();
  });

  let cachedFull: ReturnType<typeof syntheticResults> | null = null;
  const full = () => (cachedFull ??= syntheticResults({ sensitivity: false, boot: 20 }));
  const sweepRead = (jobs: JobFile[], extra: Partial<SweepOptions> = {}) =>
    evaluateSweepJobs(bundles(jobs, ["net"]), RULE, full().gate, P1NET, { label: "SYNTHETIC", screen: null, capturesDir: null, sensitivity: false, ...extra });
  it("the sweep: the 96 jobs are read; one job removed, or a setting with two seeds, is refused naming it; the CLI never skips the check", () => {
    const t0 = full().jobs.t0;
    expect(t0).toHaveLength(96);
    expect(checkSweepRoster(bundles(t0, ["net"]), P1NET)).toEqual({ missing: [], unexpected: [] });
    expect(sweepRead(t0).outcomeId).toBe("PENDING-LATE-CHECK");
    const victim = t0.find((j) => j.world === "mu30-s16-k256" && j.seed === 102)!;
    expect(() => sweepRead(t0.filter((j) => j !== victim))).toThrow(/1 job file\(s\) missing: slab-mu30-s16-k256-seed102-t20000-P1-net/);
    expect(() => sweepRead(t0.slice(0, 95))).toThrow(/not the registered set of jobs/);
    expect(() => sweepRead(t0.slice(0, 12))).toThrow(/84 job file\(s\) missing/);
  }, 120_000);
  it("a trimmed sweep must say so: --allow-missing names settings with no job at all (the control first), the readout names them, they read INSUFFICIENT", () => {
    const t0 = full().jobs.t0;
    const CONTROL = "mu30-s8-k256-nomut";
    const cut = t0.filter((j) => j.world !== CONTROL);
    expect(cut).toHaveLength(93);
    expect(() => sweepRead(cut)).toThrow(/3 job file\(s\) missing: slab-mu30-s8-k256-nomut-seed101/);
    const r = sweepRead(cut, { allowMissing: [CONTROL] });
    expect(r.outcomeId).toBe("PENDING-LATE-CHECK");
    expect(r.details[0]).toBe(`Trimmed settings (declared with --allow-missing; no job was run for them, they read INSUFFICIENT): ${CONTROL}.`);
    expect(r.results.trimmed).toEqual([CONTROL]);
    expect(r.results.settings.find((s) => s.id === CONTROL)!).toMatchObject({ cls: "INSUFFICIENT", valid: 0 });
    expect(r.md.join("\n")).toContain(`TRIMMED: ${CONTROL} were not run (declared with --allow-missing)`);
    // only a setting that was not run at all: a setting with jobs, an unknown id, or a setting with two seeds is refused
    expect(() => sweepRead(t0, { allowMissing: [CONTROL] })).toThrow(/only a setting that was not run at all can be left out/);
    expect(() => sweepRead(cut, { allowMissing: ["mu99-s8-k256"] })).toThrow(/not a setting of the catalogue/);
    expect(() => sweepRead(t0.filter((j) => !(j.world === "mu40-s20-k256" && j.seed === 103)), { allowMissing: ["mu40-s20-k256"] })).toThrow(/only a setting that was not run at all/);
    expect(() => sweepRead(t0.filter((j) => !(j.world === "mu40-s20-k256" && j.seed === 103)))).toThrow(/1 job file\(s\) missing: slab-mu40-s20-k256-seed103/);
  }, 120_000);
  it("a T0 job at a seed no stage lists (107) or of another start step is not in the roster", () => {
    const t0 = full().jobs.t0;
    const odd = synthJob({ world: "mu30-s8-k256", seed: 107, decider: "net", f: 0.3, banks: { P1: { net: REG.CRITICAL } } });
    expect(() => sweepRead([...t0, ...odd])).toThrow(/the roster does not list: slab-mu30-s8-k256-seed107-t20000-P1-net/);
  }, 120_000);

  it("--allow-missing is a --sweep option: it parses as a list, and the gate and Stage 0 have no trims", () => {
    expect(parseArgs(["--sweep", "--allow-missing=mu30-s8-k256-nomut, mu30-s8-k1024"]).opts.allowMissing).toEqual(["mu30-s8-k256-nomut", "mu30-s8-k1024"]);
    expect(parseArgs(["--sweep"]).opts.allowMissing).toBeUndefined();
    expect(() => parseArgs(["--gate", "--allow-missing=x"])).toThrow(/only for --sweep/);
    expect(() => parseArgs(["--sweep", "--allow-missing="])).toThrow(/at least one setting id/);
  });
});

describe("review fixes: the rung files of one job carry one set of stamps (CX-F6)", () => {
  const second = (k: "ruleSha" | "codeCommit" | "srcHash") => syntheticGateJobs().map((j) => (j.role === "G3" && j.seed === 101 && j.id.endsWith("-P2") ? { ...j, [k]: "other" } : j));
  it.each(["ruleSha", "codeCommit", "srcHash"] as const)("a second-rung file with another %s makes the gate INVALID-RUN (exit 1, pass false) although the first rung's stamps are the common ones", (k) => {
    const r = evaluateGateJobs(bundles(second(k), ["net", "occ"]), RULE, P1NET, "SYNTHETIC");
    expect(r.exit).toBe(1);
    expect(r.gate.pass).toBe(false);
    expect(r.gate.invalidRun).toBe(true);
    expect(r.gate.text).toContain("slab-mu60-s8-k1024-seed101-t20000 failed C6");
    expect(r.gate.details.some((d) => d.includes(`its rung files carry different ${k}: synthetic and other`))).toBe(true);
  });
  it("rung files that agree (the usual case) and a single-file job are not touched", () => {
    expect(evaluateGateJobs(bundles(syntheticGateJobs(), ["net", "occ"]), RULE, P1NET, "SYNTHETIC").exit).toBe(0);
  });
  it("a missing stamp on one of the rung files is a difference too", () => {
    const jobs = syntheticGateJobs().map((j) => (j.role === "G3" && j.seed === 101 && j.id.endsWith("-P2") ? { ...j, srcHash: undefined } : j));
    const r = evaluateGateJobs(bundles(jobs, ["net", "occ"]), RULE, P1NET, "SYNTHETIC");
    expect(r.gate.invalidRun).toBe(true);
    expect(r.gate.details.some((d) => d.includes("rung files carry different srcHash: synthetic and (missing)"))).toBe(true);
  });
  it("the frozen rule's own checks are unchanged: a file with the wrong ruleSha, a missing codeCommit and an unclean tree each flag the bundle (C6)", () => {
    const SHA = "ab".repeat(32);
    const frozen: RuleInfo = { ...RULE, status: "FROZEN", sha256: SHA };
    const mk = (o: Partial<JobFile>) => bundleJobs(asFiles(synthJob({ world: B0_ID, seed: 101, decider: "net", f: 0.3, banks: { P1: { net: REG.CRITICAL } } }).map((j) => ({ ...j, ruleSha: SHA, ...o }))), ["net"], frozen, FAST)[0];
    expect(mk({}).restamp).toEqual([]);
    expect(mk({}).summary.invalid).toBe(false);
    expect(mk({ ruleSha: "cd".repeat(32) }).restamp[0]).toContain("is not the frozen rule's");
    expect(mk({ codeCommit: undefined }).restamp[0]).toContain("codeCommit or srcHash missing");
    expect(mk({ srcHash: undefined }).restamp[0]).toContain("codeCommit or srcHash missing");
    expect(mk({ treeClean: false }).restamp[0]).toContain("the tree was not clean");
    expect(mk({ treeClean: false }).summary).toMatchObject({ invalid: true, invalidChecks: ["C6"] });
  });
});

describe("review fixes: gate scope, footer and the source note (CR-F11, CR-F14, CX-F18)", () => {
  it("G4 is informational: a G4 job whose check failed makes the run INVALID (R10.1) and shows G4 as not holding; a clean G4 holds; none of it decides G1 to G7", () => {
    const ok = evaluateGateJobs(GATE_BASE, RULE, P1NET, "SYNTHETIC");
    expect(ok.gate.conditions.find((c) => c.id === "G4")).toMatchObject({ holds: true, info: true });
    const bad = syntheticGateJobs({ job: (c) => (c.role === "G4" && c.seed === 102 ? { checks: { C7: { ok: false, detail: "17 against 18" } } } : undefined), touchedOnly: true });
    const r = evaluateGateJobs(withFresh(GATE_BASE, bad), RULE, P1NET, "SYNTHETIC");
    expect(r.gate.conditions.find((c) => c.id === "G4")).toMatchObject({ holds: false, info: true });
    expect(r.exit).toBe(1);
    expect(r.gate.pass).toBe(false);
    expect(r.gate.text).toBe("INVALID RUN: slab-mu20-s8-k4096-seed102-t20000 failed C7. No outcome. Fix the cause and rerun those jobs.");
    // the decisions of G1 to G7 are those of the jobs that decide: G4 changes none of them
    expect(r.gate.conditions.filter((c) => !["G4", "G5"].includes(c.id) && c.holds !== null).every((c) => c.holds === ok.gate.conditions.find((o) => o.id === c.id)!.holds)).toBe(true);
  });
  it("a passing gate file without a refClass or an amplitude label is refused by the sweep (R9.5)", () => {
    expect(() => checkGateFile({ ...PASS_GATE, refClass: null }, RULE, P1NET)).toThrow(/passes but holds no refClass or amplitude label/);
    expect(() => checkGateFile({ ...PASS_GATE, amp: null }, RULE, P1NET)).toThrow(/passes but holds no refClass or amplitude label/);
    expect(() => checkGateFile({ ...PASS_GATE, ruleSha: RULE.sha256 }, RULE, P1NET)).not.toThrow();
    // a failed gate is the outcome, not a refusal
    expect(() => checkGateFile({ ...PASS_GATE, ruleSha: RULE.sha256, pass: false, refClass: null, amp: null }, RULE, P1NET)).not.toThrow();
  });
  it("the footer counts the jobs that cast no vote because of the dust control: a MIXED job is a valid job with a class that is not one of the three, and is not counted", () => {
    const limited: Spec = { f: 0.3, banks: { P1: { net: { ...REG.CRITICAL, ratioU: 0.7 }, salt: 5 } } };
    const bs = bundles(sweep({ [B0_ID]: ["MIXED", limited, "CRITICAL"] }), ["net"]);
    expect(footerLine(bs, bs, P1NET)).toContain("Jobs that cast no vote because of the dust control: 1 of 3.");
  });
  it("R14 row 115 (final review F4): the gate footer reads the file run under the selected rung: with (P2, net) selected it prints the P2 bank's k and divergences, not P1's, whatever the order of the two rung files", () => {
    // P1 bank: k = 12, no living-count divergence, genome-set divergence 10 percent. P2 bank: k = 24, living-count divergence 100 percent, genome-set divergence 90 percent.
    const forRung = (f: JobFile): JobFile => {
      if (!f.bank) return f;
      const p2 = f.bank.rung === "P2";
      const S = f.bank.S && { ...f.bank.S, log: { ...f.bank.S.log, live_X: f.bank.S.log.live_R.map((v) => (p2 ? 2 * v : v)) } as DiffLog };
      return { ...f, divergence: { ...f.divergence, "1000": { Jid: 0.5, Jg: p2 ? 0.9 : 0.1, ngdiff: 1 } } as JobFile["divergence"], bank: { ...f.bank, k: p2 ? 24 : 12, S } as TwinBank };
    };
    const asym = (flip: boolean): JobBundle[] => GATE_BASE.map((b) => ({ ...b, files: (flip ? [...b.files].reverse() : b.files).map(forRung) }));
    expect(asym(false).filter((b) => b.files.length === 2).every((b) => b.files[0].id.endsWith("-P1") && b.files[1].id.endsWith("-P2"))).toBe(true); // the first file of a gate bundle is P1's
    expect(asym(true).filter((b) => b.files.length === 2).every((b) => b.files[0].id.endsWith("-P2"))).toBe(true);
    const P2NET: Combination = { rung: "P2", decider: "net" };
    const read = (flip: boolean, combo: Combination) => evaluateGateJobs(asym(flip), RULE, combo, "SYNTHETIC");
    const p2 = read(false, P2NET);
    expect(p2.gate.pass).toBe(true);
    expect(p2.gate.footer).toContain("finite-amplitude response to P2 kicks (k = 24)");
    expect(p2.gate.footer).toContain("living-count divergence 100.00 percent");
    expect(p2.gate.footer).toContain("genome-set divergence 90.00 percent");
    expect(read(true, P2NET).gate.footer).toBe(p2.gate.footer); // file order changes nothing
    const p1 = read(false, P1NET);
    expect(p1.gate.pass).toBe(true);
    expect(p1.gate.footer).toContain("finite-amplitude response to P1 kicks (k = 12)");
    expect(p1.gate.footer).toContain("living-count divergence 0.00 percent");
    expect(p1.gate.footer).toContain("genome-set divergence 10.00 percent");
    expect(read(true, P1NET).gate.footer).toBe(p1.gate.footer);
    // and the footer function itself, on the bundles a gate names
    const bs = asym(true);
    expect(footerLine(bs, bs, P2NET)).toContain("(k = 24)");
    expect(footerLine(bs, bs, P1NET)).toContain("(k = 12)");
  });
  it("the footer's macro divergences are those at step 1000, not 300", () => {
    const jobs = sweep({ [B0_ID]: ["CRITICAL"] }).map((j) => structuredClone(j));
    const L = jobs[0].bank!.S!.log;
    L.live_X[1000] = Math.round(L.live_R[1000] * 1.5);
    L.live_X[300] = Math.round(L.live_R[300] * 1.1);
    const bs = bundles(jobs, ["net"]);
    expect(footerLine(bs, bs, P1NET)).toMatch(/living-count divergence 50\.00 percent/);
  });
  it("the sweep notes, without refusing, that its jobs carry another codeCommit or srcHash than the gate's; equal stamps print nothing", () => {
    const jobs = sweep(ring(["CRITICAL"]));
    const same = read(jobs);
    expect(same.details.join("\n")).not.toContain("the instrument changed between the gate and the sweep");
    expect(same.results.sourceChanged).toBe(false);
    const changed = read(jobs, gateWith({ stamps: { ruleSha: ["synthetic"], codeCommit: ["c1"], srcHash: ["s1"] } }));
    expect(changed.results.sourceChanged).toBe(true);
    expect(changed.exit).toBe(0);
    expect(changed.details.join("\n")).toContain("the instrument changed between the gate and the sweep");
    expect(changed.details.join("\n")).toContain("codeCommit synthetic and srcHash synthetic, the gate jobs c1 and s1");
  });
});
