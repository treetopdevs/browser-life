// Mycelium rung R2 protocol logic (tools/mycelium/r2-protocol.ts): arm configs, the run gate (fresh seeds only in
// confirm, never twice), the FROZEN check, the effect test, calibration, and every verdict. Pure functions only:
// no test here runs a simulation with a fresh seed or touches the real seed log or FROZEN.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ARMS, armConfig, type Calibration, calibrate, CONTROLS, DEV_SEEDS, decide, FRESH_SEEDS, checkCalibrationForConfirm, checkCalibrationProvenance, checkProvenance, gateConfirmBatch, gateRun, logProblems, manifestText, parseFrozen, pendingConfirm, checkFrozen,
  type AnyArm, type RunSummary, type RunTable, separation, sd, type SeedLogEntry,
} from "../mycelium/r2-protocol.ts";
import { READOUT_IDS, type ReadoutId } from "../mycelium/observe.ts";
import { defaultConfig, validateConfig } from "../mycelium/world.ts";

const rs = (R1: number, R2: number, R3: number, R4: number, guardTripped = false): RunSummary => ({ readouts: { R1, R2, R3, R4 }, guardTripped });

describe("arm configs", () => {
  it("inherit is exactly defaultConfig with the seed; the others change only their keys", () => {
    expect(armConfig("inherit", 101)).toEqual(defaultConfig({ seed: 101 }));
    expect(JSON.stringify(armConfig("inherit", 101))).toBe(JSON.stringify(defaultConfig({ seed: 101 })));
    expect("controller" in armConfig("blocked", 101)).toBe(false);
    expect(armConfig("blocked", 5)).toEqual({ ...defaultConfig({ seed: 5 }), heredity: "blocked" });
    expect(armConfig("frozen", 5)).toEqual({ ...defaultConfig({ seed: 5 }), heredity: "frozen" });
    expect(armConfig("physarum", 5)).toEqual({ ...defaultConfig({ seed: 5 }), heredity: "frozen", controller: "physarum" });
    expect(armConfig("pc-light", 5)).toEqual({ ...defaultConfig({ seed: 5 }), light: 2 });
    expect(armConfig("pc-decay", 5)).toEqual({ ...defaultConfig({ seed: 5 }), pDecay: 2620 });
    for (const a of [...ARMS, ...CONTROLS]) expect(validateConfig(armConfig(a, 101))).toEqual([]);
  });
});

