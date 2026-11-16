// Mycelium bootstrap kernel rules (optional keys, exploratory; docs/mycelium-bootstrap-2026-11-14/DESIGN.md): pre-laid trail (P), free first
// layer and the displaced-read ghost (F), owner conduit (O). Keys absent leave the pinned digest alone, both ledgers close with residual
// exactly 0 on every step for each key and combination, validateConfig rejects at every bound, and each rule has a test that fails if the
// rule is a no-op. The GPU side is tests/deno/mycelium_gpu.ts (a later step).
import { describe, expect, it } from "vitest";
import { mulFrac } from "@bl/schema";
import {
  createWorld, decode, defaultConfig, encode, energyTotal, laidCell, matterTotal, type MyceliumConfig, type MyceliumState, ownerRate, ownerTag,
  resolveClaims, shiftCell, stateDigest, step, validateConfig, validateState,
} from "../mycelium/world.ts";

const small = (over: Partial<MyceliumConfig> = {}) => defaultConfig({ width: 48, height: 48, founders: 256, maxParticles: 2048, ...over });
const sum = (a: ArrayLike<number>, n = a.length) => { let t = 0; for (let i = 0; i < n; i++) t += a[i]; return t; };
const retake = (s: MyceliumState) => { s.matter0 = matterTotal(s); s.energy0 = energyTotal(s); };

function runChecked(c: MyceliumConfig, steps: number) {
  const s = createWorld(c);
  expect(validateState(s)).toEqual([]);
  for (let t = 0; t < steps; t++) {
    step(s);
    expect(matterTotal(s)).toBe(s.matter0);
    expect(energyTotal(s)).toBe(s.energy0 + s.totals.lightIn - s.totals.heat);
  }
  expect(validateState(s)).toEqual([]);
  return s;
}

/** A frozen-physarum world whose particles all request exactly 3 deposit units and 15 eaten units (no draws involved). */
const phys = (over: Partial<MyceliumConfig> = {}) =>
  small({ controller: "physarum", heredity: "frozen", physarumDeposit: 768, founders: 4, pDecay: 0, diffA: 0, diffC: 0, light: 0, ...over });
const at = (x: number, y: number, W = 48) => y * W + x;
/** Put every live particle in cell (cx, cy). */
function clump(s: MyceliumState, cx: number, cy: number) {
  for (let i = 0; i < s.n; i++) { s.x[i] = cx * 256 + 10; s.y[i] = cy * 256 + 10; }
}

describe("bootstrap: keys absent change nothing", () => {
  it("keeps the pinned digest and never sets any key, plane or counter", () => {
    const keys = ["trailInit", "trailInitPattern", "trailInitPitch", "trailFreeLayer", "trailConduitGhost", "trailOwner", "ownerDefend", "ownerConduit", "ownerConduitCap", "ownerGhost"];
    const s = createWorld(small());
    for (const k of keys) { expect(k in s.config).toBe(false); expect(k in defaultConfig()).toBe(false); }
    expect(s.Z).toBeUndefined();
    expect(s.Q).toBeUndefined();
    for (let t = 0; t < 300; t++) step(s);
    expect("freeUnits" in s.totals).toBe(false);
    expect(Object.keys(s.totals)).toEqual(["lightIn", "heat", "births", "deaths", "refused", "contended", "mutations"]);
    expect(stateDigest(s)).toBe("9a5461c07ef6fcde");
    expect(stateDigest(decode(encode(s)))).toBe("9a5461c07ef6fcde");
  });
});

