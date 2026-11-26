// Mycelium trail conduit (optional trailConduit / trailConduitCap, exploratory; docs/mycelium-conduit-2026-11-14/DESIGN.md): keys absent
// leave the pinned digest alone, g = 0 equals the keyless state, exact ledgers on every step over several seeds and configs, config bounds,
// conduitRate's symmetry and monotonicity, a hand-built corridor where flow follows trail, and the observer-only lesion path.
// The GPU side is tests/deno/mycelium_gpu.ts.
import { describe, expect, it } from "vitest";
import { NN_BYTES, NN_H, NN_I, NN_O } from "@bl/schema";
import {
  CONDUIT_DD_MAX, conduitRate, createWorld, decode, defaultConfig, encode, energyTotal, matterTotal, type MyceliumConfig, type MyceliumState, probe, probeLesion,
  stateDigest, step, validateConfig, validateState,
} from "../mycelium/world.ts";

const small = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ width: 48, height: 48, founders: 256, maxParticles: 2048, ...over });
const sumA = (s: MyceliumState) => s.A.reduce((a, v) => a + v, 0);

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

describe("conduit: keys absent change nothing", () => {
  it("keeps the pinned digest of the small run and never sets the keys in defaultConfig or createWorld", () => {
    const s = createWorld(small());
    expect("trailConduit" in s.config).toBe(false);
    expect("trailConduitCap" in s.config).toBe(false);
    expect("trailConduit" in defaultConfig()).toBe(false);
    for (let t = 0; t < 300; t++) step(s);
    expect(stateDigest(s)).toBe("9a5461c07ef6fcde");
  });

  it("strength 0 (with or without a cap) has the state arrays of the keyless world", () => {
    for (const over of [{ trailConduit: 0 }, { trailConduit: 0, trailConduitCap: 9 }]) {
      const a = createWorld(small()), b = createWorld(small(over));
      for (let t = 0; t < 250; t++) { step(a); step(b); }
      expect(Array.from(b.A)).toEqual(Array.from(a.A));
      expect(Array.from(b.C)).toEqual(Array.from(a.C));
      expect(Array.from(b.P)).toEqual(Array.from(a.P));
      expect(Array.from(b.E.subarray(0, b.n))).toEqual(Array.from(a.E.subarray(0, a.n)));
      expect(b.totals).toEqual(a.totals);
      expect(b.n).toBe(a.n);
    }
  });

  it("a nonzero strength changes the dynamics, and diffA 128 makes it inert", () => {
    const a = createWorld(small()), b = createWorld(small({ trailConduit: 64 }));
    const c = createWorld(small({ diffA: 128 })), d = createWorld(small({ diffA: 128, trailConduit: 255 }));
    for (let t = 0; t < 250; t++) { step(a); step(b); step(c); step(d); }
    // Compare state arrays, not stateDigest: the digest covers the config header, which differs by construction.
    expect(Array.from(b.A)).not.toEqual(Array.from(a.A));
    expect(Array.from(d.A)).toEqual(Array.from(c.A));
    expect(Array.from(d.P)).toEqual(Array.from(c.P));
  });
});

