import { describe, expect, it } from 'vitest';
import {
  DG_MAX_SPECIES,
  DG_SCALE,
  DropGenesKernel,
  defaultDropGenesConfig,
  dgLadderTables,
  packDropGenesParams,
  type DropGenesConfig,
} from '../src/dropgenes/kernel.ts';

/** Everything that moves wall or soluble matter switched off, so one rule can be read at a time. */
const still: Partial<DropGenesConfig> = {
  width: 16, height: 16, seed: 3, kLight: 0, kDeg: 0, kSyn: 0, mobility: 0, diffW: 0, noiseAmp: 0, diffF: 0, diffA: 0, kDecT: 0, diffT: 0, kRep: 0,
};
function bare(ov: Partial<DropGenesConfig>): DropGenesKernel {
  const k = new DropGenesKernel(defaultDropGenesConfig({ ...still, ...ov }));
  k.A.fill(0);
  k.F.fill(0);
  return k;
}
/** Tiles on a 4-spaced lattice: their 3x3 patches and hop targets never overlap. */
function lattice(k: DropGenesKernel): number[] {
  const out: number[] = [];
  for (let y = 1; y < k.cfg.height; y += 4) for (let x = 1; x < k.cfg.width; x += 4) out.push(y * k.cfg.width + x);
  return out;
}
/** A small ladder world with three founder spots, every founder copy at `level`. */
function world(ov: Partial<DropGenesConfig>, level = 0): DropGenesKernel {
  const k = new DropGenesKernel(defaultDropGenesConfig({ width: 32, height: 32, seed: 5, genes: 2, ladderLevels: 5, ...ov }));
  k.seedDroplet(8, 8, 3);
  k.seedDroplet(24, 8, 3);
  k.seedDroplet(16, 24, 3);
  k.seedTemplatesAtLevel(2, level, 0.125);
  return k;
}
function perSpecies(k: DropGenesKernel): number[] {
  const S = k.p.species;
  const out = new Array<number>(S).fill(0);
  for (let i = 0; i < k.nTiles; i++) for (let s = 0; s < S; s++) out[s] += k.T[i * S + s];
  return out;
}