describe("bootstrap: validateConfig bounds and requires/excludes", () => {
  const ok = (over: Partial<MyceliumConfig>) => expect(validateConfig(small(over))).toEqual([]);
  const no = (over: Partial<MyceliumConfig>, frag: string) => {
    const bad = validateConfig(small(over));
    expect(bad.some((b) => b.includes(frag)), `${JSON.stringify(over)} -> ${bad.join(" | ")}`).toBe(true);
  };

  it("trailInit, pattern and pitch", () => {
    ok({ trailInit: 1 }); ok({ trailInit: 255 });
    no({ trailInit: 0 }, "trailInit"); no({ trailInit: 256 }, "trailInit"); no({ trailInit: 1.5 }, "trailInit");
    ok({ trailInit: 8, trailInitPattern: "carpet" });
    for (const p of ["rows", "cols", "lattice", "patches"] as const) ok({ trailInit: 8, trailInitPattern: p });
    no({ trailInit: 8, trailInitPattern: "stripes" as never }, "trailInitPattern");
    no({ trailInitPattern: "rows" }, "trailInitPattern requires trailInit");
    ok({ trailInit: 8, trailInitPattern: "rows", trailInitPitch: 2 }); ok({ trailInit: 8, trailInitPattern: "rows", trailInitPitch: 64 });
    no({ trailInit: 8, trailInitPattern: "rows", trailInitPitch: 1 }, "trailInitPitch"); no({ trailInit: 8, trailInitPattern: "rows", trailInitPitch: 65 }, "trailInitPitch");
    no({ trailInit: 8, trailInitPattern: "rows", trailInitPitch: 4.5 }, "trailInitPitch");
    no({ trailInitPitch: 8 }, "trailInitPitch requires trailInit");
    no({ trailInit: 8, trailInitPitch: 8 }, "other than carpet");
    no({ trailInit: 8, trailInitPattern: "carpet", trailInitPitch: 8 }, "other than carpet");
  });

  it("trailFreeLayer and trailConduitGhost", () => {
    ok({ trailFreeLayer: 1 }); ok({ trailFreeLayer: 255 });
    no({ trailFreeLayer: 0 }, "trailFreeLayer"); no({ trailFreeLayer: 256 }, "trailFreeLayer"); no({ trailFreeLayer: 2.5 }, "trailFreeLayer");
    ok({ trailConduit: 8, trailConduitGhost: 1 }); ok({ trailConduit: 8, trailConduitGhost: 47 });
    no({ trailConduit: 8, trailConduitGhost: 0 }, "trailConduitGhost"); no({ trailConduit: 8, trailConduitGhost: 48 }, "trailConduitGhost");
    no({ trailConduitGhost: 8 }, "trailConduitGhost requires trailConduit");
    expect(validateConfig(defaultConfig({ width: 64, height: 16, trailConduit: 8, trailConduitGhost: 15 }))).toEqual([]);
    expect(validateConfig(defaultConfig({ width: 64, height: 16, trailConduit: 8, trailConduitGhost: 16 })).length).toBeGreaterThan(0);
  });

  it("owner keys", () => {
    ok({ trailOwner: "id" }); ok({ trailOwner: "gid" });
    no({ trailOwner: "clan" as never }, "trailOwner");
    ok({ trailOwner: "id", ownerDefend: 1 }); ok({ trailOwner: "id", ownerDefend: 255 });
    no({ trailOwner: "id", ownerDefend: 0 }, "ownerDefend"); no({ trailOwner: "id", ownerDefend: 256 }, "ownerDefend");
    no({ ownerDefend: 4 }, "ownerDefend requires trailOwner");
    ok({ trailOwner: "id", ownerConduit: 0 }); ok({ trailOwner: "id", ownerConduit: 255 });
    no({ trailOwner: "id", ownerConduit: 256 }, "ownerConduit"); no({ trailOwner: "id", ownerConduit: -1 }, "ownerConduit");
    no({ ownerConduit: 4 }, "ownerConduit requires trailOwner");
    ok({ trailOwner: "id", ownerConduit: 4, diffA: 128 });
    no({ trailOwner: "id", ownerConduit: 4, diffA: 129 }, "diffA");
    no({ trailOwner: "id", ownerConduit: 4, trailConduit: 4 }, "excludes trailConduit");
    ok({ trailOwner: "id", trailConduit: 4 });
    ok({ trailOwner: "id", ownerConduit: 4, ownerConduitCap: 1 }); ok({ trailOwner: "id", ownerConduit: 4, ownerConduitCap: 255 });
    no({ trailOwner: "id", ownerConduit: 4, ownerConduitCap: 0 }, "ownerConduitCap"); no({ trailOwner: "id", ownerConduit: 4, ownerConduitCap: 256 }, "ownerConduitCap");
    no({ trailOwner: "id", ownerConduitCap: 4 }, "ownerConduitCap requires ownerConduit");
    ok({ trailOwner: "id", ownerConduit: 4, ownerGhost: 1 }); ok({ trailOwner: "id", ownerConduit: 4, ownerGhost: 47 });
    no({ trailOwner: "id", ownerConduit: 4, ownerGhost: 0 }, "ownerGhost"); no({ trailOwner: "id", ownerConduit: 4, ownerGhost: 48 }, "ownerGhost");
    no({ trailOwner: "id", ownerGhost: 4 }, "ownerGhost requires ownerConduit");
  });

  it("createWorld refuses an invalid bootstrap config", () => {
    expect(() => createWorld(small({ trailInitPitch: 8 }))).toThrow(/trailInitPitch/);
  });
});

