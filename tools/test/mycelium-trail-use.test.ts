// Mycelium trail use (optional trailMoveDiscount / trailDiscountMode, exploratory; docs/mycelium-trail-use-2026-11-13/DESIGN.md):
// keys absent leave the pinned digest alone, exact ledgers on every step under both modes, config bounds, the formula on a hand-built
// particle, and the start-of-step rule (trail laid this step earns no discount this step). The GPU side is tests/deno/mycelium_gpu.ts.
import { describe, expect, it } from "vitest";
import { NN_BYTES, NN_H, NN_I, NN_O } from "@bl/schema";
import { createWorld, defaultConfig, energyTotal, matterTotal, type MyceliumConfig, type MyceliumState, stateDigest, step, validateConfig, validateState } from "../mycelium/world.ts";

const small = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ width: 48, height: 48, founders: 256, maxParticles: 2048, ...over });
const B2_OFF = NN_I * NN_H + NN_H + NN_H * NN_O;

function setOut(s: MyceliumState, outs: Record<number, number>): void {
  s.genome.fill(0);
  for (let i = 0; i < s.n; i++) for (const [k, v] of Object.entries(outs)) s.genome[i * NN_BYTES + B2_OFF + Number(k)] = v;
}
const reanchor = (s: MyceliumState) => { s.matter0 = matterTotal(s); s.energy0 = energyTotal(s); };

function runChecked(c: MyceliumConfig, steps: number) {
  const s = createWorld(c);
  let births = 0, deaths = 0;
  for (let t = 0; t < steps; t++) {
    const st = step(s);
    births += st.births; deaths += st.deaths;
    expect(matterTotal(s)).toBe(s.matter0);
    expect(energyTotal(s)).toBe(s.energy0 + s.totals.lightIn - s.totals.heat);
  }
  return { s, births, deaths };
}

describe("trail use: keys absent change nothing", () => {
  it("keeps the R0 digest of the small run and never sets the keys in defaultConfig or createWorld", () => {
    const s = createWorld(defaultConfig({ width: 48, height: 48, founders: 256, maxParticles: 2048 }));
    expect("trailMoveDiscount" in s.config).toBe(false);
    expect("trailDiscountMode" in s.config).toBe(false);
    for (let t = 0; t < 300; t++) step(s);
    expect(stateDigest(s)).toBe("9a5461c07ef6fcde");
  });

  it("strength 0 (either mode) has the dynamics of the keyless world", () => {
    for (const over of [{ trailMoveDiscount: 0 }, { trailMoveDiscount: 0, trailDiscountMode: "toll" as const }]) {
      const a = createWorld(small({ moveCost: 12 })), b = createWorld(small({ moveCost: 12, ...over }));
      for (let t = 0; t < 200; t++) { step(a); step(b); }
      expect(Array.from(b.P)).toEqual(Array.from(a.P));
      expect(Array.from(b.E.subarray(0, b.n))).toEqual(Array.from(a.E.subarray(0, a.n)));
      expect(b.totals).toEqual(a.totals);
      expect(b.n).toBe(a.n);
    }
  });
});

describe("trail use: ledgers", () => {
  for (const [name, over] of [
    ["public 32", { trailMoveDiscount: 32 }],
    ["public 256, moveCost 12", { trailMoveDiscount: 256, moveCost: 12 }],
    ["toll 64, moveCost 12", { trailMoveDiscount: 64, trailDiscountMode: "toll" as const, moveCost: 12 }],
    ["toll 256, blocked, moveCost 12", { trailMoveDiscount: 256, trailDiscountMode: "toll" as const, moveCost: 12, heredity: "blocked" as const }],
    ["public 64, physarum", { trailMoveDiscount: 64, moveCost: 12, controller: "physarum" as const, heredity: "frozen" as const }],
  ] as const) {
    it(`matter and energy balance exactly on every step: ${name}`, () => {
      const { s, births, deaths } = runChecked(small(over), 300);
      expect(births).toBeGreaterThan(0);
      expect(deaths).toBeGreaterThan(0);
      expect(validateState(s)).toEqual([]);
    });
  }
});

