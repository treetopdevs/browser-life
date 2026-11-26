// Mycelium in a volume R0 (tools/mycelium3d/world.ts): exact ledgers on every step with and without sinking,
// the toll, the conduits and waste shading; determinism; byte-equal replay from checkpoints; the lift of 2D genomes; sinking;
// shading; config and checkpoint validation; bonds (forming, moving together, breaking, upkeep, children, validation).
import { describe, expect, it } from "vitest";
import { cellBase, draw, mulFrac, NN_BYTES, NN_H, NN_I, NN_O } from "@bl/schema";
import { controllerForward, diffOut6 } from "@bl/sim-ref";
import {
  B2_OFF3, BOND_NONE, type BondStats, censusByDepth, controllerForward13, createWorld, decode, defaultConfig, encode, energyTotal, liftMyceliumGenome, lightPlane, matterTotal,
  LEDGER_MAX, type Mycelium3dConfig, NN_BYTES3, STEP_MAX, NN_H3, NN_I3, NN_O3, NN_WEIGHTS3, OUT, POS_SHIFT, probe, stateDigest, step, validateConfig, validateState,
} from "../mycelium3d/world.ts";

const small = (over: Partial<Mycelium3dConfig> = {}) => defaultConfig({ width: 16, height: 16, depth: 8, founders: 256, maxParticles: 2048, ...over });
const mid = (over: Partial<Mycelium3dConfig> = {}) => defaultConfig({ width: 32, height: 32, depth: 16, ...over });
/** Long ledger runs take minutes on a loaded machine; the config default is 60 s. */
const LONG = 900_000;

function runChecked(c: Mycelium3dConfig, steps: number) {
  const s = createWorld(c);
  const sum = { births: 0, deaths: 0, refused: 0, contended: 0, mutations: 0 };
  for (let t = 0; t < steps; t++) {
    const st = step(s);
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += st[k];
    // Plain comparisons, not expect, so thousands of steps stay fast; the first failure is reported with its step.
    const dm = matterTotal(s) - s.matter0, de = energyTotal(s) - (s.energy0 + s.totals.lightIn - s.totals.heat);
    if (dm !== 0 || de !== 0) throw new Error(`step ${s.step}: matter residual ${dm}, energy residual ${de}`);
  }
  expect(validateState(s)).toEqual([]);
  return { s, sum };
}

const LEVERS: [string, Partial<Mycelium3dConfig>][] = [
  ["no keys", {}],
  ["sinking", { sinkShift: 5 }],
  ["toll", { trailMoveDiscount: 64, trailDiscountMode: "toll" }],
  ["conduit", { trailConduit: 16, trailConduitCap: 64 }],
  ["sinking + toll + conduit", { sinkShift: 5, trailMoveDiscount: 64, trailDiscountMode: "toll", trailConduit: 16 }],
  ["owner gate + owner conduit + sinking", { sinkShift: 4, trailOwner: "gid", ownerDefend: 4, ownerConduit: 16 }],
  ["conduit ghost + gradient light", { trailConduit: 16, trailConduitGhost: 5, lightPattern: "gradient" }],
  ["sinking + waste shading", { sinkShift: 5, wasteShade: 1 }],
  ["waste shading 0 + sinking + owner gate + owner conduit", { wasteShade: 0, sinkShift: 6, trailOwner: "id", ownerDefend: 1, ownerConduit: 120 }],
  ["bonds, cost 1", { bondBreak: 512, bondCost: 1 }],
  ["bonds + children + sinking + waste shading + toll + owner gate", { bondBreak: 300, bondCost: 2, bondChild: true, sinkShift: 6, wasteShade: 2, trailMoveDiscount: 64, trailDiscountMode: "toll", trailOwner: "gid", ownerDefend: 4 }],
];

describe("mycelium3d R0 ledgers", () => {
  for (const [name, over] of LEVERS) {
    it(`16 x 16 x 8, ${name}: matter and energy residuals are 0 on every one of 3000 steps`, () => {
      const { s, sum } = runChecked(small(over), 3000);
      expect(sum.births).toBeGreaterThan(0);
      expect(sum.deaths).toBeGreaterThan(0);
      expect(s.totals.lightIn).toBeGreaterThan(0);
    }, LONG);
  }

  for (const [name, over] of [["no keys", {}], ["sinking + toll + conduit", LEVERS[4][1]], ["owner gate + owner conduit + sinking", LEVERS[5][1]]] as const) {
    it(`32 x 32 x 16, ${name}: residuals are 0 on every one of 3000 steps, with every event exercised`, () => {
      const { s, sum } = runChecked(mid(over), 3000);
      expect(sum.births).toBeGreaterThan(0);
      expect(sum.deaths).toBeGreaterThan(0);
      expect(sum.contended).toBeGreaterThan(0);
      expect(sum.mutations).toBeGreaterThan(0);
      expect(s.n).toBeGreaterThan(0);
    }, LONG);
  }

  it("D = 1 (one cell is both surface and floor) balances with sinking, the toll, the owner gate and the owner conduit", () => {
    runChecked(small({ depth: 1, sinkShift: 3, trailMoveDiscount: 64, trailDiscountMode: "toll", trailOwner: "id", ownerDefend: 4, ownerConduit: 16 }), 800);
    runChecked(small({ depth: 1, sinkShift: 3, trailConduit: 16 }), 800);
  }, LONG);

  it("the levers act: the toll and both conduits change the nutrient field against the keyless run", () => {
    const A = (over: Partial<Mycelium3dConfig>) => { const s = createWorld(small(over)); for (let t = 0; t < 300; t++) step(s); return Buffer.from(s.A.buffer); };
    const base = A({});
    for (const over of [{ trailMoveDiscount: 256 }, { trailMoveDiscount: 256, trailDiscountMode: "toll" }, { trailConduit: 64 }, { trailOwner: "id", ownerConduit: 64 }] as Partial<Mycelium3dConfig>[]) {
      expect(A(over).equals(base)).toBe(false);
    }
    // The passive owner plane (no gate, no conduit) changes nothing but the labels.
    expect(A({ trailOwner: "gid" }).equals(base)).toBe(true);
  }, LONG);

  it("refuses births at the cap and still balances", () => {
    const { s, sum } = runChecked(small({ maxParticles: 300 }), 300);
    expect(sum.refused).toBeGreaterThan(0);
    expect(s.n).toBeLessThanOrEqual(300);
  });

  it("owner planes keep Q <= P and Z == 0 iff Q == 0 under sinking (validateState on every 100th step)", () => {
    const s = createWorld(small(LEVERS[5][1]));
    let owned = 0;
    for (let t = 0; t < 2000; t++) {
      step(s);
      if (t % 100 === 99) { expect(validateState(s)).toEqual([]); owned += s.Z!.reduce((a, v) => a + (v !== 0 ? 1 : 0), 0); }
    }
    expect(owned).toBeGreaterThan(0);
  }, LONG);
});