describe("P: pre-laid trail", () => {
  it("laidCell: counts per pattern on 48 x 48, pitch 8, and the default pitch", () => {
    const count = (c: Partial<MyceliumConfig>) => { let n = 0; for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) if (laidCell(c, x, y)) n++; return n; };
    expect(count({})).toBe(2304);
    expect(count({ trailInitPattern: "carpet" })).toBe(2304);
    expect(count({ trailInitPattern: "rows" })).toBe(288);
    expect(count({ trailInitPattern: "cols" })).toBe(288);
    expect(count({ trailInitPattern: "lattice" })).toBe(540);
    expect(count({ trailInitPattern: "patches" })).toBe(576);
    expect(count({ trailInitPattern: "rows", trailInitPitch: 6 })).toBe(8 * 48);
    expect(laidCell({ trailInitPattern: "rows" }, 5, 8)).toBe(true);
    expect(laidCell({ trailInitPattern: "rows" }, 5, 9)).toBe(false);
    expect(laidCell({ trailInitPattern: "cols" }, 8, 5)).toBe(true);
    expect(laidCell({ trailInitPattern: "patches" }, 3, 3)).toBe(true);
    expect(laidCell({ trailInitPattern: "patches" }, 4, 3)).toBe(false);
    expect(laidCell({ trailInitPattern: "patches", trailInitPitch: 16 }, 7, 7)).toBe(true);
    expect(laidCell({ trailInitPattern: "patches", trailInitPitch: 16 }, 8, 7)).toBe(false);
  });

  it("lays min(trailInit, A) from A to P on exactly the laid cells; matter equal, energy anchor lower by eA * laid units", () => {
    const base = createWorld(small());
    for (const pattern of ["carpet", "rows", "cols", "lattice", "patches"] as const) {
      const s = createWorld(small({ trailInit: 16, trailInitPattern: pattern }));
      let laid = 0;
      for (let i = 0; i < s.A.length; i++) {
        const on = laidCell(s.config, i % 48, (i / 48) | 0);
        expect(s.P[i]).toBe(on ? 16 : 0);
        expect(s.A[i]).toBe(on ? 32 : 48);
        if (on) laid += 16;
      }
      expect(s.matter0).toBe(base.matter0);
      expect(s.energy0).toBe(base.energy0 - s.config.eA * laid);
      expect(validateState(s)).toEqual([]);
    }
  });

  it("caps at A: nutrient0 4 with trailInit 16 lays 4; trailInit 255 lays all of A", () => {
    const a = createWorld(small({ nutrient0: 4, trailInit: 16 }));
    expect(Array.from(new Set(a.A))).toEqual([0]);
    expect(Array.from(new Set(a.P))).toEqual([4]);
    const b = createWorld(small({ trailInit: 255 }));
    expect(Array.from(new Set(b.A))).toEqual([0]);
    expect(Array.from(new Set(b.P))).toEqual([48]);
    for (let t = 0; t < 40; t++) { step(b); expect(matterTotal(b)).toBe(b.matter0); expect(energyTotal(b)).toBe(b.energy0 + b.totals.lightIn - b.totals.heat); }
  });

  it("ledgers close every step for each pattern, with conduit, gradient light, durable decay and heredity arms", () => {
    const configs: Partial<MyceliumConfig>[] = [
      { trailInit: 16 },
      { trailInit: 32, trailInitPattern: "rows", trailConduit: 128, lightPattern: "gradient" },
      { trailInit: 32, trailInitPattern: "cols", trailConduit: 255, trailConduitCap: 2, lightPattern: "gradient" },
      { trailInit: 24, trailInitPattern: "lattice", trailInitPitch: 6, trailConduit: 64 },
      { trailInit: 24, trailInitPattern: "patches", pDecay: 66 },
      { trailInit: 255, trailInitPattern: "rows", heredity: "blocked" },
      { trailInit: 16, trailInitPattern: "rows", controller: "physarum", heredity: "frozen" },
      { trailInit: 16, trailInitPattern: "rows", moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" },
    ];
    for (const over of configs) runChecked(small(over), 120);
  });

  it("is not a no-op: a laid world differs from the keyless one in field and in particles' fate", () => {
    const a = createWorld(small()), b = createWorld(small({ trailInit: 32, trailInitPattern: "rows" }));
    for (let t = 0; t < 60; t++) { step(a); step(b); }
    expect(Array.from(b.P)).not.toEqual(Array.from(a.P));
    expect(Array.from(b.A)).not.toEqual(Array.from(a.A));
    expect(stateDigest(b)).not.toBe(stateDigest(a));
  });

  it("decodes a laid checkpoint, revalidates it, and the resumed run equals the continuous run", () => {
    const s = createWorld(small({ trailInit: 24, trailInitPattern: "lattice" }));
    for (let t = 0; t < 40; t++) step(s);
    const d = decode(encode(s));
    expect(validateState(d)).toEqual([]);
    expect(stateDigest(d)).toBe(stateDigest(s));
    for (let t = 0; t < 40; t++) { step(s); step(d); }
    expect(stateDigest(d)).toBe(stateDigest(s));
  });

  it("a laid and an unlaid world start with the same particles and differ only in A, P and the energy anchor", () => {
    const a = createWorld(small()), b = createWorld(small({ trailInit: 8, trailInitPattern: "cols" }));
    expect(Array.from(b.x)).toEqual(Array.from(a.x));
    expect(Array.from(b.genome)).toEqual(Array.from(a.genome));
    expect(sum(a.A) - sum(b.A)).toBe(sum(b.P));
  });
});

