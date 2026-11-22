import { describe, expect, it } from 'vitest';
import {
  DG_LINK_MAX_GENES,
  DG_SCALE,
  DropGenesKernel,
  defaultDropGenesConfig,
  dgDigest,
  packDropGenesLinkParams,
  type DropGenesConfig,
} from '../src/dropgenes/kernel.ts';
import { CompartmentTracker, addLinkedCounts, geneCopiesWithLinked, linkedCounts, linkedReadout } from '../src/dropgenes/observe.ts';

/**
 * Linked templates (docs/droplet-genes-linked-2026-11-21/PLAN.md): one test or more per rule.
 * The digests of the unlinked path are pinned in dropgenes-linked-pins.test.ts.
 */

/** A small world with three seeded spots. Linked worlds get `genomes` full templates on every wall tile. */
function build(ov: Partial<DropGenesConfig>, perGene = 0, genomes = 2, parasite = 0): DropGenesKernel {
  const k = new DropGenesKernel(defaultDropGenesConfig({ width: 32, height: 32, seed: 5, ...ov }));
  k.seedDroplet(8, 8, 3);
  k.seedDroplet(24, 8, 3);
  k.seedDroplet(16, 24, 3);
  if (perGene > 0 || parasite > 0) k.seedTemplates(perGene, 0.125, parasite);
  if (k.lk.on && genomes > 0) k.seedLinked(genomes);
  return k;
}

// Hand-built states for single rules, as in dropgenes-kernel.test.ts: wall flux, light, hydrolysis and synthesis
// are off unless a test needs them. The arrays are set directly, so these tests compare totalMatter() before
// and after instead of against initTotalMatter.
const still: Partial<DropGenesConfig> = {
  width: 32, height: 32, seed: 7, mobility: 0, diffW: 0, noiseAmp: 0, kLight: 0, kDeg: 0, kSyn: 0,
  kRep: 0, kDecT: 0, diffT: 0, mutPar: 0, linked: true,
};
function bare(ov: Partial<DropGenesConfig>): DropGenesKernel {
  const k = new DropGenesKernel(defaultDropGenesConfig({ ...still, ...ov }));
  k.A.fill(0);
  k.F.fill(0);
  return k;
}
const sum = (a: Uint32Array) => a.reduce((x, y) => x + y, 0);
/** Molecules of the linked template `m` over the whole world. */
function linkedCount(k: DropGenesKernel, m: number): number {
  let n = 0;
  for (let i = 0; i < k.nTiles; i++) n += k.L[i * k.lk.masks + m];
  return n;
}
/** Copies of gene g on tile i, single plus linked. */
function geneOnTile(k: DropGenesKernel, i: number, g: number): number {
  let n = k.T[i * k.p.species + g];
  for (const m of k.lk.multi) if ((m >>> g) & 1) n += k.L[i * k.lk.masks + m];
  return n;
}
const popcount = (m: number) => {
  let c = 0;
  for (; m; m >>>= 1) c += m & 1;
  return c;
};

