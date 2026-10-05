import { describe, expect, it } from "vitest";
import {
  CH,
  G,
  GENOME_CHANNELS,
  M3_FOUNDERS,
  buildWorld,
  cellCount,
  cloneState,
  defaultConfig,
  encodeGenome,
  founderGenome,
  validateState,
  worldW,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { MOT_ZERO, RefSim } from "@bl/sim-ref";
import {
  POND_COLUMNS,
  applyPondCycle,
  assaySeed,
  assertConserved,
  cloneWorld,
  contRows,
  dominantGenome,
  drawPacketCentre,
  foundersWorld,
  ledgerEnergy,
  packetWindow,
  pondConfig,
  pondMatter,
  pondTraits,
  randomKey,
  weightedPick,
} from "../lib/ponds.ts";

const genomeA = founderGenome(M3_FOUNDERS[2]);

/** An empty world (nutrient only) of side x side ponds, mutation off. */
function emptyWorld(side: number, seed = 7, nutrient = 32): WorldState {
  return buildWorld(pondConfig(side, seed, 0), { nutrient, founders: [] });
}

const cellIdx = (s: WorldState, pond: number, x: number, y: number) => {
  const cfg = s.cfg;
  const tx = pond % cfg.tilesX;
  const ty = Math.floor(pond / cfg.tilesX);
  return (ty * cfg.tileH + y) * worldW(cfg) + tx * cfg.tileW + x;
};

interface Plant {
  B?: number;
  P?: number;
  E?: number;
  C?: number;
  S?: number;
  /** Lineage low word (high word 0); genome words come from a fixed genome, so equal ids share words. */
  lin?: number;
}

/** Sets a cell of a crafted world, taking its B+P+C out of the cell's nutrient so matter stays put. */
function plant(s: WorldState, pond: number, x: number, y: number, p: Plant): number {
  const n = cellCount(s.cfg);
  const i = cellIdx(s, pond, x, y);
  const set = (ch: number, v: number | undefined) => v !== undefined && (s.cells[ch * n + i] = v);
  set(CH.B, p.B);
  set(CH.P, p.P);
  set(CH.E, p.E);
  set(CH.C, p.C);
  set(CH.S, p.S);
  if (p.lin !== undefined) {
    const w = encodeGenome(genomeA, 0, p.lin);
    for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = w[g];
  }
  return i;
}

const total = (s: WorldState, ch: number, cells: number[]) => {
  const n = cellCount(s.cfg);
  return cells.reduce((a, i) => a + s.cells[ch * n + i], 0);
};

/** A stepped clone world: 2x2 ponds of the ancestor grown by the CPU reference (slow, so computed once and cloned). */
let steppedWorld: WorldState | null = null;
function stepped(): WorldState {
  if (!steppedWorld) {
    const sim = new RefSim(cloneWorld(pondConfig(2, 11, 0), genomeA));
    sim.run(20);
    steppedWorld = sim.state;
  }
  return cloneState(steppedWorld);
}

const snapshot = (s: WorldState) => ({ cells: s.cells.slice(), genome: s.genome.slice(), heatOut: s.heatOut, lightIn: s.lightIn, step: s.step });

describe("pondConfig and initial worlds", () => {
  it("keeps defaultConfig's mutation rate unless one is given", () => {
    expect(pondConfig(2, 5).mutRate).toBe(defaultConfig().mutRate);
    expect(pondConfig(2, 5, 0).mutRate).toBe(0);
    const c = pondConfig(2, 5);
    expect(c.tileW).toBe(64);
    expect(c.tilesX).toBe(2);
    expect(c.seed).toBe(5);
    expect(c.defaultMu).toBe(60);
  });

  it("cloneWorld puts the standard disc in every pond, one lineage per planting index", () => {
    const s = cloneWorld(pondConfig(2, 3), genomeA);
    expect(validateState(s)).toEqual([]);
    const n = cellCount(s.cfg);
    for (let p = 0; p < 4; p++) {
      const c = cellIdx(s, p, 32, 32);
      expect(s.genome[G.LIN_LO * n + c]).toBe(p + 1);
      expect(s.cells[CH.A * n + c]).toBe(32);
    }
    expect(pondTraits(s).every((t) => t > 0)).toBe(true);
  });

  it("foundersWorld plants the 12 founders round-robin", () => {
    const { state, plantingToFounder } = foundersWorld(pondConfig(4, 3, 0));
    expect(plantingToFounder).toEqual(Array.from({ length: 16 }, (_, t) => t % 12));
    expect(validateState(state)).toEqual([]);
    const n = cellCount(state.cfg);
    // Pond 13 got founder 1: lineage id (0, 14), mu and sigma of M3_FOUNDERS[1].
    const c = cellIdx(state, 13, 32, 32);
    expect(state.genome[G.LIN_LO * n + c]).toBe(14);
    expect(state.genome[G.PARAM0 * n + c] & 0xffff).toBe(M3_FOUNDERS[1].mu);
  });
});

describe("randomKey, weightedPick, assaySeed", () => {
  it("weightedPick is exact near 2^26 where a float product would not be", () => {
    for (const tot of [1, 2, 67_108_863, 67_108_864, 66_000_001]) {
      for (const [hi, lo] of [[0, 0], [1, 0x7ff], [0xffffffff, 0xffffffff], [0xdeadbeef, 0x12345678], [0x80000000, 0x800]]) {
        const want = Number((BigInt(hi) * 2097152n + BigInt(lo >>> 11)) % BigInt(tot));
        expect(weightedPick(hi, lo, tot)).toBe(want);
      }
    }
    expect(() => weightedPick(1, 1, 0)).toThrow();
  });

  it("randomKey is stable and depends on every argument", () => {
    const k = randomKey(1, 2, 3, 4);
    expect(randomKey(1, 2, 3, 4)).toBe(k);
    expect(new Set([k, randomKey(2, 2, 3, 4), randomKey(1, 3, 3, 4), randomKey(1, 2, 4, 4), randomKey(1, 2, 3, 5)]).size).toBe(5);
  });

  it("assaySeed is collision-free over the whole grid and asserts every field's range", () => {
    const seen = new Set<number>();
    let max = 0;
    for (let r = 0; r <= 4; r++)
      for (let h = 0; h <= 18; h++)
        for (let t = 0; t <= 1; t++)
          for (let v = 0; v <= 4; v++)
            for (let s = 0; s <= 9; s++) {
              const x = assaySeed(r, h, t, v, s);
              seen.add(x);
              max = Math.max(max, x);
            }
    expect(seen.size).toBe(5 * 19 * 2 * 5 * 10);
    expect(max).toBe(4_844_690);
    expect(assaySeed(0, 0, 0, 0, 0)).toBe(4_820_001);
    expect(() => assaySeed(5, 0, 0, 0, 0)).toThrow();
    expect(() => assaySeed(0, 19, 0, 0, 0)).toThrow();
    expect(() => assaySeed(0, 0, 2, 0, 0)).toThrow();
    expect(() => assaySeed(0, 0, 0, 5, 0)).toThrow();
    expect(() => assaySeed(0, 0, 0, 0, 10)).toThrow();
    expect(() => assaySeed(0, 0, 0, 0, -1)).toThrow();
    expect(() => assaySeed(0.5, 0, 0, 0, 0)).toThrow();
  });
});

describe("measurements", () => {
  it("pondMatter and pondTraits are per pond and threshold at B+P >= 48", () => {
    const s = emptyWorld(2);
    plant(s, 1, 3, 4, { B: 30, P: 18 }); // 48: counts
    plant(s, 1, 5, 4, { B: 47 }); // dust
    plant(s, 2, 0, 0, { B: 100 });
    expect(pondTraits(s)).toEqual([0, 48, 100, 0]);
    expect(pondMatter(s)).toEqual([131072, 131072 + 47 + 48, 131072 + 100, 131072]);
  });

  it("dominantGenome picks the largest trait mass, ties to the smallest (hi, lo), and null when nothing is eligible", () => {
    const s = emptyWorld(2);
    expect(dominantGenome(s)).toBeNull();
    plant(s, 0, 1, 1, { B: 47, lin: 5 }); // dust: never counts
    expect(dominantGenome(s)).toBeNull();
    plant(s, 0, 2, 2, { B: 60, lin: 9 });
    plant(s, 1, 2, 2, { B: 60, lin: 4 });
    const tie = dominantGenome(s)!;
    expect([tie.hi, tie.lo]).toEqual([0, 4]);
    expect(tie.words.length).toBe(GENOME_CHANNELS);
    expect(tie.words[G.LIN_LO]).toBe(4);
    plant(s, 2, 2, 2, { B: 30, P: 31, lin: 9 }); // lineage 9 now has 121
    expect(dominantGenome(s)!.lo).toBe(9);
    // Restricting to ponds 1 and 3 leaves only lineage 4.
    expect(dominantGenome(s, [1, 3])!.lo).toBe(4);
    expect(dominantGenome(s, [3])).toBeNull();
    // A hi word breaks a tie after lo would: (0, 9) < (1, 4).
    const n = cellCount(s.cfg);
    const i = plant(s, 3, 0, 0, { B: 121, lin: 4 });
    s.genome[G.LIN_HI * n + i] = 1;
    const t2 = dominantGenome(s)!;
    expect([t2.hi, t2.lo]).toEqual([0, 9]);
  });
});

describe("packetWindow and drawPacketCentre", () => {
  it("wraps inside the donor tile for a centre at a tile edge", () => {
    const s = emptyWorld(2);
    const donor = 3;
    const centre = cellIdx(s, donor, 0, 63);
    const w = packetWindow(s, donor, 3, centre);
    expect(w.length).toBe(9);
    const W = worldW(s.cfg);
    const local = w.map((i) => [(i % W) - 64, Math.floor(i / W) - 64]);
    for (const [x, y] of local) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(64);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(64);
    }
    // Row-major over (j, i): y in {62, 63, 0}, x in {63, 0, 1}.
    expect(local).toEqual([[63, 62], [0, 62], [1, 62], [63, 63], [0, 63], [1, 63], [63, 0], [0, 0], [1, 0]]);
  });

  it("uses offsets -floor(k/2) .. k-1-floor(k/2)", () => {
    const s = emptyWorld(2);
    const W = worldW(s.cfg);
    const w = packetWindow(s, 0, 4, cellIdx(s, 0, 10, 10));
    expect([w[0] % W, Math.floor(w[0] / W)]).toEqual([8, 8]);
    expect([w[15] % W, Math.floor(w[15] / W)]).toEqual([11, 11]);
    expect(() => packetWindow(s, 0, 65, 0)).toThrow();
    expect(packetWindow(s, 0, 64, 0).length).toBe(4096);
  });

  it("draws an eligible cell in proportion to B+P and null for an ineligible pond", () => {
    const s = emptyWorld(2);
    expect(drawPacketCentre(s, 0, 1, 1, 0)).toBeNull();
    const a = plant(s, 0, 5, 5, { B: 50 });
    const b = plant(s, 0, 9, 9, { B: 150 });
    plant(s, 0, 20, 20, { B: 47 }); // dust: weight 0
    let hitsB = 0;
    for (let slot = 0; slot < 400; slot++) {
      const c = drawPacketCentre(s, 0, 1, 1, slot)!;
      expect([a, b]).toContain(c);
      if (c === b) hitsB++;
    }
    expect(hitsB).toBeGreaterThan(240); // expected 300 of 400
    expect(hitsB).toBeLessThan(360);
    // The draw is exactly the specified walk: value mod 200 over raster order, first cumulative weight above it.
    const v = weightedPick(randomKey(1, 1, 7, 3), randomKey(1, 1, 7, 4), 200);
    expect(drawPacketCentre(s, 0, 1, 1, 7)).toBe(v < 50 ? a : b);
  });
});

