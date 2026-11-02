import { CH, G, cellCount, packLineageLo } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { describe, expect, it } from "vitest";
import { ARM_EDITS, auditArm, buildArm, buildPatches, genomeHash, weightedLight1000, genomeOf, positions } from "../src/movinglight/arms.ts";
import { crossTalkOf, isFlagged } from "../src/movinglight/evidence.ts";
import { PLACEMENTS, PROTOCOL as P, STRATEGY_IDS } from "../src/movinglight/protocol.ts";
import { circ } from "../src/movinglight/schedule.ts";
import { SHORT } from "./movinglight-helpers.ts";

const diffIdx = (a: Int8Array, b: Int8Array) => [...a].flatMap((v, i) => (v !== b[i] ? [i] : []));

describe("movinglight arms", () => {
  it("genome edits touch only the listed weights and hash stably", () => {
    const sense = genomeOf("sense"), nosig = genomeOf("sense-nosig"), nomot = genomeOf("sense-nomot");
    expect(diffIdx(sense.weights, nosig.weights).length).toBeLessThanOrEqual(2);
    expect(nosig.motGain).toBe(sense.motGain);
    expect(diffIdx(sense.weights, nomot.weights)).toEqual([]);
    expect(nomot.motGain).toBe(0);
    expect(genomeOf("still").motGain).toBe(0);
    expect(genomeHash("sense")).toBe(genomeHash("sense"));
    expect(new Set(STRATEGY_IDS.map((s) => genomeHash(s))).size).toBe(STRATEGY_IDS.length - 0);
    for (const s of STRATEGY_IDS) expect(ARM_EDITS[s].length).toBeGreaterThan(10);
  });
  it("sense-nosig emits nothing and keeps its wiring, sense-nomot emits and does not move", () => {
    const patches = buildPatches(SHORT, 8_700_001);
    const run = (st: "sense" | "sense-nosig" | "sense-nomot") => {
      const sim = new RefSim(buildArm(st, "grouped", "fixed", 8_700_001, patches, SHORT).state);
      for (let i = 0; i < 96; i++) sim.step();
      return sim.state;
    };
    const flux = (s: ReturnType<typeof run>) => s.flux[5];
    expect(flux(run("sense-nosig"))).toBe(0n);
    expect(flux(run("sense")) > 0n).toBe(true);
    expect(flux(run("sense-nomot")) > 0n).toBe(true);
    const nomotArm = buildArm("sense-nomot", "grouped", "fixed", 8_700_001, patches, SHORT);
    const n = cellCount(nomotArm.state.cfg);
    const i = [...Array(n).keys()].find((j) => nomotArm.state.cells[CH.B * n + j] > 0)!;
    expect(nomotArm.state.genome[G.PARAM1 * n + i] & 0xff).toBe(0);
  });
  it("patches are copied by translation with identical lineage ids and audited B/E", () => {
    const patches = buildPatches(P, 8_700_901);
    expect(patches.map((q) => q.raw)).toEqual([1, 2, 3, 4]);
    const seen = new Set<string>();
    for (const st of STRATEGY_IDS)
      for (const pl of PLACEMENTS) {
        const a = buildArm(st, pl, "fixed", 8_700_901, patches, P);
        expect(auditArm(a, patches)).toEqual([]);
        seen.add(`${a.inputB}/${a.inputE}/${a.inputEnergy}`);
        const n = cellCount(a.state.cfg);
        const los = new Set<number>();
        for (let i = 0; i < n; i++) if (a.state.cells[CH.B * n + i] > 0) los.add(a.state.genome[G.LIN_LO * n + i]);
        expect([...los].sort()).toEqual([1, 2, 3, 4].map((k) => packLineageLo(a.state.cfg, k)).sort());
      }
    expect(seen.size).toBe(1);
  });
  it("equal audited input energy across placements", () => {
    const patches = buildPatches(P, 8_700_902);
    const g = buildArm("sense", "grouped", "paused", 8_700_902, patches, P), d = buildArm("sense", "dispersed", "paused", 8_700_902, patches, P);
    expect(g.inputEnergy).toBe(d.inputEnergy);
    expect(g.inputEnergy).toBe(g.inputE + g.state.cfg.eB * g.inputB);
  });
  it("grouped and dispersed share offsets from the t=0 meridian", () => {
    const mean = (pl: "grouped" | "dispersed") => positions(pl, P).reduce((a, q) => a + circ(q.x, 0, P.W), 0) / P.n;
    expect(mean("grouped")).toBe(mean("dispersed"));
    expect(mean("grouped")).toBe(-P.placement.offset);
    const spread = (pl: "grouped" | "dispersed") => Math.max(...positions(pl, P).map((q) => circ(q.x, 0, P.W))) - Math.min(...positions(pl, P).map((q) => circ(q.x, 0, P.W)));
    expect(spread("dispersed")).toBeGreaterThan(spread("grouped"));
  });
  it("replicate-noise runs clone patches", () => {
    const patches = buildPatches(P, 8_700_001);
    const a = buildArm("still", "grouped", "fixed", 8_700_201, patches, P), b = buildArm("still", "grouped", "fixed", 8_700_202, patches, P);
    expect(a.state.cells).toEqual(b.state.cells);
    expect(a.state.genome).toEqual(b.state.genome);
    expect(a.state.cfg.seed).not.toBe(b.state.cfg.seed);
  });
  it("dispersed cross-talk is measured and flagged above threshold", () => {
    const ct = crossTalkOf("dispersed", SHORT, 8_700_001);
    expect(ct.signalDiffPpm).toBeGreaterThanOrEqual(0);
    expect(ct.signalDiffPpm).toBeLessThanOrEqual(1_000_000);
    expect(isFlagged({ ...ct, signalDiffPpm: P.crossTalkMaxPpm + 1 })).toBe(true);
    expect(isFlagged({ ...ct, signalDiffPpm: P.crossTalkMaxPpm })).toBe(false);
  });

  it("grouped and dispersed placements stand in different light (recorded confound of the placement design)", () => {
    const patches = buildPatches(P, P.devSeeds[0]);
    const g = weightedLight1000(buildArm("sense", "grouped", "fixed", P.devSeeds[0], patches)), d = weightedLight1000(buildArm("sense", "dispersed", "fixed", P.devSeeds[0], patches));
    expect(g).toBeGreaterThan(d + d / 10);
    expect(g).toBe(162_287);
    expect(d).toBe(127_313);
  });
});
