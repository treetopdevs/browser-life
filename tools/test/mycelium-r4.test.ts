// Mycelium rung R4 (tools/mycelium/r4-*.ts, observe-r4.ts): the seed embargo, the arms, the run gate and the log, the freeze checks, the trail-use readouts on tiny
// hand-built states, the decision rules (every cell of the outcome table), the reachability of FUNCTIONAL, TOLL-ONLY and MINOR-USE on synthetic data, and the
// stored-series checks. Pure functions only: no test here runs a protocol seed or touches the real seed log, FROZEN or CALIBRATION.json.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { NN_BYTES, NN_H, NN_I, NN_O } from "@bl/schema";
import { createWorld, defaultConfig, energyTotal, matterTotal, type MyceliumConfig, type MyceliumState, validateConfig } from "../mycelium/world.ts";
import { R2B_WORLD_SEEDS, R2_SEEDS } from "../mycelium/r2b-seeds.ts";
import { R3_WORLD_SEEDS } from "../mycelium/r3-seeds.ts";
import { FRESH_MIN, gateRun as r2GateRun } from "../mycelium/r2-protocol.ts";
import { emptySeries } from "../mycelium/observe-r2b.ts";
import { emptyR4, occupancyRatio, R4_CENSUS_KEYS, r4Census, type R4Series, r4SeriesProblems, r4WindowMeans } from "../mycelium/observe-r4.ts";
import {
  ARM_DELTA, armConfig, calibrationProblems, checkCalibrationForConfirm, checkFrozen, type CpuCheckFile, cpuCheckProblems, fileHashProblem, gateRun, KERNEL_SHA256, kernelProblems, logProblems, manifestText, pendingConfirm,
  R4, R4_ENTRY_FILES, type SeedLogEntry,
} from "../mycelium/r4-protocol.ts";
import { R4_ARM_OFFSET, R4_ARMS, R4_CONFIRM_SLOTS, R4_DEV_SLOTS, R4_SMOKE_SLOTS, R4_WORLD_SEEDS, r4EmbargoReason, worldSeed } from "../mycelium/r4-seeds.ts";
import { anchorOf, dealt, decide, donors, kept, type Margins, marginsOf, medianCI, planted, r4RunFileProblems, type R4RunFile, readoutsOfWindows, resample, type RunReadout } from "../mycelium/r4-decide.ts";

// ---- seeds -------------------------------------------------------------------------------------------------

describe("R4 seeds and the embargo", () => {
  it("every world seed is at least 130,000, so run.ts (below 9001 only) and r2.ts (9001-9005 only) already refuse them", () => {
    for (const s of R4_WORLD_SEEDS) {
      expect(s).toBeGreaterThanOrEqual(130_000);
      expect(s).toBeGreaterThanOrEqual(FRESH_MIN);
      expect(r2GateRun({ phase: "dev", arm: "inherit", seed: s, steps: 20_000 }, []).length).toBeGreaterThan(0);
      expect(r2GateRun({ phase: "confirm", arm: "inherit", seed: s, steps: 20_000 }, []).some((p) => /9001-9005/.test(p))).toBe(true);
    }
  });

  it("collides with nothing: not an R2b, R2 or R3 world seed, not the trail-use screen's, not a shaping scratch world", () => {
    const mine = new Set<number>(R4_WORLD_SEEDS);
    expect(mine.size).toBe(R4_WORLD_SEEDS.length);
    const screen = [8001, 8002, 8003, 8004, 108001, 108002, 108003, 108004];
    const scratch = [10, 11, 12, 13].flatMap((s) => [200_000, 210_000, 220_000, 230_000, 240_000].map((o) => o + s));
    for (const s of R4_WORLD_SEEDS) {
      expect(R2B_WORLD_SEEDS).not.toContain(s);
      expect(R2_SEEDS).not.toContain(s);
      expect(R3_WORLD_SEEDS).not.toContain(s);
      expect(screen).not.toContain(s);
      expect(scratch).not.toContain(s);
    }
  });

  it("the slot sets are as registered and disjoint, and the arm offsets are distinct multiples of 10,000", () => {
    expect([R4_DEV_SLOTS[0], R4_DEV_SLOTS.at(-1), R4_DEV_SLOTS.length]).toEqual([8001, 8020, 20]);
    expect([R4_CONFIRM_SLOTS[0], R4_CONFIRM_SLOTS.at(-1), R4_CONFIRM_SLOTS.length]).toEqual([7001, 7016, 16]);
    expect(R4_DEV_SLOTS.filter((s) => R4_CONFIRM_SLOTS.includes(s))).toEqual([]);
    expect(R4_SMOKE_SLOTS.length).toBe(100);
    const o = Object.values(R4_ARM_OFFSET);
    expect(new Set(o).size).toBe(o.length);
    for (const v of o) expect(v % 10_000).toBe(0);
    expect(worldSeed("physarum", 7001)).toBe(157_001);
  });

  it("r4EmbargoReason names a registered world seed and passes others", () => {
    expect(r4EmbargoReason(worldSeed("inherit", 7001))).toMatch(/belongs to R4/);
    expect(r4EmbargoReason(8001)).toBeNull();
  });

  it("no log or doc line outside the confirm phases mentions a confirmation slot (grep-level check of the files that exist)", () => {
    const log = "docs/mycelium-r4-2026-11-14/seed-log.jsonl";
    if (!existsSync(log)) return;
    for (const line of readFileSync(log, "utf8").split("\n").filter((l) => l.trim())) {
      const e = JSON.parse(line) as SeedLogEntry;
      if (R4_CONFIRM_SLOTS.includes(e.seed)) expect(["confirm", "cpu-check"]).toContain(e.phase);
    }
  });
});

// ---- arms -------------------------------------------------------------------------------------------------