describe("shiftCell and ghost controls", () => {
  it("shiftCell is a torus translation: a permutation, wrapping both axes", () => {
    expect(shiftCell(at(47, 47), 1, 48, 48)).toBe(at(0, 0));
    expect(shiftCell(at(3, 4), 5, 48, 48)).toBe(at(8, 9));
    const seen = new Set<number>();
    for (let i = 0; i < 48 * 48; i++) seen.add(shiftCell(i, 7, 48, 48));
    expect(seen.size).toBe(48 * 48);
    expect(shiftCell(at(60 % 16, 9, 16), 3, 16, 12)).toBe(at(((60 % 16) + 3) % 16, 0, 16));
  });

  /** An empty world with one big A bump at (10, 20) and a road (P 255) along one row; A east of the bump after one step. */
  function eastOfBump(over: Partial<MyceliumConfig>, roadRow: number) {
    const s = createWorld(small({ founders: 0, nutrient0: 0, light: 0, pDecay: 0, ...over }));
    s.A[at(10, 20)] = 20000;
    for (let x = 0; x < 48; x++) s.P[at(x, roadRow)] = 255;
    if (s.Q) for (let x = 0; x < 48; x++) { s.Q[at(x, roadRow)] = 255; s.Z![at(x, roadRow)] = 7; }
    s.nextId = 100; s.nextGid = 100;
    retake(s);
    step(s);
    expect(matterTotal(s)).toBe(s.matter0);
    return s.A[at(11, 20)];
  }

  it("trailConduitGhost reads P at the displaced cells: road at row 23 with shift 3 equals road at row 20 unshifted, and the unshifted ghost-free road elsewhere does not", () => {
    const plain = eastOfBump({}, 20);
    const real = eastOfBump({ trailConduit: 255 }, 20);
    const ghostOnRoad = eastOfBump({ trailConduit: 255, trailConduitGhost: 3 }, 20);
    const ghostDisplaced = eastOfBump({ trailConduit: 255, trailConduitGhost: 3 }, 23);
    expect(real).toBeGreaterThan(plain);
    expect(ghostDisplaced).toBe(real);
    expect(ghostOnRoad).toBe(plain);
  });

  it("ownerGhost reads Z and Q at the displaced cells in the same way", () => {
    const plain = eastOfBump({ trailOwner: "id" }, 20);
    const real = eastOfBump({ trailOwner: "id", ownerConduit: 255 }, 20);
    const ghostOnRoad = eastOfBump({ trailOwner: "id", ownerConduit: 255, ownerGhost: 3 }, 20);
    const ghostDisplaced = eastOfBump({ trailOwner: "id", ownerConduit: 255, ownerGhost: 3 }, 23);
    expect(real).toBeGreaterThan(plain);
    expect(ghostDisplaced).toBe(real);
    expect(ghostOnRoad).toBe(plain);
  });
});

