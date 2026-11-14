// Mycelium world R0 (tools/mycelium/world.ts): exact ledgers on every step of runs where births, deaths,
// contended eating, mutations and cap refusals all happen; determinism; byte-equal replay from checkpoints
// at several cut points; the three heredity arms; config bounds; checkpoint validation; one pinned digest.
import { describe, expect, it } from "vitest";
import { cellBase, draw, NN_BYTES } from "@bl/schema";
import { createWorld, decode, defaultConfig, encode, energyTotal, liveGenotypes, matterTotal, type MyceliumConfig, probe, stateDigest, step, validateConfig, validateState } from "../mycelium/world.ts";

const small = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ width: 48, height: 48, founders: 256, maxParticles: 2048, ...over });

function runChecked(c: MyceliumConfig, steps: number) {
  const s = createWorld(c);
  const sum = { births: 0, deaths: 0, refused: 0, contended: 0, mutations: 0 };
  for (let t = 0; t < steps; t++) {
    const st = step(s);
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += st[k];
    expect(matterTotal(s)).toBe(s.matter0);
    expect(energyTotal(s)).toBe(s.energy0 + s.totals.lightIn - s.totals.heat);
  }
  return { s, sum };
}

describe("mycelium R0 ledgers", () => {
  it("conserves matter and books energy exactly on every step, with every event exercised", () => {
    const { s, sum } = runChecked(small(), 400);
    expect(sum.births).toBeGreaterThan(0);
    expect(sum.deaths).toBeGreaterThan(0);
    expect(sum.contended).toBeGreaterThan(0);
    expect(sum.mutations).toBeGreaterThan(0);
    expect(s.totals.lightIn).toBeGreaterThan(0);
    expect(s.n).toBeGreaterThan(0);
    expect(validateState(s)).toEqual([]);
  });

  it("refuses births at the cap and still balances", () => {
    const { s, sum } = runChecked(small({ maxParticles: 300 }), 200);
    expect(sum.refused).toBeGreaterThan(0);
    expect(s.n).toBeLessThanOrEqual(300);
  });

  it("balances under the gradient light and with trail decay off", () => {
    runChecked(small({ lightPattern: "gradient", pDecay: 0, diffC: 0 }), 150);
  });

  it("gradient light reaches every part of the world in proportion, not only the east edge", () => {
    const s = createWorld(small({ founders: 0, lightPattern: "gradient", diffA: 0, diffC: 0 }));
    s.C.fill(100);
    s.matter0 = matterTotal(s); s.energy0 = energyTotal(s);
    for (let t = 0; t < 20; t++) step(s);
    const W = s.config.width, H = s.config.height;
    const gained = (x0: number, x1: number) => { let g = 0; for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) g += s.A[y * W + x] - s.config.nutrient0; return g; };
    const west = gained(0, W / 2), east = gained(W / 2, W);
    expect(west).toBeGreaterThan(0);
    expect(east).toBeGreaterThan(2 * west);
    expect(validateState(s)).toEqual([]);
  });

  it("diffusion moves single units: a lone unit spreads instead of sticking", () => {
    const s = createWorld(small({ founders: 0, nutrient0: 0, light: 0 }));
    s.A[s.config.width * 10 + 10] = 3;
    s.matter0 = matterTotal(s); s.energy0 = energyTotal(s);
    for (let t = 0; t < 30; t++) step(s);
    expect(s.A[s.config.width * 10 + 10]).toBeLessThan(3);
    expect(matterTotal(s)).toBe(3);
  });
});

describe("mycelium R0 determinism and replay", () => {
  it("two runs of one config end in the same digest", () => {
    const a = createWorld(small()), b = createWorld(small());
    for (let t = 0; t < 120; t++) { step(a); step(b); }
    expect(stateDigest(a)).toBe(stateDigest(b));
    const c = createWorld(small({ seed: 2 }));
    for (let t = 0; t < 120; t++) step(c);
    expect(stateDigest(c)).not.toBe(stateDigest(a));
  });

  it("a run resumed from a checkpoint equals the continuous run byte for byte at every cut", () => {
    const end = 240;
    const cont = createWorld(small());
    for (let t = 0; t < end; t++) step(cont);
    const want = encode(cont);
    for (const cut of [0, 1, 97, 211]) {
      const s = createWorld(small());
      for (let t = 0; t < cut; t++) step(s);
      const resumed = decode(encode(s));
      for (let t = cut; t < end; t++) step(resumed);
      expect(resumed.step).toBe(end);
      expect(Buffer.from(encode(resumed)).equals(Buffer.from(want))).toBe(true);
    }
  });

  it("pins the R0 digest of a small run", () => {
    const s = createWorld(small());
    for (let t = 0; t < 300; t++) step(s);
    expect(stateDigest(s)).toBe("9a5461c07ef6fcde");
  });
});