describe("mycelium3d R0 determinism and replay", () => {
  it("two runs of one config end in the same digest; another seed differs", () => {
    const a = createWorld(small({ sinkShift: 5 })), b = createWorld(small({ sinkShift: 5 }));
    for (let t = 0; t < 300; t++) { step(a); step(b); }
    expect(stateDigest(a)).toBe(stateDigest(b));
    const c = createWorld(small({ sinkShift: 5, seed: 2 }));
    for (let t = 0; t < 300; t++) step(c);
    expect(stateDigest(c)).not.toBe(stateDigest(a));
  });

  for (const [name, over] of [["no keys", {}], ["sinking + toll + conduit", LEVERS[4][1]], ["owner gate + owner conduit + sinking", LEVERS[5][1]], ["sinking + waste shading", LEVERS[7][1]], ["bonds + children + levers", LEVERS[10][1]]] as const) {
    it(`${name}: a run resumed from a checkpoint equals the continuous run byte for byte at every cut`, () => {
      const end = 400;
      const cont = createWorld(small(over));
      for (let t = 0; t < end; t++) step(cont);
      const want = encode(cont);
      for (const cut of [0, 1, 137, 311]) {
        const s = createWorld(small(over));
        for (let t = 0; t < cut; t++) step(s);
        const resumed = decode(encode(s));
        for (let t = cut; t < end; t++) step(resumed);
        expect(resumed.step).toBe(end);
        expect(Buffer.from(encode(resumed)).equals(Buffer.from(want))).toBe(true);
      }
    }, LONG);
  }
});

/** A random 2D genome (160 bytes) from a simple LCG, so the test does not depend on any world's draws. */
function random2d(seed: number): Int8Array {
  const g = new Int8Array(NN_BYTES);
  let v = seed >>> 0;
  for (let b = 0; b < NN_BYTES; b++) { v = (Math.imul(v, 1664525) + 1013904223) >>> 0; g[b] = ((v >>> 24) % 255) - 127; }
  return g;
}

describe("mycelium3d R0 lift of 2D genomes", () => {
  it("the lifted net's outputs 0..7 equal the 2D net's whatever inputs 10..12 hold, and MZ is 0", () => {
    for (let trial = 0; trial < 200; trial++) {
      const g2 = random2d(trial + 1);
      const g3 = liftMyceliumGenome(g2);
      expect(g3.length).toBe(NN_BYTES3);
      for (let b = NN_WEIGHTS3; b < NN_BYTES3; b++) expect(g3[b]).toBe(0);
      expect(g3[B2_OFF3 + OUT.MZ]).toBe(0);
      const x2 = new Int32Array(NN_I), x3 = new Int32Array(NN_I3);
      for (let i = 0; i < NN_I3; i++) x3[i] = ((trial * 37 + i * 101) % 255) - 127;
      for (let i = 0; i < NN_I; i++) x2[i] = x3[i];
      const h2 = new Int32Array(NN_H), o2 = new Int32Array(NN_O), h3 = new Int32Array(NN_H3), o3 = new Int32Array(NN_O3);
      controllerForward(g2, x2, h2, o2);
      controllerForward13(g3, x3, h3, o3);
      expect(Array.from(o3.subarray(0, NN_O))).toEqual(Array.from(o2));
      expect(o3[OUT.MZ]).toBe(0);
    }
  });

  it("a world of lifted 2D genomes never moves a particle in z (frozen heredity, so no mutation touches the new rows)", () => {
    const s = createWorld(small({ heredity: "frozen" }));
    for (let i = 0; i < s.n; i++) s.genome.set(liftMyceliumGenome(random2d(1000 + i)), i * NN_BYTES3);
    const zOf = new Map<number, number>();
    for (let i = 0; i < s.n; i++) zOf.set(s.id[i], s.z[i]);
    let checked = 0, births = 0;
    for (let t = 0; t < 600; t++) {
      if (t % 100 === 0) { const o = probe(s); for (let i = 0; i < s.n; i++) expect(o[i * NN_O3 + OUT.MZ]).toBe(0); }
      births += step(s).births;
      for (let i = 0; i < s.n; i++) {
        const was = zOf.get(s.id[i]);
        // A survivor keeps its z; a newborn's z (placed within +-128 at birth) is recorded and held from then on.
        if (was === undefined) zOf.set(s.id[i], s.z[i]);
        else { expect(s.z[i]).toBe(was); checked++; }
      }
    }
    const out = probe(s);
    for (let i = 0; i < s.n; i++) expect(out[i * NN_O3 + OUT.MZ]).toBe(0);
    expect(checked).toBeGreaterThan(10000);
    expect(births).toBeGreaterThan(0);
  }, LONG);
});

