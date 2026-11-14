// The worlds of the Gate-0 spike: the founding of plan 4.4 ("rps-mix") and the inert stripe world of rule draft 3.1. The rps-mix
// formulas are the review prototype's (its `rpsMix`, in runs/rps/review/proto/, which the copy does not carry), carried here as a
// function so that the Gate-0 driver and the tests build the same world the scratch runs did. Nothing here steps a world.
import { CH, G, MOT_ZERO3, allocState3, cellCount, draw, encodeGenome3, generalistGenome3, lowbias32, worldH, worldW, type WorldConfig, type WorldState } from "@bl/schema";

/** InitParams of the rps-mix founding (the schema has no such kind until Part B; the spike records these in summary.json). */
export interface RpsMixParams {
  /** Founding labels K0 (type `t` kills type `(t + 1) mod K0`). */
  K0: number;
  /** Percentage of cells occupied (`h % 100 < occupied`). */
  occupied: number;
  /** Nutrient quanta per cell. */
  nutrient: number;
  /** Mean biomass quanta of an occupied cell. */
  biomass: number;
  /** A column keeps one occupancy and type for every layer (the key is the column index); otherwise the key is the cell index. */
  columns: boolean;
}

/**
 * Plan 4.4: for each cell `i = (z * H + y) * W + x`, `key = y * W + x` (columns) or `i`, `h = lowbias32(seed * 317 + key)`; the cell is
 * occupied iff `h % 100 < occupied`, its type is `draw(h, 5) % K0`, its lineage `(0, 1 + type)`, its beats-mask `1 << ((type + 1) % K0)`
 * (PARAM1 byte 2, mirrored in MOT bits 24 to 31), `B = draw(lowbias32(seed ^ 0x5eed), i) % (2 * biomass + 1)`, `E = 2 B`; every cell has
 * `A = nutrient`.
 */
export function rpsMix(cfg: WorldConfig, p: RpsMixParams): WorldState {
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const H = worldH(cfg);
  const D = cfg.tileD!;
  const s = allocState3(cfg);
  s.cells.fill(p.nutrient, CH.A * n, (CH.A + 1) * n);
  s.cells.fill(MOT_ZERO3, CH.MOT * n, (CH.MOT + 1) * n);
  const gen = generalistGenome3(cfg.defaultMu, cfg.defaultSigma);
  const base = lowbias32(cfg.seed ^ 0x5eed);
  for (let z = 0; z < D; z++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (z * H + y) * W + x;
        const h = lowbias32(cfg.seed * 317 + (p.columns ? y * W + x : i));
        if (h % 100 >= p.occupied) continue;
        const t = draw(h, 5) % p.K0;
        const m = 1 << ((t + 1) % p.K0);
        const words = encodeGenome3(gen, 0, 1 + t);
        words[G.PARAM1] = (words[G.PARAM1] | (t << 8) | (m << 16)) >>> 0;
        for (let g = 0; g < words.length; g++) s.genome[g * n + i] = words[g];
        const B = draw(base, i) % (2 * p.biomass + 1);
        s.cells[CH.B * n + i] = B;
        s.cells[CH.E * n + i] = 2 * B;
        s.cells[CH.MOT * n + i] = (MOT_ZERO3 | (m << 24)) >>> 0;
      }
    }
  }
  return s;
}

/**
 * Rule draft 3.1: the inert stripe world of the mobility meter. Every cell living with `B = bMeter`, `P = 0`, `E = 2 bMeter`,
 * `A = C = S = 0`; the first half of the lines along `axis` carry label 0 (lineage `(0, 1)`, PARAM1 type 0), the second half label 1
 * (lineage `(0, 2)`, type 1); masks are 0, so there is no mirror and nothing kills. The config is the caller's (rates 0, `dtQ` 0).
 */
export function stripeWorld(cfg: WorldConfig, axis: "x" | "y", bMeter: number): WorldState {
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const H = worldH(cfg);
  const D = cfg.tileD!;
  const s = allocState3(cfg);
  s.cells.fill(MOT_ZERO3, CH.MOT * n, (CH.MOT + 1) * n);
  const gen = generalistGenome3(cfg.defaultMu, cfg.defaultSigma);
  const words = [0, 1].map((label) => {
    const w = encodeGenome3(gen, 0, 1 + label);
    w[G.PARAM1] = (w[G.PARAM1] | (label << 8)) >>> 0;
    return w;
  });
  const half = (axis === "x" ? W : H) / 2;
  for (let z = 0; z < D; z++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (z * H + y) * W + x;
        const label = (axis === "x" ? x : y) < half ? 0 : 1;
        for (let g = 0; g < words[label].length; g++) s.genome[g * n + i] = words[label][g];
        s.cells[CH.B * n + i] = bMeter;
        s.cells[CH.E * n + i] = 2 * bMeter;
      }
    }
  }
  return s;
}