describe("mycelium R0 heredity arms", () => {
  it("frozen children copy the parent exactly: no mutations and no new genotypes", () => {
    const { s, sum } = runChecked(small({ heredity: "frozen" }), 200);
    expect(sum.births).toBeGreaterThan(0);
    expect(sum.mutations).toBe(0);
    expect(s.nextGid).toBe(s.config.founders);
    expect(liveGenotypes(s)).toBeLessThanOrEqual(s.config.founders);
  });

  it("blocked children get fresh controllers: every birth is a new genotype", () => {
    const { s } = runChecked(small({ heredity: "blocked" }), 200);
    expect(s.totals.births).toBeGreaterThan(0);
    expect(s.nextGid - s.config.founders).toBe(s.totals.births);
  });

  it("inherit children differ from the parent only when the birth mutated", () => {
    const { s } = runChecked(small(), 200);
    expect(s.nextGid - s.config.founders).toBe(s.totals.mutations);
    expect(s.totals.mutations).toBeLessThan(s.totals.births);
    // Genotype id identifies weights: two live particles with one id carry identical weights.
    const byGid = new Map<number, string>();
    for (let i = 0; i < s.n; i++) {
      const w = Array.from(s.genome.subarray(i * NN_BYTES, (i + 1) * NN_BYTES)).join(",");
      const seen = byGid.get(s.gid[i]);
      if (seen !== undefined) expect(w).toBe(seen);
      else byGid.set(s.gid[i], w);
    }
  });
});

describe("mycelium R0 bounds and validation", () => {
  it("rejects configs outside the arithmetic bounds", () => {
    expect(validateConfig(defaultConfig())).toEqual([]);
    expect(validateConfig(defaultConfig({ maxParticles: 1 << 17 })).join()).toMatch(/maxParticles/);
    expect(validateConfig(defaultConfig({ eA: 0 })).join()).toMatch(/eA/);
    expect(validateConfig(defaultConfig({ width: 512, height: 512, nutrient0: 1 << 14 })).join()).toMatch(/2\^31/);
    expect(validateConfig(defaultConfig({ heredity: "lamarck" as never })).join()).toMatch(/heredity/);
    expect(() => createWorld(defaultConfig({ speed: 300 }))).toThrow(/speed/);
  });

  it("refuses a checkpoint whose matter was tampered with", () => {
    const s = createWorld(small());
    for (let t = 0; t < 20; t++) step(s);
    s.A[5] += 1;
    expect(() => decode(encode(s))).toThrow(/matter residual 1/);
  });
});

describe("mycelium R0 review regressions (Sol, 13 Nov 2026)", () => {
  it("a mutation that changes no weight keeps the parent's genotype and is not counted", () => {
    const { s } = runChecked(small({ mutRate: 65536, mutCount: 0 }), 120);
    expect(s.totals.births).toBeGreaterThan(0);
    expect(s.totals.mutations).toBe(0);
    expect(s.nextGid).toBe(s.config.founders);
  });

  it("refuses births instead of wrapping particle or genotype ids", () => {
    const s = createWorld(small());
    for (let t = 0; t < 40; t++) step(s);
    s.nextId = 0xfffffffe;
    for (let i = 0; i < s.n; i++) s.id[i] = 0xfffffff0 - s.n + i;
    let refused = 0, births = 0;
    for (let t = 0; t < 60; t++) { const st = step(s); refused += st.refused; births += st.births; }
    expect(births).toBeLessThanOrEqual(1);
    expect(refused).toBeGreaterThan(0);
    for (let i = 1; i < s.n; i++) expect(s.id[i]).toBeGreaterThan(s.id[i - 1]);
    expect(s.nextId).toBeLessThanOrEqual(0xffffffff);
  });

  it("rejects checkpoints whose ledger counters are past the exact-arithmetic bound", () => {
    const s = createWorld(small());
    s.totals.lightIn = 2 ** 51; s.totals.heat = 2 ** 51;
    expect(() => decode(encode(s))).toThrow(/lightIn must be an integer/);
  });
});

