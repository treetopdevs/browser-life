// World configuration. Every value is an integer so that the CPU reference
// and the WGSL kernels agree exactly. Fractions are numerators over the
// power of two named in the comment.

export const SCHEMA_VERSION = 3;
export const RULE_VERSION = 1;

export type LightMode = "uniform" | "gradient" | "patches";

export interface WorldConfig {
  ruleVersion: number;
  seed: number;
  /** One tile is an independent torus; tiles let many small worlds share one dispatch. */
  tileW: number;
  tileH: number;
  tilesX: number;
  tilesY: number;

  // Potential energy per quantum of each species (A nutrient, B biomass, C waste, P polymer).
  eA: number;
  eB: number;
  eC: number;
  eP: number;

  /** Quanta that make one Lenia mass unit. */
  massUnit: number;
  kernelRadius: number;
  /** Flow-Lenia crowding threshold θ, in quanta. */
  thetaMass: number;
  /** Flow-Lenia dt, /256. */
  dtQ: number;
  /** Extra half-width of the reintegration box, /64 cell (Flow-Lenia's s - 1/2). */
  spread: number;
  /** Growth-function defaults for cells without a genome, /1024 Lenia units. */
  defaultMu: number;
  defaultSigma: number;

  // Diffusion per 4-neighbour, /1024 (<= 256).
  diffA: number;
  diffC: number;
  diffS: number;
  /** Membrane gate: D_eff = D * gateK / (gateK + P_s + P_t). */
  gateK: number;

  /** Catalyst half-saturation (quanta): effective catalyst = B^2 / (B + kCatHalf). */
  kCatHalf: number;
  // Catalysed reaction capacity at full controller output, /4096 of B per step.
  kPhoto: number;
  kResp: number;
  kDecomp: number;
  kGrow: number;
  kBuild: number;
  kEmit: number;
  // Costs and decays, /65536 per step.
  kCost: number;
  kMaint: number;
  kPDecay: number;
  kBDecay: number;
  kELeak: number;
  kSDecay: number;
  /** Uncatalysed light-driven C -> A, /2^24 per quantum per light level. */
  kAbio: number;

  /** Mutation probability per newly synthesised quantum, /2^32. */
  mutRate: number;
  /** Max absolute change of one weight per mutation. */
  mutStep: number;

  lightMode: LightMode;
  /** 0..255 */
  lightBase: number;
  /** Added across the tile (gradient) or inside patches. */
  lightAmp: number;
  /** Steps per seasonal cycle; 0 disables seasons. */
  seasonPeriod: number;
  seasonAmp: number;

  /** Capacity of the per-dispatch mutation event buffer. */
  eventCap: number;

  /**
   * Neutral shadow control: genomes, lineages and mutations propagate as usual
   * but every cell expresses the same reference phenotype (the generalist
   * built from defaultMu/defaultSigma), so lineage dynamics are pure drift.
   */
  neutral: boolean;
  /** Active motility enabled (controller outputs move biomass). Off in the no-coordination control. */
  motility: boolean;
}

export function defaultConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return {
    ruleVersion: RULE_VERSION,
    seed: 1,
    tileW: 256,
    tileH: 256,
    tilesX: 1,
    tilesY: 1,
    eA: 0,
    eB: 10,
    eC: 2,
    eP: 12,
    massUnit: 256,
    kernelRadius: 9,
    thetaMass: 512,
    dtQ: 51,
    spread: 8,
    defaultMu: 154,
    defaultSigma: 24,
    diffA: 200,
    diffC: 200,
    diffS: 150,
    gateK: 64,
    kCatHalf: 128,
    kPhoto: 160,
    kResp: 128,
    kDecomp: 96,
    kGrow: 128,
    kBuild: 64,
    kEmit: 64,
    kCost: 64,
    kMaint: 200,
    kPDecay: 66,
    kBDecay: 20,
    kELeak: 330,
    kSDecay: 1300,
    kAbio: 400,
    mutRate: 429_497,
    mutStep: 24,
    lightMode: "gradient",
    lightBase: 40,
    lightAmp: 200,
    seasonPeriod: 0,
    seasonAmp: 0,
    eventCap: 1 << 16,
    neutral: false,
    motility: true,
    ...overrides,
  };
}

export const worldW = (c: WorldConfig) => c.tileW * c.tilesX;
export const worldH = (c: WorldConfig) => c.tileH * c.tilesY;
export const cellCount = (c: WorldConfig) => worldW(c) * worldH(c);

/** Numeric view of the config used for WGSL constants and validation. */
export function lightModeId(m: LightMode): number {
  return m === "uniform" ? 0 : m === "gradient" ? 1 : 2;
}

