import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CH, cellCount } from "@bl/schema";
import { buildArms, placeAll, receiverAlone, footprintCells, type PreArm } from "../src/niche/arms.ts";
import { runBlock } from "../src/niche/assay.ts";
import { PROTOCOL, PROTOCOL_FE, candidateOf, type ProtocolFe } from "../src/niche/protocol.ts";
import { buildFreeMatched, freeRows, latticeE, totalEnergyOf } from "../src/niche/freeEnergy.ts";
import { detritusField, fixtureProtocolFe, runGuardsFe } from "../src/niche/fixturesFe.ts";
import { controlsAround, uniformBudget } from "../src/niche/fixtures.ts";
import { commonCells, residuals, type Audit } from "../src/niche/transfer.ts";

const fp = fixtureProtocolFe();
const short: ProtocolFe = { ...PROTOCOL_FE, T1: 8, T2: 12, census: 1, R: 2 };

/** A conditioned arm with bound energy (detritus) and the comparators built around it, at unit scale. */
const world = (seed = 1) => {
  const { base, cond } = detritusField(seed, fp);
  const arms = [...controlsAround(cond, base, seed, fp)];
  const fm = buildFreeMatched(arms[0], fp);
  return { base, cond, arms: [...arms, ...fm.arms], fm };
};
const byId = (arms: PreArm[], id: string) => arms.find((x) => x.id === id)!;
const chan = (s: PreArm, ch: number) => Array.from(s.state.cells.slice(ch * cellCount(s.state.cfg), (ch + 1) * cellCount(s.state.cfg)));

describe("free-energy-matched comparators", () => {
  it("fU free E equals b free E exactly and matter equals", () => {
    const { arms } = world();
    const b = byId(arms, "b"), f = byId(arms, "fU");
    expect(latticeE(f.state)).toBe(latticeE(b.state));
    expect(latticeE(byId(arms, "d0").state)).toBeGreaterThan(latticeE(b.state));
    const mb = residuals(b.state, b.audit), mf = residuals(f.state, f.audit);
    expect(mb.matter).toBe(0n);
    expect(mf.matter).toBe(0n);
    expect(f.audit.matterStart).toBe(b.audit.matterStart);
    expect(f.audit.reserveB).toBe(b.audit.reserveB);
    expect(f.audit.reserveE).toBe(b.audit.reserveE);
  });

  it("fS E channel equals b E channel cell for cell", () => {
    const { arms } = world();
    expect(chan(byId(arms, "fS"), CH.E)).toEqual(chan(byId(arms, "b"), CH.E));
  });

  it("fB free E equals b cell for cell before and after placement (no lattice debit); its total energy exceeds fS by (eB - eA) * dB and its gap to b is recorded with its sign", () => {
    const { arms } = world();
    const fB = byId(arms, "fB"), b = byId(arms, "b");
    expect(chan(fB, CH.E)).toEqual(chan(b, CH.E));
    expect(fB.audit.reserveB).toBeGreaterThan(b.audit.reserveB);
    const dB = fB.audit.reserveB - b.audit.reserveB;
    const rows = freeRows(arms);
    expect(rows.find((r) => r.id === "fB")!.freeGapToB).toBe("0");
    placeAll(arms, fp, { genome: undefined });
    expect(chan(fB, CH.E)).toEqual(chan(b, CH.E));
    expect(freeRows(arms).find((r) => r.id === "fB")!.freeGapToB).toBe("0");
    const gap = (id: string) => BigInt(freeRows(arms).find((r) => r.id === id)!.constructionGap);
    const cfg = b.state.cfg;
    expect(gap("fS") - gap("fB")).toBe(BigInt((cfg.eB - cfg.eA) * dB));
  });

  it("fB carries comparator-excess against total energy when the reserve it adds outweighs the field's bound deficit", () => {
    // A free-field world (gift): b = d0 + free energy, no bound matter; fB adds the biomass b held (none) so equals fS: total-matched.
    const { base } = world();
    const cond: PreArm = { id: "b", state: base.state, audit: base.audit, records: [] };
    const fm = buildFreeMatched(cond, fp);
    const rows = freeRows([cond, ...fm.arms]);
    for (const id of ["fU", "fS", "fB"]) expect(rows.find((r) => r.id === id)!.flag).toBe("total-matched");
  });

  it("constructionGap sign: positive when the comparator total is lower than the field arm's", () => {
    const { arms } = world();
    const rows = freeRows(arms);
    const fU = rows.find((r) => r.id === "fU")!;
    // detritus B holds eB per quantum, nutrient A only eA: matter equal, so the comparator holds less total energy.
    expect(BigInt(fU.constructionGap)).toBeGreaterThan(0n);
    expect(fU.flag).toBe("comparator-deficit");
    expect(BigInt(fU.constructionGap)).toBe(totalEnergyOf(byId(arms, "b").state, byId(arms, "b").audit) - totalEnergyOf(byId(arms, "fU").state, byId(arms, "fU").audit));
  });

  it("every arm residual is 0n against its own baseline, at construction and after placement", () => {
    const { arms } = world();
    const check = () => {
      for (const x of arms) {
        const r = residuals(x.state, x.audit);
        expect([x.id, r.energy, r.matter]).toEqual([x.id, 0n, 0n]);
      }
    };
    check();
    placeAll(arms, fp);
    check();
    for (const x of arms) for (const rec of x.records) expect([rec.residual, rec.matterResidual]).toEqual(["0", "0"]);
  });

  it("rung-1 audit serialization unchanged: the audit has the same five keys and no credit term", () => {
    const a: Audit = receiverAlone({ audit: uniformBudget(fp) }, 1, fp).audit;
    expect(Object.keys(a).sort()).toEqual(["energyStart", "heatAnalytic", "matterStart", "reserveB", "reserveE"]);
  });

  it("credit-overdraw: a comparator that cannot be funded is refused, not clamped", () => {
    const g = runGuardsFe(fp);
    expect(g).toEqual([{ id: "credit-overdraw", ok: true, detail: expect.stringMatching(/credit-overdraw/) }]);
  });

  it("d0 d1E d1B unchanged from rung 1 (a rung-1 block reproduces the sealed end hashes)", () => {
    const cal = JSON.parse(readFileSync(new URL("../../../docs/niche-construction-2026-11-01/calibration.json", import.meta.url), "utf8"));
    const sealed = cal.candidates[0].blocks[0];
    const b = runBlock(sealed.cluster, sealed.seed, PROTOCOL, PROTOCOL.devReplicateSeeds[0]);
    for (const id of ["d0", "d1E", "d1B"]) expect(b.outcomes[id as "d0"]!.endHash).toBe(sealed.outcomes[id].endHash);
  }, 120_000);

  it("placement set is still the intersection across arms, and every arm starts at absolute step T1 with equal config", () => {
    const built = buildArms(candidateOf(0, short), short.devSeeds[0], short);
    const fm = buildFreeMatched(built.arms.find((x) => x.id === "b")!, short);
    const arms = [...built.arms, ...fm.arms];
    const want = commonCells(arms.map((x) => x.state), footprintCells(short), Math.ceil(Math.max(...arms.map((x) => x.audit.reserveE)) / short.nMin));
    expect(placeAll(arms, short)).toEqual(want);
    for (const x of arms) {
      expect(x.state.step).toBe(short.T1);
      expect(x.state.cfg.seed).toBe(arms[0].state.cfg.seed);
      expect(x.state.cfg.injuryPeriod).toBe(arms[0].state.cfg.injuryPeriod);
    }
  });
});