describe('droplet genes: linked templates', () => {
  it('the link keys are optional and absent from the default configuration', () => {
    const keys = Object.keys(defaultDropGenesConfig());
    for (const k of ['linked', 'linkJoin', 'linkBreak', 'linkLoss', 'linkSites']) expect(keys).not.toContain(k);
    const off = new DropGenesKernel(defaultDropGenesConfig({ width: 8, height: 8, genes: 2 }));
    expect(off.lk.on).toBe(false);
    expect(off.L.length).toBe(0);
    expect(off.linkedMatter()).toBe(0n);
    expect(() => off.seedLinked(1)).toThrow();
  });

  it.each([
    ['K = 4, gated, parasite', { genes: 4, gated: true, mutPar: 0.002 }],
    ['K = 2, ungated, parasite, small capacity', { genes: 2, gated: false, mutPar: 0.01, capPerTile: 5 }],
    ['K = 3, fast everything', { genes: 3, gated: false, kRep: 0.5, kDecT: 0.05, diffT: 1, mutPar: 0.05 }],
  ] as const)('linking on with no linked template and no joining is the unlinked kernel bit for bit: %s', (_name, ov) => {
    const offK = build({ ...ov }, 2, 0, 0);
    const onK = build({ ...ov, linked: true, linkBreak: 0.5, linkLoss: 0.5 }, 2, 0, 0);
    let parasiteSeen = false;
    for (let t = 1; t <= 500; t++) {
      offK.step();
      onK.step();
      if (t % 25 === 0) {
        expect(Array.from(onK.A)).toEqual(Array.from(offK.A));
        expect(Array.from(onK.F)).toEqual(Array.from(offK.F));
        expect(Array.from(onK.W)).toEqual(Array.from(offK.W));
        expect(Array.from(onK.T)).toEqual(Array.from(offK.T));
        expect(dgDigest(onK.A, onK.F, onK.W, onK.T)).toBe(offK.digest());
      }
      if (t === 50) {
        expect(sum(onK.T)).toBeGreaterThan(0); // not two empty worlds
        for (let i = 0; i < onK.nTiles; i++) if (onK.T[i * onK.p.species + onK.p.genes] > 0) parasiteSeen = true;
      }
    }
    expect(parasiteSeen).toBe(true); // parasite origin ran through the linked code path
    expect(sum(onK.L)).toBe(0);
  });

  it.each([
    ['gated, parasite', { gated: true, mutPar: 0.002, linkJoin: 0.2, linkBreak: 0.001, linkLoss: 0.01 }],
    ['ungated, parasite', { gated: false, mutPar: 0.002, linkJoin: 0.2, linkBreak: 0.001, linkLoss: 0.01 }],
    ['small capacity', { gated: true, capPerTile: 5, mutPar: 0.01, linkJoin: 1, linkBreak: 0.05, linkLoss: 0.2 }],
    ['every rate at its top', { gated: false, kRep: 0.5, kDecT: 0.5, diffT: 1, mutPar: 1, linkJoin: 1, linkBreak: 1, linkLoss: 1 }],
    ['one site per molecule', { gated: true, linkSites: 'molecule', mutPar: 0.002, linkJoin: 0.2, linkBreak: 0.001, linkLoss: 0.01 }],
    ['one site per molecule, small capacity, fast rules', { gated: false, linkSites: 'molecule', capPerTile: 3, mutPar: 0.05, linkJoin: 1, linkBreak: 0.2, linkLoss: 0.5 }],
    ['copy rate 1, no parasite advantage', { gated: false, kRep: 1, kRepPar: 1, kDecT: 0.1, diffT: 1, mutPar: 0.05, linkJoin: 1, linkBreak: 0.3, linkLoss: 0.5 }],
  ] as const)('conserves matter exactly on every step: %s', (_name, ov) => {
    const k = build({ genes: 4, linked: true, ...ov }, 1, 2, 1);
    const lengthsSeen = new Set<number>();
    for (let t = 0; t < 400; t++) {
      k.step();
      expect(k.totalMatter()).toBe(k.initTotalMatter);
      if (t % 20 === 0) for (const m of k.lk.multi) if (linkedCount(k, m) > 0) lengthsSeen.add(popcount(m));
    }
    // the check ran over a world that held linked templates of more than one length, singles and the parasite
    expect(lengthsSeen.size).toBeGreaterThanOrEqual(2);
    expect(k.linkedMatter()).toBeLessThanOrEqual(k.initTotalMatter);
  });

  it('conserves matter with eight genes (256 template kinds per tile)', () => {
    const k = build({ genes: 8, linked: true, capPerTile: 64, mutPar: 0.01, linkJoin: 1, linkBreak: 0.02, linkLoss: 0.1 }, 1, 2, 1);
    let kinds = 0;
    for (let t = 0; t < 150; t++) {
      k.step();
      expect(k.totalMatter()).toBe(k.initTotalMatter);
    }
    for (const m of k.lk.multi) if (linkedCount(k, m) > 0) kinds++;
    expect(kinds).toBeGreaterThan(8);
  });

  it('is deterministic for a seed, differs between seeds, and the digest covers the linked templates', () => {
    const ov = { genes: 4, linked: true, linkSites: 'molecule', mutPar: 0.0005, linkJoin: 0.2, linkBreak: 0.01, linkLoss: 0.05 } as const;
    const a = build(ov, 1, 2, 0);
    const b = build(ov, 1, 2, 0);
    const c = build({ ...ov, seed: 6 }, 1, 2, 0);
    for (let t = 0; t < 300; t++) { a.step(); b.step(); c.step(); }
    expect(a.digest()).toBe(b.digest());
    expect(Array.from(a.L)).toEqual(Array.from(b.L));
    expect(a.digest()).not.toBe(c.digest());
    expect(sum(a.L)).toBeGreaterThan(0);
    // a state that differs only in L has another digest, and the unlinked digest of (A, F, W, T) does not see it
    const before = a.digest();
    const flat = dgDigest(a.A, a.F, a.W, a.T);
    a.L[a.L.findIndex((v) => v > 0)] += 1;
    expect(a.digest()).not.toBe(before);
    expect(dgDigest(a.A, a.F, a.W, a.T)).toBe(flat);
  });

  it('matter cost: seeding a linked template takes one unit of soluble matter per gene', () => {
    const k = new DropGenesKernel(defaultDropGenesConfig({ width: 16, height: 16, genes: 4, linked: true }));
    k.seedDroplet(8, 8, 3);
    const soluble0 = sum(k.A) + sum(k.F);
    const tiles = k.seedLinked(3); // the full template, four genes
    expect(tiles).toBeGreaterThan(0);
    expect(soluble0 - (sum(k.A) + sum(k.F))).toBe(tiles * 3 * 4);
    expect(k.linkedMatter()).toBe(BigInt(tiles * 3 * 4));
    const tiles2 = k.seedLinked(1, 0.125, 0b0101); // a two-gene template
    expect(k.linkedMatter()).toBe(BigInt(tiles * 12 + tiles2 * 2));
    expect(k.totalMatter()).toBe(k.initTotalMatter);
    // a single gene is not a linked template, and neither is a mask outside the gene set
    expect(() => k.seedLinked(1, 0.125, 0b0100)).toThrow();
    expect(() => k.seedLinked(1, 0.125, 16)).toThrow();
    expect(() => k.seedLinked(1, 0.125, 0)).toThrow();
  });

  it('matter cost: a decaying linked template returns one unit of A per gene, at the single-gene rate per molecule', () => {
    const k = bare({ genes: 3, kDecT: 0.02 });
    const M = k.lk.masks;
    for (let i = 0; i < k.nTiles; i++) k.L[i * M + 0b111] = 1000;
    const single = bare({ genes: 3, kDecT: 0.02 });
    for (let i = 0; i < single.nTiles; i++) single.T[i * single.p.species] = 1000;
    const total0 = k.totalMatter();
    k.step();
    single.step();
    const lost = 1000 * k.nTiles - linkedCount(k, 0b111);
    expect(sum(k.A)).toBe(3 * lost);
    expect(sum(k.T)).toBe(0);
    expect(k.totalMatter()).toBe(total0);
    expect(lost).toBeGreaterThan(0.02 * 1000 * k.nTiles * 0.98);
    expect(lost).toBeLessThan(0.02 * 1000 * k.nTiles * 1.02);
    const lostSingle = 1000 * single.nTiles - sum(single.T);
    expect(lost / lostSingle).toBeGreaterThan(0.97);
    expect(lost / lostSingle).toBeLessThan(1.03);
  });

  it('matter cost: a linked template of len genes is copied at kRep / len per molecule and each copy uses len units of fuel', () => {
    // Per tile: 100 molecules of one kind, sites and fuel far from limiting, no decay. Even tiles hold a single
    // gene, odd tiles a template of `len` genes.
    for (const [genes, m] of [[2, 0b11], [4, 0b1111], [4, 0b0110]] as const) {
      const len = popcount(m);
      const k = bare({ genes, capPerTile: 4096, kRep: 0.2, diffF: 0, diffA: 0 });
      const S = k.p.species;
      const M = k.lk.masks;
      k.W.fill(DG_SCALE);
      k.F.fill(10000);
      for (let i = 0; i < k.nTiles; i++) {
        if (i & 1) k.L[i * M + m] = 100;
        else k.T[i * S] = 100;
      }
      const total0 = k.totalMatter();
      k.step();
      const half = k.nTiles / 2;
      let singleBirths = 0;
      let linkedBirths = 0;
      let fuelSingle = 0;
      let fuelLinked = 0;
      for (let i = 0; i < k.nTiles; i++) {
        if (i & 1) { linkedBirths += k.L[i * M + m] - 100; fuelLinked += 10000 - k.F[i]; }
        else { singleBirths += k.T[i * S] - 100; fuelSingle += 10000 - k.F[i]; }
      }
      expect(k.totalMatter()).toBe(total0);
      expect(fuelLinked).toBe(linkedBirths * len); // each copy is made from len units of fuel
      expect(fuelSingle).toBe(singleBirths);
      expect(singleBirths).toBeGreaterThan(half * 15); // about 19.5 per tile; the linked tiles have len * 100 sites taken
      const ratio = linkedBirths / singleBirths; // expected (1 / len) * (4096 - 100 len) / (4096 - 100)
      const expected = ((1 / len) * (4096 - 100 * len)) / (4096 - 100);
      expect(ratio).toBeGreaterThan(expected * 0.93);
      expect(ratio).toBeLessThan(expected * 1.07);
      // no faster per unit of matter: fuel taken up per molecule is not above the single gene's
      expect(fuelLinked).toBeLessThanOrEqual(fuelSingle * 1.05);
    }
  });

  it('sites: a linked template takes one site per gene, and a copy needs len free sites and len units of fuel', () => {
    // 16 sites on every tile (wall 1.0). kRep 1 and no decay, so anything that can copy does.
    const mk = () => {
      const k = bare({ genes: 4, capPerTile: 16, kRep: 1, kRepPar: 1, diffF: 0, diffA: 0 }); // fuel stays on its tile
      k.W.fill(DG_SCALE);
      k.F.fill(1000);
      return k;
    };
    // (a) three full templates, one single gene, one parasite and two more singles take all 16 sites: nothing copies.
    // With one site fewer taken (15) the parasite and the singles do copy, so the stop is the sites, not the set-up.
    for (const [extra, grows] of [[2, false], [1, true]] as const) {
      const full = mk();
      const S = full.p.species;
      for (let i = 0; i < full.nTiles; i++) { full.L[i * 16 + 0b1111] = 3; full.T[i * S] = 1; full.T[i * S + 4] = 1; full.T[i * S + 1] = extra; }
      const fullT = full.T.slice();
      for (let t = 0; t < 400; t++) full.step(); // one free site copies at 1/16 per molecule per step
      expect(linkedCount(full, 0b1111)).toBe(3 * full.nTiles);
      if (grows) expect(sum(full.T)).toBe(sum(fullT) + full.nTiles);
      else expect(Array.from(full.T)).toEqual(Array.from(fullT));
    }
    // (b) 13 sites taken (three full templates and one parasite): 3 are free, a four-gene copy does not fit, the parasite's does
    const tight = mk();
    for (let i = 0; i < tight.nTiles; i++) { tight.L[i * 16 + 0b1111] = 3; tight.T[i * tight.p.species + 4] = 1; }
    for (let t = 0; t < 50; t++) tight.step();
    expect(linkedCount(tight, 0b1111)).toBe(3 * tight.nTiles);
    let par = 0;
    for (let i = 0; i < tight.nTiles; i++) {
      par += tight.T[i * tight.p.species + 4];
      let units = 0;
      for (let s = 0; s < tight.p.species; s++) units += tight.T[i * tight.p.species + s];
      for (const m of tight.lk.multi) units += tight.L[i * 16 + m] * popcount(m);
      expect(units).toBeLessThanOrEqual(16);
    }
    expect(par).toBeGreaterThan(tight.nTiles); // the parasite used the sites the template could not
    // (c) room for one more template, but only 3 units of fuel: no copy, and the fuel is untouched
    const dry = mk();
    dry.F.fill(3);
    for (let i = 0; i < dry.nTiles; i++) dry.L[i * 16 + 0b1111] = 1;
    for (let t = 0; t < 20; t++) dry.step();
    expect(linkedCount(dry, 0b1111)).toBe(dry.nTiles);
    expect(sum(dry.F)).toBe(3 * dry.nTiles);
    // (d) with 4 units of fuel the copy is made and takes all four
    const wet = mk();
    wet.F.fill(4);
    for (let i = 0; i < wet.nTiles; i++) wet.L[i * 16 + 0b1111] = 1;
    for (let t = 0; t < 200; t++) wet.step();
    expect(linkedCount(wet, 0b1111)).toBe(2 * wet.nTiles);
    expect(sum(wet.F)).toBe(0);
  });

  it('sites, linkSites molecule: a linked template takes one site whatever its length; fuel, matter and copy rate are as under gene', () => {
    const mk = (ov: Partial<DropGenesConfig> = {}) => {
      const k = bare({ genes: 4, capPerTile: 16, kRep: 1, kRepPar: 1, diffF: 0, diffA: 0, linkSites: 'molecule', ...ov });
      k.W.fill(DG_SCALE);
      k.F.fill(1000);
      return k;
    };
    // four full templates take 4 of 16 sites: they copy on, up to 16 molecules (64 units of matter) and no further
    const k = mk();
    for (let i = 0; i < k.nTiles; i++) k.L[i * 16 + 0b1111] = 4;
    const total0 = k.totalMatter();
    for (let t = 0; t < 400; t++) k.step();
    expect(k.totalMatter()).toBe(total0);
    for (let i = 0; i < k.nTiles; i++) expect(k.L[i * 16 + 0b1111]).toBe(16);
    expect(1000 * k.nTiles - sum(k.F)).toBe(12 * 4 * k.nTiles); // 12 new molecules per tile, four units of fuel each
    // sixteen molecules fill the tile for everything: a parasite beside them cannot copy
    const full = mk();
    for (let i = 0; i < full.nTiles; i++) { full.L[i * 16 + 0b1111] = 16; full.T[i * full.p.species + 4] = 1; }
    for (let t = 0; t < 20; t++) full.step();
    for (let i = 0; i < full.nTiles; i++) expect(full.T[i * full.p.species + 4]).toBe(1);
    // one free site, three units of fuel: no copy; four units: one copy
    const dry = mk();
    dry.F.fill(3);
    for (let i = 0; i < dry.nTiles; i++) dry.L[i * 16 + 0b1111] = 15;
    for (let t = 0; t < 20; t++) dry.step();
    expect(linkedCount(dry, 0b1111)).toBe(15 * dry.nTiles);
    const wet = mk();
    wet.F.fill(4);
    for (let i = 0; i < wet.nTiles; i++) wet.L[i * 16 + 0b1111] = 15;
    for (let t = 0; t < 200; t++) wet.step();
    expect(linkedCount(wet, 0b1111)).toBe(16 * wet.nTiles);
    expect(sum(wet.F)).toBe(0);
    // the copy rate per molecule is still kRep / len: the births differ from 'gene' only through the free share
    const births = (linkSites: 'gene' | 'molecule') => {
      const w = bare({ genes: 4, capPerTile: 4096, kRep: 0.2, diffF: 0, diffA: 0, linkSites });
      w.W.fill(DG_SCALE);
      w.F.fill(10000);
      for (let i = 0; i < w.nTiles; i++) w.L[i * 16 + 0b1111] = 100;
      w.step();
      return (linkedCount(w, 0b1111) - 100 * w.nTiles) / w.nTiles;
    };
    const perGene = births('gene'); // free share (4096 - 400) / 4096
    const perMolecule = births('molecule'); // free share (4096 - 100) / 4096
    expect(perMolecule / perGene).toBeGreaterThan(((4096 - 100) / (4096 - 400)) * 0.95);
    expect(perMolecule / perGene).toBeLessThan(((4096 - 100) / (4096 - 400)) * 1.05);
    expect(perMolecule).toBeLessThan(100 * (0.2 / 4) * 1.05); // never above kRep / len per molecule
    // a break takes one more site and is not held back by a full tile; nothing can copy while the tile is over
    const over = mk({ linkBreak: 1 });
    for (let i = 0; i < over.nTiles; i++) over.L[i * 16 + 0b0011] = 16;
    over.step();
    expect(linkedCount(over, 0b0011)).toBe(0);
    for (let i = 0; i < over.nTiles; i++) expect(over.T[i * over.p.species] + over.T[i * over.p.species + 1]).toBe(32);
    over.step();
    for (let i = 0; i < over.nTiles; i++) expect(over.T[i * over.p.species] + over.T[i * over.p.species + 1]).toBe(32);
  });

  it('gene loss on copy: with linkLoss 1 every new copy lacks one gene, costs len - 1, and the parent is unchanged', () => {
    const k = bare({ genes: 3, capPerTile: 4096, kRep: 0.3, linkLoss: 1 });
    const M = k.lk.masks;
    k.W.fill(DG_SCALE);
    k.F.fill(10000);
    for (let i = 0; i < k.nTiles; i++) k.L[i * M + 0b111] = 60;
    const total0 = k.totalMatter();
    k.step(); // one step: the shortened copies have not copied yet
    expect(k.totalMatter()).toBe(total0);
    expect(linkedCount(k, 0b111)).toBe(60 * k.nTiles);
    const shorter = [0b011, 0b101, 0b110].map((m) => linkedCount(k, m));
    const born = shorter[0] + shorter[1] + shorter[2];
    expect(born).toBeGreaterThan(k.nTiles * 4); // about 60 * 0.3 / 3 * (4096 - 180) / 4096 = 5.7 per tile
    for (const n of shorter) expect(n).toBeGreaterThan(born * 0.25); // the gene left out is chosen by hash
    expect(sum(k.T)).toBe(0);
    expect(10000 * k.nTiles - sum(k.F)).toBe(born * 2);
    // on one tile all the lossy copies of one kind in a step lack the same gene
    for (let i = 0; i < k.nTiles; i++) {
      const kinds = [0b011, 0b101, 0b110].filter((m) => k.L[i * M + m] > 0).length;
      expect(kinds).toBeLessThanOrEqual(1);
    }
    // a two-gene template that loses a gene leaves a single copy, which goes to T
    const two = bare({ genes: 2, capPerTile: 4096, kRep: 0.3, linkLoss: 1 });
    two.W.fill(DG_SCALE);
    two.F.fill(10000);
    for (let i = 0; i < two.nTiles; i++) two.L[i * 4 + 0b11] = 60;
    two.step();
    expect(linkedCount(two, 0b11)).toBe(60 * two.nTiles);
    const singles = sum(two.T);
    expect(singles).toBeGreaterThan(two.nTiles * 6);
    expect(10000 * two.nTiles - sum(two.F)).toBe(singles); // total fuel: diffusion moves it between tiles, not out
    let par = 0;
    for (let i = 0; i < two.nTiles; i++) par += two.T[i * two.p.species + 2];
    expect(par).toBe(0);
    // linkLoss 0: no shortened template ever appears
    const none = bare({ genes: 3, capPerTile: 4096, kRep: 0.3, linkLoss: 0 });
    none.W.fill(DG_SCALE);
    none.F.fill(10000);
    for (let i = 0; i < none.nTiles; i++) none.L[i * M + 0b111] = 60;
    for (let t = 0; t < 10; t++) none.step();
    expect(linkedCount(none, 0b111)).toBeGreaterThan(60 * none.nTiles);
    expect([0b011, 0b101, 0b110].map((m) => linkedCount(none, m))).toEqual([0, 0, 0]);
    expect(sum(none.T)).toBe(0);
  });

  it('a lossy copy is limited by its own cost: len - 1 units of fuel and, under gene, len - 1 sites', () => {
    // K = 4, every copy lossy, 3 units of fuel on the tile: one three-gene copy can be made (a whole one could not)
    for (const linkSites of ['gene', 'molecule'] as const) {
      const k = bare({ genes: 4, capPerTile: 64, kRep: 1, kRepPar: 1, diffF: 0, diffA: 0, linkLoss: 1, linkSites });
      k.W.fill(DG_SCALE);
      k.F.fill(3);
      for (let i = 0; i < k.nTiles; i++) k.L[i * 16 + 0b1111] = 4;
      const total0 = k.totalMatter();
      for (let t = 0; t < 40; t++) k.step();
      expect(k.totalMatter()).toBe(total0);
      expect(sum(k.F)).toBe(0);
      expect(linkedCount(k, 0b1111)).toBe(4 * k.nTiles);
      let three = 0;
      for (const m of [0b0111, 0b1011, 0b1101, 0b1110]) three += linkedCount(k, m);
      expect(three).toBe(k.nTiles);
    }
    // under gene, 15 sites with 12 taken by three full templates: the 3 free sites hold a lossy copy and not a
    // whole one. Fuel is plentiful, so sites are the only limit.
    const tight = bare({ genes: 4, capPerTile: 15, kRep: 1, kRepPar: 1, diffF: 0, diffA: 0, linkLoss: 1 });
    tight.W.fill(DG_SCALE);
    tight.F.fill(1000);
    for (let i = 0; i < tight.nTiles; i++) tight.L[i * 16 + 0b1111] = 3;
    for (let t = 0; t < 300; t++) tight.step();
    let threeTight = 0;
    for (const m of [0b0111, 0b1011, 0b1101, 0b1110]) threeTight += linkedCount(tight, m);
    expect(threeTight).toBe(tight.nTiles); // one lossy copy fills the tile
    expect(linkedCount(tight, 0b1111)).toBe(3 * tight.nTiles);
    expect(sum(tight.F)).toBe((1000 - 3) * tight.nTiles);
    // with linkLoss 0 the same tile makes nothing: a whole copy needs 4 free sites
    const whole = bare({ genes: 4, capPerTile: 15, kRep: 1, kRepPar: 1, diffF: 0, diffA: 0, linkLoss: 0 });
    whole.W.fill(DG_SCALE);
    whole.F.fill(1000);
    for (let i = 0; i < whole.nTiles; i++) whole.L[i * 16 + 0b1111] = 3;
    for (let t = 0; t < 300; t++) whole.step();
    expect(sum(whole.L)).toBe(3 * whole.nTiles);
    expect(sum(whole.F)).toBe(1000 * whole.nTiles);
    // and 3 units of fuel are not enough for a whole copy where the sites are (16 sites, 4 free)
    const dryWhole = bare({ genes: 4, capPerTile: 16, kRep: 1, kRepPar: 1, diffF: 0, diffA: 0, linkLoss: 0 });
    dryWhole.W.fill(DG_SCALE);
    dryWhole.F.fill(3);
    for (let i = 0; i < dryWhole.nTiles; i++) dryWhole.L[i * 16 + 0b1111] = 3;
    for (let t = 0; t < 60; t++) dryWhole.step();
    expect(sum(dryWhole.L)).toBe(3 * dryWhole.nTiles);
    expect(sum(dryWhole.F)).toBe(3 * dryWhole.nTiles);
  });

  it('service order: which linked kind is served first does not depend on its mask number or on which kinds are absent', () => {
    // Two kinds per tile, 100 molecules each, fuel for one copy of the longer kind only. Count the tiles each kind wins.
    const wins = (genes: number, a: number, b: number, fuel: number) => {
      const k = bare({ genes, capPerTile: 4096, kRep: 1, kRepPar: 1, diffF: 0, diffA: 0, linkSites: 'molecule' });
      const M = k.lk.masks;
      k.W.fill(DG_SCALE);
      k.F.fill(fuel);
      for (let i = 0; i < k.nTiles; i++) { k.L[i * M + a] = 100; k.L[i * M + b] = 100; }
      k.step();
      let first = 0;
      let second = 0;
      for (let i = 0; i < k.nTiles; i++) {
        if (k.L[i * M + a] > 100) first++;
        if (k.L[i * M + b] > 100) second++;
      }
      return [first, second, k.nTiles];
    };
    // equal length, fuel for one copy: each kind wins about half the tiles, wherever its mask sits among the 11 kinds
    for (const [a, b] of [[0b0011, 0b1100], [0b0011, 0b0101], [0b1010, 0b1100]] as const) {
      const [first, second, n] = wins(4, a, b, 2);
      expect(first + second).toBe(n);
      expect(first).toBeGreaterThan(n * 0.42);
      expect(first).toBeLessThan(n * 0.58);
    }
    // the full template against a two-gene one, 4 units of fuel: whoever is served first takes it all
    for (const b of [0b0011, 0b1100]) {
      const [full, short, n] = wins(4, 0b1111, b, 4);
      expect(full + short).toBe(n);
      expect(full).toBeGreaterThan(n * 0.42);
      expect(full).toBeLessThan(n * 0.58);
    }
    // three kinds, fuel for one copy: each wins about a third
    const k3 = bare({ genes: 4, capPerTile: 4096, kRep: 1, kRepPar: 1, diffF: 0, diffA: 0, linkSites: 'molecule' });
    k3.W.fill(DG_SCALE);
    k3.F.fill(2);
    const kinds = [0b0011, 0b0110, 0b1100];
    for (let i = 0; i < k3.nTiles; i++) for (const m of kinds) k3.L[i * 16 + m] = 100;
    k3.step();
    for (const m of kinds) {
      const won = linkedCount(k3, m) - 100 * k3.nTiles;
      expect(won).toBeGreaterThan(k3.nTiles * 0.27);
      expect(won).toBeLessThan(k3.nTiles * 0.4);
    }
  });

  it('gene loss on copy happens at about linkLoss per copy', () => {
    const k = bare({ genes: 2, capPerTile: 4096, kRep: 0.4, linkLoss: 0.1 });
    k.W.fill(DG_SCALE);
    k.F.fill(10000);
    for (let i = 0; i < k.nTiles; i++) k.L[i * 4 + 0b11] = 500;
    k.step();
    const whole = linkedCount(k, 0b11) - 500 * k.nTiles;
    const lossy = sum(k.T);
    const share = lossy / (whole + lossy); // about 77,000 copies
    expect(whole + lossy).toBeGreaterThan(60000);
    expect(share).toBeGreaterThan(0.09);
    expect(share).toBeLessThan(0.11);
  });

  it('breaking: with linkBreak 1 every linked template breaks in two each step, between neighbours in gene order, keeping every gene', () => {
    const k = bare({ genes: 4, linkBreak: 1 });
    const M = k.lk.masks;
    const S = k.p.species;
    for (let i = 0; i < k.nTiles; i++) k.L[i * M + 0b1111] = 5;
    const total0 = k.totalMatter();
    k.step();
    expect(k.totalMatter()).toBe(total0);
    expect(linkedCount(k, 0b1111)).toBe(0);
    const cuts = new Set<string>();
    for (let i = 0; i < k.nTiles; i++) {
      // the pieces are {0}, {0,1} or {0,1,2} and the rest: 5 of each of exactly two kinds on a tile
      const kinds: number[] = [];
      for (let g = 0; g < 4; g++) if (k.T[i * S + g] > 0) { kinds.push(1 << g); expect(k.T[i * S + g]).toBe(5); }
      for (const m of k.lk.multi) if (k.L[i * M + m] > 0) { kinds.push(m); expect(k.L[i * M + m]).toBe(5); }
      kinds.sort((a, b) => a - b);
      expect(kinds.length).toBe(2);
      expect(kinds[0] | kinds[1]).toBe(0b1111);
      expect(kinds[0] & kinds[1]).toBe(0);
      expect([0b0001, 0b0011, 0b0111]).toContain(kinds[0]);
      cuts.add(kinds.join('+'));
      for (let g = 0; g < 4; g++) expect(geneOnTile(k, i, g)).toBe(5);
      expect(k.T[i * S + 4]).toBe(0);
    }
    expect(cuts.size).toBe(3); // the cut point is chosen by hash: all three are used
    // two more steps and nothing linked is left: every gene is a single copy
    k.step();
    k.step();
    expect(sum(k.L)).toBe(0);
    for (let i = 0; i < k.nTiles; i++) for (let g = 0; g < 4; g++) expect(k.T[i * S + g]).toBe(5);
    expect(k.totalMatter()).toBe(total0);
  });

  it('breaking happens at about linkBreak per molecule per step, and not at all at 0', () => {
    const k = bare({ genes: 2, linkBreak: 0.01 });
    for (let i = 0; i < k.nTiles; i++) k.L[i * 4 + 0b11] = 1000;
    k.step();
    const broken = 1000 * k.nTiles - linkedCount(k, 0b11);
    expect(broken).toBeGreaterThan(0.01 * 1000 * k.nTiles * 0.95);
    expect(broken).toBeLessThan(0.01 * 1000 * k.nTiles * 1.05);
    expect(sum(k.T)).toBe(2 * broken);
    const none = bare({ genes: 2, linkBreak: 0 });
    for (let i = 0; i < none.nTiles; i++) none.L[i * 4 + 0b11] = 1000;
    for (let t = 0; t < 20; t++) none.step();
    expect(linkedCount(none, 0b11)).toBe(1000 * none.nTiles);
  });

  it('joining: two templates on one tile with no gene in common become one; the parasite and templates sharing a gene never join', () => {
    // one copy of gene 0 and one of gene 1 on every tile, and two slots per tile: the only possible pair is drawn
    const k = bare({ genes: 2, linkJoin: 1, capPerTile: 2 });
    const S = k.p.species;
    for (let i = 0; i < k.nTiles; i++) { k.T[i * S] = 1; k.T[i * S + 1] = 1; }
    const total0 = k.totalMatter();
    k.step();
    expect(k.totalMatter()).toBe(total0);
    expect(sum(k.T)).toBe(0);
    for (let i = 0; i < k.nTiles; i++) expect(k.L[i * 4 + 0b11]).toBe(1);

    // two copies of the same gene never join; a gene and a parasite never join
    const same = bare({ genes: 2, linkJoin: 1, capPerTile: 2 });
    for (let i = 0; i < same.nTiles; i++) { same.T[i * S] = 2; same.T[i * S + 2] = 3; }
    const sameT = same.T.slice();
    for (let t = 0; t < 20; t++) same.step();
    expect(Array.from(same.T)).toEqual(Array.from(sameT));
    expect(sum(same.L)).toBe(0);

    // linked templates join too, only when their gene sets do not overlap: {0,1} + {2,3} -> {0,1,2,3}; {0,1} + {1,2} never
    const pair = bare({ genes: 4, linkJoin: 1, capPerTile: 2 });
    for (let i = 0; i < pair.nTiles; i++) { pair.L[i * 16 + 0b0011] = 1; pair.L[i * 16 + 0b1100] = 1; }
    pair.step();
    expect(linkedCount(pair, 0b1111)).toBe(pair.nTiles);
    expect(linkedCount(pair, 0b0011) + linkedCount(pair, 0b1100)).toBe(0);
    const clash = bare({ genes: 4, linkJoin: 1, capPerTile: 2 });
    for (let i = 0; i < clash.nTiles; i++) { clash.L[i * 16 + 0b0011] = 1; clash.L[i * 16 + 0b0110] = 1; }
    for (let t = 0; t < 20; t++) clash.step();
    expect(linkedCount(clash, 0b0011)).toBe(clash.nTiles);
    expect(linkedCount(clash, 0b0110)).toBe(clash.nTiles);
    expect(sum(clash.T)).toBe(0);

    // one molecule alone has nothing to join, and linkJoin 0 never joins
    const alone = bare({ genes: 2, linkJoin: 1, capPerTile: 2 });
    for (let i = 0; i < alone.nTiles; i++) alone.T[i * S + 1] = 1;
    alone.step();
    expect(sum(alone.L)).toBe(0);
    const off = bare({ genes: 2, linkJoin: 0, capPerTile: 2 });
    for (let i = 0; i < off.nTiles; i++) { off.T[i * S] = 5; off.T[i * S + 1] = 5; }
    for (let t = 0; t < 20; t++) off.step();
    expect(sum(off.L)).toBe(0);
  });

  it('joining is mass action: the chance that a tile joins a pair grows with the pairs of molecules on it, not with 1 / molecules', () => {
    // 16 slots per tile, linkJoin 1, one step. Both drawn slots hold a molecule with chance n (n - 1) / (16 * 15),
    // and the two differ in gene with chance (n / 2) / (n - 1). Expected joins per tile: n^2 / 480.
    const joins = (perGene: number) => {
      const w = bare({ genes: 2, linkJoin: 1, capPerTile: 16 });
      for (let i = 0; i < w.nTiles; i++) { w.T[i * 3] = perGene; w.T[i * 3 + 1] = perGene; }
      w.step();
      return linkedCount(w, 0b11);
    };
    const two = joins(1); // n = 2: 1024 * 4 / 480 = 8.5
    const four = joins(2); // n = 4: 34
    const eight = joins(4); // n = 8: 137
    const sixteen = joins(8); // n = 16: 546 (every draw hits two molecules; 8 / 15 of pairs differ in gene)
    expect(two).toBeLessThan(25);
    expect(four).toBeGreaterThan(15);
    expect(four).toBeLessThan(60);
    expect(eight).toBeGreaterThan(95);
    expect(eight).toBeLessThan(180);
    expect(sixteen).toBeGreaterThan(480);
    expect(sixteen).toBeLessThan(610);
    // a tile holding more molecules than slots draws from all its molecules: every attempt finds two
    const crowded = joins(50); // 1024 * 50 / 99 = 517
    expect(crowded).toBeGreaterThan(460);
    expect(crowded).toBeLessThan(575);
  });

  it('joining happens at about linkJoin per tile per step when every draw finds two molecules, and keeps every gene', () => {
    const k = bare({ genes: 2, linkJoin: 0.1 });
    const S = k.p.species;
    for (let i = 0; i < k.nTiles; i++) { k.T[i * S] = 50; k.T[i * S + 1] = 50; }
    for (let t = 0; t < 4; t++) k.step();
    // an attempt joins when the two molecules differ in gene: chance about 50 / 99. Expected joins: 0.1 * 4 * 1024 * 0.505 = 207
    const joined = linkedCount(k, 0b11);
    expect(joined).toBeGreaterThan(207 - 50);
    expect(joined).toBeLessThan(207 + 50);
    for (let i = 0; i < k.nTiles; i++) {
      expect(geneOnTile(k, i, 0)).toBe(50);
      expect(geneOnTile(k, i, 1)).toBe(50);
    }
  });

  it('parasite origin takes a gene from a linked template: the template shortens by that gene and one parasite copy is added', () => {
    const k = bare({ genes: 3, mutPar: 1 });
    const M = k.lk.masks;
    const S = k.p.species;
    for (let i = 0; i < k.nTiles; i++) k.L[i * M + 0b111] = 2;
    const total0 = k.totalMatter();
    k.step();
    expect(k.totalMatter()).toBe(total0);
    const hit = [0, 0, 0];
    for (let i = 0; i < k.nTiles; i++) {
      expect(k.T[i * S + 3]).toBe(1);
      expect(k.L[i * M + 0b111]).toBe(1);
      const shorter = [0b110, 0b101, 0b011].map((m) => k.L[i * M + m]);
      expect(shorter[0] + shorter[1] + shorter[2]).toBe(1);
      hit[shorter.indexOf(1)]++;
      expect(k.T[i * S] + k.T[i * S + 1] + k.T[i * S + 2]).toBe(0);
    }
    for (const h of hit) expect(h).toBeGreaterThan(k.nTiles * 0.25); // the gene is chosen by hash

    // a two-gene template that loses a gene leaves a single copy of the other
    const two = bare({ genes: 2, mutPar: 1 });
    for (let i = 0; i < two.nTiles; i++) two.L[i * 4 + 0b11] = 1;
    two.step();
    for (let i = 0; i < two.nTiles; i++) {
      expect(two.L[i * 4 + 0b11]).toBe(0);
      expect(two.T[i * 3 + 2]).toBe(1);
      expect(two.T[i * 3] + two.T[i * 3 + 1]).toBe(1);
    }

    // the carrier is chosen among every molecule holding the gene: with 1 single and 3 linked copies of gene 0
    // (and gene 1 only in the linked ones), the single is hit on about a quarter of the tiles where gene 0 is chosen
    const mix = bare({ genes: 2, mutPar: 1 });
    for (let i = 0; i < mix.nTiles; i++) { mix.T[i * 3] = 1; mix.L[i * 4 + 0b11] = 3; }
    mix.step();
    let singleHit = 0;
    let linkedHit0 = 0;
    let linkedHit1 = 0;
    for (let i = 0; i < mix.nTiles; i++) {
      expect(mix.T[i * 3 + 2]).toBe(1);
      if (mix.L[i * 4 + 0b11] === 3) singleHit++;
      else if (mix.T[i * 3 + 1] === 1) linkedHit0++; // lost gene 0, gene 1 left as a single
      else linkedHit1++;
    }
    expect(singleHit + linkedHit0 + linkedHit1).toBe(mix.nTiles);
    expect(linkedHit1).toBeGreaterThan(mix.nTiles * 0.4); // gene 1 chosen on about half the tiles
    expect(singleHit / (singleHit + linkedHit0)).toBeGreaterThan(0.17);
    expect(singleHit / (singleHit + linkedHit0)).toBeLessThan(0.33);
  });

  it('parasite origin fires at the same rate per tile whether the genes are linked or single', () => {
    const count = (linkedForm: boolean) => {
      const k = bare({ genes: 2, mutPar: 0.05 });
      for (let i = 0; i < k.nTiles; i++) {
        if (linkedForm) k.L[i * 4 + 0b11] = 50;
        else { k.T[i * 3] = 50; k.T[i * 3 + 1] = 50; }
      }
      for (let t = 0; t < 4; t++) k.step();
      let par = 0;
      for (let i = 0; i < k.nTiles; i++) par += k.T[i * 3 + 2];
      return par;
    };
    // the event hash is the same in both worlds, so the counts are equal, not only close
    expect(count(true)).toBe(count(false));
    expect(count(true)).toBeGreaterThan(0.05 * 4 * 1024 - 50);
  });

  it('gene function counts a gene wherever it sits: linked and single copies give the same wall synthesis', () => {
    // Twin worlds, templates frozen (no copying, decay, hops): two single copies of each of four genes per wall
    // tile, or two full templates. Seeding takes the same matter, so A, F and W must stay equal bit for bit.
    const ov = { width: 32, height: 32, seed: 3, genes: 4, kRep: 0, kDecT: 0, diffT: 0 } as const;
    const single = new DropGenesKernel(defaultDropGenesConfig(ov));
    const linkedK = new DropGenesKernel(defaultDropGenesConfig({ ...ov, linked: true }));
    for (const k of [single, linkedK]) { k.seedDroplet(8, 8, 3); k.seedDroplet(22, 20, 3); }
    single.seedTemplates(2, 0.125, 0);
    linkedK.seedLinked(2);
    for (let t = 1; t <= 300; t++) {
      single.step();
      linkedK.step();
      if (t % 50 === 0) {
        expect(Array.from(linkedK.W)).toEqual(Array.from(single.W));
        expect(Array.from(linkedK.A)).toEqual(Array.from(single.A));
        expect(Array.from(linkedK.F)).toEqual(Array.from(single.F));
      }
    }
    expect(sum(linkedK.W)).toBeGreaterThan(10 * DG_SCALE);
    // mixed forms count together: one single copy of gene 0 plus one template {0,1} is two copies of gene 0
    const mixed = new DropGenesKernel(defaultDropGenesConfig({ ...ov, genes: 2, linked: true }));
    const twoSingles = new DropGenesKernel(defaultDropGenesConfig({ ...ov, genes: 2 }));
    for (const k of [mixed, twoSingles]) k.seedDroplet(8, 8, 3);
    twoSingles.seedTemplates(2, 0.125, 0);
    mixed.seedTemplates(1, 0.125, 0); // one of gene 0, one of gene 1
    mixed.seedLinked(1); // one {0,1}
    for (let t = 0; t < 100; t++) { mixed.step(); twoSingles.step(); }
    expect(Array.from(mixed.W)).toEqual(Array.from(twoSingles.W));
  });

  it('a world whose linked templates lack one gene loses its wall; with full templates it keeps it', () => {
    const wall = (k: DropGenesKernel) => sum(k.W);
    // One site per molecule, and the same with one site per gene at three times the sites: in both, three-gene
    // templates have room to copy. (At 16 sites and one site per gene the full world dies too: see the next test.)
    for (const ov of [{ linkSites: 'molecule' }, { capPerTile: 48 }] as const) {
      const full = build({ genes: 3, linked: true, ...ov });
      const missing = build({ genes: 3, linked: true, ...ov }, 0, 0);
      missing.seedLinked(2, 0.125, 0b011);
      for (let t = 0; t < 1500; t++) { full.step(); missing.step(); }
      expect(wall(missing)).toBeLessThan(DG_SCALE);
      expect(wall(full)).toBeGreaterThan(20 * DG_SCALE);
      expect(linkedCount(full, 0b111)).toBeGreaterThan(0);
      expect(linkedCount(missing, 0b011)).toBe(0);
    }
  });

  it('with one site per gene and 16 sites, founders holding only full three-gene templates die without any parasite; two-gene ones live', () => {
    // Recorded because it decides the design: a copy needs len free sites and a free share above len * kDecT / kRep.
    const three = build({ genes: 3, linked: true });
    const two = build({ genes: 2, linked: true });
    for (let t = 0; t < 1500; t++) { three.step(); two.step(); }
    expect(sum(three.W)).toBeLessThan(DG_SCALE);
    expect(sum(three.L)).toBe(0);
    expect(sum(two.W)).toBeGreaterThan(20 * DG_SCALE);
    expect(linkedCount(two, 0b11)).toBeGreaterThan(0);
    expect(three.totalMatter()).toBe(three.initTotalMatter);
  });

  it('hops: linked templates move at the single-copy rate per molecule and the gate holds them in', () => {
    const moved = (linkedForm: boolean, wall: number, gated = true) => {
      const k = bare({ genes: 2, diffT: 0.2, gated });
      k.W.fill(wall);
      // one tile in 16 holds 1000 molecules; count how many left it after one step
      const src: number[] = [];
      for (let y = 1; y < 32; y += 4) for (let x = 1; x < 32; x += 4) src.push(y * 32 + x);
      for (const i of src) {
        if (linkedForm) k.L[i * 4 + 0b11] = 1000;
        else k.T[i * 3] = 1000;
      }
      const total0 = k.totalMatter();
      k.step();
      expect(k.totalMatter()).toBe(total0);
      let left = 0;
      for (const i of src) left += 1000 - (linkedForm ? k.L[i * 4 + 0b11] : k.T[i * 3]);
      return left / src.length;
    };
    const open = Math.round(0.125 * DG_SCALE);
    expect(moved(true, open)).toBeGreaterThan(190);
    expect(moved(true, open)).toBeLessThan(210);
    expect(Math.abs(moved(true, open) - moved(false, open))).toBeLessThan(10);
    // half-open edge: about half as many
    const halfOpen = Math.round(((0.03 + 0.125) / 2) * DG_SCALE);
    expect(moved(true, halfOpen)).toBeGreaterThan(85);
    expect(moved(true, halfOpen)).toBeLessThan(115);
    // shut edge: none, unless the world is ungated
    const shut = Math.round(0.03 * DG_SCALE);
    expect(moved(true, shut)).toBe(0);
    expect(moved(true, shut, false)).toBeGreaterThan(190);
  });

  it('gate: a linked template never reaches a tile whose wall has stayed at or below gateLo', () => {
    const k = build({ genes: 4, linked: true, gated: true, mutPar: 0.002, linkJoin: 0.2, linkBreak: 0.01, linkLoss: 0.05 }, 0, 2);
    const gateLoInt = k.p.gateLoInt;
    const M = k.lk.masks;
    const everAbove = new Uint8Array(k.nTiles);
    let sawLinked = false;
    let leaked = 0;
    for (let t = 0; t < 600; t++) {
      for (let i = 0; i < k.nTiles; i++) if (k.W[i] > gateLoInt) everAbove[i] = 1;
      k.step();
      for (let i = 0; i < k.nTiles; i++) {
        if (k.W[i] > gateLoInt) everAbove[i] = 1;
        if (everAbove[i]) continue;
        for (const m of k.lk.multi) if (k.L[i * M + m] !== 0) leaked++;
      }
      if (t === 100) sawLinked = sum(k.L) > 0;
    }
    expect(leaked).toBe(0);
    expect(sawLinked).toBe(true);
  });

  it('bounds: counts stay within the world\'s matter and sites are never overfilled by copying, at extreme settings', () => {
    const k = build({ genes: 5, linked: true, gated: false, capPerTile: 4096, kRep: 0.5, kDecT: 0, diffT: 0, mutPar: 0.2, linkJoin: 1, linkBreak: 0.2, linkLoss: 0.5 }, 1, 3, 1);
    const S = k.p.species;
    const M = k.lk.masks;
    const units = (i: number) => {
      let u = 0;
      for (let s = 0; s < S; s++) u += k.T[i * S + s];
      for (const m of k.lk.multi) u += k.L[i * M + m] * popcount(m);
      return u;
    };
    const world = Number(k.initTotalMatter);
    let grew = false;
    for (let t = 0; t < 250; t++) {
      // with decay and hops off, a tile's template matter can rise only by copying, and only into free sites
      const held = Array.from({ length: k.nTiles }, (_, i) => units(i));
      const bound = held.map((h, i) => Math.max(h, (Math.min(k.W[i], DG_SCALE) * 4096) >>> 10));
      k.step();
      for (let i = 0; i < k.nTiles; i++) {
        const u = units(i);
        expect(u).toBeLessThanOrEqual(bound[i]);
        if (u > held[i]) grew = true;
      }
      expect(k.totalMatter()).toBe(k.initTotalMatter);
    }
    expect(grew).toBe(true);
    let max = 0;
    for (const v of k.T) if (v > max) max = v;
    for (const v of k.L) if (v > max) max = v;
    expect(max).toBeLessThan(world); // no count wrapped below zero into a huge u32
    expect(max).toBeGreaterThan(0);
  });

  it('rejects out-of-range link configuration', () => {
    const bad: Partial<DropGenesConfig>[] = [
      { linked: true, genes: 0 },
      { linked: true, genes: 1 },
      { linked: true, genes: DG_LINK_MAX_GENES + 1 },
      { linked: true, genes: 16 },
      { linked: true, genes: 4, linkJoin: -0.1 },
      { linked: true, genes: 4, linkJoin: 1.5 },
      { linked: true, genes: 4, linkBreak: 2 },
      { linked: true, genes: 4, linkLoss: Number.NaN },
      { linked: true, genes: 4, linkBreak: 1e-7 }, // below the fixed-point resolution: would be silently off
      { linked: true, genes: 4, linkLoss: 1e-7 },
      { linked: true, genes: 4, linkJoin: 1e-11 },
      { genes: 4, linkJoin: 0.1 }, // a link rate without linked: true
      { linked: false, genes: 4, linkBreak: 0.1 },
      { linked: 1 as unknown as boolean, genes: 4 },
      { linked: true, genes: 4, linkSites: 'none' as unknown as 'gene' },
      { genes: 4, linkSites: 'molecule' },
    ];
    for (const ov of bad) {
      expect(() => new DropGenesKernel(defaultDropGenesConfig({ width: 8, height: 8, ...ov }))).toThrow();
      expect(() => packDropGenesLinkParams(defaultDropGenesConfig({ width: 8, height: 8, ...ov }))).toThrow();
    }
    for (const genes of [2, 4, DG_LINK_MAX_GENES]) {
      const lk = packDropGenesLinkParams(defaultDropGenesConfig({ linked: true, genes, linkJoin: 1, linkBreak: 1, linkLoss: 1 }));
      expect(lk.masks).toBe(1 << genes);
      expect(lk.multi.length).toBe((1 << genes) - 1 - genes);
      expect(lk.joinU32).toBe(0xffffffff);
      expect(lk.breakQ16).toBe(65536);
    }
    // zero rates without linked are accepted and mean off
    expect(packDropGenesLinkParams(defaultDropGenesConfig({ genes: 4, linkJoin: 0, linked: false })).on).toBe(false);
  });
});

