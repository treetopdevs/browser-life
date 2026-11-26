// Shared builders for the slab reference tests: seeded random slabs and the z-mirror of a state.
import {
  CELL_CHANNELS, CH, G, GENOME_CHANNELS3, NN_BYTES3, POOL_MAX3, buildWorld3, cellCount, cloneState, defaultConfig, generalistGenome3,
  lowbias32, type Genome3, type WorldConfig, type WorldState,
} from "@bl/schema";

export const slabCfg = (o: Partial<WorldConfig> = {}): WorldConfig =>
  defaultConfig({ kernelRadius: 3, tileD: 8, lightK: 1024, lightMode: "uniform", tileW: 16, tileH: 16, ...o });

export function rng(seed: number): () => number {
  let s = lowbias32(seed >>> 0);
  return () => (s = lowbias32((s + 0x9e3779b9) >>> 0));
}

export function randomGenome3(r: () => number): Genome3 {
  const g = generalistGenome3(120 + (r() % 80), 16 + (r() % 24));
  g.motGain = r() % 200;
  for (let b = 0; b < NN_BYTES3; b++) if (r() % 3 === 0) g.weights[b] = Math.max(-127, Math.min(127, g.weights[b] + ((r() % 81) - 40)));
  return g;
}

/** A random valid slab: random config knobs, 1..4 founder balls (some on the walls), random C / S / E sprinkled around. */
export function randomSlab(seed: number, over: Partial<WorldConfig> = {}): WorldState {
  const r = rng(seed);
  const cfg = slabCfg({
    seed,
    spread: r() % 17,
    lightMode: r() % 2 ? "uniform" : "gradient",
    lightBase: 10 + (r() % 40),
    lightAmp: 60 + (r() % 100),
    seasonPeriod: r() % 3 === 0 ? 40 : 0,
    seasonAmp: 30,
    motility: r() % 4 !== 0,
    neutral: r() % 5 === 0,
    mutRate: r() % 2 ? 429_497 : 40_000_000,
    ...over,
  });
  const founders = [];
  const count = 1 + (r() % 4);
  for (let k = 0; k < count; k++) {
    const z = k === 0 ? 0 : k === 1 ? cfg.tileD! - 1 : r() % cfg.tileD!;
    founders.push({ x: r() % cfg.tileW, y: r() % cfg.tileH, z, radius: 2 + (r() % 2), genome: randomGenome3(r), biomass: 30 + (r() % 100), energy: 20 + (r() % 200) });
  }
  const s = buildWorld3(cfg, { nutrient: r() % 64, waste: r() % 8, founders });
  const n = cellCount(cfg);
  for (let i = 0; i < n; i++) {
    if (r() % 5 === 0) s.cells[CH.C * n + i] += r() % 40;
    if (r() % 4 === 0) s.cells[CH.S * n + i] = r() % 60000;
    if (r() % 6 === 0) s.cells[CH.E * n + i] += r() % 60000;
    if ((s.genome[G.LIN_HI * n + i] | s.genome[G.LIN_LO * n + i]) !== 0) {
      // random motility outputs, in bytes 1..255
      s.cells[CH.MOT * n + i] = ((1 + (r() % 255)) | ((1 + (r() % 255)) << 8) | ((1 + (r() % 255)) << 16)) >>> 0;
    }
  }
  return s;
}

/** The state with z -> D - 1 - z for every channel and genome word, and the z motility byte mirrored (b -> 256 - b). */
export function mirrorZ(s: WorldState): WorldState {
  const cfg = s.cfg;
  const n = cellCount(cfg);
  const W = cfg.tileW, H = cfg.tileH, D = cfg.tileD!;
  const out = cloneState(s);
  for (let z = 0; z < D; z++)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (z * H + y) * W + x;
        const m = ((D - 1 - z) * H + y) * W + x;
        for (let ch = 0; ch < CELL_CHANNELS; ch++) out.cells[ch * n + m] = s.cells[ch * n + i];
        for (let g = 0; g < GENOME_CHANNELS3; g++) out.genome[g * n + m] = s.genome[g * n + i];
        const mot = s.cells[CH.MOT * n + i];
        out.cells[CH.MOT * n + m] = ((mot & 0xffff) | ((256 - (mot >>> 16)) << 16)) >>> 0;
      }
  return out;
}

export const field = (s: WorldState, ch: number): Uint32Array => {
  const n = cellCount(s.cfg);
  return s.cells.subarray(ch * n, (ch + 1) * n);
};

export { POOL_MAX3 };
