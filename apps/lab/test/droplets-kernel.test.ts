import { describe, expect, it } from 'vitest';
import {
  DropletKernelRef,
  KERNEL_MOTIFS,
  defaultDropletKernelConfig,
  observeDigest,
  observeFindDroplets,
  observeMotifStats,
  observeTotalMatter,
} from '../src/oligomer/droplets-kernel.ts';

describe('Phase B2: bit-exact fixed-point droplet+phage kernel (CPU ref for WebGPU)', () => {
  it('conserves exact integer matter (0 residual) and is bit-deterministic', () => {
    const run = () => {
      const r = new DropletKernelRef(
        defaultDropletKernelConfig({
          width: 32,
          height: 32,
          seed: 7,
          kInfect: 0.34,
          mutMotif: 0.0005,
          mutPhage: 0.001,
        }),
      );
      r.seedDroplet(10, 16, 3, 0, 0.85);
      r.seedDroplet(22, 16, 3, 1, 0.85);
      r.seedPhage(10, 16, 0, 30);
      for (let t = 0; t < 250; t++) {
        r.step();
        if (t % 50 === 0) {
          expect(observeTotalMatter(r.A, r.F, r.W, r.P)).toBe(r.initTotalMatter);
        }
      }
      expect(observeTotalMatter(r.A, r.F, r.W, r.P)).toBe(r.initTotalMatter);
      return observeDigest(r.A, r.F, r.W, r.P);
    };
    expect(run()).toBe(run());
  });

  it('spontaneously divides 1 seeded droplet into >= 4 discrete droplets with zero split() code', () => {
    const r = new DropletKernelRef(
      defaultDropletKernelConfig({ width: 48, height: 48, seed: 1, kInfect: 0, mutMotif: 0, mutPhage: 0 }),
    );
    r.seedDroplet(24, 24, 3, 0, 0.85);
    expect(observeFindDroplets(r.W, 48, 48, 0.25).length).toBe(1);
    let maxDrops = 1;
    for (let t = 1; t <= 3000; t++) {
      r.step();
      if (t % 250 === 0) {
        const n = observeFindDroplets(r.W, 48, 48, 0.25).length;
        if (n > maxDrops) maxDrops = n;
      }
    }
    expect(maxDrops).toBeGreaterThanOrEqual(4);
    expect(observeTotalMatter(r.A, r.F, r.W, r.P)).toBe(r.initTotalMatter);
  });

  it('specialist phage amplifies on matching host motif and spares off-target motif', () => {
    const r = new DropletKernelRef(
      defaultDropletKernelConfig({
        width: 28,
        height: 24,
        seed: 21,
        kInfect: 0.34,
        kDecayP: 0.02,
        diffP: 0.22,
        mutMotif: 0,
        mutPhage: 0,
      }),
    );
    r.seedDroplet(8, 12, 3, 0, 0.85);
    r.seedDroplet(20, 12, 3, 1, 0.85);
    r.seedPhage(8, 12, 0, 40);
    let peakP0 = 40;
    for (let t = 0; t < 250; t++) {
      r.step();
      const st = observeMotifStats(r.W, r.P);
      if (st.phageTotals[0] > peakP0) peakP0 = st.phageTotals[0];
    }
    expect(peakP0).toBeGreaterThan(200);
    const st = observeMotifStats(r.W, r.P);
    expect(st.shares[0]).toBeLessThan(st.shares[1]);
    expect(observeTotalMatter(r.A, r.F, r.W, r.P)).toBe(r.initTotalMatter);
  });

  it('rejects out-of-range or non-finite parameters and invalid seeding', () => {
    expect(() => new DropletKernelRef(defaultDropletKernelConfig({ kInfect: Number.NaN }))).toThrow();
    expect(() => new DropletKernelRef(defaultDropletKernelConfig({ mutPhage: 2 }))).toThrow();
    expect(() => new DropletKernelRef(defaultDropletKernelConfig({ diffW: 0.5 }))).toThrow();
    const r = new DropletKernelRef(defaultDropletKernelConfig({ width: 8, height: 8 }));
    expect(() => r.seedPhage(0, 0, KERNEL_MOTIFS, 10)).toThrow();
    expect(() => r.seedPhage(0, 0, 0, Number.NaN)).toThrow();
    expect(() => r.seedDroplet(4.5, 4, 2, 0, 0.85)).toThrow();
    expect(() => r.seedDroplet(4, 4, 2, 0, -0.5)).toThrow();
    expect(() => r.seedDroplet(4, 4, -1, 0, 0.85)).toThrow();
    expect(observeTotalMatter(r.A, r.F, r.W, r.P)).toBe(r.initTotalMatter);
  });
});
