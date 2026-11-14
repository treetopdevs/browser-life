// Slab founding and validation (rung 1b). The slab state is the same WorldState shape as 2D: channel-major,
// cell index z * W * H + y * W + x, a genome buffer of GENOME_CHANNELS3 words per cell. Nothing here steps it.
import { cellCount, isSlab, maxPackableRaw, packLineageLo, validateConfig, worldW, worldH, type WorldConfig } from "./config.ts";
import { CELL_CHANNELS, CH, FLUX_COUNT } from "./layout.ts";
import { GENOME_CHANNELS3, MOT_ZERO3 } from "./layout3d.ts";
import { encodeGenome3, type Genome3 } from "./genome3.ts";
import { draw, lowbias32 } from "./int.ts";
import { validateState, type WorldState } from "./world.ts";

/** Which simulator a config needs. The factory discriminator only: nothing else should branch on it. */
export type SimKind = "2d" | "slab";
export const simKind = (cfg: Pick<WorldConfig, "tileD">): SimKind => (isSlab(cfg) ? "slab" : "2d");

export interface Founder3 {
  x: number;
  y: number;
  z: number;
  radius: number;
  genome: Genome3;
  /** Mean biomass quanta per occupied cell. */
  biomass: number;
  energy: number;
}

export interface InitSpec3 {
  /** Nutrient quanta per cell. */
  nutrient: number;
  /** Dissolved waste (channel C) quanta per cell. Absent leaves C empty. */
  waste?: number;
  founders: Founder3[];
}

export function allocState3(cfg: WorldConfig): WorldState {
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error(`invalid config: ${errs.join("; ")}`);
  if (!isSlab(cfg)) throw new Error("allocState3 needs a slab config (tileD set)");
  const n = cellCount(cfg);
  return {
    cfg,
    step: 0,
    cells: new Uint32Array(n * CELL_CHANNELS),
    genome: new Uint32Array(n * GENOME_CHANNELS3),
    lightIn: 0n,
    heatOut: 0n,
    flux: new Array<bigint>(FLUX_COUNT).fill(0n),
  };
}

/** `buildWorld` for the slab: ball founders, x and y wrap, z does not (cells outside [0, tileD) are skipped). */
export function buildWorld3(cfg: WorldConfig, spec: InitSpec3): WorldState {
  const s = allocState3(cfg);
  const n = cellCount(cfg);
  const W = worldW(cfg);
  const H = worldH(cfg);
  const D = cfg.tileD!;
  s.cells.fill(spec.nutrient, CH.A * n, (CH.A + 1) * n);
  if (spec.waste) s.cells.fill(spec.waste, CH.C * n, (CH.C + 1) * n);
  s.cells.fill(MOT_ZERO3, CH.MOT * n, (CH.MOT + 1) * n);
  spec.founders.forEach((f, idx) => {
    if (2 * f.radius + 1 > Math.min(cfg.tileW, cfg.tileH)) throw new Error(`founder ${idx} radius ${f.radius} does not fit in the slab (z is clipped at the walls, x and y must hold the ball)`);
    if (!Number.isInteger(f.z) || f.z < 0 || f.z >= D) throw new Error(`founder ${idx} z ${f.z} is outside 0..${D - 1}`);
    const rawId = idx + 1;
    if (rawId > maxPackableRaw(cfg)) throw new Error(`founder ${idx}: index exceeds the representable lineage-id range (${maxPackableRaw(cfg)})`);
    const words = encodeGenome3(f.genome, 0, packLineageLo(cfg, rawId));
    const base = lowbias32(cfg.seed ^ (idx * 7919 + 17));
    const fx = ((f.x % W) + W) % W;
    const fy = ((f.y % H) + H) % H;
    const r2 = f.radius * f.radius;
    for (let dz = -f.radius; dz <= f.radius; dz++) {
      const z = f.z + dz;
      if (z < 0 || z >= D) continue;
      for (let dy = -f.radius; dy <= f.radius; dy++) {
        for (let dx = -f.radius; dx <= f.radius; dx++) {
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          const x = (((fx + dx) % W) + W) % W;
          const y = (((fy + dy) % H) + H) % H;
          const i = (z * H + y) * W + x;
          const noise = draw(base, i) % (2 * f.biomass + 1);
          s.cells[CH.B * n + i] += noise;
          s.cells[CH.E * n + i] += Math.floor((f.energy * noise) / Math.max(1, f.biomass));
          for (let g = 0; g < GENOME_CHANNELS3; g++) s.genome[g * n + i] = words[g];
        }
      }
    }
  });
  const errs = validateState3(s);
  if (errs.length) throw new Error(`invalid initial world: ${errs.join("; ")}`);
  return s;
}

/** `validateState` for a slab state; a 2D state is an error here. One implementation, so every entry path agrees. */
export function validateState3(s: WorldState): string[] {
  if (!isSlab(s.cfg)) return ["not a slab state (tileD is absent)"];
  return validateState(s);
}

/**
 * The `slab-spots` founding: `count` balls of radius 3 at seeded random (x, y, z), nutrient and biomass as the
 * 2D `spots` world. Placement is keyed on lowbias32(seed * 313 + i); 313 is a new salt, distinct from the 2D worlds'.
 */
export function slabSpotsWorld(cfg: WorldConfig, genome: Genome3, count = 8, nutrient = 32, biomass = 64): WorldState {
  const W = worldW(cfg);
  const H = worldH(cfg);
  const D = cfg.tileD ?? 1;
  const founders: Founder3[] = [];
  for (let i = 0; i < count; i++) {
    const h = lowbias32(cfg.seed * 313 + i);
    founders.push({ x: h % W, y: (h >>> 12) % H, z: draw(h, 7) % D, radius: 3, genome, biomass, energy: 2 * biomass });
  }
  return buildWorld3(cfg, { nutrient, founders });
}