/**
 * Arithmetic-safety bounds. Every intermediate product in the rules is proved
 * to fit in u32/i32 under these limits (see docs/rules.md, "Bounds"):
 *  - total world matter <= MATTER_MAX, so every matter channel and every
 *    per-reaction amount is <= 2^26;
 *  - energy ladder values <= 31, so amount x energy gap < 2^31;
 *  - free energy E and signal S per cell are capped at POOL_MAX; excess is
 *    exported as heat, which keeps the ledger exact.
 */
export const MATTER_MAX = 2 ** 26;
export const POOL_MAX = 2 ** 28;
/** Cumulative ledger ceiling for accepted states; steps that would cross 2^64 raise an overflow flag. */
export const LEDGER_MAX = 1n << 63n;
/** Last step index that can be taken; lineage ids use step + 1 as a u32. */
export const MAX_STEP = 0xffff_fff0;

type Range = [number, number];
const RANGES: Partial<Record<keyof WorldConfig, Range>> = {
  seed: [0, 0xffffffff],
  tileW: [8, 4096],
  tileH: [8, 4096],
  tilesX: [1, 256],
  tilesY: [1, 256],
  eA: [0, 31],
  eB: [0, 31],
  eC: [0, 31],
  eP: [0, 31],
  massUnit: [16, 4096],
  kernelRadius: [2, 16],
  thetaMass: [1, 2048],
  dtQ: [0, 1024],
  spread: [0, 32],
  defaultMu: [0, 4095],
  defaultSigma: [1, 1023],
  diffA: [0, 256],
  diffC: [0, 256],
  diffS: [0, 256],
  gateK: [1, 65535],
  kCatHalf: [0, 65535],
  kPhoto: [0, 4096],
  kResp: [0, 4096],
  kDecomp: [0, 4096],
  kGrow: [0, 4096],
  kBuild: [0, 4096],
  kEmit: [0, 4096],
  kCost: [0, 65535],
  kMaint: [0, 65535],
  kPDecay: [0, 65535],
  kBDecay: [0, 65535],
  kELeak: [0, 65535],
  kSDecay: [0, 65535],
  kAbio: [0, 65535],
  mutRate: [0, 0xffffffff],
  mutStep: [1, 127],
  lightBase: [0, 255],
  lightAmp: [0, 255],
  seasonPeriod: [0, 8_000_000],
  seasonAmp: [0, 255],
  eventCap: [1, 1 << 22],
};

export function validateConfig(c: WorldConfig): string[] {
  const errs: string[] = [];
  if (c === null || typeof c !== "object") return ["config must be an object"];
  const defaults = defaultConfig();
  for (const k of Object.keys(defaults) as (keyof WorldConfig)[]) {
    const v = c[k];
    const want = typeof defaults[k];
    if (typeof v !== want) {
      errs.push(`${k} must be a ${want}`);
      continue;
    }
    const r = RANGES[k];
    if (r && (!Number.isInteger(v) || (v as number) < r[0] || (v as number) > r[1])) errs.push(`${k} must be an integer in ${r[0]}..${r[1]}`);
  }
  if (errs.length) return errs;
  if (c.ruleVersion !== RULE_VERSION) errs.push(`ruleVersion ${c.ruleVersion} != ${RULE_VERSION}`);
  if (!["uniform", "gradient", "patches"].includes(c.lightMode)) errs.push("lightMode must be uniform, gradient or patches");
  if (c.tileW % 8 !== 0 || c.tileH % 8 !== 0) errs.push("tile dimensions must be multiples of 8");
  if (c.kernelRadius * 2 + 1 > Math.min(c.tileW, c.tileH)) errs.push("kernel larger than tile");
  if (cellCount(c) > 1 << 24) errs.push("world larger than 2^24 cells");
  if (!(c.eB > c.eC && c.eC >= c.eA && c.eP > c.eB)) errs.push("energy ladder must satisfy eP > eB > eC >= eA");
  if ((c.massUnit & (c.massUnit - 1)) !== 0) errs.push("massUnit must be a power of two");
  if (c.lightBase + c.lightAmp + c.seasonAmp > 255) errs.push("light must stay within 0..255");
  return errs;
}

/** Largest lesion radius that keeps a disc inside one tile without wrapping onto itself. */
export function maxLesionRadius(c: WorldConfig): number {
  return Math.floor((Math.min(c.tileW, c.tileH) - 1) / 2);
}

export function clampLesionRadius(c: WorldConfig, r: number): number {
  return Math.max(0, Math.min(Math.floor(r), maxLesionRadius(c)));
}