describe("R4 arms", () => {
  it("armConfig is defaultConfig plus the delta and the offset seed", () => {
    expect(armConfig("keyless", 7001)).toEqual(defaultConfig({ moveCost: 12, seed: 177_001 }));
    expect(armConfig("inherit", 7001)).toEqual(defaultConfig({ moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll", seed: 137_001 }));
    expect(armConfig("blind", 8002)).toMatchObject({ blindTrailGradient: true, trailMoveDiscount: 64, trailDiscountMode: "toll", moveCost: 12, seed: 168_002 });
    expect(armConfig("physarum", 8001)).toMatchObject({ controller: "physarum", heredity: "frozen", physarumDeposit: 256, trailDiscountMode: "toll", seed: 158_001 });
    expect(armConfig("blocked", 8001)).toMatchObject({ heredity: "blocked", seed: 148_001 });
    for (const arm of R4_ARMS) {
      const c = armConfig(arm, 8001);
      expect(validateConfig(c)).toEqual([]);
      expect(() => createWorld(c)).not.toThrow();
      for (const k of Object.keys(ARM_DELTA[arm])) expect(k in defaultConfig() || ["controller", "physarumDeposit", "blindTrailGradient", "trailMoveDiscount", "trailDiscountMode"].includes(k)).toBe(true);
    }
  });

  it("defaultConfig() is untouched (no optional key appears in it) and the keyless arm has no discount key", () => {
    const keys = Object.keys(defaultConfig());
    for (const k of ["controller", "physarumDeposit", "blindTrailGradient", "trailMoveDiscount", "trailDiscountMode"]) expect(keys).not.toContain(k);
    expect(Object.keys(ARM_DELTA.keyless)).toEqual(["moveCost"]);
  });

  it("the matched deposit is attainable: 256 is inside the kernel's range and gives one unit per particle-step", () => {
    expect(R4.PHYSARUM_V).toBe(256);
    expect(R4.PHYSARUM_V).toBeLessThanOrEqual(768);
  });
});

// ---- the run gate and the log ---------------------------------------------------------------------------------

const entry = (phase: SeedLogEntry["phase"], arm: string, seed: number, state: SeedLogEntry["state"] = "finished", extra: Partial<SeedLogEntry> = {}): SeedLogEntry => ({
  phase, arm, seed, steps: R4.STEPS, state, ...(state === "finished" ? { fileSha256: "aa", digest: "dd" } : {}), ...extra,
});

describe("R4 run gate", () => {
  it("dev runs all five arms on 8001-8020 at 100,000 steps only", () => {
    for (const arm of R4_ARMS) expect(gateRun({ phase: "dev", arm, seed: 8001, steps: R4.STEPS }, [])).toEqual([]);
    expect(gateRun({ phase: "dev", arm: "inherit", seed: 8021, steps: R4.STEPS }, []).length).toBeGreaterThan(0);
    expect(gateRun({ phase: "dev", arm: "inherit", seed: 7001, steps: R4.STEPS }, []).length).toBeGreaterThan(0);
    expect(gateRun({ phase: "dev", arm: "inherit", seed: 8001, steps: 50_000 }, []).length).toBeGreaterThan(0);
    expect(gateRun({ phase: "dev", arm: "nope", seed: 8001, steps: R4.STEPS }, []).join()).toMatch(/unknown arm/);
  });

  it("a finished dev run is never repeated, and a dev run with a file but no finished entry is refused", () => {
    expect(gateRun({ phase: "dev", arm: "inherit", seed: 8001, steps: R4.STEPS }, [entry("dev", "inherit", 8001, "started"), entry("dev", "inherit", 8001)]).join()).toMatch(/dev run is never repeated/);
    expect(gateRun({ phase: "dev", arm: "inherit", seed: 8001, steps: R4.STEPS, seriesExists: true }, [entry("dev", "inherit", 8001, "started")]).join()).toMatch(/no finished entry/);
    expect(gateRun({ phase: "dev", arm: "inherit", seed: 8001, steps: R4.STEPS }, [entry("dev", "inherit", 8001, "started")])).toEqual([]);
    // a file with no log entry at all is refused too (it could otherwise be overwritten)
    expect(gateRun({ phase: "dev", arm: "inherit", seed: 8001, steps: R4.STEPS, seriesExists: true }, []).join()).toMatch(/no finished entry/);
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 7001, steps: R4.STEPS, seriesExists: true }, []).join()).toMatch(/no finished entry/);
  });

  it("confirm runs the five arms on 7001-7016, never twice", () => {
    expect(gateRun({ phase: "confirm", arm: "physarum", seed: 7016, steps: R4.STEPS }, [])).toEqual([]);
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 7017, steps: R4.STEPS }, []).length).toBeGreaterThan(0);
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 8001, steps: R4.STEPS }, []).length).toBeGreaterThan(0);
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 7001, steps: R4.STEPS }, [entry("confirm", "inherit", 7001)]).join()).toMatch(/never repeated/);
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 7001, steps: R4.STEPS, seriesExists: true }, [entry("confirm", "inherit", 7001, "started")]).join()).toMatch(/no finished entry/);
  });

  it("refuses R2b's embargoed slots and any unregistered slot in every logged phase", () => {
    for (const phase of ["dev", "confirm", "cpu-check"] as const) {
      expect(gateRun({ phase, arm: "inherit", seed: 5001, steps: R4.STEPS }, []).length).toBeGreaterThan(0);
      expect(gateRun({ phase, arm: "inherit", seed: 6001, steps: R4.STEPS }, []).join()).toMatch(/outside every registered|only/);
    }
  });

  it("smoke takes slots 1-100 and short multiples of 1000; cpu-check takes registered runs only", () => {
    expect(gateRun({ phase: "smoke", arm: "inherit", seed: 7, steps: 3000 }, [])).toEqual([]);
    expect(gateRun({ phase: "smoke", arm: "inherit", seed: 7001, steps: 3000 }, []).length).toBeGreaterThan(0);
    expect(gateRun({ phase: "smoke", arm: "inherit", seed: 7, steps: 2500 }, []).length).toBeGreaterThan(0);
    const done = [entry("dev", "physarum", 8004, "started"), entry("dev", "physarum", 8004)];
    expect(gateRun({ phase: "cpu-check", arm: "physarum", seed: 8004, steps: R4.STEPS }, done)).toEqual([]);
    expect(gateRun({ phase: "cpu-check", arm: "inherit", seed: 9004, steps: R4.STEPS }, []).length).toBeGreaterThan(0);
    // a cpu-check needs the finished GPU entry, and is done once (whether or not its file exists)
    expect(gateRun({ phase: "cpu-check", arm: "physarum", seed: 8004, steps: R4.STEPS }, []).join()).toMatch(/no finished dev entry/);
    expect(gateRun({ phase: "cpu-check", arm: "physarum", seed: 8004, steps: R4.STEPS }, [...done, entry("cpu-check", "physarum", 8004, "started"), entry("cpu-check", "physarum", 8004)]).join()).toMatch(/already has a finished cpu-check/);
    expect(gateRun({ phase: "cpu-check", arm: "inherit", seed: 7002, steps: R4.STEPS }, [entry("confirm", "inherit", 7002, "started"), entry("confirm", "inherit", 7002)])).toEqual([]);
    expect(logProblems([{ phase: "smoke", arm: "inherit", seed: 8001, steps: R4.STEPS, state: "started" }]).join()).toMatch(/smoke entry/);
  });

  it("a log with a leak, a wrong-phase slot, an invalid entry or an unregistered slot stops every logged phase", () => {
    expect(logProblems([entry("dev", "inherit", 8001, "started"), entry("dev", "inherit", 8001)])).toEqual([]);
    expect(logProblems([entry("dev", "inherit", 7001)]).join()).toMatch(/embargo is broken/);
    expect(logProblems([entry("confirm", "inherit", 8001)]).join()).toMatch(/wrong phase/);
    expect(logProblems([entry("confirm", "inherit", 7001, "invalid")]).join()).toMatch(/invalid run/);
    expect(logProblems([entry("dev", "inherit", 77)]).join()).toMatch(/outside the registered/);
    expect(gateRun({ phase: "dev", arm: "inherit", seed: 8001, steps: R4.STEPS }, [entry("confirm", "inherit", 7001, "invalid")]).length).toBeGreaterThan(0);
  });

  it("the log refuses a repeated finished entry and a finished entry with no started entry", () => {
    expect(logProblems([entry("confirm", "inherit", 7001, "started"), entry("confirm", "inherit", 7001, "started"), entry("confirm", "inherit", 7001, "finished")])).toEqual([]);
    expect(logProblems([entry("confirm", "inherit", 7001, "started"), entry("confirm", "inherit", 7001), entry("confirm", "inherit", 7001)]).join()).toMatch(/more than one finished/);
    expect(logProblems([entry("dev", "inherit", 8001)]).join()).toMatch(/no earlier started entry/);
    expect(logProblems([entry("dev", "inherit", 8001), entry("dev", "inherit", 8001, "started")]).join()).toMatch(/no earlier started entry/);
    expect(logProblems([{ phase: "dev", arm: "bogus", seed: 8001, steps: R4.STEPS, state: "started" }]).join()).toMatch(/unknown arm, phase, state/);
    expect(logProblems([{ phase: "dev", arm: "inherit", seed: 8001, steps: -5, state: "started" }]).join()).toMatch(/unknown arm, phase, state or step count/);
    expect(logProblems([entry("dev", "inherit", 8001, "started"), entry("dev", "inherit", 8001), entry("dev", "inherit", 8001, "started")]).join()).toMatch(/started entry after a finished/);
    expect(logProblems([entry("dev", "inherit", 8001, "started"), { ...entry("dev", "inherit", 8001), fileSha256: undefined }]).join()).toMatch(/without its file hash or digest/);
    expect(logProblems([entry("cpu-check", "inherit", 8001, "started"), { ...entry("cpu-check", "inherit", 8001), digest: undefined }]).join()).toMatch(/without its file hash or digest/);
  });

  it("the CPU cross-check is an acceptance gate: logged, equal CPU, GPU, run and logged digests, full horizon, frozen code; dev needs both controller paths", () => {
    const e = (arm: string, seed: number, digest = "d1"): SeedLogEntry[] => [entry("cpu-check", arm, seed, "started"), entry("cpu-check", arm, seed, "finished", { digest })];
    const ok = (digest = "d1"): CpuCheckFile => ({ equal: true, cpuDigest: digest, gpuDigest: digest, runDigest: digest, codeHash: "c", steps: R4.STEPS });
    const both = [...e("inherit", 8003), ...e("physarum", 8004, "d2")];
    const checks = { "inherit/8003": ok(), "physarum/8004": ok("d2") };
    expect(cpuCheckProblems("dev", both, "c", checks)).toEqual([]);
    expect(cpuCheckProblems("dev", [], "c", {}).join()).toMatch(/no finished cpu-check/);
    expect(cpuCheckProblems("dev", e("inherit", 8003), "c", { "inherit/8003": ok() }).join()).toMatch(/physarum run/);
    expect(cpuCheckProblems("dev", e("physarum", 8004, "d2"), "c", { "physarum/8004": ok("d2") }).join()).toMatch(/neural-controller run/);
    for (const bad of [{ equal: false }, { runDigest: "other" }, { cpuDigest: "x" }, { gpuDigest: "x" }, { codeHash: "other" }, { steps: 3000 }]) {
      expect(cpuCheckProblems("dev", both, "c", { ...checks, "inherit/8003": { ...ok(), ...bad } }).length).toBeGreaterThan(0);
    }
    expect(cpuCheckProblems("dev", [...e("inherit", 8003, "logged-other"), ...e("physarum", 8004, "d2")], "c", checks).length).toBe(1);
    expect(cpuCheckProblems("dev", both, "other", checks).length).toBeGreaterThan(0);
    expect(cpuCheckProblems("confirm", both, "c", checks).join()).toMatch(/no finished cpu-check for a confirm/);
    expect(cpuCheckProblems("confirm", e("blocked", 7002), "c", { "blocked/7002": ok() })).toEqual([]);
  });

  it("fileHashProblem compares a series.json hash with the finished entry; pendingConfirm lists 80 runs in arm-major order", () => {
    expect(fileHashProblem([entry("dev", "inherit", 8001, "finished", { fileSha256: "aa" })], "dev", "inherit", 8001, "aa")).toBeNull();
    expect(fileHashProblem([entry("dev", "inherit", 8001, "finished", { fileSha256: "aa" })], "dev", "inherit", 8001, "bb")).toMatch(/not the file/);
    expect(fileHashProblem([], "dev", "inherit", 8001, "aa")).toMatch(/no finished entry/);
    const all = pendingConfirm([]);
    expect(all.length).toBe(80);
    expect(all[0]).toEqual({ arm: "inherit", seed: 7001 });
    expect(pendingConfirm([entry("confirm", "inherit", 7001)]).length).toBe(79);
  });
});

