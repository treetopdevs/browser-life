// Mycelium rung R3 (tools/mycelium/r3-*.ts): the seed embargo, the arms, the run gate, the freeze checks, the readouts at zero trail, the trend
// statistic, and the three labels (PASS, FAIL, INCONCLUSIVE) reachable on synthetic data. Pure functions only: no test here runs a protocol
// seed or touches the real seed log, FROZEN or CALIBRATION.json.
import { describe, expect, it } from "vitest";
import { createWorld, defaultConfig, validateConfig } from "../mycelium/world.ts";
import { emptySeries, type R2bSeries } from "../mycelium/observe-r2b.ts";
import { R2B_WORLD_SEEDS, R2_SEEDS } from "../mycelium/r2b-seeds.ts";
import { FRESH_MIN, gateRun as r2GateRun } from "../mycelium/r2-protocol.ts";
import {
  ARM_DELTA, armConfig, armCost, checkCalibrationForConfirm, cpuCheckProblems, checkFrozen, fileHashProblem, gateRun, logProblems, manifestText, pendingConfirm, R3, R3_ARMS, R3_ENTRY_FILES, type SeedLogEntry,
} from "../mycelium/r3-protocol.ts";
import {
  NOT_R3_SLOTS, R2B_EMBARGOED_SLOTS, R3_ARM_OFFSET, R3_CONFIRM_ARMS, R3_CONFIRM_SLOTS, R3_DEV_ARMS, R3_DEV_SLOTS, R3_WORLD_SEEDS, r3EmbargoReason, worldSeed,
} from "../mycelium/r3-seeds.ts";
import {
  decide, doseScores, flipLabels, frozenRead, gScore, planted, readoutsOf, readoutsOfWindows, resample, runTests, type RunReadout, shuffleLabels, trendPermutationP, trendTau,
} from "../mycelium/r3-decide.ts";
import { cliffsDelta } from "../mycelium/r2b-stats.ts";

const FAST = { perms: 4000, trendPerms: 4000 };

// ---- seeds -------------------------------------------------------------------------------------------------

describe("R3 seeds and the embargo", () => {
  it("every R3 world seed is at least 60,000, so run.ts (below 9001) and r2.ts (9001-9005 only) already refuse them", () => {
    for (const s of R3_WORLD_SEEDS) {
      expect(s).toBeGreaterThanOrEqual(60_000);
      expect(s).toBeGreaterThanOrEqual(FRESH_MIN);
      // r2.ts's own gate refuses every non-fresh-set seed outside confirm, and takes only 9001-9005 in confirm.
      expect(r2GateRun({ phase: "dev", arm: "inherit", seed: s, steps: 20_000 }, []).length).toBeGreaterThan(0);
      expect(r2GateRun({ phase: "confirm", arm: "inherit", seed: s, steps: 20_000 }, []).some((p) => /9001-9005/.test(p))).toBe(true);
    }
  });

  it("collides with nothing: not an R2b world seed, an R2 seed, an embargoed R2b slot or a reserved 8001-8099 slot", () => {
    const mine = new Set<number>(R3_WORLD_SEEDS);
    expect(mine.size).toBe(R3_WORLD_SEEDS.length);
    for (const s of R3_WORLD_SEEDS) {
      expect(R2B_WORLD_SEEDS).not.toContain(s);
      expect(R2_SEEDS).not.toContain(s);
      expect(NOT_R3_SLOTS).not.toContain(s);
    }
    // The registered counts: 5 dev arms x 10 slots and 7 arms x 16 slots.
    expect(R3_WORLD_SEEDS.length).toBe(5 * 10 + 7 * 16);
    // No R3 slot is an R2b confirmation slot or a reserved one.
    for (const s of [...R3_DEV_SLOTS, ...R3_CONFIRM_SLOTS]) { expect(R2B_EMBARGOED_SLOTS).not.toContain(s); expect(NOT_R3_SLOTS).not.toContain(s); }
    expect(Math.min(...R3_CONFIRM_SLOTS)).toBe(6001);
    expect(Math.max(...R3_CONFIRM_SLOTS)).toBe(6016);
  });

  it("the embargo names a registered world and nothing else", () => {
    expect(r3EmbargoReason(worldSeed("inherit-c4", 6003))).toMatch(/belongs to R3/);
    expect(r3EmbargoReason(worldSeed("frozen", 2001))).toMatch(/belongs to R3/);
    expect(r3EmbargoReason(60_001)).toBeNull(); // a smoke world
    expect(r3EmbargoReason(2001)).toBeNull();
  });

  it("the offsets are distinct multiples of 10,000", () => {
    const o = Object.values(R3_ARM_OFFSET);
    expect(new Set(o).size).toBe(o.length);
    for (const v of o) expect(v % 10_000).toBe(0);
  });
});

