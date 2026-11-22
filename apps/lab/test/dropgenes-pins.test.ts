import { describe, expect, it } from 'vitest';
import { DropGenesKernel, defaultDropGenesConfig, type DropGenesConfig } from '../src/dropgenes/kernel.ts';

/**
 * State digests of the first-rung kernel, computed at commit c60d2e5a BEFORE the ladder (heritable trait) code
 * was added to kernel.ts. They prove that with the ladder keys absent the kernel is unchanged bit for bit.
 * Set-up is the runner's: 64 x 64, a 4 x 4 grid of founder spots of radius 3, two copies of each gene per wall tile.
 */
const LARGE = { diffT: 0.1, diffW: 0.03, diffF: 0.6, diffA: 0.44 } as const;

function world(ov: Partial<DropGenesConfig>, parasiteSeed = 0): DropGenesKernel {
  const w = new DropGenesKernel(defaultDropGenesConfig({ width: 64, height: 64, ...ov }));
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) w.seedDroplet(Math.floor(((gx + 0.5) / 4) * 64), Math.floor(((gy + 0.5) / 4) * 64), 3);
  }
  w.seedTemplates(2, 0.125, parasiteSeed);
  return w;
}

function copiesPerSpecies(w: DropGenesKernel): number[] {
  const S = w.p.species;
  const out = new Array<number>(S).fill(0);
  for (let i = 0; i < w.nTiles; i++) for (let s = 0; s < S; s++) out[s] += w.T[i * S + s];
  return out;
}

const PINS: { name: string; ov: Partial<DropGenesConfig>; parasiteSeed: number; every: number; digests: number[]; copies: number[][] }[] = [
  { name: 'LARGE, K = 2, gated, parasite origin 1e-4, seed 1', ov: { ...LARGE, seed: 1, genes: 2, capPerTile: 16, gated: true, mutPar: 1e-4 }, parasiteSeed: 0, every: 500,
    digests: [1822088019, 2453098495, 3727745443, 3612167433],
    copies: [[2396, 2046, 674], [1937, 1925, 730], [1943, 1963, 505], [2105, 2277, 329]] },
  { name: 'LARGE, K = 4, ungated, no parasite, seed 1', ov: { ...LARGE, seed: 1, genes: 4, capPerTile: 16, gated: false, mutPar: 0 }, parasiteSeed: 0, every: 500,
    digests: [1433268913, 4099042967, 3610064065, 1768531383],
    copies: [[741, 883, 867, 720, 0], [428, 649, 532, 594, 0], [331, 467, 358, 437, 0], [415, 403, 392, 557, 0]] },
  { name: 'default physics, K = 2, 16 sites, ungated, parasite seeded and arising at 1e-3, seed 3', ov: { diffT: 0.1, seed: 3, genes: 2, capPerTile: 16, gated: false, mutPar: 1e-3 }, parasiteSeed: 1, every: 150,
    digests: [1720741575, 3470693719, 1137777015, 1345226889],
    copies: [[503, 393, 2712], [33, 37, 644], [0, 3, 33], [0, 0, 2]] },
];

describe('droplet genes kernel: first-rung path is unchanged (digests pinned at c60d2e5a)', () => {
  it.each(PINS)('$name', (pin) => {
    const w = world(pin.ov, pin.parasiteSeed);
    const digests: number[] = [];
    const copies: number[][] = [];
    for (let s = 1; s <= pin.every * 4; s++) {
      w.step();
      if (s % pin.every === 0) {
        digests.push(w.digest());
        copies.push(copiesPerSpecies(w));
      }
    }
    expect(w.totalMatter() - w.initTotalMatter).toBe(0n);
    expect(digests).toEqual(pin.digests);
    expect(copies).toEqual(pin.copies);
  }, 600_000);
});
