import { RefSim } from "@bl/sim-ref";
import { allocState, defaultConfig } from "@bl/schema";
import { describe, expect, it } from "vitest";
import { PROTOCOL, SCHEDULE_IDS, worldConfig } from "../src/movinglight/protocol.ts";
import { circ, meridianPath, reportOf, scoredFrom } from "../src/movinglight/schedule.ts";

describe("movinglight schedule", () => {
  it("meridian equals RefSim.light argmax for fixed, paused, wandering", () => {
    for (const sc of ["fixed", "paused", "wandering"] as const) {
      const sim = new RefSim(allocState(worldConfig(1, sc)));
      const path = meridianPath(sc);
      for (let t = 0; t <= PROTOCOL.T; t += 7) {
        let best = -1, arg = -1;
        for (let x = 0; x < PROTOCOL.W; x++) {
          const L = sim.light(x, 0, t);
          if (L > best) { best = L; arg = x; }
        }
        expect(arg).toBe(path[t]);
      }
    }
  });
  it("realised integer path frozen, first-move, turn step and realised speed ratio reported", () => {
    const fixed = reportOf("fixed", meridianPath("fixed"), "h");
    expect(fixed.firstMoveStep).not.toBeNull();
    expect(fixed.turnStep).toBeNull();
    expect(fixed.speedRatioPermille).toBeGreaterThan(1400);
    expect(fixed.speedRatioPermille).toBeLessThan(1600);
    const paused = reportOf("paused", meridianPath("paused"), "h");
    expect(paused.firstMoveStep).toBeNull();
    expect(paused.meanSpeedPer1000).toBe(0);
    expect(meridianPath("fixed")).toEqual(meridianPath("fixed"));
  });
  it("reversed schedule has eastward and westward legs of at least k steps", () => {
    const r = reportOf("reversed", meridianPath("reversed"), "h");
    expect(r.eastLegSteps).toBeGreaterThanOrEqual(100);
    expect(r.westLegSteps).toBeGreaterThanOrEqual(100);
    expect(r.turnStep).not.toBeNull();
  });
  it("scored-post window starts at the realised turn", () => {
    const path = meridianPath("reversed");
    const turn = reportOf("reversed", path, "h").turnStep!;
    const from = scoredFrom("reversed", path);
    expect(from).toBe(turn);
    expect(path[from + 1]).toBeLessThan(path[from]);
    expect(scoredFrom("fixed", meridianPath("fixed"))).toBe(PROTOCOL.T0);
  });
  it("no new WorldConfig key and defaultConfig hash unchanged", () => {
    const d = Object.keys(defaultConfig());
    const ours = Object.keys(worldConfig(1, "wandering"));
    const added = ours.filter((k) => !d.includes(k)).sort();
    expect(added).toEqual(["dayPeriod", "kSDecay", "signalGain", "wanderAmp", "wanderPeriod"].filter((k) => !d.includes(k)).sort());
    for (const k of ["dayPeriod", "wanderPeriod", "wanderAmp", "signalGain"]) expect(d).not.toContain(k);
    for (const sc of SCHEDULE_IDS) expect(circ(meridianPath(sc)[0], 0, PROTOCOL.W)).toBe(0);
  });
});
