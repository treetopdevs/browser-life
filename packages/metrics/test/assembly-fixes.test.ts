// Regression tests for the source-review fixes: budgets that bind, honest statuses, vacuous verdict inputs, diagnostics.
import { describe, expect, it } from "vitest";
import { boundConstruction } from "../src/assembly/bound.ts";
import { ConstructionService } from "../src/assembly/construct.ts";
import { code } from "../src/assembly/grammar.ts";
import { deriveVerdicts, validateCalibration, type ClassResult } from "../src/assembly/observer.ts";
import { patchReadouts } from "../src/assembly/readouts.ts";
import { PROTOCOL } from "../src/assembly/protocol.ts";
import { isOne, pairAccuracy } from "../src/assembly/verdict.ts";

const line8 = Array.from({ length: 8 }, (_, i) => code(i, 0));

describe("budgets bind", () => {
  it("the beam never creates more children than nodeCap and falls back to the chain", () => {
    const cells = [code(0, 0), code(1, 0), code(0, 1), code(1, 1)].concat([code(8, 8)]);
    for (const cap of [1, 2, 4, 7]) {
      const r = boundConstruction(cells, { conn: 4, beamW: PROTOCOL.beamW, nodeCap: cap, maxCand: PROTOCOL.maxCand });
      expect(r.nodes, `cap ${cap}`).toBeLessThanOrEqual(cap);
    }
    // the reviewer's probe: two far-apart dominoes with a tiny cap cannot finish inside it
    const far = [0, 1, 1024, 1025];
    const probe = boundConstruction(far, { conn: 4, beamW: PROTOCOL.beamW, nodeCap: 4, maxCand: PROTOCOL.maxCand });
    expect(probe.nodes).toBeLessThanOrEqual(4);
    expect(probe.fallback).toBe(true);
    const tight = boundConstruction(line8, { conn: 4, beamW: PROTOCOL.beamW, nodeCap: 3, maxCand: PROTOCOL.maxCand });
    expect(tight.fallback).toBe(true);
    expect(tight.cost).toBe(7);
    expect(tight.nodes).toBeLessThanOrEqual(3);
    const roomy = boundConstruction(line8, { conn: 4, beamW: PROTOCOL.beamW, nodeCap: PROTOCOL.boundNodeCap, maxCand: PROTOCOL.maxCand });
    expect(roomy.fallback).toBe(false);
    expect(roomy.cost).toBeLessThan(7);
  });

  it("the global node allowance is a hard limit", () => {
    const spent = new ConstructionService(0);
    expect(spent.solve(line8, 4)).toEqual({ a: 7, status: "limited" });
    expect(spent.nodes).toBe(0);
    // an allowance smaller than one solve: the solve gets only what remains and never overshoots it
    const small = new ConstructionService(5);
    const r = small.solve(line8, 4);
    expect(small.nodes).toBeLessThanOrEqual(5);
    for (const lim of [1, 2, 3, 5, 9]) { const sv = new ConstructionService(lim); sv.solve(line8, 4); expect(sv.nodes, `limit ${lim}`).toBeLessThanOrEqual(lim); }
    expect(r.status).not.toBe("exact");
    // a roomy allowance still solves exactly
    expect(new ConstructionService().solve(line8, 4)).toEqual({ a: 3, status: "exact" });
  });
});

describe("empty or missing comparisons are never a separation", () => {
  it("0/0 accuracy is not one", () => {
    expect(isOne(pairAccuracy([], [], "lower"))).toBe(false);
    expect(isOne({ num: 0, den: 0 })).toBe(false);
  });

  it("deriveVerdicts rejects a set with a class removed or emptied", () => {
    const row = (replicate: number) => ({ replicate }) as unknown as ClassResult["replicates"][number];
    const mk = (id: string, n: number): ClassResult => ({ id: id as never, role: "", matched: false, replicates: Array.from({ length: n }, (_, i) => row(i)) });
    const ids = ["hier-12", "random-dup", "random-dup-hi", "random-dup-12", "seam-hier-12", "seam-dup-12"];
    expect(validateCalibration(ids.map((i) => mk(i, 3)), 3)).toEqual([]);
    expect(validateCalibration(ids.filter((i) => i !== "random-dup-12").map((i) => mk(i, 3)), 3).join()).toContain("required class random-dup-12 is missing");
    expect(validateCalibration(ids.map((i) => mk(i, i === "random-dup-12" ? 0 : 3)), 3).join()).toContain("random-dup-12 has 0 replicates");
    expect(validateCalibration(ids.map((i) => mk(i, 3)), 0).join()).toContain("not a positive integer");
    // a rational with a zero denominator inside a stored readout is structurally invalid
    const bad = ids.map((i) => ({ ...mk(i, 3), replicates: Array.from({ length: 3 }, (_, k) => ({ replicate: k, primary: { construction: { reuseRatio: { num: 1, den: i === "random-dup" ? 0 : 2 } } }, conn8: {} }) as never) }));
    expect(validateCalibration(bad, 3).join()).toContain("random-dup[0].primary.construction.reuseRatio is not a valid rational");
    expect(() => deriveVerdicts(ids.map((i) => mk(i, i === "random-dup-12" ? 0 : 16)))).toThrow(/invalid calibration set/);
  });
});

describe("diagnostics", () => {
  it("class count of D4 on 8-connectivity always segments with 8-connectivity", () => {
    // cells (3,3),(4,3),(5,4): two 4-components, one 8-component
    const w = 16, h = 16;
    const f = new Uint8Array(w * h);
    for (const [x, y] of [[3, 3], [4, 3], [5, 4]]) f[y * w + x] = 1;
    const svc = new ConstructionService();
    const r4 = patchReadouts(f, w, h, { conn: 4, tau: 1 }, svc);
    const r8 = patchReadouts(f, w, h, { conn: 8, tau: 1 }, svc);
    expect(r4.equiv.classesD4on8).toBe(1);
    expect(r8.equiv.classesD4on8).toBe(1);
    expect(r8.equiv.spread).toBe(0);
  });
});