describe("mycelium3d R0 sinking and light", () => {
  it("sinking moves waste and trail downward and the floor accumulates; no sinking leaves it level", () => {
    const run = (over: Partial<Mycelium3dConfig>) => {
      const s = createWorld(small({ founders: 0, light: 0, diffA: 0, diffC: 0, pDecay: 0, ...over }));
      s.C.fill(64); s.P.fill(64);
      s.matter0 = matterTotal(s); s.energy0 = energyTotal(s);
      for (let t = 0; t < 200; t++) step(s);
      expect(validateState(s)).toEqual([]);
      return censusByDepth(s);
    };
    const sunk = run({ sinkShift: 3 }), level = run({});
    const D = sunk.length;
    expect(sunk[D - 1].C).toBeGreaterThan(sunk[0].C * 10);
    expect(sunk[D - 1].P).toBeGreaterThan(sunk[0].P * 10);
    for (let z = 1; z < D; z++) expect(sunk[z].C + sunk[z].P).toBeGreaterThanOrEqual(sunk[z - 1].C + sunk[z - 1].P);
    const per = 16 * 16 * 64;
    for (const l of level) { expect(l.C).toBe(per); expect(l.P).toBe(per); }
    // Matter is conserved and nothing else changed: A is untouched by sinking.
    for (const l of sunk) expect(l.A).toBe(16 * 16 * 48);
  });

  it("sinking moves matter only: energy is unchanged and lightIn is 0 without light", () => {
    const s = createWorld(small({ founders: 0, light: 0, sinkShift: 2 }));
    s.C.fill(9); s.P.fill(5);
    s.matter0 = matterTotal(s); s.energy0 = energyTotal(s);
    for (let t = 0; t < 100; t++) step(s);
    expect(energyTotal(s)).toBe(s.energy0);
    expect(s.totals.lightIn).toBe(0);
    expect(validateState(s)).toEqual([]);
  });

  it("light at the floor is lower when the top is dense, and empty water is lossless", () => {
    const s = createWorld(small({ founders: 0, lightK: 256 }));
    const clear = lightPlane(s);
    const WH = 16 * 16, D = 8;
    for (let k = 0; k < D * WH; k++) expect(clear[k]).toBe(256);
    for (let k = 0; k < WH; k++) s.P[k] = 256; // dense top layer: T(256) = floor(256 * 256 / 512) = 128
    const shaded = lightPlane(s);
    for (let k = 0; k < WH; k++) expect(shaded[k]).toBe(256);
    for (let k = WH; k < D * WH; k++) expect(shaded[k]).toBe(128);
    // Particle matter shades too.
    const t = createWorld(small({ founders: 1, founderMatter: 255, bodyMax: 255, lightK: 256 }));
    t.z[0] = 0; t.x[0] = 0; t.y[0] = 0;
    const lp = lightPlane(t);
    expect(lp[WH]).toBe(divT(256, 256, 255));
    expect(lp[WH + 1]).toBe(256);
  });

  it("waste shades the cells below only with wasteShade, as C >> wasteShade units, and never itself", () => {
    const WH = 16 * 16, D = 8;
    const plane = (over: Partial<Mycelium3dConfig>) => {
      const s = createWorld(small({ founders: 0, lightK: 256, ...over }));
      for (let k = 0; k < WH; k++) s.C[k] = 256; // waste in the top layer
      return lightPlane(s);
    };
    const off = plane({}), on0 = plane({ wasteShade: 0 }), on1 = plane({ wasteShade: 1 }), on16 = plane({ wasteShade: 16 });
    for (let k = 0; k < WH; k++) { expect(on0[k]).toBe(256); expect(on1[k]).toBe(256); } // the waste does not shade its own cell
    for (let k = WH; k < D * WH; k++) {
      expect(off[k]).toBe(256);
      expect(on0[k]).toBe(divT(256, 256, 256)); // 128
      expect(on1[k]).toBe(divT(256, 256, 128)); // 170
      expect(on16[k]).toBe(256); // 256 >> 16 = 0
    }
    // Waste on the floor layer shades nothing; waste in the layer above the floor shades the floor only.
    const s = createWorld(small({ founders: 0, lightK: 256, wasteShade: 0 }));
    for (let k = (D - 1) * WH; k < D * WH; k++) s.C[k] = 4096;
    for (const v of lightPlane(s)) expect(v).toBe(256);
    for (let k = (D - 2) * WH; k < (D - 1) * WH; k++) s.C[k] = 256;
    const lp = lightPlane(s);
    for (let k = 0; k < (D - 1) * WH; k++) expect(lp[k]).toBe(256);
    for (let k = (D - 1) * WH; k < D * WH; k++) expect(lp[k]).toBe(128);
    // The cap applies to the sum: P + Mb + C past MCAP shades like MCAP.
    const t = createWorld(small({ founders: 0, lightK: 256, wasteShade: 0 }));
    t.C[0] = 10_000; t.P[0] = 10_000;
    expect(lightPlane(t)[WH]).toBe(divT(256, 256, 16383));
  });

  it("with sinking, waste shading darkens the floor, and both ledgers stay exact on every step", () => {
    const floorLight = (over: Partial<Mycelium3dConfig>) => {
      const { s } = runChecked(small({ sinkShift: 6, ...over }), 1500);
      const I = lightPlane(s), WH = 16 * 16, D = 8;
      let sum = 0;
      for (let k = (D - 1) * WH; k < D * WH; k++) sum += I[k];
      return { light: sum / WH, n: s.n };
    };
    const off = floorLight({}), on = floorLight({ wasteShade: 0 });
    expect(on.n).toBeGreaterThan(0);
    expect(on.light).toBeLessThan(off.light / 2);
  }, LONG);

  it("an absent wasteShade leaves the R0 dynamics as they were (digests pinned before the key existed)", () => {
    const run = (over: Partial<Mycelium3dConfig>) => { const s = createWorld(small(over)); for (let t = 0; t < 600; t++) step(s); return stateDigest(s); };
    expect(run({ sinkShift: 6 })).toBe("cfabc7c1a99c0a85");
    expect(run({ sinkShift: 4, trailOwner: "gid", ownerDefend: 4, ownerConduit: 16 })).toBe("c64187585962f447");
    expect(run({ sinkShift: 6, wasteShade: 2 })).not.toBe("cfabc7c1a99c0a85");
  });

  it("the light input reads the plane: 127 unshaded, lower under a dense layer", () => {
    const s = createWorld(small({ founders: 2 }));
    // Particle 0 at (5, 5, 0) and particle 1 at (3, 3, 1): different columns, so neither shades the other.
    s.x[0] = s.y[0] = 5 << POS_SHIFT; s.z[0] = 0;
    s.x[1] = s.y[1] = 3 << POS_SHIFT; s.z[1] = 1 << POS_SHIFT;
    s.genome.fill(0);
    // Output MZ = hidden 0, hidden 0 = input 12 (light): weight 127 on W1[12][0] and on W2[0][MZ].
    for (const i of [0, 1]) { s.genome[i * NN_BYTES3 + 12 * NN_H3 + 0] = 127; s.genome[i * NN_BYTES3 + 112 + 0 * NN_O3 + OUT.MZ] = 127; }
    const before = probe(s);
    expect(before[OUT.MZ]).toBe(before[NN_O3 + OUT.MZ]);
    s.P[3 * 16 + 3] = 4096;
    const after = probe(s);
    expect(after[OUT.MZ]).toBe(before[OUT.MZ]);
    expect(after[NN_O3 + OUT.MZ]).toBeLessThan(before[NN_O3 + OUT.MZ]);
  });

  it("a hand-built net with a positive weight from the nutrient z-gradient to MZ moves toward the nutrient-rich layer", () => {
    for (const richBelow of [true, false]) {
      const s = createWorld(small({ founders: 1 }));
      const WH = 16 * 16, z0 = 3;
      s.x[0] = s.y[0] = (5 << POS_SHIFT) + 128; s.z[0] = (z0 << POS_SHIFT) + 128;
      s.genome.fill(0);
      // Input 11 (nutrient down - up) -> hidden 0 -> MZ, both weights +127. Hidden units are ReLU, so the mirror path
      // (-127 into hidden 1, -127 out of it) carries a negative gradient; MZ = +127 * relu(g) + 127 * relu(-g), up to rounding.
      s.genome[11 * NN_H3 + 0] = 127; s.genome[112 + 0 * NN_O3 + OUT.MZ] = 127;
      s.genome[11 * NN_H3 + 1] = -127; s.genome[112 + 1 * NN_O3 + OUT.MZ] = -127;
      const col = 5 * 16 + 5;
      s.A[(z0 + 1) * WH + col] = richBelow ? 120 : 0;
      s.A[(z0 - 1) * WH + col] = richBelow ? 0 : 120;
      s.matter0 = matterTotal(s); s.energy0 = energyTotal(s);
      const mz = probe(s)[OUT.MZ];
      const before = s.z[0];
      step(s);
      expect(s.n).toBe(1);
      if (richBelow) { expect(mz).toBeGreaterThan(0); expect(s.z[0]).toBeGreaterThan(before); }
      else { expect(mz).toBeLessThan(0); expect(s.z[0]).toBeLessThan(before); }
      expect(s.x[0]).toBe((5 << POS_SHIFT) + 128);
    }
  });

  it("with no light nothing converts, anywhere: waste stays waste", () => {
    const s = createWorld(small({ founders: 0, light: 0, sinkShift: 4 }));
    s.C.fill(10);
    s.matter0 = matterTotal(s); s.energy0 = energyTotal(s);
    const A0 = s.A.reduce((a, v) => a + v, 0);
    for (let t = 0; t < 200; t++) step(s);
    expect(s.A.reduce((a, v) => a + v, 0)).toBe(A0);
    expect(s.totals.lightIn).toBe(0);
  });
});

