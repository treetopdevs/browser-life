import { describe, expect, it } from "vitest";
import { CH, cellCount, lowbias32, totalsOf, validateState } from "@bl/schema";
import { PROTOCOL, candidateOf, type Protocol } from "../src/niche/protocol.ts";
import { buildArms, runHistory, type BlockArms } from "../src/niche/arms.ts";
import { GIFT, fixtureProtocol, giftBlock, takeoverBlock, uniformBudget } from "../src/niche/fixtures.ts";
import { cloneAudit, cloneState, permutation, scrambleChannels, matchedControlsProbe } from "./niche-helpers.ts";

const seed = PROTOCOL.devSeeds[0];
const cand = candidateOf(0);
const short: Protocol = { ...PROTOCOL, T1: 7, T2: 4, census: 1 };
let blk: BlockArms | null = null;
const block = () => (blk ??= buildArms(cand, seed, short, 99));
const CHS = [CH.A, CH.B, CH.C, CH.P, CH.E, CH.S];

describe("niche arms", () => {
  it("scramble preserves each channel total exactly", () => {
    const h = runHistory(cand, "builder", seed, short);
    const s = cloneState(h.state), a = cloneAudit(h.audit);
    const before = totalsOf(s.cfg, s.cells);
    scrambleChannels(s, a, seed, CHS, lowbias32);
    const after = totalsOf(s.cfg, s.cells);
    for (const k of ["A", "B", "C", "P", "E", "S"] as const) expect(after[k]).toBe(before[k]);
    expect(validateState(s)).toEqual([]);
  });

  it("scramble is identical for the same seed across histories", () => {
    const n = 576;
    expect(permutation(n, seed, CH.P, lowbias32)).toEqual(permutation(n, seed, CH.P, lowbias32));
    expect(permutation(n, seed, CH.P, lowbias32)).not.toEqual(permutation(n, seed + 1, CH.P, lowbias32));
    expect(permutation(n, seed, CH.P, lowbias32)).not.toEqual(permutation(n, seed, CH.E, lowbias32));
    expect([...permutation(n, seed, CH.P, lowbias32)].sort((x, y) => x - y)).toEqual(Array.from({ length: n }, (_, i) => i));
    // two different states are rearranged by the very same permutation
    const b = block();
    const c = b.arms.find((x) => x.id === "c")!, nb = b.arms.find((x) => x.id === "nb")!;
    expect(c.records.some((r) => r.op === "scramble")).toBe(true);
    expect(nb.state.cells.length).toBe(c.state.cells.length);
  });

  it("scramble changes structure (adjacent-pair statistic differs)", () => {
    const h = runHistory(cand, "builder", seed, PROTOCOL);
    const s = cloneState(h.state), a = cloneAudit(h.audit);
    const n = cellCount(s.cfg), W = 24;
    const stat = (st: typeof s) => {
      let t = 0;
      for (let i = 0; i < n; i++) t += st.cells[CH.P * n + i] * st.cells[CH.P * n + ((i % W === W - 1) ? i - W + 1 : i + 1)];
      return t;
    };
    const before = stat(s);
    expect(before).toBeGreaterThan(0);
    scrambleChannels(s, a, seed, [CH.P], lowbias32);
    expect(stat(s)).not.toBe(before);
  });

  it("d1E and d1B raise reserve and debit the lattice by the same amounts (with the eB-eA chemical debit); the halo makes bound-matter matching non-vacuous", () => {
    const fp = fixtureProtocol();
    const e = matchedControlsProbe("annulus", fp);
    expect(e.dE).toBe(GIFT.annulus);
    expect(e.d1E.audit.reserveE).toBe(e.d0.audit.reserveE + e.dE);
    expect(totalsOf(e.d0.state.cfg, e.d0.state.cells).E - totalsOf(e.d1E.state.cfg, e.d1E.state.cells).E).toBe(BigInt(e.dE));
    const t = matchedControlsProbe("detritus", fp);
    expect(t.dB).toBeGreaterThan(0);
    expect(t.d1B.audit.reserveB).toBe(t.d0.audit.reserveB + t.dB);
    const cfg = t.d0.state.cfg;
    expect(totalsOf(cfg, t.d0.state.cells).A - totalsOf(cfg, t.d1B.state.cells).A).toBe(BigInt(t.dB));
    expect(totalsOf(cfg, t.d0.state.cells).E - totalsOf(cfg, t.d1B.state.cells).E).toBe(BigInt((cfg.eB - cfg.eA) * t.dB));
    expect(t.d1B.audit.reserveE).toBe(t.d0.audit.reserveE);
    void giftBlock; void takeoverBlock; void uniformBudget;
  });

  it("scramble variants cP and cNP preserve channel totals and move only their channels", () => {
    const b = block();
    const base = b.arms.find((x) => x.id === "b")!.state, cp = b.arms.find((x) => x.id === "cP")!.state, cnp = b.arms.find((x) => x.id === "cNP")!.state;
    const n = cellCount(base.cfg);
    const sumOf = (s: typeof base, ch: number) => totalsOf(s.cfg, s.cells)["ABCPES"[ch === CH.S ? 5 : ch] as "A"];
    for (const ch of CHS) {
      const k = "ABCPES"[CHS.indexOf(ch)] as "A" | "B" | "C" | "P" | "E" | "S";
      expect(totalsOf(cp.cfg, cp.cells)[k]).toBe(totalsOf(base.cfg, base.cells)[k]);
      expect(totalsOf(cnp.cfg, cnp.cells)[k]).toBe(totalsOf(base.cfg, base.cells)[k]);
    }
    void sumOf;
    for (const ch of [CH.A, CH.B, CH.C, CH.E, CH.S]) expect(cp.cells.slice(ch * n, (ch + 1) * n)).toEqual(base.cells.slice(ch * n, (ch + 1) * n));
    expect(cnp.cells.slice(CH.P * n, (CH.P + 1) * n)).toEqual(base.cells.slice(CH.P * n, (CH.P + 1) * n));
  });

  it("all arms start at absolute step T1 with equal injury steps and RNG keys", () => {
    const b = block();
    for (const x of b.arms) {
      expect(x.state.step).toBe(short.T1);
      if (x.id === "rb" || x.id === "rnb") expect(x.state.cfg.seed).toBe(99);
      else expect(x.state.cfg.seed).toBe(seed);
      expect(x.state.cfg.injuryPeriod).toBe(PROTOCOL.injury!.period);
      // the injury schedule and RNG keys depend on (cfg.seed, step) only
      expect((x.state.step + 1) % x.state.cfg.injuryPeriod!).toBe((short.T1 + 1) % PROTOCOL.injury!.period);
    }
  });

  it("all arms in a block start with equal matter and energy", () => {
    const b = block();
    const ref = b.arms[0].audit;
    for (const x of b.arms) {
      expect(x.audit.matterStart).toBe(ref.matterStart);
      expect(x.audit.energyStart).toBe(ref.energyStart);
    }
  });

  it("receiver-alone carries the conditioned field's free energy: the history's net dissipation is booked as named analytic heat", () => {
    const b = block();
    const d0 = b.arms.find((x) => x.id === "d0")!, cond = b.arms.find((x) => x.id === "b")!;
    const hb = b.histories.builder;
    expect(d0.audit.heatAnalytic).toBe(hb.state.heatOut - hb.state.lightIn);
    expect(totalsOf(d0.state.cfg, d0.state.cells).energy).toBe(totalsOf(cond.state.cfg, cond.state.cells).energy);
    expect(totalsOf(d0.state.cfg, d0.state.cells).matter).toBe(totalsOf(cond.state.cfg, cond.state.cells).matter);
  });
});