describe('droplet genes: linked-template readouts', () => {
  // A 4 x 4 arena, K = 3 (stride 4 for T, 8 for L). Tile 0: 2 single copies of gene 0, 1 parasite, 3 full
  // templates. Tile 5: 1 template {0,1}, 2 templates {1,2}, 1 single copy of gene 2.
  const K = 3;
  const n = 16;
  const mk = () => {
    const T = new Uint32Array(n * 4);
    const L = new Uint32Array(n * 8);
    T[0] = 2;
    T[3] = 1;
    L[0b111] = 3;
    L[5 * 8 + 0b011] = 1;
    L[5 * 8 + 0b110] = 2;
    T[5 * 4 + 2] = 1;
    return { T, L };
  };

  it('geneCopiesWithLinked counts a gene wherever it sits, copies the parasite column, and leaves T alone', () => {
    const { T, L } = mk();
    const T0 = T.slice();
    const G = geneCopiesWithLinked(T, L, K);
    expect(Array.from(G.slice(0, 4))).toEqual([5, 3, 3, 1]);
    expect(Array.from(G.slice(20, 24))).toEqual([1, 3, 3, 0]);
    expect(G.reduce((a, b) => a + b, 0)).toBe(5 + 3 + 3 + 1 + 1 + 3 + 3);
    expect(Array.from(T)).toEqual(Array.from(T0));
    // a reused buffer is overwritten, not added to
    const again = geneCopiesWithLinked(T, L, K, G);
    expect(again).toBe(G);
    expect(Array.from(G.slice(0, 4))).toEqual([5, 3, 3, 1]);
    expect(() => geneCopiesWithLinked(T, new Uint32Array(3), K)).toThrow();
  });

  it('linkedCounts and linkedReadout: share linked per gene, mean length, shortened share, full share', () => {
    const { T, L } = mk();
    const c = linkedCounts(T, L, K);
    expect(c.byLength).toEqual([3, 3, 3]); // singles: 2 + 1; two-gene: 1 + 2; full: 3 (the parasite is not counted)
    expect(c.linkedCopies).toEqual([4, 6, 5]);
    expect(c.allCopies).toEqual([6, 6, 6]);
    const r = linkedReadout(c);
    expect(r.linkedShare).toEqual([4 / 6, 1, 5 / 6]);
    expect(r.meanLength).toBeCloseTo((3 * 1 + 3 * 2 + 3 * 3) / 9, 12);
    expect(r.shortenedShare).toBeCloseTo(3 / 6, 12);
    expect(r.fullShare).toBeCloseTo(3 / 9, 12);
    // pooling two censuses adds the counts
    addLinkedCounts(c, linkedCounts(T, L, K));
    expect(c.byLength).toEqual([6, 6, 6]);
    expect(linkedReadout(c).meanLength).toBeCloseTo(2, 12);
    // an empty arena has no shares
    const empty = linkedReadout(linkedCounts(new Uint32Array(n * 4), new Uint32Array(n * 8), K));
    expect(empty.linkedShare).toEqual([null, null, null]);
    expect(empty.meanLength).toBeNull();
    expect(empty.shortenedShare).toBeNull();
    // a world of single copies: nothing linked, length 1, no shortened share to speak of
    const singles = new Uint32Array(n * 4);
    singles[0] = 4; singles[1] = 4; singles[2] = 4;
    const sr = linkedReadout(linkedCounts(singles, new Uint32Array(n * 8), K));
    expect(sr.linkedShare).toEqual([0, 0, 0]);
    expect(sr.meanLength).toBe(1);
    expect(sr.shortenedShare).toBeNull();
    expect(sr.fullShare).toBe(0);
    // a single-gene mask stored in L is a corrupt state
    const bad = new Uint32Array(n * 8);
    bad[0b100] = 1;
    expect(() => linkedCounts(new Uint32Array(n * 4), bad, K)).toThrow();
  });

  it('a compartment holding its genes only in linked templates is complete for the tracker when given the gene copies', () => {
    const W = new Uint32Array(n);
    for (const i of [0, 1, 4, 5]) W[i] = DG_SCALE;
    const T = new Uint32Array(n * 4);
    const L = new Uint32Array(n * 8);
    L[0b111] = 1; // one full template on tile 0
    const blind = new CompartmentTracker(4, 4, 4, K, { minArea: 3 }).observe(0, W, T);
    const seeing = new CompartmentTracker(4, 4, 4, K, { minArea: 3 }).observe(0, W, geneCopiesWithLinked(T, L, K));
    expect(blind.compartments.length).toBe(1);
    expect(blind.compartments[0].complete).toBe(false);
    expect(seeing.compartments[0].complete).toBe(true);
    expect(seeing.compartments[0].copies).toEqual([1, 1, 1, 0]);
    // a template lacking gene 2 does not make it complete
    const L2 = new Uint32Array(n * 8);
    L2[0b011] = 5;
    expect(new CompartmentTracker(4, 4, 4, K, { minArea: 3 }).observe(0, W, geneCopiesWithLinked(T, L2, K)).compartments[0].complete).toBe(false);
  });

  it('the kernel never stores a single gene as a linked template and its matter equals the gene copies the observer counts', () => {
    const k = new DropGenesKernel(defaultDropGenesConfig({ width: 32, height: 32, seed: 5, genes: 4, linked: true, linkSites: 'molecule', mutPar: 0.002, linkJoin: 1, linkBreak: 0.02, linkLoss: 0.1 }));
    k.seedDroplet(8, 8, 3);
    k.seedDroplet(24, 8, 3);
    k.seedDroplet(16, 24, 3);
    k.seedLinked(2);
    for (let t = 1; t <= 300; t++) {
      k.step();
      if (t % 50 !== 0) continue;
      const c = linkedCounts(k.T, k.L, 4); // throws on a single-gene mask in L
      const G = geneCopiesWithLinked(k.T, k.L, 4);
      let templateMatter = 0;
      for (const v of G) templateMatter += v;
      let soluble = 0;
      for (let i = 0; i < k.nTiles; i++) soluble += k.A[i] + k.F[i] + k.W[i];
      expect(BigInt(templateMatter + soluble)).toBe(k.initTotalMatter);
      expect(c.byLength.reduce((a, b, i) => a + b * (i + 1), 0)).toBe(c.allCopies.reduce((a, b) => a + b, 0));
      for (let i = 0; i < k.nTiles; i++) expect(k.L[i * 16]).toBe(0);
    }
    expect(linkedCounts(k.T, k.L, 4).byLength.filter((v) => v > 0).length).toBeGreaterThanOrEqual(3);
  });
});