// ---- arms -------------------------------------------------------------------------------------------------

describe("R3 arms", () => {
  it("armConfig is defaultConfig plus the delta and the offset seed, with existing keys only", () => {
    expect(armConfig("inherit", 6001)).toEqual(defaultConfig({ seed: 66_001 }));
    expect(armConfig("inherit-c4", 6001)).toEqual(defaultConfig({ depositCost: 4, seed: 96_001 + 10_000 }));
    expect(armConfig("blocked-c1", 6002)).toEqual(defaultConfig({ heredity: "blocked", depositCost: 1, seed: 116_002 }));
    for (const arm of R3_ARMS) {
      const c = armConfig(arm, 2001);
      expect(validateConfig(c)).toEqual([]);
      expect(() => createWorld(c)).not.toThrow();
      for (const k of Object.keys(ARM_DELTA[arm])) expect(k in defaultConfig()).toBe(true);
    }
    expect(defaultConfig().depositCost).toBe(2);
    expect([armCost("inherit"), armCost("inherit-c1"), armCost("blocked-c4")]).toEqual([2, 1, 4]);
    expect("depositCost" in ARM_DELTA.inherit).toBe(false);
  });

  it("defaultConfig() is untouched (no R3 key appears in it)", () => {
    const keys = Object.keys(defaultConfig());
    for (const k of ["controller", "physarumDeposit", "blindTrailGradient"]) expect(keys).not.toContain(k);
  });
});

// ---- the run gate and the log --------------------------------------------------------------------------------

const entry = (phase: SeedLogEntry["phase"], arm: string, seed: number, state: SeedLogEntry["state"] = "finished", extra: Partial<SeedLogEntry> = {}): SeedLogEntry => ({ phase, arm, seed, steps: R3.STEPS, state, ...extra });