describe("the run gate", () => {
  const ok = (phase: "smoke" | "pass1" | "dev" | "confirm", arm: string, seed: number, steps = 20000, log: SeedLogEntry[] = []) => gateRun({ phase, arm, seed, steps }, log);

  it("fresh seeds run only in confirm", () => {
    for (const phase of ["smoke", "pass1", "dev"] as const) expect(ok(phase, "inherit", 9001, phase === "smoke" ? 1000 : 20000).join()).toMatch(/fresh seed/);
    expect(ok("smoke", "inherit", 9500, 1000).join()).toMatch(/fresh seed/);
    expect(ok("confirm", "inherit", 9001)).toEqual([]);
  });

  it("confirm takes only fresh seeds, the four arms and the full length", () => {
    expect(ok("confirm", "inherit", 101).join()).toMatch(/9001-9005/);
    expect(ok("confirm", "pc-light", 9001).join()).toMatch(/four|inherit, blocked/);
    expect(ok("confirm", "inherit", 9001, 1000).join()).toMatch(/20000/);
    expect(ok("confirm", "frozen", 9006).join()).toMatch(/9001-9005/);
  });

  it("dev and pass1 take dev seeds at full length; pass1 only the inherit arm; smoke is free of the length", () => {
    expect(ok("dev", "pc-decay", 103)).toEqual([]);
    expect(ok("dev", "physarum", 106).join()).toMatch(/101-105/);
    expect(ok("dev", "inherit", 101, 1000).join()).toMatch(/20000/);
    expect(ok("pass1", "inherit", 105)).toEqual([]);
    expect(ok("pass1", "blocked", 105).join()).toMatch(/inherit arm only/);
    expect(ok("smoke", "physarum", 1, 400)).toEqual([]);
    expect(ok("dev", "nonsense", 101).join()).toMatch(/unknown arm/);
  });

  const e = (state: SeedLogEntry["state"], arm = "inherit", seed = 9001, phase: SeedLogEntry["phase"] = "confirm"): SeedLogEntry => ({ phase, arm, seed, steps: 20000, state });

  it("a finished confirm (arm, seed) is never run again; a started-only one resumes only while no series.json exists", () => {
    expect(ok("confirm", "inherit", 9001, 20000, [e("started"), e("finished")]).join()).toMatch(/already finished/);
    expect(ok("confirm", "blocked", 9001, 20000, [e("started"), e("finished")])).toEqual([]);
    expect(ok("confirm", "inherit", 9001, 20000, [e("started")])).toEqual([]); // a crash before anything was written
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 9001, steps: 20000, seriesExists: true }, [e("started")]).join()).toMatch(/series.json but no finished entry/);
    expect(gateRun({ phase: "confirm", arm: "inherit", seed: 9001, steps: 20000, seriesExists: true }, [])).toEqual([]);
  });

  it("a fresh-seed entry outside confirm, or an invalid run, stops every logged phase but not smoke", () => {
    const leak = [e("finished", "inherit", 9002, "dev")];
    expect(logProblems(leak).join()).toMatch(/embargo is broken/);
    expect(ok("confirm", "inherit", 9001, 20000, leak).join()).toMatch(/embargo is broken/);
    expect(ok("dev", "inherit", 101, 20000, leak).join()).toMatch(/embargo is broken/);
    expect(ok("smoke", "inherit", 1, 400, leak)).toEqual([]);
    const inv = [e("invalid", "inherit", 101, "dev")];
    expect(ok("pass1", "inherit", 102, 20000, inv).join()).toMatch(/invalid run/);
    expect(ok("confirm", "inherit", 9001, 20000, inv).join()).toMatch(/ledger residual/);
    expect(logProblems([e("finished", "inherit", 9001)])).toEqual([]);
  });

  it("the confirmation batch refuses on a leak or an invalid run, and resumes: only unfinished pairs are pending", () => {
    expect(gateConfirmBatch([])).toEqual([]);
    expect(gateConfirmBatch([e("started")])).toEqual([]);
    expect(gateConfirmBatch([e("finished", "inherit", 9003, "pass1")]).join()).toMatch(/embargo/);
    expect(gateConfirmBatch([{ phase: "dev", arm: "inherit", seed: 101, steps: 20000, state: "finished" }])).toEqual([]);
    expect(pendingConfirm([])).toHaveLength(20);
    const done = [e("finished", "inherit", 9001), e("started", "inherit", 9002), e("finished", "frozen", 9005)];
    const todo = pendingConfirm(done).map((p) => `${p.arm}/${p.seed}`);
    expect(todo).toHaveLength(18);
    expect(todo).not.toContain("inherit/9001");
    expect(todo).toContain("inherit/9002"); // started only: runs again
    expect(todo[0]).toBe("inherit/9002");
    expect(pendingConfirm(CONFIRM_ALL_FINISHED())).toEqual([]);
  });
});

function CONFIRM_ALL_FINISHED(): SeedLogEntry[] {
  return (["inherit", "blocked", "physarum", "frozen"] as const).flatMap((arm) => FRESH_SEEDS.map((seed) => ({ phase: "confirm" as const, arm, seed, steps: 20000, state: "finished" as const })));
}

