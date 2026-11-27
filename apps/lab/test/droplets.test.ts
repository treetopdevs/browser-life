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

  it('secreted lysin bridges a 3-tile water moat across immiscible droplets', () => {
    const runSeparated = (m1Target: number) => {
      const w = new DropletWorld(
        defaultDropletConfig({
          width: 28,
          height: 24,
          seed: 12,
          kLyse: 0.45,
          mutLyse: 0,
          mutMotif: 0,
          lyseUpkeep: 0,
          decayL: 0.025,
          secreteL: 0.025,
        }),
      );
      // Centers 9 tiles apart with radius 3 -> 2-3 tile dilute water gap between edges (zero r=1 contact at t=0)
      w.seedDroplet(8, 12, 3, 0, 0.85, -1);
      w.seedDroplet(17, 12, 3, 1, 0.85, m1Target);
      // Verify gap tile x=12, y=12 has zero W at t=0
      expect(w.W[(12 * 28 + 12) * NUM_MOTIFS + 0]).toBe(0);
      expect(w.W[(12 * 28 + 12) * NUM_MOTIFS + 1]).toBe(0);
      for (let t = 0; t < 250; t++) w.step();
      expect(w.totalMatter()).toBe(w.initTotalMatter);
      return { st: w.motifStats(), lyseMass: w.lyseMassCleaved };
    };

    const attack = runSeparated(0);
    const control = runSeparated(2);
    expect(attack.lyseMass).toBeGreaterThan(0);
    expect(control.lyseMass).toBe(0);
    expect(attack.st.shares[0]).toBeLessThan(control.st.shares[0]);
  });

  it('NEUTRAL_LYSE is strictly foreign-motif-gated: zero self-cleavage on an isolated droplet, nonzero across foreign motifs', () => {
    // Isolated single-motif droplet armed with neutralLyse -> must never self-cleave
    const solo = new DropletWorld(
      defaultDropletConfig({
        width: 24,
        height: 24,
        seed: 6,
        kLyse: 0.45,
        neutralLyse: true,
        mutLyse: 0,
        mutMotif: 0,
        lyseUpkeep: 0,
      }),
    );
    solo.seedDroplet(12, 12, 3, 0, 0.85, 1);
    for (let t = 0; t < 200; t++) solo.step();
    expect(solo.lyseMassCleaved).toBe(0);
    expect(solo.totalMatter()).toBe(solo.initTotalMatter);

    // Pair of different motifs -> neutralLyse cleaves across the foreign interface
    const pair = new DropletWorld(
      defaultDropletConfig({
        width: 24,
        height: 24,
        seed: 6,
        kLyse: 0.45,
        neutralLyse: true,
        mutLyse: 0,
        mutMotif: 0,
        lyseUpkeep: 0,
      }),
    );
    pair.seedDroplet(8, 12, 3, 0, 0.85, 2);
    pair.seedDroplet(16, 12, 3, 1, 0.85, -1);
    for (let t = 0; t < 200; t++) pair.step();
    expect(pair.lyseMassCleaved).toBeGreaterThan(0);
    expect(pair.totalMatter()).toBe(pair.initTotalMatter);
  });

  it('rejects out-of-range or non-finite lysin field parameters on construction', () => {
    expect(() => new DropletWorld(defaultDropletConfig({ diffL: 1.5 }))).toThrow();
    expect(() => new DropletWorld(defaultDropletConfig({ diffL: Number.NaN }))).toThrow();
    expect(() => new DropletWorld(defaultDropletConfig({ decayL: -0.1 }))).toThrow();
    expect(() => new DropletWorld(defaultDropletConfig({ decayL: Number.NaN }))).toThrow();
    expect(() => new DropletWorld(defaultDropletConfig({ secreteL: -0.01 }))).toThrow();
    expect(() => new DropletWorld(defaultDropletConfig({ secreteL: Number.POSITIVE_INFINITY }))).toThrow();
  });

  it('Phase B1.4: conserved obligate phage amplifies on matching host motif, spares off-target motif, and holds res=0', () => {
    const w = new DropletWorld(
      defaultDropletConfig({
        width: 28,
        height: 24,
        seed: 21,
        kInfect: 0.34,
        phageYield: 0.5,
        diffP: 0.22,
        kDecayP: 0.02,
        mutPhage: 0,
        mutMotif: 0,
      }),
    );
    w.seedDroplet(8, 12, 3, 0, 0.85);
    w.seedDroplet(20, 12, 3, 1, 0.85);
    w.seedPhage(8, 12, 0, 40);
    expect(w.totalMatter()).toBe(w.initTotalMatter);

    let peakP0 = 40;
    for (let t = 0; t < 250; t++) {
      w.step();
      const p0 = w.phageTotals()[0];
      if (p0 > peakP0) peakP0 = p0;
      if (t % 50 === 0) expect(w.totalMatter()).toBe(w.initTotalMatter);
    }
    expect(peakP0).toBeGreaterThan(200);
    expect(w.phageMassCleaved).toBeGreaterThan(0);
    const st = w.motifStats();
    expect(st.shares[0]).toBeLessThan(st.shares[1]);
    expect(w.totalMatter()).toBe(w.initTotalMatter);
    for (let i = 0; i < w.P.length; i++) {
      expect(w.P[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('Phase B1.4: hostless phage decays and diffuses back to soluble waste A even when kInfect=0', () => {
    const w = new DropletWorld(
      defaultDropletConfig({
        width: 16,
        height: 16,
        seed: 22,
        kInfect: 0,
        kDecayP: 0.05,
        diffP: 0.2,
        mutPhage: 0,
      }),
    );
    w.seedPhage(8, 8, 0, 100);
    w.step();
    // Should have started diffusing to neighbors even with kInfect=0
    expect(w.P[(8 * 16 + 8) * NUM_MOTIFS + 0]).toBeLessThan(100);
    for (let t = 0; t < 300; t++) w.step();
    expect(w.phageTotals()[0]).toBe(0);
    expect(w.totalMatter()).toBe(w.initTotalMatter);
  });

  it('Phase B1.4: specialist phage spares off-target motif while NEUTRAL_PHAGE cleaves any motif', () => {
    const run = (neutralPhage: boolean) => {
      const w = new DropletWorld(
        defaultDropletConfig({
          width: 20,
          height: 20,
          seed: 23,
          kInfect: 0.34,
          kDecayP: 0.02,
          diffP: 0.22,
          mutPhage: 0,
          neutralPhage,
        }),
      );
      w.seedDroplet(10, 10, 3, 1, 0.85);
      w.seedPhage(10, 10, 0, 40); // P_0 placed directly on m1 droplet
      for (let t = 0; t < 150; t++) w.step();
      expect(w.totalMatter()).toBe(w.initTotalMatter);
      return w.phageMassCleaved;
    };
    expect(run(false)).toBe(0);
    expect(run(true)).toBeGreaterThan(0);
  });

  it('Phase B1.4: rejects out-of-range or non-finite phage parameters and invalid seedPhage arguments', () => {
    expect(() => new DropletWorld(defaultDropletConfig({ kInfect: -0.1 }))).toThrow();
    expect(() => new DropletWorld(defaultDropletConfig({ phageYield: 1.5 }))).toThrow();
    expect(() => new DropletWorld(defaultDropletConfig({ diffP: Number.NaN }))).toThrow();
    expect(() => new DropletWorld(defaultDropletConfig({ kDecayP: -0.01 }))).toThrow();
    expect(() => new DropletWorld(defaultDropletConfig({ mutPhage: Number.POSITIVE_INFINITY }))).toThrow();
    expect(() => new DropletWorld(defaultDropletConfig({ mutPhage: 2 }))).toThrow();

    const w = new DropletWorld(defaultDropletConfig({ width: 8, height: 8, seed: 24 }));
    expect(() => w.seedPhage(0, 0, 0, Number.NaN)).toThrow();
    expect(() => w.seedPhage(7, 7, NUM_MOTIFS, 20)).toThrow();
    expect(() => w.seedPhage(1.5, 0, 0, 20)).toThrow();
    expect(w.totalMatter()).toBe(w.initTotalMatter);
  });
});
