import { describe, expect, it } from "vitest";
import { CH, RND3, cellBase, cellCount } from "@bl/schema";
import { RefSim3, diffOut6, diffRot6, portion6, share3 } from "@bl/sim-ref";
import { field, mirrorZ, randomSlab, rng, slabCfg } from "./step3d-helpers.ts";
import { w1d } from "@bl/sim-ref";

describe("slab operators: hand examples", () => {
  it("w1d weights at hw = 40, d = 0 are (8, 64, 8) and share3(1000, 64, 64, 64) = 512 with D1 = 80", () => {
    expect([-1, 0, 1].map((o) => w1d(0, o, 40))).toEqual([8, 64, 8]);
    expect(share3(1000, 64, 64, 64, 80)).toBe(512);
    // nested floors are not the floor of the product: floor(1000 * 8 * 64 * 64 / 80^3) = 64 but the chain gives 100 -> 80 -> 64 here
    expect(share3(1000, 8, 8, 8, 80)).toBe(Math.floor(Math.floor(Math.floor((1000 * 8) / 80) * 8 / 80) * 8 / 80));
    // a full weight is the identity
    expect(share3(123456, 80, 80, 80, 80)).toBe(123456);
    expect(share3(123456, 0, 80, 80, 80)).toBe(0);
  });

  it("share3 equals the nested exact floors at the rounding boundaries, for every D1 a config can reach", () => {
    // D1 = 2 * (32 + spread), spread in 0..32: 64, 80 and 128 are the ends and the default.
    for (const d1 of [64, 80, 128]) {
      const ws = [0, 1, 2, d1 / 2 - 1, d1 / 2, d1 / 2 + 1, d1 - 2, d1 - 1, d1];
      const qs = [0, 1, d1 - 1, d1, d1 + 1, 2 * d1 - 1, 3 * d1 + 1, 4999, 16381, (1 << 26) - 1, 1 << 26, 2 ** 27 - d1 - 1, 2 ** 27 - d1, 2 ** 27 - 1, 2 ** 27];
      const D = BigInt(d1);
      for (const q of qs)
        for (const wx of ws)
          for (const wy of ws)
            for (const wz of [0, 1, d1 / 2, d1 - 1, d1]) {
              const exact = (((BigInt(q) * BigInt(wx)) / D) * BigInt(wy) / D) * BigInt(wz) / D;
              expect(share3(q, wx, wy, wz, d1)).toBe(Number(exact));
            }
    }
  });

  it("the shares a source sends never exceed what it holds, and the stay is the rest (E up to 2^27)", () => {
    for (const d1 of [64, 80, 128]) {
      const r = rng(d1);
      for (let t = 0; t < 400; t++) {
        const q = t % 4 === 0 ? 2 ** 27 - (r() % 200) : r() % (2 ** 27 + 1);
        // three per-axis weights triples that sum to d1, as w1d produces
        const triple = () => { const a = r() % (d1 + 1), b = r() % (d1 + 1 - a); return [a, b, d1 - a - b]; };
        const wx = triple(), wy = triple(), wz = triple();
        let sent = 0;
        for (const a of wx) for (const b of wy) for (const c of wz) sent += share3(q, a, b, c, d1);
        expect(sent).toBeLessThanOrEqual(q);
        expect(q - sent).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("diffusion portions: q = 14, rot = 4 gives 2, 2, 3, 3, 2, 2 and always sums to q", () => {
    expect([0, 1, 2, 3, 4, 5].map((d) => portion6(14, d, 4))).toEqual([2, 2, 3, 3, 2, 2]);
    for (let q = 0; q < 200; q++) for (let rot = 0; rot < 6; rot++) expect([0, 1, 2, 3, 4, 5].reduce((a, d) => a + portion6(q, d, rot), 0)).toBe(q);
    expect(portion6(4_000_000, 0, 3)).toBe(Math.floor(4_000_000 / 6) + (3 < 4_000_000 % 6 ? 1 : 0));
  });

  it("at the full rate (De = 256) a sender sends exactly its portion, so the six outflows sum to q", () => {
    for (let c = 1; c < 40; c++) {
      const base = cellBase(9, 4, c);
      const q = 1000 + 37 * c;
      const rot = diffRot6(base);
      expect(rot).toBeLessThan(6);
      let tot = 0;
      for (let d = 0; d < 6; d++) {
        const o = diffOut6(q, d, 256, base, 0);
        expect(o).toBe(portion6(q, d, rot));
        tot += o;
      }
      expect(tot).toBe(q);
      // below the full rate the outflow never exceeds the portion
      for (let d = 0; d < 6; d++) for (const De of [1, 50, 128, 255]) expect(diffOut6(q, d, De, base, 1)).toBeLessThanOrEqual(portion6(q, d, rot));
    }
    expect(RND3.DIFF + 5 * 3 + 2).toBe(18);
    expect(RND3.DIFF_ROT).toBe(19);
  });
});

describe("slab operators: no z bias in the deterministic passes", () => {
  it("affinity gives a mirrored U on the z-mirrored state", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = randomSlab(seed);
      const a = new RefSim3(s), b = new RefSim3(mirrorZ(s));
      a.affinity(); b.affinity();
      const D = 8, WH = 256;
      for (let z = 0; z < D; z++) for (let i = 0; i < WH; i++) expect(b.affinityField[(D - 1 - z) * WH + i]).toBe(a.affinityField[z * WH + i]);
    }
  });

  it("flow gives mirrored displacement with dz negated (motility included)", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = randomSlab(seed, { motility: seed % 3 !== 0 });
      const a = new RefSim3(s), b = new RefSim3(mirrorZ(s));
      a.affinity(); a.flow(); b.affinity(); b.flow();
      const D = 8, WH = 256;
      let nonzeroDz = 0;
      for (let z = 0; z < D; z++) for (let i = 0; i < WH; i++) {
        const da = a.displacement[z * WH + i], db = b.displacement[(D - 1 - z) * WH + i];
        expect(db & 0xffff).toBe(da & 0xffff);
        expect(db >>> 16).toBe(128 - (da >>> 16));
        if ((da >>> 16) !== 64) nonzeroDz++;
      }
      expect(nonzeroDz).toBeGreaterThan(0);
    }
  });

  it("transport of B, P and E gives mirrored fields", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = randomSlab(seed, { motility: true });
      const before = Uint32Array.from(field(s, CH.B));
      const a = new RefSim3(s), b = new RefSim3(mirrorZ(s));
      a.affinity(); a.flow(); a.transport();
      b.affinity(); b.flow(); b.transport();
      const n = cellCount(s.cfg), D = 8, WH = 256;
      let moved = 0;
      for (const ch of [CH.B, CH.P, CH.E]) {
        const fa = field(a.state, ch), fb = field(b.state, ch);
        for (let z = 0; z < D; z++) for (let i = 0; i < WH; i++) expect(fb[(D - 1 - z) * WH + i]).toBe(fa[z * WH + i]);
      }
      // the step actually moved matter in z (not a vacuous mirror)
      const f0 = before, f1 = field(a.state, CH.B);
      for (let i = 0; i < n; i++) if (f0[i] !== f1[i]) moved++;
      expect(moved).toBeGreaterThan(0);
    }
  }, 60_000);
});