describe("R3 run gate", () => {
  it("dev runs the five new arms on 2001-2010 at 100,000 steps only", () => {
    expect(gateRun({ phase: "dev", arm: "frozen", seed: 2001, steps: R3.STEPS }, [])).toEqual([]);
    expect(gateRun({ phase: "dev", arm: "inherit", seed: 2001, steps: R3.STEPS }, []).join()).toMatch(/reuse R2b/);
    expect(gateRun({ phase: "dev", arm: "frozen", seed: 2011, steps: R3.STEPS }, []).length).toBeGreaterThan(0);
    expect(gateRun({ phase: "dev", arm: "frozen", seed: 6001, steps: R3.STEPS }, []).length).toBeGreaterThan(0);
    expect(gateRun({ phase: "dev", arm: "frozen", seed: 2001, steps: 50_000 }, []).length).toBeGreaterThan(0);
  });

  it("confirm runs the seven arms on 6001-6016, never twice", () => {
    expect(gateRun({ phase: "confirm", arm: "inherit-c1", seed: 6016, steps: R3.STEPS }, [])).toEqual([]);
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 6017, steps: R3.STEPS }, []).length).toBeGreaterThan(0);
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 2001, steps: R3.STEPS }, []).length).toBeGreaterThan(0);
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 6001, steps: R3.STEPS }, [entry("confirm", "inherit", 6001)]).join()).toMatch(/never repeated/);
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 6001, steps: R3.STEPS, seriesExists: true }, [entry("confirm", "inherit", 6001, "started")]).join()).toMatch(/no finished entry/);
  });

  it("refuses R2b's embargoed slots and the reserved 8001-8099 in every phase", () => {
    for (const phase of ["smoke", "dev", "confirm", "cpu-check"] as const) {
      expect(gateRun({ phase, arm: "inherit", seed: 5001, steps: R3.STEPS }, []).join()).toMatch(/R2b's embargoed/);
      expect(gateRun({ phase, arm: "inherit", seed: 8050, steps: R3.STEPS }, []).join()).toMatch(/another exploration/);
    }
  });

  it("smoke takes slots 1-100 and short multiples of 1000; cpu-check takes dev-arm and confirmation runs only", () => {
    expect(gateRun({ phase: "smoke", arm: "frozen", seed: 7, steps: 3000 }, [])).toEqual([]);
    expect(gateRun({ phase: "smoke", arm: "frozen", seed: 2001, steps: 3000 }, []).length).toBeGreaterThan(0);
    expect(gateRun({ phase: "smoke", arm: "frozen", seed: 7, steps: 2500 }, []).length).toBeGreaterThan(0);
    expect(gateRun({ phase: "cpu-check", arm: "inherit-c4", seed: 6004, steps: R3.STEPS }, [])).toEqual([]);
    expect(gateRun({ phase: "cpu-check", arm: "inherit", seed: 2004, steps: R3.STEPS }, []).length).toBeGreaterThan(0);
  });

  it("a log with a leak, an invalid entry or an unregistered slot stops every logged phase", () => {
    expect(logProblems([entry("dev", "frozen", 2001, "started"), entry("dev", "frozen", 2001)])).toEqual([]);
    expect(logProblems([entry("dev", "frozen", 6001)]).join()).toMatch(/embargo is broken/);
    expect(logProblems([entry("confirm", "frozen", 6001, "invalid")]).join()).toMatch(/invalid run/);
    expect(logProblems([entry("dev", "frozen", 77)]).join()).toMatch(/outside the registered/);
    expect(gateRun({ phase: "dev", arm: "frozen", seed: 2001, steps: R3.STEPS }, [entry("confirm", "inherit", 6001, "invalid")]).length).toBeGreaterThan(0);
  });

  it("the log refuses a repeated finished entry and a finished entry with no started entry", () => {
    expect(logProblems([entry("confirm", "inherit", 6001, "started"), entry("confirm", "inherit", 6001, "started"), entry("confirm", "inherit", 6001, "finished")])).toEqual([]);
    expect(logProblems([entry("confirm", "inherit", 6001, "started"), entry("confirm", "inherit", 6001), entry("confirm", "inherit", 6001)]).join()).toMatch(/more than one finished/);
    expect(logProblems([entry("dev", "frozen", 2001)]).join()).toMatch(/no started entry/);
  });

  it("the CPU cross-check is an acceptance gate: finished, equal digests, the run's digest, the frozen code", () => {
    const log = [entry("cpu-check", "frozen", 2003, "started"), entry("cpu-check", "frozen", 2003)];
    const good = { "frozen/2003": { equal: true, gpuDigest: "d", runDigest: "d", codeHash: "c" } };
    expect(cpuCheckProblems("dev", log, "c", good)).toEqual([]);
    expect(cpuCheckProblems("dev", [], "c", {}).join()).toMatch(/no finished cpu-check/);
    expect(cpuCheckProblems("confirm", log, "c", good).join()).toMatch(/no finished cpu-check/);
    expect(cpuCheckProblems("dev", log, "c", { "frozen/2003": { ...good["frozen/2003"], equal: false } }).join()).toMatch(/equal digests/);
    expect(cpuCheckProblems("dev", log, "c", { "frozen/2003": { ...good["frozen/2003"], runDigest: "x" } }).length).toBe(1);
    expect(cpuCheckProblems("dev", log, "other", good).length).toBe(1);
    expect(cpuCheckProblems("dev", log, "c", { "frozen/2003": null }).length).toBe(1);
  });

  it("the file hash must equal the finished entry's, and pendingConfirm resumes in fixed order", () => {
    const log = [entry("confirm", "inherit", 6001, "finished", { fileSha256: "a".repeat(64) })];
    expect(fileHashProblem(log, "confirm", "inherit", 6001, "a".repeat(64))).toBeNull();
    expect(fileHashProblem(log, "confirm", "inherit", 6001, "b".repeat(64))).toMatch(/not the file/);
    expect(fileHashProblem(log, "confirm", "inherit", 6002, "a".repeat(64))).toMatch(/no finished entry/);
    const p = pendingConfirm(log);
    expect(p.length).toBe(7 * 16 - 1);
    expect(p[0]).toEqual({ arm: "inherit", seed: 6002 });
    expect(pendingConfirm([]).length).toBe(112);
  });
});

// ---- freeze ---------------------------------------------------------------------------------------------------

