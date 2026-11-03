import { describe, expect, it } from "vitest";
import { fieldBlock, fixtureProtocolFe, decideFixtureFe, freeGapSeed, nullBlockFe, runGuardsFe, takeoverBlockFe, wallGateBlockFe2 } from "../src/niche/fixturesFe.ts";
import { runGuards } from "../src/niche/fixtures.ts";
import { PROTOCOL_FE } from "../src/niche/protocol.ts";

const fp = fixtureProtocolFe();
const seeds = PROTOCOL_FE.fixtureSeeds;
const delta = Math.ceil((fp.reserve.B * fp.R) / 50);

describe("second-rung fixtures", () => {
  it("far-field-energy: naive positive, rung-1 D_inoc positive (fooled), D_inoc2 not positive, full gate unsupported via D_poly = 0 (caughtBy recorded)", () => {
    const r = decideFixtureFe("far-field-energy", seeds, seeds.map((s) => fieldBlock("far-field", s, fp)), delta);
    expect(r.naiveWouldSay).toBe("benefit");
    expect(r.inocFooledOld).toBe(true);
    expect(r.inocCaughtNew).toBe(true);
    expect(r.kNew).toBeLessThan(r.kOld);
    expect(r.gatingK.poly).toBe(0);
    expect(r.caughtBy).toContain("poly");
    expect(r.caughtBy).toContain("inoc2");
    expect(r.fullGateLabel).not.toBe("supported");
    // d0 (and so d1E, d1B) hold less free energy than the field; fU, fS, fB hold the same.
    const free = (id: string) => BigInt(r.freeBefore.find((x) => x.id === id)!.freeE);
    expect(free("d0")).toBeLessThan(free("b"));
    for (const id of ["fU", "fS", "fB"]) expect(free(id)).toBe(free("b"));
  }, 120_000);

  it("free-gap-replay closes the free-E gap: d0 holds more free E at equal totals, fU/fS/fB reproduce b's free E exactly, every residual 0n", () => {
    for (const s of seeds) {
      const r = freeGapSeed(s, fp);
      expect(r.d0HoldsMoreFree).toBe(true);
      expect(r.totalsEqual).toBe(true);
      for (const id of ["fU", "fS", "fB"]) {
        expect(r.freeDiffBefore[id]).toBe("0");
        expect(r.freeDiffAfter[id]).toBe("0");
      }
      // The field here binds its energy as detritus B only: fU and fS hold less total energy, and fB (which is handed that biomass as inoculum) closes the total gap too.
      for (const id of ["d0", "fU", "fS"]) expect(id === "d0" ? r.constructionGap[id] : BigInt(r.constructionGap[id]) > 0n).toBeTruthy();
      expect(r.flags.fU).toBe("comparator-deficit");
      expect(r.constructionGap.fB).toBe("0");
      expect(r.flags.fB).toBe("total-matched");
      expect(r.residualsZero).toBe(true);
    }
  });

  it("takeover-only still has zero synthesis; null-field gives exact zero contrasts", () => {
    const t = takeoverBlockFe(seeds[0], fp);
    expect(t.outcomes.b.synthesis).toBe(0);
    const n = nullBlockFe(seeds[0], fp);
    expect(n.contrasts).toMatchObject({ builder: 0, poly: 0, space: 0, inoc2: 0, naive: 0 });
  }, 60_000);

  it("hand-wall-gate-W2 (rung-1 allowP wall at the frozen scale) is the positive control: all eight seeds, supported, no failed gating contrast", () => {
    const p = { ...PROTOCOL_FE, R: PROTOCOL_FE.fixtureR };
    expect(seeds).toHaveLength(8);
    const r = decideFixtureFe("hand-wall-gate-W2", seeds, seeds.map((s) => wallGateBlockFe2(s, p)), Math.ceil((p.reserve.B * p.R) / 50));
    expect(Object.keys(r.gatingK).sort()).toEqual(["builder", "inoc2", "poly", "space"]);
    expect(r.fullGateLabel).toBe("supported");
    expect(r.caughtBy).toEqual([]);
    // 7 of 8 is the pass bar for each gating contrast (the 8-seed fixture exact-sign bar is the lab's frozen 7/8).
    for (const c of ["builder", "poly", "space", "inoc2"]) expect(r.gatingK[c], c).toBeGreaterThanOrEqual(7);
  }, 600_000);

  it("every guard refuses", () => {
    for (const g of [...runGuards(), ...runGuardsFe(fp)]) expect([g.id, g.ok]).toEqual([g.id, true]);
  });
});
