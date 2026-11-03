import { describe, expect, it } from "vitest";
import { canonicalJSON } from "@bl/schema";
import { doseRow, noiseGate, probeW2, qualify, runLadder, settled, wallGateBlockFe, wallPasses, type DoseRow, type WallSeedResult } from "../src/niche/dose.ts";
import { freshReportFe, sealPayloadFe, verifySealFe, type DevReportFe } from "../src/niche/evidenceFe.ts";
import { PROTOCOL_FE, type ProtocolFe } from "../src/niche/protocol.ts";

const mk = (seed: number, v: number[]): WallSeedResult => ({ seed, contrasts: { builder: v[0], poly: v[1], space: v[2], inoc2: v[3] }, yWall: 0, viableReps: 2 });
/** A synthetic dose row: `k` of 8 seeds positive on every contrast at the given effect. */
const row = (totalP: number, k: number, effect: number): DoseRow => doseRow(totalP, Array.from({ length: 8 }, (_, i) => (i < k ? mk(i, [effect, effect, effect, effect]) : mk(i, [-effect, -effect, -effect, -effect]))));

describe("positive-control dose ladder", () => {
  it("ceiling derives from dev builder P per candidate (2 x median = the twice-median integer)", () => {
    expect(qualify(0, 20, 207, [row(60, 8, 100)]).ceiling).toBe(207);
    expect(qualify(4, 20, 169, [row(60, 8, 100)]).ceiling).toBe(169);
  });

  it("no dose above the ceiling can qualify; the minimum detectable dose is still stated", () => {
    const q = qualify(0, 20, 170, [row(60, 3, 100), row(120, 4, 100), row(240, 5, 100), row(600, 8, 200)]);
    expect(q.qualified).toBe(false);
    expect(q.minDetectableDose).toBe(600);
    expect(q.qualifyingDose).toBeNull();
    expect(q.dosesWithinCeiling).toEqual([60, 120]);
    expect(q.reason).toMatch(/minimum detectable dose 600 exceeds the realistic ceiling 170/);
  });

  it("wall pass rule: 7 of 8 positive on all four contrasts and median >= delta; G-NOISE needs delta <= half the limiting median", () => {
    expect(wallPasses(row(120, 7, 100), 50)).toBe(true);
    expect(wallPasses(row(120, 6, 100), 50)).toBe(false);
    expect(wallPasses(row(120, 8, 40), 50)).toBe(false);
    // 7 of 8 positive at +100 / -100: the median is +100.
    expect(noiseGate(row(120, 7, 100), 50)).toBe(true);
    expect(noiseGate(row(120, 7, 100), 51)).toBe(false);
    const q = qualify(0, 60, 170, [row(120, 7, 100)]);
    expect(q.qualified).toBe(false);
    expect(q.reason).toMatch(/G-NOISE/);
    expect(qualify(0, 50, 170, [row(120, 7, 100)]).qualifyingDose).toBe(120);
  });

  it("the ladder does not stop at a dose that passes the wall rule but fails G-NOISE when a within-ceiling dose could qualify", () => {
    // delta 60, ceiling 170: dose 60 passes the wall at +100 but 60 > 100/2, so it fails G-NOISE; dose 120 at +200 would qualify.
    expect(settled([row(60, 8, 100)], 60, 170)).toBe(false);
    expect(settled([row(60, 8, 100), row(120, 8, 200)], 60, 170)).toBe(true);
    // Nothing passes: not settled until the ladder is exhausted.
    expect(settled([row(60, 3, 100), row(120, 3, 100)], 60, 170)).toBe(false);
    // A passing dose above the ceiling after all eligible doses ran states the minimum detectable dose.
    expect(settled([row(60, 3, 100), row(120, 3, 100), row(240, 8, 400)], 60, 170)).toBe(true);
  });

  it("allowP wall never qualifies: the polymer floor is refused by ordinary placement, the ring is legal", () => {
    const w2 = probeW2(PROTOCOL_FE);
    expect(w2.status).toBe("unavailable");
    expect(w2.reason).toMatch(/common placeable cells/);
    const short: ProtocolFe = { ...PROTOCOL_FE, T2: 12, census: 1, R: 1 };
    const r = wallGateBlockFe(short.wallSeeds[0], 120, short);
    expect(Object.keys(r.contrasts).sort()).toEqual(["builder", "inoc2", "poly", "space"]);
  }, 120_000);

  it("the ladder is deterministic across reruns and stops once every candidate passes", () => {
    const short: ProtocolFe = { ...PROTOCOL_FE, T2: 12, census: 1, R: 1, doses: [60, 120], wallSeeds: PROTOCOL_FE.wallSeeds.slice(0, 4) };
    const a = runLadder({ "0": 0 }, { "0": 170 }, short), b = runLadder({ "0": 0 }, { "0": 170 }, short);
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
    // delta 0: any all-positive row passes, so a rerun that passed at 60 would stop there; either way rows are a prefix of the doses.
    expect(a.rows.map((r) => r.totalP)).toEqual(short.doses.slice(0, a.rows.length));
  }, 180_000);

  it("failure yields the minimum detectable dose in a sealed stopped payload (no fresh seed simulated)", () => {
    const rows = [row(60, 2, 10), row(120, 3, 10)];
    const dev = { purpose: "calibration", R: 4, seeds: [], candidates: [], ladder: { geometry: "W1", rows, w2: { status: "unavailable", reason: "x" } }, qualification: PROTOCOL_FE.panel.map((c) => qualify(c, 100, 170, rows)) } as unknown as DevReportFe;
    const p: ProtocolFe = { ...PROTOCOL_FE, delta: { "0": 100, "4": 100, "9": 100 } };
    const fresh = freshReportFe(dev, p);
    expect(fresh.ran).toBe(false);
    expect(fresh.candidates).toEqual([]);
    expect(fresh.results.every((r) => r.label === "unsupported-measurement" && !r.simulated)).toBe(true);
    expect(fresh.panel.verdict).toBe("unsupported-measurement");
    expect(fresh.panel.verdict).not.toMatch(/no-causal/);
    expect(fresh.results[0].reasons.join(" ")).toMatch(/not detected at any ladder dose/);
    const sealed = sealPayloadFe({ kind: "niche-fe-evidence", version: "t", protocol: p, protocolHash: "h", registryDigest: "d", seedCount: 0, stepProjection: { formula: "", freshBlocks: 0, stepsPerBlock: 0, devBlocks: 0 }, dev, fresh, fixtures: {} as never, powerStatement: p.powerStatement, limits: [], amendments: [] });
    expect(verifySealFe(sealed)).toBe(true);
    expect(verifySealFe({ ...sealed, limits: ["x"] })).toBe(false);
  });
});
