// CPU fixtures (PLAN.md, section 6): paired replays on small worlds with short windows. Expectations come from the mechanisms and the
// invariants, not from tuning. Explicit per-test timeouts (the fixture runs take a few seconds).
import { describe, expect, it } from "vitest";
import { census } from "@bl/metrics";
import { cellCount, CH, G, stateHash, totalsOf, worldW } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { CpuInterventionAdapter } from "../lib/prediction/adapter.ts";
import { assertNoPostFork, envelopeIntact, frameOf, hashEnvelopeBody, envelopeBody } from "../lib/prediction/envelope.ts";
import { assertFixtureBounds, checkBooks, heaviestCell, emptiestCell, labelOf, makeWorld, plannedCellSteps, runFamily } from "../lib/prediction/fixtures.ts";
import { freeNutrient, livingCells, totalMass } from "../lib/prediction/readouts.ts";
import { generate, trendConfoundOf, type CaseRow } from "../lib/prediction/run.ts";
import { tinyProtocol } from "./prediction-helpers.ts";

const T = 120_000;

describe("readouts", () => {
  it("livingCells equals the census's livingCells, freeNutrient and totalMass equal channel sums", () => {
    const p = tinyProtocol();
    const s = makeWorld(p, p.families[0]);
    const sim = new RefSim(s);
    sim.run(30);
    const n = cellCount(sim.cfg);
    const c = census({ step: sim.state.step, cfg: sim.cfg, cells: sim.state.cells, genomeHead: sim.state.genome.subarray(0, G.LIN_LO * n + n) } as never);
    expect(livingCells(sim.state)).toBe(c.livingCells);
    let a = 0, bp = 0;
    for (let i = 0; i < n; i++) {
      a += sim.state.cells[CH.A * n + i];
      bp += sim.state.cells[CH.B * n + i] + sim.state.cells[CH.P * n + i];
    }
    expect(freeNutrient(sim.state)).toBe(a);
    expect(totalMass(sim.state)).toBe(bp);
  }, T);
});

describe("CPU intervention adapter", () => {
  const p = tinyProtocol();
  const s0 = makeWorld(p, p.families[0]);
  const start = totalsOf(s0.cfg, s0.cells);
  it("is independent of its source and of other arms", () => {
    const a = new CpuInterventionAdapter(s0, start), b = new CpuInterventionAdapter(s0, start);
    a.advanceTo(10);
    expect(s0.step).toBe(0);
    expect(b.state.step).toBe(0);
    expect(a.state.cells.buffer).not.toBe(b.state.cells.buffer);
    expect(a.state.cells.buffer).not.toBe(s0.cells.buffer);
    b.advanceTo(10);
    expect(stateHash(a.state)).toBe(stateHash(b.state));
  }, T);
  it("books energy and matter exactly across a lesion and a feed and a drain", () => {
    const a = new CpuInterventionAdapter(s0, start);
    a.advanceTo(10);
    const at = heaviestCell(a.state);
    a.apply({ step: 10, kind: "lesion", ...at, r: 3 });
    a.advanceTo(15);
    const fed = a.apply({ step: 15, kind: "feed", ...at, r: 3, amount: 20 });
    expect(fed.deliveredMatter).toBe(20 * 29);
    a.advanceTo(18);
    const drained = a.apply({ step: 18, kind: "feed", ...at, r: 3, amount: -5 });
    expect(drained.deliveredMatter).toBeLessThanOrEqual(0);
    a.advanceTo(30);
    expect(a.energyResidual()).toBe(0n);
    expect(a.matterResidual()).toBe(0n);
  }, T);
});

