import { describe, expect, it } from "vitest";
import { canonicalJSON, stateHash } from "@bl/schema";
import { RefSim } from "@bl/sim-ref";
import { buildArms, placeAll } from "../src/niche/arms.ts";
import { runArm } from "../src/niche/assay.ts";
import { ALPHA, signTestP } from "../src/niche/decision.ts";
import { binomialUpperTail, decideCandidatesFe, panelVerdictFe, type CandidateInputFe } from "../src/niche/decisionFe.ts";
import { GATING_FE, PROTOCOL_FE, candidateOf, type ProtocolFe } from "../src/niche/protocol.ts";
import { runFeArms, fixtureProtocolFe, detritusField } from "../src/niche/fixturesFe.ts";
import { ARMS_FE, noiseBlock, runArmReplicated, runBlockFe, seedFor } from "../src/niche/replicate.ts";
import { controlsAround } from "../src/niche/fixtures.ts";
import { cloneAudit, cloneState } from "../src/niche/transfer.ts";

const short: ProtocolFe = { ...PROTOCOL_FE, T1: 8, T2: 12, census: 1, R: 2 };
const placed = (p = short) => {
  const b = buildArms(candidateOf(0, p), p.devSeeds[1], p);
  placeAll(b.arms, p);
  return b;
};

