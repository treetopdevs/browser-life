import { describe, expect, it } from "vitest";
import { SYNTH, coordFixture, judgePhysical, physicalFixtures, plantedReport, syntheticFloor, syntheticTracks } from "../src/movinglight/fixtures.ts";
import { coordination } from "../src/movinglight/coordination.ts";
import { meridianPath } from "../src/movinglight/schedule.ts";
import { runBlock } from "../src/movinglight/assay.ts";
import { PROTOCOL as P } from "../src/movinglight/protocol.ts";
import { SHORT } from "./movinglight-helpers.ts";

const floor = syntheticFloor("fixed");

describe("movinglight fixtures", () => {
  it("common-forcing is rejected while naive metric passes", () => {
    const f = coordFixture("common-forcing", "fixed", floor);
    expect(f.naiveReads).toBe(true);
    expect(f.rejected).toBe(true);
    expect(f.label).toBe("unsupported-within-tested-domain");
    const w = coordFixture("common-forcing", "wandering", syntheticFloor("wandering"));
    expect(w.naiveReads).toBe(true);
    expect(w.rejected).toBe(true);
  });
  it("coupled-synthetic is coordination-detected", () => {
    const f = coordFixture("coupled-synthetic", "fixed", floor);
    expect(f.label).toBe("coordination-detected");
    expect(f.rejected).toBe(false);
  });
  it("stationary-growth and label-takeover are rejected", () => {
    const t = coordFixture("label-takeover", "fixed", floor);
    expect(t.rejected).toBe(true);
    expect(t.excluded).toBeGreaterThan(0);
    const s = coordFixture("static-sun", "paused", 0);
    expect(s.label).toBe("unavailable");
  });
  it("null-world is exactly zero", () => {
    const f = coordFixture("null-world", "fixed", floor);
    for (const r of f.residual) expect(r).toBe(0);
    expect(f.rejected).toBe(true);
  });
  it("planted-benefit gives supported through the full decision", () => {
    expect(plantedReport("a", { fixed: 600_000, paused: 0, reversed: 600_000, wandering: 600_000 }).verdict.label).toBe("supported");
    expect(plantedReport("b", { fixed: 600_000, paused: 600_000, reversed: 600_000, wandering: 600_000 }).verdict.label).toBe("inconclusive-confounded");
    expect(plantedReport("c", { fixed: 0, paused: 0, reversed: 0, wandering: 0 }).verdict.label).toBe("unsupported-within-tested-domain");
  });
  it("blind-drifters-physical is rejected; crowding-physical is rejected", () => {
    const seeds = P.fixtureSeeds.slice(0, 8);
    const blocks = seeds.map((seed) => runBlock({ seed, schedules: ["fixed"], strategies: ["drift", "sense-nosig", "still"] }, SHORT));
    const fx = physicalFixtures({ cap: 20_000, res: 1_000_000_000 }, SHORT, blocks);
    expect(fx.map((f) => f.id)).toEqual(["blind-drifters-physical", "crowding-physical", "stationary-growth"]);
    for (const f of fx) {
      expect(f.B.every((b) => b === 0)).toBe(true);
      expect(typeof f.residualWithinFloor).toBe("boolean");
    }
    // The residual floor is huge here, so stationary-growth's residual is within it and every fixture is rejected.
    for (const f of fx) expect(f.rejected).toBe(true);
    // A tiny residual floor flips stationary-growth only: it is rejected only when its residual stays inside the floor.
    const strict = physicalFixtures({ cap: 20_000, res: -1_000_000_000_000 }, SHORT, blocks);
    expect(strict.find((f) => f.id === "stationary-growth")!.rejected).toBe(false);
    expect(strict.find((f) => f.id === "crowding-physical")!.rejected).toBe(true);
  }, 120_000);

  it("the synthetic floor is a real sampling floor: independent noise per placement", () => {
    expect(floor).toBeGreaterThan(0);
    const g = syntheticTracks("common-forcing", "grouped", P.fixtureSeeds[0], "fixed");
    const d = syntheticTracks("common-forcing", "dispersed", P.fixtureSeeds[0], "fixed");
    expect(JSON.stringify(g.q)).not.toBe(JSON.stringify(d.q));
    // The null world has no noise term at all, so its residual is exactly zero whatever the floor.
    for (const r of coordFixture("null-world", "fixed", floor).residual) expect(r).toBe(0);
  });
  it("coupled-synthetic has a neighbour-dependent update; zero coupling is rejected", () => {
    const base = syntheticTracks("coupled-synthetic", "grouped", P.fixtureSeeds[0], "fixed");
    const pert = syntheticTracks("coupled-synthetic", "grouped", P.fixtureSeeds[0], "fixed", P, { ...SYNTH, perturb: { body: 0, k: 3, dq: 100 } });
    // Perturbing body 0 moves the other bodies at that interval (and, by accumulation, afterwards) in the grouped placement.
    for (const i of [1, 2, 3]) expect(pert.q[i][3]).not.toBe(base.q[i][3]);
    // In the dispersed placement there is no coupling: only the perturbed body itself moves.
    const db = syntheticTracks("coupled-synthetic", "dispersed", P.fixtureSeeds[0], "fixed");
    const dp = syntheticTracks("coupled-synthetic", "dispersed", P.fixtureSeeds[0], "fixed", P, { ...SYNTH, perturb: { body: 0, k: 3, dq: 100 } });
    for (const i of [1, 2, 3]) expect(dp.q[i][3]).toBe(db.q[i][3]);
    expect(dp.q[0][3]).not.toBe(db.q[0][3]);
    const none = coordFixture("coupled-synthetic", "fixed", floor, P, { ...SYNTH, couplingPermille: 0 });
    expect(none.label).toBe("unsupported-within-tested-domain");
    expect(none.rejected).toBe(true);
    expect(coordFixture("coupled-synthetic", "fixed", floor).rejected).toBe(false);
  });
  it("the sun subtraction is what rejects common forcing and tracking asymmetry (the fixtures can fail)", () => {
    const wf = syntheticFloor("wandering");
    const path = meridianPath("wandering", P);
    // Per arm, common forcing leaves a small statistic with the subtraction and a huge one without it.
    const tr = syntheticTracks("common-forcing", "grouped", P.fixtureSeeds[0], "wandering");
    const withSub = coordination(tr, path, P).covMilliQ2!, without = coordination(tr, path, P, false).covMilliQ2!;
    expect(Math.abs(withSub)).toBeLessThan(wf);
    expect(without).toBeGreaterThan(100 * wf);
    // Grouped bodies follow the sun fully and dispersed bodies half: rejected with the subtraction, 'detected' without it.
    const asym = coordFixture("tracking-asymmetry", "wandering", wf);
    expect(asym.naiveReads).toBe(true);
    expect(asym.rejected).toBe(true);
    const leaky = coordFixture("tracking-asymmetry", "wandering", wf, P, SYNTH, false);
    expect(leaky.label).toBe("coordination-detected");
  });
  it("the stationary-growth residual check needs six available residuals with |r| <= floor", () => {
    const F = { cap: 20_000, res: 45_000_000 };
    const B = Array(8).fill(0), S = Array(8).fill(0);
    const j = (r: (number | null)[]) => judgePhysical("stationary-growth", S, B, r, F);
    expect(j(Array(8).fill(1_000)).rejected).toBe(true);
    expect(j(Array(8).fill(-1_000_000_000)).residualWithinFloor).toBe(false);
    expect(j(Array(8).fill(-1_000_000_000)).rejected).toBe(false);
    expect(j([1, 1, 1, 1, 1, null, null, null]).residualWithinFloor).toBe(false);
    expect(j([1, 1, 1, 1, 1, 1, null, null]).residualWithinFloor).toBe(true);
    expect(j([1, 1, 1, 1, 1, -F.res - 1, F.res + 1, null]).residualWithinFloor).toBe(false);
  });
});
