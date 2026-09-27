import { LEDGER_MAX, MATTER_MAX, MAX_STEP, POOL_MAX, RING_CELL_MASK, cellCount, maxPackableRaw, packLineageLo, validateConfig, worldW, type WorldConfig } from "./config.ts";
import { CELL_CHANNELS, CH, FLUX_COUNT, G, GENOME_CHANNELS } from "./layout.ts";
import { encodeGenome, generalistGenome, randomGenome, type Genome } from "./genome.ts";
import { founderGenome, M3_FOUNDERS } from "./founders.ts";
import { draw, lowbias32 } from "./int.ts";

/** Complete simulation state. Channel-major: arr[ch * N + cell]. */
export interface WorldState {
  cfg: WorldConfig;
  step: number;
  cells: Uint32Array;
  genome: Uint32Array;
  lightIn: bigint;
  heatOut: bigint;
  /** Cumulative per-reaction fluxes, indexed like FLUX_NAMES. */
  flux: bigint[];
}

/** An experimenter intervention, logged so a run can be replayed exactly. */
export interface Intervention {
  step: number;
  kind: "lesion";
  x: number;
  y: number;
  r: number;
}

export interface Founder {
  x: number;
  y: number;
  radius: number;
  genome: Genome;
  /** Mean biomass quanta per occupied cell. */
  biomass: number;
  energy: number;
}

export interface InitSpec {
  /** Nutrient quanta per cell. */
  nutrient: number;
  founders: Founder[];
}

export function allocState(cfg: WorldConfig): WorldState {
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error(`invalid config: ${errs.join("; ")}`);
  const n = cellCount(cfg);
  return {
    cfg,
    step: 0,
    cells: new Uint32Array(n * CELL_CHANNELS),
    genome: new Uint32Array(n * GENOME_CHANNELS),
    lightIn: 0n,
    heatOut: 0n,
    flux: new Array<bigint>(FLUX_COUNT).fill(0n),
  };
}

const MOT_ZERO = 128 | (128 << 8);

export function buildWorld(cfg: WorldConfig, spec: InitSpec): WorldState {
  const s = allocState(cfg);
  const n = cellCount(cfg);
  const W = worldW(cfg);
  s.cells.fill(spec.nutrient, CH.A * n, (CH.A + 1) * n);
  s.cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
  const H = n / W;
  spec.founders.forEach((f, idx) => {
    if (2 * f.radius + 1 > Math.min(cfg.tileW, cfg.tileH)) throw new Error(`founder ${idx} radius ${f.radius} does not fit in a tile`);
    // A founder's raw lineage id (`idx + 1`) is a separate input from a
    // mutation's (a cell index, already bounded by `validateConfig`'s
    // `cellCount` check) -- nothing else bounds `spec.founders.length`
    // against what `packLineageLo` can pack without truncating, so an
    // oversized founder array can otherwise wrap around and collide two
    // founders onto the same lineage id (review P3). Checked here, before
    // packing, for both the namespaced and unnamespaced case (only the
    // namespaced one is reachable in practice -- 2**32 founders is not -- but
    // the check costs nothing either way).
    const rawId = idx + 1;
    if (rawId > maxPackableRaw(cfg)) throw new Error(`founder ${idx}: index exceeds the representable lineage-id range (${maxPackableRaw(cfg)})`);
    const words = encodeGenome(f.genome, 0, packLineageLo(cfg, rawId));
    const base = lowbias32(cfg.seed ^ (idx * 7919 + 17));
    // Founders live in the tile containing their centre and wrap inside it.
    const fx = ((f.x % W) + W) % W;
    const fy = ((f.y % H) + H) % H;
    const ox = fx - (fx % cfg.tileW);
    const oy = fy - (fy % cfg.tileH);
    const r2 = f.radius * f.radius;
    for (let dy = -f.radius; dy <= f.radius; dy++) {
      for (let dx = -f.radius; dx <= f.radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = ox + ((((fx - ox + dx) % cfg.tileW) + cfg.tileW) % cfg.tileW);
        const y = oy + ((((fy - oy + dy) % cfg.tileH) + cfg.tileH) % cfg.tileH);
        const i = y * W + x;
        const noise = draw(base, i) % (2 * f.biomass + 1);
        s.cells[CH.B * n + i] += noise;
        s.cells[CH.E * n + i] += Math.floor((f.energy * noise) / Math.max(1, f.biomass));
        for (let g = 0; g < GENOME_CHANNELS; g++) s.genome[g * n + i] = words[g];
      }
    }
  });
  const errs = validateState(s);
  if (errs.length) throw new Error(`invalid initial world: ${errs.join("; ")}`);
  return s;
}

/**
 * Checks the state bounds the rules rely on for exact arithmetic
 * (MATTER_MAX total matter, POOL_MAX per-cell E and S, MAX_STEP).
 */