describe("F: free first layer", () => {
  it("shares the free room pro rata and never over it: 4 depositors of 3 on P 5 with F 16 get floor(3*11/12) = 2 each", () => {
    const s = createWorld(phys({ trailFreeLayer: 16, depositCost: 4096 }));
    clump(s, 5, 5);
    s.P[at(5, 5)] = 5; retake(s);
    const st = step(s);
    expect(st.freeUnits).toBe(8);
    expect(st.paidUnits).toBe(0);
    expect(s.P[at(5, 5)]).toBe(13);
    expect(s.totals.freeUnits).toBe(8);
    expect(s.totals.paidUnits).toBe(0);
    expect(s.totals.freeUnits!).toBeLessThanOrEqual(16 - 5);
    expect(matterTotal(s)).toBe(s.matter0);
    expect(energyTotal(s)).toBe(s.energy0 + s.totals.lightIn - s.totals.heat);
  });

  it("room is 0 when the start-of-step trail is at or above F (compare before subtract), and everything is paid", () => {
    for (const p0 of [16, 17, 4000, 2 ** 31 - 10]) {
      const s = createWorld(phys({ trailFreeLayer: 16 }));
      clump(s, 5, 5);
      s.P[at(5, 5)] = p0; retake(s);
      const st = step(s);
      expect(st.freeUnits).toBe(0);
      expect(st.paidUnits).toBe(12);
      expect(s.P[at(5, 5)]).toBe(p0 + 12);
    }
  });

  it("with room for everyone (F 255 on P 0) all 12 units are free and cost no energy; a clipped en pays only the paid part", () => {
    const free = createWorld(phys({ trailFreeLayer: 255 })), keyless = createWorld(phys());
    for (const s of [free, keyless]) clump(s, 5, 5);
    const stF = step(free), stK = step(keyless);
    expect(stF.freeUnits).toBe(12);
    expect(stF.paidUnits).toBe(0);
    expect(stK.heat - stF.heat).toBe(12 * free.config.depositCost);
    expect(sum(free.E, free.n) - sum(keyless.E, keyless.n)).toBe(12 * free.config.depositCost);
    expect(Array.from(free.P)).toEqual(Array.from(keyless.P));
    // en binds: depositCost 4096 makes every paid unit unaffordable at E 512, so only the free share deposits.
    const clip = createWorld(phys({ trailFreeLayer: 8, depositCost: 4096 }));
    clump(clip, 5, 5);
    const stC = step(clip);
    expect(stC.freeUnits).toBe(Math.floor(3 * 8 / 12) * 4);
    expect(stC.paidUnits).toBe(0);
    expect(clip.P[at(5, 5)]).toBe(stC.freeUnits);
  });

  it("one-step accounting in a full world: heat falls and the particles' energy rises by exactly freeUnits * depositCost", () => {
    const over = { founderEnergy: 2048, splitEnergy: 1 << 24 };
    const a = createWorld(small(over)), b = createWorld(small({ ...over, trailFreeLayer: 255 }));
    const stA = step(a), stB = step(b);
    expect(stB.freeUnits!).toBeGreaterThan(0);
    expect(Array.from(b.P)).toEqual(Array.from(a.P));
    expect(Array.from(b.A)).toEqual(Array.from(a.A));
    expect(stA.heat - stB.heat).toBe(stB.freeUnits! * 2);
    expect(sum(b.E, b.n) - sum(a.E, a.n)).toBe(stB.freeUnits! * 2);
  });

  it("ledgers close every step for F alone and with conduit, ghost, toll, gradient, heredity arms and a binding depositCost", () => {
    const configs: Partial<MyceliumConfig>[] = [
      { trailFreeLayer: 1 }, { trailFreeLayer: 16 }, { trailFreeLayer: 255 },
      { trailFreeLayer: 16, trailConduit: 64 },
      { trailFreeLayer: 16, trailConduit: 64, trailConduitGhost: 24 },
      { trailFreeLayer: 16, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" },
      { trailFreeLayer: 16, lightPattern: "gradient" },
      { trailFreeLayer: 16, heredity: "blocked" },
      { trailFreeLayer: 16, controller: "physarum", heredity: "frozen" },
      { trailFreeLayer: 16, depositCost: 4096 },
      { trailFreeLayer: 16, trailInit: 24, trailInitPattern: "rows", trailConduit: 128 },
    ];
    for (const over of configs) {
      const s = runChecked(small(over), 150);
      expect(s.totals.freeUnits! + s.totals.paidUnits!).toBeGreaterThan(0);
    }
  });

  it("is not a no-op: the world differs from the keyless one, and F = 1 differs from absent", () => {
    const a = createWorld(small()), b = createWorld(small({ trailFreeLayer: 16 })), c = createWorld(small({ trailFreeLayer: 1 }));
    for (let t = 0; t < 120; t++) { step(a); step(b); step(c); }
    expect(Array.from(b.E.subarray(0, b.n))).not.toEqual(Array.from(a.E.subarray(0, a.n)));
    expect(stateDigest(c)).not.toBe(stateDigest(a));
    expect(b.totals.freeUnits!).toBeGreaterThan(0);
    expect(b.totals.heat).toBeLessThan(a.totals.heat);
  });

  it("trailConduit 0 with F has the state arrays of F alone; counters survive encode and decode", () => {
    const a = createWorld(small({ trailFreeLayer: 16 })), b = createWorld(small({ trailFreeLayer: 16, trailConduit: 0 }));
    for (let t = 0; t < 120; t++) { step(a); step(b); }
    expect(Array.from(b.A)).toEqual(Array.from(a.A));
    expect(Array.from(b.P)).toEqual(Array.from(a.P));
    expect(b.totals).toEqual(a.totals);
    const d = decode(encode(a));
    expect(d.totals.freeUnits).toBe(a.totals.freeUnits);
    expect(stateDigest(d)).toBe(stateDigest(a));
    for (let t = 0; t < 30; t++) { step(a); step(d); }
    expect(stateDigest(d)).toBe(stateDigest(a));
  });

  it("validateState rejects counters without the key and a missing counter with it", () => {
    const s = createWorld(small());
    s.totals.freeUnits = 0;
    expect(validateState(s).some((b) => b.includes("freeUnits"))).toBe(true);
    const f = createWorld(small({ trailFreeLayer: 4 }));
    delete f.totals.paidUnits;
    expect(validateState(f).some((b) => b.includes("paidUnits"))).toBe(true);
  });
});

describe("O: owner conduit", () => {
  const owned = (over: Partial<MyceliumConfig> = {}) => small({ trailOwner: "id", ...over });

  it("ownerTag is exactly v + 1 (no collision where a 24-bit hash collided) and fits u32 at the largest id", () => {
    expect(ownerTag(0)).toBe(1);
    expect(ownerTag(0xfffffffe)).toBe(0xffffffff);
    expect(ownerTag(1)).not.toBe(ownerTag(2604073));
    const seen = new Set<number>();
    for (let v = 0; v < 5000; v++) seen.add(ownerTag(v));
    expect(seen.size).toBe(5000);
  });

  it("resolveClaims: largest deposit wins, then largest tag, with no packed compare (deposits 1, 127, 128, 253)", () => {
    const run = (cands: [number, number][]) => {
      const Z = new Uint32Array(4), Q = new Uint32Array(4);
      resolveClaims(Z, Q, 4, cands.map(() => 2), cands.map((c) => c[0]), cands.map((c) => c[1]));
      return [Z[2], Q[2]];
    };
    expect(run([[127, 5], [128, 3]])).toEqual([3, 128]);
    expect(run([[128, 3], [127, 5]])).toEqual([3, 128]);
    expect(run([[1, 7], [1, 8]])).toEqual([8, 1]);
    expect(run([[253, 2], [253, 9], [253, 9]])).toEqual([9, 506]);
    expect(run([[127, 5], [127, 4]])).toEqual([5, 127]);
    // Same clan: every candidate of the winning tag counts, whatever its own deposit; the other clan's do not.
    expect(run([[128, 3], [127, 3], [100, 5]])).toEqual([3, 255]);
    expect(run([[128, 3], [127, 3], [253, 5]])).toEqual([5, 253]);
    expect(run([[1, 4_000_000_000], [1, 3_999_999_999]])).toEqual([4_000_000_000, 1]);
    // Other cells are untouched; no candidate leaves the cell unowned.
    const Z = new Uint32Array(4), Q = new Uint32Array(4);
    resolveClaims(Z, Q, 4, [2], [5], [9]);
    expect(Array.from(Z)).toEqual([0, 0, 9, 0]);
    expect(Array.from(Q)).toEqual([0, 0, 5, 0]);
    resolveClaims(Z, Q, 4, [], [], []);
    expect(Array.from(Z)).toEqual([0, 0, 9, 0]);
  });

  it("claims in a step: equal deposits tie, the larger tag wins, only its own deposit counts; an unowned cell stays unowned with no deposit", () => {
    const s = createWorld(phys({ trailOwner: "id" }));
    clump(s, 5, 5);
    step(s);
    expect(s.Z![at(5, 5)]).toBe(4); // ids 0..3, tags 1..4
    expect(s.Q![at(5, 5)]).toBe(3);
    expect(s.P[at(5, 5)]).toBe(12);
    expect(validateState(s)).toEqual([]);
    const idle = createWorld(phys({ trailOwner: "id", maxDeposit: 0 }));
    clump(idle, 5, 5);
    step(idle);
    expect(sum(idle.Z!)).toBe(0);
    expect(sum(idle.Q!)).toBe(0);
  });

  it("gid ownership tags by genotype id", () => {
    const s = createWorld(phys({ trailOwner: "gid" }));
    clump(s, 5, 5);
    s.gid[0] = 40; s.nextGid = 100;
    step(s);
    expect(s.Z![at(5, 5)]).toBe(41); // gid 40 + 1 beats gids 1..3 (ids 0..3 had gids 0..3, now 40, 1, 2, 3)
    expect(s.Q![at(5, 5)]).toBe(3);
  });

  it("a stranger's deposit adds to P only; the owner's adds to Q; Q decays and the owner is cleared at 0", () => {
    const foreign = createWorld(phys({ trailOwner: "id" }));
    clump(foreign, 5, 5);
    foreign.nextId = 100; foreign.Z![at(5, 5)] = 100; foreign.Q![at(5, 5)] = 5; foreign.P[at(5, 5)] = 5; retake(foreign);
    step(foreign);
    expect(foreign.Z![at(5, 5)]).toBe(100);
    expect(foreign.Q![at(5, 5)]).toBe(5);
    expect(foreign.P[at(5, 5)]).toBe(17);
    const own = createWorld(phys({ trailOwner: "id" }));
    clump(own, 5, 5);
    own.Z![at(5, 5)] = 3; own.Q![at(5, 5)] = 5; own.P[at(5, 5)] = 5; retake(own); // tag 3 is id 2
    step(own);
    expect(own.Z![at(5, 5)]).toBe(3);
    expect(own.Q![at(5, 5)]).toBe(8);
    expect(own.P[at(5, 5)]).toBe(17);
    // Decay: with pDecay 65535 nearly all trail goes, the owner label goes with the last of Q, and Q <= P holds.
    const dec = createWorld(small({ trailOwner: "id", founders: 0, nutrient0: 0, light: 0, pDecay: 65535 }));
    dec.nextId = 100;
    for (let k = 0; k < 300; k++) { dec.P[k] = 1 + (k % 9); dec.Q![k] = 1 + (k % 5) % (1 + (k % 9)); dec.Z![k] = 1 + (k % 50); }
    retake(dec);
    for (let t = 0; t < 12; t++) { step(dec); expect(validateState(dec)).toEqual([]); }
    expect(sum(dec.Q!)).toBeLessThan(5);
    for (let k = 0; k < dec.Z!.length; k++) expect(dec.Z![k] === 0).toBe(dec.Q![k] === 0);
  });

  it("Q <= P survives decay: Q - f(Q) <= P - f(P) for every Q <= P over random cells, draws and rates", () => {
    let r = 12345;
    const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r; };
    for (let n = 0; n < 40000; n++) {
      const P = rnd() % (n % 7 === 0 ? 2 ** 31 : 3000), Q = rnd() % (P + 1), k = rnd() % 65536, d = rnd();
      const dp = Math.min(P, mulFrac(P, k, 16, d)), dq = Math.min(Q, mulFrac(Q, k, 16, d));
      expect(Q - dq).toBeLessThanOrEqual(P - dp);
    }
  });

  it("the eating gate zeroes r before it is stored or summed: a defended cell gives strangers nothing and A never underflows", () => {
    const build = (over: Partial<MyceliumConfig>, A: number, Q: number) => {
      const s = createWorld(phys({ trailOwner: "id", ...over }));
      clump(s, 5, 5);
      s.A[at(5, 5)] = A; s.Z![at(5, 5)] = 1; s.Q![at(5, 5)] = Q; s.P[at(5, 5)] = Q; // owner is id 0
      retake(s);
      return s;
    };
    // theta 10, Q 10: ids 1..3 are refused; the owner takes its 15 of 40.
    const a = build({ ownerDefend: 10 }, 40, 10);
    step(a);
    expect(a.A[at(5, 5)]).toBe(25);
    // Q 9 < theta: not defended, contended 60 against 40, each gets floor(15 * 40 / 60) = 10.
    const b = build({ ownerDefend: 10 }, 40, 9);
    step(b);
    expect(b.A[at(5, 5)]).toBe(0);
    // The gate off (no key): same as the undefended arm.
    const c = build({}, 40, 10);
    step(c);
    expect(c.A[at(5, 5)]).toBe(0);
    // The cell holds exactly what the owner asks (15): a gate that only skipped the sum would let the strangers take 45 more and wrap A.
    const d = build({ ownerDefend: 1 }, 15, 10);
    step(d);
    expect(d.A[at(5, 5)]).toBe(0);
    expect(matterTotal(d)).toBe(d.matter0);
    expect(energyTotal(d)).toBe(d.energy0 + d.totals.lightIn - d.totals.heat);
    expect(d.totals.contended).toBe(0);
    // Strangers' masses did not grow by eating: a refused particle's body only changes by deposit and excretion.
    const e = build({ ownerDefend: 1 }, 15, 10);
    const e0 = Array.from(e.M.subarray(0, 4));
    step(e);
    for (let i = 1; i < 4; i++) expect(e.M[i]).toBeLessThanOrEqual(e0[i]);
    expect(validateState(a)).toEqual([]);
  });

  it("in a running world with ownerDefend 1, strangers do stand on defended cells (the gate is exercised) and both ledgers stay exact", () => {
    const s = createWorld(owned({ ownerDefend: 1 }));
    let defendedStranger = 0;
    for (let t = 0; t < 200; t++) {
      for (let i = 0; i < s.n; i++) {
        const ci = (s.y[i] >>> 8) * 48 + (s.x[i] >>> 8);
        const z = s.Z![ci];
        if (z !== 0 && z !== s.id[i] + 1 && s.Q![ci] >= 1) defendedStranger++;
      }
      step(s);
      expect(matterTotal(s)).toBe(s.matter0);
      expect(energyTotal(s)).toBe(s.energy0 + s.totals.lightIn - s.totals.heat);
    }
    expect(defendedStranger).toBeGreaterThan(0);
  });

  it("the gate is exact at theta: Q = theta - 1 does not defend, Q = theta does", () => {
    const run = (Q: number) => {
      const s = createWorld(phys({ trailOwner: "id", ownerDefend: 7 }));
      clump(s, 5, 5);
      s.A[at(5, 5)] = 40; s.Z![at(5, 5)] = 1; s.Q![at(5, 5)] = Q; s.P[at(5, 5)] = Q; retake(s);
      step(s);
      return s.A[at(5, 5)];
    };
    expect(run(6)).toBe(0);
    expect(run(7)).toBe(25);
    expect(run(200)).toBe(25);
  });

  it("owner conduit moves A faster only across same-owner edges, by min(Q, Q, cap) * g >> 4 (capped at 128)", () => {
    const eastA = (over: Partial<MyceliumConfig>, mutate?: (s: MyceliumState) => void) => {
      const s = createWorld(small({ founders: 0, nutrient0: 0, light: 0, pDecay: 0, trailOwner: "id", ...over }));
      s.A[at(10, 20)] = 20000;
      for (let x = 0; x < 48; x++) { s.P[at(x, 20)] = 255; s.Q![at(x, 20)] = 255; s.Z![at(x, 20)] = 7; }
      s.nextId = 100;
      mutate?.(s);
      retake(s);
      step(s);
      expect(matterTotal(s)).toBe(s.matter0);
      return s.A[at(11, 20)];
    };
    const off = eastA({}), g0 = eastA({ ownerConduit: 0 }), full = eastA({ ownerConduit: 255 });
    const capped = eastA({ ownerConduit: 255, ownerConduitCap: 1 });
    const strangers = eastA({ ownerConduit: 255 }, (s) => { s.Z![at(11, 20)] = 8; });
    const weak = eastA({ ownerConduit: 255 }, (s) => { s.Q![at(11, 20)] = 1; });
    expect(g0).toBe(off);
    expect(full).toBeGreaterThan(off);
    expect(capped).toBeGreaterThan(off);
    expect(capped).toBeLessThan(full);
    expect(strangers).toBe(off);
    expect(weak).toBe(capped); // min(255, 1, 255) * 255 >> 4 equals cap 1
    expect(ownerRate(40, 255, 255, 7, 7, 255, 255)).toBe(128);
    expect(ownerRate(40, 255, 1, 7, 7, 255, 255)).toBe(55);
    expect(ownerRate(40, 255, 255, 7, 8, 255, 255)).toBe(40);
    expect(ownerRate(40, 255, 255, 0, 0, 255, 255)).toBe(40);
    expect(ownerRate(40, 9, 255, 3, 3, 2 ** 31, 5)).toBe(40 + ((5 * 9) >>> 4));
    expect(ownerRate(40, 255, 255, 3, 4, 9, 9)).toBe(ownerRate(40, 255, 255, 4, 3, 9, 9));
  });

  it("passive owner planes leave A, C, P, the particles and the totals byte-identical to the keyless run", () => {
    for (const mode of ["id", "gid"] as const) {
      const a = createWorld(small()), b = createWorld(small({ trailOwner: mode }));
      for (let t = 0; t < 300; t++) { step(a); step(b); }
      expect(Array.from(b.A)).toEqual(Array.from(a.A));
      expect(Array.from(b.C)).toEqual(Array.from(a.C));
      expect(Array.from(b.P)).toEqual(Array.from(a.P));
      expect(b.n).toBe(a.n);
      for (const f of ["id", "parent", "gid", "x", "y", "M", "E", "age"] as const) expect(Array.from(b[f].subarray(0, b.n))).toEqual(Array.from(a[f].subarray(0, a.n)));
      expect(Array.from(b.genome.subarray(0, b.n * 160))).toEqual(Array.from(a.genome.subarray(0, a.n * 160)));
      expect(b.totals).toEqual(a.totals);
      expect(sum(b.Q!)).toBeGreaterThan(0);
      expect(validateState(b)).toEqual([]);
    }
  });

  it("ledgers close every step for passive, E, C, EC, ghost, id, gid, toll, public conduit beside E, low mutation, and all three families together", () => {
    const configs: Partial<MyceliumConfig>[] = [
      { trailOwner: "id" }, { trailOwner: "gid" },
      { trailOwner: "id", ownerDefend: 1 }, { trailOwner: "gid", ownerDefend: 6 },
      { trailOwner: "id", ownerConduit: 64 }, { trailOwner: "gid", ownerConduit: 255, ownerConduitCap: 3 },
      { trailOwner: "id", ownerDefend: 4, ownerConduit: 32 },
      { trailOwner: "gid", ownerDefend: 4, ownerConduit: 32, ownerGhost: 24 },
      { trailOwner: "gid", ownerDefend: 4, ownerConduit: 32, moveCost: 12, trailMoveDiscount: 64, trailDiscountMode: "toll" },
      { trailOwner: "id", ownerDefend: 4, trailConduit: 16 },
      { trailOwner: "gid", ownerDefend: 4, ownerConduit: 32, mutRate: 4096 },
      { trailOwner: "id", ownerDefend: 2, ownerConduit: 64, heredity: "blocked" },
      { trailOwner: "id", ownerDefend: 2, ownerConduit: 64, lightPattern: "gradient", trailInit: 16, trailInitPattern: "rows", trailFreeLayer: 16 },
      { trailOwner: "gid", ownerDefend: 3, trailConduit: 40, trailConduitGhost: 12, trailInit: 24, trailInitPattern: "lattice", trailFreeLayer: 8, pDecay: 66 },
    ];
    for (const over of configs) runChecked(small(over), 150);
  });

  it("each owner rule is not a no-op in a running world: E, C and the ghost each change the state against the passive run", () => {
    const run = (over: Partial<MyceliumConfig>) => {
      const s = createWorld(owned(over));
      for (let t = 0; t < 250; t++) step(s);
      return s;
    };
    const passive = run({}), e = run({ ownerDefend: 1 }), cc = run({ ownerConduit: 255 }), ec = run({ ownerDefend: 1, ownerConduit: 255 });
    const gh = run({ ownerDefend: 1, ownerConduit: 255, ownerGhost: 24 });
    const d = (x: MyceliumState) => Array.from(x.A).join() + "|" + Array.from(x.E.subarray(0, x.n)).join();
    expect(d(e)).not.toBe(d(passive));
    expect(d(cc)).not.toBe(d(passive));
    expect(d(ec)).not.toBe(d(e));
    expect(d(gh)).not.toBe(d(ec));
  });

  it("checkpoints with Z and Q round-trip and resume equals the continuous run; validateState rejects broken planes", () => {
    const s = createWorld(owned({ ownerDefend: 2, ownerConduit: 64, trailFreeLayer: 8 }));
    for (let t = 0; t < 60; t++) step(s);
    expect(sum(s.Q!)).toBeGreaterThan(0);
    const d = decode(encode(s));
    expect(Array.from(d.Z!)).toEqual(Array.from(s.Z!));
    expect(Array.from(d.Q!)).toEqual(Array.from(s.Q!));
    expect(stateDigest(d)).toBe(stateDigest(s));
    for (let t = 0; t < 60; t++) { step(s); step(d); }
    expect(stateDigest(d)).toBe(stateDigest(s));
    const bad = (f: (x: MyceliumState) => void, frag: string) => {
      const x = decode(encode(s));
      f(x);
      expect(validateState(x).some((b) => b.includes(frag)), frag).toBe(true);
    };
    const cell = Array.from(s.Q!).findIndex((q) => q > 0);
    bad((x) => { x.Q![cell] = x.P[cell] + 1; }, "above trail");
    bad((x) => { x.Q![cell] = 0; }, "disagree");
    bad((x) => { x.Z![cell] = 0; }, "disagree");
    bad((x) => { x.Z![cell] = x.nextId + 5; }, "beyond the ids issued");
    bad((x) => { delete x.Z; }, "Z and Q");
    const k = createWorld(small());
    k.Z = new Uint32Array(48 * 48); k.Q = new Uint32Array(48 * 48);
    expect(validateState(k).some((b) => b.includes("require trailOwner"))).toBe(true);
  });
});