// ---- freeze ---------------------------------------------------------------------------------------------------

describe("R4 freeze checks", () => {
  const H = (c: string) => c.repeat(64);
  const files = { ...KERNEL_SHA256, "tools/mycelium/r4.ts": H("1"), "deno.json": H("2") };
  const actual = { protocol: H("a"), code: H("b"), files, calibration: H("c") };
  const text = (extra = "") => [`protocol_sha256: ${H("a")}`, `code_hash: ${H("b")}`, ...Object.entries(files).map(([p, h]) => `${h}  ${p}`), extra].join("\n");

  it("the kernel hashes are those of e5b43f69", () => {
    expect(KERNEL_SHA256["tools/mycelium/world.ts"]).toBe("42f4bade799f82eee5df2c5bed410dede03e721348d8ffc32c62584f35c80242");
    expect(KERNEL_SHA256["tools/mycelium/gpu.ts"]).toBe("09126acfdf1614df9c6b5adaae6345e94a452bf5fb5375285ade7a962e512330");
    expect(kernelProblems(files)).toEqual([]);
    expect(kernelProblems({ ...files, "tools/mycelium/world.ts": "x" }).join()).toMatch(/world.ts differs from the e5b43f69 kernel/);
    expect(kernelProblems({}).length).toBe(2);
  });

  it("dev needs Freeze 1; confirm also needs Freeze 2; a changed kernel stops both", () => {
    expect(checkFrozen("smoke", null, actual)).toEqual([]);
    expect(checkFrozen("dev", null, actual).join()).toMatch(/Freeze 1/);
    expect(checkFrozen("dev", text(), actual)).toEqual([]);
    expect(checkFrozen("confirm", text(), actual).join()).toMatch(/Freeze 2 is missing/);
    expect(checkFrozen("confirm", text(`calibration_sha256: ${H("c")}`), actual)).toEqual([]);
    expect(checkFrozen("confirm", text(`calibration_sha256: ${H("d")}`), actual).join()).toMatch(/CALIBRATION.json differs/);
    expect(checkFrozen("dev", text(), { ...actual, protocol: H("e") }).join()).toMatch(/PROTOCOL.md differs/);
    expect(checkFrozen("dev", text(), { ...actual, files: { ...files, "tools/mycelium/world.ts": "x" } }).join()).toMatch(/e5b43f69 kernel/);
    expect(checkFrozen("dev", text(`${H("f")}  tools/mycelium/zz.ts`), actual).join()).toMatch(/zz.ts missing/);
  });

  it("checkCalibrationForConfirm needs READY under the frozen code and protocol; the entry files are the R4 ones", () => {
    const fr = { code_hash: "c1", protocol_sha256: "p1" };
    expect(checkCalibrationForConfirm({ verdict: "READY", codeHash: "c1", protocolSha256: "p1" }, fr)).toEqual([]);
    expect(checkCalibrationForConfirm({ verdict: "MEASUREMENT-LIMITED", codeHash: "c1", protocolSha256: "p1", reasons: ["x"] }, fr).join()).toMatch(/not READY/);
    expect(checkCalibrationForConfirm({ verdict: "READY", codeHash: "c0", protocolSha256: "p1" }, fr).join()).toMatch(/code/);
    const good = { verdict: "READY", codeHash: "c1", protocolSha256: "p1", margins: { align: 0.2, occ: 1, acute: 0.1, sens: 0.01 } };
    expect(calibrationProblems(good, fr)).toEqual([]);
    expect(calibrationProblems(null, fr).join()).toMatch(/cannot be read/);
    expect(calibrationProblems({ ...good, margins: undefined }, fr).join()).toMatch(/no usable margins/);
    expect(calibrationProblems({ ...good, margins: { ...good.margins, sens: 0 } }, fr).join()).toMatch(/no usable margins/);
    expect(calibrationProblems({ ...good, margins: { ...good.margins, occ: NaN } }, fr).join()).toMatch(/no usable margins/);
    expect(calibrationProblems({ ...good, verdict: "MEASUREMENT-LIMITED" }, fr).join()).toMatch(/not READY/);
    expect(R4_ENTRY_FILES).toEqual(["tools/mycelium/r4.ts", "tools/mycelium/r4-analyze.ts", "tools/mycelium/r4-freeze.ts"]);
  });
});