describe("FROZEN", () => {
  const files = { "tools/mycelium/world.ts": "1".repeat(64), "tools/mycelium/r2.ts": "2".repeat(64), "deno.json": "3".repeat(64) };
  const h = { protocol: "a".repeat(64), code: "b".repeat(64), files, calibration: "c".repeat(64) };
  const lines = Object.entries(files).map(([p, x]) => `${x}  ${p}`).join("\n");
  const text = `# Freeze 1\nprotocol_sha256: ${h.protocol}\ncode_hash: ${h.code}\n${lines}\n`;
  it("parses key: hash lines and shasum-format file lines, and ignores the rest", () => {
    const p = parseFrozen(`note\n${text}calibration_sha256: ${h.calibration}\nbad: xyz\n`);
    expect(p.keys).toEqual({ protocol_sha256: h.protocol, code_hash: h.code, calibration_sha256: h.calibration });
    expect(p.files).toEqual(files);
    expect(p.duplicates).toEqual([]);
  });
  it("a repeated key or file is reported, so Freeze 2 cannot re-record the code hash", () => {
    expect(parseFrozen(`${text}code_hash: ${"d".repeat(64)}\n`).duplicates).toEqual(["code_hash"]);
    expect(parseFrozen(`${text}${"4".repeat(64)}  deno.json\n`).duplicates).toEqual(["deno.json"]);
    expect(checkFrozen("dev", `${text}code_hash: ${"d".repeat(64)}\n`, h).join()).toMatch(/repeats code_hash/);
    expect(checkFrozen("confirm", `${text}calibration_sha256: ${h.calibration}\ncalibration_sha256: ${"d".repeat(64)}\n`, h).join()).toMatch(/repeats calibration_sha256/);
  });
  it("smoke needs nothing; dev needs Freeze 1; confirm needs Freeze 2", () => {
    expect(checkFrozen("smoke", null, h)).toEqual([]);
    expect(checkFrozen("dev", null, h).join()).toMatch(/does not exist/);
    expect(checkFrozen("pass1", text, h)).toEqual([]);
    expect(checkFrozen("dev", text, h)).toEqual([]);
    expect(checkFrozen("confirm", text, h).join()).toMatch(/Freeze 2 is missing/);
    expect(checkFrozen("confirm", `${text}calibration_sha256: ${h.calibration}\n`, h)).toEqual([]);
  });
  it("any changed hash refuses, and a changed file is named", () => {
    expect(checkFrozen("dev", text, { ...h, protocol: "d".repeat(64) }).join()).toMatch(/PROTOCOL.md differs/);
    expect(checkFrozen("dev", text, { ...h, code: "d".repeat(64) }).join()).toMatch(/code differs/);
    const t2 = `${text}calibration_sha256: ${h.calibration}\n`;
    expect(checkFrozen("confirm", t2, { ...h, calibration: "d".repeat(64) }).join()).toMatch(/CALIBRATION.json differs/);
    expect(checkFrozen("confirm", t2, { ...h, calibration: null }).join()).toMatch(/does not exist/);
    expect(checkFrozen("dev", "", h).join()).toMatch(/no protocol_sha256/);
    const changed = checkFrozen("dev", text, { ...h, files: { ...files, "tools/mycelium/world.ts": "9".repeat(64) } }).join();
    expect(changed).toMatch(/tools\/mycelium\/world.ts changed/);
    expect(checkFrozen("dev", text, { ...h, files: { ...files, "packages/schema/src/x.ts": "9".repeat(64) } }).join()).toMatch(/packages\/schema\/src\/x.ts not listed/);
    expect(checkFrozen("dev", text, { ...h, files: { "tools/mycelium/world.ts": files["tools/mycelium/world.ts"], "deno.json": files["deno.json"] } }).join()).toMatch(/tools\/mycelium\/r2.ts missing/);
    expect(checkFrozen("dev", `protocol_sha256: ${h.protocol}\ncode_hash: ${h.code}\n`, h).join()).toMatch(/no per-file hashes/);
  });
  it("the manifest text is sorted by path in plain string order, one shasum line per file", () => {
    expect(manifestText({ "b.ts": "2".repeat(64), "a.ts": "1".repeat(64), "B.ts": "3".repeat(64) })).toBe(`${"3".repeat(64)}  B.ts\n${"1".repeat(64)}  a.ts\n${"2".repeat(64)}  b.ts\n`);
  });
  it("code_hash is a function of file contents alone: nothing about git or the checkout enters", () => {
    const sha = (t: string) => createHash("sha256").update(t).digest("hex");
    const a = sha(manifestText(files)), b = sha(manifestText({ ...files, "tools/mycelium/world.ts": "9".repeat(64) }));
    expect(a).not.toBe(b);
    expect(sha(manifestText({ ...files }))).toBe(a);
  });
});

describe("the provenance chain", () => {
  const code = "b".repeat(64);
  it("calibration and every run file must carry FROZEN's code hash", () => {
    expect(checkProvenance(code, code, [{ path: "r1", codeHash: code }])).toEqual([]);
    expect(checkProvenance(code, undefined, [{ path: "r1", codeHash: code }])).toEqual([]);
    expect(checkProvenance(code, "d".repeat(64), [{ path: "r1", codeHash: code }]).join()).toMatch(/CALIBRATION.json was made under code/);
    expect(checkProvenance(code, null, []).join()).toMatch(/none recorded/);
    expect(checkProvenance(code, code, [{ path: "r1", codeHash: code }, { path: "r2", codeHash: "d".repeat(64) }]).join()).toMatch(/1 run file\(s\).*r2/);
    expect(checkProvenance(code, code, [{ path: "smoke", codeHash: null }]).join()).toMatch(/no code hash/);
  });
});

describe("the calibration provenance check the runner makes before the first fresh seed", () => {
  const frozen = { code_hash: "b".repeat(64), protocol_sha256: "a".repeat(64) };
  it("needs the frozen code and protocol hashes in CALIBRATION.json", () => {
    expect(checkCalibrationProvenance({ codeHash: frozen.code_hash, protocolSha256: frozen.protocol_sha256 }, frozen)).toEqual([]);
    expect(checkCalibrationProvenance({ codeHash: "d".repeat(64), protocolSha256: frozen.protocol_sha256 }, frozen).join()).toMatch(/made under code/);
    expect(checkCalibrationProvenance({ codeHash: frozen.code_hash, protocolSha256: "d".repeat(64) }, frozen).join()).toMatch(/made under protocol/);
    expect(checkCalibrationProvenance({}, frozen)).toHaveLength(2);
    expect(checkCalibrationProvenance({ codeHash: null, protocolSha256: null }, {})).toHaveLength(2);
  });
});