describe("R3 freeze checks", () => {
  const files = { "tools/mycelium/world.ts": "1".repeat(64), "tools/mycelium/r3.ts": "2".repeat(64) };
  const hashes = { protocol: "p".repeat(0) + "3".repeat(64), code: "4".repeat(64), files, calibration: "5".repeat(64) };
  const frozen1 = `protocol_sha256: ${hashes.protocol}\ncode_hash: ${hashes.code}\n${manifestText(files)}`;
  it("Freeze 1 passes on matching hashes and fails on any difference", () => {
    expect(checkFrozen("dev", frozen1, hashes)).toEqual([]);
    expect(checkFrozen("dev", null, hashes).join()).toMatch(/Freeze 1/);
    expect(checkFrozen("dev", frozen1, { ...hashes, protocol: "9".repeat(64) }).join()).toMatch(/PROTOCOL.md differs/);
    expect(checkFrozen("dev", frozen1, { ...hashes, code: "9".repeat(64) }).join()).toMatch(/code differs/);
    expect(checkFrozen("dev", frozen1, { ...hashes, files: { ...files, "tools/mycelium/world.ts": "8".repeat(64) } }).join()).toMatch(/world.ts changed/);
    expect(checkFrozen("dev", frozen1, { ...hashes, files: { ...files, "tools/mycelium/new.ts": "8".repeat(64) } }).join()).toMatch(/new.ts not listed/);
    expect(checkFrozen("smoke", null, hashes)).toEqual([]);
  });
  it("Freeze 2 (confirm) also needs calibration_sha256 equal to CALIBRATION.json", () => {
    expect(checkFrozen("confirm", frozen1, hashes).join()).toMatch(/Freeze 2 is missing/);
    expect(checkFrozen("confirm", `${frozen1}calibration_sha256: ${hashes.calibration}\n`, hashes)).toEqual([]);
    expect(checkFrozen("confirm", `${frozen1}calibration_sha256: ${"6".repeat(64)}\n`, hashes).join()).toMatch(/CALIBRATION.json differs/);
    expect(checkFrozen("confirm", `${frozen1}calibration_sha256: ${hashes.calibration}\n${"calibration_sha256: " + hashes.calibration}\n`, hashes).join()).toMatch(/repeats/);
  });
  it("a calibration that is not READY, or was made under other code, refuses confirmation", () => {
    const f = { code_hash: "c", protocol_sha256: "p" };
    expect(checkCalibrationForConfirm({ codeHash: "c", protocolSha256: "p", verdict: "READY" }, f)).toEqual([]);
    expect(checkCalibrationForConfirm({ codeHash: "c", protocolSha256: "p", verdict: "MEASUREMENT-LIMITED", reasons: ["x"] }, f).join()).toMatch(/not READY/);
    expect(checkCalibrationForConfirm({ codeHash: "d", protocolSha256: "p", verdict: "READY" }, f).join()).toMatch(/made under code/);
  });
  it("the entry files name r3.ts, r3-analyze.ts and r3-freeze.ts", () => {
    expect([...R3_ENTRY_FILES]).toEqual(["tools/mycelium/r3.ts", "tools/mycelium/r3-analyze.ts", "tools/mycelium/r3-freeze.ts"]);
  });
});

// ---- readouts at zero ---------------------------------------------------------------------------------------------

function seriesWith(sumP: (t: number) => number, n: (t: number) => number, d: (t: number) => number): R2bSeries {
  const s = emptySeries();
  for (let t = 100; t <= 100_000; t += 100) { s.scalar.step.push(t); s.scalar.n.push(n(t)); s.scalar.births.push(t); s.scalar.refused.push(0); s.scalar.sumP.push(sumP(t)); }
  for (let t = 500; t <= 100_000; t += 500) {
    s.heavy.step.push(t); s.heavy.n.push(n(t)); s.heavy.sumP.push(sumP(t)); s.heavy.moran.push(0); s.heavy.moranInvalid.push(1); s.heavy.medianAge.push(100); s.heavy.sig.push(0.5);
    s.heavy.d.push(d(t)); s.heavy.meanM.push(10); s.heavy.meanE.push(10); s.heavy.genotypes.push(10);
  }
  return s;
}

