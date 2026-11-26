import { canonicalJSON } from "@bl/schema";
import { describe, expect, it } from "vitest";
import { runBlock } from "../src/movinglight/assay.ts";
import { decideFresh, jobsFor, mergeBlocks, sealPayload, verifySeal, workload } from "../src/movinglight/evidence.ts";
import { PROTOCOL as P, SCHEDULE_IDS } from "../src/movinglight/protocol.ts";
import { SHORT } from "./movinglight-helpers.ts";

describe("movinglight evidence", () => {
  it("canonical JSON refuses floats", () => {
    expect(() => canonicalJSON({ a: 1.5 })).toThrow();
    expect(() => canonicalJSON({ a: 1, b: "x", c: [null, 2] })).not.toThrow();
    // Every readout in a block record is an integer, a string or null.
    const b = runBlock({ seed: 8_700_901, schedules: ["paused"], strategies: ["still"], placements: ["grouped"] }, SHORT);
    expect(() => canonicalJSON(b)).not.toThrow();
  });
  it("evidence payload seal detects any change", () => {
    const p = sealPayload({ kind: "movinglight-evidence", version: "t", protocol: P, protocolHash: "h", registryDigest: "d", workload: workload(), calibration: {} as any, fresh: {} as any, fixtures: {} as any, limits: [], gaps: [] });
    expect(verifySeal(p)).toBe(true);
    expect(verifySeal({ ...p, protocolHash: "x" })).toBe(false);
  });
  it("workload is enumerated and uses at most two processes", () => {
    const w = workload();
    expect(w.worldsFresh).toBe(P.freshSeeds.length * 4 * 5 * 2);
    expect(w.steps).toBe((w.worldsFresh + w.worldsFixtures) * P.T);
    expect(w.maxProcesses).toBe(2);
  });
  it("jobs merge by seed in schedule order and the replay of a small panel is byte-equal", () => {
    const specs = jobsFor([8_700_901], ["paused", "fixed"], ["still", "drift"], { stripSeed: 8_700_901 }).map((s) => ({ ...s, placements: ["grouped"] as const }));
    const run = (specs2: typeof specs) => mergeBlocks(specs2.map((s) => runBlock(s, SHORT)));
    const a = run(specs), b = run(specs);
    expect(a.length).toBe(1);
    expect(Object.keys(a[0].runs)).toEqual(["paused", "fixed"]);
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
    expect(a[0].strip).not.toBeNull();
  }, 120_000);
  it("decideFresh recomputes the decisions from stored blocks only", () => {
    expect(SCHEDULE_IDS.length).toBe(4);
    const blocks = [8_700_901, 8_700_902].map((seed) => runBlock({ seed, schedules: ["fixed"], strategies: ["sense", "sense-nosig", "sense-nomot", "drift", "still"] }, SHORT));
    const floors = Object.fromEntries(SCHEDULE_IDS.map((s) => [s, { cap: 0, res: 0 }]));
    const r = decideFresh({ floors, sensitivity: { senseTracks: true } } as any, blocks, SHORT);
    expect(r.decisions.fixed.blocks).toBe(8);
    expect(r.decisions.fixed.complete).toBe(2);
    expect(r.verdict.label).toBeTruthy();
    expect(canonicalJSON(decideFresh({ floors, sensitivity: { senseTracks: true } } as any, blocks, SHORT))).toBe(canonicalJSON(r));
  }, 120_000);
});
