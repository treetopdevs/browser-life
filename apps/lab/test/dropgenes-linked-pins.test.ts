import { describe, expect, it } from 'vitest';
import { DropGenesKernel, defaultDropGenesConfig, dgDigest, type DropGenesConfig } from '../src/dropgenes/kernel.ts';

/**
 * State digests of the droplet-genes kernel with linking off, taken at commit c60d2e5a BEFORE the linked-template
 * code was added to kernel.ts (docs/droplet-genes-linked-2026-11-21/PLAN.md). They prove the default path is
 * unchanged bit for bit. A change that is meant to alter the unlinked dynamics re-pins them deliberately.
 *
 * The worlds are set up exactly as experiments/dropgenes/run.ts sets up a 64 x 64 run at the `LARGE` setting:
 * a 4 x 4 grid of founder spots, two copies of every gene on every wall tile.
 */
const LARGE = { diffT: 0.1, diffW: 0.03, diffF: 0.6, diffA: 0.44, capPerTile: 16 } as const;

function largeWorld(ov: Partial<DropGenesConfig>): DropGenesKernel {
  const k = new DropGenesKernel(defaultDropGenesConfig({ width: 64, height: 64, ...LARGE, ...ov }));
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) k.seedDroplet(Math.floor(((gx + 0.5) / 4) * 64), Math.floor(((gy + 0.5) / 4) * 64), 3);
  }
  k.seedTemplates(2, 0.125, 0);
  return k;
}

describe('droplet genes kernel, linking off: digests pinned at c60d2e5a', () => {
  it.each([
    ['LARGE, K = 2, gated, parasite, seed 1', { genes: 2, gated: true, mutPar: 1e-4, seed: 1 }, 3612167433, 4711, 360287],
    ['LARGE, K = 4, ungated, no parasite, seed 1', { genes: 4, gated: false, mutPar: 0, seed: 1 }, 1768531383, 1767, 107835],
    ['LARGE, K = 4, gated, parasite, seed 2', { genes: 4, gated: true, mutPar: 1e-4, seed: 2 }, 3522314193, 953, 64921],
  ] as const)('%s, 2,000 steps', (_name, ov, digest, templates, wall) => {
    const k = largeWorld(ov);
    for (let t = 0; t < 2000; t++) k.step();
    expect(dgDigest(k.A, k.F, k.W, k.T)).toBe(digest);
    expect(k.digest()).toBe(digest);
    // The pinned worlds are not empty: templates and wall are both there at the end.
    expect(k.T.reduce((a, b) => a + b, 0)).toBe(templates);
    let w = 0;
    for (const v of k.W) w += v;
    expect(w).toBe(wall);
    expect(k.totalMatter()).toBe(k.initTotalMatter);
  }, 300_000);
});