describe("trail use: config bounds", () => {
  it("accepts 0..256 and the two modes, rejects the rest", () => {
    expect(validateConfig(small({ trailMoveDiscount: 0 }))).toEqual([]);
    expect(validateConfig(small({ trailMoveDiscount: 256, trailDiscountMode: "toll" }))).toEqual([]);
    expect(validateConfig(small({ trailMoveDiscount: 256, trailDiscountMode: "public" }))).toEqual([]);
    for (const bad of [{ trailMoveDiscount: 257 }, { trailMoveDiscount: -1 }, { trailMoveDiscount: 1.5 }, { trailDiscountMode: "toll" as const }, { trailMoveDiscount: 5, trailDiscountMode: "private" as unknown as "toll" }]) {
      expect(validateConfig(small(bad)).length).toBeGreaterThan(0);
      expect(() => createWorld(small(bad))).toThrow();
    }
  });

  it("the largest product stays inside u32: moveCost 4096, full outputs, strength 256", () => {
    const raw = 254 * 4096, f = Math.min(Math.min(2 ** 31, 256) * 256, 256);
    expect(raw * 256).toBeLessThan(2 ** 28 + 1);
    expect(raw * (256 - 0)).toBeLessThan(2 ** 32);
    expect(f).toBe(256);
  });
});

describe("trail use: the formula", () => {
  // One particle, no eating, no deposit, MX = 127: the movement term is (127 * 12) >> 7 = 11 without a discount.
  const one = (over: Partial<MyceliumConfig>, trail: number, outs: Record<number, number> = { 0: 127 }) => {
    const s = createWorld(small({ founders: 1, maxEat: 0, moveCost: 12, upkeep: 6, massUpkeepShift: 16, excreteShift: 16, ...over }));
    setOut(s, outs);
    s.P.fill(trail);
    reanchor(s);
    const h0 = s.totals.heat, e0 = s.E[0];
    step(s);
    return { heat: s.totals.heat - h0, spent: e0 - s.E[0], s };
  };

  it("keyless: the term is raw >> 7", () => {
    expect(one({}, 3).spent).toBe(6 + 11);
  });

  it("public: f = min(min(P, 256) * td, 256); the term is (raw * (256 - f)) >> 15", () => {
    const raw = 127 * 12;
    for (const [td, trail] of [[32, 3], [32, 8], [32, 100], [64, 1], [1, 1_000_000], [256, 1], [100, 0]] as const) {
      const f = Math.min(Math.min(trail, 256) * td, 256);
      const term = (raw * (256 - f)) >>> 15;
      const base = one({}, trail).spent;
      expect(one({ trailMoveDiscount: td }, trail).spent).toBe(base - (11 - term));
    }
  });

  it("the saving is real energy kept by the particle and exactly the heat not booked", () => {
    const a = one({}, 5), b = one({ trailMoveDiscount: 256 }, 5);
    expect(a.heat - b.heat).toBe(11);
    expect(b.spent).toBe(a.spent - 11);
  });

  it("toll: no deposit request, no discount; a deposit request takes it", () => {
    const keyless = one({}, 5).spent;
    expect(one({ trailMoveDiscount: 256, trailDiscountMode: "toll" }, 5).spent).toBe(keyless);
    // maxDeposit 4, DEPOSIT 127 requests 3 units (4 * 127 >> 7), which cost 6 energy
    const withDeposit = one({ trailMoveDiscount: 256, trailDiscountMode: "toll" }, 5, { 0: 127, 3: 127 });
    const keylessDeposit = one({}, 5, { 0: 127, 3: 127 });
    expect(keylessDeposit.spent - withDeposit.spent).toBe(11);
  });

  it("reads START-of-step trail: trail laid this step earns no discount this step", () => {
    // Two worlds, every founder deposits every step onto a field with no trail. Step 1 must be identical with and without the discount.
    const mk = (over: Partial<MyceliumConfig>) => {
      const s = createWorld(small({ founders: 200, width: 8, height: 8, maxParticles: 400, moveCost: 12, ...over }));
      setOut(s, { 0: 80, 1: 50, 2: 0, 3: 127 });
      reanchor(s);
      return s;
    };
    const a = mk({}), b = mk({ trailMoveDiscount: 256 });
    step(a); step(b);
    expect(a.P.reduce((x, y) => x + y, 0)).toBeGreaterThan(0);
    expect(Array.from(b.P)).toEqual(Array.from(a.P));
    expect(Array.from(b.E.subarray(0, b.n))).toEqual(Array.from(a.E.subarray(0, a.n)));
    // Step 2 sees that trail, so the energies now differ (the discount is not vacuous).
    step(a); step(b);
    expect(Array.from(b.E.subarray(0, b.n))).not.toEqual(Array.from(a.E.subarray(0, a.n)));
  });
});
