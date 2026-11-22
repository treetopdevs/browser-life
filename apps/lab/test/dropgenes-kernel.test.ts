import { describe, expect, it } from 'vitest';
import { DropletKernelRef, KERNEL_MOTIFS, defaultDropletKernelConfig } from '../src/oligomer/droplets-kernel.ts';
import {
  DG_SCALE,
  DropGenesKernel,
  defaultDropGenesConfig,
  dgGateQ10,
  packDropGenesParams,
  type DropGenesConfig,
} from '../src/dropgenes/kernel.ts';

/** A small world with a few seeded spots and (when genes > 0) every gene on every wall tile. */
function build(ov: Partial<DropGenesConfig>, perGene = 2, parasite = 0): DropGenesKernel {
  const k = new DropGenesKernel(defaultDropGenesConfig({ width: 32, height: 32, seed: 5, ...ov }));
  k.seedDroplet(8, 8, 3);
  k.seedDroplet(24, 8, 3);
  k.seedDroplet(16, 24, 3);
  if (k.p.species > 0) k.seedTemplates(perGene, 0.125, parasite);
  return k;
}

describe('droplet genes sandbox kernel', () => {
  it.each([
    ['Phase B2 defaults (rings)', { kDeg: 0.06, diffW: 0.04, diffF: 0.2 }],
    ['spot regime defaults', {}],
    ['no noise, no Cahn-Hilliard mobility', { noiseAmp: 0, mobility: 0 }],
  ] as const)('with templates off equals the B2 reference on one wall motif, bit for bit: %s', (_name, ov) => {
    const base = { width: 32, height: 32, seed: 9 };
    const mine = new DropGenesKernel(defaultDropGenesConfig({ ...base, genes: 0, ...ov }));
    const c = mine.cfg;
    const ref = new DropletKernelRef(
      defaultDropletKernelConfig({
        ...base,
        bulkB: c.bulkB,
        kappa: c.kappa,
        mobility: c.mobility,
        diffW: c.diffW,
        noiseAmp: c.noiseAmp,
        diffF: c.diffF,
        diffA: c.diffA,
        kLight: c.kLight,
        kSyn: c.kSyn,
        kDeg: c.kDeg,
        kInfect: 0,
        mutPhage: 0,
        mutMotif: 0,
      }),
    );
    for (const [x, y] of [[8, 8], [24, 10], [15, 25]] as const) {
      mine.seedDroplet(x, y, 3);
      ref.seedDroplet(x, y, 3, 0, 0.85);
    }
    for (let t = 1; t <= 400; t++) {
      mine.step();
      ref.step();
      if (t % 100 === 0) {
        expect(Array.from(mine.A)).toEqual(Array.from(ref.A));
        expect(Array.from(mine.F)).toEqual(Array.from(ref.F));
        const refW0 = Array.from({ length: mine.nTiles }, (_, i) => ref.W[i * KERNEL_MOTIFS]);
        expect(Array.from(mine.W)).toEqual(refW0);
        let wall = 0;
        for (let i = 0; i < mine.nTiles; i++) wall += mine.W[i];
        expect(wall).toBeGreaterThan(0); // the comparison is not between two empty worlds
      }
    }
  });

  it.each([
    ['gated, parasite', { gated: true, mutPar: 0.002 }],
    ['ungated, parasite', { gated: false, mutPar: 0.002 }],
    ['gated, small capacity', { gated: true, capPerTile: 3, mutPar: 0.01 }],
    ['fast everything', { gated: false, kRep: 1, kRepPar: 1, kDecT: 0.5, diffT: 1, mutPar: 0.05 }],
  ] as const)('conserves matter exactly on every step: %s', (_name, ov) => {
    const k = build({ genes: 4, ...ov }, 2, 1);
    let sawTemplates = false;
    for (let t = 0; t < 400; t++) {
      k.step();
      expect(k.totalMatter()).toBe(k.initTotalMatter);
      if (t === 20) sawTemplates = k.T.some((v) => v > 0);
    }
    expect(sawTemplates).toBe(true);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const run = (seed: number) => {
      const k = build({ genes: 3, mutPar: 0.001, seed });
      for (let t = 0; t < 300; t++) k.step();
      return k.digest();
    };
    expect(run(5)).toBe(run(5));
    expect(run(5)).not.toBe(run(6));
  });

  it('gate: a template never reaches a tile whose wall has stayed at or below gateLo', () => {
    const k = build({ genes: 2, gated: true, mutPar: 0.001 });
    const lo = k.p.gateLoInt;
    const everAbove = new Uint8Array(k.nTiles);
    const S = k.p.species;
    for (let t = 0; t < 600; t++) {
      // A hop into a tile needs that tile's wall above gateLo at the time of the hop (before the wall flux).
      // The wall the gate reads is the post-chemistry wall of the same step, which only falls from the
      // start-of-step value by hydrolysis or rises by synthesis from wall already there, so record both.
      for (let i = 0; i < k.nTiles; i++) if (k.W[i] > lo) everAbove[i] = 1;
      k.step();
      for (let i = 0; i < k.nTiles; i++) {
        if (everAbove[i]) continue;
        let tot = 0;
        for (let s = 0; s < S; s++) tot += k.T[i * S + s];
        if (tot > 0 && k.W[i] <= lo) throw new Error(`template on never-walled tile ${i} at step ${t}`);
      }
    }
    // and the ungated twin does put templates on tiles that never had wall
    const u = build({ genes: 2, gated: false });
    const everU = new Uint8Array(u.nTiles);
    let leaked = false;
    for (let t = 0; t < 300 && !leaked; t++) {
      for (let i = 0; i < u.nTiles; i++) if (u.W[i] > lo) everU[i] = 1;
      u.step();
      for (let i = 0; i < u.nTiles && !leaked; i++) {
        if (everU[i] || u.W[i] > lo) continue;
        for (let s = 0; s < S; s++) if (u.T[i * S + s] > 0) leaked = true;
      }
    }
    expect(leaked).toBe(true);
  });

  it('gate openness is 0 at gateLo, 1024 at gateHi and monotone between', () => {
    expect(dgGateQ10(30, 31, 128)).toBe(0);
    expect(dgGateQ10(31, 31, 128)).toBe(0);
    expect(dgGateQ10(128, 31, 128)).toBe(1024);
    expect(dgGateQ10(4000, 31, 128)).toBe(1024);
    let prev = 0;
    for (let w = 31; w <= 128; w++) {
      const g = dgGateQ10(w, 31, 128);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it('a world missing one essential gene loses its wall; with every gene it keeps it', () => {
    const wall = (k: DropGenesKernel) => {
      let s = 0;
      for (let i = 0; i < k.nTiles; i++) s += k.W[i];
      return s;
    };
    const full = build({ genes: 2 });
    const missing = new DropGenesKernel(defaultDropGenesConfig({ width: 32, height: 32, seed: 5, genes: 2 }));
    missing.seedDroplet(8, 8, 3);
    missing.seedDroplet(24, 8, 3);
    missing.seedDroplet(16, 24, 3);
    missing.seedTemplates(2, 0.125, 0, [0]);
    for (let t = 0; t < 1500; t++) {
      full.step();
      missing.step();
    }
    expect(wall(missing)).toBeLessThan(DG_SCALE);
    expect(wall(full)).toBeGreaterThan(20 * DG_SCALE);
  });

  it('templates only copy up to the shared capacity and the parasite cannot copy without wall', () => {
    const k = build({ genes: 2, kDecT: 0, diffT: 0, capPerTile: 8 }, 1, 1);
    const S = k.p.species;
    const tileTotal = (i: number) => {
      let tot = 0;
      for (let s = 0; s < S; s++) tot += k.T[i * S + s];
      return tot;
    };
    // with decay, hops and parasite origin off, a tile's copies can only rise by copying
    let grew = false;
    let parasiteGrew = false;
    const par0 = Array.from({ length: k.nTiles }, (_, i) => k.T[i * S + 2]);
    for (let t = 0; t < 200; t++) {
      // sites at the wall the copy step reads (start of step), plus what was already there
      const held = Array.from({ length: k.nTiles }, (_, i) => tileTotal(i));
      const before = Array.from({ length: k.nTiles }, (_, i) => {
        const wc = Math.min(k.W[i], DG_SCALE);
        return Math.max(held[i], (wc * 8) >>> 10);
      });
      k.step();
      for (let i = 0; i < k.nTiles; i++) {
        const tot = tileTotal(i);
        expect(tot).toBeLessThanOrEqual(before[i]);
        if (tot > held[i]) grew = true;
        if (k.T[i * S + 2] > par0[i]) parasiteGrew = true;
      }
    }
    expect(grew).toBe(true); // the bound is not met vacuously by a world where nothing copies
    expect(parasiteGrew).toBe(true);
  });

  // Hand-built states for single rules. Wall flux, light, hydrolysis and synthesis are switched off unless a test
  // needs them, so the wall a rule reads holds still. The arrays are set directly, so these tests do not check
  // conservation against initTotalMatter.
  const still: Partial<DropGenesConfig> = {
    width: 32, height: 32, seed: 7, mobility: 0, diffW: 0, noiseAmp: 0, kLight: 0, kDeg: 0, kSyn: 0,
    kRep: 0, kDecT: 0, diffT: 0, mutPar: 0,
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

  it('kRepPar follows 2 * kRep unless it is given', () => {
    expect(defaultDropGenesConfig().kRepPar).toBe(0.4);
    expect(defaultDropGenesConfig({ kRep: 0.1 }).kRepPar).toBe(0.2);
    expect(defaultDropGenesConfig({ kRep: 0.3 }).kRepPar).toBe(0.6);
    expect(defaultDropGenesConfig({ kRep: 0.1, kRepPar: 0.35 }).kRepPar).toBe(0.35);
    // 2 * 0.6 is above the copy-rate bound: refused, not silently capped
    expect(() => packDropGenesParams(defaultDropGenesConfig({ kRep: 0.6 }))).toThrow();
  });

  it('parasite origin: mutPar 1 converts exactly one essential copy per tile, whichever genes the tile holds', () => {
    for (const layout of [[3, 3], [0, 3], [3, 0]]) {
      const k = bare({ genes: 2, mutPar: 1 });
      const S = k.p.species;
      for (let i = 0; i < k.nTiles; i++) { k.T[i * S] = layout[0]; k.T[i * S + 1] = layout[1]; }
      k.step();
      let hit0 = 0;
      let hit1 = 0;
      for (let i = 0; i < k.nTiles; i++) {
        expect(k.T[i * S + 2]).toBe(1);
        expect(k.T[i * S] + k.T[i * S + 1]).toBe(layout[0] + layout[1] - 1);
        if (k.T[i * S] < layout[0]) hit0++;
        else hit1++;
      }
      if (layout[0] > 0 && layout[1] > 0) {
        // the gene is chosen by hash, so both genes are hit
        expect(hit0).toBeGreaterThan(k.nTiles * 0.4);
        expect(hit1).toBeGreaterThan(k.nTiles * 0.4);
      }
    }
    // mutPar 0 never converts; a tile with no essential copy has nothing to convert
    const none = bare({ genes: 2, mutPar: 0 });
    const empty = bare({ genes: 2, mutPar: 1 });
    const S = none.p.species;
    for (let i = 0; i < none.nTiles; i++) { none.T[i * S] = 3; none.T[i * S + 1] = 3; }
    for (let t = 0; t < 20; t++) { none.step(); empty.step(); }
    for (let i = 0; i < none.nTiles; i++) expect(none.T[i * S + 2]).toBe(0);
    expect(empty.T.every((v) => v === 0)).toBe(true);
  });

  it('parasite origin fires at about mutPar per tile per step', () => {
    const k = bare({ genes: 2, mutPar: 0.05 });
    const S = k.p.species;
    for (let i = 0; i < k.nTiles; i++) { k.T[i * S] = 50; k.T[i * S + 1] = 50; }
    for (let t = 0; t < 4; t++) k.step();
    let par = 0;
    for (let i = 0; i < k.nTiles; i++) par += k.T[i * S + 2];
    const expected = 0.05 * 4 * k.nTiles; // 204.8, sd about 14
    expect(par).toBeGreaterThan(expected - 50);
    expect(par).toBeLessThan(expected + 50);
  });

  it('the parasite copies at about twice the gene rate', () => {
    const k = bare({ genes: 1, capPerTile: 4096, kRep: 0.2 });
    const S = k.p.species;
    k.W.fill(DG_SCALE);
    k.F.fill(10000);
    for (let i = 0; i < k.nTiles; i++) k.T[i * S + (i & 1)] = 100;
    k.step();
    let gene = 0;
    let par = 0;
    for (let i = 0; i < k.nTiles; i++) {
      gene += k.T[i * S];
      par += k.T[i * S + 1];
    }
    const half = k.nTiles / 2;
    const ratio = (par - 100 * half) / (gene - 100 * half);
    expect(gene - 100 * half).toBeGreaterThan(half * 15); // about 19.5 births per tile
    expect(ratio).toBeGreaterThan(1.9);
    expect(ratio).toBeLessThan(2.1);
  });

  it('templates decay into A at kDecT with copying off', () => {
    const k = bare({ genes: 1, kDecT: 0.02 });
    const S = k.p.species;
    for (let i = 0; i < k.nTiles; i++) k.T[i * S] = 1000;
    k.step();
    let t = 0;
    let a = 0;
    for (let i = 0; i < k.nTiles; i++) { t += k.T[i * S] + k.T[i * S + 1]; a += k.A[i]; }
    const lost = 1000 * k.nTiles - t;
    expect(a).toBe(lost);
    expect(lost).toBeGreaterThan(0.02 * 1000 * k.nTiles * 0.98);
    expect(lost).toBeLessThan(0.02 * 1000 * k.nTiles * 1.02);
  });

  it('a hop across a half-open edge moves about half as many copies as across an open one', () => {
    const moved = (wall: number) => {
      const k = bare({ genes: 1, diffT: 0.2 });
      const S = k.p.species;
      k.W.fill(wall);
      const src = lattice(k);
      for (const i of src) k.T[i * S] = 1000;
      k.step();
      let m = 0;
      for (const i of src) m += 1000 - k.T[i * S];
      return m;
    };
    const p = packDropGenesParams(defaultDropGenesConfig());
    const open = moved(p.gateHiInt + 50);
    const half = moved((p.gateLoInt + p.gateHiInt) >> 1);
    expect(open).toBeGreaterThan(0);
    expect(half / open).toBeGreaterThan(0.42);
    expect(half / open).toBeLessThan(0.58);
    expect(moved(p.gateLoInt)).toBe(0);
  });

  it('gene function scales wall synthesis by min(copies, geneSat) / geneSat and needs every gene, gene 0 included', () => {
    const gain = (g0: number, g1: number) => {
      const k = bare({ genes: 2, geneSat: 2, kSyn: 1 });
      const S = k.p.species;
      const tiles = lattice(k);
      for (const i of tiles) {
        k.W[i] = 512;
        k.F[i] = 1000;
        k.T[i * S] = g0;
        k.T[i * S + 1] = g1;
      }
      k.step();
      let g = 0;
      for (const i of tiles) g += k.W[i] - 512;
      return g / tiles.length;
    };
    const full = gain(2, 2);
    expect(full).toBeGreaterThan(200); // about 250 per tile
    expect(gain(3, 5)).toBe(full); // saturated
    expect(gain(1, 2) / full).toBeGreaterThan(0.45);
    expect(gain(1, 2) / full).toBeLessThan(0.55);
    expect(gain(2, 1) / full).toBeGreaterThan(0.45);
    expect(gain(2, 1) / full).toBeLessThan(0.55);
    expect(gain(0, 2)).toBe(0);
    expect(gain(2, 0)).toBe(0);
  });

  it('gene function reads the 3x3 patch: a copy on a diagonal neighbour counts, one two tiles away does not', () => {
    const gain = (dx: number, dy: number) => {
      const k = bare({ genes: 1, geneSat: 1, kSyn: 1 });
      const tiles = lattice(k);
      for (const i of tiles) {
        k.W[i] = 512;
        k.F[i] = 1000;
        k.T[i + dy * k.cfg.width + dx] = 1; // species 0 of a neighbouring, wall-less tile (S = 2)
      }
      // T is indexed tile * S; redo the placement with the species stride
      k.T.fill(0);
      for (const i of tiles) k.T[(i + dy * k.cfg.width + dx) * k.p.species] = 1;
      k.step();
      let g = 0;
      for (const i of tiles) g += k.W[i] - 512;
      return g / tiles.length;
    };
    expect(gain(0, 0)).toBeGreaterThan(200);
    expect(gain(1, 1)).toBe(gain(0, 0));
    expect(gain(-1, 0)).toBe(gain(0, 0));
    expect(gain(2, 0)).toBe(0);
    expect(gain(0, -2)).toBe(0);
  });

  it('nothing copies on a tile with no wall, parasite included, however much fuel is there', () => {
    const k = bare({ genes: 2, kRep: 0.5, kDecT: 0 });
    const S = k.p.species;
    const tiles = lattice(k);
    for (const i of tiles) {
      k.F[i] = 5000;
      for (let s = 0; s < S; s++) k.T[i * S + s] = 3;
    }
    for (let t = 0; t < 50; t++) k.step();
    for (const i of tiles) for (let s = 0; s < S; s++) expect(k.T[i * S + s]).toBe(3);
    // and with wall there, the same tiles do copy
    const w = bare({ genes: 2, kRep: 0.5, kDecT: 0, capPerTile: 64 });
    for (const i of tiles) {
      w.W[i] = 1024;
      w.F[i] = 5000;
      for (let s = 0; s < S; s++) w.T[i * S + s] = 3;
    }
    for (let t = 0; t < 50; t++) w.step();
    let grew = 0;
    for (const i of tiles) for (let s = 0; s < S; s++) grew += w.T[i * S + s] - 3;
    expect(grew).toBeGreaterThan(0);
  });

  it('rejects out-of-range configuration', () => {
    const bad = (ov: Partial<DropGenesConfig>) => () => packDropGenesParams(defaultDropGenesConfig(ov));
    expect(bad({ genes: 17 })).toThrow();
    expect(bad({ genes: -1 })).toThrow();
    expect(bad({ capPerTile: 0 })).toThrow();
    expect(bad({ geneSat: 0 })).toThrow();
    expect(bad({ gateLo: 0.2, gateHi: 0.1 })).toThrow();
    expect(bad({ diffW: 0.3 })).toThrow();
    expect(bad({ bulkB: 4 })).toThrow(); // would wrap a signed product in pass 2
    // wall above the bound the flux arithmetic is proven for is refused, at seeding and in step()
    const k = new DropGenesKernel(defaultDropGenesConfig({ width: 8, height: 8, initMatterPerTile: 250000 }));
    expect(() => k.seedDroplet(1, 1, 0, 200)).toThrow();
    k.W[9] = 70 * DG_SCALE;
    expect(() => k.step()).toThrow(/above the bound/);
    // synthesis that would carry a tile from the bound to above it is caught in the same step, before the flux
    const g = new DropGenesKernel(defaultDropGenesConfig({ width: 8, height: 8, initMatterPerTile: 250000, kDeg: 0, kSyn: 1 }));
    g.W[9] = 64 * DG_SCALE;
    g.F[9] = 60000;
    expect(() => g.step()).toThrow(/above the bound/);
    expect(bad({ kappa: 3 })).toThrow();
    expect(bad({ mobility: 0.5 })).toThrow();
    expect(bad({ kRep: 1.5 })).toThrow();
    expect(bad({ width: 2 })).toThrow();
  });
});