describe("R3 readouts", () => {
  it("are defined and finite at zero trail", () => {
    const r = readoutsOf("inherit", 6001, seriesWith(() => 0, () => 5000, () => 0));
    expect(r).toEqual({ arm: "inherit", slot: 6001, dE: 0, dL: 0, tmE: 0, tmL: 0, guard: false });
    expect(gScore(r.dE, r.dL)).toBe(-1); // no deposit remains: the limit along dL = 0
  });
  it("use the window means: early (0, 5,000], late (50,000, 100,000]", () => {
    const r = readoutsOf("blocked", 6001, seriesWith((t) => (t <= 5000 ? 10_000 : 5_000), () => 5000, (t) => (t <= 5000 ? 0.1 : 0.02)));
    expect(r.dE).toBeCloseTo(0.1, 12); expect(r.dL).toBeCloseTo(0.02, 12);
    expect(r.tmE).toBeCloseTo(2, 12); expect(r.tmL).toBeCloseTo(1, 12);
  });
  it("flag the guard when n < 200 at any scalar census of either window, and count n = 0 as zero trail", () => {
    expect(readoutsOf("inherit", 1, seriesWith(() => 100, (t) => (t === 70_000 ? 150 : 5000), () => 0.1)).guard).toBe(true);
    expect(readoutsOf("inherit", 1, seriesWith(() => 100, (t) => (t === 20_000 ? 100 : 5000), () => 0.1)).guard).toBe(false); // outside both windows
    const z = readoutsOf("inherit", 1, seriesWith(() => 0, () => 0, () => 0));
    expect(z.guard).toBe(true); expect(z.tmL).toBe(0);
  });
  it("readoutsOfWindows takes explicit windows (a smoke run)", () => {
    const r = readoutsOfWindows("inherit", 1, seriesWith(() => 100, () => 1000, () => 0.5), 0, 2500, 5000, 10_000);
    expect(r.dE).toBe(0.5);
  });
  it("g is bounded in [-1, 1], 0/0 is -1 (the limit along dL = 0), and a pure decline is -1", () => {
    expect(gScore(0, 0)).toBe(-1);
    expect(gScore(1e-300, 0)).toBe(-1);
    expect(gScore(1, 0)).toBe(-1);
    expect(gScore(0, 1)).toBe(1);
    expect(gScore(0.1, 0.1)).toBe(0);
    for (const [a, b] of [[0.03, 0.02], [1e-9, 5], [7, 7e-12]]) expect(Math.abs(gScore(a, b))).toBeLessThanOrEqual(1);
  });
});

// ---- the trend statistic ----------------------------------------------------------------------------------------

describe("trend statistic", () => {
  it("is +1 when every lower-cost value is above every higher-cost value, -1 reversed, 0 on equal groups", () => {
    expect(trendTau([[9, 8], [5, 4], [2, 1]])).toBe(1);
    expect(trendTau([[1, 2], [4, 5], [8, 9]])).toBe(-1);
    expect(trendTau([[1, 1], [1, 1], [1, 1]])).toBe(0);
    expect(trendTau([[3, 1], [3, 1]])).toBe(0);
  });
  it("matches the mean pairwise Cliff's delta", () => {
    const g = [[5, 3, 3, 8], [4, 4, 1], [2, 6, 0, 0]];
    expect(trendTau(g)).toBeCloseTo((cliffsDelta(g[0], g[1]) + cliffsDelta(g[0], g[2]) + cliffsDelta(g[1], g[2])) / 3, 12);
  });
  it("the permutation p is small for a clear trend, large for none, and deterministic", () => {
    const clear = trendPermutationP([[9, 8, 7, 6, 9.5], [5, 4, 3, 5.5, 4.5], [2, 1, 0.5, 1.5, 2.5]], 20_000);
    expect(clear.tau).toBeGreaterThan(0.9);
    expect(clear.p).toBeLessThan(0.001);
    const none = trendPermutationP([[1, 5, 3, 8, 2], [4, 9, 0, 7, 6], [3, 2, 8, 1, 5]], 20_000);
    expect(none.p).toBeGreaterThan(0.2);
    expect(trendPermutationP([[1, 2, 3], [4, 5, 6], [7, 8, 9]], 3000)).toEqual(trendPermutationP([[1, 2, 3], [4, 5, 6], [7, 8, 9]], 3000));
  });
  it("on tied-at-zero data the effect is 0 (a floor tie is no evidence either way)", () => {
    const r = trendPermutationP([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], 2000);
    expect(r.tau).toBe(0);
    expect(r.p).toBe(1);
  });
});

// ---- the label --------------------------------------------------------------------------------------------------

/** A tiny deterministic generator for synthetic readouts (a spread over about a factor of 40, like the dev inherit values). */
function lcg(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }

interface Scale { dE: number; dL: number }
/** One arm: n runs whose dE and dL are `scale` times a spread factor; tm follows d times 100 (so tm concordance mirrors d). */
function armRuns(arm: RunReadout["arm"], n: number, scale: Scale, rnd: () => number, guard = false): RunReadout[] {
  return Array.from({ length: n }, (_, i) => {
    const f = Math.exp((rnd() - 0.5) * 2.4), h = Math.exp((rnd() - 0.5) * 0.4);
    const dE = scale.dE * f, dL = scale.dL * h * (scale.dL < 1e-3 ? rnd() : 1);
    return { arm, slot: 6001 + i, dE, dL, tmE: dE * 100, tmL: dL * 100, guard: guard && i === 0 };
  });
}

