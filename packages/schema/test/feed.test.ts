// Feeding (packages/schema/src/feed.ts): a logged intervention that changes the world's total matter.
import { describe, expect, it } from "vitest";
import {
  CH,
  FEED_MAX,
  M3_FOUNDERS,
  MATTER_MAX,
  applyFeed,
  buildWorld,
  cellCount,
  cloneState,
  defaultConfig,
  fedMatter,
  feedError,
  founderGenome,
  ledgerResidual,
  stateHash,
  totalsOf,
  validateState,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { RefSim, applyLesion } from "@bl/sim-ref";

const W = 24;
const cfg0 = defaultConfig({ tileW: W, tileH: W, kernelRadius: 3, seed: 5 });
function world(cfg: WorldConfig = cfg0, nutrient = 32): WorldState {
  return buildWorld(cfg, {
    nutrient,
    founders: [0, 1].map((f, k) => ({ x: 6 + 12 * k, y: 6 + 12 * k, radius: 4, genome: founderGenome(M3_FOUNDERS[f]), biomass: 200, energy: 400 })),
  });
}
const A = (s: WorldState, x: number, y: number) => s.cells[CH.A * cellCount(s.cfg) + y * (s.cfg.tileW * s.cfg.tilesX) + x];

describe("applyFeed", () => {
  it("adds the amount to every cell of the disc and to nothing else, and reports exactly what it added", () => {
    const s = world();
    const before = cloneState(s);
    const t0 = totalsOf(s.cfg, s.cells);
    const res = applyFeed(s, 12, 12, 3, 16);
    expect(res).toEqual({ radius: 3, cells: 29, matter: 16 * 29, energy: BigInt(16 * 29) * BigInt(s.cfg.eA) });
    const t1 = totalsOf(s.cfg, s.cells);
    expect(t1.A - t0.A).toBe(BigInt(16 * 29));
    expect(t1.matter - t0.matter).toBe(BigInt(res.matter));
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) expect(A(s, x, y) - A(before, x, y)).toBe((x - 12) ** 2 + (y - 12) ** 2 <= 9 ? 16 : 0);
    // Only the nutrient channel changed.
    const n = cellCount(s.cfg);
    expect(Array.from(s.cells.subarray(n))).toEqual(Array.from(before.cells.subarray(n)));
    expect(Array.from(s.genome)).toEqual(Array.from(before.genome));
    expect([s.step, s.lightIn, s.heatOut]).toEqual([before.step, before.lightIn, before.heatOut]);
    expect(validateState(s)).toEqual([]);
  });

  it("covers exactly a lesion's disc, wrapping inside the centre's tile and never into the next", () => {
    const two = defaultConfig({ tileW: W, tileH: W, tilesX: 2, kernelRadius: 3, seed: 5 });
    const s = world(two), l = world(two);
    const n = cellCount(two);
    // Give every cell bound matter, so the lesion marks its whole disc by clearing it.
    l.cells.fill(7, CH.B * n, (CH.B + 1) * n);
    const lsim = new RefSim(l);
    applyLesion(lsim, 22, 1, 5);
    const before = cloneState(s);
    const res = applyFeed(s, 22, 1, 5, 3);
    let fed = 0;
    for (let i = 0; i < n; i++) {
      const got = s.cells[CH.A * n + i] - before.cells[CH.A * n + i];
      expect(got).toBe(lsim.state.cells[CH.B * n + i] === 0 ? 3 : 0);
      if (got) fed++;
    }
    expect(fed).toBe(res.cells);
    // The disc reaches x = 3 by wrapping in the left tile (0..23); the right tile (24..47) is untouched.
    expect(A(s, 2, 1) - A(before, 2, 1)).toBe(3);
    expect(A(s, 25, 1) - A(before, 25, 1)).toBe(0);
    // The radius is clamped as a lesion's is.
    expect(applyFeed(world(two), 5, 5, 99, 1).radius).toBe(11);
  });

  it("drains up to the amount, stops at zero, and reports exactly what it removed", () => {
    const s = world(cfg0, 10);
    const n = cellCount(s.cfg);
    s.cells[CH.A * n + 12 * W + 12] = 3; // one cell holds less than the drain asks for
    const t0 = totalsOf(s.cfg, s.cells);
    const res = applyFeed(s, 12, 12, 2, -8);
    expect(res.cells).toBe(13);
    expect(res.matter).toBe(-(12 * 8 + 3));
    expect(A(s, 12, 12)).toBe(0);
    expect(A(s, 13, 12)).toBe(2);
    expect(totalsOf(s.cfg, s.cells).matter - t0.matter).toBe(BigInt(res.matter));
    // Draining an empty disc moves nothing.
    const again = applyFeed(s, 12, 12, 0, -FEED_MAX);
    expect(again.matter).toBe(0);
    expect(A(s, 12, 12)).toBe(0);
  });

  it("refuses bad amounts, pond worlds and a feed past MATTER_MAX, changing nothing", () => {
    for (const bad of [0, 1.5, FEED_MAX + 1, -FEED_MAX - 1, NaN]) expect(feedError(cfg0, bad, 3)).toMatch(/non-zero integer/);
    expect(feedError(cfg0, FEED_MAX, 3)).toBeNull();
    expect(feedError(cfg0, -1, 0)).toBeNull();
    expect(feedError({ ...cfg0, pondPeriod: 1000 } as WorldConfig, 4, 3)).toMatch(/pond worlds/);
    // A radius that is not a number would be logged as null and replay as radius 0: refused instead.
    for (const r of [NaN, Infinity, -Infinity]) {
      expect(feedError(cfg0, 4, r)).toMatch(/finite/);
      const t = world(), h = stateHash(t);
      expect(() => applyFeed(t, 12, 12, r, 4)).toThrow(/finite/);
      expect(stateHash(t)).toBe(h);
    }
    const s = world();
    const n = cellCount(s.cfg);
    // Bring the world to within 100 quanta of the bound.
    s.cells[CH.A * n] += MATTER_MAX - Number(totalsOf(s.cfg, s.cells).matter) - 100;
    const hash = stateHash(s);
    expect(() => applyFeed(s, 12, 12, 3, 4)).toThrow(/MATTER_MAX/); // 29 cells x 4 = 116 > 100
    expect(stateHash(s)).toBe(hash);
    expect(applyFeed(s, 12, 12, 3, 3).matter).toBe(87);
    expect(validateState(s)).toEqual([]);
    expect(() => applyFeed(s, 99, 12, 3, 1)).toThrow(/outside the world/);
  });

  it("keeps the ledger exact once the baselines move by what the feed reports, through further steps", () => {
    // eA > 0, so fed nutrient carries chemical energy and the energy baseline must move too.
    const cfg = defaultConfig({ tileW: W, tileH: W, kernelRadius: 3, seed: 5, eA: 2, eC: 3, mutRate: 20_000_000 });
    const sim = new RefSim(world(cfg));
    const start = totalsOf(cfg, sim.state.cells);
    let matter = start.matter, energy = start.energy;
    const log: { kind: string; matter?: number }[] = [];
    const check = () => {
      expect(totalsOf(cfg, sim.state.cells).matter).toBe(matter);
      expect(ledgerResidual({ energy }, sim.state)).toBe(0n);
    };
    sim.run(40);
    check();
    for (const [x, y, r, amount] of [[12, 12, 4, 20], [6, 6, 3, -6], [18, 18, 5, 64], [12, 12, 6, -40]] as const) {
      const res = applyFeed(sim.state, x, y, r, amount);
      matter += BigInt(res.matter);
      energy += res.energy;
      expect(res.energy).toBe(BigInt(res.matter) * 2n);
      log.push({ kind: "feed", matter: res.matter });
      check();
      sim.run(60);
      check();
    }
    // The log alone accounts for the whole change in matter since the start.
    log.push({ kind: "lesion" });
    expect(BigInt(fedMatter(log))).toBe(matter - start.matter);
    expect(fedMatter(log)).not.toBe(0);
  }, 60_000);
});