describe("one family", () => {
  const p = tinyProtocol();
  const fam = p.families[0];
  const r = runFamily(p, fam);
  it("builds envelopes with no post-fork data and an intact hash; frames are copies", () => {
    for (const e of r.envelopes) {
      expect(envelopeIntact(e)).toBe(true);
      expect(Math.max(...e.census.map((c) => c.step), ...e.frames.map((f) => f.step))).toBeLessThanOrEqual(e.task.forkStep);
      expect(e.menu.ops.map((o) => o.kind)).toEqual(["lesion", "feed", "drain", "none"]);
    }
    const body = envelopeBody(r.envelopes[0]);
    expect(hashEnvelopeBody({ ...body, census: body.census.map((c, i) => (i === 3 ? { ...c, mass: c.mass + 1 } : c)) })).not.toBe(r.envelopes[0].envelopeHash);
    expect(() => assertNoPostFork({ ...body, census: [...body.census, { step: body.task.forkStep + 1, livingCells: 0, freeNutrient: 0, mass: 0 }] })).toThrow(/after its fork step/);
    const sim = new RefSim(makeWorld(p, fam));
    const f = frameOf(sim.state);
    const before = JSON.stringify(f);
    sim.run(5);
    sim.state.cells.fill(7);
    expect(JSON.stringify(f)).toBe(before);
  }, T);
  it("sham equals control (hash), the envelope hash is stable across envelopes of a family's census, instrumented equals plain", () => {
    const sham = r.arms.find((a) => a.mechanismId === "sham")!;
    expect(sham.treatedHash).toBe(r.controlHash);
    expect(sham.effect.bodyMass).toBe(0);
    expect(r.neutralityChecks).toBeGreaterThan(3);
    // History to C and every arm's continuation through C+H are compared (the negative tests below prove the comparisons bite).
    expect(r.neutralityChecks).toBeGreaterThanOrEqual(1 + p.mechanisms.length);
    expect(r.cellSteps).toBe(plannedCellSteps(p));
    expect(new Set(r.envelopes.map((e) => JSON.stringify(e.census))).size).toBe(1);
  }, T);
  it("matter and energy books closed in every arm (runFamily throws otherwise); a lesion on the occupied centre lowers body mass, a feed raises it", () => {
    const les = r.arms.find((a) => a.mechanismId === "lesionOccupied")!;
    const feed = r.arms.find((a) => a.mechanismId === "feedOccupied")!;
    expect(les.energyResidual).toBe("0");
    expect(les.matterResidual).toBe("0");
    expect(feed.matterResidual).toBe("0");
    expect(les.effect.bodyMass).toBeLessThan(0);
    expect(feed.effect.bodyMass).toBeGreaterThan(0);
    expect(feed.applied[0].deliveredMatter).toBeGreaterThan(0);
    expect(les.applied[0].deliveredMatter).toBe(0);
  }, T);
  it("generation is deterministic: a rerun gives the same hashes", () => {
    const r2 = runFamily(p, fam);
    expect(r2.controlHash).toBe(r.controlHash);
    expect(r2.arms.map((a) => a.treatedHash)).toEqual(r.arms.map((a) => a.treatedHash));
    expect(r2.envelopes.map((e) => e.envelopeHash)).toEqual(r.envelopes.map((e) => e.envelopeHash));
  }, T);
  it("places the lesion centre on the heaviest cell and the empty control away from life", () => {
    const sim = new RefSim(makeWorld(p, fam));
    sim.run(40);
    const h = heaviestCell(sim.state), e = emptiestCell(sim.state);
    const n = cellCount(sim.cfg), W = worldW(sim.cfg);
    const mass = (c: { x: number; y: number }): number => sim.state.cells[CH.B * n + c.y * W + c.x] + sim.state.cells[CH.P * n + c.y * W + c.x];
    let max = 0;
    for (let i = 0; i < n; i++) max = Math.max(max, sim.state.cells[CH.B * n + i] + sim.state.cells[CH.P * n + i]);
    expect(mass(h)).toBe(max);
    expect(mass(e)).toBe(0);
    expect(h).not.toEqual(e);
  }, T);
});

describe("observer neutrality bites", () => {
  const p = tinyProtocol();
  const fam = p.families[0];
  const C = p.window.forkStep, H = p.window.horizon;
  it("a perturbing observer on the instrumented history makes runFamily throw", () => {
    expect(() => runFamily(p, fam, undefined, { observer: (s, step, phase) => { if (phase === "history" && step === C) s.cells[0] += 1; } })).toThrow(/observer neutrality failed/);
  }, T);
  it("a perturbing observer on a continuation, only after the fork and at the endpoint, makes runFamily throw (neutrality is checked through C+H)", () => {
    expect(() => runFamily(p, fam, undefined, { observer: (s, step, phase) => { if (phase === "continuation" && step === C + H) s.cells[1] += 1; } })).toThrow(/observer neutrality failed for .*instrumented continuation/);
  }, T);
  it("a harmless observer does not throw", () => {
    let calls = 0;
    runFamily(p, fam, undefined, { observer: () => { calls++; } });
    expect(calls).toBeGreaterThan(10);
  }, T);
  it("checkBooks throws on a nonzero energy or matter residual", () => {
    expect(() => checkBooks({ energyResidual: () => 1n, matterResidual: () => 0n }, "x")).toThrow(/energy ledger residual/);
    expect(() => checkBooks({ energyResidual: () => 0n, matterResidual: () => -3n }, "x")).toThrow(/matter residual/);
    expect(() => checkBooks({ energyResidual: () => 0n, matterResidual: () => 0n }, "x")).not.toThrow();
  });
});

