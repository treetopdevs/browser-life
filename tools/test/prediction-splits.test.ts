// Splits and leak checks (PLAN.md, section 7).
import { describe, expect, it } from "vitest";
import { assertNoLeak, assignSplits, derangement, donorAllowed, donorsFor } from "../lib/prediction/splits.ts";
import { FEED, censusSeries, synthEnv } from "./prediction-helpers.ts";

const ids = Array.from({ length: 12 }, (_, i) => `f${i}`);

describe("splits", () => {
  it("never lets a family straddle dev and test, and qualify lies inside dev", () => {
    const p = assignSplits(ids, "salt", 6, 2);
    expect(p.dev).toHaveLength(6);
    expect(p.test).toHaveLength(6);
    expect(p.dev.filter((f) => p.test.includes(f))).toEqual([]);
    expect(p.qualify.every((f) => p.dev.includes(f))).toBe(true);
    expect([...p.dev, ...p.test].sort()).toEqual([...ids].sort());
  });
  it("is deterministic under input permutation and depends on the salt", () => {
    const a = assignSplits(ids, "salt", 6, 2);
    expect(assignSplits([...ids].reverse(), "salt", 6, 2)).toEqual(a);
    expect(assignSplits(ids, "other", 6, 2)).not.toEqual(a);
  });
  it("a derangement has no fixed point and stays inside its split", () => {
    const p = assignSplits(ids, "salt", 6, 2);
    const d = donorsFor(p, "salt");
    for (const f of p.dev) expect(p.dev).toContain(d[f]);
    for (const f of p.test) expect(p.test).toContain(d[f]);
    for (const f of ids) expect(d[f]).not.toBe(f);
    expect(new Set(Object.values(d)).size).toBe(ids.length);
    expect(derangement(["a", "b"], "s")).toEqual({ a: "b", b: "a" });
    expect(() => derangement(["a"], "s")).toThrow();
  });
  it("donorAllowed refuses the same family, the same history and another split", () => {
    const a = { familyId: "fA", historyId: "fA:s1" };
    const sp = (f: string) => (f === "fX" ? "test" : "dev") as "dev" | "test";
    expect(donorAllowed(a, { familyId: "fA", historyId: "fA:s2" }, sp).ok).toBe(false);
    expect(donorAllowed(a, { familyId: "fB", historyId: "fA:s1" }, sp).ok).toBe(false);
    expect(donorAllowed(a, { familyId: "fX", historyId: "fX:s1" }, sp).ok).toBe(false);
    expect(donorAllowed(a, { familyId: "fB", historyId: "fB:s1" }, sp).ok).toBe(true);
  });
});

describe("assertNoLeak", () => {
  const p = assignSplits(ids, "salt", 6, 2);
  const d = donorsFor(p, "salt");
  const envs = ids.map((f, i) => synthEnv(FEED, { familyId: f, caseId: `c${f}`, census: censusSeries(1000 + i, 1) }));
  it("is clean on a sound plan", () => {
    expect(assertNoLeak(p, d, envs)).toEqual([]);
  });
  it("fails on an injected shared family", () => {
    expect(assertNoLeak({ ...p, test: [...p.test, p.dev[0]] }, d, envs).join()).toMatch(/both dev and test/);
  });
  it("fails on a bad donor (self or cross-split)", () => {
    expect(assertNoLeak(p, { ...d, [p.dev[0]]: p.dev[0] }, envs).join()).toMatch(/own donor/);
    expect(assertNoLeak(p, { ...d, [p.dev[0]]: p.test[0] }, envs).join()).toMatch(/another split/);
  });
  it("fails when a test envelope carries a dev census, or a history sits under two families", () => {
    const dup = envs.map((e) => (e.familyId === p.test[0] ? { ...e, census: envs.find((x) => x.familyId === p.dev[0])!.census } : e));
    expect(assertNoLeak(p, d, dup).join()).toMatch(/dev census/);
    const hist = envs.map((e) => (e.familyId === p.test[0] ? { ...e, historyId: envs[0].historyId } : e));
    expect(assertNoLeak(p, d, hist).join()).toMatch(/two families/);
  });
});