describe("applyPondCycle", () => {
  /** Ponds 0..3 of side 2: pond 0 has a heavy cell with light neighbours; the rest are empty. */
  function heavyDonor(): WorldState {
    const s = emptyWorld(2);
    plant(s, 0, 10, 10, { B: 100, E: 300, lin: 1 });
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]])
      plant(s, 0, 10 + dx, 10 + dy, { B: 10, P: 3, E: 5, lin: 1 });
    return s;
  }

  it("restores every pond's matter to Mr and closes the energy ledger exactly (stepped world)", () => {
    const pre = stepped();
    const n = cellCount(pre.cfg);
    // Stir S and C in so heat has every term.
    pre.cells[CH.S * n + 5] = 7;
    pre.cells[CH.C * n + 6] = 9;
    const Mr = pondMatter(pre);
    for (const arm of ["scaf", "rand"] as const) {
      const before = ledgerEnergy(pre);
      const res = applyPondCycle(pre, 1, arm, 5, Mr);
      expect(pondMatter(res.state)).toEqual(Mr);
      expect(ledgerEnergy(res.state)).toBe(before);
      expect(res.state.step).toBe(pre.step);
      expect(res.state.flux).toEqual(pre.flux);
      expect(res.state.heatOut).toBe(pre.heatOut + res.heat);
      expect(res.state.lightIn).toBe(pre.lightIn + res.light);
      expect(validateState(res.state)).toEqual([]);
      expect(res.ended).toBe(false);
      expect(res.rows.length).toBe(4);
    }
  });

  it("books heat and light by the protocol formulas", () => {
    const pre = heavyDonor();
    const cfg = pre.cfg;
    const n = cellCount(cfg);
    plant(pre, 1, 4, 4, { C: 11, S: 6, E: 3 }); // waste, signal and a loose E pool: ground up, not landed
    // Independent heat: gross content above nutrient of every cell of the pre-cycle world.
    let heat = 0n;
    for (let i = 0; i < n; i++) {
      const c = (ch: number) => BigInt(pre.cells[ch * n + i]);
      heat += (BigInt(cfg.eB) - BigInt(cfg.eA)) * c(CH.B) + (BigInt(cfg.eP) - BigInt(cfg.eA)) * c(CH.P) + (BigInt(cfg.eC) - BigInt(cfg.eA)) * c(CH.C) + c(CH.E) + c(CH.S);
    }
    const Mr = pondMatter(pre);
    const res = applyPondCycle(pre, 1, "scaf", 3, Mr);
    expect(res.heat).toBe(heat);
    // Light: every recipient landed the 3x3 packet around the single eligible cell, all retained.
    const win = packetWindow(pre, 0, 3, cellIdx(pre, 0, 10, 10));
    let per = 0n;
    for (const i of win)
      per += (BigInt(cfg.eB) - BigInt(cfg.eA)) * BigInt(pre.cells[CH.B * n + i]) + (BigInt(cfg.eP) - BigInt(cfg.eA)) * BigInt(pre.cells[CH.P * n + i]) + BigInt(pre.cells[CH.E * n + i]);
    expect(res.light).toBe(4n * per);
    expect(res.rows.map((r) => r.light)).toEqual([0, 1, 2, 3].map(() => per.toString()));
    expect(res.rows.reduce((a, r) => a + BigInt(r.heat), 0n)).toBe(heat);
    expect(ledgerEnergy(res.state)).toBe(ledgerEnergy(pre));
    expect(per).toBeGreaterThan(0n);
    expect(heat).toBeGreaterThan(per);
  });

  it("copies with replacement: one donor feeds every recipient the identical packet", () => {
    const pre = heavyDonor();
    const Mr = pondMatter(pre);
    const res = applyPondCycle(pre, 1, "scaf", 3, Mr);
    expect(res.donors).toEqual([0]);
    const n = cellCount(pre.cfg);
    const src = packetWindow(pre, 0, 3, cellIdx(pre, 0, 10, 10));
    for (let r = 0; r < 4; r++) {
      expect(res.rows[r].donor).toBe(0);
      const dst = packetWindow(res.state, r, 3, cellIdx(res.state, r, 32, 32));
      dst.forEach((d, q) => {
        for (const ch of [CH.B, CH.P, CH.E, CH.MOT]) expect(res.state.cells[ch * n + d]).toBe(pre.cells[ch * n + src[q]]);
        for (let g = 0; g < GENOME_CHANNELS; g++) expect(res.state.genome[g * n + d]).toBe(pre.genome[g * n + src[q]]);
      });
      // Nothing outside the packet: total B in the pond is the packet's.
      const all = Array.from({ length: n }, (_, i) => i).filter((i) => pondOf(res.state, i) === r);
      expect(total(res.state, CH.B, all)).toBe(total(pre, CH.B, src));
      expect(total(res.state, CH.C, all)).toBe(0);
      expect(total(res.state, CH.S, all)).toBe(0);
      expect(res.rows[r].cx).toBe(10);
      expect(res.rows[r].cy).toBe(10);
      expect(res.rows[r].landed).toBe(9);
      expect(res.rows[r].truncated).toBe(0);
      expect(res.rows[r].packetLineages).toBe(1);
      expect([res.rows[r].domHi, res.rows[r].domLo, res.rows[r].domShare]).toEqual([0, 1, 1]);
    }
  });

  it("lands the centre cell at the recipient centre for odd and even k", () => {
    for (const k of [1, 2, 3, 4, 5, 8, 63, 64]) {
      const pre = heavyDonor();
      const res = applyPondCycle(pre, 1, "scaf", k, pondMatter(pre));
      const n = cellCount(pre.cfg);
      for (let r = 0; r < 4; r++) {
        expect(res.state.cells[CH.B * n + cellIdx(res.state, r, 32, 32)]).toBe(100);
        expect(res.rows[r].landed).toBe(k * k);
      }
      // The window's corners sit floor(k/2) before and k-1-floor(k/2) after the centre.
      const lo = 32 - (k >> 1), hi = lo + k - 1;
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThan(64);
      // A cell just outside the window (when there is room) holds no landed material.
      if (lo > 0) expect(res.state.cells[CH.E * n + cellIdx(res.state, 1, lo - 1, 32)]).toBe(0);
    }
  });

  it("truncates a packet that exceeds Mr in reverse raster order and flags it", () => {
    const pre = emptyWorld(2, 7, 0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) plant(pre, 0, 10 + dx, 10 + dy, { B: dx === 0 && dy === 0 ? 100 : 47, E: 2, lin: 1 });
    // Pond 0 also holds a nutrient reservoir; recipients hold only 200 quanta.
    for (let p = 1; p < 4; p++) plant(pre, p, 0, 0, { B: 0 });
    const n = cellCount(pre.cfg);
    for (let p = 1; p < 4; p++) {
      for (let i = 0; i < n; i++) if (pondOf(pre, i) === p) pre.cells[CH.A * n + i] = 0;
      pre.cells[CH.A * n + cellIdx(pre, p, 0, 0)] = 200;
    }
    const Mr = pondMatter(pre);
    expect(Mr.slice(1)).toEqual([200, 200, 200]);
    const res = applyPondCycle(pre, 1, "scaf", 3, Mr);
    // Only the centre is eligible, so every window is this one. Masses in raster order: 47 x4, 100, 47 x4 = 476.
    // Dropping from the end: cells 8, 7, 6, 5 leave 288, cell 4 (the 100) leaves 188 <= 200.
    for (let r = 1; r < 4; r++) {
      const row = res.rows[r];
      expect(row.truncated).toBe(1);
      expect(row.reqMass).toBe(476);
      expect(row.retMass).toBe(188);
      expect(row.retMass).toBeLessThanOrEqual(Mr[r]);
      expect(row.reqE).toBe(18);
      expect(row.retE).toBe(8);
      expect(row.landed).toBe(4);
      const win = packetWindow(res.state, r, 3, cellIdx(res.state, r, 32, 32));
      win.forEach((d, q) => {
        const kept = q < 4;
        expect(res.state.cells[CH.B * n + d]).toBe(kept ? 47 : 0);
        expect(res.state.cells[CH.E * n + d]).toBe(kept ? 2 : 0);
        expect(res.state.cells[CH.MOT * n + d]).toBe(MOT_ZERO);
        expect(res.state.genome[G.LIN_LO * n + d]).toBe(kept ? 1 : 0);
      });
    }
    // The donor's own row is not truncated (its Mr holds the whole packet).
    expect(res.rows[0].truncated).toBe(0);
    expect(pondMatter(res.state)).toEqual(Mr);
    expect(ledgerEnergy(res.state)).toBe(ledgerEnergy(pre));
    expect(validateState(res.state)).toEqual([]);
  });

  it("with no eligible pond clears every pond, preserves matter and ends the history", () => {
    const pre = emptyWorld(2);
    plant(pre, 0, 3, 3, { B: 47, E: 9, lin: 1 });
    plant(pre, 2, 3, 3, { C: 5, S: 4 });
    const Mr = pondMatter(pre);
    const res = applyPondCycle(pre, 4, "scaf", 5, Mr);
    expect(res.ended).toBe(true);
    expect(res.donors).toEqual([]);
    expect(res.light).toBe(0n);
    expect(res.rows.length).toBe(4);
    expect(res.rows.every((r) => r.donor === -1 && r.landed === 0)).toBe(true);
    expect(pondMatter(res.state)).toEqual(Mr);
    const n = cellCount(pre.cfg);
    for (const ch of [CH.B, CH.C, CH.P, CH.E, CH.S]) for (let i = 0; i < n; i++) expect(res.state.cells[ch * n + i]).toBe(0);
    for (let i = 0; i < n; i++) expect(res.state.cells[CH.MOT * n + i]).toBe(MOT_ZERO);
    expect(res.state.genome.every((w) => w === 0)).toBe(true);
    expect(ledgerEnergy(res.state)).toBe(ledgerEnergy(pre));
    expect(res.heat).toBeGreaterThan(0n);
    expect(validateState(res.state)).toEqual([]);
  });

  it("refills A uniformly with the remainder in raster order", () => {
    const pre = emptyWorld(2, 7, 1); // nutrient 1 per cell: 4096 per pond
    plant(pre, 0, 10, 10, { B: 100, lin: 1 });
    pre.cells[CH.A * cellCount(pre.cfg) + cellIdx(pre, 1, 0, 0)] += 3; // pond 1 matter 4099: remainder 3
    const Mr = pondMatter(pre);
    const res = applyPondCycle(pre, 1, "scaf", 1, Mr);
    const n = cellCount(pre.cfg);
    // Pond 1 keeps 4099 quanta and receives the 1x1 packet (100), so 3999 quanta of A spread over 4096 cells: 0 each,
    // plus one on each of the first 3999 cells in raster order.
    const a = (x: number, y: number) => res.state.cells[CH.A * n + cellIdx(res.state, 1, x, y)];
    const retained = res.rows[1].retMass;
    const rest = Mr[1] - retained;
    const each = Math.floor(rest / 4096), rem = rest - each * 4096;
    expect([retained, rest, each, rem]).toEqual([100, 3999, 0, 3999]);
    expect(a(0, 0)).toBe(1);
    expect(a(30, 62)).toBe(1); // raster index 3998
    expect(a(31, 62)).toBe(0); // raster index 3999
    expect(a(63, 63)).toBe(0);
    let sum = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) sum += a(x, y);
    expect(sum).toBe(rest);
  });

  it("allocates to D' < D donors when fewer ponds are eligible", () => {
    const pre = emptyWorld(4);
    plant(pre, 5, 20, 20, { B: 200, lin: 1 });
    plant(pre, 9, 30, 30, { B: 150, lin: 2 });
    const res = applyPondCycle(pre, 2, "scaf", 3, pondMatter(pre));
    expect(res.donors.length).toBe(2);
    expect([...res.donors].sort((a, b) => a - b)).toEqual([5, 9]);
    const count = (d: number) => res.rows.filter((r) => r.donor === d).length;
    expect(count(5)).toBe(8);
    expect(count(9)).toBe(8);
    expect(res.rows.map((r) => r.recipient)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    // With all 16 eligible, D = 4 donors each feed 4 recipients.
    const full = emptyWorld(4);
    for (let p = 0; p < 16; p++) plant(full, p, 20, 20, { B: 100 + p, lin: p + 1 });
    const r2 = applyPondCycle(full, 2, "rand", 3, pondMatter(full));
    expect(r2.donors.length).toBe(4);
    for (const d of r2.donors) expect(r2.rows.filter((r) => r.donor === d).length).toBe(4);
  });

  it("scaf takes the top-D eligible ponds by trait, ties by (key, index)", () => {
    const pre = emptyWorld(4);
    const trait = [300, 200, 300, 200, 200, 300, 200, 200, 200, 200, 100, 100, 0, 0, 100, 0];
    trait.forEach((t, p) => t > 0 && plant(pre, p, 20, 20, { B: t, lin: p + 1 }));
    const b = 3;
    const res = applyPondCycle(pre, b, "scaf", 3, pondMatter(pre));
    const seed = pre.cfg.seed;
    const expected = trait
      .map((t, p) => ({ p, t, key: randomKey(seed, b, p, 0) }))
      .filter((e) => e.t > 0)
      .sort((x, y) => y.t - x.t || x.key - y.key || x.p - y.p)
      .slice(0, 4)
      .map((e) => e.p);
    expect(res.donors).toEqual(expected);
    expect(res.donors.slice(0, 3).sort((a, c) => a - c)).toEqual([0, 2, 5]);
    expect(trait[res.donors[3]]).toBe(200);
    for (const d of res.donors) expect(trait[d]).toBeGreaterThan(0);
    // Equal keys fall back to the pond index: the sort above is total, so the order is fully determined.
    expect(new Set(res.donors).size).toBe(4);
  });

  it("rand takes the smallest keys among eligible ponds only", () => {
    const pre = emptyWorld(4);
    for (let p = 0; p < 6; p++) plant(pre, p, 20, 20, { B: 100 + 10 * p, lin: p + 1 });
    const Mr = pondMatter(pre);
    for (let b = 1; b <= 8; b++) {
      const res = applyPondCycle(pre, b, "rand", 3, Mr);
      const expected = [0, 1, 2, 3, 4, 5]
        .map((p) => ({ p, key: randomKey(pre.cfg.seed, b, p, 1) }))
        .sort((x, y) => x.key - y.key || x.p - y.p)
        .slice(0, 4)
        .map((e) => e.p);
      expect(res.donors).toEqual(expected);
      for (const d of res.donors) expect(d).toBeLessThan(6);
      for (const row of res.rows) expect(res.donors).toContain(row.donor);
    }
  });

  it("orders recipients by ascending purpose-2 key and gives position p donor p mod D'", () => {
    const pre = emptyWorld(2);
    for (let p = 0; p < 4; p++) plant(pre, p, 20, 20, { B: 100 + p, lin: p + 1 });
    const b = 5;
    const res = applyPondCycle(pre, b, "scaf", 3, pondMatter(pre));
    expect(res.donors).toEqual([3]); // D = 1
    const pre8 = emptyWorld(4);
    for (let p = 0; p < 16; p++) plant(pre8, p, 20, 20, { B: 100 + p, lin: p + 1 });
    const r8 = applyPondCycle(pre8, b, "scaf", 3, pondMatter(pre8));
    const order = Array.from({ length: 16 }, (_, p) => ({ p, key: randomKey(pre8.cfg.seed, b, p, 2) })).sort((x, y) => x.key - y.key || x.p - y.p);
    order.forEach((e, pos) => expect(r8.rows[e.p].donor).toBe(r8.donors[pos % 4]));
  });

  it("is deterministic and never mutates its input", () => {
    const pre = stepped();
    const Mr = pondMatter(pre);
    const before = snapshot(pre);
    const flux = pre.flux.slice();
    const a = applyPondCycle(pre, 1, "scaf", 5, Mr);
    const after = snapshot(pre);
    expect(after.cells).toEqual(before.cells);
    expect(after.genome).toEqual(before.genome);
    expect(after.heatOut).toBe(before.heatOut);
    expect(after.lightIn).toBe(before.lightIn);
    expect(pre.flux).toEqual(flux);
    const b = applyPondCycle(cloneState(pre), 1, "scaf", 5, Mr);
    expect(Buffer.from(a.state.cells.buffer)).toEqual(Buffer.from(b.state.cells.buffer));
    expect(Buffer.from(a.state.genome.buffer)).toEqual(Buffer.from(b.state.genome.buffer));
    expect(a.rows).toEqual(b.rows);
    expect(a.heat).toBe(b.heat);
    expect(a.light).toBe(b.light);
    expect(a.donors).toEqual(b.donors);
  });

  it("post-cycle worlds keep stepping with the ledger closed", () => {
    const pre = stepped();
    const start = ledgerEnergy(pre);
    const matter = Mr0(pre);
    const res = applyPondCycle(pre, 1, "scaf", 5, pondMatter(pre));
    assertConserved(res.state, matter, start);
    const sim = new RefSim(res.state);
    sim.run(5);
    assertConserved(sim.state, matter, start);
  });

  it("rows carry the census callback's numbers, -1 without it, and the pre-cycle lineage count", () => {
    const pre = heavyDonor2();
    const Mr = pondMatter(pre);
    const without = applyPondCycle(pre, 1, "scaf", 3, Mr);
    expect(without.rows.every((r) => r.recipientIndividuals === -1)).toBe(true);
    expect(without.rows.map((r) => r.recipientLineages)).toEqual([2, 0, 0, 0]);
    const withCensus = applyPondCycle(pre, 1, "scaf", 3, Mr, () => ({ individuals: [7, 8, 9, 10], lineages: [1, 1, 1, 1] }));
    expect(withCensus.rows.map((r) => r.recipientIndividuals)).toEqual([7, 8, 9, 10]);
    expect(withCensus.rows.map((r) => r.recipientTrait)).toEqual(pondTraits(pre));
    expect(withCensus.rows.every((r) => r.donorTrait === pondTraits(pre)[0] && r.step === pre.step && r.cycle === 1)).toBe(true);
    expect(Object.keys(withCensus.rows[0])).toEqual([...POND_COLUMNS]);
  });

  it("contRows summarises every pond with no packet", () => {
    const pre = heavyDonor2();
    const rows = contRows(pre, 6, () => ({ individuals: [1, 2, 3, 4], lineages: [9, 9, 9, 9] }));
    expect(rows.length).toBe(4);
    rows.forEach((r, p) => {
      expect(r.recipient).toBe(p);
      expect([r.donor, r.cx, r.cy, r.landed, r.reqMass, r.retMass, r.truncated, r.packetLineages]).toEqual([-1, -1, -1, 0, 0, 0, 0, 0]);
      expect(r.heat).toBe("0");
      expect(r.light).toBe("0");
      expect(r.recipientIndividuals).toBe(p + 1);
      expect(r.cycle).toBe(6);
    });
    expect(contRows(pre, 6).every((r) => r.recipientIndividuals === -1)).toBe(true);
  });

  it("throws when a pond's matter is not Mr", () => {
    const pre = heavyDonor2();
    const Mr = pondMatter(pre);
    Mr[2] += 1;
    expect(() => applyPondCycle(pre, 1, "scaf", 3, Mr)).toThrow(/pond 2/);
  });
});

