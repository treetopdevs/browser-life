import { describe, expect, it } from "vitest";
import { PROTOCOL } from "../src/niche/protocol.ts";
import { FIXTURE_SEEDS, decideFixture, fixtureProtocol, giftBlock, nullBlock, runGuards, takeoverBlock, wallGateBlock } from "../src/niche/fixtures.ts";
import { wallReport } from "../src/niche/evidence.ts";
import { signTestP } from "../src/niche/decision.ts";

const fp = fixtureProtocol();
const delta = Math.ceil(fp.reserve.B / 50);

describe("niche fixtures", () => {
  for (const v of ["uniform", "footprint", "annulus"] as const) {
    it(`energy-gift ${v}: naive metric positive, edge unsupported, and the matched control that catches it`, () => {
      const rs = FIXTURE_SEEDS.map((s) => giftBlock(v, s, fp));
      const rep = decideFixture(`gift-${v}`, FIXTURE_SEEDS, rs, delta);
      expect(rep.naiveWouldSay).toBe("benefit");
      expect(rep.naiveK).toBeGreaterThanOrEqual(7);
      expect(rep.label).toBe("unsupported-within-tested-domain");
      expect(rep.matchedControls).toBe("caught");
      // The catching is attributed to the control that actually fails its own gating test.
      expect(rep.caughtBy).toContain(v === "uniform" ? "space" : "inoc");
      const kOf = (key: "space" | "inoc") => rs.filter((r) => r.contrasts[key] > 0).length;
      const notSignificant = (k: number) => signTestP(8, k).num * 20 > signTestP(8, k).den;
      // uniform gift: the scramble leaves it unchanged, so it cannot look spatial. Footprint and annulus gifts: the scramble would mislabel them spatial, the energy-matched inoculum does not.
      if (v === "uniform") expect(notSignificant(kOf("space"))).toBe(true);
      else expect(notSignificant(kOf("inoc"))).toBe(true);
    });
  }

  it("takeover-only: labelled inventory rises with zero synthesis, edge text omits growth", () => {
    const rs = FIXTURE_SEEDS.map((s) => takeoverBlock(s, fp));
    for (const r of rs) {
      expect(r.outcomes.b!.synthesis).toBe(0);
      expect(r.outcomes.b!.growthAttributed).toBe(false);
    }
    // Receiver-labelled inventory ends above the receiver-alone control in at least 7 of 8 seeds, and above its own inoculum in most, with no synthesis at all.
    expect(rs.filter((r) => r.contrasts.naive > 0).length).toBeGreaterThanOrEqual(7);
    expect(rs.filter((r) => r.outcomes.b!.y > fp.reserve.B).length).toBeGreaterThanOrEqual(6);
  });

  it("hand-wall: spatial dependence detected at the frozen scale (W2 floor under injury), as pre-stated", () => {
    const w = wallReport("W2", PROTOCOL.wall.totalP);
    expect(w.k).toBeGreaterThanOrEqual(7);
    expect(w.passes).toBe(true);
  });

  it("hand-wall through the whole gate: a polymer shield under the receiver is certifiable (inoc is not vacuously negative), polymer-attributed", () => {
    const seeds = FIXTURE_SEEDS;
    const rep = decideFixture("wall-gate", seeds, seeds.map((s) => wallGateBlock("W2", s)), Math.ceil(PROTOCOL.reserve.B / 50));
    expect(rep.gatingK.inoc).toBeGreaterThanOrEqual(7);
    expect(rep.gatingK.space).toBeGreaterThanOrEqual(7);
    expect(rep.caughtBy.length).toBeLessThanOrEqual(1);
  }, 120_000);

  it("null-field zero effect", () => {
    for (const s of FIXTURE_SEEDS.slice(0, 3)) {
      const r = nullBlock(s, fp);
      expect(Object.values(r.contrasts).filter((x) => x !== null).every((x) => x === 0)).toBe(true);
    }
  });

  it("overwrite-attempt, pool-cap, underfunded and empty-receiver-reserve guards refuse", () => {
    const g = runGuards();
    expect(g.map((x) => x.id).sort()).toEqual(["empty-receiver-reserve", "overwrite-attempt", "pool-cap", "underfunded-reserve"]);
    for (const x of g) expect(x.ok, `${x.id}: ${x.detail}`).toBe(true);
  });
});