const divT = (L: number, K: number, m: number) => (L * Math.floor((256 * K) / (K + m))) >>> 8;

describe("mycelium3d R0 bounds and validation", () => {
  it("rejects configs outside the arithmetic bounds and unknown or unported keys", () => {
    expect(validateConfig(defaultConfig())).toEqual([]);
    expect(validateConfig(defaultConfig({ depth: 0 }))).not.toEqual([]);
    expect(validateConfig(defaultConfig({ depth: 65 }))).not.toEqual([]);
    expect(validateConfig(defaultConfig({ lightK: 0 }))).not.toEqual([]);
    expect(validateConfig(defaultConfig({ sinkShift: 0 }))).not.toEqual([]);
    expect(validateConfig(defaultConfig({ sinkShift: 17 }))).not.toEqual([]);
    for (const v of [0, 16]) expect(validateConfig(defaultConfig({ wasteShade: v }))).toEqual([]);
    for (const v of [-1, 17, 1.5]) expect(validateConfig(defaultConfig({ wasteShade: v }))).toContain("wasteShade must be an integer in [0, 16]");
    expect(validateConfig(defaultConfig({ width: 512, height: 512, depth: 64 }))).toEqual([]); // exactly 2^24 cells
    expect(validateConfig(defaultConfig({ width: 512, height: 512, depth: 64, nutrient0: 128 }))).toContain("initial matter must not exceed 2^31");
    expect(validateConfig(defaultConfig({ trailConduit: 4, ownerConduit: 4, trailOwner: "id" }))).not.toEqual([]);
    expect(validateConfig(defaultConfig({ trailConduitCap: 4 }))).not.toEqual([]);
    expect(validateConfig({ ...defaultConfig(), trailFreeLayer: 4 } as unknown as Mycelium3dConfig)).toContain("unknown key trailFreeLayer");
    expect(validateConfig({ ...defaultConfig(), controller: "physarum" } as unknown as Mycelium3dConfig)).toContain("unknown key controller");
  });

  it("leaves every optional key out of defaultConfig", () => {
    for (const k of ["sinkShift", "wasteShade", "trailMoveDiscount", "trailDiscountMode", "trailConduit", "trailConduitCap", "trailConduitGhost", "trailOwner", "ownerDefend", "ownerConduit", "ownerConduitCap", "ownerGhost", "bondBreak", "bondCost", "bondChild"]) {
      expect(k in defaultConfig()).toBe(false);
    }
  });

  it("refuses a checkpoint whose matter, padding or length was tampered with", () => {
    const s = createWorld(small());
    for (let t = 0; t < 30; t++) step(s);
    const good = encode(s);
    expect(() => decode(good)).not.toThrow();
    const m = createWorld(small()); for (let t = 0; t < 30; t++) step(m);
    m.A[5] += 1;
    expect(() => decode(encode(m))).toThrow(/matter residual/);
    const p = createWorld(small()); for (let t = 0; t < 30; t++) step(p);
    p.genome[NN_WEIGHTS3] = 1;
    expect(() => decode(encode(p))).toThrow(/padding/);
    expect(() => decode(good.subarray(0, good.length - 4))).toThrow(/bytes/);
  });
});

/** One particle's hand-built controller: biases only, in the 3D record (every weight 0). */
function biasGenome(s: ReturnType<typeof createWorld>, i: number, bias: Partial<Record<keyof typeof OUT, number>>): void {
  s.genome.fill(0, i * NN_BYTES3, (i + 1) * NN_BYTES3);
  for (const [k, v] of Object.entries(bias)) s.genome[i * NN_BYTES3 + B2_OFF3 + OUT[k as keyof typeof OUT]] = v!;
}
const rebase = (s: ReturnType<typeof createWorld>) => { s.matter0 = matterTotal(s); s.energy0 = energyTotal(s); };
const PSALT = 0x6d796331, DSALT = 0x64696666;

