import { describe, expect, it } from 'vitest';
import { DropletWorld, NUM_MOTIFS, defaultDropletConfig } from '../src/oligomer/droplets.ts';

describe('Phase B1: pointer-free Zwicker active droplets', () => {
  it('conserves exact integer matter (0 residual) and never goes negative', () => {
    const w = new DropletWorld(defaultDropletConfig({ width: 32, height: 32, seed: 7 }));
    w.seedDroplet(10, 16, 3, 0, 0.8);
    w.seedDroplet(22, 16, 3, 1, 0.8);
    for (let t = 0; t < 400; t++) {
      w.step();
      if (t % 50 === 0) {
        expect(w.totalMatter()).toBe(w.initTotalMatter);
      }
    }
    expect(w.totalMatter()).toBe(w.initTotalMatter);
    for (let i = 0; i < w.nTiles; i++) {
      expect(w.A[i]).toBeGreaterThanOrEqual(0);
      expect(w.F[i]).toBeGreaterThanOrEqual(0);
      for (let m = 0; m < NUM_MOTIFS; m++) {
        expect(w.W[i * NUM_MOTIFS + m]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('spontaneously divides 1 seeded droplet into >= 4 discrete droplets with zero split() code', () => {
    const w = new DropletWorld(defaultDropletConfig({ width: 48, height: 48, seed: 1 }));
    w.seedDroplet(24, 24, 3, 0, 0.8);
    expect(w.findDroplets(0.25).length).toBe(1);

    let maxDroplets = 1;
    for (let t = 1; t <= 3500; t++) {
      w.step();
      if (t % 250 === 0) {
        const count = w.findDroplets(0.25).length;
        if (count > maxDroplets) maxDroplets = count;
      }
    }
    expect(maxDroplets).toBeGreaterThanOrEqual(4);
    expect(w.totalMatter()).toBe(w.initTotalMatter);
  });

  it('cross-motif Flory-Huggins repulsion chi reduces mixing between adjacent droplets vs chi=0', () => {
    const runOverlap = (chi: number) => {
      const w = new DropletWorld(defaultDropletConfig({ width: 24, height: 24, seed: 3, chi, mobility: 0.02 }));
      w.seedDroplet(10, 12, 3, 0, 0.85);
      w.seedDroplet(14, 12, 3, 1, 0.85);
      for (let t = 0; t < 250; t++) w.step();
      let overlap = 0;
      for (let i = 0; i < w.nTiles; i++) {
        overlap += w.W[i * NUM_MOTIFS + 0] * w.W[i * NUM_MOTIFS + 1];
      }
      expect(w.totalMatter()).toBe(w.initTotalMatter);
      return overlap;
    };
    expect(runOverlap(2.0)).toBeLessThan(runOverlap(0));
  });

  it('rejects Int32-overflowing total world matter on construction', () => {
    expect(() => new DropletWorld(defaultDropletConfig({ width: 4, height: 4, initMatterPerTile: 1e8 }))).toThrow();
  });

  it('dissolves all droplets back to soluble waste in the dark (kLight = 0)', () => {
    const w = new DropletWorld(defaultDropletConfig({ width: 24, height: 24, seed: 5, kLight: 0 }));
    w.seedDroplet(12, 12, 3, 0, 0.8);
    for (let t = 0; t < 400; t++) w.step();
    expect(w.findDroplets(0.15).length).toBe(0);
    expect(w.totalMatter()).toBe(w.initTotalMatter);
  });

  it('is bit-deterministic across identical seeds', () => {
    const w1 = new DropletWorld(defaultDropletConfig({ width: 24, height: 24, seed: 11 }));
    const w2 = new DropletWorld(defaultDropletConfig({ width: 24, height: 24, seed: 11 }));
    w1.seedDroplet(12, 12, 3, 0, 0.8);
    w2.seedDroplet(12, 12, 3, 0, 0.8);
    for (let t = 0; t < 200; t++) {
      w1.step();
      w2.step();
    }
    expect(Array.from(w1.W)).toEqual(Array.from(w2.W));
    expect(Array.from(w1.F)).toEqual(Array.from(w2.F));
    expect(Array.from(w1.A)).toEqual(Array.from(w2.A));
  });

  it('conserves exact matter with heritable lysis, advection, and motif isomerization', () => {
    const w = new DropletWorld(
      defaultDropletConfig({
        width: 32,
        height: 32,
        seed: 9,
        kLyse: 0.35,
        mutLyse: 0.002,
        mutMotif: 0.0002,
      }),
    );
    w.seedDroplet(10, 16, 3, 0, 0.85, 1);
    w.seedDroplet(20, 16, 3, 1, 0.85, 0);
    for (let t = 0; t < 400; t++) {
      w.step();
      if (t % 50 === 0) expect(w.totalMatter()).toBe(w.initTotalMatter);
    }
    expect(w.totalMatter()).toBe(w.initTotalMatter);
    for (let i = 0; i < w.nTiles; i++) {
      expect(w.A[i]).toBeGreaterThanOrEqual(0);
      expect(w.F[i]).toBeGreaterThanOrEqual(0);
      for (let m = 0; m < NUM_MOTIFS; m++) {
        expect(w.W[i * NUM_MOTIFS + m]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('causal contact lysis: an m1 droplet targeting m0 digests an adjacent m0 droplet', () => {
    const runPair = (m1Target: number) => {
      const w = new DropletWorld(
        defaultDropletConfig({
          width: 24,
          height: 24,
          seed: 4,
          kLyse: 0.4,
          mutLyse: 0,
          mutMotif: 0,
          lyseUpkeep: 0,
        }),
      );
      w.seedDroplet(9, 12, 3, 0, 0.85, -1);
      w.seedDroplet(15, 12, 3, 1, 0.85, m1Target);
      for (let t = 0; t < 300; t++) w.step();
      expect(w.totalMatter()).toBe(w.initTotalMatter);
      return { st: w.motifStats(), lyseMass: w.lyseMassCleaved };
    };

    const attack = runPair(0); // m1 targets m0
    const control = runPair(2); // m1 targets absent motif m2
    expect(attack.lyseMass).toBeGreaterThan(0);
    expect(control.lyseMass).toBe(0);
    expect(attack.st.shares[0]).toBeLessThan(control.st.shares[0]);
    expect(attack.st.shares[1]).toBeGreaterThan(control.st.shares[1]);
  });
});