export function validateState(s: WorldState): string[] {
  const errs = validateConfig(s.cfg);
  if (errs.length) return errs;
  const n = cellCount(s.cfg);
  if (s.cells.length !== n * CELL_CHANNELS) errs.push("cell buffer size mismatch");
  if (s.genome.length !== n * GENOME_CHANNELS) errs.push("genome buffer size mismatch");
  if (!Number.isInteger(s.step) || s.step < 0 || s.step > MAX_STEP) errs.push(`step must be in 0..${MAX_STEP}`);
  if (errs.length) return errs;
  let matter = 0;
  for (const ch of [CH.A, CH.B, CH.C, CH.P]) for (let i = ch * n; i < (ch + 1) * n; i++) matter += s.cells[i];
  if (matter > MATTER_MAX) errs.push(`total matter ${matter} exceeds ${MATTER_MAX}`);
  for (const ch of [CH.E, CH.S])
    for (let i = ch * n; i < (ch + 1) * n; i++)
      if (s.cells[i] > POOL_MAX) {
        errs.push(`${ch === CH.E ? "E" : "S"} at cell ${i - ch * n} exceeds ${POOL_MAX}`);
        break;
      }
  // Cumulative ledgers must leave headroom: one step adds < 2^58 (2^24 cells x < 2^34 each).
  const ok = (v: bigint) => typeof v === "bigint" && v >= 0n && v < LEDGER_MAX;
  if (!ok(s.lightIn) || !ok(s.heatOut) || s.flux.length !== FLUX_COUNT || !s.flux.every(ok)) errs.push(`ledger values must be in 0..2^63`);
  // Transport relies on genome words being identical for every cell of a lineage.
  const namespaced = s.cfg.ringNamespace !== undefined;
  const seen = new Map<string, number>();
  for (let i = 0; i < n && errs.length === 0; i++) {
    const hi = s.genome[G.LIN_HI * n + i], lo = s.genome[G.LIN_LO * n + i];
    if ((hi | lo) === 0) continue;
    // Mutation ids are (birth step + 1, cell); an id from the future could be
    // minted again. `lo`'s cell-index portion is the low RING_CELL_BITS when
    // namespaced (see packLineageLo) -- masking is a no-op (lo itself) when
    // not, so this is exactly the original `lo >= n` for every config that
    // predates ringNamespace.
    const cellPart = namespaced ? lo & RING_CELL_MASK : lo;
    if (hi > s.step || cellPart >= n) {
      errs.push(`lineage ${hi}:${lo} at cell ${i} is not from this state's past`);
      break;
    }
    const key = `${hi}:${lo}`;
    const j = seen.get(key);
    if (j === undefined) {
      seen.set(key, i);
      continue;
    }
    for (let g = 2; g < GENOME_CHANNELS; g++)
      if (s.genome[g * n + i] !== s.genome[g * n + j]) {
        errs.push(`lineage ${key} has differing genome words at cells ${j} and ${i}`);
        break;
      }
  }
  return errs;
}

/** A tile-centred founder per tile, each with its own genome. */
export function tiledWorld(cfg: WorldConfig, genomes: Genome[], nutrient = 256, radius = 10, biomass = 256, energy = 512): WorldState {
  const founders: Founder[] = [];
  let k = 0;
  for (let ty = 0; ty < cfg.tilesY; ty++)
    for (let tx = 0; tx < cfg.tilesX; tx++) {
      founders.push({
        x: tx * cfg.tileW + (cfg.tileW >> 1),
        y: ty * cfg.tileH + (cfg.tileH >> 1),
        radius,
        genome: genomes[k++ % genomes.length],
        biomass,
        energy,
      });
    }
  return buildWorld(cfg, { nutrient, founders });
}

export function generalistWorld(cfg: WorldConfig, count = 6, nutrient = 256, biomass = 256): WorldState {
  const W = worldW(cfg);
  const H = cellCount(cfg) / W;
  const founders: Founder[] = [];
  for (let i = 0; i < count; i++) {
    const h = lowbias32(cfg.seed * 31 + i);
    founders.push({
      x: h % W,
      y: (h >>> 12) % H,
      radius: 12,
      genome: generalistGenome(cfg.defaultMu, cfg.defaultSigma),
      biomass,
      energy: 2 * biomass,
    });
  }
  return buildWorld(cfg, { nutrient, founders });
}

export function soupWorld(cfg: WorldConfig, count = 24, nutrient = 256, biomass = 256): WorldState {
  const W = worldW(cfg);
  const H = cellCount(cfg) / W;
  const founders: Founder[] = [];
  for (let i = 0; i < count; i++) {
    const h = lowbias32(cfg.seed * 131 + i);
    founders.push({
      x: h % W,
      y: (h >>> 12) % H,
      radius: 10,
      genome: randomGenome(h, cfg.defaultMu, cfg.defaultSigma),
      biomass,
      energy: 2 * biomass,
    });
  }
  return buildWorld(cfg, { nutrient, founders });
}

/**
 * Founders drawn from the M3-confirmed ensemble (packages/schema/src/founders.ts)
 * instead of the hand-built generalist genome. Same placement/radius/biomass/energy
 * scheme as generalistWorld, but with a distinct hash salt (197, vs. 31 for
 * generalist and 131 for soup) so a m3-preset run never lands on the same founder
 * layout as a generalist or soup run with the same seed.
 */
export function m3World(cfg: WorldConfig, count = 13, nutrient = 256, biomass = 256): WorldState {
  const W = worldW(cfg);
  const H = cellCount(cfg) / W;
  const founders: Founder[] = [];
  for (let i = 0; i < count; i++) {
    const h = lowbias32(cfg.seed * 197 + i);
    founders.push({
      x: h % W,
      y: (h >>> 12) % H,
      radius: 12,
      genome: founderGenome(M3_FOUNDERS[i % M3_FOUNDERS.length]),
      biomass,
      energy: 2 * biomass,
    });
  }
  return buildWorld(cfg, { nutrient, founders });
}

export function cloneState(s: WorldState): WorldState {
  return { ...s, cells: s.cells.slice(), genome: s.genome.slice(), flux: s.flux.slice() };
}

export function isLiving(s: WorldState, i: number): boolean {
  const n = cellCount(s.cfg);
  return s.genome[G.LIN_HI * n + i] !== 0 || s.genome[G.LIN_LO * n + i] !== 0;
}