describe("mycelium3d R0 targeted expected values", () => {
  it("toll eligibility: on trail, only a particle that requests a deposit moves free; public mode frees both", () => {
    // Particle 0 deposits (DEPOSIT bias 127), particle 1 does not; both move at MX = 127 on a cell holding trail.
    const energyAfter = (over: Partial<Mycelium3dConfig>) => {
      const s = createWorld(small({ founders: 2, founderEnergy: 4000, moveCost: 1024, ...over }));
      for (const i of [0, 1]) { s.x[i] = s.y[i] = (4 << POS_SHIFT) + 10; s.z[i] = 0; }
      biasGenome(s, 0, { MX: 127, DEPOSIT: 127 }); biasGenome(s, 1, { MX: 127 });
      s.P[4 * 16 + 4] = 200; rebase(s);
      step(s);
      expect(s.n).toBe(2);
      return [s.E[0], s.E[1]];
    };
    const none = energyAfter({}), pub = energyAfter({ trailMoveDiscount: 256 }), toll = energyAfter({ trailMoveDiscount: 256, trailDiscountMode: "toll" });
    const move = (127 * 1024) >>> 7; // the full movement term, 1016
    expect(pub[0] - none[0]).toBe(move);
    expect(pub[1] - none[1]).toBe(move);
    expect(toll[0]).toBe(pub[0]); // depositor: discounted
    expect(toll[1]).toBe(none[1]); // non-depositor: pays in full
  });

  it("a trail conduit carries nutrient across a z face by exactly diffOut6 at the capped rate, and nowhere else", () => {
    const s = createWorld(small({ founders: 0, nutrient0: 0, light: 0, pDecay: 0, diffA: 0, diffC: 0, trailConduit: 255 }));
    const WH = 16 * 16, k = 2 * WH + 7 * 16 + 7, below = k + WH;
    s.P[k] = s.P[below] = 255; s.A[k] = 600; rebase(s);
    step(s);
    // Dd = min(0 + (255 * 255 >> 4), 128) = 128 on the k -> below edge only (every other edge has a trail-free end).
    const sent = diffOut6(600, 4, 128, cellBase((1 ^ DSALT) >>> 0, 0, k), 0);
    expect(sent).toBeGreaterThan(0);
    expect(s.A[below]).toBe(sent);
    expect(s.A[k]).toBe(600 - sent);
    expect(s.A.reduce((a, v) => a + v, 0)).toBe(600);
  });

  it("sinking moves matter exactly one layer per step, by mulFrac(q, 2^(16 - k), 16, draw)", () => {
    const s = createWorld(small({ founders: 0, nutrient0: 0, light: 0, pDecay: 0, diffA: 0, diffC: 0, sinkShift: 2 }));
    const WH = 16 * 16, k = 5 * 16 + 3;
    s.C[k] = 1001; s.P[k] = 77; rebase(s);
    const fb0 = cellBase(1, 0, k);
    const c1 = mulFrac(1001, 1 << 14, 16, draw(fb0, 2)), p1 = mulFrac(77, 1 << 14, 16, draw(fb0, 3));
    step(s);
    expect([s.C[k], s.C[k + WH], s.P[k], s.P[k + WH]]).toEqual([1001 - c1, c1, 77 - p1, p1]);
    for (let z = 2; z < 8; z++) { expect(s.C[k + z * WH]).toBe(0); expect(s.P[k + z * WH]).toBe(0); }
    const fbA = cellBase(1, 1, k), fbB = cellBase(1, 1, k + WH);
    const c2a = mulFrac(1001 - c1, 1 << 14, 16, draw(fbA, 2)), c2b = mulFrac(c1, 1 << 14, 16, draw(fbB, 2));
    step(s);
    expect([s.C[k], s.C[k + WH], s.C[k + 2 * WH]]).toEqual([1001 - c1 - c2a, c1 + c2a - c2b, c2b]);
    expect(s.C[k + 3 * WH]).toBe(0);
  });

  it("births at the floor and at the surface are clamped in z", () => {
    for (const atFloor of [true, false]) {
      // Pick a seed whose birth draw pushes the child out of the volume, so the clamp must act.
      let seed = 1;
      const off = (sd: number) => (draw(cellBase((sd ^ PSALT) >>> 0, 0, 0), 92) & 255) - 128;
      while (atFloor ? off(seed) <= 0 : off(seed) >= 0) seed++;
      const s = createWorld(small({ seed, founders: 1, founderMatter: 100, founderEnergy: 2000 }));
      const zMax = 8 * 256 - 1;
      s.z[0] = atFloor ? zMax : 0;
      biasGenome(s, 0, { SPLIT: 127 }); rebase(s);
      step(s);
      expect(s.n).toBe(2);
      expect(s.z[1]).toBe(atFloor ? zMax : 0);
      expect(s.z[0]).toBe(atFloor ? zMax : 0);
    }
  });

  it("fractional light converts floor(I / 256) plus one when draw(field, 1) & 255 < I & 255", () => {
    const s = createWorld(small({ founders: 0, nutrient0: 0, light: 1, lightK: 64, pDecay: 0, diffA: 0, diffC: 0 }));
    const WH = 16 * 16;
    for (let k = 0; k < WH; k++) s.P[k] = 64; // T(64) = 256 * 64 / 128 = 128, so layer 1 gets I = 128
    for (let k = WH; k < 2 * WH; k++) s.C[k] = 5;
    rebase(s);
    expect(lightPlane(s)[WH]).toBe(128);
    step(s);
    let converted = 0;
    for (let k = WH; k < 2 * WH; k++) {
      const want = (draw(cellBase(1, 0, k), 1) & 255) < 128 ? 1 : 0;
      expect(s.A[k]).toBe(want);
      converted += want;
    }
    expect(converted).toBeGreaterThan(WH / 4);
    expect(converted).toBeLessThan((3 * WH) / 4);
    // Layer 0 has no waste, so the only conversion is layer 1's.
    expect(s.totals.lightIn).toBe(converted * s.config.eA);
  });
});