describe("replicated readout", () => {
  it("replicate offsets are identical in every arm", () => {
    const b = placed();
    const seen: Record<string, Set<number>> = {};
    for (const id of ["b", "nb", "d0"]) {
      seen[id] = new Set();
      runArmReplicated(b.arms.find((x) => x.id === id)!, short.devSeeds[1], short, 2, { onStep: (s) => void seen[id].add(s.cfg.seed) });
    }
    const want = [seedFor(short.devSeeds[1], 0), seedFor(short.devSeeds[1], 1)];
    for (const id of Object.keys(seen)) expect([...seen[id]].sort((a, b) => a - b)).toEqual(want);
  });

  it("Y is the integer sum of the R replicate endpoints; AUC is reported and never gating", () => {
    const b = placed();
    const o = runArmReplicated(b.arms.find((x) => x.id === "b")!, short.devSeeds[1], short, 2);
    expect(o.ys).toHaveLength(2);
    expect(o.y).toBe(o.ys[0] + o.ys[1]);
    expect(Number.isInteger(o.y) && Number.isInteger(o.auc)).toBe(true);
    expect(o.auc).toBeGreaterThanOrEqual(0);
    expect(GATING_FE as readonly string[]).not.toContain("auc");
  });

  it("replicate 0 is the rung-1 pipeline at the block seed", () => {
    const b = placed();
    const x = b.arms.find((a) => a.id === "b")!;
    const plain = runArm({ ...x, state: cloneState(x.state), audit: cloneAudit(x.audit) }, short);
    expect(runArmReplicated(x, short.devSeeds[1], short, 1).endHashes[0]).toBe(plain.endHash);
  });

  it("instrumented twin equals plain twin (stateHash) per replicate", () => {
    const b = placed();
    const x = b.arms.find((a) => a.id === "b")!;
    const plain = runArmReplicated(x, short.devSeeds[1], short, 2);
    let calls = 0;
    const inst = runArmReplicated(x, short.devSeeds[1], short, 2, { onStep: () => void calls++ });
    expect(inst.endHashes).toEqual(plain.endHashes);
    expect(calls).toBe(2 * short.T2);
    const twin = new RefSim(cloneState(x.state, { ...x.state.cfg, seed: seedFor(short.devSeeds[1], 1) }));
    twin.run(short.T2);
    expect(plain.endHashes[1]).toBe(stateHash(twin.state));
  });

  it("deterministic replay: the same block twice gives equal bytes; every census of every replicate audits to zero", () => {
    const a = runBlockFe(0, short.devSeeds[1], short), b = runBlockFe(0, short.devSeeds[1], short);
    expect(a.valid).toBe(true);
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
    expect(Object.keys(a.outcomes).sort()).toEqual([...ARMS_FE].sort());
    for (const recs of Object.values(a.transfers)) for (const r of recs) expect([r.residual, r.matterResidual]).toEqual(["0", "0"]);
  }, 60_000);

  it("segmented stage 2 equals continuous at a replicate seed (checkpoint-free split of the same run)", () => {
    const b = placed();
    const x = b.arms.find((a) => a.id === "b")!;
    const cfg = { ...x.state.cfg, seed: seedFor(short.devSeeds[1], 1) };
    const cont = new RefSim(cloneState(x.state, cfg));
    cont.run(short.T2);
    const half = new RefSim(cloneState(x.state, cfg));
    half.run(short.T2 / 2);
    half.run(short.T2 / 2);
    expect(stateHash(half.state)).toBe(stateHash(cont.state));
  });

  it("R=4 sum noise floor on a no-op control is below the R=1 floor scaled by R (dev-scale fixture with injury)", () => {
    const fp = { ...fixtureProtocolFe(), R: 4, injury: { period: 6, radius: 2, prob: 40_000_000, shell: 15 } };
    let f1 = 0, f4 = 0;
    for (const s of PROTOCOL_FE.devReplicateSeeds) {
      const { base, cond } = detritusField(s, fp);
      const arms = controlsAround(cond, base, s, fp);
      placeAll(arms, fp);
      const b = arms.find((x) => x.id === "b")!;
      const A = [0, 1, 2, 3], B = [4, 5, 6, 7];
      const y = (offs: number[]) => runArmReplicated(b, s, fp, 4, {}, offs);
      const ya = y(A), yb = y(B);
      f4 = Math.max(f4, Math.abs(ya.y - yb.y));
      f1 = Math.max(f1, Math.abs(ya.ys[0] - yb.ys[0]));
    }
    // The R = 4 floor must be strictly below R = 1 scaled by R, and the control must not be degenerate (replay: f1 = 231, f4 = 500 < 924).
    expect(f1).toBeGreaterThan(0);
    expect(f4).toBeLessThan(4 * f1);
  }, 120_000);

  it("block viability is the R-1-of-R conversion of the field arm's surviving replicates (R = 4)", () => {
    const p4: ProtocolFe = { ...short, R: 4 };
    // Known gap (deferred, needs a new freeze): both real blocks have 4 survivors, so the 2- and 3-survivor boundary is only checked on the rule below, not in production code.
    // The conversion lives inside runBlockFe (a frozen source), so it is checked there: viable must equal survivedReps >= R - 1 for each block,
    // and the survivedReps must be the count of positive replicate endpoints. Hand table for the rule itself:
    const rule = (surv: number, R: number) => surv >= R - 1;
    expect([2, 3, 4].map((k) => rule(k, 4))).toEqual([false, true, true]);
    for (const s of [PROTOCOL_FE.devSeeds[0], PROTOCOL_FE.devSeeds[1]]) {
      const r = runBlockFe(PROTOCOL_FE.panel[0], s, p4);
      if (!r.valid) continue;
      expect(r.outcomes.b.survivedReps).toBe(r.outcomes.b.ys.filter((y) => y > 0).length);
      expect(r.viable).toBe(rule(r.outcomes.b.survivedReps, 4));
    }
  }, 300_000);

  it("noiseBlock refuses an R that would leave the reserved replicate offsets", () => {
    expect(() => noiseBlock(0, PROTOCOL_FE.devReplicateSeeds[0], { ...PROTOCOL_FE, R: 8 })).toThrow(/reserved/);
  });

  it("runFeArms returns the second-rung contrasts with inoc2 at most inoc", () => {
    const fp = fixtureProtocolFe();
    const { base, cond } = detritusField(2, fp);
    const r = runFeArms(cond, base, 2, fp);
    expect(r.contrasts.inoc2).toBeLessThanOrEqual(r.contrasts.inoc);
    expect(r.outcomes.fU).toBeDefined();
  });
});

const inputOf = (id: string, k: number, n = 16, over: Partial<CandidateInputFe> = {}): CandidateInputFe => {
  const d = Array.from({ length: n }, (_, i) => (i < k ? 100 : -100));
  return { id, status: "ok", invalidReasons: [], contrasts: { builder: d, poly: d, space: d, inoc2: d, spaceP: d, spaceNP: d, inoc: d, inocMatched: d, naive: d }, delta: 10, viableBlocks: 16, blocks: n, expectedBlocks: n, notSimulatedReasons: [], ...over };
};

