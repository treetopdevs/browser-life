// Pond cycle of the ecological-scaffolding sandbox (docs/scaffold-protocol-v1.md, "Pond cycle").
// Tiles are ponds: at each boundary every pond is ground back to nutrient and reseeded by a k x k
// packet copied from a donor pond. The pure transform (applyPondCycle, contRows, the per-pond
// measurements and ledger checks) lives in @bl/schema (packages/schema/src/ponds.ts) and is
// re-exported here unchanged; this module keeps what depends on @bl/search or serves only the
// sandbox: the M3 evaluator's pond config, the clone and founders worlds, and the assay seeds.
// Pure and CPU only: no Deno API, so vitest exercises it directly.
import {
  M3_FOUNDERS,
  buildWorld,
  defaultConfig,
  founderGenome,
  type Founder,
  type Genome,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { DEFAULT_EVAL } from "@bl/search";

export {
  POND_COLUMNS,
  POND_SALT,
  applyPondCycle,
  assertConserved,
  contRows,
  dominantGenome,
  drawPacketCentre,
  ledgerEnergy,
  packetWindow,
  pondMatter,
  pondTraits,
  randomKey,
  weightedPick,
  type CycleResult,
  type PondArm,
  type PondCensus,
  type PondRow,
} from "@bl/schema";

/** Pond side and the disc centre, fixed by the protocol (tiles are 64x64, discs sit at (32, 32)). */
const TILE = 64;
const CENTRE = 32;

/** The M3 evaluator's world configuration at `side`x`side` ponds. An undefined `mutRate` keeps defaultConfig's own. */
export function pondConfig(side: number, seed: number, mutRate?: number): WorldConfig {
  return defaultConfig({
    ...DEFAULT_EVAL.world,
    tileW: TILE,
    tileH: TILE,
    tilesX: side,
    tilesY: side,
    seed,
    ...(mutRate === undefined ? {} : { mutRate }),
  });
}

const pondCount = (cfg: WorldConfig): number => cfg.tilesX * cfg.tilesY;

function assertPondTiles(cfg: WorldConfig): void {
  if (cfg.tileW !== TILE || cfg.tileH !== TILE) throw new Error(`ponds are ${TILE}x${TILE} tiles, got ${cfg.tileW}x${cfg.tileH}`);
}

/** The standard disc of the protocol (evaluate.ts:181): radius 10, biomass 64, energy 128 at the pond centre. */
function standardFounder(cfg: WorldConfig, pond: number, genome: Genome): Founder {
  const tx = pond % cfg.tilesX;
  const ty = (pond - tx) / cfg.tilesX;
  return { x: tx * cfg.tileW + CENTRE, y: ty * cfg.tileH + CENTRE, radius: 10, genome, biomass: 64, energy: 128 };
}

/** One standard disc of `genome` in every pond, nutrient 32. Lineage ids follow planting index (= pond index). */
export function cloneWorld(cfg: WorldConfig, genome: Genome): WorldState {
  assertPondTiles(cfg);
  const founders = Array.from({ length: pondCount(cfg) }, (_, t) => standardFounder(cfg, t, genome));
  return buildWorld(cfg, { nutrient: 32, founders });
}

/** The 12 M3 founders round-robin as standard discs (pond t gets founder t mod 12); `plantingToFounder[t]` records the map. */
export function foundersWorld(cfg: WorldConfig): { state: WorldState; plantingToFounder: number[] } {
  assertPondTiles(cfg);
  const plantingToFounder = Array.from({ length: pondCount(cfg) }, (_, t) => t % M3_FOUNDERS.length);
  const founders = plantingToFounder.map((f, t) => standardFounder(cfg, t, founderGenome(M3_FOUNDERS[f])));
  return { state: buildWorld(cfg, { nutrient: 32, founders }), plantingToFounder };
}

/**
 * Seed of an assay's fragments and physics: 4,820,001 + 5000 r + 250 h + 100 t + 20 v + s. Mixed radix, so it
 * cannot collide; the fields are range-checked.
 */
export function assaySeed(r: number, h: number, t: number, v: number, s: number): number {
  const field = (name: string, x: number, max: number) => {
    if (!Number.isInteger(x) || x < 0 || x > max) throw new Error(`assaySeed: ${name} must be an integer in 0..${max}, got ${x}`);
  };
  field("r", r, 4);
  field("h", h, 18);
  field("t", t, 1);
  field("v", v, 4);
  field("s", s, 9);
  return 4_820_001 + 5000 * r + 250 * h + 100 * t + 20 * v + s;
}