describe("mycelium3d R0 state and counter validation (Sol review)", () => {
  const stepped = () => { const s = createWorld(small()); for (let t = 0; t < 20; t++) step(s); return s; };
  it("rejects total matter above 2^31, even when matter0 is tampered to match", () => {
    const s = stepped();
    const WH = 16 * 16;
    s.C[0] = 0xffffffff; s.C[WH] = 0xffffffff; s.matter0 = matterTotal(s);
    expect(validateState(s).join(" ")).toMatch(/matter0 must be|above 2\^31/);
    expect(() => decode(encode(s))).toThrow(/invalid mycelium3d checkpoint/);
  });

  it("rejects a missing, negative, fractional or extra counter and bad scalars", () => {
    const bad = (f: (s: ReturnType<typeof createWorld>) => void) => { const s = stepped(); f(s); return validateState(s); };
    expect(bad((s) => { delete (s.totals as Partial<typeof s.totals>).refused; })).not.toEqual([]);
    expect(bad((s) => { s.totals.births = -1; })).not.toEqual([]);
    expect(bad((s) => { s.totals.contended = 1.5; })).not.toEqual([]);
    expect(bad((s) => { (s.totals as unknown as Record<string, number>).extra = 0; })).not.toEqual([]);
    expect(bad((s) => { s.step = -1; })).not.toEqual([]);
    expect(bad((s) => { s.step = 2.5; })).not.toEqual([]);
    expect(bad((s) => { s.step = 2 ** 53; })).not.toEqual([]);
    expect(bad((s) => { s.M[0] = s.config.bodyMax + 1; s.matter0 = matterTotal(s); })).not.toEqual([]);
    // Through decode too: a header without totals.refused does not load.
    const s = stepped();
    delete (s.totals as Partial<typeof s.totals>).refused;
    expect(() => decode(encode(s))).toThrow(/totals/);
  });

  it("step refuses, without changing the state, at the last safe step and near the 2^50 counter bound", () => {
    const a = stepped();
    a.step = STEP_MAX - 1;
    step(a);
    expect(a.step).toBe(STEP_MAX);
    const before = encode(a);
    expect(() => step(a)).toThrow(/step counter/);
    expect(Buffer.from(encode(a)).equals(Buffer.from(before))).toBe(true);
    const b = stepped();
    b.totals.deaths = LEDGER_MAX - 100;
    const was = encode(b);
    expect(() => step(b)).toThrow(/deaths/);
    expect(Buffer.from(encode(b)).equals(Buffer.from(was))).toBe(true);
  });
});