describe("bounds and budget are checked before simulating", () => {
  it("plannedCellSteps counts every arm and twin; out-of-range protocols are refused before any run", () => {
    const p = tinyProtocol();
    const n = p.world.side * p.world.side;
    expect(plannedCellSteps(p)).toBe(n * (2 * p.window.forkStep + 2 * (1 + p.mechanisms.length) * p.window.horizon));
    expect(() => assertFixtureBounds({ ...p, world: { ...p.world, side: 100_000 } })).toThrow(/world.side/);
    expect(() => assertFixtureBounds({ ...p, window: { ...p.window, horizon: 1 } })).toThrow(/window.horizon/);
    expect(() => assertFixtureBounds({ ...p, window: { ...p.window, frameSteps: [p.window.forkStep + 1] } })).toThrow(/frameSteps/);
    expect(() => assertFixtureBounds({ ...p, mechanisms: [{ id: "x", kind: "feed", where: "occupied", r: 99, amount: 5, expected: "up" }] })).toThrow(/mechanism x r/);
    expect(() => assertFixtureBounds({ ...p, mechanisms: [{ id: "y", kind: "lesion", where: "none", r: 2, expected: "down" }] })).toThrow(/does not match where/);
    expect(() => assertFixtureBounds({ ...p, mechanisms: [{ id: "z", kind: "none", where: "occupied", expected: "none" }] })).toThrow(/does not match where/);
  });
  it("generate refuses over the cap before simulating anything (variants included)", () => {
    const p = tinyProtocol();
    p.caps.maxCellStepsPerFamily = 1000;
    expect(() => generate(p, [p.families[0].id], true)).toThrow(/over the cap/);
  });
});

describe("labelOf boundary", () => {
  it("is inclusive at exactly +minEffect and -minEffect, and none just inside", () => {
    expect(labelOf(50, 50)).toBe("up");
    expect(labelOf(-50, 50)).toBe("down");
    expect(labelOf(49, 50)).toBe("none");
    expect(labelOf(-49, 50)).toBe("none");
    expect(labelOf(0, 50)).toBe("none");
    expect(labelOf(51, 50)).toBe("up");
    expect(labelOf(-51, 50)).toBe("down");
  });
});

describe("trendConfoundOf on a synthetic rising set", () => {
  const row = (mechanismId: string, before: number, treated: number, control: number): CaseRow => ({ caseId: mechanismId, familyId: "f", split: "test", mechanismId, expected: "none", envelopeHash: "h", effect: { bodyMass: treated - control, livingCells: 0, freeNutrient: 0 }, before, treated, control, treatedHash: "t" });
  const rows = [row("sham", 100, 160, 160), row("lowDoseFeed", 100, 163, 160), row("feedOccupied", 100, 260, 160), row("lesionOccupied", 100, 40, 160)];
  it("the naive rule is fooled by the rising world where the paired rule is not", () => {
    const t = trendConfoundOf(rows, 50);
    expect(t.sham).toEqual({ n: 1, naiveUp: 1, pairedNone: 1 });
    expect(t.lowDose).toEqual({ n: 1, naiveUp: 1, pairedNone: 1 });
    expect(t.pairedAlwaysRisingAccuracy).toBe(0.25);
    expect(t.naiveBeforeAfterAlwaysRisingAccuracy).toBe(0.75);
    expect(t.risingCases).toBe(3);
    expect(t.totalCases).toBe(4);
  });
  it("on a declining set the confound cannot show: no rising cases, naive never says up", () => {
    const t = trendConfoundOf([row("sham", 200, 150, 150), row("lowDoseFeed", 200, 153, 150)], 50);
    expect(t.risingCases).toBe(0);
    expect(t.sham.naiveUp).toBe(0);
  });
});

describe("trend-confound truth table", () => {
  // Hand-specified: a rising world (before = 100). Paired effect of sham and a low-dose feed is 0 (none); the naive before/after
  // rule sees treated 160 - before 100 = +60 and calls both "up" at a minimum effect of 50.
  const rows = [
    { name: "sham", before: 100, treated: 160, control: 160, pairedLabel: "none", naiveLabel: "up" },
    { name: "lowDose", before: 100, treated: 163, control: 160, pairedLabel: "none", naiveLabel: "up" },
    { name: "feed", before: 100, treated: 260, control: 160, pairedLabel: "up", naiveLabel: "up" },
    { name: "lesion", before: 100, treated: 40, control: 160, pairedLabel: "down", naiveLabel: "down" },
  ] as const;
  it("matches the hand-derived table", () => {
    for (const r of rows) {
      expect(labelOf(r.treated - r.control, 50), r.name).toBe(r.pairedLabel);
      expect(labelOf(r.treated - r.before, 50), r.name).toBe(r.naiveLabel);
    }
    // alwaysRising ("up" everywhere): right on 2 of 4 by the paired rule, 3 of 4 by the naive rule.
    expect(rows.filter((r) => r.pairedLabel === "up").length).toBe(1);
    expect(rows.filter((r) => r.naiveLabel === "up").length).toBe(3);
  });
});

describe("generate", () => {
  it("runs a tiny split end to end with seed variants only for qualify families", () => {
    const p = tinyProtocol();
    const g = generate(p, p.families.slice(0, 2).map((f) => f.id), true);
    expect(g.results).toHaveLength(2);
    expect(g.variants.length).toBeLessThanOrEqual(2);
  }, T);
});
