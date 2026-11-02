import { describe, expect, it } from "vitest";
import { coordination, type Track } from "../src/movinglight/coordination.ts";
import { SYNTH, syntheticTracks } from "../src/movinglight/fixtures.ts";
import { PROTOCOL as P } from "../src/movinglight/protocol.ts";
import { meridianPath } from "../src/movinglight/schedule.ts";

const path = meridianPath("wandering");
const cov = (kind: Parameters<typeof syntheticTracks>[0], pl: "grouped" | "dispersed", seed: number) => coordination(syntheticTracks(kind, pl, seed, "wandering"), path);

describe("movinglight coordination", () => {
  it("common forcing raises naive alignment in group and dispersed set equally and gives covariance ~0", () => {
    let maxDiff = 0, gsum = 0, dsum = 0, ng = 0;
    for (const s of P.noiseSeeds) {
      const g = cov("common-forcing", "grouped", s), d = cov("common-forcing", "dispersed", s);
      expect(g.signAgreementPpm).toBeGreaterThan(800_000);
      expect(d.signAgreementPpm).toBeGreaterThan(800_000);
      gsum += g.signAgreementPpm!;
      dsum += d.signAgreementPpm!;
      ng++;
      maxDiff = Math.max(maxDiff, Math.abs(g.covMilliQ2! - d.covMilliQ2!));
    }
    expect(Math.abs(gsum - dsum) / ng).toBeLessThan(100_000);
    const coupled = cov("coupled-synthetic", "grouped", P.noiseSeeds[0]).covMilliQ2! - cov("coupled-synthetic", "dispersed", P.noiseSeeds[0]).covMilliQ2!;
    expect(coupled).toBeGreaterThan(5 * maxDiff);
  });
  it("coupled agents give a residual above the floor", () => {
    const quiet = { ...SYNTH, couplingPermille: 0 };
    const withC = coordination(syntheticTracks("coupled-synthetic", "grouped", 5, "wandering"), path).covMilliQ2!;
    const without = coordination(syntheticTracks("coupled-synthetic", "grouped", 5, "wandering", P, quiet), path).covMilliQ2!;
    expect(withC).toBeGreaterThan(without);
  });
  it("static sun gives unavailable not zero", () => {
    const tr = syntheticTracks("static-sun", "grouped", 3, "paused");
    expect(coordination(tr, meridianPath("paused")).covMilliQ2).toBeNull();
  });
  it("zero-displacement and missing-lineage pairs are handled and pair counts reported", () => {
    const WQ = P.W * P.Q;
    const t = [32, 64, 96, 128];
    const tr: Track = { t, q: [[0, 100, 200, 300], [0, 90, 220, 280], [null, null, 50, 60], [0, null, 10, 10]] };
    const c = coordination(tr, meridianPath("paused"));
    expect(c.intervals).toBe(3);
    expect(c.pairs).toBe(1);
    expect(c.pairIntervals).toBe(3);
    const frozen: Track = { t, q: [[5, 5, 5, 5], [9, 9, 9, 9]] };
    expect(coordination(frozen, meridianPath("paused")).covMilliQ2).toBeNull();
    const jump: Track = { t, q: [[0, 100, 200, 300], [0, 90, 200 + 10 * P.Q, 280]] };
    expect(coordination(jump, meridianPath("paused")).excluded).toBeGreaterThan(0);
    void WQ;
  });
});