describe("the calibration gate on confirmation", () => {
  const good = { verdict: null, kept: ["R1", "R2"] as ReadoutId[], theta: 6, reasons: [] as string[] };
  it("allows a usable calibration and refuses a limiting one, a short kept set or a bad theta", () => {
    expect(checkCalibrationForConfirm(good)).toEqual([]);
    expect(checkCalibrationForConfirm({ ...good, verdict: "MEASUREMENT-LIMITED", reasons: ["both positive controls are unusable"] }).join()).toMatch(/MEASUREMENT-LIMITED.*both positive controls/);
    expect(checkCalibrationForConfirm({ ...good, kept: ["R1"] }).join()).toMatch(/fewer than 2/);
    expect(checkCalibrationForConfirm({ ...good, theta: 1 }).join()).toMatch(/theta/);
  });
  it("agrees with calibrate(): a calibration that returns a limiting verdict is refused", () => {
    const b = { R1: [9, 11, 10, 12, 8], R2: [19, 21, 20, 22, 18], R3: [29, 31, 30, 32, 28], R4: [39, 41, 40, 42, 38] };
    const t = table(DEV_SEEDS, { inherit: b, blocked: b, physarum: b, frozen: b, "pc-light": b, "pc-decay": b });
    const cal = calibrate(t, 6); // no control moves anything: nothing is kept
    expect(cal.verdict).toBe("MEASUREMENT-LIMITED");
    expect(checkCalibrationForConfirm(cal).length).toBeGreaterThan(0);
  });
});

describe("the effect test", () => {
  it("needs |D| > NF and at least 4 of 5 seeds supporting it (sign of D, size above NF/2); a zero never supports", () => {
    expect(separation([5, 5, 5, 5, 5], 4)).toMatchObject({ D: 5, agree: 5, separates: true });
    expect(separation([5, 5, 5, 5, 5], 5).separates).toBe(false); // |D| = NF is not above it
    expect(separation([9, 9, 9, 9, -1], 4)).toMatchObject({ agree: 4, separates: true });
    expect(separation([9, 9, 9, -1, -1], 4)).toMatchObject({ agree: 3, separates: false });
    expect(separation([10, 10, 10, 10, 0], 4)).toMatchObject({ agree: 4, separates: true });
    expect(separation([10, 10, 10, 0, 0], 4)).toMatchObject({ agree: 3, separates: false });
    expect(separation([-6, -6, -6, -6, -6], 4)).toMatchObject({ D: -6, agree: 5, separates: true });
    expect(separation([0, 0, 0, 0, 0], 0)).toMatchObject({ agree: 0, separates: false });
  });
  it("one extreme seed cannot carry the mean: four tiny same-sign differences and one large one do not separate", () => {
    const r = separation([0.001, 0.001, 0.001, 0.001, 0.8], 0.1); // D = 0.1608 > NF, all five signs agree
    expect(r.D).toBeGreaterThan(0.1);
    expect(r.signs).toEqual([1, 1, 1, 1, 1]);
    expect(r).toMatchObject({ agree: 1, separates: false });
  });
  it("the per-seed floor is NF/2 (one SD): a seed at exactly NF/2 does not support, just above does", () => {
    expect(separation([1.5, 1.5, 1.5, 1.5, 10], 3)).toMatchObject({ agree: 1, separates: false }); // D = 3.2 > NF 3, but 1.5 = NF/2 is not above it
    expect(separation([1.51, 1.51, 1.51, 1.51, 10], 3)).toMatchObject({ agree: 5, separates: true });
  });
  it("sd is the sample standard deviation", () => {
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138089935, 8);
  });
});

/** Build a table: vals[arm] = per-readout arrays of five values (index = seed order). */
function table(seeds: readonly number[], vals: Partial<Record<AnyArm, Record<ReadoutId, number[]>>>, tripped: Partial<Record<AnyArm, number[]>> = {}): RunTable {
  const t: RunTable = {};
  for (const arm of Object.keys(vals) as AnyArm[]) {
    t[arm] = {};
    seeds.forEach((s, k) => {
      const v = vals[arm]!;
      t[arm]![s] = rs(v.R1[k], v.R2[k], v.R3[k], v.R4[k], (tripped[arm] ?? []).includes(s));
    });
  }
  return t;
}
const rep = (a: number[], k: number) => a.map((v) => v + k);
const flat = (x: number): Record<ReadoutId, number[]> => ({ R1: [x, x, x, x, x], R2: [x, x, x, x, x], R3: [x, x, x, x, x], R4: [x, x, x, x, x] });
/** A readout array with a little noise of sd 1: [-1, 1, 0, 2, -2]/... around a base. */
const noisy = (base: number) => [base - 1, base + 1, base, base + 2, base - 2];

