import { describe, expect, it } from "vitest";
import { coordFixture, physicalFixtures, plantedReport, syntheticFloor } from "../src/movinglight/fixtures.ts";
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
});