describe("conservation checks", () => {
  it("assertConserved accepts the baseline and rejects a matter or ledger violation", () => {
    const s = emptyWorld(2);
    const matter = Mr0(s);
    const base = ledgerEnergy(s);
    expect(() => assertConserved(s, matter, base)).not.toThrow();
    const bad = cloneState(s);
    bad.cells[CH.A * cellCount(s.cfg)] += 1;
    expect(() => assertConserved(bad, matter, base)).toThrow(/matter/);
    const leak = cloneState(s);
    leak.heatOut += 1n;
    expect(() => assertConserved(leak, matter, base)).toThrow(/ledger/);
  });
});

// Helpers used above (function declarations hoist).
function pondOf(s: WorldState, i: number): number {
  const cfg: WorldConfig = s.cfg;
  const W = worldW(cfg);
  return Math.floor(Math.floor(i / W) / cfg.tileH) * cfg.tilesX + Math.floor((i % W) / cfg.tileW);
}

function Mr0(s: WorldState): bigint {
  return pondMatter(s).reduce((a, m) => a + BigInt(m), 0n);
}

/** Pond 0 with two lineages (one heavy, one light) and small pond dust elsewhere. */
function heavyDonor2(): WorldState {
  const s = emptyWorld(2);
  plant(s, 0, 10, 10, { B: 100, E: 200, lin: 1 });
  plant(s, 0, 40, 40, { B: 70, E: 100, lin: 2 });
  plant(s, 1, 5, 5, { B: 20, lin: 3 }); // dust, not eligible
  return s;
}
