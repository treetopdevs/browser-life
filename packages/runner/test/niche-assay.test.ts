import { describe, expect, it } from "vitest";
import { G, canonicalJSON, cellCount, decodeCheckpoint, encodeCheckpoint, stateHash } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { PROTOCOL, candidateOf, type Protocol } from "../src/niche/protocol.ts";
import { buildArms, placeAll } from "../src/niche/arms.ts";
import { compactBlock } from "../src/niche/evidence.ts";
import { runArm, runBlock } from "../src/niche/assay.ts";
import { cloneAudit, cloneState } from "../src/niche/transfer.ts";
import { freshReport, isPolymerAdequate, type DevReport } from "../src/niche/evidence.ts";

const seed = PROTOCOL.devSeeds[1];
const short: Protocol = { ...PROTOCOL, T1: 8, T2: 12, census: 1 };
const placed = () => {
  const b = buildArms(candidateOf(0), seed, short);
  placeAll(b.arms, short);
  return b;
};

describe("niche assay", () => {
  it("instrumented twin equals plain twin (stateHash): the readout does not change physics", () => {
    const b = placed();
    const x = b.arms.find((a) => a.id === "b")!;
    const plain = new RefSim(cloneState(x.state));
    plain.run(short.T2);
    let calls = 0;
    const out = runArm({ ...x, state: cloneState(x.state), audit: cloneAudit(x.audit) }, short, { onStep: () => void calls++ });
    expect(out.endHash).toBe(stateHash(plain.state));
    expect(calls).toBe(short.T2);
  });

  it("ledgerResidual is 0n at every census of both stages (census every step)", () => {
    const r = runBlock(0, seed, short);
    expect(r.valid, r.invalidReason ?? "").toBe(true);
    for (const o of Object.values(r.outcomes)) expect(o!.receiverB.length).toBe(short.T2 + 1);
  });

  it("deterministic replay: same block twice gives equal payload bytes", () => {
    const a = canonicalJSON(compactBlock(runBlock(0, seed, short, 77)));
    const b = canonicalJSON(compactBlock(runBlock(0, seed, short, 77)));
    expect(a).toBe(b);
  });

  it("segmented stage 2 (checkpoint round trip at the midpoint) equals continuous", () => {
    const b = placed();
    const x = b.arms.find((a) => a.id === "b")!;
    const cont = new RefSim(cloneState(x.state));
    cont.run(short.T2);
    const half = new RefSim(cloneState(x.state));
    half.run(short.T2 / 2);
    const back = decodeCheckpoint(encodeCheckpoint(half.state)).state;
    const rest = new RefSim(back);
    rest.run(short.T2 / 2);
    expect(stateHash(rest.state)).toBe(stateHash(cont.state));
  });

  it("mutation off: no new lineage ids", () => {
    const b = placed();
    const seen = new Set<string>();
    for (const x of b.arms) {
      runArm(x, short, {
        onStep: (s) => {
          const n = cellCount(s.cfg);
          for (let i = 0; i < n; i++) if ((s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) !== 0) seen.add(`${s.genome[G.LIN_HI * n + i]}:${s.genome[G.LIN_LO * n + i]}`);
        },
      });
    }
    expect([...seen].sort()).toEqual(["0:1", "0:2"]);
  });

  it("flux attribution unavailable when a role counter reaches saturation", () => {
    const b = placed();
    const x = b.arms.find((a) => a.id === "b")!;
    const sat = runArm({ ...x, state: cloneState(x.state), audit: cloneAudit(x.audit) }, { ...short, roleSaturation: 1 });
    expect(sat.saturated).toBe(true);
    expect(sat.growthAttributed).toBe(false);
    const ok = runArm({ ...x, state: cloneState(x.state), audit: cloneAudit(x.audit) }, short);
    expect(ok.saturated).toBe(false);
  });

  it("co-culture flux attribution is unavailable (null), while the builder-removed arm is attributed", () => {
    const b = placed();
    const a = runArm(b.arms.find((x) => x.id === "a")!, short);
    expect([a.synthesis, a.decomp, a.resp, a.growthAttributed]).toEqual([null, null, null, false]);
    const r = runArm(b.arms.find((x) => x.id === "b")!, short);
    expect(typeof r.synthesis).toBe("number");
  });

  it("observer reads roles every Stage 2 step", () => {
    const b = placed();
    const steps: number[] = [];
    runArm(b.arms[0], short, { onStep: (s, roles) => (roles.length > 0 ? steps.push(s.step) : undefined) });
    expect(steps).toEqual(Array.from({ length: short.T2 }, (_, i) => short.T1 + i + 1));
  });

  it("polymer adequacy compares twice the median builder P with twice the candidate's dev replicate floor (PLAN 5.3)", () => {
    // The frozen dev medians (103.5, 98, 84.5) against the dev floors (341, 291, 404): none adequate.
    expect([[207, 341], [196, 291], [169, 404]].map(([p2, d]) => isPolymerAdequate(p2, d))).toEqual([false, false, false]);
    expect(isPolymerAdequate(2 * 341 + 1, 341)).toBe(true);
    expect(isPolymerAdequate(2 * 341, 341)).toBe(false);
  });

  it("a failed positive control runs no fresh seed and the panel is unsupported-measurement, and it still seals", () => {
    const dev = { wall: { positiveControlPassed: false } } as unknown as DevReport;
    const f = freshReport(dev, PROTOCOL);
    expect(f.ran).toBe(false);
    expect(f.candidates).toEqual([]);
    expect(f.panel.verdict).toBe("unsupported-measurement");
    expect(() => canonicalJSON(f)).not.toThrow();
  });
});