describe("mycelium R2 physarum null and probe (docs/mycelium-r2-2026-11-13/PROTOCOL.md)", () => {
  const phys = (over: Partial<MyceliumConfig> = {}) => small({ controller: "physarum", heredity: "frozen", ...over });

  it("leaves defaultConfig and every existing encoding alone", () => {
    expect("controller" in defaultConfig()).toBe(false);
    expect("controller" in createWorld(small()).config).toBe(false);
    const bytes = encode(createWorld(small()));
    const headerLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
    expect(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))).not.toMatch(/controller/);
  });

  it("validates the key: neural or physarum, and physarum only with frozen heredity", () => {
    expect(validateConfig(phys())).toEqual([]);
    expect(validateConfig(small({ controller: "neural" }))).toEqual([]);
    expect(validateConfig(small({ controller: "physarum" })).join()).toMatch(/requires heredity frozen/);
    expect(validateConfig(small({ controller: "physarum", heredity: "blocked" })).join()).toMatch(/requires heredity frozen/);
    expect(validateConfig(small({ controller: "slime" as never })).join()).toMatch(/controller/);
  });

  it("conserves matter and books energy exactly on every step, with births, deaths and no mutation", () => {
    const { s, sum } = runChecked(phys(), 300);
    expect(sum.births).toBeGreaterThan(0);
    expect(sum.deaths).toBeGreaterThan(0);
    expect(sum.mutations).toBe(0);
    expect(s.nextGid).toBe(s.config.founders);
    expect(validateState(s)).toEqual([]);
  });

  it("is deterministic and replays byte for byte from a checkpoint", () => {
    const end = 200;
    const a = createWorld(phys()), b = createWorld(phys());
    for (let t = 0; t < end; t++) { step(a); step(b); }
    expect(stateDigest(a)).toBe(stateDigest(b));
    const other = createWorld(phys({ seed: 2 }));
    for (let t = 0; t < end; t++) step(other);
    expect(stateDigest(other)).not.toBe(stateDigest(a));
    for (const cut of [0, 1, 83]) {
      const s = createWorld(phys());
      for (let t = 0; t < cut; t++) step(s);
      const resumed = decode(encode(s));
      expect(resumed.config.controller).toBe("physarum");
      for (let t = cut; t < end; t++) step(resumed);
      expect(Buffer.from(encode(resumed)).equals(Buffer.from(encode(a)))).toBe(true);
    }
  });

  it("differs from the frozen neural arm (the rule really is replaced) and ignores the genome", () => {
    const a = createWorld(phys()), b = createWorld(small({ heredity: "frozen" }));
    for (let t = 0; t < 60; t++) { step(a); step(b); }
    expect(stateDigest(a)).not.toBe(stateDigest(b));
    const c = createWorld(phys()), d = createWorld(phys());
    d.genome.fill(0);
    for (let t = 0; t < 60; t++) { step(c); step(d); }
    expect(Array.from(c.x.subarray(0, c.n))).toEqual(Array.from(d.x.subarray(0, d.n)));
    expect(Array.from(c.M.subarray(0, c.n))).toEqual(Array.from(d.M.subarray(0, d.n)));
  });

  it("follows the rule: fixed EAT, DEPOSIT and SPLIT, up the trail gradient at half speed, a wander without trail", () => {
    const s = createWorld(phys({ founders: 2, nutrient0: 8 }));
    const W = s.config.width;
    // Particle 0 in cell (10, 10): east neighbour trail 100, west 40, so gx = 60 and gy = 0.
    s.x[0] = (10 << 8) + 5; s.y[0] = (10 << 8) + 5;
    s.P[10 * W + 11] = 100; s.P[10 * W + 9] = 40;
    s.matter0 = matterTotal(s);
    const o = probe(s);
    const NN_O = 8;
    // The particle streams of RULES.md: seed XOR "myc1", this step, the particle id; slots 60-63.
    const pb = (id: number) => cellBase((s.config.seed ^ 0x6d796331) >>> 0, s.step, id);
    const clamp = (v: number) => Math.max(-127, Math.min(127, v));
    for (const k of [0, 1]) expect([o[k * NN_O + 2], o[k * NN_O + 3], o[k * NN_O + 4], o[k * NN_O + 5], o[k * NN_O + 6], o[k * NN_O + 7]]).toEqual([127, 32, 127, 0, 0, 0]);
    // Particle 0, m = 60: bx = trunc(60 * 64 / 60) = 64, by = 0, then the turn from slots 60 and 61.
    expect(o[0]).toBe(clamp(64 + (draw(pb(0), 60) % 33) - 16));
    expect(o[1]).toBe(clamp(0 + (draw(pb(0), 61) % 33) - 16));
    // Particle 1 stands on bare ground (no trail around it): the wander from slots 62 and 63, then the turn.
    expect(o[NN_O]).toBe(clamp((draw(pb(1), 62) % 129) - 64 + (draw(pb(1), 60) % 33) - 16));
    expect(o[NN_O + 1]).toBe(clamp((draw(pb(1), 63) % 129) - 64 + (draw(pb(1), 61) % 33) - 16));
  });

  it("scales the gradient by its larger component and truncates toward zero", () => {
    const s = createWorld(phys({ founders: 1, nutrient0: 8 }));
    const W = s.config.width;
    s.x[0] = (20 << 8) + 1; s.y[0] = (20 << 8) + 1;
    // gx = 30 - 90 = -60 (west is stronger), gy = P(south) - P(north) = 50 - 20 = 30, m = 60: bx = -64, by = trunc(30 * 64 / 60) = 32.
    s.P[20 * W + 21] = 30; s.P[20 * W + 19] = 90; s.P[21 * W + 20] = 50; s.P[19 * W + 20] = 20;
    const o = probe(s);
    const pb = cellBase((s.config.seed ^ 0x6d796331) >>> 0, s.step, 0);
    expect(o[0]).toBe(-64 + (draw(pb, 60) % 33) - 16);
    expect(o[1]).toBe(32 + (draw(pb, 61) % 33) - 16);
  });

  it("probe changes nothing and agrees with what step acts on", () => {
    const s = createWorld(small());
    for (let t = 0; t < 30; t++) step(s);
    const before = stateDigest(s);
    const o1 = probe(s), o2 = probe(s);
    expect(stateDigest(s)).toBe(before);
    expect(Array.from(o1)).toEqual(Array.from(o2));
    expect(o1.length).toBe(s.n * 8);
  });
});