describe('droplet genes ladder (heritable trait)', () => {
  it('is off by default: the default configuration has no ladder key and packs to an empty ladder', () => {
    const cfg = defaultDropGenesConfig({ genes: 2 });
    expect('ladderLevels' in cfg).toBe(false);
    expect('mutLevel' in cfg).toBe(false);
    expect('ladderNeutral' in cfg).toBe(false);
    const p = packDropGenesParams(cfg);
    expect(p.ladderLevels).toBe(0);
    expect(p.mutLevelQ16).toBe(0);
    expect(p.ladderRateQ16).toEqual([]);
    expect(p.species).toBe(3);
  });

  it('rate and function tables: level 0 is the base gene, the top level is the parasite (twice the rate, no function)', () => {
    const p5 = packDropGenesParams(defaultDropGenesConfig({ genes: 2, ladderLevels: 5, geneSat: 2 }));
    expect(p5.species).toBe(10);
    expect(p5.kRepQ16).toBe(13107);
    // floor(13107 * (4 + v) / 4), the same for both genes
    expect(p5.ladderRateQ16).toEqual([13107, 16383, 19660, 22937, 26214, 13107, 16383, 19660, 22937, 26214]);
    expect(p5.ladderRateQ16[4]).toBe(2 * p5.kRepQ16);
    expect(p5.ladderRateQ16[4]).toBe(p5.kRepParQ16); // the first rung's parasite rate at the default kRep
    expect(p5.ladderWeight).toEqual([4, 3, 2, 1, 0, 4, 3, 2, 1, 0]);
    expect(p5.ladderSatW).toBe(8);
    const p8 = packDropGenesParams(defaultDropGenesConfig({ genes: 2, ladderLevels: 8, geneSat: 3 }));
    expect(p8.species).toBe(16);
    expect(p8.ladderRateQ16.slice(0, 8)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((v) => Math.floor((13107 * (7 + v)) / 7)));
    expect(p8.ladderWeight.slice(8)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(p8.ladderSatW).toBe(21);
    // Rates rise and function falls with every step up.
    for (let v = 1; v < 8; v++) {
      expect(p8.ladderRateQ16[v]).toBeGreaterThan(p8.ladderRateQ16[v - 1]);
      expect(p8.ladderWeight[v]).toBeLessThan(p8.ladderWeight[v - 1]);
    }
  });

  it('neutral twin: every level has the base rate and full function', () => {
    const p = packDropGenesParams(defaultDropGenesConfig({ genes: 2, ladderLevels: 5, ladderNeutral: true, mutLevel: 0.01 }));
    expect(p.ladderNeutral).toBe(1);
    expect(p.ladderRateQ16).toEqual(new Array(10).fill(13107));
    expect(p.ladderWeight).toEqual(new Array(10).fill(4));
    expect(p.mutLevelQ16).toBe(655);
  });

  it('bounds: every rate fits Q16 up to kRep 0.5, species stay within the laid-out channels, bad settings are refused', () => {
    const top = packDropGenesParams(defaultDropGenesConfig({ genes: 1, ladderLevels: 17, kRep: 0.5 }));
    expect(Math.max(...top.ladderRateQ16)).toBe(65536);
    expect(top.species).toBe(DG_MAX_SPECIES);
    expect(DG_MAX_SPECIES).toBe(17); // 570 + s stays below the hop channels at 600 and above the parasite channels at 560, 561
    const bad = (ov: Partial<DropGenesConfig>) => () => packDropGenesParams(defaultDropGenesConfig({ genes: 2, ...ov }));
    expect(bad({ ladderLevels: 1 })).toThrow(/ladderLevels/);
    expect(bad({ ladderLevels: 2.5 })).toThrow(/ladderLevels/);
    expect(bad({ ladderLevels: 9 })).toThrow(/above 17/);
    expect(bad({ ladderLevels: 5, genes: 0 })).toThrow(/genes/);
    expect(bad({ ladderLevels: 5, mutPar: 1e-4 })).toThrow(/mutPar/);
    expect(bad({ ladderLevels: 5, kRep: 0.51 })).toThrow(/kRep/);
    expect(bad({ ladderLevels: 5, mutLevel: 1.5 })).toThrow(/mutLevel/);
    expect(bad({ ladderLevels: 5, mutLevel: -0.1 })).toThrow(/mutLevel/);
    expect(bad({ ladderLevels: 5, mutLevel: 1e-6 })).toThrow(/resolution/); // would round to no mutation at all
    expect(bad({ mutLevel: 0.01 })).toThrow(/need ladderLevels/);
    expect(bad({ ladderNeutral: true })).toThrow(/need ladderLevels/);
    expect(bad({ ladderLevels: 8, mutLevel: 1 })).not.toThrow();
    // dgLadderTables is what packDropGenesParams uses
    expect(dgLadderTables(defaultDropGenesConfig({ genes: 2, ladderLevels: 5 })).ladderWeight).toEqual([4, 3, 2, 1, 0, 4, 3, 2, 1, 0]);
  });

  it('seeding: seedTemplatesAtLevel puts every founder copy at one level and conserves matter; the first-rung seeder refuses a ladder world', () => {
    const k = new DropGenesKernel(defaultDropGenesConfig({ width: 32, height: 32, genes: 2, ladderLevels: 5 }));
    k.seedDroplet(8, 8, 3);
    const before = k.totalMatter();
    const tiles = k.seedTemplatesAtLevel(2, 3);
    expect(tiles).toBeGreaterThan(0);
    expect(k.totalMatter()).toBe(before);
    expect(perSpecies(k)).toEqual([0, 0, 0, 2 * tiles, 0, 0, 0, 0, 2 * tiles, 0]);
    expect(() => k.seedTemplates(2)).toThrow(/seedTemplatesAtLevel/);
    expect(() => k.seedTemplatesAtLevel(2, 5)).toThrow(/level/);
    expect(() => k.seedTemplatesAtLevel(2, -1)).toThrow(/level/);
    const plain = new DropGenesKernel(defaultDropGenesConfig({ width: 32, height: 32, genes: 2 }));
    expect(() => plain.seedTemplatesAtLevel(2, 0)).toThrow(/ladderLevels/);
  });

  it.each([
    ['gated, mutation 1/64', { gated: true, mutLevel: 1 / 64 }, 0],
    ['ungated, mutation 1/64, founders at level 3', { gated: false, mutLevel: 1 / 64 }, 3],
    ['neutral twin, mutation 1/16', { gated: true, mutLevel: 1 / 16, ladderNeutral: true }, 2],
    ['every new copy mutates', { gated: true, mutLevel: 1 }, 1],
    ['8 levels, 4096 sites, saturation 1024', { gated: false, mutLevel: 0.25, ladderLevels: 8, capPerTile: 4096, geneSat: 1024 }, 6],
    ['one gene, 17 levels, kRep 0.5', { gated: true, mutLevel: 0.5, genes: 1, ladderLevels: 17, kRep: 0.5 }, 8],
  ] as const)('conserves matter exactly at every step: %s', (_name, ov, level) => {
    const k = world(ov, level);
    const total = k.totalMatter();
    for (let t = 0; t < 400; t++) {
      k.step();
      if (k.totalMatter() !== total) throw new Error(`matter changed at step ${t + 1}`);
    }
    // An underflow of a u32 count would show as a count above the world's whole matter.
    for (let i = 0; i < k.T.length; i++) expect(k.T[i]).toBeLessThanOrEqual(Number(total));
  });

  it('conserves matter with a tile holding far more copies than sites, at the largest weights', () => {
    // kSyn 0: with this much fuel, synthesis would take the wall past the first rung's DG_WALL_MAX guard.
    const k = new DropGenesKernel(defaultDropGenesConfig({ width: 8, height: 8, seed: 2, genes: 2, ladderLevels: 8, mutLevel: 1, geneSat: 1024, capPerTile: 4096, initMatterPerTile: 16_000_000, kSyn: 0, kDeg: 0 }));
    k.seedDroplet(4, 4, 2, 4);
    const S = k.p.species;
    for (let i = 0; i < k.nTiles; i++) {
      if (k.W[i] === 0) continue;
      for (let s = 0; s < S; s++) {
        k.T[i * S + s] += 400_000;
        k.A[i] -= 400_000;
      }
    }
    const total = k.totalMatter();
    for (let t = 0; t < 60; t++) {
      k.step();
      expect(k.totalMatter()).toBe(total);
    }
    let copies = 0;
    for (let i = 0; i < k.T.length; i++) copies += k.T[i];
    expect(copies).toBeGreaterThan(1_000_000); // the big counts were still there to be summed, hopped and mutated
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const run = (seed: number) => {
      const k = world({ seed, mutLevel: 1 / 64 });
      for (let t = 0; t < 300; t++) k.step();
      return k.digest();
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it('with mutLevel 0 no copy ever changes level', () => {
    const k = world({ mutLevel: 0 }, 1);
    for (let t = 0; t < 300; t++) k.step();
    const n = perSpecies(k);
    expect(n[1]).toBeGreaterThan(0);
    expect(n[6]).toBeGreaterThan(0);
    expect(n.filter((_, s) => s % 5 !== 1)).toEqual(new Array(8).fill(0));
    expect(Array.from(k.ladderMutUp).concat(Array.from(k.ladderMutDown))).toEqual(new Array(20).fill(0));
  });

  it('mutation moves new copies only, one level, up or down: with mutLevel 1 every new copy is one level away', () => {
    const k = bare({ genes: 1, ladderLevels: 5, capPerTile: 4096, kRep: 0.2, mutLevel: 1 });
    const S = k.p.species;
    k.W.fill(DG_SCALE);
    k.F.fill(10000);
    for (let i = 0; i < k.nTiles; i++) k.T[i * S + 2] = 100;
    k.step();
    let fuelUsed = 0;
    let upTiles = 0;
    let downTiles = 0;
    for (let i = 0; i < k.nTiles; i++) {
      const born = 10000 - k.F[i];
      fuelUsed += born;
      expect(born).toBeGreaterThan(0);
      expect(k.T[i * S + 2]).toBe(100); // the templates stay; every new copy left level 2
      expect(k.T[i * S]).toBe(0);
      expect(k.T[i * S + 4]).toBe(0); // never two levels in one copy
      // all of a tile's mutants of one species go the same way
      expect([k.T[i * S + 1], k.T[i * S + 3]].sort((a, b) => a - b)).toEqual([0, born]);
      if (k.T[i * S + 3] > 0) upTiles++;
      else downTiles++;
    }
    expect(fuelUsed).toBe(k.ladderBirths[2]);
    expect(k.ladderMutUp[2] + k.ladderMutDown[2]).toBe(fuelUsed);
    // 256 tiles, each up or down by one hash bit
    expect(upTiles).toBeGreaterThan(96);
    expect(downTiles).toBeGreaterThan(96);
  });

  it('a move off either end of the ladder is dropped: level 0 only mutates up, the top level only down', () => {
    for (const [level, other] of [[0, 1], [4, 3]] as const) {
      const k = bare({ genes: 1, ladderLevels: 5, capPerTile: 4096, kRep: 0.2, mutLevel: 1 });
      const S = k.p.species;
      k.W.fill(DG_SCALE);
      k.F.fill(10000);
      for (let i = 0; i < k.nTiles; i++) k.T[i * S + level] = 100;
      k.step();
      const n = perSpecies(k);
      const births = k.ladderBirths[level];
      expect(n[level] + n[other]).toBe(100 * k.nTiles + births);
      expect(n.reduce((a, b) => a + b, 0)).toBe(100 * k.nTiles + births);
      // about half the tiles drew the direction that does not exist and kept their new copies
      expect(n[other] / births).toBeGreaterThan(0.38);
      expect(n[other] / births).toBeLessThan(0.62);
      if (level === 0) expect(k.ladderMutDown[0]).toBe(0);
      else expect(k.ladderMutUp[4]).toBe(0);
    }
  });

  it('mutation happens at the stated rate: mutLevel / 2 up and mutLevel / 2 down per new copy', () => {
    const mu = 1 / 16;
    const k = bare({ genes: 1, ladderLevels: 5, capPerTile: 4096, kRep: 0.05, mutLevel: mu, ladderNeutral: true });
    const S = k.p.species;
    k.W.fill(DG_SCALE);
    k.F.fill(60000);
    for (let i = 0; i < k.nTiles; i++) k.T[i * S + 2] = 20;
    for (let t = 0; t < 40; t++) k.step();
    // Births and mutants summed over every level and step (levels 1 to 3 hold almost all the copies).
    let births = 0;
    let up = 0;
    let down = 0;
    for (let s = 1; s <= 3; s++) {
      births += k.ladderBirths[s];
      up += k.ladderMutUp[s];
      down += k.ladderMutDown[s];
    }
    expect(births).toBeGreaterThan(20000);
    expect(up / births).toBeGreaterThan((mu / 2) * 0.85);
    expect(up / births).toBeLessThan((mu / 2) * 1.15);
    expect(down / births).toBeGreaterThan((mu / 2) * 0.85);
    expect(down / births).toBeLessThan((mu / 2) * 1.15);
    // The tally is the state: copies now at levels other than 2 came from mutation and their own copying.
    const n = perSpecies(k);
    expect(n[1] + n[3]).toBeGreaterThan(0);
    expect(k.p.mutLevelQ16).toBe(4096);
  });

  it('copy rates follow the table: level v copies (V - 1 + v) / (V - 1) times as fast as level 0', () => {
    const k = bare({ genes: 1, ladderLevels: 5, capPerTile: 4096, kRep: 0.2 });
    const S = k.p.species;
    k.W.fill(DG_SCALE);
    k.F.fill(10000);
    // one level per tile, in turn, so levels do not share a tile's sites unevenly
    for (let i = 0; i < k.nTiles; i++) k.T[i * S + (i % 5)] = 100;
    k.step();
    const births = perSpecies(k).map((n, s) => n - 100 * Math.floor((k.nTiles - s + 4) / 5));
    expect(births[0]).toBeGreaterThan(15 * 50); // about 19.5 births per tile
    for (let v = 1; v < 5; v++) {
      const perTile = (s: number) => births[s] / Math.floor((k.nTiles - s + 4) / 5);
      const ratio = perTile(v) / perTile(0);
      expect(ratio).toBeGreaterThan((4 + v) / 4 - 0.06);
      expect(ratio).toBeLessThan((4 + v) / 4 + 0.06);
    }
    // neutral twin: no level copies faster
    const nt = bare({ genes: 1, ladderLevels: 5, capPerTile: 4096, kRep: 0.2, ladderNeutral: true });
    nt.W.fill(DG_SCALE);
    nt.F.fill(10000);
    for (let i = 0; i < nt.nTiles; i++) nt.T[i * S + (i % 5)] = 100;
    nt.step();
    const nb = perSpecies(nt).map((n, s) => (n - 100 * Math.floor((nt.nTiles - s + 4) / 5)) / Math.floor((nt.nTiles - s + 4) / 5));
    for (let v = 1; v < 5; v++) {
      expect(nb[v] / nb[0]).toBeGreaterThan(0.95);
      expect(nb[v] / nb[0]).toBeLessThan(1.05);
    }
  });

  it('gene function follows the table: a copy at level v counts as (V - 1 - v) / (V - 1) of a copy, the top level as none', () => {
    /** Wall gained per tile with `n0` copies of gene 0 at level `v0` and `n1` copies of gene 1 at level `v1`. */
    const gain = (n0: number, v0: number, n1: number, v1: number, ov: Partial<DropGenesConfig> = {}) => {
      const k = bare({ genes: 2, ladderLevels: 5, geneSat: 2, kSyn: 1, ...ov });
      const S = k.p.species;
      const tiles = lattice(k);
      for (const i of tiles) {
        k.W[i] = 512;
        k.F[i] = 1000;
        k.T[i * S + v0] = n0;
        k.T[i * S + 5 + v1] = n1;
      }
      k.step();
      let g = 0;
      for (const i of tiles) g += k.W[i] - 512;
      return g / tiles.length;
    };
    const full = gain(2, 0, 2, 0);
    expect(full).toBeGreaterThan(200); // about 250 per tile, as in the first-rung test
    expect(gain(5, 0, 3, 0)).toBe(full); // saturated
    // two copies at level 2 count as one level-0 copy: half the saturation of 2
    expect(gain(2, 2, 2, 0) / full).toBeGreaterThan(0.45);
    expect(gain(2, 2, 2, 0) / full).toBeLessThan(0.55);
    // four copies at level 2, or eight at level 3, are worth two level-0 copies: full function
    expect(gain(4, 2, 2, 0)).toBe(full);
    expect(gain(8, 3, 8, 3)).toBe(full);
    // one copy at level 3 is a quarter of a copy: an eighth of saturation
    expect(gain(1, 3, 2, 0) / full).toBeGreaterThan(0.09);
    expect(gain(1, 3, 2, 0) / full).toBeLessThan(0.16);
    // the lower gene sets the function
    expect(gain(2, 0, 2, 2)).toBe(gain(2, 2, 2, 0));
    // the top level does nothing, however many copies
    expect(gain(50, 4, 2, 0)).toBe(0);
    expect(gain(2, 0, 50, 4)).toBe(0);
    expect(gain(0, 0, 2, 0)).toBe(0);
    // neutral twin: any level counts in full, the top level included
    expect(gain(2, 4, 2, 3, { ladderNeutral: true })).toBe(full);
    expect(gain(1, 4, 2, 0, { ladderNeutral: true }) / full).toBeGreaterThan(0.45);
    expect(gain(1, 4, 2, 0, { ladderNeutral: true }) / full).toBeLessThan(0.55);
  });

  it('gene function reads the 3x3 patch and sums a gene over its levels', () => {
    const gain = (dx: number, dy: number) => {
      const k = bare({ genes: 1, ladderLevels: 5, geneSat: 1, kSyn: 1 });
      const S = k.p.species;
      const tiles = lattice(k);
      for (const i of tiles) {
        k.W[i] = 512;
        k.F[i] = 1000;
        // 2 at level 2 (worth 1) here or on the neighbour, plus 1 at level 1 (worth 0.75) on the tile: 1.75 >= 1
        k.T[(i + dy * k.cfg.width + dx) * S + 2] = 1;
        k.T[i * S + 3] = 2;
      }
      k.step();
      let g = 0;
      for (const i of tiles) g += k.W[i] - 512;
      return g / tiles.length;
    };
    const near = gain(1, 1);
    expect(near).toBeGreaterThan(200);
    // two tiles away the level-2 copy is out of the patch: 2 copies at level 3 are worth 0.5 of saturation 1
    expect(gain(2, 0) / near).toBeGreaterThan(0.45);
    expect(gain(2, 0) / near).toBeLessThan(0.55);
  });

  it('a two-level ladder with one gene, no mutation and no top-level copies is the first-rung kernel with one gene, bit for bit', () => {
    // Level 0 = the gene (rate kRep, counted), level 1 = the parasite (rate 2 * kRep, not counted): the same
    // species layout, hash channels and arithmetic. With only level 0 present the service order has nothing to
    // order, so the two kernels must agree exactly. This ties the ladder path to the pinned first-rung path.
    // (With both species on a tile they differ on purpose: see the service-order test below.)
    const base = { width: 32, height: 32, seed: 7, genes: 1, capPerTile: 16, diffT: 0.1, geneSat: 2 };
    for (const gated of [true, false]) {
      const first = new DropGenesKernel(defaultDropGenesConfig({ ...base, gated, mutPar: 0 }));
      const ladder = new DropGenesKernel(defaultDropGenesConfig({ ...base, gated, ladderLevels: 2, mutLevel: 0 }));
      expect(ladder.p.ladderRateQ16).toEqual([first.p.kRepQ16, first.p.kRepParQ16]);
      for (const k of [first, ladder]) {
        k.seedDroplet(8, 8, 3);
        k.seedDroplet(24, 8, 3);
        k.seedDroplet(16, 24, 3);
      }
      first.seedTemplates(2, 0.125, 0);
      ladder.seedTemplatesAtLevel(2, 0, 0.125);
      for (let t = 1; t <= 600; t++) {
        first.step();
        ladder.step();
        if (t % 100 === 0) {
          expect(ladder.digest()).toBe(first.digest());
          expect(Array.from(ladder.T)).toEqual(Array.from(first.T));
        }
      }
      const n = perSpecies(first);
      expect(n[0]).toBeGreaterThan(0);
      expect(n[1]).toBe(0);
    }
  });

  it('service order is even-handed among the species present: under scarce fuel no level label is favoured in the neutral twin', () => {
    /** Share of the single copy each tile can make (one unit of fuel) that goes to each of the listed species. */
    const shares = (present: number[], ov: Partial<DropGenesConfig> = {}) => {
      const k = bare({ width: 32, height: 32, genes: 2, ladderLevels: 5, capPerTile: 4096, kRep: 0.2, ladderNeutral: true, ...ov });
      const S = k.p.species;
      k.W.fill(DG_SCALE);
      k.F.fill(1);
      for (let i = 0; i < k.nTiles; i++) for (const sp of present) k.T[i * S + sp] = 50;
      k.step();
      const n = perSpecies(k);
      const births = present.map((sp) => n[sp] - 50 * k.nTiles);
      expect(births.reduce((a, b) => a + b, 0)).toBe(k.nTiles); // every tile made exactly one copy
      return births.map((b) => b / k.nTiles);
    };
    // Two species, whatever their indices: each is served first on about half the tiles. (The first rung's
    // rotation from a hashed start would give 0.9 / 0.1 for species 0 and 1 of ten.)
    for (const pair of [[0, 1], [0, 4], [3, 4], [0, 9], [4, 5], [1, 8]]) {
      const [a, b] = shares(pair);
      expect(a).toBeGreaterThan(0.44);
      expect(a).toBeLessThan(0.56);
      expect(a + b).toBeCloseTo(1, 12);
    }
    // Three and five species: about a third and a fifth each, the middle ones included.
    for (const sh of shares([0, 1, 2])) {
      expect(sh).toBeGreaterThan(0.28);
      expect(sh).toBeLessThan(0.39);
    }
    for (const sh of shares([0, 1, 2, 3, 4])) {
      expect(sh).toBeGreaterThan(0.15);
      expect(sh).toBeLessThan(0.25);
    }
    // Scarce sites instead of scarce fuel (one free site per tile): the same.
    const sites = (() => {
      const k = bare({ width: 32, height: 32, genes: 2, ladderLevels: 5, capPerTile: 101, kRep: 0.5, ladderNeutral: true });
      const S = k.p.species;
      k.W.fill(DG_SCALE);
      k.F.fill(1000);
      for (let i = 0; i < k.nTiles; i++) { k.T[i * S + 1] = 50; k.T[i * S + 2] = 50; }
      for (let t = 0; t < 40; t++) {
        k.step();
        // take the new copy away again so that every step has exactly one free site
        for (let i = 0; i < k.nTiles; i++) {
          for (const sp of [1, 2]) {
            const extra = k.T[i * S + sp] - 50;
            if (extra > 0) { k.T[i * S + sp] = 50; (k as unknown as { tally: number[] }).tally ??= [0, 0, 0]; (k as unknown as { tally: number[] }).tally[sp] += extra; }
          }
        }
      }
      return (k as unknown as { tally: number[] }).tally;
    })();
    expect(sites[1] + sites[2]).toBeGreaterThan(2000);
    expect(sites[1] / (sites[1] + sites[2])).toBeGreaterThan(0.46);
    expect(sites[1] / (sites[1] + sites[2])).toBeLessThan(0.54);
  });

  it('service order: with unequal counts, what a species gets does not depend on which levels its competitors hold', () => {
    // One gene, four levels, neutral, 96 sites, kRep 0.5, fuel 5 per tile. A species with 4 copies asks for 1
    // new copy and one with 20 asks for 5 (exactly, no rounding), so fuel runs out after the first big one.
    // Species 0 has 4 copies in both layouts; only the levels of the others differ. With a uniformly random
    // order its expected share is the same either way (a ring order in index gave 0.25 against 0.375).
    const birthsOfSpecies0 = (counts: number[]) => {
      const k = bare({ width: 32, height: 32, genes: 1, ladderLevels: 4, capPerTile: 96, kRep: 0.5, ladderNeutral: true });
      const S = k.p.species;
      k.W.fill(DG_SCALE);
      k.F.fill(5);
      for (let i = 0; i < k.nTiles; i++) for (let sp = 0; sp < S; sp++) k.T[i * S + sp] = counts[sp];
      k.step();
      expect(k.nTiles * 5 - k.F.reduce((a, b) => a + b, 0)).toBe(k.nTiles * 5); // every tile used all its fuel
      return (perSpecies(k)[0] - counts[0] * k.nTiles) / k.nTiles;
    };
    const a = birthsOfSpecies0([4, 20, 4, 20]);
    const b = birthsOfSpecies0([4, 4, 20, 20]);
    const c = birthsOfSpecies0([4, 20, 20, 4]);
    // With every order equally likely: no fuel is left once a big one has been served, so species 0 gets its
    // copy exactly when it is served before both big ones, 1 time in 3.
    for (const v of [a, b, c]) {
      expect(v).toBeGreaterThan(1 / 3 - 0.045);
      expect(v).toBeLessThan(1 / 3 + 0.045);
    }
    expect(Math.abs(a - b)).toBeLessThan(0.06);
    expect(Math.abs(a - c)).toBeLessThan(0.06);
  });

  it('service order does not leak into the first rung: the same scarce-fuel set-up there still rotates from a hashed start', () => {
    // Three first-rung species with only 0 and 1 present: species 0 is served first for two of the three starts.
    const k = bare({ width: 32, height: 32, genes: 2, capPerTile: 4096, kRep: 0.2, kRepPar: 0.2 });
    const S = k.p.species;
    k.W.fill(DG_SCALE);
    k.F.fill(1);
    for (let i = 0; i < k.nTiles; i++) { k.T[i * S] = 50; k.T[i * S + 1] = 50; }
    k.step();
    const n = perSpecies(k);
    const first = (n[0] - 50 * k.nTiles) / k.nTiles;
    expect(first).toBeGreaterThan(0.6);
    expect(first).toBeLessThan(0.73);
  });

  it('inside one sealed tile a higher level takes over; in the neutral twin it does not', () => {
    const topShareAfter = (neutral: boolean) => {
      const k = bare({ genes: 1, ladderLevels: 5, capPerTile: 64, kRep: 0.2, kDecT: 0.02, ladderNeutral: neutral, kLight: 0.5, seed: 4 });
      const S = k.p.species;
      k.W.fill(DG_SCALE);
      k.A.fill(4000);
      for (let i = 0; i < k.nTiles; i++) {
        k.T[i * S] = 20;
        k.T[i * S + 3] = 20;
      }
      // wall is solid (1.0), so light makes no fuel there: give fuel directly and top it up
      for (let t = 0; t < 1500; t++) {
        for (let i = 0; i < k.nTiles; i++) {
          k.F[i] += k.A[i];
          k.A[i] = 0;
        }
        k.step();
      }
      const n = perSpecies(k);
      return n[3] / (n[0] + n[3]);
    };
    expect(topShareAfter(false)).toBeGreaterThan(0.95);
    expect(topShareAfter(true)).toBeGreaterThan(0.3);
    expect(topShareAfter(true)).toBeLessThan(0.7);
  });
});