/** The predicted structure: inherit far below blocked late, falling relatively more, with early deposit that rises at cost 1 and falls at cost 4. */
function predicted(n: number, seed: number, fold = 4): RunReadout[] {
  const r = lcg(seed);
  return [
    ...armRuns("inherit", n, { dE: 0.04, dL: 0.0005 }, r), ...armRuns("blocked", n, { dE: 0.09, dL: 0.021 }, r),
    ...armRuns("frozen", n, { dE: 0.06, dL: 0.004 }, r),
    ...armRuns("inherit-c1", n, { dE: 0.04 * fold, dL: 0.002 }, r), ...armRuns("blocked-c1", n, { dE: 0.09 * 1.2, dL: 0.03 }, r),
    ...armRuns("inherit-c4", n, { dE: 0.04 / fold, dL: 0.0001 }, r), ...armRuns("blocked-c4", n, { dE: 0.09 * 0.7, dL: 0.012 }, r),
  ];
}

describe("the label is reachable in every direction", () => {
  it("PASS: the predicted structure at n = 16 gives PASS", () => {
    const d = decide(predicted(16, 1), FAST);
    expect(d.tests.map((t) => t.verdict)).toEqual(["SUPPORT", "SUPPORT", "SUPPORT"]);
    expect(d.tmConcordance.ok).toBe(true);
    expect(d.label).toBe("PASS");
  });
  it("FAIL: the same data with inherit and blocked swapped gives FAIL (every test contradicts)", () => {
    const d = decide(flipLabels(predicted(16, 1)), FAST);
    expect(d.label).toBe("FAIL");
    expect(d.tests.map((t) => t.verdict)).toEqual(["CONTRADICT", "CONTRADICT", "CONTRADICT"]);
  });
  it("INCONCLUSIVE: no arm effect (inherit and blocked dealt at random) gives INCONCLUSIVE across many deals", () => {
    const base = predicted(16, 3);
    const labels = Array.from({ length: 30 }, (_, k) => decide(shuffleLabels(base, 500 + k), FAST).label);
    expect(labels.filter((l) => l === "PASS").length).toBe(0);
    expect(labels.filter((l) => l === "INCONCLUSIVE").length).toBeGreaterThanOrEqual(26);
  });
  it("INCONCLUSIVE: D1 and D2 supported but no dose response (the cost arms alike) is not a PASS", () => {
    const r = lcg(9);
    const runs = [
      ...armRuns("inherit", 16, { dE: 0.04, dL: 0.0005 }, r), ...armRuns("blocked", 16, { dE: 0.09, dL: 0.021 }, r),
      ...armRuns("inherit-c1", 16, { dE: 0.04, dL: 0.0005 }, r), ...armRuns("blocked-c1", 16, { dE: 0.09, dL: 0.021 }, r),
      ...armRuns("inherit-c4", 16, { dE: 0.04, dL: 0.0005 }, r), ...armRuns("blocked-c4", 16, { dE: 0.09, dL: 0.021 }, r),
    ];
    const d = decide(runs, FAST);
    expect(d.tests[0].verdict).toBe("SUPPORT");
    expect(d.tests[1].verdict).toBe("SUPPORT");
    expect(d.tests[2].verdict).not.toBe("SUPPORT");
    expect(d.label).not.toBe("PASS");
  });
  it("INCONCLUSIVE: a floor tie (inherit dL = 0 in the cost arms too) cannot fail D3 and cannot pass it", () => {
    // The inherit cost arms never deposit in E (every dose score is 0): D3 reads nothing. D1 and D2 are untouched.
    const base = predicted(16, 4).map((r) => (r.arm === "inherit-c1" || r.arm === "inherit-c4" ? { ...r, dE: 0, dL: 0 } : r));
    const d = decide(base, FAST);
    expect(d.tests[0].verdict).toBe("SUPPORT");
    expect(d.tests[1].verdict).toBe("SUPPORT");
    expect(d.tests[2].effect).toBe(0);
    expect(d.tests[2].verdict).toBe("NULL");
    expect(d.label).toBe("INCONCLUSIVE");
  });
  it("PASS needs C1: the same structure with the stock readout in the wrong direction is INCONCLUSIVE", () => {
    const d = decide(predicted(16, 1).map((r) => (r.arm === "inherit" ? { ...r, tmL: 10 } : r)), FAST);
    expect(d.tests.every((t) => t.verdict === "SUPPORT")).toBe(true);
    expect(d.tmConcordance.ok).toBe(false);
    expect(d.label).toBe("INCONCLUSIVE");
  });
  it("D3 is NULL (not an error) when a blocked baseline is 0 or a cost group is missing", () => {
    const noC1 = predicted(16, 1).filter((r) => !r.arm.endsWith("c1"));
    const t = runTests(noC1, FAST);
    expect(t[2].verdict).toBe("NULL");
    expect(t[2].note).toMatch(/cost 1|fewer than 3/);
    expect(decide(noC1, FAST).label).not.toBe("PASS");
  });
  it("a guard-tripped run: the label is also computed without it, and a change makes the label INCONCLUSIVE", () => {
    const ok = decide(predicted(16, 1).map((r, i) => (i === 0 ? { ...r, guard: true } : r)), FAST);
    expect(ok.guard.tripped.length).toBe(1);
    expect(ok.guard.sensitive).toBe(false);
    expect(ok.label).toBe("PASS");
    // Make the label hinge on the tripped runs: a tiny D1 margin that vanishes without 6 flagged runs.
    const r = lcg(5);
    const fragile = [
      ...armRuns("inherit", 8, { dE: 0.04, dL: 0.0005 }, r), ...armRuns("blocked", 8, { dE: 0.09, dL: 0.021 }, r),
    ];
    const withFlag = fragile.map((x) => (x.arm === "inherit" && x.slot <= 6006 ? { ...x, guard: true } : x));
    const d = decide(withFlag, FAST);
    expect(d.guard.tripped.length).toBe(6);
    expect(d.label).toBe("INCONCLUSIVE"); // without them inherit has 2 runs: every test NULL
    expect(d.guard.labelWithout).toBe("INCONCLUSIVE");
  });
});