describe("second-rung decision", () => {
  it("exact sign p for n=16 at k=12, 14, 16 against hand enumeration", () => {
    expect(signTestP(16, 16)).toEqual({ num: 1, den: 65536 });
    expect(signTestP(16, 14)).toEqual({ num: 120 + 16 + 1, den: 65536 });
    expect(signTestP(16, 12)).toEqual({ num: 1820 + 560 + 120 + 16 + 1 - 0 - 0, den: 65536 });
    expect(signTestP(16, 13)).toEqual({ num: 697, den: 65536 });
  });

  it("Holm resolution at n=16 over three candidates: thresholds 1/60, 1/40, 1/20 and k >= 13 passes the first", () => {
    const rs = decideCandidatesFe([inputOf("c0", 16), inputOf("c4", 16), inputOf("c9", 13)]);
    expect(rs.map((r) => r.label)).toEqual(["supported", "supported", "supported"]);
    expect(rs.map((r) => r.holmThreshold!.den).sort((a, b) => a - b)).toEqual([20, 40, 60]);
    // k = 12 (p = 2517/65536) still clears the last Holm step (1/20) behind two perfect candidates; k = 11 (6885/65536) does not.
    expect(decideCandidatesFe([inputOf("c0", 12), inputOf("c4", 16), inputOf("c9", 16)]).find((r) => r.id === "c0")!.label).toBe("supported");
    const bad = decideCandidatesFe([inputOf("c0", 11), inputOf("c4", 16), inputOf("c9", 16)]);
    expect(bad.find((r) => r.id === "c0")!.label).toBe("unsupported-within-tested-domain");
  });

  it("no floats in the sealed payload shape; power table values are exact (0.75: 40.5%, 0.9: 93.2%)", () => {
    expect(() => canonicalJSON(decideCandidatesFe([inputOf("c0", 16)]))).not.toThrow();
    const pct = (qn: bigint, qd: bigint) => {
      const t = binomialUpperTail(16, 13, qn, qd);
      return Number((t.num * 10000n) / t.den) / 100;
    };
    expect(pct(3n, 4n)).toBeCloseTo(40.49, 1);
    expect(pct(17n, 20n)).toBeCloseTo(78.98, 1);
    expect(pct(9n, 10n)).toBeCloseTo(93.15, 1);
    expect(pct(19n, 20n)).toBeCloseTo(99.29, 1);
    expect(binomialUpperTail(16, 13, 1n, 2n).num * 65536n).toBe(697n * binomialUpperTail(16, 13, 1n, 2n).den);
    expect(PROTOCOL_FE.powerStatement).toMatch(/40\.5%.*79%.*93%.*99%/);
    expect(ALPHA).toEqual({ num: 1, den: 20 });
  });

  it("field arm viability requires 14 of 16 blocks; the paired survival contrast is not gating", () => {
    const ok = decideCandidatesFe([inputOf("c0", 16, 16, { viableBlocks: 14 })])[0];
    const no = decideCandidatesFe([inputOf("c0", 16, 16, { viableBlocks: 13 })])[0];
    expect(ok.label).toBe("supported");
    expect(no.label).toBe("unsupported-within-tested-domain");
    expect(no.reasons.join(" ")).toMatch(/viable/);
    expect(GATING_FE as readonly string[]).not.toContain("survival");
  });

  it("a candidate the positive control did not qualify is unsupported-measurement, never a negative; the panel is not negative", () => {
    const ns = inputOf("c0", 0, 16, { status: "not-simulated", notSimulatedReasons: ["minimum detectable dose 600 exceeds the ceiling 170"] });
    const rs = decideCandidatesFe([ns, inputOf("c4", 0), { ...ns, id: "c9" }]);
    expect(rs.find((r) => r.id === "c0")).toMatchObject({ label: "unsupported-measurement", simulated: false });
    expect(rs.find((r) => r.id === "c4")!.label).toBe("unsupported-within-tested-domain");
    expect(panelVerdictFe(rs).verdict).toBe("unsupported-measurement");
    expect(panelVerdictFe([rs[1]]).verdict).toBe("no-causal-benefit-detected");
  });
});
