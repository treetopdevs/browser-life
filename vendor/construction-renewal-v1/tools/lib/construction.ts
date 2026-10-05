/** Constructed retention witness. Experimental settings, not a registered milestone. */
import {
  allocState,
  b2,
  CH,
  defaultConfig,
  emptyGenome,
  encodeGenome,
  G,
  type Genome,
  GENOME_CHANNELS,
  IN,
  OUT,
  w1,
  w2,
  type WorldConfig,
  type WorldState,
} from "@bl/schema";
import { MOT_ZERO } from "@bl/sim-ref";

export interface ControllerSpec {
  build: number;
  photo?: number;
  resp?: number;
  decomp?: number;
  grow?: number;
}
export function constructionGenome(
  { build, photo = 127, resp = 16, decomp = 127, grow = 0 }: ControllerSpec,
): Genome {
  const g = emptyGenome(154, 24), w = g.weights;
  w[b2(OUT.PHOTO)] = photo;
  w[b2(OUT.DECOMP)] = decomp;
  w[b2(OUT.GROW)] = grow;
  w[w1(IN.EPB, 0)] = 127;
  w[b2(OUT.RESP)] = resp;
  w[w2(0, OUT.RESP)] = -127;
  w[w1(IN.P, 1)] = 127;
  w[b2(OUT.BUILD)] = build;
  // Keep the same feedback wire even at build=0: partial forms differ in ONE byte.
  w[w2(1, OUT.BUILD)] = -127;
  return g;
}
export function constructionConfig(
  seed: number,
  overrides: Partial<WorldConfig> = {},
): WorldConfig {
  return defaultConfig({
    ruleVersion: 1,
    tileW: 32,
    tileH: 32,
    kernelRadius: 2,
    dtQ: 0,
    spread: 0,
    motility: false,
    mutRate: 0,
    lightMode: "uniform",
    lightBase: 255,
    lightAmp: 0,
    kAbio: 0,
    gateK: 1,
    kBDecay: 500,
    kPDecay: 16,
    ...overrides,
    seed,
  });
}
export interface Placement {
  x: number;
  y: number;
  genome: Genome;
  biomass?: number;
  energy?: number;
}
/** Exact initial amounts, no founder noise. No initial polymer, dissolved matter, or free feeding. */
export function constructionWorld(
  cfg: WorldConfig,
  placements: Placement[],
): WorldState {
  const s = allocState(cfg), n = cfg.tileW * cfg.tileH;
  if (cfg.tilesX !== 1 || cfg.tilesY !== 1) {
    throw new Error("constructionWorld requires one tile");
  }
  s.cells.fill(MOT_ZERO, CH.MOT * n, (CH.MOT + 1) * n);
  const used = new Set<number>();
  placements.forEach((p, k) => {
    if (
      !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 ||
      p.x >= cfg.tileW || p.y < 0 || p.y >= cfg.tileH
    ) throw new Error("invalid placement");
    const i = p.y * cfg.tileW + p.x;
    if (used.has(i)) throw new Error("overlapping placements");
    used.add(i);
    s.cells[CH.B * n + i] = p.biomass ?? 1024;
    s.cells[CH.E * n + i] = p.energy ?? 2048;
    const words = encodeGenome(p.genome, 0, k + 1);
    for (let j = 0; j < GENOME_CHANNELS; j++) s.genome[j * n + i] = words[j];
  });
  return s;
}
/** Set an unrelated founder's BUILD output to exactly zero, preserving all other outputs. */
export function withoutBuilding(genome: Genome): Genome {
  const g = { ...genome, weights: genome.weights.slice() };
  g.weights[b2(OUT.BUILD)] = 0;
  for (let j = 0; j < 8; j++) g.weights[w2(j, OUT.BUILD)] = 0;
  return g;
}
export function lineageBiomass(s: WorldState): Record<string, number> {
  const n = s.cells.length / 7, out: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const hi = s.genome[G.LIN_HI * n + i], lo = s.genome[G.LIN_LO * n + i];
    if (!(hi | lo)) continue;
    const key = `${hi}:${lo}`;
    out[key] = (out[key] ?? 0) + s.cells[CH.B * n + i];
  }
  return out;
}