describe("mycelium3d bonds (RULES.md, \"Bonds\")", () => {
  /** A frozen world of k particles with hand-set biases and positions (in cell units * 256 + offset); nothing else lives. */
  function hand(over: Partial<Mycelium3dConfig>, ps: { at: [number, number, number]; bias: Partial<Record<keyof typeof OUT, number>>; E?: number }[]) {
    const s = createWorld(small({ founders: ps.length, heredity: "frozen", maxEat: 0, nutrient0: 0, bondBreak: 512, ...over }));
    ps.forEach((p, i) => {
      [s.x[i], s.y[i], s.z[i]] = p.at;
      biasGenome(s, i, { SPLIT: -127, ...p.bias });
      if (p.E !== undefined) s.E[i] = p.E;
    });
    rebase(s);
    return s;
  }
  const bondsOf = (s: ReturnType<typeof createWorld>, id: number) => {
    const i = Array.from(s.id.subarray(0, s.n)).indexOf(id);
    return [s.bond0![i], s.bond1![i]].filter((v) => v !== BOND_NONE);
  };
  const C = (cx: number, off = 128) => cx * 256 + off;

  it("pins the digests of the rule without bonds (taken before the keys existed)", () => {
    const run = (c: Mycelium3dConfig, n: number) => { const s = createWorld(c); for (let t = 0; t < n; t++) step(s); return stateDigest(s); };
    expect(stateDigest(createWorld(defaultConfig()))).toBe("37009aeb1f320267");
    expect(run(defaultConfig(), 300)).toBe("42497bc3b7d17849");
    expect(run(small(), 600)).toBe("8c0fe6ebf03b3d21");
    expect(run(small({ sinkShift: 6, wasteShade: 2, trailMoveDiscount: 64, trailDiscountMode: "toll", trailOwner: "gid", ownerDefend: 4, ownerConduit: 16 }), 600)).toBe("0d853a9a2c7927b7");
    expect("bond0" in createWorld(defaultConfig())).toBe(false);
  }, LONG);

  it("forms mutual-nearest pairs only: a chain, then a ring of three, never across a diagonal", () => {
    // A and B share a cell; C is in the east face neighbour; D sits diagonally from everyone's cells and never bonds.
    const s = hand({ speed: 0 }, [
      { at: [C(3, 100), C(3), C(1)], bias: { BOND: 127 } },
      { at: [C(3, 150), C(3), C(1)], bias: { BOND: 127 } },
      { at: [C(4, 40), C(3), C(1)], bias: { BOND: 127 } },
      { at: [C(6), C(5), C(1)], bias: { BOND: 127 } },
    ]);
    const stats: BondStats[] = [];
    stats.push(step(s).bonds!);
    expect([bondsOf(s, 0), bondsOf(s, 1), bondsOf(s, 2)]).toEqual([[1], [0], []]); // C proposed B, B proposed A
    expect([stats[0].proposals, stats[0].formed]).toEqual([3, 1]);
    stats.push(step(s).bonds!);
    expect([bondsOf(s, 0), bondsOf(s, 1), bondsOf(s, 2)]).toEqual([[1], [0, 2], [1]]); // B and C now mutual; A's proposal (C) unanswered
    stats.push(step(s).bonds!);
    expect([bondsOf(s, 0), bondsOf(s, 1), bondsOf(s, 2)]).toEqual([[1, 2], [0, 2], [0, 1]]); // A and C close the ring
    step(s);
    expect(bondsOf(s, 3)).toEqual([]);
    expect(validateState(s)).toEqual([]);
  });

  it("breaks a tie in distance by the smaller id", () => {
    // P sits exactly between Q (id 1) and R (id 2), 64 units each way; Q and R are 128 apart, so both propose P.
    const s = hand({ speed: 0 }, [
      { at: [C(3), C(3), C(1)], bias: { BOND: 127 } },
      { at: [C(3, 64), C(3), C(1)], bias: { BOND: 127 } },
      { at: [C(3, 192), C(3), C(1)], bias: { BOND: 127 } },
    ]);
    step(s);
    expect([bondsOf(s, 0), bondsOf(s, 1), bondsOf(s, 2)]).toEqual([[1], [0], []]);
  });

  it("only particles that want a bond (BOND > 0) and have a free slot are proposed to", () => {
    const s = hand({ speed: 0 }, [
      { at: [C(3, 100), C(3), C(1)], bias: { BOND: 127 } },
      { at: [C(3, 110), C(3), C(1)], bias: { BOND: 0 } },
      { at: [C(3, 200), C(3), C(1)], bias: { BOND: 5 } },
    ]);
    step(s);
    expect([bondsOf(s, 0), bondsOf(s, 1), bondsOf(s, 2)]).toEqual([[2], [], [0]]);
  });

  it("moves a bonded pair by the truncated mean of their moves, and a chain's middle by the mean of three", () => {
    // BOND 0 holds the bonds without forming new ones (with BOND > 0 the chain's free ends would close a ring first).
    const s = hand({ speed: 128 }, [
      { at: [C(3), C(3), C(1)], bias: { MX: 100, MY: -21 } },
      { at: [C(3, 200), C(3), C(1)], bias: { MX: -21, MY: 0 } },
      { at: [C(9), C(9), C(1)], bias: { MX: 100 } },
      { at: [C(9, 100), C(9), C(1)], bias: { MX: 0 } },
      { at: [C(9, 200), C(9), C(1)], bias: { MX: -50 } },
    ]);
    // Bonds set by hand: pair 0-1, chain 2-3-4.
    const set = (i: number, b: number[]) => { s.bond0![i] = b[0] ?? BOND_NONE; s.bond1![i] = b[1] ?? BOND_NONE; };
    set(0, [1]); set(1, [0]); set(2, [3]); set(3, [2, 4]); set(4, [3]);
    expect(validateState(s)).toEqual([]);
    const x0 = Array.from(s.x.subarray(0, 5)), y0 = Array.from(s.y.subarray(0, 5));
    step(s);
    // Pair: x (100 - 21) / 2 = 39 (truncated), y (-21 + 0) / 2 = -10 (truncated toward zero), the same for both.
    expect([s.x[0] - x0[0], s.x[1] - x0[1], s.y[0] - y0[0], s.y[1] - y0[1]]).toEqual([39, 39, -10, -10]);
    // Chain: ends (100 + 0) / 2 = 50 and (-50 + 0) / 2 = -25, middle (100 + 0 - 50) / 3 = 16.
    expect([s.x[2] - x0[2], s.x[3] - x0[3], s.x[4] - x0[4]]).toEqual([50, 16, -25]);
  });

  it("breaks a bond when it stretches past bondBreak, when either end lets go, and when a partner dies", () => {
    const set = (s: ReturnType<typeof createWorld>, i: number, b: number[]) => { s.bond0![i] = b[0] ?? BOND_NONE; s.bond1![i] = b[1] ?? BOND_NONE; };
    // Stretch: chain 0-1-2 spaced 50, ends pull apart: 0 moves +63, 1 by 0, 2 by -63, so 0-1 and 1-2 are 113 apart > 100.
    const a = hand({ speed: 128, bondBreak: 100 }, [
      { at: [C(3, 100), C(3), C(1)], bias: { MX: 127 } },
      { at: [C(3, 50), C(3), C(1)], bias: {} },
      { at: [C(3, 0), C(3), C(1)], bias: { MX: -127 } },
    ]);
    set(a, 0, [1]); set(a, 1, [0, 2]); set(a, 2, [1]);
    const sa = step(a).bonds!;
    expect(sa.stretched).toBe(2);
    expect([bondsOf(a, 0), bondsOf(a, 1), bondsOf(a, 2)]).toEqual([[], [], []]);
    // Let go: one end's BOND is negative; a zero output keeps the bond.
    const b = hand({ speed: 0 }, [
      { at: [C(3), C(3), C(1)], bias: { BOND: -1 } },
      { at: [C(3, 10), C(3), C(1)], bias: { BOND: 127 } },
      { at: [C(7), C(7), C(1)], bias: { BOND: 0 } },
      { at: [C(7, 10), C(7), C(1)], bias: { BOND: 0 } },
    ]);
    set(b, 0, [1]); set(b, 1, [0]); set(b, 2, [3]); set(b, 3, [2]);
    const sb = step(b).bonds!;
    expect(sb.letGo).toBe(1);
    expect([bondsOf(b, 0), bondsOf(b, 1), bondsOf(b, 2), bondsOf(b, 3)]).toEqual([[], [], [3], [2]]);
    // Death: particle 0 has no energy for its upkeep and dies; its partner keeps no bond to it.
    const d = hand({ speed: 0 }, [
      { at: [C(3), C(3), C(1)], bias: { BOND: 127 }, E: 1 },
      { at: [C(3, 10), C(3), C(1)], bias: { BOND: 127 } },
    ]);
    set(d, 0, [1]); set(d, 1, [0]);
    rebase(d);
    const sd = step(d).bonds!;
    expect([d.n, sd.partnerDied, bondsOf(d, 1)]).toEqual([1, 1, []]);
    for (const s of [a, b, d]) expect(validateState(s)).toEqual([]);
  });

  it("charges bondCost per bond held, as heat, and the ledger stays exact", () => {
    const twin = (bonded: boolean) => {
      const s = hand({ speed: 0, bondCost: 7 }, [
        { at: [C(3), C(3), C(1)], bias: { BOND: 127 } },
        { at: [C(3, 10), C(3), C(1)], bias: { BOND: 127 } },
        { at: [C(3, 20), C(3), C(1)], bias: { BOND: 127 } },
      ]);
      if (bonded) { s.bond0![0] = 1; s.bond0![1] = 0; s.bond1![1] = 2; s.bond0![2] = 1; }
      return s;
    };
    const free = twin(false), held = twin(true);
    const e0 = Array.from(held.E.subarray(0, 3));
    const hf = step(free).heat, hh = step(held).heat;
    // Upkeep and mass terms are the same for both (same draws); the bonded ones pay 7 per bond held at the start of the step.
    expect([e0[0] - held.E[0] - (e0[0] - free.E[0]), e0[1] - held.E[1] - (e0[1] - free.E[1]), e0[2] - held.E[2] - (e0[2] - free.E[2])]).toEqual([7, 14, 7]);
    expect(hh - hf).toBe(28);
    for (const s of [free, held]) expect(energyTotal(s)).toBe(s.energy0 + s.totals.lightIn - s.totals.heat);
  });

  it("bondChild: a child is born bonded to a parent with a free slot, and free when the parent is full", () => {
    const set = (s: ReturnType<typeof createWorld>, i: number, b: number[]) => { s.bond0![i] = b[0] ?? BOND_NONE; s.bond1![i] = b[1] ?? BOND_NONE; };
    const s = hand({ speed: 0, bondChild: true, splitEnergy: 0, splitMatter: 2 }, [
      { at: [C(3), C(3), C(1)], bias: { BOND: 127, SPLIT: 127 } }, // alone: its child bonds to it
      { at: [C(8), C(8), C(1)], bias: { BOND: 127 } },
      { at: [C(8, 50), C(8), C(1)], bias: { BOND: 127, SPLIT: 127 } }, // the middle of a chain: full, its child is free
      { at: [C(8, 100), C(8), C(1)], bias: { BOND: 127 } },
    ]);
    set(s, 1, [2]); set(s, 2, [1, 3]); set(s, 3, [2]);
    const st = step(s);
    expect(st.births).toBe(2);
    expect(st.bonds!.childBonds).toBe(1);
    // Children take ids 4 (of particle 0) and 5 (of particle 2).
    expect([bondsOf(s, 0), bondsOf(s, 4), bondsOf(s, 2), bondsOf(s, 5)]).toEqual([[4], [0], [1, 3], []]);
    expect(validateState(s)).toEqual([]);
    // Without bondChild the same split leaves the child free.
    const t = hand({ speed: 0, splitEnergy: 0, splitMatter: 2 }, [{ at: [C(3), C(3), C(1)], bias: { BOND: -1, SPLIT: 127 } }]);
    step(t);
    expect([t.n, bondsOf(t, 0), bondsOf(t, 1)]).toEqual([2, [], []]);
  });

  it("with BOND never positive, bonds on equals the keyless world (no upkeep, the R0 move)", () => {
    const mk = (over: Partial<Mycelium3dConfig>) => {
      const s = createWorld(small({ heredity: "frozen", ...over }));
      for (let i = 0; i < s.n; i++) biasGenome(s, i, { BOND: -5, EAT: 40 + (i % 7) * 10, MX: (i % 9) * 25 - 100, MZ: (i % 4) * 40 - 60, SPLIT: 127 });
      for (let t = 0; t < 200; t++) step(s);
      return s;
    };
    const on = mk({ bondBreak: 512, bondCost: 50 }), off = mk({});
    for (const k of ["A", "C", "P", "x", "y", "z", "M", "E", "id"] as const) expect(Buffer.from(on[k].buffer).equals(Buffer.from(off[k].buffer))).toBe(true);
  });

  it("validates the keys and the bond graph, and round-trips the slots through a checkpoint", () => {
    for (const v of [1, 1024]) expect(validateConfig(defaultConfig({ bondBreak: v }))).toEqual([]);
    for (const v of [0, 1025, 2.5]) expect(validateConfig(defaultConfig({ bondBreak: v }))).toContain("bondBreak must be an integer in [1, 1024]");
    expect(validateConfig(defaultConfig({ bondCost: 1 }))).toContain("bondCost requires bondBreak");
    expect(validateConfig(defaultConfig({ bondBreak: 9, bondCost: 4097 }))).toContain("bondCost must be an integer in [0, 4096]");
    expect(validateConfig(defaultConfig({ bondChild: true }))).toContain("bondChild requires bondBreak");
    expect(validateConfig({ ...defaultConfig({ bondBreak: 9 }), bondChild: false } as unknown as Mycelium3dConfig)).toContain("bondChild must be true or absent");
    const s = createWorld(small({ bondBreak: 400, bondChild: true }));
    for (let t = 0; t < 300; t++) step(s);
    expect(validateState(s)).toEqual([]);
    let bonded = 0;
    for (let i = 0; i < s.n; i++) bonded += s.bond0![i] !== BOND_NONE ? 1 : 0;
    expect(bonded).toBeGreaterThan(0);
    const bytes = encode(s);
    expect(Buffer.from(encode(decode(bytes))).equals(Buffer.from(bytes))).toBe(true);
    // Tampering: find a bonded particle i with partner j.
    const i = Array.from(s.bond0!.subarray(0, s.n)).findIndex((v) => v !== BOND_NONE);
    const fresh = () => decode(bytes);
    const asym = fresh(); { const j = Array.from(asym.id.subarray(0, asym.n)).indexOf(asym.bond0![i]); if (asym.bond0![j] === asym.id[i]) { asym.bond0![j] = asym.bond1![j]; asym.bond1![j] = BOND_NONE; } else asym.bond1![j] = BOND_NONE; }
    expect(validateState(asym).join()).toMatch(/does not name it back/);
    const self = fresh(); self.bond0![i] = self.id[i]; self.bond1![i] = BOND_NONE;
    expect(validateState(self).join()).toMatch(/bonded to itself|does not name it back/);
    const dead = fresh(); dead.bond0![i] = dead.nextId + 5; dead.bond1![i] = BOND_NONE;
    expect(validateState(dead).join()).toMatch(/not alive/);
    const order = fresh(); order.bond1![i] = order.bond0![i]; order.bond0![i] = BOND_NONE;
    expect(validateState(order).join()).toMatch(/slot 0 empty/);
    const keyless = fresh(); keyless.config = { ...keyless.config }; delete keyless.config.bondBreak; delete keyless.config.bondChild;
    expect(validateState(keyless)).toContain("bond slots require bondBreak");
    expect(() => decode(bytes.subarray(0, bytes.length - 4))).toThrow(/bytes/);
  }, LONG);
});