describe("calibration (dev seeds)", () => {
  const dev = DEV_SEEDS;
  const base = (): Partial<Record<AnyArm, Record<ReadoutId, number[]>>> => {
    const b: Record<ReadoutId, number[]> = { R1: [0.4, 0.6, 0.5, 0.7, 0.3], R2: noisy(20), R3: noisy(30), R4: noisy(40) }; // R1 is a share: SD 0.158, NF 0.316
    return { inherit: b, blocked: b, physarum: b, frozen: b, "pc-light": b, "pc-decay": b };
  };

  it("noise floors are per contrast: 2 x the larger SD of the two arms compared; a zero floor drops the readout", () => {
    const v = base();
    v.blocked = { ...v.blocked!, R1: [0.5, 0.5, 0.5, 0.5, 0.5] };
    v.inherit = { ...v.inherit!, R2: [20, 20, 20, 20, 20] };
    v.physarum = { ...v.physarum!, R2: [20, 20, 20, 20, 20] };
    v.blocked = { ...v.blocked!, R2: [20, 20, 20, 20, 20] };
    const cal = calibrate(table(dev, v), 6);
    // R1 SDs: inherit sqrt(0.025)=0.1581, blocked 0, physarum 0.1581
    expect(cal.nf.R1!.blocked).toBeCloseTo(2 * Math.sqrt(0.025), 10); // inherit vs blocked: the larger is inherit's
    expect(cal.nf.R1!.physarum).toBeCloseTo(2 * Math.sqrt(0.025), 10);
    expect(cal.nf.R2).toEqual({ blocked: 0, physarum: 0 });
    expect(cal.dropped).toEqual(["R2"]);
    expect(cal.dropReasons.R2).toMatch(/floor is 0/);
    expect(cal.controls["pc-light"].effects.R2).toBeUndefined();
  });

  it("the physarum SD sets only the physarum floor: an erratic physarum arm leaves the blocked contrast alone", () => {
    const v = base();
    v.physarum = { ...v.physarum!, R2: [0, 0, 0, 40, 40] }; // SD 21.9, far above the others' 1.58
    const cal = calibrate(table(dev, v), 6);
    expect(cal.nf.R2!.blocked).toBeCloseTo(2 * Math.sqrt(2.5), 10);
    expect(cal.nf.R2!.physarum).toBeCloseTo(2 * sd([0, 0, 0, 40, 40]), 10);
  });

  it("a bounded readout whose blocked floor reaches its largest possible effect is dropped; one whose physarum floor does is flagged", () => {
    const v = base();
    v.inherit = { ...v.inherit!, R1: [0.2, 0.9, 0.3, 0.8, 0.5] };
    v.blocked = { ...v.blocked!, R1: [0.1, 0.1, 0.1, 0.1, 0.1] };
    v.physarum = { ...v.physarum!, R1: [0, 0, 0, 1, 1] }; // SD 0.548, floor 1.095
    const cal = calibrate(table(dev, v), 6);
    expect(cal.nf.R1!.blocked).toBeLessThan(1);
    expect(cal.nf.R1!.physarum).toBeGreaterThan(1);
    expect(cal.dropped).not.toContain("R1");
    expect(cal.unreachableVsPhysarum).toEqual(["R1"]);
    v.blocked = { ...v.blocked!, R1: [0, 1, 0, 1, 0.5] };
    v.inherit = { ...v.inherit!, R1: [0, 1, 1, 0, 0.5] };
    const c2 = calibrate(table(dev, v), 6);
    expect(c2.dropped).toContain("R1");
    expect(c2.dropReasons.R1).toMatch(/largest possible effect/);
  });

  it("R1 is dropped as degenerate when its dev mean is under 0.05 in both inherit and blocked, whatever physarum does", () => {
    const v = base();
    v.inherit = { ...v.inherit!, R1: [0, 0.02, 0, 0.04, 0.01] };
    v.blocked = { ...v.blocked!, R1: [0, 0, 0.01, 0, 0.03] };
    v.physarum = { ...v.physarum!, R1: [0, 0, 0, 0, 0] };
    const cal = calibrate(table(dev, v), 6);
    expect(cal.dropped).toEqual(["R1"]);
    expect(cal.dropReasons.R1).toMatch(/degenerate/);
    v.inherit = { ...v.inherit!, R1: [0.4, 0.5, 0.6, 0.5, 0.45] };
    expect(calibrate(table(dev, v), 6).dropped).toEqual([]); // inherit is not near 0: R1 stays, though blocked and physarum are
    const w = base();
    w.blocked = { ...w.blocked!, R1: [0.01, 0.02, 0, 0.03, 0.01] };
    expect(calibrate(table(dev, w), 6).dropped).toEqual([]); // inherit near 10: not degenerate
  });

  it("records the informational dev contrasts with the confirmation's test, and they change nothing", () => {
    const v = base();
    v.blocked = { ...v.blocked!, R2: rep(v.inherit!.R2, -20) };
    const cal = calibrate(table(dev, v), 6);
    expect(cal.devContrasts.R2!.blocked).toMatchObject({ D: 20, separates: true });
    expect(cal.devContrasts.R2!.physarum).toMatchObject({ D: 0, separates: false });
    expect(cal.devContrasts.R1!.blocked.d).toEqual([0, 0, 0, 0, 0]);
  });

  it("keeps a readout only if a control moves it by more than the blocked NF on at least 4 seeds", () => {
    const v = base();
    v["pc-light"] = { R1: rep(v.inherit!.R1, 0.5), R2: rep(v.inherit!.R2, 0.1), R3: v.inherit!.R3, R4: rep(v.inherit!.R4, 3) };
    v["pc-decay"] = { R1: v.inherit!.R1, R2: v.inherit!.R2, R3: v.inherit!.R3.map((x, k) => x + (k === 4 ? -9 : 9)), R4: v.inherit!.R4 };
    const cal = calibrate(table(dev, v), 6);
    // NF = 0.316 for R1 and 2 * sqrt(2.5) = 3.162 for R2-R4, for either contrast
    expect(cal.verdict).toBeNull();
    expect(cal.dropped).toEqual([]);
    expect(cal.kept).toEqual(["R1", "R3"]); // R1 by light (+0.5), R3 by decay (+9 on 4 of 5), R2 (+0.1) and R4 (+3 < 3.16) not
    expect(cal.controls["pc-light"].effects.R1).toMatchObject({ agree: 5, separates: true });
    expect(cal.controls["pc-decay"].effects.R3).toMatchObject({ agree: 4, separates: true });
    expect(cal.controls["pc-light"].effects.R4).toMatchObject({ separates: false });
  });

  it("fewer than 2 kept readouts is MEASUREMENT-LIMITED", () => {
    const v = base();
    v["pc-light"] = { ...v.inherit!, R1: rep(v.inherit!.R1, 0.5) };
    const cal = calibrate(table(dev, v), 6);
    expect(cal.kept).toEqual(["R1"]);
    expect(cal.verdict).toBe("MEASUREMENT-LIMITED");
    expect(cal.reasons.join()).toMatch(/fewer than 2/);
  });

  it("a guard trip on inherit, blocked or physarum ends calibration; a tripped control is ignored; both tripped is limiting", () => {
    const v = base();
    v["pc-light"] = { ...v.inherit!, R1: rep(v.inherit!.R1, 0.5), R2: rep(v.inherit!.R2, 20) };
    const t1 = calibrate(table(dev, v, { physarum: [103] }), 6);
    expect(t1.verdict).toBe("MEASUREMENT-LIMITED");
    expect(t1.guardTrips).toEqual([{ arm: "physarum", seed: 103 }]);
    expect(t1.kept).toEqual([]);
    const t2 = calibrate(table(dev, v, { "pc-decay": [101] }), 6);
    expect(t2.controls["pc-decay"].usable).toBe(false);
    expect(t2.kept).toEqual(["R1", "R2"]);
    expect(t2.verdict).toBeNull();
    const t3 = calibrate(table(dev, v, { "pc-decay": [101], "pc-light": [105] }), 6);
    expect(t3.verdict).toBe("MEASUREMENT-LIMITED");
    expect(t3.reasons.join()).toMatch(/both positive controls/);
  });

  it("frozen is read for presence only and never changes the floors", () => {
    const v = base();
    const withFrozen = calibrate(table(dev, v), 6);
    v.frozen = { R1: [1, 900, 3, 4, 5], R2: [1, 2, 3, 4, 5], R3: [1, 2, 3, 4, 5], R4: [1, 2, 3, 4, 5] };
    expect(calibrate(table(dev, v), 6).nf).toEqual(withFrozen.nf);
  });
});