// ---- the readouts on tiny hand-built states --------------------------------------------------------------------

const B2_OFF = NN_I * NN_H + NN_H + NN_H * NN_O;
const tiny = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ width: 16, height: 16, founders: 10, maxParticles: 64, seed: 3, ...over });
const reanchor = (s: MyceliumState) => { s.matter0 = matterTotal(s); s.energy0 = energyTotal(s); };

/** Ten particles at cells x = 3..12 of row y = 2 + (i mod 3), with the controller biases set to the given constant outputs (zero weights). */
function build(over: Partial<MyceliumConfig>, outs: Record<number, number> | null, field: (x: number, y: number) => number): MyceliumState {
  const s = createWorld(tiny(over));
  if (outs) { s.genome.fill(0); for (let i = 0; i < s.n; i++) for (const [k, v] of Object.entries(outs)) s.genome[i * NN_BYTES + B2_OFF + Number(k)] = v; }
  for (let i = 0; i < s.n; i++) { s.x[i] = (3 + i) * 256 + 128; s.y[i] = (2 + (i % 3)) * 256 + 128; }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) s.P[y * 16 + x] = field(x, y);
  reanchor(s);
  return s;
}
const OUT_MX = 0, OUT_MY = 1, OUT_DEP = 3;

describe("R4 readouts on hand-built states", () => {
  it("no trail: every use readout is its defined-at-zero value", () => {
    const s = build({}, { [OUT_MX]: 100 }, () => 0);
    const c = r4Census(s);
    expect(c.align).toBe(0); expect(c.alignBlind).toBe(0); expect(c.acute).toBe(0);
    expect(c.occ).toBe(1); expect(c.occShift).toBe(1); expect(c.gradFrac).toBe(0); expect(c.qualFrac).toBe(0); expect(c.sat).toBe(0);
  });

  it("no particle: the zero census", () => {
    const s = build({}, null, () => 5);
    s.n = 0;
    expect(r4Census(s)).toEqual({ align: 0, alignBlind: 0, acute: 0, speed: 0, speedBlind: 0, gradFrac: 0, qualFrac: 0, occ: 1, occShift: 1, req0: 0, req1: 0, req2p: 0, sat: 0, sensDep: 0, sensMove: 0, sensAll: 0 });
  });

  it("a controller moving east up an eastward gradient has ALIGN +1; down the gradient -1; across it 0; blind inputs change nothing for a constant controller", () => {
    const up = r4Census(build({}, { [OUT_MX]: 100 }, (x) => 10 * x));
    expect(up.align).toBeCloseTo(1, 12); expect(up.alignBlind).toBeCloseTo(1, 12); expect(up.acute).toBeCloseTo(0, 12); expect(up.qualFrac).toBe(1);
    const down = r4Census(build({}, { [OUT_MX]: 100 }, (x) => 10 * (15 - x)));
    expect(down.align).toBeCloseTo(-1, 12);
    const across = r4Census(build({}, { [OUT_MY]: 100 }, (x) => 10 * x));
    expect(across.align).toBeCloseTo(0, 12);
    expect(up.speed).toBeCloseTo(100 / 254, 12); expect(up.speedBlind).toBeCloseTo(100 / 254, 12);
  });

  it("a controller that moves only when the gradient inputs are on has ACUTE equal to its cosine", () => {
    // weights from input 3 (trail east-west) to hidden unit 0, and hidden unit 0 to output MX: movement is gradient-driven.
    const s = build({}, null, (x) => 8 * x);
    s.genome.fill(0);
    for (let i = 0; i < s.n; i++) { const o = i * NN_BYTES; s.genome[o + 3 * NN_H + 0] = 100; s.genome[o + NN_I * NN_H + NN_H + 0 * NN_O + OUT_MX] = 100; }
    const c = r4Census(s);
    expect(c.align).toBeGreaterThan(0.99);
    expect(c.alignBlind).toBe(0); expect(c.acute).toBeGreaterThan(0.99); expect(c.sensMove).toBeGreaterThan(0);
    // the same state in a blind world: the acute effect is exactly 0
    const b = build({ blindTrailGradient: true }, null, (x) => 8 * x);
    b.genome.set(s.genome);
    expect(r4Census(b).acute).toBe(0);
  });

  it("the physarum rule follows the gradient (ALIGN near 1, ACUTE near 1) where a blind one wanders", () => {
    const c = r4Census(build({ controller: "physarum", heredity: "frozen", physarumDeposit: 256 }, null, (x) => 10 * x));
    expect(c.align).toBeGreaterThan(0.9);
    expect(c.acute).toBeGreaterThan(0.5);
    expect(c.alignBlind).toBeLessThan(0.5);
    expect(c.req1).toBe(1); expect(c.req0).toBe(0); expect(c.req2p).toBe(0);
  });

  it("OCC is the mean trail in the particles' cells over the mean over the field; shifted by half the torus it moves", () => {
    const P = new Uint32Array(64);
    const cells = [9, 9];
    P[9] = 64;
    expect(occupancyRatio(P, cells, 2, 64)).toBe(64);
    expect(occupancyRatio(new Uint32Array(64), cells, 2, 64)).toBe(1);
    expect(occupancyRatio(P, cells, 0, 64)).toBe(1);
    expect(occupancyRatio(new Uint32Array(64).fill(7), cells, 2, 64)).toBe(1);
    const s = build({}, null, () => 0);
    for (let i = 0; i < s.n; i++) { s.x[i] = 128; s.y[i] = 128; }
    s.P[0] = 160;
    const c = r4Census(s);
    expect(c.occ).toBe(160 / (160 / 256));
    expect(c.occShift).toBe(0 / (160 / 256));
  });

  it("deposit-request classes and the complete-discount fraction follow the kernel's formulas", () => {
    const toll = { moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" as const };
    const one = r4Census(build(toll, { [OUT_DEP]: 32 }, () => 4));
    expect(one.req1).toBe(1); expect(one.sat).toBe(1);
    const lessTrail = r4Census(build(toll, { [OUT_DEP]: 32 }, () => 3));
    expect(lessTrail.sat).toBe(0);
    const none = r4Census(build(toll, { [OUT_DEP]: 0 }, () => 4));
    expect(none.req0).toBe(1);
    const lots = r4Census(build(toll, { [OUT_DEP]: 127 }, () => 4));
    expect(lots.req2p).toBe(1);
    expect(r4Census(build({ moveCost: 12 }, { [OUT_DEP]: 32 }, () => 4)).sat).toBe(0);
  });

  it("a deposit request that changes when the gradient is zeroed is counted in sensDep", () => {
    const s = build({}, null, (x) => 8 * x);
    s.genome.fill(0);
    // the deposit bias alone (20) requests 0 units; the gradient input adds about 15, which requests 1
    for (let i = 0; i < s.n; i++) { const o = i * NN_BYTES; s.genome[o + 3 * NN_H + 0] = 127; s.genome[o + NN_I * NN_H + NN_H + 0 * NN_O + OUT_DEP] = 127; s.genome[o + B2_OFF + OUT_DEP] = 20; }
    expect(r4Census(s).sensDep).toBe(1);
    expect(r4Census({ ...s, config: { ...s.config, blindTrailGradient: true } }).sensDep).toBe(0);
  });
});

describe("R4 stored series", () => {
  const mkSeries = (): R4Series => {
    const base = emptySeries();
    const r4 = emptyR4();
    for (let t = 500; t <= 2000; t += 500) { base.heavy.step.push(t); r4.step.push(t); for (const k of R4_CENSUS_KEYS) r4[k].push(t / 1000); }
    return { ...base, r4 };
  };

  it("window means are over the heavy censuses in (lo, hi]; an empty window is null", () => {
    const ser = mkSeries();
    const w = r4WindowMeans(ser, 500, 2000)!;
    expect(w.align).toBeCloseTo((1 + 1.5 + 2) / 3, 12);
    expect(r4WindowMeans(ser, 2000, 3000)).toBeNull();
  });

  it("r4SeriesProblems flags a missing block, shifted steps, a short column and a non-finite value", () => {
    const ser = mkSeries();
    expect(ser.heavy.step.length).toBe(4);
    expect(r4SeriesProblems(ser)).toEqual([]);
    expect(r4SeriesProblems({ ...ser, r4: undefined as unknown as R4Series["r4"] })[0]).toMatch(/no r4 block/);
    const shifted = { ...ser, r4: { ...ser.r4, step: [1, 2, 3, 4] } };
    expect(r4SeriesProblems(shifted).join()).toMatch(/differ from the heavy/);
    const short = { ...ser, r4: { ...ser.r4, occ: ser.r4.occ.slice(1) } };
    expect(r4SeriesProblems(short).join()).toMatch(/column occ has the wrong length/);
    const bad = { ...ser, r4: { ...ser.r4, align: [0, NaN, 0, 0] } };
    expect(r4SeriesProblems(bad).join()).toMatch(/non-finite/);
  });

  it("a run file with the wrong identity, config or readouts is refused", () => {
    const f = { format: "x", protocol: "p", phase: "dev", arm: "inherit", seed: 8001, steps: 10, config: {}, engine: "cpu", digest: "d", ledgerChecks: 1, ledgerResidual: 3, cpuLockstep: false, codeHash: "z", readout: {}, series: mkSeries() } as unknown as R4RunFile;
    const p = r4RunFileProblems(f, { phase: "dev", arm: "inherit", seed: 8001, codeHash: "c" }).join("\n");
    for (const re of [/format/, /protocol/, /for 10 steps/, /engine/, /not the arm's config/, /ledger residual 3/, /ledger checks/, /scalar census steps/, /run under code/]) expect(p).toMatch(re);
  });
});

// ---- the decision ---------------------------------------------------------------------------------------------

let seedState = 1;
const rnd = () => { seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0; return seedState / 2 ** 32 - 0.5; };

const base = (arm: RunReadout["arm"], slot: number, o: Partial<RunReadout> = {}): RunReadout => ({
  arm, slot, tmL: 99, align: -0.1, alignBlind: -0.1, acute: 0, occ: 1.05, occShift: 1, req1: 0.99, req2p: 0.005, sat: 1, speed: 0.4, speedBlind: 0.4, sensMove: 0, sensAll: 0.002, d: 1, n: 4000, turn: 20, age: 400, tmM: 99, guard: false, ...o,
});

/** n runs per arm with small noise. `use` is the fraction of the anchor's use that the inherit arm shows. */
function world(n = 16, use = 0, o: { inheritKept?: number; blindKept?: number; physKept?: number; inheritOver?: Partial<RunReadout>; anchor?: Partial<RunReadout> } = {}): RunReadout[] {
  const out: RunReadout[] = [];
  const keptN = (k: number | undefined, i: number) => (k === undefined || i < k);
  for (let i = 0; i < n; i++) {
    out.push(base("blind", 7001 + i, { align: -0.12 + 0.03 * rnd(), occ: 1.05 + 0.1 * rnd(), tmL: keptN(o.blindKept, i) ? 99 : 0.1 }));
    out.push(base("physarum", 7001 + i, { align: 0.99 + 0.002 * rnd(), occ: 7 + 0.3 * rnd(), acute: 0.99, sensAll: 0.09, tmL: keptN(o.physKept, i) ? 99 : 0.1, ...o.anchor }));
    out.push(base("inherit", 7001 + i, {
      align: -0.12 + use * 1.11 + 0.03 * rnd(), occ: 1.05 + use * 5.95 + 0.1 * rnd(), acute: use * 0.99 + 0.002 * rnd(), sensAll: 0.002 + use * 0.09 + 0.0005 * rnd(), tmL: keptN(o.inheritKept, i) ? 99 : 0.1, ...o.inheritOver,
    }));
    out.push(base("blocked", 7001 + i, { acute: 0.001 * rnd() }), base("keyless", 7001 + i, { tmL: 0.01, req1: 0, sat: 0 }));
  }
  return out;
}
const OPT = { boots: 600, perms: 2000 };
const DEV0 = world(20, 0);
const M0: Margins = marginsOf(DEV0);
const run = (rs: RunReadout[], o = OPT) => decide(rs, M0, o);

describe("R4 decision: every cell of the outcome table", () => {
  it("kept means late trail per particle of at least 10", () => {
    expect(kept(base("inherit", 1, { tmL: 10 }))).toBe(true);
    expect(kept(base("inherit", 1, { tmL: 9.99 }))).toBe(false);
  });

  it("FUNCTIONAL: half the anchor's use on ALIGN, OCC and ACUTE", () => {
    const d = run(world(16, 0.5));
    expect(d.label).toBe("FUNCTIONAL");
    expect(d.endpoints.map((e) => e.status)).toEqual(["USE", "USE", "USE", "USE"]);
    expect(d.gates.S.ok && d.gates.G.ok).toBe(true);
  });

  it("TOLL-ONLY: no use, the minimum toll on a complete discount, equal retention", () => {
    const d = run(world(16, 0));
    expect(d.endpoints.map((e) => e.status)).toEqual(["EQUIV", "EQUIV", "EQUIV", "EQUIV"]);
    expect(d.label).toBe("TOLL-ONLY");
    expect(d.floor.ok).toBe(true);
  });

  it("MINOR-USE: a trace of use (5% of the anchor) that is detectable and provably under the margin", () => {
    const d = run(world(16, 0.05));
    expect(d.endpoints[0].status).toBe("SMALL");
    expect(d.endpoints[2].status).toBe("SMALL");
    expect(d.label).toBe("MINOR-USE");
  });

  it("INCONCLUSIVE when the endpoints disagree (use on ALIGN and ACUTE only)", () => {
    const w = world(16, 0.5).map((r) => (r.arm === "inherit" ? { ...r, occ: 1.05 + 0.1 * rnd() } : r));
    const d = run(w);
    expect(d.label).toBe("INCONCLUSIVE");
    expect(d.endpoints[1].status).toBe("EQUIV");
  });

  it("INCONCLUSIVE and WRONG when inherit is below blind (inverted)", () => {
    const d = run(world(16, 0, { inheritOver: { align: -0.5 } }));
    expect(d.endpoints[0].status).toBe("WRONG");
    expect(d.label).toBe("INCONCLUSIVE");
  });

  it("INCONCLUSIVE when the floor fails (deposit requests above the minimum) although no use is shown", () => {
    const d = run(world(16, 0, { inheritOver: { req1: 0.3, req2p: 0.6 } }));
    expect(d.label).toBe("INCONCLUSIVE");
    expect(d.floor.ok).toBe(false);
    expect(d.reasons.join()).toMatch(/not at the floor/);
  });

  it("INCONCLUSIVE when retention differs (16 of 16 inherit against 6 of 16 blind) even with no use", () => {
    const d = run(world(16, 0, { inheritKept: 8, blindKept: 8 }));
    expect(d.retention.differs).toBe(false);
    const d2 = run(world(16, 0, { inheritKept: 16, blindKept: 8 }));
    expect(d2.retention.fisherP).toBeLessThan(0.05);
    expect(d2.label).toBe("INCONCLUSIVE");
    expect(d2.reasons.join()).toMatch(/retention difference is detected/);
  });

  it("gate S: fewer than 8 in-state runs in inherit, blind or physarum makes the label INCONCLUSIVE and reads nothing", () => {
    for (const o of [{ inheritKept: 7 }, { blindKept: 7 }, { physKept: 7 }]) {
      const d = run(world(16, 0.5, o));
      expect(d.label).toBe("INCONCLUSIVE");
      expect(d.gates.S.ok).toBe(false);
      expect(d.endpoints).toEqual([]);
    }
    expect(run(world(16, 0.5, { inheritKept: 8, blindKept: 8, physKept: 8 })).gates.S.ok).toBe(true);
  });

  it("gate G: a physarum anchor that does not exceed blind (or has no span) blocks the label", () => {
    const d = run(world(16, 0, { anchor: { align: -0.1 } }));
    expect(d.gates.G.ok).toBe(false);
    expect(d.label).toBe("INCONCLUSIVE");
    expect(d.reasons.join()).toMatch(/gate G/);
    const small = run(world(16, 0, { anchor: { acute: 0.2 } }));
    expect(small.gates.G.ok).toBe(false);
  });

  it("the population guard: a label that changes without the guarded runs becomes INCONCLUSIVE", () => {
    const w = world(16, 0.5);
    const tripped = w.map((r) => (r.arm === "inherit" && r.slot <= 7008 ? { ...r, guard: true, align: -0.12, occ: 1.05, acute: 0 } : r));
    const d = run(tripped);
    expect(d.guard.tripped.length).toBe(8);
    expect(d.guard.labelWithout).toBe("FUNCTIONAL");
    expect(d.guard.sensitive).toBe(d.guard.labelWithout !== d.label);
    expect(d.label === "INCONCLUSIVE" || d.label === "FUNCTIONAL").toBe(true);
    const noTrip = run(w);
    expect(noTrip.guard.tripped).toEqual([]);
    expect(noTrip.guard.labelWithout).toBeNull();
  });

  it("the decision is a deterministic function of the readouts", () => {
    const w = world(16, 0.05);
    expect(JSON.stringify(run(w))).toBe(JSON.stringify(run(w)));
  });

  it("the margins are the fixed ones passed in: 15% of the dev anchor, not re-estimated from the dataset", () => {
    const a = anchorOf(DEV0)!;
    expect(M0.align).toBeCloseTo(R4.THETA * a.spanAlign, 12);
    expect(M0.occ).toBeCloseTo(R4.THETA * a.spanOcc, 12);
    expect(M0.acute).toBeCloseTo(R4.THETA * a.acute, 12);
    expect(M0.sens).toBeCloseTo(R4.THETA * a.sens, 12);
    const d = run(world(16, 0));
    expect(d.margins).toEqual(M0);
    expect(d.endpoints.map((e) => e.margin)).toEqual([M0.align, M0.occ, M0.acute, M0.sens]);
    expect(() => marginsOf([])).toThrow(/no anchor/);
    // a different set of margins changes the statuses: a huge margin makes everything EQUIV, a tiny one makes a 5% effect USE
    const huge = decide(world(16, 0.05), { align: 10, occ: 100, acute: 10, sens: 1 }, OPT);
    expect(huge.endpoints.every((e) => e.status === "EQUIV" || e.status === "SMALL")).toBe(true);
    const tiny = decide(world(16, 0.05), { align: 0.001, occ: 0.001, acute: 0.001, sens: 0.0001 }, OPT);
    expect(tiny.label).toBe("FUNCTIONAL");
  });

  it("USE needs the whole 95% interval above the margin: an effect right at the margin is not FUNCTIONAL", () => {
    // use = 0.15: the shift equals the margin, so the interval straddles it
    const labels = Array.from({ length: 8 }, (_, i) => { seedState = 100 + i; return run(world(16, 0.15)).label; });
    expect(labels).not.toContain("FUNCTIONAL");
    expect(labels).not.toContain("TOLL-ONLY");
  });

  it("SENS alone blocks TOLL-ONLY: a gradient-dependent speed, eating or depositing that ALIGN, OCC and ACUTE cannot see", () => {
    const w = world(16, 0).map((r) => (r.arm === "inherit" ? { ...r, sensAll: 0.05 } : r));
    const d = run(w);
    expect(d.endpoints.map((e) => e.status)).toEqual(["EQUIV", "EQUIV", "EQUIV", "USE"]);
    expect(d.label).toBe("INCONCLUSIVE");
  });

  it("SENS has no SMALL: a small positive dependence below the margin is EQUIV, as for random controllers", () => {
    const d = run(world(16, 0, { inheritOver: { sensAll: 0.01 } }));
    expect(d.endpoints[3].status).toBe("EQUIV");
    expect(d.label).toBe("TOLL-ONLY");
  });

  it("an extinct run is stored with the defined-at-zero use readouts, age and turnover 0, and the guard tripped", () => {
    const sc = { step: [] as number[], n: [] as number[], births: [] as number[], refused: [] as number[], sumP: [] as number[] };
    const hv = emptySeries().heavy;
    for (let t = 100; t <= 100_000; t += 100) { sc.step.push(t); sc.n.push(0); sc.births.push(5); sc.refused.push(0); sc.sumP.push(0); }
    const r4 = emptyR4();
    for (let t = 500; t <= 100_000; t += 500) {
      hv.step.push(t); hv.n.push(0); hv.sumP.push(0); hv.moran.push(0); hv.moranInvalid.push(1); hv.medianAge.push(null); hv.sig.push(null); hv.d.push(0); hv.meanM.push(null); hv.meanE.push(null); hv.genotypes.push(0);
      r4.step.push(t);
      for (const k of R4_CENSUS_KEYS) r4[k].push(k === "occ" || k === "occShift" ? 1 : 0);
    }
    const r = readoutsOfWindows("inherit", 8001, { scalar: sc, heavy: hv, r4 }, 50_000, 100_000, 10_000, 20_000);
    expect(r).toMatchObject({ tmL: 0, align: 0, acute: 0, sensAll: 0, occ: 1, age: 0, turn: 0, guard: true, n: 0 });
    expect(kept(r)).toBe(false);
  });

  it("planted keptCount builds exactly that many runs in the toll state in inherit, blind and physarum, whatever the pools hold", () => {
    // pools in which only 8 of 20 inherit, blind and physarum runs are in the toll state: resampling alone would not give exactly 8 of 16
    const w0 = world(20, 0, { inheritKept: 8, blindKept: 8, physKept: 8 });
    const pools = Object.fromEntries(R4_ARMS.map((a) => [a, w0.filter((r) => r.arm === a)])) as Record<RunReadout["arm"], RunReadout[]>;
    for (let rep = 0; rep < 5; rep++) {
      const w = planted(pools, 16, 0x3000 + rep, { lambda: 0.5 }, { keptCount: 8 });
      for (const a of ["inherit", "blind", "physarum"] as const) expect(w.filter((r) => r.arm === a && kept(r)).length).toBe(8);
      expect(w.filter((r) => r.arm === "blocked" && kept(r)).length).toBe(16);
      expect(run(w).gates.S.ok).toBe(true);
    }
    expect(run(planted(pools, 16, 1, { lambda: 0.5 }, { keptCount: 7 })).gates.S.ok).toBe(false);
  });

  it("the use readouts of a synthetic inherit run come from donors in the toll state: a lost blind world never donates to a kept inherit run", () => {
    const w0 = world(20, 0, { blindKept: 10 });
    // lost blind worlds carry an absurd ALIGN; if one donated, the null would show it
    const poisoned = w0.map((r) => (r.arm === "blind" && !kept(r) ? { ...r, align: 5, occ: 50 } : r));
    const pools = Object.fromEntries(R4_ARMS.map((a) => [a, poisoned.filter((r) => r.arm === a)])) as Record<RunReadout["arm"], RunReadout[]>;
    expect(donors(pools).blind.every((r) => r.align < 1)).toBe(true);
    const w = planted(pools, 16, 7, { lambda: 0 });
    expect(w.filter((r) => r.arm === "inherit").every((r) => r.align < 1 && r.occ < 2)).toBe(true);
    expect(() => donors({ ...pools, blind: pools.blind.map((r) => ({ ...r, tmL: 0 })) })).toThrow(/no blind run in the toll state/);
  });

  it("with every endpoint's true value exactly at its margin, no endpoint is called above or provably inside it, and no use label is produced, at the calibration's rule", () => {
    const pools = Object.fromEntries(R4_ARMS.map((a) => [a, DEV0.filter((r) => r.arm === a)])) as Record<RunReadout["arm"], RunReadout[]>;
    const above = [0, 0, 0, 0], below = [0, 0, 0, 0];
    let labels = 0;
    const reps = 30;
    for (let rep = 0; rep < reps; rep++) {
      const d = run(planted(pools, 16, 0x4000 + rep, { atMargin: 1, margins: M0 }));
      d.endpoints.forEach((e, k) => { if (e.status === "USE") above[k]++; if (e.status === "EQUIV" || e.status === "SMALL") below[k]++; });
      if (d.label === "FUNCTIONAL" || d.label === "TOLL-ONLY" || d.label === "MINOR-USE") labels++;
    }
    // each endpoint separately (a pooled rate could hide one failing endpoint); 0.1 plus room for 30 replicates (3 of 30 is 0.10)
    for (let k = 0; k < 4; k++) { expect(above[k] / reps).toBeLessThanOrEqual(0.15); expect(below[k] / reps).toBeLessThanOrEqual(0.15); }
    expect(labels / reps).toBeLessThanOrEqual(0.1);
    // the same planting at 0 is the no-use baseline and at 2 is clearly above
    expect(run(planted(pools, 16, 5, { atMargin: 2, margins: M0 })).endpoints.every((e) => e.status === "USE")).toBe(true);
    expect(run(planted(pools, 16, 5, { atMargin: 0, margins: M0 })).label).toBe("TOLL-ONLY");
  });

  it("the detection floor: a shift or acute effect under a quarter of the margin is EQUIV, not a trace of use", () => {
    const tiny = decide(world(16, 0, { inheritOver: {} }).map((r) => (r.arm === "inherit" ? { ...r, align: r.align + 0.02, acute: 0.02 } : r)), M0, OPT);
    expect(tiny.endpoints[0].status).toBe("EQUIV");
    expect(tiny.endpoints[2].status).toBe("EQUIV");
    expect(tiny.label).toBe("TOLL-ONLY");
    const neg = decide(world(16, 0).map((r) => (r.arm === "inherit" ? { ...r, acute: -0.1 } : r)), M0, OPT);
    expect(neg.endpoints[2].status).toBe("WRONG");
    expect(neg.label).toBe("INCONCLUSIVE");
  });
});

describe("R4 reachability on synthetic data (the calibration's shape, small)", () => {
  const pools = () => {
    const w = world(20, 0);
    return Object.fromEntries(R4_ARMS.map((a) => [a, w.filter((r) => r.arm === a)])) as Record<RunReadout["arm"], RunReadout[]>;
  };

  it("planted use at lambda 0.5 reaches FUNCTIONAL every time; lambda 0 does not; lambda 0.05 reaches MINOR-USE at some rate", () => {
    const p = pools();
    const labels = (l: number) => Array.from({ length: 12 }, (_, i) => run(planted(p, 16, 0x1000 + i, { lambda: l })).label);
    expect(labels(0.5).every((x) => x === "FUNCTIONAL")).toBe(true);
    expect(labels(0).includes("FUNCTIONAL")).toBe(false);
    expect(labels(0.05).filter((x) => x === "MINOR-USE").length).toBeGreaterThan(0);
  });

  it("null deals reach TOLL-ONLY at a high rate and FUNCTIONAL at none", () => {
    const p = pools();
    const labels = Array.from({ length: 20 }, (_, i) => run(dealt(p, 16, 0x2000 + i)).label);
    expect(labels.filter((x) => x === "TOLL-ONLY").length).toBeGreaterThanOrEqual(14);
    expect(labels).not.toContain("FUNCTIONAL");
  });

  it("dealt needs a pool of at least 2n and resample relabels with consecutive slots", () => {
    const p = pools();
    expect(() => dealt({ ...p, inherit: p.inherit.slice(0, 5), blind: p.blind.slice(0, 5) }, 16, 1)).toThrow(/smaller than 2n/);
    const r = resample(p.blind, 16, 5, 0, "blind");
    expect(r.map((x) => x.slot)).toEqual(Array.from({ length: 16 }, (_, i) => 7001 + i));
  });

  it("the one-sample bootstrap interval is deterministic and brackets the median", () => {
    const x = [0.1, 0.2, 0.15, 0.3, 0.05, 0.25, 0.12, 0.18];
    const a = medianCI(x, 500), b = medianCI(x, 500);
    expect(a).toEqual(b);
    expect(a[0]).toBeLessThanOrEqual(0.165); expect(a[1]).toBeGreaterThanOrEqual(0.15);
  });

  it("readoutsOfWindows reads the stored series (a window with no census throws)", () => {
    const ser = { ...emptySeries(), r4: emptyR4() } as R4Series;
    expect(() => readoutsOfWindows("inherit", 1, ser, 50, 100, 10, 20)).toThrow(/no census/);
  });
});