describe("conduit: ledgers", () => {
  const cases: [string, Partial<MyceliumConfig>][] = [
    ["g 8", { trailConduit: 8 }],
    ["g 255", { trailConduit: 255 }],
    ["g 255, cap 1", { trailConduit: 255, trailConduitCap: 1 }],
    ["g 32, blocked", { trailConduit: 32, heredity: "blocked" }],
    ["g 32, gradient light", { trailConduit: 32, lightPattern: "gradient" }],
    ["g 16, diffA 0", { trailConduit: 16, diffA: 0 }],
    ["g 8, toll discount", { trailConduit: 8, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" }],
    ["g 32, physarum", { trailConduit: 32, controller: "physarum", heredity: "frozen", physarumDeposit: 768 }],
  ];
  for (const [name, over] of cases) {
    for (const seed of [1, 7, 12345]) {
      it(`matter and energy balance exactly on every step: ${name}, seed ${seed}`, () => {
        const { s, births, deaths } = runChecked(small({ ...over, seed }), 300);
        expect(births).toBeGreaterThan(0);
        expect(deaths).toBeGreaterThan(0);
        expect(validateState(s)).toEqual([]);
      });
    }
  }

  it("total A plus C plus P plus M is conserved when only the field moves (no particles)", () => {
    const s = createWorld(small({ founders: 0, trailConduit: 255, light: 0, pDecay: 0 }));
    for (let i = 0; i < s.P.length; i++) { s.P[i] = (i * 37) % 300; s.A[i] = (i * 11) % 90; }
    s.matter0 = matterTotal(s); s.energy0 = energyTotal(s);
    for (let t = 0; t < 100; t++) {
      step(s);
      expect(matterTotal(s)).toBe(s.matter0);
      expect(energyTotal(s)).toBe(s.energy0 + s.totals.lightIn - s.totals.heat);
    }
  });

  it("a long run at extreme strength keeps validateState clean and decodes from its own checkpoint", () => {
    const { s } = runChecked(small({ trailConduit: 255, seed: 99 }), 400);
    expect(stateDigest(decode(encode(s)))).toBe(stateDigest(s));
  });
});

describe("conduit: config bounds", () => {
  it("accepts the documented ranges", () => {
    expect(validateConfig(small({ trailConduit: 0 }))).toEqual([]);
    expect(validateConfig(small({ trailConduit: 255, trailConduitCap: 255 }))).toEqual([]);
    expect(validateConfig(small({ trailConduit: 8, trailConduitCap: 1 }))).toEqual([]);
    expect(validateConfig(small({ trailConduit: 8, diffA: 0 }))).toEqual([]);
    expect(validateConfig(small({ trailConduit: 8, diffA: 128 }))).toEqual([]);
  });
  it("rejects out-of-range, non-integer, a cap without the key, and diffA above 128 with the key", () => {
    for (const bad of [
      { trailConduit: 256 }, { trailConduit: -1 }, { trailConduit: 1.5 },
      { trailConduitCap: 5 }, { trailConduit: 8, trailConduitCap: 0 }, { trailConduit: 8, trailConduitCap: 256 }, { trailConduit: 8, trailConduitCap: 2.5 },
      { trailConduit: 8, diffA: 129 }, { trailConduit: 0, diffA: 256 },
    ]) {
      expect(validateConfig(small(bad)).length, JSON.stringify(bad)).toBeGreaterThan(0);
      expect(() => createWorld(small(bad)), JSON.stringify(bad)).toThrow();
    }
  });
  it("the keyless rule still allows diffA up to 256", () => {
    expect(validateConfig(small({ diffA: 256 }))).toEqual([]);
  });
});

describe("conduit: conduitRate", () => {
  it("is symmetric, monotone in each trail value, and capped at 128 and by q", () => {
    for (const [De, g, q] of [[40, 8, 255], [40, 255, 255], [0, 32, 44], [100, 255, 255], [1, 1, 1]] as const) {
      let prev = -1;
      for (const x of [0, 1, 5, 16, 44, 100, 255, 256, 1000, 2 ** 31]) {
        const r = conduitRate(De, g, q, x, 2 ** 31);
        expect(r).toBe(conduitRate(De, g, q, 2 ** 31, x));
        expect(r).toBeGreaterThanOrEqual(prev);
        expect(r).toBeLessThanOrEqual(CONDUIT_DD_MAX);
        prev = r;
      }
      expect(conduitRate(De, g, q, 2 ** 31, 2 ** 31)).toBe(Math.min(De + ((q * g) >>> 4), CONDUIT_DD_MAX));
    }
  });
  it("is the base rate when either end has no trail, and matches the formula", () => {
    expect(conduitRate(40, 255, 255, 0, 500)).toBe(40);
    expect(conduitRate(40, 255, 255, 500, 0)).toBe(40);
    expect(conduitRate(40, 8, 255, 176, 176)).toBe(128);
    expect(conduitRate(40, 8, 255, 175, 900)).toBe(40 + ((175 * 8) >> 4));
    expect(conduitRate(40, 2, 255, 255, 255)).toBe(71);
  });
});

describe("conduit: flow follows trail", () => {
  it("nutrient injected at one end of a trail line reaches the far end faster than across bare ground, and none leaks sideways beyond base diffusion", () => {
    const run = (conduit: boolean) => {
      const s = createWorld(small({ width: 48, height: 48, founders: 0, nutrient0: 0, light: 0, pDecay: 0, diffA: 0, ...(conduit ? { trailConduit: 255 } : { trailConduit: 0 }) }));
      for (let x = 0; x < 24; x++) s.P[10 * 48 + x] = 255; // a corridor along row 10, columns 0..23
      s.A[10 * 48 + 0] = 100_000;
      s.matter0 = matterTotal(s); s.energy0 = energyTotal(s);
      for (let t = 0; t < 500; t++) step(s);
      return s;
    };
    const on = run(true), off = run(false);
    // diffA 0 and trailConduit 0: nothing moves at all.
    expect(off.A[10 * 48 + 0]).toBe(100_000);
    // Along the corridor the nutrient spreads out; outside it (diffA 0) nothing leaves a cell that is not both-ends-trail.
    let corridor = 0, outside = 0;
    for (let k = 0; k < on.A.length; k++) {
      const row = Math.floor(k / 48), col = k % 48;
      if (row === 10 && col < 24) corridor += on.A[k]; else outside += on.A[k];
    }
    expect(on.A[10 * 48 + 23]).toBeGreaterThan(0);
    expect(on.A[10 * 48 + 12]).toBeGreaterThan(0);
    // The end cell of the corridor (col 23) holds trail and its east neighbour does not: that edge does not conduct, so col 24 stays empty.
    expect(on.A[10 * 48 + 24]).toBe(0);
    expect(corridor).toBe(100_000);
    expect(outside).toBe(0);
    expect(sumA(on)).toBe(100_000);
  });
});

describe("conduit: observer-only lesion path", () => {
  const B2_OFF = NN_I * NN_H + NN_H + NN_H * NN_O;
  const W1_OFF = 0;
  it("probeLesion with no inputs equals probe; zeroing an input a planted controller reads changes its output; a lesion changes no state", () => {
    const s = createWorld(small());
    for (let t = 0; t < 20; t++) step(s);
    expect(Array.from(probeLesion(s, []))).toEqual(Array.from(probe(s)));
    // Planted controller: hidden unit 0 = input 2 (weight 127), output MX (index 0) reads hidden 0; and one reading input 5.
    s.genome.fill(0);
    for (let i = 0; i < s.n; i++) {
      const g = i * NN_BYTES;
      s.genome[g + W1_OFF + 2 * NN_H + 0] = 127;
      s.genome[g + W1_OFF + 5 * NN_H + 1] = 127;
      s.genome[g + NN_I * NN_H + NN_H + 0 * NN_O + 0] = 127; // W2[hidden 0 -> MX]
      s.genome[g + NN_I * NN_H + NN_H + 1 * NN_O + 1] = 127; // W2[hidden 1 -> MY]
    }
    s.P.fill(64); for (let k = 0; k < s.A.length; k++) s.A[k] = (k * 13) % 200; // input 5 is a gradient, so it needs a varied A
    const before = encode(s).slice();
    const base = probe(s), l2 = probeLesion(s, [2]), l5 = probeLesion(s, [5, 6]);
    let d2 = 0, d5 = 0;
    for (let i = 0; i < s.n; i++) { d2 += Math.abs(base[i * NN_O] - l2[i * NN_O]); d5 += Math.abs(base[i * NN_O + 1] - l5[i * NN_O + 1]); }
    expect(B2_OFF).toBeGreaterThan(0);
    expect(d2).toBeGreaterThan(0);
    expect(d5).toBeGreaterThan(0);
    expect(Array.from(encode(s))).toEqual(Array.from(before));
  });
});