describe("the verdicts", () => {
  const fresh = FRESH_SEEDS;
  const cal = (kept: ReadoutId[] = ["R1", "R2", "R3"]): Pick<Calibration, "kept" | "nf" | "verdict" | "reasons"> => ({
    kept, nf: { R1: { blocked: 1, physarum: 1 }, R2: { blocked: 1, physarum: 1 }, R3: { blocked: 1, physarum: 1 }, R4: { blocked: 1, physarum: 1 } }, verdict: null, reasons: [],
  });
  /** inherit = 10 everywhere; blocked and physarum differ by `b` and `p` per readout. */
  function build(b: Partial<Record<ReadoutId, number>>, p: Partial<Record<ReadoutId, number>>, tripped: Partial<Record<AnyArm, number[]>> = {}): RunTable {
    const arm = (delta: Partial<Record<ReadoutId, number>>) => {
      const o = {} as Record<ReadoutId, number[]>;
      for (const id of READOUT_IDS) o[id] = rep(flat(10)[id], -(delta[id] ?? 0));
      return o;
    };
    return table(fresh, { inherit: flat(10), blocked: arm(b), physarum: arm(p), frozen: flat(10) }, tripped);
  }

  it("PASS: at least two readouts separate inherit from both; the ordering is reported and conditions nothing", () => {
    const d = decide(build({ R1: 5, R2: 5, R3: 5 }, { R1: 5, R2: -5, R3: 0 }), cal());
    expect(d.label).toBe("PASS");
    expect(d.sepBoth).toEqual(["R1", "R2"]);
    expect(d.sepBlocked).toEqual(["R1", "R2", "R3"]);
    // physarum sits above inherit on R2 (15 against 10) and blocked below it: inherit is BETWEEN them (D = +5 and -5); on R1 it is beyond both.
    expect(d.tests.R2!.physarum.D).toBe(-5);
    expect(d.ordering).toEqual({ R1: "beyond", R2: "between" });
  });

  it("a PASS whose readouts are all between is still a PASS, labelled as such in the ordering", () => {
    const d = decide(build({ R1: 5, R2: 5 }, { R1: -5, R2: -5 }), cal(["R1", "R2"]));
    expect(d.label).toBe("PASS");
    expect(d.ordering).toEqual({ R1: "between", R2: "between" });
  });

  it("FAIL: no kept readout separates inherit from blocked, whatever physarum shows", () => {
    expect(decide(build({ R1: 0.5 }, { R1: 5, R2: 5 }), cal()).label).toBe("FAIL");
  });

  it("NOT-SEPARATED-FROM-PHYSARUM: separates from blocked but from no readout on both", () => {
    const d = decide(build({ R1: 5, R2: 5 }, { R3: 5 }), cal());
    expect(d.label).toBe("NOT-SEPARATED-FROM-PHYSARUM");
    expect(d.sepPhysarum).toEqual(["R3"]);
    expect(d.sepBoth).toEqual([]);
  });

  it("a physarum that differs from inherit on every seed but fails the test is not-separated, not 'explaining'", () => {
    // d = [0.8, 0.8, 0.8, -0.1, -0.1] against a floor of 0.1: D = 0.44 > NF, but only 3 seeds support
    const t = build({ R1: 5, R2: 5 }, {});
    [0.8, 0.8, 0.8, -0.1, -0.1].forEach((x, k) => { t.physarum![fresh[k]].readouts.R1 = 10 - x; t.physarum![fresh[k]].readouts.R2 = 10 - x; });
    const c = cal(["R1", "R2"]);
    c.nf.R1 = { blocked: 1, physarum: 0.1 }; c.nf.R2 = { blocked: 1, physarum: 0.1 };
    const d = decide(t, c);
    expect(d.tests.R1!.physarum).toMatchObject({ agree: 3, separates: false });
    expect(d.label).toBe("NOT-SEPARATED-FROM-PHYSARUM");
  });

  it("each contrast uses its own floor", () => {
    const c = cal(["R1", "R2"]);
    c.nf.R1 = { blocked: 1, physarum: 8 }; // inherit - physarum is 5: below its floor
    const d = decide(build({ R1: 5, R2: 5 }, { R1: 5, R2: 5 }), c);
    expect(d.tests.R1!.blocked.separates).toBe(true);
    expect(d.tests.R1!.physarum.separates).toBe(false);
    expect(d.sepBoth).toEqual(["R2"]);
    expect(d.label).toBe("PARTIAL");
  });

  it("PARTIAL: exactly one readout separates from both", () => {
    const d = decide(build({ R1: 5, R2: 5 }, { R1: 5 }), cal());
    expect(d.label).toBe("PARTIAL");
    expect(d.sepBoth).toEqual(["R1"]);
  });

  it("MEASUREMENT-LIMITED beats everything: a guard trip on a fresh seed, a limiting calibration, or fewer than 2 kept", () => {
    const strong = { R1: 5, R2: 5, R3: 5 };
    const t = decide(build(strong, strong, { physarum: [9003] }), cal());
    expect(t.label).toBe("MEASUREMENT-LIMITED");
    expect(t.reasons.join()).toMatch(/physarum 9003/);
    expect(decide(build(strong, strong), { ...cal(), verdict: "MEASUREMENT-LIMITED", reasons: ["x"] }).label).toBe("MEASUREMENT-LIMITED");
    expect(decide(build(strong, strong), cal(["R1"])).label).toBe("MEASUREMENT-LIMITED");
    // frozen tripping does not matter, since it is reported only
    const tf = build(strong, strong);
    tf.frozen![9001].guardTripped = true;
    expect(decide(tf, cal()).label).toBe("PASS");
  });

  it("a readout inside the floor, or with fewer than 4 supporting seeds, does not separate", () => {
    const t = build({ R1: 5, R2: 5, R3: 5 }, { R1: 5, R2: 5, R3: 5 });
    t.blocked![9001].readouts.R1 = 15; t.blocked![9002].readouts.R1 = 15; // inherit - blocked = -5 on two seeds, +5 on three: D = 1, inside NF 1? |D| = 1 is not > 1
    expect(decide(t, cal()).tests.R1!.blocked.separates).toBe(false);
    const u = build({ R1: 5, R2: 5 }, { R1: 5, R2: 5 });
    u.physarum![9001].readouts.R2 = 10; u.physarum![9002].readouts.R2 = 10; // difference 0 on two seeds, 5 on three: 3 supporting seeds
    const d = decide(u, cal(["R1", "R2"]));
    expect(d.tests.R2!.physarum).toMatchObject({ agree: 3, separates: false });
    expect(d.label).toBe("PARTIAL");
  });

  it("one outlier seed cannot make a PASS: the same seed driving two readouts is four tiny differences and one large", () => {
    const t = build({}, {});
    for (const arm of ["blocked", "physarum"] as const) for (const id of ["R1", "R2"] as const) t[arm]![9005].readouts[id] = 10 - 8; // d = +8 on one seed, 0 elsewhere
    const c = cal(["R1", "R2"]);
    c.nf.R1 = { blocked: 1, physarum: 1 }; c.nf.R2 = { blocked: 1, physarum: 1 };
    const d = decide(t, c);
    expect(d.tests.R1!.blocked.D).toBeCloseTo(1.6, 12); // above the floor of 1
    expect(d.tests.R1!.blocked).toMatchObject({ agree: 1, separates: false });
    expect(d.label).toBe("FAIL");
  });

  it("every outcome label is reachable and exactly one applies", () => {
    const seen = new Set<string>();
    const strong = { R1: 5, R2: 5, R3: 5 };
    seen.add(decide(build(strong, strong), cal()).label);
    seen.add(decide(build({}, strong), cal()).label);
    seen.add(decide(build({ R1: 5, R2: 5 }, {}), cal()).label);
    seen.add(decide(build({ R1: 5, R2: 5 }, { R1: 5 }), cal()).label);
    seen.add(decide(build(strong, strong), cal(["R1"])).label);
    expect([...seen].sort()).toEqual(["FAIL", "MEASUREMENT-LIMITED", "NOT-SEPARATED-FROM-PHYSARUM", "PARTIAL", "PASS"]);
  });

  it("the labels partition the outcomes: over a grid of blocked and physarum effects, exactly one label is returned and PASS needs two separating both", () => {
    const sizes = [0, 0.4, 5];
    for (const b1 of sizes) for (const b2 of sizes) for (const p1 of sizes) for (const p2 of sizes) {
      const d = decide(build({ R1: b1, R2: b2 }, { R1: p1, R2: p2 }), cal(["R1", "R2"]));
      expect(["PASS", "FAIL", "NOT-SEPARATED-FROM-PHYSARUM", "PARTIAL"]).toContain(d.label);
      expect(d.label === "PASS").toBe(d.sepBoth.length >= 2);
      expect(d.label === "FAIL").toBe(d.sepBlocked.length === 0);
      expect(d.label === "PARTIAL").toBe(d.sepBlocked.length > 0 && d.sepBoth.length === 1);
      expect(d.label === "NOT-SEPARATED-FROM-PHYSARUM").toBe(d.sepBlocked.length > 0 && d.sepBoth.length === 0);
    }
  });
});

