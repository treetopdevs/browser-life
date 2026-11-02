import { RefSim } from "@bl/sim-ref";
import { stateHash } from "@bl/schema";
import { describe, expect, it } from "vitest";
import { buildArm, buildPatches } from "../src/movinglight/arms.ts";
import { circQ, readouts, runArm, takeCensus, type Series } from "../src/movinglight/observe.ts";
import { PROTOCOL, PROTOCOL as P } from "../src/movinglight/protocol.ts";
import { circ, meridianPath, scoredFrom } from "../src/movinglight/schedule.ts";
import { SHORT, handState } from "./movinglight-helpers.ts";

const census = (sc: "paused" | "fixed", bodies: Parameters<typeof handState>[1], t = 0) => {
  const s = handState(sc, bodies);
  const sim = new RefSim(s);
  return takeCensus(sim, t, meridianPath(sc), P, s, { energy: 0n });
};

describe("movinglight observe", () => {
  it("signed circular distance is exact at the wrap", () => {
    expect(circ(0, 23, 24)).toBe(1);
    expect(circ(23, 0, 24)).toBe(-1);
    expect(circ(12, 0, 24)).toBe(12);
    expect(circ(13, 0, 24)).toBe(-11);
    expect(circQ(1, 6143, 6144)).toBe(2);
  });
  it("absolute error is nonzero for bodies at -8 and +8", () => {
    const c = census("paused", [{ x: 16, y: 5, raw: 1 }, { x: 8, y: 9, raw: 2 }]);
    expect(c.sumBd).toBe(0);
    expect(c.sumBabs).toBe(1600);
  });
  it("cohesion is continuous across the circular seam", () => {
    const across = census("paused", [{ x: 22, y: 5, raw: 1 }, { x: 2, y: 9, raw: 2 }]);
    const inside = census("paused", [{ x: 10, y: 5, raw: 1 }, { x: 14, y: 9, raw: 2 }]);
    expect(across.cohVar1000).not.toBeNull();
    expect(across.cohVar1000).toBe(inside.cohVar1000);
    const wide = census("paused", [{ x: 2, y: 5, raw: 1 }, { x: 14, y: 9, raw: 2 }, { x: 20, y: 9, raw: 3 }]);
    expect(wide.cohVar1000).toBeNull();
  });
  it("temporal lag is causal and unavailable when never coincident", () => {
    expect(census("paused", [{ x: 10, y: 5, raw: 1 }], 64).lag).toBeNull();
    expect(census("paused", [{ x: 0, y: 5, raw: 1 }], 64).lag).toBe(0);
    const f = census("fixed", [{ x: 3, y: 5, raw: 1 }], 200);
    const path = meridianPath("fixed");
    expect(path[200]).toBe(4);
    expect(f.lag).toBeGreaterThan(0);
    expect(path[200 - f.lag!]).toBe(3);
    for (let u = 200 - f.lag! + 1; u <= 200; u++) expect(path[u]).not.toBe(3);
  });
  it("capture uses scored-window lightIn increments", () => {
    const c = (t: number, lightIn: bigint) => ({ t, lightIn, emit: 0n, photo: 0n, B: 10, sumBd: 0, sumBabs: 0, sumBL: 0, cohVar1000: null, cohFracPpm: null, lag: null, bodies: [], residual: 0n });
    const r: Series = { strategy: "sense", placement: "grouped", schedule: "paused", seed: 1, inputB: 10, inputE: 0, inputEnergy: 1000, censuses: [c(0, 0n), c(32, 400n), c(64, 600n), c(96, 1000n)], hashes: [], endHash: "" };
    expect(readouts(r, { from: 32, to: 96 }, SHORT).capturePpm).toBe(600_000);
    expect(readouts(r, { from: 64, to: 96 }, SHORT).capturePpm).toBe(400_000);
  });
  it("instrumented twin has the same stateHash sequence as plain", () => {
    const patches = buildPatches(SHORT, 8_700_001);
    const make = () => buildArm("sense", "grouped", "fixed", 8_700_001, patches, SHORT);
    const a = runArm(make(), { p: SHORT, observe: true }), b = runArm(make(), { p: SHORT, observe: false });
    expect(a.hashes).toEqual(b.hashes);
    expect(a.endHash).toBe(b.endHash);
    const plain = new RefSim(make().state);
    for (let i = 0; i < SHORT.T; i++) plain.step();
    expect(stateHash(plain.state)).toBe(a.endHash);
  });
  it("the reversed schedule takes an extra census exactly at the realised turn", () => {
    const p = { ...PROTOCOL, census: 128, T0: 128 };
    const patches = buildPatches(p, 8_700_002);
    const r = runArm(buildArm("still", "grouped", "reversed", 8_700_002, patches, p), { p, steps: 640 });
    const turn = scoredFrom("reversed", meridianPath("reversed", p), p);
    expect(turn % 128).not.toBe(0);
    const ts = r.censuses.map((c) => c.t);
    expect(ts).toContain(turn);
    expect(ts.filter((t) => t % 128 !== 0)).toEqual([turn]);
    const plain = runArm(buildArm("still", "grouped", "reversed", 8_700_002, patches, p), { p, steps: 640, observe: false });
    expect(plain.endHash).toBe(r.endHash);
  }, 60_000);
  it("conservation residual zero at every census", () => {
    const patches = buildPatches(SHORT, 8_700_002);
    const r = runArm(buildArm("drift", "dispersed", "wandering", 8_700_002, patches, SHORT), { p: SHORT });
    expect(r.censuses.length).toBe(1 + SHORT.T / SHORT.census);
    for (const c of r.censuses) expect(c.residual).toBe(0n);
  });
});