describe("R3 helpers", () => {
  it("doseScores divides each inherit run by the blocked run of the same slot at the same cost", () => {
    const runs = predicted(4, 2);
    const ds = doseScores(runs);
    const inh = runs.find((r) => r.arm === "inherit" && r.slot === 6002)!, blk = runs.find((r) => r.arm === "blocked" && r.slot === 6002)!;
    expect(ds.groups[1][1]).toBeCloseTo(inh.dE / blk.dE, 12);
    expect(ds.groups.map((g) => g.length)).toEqual([4, 4, 4]);
    expect(ds.problems).toEqual([]);
    // an unpaired slot is not scored; a zero blocked baseline is a problem, not a division by zero
    expect(doseScores(runs.filter((r) => !(r.arm === "blocked" && r.slot === 6001))).groups[1].length).toBe(3);
    expect(doseScores(runs.map((r) => (r.arm === "blocked" && r.slot === 6001 ? { ...r, dE: 0 } : r))).problems.join()).toMatch(/undefined/);
  });
  it("a dependent baseline cannot fake a dose response: identical inherit deposits with blocked baselines that differ by a hair never give D3 SUPPORT", () => {
    // Sol's scenario: with a shared estimated blocked mean the normalised scores of a cost would move together and a trend could appear from noise alone.
    const labels: string[] = [];
    for (let k = 0; k < 20; k++) {
      const r = lcg(100 + k);
      const mk = (arm: RunReadout["arm"], base: number) => Array.from({ length: 16 }, (_, i) => ({ arm, slot: 6001 + i, dE: base * (1 + 0.02 * (r() - 0.5)), dL: base / 10, tmE: 1, tmL: 1, guard: false }));
      const runs = [...mk("inherit", 0.04), ...mk("inherit-c1", 0.04), ...mk("inherit-c4", 0.04), ...mk("blocked", 0.081), ...mk("blocked-c1", 0.08), ...mk("blocked-c4", 0.079)];
      labels.push(runTests(runs, FAST)[2].verdict);
    }
    expect(labels.filter((l) => l === "SUPPORT").length).toBeLessThanOrEqual(2);
  });
  it("a purge that finishes before the first census (dE = dL = 0) reads as the strongest decline, not as a contradiction", () => {
    const r = lcg(3);
    const runs = [...armRuns("inherit", 16, { dE: 0, dL: 0 }, r).map((x) => ({ ...x, dE: 0, dL: 0 })), ...armRuns("blocked", 16, { dE: 0.09, dL: 0.021 }, r)];
    const t = runTests(runs, FAST);
    expect(t[0].verdict).toBe("SUPPORT");
    expect(t[1].verdict).toBe("SUPPORT");
  });
  it("flipLabels is an involution and leaves frozen alone; shuffleLabels keeps the multiset at each cost", () => {
    const a = predicted(5, 6);
    expect(flipLabels(flipLabels(a))).toEqual(a);
    expect(flipLabels(a).filter((r) => r.arm === "frozen").length).toBe(5);
    const s = shuffleLabels(a, 11);
    expect(s.length).toBe(a.length);
    const sum = (rs: RunReadout[], arms: string[]) => rs.filter((r) => arms.includes(r.arm)).map((r) => r.dE).sort().join();
    expect(sum(s, ["inherit", "blocked"])).toBe(sum(a, ["inherit", "blocked"]));
  });
  it("frozenRead reads FROZEN-LOW, FROZEN-NOT-LOW and a missing arm", () => {
    const r = lcg(2);
    const low = [...armRuns("blocked", 16, { dE: 0.09, dL: 0.021 }, r), ...armRuns("frozen", 16, { dE: 0.06, dL: 0.003 }, r), ...armRuns("inherit", 16, { dE: 0.04, dL: 0.0004 }, r)];
    expect(frozenRead(low, FAST).reading).toBe("FROZEN-LOW");
    expect(frozenRead(low, FAST).inheritBelowFrozen).toBe(true);
    const high = [...armRuns("blocked", 16, { dE: 0.09, dL: 0.021 }, r), ...armRuns("frozen", 16, { dE: 0.09, dL: 0.02 }, r)];
    expect(frozenRead(high, FAST).reading).toBe("FROZEN-NOT-LOW");
    expect(frozenRead(armRuns("blocked", 16, { dE: 0.09, dL: 0.021 }, r), FAST).reading).toBeNull();
  });
  it("frozenRead prints one of five readings, with 'no purge' taking precedence", () => {
    const arm = (a: RunReadout["arm"], vals: number[]): RunReadout[] => vals.map((dL, i) => ({ arm: a, slot: 6001 + i, dE: 0.05, dL, tmE: 1, tmL: 1, guard: false }));
    const mix = (low: number, lowV: number, highV: number) => Array.from({ length: 16 }, (_, i) => (i < low ? lowV * (1 + 0.01 * i) : highV * (1 + 0.01 * i)));
    const read = (inh: number[], blk: number[], fz: number[]) => frozenRead([...arm("inherit", inh), ...arm("blocked", blk), ...arm("frozen", fz)], FAST).interpretation;
    const all = (v: number) => mix(16, v, v);
    expect(read(all(0.0005), all(0.02), all(0.003))).toBe("FROZEN-PLUS-MUTATION"); // frozen low, inherit below frozen
    expect(read(all(0.0005), all(0.02), all(0.0005))).toBe("FROZEN-SUFFICES"); // frozen low, inherit not below frozen
    expect(read(all(0.0005), all(0.02), all(0.03))).toBe("MUTATION-NEEDED"); // frozen above blocked, inherit below frozen
    // Sol's case: inherit above blocked, frozen above inherit: no purge, so no reading about mutation
    expect(read(all(0.005), all(0.001), all(0.01))).toBe("NO-PURGE");
    // the unresolved cell: a purge (14 of 16 inherit runs low), frozen only partly low (11 of 16), the two not separated
    expect(read(mix(14, 0.0005, 0.03), all(0.02), mix(11, 0.0005, 0.03))).toBe("UNRESOLVED");
    expect(frozenRead(arm("blocked", all(0.02)), FAST).interpretation).toBeNull();
  });
  it("shuffleLabels gives each dealt arm the slots 6001.. so every D3 pair is complete", () => {
    const base = predicted(16, 3);
    for (let k = 0; k < 10; k++) {
      const t = runTests(shuffleLabels(base, 900 + k), FAST);
      expect(t[2].n).toEqual([16, 16, 16]);
    }
  });
  it("resample and planted are deterministic and size n per arm", () => {
    const pool = armRuns("inherit", 20, { dE: 0.04, dL: 0.001 }, lcg(1));
    expect(resample(pool, 16, 7, 0, "inherit")).toEqual(resample(pool, 16, 7, 0, "inherit"));
    const p = planted(pool, armRuns("blocked", 20, { dE: 0.09, dL: 0.02 }, lcg(2)), 16, 3, { "inherit-c1": 4 });
    expect(p.length).toBe(7 * 16);
    expect(new Set(p.map((r) => r.arm)).size).toBe(7);
    expect(R3_CONFIRM_ARMS.length).toBe(7);
    expect(R3_DEV_ARMS.length).toBe(5);
  });
});