describe("the command lines refuse before doing anything", () => {
  const run = (script: string, args: string[]) => spawnSync("deno", ["run", "--no-lock", "-A", `tools/mycelium/${script}`, ...args], { cwd: new URL("../..", import.meta.url).pathname, encoding: "utf8" });

  it("run.ts refuses seeds of 9001 and above, and NaN", () => {
    for (const seed of ["9001", "9005", "123456", "x"]) {
      const r = run("run.ts", ["--steps", "10", "--seed", seed]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/reserved for the R2 confirmation/);
    }
  });

  it("r2.ts confirm is batch-only: --arm, --seed and a missing --all are refused, as is --theta", () => {
    const a = run("r2.ts", ["--phase", "confirm", "--arm", "inherit", "--seed", "9001", "--out", "/nonexistent-r2-test"]);
    expect(a.status).toBe(2);
    expect(a.stderr).toMatch(/batch-only/);
    const b = run("r2.ts", ["--phase", "confirm", "--all", "--seed", "9001", "--out", "/nonexistent-r2-test"]);
    expect(b.status).toBe(2);
    expect(b.stderr).toMatch(/refused in confirm/);
    const c = run("r2.ts", ["--phase", "confirm", "--all", "--theta", "4", "--out", "/nonexistent-r2-test"]);
    expect(c.status).toBe(2);
    expect(c.stderr).toMatch(/--theta is refused/);
  });
});
